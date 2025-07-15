/**
 * Enhanced Database Service for Fylgja
 * Comprehensive data management with optimized queries, caching, validation, and performance monitoring
 */

import { DatabaseService } from './database-service';
import { performanceMonitor } from '../utils/monitoring';
import { FylgjaError, createValidationError, createDatabaseError } from '../utils/error-handler';

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  filters?: Record<string, any>;
  includeDeleted?: boolean;
  useCache?: boolean;
  cacheTTL?: number;
}

export interface QueryResult<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  nextOffset?: number;
  metadata: {
    queryTime: number;
    cacheHit: boolean;
    indexesUsed: string[];
    optimizationSuggestions?: string[];
  };
}

export interface BulkOperation<T> {
  operation: 'create' | 'update' | 'delete';
  data: T[];
  options?: {
    batchSize?: number;
    continueOnError?: boolean;
    validateBeforeWrite?: boolean;
  };
}

export interface BulkResult {
  success: boolean;
  processed: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
    data: any;
  }>;
  metadata: {
    totalTime: number;
    averageItemTime: number;
    batchCount: number;
  };
}

export interface DataValidationRule {
  field: string;
  type: 'required' | 'type' | 'format' | 'range' | 'custom';
  value?: any;
  message?: string;
  validator?: (value: any, data: any) => boolean;
}

export interface DataValidationResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    value: any;
  }>;
}

export interface CacheConfig {
  enabled: boolean;
  defaultTTL: number;
  maxSize: number;
  compressionEnabled: boolean;
  evictionPolicy: 'lru' | 'lfu' | 'ttl';
}

export interface PerformanceMetrics {
  queryCount: number;
  averageQueryTime: number;
  cacheHitRate: number;
  slowQueries: Array<{
    query: string;
    time: number;
    timestamp: string;
  }>;
  indexUsage: Record<string, number>;
  errorRate: number;
}

export class EnhancedDatabaseService extends DatabaseService {
  private cache: Map<string, CacheEntry> = new Map();
  private cacheConfig: CacheConfig;
  private validationRules: Map<string, DataValidationRule[]> = new Map();
  private performanceMetrics: PerformanceMetrics;
  private queryOptimizer: QueryOptimizer;
  
  private readonly SLOW_QUERY_THRESHOLD = 1000; // 1 second
  private readonly MAX_BATCH_SIZE = 500;
  private readonly CACHE_CLEANUP_INTERVAL = 300000; // 5 minutes

  constructor(cacheConfig: Partial<CacheConfig> = {}) {
    super();
    
    this.cacheConfig = {
      enabled: true,
      defaultTTL: 300000, // 5 minutes
      maxSize: 10000,
      compressionEnabled: true,
      evictionPolicy: 'lru',
      ...cacheConfig,
    };

    this.performanceMetrics = {
      queryCount: 0,
      averageQueryTime: 0,
      cacheHitRate: 0,
      slowQueries: [],
      indexUsage: {},
      errorRate: 0,
    };

    this.queryOptimizer = new QueryOptimizer();
    this.initializeValidationRules();
    this.startCacheCleanup();
  }

  /**
   * Enhanced user profile operations
   */
  async getUserProfileEnhanced(
    userId: string, 
    options: QueryOptions = {}
  ): Promise<QueryResult<any>> {
    const timerId = performanceMonitor.startTimer('get_user_profile_enhanced');
    const cacheKey = `user_profile_${userId}`;
    
    try {
      // Check cache first
      if (options.useCache !== false && this.cacheConfig.enabled) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          return {
            data: [cached],
            total: 1,
            hasMore: false,
            metadata: {
              queryTime: performanceMonitor.endTimer(timerId),
              cacheHit: true,
              indexesUsed: [],
            },
          };
        }
      }

      // Query database
      const profile = await this.getUserProfile(userId);
      
      if (!profile) {
        return {
          data: [],
          total: 0,
          hasMore: false,
          metadata: {
            queryTime: performanceMonitor.endTimer(timerId),
            cacheHit: false,
            indexesUsed: ['users_by_id'],
          },
        };
      }

      // Cache result
      if (this.cacheConfig.enabled) {
        this.setCache(cacheKey, profile, options.cacheTTL);
      }

      this.updatePerformanceMetrics('get_user_profile', performanceMonitor.endTimer(timerId), false);

      return {
        data: [profile],
        total: 1,
        hasMore: false,
        metadata: {
          queryTime: performanceMonitor.getLastTimerValue(timerId),
          cacheHit: false,
          indexesUsed: ['users_by_id'],
        },
      };

    } catch (error) {
      this.updatePerformanceMetrics('get_user_profile', performanceMonitor.endTimer(timerId), true);
      throw createDatabaseError(`Failed to get user profile: ${error.message}`);
    }
  }

  /**
   * Enhanced interaction queries with filtering and pagination
   */
  async getInteractionsEnhanced(
    userId: string,
    options: QueryOptions = {}
  ): Promise<QueryResult<any>> {
    const timerId = performanceMonitor.startTimer('get_interactions_enhanced');
    const cacheKey = `interactions_${userId}_${JSON.stringify(options)}`;
    
    try {
      // Check cache
      if (options.useCache !== false && this.cacheConfig.enabled) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          return cached;
        }
      }

      // Build optimized query
      const query = this.queryOptimizer.buildInteractionQuery(userId, options);
      const interactions = await this.executeOptimizedQuery('interactions', query);
      
      // Get total count for pagination
      const totalQuery = this.queryOptimizer.buildCountQuery('interactions', userId, options.filters);
      const totalResult = await this.executeOptimizedQuery('interactions_count', totalQuery);
      const total = totalResult[0]?.count || 0;

      const result: QueryResult<any> = {
        data: interactions,
        total,
        hasMore: (options.offset || 0) + interactions.length < total,
        nextOffset: interactions.length === (options.limit || 50) ? 
          (options.offset || 0) + interactions.length : undefined,
        metadata: {
          queryTime: performanceMonitor.endTimer(timerId),
          cacheHit: false,
          indexesUsed: this.queryOptimizer.getUsedIndexes(),
          optimizationSuggestions: this.queryOptimizer.getOptimizationSuggestions(),
        },
      };

      // Cache result
      if (this.cacheConfig.enabled) {
        this.setCache(cacheKey, result, options.cacheTTL);
      }

      this.updatePerformanceMetrics('get_interactions', result.metadata.queryTime, false);
      return result;

    } catch (error) {
      this.updatePerformanceMetrics('get_interactions', performanceMonitor.endTimer(timerId), true);
      throw createDatabaseError(`Failed to get interactions: ${error.message}`);
    }
  }

  /**
   * Advanced search with full-text search and filtering
   */
  async searchInteractions(
    userId: string,
    searchQuery: string,
    options: QueryOptions = {}
  ): Promise<QueryResult<any>> {
    const timerId = performanceMonitor.startTimer('search_interactions');
    
    try {
      // Validate search query
      if (!searchQuery || searchQuery.trim().length < 2) {
        throw createValidationError('Search query must be at least 2 characters');
      }

      // Build full-text search query
      const query = this.queryOptimizer.buildFullTextSearchQuery(
        'interactions',
        userId,
        searchQuery,
        options
      );

      const results = await this.executeOptimizedQuery('search_interactions', query);
      const total = results.length; // Full-text search returns all matches

      const result: QueryResult<any> = {
        data: results.slice(options.offset || 0, (options.offset || 0) + (options.limit || 50)),
        total,
        hasMore: (options.offset || 0) + (options.limit || 50) < total,
        metadata: {
          queryTime: performanceMonitor.endTimer(timerId),
          cacheHit: false,
          indexesUsed: ['interactions_fulltext', 'interactions_by_user'],
          optimizationSuggestions: total > 1000 ? 
            ['Consider adding date range filter for better performance'] : [],
        },
      };

      this.updatePerformanceMetrics('search_interactions', result.metadata.queryTime, false);
      return result;

    } catch (error) {
      this.updatePerformanceMetrics('search_interactions', performanceMonitor.endTimer(timerId), true);
      throw createDatabaseError(`Search failed: ${error.message}`);
    }
  }

  /**
   * Bulk operations with batch processing
   */
  async bulkCreateInteractions(
    interactions: any[],
    options: BulkOperation<any>['options'] = {}
  ): Promise<BulkResult> {
    const startTime = Date.now();
    const batchSize = Math.min(options.batchSize || 100, this.MAX_BATCH_SIZE);
    
    let processed = 0;
    let failed = 0;
    const errors: BulkResult['errors'] = [];
    const batches = this.chunkArray(interactions, batchSize);

    try {
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        
        try {
          // Validate batch if requested
          if (options.validateBeforeWrite) {
            for (let i = 0; i < batch.length; i++) {
              const validation = this.validateData('interaction', batch[i]);
              if (!validation.valid) {
                if (!options.continueOnError) {
                  throw createValidationError(`Validation failed for item ${i}: ${validation.errors[0].message}`);
                }
                
                errors.push({
                  index: batchIndex * batchSize + i,
                  error: validation.errors[0].message,
                  data: batch[i],
                });
                failed++;
                continue;
              }
            }
          }

          // Process batch
          await this.processBatch('create', 'interactions', batch);
          processed += batch.length;

        } catch (error) {
          if (!options.continueOnError) {
            throw error;
          }

          // Record batch failure
          for (let i = 0; i < batch.length; i++) {
            errors.push({
              index: batchIndex * batchSize + i,
              error: error.message,
              data: batch[i],
            });
          }
          failed += batch.length;
        }
      }

      const totalTime = Date.now() - startTime;
      
      // Invalidate related caches
      this.invalidateCachePattern('interactions_');

      return {
        success: failed === 0,
        processed,
        failed,
        errors,
        metadata: {
          totalTime,
          averageItemTime: totalTime / interactions.length,
          batchCount: batches.length,
        },
      };

    } catch (error) {
      throw createDatabaseError(`Bulk create failed: ${error.message}`);
    }
  }

  /**
   * Data aggregation and analytics
   */
  async getInteractionAnalytics(
    userId: string,
    timeRange: { start: string; end: string },
    options: QueryOptions = {}
  ): Promise<{
    totalInteractions: number;
    averageResponseTime: number;
    topTopics: Array<{ topic: string; count: number }>;
    engagementTrend: Array<{ date: string; engagement: number }>;
    sentimentDistribution: Record<string, number>;
    metadata: {
      queryTime: number;
      cacheHit: boolean;
    };
  }> {
    const timerId = performanceMonitor.startTimer('get_interaction_analytics');
    const cacheKey = `analytics_${userId}_${timeRange.start}_${timeRange.end}`;
    
    try {
      // Check cache
      if (options.useCache !== false && this.cacheConfig.enabled) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          return {
            ...cached,
            metadata: {
              queryTime: performanceMonitor.endTimer(timerId),
              cacheHit: true,
            },
          };
        }
      }

      // Execute analytics queries in parallel
      const [
        totalInteractions,
        avgResponseTime,
        topTopics,
        engagementTrend,
        sentimentDistribution,
      ] = await Promise.all([
        this.getInteractionCount(userId, timeRange),
        this.getAverageResponseTime(userId, timeRange),
        this.getTopTopics(userId, timeRange, 10),
        this.getEngagementTrend(userId, timeRange),
        this.getSentimentDistribution(userId, timeRange),
      ]);

      const result = {
        totalInteractions,
        averageResponseTime: avgResponseTime,
        topTopics,
        engagementTrend,
        sentimentDistribution,
      };

      // Cache result with longer TTL for analytics
      if (this.cacheConfig.enabled) {
        this.setCache(cacheKey, result, 3600000); // 1 hour
      }

      this.updatePerformanceMetrics('get_analytics', performanceMonitor.endTimer(timerId), false);

      return {
        ...result,
        metadata: {
          queryTime: performanceMonitor.getLastTimerValue(timerId),
          cacheHit: false,
        },
      };

    } catch (error) {
      this.updatePerformanceMetrics('get_analytics', performanceMonitor.endTimer(timerId), true);
      throw createDatabaseError(`Analytics query failed: ${error.message}`);
    }
  }

  /**
   * Data validation
   */
  validateData(entityType: string, data: any): DataValidationResult {
    const rules = this.validationRules.get(entityType) || [];
    const errors: DataValidationResult['errors'] = [];

    for (const rule of rules) {
      const value = data[rule.field];
      let isValid = true;
      let errorMessage = rule.message || `Validation failed for ${rule.field}`;

      switch (rule.type) {
        case 'required':
          isValid = value !== undefined && value !== null && value !== '';
          errorMessage = rule.message || `${rule.field} is required`;
          break;

        case 'type':
          isValid = typeof value === rule.value;
          errorMessage = rule.message || `${rule.field} must be of type ${rule.value}`;
          break;

        case 'format':
          if (rule.value instanceof RegExp) {
            isValid = rule.value.test(value);
          }
          errorMessage = rule.message || `${rule.field} format is invalid`;
          break;

        case 'range':
          if (rule.value && typeof rule.value === 'object') {
            const { min, max } = rule.value;
            isValid = value >= min && value <= max;
            errorMessage = rule.message || `${rule.field} must be between ${min} and ${max}`;
          }
          break;

        case 'custom':
          if (rule.validator) {
            isValid = rule.validator(value, data);
          }
          break;
      }

      if (!isValid) {
        errors.push({
          field: rule.field,
          message: errorMessage,
          value,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Cache management
   */
  private getFromCache(key: string): any | null {
    if (!this.cacheConfig.enabled) return null;

    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Update access time for LRU
    entry.lastAccessed = Date.now();
    return entry.data;
  }

  private setCache(key: string, data: any, ttl?: number): void {
    if (!this.cacheConfig.enabled) return;

    // Check cache size limit
    if (this.cache.size >= this.cacheConfig.maxSize) {
      this.evictCache();
    }

    const entry: CacheEntry = {
      data,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      expiresAt: Date.now() + (ttl || this.cacheConfig.defaultTTL),
      size: this.estimateSize(data),
    };

    this.cache.set(key, entry);
  }

  private invalidateCachePattern(pattern: string): void {
    const keysToDelete: string[] = [];
    
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  private evictCache(): void {
    const entries = Array.from(this.cache.entries());
    
    switch (this.cacheConfig.evictionPolicy) {
      case 'lru':
        entries.sort(([,a], [,b]) => a.lastAccessed - b.lastAccessed);
        break;
      case 'lfu':
        // Would need access count tracking
        entries.sort(([,a], [,b]) => a.lastAccessed - b.lastAccessed);
        break;
      case 'ttl':
        entries.sort(([,a], [,b]) => a.expiresAt - b.expiresAt);
        break;
    }

    // Remove oldest 10% of entries
    const toRemove = Math.ceil(entries.length * 0.1);
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];

      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiresAt) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach(key => this.cache.delete(key));
    }, this.CACHE_CLEANUP_INTERVAL);
  }

  /**
   * Performance monitoring
   */
  private updatePerformanceMetrics(operation: string, time: number, isError: boolean): void {
    this.performanceMetrics.queryCount++;
    
    // Update average query time
    const totalTime = this.performanceMetrics.averageQueryTime * (this.performanceMetrics.queryCount - 1);
    this.performanceMetrics.averageQueryTime = (totalTime + time) / this.performanceMetrics.queryCount;

    // Track slow queries
    if (time > this.SLOW_QUERY_THRESHOLD) {
      this.performanceMetrics.slowQueries.push({
        query: operation,
        time,
        timestamp: new Date().toISOString(),
      });

      // Keep only last 100 slow queries
      if (this.performanceMetrics.slowQueries.length > 100) {
        this.performanceMetrics.slowQueries.shift();
      }
    }

    // Update error rate
    if (isError) {
      const errorCount = this.performanceMetrics.errorRate * this.performanceMetrics.queryCount;
      this.performanceMetrics.errorRate = (errorCount + 1) / this.performanceMetrics.queryCount;
    }

    // Update cache hit rate
    const cacheHits = this.cache.size > 0 ? Array.from(this.cache.values()).length : 0;
    this.performanceMetrics.cacheHitRate = cacheHits / this.performanceMetrics.queryCount;
  }

  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Helper methods
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private estimateSize(data: any): number {
    return JSON.stringify(data).length * 2; // Rough estimate
  }

  private initializeValidationRules(): void {
    // User profile validation rules
    this.validationRules.set('user_profile', [
      { field: 'userId', type: 'required' },
      { field: 'userId', type: 'type', value: 'string' },
      { field: 'email', type: 'format', value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      { field: 'createdAt', type: 'required' },
    ]);

    // Interaction validation rules
    this.validationRules.set('interaction', [
      { field: 'userId', type: 'required' },
      { field: 'userMessage', type: 'required' },
      { field: 'aiResponse', type: 'required' },
      { field: 'timestamp', type: 'required' },
      { field: 'platform', type: 'required' },
    ]);

    // Task validation rules
    this.validationRules.set('task', [
      { field: 'userId', type: 'required' },
      { field: 'title', type: 'required' },
      { field: 'status', type: 'required' },
      { field: 'priority', type: 'range', value: { min: 1, max: 5 } },
    ]);
  }

  // Placeholder methods for analytics (would be implemented with actual Firestore queries)
  private async getInteractionCount(userId: string, timeRange: any): Promise<number> {
    // Implementation would use Firestore aggregation
    return 0;
  }

  private async getAverageResponseTime(userId: string, timeRange: any): Promise<number> {
    // Implementation would calculate from interaction data
    return 0;
  }

  private async getTopTopics(userId: string, timeRange: any, limit: number): Promise<Array<{ topic: string; count: number }>> {
    // Implementation would aggregate topic data
    return [];
  }

  private async getEngagementTrend(userId: string, timeRange: any): Promise<Array<{ date: string; engagement: number }>> {
    // Implementation would calculate daily engagement scores
    return [];
  }

  private async getSentimentDistribution(userId: string, timeRange: any): Promise<Record<string, number>> {
    // Implementation would aggregate sentiment data
    return {};
  }

  private async executeOptimizedQuery(queryType: string, query: any): Promise<any[]> {
    // Implementation would execute optimized Firestore queries
    return [];
  }

  private async processBatch(operation: string, collection: string, batch: any[]): Promise<void> {
    // Implementation would use Firestore batch operations
  }
}

// Supporting interfaces and classes
interface CacheEntry {
  data: any;
  createdAt: number;
  lastAccessed: number;
  expiresAt: number;
  size: number;
}

class QueryOptimizer {
  private usedIndexes: string[] = [];
  private optimizationSuggestions: string[] = [];

  buildInteractionQuery(userId: string, options: QueryOptions): any {
    this.usedIndexes = ['interactions_by_user'];
    
    // Build optimized query based on options
    const query: any = {
      userId,
      limit: options.limit || 50,
      offset: options.offset || 0,
    };

    if (options.orderBy) {
      query.orderBy = options.orderBy;
      query.orderDirection = options.orderDirection || 'desc';
      this.usedIndexes.push(`interactions_by_${options.orderBy}`);
    }

    if (options.filters) {
      query.filters = options.filters;
      Object.keys(options.filters).forEach(field => {
        this.usedIndexes.push(`interactions_by_${field}`);
      });
    }

    return query;
  }

  buildCountQuery(collection: string, userId: string, filters?: Record<string, any>): any {
    return {
      collection,
      userId,
      filters,
      count: true,
    };
  }

  buildFullTextSearchQuery(
    collection: string,
    userId: string,
    searchQuery: string,
    options: QueryOptions
  ): any {
    this.usedIndexes = [`${collection}_fulltext`, `${collection}_by_user`];
    
    return {
      collection,
      userId,
      searchQuery,
      limit: options.limit || 50,
      offset: options.offset || 0,
    };
  }

  getUsedIndexes(): string[] {
    return [...this.usedIndexes];
  }

  getOptimizationSuggestions(): string[] {
    return [...this.optimizationSuggestions];
  }
}

// Global enhanced database service instance
export const enhancedDatabaseService = new EnhancedDatabaseService();

