/**
 * Twilio Service for Fylgja WhatsApp Integration
 * Handles Twilio API interactions for WhatsApp messaging
 */

import * as crypto from 'crypto';

import { Twilio } from 'twilio';

import { RedisCacheService } from '../cache/redis-cache-service';
import { FylgjaError, ErrorType } from '../utils/error-handler';

export interface WhatsAppMessageRequest {
  to: string;
  body: string;
  mediaUrl?: string;
  requestId?: string;
}

export interface WhatsAppMessageResponse {
  messageId: string;
  status: string;
  to: string;
  from: string;
  timestamp: Date;
}

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  whatsappNumber: string;
  webhookUrl: string;
  statusWebhookUrl: string;
}

export class TwilioService {
  private static instance: TwilioService;
  private twilioClient: Twilio;
  private config: TwilioConfig;
  private cacheService: RedisCacheService;

  private constructor() {
    this.config = this.loadConfig();
    this.twilioClient = new Twilio(this.config.accountSid, this.config.authToken);
    this.cacheService = RedisCacheService.getInstance();
  }

  public static getInstance(): TwilioService {
    if (!TwilioService.instance) {
      TwilioService.instance = new TwilioService();
    }
    return TwilioService.instance;
  }

  /**
   * Load Twilio configuration from environment variables
   */
  private loadConfig(): TwilioConfig {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
    const webhookUrl = process.env.TWILIO_WEBHOOK_URL;
    const statusWebhookUrl = process.env.TWILIO_STATUS_WEBHOOK_URL;

    if (!accountSid || !authToken || !whatsappNumber) {
      throw new FylgjaError({
        type: ErrorType.CONFIGURATION_ERROR,
        message: 'Missing required Twilio configuration',
        context: {
          hasAccountSid: !!accountSid,
          hasAuthToken: !!authToken,
          hasWhatsappNumber: !!whatsappNumber,
        },
      });
    }

    return {
      accountSid,
      authToken,
      whatsappNumber,
      webhookUrl: webhookUrl || '',
      statusWebhookUrl: statusWebhookUrl || '',
    };
  }

  /**
   * Send WhatsApp message via Twilio
   */
  public async sendWhatsAppMessage(
    request: WhatsAppMessageRequest
  ): Promise<WhatsAppMessageResponse> {
    try {
      console.log('Sending WhatsApp message via Twilio', {
        to: request.to,
        bodyLength: request.body.length,
        hasMedia: !!request.mediaUrl,
        requestId: request.requestId,
      });

      // Prepare message options
      const messageOptions: any = {
        from: `whatsapp:${this.config.whatsappNumber}`,
        to: request.to,
        body: request.body,
      };

      // Add media URL if provided
      if (request.mediaUrl) {
        messageOptions.mediaUrl = [request.mediaUrl];
      }

      // Add status callback URL
      if (this.config.statusWebhookUrl) {
        messageOptions.statusCallback = this.config.statusWebhookUrl;
      }

      // Send message
      const message = await this.twilioClient.messages.create(messageOptions);

      const response: WhatsAppMessageResponse = {
        messageId: message.sid,
        status: message.status,
        to: message.to,
        from: message.from,
        timestamp: new Date(),
      };

      console.log('WhatsApp message sent successfully', {
        messageId: response.messageId,
        status: response.status,
        to: response.to,
        requestId: request.requestId,
      });

      // Cache message for tracking
      await this.cacheMessage(response, request.requestId);

      return response;
    } catch (error) {
      console.error('Failed to send WhatsApp message', {
        to: request.to,
        error: error.message,
        requestId: request.requestId,
      });

      throw new FylgjaError({
        type: ErrorType.EXTERNAL_SERVICE_ERROR,
        message: 'Failed to send WhatsApp message via Twilio',
        context: {
          to: request.to,
          error: error.message,
          requestId: request.requestId,
        },
      });
    }
  }

  /**
   * Validate Twilio webhook signature for security
   */
  public validateWebhookSignature(signature: string, url: string, params: any): boolean {
    try {
      if (!signature) {
        console.warn('Missing Twilio webhook signature');
        return false;
      }

      // Create validation string from URL and parameters
      let validationString = url;

      // Sort parameters and append to validation string
      const sortedParams = Object.keys(params).sort();
      for (const key of sortedParams) {
        validationString += key + params[key];
      }

      // Create HMAC SHA1 hash
      const expectedSignature = crypto
        .createHmac('sha1', this.config.authToken)
        .update(validationString, 'utf8')
        .digest('base64');

      // Compare signatures
      const isValid = signature === expectedSignature;

      if (!isValid) {
        console.warn('Invalid Twilio webhook signature', {
          provided: signature,
          expected: expectedSignature,
          url,
          validationString: validationString.substring(0, 100) + '...',
        });
      }

      return isValid;
    } catch (error) {
      console.error('Error validating Twilio webhook signature', {
        error: error.message,
        signature,
        url,
      });
      return false;
    }
  }

  /**
   * Download media content from Twilio
   */
  public async downloadMedia(mediaUrl: string): Promise<Buffer> {
    try {
      console.log('Downloading media from Twilio', { mediaUrl });

      // Check cache first
      const cacheKey = `media:${crypto.createHash('md5').update(mediaUrl).digest('hex')}`;
      const cachedMedia = await this.cacheService.get(cacheKey);

      if (cachedMedia) {
        console.log('Media found in cache', { mediaUrl });
        return Buffer.from(cachedMedia, 'base64');
      }

      // Download media using Twilio client
      const response = await fetch(mediaUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const mediaBuffer = Buffer.from(await response.arrayBuffer());

      // Cache media for future use (cache for 1 hour)
      await this.cacheService.set(cacheKey, mediaBuffer.toString('base64'), 3600);

      console.log('Media downloaded successfully', {
        mediaUrl,
        size: mediaBuffer.length,
      });

      return mediaBuffer;
    } catch (error) {
      console.error('Failed to download media from Twilio', {
        mediaUrl,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.EXTERNAL_SERVICE_ERROR,
        message: 'Failed to download media from Twilio',
        context: {
          mediaUrl,
          error: error.message,
        },
      });
    }
  }

  /**
   * Get message status from Twilio
   */
  public async getMessageStatus(messageId: string): Promise<any> {
    try {
      console.log('Getting message status from Twilio', { messageId });

      const message = await this.twilioClient.messages(messageId).fetch();

      const status = {
        messageId: message.sid,
        status: message.status,
        to: message.to,
        from: message.from,
        dateCreated: message.dateCreated,
        dateSent: message.dateSent,
        dateUpdated: message.dateUpdated,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage,
        price: message.price,
        priceUnit: message.priceUnit,
      };

      console.log('Message status retrieved successfully', {
        messageId,
        status: status.status,
      });

      return status;
    } catch (error) {
      console.error('Failed to get message status from Twilio', {
        messageId,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.EXTERNAL_SERVICE_ERROR,
        message: 'Failed to get message status from Twilio',
        context: {
          messageId,
          error: error.message,
        },
      });
    }
  }

  /**
   * List recent messages from Twilio
   */
  public async listRecentMessages(limit = 20): Promise<any[]> {
    try {
      console.log('Listing recent messages from Twilio', { limit });

      const messages = await this.twilioClient.messages.list({
        limit,
        from: `whatsapp:${this.config.whatsappNumber}`,
      });

      const messageList = messages.map(message => ({
        messageId: message.sid,
        status: message.status,
        to: message.to,
        from: message.from,
        body: message.body,
        dateCreated: message.dateCreated,
        dateSent: message.dateSent,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage,
      }));

      console.log('Recent messages retrieved successfully', {
        count: messageList.length,
      });

      return messageList;
    } catch (error) {
      console.error('Failed to list recent messages from Twilio', {
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.EXTERNAL_SERVICE_ERROR,
        message: 'Failed to list recent messages from Twilio',
        context: {
          error: error.message,
        },
      });
    }
  }

  /**
   * Configure WhatsApp webhook URLs
   */
  public async configureWebhooks(): Promise<void> {
    try {
      console.log('Configuring WhatsApp webhooks', {
        webhookUrl: this.config.webhookUrl,
        statusWebhookUrl: this.config.statusWebhookUrl,
      });

      // Update webhook configuration for WhatsApp number
      if (this.config.webhookUrl) {
        // Note: Webhook configuration is typically done through Twilio Console
        // This is a placeholder for programmatic webhook configuration
        console.log('Webhook configuration should be done through Twilio Console');
      }
    } catch (error) {
      console.error('Failed to configure webhooks', {
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.CONFIGURATION_ERROR,
        message: 'Failed to configure WhatsApp webhooks',
        context: {
          error: error.message,
        },
      });
    }
  }

  /**
   * Cache message for tracking
   */
  private async cacheMessage(message: WhatsAppMessageResponse, requestId?: string): Promise<void> {
    try {
      const cacheKey = `message:${message.messageId}`;
      const cacheData = {
        ...message,
        requestId,
        cachedAt: new Date().toISOString(),
      };

      // Cache for 24 hours
      await this.cacheService.set(cacheKey, cacheData, 86400);
    } catch (error) {
      console.error('Failed to cache message', {
        messageId: message.messageId,
        error: error.message,
      });
      // Don't throw error for caching failures
    }
  }

  /**
   * Get account information from Twilio
   */
  public async getAccountInfo(): Promise<any> {
    try {
      const account = await this.twilioClient.api.accounts(this.config.accountSid).fetch();

      return {
        accountSid: account.sid,
        friendlyName: account.friendlyName,
        status: account.status,
        type: account.type,
        dateCreated: account.dateCreated,
        dateUpdated: account.dateUpdated,
      };
    } catch (error) {
      console.error('Failed to get account info from Twilio', {
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.EXTERNAL_SERVICE_ERROR,
        message: 'Failed to get account info from Twilio',
        context: {
          error: error.message,
        },
      });
    }
  }

  /**
   * Check Twilio service health
   */
  public async checkHealth(): Promise<{ healthy: boolean; details: any }> {
    try {
      // Test API connectivity by fetching account info
      const account = await this.getAccountInfo();

      // Check if account is active
      const healthy = account.status === 'active';

      return {
        healthy,
        details: {
          accountStatus: account.status,
          accountSid: account.accountSid,
          timestamp: new Date().toISOString(),
          whatsappNumber: this.config.whatsappNumber,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          error: error.message,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Get usage statistics from Twilio
   */
  public async getUsageStatistics(
    period: 'today' | 'yesterday' | 'last_week' | 'last_month' = 'today'
  ): Promise<any> {
    try {
      console.log('Getting usage statistics from Twilio', { period });

      // Calculate date range based on period
      const endDate = new Date();
      const startDate = new Date();

      switch (period) {
        case 'yesterday':
          startDate.setDate(endDate.getDate() - 1);
          endDate.setDate(endDate.getDate() - 1);
          break;
        case 'last_week':
          startDate.setDate(endDate.getDate() - 7);
          break;
        case 'last_month':
          startDate.setMonth(endDate.getMonth() - 1);
          break;
        default: // today
          startDate.setHours(0, 0, 0, 0);
          break;
      }

      // Get usage records
      const usage = await this.twilioClient.usage.records.list({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        category: 'messages',
      });

      const statistics = {
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        totalMessages: 0,
        totalCost: 0,
        currency: 'USD',
        records: usage.map(record => ({
          category: record.category,
          description: record.description,
          count: record.count,
          usage: record.usage,
          price: record.price,
          priceUnit: record.priceUnit,
        })),
      };

      // Calculate totals
      statistics.totalMessages = usage.reduce((sum, record) => sum + parseInt(record.count), 0);
      statistics.totalCost = usage.reduce((sum, record) => sum + parseFloat(record.price), 0);

      console.log('Usage statistics retrieved successfully', {
        period,
        totalMessages: statistics.totalMessages,
        totalCost: statistics.totalCost,
      });

      return statistics;
    } catch (error) {
      console.error('Failed to get usage statistics from Twilio', {
        period,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.EXTERNAL_SERVICE_ERROR,
        message: 'Failed to get usage statistics from Twilio',
        context: {
          period,
          error: error.message,
        },
      });
    }
  }
}
