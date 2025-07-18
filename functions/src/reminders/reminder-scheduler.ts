/**
 * Reminder Scheduler and Delivery Integration for Fylgja
 * Handles scheduling, delivery, and integration with various messaging platforms
 */

import { RedisCacheService } from '../cache/redis-cache-service';
import { EnhancedDatabaseService } from '../services/enhanced-database-service';
import { TwilioService } from '../services/twilio-service';
import { FylgjaError, ErrorType } from '../utils/error-handler';

import { ReminderSystem, Reminder, DeliveryChannel } from './reminder-system';

export interface ScheduledJob {
  id: string;
  reminderId: string;
  userId: string;
  scheduledTime: Date;
  jobType: 'reminder' | 'advance_notification' | 'recurring_check';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  attempts: number;
  maxAttempts: number;
  lastAttempt?: Date;
  nextRetry?: Date;
  errorMessage?: string;
  metadata: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryResult {
  channel: DeliveryChannel;
  success: boolean;
  messageId?: string;
  errorMessage?: string;
  deliveredAt: Date;
  responseTime: number;
}

export interface DeliveryReport {
  reminderId: string;
  totalChannels: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  results: DeliveryResult[];
  overallSuccess: boolean;
  deliveryStartTime: Date;
  deliveryEndTime: Date;
}

export class ReminderScheduler {
  private static instance: ReminderScheduler;
  private reminderSystem: ReminderSystem;
  private databaseService: EnhancedDatabaseService;
  private twilioService: TwilioService;
  private cacheService: RedisCacheService;
  private isProcessing = false;

  private constructor() {
    this.reminderSystem = ReminderSystem.getInstance();
    this.databaseService = EnhancedDatabaseService.getInstance();
    this.twilioService = TwilioService.getInstance();
    this.cacheService = RedisCacheService.getInstance();
  }

  public static getInstance(): ReminderScheduler {
    if (!ReminderScheduler.instance) {
      ReminderScheduler.instance = new ReminderScheduler();
    }
    return ReminderScheduler.instance;
  }

  /**
   * Schedule a reminder for delivery
   */
  public async scheduleReminder(reminder: Reminder): Promise<ScheduledJob> {
    try {
      console.log('Scheduling reminder', {
        reminderId: reminder.id,
        scheduledTime: reminder.scheduledTime,
        userId: reminder.userId,
      });

      // Create scheduled job
      const job: ScheduledJob = {
        id: `job-${reminder.id}-${Date.now()}`,
        reminderId: reminder.id,
        userId: reminder.userId,
        scheduledTime: reminder.scheduledTime,
        jobType: 'reminder',
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        metadata: {
          priority: reminder.priority,
          channels: reminder.delivery.channels.map(c => c.type),
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Store job in database
      await this.databaseService.storeScheduledJob(job);

      // Schedule advance notifications if configured
      if (reminder.delivery.advanceNotifications?.length > 0) {
        await this.scheduleAdvanceNotifications(reminder);
      }

      // Add to processing queue if due soon
      if (this.isDueSoon(reminder.scheduledTime)) {
        await this.addToProcessingQueue(job);
      }

      console.log('Reminder scheduled successfully', {
        jobId: job.id,
        reminderId: reminder.id,
      });

      return job;
    } catch (error) {
      console.error('Failed to schedule reminder', {
        reminderId: reminder.id,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to schedule reminder',
        context: { reminderId: reminder.id, error: error.message },
      });
    }
  }

  /**
   * Cancel a scheduled reminder
   */
  public async cancelScheduledReminder(reminderId: string): Promise<void> {
    try {
      console.log('Cancelling scheduled reminder', { reminderId });

      // Find and cancel all jobs for this reminder
      const jobs = await this.databaseService.getScheduledJobsForReminder(reminderId);

      for (const job of jobs) {
        if (job.status === 'pending') {
          await this.databaseService.updateScheduledJob(job.id, {
            status: 'cancelled',
            updatedAt: new Date(),
          });

          // Remove from processing queue
          await this.removeFromProcessingQueue(job.id);
        }
      }

      console.log('Scheduled reminder cancelled', {
        reminderId,
        cancelledJobs: jobs.length,
      });
    } catch (error) {
      console.error('Failed to cancel scheduled reminder', {
        reminderId,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to cancel scheduled reminder',
        context: { reminderId, error: error.message },
      });
    }
  }

  /**
   * Process due reminders (called by Cloud Scheduler)
   */
  public async processDueReminders(): Promise<void> {
    if (this.isProcessing) {
      console.log('Reminder processing already in progress, skipping');
      return;
    }

    try {
      this.isProcessing = true;
      console.log('Starting due reminder processing');

      // Get all due jobs
      const dueJobs = await this.databaseService.getDueScheduledJobs(new Date());

      console.log('Found due reminder jobs', { count: dueJobs.length });

      // Process jobs in batches to avoid overwhelming the system
      const batchSize = 10;
      for (let i = 0; i < dueJobs.length; i += batchSize) {
        const batch = dueJobs.slice(i, i + batchSize);
        await Promise.all(batch.map(job => this.processScheduledJob(job)));
      }

      console.log('Completed due reminder processing');
    } catch (error) {
      console.error('Failed to process due reminders', { error: error.message });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to process due reminders',
        context: { error: error.message },
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Deliver a reminder through all configured channels
   */
  public async deliverReminder(reminder: Reminder): Promise<DeliveryReport> {
    const deliveryStartTime = new Date();
    const results: DeliveryResult[] = [];

    try {
      console.log('Delivering reminder', {
        reminderId: reminder.id,
        channels: reminder.delivery.channels.length,
      });

      // Generate personalized message
      const message = await this.generateReminderMessage(reminder);

      // Deliver through each enabled channel
      for (const channel of reminder.delivery.channels) {
        if (channel.enabled) {
          const result = await this.deliverThroughChannel(reminder, channel, message);
          results.push(result);
        }
      }

      const deliveryEndTime = new Date();
      const successfulDeliveries = results.filter(r => r.success).length;

      const report: DeliveryReport = {
        reminderId: reminder.id,
        totalChannels: reminder.delivery.channels.filter(c => c.enabled).length,
        successfulDeliveries,
        failedDeliveries: results.length - successfulDeliveries,
        results,
        overallSuccess: successfulDeliveries > 0,
        deliveryStartTime,
        deliveryEndTime,
      };

      // Store delivery report
      await this.databaseService.storeDeliveryReport(report);

      // Track analytics
      await this.trackDeliveryAnalytics(reminder, report);

      console.log('Reminder delivery completed', {
        reminderId: reminder.id,
        successfulDeliveries,
        totalChannels: report.totalChannels,
      });

      return report;
    } catch (error) {
      console.error('Failed to deliver reminder', {
        reminderId: reminder.id,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to deliver reminder',
        context: { reminderId: reminder.id, error: error.message },
      });
    }
  }

  /**
   * Retry failed reminder delivery
   */
  public async retryFailedDelivery(jobId: string): Promise<void> {
    try {
      console.log('Retrying failed delivery', { jobId });

      const job = await this.databaseService.getScheduledJob(jobId);
      if (!job) {
        throw new FylgjaError({
          type: ErrorType.NOT_FOUND,
          message: 'Scheduled job not found',
          context: { jobId },
        });
      }

      if (job.attempts >= job.maxAttempts) {
        console.log('Max retry attempts reached', { jobId, attempts: job.attempts });
        return;
      }

      // Update job for retry
      await this.databaseService.updateScheduledJob(jobId, {
        status: 'pending',
        attempts: job.attempts + 1,
        lastAttempt: new Date(),
        nextRetry: this.calculateNextRetry(job.attempts + 1),
        updatedAt: new Date(),
      });

      // Process the job
      await this.processScheduledJob(job);

      console.log('Retry completed', { jobId });
    } catch (error) {
      console.error('Failed to retry delivery', { jobId, error: error.message });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to retry delivery',
        context: { jobId, error: error.message },
      });
    }
  }

  /**
   * Get delivery statistics for a user
   */
  public async getDeliveryStatistics(
    userId: string,
    timeframe?: { start: Date; end: Date }
  ): Promise<any> {
    try {
      console.log('Getting delivery statistics', { userId, timeframe });

      const stats = await this.databaseService.getDeliveryStatistics(userId, timeframe);

      return {
        totalReminders: stats.totalReminders,
        successfulDeliveries: stats.successfulDeliveries,
        failedDeliveries: stats.failedDeliveries,
        deliveryRate:
          stats.totalReminders > 0 ? stats.successfulDeliveries / stats.totalReminders : 0,
        channelBreakdown: stats.channelBreakdown,
        averageDeliveryTime: stats.averageDeliveryTime,
        peakDeliveryHours: stats.peakDeliveryHours,
      };
    } catch (error) {
      console.error('Failed to get delivery statistics', {
        userId,
        error: error.message,
      });

      throw new FylgjaError({
        type: ErrorType.DATABASE_ERROR,
        message: 'Failed to get delivery statistics',
        context: { userId, error: error.message },
      });
    }
  }

  /**
   * Private helper methods
   */

  private async scheduleAdvanceNotifications(reminder: Reminder): Promise<void> {
    try {
      for (const notification of reminder.delivery.advanceNotifications) {
        const notificationTime = new Date(
          reminder.scheduledTime.getTime() - notification.timeBeforeReminder * 60 * 1000
        );

        // Only schedule if notification time is in the future
        if (notificationTime > new Date()) {
          const job: ScheduledJob = {
            id: `advance-${reminder.id}-${notification.timeBeforeReminder}`,
            reminderId: reminder.id,
            userId: reminder.userId,
            scheduledTime: notificationTime,
            jobType: 'advance_notification',
            status: 'pending',
            attempts: 0,
            maxAttempts: 2,
            metadata: {
              timeBeforeReminder: notification.timeBeforeReminder,
              message: notification.message,
              channels: notification.channels,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await this.databaseService.storeScheduledJob(job);
        }
      }
    } catch (error) {
      console.warn('Failed to schedule advance notifications', {
        reminderId: reminder.id,
        error: error.message,
      });
    }
  }

  private isDueSoon(scheduledTime: Date): boolean {
    const now = new Date();
    const timeDiff = scheduledTime.getTime() - now.getTime();
    return timeDiff <= 5 * 60 * 1000; // Due within 5 minutes
  }

  private async addToProcessingQueue(job: ScheduledJob): Promise<void> {
    try {
      // Add to Redis queue for immediate processing
      const queueKey = 'reminder_processing_queue';
      await this.cacheService.lpush(queueKey, JSON.stringify(job));
    } catch (error) {
      console.warn('Failed to add job to processing queue', {
        jobId: job.id,
        error: error.message,
      });
    }
  }

  private async removeFromProcessingQueue(jobId: string): Promise<void> {
    try {
      // Remove from Redis queue
      const queueKey = 'reminder_processing_queue';
      const queueLength = await this.cacheService.llen(queueKey);

      for (let i = 0; i < queueLength; i++) {
        const jobData = await this.cacheService.lindex(queueKey, i);
        if (jobData) {
          const job = JSON.parse(jobData);
          if (job.id === jobId) {
            await this.cacheService.lrem(queueKey, 1, jobData);
            break;
          }
        }
      }
    } catch (error) {
      console.warn('Failed to remove job from processing queue', {
        jobId,
        error: error.message,
      });
    }
  }

  private async processScheduledJob(job: ScheduledJob): Promise<void> {
    try {
      console.log('Processing scheduled job', {
        jobId: job.id,
        jobType: job.jobType,
        reminderId: job.reminderId,
      });

      // Update job status
      await this.databaseService.updateScheduledJob(job.id, {
        status: 'processing',
        lastAttempt: new Date(),
        updatedAt: new Date(),
      });

      // Get reminder details
      const reminder = await this.databaseService.getReminder(job.reminderId);
      if (!reminder) {
        throw new Error('Reminder not found');
      }

      // Process based on job type
      switch (job.jobType) {
        case 'reminder':
          await this.deliverReminder(reminder);
          break;
        case 'advance_notification':
          await this.deliverAdvanceNotification(reminder, job);
          break;
        case 'recurring_check':
          await this.processRecurringCheck(reminder, job);
          break;
        default:
          throw new Error(`Unknown job type: ${job.jobType}`);
      }

      // Mark job as completed
      await this.databaseService.updateScheduledJob(job.id, {
        status: 'completed',
        updatedAt: new Date(),
      });

      console.log('Scheduled job completed successfully', { jobId: job.id });
    } catch (error) {
      console.error('Failed to process scheduled job', {
        jobId: job.id,
        error: error.message,
      });

      // Update job with error
      await this.databaseService.updateScheduledJob(job.id, {
        status: 'failed',
        errorMessage: error.message,
        nextRetry: this.calculateNextRetry(job.attempts + 1),
        updatedAt: new Date(),
      });

      // Schedule retry if attempts remaining
      if (job.attempts < job.maxAttempts) {
        setTimeout(
          () => {
            this.retryFailedDelivery(job.id).catch(console.error);
          },
          this.getRetryDelay(job.attempts + 1)
        );
      }
    }
  }

  private async generateReminderMessage(reminder: Reminder): Promise<string> {
    try {
      // Use custom message if provided
      if (reminder.delivery.customMessage) {
        return reminder.delivery.customMessage;
      }

      // Generate contextual message based on reminder details
      let message = `🔔 Reminder: ${reminder.title}`;

      if (reminder.description) {
        message += `\n\n${reminder.description}`;
      }

      // Add priority indicator
      if (reminder.priority === 'urgent') {
        message = `🚨 URGENT ${message}`;
      } else if (reminder.priority === 'high') {
        message = `⚡ ${message}`;
      }

      // Add category context
      const categoryEmojis = {
        personal: '👤',
        work: '💼',
        health: '🏥',
        social: '👥',
        learning: '📚',
        custom: '📌',
      };

      const emoji = categoryEmojis[reminder.category] || '📌';
      message = `${emoji} ${message}`;

      // Add helpful actions
      message +=
        '\n\nReply with:\n• "Done" to mark complete\n• "Snooze 30m" to postpone\n• "Cancel" to remove';

      return message;
    } catch (error) {
      console.warn('Failed to generate reminder message', {
        reminderId: reminder.id,
        error: error.message,
      });

      // Fallback to simple message
      return `Reminder: ${reminder.title}`;
    }
  }

  private async deliverThroughChannel(
    reminder: Reminder,
    channel: DeliveryChannel,
    message: string
  ): Promise<DeliveryResult> {
    const startTime = Date.now();

    try {
      console.log('Delivering through channel', {
        reminderId: reminder.id,
        channelType: channel.type,
        address: channel.address,
      });

      let messageId: string | undefined;

      switch (channel.type) {
        case 'whatsapp':
          messageId = await this.deliverWhatsApp(channel.address, message);
          break;
        case 'sms':
          messageId = await this.deliverSMS(channel.address, message);
          break;
        case 'email':
          messageId = await this.deliverEmail(channel.address, reminder.title, message);
          break;
        case 'push':
          messageId = await this.deliverPushNotification(channel.address, reminder.title, message);
          break;
        case 'voice':
          messageId = await this.deliverVoiceCall(channel.address, message);
          break;
        case 'smart_display':
          messageId = await this.deliverSmartDisplay(channel.address, reminder.title, message);
          break;
        default:
          throw new Error(`Unsupported channel type: ${channel.type}`);
      }

      const responseTime = Date.now() - startTime;

      return {
        channel,
        success: true,
        messageId,
        deliveredAt: new Date(),
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      console.error('Failed to deliver through channel', {
        reminderId: reminder.id,
        channelType: channel.type,
        error: error.message,
      });

      return {
        channel,
        success: false,
        errorMessage: error.message,
        deliveredAt: new Date(),
        responseTime,
      };
    }
  }

  private async deliverWhatsApp(phoneNumber: string, message: string): Promise<string> {
    try {
      const result = await this.twilioService.sendWhatsAppMessage(phoneNumber, message);
      return result.sid;
    } catch (error) {
      throw new Error(`WhatsApp delivery failed: ${error.message}`);
    }
  }

  private async deliverSMS(phoneNumber: string, message: string): Promise<string> {
    try {
      const result = await this.twilioService.sendSMS(phoneNumber, message);
      return result.sid;
    } catch (error) {
      throw new Error(`SMS delivery failed: ${error.message}`);
    }
  }

  private async deliverEmail(email: string, subject: string, message: string): Promise<string> {
    try {
      // Implementation would integrate with email service (SendGrid, etc.)
      console.log('Email delivery', { email, subject, message: message.substring(0, 100) });
      return `email-${Date.now()}`;
    } catch (error) {
      throw new Error(`Email delivery failed: ${error.message}`);
    }
  }

  private async deliverPushNotification(
    deviceId: string,
    title: string,
    message: string
  ): Promise<string> {
    try {
      // Implementation would integrate with Firebase Cloud Messaging
      console.log('Push notification delivery', {
        deviceId,
        title,
        message: message.substring(0, 100),
      });
      return `push-${Date.now()}`;
    } catch (error) {
      throw new Error(`Push notification delivery failed: ${error.message}`);
    }
  }

  private async deliverVoiceCall(phoneNumber: string, message: string): Promise<string> {
    try {
      // Implementation would integrate with Twilio Voice API
      console.log('Voice call delivery', { phoneNumber, message: message.substring(0, 100) });
      return `voice-${Date.now()}`;
    } catch (error) {
      throw new Error(`Voice call delivery failed: ${error.message}`);
    }
  }

  private async deliverSmartDisplay(
    deviceId: string,
    title: string,
    message: string
  ): Promise<string> {
    try {
      // Implementation would integrate with Google Assistant SDK
      console.log('Smart display delivery', {
        deviceId,
        title,
        message: message.substring(0, 100),
      });
      return `display-${Date.now()}`;
    } catch (error) {
      throw new Error(`Smart display delivery failed: ${error.message}`);
    }
  }

  private async deliverAdvanceNotification(reminder: Reminder, job: ScheduledJob): Promise<void> {
    try {
      const notificationMessage =
        job.metadata.message ||
        `⏰ Upcoming reminder in ${job.metadata.timeBeforeReminder} minutes: ${reminder.title}`;

      // Deliver through specified channels or default channels
      const channels = job.metadata.channels || reminder.delivery.channels.map(c => c.type);

      for (const channelType of channels) {
        const channel = reminder.delivery.channels.find(c => c.type === channelType);
        if (channel?.enabled) {
          await this.deliverThroughChannel(reminder, channel, notificationMessage);
        }
      }
    } catch (error) {
      console.error('Failed to deliver advance notification', {
        jobId: job.id,
        reminderId: reminder.id,
        error: error.message,
      });

      throw error;
    }
  }

  private async processRecurringCheck(reminder: Reminder, job: ScheduledJob): Promise<void> {
    try {
      // Check if recurring reminder needs to be created
      if (reminder.recurrence && reminder.status === 'completed') {
        // This would be handled by the main reminder system
        console.log('Processing recurring check', {
          reminderId: reminder.id,
          recurrenceType: reminder.recurrence.type,
        });
      }
    } catch (error) {
      console.error('Failed to process recurring check', {
        jobId: job.id,
        reminderId: reminder.id,
        error: error.message,
      });

      throw error;
    }
  }

  private calculateNextRetry(attemptNumber: number): Date {
    // Exponential backoff: 1min, 5min, 15min
    const delays = [1, 5, 15]; // minutes
    const delayMinutes = delays[Math.min(attemptNumber - 1, delays.length - 1)];
    return new Date(Date.now() + delayMinutes * 60 * 1000);
  }

  private getRetryDelay(attemptNumber: number): number {
    // Return delay in milliseconds
    const delays = [60000, 300000, 900000]; // 1min, 5min, 15min
    return delays[Math.min(attemptNumber - 1, delays.length - 1)];
  }

  private async trackDeliveryAnalytics(reminder: Reminder, report: DeliveryReport): Promise<void> {
    try {
      const analytics = {
        userId: reminder.userId,
        reminderId: reminder.id,
        deliveryReport: report,
        timestamp: new Date(),
        metadata: {
          priority: reminder.priority,
          category: reminder.category,
          channelTypes: reminder.delivery.channels.map(c => c.type),
        },
      };

      await this.databaseService.storeDeliveryAnalytics(analytics);
    } catch (error) {
      console.warn('Failed to track delivery analytics', {
        reminderId: reminder.id,
        error: error.message,
      });
    }
  }
}
