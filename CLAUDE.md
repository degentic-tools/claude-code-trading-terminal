# CLAUDE.md

This file provides guidance to Claude Code when working with the DeFi Trading MCP repository.

## Setup Instructions

This repository contains a DeFi Trading MCP (Model Context Protocol) server that transforms AI assistants into autonomous crypto trading agents.

### Prerequisites
- Node.js >= 18.0.0
- npm or yarn package manager

### Installation
```bash
npm install
```

### Claude Code Integration

The MCP has been configured for Claude Code with placeholder environment variables. To use with real trading:

1. **Update environment variables** in Claude Code configuration:
   ```bash
   claude mcp remove defi-trading
   claude mcp add defi-trading \
     -e USER_PRIVATE_KEY=your_actual_private_key \
     -e USER_ADDRESS=0xYourActualWalletAddress \
     -e COINGECKO_API_KEY=CG-your_actual_coingecko_api_key \
     -e ALCHEMY_API_KEY=your_actual_alchemy_api_key \
     -e SOLANA_PRIVATE_KEY=your_solana_private_key_base58_or_array \
     -- npx defi-trading-mcp
   ```

   Note: SOLANA_PRIVATE_KEY can be in base58 format, hex format (128 chars), or JSON array format (e.g., "[1,2,3,...]")

2. **Verify setup**:
   ```bash
   claude mcp list
   ```

### Testing the MCP Server
```bash
# Test server startup (should show provider initialization for 17+ chains)
npx defi-trading-mcp

# Check if server can be reached by Claude Code
claude mcp list
```

### Security Notes
- Private keys remain on your device and are never transmitted
- All transaction signing happens locally
- Uses MEV protection for Ethereum transactions
- Supports gasless trading to save on gas costs

### Supported Features
- Portfolio management across 17+ EVM blockchain networks
- **Solana blockchain integration** - native SOL transfers, account queries, transaction tracking
- Real-time market analysis and trending pool detection
- Technical analysis with OHLCV data
- Autonomous trading with risk management
- Gasless swap execution
- Multi-chain arbitrage detection

## Important Commands
- `npm start`: Start the MCP server
- `npm test`: Run tests
- `npm run setup`: Interactive setup wizard
- `npm run setup:dev`: Development setup

## Environment Variables Required
- `USER_PRIVATE_KEY`: Your EVM wallet's private key (for transaction signing)
- `USER_ADDRESS`: Your Ethereum wallet address  
- `COINGECKO_API_KEY`: CoinGecko API key for market data
- `ALCHEMY_API_KEY`: (Optional) Alchemy API key for premium RPCs
- `SOLANA_PRIVATE_KEY`: (Optional) Your Solana wallet's private key for SOL operations

⚠️ **Security Warning**: Never commit real private keys or API keys to version control.