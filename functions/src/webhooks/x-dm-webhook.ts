/**
 * X (Twitter) DM Webhook Handler for Fylgja
 * Handles incoming X Direct Messages via X API v2
 * 
 * PLACEHOLDER IMPLEMENTATION - Ready for development
 */

import * as functions from 'firebase-functions';
import { Request, Response } from 'express';
import { XDMProcessor } from '../services/x-dm-processor';
import { XAPIService } from '../services/x-api-service';
import { APIValidator } from '../validation/api-validator';
import { APIPerformanceMonitor } from '../monitoring/api-performance-monitor';
import { FylgjaError, ErrorType } from '../utils/error-handler';
import { RateLimiter } from '../utils/rate-limiter';
import * as crypto from 'crypto';

// X DM webhook configuration
const webhookConfig = {
  timeoutSeconds: 60,
  memory: '512MB' as const,
  region: 'us-central1'
};

/**
 * X DM Webhook Handler
 * Processes incoming X Direct Messages
 */
export const xDMWebhook = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: webhookConfig.timeoutSeconds,
    memory: webhookConfig.memory
  })
  .https.onRequest(async (req: Request, res: Response) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();
    const requestId = `x-dm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      console.log('X DM webhook received', {
        requestId,
        method: req.method,
        headers: req.headers,
        body: req.body,
        timestamp: new Date().toISOString()
      });

      // Handle webhook verification (GET request for CRC)
      if (req.method === 'GET') {
        return handleCRCChallenge(req, res, requestId);
      }

      // Validate HTTP method for message processing
      if (req.method !== 'POST') {
        return res.status(405).json({
          error: 'Method not allowed',
          message: 'X DM webhook only accepts GET (CRC) and POST (events) requests',
          requestId
        });
      }

      // Validate X signature for security
      const xApiService = XAPIService.getInstance();
      const isValidSignature = xApiService.validateWebhookSignature(
        req.headers['x-twitter-webhooks-signature'] as string,
        JSON.stringify(req.body)
      );

      if (!isValidSignature) {
        console.warn('Invalid X signature detected', {
          requestId,
          signature: req.headers['x-twitter-webhooks-signature']
        });

        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook signature',
          requestId
        });
      }

      // Rate limiting check
      const rateLimiter = RateLimiter.getInstance();
      const clientId = req.body.direct_message_events?.[0]?.message_create?.sender_id || req.ip;
      const rateLimitResult = await rateLimiter.checkLimit(clientId, 'x_dm_webhook');

      if (!rateLimitResult.allowed) {
        console.warn('Rate limit exceeded for X DM webhook', {
          requestId,
          clientId,
          remainingPoints: rateLimitResult.remainingPoints,
          resetTime: rateLimitResult.resetTime
        });

        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: rateLimitResult.resetTime,
          requestId
        });
      }

      // Validate webhook payload
      const validator = APIValidator.getInstance();
      const validationResult = validator.validateXDMWebhook(req.body);

      if (!validationResult.isValid) {
        console.error('Invalid X DM webhook payload', {
          requestId,
          errors: validationResult.errors,
          payload: req.body
        });

        return res.status(400).json({
          error: 'Invalid payload',
          message: 'Webhook payload validation failed',
          details: validationResult.errors,
          requestId
        });
      }

      // Process direct message events
      const processingResults = [];
      
      for (const dmEvent of req.body.direct_message_events || []) {
        try {
          const messageProcessor = XDMProcessor.getInstance();
          const result = await messageProcessor.processDirectMessageEvent({
            ...dmEvent,
            users: req.body.users,
            apps: req.body.apps,
            requestId
          });
          
          processingResults.push(result);
        } catch (error) {
          console.error('Failed to process X DM event', {
            requestId,
            error: error.message,
            event: dmEvent
          });
          
          processingResults.push({
            success: false,
            error: error.message,
            eventId: dmEvent.id || 'unknown'
          });
        }
      }

      // Record performance metrics
      performanceMonitor.recordMetric({
        endpoint: '/webhooks/x-dm',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 200,
        requestSize: JSON.stringify(req.body).length,
        responseSize: JSON.stringify(processingResults).length,
        cacheHit: false,
        metadata: {
          eventsProcessed: processingResults.length,
          successfulEvents: processingResults.filter(r => r.success).length,
          requestId
        }
      });

      // Return success response to X
      res.status(200).json({
        success: true,
        eventsProcessed: processingResults.length,
        results: processingResults,
        requestId
      });

      console.log('X DM webhook processed successfully', {
        requestId,
        eventsProcessed: processingResults.length,
        successfulEvents: processingResults.filter(r => r.success).length
      });

    } catch (error) {
      console.error('X DM webhook processing failed', {
        requestId,
        error: error.message,
        stack: error.stack,
        body: req.body
      });

      // Record error metrics
      performanceMonitor.recordMetric({
        endpoint: '/webhooks/x-dm',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 500,
        requestSize: JSON.stringify(req.body).length,
        responseSize: 0,
        cacheHit: false,
        metadata: {
          error: error.message,
          requestId
        }
      });

      // Return error response
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to process X DM webhook',
        requestId
      });
    }
  });

/**
 * Handle X webhook CRC (Challenge Response Check)
 */
function handleCRCChallenge(req: Request, res: Response, requestId: string) {
  const crcToken = req.query.crc_token as string;

  console.log('X DM webhook CRC challenge requested', {
    requestId,
    crcToken: crcToken ? 'provided' : 'missing'
  });

  if (!crcToken) {
    console.warn('X DM webhook CRC challenge missing token', { requestId });
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Missing crc_token parameter',
      requestId
    });
  }

  try {
    // Create HMAC SHA256 hash of the CRC token
    const consumerSecret = process.env.X_CONSUMER_SECRET;
    if (!consumerSecret) {
      throw new Error('Missing X_CONSUMER_SECRET environment variable');
    }

    const hmac = crypto.createHmac('sha256', consumerSecret);
    hmac.update(crcToken);
    const responseToken = 'sha256=' + hmac.digest('base64');

    console.log('X DM webhook CRC challenge responded successfully', { requestId });
    
    res.status(200).json({
      response_token: responseToken
    });

  } catch (error) {
    console.error('X DM webhook CRC challenge failed', {
      requestId,
      error: error.message
    });

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to generate CRC response',
      requestId
    });
  }
}

/**
 * X DM Webhook Health Check
 * Provides health status for X DM integration
 */
export const xDMWebhookHealth = functions
  .region(webhookConfig.region)
  .runWith({
    timeoutSeconds: 30,
    memory: '256MB'
  })
  .https.onRequest(async (req: Request, res: Response) => {
    try {
      const xApiService = XAPIService.getInstance();
      const messageProcessor = XDMProcessor.getInstance();

      // Check X API health
      const xApiHealth = await xApiService.checkHealth();
      
      // Check message processor health
      const processorHealth = await messageProcessor.checkHealth();

      // Get recent metrics
      const performanceMonitor = APIPerformanceMonitor.getInstance();
      const recentMetrics = performanceMonitor.getRecentMetrics('/webhooks/x-dm', 10);

      const healthStatus = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          xApi: xApiHealth,
          messageProcessor: processorHealth
        },
        metrics: {
          recentRequests: recentMetrics.length,
          averageResponseTime: recentMetrics.length > 0 
            ? recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length 
            : 0,
          successRate: recentMetrics.length > 0 
            ? recentMetrics.filter(m => m.statusCode < 400).length / recentMetrics.length 
            : 1
        },
        placeholder: {
          implemented: false,
          readyForDevelopment: true,
          estimatedEffort: '3-4 weeks',
          dependencies: ['X Developer Account', 'X API v2 Access', 'Premium/Enterprise API Access'],
          notes: 'Requires X API Premium or Enterprise access for DM functionality. Free tier has limited DM capabilities.'
        }
      };

      // Determine overall health status
      if (!xApiHealth.healthy || !processorHealth.healthy) {
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
      console.error('X DM webhook health check failed', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
        placeholder: {
          implemented: false,
          readyForDevelopment: true
        }
      });
    }
  });

