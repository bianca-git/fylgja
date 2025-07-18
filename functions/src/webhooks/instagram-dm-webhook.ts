/**
 * Instagram DM Webhook Handler for Fylgja
 * Handles incoming Instagram Direct Messages via Instagram Graph API
 *
 * PLACEHOLDER IMPLEMENTATION - Ready for development
 */

import { Request, Response } from 'express';
import * as functions from 'firebase-functions';

import { APIPerformanceMonitor } from '../monitoring/api-performance-monitor';
import { InstagramDMProcessor } from '../services/instagram-dm-processor';
import { InstagramGraphService } from '../services/instagram-graph-service';
import { FylgjaError, ErrorType } from '../utils/error-handler';
import { RateLimiter } from '../utils/rate-limiter';
import { APIValidator } from '../validation/api-validator';

// Instagram DM webhook configuration
const webhookConfig = {
  timeoutSeconds: 60,
  memory: '512MB' as const,
  region: 'us-central1',
};

/**
 * Instagram DM Webhook Handler
 * Processes incoming Instagram Direct Messages
 */
export const instagramDMWebhook = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: webhookConfig.timeoutSeconds,
    memory: webhookConfig.memory,
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();
    const requestId = `ig-dm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log('Instagram DM webhook received', {
        requestId,
        method: req.method,
        headers: req.headers,
        body: req.body,
        timestamp: new Date().toISOString(),
      });

      // Handle webhook verification (GET request)
      if (req.method === 'GET') {
        return handleWebhookVerification(req, res, requestId);
      }

      // Validate HTTP method for message processing
      if (req.method !== 'POST') {
        return res.status(405).json({
          error: 'Method not allowed',
          message:
            'Instagram DM webhook only accepts GET (verification) and POST (messages) requests',
          requestId,
        });
      }

      // Validate Instagram signature for security
      const instagramService = InstagramGraphService.getInstance();
      const isValidSignature = instagramService.validateWebhookSignature(
        req.headers['x-hub-signature-256'] as string,
        JSON.stringify(req.body)
      );

      if (!isValidSignature) {
        console.warn('Invalid Instagram signature detected', {
          requestId,
          signature: req.headers['x-hub-signature-256'],
        });

        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook signature',
          requestId,
        });
      }

      // Rate limiting check
      const rateLimiter = RateLimiter.getInstance();
      const clientId = req.body.entry?.[0]?.messaging?.[0]?.sender?.id || req.ip;
      const rateLimitResult = await rateLimiter.checkLimit(clientId, 'instagram_dm_webhook');

      if (!rateLimitResult.allowed) {
        console.warn('Rate limit exceeded for Instagram DM webhook', {
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
      const validationResult = validator.validateInstagramDMWebhook(req.body);

      if (!validationResult.isValid) {
        console.error('Invalid Instagram DM webhook payload', {
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

      // Process each messaging event
      const processingResults = [];

      for (const entry of req.body.entry || []) {
        for (const messagingEvent of entry.messaging || []) {
          try {
            const messageProcessor = InstagramDMProcessor.getInstance();
            const result = await messageProcessor.processMessagingEvent({
              ...messagingEvent,
              instagramId: entry.id,
              timestamp: entry.time,
              requestId,
            });

            processingResults.push(result);
          } catch (error) {
            console.error('Failed to process Instagram DM event', {
              requestId,
              error: error.message,
              event: messagingEvent,
            });

            processingResults.push({
              success: false,
              error: error.message,
              eventId: messagingEvent.message?.mid || 'unknown',
            });
          }
        }
      }

      // Record performance metrics
      performanceMonitor.recordMetric({
        endpoint: '/webhooks/instagram-dm',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 200,
        requestSize: JSON.stringify(req.body).length,
        responseSize: JSON.stringify(processingResults).length,
        cacheHit: false,
        metadata: {
          eventsProcessed: processingResults.length,
          successfulEvents: processingResults.filter(r => r.success).length,
          requestId,
        },
      });

      // Return success response to Instagram
      res.status(200).json({
        success: true,
        eventsProcessed: processingResults.length,
        results: processingResults,
        requestId,
      });

      console.log('Instagram DM webhook processed successfully', {
        requestId,
        eventsProcessed: processingResults.length,
        successfulEvents: processingResults.filter(r => r.success).length,
      });
    } catch (error) {
      console.error('Instagram DM webhook processing failed', {
        requestId,
        error: error.message,
        stack: error.stack,
        body: req.body,
      });

      // Record error metrics
      performanceMonitor.recordMetric({
        endpoint: '/webhooks/instagram-dm',
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
        message: 'Failed to process Instagram DM webhook',
        requestId,
      });
    }
  });

/**
 * Handle Instagram webhook verification
 */
function handleWebhookVerification(req: Request, res: Response, requestId: string) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Instagram DM webhook verification requested', {
    requestId,
    mode,
    token: token ? 'provided' : 'missing',
    challenge: challenge ? 'provided' : 'missing',
  });

  // Verify the mode and token
  if (mode === 'subscribe' && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    console.log('Instagram DM webhook verified successfully', { requestId });
    res.status(200).send(challenge);
  } else {
    console.warn('Instagram DM webhook verification failed', {
      requestId,
      mode,
      tokenMatch: token === process.env.INSTAGRAM_VERIFY_TOKEN,
    });
    res.status(403).json({
      error: 'Forbidden',
      message: 'Webhook verification failed',
      requestId,
    });
  }
}

/**
 * Instagram DM Webhook Health Check
 * Provides health status for Instagram DM integration
 */
export const instagramDMWebhookHealth = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: 30,
    memory: '256MB',
  })
  .https.onRequest(async (req: Request, res: Response) => {
    try {
      const instagramService = InstagramGraphService.getInstance();
      const messageProcessor = InstagramDMProcessor.getInstance();

      // Check Instagram Graph API health
      const instagramHealth = await instagramService.checkHealth();

      // Check message processor health
      const processorHealth = await messageProcessor.checkHealth();

      // Get recent metrics
      const performanceMonitor = APIPerformanceMonitor.getInstance();
      const recentMetrics = performanceMonitor.getRecentMetrics('/webhooks/instagram-dm', 10);

      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          instagramGraphApi: instagramHealth,
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
          estimatedEffort: '2-3 weeks',
          dependencies: [
            'Instagram Business Account',
            'Graph API Access',
            'Instagram Basic Display API',
          ],
          notes: 'Requires Instagram Business Account and approval for Instagram Graph API access',
        },
      };

      // Determine overall health status
      if (!instagramHealth.healthy || !processorHealth.healthy) {
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
      console.error('Instagram DM webhook health check failed', {
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
