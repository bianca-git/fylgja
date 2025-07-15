/**
 * Configurable Summary Engine for Fylgja
 * Generates personalized summaries based on user-defined intervals and triggers
 */

import { EnhancedDatabaseService } from '../services/enhanced-database-service';
import { GoogleAIService } from '../services/google-ai-service';
import { ResponsePersonalizer } from '../personalization/response-personalizer';
import { FylgjaError, ErrorType } from '../utils/error-handler';
import { RedisCacheService } from '../cache/redis-cache-service';

export interface SummaryConfiguration {
  userId: string;
  summaryType: 'time_based' | 'milestone_based' | 'hybrid';
  timeInterval?: {
    type: 'days' | 'weeks' | 'months' | 'custom';
    value: number; // e.g., 3 for "every 3 days"
    customUnit?: 'hours' | 'days' | 'weeks' | 'months';
  };
  milestoneSettings?: {
    goalCompletions: number; // Generate summary after X goals completed
    interactionThreshold: number; // Generate after X interactions
    significantEvents: boolean; // Generate on major life events
    achievementMilestones: boolean; // Generate on achievements
  };
  contentPreferences: {
    includeGoals: boolean;
    includeReflections: boolean;
    includeAchievements: boolean;
    includeChallenges: boolean;
    includeGrowthInsights: boolean;
    includeMotivationalContent: boolean;
    tone: 'encouraging' | 'analytical' | 'casual' | 'professional';
    length: 'brief' | 'detailed' | 'comprehensive';
  };
  deliverySettings: {
    platforms: string[]; // Which platforms to send summaries to
    preferredTime?: string; // HH:MM format for time-based summaries
    timezone: string;
    enabled: boolean;
  };
  lastSummaryGenerated?: Date;
  nextScheduledSummary?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SummaryData {
  userId: string;
  period: {
    startDate: Date;
    endDate: Date;
    description: string; // e.g., "Last 5 days", "Since your last goal completion"
  };
  interactions: {
    totalCount: number;
    platforms: Record<string, number>;
    averageResponseTime: number;
    engagementScore: number;
  };
  goals: {
    completed: any[];
    inProgress: any[];
    newGoals: any[];
    completionRate: number;
  };
  achievements: {
    milestones: any[];
    streaks: any[];
    personalBests: any[];
  };
  reflections: {
    keyInsights: string[];
    emotionalTrends: any[];
    learningMoments: any[];
  };
  challenges: {
    identified: any[];
    overcome: any[];
    ongoing: any[];
  };
  growthMetrics: {
    consistencyScore: number;
    progressScore: number;
    engagementTrend: 'increasing' | 'stable' | 'decreasing';
    areasOfImprovement: string[];
  };
  personalizedInsights: {
    strengths: string[];
    opportunities: string[];
    recommendations: string[];
    motivationalMessage: string;
  };
}

export interface GeneratedSummary {
  id: string;
  userId: string;
  configuration: SummaryConfiguration;
  data: SummaryData;
  content: {
    title: string;
    sections: {
      name: string;
      content: string;
      insights: string[];
    }[];
    keyHighlights: string[];
    actionItems: string[];
    motivationalClosing: string;
  };
  metadata: {
    generatedAt: Date;
    triggerType: 'scheduled' | 'milestone' | 'manual';
    triggerDetails: any;
    processingTime: number;
    contentLength: number;
  };
}

export class ConfigurableSummaryEngine {
  private static instance: ConfigurableSummaryEngine;
  private databaseService: EnhancedDatabaseService;
  private aiService: GoogleAIService;
  private responsePersonalizer: ResponsePersonalizer;
  private cacheService: RedisCacheService;

  private constructor() {
    this.databaseService = EnhancedDatabaseService.getInstance();
    this.aiService = GoogleAIService.getInstance();
    this.responsePersonalizer = ResponsePersonalizer.getInstance();
    this.cacheService = RedisCacheService.getInstance();
  }

  public static getInstance(): ConfigurableSummaryEngine {
    if (!ConfigurableSummaryEngine.instance) {
      ConfigurableSummaryEngine.instance = new ConfigurableSummaryEngine();
    }
    return ConfigurableSummaryEngine.instance;
  }

  /**
   * Create or update user's summary configuration
   */
  public async configureSummarySettings(config: SummaryConfiguration): Promise<void> {
    try {
      console.log('Configuring summary settings', {
        userId: config.userId,
        summaryType: config.summaryType,
        timeInterval: config.timeInterval,
        enabled: config.deliverySettings.enabled
      });

      // Validate configuration
      this.validateSummaryConfiguration(config);

      // Calculate next scheduled summary if time-based
      if (config.summaryType === 'time_based' || config.summaryType === 'hybrid') {
        config.nextScheduledSummary = this.calculateNextSummaryDate(config);
      }

      // Store configuration in database
      await this.databaseService.storeSummaryConfiguration(config);

      // Cache configuration for quick access
      const cacheKey = `summary_config:${config.userId}`;
      await this.cacheService.set(cacheKey, config, 3600); // Cache for 1 hour

      console.log('Summary configuration saved successfully', {
        userId: config.userId,
        nextScheduled: config.nextScheduledSummary
      });

    } catch (error) {
      console.error('Failed to configure summary settings', {
        userId: config.userId,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.VALIDATION_ERROR,
        message: 'Failed to configure summary settings',
        context: { userId: config.userId, error: error.message }
      });
    }
  }

  /**
   * Generate summary for user based on their configuration
   */
  public async generateSummary(
    userId: string,
    triggerType: 'scheduled' | 'milestone' | 'manual' = 'manual',
    triggerDetails?: any
  ): Promise<GeneratedSummary> {
    const startTime = Date.now();

    try {
      console.log('Generating summary', {
        userId,
        triggerType,
        triggerDetails
      });

      // Get user's summary configuration
      const config = await this.getSummaryConfiguration(userId);
      if (!config.deliverySettings.enabled) {
        throw new FylgjaError({
          type: ErrorType.VALIDATION_ERROR,
          message: 'Summary generation is disabled for this user',
          context: { userId }
        });
      }

      // Determine summary period based on configuration
      const summaryPeriod = await this.determineSummaryPeriod(config, triggerType, triggerDetails);

      // Collect and analyze user data for the period
      const summaryData = await this.collectSummaryData(userId, summaryPeriod, config);

      // Generate AI-powered insights and content
      const summaryContent = await this.generateSummaryContent(summaryData, config);

      // Create final summary object
      const generatedSummary: GeneratedSummary = {
        id: `summary-${userId}-${Date.now()}`,
        userId,
        configuration: config,
        data: summaryData,
        content: summaryContent,
        metadata: {
          generatedAt: new Date(),
          triggerType,
          triggerDetails,
          processingTime: Date.now() - startTime,
          contentLength: JSON.stringify(summaryContent).length
        }
      };

      // Store summary in database
      await this.databaseService.storeSummary(generatedSummary);

      // Update user's last summary date
      await this.updateLastSummaryDate(userId, new Date());

      // Schedule next summary if time-based
      if (config.summaryType === 'time_based' || config.summaryType === 'hybrid') {
        const nextSummaryDate = this.calculateNextSummaryDate(config);
        await this.updateNextSummaryDate(userId, nextSummaryDate);
      }

      console.log('Summary generated successfully', {
        userId,
        summaryId: generatedSummary.id,
        processingTime: generatedSummary.metadata.processingTime,
        contentLength: generatedSummary.metadata.contentLength
      });

      return generatedSummary;

    } catch (error) {
      console.error('Failed to generate summary', {
        userId,
        triggerType,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to generate summary',
        context: { userId, triggerType, error: error.message }
      });
    }
  }

  /**
   * Check if user is due for a summary based on their configuration
   */
  public async checkSummaryDue(userId: string): Promise<{
    isDue: boolean;
    reason?: string;
    triggerType?: 'scheduled' | 'milestone';
    details?: any;
  }> {
    try {
      const config = await this.getSummaryConfiguration(userId);
      
      if (!config.deliverySettings.enabled) {
        return { isDue: false, reason: 'Summary generation disabled' };
      }

      // Check time-based triggers
      if (config.summaryType === 'time_based' || config.summaryType === 'hybrid') {
        if (config.nextScheduledSummary && new Date() >= config.nextScheduledSummary) {
          return {
            isDue: true,
            reason: 'Scheduled time reached',
            triggerType: 'scheduled',
            details: { scheduledTime: config.nextScheduledSummary }
          };
        }
      }

      // Check milestone-based triggers
      if (config.summaryType === 'milestone_based' || config.summaryType === 'hybrid') {
        const milestoneCheck = await this.checkMilestoneTriggers(userId, config);
        if (milestoneCheck.triggered) {
          return {
            isDue: true,
            reason: milestoneCheck.reason,
            triggerType: 'milestone',
            details: milestoneCheck.details
          };
        }
      }

      return { isDue: false, reason: 'No triggers met' };

    } catch (error) {
      console.error('Failed to check summary due status', {
        userId,
        error: error.message
      });

      return { isDue: false, reason: 'Error checking status' };
    }
  }

  /**
   * Get user's summary configuration
   */
  private async getSummaryConfiguration(userId: string): Promise<SummaryConfiguration> {
    try {
      // Check cache first
      const cacheKey = `summary_config:${userId}`;
      const cachedConfig = await this.cacheService.get(cacheKey);
      
      if (cachedConfig) {
        return cachedConfig;
      }

      // Get from database
      const config = await this.databaseService.getSummaryConfiguration(userId);
      
      if (!config) {
        // Return default configuration
        const defaultConfig: SummaryConfiguration = {
          userId,
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
            platforms: ['whatsapp'], // Default platform
            timezone: 'UTC',
            enabled: true
          },
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Save default configuration
        await this.configureSummarySettings(defaultConfig);
        return defaultConfig;
      }

      // Cache configuration
      await this.cacheService.set(cacheKey, config, 3600);
      return config;

    } catch (error) {
      console.error('Failed to get summary configuration', {
        userId,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.DATABASE_ERROR,
        message: 'Failed to get summary configuration',
        context: { userId, error: error.message }
      });
    }
  }

  /**
   * Validate summary configuration
   */
  private validateSummaryConfiguration(config: SummaryConfiguration): void {
    if (!config.userId) {
      throw new Error('User ID is required');
    }

    if (!['time_based', 'milestone_based', 'hybrid'].includes(config.summaryType)) {
      throw new Error('Invalid summary type');
    }

    if (config.summaryType === 'time_based' || config.summaryType === 'hybrid') {
      if (!config.timeInterval) {
        throw new Error('Time interval is required for time-based summaries');
      }

      if (config.timeInterval.value <= 0) {
        throw new Error('Time interval value must be positive');
      }
    }

    if (config.summaryType === 'milestone_based' || config.summaryType === 'hybrid') {
      if (!config.milestoneSettings) {
        throw new Error('Milestone settings are required for milestone-based summaries');
      }
    }

    if (!config.contentPreferences) {
      throw new Error('Content preferences are required');
    }

    if (!config.deliverySettings) {
      throw new Error('Delivery settings are required');
    }

    if (!config.deliverySettings.platforms || config.deliverySettings.platforms.length === 0) {
      throw new Error('At least one delivery platform is required');
    }
  }

  /**
   * Calculate next summary date based on configuration
   */
  private calculateNextSummaryDate(config: SummaryConfiguration): Date {
    const now = new Date();
    const nextDate = new Date(now);

    if (!config.timeInterval) {
      return nextDate;
    }

    switch (config.timeInterval.type) {
      case 'days':
        nextDate.setDate(now.getDate() + config.timeInterval.value);
        break;
      case 'weeks':
        nextDate.setDate(now.getDate() + (config.timeInterval.value * 7));
        break;
      case 'months':
        nextDate.setMonth(now.getMonth() + config.timeInterval.value);
        break;
      case 'custom':
        if (config.timeInterval.customUnit === 'hours') {
          nextDate.setHours(now.getHours() + config.timeInterval.value);
        } else if (config.timeInterval.customUnit === 'days') {
          nextDate.setDate(now.getDate() + config.timeInterval.value);
        } else if (config.timeInterval.customUnit === 'weeks') {
          nextDate.setDate(now.getDate() + (config.timeInterval.value * 7));
        } else if (config.timeInterval.customUnit === 'months') {
          nextDate.setMonth(now.getMonth() + config.timeInterval.value);
        }
        break;
    }

    // Set preferred time if specified
    if (config.deliverySettings.preferredTime) {
      const [hours, minutes] = config.deliverySettings.preferredTime.split(':').map(Number);
      nextDate.setHours(hours, minutes, 0, 0);
    }

    return nextDate;
  }

  /**
   * Determine summary period based on configuration and trigger
   */
  private async determineSummaryPeriod(
    config: SummaryConfiguration,
    triggerType: string,
    triggerDetails?: any
  ): Promise<{ startDate: Date; endDate: Date; description: string }> {
    const endDate = new Date();
    let startDate = new Date();
    let description = '';

    if (triggerType === 'milestone') {
      // For milestone triggers, use period since last summary or significant event
      const lastSummary = config.lastSummaryGenerated;
      if (lastSummary) {
        startDate = new Date(lastSummary);
        description = `Since your last summary (${this.formatDateRange(startDate, endDate)})`;
      } else {
        // First summary - use last 30 days
        startDate.setDate(endDate.getDate() - 30);
        description = `Your first summary (last 30 days)`;
      }
    } else {
      // For scheduled or manual triggers, use configured interval
      if (config.timeInterval) {
        switch (config.timeInterval.type) {
          case 'days':
            startDate.setDate(endDate.getDate() - config.timeInterval.value);
            description = `Last ${config.timeInterval.value} day${config.timeInterval.value > 1 ? 's' : ''}`;
            break;
          case 'weeks':
            startDate.setDate(endDate.getDate() - (config.timeInterval.value * 7));
            description = `Last ${config.timeInterval.value} week${config.timeInterval.value > 1 ? 's' : ''}`;
            break;
          case 'months':
            startDate.setMonth(endDate.getMonth() - config.timeInterval.value);
            description = `Last ${config.timeInterval.value} month${config.timeInterval.value > 1 ? 's' : ''}`;
            break;
          case 'custom':
            if (config.timeInterval.customUnit === 'hours') {
              startDate.setHours(endDate.getHours() - config.timeInterval.value);
              description = `Last ${config.timeInterval.value} hour${config.timeInterval.value > 1 ? 's' : ''}`;
            } else if (config.timeInterval.customUnit === 'days') {
              startDate.setDate(endDate.getDate() - config.timeInterval.value);
              description = `Last ${config.timeInterval.value} day${config.timeInterval.value > 1 ? 's' : ''}`;
            } else if (config.timeInterval.customUnit === 'weeks') {
              startDate.setDate(endDate.getDate() - (config.timeInterval.value * 7));
              description = `Last ${config.timeInterval.value} week${config.timeInterval.value > 1 ? 's' : ''}`;
            } else if (config.timeInterval.customUnit === 'months') {
              startDate.setMonth(endDate.getMonth() - config.timeInterval.value);
              description = `Last ${config.timeInterval.value} month${config.timeInterval.value > 1 ? 's' : ''}`;
            }
            break;
        }
      } else {
        // Default to last week
        startDate.setDate(endDate.getDate() - 7);
        description = 'Last week';
      }
    }

    return { startDate, endDate, description };
  }

  /**
   * Collect and analyze user data for summary period
   */
  private async collectSummaryData(
    userId: string,
    period: { startDate: Date; endDate: Date; description: string },
    config: SummaryConfiguration
  ): Promise<SummaryData> {
    try {
      console.log('Collecting summary data', {
        userId,
        period: period.description,
        startDate: period.startDate,
        endDate: period.endDate
      });

      // Collect interactions data
      const interactions = await this.databaseService.getUserInteractions(
        userId,
        period.startDate,
        period.endDate
      );

      // Collect goals data
      const goals = await this.databaseService.getUserGoals(
        userId,
        period.startDate,
        period.endDate
      );

      // Collect achievements data
      const achievements = await this.databaseService.getUserAchievements(
        userId,
        period.startDate,
        period.endDate
      );

      // Collect reflections data
      const reflections = await this.databaseService.getUserReflections(
        userId,
        period.startDate,
        period.endDate
      );

      // Collect challenges data
      const challenges = await this.databaseService.getUserChallenges(
        userId,
        period.startDate,
        period.endDate
      );

      // Calculate growth metrics
      const growthMetrics = await this.calculateGrowthMetrics(
        userId,
        period,
        interactions,
        goals,
        achievements
      );

      // Generate personalized insights
      const personalizedInsights = await this.generatePersonalizedInsights(
        userId,
        interactions,
        goals,
        achievements,
        reflections,
        challenges,
        growthMetrics
      );

      const summaryData: SummaryData = {
        userId,
        period,
        interactions: {
          totalCount: interactions.length,
          platforms: this.groupInteractionsByPlatform(interactions),
          averageResponseTime: this.calculateAverageResponseTime(interactions),
          engagementScore: this.calculateEngagementScore(interactions)
        },
        goals: {
          completed: goals.filter(g => g.status === 'completed'),
          inProgress: goals.filter(g => g.status === 'in_progress'),
          newGoals: goals.filter(g => new Date(g.createdAt) >= period.startDate),
          completionRate: this.calculateGoalCompletionRate(goals)
        },
        achievements,
        reflections: {
          keyInsights: reflections.map(r => r.insight),
          emotionalTrends: this.analyzeEmotionalTrends(reflections),
          learningMoments: reflections.filter(r => r.type === 'learning')
        },
        challenges: {
          identified: challenges.filter(c => c.status === 'identified'),
          overcome: challenges.filter(c => c.status === 'resolved'),
          ongoing: challenges.filter(c => c.status === 'ongoing')
        },
        growthMetrics,
        personalizedInsights
      };

      console.log('Summary data collected successfully', {
        userId,
        interactionCount: summaryData.interactions.totalCount,
        goalsCompleted: summaryData.goals.completed.length,
        achievementsCount: summaryData.achievements.milestones?.length || 0
      });

      return summaryData;

    } catch (error) {
      console.error('Failed to collect summary data', {
        userId,
        period: period.description,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.DATABASE_ERROR,
        message: 'Failed to collect summary data',
        context: { userId, period: period.description, error: error.message }
      });
    }
  }

  /**
   * Generate AI-powered summary content
   */
  private async generateSummaryContent(
    data: SummaryData,
    config: SummaryConfiguration
  ): Promise<any> {
    try {
      console.log('Generating AI-powered summary content', {
        userId: data.userId,
        tone: config.contentPreferences.tone,
        length: config.contentPreferences.length
      });

      // Prepare context for AI generation
      const context = this.prepareSummaryContext(data, config);

      // Generate content using AI
      const aiResponse = await this.aiService.generateResponse({
        prompt: this.buildSummaryPrompt(context, config),
        context: {
          userId: data.userId,
          summaryType: 'personalized_summary',
          preferences: config.contentPreferences
        }
      });

      // Parse and structure the AI response
      const summaryContent = this.parseSummaryContent(aiResponse.response, data, config);

      console.log('Summary content generated successfully', {
        userId: data.userId,
        sectionsCount: summaryContent.sections.length,
        highlightsCount: summaryContent.keyHighlights.length
      });

      return summaryContent;

    } catch (error) {
      console.error('Failed to generate summary content', {
        userId: data.userId,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.AI_SERVICE_ERROR,
        message: 'Failed to generate summary content',
        context: { userId: data.userId, error: error.message }
      });
    }
  }

  /**
   * Check milestone-based triggers
   */
  private async checkMilestoneTriggers(
    userId: string,
    config: SummaryConfiguration
  ): Promise<{ triggered: boolean; reason?: string; details?: any }> {
    try {
      if (!config.milestoneSettings) {
        return { triggered: false };
      }

      const lastSummary = config.lastSummaryGenerated || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Check goal completions
      if (config.milestoneSettings.goalCompletions > 0) {
        const recentGoalCompletions = await this.databaseService.getGoalCompletionsSince(userId, lastSummary);
        if (recentGoalCompletions >= config.milestoneSettings.goalCompletions) {
          return {
            triggered: true,
            reason: `Completed ${recentGoalCompletions} goals`,
            details: { goalCompletions: recentGoalCompletions }
          };
        }
      }

      // Check interaction threshold
      if (config.milestoneSettings.interactionThreshold > 0) {
        const recentInteractions = await this.databaseService.getInteractionCountSince(userId, lastSummary);
        if (recentInteractions >= config.milestoneSettings.interactionThreshold) {
          return {
            triggered: true,
            reason: `Reached ${recentInteractions} interactions`,
            details: { interactionCount: recentInteractions }
          };
        }
      }

      // Check significant events
      if (config.milestoneSettings.significantEvents) {
        const significantEvents = await this.databaseService.getSignificantEventsSince(userId, lastSummary);
        if (significantEvents.length > 0) {
          return {
            triggered: true,
            reason: 'Significant events detected',
            details: { events: significantEvents }
          };
        }
      }

      // Check achievement milestones
      if (config.milestoneSettings.achievementMilestones) {
        const recentAchievements = await this.databaseService.getAchievementsSince(userId, lastSummary);
        if (recentAchievements.length > 0) {
          return {
            triggered: true,
            reason: 'New achievements unlocked',
            details: { achievements: recentAchievements }
          };
        }
      }

      return { triggered: false };

    } catch (error) {
      console.error('Failed to check milestone triggers', {
        userId,
        error: error.message
      });

      return { triggered: false };
    }
  }

  /**
   * Helper methods for data processing
   */
  private groupInteractionsByPlatform(interactions: any[]): Record<string, number> {
    return interactions.reduce((acc, interaction) => {
      acc[interaction.platform] = (acc[interaction.platform] || 0) + 1;
      return acc;
    }, {});
  }

  private calculateAverageResponseTime(interactions: any[]): number {
    if (interactions.length === 0) return 0;
    const totalTime = interactions.reduce((sum, i) => sum + (i.responseTime || 0), 0);
    return totalTime / interactions.length;
  }

  private calculateEngagementScore(interactions: any[]): number {
    // Calculate engagement score based on interaction frequency, response quality, etc.
    if (interactions.length === 0) return 0;
    
    const factors = {
      frequency: Math.min(interactions.length / 10, 1), // Max score at 10+ interactions
      responsiveness: interactions.filter(i => i.userResponded).length / interactions.length,
      depth: interactions.filter(i => i.messageLength > 50).length / interactions.length
    };

    return Math.round((factors.frequency + factors.responsiveness + factors.depth) / 3 * 100);
  }

  private calculateGoalCompletionRate(goals: any[]): number {
    if (goals.length === 0) return 0;
    const completed = goals.filter(g => g.status === 'completed').length;
    return Math.round((completed / goals.length) * 100);
  }

  private analyzeEmotionalTrends(reflections: any[]): any[] {
    // Analyze emotional patterns in reflections
    return reflections
      .filter(r => r.emotion)
      .map(r => ({
        date: r.createdAt,
        emotion: r.emotion,
        intensity: r.emotionIntensity || 5
      }));
  }

  private async calculateGrowthMetrics(
    userId: string,
    period: any,
    interactions: any[],
    goals: any[],
    achievements: any[]
  ): Promise<any> {
    // Calculate various growth and progress metrics
    const consistencyScore = this.calculateConsistencyScore(interactions, period);
    const progressScore = this.calculateProgressScore(goals, achievements);
    const engagementTrend = this.calculateEngagementTrend(userId, period);

    return {
      consistencyScore,
      progressScore,
      engagementTrend: await engagementTrend,
      areasOfImprovement: this.identifyImprovementAreas(interactions, goals)
    };
  }

  private calculateConsistencyScore(interactions: any[], period: any): number {
    // Calculate how consistently the user has been engaging
    const daysDiff = Math.ceil((period.endDate.getTime() - period.startDate.getTime()) / (1000 * 60 * 60 * 24));
    const activeDays = new Set(interactions.map(i => new Date(i.timestamp).toDateString())).size;
    return Math.round((activeDays / daysDiff) * 100);
  }

  private calculateProgressScore(goals: any[], achievements: any[]): number {
    // Calculate overall progress score based on goals and achievements
    const goalScore = goals.length > 0 ? (goals.filter(g => g.status === 'completed').length / goals.length) * 50 : 0;
    const achievementScore = Math.min(achievements.length * 10, 50);
    return Math.round(goalScore + achievementScore);
  }

  private async calculateEngagementTrend(userId: string, period: any): Promise<string> {
    // Compare current period engagement with previous period
    try {
      const previousPeriod = {
        startDate: new Date(period.startDate.getTime() - (period.endDate.getTime() - period.startDate.getTime())),
        endDate: period.startDate
      };

      const currentInteractions = await this.databaseService.getUserInteractions(
        userId,
        period.startDate,
        period.endDate
      );

      const previousInteractions = await this.databaseService.getUserInteractions(
        userId,
        previousPeriod.startDate,
        previousPeriod.endDate
      );

      if (currentInteractions.length > previousInteractions.length * 1.1) {
        return 'increasing';
      } else if (currentInteractions.length < previousInteractions.length * 0.9) {
        return 'decreasing';
      } else {
        return 'stable';
      }
    } catch (error) {
      return 'stable';
    }
  }

  private identifyImprovementAreas(interactions: any[], goals: any[]): string[] {
    const areas: string[] = [];

    if (interactions.length < 5) {
      areas.push('Increase engagement frequency');
    }

    if (goals.filter(g => g.status === 'completed').length === 0) {
      areas.push('Focus on goal completion');
    }

    if (interactions.filter(i => i.messageLength > 50).length / interactions.length < 0.3) {
      areas.push('Provide more detailed responses');
    }

    return areas;
  }

  private async generatePersonalizedInsights(
    userId: string,
    interactions: any[],
    goals: any[],
    achievements: any[],
    reflections: any[],
    challenges: any[],
    growthMetrics: any
  ): Promise<any> {
    // Generate personalized insights based on user data
    const strengths = [];
    const opportunities = [];
    const recommendations = [];

    // Analyze strengths
    if (growthMetrics.consistencyScore > 70) {
      strengths.push('Excellent consistency in engagement');
    }
    if (goals.filter(g => g.status === 'completed').length > 0) {
      strengths.push('Strong goal achievement');
    }
    if (achievements.length > 0) {
      strengths.push('Milestone achievements unlocked');
    }

    // Identify opportunities
    if (growthMetrics.consistencyScore < 50) {
      opportunities.push('Improve engagement consistency');
    }
    if (reflections.length < 3) {
      opportunities.push('Increase self-reflection practice');
    }
    if (challenges.filter(c => c.status === 'ongoing').length > 3) {
      opportunities.push('Focus on resolving ongoing challenges');
    }

    // Generate recommendations
    if (interactions.length > 10) {
      recommendations.push('Consider setting more ambitious goals');
    }
    if (reflections.length > 5) {
      recommendations.push('Your reflection practice is excellent - keep it up!');
    }

    const motivationalMessage = this.generateMotivationalMessage(strengths, opportunities, growthMetrics);

    return {
      strengths,
      opportunities,
      recommendations,
      motivationalMessage
    };
  }

  private generateMotivationalMessage(strengths: string[], opportunities: string[], growthMetrics: any): string {
    if (growthMetrics.progressScore > 70) {
      return "You're making fantastic progress! Your dedication and consistency are truly paying off. Keep up the excellent work!";
    } else if (growthMetrics.progressScore > 40) {
      return "You're on a great path! There's always room for growth, and you're showing real commitment to your journey.";
    } else {
      return "Every journey starts with a single step, and you're already moving forward. Focus on small, consistent actions and you'll see amazing progress!";
    }
  }

  private prepareSummaryContext(data: SummaryData, config: SummaryConfiguration): any {
    return {
      period: data.period.description,
      interactions: data.interactions,
      goals: data.goals,
      achievements: data.achievements,
      reflections: data.reflections,
      challenges: data.challenges,
      growthMetrics: data.growthMetrics,
      insights: data.personalizedInsights,
      preferences: config.contentPreferences
    };
  }

  private buildSummaryPrompt(context: any, config: SummaryConfiguration): string {
    const tone = config.contentPreferences.tone;
    const length = config.contentPreferences.length;

    return `Generate a personalized ${length} summary with a ${tone} tone for a user based on their ${context.period} activity. 

Include the following sections based on preferences:
${config.contentPreferences.includeGoals ? '- Goals and achievements' : ''}
${config.contentPreferences.includeReflections ? '- Key insights and reflections' : ''}
${config.contentPreferences.includeAchievements ? '- Milestones and accomplishments' : ''}
${config.contentPreferences.includeChallenges ? '- Challenges and growth areas' : ''}
${config.contentPreferences.includeGrowthInsights ? '- Growth metrics and trends' : ''}
${config.contentPreferences.includeMotivationalContent ? '- Motivational message and encouragement' : ''}

User data:
- Interactions: ${context.interactions.totalCount} total, engagement score: ${context.interactions.engagementScore}
- Goals: ${context.goals.completed.length} completed, ${context.goals.inProgress.length} in progress
- Achievements: ${context.achievements.milestones?.length || 0} milestones
- Growth score: ${context.growthMetrics.progressScore}
- Consistency: ${context.growthMetrics.consistencyScore}%

Create a meaningful, personalized summary that celebrates progress, acknowledges challenges, and provides encouragement for continued growth.`;
  }

  private parseSummaryContent(aiResponse: string, data: SummaryData, config: SummaryConfiguration): any {
    // Parse AI response into structured summary content
    // This is a simplified version - in practice, you'd have more sophisticated parsing
    
    const sections = [
      {
        name: 'Overview',
        content: `During ${data.period.description}, you had ${data.interactions.totalCount} interactions with an engagement score of ${data.interactions.engagementScore}.`,
        insights: [`Your consistency score was ${data.growthMetrics.consistencyScore}%`]
      }
    ];

    if (config.contentPreferences.includeGoals) {
      sections.push({
        name: 'Goals & Progress',
        content: `You completed ${data.goals.completed.length} goals and have ${data.goals.inProgress.length} goals in progress.`,
        insights: [`Goal completion rate: ${data.goals.completionRate}%`]
      });
    }

    if (config.contentPreferences.includeAchievements && data.achievements.milestones?.length > 0) {
      sections.push({
        name: 'Achievements',
        content: `You unlocked ${data.achievements.milestones.length} new milestones!`,
        insights: data.achievements.milestones.map(m => m.name)
      });
    }

    const keyHighlights = [
      `${data.interactions.totalCount} meaningful interactions`,
      `${data.goals.completed.length} goals completed`,
      `${data.growthMetrics.consistencyScore}% consistency score`
    ];

    const actionItems = data.personalizedInsights.recommendations;

    return {
      title: `Your ${data.period.description} Summary`,
      sections,
      keyHighlights,
      actionItems,
      motivationalClosing: data.personalizedInsights.motivationalMessage
    };
  }

  private formatDateRange(startDate: Date, endDate: Date): string {
    const start = startDate.toLocaleDateString();
    const end = endDate.toLocaleDateString();
    return `${start} - ${end}`;
  }

  private async updateLastSummaryDate(userId: string, date: Date): Promise<void> {
    await this.databaseService.updateSummaryConfiguration(userId, {
      lastSummaryGenerated: date,
      updatedAt: new Date()
    });

    // Update cache
    const cacheKey = `summary_config:${userId}`;
    await this.cacheService.delete(cacheKey);
  }

  private async updateNextSummaryDate(userId: string, date: Date): Promise<void> {
    await this.databaseService.updateSummaryConfiguration(userId, {
      nextScheduledSummary: date,
      updatedAt: new Date()
    });

    // Update cache
    const cacheKey = `summary_config:${userId}`;
    await this.cacheService.delete(cacheKey);
  }
}

