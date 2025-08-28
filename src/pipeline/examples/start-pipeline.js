#!/usr/bin/env node
// src/pipeline/examples/start-pipeline.js

import { PipelineService } from '../PipelineService.js';
import { Logger } from '../monitoring/Logger.js';

/**
 * Example script to start the data ingestion pipeline
 * This demonstrates how to integrate with CC Trading Terminal
 */
async function main() {
  const logger = new Logger('PipelineExample');
  
  try {
    logger.info('Starting CC Trading Terminal Data Pipeline...');

    // Initialize pipeline service
    const pipeline = new PipelineService({
      enableHistoricalData: true,
      enableRealTimeData: true,
      enableDataEnrichment: true,
      autoStart: true,
      pipelineConfig: {
        // Queue configuration
        queueType: 'memory', // Use 'persistent' for production
        maxConcurrency: 10,
        
        // Data source configuration
        dataSources: [
          {
            id: 'cc-trading-terminal-main',
            type: 'cc-trading-terminal',
            enabled: true,
            config: {
              enabledFeeds: ['tokens', 'pools', 'trending', 'portfolio'],
              networks: ['eth-mainnet', 'base-mainnet'],
              pollingInterval: 10000 // 10 seconds for demo
            }
          },
          {
            id: 'binance-btcusdt',
            type: 'crypto-generic',
            enabled: true,
            config: {
              exchange: 'binance',
              subscriptions: ['ticker'],
              reconnectDelay: 5000
            }
          }
        ]
      }
    });

    // Set up event handlers
    pipeline.on('data', (data) => {
      logger.info('Received processed data', {
        type: data.dataType,
        source: data.sourceId,
        timestamp: new Date(data.transformedTimestamp).toISOString()
      });

      // Example: Log specific data types
      if (data.dataType === 'token') {
        logger.info('Token data received', {
          symbol: data.data.symbol,
          price: data.data.price,
          network: data.data.network
        });
      }

      if (data.dataType === 'pool') {
        logger.info('Pool data received', {
          address: data.data.address,
          dex: data.data.dex,
          volume24h: data.data.volume24h
        });
      }
    });

    pipeline.on('source-connected', (event) => {
      logger.info(`Data source connected: ${event.sourceId}`);
    });

    pipeline.on('source-disconnected', (event) => {
      logger.warn(`Data source disconnected: ${event.sourceId}`);
    });

    pipeline.on('source-error', (event) => {
      logger.error(`Data source error: ${event.sourceId}`, event.error);
    });

    pipeline.on('backfill-completed', (job) => {
      logger.info(`Backfill completed: ${job.id}`, {
        dataType: job.dataType,
        progress: job.progress
      });
    });

    // Initialize and start
    await pipeline.initialize();
    
    logger.info('Pipeline initialized successfully');

    // Example: Subscribe to specific data types
    await pipeline.subscribe([
      {
        sourceId: 'cc-trading-terminal-main',
        dataType: 'tokens',
        params: { networks: ['eth-mainnet'] }
      }
    ]);

    // Example: Start backfill for historical data
    if (process.argv.includes('--backfill')) {
      logger.info('Starting historical data backfill...');
      
      const backfillJob = await pipeline.startBackfill('tokens', {
        source: 'cc-trading-terminal',
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        endDate: new Date(),
        interval: 'hour',
        priority: 'normal'
      });

      logger.info(`Backfill job started: ${backfillJob.id}`);
    }

    // Health monitoring
    setInterval(async () => {
      try {
        const health = await pipeline.getHealth();
        const stats = await pipeline.getStatistics();
        
        logger.info('Pipeline Health Check', {
          service: health.service.status,
          pipeline: health.pipeline?.status,
          dataSources: health.dataSources?.summary,
          uptime: Math.round(stats.service.uptime / 1000) + 's'
        });

      } catch (error) {
        logger.error('Health check failed', error);
      }
    }, 30000); // Every 30 seconds

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down pipeline...');
      
      try {
        await pipeline.shutdown();
        logger.info('Pipeline shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
      }
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down...');
      await pipeline.shutdown();
      process.exit(0);
    });

    logger.info('Pipeline is running. Press Ctrl+C to stop.');
    logger.info('Use --backfill flag to start historical data backfill');
    
  } catch (error) {
    logger.error('Failed to start pipeline', error);
    process.exit(1);
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}