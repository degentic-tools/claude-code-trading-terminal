#!/usr/bin/env node
// Solana Balance Slash Command
import "dotenv/config";
import { ToolService } from '../src/toolService.js';
import { AG_URL } from '../src/constants.js';

async function main() {
  try {
    const toolService = new ToolService(
      AG_URL,
      process.env.USER_PRIVATE_KEY,
      process.env.USER_ADDRESS,
      process.env.COINGECKO_API_KEY,
      process.env.ALCHEMY_API_KEY,
      process.env.SOLANA_PRIVATE_KEY
    );

    const address = process.argv[2];
    const cluster = process.argv[3] || 'mainnet-beta';

    console.log(`🔍 Checking SOL balance${address ? ` for ${address}` : ''} on ${cluster}...`);
    
    const result = await toolService.getSolanaBalance({ address, cluster });
    
    console.log('✅ Balance Retrieved:');
    console.log(`Address: ${result.data.address}`);
    console.log(`Balance: ${result.data.balanceSOL} SOL`);
    console.log(`Lamports: ${result.data.balance}`);
    console.log(`Cluster: ${result.data.cluster}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();