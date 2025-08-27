# SOL Airdrop

Request SOL airdrop on devnet or testnet for testing purposes.

## Usage

```bash
/sol-airdrop [amount] [cluster]
```

## Parameters

- `amount` (optional): Amount of SOL to airdrop. Default: 1
- `cluster` (optional): Solana cluster. Options: devnet (default), testnet. Note: mainnet airdrops not available.

## Examples

```bash
# Request 1 SOL on devnet
/sol-airdrop

# Request 2 SOL on devnet
/sol-airdrop 2

# Request 1 SOL on testnet
/sol-airdrop 1 testnet
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

const amount = parseFloat(process.argv[2]) || 1;
const cluster = process.argv[3] || 'devnet';

if (cluster === 'mainnet-beta') {
  console.error('Error: Airdrop not available on mainnet-beta');
  process.exit(1);
}

const result = await toolService.airdropSOL({ amount, cluster });
console.log(JSON.stringify(result, null, 2));
```