/**
 * Type definitions for Fylgja AI Service
 * Comprehensive types for Google AI integration
 */

export interface AIRequest {
  userId: string;
  prompt: string;
  context?: string;
  conversationHistory?: ConversationMessage[];
  requestType: AIRequestType;
  metadata?: Record<string, any>;
  preferences?: UserAIPreferences;
}

export type AIRequestType =
  | 'checkin'
  | 'task_analysis'
  | 'response_generation'
  | 'sentiment_analysis'
  | 'question_generation'
  | 'goal_setting'
  | 'reflection_prompt';

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metadata?: {
    confidence?: number;
    sentiment?: SentimentData;
    processingTime?: number;
  };
}

export interface AIResponse {
  response: string;
  confidence: number;
  processingTime: number;
  tokensUsed: number;
  sentiment?: SentimentData;
  suggestions?: SuggestionData;
  metadata: AIResponseMetadata;
  adaptiveLearning?: AdaptiveLearningData;
}

export interface SentimentData {
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  confidence: number;
  emotions: EmotionData[];
  intensity: number; // 0-1 scale
  valence: number; // -1 to 1 scale
  arousal: number; // 0-1 scale
}

export interface EmotionData {
  emotion: string;
  confidence: number;
  intensity: number;
}

export interface SuggestionData {
  tasks: TaskSuggestion[];
  questions: QuestionSuggestion[];
  actions: ActionSuggestion[];
  goals: GoalSuggestion[];
  reflections: ReflectionSuggestion[];
}

export interface TaskSuggestion {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  estimatedTime: number; // minutes
  category: string;
  confidence: number;
}

export interface QuestionSuggestion {
  question: string;
  purpose: 'clarification' | 'reflection' | 'exploration' | 'goal_setting';
  followUp: boolean;
  confidence: number;
}

export interface ActionSuggestion {
  action: string;
  type: 'immediate' | 'short_term' | 'long_term';
  difficulty: 'easy' | 'medium' | 'hard';
  impact: 'low' | 'medium' | 'high';
  confidence: number;
}

export interface GoalSuggestion {
  goal: string;
  timeframe: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  category: string;
  measurable: boolean;
  confidence: number;
}

export interface ReflectionSuggestion {
  prompt: string;
  type: 'gratitude' | 'learning' | 'growth' | 'achievement' | 'challenge';
  depth: 'surface' | 'moderate' | 'deep';
  confidence: number;
}

export interface AIResponseMetadata {
  model: string;
  requestId: string;
  timestamp: string;
  userId: string;
  requestType: AIRequestType;
  version: string;
  processingSteps: ProcessingStep[];
}

export interface ProcessingStep {
  step: string;
  duration: number;
  success: boolean;
  metadata?: Record<string, any>;
}

export interface AdaptiveLearningData {
  userPatterns: UserPattern[];
  communicationStyle: CommunicationStyle;
  preferences: LearnedPreferences;
  recommendations: AdaptationRecommendation[];
}

export interface UserPattern {
  pattern: string;
  frequency: number;
  confidence: number;
  lastObserved: string;
  category: 'communication' | 'behavior' | 'preference' | 'emotional';
}

export interface CommunicationStyle {
  formality: 'casual' | 'formal' | 'mixed';
  verbosity: 'concise' | 'moderate' | 'detailed';
  emotionalExpression: 'reserved' | 'moderate' | 'expressive';
  questioningStyle: 'direct' | 'exploratory' | 'reflective';
  responsePreference: 'quick' | 'thoughtful' | 'comprehensive';
  confidence: number;
}

export interface LearnedPreferences {
  topicInterests: string[];
  interactionTiming: {
    preferredTimes: string[];
    frequency: 'low' | 'medium' | 'high';
    duration: 'short' | 'medium' | 'long';
  };
  feedbackStyle: 'encouraging' | 'direct' | 'analytical' | 'empathetic';
  goalOrientation: 'achievement' | 'process' | 'learning' | 'social';
  confidenceLevel: number;
}

export interface AdaptationRecommendation {
  type: 'communication' | 'content' | 'timing' | 'approach';
  recommendation: string;
  rationale: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high';
}

export interface UserAIPreferences {
  responseLength: 'short' | 'medium' | 'long';
  tone: 'professional' | 'friendly' | 'casual' | 'empathetic';
  includeQuestions: boolean;
  includeSuggestions: boolean;
  focusAreas: string[];
  avoidTopics: string[];
  languageStyle: 'simple' | 'moderate' | 'advanced';
  culturalContext?: string;
}

export interface UsageMetrics {
  requestCount: number;
  totalTokens: number;
  averageResponseTime: number;
  errorRate: number;
  lastReset: string;
  dailyUsage: DailyUsage[];
  peakUsageTimes: string[];
  mostUsedRequestTypes: RequestTypeUsage[];
}

export interface DailyUsage {
  date: string;
  requests: number;
  tokens: number;
  averageResponseTime: number;
  errors: number;
}

export interface RequestTypeUsage {
  type: AIRequestType;
  count: number;
  percentage: number;
  averageResponseTime: number;
  successRate: number;
}

export interface AIServiceConfig {
  model: string;
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens: number;
  maxRequestsPerMinute: number;
  maxTokensPerRequest: number;
  enableSentimentAnalysis: boolean;
  enableSuggestions: boolean;
  enableAdaptiveLearning: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface AIError {
  code: string;
  message: string;
  type: 'rate_limit' | 'quota_exceeded' | 'invalid_request' | 'service_unavailable' | 'unknown';
  retryable: boolean;
  retryAfter?: number;
  metadata?: Record<string, any>;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  variables: PromptVariable[];
  requestType: AIRequestType;
  version: string;
  active: boolean;
}

export interface PromptVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  description: string;
  defaultValue?: any;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enum?: any[];
  };
}

export interface ConversationContext {
  userId: string;
  sessionId: string;
  messages: ConversationMessage[];
  startTime: string;
  lastActivity: string;
  metadata: {
    platform: string;
    userAgent?: string;
    location?: string;
    timezone?: string;
  };
  state: ConversationState;
}

export interface ConversationState {
  phase: 'greeting' | 'checkin' | 'task_discussion' | 'reflection' | 'goal_setting' | 'closing';
  topics: string[];
  sentiment: SentimentData;
  userEngagement: 'low' | 'medium' | 'high';
  needsFollowUp: boolean;
  pendingActions: string[];
}

export interface AIAnalytics {
  totalRequests: number;
  uniqueUsers: number;
  averageResponseTime: number;
  errorRate: number;
  topRequestTypes: RequestTypeUsage[];
  userSatisfaction: {
    averageRating: number;
    totalRatings: number;
    distribution: Record<number, number>;
  };
  performanceMetrics: {
    p50ResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    uptimePercentage: number;
  };
  costMetrics: {
    totalTokensUsed: number;
    estimatedCost: number;
    costPerRequest: number;
    costPerUser: number;
  };
}

// Utility types
export type AIServiceStatus = 'healthy' | 'degraded' | 'unavailable';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type AICapability =
  | 'text_generation'
  | 'sentiment_analysis'
  | 'task_extraction'
  | 'question_generation'
  | 'goal_setting'
  | 'reflection_prompting'
  | 'adaptive_learning';

// Event types for AI service
export interface AIServiceEvent {
  type:
    | 'request_started'
    | 'request_completed'
    | 'request_failed'
    | 'rate_limit_hit'
    | 'quota_warning';
  timestamp: string;
  userId: string;
  requestId: string;
  metadata: Record<string, any>;
}

// Configuration validation
export interface ConfigValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Health check response
export interface HealthCheckResponse {
  status: AIServiceStatus;
  timestamp: string;
  version: string;
  uptime: number;
  metrics: {
    requestsPerMinute: number;
    averageResponseTime: number;
    errorRate: number;
    memoryUsage: number;
  };
  dependencies: {
    googleAI: 'healthy' | 'unhealthy';
    database: 'healthy' | 'unhealthy';
  };
}
