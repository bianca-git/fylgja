/**
 * Jest test setup for Fylgja Cloud Functions
 * This file runs before all tests to set up the testing environment
 */

import * as admin from 'firebase-admin';

// Mock Firebase Admin SDK for testing
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(() => ({
    collection: jest.fn(),
    doc: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  })),
  auth: jest.fn(() => ({
    verifyIdToken: jest.fn(),
    getUser: jest.fn(),
    createUser: jest.fn(),
  })),
  FieldValue: {
    serverTimestamp: jest.fn(() => 'MOCK_TIMESTAMP'),
    arrayUnion: jest.fn((value) => ({ arrayUnion: value })),
    arrayRemove: jest.fn((value) => ({ arrayRemove: value })),
    increment: jest.fn((value) => ({ increment: value })),
    delete: jest.fn(() => 'MOCK_DELETE'),
  },
  Timestamp: {
    now: jest.fn(() => ({ seconds: 1234567890, nanoseconds: 0 })),
    fromDate: jest.fn((date) => ({ seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 })),
  },
}));

// Mock Google AI SDK
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn(() => ({
      generateContent: jest.fn(() => Promise.resolve({
        response: {
          text: jest.fn(() => 'Mock AI response'),
        },
      })),
    })),
  })),
}));

// Mock Twilio SDK
jest.mock('twilio', () => {
  return jest.fn(() => ({
    messages: {
      create: jest.fn(() => Promise.resolve({
        sid: 'mock_message_sid',
        status: 'sent',
      })),
    },
  }));
});

// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.GOOGLE_GEMINI_APIKEY = 'test-api-key';
process.env.TWILIO_ACCOUNT_SID = 'test-account-sid';
process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';

// Global test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidTimestamp(): R;
      toBeValidUserId(): R;
      toHaveValidStructure(expectedKeys: string[]): R;
    }
  }
}

// Custom Jest matchers
expect.extend({
  toBeValidTimestamp(received) {
    const isValid = received && 
      (typeof received === 'object' || typeof received === 'string') &&
      !isNaN(new Date(received).getTime());
    
    return {
      message: () => `expected ${received} to be a valid timestamp`,
      pass: isValid,
    };
  },

  toBeValidUserId(received) {
    const isValid = typeof received === 'string' && received.length > 0;
    
    return {
      message: () => `expected ${received} to be a valid user ID`,
      pass: isValid,
    };
  },

  toHaveValidStructure(received, expectedKeys) {
    const receivedKeys = Object.keys(received || {});
    const hasAllKeys = expectedKeys.every(key => receivedKeys.includes(key));
    
    return {
      message: () => `expected object to have keys: ${expectedKeys.join(', ')}. Got: ${receivedKeys.join(', ')}`,
      pass: hasAllKeys,
    };
  },
});

// Mock console methods in test environment
const originalConsole = console;
beforeAll(() => {
  global.console = {
    ...originalConsole,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
});

afterAll(() => {
  global.console = originalConsole;
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Test data factories
export const createMockUser = (overrides = {}) => ({
  uid: 'test-user-123',
  email: 'test@example.com',
  name: 'Test User',
  createdAt: new Date().toISOString(),
  ...overrides,
});

export const createMockInteraction = (overrides = {}) => ({
  id: 'interaction-123',
  userId: 'test-user-123',
  timestamp: new Date().toISOString(),
  platform: 'web',
  type: 'checkin',
  userMessage: 'Test message',
  fylgjaResponse: 'Test response',
  ...overrides,
});

export const createMockTask = (overrides = {}) => ({
  id: 'task-123',
  title: 'Test task',
  status: 'pending',
  priority: 'medium',
  createdAt: new Date().toISOString(),
  ...overrides,
});

// Test helpers
export const waitFor = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const mockFirestoreDoc = (data: any) => ({
  exists: true,
  data: () => data,
  id: 'mock-doc-id',
  ref: {
    id: 'mock-doc-id',
    path: 'mock/path',
  },
});

export const mockFirestoreCollection = (docs: any[]) => ({
  docs: docs.map(doc => mockFirestoreDoc(doc)),
  size: docs.length,
  empty: docs.length === 0,
});

// Performance testing helpers
export const measurePerformance = async (fn: () => Promise<any>): Promise<{ result: any; duration: number }> => {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
};

// Error testing helpers
export const expectToThrow = async (fn: () => Promise<any>, expectedError?: string): Promise<void> => {
  try {
    await fn();
    throw new Error('Expected function to throw');
  } catch (error) {
    if (expectedError && !error.message.includes(expectedError)) {
      throw new Error(`Expected error to contain "${expectedError}", got "${error.message}"`);
    }
  }
};

console.log('🧪 Test environment setup completed');

