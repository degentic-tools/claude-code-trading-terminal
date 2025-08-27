# Solana Wallet Info

Display your configured Solana wallet address and supported clusters.

## Usage

```bash
/sol-wallet [info]
```

## Parameters

- `info` (optional): Set to "clusters" to show supported clusters instead of wallet address

## Examples

```bash
# Show wallet address
/sol-wallet

# Show supported clusters
/sol-wallet clusters
```

## Implementation

```javascript
import { ToolService } from '../src/toolService.js';

const toolService = new ToolService(
  process.env.AG_URL,
  process.env.USER_PRIVATE_KEY,
  process.env.USER_ADDRESS,
  process.env.COINGECKO_API_KEY,
  process.env.ALCHEMY_API_KEY,
  process.env.SOLANA_PRIVATE_KEY
);

const showInfo = process.argv[2];

const result = showInfo === 'clusters'
  ? await toolService.getSolanaSupportedClusters()
  : toolService.getSolanaWalletAddress();

console.log(JSON.stringify(result, null, 2));
```