/**
 * Comprehensive Reminder System for Fylgja
 * Handles creation, scheduling, management, and delivery of personalized reminders
 */

import { EnhancedDatabaseService } from '../services/enhanced-database-service';
import { GoogleAIService } from '../services/google-ai-service';
import { ResponsePersonalizer } from '../personalization/response-personalizer';
import { FylgjaError, ErrorType } from '../utils/error-handler';
import { RedisCacheService } from '../cache/redis-cache-service';

export interface Reminder {
  id: string;
  userId: string;
  title: string;
  description?: string;
  scheduledTime: Date;
  timezone: string;
  recurrence?: RecurrencePattern;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: 'personal' | 'work' | 'health' | 'social' | 'learning' | 'custom';
  customCategory?: string;
  tags: string[];
  location?: {
    name: string;
    coordinates?: { lat: number; lng: number };
    radius?: number; // meters
  };
  context: {
    relatedGoals?: string[];
    relatedTasks?: string[];
    notes?: string;
    attachments?: string[];
  };
  delivery: {
    channels: DeliveryChannel[];
    advanceNotifications: AdvanceNotification[];
    customMessage?: string;
    tone: 'friendly' | 'professional' | 'urgent' | 'motivational';
  };
  status: 'active' | 'completed' | 'snoozed' | 'cancelled' | 'expired';
  snoozeUntil?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: 'user' | 'system' | 'ai_suggestion';
  metadata: {
    source?: string;
    confidence?: number;
    learningData?: any;
  };
}

export interface RecurrencePattern {
  type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  interval: number; // e.g., every 2 days, every 3 weeks
  daysOfWeek?: number[]; // 0-6, Sunday = 0
  daysOfMonth?: number[]; // 1-31
  monthsOfYear?: number[]; // 1-12
  endDate?: Date;
  maxOccurrences?: number;
  customPattern?: string; // cron-like expression
}

export interface DeliveryChannel {
  type: 'whatsapp' | 'sms' | 'email' | 'push' | 'voice' | 'smart_display';
  address: string; // phone number, email, device ID, etc.
  enabled: boolean;
  priority: number; // 1 = highest priority
}

export interface AdvanceNotification {
  timeBeforeReminder: number; // minutes
  message?: string;
  channels: string[]; // subset of delivery channels
}

export interface ReminderTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultPriority: 'low' | 'medium' | 'high' | 'urgent';
  suggestedRecurrence?: RecurrencePattern;
  suggestedAdvanceNotifications: AdvanceNotification[];
  customFields?: { [key: string]: any };
  isSystemTemplate: boolean;
  createdBy: string;
  usageCount: number;
  rating: number;
}

export interface ReminderAnalytics {
  userId: string;
  reminderId: string;
  event: 'created' | 'delivered' | 'acknowledged' | 'completed' | 'snoozed' | 'cancelled';
  timestamp: Date;
  channel?: string;
  responseTime?: number; // seconds from delivery to acknowledgment
  effectiveness?: number; // 1-5 rating
  userFeedback?: string;
  context: any;
}

export interface SmartSuggestion {
  id: string;
  userId: string;
  type: 'reminder' | 'optimization' | 'pattern';
  suggestion: {
    title: string;
    description: string;
    confidence: number;
    reasoning: string;
    suggestedReminder?: Partial<Reminder>;
    suggestedChanges?: any;
  };
  basedOn: {
    patterns: string[];
    data: any;
    timeframe: string;
  };
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: Date;
  expiresAt: Date;
}

export class ReminderSystem {
  private static instance: ReminderSystem;
  private databaseService: EnhancedDatabaseService;
  private aiService: GoogleAIService;
  private responsePersonalizer: ResponsePersonalizer;
  private cacheService: RedisCacheService;

  private constructor() {
    this.databaseService = EnhancedDatabaseService.getInstance();
    this.aiService = GoogleAIService.getInstance();
    this.responsePersonalizer = ResponsePersonalizer.getInstance();
    this.cacheService = RedisCacheService.getInstance();
  }

  public static getInstance(): ReminderSystem {
    if (!ReminderSystem.instance) {
      ReminderSystem.instance = new ReminderSystem();
    }
    return ReminderSystem.instance;
  }

  /**
   * Create a new reminder
   */
  public async createReminder(reminderData: Partial<Reminder>): Promise<Reminder> {
    try {
      console.log('Creating new reminder', {
        userId: reminderData.userId,
        title: reminderData.title,
        scheduledTime: reminderData.scheduledTime
      });

      // Validate reminder data
      this.validateReminderData(reminderData);

      // Generate unique ID
      const reminderId = `reminder-${reminderData.userId}-${Date.now()}`;

      // Create complete reminder object with defaults
      const reminder: Reminder = {
        id: reminderId,
        userId: reminderData.userId!,
        title: reminderData.title!,
        description: reminderData.description,
        scheduledTime: reminderData.scheduledTime!,
        timezone: reminderData.timezone || 'UTC',
        recurrence: reminderData.recurrence,
        priority: reminderData.priority || 'medium',
        category: reminderData.category || 'personal',
        customCategory: reminderData.customCategory,
        tags: reminderData.tags || [],
        location: reminderData.location,
        context: reminderData.context || {},
        delivery: {
          channels: reminderData.delivery?.channels || await this.getDefaultDeliveryChannels(reminderData.userId!),
          advanceNotifications: reminderData.delivery?.advanceNotifications || [],
          customMessage: reminderData.delivery?.customMessage,
          tone: reminderData.delivery?.tone || 'friendly'
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: reminderData.createdBy || 'user',
        metadata: reminderData.metadata || {}
      };

      // Enhance reminder with AI suggestions if enabled
      if (reminder.createdBy === 'user') {
        reminder = await this.enhanceReminderWithAI(reminder);
      }

      // Store reminder in database
      await this.databaseService.storeReminder(reminder);

      // Schedule reminder for delivery
      await this.scheduleReminderDelivery(reminder);

      // Track analytics
      await this.trackReminderEvent(reminder.id, 'created', {
        priority: reminder.priority,
        category: reminder.category,
        hasRecurrence: !!reminder.recurrence
      });

      // Learn from user patterns
      await this.updateUserReminderPatterns(reminder);

      console.log('Reminder created successfully', {
        reminderId: reminder.id,
        scheduledTime: reminder.scheduledTime,
        channels: reminder.delivery.channels.length
      });

      return reminder;

    } catch (error) {
      console.error('Failed to create reminder', {
        userId: reminderData.userId,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.VALIDATION_ERROR,
        message: 'Failed to create reminder',
        context: { userId: reminderData.userId, error: error.message }
      });
    }
  }

  /**
   * Update an existing reminder
   */
  public async updateReminder(reminderId: string, updates: Partial<Reminder>): Promise<Reminder> {
    try {
      console.log('Updating reminder', { reminderId, updateKeys: Object.keys(updates) });

      // Get existing reminder
      const existingReminder = await this.databaseService.getReminder(reminderId);
      if (!existingReminder) {
        throw new FylgjaError({
          type: ErrorType.NOT_FOUND,
          message: 'Reminder not found',
          context: { reminderId }
        });
      }

      // Validate updates
      if (updates.scheduledTime) {
        this.validateScheduledTime(updates.scheduledTime);
      }

      // Apply updates
      const updatedReminder: Reminder = {
        ...existingReminder,
        ...updates,
        updatedAt: new Date()
      };

      // Re-enhance with AI if significant changes
      if (updates.title || updates.description || updates.scheduledTime) {
        updatedReminder.metadata = await this.enhanceReminderMetadata(updatedReminder);
      }

      // Store updated reminder
      await this.databaseService.updateReminder(reminderId, updatedReminder);

      // Reschedule if timing changed
      if (updates.scheduledTime || updates.recurrence) {
        await this.rescheduleReminderDelivery(updatedReminder);
      }

      console.log('Reminder updated successfully', { reminderId });

      return updatedReminder;

    } catch (error) {
      console.error('Failed to update reminder', { reminderId, error: error.message });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to update reminder',
        context: { reminderId, error: error.message }
      });
    }
  }

  /**
   * Delete a reminder
   */
  public async deleteReminder(reminderId: string): Promise<void> {
    try {
      console.log('Deleting reminder', { reminderId });

      // Get reminder to verify ownership
      const reminder = await this.databaseService.getReminder(reminderId);
      if (!reminder) {
        throw new FylgjaError({
          type: ErrorType.NOT_FOUND,
          message: 'Reminder not found',
          context: { reminderId }
        });
      }

      // Cancel scheduled delivery
      await this.cancelReminderDelivery(reminderId);

      // Mark as cancelled in database
      await this.databaseService.updateReminder(reminderId, {
        status: 'cancelled',
        updatedAt: new Date()
      });

      // Track analytics
      await this.trackReminderEvent(reminderId, 'cancelled', {
        wasActive: reminder.status === 'active'
      });

      console.log('Reminder deleted successfully', { reminderId });

    } catch (error) {
      console.error('Failed to delete reminder', { reminderId, error: error.message });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to delete reminder',
        context: { reminderId, error: error.message }
      });
    }
  }

  /**
   * Get user's reminders with filtering and pagination
   */
  public async getUserReminders(
    userId: string,
    filters?: {
      status?: string[];
      category?: string[];
      priority?: string[];
      dateRange?: { start: Date; end: Date };
      tags?: string[];
    },
    pagination?: { limit: number; offset: number }
  ): Promise<{ reminders: Reminder[]; total: number }> {
    try {
      console.log('Getting user reminders', {
        userId,
        filters: filters ? Object.keys(filters) : [],
        pagination
      });

      const result = await this.databaseService.getUserReminders(userId, filters, pagination);

      console.log('Retrieved user reminders', {
        userId,
        count: result.reminders.length,
        total: result.total
      });

      return result;

    } catch (error) {
      console.error('Failed to get user reminders', { userId, error: error.message });

      throw new FylgjaError({
        type: ErrorType.DATABASE_ERROR,
        message: 'Failed to get user reminders',
        context: { userId, error: error.message }
      });
    }
  }

  /**
   * Snooze a reminder
   */
  public async snoozeReminder(
    reminderId: string,
    snoozeUntil: Date,
    reason?: string
  ): Promise<Reminder> {
    try {
      console.log('Snoozing reminder', { reminderId, snoozeUntil });

      const reminder = await this.databaseService.getReminder(reminderId);
      if (!reminder) {
        throw new FylgjaError({
          type: ErrorType.NOT_FOUND,
          message: 'Reminder not found',
          context: { reminderId }
        });
      }

      // Update reminder status
      const updatedReminder = await this.updateReminder(reminderId, {
        status: 'snoozed',
        snoozeUntil,
        scheduledTime: snoozeUntil
      });

      // Track analytics
      await this.trackReminderEvent(reminderId, 'snoozed', {
        originalTime: reminder.scheduledTime,
        snoozeUntil,
        reason
      });

      console.log('Reminder snoozed successfully', { reminderId, snoozeUntil });

      return updatedReminder;

    } catch (error) {
      console.error('Failed to snooze reminder', { reminderId, error: error.message });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to snooze reminder',
        context: { reminderId, error: error.message }
      });
    }
  }

  /**
   * Mark reminder as completed
   */
  public async completeReminder(
    reminderId: string,
    completionNotes?: string,
    effectiveness?: number
  ): Promise<Reminder> {
    try {
      console.log('Completing reminder', { reminderId, effectiveness });

      const reminder = await this.databaseService.getReminder(reminderId);
      if (!reminder) {
        throw new FylgjaError({
          type: ErrorType.NOT_FOUND,
          message: 'Reminder not found',
          context: { reminderId }
        });
      }

      // Update reminder status
      const updatedReminder = await this.updateReminder(reminderId, {
        status: 'completed',
        completedAt: new Date(),
        context: {
          ...reminder.context,
          completionNotes,
          effectiveness
        }
      });

      // Handle recurring reminders
      if (reminder.recurrence) {
        await this.createNextRecurringReminder(reminder);
      }

      // Track analytics
      await this.trackReminderEvent(reminderId, 'completed', {
        effectiveness,
        completionNotes,
        wasOnTime: new Date() <= reminder.scheduledTime
      });

      // Learn from completion patterns
      await this.learnFromReminderCompletion(reminder, effectiveness);

      console.log('Reminder completed successfully', { reminderId });

      return updatedReminder;

    } catch (error) {
      console.error('Failed to complete reminder', { reminderId, error: error.message });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to complete reminder',
        context: { reminderId, error: error.message }
      });
    }
  }

  /**
   * Get smart suggestions for reminders
   */
  public async getSmartSuggestions(userId: string): Promise<SmartSuggestion[]> {
    try {
      console.log('Getting smart suggestions', { userId });

      // Analyze user patterns
      const patterns = await this.analyzeUserReminderPatterns(userId);

      // Generate AI-powered suggestions
      const suggestions = await this.generateSmartSuggestions(userId, patterns);

      // Filter and rank suggestions
      const rankedSuggestions = await this.rankSuggestions(suggestions, patterns);

      console.log('Generated smart suggestions', {
        userId,
        count: rankedSuggestions.length
      });

      return rankedSuggestions;

    } catch (error) {
      console.error('Failed to get smart suggestions', { userId, error: error.message });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to get smart suggestions',
        context: { userId, error: error.message }
      });
    }
  }

  /**
   * Create reminder from template
   */
  public async createReminderFromTemplate(
    userId: string,
    templateId: string,
    customizations?: Partial<Reminder>
  ): Promise<Reminder> {
    try {
      console.log('Creating reminder from template', { userId, templateId });

      // Get template
      const template = await this.databaseService.getReminderTemplate(templateId);
      if (!template) {
        throw new FylgjaError({
          type: ErrorType.NOT_FOUND,
          message: 'Reminder template not found',
          context: { templateId }
        });
      }

      // Create reminder from template
      const reminderData: Partial<Reminder> = {
        userId,
        title: customizations?.title || template.defaultTitle,
        description: customizations?.description || template.defaultDescription,
        priority: customizations?.priority || template.defaultPriority,
        category: template.category as any,
        recurrence: customizations?.recurrence || template.suggestedRecurrence,
        delivery: {
          ...customizations?.delivery,
          advanceNotifications: customizations?.delivery?.advanceNotifications || template.suggestedAdvanceNotifications
        },
        ...customizations,
        metadata: {
          source: 'template',
          templateId,
          ...customizations?.metadata
        }
      };

      // Create the reminder
      const reminder = await this.createReminder(reminderData);

      // Update template usage
      await this.databaseService.incrementTemplateUsage(templateId);

      console.log('Reminder created from template successfully', {
        reminderId: reminder.id,
        templateId
      });

      return reminder;

    } catch (error) {
      console.error('Failed to create reminder from template', {
        userId,
        templateId,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to create reminder from template',
        context: { userId, templateId, error: error.message }
      });
    }
  }

  /**
   * Process due reminders for delivery
   */
  public async processDueReminders(): Promise<void> {
    try {
      console.log('Processing due reminders');

      // Get all due reminders
      const dueReminders = await this.databaseService.getDueReminders(new Date());

      console.log('Found due reminders', { count: dueReminders.length });

      // Process each reminder
      for (const reminder of dueReminders) {
        try {
          await this.deliverReminder(reminder);
        } catch (error) {
          console.error('Failed to deliver reminder', {
            reminderId: reminder.id,
            error: error.message
          });
        }
      }

      console.log('Completed processing due reminders');

    } catch (error) {
      console.error('Failed to process due reminders', { error: error.message });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to process due reminders',
        context: { error: error.message }
      });
    }
  }

  /**
   * Private helper methods
   */

  private validateReminderData(reminderData: Partial<Reminder>): void {
    if (!reminderData.userId) {
      throw new Error('User ID is required');
    }

    if (!reminderData.title || reminderData.title.trim().length === 0) {
      throw new Error('Reminder title is required');
    }

    if (!reminderData.scheduledTime) {
      throw new Error('Scheduled time is required');
    }

    this.validateScheduledTime(reminderData.scheduledTime);
  }

  private validateScheduledTime(scheduledTime: Date): void {
    const now = new Date();
    if (scheduledTime <= now) {
      throw new Error('Scheduled time must be in the future');
    }

    // Don't allow reminders more than 5 years in the future
    const maxFutureDate = new Date();
    maxFutureDate.setFullYear(maxFutureDate.getFullYear() + 5);
    if (scheduledTime > maxFutureDate) {
      throw new Error('Scheduled time cannot be more than 5 years in the future');
    }
  }

  private async getDefaultDeliveryChannels(userId: string): Promise<DeliveryChannel[]> {
    try {
      // Get user's preferred delivery channels from profile
      const userProfile = await this.databaseService.getUserProfile(userId);
      
      if (userProfile?.reminderPreferences?.defaultChannels) {
        return userProfile.reminderPreferences.defaultChannels;
      }

      // Return default channels
      return [
        {
          type: 'whatsapp',
          address: userProfile?.phoneNumber || '',
          enabled: true,
          priority: 1
        }
      ];

    } catch (error) {
      // Fallback to basic channel
      return [
        {
          type: 'push',
          address: userId,
          enabled: true,
          priority: 1
        }
      ];
    }
  }

  private async enhanceReminderWithAI(reminder: Reminder): Promise<Reminder> {
    try {
      // Generate AI suggestions for improvement
      const enhancementPrompt = `Analyze this reminder and suggest improvements:
      Title: ${reminder.title}
      Description: ${reminder.description || 'None'}
      Category: ${reminder.category}
      Priority: ${reminder.priority}
      
      Suggest:
      1. Better title if needed
      2. Helpful description if missing
      3. Appropriate tags
      4. Optimal timing suggestions
      5. Relevant context or notes`;

      const aiResponse = await this.aiService.generateResponse({
        prompt: enhancementPrompt,
        context: {
          userId: reminder.userId,
          type: 'reminder_enhancement'
        }
      });

      // Parse AI suggestions and apply reasonable enhancements
      const suggestions = this.parseAIEnhancements(aiResponse.response);
      
      return {
        ...reminder,
        description: reminder.description || suggestions.description,
        tags: [...reminder.tags, ...suggestions.tags],
        metadata: {
          ...reminder.metadata,
          aiEnhancements: suggestions,
          confidence: aiResponse.confidence
        }
      };

    } catch (error) {
      console.warn('Failed to enhance reminder with AI', {
        reminderId: reminder.id,
        error: error.message
      });

      // Return original reminder if AI enhancement fails
      return reminder;
    }
  }

  private parseAIEnhancements(aiResponse: string): any {
    // Simple parsing of AI suggestions
    // In a real implementation, this would be more sophisticated
    return {
      description: '',
      tags: [],
      suggestions: aiResponse
    };
  }

  private async enhanceReminderMetadata(reminder: Reminder): Promise<any> {
    // Enhance reminder metadata with additional context
    return {
      ...reminder.metadata,
      lastUpdated: new Date(),
      updateCount: (reminder.metadata.updateCount || 0) + 1
    };
  }

  private async scheduleReminderDelivery(reminder: Reminder): Promise<void> {
    // Schedule reminder for delivery using Cloud Scheduler or similar
    console.log('Scheduling reminder delivery', {
      reminderId: reminder.id,
      scheduledTime: reminder.scheduledTime
    });

    // Implementation would integrate with Cloud Scheduler
    // For now, we'll store the scheduling information
    await this.databaseService.scheduleReminder(reminder);
  }

  private async rescheduleReminderDelivery(reminder: Reminder): Promise<void> {
    // Cancel existing schedule and create new one
    await this.cancelReminderDelivery(reminder.id);
    await this.scheduleReminderDelivery(reminder);
  }

  private async cancelReminderDelivery(reminderId: string): Promise<void> {
    // Cancel scheduled delivery
    console.log('Cancelling reminder delivery', { reminderId });
    await this.databaseService.cancelScheduledReminder(reminderId);
  }

  private async deliverReminder(reminder: Reminder): Promise<void> {
    try {
      console.log('Delivering reminder', {
        reminderId: reminder.id,
        channels: reminder.delivery.channels.length
      });

      // Generate personalized message
      const message = await this.generateReminderMessage(reminder);

      // Deliver through each enabled channel
      for (const channel of reminder.delivery.channels) {
        if (channel.enabled) {
          await this.deliverThroughChannel(reminder, channel, message);
        }
      }

      // Track delivery
      await this.trackReminderEvent(reminder.id, 'delivered', {
        channels: reminder.delivery.channels.map(c => c.type),
        messageLength: message.length
      });

      console.log('Reminder delivered successfully', { reminderId: reminder.id });

    } catch (error) {
      console.error('Failed to deliver reminder', {
        reminderId: reminder.id,
        error: error.message
      });

      throw error;
    }
  }

  private async generateReminderMessage(reminder: Reminder): Promise<string> {
    try {
      // Use custom message if provided
      if (reminder.delivery.customMessage) {
        return reminder.delivery.customMessage;
      }

      // Generate personalized message using AI
      const messagePrompt = `Generate a ${reminder.delivery.tone} reminder message:
      Title: ${reminder.title}
      Description: ${reminder.description || ''}
      Priority: ${reminder.priority}
      Category: ${reminder.category}
      
      Make it personal, helpful, and appropriate for the tone and priority level.`;

      const response = await this.responsePersonalizer.personalizeResponse({
        prompt: messagePrompt,
        userId: reminder.userId,
        context: {
          type: 'reminder',
          priority: reminder.priority,
          category: reminder.category
        }
      });

      return response.personalizedResponse;

    } catch (error) {
      // Fallback to simple message
      return `Reminder: ${reminder.title}${reminder.description ? '\n' + reminder.description : ''}`;
    }
  }

  private async deliverThroughChannel(
    reminder: Reminder,
    channel: DeliveryChannel,
    message: string
  ): Promise<void> {
    try {
      console.log('Delivering through channel', {
        reminderId: reminder.id,
        channelType: channel.type,
        address: channel.address
      });

      // Implementation would integrate with actual delivery services
      // For now, we'll log the delivery
      console.log('Reminder delivery', {
        channel: channel.type,
        address: channel.address,
        message: message.substring(0, 100) + '...'
      });

      // In a real implementation, this would call:
      // - WhatsApp Business API for whatsapp
      // - Twilio for SMS
      // - SendGrid for email
      // - Firebase Cloud Messaging for push notifications
      // - Google Assistant for voice/smart display

    } catch (error) {
      console.error('Failed to deliver through channel', {
        reminderId: reminder.id,
        channelType: channel.type,
        error: error.message
      });

      throw error;
    }
  }

  private async createNextRecurringReminder(reminder: Reminder): Promise<void> {
    if (!reminder.recurrence) return;

    try {
      // Calculate next occurrence
      const nextScheduledTime = this.calculateNextOccurrence(
        reminder.scheduledTime,
        reminder.recurrence
      );

      if (!nextScheduledTime) return; // No more occurrences

      // Create next reminder
      const nextReminder: Partial<Reminder> = {
        ...reminder,
        id: undefined, // Will be generated
        scheduledTime: nextScheduledTime,
        status: 'active',
        snoozeUntil: undefined,
        completedAt: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'system',
        metadata: {
          ...reminder.metadata,
          parentReminderId: reminder.id,
          recurrenceInstance: (reminder.metadata.recurrenceInstance || 0) + 1
        }
      };

      await this.createReminder(nextReminder);

      console.log('Created next recurring reminder', {
        originalId: reminder.id,
        nextScheduledTime
      });

    } catch (error) {
      console.error('Failed to create next recurring reminder', {
        reminderId: reminder.id,
        error: error.message
      });
    }
  }

  private calculateNextOccurrence(
    currentTime: Date,
    recurrence: RecurrencePattern
  ): Date | null {
    const nextTime = new Date(currentTime);

    switch (recurrence.type) {
      case 'daily':
        nextTime.setDate(nextTime.getDate() + recurrence.interval);
        break;
      case 'weekly':
        nextTime.setDate(nextTime.getDate() + (recurrence.interval * 7));
        break;
      case 'monthly':
        nextTime.setMonth(nextTime.getMonth() + recurrence.interval);
        break;
      case 'yearly':
        nextTime.setFullYear(nextTime.getFullYear() + recurrence.interval);
        break;
      default:
        return null;
    }

    // Check if we've exceeded the end date or max occurrences
    if (recurrence.endDate && nextTime > recurrence.endDate) {
      return null;
    }

    return nextTime;
  }

  private async trackReminderEvent(
    reminderId: string,
    event: string,
    context: any
  ): Promise<void> {
    try {
      const analytics: ReminderAnalytics = {
        userId: '', // Will be filled from reminder
        reminderId,
        event: event as any,
        timestamp: new Date(),
        context
      };

      await this.databaseService.storeReminderAnalytics(analytics);

    } catch (error) {
      console.warn('Failed to track reminder event', {
        reminderId,
        event,
        error: error.message
      });
    }
  }

  private async updateUserReminderPatterns(reminder: Reminder): Promise<void> {
    // Update user's reminder patterns for learning
    try {
      const patterns = await this.databaseService.getUserReminderPatterns(reminder.userId);
      
      // Update patterns based on new reminder
      const updatedPatterns = {
        ...patterns,
        preferredCategories: this.updateCategoryPreferences(patterns.preferredCategories, reminder.category),
        preferredTimes: this.updateTimePreferences(patterns.preferredTimes, reminder.scheduledTime),
        preferredPriorities: this.updatePriorityPreferences(patterns.preferredPriorities, reminder.priority)
      };

      await this.databaseService.updateUserReminderPatterns(reminder.userId, updatedPatterns);

    } catch (error) {
      console.warn('Failed to update user reminder patterns', {
        userId: reminder.userId,
        error: error.message
      });
    }
  }

  private updateCategoryPreferences(current: any, category: string): any {
    return {
      ...current,
      [category]: (current[category] || 0) + 1
    };
  }

  private updateTimePreferences(current: any, scheduledTime: Date): any {
    const hour = scheduledTime.getHours();
    return {
      ...current,
      [hour]: (current[hour] || 0) + 1
    };
  }

  private updatePriorityPreferences(current: any, priority: string): any {
    return {
      ...current,
      [priority]: (current[priority] || 0) + 1
    };
  }

  private async analyzeUserReminderPatterns(userId: string): Promise<any> {
    // Analyze user's reminder patterns for smart suggestions
    try {
      const patterns = await this.databaseService.getUserReminderPatterns(userId);
      const recentReminders = await this.databaseService.getRecentReminders(userId, 30); // Last 30 days

      return {
        patterns,
        recentActivity: recentReminders,
        insights: this.generatePatternInsights(patterns, recentReminders)
      };

    } catch (error) {
      console.warn('Failed to analyze user reminder patterns', {
        userId,
        error: error.message
      });

      return { patterns: {}, recentActivity: [], insights: [] };
    }
  }

  private generatePatternInsights(patterns: any, recentReminders: Reminder[]): string[] {
    const insights = [];

    // Analyze completion rates
    const completedCount = recentReminders.filter(r => r.status === 'completed').length;
    const completionRate = recentReminders.length > 0 ? completedCount / recentReminders.length : 0;

    if (completionRate < 0.5) {
      insights.push('Consider reducing reminder frequency or adjusting timing');
    } else if (completionRate > 0.8) {
      insights.push('Great reminder completion rate! Consider adding more challenging goals');
    }

    // Analyze timing patterns
    const hourCounts = recentReminders.reduce((acc, r) => {
      const hour = r.scheduledTime.getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {});

    const bestHour = Object.keys(hourCounts).reduce((a, b) => 
      hourCounts[a] > hourCounts[b] ? a : b
    );

    if (bestHour) {
      insights.push(`You seem most responsive to reminders around ${bestHour}:00`);
    }

    return insights;
  }

  private async generateSmartSuggestions(userId: string, patterns: any): Promise<SmartSuggestion[]> {
    try {
      const suggestions: SmartSuggestion[] = [];

      // Generate AI-powered suggestions
      const suggestionPrompt = `Based on user reminder patterns, suggest helpful reminders:
      Patterns: ${JSON.stringify(patterns.insights)}
      Recent activity: ${patterns.recentActivity.length} reminders
      
      Suggest 3-5 specific, actionable reminders that would be helpful.`;

      const aiResponse = await this.aiService.generateResponse({
        prompt: suggestionPrompt,
        context: {
          userId,
          type: 'reminder_suggestions'
        }
      });

      // Parse AI suggestions (simplified)
      const aiSuggestions = this.parseAISuggestions(aiResponse.response);

      for (const suggestion of aiSuggestions) {
        suggestions.push({
          id: `suggestion-${userId}-${Date.now()}-${Math.random()}`,
          userId,
          type: 'reminder',
          suggestion: {
            title: suggestion.title,
            description: suggestion.description,
            confidence: aiResponse.confidence || 0.7,
            reasoning: suggestion.reasoning,
            suggestedReminder: suggestion.reminder
          },
          basedOn: {
            patterns: patterns.insights,
            data: patterns.patterns,
            timeframe: 'last_30_days'
          },
          status: 'pending',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });
      }

      return suggestions;

    } catch (error) {
      console.warn('Failed to generate smart suggestions', {
        userId,
        error: error.message
      });

      return [];
    }
  }

  private parseAISuggestions(aiResponse: string): any[] {
    // Simplified parsing - in reality would be more sophisticated
    return [
      {
        title: 'Daily reflection reminder',
        description: 'Take 5 minutes to reflect on your day',
        reasoning: 'Based on your goal completion patterns',
        reminder: {
          category: 'personal',
          priority: 'medium',
          recurrence: { type: 'daily', interval: 1 }
        }
      }
    ];
  }

  private async rankSuggestions(suggestions: SmartSuggestion[], patterns: any): Promise<SmartSuggestion[]> {
    // Rank suggestions based on relevance and user patterns
    return suggestions.sort((a, b) => b.suggestion.confidence - a.suggestion.confidence);
  }

  private async learnFromReminderCompletion(reminder: Reminder, effectiveness?: number): Promise<void> {
    try {
      // Learn from successful reminder completion
      const learningData = {
        reminderId: reminder.id,
        category: reminder.category,
        priority: reminder.priority,
        scheduledHour: reminder.scheduledTime.getHours(),
        dayOfWeek: reminder.scheduledTime.getDay(),
        effectiveness: effectiveness || 3,
        completedOnTime: new Date() <= reminder.scheduledTime
      };

      await this.databaseService.storeReminderLearning(reminder.userId, learningData);

    } catch (error) {
      console.warn('Failed to learn from reminder completion', {
        reminderId: reminder.id,
        error: error.message
      });
    }
  }
}

