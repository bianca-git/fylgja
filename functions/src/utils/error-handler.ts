/**
 * Error Handling Utilities for Fylgja
 * Comprehensive error management, logging, and recovery
 */

import { DatabaseService } from '../services/database-service';

export enum ErrorType {
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  RATE_LIMIT = 'rate_limit',
  QUOTA_EXCEEDED = 'quota_exceeded',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  NETWORK = 'network',
  DATABASE = 'database',
  AI_SERVICE = 'ai_service',
  UNKNOWN = 'unknown',
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface ErrorContext {
  userId?: string;
  requestId?: string;
  function?: string;
  endpoint?: string;
  userAgent?: string;
  ip?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface ErrorDetails {
  type: ErrorType;
  severity: ErrorSeverity;
  message: string;
  code: string;
  context: ErrorContext;
  stack?: string;
  retryable: boolean;
  retryAfter?: number;
  userMessage: string;
  internalMessage: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    type: string;
    retryable: boolean;
    retryAfter?: number;
  };
  requestId: string;
  timestamp: string;
}

export class FylgjaError extends Error {
  public readonly type: ErrorType;
  public readonly severity: ErrorSeverity;
  public readonly code: string;
  public readonly context: ErrorContext;
  public readonly retryable: boolean;
  public readonly retryAfter?: number;
  public readonly userMessage: string;
  public readonly internalMessage: string;

  constructor(details: Partial<ErrorDetails> & { message: string }) {
    super(details.message);

    this.name = 'FylgjaError';
    this.type = details.type || ErrorType.UNKNOWN;
    this.severity = details.severity || ErrorSeverity.MEDIUM;
    this.code = details.code || this.generateErrorCode();
    this.context = details.context || this.createDefaultContext();
    this.retryable = details.retryable ?? false;
    this.retryAfter = details.retryAfter;
    this.userMessage = details.userMessage || this.generateUserMessage();
    this.internalMessage = details.internalMessage || details.message;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FylgjaError);
    }
  }

  private generateErrorCode(): string {
    return `FYLGJA_${this.type.toUpperCase()}_${Date.now()}`;
  }

  private createDefaultContext(): ErrorContext {
    return {
      timestamp: new Date().toISOString(),
    };
  }

  private generateUserMessage(): string {
    switch (this.type) {
      case ErrorType.VALIDATION:
        return 'Please check your input and try again.';
      case ErrorType.AUTHENTICATION:
        return 'Please log in to continue.';
      case ErrorType.AUTHORIZATION:
        return "You don't have permission to perform this action.";
      case ErrorType.RATE_LIMIT:
        return 'Too many requests. Please wait a moment before trying again.';
      case ErrorType.QUOTA_EXCEEDED:
        return 'Service limit reached. Please try again later.';
      case ErrorType.SERVICE_UNAVAILABLE:
        return 'Service is temporarily unavailable. Please try again later.';
      case ErrorType.NETWORK:
        return 'Connection issue. Please check your internet and try again.';
      case ErrorType.DATABASE:
        return 'Data service is temporarily unavailable. Please try again.';
      case ErrorType.AI_SERVICE:
        return 'AI service is temporarily unavailable. Please try again.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  public toJSON(): ErrorDetails {
    return {
      type: this.type,
      severity: this.severity,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack,
      retryable: this.retryable,
      retryAfter: this.retryAfter,
      userMessage: this.userMessage,
      internalMessage: this.internalMessage,
    };
  }

  public toResponse(): ErrorResponse {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.userMessage,
        type: this.type,
        retryable: this.retryable,
        retryAfter: this.retryAfter,
      },
      requestId: this.context.requestId || 'unknown',
      timestamp: this.context.timestamp,
    };
  }
}

export class ErrorHandler {
  private dbService: DatabaseService;
  private errorCounts: Map<string, number> = new Map();
  private lastErrorReset: Date = new Date();

  constructor() {
    this.dbService = new DatabaseService();
  }

  /**
   * Handle and process errors
   */
  public async handleError(
    error: Error | FylgjaError,
    context?: Partial<ErrorContext>
  ): Promise<FylgjaError> {
    let fylgjaError: FylgjaError;

    if (error instanceof FylgjaError) {
      fylgjaError = error;
      // Update context if provided
      if (context) {
        fylgjaError.context = { ...fylgjaError.context, ...context };
      }
    } else {
      fylgjaError = this.convertToFylgjaError(error, context);
    }

    // Log the error
    await this.logError(fylgjaError);

    // Update error metrics
    this.updateErrorMetrics(fylgjaError);

    // Check if we need to trigger alerts
    await this.checkAlertThresholds(fylgjaError);

    return fylgjaError;
  }

  /**
   * Convert standard errors to FylgjaError
   */
  private convertToFylgjaError(error: Error, context?: Partial<ErrorContext>): FylgjaError {
    const errorType = this.determineErrorType(error);
    const severity = this.determineSeverity(error, errorType);

    return new FylgjaError({
      type: errorType,
      severity,
      message: error.message,
      context: {
        timestamp: new Date().toISOString(),
        ...context,
      },
      retryable: this.isRetryable(errorType),
      retryAfter: this.getRetryAfter(errorType),
    });
  }

  /**
   * Determine error type from error message/properties
   */
  private determineErrorType(error: Error): ErrorType {
    const message = error.message.toLowerCase();

    if (message.includes('validation') || message.includes('invalid')) {
      return ErrorType.VALIDATION;
    }
    if (message.includes('unauthorized') || message.includes('authentication')) {
      return ErrorType.AUTHENTICATION;
    }
    if (message.includes('forbidden') || message.includes('permission')) {
      return ErrorType.AUTHORIZATION;
    }
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return ErrorType.RATE_LIMIT;
    }
    if (message.includes('quota') || message.includes('limit exceeded')) {
      return ErrorType.QUOTA_EXCEEDED;
    }
    if (message.includes('unavailable') || message.includes('timeout')) {
      return ErrorType.SERVICE_UNAVAILABLE;
    }
    if (message.includes('network') || message.includes('connection')) {
      return ErrorType.NETWORK;
    }
    if (message.includes('database') || message.includes('firestore')) {
      return ErrorType.DATABASE;
    }
    if (message.includes('ai') || message.includes('gemini') || message.includes('model')) {
      return ErrorType.AI_SERVICE;
    }

    return ErrorType.UNKNOWN;
  }

  /**
   * Determine error severity
   */
  private determineSeverity(error: Error, type: ErrorType): ErrorSeverity {
    switch (type) {
      case ErrorType.VALIDATION:
        return ErrorSeverity.LOW;
      case ErrorType.AUTHENTICATION:
      case ErrorType.AUTHORIZATION:
        return ErrorSeverity.MEDIUM;
      case ErrorType.RATE_LIMIT:
        return ErrorSeverity.LOW;
      case ErrorType.QUOTA_EXCEEDED:
        return ErrorSeverity.HIGH;
      case ErrorType.SERVICE_UNAVAILABLE:
      case ErrorType.DATABASE:
      case ErrorType.AI_SERVICE:
        return ErrorSeverity.HIGH;
      case ErrorType.NETWORK:
        return ErrorSeverity.MEDIUM;
      default:
        return ErrorSeverity.MEDIUM;
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryable(type: ErrorType): boolean {
    switch (type) {
      case ErrorType.RATE_LIMIT:
      case ErrorType.SERVICE_UNAVAILABLE:
      case ErrorType.NETWORK:
      case ErrorType.DATABASE:
      case ErrorType.AI_SERVICE:
        return true;
      default:
        return false;
    }
  }

  /**
   * Get retry delay for retryable errors
   */
  private getRetryAfter(type: ErrorType): number | undefined {
    switch (type) {
      case ErrorType.RATE_LIMIT:
        return 60; // 1 minute
      case ErrorType.SERVICE_UNAVAILABLE:
        return 300; // 5 minutes
      case ErrorType.NETWORK:
        return 30; // 30 seconds
      case ErrorType.DATABASE:
        return 120; // 2 minutes
      case ErrorType.AI_SERVICE:
        return 180; // 3 minutes
      default:
        return undefined;
    }
  }

  /**
   * Log error to database
   */
  private async logError(error: FylgjaError): Promise<void> {
    try {
      await this.dbService.logError({
        type: 'application_error',
        severity: error.severity,
        message: error.internalMessage,
        code: error.code,
        errorType: error.type,
        context: error.context,
        stack: error.stack,
        userMessage: error.userMessage,
        retryable: error.retryable,
        retryAfter: error.retryAfter,
      });
    } catch (logError) {
      // Fallback to console logging if database logging fails
      console.error('Failed to log error to database:', logError);
      console.error('Original error:', error.toJSON());
    }
  }

  /**
   * Update error metrics
   */
  private updateErrorMetrics(error: FylgjaError): void {
    const key = `${error.type}_${error.severity}`;
    const current = this.errorCounts.get(key) || 0;
    this.errorCounts.set(key, current + 1);

    // Reset metrics daily
    const now = new Date();
    if (now.getDate() !== this.lastErrorReset.getDate()) {
      this.errorCounts.clear();
      this.lastErrorReset = now;
    }
  }

  /**
   * Check if error thresholds require alerts
   */
  private async checkAlertThresholds(error: FylgjaError): Promise<void> {
    const criticalThreshold = 10;
    const highThreshold = 25;

    if (error.severity === ErrorSeverity.CRITICAL) {
      const criticalCount = this.errorCounts.get(`${error.type}_${ErrorSeverity.CRITICAL}`) || 0;
      if (criticalCount >= criticalThreshold) {
        await this.triggerAlert('critical_error_threshold', {
          errorType: error.type,
          count: criticalCount,
          threshold: criticalThreshold,
        });
      }
    }

    if (error.severity === ErrorSeverity.HIGH) {
      const highCount = this.errorCounts.get(`${error.type}_${ErrorSeverity.HIGH}`) || 0;
      if (highCount >= highThreshold) {
        await this.triggerAlert('high_error_threshold', {
          errorType: error.type,
          count: highCount,
          threshold: highThreshold,
        });
      }
    }
  }

  /**
   * Trigger alert for error thresholds
   */
  private async triggerAlert(alertType: string, metadata: Record<string, any>): Promise<void> {
    try {
      await this.dbService.logError({
        type: 'alert',
        severity: 'critical',
        message: `Alert triggered: ${alertType}`,
        metadata: {
          alertType,
          ...metadata,
          timestamp: new Date().toISOString(),
        },
      });

      // In production, this would also send notifications to monitoring systems
      console.warn(`ALERT: ${alertType}`, metadata);
    } catch (alertError) {
      console.error('Failed to trigger alert:', alertError);
    }
  }

  /**
   * Get error metrics
   */
  public getErrorMetrics(): Record<string, number> {
    return Object.fromEntries(this.errorCounts);
  }

  /**
   * Clear error metrics
   */
  public clearErrorMetrics(): void {
    this.errorCounts.clear();
    this.lastErrorReset = new Date();
  }
}

/**
 * Utility functions for error handling
 */

export function createValidationError(
  message: string,
  context?: Partial<ErrorContext>
): FylgjaError {
  return new FylgjaError({
    type: ErrorType.VALIDATION,
    severity: ErrorSeverity.LOW,
    message,
    context: {
      timestamp: new Date().toISOString(),
      ...context,
    },
    retryable: false,
  });
}

export function createAuthenticationError(
  message: string,
  context?: Partial<ErrorContext>
): FylgjaError {
  return new FylgjaError({
    type: ErrorType.AUTHENTICATION,
    severity: ErrorSeverity.MEDIUM,
    message,
    context: {
      timestamp: new Date().toISOString(),
      ...context,
    },
    retryable: false,
  });
}

export function createRateLimitError(
  retryAfter: number,
  context?: Partial<ErrorContext>
): FylgjaError {
  return new FylgjaError({
    type: ErrorType.RATE_LIMIT,
    severity: ErrorSeverity.LOW,
    message: 'Rate limit exceeded',
    context: {
      timestamp: new Date().toISOString(),
      ...context,
    },
    retryable: true,
    retryAfter,
  });
}

export function createServiceUnavailableError(
  message: string,
  context?: Partial<ErrorContext>
): FylgjaError {
  return new FylgjaError({
    type: ErrorType.SERVICE_UNAVAILABLE,
    severity: ErrorSeverity.HIGH,
    message,
    context: {
      timestamp: new Date().toISOString(),
      ...context,
    },
    retryable: true,
    retryAfter: 300, // 5 minutes
  });
}

export function createAIServiceError(
  message: string,
  context?: Partial<ErrorContext>
): FylgjaError {
  return new FylgjaError({
    type: ErrorType.AI_SERVICE,
    severity: ErrorSeverity.HIGH,
    message,
    context: {
      timestamp: new Date().toISOString(),
      ...context,
    },
    retryable: true,
    retryAfter: 180, // 3 minutes
  });
}

/**
 * Middleware for Express error handling
 */
export function errorMiddleware(error: Error, req: any, res: any, next: any): void {
  const errorHandler = new ErrorHandler();

  errorHandler
    .handleError(error, {
      requestId: req.id,
      userId: req.user?.uid,
      endpoint: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    })
    .then(fylgjaError => {
      res.status(getHttpStatusCode(fylgjaError.type)).json(fylgjaError.toResponse());
    })
    .catch(handlingError => {
      console.error('Error in error handler:', handlingError);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          type: 'unknown',
          retryable: false,
        },
        requestId: req.id || 'unknown',
        timestamp: new Date().toISOString(),
      });
    });
}

/**
 * Get HTTP status code for error type
 */
function getHttpStatusCode(errorType: ErrorType): number {
  switch (errorType) {
    case ErrorType.VALIDATION:
      return 400;
    case ErrorType.AUTHENTICATION:
      return 401;
    case ErrorType.AUTHORIZATION:
      return 403;
    case ErrorType.RATE_LIMIT:
      return 429;
    case ErrorType.QUOTA_EXCEEDED:
      return 429;
    case ErrorType.SERVICE_UNAVAILABLE:
      return 503;
    case ErrorType.NETWORK:
      return 502;
    case ErrorType.DATABASE:
      return 503;
    case ErrorType.AI_SERVICE:
      return 503;
    default:
      return 500;
  }
}

/**
 * Retry utility with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  maxDelay = 10000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        break;
      }

      // Check if error is retryable
      if (error instanceof FylgjaError && !error.retryable) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Global error handler instance
export const globalErrorHandler = new ErrorHandler();
