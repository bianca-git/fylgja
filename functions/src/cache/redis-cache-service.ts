/**
 * Redis-Compatible Cache Service for Fylgja
 * High-performance caching with Redis-like operations and Firebase integration
 */

import { performanceMonitor } from '../utils/monitoring';
import { FylgjaError, createSystemError } from '../utils/error-handler';

export interface CacheOptions {
  ttl?: number;
  compress?: boolean;
  serialize?: boolean;
  namespace?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
  memoryUsage: number;
  keyCount: number;
  averageKeySize: number;
}

export interface CacheEntry {
  value: any;
  createdAt: number;
  lastAccessed: number;
  expiresAt: number;
  accessCount: number;
  size: number;
  compressed: boolean;
}

export interface CachePattern {
  pattern: string;
  keys: string[];
  totalSize: number;
  count: number;
}

export class RedisCacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private stats: CacheStats;
  private config: {
    maxMemory: number;
    defaultTTL: number;
    compressionThreshold: number;
    evictionPolicy: 'lru' | 'lfu' | 'ttl' | 'random';
    keyPrefix: string;
  };

  private readonly CLEANUP_INTERVAL = 60000; // 1 minute
  private readonly STATS_UPDATE_INTERVAL = 10000; // 10 seconds
  private cleanupTimer?: NodeJS.Timeout;
  private statsTimer?: NodeJS.Timeout;

  constructor(config: Partial<typeof RedisCacheService.prototype.config> = {}) {
    this.config = {
      maxMemory: 100 * 1024 * 1024, // 100MB
      defaultTTL: 300000, // 5 minutes
      compressionThreshold: 1024, // 1KB
      evictionPolicy: 'lru',
      keyPrefix: 'fylgja:',
      ...config,
    };

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
      memoryUsage: 0,
      keyCount: 0,
      averageKeySize: 0,
    };

    this.startCleanupTimer();
    this.startStatsTimer();
  }

  /**
   * Get value from cache
   */
  async get(key: string, options: CacheOptions = {}): Promise<any | null> {
    const timerId = performanceMonitor.startTimer('cache_get');
    const fullKey = this.buildKey(key, options.namespace);

    try {
      const entry = this.cache.get(fullKey);
      
      if (!entry) {
        this.stats.misses++;
        performanceMonitor.endTimer(timerId);
        return null;
      }

      // Check expiration
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(fullKey);
        this.stats.misses++;
        performanceMonitor.endTimer(timerId);
        return null;
      }

      // Update access statistics
      entry.lastAccessed = Date.now();
      entry.accessCount++;
      this.stats.hits++;

      performanceMonitor.endTimer(timerId);

      // Decompress if needed
      let value = entry.value;
      if (entry.compressed && options.compress !== false) {
        value = await this.decompress(value);
      }

      // Deserialize if needed
      if (options.serialize !== false && typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          // Value is not JSON, return as-is
        }
      }

      return value;

    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Cache get failed: ${error.message}`);
    }
  }

  /**
   * Set value in cache
   */
  async set(
    key: string, 
    value: any, 
    options: CacheOptions = {}
  ): Promise<boolean> {
    const timerId = performanceMonitor.startTimer('cache_set');
    const fullKey = this.buildKey(key, options.namespace);

    try {
      let processedValue = value;
      let compressed = false;

      // Serialize if needed
      if (options.serialize !== false && typeof value !== 'string') {
        processedValue = JSON.stringify(value);
      }

      // Compress if value is large enough
      const valueSize = this.estimateSize(processedValue);
      if (options.compress !== false && valueSize > this.config.compressionThreshold) {
        processedValue = await this.compress(processedValue);
        compressed = true;
      }

      // Check memory limits before adding
      if (this.stats.memoryUsage + valueSize > this.config.maxMemory) {
        await this.evictMemory(valueSize);
      }

      const now = Date.now();
      const ttl = options.ttl || this.config.defaultTTL;

      const entry: CacheEntry = {
        value: processedValue,
        createdAt: now,
        lastAccessed: now,
        expiresAt: now + ttl,
        accessCount: 0,
        size: valueSize,
        compressed,
      };

      this.cache.set(fullKey, entry);
      this.stats.sets++;

      performanceMonitor.endTimer(timerId);
      return true;

    } catch (error) {
      performanceMonitor.endTimer(timerId);
      throw createSystemError(`Cache set failed: ${error.message}`);
    }
  }

  /**
   * Delete key from cache
   */
  async del(key: string, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);
    const deleted = this.cache.delete(fullKey);
    
    if (deleted) {
      this.stats.deletes++;
    }

    return deleted;
  }

  /**
   * Check if key exists
   */
  async exists(key: string, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);
    const entry = this.cache.get(fullKey);
    
    if (!entry) return false;
    
    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(fullKey);
      return false;
    }

    return true;
  }

  /**
   * Set expiration time for key
   */
  async expire(key: string, ttl: number, options: CacheOptions = {}): Promise<boolean> {
    const fullKey = this.buildKey(key, options.namespace);
    const entry = this.cache.get(fullKey);
    
    if (!entry) return false;

    entry.expiresAt = Date.now() + ttl;
    return true;
  }

  /**
   * Get multiple keys
   */
  async mget(keys: string[], options: CacheOptions = {}): Promise<(any | null)[]> {
    const results: (any | null)[] = [];
    
    for (const key of keys) {
      results.push(await this.get(key, options));
    }

    return results;
  }

  /**
   * Set multiple key-value pairs
   */
  async mset(
    keyValues: Array<{ key: string; value: any }>, 
    options: CacheOptions = {}
  ): Promise<boolean> {
    try {
      for (const { key, value } of keyValues) {
        await this.set(key, value, options);
      }
      return true;
    } catch (error) {
      throw createSystemError(`Multi-set failed: ${error.message}`);
    }
  }

  /**
   * Increment numeric value
   */
  async incr(key: string, options: CacheOptions = {}): Promise<number> {
    const current = await this.get(key, options);
    const newValue = (typeof current === 'number' ? current : 0) + 1;
    await this.set(key, newValue, options);
    return newValue;
  }

  /**
   * Decrement numeric value
   */
  async decr(key: string, options: CacheOptions = {}): Promise<number> {
    const current = await this.get(key, options);
    const newValue = (typeof current === 'number' ? current : 0) - 1;
    await this.set(key, newValue, options);
    return newValue;
  }

  /**
   * Get keys matching pattern
   */
  async keys(pattern: string, options: CacheOptions = {}): Promise<string[]> {
    const namespace = options.namespace || '';
    const fullPattern = this.buildKey(pattern, namespace);
    const regex = this.patternToRegex(fullPattern);
    
    const matchingKeys: string[] = [];
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        // Remove prefix and namespace for return
        const cleanKey = key.replace(this.config.keyPrefix, '');
        if (namespace) {
          matchingKeys.push(cleanKey.replace(`${namespace}:`, ''));
        } else {
          matchingKeys.push(cleanKey);
        }
      }
    }

    return matchingKeys;
  }

  /**
   * Delete keys matching pattern
   */
  async deletePattern(pattern: string, options: CacheOptions = {}): Promise<number> {
    const keys = await this.keys(pattern, options);
    let deleted = 0;

    for (const key of keys) {
      if (await this.del(key, options)) {
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get detailed cache information
   */
  getCacheInfo(): {
    stats: CacheStats;
    config: typeof this.config;
    patterns: CachePattern[];
    topKeys: Array<{ key: string; accessCount: number; size: number }>;
  } {
    const patterns = this.analyzeCachePatterns();
    const topKeys = this.getTopAccessedKeys(10);

    return {
      stats: this.getStats(),
      config: { ...this.config },
      patterns,
      topKeys,
    };
  }

  /**
   * Clear all cache
   */
  async flushAll(): Promise<boolean> {
    this.cache.clear();
    this.resetStats();
    return true;
  }

  /**
   * Clear cache by namespace
   */
  async flushNamespace(namespace: string): Promise<number> {
    return await this.deletePattern('*', { namespace });
  }

  /**
   * Optimize cache performance
   */
  async optimize(): Promise<{
    beforeStats: CacheStats;
    afterStats: CacheStats;
    optimizations: string[];
  }> {
    const beforeStats = this.getStats();
    const optimizations: string[] = [];

    // Remove expired entries
    const expiredCount = this.removeExpiredEntries();
    if (expiredCount > 0) {
      optimizations.push(`Removed ${expiredCount} expired entries`);
    }

    // Compress large uncompressed entries
    const compressedCount = await this.compressLargeEntries();
    if (compressedCount > 0) {
      optimizations.push(`Compressed ${compressedCount} large entries`);
    }

    // Evict least accessed entries if memory usage is high
    if (this.stats.memoryUsage > this.config.maxMemory * 0.8) {
      const evictedCount = await this.evictLeastAccessed(0.1); // Evict 10%
      optimizations.push(`Evicted ${evictedCount} least accessed entries`);
    }

    const afterStats = this.getStats();

    return {
      beforeStats,
      afterStats,
      optimizations,
    };
  }

  /**
   * Private helper methods
   */
  private buildKey(key: string, namespace?: string): string {
    const parts = [this.config.keyPrefix];
    if (namespace) parts.push(namespace);
    parts.push(key);
    return parts.join(':');
  }

  private estimateSize(value: any): number {
    if (typeof value === 'string') {
      return value.length * 2; // UTF-16
    }
    return JSON.stringify(value).length * 2;
  }

  private async compress(value: string): Promise<string> {
    // Simple compression simulation (in real implementation, use zlib or similar)
    return `compressed:${value}`;
  }

  private async decompress(value: string): Promise<string> {
    // Simple decompression simulation
    if (value.startsWith('compressed:')) {
      return value.substring(11);
    }
    return value;
  }

  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*')
      .replace(/\\\?/g, '.');
    return new RegExp(`^${escaped}$`);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.removeExpiredEntries();
    }, this.CLEANUP_INTERVAL);
  }

  private startStatsTimer(): void {
    this.statsTimer = setInterval(() => {
      this.updateStats();
    }, this.STATS_UPDATE_INTERVAL);
  }

  private removeExpiredEntries(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  private async compressLargeEntries(): Promise<number> {
    let compressed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (!entry.compressed && entry.size > this.config.compressionThreshold) {
        try {
          const compressedValue = await this.compress(entry.value);
          entry.value = compressedValue;
          entry.compressed = true;
          entry.size = this.estimateSize(compressedValue);
          compressed++;
        } catch (error) {
          console.warn(`Failed to compress cache entry ${key}:`, error);
        }
      }
    }

    return compressed;
  }

  private async evictMemory(requiredSpace: number): Promise<void> {
    const entries = Array.from(this.cache.entries());
    
    // Sort by eviction policy
    switch (this.config.evictionPolicy) {
      case 'lru':
        entries.sort(([,a], [,b]) => a.lastAccessed - b.lastAccessed);
        break;
      case 'lfu':
        entries.sort(([,a], [,b]) => a.accessCount - b.accessCount);
        break;
      case 'ttl':
        entries.sort(([,a], [,b]) => a.expiresAt - b.expiresAt);
        break;
      case 'random':
        entries.sort(() => Math.random() - 0.5);
        break;
    }

    let freedSpace = 0;
    let evicted = 0;

    for (const [key, entry] of entries) {
      if (freedSpace >= requiredSpace) break;
      
      this.cache.delete(key);
      freedSpace += entry.size;
      evicted++;
    }

    console.info(`Evicted ${evicted} cache entries, freed ${freedSpace} bytes`);
  }

  private async evictLeastAccessed(percentage: number): Promise<number> {
    const entries = Array.from(this.cache.entries());
    const toEvict = Math.floor(entries.length * percentage);
    
    entries.sort(([,a], [,b]) => a.accessCount - b.accessCount);
    
    for (let i = 0; i < toEvict; i++) {
      this.cache.delete(entries[i][0]);
    }

    return toEvict;
  }

  private updateStats(): void {
    let totalSize = 0;
    let totalKeySize = 0;

    for (const [key, entry] of this.cache.entries()) {
      totalSize += entry.size;
      totalKeySize += key.length * 2;
    }

    this.stats.memoryUsage = totalSize;
    this.stats.keyCount = this.cache.size;
    this.stats.averageKeySize = this.cache.size > 0 ? totalKeySize / this.cache.size : 0;
    this.stats.hitRate = this.stats.hits + this.stats.misses > 0 ? 
      this.stats.hits / (this.stats.hits + this.stats.misses) : 0;
  }

  private resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      hitRate: 0,
      memoryUsage: 0,
      keyCount: 0,
      averageKeySize: 0,
    };
  }

  private analyzeCachePatterns(): CachePattern[] {
    const patterns: Map<string, { keys: string[]; totalSize: number }> = new Map();

    for (const [key, entry] of this.cache.entries()) {
      const pattern = this.extractPattern(key);
      
      if (!patterns.has(pattern)) {
        patterns.set(pattern, { keys: [], totalSize: 0 });
      }

      const patternData = patterns.get(pattern)!;
      patternData.keys.push(key);
      patternData.totalSize += entry.size;
    }

    return Array.from(patterns.entries()).map(([pattern, data]) => ({
      pattern,
      keys: data.keys,
      totalSize: data.totalSize,
      count: data.keys.length,
    }));
  }

  private extractPattern(key: string): string {
    // Extract pattern by replacing specific IDs with wildcards
    return key
      .replace(/:[a-f0-9-]{36}:/g, ':*:') // UUIDs
      .replace(/:\d+:/g, ':*:') // Numbers
      .replace(/:[a-zA-Z0-9]+$/g, ':*'); // End identifiers
  }

  private getTopAccessedKeys(limit: number): Array<{ key: string; accessCount: number; size: number }> {
    const entries = Array.from(this.cache.entries());
    
    return entries
      .map(([key, entry]) => ({
        key,
        accessCount: entry.accessCount,
        size: entry.size,
      }))
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit);
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
    }
    this.cache.clear();
  }
}

// Global cache service instance
export const cacheService = new RedisCacheService();

