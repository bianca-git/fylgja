/**
 * Component Integration Layer for Fylgja
 * Provides seamless coordination between all system components
 */

import { CoreProcessor } from '../core/core-processor';
import { InteractionWorkflowEngine } from '../workflows/interaction-workflows';
import { GoogleAIService } from '../services/google-ai-service';
import { DatabaseService } from '../services/database-service';
import { PromptEngine } from '../core/prompt-engine';
import { AdaptiveLearningEngine } from '../core/adaptive-learning';
import { performanceMonitor } from '../utils/monitoring';
import { FylgjaError, createSystemError } from '../utils/error-handler';

export interface IntegrationConfig {
  enableAdaptiveLearning: boolean;
  enableWorkflows: boolean;
  enablePerformanceMonitoring: boolean;
  enableErrorRecovery: boolean;
  maxRetryAttempts: number;
  circuitBreakerThreshold: number;
}

export interface ComponentHealth {
  component: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: string;
  responseTime?: number;
  errorRate?: number;
  details?: Record<string, any>;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: ComponentHealth[];
  metrics: {
    totalRequests: number;
    successRate: number;
    averageResponseTime: number;
    activeUsers: number;
    activeSessions: number;
  };
  timestamp: string;
}

export interface IntegrationMetrics {
  requestCount: number;
  successCount: number;
  errorCount: number;
  averageResponseTime: number;
  componentUsage: Record<string, number>;
  adaptationCount: number;
  workflowCompletions: number;
}

export class ComponentIntegrator {
  private coreProcessor: CoreProcessor;
  private workflowEngine: InteractionWorkflowEngine;
  private googleAI: GoogleAIService;
  private database: DatabaseService;
  private promptEngine: PromptEngine;
  private adaptiveLearning: AdaptiveLearningEngine;
  
  private config: IntegrationConfig;
  private metrics: IntegrationMetrics;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private healthCache: Map<string, ComponentHealth> = new Map();
  
  private readonly HEALTH_CACHE_TTL = 30000; // 30 seconds
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute

  constructor(config: Partial<IntegrationConfig> = {}) {
    this.config = {
      enableAdaptiveLearning: true,
      enableWorkflows: true,
      enablePerformanceMonitoring: true,
      enableErrorRecovery: true,
      maxRetryAttempts: 3,
      circuitBreakerThreshold: 5,
      ...config,
    };

    this.metrics = {
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      averageResponseTime: 0,
      componentUsage: {},
      adaptationCount: 0,
      workflowCompletions: 0,
    };

    this.initializeComponents();
    this.initializeCircuitBreakers();
  }

  /**
   * Initialize all components
   */
  private initializeComponents(): void {
    this.coreProcessor = new CoreProcessor();
    this.workflowEngine = new InteractionWorkflowEngine();
    this.googleAI = new GoogleAIService();
    this.database = new DatabaseService();
    this.promptEngine = new PromptEngine();
    this.adaptiveLearning = new AdaptiveLearningEngine();
  }

  /**
   * Initialize circuit breakers for each component
   */
  private initializeCircuitBreakers(): void {
    const components = ['coreProcessor', 'googleAI', 'database', 'promptEngine', 'adaptiveLearning'];
    
    components.forEach(component => {
      this.circuitBreakers.set(component, new CircuitBreaker({
        threshold: this.config.circuitBreakerThreshold,
        timeout: this.CIRCUIT_BREAKER_TIMEOUT,
        onOpen: () => console.warn(`Circuit breaker opened for ${component}`),
        onClose: () => console.info(`Circuit breaker closed for ${component}`),
      }));
    });
  }

  /**
   * Main integration method - processes requests with full system coordination
   */
  async processIntegratedRequest(request: {
    userId: string;
    requestType: string;
    input?: string;
    platform: string;
    sessionId: string;
    useWorkflow?: boolean;
    workflowId?: string;
    metadata?: Record<string, any>;
  }): Promise<{
    success: boolean;
    response?: string;
    workflowStatus?: any;
    adaptations?: any;
    metrics: {
      processingTime: number;
      componentsUsed: string[];
      confidence: number;
    };
    error?: any;
  }> {
    const startTime = Date.now();
    const timerId = performanceMonitor.startTimer('integrated_request');
    
    try {
      this.metrics.requestCount++;
      
      // Check system health before processing
      if (this.config.enablePerformanceMonitoring) {
        const health = await this.getSystemHealth();
        if (health.overall === 'unhealthy') {
          throw createSystemError('System is currently unhealthy');
        }
      }

      let result: any;
      const componentsUsed: string[] = [];

      // Route to workflow engine if workflow is requested
      if (this.config.enableWorkflows && (request.useWorkflow || request.workflowId)) {
        result = await this.processWithWorkflow(request);
        componentsUsed.push('workflowEngine');
      } else {
        // Process with core processor
        result = await this.processWithCore(request);
        componentsUsed.push('coreProcessor');
      }

      // Apply adaptive learning if enabled
      if (this.config.enableAdaptiveLearning && request.input) {
        await this.applyAdaptiveLearning(request.userId, request.input, result);
        componentsUsed.push('adaptiveLearning');
        this.metrics.adaptationCount++;
      }

      // Update metrics
      this.metrics.successCount++;
      this.updateComponentUsage(componentsUsed);

      const processingTime = Date.now() - startTime;
      this.updateAverageResponseTime(processingTime);

      performanceMonitor.endTimer(timerId);

      return {
        success: true,
        response: result.response,
        workflowStatus: result.workflowStatus,
        adaptations: result.adaptations,
        metrics: {
          processingTime,
          componentsUsed,
          confidence: result.confidence || 0.8,
        },
      };

    } catch (error) {
      this.metrics.errorCount++;
      performanceMonitor.endTimer(timerId);

      // Handle error with recovery if enabled
      if (this.config.enableErrorRecovery) {
        const recoveryResult = await this.attemptErrorRecovery(request, error);
        if (recoveryResult) {
          return recoveryResult;
        }
      }

      return {
        success: false,
        metrics: {
          processingTime: Date.now() - startTime,
          componentsUsed: [],
          confidence: 0,
        },
        error: {
          message: error.message,
          code: error.code || 'INTEGRATION_ERROR',
          retryable: error.retryable !== false,
        },
      };
    }
  }

  /**
   * Process request with workflow engine
   */
  private async processWithWorkflow(request: any): Promise<any> {
    const circuitBreaker = this.circuitBreakers.get('workflowEngine')!;
    
    return await circuitBreaker.execute(async () => {
      if (request.workflowId && request.input) {
        // Continue existing workflow
        return await this.workflowEngine.continueWorkflow(
          request.userId,
          request.workflowId,
          request.input
        );
      } else {
        // Start new workflow
        const workflowId = request.workflowId || 'daily_checkin';
        return await this.workflowEngine.startWorkflow(
          workflowId,
          request.userId,
          request.platform,
          request.sessionId,
          request.metadata
        );
      }
    });
  }

  /**
   * Process request with core processor
   */
  private async processWithCore(request: any): Promise<any> {
    const circuitBreaker = this.circuitBreakers.get('coreProcessor')!;
    
    return await circuitBreaker.execute(async () => {
      return await this.coreProcessor.processRequest({
        userId: request.userId,
        requestType: request.requestType as any,
        input: request.input,
        context: {
          platform: request.platform as any,
          sessionId: request.sessionId,
        },
        metadata: request.metadata,
      });
    });
  }

  /**
   * Apply adaptive learning
   */
  private async applyAdaptiveLearning(userId: string, input: string, result: any): Promise<void> {
    const circuitBreaker = this.circuitBreakers.get('adaptiveLearning')!;
    
    try {
      await circuitBreaker.execute(async () => {
        await this.adaptiveLearning.analyzeUserResponse(
          userId,
          input,
          result.question?.question || 'General interaction',
          Date.now(),
          { platform: 'integrated' }
        );
      });
    } catch (error) {
      console.warn('Adaptive learning failed:', error);
      // Don't fail the entire request if adaptive learning fails
    }
  }

  /**
   * Attempt error recovery
   */
  private async attemptErrorRecovery(request: any, error: any): Promise<any | null> {
    for (let attempt = 1; attempt <= this.config.maxRetryAttempts; attempt++) {
      try {
        console.info(`Attempting error recovery, attempt ${attempt}/${this.config.maxRetryAttempts}`);
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        
        // Retry with simplified request
        const simplifiedRequest = {
          ...request,
          useWorkflow: false, // Disable workflows on retry
          requestType: 'generate_question', // Fallback to simple question generation
        };
        
        return await this.processWithCore(simplifiedRequest);
        
      } catch (retryError) {
        console.warn(`Recovery attempt ${attempt} failed:`, retryError);
        
        if (attempt === this.config.maxRetryAttempts) {
          // Final fallback - return a generic response
          return {
            success: true,
            response: "I'm experiencing some technical difficulties right now. Let's try again in a moment. How are you doing today?",
            metrics: {
              processingTime: 0,
              componentsUsed: ['fallback'],
              confidence: 0.5,
            },
          };
        }
      }
    }
    
    return null;
  }

  /**
   * Get comprehensive system health
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const components: ComponentHealth[] = [];
    
    // Check each component
    const componentChecks = [
      { name: 'coreProcessor', check: () => this.coreProcessor.healthCheck() },
      { name: 'googleAI', check: () => this.googleAI.getOverallMetrics() },
      { name: 'database', check: () => this.database.healthCheck() },
      { name: 'promptEngine', check: () => Promise.resolve({ status: 'healthy' }) },
      { name: 'adaptiveLearning', check: () => Promise.resolve({ status: 'healthy' }) },
    ];

    for (const { name, check } of componentChecks) {
      const cached = this.healthCache.get(name);
      const now = Date.now();
      
      if (cached && (now - new Date(cached.lastCheck).getTime()) < this.HEALTH_CACHE_TTL) {
        components.push(cached);
        continue;
      }

      try {
        const startTime = Date.now();
        await check();
        const responseTime = Date.now() - startTime;
        
        const health: ComponentHealth = {
          component: name,
          status: 'healthy',
          lastCheck: new Date().toISOString(),
          responseTime,
          errorRate: this.calculateErrorRate(name),
        };
        
        components.push(health);
        this.healthCache.set(name, health);
        
      } catch (error) {
        const health: ComponentHealth = {
          component: name,
          status: 'unhealthy',
          lastCheck: new Date().toISOString(),
          errorRate: this.calculateErrorRate(name),
          details: { error: error.message },
        };
        
        components.push(health);
        this.healthCache.set(name, health);
      }
    }

    // Determine overall health
    const unhealthyCount = components.filter(c => c.status === 'unhealthy').length;
    const degradedCount = components.filter(c => c.status === 'degraded').length;
    
    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyCount > 1) {
      overall = 'unhealthy';
    } else if (unhealthyCount > 0 || degradedCount > 2) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }

    return {
      overall,
      components,
      metrics: {
        totalRequests: this.metrics.requestCount,
        successRate: this.metrics.requestCount > 0 ? 
          (this.metrics.successCount / this.metrics.requestCount) * 100 : 100,
        averageResponseTime: this.metrics.averageResponseTime,
        activeUsers: 0, // Would be calculated from active sessions
        activeSessions: this.coreProcessor.getActiveSessionCount(),
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get integration metrics
   */
  getMetrics(): IntegrationMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      averageResponseTime: 0,
      componentUsage: {},
      adaptationCount: 0,
      workflowCompletions: 0,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<IntegrationConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Helper methods
   */
  private updateComponentUsage(components: string[]): void {
    components.forEach(component => {
      this.metrics.componentUsage[component] = (this.metrics.componentUsage[component] || 0) + 1;
    });
  }

  private updateAverageResponseTime(responseTime: number): void {
    const totalTime = this.metrics.averageResponseTime * (this.metrics.requestCount - 1);
    this.metrics.averageResponseTime = (totalTime + responseTime) / this.metrics.requestCount;
  }

  private calculateErrorRate(component: string): number {
    const circuitBreaker = this.circuitBreakers.get(component);
    if (!circuitBreaker) return 0;
    
    return circuitBreaker.getErrorRate();
  }
}

/**
 * Circuit Breaker implementation
 */
class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private totalRequests = 0;

  constructor(private config: {
    threshold: number;
    timeout: number;
    onOpen?: () => void;
    onClose?: () => void;
  }) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.config.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    this.totalRequests++;

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.successCount++;
    
    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failureCount = 0;
      this.config.onClose?.();
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.threshold) {
      this.state = 'open';
      this.config.onOpen?.();
    }
  }

  getErrorRate(): number {
    if (this.totalRequests === 0) return 0;
    return (this.failureCount / this.totalRequests) * 100;
  }

  getState(): string {
    return this.state;
  }
}

// Global component integrator instance
export const componentIntegrator = new ComponentIntegrator();

