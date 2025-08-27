#!/usr/bin/env node
// Solana Transaction Slash Command
import "dotenv/config";
import { ToolService } from '../src/toolService.js';
import { AG_URL } from '../src/constants.js';

async function main() {
  try {
    const signature = process.argv[2];
    const cluster = process.argv[3] || 'mainnet-beta';
    const showDetails = process.argv[4] === 'true';

    if (!signature) {
      console.error('❌ Error: transaction signature is required');
      console.log('Usage: /sol-tx <signature> [cluster] [details]');
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

    console.log(`🔍 Checking transaction ${signature} on ${cluster}...`);
    
    const result = showDetails 
      ? await toolService.getSolanaTransactionDetails({ signature, cluster })
      : await toolService.getSolanaTransactionStatus({ signature, cluster });
    
    if (showDetails && result.data.found) {
      console.log('✅ Transaction Details:');
      console.log(`Signature: ${result.data.signature}`);
      console.log(`Slot: ${result.data.slot}`);
      console.log(`Block Time: ${result.data.blockTime ? new Date(result.data.blockTime * 1000).toISOString() : 'Unknown'}`);
      console.log(`Success: ${result.data.success}`);
      console.log(`Fee: ${result.data.fee} lamports`);
      if (result.data.error) {
        console.log(`Error: ${result.data.error}`);
      }
    } else if (!showDetails) {
      console.log('✅ Transaction Status:');
      console.log(`Signature: ${result.data.signature}`);
      console.log(`Status: ${result.data.status}`);
      if (result.data.confirmations) {
        console.log(`Confirmations: ${result.data.confirmations}`);
      }
      if (result.data.error) {
        console.log(`Error: ${result.data.error}`);
      }
    } else {
      console.log('❌ Transaction not found');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();