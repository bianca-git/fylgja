/**
 * Performance and Load Testing Suite for Fylgja
 * Tests system performance under various load conditions
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { CoreProcessor } from '../../src/core/core-processor';
import { APIPerformanceMonitor } from '../../src/monitoring/api-performance-monitor';
import { EnhancedDatabaseService } from '../../src/services/enhanced-database-service';

// Performance test configuration
const LOAD_TEST_CONFIG = {
  timeout: 60000, // 1 minute for load tests
  concurrentUsers: [1, 5, 10, 25, 50, 100],
  requestsPerUser: 10,
  performanceTargets: {
    responseTime: {
      p50: 1000, // 1 second
      p95: 3000, // 3 seconds
      p99: 5000  // 5 seconds
    },
    throughput: {
      minimum: 10, // requests per second
      target: 50   // requests per second
    },
    errorRate: {
      maximum: 0.01 // 1%
    },
    memoryGrowth: {
      maximum: 0.5 // 50% increase
    }
  }
};

// Test data generators
function generateTestUser(index: number) {
  return {
    uid: `load-test-user-${index}`,
    email: `user${index}@loadtest.fylgja.ai`,
    displayName: `Load Test User ${index}`,
    platform: ['web', 'whatsapp', 'google_home'][index % 3] as any,
    preferences: {
      communicationStyle: ['friendly', 'casual', 'professional'][index % 3] as any,
      questionDepth: ['surface', 'medium', 'deep'][index % 3] as any,
      personalityType: ['analytical', 'creative', 'practical'][index % 3] as any
    }
  };
}

function generateTestRequest(userId: string, requestIndex: number) {
  const requestTypes = ['daily_checkin', 'process_response', 'task_analysis', 'goal_setting'];
  const inputs = [
    'I completed my morning workout today',
    'I need to organize my schedule for next week',
    'I learned something new about time management',
    'I want to set a goal for improving my productivity',
    'How can I better balance work and personal life?',
    'I finished reading a book about leadership',
    'I need help prioritizing my tasks',
    'I want to reflect on my progress this month'
  ];

  return {
    userId,
    type: requestTypes[requestIndex % requestTypes.length] as any,
    input: inputs[requestIndex % inputs.length],
    platform: ['web', 'whatsapp', 'google_home'][requestIndex % 3] as any
  };
}

describe('Fylgja Performance and Load Tests', () => {
  let coreProcessor: CoreProcessor;
  let performanceMonitor: APIPerformanceMonitor;
  let database: EnhancedDatabaseService;
  let initialMemory: NodeJS.MemoryUsage;

  beforeAll(async () => {
    coreProcessor = new CoreProcessor();
    performanceMonitor = new APIPerformanceMonitor();
    database = new EnhancedDatabaseService();
    initialMemory = process.memoryUsage();
  }, 30000);

  afterAll(() => {
    performanceMonitor.destroy();
  });

  describe('Single User Performance Tests', () => {
    test('Response time consistency', async () => {
      const user = generateTestUser(1);
      const responseTimes: number[] = [];

      // Warm up
      await coreProcessor.processRequest(generateTestRequest(user.uid, 0));

      // Measure response times
      for (let i = 0; i < 20; i++) {
        const startTime = Date.now();
        const result = await coreProcessor.processRequest(generateTestRequest(user.uid, i));
        const responseTime = Date.now() - startTime;

        expect(result.success).toBe(true);
        responseTimes.push(responseTime);
      }

      // Analyze response times
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const sortedTimes = responseTimes.sort((a, b) => a - b);
      const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
      const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
      const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];

      expect(avgResponseTime).toBeLessThan(LOAD_TEST_CONFIG.performanceTargets.responseTime.p50);
      expect(p50).toBeLessThan(LOAD_TEST_CONFIG.performanceTargets.responseTime.p50);
      expect(p95).toBeLessThan(LOAD_TEST_CONFIG.performanceTargets.responseTime.p95);
      expect(p99).toBeLessThan(LOAD_TEST_CONFIG.performanceTargets.responseTime.p99);

      console.log(`Single user performance:
        Average: ${avgResponseTime}ms
        P50: ${p50}ms
        P95: ${p95}ms
        P99: ${p99}ms`);
    });

    test('Memory usage stability', async () => {
      const user = generateTestUser(2);
      const memorySnapshots: number[] = [];

      // Take initial memory snapshot
      memorySnapshots.push(process.memoryUsage().heapUsed);

      // Generate load
      for (let i = 0; i < 100; i++) {
        await coreProcessor.processRequest(generateTestRequest(user.uid, i));
        
        if (i % 10 === 0) {
          memorySnapshots.push(process.memoryUsage().heapUsed);
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = (finalMemory - memorySnapshots[0]) / memorySnapshots[0];

      expect(memoryGrowth).toBeLessThan(LOAD_TEST_CONFIG.performanceTargets.memoryGrowth.maximum);

      console.log(`Memory usage:
        Initial: ${(memorySnapshots[0] / 1024 / 1024).toFixed(2)}MB
        Final: ${(finalMemory / 1024 / 1024).toFixed(2)}MB
        Growth: ${(memoryGrowth * 100).toFixed(2)}%`);
    });
  });

  describe('Concurrent User Load Tests', () => {
    test.each(LOAD_TEST_CONFIG.concurrentUsers)(
      'Handle %i concurrent users',
      async (concurrentUsers) => {
        const users = Array(concurrentUsers).fill(null).map((_, i) => generateTestUser(i));
        const allRequests: Promise<any>[] = [];
        const startTime = Date.now();

        // Generate concurrent requests
        for (const user of users) {
          for (let i = 0; i < LOAD_TEST_CONFIG.requestsPerUser; i++) {
            const request = coreProcessor.processRequest(generateTestRequest(user.uid, i));
            allRequests.push(request);
          }
        }

        // Execute all requests concurrently
        const results = await Promise.allSettled(allRequests);
        const endTime = Date.now();

        // Analyze results
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
        const failed = results.filter(r => r.status === 'rejected' || !r.value?.success);
        
        const successRate = successful.length / results.length;
        const errorRate = failed.length / results.length;
        const totalTime = endTime - startTime;
        const throughput = results.length / (totalTime / 1000);

        // Assertions
        expect(errorRate).toBeLessThan(LOAD_TEST_CONFIG.performanceTargets.errorRate.maximum);
        expect(throughput).toBeGreaterThan(LOAD_TEST_CONFIG.performanceTargets.throughput.minimum);

        console.log(`${concurrentUsers} concurrent users:
          Total requests: ${results.length}
          Success rate: ${(successRate * 100).toFixed(2)}%
          Error rate: ${(errorRate * 100).toFixed(2)}%
          Throughput: ${throughput.toFixed(2)} req/s
          Total time: ${totalTime}ms`);
      },
      LOAD_TEST_CONFIG.timeout
    );

    test('Sustained load over time', async () => {
      const concurrentUsers = 10;
      const durationMinutes = 2;
      const requestInterval = 5000; // 5 seconds between requests

      const users = Array(concurrentUsers).fill(null).map((_, i) => generateTestUser(i + 1000));
      const results: any[] = [];
      const startTime = Date.now();
      const endTime = startTime + (durationMinutes * 60 * 1000);

      let requestCounter = 0;

      // Sustained load loop
      while (Date.now() < endTime) {
        const batchPromises = users.map(user => 
          coreProcessor.processRequest(generateTestRequest(user.uid, requestCounter))
        );

        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);
        requestCounter++;

        // Wait before next batch
        await new Promise(resolve => setTimeout(resolve, requestInterval));
      }

      // Analyze sustained load results
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
      const errorRate = (results.length - successful.length) / results.length;
      const totalDuration = Date.now() - startTime;
      const avgThroughput = results.length / (totalDuration / 1000);

      expect(errorRate).toBeLessThan(LOAD_TEST_CONFIG.performanceTargets.errorRate.maximum);
      expect(avgThroughput).toBeGreaterThan(LOAD_TEST_CONFIG.performanceTargets.throughput.minimum);

      console.log(`Sustained load (${durationMinutes} minutes):
        Total requests: ${results.length}
        Error rate: ${(errorRate * 100).toFixed(2)}%
        Average throughput: ${avgThroughput.toFixed(2)} req/s`);
    }, LOAD_TEST_CONFIG.timeout);
  });

  describe('Database Performance Tests', () => {
    test('Database query performance under load', async () => {
      const users = Array(20).fill(null).map((_, i) => generateTestUser(i + 2000));
      
      // Create test data
      const interactions = [];
      for (const user of users) {
        for (let i = 0; i < 50; i++) {
          interactions.push({
            userId: user.uid,
            type: 'daily_checkin',
            input: `Test interaction ${i}`,
            response: `Test response ${i}`,
            timestamp: new Date(Date.now() - i * 60000), // Spread over time
            platform: user.platform,
            metadata: { testIndex: i }
          });
        }
      }

      // Store interactions
      const storeStartTime = Date.now();
      for (const interaction of interactions) {
        await database.storeInteraction(interaction);
      }
      const storeTime = Date.now() - storeStartTime;

      // Test concurrent queries
      const queryStartTime = Date.now();
      const queryPromises = users.map(user => 
        database.getUserInteractions(user.uid, 10)
      );
      const queryResults = await Promise.all(queryPromises);
      const queryTime = Date.now() - queryStartTime;

      // Verify results
      expect(queryResults.every(result => result.length === 10)).toBe(true);
      expect(storeTime / interactions.length).toBeLessThan(100); // < 100ms per store
      expect(queryTime / users.length).toBeLessThan(200); // < 200ms per query

      console.log(`Database performance:
        Store time: ${storeTime}ms for ${interactions.length} interactions
        Query time: ${queryTime}ms for ${users.length} queries
        Avg store time: ${(storeTime / interactions.length).toFixed(2)}ms
        Avg query time: ${(queryTime / users.length).toFixed(2)}ms`);
    });

    test('Cache performance under load', async () => {
      const user = generateTestUser(3000);
      const cacheHits: number[] = [];
      const cacheMisses: number[] = [];

      // First query (cache miss)
      const missStartTime = Date.now();
      await database.getUserProfile(user.uid);
      const missTime = Date.now() - missStartTime;
      cacheMisses.push(missTime);

      // Subsequent queries (cache hits)
      for (let i = 0; i < 10; i++) {
        const hitStartTime = Date.now();
        await database.getUserProfile(user.uid);
        const hitTime = Date.now() - hitStartTime;
        cacheHits.push(hitTime);
      }

      const avgCacheHitTime = cacheHits.reduce((a, b) => a + b, 0) / cacheHits.length;
      const avgCacheMissTime = cacheMisses.reduce((a, b) => a + b, 0) / cacheMisses.length;

      // Cache hits should be significantly faster
      expect(avgCacheHitTime).toBeLessThan(avgCacheMissTime * 0.5);

      console.log(`Cache performance:
        Average cache miss time: ${avgCacheMissTime.toFixed(2)}ms
        Average cache hit time: ${avgCacheHitTime.toFixed(2)}ms
        Speed improvement: ${(avgCacheMissTime / avgCacheHitTime).toFixed(2)}x`);
    });
  });

  describe('Resource Utilization Tests', () => {
    test('CPU usage under load', async () => {
      const users = Array(25).fill(null).map((_, i) => generateTestUser(i + 4000));
      
      // Monitor CPU usage during load
      const cpuUsageBefore = process.cpuUsage();
      const startTime = Date.now();

      // Generate CPU-intensive load
      const requests = [];
      for (const user of users) {
        for (let i = 0; i < 20; i++) {
          requests.push(coreProcessor.processRequest(generateTestRequest(user.uid, i)));
        }
      }

      await Promise.all(requests);

      const cpuUsageAfter = process.cpuUsage(cpuUsageBefore);
      const totalTime = Date.now() - startTime;

      // Calculate CPU utilization
      const userCPUTime = cpuUsageAfter.user / 1000; // Convert to milliseconds
      const systemCPUTime = cpuUsageAfter.system / 1000;
      const totalCPUTime = userCPUTime + systemCPUTime;
      const cpuUtilization = (totalCPUTime / totalTime) * 100;

      console.log(`CPU utilization:
        Total requests: ${requests.length}
        Total time: ${totalTime}ms
        CPU time: ${totalCPUTime.toFixed(2)}ms
        CPU utilization: ${cpuUtilization.toFixed(2)}%`);

      // CPU utilization should be reasonable
      expect(cpuUtilization).toBeLessThan(80); // Less than 80%
    });

    test('Memory leak detection', async () => {
      const user = generateTestUser(5000);
      const memorySnapshots: number[] = [];
      const iterations = 200;

      // Take memory snapshots during load
      for (let i = 0; i < iterations; i++) {
        await coreProcessor.processRequest(generateTestRequest(user.uid, i));
        
        if (i % 20 === 0) {
          memorySnapshots.push(process.memoryUsage().heapUsed);
        }
      }

      // Force garbage collection
      if (global.gc) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const finalMemory = process.memoryUsage().heapUsed;
      memorySnapshots.push(finalMemory);

      // Check for memory leaks
      const initialMemory = memorySnapshots[0];
      const peakMemory = Math.max(...memorySnapshots);
      const memoryGrowth = (finalMemory - initialMemory) / initialMemory;
      const memoryEfficiency = finalMemory / peakMemory;

      console.log(`Memory leak detection:
        Initial memory: ${(initialMemory / 1024 / 1024).toFixed(2)}MB
        Peak memory: ${(peakMemory / 1024 / 1024).toFixed(2)}MB
        Final memory: ${(finalMemory / 1024 / 1024).toFixed(2)}MB
        Memory growth: ${(memoryGrowth * 100).toFixed(2)}%
        Memory efficiency: ${(memoryEfficiency * 100).toFixed(2)}%`);

      // Memory growth should be minimal
      expect(memoryGrowth).toBeLessThan(0.3); // Less than 30% growth
      expect(memoryEfficiency).toBeGreaterThan(0.7); // At least 70% efficiency
    });
  });

  describe('Stress Testing', () => {
    test('Breaking point analysis', async () => {
      const maxUsers = 200;
      const stepSize = 25;
      const results: Array<{
        users: number;
        successRate: number;
        avgResponseTime: number;
        throughput: number;
      }> = [];

      for (let userCount = stepSize; userCount <= maxUsers; userCount += stepSize) {
        const users = Array(userCount).fill(null).map((_, i) => generateTestUser(i + 6000));
        const startTime = Date.now();

        // Generate load for this user count
        const requests = users.map(user => 
          coreProcessor.processRequest(generateTestRequest(user.uid, 0))
        );

        const requestResults = await Promise.allSettled(requests);
        const endTime = Date.now();

        // Analyze results
        const successful = requestResults.filter(r => 
          r.status === 'fulfilled' && r.value.success
        );
        const successRate = successful.length / requestResults.length;
        const totalTime = endTime - startTime;
        const avgResponseTime = totalTime / userCount;
        const throughput = userCount / (totalTime / 1000);

        results.push({
          users: userCount,
          successRate,
          avgResponseTime,
          throughput
        });

        console.log(`${userCount} users: ${(successRate * 100).toFixed(1)}% success, ${avgResponseTime.toFixed(0)}ms avg, ${throughput.toFixed(1)} req/s`);

        // Stop if success rate drops below 90%
        if (successRate < 0.9) {
          console.log(`Breaking point reached at ${userCount} users`);
          break;
        }

        // Brief pause between stress levels
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Find optimal operating point (95% success rate)
      const optimalPoint = results.find(r => r.successRate >= 0.95);
      expect(optimalPoint).toBeDefined();
      expect(optimalPoint!.users).toBeGreaterThan(50); // Should handle at least 50 users

      console.log(`Optimal operating point: ${optimalPoint!.users} concurrent users`);
    }, 120000); // 2 minutes timeout

    test('Recovery after overload', async () => {
      // Create overload condition
      const overloadUsers = 150;
      const users = Array(overloadUsers).fill(null).map((_, i) => generateTestUser(i + 7000));
      
      // Generate overload
      const overloadRequests = users.map(user => 
        coreProcessor.processRequest(generateTestRequest(user.uid, 0))
      );

      await Promise.allSettled(overloadRequests);

      // Wait for system to recover
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Test normal operation after overload
      const normalUser = generateTestUser(8000);
      const recoveryStartTime = Date.now();
      const recoveryResult = await coreProcessor.processRequest(
        generateTestRequest(normalUser.uid, 0)
      );
      const recoveryTime = Date.now() - recoveryStartTime;

      // System should recover and handle normal requests
      expect(recoveryResult.success).toBe(true);
      expect(recoveryTime).toBeLessThan(LOAD_TEST_CONFIG.performanceTargets.responseTime.p95);

      console.log(`Recovery test:
        Recovery time: ${recoveryTime}ms
        Recovery successful: ${recoveryResult.success}`);
    });
  });
});

// Performance test utilities
function calculatePercentile(values: number[], percentile: number): number {
  const sorted = values.sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * percentile) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function generateLoadPattern(
  duration: number,
  peakUsers: number,
  pattern: 'constant' | 'ramp' | 'spike' | 'wave'
): number[] {
  const points = Math.floor(duration / 1000); // One point per second
  const userCounts: number[] = [];

  for (let i = 0; i < points; i++) {
    let users: number;
    
    switch (pattern) {
      case 'constant':
        users = peakUsers;
        break;
      case 'ramp':
        users = Math.floor((i / points) * peakUsers);
        break;
      case 'spike':
        users = i === Math.floor(points / 2) ? peakUsers : Math.floor(peakUsers * 0.1);
        break;
      case 'wave':
        users = Math.floor(peakUsers * (Math.sin(i * Math.PI / points) + 1) / 2);
        break;
      default:
        users = peakUsers;
    }
    
    userCounts.push(users);
  }

  return userCounts;
}

