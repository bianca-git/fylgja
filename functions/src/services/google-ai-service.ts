/**
 * Google AI Service for Fylgja
 * Handles all interactions with Google's Gemini AI API
 * Includes error handling, rate limiting, and usage monitoring
 */

import { performance } from 'perf_hooks';

import { GoogleGenerativeAI, GenerativeModel, GenerationConfig } from '@google/generative-ai';

import { DatabaseService } from './database-service';

interface AIRequest {
  userId: string;
  prompt: string;
  context?: string;
  conversationHistory?: ConversationMessage[];
  requestType: 'checkin' | 'task_analysis' | 'response_generation' | 'sentiment_analysis';
  metadata?: Record<string, any>;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface AIResponse {
  response: string;
  confidence: number;
  processingTime: number;
  tokensUsed: number;
  sentiment?: {
    sentiment: 'positive' | 'negative' | 'neutral';
    confidence: number;
    emotions: string[];
  };
  suggestions?: {
    tasks: string[];
    questions: string[];
    actions: string[];
  };
  metadata: {
    model: string;
    requestId: string;
    timestamp: string;
    userId: string;
  };
}

interface UsageMetrics {
  requestCount: number;
  totalTokens: number;
  averageResponseTime: number;
  errorRate: number;
  lastReset: string;
}

export class GoogleAIService {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private dbService: DatabaseService;
  private usageMetrics: Map<string, UsageMetrics> = new Map();
  private rateLimiter: Map<string, number[]> = new Map();

  // Configuration
  private readonly MAX_REQUESTS_PER_MINUTE = 60;
  private readonly MAX_TOKENS_PER_REQUEST = 8192;
  private readonly DEFAULT_TEMPERATURE = 0.7;
  private readonly DEFAULT_TOP_P = 0.8;
  private readonly DEFAULT_TOP_K = 40;

  constructor() {
    const apiKey = process.env.GOOGLE_GEMINI_APIKEY;
    if (!apiKey) {
      throw new Error('GOOGLE_GEMINI_APIKEY environment variable is required');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: this.getDefaultGenerationConfig(),
    });
    this.dbService = new DatabaseService();
  }

  /**
   * Main method to process AI requests
   */
  async processRequest(request: AIRequest): Promise<AIResponse> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      // Validate request
      this.validateRequest(request);

      // Check rate limits
      await this.checkRateLimit(request.userId);

      // Build prompt based on request type
      const enhancedPrompt = await this.buildPrompt(request);

      // Generate AI response
      const result = await this.model.generateContent(enhancedPrompt);
      const response = result.response;
      const text = response.text();

      // Process and analyze response
      const processedResponse = await this.processResponse(text, request);

      // Calculate metrics
      const processingTime = performance.now() - startTime;
      const tokensUsed = this.estimateTokens(enhancedPrompt + text);

      // Update usage metrics
      this.updateUsageMetrics(request.userId, tokensUsed, processingTime, false);

      // Build final response
      const aiResponse: AIResponse = {
        response: processedResponse.response,
        confidence: processedResponse.confidence,
        processingTime,
        tokensUsed,
        sentiment: processedResponse.sentiment,
        suggestions: processedResponse.suggestions,
        metadata: {
          model: 'gemini-1.5-flash',
          requestId,
          timestamp: new Date().toISOString(),
          userId: request.userId,
        },
      };

      // Log successful request
      await this.logRequest(request, aiResponse, null);

      return aiResponse;
    } catch (error) {
      const processingTime = performance.now() - startTime;

      // Update error metrics
      this.updateUsageMetrics(request.userId, 0, processingTime, true);

      // Log error
      await this.logRequest(request, null, error as Error);

      // Handle different types of errors
      if (error.message?.includes('quota')) {
        throw new Error('AI service quota exceeded. Please try again later.');
      } else if (error.message?.includes('rate limit')) {
        throw new Error('Too many requests. Please wait before trying again.');
      } else {
        throw new Error(`AI processing failed: ${error.message}`);
      }
    }
  }

  /**
   * Build context-aware prompts based on request type
   */
  private async buildPrompt(request: AIRequest): Promise<string> {
    const { userId, prompt, context, conversationHistory, requestType } = request;

    // Get user profile for personalization
    const userProfile = await this.dbService.getUserProfile(userId);
    const recentInteractions = await this.dbService.getRecentInteractions(userId, 5);

    let systemPrompt = '';
    let userContext = '';

    switch (requestType) {
      case 'checkin':
        systemPrompt = this.getCheckinSystemPrompt();
        userContext = this.buildUserContext(userProfile, recentInteractions);
        break;

      case 'task_analysis':
        systemPrompt = this.getTaskAnalysisSystemPrompt();
        userContext = this.buildTaskContext(userProfile);
        break;

      case 'response_generation':
        systemPrompt = this.getResponseGenerationSystemPrompt();
        userContext = this.buildConversationContext(conversationHistory);
        break;

      case 'sentiment_analysis':
        systemPrompt = this.getSentimentAnalysisSystemPrompt();
        break;

      default:
        systemPrompt = this.getDefaultSystemPrompt();
    }

    // Build conversation history
    const historyContext = conversationHistory
      ? this.formatConversationHistory(conversationHistory)
      : '';

    // Combine all context
    const fullPrompt = `${systemPrompt}

${userContext}

${historyContext}

${context ? `Additional Context: ${context}` : ''}

User Message: ${prompt}

Please respond as Fylgja, keeping in mind the user's communication style and preferences.`;

    return fullPrompt;
  }

  /**
   * Process and analyze AI response
   */
  private async processResponse(
    text: string,
    request: AIRequest
  ): Promise<{
    response: string;
    confidence: number;
    sentiment?: any;
    suggestions?: any;
  }> {
    // Basic response processing
    let processedText = text.trim();

    // Remove any unwanted formatting
    processedText = processedText.replace(/^\*\*|\*\*$/g, '');

    // Calculate confidence based on response characteristics
    const confidence = this.calculateConfidence(processedText, request);

    // Extract sentiment if this is a checkin
    let sentiment;
    if (request.requestType === 'checkin') {
      sentiment = await this.extractSentiment(request.prompt);
    }

    // Generate suggestions based on response type
    let suggestions;
    if (request.requestType === 'checkin' || request.requestType === 'task_analysis') {
      suggestions = this.extractSuggestions(processedText, request);
    }

    return {
      response: processedText,
      confidence,
      sentiment,
      suggestions,
    };
  }

  /**
   * Extract sentiment from user message
   */
  private async extractSentiment(userMessage: string): Promise<{
    sentiment: 'positive' | 'negative' | 'neutral';
    confidence: number;
    emotions: string[];
  }> {
    try {
      const sentimentPrompt = `Analyze the sentiment and emotions in this message. Respond with JSON only:

Message: "${userMessage}"

Required JSON format:
{
  "sentiment": "positive|negative|neutral",
  "confidence": 0.0-1.0,
  "emotions": ["emotion1", "emotion2"]
}`;

      const result = await this.model.generateContent(sentimentPrompt);
      const response = result.response.text();

      // Parse JSON response
      const sentimentData = JSON.parse(response.replace(/```json|```/g, ''));

      return {
        sentiment: sentimentData.sentiment || 'neutral',
        confidence: sentimentData.confidence || 0.5,
        emotions: sentimentData.emotions || [],
      };
    } catch (error) {
      console.warn('Sentiment analysis failed:', error);
      return {
        sentiment: 'neutral',
        confidence: 0.5,
        emotions: [],
      };
    }
  }

  /**
   * Extract actionable suggestions from response
   */
  private extractSuggestions(
    response: string,
    request: AIRequest
  ): {
    tasks: string[];
    questions: string[];
    actions: string[];
  } {
    const suggestions = {
      tasks: [],
      questions: [],
      actions: [],
    };

    // Simple extraction logic (can be enhanced with more AI processing)
    const lines = response.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.includes('task') || trimmed.includes('todo') || trimmed.includes('do')) {
        suggestions.tasks.push(trimmed);
      } else if (trimmed.includes('?')) {
        suggestions.questions.push(trimmed);
      } else if (
        trimmed.includes('try') ||
        trimmed.includes('consider') ||
        trimmed.includes('might')
      ) {
        suggestions.actions.push(trimmed);
      }
    }

    return suggestions;
  }

  /**
   * Calculate response confidence based on various factors
   */
  private calculateConfidence(response: string, request: AIRequest): number {
    let confidence = 0.8; // Base confidence

    // Adjust based on response length
    if (response.length < 50) {
      confidence -= 0.1;
    }
    if (response.length > 500) {
      confidence += 0.1;
    }

    // Adjust based on request type
    if (request.requestType === 'sentiment_analysis') {
      confidence += 0.1;
    }
    if (request.requestType === 'checkin') {
      confidence += 0.05;
    }

    // Adjust based on context availability
    if (request.context) {
      confidence += 0.05;
    }
    if (request.conversationHistory?.length > 0) {
      confidence += 0.05;
    }

    return Math.min(Math.max(confidence, 0.1), 1.0);
  }

  /**
   * System prompts for different request types
   */
  private getCheckinSystemPrompt(): string {
    return `You are Fylgja, a supportive AI companion inspired by Norse mythology. A fylgja is a guardian spirit that accompanies and protects individuals throughout their lives.

Your role is to:
- Provide empathetic and supportive responses to daily check-ins
- Help users reflect on their day and experiences
- Offer gentle guidance and encouragement
- Ask thoughtful follow-up questions when appropriate
- Maintain a warm, caring, but not overly familiar tone
- Remember and reference previous conversations when relevant

Communication style:
- Be genuine and authentic, not robotic
- Use natural, conversational language
- Show empathy and understanding
- Offer practical suggestions when helpful
- Respect the user's autonomy and choices`;
  }

  private getTaskAnalysisSystemPrompt(): string {
    return `You are Fylgja, analyzing tasks and helping with productivity and goal achievement.

Your role is to:
- Break down complex tasks into manageable steps
- Suggest priorities and time management strategies
- Identify potential obstacles and solutions
- Provide motivation and encouragement
- Help users stay organized and focused

Focus on being practical, supportive, and actionable in your suggestions.`;
  }

  private getResponseGenerationSystemPrompt(): string {
    return `You are Fylgja, continuing a conversation with a user. 

Maintain consistency with:
- Previous conversation context
- Your established personality and tone
- The user's communication preferences
- The ongoing relationship dynamic

Respond naturally as if this is part of an ongoing conversation.`;
  }

  private getSentimentAnalysisSystemPrompt(): string {
    return `You are an expert at analyzing emotional content and sentiment in text.

Analyze the user's message for:
- Overall sentiment (positive, negative, neutral)
- Specific emotions present
- Confidence level in your analysis
- Nuanced emotional states

Be accurate and nuanced in your analysis.`;
  }

  private getDefaultSystemPrompt(): string {
    return "You are Fylgja, a supportive AI companion. Respond helpfully and empathetically to the user's message.";
  }

  /**
   * Build user context from profile and history
   */
  private buildUserContext(userProfile: any, recentInteractions: any[]): string {
    if (!userProfile) {
      return '';
    }

    let context = `User Profile:
- Name: ${userProfile.name || 'User'}
- Communication Style: ${userProfile.communicationStyle || 'Not specified'}
- Preferences: ${userProfile.preferences ? JSON.stringify(userProfile.preferences) : 'None specified'}`;

    if (recentInteractions.length > 0) {
      context += '\n\nRecent Interaction Patterns:';
      recentInteractions.forEach((interaction, index) => {
        context += `\n${index + 1}. ${interaction.timestamp}: ${interaction.userMessage?.substring(0, 100)}...`;
      });
    }

    return context;
  }

  private buildTaskContext(userProfile: any): string {
    return `User's task management context:
- Productivity style: ${userProfile?.productivityStyle || 'Not specified'}
- Goal preferences: ${userProfile?.goalPreferences || 'Not specified'}
- Time management approach: ${userProfile?.timeManagement || 'Not specified'}`;
  }

  private buildConversationContext(history: ConversationMessage[]): string {
    if (!history || history.length === 0) {
      return '';
    }

    let context = 'Recent conversation:\n';
    history.slice(-5).forEach(msg => {
      context += `${msg.role}: ${msg.content}\n`;
    });

    return context;
  }

  private formatConversationHistory(history: ConversationMessage[]): string {
    return history.map(msg => `${msg.role}: ${msg.content}`).join('\n');
  }

  /**
   * Rate limiting and validation
   */
  private async checkRateLimit(userId: string): Promise<void> {
    const now = Date.now();
    const userRequests = this.rateLimiter.get(userId) || [];

    // Remove requests older than 1 minute
    const recentRequests = userRequests.filter(time => now - time < 60000);

    if (recentRequests.length >= this.MAX_REQUESTS_PER_MINUTE) {
      throw new Error('Rate limit exceeded. Please wait before making another request.');
    }

    recentRequests.push(now);
    this.rateLimiter.set(userId, recentRequests);
  }

  private validateRequest(request: AIRequest): void {
    if (!request.userId) {
      throw new Error('User ID is required');
    }
    if (!request.prompt || request.prompt.trim().length === 0) {
      throw new Error('Prompt is required');
    }
    if (request.prompt.length > this.MAX_TOKENS_PER_REQUEST) {
      throw new Error(
        `Prompt too long. Maximum ${this.MAX_TOKENS_PER_REQUEST} characters allowed.`
      );
    }
  }

  /**
   * Usage tracking and metrics
   */
  private updateUsageMetrics(
    userId: string,
    tokens: number,
    responseTime: number,
    isError: boolean
  ): void {
    const current = this.usageMetrics.get(userId) || {
      requestCount: 0,
      totalTokens: 0,
      averageResponseTime: 0,
      errorRate: 0,
      lastReset: new Date().toISOString(),
    };

    current.requestCount++;
    current.totalTokens += tokens;
    current.averageResponseTime =
      (current.averageResponseTime * (current.requestCount - 1) + responseTime) /
      current.requestCount;

    if (isError) {
      current.errorRate =
        (current.errorRate * (current.requestCount - 1) + 1) / current.requestCount;
    } else {
      current.errorRate = (current.errorRate * (current.requestCount - 1)) / current.requestCount;
    }

    this.usageMetrics.set(userId, current);
  }

  /**
   * Logging and monitoring
   */
  private async logRequest(
    request: AIRequest,
    response: AIResponse | null,
    error: Error | null
  ): Promise<void> {
    try {
      const logData = {
        timestamp: new Date().toISOString(),
        userId: request.userId,
        requestType: request.requestType,
        success: !error,
        error: error?.message,
        processingTime: response?.processingTime || 0,
        tokensUsed: response?.tokensUsed || 0,
        confidence: response?.confidence || 0,
      };

      await this.dbService.logError({
        type: 'ai_request',
        severity: error ? 'error' : 'info',
        message: error?.message || 'AI request processed successfully',
        metadata: logData,
      });
    } catch (logError) {
      console.error('Failed to log AI request:', logError);
    }
  }

  /**
   * Utility methods
   */
  private generateRequestId(): string {
    return `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  private getDefaultGenerationConfig(): GenerationConfig {
    return {
      temperature: this.DEFAULT_TEMPERATURE,
      topP: this.DEFAULT_TOP_P,
      topK: this.DEFAULT_TOP_K,
      maxOutputTokens: 2048,
    };
  }

  /**
   * Public methods for metrics and management
   */
  public getUserMetrics(userId: string): UsageMetrics | null {
    return this.usageMetrics.get(userId) || null;
  }

  public clearUserMetrics(userId: string): void {
    this.usageMetrics.delete(userId);
    this.rateLimiter.delete(userId);
  }

  public getOverallMetrics(): {
    totalUsers: number;
    totalRequests: number;
    averageResponseTime: number;
    overallErrorRate: number;
  } {
    const metrics = Array.from(this.usageMetrics.values());

    return {
      totalUsers: metrics.length,
      totalRequests: metrics.reduce((sum, m) => sum + m.requestCount, 0),
      averageResponseTime:
        metrics.reduce((sum, m) => sum + m.averageResponseTime, 0) / metrics.length || 0,
      overallErrorRate: metrics.reduce((sum, m) => sum + m.errorRate, 0) / metrics.length || 0,
    };
  }
}
