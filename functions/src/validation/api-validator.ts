/**
 * API Validator for Fylgja
 * Comprehensive validation system for all API requests and responses
 */

import { z } from 'zod';

import { FylgjaError, ErrorType } from '../utils/error-handler';

// Base validation schemas
const UserIdSchema = z.string().min(1, 'User ID is required');
const PlatformSchema = z.enum(['whatsapp', 'web', 'google_home', 'api']);
const TimestampSchema = z.date().or(z.string().datetime());

// Request type schemas
const RequestTypeSchema = z.enum([
  'daily_checkin',
  'generate_question',
  'process_response',
  'task_analysis',
  'goal_setting',
  'reflection_prompt',
  'summary_generation',
  'proactive_engagement',
]);

// Core request validation schema
const CoreRequestSchema = z.object({
  userId: UserIdSchema,
  type: RequestTypeSchema,
  input: z.string().min(1, 'Input is required'),
  platform: PlatformSchema,
  sessionId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// Authentication validation schemas
const AuthRequestSchema = z
  .object({
    email: z.string().email().optional(),
    phoneNumber: z.string().optional(),
    platform: PlatformSchema,
    token: z.string().min(1, 'Token is required'),
    deviceInfo: z
      .object({
        userAgent: z.string().optional(),
        ipAddress: z.string().optional(),
        deviceId: z.string().optional(),
      })
      .optional(),
  })
  .refine(data => data.email || data.phoneNumber, {
    message: 'Either email or phone number is required',
  });

// User profile validation schemas
const UserPreferencesSchema = z.object({
  communicationStyle: z.enum(['formal', 'casual', 'friendly', 'professional']).default('friendly'),
  questionDepth: z.enum(['surface', 'medium', 'deep', 'profound']).default('medium'),
  personalityType: z
    .enum([
      'analytical',
      'creative',
      'practical',
      'empathetic',
      'ambitious',
      'reflective',
      'social',
      'independent',
    ])
    .default('analytical'),
  responseLength: z.enum(['brief', 'moderate', 'detailed']).default('moderate'),
  enableAdaptiveLearning: z.boolean().default(true),
  privacyLevel: z.enum(['minimal', 'standard', 'enhanced']).default('standard'),
});

const UserProfileSchema = z.object({
  userId: UserIdSchema,
  email: z.string().email().optional(),
  displayName: z.string().optional(),
  preferences: UserPreferencesSchema,
  createdAt: TimestampSchema,
  lastActiveAt: TimestampSchema,
  platformAccounts: z
    .record(
      z.object({
        accountId: z.string(),
        verified: z.boolean(),
        linkedAt: TimestampSchema,
      })
    )
    .optional(),
});

/**
 * API Validator class for comprehensive request/response validation
 */
export class APIValidator {
  private static instance: APIValidator;
  private validationCache: Map<string, any> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  public static getInstance(): APIValidator {
    if (!APIValidator.instance) {
      APIValidator.instance = new APIValidator();
    }
    return APIValidator.instance;
  }

  /**
   * Validate core processing request
   */
  public validateCoreRequest(data: any): z.infer<typeof CoreRequestSchema> {
    try {
      return CoreRequestSchema.parse(data);
    } catch (error) {
      throw new FylgjaError({
        type: ErrorType.VALIDATION,
        message: 'Invalid core request format',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { validationErrors: error instanceof z.ZodError ? error.errors : error },
        },
      });
    }
  }

  /**
   * Validate authentication request
   */
  public validateAuthRequest(data: any): z.infer<typeof AuthRequestSchema> {
    try {
      return AuthRequestSchema.parse(data);
    } catch (error) {
      throw new FylgjaError({
        type: ErrorType.VALIDATION,
        message: 'Invalid authentication request format',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { validationErrors: error instanceof z.ZodError ? error.errors : error },
        },
      });
    }
  }

  /**
   * Validate user profile data
   */
  public validateUserProfile(data: any): z.infer<typeof UserProfileSchema> {
    try {
      return UserProfileSchema.parse(data);
    } catch (error) {
      throw new FylgjaError({
        type: ErrorType.VALIDATION,
        message: 'Invalid user profile format',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { validationErrors: error instanceof z.ZodError ? error.errors : error },
        },
      });
    }
  }

  /**
   * Validate input sanitization
   */
  public sanitizeInput(input: string): string {
    if (typeof input !== 'string') {
      throw new FylgjaError({
        type: ErrorType.VALIDATION,
        message: 'Input must be a string',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { inputType: typeof input },
        },
      });
    }

    // Remove potentially dangerous characters
    const sanitized = input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/javascript:/gi, '') // Remove javascript: protocols
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();

    // Length validation
    if (sanitized.length > 10000) {
      throw new FylgjaError({
        type: ErrorType.VALIDATION,
        message: 'Input exceeds maximum length',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { length: sanitized.length, limit: 10000 },
        },
      });
    }

    return sanitized;
  }

  /**
   * Clear validation cache
   */
  public clearCache(): void {
    this.validationCache.clear();
  }

  /**
   * Get validation statistics
   */
  public getValidationStats(): {
    cacheSize: number;
    cacheHitRate: number;
    validationCount: number;
  } {
    return {
      cacheSize: this.validationCache.size,
      cacheHitRate: 0.85, // Mock value - would be calculated in real implementation
      validationCount: 1000, // Mock value - would be tracked in real implementation
    };
  }
}

// Export validation schemas for external use
export { CoreRequestSchema, AuthRequestSchema, UserProfileSchema, UserPreferencesSchema };

// Export singleton instance
export const apiValidator = APIValidator.getInstance();
