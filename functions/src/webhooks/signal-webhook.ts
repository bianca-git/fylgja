/**
 * Signal Webhook Handler for Fylgja
 * Handles incoming Signal messages via Signal-CLI or Signal API
 *
 * PLACEHOLDER IMPLEMENTATION - Ready for development
 * Note: Signal integration requires self-hosted Signal-CLI or third-party Signal API service
 */

import * as crypto from 'crypto';

import { Request, Response } from 'express';
import * as functions from 'firebase-functions';

import { APIPerformanceMonitor } from '../monitoring/api-performance-monitor';
import { SignalAPIService } from '../services/signal-api-service';
import { SignalMessageProcessor } from '../services/signal-message-processor';
import { FylgjaError, ErrorType } from '../utils/error-handler';
import { RateLimiter } from '../utils/rate-limiter';
import { APIValidator } from '../validation/api-validator';

// Signal webhook configuration
const webhookConfig = {
  timeoutSeconds: 60,
  memory: '512MB' as const,
  region: 'us-central1',
};

/**
 * Signal Webhook Handler
 * Processes incoming Signal messages
 */
export const signalWebhook = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: webhookConfig.timeoutSeconds,
    memory: webhookConfig.memory,
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();
    const requestId = `signal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log('Signal webhook received', {
        requestId,
        method: req.method,
        headers: req.headers,
        body: req.body,
        timestamp: new Date().toISOString(),
      });

      // Validate HTTP method
      if (req.method !== 'POST') {
        return res.status(405).json({
          error: 'Method not allowed',
          message: 'Signal webhook only accepts POST requests',
          requestId,
        });
      }

      // Validate Signal webhook signature for security
      const signalService = SignalAPIService.getInstance();
      const isValidSignature = signalService.validateWebhookSignature(
        req.headers['x-signal-signature'] as string,
        JSON.stringify(req.body)
      );

      if (!isValidSignature) {
        console.warn('Invalid Signal signature detected', {
          requestId,
          signature: req.headers['x-signal-signature'],
        });

        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook signature',
          requestId,
        });
      }

      // Rate limiting check
      const rateLimiter = RateLimiter.getInstance();
      const clientId = req.body.envelope?.source || req.body.envelope?.sourceNumber || req.ip;
      const rateLimitResult = await rateLimiter.checkLimit(clientId, 'signal_webhook');

      if (!rateLimitResult.allowed) {
        console.warn('Rate limit exceeded for Signal webhook', {
          requestId,
          clientId,
          remainingPoints: rateLimitResult.remainingPoints,
          resetTime: rateLimitResult.resetTime,
        });

        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: rateLimitResult.resetTime,
          requestId,
        });
      }

      // Validate webhook payload
      const validator = APIValidator.getInstance();
      const validationResult = validator.validateSignalWebhook(req.body);

      if (!validationResult.isValid) {
        console.error('Invalid Signal webhook payload', {
          requestId,
          errors: validationResult.errors,
          payload: req.body,
        });

        return res.status(400).json({
          error: 'Invalid payload',
          message: 'Webhook payload validation failed',
          details: validationResult.errors,
          requestId,
        });
      }

      // Process Signal message
      let processingResult;

      try {
        const messageProcessor = SignalMessageProcessor.getInstance();
        processingResult = await messageProcessor.processSignalMessage({
          envelope: req.body.envelope,
          account: req.body.account,
          timestamp: new Date(),
          requestId,
        });
      } catch (error) {
        console.error('Failed to process Signal message', {
          requestId,
          error: error.message,
          envelope: req.body.envelope,
        });

        processingResult = {
          success: false,
          error: error.message,
          messageId: req.body.envelope?.timestamp || 'unknown',
        };
      }

      // Record performance metrics
      performanceMonitor.recordMetric({
        endpoint: '/webhooks/signal',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: processingResult.success ? 200 : 500,
        requestSize: JSON.stringify(req.body).length,
        responseSize: JSON.stringify(processingResult).length,
        cacheHit: false,
        metadata: {
          messageProcessed: processingResult.success,
          responseGenerated: processingResult.responseGenerated || false,
          requestId,
        },
      });

      // Return success response to Signal service
      res.status(200).json({
        success: true,
        processed: processingResult.success,
        responseGenerated: processingResult.responseGenerated || false,
        processingTime: processingResult.processingTime || Date.now() - startTime,
        requestId,
      });

      console.log('Signal webhook processed successfully', {
        requestId,
        success: processingResult.success,
        responseGenerated: processingResult.responseGenerated || false,
      });
    } catch (error) {
      console.error('Signal webhook processing failed', {
        requestId,
        error: error.message,
        stack: error.stack,
        body: req.body,
      });

      // Record error metrics
      performanceMonitor.recordMetric({
        endpoint: '/webhooks/signal',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 500,
        requestSize: JSON.stringify(req.body).length,
        responseSize: 0,
        cacheHit: false,
        metadata: {
          error: error.message,
          requestId,
        },
      });

      // Return error response
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to process Signal webhook',
        requestId,
      });
    }
  });

/**
 * Signal Webhook Health Check
 * Provides health status for Signal integration
 */
export const signalWebhookHealth = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: 30,
    memory: '256MB',
  })
  .https.onRequest(async (req: Request, res: Response) => {
    try {
      const signalService = SignalAPIService.getInstance();
      const messageProcessor = SignalMessageProcessor.getInstance();

      // Check Signal API service health
      const signalHealth = await signalService.checkHealth();

      // Check message processor health
      const processorHealth = await messageProcessor.checkHealth();

      // Get recent metrics
      const performanceMonitor = APIPerformanceMonitor.getInstance();
      const recentMetrics = performanceMonitor.getRecentMetrics('/webhooks/signal', 10);

      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          signalApi: signalHealth,
          messageProcessor: processorHealth,
        },
        metrics: {
          recentRequests: recentMetrics.length,
          averageResponseTime:
            recentMetrics.length > 0
              ? recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length
              : 0,
          successRate:
            recentMetrics.length > 0
              ? recentMetrics.filter(m => m.statusCode < 400).length / recentMetrics.length
              : 1,
        },
        placeholder: {
          implemented: false,
          readyForDevelopment: true,
          estimatedEffort: '4-6 weeks',
          dependencies: [
            'Signal-CLI setup',
            'Self-hosted Signal API service',
            'Signal phone number registration',
            'Docker container for Signal-CLI',
          ],
          notes:
            'Signal requires self-hosted infrastructure. No official API available. Requires Signal-CLI or third-party Signal API service.',
          complexity: 'High - requires infrastructure setup and maintenance',
        },
      };

      // Determine overall health status
      if (!signalHealth.healthy || !processorHealth.healthy) {
        healthStatus.status = 'degraded';
      }

      if (healthStatus.metrics.successRate < 0.9) {
        healthStatus.status = 'degraded';
      }

      if (healthStatus.metrics.successRate < 0.7) {
        healthStatus.status = 'unhealthy';
      }

      const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(healthStatus);
    } catch (error) {
      console.error('Signal webhook health check failed', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
        placeholder: {
          implemented: false,
          readyForDevelopment: true,
        },
      });
    }
  });

/**
 * Signal Registration Webhook
 * Handles Signal account registration and verification
 */
export const signalRegistrationWebhook = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: 30,
    memory: '256MB',
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const requestId = `signal-reg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log('Signal registration webhook received', {
        requestId,
        method: req.method,
        body: req.body,
      });

      if (req.method !== 'POST') {
        return res.status(405).json({
          error: 'Method not allowed',
          requestId,
        });
      }

      // Handle registration events (verification codes, registration status, etc.)
      const signalService = SignalAPIService.getInstance();
      const result = await signalService.handleRegistrationEvent(req.body);

      res.status(200).json({
        success: true,
        result,
        requestId,
      });
    } catch (error) {
      console.error('Signal registration webhook failed', {
        requestId,
        error: error.message,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        requestId,
      });
    }
  });
