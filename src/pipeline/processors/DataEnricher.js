// src/pipeline/processors/DataEnricher.js
import EventEmitter from 'events';
import { Logger } from '../monitoring/Logger.js';

/**
 * Data enrichment service for adding contextual information to market data
 * Integrates with external APIs and cached data for enhanced analytics
 */
export class DataEnricher extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('DataEnricher');
    this.options = {
      enableCaching: true,
      cacheTimeout: 300000, // 5 minutes
      maxCacheSize: 5000,
      enableExternalAPIs: true,
      rateLimitDelay: 100,
      ...options
    };

    // Enrichment cache and metadata
    this.enrichmentCache = new Map();
    this.enrichmentRules = new Map();
    this.externalAPIs = new Map();
    
    this.setupDefaultEnrichments();
    this.setupExternalAPIs();
  }

  /**
   * Initialize the enricher
   */
  async initialize() {
    // Setup cache cleanup
    if (this.options.enableCaching) {
      this.cacheCleanupInterval = setInterval(() => {
        this.cleanupCache();
      }, 60000); // Cleanup every minute
    }

    this.logger.info('DataEnricher initialized');
  }

  /**
   * Setup default enrichment rules
   */
  setupDefaultEnrichments() {
    // Token enrichment
    this.addEnrichment('token', {
      addMetadata: async (data) => {
        // Add token metadata from cache or external APIs
        const metadata = await this.getTokenMetadata(data.address, data.network);
        return { ...data, metadata };
      },
      addPriceHistory: async (data) => {
        // Add historical price data
        const priceHistory = await this.getPriceHistory(data.symbol, '24h');
        return { ...data, priceHistory };
      },
      addTechnicalIndicators: async (data) => {
        // Add technical analysis indicators
        const indicators = await this.calculateTechnicalIndicators(data);
        return { ...data, technicalIndicators: indicators };
      }
    });

    // Pool enrichment
    this.addEnrichment('pool', {
      addLiquidityMetrics: async (data) => {
        // Calculate advanced liquidity metrics
        const liquidityMetrics = await this.calculateLiquidityMetrics(data);
        return { ...data, liquidityMetrics };
      },
      addImpermanentLoss: async (data) => {
        // Calculate impermanent loss data
        const impermanentLoss = await this.calculateImpermanentLoss(data);
        return { ...data, impermanentLoss };
      },
      addYieldData: async (data) => {
        // Add yield farming data
        const yieldData = await this.getYieldData(data.address, data.dex);
        return { ...data, yieldData };
      }
    });

    // Price enrichment
    this.addEnrichment('price', {
      addMovingAverages: async (data) => {
        // Add moving averages
        const movingAverages = await this.calculateMovingAverages(data.symbol);
        return { ...data, movingAverages };
      },
      addVolumeProfile: async (data) => {
        // Add volume profile data
        const volumeProfile = await this.getVolumeProfile(data.symbol);
        return { ...data, volumeProfile };
      },
      addMarketSentiment: async (data) => {
        // Add sentiment indicators
        const sentiment = await this.getMarketSentiment(data.symbol);
        return { ...data, sentiment };
      }
    });

    // OHLCV enrichment
    this.addEnrichment('ohlcv', {
      addTechnicalIndicators: async (data) => {
        // Calculate technical indicators for OHLCV data
        const indicators = {
          rsi: await this.calculateRSI(data.symbol, data.interval),
          macd: await this.calculateMACD(data.symbol, data.interval),
          bollinger: await this.calculateBollingerBands(data.symbol, data.interval),
          volume: await this.analyzeVolume(data)
        };
        return { ...data, technicalIndicators: indicators };
      },
      addSupportResistance: async (data) => {
        // Add support and resistance levels
        const levels = await this.calculateSupportResistance(data.symbol);
        return { ...data, supportResistance: levels };
      }
    });

    // Trade enrichment
    this.addEnrichment('trade', {
      addTradeClassification: async (data) => {
        // Classify trade type (market maker, taker, etc.)
        const classification = await this.classifyTrade(data);
        return { ...data, classification };
      },
      addMarketImpact: async (data) => {
        // Calculate market impact
        const impact = await this.calculateMarketImpact(data);
        return { ...data, marketImpact: impact };
      }
    });

    // Order book enrichment
    this.addEnrichment('orderbook', {
      addDepthAnalysis: async (data) => {
        // Analyze order book depth
        const depthAnalysis = this.analyzeOrderBookDepth(data);
        return { ...data, depthAnalysis };
      },
      addLiquidityScore: async (data) => {
        // Calculate liquidity score
        const liquidityScore = this.calculateLiquidityScore(data);
        return { ...data, liquidityScore };
      }
    });
  }

  /**
   * Setup external API connections
   */
  setupExternalAPIs() {
    // CoinGecko API for token metadata
    this.externalAPIs.set('coingecko', {
      baseUrl: 'https://api.coingecko.com/api/v3',
      rateLimit: 50, // requests per minute
      apiKey: process.env.COINGECKO_API_KEY
    });

    // DefiLlama for TVL and yield data
    this.externalAPIs.set('defillama', {
      baseUrl: 'https://api.llama.fi',
      rateLimit: 300
    });

    // Alternative data providers
    this.externalAPIs.set('messari', {
      baseUrl: 'https://data.messari.io/api',
      rateLimit: 20,
      apiKey: process.env.MESSARI_API_KEY
    });
  }

  /**
   * Enrich data with additional context
   */
  async enrich(transformedData) {
    try {
      const { dataType, data } = transformedData;
      
      // Get enrichment rules for this data type
      const enrichmentRules = this.enrichmentRules.get(dataType);
      if (!enrichmentRules) {
        // No enrichment rules, return as-is
        return transformedData;
      }

      let enrichedData = { ...data };

      // Apply each enrichment rule
      for (const [ruleName, ruleFunction] of Object.entries(enrichmentRules)) {
        try {
          // Check cache first
          const cacheKey = this.generateCacheKey(dataType, ruleName, enrichedData);
          let enrichmentResult = this.getFromCache(cacheKey);

          if (!enrichmentResult) {
            // Apply enrichment rule
            enrichmentResult = await ruleFunction(enrichedData);
            
            // Cache result if caching is enabled
            if (this.options.enableCaching) {
              this.setInCache(cacheKey, enrichmentResult);
            }
          }

          enrichedData = enrichmentResult;

        } catch (error) {
          this.logger.error(`Enrichment rule ${ruleName} failed`, error);
          this.emit('enrichment-error', { ruleName, error, data: enrichedData });
        }
      }

      return {
        ...transformedData,
        data: enrichedData,
        enrichedTimestamp: Date.now()
      };

    } catch (error) {
      this.logger.error('Data enrichment failed', error);
      throw error;
    }
  }

  /**
   * Get token metadata from external APIs
   */
  async getTokenMetadata(address, network) {
    const cacheKey = `token_metadata_${network}_${address}`;
    let metadata = this.getFromCache(cacheKey);

    if (!metadata) {
      try {
        // Try CoinGecko first
        metadata = await this.fetchTokenMetadataFromCoinGecko(address, network);
        
        if (!metadata) {
          // Fallback to other providers
          metadata = await this.fetchTokenMetadataFallback(address, network);
        }

        if (metadata && this.options.enableCaching) {
          this.setInCache(cacheKey, metadata, this.options.cacheTimeout);
        }

      } catch (error) {
        this.logger.error(`Failed to fetch token metadata for ${address}`, error);
        metadata = { error: error.message };
      }
    }

    return metadata || {};
  }

  /**
   * Fetch token metadata from CoinGecko
   */
  async fetchTokenMetadataFromCoinGecko(address, network) {
    if (!this.options.enableExternalAPIs) return null;

    try {
      const api = this.externalAPIs.get('coingecko');
      const networkMap = {
        'ethereum': 'ethereum',
        'bsc': 'binance-smart-chain',
        'polygon': 'polygon-pos',
        'arbitrum': 'arbitrum-one',
        'optimism': 'optimistic-ethereum'
      };

      const platformId = networkMap[network];
      if (!platformId) return null;

      const url = `${api.baseUrl}/coins/${platformId}/contract/${address}`;
      const response = await this.makeAPIRequest(url, api);

      if (response) {
        return {
          name: response.name,
          symbol: response.symbol,
          description: response.description?.en,
          image: response.image?.large,
          website: response.links?.homepage?.[0],
          twitter: response.links?.twitter_screen_name,
          github: response.links?.repos_url?.github?.[0],
          marketCapRank: response.market_cap_rank,
          coingeckoId: response.id
        };
      }

    } catch (error) {
      this.logger.error('CoinGecko API request failed', error);
    }

    return null;
  }

  /**
   * Calculate technical indicators
   */
  async calculateTechnicalIndicators(data) {
    const indicators = {};

    try {
      // Simple moving average (if we have price history)
      if (data.priceHistory && data.priceHistory.length > 0) {
        indicators.sma20 = this.calculateSMA(data.priceHistory, 20);
        indicators.sma50 = this.calculateSMA(data.priceHistory, 50);
        indicators.sma200 = this.calculateSMA(data.priceHistory, 200);
      }

      // RSI calculation (requires historical data)
      if (data.priceHistory) {
        indicators.rsi = this.calculateRSIFromHistory(data.priceHistory);
      }

      // Volume indicators
      if (data.volume24h && data.volumeHistory) {
        indicators.volumeRatio = data.volume24h / this.average(data.volumeHistory);
        indicators.volumeTrend = this.calculateVolumeTrend(data.volumeHistory);
      }

      // Price momentum
      if (data.priceHistory && data.priceHistory.length >= 2) {
        const recent = data.priceHistory.slice(-14); // Last 14 periods
        indicators.momentum = (recent[recent.length - 1] - recent[0]) / recent[0];
      }

    } catch (error) {
      this.logger.error('Error calculating technical indicators', error);
    }

    return indicators;
  }

  /**
   * Analyze order book depth
   */
  analyzeOrderBookDepth(data) {
    const analysis = {
      bidLevels: 0,
      askLevels: 0,
      bidVolume: 0,
      askVolume: 0,
      imbalance: 0,
      averageBidSize: 0,
      averageAskSize: 0
    };

    try {
      if (data.bids && data.bids.length > 0) {
        analysis.bidLevels = data.bids.length;
        analysis.bidVolume = data.bids.reduce((sum, [, size]) => sum + size, 0);
        analysis.averageBidSize = analysis.bidVolume / analysis.bidLevels;
      }

      if (data.asks && data.asks.length > 0) {
        analysis.askLevels = data.asks.length;
        analysis.askVolume = data.asks.reduce((sum, [, size]) => sum + size, 0);
        analysis.averageAskSize = analysis.askVolume / analysis.askLevels;
      }

      // Calculate order book imbalance
      const totalVolume = analysis.bidVolume + analysis.askVolume;
      if (totalVolume > 0) {
        analysis.imbalance = (analysis.bidVolume - analysis.askVolume) / totalVolume;
      }

      // Calculate depth at different price levels
      analysis.depth = this.calculateDepthLevels(data);

    } catch (error) {
      this.logger.error('Error analyzing order book depth', error);
    }

    return analysis;
  }

  /**
   * Calculate liquidity score
   */
  calculateLiquidityScore(data) {
    try {
      if (!data.bids || !data.asks) return 0;

      // Factors for liquidity score
      const spreadWeight = 0.3;
      const depthWeight = 0.4;
      const levelsWeight = 0.3;

      // Spread component (lower is better)
      let spreadScore = 0;
      if (data.spread && data.bids[0]) {
        const spreadPercent = (data.spread / data.bids[0][0]) * 100;
        spreadScore = Math.max(0, 100 - spreadPercent * 10); // Penalize wide spreads
      }

      // Depth component
      const totalDepth = (data.bidDepth || 0) + (data.askDepth || 0);
      const depthScore = Math.min(100, Math.log10(totalDepth + 1) * 20);

      // Levels component
      const totalLevels = data.bids.length + data.asks.length;
      const levelsScore = Math.min(100, totalLevels * 2);

      // Weighted score
      const liquidityScore = 
        (spreadScore * spreadWeight) +
        (depthScore * depthWeight) +
        (levelsScore * levelsWeight);

      return Math.round(liquidityScore);

    } catch (error) {
      this.logger.error('Error calculating liquidity score', error);
      return 0;
    }
  }

  /**
   * Calculate simple moving average
   */
  calculateSMA(prices, period) {
    if (!prices || prices.length < period) return null;
    
    const recentPrices = prices.slice(-period);
    return recentPrices.reduce((sum, price) => sum + price, 0) / period;
  }

  /**
   * Calculate RSI from price history
   */
  calculateRSIFromHistory(prices, period = 14) {
    if (!prices || prices.length < period + 1) return null;

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    if (changes.length < period) return null;

    const gains = changes.map(change => Math.max(0, change));
    const losses = changes.map(change => Math.max(0, -change));

    const avgGain = this.average(gains.slice(-period));
    const avgLoss = this.average(losses.slice(-period));

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Utility function to calculate average
   */
  average(array) {
    return array.reduce((sum, val) => sum + val, 0) / array.length;
  }

  /**
   * Make API request with rate limiting
   */
  async makeAPIRequest(url, apiConfig) {
    try {
      // Implement basic rate limiting
      if (this.lastAPICall) {
        const timeSinceLastCall = Date.now() - this.lastAPICall;
        if (timeSinceLastCall < this.options.rateLimitDelay) {
          await new Promise(resolve => 
            setTimeout(resolve, this.options.rateLimitDelay - timeSinceLastCall)
          );
        }
      }

      const headers = {};
      if (apiConfig.apiKey) {
        headers['Authorization'] = `Bearer ${apiConfig.apiKey}`;
      }

      const response = await fetch(url, { headers });
      this.lastAPICall = Date.now();

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      return await response.json();

    } catch (error) {
      this.logger.error(`API request failed for ${url}`, error);
      throw error;
    }
  }

  /**
   * Generate cache key
   */
  generateCacheKey(dataType, ruleName, data) {
    const keyData = {
      dataType,
      ruleName,
      symbol: data.symbol,
      address: data.address,
      network: data.network
    };
    
    return `enrichment_${JSON.stringify(keyData)}`;
  }

  /**
   * Get data from cache
   */
  getFromCache(key) {
    if (!this.options.enableCaching) return null;

    const cached = this.enrichmentCache.get(key);
    if (!cached) return null;

    if (Date.now() > cached.expires) {
      this.enrichmentCache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set data in cache
   */
  setInCache(key, data, timeout = null) {
    if (!this.options.enableCaching) return;

    const expires = Date.now() + (timeout || this.options.cacheTimeout);
    this.enrichmentCache.set(key, { data, expires });

    // Cleanup if cache is too large
    if (this.enrichmentCache.size > this.options.maxCacheSize) {
      const firstKey = this.enrichmentCache.keys().next().value;
      this.enrichmentCache.delete(firstKey);
    }
  }

  /**
   * Cleanup expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, value] of this.enrichmentCache.entries()) {
      if (now > value.expires) {
        this.enrichmentCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired cache entries`);
    }
  }

  /**
   * Add enrichment rules
   */
  addEnrichment(dataType, enrichmentRules) {
    this.enrichmentRules.set(dataType, enrichmentRules);
  }

  /**
   * Get enricher health
   */
  async getHealth() {
    return {
      status: 'healthy',
      cacheSize: this.enrichmentCache.size,
      enrichmentRules: this.enrichmentRules.size,
      externalAPIs: this.externalAPIs.size
    };
  }

  /**
   * Shutdown enricher
   */
  async shutdown() {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
    }

    this.enrichmentCache.clear();
    this.enrichmentRules.clear();
    this.logger.info('DataEnricher shutdown');
  }
}