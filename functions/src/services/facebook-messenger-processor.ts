/**
 * Facebook Messenger Processor for Fylgja
 * Handles processing of incoming Facebook Messenger messages
 *
 * PLACEHOLDER IMPLEMENTATION - Ready for development
 */

import { RedisCacheService } from '../cache/redis-cache-service';
import { CoreProcessor } from '../core/core-processor';
import { ResponsePersonalizer } from '../personalization/response-personalizer';
import { FylgjaError, ErrorType } from '../utils/error-handler';

import { EnhancedDatabaseService } from './enhanced-database-service';
import { FacebookGraphService } from './facebook-graph-service';

export interface FacebookMessengerEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: {
        url?: string;
        sticker_id?: number;
      };
    }>;
    quick_reply?: {
      payload: string;
    };
  };
  postback?: {
    title: string;
    payload: string;
  };
  delivery?: {
    mids: string[];
    watermark: number;
  };
  read?: {
    watermark: number;
  };
  pageId: string;
  requestId: string;
}

export interface MessengerProcessingResult {
  success: boolean;
  messageId: string;
  responseGenerated: boolean;
  responseMessageId?: string;
  processingTime: number;
  error?: string;
  metadata?: any;
}

export class FacebookMessengerProcessor {
  private static instance: FacebookMessengerProcessor;
  private coreProcessor: CoreProcessor;
  private facebookService: FacebookGraphService;
  private databaseService: EnhancedDatabaseService;
  private responsePersonalizer: ResponsePersonalizer;
  private cacheService: RedisCacheService;

  private constructor() {
    this.coreProcessor = CoreProcessor.getInstance();
    this.facebookService = FacebookGraphService.getInstance();
    this.databaseService = EnhancedDatabaseService.getInstance();
    this.responsePersonalizer = ResponsePersonalizer.getInstance();
    this.cacheService = RedisCacheService.getInstance();
  }

  public static getInstance(): FacebookMessengerProcessor {
    if (!FacebookMessengerProcessor.instance) {
      FacebookMessengerProcessor.instance = new FacebookMessengerProcessor();
    }
    return FacebookMessengerProcessor.instance;
  }

  /**
   * Process Facebook Messenger messaging event
   */
  public async processMessagingEvent(
    event: FacebookMessengerEvent
  ): Promise<MessengerProcessingResult> {
    const startTime = Date.now();

    try {
      console.log('Processing Facebook Messenger event', {
        senderId: event.sender.id,
        messageId: event.message?.mid,
        hasText: !!event.message?.text,
        hasAttachments: !!event.message?.attachments?.length,
        hasPostback: !!event.postback,
        requestId: event.requestId,
      });

      // Handle different event types
      if (event.message) {
        return await this.processMessage(event, startTime);
      } else if (event.postback) {
        return await this.processPostback(event, startTime);
      } else if (event.delivery) {
        return await this.processDelivery(event, startTime);
      } else if (event.read) {
        return await this.processRead(event, startTime);
      } else {
        console.warn('Unknown Facebook Messenger event type', {
          event,
          requestId: event.requestId,
        });

        return {
          success: true,
          messageId: 'unknown',
          responseGenerated: false,
          processingTime: Date.now() - startTime,
          metadata: { eventType: 'unknown' },
        };
      }
    } catch (error) {
      console.error('Failed to process Facebook Messenger event', {
        senderId: event.sender.id,
        error: error.message,
        requestId: event.requestId,
      });

      return {
        success: false,
        messageId: event.message?.mid || 'unknown',
        responseGenerated: false,
        processingTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Process incoming message
   */
  private async processMessage(
    event: FacebookMessengerEvent,
    startTime: number
  ): Promise<MessengerProcessingResult> {
    const messageId = event.message!.mid;
    const senderId = event.sender.id;

    // Get or create user profile
    const userProfile = await this.getOrCreateUserProfile(senderId, event);

    // Extract message content
    const messageContent = this.extractMessageContent(event.message!);

    // Prepare message context
    const messageContext = {
      platform: 'facebook_messenger',
      userId: userProfile.id,
      facebookId: senderId,
      pageId: event.pageId,
      messageId,
      timestamp: new Date(event.timestamp),
      attachments: event.message!.attachments,
      quickReply: event.message!.quick_reply,
      requestId: event.requestId,
    };

    // Process message through core processor
    const coreResponse = await this.coreProcessor.processMessage({
      userId: userProfile.id,
      message: messageContent,
      platform: 'facebook_messenger',
      context: messageContext,
      userProfile: userProfile,
    });

    // Personalize response for Facebook Messenger
    const personalizedResponse = await this.responsePersonalizer.personalizeResponse({
      response: coreResponse.response,
      userId: userProfile.id,
      platform: 'facebook_messenger',
      context: messageContext,
      userPreferences: userProfile.preferences,
    });

    // Send response via Facebook Messenger
    let responseMessageId: string | undefined;
    let responseGenerated = false;

    if (personalizedResponse.shouldRespond && personalizedResponse.content) {
      const sendResult = await this.sendMessengerResponse(
        senderId,
        personalizedResponse.content,
        event.requestId
      );

      if (sendResult.success) {
        responseMessageId = sendResult.messageId;
        responseGenerated = true;
      }
    }

    // Store conversation in database
    await this.storeConversation({
      userId: userProfile.id,
      platform: 'facebook_messenger',
      incomingMessage: {
        messageId,
        content: messageContent,
        timestamp: new Date(event.timestamp),
        attachments: event.message!.attachments,
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
      platform: 'facebook_messenger',
      messageReceived: true,
      responseGenerated,
      processingTime: Date.now() - startTime,
      hasAttachments: !!event.message!.attachments?.length,
    });

    return {
      success: true,
      messageId,
      responseGenerated,
      responseMessageId,
      processingTime: Date.now() - startTime,
      metadata: {
        userId: userProfile.id,
        coreResponseType: coreResponse.type,
        personalizedResponseType: personalizedResponse.type,
      },
    };
  }

  /**
   * Process postback event
   */
  private async processPostback(
    event: FacebookMessengerEvent,
    startTime: number
  ): Promise<MessengerProcessingResult> {
    // PLACEHOLDER: Implement postback processing
    console.log('Processing Facebook Messenger postback (PLACEHOLDER)', {
      senderId: event.sender.id,
      payload: event.postback!.payload,
      title: event.postback!.title,
      requestId: event.requestId,
    });

    return {
      success: true,
      messageId: `postback-${event.timestamp}`,
      responseGenerated: false,
      processingTime: Date.now() - startTime,
      metadata: { eventType: 'postback', payload: event.postback!.payload },
    };
  }

  /**
   * Process delivery confirmation
   */
  private async processDelivery(
    event: FacebookMessengerEvent,
    startTime: number
  ): Promise<MessengerProcessingResult> {
    // PLACEHOLDER: Implement delivery processing
    console.log('Processing Facebook Messenger delivery (PLACEHOLDER)', {
      mids: event.delivery!.mids,
      watermark: event.delivery!.watermark,
      requestId: event.requestId,
    });

    return {
      success: true,
      messageId: `delivery-${event.timestamp}`,
      responseGenerated: false,
      processingTime: Date.now() - startTime,
      metadata: { eventType: 'delivery', mids: event.delivery!.mids },
    };
  }

  /**
   * Process read confirmation
   */
  private async processRead(
    event: FacebookMessengerEvent,
    startTime: number
  ): Promise<MessengerProcessingResult> {
    // PLACEHOLDER: Implement read processing
    console.log('Processing Facebook Messenger read (PLACEHOLDER)', {
      watermark: event.read!.watermark,
      requestId: event.requestId,
    });

    return {
      success: true,
      messageId: `read-${event.timestamp}`,
      responseGenerated: false,
      processingTime: Date.now() - startTime,
      metadata: { eventType: 'read', watermark: event.read!.watermark },
    };
  }

  /**
   * Extract message content from Facebook Messenger message
   */
  private extractMessageContent(message: any): string {
    if (message.text) {
      return message.text;
    }

    if (message.attachments?.length > 0) {
      const attachment = message.attachments[0];
      if (attachment.type === 'image') {
        return '[Image attachment]';
      } else if (attachment.type === 'video') {
        return '[Video attachment]';
      } else if (attachment.type === 'audio') {
        return '[Audio attachment]';
      } else if (attachment.type === 'file') {
        return '[File attachment]';
      } else if (attachment.type === 'location') {
        return '[Location shared]';
      }
    }

    if (message.quick_reply) {
      return `Quick reply: ${message.quick_reply.payload}`;
    }

    return '[Unknown message type]';
  }

  /**
   * Get or create user profile for Facebook Messenger user
   */
  private async getOrCreateUserProfile(
    facebookId: string,
    event: FacebookMessengerEvent
  ): Promise<any> {
    try {
      // Check cache first
      const cacheKey = `user_profile:facebook:${facebookId}`;
      const cachedProfile = await this.cacheService.get(cacheKey);

      if (cachedProfile) {
        return cachedProfile;
      }

      // Try to find existing user by Facebook ID
      let userProfile = await this.databaseService.getUserByFacebookId(facebookId);

      if (!userProfile) {
        // Get user info from Facebook Graph API
        const facebookUserInfo = await this.facebookService.getUserInfo(facebookId);

        // Create new user profile
        userProfile = await this.databaseService.createUser({
          facebookId,
          platform: 'facebook_messenger',
          firstName: facebookUserInfo.first_name,
          lastName: facebookUserInfo.last_name,
          profilePicUrl: facebookUserInfo.profile_pic,
          preferences: {
            platform: 'facebook_messenger',
            timezone: facebookUserInfo.timezone || 'UTC',
            language: facebookUserInfo.locale || 'en',
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

        console.log('Created new Facebook Messenger user profile', {
          userId: userProfile.id,
          facebookId,
          firstName: facebookUserInfo.first_name,
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
        facebookId,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.DATABASE_ERROR,
        message: 'Failed to get or create user profile',
        context: { facebookId, error: error.message },
      });
    }
  }

  /**
   * Send Facebook Messenger response
   */
  private async sendMessengerResponse(
    recipientId: string,
    content: string,
    requestId: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // PLACEHOLDER: Implement Facebook Messenger message sending
      console.log('Sending Facebook Messenger response (PLACEHOLDER)', {
        recipientId,
        contentLength: content.length,
        requestId,
      });

      // This would use Facebook Graph API to send the message
      const result = await this.facebookService.sendMessage({
        recipientId,
        message: content,
        requestId,
      });

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      console.error('Failed to send Facebook Messenger response', {
        recipientId,
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
   * Store conversation in database
   */
  private async storeConversation(conversationData: any): Promise<void> {
    try {
      await this.databaseService.storeConversation({
        userId: conversationData.userId,
        platform: conversationData.platform,
        conversationId: `facebook-${conversationData.incomingMessage.messageId}`,
        messages: [
          {
            type: 'incoming',
            messageId: conversationData.incomingMessage.messageId,
            content: conversationData.incomingMessage.content,
            timestamp: conversationData.incomingMessage.timestamp,
            attachments: conversationData.incomingMessage.attachments,
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
        hasAttachmentInteraction: engagementData.hasAttachments,
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
   * Check service health
   */
  public async checkHealth(): Promise<{ healthy: boolean; details: any }> {
    try {
      const facebookHealth = await this.facebookService.checkHealth();
      const databaseHealth = await this.databaseService.checkHealth();
      const cacheHealth = await this.cacheService.checkHealth();

      const healthy = facebookHealth.healthy && databaseHealth.healthy && cacheHealth.healthy;

      return {
        healthy,
        details: {
          facebook: facebookHealth,
          database: databaseHealth,
          cache: cacheHealth,
          timestamp: new Date().toISOString(),
          placeholder: {
            implemented: false,
            readyForDevelopment: true,
          },
        },
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          error: error.message,
          timestamp: new Date().toISOString(),
          placeholder: {
            implemented: false,
            readyForDevelopment: true,
          },
        },
      };
    }
  }
}
