/**
 * Database Service for Fylgja
 * Optimized Firestore operations with caching and performance monitoring
 */

const admin = require('firebase-admin');
const { performance } = require('perf_hooks');

class DatabaseService {
  constructor() {
    this.db = admin.firestore();
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.metrics = {
      queries: 0,
      cacheHits: 0,
      averageResponseTime: 0
    };
  }

  /**
   * Get user profile with caching
   */
  async getUserProfile(userId) {
    const startTime = performance.now();
    const cacheKey = `user_${userId}`;
    
    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        this.metrics.cacheHits++;
        return cached.data;
      }
    }

    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      const userData = userDoc.exists ? userDoc.data() : null;
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: userData,
        timestamp: Date.now()
      });

      this._updateMetrics(startTime);
      return userData;
    } catch (error) {
      console.error('Error getting user profile:', error);
      throw error;
    }
  }

  /**
   * Create or update user profile
   */
  async saveUserProfile(userId, profileData) {
    const startTime = performance.now();
    
    try {
      const userRef = this.db.collection('users').doc(userId);
      await userRef.set(profileData, { merge: true });
      
      // Invalidate cache
      this.cache.delete(`user_${userId}`);
      
      this._updateMetrics(startTime);
      return true;
    } catch (error) {
      console.error('Error saving user profile:', error);
      throw error;
    }
  }

  /**
   * Save interaction with AI processing results
   */
  async saveInteraction(userId, interactionData) {
    const startTime = performance.now();
    
    try {
      const interactionRef = this.db
        .collection('users')
        .doc(userId)
        .collection('interactions')
        .doc();

      const interaction = {
        ...interactionData,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        id: interactionRef.id
      };

      await interactionRef.set(interaction);
      
      this._updateMetrics(startTime);
      return interactionRef.id;
    } catch (error) {
      console.error('Error saving interaction:', error);
      throw error;
    }
  }

  /**
   * Get recent interactions for context
   */
  async getRecentInteractions(userId, limit = 10) {
    const startTime = performance.now();
    const cacheKey = `interactions_${userId}_${limit}`;
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        this.metrics.cacheHits++;
        return cached.data;
      }
    }

    try {
      const snapshot = await this.db
        .collection('users')
        .doc(userId)
        .collection('interactions')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const interactions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Cache the result
      this.cache.set(cacheKey, {
        data: interactions,
        timestamp: Date.now()
      });

      this._updateMetrics(startTime);
      return interactions;
    } catch (error) {
      console.error('Error getting recent interactions:', error);
      throw error;
    }
  }

  /**
   * Save or update task
   */
  async saveTask(userId, taskData) {
    const startTime = performance.now();
    
    try {
      const taskRef = taskData.id 
        ? this.db.collection('users').doc(userId).collection('tasks').doc(taskData.id)
        : this.db.collection('users').doc(userId).collection('tasks').doc();

      const task = {
        ...taskData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(taskData.id ? {} : { 
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          id: taskRef.id 
        })
      };

      await taskRef.set(task, { merge: true });
      
      // Invalidate related caches
      this._invalidateTaskCaches(userId);
      
      this._updateMetrics(startTime);
      return taskRef.id;
    } catch (error) {
      console.error('Error saving task:', error);
      throw error;
    }
  }

  /**
   * Get user tasks with filtering
   */
  async getUserTasks(userId, filters = {}) {
    const startTime = performance.now();
    const cacheKey = `tasks_${userId}_${JSON.stringify(filters)}`;
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        this.metrics.cacheHits++;
        return cached.data;
      }
    }

    try {
      let query = this.db
        .collection('users')
        .doc(userId)
        .collection('tasks');

      // Apply filters
      if (filters.status) {
        query = query.where('status', '==', filters.status);
      }
      if (filters.category) {
        query = query.where('category', '==', filters.category);
      }
      if (filters.priority) {
        query = query.where('priority', '==', filters.priority);
      }

      // Apply ordering
      const orderBy = filters.orderBy || 'updatedAt';
      const order = filters.order || 'desc';
      query = query.orderBy(orderBy, order);

      // Apply limit
      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      const snapshot = await query.get();
      const tasks = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Cache the result
      this.cache.set(cacheKey, {
        data: tasks,
        timestamp: Date.now()
      });

      this._updateMetrics(startTime);
      return tasks;
    } catch (error) {
      console.error('Error getting user tasks:', error);
      throw error;
    }
  }

  /**
   * Save legacy data entry (encrypted)
   */
  async saveLegacyData(userId, legacyData) {
    const startTime = performance.now();
    
    try {
      const legacyRef = legacyData.id
        ? this.db.collection('users').doc(userId).collection('legacyData').doc(legacyData.id)
        : this.db.collection('users').doc(userId).collection('legacyData').doc();

      const entry = {
        ...legacyData,
        lastModified: admin.firestore.FieldValue.serverTimestamp(),
        ...(legacyData.id ? {} : { 
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          id: legacyRef.id 
        })
      };

      await legacyRef.set(entry, { merge: true });
      
      // Log access for security
      await this._logLegacyAccess(userId, legacyRef.id, 'create');
      
      this._updateMetrics(startTime);
      return legacyRef.id;
    } catch (error) {
      console.error('Error saving legacy data:', error);
      throw error;
    }
  }

  /**
   * Get user's legacy data entries
   */
  async getLegacyData(userId, category = null) {
    const startTime = performance.now();
    
    try {
      let query = this.db
        .collection('users')
        .doc(userId)
        .collection('legacyData');

      if (category) {
        query = query.where('category', '==', category);
      }

      query = query.orderBy('createdAt', 'desc');

      const snapshot = await query.get();
      const entries = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Log access for security
      for (const entry of entries) {
        await this._logLegacyAccess(userId, entry.id, 'read');
      }

      this._updateMetrics(startTime);
      return entries;
    } catch (error) {
      console.error('Error getting legacy data:', error);
      throw error;
    }
  }

  /**
   * Schedule a message for later delivery
   */
  async scheduleMessage(messageData) {
    const startTime = performance.now();
    
    try {
      const messageRef = this.db.collection('scheduled_messages').doc();
      
      const scheduledMessage = {
        ...messageData,
        id: messageRef.id,
        status: 'pending',
        attempts: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await messageRef.set(scheduledMessage);
      
      this._updateMetrics(startTime);
      return messageRef.id;
    } catch (error) {
      console.error('Error scheduling message:', error);
      throw error;
    }
  }

  /**
   * Get pending scheduled messages
   */
  async getPendingMessages(limit = 100) {
    const startTime = performance.now();
    
    try {
      const now = admin.firestore.Timestamp.now();
      
      const snapshot = await this.db
        .collection('scheduled_messages')
        .where('status', '==', 'pending')
        .where('scheduleTime', '<=', now)
        .orderBy('scheduleTime', 'asc')
        .limit(limit)
        .get();

      const messages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      this._updateMetrics(startTime);
      return messages;
    } catch (error) {
      console.error('Error getting pending messages:', error);
      throw error;
    }
  }

  /**
   * Update message status
   */
  async updateMessageStatus(messageId, status, metadata = {}) {
    const startTime = performance.now();
    
    try {
      const updateData = {
        status,
        ...metadata,
        lastAttempt: admin.firestore.FieldValue.serverTimestamp()
      };

      if (status === 'sent') {
        updateData.deliveredAt = admin.firestore.FieldValue.serverTimestamp();
      }

      await this.db
        .collection('scheduled_messages')
        .doc(messageId)
        .update(updateData);

      this._updateMetrics(startTime);
      return true;
    } catch (error) {
      console.error('Error updating message status:', error);
      throw error;
    }
  }

  /**
   * Log error for monitoring
   */
  async logError(errorData) {
    try {
      const errorRef = this.db.collection('error_logs').doc();
      
      const error = {
        ...errorData,
        id: errorRef.id,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        resolved: false
      };

      await errorRef.set(error);
      return errorRef.id;
    } catch (error) {
      console.error('Error logging error:', error);
      // Don't throw here to avoid infinite loops
    }
  }

  /**
   * Log webhook activity
   */
  async logWebhook(webhookData) {
    try {
      const webhookRef = this.db.collection('webhook_logs').doc();
      
      const webhook = {
        ...webhookData,
        id: webhookRef.id,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };

      await webhookRef.set(webhook);
      return webhookRef.id;
    } catch (error) {
      console.error('Error logging webhook:', error);
      // Don't throw here to avoid infinite loops
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      cacheHitRate: this.metrics.queries > 0 ? 
        (this.metrics.cacheHits / this.metrics.queries * 100).toFixed(2) + '%' : '0%',
      cacheSize: this.cache.size
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }

  // Private helper methods
  _updateMetrics(startTime) {
    this.metrics.queries++;
    const responseTime = performance.now() - startTime;
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.queries - 1) + responseTime) / this.metrics.queries;
  }

  _invalidateTaskCaches(userId) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`tasks_${userId}`)) {
        this.cache.delete(key);
      }
    }
  }

  async _logLegacyAccess(userId, entryId, action) {
    try {
      const accessLog = {
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        action,
        source: 'api'
      };

      await this.db
        .collection('users')
        .doc(userId)
        .collection('legacyData')
        .doc(entryId)
        .update({
          accessLog: admin.firestore.FieldValue.arrayUnion(accessLog)
        });
    } catch (error) {
      console.error('Error logging legacy access:', error);
    }
  }
}

module.exports = DatabaseService;

