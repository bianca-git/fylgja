/**
 * Comprehensive Test Suite for Fylgja Reminder System
 */

import { ReminderSystem, Reminder, RecurrencePattern, DeliveryChannel } from '../../src/reminders/reminder-system';
import { ReminderScheduler } from '../../src/reminders/reminder-scheduler';
import { ReminderTemplateManager } from '../../src/reminders/reminder-templates';
import { EnhancedDatabaseService } from '../../src/services/enhanced-database-service';
import { GoogleAIService } from '../../src/services/google-ai-service';
import { TwilioService } from '../../src/services/twilio-service';

// Mock dependencies
jest.mock('../../src/services/enhanced-database-service');
jest.mock('../../src/services/google-ai-service');
jest.mock('../../src/services/twilio-service');
jest.mock('../../src/cache/redis-cache-service');

describe('ReminderSystem', () => {
  let reminderSystem: ReminderSystem;
  let mockDatabaseService: jest.Mocked<EnhancedDatabaseService>;
  let mockAIService: jest.Mocked<GoogleAIService>;

  beforeEach(() => {
    reminderSystem = ReminderSystem.getInstance();
    mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
    mockAIService = GoogleAIService.getInstance() as jest.Mocked<GoogleAIService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createReminder', () => {
    it('should create a basic reminder successfully', async () => {
      const reminderData = {
        userId: 'test-user-123',
        title: 'Take medication',
        description: 'Take morning vitamins',
        scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        priority: 'high' as const,
        category: 'health' as const
      };

      mockDatabaseService.storeReminder.mockResolvedValue(undefined);
      mockDatabaseService.getDefaultDeliveryChannels.mockResolvedValue([
        { type: 'whatsapp', address: '+1234567890', enabled: true, priority: 1 }
      ]);
      mockAIService.generateResponse.mockResolvedValue({
        response: 'Enhanced reminder content',
        confidence: 0.8,
        metadata: {}
      });

      const reminder = await reminderSystem.createReminder(reminderData);

      expect(reminder).toMatchObject({
        userId: 'test-user-123',
        title: 'Take medication',
        description: 'Take morning vitamins',
        priority: 'high',
        category: 'health',
        status: 'active'
      });

      expect(mockDatabaseService.storeReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-123',
          title: 'Take medication',
          status: 'active'
        })
      );
    });

    it('should create recurring reminder with proper recurrence pattern', async () => {
      const recurrence: RecurrencePattern = {
        type: 'daily',
        interval: 1,
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      };

      const reminderData = {
        userId: 'test-user-456',
        title: 'Daily exercise',
        scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        recurrence,
        priority: 'medium' as const,
        category: 'health' as const
      };

      mockDatabaseService.storeReminder.mockResolvedValue(undefined);
      mockDatabaseService.getDefaultDeliveryChannels.mockResolvedValue([]);

      const reminder = await reminderSystem.createReminder(reminderData);

      expect(reminder.recurrence).toEqual(recurrence);
      expect(reminder.recurrence?.type).toBe('daily');
      expect(reminder.recurrence?.interval).toBe(1);
    });

    it('should validate required fields', async () => {
      const invalidReminderData = {
        userId: '',
        title: '',
        scheduledTime: new Date(Date.now() - 24 * 60 * 60 * 1000) // Past date
      };

      await expect(reminderSystem.createReminder(invalidReminderData))
        .rejects.toThrow('User ID is required');
    });

    it('should validate scheduled time is in the future', async () => {
      const reminderData = {
        userId: 'test-user-789',
        title: 'Valid title',
        scheduledTime: new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
      };

      await expect(reminderSystem.createReminder(reminderData))
        .rejects.toThrow('Scheduled time must be in the future');
    });

    it('should handle AI enhancement gracefully when AI service fails', async () => {
      const reminderData = {
        userId: 'test-user-101',
        title: 'Test reminder',
        scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000)
      };

      mockDatabaseService.storeReminder.mockResolvedValue(undefined);
      mockDatabaseService.getDefaultDeliveryChannels.mockResolvedValue([]);
      mockAIService.generateResponse.mockRejectedValue(new Error('AI service unavailable'));

      const reminder = await reminderSystem.createReminder(reminderData);

      expect(reminder.title).toBe('Test reminder');
      expect(mockDatabaseService.storeReminder).toHaveBeenCalled();
    });
  });

  describe('updateReminder', () => {
    it('should update reminder successfully', async () => {
      const existingReminder: Reminder = {
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Original title',
        scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
        timezone: 'UTC',
        priority: 'medium',
        category: 'personal',
        tags: [],
        context: {},
        delivery: {
          channels: [],
          advanceNotifications: [],
          tone: 'friendly'
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      const updates = {
        title: 'Updated title',
        priority: 'high' as const
      };

      mockDatabaseService.getReminder.mockResolvedValue(existingReminder);
      mockDatabaseService.updateReminder.mockResolvedValue(undefined);

      const updatedReminder = await reminderSystem.updateReminder('reminder-123', updates);

      expect(updatedReminder.title).toBe('Updated title');
      expect(updatedReminder.priority).toBe('high');
      expect(mockDatabaseService.updateReminder).toHaveBeenCalledWith(
        'reminder-123',
        expect.objectContaining({
          title: 'Updated title',
          priority: 'high'
        })
      );
    });

    it('should throw error for non-existent reminder', async () => {
      mockDatabaseService.getReminder.mockResolvedValue(null);

      await expect(reminderSystem.updateReminder('non-existent', { title: 'New title' }))
        .rejects.toThrow('Reminder not found');
    });
  });

  describe('deleteReminder', () => {
    it('should delete reminder successfully', async () => {
      const reminder: Reminder = {
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Test reminder',
        scheduledTime: new Date(),
        timezone: 'UTC',
        priority: 'medium',
        category: 'personal',
        tags: [],
        context: {},
        delivery: {
          channels: [],
          advanceNotifications: [],
          tone: 'friendly'
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      mockDatabaseService.getReminder.mockResolvedValue(reminder);
      mockDatabaseService.updateReminder.mockResolvedValue(undefined);

      await reminderSystem.deleteReminder('reminder-123');

      expect(mockDatabaseService.updateReminder).toHaveBeenCalledWith(
        'reminder-123',
        expect.objectContaining({
          status: 'cancelled'
        })
      );
    });
  });

  describe('snoozeReminder', () => {
    it('should snooze reminder successfully', async () => {
      const reminder: Reminder = {
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Test reminder',
        scheduledTime: new Date(),
        timezone: 'UTC',
        priority: 'medium',
        category: 'personal',
        tags: [],
        context: {},
        delivery: {
          channels: [],
          advanceNotifications: [],
          tone: 'friendly'
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      const snoozeUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      mockDatabaseService.getReminder.mockResolvedValue(reminder);
      mockDatabaseService.updateReminder.mockResolvedValue(undefined);

      const snoozedReminder = await reminderSystem.snoozeReminder('reminder-123', snoozeUntil);

      expect(snoozedReminder.status).toBe('snoozed');
      expect(snoozedReminder.snoozeUntil).toEqual(snoozeUntil);
    });
  });

  describe('completeReminder', () => {
    it('should complete reminder successfully', async () => {
      const reminder: Reminder = {
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Test reminder',
        scheduledTime: new Date(),
        timezone: 'UTC',
        priority: 'medium',
        category: 'personal',
        tags: [],
        context: {},
        delivery: {
          channels: [],
          advanceNotifications: [],
          tone: 'friendly'
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      mockDatabaseService.getReminder.mockResolvedValue(reminder);
      mockDatabaseService.updateReminder.mockResolvedValue(undefined);

      const completedReminder = await reminderSystem.completeReminder('reminder-123', 'Completed successfully', 5);

      expect(completedReminder.status).toBe('completed');
      expect(completedReminder.completedAt).toBeDefined();
      expect(completedReminder.context.completionNotes).toBe('Completed successfully');
      expect(completedReminder.context.effectiveness).toBe(5);
    });

    it('should create next recurring reminder when completing recurring reminder', async () => {
      const recurringReminder: Reminder = {
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Daily exercise',
        scheduledTime: new Date(),
        timezone: 'UTC',
        priority: 'medium',
        category: 'health',
        tags: [],
        context: {},
        delivery: {
          channels: [],
          advanceNotifications: [],
          tone: 'friendly'
        },
        status: 'active',
        recurrence: {
          type: 'daily',
          interval: 1
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      mockDatabaseService.getReminder.mockResolvedValue(recurringReminder);
      mockDatabaseService.updateReminder.mockResolvedValue(undefined);
      mockDatabaseService.storeReminder.mockResolvedValue(undefined);

      await reminderSystem.completeReminder('reminder-123');

      // Should create next recurring instance
      expect(mockDatabaseService.storeReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Daily exercise',
          createdBy: 'system',
          metadata: expect.objectContaining({
            parentReminderId: 'reminder-123'
          })
        })
      );
    });
  });

  describe('getUserReminders', () => {
    it('should retrieve user reminders with filters', async () => {
      const mockReminders = [
        {
          id: 'reminder-1',
          userId: 'test-user-123',
          title: 'Reminder 1',
          category: 'health',
          priority: 'high',
          status: 'active'
        },
        {
          id: 'reminder-2',
          userId: 'test-user-123',
          title: 'Reminder 2',
          category: 'work',
          priority: 'medium',
          status: 'completed'
        }
      ];

      mockDatabaseService.getUserReminders.mockResolvedValue({
        reminders: mockReminders as any,
        total: 2
      });

      const filters = {
        status: ['active'],
        category: ['health', 'work']
      };

      const result = await reminderSystem.getUserReminders('test-user-123', filters);

      expect(result.reminders).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockDatabaseService.getUserReminders).toHaveBeenCalledWith(
        'test-user-123',
        filters,
        undefined
      );
    });

    it('should handle pagination', async () => {
      mockDatabaseService.getUserReminders.mockResolvedValue({
        reminders: [],
        total: 0
      });

      const pagination = { limit: 10, offset: 20 };

      await reminderSystem.getUserReminders('test-user-123', undefined, pagination);

      expect(mockDatabaseService.getUserReminders).toHaveBeenCalledWith(
        'test-user-123',
        undefined,
        pagination
      );
    });
  });

  describe('getSmartSuggestions', () => {
    it('should generate smart suggestions based on user patterns', async () => {
      const mockPatterns = {
        preferredCategories: { health: 5, work: 3 },
        preferredTimes: { 9: 3, 18: 2 },
        insights: ['High completion rate']
      };

      mockDatabaseService.getUserReminderPatterns.mockResolvedValue(mockPatterns);
      mockAIService.generateResponse.mockResolvedValue({
        response: 'AI-generated suggestions',
        confidence: 0.8,
        metadata: {}
      });

      const suggestions = await reminderSystem.getSmartSuggestions('test-user-123');

      expect(suggestions).toBeDefined();
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });
});

describe('ReminderScheduler', () => {
  let reminderScheduler: ReminderScheduler;
  let mockTwilioService: jest.Mocked<TwilioService>;

  beforeEach(() => {
    reminderScheduler = ReminderScheduler.getInstance();
    mockTwilioService = TwilioService.getInstance() as jest.Mocked<TwilioService>;
  });

  describe('scheduleReminder', () => {
    it('should schedule reminder for delivery', async () => {
      const reminder: Reminder = {
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Test reminder',
        scheduledTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        timezone: 'UTC',
        priority: 'medium',
        category: 'personal',
        tags: [],
        context: {},
        delivery: {
          channels: [
            { type: 'whatsapp', address: '+1234567890', enabled: true, priority: 1 }
          ],
          advanceNotifications: [],
          tone: 'friendly'
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
      mockDatabaseService.storeScheduledJob.mockResolvedValue(undefined);

      const job = await reminderScheduler.scheduleReminder(reminder);

      expect(job).toMatchObject({
        reminderId: 'reminder-123',
        userId: 'test-user-123',
        jobType: 'reminder',
        status: 'pending'
      });

      expect(mockDatabaseService.storeScheduledJob).toHaveBeenCalled();
    });
  });

  describe('deliverReminder', () => {
    it('should deliver reminder through WhatsApp successfully', async () => {
      const reminder: Reminder = {
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Take medication',
        scheduledTime: new Date(),
        timezone: 'UTC',
        priority: 'high',
        category: 'health',
        tags: [],
        context: {},
        delivery: {
          channels: [
            { type: 'whatsapp', address: '+1234567890', enabled: true, priority: 1 }
          ],
          advanceNotifications: [],
          tone: 'friendly'
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      mockTwilioService.sendWhatsAppMessage.mockResolvedValue({ sid: 'message-123' } as any);

      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
      mockDatabaseService.storeDeliveryReport.mockResolvedValue(undefined);
      mockDatabaseService.storeDeliveryAnalytics.mockResolvedValue(undefined);

      const report = await reminderScheduler.deliverReminder(reminder);

      expect(report.overallSuccess).toBe(true);
      expect(report.successfulDeliveries).toBe(1);
      expect(report.results).toHaveLength(1);
      expect(report.results[0].success).toBe(true);
      expect(report.results[0].messageId).toBe('message-123');

      expect(mockTwilioService.sendWhatsAppMessage).toHaveBeenCalledWith(
        '+1234567890',
        expect.stringContaining('Take medication')
      );
    });

    it('should handle delivery failures gracefully', async () => {
      const reminder: Reminder = {
        id: 'reminder-456',
        userId: 'test-user-456',
        title: 'Test reminder',
        scheduledTime: new Date(),
        timezone: 'UTC',
        priority: 'medium',
        category: 'personal',
        tags: [],
        context: {},
        delivery: {
          channels: [
            { type: 'whatsapp', address: '+1234567890', enabled: true, priority: 1 }
          ],
          advanceNotifications: [],
          tone: 'friendly'
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      mockTwilioService.sendWhatsAppMessage.mockRejectedValue(new Error('Delivery failed'));

      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
      mockDatabaseService.storeDeliveryReport.mockResolvedValue(undefined);
      mockDatabaseService.storeDeliveryAnalytics.mockResolvedValue(undefined);

      const report = await reminderScheduler.deliverReminder(reminder);

      expect(report.overallSuccess).toBe(false);
      expect(report.successfulDeliveries).toBe(0);
      expect(report.failedDeliveries).toBe(1);
      expect(report.results[0].success).toBe(false);
      expect(report.results[0].errorMessage).toBe('WhatsApp delivery failed: Delivery failed');
    });
  });

  describe('processDueReminders', () => {
    it('should process multiple due reminders', async () => {
      const mockJobs = [
        {
          id: 'job-1',
          reminderId: 'reminder-1',
          userId: 'user-1',
          scheduledTime: new Date(),
          jobType: 'reminder',
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'job-2',
          reminderId: 'reminder-2',
          userId: 'user-2',
          scheduledTime: new Date(),
          jobType: 'reminder',
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
      mockDatabaseService.getDueScheduledJobs.mockResolvedValue(mockJobs as any);
      mockDatabaseService.getReminder.mockResolvedValue({
        id: 'reminder-1',
        delivery: { channels: [] }
      } as any);
      mockDatabaseService.updateScheduledJob.mockResolvedValue(undefined);
      mockDatabaseService.storeDeliveryReport.mockResolvedValue(undefined);
      mockDatabaseService.storeDeliveryAnalytics.mockResolvedValue(undefined);

      await reminderScheduler.processDueReminders();

      expect(mockDatabaseService.getDueScheduledJobs).toHaveBeenCalled();
      expect(mockDatabaseService.updateScheduledJob).toHaveBeenCalledTimes(4); // 2 processing + 2 completed
    });
  });
});

describe('ReminderTemplateManager', () => {
  let templateManager: ReminderTemplateManager;

  beforeEach(() => {
    templateManager = ReminderTemplateManager.getInstance();
  });

  describe('getTemplateCategories', () => {
    it('should return organized template categories', async () => {
      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
      mockDatabaseService.getUserTemplates.mockResolvedValue([]);

      const categories = await templateManager.getTemplateCategories();

      expect(categories).toBeDefined();
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);

      // Check that health category exists with expected templates
      const healthCategory = categories.find(c => c.id === 'health');
      expect(healthCategory).toBeDefined();
      expect(healthCategory?.name).toBe('Health & Wellness');
      expect(healthCategory?.templates.length).toBeGreaterThan(0);
    });
  });

  describe('getPersonalizedTemplates', () => {
    it('should return personalized template suggestions', async () => {
      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
      const mockAIService = GoogleAIService.getInstance() as jest.Mocked<GoogleAIService>;

      mockDatabaseService.getUserReminderPatterns.mockResolvedValue({
        preferredCategories: { health: 5 },
        preferredTimes: { 9: 3 }
      });
      mockDatabaseService.getUserProfile.mockResolvedValue({
        userId: 'test-user-123',
        preferences: {}
      });
      mockDatabaseService.getUserTemplates.mockResolvedValue([]);

      mockAIService.generateResponse.mockResolvedValue({
        response: 'Personalized suggestions',
        confidence: 0.8,
        metadata: {}
      });

      const personalizedTemplates = await templateManager.getPersonalizedTemplates('test-user-123');

      expect(personalizedTemplates).toBeDefined();
      expect(Array.isArray(personalizedTemplates)).toBe(true);
      expect(personalizedTemplates.length).toBeLessThanOrEqual(10);

      if (personalizedTemplates.length > 0) {
        expect(personalizedTemplates[0]).toMatchObject({
          template: expect.any(Object),
          personalizationScore: expect.any(Number),
          customizations: expect.any(Object)
        });
      }
    });
  });

  describe('createTemplateFromReminder', () => {
    it('should create template from existing reminder', async () => {
      const reminder: Reminder = {
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Daily meditation',
        description: '10 minutes of mindfulness',
        scheduledTime: new Date(),
        timezone: 'UTC',
        priority: 'medium',
        category: 'personal',
        tags: ['mindfulness', 'wellness'],
        context: {},
        delivery: {
          channels: [],
          advanceNotifications: [],
          tone: 'encouraging'
        },
        status: 'active',
        recurrence: {
          type: 'daily',
          interval: 1
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
      mockDatabaseService.storeReminderTemplate.mockResolvedValue(undefined);

      const template = await templateManager.createTemplateFromReminder(
        'test-user-123',
        reminder,
        'Daily Meditation Template',
        'A template for daily meditation reminders',
        false
      );

      expect(template).toMatchObject({
        name: 'Daily Meditation Template',
        description: 'A template for daily meditation reminders',
        category: 'personal',
        defaultTitle: 'Daily meditation',
        defaultDescription: '10 minutes of mindfulness',
        defaultPriority: 'medium',
        isSystemTemplate: false,
        createdBy: 'test-user-123'
      });

      expect(mockDatabaseService.storeReminderTemplate).toHaveBeenCalledWith(template, false);
    });
  });

  describe('generateSmartSuggestions', () => {
    it('should generate various types of smart suggestions', async () => {
      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
      const mockAIService = GoogleAIService.getInstance() as jest.Mocked<GoogleAIService>;

      mockDatabaseService.getUserReminderPatterns.mockResolvedValue({
        patterns: { preferredCategories: { health: 5 } },
        recentActivity: [],
        insights: ['High completion rate']
      });
      mockDatabaseService.getRecentReminders.mockResolvedValue([]);
      mockDatabaseService.getUserGoals.mockResolvedValue([
        {
          id: 'goal-1',
          title: 'Exercise regularly',
          status: 'in_progress'
        }
      ]);

      mockAIService.generateResponse.mockResolvedValue({
        response: 'AI suggestions',
        confidence: 0.7,
        metadata: {}
      });

      const suggestions = await templateManager.generateSmartSuggestions('test-user-123');

      expect(suggestions).toBeDefined();
      expect(Array.isArray(suggestions)).toBe(true);
      expect(suggestions.length).toBeLessThanOrEqual(5);

      if (suggestions.length > 0) {
        expect(suggestions[0]).toMatchObject({
          userId: 'test-user-123',
          type: expect.stringMatching(/^(reminder|optimization|pattern)$/),
          suggestion: expect.objectContaining({
            title: expect.any(String),
            description: expect.any(String),
            confidence: expect.any(Number),
            reasoning: expect.any(String)
          }),
          status: 'pending'
        });
      }
    });
  });
});

describe('Integration Tests', () => {
  describe('Complete Reminder Lifecycle', () => {
    it('should handle complete reminder lifecycle from creation to completion', async () => {
      const reminderSystem = ReminderSystem.getInstance();
      const reminderScheduler = ReminderScheduler.getInstance();

      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
      const mockTwilioService = TwilioService.getInstance() as jest.Mocked<TwilioService>;

      // Mock all required database operations
      mockDatabaseService.storeReminder.mockResolvedValue(undefined);
      mockDatabaseService.getDefaultDeliveryChannels.mockResolvedValue([
        { type: 'whatsapp', address: '+1234567890', enabled: true, priority: 1 }
      ]);
      mockDatabaseService.getReminder.mockResolvedValue({
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Test reminder',
        status: 'active'
      } as any);
      mockDatabaseService.updateReminder.mockResolvedValue(undefined);
      mockDatabaseService.storeScheduledJob.mockResolvedValue(undefined);
      mockDatabaseService.storeDeliveryReport.mockResolvedValue(undefined);
      mockDatabaseService.storeDeliveryAnalytics.mockResolvedValue(undefined);

      mockTwilioService.sendWhatsAppMessage.mockResolvedValue({ sid: 'message-123' } as any);

      // 1. Create reminder
      const reminderData = {
        userId: 'test-user-123',
        title: 'Integration test reminder',
        scheduledTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        priority: 'medium' as const,
        category: 'personal' as const
      };

      const reminder = await reminderSystem.createReminder(reminderData);
      expect(reminder.id).toBeDefined();
      expect(reminder.status).toBe('active');

      // 2. Schedule reminder
      const job = await reminderScheduler.scheduleReminder(reminder);
      expect(job.reminderId).toBe(reminder.id);
      expect(job.status).toBe('pending');

      // 3. Deliver reminder
      const deliveryReport = await reminderScheduler.deliverReminder(reminder);
      expect(deliveryReport.overallSuccess).toBe(true);
      expect(deliveryReport.successfulDeliveries).toBe(1);

      // 4. Complete reminder
      const completedReminder = await reminderSystem.completeReminder(reminder.id, 'Test completion');
      expect(completedReminder.status).toBe('completed');
      expect(completedReminder.completedAt).toBeDefined();
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle database errors gracefully', async () => {
      const reminderSystem = ReminderSystem.getInstance();
      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;

      mockDatabaseService.storeReminder.mockRejectedValue(new Error('Database connection failed'));

      const reminderData = {
        userId: 'test-user-123',
        title: 'Test reminder',
        scheduledTime: new Date(Date.now() + 60 * 60 * 1000)
      };

      await expect(reminderSystem.createReminder(reminderData))
        .rejects.toThrow('Failed to create reminder');
    });

    it('should handle delivery service errors gracefully', async () => {
      const reminderScheduler = ReminderScheduler.getInstance();
      const mockTwilioService = TwilioService.getInstance() as jest.Mocked<TwilioService>;
      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;

      mockTwilioService.sendWhatsAppMessage.mockRejectedValue(new Error('Service unavailable'));
      mockDatabaseService.storeDeliveryReport.mockResolvedValue(undefined);
      mockDatabaseService.storeDeliveryAnalytics.mockResolvedValue(undefined);

      const reminder: Reminder = {
        id: 'reminder-123',
        userId: 'test-user-123',
        title: 'Test reminder',
        scheduledTime: new Date(),
        timezone: 'UTC',
        priority: 'medium',
        category: 'personal',
        tags: [],
        context: {},
        delivery: {
          channels: [
            { type: 'whatsapp', address: '+1234567890', enabled: true, priority: 1 }
          ],
          advanceNotifications: [],
          tone: 'friendly'
        },
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'user',
        metadata: {}
      };

      const report = await reminderScheduler.deliverReminder(reminder);

      expect(report.overallSuccess).toBe(false);
      expect(report.failedDeliveries).toBe(1);
      expect(report.results[0].success).toBe(false);
    });
  });
});

describe('Performance Tests', () => {
  describe('Bulk Operations', () => {
    it('should handle bulk reminder creation efficiently', async () => {
      const reminderSystem = ReminderSystem.getInstance();
      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;

      mockDatabaseService.storeReminder.mockResolvedValue(undefined);
      mockDatabaseService.getDefaultDeliveryChannels.mockResolvedValue([]);

      const startTime = Date.now();
      const promises = [];

      // Create 100 reminders concurrently
      for (let i = 0; i < 100; i++) {
        const reminderData = {
          userId: `test-user-${i}`,
          title: `Bulk reminder ${i}`,
          scheduledTime: new Date(Date.now() + (i * 60 * 1000)) // Stagger by minutes
        };

        promises.push(reminderSystem.createReminder(reminderData));
      }

      const reminders = await Promise.all(promises);
      const endTime = Date.now();

      expect(reminders).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(10000); // Should complete within 10 seconds
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory during repeated operations', async () => {
      const reminderSystem = ReminderSystem.getInstance();
      const mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;

      mockDatabaseService.getUserReminders.mockResolvedValue({
        reminders: [],
        total: 0
      });

      const initialMemory = process.memoryUsage().heapUsed;

      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        await reminderSystem.getUserReminders(`test-user-${i % 10}`);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });
});

