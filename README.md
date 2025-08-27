# Claude Code Trading Terminal

Agent-native trading terminal built on top of Claude Code. Deploy sub-agents that execute trades, monitor positions, and manage risk in parallel across unlimited wallets.

## Installation

```bash
npm install defi-trading-mcp
```

## Setup

Configure your trading agent in Claude Code:

```bash
claude mcp add trading-terminal \
  -e SOLANA_PRIVATE_KEY=your_solana_private_key_base58 \
  -e COINGECKO_API_KEY=your_coingecko_api_key \
  -- npx defi-trading-mcp
```

## Usage

### Basic Solana Operations

```bash
# Check SOL balance
/sol-balance

# Get airdrop on devnet for testing
/sol-airdrop 2 devnet

# Transfer SOL
/sol-transfer <recipient-address> <amount>
```

### Professional Trading

Use natural language to:

- **Swap tokens** on Raydium, Jupiter, Meteora
- **Set limit orders** for memecoins
- **Monitor positions** across multiple wallets
- **Execute advanced strategies** with risk management
- **Track PumpFun launches** and early opportunities

### Examples

```
"Buy 1 SOL worth of BONK on Raydium with 2% slippage"
"Set a limit order to sell my WIF when it hits $3.50"
"Monitor trending memecoins on PumpFun with market cap under 1M"
"Execute a DCA strategy buying 0.1 SOL of PEPE every hour"
```

Built for professional memecoin trading with institutional-grade execution.