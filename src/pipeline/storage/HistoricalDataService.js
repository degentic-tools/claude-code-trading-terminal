// src/pipeline/storage/HistoricalDataService.js
import EventEmitter from 'events';
import fs from 'fs/promises';
import path from 'path';
import { Logger } from '../monitoring/Logger.js';

/**
 * Historical data backfill service for market data
 * Handles data persistence and backfill operations
 */
export class HistoricalDataService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('HistoricalDataService');
    this.options = {
      dataDir: './historical-data',
      retentionPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
      batchSize: 1000,
      compressionEnabled: true,
      indexingEnabled: true,
      backfillConcurrency: 5,
      maxRetries: 3,
      ...options
    };

    // Storage management
    this.storageStats = {
      totalRecords: 0,
      totalSize: 0,
      oldestRecord: null,
      newestRecord: null,
      dataTypes: {}
    };

    this.backfillQueue = [];
    this.isProcessingBackfill = false;
    this.activeBackfillJobs = new Set();
  }

  /**
   * Initialize the historical data service
   */
  async initialize() {
    try {
      // Ensure data directory exists
      await this.ensureDataDirectory();
      
      // Load existing data stats
      await this.loadStorageStats();
      
      // Start maintenance tasks
      this.startMaintenanceTasks();

      this.logger.info('HistoricalDataService initialized');
    } catch (error) {
      this.logger.error('Failed to initialize HistoricalDataService', error);
      throw error;
    }
  }

  /**
   * Ensure data directory structure exists
   */
  async ensureDataDirectory() {
    const directories = [
      this.options.dataDir,
      path.join(this.options.dataDir, 'raw'),
      path.join(this.options.dataDir, 'processed'),
      path.join(this.options.dataDir, 'indices'),
      path.join(this.options.dataDir, 'backups')
    ];

    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Store historical data point
   */
  async storeData(dataType, data, metadata = {}) {
    try {
      const timestamp = data.timestamp || Date.now();
      const dateKey = this.getDateKey(timestamp);
      
      const record = {
        timestamp,
        dataType,
        data,
        metadata,
        id: this.generateRecordId(dataType, timestamp)
      };

      // Determine storage path
      const filePath = this.getStoragePath(dataType, dateKey);
      
      // Store the record
      await this.appendToFile(filePath, record);
      
      // Update statistics
      this.updateStorageStats(dataType, record);
      
      // Update index if enabled
      if (this.options.indexingEnabled) {
        await this.updateIndex(dataType, record);
      }

      this.logger.debug(`Stored ${dataType} data point`, { id: record.id, timestamp });
      
      return record.id;

    } catch (error) {
      this.logger.error(`Failed to store ${dataType} data`, error);
      throw error;
    }
  }

  /**
   * Store batch of historical data
   */
  async storeBatch(dataType, dataArray, metadata = {}) {
    try {
      const records = dataArray.map(data => ({
        timestamp: data.timestamp || Date.now(),
        dataType,
        data,
        metadata,
        id: this.generateRecordId(dataType, data.timestamp || Date.now())
      }));

      // Group by date for efficient storage
      const recordsByDate = this.groupRecordsByDate(records);
      
      const storedIds = [];
      
      for (const [dateKey, dateRecords] of recordsByDate.entries()) {
        const filePath = this.getStoragePath(dataType, dateKey);
        
        // Batch append to file
        await this.appendBatchToFile(filePath, dateRecords);
        
        // Update statistics
        for (const record of dateRecords) {
          this.updateStorageStats(dataType, record);
          storedIds.push(record.id);
        }
      }

      this.logger.info(`Stored ${records.length} ${dataType} records in batch`);
      
      return storedIds;

    } catch (error) {
      this.logger.error(`Failed to store ${dataType} batch`, error);
      throw error;
    }
  }

  /**
   * Retrieve historical data
   */
  async retrieveData(dataType, options = {}) {
    try {
      const {
        startTime,
        endTime,
        limit = 1000,
        offset = 0,
        sortOrder = 'desc'
      } = options;

      const results = [];
      
      // Determine date range for file scanning
      const dateRange = this.getDateRange(startTime, endTime);
      
      for (const dateKey of dateRange) {
        const filePath = this.getStoragePath(dataType, dateKey);
        
        try {
          const dayData = await this.readDataFile(filePath);
          
          // Filter by time range
          const filteredData = this.filterByTimeRange(dayData, startTime, endTime);
          results.push(...filteredData);
          
        } catch (error) {
          if (error.code !== 'ENOENT') {
            this.logger.error(`Error reading ${filePath}`, error);
          }
        }
      }

      // Sort results
      results.sort((a, b) => {
        return sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
      });

      // Apply pagination
      const paginatedResults = results.slice(offset, offset + limit);
      
      return {
        data: paginatedResults,
        total: results.length,
        offset,
        limit,
        hasMore: offset + limit < results.length
      };

    } catch (error) {
      this.logger.error(`Failed to retrieve ${dataType} data`, error);
      throw error;
    }
  }

  /**
   * Backfill historical data from external source
   */
  async backfillData(dataType, backfillConfig) {
    const {
      source,
      startDate,
      endDate,
      interval = 'day',
      priority = 'normal'
    } = backfillConfig;

    try {
      const backfillJob = {
        id: this.generateJobId(),
        dataType,
        source,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        interval,
        priority,
        status: 'pending',
        createdAt: Date.now(),
        progress: 0
      };

      this.backfillQueue.push(backfillJob);
      
      // Sort by priority
      this.backfillQueue.sort((a, b) => this.getPriorityWeight(b.priority) - this.getPriorityWeight(a.priority));
      
      // Start processing if not already running
      if (!this.isProcessingBackfill) {
        this.processBackfillQueue();
      }

      this.logger.info(`Queued backfill job: ${backfillJob.id}`, { dataType, source });
      
      return backfillJob;

    } catch (error) {
      this.logger.error('Failed to queue backfill job', error);
      throw error;
    }
  }

  /**
   * Process backfill queue
   */
  async processBackfillQueue() {
    if (this.isProcessingBackfill) return;
    
    this.isProcessingBackfill = true;

    while (this.backfillQueue.length > 0 && this.activeBackfillJobs.size < this.options.backfillConcurrency) {
      const job = this.backfillQueue.shift();
      
      if (job) {
        this.activeBackfillJobs.add(job.id);
        this.executeBackfillJob(job).finally(() => {
          this.activeBackfillJobs.delete(job.id);
        });
      }
    }

    // Check if we should continue processing
    if (this.backfillQueue.length > 0) {
      setTimeout(() => this.processBackfillQueue(), 1000);
    } else {
      this.isProcessingBackfill = false;
    }
  }

  /**
   * Execute individual backfill job
   */
  async executeBackfillJob(job) {
    try {
      job.status = 'running';
      job.startedAt = Date.now();

      this.logger.info(`Starting backfill job: ${job.id}`, { 
        dataType: job.dataType, 
        dateRange: `${job.startDate.toISOString()} to ${job.endDate.toISOString()}` 
      });

      // Generate time intervals for backfill
      const intervals = this.generateTimeIntervals(job.startDate, job.endDate, job.interval);
      const totalIntervals = intervals.length;
      let processedIntervals = 0;

      for (const interval of intervals) {
        let retryCount = 0;
        let success = false;

        while (!success && retryCount < this.options.maxRetries) {
          try {
            // Fetch data for this interval
            const data = await this.fetchHistoricalData(job.source, job.dataType, interval);
            
            if (data && data.length > 0) {
              // Store the fetched data
              await this.storeBatch(job.dataType, data, {
                source: job.source,
                backfillJob: job.id,
                interval: interval
              });
            }

            success = true;
            processedIntervals++;
            job.progress = (processedIntervals / totalIntervals) * 100;

            // Emit progress update
            this.emit('backfill-progress', {
              jobId: job.id,
              progress: job.progress,
              processedIntervals,
              totalIntervals
            });

          } catch (error) {
            retryCount++;
            this.logger.warn(`Backfill retry ${retryCount}/${this.options.maxRetries} for job ${job.id}`, error);
            
            if (retryCount < this.options.maxRetries) {
              await this.sleep(1000 * retryCount); // Exponential backoff
            }
          }
        }

        if (!success) {
          throw new Error(`Failed to backfill interval ${interval.start} - ${interval.end} after ${this.options.maxRetries} retries`);
        }

        // Rate limiting
        await this.sleep(100); // Brief pause between intervals
      }

      job.status = 'completed';
      job.completedAt = Date.now();
      job.progress = 100;

      this.logger.info(`Backfill job completed: ${job.id}`, {
        duration: job.completedAt - job.startedAt,
        intervals: totalIntervals
      });

      this.emit('backfill-completed', job);

    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.failedAt = Date.now();

      this.logger.error(`Backfill job failed: ${job.id}`, error);
      this.emit('backfill-failed', { job, error });
    }
  }

  /**
   * Fetch historical data from external source
   */
  async fetchHistoricalData(source, dataType, interval) {
    // This would integrate with external APIs
    // Implementation depends on the specific data source
    
    this.logger.debug(`Fetching ${dataType} data from ${source}`, interval);
    
    // Mock implementation - replace with actual API calls
    await this.sleep(500); // Simulate API delay
    
    return []; // Return actual data from source
  }

  /**
   * Generate time intervals for backfill
   */
  generateTimeIntervals(startDate, endDate, interval) {
    const intervals = [];
    const intervalMs = this.getIntervalMs(interval);
    
    let current = new Date(startDate);
    
    while (current < endDate) {
      const next = new Date(current.getTime() + intervalMs);
      intervals.push({
        start: new Date(current),
        end: new Date(Math.min(next.getTime(), endDate.getTime()))
      });
      current = next;
    }

    return intervals;
  }

  /**
   * Get interval in milliseconds
   */
  getIntervalMs(interval) {
    const intervals = {
      'minute': 60 * 1000,
      'hour': 60 * 60 * 1000,
      'day': 24 * 60 * 60 * 1000,
      'week': 7 * 24 * 60 * 60 * 1000
    };

    return intervals[interval] || intervals['day'];
  }

  /**
   * Helper methods
   */
  
  getDateKey(timestamp) {
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  getStoragePath(dataType, dateKey) {
    return path.join(this.options.dataDir, 'raw', `${dataType}_${dateKey}.jsonl`);
  }

  generateRecordId(dataType, timestamp) {
    return `${dataType}_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateJobId() {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getPriorityWeight(priority) {
    const weights = { low: 1, normal: 2, high: 3, critical: 4 };
    return weights[priority] || weights.normal;
  }

  async appendToFile(filePath, record) {
    const line = JSON.stringify(record) + '\n';
    await fs.appendFile(filePath, line);
  }

  async appendBatchToFile(filePath, records) {
    const lines = records.map(record => JSON.stringify(record)).join('\n') + '\n';
    await fs.appendFile(filePath, lines);
  }

  async readDataFile(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    return content.trim().split('\n').map(line => JSON.parse(line));
  }

  groupRecordsByDate(records) {
    const grouped = new Map();
    
    for (const record of records) {
      const dateKey = this.getDateKey(record.timestamp);
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey).push(record);
    }

    return grouped;
  }

  getDateRange(startTime, endTime) {
    const dates = [];
    const start = new Date(startTime || 0);
    const end = new Date(endTime || Date.now());
    
    let current = new Date(start);
    current.setHours(0, 0, 0, 0);
    
    while (current <= end) {
      dates.push(this.getDateKey(current.getTime()));
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  filterByTimeRange(data, startTime, endTime) {
    return data.filter(record => {
      if (startTime && record.timestamp < startTime) return false;
      if (endTime && record.timestamp > endTime) return false;
      return true;
    });
  }

  updateStorageStats(dataType, record) {
    this.storageStats.totalRecords++;
    
    if (!this.storageStats.dataTypes[dataType]) {
      this.storageStats.dataTypes[dataType] = 0;
    }
    this.storageStats.dataTypes[dataType]++;

    if (!this.storageStats.oldestRecord || record.timestamp < this.storageStats.oldestRecord) {
      this.storageStats.oldestRecord = record.timestamp;
    }

    if (!this.storageStats.newestRecord || record.timestamp > this.storageStats.newestRecord) {
      this.storageStats.newestRecord = record.timestamp;
    }
  }

  async loadStorageStats() {
    // Load statistics from storage - implementation depends on needs
    this.storageStats = {
      totalRecords: 0,
      totalSize: 0,
      oldestRecord: null,
      newestRecord: null,
      dataTypes: {}
    };
  }

  startMaintenanceTasks() {
    // Cleanup old data
    setInterval(async () => {
      try {
        await this.cleanupOldData();
      } catch (error) {
        this.logger.error('Cleanup task failed', error);
      }
    }, 24 * 60 * 60 * 1000); // Daily

    // Update storage statistics
    setInterval(async () => {
      try {
        await this.updateStorageStatistics();
      } catch (error) {
        this.logger.error('Stats update failed', error);
      }
    }, 60 * 60 * 1000); // Hourly
  }

  async cleanupOldData() {
    const cutoffTime = Date.now() - this.options.retentionPeriod;
    const cutoffDate = this.getDateKey(cutoffTime);
    
    // Implementation would remove old files
    this.logger.info(`Cleaning up data older than ${cutoffDate}`);
  }

  async updateStorageStatistics() {
    // Update storage statistics
    this.logger.debug('Updating storage statistics');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async updateIndex(dataType, record) {
    // Index implementation for faster queries
  }

  /**
   * Get service health status
   */
  async getHealth() {
    return {
      status: 'healthy',
      storageStats: this.storageStats,
      backfillQueue: this.backfillQueue.length,
      activeJobs: this.activeBackfillJobs.size,
      isProcessingBackfill: this.isProcessingBackfill
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown() {
    // Wait for active backfill jobs to complete
    while (this.activeBackfillJobs.size > 0) {
      await this.sleep(100);
    }

    this.logger.info('HistoricalDataService shutdown completed');
  }
}