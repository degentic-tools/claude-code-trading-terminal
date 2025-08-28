// src/pipeline/core/RateLimiter.js
import EventEmitter from 'events';
import { Logger } from '../monitoring/Logger.js';

/**
 * Advanced rate limiter supporting multiple strategies and API quotas
 * Implements token bucket, sliding window, and fixed window algorithms
 */
export class RateLimiter extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('RateLimiter');
    this.options = {
      defaultStrategy: 'token-bucket',
      globalLimit: 1000, // requests per minute
      cleanupInterval: 60000,
      ...options
    };

    // Storage for rate limit data
    this.limiters = new Map();
    this.globalCounter = {
      requests: 0,
      windowStart: Date.now()
    };

    this.initialize();
  }

  /**
   * Initialize the rate limiter
   */
  async initialize() {
    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);

    this.logger.info('RateLimiter initialized');
  }

  /**
   * Check if request is allowed based on rate limits
   */
  async checkLimit(identifier, customLimits = null) {
    try {
      // Check global rate limit first
      if (!this.checkGlobalLimit()) {
        this.emit('global-limit-exceeded', { identifier });
        return false;
      }

      // Get or create limiter for identifier
      const limiter = this.getLimiter(identifier, customLimits);
      
      // Check specific rate limit
      const allowed = this.checkSpecificLimit(limiter);
      
      if (!allowed) {
        this.emit('limit-exceeded', { identifier, limiter: limiter.config });
      }

      return allowed;

    } catch (error) {
      this.logger.error(`Error checking rate limit for ${identifier}`, error);
      return false;
    }
  }

  /**
   * Record a request for rate limiting
   */
  async recordRequest(identifier, cost = 1) {
    try {
      // Update global counter
      this.updateGlobalCounter();

      // Update specific limiter
      const limiter = this.getLimiter(identifier);
      this.recordSpecificRequest(limiter, cost);

      this.emit('request-recorded', { identifier, cost });

    } catch (error) {
      this.logger.error(`Error recording request for ${identifier}`, error);
    }
  }

  /**
   * Get remaining requests for an identifier
   */
  getRemainingRequests(identifier) {
    const limiter = this.limiters.get(identifier);
    if (!limiter) {
      return this.getDefaultLimits().maxRequests;
    }

    switch (limiter.strategy) {
      case 'token-bucket':
        return Math.floor(limiter.tokens);
      case 'sliding-window':
        return Math.max(0, limiter.maxRequests - limiter.requests.length);
      case 'fixed-window':
        return Math.max(0, limiter.maxRequests - limiter.currentCount);
      default:
        return 0;
    }
  }

  /**
   * Get time until reset for an identifier
   */
  getResetTime(identifier) {
    const limiter = this.limiters.get(identifier);
    if (!limiter) {
      return 0;
    }

    const now = Date.now();

    switch (limiter.strategy) {
      case 'token-bucket':
        if (limiter.tokens >= limiter.maxTokens) return 0;
        return Math.ceil((limiter.maxTokens - limiter.tokens) / limiter.refillRate * 1000);
      
      case 'sliding-window':
        if (limiter.requests.length === 0) return 0;
        return Math.max(0, limiter.requests[0] + limiter.windowSize - now);
      
      case 'fixed-window':
        return Math.max(0, limiter.windowStart + limiter.windowSize - now);
      
      default:
        return 0;
    }
  }

  /**
   * Check global rate limit
   */
  checkGlobalLimit() {
    const now = Date.now();
    const windowSize = 60000; // 1 minute

    // Reset window if needed
    if (now - this.globalCounter.windowStart >= windowSize) {
      this.globalCounter.requests = 0;
      this.globalCounter.windowStart = now;
    }

    return this.globalCounter.requests < this.options.globalLimit;
  }

  /**
   * Update global counter
   */
  updateGlobalCounter() {
    const now = Date.now();
    const windowSize = 60000; // 1 minute

    // Reset window if needed
    if (now - this.globalCounter.windowStart >= windowSize) {
      this.globalCounter.requests = 0;
      this.globalCounter.windowStart = now;
    }

    this.globalCounter.requests++;
  }

  /**
   * Get or create rate limiter for identifier
   */
  getLimiter(identifier, customLimits = null) {
    let limiter = this.limiters.get(identifier);
    
    if (!limiter) {
      const config = customLimits || this.getDefaultLimits();
      limiter = this.createLimiter(config);
      this.limiters.set(identifier, limiter);
    }

    return limiter;
  }

  /**
   * Create a new rate limiter based on strategy
   */
  createLimiter(config) {
    const now = Date.now();
    
    const baseLimiter = {
      config,
      strategy: config.strategy || this.options.defaultStrategy,
      createdAt: now,
      lastUsed: now
    };

    switch (baseLimiter.strategy) {
      case 'token-bucket':
        return {
          ...baseLimiter,
          tokens: config.maxRequests,
          maxTokens: config.maxRequests,
          refillRate: config.maxRequests / (config.windowSize / 1000),
          lastRefill: now
        };

      case 'sliding-window':
        return {
          ...baseLimiter,
          requests: [],
          maxRequests: config.maxRequests,
          windowSize: config.windowSize
        };

      case 'fixed-window':
        return {
          ...baseLimiter,
          currentCount: 0,
          maxRequests: config.maxRequests,
          windowSize: config.windowSize,
          windowStart: now
        };

      default:
        throw new Error(`Unknown rate limiting strategy: ${baseLimiter.strategy}`);
    }
  }

  /**
   * Check specific rate limit based on strategy
   */
  checkSpecificLimit(limiter) {
    const now = Date.now();

    switch (limiter.strategy) {
      case 'token-bucket':
        this.refillTokens(limiter, now);
        return limiter.tokens >= 1;

      case 'sliding-window':
        this.cleanupSlidingWindow(limiter, now);
        return limiter.requests.length < limiter.maxRequests;

      case 'fixed-window':
        this.resetFixedWindow(limiter, now);
        return limiter.currentCount < limiter.maxRequests;

      default:
        return false;
    }
  }

  /**
   * Record request for specific limiter
   */
  recordSpecificRequest(limiter, cost) {
    const now = Date.now();
    limiter.lastUsed = now;

    switch (limiter.strategy) {
      case 'token-bucket':
        this.refillTokens(limiter, now);
        limiter.tokens = Math.max(0, limiter.tokens - cost);
        break;

      case 'sliding-window':
        limiter.requests.push(now);
        this.cleanupSlidingWindow(limiter, now);
        break;

      case 'fixed-window':
        this.resetFixedWindow(limiter, now);
        limiter.currentCount += cost;
        break;
    }
  }

  /**
   * Refill tokens for token bucket
   */
  refillTokens(limiter, now) {
    const timePassed = (now - limiter.lastRefill) / 1000;
    const tokensToAdd = timePassed * limiter.refillRate;
    
    limiter.tokens = Math.min(limiter.maxTokens, limiter.tokens + tokensToAdd);
    limiter.lastRefill = now;
  }

  /**
   * Clean up old requests from sliding window
   */
  cleanupSlidingWindow(limiter, now) {
    const cutoff = now - limiter.windowSize;
    limiter.requests = limiter.requests.filter(timestamp => timestamp > cutoff);
  }

  /**
   * Reset fixed window if needed
   */
  resetFixedWindow(limiter, now) {
    if (now - limiter.windowStart >= limiter.windowSize) {
      limiter.currentCount = 0;
      limiter.windowStart = now;
    }
  }

  /**
   * Get default rate limits
   */
  getDefaultLimits() {
    return {
      strategy: 'token-bucket',
      maxRequests: 100,
      windowSize: 60000, // 1 minute
      burstLimit: 10
    };
  }

  /**
   * Get API-specific limits based on source type
   */
  getAPILimits(sourceType) {
    const limits = {
      'coingecko': {
        strategy: 'fixed-window',
        maxRequests: 50,
        windowSize: 60000
      },
      'binance': {
        strategy: 'token-bucket',
        maxRequests: 1200,
        windowSize: 60000
      },
      'coinbase': {
        strategy: 'sliding-window',
        maxRequests: 10,
        windowSize: 1000
      },
      'kraken': {
        strategy: 'token-bucket',
        maxRequests: 60,
        windowSize: 60000
      }
    };

    return limits[sourceType] || this.getDefaultLimits();
  }

  /**
   * Clean up old limiters
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 300000; // 5 minutes

    for (const [identifier, limiter] of this.limiters.entries()) {
      if (now - limiter.lastUsed > maxAge) {
        this.limiters.delete(identifier);
      }
    }

    this.logger.debug(`Cleaned up rate limiters, ${this.limiters.size} remaining`);
  }

  /**
   * Get rate limiter statistics
   */
  getStats() {
    const stats = {
      totalLimiters: this.limiters.size,
      globalRequests: this.globalCounter.requests,
      limitersDetail: {}
    };

    for (const [identifier, limiter] of this.limiters.entries()) {
      stats.limitersDetail[identifier] = {
        strategy: limiter.strategy,
        remaining: this.getRemainingRequests(identifier),
        resetTime: this.getResetTime(identifier),
        lastUsed: limiter.lastUsed
      };
    }

    return stats;
  }

  /**
   * Get health status
   */
  async getHealth() {
    return {
      status: 'healthy',
      limiters: this.limiters.size,
      globalRequests: this.globalCounter.requests,
      globalLimit: this.options.globalLimit
    };
  }

  /**
   * Shutdown rate limiter
   */
  async shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.limiters.clear();
    this.logger.info('RateLimiter shutdown');
  }
}