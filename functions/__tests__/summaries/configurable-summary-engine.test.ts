/**
 * Tests for Configurable Summary Engine
 */

import { ConfigurableSummaryEngine, SummaryConfiguration } from '../../src/summaries/configurable-summary-engine';
import { EnhancedDatabaseService } from '../../src/services/enhanced-database-service';
import { GoogleAIService } from '../../src/services/google-ai-service';

// Mock dependencies
jest.mock('../../src/services/enhanced-database-service');
jest.mock('../../src/services/google-ai-service');
jest.mock('../../src/cache/redis-cache-service');

describe('ConfigurableSummaryEngine', () => {
  let summaryEngine: ConfigurableSummaryEngine;
  let mockDatabaseService: jest.Mocked<EnhancedDatabaseService>;
  let mockAIService: jest.Mocked<GoogleAIService>;

  beforeEach(() => {
    summaryEngine = ConfigurableSummaryEngine.getInstance();
    mockDatabaseService = EnhancedDatabaseService.getInstance() as jest.Mocked<EnhancedDatabaseService>;
    mockAIService = GoogleAIService.getInstance() as jest.Mocked<GoogleAIService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('configureSummarySettings', () => {
    it('should save valid time-based configuration', async () => {
      const config: SummaryConfiguration = {
        userId: 'test-user-123',
        summaryType: 'time_based',
        timeInterval: {
          type: 'days',
          value: 3
        },
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDatabaseService.storeSummaryConfiguration.mockResolvedValue(undefined);

      await summaryEngine.configureSummarySettings(config);

      expect(mockDatabaseService.storeSummaryConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-123',
          summaryType: 'time_based',
          nextScheduledSummary: expect.any(Date)
        })
      );
    });

    it('should save valid milestone-based configuration', async () => {
      const config: SummaryConfiguration = {
        userId: 'test-user-456',
        summaryType: 'milestone_based',
        milestoneSettings: {
          goalCompletions: 3,
          interactionThreshold: 10,
          significantEvents: true,
          achievementMilestones: true
        },
        contentPreferences: {
          includeGoals: true,
          includeReflections: false,
          includeAchievements: true,
          includeChallenges: false,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'analytical',
          length: 'brief'
        },
        deliverySettings: {
          platforms: ['email'],
          timezone: 'America/New_York',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDatabaseService.storeSummaryConfiguration.mockResolvedValue(undefined);

      await summaryEngine.configureSummarySettings(config);

      expect(mockDatabaseService.storeSummaryConfiguration).toHaveBeenCalledWith(config);
    });

    it('should throw error for invalid configuration', async () => {
      const invalidConfig = {
        userId: '',
        summaryType: 'invalid_type',
        contentPreferences: {},
        deliverySettings: {}
      } as any;

      await expect(summaryEngine.configureSummarySettings(invalidConfig))
        .rejects.toThrow('User ID is required');
    });

    it('should validate time interval for time-based summaries', async () => {
      const config: SummaryConfiguration = {
        userId: 'test-user-789',
        summaryType: 'time_based',
        // Missing timeInterval
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await expect(summaryEngine.configureSummarySettings(config))
        .rejects.toThrow('Time interval is required for time-based summaries');
    });
  });

  describe('generateSummary', () => {
    beforeEach(() => {
      const mockConfig: SummaryConfiguration = {
        userId: 'test-user-123',
        summaryType: 'time_based',
        timeInterval: {
          type: 'weeks',
          value: 1
        },
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDatabaseService.getSummaryConfiguration.mockResolvedValue(mockConfig);
      mockDatabaseService.getUserInteractions.mockResolvedValue([
        { id: '1', timestamp: new Date(), platform: 'whatsapp', messageLength: 100 }
      ]);
      mockDatabaseService.getUserGoals.mockResolvedValue([
        { id: '1', status: 'completed', createdAt: new Date() }
      ]);
      mockDatabaseService.getUserAchievements.mockResolvedValue([]);
      mockDatabaseService.getUserReflections.mockResolvedValue([]);
      mockDatabaseService.getUserChallenges.mockResolvedValue([]);
      mockDatabaseService.storeSummary.mockResolvedValue(undefined);

      mockAIService.generateResponse.mockResolvedValue({
        response: 'Generated summary content',
        confidence: 0.9,
        metadata: {}
      });
    });

    it('should generate summary for enabled user', async () => {
      const summary = await summaryEngine.generateSummary('test-user-123', 'manual');

      expect(summary).toMatchObject({
        userId: 'test-user-123',
        content: expect.objectContaining({
          title: expect.any(String),
          sections: expect.any(Array),
          keyHighlights: expect.any(Array)
        }),
        metadata: expect.objectContaining({
          triggerType: 'manual',
          generatedAt: expect.any(Date)
        })
      });

      expect(mockDatabaseService.storeSummary).toHaveBeenCalled();
    });

    it('should throw error for disabled user', async () => {
      const disabledConfig = {
        ...await mockDatabaseService.getSummaryConfiguration('test-user-123'),
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: false
        }
      };

      mockDatabaseService.getSummaryConfiguration.mockResolvedValue(disabledConfig);

      await expect(summaryEngine.generateSummary('test-user-123', 'manual'))
        .rejects.toThrow('Summary generation is disabled for this user');
    });

    it('should handle AI service errors gracefully', async () => {
      mockAIService.generateResponse.mockRejectedValue(new Error('AI service unavailable'));

      await expect(summaryEngine.generateSummary('test-user-123', 'manual'))
        .rejects.toThrow('Failed to generate summary');
    });
  });

  describe('checkSummaryDue', () => {
    it('should return true for scheduled time-based summary', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      const config: SummaryConfiguration = {
        userId: 'test-user-123',
        summaryType: 'time_based',
        timeInterval: {
          type: 'days',
          value: 1
        },
        nextScheduledSummary: pastDate,
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDatabaseService.getSummaryConfiguration.mockResolvedValue(config);

      const result = await summaryEngine.checkSummaryDue('test-user-123');

      expect(result.isDue).toBe(true);
      expect(result.triggerType).toBe('scheduled');
      expect(result.reason).toBe('Scheduled time reached');
    });

    it('should return false for disabled user', async () => {
      const config: SummaryConfiguration = {
        userId: 'test-user-123',
        summaryType: 'time_based',
        timeInterval: {
          type: 'days',
          value: 1
        },
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: false
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDatabaseService.getSummaryConfiguration.mockResolvedValue(config);

      const result = await summaryEngine.checkSummaryDue('test-user-123');

      expect(result.isDue).toBe(false);
      expect(result.reason).toBe('Summary generation disabled');
    });

    it('should check milestone triggers for milestone-based summaries', async () => {
      const config: SummaryConfiguration = {
        userId: 'test-user-123',
        summaryType: 'milestone_based',
        milestoneSettings: {
          goalCompletions: 2,
          interactionThreshold: 5,
          significantEvents: true,
          achievementMilestones: true
        },
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDatabaseService.getSummaryConfiguration.mockResolvedValue(config);
      mockDatabaseService.getGoalCompletionsSince.mockResolvedValue(3); // More than threshold

      const result = await summaryEngine.checkSummaryDue('test-user-123');

      expect(result.isDue).toBe(true);
      expect(result.triggerType).toBe('milestone');
      expect(result.reason).toBe('Completed 3 goals');
    });
  });

  describe('calculateNextSummaryDate', () => {
    it('should calculate correct date for daily interval', () => {
      const config: SummaryConfiguration = {
        userId: 'test-user-123',
        summaryType: 'time_based',
        timeInterval: {
          type: 'days',
          value: 3
        },
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const engine = summaryEngine as any;
      const nextDate = engine.calculateNextSummaryDate(config);
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 3);

      expect(nextDate.getDate()).toBe(expectedDate.getDate());
    });

    it('should calculate correct date for weekly interval', () => {
      const config: SummaryConfiguration = {
        userId: 'test-user-123',
        summaryType: 'time_based',
        timeInterval: {
          type: 'weeks',
          value: 2
        },
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const engine = summaryEngine as any;
      const nextDate = engine.calculateNextSummaryDate(config);
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 14); // 2 weeks

      expect(nextDate.getDate()).toBe(expectedDate.getDate());
    });

    it('should set preferred time when specified', () => {
      const config: SummaryConfiguration = {
        userId: 'test-user-123',
        summaryType: 'time_based',
        timeInterval: {
          type: 'days',
          value: 1
        },
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          preferredTime: '09:30',
          timezone: 'UTC',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const engine = summaryEngine as any;
      const nextDate = engine.calculateNextSummaryDate(config);

      expect(nextDate.getHours()).toBe(9);
      expect(nextDate.getMinutes()).toBe(30);
    });
  });

  describe('data collection and analysis', () => {
    it('should collect comprehensive user data', async () => {
      const mockInteractions = [
        { id: '1', timestamp: new Date(), platform: 'whatsapp', messageLength: 100, userResponded: true }
      ];
      const mockGoals = [
        { id: '1', status: 'completed', createdAt: new Date() },
        { id: '2', status: 'in_progress', createdAt: new Date() }
      ];

      mockDatabaseService.getUserInteractions.mockResolvedValue(mockInteractions);
      mockDatabaseService.getUserGoals.mockResolvedValue(mockGoals);
      mockDatabaseService.getUserAchievements.mockResolvedValue([]);
      mockDatabaseService.getUserReflections.mockResolvedValue([]);
      mockDatabaseService.getUserChallenges.mockResolvedValue([]);

      const engine = summaryEngine as any;
      const period = {
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
        description: 'Last week'
      };
      const config: SummaryConfiguration = {
        userId: 'test-user-123',
        summaryType: 'time_based',
        timeInterval: { type: 'weeks', value: 1 },
        contentPreferences: {
          includeGoals: true,
          includeReflections: true,
          includeAchievements: true,
          includeChallenges: true,
          includeGrowthInsights: true,
          includeMotivationalContent: true,
          tone: 'encouraging',
          length: 'detailed'
        },
        deliverySettings: {
          platforms: ['whatsapp'],
          timezone: 'UTC',
          enabled: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const summaryData = await engine.collectSummaryData('test-user-123', period, config);

      expect(summaryData).toMatchObject({
        userId: 'test-user-123',
        period,
        interactions: expect.objectContaining({
          totalCount: 1,
          platforms: { whatsapp: 1 },
          engagementScore: expect.any(Number)
        }),
        goals: expect.objectContaining({
          completed: expect.arrayContaining([expect.objectContaining({ status: 'completed' })]),
          inProgress: expect.arrayContaining([expect.objectContaining({ status: 'in_progress' })]),
          completionRate: 50
        })
      });
    });

    it('should calculate engagement score correctly', () => {
      const interactions = [
        { userResponded: true, messageLength: 100 },
        { userResponded: false, messageLength: 50 },
        { userResponded: true, messageLength: 150 }
      ];

      const engine = summaryEngine as any;
      const score = engine.calculateEngagementScore(interactions);

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('should calculate goal completion rate correctly', () => {
      const goals = [
        { status: 'completed' },
        { status: 'completed' },
        { status: 'in_progress' },
        { status: 'not_started' }
      ];

      const engine = summaryEngine as any;
      const rate = engine.calculateGoalCompletionRate(goals);

      expect(rate).toBe(50); // 2 out of 4 completed
    });
  });

  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      mockDatabaseService.getSummaryConfiguration.mockRejectedValue(new Error('Database error'));

      await expect(summaryEngine.generateSummary('test-user-123', 'manual'))
        .rejects.toThrow('Failed to generate summary');
    });

    it('should handle missing user configuration', async () => {
      mockDatabaseService.getSummaryConfiguration.mockResolvedValue(null);
      mockDatabaseService.storeSummaryConfiguration.mockResolvedValue(undefined);

      // Should create default configuration
      const summary = await summaryEngine.generateSummary('test-user-123', 'manual');

      expect(mockDatabaseService.storeSummaryConfiguration).toHaveBeenCalled();
      expect(summary.userId).toBe('test-user-123');
    });
  });
});

