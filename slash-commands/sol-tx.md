# Solana Transaction Info

Get status and details of a Solana transaction.

## Usage

```bash
/sol-tx <signature> [cluster] [details]
```

## Parameters

- `signature` (required): Transaction signature to query
- `cluster` (optional): Solana cluster. Options: mainnet-beta (default), devnet, testnet
- `details` (optional): Set to "true" for detailed transaction info, otherwise shows status only

## Examples

```bash
# Check transaction status on mainnet
/sol-tx 2ZE7dhzJTmNw1zc8Cx2ykfMAuNQ4KykGvUhKqPnwzKD3F4v2FeVCYngKfpPTHdNfmJzEgJzZVCxhd2KqgHvDnhko

# Check detailed transaction info on devnet
/sol-tx 2ZE7dhzJTmNw1zc8Cx2ykfMAuNQ4KykGvUhKqPnwzKD3F4v2FeVCYngKfpPTHdNfmJzEgJzZVCxhd2KqgHvDnhko devnet true
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

const signature = process.argv[2];
const cluster = process.argv[3] || 'mainnet-beta';
const showDetails = process.argv[4] === 'true';

if (!signature) {
  console.error('Error: transaction signature is required');
  process.exit(1);
}

const result = showDetails 
  ? await toolService.getSolanaTransactionDetails({ signature, cluster })
  : await toolService.getSolanaTransactionStatus({ signature, cluster });

console.log(JSON.stringify(result, null, 2));
```