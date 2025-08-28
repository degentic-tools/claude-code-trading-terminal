# Claude Code Trading Terminal

Agent-native trading terminal built on top of Claude Code. Deploy sub-agents that execute trades, monitor positions, and manage risk in parallel across unlimited wallets.

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