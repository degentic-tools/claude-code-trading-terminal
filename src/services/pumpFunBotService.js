// src/services/pumpFunBotService.js
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as anchor from "@project-serum/anchor";
const { Program, AnchorProvider, web3, BN } = anchor;
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction 
} from "@solana/spl-token";
import fetch from "node-fetch";

export class PumpFunBotService {
  constructor(solanaService) {
    this.solanaService = solanaService;
    this.pumpFunProgramId = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
    this.wsConnection = null;
    this.isListening = false;
    this.eventCallbacks = new Map();
    this.tokenFilters = {
      minMarketCap: 0,
      maxMarketCap: Number.MAX_SAFE_INTEGER,
      creators: [],
      symbols: [],
      continuousTrading: false
    };
  }

  // WebSocket listener for new token launches
  async startListening(filters = {}) {
    if (this.isListening) {
      console.log("🔄 Already listening to PumpFun events");
      return;
    }

    this.tokenFilters = { ...this.tokenFilters, ...filters };
    const connection = this.solanaService.getConnection('mainnet-beta');
    
    console.log("🚀 Starting PumpFun bot - listening for new token launches...");
    
    this.wsConnection = connection.onLogs(
      this.pumpFunProgramId,
      async (logs, context) => {
        try {
          await this.processTokenLaunch(logs, context);
        } catch (error) {
          console.error("Error processing token launch:", error.message);
        }
      },
      "confirmed"
    );

    this.isListening = true;
    console.log("✅ PumpFun bot started - monitoring new token launches");
  }

  async stopListening() {
    if (!this.isListening) {
      return;
    }

    if (this.wsConnection) {
      await this.solanaService.getConnection('mainnet-beta').removeOnLogsListener(this.wsConnection);
      this.wsConnection = null;
    }

    this.isListening = false;
    console.log("⏸️ PumpFun bot stopped");
  }

  // Process detected token launches
  async processTokenLaunch(logs, context) {
    try {
      const tokenData = this.parseTokenCreationLogs(logs);
      if (!tokenData) {
        return;
      }

      console.log(`🎯 New token detected: ${tokenData.mint}`);

      // Fetch additional token information
      const tokenInfo = await this.fetchTokenInfo(tokenData.mint);
      if (!tokenInfo) {
        return;
      }

      // Apply filters
      if (!this.passesFilters(tokenInfo)) {
        console.log(`❌ Token ${tokenInfo.symbol} filtered out`);
        return;
      }

      console.log(`✅ Token ${tokenInfo.symbol} passed filters - notifying callbacks`);

      // Notify registered callbacks
      const eventData = {
        ...tokenData,
        ...tokenInfo,
        context,
        timestamp: Date.now()
      };

      for (const [eventType, callback] of this.eventCallbacks) {
        try {
          await callback(eventData);
        } catch (error) {
          console.error(`Error in ${eventType} callback:`, error.message);
        }
      }
    } catch (error) {
      console.error("Error in processTokenLaunch:", error.message);
    }
  }

  // Parse token creation from transaction logs
  parseTokenCreationLogs(logs) {
    try {
      // Look for specific log patterns that indicate token creation
      const creationLog = logs.logs.find(log => 
        log.includes("Program log: create") || 
        log.includes("mint:") ||
        log.includes("bonding_curve:")
      );

      if (!creationLog) {
        return null;
      }

      // Extract mint address and bonding curve from logs
      // This is a simplified parser - in production you'd want more robust parsing
      const mintMatch = creationLog.match(/mint:\s*([A-Za-z0-9]{32,44})/);
      const bondingCurveMatch = creationLog.match(/bonding_curve:\s*([A-Za-z0-9]{32,44})/);

      if (mintMatch) {
        return {
          mint: mintMatch[1],
          bondingCurve: bondingCurveMatch ? bondingCurveMatch[1] : null,
          signature: logs.signature
        };
      }

      return null;
    } catch (error) {
      console.error("Error parsing token creation logs:", error.message);
      return null;
    }
  }

  // Fetch token information from PumpFun API
  async fetchTokenInfo(mintAddress) {
    try {
      const response = await fetch(`https://frontend-api.pump.fun/coins/${mintAddress}`);
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return {
        mint: data.mint,
        name: data.name,
        symbol: data.symbol,
        description: data.description,
        image: data.image_uri,
        marketCap: data.market_cap,
        volume24h: data.volume_24h,
        holders: data.holder_count,
        creator: data.creator,
        bondingCurveProgress: data.bonding_curve_progress,
        complete: data.complete,
        createdAt: new Date(data.created_timestamp * 1000)
      };
    } catch (error) {
      console.error(`Error fetching token info for ${mintAddress}:`, error.message);
      return null;
    }
  }

  // Filter tokens based on criteria
  passesFilters(tokenInfo) {
    // Market cap filter
    if (tokenInfo.marketCap < this.tokenFilters.minMarketCap ||
        tokenInfo.marketCap > this.tokenFilters.maxMarketCap) {
      return false;
    }

    // Creator filter
    if (this.tokenFilters.creators.length > 0 && 
        !this.tokenFilters.creators.includes(tokenInfo.creator)) {
      return false;
    }

    // Symbol filter
    if (this.tokenFilters.symbols.length > 0 && 
        !this.tokenFilters.symbols.some(symbol => 
          tokenInfo.symbol.toLowerCase().includes(symbol.toLowerCase())
        )) {
      return false;
    }

    // Continuous trading filter
    if (this.tokenFilters.continuousTrading && !tokenInfo.complete) {
      return false;
    }

    return true;
  }

  // Register event callbacks
  onTokenLaunch(callback) {
    this.eventCallbacks.set('tokenLaunch', callback);
  }

  onFilteredToken(callback) {
    this.eventCallbacks.set('filteredToken', callback);
  }

  // Auto-buy functionality
  async autoBuyToken(tokenMint, solAmount, options = {}) {
    const {
      slippageBps = 1000, // 10% default slippage for new tokens
      priorityFee = 0.01, // 0.01 SOL priority fee
      maxRetries = 3
    } = options;

    try {
      console.log(`🚀 Auto-buying ${solAmount} SOL worth of ${tokenMint}`);

      // Get current token price and bonding curve
      const tokenInfo = await this.fetchTokenInfo(tokenMint);
      if (!tokenInfo) {
        throw new Error("Could not fetch token information");
      }

      // Calculate purchase amount
      const connection = this.solanaService.getConnection('mainnet-beta');
      const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

      // Create transaction
      const transaction = new Transaction();
      
      // Add priority fee
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: this.solanaService.keypair.publicKey,
          toPubkey: new PublicKey("11111111111111111111111111111112"), // Priority fee recipient
          lamports: Math.floor(priorityFee * LAMPORTS_PER_SOL)
        })
      );

      // Get or create associated token account
      const tokenMintKey = new PublicKey(tokenMint);
      const associatedTokenAccount = await getAssociatedTokenAddress(
        tokenMintKey,
        this.solanaService.keypair.publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Check if ATA exists
      const ataInfo = await connection.getAccountInfo(associatedTokenAccount);
      if (!ataInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            this.solanaService.keypair.publicKey,
            associatedTokenAccount,
            this.solanaService.keypair.publicKey,
            tokenMintKey,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      // Add PumpFun buy instruction
      const buyInstruction = await this.createBuyInstruction(
        tokenMintKey,
        lamports,
        slippageBps,
        associatedTokenAccount
      );
      transaction.add(buyInstruction);

      // Sign and send transaction
      transaction.feePayer = this.solanaService.keypair.publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      transaction.sign(this.solanaService.keypair);

      const signature = await connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: true,
          maxRetries: maxRetries
        }
      );

      await connection.confirmTransaction(signature, 'confirmed');

      console.log(`✅ Auto-buy successful: ${signature}`);
      
      return {
        signature,
        tokenMint,
        solAmount,
        status: 'confirmed',
        timestamp: Date.now()
      };

    } catch (error) {
      console.error(`❌ Auto-buy failed for ${tokenMint}:`, error.message);
      throw error;
    }
  }

  // Create buy instruction (simplified - in production you'd use the actual PumpFun program interface)
  async createBuyInstruction(tokenMint, lamports, slippageBps, associatedTokenAccount) {
    // This is a placeholder - actual implementation would need the PumpFun program IDL
    // and proper instruction encoding
    return SystemProgram.transfer({
      fromPubkey: this.solanaService.keypair.publicKey,
      toPubkey: tokenMint, // This would be the actual bonding curve account
      lamports
    });
  }

  // Quick snipe function for fast execution
  async quickSnipe(tokenMint, solAmount = 0.1) {
    console.log(`⚡ Quick sniping ${tokenMint} with ${solAmount} SOL`);
    
    return await this.autoBuyToken(tokenMint, solAmount, {
      slippageBps: 2000, // 20% slippage for sniping
      priorityFee: 0.05,  // Higher priority fee
      maxRetries: 1
    });
  }

  // Set trading filters
  setFilters(filters) {
    this.tokenFilters = { ...this.tokenFilters, ...filters };
    console.log("🔧 Updated PumpFun bot filters:", this.tokenFilters);
  }

  // Get current status
  getStatus() {
    return {
      isListening: this.isListening,
      filters: this.tokenFilters,
      callbacks: Array.from(this.eventCallbacks.keys()),
      walletAddress: this.solanaService.getWalletAddress()
    };
  }

  // Trading strategy: Buy on detection with conditions
  async enableAutoTrading(config = {}) {
    const {
      enabled = true,
      solAmountPerTrade = 0.1,
      maxTradesPerHour = 10,
      minMarketCap = 5000,
      maxMarketCap = 100000,
      stopAfterHours = 24
    } = config;

    if (!enabled) {
      this.eventCallbacks.delete('autoTrader');
      console.log("🛑 Auto-trading disabled");
      return;
    }

    let tradesThisHour = 0;
    let lastHourReset = Date.now();

    this.onTokenLaunch(async (tokenData) => {
      try {
        // Reset hourly counter
        if (Date.now() - lastHourReset > 3600000) {
          tradesThisHour = 0;
          lastHourReset = Date.now();
        }

        // Check trading limits
        if (tradesThisHour >= maxTradesPerHour) {
          console.log("⏸️ Hourly trade limit reached");
          return;
        }

        // Check market cap range
        if (tokenData.marketCap < minMarketCap || tokenData.marketCap > maxMarketCap) {
          console.log(`❌ Token ${tokenData.symbol} outside market cap range`);
          return;
        }

        // Execute auto-buy
        console.log(`🤖 Auto-trading triggered for ${tokenData.symbol}`);
        await this.autoBuyToken(tokenData.mint, solAmountPerTrade);
        tradesThisHour++;

        console.log(`📊 Trades this hour: ${tradesThisHour}/${maxTradesPerHour}`);

      } catch (error) {
        console.error("Auto-trading error:", error.message);
      }
    });

    // Auto-stop after specified hours
    if (stopAfterHours > 0) {
      setTimeout(() => {
        this.enableAutoTrading({ enabled: false });
        console.log(`⏰ Auto-trading stopped after ${stopAfterHours} hours`);
      }, stopAfterHours * 3600000);
    }

    console.log("🤖 Auto-trading enabled with config:", config);
  }
}