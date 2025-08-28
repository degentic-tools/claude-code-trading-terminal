// src/pipeline/sources/CryptoDataSource.js
import EventEmitter from 'events';
import WebSocket from 'ws';
import { Logger } from '../monitoring/Logger.js';

/**
 * Generic crypto data source for connecting to various exchanges
 * Supports WebSocket and REST API integrations
 */
export class CryptoDataSource extends EventEmitter {
  constructor(config) {
    super();
    
    this.config = {
      exchange: 'generic',
      subscriptions: ['ticker', 'orderbook', 'trades'],
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      ...config
    };

    this.logger = new Logger(`CryptoDataSource:${this.config.exchange}`);
    
    // Connection state
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.lastHeartbeat = null;
    this.heartbeatTimer = null;

    // Subscription management
    this.activeSubscriptions = new Set();
    this.pendingSubscriptions = new Set();

    // Metrics
    this.metrics = {
      messagesReceived: 0,
      lastMessage: null,
      connectionUptime: 0,
      connectionStartTime: null
    };
  }

  /**
   * Initialize the data source
   */
  async initialize() {
    this.logger.info(`Initializing ${this.config.exchange} data source`);
  }

  /**
   * Start the data source connection
   */
  async start() {
    if (this.isConnected) {
      this.logger.warn('Data source already connected');
      return;
    }

    try {
      await this.connect();
      
      // Subscribe to configured data types
      for (const subscription of this.config.subscriptions) {
        await this.subscribe(subscription);
      }

      this.logger.info(`${this.config.exchange} data source started`);
      
    } catch (error) {
      this.logger.error('Failed to start data source', error);
      throw error;
    }
  }

  /**
   * Stop the data source
   */
  async stop() {
    if (!this.isConnected) {
      this.logger.warn('Data source not connected');
      return;
    }

    try {
      this.cleanup();
      this.logger.info(`${this.config.exchange} data source stopped`);
      
    } catch (error) {
      this.logger.error('Error stopping data source', error);
      throw error;
    }
  }

  /**
   * Connect to the exchange WebSocket
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.getWebSocketUrl();
        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
          this.handleConnection();
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
          this.handleDisconnection(code, reason);
        });

        this.ws.on('error', (error) => {
          this.handleError(error);
          if (!this.isConnected) {
            reject(error);
          }
        });

        // Connection timeout
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get WebSocket URL for the exchange
   */
  getWebSocketUrl() {
    const urls = {
      'binance': 'wss://stream.binance.com:9443/ws/btcusdt@ticker',
      'coinbase': 'wss://ws-feed.exchange.coinbase.com',
      'kraken': 'wss://ws.kraken.com',
      'huobi': 'wss://api.huobi.pro/ws',
      'generic': 'wss://echo.websocket.org' // Fallback for testing
    };

    return urls[this.config.exchange] || urls['generic'];
  }

  /**
   * Handle WebSocket connection
   */
  handleConnection() {
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.metrics.connectionStartTime = Date.now();
    
    // Start heartbeat
    this.startHeartbeat();

    this.logger.info(`Connected to ${this.config.exchange}`);
    this.emit('connected');
  }

  /**
   * Handle WebSocket disconnection
   */
  handleDisconnection(code, reason) {
    this.isConnected = false;
    this.cleanup();

    this.logger.warn(`Disconnected from ${this.config.exchange}`, { code, reason });
    this.emit('disconnected');

    // Attempt reconnection
    this.scheduleReconnect();
  }

  /**
   * Handle WebSocket errors
   */
  handleError(error) {
    this.logger.error(`WebSocket error for ${this.config.exchange}`, error);
    this.emit('error', error);
  }

  /**
   * Handle incoming messages
   */
  handleMessage(rawData) {
    try {
      this.metrics.messagesReceived++;
      this.metrics.lastMessage = Date.now();
      this.lastHeartbeat = Date.now();

      const data = JSON.parse(rawData.toString());
      
      // Process message based on exchange format
      const processedData = this.processMessage(data);
      
      if (processedData) {
        this.emit('data', processedData);
      }

    } catch (error) {
      this.logger.error('Error processing message', error);
    }
  }

  /**
   * Process incoming message based on exchange format
   */
  processMessage(data) {
    // This is a generic implementation
    // Each exchange would have its specific message processing
    
    switch (this.config.exchange) {
      case 'binance':
        return this.processBinanceMessage(data);
      case 'coinbase':
        return this.processCoinbaseMessage(data);
      case 'kraken':
        return this.processKrakenMessage(data);
      default:
        return this.processGenericMessage(data);
    }
  }

  /**
   * Process Binance message format
   */
  processBinanceMessage(data) {
    if (data.e === '24hrTicker') {
      return {
        type: 'ticker',
        data: {
          symbol: data.s,
          price: parseFloat(data.c),
          change24h: parseFloat(data.P),
          volume24h: parseFloat(data.v),
          high24h: parseFloat(data.h),
          low24h: parseFloat(data.l),
          timestamp: parseInt(data.E)
        }
      };
    }

    if (data.e === 'depthUpdate') {
      return {
        type: 'orderbook',
        data: {
          symbol: data.s,
          bids: data.b.map(([price, quantity]) => [parseFloat(price), parseFloat(quantity)]),
          asks: data.a.map(([price, quantity]) => [parseFloat(price), parseFloat(quantity)]),
          timestamp: parseInt(data.E)
        }
      };
    }

    return null;
  }

  /**
   * Process Coinbase message format
   */
  processCoinbaseMessage(data) {
    if (data.type === 'ticker') {
      return {
        type: 'ticker',
        data: {
          symbol: data.product_id.replace('-', '/'),
          price: parseFloat(data.price),
          volume24h: parseFloat(data.volume_24h),
          timestamp: new Date(data.time).getTime()
        }
      };
    }

    if (data.type === 'l2update') {
      return {
        type: 'orderbook',
        data: {
          symbol: data.product_id.replace('-', '/'),
          changes: data.changes.map(([side, price, quantity]) => ({
            side,
            price: parseFloat(price),
            quantity: parseFloat(quantity)
          })),
          timestamp: new Date(data.time).getTime()
        }
      };
    }

    return null;
  }

  /**
   * Process Kraken message format
   */
  processKrakenMessage(data) {
    if (Array.isArray(data) && data[1] && data[2] === 'ticker') {
      const ticker = data[1];
      return {
        type: 'ticker',
        data: {
          symbol: data[3], // pair name
          price: parseFloat(ticker.c[0]),
          volume24h: parseFloat(ticker.v[1]),
          high24h: parseFloat(ticker.h[1]),
          low24h: parseFloat(ticker.l[1]),
          timestamp: Date.now()
        }
      };
    }

    return null;
  }

  /**
   * Process generic message format
   */
  processGenericMessage(data) {
    // Fallback for unknown formats
    return {
      type: 'raw',
      data: data
    };
  }

  /**
   * Subscribe to data stream
   */
  async subscribe(streamType, params = {}) {
    if (!this.isConnected) {
      this.pendingSubscriptions.add({ streamType, params });
      return;
    }

    try {
      const subscriptionMessage = this.buildSubscriptionMessage(streamType, params);
      
      if (subscriptionMessage) {
        this.ws.send(JSON.stringify(subscriptionMessage));
        this.activeSubscriptions.add(streamType);
        this.logger.debug(`Subscribed to ${streamType}`);
      }

    } catch (error) {
      this.logger.error(`Failed to subscribe to ${streamType}`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe from data stream
   */
  async unsubscribe(streamType, params = {}) {
    if (!this.isConnected) return;

    try {
      const unsubscriptionMessage = this.buildUnsubscriptionMessage(streamType, params);
      
      if (unsubscriptionMessage) {
        this.ws.send(JSON.stringify(unsubscriptionMessage));
        this.activeSubscriptions.delete(streamType);
        this.logger.debug(`Unsubscribed from ${streamType}`);
      }

    } catch (error) {
      this.logger.error(`Failed to unsubscribe from ${streamType}`, error);
      throw error;
    }
  }

  /**
   * Build subscription message based on exchange format
   */
  buildSubscriptionMessage(streamType, params) {
    switch (this.config.exchange) {
      case 'binance':
        return this.buildBinanceSubscription(streamType, params);
      case 'coinbase':
        return this.buildCoinbaseSubscription(streamType, params);
      case 'kraken':
        return this.buildKrakenSubscription(streamType, params);
      default:
        return null;
    }
  }

  /**
   * Build unsubscription message
   */
  buildUnsubscriptionMessage(streamType, params) {
    // Similar to subscription but for unsubscribe
    return null;
  }

  /**
   * Build Binance subscription message
   */
  buildBinanceSubscription(streamType, params) {
    const symbol = params.symbol || 'BTCUSDT';
    
    const streamMap = {
      'ticker': `${symbol.toLowerCase()}@ticker`,
      'orderbook': `${symbol.toLowerCase()}@depth`,
      'trades': `${symbol.toLowerCase()}@trade`
    };

    return {
      method: 'SUBSCRIBE',
      params: [streamMap[streamType]],
      id: Date.now()
    };
  }

  /**
   * Build Coinbase subscription message
   */
  buildCoinbaseSubscription(streamType, params) {
    const productId = params.symbol || 'BTC-USD';
    
    const channelMap = {
      'ticker': 'ticker',
      'orderbook': 'level2',
      'trades': 'matches'
    };

    return {
      type: 'subscribe',
      product_ids: [productId],
      channels: [channelMap[streamType]]
    };
  }

  /**
   * Build Kraken subscription message
   */
  buildKrakenSubscription(streamType, params) {
    const pair = params.symbol || 'BTC/USD';
    
    const subscriptionMap = {
      'ticker': 'ticker',
      'orderbook': 'book',
      'trades': 'trade'
    };

    return {
      event: 'subscribe',
      pair: [pair],
      subscription: {
        name: subscriptionMap[streamType]
      }
    };
  }

  /**
   * Start heartbeat mechanism
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.lastHeartbeat && Date.now() - this.lastHeartbeat > this.config.heartbeatInterval * 2) {
        this.logger.warn('Heartbeat timeout detected');
        this.handleError(new Error('Heartbeat timeout'));
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.logger.error('Max reconnect attempts reached');
      this.emit('failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        this.emit('reconnecting', this.reconnectAttempts);
        await this.reconnect();
      } catch (error) {
        this.logger.error('Reconnection failed', error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Reconnect to the exchange
   */
  async reconnect() {
    this.cleanup();
    await this.connect();
    
    // Resubscribe to active streams
    for (const subscription of this.activeSubscriptions) {
      await this.subscribe(subscription);
    }

    // Process pending subscriptions
    for (const pending of this.pendingSubscriptions) {
      await this.subscribe(pending.streamType, pending.params);
    }
    this.pendingSubscriptions.clear();
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.isConnected = false;
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }

    // Update uptime metric
    if (this.metrics.connectionStartTime) {
      this.metrics.connectionUptime += Date.now() - this.metrics.connectionStartTime;
      this.metrics.connectionStartTime = null;
    }
  }

  /**
   * Get data source health
   */
  getHealth() {
    return {
      status: this.isConnected ? 'healthy' : 'disconnected',
      exchange: this.config.exchange,
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      activeSubscriptions: Array.from(this.activeSubscriptions),
      metrics: {
        ...this.metrics,
        currentUptime: this.metrics.connectionStartTime 
          ? Date.now() - this.metrics.connectionStartTime 
          : 0
      },
      lastCheck: Date.now()
    };
  }
}