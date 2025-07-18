/**
 * Multi-Platform Authentication Integration
 * Unified authentication layer supporting WhatsApp, Web, Google Home, and API access
 */

import * as crypto from 'crypto';

import { cacheService } from '../cache/redis-cache-service';
import { FylgjaError, createAuthError, createSystemError } from '../utils/error-handler';
import { performanceMonitor } from '../utils/monitoring';

import {
  AuthenticationService,
  LoginRequest,
  RegistrationRequest,
  DeviceInfo,
} from './authentication-service';
import { SessionManager } from './session-manager';

export interface PlatformAuthConfig {
  platform: 'whatsapp' | 'web' | 'google_home' | 'api';
  authMethod: 'phone_verification' | 'email_password' | 'oauth' | 'api_key' | 'device_token';
  requiresVerification: boolean;
  verificationMethod: 'sms' | 'email' | 'push' | 'voice' | 'none';
  sessionDuration: number; // in minutes
  allowsRegistration: boolean;
  requiresDeviceRegistration: boolean;
  supportedFeatures: string[];
}

export interface WhatsAppAuthRequest {
  phoneNumber: string;
  verificationCode?: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
}

export interface WebAuthRequest {
  email: string;
  password?: string;
  oauthToken?: string;
  oauthProvider?: 'google' | 'facebook' | 'apple';
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
  rememberDevice?: boolean;
}

export interface GoogleHomeAuthRequest {
  deviceId: string;
  deviceToken: string;
  googleAccountId?: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
}

export interface APIAuthRequest {
  apiKey: string;
  clientId: string;
  clientSecret?: string;
  scope: string[];
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
}

export interface PlatformAuthResponse {
  success: boolean;
  platform: string;
  authMethod: string;
  user: any;
  tokens: any;
  session: any;
  requiresAdditionalAuth?: boolean;
  nextStep?: string;
  message: string;
}

export class MultiPlatformAuth {
  private authService: AuthenticationService;
  private sessionManager: SessionManager;

  private readonly PLATFORM_CONFIGS: Map<string, PlatformAuthConfig> = new Map([
    [
      'whatsapp',
      {
        platform: 'whatsapp',
        authMethod: 'phone_verification',
        requiresVerification: true,
        verificationMethod: 'sms',
        sessionDuration: 60, // 1 hour
        allowsRegistration: true,
        requiresDeviceRegistration: false,
        supportedFeatures: ['messaging', 'voice_notes', 'media_sharing', 'reminders'],
      },
    ],
    [
      'web',
      {
        platform: 'web',
        authMethod: 'email_password',
        requiresVerification: true,
        verificationMethod: 'email',
        sessionDuration: 30, // 30 minutes
        allowsRegistration: true,
        requiresDeviceRegistration: true,
        supportedFeatures: [
          'full_dashboard',
          'data_export',
          'advanced_settings',
          'legacy_management',
        ],
      },
    ],
    [
      'google_home',
      {
        platform: 'google_home',
        authMethod: 'device_token',
        requiresVerification: true,
        verificationMethod: 'voice',
        sessionDuration: 120, // 2 hours
        allowsRegistration: false, // Must register via web first
        requiresDeviceRegistration: true,
        supportedFeatures: ['voice_commands', 'audio_responses', 'smart_home_integration'],
      },
    ],
    [
      'api',
      {
        platform: 'api',
        authMethod: 'api_key',
        requiresVerification: false,
        verificationMethod: 'none',
        sessionDuration: 240, // 4 hours
        allowsRegistration: false, // API keys generated via web
        requiresDeviceRegistration: false,
        supportedFeatures: ['data_access', 'automation', 'integrations', 'webhooks'],
      },
    ],
  ]);

  constructor() {
    this.authService = new AuthenticationService();
    this.sessionManager = new SessionManager();
  }

  /**
   * Authenticate WhatsApp user
   */
  async authenticateWhatsApp(request: WhatsAppAuthRequest): Promise<PlatformAuthResponse> {
    const timerId = performanceMonitor.startTimer('whatsapp_auth');

    try {
      const config = this.PLATFORM_CONFIGS.get('whatsapp')!;

      // Check if this is registration or login
      const existingUser = await this.findUserByPhone(request.phoneNumber);

      if (!existingUser) {
        // Registration flow
        if (!config.allowsRegistration) {
          throw createAuthError('Registration not allowed for WhatsApp platform');
        }

        if (!request.verificationCode) {
          // Send verification code
          await this.sendWhatsAppVerification(request.phoneNumber);

          return {
            success: false,
            platform: 'whatsapp',
            authMethod: 'phone_verification',
            user: null,
            tokens: null,
            session: null,
            requiresAdditionalAuth: true,
            nextStep: 'verification_code',
            message: 'Verification code sent to your WhatsApp number',
          };
        }

        // Verify code and register
        const isValidCode = await this.verifyWhatsAppCode(
          request.phoneNumber,
          request.verificationCode
        );
        if (!isValidCode) {
          throw createAuthError('Invalid verification code');
        }

        const registrationRequest: RegistrationRequest = {
          platform: 'whatsapp',
          phoneNumber: request.phoneNumber,
          deviceInfo: request.deviceInfo,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
        };

        const registrationResult = await this.authService.registerUser(registrationRequest);

        performanceMonitor.endTimer(timerId);
        return {
          success: true,
          platform: 'whatsapp',
          authMethod: 'phone_verification',
          user: registrationResult.user,
          tokens: registrationResult.tokens,
          session: registrationResult.session,
          message: 'WhatsApp registration successful',
        };
      } else {
        // Login flow
        if (!request.verificationCode) {
          // Send verification code for login
          await this.sendWhatsAppVerification(request.phoneNumber);

          return {
            success: false,
            platform: 'whatsapp',
            authMethod: 'phone_verification',
            user: null,
            tokens: null,
            session: null,
            requiresAdditionalAuth: true,
            nextStep: 'verification_code',
            message: 'Verification code sent to your WhatsApp number',
          };
        }

        // Verify code and login
        const isValidCode = await this.verifyWhatsAppCode(
          request.phoneNumber,
          request.verificationCode
        );
        if (!isValidCode) {
          throw createAuthError('Invalid verification code');
        }

        const loginRequest: LoginRequest = {
          platform: 'whatsapp',
          identifier: request.phoneNumber,
          credential: request.verificationCode,
          deviceInfo: request.deviceInfo,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
        };

        const loginResult = await this.authService.loginUser(loginRequest);

        performanceMonitor.endTimer(timerId);
        return {
          success: true,
          platform: 'whatsapp',
          authMethod: 'phone_verification',
          user: loginResult.user,
          tokens: loginResult.tokens,
          session: loginResult.session,
          message: 'WhatsApp login successful',
        };
      }
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`WhatsApp authentication failed: ${error.message}`);
    }
  }

  /**
   * Authenticate Web user
   */
  async authenticateWeb(request: WebAuthRequest): Promise<PlatformAuthResponse> {
    const timerId = performanceMonitor.startTimer('web_auth');

    try {
      const config = this.PLATFORM_CONFIGS.get('web')!;

      if (request.oauthToken && request.oauthProvider) {
        // OAuth authentication
        return await this.authenticateWebOAuth(request);
      } else if (request.email && request.password) {
        // Email/password authentication
        return await this.authenticateWebEmailPassword(request);
      } else {
        throw createAuthError('Invalid web authentication request');
      }
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Web authentication failed: ${error.message}`);
    }
  }

  /**
   * Authenticate Google Home user
   */
  async authenticateGoogleHome(request: GoogleHomeAuthRequest): Promise<PlatformAuthResponse> {
    const timerId = performanceMonitor.startTimer('google_home_auth');

    try {
      const config = this.PLATFORM_CONFIGS.get('google_home')!;

      // Verify device token with Google
      const isValidToken = await this.verifyGoogleHomeToken(request.deviceToken);
      if (!isValidToken) {
        throw createAuthError('Invalid Google Home device token');
      }

      // Find user by Google account ID or device ID
      const existingUser = await this.findUserByGoogleAccount(
        request.googleAccountId || request.deviceId
      );
      if (!existingUser) {
        throw createAuthError('User must register via web platform first');
      }

      // Check if device is registered
      const isDeviceRegistered = await this.isGoogleHomeDeviceRegistered(
        existingUser.uid,
        request.deviceId
      );

      if (!isDeviceRegistered) {
        // Register device
        await this.registerGoogleHomeDevice(existingUser.uid, request);
      }

      const loginRequest: LoginRequest = {
        platform: 'google_home',
        identifier: request.deviceId,
        credential: request.deviceToken,
        deviceInfo: request.deviceInfo,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      };

      const loginResult = await this.authService.loginUser(loginRequest);

      performanceMonitor.endTimer(timerId);
      return {
        success: true,
        platform: 'google_home',
        authMethod: 'device_token',
        user: loginResult.user,
        tokens: loginResult.tokens,
        session: loginResult.session,
        message: 'Google Home authentication successful',
      };
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Google Home authentication failed: ${error.message}`);
    }
  }

  /**
   * Authenticate API user
   */
  async authenticateAPI(request: APIAuthRequest): Promise<PlatformAuthResponse> {
    const timerId = performanceMonitor.startTimer('api_auth');

    try {
      const config = this.PLATFORM_CONFIGS.get('api')!;

      // Verify API key
      const apiKeyInfo = await this.verifyAPIKey(request.apiKey);
      if (!apiKeyInfo) {
        throw createAuthError('Invalid API key');
      }

      // Check scope permissions
      const hasRequiredScope = request.scope.every(scope =>
        apiKeyInfo.allowedScopes.includes(scope)
      );

      if (!hasRequiredScope) {
        throw createAuthError('Insufficient API key permissions');
      }

      const loginRequest: LoginRequest = {
        platform: 'api',
        identifier: request.clientId,
        credential: request.apiKey,
        deviceInfo: request.deviceInfo,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      };

      const loginResult = await this.authService.loginUser(loginRequest);

      performanceMonitor.endTimer(timerId);
      return {
        success: true,
        platform: 'api',
        authMethod: 'api_key',
        user: loginResult.user,
        tokens: loginResult.tokens,
        session: loginResult.session,
        message: 'API authentication successful',
      };
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`API authentication failed: ${error.message}`);
    }
  }

  /**
   * Get platform configuration
   */
  getPlatformConfig(platform: string): PlatformAuthConfig | null {
    return this.PLATFORM_CONFIGS.get(platform) || null;
  }

  /**
   * Check if platform supports feature
   */
  platformSupportsFeature(platform: string, feature: string): boolean {
    const config = this.PLATFORM_CONFIGS.get(platform);
    return config ? config.supportedFeatures.includes(feature) : false;
  }

  /**
   * Link new platform to existing user
   */
  async linkPlatformToUser(uid: string, platform: string, platformData: any): Promise<void> {
    const timerId = performanceMonitor.startTimer('link_platform');

    try {
      const config = this.PLATFORM_CONFIGS.get(platform);
      if (!config) {
        throw createAuthError(`Unsupported platform: ${platform}`);
      }

      // Create platform auth data
      const platformAuth = {
        platform,
        identifier: this.extractPlatformIdentifier(platform, platformData),
        verified: false,
        linkedAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
        deviceInfo: platformData.deviceInfo,
        permissions: this.getDefaultPermissions(platform),
      };

      // Link platform to user
      await this.authService.linkPlatform(uid, platformAuth);

      // Send verification if required
      if (config.requiresVerification) {
        await this.sendPlatformVerification(platform, platformAuth.identifier);
      }

      performanceMonitor.endTimer(timerId);
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createAuthError(`Failed to link platform: ${error.message}`);
    }
  }

  /**
   * Private helper methods
   */
  private async authenticateWebEmailPassword(
    request: WebAuthRequest
  ): Promise<PlatformAuthResponse> {
    const existingUser = await this.findUserByEmail(request.email);

    if (!existingUser) {
      // Registration flow
      const registrationRequest: RegistrationRequest = {
        platform: 'web',
        email: request.email,
        password: request.password,
        deviceInfo: request.deviceInfo,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      };

      const registrationResult = await this.authService.registerUser(registrationRequest);

      return {
        success: true,
        platform: 'web',
        authMethod: 'email_password',
        user: registrationResult.user,
        tokens: registrationResult.tokens,
        session: registrationResult.session,
        requiresAdditionalAuth: registrationResult.requiresVerification,
        nextStep: registrationResult.requiresVerification ? 'email_verification' : undefined,
        message: 'Web registration successful',
      };
    } else {
      // Login flow
      const loginRequest: LoginRequest = {
        platform: 'web',
        identifier: request.email,
        credential: request.password,
        deviceInfo: request.deviceInfo,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        rememberDevice: request.rememberDevice,
      };

      const loginResult = await this.authService.loginUser(loginRequest);

      return {
        success: true,
        platform: 'web',
        authMethod: 'email_password',
        user: loginResult.user,
        tokens: loginResult.tokens,
        session: loginResult.session,
        requiresAdditionalAuth: loginResult.requiresVerification,
        nextStep: loginResult.requiresVerification ? loginResult.verificationMethod : undefined,
        message: 'Web login successful',
      };
    }
  }

  private async authenticateWebOAuth(request: WebAuthRequest): Promise<PlatformAuthResponse> {
    // Verify OAuth token with provider
    const oauthUserInfo = await this.verifyOAuthToken(request.oauthProvider!, request.oauthToken!);
    if (!oauthUserInfo) {
      throw createAuthError('Invalid OAuth token');
    }

    const existingUser = await this.findUserByEmail(oauthUserInfo.email);

    if (!existingUser) {
      // Registration via OAuth
      const registrationRequest: RegistrationRequest = {
        platform: 'web',
        email: oauthUserInfo.email,
        displayName: oauthUserInfo.name,
        deviceInfo: request.deviceInfo,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
      };

      const registrationResult = await this.authService.registerUser(registrationRequest);

      return {
        success: true,
        platform: 'web',
        authMethod: 'oauth',
        user: registrationResult.user,
        tokens: registrationResult.tokens,
        session: registrationResult.session,
        message: 'OAuth registration successful',
      };
    } else {
      // Login via OAuth
      const loginRequest: LoginRequest = {
        platform: 'web',
        identifier: oauthUserInfo.email,
        credential: request.oauthToken,
        deviceInfo: request.deviceInfo,
        ipAddress: request.ipAddress,
        userAgent: request.userAgent,
        rememberDevice: request.rememberDevice,
      };

      const loginResult = await this.authService.loginUser(loginRequest);

      return {
        success: true,
        platform: 'web',
        authMethod: 'oauth',
        user: loginResult.user,
        tokens: loginResult.tokens,
        session: loginResult.session,
        message: 'OAuth login successful',
      };
    }
  }

  private async findUserByPhone(phoneNumber: string): Promise<any> {
    // Implementation would query database for user with phone number
    return null; // Simplified for demo
  }

  private async findUserByEmail(email: string): Promise<any> {
    // Implementation would query database for user with email
    return null; // Simplified for demo
  }

  private async findUserByGoogleAccount(googleAccountId: string): Promise<any> {
    // Implementation would query database for user with Google account ID
    return null; // Simplified for demo
  }

  private async sendWhatsAppVerification(phoneNumber: string): Promise<void> {
    const verificationCode = this.generateVerificationCode();
    const cacheKey = `whatsapp_verification_${phoneNumber}`;

    // Store code in cache
    await cacheService.set(cacheKey, verificationCode, { ttl: 600000 }); // 10 minutes

    // In real implementation, send via WhatsApp Business API
    console.log(`WhatsApp verification code for ${phoneNumber}: ${verificationCode}`);
  }

  private async verifyWhatsAppCode(phoneNumber: string, code: string): Promise<boolean> {
    const cacheKey = `whatsapp_verification_${phoneNumber}`;
    const storedCode = await cacheService.get(cacheKey);

    if (storedCode === code) {
      await cacheService.delete(cacheKey);
      return true;
    }

    return false;
  }

  private async verifyGoogleHomeToken(deviceToken: string): Promise<boolean> {
    // In real implementation, verify with Google's API
    return deviceToken.startsWith('google_home_');
  }

  private async isGoogleHomeDeviceRegistered(uid: string, deviceId: string): Promise<boolean> {
    // Check if device is registered for user
    return false; // Simplified for demo
  }

  private async registerGoogleHomeDevice(
    uid: string,
    request: GoogleHomeAuthRequest
  ): Promise<void> {
    // Register Google Home device for user
    console.log(`Registering Google Home device ${request.deviceId} for user ${uid}`);
  }

  private async verifyAPIKey(apiKey: string): Promise<any> {
    // Verify API key and return key info
    if (apiKey.startsWith('fylgja_api_')) {
      return {
        uid: 'demo_user',
        allowedScopes: ['read', 'write', 'admin'],
        rateLimit: 1000,
      };
    }
    return null;
  }

  private async verifyOAuthToken(provider: string, token: string): Promise<any> {
    // Verify OAuth token with provider
    return {
      email: 'user@example.com',
      name: 'Demo User',
      id: 'oauth_user_id',
    };
  }

  private async sendPlatformVerification(platform: string, identifier: string): Promise<void> {
    const verificationCode = this.generateVerificationCode();
    const cacheKey = `platform_verification_${platform}_${identifier}`;

    await cacheService.set(cacheKey, verificationCode, { ttl: 600000 });

    console.log(`Verification code for ${platform} ${identifier}: ${verificationCode}`);
  }

  private extractPlatformIdentifier(platform: string, platformData: any): string {
    switch (platform) {
      case 'whatsapp':
        return platformData.phoneNumber;
      case 'web':
        return platformData.email;
      case 'google_home':
        return platformData.deviceId;
      case 'api':
        return platformData.clientId;
      default:
        return platformData.identifier || 'unknown';
    }
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

  private generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

// Global multi-platform auth instance
export const multiPlatformAuth = new MultiPlatformAuth();
