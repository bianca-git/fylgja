/**
 * Interaction Workflows for Fylgja
 * Orchestrates complex multi-step interactions and conversation flows
 */

import { CoreProcessor, ProcessingRequest, ProcessingResult } from '../core/core-processor';
import { DatabaseService } from '../services/database-service';
import { performanceMonitor } from '../utils/monitoring';
import { FylgjaError, createValidationError } from '../utils/error-handler';

export interface WorkflowContext {
  userId: string;
  workflowId: string;
  currentStep: number;
  totalSteps: number;
  workflowData: Record<string, any>;
  startTime: string;
  lastActivity: string;
  platform: 'whatsapp' | 'web' | 'google_home' | 'api';
  sessionId: string;
}

export interface WorkflowStep {
  stepId: string;
  stepType: WorkflowStepType;
  title: string;
  description: string;
  processingRequest: ProcessingRequest;
  validation?: (input: string, context: WorkflowContext) => boolean;
  nextStep?: (result: ProcessingResult, context: WorkflowContext) => string | null;
  onComplete?: (result: ProcessingResult, context: WorkflowContext) => Promise<void>;
}

export type WorkflowStepType = 
  | 'question'
  | 'response_processing'
  | 'task_analysis'
  | 'goal_setting'
  | 'reflection'
  | 'summary'
  | 'completion';

export interface WorkflowDefinition {
  workflowId: string;
  name: string;
  description: string;
  category: WorkflowCategory;
  estimatedDuration: number; // in minutes
  steps: WorkflowStep[];
  triggers: WorkflowTrigger[];
  completionCriteria: (context: WorkflowContext) => boolean;
}

export type WorkflowCategory = 
  | 'daily_checkin'
  | 'goal_planning'
  | 'reflection_session'
  | 'task_management'
  | 'learning_review'
  | 'wellness_check'
  | 'productivity_analysis';

export interface WorkflowTrigger {
  triggerType: 'time' | 'event' | 'user_request' | 'adaptive';
  condition: string;
  priority: number;
}

export interface WorkflowResult {
  workflowId: string;
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  duration: number;
  results: ProcessingResult[];
  summary?: string;
  nextRecommendations?: string[];
  error?: {
    step: string;
    message: string;
    retryable: boolean;
  };
}

export class InteractionWorkflowEngine {
  private coreProcessor: CoreProcessor;
  private database: DatabaseService;
  private activeWorkflows: Map<string, WorkflowContext> = new Map();
  private workflowDefinitions: Map<string, WorkflowDefinition> = new Map();

  constructor() {
    this.coreProcessor = new CoreProcessor();
    this.database = new DatabaseService();
    this.initializeWorkflowDefinitions();
  }

  /**
   * Start a new workflow
   */
  async startWorkflow(
    workflowId: string, 
    userId: string, 
    platform: string,
    sessionId: string,
    initialData?: Record<string, any>
  ): Promise<ProcessingResult> {
    const workflow = this.workflowDefinitions.get(workflowId);
    if (!workflow) {
      throw createValidationError(`Unknown workflow: ${workflowId}`);
    }

    const context: WorkflowContext = {
      userId,
      workflowId,
      currentStep: 0,
      totalSteps: workflow.steps.length,
      workflowData: initialData || {},
      startTime: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      platform: platform as any,
      sessionId,
    };

    this.activeWorkflows.set(`${userId}_${workflowId}`, context);

    // Execute first step
    return await this.executeStep(context);
  }

  /**
   * Continue workflow with user input
   */
  async continueWorkflow(
    userId: string,
    workflowId: string,
    userInput: string
  ): Promise<ProcessingResult> {
    const contextKey = `${userId}_${workflowId}`;
    const context = this.activeWorkflows.get(contextKey);
    
    if (!context) {
      throw createValidationError(`No active workflow found: ${workflowId}`);
    }

    const workflow = this.workflowDefinitions.get(workflowId)!;
    const currentStep = workflow.steps[context.currentStep];

    // Validate input if validation function exists
    if (currentStep.validation && !currentStep.validation(userInput, context)) {
      return {
        success: false,
        response: "I didn't quite understand that. Could you please try again?",
        metadata: {
          processingTime: 0,
          componentsUsed: ['workflow_engine'],
          confidence: 0,
          requestId: this.generateRequestId(),
          timestamp: new Date().toISOString(),
        },
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Input validation failed',
          retryable: true,
        },
      };
    }

    // Process the input
    const processingRequest: ProcessingRequest = {
      ...currentStep.processingRequest,
      userId,
      input: userInput,
      context: {
        platform: context.platform,
        sessionId: context.sessionId,
      },
    };

    const result = await this.coreProcessor.processRequest(processingRequest);

    // Store result in workflow data
    context.workflowData[`step_${context.currentStep}_result`] = result;
    context.lastActivity = new Date().toISOString();

    // Execute step completion callback
    if (currentStep.onComplete) {
      await currentStep.onComplete(result, context);
    }

    // Determine next step
    let nextStepId: string | null = null;
    if (currentStep.nextStep) {
      nextStepId = currentStep.nextStep(result, context);
    } else if (context.currentStep < workflow.steps.length - 1) {
      nextStepId = workflow.steps[context.currentStep + 1].stepId;
    }

    if (nextStepId) {
      // Find next step index
      const nextStepIndex = workflow.steps.findIndex(step => step.stepId === nextStepId);
      if (nextStepIndex !== -1) {
        context.currentStep = nextStepIndex;
        
        // Execute next step
        const nextResult = await this.executeStep(context);
        
        // Combine results
        return {
          ...result,
          response: `${result.response}\n\n${nextResult.response}`,
        };
      }
    }

    // Check if workflow is complete
    if (workflow.completionCriteria(context)) {
      return await this.completeWorkflow(context);
    }

    return result;
  }

  /**
   * Execute a workflow step
   */
  private async executeStep(context: WorkflowContext): Promise<ProcessingResult> {
    const workflow = this.workflowDefinitions.get(context.workflowId)!;
    const step = workflow.steps[context.currentStep];

    const processingRequest: ProcessingRequest = {
      ...step.processingRequest,
      userId: context.userId,
      context: {
        platform: context.platform,
        sessionId: context.sessionId,
      },
    };

    const result = await this.coreProcessor.processRequest(processingRequest);

    // Store result
    context.workflowData[`step_${context.currentStep}_result`] = result;
    context.lastActivity = new Date().toISOString();

    return result;
  }

  /**
   * Complete workflow
   */
  private async completeWorkflow(context: WorkflowContext): Promise<ProcessingResult> {
    const workflow = this.workflowDefinitions.get(context.workflowId)!;
    
    // Generate summary
    const summaryRequest: ProcessingRequest = {
      userId: context.userId,
      requestType: 'summary_generation',
      context: {
        platform: context.platform,
        sessionId: context.sessionId,
      },
    };

    const summaryResult = await this.coreProcessor.processRequest(summaryRequest);

    // Calculate duration
    const duration = new Date().getTime() - new Date(context.startTime).getTime();

    // Store workflow completion
    await this.storeWorkflowCompletion(context, duration);

    // Remove from active workflows
    this.activeWorkflows.delete(`${context.userId}_${context.workflowId}`);

    return {
      success: true,
      response: `Great! We've completed the ${workflow.name}. ${summaryResult.response}`,
      metadata: {
        processingTime: duration,
        componentsUsed: ['workflow_engine', 'core_processor'],
        confidence: 0.9,
        requestId: this.generateRequestId(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Get workflow status
   */
  getWorkflowStatus(userId: string, workflowId: string): {
    active: boolean;
    currentStep?: number;
    totalSteps?: number;
    progress?: number;
  } {
    const context = this.activeWorkflows.get(`${userId}_${workflowId}`);
    
    if (!context) {
      return { active: false };
    }

    return {
      active: true,
      currentStep: context.currentStep + 1,
      totalSteps: context.totalSteps,
      progress: ((context.currentStep + 1) / context.totalSteps) * 100,
    };
  }

  /**
   * Initialize predefined workflows
   */
  private initializeWorkflowDefinitions(): void {
    // Daily Check-in Workflow
    this.workflowDefinitions.set('daily_checkin', {
      workflowId: 'daily_checkin',
      name: 'Daily Check-in',
      description: 'A comprehensive daily reflection and planning session',
      category: 'daily_checkin',
      estimatedDuration: 5,
      steps: [
        {
          stepId: 'greeting',
          stepType: 'question',
          title: 'Greeting',
          description: 'Welcome and initial question',
          processingRequest: {
            userId: '',
            requestType: 'daily_checkin',
          },
        },
        {
          stepId: 'completion_review',
          stepType: 'response_processing',
          title: 'Review Completions',
          description: 'Process what the user completed',
          processingRequest: {
            userId: '',
            requestType: 'process_response',
          },
          nextStep: () => 'planning',
        },
        {
          stepId: 'planning',
          stepType: 'question',
          title: 'Planning',
          description: 'Ask about tomorrow\'s plans',
          processingRequest: {
            userId: '',
            requestType: 'generate_question',
          },
        },
        {
          stepId: 'planning_processing',
          stepType: 'response_processing',
          title: 'Process Planning',
          description: 'Process planning response',
          processingRequest: {
            userId: '',
            requestType: 'process_response',
          },
          nextStep: () => 'reflection',
        },
        {
          stepId: 'reflection',
          stepType: 'reflection',
          title: 'Reflection',
          description: 'Deep reflection question',
          processingRequest: {
            userId: '',
            requestType: 'reflection_prompt',
          },
        },
        {
          stepId: 'reflection_processing',
          stepType: 'response_processing',
          title: 'Process Reflection',
          description: 'Process reflection response',
          processingRequest: {
            userId: '',
            requestType: 'process_response',
          },
          nextStep: () => 'summary',
        },
        {
          stepId: 'summary',
          stepType: 'summary',
          title: 'Summary',
          description: 'Generate session summary',
          processingRequest: {
            userId: '',
            requestType: 'summary_generation',
          },
        },
      ],
      triggers: [
        {
          triggerType: 'time',
          condition: 'daily_evening',
          priority: 8,
        },
        {
          triggerType: 'user_request',
          condition: 'checkin',
          priority: 10,
        },
      ],
      completionCriteria: (context) => context.currentStep >= 6,
    });

    // Goal Planning Workflow
    this.workflowDefinitions.set('goal_planning', {
      workflowId: 'goal_planning',
      name: 'Goal Planning Session',
      description: 'Structured goal setting and planning workflow',
      category: 'goal_planning',
      estimatedDuration: 10,
      steps: [
        {
          stepId: 'goal_identification',
          stepType: 'goal_setting',
          title: 'Identify Goals',
          description: 'Help user identify their goals',
          processingRequest: {
            userId: '',
            requestType: 'goal_setting',
          },
        },
        {
          stepId: 'goal_processing',
          stepType: 'response_processing',
          title: 'Process Goals',
          description: 'Process and refine goals',
          processingRequest: {
            userId: '',
            requestType: 'process_response',
          },
          nextStep: () => 'task_breakdown',
        },
        {
          stepId: 'task_breakdown',
          stepType: 'task_analysis',
          title: 'Break Down Tasks',
          description: 'Break goals into actionable tasks',
          processingRequest: {
            userId: '',
            requestType: 'task_analysis',
          },
        },
        {
          stepId: 'task_processing',
          stepType: 'response_processing',
          title: 'Process Tasks',
          description: 'Process task breakdown',
          processingRequest: {
            userId: '',
            requestType: 'process_response',
          },
          nextStep: () => 'priority_setting',
        },
        {
          stepId: 'priority_setting',
          stepType: 'question',
          title: 'Set Priorities',
          description: 'Help set task priorities',
          processingRequest: {
            userId: '',
            requestType: 'generate_question',
          },
        },
        {
          stepId: 'priority_processing',
          stepType: 'response_processing',
          title: 'Process Priorities',
          description: 'Process priority decisions',
          processingRequest: {
            userId: '',
            requestType: 'process_response',
          },
          nextStep: () => 'action_plan',
        },
        {
          stepId: 'action_plan',
          stepType: 'summary',
          title: 'Create Action Plan',
          description: 'Generate comprehensive action plan',
          processingRequest: {
            userId: '',
            requestType: 'summary_generation',
          },
        },
      ],
      triggers: [
        {
          triggerType: 'user_request',
          condition: 'goal_planning',
          priority: 9,
        },
        {
          triggerType: 'adaptive',
          condition: 'low_goal_clarity',
          priority: 7,
        },
      ],
      completionCriteria: (context) => context.currentStep >= 6,
    });

    // Reflection Session Workflow
    this.workflowDefinitions.set('reflection_session', {
      workflowId: 'reflection_session',
      name: 'Deep Reflection Session',
      description: 'Guided deep reflection and insight generation',
      category: 'reflection_session',
      estimatedDuration: 8,
      steps: [
        {
          stepId: 'reflection_intro',
          stepType: 'reflection',
          title: 'Introduction',
          description: 'Set the tone for reflection',
          processingRequest: {
            userId: '',
            requestType: 'reflection_prompt',
          },
        },
        {
          stepId: 'initial_reflection',
          stepType: 'response_processing',
          title: 'Initial Reflection',
          description: 'Process initial reflection',
          processingRequest: {
            userId: '',
            requestType: 'process_response',
          },
          nextStep: () => 'deeper_exploration',
        },
        {
          stepId: 'deeper_exploration',
          stepType: 'reflection',
          title: 'Deeper Exploration',
          description: 'Explore insights more deeply',
          processingRequest: {
            userId: '',
            requestType: 'reflection_prompt',
          },
        },
        {
          stepId: 'exploration_processing',
          stepType: 'response_processing',
          title: 'Process Exploration',
          description: 'Process deeper exploration',
          processingRequest: {
            userId: '',
            requestType: 'process_response',
          },
          nextStep: () => 'insight_synthesis',
        },
        {
          stepId: 'insight_synthesis',
          stepType: 'summary',
          title: 'Synthesize Insights',
          description: 'Synthesize key insights',
          processingRequest: {
            userId: '',
            requestType: 'summary_generation',
          },
        },
      ],
      triggers: [
        {
          triggerType: 'user_request',
          condition: 'reflection',
          priority: 8,
        },
        {
          triggerType: 'time',
          condition: 'weekly_reflection',
          priority: 6,
        },
      ],
      completionCriteria: (context) => context.currentStep >= 4,
    });
  }

  /**
   * Store workflow completion
   */
  private async storeWorkflowCompletion(context: WorkflowContext, duration: number): Promise<void> {
    try {
      await this.database.saveWorkflowCompletion({
        userId: context.userId,
        workflowId: context.workflowId,
        completedSteps: context.currentStep + 1,
        totalSteps: context.totalSteps,
        duration,
        startTime: context.startTime,
        endTime: new Date().toISOString(),
        workflowData: context.workflowData,
        platform: context.platform,
      });
    } catch (error) {
      console.warn('Failed to store workflow completion:', error);
    }
  }

  private generateRequestId(): string {
    return `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get available workflows for user
   */
  getAvailableWorkflows(userId: string): WorkflowDefinition[] {
    return Array.from(this.workflowDefinitions.values());
  }

  /**
   * Get active workflows for user
   */
  getActiveWorkflows(userId: string): WorkflowContext[] {
    return Array.from(this.activeWorkflows.values())
      .filter(context => context.userId === userId);
  }

  /**
   * Cancel workflow
   */
  async cancelWorkflow(userId: string, workflowId: string): Promise<boolean> {
    const contextKey = `${userId}_${workflowId}`;
    return this.activeWorkflows.delete(contextKey);
  }
}

// Global workflow engine instance
export const workflowEngine = new InteractionWorkflowEngine();

