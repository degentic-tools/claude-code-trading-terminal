// src/services/solanaLimitOrderService.js
import { PublicKey } from "@solana/web3.js";
import fs from 'fs/promises';
import path from 'path';

export class SolanaLimitOrderService {
  constructor(solanaService, dexService) {
    this.solanaService = solanaService;
    this.dexService = dexService;
    this.ordersFile = path.join(process.cwd(), 'data', 'limit_orders.json');
    this.orders = new Map();
    this.monitoring = false;
    this.monitoringInterval = null;
    
    this.initializeStorage();
    this.loadOrders();
  }

  async initializeStorage() {
    try {
      const dataDir = path.dirname(this.ordersFile);
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      console.warn('Failed to create data directory:', error.message);
    }
  }

  async loadOrders() {
    try {
      const data = await fs.readFile(this.ordersFile, 'utf8');
      const ordersArray = JSON.parse(data);
      this.orders = new Map(ordersArray.map(order => [order.id, order]));
      console.log(`Loaded ${this.orders.size} limit orders`);
    } catch (error) {
      // File doesn't exist or is invalid, start with empty orders
      this.orders = new Map();
    }
  }

  async saveOrders() {
    try {
      const ordersArray = Array.from(this.orders.values());
      await fs.writeFile(this.ordersFile, JSON.stringify(ordersArray, null, 2));
    } catch (error) {
      console.error('Failed to save orders:', error.message);
    }
  }

  generateOrderId() {
    return `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async createLimitOrder(params) {
    const {
      type, // 'buy' or 'sell'
      inputToken,
      outputToken,
      amount, // input amount
      targetPrice, // price per unit in output token
      slippageBps = 100,
      expiry = null, // timestamp or null for no expiry
      platform = 'auto' // 'auto', 'jupiter', 'raydium', 'meteora'
    } = params;

    try {
      const orderId = this.generateOrderId();
      const walletAddress = this.solanaService.getWalletAddress();
      
      if (!walletAddress) {
        throw new Error('Wallet not configured');
      }

      // Calculate expected output amount based on target price
      const inputAmountFormatted = this.dexService.formatAmount(amount);
      const expectedOutput = Math.floor(amount * targetPrice * Math.pow(10, 9)); // Assume 9 decimals

      const order = {
        id: orderId,
        walletAddress,
        type,
        inputToken: this.dexService.getTokenAddress(inputToken),
        outputToken: this.dexService.getTokenAddress(outputToken),
        inputSymbol: inputToken,
        outputSymbol: outputToken,
        amount: inputAmountFormatted,
        amountOriginal: amount,
        targetPrice,
        expectedOutput,
        slippageBps,
        platform,
        status: 'active',
        createdAt: Date.now(),
        expiry,
        attempts: 0,
        lastChecked: null,
        lastError: null
      };

      this.orders.set(orderId, order);
      await this.saveOrders();

      // Start monitoring if not already running
      if (!this.monitoring) {
        this.startMonitoring();
      }

      return {
        orderId,
        order: {
          ...order,
          amount: order.amountOriginal // Return human-readable amount
        },
        message: `Limit order created: ${type} ${amount} ${inputToken} at ${targetPrice} ${outputToken} each`
      };
    } catch (error) {
      throw new Error(`Failed to create limit order: ${error.message}`);
    }
  }

  async cancelLimitOrder(orderId) {
    if (!this.orders.has(orderId)) {
      throw new Error(`Order ${orderId} not found`);
    }

    const order = this.orders.get(orderId);
    order.status = 'cancelled';
    order.cancelledAt = Date.now();

    this.orders.set(orderId, order);
    await this.saveOrders();

    return {
      orderId,
      status: 'cancelled',
      message: `Limit order ${orderId} cancelled`
    };
  }

  async getLimitOrders(status = 'all') {
    const ordersArray = Array.from(this.orders.values());
    
    let filteredOrders = ordersArray;
    if (status !== 'all') {
      filteredOrders = ordersArray.filter(order => order.status === status);
    }

    return {
      orders: filteredOrders.map(order => ({
        ...order,
        amount: order.amountOriginal, // Return human-readable amount
        age: Date.now() - order.createdAt,
        expired: order.expiry ? Date.now() > order.expiry : false
      })),
      count: filteredOrders.length,
      monitoring: this.monitoring
    };
  }

  async checkOrderExecution(order) {
    try {
      // Get current market quote
      const quote = await this.dexService.getBestQuote(
        order.inputToken,
        order.outputToken,
        order.amount,
        order.slippageBps
      );

      const currentOutputAmount = parseInt(quote.bestQuote.outAmount || quote.bestQuote.outAmount);
      const currentPrice = currentOutputAmount / order.amount; // Price per input unit

      console.log(`Checking order ${order.id}: current price ${currentPrice}, target ${order.targetPrice}`);

      // Check if target price is met
      let shouldExecute = false;
      if (order.type === 'buy') {
        // For buy orders, execute when current price <= target price (getting more output)
        shouldExecute = currentOutputAmount >= order.expectedOutput;
      } else {
        // For sell orders, execute when current price >= target price
        shouldExecute = currentPrice >= order.targetPrice;
      }

      if (shouldExecute) {
        console.log(`🎯 Executing limit order ${order.id} - target price reached!`);
        return await this.executeLimitOrder(order, quote.bestQuote);
      }

      // Update last checked time
      order.lastChecked = Date.now();
      this.orders.set(order.id, order);

      return null; // Order not ready for execution
    } catch (error) {
      console.error(`Error checking order ${order.id}:`, error.message);
      order.lastError = error.message;
      order.attempts += 1;
      order.lastChecked = Date.now();
      this.orders.set(order.id, order);
      
      // Cancel order after too many failed attempts
      if (order.attempts > 10) {
        order.status = 'failed';
        order.failedAt = Date.now();
      }
      
      return null;
    }
  }

  async executeLimitOrder(order, quote) {
    try {
      console.log(`🚀 Executing limit order ${order.id} on ${quote.platform}`);

      let result;
      switch (quote.platform) {
        case 'Jupiter':
          result = await this.dexService.executeJupiterSwap(quote);
          break;
        case 'Raydium':
          result = await this.dexService.executeRaydiumSwap(quote);
          break;
        default:
          // Fallback to Jupiter
          result = await this.dexService.executeJupiterSwap(quote);
      }

      // Update order status
      order.status = 'executed';
      order.executedAt = Date.now();
      order.executionSignature = result.signature;
      order.actualOutputAmount = result.outAmount;
      order.executionPlatform = result.platform;

      this.orders.set(order.id, order);
      await this.saveOrders();

      return {
        orderId: order.id,
        signature: result.signature,
        platform: result.platform,
        inputAmount: order.amountOriginal,
        outputAmount: this.dexService.formatPrice(result.outAmount),
        status: 'executed',
        message: `Limit order executed: ${result.signature}`
      };
    } catch (error) {
      order.status = 'failed';
      order.failedAt = Date.now();
      order.lastError = error.message;
      this.orders.set(order.id, order);
      await this.saveOrders();

      throw new Error(`Failed to execute limit order ${order.id}: ${error.message}`);
    }
  }

  startMonitoring(intervalMs = 30000) { // Check every 30 seconds
    if (this.monitoring) {
      return;
    }

    this.monitoring = true;
    console.log('🔄 Starting limit order monitoring...');

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkAllActiveOrders();
      } catch (error) {
        console.error('Error in monitoring cycle:', error.message);
      }
    }, intervalMs);
  }

  stopMonitoring() {
    if (!this.monitoring) {
      return;
    }

    this.monitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    console.log('⏸️ Stopped limit order monitoring');
  }

  async checkAllActiveOrders() {
    const activeOrders = Array.from(this.orders.values())
      .filter(order => order.status === 'active');

    if (activeOrders.length === 0) {
      return;
    }

    console.log(`Checking ${activeOrders.length} active limit orders...`);

    for (const order of activeOrders) {
      // Check expiry
      if (order.expiry && Date.now() > order.expiry) {
        order.status = 'expired';
        order.expiredAt = Date.now();
        this.orders.set(order.id, order);
        console.log(`📅 Order ${order.id} expired`);
        continue;
      }

      // Check execution conditions
      try {
        const result = await this.checkOrderExecution(order);
        if (result) {
          console.log(`✅ Order ${order.id} executed: ${result.signature}`);
        }
      } catch (error) {
        console.error(`❌ Order ${order.id} execution failed:`, error.message);
      }

      // Small delay between orders to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await this.saveOrders();
  }

  // Advanced order types
  async createStopLoss(params) {
    const {
      inputToken,
      amount,
      triggerPrice,
      slippageBps = 500 // 5% slippage for stop losses
    } = params;

    // Create a sell order that triggers when price drops below trigger price
    return await this.createLimitOrder({
      type: 'sell',
      inputToken,
      outputToken: 'SOL', // Usually sell to SOL
      amount,
      targetPrice: triggerPrice,
      slippageBps,
      platform: 'auto'
    });
  }

  async createTakeProfit(params) {
    const {
      inputToken,
      amount,
      targetPrice,
      slippageBps = 100
    } = params;

    // Create a sell order that triggers when price rises above target
    return await this.createLimitOrder({
      type: 'sell',
      inputToken,
      outputToken: 'SOL',
      amount,
      targetPrice,
      slippageBps,
      platform: 'auto'
    });
  }

  getOrderStats() {
    const orders = Array.from(this.orders.values());
    const stats = {
      total: orders.length,
      active: orders.filter(o => o.status === 'active').length,
      executed: orders.filter(o => o.status === 'executed').length,
      cancelled: orders.filter(o => o.status === 'cancelled').length,
      expired: orders.filter(o => o.status === 'expired').length,
      failed: orders.filter(o => o.status === 'failed').length,
      monitoring: this.monitoring,
      lastMonitoringCycle: this.lastMonitoringCycle || null
    };

    return stats;
  }
}