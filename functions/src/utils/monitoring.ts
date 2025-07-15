/**
 * Monitoring and Performance Tracking for Fylgja
 * Comprehensive monitoring, metrics collection, and performance analysis
 */

import { performance } from 'perf_hooks';
import { DatabaseService } from '../services/database-service';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count' | 'percentage';
  timestamp: string;
  tags: Record<string, string>;
  metadata?: Record<string, any>;
}

export interface SystemMetrics {
  timestamp: string;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  requests: {
    total: number;
    successful: number;
    failed: number;
    averageResponseTime: number;
  };
  errors: {
    total: number;
    byType: Record<string, number>;
    errorRate: number;
  };
  ai: {
    requestCount: number;
    averageResponseTime: number;
    tokensUsed: number;
    errorRate: number;
  };
  database: {
    queryCount: number;
    averageQueryTime: number;
    cacheHitRate: number;
    errorRate: number;
  };
}

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  condition: 'greater_than' | 'less_than' | 'equals' | 'not_equals';
  threshold: number;
  duration: number; // seconds
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  lastTriggered?: string;
  triggerCount: number;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  metric: string;
  value: number;
  threshold: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
  metadata: Record<string, any>;
}

export class PerformanceMonitor {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private activeTimers: Map<string, number> = new Map();
  private dbService: DatabaseService;
  private metricsBuffer: PerformanceMetric[] = [];
  private bufferFlushInterval: NodeJS.Timeout;

  constructor() {
    this.dbService = new DatabaseService();
    
    // Flush metrics buffer every 30 seconds
    this.bufferFlushInterval = setInterval(() => {
      this.flushMetricsBuffer();
    }, 30000);
  }

  /**
   * Start timing a performance metric
   */
  public startTimer(name: string, tags: Record<string, string> = {}): string {
    const timerId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.activeTimers.set(timerId, performance.now());
    return timerId;
  }

  /**
   * End timing and record metric
   */
  public endTimer(timerId: string, additionalTags: Record<string, string> = {}): number {
    const startTime = this.activeTimers.get(timerId);
    if (!startTime) {
      console.warn(`Timer ${timerId} not found`);
      return 0;
    }

    const duration = performance.now() - startTime;
    this.activeTimers.delete(timerId);

    // Extract name from timer ID
    const name = timerId.split('_')[0];
    
    this.recordMetric({
      name: `${name}_duration`,
      value: duration,
      unit: 'ms',
      timestamp: new Date().toISOString(),
      tags: additionalTags,
    });

    return duration;
  }

  /**
   * Record a performance metric
   */
  public recordMetric(metric: PerformanceMetric): void {
    // Add to in-memory storage
    const metricHistory = this.metrics.get(metric.name) || [];
    metricHistory.push(metric);
    
    // Keep only last 1000 metrics per type
    if (metricHistory.length > 1000) {
      metricHistory.shift();
    }
    
    this.metrics.set(metric.name, metricHistory);

    // Add to buffer for database storage
    this.metricsBuffer.push(metric);

    // Flush buffer if it gets too large
    if (this.metricsBuffer.length >= 100) {
      this.flushMetricsBuffer();
    }
  }

  /**
   * Record counter metric
   */
  public incrementCounter(name: string, value: number = 1, tags: Record<string, string> = {}): void {
    this.recordMetric({
      name,
      value,
      unit: 'count',
      timestamp: new Date().toISOString(),
      tags,
    });
  }

  /**
   * Record gauge metric
   */
  public recordGauge(name: string, value: number, unit: 'ms' | 'bytes' | 'count' | 'percentage', tags: Record<string, string> = {}): void {
    this.recordMetric({
      name,
      value,
      unit,
      timestamp: new Date().toISOString(),
      tags,
    });
  }

  /**
   * Get metrics for a specific name
   */
  public getMetrics(name: string, limit: number = 100): PerformanceMetric[] {
    const metrics = this.metrics.get(name) || [];
    return metrics.slice(-limit);
  }

  /**
   * Get aggregated metrics
   */
  public getAggregatedMetrics(name: string, timeWindow: number = 3600): {
    count: number;
    average: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } {
    const cutoff = Date.now() - (timeWindow * 1000);
    const metrics = this.getMetrics(name)
      .filter(m => new Date(m.timestamp).getTime() > cutoff)
      .map(m => m.value)
      .sort((a, b) => a - b);

    if (metrics.length === 0) {
      return {
        count: 0,
        average: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const sum = metrics.reduce((a, b) => a + b, 0);
    
    return {
      count: metrics.length,
      average: sum / metrics.length,
      min: metrics[0],
      max: metrics[metrics.length - 1],
      p50: this.percentile(metrics, 50),
      p95: this.percentile(metrics, 95),
      p99: this.percentile(metrics, 99),
    };
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedArray: number[], percentile: number): number {
    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sortedArray[lower];
    }
    
    const weight = index - lower;
    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }

  /**
   * Flush metrics buffer to database
   */
  private async flushMetricsBuffer(): Promise<void> {
    if (this.metricsBuffer.length === 0) return;

    const metricsToFlush = [...this.metricsBuffer];
    this.metricsBuffer = [];

    try {
      // In a real implementation, you'd batch insert these to the database
      // For now, we'll just log them
      console.log(`Flushing ${metricsToFlush.length} metrics to database`);
      
      // You could implement database storage here
      // await this.dbService.saveMetrics(metricsToFlush);
    } catch (error) {
      console.error('Failed to flush metrics:', error);
      // Re-add metrics to buffer for retry
      this.metricsBuffer.unshift(...metricsToFlush);
    }
  }

  /**
   * Get all metric names
   */
  public getMetricNames(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Clear metrics
   */
  public clearMetrics(name?: string): void {
    if (name) {
      this.metrics.delete(name);
    } else {
      this.metrics.clear();
    }
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.bufferFlushInterval) {
      clearInterval(this.bufferFlushInterval);
    }
    this.flushMetricsBuffer();
  }
}

export class SystemMonitor {
  private performanceMonitor: PerformanceMonitor;
  private dbService: DatabaseService;
  private monitoringInterval: NodeJS.Timeout;
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();

  constructor() {
    this.performanceMonitor = new PerformanceMonitor();
    this.dbService = new DatabaseService();
    
    // Monitor system metrics every minute
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 60000);

    // Initialize default alert rules
    this.initializeDefaultAlertRules();
  }

  /**
   * Collect system metrics
   */
  private async collectSystemMetrics(): Promise<void> {
    try {
      const metrics = await this.getSystemMetrics();
      
      // Record individual metrics
      this.performanceMonitor.recordGauge('memory_usage_percentage', metrics.memory.percentage, 'percentage');
      this.performanceMonitor.recordGauge('cpu_usage', metrics.cpu.usage, 'percentage');
      this.performanceMonitor.recordGauge('request_count', metrics.requests.total, 'count');
      this.performanceMonitor.recordGauge('error_rate', metrics.errors.errorRate, 'percentage');
      this.performanceMonitor.recordGauge('ai_response_time', metrics.ai.averageResponseTime, 'ms');
      this.performanceMonitor.recordGauge('database_query_time', metrics.database.averageQueryTime, 'ms');

      // Check alert rules
      await this.checkAlertRules(metrics);

      // Store system metrics
      await this.storeSystemMetrics(metrics);
    } catch (error) {
      console.error('Failed to collect system metrics:', error);
    }
  }

  /**
   * Get current system metrics
   */
  public async getSystemMetrics(): Promise<SystemMetrics> {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Get performance metrics
    const requestMetrics = this.performanceMonitor.getAggregatedMetrics('request_duration');
    const errorMetrics = this.performanceMonitor.getAggregatedMetrics('error_count');
    const aiMetrics = this.performanceMonitor.getAggregatedMetrics('ai_request_duration');
    const dbMetrics = this.performanceMonitor.getAggregatedMetrics('database_query_duration');

    return {
      timestamp: new Date().toISOString(),
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
      },
      cpu: {
        usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to percentage
        loadAverage: [0, 0, 0], // Not available in Node.js on all platforms
      },
      requests: {
        total: requestMetrics.count,
        successful: requestMetrics.count - errorMetrics.count,
        failed: errorMetrics.count,
        averageResponseTime: requestMetrics.average,
      },
      errors: {
        total: errorMetrics.count,
        byType: {}, // Would be populated from error tracking
        errorRate: errorMetrics.count > 0 ? (errorMetrics.count / requestMetrics.count) * 100 : 0,
      },
      ai: {
        requestCount: aiMetrics.count,
        averageResponseTime: aiMetrics.average,
        tokensUsed: 0, // Would be tracked separately
        errorRate: 0, // Would be calculated from AI-specific errors
      },
      database: {
        queryCount: dbMetrics.count,
        averageQueryTime: dbMetrics.average,
        cacheHitRate: 0, // Would be tracked by database service
        errorRate: 0, // Would be calculated from DB-specific errors
      },
    };
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultAlertRules(): void {
    const defaultRules: Omit<AlertRule, 'id' | 'lastTriggered' | 'triggerCount'>[] = [
      {
        name: 'High Memory Usage',
        metric: 'memory_usage_percentage',
        condition: 'greater_than',
        threshold: 85,
        duration: 300, // 5 minutes
        severity: 'high',
        enabled: true,
      },
      {
        name: 'High Error Rate',
        metric: 'error_rate',
        condition: 'greater_than',
        threshold: 5, // 5%
        duration: 180, // 3 minutes
        severity: 'high',
        enabled: true,
      },
      {
        name: 'Slow AI Response Time',
        metric: 'ai_response_time',
        condition: 'greater_than',
        threshold: 10000, // 10 seconds
        duration: 300, // 5 minutes
        severity: 'medium',
        enabled: true,
      },
      {
        name: 'High CPU Usage',
        metric: 'cpu_usage',
        condition: 'greater_than',
        threshold: 80,
        duration: 600, // 10 minutes
        severity: 'medium',
        enabled: true,
      },
    ];

    defaultRules.forEach(rule => {
      const alertRule: AlertRule = {
        ...rule,
        id: this.generateAlertRuleId(),
        triggerCount: 0,
      };
      this.alertRules.set(alertRule.id, alertRule);
    });
  }

  /**
   * Check alert rules against current metrics
   */
  private async checkAlertRules(metrics: SystemMetrics): Promise<void> {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;

      const metricValue = this.getMetricValue(metrics, rule.metric);
      const shouldTrigger = this.evaluateCondition(metricValue, rule.condition, rule.threshold);

      if (shouldTrigger) {
        await this.triggerAlert(rule, metricValue);
      } else {
        await this.resolveAlert(rule.id);
      }
    }
  }

  /**
   * Get metric value from system metrics
   */
  private getMetricValue(metrics: SystemMetrics, metricName: string): number {
    switch (metricName) {
      case 'memory_usage_percentage':
        return metrics.memory.percentage;
      case 'cpu_usage':
        return metrics.cpu.usage;
      case 'error_rate':
        return metrics.errors.errorRate;
      case 'ai_response_time':
        return metrics.ai.averageResponseTime;
      case 'database_query_time':
        return metrics.database.averageQueryTime;
      default:
        return 0;
    }
  }

  /**
   * Evaluate alert condition
   */
  private evaluateCondition(value: number, condition: string, threshold: number): boolean {
    switch (condition) {
      case 'greater_than':
        return value > threshold;
      case 'less_than':
        return value < threshold;
      case 'equals':
        return value === threshold;
      case 'not_equals':
        return value !== threshold;
      default:
        return false;
    }
  }

  /**
   * Trigger an alert
   */
  private async triggerAlert(rule: AlertRule, value: number): Promise<void> {
    const existingAlert = this.activeAlerts.get(rule.id);
    
    if (existingAlert && !existingAlert.resolved) {
      // Alert already active
      return;
    }

    const alert: Alert = {
      id: this.generateAlertId(),
      ruleId: rule.id,
      ruleName: rule.name,
      metric: rule.metric,
      value,
      threshold: rule.threshold,
      severity: rule.severity,
      timestamp: new Date().toISOString(),
      resolved: false,
      metadata: {
        condition: rule.condition,
        duration: rule.duration,
      },
    };

    this.activeAlerts.set(rule.id, alert);
    rule.triggerCount++;
    rule.lastTriggered = new Date().toISOString();

    // Log alert
    await this.logAlert(alert);

    // Send notification (in production, this would integrate with notification systems)
    console.warn(`ALERT: ${alert.ruleName} - ${alert.metric} is ${alert.value} (threshold: ${alert.threshold})`);
  }

  /**
   * Resolve an alert
   */
  private async resolveAlert(ruleId: string): Promise<void> {
    const alert = this.activeAlerts.get(ruleId);
    
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
      
      await this.logAlert(alert);
      console.info(`RESOLVED: ${alert.ruleName} alert has been resolved`);
    }
  }

  /**
   * Log alert to database
   */
  private async logAlert(alert: Alert): Promise<void> {
    try {
      await this.dbService.logError({
        type: 'alert',
        severity: alert.severity,
        message: `Alert ${alert.resolved ? 'resolved' : 'triggered'}: ${alert.ruleName}`,
        metadata: alert,
      });
    } catch (error) {
      console.error('Failed to log alert:', error);
    }
  }

  /**
   * Store system metrics
   */
  private async storeSystemMetrics(metrics: SystemMetrics): Promise<void> {
    try {
      // In production, you'd store these in a time-series database
      console.log('System metrics collected:', {
        timestamp: metrics.timestamp,
        memory: `${metrics.memory.percentage.toFixed(1)}%`,
        cpu: `${metrics.cpu.usage.toFixed(1)}%`,
        requests: metrics.requests.total,
        errors: metrics.errors.total,
      });
    } catch (error) {
      console.error('Failed to store system metrics:', error);
    }
  }

  /**
   * Generate unique IDs
   */
  private generateAlertRuleId(): string {
    return `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Public methods for managing alerts
   */
  public addAlertRule(rule: Omit<AlertRule, 'id' | 'triggerCount'>): string {
    const alertRule: AlertRule = {
      ...rule,
      id: this.generateAlertRuleId(),
      triggerCount: 0,
    };
    this.alertRules.set(alertRule.id, alertRule);
    return alertRule.id;
  }

  public removeAlertRule(ruleId: string): boolean {
    return this.alertRules.delete(ruleId);
  }

  public getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  public getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(alert => !alert.resolved);
  }

  public getPerformanceMonitor(): PerformanceMonitor {
    return this.performanceMonitor;
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    this.performanceMonitor.destroy();
  }
}

// Global monitoring instances
export const performanceMonitor = new PerformanceMonitor();
export const systemMonitor = new SystemMonitor();

/**
 * Decorator for monitoring function performance
 */
export function monitor(metricName?: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const name = metricName || `${target.constructor.name}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      const timerId = performanceMonitor.startTimer(name);
      
      try {
        const result = await method.apply(this, args);
        performanceMonitor.endTimer(timerId, { status: 'success' });
        return result;
      } catch (error) {
        performanceMonitor.endTimer(timerId, { status: 'error' });
        performanceMonitor.incrementCounter(`${name}_errors`);
        throw error;
      }
    };

    return descriptor;
  };
}

