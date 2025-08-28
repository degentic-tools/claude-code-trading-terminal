// src/pipeline/PipelineService.js
import EventEmitter from 'events';
import { Logger } from './monitoring/Logger.js';
import { Pipeline } from './core/Pipeline.js';
import { DataSourceManager } from './sources/DataSourceManager.js';
import { HistoricalDataService } from './storage/HistoricalDataService.js';

/**
 * Main pipeline service that orchestrates all components
 * Integrates with CC Trading Terminal and provides unified data ingestion
 */
export class PipelineService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('PipelineService');
    this.options = {
      enableHistoricalData: true,
      enableRealTimeData: true,
      enableDataEnrichment: true,
      autoStart: false,
      healthCheckInterval: 30000,
      ...options
    };

    // Core components
    this.pipeline = null;
    this.dataSourceManager = null;
    this.historicalDataService = null;

    // Service state
    this.isInitialized = false;
    this.isRunning = false;
    this.startTime = null;

    // Pipeline configuration
    this.pipelineConfig = {
      // Connection manager settings
      maxConcurrentConnections: 50,
      connectionTimeout: 30000,
      heartbeatInterval: 30000,
      
      // Queue settings
      queueType: 'memory', // or 'persistent'
      maxConcurrency: 10,
      retryAttempts: 3,
      
      // Processing settings
      batchSize: 100,
      processingTimeout: 5000,
      
      // Data sources
      dataSources: [
        {
          id: 'cc-trading-terminal-main',
          type: 'cc-trading-terminal',
          enabled: true,
          config: {
            enabledFeeds: ['tokens', 'pools', 'trending', 'portfolio'],
            networks: ['eth-mainnet', 'base-mainnet'],
            pollingInterval: 5000
          }
        }
      ],

      // Historical data settings
      historicalData: {
        retentionPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
        backfillConcurrency: 3,
        compressionEnabled: true
      },

      ...options.pipelineConfig
    };
  }

  /**
   * Initialize the pipeline service
   */
  async initialize() {
    if (this.isInitialized) {
      this.logger.warn('Pipeline service already initialized');
      return;
    }

    try {
      this.logger.info('Initializing pipeline service...');

      // Initialize core pipeline
      await this.initializePipeline();

      // Initialize data source manager
      await this.initializeDataSourceManager();

      // Initialize historical data service if enabled
      if (this.options.enableHistoricalData) {
        await this.initializeHistoricalDataService();
      }

      // Setup event handlers
      this.setupEventHandlers();

      // Configure data sources
      await this.configureDataSources();

      this.isInitialized = true;

      // Auto-start if configured
      if (this.options.autoStart) {
        await this.start();
      }

      this.logger.info('Pipeline service initialized successfully');
      this.emit('initialized');

    } catch (error) {
      this.logger.error('Failed to initialize pipeline service', error);
      throw error;
    }
  }

  /**
   * Initialize the main pipeline
   */
  async initializePipeline() {
    this.pipeline = new Pipeline({
      maxConcurrentConnections: this.pipelineConfig.maxConcurrentConnections,
      connectionTimeout: this.pipelineConfig.connectionTimeout,
      heartbeatInterval: this.pipelineConfig.heartbeatInterval,
      queueType: this.pipelineConfig.queueType,
      maxConcurrency: this.pipelineConfig.maxConcurrency,
      retryAttempts: this.pipelineConfig.retryAttempts,
      batchSize: this.pipelineConfig.batchSize,
      processingTimeout: this.pipelineConfig.processingTimeout
    });

    await this.pipeline.initialize();
  }

  /**
   * Initialize data source manager
   */
  async initializeDataSourceManager() {
    this.dataSourceManager = new DataSourceManager({
      autoReconnect: true,
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      healthCheckInterval: this.options.healthCheckInterval
    });

    await this.dataSourceManager.initialize();
  }

  /**
   * Initialize historical data service
   */
  async initializeHistoricalDataService() {
    this.historicalDataService = new HistoricalDataService({
      dataDir: './pipeline-data',
      retentionPeriod: this.pipelineConfig.historicalData.retentionPeriod,
      backfillConcurrency: this.pipelineConfig.historicalData.backfillConcurrency,
      compressionEnabled: this.pipelineConfig.historicalData.compressionEnabled
    });

    await this.historicalDataService.initialize();
  }

  /**
   * Setup event handlers between components
   */
  setupEventHandlers() {
    // Pipeline events
    this.pipeline.on('data', async (processedData) => {
      try {
        // Store historical data if enabled
        if (this.options.enableHistoricalData && this.historicalDataService) {
          await this.historicalDataService.storeData(
            processedData.dataType,
            processedData.data,
            {
              sourceId: processedData.sourceId,
              transformedTimestamp: processedData.transformedTimestamp
            }
          );
        }

        // Emit processed data
        this.emit('data', processedData);

      } catch (error) {
        this.logger.error('Error handling pipeline data', error);
      }
    });

    this.pipeline.on('error', (error) => {
      this.logger.error('Pipeline error', error);
      this.emit('error', error);
    });

    // Data source manager events
    this.dataSourceManager.on('data', async (rawData) => {
      try {
        // Send data to pipeline for processing
        await this.pipeline.handleIncomingData(rawData.sourceId, rawData.data);
      } catch (error) {
        this.logger.error('Error processing data from source manager', error);
      }
    });

    this.dataSourceManager.on('source-error', (event) => {
      this.logger.error(`Data source error: ${event.sourceId}`, event.error);
      this.emit('source-error', event);
    });

    this.dataSourceManager.on('source-connected', (event) => {
      this.logger.info(`Data source connected: ${event.sourceId}`);
      this.emit('source-connected', event);
    });

    this.dataSourceManager.on('source-disconnected', (event) => {
      this.logger.warn(`Data source disconnected: ${event.sourceId}`);
      this.emit('source-disconnected', event);
    });

    // Historical data service events
    if (this.historicalDataService) {
      this.historicalDataService.on('backfill-completed', (job) => {
        this.logger.info(`Backfill completed: ${job.id}`);
        this.emit('backfill-completed', job);
      });

      this.historicalDataService.on('backfill-failed', (event) => {
        this.logger.error(`Backfill failed: ${event.job.id}`, event.error);
        this.emit('backfill-failed', event);
      });
    }
  }

  /**
   * Configure data sources from pipeline configuration
   */
  async configureDataSources() {
    for (const sourceConfig of this.pipelineConfig.dataSources) {
      try {
        await this.dataSourceManager.addSource(sourceConfig);
        this.logger.info(`Configured data source: ${sourceConfig.id}`);
      } catch (error) {
        this.logger.error(`Failed to configure data source: ${sourceConfig.id}`, error);
      }
    }
  }

  /**
   * Start the pipeline service
   */
  async start() {
    if (!this.isInitialized) {
      throw new Error('Pipeline service not initialized');
    }

    if (this.isRunning) {
      this.logger.warn('Pipeline service already running');
      return;
    }

    try {
      this.logger.info('Starting pipeline service...');
      this.startTime = Date.now();

      // Start core pipeline
      await this.pipeline.start();

      // Start data sources
      await this.dataSourceManager.startAll();

      this.isRunning = true;

      this.logger.info('Pipeline service started successfully');
      this.emit('started');

    } catch (error) {
      this.logger.error('Failed to start pipeline service', error);
      throw error;
    }
  }

  /**
   * Stop the pipeline service
   */
  async stop() {
    if (!this.isRunning) {
      this.logger.warn('Pipeline service not running');
      return;
    }

    try {
      this.logger.info('Stopping pipeline service...');

      // Stop data sources first
      await this.dataSourceManager.stopAll();

      // Stop pipeline
      await this.pipeline.stop();

      this.isRunning = false;

      this.logger.info('Pipeline service stopped successfully');
      this.emit('stopped');

    } catch (error) {
      this.logger.error('Error stopping pipeline service', error);
      throw error;
    }
  }

  /**
   * Add a new data source
   */
  async addDataSource(sourceConfig) {
    if (!this.dataSourceManager) {
      throw new Error('Data source manager not initialized');
    }

    await this.dataSourceManager.addSource(sourceConfig);
    
    // Add to pipeline configuration for persistence
    this.pipelineConfig.dataSources.push(sourceConfig);
  }

  /**
   * Remove a data source
   */
  async removeDataSource(sourceId) {
    if (!this.dataSourceManager) {
      throw new Error('Data source manager not initialized');
    }

    await this.dataSourceManager.removeSource(sourceId);

    // Remove from pipeline configuration
    const index = this.pipelineConfig.dataSources.findIndex(s => s.id === sourceId);
    if (index > -1) {
      this.pipelineConfig.dataSources.splice(index, 1);
    }
  }

  /**
   * Subscribe to specific data types
   */
  async subscribe(subscriptions) {
    if (!this.dataSourceManager) {
      throw new Error('Data source manager not initialized');
    }

    return this.dataSourceManager.subscribe(subscriptions);
  }

  /**
   * Unsubscribe from data types
   */
  async unsubscribe(subscriptions) {
    if (!this.dataSourceManager) {
      throw new Error('Data source manager not initialized');
    }

    return this.dataSourceManager.unsubscribe(subscriptions);
  }

  /**
   * Get historical data
   */
  async getHistoricalData(dataType, options = {}) {
    if (!this.historicalDataService) {
      throw new Error('Historical data service not enabled');
    }

    return this.historicalDataService.retrieveData(dataType, options);
  }

  /**
   * Start data backfill
   */
  async startBackfill(dataType, backfillConfig) {
    if (!this.historicalDataService) {
      throw new Error('Historical data service not enabled');
    }

    return this.historicalDataService.backfillData(dataType, backfillConfig);
  }

  /**
   * Get pipeline health status
   */
  async getHealth() {
    try {
      const healthData = {
        service: {
          status: this.isRunning ? 'running' : 'stopped',
          initialized: this.isInitialized,
          uptime: this.startTime ? Date.now() - this.startTime : 0
        },
        pipeline: null,
        dataSources: null,
        historicalData: null
      };

      // Get pipeline health
      if (this.pipeline) {
        healthData.pipeline = await this.pipeline.getHealth();
      }

      // Get data source health
      if (this.dataSourceManager) {
        healthData.dataSources = this.dataSourceManager.getAllSourcesStatus();
      }

      // Get historical data service health
      if (this.historicalDataService) {
        healthData.historicalData = await this.historicalDataService.getHealth();
      }

      return healthData;

    } catch (error) {
      return {
        service: { status: 'unhealthy', error: error.message },
        pipeline: null,
        dataSources: null,
        historicalData: null
      };
    }
  }

  /**
   * Get pipeline statistics
   */
  async getStatistics() {
    const stats = {
      service: {
        uptime: this.startTime ? Date.now() - this.startTime : 0,
        isRunning: this.isRunning,
        startTime: this.startTime
      },
      pipeline: null,
      dataSources: null,
      historicalData: null
    };

    try {
      // Pipeline stats
      if (this.pipeline) {
        const health = await this.pipeline.getHealth();
        stats.pipeline = health.pipeline.metrics;
      }

      // Data source stats
      if (this.dataSourceManager) {
        stats.dataSources = this.dataSourceManager.getMetrics();
      }

      // Historical data stats
      if (this.historicalDataService) {
        const health = await this.historicalDataService.getHealth();
        stats.historicalData = health.storageStats;
      }

    } catch (error) {
      this.logger.error('Error getting statistics', error);
    }

    return stats;
  }

  /**
   * Update pipeline configuration
   */
  updateConfiguration(newConfig) {
    this.pipelineConfig = {
      ...this.pipelineConfig,
      ...newConfig
    };

    this.emit('configuration-updated', this.pipelineConfig);
  }

  /**
   * Get current pipeline configuration
   */
  getConfiguration() {
    return { ...this.pipelineConfig };
  }

  /**
   * Shutdown the pipeline service
   */
  async shutdown() {
    try {
      this.logger.info('Shutting down pipeline service...');

      // Stop if running
      if (this.isRunning) {
        await this.stop();
      }

      // Shutdown components
      const shutdownPromises = [];

      if (this.pipeline) {
        shutdownPromises.push(this.pipeline.cleanup());
      }

      if (this.dataSourceManager) {
        shutdownPromises.push(this.dataSourceManager.shutdown());
      }

      if (this.historicalDataService) {
        shutdownPromises.push(this.historicalDataService.shutdown());
      }

      await Promise.all(shutdownPromises);

      this.isInitialized = false;
      this.pipeline = null;
      this.dataSourceManager = null;
      this.historicalDataService = null;

      this.logger.info('Pipeline service shutdown completed');
      this.emit('shutdown');

    } catch (error) {
      this.logger.error('Error during pipeline service shutdown', error);
      throw error;
    }
  }
}