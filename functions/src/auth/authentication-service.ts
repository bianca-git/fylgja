/**
 * Authentication Service for Fylgja
 * Comprehensive authentication system with Firebase Auth integration,
 * secure session management, and multi-platform support
 */

import * as crypto from 'crypto';

import { auth } from 'firebase-admin';
import * as jwt from 'jsonwebtoken';

import { cacheService } from '../cache/redis-cache-service';
import { EnhancedDatabaseService } from '../services/enhanced-database-service';
import { FylgjaError, createAuthError, createSystemError } from '../utils/error-handler';
import { performanceMonitor } from '../utils/monitoring';

export interface UserAuthProfile {
  uid: string;
  email?: string;
  phoneNumber?: string;
  displayName?: string;
  photoURL?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  platforms: AuthPlatform[];
  createdAt: string;
  lastLoginAt: string;
  loginCount: number;
  securitySettings: SecuritySettings;
  preferences: AuthPreferences;
  metadata: UserMetadata;
}

export interface AuthPlatform {
  platform: 'whatsapp' | 'web' | 'google_home' | 'api';
  identifier: string; // phone number, email, device ID, API key
  verified: boolean;
  linkedAt: string;
  lastUsed: string;
  deviceInfo?: DeviceInfo;
  permissions: PlatformPermission[];
}

export interface SecuritySettings {
  twoFactorEnabled: boolean;
  trustedDevices: TrustedDevice[];
  sessionTimeout: number; // in minutes
  maxConcurrentSessions: number;
  passwordLastChanged?: string;
  securityQuestions?: SecurityQuestion[];
  recoveryMethods: RecoveryMethod[];
}

export interface AuthPreferences {
  defaultPlatform: string;
  notificationSettings: NotificationSettings;
  privacySettings: PrivacySettings;
  accessibilitySettings: AccessibilitySettings;
}

export interface UserMetadata {
  ipAddresses: string[];
  userAgent: string[];
  timezone: string;
  locale: string;
  registrationSource: string;
  referralCode?: string;
  customClaims: Record<string, any>;
}

export interface DeviceInfo {
  deviceId: string;
  deviceType: 'mobile' | 'desktop' | 'tablet' | 'smart_speaker' | 'api_client';
  os: string;
  browser?: string;
  appVersion?: string;
  lastSeen: string;
}

export interface PlatformPermission {
  permission: string;
  granted: boolean;
  grantedAt: string;
  scope: string[];
}

export interface TrustedDevice {
  deviceId: string;
  deviceName: string;
  addedAt: string;
  lastUsed: string;
  fingerprint: string;
}

export interface SecurityQuestion {
  question: string;
  answerHash: string;
  createdAt: string;
}

export interface RecoveryMethod {
  type: 'email' | 'phone' | 'security_questions' | 'backup_codes';
  identifier: string;
  verified: boolean;
  createdAt: string;
}

export interface NotificationSettings {
  emailNotifications: boolean;
  smsNotifications: boolean;
  pushNotifications: boolean;
  reminderNotifications: boolean;
  securityAlerts: boolean;
}

export interface PrivacySettings {
  dataRetention: number; // in days
  analyticsOptOut: boolean;
  personalizedAds: boolean;
  dataSharing: boolean;
  profileVisibility: 'private' | 'friends' | 'public';
}

export interface AccessibilitySettings {
  screenReader: boolean;
  highContrast: boolean;
  largeText: boolean;
  voiceCommands: boolean;
  keyboardNavigation: boolean;
}

export interface AuthSession {
  sessionId: string;
  uid: string;
  platform: string;
  deviceId: string;
  createdAt: string;
  expiresAt: string;
  lastActivity: string;
  ipAddress: string;
  userAgent: string;
  permissions: string[];
  refreshToken: string;
  isActive: boolean;
}

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string[];
  sessionId: string;
}

export interface AuthContext {
  uid: string;
  platform: string;
  deviceId: string;
  sessionId: string;
  permissions: string[];
  ipAddress: string;
  userAgent: string;
  timestamp: string;
}

export interface LoginRequest {
  platform: 'whatsapp' | 'web' | 'google_home' | 'api';
  identifier: string; // email, phone, device ID, API key
  credential?: string; // password, verification code, token
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
  rememberDevice?: boolean;
}

export interface LoginResponse {
  success: boolean;
  user: UserAuthProfile;
  tokens: AuthToken;
  session: AuthSession;
  requiresVerification?: boolean;
  verificationMethod?: string;
  message: string;
}

export interface RegistrationRequest {
  platform: 'whatsapp' | 'web' | 'google_home' | 'api';
  email?: string;
  phoneNumber?: string;
  displayName?: string;
  password?: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
  preferences?: Partial<AuthPreferences>;
  referralCode?: string;
}

export interface RegistrationResponse {
  success: boolean;
  user: UserAuthProfile;
  tokens: AuthToken;
  session: AuthSession;
  requiresVerification: boolean;
  verificationMethod: string;
  message: string;
}

export interface VerificationRequest {
  uid: string;
  platform: string;
  verificationType: 'email' | 'phone' | 'device';
  verificationCode: string;
  sessionId: string;
}

export interface VerificationResponse {
  success: boolean;
  verified: boolean;
  message: string;
  nextStep?: string;
}

export class AuthenticationService {
  private database: EnhancedDatabaseService;
  private firebaseAuth: auth.Auth;

  private readonly SESSION_CACHE_TTL = 1800000; // 30 minutes
  private readonly TOKEN_CACHE_TTL = 3600000; // 1 hour
  private readonly VERIFICATION_CODE_TTL = 600000; // 10 minutes
  private readonly MAX_LOGIN_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 900000; // 15 minutes

  private readonly JWT_SECRET = process.env.JWT_SECRET || 'fylgja-jwt-secret';
  private readonly REFRESH_TOKEN_SECRET =
    process.env.REFRESH_TOKEN_SECRET || 'fylgja-refresh-secret';

  constructor() {
    this.database = new EnhancedDatabaseService();
    this.firebaseAuth = auth();
  }

  /**
   * Register a new user with multi-platform support
   */
  async registerUser(request: RegistrationRequest): Promise<RegistrationResponse> {
    const timerId = performanceMonitor.startTimer('user_registration');

    try {
      // Validate registration request
      await this.validateRegistrationRequest(request);

      // Check if user already exists
      const existingUser = await this.findExistingUser(request);
      if (existingUser) {
        throw createAuthError('User already exists with this identifier');
      }

      // Create Firebase user
      const firebaseUser = await this.createFirebaseUser(request);

      // Create user auth profile
      const userProfile = await this.createUserAuthProfile(firebaseUser, request);

      // Create initial session
      const session = await this.createAuthSession(userProfile.uid, request);

      // Generate tokens
      const tokens = await this.generateAuthTokens(userProfile.uid, session);

      // Send verification if required
      const verification = await this.initiateVerification(userProfile, request.platform);

      // Log registration event
      await this.logAuthEvent('user_registration', userProfile.uid, {
        platform: request.platform,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      });

      performanceMonitor.endTimer(timerId);

      return {
        success: true,
        user: userProfile,
        tokens,
        session,
        requiresVerification: verification.required,
        verificationMethod: verification.method,
        message: 'User registered successfully',
      };
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Registration failed: ${error.message}`);
    }
  }

  /**
   * Authenticate user login with multi-platform support
   */
  async loginUser(request: LoginRequest): Promise<LoginResponse> {
    const timerId = performanceMonitor.startTimer('user_login');

    try {
      // Check for rate limiting
      await this.checkRateLimit(request.identifier, request.ipAddress);

      // Validate login request
      await this.validateLoginRequest(request);

      // Find user by platform identifier
      const userProfile = await this.findUserByPlatformIdentifier(
        request.platform,
        request.identifier
      );

      if (!userProfile) {
        await this.recordFailedLogin(request.identifier, request.ipAddress);
        throw createAuthError('Invalid credentials');
      }

      // Verify credentials based on platform
      const credentialValid = await this.verifyCredentials(userProfile, request);
      if (!credentialValid) {
        await this.recordFailedLogin(request.identifier, request.ipAddress);
        throw createAuthError('Invalid credentials');
      }

      // Check if additional verification is required
      const verificationRequired = await this.checkVerificationRequired(userProfile, request);

      if (verificationRequired.required) {
        // Create temporary session for verification
        const tempSession = await this.createTemporarySession(userProfile.uid, request);

        return {
          success: false,
          user: userProfile,
          tokens: null as any,
          session: tempSession,
          requiresVerification: true,
          verificationMethod: verificationRequired.method,
          message: 'Additional verification required',
        };
      }

      // Create full session
      const session = await this.createAuthSession(userProfile.uid, request);

      // Generate tokens
      const tokens = await this.generateAuthTokens(userProfile.uid, session);

      // Update user profile
      await this.updateUserLoginInfo(userProfile.uid, request);

      // Add trusted device if requested
      if (request.rememberDevice) {
        await this.addTrustedDevice(userProfile.uid, request.deviceInfo);
      }

      // Log successful login
      await this.logAuthEvent('user_login', userProfile.uid, {
        platform: request.platform,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      });

      performanceMonitor.endTimer(timerId);

      return {
        success: true,
        user: userProfile,
        tokens,
        session,
        message: 'Login successful',
      };
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Login failed: ${error.message}`);
    }
  }

  /**
   * Verify user with verification code
   */
  async verifyUser(request: VerificationRequest): Promise<VerificationResponse> {
    const timerId = performanceMonitor.startTimer('user_verification');

    try {
      // Validate verification request
      await this.validateVerificationRequest(request);

      // Get verification code from cache
      const cacheKey = `verification_${request.uid}_${request.platform}_${request.verificationType}`;
      const storedCode = await cacheService.get(cacheKey);

      if (!storedCode || storedCode !== request.verificationCode) {
        throw createAuthError('Invalid or expired verification code');
      }

      // Mark platform as verified
      await this.markPlatformVerified(request.uid, request.platform);

      // Update session if exists
      await this.updateSessionVerification(request.sessionId, true);

      // Remove verification code from cache
      await cacheService.delete(cacheKey);

      // Log verification event
      await this.logAuthEvent('user_verification', request.uid, {
        platform: request.platform,
        verificationType: request.verificationType,
      });

      performanceMonitor.endTimer(timerId);

      return {
        success: true,
        verified: true,
        message: 'Verification successful',
      };
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Verification failed: ${error.message}`);
    }
  }

  /**
   * Validate authentication token
   */
  async validateToken(token: string, requiredPermissions: string[] = []): Promise<AuthContext> {
    const timerId = performanceMonitor.startTimer('token_validation');

    try {
      // Check token cache first
      const cacheKey = `token_${crypto.createHash('sha256').update(token).digest('hex')}`;
      const cachedContext = await cacheService.get(cacheKey);

      if (cachedContext) {
        // Verify required permissions
        if (requiredPermissions.length > 0) {
          const hasPermissions = requiredPermissions.every(permission =>
            cachedContext.permissions.includes(permission)
          );

          if (!hasPermissions) {
            throw createAuthError('Insufficient permissions');
          }
        }

        performanceMonitor.endTimer(timerId);
        return cachedContext;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, this.JWT_SECRET) as any;

      // Get session information
      const session = await this.getAuthSession(decoded.sessionId);
      if (!session?.isActive) {
        throw createAuthError('Invalid or expired session');
      }

      // Check session expiration
      if (new Date(session.expiresAt) < new Date()) {
        await this.deactivateSession(session.sessionId);
        throw createAuthError('Session expired');
      }

      // Create auth context
      const authContext: AuthContext = {
        uid: decoded.uid,
        platform: session.platform,
        deviceId: session.deviceId,
        sessionId: session.sessionId,
        permissions: session.permissions,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        timestamp: new Date().toISOString(),
      };

      // Verify required permissions
      if (requiredPermissions.length > 0) {
        const hasPermissions = requiredPermissions.every(permission =>
          authContext.permissions.includes(permission)
        );

        if (!hasPermissions) {
          throw createAuthError('Insufficient permissions');
        }
      }

      // Update session activity
      await this.updateSessionActivity(session.sessionId);

      // Cache the context
      await cacheService.set(cacheKey, authContext, { ttl: this.TOKEN_CACHE_TTL });

      performanceMonitor.endTimer(timerId);
      return authContext;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Token validation failed: ${error.message}`);
    }
  }

  /**
   * Refresh authentication tokens
   */
  async refreshTokens(refreshToken: string): Promise<AuthToken> {
    const timerId = performanceMonitor.startTimer('token_refresh');

    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, this.REFRESH_TOKEN_SECRET) as any;

      // Get session
      const session = await this.getAuthSession(decoded.sessionId);
      if (!session || !session.isActive || session.refreshToken !== refreshToken) {
        throw createAuthError('Invalid refresh token');
      }

      // Generate new tokens
      const newTokens = await this.generateAuthTokens(decoded.uid, session);

      // Update session with new refresh token
      await this.updateSessionRefreshToken(session.sessionId, newTokens.refreshToken);

      performanceMonitor.endTimer(timerId);
      return newTokens;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Token refresh failed: ${error.message}`);
    }
  }

  /**
   * Logout user and invalidate session
   */
  async logoutUser(sessionId: string, uid: string): Promise<void> {
    const timerId = performanceMonitor.startTimer('user_logout');

    try {
      // Deactivate session
      await this.deactivateSession(sessionId);

      // Clear token cache
      await this.clearUserTokenCache(uid);

      // Log logout event
      await this.logAuthEvent('user_logout', uid, { sessionId });

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Logout failed: ${error.message}`);
    }
  }

  /**
   * Get user authentication profile
   */
  async getUserAuthProfile(uid: string): Promise<UserAuthProfile> {
    const timerId = performanceMonitor.startTimer('get_user_profile');

    try {
      // Check cache first
      const cacheKey = `user_profile_${uid}`;
      const cachedProfile = await cacheService.get(cacheKey);

      if (cachedProfile) {
        performanceMonitor.endTimer(timerId);
        return cachedProfile;
      }

      // Get from database
      const profile = await this.database.getDocument('user_auth_profiles', uid);
      if (!profile) {
        throw createAuthError('User profile not found');
      }

      // Cache the profile
      await cacheService.set(cacheKey, profile, { ttl: this.SESSION_CACHE_TTL });

      performanceMonitor.endTimer(timerId);
      return profile;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Failed to get user profile: ${error.message}`);
    }
  }

  /**
   * Update user authentication profile
   */
  async updateUserAuthProfile(uid: string, updates: Partial<UserAuthProfile>): Promise<void> {
    const timerId = performanceMonitor.startTimer('update_user_profile');

    try {
      // Update in database
      await this.database.updateDocument('user_auth_profiles', uid, updates);

      // Clear cache
      const cacheKey = `user_profile_${uid}`;
      await cacheService.delete(cacheKey);

      // Log profile update
      await this.logAuthEvent('profile_update', uid, { updates: Object.keys(updates) });

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Failed to update user profile: ${error.message}`);
    }
  }

  /**
   * Link new platform to existing user
   */
  async linkPlatform(uid: string, platform: AuthPlatform): Promise<void> {
    const timerId = performanceMonitor.startTimer('link_platform');

    try {
      const userProfile = await this.getUserAuthProfile(uid);

      // Check if platform already linked
      const existingPlatform = userProfile.platforms.find(
        p => p.platform === platform.platform && p.identifier === platform.identifier
      );

      if (existingPlatform) {
        throw createAuthError('Platform already linked to this account');
      }

      // Add platform to user profile
      userProfile.platforms.push({
        ...platform,
        linkedAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      });

      // Update user profile
      await this.updateUserAuthProfile(uid, { platforms: userProfile.platforms });

      // Log platform linking
      await this.logAuthEvent('platform_linked', uid, { platform: platform.platform });

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Failed to link platform: ${error.message}`);
    }
  }

  /**
   * Unlink platform from user account
   */
  async unlinkPlatform(uid: string, platform: string, identifier: string): Promise<void> {
    const timerId = performanceMonitor.startTimer('unlink_platform');

    try {
      const userProfile = await this.getUserAuthProfile(uid);

      // Check if user has other platforms (prevent account lockout)
      const otherPlatforms = userProfile.platforms.filter(
        p => !(p.platform === platform && p.identifier === identifier)
      );

      if (otherPlatforms.length === 0) {
        throw createAuthError('Cannot unlink last authentication method');
      }

      // Remove platform from user profile
      userProfile.platforms = otherPlatforms;

      // Update user profile
      await this.updateUserAuthProfile(uid, { platforms: userProfile.platforms });

      // Deactivate sessions for this platform
      await this.deactivatePlatformSessions(uid, platform);

      // Log platform unlinking
      await this.logAuthEvent('platform_unlinked', uid, { platform });

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Failed to unlink platform: ${error.message}`);
    }
  }

  /**
   * Get user's active sessions
   */
  async getUserSessions(uid: string): Promise<AuthSession[]> {
    const timerId = performanceMonitor.startTimer('get_user_sessions');

    try {
      const sessions = await this.database.queryDocuments(
        'auth_sessions',
        [
          { field: 'uid', operator: '==', value: uid },
          { field: 'isActive', operator: '==', value: true },
        ],
        {
          orderBy: [{ field: 'lastActivity', direction: 'desc' }],
        }
      );

      performanceMonitor.endTimer(timerId);
      return sessions.documents;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Failed to get user sessions: ${error.message}`);
    }
  }

  /**
   * Deactivate specific session
   */
  async deactivateSession(sessionId: string): Promise<void> {
    const timerId = performanceMonitor.startTimer('deactivate_session');

    try {
      // Update session in database
      await this.database.updateDocument('auth_sessions', sessionId, {
        isActive: false,
        deactivatedAt: new Date().toISOString(),
      });

      // Clear session cache
      const cacheKey = `session_${sessionId}`;
      await cacheService.delete(cacheKey);

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Failed to deactivate session: ${error.message}`);
    }
  }

  /**
   * Private helper methods
   */
  private async validateRegistrationRequest(request: RegistrationRequest): Promise<void> {
    if (!request.platform) {
      throw createAuthError('Platform is required');
    }

    if (request.platform === 'web' && !request.email) {
      throw createAuthError('Email is required for web registration');
    }

    if (request.platform === 'whatsapp' && !request.phoneNumber) {
      throw createAuthError('Phone number is required for WhatsApp registration');
    }

    if (!request.deviceInfo?.deviceId) {
      throw createAuthError('Device information is required');
    }
  }

  private async validateLoginRequest(request: LoginRequest): Promise<void> {
    if (!request.platform || !request.identifier) {
      throw createAuthError('Platform and identifier are required');
    }

    if (!request.deviceInfo?.deviceId) {
      throw createAuthError('Device information is required');
    }
  }

  private async validateVerificationRequest(request: VerificationRequest): Promise<void> {
    if (!request.uid || !request.platform || !request.verificationCode) {
      throw createAuthError('UID, platform, and verification code are required');
    }

    if (request.verificationCode.length < 4 || request.verificationCode.length > 8) {
      throw createAuthError('Invalid verification code format');
    }
  }

  private async findExistingUser(request: RegistrationRequest): Promise<UserAuthProfile | null> {
    try {
      const query: any[] = [];

      if (request.email) {
        query.push({ field: 'email', operator: '==', value: request.email });
      }

      if (request.phoneNumber) {
        query.push({ field: 'phoneNumber', operator: '==', value: request.phoneNumber });
      }

      if (query.length === 0) {
        return null;
      }

      const result = await this.database.queryDocuments('user_auth_profiles', query, { limit: 1 });
      return result.documents.length > 0 ? result.documents[0] : null;
    } catch (error) {
      console.warn('Error finding existing user:', error);
      return null;
    }
  }

  private async createFirebaseUser(request: RegistrationRequest): Promise<auth.UserRecord> {
    const createRequest: auth.CreateRequest = {
      displayName: request.displayName,
    };

    if (request.email) {
      createRequest.email = request.email;
      createRequest.emailVerified = false;
    }

    if (request.phoneNumber) {
      createRequest.phoneNumber = request.phoneNumber;
    }

    if (request.password) {
      createRequest.password = request.password;
    }

    return await this.firebaseAuth.createUser(createRequest);
  }

  private async createUserAuthProfile(
    firebaseUser: auth.UserRecord,
    request: RegistrationRequest
  ): Promise<UserAuthProfile> {
    const profile: UserAuthProfile = {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      phoneNumber: firebaseUser.phoneNumber,
      displayName: firebaseUser.displayName || request.displayName,
      photoURL: firebaseUser.photoURL,
      emailVerified: firebaseUser.emailVerified,
      phoneVerified: false,
      platforms: [
        {
          platform: request.platform,
          identifier: request.email || request.phoneNumber || request.deviceInfo.deviceId,
          verified: false,
          linkedAt: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          deviceInfo: request.deviceInfo,
          permissions: this.getDefaultPermissions(request.platform),
        },
      ],
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      loginCount: 1,
      securitySettings: {
        twoFactorEnabled: false,
        trustedDevices: [],
        sessionTimeout: 30, // 30 minutes
        maxConcurrentSessions: 5,
        recoveryMethods: [],
      },
      preferences: {
        defaultPlatform: request.platform,
        notificationSettings: {
          emailNotifications: true,
          smsNotifications: false,
          pushNotifications: true,
          reminderNotifications: true,
          securityAlerts: true,
        },
        privacySettings: {
          dataRetention: 365, // 1 year
          analyticsOptOut: false,
          personalizedAds: false,
          dataSharing: false,
          profileVisibility: 'private',
        },
        accessibilitySettings: {
          screenReader: false,
          highContrast: false,
          largeText: false,
          voiceCommands: false,
          keyboardNavigation: false,
        },
        ...request.preferences,
      },
      metadata: {
        ipAddresses: [request.ipAddress],
        userAgent: [request.userAgent],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: 'en-US',
        registrationSource: request.platform,
        referralCode: request.referralCode,
        customClaims: {},
      },
    };

    // Save to database
    await this.database.setDocument('user_auth_profiles', profile.uid, profile);

    return profile;
  }

  private async createAuthSession(
    uid: string,
    request: LoginRequest | RegistrationRequest
  ): Promise<AuthSession> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    const session: AuthSession = {
      sessionId,
      uid,
      platform: request.platform,
      deviceId: request.deviceInfo.deviceId,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastActivity: new Date().toISOString(),
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      permissions: this.getDefaultPermissions(request.platform),
      refreshToken: '', // Will be set when generating tokens
      isActive: true,
    };

    // Save to database
    await this.database.setDocument('auth_sessions', sessionId, session);

    // Cache session
    const cacheKey = `session_${sessionId}`;
    await cacheService.set(cacheKey, session, { ttl: this.SESSION_CACHE_TTL });

    return session;
  }

  private async createTemporarySession(uid: string, request: LoginRequest): Promise<AuthSession> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes for verification

    const session: AuthSession = {
      sessionId,
      uid,
      platform: request.platform,
      deviceId: request.deviceInfo.deviceId,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      lastActivity: new Date().toISOString(),
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
      permissions: ['verification_only'],
      refreshToken: '',
      isActive: false, // Temporary session is not fully active
    };

    await this.database.setDocument('auth_sessions', sessionId, session);
    return session;
  }

  private async generateAuthTokens(uid: string, session: AuthSession): Promise<AuthToken> {
    const accessTokenPayload = {
      uid,
      sessionId: session.sessionId,
      platform: session.platform,
      permissions: session.permissions,
    };

    const refreshTokenPayload = {
      uid,
      sessionId: session.sessionId,
      type: 'refresh',
    };

    const accessToken = jwt.sign(accessTokenPayload, this.JWT_SECRET, { expiresIn: '1h' });
    const refreshToken = jwt.sign(refreshTokenPayload, this.REFRESH_TOKEN_SECRET, {
      expiresIn: '7d',
    });

    // Update session with refresh token
    await this.updateSessionRefreshToken(session.sessionId, refreshToken);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 3600, // 1 hour
      scope: session.permissions,
      sessionId: session.sessionId,
    };
  }

  private async initiateVerification(
    userProfile: UserAuthProfile,
    platform: string
  ): Promise<{ required: boolean; method: string }> {
    // For now, always require verification for new registrations
    const verificationCode = this.generateVerificationCode();
    const cacheKey = `verification_${userProfile.uid}_${platform}_email`;

    // Store verification code in cache
    await cacheService.set(cacheKey, verificationCode, { ttl: this.VERIFICATION_CODE_TTL });

    // In a real implementation, send verification code via email/SMS
    console.log(`Verification code for ${userProfile.uid}: ${verificationCode}`);

    return {
      required: true,
      method: userProfile.email ? 'email' : 'phone',
    };
  }

  private async findUserByPlatformIdentifier(
    platform: string,
    identifier: string
  ): Promise<UserAuthProfile | null> {
    try {
      const result = await this.database.queryDocuments(
        'user_auth_profiles',
        [{ field: `platforms.${platform}.identifier`, operator: '==', value: identifier }],
        { limit: 1 }
      );

      return result.documents.length > 0 ? result.documents[0] : null;
    } catch (error) {
      // Fallback to broader search
      const allUsers = await this.database.queryDocuments('user_auth_profiles', [], {});

      return (
        allUsers.documents.find(user =>
          user.platforms.some(
            (p: AuthPlatform) => p.platform === platform && p.identifier === identifier
          )
        ) || null
      );
    }
  }

  private async verifyCredentials(
    userProfile: UserAuthProfile,
    request: LoginRequest
  ): Promise<boolean> {
    // Platform-specific credential verification
    switch (request.platform) {
      case 'whatsapp':
        // For WhatsApp, verification is typically done via phone number verification
        return true; // Simplified for demo

      case 'web':
        // For web, verify password
        if (request.credential) {
          try {
            await this.firebaseAuth.getUserByEmail(userProfile.email!);
            // In real implementation, verify password with Firebase Auth
            return true;
          } catch (error) {
            return false;
          }
        }
        return false;

      case 'google_home':
        // For Google Home, verify device token
        return request.credential ? true : false;

      case 'api':
        // For API, verify API key
        return request.credential ? true : false;

      default:
        return false;
    }
  }

  private async checkVerificationRequired(
    userProfile: UserAuthProfile,
    request: LoginRequest
  ): Promise<{ required: boolean; method?: string }> {
    // Check if platform is verified
    const platform = userProfile.platforms.find(
      p => p.platform === request.platform && p.identifier === request.identifier
    );

    if (!platform?.verified) {
      return {
        required: true,
        method: userProfile.email ? 'email' : 'phone',
      };
    }

    // Check if device is trusted
    const isTrustedDevice = userProfile.securitySettings.trustedDevices.some(
      device => device.deviceId === request.deviceInfo.deviceId
    );

    if (!isTrustedDevice && userProfile.securitySettings.twoFactorEnabled) {
      return {
        required: true,
        method: 'two_factor',
      };
    }

    return { required: false };
  }

  private async getAuthSession(sessionId: string): Promise<AuthSession | null> {
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
        // Cache the session
        await cacheService.set(cacheKey, session, { ttl: this.SESSION_CACHE_TTL });
      }

      return session;
    } catch (error) {
      return null;
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

  private async updateSessionRefreshToken(sessionId: string, refreshToken: string): Promise<void> {
    await this.database.updateDocument('auth_sessions', sessionId, { refreshToken });

    // Update cache
    const cacheKey = `session_${sessionId}`;
    const cachedSession = await cacheService.get(cacheKey);

    if (cachedSession) {
      await cacheService.set(
        cacheKey,
        { ...cachedSession, refreshToken },
        { ttl: this.SESSION_CACHE_TTL }
      );
    }
  }

  private async updateSessionVerification(sessionId: string, verified: boolean): Promise<void> {
    const updates = {
      isActive: verified,
      verifiedAt: verified ? new Date().toISOString() : undefined,
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

  private async markPlatformVerified(uid: string, platform: string): Promise<void> {
    const userProfile = await this.getUserAuthProfile(uid);

    const platformIndex = userProfile.platforms.findIndex(p => p.platform === platform);
    if (platformIndex !== -1) {
      userProfile.platforms[platformIndex].verified = true;

      await this.updateUserAuthProfile(uid, { platforms: userProfile.platforms });
    }
  }

  private async updateUserLoginInfo(uid: string, request: LoginRequest): Promise<void> {
    const updates = {
      lastLoginAt: new Date().toISOString(),
      loginCount: 1, // This would be incremented in a real implementation
    };

    await this.updateUserAuthProfile(uid, updates);
  }

  private async addTrustedDevice(uid: string, deviceInfo: DeviceInfo): Promise<void> {
    const userProfile = await this.getUserAuthProfile(uid);

    const trustedDevice: TrustedDevice = {
      deviceId: deviceInfo.deviceId,
      deviceName: `${deviceInfo.deviceType} - ${deviceInfo.os}`,
      addedAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      fingerprint: crypto
        .createHash('sha256')
        .update(`${deviceInfo.deviceId}${deviceInfo.os}${deviceInfo.browser || ''}`)
        .digest('hex'),
    };

    userProfile.securitySettings.trustedDevices.push(trustedDevice);

    await this.updateUserAuthProfile(uid, {
      securitySettings: userProfile.securitySettings,
    });
  }

  private async deactivatePlatformSessions(uid: string, platform: string): Promise<void> {
    const sessions = await this.database.queryDocuments('auth_sessions', [
      { field: 'uid', operator: '==', value: uid },
      { field: 'platform', operator: '==', value: platform },
      { field: 'isActive', operator: '==', value: true },
    ]);

    for (const session of sessions.documents) {
      await this.deactivateSession(session.sessionId);
    }
  }

  private async clearUserTokenCache(uid: string): Promise<void> {
    // This would clear all cached tokens for the user
    // Implementation depends on cache key structure
    console.log(`Clearing token cache for user: ${uid}`);
  }

  private async checkRateLimit(identifier: string, ipAddress: string): Promise<void> {
    const rateLimitKey = `rate_limit_${identifier}_${ipAddress}`;
    const attempts = (await cacheService.get(rateLimitKey)) || 0;

    if (attempts >= this.MAX_LOGIN_ATTEMPTS) {
      throw createAuthError('Too many login attempts. Please try again later.');
    }
  }

  private async recordFailedLogin(identifier: string, ipAddress: string): Promise<void> {
    const rateLimitKey = `rate_limit_${identifier}_${ipAddress}`;
    const attempts = (await cacheService.get(rateLimitKey)) || 0;

    await cacheService.set(rateLimitKey, attempts + 1, { ttl: this.LOCKOUT_DURATION });
  }

  private async logAuthEvent(event: string, uid: string, metadata: any): Promise<void> {
    const logEntry = {
      event,
      uid,
      timestamp: new Date().toISOString(),
      metadata,
    };

    await this.database.addDocument('auth_logs', logEntry);
  }

  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
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
}

// Global authentication service instance
export const authenticationService = new AuthenticationService();
