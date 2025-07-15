/**
 * API Validator for Fylgja
 * Comprehensive request/response validation and schema enforcement
 */

import { logger } from 'firebase-functions';

export interface ValidationSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  required?: string[];
  properties?: Record<string, ValidationSchema>;
  items?: ValidationSchema;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  enum?: any[];
  custom?: (value: any) => string | null; // Returns error message or null
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: any;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  sanitized?: any;
}

export class APIValidator {
  // Core request schemas
  private static schemas: Record<string, ValidationSchema> = {
    // Authentication schemas
    authRequest: {
      type: 'object',
      required: ['email', 'platform'],
      properties: {
        email: {
          type: 'string',
          pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
          maxLength: 255
        },
        platform: {
          type: 'string',
          enum: ['web', 'whatsapp', 'google_home', 'api']
        },
        token: {
          type: 'string',
          minLength: 1,
          maxLength: 2048
        }
      }
    },

    // Core processing schemas
    processRequest: {
      type: 'object',
      required: ['userId', 'type', 'input', 'platform'],
      properties: {
        userId: {
          type: 'string',
          minLength: 1,
          maxLength: 128
        },
        type: {
          type: 'string',
          enum: ['checkin', 'task_analysis', 'response_generation', 'sentiment_analysis', 'workflow_start', 'workflow_continue']
        },
        input: {
          type: 'string',
          minLength: 1,
          maxLength: 10000
        },
        platform: {
          type: 'string',
          enum: ['web', 'whatsapp', 'google_home', 'api']
        },
        context: {
          type: 'object',
          properties: {
            conversationHistory: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  input: { type: 'string' },
                  response: { type: 'string' },
                  timestamp: { type: 'string' }
                }
              }
            },
            sessionId: { type: 'string' },
            workflowId: { type: 'string' }
          }
        }
      }
    },

    // User profile schemas
    userProfile: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: {
          type: 'string',
          minLength: 1,
          maxLength: 128
        },
        preferences: {
          type: 'object',
          properties: {
            communicationStyle: {
              type: 'string',
              enum: ['formal', 'casual', 'friendly', 'professional']
            },
            questionDepth: {
              type: 'string',
              enum: ['surface', 'medium', 'deep', 'profound']
            },
            personalityType: {
              type: 'string',
              enum: ['analytical', 'creative', 'practical', 'empathetic', 'ambitious', 'reflective', 'social', 'independent']
            },
            responseLength: {
              type: 'string',
              enum: ['brief', 'moderate', 'detailed']
            }
          }
        },
        adaptiveLearning: {
          type: 'object',
          properties: {
            patterns: { type: 'object' },
            confidence: {
              type: 'number',
              min: 0,
              max: 1
            },
            lastUpdated: { type: 'string' }
          }
        }
      }
    },

    // Interaction schemas
    interaction: {
      type: 'object',
      required: ['userId', 'type', 'input', 'response', 'timestamp'],
      properties: {
        userId: {
          type: 'string',
          minLength: 1,
          maxLength: 128
        },
        type: {
          type: 'string',
          enum: ['checkin', 'task_analysis', 'response_generation', 'sentiment_analysis']
        },
        input: {
          type: 'string',
          minLength: 1,
          maxLength: 10000
        },
        response: {
          type: 'string',
          minLength: 1,
          maxLength: 20000
        },
        timestamp: { type: 'string' },
        metadata: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            responseTime: { type: 'number' },
            sentiment: {
              type: 'object',
              properties: {
                sentiment: { type: 'string' },
                confidence: { type: 'number' }
              }
            }
          }
        }
      }
    },

    // Task schemas
    task: {
      type: 'object',
      required: ['userId', 'title', 'status'],
      properties: {
        userId: {
          type: 'string',
          minLength: 1,
          maxLength: 128
        },
        title: {
          type: 'string',
          minLength: 1,
          maxLength: 500
        },
        description: {
          type: 'string',
          maxLength: 2000
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled']
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent']
        },
        dueDate: { type: 'string' },
        category: {
          type: 'string',
          maxLength: 100
        }
      }
    }
  };

  /**
   * Validate data against a schema
   */
  static validate(data: any, schemaName: string): ValidationResult {
    const schema = this.schemas[schemaName];
    if (!schema) {
      return {
        valid: false,
        errors: [{
          field: 'schema',
          message: `Unknown schema: ${schemaName}`,
          code: 'UNKNOWN_SCHEMA'
        }],
        warnings: []
      };
    }

    return this.validateAgainstSchema(data, schema, '');
  }

  /**
   * Validate and sanitize data
   */
  static validateAndSanitize(data: any, schemaName: string): ValidationResult {
    const result = this.validate(data, schemaName);
    
    if (result.valid) {
      result.sanitized = this.sanitizeData(data, this.schemas[schemaName]);
    }

    return result;
  }

  /**
   * Add custom validation schema
   */
  static addSchema(name: string, schema: ValidationSchema): void {
    this.schemas[name] = schema;
  }

  /**
   * Validate request headers
   */
  static validateHeaders(headers: Record<string, string>): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Check required headers
    const requiredHeaders = ['content-type', 'authorization'];
    for (const header of requiredHeaders) {
      if (!headers[header.toLowerCase()]) {
        errors.push({
          field: header,
          message: `Required header '${header}' is missing`,
          code: 'MISSING_HEADER'
        });
      }
    }

    // Validate content-type
    const contentType = headers['content-type'];
    if (contentType && !contentType.includes('application/json')) {
      warnings.push('Content-Type should be application/json for optimal processing');
    }

    // Validate authorization
    const auth = headers['authorization'];
    if (auth && !auth.startsWith('Bearer ')) {
      errors.push({
        field: 'authorization',
        message: 'Authorization header must use Bearer token format',
        code: 'INVALID_AUTH_FORMAT'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate rate limiting
   */
  static validateRateLimit(userId: string, endpoint: string, requests: number, timeWindow: number): ValidationResult {
    const limits: Record<string, { requests: number; window: number }> = {
      '/api/process': { requests: 100, window: 3600 }, // 100 per hour
      '/api/auth': { requests: 10, window: 300 }, // 10 per 5 minutes
      '/api/profile': { requests: 50, window: 3600 } // 50 per hour
    };

    const limit = limits[endpoint] || { requests: 1000, window: 3600 };
    
    if (requests > limit.requests) {
      return {
        valid: false,
        errors: [{
          field: 'rate_limit',
          message: `Rate limit exceeded: ${requests}/${limit.requests} requests in ${limit.window}s`,
          code: 'RATE_LIMIT_EXCEEDED',
          value: { userId, endpoint, requests, limit }
        }],
        warnings: []
      };
    }

    // Warning at 80% of limit
    const warnings: string[] = [];
    if (requests > limit.requests * 0.8) {
      warnings.push(`Approaching rate limit: ${requests}/${limit.requests} requests`);
    }

    return {
      valid: true,
      errors: [],
      warnings
    };
  }

  // Private helper methods
  private static validateAgainstSchema(data: any, schema: ValidationSchema, path: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    try {
      // Type validation
      if (!this.validateType(data, schema.type)) {
        errors.push({
          field: path || 'root',
          message: `Expected ${schema.type}, got ${typeof data}`,
          code: 'TYPE_MISMATCH',
          value: data
        });
        return { valid: false, errors, warnings };
      }

      // Object validation
      if (schema.type === 'object' && data !== null) {
        // Required fields
        if (schema.required) {
          for (const field of schema.required) {
            if (!(field in data)) {
              errors.push({
                field: path ? `${path}.${field}` : field,
                message: `Required field '${field}' is missing`,
                code: 'REQUIRED_FIELD_MISSING'
              });
            }
          }
        }

        // Property validation
        if (schema.properties) {
          for (const [field, fieldSchema] of Object.entries(schema.properties)) {
            if (field in data) {
              const fieldPath = path ? `${path}.${field}` : field;
              const fieldResult = this.validateAgainstSchema(data[field], fieldSchema, fieldPath);
              errors.push(...fieldResult.errors);
              warnings.push(...fieldResult.warnings);
            }
          }
        }
      }

      // Array validation
      if (schema.type === 'array' && Array.isArray(data)) {
        if (schema.items) {
          data.forEach((item, index) => {
            const itemPath = `${path}[${index}]`;
            const itemResult = this.validateAgainstSchema(item, schema.items!, itemPath);
            errors.push(...itemResult.errors);
            warnings.push(...itemResult.warnings);
          });
        }
      }

      // String validation
      if (schema.type === 'string' && typeof data === 'string') {
        if (schema.minLength && data.length < schema.minLength) {
          errors.push({
            field: path || 'root',
            message: `String too short: ${data.length} < ${schema.minLength}`,
            code: 'STRING_TOO_SHORT',
            value: data.length
          });
        }

        if (schema.maxLength && data.length > schema.maxLength) {
          errors.push({
            field: path || 'root',
            message: `String too long: ${data.length} > ${schema.maxLength}`,
            code: 'STRING_TOO_LONG',
            value: data.length
          });
        }

        if (schema.pattern) {
          const regex = new RegExp(schema.pattern);
          if (!regex.test(data)) {
            errors.push({
              field: path || 'root',
              message: `String does not match pattern: ${schema.pattern}`,
              code: 'PATTERN_MISMATCH',
              value: data
            });
          }
        }
      }

      // Number validation
      if (schema.type === 'number' && typeof data === 'number') {
        if (schema.min !== undefined && data < schema.min) {
          errors.push({
            field: path || 'root',
            message: `Number too small: ${data} < ${schema.min}`,
            code: 'NUMBER_TOO_SMALL',
            value: data
          });
        }

        if (schema.max !== undefined && data > schema.max) {
          errors.push({
            field: path || 'root',
            message: `Number too large: ${data} > ${schema.max}`,
            code: 'NUMBER_TOO_LARGE',
            value: data
          });
        }
      }

      // Enum validation
      if (schema.enum && !schema.enum.includes(data)) {
        errors.push({
          field: path || 'root',
          message: `Value not in enum: ${data}. Allowed: ${schema.enum.join(', ')}`,
          code: 'ENUM_MISMATCH',
          value: data
        });
      }

      // Custom validation
      if (schema.custom) {
        const customError = schema.custom(data);
        if (customError) {
          errors.push({
            field: path || 'root',
            message: customError,
            code: 'CUSTOM_VALIDATION_FAILED',
            value: data
          });
        }
      }

    } catch (error) {
      errors.push({
        field: path || 'root',
        message: `Validation error: ${error.message}`,
        code: 'VALIDATION_ERROR'
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  private static validateType(data: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'object':
        return typeof data === 'object' && data !== null && !Array.isArray(data);
      case 'array':
        return Array.isArray(data);
      case 'string':
        return typeof data === 'string';
      case 'number':
        return typeof data === 'number' && !isNaN(data);
      case 'boolean':
        return typeof data === 'boolean';
      default:
        return false;
    }
  }

  private static sanitizeData(data: any, schema: ValidationSchema): any {
    if (!data) return data;

    switch (schema.type) {
      case 'string':
        if (typeof data === 'string') {
          // Trim whitespace and remove potentially harmful characters
          return data.trim().replace(/[<>]/g, '');
        }
        return data;

      case 'object':
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
          const sanitized: any = {};
          
          if (schema.properties) {
            for (const [key, value] of Object.entries(data)) {
              if (schema.properties[key]) {
                sanitized[key] = this.sanitizeData(value, schema.properties[key]);
              }
            }
          }
          
          return sanitized;
        }
        return data;

      case 'array':
        if (Array.isArray(data) && schema.items) {
          return data.map(item => this.sanitizeData(item, schema.items!));
        }
        return data;

      default:
        return data;
    }
  }
}

// Export validation middleware
export function validationMiddleware(schemaName: string) {
  return (req: any, res: any, next: any) => {
    const result = APIValidator.validate(req.body, schemaName);
    
    if (!result.valid) {
      logger.warn('Validation failed', {
        schema: schemaName,
        errors: result.errors,
        body: req.body
      });
      
      return res.status(400).json({
        error: 'Validation failed',
        details: result.errors
      });
    }

    if (result.warnings.length > 0) {
      logger.info('Validation warnings', {
        schema: schemaName,
        warnings: result.warnings
      });
    }

    // Attach sanitized data if available
    if (result.sanitized) {
      req.body = result.sanitized;
    }

    next();
  };
}

