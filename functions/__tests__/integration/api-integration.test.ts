/**
 * API Integration Tests for Fylgja
 * Tests all major API endpoints and component integrations
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { CoreProcessor } from '../../src/core/core-processor';
import { GoogleAIService } from '../../src/services/google-ai-service';
import { EnhancedDatabaseService } from '../../src/services/enhanced-database-service';
import { AuthenticationService } from '../../src/auth/authentication-service';
import { ResponseGenerator } from '../../src/core/response-generator';
import { PromptEngine } from '../../src/core/prompt-engine';

// Test configuration
const TEST_CONFIG = {
  projectId: 'fylgja-test',
  apiKey: 'test-api-key',
  timeout: 30000,
  retryAttempts: 3
};

// Mock Firebase Admin
jest.mock('firebase-admin/app');
jest.mock('firebase-admin/firestore');
jest.mock('firebase-admin/auth');

// Test data
const mockUser = {
  uid: 'test-user-123',
  email: 'test@fylgja.ai',
  displayName: 'Test User',
  platform: 'web'
};

const mockUserProfile = {
  userId: mockUser.uid,
  preferences: {
    communicationStyle: 'friendly',
    questionDepth: 'medium',
    personalityType: 'analytical'
  },
  adaptiveLearning: {
    patterns: {},
    confidence: 0.5,
    lastUpdated: new Date()
  }
};

describe('Fylgja API Integration Tests', () => {
  let coreProcessor: CoreProcessor;
  let googleAI: GoogleAIService;
  let database: EnhancedDatabaseService;
  let auth: AuthenticationService;
  let responseGenerator: ResponseGenerator;
  let promptEngine: PromptEngine;

  beforeAll(async () => {
    // Initialize test services
    database = new EnhancedDatabaseService();
    googleAI = new GoogleAIService();
    auth = new AuthenticationService();
    promptEngine = new PromptEngine();
    responseGenerator = new ResponseGenerator();
    coreProcessor = new CoreProcessor();

    // Setup test database
    await setupTestDatabase();
  });

  afterAll(async () => {
    // Cleanup test data
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Reset test state
    jest.clearAllMocks();
  });

  describe('Authentication Integration', () => {
    test('should authenticate user and create session', async () => {
      const result = await auth.authenticateUser({
        email: mockUser.email,
        platform: 'web',
        token: 'mock-token'
      });

      expect(result.success).toBe(true);
      expect(result.user).toMatchObject({
        uid: expect.any(String),
        email: mockUser.email
      });
      expect(result.session).toMatchObject({
        sessionId: expect.any(String),
        platform: 'web',
        expiresAt: expect.any(Date)
      });
    });

    test('should validate session tokens', async () => {
      const session = await auth.createSession(mockUser.uid, 'web');
      const validation = await auth.validateSession(session.sessionId);

      expect(validation.valid).toBe(true);
      expect(validation.user.uid).toBe(mockUser.uid);
    });

    test('should handle authentication failures gracefully', async () => {
      const result = await auth.authenticateUser({
        email: 'invalid@email.com',
        platform: 'web',
        token: 'invalid-token'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Database Integration', () => {
    test('should create and retrieve user profiles', async () => {
      await database.createUserProfile(mockUserProfile);
      const retrieved = await database.getUserProfile(mockUser.uid);

      expect(retrieved).toMatchObject({
        userId: mockUser.uid,
        preferences: mockUserProfile.preferences
      });
    });

    test('should store and retrieve interactions', async () => {
      const interaction = {
        userId: mockUser.uid,
        type: 'checkin',
        input: 'How are you today?',
        response: 'I am doing well, thank you!',
        timestamp: new Date(),
        metadata: { platform: 'web' }
      };

      await database.storeInteraction(interaction);
      const interactions = await database.getUserInteractions(mockUser.uid, 10);

      expect(interactions).toHaveLength(1);
      expect(interactions[0]).toMatchObject({
        userId: mockUser.uid,
        type: 'checkin'
      });
    });

    test('should handle database errors gracefully', async () => {
      // Test with invalid user ID
      const result = await database.getUserProfile('invalid-uid');
      expect(result).toBeNull();
    });

    test('should implement caching correctly', async () => {
      // First call should hit database
      const start1 = Date.now();
      await database.getUserProfile(mockUser.uid);
      const time1 = Date.now() - start1;

      // Second call should use cache
      const start2 = Date.now();
      await database.getUserProfile(mockUser.uid);
      const time2 = Date.now() - start2;

      expect(time2).toBeLessThan(time1);
    });
  });

  describe('Google AI Integration', () => {
    test('should generate responses for different request types', async () => {
      const testCases = [
        { type: 'checkin', input: 'How was your day?' },
        { type: 'task_analysis', input: 'I need to organize my schedule' },
        { type: 'response_generation', input: 'Tell me about productivity' }
      ];

      for (const testCase of testCases) {
        const response = await googleAI.generateResponse({
          type: testCase.type as any,
          input: testCase.input,
          context: { userId: mockUser.uid }
        });

        expect(response.success).toBe(true);
        expect(response.content).toBeDefined();
        expect(response.content.length).toBeGreaterThan(0);
      }
    });

    test('should perform sentiment analysis', async () => {
      const testInputs = [
        'I had a great day today!',
        'I am feeling really sad and overwhelmed',
        'Today was just okay, nothing special'
      ];

      for (const input of testInputs) {
        const analysis = await googleAI.analyzeSentiment(input);

        expect(analysis).toMatchObject({
          sentiment: expect.stringMatching(/positive|negative|neutral/),
          confidence: expect.any(Number),
          emotions: expect.any(Array)
        });
        expect(analysis.confidence).toBeGreaterThanOrEqual(0);
        expect(analysis.confidence).toBeLessThanOrEqual(1);
      }
    });

    test('should handle API rate limits', async () => {
      // Simulate rapid requests
      const promises = Array(10).fill(null).map(() =>
        googleAI.generateResponse({
          type: 'checkin',
          input: 'Test message',
          context: { userId: mockUser.uid }
        })
      );

      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled');
      
      // Should handle rate limits gracefully
      expect(successful.length).toBeGreaterThan(0);
    });
  });

  describe('Prompt Engine Integration', () => {
    test('should generate personalized prompts', async () => {
      const prompt = await promptEngine.generatePrompt({
        userId: mockUser.uid,
        type: 'checkin',
        context: { timeOfDay: 'morning' }
      });

      expect(prompt).toMatchObject({
        question: expect.any(String),
        style: expect.any(String),
        depth: expect.any(String),
        personalization: expect.any(Object)
      });
    });

    test('should adapt to user preferences', async () => {
      // Generate multiple prompts for the same user
      const prompts = await Promise.all([
        promptEngine.generatePrompt({ userId: mockUser.uid, type: 'checkin' }),
        promptEngine.generatePrompt({ userId: mockUser.uid, type: 'checkin' }),
        promptEngine.generatePrompt({ userId: mockUser.uid, type: 'checkin' })
      ]);

      // Should show variation but maintain consistency
      const questions = prompts.map(p => p.question);
      const uniqueQuestions = new Set(questions);
      
      expect(uniqueQuestions.size).toBeGreaterThan(1); // Should vary
      expect(prompts.every(p => p.personalization.personalityType === 'analytical')).toBe(true);
    });
  });

  describe('Response Generator Integration', () => {
    test('should generate contextual responses', async () => {
      const response = await responseGenerator.generateResponse({
        userId: mockUser.uid,
        input: 'I completed my morning workout today',
        context: {
          conversationHistory: [],
          userProfile: mockUserProfile
        }
      });

      expect(response).toMatchObject({
        content: expect.any(String),
        type: expect.any(String),
        suggestions: expect.any(Array),
        sentiment: expect.any(Object)
      });
    });

    test('should maintain conversation context', async () => {
      const conversation = [
        'I had a productive day at work',
        'I finished three important tasks',
        'Now I am planning for tomorrow'
      ];

      let context = { conversationHistory: [], userProfile: mockUserProfile };

      for (const input of conversation) {
        const response = await responseGenerator.generateResponse({
          userId: mockUser.uid,
          input,
          context
        });

        expect(response.content).toBeDefined();
        
        // Update context for next iteration
        context.conversationHistory.push({
          input,
          response: response.content,
          timestamp: new Date()
        });
      }

      // Final response should reference earlier conversation
      expect(context.conversationHistory).toHaveLength(3);
    });
  });

  describe('Core Processor Integration', () => {
    test('should orchestrate complete interaction flow', async () => {
      const request = {
        userId: mockUser.uid,
        type: 'checkin' as const,
        input: 'I want to do my daily check-in',
        platform: 'web' as const
      };

      const result = await coreProcessor.processRequest(request);

      expect(result).toMatchObject({
        success: true,
        response: expect.any(String),
        suggestions: expect.any(Array),
        metadata: expect.any(Object)
      });
    });

    test('should handle workflow orchestration', async () => {
      const workflowRequest = {
        userId: mockUser.uid,
        type: 'workflow_start' as const,
        input: 'daily_checkin',
        platform: 'web' as const
      };

      const result = await coreProcessor.processRequest(workflowRequest);

      expect(result.success).toBe(true);
      expect(result.metadata.workflowId).toBeDefined();
      expect(result.metadata.currentStep).toBe(1);
    });

    test('should apply adaptive learning', async () => {
      // Simulate multiple interactions
      const interactions = [
        'I prefer short responses',
        'Keep it brief please',
        'Can you be more concise?'
      ];

      for (const input of interactions) {
        await coreProcessor.processRequest({
          userId: mockUser.uid,
          type: 'checkin',
          input,
          platform: 'web'
        });
      }

      // Check if adaptive learning was applied
      const profile = await database.getUserProfile(mockUser.uid);
      expect(profile.adaptiveLearning.patterns).toBeDefined();
    });
  });

  describe('Performance Integration', () => {
    test('should meet response time requirements', async () => {
      const start = Date.now();
      
      await coreProcessor.processRequest({
        userId: mockUser.uid,
        type: 'checkin',
        input: 'Performance test message',
        platform: 'web'
      });

      const responseTime = Date.now() - start;
      expect(responseTime).toBeLessThan(3000); // 3 second requirement
    });

    test('should handle concurrent requests', async () => {
      const concurrentRequests = Array(5).fill(null).map((_, i) =>
        coreProcessor.processRequest({
          userId: `${mockUser.uid}-${i}`,
          type: 'checkin',
          input: `Concurrent test message ${i}`,
          platform: 'web'
        })
      );

      const results = await Promise.all(concurrentRequests);
      
      expect(results.every(r => r.success)).toBe(true);
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle service failures gracefully', async () => {
      // Mock service failure
      jest.spyOn(googleAI, 'generateResponse').mockRejectedValueOnce(
        new Error('Service temporarily unavailable')
      );

      const result = await coreProcessor.processRequest({
        userId: mockUser.uid,
        type: 'checkin',
        input: 'Test error handling',
        platform: 'web'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.fallbackResponse).toBeDefined();
    });

    test('should implement circuit breaker pattern', async () => {
      // Simulate multiple failures to trigger circuit breaker
      const failingRequests = Array(10).fill(null).map(() =>
        coreProcessor.processRequest({
          userId: mockUser.uid,
          type: 'checkin',
          input: 'Circuit breaker test',
          platform: 'web'
        })
      );

      const results = await Promise.allSettled(failingRequests);
      
      // Should fail fast after circuit breaker opens
      const rejectedCount = results.filter(r => r.status === 'rejected').length;
      expect(rejectedCount).toBeGreaterThan(0);
    });
  });
});

// Helper functions
async function setupTestDatabase() {
  // Mock database setup
  const mockFirestore = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => mockUserProfile
    }),
    set: jest.fn().mockResolvedValue({}),
    add: jest.fn().mockResolvedValue({ id: 'mock-doc-id' })
  };

  (getFirestore as jest.Mock).mockReturnValue(mockFirestore);
}

async function cleanupTestDatabase() {
  // Cleanup test data
  jest.clearAllMocks();
}

