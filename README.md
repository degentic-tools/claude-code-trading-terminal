# CC Trading Terminal - Advanced Data Ingestion Pipeline

> **Agent-native trading terminal with real-time data ingestion pipeline similar to Aladdin's capabilities**

[![Version](https://img.shields.io/npm/v/@degentic/cc-trading-terminal.svg)](https://www.npmjs.com/package/@degentic/cc-trading-terminal)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 New: Real-Time Data Ingestion Pipeline

We've built a comprehensive real-time data ingestion pipeline that rivals institutional platforms like BlackRock's Aladdin. This system provides:

- **Real-time WebSocket connections** to multiple market data sources
- **Data normalization and transformation** for consistent formatting
- **Message queue system** with high-throughput processing
- **Advanced error handling** and retry mechanisms
- **Data validation and quality checks** 
- **Historical data backfill** capabilities
- **Rate limiting and API management**
- **Comprehensive monitoring** and health checks

## 📊 Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Data Sources  │───▶│   Pipeline Core  │───▶│   Consumers     │
├─────────────────┤    ├──────────────────┤    ├─────────────────┤
│ • CC Terminal   │    │ • Connection Mgr │    │ • Trading Bots  │
│ • Binance       │    │ • Queue Manager  │    │ • Risk Systems  │
│ • Coinbase      │    │ • Data Processor │    │ • Analytics     │
│ • CoinGecko     │    │ • Validator      │    │ • Monitoring    │
│ • Uniswap       │    │ • Transformer    │    │ • Historical DB │
│ • Custom APIs   │    │ • Enricher       │    │ • Dashboards    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🏗️ Pipeline Components

### Core Pipeline (`src/pipeline/core/`)
- **Pipeline.js** - Main orchestrator coordinating all components
- **ConnectionManager.js** - WebSocket and HTTP connection pooling
- **RateLimiter.js** - Advanced rate limiting with multiple strategies

### Data Processing (`src/pipeline/processors/`)
- **DataProcessor.js** - Main processing engine with parallel execution
- **DataValidator.js** - Comprehensive validation with custom rules
- **DataTransformer.js** - Normalize data from different sources
- **DataEnricher.js** - Add contextual information and analytics

### Queue Management (`src/pipeline/queue/`)
- **QueueManager.js** - High-level queue orchestration
- **InMemoryQueue.js** - Fast in-memory processing
- **PersistentQueue.js** - Durable file-based queues

### Data Sources (`src/pipeline/sources/`)
- **DataSourceManager.js** - Coordinate multiple data feeds
- **CCTradingTerminalSource.js** - Integration with existing tools
- **CryptoDataSource.js** - Generic exchange WebSocket connector

### Storage & Monitoring (`src/pipeline/storage/`, `src/pipeline/monitoring/`)
- **HistoricalDataService.js** - Data persistence and backfill
- **HealthChecker.js** - Component health monitoring
- **Logger.js** - Structured logging system

## 🚀 Quick Start

### Start the Pipeline
```bash
# Start with default configuration
npm run pipeline:start

# Start with historical data backfill
npm run pipeline:start -- --backfill
```

### Integration Example
```javascript
import { PipelineService } from './src/pipeline/PipelineService.js';

// Initialize pipeline
const pipeline = new PipelineService({
  enableHistoricalData: true,
  enableRealTimeData: true,
  autoStart: true
});

// Handle processed data
pipeline.on('data', (data) => {
  console.log('Received:', data.dataType, data.data);
});

// Start the pipeline
await pipeline.initialize();
```

Agent-native trading terminal built on top of Claude Code with advanced real-time data ingestion. Deploy sub-agents that execute trades, monitor positions, and manage risk in parallel across unlimited wallets.

## Installation

```bash
npm install cc-trading-terminal
```

## Setup

Configure your trading agent in Claude Code:

```bash
claude mcp add cc-trading-terminal \
  -e SOLANA_PRIVATE_KEY=your_solana_private_key_base58 \
  -e COINGECKO_API_KEY=your_coingecko_api_key \
  -- npx cc-trading-terminal
```

## Trading Features

### 🤖 Market Maker Bot (NEW!)
Automated portfolio rebalancing inspired by institutional market-making strategies:

- **50/50 Portfolio Rebalancing**: Maintains target allocation between SOL and any SPL token
- **Jupiter Integration**: Uses Jupiter Aggregator for optimal swap execution
- **Risk Management**: Built-in slippage protection and price tolerance controls
- **Real-time Monitoring**: Continuous portfolio tracking and intelligent rebalancing
- **Configurable Parameters**: Adjustable thresholds, wait times, and risk settings
- **Performance Analytics**: Comprehensive trading statistics and success metrics

```javascript
// Initialize market maker
await initializeMarketMaker({ 
  slippageBps: 50,           // 0.5% slippage tolerance
  rebalanceThreshold: 0.05,   // Rebalance when allocation drifts 5%
  waitTime: 60000            // Check every minute
});

// Start market making for a token
await startMarketMaker({
  tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  targetAllocation: 0.6      // 60% SOL, 40% USDC
});
```

### Multi-DEX Integration
- **Jupiter Aggregator**: Best price routing across all Solana DEXes
- **Raydium**: Fastest execution and newest token support
- **Meteora**: Memecoin-optimized with anti-sniper protection
- **Auto-routing**: Automatically finds best execution paths

### Professional Order Types
- **Limit Orders**: Set buy/sell orders at target prices with automatic execution
- **Stop Loss**: Protect positions with automatic sell triggers
- **Take Profit**: Lock in gains when targets are reached
- **DCA Orders**: Dollar-cost averaging with scheduled execution

### Memecoin Trading Tools
- **PumpFun Integration**: Real-time tracking of new token launches
- **Risk Assessment**: AI-powered analysis with low/medium/high risk scoring
- **Trend Scanner**: Discovery of potential memecoins with scoring algorithm
- **Quick Buy**: Instant purchases with built-in risk controls

### Risk Management
- **3-Tier Risk System**: Automatic position sizing based on token risk level
- **Smart Slippage**: Dynamic slippage adjustment based on market conditions
- **Safety Controls**: Maximum buy limits and exposure management
- **Multi-Platform Price Comparison**: Prevents bad fills and MEV attacks

## Usage

### Basic Operations

```bash
# Check SOL balance
/sol-balance

# Get airdrop on devnet for testing  
/sol-airdrop 2 devnet

# Transfer SOL
/sol-transfer <recipient-address> <amount>
```

### Advanced Trading

Use natural language commands:

```
"Buy 1 SOL worth of BONK on Raydium with 2% slippage"
"Set a limit order to sell my WIF when it hits $3.50"
"Monitor trending memecoins on PumpFun with market cap under 1M"
"Execute a DCA strategy buying 0.1 SOL of PEPE every hour"
```

### Available MCP Tools

**DEX Trading:**
- `swap_on_solana_dex` - Multi-DEX swap execution
- `get_solana_dex_quote` - Price comparison across platforms

**Limit Orders:**
- `create_solana_limit_order` - Set automated orders
- `get_solana_limit_orders` - Monitor order status
- `cancel_solana_limit_order` - Cancel pending orders

**Memecoin Analysis:**
- `get_pumpfun_trending` - Trending tokens with risk analysis
- `get_pumpfun_token` - Detailed token information
- `quick_buy_memecoin` - Instant purchases with risk controls
- `scan_new_memecoins` - AI-powered discovery and scoring

Built for professional memecoin trading with institutional-grade execution.