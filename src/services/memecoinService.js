// src/services/memecoinService.js
import fetch from "node-fetch";

export class MemecoinService {
  constructor(solanaService, dexService) {
    this.solanaService = solanaService;
    this.dexService = dexService;
    this.pumpFunApi = "https://frontend-api.pump.fun";
    this.dexScreenerApi = "https://api.dexscreener.com/latest/dex";
    this.birdsEyeApi = "https://public-api.birdeye.so";
    this.jupiterApi = "https://quote-api.jup.ag/v6";
    
    // Risk thresholds for memecoin trading
    this.riskThresholds = {
      lowRisk: {
        minMarketCap: 100000, // $100k
        minHolders: 100,
        maxBuyAmount: 0.5, // SOL
        slippage: 300 // 3%
      },
      mediumRisk: {
        minMarketCap: 10000, // $10k
        minHolders: 50,
        maxBuyAmount: 1.0, // SOL
        slippage: 500 // 5%
      },
      highRisk: {
        minMarketCap: 1000, // $1k
        minHolders: 10,
        maxBuyAmount: 2.0, // SOL
        slippage: 1000 // 10%
      }
    };
  }

  // PumpFun Integration
  async getPumpFunTrending(limit = 50, sortBy = 'created_timestamp', includeNsfw = false) {
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        sort: sortBy,
        includeNsfw: includeNsfw.toString()
      });

      const response = await fetch(`${this.pumpFunApi}/coins/trending?${params}`);
      
      if (!response.ok) {
        throw new Error(`PumpFun API error: ${response.statusText}`);
      }
      
      const coins = await response.json();
      
      return {
        trending: coins.map(coin => ({
          mint: coin.mint,
          name: coin.name,
          symbol: coin.symbol,
          description: coin.description,
          image: coin.image_uri,
          marketCap: coin.market_cap,
          volume24h: coin.volume_24h,
          priceChange24h: coin.price_change_24h,
          holders: coin.holder_count,
          createdAt: new Date(coin.created_timestamp * 1000).toISOString(),
          bondingCurveProgress: coin.bonding_curve_progress,
          complete: coin.complete,
          riskLevel: this.assessRiskLevel(coin),
          platform: "PumpFun"
        })),
        count: coins.length,
        platform: "PumpFun"
      };
    } catch (error) {
      throw new Error(`Failed to get PumpFun trending: ${error.message}`);
    }
  }

  async getPumpFunToken(mintAddress) {
    try {
      const response = await fetch(`${this.pumpFunApi}/coins/${mintAddress}`);
      
      if (!response.ok) {
        throw new Error(`PumpFun token API error: ${response.statusText}`);
      }
      
      const coin = await response.json();
      
      return {
        mint: coin.mint,
        name: coin.name,
        symbol: coin.symbol,
        description: coin.description,
        image: coin.image_uri,
        marketCap: coin.market_cap,
        volume24h: coin.volume_24h,
        priceChange24h: coin.price_change_24h,
        holders: coin.holder_count,
        createdAt: new Date(coin.created_timestamp * 1000).toISOString(),
        bondingCurveProgress: coin.bonding_curve_progress,
        complete: coin.complete,
        creator: coin.creator,
        riskLevel: this.assessRiskLevel(coin),
        tradingRecommendation: this.getTradingRecommendation(coin),
        platform: "PumpFun"
      };
    } catch (error) {
      throw new Error(`Failed to get PumpFun token: ${error.message}`);
    }
  }

  // DEX Screener Integration for broader memecoin analysis
  async getMemecoinsByMarketCap(chainId = 'solana', minMarketCap = 10000, limit = 50) {
    try {
      const response = await fetch(`${this.dexScreenerApi}/search/?q=chainId:${chainId} marketCap:[${minMarketCap} TO *]&limit=${limit}`);
      
      if (!response.ok) {
        throw new Error(`DEX Screener API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      return {
        pairs: data.pairs?.map(pair => ({
          address: pair.baseToken.address,
          name: pair.baseToken.name,
          symbol: pair.baseToken.symbol,
          price: pair.priceUsd,
          marketCap: pair.fdv || pair.marketCap,
          volume24h: pair.volume?.h24,
          priceChange24h: pair.priceChange?.h24,
          liquidity: pair.liquidity?.usd,
          dexId: pair.dexId,
          pairAddress: pair.pairAddress,
          riskLevel: this.assessRiskLevel({
            market_cap: pair.fdv || pair.marketCap,
            volume_24h: pair.volume?.h24,
            holder_count: null // Not available from DEX Screener
          }),
          platform: "DEX Screener"
        })) || [],
        count: data.pairs?.length || 0
      };
    } catch (error) {
      throw new Error(`Failed to get memecoins by market cap: ${error.message}`);
    }
  }

  // Risk Assessment
  assessRiskLevel(coin) {
    const marketCap = coin.market_cap || coin.fdv || 0;
    const holders = coin.holder_count || 0;
    const volume24h = coin.volume_24h || coin.volume?.h24 || 0;

    if (marketCap >= this.riskThresholds.lowRisk.minMarketCap && 
        holders >= this.riskThresholds.lowRisk.minHolders) {
      return 'low';
    } else if (marketCap >= this.riskThresholds.mediumRisk.minMarketCap && 
               holders >= this.riskThresholds.mediumRisk.minHolders) {
      return 'medium';
    } else {
      return 'high';
    }
  }

  getTradingRecommendation(coin) {
    const riskLevel = this.assessRiskLevel(coin);
    const thresholds = this.riskThresholds[riskLevel];
    
    const recommendation = {
      riskLevel,
      maxBuyAmount: thresholds.maxBuyAmount,
      recommendedSlippage: thresholds.slippage / 100, // Convert to percentage
      warnings: [],
      suggestions: []
    };

    // Add specific warnings and suggestions
    if (coin.created_timestamp && (Date.now() - coin.created_timestamp * 1000) < 3600000) { // Less than 1 hour old
      recommendation.warnings.push("Token is less than 1 hour old - extremely high risk");
    }

    if (coin.holder_count && coin.holder_count < 20) {
      recommendation.warnings.push("Very low holder count - high rug risk");
    }

    if (coin.bonding_curve_progress && coin.bonding_curve_progress < 10) {
      recommendation.warnings.push("Low bonding curve progress - token might not have enough liquidity");
    }

    if (!coin.complete && coin.bonding_curve_progress > 80) {
      recommendation.suggestions.push("Close to completing bonding curve - potential upside if it graduates");
    }

    if (coin.volume_24h && coin.market_cap && (coin.volume_24h / coin.market_cap) > 1) {
      recommendation.suggestions.push("High volume/marketcap ratio - active trading");
    }

    return recommendation;
  }

  // Quick Buy Function for Memecoins
  async quickBuyMemecoin(params) {
    const {
      tokenAddress,
      solAmount,
      riskLevel = 'medium',
      maxSlippage = null
    } = params;

    try {
      // Get token info first
      let tokenInfo;
      try {
        tokenInfo = await this.getPumpFunToken(tokenAddress);
      } catch {
        // Fallback to basic DEX info
        tokenInfo = { mint: tokenAddress, riskLevel: riskLevel };
      }

      const thresholds = this.riskThresholds[riskLevel];
      const actualSlippage = maxSlippage || thresholds.slippage;

      // Safety checks
      if (solAmount > thresholds.maxBuyAmount) {
        throw new Error(`Amount ${solAmount} SOL exceeds ${riskLevel} risk limit of ${thresholds.maxBuyAmount} SOL`);
      }

      // Get quote from best DEX
      const solMint = this.dexService.getTokenAddress('SOL');
      const amount = this.dexService.formatAmount(solAmount);
      
      const { bestQuote } = await this.dexService.getBestQuote(
        solMint,
        tokenAddress,
        amount,
        actualSlippage
      );

      console.log(`🎯 Quick buying ${tokenInfo.symbol || 'MEMECOIN'} on ${bestQuote.platform}`);

      // Execute the swap
      const result = await this.dexService.executeSwapOnBestDex(
        solMint,
        tokenAddress,
        amount,
        actualSlippage,
        0.002 // Higher priority fee for memecoins
      );

      return {
        ...result,
        tokenInfo: {
          name: tokenInfo.name,
          symbol: tokenInfo.symbol,
          riskLevel: tokenInfo.riskLevel
        },
        tradingParams: {
          solAmount,
          slippage: actualSlippage / 100,
          riskLevel
        }
      };
    } catch (error) {
      throw new Error(`Quick buy failed: ${error.message}`);
    }
  }

  // Advanced Memecoin Scanner
  async scanNewMemecoins(filters = {}) {
    const {
      maxAgeHours = 24,
      minMarketCap = 5000,
      maxMarketCap = 1000000,
      minHolders = 10,
      riskLevels = ['medium', 'high']
    } = filters;

    try {
      // Get trending from PumpFun
      const pumpFunTrending = await this.getPumpFunTrending(100);
      
      // Filter by age
      const cutoffTime = Date.now() - (maxAgeHours * 3600000);
      const recentCoins = pumpFunTrending.trending.filter(coin => {
        const coinTime = new Date(coin.createdAt).getTime();
        return coinTime > cutoffTime &&
               coin.marketCap >= minMarketCap &&
               coin.marketCap <= maxMarketCap &&
               coin.holders >= minHolders &&
               riskLevels.includes(coin.riskLevel);
      });

      // Sort by potential (you can customize this logic)
      const scoredCoins = recentCoins.map(coin => ({
        ...coin,
        potentialScore: this.calculatePotentialScore(coin)
      })).sort((a, b) => b.potentialScore - a.potentialScore);

      return {
        coins: scoredCoins,
        count: scoredCoins.length,
        filters: filters,
        scanTime: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Memecoin scan failed: ${error.message}`);
    }
  }

  calculatePotentialScore(coin) {
    let score = 0;

    // Market cap scoring (sweet spot around 50k-500k)
    if (coin.marketCap > 50000 && coin.marketCap < 500000) {
      score += 30;
    } else if (coin.marketCap > 10000 && coin.marketCap < 50000) {
      score += 20;
    }

    // Holder count scoring
    if (coin.holders > 100) score += 25;
    else if (coin.holders > 50) score += 15;
    else if (coin.holders > 20) score += 10;

    // Volume/MarketCap ratio
    const volumeRatio = coin.volume24h / coin.marketCap;
    if (volumeRatio > 0.5) score += 20;
    else if (volumeRatio > 0.2) score += 10;

    // Bonding curve progress (PumpFun specific)
    if (coin.bondingCurveProgress > 50 && !coin.complete) {
      score += 15;
    }

    // 24h price change (positive momentum)
    if (coin.priceChange24h > 50) score += 20;
    else if (coin.priceChange24h > 20) score += 10;
    else if (coin.priceChange24h > 0) score += 5;

    // Age factor (not too new, not too old)
    const ageHours = (Date.now() - new Date(coin.createdAt).getTime()) / 3600000;
    if (ageHours > 2 && ageHours < 48) score += 10;

    return score;
  }

  // Portfolio Tracking for Memecoins
  async getMemecoinPortfolio() {
    try {
      if (!this.solanaService.keypair) {
        throw new Error("Wallet not configured");
      }

      const walletAddress = this.solanaService.getWalletAddress();
      
      // Get token balances (you would need to implement this or use existing portfolio tools)
      // For now, return a placeholder structure
      return {
        walletAddress,
        memecoins: [], // Would be populated with actual balances
        totalValue: 0,
        lastUpdated: new Date().toISOString(),
        note: "Portfolio tracking implementation needed"
      };
    } catch (error) {
      throw new Error(`Portfolio retrieval failed: ${error.message}`);
    }
  }

  // DCA (Dollar Cost Averaging) for Memecoins
  async createMemecoinDCA(params) {
    const {
      tokenAddress,
      solAmountPerBuy,
      intervalMinutes = 60,
      totalBuys = 10,
      riskLevel = 'medium'
    } = params;

    try {
      const dcaId = `dca_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Validate parameters
      const thresholds = this.riskThresholds[riskLevel];
      if (solAmountPerBuy > thresholds.maxBuyAmount) {
        throw new Error(`Per-buy amount exceeds ${riskLevel} risk limit`);
      }

      // This would need to be implemented with a job scheduler
      const dcaOrder = {
        id: dcaId,
        tokenAddress,
        solAmountPerBuy,
        intervalMinutes,
        totalBuys,
        buysMade: 0,
        status: 'active',
        createdAt: Date.now(),
        riskLevel,
        nextBuyAt: Date.now() + (intervalMinutes * 60 * 1000)
      };

      return {
        dcaId,
        order: dcaOrder,
        message: `DCA order created: ${totalBuys} buys of ${solAmountPerBuy} SOL every ${intervalMinutes} minutes`,
        note: "DCA execution requires background job implementation"
      };
    } catch (error) {
      throw new Error(`DCA creation failed: ${error.message}`);
    }
  }
}