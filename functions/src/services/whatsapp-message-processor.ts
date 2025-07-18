/**
 * WhatsApp Message Processor for Fylgja
 * Handles processing of incoming WhatsApp messages and generates responses
 */

import { RedisCacheService } from '../cache/redis-cache-service';
import { CoreProcessor } from '../core/core-processor';
import { ResponsePersonalizer } from '../personalization/response-personalizer';
import { FylgjaError, ErrorType } from '../utils/error-handler';

import { EnhancedDatabaseService } from './enhanced-database-service';
import { TwilioService } from './twilio-service';

export interface WhatsAppMessageData {
  messageId: string;
  from: string;
  to: string;
  body: string;
  mediaUrl?: string | null;
  mediaContentType?: string | null;
  timestamp: Date;
  accountSid: string;
  messagingServiceSid?: string;
  numMedia: number;
  profileName?: string | null;
  waId?: string | null;
  requestId: string;
}

export interface WhatsAppStatusData {
  messageId: string;
  status: string;
  to: string;
  from: string;
  timestamp: Date;
  errorCode?: string | null;
  errorMessage?: string | null;
  requestId: string;
}

export interface MessageProcessingResult {
  success: boolean;
  messageId: string;
  responseGenerated: boolean;
  responseMessageId?: string;
  processingTime: number;
  error?: string;
  metadata?: any;
}

export class WhatsAppMessageProcessor {
  private static instance: WhatsAppMessageProcessor;
  private coreProcessor: CoreProcessor;
  private twilioService: TwilioService;
  private databaseService: EnhancedDatabaseService;
  private responsePersonalizer: ResponsePersonalizer;
  private cacheService: RedisCacheService;

  private constructor() {
    this.coreProcessor = CoreProcessor.getInstance();
    this.twilioService = TwilioService.getInstance();
    this.databaseService = EnhancedDatabaseService.getInstance();
    this.responsePersonalizer = ResponsePersonalizer.getInstance();
    this.cacheService = RedisCacheService.getInstance();
  }

  public static getInstance(): WhatsAppMessageProcessor {
    if (!WhatsAppMessageProcessor.instance) {
      WhatsAppMessageProcessor.instance = new WhatsAppMessageProcessor();
    }
    return WhatsAppMessageProcessor.instance;
  }

  /**
   * Process incoming WhatsApp message
   */
  public async processIncomingMessage(
    messageData: WhatsAppMessageData
  ): Promise<MessageProcessingResult> {
    const startTime = Date.now();

    try {
      console.log('Processing WhatsApp message', {
        messageId: messageData.messageId,
        from: messageData.from,
        bodyLength: messageData.body.length,
        hasMedia: messageData.numMedia > 0,
      });

      // Extract user phone number (remove WhatsApp prefix)
      const userPhone = this.extractPhoneNumber(messageData.from);

      // Get or create user profile
      const userProfile = await this.getOrCreateUserProfile(userPhone, messageData);

      // Check for media content
      let mediaContent = null;
      if (messageData.numMedia > 0 && messageData.mediaUrl) {
        mediaContent = await this.processMediaContent(messageData);
      }

      // Prepare message context
      const messageContext = {
        platform: 'whatsapp',
        userId: userProfile.id,
        userPhone: userPhone,
        messageId: messageData.messageId,
        timestamp: messageData.timestamp,
        mediaContent,
        profileName: messageData.profileName,
        waId: messageData.waId,
        requestId: messageData.requestId,
      };

      // Process message through core processor
      const coreResponse = await this.coreProcessor.processMessage({
        userId: userProfile.id,
        message: messageData.body,
        platform: 'whatsapp',
        context: messageContext,
        userProfile: userProfile,
      });

      // Personalize response for WhatsApp
      const personalizedResponse = await this.responsePersonalizer.personalizeResponse({
        response: coreResponse.response,
        userId: userProfile.id,
        platform: 'whatsapp',
        context: messageContext,
        userPreferences: userProfile.preferences,
      });

      // Send response via WhatsApp
      let responseMessageId: string | undefined;
      let responseGenerated = false;

      if (personalizedResponse.shouldRespond && personalizedResponse.content) {
        const sendResult = await this.sendWhatsAppResponse(
          userPhone,
          personalizedResponse.content,
          messageData.requestId
        );

        if (sendResult.success) {
          responseMessageId = sendResult.messageId;
          responseGenerated = true;
        }
      }

      // Store conversation in database
      await this.storeConversation({
        userId: userProfile.id,
        platform: 'whatsapp',
        incomingMessage: {
          messageId: messageData.messageId,
          content: messageData.body,
          timestamp: messageData.timestamp,
          mediaContent,
        },
        outgoingMessage: responseGenerated
          ? {
              messageId: responseMessageId!,
              content: personalizedResponse.content!,
              timestamp: new Date(),
            }
          : null,
        context: messageContext,
        coreResponse: coreResponse,
      });

      // Update user engagement metrics
      await this.updateUserEngagement(userProfile.id, {
        platform: 'whatsapp',
        messageReceived: true,
        responseGenerated,
        processingTime: Date.now() - startTime,
        hasMedia: messageData.numMedia > 0,
      });

      const result: MessageProcessingResult = {
        success: true,
        messageId: messageData.messageId,
        responseGenerated,
        responseMessageId,
        processingTime: Date.now() - startTime,
        metadata: {
          userId: userProfile.id,
          coreResponseType: coreResponse.type,
          personalizedResponseType: personalizedResponse.type,
        },
      };

      console.log('WhatsApp message processed successfully', {
        messageId: messageData.messageId,
        userId: userProfile.id,
        responseGenerated,
        processingTime: result.processingTime,
      });

      return result;
    } catch (error) {
      console.error('Failed to process WhatsApp message', {
        messageId: messageData.messageId,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        messageId: messageData.messageId,
        responseGenerated: false,
        processingTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Process WhatsApp status update
   */
  public async processStatusUpdate(statusData: WhatsAppStatusData): Promise<void> {
    try {
      console.log('Processing WhatsApp status update', {
        messageId: statusData.messageId,
        status: statusData.status,
        hasError: !!statusData.errorCode,
      });

      // Update message status in database
      await this.databaseService.updateMessageStatus({
        messageId: statusData.messageId,
        status: statusData.status,
        timestamp: statusData.timestamp,
        errorCode: statusData.errorCode,
        errorMessage: statusData.errorMessage,
      });

      // Handle delivery failures
      if (statusData.errorCode) {
        await this.handleDeliveryFailure(statusData);
      }

      // Update delivery metrics
      await this.updateDeliveryMetrics(statusData);

      console.log('WhatsApp status update processed successfully', {
        messageId: statusData.messageId,
        status: statusData.status,
      });
    } catch (error) {
      console.error('Failed to process WhatsApp status update', {
        messageId: statusData.messageId,
        error: error.message,
        stack: error.stack,
      });

      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Failed to process WhatsApp status update',
        context: {
          messageId: statusData.messageId,
          status: statusData.status,
          error: error.message,
        },
      });
    }
  }

  /**
   * Send WhatsApp response message
   */
  private async sendWhatsAppResponse(
    userPhone: string,
    content: string,
    requestId: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Format phone number for WhatsApp
      const whatsappNumber = `whatsapp:${userPhone}`;

      // Send message via Twilio
      const result = await this.twilioService.sendWhatsAppMessage({
        to: whatsappNumber,
        body: content,
        requestId,
      });

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      console.error('Failed to send WhatsApp response', {
        userPhone,
        error: error.message,
        requestId,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Extract phone number from WhatsApp format
   */
  private extractPhoneNumber(whatsappNumber: string): string {
    // Remove 'whatsapp:' prefix if present
    return whatsappNumber.replace(/^whatsapp:/, '');
  }

  /**
   * Get or create user profile for WhatsApp user
   */
  private async getOrCreateUserProfile(
    userPhone: string,
    messageData: WhatsAppMessageData
  ): Promise<any> {
    try {
      // Check cache first
      const cacheKey = `user_profile:whatsapp:${userPhone}`;
      const cachedProfile = await this.cacheService.get(cacheKey);

      if (cachedProfile) {
        return cachedProfile;
      }

      // Try to find existing user by phone number
      let userProfile = await this.databaseService.getUserByPhone(userPhone);

      if (!userProfile) {
        // Create new user profile
        userProfile = await this.databaseService.createUser({
          phone: userPhone,
          platform: 'whatsapp',
          profileName: messageData.profileName,
          waId: messageData.waId,
          preferences: {
            platform: 'whatsapp',
            timezone: 'UTC', // Will be updated based on user interaction
            language: 'en',
            communicationStyle: 'friendly',
            notificationSettings: {
              dailyCheckIns: true,
              reminders: true,
              summaries: true,
            },
          },
          createdAt: new Date(),
          lastActiveAt: new Date(),
        });

        console.log('Created new WhatsApp user profile', {
          userId: userProfile.id,
          phone: userPhone,
          profileName: messageData.profileName,
        });
      } else {
        // Update last active time
        await this.databaseService.updateUserLastActive(userProfile.id);
      }

      // Cache user profile
      await this.cacheService.set(cacheKey, userProfile, 3600); // Cache for 1 hour

      return userProfile;
    } catch (error) {
      console.error('Failed to get or create user profile', {
        userPhone,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.DATABASE_ERROR,
        message: 'Failed to get or create user profile',
        context: { userPhone, error: error.message },
      });
    }
  }

  /**
   * Process media content from WhatsApp message
   */
  private async processMediaContent(messageData: WhatsAppMessageData): Promise<any> {
    try {
      if (!messageData.mediaUrl) {
        return null;
      }

      // Download media content
      const mediaContent = await this.twilioService.downloadMedia(messageData.mediaUrl);

      // Process based on media type
      const processedContent = {
        type: messageData.mediaContentType,
        url: messageData.mediaUrl,
        size: mediaContent.length,
        timestamp: messageData.timestamp,
      };

      // Handle different media types
      if (messageData.mediaContentType?.startsWith('image/')) {
        // Process image content (could include image analysis)
        processedContent['isImage'] = true;
      } else if (messageData.mediaContentType?.startsWith('audio/')) {
        // Process audio content (could include speech-to-text)
        processedContent['isAudio'] = true;
      } else if (messageData.mediaContentType?.startsWith('video/')) {
        // Process video content
        processedContent['isVideo'] = true;
      }

      return processedContent;
    } catch (error) {
      console.error('Failed to process media content', {
        messageId: messageData.messageId,
        mediaUrl: messageData.mediaUrl,
        error: error.message,
      });

      return {
        type: messageData.mediaContentType,
        url: messageData.mediaUrl,
        error: error.message,
        timestamp: messageData.timestamp,
      };
    }
  }

  /**
   * Store conversation in database
   */
  private async storeConversation(conversationData: any): Promise<void> {
    try {
      await this.databaseService.storeConversation({
        userId: conversationData.userId,
        platform: conversationData.platform,
        conversationId: `whatsapp-${conversationData.incomingMessage.messageId}`,
        messages: [
          {
            type: 'incoming',
            messageId: conversationData.incomingMessage.messageId,
            content: conversationData.incomingMessage.content,
            timestamp: conversationData.incomingMessage.timestamp,
            mediaContent: conversationData.incomingMessage.mediaContent,
          },
          ...(conversationData.outgoingMessage
            ? [
                {
                  type: 'outgoing',
                  messageId: conversationData.outgoingMessage.messageId,
                  content: conversationData.outgoingMessage.content,
                  timestamp: conversationData.outgoingMessage.timestamp,
                },
              ]
            : []),
        ],
        context: conversationData.context,
        coreResponse: conversationData.coreResponse,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Failed to store conversation', {
        userId: conversationData.userId,
        messageId: conversationData.incomingMessage.messageId,
        error: error.message,
      });

      // Don't throw error for storage failures to avoid blocking message processing
    }
  }

  /**
   * Update user engagement metrics
   */
  private async updateUserEngagement(userId: string, engagementData: any): Promise<void> {
    try {
      await this.databaseService.updateUserEngagement(userId, {
        platform: engagementData.platform,
        lastMessageAt: new Date(),
        messageCount: 1,
        responseGenerated: engagementData.responseGenerated,
        averageProcessingTime: engagementData.processingTime,
        hasMediaInteraction: engagementData.hasMedia,
      });
    } catch (error) {
      console.error('Failed to update user engagement', {
        userId,
        error: error.message,
      });

      // Don't throw error for metrics failures
    }
  }

  /**
   * Handle delivery failure
   */
  private async handleDeliveryFailure(statusData: WhatsAppStatusData): Promise<void> {
    try {
      console.warn('WhatsApp message delivery failed', {
        messageId: statusData.messageId,
        errorCode: statusData.errorCode,
        errorMessage: statusData.errorMessage,
      });

      // Store delivery failure for analysis
      await this.databaseService.storeDeliveryFailure({
        messageId: statusData.messageId,
        platform: 'whatsapp',
        errorCode: statusData.errorCode,
        errorMessage: statusData.errorMessage,
        timestamp: statusData.timestamp,
        recipientPhone: statusData.to,
      });

      // Implement retry logic for certain error types
      if (this.shouldRetryDelivery(statusData.errorCode)) {
        // Schedule retry (implementation depends on retry strategy)
        console.log('Scheduling delivery retry', {
          messageId: statusData.messageId,
          errorCode: statusData.errorCode,
        });
      }
    } catch (error) {
      console.error('Failed to handle delivery failure', {
        messageId: statusData.messageId,
        error: error.message,
      });
    }
  }

  /**
   * Update delivery metrics
   */
  private async updateDeliveryMetrics(statusData: WhatsAppStatusData): Promise<void> {
    try {
      const metrics = {
        platform: 'whatsapp',
        status: statusData.status,
        timestamp: statusData.timestamp,
        hasError: !!statusData.errorCode,
        errorCode: statusData.errorCode,
      };

      await this.databaseService.updateDeliveryMetrics(statusData.messageId, metrics);
    } catch (error) {
      console.error('Failed to update delivery metrics', {
        messageId: statusData.messageId,
        error: error.message,
      });
    }
  }

  /**
   * Check if delivery should be retried based on error code
   */
  private shouldRetryDelivery(errorCode?: string): boolean {
    if (!errorCode) {
      return false;
    }

    // Retry for temporary errors
    const retryableErrors = [
      '30001', // Queue overflow
      '30002', // Account suspended
      '30003', // Unreachable destination handset
      '30004', // Message blocked
      '30005', // Unknown destination handset
      '30006', // Landline or unreachable carrier
      '30007', // Carrier violation
      '30008', // Unknown error
    ];

    return retryableErrors.includes(errorCode);
  }

  /**
   * Check service health
   */
  public async checkHealth(): Promise<{ healthy: boolean; details: any }> {
    try {
      const twilioHealth = await this.twilioService.checkHealth();
      const databaseHealth = await this.databaseService.checkHealth();
      const cacheHealth = await this.cacheService.checkHealth();

      const healthy = twilioHealth.healthy && databaseHealth.healthy && cacheHealth.healthy;

      return {
        healthy,
        details: {
          twilio: twilioHealth,
          database: databaseHealth,
          cache: cacheHealth,
          timestamp: new Date().toISOString(),
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
}
