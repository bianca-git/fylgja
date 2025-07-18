/**
 * Advanced Query Optimizer for Fylgja
 * Optimizes database queries for maximum performance with Firestore
 */

import { FylgjaError, createSystemError } from '../utils/error-handler';
import { performanceMonitor } from '../utils/monitoring';

export interface QueryPlan {
  collection: string;
  operation: 'get' | 'query' | 'aggregate' | 'count';
  filters: QueryFilter[];
  orderBy?: QueryOrderBy[];
  limit?: number;
  offset?: number;
  estimatedCost: number;
  recommendedIndexes: string[];
  optimizations: string[];
  cacheStrategy: CacheStrategy;
}

export interface QueryFilter {
  field: string;
  operator:
    | '=='
    | '!='
    | '<'
    | '<='
    | '>'
    | '>='
    | 'in'
    | 'not-in'
    | 'array-contains'
    | 'array-contains-any';
  value: any;
  selectivity: number; // 0-1, how selective this filter is
}

export interface QueryOrderBy {
  field: string;
  direction: 'asc' | 'desc';
}

export interface CacheStrategy {
  enabled: boolean;
  ttl: number;
  key: string;
  invalidationTriggers: string[];
}

export interface QueryStats {
  queryId: string;
  collection: string;
  executionTime: number;
  documentsRead: number;
  indexesUsed: string[];
  cacheHit: boolean;
  timestamp: string;
  cost: number;
}

export interface OptimizationSuggestion {
  type: 'index' | 'query_structure' | 'caching' | 'pagination';
  priority: 'high' | 'medium' | 'low';
  description: string;
  impact: string;
  implementation: string;
}

export class QueryOptimizer {
  private queryStats: Map<string, QueryStats[]> = new Map();
  private indexUsageStats: Map<string, number> = new Map();
  private slowQueries: QueryStats[] = [];

  private readonly SLOW_QUERY_THRESHOLD = 1000; // 1 second
  private readonly MAX_STATS_HISTORY = 1000;
  private readonly SELECTIVITY_CACHE = new Map<string, number>();

  /**
   * Optimize a query plan
   */
  optimizeQuery(
    collection: string,
    filters: QueryFilter[],
    options: {
      orderBy?: QueryOrderBy[];
      limit?: number;
      offset?: number;
      requireConsistency?: boolean;
    } = {}
  ): QueryPlan {
    const timerId = performanceMonitor.startTimer('query_optimization');

    try {
      // Analyze and optimize filters
      const optimizedFilters = this.optimizeFilters(collection, filters);

      // Determine optimal ordering
      const optimizedOrderBy = this.optimizeOrderBy(collection, options.orderBy, optimizedFilters);

      // Calculate estimated cost
      const estimatedCost = this.calculateQueryCost(
        collection,
        optimizedFilters,
        optimizedOrderBy,
        options.limit
      );

      // Recommend indexes
      const recommendedIndexes = this.recommendIndexes(
        collection,
        optimizedFilters,
        optimizedOrderBy
      );

      // Generate optimizations
      const optimizations = this.generateOptimizations(collection, optimizedFilters, options);

      // Determine cache strategy
      const cacheStrategy = this.determineCacheStrategy(
        collection,
        optimizedFilters,
        estimatedCost
      );

      const queryPlan: QueryPlan = {
        collection,
        operation: this.determineOperation(optimizedFilters, options),
        filters: optimizedFilters,
        orderBy: optimizedOrderBy,
        limit: options.limit,
        offset: options.offset,
        estimatedCost,
        recommendedIndexes,
        optimizations,
        cacheStrategy,
      };

      performanceMonitor.endTimer(timerId);
      return queryPlan;
    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Query optimization failed: ${error.message}`);
    }
  }

  /**
   * Optimize filters for best performance
   */
  private optimizeFilters(collection: string, filters: QueryFilter[]): QueryFilter[] {
    // Calculate selectivity for each filter
    const filtersWithSelectivity = filters.map(filter => ({
      ...filter,
      selectivity: this.calculateSelectivity(collection, filter),
    }));

    // Sort filters by selectivity (most selective first)
    filtersWithSelectivity.sort((a, b) => a.selectivity - b.selectivity);

    // Optimize filter combinations
    return this.optimizeFilterCombinations(filtersWithSelectivity);
  }

  /**
   * Calculate filter selectivity
   */
  private calculateSelectivity(collection: string, filter: QueryFilter): number {
    const cacheKey = `${collection}_${filter.field}_${filter.operator}`;

    // Check cache first
    if (this.SELECTIVITY_CACHE.has(cacheKey)) {
      return this.SELECTIVITY_CACHE.get(cacheKey)!;
    }

    let selectivity = 0.5; // Default selectivity

    // Estimate selectivity based on operator and field type
    switch (filter.operator) {
      case '==':
        selectivity = this.estimateEqualitySelectivity(collection, filter.field, filter.value);
        break;
      case '!=':
        selectivity = 1 - this.estimateEqualitySelectivity(collection, filter.field, filter.value);
        break;
      case '<':
      case '<=':
      case '>':
      case '>=':
        selectivity = this.estimateRangeSelectivity(
          collection,
          filter.field,
          filter.operator,
          filter.value
        );
        break;
      case 'in':
        selectivity = this.estimateInSelectivity(collection, filter.field, filter.value);
        break;
      case 'array-contains':
        selectivity = this.estimateArrayContainsSelectivity(collection, filter.field, filter.value);
        break;
    }

    // Cache the result
    this.SELECTIVITY_CACHE.set(cacheKey, selectivity);
    return selectivity;
  }

  /**
   * Optimize filter combinations
   */
  private optimizeFilterCombinations(filters: QueryFilter[]): QueryFilter[] {
    const optimized: QueryFilter[] = [];
    const processedFields = new Set<string>();

    for (const filter of filters) {
      // Combine range filters on the same field
      if (
        (filter.operator === '<' ||
          filter.operator === '<=' ||
          filter.operator === '>' ||
          filter.operator === '>=') &&
        !processedFields.has(filter.field)
      ) {
        const rangeFilters = filters.filter(
          f =>
            f.field === filter.field &&
            (f.operator === '<' || f.operator === '<=' || f.operator === '>' || f.operator === '>=')
        );

        if (rangeFilters.length > 1) {
          // Combine into a single range filter (conceptually)
          optimized.push(this.combineRangeFilters(rangeFilters));
          processedFields.add(filter.field);
          continue;
        }
      }

      // Skip if already processed
      if (processedFields.has(filter.field)) {
        continue;
      }

      optimized.push(filter);
      processedFields.add(filter.field);
    }

    return optimized;
  }

  /**
   * Optimize order by clauses
   */
  private optimizeOrderBy(
    collection: string,
    orderBy: QueryOrderBy[] = [],
    filters: QueryFilter[]
  ): QueryOrderBy[] {
    if (orderBy.length === 0) {
      return [];
    }

    // Check if ordering field is already filtered (can use same index)
    const filteredFields = new Set(filters.map(f => f.field));
    const optimizedOrderBy: QueryOrderBy[] = [];

    for (const order of orderBy) {
      // Prefer ordering by filtered fields when possible
      if (filteredFields.has(order.field)) {
        optimizedOrderBy.unshift(order); // Put filtered field ordering first
      } else {
        optimizedOrderBy.push(order);
      }
    }

    return optimizedOrderBy;
  }

  /**
   * Calculate estimated query cost
   */
  private calculateQueryCost(
    collection: string,
    filters: QueryFilter[],
    orderBy: QueryOrderBy[] = [],
    limit?: number
  ): number {
    let baseCost = 1;

    // Cost increases with number of filters
    baseCost += filters.length * 0.5;

    // Cost increases with ordering
    baseCost += orderBy.length * 0.3;

    // Cost decreases with more selective filters
    const avgSelectivity = filters.reduce((sum, f) => sum + f.selectivity, 0) / filters.length || 1;
    baseCost *= avgSelectivity;

    // Cost decreases with limit
    if (limit && limit < 100) {
      baseCost *= 0.8;
    }

    // Estimate based on collection size (would be actual stats in production)
    const estimatedCollectionSize = this.getEstimatedCollectionSize(collection);
    baseCost *= Math.log10(estimatedCollectionSize + 1);

    return Math.round(baseCost * 100) / 100;
  }

  /**
   * Recommend indexes for optimal performance
   */
  private recommendIndexes(
    collection: string,
    filters: QueryFilter[],
    orderBy: QueryOrderBy[] = []
  ): string[] {
    const indexes: string[] = [];
    const indexedFields = new Set<string>();

    // Single field indexes for equality filters
    filters
      .filter(f => f.operator === '==' && f.selectivity < 0.1)
      .forEach(f => {
        if (!indexedFields.has(f.field)) {
          indexes.push(`${collection}_by_${f.field}`);
          indexedFields.add(f.field);
        }
      });

    // Composite indexes for multiple filters
    if (filters.length > 1) {
      const compositeFields = filters
        .filter(f => f.selectivity < 0.5)
        .map(f => f.field)
        .slice(0, 3); // Firestore composite index limit considerations

      if (compositeFields.length > 1) {
        indexes.push(`${collection}_by_${compositeFields.join('_')}`);
      }
    }

    // Indexes for ordering
    orderBy.forEach(order => {
      if (!indexedFields.has(order.field)) {
        indexes.push(`${collection}_by_${order.field}_${order.direction}`);
        indexedFields.add(order.field);
      }
    });

    // Composite indexes for filter + order combinations
    if (filters.length > 0 && orderBy.length > 0) {
      const primaryFilter = filters[0];
      const primaryOrder = orderBy[0];

      if (primaryFilter.field !== primaryOrder.field) {
        indexes.push(`${collection}_by_${primaryFilter.field}_${primaryOrder.field}`);
      }
    }

    return indexes;
  }

  /**
   * Generate optimization suggestions
   */
  private generateOptimizations(
    collection: string,
    filters: QueryFilter[],
    options: any
  ): string[] {
    const optimizations: string[] = [];

    // Suggest pagination for large result sets
    if (!options.limit || options.limit > 100) {
      optimizations.push('Consider adding pagination (limit) for better performance');
    }

    // Suggest more selective filters
    const lowSelectivityFilters = filters.filter(f => f.selectivity > 0.8);
    if (lowSelectivityFilters.length > 0) {
      optimizations.push(
        `Consider adding more selective filters for fields: ${lowSelectivityFilters.map(f => f.field).join(', ')}`
      );
    }

    // Suggest avoiding inequality filters on multiple fields
    const inequalityFields = filters
      .filter(f => ['<', '<=', '>', '>=', '!='].includes(f.operator))
      .map(f => f.field);

    if (new Set(inequalityFields).size > 1) {
      optimizations.push(
        'Avoid inequality filters on multiple fields - consider restructuring query'
      );
    }

    // Suggest caching for expensive queries
    const estimatedCost = this.calculateQueryCost(
      collection,
      filters,
      options.orderBy,
      options.limit
    );
    if (estimatedCost > 5) {
      optimizations.push('Consider caching results for this expensive query');
    }

    return optimizations;
  }

  /**
   * Determine optimal cache strategy
   */
  private determineCacheStrategy(
    collection: string,
    filters: QueryFilter[],
    estimatedCost: number
  ): CacheStrategy {
    const shouldCache = estimatedCost > 3 || filters.some(f => f.selectivity > 0.7);

    if (!shouldCache) {
      return {
        enabled: false,
        ttl: 0,
        key: '',
        invalidationTriggers: [],
      };
    }

    // Generate cache key based on query parameters
    const filterKey = filters
      .map(f => `${f.field}_${f.operator}_${JSON.stringify(f.value)}`)
      .join('_');

    const cacheKey = `query_${collection}_${filterKey}`;

    // Determine TTL based on data volatility
    let ttl = 300000; // 5 minutes default

    if (collection === 'user_profiles') {
      ttl = 1800000; // 30 minutes for user profiles
    } else if (collection === 'interactions') {
      ttl = 60000; // 1 minute for interactions
    }

    return {
      enabled: true,
      ttl,
      key: cacheKey,
      invalidationTriggers: [`${collection}_write`, `${collection}_update`],
    };
  }

  /**
   * Record query execution statistics
   */
  recordQueryExecution(
    queryId: string,
    collection: string,
    executionTime: number,
    documentsRead: number,
    indexesUsed: string[],
    cacheHit: boolean
  ): void {
    const stats: QueryStats = {
      queryId,
      collection,
      executionTime,
      documentsRead,
      indexesUsed,
      cacheHit,
      timestamp: new Date().toISOString(),
      cost: this.calculateActualCost(executionTime, documentsRead),
    };

    // Store stats
    if (!this.queryStats.has(collection)) {
      this.queryStats.set(collection, []);
    }

    const collectionStats = this.queryStats.get(collection)!;
    collectionStats.push(stats);

    // Limit history size
    if (collectionStats.length > this.MAX_STATS_HISTORY) {
      collectionStats.shift();
    }

    // Track index usage
    indexesUsed.forEach(index => {
      this.indexUsageStats.set(index, (this.indexUsageStats.get(index) || 0) + 1);
    });

    // Track slow queries
    if (executionTime > this.SLOW_QUERY_THRESHOLD) {
      this.slowQueries.push(stats);

      // Limit slow query history
      if (this.slowQueries.length > 100) {
        this.slowQueries.shift();
      }
    }
  }

  /**
   * Get optimization suggestions based on query history
   */
  getOptimizationSuggestions(collection?: string): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // Analyze slow queries
    const relevantSlowQueries = collection
      ? this.slowQueries.filter(q => q.collection === collection)
      : this.slowQueries;

    if (relevantSlowQueries.length > 0) {
      suggestions.push({
        type: 'query_structure',
        priority: 'high',
        description: `${relevantSlowQueries.length} slow queries detected`,
        impact: 'Significant performance improvement',
        implementation: 'Review and optimize slow query patterns',
      });
    }

    // Analyze index usage
    const unusedIndexes = this.findUnusedIndexes(collection);
    if (unusedIndexes.length > 0) {
      suggestions.push({
        type: 'index',
        priority: 'medium',
        description: `${unusedIndexes.length} unused indexes detected`,
        impact: 'Reduced storage costs',
        implementation: 'Remove unused indexes: ' + unusedIndexes.join(', '),
      });
    }

    // Analyze cache opportunities
    const cacheMisses = this.analyzeCacheMisses(collection);
    if (cacheMisses > 0.7) {
      suggestions.push({
        type: 'caching',
        priority: 'medium',
        description: `High cache miss rate: ${Math.round(cacheMisses * 100)}%`,
        impact: 'Improved response times',
        implementation: 'Implement caching for frequently accessed queries',
      });
    }

    return suggestions;
  }

  /**
   * Get query performance analytics
   */
  getPerformanceAnalytics(collection?: string): {
    averageExecutionTime: number;
    totalQueries: number;
    slowQueryCount: number;
    cacheHitRate: number;
    mostUsedIndexes: Array<{ index: string; usage: number }>;
    queryDistribution: Record<string, number>;
  } {
    const relevantStats = collection
      ? this.queryStats.get(collection) || []
      : Array.from(this.queryStats.values()).flat();

    const totalQueries = relevantStats.length;
    const averageExecutionTime =
      totalQueries > 0
        ? relevantStats.reduce((sum, s) => sum + s.executionTime, 0) / totalQueries
        : 0;

    const slowQueryCount = relevantStats.filter(
      s => s.executionTime > this.SLOW_QUERY_THRESHOLD
    ).length;
    const cacheHits = relevantStats.filter(s => s.cacheHit).length;
    const cacheHitRate = totalQueries > 0 ? cacheHits / totalQueries : 0;

    const mostUsedIndexes = Array.from(this.indexUsageStats.entries())
      .map(([index, usage]) => ({ index, usage }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 10);

    const queryDistribution: Record<string, number> = {};
    relevantStats.forEach(s => {
      queryDistribution[s.collection] = (queryDistribution[s.collection] || 0) + 1;
    });

    return {
      averageExecutionTime,
      totalQueries,
      slowQueryCount,
      cacheHitRate,
      mostUsedIndexes,
      queryDistribution,
    };
  }

  /**
   * Helper methods
   */
  private determineOperation(filters: QueryFilter[], options: any): QueryPlan['operation'] {
    if (filters.length === 1 && filters[0].operator === '==' && filters[0].field === 'id') {
      return 'get';
    }

    if (options.count) {
      return 'count';
    }

    return 'query';
  }

  private estimateEqualitySelectivity(collection: string, field: string, value: any): number {
    // In production, this would use actual statistics
    const commonFields = ['userId', 'id', 'status'];
    if (commonFields.includes(field)) {
      return 0.1; // Highly selective
    }
    return 0.5; // Default
  }

  private estimateRangeSelectivity(
    collection: string,
    field: string,
    operator: string,
    value: any
  ): number {
    // Estimate based on operator and field type
    if (field.includes('timestamp') || field.includes('date')) {
      return 0.3; // Time ranges are usually selective
    }
    return 0.6; // Default for range queries
  }

  private estimateInSelectivity(collection: string, field: string, values: any[]): number {
    return Math.min(0.8, values.length * 0.1);
  }

  private estimateArrayContainsSelectivity(collection: string, field: string, value: any): number {
    return 0.4; // Array contains is moderately selective
  }

  private combineRangeFilters(rangeFilters: QueryFilter[]): QueryFilter {
    // Combine multiple range filters into a single conceptual filter
    return {
      field: rangeFilters[0].field,
      operator: '>=', // Simplified representation
      value: rangeFilters[0].value,
      selectivity: Math.min(...rangeFilters.map(f => f.selectivity)),
    };
  }

  private getEstimatedCollectionSize(collection: string): number {
    // In production, this would use actual collection statistics
    const estimates: Record<string, number> = {
      users: 10000,
      interactions: 100000,
      tasks: 50000,
      legacy_data: 5000,
    };
    return estimates[collection] || 1000;
  }

  private calculateActualCost(executionTime: number, documentsRead: number): number {
    return executionTime / 1000 + documentsRead * 0.1;
  }

  private findUnusedIndexes(collection?: string): string[] {
    // Find indexes that haven't been used recently
    const unusedThreshold = 10; // Minimum usage count
    const unused: string[] = [];

    for (const [index, usage] of this.indexUsageStats.entries()) {
      if (usage < unusedThreshold) {
        if (!collection || index.includes(collection)) {
          unused.push(index);
        }
      }
    }

    return unused;
  }

  private analyzeCacheMisses(collection?: string): number {
    const relevantStats = collection
      ? this.queryStats.get(collection) || []
      : Array.from(this.queryStats.values()).flat();

    if (relevantStats.length === 0) {
      return 0;
    }

    const misses = relevantStats.filter(s => !s.cacheHit).length;
    return misses / relevantStats.length;
  }
}

// Global query optimizer instance
export const queryOptimizer = new QueryOptimizer();
