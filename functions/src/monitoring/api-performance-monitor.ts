/**
 * API Performance Monitor for Fylgja
 * Comprehensive monitoring, validation, and performance tracking
 */

import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

export interface PerformanceMetrics {
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  timestamp: Date;
  userId?: string;
  platform?: string;
  errorMessage?: string;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  score: number; // 0-100
}

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    database: ServiceHealth;
    googleAI: ServiceHealth;
    authentication: ServiceHealth;
    cache: ServiceHealth;
  };
  overall: {
    responseTime: number;
    errorRate: number;
    uptime: number;
  };
}

export interface ServiceHealth {
  status: 'up' | 'down' | 'degraded';
  responseTime: number;
  errorRate: number;
  lastCheck: Date;
  details?: any;
}

export class APIPerformanceMonitor {
  private db = getFirestore();
  private metrics: PerformanceMetrics[] = [];
  private healthChecks: Map<string, ServiceHealth> = new Map();
  private alertThresholds = {
    responseTime: 3000, // 3 seconds
    errorRate: 0.05, // 5%
    memoryUsage: 0.85, // 85%
    cpuUsage: 0.80 // 80%
  };

  /**
   * Track API request performance
   */
  async trackRequest(
    endpoint: string,
    method: string,
    startTime: number,
    statusCode: number,
    options: {
      userId?: string;
      platform?: string;
      errorMessage?: string;
    } = {}
  ): Promise<void> {
    const responseTime = Date.now() - startTime;
    const memoryUsage = process.memoryUsage();
    
    const metric: PerformanceMetrics = {
      endpoint,
      method,
      responseTime,
      statusCode,
      timestamp: new Date(),
      userId: options.userId,
      platform: options.platform,
      errorMessage: options.errorMessage,
      memoryUsage: memoryUsage.heapUsed / memoryUsage.heapTotal,
      cpuUsage: process.cpuUsage().user / 1000000 // Convert to seconds
    };

    // Store in memory for immediate analysis
    this.metrics.push(metric);
    
    // Keep only last 1000 metrics in memory
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }

    // Store in database for long-term analysis
    await this.storeMetric(metric);

    // Check for alerts
    await this.checkAlerts(metric);

    logger.info('API Request Tracked', {
      endpoint,
      method,
      responseTime,
      statusCode,
      userId: options.userId
    });
  }

  /**
   * Validate API request/response
   */
  validateRequest(data: any, schema: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let score = 100;

    try {
      // Basic validation
      if (!data) {
        errors.push('Request data is required');
        score -= 50;
      }

      // Schema validation (simplified)
      if (schema.required) {
        for (const field of schema.required) {
          if (!data[field]) {
            errors.push(`Required field '${field}' is missing`);
            score -= 10;
          }
        }
      }

      // Type validation
      if (schema.properties) {
        for (const [field, fieldSchema] of Object.entries(schema.properties as any)) {
          if (data[field] && fieldSchema.type) {
            const actualType = typeof data[field];
            if (actualType !== fieldSchema.type) {
              errors.push(`Field '${field}' should be ${fieldSchema.type}, got ${actualType}`);
              score -= 5;
            }
          }
        }
      }

      // Performance warnings
      if (data.input && data.input.length > 1000) {
        warnings.push('Input text is very long, may impact performance');
        score -= 5;
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        score: Math.max(0, score)
      };

    } catch (error) {
      return {
        valid: false,
        errors: [`Validation error: ${error.message}`],
        warnings,
        score: 0
      };
    }
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();

    // Check individual services
    const services = {
      database: await this.checkDatabaseHealth(),
      googleAI: await this.checkGoogleAIHealth(),
      authentication: await this.checkAuthHealth(),
      cache: await this.checkCacheHealth()
    };

    // Calculate overall metrics
    const recentMetrics = this.getRecentMetrics(300000); // Last 5 minutes
    const avgResponseTime = this.calculateAverageResponseTime(recentMetrics);
    const errorRate = this.calculateErrorRate(recentMetrics);
    const uptime = this.calculateUptime();

    // Determine overall status
    const serviceStatuses = Object.values(services).map(s => s.status);
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (serviceStatuses.includes('down')) {
      overallStatus = 'unhealthy';
    } else if (serviceStatuses.includes('degraded') || errorRate > this.alertThresholds.errorRate) {
      overallStatus = 'degraded';
    }

    const healthCheck: HealthCheckResult = {
      status: overallStatus,
      services,
      overall: {
        responseTime: avgResponseTime,
        errorRate,
        uptime
      }
    };

    // Store health check result
    await this.storeHealthCheck(healthCheck);

    logger.info('Health Check Completed', {
      status: overallStatus,
      responseTime: Date.now() - startTime,
      services: Object.keys(services).reduce((acc, key) => {
        acc[key] = services[key].status;
        return acc;
      }, {} as any)
    });

    return healthCheck;
  }

  /**
   * Get performance analytics
   */
  getPerformanceAnalytics(timeRange: number = 3600000): any { // Default 1 hour
    const recentMetrics = this.getRecentMetrics(timeRange);
    
    if (recentMetrics.length === 0) {
      return {
        totalRequests: 0,
        averageResponseTime: 0,
        errorRate: 0,
        topEndpoints: [],
        platformDistribution: {},
        hourlyDistribution: {}
      };
    }

    // Calculate metrics
    const totalRequests = recentMetrics.length;
    const averageResponseTime = this.calculateAverageResponseTime(recentMetrics);
    const errorRate = this.calculateErrorRate(recentMetrics);

    // Top endpoints
    const endpointCounts = recentMetrics.reduce((acc, metric) => {
      acc[metric.endpoint] = (acc[metric.endpoint] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topEndpoints = Object.entries(endpointCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([endpoint, count]) => ({ endpoint, count }));

    // Platform distribution
    const platformDistribution = recentMetrics.reduce((acc, metric) => {
      if (metric.platform) {
        acc[metric.platform] = (acc[metric.platform] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    // Hourly distribution
    const hourlyDistribution = recentMetrics.reduce((acc, metric) => {
      const hour = metric.timestamp.getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    return {
      totalRequests,
      averageResponseTime,
      errorRate,
      topEndpoints,
      platformDistribution,
      hourlyDistribution,
      responseTimePercentiles: this.calculatePercentiles(
        recentMetrics.map(m => m.responseTime)
      )
    };
  }

  /**
   * Generate performance report
   */
  async generatePerformanceReport(timeRange: number = 86400000): Promise<string> { // Default 24 hours
    const analytics = this.getPerformanceAnalytics(timeRange);
    const healthCheck = await this.performHealthCheck();

    const report = `
# Fylgja API Performance Report
Generated: ${new Date().toISOString()}
Time Range: ${timeRange / 3600000} hours

## Overall Health: ${healthCheck.status.toUpperCase()}

### Key Metrics
- Total Requests: ${analytics.totalRequests}
- Average Response Time: ${analytics.averageResponseTime.toFixed(2)}ms
- Error Rate: ${(analytics.errorRate * 100).toFixed(2)}%
- System Uptime: ${(healthCheck.overall.uptime * 100).toFixed(2)}%

### Response Time Percentiles
- P50: ${analytics.responseTimePercentiles.p50}ms
- P90: ${analytics.responseTimePercentiles.p90}ms
- P95: ${analytics.responseTimePercentiles.p95}ms
- P99: ${analytics.responseTimePercentiles.p99}ms

### Service Health
${Object.entries(healthCheck.services).map(([service, health]) => 
  `- ${service}: ${health.status} (${health.responseTime}ms)`
).join('\n')}

### Top Endpoints
${analytics.topEndpoints.map((ep, i) => 
  `${i + 1}. ${ep.endpoint}: ${ep.count} requests`
).join('\n')}

### Platform Distribution
${Object.entries(analytics.platformDistribution).map(([platform, count]) => 
  `- ${platform}: ${count} requests`
).join('\n')}

### Recommendations
${this.generateRecommendations(analytics, healthCheck)}
    `.trim();

    return report;
  }

  // Private helper methods
  private async storeMetric(metric: PerformanceMetrics): Promise<void> {
    try {
      await this.db.collection('performance_metrics').add({
        ...metric,
        timestamp: metric.timestamp
      });
    } catch (error) {
      logger.error('Failed to store performance metric', error);
    }
  }

  private async storeHealthCheck(healthCheck: HealthCheckResult): Promise<void> {
    try {
      await this.db.collection('health_checks').add({
        ...healthCheck,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Failed to store health check', error);
    }
  }

  private async checkAlerts(metric: PerformanceMetrics): Promise<void> {
    const alerts: string[] = [];

    if (metric.responseTime > this.alertThresholds.responseTime) {
      alerts.push(`High response time: ${metric.responseTime}ms for ${metric.endpoint}`);
    }

    if (metric.statusCode >= 500) {
      alerts.push(`Server error: ${metric.statusCode} for ${metric.endpoint}`);
    }

    if (metric.memoryUsage && metric.memoryUsage > this.alertThresholds.memoryUsage) {
      alerts.push(`High memory usage: ${(metric.memoryUsage * 100).toFixed(1)}%`);
    }

    if (alerts.length > 0) {
      logger.warn('Performance Alert', {
        alerts,
        metric: {
          endpoint: metric.endpoint,
          responseTime: metric.responseTime,
          statusCode: metric.statusCode,
          userId: metric.userId
        }
      });

      // Store alerts for dashboard
      await this.storeAlert(alerts, metric);
    }
  }

  private async storeAlert(alerts: string[], metric: PerformanceMetrics): Promise<void> {
    try {
      await this.db.collection('performance_alerts').add({
        alerts,
        metric,
        timestamp: new Date(),
        resolved: false
      });
    } catch (error) {
      logger.error('Failed to store alert', error);
    }
  }

  private getRecentMetrics(timeRange: number): PerformanceMetrics[] {
    const cutoff = new Date(Date.now() - timeRange);
    return this.metrics.filter(m => m.timestamp >= cutoff);
  }

  private calculateAverageResponseTime(metrics: PerformanceMetrics[]): number {
    if (metrics.length === 0) return 0;
    return metrics.reduce((sum, m) => sum + m.responseTime, 0) / metrics.length;
  }

  private calculateErrorRate(metrics: PerformanceMetrics[]): number {
    if (metrics.length === 0) return 0;
    const errors = metrics.filter(m => m.statusCode >= 400).length;
    return errors / metrics.length;
  }

  private calculateUptime(): number {
    // Simplified uptime calculation
    const recentMetrics = this.getRecentMetrics(3600000); // Last hour
    if (recentMetrics.length === 0) return 1;
    
    const successfulRequests = recentMetrics.filter(m => m.statusCode < 500).length;
    return successfulRequests / recentMetrics.length;
  }

  private calculatePercentiles(values: number[]): any {
    if (values.length === 0) return { p50: 0, p90: 0, p95: 0, p99: 0 };
    
    const sorted = values.sort((a, b) => a - b);
    const getPercentile = (p: number) => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };

    return {
      p50: getPercentile(50),
      p90: getPercentile(90),
      p95: getPercentile(95),
      p99: getPercentile(99)
    };
  }

  private async checkDatabaseHealth(): Promise<ServiceHealth> {
    const startTime = Date.now();
    try {
      await this.db.collection('health_check').limit(1).get();
      return {
        status: 'up',
        responseTime: Date.now() - startTime,
        errorRate: 0,
        lastCheck: new Date()
      };
    } catch (error) {
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        errorRate: 1,
        lastCheck: new Date(),
        details: error.message
      };
    }
  }

  private async checkGoogleAIHealth(): Promise<ServiceHealth> {
    // Mock health check for Google AI
    return {
      status: 'up',
      responseTime: 150,
      errorRate: 0,
      lastCheck: new Date()
    };
  }

  private async checkAuthHealth(): Promise<ServiceHealth> {
    // Mock health check for Authentication
    return {
      status: 'up',
      responseTime: 50,
      errorRate: 0,
      lastCheck: new Date()
    };
  }

  private async checkCacheHealth(): Promise<ServiceHealth> {
    // Mock health check for Cache
    return {
      status: 'up',
      responseTime: 10,
      errorRate: 0,
      lastCheck: new Date()
    };
  }

  private generateRecommendations(analytics: any, healthCheck: HealthCheckResult): string {
    const recommendations: string[] = [];

    if (analytics.averageResponseTime > 2000) {
      recommendations.push('- Consider optimizing slow endpoints or adding caching');
    }

    if (analytics.errorRate > 0.01) {
      recommendations.push('- Investigate and fix sources of errors');
    }

    if (healthCheck.overall.uptime < 0.99) {
      recommendations.push('- Improve system reliability and error handling');
    }

    if (recommendations.length === 0) {
      recommendations.push('- System is performing well, continue monitoring');
    }

    return recommendations.join('\n');
  }
}

// Export singleton instance
export const apiPerformanceMonitor = new APIPerformanceMonitor();

