// src/pipeline/core/Pipeline.js
import EventEmitter from 'events';
import { Logger } from '../monitoring/Logger.js';
import { QueueManager } from '../queue/QueueManager.js';
import { DataProcessor } from '../processors/DataProcessor.js';
import { ConnectionManager } from './ConnectionManager.js';
import { RateLimiter } from './RateLimiter.js';
import { HealthChecker } from '../monitoring/HealthChecker.js';

/**
 * Main data ingestion pipeline orchestrating all components
 * Similar to Aladdin's data management capabilities
 */
export class Pipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('Pipeline');
    this.options = {
      maxConcurrentConnections: 50,
      retryAttempts: 3,
      retryDelay: 1000,
      healthCheckInterval: 30000,
      ...options
    };

    // Core components
    this.connectionManager = new ConnectionManager(this.options);
    this.queueManager = new QueueManager(this.options);
    this.dataProcessor = new DataProcessor(this.options);
    this.rateLimiter = new RateLimiter(this.options);
    this.healthChecker = new HealthChecker(this.options);

    // Pipeline state
    this.isRunning = false;
    this.sources = new Map();
    this.metrics = {
      messagesProcessed: 0,
      messagesPerSecond: 0,
      errors: 0,
      lastProcessed: null,
      uptime: 0
    };

    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for component communication
   */
  setupEventHandlers() {
    this.connectionManager.on('data', this.handleIncomingData.bind(this));
    this.connectionManager.on('error', this.handleConnectionError.bind(this));
    this.connectionManager.on('connected', this.handleConnectionEstablished.bind(this));
    this.connectionManager.on('disconnected', this.handleConnectionLost.bind(this));

    this.queueManager.on('processed', this.updateMetrics.bind(this));
    this.queueManager.on('error', this.handleQueueError.bind(this));

    this.dataProcessor.on('transformed', this.handleTransformedData.bind(this));
    this.dataProcessor.on('validation-error', this.handleValidationError.bind(this));

    this.healthChecker.on('unhealthy', this.handleUnhealthyComponent.bind(this));
  }

  /**
   * Initialize and start the pipeline
   */
  async start() {
    try {
      this.logger.info('Starting data ingestion pipeline');
      
      // Initialize core components
      await this.queueManager.initialize();
      await this.dataProcessor.initialize();
      await this.rateLimiter.initialize();
      await this.healthChecker.initialize();

      // Start health monitoring
      this.startHealthChecks();

      this.isRunning = true;
      this.metrics.startTime = Date.now();

      this.logger.info('Pipeline started successfully');
      this.emit('started');

    } catch (error) {
      this.logger.error('Failed to start pipeline', error);
      throw error;
    }
  }

  /**
   * Stop the pipeline and cleanup resources
   */
  async stop() {
    try {
      this.logger.info('Stopping data ingestion pipeline');
      
      this.isRunning = false;
      
      // Stop all components
      await this.connectionManager.closeAll();
      await this.queueManager.shutdown();
      await this.dataProcessor.shutdown();
      await this.healthChecker.shutdown();

      this.logger.info('Pipeline stopped successfully');
      this.emit('stopped');

    } catch (error) {
      this.logger.error('Error stopping pipeline', error);
      throw error;
    }
  }

  /**
   * Add a data source to the pipeline
   */
  async addSource(sourceConfig) {
    try {
      if (!this.validateSourceConfig(sourceConfig)) {
        throw new Error('Invalid source configuration');
      }

      const { id, type, url, headers, options } = sourceConfig;
      
      // Check rate limits
      const canConnect = await this.rateLimiter.checkLimit(id);
      if (!canConnect) {
        throw new Error(`Rate limit exceeded for source: ${id}`);
      }

      // Create connection
      const connection = await this.connectionManager.connect({
        id,
        type,
        url,
        headers,
        options: {
          ...options,
          onReconnect: async () => {
            this.logger.info(`Reconnecting to source: ${id}`);
            await this.handleReconnection(id);
          }
        }
      });

      this.sources.set(id, {
        ...sourceConfig,
        connection,
        status: 'connected',
        lastData: null,
        errorCount: 0
      });

      this.logger.info(`Added source: ${id} (${type})`);
      this.emit('source-added', { id, type });

    } catch (error) {
      this.logger.error(`Failed to add source: ${sourceConfig.id}`, error);
      throw error;
    }
  }

  /**
   * Remove a data source from the pipeline
   */
  async removeSource(sourceId) {
    try {
      const source = this.sources.get(sourceId);
      if (!source) {
        throw new Error(`Source not found: ${sourceId}`);
      }

      await this.connectionManager.disconnect(sourceId);
      this.sources.delete(sourceId);

      this.logger.info(`Removed source: ${sourceId}`);
      this.emit('source-removed', { id: sourceId });

    } catch (error) {
      this.logger.error(`Failed to remove source: ${sourceId}`, error);
      throw error;
    }
  }

  /**
   * Handle incoming data from connections
   */
  async handleIncomingData(sourceId, data) {
    try {
      if (!this.isRunning) return;

      // Update source status
      const source = this.sources.get(sourceId);
      if (source) {
        source.lastData = Date.now();
      }

      // Add to processing queue
      await this.queueManager.add('data-processing', {
        sourceId,
        data,
        timestamp: Date.now(),
        messageId: this.generateMessageId()
      });

    } catch (error) {
      this.logger.error(`Error handling data from ${sourceId}`, error);
      this.handleError(sourceId, error);
    }
  }

  /**
   * Handle transformed data from processor
   */
  async handleTransformedData(data) {
    try {
      this.emit('data', data);
      this.updateMetrics({ type: 'processed', data });

    } catch (error) {
      this.logger.error('Error handling transformed data', error);
    }
  }

  /**
   * Handle connection errors
   */
  async handleConnectionError(sourceId, error) {
    const source = this.sources.get(sourceId);
    if (!source) return;

    source.errorCount++;
    source.status = 'error';

    this.logger.error(`Connection error for ${sourceId}`, error);

    // Implement exponential backoff
    if (source.errorCount <= this.options.retryAttempts) {
      const delay = this.options.retryDelay * Math.pow(2, source.errorCount - 1);
      
      setTimeout(async () => {
        try {
          await this.reconnectSource(sourceId);
        } catch (reconnectError) {
          this.logger.error(`Failed to reconnect ${sourceId}`, reconnectError);
        }
      }, delay);
    } else {
      this.logger.error(`Max retries exceeded for ${sourceId}, marking as failed`);
      source.status = 'failed';
      this.emit('source-failed', { id: sourceId, error });
    }
  }

  /**
   * Reconnect a failed source
   */
  async reconnectSource(sourceId) {
    const source = this.sources.get(sourceId);
    if (!source) return;

    try {
      const connection = await this.connectionManager.reconnect(sourceId);
      source.connection = connection;
      source.status = 'connected';
      source.errorCount = 0;

      this.logger.info(`Successfully reconnected ${sourceId}`);
      this.emit('source-reconnected', { id: sourceId });

    } catch (error) {
      throw error;
    }
  }

  /**
   * Start health monitoring
   */
  startHealthChecks() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getHealth();
        this.emit('health-check', health);

        // Check for unhealthy sources
        for (const [sourceId, source] of this.sources.entries()) {
          if (source.status === 'error' || source.status === 'failed') {
            this.emit('source-unhealthy', { id: sourceId, source });
          }
        }

      } catch (error) {
        this.logger.error('Health check failed', error);
      }
    }, this.options.healthCheckInterval);
  }

  /**
   * Get pipeline health status
   */
  async getHealth() {
    const now = Date.now();
    const uptime = this.metrics.startTime ? now - this.metrics.startTime : 0;

    const sourceStatus = Array.from(this.sources.entries()).map(([id, source]) => ({
      id,
      status: source.status,
      lastData: source.lastData,
      errorCount: source.errorCount,
      isHealthy: source.status === 'connected' && (now - source.lastData) < 60000
    }));

    const healthySources = sourceStatus.filter(s => s.isHealthy).length;
    const totalSources = sourceStatus.length;

    return {
      pipeline: {
        status: this.isRunning ? 'running' : 'stopped',
        uptime,
        metrics: this.metrics
      },
      sources: {
        total: totalSources,
        healthy: healthySources,
        unhealthy: totalSources - healthySources,
        details: sourceStatus
      },
      components: {
        connectionManager: await this.connectionManager.getHealth(),
        queueManager: await this.queueManager.getHealth(),
        dataProcessor: await this.dataProcessor.getHealth(),
        rateLimiter: await this.rateLimiter.getHealth()
      }
    };
  }

  /**
   * Update pipeline metrics
   */
  updateMetrics(event) {
    const now = Date.now();
    
    switch (event.type) {
      case 'processed':
        this.metrics.messagesProcessed++;
        this.metrics.lastProcessed = now;
        break;
      case 'error':
        this.metrics.errors++;
        break;
    }

    // Calculate messages per second
    if (this.metrics.startTime) {
      const elapsed = (now - this.metrics.startTime) / 1000;
      this.metrics.messagesPerSecond = Math.round(this.metrics.messagesProcessed / elapsed);
      this.metrics.uptime = elapsed;
    }
  }

  /**
   * Generate unique message ID
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate source configuration
   */
  validateSourceConfig(config) {
    const required = ['id', 'type', 'url'];
    return required.every(field => config[field]);
  }

  /**
   * Handle various error types
   */
  handleError(sourceId, error) {
    this.updateMetrics({ type: 'error', sourceId, error });
    this.emit('error', { sourceId, error });
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    await this.stop();
  }
}