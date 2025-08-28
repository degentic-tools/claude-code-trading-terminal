// src/pipeline/processors/DataValidator.js
import EventEmitter from 'events';
import { Logger } from '../monitoring/Logger.js';

/**
 * Data validation service for ensuring data quality and consistency
 * Implements comprehensive validation rules for different market data types
 */
export class DataValidator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('DataValidator');
    this.options = {
      strictMode: true,
      enableSchemaCache: true,
      maxCacheSize: 1000,
      ...options
    };

    // Validation schemas and cache
    this.schemas = new Map();
    this.schemaCache = new Map();
    this.validationRules = new Map();
    
    this.setupDefaultSchemas();
  }

  /**
   * Initialize the validator
   */
  async initialize() {
    this.logger.info('DataValidator initialized');
  }

  /**
   * Setup default validation schemas for common market data types
   */
  setupDefaultSchemas() {
    // Price data schema
    this.addSchema('price', {
      type: 'object',
      required: ['symbol', 'price', 'timestamp'],
      properties: {
        symbol: { type: 'string', pattern: /^[A-Z0-9]+\/[A-Z0-9]+$/ },
        price: { type: 'number', minimum: 0 },
        timestamp: { type: 'number', minimum: 0 },
        volume: { type: 'number', minimum: 0 },
        bid: { type: 'number', minimum: 0 },
        ask: { type: 'number', minimum: 0 },
        spread: { type: 'number', minimum: 0 }
      },
      transformation: {
        normalizeSymbol: true,
        convertTimestamp: true,
        calculateSpread: true
      }
    });

    // OHLCV data schema
    this.addSchema('ohlcv', {
      type: 'object',
      required: ['symbol', 'open', 'high', 'low', 'close', 'volume', 'timestamp'],
      properties: {
        symbol: { type: 'string', pattern: /^[A-Z0-9]+\/[A-Z0-9]+$/ },
        open: { type: 'number', minimum: 0 },
        high: { type: 'number', minimum: 0 },
        low: { type: 'number', minimum: 0 },
        close: { type: 'number', minimum: 0 },
        volume: { type: 'number', minimum: 0 },
        timestamp: { type: 'number', minimum: 0 },
        interval: { type: 'string', enum: ['1m', '5m', '15m', '1h', '4h', '1d'] }
      },
      custom: [
        { rule: 'high >= open && high >= close', message: 'High must be >= open and close' },
        { rule: 'low <= open && low <= close', message: 'Low must be <= open and close' }
      ],
      transformation: {
        normalizeSymbol: true,
        convertTimestamp: true,
        validateOHLC: true
      }
    });

    // Order book data schema
    this.addSchema('orderbook', {
      type: 'object',
      required: ['symbol', 'bids', 'asks', 'timestamp'],
      properties: {
        symbol: { type: 'string', pattern: /^[A-Z0-9]+\/[A-Z0-9]+$/ },
        bids: {
          type: 'array',
          items: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            items: [
              { type: 'number', minimum: 0 }, // price
              { type: 'number', minimum: 0 }  // quantity
            ]
          }
        },
        asks: {
          type: 'array',
          items: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            items: [
              { type: 'number', minimum: 0 }, // price
              { type: 'number', minimum: 0 }  // quantity
            ]
          }
        },
        timestamp: { type: 'number', minimum: 0 }
      },
      custom: [
        { rule: 'validateOrderBookIntegrity', message: 'Order book integrity check failed' }
      ],
      transformation: {
        normalizeSymbol: true,
        convertTimestamp: true,
        sortOrderBook: true
      }
    });

    // Trade data schema
    this.addSchema('trade', {
      type: 'object',
      required: ['symbol', 'price', 'quantity', 'side', 'timestamp'],
      properties: {
        symbol: { type: 'string', pattern: /^[A-Z0-9]+\/[A-Z0-9]+$/ },
        price: { type: 'number', minimum: 0 },
        quantity: { type: 'number', minimum: 0 },
        side: { type: 'string', enum: ['buy', 'sell'] },
        timestamp: { type: 'number', minimum: 0 },
        tradeId: { type: 'string' }
      },
      transformation: {
        normalizeSymbol: true,
        convertTimestamp: true,
        normalizeSide: true
      }
    });

    // Token data schema for CC Trading Terminal integration
    this.addSchema('token', {
      type: 'object',
      required: ['address', 'symbol', 'network'],
      properties: {
        address: { type: 'string', pattern: /^0x[a-fA-F0-9]{40}$/ },
        symbol: { type: 'string', minLength: 1, maxLength: 20 },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        network: { type: 'string', enum: ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism'] },
        decimals: { type: 'number', minimum: 0, maximum: 18 },
        price: { type: 'number', minimum: 0 },
        marketCap: { type: 'number', minimum: 0 },
        volume24h: { type: 'number', minimum: 0 },
        totalSupply: { type: 'number', minimum: 0 },
        timestamp: { type: 'number', minimum: 0 }
      },
      transformation: {
        normalizeAddress: true,
        convertTimestamp: true,
        calculateMarketMetrics: true
      }
    });

    // Pool data schema
    this.addSchema('pool', {
      type: 'object',
      required: ['address', 'token0', 'token1', 'dex'],
      properties: {
        address: { type: 'string', pattern: /^0x[a-fA-F0-9]{40}$/ },
        token0: { $ref: '#/definitions/token' },
        token1: { $ref: '#/definitions/token' },
        dex: { type: 'string', enum: ['uniswap_v2', 'uniswap_v3', 'sushiswap', 'pancakeswap'] },
        reserve0: { type: 'number', minimum: 0 },
        reserve1: { type: 'number', minimum: 0 },
        totalSupply: { type: 'number', minimum: 0 },
        volume24h: { type: 'number', minimum: 0 },
        fees24h: { type: 'number', minimum: 0 },
        tvl: { type: 'number', minimum: 0 },
        timestamp: { type: 'number', minimum: 0 }
      },
      transformation: {
        normalizeAddress: true,
        convertTimestamp: true,
        calculatePoolMetrics: true
      }
    });
  }

  /**
   * Validate data against schema
   */
  async validate(data) {
    try {
      const dataType = this.detectDataType(data);
      const schema = this.getSchema(dataType);
      
      if (!schema) {
        return {
          isValid: false,
          errors: [`No schema found for data type: ${dataType}`],
          dataType
        };
      }

      const errors = [];

      // Basic schema validation
      const schemaErrors = this.validateSchema(data.data, schema);
      errors.push(...schemaErrors);

      // Custom validation rules
      const customErrors = await this.validateCustomRules(data.data, schema);
      errors.push(...customErrors);

      // Data quality checks
      const qualityErrors = await this.validateDataQuality(data.data, dataType);
      errors.push(...qualityErrors);

      const isValid = errors.length === 0;

      if (!isValid && this.options.strictMode) {
        this.emit('validation-error', { data, errors, dataType });
      }

      return {
        isValid,
        errors,
        dataType,
        schema
      };

    } catch (error) {
      this.logger.error('Validation error', error);
      return {
        isValid: false,
        errors: [`Validation failed: ${error.message}`],
        dataType: 'unknown'
      };
    }
  }

  /**
   * Detect data type from structure
   */
  detectDataType(data) {
    const payload = data.data;
    
    if (!payload || typeof payload !== 'object') {
      return 'unknown';
    }

    // Check for CC Trading Terminal specific data
    if (payload.address && payload.network && typeof payload.address === 'string') {
      if (payload.symbol) return 'token';
      if (payload.token0 && payload.token1) return 'pool';
    }

    // Check for standard market data types
    if (payload.open && payload.high && payload.low && payload.close) {
      return 'ohlcv';
    }

    if (payload.bids && payload.asks && Array.isArray(payload.bids)) {
      return 'orderbook';
    }

    if (payload.price && payload.quantity && payload.side) {
      return 'trade';
    }

    if (payload.price && payload.symbol) {
      return 'price';
    }

    // Try to detect from source
    if (data.sourceId) {
      if (data.sourceId.includes('coingecko')) return 'token';
      if (data.sourceId.includes('pool')) return 'pool';
      if (data.sourceId.includes('trade')) return 'trade';
      if (data.sourceId.includes('orderbook')) return 'orderbook';
    }

    return 'unknown';
  }

  /**
   * Validate against JSON schema
   */
  validateSchema(data, schema) {
    const errors = [];

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in data)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Validate properties
    if (schema.properties) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (key in data) {
          const fieldErrors = this.validateProperty(data[key], propertySchema, key);
          errors.push(...fieldErrors);
        }
      }
    }

    return errors;
  }

  /**
   * Validate individual property
   */
  validateProperty(value, schema, fieldName) {
    const errors = [];

    // Type validation
    if (schema.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== schema.type) {
        errors.push(`${fieldName}: expected ${schema.type}, got ${actualType}`);
        return errors; // Skip further validation if type is wrong
      }
    }

    // String validations
    if (schema.type === 'string') {
      if (schema.minLength && value.length < schema.minLength) {
        errors.push(`${fieldName}: length must be >= ${schema.minLength}`);
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        errors.push(`${fieldName}: length must be <= ${schema.maxLength}`);
      }
      if (schema.pattern && !schema.pattern.test(value)) {
        errors.push(`${fieldName}: does not match required pattern`);
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${fieldName}: must be one of ${schema.enum.join(', ')}`);
      }
    }

    // Number validations
    if (schema.type === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${fieldName}: must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${fieldName}: must be <= ${schema.maximum}`);
      }
    }

    // Array validations
    if (schema.type === 'array') {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${fieldName}: must have >= ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${fieldName}: must have <= ${schema.maxItems} items`);
      }
      
      // Validate array items
      if (schema.items && Array.isArray(value)) {
        value.forEach((item, index) => {
          const itemErrors = this.validateProperty(item, schema.items, `${fieldName}[${index}]`);
          errors.push(...itemErrors);
        });
      }
    }

    return errors;
  }

  /**
   * Validate custom business rules
   */
  async validateCustomRules(data, schema) {
    const errors = [];

    if (!schema.custom) return errors;

    for (const rule of schema.custom) {
      try {
        let isValid = false;

        if (typeof rule.rule === 'string') {
          // Handle special validation functions
          if (rule.rule === 'validateOrderBookIntegrity') {
            isValid = this.validateOrderBookIntegrity(data);
          } else {
            // Evaluate simple expressions
            isValid = this.evaluateRule(rule.rule, data);
          }
        } else if (typeof rule.rule === 'function') {
          isValid = await rule.rule(data);
        }

        if (!isValid) {
          errors.push(rule.message || 'Custom validation rule failed');
        }

      } catch (error) {
        errors.push(`Custom rule error: ${error.message}`);
      }
    }

    return errors;
  }

  /**
   * Validate data quality (freshness, consistency, etc.)
   */
  async validateDataQuality(data, dataType) {
    const errors = [];
    const now = Date.now();

    // Timestamp freshness check
    if (data.timestamp) {
      const age = now - data.timestamp;
      const maxAge = this.getMaxDataAge(dataType);
      
      if (age > maxAge) {
        errors.push(`Data is too old: ${age}ms > ${maxAge}ms`);
      }

      if (data.timestamp > now + 60000) { // 1 minute future tolerance
        errors.push('Data timestamp is in the future');
      }
    }

    // Price reasonableness checks
    if (data.price) {
      if (data.price <= 0) {
        errors.push('Price must be positive');
      }
      
      // Check for extreme price movements (basic sanity check)
      if (data.price > 1e12) { // Extremely high price
        errors.push('Price appears unreasonably high');
      }
    }

    // OHLCV specific checks
    if (dataType === 'ohlcv') {
      if (data.high < Math.max(data.open, data.close)) {
        errors.push('High price is inconsistent with open/close');
      }
      if (data.low > Math.min(data.open, data.close)) {
        errors.push('Low price is inconsistent with open/close');
      }
    }

    // Volume checks
    if (data.volume !== undefined && data.volume < 0) {
      errors.push('Volume cannot be negative');
    }

    return errors;
  }

  /**
   * Validate order book integrity
   */
  validateOrderBookIntegrity(data) {
    if (!data.bids || !data.asks) return false;

    // Check bid/ask sorting
    for (let i = 1; i < data.bids.length; i++) {
      if (data.bids[i][0] >= data.bids[i-1][0]) {
        return false; // Bids should be sorted descending by price
      }
    }

    for (let i = 1; i < data.asks.length; i++) {
      if (data.asks[i][0] <= data.asks[i-1][0]) {
        return false; // Asks should be sorted ascending by price
      }
    }

    // Check spread
    if (data.bids.length > 0 && data.asks.length > 0) {
      const bestBid = data.bids[0][0];
      const bestAsk = data.asks[0][0];
      
      if (bestBid >= bestAsk) {
        return false; // Spread should be positive
      }
    }

    return true;
  }

  /**
   * Simple rule evaluation
   */
  evaluateRule(rule, data) {
    try {
      // Replace field references with actual values
      let expression = rule;
      for (const [key, value] of Object.entries(data)) {
        const regex = new RegExp(`\\b${key}\\b`, 'g');
        expression = expression.replace(regex, JSON.stringify(value));
      }

      // Basic safety check - only allow certain operators
      const allowedChars = /^[0-9+\-*/.() <>!=&|'"a-zA-Z_\s]+$/;
      if (!allowedChars.test(expression)) {
        throw new Error('Invalid characters in rule expression');
      }

      return Function(`"use strict"; return (${expression})`)();
    } catch {
      return false;
    }
  }

  /**
   * Get maximum allowed data age for different types
   */
  getMaxDataAge(dataType) {
    const maxAges = {
      'price': 30000,     // 30 seconds
      'trade': 60000,     // 1 minute
      'orderbook': 10000, // 10 seconds
      'ohlcv': 300000,    // 5 minutes
      'token': 300000,    // 5 minutes
      'pool': 300000      // 5 minutes
    };

    return maxAges[dataType] || 300000; // Default 5 minutes
  }

  /**
   * Add new validation schema
   */
  addSchema(dataType, schema) {
    this.schemas.set(dataType, schema);
    
    // Clear cache for this type
    if (this.options.enableSchemaCache) {
      for (const key of this.schemaCache.keys()) {
        if (key.startsWith(`${dataType}:`)) {
          this.schemaCache.delete(key);
        }
      }
    }
  }

  /**
   * Get validation schema
   */
  getSchema(dataType) {
    return this.schemas.get(dataType);
  }

  /**
   * Get validator health
   */
  async getHealth() {
    return {
      status: 'healthy',
      schemas: this.schemas.size,
      cacheSize: this.schemaCache.size
    };
  }

  /**
   * Shutdown validator
   */
  async shutdown() {
    this.schemas.clear();
    this.schemaCache.clear();
    this.logger.info('DataValidator shutdown');
  }
}