// src/services/solanaDexService.js
import { PublicKey, Transaction } from "@solana/web3.js";
import fetch from "node-fetch";
import bs58 from "bs58";

export class SolanaDexService {
  constructor(solanaService, apiKeys = {}) {
    this.solanaService = solanaService;
    this.jupiterApiUrl = "https://quote-api.jup.ag/v6";
    this.raydiumApiUrl = "https://transaction-v1.raydium.io";
    this.meteoraApiUrl = "https://api.meteora.ag";
    this.pumpFunApiUrl = "https://frontend-api.pump.fun";
    this.apiKeys = apiKeys;
    
    // Common token addresses on Solana
    this.commonTokens = {
      SOL: "So11111111111111111111111111111111111111112",
      USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 
      USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
      PEPE: "BzKR4NKT8xLF44EzntPKjAuJsxKkVJrEeE8EFkuUXqsL",
      JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    };
  }

  // Jupiter Aggregator Integration
  async getJupiterQuote(inputMint, outputMint, amount, slippageBps = 50) {
    try {
      const params = new URLSearchParams({
        inputMint,
        outputMint, 
        amount: amount.toString(),
        slippageBps: slippageBps.toString(),
        onlyDirectRoutes: "false",
        asLegacyTransaction: "false"
      });

      const response = await fetch(`${this.jupiterApiUrl}/quote?${params}`);
      const quote = await response.json();

      if (!response.ok) {
        throw new Error(`Jupiter quote failed: ${quote.error || 'Unknown error'}`);
      }

      return {
        inputMint,
        outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        otherAmountThreshold: quote.otherAmountThreshold,
        swapMode: quote.swapMode,
        slippageBps,
        priceImpactPct: quote.priceImpactPct,
        routePlan: quote.routePlan,
        contextSlot: quote.contextSlot,
        timeTaken: quote.timeTaken,
        platform: "Jupiter"
      };
    } catch (error) {
      throw new Error(`Jupiter quote error: ${error.message}`);
    }
  }

  async executeJupiterSwap(quote, priorityFee = 0.001) {
    try {
      if (!this.solanaService.keypair) {
        throw new Error("Wallet not configured for trading");
      }

      // Get swap transaction from Jupiter
      const swapResponse = await fetch(`${this.jupiterApiUrl}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPublicKey: this.solanaService.getWalletAddress(),
          quoteResponse: quote,
          config: {
            wrapAndUnwrapSol: true,
            feeAccount: null,
            computeUnitPriceMicroLamports: Math.floor(priorityFee * 1_000_000),
            prioritizationFeeLamports: Math.floor(priorityFee * 1_000_000_000),
            asLegacyTransaction: false,
            useSharedAccounts: true,
            maxAccounts: 64
          }
        })
      });

      const swapData = await swapResponse.json();
      if (!swapResponse.ok) {
        throw new Error(`Jupiter swap preparation failed: ${swapData.error}`);
      }

      // Deserialize and sign transaction
      const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
      const transaction = Transaction.from(swapTransactionBuf);
      
      // Sign transaction
      transaction.sign(this.solanaService.keypair);
      
      // Send transaction
      const connection = this.solanaService.getConnection('mainnet-beta');
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 3
      });

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      return {
        signature,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        platform: "Jupiter",
        status: "confirmed"
      };
    } catch (error) {
      throw new Error(`Jupiter swap execution failed: ${error.message}`);
    }
  }

  // Raydium Integration
  async getRaydiumQuote(inputToken, outputToken, amount, slippage = 1) {
    try {
      const params = new URLSearchParams({
        inputMint: inputToken,
        outputMint: outputToken,
        amount: amount.toString(),
        slippageBps: (slippage * 100).toString(),
        txVersion: "V0"
      });

      const response = await fetch(`${this.raydiumApiUrl}/compute/swap-base-in?${params}`);
      const quote = await response.json();

      if (!response.ok) {
        throw new Error(`Raydium quote failed: ${quote.error || 'Unknown error'}`);
      }

      return {
        inputMint: inputToken,
        outputMint: outputToken,
        inAmount: amount.toString(),
        outAmount: quote.data.outAmount,
        minAmountOut: quote.data.minAmountOut,
        currentPrice: quote.data.currentPrice,
        executionPrice: quote.data.executionPrice,
        priceImpactPct: quote.data.priceImpactPct,
        fee: quote.data.fee,
        routePlan: quote.data.routePlan,
        platform: "Raydium"
      };
    } catch (error) {
      throw new Error(`Raydium quote error: ${error.message}`);
    }
  }

  async executeRaydiumSwap(quote, priorityFee = 0.001) {
    try {
      if (!this.solanaService.keypair) {
        throw new Error("Wallet not configured for trading");
      }

      const swapResponse = await fetch(`${this.raydiumApiUrl}/transaction/swap-base-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          computeUnitPriceMicroLamports: Math.floor(priorityFee * 1_000_000),
          swapRequest: {
            inputMint: quote.inputMint,
            outputMint: quote.outputMint,
            amount: quote.inAmount,
            slippageBps: quote.slippageBps || 100,
            txVersion: "V0"
          }
        })
      });

      const swapData = await swapResponse.json();
      if (!swapResponse.ok) {
        throw new Error(`Raydium swap preparation failed: ${swapData.error}`);
      }

      // Execute transaction (similar to Jupiter but with Raydium-specific handling)
      const swapTransactionBuf = Buffer.from(swapData.transaction, 'base64');
      const transaction = Transaction.from(swapTransactionBuf);
      
      transaction.sign(this.solanaService.keypair);
      
      const connection = this.solanaService.getConnection('mainnet-beta');
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 3
      });

      await connection.confirmTransaction(signature, 'confirmed');

      return {
        signature,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        platform: "Raydium",
        status: "confirmed"
      };
    } catch (error) {
      throw new Error(`Raydium swap execution failed: ${error.message}`);
    }
  }

  // Meteora Integration (specialized for memecoins)
  async getMeteoraQuote(inputToken, outputToken, amount) {
    try {
      // Meteora API integration for memecoin-optimized swaps
      const response = await fetch(`${this.meteoraApiUrl}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputMint: inputToken,
          outputMint: outputToken,
          amount: amount.toString(),
          slippageTolerance: 0.05, // 5% slippage for memecoins
        })
      });

      const quote = await response.json();
      
      if (!response.ok) {
        throw new Error(`Meteora quote failed: ${quote.error || 'Unknown error'}`);
      }

      return {
        inputMint: inputToken,
        outputMint: outputToken,
        inAmount: amount.toString(),
        outAmount: quote.outAmount,
        priceImpact: quote.priceImpact,
        fee: quote.fee,
        route: quote.route,
        platform: "Meteora"
      };
    } catch (error) {
      // If Meteora API is not available, fallback to Jupiter
      console.warn(`Meteora API unavailable, falling back to Jupiter: ${error.message}`);
      return await this.getJupiterQuote(inputToken, outputToken, amount, 500); // 5% slippage
    }
  }

  // PumpFun Integration (for new token launches)
  async getPumpFunTrending(limit = 50) {
    try {
      const response = await fetch(`${this.pumpFunApiUrl}/coins/trending?limit=${limit}`);
      const data = await response.json();
      
      return {
        trending: data.map(coin => ({
          mint: coin.mint,
          name: coin.name,
          symbol: coin.symbol,
          description: coin.description,
          image: coin.image,
          marketCap: coin.market_cap,
          volume24h: coin.volume_24h,
          priceChange24h: coin.price_change_24h,
          createdAt: coin.created_timestamp,
          platform: "PumpFun"
        })),
        platform: "PumpFun"
      };
    } catch (error) {
      throw new Error(`PumpFun trending fetch failed: ${error.message}`);
    }
  }

  async getPumpFunTokenInfo(mintAddress) {
    try {
      const response = await fetch(`${this.pumpFunApiUrl}/coins/${mintAddress}`);
      const coin = await response.json();
      
      return {
        mint: coin.mint,
        name: coin.name,
        symbol: coin.symbol,
        description: coin.description,
        image: coin.image,
        marketCap: coin.market_cap,
        volume24h: coin.volume_24h,
        holders: coin.holder_count,
        progress: coin.bonding_curve_progress,
        complete: coin.complete,
        platform: "PumpFun"
      };
    } catch (error) {
      throw new Error(`PumpFun token info failed: ${error.message}`);
    }
  }

  // Multi-DEX Price Comparison
  async getBestQuote(inputToken, outputToken, amount, slippageBps = 50) {
    try {
      const quotes = await Promise.allSettled([
        this.getJupiterQuote(inputToken, outputToken, amount, slippageBps),
        this.getRaydiumQuote(inputToken, outputToken, amount, slippageBps / 100),
        this.getMeteoraQuote(inputToken, outputToken, amount)
      ]);

      const validQuotes = quotes
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);

      if (validQuotes.length === 0) {
        throw new Error('No valid quotes available from any DEX');
      }

      // Find best quote by output amount
      const bestQuote = validQuotes.reduce((best, current) => {
        const currentOut = parseInt(current.outAmount || current.outAmount);
        const bestOut = parseInt(best.outAmount || best.outAmount);
        return currentOut > bestOut ? current : best;
      });

      return {
        bestQuote,
        allQuotes: validQuotes,
        comparison: validQuotes.map(quote => ({
          platform: quote.platform,
          outAmount: quote.outAmount,
          priceImpact: quote.priceImpactPct || quote.priceImpact,
        }))
      };
    } catch (error) {
      throw new Error(`Multi-DEX quote comparison failed: ${error.message}`);
    }
  }

  // Execute swap on best DEX
  async executeSwapOnBestDex(inputToken, outputToken, amount, slippageBps = 50, priorityFee = 0.001) {
    try {
      const { bestQuote } = await this.getBestQuote(inputToken, outputToken, amount, slippageBps);
      
      console.log(`🚀 Executing swap on ${bestQuote.platform} for best price`);
      
      switch (bestQuote.platform) {
        case "Jupiter":
          return await this.executeJupiterSwap(bestQuote, priorityFee);
        case "Raydium":
          return await this.executeRaydiumSwap(bestQuote, priorityFee);
        case "Meteora":
          // Fallback to Jupiter for execution since Meteora execution may not be implemented
          return await this.executeJupiterSwap(bestQuote, priorityFee);
        default:
          throw new Error(`Unknown platform: ${bestQuote.platform}`);
      }
    } catch (error) {
      throw new Error(`Best DEX swap execution failed: ${error.message}`);
    }
  }

  // Utility functions
  getTokenAddress(symbol) {
    return this.commonTokens[symbol.toUpperCase()] || symbol;
  }

  formatAmount(amount, decimals = 9) {
    return Math.floor(parseFloat(amount) * Math.pow(10, decimals));
  }

  formatPrice(lamports, decimals = 9) {
    return parseFloat(lamports) / Math.pow(10, decimals);
  }
}