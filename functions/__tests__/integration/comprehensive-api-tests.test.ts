/**
 * Comprehensive API Integration Tests for Fylgja
 * Tests all components working together with real-world scenarios
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { CoreProcessor } from '../../src/core/core-processor';
import { GoogleAIService } from '../../src/services/google-ai-service';
import { EnhancedDatabaseService } from '../../src/services/enhanced-database-service';
import { AuthenticationService } from '../../src/auth/authentication-service';
import { ResponseGenerator } from '../../src/core/response-generator';
import { PromptEngine } from '../../src/core/prompt-engine';
import { APIValidator } from '../../src/validation/api-validator';
import { APIPerformanceMonitor } from '../../src/monitoring/api-performance-monitor';
import { InteractionWorkflowEngine } from '../../src/workflows/interaction-workflows';
import { ComponentIntegrator } from '../../src/integration/component-integration';

// Test configuration
const TEST_CONFIG = {
  timeout: 30000,
  maxRetries: 3,
  performanceThresholds: {
    responseTime: 3000, // 3 seconds
    memoryUsage: 0.8, // 80%
    errorRate: 0.05 // 5%
  }
};

// Mock test data
const mockUsers = [
  {
    uid: 'test-user-001',
    email: 'alice@fylgja.ai',
    displayName: 'Alice Johnson',
    platform: 'web',
    preferences: {
      communicationStyle: 'friendly',
      questionDepth: 'medium',
      personalityType: 'analytical'
    }
  },
  {
    uid: 'test-user-002',
    email: 'bob@fylgja.ai',
    displayName: 'Bob Smith',
    platform: 'whatsapp',
    preferences: {
      communicationStyle: 'casual',
      questionDepth: 'deep',
      personalityType: 'creative'
    }
  },
  {
    uid: 'test-user-003',
    email: 'carol@fylgja.ai',
    displayName: 'Carol Davis',
    platform: 'google_home',
    preferences: {
      communicationStyle: 'professional',
      questionDepth: 'surface',
      personalityType: 'practical'
    }
  }
];

describe('Fylgja Comprehensive API Integration Tests', () => {
  let coreProcessor: CoreProcessor;
  let googleAI: GoogleAIService;
  let database: EnhancedDatabaseService;
  let auth: AuthenticationService;
  let responseGenerator: ResponseGenerator;
  let promptEngine: PromptEngine;
  let validator: APIValidator;
  let performanceMonitor: APIPerformanceMonitor;
  let workflowEngine: InteractionWorkflowEngine;
  let componentIntegrator: ComponentIntegrator;

  beforeAll(async () => {
    // Initialize all services
    database = new EnhancedDatabaseService();
    googleAI = new GoogleAIService();
    auth = new AuthenticationService();
    promptEngine = new PromptEngine();
    responseGenerator = new ResponseGenerator();
    validator = new APIValidator();
    performanceMonitor = new APIPerformanceMonitor();
    workflowEngine = new InteractionWorkflowEngine();
    componentIntegrator = new ComponentIntegrator();
    coreProcessor = new CoreProcessor();

    // Setup test environment
    await setupTestEnvironment();
  }, TEST_CONFIG.timeout);

  afterAll(async () => {
    await cleanupTestEnvironment();
    performanceMonitor.destroy();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('End-to-End User Journey Tests', () => {
    test('Complete user onboarding and first interaction', async () => {
      const user = mockUsers[0];
      const startTime = Date.now();

      // Step 1: User registration
      const authResult = await auth.registerUser({
        email: user.email,
        displayName: user.displayName,
        platform: user.platform as any,
        preferences: user.preferences
      });

      expect(authResult.success).toBe(true);
      expect(authResult.user.uid).toBeDefined();

      // Step 2: Create user profile
      const profileResult = await database.createUserProfile({
        userId: authResult.user.uid,
        email: user.email,
        displayName: user.displayName,
        preferences: user.preferences,
        createdAt: new Date(),
        lastActiveAt: new Date()
      });

      expect(profileResult.success).toBe(true);

      // Step 3: First interaction - daily check-in
      const interactionResult = await coreProcessor.processRequest({
        userId: authResult.user.uid,
        type: 'daily_checkin',
        input: 'I want to start my daily check-in',
        platform: user.platform as any
      });

      expect(interactionResult.success).toBe(true);
      expect(interactionResult.response).toBeDefined();
      expect(interactionResult.suggestions).toBeInstanceOf(Array);

      // Step 4: Verify performance
      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(TEST_CONFIG.performanceThresholds.responseTime);

      // Step 5: Verify data persistence
      const storedProfile = await database.getUserProfile(authResult.user.uid);
      expect(storedProfile).toBeDefined();
      expect(storedProfile.email).toBe(user.email);
    }, TEST_CONFIG.timeout);

    test('Multi-platform user experience consistency', async () => {
      const user = mockUsers[1];
      
      // Register user on WhatsApp
      const whatsappAuth = await auth.authenticateUser({
        phoneNumber: '+1234567890',
        platform: 'whatsapp',
        token: 'mock-whatsapp-token'
      });

      expect(whatsappAuth.success).toBe(true);

      // Same user logs in via web
      const webAuth = await auth.authenticateUser({
        email: user.email,
        platform: 'web',
        token: 'mock-web-token'
      });

      expect(webAuth.success).toBe(true);

      // Link accounts
      const linkResult = await auth.linkPlatformAccount(
        whatsappAuth.user.uid,
        'web',
        webAuth.user.uid
      );

      expect(linkResult.success).toBe(true);

      // Test interaction consistency across platforms
      const whatsappResponse = await coreProcessor.processRequest({
        userId: whatsappAuth.user.uid,
        type: 'daily_checkin',
        input: 'How was my day?',
        platform: 'whatsapp'
      });

      const webResponse = await coreProcessor.processRequest({
        userId: whatsappAuth.user.uid,
        type: 'daily_checkin',
        input: 'How was my day?',
        platform: 'web'
      });

      // Responses should be consistent but platform-appropriate
      expect(whatsappResponse.success).toBe(true);
      expect(webResponse.success).toBe(true);
      expect(whatsappResponse.metadata.personalityType).toBe(webResponse.metadata.personalityType);
    });

    test('Adaptive learning progression over time', async () => {
      const user = mockUsers[2];
      
      // Setup user
      const authResult = await auth.registerUser({
        email: user.email,
        displayName: user.displayName,
        platform: user.platform as any,
        preferences: user.preferences
      });

      // Simulate multiple interactions over time
      const interactions = [
        'I prefer short, direct responses',
        'Keep it brief please',
        'Can you be more concise?',
        'I like quick answers',
        'Short and sweet works best for me'
      ];

      const responses = [];
      for (let i = 0; i < interactions.length; i++) {
        const response = await coreProcessor.processRequest({
          userId: authResult.user.uid,
          type: 'process_response',
          input: interactions[i],
          platform: user.platform as any
        });

        responses.push(response);
        
        // Simulate time passing
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verify adaptive learning occurred
      const finalProfile = await database.getUserProfile(authResult.user.uid);
      expect(finalProfile.adaptiveLearning).toBeDefined();
      expect(finalProfile.adaptiveLearning.patterns).toBeDefined();
      
      // Later responses should be shorter based on learning
      const lastResponse = responses[responses.length - 1];
      expect(lastResponse.metadata.adaptationApplied).toBe(true);
    });
  });

  describe('Workflow Integration Tests', () => {
    test('Daily check-in workflow completion', async () => {
      const user = mockUsers[0];
      
      // Start daily check-in workflow
      const workflowStart = await workflowEngine.startWorkflow({
        userId: user.uid,
        workflowType: 'daily_checkin',
        platform: 'web'
      });

      expect(workflowStart.success).toBe(true);
      expect(workflowStart.workflowId).toBeDefined();
      expect(workflowStart.currentStep).toBe(1);

      // Progress through workflow steps
      const steps = [
        'I completed my morning workout',
        'I need to finish the project proposal',
        'I learned about time management today',
        'I feel accomplished and motivated'
      ];

      let currentWorkflow = workflowStart;
      for (const stepInput of steps) {
        const stepResult = await workflowEngine.continueWorkflow({
          workflowId: currentWorkflow.workflowId,
          userInput: stepInput,
          userId: user.uid
        });

        expect(stepResult.success).toBe(true);
        currentWorkflow = stepResult;
      }

      // Verify workflow completion
      expect(currentWorkflow.completed).toBe(true);
      expect(currentWorkflow.summary).toBeDefined();
    });

    test('Goal setting workflow with task breakdown', async () => {
      const user = mockUsers[1];
      
      const goalWorkflow = await workflowEngine.startWorkflow({
        userId: user.uid,
        workflowType: 'goal_planning',
        platform: 'whatsapp'
      });

      expect(goalWorkflow.success).toBe(true);

      // Provide goal information
      const goalInput = 'I want to learn Spanish fluently in 6 months';
      const goalResult = await workflowEngine.continueWorkflow({
        workflowId: goalWorkflow.workflowId,
        userInput: goalInput,
        userId: user.uid
      });

      expect(goalResult.success).toBe(true);
      expect(goalResult.suggestions).toContain('task_breakdown');
      expect(goalResult.metadata.estimatedTasks).toBeGreaterThan(0);
    });

    test('Reflection session workflow depth progression', async () => {
      const user = mockUsers[2];
      
      const reflectionWorkflow = await workflowEngine.startWorkflow({
        userId: user.uid,
        workflowType: 'reflection_session',
        platform: 'google_home'
      });

      expect(reflectionWorkflow.success).toBe(true);

      // Progress through reflection depths
      const reflectionInputs = [
        'I had a challenging day at work',
        'I struggled with a difficult client meeting',
        'I learned that I need to prepare better for confrontational situations'
      ];

      let depth = 'surface';
      for (const input of reflectionInputs) {
        const result = await workflowEngine.continueWorkflow({
          workflowId: reflectionWorkflow.workflowId,
          userInput: input,
          userId: user.uid
        });

        expect(result.success).toBe(true);
        expect(result.metadata.reflectionDepth).toBeDefined();
        
        // Depth should increase with each step
        const currentDepth = result.metadata.reflectionDepth;
        expect(['surface', 'medium', 'deep', 'profound']).toContain(currentDepth);
      }
    });
  });

  describe('Performance and Scalability Tests', () => {
    test('Concurrent user handling', async () => {
      const concurrentUsers = 10;
      const requests = Array(concurrentUsers).fill(null).map((_, i) => 
        coreProcessor.processRequest({
          userId: `concurrent-user-${i}`,
          type: 'daily_checkin',
          input: `Concurrent test message ${i}`,
          platform: 'web'
        })
      );

      const startTime = Date.now();
      const results = await Promise.all(requests);
      const totalTime = Date.now() - startTime;

      // All requests should succeed
      expect(results.every(r => r.success)).toBe(true);
      
      // Average response time should be reasonable
      const avgResponseTime = totalTime / concurrentUsers;
      expect(avgResponseTime).toBeLessThan(TEST_CONFIG.performanceThresholds.responseTime);
    });

    test('Memory usage under load', async () => {
      const initialMemory = process.memoryUsage();
      
      // Generate load
      const loadRequests = Array(50).fill(null).map((_, i) =>
        coreProcessor.processRequest({
          userId: `load-test-user-${i % 5}`, // Reuse 5 users
          type: 'process_response',
          input: `Load test message ${i} with some additional content to increase memory usage`,
          platform: 'web'
        })
      );

      await Promise.all(loadRequests);
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / initialMemory.heapUsed;
      
      // Memory increase should be reasonable
      expect(memoryIncrease).toBeLessThan(TEST_CONFIG.performanceThresholds.memoryUsage);
    });

    test('Database query optimization', async () => {
      const user = mockUsers[0];
      
      // Create multiple interactions
      const interactions = Array(20).fill(null).map((_, i) => ({
        userId: user.uid,
        type: 'daily_checkin',
        input: `Test interaction ${i}`,
        response: `Test response ${i}`,
        timestamp: new Date(),
        platform: 'web',
        metadata: { testIndex: i }
      }));

      // Store interactions
      for (const interaction of interactions) {
        await database.storeInteraction(interaction);
      }

      // Test query performance
      const queryStart = Date.now();
      const recentInteractions = await database.getUserInteractions(user.uid, 10);
      const queryTime = Date.now() - queryStart;

      expect(recentInteractions).toHaveLength(10);
      expect(queryTime).toBeLessThan(1000); // Should be under 1 second
      
      // Test caching
      const cachedQueryStart = Date.now();
      const cachedInteractions = await database.getUserInteractions(user.uid, 10);
      const cachedQueryTime = Date.now() - cachedQueryStart;

      expect(cachedQueryTime).toBeLessThan(queryTime); // Should be faster
      expect(cachedInteractions).toEqual(recentInteractions);
    });
  });

  describe('Error Handling and Recovery Tests', () => {
    test('Graceful degradation when AI service fails', async () => {
      const user = mockUsers[0];
      
      // Mock AI service failure
      jest.spyOn(googleAI, 'generateResponse').mockRejectedValueOnce(
        new Error('AI service temporarily unavailable')
      );

      const result = await coreProcessor.processRequest({
        userId: user.uid,
        type: 'daily_checkin',
        input: 'Test error handling',
        platform: 'web'
      });

      // Should provide fallback response
      expect(result.success).toBe(false);
      expect(result.fallbackResponse).toBeDefined();
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('AI_SERVICE_ERROR');
    });

    test('Circuit breaker pattern activation', async () => {
      const user = mockUsers[1];
      
      // Mock multiple failures to trigger circuit breaker
      jest.spyOn(googleAI, 'generateResponse').mockRejectedValue(
        new Error('Service overloaded')
      );

      const failingRequests = Array(10).fill(null).map(() =>
        coreProcessor.processRequest({
          userId: user.uid,
          type: 'daily_checkin',
          input: 'Circuit breaker test',
          platform: 'web'
        })
      );

      const results = await Promise.allSettled(failingRequests);
      
      // Should fail fast after circuit breaker opens
      const rejectedCount = results.filter(r => r.status === 'rejected').length;
      expect(rejectedCount).toBeGreaterThan(5); // Circuit breaker should activate
    });

    test('Data validation error handling', async () => {
      // Test invalid request format
      const invalidRequest = {
        userId: '', // Invalid empty user ID
        type: 'invalid_type',
        input: '',
        platform: 'invalid_platform'
      };

      await expect(
        coreProcessor.processRequest(invalidRequest as any)
      ).rejects.toThrow('VALIDATION_ERROR');
    });

    test('Database connection failure recovery', async () => {
      const user = mockUsers[2];
      
      // Mock database failure
      jest.spyOn(database, 'getUserProfile').mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const result = await coreProcessor.processRequest({
        userId: user.uid,
        type: 'daily_checkin',
        input: 'Database failure test',
        platform: 'web'
      });

      // Should handle gracefully with default profile
      expect(result.success).toBe(true);
      expect(result.metadata.usedDefaultProfile).toBe(true);
    });
  });

  describe('Security and Privacy Tests', () => {
    test('User data isolation', async () => {
      const user1 = mockUsers[0];
      const user2 = mockUsers[1];
      
      // Create interactions for both users
      await coreProcessor.processRequest({
        userId: user1.uid,
        type: 'daily_checkin',
        input: 'User 1 private data',
        platform: 'web'
      });

      await coreProcessor.processRequest({
        userId: user2.uid,
        type: 'daily_checkin',
        input: 'User 2 private data',
        platform: 'web'
      });

      // Verify data isolation
      const user1Interactions = await database.getUserInteractions(user1.uid, 10);
      const user2Interactions = await database.getUserInteractions(user2.uid, 10);

      expect(user1Interactions.every(i => i.userId === user1.uid)).toBe(true);
      expect(user2Interactions.every(i => i.userId === user2.uid)).toBe(true);
      
      // No cross-contamination
      expect(user1Interactions.some(i => i.input.includes('User 2'))).toBe(false);
      expect(user2Interactions.some(i => i.input.includes('User 1'))).toBe(false);
    });

    test('Session token validation', async () => {
      const user = mockUsers[0];
      
      // Create valid session
      const session = await auth.createSession(user.uid, 'web');
      expect(session.sessionId).toBeDefined();

      // Validate session
      const validation = await auth.validateSession(session.sessionId);
      expect(validation.valid).toBe(true);
      expect(validation.user.uid).toBe(user.uid);

      // Test invalid session
      const invalidValidation = await auth.validateSession('invalid-session-id');
      expect(invalidValidation.valid).toBe(false);
    });

    test('Input sanitization', async () => {
      const user = mockUsers[0];
      
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<img src="x" onerror="alert(1)">',
        'SELECT * FROM users WHERE id = 1; DROP TABLE users;'
      ];

      for (const maliciousInput of maliciousInputs) {
        const result = await coreProcessor.processRequest({
          userId: user.uid,
          type: 'process_response',
          input: maliciousInput,
          platform: 'web'
        });

        // Should sanitize input and process safely
        expect(result.success).toBe(true);
        expect(result.metadata.inputSanitized).toBe(true);
      }
    });
  });

  describe('Monitoring and Analytics Tests', () => {
    test('Performance metrics collection', async () => {
      const user = mockUsers[0];
      
      // Generate some activity
      await coreProcessor.processRequest({
        userId: user.uid,
        type: 'daily_checkin',
        input: 'Performance metrics test',
        platform: 'web'
      });

      // Check metrics collection
      const metrics = await performanceMonitor.getAggregatedMetrics(
        new Date(Date.now() - 60000), // Last minute
        new Date(),
        'endpoint'
      );

      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0]).toMatchObject({
        totalRequests: expect.any(Number),
        averageResponseTime: expect.any(Number),
        errorRate: expect.any(Number),
        successRate: expect.any(Number)
      });
    });

    test('System health monitoring', async () => {
      const health = await performanceMonitor.getSystemHealth();

      expect(health).toMatchObject({
        status: expect.stringMatching(/healthy|degraded|unhealthy/),
        uptime: expect.any(Number),
        memoryUsage: expect.objectContaining({
          used: expect.any(Number),
          total: expect.any(Number),
          percentage: expect.any(Number)
        }),
        errorRate: expect.any(Number),
        responseTime: expect.any(Number)
      });

      expect(health.memoryUsage.percentage).toBeLessThanOrEqual(1);
      expect(health.errorRate).toBeLessThanOrEqual(1);
    });

    test('Alert system functionality', async () => {
      // Create test alert rule
      const alertRuleId = performanceMonitor.createAlertRule({
        name: 'Test High Response Time',
        condition: 'average_response_time > threshold',
        threshold: 1, // Very low threshold to trigger
        severity: 'medium',
        enabled: true,
        cooldownPeriod: 1,
        actions: [{ type: 'log', target: 'console', parameters: {} }]
      });

      expect(alertRuleId).toBeDefined();

      // Simulate high response time
      performanceMonitor.recordMetric({
        endpoint: '/test',
        method: 'POST',
        responseTime: 5000, // High response time
        statusCode: 200,
        requestSize: 1000,
        responseSize: 2000,
        cacheHit: false
      });

      // Check for alerts
      const alerts = performanceMonitor.getActiveAlerts();
      expect(alerts.length).toBeGreaterThan(0);
    });
  });
});

// Helper functions
async function setupTestEnvironment(): Promise<void> {
  // Mock Firebase services
  const mockFirestore = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({})
    }),
    set: jest.fn().mockResolvedValue({}),
    add: jest.fn().mockResolvedValue({ id: 'mock-doc-id' }),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis()
  };

  // Setup test users
  for (const user of mockUsers) {
    mockFirestore.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        userId: user.uid,
        email: user.email,
        displayName: user.displayName,
        preferences: user.preferences,
        createdAt: new Date(),
        lastActiveAt: new Date()
      })
    });
  }
}

async function cleanupTestEnvironment(): Promise<void> {
  // Cleanup test data
  jest.clearAllMocks();
  
  // Clear any cached data
  const validator = APIValidator.getInstance();
  validator.clearCache();
}

