# Transfer SOL

Send SOL to another Solana address.

## Usage

```bash
/sol-transfer <recipient> <amount> [cluster]
```

## Parameters

- `recipient` (required): Recipient's Solana wallet address
- `amount` (required): Amount of SOL to transfer (e.g., 0.1, 1.5)
- `cluster` (optional): Solana cluster. Options: mainnet-beta (default), devnet, testnet

## Examples

```bash
# Send 0.1 SOL on mainnet
/sol-transfer 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 0.1

# Send 1 SOL on devnet
/sol-transfer 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 1 devnet
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

const toAddress = process.argv[2];
const amount = parseFloat(process.argv[3]);
const cluster = process.argv[4] || 'mainnet-beta';

if (!toAddress || !amount) {
  console.error('Error: recipient address and amount are required');
  process.exit(1);
}

const result = await toolService.transferSOL({ toAddress, amount, cluster });
console.log(JSON.stringify(result, null, 2));
```