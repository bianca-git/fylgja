/**
 * Scheduled Tasks for Fylgja
 * Comprehensive Cloud Scheduler integration for automated tasks
 */

import { CoreProcessor } from '../core/core-processor';
import { EnhancedDatabaseService } from '../services/enhanced-database-service';
import { GoogleAIService } from '../services/google-ai-service';
import { PromptEngine } from '../core/prompt-engine';
import { ResponseGenerator } from '../core/response-generator';
import { APIPerformanceMonitor } from '../monitoring/api-performance-monitor';
import { FylgjaError, ErrorType } from '../utils/error-handler';

// Scheduling interfaces
interface ScheduledTaskContext {
  taskId: string;
  taskName: string;
  scheduledTime: Date;
  executionTime: Date;
  timezone: string;
  metadata: Record<string, any>;
}

interface TaskExecutionResult {
  success: boolean;
  taskId: string;
  executionTime: Date;
  duration: number;
  processedUsers: number;
  errors: Array<{
    userId: string;
    error: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  metrics: {
    totalAttempts: number;
    successfulAttempts: number;
    failedAttempts: number;
    averageProcessingTime: number;
  };
  nextScheduledTime?: Date;
}

interface UserSchedulePreferences {
  userId: string;
  timezone: string;
  preferredCheckInTime: string; // HH:MM format
  reminderFrequency: 'daily' | 'weekly' | 'custom';
  customReminderDays: string[]; // ['monday', 'wednesday', 'friday']
  summaryFrequency: 'weekly' | 'monthly';
  summaryDay: string; // 'sunday' for weekly, '1' for monthly (day of month)
  enableProactiveEngagement: boolean;
  quietHours: {
    start: string; // HH:MM
    end: string; // HH:MM
  };
}

interface DailyCheckInTask {
  userId: string;
  scheduledTime: Date;
  timezone: string;
  personalizedQuestion: string;
  questionStyle: string;
  depth: string;
  retryCount: number;
  lastAttempt?: Date;
}

interface ReminderTask {
  userId: string;
  type: 'task_reminder' | 'goal_reminder' | 'reflection_reminder';
  content: string;
  scheduledTime: Date;
  priority: 'low' | 'medium' | 'high';
  context: Record<string, any>;
}

interface SummaryTask {
  userId: string;
  type: 'weekly_summary' | 'monthly_summary';
  period: {
    start: Date;
    end: Date;
  };
  scheduledTime: Date;
  includeInsights: boolean;
  includeGoalProgress: boolean;
}

interface MaintenanceTask {
  type: 'database_cleanup' | 'cache_refresh' | 'performance_analysis' | 'health_check';
  scheduledTime: Date;
  parameters: Record<string, any>;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Scheduled Tasks Manager
 */
export class ScheduledTasksManager {
  private static instance: ScheduledTasksManager;
  private coreProcessor: CoreProcessor;
  private database: EnhancedDatabaseService;
  private googleAI: GoogleAIService;
  private promptEngine: PromptEngine;
  private responseGenerator: ResponseGenerator;
  private performanceMonitor: APIPerformanceMonitor;

  // Task execution tracking
  private activeExecutions: Map<string, Date> = new Map();
  private executionHistory: TaskExecutionResult[] = [];
  private maxHistorySize = 1000;

  // Configuration
  private readonly config = {
    maxConcurrentTasks: 50,
    taskTimeout: 300000, // 5 minutes
    retryAttempts: 3,
    retryDelay: 60000, // 1 minute
    batchSize: 100,
    quietHoursBuffer: 30, // 30 minutes buffer around quiet hours
    timezoneDefault: 'UTC',
    performanceThresholds: {
      maxExecutionTime: 180000, // 3 minutes
      maxErrorRate: 0.05, // 5%
      minSuccessRate: 0.95 // 95%
    }
  };

  private constructor() {
    this.coreProcessor = new CoreProcessor();
    this.database = new EnhancedDatabaseService();
    this.googleAI = new GoogleAIService();
    this.promptEngine = new PromptEngine();
    this.responseGenerator = new ResponseGenerator();
    this.performanceMonitor = APIPerformanceMonitor.getInstance();
  }

  public static getInstance(): ScheduledTasksManager {
    if (!ScheduledTasksManager.instance) {
      ScheduledTasksManager.instance = new ScheduledTasksManager();
    }
    return ScheduledTasksManager.instance;
  }

  /**
   * Daily Check-In Scheduler
   * Sends personalized daily check-in prompts to users
   */
  public async executeDailyCheckIns(context: ScheduledTaskContext): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const result: TaskExecutionResult = {
      success: true,
      taskId: context.taskId,
      executionTime: context.executionTime,
      duration: 0,
      processedUsers: 0,
      errors: [],
      metrics: {
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        averageProcessingTime: 0
      }
    };

    try {
      // Get users scheduled for check-ins at this time
      const scheduledUsers = await this.getUsersForDailyCheckIn(context.executionTime);
      result.metrics.totalAttempts = scheduledUsers.length;

      console.log(`Starting daily check-ins for ${scheduledUsers.length} users`);

      // Process users in batches
      const batches = this.createBatches(scheduledUsers, this.config.batchSize);
      
      for (const batch of batches) {
        await this.processDailyCheckInBatch(batch, result);
      }

      // Calculate metrics
      result.duration = Date.now() - startTime;
      result.metrics.averageProcessingTime = result.duration / Math.max(result.processedUsers, 1);
      result.success = result.metrics.failedAttempts / result.metrics.totalAttempts < this.config.performanceThresholds.maxErrorRate;

      // Schedule next execution
      result.nextScheduledTime = this.calculateNextDailyCheckInTime(context.executionTime);

      console.log(`Daily check-ins completed: ${result.processedUsers} users processed, ${result.errors.length} errors`);

    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      
      console.error('Daily check-in execution failed:', error);
      
      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Daily check-in execution failed',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { error: error.message, context }
        }
      });
    }

    this.recordTaskExecution(result);
    return result;
  }

  /**
   * Reminder Scheduler
   * Sends task and goal reminders to users
   */
  public async executeReminders(context: ScheduledTaskContext): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const result: TaskExecutionResult = {
      success: true,
      taskId: context.taskId,
      executionTime: context.executionTime,
      duration: 0,
      processedUsers: 0,
      errors: [],
      metrics: {
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        averageProcessingTime: 0
      }
    };

    try {
      // Get pending reminders
      const pendingReminders = await this.getPendingReminders(context.executionTime);
      result.metrics.totalAttempts = pendingReminders.length;

      console.log(`Processing ${pendingReminders.length} reminders`);

      // Group reminders by user for efficient processing
      const remindersByUser = this.groupRemindersByUser(pendingReminders);

      for (const [userId, userReminders] of remindersByUser.entries()) {
        try {
          await this.processUserReminders(userId, userReminders);
          result.metrics.successfulAttempts += userReminders.length;
          result.processedUsers++;
        } catch (error) {
          result.errors.push({
            userId,
            error: error.message,
            severity: 'medium'
          });
          result.metrics.failedAttempts += userReminders.length;
        }
      }

      result.duration = Date.now() - startTime;
      result.metrics.averageProcessingTime = result.duration / Math.max(result.processedUsers, 1);
      result.success = result.metrics.failedAttempts / result.metrics.totalAttempts < this.config.performanceThresholds.maxErrorRate;

      console.log(`Reminders completed: ${result.processedUsers} users processed`);

    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      
      console.error('Reminder execution failed:', error);
      
      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Reminder execution failed',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { error: error.message, context }
        }
      });
    }

    this.recordTaskExecution(result);
    return result;
  }

  /**
   * Summary Generation Scheduler
   * Generates weekly and monthly summaries for users
   */
  public async executeSummaryGeneration(context: ScheduledTaskContext): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const result: TaskExecutionResult = {
      success: true,
      taskId: context.taskId,
      executionTime: context.executionTime,
      duration: 0,
      processedUsers: 0,
      errors: [],
      metrics: {
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        averageProcessingTime: 0
      }
    };

    try {
      // Determine summary type based on context
      const summaryType = context.metadata.summaryType || 'weekly';
      const scheduledSummaries = await this.getUsersForSummary(context.executionTime, summaryType);
      result.metrics.totalAttempts = scheduledSummaries.length;

      console.log(`Generating ${summaryType} summaries for ${scheduledSummaries.length} users`);

      // Process summaries in batches (smaller batches due to complexity)
      const batches = this.createBatches(scheduledSummaries, Math.floor(this.config.batchSize / 2));
      
      for (const batch of batches) {
        await this.processSummaryBatch(batch, result);
      }

      result.duration = Date.now() - startTime;
      result.metrics.averageProcessingTime = result.duration / Math.max(result.processedUsers, 1);
      result.success = result.metrics.failedAttempts / result.metrics.totalAttempts < this.config.performanceThresholds.maxErrorRate;

      console.log(`Summary generation completed: ${result.processedUsers} users processed`);

    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      
      console.error('Summary generation failed:', error);
      
      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Summary generation failed',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { error: error.message, context }
        }
      });
    }

    this.recordTaskExecution(result);
    return result;
  }

  /**
   * Maintenance Tasks Scheduler
   * Performs system maintenance operations
   */
  public async executeMaintenanceTasks(context: ScheduledTaskContext): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const result: TaskExecutionResult = {
      success: true,
      taskId: context.taskId,
      executionTime: context.executionTime,
      duration: 0,
      processedUsers: 0,
      errors: [],
      metrics: {
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        averageProcessingTime: 0
      }
    };

    try {
      const maintenanceType = context.metadata.maintenanceType;
      console.log(`Executing maintenance task: ${maintenanceType}`);

      switch (maintenanceType) {
        case 'database_cleanup':
          await this.executeDatabaseCleanup(result);
          break;
        case 'cache_refresh':
          await this.executeCacheRefresh(result);
          break;
        case 'performance_analysis':
          await this.executePerformanceAnalysis(result);
          break;
        case 'health_check':
          await this.executeHealthCheck(result);
          break;
        default:
          throw new Error(`Unknown maintenance type: ${maintenanceType}`);
      }

      result.duration = Date.now() - startTime;
      result.success = result.errors.length === 0;

      console.log(`Maintenance task ${maintenanceType} completed in ${result.duration}ms`);

    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      result.errors.push({
        userId: 'system',
        error: error.message,
        severity: 'high'
      });
      
      console.error('Maintenance task failed:', error);
    }

    this.recordTaskExecution(result);
    return result;
  }

  /**
   * Proactive Engagement Scheduler
   * Identifies users who might benefit from proactive outreach
   */
  public async executeProactiveEngagement(context: ScheduledTaskContext): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const result: TaskExecutionResult = {
      success: true,
      taskId: context.taskId,
      executionTime: context.executionTime,
      duration: 0,
      processedUsers: 0,
      errors: [],
      metrics: {
        totalAttempts: 0,
        successfulAttempts: 0,
        failedAttempts: 0,
        averageProcessingTime: 0
      }
    };

    try {
      // Identify users for proactive engagement
      const candidateUsers = await this.identifyProactiveEngagementCandidates();
      result.metrics.totalAttempts = candidateUsers.length;

      console.log(`Identified ${candidateUsers.length} users for proactive engagement`);

      for (const userId of candidateUsers) {
        try {
          await this.executeProactiveEngagementForUser(userId);
          result.metrics.successfulAttempts++;
          result.processedUsers++;
        } catch (error) {
          result.errors.push({
            userId,
            error: error.message,
            severity: 'low'
          });
          result.metrics.failedAttempts++;
        }
      }

      result.duration = Date.now() - startTime;
      result.metrics.averageProcessingTime = result.duration / Math.max(result.processedUsers, 1);
      result.success = result.metrics.failedAttempts / result.metrics.totalAttempts < this.config.performanceThresholds.maxErrorRate;

      console.log(`Proactive engagement completed: ${result.processedUsers} users engaged`);

    } catch (error) {
      result.success = false;
      result.duration = Date.now() - startTime;
      
      console.error('Proactive engagement failed:', error);
    }

    this.recordTaskExecution(result);
    return result;
  }

  /**
   * Private helper methods
   */

  private async getUsersForDailyCheckIn(executionTime: Date): Promise<DailyCheckInTask[]> {
    // Get users scheduled for check-ins within the next hour
    const timeWindow = {
      start: new Date(executionTime.getTime() - 30 * 60 * 1000), // 30 minutes before
      end: new Date(executionTime.getTime() + 30 * 60 * 1000)    // 30 minutes after
    };

    // Query database for users with check-in preferences matching this time
    const users = await this.database.getUsersForScheduledTask('daily_checkin', timeWindow);
    
    const tasks: DailyCheckInTask[] = [];
    
    for (const user of users) {
      // Check if user is in quiet hours
      if (await this.isUserInQuietHours(user.userId, executionTime)) {
        continue;
      }

      // Generate personalized question
      const question = await this.promptEngine.generatePrompt({
        userId: user.userId,
        type: 'checkin',
        context: { timeOfDay: this.getTimeOfDay(executionTime, user.timezone) }
      });

      tasks.push({
        userId: user.userId,
        scheduledTime: executionTime,
        timezone: user.timezone || this.config.timezoneDefault,
        personalizedQuestion: question.question,
        questionStyle: question.style,
        depth: question.depth,
        retryCount: 0
      });
    }

    return tasks;
  }

  private async processDailyCheckInBatch(batch: DailyCheckInTask[], result: TaskExecutionResult): Promise<void> {
    const batchPromises = batch.map(async (task) => {
      try {
        // Send personalized check-in message
        const response = await this.coreProcessor.processRequest({
          userId: task.userId,
          type: 'daily_checkin',
          input: task.personalizedQuestion,
          platform: 'scheduler'
        });

        if (response.success) {
          result.metrics.successfulAttempts++;
          result.processedUsers++;
          
          // Record performance metrics
          this.performanceMonitor.recordMetric({
            endpoint: '/scheduler/daily-checkin',
            method: 'POST',
            responseTime: 1000, // Mock value
            statusCode: 200,
            userId: task.userId,
            platform: 'scheduler',
            requestSize: task.personalizedQuestion.length,
            responseSize: response.response?.length || 0,
            cacheHit: false
          });
        } else {
          throw new Error(response.error?.message || 'Check-in failed');
        }
      } catch (error) {
        result.errors.push({
          userId: task.userId,
          error: error.message,
          severity: 'medium'
        });
        result.metrics.failedAttempts++;
      }
    });

    await Promise.allSettled(batchPromises);
  }

  private async getPendingReminders(executionTime: Date): Promise<ReminderTask[]> {
    // Query database for reminders scheduled for this time
    return await this.database.getPendingReminders(executionTime);
  }

  private groupRemindersByUser(reminders: ReminderTask[]): Map<string, ReminderTask[]> {
    const grouped = new Map<string, ReminderTask[]>();
    
    for (const reminder of reminders) {
      if (!grouped.has(reminder.userId)) {
        grouped.set(reminder.userId, []);
      }
      grouped.get(reminder.userId)!.push(reminder);
    }
    
    return grouped;
  }

  private async processUserReminders(userId: string, reminders: ReminderTask[]): Promise<void> {
    // Combine multiple reminders into a single message if appropriate
    const combinedMessage = this.combineReminders(reminders);
    
    await this.coreProcessor.processRequest({
      userId,
      type: 'proactive_engagement',
      input: combinedMessage,
      platform: 'scheduler'
    });

    // Mark reminders as sent
    for (const reminder of reminders) {
      await this.database.markReminderAsSent(reminder);
    }
  }

  private async getUsersForSummary(executionTime: Date, summaryType: string): Promise<SummaryTask[]> {
    const users = await this.database.getUsersForScheduledTask(`${summaryType}_summary`, executionTime);
    
    return users.map(user => ({
      userId: user.userId,
      type: summaryType as 'weekly_summary' | 'monthly_summary',
      period: this.calculateSummaryPeriod(executionTime, summaryType),
      scheduledTime: executionTime,
      includeInsights: true,
      includeGoalProgress: true
    }));
  }

  private async processSummaryBatch(batch: SummaryTask[], result: TaskExecutionResult): Promise<void> {
    const batchPromises = batch.map(async (task) => {
      try {
        // Generate summary using AI service
        const summaryResponse = await this.coreProcessor.processRequest({
          userId: task.userId,
          type: 'summary_generation',
          input: `Generate ${task.type} for period ${task.period.start.toISOString()} to ${task.period.end.toISOString()}`,
          platform: 'scheduler'
        });

        if (summaryResponse.success) {
          result.metrics.successfulAttempts++;
          result.processedUsers++;
        } else {
          throw new Error(summaryResponse.error?.message || 'Summary generation failed');
        }
      } catch (error) {
        result.errors.push({
          userId: task.userId,
          error: error.message,
          severity: 'medium'
        });
        result.metrics.failedAttempts++;
      }
    });

    await Promise.allSettled(batchPromises);
  }

  private async executeDatabaseCleanup(result: TaskExecutionResult): Promise<void> {
    try {
      // Clean up old interaction records
      const cleanupResult = await this.database.cleanupOldRecords();
      result.metrics.successfulAttempts = cleanupResult.deletedRecords;
      
      console.log(`Database cleanup completed: ${cleanupResult.deletedRecords} records removed`);
    } catch (error) {
      result.errors.push({
        userId: 'system',
        error: `Database cleanup failed: ${error.message}`,
        severity: 'high'
      });
    }
  }

  private async executeCacheRefresh(result: TaskExecutionResult): Promise<void> {
    try {
      // Refresh critical caches
      await this.database.refreshCaches();
      result.metrics.successfulAttempts = 1;
      
      console.log('Cache refresh completed');
    } catch (error) {
      result.errors.push({
        userId: 'system',
        error: `Cache refresh failed: ${error.message}`,
        severity: 'medium'
      });
    }
  }

  private async executePerformanceAnalysis(result: TaskExecutionResult): Promise<void> {
    try {
      // Generate performance report
      const performanceReport = await this.performanceMonitor.getAggregatedMetrics(
        new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        new Date(),
        'endpoint'
      );
      
      // Store performance insights
      await this.database.storePerformanceReport(performanceReport);
      result.metrics.successfulAttempts = 1;
      
      console.log('Performance analysis completed');
    } catch (error) {
      result.errors.push({
        userId: 'system',
        error: `Performance analysis failed: ${error.message}`,
        severity: 'medium'
      });
    }
  }

  private async executeHealthCheck(result: TaskExecutionResult): Promise<void> {
    try {
      // Perform comprehensive health check
      const healthStatus = await this.performanceMonitor.getSystemHealth();
      
      if (healthStatus.status !== 'healthy') {
        result.errors.push({
          userId: 'system',
          error: `System health check failed: ${healthStatus.status}`,
          severity: healthStatus.status === 'unhealthy' ? 'critical' : 'medium'
        });
      } else {
        result.metrics.successfulAttempts = 1;
      }
      
      console.log(`Health check completed: ${healthStatus.status}`);
    } catch (error) {
      result.errors.push({
        userId: 'system',
        error: `Health check failed: ${error.message}`,
        severity: 'high'
      });
    }
  }

  private async identifyProactiveEngagementCandidates(): Promise<string[]> {
    // Identify users who haven't interacted recently or might benefit from engagement
    return await this.database.getProactiveEngagementCandidates();
  }

  private async executeProactiveEngagementForUser(userId: string): Promise<void> {
    // Generate personalized proactive message
    const engagementPrompt = await this.promptEngine.generatePrompt({
      userId,
      type: 'proactive_engagement',
      context: { reason: 'check_in' }
    });

    await this.coreProcessor.processRequest({
      userId,
      type: 'proactive_engagement',
      input: engagementPrompt.question,
      platform: 'scheduler'
    });
  }

  // Utility methods
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async isUserInQuietHours(userId: string, currentTime: Date): Promise<boolean> {
    const userPrefs = await this.database.getUserSchedulePreferences(userId);
    if (!userPrefs?.quietHours) return false;

    const userTime = this.convertToUserTimezone(currentTime, userPrefs.timezone);
    const currentHour = userTime.getHours();
    const currentMinute = userTime.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = userPrefs.quietHours.start.split(':').map(Number);
    const [endHour, endMinute] = userPrefs.quietHours.end.split(':').map(Number);
    const startTimeMinutes = startHour * 60 + startMinute;
    const endTimeMinutes = endHour * 60 + endMinute;

    if (startTimeMinutes <= endTimeMinutes) {
      return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes;
    } else {
      // Quiet hours span midnight
      return currentTimeMinutes >= startTimeMinutes || currentTimeMinutes <= endTimeMinutes;
    }
  }

  private getTimeOfDay(time: Date, timezone: string): string {
    const userTime = this.convertToUserTimezone(time, timezone);
    const hour = userTime.getHours();
    
    if (hour < 6) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 21) return 'evening';
    return 'night';
  }

  private convertToUserTimezone(time: Date, timezone: string): Date {
    // Simplified timezone conversion - in production, use proper timezone library
    return new Date(time.toLocaleString('en-US', { timeZone: timezone }));
  }

  private calculateNextDailyCheckInTime(currentTime: Date): Date {
    // Schedule next execution for tomorrow at the same time
    const nextTime = new Date(currentTime);
    nextTime.setDate(nextTime.getDate() + 1);
    return nextTime;
  }

  private combineReminders(reminders: ReminderTask[]): string {
    if (reminders.length === 1) {
      return reminders[0].content;
    }

    const reminderTexts = reminders.map(r => r.content);
    return `You have ${reminders.length} reminders:\n${reminderTexts.join('\n')}`;
  }

  private calculateSummaryPeriod(executionTime: Date, summaryType: string): { start: Date; end: Date } {
    const end = new Date(executionTime);
    const start = new Date(executionTime);

    if (summaryType === 'weekly') {
      start.setDate(start.getDate() - 7);
    } else if (summaryType === 'monthly') {
      start.setMonth(start.getMonth() - 1);
    }

    return { start, end };
  }

  private recordTaskExecution(result: TaskExecutionResult): void {
    this.executionHistory.push(result);
    
    // Maintain history size limit
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }

    // Record performance metrics
    this.performanceMonitor.recordMetric({
      endpoint: `/scheduler/${result.taskId}`,
      method: 'POST',
      responseTime: result.duration,
      statusCode: result.success ? 200 : 500,
      requestSize: 0,
      responseSize: 0,
      cacheHit: false
    });
  }

  /**
   * Get execution history and statistics
   */
  public getExecutionHistory(limit?: number): TaskExecutionResult[] {
    return limit ? this.executionHistory.slice(-limit) : [...this.executionHistory];
  }

  public getExecutionStatistics(): {
    totalExecutions: number;
    successRate: number;
    averageExecutionTime: number;
    averageUsersProcessed: number;
    errorRate: number;
  } {
    if (this.executionHistory.length === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        averageExecutionTime: 0,
        averageUsersProcessed: 0,
        errorRate: 0
      };
    }

    const successful = this.executionHistory.filter(r => r.success).length;
    const totalDuration = this.executionHistory.reduce((sum, r) => sum + r.duration, 0);
    const totalUsers = this.executionHistory.reduce((sum, r) => sum + r.processedUsers, 0);
    const totalErrors = this.executionHistory.reduce((sum, r) => sum + r.errors.length, 0);

    return {
      totalExecutions: this.executionHistory.length,
      successRate: successful / this.executionHistory.length,
      averageExecutionTime: totalDuration / this.executionHistory.length,
      averageUsersProcessed: totalUsers / this.executionHistory.length,
      errorRate: totalErrors / this.executionHistory.length
    };
  }
}

// Export singleton instance
export const scheduledTasksManager = ScheduledTasksManager.getInstance();

