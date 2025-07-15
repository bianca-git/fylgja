/**
 * API Performance Monitor for Fylgja
 * Comprehensive monitoring system for API performance, health, and metrics
 */

import { EnhancedDatabaseService } from '../services/enhanced-database-service';
import { FylgjaError } from '../utils/error-handler';

// Performance metric interfaces
interface PerformanceMetric {
  timestamp: Date;
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  userId?: string;
  platform?: string;
  requestSize: number;
  responseSize: number;
  cacheHit: boolean;
  errorType?: string;
}

interface AggregatedMetrics {
  endpoint: string;
  totalRequests: number;
  averageResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  successRate: number;
  cacheHitRate: number;
  throughput: number; // requests per second
  timestamp: Date;
}

interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  cpuUsage: number;
  activeConnections: number;
  queueDepth: number;
  errorRate: number;
  responseTime: number;
  timestamp: Date;
}

interface AlertRule {
  id: string;
  name: string;
  condition: string;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  cooldownPeriod: number; // minutes
  lastTriggered?: Date;
  actions: AlertAction[];
}

interface AlertAction {
  type: 'email' | 'webhook' | 'log' | 'auto_scale';
  target: string;
  parameters: Record<string, any>;
}

interface Alert {
  id: string;
  ruleId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  metadata: Record<string, any>;
}

/**
 * API Performance Monitor class
 */
export class APIPerformanceMonitor {
  private static instance: APIPerformanceMonitor;
  private database: EnhancedDatabaseService;
  private metrics: PerformanceMetric[] = [];
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private metricsBuffer: PerformanceMetric[] = [];
  private bufferFlushInterval: NodeJS.Timeout;
  private healthCheckInterval: NodeJS.Timeout;
  private startTime: Date = new Date();

  // Configuration
  private readonly config = {
    bufferSize: 1000,
    flushInterval: 30000, // 30 seconds
    healthCheckInterval: 60000, // 1 minute
    metricsRetentionDays: 30,
    alertCooldownMinutes: 15,
    performanceThresholds: {
      responseTime: {
        warning: 2000, // 2 seconds
        critical: 5000 // 5 seconds
      },
      errorRate: {
        warning: 0.05, // 5%
        critical: 0.10 // 10%
      },
      memoryUsage: {
        warning: 0.80, // 80%
        critical: 0.90 // 90%
      }
    }
  };

  private constructor() {
    this.database = new EnhancedDatabaseService();
    this.initializeDefaultAlertRules();
    this.startPeriodicTasks();
  }

  public static getInstance(): APIPerformanceMonitor {
    if (!APIPerformanceMonitor.instance) {
      APIPerformanceMonitor.instance = new APIPerformanceMonitor();
    }
    return APIPerformanceMonitor.instance;
  }

  /**
   * Record a performance metric
   */
  public recordMetric(metric: Omit<PerformanceMetric, 'timestamp'>): void {
    const fullMetric: PerformanceMetric = {
      ...metric,
      timestamp: new Date()
    };

    this.metricsBuffer.push(fullMetric);

    // Flush buffer if it's full
    if (this.metricsBuffer.length >= this.config.bufferSize) {
      this.flushMetricsBuffer();
    }

    // Check for real-time alerts
    this.checkRealTimeAlerts(fullMetric);
  }

  /**
   * Record API request performance
   */
  public async recordAPIRequest(
    endpoint: string,
    method: string,
    startTime: number,
    statusCode: number,
    options: {
      userId?: string;
      platform?: string;
      requestSize?: number;
      responseSize?: number;
      cacheHit?: boolean;
      errorType?: string;
    } = {}
  ): Promise<void> {
    const responseTime = Date.now() - startTime;

    this.recordMetric({
      endpoint,
      method,
      responseTime,
      statusCode,
      userId: options.userId,
      platform: options.platform,
      requestSize: options.requestSize || 0,
      responseSize: options.responseSize || 0,
      cacheHit: options.cacheHit || false,
      errorType: options.errorType
    });
  }

  /**
   * Get aggregated metrics for a time period
   */
  public async getAggregatedMetrics(
    startTime: Date,
    endTime: Date,
    groupBy: 'endpoint' | 'platform' | 'hour' | 'day' = 'endpoint'
  ): Promise<AggregatedMetrics[]> {
    try {
      // In a real implementation, this would query the database
      // For now, we'll simulate with in-memory data
      const filteredMetrics = this.metrics.filter(
        m => m.timestamp >= startTime && m.timestamp <= endTime
      );

      const grouped = this.groupMetrics(filteredMetrics, groupBy);
      const aggregated: AggregatedMetrics[] = [];

      for (const [key, metrics] of grouped.entries()) {
        const responseTimes = metrics.map(m => m.responseTime).sort((a, b) => a - b);
        const errors = metrics.filter(m => m.statusCode >= 400);
        const cacheHits = metrics.filter(m => m.cacheHit);

        aggregated.push({
          endpoint: key,
          totalRequests: metrics.length,
          averageResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
          p50ResponseTime: this.getPercentile(responseTimes, 0.5),
          p95ResponseTime: this.getPercentile(responseTimes, 0.95),
          p99ResponseTime: this.getPercentile(responseTimes, 0.99),
          errorRate: errors.length / metrics.length,
          successRate: (metrics.length - errors.length) / metrics.length,
          cacheHitRate: cacheHits.length / metrics.length,
          throughput: metrics.length / ((endTime.getTime() - startTime.getTime()) / 1000),
          timestamp: new Date()
        });
      }

      return aggregated;
    } catch (error) {
      throw new FylgjaError(
        'MONITORING_ERROR',
        'Failed to get aggregated metrics',
        { error: error.message }
      );
    }
  }

  /**
   * Get current system health
   */
  public async getSystemHealth(): Promise<SystemHealth> {
    try {
      const now = new Date();
      const recentMetrics = this.metrics.filter(
        m => now.getTime() - m.timestamp.getTime() < 300000 // Last 5 minutes
      );

      const errors = recentMetrics.filter(m => m.statusCode >= 400);
      const responseTimes = recentMetrics.map(m => m.responseTime);
      const avgResponseTime = responseTimes.length > 0 
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
        : 0;

      const errorRate = recentMetrics.length > 0 ? errors.length / recentMetrics.length : 0;

      // Simulate system metrics (in real implementation, these would come from system monitoring)
      const memoryUsage = {
        used: Math.floor(Math.random() * 8000000000), // 8GB max
        total: 8000000000,
        percentage: Math.random() * 0.8 // 0-80%
      };

      const health: SystemHealth = {
        status: this.determineHealthStatus(errorRate, avgResponseTime, memoryUsage.percentage),
        uptime: now.getTime() - this.startTime.getTime(),
        memoryUsage,
        cpuUsage: Math.random() * 0.7, // 0-70%
        activeConnections: Math.floor(Math.random() * 1000),
        queueDepth: Math.floor(Math.random() * 100),
        errorRate,
        responseTime: avgResponseTime,
        timestamp: now
      };

      return health;
    } catch (error) {
      throw new FylgjaError(
        'MONITORING_ERROR',
        'Failed to get system health',
        { error: error.message }
      );
    }
  }

  /**
   * Create or update alert rule
   */
  public createAlertRule(rule: Omit<AlertRule, 'id'>): string {
    const id = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fullRule: AlertRule = { ...rule, id };
    
    this.alertRules.set(id, fullRule);
    return id;
  }

  /**
   * Get all alert rules
   */
  public getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * Get active alerts
   */
  public getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(alert => !alert.resolved);
  }

  /**
   * Resolve an alert
   */
  public resolveAlert(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
    }
  }

  /**
   * Get performance trends
   */
  public async getPerformanceTrends(
    metric: 'responseTime' | 'errorRate' | 'throughput',
    period: 'hour' | 'day' | 'week'
  ): Promise<{ timestamp: Date; value: number }[]> {
    const now = new Date();
    const periodMs = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000
    }[period];

    const startTime = new Date(now.getTime() - periodMs);
    const metrics = await this.getAggregatedMetrics(startTime, now, 'hour');

    return metrics.map(m => ({
      timestamp: m.timestamp,
      value: metric === 'responseTime' ? m.averageResponseTime :
             metric === 'errorRate' ? m.errorRate :
             m.throughput
    }));
  }

  /**
   * Get top slow endpoints
   */
  public async getSlowEndpoints(limit: number = 10): Promise<{
    endpoint: string;
    averageResponseTime: number;
    requestCount: number;
  }[]> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const metrics = await this.getAggregatedMetrics(oneHourAgo, now, 'endpoint');

    return metrics
      .sort((a, b) => b.averageResponseTime - a.averageResponseTime)
      .slice(0, limit)
      .map(m => ({
        endpoint: m.endpoint,
        averageResponseTime: m.averageResponseTime,
        requestCount: m.totalRequests
      }));
  }

  /**
   * Get error analysis
   */
  public async getErrorAnalysis(): Promise<{
    totalErrors: number;
    errorsByType: Record<string, number>;
    errorsByEndpoint: Record<string, number>;
    errorTrend: { timestamp: Date; count: number }[];
  }> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const errorMetrics = this.metrics.filter(
      m => m.timestamp >= oneDayAgo && m.statusCode >= 400
    );

    const errorsByType: Record<string, number> = {};
    const errorsByEndpoint: Record<string, number> = {};

    errorMetrics.forEach(metric => {
      if (metric.errorType) {
        errorsByType[metric.errorType] = (errorsByType[metric.errorType] || 0) + 1;
      }
      errorsByEndpoint[metric.endpoint] = (errorsByEndpoint[metric.endpoint] || 0) + 1;
    });

    // Generate hourly error trend
    const errorTrend: { timestamp: Date; count: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const hourStart = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
      const hourErrors = errorMetrics.filter(
        m => m.timestamp >= hourStart && m.timestamp < hourEnd
      );
      errorTrend.push({
        timestamp: hourStart,
        count: hourErrors.length
      });
    }

    return {
      totalErrors: errorMetrics.length,
      errorsByType,
      errorsByEndpoint,
      errorTrend
    };
  }

  /**
   * Private methods
   */

  private initializeDefaultAlertRules(): void {
    // High response time alert
    this.createAlertRule({
      name: 'High Response Time',
      condition: 'average_response_time > threshold',
      threshold: this.config.performanceThresholds.responseTime.warning,
      severity: 'medium',
      enabled: true,
      cooldownPeriod: this.config.alertCooldownMinutes,
      actions: [
        { type: 'log', target: 'console', parameters: {} }
      ]
    });

    // High error rate alert
    this.createAlertRule({
      name: 'High Error Rate',
      condition: 'error_rate > threshold',
      threshold: this.config.performanceThresholds.errorRate.warning,
      severity: 'high',
      enabled: true,
      cooldownPeriod: this.config.alertCooldownMinutes,
      actions: [
        { type: 'log', target: 'console', parameters: {} }
      ]
    });

    // High memory usage alert
    this.createAlertRule({
      name: 'High Memory Usage',
      condition: 'memory_usage > threshold',
      threshold: this.config.performanceThresholds.memoryUsage.warning,
      severity: 'medium',
      enabled: true,
      cooldownPeriod: this.config.alertCooldownMinutes,
      actions: [
        { type: 'log', target: 'console', parameters: {} }
      ]
    });
  }

  private startPeriodicTasks(): void {
    // Flush metrics buffer periodically
    this.bufferFlushInterval = setInterval(() => {
      this.flushMetricsBuffer();
    }, this.config.flushInterval);

    // Health check periodically
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private flushMetricsBuffer(): void {
    if (this.metricsBuffer.length === 0) return;

    // Move buffer to main metrics array
    this.metrics.push(...this.metricsBuffer);
    this.metricsBuffer = [];

    // Clean up old metrics
    const cutoffTime = new Date(Date.now() - this.config.metricsRetentionDays * 24 * 60 * 60 * 1000);
    this.metrics = this.metrics.filter(m => m.timestamp > cutoffTime);
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const health = await this.getSystemHealth();
      
      // Check alert conditions
      for (const rule of this.alertRules.values()) {
        if (!rule.enabled) continue;
        
        const shouldTrigger = this.evaluateAlertCondition(rule, health);
        if (shouldTrigger) {
          this.triggerAlert(rule, health);
        }
      }
    } catch (error) {
      console.error('Health check failed:', error);
    }
  }

  private checkRealTimeAlerts(metric: PerformanceMetric): void {
    // Check for immediate alert conditions
    if (metric.responseTime > this.config.performanceThresholds.responseTime.critical) {
      this.createAlert({
        ruleId: 'realtime_response_time',
        severity: 'critical',
        message: `Critical response time: ${metric.responseTime}ms on ${metric.endpoint}`,
        metadata: { metric }
      });
    }

    if (metric.statusCode >= 500) {
      this.createAlert({
        ruleId: 'realtime_server_error',
        severity: 'high',
        message: `Server error ${metric.statusCode} on ${metric.endpoint}`,
        metadata: { metric }
      });
    }
  }

  private evaluateAlertCondition(rule: AlertRule, health: SystemHealth): boolean {
    // Simple condition evaluation (in real implementation, this would be more sophisticated)
    switch (rule.condition) {
      case 'average_response_time > threshold':
        return health.responseTime > rule.threshold;
      case 'error_rate > threshold':
        return health.errorRate > rule.threshold;
      case 'memory_usage > threshold':
        return health.memoryUsage.percentage > rule.threshold;
      default:
        return false;
    }
  }

  private triggerAlert(rule: AlertRule, context: any): void {
    // Check cooldown period
    if (rule.lastTriggered) {
      const timeSinceLastTrigger = Date.now() - rule.lastTriggered.getTime();
      if (timeSinceLastTrigger < rule.cooldownPeriod * 60 * 1000) {
        return; // Still in cooldown
      }
    }

    this.createAlert({
      ruleId: rule.id,
      severity: rule.severity,
      message: `Alert: ${rule.name} - ${rule.condition} (threshold: ${rule.threshold})`,
      metadata: { context, rule }
    });

    rule.lastTriggered = new Date();

    // Execute alert actions
    rule.actions.forEach(action => {
      this.executeAlertAction(action, rule, context);
    });
  }

  private createAlert(alertData: Omit<Alert, 'id' | 'timestamp' | 'resolved'>): void {
    const alert: Alert = {
      ...alertData,
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      resolved: false
    };

    this.activeAlerts.set(alert.id, alert);
  }

  private executeAlertAction(action: AlertAction, rule: AlertRule, context: any): void {
    switch (action.type) {
      case 'log':
        console.log(`ALERT: ${rule.name}`, { rule, context });
        break;
      case 'webhook':
        // In real implementation, would make HTTP request to webhook URL
        console.log(`Webhook alert: ${action.target}`, { rule, context });
        break;
      // Add more action types as needed
    }
  }

  private groupMetrics(
    metrics: PerformanceMetric[],
    groupBy: 'endpoint' | 'platform' | 'hour' | 'day'
  ): Map<string, PerformanceMetric[]> {
    const grouped = new Map<string, PerformanceMetric[]>();

    metrics.forEach(metric => {
      let key: string;
      
      switch (groupBy) {
        case 'endpoint':
          key = metric.endpoint;
          break;
        case 'platform':
          key = metric.platform || 'unknown';
          break;
        case 'hour':
          key = new Date(metric.timestamp).toISOString().substr(0, 13);
          break;
        case 'day':
          key = new Date(metric.timestamp).toISOString().substr(0, 10);
          break;
        default:
          key = 'all';
      }

      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(metric);
    });

    return grouped;
  }

  private getPercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  private determineHealthStatus(
    errorRate: number,
    responseTime: number,
    memoryUsage: number
  ): 'healthy' | 'degraded' | 'unhealthy' {
    if (
      errorRate > this.config.performanceThresholds.errorRate.critical ||
      responseTime > this.config.performanceThresholds.responseTime.critical ||
      memoryUsage > this.config.performanceThresholds.memoryUsage.critical
    ) {
      return 'unhealthy';
    }

    if (
      errorRate > this.config.performanceThresholds.errorRate.warning ||
      responseTime > this.config.performanceThresholds.responseTime.warning ||
      memoryUsage > this.config.performanceThresholds.memoryUsage.warning
    ) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.bufferFlushInterval) {
      clearInterval(this.bufferFlushInterval);
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.flushMetricsBuffer();
  }
}

// Export singleton instance
export const apiPerformanceMonitor = APIPerformanceMonitor.getInstance();

