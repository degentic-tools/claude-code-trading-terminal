// src/pipeline/core/ConnectionManager.js
import EventEmitter from 'events';
import WebSocket from 'ws';
import { Logger } from '../monitoring/Logger.js';

/**
 * Manages WebSocket and HTTP connections for real-time data feeds
 * Handles connection pooling, reconnection logic, and error recovery
 */
export class ConnectionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('ConnectionManager');
    this.options = {
      maxConnections: 50,
      connectionTimeout: 30000,
      heartbeatInterval: 30000,
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      ...options
    };

    this.connections = new Map();
    this.reconnectTimers = new Map();
    this.heartbeatTimers = new Map();
  }

  /**
   * Create a new connection based on type
   */
  async connect(config) {
    const { id, type, url, headers = {}, options = {} } = config;

    if (this.connections.has(id)) {
      throw new Error(`Connection already exists: ${id}`);
    }

    if (this.connections.size >= this.options.maxConnections) {
      throw new Error('Maximum connections limit reached');
    }

    let connection;
    
    try {
      switch (type) {
        case 'websocket':
          connection = await this.createWebSocketConnection(id, url, headers, options);
          break;
        case 'sse':
          connection = await this.createSSEConnection(id, url, headers, options);
          break;
        case 'polling':
          connection = await this.createPollingConnection(id, url, headers, options);
          break;
        default:
          throw new Error(`Unsupported connection type: ${type}`);
      }

      this.connections.set(id, {
        ...connection,
        id,
        type,
        url,
        headers,
        options,
        status: 'connected',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        reconnectAttempts: 0
      });

      this.setupHeartbeat(id);
      this.logger.info(`Connected to ${id} (${type})`);
      this.emit('connected', id);

      return connection;

    } catch (error) {
      this.logger.error(`Failed to connect to ${id}`, error);
      throw error;
    }
  }

  /**
   * Create WebSocket connection
   */
  async createWebSocketConnection(id, url, headers, options) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers,
        ...options,
        timeout: this.options.connectionTimeout
      });

      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Connection timeout for ${id}`));
      }, this.options.connectionTimeout);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.logger.info(`WebSocket connected: ${id}`);
        resolve({ ws, type: 'websocket' });
      });

      ws.on('message', (data) => {
        this.handleMessage(id, data);
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        this.handleConnectionError(id, error);
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        this.handleConnectionClose(id, code, reason);
      });

      ws.on('ping', () => {
        ws.pong();
        this.updateActivity(id);
      });

      ws.on('pong', () => {
        this.updateActivity(id);
      });
    });
  }

  /**
   * Create Server-Sent Events connection
   */
  async createSSEConnection(id, url, headers, options) {
    const { EventSource } = await import('eventsource');
    
    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(url, {
        headers,
        ...options
      });

      const timeout = setTimeout(() => {
        eventSource.close();
        reject(new Error(`SSE connection timeout for ${id}`));
      }, this.options.connectionTimeout);

      eventSource.onopen = () => {
        clearTimeout(timeout);
        this.logger.info(`SSE connected: ${id}`);
        resolve({ eventSource, type: 'sse' });
      };

      eventSource.onmessage = (event) => {
        this.handleMessage(id, event.data);
      };

      eventSource.onerror = (error) => {
        clearTimeout(timeout);
        this.handleConnectionError(id, error);
      };
    });
  }

  /**
   * Create polling connection
   */
  async createPollingConnection(id, url, headers, options) {
    const interval = options.interval || 5000;
    const fetch = (await import('node-fetch')).default;

    const poll = async () => {
      try {
        const response = await fetch(url, {
          headers,
          timeout: this.options.connectionTimeout,
          ...options
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.text();
        this.handleMessage(id, data);
        this.updateActivity(id);

      } catch (error) {
        this.handleConnectionError(id, error);
      }
    };

    const timer = setInterval(poll, interval);

    // Initial poll
    await poll();

    return {
      type: 'polling',
      timer,
      stop: () => clearInterval(timer)
    };
  }

  /**
   * Handle incoming messages
   */
  handleMessage(id, data) {
    try {
      this.updateActivity(id);
      
      let parsedData;
      if (typeof data === 'string') {
        try {
          parsedData = JSON.parse(data);
        } catch {
          parsedData = data;
        }
      } else {
        parsedData = data;
      }

      this.emit('data', id, parsedData);

    } catch (error) {
      this.logger.error(`Error handling message from ${id}`, error);
      this.emit('error', id, error);
    }
  }

  /**
   * Handle connection errors
   */
  handleConnectionError(id, error) {
    this.logger.error(`Connection error for ${id}`, error);
    const connection = this.connections.get(id);
    
    if (connection) {
      connection.status = 'error';
      connection.lastError = error;
    }

    this.emit('error', id, error);
    this.scheduleReconnect(id);
  }

  /**
   * Handle connection close
   */
  handleConnectionClose(id, code, reason) {
    this.logger.warn(`Connection closed for ${id}`, { code, reason });
    const connection = this.connections.get(id);
    
    if (connection) {
      connection.status = 'disconnected';
    }

    this.emit('disconnected', id, { code, reason });
    this.scheduleReconnect(id);
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect(id) {
    const connection = this.connections.get(id);
    if (!connection) return;

    // Clear existing timer
    if (this.reconnectTimers.has(id)) {
      clearTimeout(this.reconnectTimers.get(id));
    }

    if (connection.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.logger.error(`Max reconnect attempts reached for ${id}`);
      connection.status = 'failed';
      this.emit('connection-failed', id);
      return;
    }

    const delay = this.options.reconnectDelay * Math.pow(2, connection.reconnectAttempts);
    connection.reconnectAttempts++;

    const timer = setTimeout(async () => {
      try {
        await this.reconnect(id);
      } catch (error) {
        this.logger.error(`Reconnect failed for ${id}`, error);
      }
    }, delay);

    this.reconnectTimers.set(id, timer);
  }

  /**
   * Reconnect to a source
   */
  async reconnect(id) {
    const connection = this.connections.get(id);
    if (!connection) {
      throw new Error(`Connection not found: ${id}`);
    }

    this.logger.info(`Reconnecting to ${id}`);

    // Close existing connection
    await this.closeConnection(id, false);

    // Create new connection
    const newConnection = await this.connect({
      id,
      type: connection.type,
      url: connection.url,
      headers: connection.headers,
      options: connection.options
    });

    // Reset reconnect attempts on success
    connection.reconnectAttempts = 0;
    
    return newConnection;
  }

  /**
   * Setup heartbeat for connection health
   */
  setupHeartbeat(id) {
    const timer = setInterval(() => {
      const connection = this.connections.get(id);
      if (!connection) return;

      const timeSinceActivity = Date.now() - connection.lastActivity;
      
      if (timeSinceActivity > this.options.heartbeatInterval * 2) {
        this.logger.warn(`No activity from ${id} for ${timeSinceActivity}ms`);
        this.handleConnectionError(id, new Error('Connection appears dead'));
      } else if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
        // Send ping for WebSocket connections
        connection.ws.ping();
      }
    }, this.options.heartbeatInterval);

    this.heartbeatTimers.set(id, timer);
  }

  /**
   * Update last activity timestamp
   */
  updateActivity(id) {
    const connection = this.connections.get(id);
    if (connection) {
      connection.lastActivity = Date.now();
    }
  }

  /**
   * Disconnect from a source
   */
  async disconnect(id) {
    await this.closeConnection(id, true);
  }

  /**
   * Close all connections
   */
  async closeAll() {
    const closePromises = Array.from(this.connections.keys()).map(id => 
      this.closeConnection(id, true)
    );

    await Promise.all(closePromises);
  }

  /**
   * Close a specific connection
   */
  async closeConnection(id, remove = false) {
    const connection = this.connections.get(id);
    if (!connection) return;

    try {
      // Clear timers
      if (this.reconnectTimers.has(id)) {
        clearTimeout(this.reconnectTimers.get(id));
        this.reconnectTimers.delete(id);
      }

      if (this.heartbeatTimers.has(id)) {
        clearInterval(this.heartbeatTimers.get(id));
        this.heartbeatTimers.delete(id);
      }

      // Close connection based on type
      switch (connection.type) {
        case 'websocket':
          if (connection.ws) {
            connection.ws.close();
          }
          break;
        case 'sse':
          if (connection.eventSource) {
            connection.eventSource.close();
          }
          break;
        case 'polling':
          if (connection.stop) {
            connection.stop();
          }
          break;
      }

      if (remove) {
        this.connections.delete(id);
      }

      this.logger.info(`Disconnected from ${id}`);

    } catch (error) {
      this.logger.error(`Error closing connection ${id}`, error);
    }
  }

  /**
   * Get connection health status
   */
  async getHealth() {
    const connections = Array.from(this.connections.entries()).map(([id, conn]) => ({
      id,
      type: conn.type,
      status: conn.status,
      uptime: Date.now() - conn.createdAt,
      lastActivity: conn.lastActivity,
      reconnectAttempts: conn.reconnectAttempts
    }));

    const healthy = connections.filter(c => c.status === 'connected').length;
    const total = connections.length;

    return {
      healthy,
      total,
      unhealthy: total - healthy,
      connections
    };
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const stats = {
      total: this.connections.size,
      byType: {},
      byStatus: {}
    };

    for (const connection of this.connections.values()) {
      // Count by type
      stats.byType[connection.type] = (stats.byType[connection.type] || 0) + 1;
      
      // Count by status
      stats.byStatus[connection.status] = (stats.byStatus[connection.status] || 0) + 1;
    }

    return stats;
  }
}