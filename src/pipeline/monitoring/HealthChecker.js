// src/pipeline/monitoring/HealthChecker.js
import EventEmitter from 'events';
import { Logger } from './Logger.js';

/**
 * Health monitoring system for pipeline components
 * Tracks system health and triggers alerts on issues
 */
export class HealthChecker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('HealthChecker');
    this.options = {
      checkInterval: 30000, // 30 seconds
      unhealthyThreshold: 3, // Number of failed checks before marking unhealthy
      criticalThreshold: 5, // Number of failed checks before critical
      enableAlerts: true,
      maxHistorySize: 100,
      ...options
    };

    // Component health tracking
    this.components = new Map();
    this.healthHistory = [];
    this.isRunning = false;
    this.checkInterval = null;

    // Overall system health
    this.systemHealth = {
      status: 'unknown',
      lastCheck: null,
      uptime: 0,
      startTime: Date.now()
    };
  }

  /**
   * Initialize the health checker
   */
  async initialize() {
    this.systemHealth.startTime = Date.now();
    this.isRunning = true;
    
    // Start periodic health checks
    this.startHealthChecks();
    
    this.logger.info('HealthChecker initialized');
  }

  /**
   * Register a component for health monitoring
   */
  registerComponent(name, component, options = {}) {
    const componentConfig = {
      name,
      component,
      isHealthy: true,
      lastCheck: null,
      failedChecks: 0,
      totalChecks: 0,
      averageResponseTime: 0,
      status: 'unknown',
      checkFunction: options.checkFunction,
      thresholds: {
        unhealthy: options.unhealthyThreshold || this.options.unhealthyThreshold,
        critical: options.criticalThreshold || this.options.criticalThreshold
      },
      ...options
    };

    this.components.set(name, componentConfig);
    this.logger.info(`Registered component for health monitoring: ${name}`);
  }

  /**
   * Unregister a component
   */
  unregisterComponent(name) {
    if (this.components.delete(name)) {
      this.logger.info(`Unregistered component: ${name}`);
    }
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Health check failed', error);
      }
    }, this.options.checkInterval);

    this.logger.info('Started periodic health checks');
  }

  /**
   * Perform health check on all registered components
   */
  async performHealthCheck() {
    const checkResults = new Map();
    const checkPromises = [];

    // Check each component
    for (const [name, config] of this.components.entries()) {
      checkPromises.push(
        this.checkComponent(name, config).then(result => {
          checkResults.set(name, result);
        }).catch(error => {
          checkResults.set(name, {
            name,
            status: 'error',
            error: error.message,
            timestamp: Date.now()
          });
        })
      );
    }

    await Promise.all(checkPromises);

    // Calculate overall system health
    const overallHealth = this.calculateOverallHealth(checkResults);
    
    // Update system health
    this.systemHealth = {
      ...overallHealth,
      uptime: Date.now() - this.systemHealth.startTime,
      lastCheck: Date.now()
    };

    // Store in history
    this.addToHistory({
      timestamp: Date.now(),
      systemHealth: this.systemHealth,
      componentHealth: Object.fromEntries(checkResults)
    });

    // Emit health check event
    this.emit('health-check', {
      system: this.systemHealth,
      components: Object.fromEntries(checkResults)
    });

    // Check for alerts
    if (this.options.enableAlerts) {
      this.checkForAlerts(checkResults);
    }

    return {
      system: this.systemHealth,
      components: Object.fromEntries(checkResults)
    };
  }

  /**
   * Check health of a specific component
   */
  async checkComponent(name, config) {
    const startTime = Date.now();
    
    try {
      config.totalChecks++;

      let healthResult;
      
      // Use custom check function if provided
      if (config.checkFunction) {
        healthResult = await config.checkFunction();
      } else if (config.component && typeof config.component.getHealth === 'function') {
        healthResult = await config.component.getHealth();
      } else {
        // Basic availability check
        healthResult = {
          status: config.component ? 'healthy' : 'unhealthy',
          message: config.component ? 'Component available' : 'Component not available'
        };
      }

      const responseTime = Date.now() - startTime;
      
      // Update average response time
      config.averageResponseTime = config.averageResponseTime === 0
        ? responseTime
        : (config.averageResponseTime + responseTime) / 2;

      // Determine health status
      const isHealthy = healthResult.status === 'healthy';
      
      if (isHealthy) {
        config.failedChecks = 0;
        config.isHealthy = true;
        config.status = 'healthy';
      } else {
        config.failedChecks++;
        
        if (config.failedChecks >= config.thresholds.critical) {
          config.status = 'critical';
          config.isHealthy = false;
        } else if (config.failedChecks >= config.thresholds.unhealthy) {
          config.status = 'unhealthy';
          config.isHealthy = false;
        }
      }

      config.lastCheck = Date.now();

      return {
        name,
        status: config.status,
        isHealthy: config.isHealthy,
        responseTime,
        averageResponseTime: Math.round(config.averageResponseTime),
        failedChecks: config.failedChecks,
        totalChecks: config.totalChecks,
        lastCheck: config.lastCheck,
        details: healthResult,
        uptime: this.calculateComponentUptime(config)
      };

    } catch (error) {
      config.failedChecks++;
      config.isHealthy = false;
      config.lastCheck = Date.now();

      if (config.failedChecks >= config.thresholds.critical) {
        config.status = 'critical';
      } else if (config.failedChecks >= config.thresholds.unhealthy) {
        config.status = 'unhealthy';
      } else {
        config.status = 'error';
      }

      this.logger.error(`Health check failed for ${name}`, error);

      return {
        name,
        status: config.status,
        isHealthy: false,
        responseTime: Date.now() - startTime,
        failedChecks: config.failedChecks,
        totalChecks: config.totalChecks,
        lastCheck: config.lastCheck,
        error: error.message,
        uptime: this.calculateComponentUptime(config)
      };
    }
  }

  /**
   * Calculate overall system health
   */
  calculateOverallHealth(componentResults) {
    const results = Array.from(componentResults.values());
    
    if (results.length === 0) {
      return { status: 'unknown', message: 'No components to check' };
    }

    const criticalCount = results.filter(r => r.status === 'critical').length;
    const unhealthyCount = results.filter(r => r.status === 'unhealthy').length;
    const healthyCount = results.filter(r => r.status === 'healthy').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    let systemStatus = 'healthy';
    let message = 'All components healthy';

    if (criticalCount > 0) {
      systemStatus = 'critical';
      message = `${criticalCount} critical, ${unhealthyCount} unhealthy components`;
    } else if (unhealthyCount > 0 || errorCount > 0) {
      systemStatus = 'degraded';
      message = `${unhealthyCount} unhealthy, ${errorCount} error components`;
    }

    return {
      status: systemStatus,
      message,
      summary: {
        total: results.length,
        healthy: healthyCount,
        unhealthy: unhealthyCount,
        critical: criticalCount,
        error: errorCount
      }
    };
  }

  /**
   * Calculate component uptime
   */
  calculateComponentUptime(config) {
    if (!config.lastCheck) return 0;
    
    const totalTime = Date.now() - this.systemHealth.startTime;
    const healthyTime = totalTime - (config.failedChecks * this.options.checkInterval);
    
    return Math.max(0, (healthyTime / totalTime) * 100);
  }

  /**
   * Add health check result to history
   */
  addToHistory(healthData) {
    this.healthHistory.push(healthData);
    
    // Limit history size
    if (this.healthHistory.length > this.options.maxHistorySize) {
      this.healthHistory = this.healthHistory.slice(-this.options.maxHistorySize);
    }
  }

  /**
   * Check for alerts and emit them
   */
  checkForAlerts(componentResults) {
    for (const [name, result] of componentResults.entries()) {
      const config = this.components.get(name);
      
      // New unhealthy component
      if (!result.isHealthy && config.isHealthy) {
        this.emit('component-unhealthy', {
          component: name,
          status: result.status,
          failedChecks: result.failedChecks,
          error: result.error
        });
      }
      
      // Component recovered
      if (result.isHealthy && !config.isHealthy) {
        this.emit('component-recovered', {
          component: name,
          downtime: this.calculateDowntime(config),
          totalChecks: result.totalChecks
        });
      }
      
      // Critical threshold reached
      if (result.status === 'critical' && config.status !== 'critical') {
        this.emit('component-critical', {
          component: name,
          failedChecks: result.failedChecks,
          threshold: config.thresholds.critical,
          error: result.error
        });
      }
    }

    // System-wide alerts
    if (this.systemHealth.status === 'critical') {
      this.emit('system-critical', {
        status: this.systemHealth,
        timestamp: Date.now()
      });
    } else if (this.systemHealth.status === 'degraded') {
      this.emit('system-degraded', {
        status: this.systemHealth,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Calculate component downtime
   */
  calculateDowntime(config) {
    if (config.failedChecks === 0) return 0;
    return config.failedChecks * this.options.checkInterval;
  }

  /**
   * Get health history
   */
  getHealthHistory(limit = null) {
    if (limit) {
      return this.healthHistory.slice(-limit);
    }
    return this.healthHistory;
  }

  /**
   * Get current health status
   */
  getCurrentHealth() {
    return {
      system: this.systemHealth,
      components: Object.fromEntries(
        Array.from(this.components.entries()).map(([name, config]) => [
          name,
          {
            name,
            status: config.status,
            isHealthy: config.isHealthy,
            failedChecks: config.failedChecks,
            totalChecks: config.totalChecks,
            lastCheck: config.lastCheck,
            averageResponseTime: Math.round(config.averageResponseTime),
            uptime: this.calculateComponentUptime(config)
          }
        ])
      )
    };
  }

  /**
   * Get health statistics
   */
  getHealthStats() {
    const now = Date.now();
    const components = Array.from(this.components.values());
    
    return {
      systemUptime: now - this.systemHealth.startTime,
      totalComponents: components.length,
      healthyComponents: components.filter(c => c.isHealthy).length,
      totalChecks: components.reduce((sum, c) => sum + c.totalChecks, 0),
      totalFailures: components.reduce((sum, c) => sum + c.failedChecks, 0),
      averageResponseTime: components.length > 0
        ? Math.round(components.reduce((sum, c) => sum + c.averageResponseTime, 0) / components.length)
        : 0,
      historySize: this.healthHistory.length,
      lastCheck: this.systemHealth.lastCheck
    };
  }

  /**
   * Get health checker status
   */
  async getHealth() {
    return {
      status: this.isRunning ? 'healthy' : 'stopped',
      isRunning: this.isRunning,
      checkInterval: this.options.checkInterval,
      registeredComponents: this.components.size,
      systemHealth: this.systemHealth,
      stats: this.getHealthStats()
    };
  }

  /**
   * Shutdown the health checker
   */
  async shutdown() {
    this.isRunning = false;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.logger.info('HealthChecker shutdown completed');
  }
}