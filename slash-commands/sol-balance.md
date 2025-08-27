# Check Solana Balance

Check SOL balance for your wallet or any Solana address.

## Usage

```bash
/sol-balance [address] [cluster]
```

## Parameters

- `address` (optional): Solana wallet address to check. If not provided, uses your configured wallet.
- `cluster` (optional): Solana cluster to query. Options: mainnet-beta (default), devnet, testnet

## Examples

```bash
# Check your own wallet balance on mainnet
/sol-balance

# Check your wallet balance on devnet
/sol-balance "" devnet

# Check specific address on mainnet
/sol-balance 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

# Check specific address on devnet
/sol-balance 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU devnet
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

const result = await toolService.getSolanaBalance({ address, cluster });
console.log(JSON.stringify(result, null, 2));
```