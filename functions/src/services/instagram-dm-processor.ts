/**
 * Instagram DM Processor for Fylgja
 * Handles processing of incoming Instagram Direct Messages
 *
 * PLACEHOLDER IMPLEMENTATION - Ready for development
 */

import { RedisCacheService } from '../cache/redis-cache-service';
import { CoreProcessor } from '../core/core-processor';
import { ResponsePersonalizer } from '../personalization/response-personalizer';
import { FylgjaError, ErrorType } from '../utils/error-handler';

import { EnhancedDatabaseService } from './enhanced-database-service';
import { InstagramGraphService } from './instagram-graph-service';

export interface InstagramDMEvent {
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
      };
    }>;
    story_mention?: {
      story_id: string;
    };
    reply_to?: {
      mid: string;
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
  instagramId: string;
  requestId: string;
}

export interface InstagramDMProcessingResult {
  success: boolean;
  messageId: string;
  responseGenerated: boolean;
  responseMessageId?: string;
  processingTime: number;
  error?: string;
  metadata?: any;
}

export class InstagramDMProcessor {
  private static instance: InstagramDMProcessor;
  private coreProcessor: CoreProcessor;
  private instagramService: InstagramGraphService;
  private databaseService: EnhancedDatabaseService;
  private responsePersonalizer: ResponsePersonalizer;
  private cacheService: RedisCacheService;

  private constructor() {
    this.coreProcessor = CoreProcessor.getInstance();
    this.instagramService = InstagramGraphService.getInstance();
    this.databaseService = EnhancedDatabaseService.getInstance();
    this.responsePersonalizer = ResponsePersonalizer.getInstance();
    this.cacheService = RedisCacheService.getInstance();
  }

  public static getInstance(): InstagramDMProcessor {
    if (!InstagramDMProcessor.instance) {
      InstagramDMProcessor.instance = new InstagramDMProcessor();
    }
    return InstagramDMProcessor.instance;
  }

  /**
   * Process Instagram DM messaging event
   */
  public async processMessagingEvent(
    event: InstagramDMEvent
  ): Promise<InstagramDMProcessingResult> {
    const startTime = Date.now();

    try {
      console.log('Processing Instagram DM event', {
        senderId: event.sender.id,
        messageId: event.message?.mid,
        hasText: !!event.message?.text,
        hasAttachments: !!event.message?.attachments?.length,
        hasStoryMention: !!event.message?.story_mention,
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
        console.warn('Unknown Instagram DM event type', {
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
      console.error('Failed to process Instagram DM event', {
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
   * Process incoming Instagram DM message
   */
  private async processMessage(
    event: InstagramDMEvent,
    startTime: number
  ): Promise<InstagramDMProcessingResult> {
    const messageId = event.message!.mid;
    const senderId = event.sender.id;

    // Get or create user profile
    const userProfile = await this.getOrCreateUserProfile(senderId, event);

    // Extract message content
    const messageContent = this.extractMessageContent(event.message!);

    // Prepare message context
    const messageContext = {
      platform: 'instagram_dm',
      userId: userProfile.id,
      instagramId: senderId,
      businessAccountId: event.instagramId,
      messageId,
      timestamp: new Date(event.timestamp),
      attachments: event.message!.attachments,
      storyMention: event.message!.story_mention,
      replyTo: event.message!.reply_to,
      requestId: event.requestId,
    };

    // Process message through core processor
    const coreResponse = await this.coreProcessor.processMessage({
      userId: userProfile.id,
      message: messageContent,
      platform: 'instagram_dm',
      context: messageContext,
      userProfile: userProfile,
    });

    // Personalize response for Instagram DM
    const personalizedResponse = await this.responsePersonalizer.personalizeResponse({
      response: coreResponse.response,
      userId: userProfile.id,
      platform: 'instagram_dm',
      context: messageContext,
      userPreferences: userProfile.preferences,
    });

    // Send response via Instagram DM
    let responseMessageId: string | undefined;
    let responseGenerated = false;

    if (personalizedResponse.shouldRespond && personalizedResponse.content) {
      const sendResult = await this.sendInstagramDMResponse(
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
      platform: 'instagram_dm',
      incomingMessage: {
        messageId,
        content: messageContent,
        timestamp: new Date(event.timestamp),
        attachments: event.message!.attachments,
        storyMention: event.message!.story_mention,
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
      platform: 'instagram_dm',
      messageReceived: true,
      responseGenerated,
      processingTime: Date.now() - startTime,
      hasAttachments: !!event.message!.attachments?.length,
      hasStoryMention: !!event.message!.story_mention,
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
        hasStoryMention: !!event.message!.story_mention,
      },
    };
  }

  /**
   * Process Instagram DM postback event
   */
  private async processPostback(
    event: InstagramDMEvent,
    startTime: number
  ): Promise<InstagramDMProcessingResult> {
    // PLACEHOLDER: Implement postback processing
    console.log('Processing Instagram DM postback (PLACEHOLDER)', {
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
   * Process Instagram DM delivery confirmation
   */
  private async processDelivery(
    event: InstagramDMEvent,
    startTime: number
  ): Promise<InstagramDMProcessingResult> {
    // PLACEHOLDER: Implement delivery processing
    console.log('Processing Instagram DM delivery (PLACEHOLDER)', {
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
   * Process Instagram DM read confirmation
   */
  private async processRead(
    event: InstagramDMEvent,
    startTime: number
  ): Promise<InstagramDMProcessingResult> {
    // PLACEHOLDER: Implement read processing
    console.log('Processing Instagram DM read (PLACEHOLDER)', {
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
   * Extract message content from Instagram DM message
   */
  private extractMessageContent(message: any): string {
    if (message.text) {
      return message.text;
    }

    if (message.story_mention) {
      return `[Story mention: ${message.story_mention.story_id}]`;
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
      } else if (attachment.type === 'story_reply') {
        return '[Story reply]';
      }
    }

    if (message.reply_to) {
      return `[Reply to message: ${message.reply_to.mid}]`;
    }

    return '[Unknown message type]';
  }

  /**
   * Get or create user profile for Instagram DM user
   */
  private async getOrCreateUserProfile(instagramId: string, event: InstagramDMEvent): Promise<any> {
    try {
      // Check cache first
      const cacheKey = `user_profile:instagram:${instagramId}`;
      const cachedProfile = await this.cacheService.get(cacheKey);

      if (cachedProfile) {
        return cachedProfile;
      }

      // Try to find existing user by Instagram ID
      let userProfile = await this.databaseService.getUserByInstagramId(instagramId);

      if (!userProfile) {
        // Get user info from Instagram Graph API
        const instagramUserInfo = await this.instagramService.getUserInfo(instagramId);

        // Create new user profile
        userProfile = await this.databaseService.createUser({
          instagramId,
          platform: 'instagram_dm',
          username: instagramUserInfo.username,
          fullName: instagramUserInfo.name,
          profilePicUrl: instagramUserInfo.profile_picture_url,
          preferences: {
            platform: 'instagram_dm',
            timezone: 'UTC', // Instagram doesn't provide timezone info
            language: 'en',
            communicationStyle: 'casual',
            notificationSettings: {
              dailyCheckIns: true,
              reminders: true,
              summaries: true,
            },
          },
          createdAt: new Date(),
          lastActiveAt: new Date(),
        });

        console.log('Created new Instagram DM user profile', {
          userId: userProfile.id,
          instagramId,
          username: instagramUserInfo.username,
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
        instagramId,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.DATABASE_ERROR,
        message: 'Failed to get or create user profile',
        context: { instagramId, error: error.message },
      });
    }
  }

  /**
   * Send Instagram DM response
   */
  private async sendInstagramDMResponse(
    recipientId: string,
    content: string,
    requestId: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // PLACEHOLDER: Implement Instagram DM message sending
      console.log('Sending Instagram DM response (PLACEHOLDER)', {
        recipientId,
        contentLength: content.length,
        requestId,
      });

      // This would use Instagram Graph API to send the message
      const result = await this.instagramService.sendMessage({
        recipientId,
        message: content,
        requestId,
      });

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (error) {
      console.error('Failed to send Instagram DM response', {
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
        conversationId: `instagram-${conversationData.incomingMessage.messageId}`,
        messages: [
          {
            type: 'incoming',
            messageId: conversationData.incomingMessage.messageId,
            content: conversationData.incomingMessage.content,
            timestamp: conversationData.incomingMessage.timestamp,
            attachments: conversationData.incomingMessage.attachments,
            storyMention: conversationData.incomingMessage.storyMention,
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
        hasStoryInteraction: engagementData.hasStoryMention,
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
      const instagramHealth = await this.instagramService.checkHealth();
      const databaseHealth = await this.databaseService.checkHealth();
      const cacheHealth = await this.cacheService.checkHealth();

      const healthy = instagramHealth.healthy && databaseHealth.healthy && cacheHealth.healthy;

      return {
        healthy,
        details: {
          instagram: instagramHealth,
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
