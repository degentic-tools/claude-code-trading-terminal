# Solana Slash Commands

This directory contains slash commands for interacting with Solana blockchain through your defi-trading-mcp.

## Available Commands

### 💰 `/sol-balance` - Check SOL Balance
Check SOL balance for your wallet or any address.

```bash
node sol-balance.js [address] [cluster]
```

### 🚀 `/sol-transfer` - Transfer SOL
Send SOL to another address.

```bash
node sol-transfer.js <recipient> <amount> [cluster]
```

### 🪂 `/sol-airdrop` - Request Airdrop
Get free SOL on devnet/testnet.

```bash
node sol-airdrop.js [amount] [cluster]
```

### 📋 `/sol-account` - Account Info
Get detailed account information.

```bash
node sol-account.js <address> [cluster]
```

### 🔍 `/sol-tx` - Transaction Info
Check transaction status or get details.

```bash
node sol-tx.js <signature> [cluster] [details]
```

### 👛 `/sol-wallet` - Wallet Info
Show your wallet address or supported clusters.

```bash
node sol-wallet.js [clusters]
```

## Setup

1. Make sure your environment is configured with `SOLANA_PRIVATE_KEY`
2. All scripts are executable and can be run directly

## Examples

```bash
# Check your balance on devnet
node sol-balance.js "" devnet

# Get 2 SOL airdrop on devnet
node sol-airdrop.js 2 devnet

# Send 0.1 SOL to another address on devnet
node sol-transfer.js 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.1 devnet

# Check your wallet address
node sol-wallet.js

# See supported clusters
node sol-wallet.js clusters
```

## Integration with Claude Code

These commands can be integrated into Claude Code as custom slash commands. Copy the `.js` files to your Claude Code slash commands directory or reference them in your Claude Code configuration.