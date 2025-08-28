// src/pipeline/sources/DataSourceManager.js
import EventEmitter from 'events';
import { Logger } from '../monitoring/Logger.js';
import { CryptoDataSource } from './CryptoDataSource.js';
import { CCTradingTerminalSource } from './CCTradingTerminalSource.js';
import { CoingeckoSource } from './CoingeckoSource.js';
import { BinanceSource } from './BinanceSource.js';
import { UniswapSource } from './UniswapSource.js';

/**
 * Data source manager for coordinating multiple market data feeds
 * Integrates with existing CC Trading Terminal APIs and external sources
 */
export class DataSourceManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('DataSourceManager');
    this.options = {
      enabledSources: ['cc-trading-terminal', 'coingecko', 'binance'],
      autoReconnect: true,
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      healthCheckInterval: 30000,
      ...options
    };

    // Available data sources
    this.availableSources = new Map();
    this.activeSources = new Map();
    this.sourceConfigs = new Map();
    
    // Source metrics
    this.metrics = {
      totalSources: 0,
      activeSources: 0,
      totalMessages: 0,
      messagesBySource: {},
      errorsBySource: {},
      lastMessage: null
    };

    this.initializeAvailableSources();
  }

  /**
   * Initialize available data source types
   */
  initializeAvailableSources() {
    // CC Trading Terminal integration
    this.availableSources.set('cc-trading-terminal', CCTradingTerminalSource);
    
    // Crypto market data sources
    this.availableSources.set('coingecko', CoingeckoSource);
    this.availableSources.set('binance', BinanceSource);
    this.availableSources.set('uniswap', UniswapSource);
    
    // Generic crypto source
    this.availableSources.set('crypto-generic', CryptoDataSource);

    this.logger.info(`Initialized ${this.availableSources.size} available data source types`);
  }

  /**
   * Add and configure a data source
   */
  async addSource(sourceConfig) {
    const { id, type, enabled = true, ...config } = sourceConfig;
    
    try {
      if (!this.availableSources.has(type)) {
        throw new Error(`Unknown data source type: ${type}`);
      }

      // Store configuration
      this.sourceConfigs.set(id, { id, type, enabled, ...config });
      
      if (enabled) {
        await this.startSource(id);
      }

      this.logger.info(`Added data source: ${id} (${type})`);
      this.emit('source-added', { id, type, enabled });

    } catch (error) {
      this.logger.error(`Failed to add data source: ${id}`, error);
      throw error;
    }
  }

  /**
   * Start a data source
   */
  async startSource(sourceId) {
    try {
      const config = this.sourceConfigs.get(sourceId);
      if (!config) {
        throw new Error(`Source configuration not found: ${sourceId}`);
      }

      if (this.activeSources.has(sourceId)) {
        this.logger.warn(`Source already active: ${sourceId}`);
        return;
      }

      const SourceClass = this.availableSources.get(config.type);
      const source = new SourceClass(config);

      // Setup event handlers
      this.setupSourceEventHandlers(source, sourceId);

      // Initialize and start the source
      await source.initialize();
      await source.start();

      this.activeSources.set(sourceId, source);
      this.metrics.activeSources++;
      this.metrics.messagesBySource[sourceId] = 0;
      this.metrics.errorsBySource[sourceId] = 0;

      this.logger.info(`Started data source: ${sourceId}`);
      this.emit('source-started', { id: sourceId, type: config.type });

    } catch (error) {
      this.logger.error(`Failed to start data source: ${sourceId}`, error);
      throw error;
    }
  }

  /**
   * Stop a data source
   */
  async stopSource(sourceId) {
    try {
      const source = this.activeSources.get(sourceId);
      if (!source) {
        this.logger.warn(`Source not active: ${sourceId}`);
        return;
      }

      await source.stop();
      this.activeSources.delete(sourceId);
      this.metrics.activeSources--;

      this.logger.info(`Stopped data source: ${sourceId}`);
      this.emit('source-stopped', { id: sourceId });

    } catch (error) {
      this.logger.error(`Failed to stop data source: ${sourceId}`, error);
      throw error;
    }
  }

  /**
   * Remove a data source
   */
  async removeSource(sourceId) {
    try {
      // Stop if active
      if (this.activeSources.has(sourceId)) {
        await this.stopSource(sourceId);
      }

      // Remove configuration
      this.sourceConfigs.delete(sourceId);

      // Clean up metrics
      delete this.metrics.messagesBySource[sourceId];
      delete this.metrics.errorsBySource[sourceId];

      this.logger.info(`Removed data source: ${sourceId}`);
      this.emit('source-removed', { id: sourceId });

    } catch (error) {
      this.logger.error(`Failed to remove data source: ${sourceId}`, error);
      throw error;
    }
  }

  /**
   * Setup event handlers for a data source
   */
  setupSourceEventHandlers(source, sourceId) {
    source.on('data', (data) => {
      this.handleSourceData(sourceId, data);
    });

    source.on('error', (error) => {
      this.handleSourceError(sourceId, error);
    });

    source.on('connected', () => {
      this.handleSourceConnected(sourceId);
    });

    source.on('disconnected', () => {
      this.handleSourceDisconnected(sourceId);
    });

    source.on('reconnecting', (attempt) => {
      this.handleSourceReconnecting(sourceId, attempt);
    });
  }

  /**
   * Handle data from a source
   */
  handleSourceData(sourceId, data) {
    try {
      // Update metrics
      this.metrics.totalMessages++;
      this.metrics.messagesBySource[sourceId]++;
      this.metrics.lastMessage = Date.now();

      // Emit data with source information
      const enrichedData = {
        sourceId,
        data,
        timestamp: Date.now(),
        messageId: this.generateMessageId(sourceId)
      };

      this.emit('data', enrichedData);
      this.logger.debug(`Received data from ${sourceId}`, { 
        dataType: typeof data, 
        hasData: !!data 
      });

    } catch (error) {
      this.logger.error(`Error handling data from ${sourceId}`, error);
      this.handleSourceError(sourceId, error);
    }
  }

  /**
   * Handle source errors
   */
  handleSourceError(sourceId, error) {
    this.metrics.errorsBySource[sourceId]++;
    
    this.logger.error(`Error from data source ${sourceId}`, error);
    this.emit('source-error', { sourceId, error });

    // Attempt reconnection if enabled
    if (this.options.autoReconnect) {
      this.scheduleReconnect(sourceId);
    }
  }

  /**
   * Handle source connected
   */
  handleSourceConnected(sourceId) {
    this.logger.info(`Data source connected: ${sourceId}`);
    this.emit('source-connected', { sourceId });
  }

  /**
   * Handle source disconnected
   */
  handleSourceDisconnected(sourceId) {
    this.logger.warn(`Data source disconnected: ${sourceId}`);
    this.emit('source-disconnected', { sourceId });

    // Attempt reconnection if enabled
    if (this.options.autoReconnect) {
      this.scheduleReconnect(sourceId);
    }
  }

  /**
   * Handle source reconnecting
   */
  handleSourceReconnecting(sourceId, attempt) {
    this.logger.info(`Data source reconnecting: ${sourceId} (attempt ${attempt})`);
    this.emit('source-reconnecting', { sourceId, attempt });
  }

  /**
   * Schedule reconnection for a source
   */
  scheduleReconnect(sourceId) {
    const source = this.activeSources.get(sourceId);
    if (!source) return;

    setTimeout(async () => {
      try {
        if (source.reconnectAttempts < this.options.maxReconnectAttempts) {
          await source.reconnect();
        } else {
          this.logger.error(`Max reconnect attempts reached for ${sourceId}`);
          this.emit('source-failed', { sourceId, reason: 'max_reconnect_attempts' });
        }
      } catch (error) {
        this.logger.error(`Reconnection failed for ${sourceId}`, error);
      }
    }, this.options.reconnectDelay);
  }

  /**
   * Subscribe to specific data types from sources
   */
  async subscribe(subscriptions) {
    const results = [];

    for (const subscription of subscriptions) {
      const { sourceId, dataType, params } = subscription;

      try {
        const source = this.activeSources.get(sourceId);
        if (!source) {
          throw new Error(`Source not active: ${sourceId}`);
        }

        if (typeof source.subscribe === 'function') {
          const result = await source.subscribe(dataType, params);
          results.push({ sourceId, dataType, success: true, result });
        } else {
          throw new Error(`Source ${sourceId} does not support subscriptions`);
        }

      } catch (error) {
        results.push({ sourceId, dataType, success: false, error: error.message });
        this.logger.error(`Subscription failed for ${sourceId}:${dataType}`, error);
      }
    }

    return results;
  }

  /**
   * Unsubscribe from data types
   */
  async unsubscribe(subscriptions) {
    const results = [];

    for (const subscription of subscriptions) {
      const { sourceId, dataType, params } = subscription;

      try {
        const source = this.activeSources.get(sourceId);
        if (!source) {
          throw new Error(`Source not active: ${sourceId}`);
        }

        if (typeof source.unsubscribe === 'function') {
          const result = await source.unsubscribe(dataType, params);
          results.push({ sourceId, dataType, success: true, result });
        } else {
          throw new Error(`Source ${sourceId} does not support subscriptions`);
        }

      } catch (error) {
        results.push({ sourceId, dataType, success: false, error: error.message });
        this.logger.error(`Unsubscribe failed for ${sourceId}:${dataType}`, error);
      }
    }

    return results;
  }

  /**
   * Get data source status
   */
  getSourceStatus(sourceId) {
    const config = this.sourceConfigs.get(sourceId);
    const source = this.activeSources.get(sourceId);

    if (!config) {
      return { status: 'not_found' };
    }

    return {
      status: source ? 'active' : 'inactive',
      config: config,
      health: source ? source.getHealth() : null,
      metrics: {
        messages: this.metrics.messagesBySource[sourceId] || 0,
        errors: this.metrics.errorsBySource[sourceId] || 0
      }
    };
  }

  /**
   * Get all sources status
   */
  getAllSourcesStatus() {
    const sources = {};

    for (const sourceId of this.sourceConfigs.keys()) {
      sources[sourceId] = this.getSourceStatus(sourceId);
    }

    return {
      sources,
      summary: {
        total: this.sourceConfigs.size,
        active: this.activeSources.size,
        inactive: this.sourceConfigs.size - this.activeSources.size
      },
      metrics: this.metrics
    };
  }

  /**
   * Start all enabled sources
   */
  async startAll() {
    const startPromises = [];

    for (const [sourceId, config] of this.sourceConfigs.entries()) {
      if (config.enabled && !this.activeSources.has(sourceId)) {
        startPromises.push(
          this.startSource(sourceId).catch(error => {
            this.logger.error(`Failed to start ${sourceId}`, error);
            return { sourceId, error };
          })
        );
      }
    }

    const results = await Promise.all(startPromises);
    const failed = results.filter(r => r && r.error);

    this.logger.info(`Started ${this.activeSources.size} data sources, ${failed.length} failed`);
    
    return {
      started: this.activeSources.size,
      failed: failed.length,
      failures: failed
    };
  }

  /**
   * Stop all active sources
   */
  async stopAll() {
    const stopPromises = [];

    for (const sourceId of this.activeSources.keys()) {
      stopPromises.push(
        this.stopSource(sourceId).catch(error => {
          this.logger.error(`Failed to stop ${sourceId}`, error);
          return { sourceId, error };
        })
      );
    }

    const results = await Promise.all(stopPromises);
    const failed = results.filter(r => r && r.error);

    this.logger.info(`Stopped data sources, ${failed.length} failed`);
    
    return {
      stopped: results.length - failed.length,
      failed: failed.length,
      failures: failed
    };
  }

  /**
   * Perform health check on all sources
   */
  async performHealthCheck() {
    const healthResults = {};

    for (const [sourceId, source] of this.activeSources.entries()) {
      try {
        healthResults[sourceId] = await source.getHealth();
      } catch (error) {
        healthResults[sourceId] = {
          status: 'unhealthy',
          error: error.message,
          lastCheck: Date.now()
        };
      }
    }

    // Check inactive sources
    for (const sourceId of this.sourceConfigs.keys()) {
      if (!this.activeSources.has(sourceId)) {
        healthResults[sourceId] = {
          status: 'inactive',
          lastCheck: Date.now()
        };
      }
    }

    const healthySources = Object.values(healthResults)
      .filter(h => h.status === 'healthy').length;
    
    const overallHealth = {
      status: healthySources === this.activeSources.size ? 'healthy' : 'degraded',
      totalSources: this.sourceConfigs.size,
      activeSources: this.activeSources.size,
      healthySources,
      lastCheck: Date.now()
    };

    this.emit('health-check', { overall: overallHealth, sources: healthResults });

    return {
      overall: overallHealth,
      sources: healthResults
    };
  }

  /**
   * Generate unique message ID
   */
  generateMessageId(sourceId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${sourceId}_${timestamp}_${random}`;
  }

  /**
   * Get data source manager metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      uptime: Date.now() - (this.startTime || Date.now()),
      averageMessagesPerSource: this.metrics.totalMessages / Math.max(this.activeSources.size, 1)
    };
  }

  /**
   * Initialize the data source manager
   */
  async initialize() {
    this.startTime = Date.now();

    // Start health check interval
    if (this.options.healthCheckInterval > 0) {
      this.healthCheckInterval = setInterval(async () => {
        try {
          await this.performHealthCheck();
        } catch (error) {
          this.logger.error('Health check failed', error);
        }
      }, this.options.healthCheckInterval);
    }

    this.logger.info('DataSourceManager initialized');
  }

  /**
   * Shutdown the data source manager
   */
  async shutdown() {
    try {
      // Clear health check interval
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }

      // Stop all sources
      await this.stopAll();

      this.logger.info('DataSourceManager shutdown completed');

    } catch (error) {
      this.logger.error('Error during DataSourceManager shutdown', error);
      throw error;
    }
  }
}