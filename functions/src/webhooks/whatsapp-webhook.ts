/**
 * WhatsApp Webhook Handler for Fylgja
 * Handles incoming WhatsApp messages via Twilio integration
 */

import { Request, Response } from 'express';
import * as functions from 'firebase-functions';

import { APIPerformanceMonitor } from '../monitoring/api-performance-monitor';
import { TwilioService } from '../services/twilio-service';
import { WhatsAppMessageProcessor } from '../services/whatsapp-message-processor';
import { FylgjaError, ErrorType } from '../utils/error-handler';
import { RateLimiter } from '../utils/rate-limiter';
import { APIValidator } from '../validation/api-validator';

// WhatsApp webhook configuration
const webhookConfig = {
  timeoutSeconds: 60,
  memory: '512MB' as const,
  region: 'us-central1',
};

/**
 * WhatsApp Webhook Handler
 * Processes incoming WhatsApp messages from Twilio
 */
export const whatsappWebhook = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: webhookConfig.timeoutSeconds,
    memory: webhookConfig.memory,
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();
    const requestId = `whatsapp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log('WhatsApp webhook received', {
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
          message: 'WhatsApp webhook only accepts POST requests',
          requestId,
        });
      }

      // Validate Twilio signature for security
      const twilioService = TwilioService.getInstance();
      const isValidSignature = twilioService.validateWebhookSignature(
        req.headers['x-twilio-signature'] as string,
        req.originalUrl,
        req.body
      );

      if (!isValidSignature) {
        console.warn('Invalid Twilio signature detected', {
          requestId,
          signature: req.headers['x-twilio-signature'],
          url: req.originalUrl,
        });

        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook signature',
          requestId,
        });
      }

      // Rate limiting check
      const rateLimiter = RateLimiter.getInstance();
      const clientId = req.body.From || req.ip;
      const rateLimitResult = await rateLimiter.checkLimit(clientId, 'whatsapp_webhook');

      if (!rateLimitResult.allowed) {
        console.warn('Rate limit exceeded for WhatsApp webhook', {
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
      const validationResult = validator.validateWhatsAppWebhook(req.body);

      if (!validationResult.isValid) {
        console.error('Invalid WhatsApp webhook payload', {
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

      // Extract message data
      const messageData = {
        messageId: req.body.MessageSid || `msg-${requestId}`,
        from: req.body.From,
        to: req.body.To,
        body: req.body.Body || '',
        mediaUrl: req.body.MediaUrl0 || null,
        mediaContentType: req.body.MediaContentType0 || null,
        timestamp: new Date(),
        accountSid: req.body.AccountSid,
        messagingServiceSid: req.body.MessagingServiceSid,
        numMedia: parseInt(req.body.NumMedia || '0'),
        profileName: req.body.ProfileName || null,
        waId: req.body.WaId || null,
        requestId,
      };

      console.log('Processing WhatsApp message', {
        requestId,
        messageId: messageData.messageId,
        from: messageData.from,
        hasMedia: messageData.numMedia > 0,
        bodyLength: messageData.body.length,
      });

      // Process message asynchronously
      const messageProcessor = WhatsAppMessageProcessor.getInstance();
      const processingResult = await messageProcessor.processIncomingMessage(messageData);

      // Record performance metrics
      performanceMonitor.recordMetric({
        endpoint: '/webhooks/whatsapp',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: processingResult.success ? 200 : 500,
        requestSize: JSON.stringify(req.body).length,
        responseSize: JSON.stringify(processingResult).length,
        cacheHit: false,
        metadata: {
          messageId: messageData.messageId,
          hasMedia: messageData.numMedia > 0,
          processingTime: processingResult.processingTime,
          responseGenerated: processingResult.responseGenerated,
        },
      });

      // Return success response to Twilio
      res.status(200).json({
        success: true,
        messageId: messageData.messageId,
        processed: processingResult.success,
        responseGenerated: processingResult.responseGenerated,
        processingTime: processingResult.processingTime,
        requestId,
      });

      console.log('WhatsApp webhook processed successfully', {
        requestId,
        messageId: messageData.messageId,
        success: processingResult.success,
        responseGenerated: processingResult.responseGenerated,
        processingTime: processingResult.processingTime,
      });
    } catch (error) {
      console.error('WhatsApp webhook processing failed', {
        requestId,
        error: error.message,
        stack: error.stack,
        body: req.body,
      });

      // Record error metrics
      performanceMonitor.recordMetric({
        endpoint: '/webhooks/whatsapp',
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
        message: 'Failed to process WhatsApp message',
        requestId,
      });
    }
  });

/**
 * WhatsApp Status Webhook Handler
 * Handles delivery status updates from Twilio
 */
export const whatsappStatusWebhook = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: 30,
    memory: '256MB',
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const requestId = `status-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log('WhatsApp status webhook received', {
        requestId,
        method: req.method,
        body: req.body,
        timestamp: new Date().toISOString(),
      });

      // Validate HTTP method
      if (req.method !== 'POST') {
        return res.status(405).json({
          error: 'Method not allowed',
          requestId,
        });
      }

      // Validate Twilio signature
      const twilioService = TwilioService.getInstance();
      const isValidSignature = twilioService.validateWebhookSignature(
        req.headers['x-twilio-signature'] as string,
        req.originalUrl,
        req.body
      );

      if (!isValidSignature) {
        console.warn('Invalid Twilio signature for status webhook', {
          requestId,
          signature: req.headers['x-twilio-signature'],
        });

        return res.status(401).json({
          error: 'Unauthorized',
          requestId,
        });
      }

      // Extract status data
      const statusData = {
        messageId: req.body.MessageSid,
        status: req.body.MessageStatus,
        to: req.body.To,
        from: req.body.From,
        timestamp: new Date(),
        errorCode: req.body.ErrorCode || null,
        errorMessage: req.body.ErrorMessage || null,
        requestId,
      };

      console.log('Processing WhatsApp status update', {
        requestId,
        messageId: statusData.messageId,
        status: statusData.status,
        hasError: !!statusData.errorCode,
      });

      // Process status update
      const messageProcessor = WhatsAppMessageProcessor.getInstance();
      await messageProcessor.processStatusUpdate(statusData);

      // Return success response
      res.status(200).json({
        success: true,
        messageId: statusData.messageId,
        status: statusData.status,
        requestId,
      });

      console.log('WhatsApp status webhook processed successfully', {
        requestId,
        messageId: statusData.messageId,
        status: statusData.status,
      });
    } catch (error) {
      console.error('WhatsApp status webhook processing failed', {
        requestId,
        error: error.message,
        stack: error.stack,
        body: req.body,
      });

      res.status(500).json({
        success: false,
        error: 'Internal server error',
        requestId,
      });
    }
  });

/**
 * WhatsApp Webhook Health Check
 * Provides health status for WhatsApp integration
 */
export const whatsappWebhookHealth = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: 30,
    memory: '256MB',
  })
  .https.onRequest(async (req: Request, res: Response) => {
    try {
      const twilioService = TwilioService.getInstance();
      const messageProcessor = WhatsAppMessageProcessor.getInstance();

      // Check Twilio service health
      const twilioHealth = await twilioService.checkHealth();

      // Check message processor health
      const processorHealth = await messageProcessor.checkHealth();

      // Get recent metrics
      const performanceMonitor = APIPerformanceMonitor.getInstance();
      const recentMetrics = performanceMonitor.getRecentMetrics('/webhooks/whatsapp', 10);

      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          twilio: twilioHealth,
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
      };

      // Determine overall health status
      if (!twilioHealth.healthy || !processorHealth.healthy) {
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
      console.error('WhatsApp webhook health check failed', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  });
