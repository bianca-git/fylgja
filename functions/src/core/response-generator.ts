/**
 * Response Generation Engine for Fylgja
 * Intelligent, contextual, and personalized response generation
 */

import { cacheService } from '../cache/redis-cache-service';
import { EnhancedDatabaseService } from '../services/enhanced-database-service';
import { GoogleAIService } from '../services/google-ai-service';
import { FylgjaError, createSystemError } from '../utils/error-handler';
import { performanceMonitor } from '../utils/monitoring';

import { AdaptiveLearningEngine } from './adaptive-learning';
import { PromptEngine } from './prompt-engine';

export interface ResponseContext {
  userId: string;
  conversationId: string;
  messageHistory: ConversationMessage[];
  userProfile: UserProfile;
  currentMood?: string;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek: string;
  timezone: string;
  platform: 'whatsapp' | 'web' | 'google_home' | 'api';
  sessionData?: Record<string, any>;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: {
    sentiment?: number;
    topics?: string[];
    intent?: string;
    confidence?: number;
  };
}

export interface UserProfile {
  id: string;
  name: string;
  preferences: {
    communicationStyle: 'formal' | 'casual' | 'friendly' | 'professional';
    questionDepth: 'surface' | 'moderate' | 'deep' | 'profound';
    responseLength: 'brief' | 'moderate' | 'detailed';
    personalityType: string;
    topics: string[];
    timePreferences: {
      checkInTime: string;
      reminderFrequency: 'daily' | 'weekly' | 'custom';
    };
  };
  adaptiveLearning: {
    patterns: Record<string, any>;
    confidence: number;
    lastUpdated: string;
  };
  goals: Array<{
    id: string;
    title: string;
    category: string;
    priority: 'low' | 'medium' | 'high';
    status: 'active' | 'completed' | 'paused';
  }>;
  recentInteractions: Array<{
    timestamp: string;
    type: string;
    sentiment: number;
    engagement: number;
  }>;
}

export interface ResponseOptions {
  responseType:
    | 'question'
    | 'acknowledgment'
    | 'suggestion'
    | 'reflection'
    | 'encouragement'
    | 'clarification';
  tone: 'supportive' | 'motivational' | 'reflective' | 'celebratory' | 'empathetic' | 'curious';
  includeFollowUp: boolean;
  includeActionItems: boolean;
  maxLength?: number;
  personalizationLevel: 'low' | 'medium' | 'high';
  contextAwareness: 'minimal' | 'moderate' | 'comprehensive';
}

export interface GeneratedResponse {
  content: string;
  metadata: {
    responseType: string;
    tone: string;
    confidence: number;
    personalizationScore: number;
    contextRelevance: number;
    estimatedEngagement: number;
    suggestedFollowUps: string[];
    actionItems: string[];
    topics: string[];
    sentiment: number;
  };
  alternatives: string[];
  reasoning: string;
  adaptiveLearningInsights: {
    patterns: string[];
    adjustments: string[];
    confidence: number;
  };
}

export interface ResponseTemplate {
  id: string;
  category: string;
  template: string;
  variables: string[];
  conditions: {
    mood?: string[];
    timeOfDay?: string[];
    personalityType?: string[];
    engagementLevel?: string[];
  };
  personalizationHooks: string[];
  followUpSuggestions: string[];
}

export interface ConversationFlow {
  currentStep: string;
  flowType: 'check_in' | 'goal_setting' | 'reflection' | 'problem_solving' | 'celebration';
  steps: Array<{
    id: string;
    prompt: string;
    expectedResponse: string;
    nextSteps: string[];
    fallbackSteps: string[];
  }>;
  context: Record<string, any>;
  progress: number;
}

export class ResponseGenerator {
  private googleAI: GoogleAIService;
  private promptEngine: PromptEngine;
  private adaptiveLearning: AdaptiveLearningEngine;
  private database: EnhancedDatabaseService;

  private responseTemplates: Map<string, ResponseTemplate> = new Map();
  private conversationFlows: Map<string, ConversationFlow> = new Map();

  private readonly CACHE_TTL = 300000; // 5 minutes
  private readonly MAX_CONTEXT_MESSAGES = 10;
  private readonly PERSONALIZATION_THRESHOLD = 0.7;

  constructor() {
    this.googleAI = new GoogleAIService();
    this.promptEngine = new PromptEngine();
    this.adaptiveLearning = new AdaptiveLearningEngine();
    this.database = new EnhancedDatabaseService();

    this.initializeResponseTemplates();
  }

  /**
   * Generate intelligent response based on context
   */
  async generateResponse(
    context: ResponseContext,
    options: ResponseOptions
  ): Promise<GeneratedResponse> {
    const timerId = performanceMonitor.startTimer('response_generation');

    try {
      // Validate input
      this.validateResponseContext(context);

      // Check cache for similar responses
      const cacheKey = this.generateCacheKey(context, options);
      const cachedResponse = await cacheService.get(cacheKey);

      if (cachedResponse && this.shouldUseCachedResponse(cachedResponse, context)) {
        performanceMonitor.endTimer(timerId);
        return this.adaptCachedResponse(cachedResponse, context);
      }

      // Analyze conversation context
      const contextAnalysis = await this.analyzeConversationContext(context);

      // Apply adaptive learning insights
      const learningInsights = await this.adaptiveLearning.analyzeUserBehavior(
        context.userId,
        context.messageHistory
      );

      // Generate personalized prompt
      const personalizedPrompt = await this.generatePersonalizedPrompt(
        context,
        options,
        contextAnalysis,
        learningInsights
      );

      // Generate response using AI
      const aiResponse = await this.googleAI.generateResponse({
        prompt: personalizedPrompt,
        context: this.buildAIContext(context, contextAnalysis),
        options: {
          maxTokens: this.calculateMaxTokens(options.maxLength),
          temperature: this.calculateTemperature(options.tone, context.userProfile),
          topP: 0.9,
          frequencyPenalty: 0.3,
          presencePenalty: 0.2,
        },
      });

      // Process and enhance the response
      const enhancedResponse = await this.enhanceResponse(
        aiResponse,
        context,
        options,
        contextAnalysis,
        learningInsights
      );

      // Generate alternatives
      const alternatives = await this.generateAlternatives(enhancedResponse, context, options);

      // Create final response object
      const finalResponse: GeneratedResponse = {
        content: enhancedResponse.content,
        metadata: {
          responseType: options.responseType,
          tone: options.tone,
          confidence: enhancedResponse.confidence,
          personalizationScore: this.calculatePersonalizationScore(context, learningInsights),
          contextRelevance: contextAnalysis.relevanceScore,
          estimatedEngagement: this.estimateEngagement(enhancedResponse, context),
          suggestedFollowUps: enhancedResponse.followUps,
          actionItems: enhancedResponse.actionItems,
          topics: enhancedResponse.topics,
          sentiment: enhancedResponse.sentiment,
        },
        alternatives,
        reasoning: enhancedResponse.reasoning,
        adaptiveLearningInsights: {
          patterns: learningInsights.patterns,
          adjustments: learningInsights.adjustments,
          confidence: learningInsights.confidence,
        },
      };

      // Cache the response
      await cacheService.set(cacheKey, finalResponse, { ttl: this.CACHE_TTL });

      // Update adaptive learning
      await this.updateAdaptiveLearning(context, finalResponse, learningInsights);

      performanceMonitor.endTimer(timerId);
      return finalResponse;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Response generation failed: ${error.message}`);
    }
  }

  /**
   * Generate contextual follow-up questions
   */
  async generateFollowUp(
    context: ResponseContext,
    previousResponse: GeneratedResponse
  ): Promise<string[]> {
    const timerId = performanceMonitor.startTimer('followup_generation');

    try {
      const followUpPrompt = await this.promptEngine.generatePrompt({
        type: 'followup',
        context: {
          previousResponse: previousResponse.content,
          userProfile: context.userProfile,
          conversationHistory: context.messageHistory.slice(-3),
          topics: previousResponse.metadata.topics,
        },
        personalization: {
          style: context.userProfile.preferences.communicationStyle,
          depth: context.userProfile.preferences.questionDepth,
        },
      });

      const aiResponse = await this.googleAI.generateResponse({
        prompt: followUpPrompt,
        context: this.buildAIContext(context),
        options: {
          maxTokens: 200,
          temperature: 0.8,
          topP: 0.9,
        },
      });

      const followUps = this.parseFollowUpQuestions(aiResponse.content);

      performanceMonitor.endTimer(timerId);
      return followUps;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Follow-up generation failed: ${error.message}`);
    }
  }

  /**
   * Generate conversation flow responses
   */
  async generateFlowResponse(
    context: ResponseContext,
    flowId: string,
    stepId: string
  ): Promise<GeneratedResponse> {
    const flow = this.conversationFlows.get(flowId);

    if (!flow) {
      throw createSystemError(`Conversation flow not found: ${flowId}`);
    }

    const currentStep = flow.steps.find(step => step.id === stepId);

    if (!currentStep) {
      throw createSystemError(`Flow step not found: ${stepId}`);
    }

    // Generate response based on flow context
    const flowOptions: ResponseOptions = {
      responseType: 'question',
      tone: this.determineFlowTone(flow.flowType),
      includeFollowUp: true,
      includeActionItems: flow.flowType === 'goal_setting',
      personalizationLevel: 'high',
      contextAwareness: 'comprehensive',
    };

    // Add flow context to response context
    const enhancedContext: ResponseContext = {
      ...context,
      sessionData: {
        ...context.sessionData,
        flowContext: flow.context,
        currentStep: stepId,
        flowProgress: flow.progress,
      },
    };

    return await this.generateResponse(enhancedContext, flowOptions);
  }

  /**
   * Analyze conversation sentiment and adjust response accordingly
   */
  async analyzeSentimentAndAdjust(context: ResponseContext, baseResponse: string): Promise<string> {
    const timerId = performanceMonitor.startTimer('sentiment_adjustment');

    try {
      // Analyze recent message sentiment
      const recentMessages = context.messageHistory.slice(-3);
      const sentimentAnalysis = await this.googleAI.analyzeSentiment(
        recentMessages.map(m => m.content).join(' ')
      );

      // Adjust response based on sentiment
      if (sentimentAnalysis.sentiment < -0.3) {
        // User seems negative, be more empathetic
        return await this.adjustResponseTone(baseResponse, 'empathetic', context);
      } else if (sentimentAnalysis.sentiment > 0.3) {
        // User seems positive, be celebratory
        return await this.adjustResponseTone(baseResponse, 'celebratory', context);
      }

      performanceMonitor.endTimer(timerId);
      return baseResponse;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      console.warn('Sentiment adjustment failed, using base response:', error);
      return baseResponse;
    }
  }

  /**
   * Generate personalized greeting based on time and context
   */
  async generatePersonalizedGreeting(context: ResponseContext): Promise<string> {
    const { timeOfDay, userProfile } = context;
    const name = userProfile.name;

    const greetingTemplates = {
      morning: [
        `Good morning, ${name}! Ready to make today amazing?`,
        `Morning, ${name}! What's on your mind today?`,
        `Hey ${name}, hope you're having a great start to your day!`,
      ],
      afternoon: [
        `Good afternoon, ${name}! How's your day going?`,
        `Hey ${name}, hope your afternoon is treating you well!`,
        `Afternoon, ${name}! What's been the highlight so far?`,
      ],
      evening: [
        `Good evening, ${name}! How was your day?`,
        `Evening, ${name}! Ready to wind down and reflect?`,
        `Hey ${name}, hope you had a productive day!`,
      ],
      night: [
        `Good evening, ${name}! How are you feeling tonight?`,
        `Hey ${name}, hope you're having a peaceful evening!`,
        `Evening, ${name}! Ready for some reflection time?`,
      ],
    };

    const templates = greetingTemplates[timeOfDay] || greetingTemplates.afternoon;
    const baseGreeting = templates[Math.floor(Math.random() * templates.length)];

    // Personalize based on recent interactions
    if (context.userProfile.recentInteractions.length > 0) {
      const lastInteraction = context.userProfile.recentInteractions[0];
      const daysSinceLastInteraction = Math.floor(
        (Date.now() - new Date(lastInteraction.timestamp).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLastInteraction > 1) {
        return `${baseGreeting} It's been ${daysSinceLastInteraction} days since we last talked - I've missed our conversations!`;
      }
    }

    return baseGreeting;
  }

  /**
   * Private helper methods
   */
  private validateResponseContext(context: ResponseContext): void {
    if (!context.userId) {
      throw createSystemError('User ID is required for response generation');
    }

    if (!context.userProfile) {
      throw createSystemError('User profile is required for response generation');
    }

    if (!context.messageHistory) {
      throw createSystemError('Message history is required for response generation');
    }
  }

  private generateCacheKey(context: ResponseContext, options: ResponseOptions): string {
    const keyComponents = [
      context.userId,
      options.responseType,
      options.tone,
      context.timeOfDay,
      context.platform,
      JSON.stringify(context.messageHistory.slice(-2).map(m => m.content)),
    ];

    return `response_${keyComponents.join('_')}`;
  }

  private shouldUseCachedResponse(cachedResponse: any, context: ResponseContext): boolean {
    // Don't use cached responses for highly personalized interactions
    if (context.userProfile.preferences.personalityType === 'unique') {
      return false;
    }

    // Don't use cached responses if user mood has changed significantly
    if (context.currentMood && cachedResponse.metadata?.mood !== context.currentMood) {
      return false;
    }

    return true;
  }

  private adaptCachedResponse(
    cachedResponse: GeneratedResponse,
    context: ResponseContext
  ): GeneratedResponse {
    // Adapt cached response to current context
    const adaptedContent = cachedResponse.content.replace(
      /\b(morning|afternoon|evening|night)\b/gi,
      context.timeOfDay
    );

    return {
      ...cachedResponse,
      content: adaptedContent,
      metadata: {
        ...cachedResponse.metadata,
        confidence: cachedResponse.metadata.confidence * 0.9, // Slightly lower confidence for cached
      },
    };
  }

  private async analyzeConversationContext(context: ResponseContext): Promise<any> {
    const recentMessages = context.messageHistory.slice(-this.MAX_CONTEXT_MESSAGES);

    // Analyze topics, sentiment, and patterns
    const topics = this.extractTopics(recentMessages);
    const sentiment = this.analyzeSentiment(recentMessages);
    const patterns = this.identifyPatterns(recentMessages);

    return {
      topics,
      sentiment,
      patterns,
      relevanceScore: this.calculateRelevanceScore(topics, context.userProfile),
      conversationLength: recentMessages.length,
      lastUserMessage: recentMessages[recentMessages.length - 1],
    };
  }

  private async generatePersonalizedPrompt(
    context: ResponseContext,
    options: ResponseOptions,
    contextAnalysis: any,
    learningInsights: any
  ): Promise<string> {
    const basePrompt = await this.promptEngine.generatePrompt({
      type: options.responseType,
      context: {
        userProfile: context.userProfile,
        conversationHistory: context.messageHistory,
        timeOfDay: context.timeOfDay,
        platform: context.platform,
        topics: contextAnalysis.topics,
      },
      personalization: {
        style: context.userProfile.preferences.communicationStyle,
        depth: context.userProfile.preferences.questionDepth,
        personalityType: context.userProfile.preferences.personalityType,
        adaptiveLearning: learningInsights,
      },
    });

    // Add contextual enhancements
    const enhancedPrompt = this.enhancePromptWithContext(
      basePrompt,
      context,
      contextAnalysis,
      options
    );

    return enhancedPrompt;
  }

  private buildAIContext(context: ResponseContext, contextAnalysis?: any): string {
    const contextParts = [
      `User: ${context.userProfile.name}`,
      `Time: ${context.timeOfDay} on ${context.dayOfWeek}`,
      `Platform: ${context.platform}`,
      `Communication Style: ${context.userProfile.preferences.communicationStyle}`,
      `Question Depth: ${context.userProfile.preferences.questionDepth}`,
    ];

    if (contextAnalysis) {
      contextParts.push(`Recent Topics: ${contextAnalysis.topics.join(', ')}`);
      contextParts.push(`Conversation Sentiment: ${contextAnalysis.sentiment}`);
    }

    if (context.userProfile.goals.length > 0) {
      const activeGoals = context.userProfile.goals.filter(g => g.status === 'active');
      contextParts.push(`Active Goals: ${activeGoals.map(g => g.title).join(', ')}`);
    }

    return contextParts.join('\n');
  }

  private async enhanceResponse(
    aiResponse: any,
    context: ResponseContext,
    options: ResponseOptions,
    contextAnalysis: any,
    learningInsights: any
  ): Promise<any> {
    let enhancedContent = aiResponse.content;

    // Apply personalization
    if (options.personalizationLevel === 'high') {
      enhancedContent = await this.applyPersonalization(enhancedContent, context, learningInsights);
    }

    // Add follow-ups if requested
    const followUps = options.includeFollowUp
      ? await this.generateContextualFollowUps(context, enhancedContent)
      : [];

    // Extract action items if requested
    const actionItems = options.includeActionItems ? this.extractActionItems(enhancedContent) : [];

    // Analyze response sentiment
    const sentiment = await this.analyzeSentiment([
      { content: enhancedContent } as ConversationMessage,
    ]);

    return {
      content: enhancedContent,
      confidence: aiResponse.confidence || 0.8,
      followUps,
      actionItems,
      topics: contextAnalysis.topics,
      sentiment,
      reasoning:
        aiResponse.reasoning || 'Generated based on conversation context and user preferences',
    };
  }

  private async generateAlternatives(
    response: any,
    context: ResponseContext,
    options: ResponseOptions
  ): Promise<string[]> {
    // Generate 2-3 alternative phrasings
    const alternativePrompt = `Rephrase this response in 2 different ways while maintaining the same meaning and tone: "${response.content}"`;

    try {
      const aiResponse = await this.googleAI.generateResponse({
        prompt: alternativePrompt,
        context: this.buildAIContext(context),
        options: {
          maxTokens: 300,
          temperature: 0.9,
          topP: 0.9,
        },
      });

      return this.parseAlternatives(aiResponse.content);
    } catch (error) {
      console.warn('Alternative generation failed:', error);
      return [];
    }
  }

  private calculatePersonalizationScore(context: ResponseContext, learningInsights: any): number {
    let score = 0.5; // Base score

    // Increase score based on available user data
    if (context.userProfile.preferences.personalityType) {
      score += 0.1;
    }
    if (context.userProfile.goals.length > 0) {
      score += 0.1;
    }
    if (context.userProfile.recentInteractions.length > 5) {
      score += 0.1;
    }
    if (learningInsights.confidence > this.PERSONALIZATION_THRESHOLD) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }

  private estimateEngagement(response: any, context: ResponseContext): number {
    let engagement = 0.5; // Base engagement

    // Factors that increase engagement
    if (response.followUps.length > 0) {
      engagement += 0.1;
    }
    if (response.actionItems.length > 0) {
      engagement += 0.1;
    }
    if (response.content.includes(context.userProfile.name)) {
      engagement += 0.1;
    }
    if (
      response.topics.some((topic: string) =>
        context.userProfile.preferences.topics.includes(topic)
      )
    ) {
      engagement += 0.2;
    }

    return Math.min(engagement, 1.0);
  }

  private async updateAdaptiveLearning(
    context: ResponseContext,
    response: GeneratedResponse,
    learningInsights: any
  ): Promise<void> {
    try {
      await this.adaptiveLearning.updateUserProfile(context.userId, {
        responseType: response.metadata.responseType,
        tone: response.metadata.tone,
        engagement: response.metadata.estimatedEngagement,
        topics: response.metadata.topics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('Adaptive learning update failed:', error);
    }
  }

  private calculateMaxTokens(maxLength?: number): number {
    if (!maxLength) {
      return 500;
    }

    // Rough estimation: 1 token ≈ 0.75 words
    return Math.floor(maxLength * 0.75);
  }

  private calculateTemperature(tone: string, userProfile: UserProfile): number {
    const baseTemperature = 0.7;

    // Adjust based on tone
    const toneAdjustments: Record<string, number> = {
      supportive: 0.6,
      motivational: 0.8,
      reflective: 0.5,
      celebratory: 0.9,
      empathetic: 0.6,
      curious: 0.8,
    };

    // Adjust based on user preferences
    const styleAdjustments: Record<string, number> = {
      formal: -0.1,
      casual: 0.1,
      friendly: 0.1,
      professional: -0.1,
    };

    let temperature = baseTemperature;
    temperature += toneAdjustments[tone] || 0;
    temperature += styleAdjustments[userProfile.preferences.communicationStyle] || 0;

    return Math.max(0.1, Math.min(1.0, temperature));
  }

  private determineFlowTone(flowType: string): ResponseOptions['tone'] {
    const flowTones: Record<string, ResponseOptions['tone']> = {
      check_in: 'curious',
      goal_setting: 'motivational',
      reflection: 'reflective',
      problem_solving: 'supportive',
      celebration: 'celebratory',
    };

    return flowTones[flowType] || 'supportive';
  }

  private async adjustResponseTone(
    response: string,
    newTone: string,
    context: ResponseContext
  ): Promise<string> {
    const adjustmentPrompt = `Adjust the tone of this response to be more ${newTone} while keeping the same meaning: "${response}"`;

    try {
      const aiResponse = await this.googleAI.generateResponse({
        prompt: adjustmentPrompt,
        context: this.buildAIContext(context),
        options: {
          maxTokens: 300,
          temperature: 0.6,
        },
      });

      return aiResponse.content;
    } catch (error) {
      console.warn('Tone adjustment failed:', error);
      return response;
    }
  }

  private extractTopics(messages: ConversationMessage[]): string[] {
    // Simple topic extraction (in production, use more sophisticated NLP)
    const commonTopics = [
      'work',
      'health',
      'relationships',
      'goals',
      'learning',
      'creativity',
      'productivity',
    ];
    const extractedTopics: string[] = [];

    const allText = messages.map(m => m.content.toLowerCase()).join(' ');

    commonTopics.forEach(topic => {
      if (allText.includes(topic)) {
        extractedTopics.push(topic);
      }
    });

    return extractedTopics;
  }

  private analyzeSentiment(messages: ConversationMessage[]): number {
    // Simple sentiment analysis (in production, use more sophisticated analysis)
    const positiveWords = ['good', 'great', 'happy', 'excited', 'love', 'amazing', 'wonderful'];
    const negativeWords = ['bad', 'sad', 'angry', 'frustrated', 'hate', 'terrible', 'awful'];

    let sentiment = 0;
    const allText = messages.map(m => m.content.toLowerCase()).join(' ');

    positiveWords.forEach(word => {
      const matches = (allText.match(new RegExp(word, 'g')) || []).length;
      sentiment += matches * 0.1;
    });

    negativeWords.forEach(word => {
      const matches = (allText.match(new RegExp(word, 'g')) || []).length;
      sentiment -= matches * 0.1;
    });

    return Math.max(-1, Math.min(1, sentiment));
  }

  private identifyPatterns(messages: ConversationMessage[]): string[] {
    // Identify conversation patterns
    const patterns: string[] = [];

    if (messages.length > 3) {
      const avgLength = messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length;

      if (avgLength < 50) {
        patterns.push('brief_responses');
      }
      if (avgLength > 200) {
        patterns.push('detailed_responses');
      }
    }

    return patterns;
  }

  private calculateRelevanceScore(topics: string[], userProfile: UserProfile): number {
    if (topics.length === 0) {
      return 0.5;
    }

    const userTopics = userProfile.preferences.topics;
    const relevantTopics = topics.filter(topic => userTopics.includes(topic));

    return relevantTopics.length / topics.length;
  }

  private enhancePromptWithContext(
    basePrompt: string,
    context: ResponseContext,
    contextAnalysis: any,
    options: ResponseOptions
  ): string {
    let enhancedPrompt = basePrompt;

    // Add context-specific instructions
    if (contextAnalysis.sentiment < -0.3) {
      enhancedPrompt +=
        '\n\nNote: The user seems to be feeling down. Be extra empathetic and supportive.';
    }

    if (context.timeOfDay === 'morning') {
      enhancedPrompt += "\n\nNote: It's morning, so focus on energy and planning for the day.";
    } else if (context.timeOfDay === 'evening') {
      enhancedPrompt += "\n\nNote: It's evening, so focus on reflection and winding down.";
    }

    if (options.responseType === 'encouragement') {
      enhancedPrompt += '\n\nNote: Provide genuine encouragement and motivation.';
    }

    return enhancedPrompt;
  }

  private async applyPersonalization(
    content: string,
    context: ResponseContext,
    learningInsights: any
  ): Promise<string> {
    // Apply learned preferences
    if (learningInsights.patterns.includes('prefers_brief_responses')) {
      // Shorten the response
      const shortenPrompt = `Make this response more concise while keeping the key message: "${content}"`;

      try {
        const aiResponse = await this.googleAI.generateResponse({
          prompt: shortenPrompt,
          context: this.buildAIContext(context),
          options: { maxTokens: 200, temperature: 0.6 },
        });

        return aiResponse.content;
      } catch (error) {
        console.warn('Response shortening failed:', error);
      }
    }

    return content;
  }

  private async generateContextualFollowUps(
    context: ResponseContext,
    response: string
  ): Promise<string[]> {
    const followUpPrompt = `Based on this response: "${response}", suggest 2-3 relevant follow-up questions that would continue the conversation naturally.`;

    try {
      const aiResponse = await this.googleAI.generateResponse({
        prompt: followUpPrompt,
        context: this.buildAIContext(context),
        options: {
          maxTokens: 200,
          temperature: 0.8,
        },
      });

      return this.parseFollowUpQuestions(aiResponse.content);
    } catch (error) {
      console.warn('Follow-up generation failed:', error);
      return [];
    }
  }

  private extractActionItems(content: string): string[] {
    // Extract action items from response
    const actionItems: string[] = [];
    const actionPatterns = [
      /try to (.*?)(?:\.|$)/gi,
      /consider (.*?)(?:\.|$)/gi,
      /you could (.*?)(?:\.|$)/gi,
      /maybe (.*?)(?:\.|$)/gi,
    ];

    actionPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => {
          const action = match.replace(pattern, '$1').trim();
          if (action.length > 5) {
            actionItems.push(action);
          }
        });
      }
    });

    return actionItems.slice(0, 3); // Limit to 3 action items
  }

  private parseFollowUpQuestions(content: string): string[] {
    // Parse follow-up questions from AI response
    const questions = content
      .split('\n')
      .filter(line => line.trim().length > 0)
      .filter(line => line.includes('?'))
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .slice(0, 3);

    return questions;
  }

  private parseAlternatives(content: string): string[] {
    // Parse alternative responses from AI response
    const alternatives = content
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .slice(0, 3);

    return alternatives;
  }

  private initializeResponseTemplates(): void {
    // Initialize common response templates
    const templates: ResponseTemplate[] = [
      {
        id: 'daily_checkin',
        category: 'check_in',
        template: "How are you feeling today, {name}? What's on your mind?",
        variables: ['name'],
        conditions: {
          timeOfDay: ['morning', 'afternoon'],
        },
        personalizationHooks: ['mood', 'recent_goals'],
        followUpSuggestions: ['Tell me more about that', 'What would help with that?'],
      },
      {
        id: 'goal_celebration',
        category: 'celebration',
        template: "That's amazing, {name}! You've made great progress on {goal}. How does it feel?",
        variables: ['name', 'goal'],
        conditions: {
          mood: ['positive', 'accomplished'],
        },
        personalizationHooks: ['achievement', 'progress'],
        followUpSuggestions: ["What's next?", 'How can we build on this?'],
      },
      {
        id: 'supportive_response',
        category: 'support',
        template:
          'I hear you, {name}. That sounds {emotion}. What would be most helpful right now?',
        variables: ['name', 'emotion'],
        conditions: {
          mood: ['negative', 'stressed', 'overwhelmed'],
        },
        personalizationHooks: ['coping_strategies', 'support_preferences'],
        followUpSuggestions: [
          'Would you like to talk about it?',
          'What usually helps you feel better?',
        ],
      },
    ];

    templates.forEach(template => {
      this.responseTemplates.set(template.id, template);
    });
  }
}

// Global response generator instance
export const responseGenerator = new ResponseGenerator();
