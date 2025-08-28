// src/pipeline/processors/DataProcessor.js
import EventEmitter from 'events';
import { Logger } from '../monitoring/Logger.js';
import { DataValidator } from './DataValidator.js';
import { DataTransformer } from './DataTransformer.js';
import { DataEnricher } from './DataEnricher.js';

/**
 * Main data processing engine handling transformation, validation, and enrichment
 * Processes market data into standardized formats for downstream consumption
 */
export class DataProcessor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('DataProcessor');
    this.options = {
      batchSize: 100,
      processingTimeout: 5000,
      enableParallelProcessing: true,
      maxConcurrentJobs: 10,
      ...options
    };

    // Processing components
    this.validator = new DataValidator(this.options.validation || {});
    this.transformer = new DataTransformer(this.options.transformation || {});
    this.enricher = new DataEnricher(this.options.enrichment || {});

    // Processing state
    this.processingQueue = [];
    this.activeJobs = new Set();
    this.metrics = {
      processed: 0,
      failed: 0,
      averageProcessingTime: 0,
      lastProcessed: null
    };

    this.setupEventHandlers();
  }

  /**
   * Initialize the data processor
   */
  async initialize() {
    try {
      await Promise.all([
        this.validator.initialize(),
        this.transformer.initialize(),
        this.enricher.initialize()
      ]);

      this.logger.info('DataProcessor initialized');
    } catch (error) {
      this.logger.error('Failed to initialize DataProcessor', error);
      throw error;
    }
  }

  /**
   * Setup event handlers for processing components
   */
  setupEventHandlers() {
    this.validator.on('validation-error', (error) => {
      this.emit('validation-error', error);
    });

    this.transformer.on('transformation-error', (error) => {
      this.emit('transformation-error', error);
    });

    this.enricher.on('enrichment-error', (error) => {
      this.emit('enrichment-error', error);
    });
  }

  /**
   * Process incoming data through the pipeline
   */
  async processData(data) {
    const jobId = this.generateJobId();
    const startTime = Date.now();

    try {
      this.logger.debug(`Processing data job ${jobId}`, { sourceId: data.sourceId });

      // Validate incoming data
      const validationResult = await this.validator.validate(data);
      if (!validationResult.isValid) {
        throw new Error(`Validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Transform data to standard format
      const transformedData = await this.transformer.transform(data, validationResult.schema);

      // Enrich with additional data if needed
      const enrichedData = await this.enricher.enrich(transformedData);

      // Update metrics
      const processingTime = Date.now() - startTime;
      this.updateMetrics('success', processingTime);

      this.logger.debug(`Successfully processed job ${jobId} in ${processingTime}ms`);
      this.emit('transformed', enrichedData);

      return enrichedData;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics('error', processingTime);
      
      this.logger.error(`Failed to process job ${jobId}`, error);
      this.emit('processing-error', { jobId, data, error });
      
      throw error;
    }
  }

  /**
   * Process data in batches for better performance
   */
  async processBatch(dataArray) {
    const batchId = this.generateJobId();
    const startTime = Date.now();

    try {
      this.logger.debug(`Processing batch ${batchId} with ${dataArray.length} items`);

      const results = [];
      
      if (this.options.enableParallelProcessing) {
        // Process in parallel with concurrency limit
        const chunks = this.chunkArray(dataArray, this.options.maxConcurrentJobs);
        
        for (const chunk of chunks) {
          const chunkPromises = chunk.map(data => this.processData(data));
          const chunkResults = await Promise.allSettled(chunkPromises);
          
          results.push(...chunkResults.map((result, index) => ({
            index: results.length + index,
            success: result.status === 'fulfilled',
            data: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason : null
          })));
        }
      } else {
        // Process sequentially
        for (let i = 0; i < dataArray.length; i++) {
          try {
            const result = await this.processData(dataArray[i]);
            results.push({ index: i, success: true, data: result, error: null });
          } catch (error) {
            results.push({ index: i, success: false, data: null, error });
          }
        }
      }

      const processingTime = Date.now() - startTime;
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      this.logger.info(`Batch ${batchId} completed: ${successful} successful, ${failed} failed in ${processingTime}ms`);

      this.emit('batch-processed', {
        batchId,
        totalItems: dataArray.length,
        successful,
        failed,
        processingTime,
        results
      });

      return results;

    } catch (error) {
      this.logger.error(`Batch processing failed for ${batchId}`, error);
      throw error;
    }
  }

  /**
   * Add processing schema for specific data types
   */
  addSchema(dataType, schema) {
    this.validator.addSchema(dataType, schema);
    this.transformer.addTransformation(dataType, schema.transformation);
    
    if (schema.enrichment) {
      this.enricher.addEnrichment(dataType, schema.enrichment);
    }

    this.logger.info(`Added processing schema for ${dataType}`);
  }

  /**
   * Get processing schema for data type
   */
  getSchema(dataType) {
    return this.validator.getSchema(dataType);
  }

  /**
   * Update processing metrics
   */
  updateMetrics(type, processingTime) {
    if (type === 'success') {
      this.metrics.processed++;
      this.metrics.lastProcessed = Date.now();
    } else if (type === 'error') {
      this.metrics.failed++;
    }

    // Calculate average processing time
    if (this.metrics.processed > 0) {
      this.metrics.averageProcessingTime = 
        (this.metrics.averageProcessingTime * (this.metrics.processed - 1) + processingTime) / 
        this.metrics.processed;
    }
  }

  /**
   * Generate unique job ID
   */
  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Split array into chunks for parallel processing
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Get processor health status
   */
  async getHealth() {
    const [validatorHealth, transformerHealth, enricherHealth] = await Promise.all([
      this.validator.getHealth(),
      this.transformer.getHealth(),
      this.enricher.getHealth()
    ]);

    const overallHealth = [validatorHealth, transformerHealth, enricherHealth]
      .every(h => h.status === 'healthy') ? 'healthy' : 'unhealthy';

    return {
      status: overallHealth,
      metrics: this.metrics,
      components: {
        validator: validatorHealth,
        transformer: transformerHealth,
        enricher: enricherHealth
      }
    };
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      ...this.metrics,
      activeJobs: this.activeJobs.size,
      queueSize: this.processingQueue.length,
      successRate: this.metrics.processed > 0 
        ? (this.metrics.processed / (this.metrics.processed + this.metrics.failed)) * 100 
        : 0
    };
  }

  /**
   * Shutdown the processor
   */
  async shutdown() {
    try {
      // Wait for active jobs to complete
      while (this.activeJobs.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await Promise.all([
        this.validator.shutdown(),
        this.transformer.shutdown(),
        this.enricher.shutdown()
      ]);

      this.logger.info('DataProcessor shutdown completed');
    } catch (error) {
      this.logger.error('Error during DataProcessor shutdown', error);
      throw error;
    }
  }
}