// src/pipeline/queue/PersistentQueue.js
import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';
import { Logger } from '../monitoring/Logger.js';

/**
 * Persistent queue implementation using file system storage
 * Provides durability for critical jobs that must survive restarts
 */
export class PersistentQueue extends EventEmitter {
  constructor(name, options = {}) {
    super();
    
    this.name = name;
    this.logger = new Logger(`PersistentQueue:${name}`);
    this.options = {
      dataDir: './queue-data',
      maxSize: 50000,
      retryAttempts: 3,
      retryDelay: 1000,
      concurrency: 1,
      syncInterval: 1000,
      compactionThreshold: 1000,
      ...options
    };

    // File paths
    this.queueDir = path.join(this.options.dataDir, this.name);
    this.jobsFile = path.join(this.queueDir, 'jobs.jsonl');
    this.metaFile = path.join(this.queueDir, 'meta.json');
    this.lockFile = path.join(this.queueDir, 'queue.lock');

    // In-memory cache for performance
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
    this.lastSync = 0;

    // Metrics
    this.metrics = {
      added: 0,
      processed: 0,
      failed: 0,
      retried: 0,
      synced: 0
    };
  }

  /**
   * Initialize the persistent queue
   */
  async initialize() {
    try {
      // Create queue directory
      await this.ensureDirectory();
      
      // Load existing data
      await this.loadFromDisk();
      
      // Start periodic sync
      this.startPeriodicSync();

      this.logger.info(`Initialized persistent queue: ${this.name}`);
    } catch (error) {
      this.logger.error(`Failed to initialize persistent queue: ${this.name}`, error);
      throw error;
    }
  }

  /**
   * Ensure queue directory exists
   */
  async ensureDirectory() {
    try {
      await fs.mkdir(this.queueDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Load queue data from disk
   */
  async loadFromDisk() {
    try {
      // Load metadata
      await this.loadMetadata();
      
      // Load jobs
      await this.loadJobs();

      this.logger.info(`Loaded ${this.jobs.length} jobs from disk`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Files don't exist yet, start fresh
        this.logger.info('No existing queue data found, starting fresh');
      } else {
        throw error;
      }
    }
  }

  /**
   * Load metadata from disk
   */
  async loadMetadata() {
    try {
      const metaData = await fs.readFile(this.metaFile, 'utf8');
      const meta = JSON.parse(metaData);
      
      this.jobIdCounter = meta.jobIdCounter || 0;
      this.metrics = { ...this.metrics, ...meta.metrics };
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.warn('Failed to load metadata', error);
      }
    }
  }

  /**
   * Load jobs from disk
   */
  async loadJobs() {
    try {
      const jobsData = await fs.readFile(this.jobsFile, 'utf8');
      const lines = jobsData.trim().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const job = JSON.parse(line);
          
          // Categorize jobs based on status
          switch (job.status) {
            case 'waiting':
              if (job.delayedUntil && job.delayedUntil > Date.now()) {
                this.delayedJobs.push(job);
              } else {
                this.jobs.push(job);
              }
              break;
            case 'active':
              // Reset active jobs to waiting on startup
              job.status = 'waiting';
              this.jobs.push(job);
              break;
            case 'completed':
              this.completedJobs.push(job);
              break;
            case 'failed':
              this.failedJobs.push(job);
              break;
          }
        } catch (parseError) {
          this.logger.warn('Failed to parse job line', parseError);
        }
      }

      // Sort jobs by priority
      this.jobs.sort((a, b) => (b.opts?.priority || 0) - (a.opts?.priority || 0));
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
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
      status: 'waiting',
      attemptsMade: 0,
      processedOn: null,
      finishedOn: null,
      failedReason: null,
      createdAt: Date.now()
    };

    if (job.opts.delay > 0) {
      // Add to delayed jobs
      job.delayedUntil = Date.now() + job.opts.delay;
      job.status = 'delayed';
      this.delayedJobs.push(job);
      this.scheduleDelayedJob(job);
    } else {
      // Add to main queue
      this.addToQueue(job);
    }

    this.metrics.added++;
    
    // Persist to disk
    await this.persistJob(job);
    
    this.logger.debug(`Added job ${job.id} to persistent queue`);
    
    // Start processing if not already running
    this.startProcessing();

    return job;
  }

  /**
   * Add multiple jobs in bulk
   */
  async addBulk(jobsData) {
    const jobs = [];
    
    // Prepare all jobs
    for (const jobData of jobsData) {
      if (this.jobs.length + jobs.length >= this.options.maxSize) {
        throw new Error(`Queue ${this.name} would exceed max size`);
      }

      const job = {
        id: `${this.name}-${++this.jobIdCounter}`,
        data: jobData.data,
        opts: {
          priority: 0,
          delay: 0,
          attempts: this.options.retryAttempts,
          backoff: 'exponential',
          removeOnComplete: 10,
          removeOnFail: 5,
          ...jobData.opts
        },
        status: 'waiting',
        attemptsMade: 0,
        processedOn: null,
        finishedOn: null,
        failedReason: null,
        createdAt: Date.now()
      };

      jobs.push(job);
      
      if (job.opts.delay > 0) {
        job.delayedUntil = Date.now() + job.opts.delay;
        job.status = 'delayed';
        this.delayedJobs.push(job);
        this.scheduleDelayedJob(job);
      } else {
        this.addToQueue(job);
      }
    }

    this.metrics.added += jobs.length;
    
    // Persist all jobs
    await this.persistJobs(jobs);
    
    this.logger.info(`Added ${jobs.length} jobs to persistent queue in bulk`);
    
    return jobs;
  }

  /**
   * Add job to in-memory queue with priority sorting
   */
  addToQueue(job) {
    let inserted = false;
    for (let i = 0; i < this.jobs.length; i++) {
      if ((job.opts?.priority || 0) > (this.jobs[i].opts?.priority || 0)) {
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
   * Persist single job to disk
   */
  async persistJob(job) {
    try {
      const jobLine = JSON.stringify(job) + '\n';
      await fs.appendFile(this.jobsFile, jobLine);
    } catch (error) {
      this.logger.error('Failed to persist job', error);
    }
  }

  /**
   * Persist multiple jobs to disk
   */
  async persistJobs(jobs) {
    try {
      const jobLines = jobs.map(job => JSON.stringify(job)).join('\n') + '\n';
      await fs.appendFile(this.jobsFile, jobLines);
    } catch (error) {
      this.logger.error('Failed to persist jobs', error);
    }
  }

  /**
   * Update job status on disk
   */
  async updateJobStatus(job, status) {
    job.status = status;
    // For simplicity, we append the updated job
    // Compaction will clean up duplicates
    await this.persistJob(job);
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
        
        await this.sleep(1000);
      }
    }
  }

  /**
   * Get next job from queue
   */
  async getNextJob() {
    this.processDelayedJobs();

    if (this.jobs.length === 0) {
      return null;
    }

    const job = this.jobs.shift();
    job.processedOn = Date.now();
    job.attemptsMade++;
    job.status = 'active';

    this.activeJobs.set(job.id, job);
    
    // Update on disk
    await this.updateJobStatus(job, 'active');
    
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
      job.status = 'completed';

      this.activeJobs.delete(job.id);
      this.completedJobs.push(job);
      this.metrics.processed++;

      // Limit completed jobs storage
      if (this.completedJobs.length > job.opts.removeOnComplete) {
        this.completedJobs.splice(0, this.completedJobs.length - job.opts.removeOnComplete);
      }

      await this.updateJobStatus(job, 'completed');
      
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

    if (job.attemptsMade < job.opts.attempts) {
      // Calculate retry delay
      let delay = this.options.retryDelay;
      if (job.opts.backoff === 'exponential') {
        delay = this.options.retryDelay * Math.pow(2, job.attemptsMade - 1);
      }

      // Add back to queue with delay
      job.opts.delay = delay;
      job.delayedUntil = Date.now() + delay;
      job.status = 'delayed';
      this.delayedJobs.push(job);
      this.scheduleDelayedJob(job);

      await this.updateJobStatus(job, 'delayed');

      this.metrics.retried++;
      this.emit('job-retry', job, job.attemptsMade);
      this.logger.warn(`Job ${job.id} retry ${job.attemptsMade}/${job.opts.attempts} in ${delay}ms`);

    } else {
      // Max attempts reached, mark as failed
      job.finishedOn = Date.now();
      job.status = 'failed';
      this.failedJobs.push(job);
      this.metrics.failed++;

      // Limit failed jobs storage
      if (this.failedJobs.length > job.opts.removeOnFail) {
        this.failedJobs.splice(0, this.failedJobs.length - job.opts.removeOnFail);
      }

      await this.updateJobStatus(job, 'failed');

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
      job.status = 'waiting';
      this.addToQueue(job);
      this.updateJobStatus(job, 'waiting').catch(error => {
        this.logger.error('Failed to update delayed job status', error);
      });
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
    }
  }

  /**
   * Start periodic sync to disk
   */
  startPeriodicSync() {
    this.syncInterval = setInterval(async () => {
      try {
        await this.syncToDisk();
      } catch (error) {
        this.logger.error('Periodic sync failed', error);
      }
    }, this.options.syncInterval);
  }

  /**
   * Sync metadata to disk
   */
  async syncToDisk() {
    try {
      const metadata = {
        jobIdCounter: this.jobIdCounter,
        metrics: this.metrics,
        lastSync: Date.now()
      };

      await fs.writeFile(this.metaFile, JSON.stringify(metadata, null, 2));
      this.metrics.synced++;
      this.lastSync = Date.now();

      // Trigger compaction if needed
      if (this.metrics.added % this.options.compactionThreshold === 0) {
        await this.compactJobsFile();
      }

    } catch (error) {
      this.logger.error('Failed to sync to disk', error);
    }
  }

  /**
   * Compact jobs file to remove duplicates and completed/failed jobs
   */
  async compactJobsFile() {
    try {
      const tempFile = this.jobsFile + '.tmp';
      const allJobs = [
        ...this.jobs,
        ...Array.from(this.activeJobs.values()),
        ...this.delayedJobs,
        ...this.completedJobs.slice(-this.options.removeOnComplete || 10),
        ...this.failedJobs.slice(-this.options.removeOnFail || 5)
      ];

      const jobLines = allJobs.map(job => JSON.stringify(job)).join('\n') + '\n';
      await fs.writeFile(tempFile, jobLines);
      
      // Atomic replace
      await fs.rename(tempFile, this.jobsFile);
      
      this.logger.info(`Compacted jobs file, kept ${allJobs.length} jobs`);

    } catch (error) {
      this.logger.error('Failed to compact jobs file', error);
    }
  }

  /**
   * Queue management methods (same as InMemoryQueue)
   */
  async pause() {
    this.isPausedState = true;
    this.logger.info(`Paused persistent queue: ${this.name}`);
  }

  async resume() {
    this.isPausedState = false;
    this.startProcessing();
    this.logger.info(`Resumed persistent queue: ${this.name}`);
  }

  async isPaused() {
    return this.isPausedState;
  }

  async empty() {
    this.jobs.length = 0;
    this.delayedJobs.length = 0;
    this.activeJobs.clear();
    
    // Clear files
    try {
      await fs.writeFile(this.jobsFile, '');
    } catch (error) {
      this.logger.error('Failed to clear jobs file', error);
    }
    
    this.logger.info(`Emptied persistent queue: ${this.name}`);
  }

  async getWaiting() {
    return this.jobs.length;
  }

  async getActive() {
    return this.activeJobs.size;
  }

  async getCompleted() {
    return this.completedJobs.length;
  }

  async getFailed() {
    return this.failedJobs.length;
  }

  async getDelayed() {
    return this.delayedJobs.length;
  }

  async getHealth() {
    const diskUsage = await this.getDiskUsage();
    
    return {
      status: 'healthy',
      name: this.name,
      type: 'persistent',
      waiting: await this.getWaiting(),
      active: await this.getActive(),
      completed: await this.getCompleted(),
      failed: await this.getFailed(),
      delayed: await this.getDelayed(),
      diskUsage: diskUsage,
      metrics: this.metrics,
      lastSync: this.lastSync,
      isPaused: this.isPausedState
    };
  }

  async getDiskUsage() {
    try {
      const [jobsStats, metaStats] = await Promise.all([
        fs.stat(this.jobsFile).catch(() => ({ size: 0 })),
        fs.stat(this.metaFile).catch(() => ({ size: 0 }))
      ]);

      return {
        jobsFile: jobsStats.size,
        metaFile: metaStats.size,
        total: jobsStats.size + metaStats.size
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close() {
    this.isProcessing = false;
    this.isPausedState = true;

    // Clear sync interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Final sync
    await this.syncToDisk();

    this.logger.info(`Closed persistent queue: ${this.name}`);
  }
}