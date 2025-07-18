/**
 * Session Manager for Fylgja
 * Advanced session management with multi-platform support,
 * security monitoring, and performance optimization
 */

import * as crypto from 'crypto';

import { cacheService } from '../cache/redis-cache-service';
import { EnhancedDatabaseService } from '../services/enhanced-database-service';
import { FylgjaError, createAuthError, createSystemError } from '../utils/error-handler';
import { performanceMonitor } from '../utils/monitoring';

import { AuthSession, AuthContext, DeviceInfo } from './authentication-service';

export interface SessionMetrics {
  sessionId: string;
  uid: string;
  platform: string;
  duration: number; // in milliseconds
  activityCount: number;
  lastActivity: string;
  dataTransferred: number; // in bytes
  requestCount: number;
  errorCount: number;
  averageResponseTime: number;
  peakConcurrency: number;
}

export interface SessionSecurity {
  sessionId: string;
  riskScore: number; // 0-1, higher is riskier
  securityEvents: SecurityEvent[];
  ipAddressChanges: number;
  userAgentChanges: number;
  suspiciousActivity: boolean;
  geoLocationChanges: number;
  deviceFingerprintChanges: number;
}

export interface SecurityEvent {
  type:
    | 'ip_change'
    | 'user_agent_change'
    | 'geo_change'
    | 'device_change'
    | 'suspicious_request'
    | 'rate_limit_exceeded';
  timestamp: string;
  details: Record<string, any>;
  severity: 'low' | 'medium' | 'high' | 'critical';
  resolved: boolean;
}

export interface SessionActivity {
  sessionId: string;
  timestamp: string;
  action: string;
  platform: string;
  endpoint?: string;
  requestSize?: number;
  responseSize?: number;
  responseTime?: number;
  success: boolean;
  errorCode?: string;
  metadata: Record<string, any>;
}

export interface SessionCleanupPolicy {
  maxInactiveDuration: number; // in milliseconds
  maxSessionDuration: number; // in milliseconds
  maxConcurrentSessions: number;
  cleanupInterval: number; // in milliseconds
  archiveExpiredSessions: boolean;
  notifyUserOnCleanup: boolean;
}

export interface PlatformSessionConfig {
  platform: 'whatsapp' | 'web' | 'google_home' | 'api';
  sessionTimeout: number; // in minutes
  maxConcurrentSessions: number;
  requiresDeviceVerification: boolean;
  allowsSessionExtension: boolean;
  securityLevel: 'low' | 'medium' | 'high';
  rateLimits: RateLimit[];
}

export interface RateLimit {
  action: string;
  maxRequests: number;
  windowSize: number; // in milliseconds
  blockDuration: number; // in milliseconds
}

export interface SessionExtensionRequest {
  sessionId: string;
  requestedDuration: number; // in minutes
  reason?: string;
  deviceVerification?: string;
}

export interface SessionTransferRequest {
  fromSessionId: string;
  toPlatform: string;
  deviceInfo: DeviceInfo;
  verificationCode?: string;
}

export class SessionManager {
  private database: EnhancedDatabaseService;

  private readonly SESSION_CACHE_TTL = 1800000; // 30 minutes
  private readonly METRICS_CACHE_TTL = 300000; // 5 minutes
  private readonly SECURITY_CACHE_TTL = 600000; // 10 minutes

  private readonly DEFAULT_CLEANUP_POLICY: SessionCleanupPolicy = {
    maxInactiveDuration: 1800000, // 30 minutes
    maxSessionDuration: 86400000, // 24 hours
    maxConcurrentSessions: 5,
    cleanupInterval: 300000, // 5 minutes
    archiveExpiredSessions: true,
    notifyUserOnCleanup: false,
  };

  private readonly PLATFORM_CONFIGS: Map<string, PlatformSessionConfig> = new Map([
    [
      'whatsapp',
      {
        platform: 'whatsapp',
        sessionTimeout: 60, // 1 hour
        maxConcurrentSessions: 3,
        requiresDeviceVerification: false,
        allowsSessionExtension: true,
        securityLevel: 'medium',
        rateLimits: [
          { action: 'message', maxRequests: 100, windowSize: 3600000, blockDuration: 300000 },
          { action: 'api_call', maxRequests: 1000, windowSize: 3600000, blockDuration: 600000 },
        ],
      },
    ],
    [
      'web',
      {
        platform: 'web',
        sessionTimeout: 30, // 30 minutes
        maxConcurrentSessions: 5,
        requiresDeviceVerification: true,
        allowsSessionExtension: true,
        securityLevel: 'high',
        rateLimits: [
          { action: 'login', maxRequests: 5, windowSize: 900000, blockDuration: 900000 },
          { action: 'api_call', maxRequests: 2000, windowSize: 3600000, blockDuration: 300000 },
        ],
      },
    ],
    [
      'google_home',
      {
        platform: 'google_home',
        sessionTimeout: 120, // 2 hours
        maxConcurrentSessions: 2,
        requiresDeviceVerification: true,
        allowsSessionExtension: false,
        securityLevel: 'medium',
        rateLimits: [
          { action: 'voice_command', maxRequests: 200, windowSize: 3600000, blockDuration: 300000 },
          { action: 'api_call', maxRequests: 500, windowSize: 3600000, blockDuration: 600000 },
        ],
      },
    ],
    [
      'api',
      {
        platform: 'api',
        sessionTimeout: 240, // 4 hours
        maxConcurrentSessions: 10,
        requiresDeviceVerification: false,
        allowsSessionExtension: true,
        securityLevel: 'low',
        rateLimits: [
          { action: 'api_call', maxRequests: 10000, windowSize: 3600000, blockDuration: 300000 },
          {
            action: 'bulk_operation',
            maxRequests: 100,
            windowSize: 3600000,
            blockDuration: 1800000,
          },
        ],
      },
    ],
  ]);

  constructor() {
    this.database = new EnhancedDatabaseService();
    this.startCleanupScheduler();
  }

  /**
   * Create a new session with platform-specific configuration
   */
  async createSession(
    uid: string,
    platform: string,
    deviceInfo: DeviceInfo,
    ipAddress: string,
    userAgent: string
  ): Promise<AuthSession> {
    const timerId = performanceMonitor.startTimer('create_session');

    try {
      const config = this.PLATFORM_CONFIGS.get(platform);
      if (!config) {
        throw createAuthError(`Unsupported platform: ${platform}`);
      }

      // Check concurrent session limits
      await this.enforceSessionLimits(uid, platform, config.maxConcurrentSessions);

      // Generate session
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + config.sessionTimeout * 60 * 1000);

      const session: AuthSession = {
        sessionId,
        uid,
        platform,
        deviceId: deviceInfo.deviceId,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastActivity: new Date().toISOString(),
        ipAddress,
        userAgent,
        permissions: this.getDefaultPermissions(platform),
        refreshToken: '',
        isActive: true,
      };

      // Save session to database
      await this.database.setDocument('auth_sessions', sessionId, session);

      // Cache session
      await this.cacheSession(session);

      // Initialize session metrics
      await this.initializeSessionMetrics(session);

      // Initialize session security
      await this.initializeSessionSecurity(session);

      // Log session creation
      await this.logSessionActivity(sessionId, 'session_created', platform, {
        deviceInfo,
        ipAddress,
        userAgent,
      });

      performanceMonitor.endTimer(timerId);
      return session;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Failed to create session: ${error.message}`);
    }
  }

  /**
   * Validate session and update activity
   */
  async validateSession(sessionId: string, updateActivity = true): Promise<AuthSession> {
    const timerId = performanceMonitor.startTimer('validate_session');

    try {
      // Get session from cache or database
      const session = await this.getSession(sessionId);
      if (!session) {
        throw createAuthError('Session not found');
      }

      // Check if session is active
      if (!session.isActive) {
        throw createAuthError('Session is not active');
      }

      // Check if session has expired
      if (new Date(session.expiresAt) < new Date()) {
        await this.deactivateSession(sessionId, 'expired');
        throw createAuthError('Session has expired');
      }

      // Update activity if requested
      if (updateActivity) {
        await this.updateSessionActivity(sessionId);
      }

      // Check security status
      await this.checkSessionSecurity(sessionId);

      performanceMonitor.endTimer(timerId);
      return session;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Session validation failed: ${error.message}`);
    }
  }

  /**
   * Extend session duration
   */
  async extendSession(request: SessionExtensionRequest): Promise<AuthSession> {
    const timerId = performanceMonitor.startTimer('extend_session');

    try {
      const session = await this.getSession(request.sessionId);
      if (!session) {
        throw createAuthError('Session not found');
      }

      const config = this.PLATFORM_CONFIGS.get(session.platform);
      if (!config?.allowsSessionExtension) {
        throw createAuthError('Session extension not allowed for this platform');
      }

      // Verify device if required
      if (config.requiresDeviceVerification && !request.deviceVerification) {
        throw createAuthError('Device verification required for session extension');
      }

      // Calculate new expiration time
      const maxExtension = config.sessionTimeout * 60 * 1000; // Convert to milliseconds
      const requestedExtension = Math.min(request.requestedDuration * 60 * 1000, maxExtension);
      const newExpiresAt = new Date(Date.now() + requestedExtension);

      // Update session
      const updates = {
        expiresAt: newExpiresAt.toISOString(),
        lastActivity: new Date().toISOString(),
      };

      await this.database.updateDocument('auth_sessions', request.sessionId, updates);

      // Update cache
      const updatedSession = { ...session, ...updates };
      await this.cacheSession(updatedSession);

      // Log extension
      await this.logSessionActivity(request.sessionId, 'session_extended', session.platform, {
        originalExpiry: session.expiresAt,
        newExpiry: newExpiresAt.toISOString(),
        requestedDuration: request.requestedDuration,
        reason: request.reason,
      });

      performanceMonitor.endTimer(timerId);
      return updatedSession;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Failed to extend session: ${error.message}`);
    }
  }

  /**
   * Transfer session to different platform
   */
  async transferSession(request: SessionTransferRequest): Promise<AuthSession> {
    const timerId = performanceMonitor.startTimer('transfer_session');

    try {
      const originalSession = await this.getSession(request.fromSessionId);
      if (!originalSession) {
        throw createAuthError('Original session not found');
      }

      // Verify transfer is allowed
      if (request.verificationCode) {
        const isValid = await this.verifyTransferCode(
          originalSession.uid,
          request.verificationCode
        );
        if (!isValid) {
          throw createAuthError('Invalid transfer verification code');
        }
      }

      // Create new session on target platform
      const newSession = await this.createSession(
        originalSession.uid,
        request.toPlatform,
        request.deviceInfo,
        originalSession.ipAddress,
        originalSession.userAgent
      );

      // Transfer session data
      await this.transferSessionData(originalSession, newSession);

      // Deactivate original session
      await this.deactivateSession(request.fromSessionId, 'transferred');

      // Log transfer
      await this.logSessionActivity(
        newSession.sessionId,
        'session_transferred',
        request.toPlatform,
        {
          fromPlatform: originalSession.platform,
          fromSessionId: request.fromSessionId,
          transferTime: new Date().toISOString(),
        }
      );

      performanceMonitor.endTimer(timerId);
      return newSession;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Failed to transfer session: ${error.message}`);
    }
  }

  /**
   * Get session metrics
   */
  async getSessionMetrics(sessionId: string): Promise<SessionMetrics> {
    const timerId = performanceMonitor.startTimer('get_session_metrics');

    try {
      // Check cache first
      const cacheKey = `session_metrics_${sessionId}`;
      const cachedMetrics = await cacheService.get(cacheKey);

      if (cachedMetrics) {
        performanceMonitor.endTimer(timerId);
        return cachedMetrics;
      }

      // Calculate metrics from database
      const metrics = await this.calculateSessionMetrics(sessionId);

      // Cache metrics
      await cacheService.set(cacheKey, metrics, { ttl: this.METRICS_CACHE_TTL });

      performanceMonitor.endTimer(timerId);
      return metrics;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Failed to get session metrics: ${error.message}`);
    }
  }

  /**
   * Get session security status
   */
  async getSessionSecurity(sessionId: string): Promise<SessionSecurity> {
    const timerId = performanceMonitor.startTimer('get_session_security');

    try {
      // Check cache first
      const cacheKey = `session_security_${sessionId}`;
      const cachedSecurity = await cacheService.get(cacheKey);

      if (cachedSecurity) {
        performanceMonitor.endTimer(timerId);
        return cachedSecurity;
      }

      // Calculate security status
      const security = await this.calculateSessionSecurity(sessionId);

      // Cache security status
      await cacheService.set(cacheKey, security, { ttl: this.SECURITY_CACHE_TTL });

      performanceMonitor.endTimer(timerId);
      return security;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Failed to get session security: ${error.message}`);
    }
  }

  /**
   * Get user's active sessions
   */
  async getUserSessions(uid: string, platform?: string): Promise<AuthSession[]> {
    const timerId = performanceMonitor.startTimer('get_user_sessions');

    try {
      const query: any[] = [
        { field: 'uid', operator: '==', value: uid },
        { field: 'isActive', operator: '==', value: true },
      ];

      if (platform) {
        query.push({ field: 'platform', operator: '==', value: platform });
      }

      const result = await this.database.queryDocuments('auth_sessions', query, {
        orderBy: [{ field: 'lastActivity', direction: 'desc' }],
      });

      performanceMonitor.endTimer(timerId);
      return result.documents;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Failed to get user sessions: ${error.message}`);
    }
  }

  /**
   * Deactivate session
   */
  async deactivateSession(sessionId: string, reason = 'manual'): Promise<void> {
    const timerId = performanceMonitor.startTimer('deactivate_session');

    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return; // Session doesn't exist, nothing to deactivate
      }

      // Update session in database
      const updates = {
        isActive: false,
        deactivatedAt: new Date().toISOString(),
        deactivationReason: reason,
      };

      await this.database.updateDocument('auth_sessions', sessionId, updates);

      // Remove from cache
      const cacheKey = `session_${sessionId}`;
      await cacheService.delete(cacheKey);

      // Archive session metrics
      await this.archiveSessionMetrics(sessionId);

      // Log deactivation
      await this.logSessionActivity(sessionId, 'session_deactivated', session.platform, {
        reason,
        duration: Date.now() - new Date(session.createdAt).getTime(),
      });

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Failed to deactivate session: ${error.message}`);
    }
  }

  /**
   * Deactivate all user sessions
   */
  async deactivateAllUserSessions(uid: string, exceptSessionId?: string): Promise<void> {
    const timerId = performanceMonitor.startTimer('deactivate_all_user_sessions');

    try {
      const sessions = await this.getUserSessions(uid);

      for (const session of sessions) {
        if (session.sessionId !== exceptSessionId) {
          await this.deactivateSession(session.sessionId, 'user_logout_all');
        }
      }

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Failed to deactivate all user sessions: ${error.message}`);
    }
  }

  /**
   * Check rate limits for session
   */
  async checkRateLimit(sessionId: string, action: string): Promise<boolean> {
    const timerId = performanceMonitor.startTimer('check_rate_limit');

    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        throw createAuthError('Session not found');
      }

      const config = this.PLATFORM_CONFIGS.get(session.platform);
      if (!config) {
        return true; // No rate limits configured
      }

      const rateLimit = config.rateLimits.find(rl => rl.action === action);
      if (!rateLimit) {
        return true; // No rate limit for this action
      }

      // Check current usage
      const rateLimitKey = `rate_limit_${sessionId}_${action}`;
      const currentCount = (await cacheService.get(rateLimitKey)) || 0;

      if (currentCount >= rateLimit.maxRequests) {
        // Rate limit exceeded
        await this.recordSecurityEvent(sessionId, {
          type: 'rate_limit_exceeded',
          timestamp: new Date().toISOString(),
          details: { action, currentCount, maxRequests: rateLimit.maxRequests },
          severity: 'medium',
          resolved: false,
        });

        performanceMonitor.endTimer(timerId);
        return false;
      }

      // Increment counter
      await cacheService.set(rateLimitKey, currentCount + 1, { ttl: rateLimit.windowSize });

      performanceMonitor.endTimer(timerId);
      return true;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Failed to check rate limit: ${error.message}`);
    }
  }

  /**
   * Record session activity
   */
  async recordActivity(
    sessionId: string,
    action: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const timerId = performanceMonitor.startTimer('record_activity');

    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return; // Session doesn't exist
      }

      const activity: SessionActivity = {
        sessionId,
        timestamp: new Date().toISOString(),
        action,
        platform: session.platform,
        success: true,
        metadata,
      };

      // Save activity
      await this.database.addDocument('session_activities', activity);

      // Update session metrics
      await this.updateSessionMetrics(sessionId, activity);

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      console.warn('Failed to record session activity:', error);
    }
  }

  /**
   * Private helper methods
   */
  private async getSession(sessionId: string): Promise<AuthSession | null> {
    // Check cache first
    const cacheKey = `session_${sessionId}`;
    const cachedSession = await cacheService.get(cacheKey);

    if (cachedSession) {
      return cachedSession;
    }

    // Get from database
    try {
      const session = await this.database.getDocument('auth_sessions', sessionId);

      if (session) {
        await this.cacheSession(session);
      }

      return session;
    } catch (error) {
      return null;
    }
  }

  private async cacheSession(session: AuthSession): Promise<void> {
    const cacheKey = `session_${session.sessionId}`;
    await cacheService.set(cacheKey, session, { ttl: this.SESSION_CACHE_TTL });
  }

  private async enforceSessionLimits(
    uid: string,
    platform: string,
    maxConcurrentSessions: number
  ): Promise<void> {
    const activeSessions = await this.getUserSessions(uid, platform);

    if (activeSessions.length >= maxConcurrentSessions) {
      // Deactivate oldest session
      const oldestSession = activeSessions.sort(
        (a, b) => new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime()
      )[0];

      await this.deactivateSession(oldestSession.sessionId, 'session_limit_exceeded');
    }
  }

  private async updateSessionActivity(sessionId: string): Promise<void> {
    const updates = {
      lastActivity: new Date().toISOString(),
    };

    await this.database.updateDocument('auth_sessions', sessionId, updates);

    // Update cache
    const cacheKey = `session_${sessionId}`;
    const cachedSession = await cacheService.get(cacheKey);

    if (cachedSession) {
      await cacheService.set(
        cacheKey,
        { ...cachedSession, ...updates },
        { ttl: this.SESSION_CACHE_TTL }
      );
    }
  }

  private async initializeSessionMetrics(session: AuthSession): Promise<void> {
    const metrics: SessionMetrics = {
      sessionId: session.sessionId,
      uid: session.uid,
      platform: session.platform,
      duration: 0,
      activityCount: 0,
      lastActivity: session.createdAt,
      dataTransferred: 0,
      requestCount: 0,
      errorCount: 0,
      averageResponseTime: 0,
      peakConcurrency: 1,
    };

    await this.database.setDocument('session_metrics', session.sessionId, metrics);
  }

  private async initializeSessionSecurity(session: AuthSession): Promise<void> {
    const security: SessionSecurity = {
      sessionId: session.sessionId,
      riskScore: 0.0,
      securityEvents: [],
      ipAddressChanges: 0,
      userAgentChanges: 0,
      suspiciousActivity: false,
      geoLocationChanges: 0,
      deviceFingerprintChanges: 0,
    };

    await this.database.setDocument('session_security', session.sessionId, security);
  }

  private async calculateSessionMetrics(sessionId: string): Promise<SessionMetrics> {
    // Get session
    const session = await this.getSession(sessionId);
    if (!session) {
      throw createSystemError('Session not found for metrics calculation');
    }

    // Get activities
    const activities = await this.database.queryDocuments(
      'session_activities',
      [{ field: 'sessionId', operator: '==', value: sessionId }],
      {
        orderBy: [{ field: 'timestamp', direction: 'asc' }],
      }
    );

    // Calculate metrics
    const duration = Date.now() - new Date(session.createdAt).getTime();
    const activityCount = activities.documents.length;
    const dataTransferred = activities.documents.reduce(
      (sum, activity) => sum + (activity.requestSize || 0) + (activity.responseSize || 0),
      0
    );
    const requestCount = activities.documents.length;
    const errorCount = activities.documents.filter(activity => !activity.success).length;
    const responseTimes = activities.documents
      .filter(activity => activity.responseTime)
      .map(activity => activity.responseTime);
    const averageResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
        : 0;

    return {
      sessionId,
      uid: session.uid,
      platform: session.platform,
      duration,
      activityCount,
      lastActivity: session.lastActivity,
      dataTransferred,
      requestCount,
      errorCount,
      averageResponseTime,
      peakConcurrency: 1, // This would be calculated from concurrent request tracking
    };
  }

  private async calculateSessionSecurity(sessionId: string): Promise<SessionSecurity> {
    // Get existing security record
    const existingSecurity = await this.database.getDocument('session_security', sessionId);

    if (existingSecurity) {
      return existingSecurity;
    }

    // Initialize if not exists
    return {
      sessionId,
      riskScore: 0.0,
      securityEvents: [],
      ipAddressChanges: 0,
      userAgentChanges: 0,
      suspiciousActivity: false,
      geoLocationChanges: 0,
      deviceFingerprintChanges: 0,
    };
  }

  private async checkSessionSecurity(sessionId: string): Promise<void> {
    const security = await this.getSessionSecurity(sessionId);

    // Check for high risk score
    if (security.riskScore > 0.7) {
      await this.deactivateSession(sessionId, 'high_security_risk');
      throw createAuthError('Session deactivated due to security concerns');
    }

    // Check for critical security events
    const criticalEvents = security.securityEvents.filter(
      event => event.severity === 'critical' && !event.resolved
    );

    if (criticalEvents.length > 0) {
      await this.deactivateSession(sessionId, 'critical_security_event');
      throw createAuthError('Session deactivated due to critical security event');
    }
  }

  private async recordSecurityEvent(sessionId: string, event: SecurityEvent): Promise<void> {
    const security = await this.getSessionSecurity(sessionId);

    security.securityEvents.push(event);

    // Update risk score based on event
    switch (event.severity) {
      case 'low':
        security.riskScore += 0.1;
        break;
      case 'medium':
        security.riskScore += 0.2;
        break;
      case 'high':
        security.riskScore += 0.4;
        break;
      case 'critical':
        security.riskScore += 0.8;
        break;
    }

    // Cap risk score at 1.0
    security.riskScore = Math.min(security.riskScore, 1.0);

    // Update database
    await this.database.updateDocument('session_security', sessionId, security);

    // Clear cache
    const cacheKey = `session_security_${sessionId}`;
    await cacheService.delete(cacheKey);
  }

  private async updateSessionMetrics(sessionId: string, activity: SessionActivity): Promise<void> {
    const metrics = await this.getSessionMetrics(sessionId);

    metrics.activityCount += 1;
    metrics.requestCount += 1;
    metrics.lastActivity = activity.timestamp;

    if (!activity.success) {
      metrics.errorCount += 1;
    }

    if (activity.responseTime) {
      const totalResponseTime = metrics.averageResponseTime * (metrics.requestCount - 1);
      metrics.averageResponseTime =
        (totalResponseTime + activity.responseTime) / metrics.requestCount;
    }

    if (activity.requestSize) {
      metrics.dataTransferred += activity.requestSize;
    }

    if (activity.responseSize) {
      metrics.dataTransferred += activity.responseSize;
    }

    // Update database
    await this.database.updateDocument('session_metrics', sessionId, metrics);

    // Clear cache
    const cacheKey = `session_metrics_${sessionId}`;
    await cacheService.delete(cacheKey);
  }

  private async archiveSessionMetrics(sessionId: string): Promise<void> {
    try {
      const metrics = await this.getSessionMetrics(sessionId);

      // Move to archived metrics collection
      await this.database.addDocument('archived_session_metrics', {
        ...metrics,
        archivedAt: new Date().toISOString(),
      });

      // Remove from active metrics
      await this.database.deleteDocument('session_metrics', sessionId);
    } catch (error) {
      console.warn('Failed to archive session metrics:', error);
    }
  }

  private async logSessionActivity(
    sessionId: string,
    action: string,
    platform: string,
    metadata: Record<string, any>
  ): Promise<void> {
    const activity: SessionActivity = {
      sessionId,
      timestamp: new Date().toISOString(),
      action,
      platform,
      success: true,
      metadata,
    };

    await this.database.addDocument('session_activities', activity);
  }

  private async verifyTransferCode(uid: string, code: string): Promise<boolean> {
    const cacheKey = `transfer_code_${uid}`;
    const storedCode = await cacheService.get(cacheKey);

    return storedCode === code;
  }

  private async transferSessionData(
    fromSession: AuthSession,
    toSession: AuthSession
  ): Promise<void> {
    // Transfer relevant session data
    // This could include user preferences, temporary data, etc.
    console.log(
      `Transferring session data from ${fromSession.sessionId} to ${toSession.sessionId}`
    );
  }

  private getDefaultPermissions(platform: string): string[] {
    const basePermissions = ['read_profile', 'update_profile'];

    switch (platform) {
      case 'whatsapp':
        return [...basePermissions, 'send_messages', 'receive_messages'];
      case 'web':
        return [...basePermissions, 'full_access'];
      case 'google_home':
        return [...basePermissions, 'voice_commands', 'audio_responses'];
      case 'api':
        return [...basePermissions, 'api_access'];
      default:
        return basePermissions;
    }
  }

  private startCleanupScheduler(): void {
    setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error) {
        console.error('Session cleanup failed:', error);
      }
    }, this.DEFAULT_CLEANUP_POLICY.cleanupInterval);
  }

  private async cleanupExpiredSessions(): Promise<void> {
    const timerId = performanceMonitor.startTimer('cleanup_expired_sessions');

    try {
      const expiredSessions = await this.database.queryDocuments('auth_sessions', [
        { field: 'isActive', operator: '==', value: true },
        { field: 'expiresAt', operator: '<', value: new Date().toISOString() },
      ]);

      for (const session of expiredSessions.documents) {
        await this.deactivateSession(session.sessionId, 'expired');
      }

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      console.error('Failed to cleanup expired sessions:', error);
    }
  }
}

// Global session manager instance
export const sessionManager = new SessionManager();
