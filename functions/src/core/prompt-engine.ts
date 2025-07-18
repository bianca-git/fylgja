/**
 * Prompt Engineering Foundation for Fylgja
 * Dynamic question generation, adaptive learning, and personalized interactions
 */

import { DatabaseService } from '../services/database-service';
import { AIRequest, ConversationMessage, UserAIPreferences } from '../types/ai-types';

export interface QuestionTemplate {
  id: string;
  category: QuestionCategory;
  depth: QuestionDepth;
  baseTemplate: string;
  variations: string[];
  followUpTemplates?: string[];
  contextRequirements?: string[];
  personalityAdaptations: Record<PersonalityType, string>;
  metadata: {
    frequency: 'daily' | 'weekly' | 'occasional' | 'rare';
    timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'any';
    mood?: 'positive' | 'neutral' | 'reflective' | 'any';
    complexity: 'simple' | 'moderate' | 'complex';
  };
}

export type QuestionCategory =
  | 'completion'
  | 'planning'
  | 'reflection'
  | 'learning'
  | 'gratitude'
  | 'challenge'
  | 'goal_setting'
  | 'emotional_check'
  | 'productivity'
  | 'relationship'
  | 'health_wellness'
  | 'creativity'
  | 'growth';

export type QuestionDepth = 'surface' | 'moderate' | 'deep' | 'profound';

export type PersonalityType =
  | 'analytical'
  | 'creative'
  | 'practical'
  | 'empathetic'
  | 'ambitious'
  | 'reflective'
  | 'social'
  | 'independent';

export interface UserPersonalityProfile {
  primaryType: PersonalityType;
  secondaryType?: PersonalityType;
  traits: {
    formality: number; // 0-1 scale
    verbosity: number; // 0-1 scale
    emotionalExpression: number; // 0-1 scale
    directness: number; // 0-1 scale
    curiosity: number; // 0-1 scale
  };
  preferences: {
    questionDepth: QuestionDepth;
    favoriteCategories: QuestionCategory[];
    avoidCategories: QuestionCategory[];
    responseLength: 'short' | 'medium' | 'long';
    includeFollowUps: boolean;
  };
  adaptationHistory: AdaptationEvent[];
  confidence: number; // How confident we are in this profile
}

export interface AdaptationEvent {
  timestamp: string;
  trigger: 'response_length' | 'engagement_level' | 'topic_preference' | 'communication_style';
  oldValue: any;
  newValue: any;
  confidence: number;
}

export interface GeneratedQuestion {
  question: string;
  category: QuestionCategory;
  depth: QuestionDepth;
  followUps: string[];
  context: {
    templateId: string;
    variationUsed: number;
    personalityAdaptation: PersonalityType;
    reasoning: string;
  };
  metadata: {
    expectedResponseLength: 'short' | 'medium' | 'long';
    emotionalTone: 'light' | 'neutral' | 'serious' | 'playful';
    cognitiveLoad: 'low' | 'medium' | 'high';
  };
}

export interface PromptContext {
  userId: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening';
  dayOfWeek: string;
  recentInteractions: ConversationMessage[];
  userMood?: 'positive' | 'negative' | 'neutral' | 'mixed';
  currentGoals?: string[];
  recentAchievements?: string[];
  challenges?: string[];
  preferences: UserAIPreferences;
}

export class PromptEngine {
  private dbService: DatabaseService;
  private questionTemplates: Map<string, QuestionTemplate> = new Map();
  private userProfiles: Map<string, UserPersonalityProfile> = new Map();
  private recentQuestions: Map<string, string[]> = new Map(); // userId -> recent question IDs

  constructor() {
    this.dbService = new DatabaseService();
    this.initializeQuestionTemplates();
  }

  /**
   * Generate a personalized question for the user
   */
  async generateQuestion(context: PromptContext): Promise<GeneratedQuestion> {
    // Get or create user personality profile
    const profile = await this.getUserPersonalityProfile(context.userId);

    // Select appropriate question template
    const template = this.selectQuestionTemplate(context, profile);

    // Generate the actual question with personalization
    const question = this.personalizeQuestion(template, context, profile);

    // Generate follow-up questions
    const followUps = this.generateFollowUps(template, context, profile);

    // Track question usage
    await this.trackQuestionUsage(context.userId, template.id);

    return {
      question,
      category: template.category,
      depth: template.depth,
      followUps,
      context: {
        templateId: template.id,
        variationUsed: this.getVariationIndex(template, question),
        personalityAdaptation: profile.primaryType,
        reasoning: this.explainQuestionChoice(template, context, profile),
      },
      metadata: {
        expectedResponseLength: this.predictResponseLength(template, profile),
        emotionalTone: this.determineEmotionalTone(template, context),
        cognitiveLoad: this.assessCognitiveLoad(template, context),
      },
    };
  }

  /**
   * Generate a contextual response prompt
   */
  async generateResponsePrompt(request: AIRequest, context: PromptContext): Promise<string> {
    const profile = await this.getUserPersonalityProfile(context.userId);

    const basePrompt = this.buildBaseResponsePrompt(profile);
    const contextualPrompt = this.addContextualElements(basePrompt, context, profile);
    const personalizedPrompt = this.personalizeResponseStyle(contextualPrompt, profile);

    return personalizedPrompt;
  }

  /**
   * Learn from user interactions and adapt personality profile
   */
  async adaptFromInteraction(
    userId: string,
    userMessage: string,
    questionAsked: string,
    responseTime: number,
    engagementLevel: 'low' | 'medium' | 'high'
  ): Promise<void> {
    const profile = await this.getUserPersonalityProfile(userId);

    // Analyze response characteristics
    const responseAnalysis = this.analyzeUserResponse(userMessage, questionAsked);

    // Update personality traits based on analysis
    const adaptations = this.calculateAdaptations(
      profile,
      responseAnalysis,
      responseTime,
      engagementLevel
    );

    // Apply adaptations
    for (const adaptation of adaptations) {
      this.applyAdaptation(profile, adaptation);
    }

    // Save updated profile
    await this.saveUserPersonalityProfile(userId, profile);
  }

  /**
   * Initialize default question templates
   */
  private initializeQuestionTemplates(): void {
    const templates: QuestionTemplate[] = [
      // Completion Questions
      {
        id: 'completion_daily_basic',
        category: 'completion',
        depth: 'surface',
        baseTemplate: "What's something you completed today?",
        variations: [
          'What did you accomplish today?',
          "What's one thing you finished today?",
          'What task did you complete today?',
          'What did you get done today?',
          "What's something you can check off your list today?",
          'What did you wrap up today?',
          "What's one accomplishment from today?",
        ],
        followUpTemplates: [
          'How did that make you feel?',
          'What was the most challenging part?',
          'What did you learn from completing it?',
          'How will this help you tomorrow?',
        ],
        personalityAdaptations: {
          analytical:
            'What specific task or project did you complete today, and what was your process?',
          creative: 'What did you create or bring to life today?',
          practical: 'What useful thing did you get done today?',
          empathetic: "What's something you completed today that you're proud of?",
          ambitious: 'What significant accomplishment did you achieve today?',
          reflective: 'Looking back on today, what stands out as completed?',
          social: 'What did you accomplish today, perhaps with others?',
          independent: 'What did you tackle and finish on your own today?',
        },
        metadata: {
          frequency: 'daily',
          timeOfDay: 'evening',
          mood: 'any',
          complexity: 'simple',
        },
      },

      // Planning Questions
      {
        id: 'planning_tomorrow_tasks',
        category: 'planning',
        depth: 'surface',
        baseTemplate: 'What are your tasks for tomorrow?',
        variations: [
          "What's on your agenda for tomorrow?",
          'What do you want to accomplish tomorrow?',
          "What's planned for tomorrow?",
          'What are you focusing on tomorrow?',
          "What's your priority for tomorrow?",
          'What needs to get done tomorrow?',
          "What's tomorrow looking like for you?",
        ],
        followUpTemplates: [
          'Which one is most important?',
          'What might get in the way?',
          'How will you prepare for that?',
          'What resources do you need?',
        ],
        personalityAdaptations: {
          analytical: 'What specific tasks and priorities do you have mapped out for tomorrow?',
          creative: 'What projects or creative work are you planning for tomorrow?',
          practical: 'What concrete tasks need to be handled tomorrow?',
          empathetic: 'What meaningful work are you hoping to do tomorrow?',
          ambitious: 'What important goals are you pursuing tomorrow?',
          reflective: 'As you think ahead, what feels important for tomorrow?',
          social: 'What collaborative work or meetings do you have tomorrow?',
          independent: 'What are you planning to tackle on your own tomorrow?',
        },
        metadata: {
          frequency: 'daily',
          timeOfDay: 'evening',
          mood: 'any',
          complexity: 'simple',
        },
      },

      // Learning Questions
      {
        id: 'learning_lesson_today',
        category: 'learning',
        depth: 'moderate',
        baseTemplate: "What's a lesson you learned today?",
        variations: [
          'What did you learn about yourself today?',
          'What insight did you gain today?',
          'What did today teach you?',
          'What new understanding did you develop?',
          'What wisdom did you pick up today?',
          'What did you discover today?',
          'What realization did you have?',
        ],
        followUpTemplates: [
          'How will you apply this learning?',
          'What made this lesson stick out?',
          'How does this change your perspective?',
          'What would you tell someone else about this?',
        ],
        personalityAdaptations: {
          analytical: 'What specific insight or data point did you learn today?',
          creative: 'What inspired a new way of thinking for you today?',
          practical: 'What useful knowledge or skill did you pick up today?',
          empathetic: 'What did you learn about yourself or others today?',
          ambitious: 'What lesson will help you grow or achieve more?',
          reflective: 'What deeper understanding emerged for you today?',
          social: 'What did you learn from your interactions with others?',
          independent: 'What did you figure out or learn on your own today?',
        },
        metadata: {
          frequency: 'daily',
          timeOfDay: 'any',
          mood: 'reflective',
          complexity: 'moderate',
        },
      },

      // Deep Reflection Questions
      {
        id: 'reflection_growth_moment',
        category: 'reflection',
        depth: 'deep',
        baseTemplate: 'What moment today challenged you to grow?',
        variations: [
          'When did you step outside your comfort zone today?',
          'What situation pushed you to be better today?',
          'What challenged your assumptions today?',
          'When did you have to dig deeper today?',
          'What moment required courage from you today?',
          'When did you surprise yourself today?',
          'What experience stretched you today?',
        ],
        followUpTemplates: [
          'How did you handle that challenge?',
          'What strengths did you discover?',
          'What would you do differently?',
          'How has this changed you?',
        ],
        personalityAdaptations: {
          analytical: 'What complex problem or situation challenged your thinking today?',
          creative: 'What creative challenge pushed you beyond your usual approach?',
          practical: 'What practical challenge required you to develop new skills?',
          empathetic: 'What emotional or interpersonal situation helped you grow?',
          ambitious: 'What obstacle did you overcome in pursuit of your goals?',
          reflective: 'What inner challenge or realization emerged for you today?',
          social: 'What social situation challenged you to grow or adapt?',
          independent: 'What personal challenge did you face and work through alone?',
        },
        metadata: {
          frequency: 'weekly',
          timeOfDay: 'evening',
          mood: 'reflective',
          complexity: 'complex',
        },
      },

      // Gratitude Questions
      {
        id: 'gratitude_appreciation',
        category: 'gratitude',
        depth: 'moderate',
        baseTemplate: 'What are you grateful for today?',
        variations: [
          'What brought you joy today?',
          'What made you smile today?',
          'What are you appreciating right now?',
          "What's something good that happened today?",
          'What positive moment stands out?',
          'What are you thankful for today?',
          'What brightened your day?',
        ],
        followUpTemplates: [
          'Why was that meaningful to you?',
          'How did that impact your day?',
          'What made that special?',
          'How can you carry that feeling forward?',
        ],
        personalityAdaptations: {
          analytical: 'What specific positive outcome or result are you grateful for today?',
          creative: 'What beautiful or inspiring moment are you appreciating?',
          practical: 'What helpful or useful thing are you thankful for today?',
          empathetic: 'What act of kindness or connection are you grateful for?',
          ambitious: 'What progress or achievement are you appreciating today?',
          reflective: 'What deeper blessing or gift are you recognizing today?',
          social: 'What relationship or interaction brought you gratitude today?',
          independent: 'What personal accomplishment or moment are you grateful for?',
        },
        metadata: {
          frequency: 'daily',
          timeOfDay: 'any',
          mood: 'positive',
          complexity: 'simple',
        },
      },

      // Goal Setting Questions
      {
        id: 'goals_weekly_focus',
        category: 'goal_setting',
        depth: 'moderate',
        baseTemplate: "What's your main focus for this week?",
        variations: [
          "What's your priority this week?",
          'What do you want to achieve this week?',
          "What's your weekly goal?",
          'What are you working toward this week?',
          "What's your intention for this week?",
          'What outcome do you want this week?',
          "What's driving your week?",
        ],
        followUpTemplates: [
          'What steps will get you there?',
          'What obstacles might you face?',
          'How will you measure success?',
          'What support do you need?',
        ],
        personalityAdaptations: {
          analytical: 'What specific, measurable objective are you targeting this week?',
          creative: 'What creative project or vision are you pursuing this week?',
          practical: 'What concrete outcome do you want to achieve this week?',
          empathetic: 'What meaningful impact do you want to create this week?',
          ambitious: 'What significant milestone are you aiming for this week?',
          reflective: 'What deeper purpose is guiding your week?',
          social: 'What collaborative goal are you working on this week?',
          independent: 'What personal achievement are you pursuing this week?',
        },
        metadata: {
          frequency: 'weekly',
          timeOfDay: 'morning',
          mood: 'any',
          complexity: 'moderate',
        },
      },
    ];

    // Store templates in map
    templates.forEach(template => {
      this.questionTemplates.set(template.id, template);
    });
  }

  /**
   * Select the most appropriate question template
   */
  private selectQuestionTemplate(
    context: PromptContext,
    profile: UserPersonalityProfile
  ): QuestionTemplate {
    const availableTemplates = Array.from(this.questionTemplates.values());

    // Filter by user preferences
    let filteredTemplates = availableTemplates.filter(template => {
      // Check if category is in favorites or not in avoid list
      if (profile.preferences.favoriteCategories.length > 0) {
        if (!profile.preferences.favoriteCategories.includes(template.category)) {
          return false;
        }
      }

      if (profile.preferences.avoidCategories.includes(template.category)) {
        return false;
      }

      // Check depth preference
      if (profile.preferences.questionDepth !== template.depth && Math.random() > 0.3) {
        // 30% chance to use different depth
        return false;
      }

      return true;
    });

    // If no templates match preferences, use all templates
    if (filteredTemplates.length === 0) {
      filteredTemplates = availableTemplates;
    }

    // Filter by context (time of day, mood, etc.)
    const contextFiltered = filteredTemplates.filter(template => {
      if (
        template.metadata.timeOfDay &&
        template.metadata.timeOfDay !== 'any' &&
        template.metadata.timeOfDay !== context.timeOfDay
      ) {
        return Math.random() > 0.7; // 30% chance to use anyway
      }

      if (
        template.metadata.mood &&
        template.metadata.mood !== 'any' &&
        context.userMood &&
        template.metadata.mood !== context.userMood
      ) {
        return Math.random() > 0.6; // 40% chance to use anyway
      }

      return true;
    });

    const finalTemplates = contextFiltered.length > 0 ? contextFiltered : filteredTemplates;

    // Avoid recently used questions
    const recentQuestionIds = this.recentQuestions.get(context.userId) || [];
    const freshTemplates = finalTemplates.filter(
      template => !recentQuestionIds.includes(template.id)
    );

    const candidateTemplates = freshTemplates.length > 0 ? freshTemplates : finalTemplates;

    // Select randomly from candidates
    return candidateTemplates[Math.floor(Math.random() * candidateTemplates.length)];
  }

  /**
   * Personalize question based on user profile
   */
  private personalizeQuestion(
    template: QuestionTemplate,
    context: PromptContext,
    profile: UserPersonalityProfile
  ): string {
    // Start with personality-adapted version
    let question = template.personalityAdaptations[profile.primaryType] || template.baseTemplate;

    // If user prefers variety, use a variation
    if (Math.random() > 0.3) {
      // 70% chance to use variation
      const variations = [template.baseTemplate, ...template.variations];
      question = variations[Math.floor(Math.random() * variations.length)];
    }

    // Adjust formality based on user traits
    if (profile.traits.formality < 0.3) {
      question = this.makeCasual(question);
    } else if (profile.traits.formality > 0.7) {
      question = this.makeFormal(question);
    }

    // Adjust directness
    if (profile.traits.directness < 0.3) {
      question = this.makeSofter(question);
    } else if (profile.traits.directness > 0.7) {
      question = this.makeDirecter(question);
    }

    return question;
  }

  /**
   * Generate follow-up questions
   */
  private generateFollowUps(
    template: QuestionTemplate,
    context: PromptContext,
    profile: UserPersonalityProfile
  ): string[] {
    if (!profile.preferences.includeFollowUps || !template.followUpTemplates) {
      return [];
    }

    const numFollowUps = Math.min(2, template.followUpTemplates.length);
    const selectedFollowUps = template.followUpTemplates
      .sort(() => Math.random() - 0.5)
      .slice(0, numFollowUps);

    return selectedFollowUps.map(followUp => this.personalizeFollowUp(followUp, profile));
  }

  /**
   * Get or create user personality profile
   */
  private async getUserPersonalityProfile(userId: string): Promise<UserPersonalityProfile> {
    // Check cache first
    if (this.userProfiles.has(userId)) {
      return this.userProfiles.get(userId)!;
    }

    // Try to load from database
    try {
      const userProfile = await this.dbService.getUserProfile(userId);
      if (userProfile?.personalityProfile) {
        const profile = userProfile.personalityProfile as UserPersonalityProfile;
        this.userProfiles.set(userId, profile);
        return profile;
      }
    } catch (error) {
      console.warn('Failed to load personality profile:', error);
    }

    // Create default profile
    const defaultProfile: UserPersonalityProfile = {
      primaryType: 'empathetic', // Default to empathetic
      traits: {
        formality: 0.5,
        verbosity: 0.5,
        emotionalExpression: 0.6,
        directness: 0.4,
        curiosity: 0.7,
      },
      preferences: {
        questionDepth: 'moderate',
        favoriteCategories: [],
        avoidCategories: [],
        responseLength: 'medium',
        includeFollowUps: true,
      },
      adaptationHistory: [],
      confidence: 0.1, // Low confidence initially
    };

    this.userProfiles.set(userId, defaultProfile);
    return defaultProfile;
  }

  /**
   * Save user personality profile
   */
  private async saveUserPersonalityProfile(
    userId: string,
    profile: UserPersonalityProfile
  ): Promise<void> {
    try {
      await this.dbService.saveUserProfile(userId, {
        personalityProfile: profile,
        lastUpdated: new Date().toISOString(),
      });

      // Update cache
      this.userProfiles.set(userId, profile);
    } catch (error) {
      console.error('Failed to save personality profile:', error);
    }
  }

  /**
   * Utility methods for question personalization
   */
  private makeCasual(question: string): string {
    return question
      .replace(/What is/g, "What's")
      .replace(/What are/g, "What're")
      .replace(/you are/g, "you're")
      .replace(/\?$/, '? 😊');
  }

  private makeFormal(question: string): string {
    return question
      .replace(/What's/g, 'What is')
      .replace(/What're/g, 'What are')
      .replace(/you're/g, 'you are')
      .replace(/ 😊/g, '');
  }

  private makeSofter(question: string): string {
    const softeners = [
      "I'm curious, ",
      "I'd love to know, ",
      "If you don't mind sharing, ",
      'When you have a moment, ',
    ];

    if (Math.random() > 0.5) {
      const softener = softeners[Math.floor(Math.random() * softeners.length)];
      return softener + question.toLowerCase();
    }

    return question;
  }

  private makeDirecter(question: string): string {
    return question.replace(
      /^(I'm curious, |I'd love to know, |If you don't mind sharing, |When you have a moment, )/i,
      ''
    );
  }

  private personalizeFollowUp(followUp: string, profile: UserPersonalityProfile): string {
    // Apply same personalization logic as main questions
    if (profile.traits.formality < 0.3) {
      followUp = this.makeCasual(followUp);
    }

    if (profile.traits.directness < 0.3) {
      followUp = this.makeSofter(followUp);
    }

    return followUp;
  }

  // Additional helper methods would be implemented here...
  private getVariationIndex(template: QuestionTemplate, question: string): number {
    const allVariations = [template.baseTemplate, ...template.variations];
    return allVariations.indexOf(question);
  }

  private explainQuestionChoice(
    template: QuestionTemplate,
    context: PromptContext,
    profile: UserPersonalityProfile
  ): string {
    return `Selected ${template.category} question for ${profile.primaryType} personality at ${context.timeOfDay}`;
  }

  private predictResponseLength(
    template: QuestionTemplate,
    profile: UserPersonalityProfile
  ): 'short' | 'medium' | 'long' {
    if (template.depth === 'surface') {
      return 'short';
    }
    if (template.depth === 'deep' || template.depth === 'profound') {
      return 'long';
    }
    return profile.preferences.responseLength;
  }

  private determineEmotionalTone(
    template: QuestionTemplate,
    context: PromptContext
  ): 'light' | 'neutral' | 'serious' | 'playful' {
    if (template.category === 'gratitude') {
      return 'light';
    }
    if (template.depth === 'deep' || template.depth === 'profound') {
      return 'serious';
    }
    if (context.timeOfDay === 'morning') {
      return 'playful';
    }
    return 'neutral';
  }

  private assessCognitiveLoad(
    template: QuestionTemplate,
    context: PromptContext
  ): 'low' | 'medium' | 'high' {
    if (template.metadata.complexity === 'simple') {
      return 'low';
    }
    if (template.metadata.complexity === 'complex') {
      return 'high';
    }
    return 'medium';
  }

  private buildBaseResponsePrompt(profile: UserPersonalityProfile): string {
    return `You are Fylgja, responding to a ${profile.primaryType} personality type.`;
  }

  private addContextualElements(
    prompt: string,
    context: PromptContext,
    profile: UserPersonalityProfile
  ): string {
    return prompt + ` Consider the ${context.timeOfDay} timing and recent interactions.`;
  }

  private personalizeResponseStyle(prompt: string, profile: UserPersonalityProfile): string {
    return (
      prompt +
      ` Adapt your response style to match their ${profile.traits.formality > 0.5 ? 'formal' : 'casual'} communication preference.`
    );
  }

  private analyzeUserResponse(userMessage: string, questionAsked: string): any {
    return {
      length: userMessage.length,
      sentiment: 'neutral', // Would use sentiment analysis
      complexity: userMessage.split(' ').length > 50 ? 'high' : 'low',
    };
  }

  private calculateAdaptations(
    profile: UserPersonalityProfile,
    analysis: any,
    responseTime: number,
    engagement: string
  ): AdaptationEvent[] {
    const adaptations: AdaptationEvent[] = [];

    // Example adaptation logic
    if (analysis.length < 50 && profile.preferences.responseLength === 'long') {
      adaptations.push({
        timestamp: new Date().toISOString(),
        trigger: 'response_length',
        oldValue: 'long',
        newValue: 'medium',
        confidence: 0.7,
      });
    }

    return adaptations;
  }

  private applyAdaptation(profile: UserPersonalityProfile, adaptation: AdaptationEvent): void {
    profile.adaptationHistory.push(adaptation);

    // Apply the adaptation based on trigger
    switch (adaptation.trigger) {
      case 'response_length':
        profile.preferences.responseLength = adaptation.newValue;
        break;
      // Add more adaptation types as needed
    }

    // Update confidence
    profile.confidence = Math.min(1.0, profile.confidence + 0.1);
  }

  private async trackQuestionUsage(userId: string, templateId: string): Promise<void> {
    const recent = this.recentQuestions.get(userId) || [];
    recent.push(templateId);

    // Keep only last 10 questions
    if (recent.length > 10) {
      recent.shift();
    }

    this.recentQuestions.set(userId, recent);
  }
}
