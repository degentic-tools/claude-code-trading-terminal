// src/pipeline/queue/InMemoryQueue.js
import EventEmitter from 'events';
import { Logger } from '../monitoring/Logger.js';

/**
 * In-memory queue implementation for high-performance processing
 * Suitable for temporary data and non-critical processing
 */
export class InMemoryQueue extends EventEmitter {
  constructor(name, options = {}) {
    super();
    
    this.name = name;
    this.logger = new Logger(`InMemoryQueue:${name}`);
    this.options = {
      maxSize: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      concurrency: 1,
      ...options
    };

    // Queue storage
    this.jobs = [];
    this.activeJobs = new Map();
    this.completedJobs = [];
    this.failedJobs = [];
    this.delayedJobs = [];

    // Queue state
    this.isPausedState = false;
    this.isProcessing = false;
    this.jobIdCounter = 0;
    this.workers = [];
    this.processingPromise = null;

    // Metrics
    this.metrics = {
      added: 0,
      processed: 0,
      failed: 0,
      retried: 0
    };
  }

  /**
   * Initialize the queue
   */
  async initialize() {
    this.logger.info(`Initialized in-memory queue: ${this.name}`);
  }

  /**
   * Add job to queue
   */
  async add(data, options = {}) {
    if (this.jobs.length >= this.options.maxSize) {
      throw new Error(`Queue ${this.name} is full (max: ${this.options.maxSize})`);
    }

    const job = {
      id: `${this.name}-${++this.jobIdCounter}`,
      data,
      opts: {
        priority: 0,
        delay: 0,
        attempts: this.options.retryAttempts,
        backoff: 'exponential',
        removeOnComplete: 10,
        removeOnFail: 5,
        ...options
      },
      attemptsMade: 0,
      processedOn: null,
      finishedOn: null,
      failedReason: null,
      createdAt: Date.now()
    };

    if (job.opts.delay > 0) {
      // Add to delayed jobs
      job.delayedUntil = Date.now() + job.opts.delay;
      this.delayedJobs.push(job);
      this.scheduleDelayedJob(job);
    } else {
      // Add to main queue
      this.addToQueue(job);
    }

    this.metrics.added++;
    this.logger.debug(`Added job ${job.id} to queue`);
    
    // Start processing if not already running
    this.startProcessing();

    return job;
  }

  /**
   * Add multiple jobs in bulk
   */
  async addBulk(jobsData) {
    const jobs = [];
    
    for (const jobData of jobsData) {
      const job = await this.add(jobData.data, jobData.opts);
      jobs.push(job);
    }

    return jobs;
  }

  /**
   * Add job to queue with priority sorting
   */
  addToQueue(job) {
    // Insert job based on priority (higher priority first)
    let inserted = false;
    for (let i = 0; i < this.jobs.length; i++) {
      if (job.opts.priority > this.jobs[i].opts.priority) {
        this.jobs.splice(i, 0, job);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      this.jobs.push(job);
    }
  }

  /**
   * Process jobs with given processor function
   */
  async process(concurrency, processor) {
    if (typeof concurrency === 'function') {
      processor = concurrency;
      concurrency = 1;
    }

    this.options.concurrency = concurrency;
    this.processor = processor;

    // Start processing workers
    for (let i = 0; i < concurrency; i++) {
      this.startWorker(i);
    }

    return this;
  }

  /**
   * Start a worker for processing jobs
   */
  async startWorker(workerId) {
    const worker = {
      id: workerId,
      isActive: false,
      currentJob: null
    };

    this.workers[workerId] = worker;

    while (!this.isPausedState && this.processor) {
      try {
        const job = await this.getNextJob();
        if (!job) {
          // No jobs available, wait a bit
          await this.sleep(100);
          continue;
        }

        worker.isActive = true;
        worker.currentJob = job;
        
        await this.processJob(job, worker);

        worker.isActive = false;
        worker.currentJob = null;

      } catch (error) {
        this.logger.error(`Worker ${workerId} error`, error);
        worker.isActive = false;
        worker.currentJob = null;
        
        // Brief pause before retrying
        await this.sleep(1000);
      }
    }
  }

  /**
   * Get next job from queue
   */
  async getNextJob() {
    // Check delayed jobs first
    this.processDelayedJobs();

    // Get next job from main queue
    if (this.jobs.length === 0) {
      return null;
    }

    const job = this.jobs.shift();
    job.processedOn = Date.now();
    job.attemptsMade++;

    this.activeJobs.set(job.id, job);
    return job;
  }

  /**
   * Process a job
   */
  async processJob(job, worker) {
    try {
      const startTime = Date.now();
      const result = await this.processor(job);
      const processingTime = Date.now() - startTime;

      // Job completed successfully
      job.finishedOn = Date.now();
      job.processingTime = processingTime;
      job.result = result;

      this.activeJobs.delete(job.id);
      this.completedJobs.push(job);
      this.metrics.processed++;

      // Limit completed jobs storage
      if (this.completedJobs.length > job.opts.removeOnComplete) {
        this.completedJobs.splice(0, this.completedJobs.length - job.opts.removeOnComplete);
      }

      this.emit('job-completed', job, result);
      this.logger.debug(`Job ${job.id} completed in ${processingTime}ms`);

    } catch (error) {
      await this.handleJobFailure(job, error);
    }
  }

  /**
   * Handle job failure
   */
  async handleJobFailure(job, error) {
    job.failedReason = error.message;
    this.activeJobs.delete(job.id);

    // Check if we should retry
    if (job.attemptsMade < job.opts.attempts) {
      // Calculate retry delay
      let delay = this.options.retryDelay;
      if (job.opts.backoff === 'exponential') {
        delay = this.options.retryDelay * Math.pow(2, job.attemptsMade - 1);
      }

      // Add back to queue with delay
      job.opts.delay = delay;
      job.delayedUntil = Date.now() + delay;
      this.delayedJobs.push(job);
      this.scheduleDelayedJob(job);

      this.metrics.retried++;
      this.emit('job-retry', job, job.attemptsMade);
      this.logger.warn(`Job ${job.id} retry ${job.attemptsMade}/${job.opts.attempts} in ${delay}ms`);

    } else {
      // Max attempts reached, mark as failed
      job.finishedOn = Date.now();
      this.failedJobs.push(job);
      this.metrics.failed++;

      // Limit failed jobs storage
      if (this.failedJobs.length > job.opts.removeOnFail) {
        this.failedJobs.splice(0, this.failedJobs.length - job.opts.removeOnFail);
      }

      this.emit('job-failed', job, error);
      this.logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts`, error);
    }
  }

  /**
   * Schedule delayed job
   */
  scheduleDelayedJob(job) {
    const delay = job.delayedUntil - Date.now();
    if (delay > 0) {
      setTimeout(() => {
        this.processDelayedJob(job);
      }, delay);
    } else {
      this.processDelayedJob(job);
    }
  }

  /**
   * Process a delayed job (move to main queue)
   */
  processDelayedJob(job) {
    const index = this.delayedJobs.findIndex(j => j.id === job.id);
    if (index !== -1) {
      this.delayedJobs.splice(index, 1);
      this.addToQueue(job);
    }
  }

  /**
   * Process all delayed jobs that are ready
   */
  processDelayedJobs() {
    const now = Date.now();
    const readyJobs = this.delayedJobs.filter(job => job.delayedUntil <= now);
    
    for (const job of readyJobs) {
      this.processDelayedJob(job);
    }
  }

  /**
   * Start processing loop
   */
  startProcessing() {
    if (!this.isProcessing && !this.isPausedState) {
      this.isProcessing = true;
      this.processingPromise = this.processLoop();
    }
  }

  /**
   * Main processing loop
   */
  async processLoop() {
    while (this.isProcessing && !this.isPausedState) {
      try {
        // Process delayed jobs
        this.processDelayedJobs();
        
        // Brief pause
        await this.sleep(10);
        
      } catch (error) {
        this.logger.error('Error in processing loop', error);
        await this.sleep(1000);
      }
    }
  }

  /**
   * Pause queue processing
   */
  async pause() {
    this.isPausedState = true;
    this.logger.info(`Paused queue: ${this.name}`);
  }

  /**
   * Resume queue processing
   */
  async resume() {
    this.isPausedState = false;
    this.startProcessing();
    this.logger.info(`Resumed queue: ${this.name}`);
  }

  /**
   * Check if queue is paused
   */
  async isPaused() {
    return this.isPausedState;
  }

  /**
   * Empty the queue
   */
  async empty() {
    this.jobs.length = 0;
    this.delayedJobs.length = 0;
    this.logger.info(`Emptied queue: ${this.name}`);
  }

  /**
   * Get waiting jobs count
   */
  async getWaiting() {
    return this.jobs.length;
  }

  /**
   * Get active jobs count
   */
  async getActive() {
    return this.activeJobs.size;
  }

  /**
   * Get completed jobs count
   */
  async getCompleted() {
    return this.completedJobs.length;
  }

  /**
   * Get failed jobs count
   */
  async getFailed() {
    return this.failedJobs.length;
  }

  /**
   * Get delayed jobs count
   */
  async getDelayed() {
    return this.delayedJobs.length;
  }

  /**
   * Get queue health status
   */
  async getHealth() {
    const memoryUsage = this.estimateMemoryUsage();
    
    return {
      status: 'healthy',
      name: this.name,
      type: 'memory',
      waiting: await this.getWaiting(),
      active: await this.getActive(),
      completed: await this.getCompleted(),
      failed: await this.getFailed(),
      delayed: await this.getDelayed(),
      memoryUsage: memoryUsage,
      metrics: this.metrics,
      isPaused: this.isPausedState
    };
  }

  /**
   * Estimate memory usage
   */
  estimateMemoryUsage() {
    // Rough estimation
    const totalJobs = this.jobs.length + this.activeJobs.size + 
                     this.completedJobs.length + this.failedJobs.length + 
                     this.delayedJobs.length;
    
    return {
      totalJobs,
      estimatedBytes: totalJobs * 1024 // Rough estimate
    };
  }

  /**
   * Utility sleep function
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close the queue
   */
  async close() {
    this.isProcessing = false;
    this.isPausedState = true;

    // Wait for current processing to finish
    if (this.processingPromise) {
      await this.processingPromise;
    }

    // Clear all jobs
    this.jobs.length = 0;
    this.activeJobs.clear();
    this.completedJobs.length = 0;
    this.failedJobs.length = 0;
    this.delayedJobs.length = 0;

    this.logger.info(`Closed in-memory queue: ${this.name}`);
  }
}