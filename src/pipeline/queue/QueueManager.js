// src/pipeline/queue/QueueManager.js
import EventEmitter from 'events';
import { Logger } from '../monitoring/Logger.js';
import { InMemoryQueue } from './InMemoryQueue.js';
import { PersistentQueue } from './PersistentQueue.js';

/**
 * Queue management system for high-throughput message processing
 * Supports both in-memory and persistent queues with retry logic
 */
export class QueueManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('QueueManager');
    this.options = {
      defaultQueueType: 'memory', // 'memory' or 'persistent'
      maxConcurrency: 10,
      retryAttempts: 3,
      retryDelay: 1000,
      deadLetterQueue: true,
      queueTimeout: 30000,
      ...options
    };

    // Queue instances
    this.queues = new Map();
    this.workers = new Map();
    this.processors = new Map();
    
    // Queue metrics
    this.metrics = {
      totalProcessed: 0,
      totalFailed: 0,
      activeJobs: 0,
      queueSizes: {},
      processingTimes: [],
      lastProcessed: null
    };

    this.isShuttingDown = false;
  }

  /**
   * Initialize the queue manager
   */
  async initialize() {
    try {
      // Create default processing queue
      await this.createQueue('data-processing', {
        type: this.options.defaultQueueType,
        concurrency: this.options.maxConcurrency,
        processor: this.defaultDataProcessor.bind(this)
      });

      // Create priority queues
      await this.createQueue('high-priority', {
        type: this.options.defaultQueueType,
        concurrency: 5,
        processor: this.defaultDataProcessor.bind(this)
      });

      await this.createQueue('low-priority', {
        type: this.options.defaultQueueType,
        concurrency: 2,
        processor: this.defaultDataProcessor.bind(this)
      });

      // Create dead letter queue if enabled
      if (this.options.deadLetterQueue) {
        await this.createQueue('dead-letter', {
          type: 'persistent',
          concurrency: 1,
          processor: this.deadLetterProcessor.bind(this)
        });
      }

      // Start metrics collection
      this.startMetricsCollection();

      this.logger.info('QueueManager initialized');
    } catch (error) {
      this.logger.error('Failed to initialize QueueManager', error);
      throw error;
    }
  }

  /**
   * Create a new queue
   */
  async createQueue(name, config = {}) {
    try {
      const queueConfig = {
        type: 'memory',
        concurrency: 1,
        retryAttempts: this.options.retryAttempts,
        retryDelay: this.options.retryDelay,
        ...config
      };

      let queue;
      if (queueConfig.type === 'persistent') {
        queue = new PersistentQueue(name, queueConfig);
      } else {
        queue = new InMemoryQueue(name, queueConfig);
      }

      await queue.initialize();

      // Setup event handlers
      queue.on('job-completed', (job, result) => {
        this.handleJobCompleted(name, job, result);
      });

      queue.on('job-failed', (job, error) => {
        this.handleJobFailed(name, job, error);
      });

      queue.on('job-retry', (job, attempt) => {
        this.handleJobRetry(name, job, attempt);
      });

      // Start processing if processor is provided
      if (queueConfig.processor) {
        this.processors.set(name, queueConfig.processor);
        await this.startWorker(name, queue, queueConfig);
      }

      this.queues.set(name, queue);
      this.metrics.queueSizes[name] = 0;

      this.logger.info(`Created queue: ${name} (${queueConfig.type})`);
      return queue;

    } catch (error) {
      this.logger.error(`Failed to create queue: ${name}`, error);
      throw error;
    }
  }

  /**
   * Add job to queue
   */
  async add(queueName, data, options = {}) {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        throw new Error(`Queue not found: ${queueName}`);
      }

      const jobOptions = {
        priority: 0,
        delay: 0,
        attempts: this.options.retryAttempts,
        backoff: 'exponential',
        removeOnComplete: 10,
        removeOnFail: 5,
        ...options
      };

      const job = await queue.add(data, jobOptions);
      
      // Update metrics
      this.metrics.queueSizes[queueName] = await queue.getWaiting();

      this.logger.debug(`Added job to queue ${queueName}`, { jobId: job.id });
      return job;

    } catch (error) {
      this.logger.error(`Failed to add job to queue ${queueName}`, error);
      throw error;
    }
  }

  /**
   * Add job to priority queue based on data type
   */
  async addWithPriority(data, priority = 'normal') {
    const queueMap = {
      'high': 'high-priority',
      'normal': 'data-processing',
      'low': 'low-priority'
    };

    const queueName = queueMap[priority] || 'data-processing';
    return this.add(queueName, data, { priority: this.getPriorityScore(priority) });
  }

  /**
   * Process jobs in batches
   */
  async addBatch(queueName, jobs, options = {}) {
    try {
      const queue = this.queues.get(queueName);
      if (!queue) {
        throw new Error(`Queue not found: ${queueName}`);
      }

      const batchId = this.generateBatchId();
      const batchJobs = jobs.map(data => ({
        data: { ...data, batchId },
        opts: { ...options, batchId }
      }));

      const results = await queue.addBulk(batchJobs);
      
      this.logger.info(`Added batch ${batchId} with ${jobs.length} jobs to ${queueName}`);
      return { batchId, jobs: results };

    } catch (error) {
      this.logger.error(`Failed to add batch to queue ${queueName}`, error);
      throw error;
    }
  }

  /**
   * Start worker for a queue
   */
  async startWorker(queueName, queue, config) {
    try {
      const processor = this.processors.get(queueName);
      if (!processor) {
        throw new Error(`No processor found for queue: ${queueName}`);
      }

      const worker = await queue.process(config.concurrency, async (job) => {
        const startTime = Date.now();
        
        try {
          this.metrics.activeJobs++;
          
          const result = await processor(job.data, job);
          
          const processingTime = Date.now() - startTime;
          this.updateProcessingTime(processingTime);
          
          return result;

        } catch (error) {
          const processingTime = Date.now() - startTime;
          this.updateProcessingTime(processingTime);
          throw error;
        } finally {
          this.metrics.activeJobs--;
        }
      });

      this.workers.set(queueName, worker);
      this.logger.info(`Started worker for queue: ${queueName}`);

    } catch (error) {
      this.logger.error(`Failed to start worker for queue: ${queueName}`, error);
      throw error;
    }
  }

  /**
   * Default data processor
   */
  async defaultDataProcessor(data, job) {
    try {
      // This is called by the DataProcessor component
      this.emit('process-data', data, job);
      
      // Wait for processing result
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Data processing timeout'));
        }, this.options.queueTimeout);

        const handleProcessed = (result) => {
          clearTimeout(timeout);
          resolve(result);
        };

        const handleError = (error) => {
          clearTimeout(timeout);
          reject(error);
        };

        this.once(`processed-${job.id}`, handleProcessed);
        this.once(`error-${job.id}`, handleError);
      });

    } catch (error) {
      this.logger.error('Default processor failed', error);
      throw error;
    }
  }

  /**
   * Dead letter queue processor
   */
  async deadLetterProcessor(data, job) {
    try {
      this.logger.warn('Processing dead letter', { 
        data: data, 
        attempts: job.attemptsMade,
        lastError: job.failedReason 
      });

      // Log failed job for analysis
      this.emit('dead-letter', {
        data,
        job: {
          id: job.id,
          attempts: job.attemptsMade,
          error: job.failedReason,
          timestamp: Date.now()
        }
      });

      return { processed: true, action: 'logged' };

    } catch (error) {
      this.logger.error('Dead letter processor failed', error);
      throw error;
    }
  }

  /**
   * Handle job completion
   */
  handleJobCompleted(queueName, job, result) {
    this.metrics.totalProcessed++;
    this.metrics.lastProcessed = Date.now();
    this.updateQueueSize(queueName);

    this.logger.debug(`Job completed in queue ${queueName}`, { jobId: job.id });
    this.emit('processed', { queueName, job, result });
    this.emit(`processed-${job.id}`, result);
  }

  /**
   * Handle job failure
   */
  handleJobFailed(queueName, job, error) {
    this.metrics.totalFailed++;
    this.updateQueueSize(queueName);

    this.logger.error(`Job failed in queue ${queueName}`, { 
      jobId: job.id, 
      attempts: job.attemptsMade,
      error: error.message 
    });

    // Send to dead letter queue if max attempts reached
    if (job.attemptsMade >= job.opts.attempts && this.options.deadLetterQueue) {
      this.add('dead-letter', {
        originalQueue: queueName,
        originalData: job.data,
        error: error.message,
        attempts: job.attemptsMade
      }).catch(dlqError => {
        this.logger.error('Failed to send to dead letter queue', dlqError);
      });
    }

    this.emit('job-failed', { queueName, job, error });
    this.emit(`error-${job.id}`, error);
  }

  /**
   * Handle job retry
   */
  handleJobRetry(queueName, job, attempt) {
    this.logger.warn(`Job retry ${attempt} in queue ${queueName}`, { jobId: job.id });
    this.emit('job-retry', { queueName, job, attempt });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    return {
      name: queueName,
      waiting: await queue.getWaiting(),
      active: await queue.getActive(),
      completed: await queue.getCompleted(),
      failed: await queue.getFailed(),
      delayed: await queue.getDelayed(),
      paused: await queue.isPaused()
    };
  }

  /**
   * Get all queues statistics
   */
  async getAllStats() {
    const stats = {};
    
    for (const queueName of this.queues.keys()) {
      try {
        stats[queueName] = await this.getQueueStats(queueName);
      } catch (error) {
        this.logger.error(`Failed to get stats for queue ${queueName}`, error);
        stats[queueName] = { error: error.message };
      }
    }

    return {
      queues: stats,
      global: this.metrics
    };
  }

  /**
   * Pause queue processing
   */
  async pauseQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    await queue.pause();
    this.logger.info(`Paused queue: ${queueName}`);
  }

  /**
   * Resume queue processing
   */
  async resumeQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    await queue.resume();
    this.logger.info(`Resumed queue: ${queueName}`);
  }

  /**
   * Clear queue
   */
  async clearQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    await queue.empty();
    this.updateQueueSize(queueName);
    this.logger.info(`Cleared queue: ${queueName}`);
  }

  /**
   * Get priority score for job prioritization
   */
  getPriorityScore(priority) {
    const scores = {
      'critical': 100,
      'high': 75,
      'normal': 50,
      'low': 25
    };
    
    return scores[priority] || 50;
  }

  /**
   * Generate unique batch ID
   */
  generateBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update processing time metrics
   */
  updateProcessingTime(time) {
    this.metrics.processingTimes.push(time);
    
    // Keep only last 1000 processing times
    if (this.metrics.processingTimes.length > 1000) {
      this.metrics.processingTimes = this.metrics.processingTimes.slice(-1000);
    }
  }

  /**
   * Update queue size metric
   */
  async updateQueueSize(queueName) {
    try {
      const queue = this.queues.get(queueName);
      if (queue) {
        this.metrics.queueSizes[queueName] = await queue.getWaiting();
      }
    } catch (error) {
      this.logger.error(`Failed to update queue size for ${queueName}`, error);
    }
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    this.metricsInterval = setInterval(async () => {
      try {
        // Update all queue sizes
        for (const queueName of this.queues.keys()) {
          await this.updateQueueSize(queueName);
        }

        // Emit metrics event
        this.emit('metrics', this.getMetrics());

      } catch (error) {
        this.logger.error('Error collecting metrics', error);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    const avgProcessingTime = this.metrics.processingTimes.length > 0
      ? this.metrics.processingTimes.reduce((sum, time) => sum + time, 0) / this.metrics.processingTimes.length
      : 0;

    return {
      ...this.metrics,
      averageProcessingTime: Math.round(avgProcessingTime),
      throughput: this.calculateThroughput(),
      errorRate: this.calculateErrorRate()
    };
  }

  /**
   * Calculate throughput (jobs per minute)
   */
  calculateThroughput() {
    // Simple calculation based on last processing time
    if (this.metrics.processingTimes.length < 2) return 0;
    
    const recentTimes = this.metrics.processingTimes.slice(-60); // Last 60 jobs
    const avgTime = recentTimes.reduce((sum, time) => sum + time, 0) / recentTimes.length;
    
    return avgTime > 0 ? Math.round(60000 / avgTime) : 0; // Jobs per minute
  }

  /**
   * Calculate error rate
   */
  calculateErrorRate() {
    const total = this.metrics.totalProcessed + this.metrics.totalFailed;
    return total > 0 ? (this.metrics.totalFailed / total) * 100 : 0;
  }

  /**
   * Get queue manager health
   */
  async getHealth() {
    try {
      const queueHealths = {};
      let healthyCount = 0;
      let totalCount = 0;

      for (const [name, queue] of this.queues.entries()) {
        try {
          const health = await queue.getHealth();
          queueHealths[name] = health;
          if (health.status === 'healthy') healthyCount++;
          totalCount++;
        } catch (error) {
          queueHealths[name] = { status: 'unhealthy', error: error.message };
          totalCount++;
        }
      }

      const overallHealth = healthyCount === totalCount ? 'healthy' : 'unhealthy';

      return {
        status: overallHealth,
        queues: queueHealths,
        metrics: this.getMetrics(),
        workers: this.workers.size
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Shutdown queue manager
   */
  async shutdown() {
    try {
      this.isShuttingDown = true;
      
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
      }

      this.logger.info('Shutting down queue manager...');

      // Close all workers
      const workerPromises = Array.from(this.workers.entries()).map(async ([name, worker]) => {
        try {
          await worker.close();
          this.logger.info(`Closed worker for queue: ${name}`);
        } catch (error) {
          this.logger.error(`Error closing worker for queue: ${name}`, error);
        }
      });

      await Promise.all(workerPromises);

      // Close all queues
      const queuePromises = Array.from(this.queues.entries()).map(async ([name, queue]) => {
        try {
          await queue.close();
          this.logger.info(`Closed queue: ${name}`);
        } catch (error) {
          this.logger.error(`Error closing queue: ${name}`, error);
        }
      });

      await Promise.all(queuePromises);

      this.queues.clear();
      this.workers.clear();
      this.processors.clear();

      this.logger.info('QueueManager shutdown completed');

    } catch (error) {
      this.logger.error('Error during QueueManager shutdown', error);
      throw error;
    }
  }
}