#!/usr/bin/env node
// Solana Account Info Slash Command
import "dotenv/config";
import { ToolService } from '../src/toolService.js';
import { AG_URL } from '../src/constants.js';

async function main() {
  try {
    const address = process.argv[2];
    const cluster = process.argv[3] || 'mainnet-beta';

    if (!address) {
      console.error('❌ Error: account address is required');
      console.log('Usage: /sol-account <address> [cluster]');
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

    console.log(`🔍 Checking account info for ${address} on ${cluster}...`);
    
    const result = await toolService.getSolanaAccountInfo({ address, cluster });
    
    if (result.data.exists) {
      console.log('✅ Account Found:');
      console.log(`Address: ${result.data.address}`);
      console.log(`Balance: ${result.data.lamports} lamports`);
      console.log(`Owner: ${result.data.owner}`);
      console.log(`Executable: ${result.data.executable}`);
      console.log(`Rent Epoch: ${result.data.rentEpoch}`);
      console.log(`Data Size: ${result.data.space} bytes`);
    } else {
      console.log('ℹ️ Account does not exist');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();