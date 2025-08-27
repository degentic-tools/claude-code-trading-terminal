#!/usr/bin/env node
// Solana Transfer Slash Command
import "dotenv/config";
import { ToolService } from '../src/toolService.js';
import { AG_URL } from '../src/constants.js';

async function main() {
  try {
    const toAddress = process.argv[2];
    const amount = parseFloat(process.argv[3]);
    const cluster = process.argv[4] || 'mainnet-beta';

    if (!toAddress || !amount) {
      console.error('❌ Error: recipient address and amount are required');
      console.log('Usage: /sol-transfer <recipient> <amount> [cluster]');
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

    console.log(`🚀 Sending ${amount} SOL to ${toAddress} on ${cluster}...`);
    
    const result = await toolService.transferSOL({ toAddress, amount, cluster });
    
    console.log('✅ Transfer Completed:');
    console.log(`From: ${result.data.from}`);
    console.log(`To: ${result.data.to}`);
    console.log(`Amount: ${result.data.amount} SOL`);
    console.log(`Transaction: ${result.data.signature}`);
    console.log(`Status: ${result.data.status}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();