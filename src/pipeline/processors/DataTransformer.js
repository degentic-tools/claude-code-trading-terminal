// src/pipeline/processors/DataTransformer.js
import EventEmitter from 'events';
import { Logger } from '../monitoring/Logger.js';

/**
 * Data transformation service for normalizing market data formats
 * Converts various exchange formats to standardized schemas
 */
export class DataTransformer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('DataTransformer');
    this.options = {
      enableCaching: true,
      maxCacheSize: 1000,
      defaultTimezone: 'UTC',
      ...options
    };

    // Transformation rules and cache
    this.transformations = new Map();
    this.transformCache = new Map();
    
    this.setupDefaultTransformations();
  }

  /**
   * Initialize the transformer
   */
  async initialize() {
    this.logger.info('DataTransformer initialized');
  }

  /**
   * Setup default transformation rules
   */
  setupDefaultTransformations() {
    // Price data transformations
    this.addTransformation('price', {
      normalizeSymbol: (data) => {
        if (data.symbol) {
          data.symbol = this.normalizeSymbol(data.symbol);
        }
        return data;
      },
      convertTimestamp: (data) => {
        data.timestamp = this.normalizeTimestamp(data.timestamp || data.time || Date.now());
        return data;
      },
      calculateSpread: (data) => {
        if (data.bid && data.ask) {
          data.spread = data.ask - data.bid;
          data.spreadPercent = ((data.ask - data.bid) / data.bid) * 100;
        }
        return data;
      }
    });

    // OHLCV transformations
    this.addTransformation('ohlcv', {
      normalizeSymbol: (data) => {
        if (data.symbol || data.pair) {
          data.symbol = this.normalizeSymbol(data.symbol || data.pair);
        }
        return data;
      },
      convertTimestamp: (data) => {
        data.timestamp = this.normalizeTimestamp(
          data.timestamp || data.time || data.openTime || Date.now()
        );
        return data;
      },
      validateOHLC: (data) => {
        // Ensure OHLC consistency
        if (data.high < Math.max(data.open, data.close)) {
          data.high = Math.max(data.open, data.close, data.high);
        }
        if (data.low > Math.min(data.open, data.close)) {
          data.low = Math.min(data.open, data.close, data.low);
        }
        
        // Calculate additional metrics
        data.change = data.close - data.open;
        data.changePercent = ((data.close - data.open) / data.open) * 100;
        data.priceRange = data.high - data.low;
        
        return data;
      }
    });

    // Order book transformations
    this.addTransformation('orderbook', {
      normalizeSymbol: (data) => {
        if (data.symbol || data.pair) {
          data.symbol = this.normalizeSymbol(data.symbol || data.pair);
        }
        return data;
      },
      convertTimestamp: (data) => {
        data.timestamp = this.normalizeTimestamp(data.timestamp || data.time || Date.now());
        return data;
      },
      sortOrderBook: (data) => {
        // Sort bids descending (highest first)
        if (data.bids) {
          data.bids.sort((a, b) => b[0] - a[0]);
        }
        
        // Sort asks ascending (lowest first)
        if (data.asks) {
          data.asks.sort((a, b) => a[0] - b[0]);
        }
        
        // Calculate spread and depth
        if (data.bids && data.asks && data.bids.length > 0 && data.asks.length > 0) {
          data.spread = data.asks[0][0] - data.bids[0][0];
          data.spreadPercent = (data.spread / data.bids[0][0]) * 100;
          data.bidDepth = data.bids.reduce((sum, [, qty]) => sum + qty, 0);
          data.askDepth = data.asks.reduce((sum, [, qty]) => sum + qty, 0);
        }
        
        return data;
      }
    });

    // Trade transformations
    this.addTransformation('trade', {
      normalizeSymbol: (data) => {
        if (data.symbol || data.pair) {
          data.symbol = this.normalizeSymbol(data.symbol || data.pair);
        }
        return data;
      },
      convertTimestamp: (data) => {
        data.timestamp = this.normalizeTimestamp(data.timestamp || data.time || Date.now());
        return data;
      },
      normalizeSide: (data) => {
        if (data.side) {
          data.side = data.side.toLowerCase();
          // Handle various exchange formats
          if (data.side === 'b' || data.side === 'bid') data.side = 'buy';
          if (data.side === 's' || data.side === 'ask') data.side = 'sell';
        }
        
        // Calculate trade value
        if (data.price && data.quantity) {
          data.value = data.price * data.quantity;
        }
        
        return data;
      }
    });

    // Token data transformations (CC Trading Terminal specific)
    this.addTransformation('token', {
      normalizeAddress: (data) => {
        if (data.address) {
          data.address = data.address.toLowerCase();
        }
        return data;
      },
      convertTimestamp: (data) => {
        data.timestamp = this.normalizeTimestamp(data.timestamp || Date.now());
        return data;
      },
      calculateMarketMetrics: (data) => {
        // Calculate market cap if missing
        if (data.price && data.totalSupply && !data.marketCap) {
          data.marketCap = data.price * data.totalSupply;
        }
        
        // Calculate fully diluted valuation
        if (data.price && data.maxSupply) {
          data.fdv = data.price * data.maxSupply;
        }
        
        // Price change calculations
        if (data.price && data.priceChange24h !== undefined) {
          data.priceChange24hPercent = (data.priceChange24h / (data.price - data.priceChange24h)) * 100;
        }
        
        return data;
      }
    });

    // Pool data transformations
    this.addTransformation('pool', {
      normalizeAddress: (data) => {
        if (data.address) data.address = data.address.toLowerCase();
        if (data.token0?.address) data.token0.address = data.token0.address.toLowerCase();
        if (data.token1?.address) data.token1.address = data.token1.address.toLowerCase();
        return data;
      },
      convertTimestamp: (data) => {
        data.timestamp = this.normalizeTimestamp(data.timestamp || Date.now());
        return data;
      },
      calculatePoolMetrics: (data) => {
        // Calculate token prices based on reserves
        if (data.reserve0 && data.reserve1) {
          data.token0Price = data.reserve1 / data.reserve0;
          data.token1Price = data.reserve0 / data.reserve1;
        }
        
        // Calculate liquidity metrics
        if (data.reserve0 && data.reserve1 && data.token0?.price && data.token1?.price) {
          data.tvlUsd = (data.reserve0 * data.token0.price) + (data.reserve1 * data.token1.price);
        }
        
        // APR calculations
        if (data.fees24h && data.tvlUsd && data.tvlUsd > 0) {
          data.apr = (data.fees24h * 365 / data.tvlUsd) * 100;
        }
        
        return data;
      }
    });
  }

  /**
   * Transform data using registered transformations
   */
  async transform(inputData, schema) {
    try {
      const { sourceId, data, timestamp, messageId } = inputData;
      const dataType = this.detectDataType(inputData);
      
      // Clone data to avoid mutations
      let transformedData = JSON.parse(JSON.stringify(data));
      
      // Apply transformations
      const transformations = this.getTransformation(dataType);
      if (transformations && schema?.transformation) {
        for (const [transformName, shouldApply] of Object.entries(schema.transformation)) {
          if (shouldApply && transformations[transformName]) {
            try {
              transformedData = await this.applyTransformation(
                transformedData, 
                transformations[transformName],
                transformName
              );
            } catch (error) {
              this.logger.error(`Transformation ${transformName} failed`, error);
              this.emit('transformation-error', { transformName, error, data: transformedData });
            }
          }
        }
      }
      
      // Add metadata
      const result = {
        sourceId,
        dataType,
        data: transformedData,
        originalTimestamp: timestamp,
        transformedTimestamp: Date.now(),
        messageId,
        transformations: schema?.transformation || {}
      };

      this.logger.debug(`Transformed ${dataType} data from ${sourceId}`);
      return result;

    } catch (error) {
      this.logger.error('Data transformation failed', error);
      throw error;
    }
  }

  /**
   * Apply individual transformation
   */
  async applyTransformation(data, transformFunc, transformName) {
    try {
      if (typeof transformFunc === 'function') {
        return await transformFunc(data);
      } else {
        this.logger.warn(`Invalid transformation function: ${transformName}`);
        return data;
      }
    } catch (error) {
      this.logger.error(`Error in transformation ${transformName}`, error);
      throw error;
    }
  }

  /**
   * Detect data type from input
   */
  detectDataType(inputData) {
    // Try to extract from source ID first
    if (inputData.sourceId) {
      const sourceId = inputData.sourceId.toLowerCase();
      if (sourceId.includes('ohlcv') || sourceId.includes('candle')) return 'ohlcv';
      if (sourceId.includes('orderbook') || sourceId.includes('depth')) return 'orderbook';
      if (sourceId.includes('trade') || sourceId.includes('ticker')) return 'trade';
      if (sourceId.includes('token')) return 'token';
      if (sourceId.includes('pool')) return 'pool';
    }

    const data = inputData.data;
    if (!data || typeof data !== 'object') return 'unknown';

    // Detect by data structure
    if (data.open !== undefined && data.high !== undefined) return 'ohlcv';
    if (data.bids && data.asks) return 'orderbook';
    if (data.side && data.quantity) return 'trade';
    if (data.address && data.network) {
      if (data.token0 && data.token1) return 'pool';
      return 'token';
    }
    if (data.price && data.symbol) return 'price';

    return 'unknown';
  }

  /**
   * Normalize trading pair symbol
   */
  normalizeSymbol(symbol) {
    if (!symbol) return symbol;
    
    // Convert to uppercase and normalize separators
    let normalized = symbol.toString().toUpperCase();
    
    // Handle common separator formats
    normalized = normalized.replace(/[-_]/g, '/');
    
    // Handle specific exchange formats
    const exchangeFormats = {
      // Binance: BTCUSDT -> BTC/USDT
      /^([A-Z]+)USDT$/: '$1/USDT',
      /^([A-Z]+)BTC$/: '$1/BTC',
      /^([A-Z]+)ETH$/: '$1/ETH',
      /^([A-Z]+)BNB$/: '$1/BNB',
      
      // Other common patterns
      /^([A-Z]+)USD$/: '$1/USD',
      /^([A-Z]+)EUR$/: '$1/EUR'
    };

    for (const [pattern, replacement] of Object.entries(exchangeFormats)) {
      if (pattern.test(normalized)) {
        normalized = normalized.replace(pattern, replacement);
        break;
      }
    }

    // Ensure proper format
    if (!normalized.includes('/') && normalized.length > 3) {
      // Try to split common pairs
      const commonQuotes = ['USDT', 'BTC', 'ETH', 'USD', 'EUR', 'BNB'];
      for (const quote of commonQuotes) {
        if (normalized.endsWith(quote)) {
          const base = normalized.substring(0, normalized.length - quote.length);
          if (base.length >= 2) {
            normalized = `${base}/${quote}`;
            break;
          }
        }
      }
    }

    return normalized;
  }

  /**
   * Normalize timestamp to Unix milliseconds
   */
  normalizeTimestamp(timestamp) {
    if (!timestamp) return Date.now();
    
    // Handle different timestamp formats
    if (typeof timestamp === 'string') {
      const parsed = Date.parse(timestamp);
      return isNaN(parsed) ? Date.now() : parsed;
    }
    
    if (typeof timestamp === 'number') {
      // Convert seconds to milliseconds if needed
      if (timestamp < 1e12) {
        return timestamp * 1000;
      }
      return timestamp;
    }
    
    return Date.now();
  }

  /**
   * Add transformation rules for data type
   */
  addTransformation(dataType, transformations) {
    this.transformations.set(dataType, transformations);
  }

  /**
   * Get transformation rules for data type
   */
  getTransformation(dataType) {
    return this.transformations.get(dataType);
  }

  /**
   * Get transformer health
   */
  async getHealth() {
    return {
      status: 'healthy',
      transformations: this.transformations.size,
      cacheSize: this.transformCache.size
    };
  }

  /**
   * Shutdown transformer
   */
  async shutdown() {
    this.transformations.clear();
    this.transformCache.clear();
    this.logger.info('DataTransformer shutdown');
  }
}