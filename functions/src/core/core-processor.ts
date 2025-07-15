/**
 * Core Processing System for Fylgja
 * Central orchestration layer that integrates all components for seamless user interactions
 */

import { GoogleAIService } from '../services/google-ai-service';
import { DatabaseService } from '../services/database-service';
import { PromptEngine, PromptContext, GeneratedQuestion } from './prompt-engine';
import { AdaptiveLearningEngine } from './adaptive-learning';
import { performanceMonitor } from '../utils/monitoring';
import { FylgjaError, ErrorType, createValidationError, createAIServiceError } from '../utils/error-handler';
import { AIRequest, AIResponse, ConversationMessage, UserAIPreferences } from '../types/ai-types';

export interface ProcessingRequest {
  userId: string;
  requestType: ProcessingRequestType;
  input?: string;
  context?: ProcessingContext;
  preferences?: UserAIPreferences;
  metadata?: Record<string, any>;
}

export type ProcessingRequestType = 
  | 'daily_checkin'
  | 'generate_question'
  | 'process_response'
  | 'task_analysis'
  | 'goal_setting'
  | 'reflection_prompt'
  | 'summary_generation'
  | 'proactive_engagement';

export interface ProcessingContext {
  platform: 'whatsapp' | 'web' | 'google_home' | 'api';
  sessionId: string;
  conversationHistory?: ConversationMessage[];
  userLocation?: {
    timezone: string;
    country?: string;
    city?: string;
  };
  deviceInfo?: {
    type: 'mobile' | 'desktop' | 'voice';
    userAgent?: string;
  };
  interactionMetadata?: {
    lastInteraction?: string;
    interactionCount?: number;
    averageResponseTime?: number;
    engagementLevel?: 'low' | 'medium' | 'high';
  };
}

export interface ProcessingResult {
  success: boolean;
  response?: string;
  question?: GeneratedQuestion;
  suggestions?: {
    tasks: string[];
    questions: string[];
    actions: string[];
  };
  adaptations?: {
    applied: boolean;
    changes: string[];
    confidence: number;
  };
  metadata: {
    processingTime: number;
    componentsUsed: string[];
    confidence: number;
    requestId: string;
    timestamp: string;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface InteractionSession {
  sessionId: string;
  userId: string;
  platform: ProcessingContext['platform'];
  startTime: string;
  lastActivity: string;
  messageCount: number;
  conversationHistory: ConversationMessage[];
  userState: {
    mood?: 'positive' | 'negative' | 'neutral' | 'mixed';
    engagement: 'low' | 'medium' | 'high';
    topics: string[];
    goals: string[];
    challenges: string[];
  };
  sessionMetrics: {
    averageResponseTime: number;
    totalProcessingTime: number;
    errorCount: number;
    adaptationCount: number;
  };
}

export class CoreProcessor {
  private googleAI: GoogleAIService;
  private database: DatabaseService;
  private promptEngine: PromptEngine;
  private adaptiveLearning: AdaptiveLearningEngine;
  
  // Session management
  private activeSessions: Map<string, InteractionSession> = new Map();
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  
  // Processing configuration
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_CONVERSATION_HISTORY = 50;
  private readonly ADAPTATION_FREQUENCY = 5; // Apply adaptations every 5 interactions

  constructor() {
    this.googleAI = new GoogleAIService();
    this.database = new DatabaseService();
    this.promptEngine = new PromptEngine();
    this.adaptiveLearning = new AdaptiveLearningEngine();
  }

  /**
   * Main processing entry point
   */
  async processRequest(request: ProcessingRequest): Promise<ProcessingResult> {
    const timerId = performanceMonitor.startTimer('core_processing');
    const requestId = this.generateRequestId();
    
    try {
      // Validate request
      this.validateRequest(request);
      
      // Get or create session
      const session = await this.getOrCreateSession(request);
      
      // Process based on request type
      let result: ProcessingResult;
      
      switch (request.requestType) {
        case 'daily_checkin':
          result = await this.processDailyCheckin(request, session);
          break;
          
        case 'generate_question':
          result = await this.processQuestionGeneration(request, session);
          break;
          
        case 'process_response':
          result = await this.processUserResponse(request, session);
          break;
          
        case 'task_analysis':
          result = await this.processTaskAnalysis(request, session);
          break;
          
        case 'goal_setting':
          result = await this.processGoalSetting(request, session);
          break;
          
        case 'reflection_prompt':
          result = await this.processReflectionPrompt(request, session);
          break;
          
        case 'summary_generation':
          result = await this.processSummaryGeneration(request, session);
          break;
          
        case 'proactive_engagement':
          result = await this.processProactiveEngagement(request, session);
          break;
          
        default:
          throw createValidationError(`Unsupported request type: ${request.requestType}`);
      }
      
      // Update session
      await this.updateSession(session, request, result);
      
      // Apply adaptive learning
      if (session.messageCount % this.ADAPTATION_FREQUENCY === 0) {
        await this.applyAdaptiveLearning(request.userId, session);
      }
      
      // Add processing metadata
      result.metadata = {
        ...result.metadata,
        processingTime: performanceMonitor.endTimer(timerId),
        requestId,
        timestamp: new Date().toISOString(),
      };
      
      // Log successful processing
      await this.logProcessingEvent(request, result, null);
      
      return result;
      
    } catch (error) {
      const processingTime = performanceMonitor.endTimer(timerId);
      
      // Handle error
      const processedError = error instanceof FylgjaError ? error : 
        createAIServiceError(`Core processing failed: ${error.message}`);
      
      const errorResult: ProcessingResult = {
        success: false,
        metadata: {
          processingTime,
          componentsUsed: ['core_processor'],
          confidence: 0,
          requestId,
          timestamp: new Date().toISOString(),
        },
        error: {
          code: processedError.code,
          message: processedError.userMessage,
          retryable: processedError.retryable,
        },
      };
      
      // Log error
      await this.logProcessingEvent(request, errorResult, processedError);
      
      return errorResult;
    }
  }

  /**
   * Process daily check-in request
   */
  private async processDailyCheckin(
    request: ProcessingRequest, 
    session: InteractionSession
  ): Promise<ProcessingResult> {
    const componentsUsed = ['prompt_engine'];
    
    // Generate personalized question
    const promptContext = this.buildPromptContext(request, session);
    const question = await this.promptEngine.generateQuestion(promptContext);
    
    // Track question generation
    performanceMonitor.incrementCounter('questions_generated', 1, {
      category: question.category,
      depth: question.depth,
    });
    
    return {
      success: true,
      question,
      metadata: {
        processingTime: 0, // Will be set by caller
        componentsUsed,
        confidence: 0.9,
        requestId: '', // Will be set by caller
        timestamp: '', // Will be set by caller
      },
    };
  }

  /**
   * Process question generation request
   */
  private async processQuestionGeneration(
    request: ProcessingRequest, 
    session: InteractionSession
  ): Promise<ProcessingResult> {
    const componentsUsed = ['prompt_engine'];
    
    const promptContext = this.buildPromptContext(request, session);
    const question = await this.promptEngine.generateQuestion(promptContext);
    
    return {
      success: true,
      question,
      metadata: {
        processingTime: 0,
        componentsUsed,
        confidence: 0.85,
        requestId: '',
        timestamp: '',
      },
    };
  }

  /**
   * Process user response
   */
  private async processUserResponse(
    request: ProcessingRequest, 
    session: InteractionSession
  ): Promise<ProcessingResult> {
    if (!request.input) {
      throw createValidationError('User input is required for response processing');
    }
    
    const componentsUsed = ['google_ai', 'adaptive_learning', 'database'];
    
    // Build AI request
    const aiRequest: AIRequest = {
      userId: request.userId,
      prompt: request.input,
      requestType: 'response_generation',
      conversationHistory: session.conversationHistory,
      context: this.buildAIContext(request, session),
      preferences: request.preferences,
    };
    
    // Process with Google AI
    const aiResponse = await this.googleAI.processRequest(aiRequest);
    componentsUsed.push('google_ai');
    
    // Analyze response for learning
    const lastQuestion = this.getLastQuestion(session);
    if (lastQuestion) {
      await this.adaptiveLearning.analyzeUserResponse(
        request.userId,
        request.input,
        lastQuestion,
        Date.now() - new Date(session.lastActivity).getTime(),
        { questionCategory: 'general' }
      );
      componentsUsed.push('adaptive_learning');
    }
    
    // Store interaction
    await this.storeInteraction(request.userId, request.input, aiResponse.response);
    componentsUsed.push('database');
    
    return {
      success: true,
      response: aiResponse.response,
      suggestions: aiResponse.suggestions ? {
        tasks: aiResponse.suggestions.tasks.map(t => t.title),
        questions: aiResponse.suggestions.questions.map(q => q.question),
        actions: aiResponse.suggestions.actions.map(a => a.action),
      } : undefined,
      metadata: {
        processingTime: 0,
        componentsUsed,
        confidence: aiResponse.confidence,
        requestId: '',
        timestamp: '',
      },
    };
  }

  /**
   * Process task analysis request
   */
  private async processTaskAnalysis(
    request: ProcessingRequest, 
    session: InteractionSession
  ): Promise<ProcessingResult> {
    if (!request.input) {
      throw createValidationError('Task description is required for analysis');
    }
    
    const componentsUsed = ['google_ai'];
    
    const aiRequest: AIRequest = {
      userId: request.userId,
      prompt: request.input,
      requestType: 'task_analysis',
      context: 'Analyze this task and provide breakdown, priorities, and suggestions',
      preferences: request.preferences,
    };
    
    const aiResponse = await this.googleAI.processRequest(aiRequest);
    
    return {
      success: true,
      response: aiResponse.response,
      suggestions: aiResponse.suggestions ? {
        tasks: aiResponse.suggestions.tasks.map(t => t.title),
        questions: aiResponse.suggestions.questions.map(q => q.question),
        actions: aiResponse.suggestions.actions.map(a => a.action),
      } : undefined,
      metadata: {
        processingTime: 0,
        componentsUsed,
        confidence: aiResponse.confidence,
        requestId: '',
        timestamp: '',
      },
    };
  }

  /**
   * Process goal setting request
   */
  private async processGoalSetting(
    request: ProcessingRequest, 
    session: InteractionSession
  ): Promise<ProcessingResult> {
    const componentsUsed = ['google_ai', 'prompt_engine'];
    
    let response: string;
    let suggestions: any;
    
    if (request.input) {
      // Process existing goal input
      const aiRequest: AIRequest = {
        userId: request.userId,
        prompt: request.input,
        requestType: 'goal_setting',
        context: 'Help refine and structure this goal',
        preferences: request.preferences,
      };
      
      const aiResponse = await this.googleAI.processRequest(aiRequest);
      response = aiResponse.response;
      suggestions = aiResponse.suggestions;
    } else {
      // Generate goal-setting question
      const promptContext = this.buildPromptContext(request, session);
      promptContext.userMood = 'positive'; // Goal setting works better with positive framing
      
      const question = await this.promptEngine.generateQuestion(promptContext);
      response = question.question;
    }
    
    return {
      success: true,
      response,
      suggestions: suggestions ? {
        tasks: suggestions.tasks?.map((t: any) => t.title) || [],
        questions: suggestions.questions?.map((q: any) => q.question) || [],
        actions: suggestions.actions?.map((a: any) => a.action) || [],
      } : undefined,
      metadata: {
        processingTime: 0,
        componentsUsed,
        confidence: 0.8,
        requestId: '',
        timestamp: '',
      },
    };
  }

  /**
   * Process reflection prompt request
   */
  private async processReflectionPrompt(
    request: ProcessingRequest, 
    session: InteractionSession
  ): Promise<ProcessingResult> {
    const componentsUsed = ['prompt_engine'];
    
    const promptContext = this.buildPromptContext(request, session);
    promptContext.userMood = 'reflective';
    
    // Force deeper questions for reflection
    const question = await this.promptEngine.generateQuestion(promptContext);
    
    return {
      success: true,
      question,
      response: question.question,
      metadata: {
        processingTime: 0,
        componentsUsed,
        confidence: 0.85,
        requestId: '',
        timestamp: '',
      },
    };
  }

  /**
   * Process summary generation request
   */
  private async processSummaryGeneration(
    request: ProcessingRequest, 
    session: InteractionSession
  ): Promise<ProcessingResult> {
    const componentsUsed = ['google_ai', 'database'];
    
    // Get recent interactions for summary
    const recentInteractions = await this.database.getRecentInteractions(request.userId, 10);
    
    if (recentInteractions.length === 0) {
      return {
        success: true,
        response: "I don't have enough recent interactions to create a meaningful summary. Let's have a few more conversations first!",
        metadata: {
          processingTime: 0,
          componentsUsed: ['database'],
          confidence: 1.0,
          requestId: '',
          timestamp: '',
        },
      };
    }
    
    // Build summary context
    const interactionSummary = recentInteractions
      .map(interaction => `${interaction.timestamp}: ${interaction.userMessage} -> ${interaction.aiResponse}`)
      .join('\n');
    
    const aiRequest: AIRequest = {
      userId: request.userId,
      prompt: `Please create a thoughtful summary of our recent conversations and interactions.`,
      requestType: 'response_generation',
      context: `Recent interactions:\n${interactionSummary}`,
      preferences: request.preferences,
    };
    
    const aiResponse = await this.googleAI.processRequest(aiRequest);
    
    return {
      success: true,
      response: aiResponse.response,
      metadata: {
        processingTime: 0,
        componentsUsed,
        confidence: aiResponse.confidence,
        requestId: '',
        timestamp: '',
      },
    };
  }

  /**
   * Process proactive engagement request
   */
  private async processProactiveEngagement(
    request: ProcessingRequest, 
    session: InteractionSession
  ): Promise<ProcessingResult> {
    const componentsUsed = ['database', 'prompt_engine', 'google_ai'];
    
    // Check user's recent activity and engagement
    const userProfile = await this.database.getUserProfile(request.userId);
    const recentInteractions = await this.database.getRecentInteractions(request.userId, 5);
    
    // Determine engagement strategy
    const engagementStrategy = this.determineEngagementStrategy(userProfile, recentInteractions);
    
    let response: string;
    
    switch (engagementStrategy) {
      case 'check_in':
        const promptContext = this.buildPromptContext(request, session);
        const question = await this.promptEngine.generateQuestion(promptContext);
        response = `Hi! ${question.question}`;
        break;
        
      case 'follow_up':
        const lastInteraction = recentInteractions[0];
        const aiRequest: AIRequest = {
          userId: request.userId,
          prompt: `Create a thoughtful follow-up based on our last conversation.`,
          requestType: 'response_generation',
          context: `Last interaction: ${lastInteraction?.userMessage} -> ${lastInteraction?.aiResponse}`,
          preferences: request.preferences,
        };
        const aiResponse = await this.googleAI.processRequest(aiRequest);
        response = aiResponse.response;
        break;
        
      case 'encouragement':
        response = "I've been thinking about our conversations and wanted to check in. How are you doing today?";
        break;
        
      default:
        response = "Hello! I hope you're having a good day. What's on your mind?";
    }
    
    return {
      success: true,
      response,
      metadata: {
        processingTime: 0,
        componentsUsed,
        confidence: 0.75,
        requestId: '',
        timestamp: '',
      },
    };
  }

  /**
   * Get or create interaction session
   */
  private async getOrCreateSession(request: ProcessingRequest): Promise<InteractionSession> {
    const sessionKey = `${request.userId}_${request.context?.platform || 'api'}`;
    
    // Check for existing session
    if (this.activeSessions.has(sessionKey)) {
      const session = this.activeSessions.get(sessionKey)!;
      
      // Reset timeout
      this.resetSessionTimeout(sessionKey);
      
      return session;
    }
    
    // Create new session
    const session: InteractionSession = {
      sessionId: request.context?.sessionId || this.generateSessionId(),
      userId: request.userId,
      platform: request.context?.platform || 'api',
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      messageCount: 0,
      conversationHistory: request.context?.conversationHistory || [],
      userState: {
        engagement: 'medium',
        topics: [],
        goals: [],
        challenges: [],
      },
      sessionMetrics: {
        averageResponseTime: 0,
        totalProcessingTime: 0,
        errorCount: 0,
        adaptationCount: 0,
      },
    };
    
    this.activeSessions.set(sessionKey, session);
    this.resetSessionTimeout(sessionKey);
    
    return session;
  }

  /**
   * Update session after processing
   */
  private async updateSession(
    session: InteractionSession, 
    request: ProcessingRequest, 
    result: ProcessingResult
  ): Promise<void> {
    session.lastActivity = new Date().toISOString();
    session.messageCount++;
    session.sessionMetrics.totalProcessingTime += result.metadata.processingTime;
    
    if (!result.success) {
      session.sessionMetrics.errorCount++;
    }
    
    // Update conversation history
    if (request.input) {
      session.conversationHistory.push({
        role: 'user',
        content: request.input,
        timestamp: new Date().toISOString(),
      });
    }
    
    if (result.response) {
      session.conversationHistory.push({
        role: 'assistant',
        content: result.response,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Limit conversation history
    if (session.conversationHistory.length > this.MAX_CONVERSATION_HISTORY) {
      session.conversationHistory = session.conversationHistory.slice(-this.MAX_CONVERSATION_HISTORY);
    }
    
    // Update user state based on interaction
    await this.updateUserState(session, request, result);
  }

  /**
   * Apply adaptive learning
   */
  private async applyAdaptiveLearning(userId: string, session: InteractionSession): Promise<void> {
    try {
      const recommendations = await this.adaptiveLearning.getAdaptationRecommendations(userId);
      
      if (recommendations.length > 0) {
        // Apply high-confidence recommendations
        const highConfidenceRecs = recommendations.filter(rec => rec.confidence >= 0.8);
        
        if (highConfidenceRecs.length > 0) {
          session.sessionMetrics.adaptationCount += highConfidenceRecs.length;
          
          // Log adaptations
          performanceMonitor.incrementCounter('adaptations_applied', highConfidenceRecs.length, {
            userId,
            sessionId: session.sessionId,
          });
        }
      }
    } catch (error) {
      console.warn('Failed to apply adaptive learning:', error);
    }
  }

  /**
   * Helper methods
   */
  private validateRequest(request: ProcessingRequest): void {
    if (!request.userId) {
      throw createValidationError('User ID is required');
    }
    
    if (!request.requestType) {
      throw createValidationError('Request type is required');
    }
    
    // Validate input for requests that require it
    const inputRequiredTypes: ProcessingRequestType[] = ['process_response', 'task_analysis'];
    if (inputRequiredTypes.includes(request.requestType) && !request.input) {
      throw createValidationError(`Input is required for ${request.requestType} requests`);
    }
  }

  private buildPromptContext(request: ProcessingRequest, session: InteractionSession): PromptContext {
    const now = new Date();
    const timeOfDay = this.getTimeOfDay(now);
    
    return {
      userId: request.userId,
      timeOfDay,
      dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
      recentInteractions: session.conversationHistory.slice(-5),
      userMood: session.userState.mood,
      currentGoals: session.userState.goals,
      challenges: session.userState.challenges,
      preferences: request.preferences || {
        responseLength: 'medium',
        tone: 'friendly',
        includeQuestions: true,
        includeSuggestions: true,
        focusAreas: [],
        avoidTopics: [],
        languageStyle: 'moderate',
      },
    };
  }

  private buildAIContext(request: ProcessingRequest, session: InteractionSession): string {
    const context = [
      `Platform: ${session.platform}`,
      `Session duration: ${this.getSessionDuration(session)}`,
      `Message count: ${session.messageCount}`,
      `User engagement: ${session.userState.engagement}`,
    ];
    
    if (session.userState.topics.length > 0) {
      context.push(`Recent topics: ${session.userState.topics.join(', ')}`);
    }
    
    if (session.userState.goals.length > 0) {
      context.push(`Current goals: ${session.userState.goals.join(', ')}`);
    }
    
    return context.join('\n');
  }

  private getTimeOfDay(date: Date): 'morning' | 'afternoon' | 'evening' {
    const hour = date.getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }

  private getSessionDuration(session: InteractionSession): string {
    const start = new Date(session.startTime);
    const now = new Date();
    const duration = now.getTime() - start.getTime();
    const minutes = Math.floor(duration / 60000);
    return `${minutes} minutes`;
  }

  private getLastQuestion(session: InteractionSession): string | null {
    for (let i = session.conversationHistory.length - 1; i >= 0; i--) {
      const message = session.conversationHistory[i];
      if (message.role === 'assistant' && message.content.includes('?')) {
        return message.content;
      }
    }
    return null;
  }

  private determineEngagementStrategy(userProfile: any, recentInteractions: any[]): string {
    if (recentInteractions.length === 0) return 'check_in';
    
    const lastInteraction = recentInteractions[0];
    const timeSinceLastInteraction = Date.now() - new Date(lastInteraction.timestamp).getTime();
    
    // If it's been more than 24 hours, do a check-in
    if (timeSinceLastInteraction > 24 * 60 * 60 * 1000) {
      return 'check_in';
    }
    
    // If recent interactions show low engagement, try encouragement
    const avgEngagement = recentInteractions.reduce((sum, interaction) => {
      return sum + (interaction.userMessage?.length || 0);
    }, 0) / recentInteractions.length;
    
    if (avgEngagement < 50) {
      return 'encouragement';
    }
    
    return 'follow_up';
  }

  private async updateUserState(
    session: InteractionSession, 
    request: ProcessingRequest, 
    result: ProcessingResult
  ): Promise<void> {
    // Simple engagement calculation based on response length and success
    if (request.input) {
      const responseLength = request.input.length;
      if (responseLength > 100) {
        session.userState.engagement = 'high';
      } else if (responseLength > 30) {
        session.userState.engagement = 'medium';
      } else {
        session.userState.engagement = 'low';
      }
    }
    
    // Update topics based on suggestions
    if (result.suggestions?.tasks) {
      // Extract topics from tasks (simplified)
      const topics = result.suggestions.tasks
        .map(task => task.toLowerCase())
        .filter(task => task.includes('work') || task.includes('health') || task.includes('learning'))
        .slice(0, 3);
      
      session.userState.topics = [...new Set([...session.userState.topics, ...topics])].slice(-5);
    }
  }

  private async storeInteraction(userId: string, userMessage: string, aiResponse: string): Promise<void> {
    try {
      await this.database.saveInteraction({
        userId,
        userMessage,
        aiResponse,
        timestamp: new Date().toISOString(),
        platform: 'core_processor',
        metadata: {
          processingVersion: '1.0',
        },
      });
    } catch (error) {
      console.warn('Failed to store interaction:', error);
    }
  }

  private async logProcessingEvent(
    request: ProcessingRequest, 
    result: ProcessingResult, 
    error: FylgjaError | null
  ): Promise<void> {
    try {
      await this.database.logError({
        type: 'processing_event',
        severity: error ? 'error' : 'info',
        message: error ? error.message : 'Processing completed successfully',
        metadata: {
          requestType: request.requestType,
          userId: request.userId,
          success: result.success,
          processingTime: result.metadata.processingTime,
          componentsUsed: result.metadata.componentsUsed,
          confidence: result.metadata.confidence,
        },
      });
    } catch (logError) {
      console.error('Failed to log processing event:', logError);
    }
  }

  private resetSessionTimeout(sessionKey: string): void {
    // Clear existing timeout
    const existingTimeout = this.sessionTimeouts.get(sessionKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set new timeout
    const timeout = setTimeout(() => {
      this.activeSessions.delete(sessionKey);
      this.sessionTimeouts.delete(sessionKey);
    }, this.SESSION_TIMEOUT);
    
    this.sessionTimeouts.set(sessionKey, timeout);
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Public methods for session management
   */
  public getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  public getSessionInfo(userId: string, platform: string): InteractionSession | null {
    const sessionKey = `${userId}_${platform}`;
    return this.activeSessions.get(sessionKey) || null;
  }

  public async endSession(userId: string, platform: string): Promise<void> {
    const sessionKey = `${userId}_${platform}`;
    
    // Clear timeout
    const timeout = this.sessionTimeouts.get(sessionKey);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(sessionKey);
    }
    
    // Remove session
    this.activeSessions.delete(sessionKey);
  }

  /**
   * Health check method
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    components: Record<string, 'healthy' | 'unhealthy'>;
    metrics: {
      activeSessions: number;
      totalProcessingTime: number;
      errorRate: number;
    };
  }> {
    const components: Record<string, 'healthy' | 'unhealthy'> = {};
    
    // Check Google AI service
    try {
      await this.googleAI.getOverallMetrics();
      components.googleAI = 'healthy';
    } catch {
      components.googleAI = 'unhealthy';
    }
    
    // Check database service
    try {
      await this.database.healthCheck();
      components.database = 'healthy';
    } catch {
      components.database = 'unhealthy';
    }
    
    // Check other components
    components.promptEngine = 'healthy'; // No async operations to check
    components.adaptiveLearning = 'healthy'; // No async operations to check
    
    const unhealthyCount = Object.values(components).filter(status => status === 'unhealthy').length;
    const status = unhealthyCount === 0 ? 'healthy' : 
                  unhealthyCount <= 1 ? 'degraded' : 'unhealthy';
    
    return {
      status,
      components,
      metrics: {
        activeSessions: this.activeSessions.size,
        totalProcessingTime: 0, // Would calculate from metrics
        errorRate: 0, // Would calculate from metrics
      },
    };
  }
}

// Global core processor instance
export const coreProcessor = new CoreProcessor();

