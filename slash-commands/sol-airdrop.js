#!/usr/bin/env node
// Solana Airdrop Slash Command
import "dotenv/config";
import { ToolService } from '../src/toolService.js';
import { AG_URL } from '../src/constants.js';

async function main() {
  try {
    const amount = parseFloat(process.argv[2]) || 1;
    const cluster = process.argv[3] || 'devnet';

    if (cluster === 'mainnet-beta') {
      console.error('❌ Error: Airdrop not available on mainnet-beta');
      console.log('Use devnet or testnet for airdrops');
      process.exit(1);
    }

    const toolService = new ToolService(
      AG_URL,
      process.env.USER_PRIVATE_KEY,
      process.env.USER_ADDRESS,
      process.env.COINGECKO_API_KEY,
      process.env.ALCHEMY_API_KEY,
      process.env.SOLANA_PRIVATE_KEY
    );

    console.log(`🪂 Requesting ${amount} SOL airdrop on ${cluster}...`);
    
    const result = await toolService.airdropSOL({ amount, cluster });
    
    console.log('✅ Airdrop Completed:');
    console.log(`Address: ${result.data.address}`);
    console.log(`Amount: ${result.data.amount} SOL`);
    console.log(`Transaction: ${result.data.signature}`);
    console.log(`Status: ${result.data.status}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();