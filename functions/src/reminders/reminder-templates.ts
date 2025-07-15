/**
 * Reminder Templates and Smart Suggestions for Fylgja
 * Provides pre-built templates and AI-powered suggestions for common reminders
 */

import { ReminderTemplate, SmartSuggestion, Reminder, RecurrencePattern } from './reminder-system';
import { EnhancedDatabaseService } from '../services/enhanced-database-service';
import { GoogleAIService } from '../services/google-ai-service';
import { FylgjaError, ErrorType } from '../utils/error-handler';

export interface TemplateCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  templates: ReminderTemplate[];
  popularity: number;
}

export interface PersonalizedTemplate {
  template: ReminderTemplate;
  personalizationScore: number;
  customizations: {
    suggestedTitle?: string;
    suggestedDescription?: string;
    suggestedTime?: Date;
    suggestedRecurrence?: RecurrencePattern;
    reasoning: string;
  };
}

export class ReminderTemplateManager {
  private static instance: ReminderTemplateManager;
  private databaseService: EnhancedDatabaseService;
  private aiService: GoogleAIService;

  private constructor() {
    this.databaseService = EnhancedDatabaseService.getInstance();
    this.aiService = GoogleAIService.getInstance();
  }

  public static getInstance(): ReminderTemplateManager {
    if (!ReminderTemplateManager.instance) {
      ReminderTemplateManager.instance = new ReminderTemplateManager();
    }
    return ReminderTemplateManager.instance;
  }

  /**
   * Get all template categories with templates
   */
  public async getTemplateCategories(): Promise<TemplateCategory[]> {
    try {
      console.log('Getting template categories');

      // Get system templates
      const systemTemplates = await this.getSystemTemplates();

      // Get user-created templates
      const userTemplates = await this.databaseService.getUserTemplates();

      // Organize into categories
      const categories = this.organizeTemplatesIntoCategories([...systemTemplates, ...userTemplates]);

      console.log('Retrieved template categories', { count: categories.length });

      return categories;

    } catch (error) {
      console.error('Failed to get template categories', { error: error.message });

      throw new FylgjaError({
        type: ErrorType.DATABASE_ERROR,
        message: 'Failed to get template categories',
        context: { error: error.message }
      });
    }
  }

  /**
   * Get personalized template suggestions for a user
   */
  public async getPersonalizedTemplates(userId: string): Promise<PersonalizedTemplate[]> {
    try {
      console.log('Getting personalized templates', { userId });

      // Get user's reminder patterns and preferences
      const userPatterns = await this.databaseService.getUserReminderPatterns(userId);
      const userProfile = await this.databaseService.getUserProfile(userId);

      // Get all available templates
      const allTemplates = await this.getAllTemplates();

      // Score and personalize templates
      const personalizedTemplates: PersonalizedTemplate[] = [];

      for (const template of allTemplates) {
        const personalizationScore = this.calculatePersonalizationScore(template, userPatterns, userProfile);
        
        if (personalizationScore > 0.3) { // Only include relevant templates
          const customizations = await this.generateTemplateCustomizations(template, userPatterns, userProfile);
          
          personalizedTemplates.push({
            template,
            personalizationScore,
            customizations
          });
        }
      }

      // Sort by personalization score
      personalizedTemplates.sort((a, b) => b.personalizationScore - a.personalizationScore);

      console.log('Generated personalized templates', {
        userId,
        count: personalizedTemplates.length
      });

      return personalizedTemplates.slice(0, 10); // Return top 10

    } catch (error) {
      console.error('Failed to get personalized templates', {
        userId,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to get personalized templates',
        context: { userId, error: error.message }
      });
    }
  }

  /**
   * Create a custom template from user's reminder
   */
  public async createTemplateFromReminder(
    userId: string,
    reminder: Reminder,
    templateName: string,
    templateDescription: string,
    makePublic: boolean = false
  ): Promise<ReminderTemplate> {
    try {
      console.log('Creating template from reminder', {
        userId,
        reminderId: reminder.id,
        templateName
      });

      const template: ReminderTemplate = {
        id: `template-${userId}-${Date.now()}`,
        name: templateName,
        description: templateDescription,
        category: reminder.category,
        defaultTitle: reminder.title,
        defaultDescription: reminder.description || '',
        defaultPriority: reminder.priority,
        suggestedRecurrence: reminder.recurrence,
        suggestedAdvanceNotifications: reminder.delivery.advanceNotifications,
        customFields: {
          originalReminderId: reminder.id,
          tags: reminder.tags,
          tone: reminder.delivery.tone
        },
        isSystemTemplate: false,
        createdBy: userId,
        usageCount: 0,
        rating: 0
      };

      // Store template
      await this.databaseService.storeReminderTemplate(template, makePublic);

      console.log('Template created successfully', {
        templateId: template.id,
        templateName
      });

      return template;

    } catch (error) {
      console.error('Failed to create template from reminder', {
        userId,
        reminderId: reminder.id,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to create template from reminder',
        context: { userId, reminderId: reminder.id, error: error.message }
      });
    }
  }

  /**
   * Generate smart reminder suggestions based on user behavior
   */
  public async generateSmartSuggestions(userId: string): Promise<SmartSuggestion[]> {
    try {
      console.log('Generating smart suggestions', { userId });

      // Analyze user patterns
      const patterns = await this.analyzeUserPatterns(userId);

      // Generate different types of suggestions
      const suggestions: SmartSuggestion[] = [];

      // Pattern-based suggestions
      suggestions.push(...await this.generatePatternBasedSuggestions(userId, patterns));

      // Goal-based suggestions
      suggestions.push(...await this.generateGoalBasedSuggestions(userId));

      // Time-based suggestions
      suggestions.push(...await this.generateTimeBasedSuggestions(userId, patterns));

      // AI-powered suggestions
      suggestions.push(...await this.generateAIPoweredSuggestions(userId, patterns));

      // Filter and rank suggestions
      const rankedSuggestions = this.rankSuggestions(suggestions, patterns);

      console.log('Generated smart suggestions', {
        userId,
        count: rankedSuggestions.length
      });

      return rankedSuggestions.slice(0, 5); // Return top 5

    } catch (error) {
      console.error('Failed to generate smart suggestions', {
        userId,
        error: error.message
      });

      throw new FylgjaError({
        type: ErrorType.PROCESSING_ERROR,
        message: 'Failed to generate smart suggestions',
        context: { userId, error: error.message }
      });
    }
  }

  /**
   * Get system-provided templates
   */
  private async getSystemTemplates(): Promise<ReminderTemplate[]> {
    return [
      // Health & Wellness Templates
      {
        id: 'health-medication',
        name: 'Medication Reminder',
        description: 'Never miss your medication with timely reminders',
        category: 'health',
        defaultTitle: 'Take your medication',
        defaultDescription: 'Time to take your prescribed medication. Remember to take it with food if required.',
        defaultPriority: 'high',
        suggestedRecurrence: { type: 'daily', interval: 1 },
        suggestedAdvanceNotifications: [
          { timeBeforeReminder: 5, message: 'Medication reminder in 5 minutes' }
        ],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.8
      },
      {
        id: 'health-water',
        name: 'Hydration Reminder',
        description: 'Stay hydrated throughout the day',
        category: 'health',
        defaultTitle: 'Drink water',
        defaultDescription: 'Time to hydrate! Aim for 8 glasses of water per day.',
        defaultPriority: 'medium',
        suggestedRecurrence: { type: 'daily', interval: 1 },
        suggestedAdvanceNotifications: [],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.5
      },
      {
        id: 'health-exercise',
        name: 'Exercise Reminder',
        description: 'Stay active with regular exercise reminders',
        category: 'health',
        defaultTitle: 'Time to exercise',
        defaultDescription: 'Get moving! Even 15 minutes of activity can make a difference.',
        defaultPriority: 'medium',
        suggestedRecurrence: { type: 'daily', interval: 1 },
        suggestedAdvanceNotifications: [
          { timeBeforeReminder: 15, message: 'Exercise time in 15 minutes - get ready!' }
        ],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.6
      },

      // Work & Productivity Templates
      {
        id: 'work-meeting',
        name: 'Meeting Reminder',
        description: 'Never miss important meetings',
        category: 'work',
        defaultTitle: 'Upcoming meeting',
        defaultDescription: 'You have a meeting coming up. Check your calendar for details.',
        defaultPriority: 'high',
        suggestedRecurrence: undefined,
        suggestedAdvanceNotifications: [
          { timeBeforeReminder: 15, message: 'Meeting in 15 minutes' },
          { timeBeforeReminder: 5, message: 'Meeting starting in 5 minutes' }
        ],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.9
      },
      {
        id: 'work-break',
        name: 'Break Reminder',
        description: 'Take regular breaks to stay productive',
        category: 'work',
        defaultTitle: 'Take a break',
        defaultDescription: 'Time for a break! Step away from your screen and stretch.',
        defaultPriority: 'medium',
        suggestedRecurrence: { type: 'daily', interval: 1 },
        suggestedAdvanceNotifications: [],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.3
      },
      {
        id: 'work-deadline',
        name: 'Project Deadline',
        description: 'Stay on top of important deadlines',
        category: 'work',
        defaultTitle: 'Project deadline approaching',
        defaultDescription: 'Your project deadline is coming up. Review your progress and plan accordingly.',
        defaultPriority: 'urgent',
        suggestedRecurrence: undefined,
        suggestedAdvanceNotifications: [
          { timeBeforeReminder: 1440, message: 'Deadline tomorrow!' }, // 24 hours
          { timeBeforeReminder: 240, message: 'Deadline in 4 hours' } // 4 hours
        ],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.7
      },

      // Personal & Lifestyle Templates
      {
        id: 'personal-call',
        name: 'Call Family/Friends',
        description: 'Stay connected with loved ones',
        category: 'social',
        defaultTitle: 'Call family/friends',
        defaultDescription: 'Reach out to someone you care about. A quick call can brighten their day!',
        defaultPriority: 'medium',
        suggestedRecurrence: { type: 'weekly', interval: 1 },
        suggestedAdvanceNotifications: [],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.4
      },
      {
        id: 'personal-gratitude',
        name: 'Gratitude Practice',
        description: 'Daily gratitude reflection',
        category: 'personal',
        defaultTitle: 'Gratitude moment',
        defaultDescription: 'Take a moment to reflect on three things you\'re grateful for today.',
        defaultPriority: 'low',
        suggestedRecurrence: { type: 'daily', interval: 1 },
        suggestedAdvanceNotifications: [],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.6
      },
      {
        id: 'personal-journal',
        name: 'Journal Writing',
        description: 'Daily journaling for self-reflection',
        category: 'personal',
        defaultTitle: 'Journal time',
        defaultDescription: 'Spend 10 minutes writing about your day, thoughts, and feelings.',
        defaultPriority: 'medium',
        suggestedRecurrence: { type: 'daily', interval: 1 },
        suggestedAdvanceNotifications: [],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.5
      },

      // Learning & Development Templates
      {
        id: 'learning-study',
        name: 'Study Session',
        description: 'Dedicated time for learning',
        category: 'learning',
        defaultTitle: 'Study time',
        defaultDescription: 'Time for focused learning. Review your materials and practice what you\'ve learned.',
        defaultPriority: 'medium',
        suggestedRecurrence: { type: 'daily', interval: 1 },
        suggestedAdvanceNotifications: [
          { timeBeforeReminder: 10, message: 'Study session starting in 10 minutes' }
        ],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.4
      },
      {
        id: 'learning-reading',
        name: 'Reading Time',
        description: 'Daily reading habit',
        category: 'learning',
        defaultTitle: 'Reading time',
        defaultDescription: 'Spend some time reading. Even 15 minutes a day can make a big difference!',
        defaultPriority: 'medium',
        suggestedRecurrence: { type: 'daily', interval: 1 },
        suggestedAdvanceNotifications: [],
        isSystemTemplate: true,
        createdBy: 'system',
        usageCount: 0,
        rating: 4.3
      }
    ];
  }

  private async getAllTemplates(): Promise<ReminderTemplate[]> {
    const systemTemplates = await this.getSystemTemplates();
    const userTemplates = await this.databaseService.getUserTemplates();
    return [...systemTemplates, ...userTemplates];
  }

  private organizeTemplatesIntoCategories(templates: ReminderTemplate[]): TemplateCategory[] {
    const categoryMap = new Map<string, TemplateCategory>();

    // Define category metadata
    const categoryInfo = {
      health: { name: 'Health & Wellness', description: 'Take care of your physical and mental health', icon: '🏥' },
      work: { name: 'Work & Productivity', description: 'Stay productive and manage work tasks', icon: '💼' },
      personal: { name: 'Personal Development', description: 'Focus on personal growth and habits', icon: '👤' },
      social: { name: 'Social & Relationships', description: 'Maintain connections with others', icon: '👥' },
      learning: { name: 'Learning & Education', description: 'Continuous learning and skill development', icon: '📚' },
      custom: { name: 'Custom', description: 'Your personalized reminder templates', icon: '📌' }
    };

    // Group templates by category
    for (const template of templates) {
      const categoryId = template.category;
      
      if (!categoryMap.has(categoryId)) {
        const info = categoryInfo[categoryId] || categoryInfo.custom;
        categoryMap.set(categoryId, {
          id: categoryId,
          name: info.name,
          description: info.description,
          icon: info.icon,
          templates: [],
          popularity: 0
        });
      }

      const category = categoryMap.get(categoryId)!;
      category.templates.push(template);
      category.popularity += template.usageCount;
    }

    // Convert to array and sort by popularity
    const categories = Array.from(categoryMap.values());
    categories.sort((a, b) => b.popularity - a.popularity);

    return categories;
  }

  private calculatePersonalizationScore(
    template: ReminderTemplate,
    userPatterns: any,
    userProfile: any
  ): number {
    let score = 0;

    // Category preference
    if (userPatterns.preferredCategories?.[template.category]) {
      score += 0.3;
    }

    // Priority preference
    if (userPatterns.preferredPriorities?.[template.defaultPriority]) {
      score += 0.2;
    }

    // Usage popularity
    if (template.usageCount > 100) {
      score += 0.2;
    } else if (template.usageCount > 10) {
      score += 0.1;
    }

    // Rating
    if (template.rating > 4.5) {
      score += 0.2;
    } else if (template.rating > 4.0) {
      score += 0.1;
    }

    // Recurrence preference
    if (template.suggestedRecurrence && userPatterns.preferredRecurrence?.[template.suggestedRecurrence.type]) {
      score += 0.1;
    }

    return Math.min(score, 1.0);
  }

  private async generateTemplateCustomizations(
    template: ReminderTemplate,
    userPatterns: any,
    userProfile: any
  ): Promise<any> {
    try {
      // Generate AI-powered customizations
      const customizationPrompt = `Personalize this reminder template for the user:
      Template: ${template.name} - ${template.defaultTitle}
      User patterns: ${JSON.stringify(userPatterns)}
      
      Suggest:
      1. Personalized title
      2. Personalized description
      3. Optimal timing based on patterns
      4. Reasoning for suggestions`;

      const aiResponse = await this.aiService.generateResponse({
        prompt: customizationPrompt,
        context: {
          type: 'template_personalization',
          templateId: template.id
        }
      });

      // Parse AI suggestions (simplified)
      return {
        suggestedTitle: template.defaultTitle, // Would be enhanced by AI
        suggestedDescription: template.defaultDescription,
        suggestedTime: this.suggestOptimalTime(userPatterns),
        suggestedRecurrence: template.suggestedRecurrence,
        reasoning: aiResponse.response
      };

    } catch (error) {
      // Fallback to pattern-based customizations
      return {
        suggestedTitle: template.defaultTitle,
        suggestedDescription: template.defaultDescription,
        suggestedTime: this.suggestOptimalTime(userPatterns),
        suggestedRecurrence: template.suggestedRecurrence,
        reasoning: 'Based on your usage patterns'
      };
    }
  }

  private suggestOptimalTime(userPatterns: any): Date {
    // Find user's most active hour
    const preferredTimes = userPatterns.preferredTimes || {};
    const mostActiveHour = Object.keys(preferredTimes).reduce((a, b) => 
      preferredTimes[a] > preferredTimes[b] ? a : b
    );

    const suggestedTime = new Date();
    suggestedTime.setHours(parseInt(mostActiveHour) || 9, 0, 0, 0);
    
    // If the time has passed today, suggest tomorrow
    if (suggestedTime <= new Date()) {
      suggestedTime.setDate(suggestedTime.getDate() + 1);
    }

    return suggestedTime;
  }

  private async analyzeUserPatterns(userId: string): Promise<any> {
    try {
      const patterns = await this.databaseService.getUserReminderPatterns(userId);
      const recentReminders = await this.databaseService.getRecentReminders(userId, 30);
      const goals = await this.databaseService.getUserGoals(userId);

      return {
        patterns,
        recentReminders,
        goals,
        insights: this.generatePatternInsights(patterns, recentReminders)
      };

    } catch (error) {
      console.warn('Failed to analyze user patterns', { userId, error: error.message });
      return { patterns: {}, recentReminders: [], goals: [], insights: [] };
    }
  }

  private generatePatternInsights(patterns: any, recentReminders: any[]): string[] {
    const insights = [];

    // Analyze completion rates
    const completedCount = recentReminders.filter(r => r.status === 'completed').length;
    const completionRate = recentReminders.length > 0 ? completedCount / recentReminders.length : 0;

    if (completionRate > 0.8) {
      insights.push('High completion rate - consider more challenging reminders');
    } else if (completionRate < 0.5) {
      insights.push('Low completion rate - consider simpler or fewer reminders');
    }

    // Analyze timing patterns
    const hourCounts = recentReminders.reduce((acc, r) => {
      const hour = new Date(r.scheduledTime).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {});

    const bestHour = Object.keys(hourCounts).reduce((a, b) => 
      hourCounts[a] > hourCounts[b] ? a : b
    );

    if (bestHour) {
      insights.push(`Most active around ${bestHour}:00`);
    }

    return insights;
  }

  private async generatePatternBasedSuggestions(userId: string, patterns: any): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Suggest based on successful patterns
    if (patterns.patterns.preferredCategories) {
      const topCategory = Object.keys(patterns.patterns.preferredCategories).reduce((a, b) => 
        patterns.patterns.preferredCategories[a] > patterns.patterns.preferredCategories[b] ? a : b
      );

      suggestions.push({
        id: `pattern-${userId}-${Date.now()}`,
        userId,
        type: 'reminder',
        suggestion: {
          title: `More ${topCategory} reminders`,
          description: `You seem to respond well to ${topCategory} reminders. Consider adding more!`,
          confidence: 0.7,
          reasoning: `Based on your high engagement with ${topCategory} reminders`,
          suggestedReminder: {
            category: topCategory as any,
            priority: 'medium'
          }
        },
        basedOn: {
          patterns: ['category_preference'],
          data: patterns.patterns.preferredCategories,
          timeframe: 'last_30_days'
        },
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
    }

    return suggestions;
  }

  private async generateGoalBasedSuggestions(userId: string): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    try {
      const goals = await this.databaseService.getUserGoals(userId);
      
      for (const goal of goals.slice(0, 3)) { // Top 3 goals
        if (goal.status === 'in_progress') {
          suggestions.push({
            id: `goal-${userId}-${goal.id}`,
            userId,
            type: 'reminder',
            suggestion: {
              title: `Progress check: ${goal.title}`,
              description: `Set a reminder to check your progress on this goal`,
              confidence: 0.8,
              reasoning: `You have an active goal that could benefit from regular check-ins`,
              suggestedReminder: {
                title: `Check progress: ${goal.title}`,
                description: `Review your progress and plan next steps for: ${goal.title}`,
                category: 'personal',
                priority: 'medium',
                recurrence: { type: 'weekly', interval: 1 }
              }
            },
            basedOn: {
              patterns: ['active_goals'],
              data: { goalId: goal.id, goalTitle: goal.title },
              timeframe: 'current'
            },
            status: 'pending',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          });
        }
      }

    } catch (error) {
      console.warn('Failed to generate goal-based suggestions', { userId, error: error.message });
    }

    return suggestions;
  }

  private async generateTimeBasedSuggestions(userId: string, patterns: any): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Suggest optimal timing improvements
    if (patterns.insights.includes('Low completion rate')) {
      suggestions.push({
        id: `timing-${userId}-${Date.now()}`,
        userId,
        type: 'optimization',
        suggestion: {
          title: 'Optimize reminder timing',
          description: 'Your completion rate could improve with better timing',
          confidence: 0.6,
          reasoning: 'Low completion rates often indicate suboptimal timing',
          suggestedChanges: {
            timing: 'Consider scheduling reminders during your most active hours'
          }
        },
        basedOn: {
          patterns: ['completion_rate'],
          data: patterns.patterns,
          timeframe: 'last_30_days'
        },
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
    }

    return suggestions;
  }

  private async generateAIPoweredSuggestions(userId: string, patterns: any): Promise<SmartSuggestion[]> {
    try {
      const suggestionPrompt = `Based on user reminder patterns, suggest helpful new reminders:
      Patterns: ${JSON.stringify(patterns.insights)}
      Recent activity: ${patterns.recentReminders.length} reminders
      Goals: ${patterns.goals.length} active goals
      
      Suggest 2-3 specific, actionable reminders that would be helpful.`;

      const aiResponse = await this.aiService.generateResponse({
        prompt: suggestionPrompt,
        context: {
          userId,
          type: 'ai_reminder_suggestions'
        }
      });

      // Parse AI suggestions (simplified)
      return [{
        id: `ai-${userId}-${Date.now()}`,
        userId,
        type: 'reminder',
        suggestion: {
          title: 'AI-suggested reminder',
          description: 'Based on your patterns, this reminder could be helpful',
          confidence: aiResponse.confidence || 0.7,
          reasoning: aiResponse.response,
          suggestedReminder: {
            title: 'Daily reflection',
            description: 'Take 5 minutes to reflect on your day',
            category: 'personal',
            priority: 'medium'
          }
        },
        basedOn: {
          patterns: ['ai_analysis'],
          data: patterns,
          timeframe: 'comprehensive'
        },
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }];

    } catch (error) {
      console.warn('Failed to generate AI-powered suggestions', { userId, error: error.message });
      return [];
    }
  }

  private rankSuggestions(suggestions: SmartSuggestion[], patterns: any): SmartSuggestion[] {
    return suggestions.sort((a, b) => {
      // Sort by confidence and relevance
      const scoreA = a.suggestion.confidence * (a.type === 'reminder' ? 1.2 : 1.0);
      const scoreB = b.suggestion.confidence * (b.type === 'reminder' ? 1.2 : 1.0);
      return scoreB - scoreA;
    });
  }
}

