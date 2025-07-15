/**
 * Adaptive Learning System for Fylgja
 * Learns from user behavior and adapts interaction patterns without explicit training
 */

import { DatabaseService } from '../services/database-service';
import { UserPersonalityProfile, PersonalityType, QuestionCategory, QuestionDepth } from './prompt-engine';

export interface LearningEvent {
  userId: string;
  timestamp: string;
  eventType: LearningEventType;
  data: Record<string, any>;
  confidence: number;
  source: 'interaction' | 'response_analysis' | 'timing_pattern' | 'engagement_metric';
}

export type LearningEventType = 
  | 'response_length_preference'
  | 'question_category_preference'
  | 'communication_style_shift'
  | 'engagement_pattern'
  | 'emotional_state_indicator'
  | 'topic_interest_change'
  | 'interaction_timing_preference'
  | 'depth_preference_change'
  | 'formality_preference'
  | 'follow_up_preference';

export interface UserBehaviorPattern {
  patternId: string;
  userId: string;
  patternType: BehaviorPatternType;
  description: string;
  frequency: number;
  confidence: number;
  firstObserved: string;
  lastObserved: string;
  strength: 'weak' | 'moderate' | 'strong';
  metadata: Record<string, any>;
}

export type BehaviorPatternType = 
  | 'response_timing'
  | 'message_length'
  | 'emotional_expression'
  | 'topic_engagement'
  | 'question_preference'
  | 'interaction_frequency'
  | 'communication_style'
  | 'goal_orientation';

export interface AdaptationRecommendation {
  userId: string;
  recommendationType: AdaptationType;
  currentValue: any;
  suggestedValue: any;
  confidence: number;
  reasoning: string;
  impact: 'low' | 'medium' | 'high';
  priority: number; // 1-10 scale
  validUntil: string;
}

export type AdaptationType = 
  | 'question_style'
  | 'response_tone'
  | 'interaction_frequency'
  | 'content_depth'
  | 'follow_up_behavior'
  | 'timing_adjustment'
  | 'topic_focus'
  | 'communication_formality';

export interface LearningInsight {
  userId: string;
  insightType: InsightType;
  title: string;
  description: string;
  confidence: number;
  actionable: boolean;
  suggestedActions: string[];
  supportingEvidence: LearningEvent[];
  createdAt: string;
}

export type InsightType = 
  | 'personality_shift'
  | 'engagement_decline'
  | 'new_interest_area'
  | 'communication_preference'
  | 'goal_alignment'
  | 'emotional_pattern'
  | 'productivity_pattern';

export class AdaptiveLearningEngine {
  private dbService: DatabaseService;
  private learningEvents: Map<string, LearningEvent[]> = new Map();
  private behaviorPatterns: Map<string, UserBehaviorPattern[]> = new Map();
  private adaptationRecommendations: Map<string, AdaptationRecommendation[]> = new Map();
  private learningInsights: Map<string, LearningInsight[]> = new Map();

  // Learning thresholds and parameters
  private readonly MIN_EVENTS_FOR_PATTERN = 3;
  private readonly PATTERN_CONFIDENCE_THRESHOLD = 0.6;
  private readonly ADAPTATION_CONFIDENCE_THRESHOLD = 0.7;
  private readonly MAX_EVENTS_PER_USER = 1000;
  private readonly LEARNING_DECAY_FACTOR = 0.95; // Events lose relevance over time

  constructor() {
    this.dbService = new DatabaseService();
  }

  /**
   * Record a learning event from user interaction
   */
  async recordLearningEvent(event: Omit<LearningEvent, 'timestamp'>): Promise<void> {
    const fullEvent: LearningEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    // Add to in-memory storage
    const userEvents = this.learningEvents.get(event.userId) || [];
    userEvents.push(fullEvent);

    // Limit events per user to prevent memory issues
    if (userEvents.length > this.MAX_EVENTS_PER_USER) {
      userEvents.shift(); // Remove oldest event
    }

    this.learningEvents.set(event.userId, userEvents);

    // Persist to database
    await this.persistLearningEvent(fullEvent);

    // Trigger pattern analysis
    await this.analyzePatterns(event.userId);

    // Generate recommendations if enough data
    if (userEvents.length >= this.MIN_EVENTS_FOR_PATTERN) {
      await this.generateAdaptationRecommendations(event.userId);
    }
  }

  /**
   * Analyze user response and extract learning signals
   */
  async analyzeUserResponse(
    userId: string,
    userMessage: string,
    questionAsked: string,
    responseTime: number,
    context: Record<string, any>
  ): Promise<void> {
    const analysis = this.performResponseAnalysis(userMessage, questionAsked, responseTime);

    // Generate learning events based on analysis
    const events = this.extractLearningEvents(userId, analysis, context);

    // Record all events
    for (const event of events) {
      await this.recordLearningEvent(event);
    }
  }

  /**
   * Get adaptation recommendations for a user
   */
  async getAdaptationRecommendations(userId: string): Promise<AdaptationRecommendation[]> {
    // Check cache first
    const cached = this.adaptationRecommendations.get(userId);
    if (cached) {
      // Filter out expired recommendations
      const valid = cached.filter(rec => new Date(rec.validUntil) > new Date());
      if (valid.length > 0) {
        return valid.sort((a, b) => b.priority - a.priority);
      }
    }

    // Generate fresh recommendations
    await this.generateAdaptationRecommendations(userId);
    return this.adaptationRecommendations.get(userId) || [];
  }

  /**
   * Apply adaptations to user personality profile
   */
  async applyAdaptations(
    userId: string, 
    profile: UserPersonalityProfile,
    recommendations: AdaptationRecommendation[]
  ): Promise<UserPersonalityProfile> {
    const updatedProfile = { ...profile };

    for (const rec of recommendations) {
      if (rec.confidence >= this.ADAPTATION_CONFIDENCE_THRESHOLD) {
        updatedProfile = this.applyAdaptation(updatedProfile, rec);
        
        // Record that we applied this adaptation
        await this.recordLearningEvent({
          userId,
          eventType: 'communication_style_shift',
          data: {
            adaptationType: rec.recommendationType,
            oldValue: rec.currentValue,
            newValue: rec.suggestedValue,
            confidence: rec.confidence,
          },
          confidence: rec.confidence,
          source: 'interaction',
        });
      }
    }

    return updatedProfile;
  }

  /**
   * Get learning insights for a user
   */
  async getLearningInsights(userId: string): Promise<LearningInsight[]> {
    const cached = this.learningInsights.get(userId);
    if (cached && cached.length > 0) {
      return cached.sort((a, b) => b.confidence - a.confidence);
    }

    // Generate fresh insights
    await this.generateLearningInsights(userId);
    return this.learningInsights.get(userId) || [];
  }

  /**
   * Perform detailed response analysis
   */
  private performResponseAnalysis(
    userMessage: string, 
    questionAsked: string, 
    responseTime: number
  ): ResponseAnalysis {
    const words = userMessage.split(/\s+/).filter(word => word.length > 0);
    const sentences = userMessage.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    return {
      length: {
        characters: userMessage.length,
        words: words.length,
        sentences: sentences.length,
        category: this.categorizeLength(words.length),
      },
      timing: {
        responseTime,
        category: this.categorizeResponseTime(responseTime),
      },
      linguistic: {
        complexity: this.assessComplexity(words),
        formality: this.assessFormality(userMessage),
        emotionalExpression: this.assessEmotionalExpression(userMessage),
        questionEngagement: this.assessQuestionEngagement(userMessage, questionAsked),
      },
      content: {
        topics: this.extractTopics(userMessage),
        sentiment: this.analyzeSentiment(userMessage),
        personalityIndicators: this.extractPersonalityIndicators(userMessage),
      },
    };
  }

  /**
   * Extract learning events from response analysis
   */
  private extractLearningEvents(
    userId: string,
    analysis: ResponseAnalysis,
    context: Record<string, any>
  ): Omit<LearningEvent, 'timestamp'>[] {
    const events: Omit<LearningEvent, 'timestamp'>[] = [];

    // Response length preference
    events.push({
      userId,
      eventType: 'response_length_preference',
      data: {
        length: analysis.length.words,
        category: analysis.length.category,
        questionType: context.questionCategory,
      },
      confidence: 0.8,
      source: 'response_analysis',
    });

    // Communication style indicators
    if (analysis.linguistic.formality !== 0.5) { // Not neutral
      events.push({
        userId,
        eventType: 'formality_preference',
        data: {
          formality: analysis.linguistic.formality,
          context: context.questionCategory,
        },
        confidence: Math.abs(analysis.linguistic.formality - 0.5) * 2, // Convert to 0-1 scale
        source: 'response_analysis',
      });
    }

    // Emotional expression patterns
    if (analysis.linguistic.emotionalExpression > 0.6) {
      events.push({
        userId,
        eventType: 'emotional_state_indicator',
        data: {
          expressiveness: analysis.linguistic.emotionalExpression,
          sentiment: analysis.content.sentiment,
        },
        confidence: 0.7,
        source: 'response_analysis',
      });
    }

    // Question engagement level
    events.push({
      userId,
      eventType: 'engagement_pattern',
      data: {
        engagement: analysis.linguistic.questionEngagement,
        responseTime: analysis.timing.responseTime,
        questionType: context.questionCategory,
      },
      confidence: 0.75,
      source: 'response_analysis',
    });

    // Topic interests
    if (analysis.content.topics.length > 0) {
      events.push({
        userId,
        eventType: 'topic_interest_change',
        data: {
          topics: analysis.content.topics,
          engagement: analysis.linguistic.questionEngagement,
        },
        confidence: 0.6,
        source: 'response_analysis',
      });
    }

    return events;
  }

  /**
   * Analyze patterns in user behavior
   */
  private async analyzePatterns(userId: string): Promise<void> {
    const events = this.learningEvents.get(userId) || [];
    if (events.length < this.MIN_EVENTS_FOR_PATTERN) return;

    const patterns: UserBehaviorPattern[] = [];

    // Analyze response timing patterns
    const timingPattern = this.analyzeTimingPattern(userId, events);
    if (timingPattern) patterns.push(timingPattern);

    // Analyze message length patterns
    const lengthPattern = this.analyzeLengthPattern(userId, events);
    if (lengthPattern) patterns.push(lengthPattern);

    // Analyze emotional expression patterns
    const emotionalPattern = this.analyzeEmotionalPattern(userId, events);
    if (emotionalPattern) patterns.push(emotionalPattern);

    // Analyze topic engagement patterns
    const topicPattern = this.analyzeTopicPattern(userId, events);
    if (topicPattern) patterns.push(topicPattern);

    // Store patterns
    this.behaviorPatterns.set(userId, patterns);

    // Persist patterns to database
    for (const pattern of patterns) {
      await this.persistBehaviorPattern(pattern);
    }
  }

  /**
   * Generate adaptation recommendations based on patterns
   */
  private async generateAdaptationRecommendations(userId: string): Promise<void> {
    const patterns = this.behaviorPatterns.get(userId) || [];
    const events = this.learningEvents.get(userId) || [];
    
    const recommendations: AdaptationRecommendation[] = [];

    // Analyze each pattern for adaptation opportunities
    for (const pattern of patterns) {
      const recs = this.generateRecommendationsFromPattern(userId, pattern, events);
      recommendations.push(...recs);
    }

    // Sort by priority and confidence
    recommendations.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.confidence - a.confidence;
    });

    // Keep only top recommendations
    const topRecommendations = recommendations.slice(0, 5);

    this.adaptationRecommendations.set(userId, topRecommendations);

    // Persist recommendations
    for (const rec of topRecommendations) {
      await this.persistAdaptationRecommendation(rec);
    }
  }

  /**
   * Generate learning insights
   */
  private async generateLearningInsights(userId: string): Promise<void> {
    const patterns = this.behaviorPatterns.get(userId) || [];
    const events = this.learningEvents.get(userId) || [];
    
    const insights: LearningInsight[] = [];

    // Generate insights from patterns
    for (const pattern of patterns) {
      const insight = this.generateInsightFromPattern(userId, pattern, events);
      if (insight) insights.push(insight);
    }

    // Generate insights from event trends
    const trendInsights = this.generateTrendInsights(userId, events);
    insights.push(...trendInsights);

    this.learningInsights.set(userId, insights);
  }

  /**
   * Apply a single adaptation to user profile
   */
  private applyAdaptation(
    profile: UserPersonalityProfile,
    recommendation: AdaptationRecommendation
  ): UserPersonalityProfile {
    const updated = { ...profile };

    switch (recommendation.recommendationType) {
      case 'question_style':
        if (recommendation.suggestedValue.depth) {
          updated.preferences.questionDepth = recommendation.suggestedValue.depth;
        }
        if (recommendation.suggestedValue.categories) {
          updated.preferences.favoriteCategories = recommendation.suggestedValue.categories;
        }
        break;

      case 'response_tone':
        if (recommendation.suggestedValue.formality !== undefined) {
          updated.traits.formality = recommendation.suggestedValue.formality;
        }
        if (recommendation.suggestedValue.emotionalExpression !== undefined) {
          updated.traits.emotionalExpression = recommendation.suggestedValue.emotionalExpression;
        }
        break;

      case 'content_depth':
        updated.preferences.questionDepth = recommendation.suggestedValue;
        break;

      case 'follow_up_behavior':
        updated.preferences.includeFollowUps = recommendation.suggestedValue;
        break;

      case 'communication_formality':
        updated.traits.formality = recommendation.suggestedValue;
        break;

      // Add more adaptation types as needed
    }

    // Update confidence and add to adaptation history
    updated.confidence = Math.min(1.0, updated.confidence + 0.05);
    updated.adaptationHistory.push({
      timestamp: new Date().toISOString(),
      trigger: recommendation.recommendationType,
      oldValue: recommendation.currentValue,
      newValue: recommendation.suggestedValue,
      confidence: recommendation.confidence,
    });

    return updated;
  }

  // Helper methods for analysis
  private categorizeLength(wordCount: number): 'short' | 'medium' | 'long' {
    if (wordCount < 10) return 'short';
    if (wordCount < 50) return 'medium';
    return 'long';
  }

  private categorizeResponseTime(ms: number): 'quick' | 'normal' | 'slow' {
    if (ms < 30000) return 'quick'; // < 30 seconds
    if (ms < 300000) return 'normal'; // < 5 minutes
    return 'slow';
  }

  private assessComplexity(words: string[]): number {
    // Simple complexity assessment based on word length and variety
    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    const uniqueWords = new Set(words).size;
    const complexity = (avgWordLength / 10) * 0.5 + (uniqueWords / words.length) * 0.5;
    return Math.min(1, complexity);
  }

  private assessFormality(message: string): number {
    const formalIndicators = [
      /\b(please|thank you|would|could|might|shall)\b/gi,
      /\b(furthermore|however|therefore|consequently)\b/gi,
      /[.!?]$/,
    ];
    
    const informalIndicators = [
      /\b(yeah|yep|nah|gonna|wanna|kinda)\b/gi,
      /[!]{2,}/,
      /😊|😄|😃|🙂/g,
    ];

    let formalScore = 0;
    let informalScore = 0;

    formalIndicators.forEach(pattern => {
      const matches = message.match(pattern);
      if (matches) formalScore += matches.length;
    });

    informalIndicators.forEach(pattern => {
      const matches = message.match(pattern);
      if (matches) informalScore += matches.length;
    });

    const total = formalScore + informalScore;
    if (total === 0) return 0.5; // Neutral

    return formalScore / total;
  }

  private assessEmotionalExpression(message: string): number {
    const emotionalIndicators = [
      /[!]{1,}/g,
      /😊|😄|😃|🙂|😢|😭|😡|😤|❤️|💕/g,
      /\b(love|hate|amazing|terrible|wonderful|awful|excited|sad|happy|angry)\b/gi,
    ];

    let emotionalScore = 0;
    emotionalIndicators.forEach(pattern => {
      const matches = message.match(pattern);
      if (matches) emotionalScore += matches.length;
    });

    // Normalize by message length
    return Math.min(1, emotionalScore / (message.split(' ').length / 10));
  }

  private assessQuestionEngagement(message: string, question: string): number {
    // Simple engagement assessment based on response relevance and length
    const messageWords = message.toLowerCase().split(/\s+/);
    const questionWords = question.toLowerCase().split(/\s+/);
    
    // Check for keyword overlap
    const overlap = messageWords.filter(word => 
      questionWords.includes(word) && word.length > 3
    ).length;
    
    const relevanceScore = overlap / Math.max(questionWords.length, 1);
    const lengthScore = Math.min(1, messageWords.length / 20); // Normalize to 20 words
    
    return (relevanceScore * 0.6 + lengthScore * 0.4);
  }

  private extractTopics(message: string): string[] {
    // Simple topic extraction - in production, would use NLP
    const topicKeywords = {
      work: ['work', 'job', 'career', 'office', 'meeting', 'project', 'task'],
      health: ['health', 'exercise', 'gym', 'run', 'walk', 'sleep', 'tired'],
      family: ['family', 'kids', 'children', 'spouse', 'parent', 'mom', 'dad'],
      learning: ['learn', 'study', 'read', 'book', 'course', 'skill', 'knowledge'],
      creativity: ['create', 'art', 'music', 'write', 'design', 'creative', 'idea'],
    };

    const topics: string[] = [];
    const lowerMessage = message.toLowerCase();

    Object.entries(topicKeywords).forEach(([topic, keywords]) => {
      if (keywords.some(keyword => lowerMessage.includes(keyword))) {
        topics.push(topic);
      }
    });

    return topics;
  }

  private analyzeSentiment(message: string): 'positive' | 'negative' | 'neutral' {
    // Simple sentiment analysis - in production, would use proper NLP
    const positiveWords = ['good', 'great', 'awesome', 'happy', 'love', 'excellent', 'wonderful'];
    const negativeWords = ['bad', 'terrible', 'hate', 'sad', 'awful', 'horrible', 'difficult'];

    const lowerMessage = message.toLowerCase();
    const positiveCount = positiveWords.filter(word => lowerMessage.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowerMessage.includes(word)).length;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  private extractPersonalityIndicators(message: string): PersonalityType[] {
    // Simple personality indicator extraction
    const indicators: Record<PersonalityType, string[]> = {
      analytical: ['analyze', 'data', 'logic', 'reason', 'think', 'process'],
      creative: ['create', 'imagine', 'art', 'design', 'innovative', 'original'],
      practical: ['practical', 'useful', 'efficient', 'simple', 'direct', 'concrete'],
      empathetic: ['feel', 'emotion', 'understand', 'care', 'support', 'help'],
      ambitious: ['goal', 'achieve', 'success', 'win', 'accomplish', 'target'],
      reflective: ['reflect', 'think', 'consider', 'ponder', 'contemplate', 'meditate'],
      social: ['people', 'friends', 'team', 'together', 'collaborate', 'share'],
      independent: ['alone', 'myself', 'independent', 'solo', 'own', 'personal'],
    };

    const detected: PersonalityType[] = [];
    const lowerMessage = message.toLowerCase();

    Object.entries(indicators).forEach(([type, keywords]) => {
      if (keywords.some(keyword => lowerMessage.includes(keyword))) {
        detected.push(type as PersonalityType);
      }
    });

    return detected;
  }

  // Pattern analysis methods
  private analyzeTimingPattern(userId: string, events: LearningEvent[]): UserBehaviorPattern | null {
    const timingEvents = events.filter(e => e.eventType === 'engagement_pattern');
    if (timingEvents.length < this.MIN_EVENTS_FOR_PATTERN) return null;

    const responseTimes = timingEvents.map(e => e.data.responseTime as number);
    const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;

    return {
      patternId: `timing_${userId}_${Date.now()}`,
      userId,
      patternType: 'response_timing',
      description: `User typically responds in ${this.categorizeResponseTime(avgResponseTime)} time`,
      frequency: timingEvents.length,
      confidence: Math.min(0.9, timingEvents.length / 10),
      firstObserved: timingEvents[0].timestamp,
      lastObserved: timingEvents[timingEvents.length - 1].timestamp,
      strength: avgResponseTime < 60000 ? 'strong' : avgResponseTime < 300000 ? 'moderate' : 'weak',
      metadata: {
        averageResponseTime: avgResponseTime,
        category: this.categorizeResponseTime(avgResponseTime),
      },
    };
  }

  private analyzeLengthPattern(userId: string, events: LearningEvent[]): UserBehaviorPattern | null {
    const lengthEvents = events.filter(e => e.eventType === 'response_length_preference');
    if (lengthEvents.length < this.MIN_EVENTS_FOR_PATTERN) return null;

    const lengths = lengthEvents.map(e => e.data.length as number);
    const avgLength = lengths.reduce((sum, len) => sum + len, 0) / lengths.length;

    return {
      patternId: `length_${userId}_${Date.now()}`,
      userId,
      patternType: 'message_length',
      description: `User prefers ${this.categorizeLength(avgLength)} responses`,
      frequency: lengthEvents.length,
      confidence: Math.min(0.9, lengthEvents.length / 10),
      firstObserved: lengthEvents[0].timestamp,
      lastObserved: lengthEvents[lengthEvents.length - 1].timestamp,
      strength: 'moderate',
      metadata: {
        averageLength: avgLength,
        category: this.categorizeLength(avgLength),
      },
    };
  }

  private analyzeEmotionalPattern(userId: string, events: LearningEvent[]): UserBehaviorPattern | null {
    const emotionalEvents = events.filter(e => e.eventType === 'emotional_state_indicator');
    if (emotionalEvents.length < this.MIN_EVENTS_FOR_PATTERN) return null;

    const expressiveness = emotionalEvents.map(e => e.data.expressiveness as number);
    const avgExpressiveness = expressiveness.reduce((sum, exp) => sum + exp, 0) / expressiveness.length;

    return {
      patternId: `emotional_${userId}_${Date.now()}`,
      userId,
      patternType: 'emotional_expression',
      description: `User shows ${avgExpressiveness > 0.7 ? 'high' : avgExpressiveness > 0.4 ? 'moderate' : 'low'} emotional expression`,
      frequency: emotionalEvents.length,
      confidence: Math.min(0.9, emotionalEvents.length / 8),
      firstObserved: emotionalEvents[0].timestamp,
      lastObserved: emotionalEvents[emotionalEvents.length - 1].timestamp,
      strength: avgExpressiveness > 0.7 ? 'strong' : avgExpressiveness > 0.4 ? 'moderate' : 'weak',
      metadata: {
        averageExpressiveness: avgExpressiveness,
      },
    };
  }

  private analyzeTopicPattern(userId: string, events: LearningEvent[]): UserBehaviorPattern | null {
    const topicEvents = events.filter(e => e.eventType === 'topic_interest_change');
    if (topicEvents.length < this.MIN_EVENTS_FOR_PATTERN) return null;

    // Count topic frequencies
    const topicCounts: Record<string, number> = {};
    topicEvents.forEach(event => {
      const topics = event.data.topics as string[];
      topics.forEach(topic => {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      });
    });

    const favoriteTopics = Object.entries(topicCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([topic]) => topic);

    return {
      patternId: `topic_${userId}_${Date.now()}`,
      userId,
      patternType: 'topic_engagement',
      description: `User shows interest in: ${favoriteTopics.join(', ')}`,
      frequency: topicEvents.length,
      confidence: Math.min(0.8, topicEvents.length / 8),
      firstObserved: topicEvents[0].timestamp,
      lastObserved: topicEvents[topicEvents.length - 1].timestamp,
      strength: 'moderate',
      metadata: {
        favoriteTopics,
        topicCounts,
      },
    };
  }

  private generateRecommendationsFromPattern(
    userId: string,
    pattern: UserBehaviorPattern,
    events: LearningEvent[]
  ): AdaptationRecommendation[] {
    const recommendations: AdaptationRecommendation[] = [];

    switch (pattern.patternType) {
      case 'message_length':
        recommendations.push({
          userId,
          recommendationType: 'question_style',
          currentValue: 'medium',
          suggestedValue: { responseLength: pattern.metadata.category },
          confidence: pattern.confidence,
          reasoning: `User consistently provides ${pattern.metadata.category} responses`,
          impact: 'medium',
          priority: 6,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week
        });
        break;

      case 'emotional_expression':
        recommendations.push({
          userId,
          recommendationType: 'response_tone',
          currentValue: 0.5,
          suggestedValue: { emotionalExpression: pattern.metadata.averageExpressiveness },
          confidence: pattern.confidence,
          reasoning: `User shows ${pattern.strength} emotional expression`,
          impact: 'high',
          priority: 8,
          validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 2 weeks
        });
        break;

      case 'topic_engagement':
        recommendations.push({
          userId,
          recommendationType: 'topic_focus',
          currentValue: [],
          suggestedValue: pattern.metadata.favoriteTopics,
          confidence: pattern.confidence,
          reasoning: `User shows consistent interest in specific topics`,
          impact: 'high',
          priority: 7,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 1 month
        });
        break;
    }

    return recommendations;
  }

  private generateInsightFromPattern(
    userId: string,
    pattern: UserBehaviorPattern,
    events: LearningEvent[]
  ): LearningInsight | null {
    switch (pattern.patternType) {
      case 'emotional_expression':
        return {
          userId,
          insightType: 'emotional_pattern',
          title: 'Emotional Expression Pattern Detected',
          description: `User consistently shows ${pattern.strength} emotional expression in responses`,
          confidence: pattern.confidence,
          actionable: true,
          suggestedActions: [
            'Adjust response tone to match user\'s emotional style',
            'Include more empathetic language in questions',
            'Consider emotional context in question selection',
          ],
          supportingEvidence: events.filter(e => e.eventType === 'emotional_state_indicator'),
          createdAt: new Date().toISOString(),
        };

      case 'topic_engagement':
        return {
          userId,
          insightType: 'new_interest_area',
          title: 'Topic Preferences Identified',
          description: `User shows strong engagement with: ${pattern.metadata.favoriteTopics.join(', ')}`,
          confidence: pattern.confidence,
          actionable: true,
          suggestedActions: [
            'Focus questions on preferred topic areas',
            'Explore related topics for expansion',
            'Avoid overused topics that show low engagement',
          ],
          supportingEvidence: events.filter(e => e.eventType === 'topic_interest_change'),
          createdAt: new Date().toISOString(),
        };

      default:
        return null;
    }
  }

  private generateTrendInsights(userId: string, events: LearningEvent[]): LearningInsight[] {
    const insights: LearningInsight[] = [];

    // Analyze engagement trends
    const engagementEvents = events.filter(e => e.eventType === 'engagement_pattern');
    if (engagementEvents.length >= 5) {
      const recentEngagement = engagementEvents.slice(-5).map(e => e.data.engagement as number);
      const avgRecent = recentEngagement.reduce((sum, eng) => sum + eng, 0) / recentEngagement.length;
      
      if (avgRecent < 0.4) {
        insights.push({
          userId,
          insightType: 'engagement_decline',
          title: 'Declining Engagement Detected',
          description: 'User engagement has decreased in recent interactions',
          confidence: 0.8,
          actionable: true,
          suggestedActions: [
            'Try different question categories',
            'Adjust question depth or complexity',
            'Consider timing adjustments',
          ],
          supportingEvidence: engagementEvents.slice(-5),
          createdAt: new Date().toISOString(),
        });
      }
    }

    return insights;
  }

  // Persistence methods
  private async persistLearningEvent(event: LearningEvent): Promise<void> {
    try {
      await this.dbService.saveLearningEvent(event);
    } catch (error) {
      console.error('Failed to persist learning event:', error);
    }
  }

  private async persistBehaviorPattern(pattern: UserBehaviorPattern): Promise<void> {
    try {
      await this.dbService.saveBehaviorPattern(pattern);
    } catch (error) {
      console.error('Failed to persist behavior pattern:', error);
    }
  }

  private async persistAdaptationRecommendation(recommendation: AdaptationRecommendation): Promise<void> {
    try {
      await this.dbService.saveAdaptationRecommendation(recommendation);
    } catch (error) {
      console.error('Failed to persist adaptation recommendation:', error);
    }
  }
}

// Response analysis interface
interface ResponseAnalysis {
  length: {
    characters: number;
    words: number;
    sentences: number;
    category: 'short' | 'medium' | 'long';
  };
  timing: {
    responseTime: number;
    category: 'quick' | 'normal' | 'slow';
  };
  linguistic: {
    complexity: number;
    formality: number;
    emotionalExpression: number;
    questionEngagement: number;
  };
  content: {
    topics: string[];
    sentiment: 'positive' | 'negative' | 'neutral';
    personalityIndicators: PersonalityType[];
  };
}

// Global adaptive learning engine instance
export const adaptiveLearningEngine = new AdaptiveLearningEngine();

