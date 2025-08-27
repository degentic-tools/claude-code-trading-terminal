#!/usr/bin/env node
// Solana Wallet Info Slash Command
import "dotenv/config";
import { ToolService } from '../src/toolService.js';
import { AG_URL } from '../src/constants.js';

async function main() {
  try {
    const showInfo = process.argv[2];

    const toolService = new ToolService(
      AG_URL,
      process.env.USER_PRIVATE_KEY,
      process.env.USER_ADDRESS,
      process.env.COINGECKO_API_KEY,
      process.env.ALCHEMY_API_KEY,
      process.env.SOLANA_PRIVATE_KEY
    );

    if (showInfo === 'clusters') {
      console.log('🌐 Supported Solana Clusters:');
      const result = await toolService.getSolanaSupportedClusters();
      result.data.clusters.forEach(cluster => {
        console.log(`  • ${cluster}`);
      });
    } else {
      console.log('👛 Solana Wallet Info:');
      const result = toolService.getSolanaWalletAddress();
      
      if (result.data && result.data.address) {
        console.log(`Address: ${result.data.address}`);
        console.log('✅ Wallet configured and ready');
      } else {
        console.log('❌ No Solana wallet configured');
        console.log('Set SOLANA_PRIVATE_KEY environment variable to enable Solana functions');
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();