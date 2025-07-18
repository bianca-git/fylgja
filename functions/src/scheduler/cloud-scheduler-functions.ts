/**
 * Cloud Scheduler Functions for Fylgja
 * Firebase Cloud Functions triggered by Google Cloud Scheduler
 */

import * as functions from 'firebase-functions';

import { APIPerformanceMonitor } from '../monitoring/api-performance-monitor';
import { FylgjaError, ErrorType } from '../utils/error-handler';

import { scheduledTasksManager } from './scheduled-tasks';

// Cloud Scheduler configuration
const schedulerConfig = {
  timeoutSeconds: 540, // 9 minutes (max for Cloud Functions)
  memory: '1GB' as const,
  region: 'us-central1',
};

/**
 * Daily Check-In Scheduler Function
 * Triggered by Cloud Scheduler to send daily check-ins
 */
export const dailyCheckInScheduler = functions
  .region(schedulerConfig.region)
  .runWith({
    timeoutSeconds: schedulerConfig.timeoutSeconds,
    memory: schedulerConfig.memory,
  })
  .pubsub.topic('fylgja-daily-checkins')
  .onPublish(async (message, context) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();

    try {
      console.log('Daily check-in scheduler triggered', {
        eventId: context.eventId,
        timestamp: context.timestamp,
        messageData: message.data,
      });

      // Parse message data
      const messageData = message.data
        ? JSON.parse(Buffer.from(message.data, 'base64').toString())
        : {};

      // Create task context
      const taskContext = {
        taskId: `daily-checkin-${context.eventId}`,
        taskName: 'daily_checkin',
        scheduledTime: new Date(context.timestamp),
        executionTime: new Date(),
        timezone: messageData.timezone || 'UTC',
        metadata: {
          eventId: context.eventId,
          ...messageData,
        },
      };

      // Execute daily check-ins
      const result = await scheduledTasksManager.executeDailyCheckIns(taskContext);

      // Record performance metrics
      performanceMonitor.recordMetric({
        endpoint: '/scheduler/daily-checkins',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: result.success ? 200 : 500,
        requestSize: JSON.stringify(messageData).length,
        responseSize: JSON.stringify(result).length,
        cacheHit: false,
        metadata: {
          processedUsers: result.processedUsers,
          errors: result.errors.length,
        },
      });

      console.log('Daily check-in scheduler completed', {
        success: result.success,
        processedUsers: result.processedUsers,
        duration: result.duration,
        errors: result.errors.length,
      });

      return result;
    } catch (error) {
      console.error('Daily check-in scheduler failed', {
        error: error.message,
        stack: error.stack,
        eventId: context.eventId,
      });

      // Record error metrics
      performanceMonitor.recordMetric({
        endpoint: '/scheduler/daily-checkins',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 500,
        requestSize: 0,
        responseSize: 0,
        cacheHit: false,
        metadata: { error: error.message },
      });

      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Daily check-in scheduler failed',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { error: error.message, eventId: context.eventId },
        },
      });
    }
  });

/**
 * Reminder Scheduler Function
 * Triggered by Cloud Scheduler to send reminders
 */
export const reminderScheduler = functions
  .region(schedulerConfig.region)
  .runWith({
    timeoutSeconds: schedulerConfig.timeoutSeconds,
    memory: schedulerConfig.memory,
  })
  .pubsub.topic('fylgja-reminders')
  .onPublish(async (message, context) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();

    try {
      console.log('Reminder scheduler triggered', {
        eventId: context.eventId,
        timestamp: context.timestamp,
      });

      const messageData = message.data
        ? JSON.parse(Buffer.from(message.data, 'base64').toString())
        : {};

      const taskContext = {
        taskId: `reminders-${context.eventId}`,
        taskName: 'reminders',
        scheduledTime: new Date(context.timestamp),
        executionTime: new Date(),
        timezone: messageData.timezone || 'UTC',
        metadata: {
          eventId: context.eventId,
          reminderType: messageData.reminderType || 'general',
          ...messageData,
        },
      };

      const result = await scheduledTasksManager.executeReminders(taskContext);

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/reminders',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: result.success ? 200 : 500,
        requestSize: JSON.stringify(messageData).length,
        responseSize: JSON.stringify(result).length,
        cacheHit: false,
        metadata: {
          processedUsers: result.processedUsers,
          errors: result.errors.length,
        },
      });

      console.log('Reminder scheduler completed', {
        success: result.success,
        processedUsers: result.processedUsers,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      console.error('Reminder scheduler failed', {
        error: error.message,
        eventId: context.eventId,
      });

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/reminders',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 500,
        requestSize: 0,
        responseSize: 0,
        cacheHit: false,
        metadata: { error: error.message },
      });

      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Reminder scheduler failed',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { error: error.message, eventId: context.eventId },
        },
      });
    }
  });

/**
 * Weekly Summary Scheduler Function
 * Triggered by Cloud Scheduler to generate weekly summaries
 */
export const weeklySummaryScheduler = functions
  .region(schedulerConfig.region)
  .runWith({
    timeoutSeconds: schedulerConfig.timeoutSeconds,
    memory: schedulerConfig.memory,
  })
  .pubsub.topic('fylgja-weekly-summaries')
  .onPublish(async (message, context) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();

    try {
      console.log('Weekly summary scheduler triggered', {
        eventId: context.eventId,
        timestamp: context.timestamp,
      });

      const messageData = message.data
        ? JSON.parse(Buffer.from(message.data, 'base64').toString())
        : {};

      const taskContext = {
        taskId: `weekly-summary-${context.eventId}`,
        taskName: 'weekly_summary',
        scheduledTime: new Date(context.timestamp),
        executionTime: new Date(),
        timezone: messageData.timezone || 'UTC',
        metadata: {
          eventId: context.eventId,
          summaryType: 'weekly',
          ...messageData,
        },
      };

      const result = await scheduledTasksManager.executeSummaryGeneration(taskContext);

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/weekly-summaries',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: result.success ? 200 : 500,
        requestSize: JSON.stringify(messageData).length,
        responseSize: JSON.stringify(result).length,
        cacheHit: false,
        metadata: {
          processedUsers: result.processedUsers,
          errors: result.errors.length,
        },
      });

      console.log('Weekly summary scheduler completed', {
        success: result.success,
        processedUsers: result.processedUsers,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      console.error('Weekly summary scheduler failed', {
        error: error.message,
        eventId: context.eventId,
      });

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/weekly-summaries',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 500,
        requestSize: 0,
        responseSize: 0,
        cacheHit: false,
        metadata: { error: error.message },
      });

      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Weekly summary scheduler failed',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { error: error.message, eventId: context.eventId },
        },
      });
    }
  });

/**
 * Monthly Summary Scheduler Function
 * Triggered by Cloud Scheduler to generate monthly summaries
 */
export const monthlySummaryScheduler = functions
  .region(schedulerConfig.region)
  .runWith({
    timeoutSeconds: schedulerConfig.timeoutSeconds,
    memory: schedulerConfig.memory,
  })
  .pubsub.topic('fylgja-monthly-summaries')
  .onPublish(async (message, context) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();

    try {
      console.log('Monthly summary scheduler triggered', {
        eventId: context.eventId,
        timestamp: context.timestamp,
      });

      const messageData = message.data
        ? JSON.parse(Buffer.from(message.data, 'base64').toString())
        : {};

      const taskContext = {
        taskId: `monthly-summary-${context.eventId}`,
        taskName: 'monthly_summary',
        scheduledTime: new Date(context.timestamp),
        executionTime: new Date(),
        timezone: messageData.timezone || 'UTC',
        metadata: {
          eventId: context.eventId,
          summaryType: 'monthly',
          ...messageData,
        },
      };

      const result = await scheduledTasksManager.executeSummaryGeneration(taskContext);

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/monthly-summaries',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: result.success ? 200 : 500,
        requestSize: JSON.stringify(messageData).length,
        responseSize: JSON.stringify(result).length,
        cacheHit: false,
        metadata: {
          processedUsers: result.processedUsers,
          errors: result.errors.length,
        },
      });

      console.log('Monthly summary scheduler completed', {
        success: result.success,
        processedUsers: result.processedUsers,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      console.error('Monthly summary scheduler failed', {
        error: error.message,
        eventId: context.eventId,
      });

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/monthly-summaries',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 500,
        requestSize: 0,
        responseSize: 0,
        cacheHit: false,
        metadata: { error: error.message },
      });

      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Monthly summary scheduler failed',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { error: error.message, eventId: context.eventId },
        },
      });
    }
  });

/**
 * Maintenance Scheduler Function
 * Triggered by Cloud Scheduler for system maintenance tasks
 */
export const maintenanceScheduler = functions
  .region(schedulerConfig.region)
  .runWith({
    timeoutSeconds: schedulerConfig.timeoutSeconds,
    memory: schedulerConfig.memory,
  })
  .pubsub.topic('fylgja-maintenance')
  .onPublish(async (message, context) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();

    try {
      console.log('Maintenance scheduler triggered', {
        eventId: context.eventId,
        timestamp: context.timestamp,
      });

      const messageData = message.data
        ? JSON.parse(Buffer.from(message.data, 'base64').toString())
        : {};

      const taskContext = {
        taskId: `maintenance-${context.eventId}`,
        taskName: 'maintenance',
        scheduledTime: new Date(context.timestamp),
        executionTime: new Date(),
        timezone: 'UTC',
        metadata: {
          eventId: context.eventId,
          maintenanceType: messageData.maintenanceType || 'health_check',
          ...messageData,
        },
      };

      const result = await scheduledTasksManager.executeMaintenanceTasks(taskContext);

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/maintenance',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: result.success ? 200 : 500,
        requestSize: JSON.stringify(messageData).length,
        responseSize: JSON.stringify(result).length,
        cacheHit: false,
        metadata: {
          maintenanceType: messageData.maintenanceType,
          errors: result.errors.length,
        },
      });

      console.log('Maintenance scheduler completed', {
        success: result.success,
        maintenanceType: messageData.maintenanceType,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      console.error('Maintenance scheduler failed', {
        error: error.message,
        eventId: context.eventId,
      });

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/maintenance',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 500,
        requestSize: 0,
        responseSize: 0,
        cacheHit: false,
        metadata: { error: error.message },
      });

      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Maintenance scheduler failed',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { error: error.message, eventId: context.eventId },
        },
      });
    }
  });

/**
 * Proactive Engagement Scheduler Function
 * Triggered by Cloud Scheduler for proactive user engagement
 */
export const proactiveEngagementScheduler = functions
  .region(schedulerConfig.region)
  .runWith({
    timeoutSeconds: schedulerConfig.timeoutSeconds,
    memory: schedulerConfig.memory,
  })
  .pubsub.topic('fylgja-proactive-engagement')
  .onPublish(async (message, context) => {
    const performanceMonitor = APIPerformanceMonitor.getInstance();
    const startTime = Date.now();

    try {
      console.log('Proactive engagement scheduler triggered', {
        eventId: context.eventId,
        timestamp: context.timestamp,
      });

      const messageData = message.data
        ? JSON.parse(Buffer.from(message.data, 'base64').toString())
        : {};

      const taskContext = {
        taskId: `proactive-engagement-${context.eventId}`,
        taskName: 'proactive_engagement',
        scheduledTime: new Date(context.timestamp),
        executionTime: new Date(),
        timezone: messageData.timezone || 'UTC',
        metadata: {
          eventId: context.eventId,
          engagementType: messageData.engagementType || 'check_in',
          ...messageData,
        },
      };

      const result = await scheduledTasksManager.executeProactiveEngagement(taskContext);

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/proactive-engagement',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: result.success ? 200 : 500,
        requestSize: JSON.stringify(messageData).length,
        responseSize: JSON.stringify(result).length,
        cacheHit: false,
        metadata: {
          processedUsers: result.processedUsers,
          errors: result.errors.length,
        },
      });

      console.log('Proactive engagement scheduler completed', {
        success: result.success,
        processedUsers: result.processedUsers,
        duration: result.duration,
      });

      return result;
    } catch (error) {
      console.error('Proactive engagement scheduler failed', {
        error: error.message,
        eventId: context.eventId,
      });

      performanceMonitor.recordMetric({
        endpoint: '/scheduler/proactive-engagement',
        method: 'POST',
        responseTime: Date.now() - startTime,
        statusCode: 500,
        requestSize: 0,
        responseSize: 0,
        cacheHit: false,
        metadata: { error: error.message },
      });

      throw new FylgjaError({
        type: ErrorType.SERVICE_UNAVAILABLE,
        message: 'Proactive engagement scheduler failed',
        context: {
          timestamp: new Date().toISOString(),
          metadata: { error: error.message, eventId: context.eventId },
        },
      });
    }
  });

/**
 * Scheduler Health Check Function
 * HTTP endpoint for monitoring scheduler health
 */
export const schedulerHealthCheck = functions
  .region(schedulerConfig.region)
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
  })
  .https.onRequest(async (req, res) => {
    try {
      const performanceMonitor = APIPerformanceMonitor.getInstance();

      // Get scheduler execution statistics
      const stats = scheduledTasksManager.getExecutionStatistics();
      const recentExecutions = scheduledTasksManager.getExecutionHistory(10);

      // Get system health
      const systemHealth = await performanceMonitor.getSystemHealth();

      const healthReport = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        scheduler: {
          totalExecutions: stats.totalExecutions,
          successRate: stats.successRate,
          averageExecutionTime: stats.averageExecutionTime,
          averageUsersProcessed: stats.averageUsersProcessed,
          errorRate: stats.errorRate,
        },
        system: systemHealth,
        recentExecutions: recentExecutions.map(exec => ({
          taskId: exec.taskId,
          success: exec.success,
          duration: exec.duration,
          processedUsers: exec.processedUsers,
          errorCount: exec.errors.length,
          executionTime: exec.executionTime,
        })),
      };

      // Determine overall health status
      if (stats.successRate < 0.9 || stats.errorRate > 0.1 || systemHealth.status !== 'healthy') {
        healthReport.status = 'degraded';
      }

      if (stats.successRate < 0.7 || stats.errorRate > 0.3 || systemHealth.status === 'unhealthy') {
        healthReport.status = 'unhealthy';
      }

      res.status(healthReport.status === 'healthy' ? 200 : 503).json(healthReport);
    } catch (error) {
      console.error('Scheduler health check failed', error);

      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  });

/**
 * Manual Task Trigger Function
 * HTTP endpoint for manually triggering scheduled tasks
 */
export const manualTaskTrigger = functions
  .region(schedulerConfig.region)
  .runWith({
    timeoutSeconds: schedulerConfig.timeoutSeconds,
    memory: schedulerConfig.memory,
  })
  .https.onRequest(async (req, res) => {
    try {
      // Validate request
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
      }

      const { taskType, parameters = {} } = req.body;

      if (!taskType) {
        return res.status(400).json({ error: 'Task type is required' });
      }

      console.log('Manual task trigger requested', {
        taskType,
        parameters,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
      });

      // Create task context
      const taskContext = {
        taskId: `manual-${taskType}-${Date.now()}`,
        taskName: taskType,
        scheduledTime: new Date(),
        executionTime: new Date(),
        timezone: parameters.timezone || 'UTC',
        metadata: {
          manual: true,
          triggeredBy: req.ip,
          ...parameters,
        },
      };

      let result;

      // Execute appropriate task
      switch (taskType) {
        case 'daily_checkin':
          result = await scheduledTasksManager.executeDailyCheckIns(taskContext);
          break;
        case 'reminders':
          result = await scheduledTasksManager.executeReminders(taskContext);
          break;
        case 'weekly_summary':
          taskContext.metadata.summaryType = 'weekly';
          result = await scheduledTasksManager.executeSummaryGeneration(taskContext);
          break;
        case 'monthly_summary':
          taskContext.metadata.summaryType = 'monthly';
          result = await scheduledTasksManager.executeSummaryGeneration(taskContext);
          break;
        case 'maintenance':
          taskContext.metadata.maintenanceType = parameters.maintenanceType || 'health_check';
          result = await scheduledTasksManager.executeMaintenanceTasks(taskContext);
          break;
        case 'proactive_engagement':
          result = await scheduledTasksManager.executeProactiveEngagement(taskContext);
          break;
        default:
          return res.status(400).json({ error: `Unknown task type: ${taskType}` });
      }

      console.log('Manual task completed', {
        taskType,
        success: result.success,
        duration: result.duration,
        processedUsers: result.processedUsers,
      });

      res.status(result.success ? 200 : 500).json({
        success: result.success,
        taskId: result.taskId,
        duration: result.duration,
        processedUsers: result.processedUsers,
        errors: result.errors,
        metrics: result.metrics,
      });
    } catch (error) {
      console.error('Manual task trigger failed', {
        error: error.message,
        stack: error.stack,
      });

      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });
