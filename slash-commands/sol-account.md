# Solana Account Info

Get detailed information about a Solana account.

## Usage

```bash
/sol-account <address> [cluster]
```

## Parameters

- `address` (required): Solana account address to query
- `cluster` (optional): Solana cluster. Options: mainnet-beta (default), devnet, testnet

## Examples

```bash
# Check account info on mainnet
/sol-account 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

# Check account info on devnet
/sol-account 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU devnet
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

const address = process.argv[2];
const cluster = process.argv[3] || 'mainnet-beta';

if (!address) {
  console.error('Error: account address is required');
  process.exit(1);
}

const result = await toolService.getSolanaAccountInfo({ address, cluster });
console.log(JSON.stringify(result, null, 2));
```