// src/toolService.js
import { AgService } from "./services/agService.js";
import { CoinGeckoApiService } from "./services/coinGeckoApiService.js";
import { BlockchainService } from "./services/blockchainService.js";
import { SolanaDexService } from "./services/solanaDexService.js";
import { SolanaLimitOrderService } from "./services/solanaLimitOrderService.js";
import { MemecoinService } from "./services/memecoinService.js";
import { PumpFunBotService } from "./services/pumpFunBotService.js";
import { MarketMakerService } from "./services/MarketMakerService.js";
import { WalletManagerService } from "./services/WalletManagerService.js";
import { ethers } from "ethers";

export class ToolService {
  constructor(
    agUrl,
    userPrivateKey,
    userAddress,
    coinGeckoApiKey,
    alchemyApiKey,
    solanaPrivateKey
  ) {
    this.agg = new AgService(agUrl);
    this.coinGeckoApi = new CoinGeckoApiService(coinGeckoApiKey);
    this.blockchain = new BlockchainService(userPrivateKey, alchemyApiKey, solanaPrivateKey);
    this.userPrivateKey = userPrivateKey;
    this.userAddress = userAddress;
    this.solanaPrivateKey = solanaPrivateKey;

    // Initialize advanced Solana trading services
    if (solanaPrivateKey && this.blockchain.solana) {
      this.solanaDex = new SolanaDexService(this.blockchain.solana);
      this.solanaLimitOrders = new SolanaLimitOrderService(this.blockchain.solana, this.solanaDex);
      this.memecoinService = new MemecoinService(this.blockchain.solana, this.solanaDex);
      this.pumpFunBot = new PumpFunBotService(this.blockchain.solana);
      this.marketMaker = new MarketMakerService();
    }
    
    // Initialize wallet manager service
    this.walletManager = new WalletManagerService();
  }

  async getSwapPrice(params) {
    // Validate required parameters
    const { chainId, buyToken, sellToken, sellAmount } = params;

    if (!chainId || !buyToken || !sellToken || !sellAmount) {
      throw new Error(
        "Missing required parameters: chainId, buyToken, sellToken, sellAmount"
      );
    }

    const result = await this.agg.getSwapPrice(params);

    return {
      message: "Swap price retrieved successfully",
      data: result,
    };
  }

  async getSwapQuote(params) {
    // Validate required parameters
    const { chainId, buyToken, sellToken, sellAmount } = params;

    if (!chainId || !buyToken || !sellToken || !sellAmount) {
      throw new Error(
        "Missing required parameters: chainId, buyToken, sellToken, sellAmount"
      );
    }

    // Add taker address if not provided
    const quoteParams = {
      ...params,
      taker: params.taker || this.userAddress,
    };

    const result = await this.agg.getSwapQuote(quoteParams);

    // Add chainId to the result for executeSwap to use
    result.chainId = chainId;

    return {
      message: "Swap quote retrieved successfully",
      data: result,
      nextSteps: [
        "1. Review the quote details including fees and gas estimates",
        "2. Use execute_swap tool to execute this swap",
        "3. The permit2 signature will be handled automatically",
      ],
    };
  }

  async executeSwap(quoteData) {
    if (!quoteData) {
      throw new Error("Quote data is required for swap execution");
    }

    if (!this.userPrivateKey) {
      throw new Error("User private key is required for swap execution");
    }

    try {
      // Extract chain ID from quote data
      const chainId = quoteData.chainId || quoteData.transaction?.chainId;
      if (!chainId) {
        throw new Error("Chain ID not found in quote data");
      }

      console.log("🚀 Executing swap transaction...");

      // Sign and broadcast the transaction using blockchain service
      const result = await this.blockchain.signAndBroadcastTransaction(
        chainId,
        quoteData
      );

      return {
        message: "Swap executed successfully",
        data: result,
        nextSteps: [
          "1. Transaction has been broadcasted to the blockchain",
          "2. Wait for confirmation (usually 1-3 minutes)",
          "3. Check transaction status on block explorer",
          `4. Transaction hash: ${result.hash}`,
        ],
      };
    } catch (error) {
      throw new Error(`Swap execution failed: ${error.message}`);
    }
  }

  async getSupportedChains() {
    const result = await this.agg.getSupportedChains();

    return {
      message: "Supported chains retrieved successfully",
      data: result,
      summary: `Found ${result.chains?.length || 0} supported chains`,
    };
  }

  async getLiquiditySources(chainId) {
    if (!chainId) {
      throw new Error("chainId is required");
    }

    const result = await this.agg.getLiquiditySources(chainId);

    return {
      message: `Liquidity sources for chain ${chainId} retrieved successfully`,
      data: result,
      summary: `Found ${result.sources?.length || 0} liquidity sources`,
    };
  }

  // CoinGecko API Methods
  async getTokenPrice(network, addresses, options = {}) {
    if (!network || !addresses) {
      throw new Error("Missing required parameters: network, addresses");
    }

    const result = await this.coinGeckoApi.getTokenPrice(
      network,
      addresses,
      options
    );

    return {
      message: "Token prices retrieved successfully",
      data: result,
      summary: `Retrieved prices for ${
        addresses.split(",").length
      } token(s) on ${network} network`,
    };
  }

  async getCoinGeckoNetworks(page = 1) {
    const result = await this.coinGeckoApi.getNetworks(page);

    return {
      message: "CoinGecko networks retrieved successfully",
      data: result,
      summary: `Found ${result.data?.length || 0} networks on page ${page}`,
    };
  }

  async getSupportedDexes(network, page = 1) {
    if (!network) {
      throw new Error("network is required");
    }

    const result = await this.coinGeckoApi.getSupportedDexes(network, page);

    return {
      message: `Supported DEXes for ${network} retrieved successfully`,
      data: result,
      summary: `Found ${result.data?.length || 0} DEXes on ${network} network`,
    };
  }

  async getTrendingPools(options = {}) {
    const result = await this.coinGeckoApi.getTrendingPools(options);

    return {
      message: "Trending pools retrieved successfully",
      data: result,
      summary: `Found ${result.data?.length || 0} trending pools`,
      duration: options.duration || "24h",
    };
  }

  async getTrendingPoolsByNetwork(network, options = {}) {
    if (!network) {
      throw new Error("network is required");
    }

    const result = await this.coinGeckoApi.getTrendingPoolsByNetwork(
      network,
      options
    );

    return {
      message: `Trending pools for ${network} retrieved successfully`,
      data: result,
      summary: `Found ${result.data?.length || 0} trending pools on ${network}`,
      duration: options.duration || "24h",
    };
  }

  async getMultiplePoolsData(network, addresses, options = {}) {
    if (!network || !addresses) {
      throw new Error("Missing required parameters: network, addresses");
    }

    const result = await this.coinGeckoApi.getMultiplePoolsData(
      network,
      addresses,
      options
    );

    return {
      message: "Multiple pools data retrieved successfully",
      data: result,
      summary: `Retrieved data for ${
        addresses.split(",").length
      } pool(s) on ${network}`,
    };
  }

  async getTopPoolsByDex(network, dex, options = {}) {
    if (!network || !dex) {
      throw new Error("Missing required parameters: network, dex");
    }

    const result = await this.coinGeckoApi.getTopPoolsByDex(
      network,
      dex,
      options
    );

    return {
      message: `Top pools for ${dex} on ${network} retrieved successfully`,
      data: result,
      summary: `Found ${result.data?.length || 0} pools on ${dex}`,
      sort: options.sort || "h24_tx_count_desc",
    };
  }

  async getNewPools(options = {}) {
    const result = await this.coinGeckoApi.getNewPools(options);

    return {
      message: "New pools retrieved successfully",
      data: result,
      summary: `Found ${
        result.data?.length || 0
      } new pools across all networks`,
    };
  }

  async searchPools(query, options = {}) {
    if (!query) {
      throw new Error("query is required");
    }

    const result = await this.coinGeckoApi.searchPools(query, options);

    return {
      message: `Pool search for "${query}" completed successfully`,
      data: result,
      summary: `Found ${result.data?.length || 0} pools matching "${query}"${
        options.network ? ` on ${options.network}` : ""
      }`,
    };
  }

  // Additional CoinGecko API Methods from coingeckoendpoints-2.txt
  async getTopPoolsByToken(network, tokenAddress, options = {}) {
    if (!network || !tokenAddress) {
      throw new Error("Missing required parameters: network, tokenAddress");
    }

    const result = await this.coinGeckoApi.getTopPoolsByToken(
      network,
      tokenAddress,
      options
    );

    return {
      message: `Top pools for token ${tokenAddress} on ${network} retrieved successfully`,
      data: result,
      summary: `Found ${
        result.data?.length || 0
      } pools for token ${tokenAddress}`,
      sort: options.sort || "h24_volume_usd_liquidity_desc",
    };
  }

  async getTokenData(network, address, options = {}) {
    if (!network || !address) {
      throw new Error("Missing required parameters: network, address");
    }

    const result = await this.coinGeckoApi.getTokenData(
      network,
      address,
      options
    );

    return {
      message: `Token data for ${address} on ${network} retrieved successfully`,
      data: result,
      summary: `Retrieved data for token ${
        result.data?.attributes?.symbol || address
      }`,
      includes: options.include ? options.include.split(",") : [],
    };
  }

  async getMultipleTokensData(network, addresses, options = {}) {
    if (!network || !addresses) {
      throw new Error("Missing required parameters: network, addresses");
    }

    const result = await this.coinGeckoApi.getMultipleTokensData(
      network,
      addresses,
      options
    );

    return {
      message: "Multiple tokens data retrieved successfully",
      data: result,
      summary: `Retrieved data for ${
        addresses.split(",").length
      } token(s) on ${network}`,
      includes: options.include ? options.include.split(",") : [],
    };
  }

  async getTokenInfo(network, address) {
    if (!network || !address) {
      throw new Error("Missing required parameters: network, address");
    }

    const result = await this.coinGeckoApi.getTokenInfo(network, address);

    return {
      message: `Token info for ${address} on ${network} retrieved successfully`,
      data: result,
      summary: `Retrieved detailed info for token ${
        result.data?.attributes?.symbol || address
      }`,
      note: "This endpoint provides additional token information like socials, websites, and description",
    };
  }

  async getRecentlyUpdatedTokens(options = {}) {
    const result = await this.coinGeckoApi.getRecentlyUpdatedTokens(options);

    return {
      message: "Recently updated tokens retrieved successfully",
      data: result,
      summary: `Found ${result.data?.length || 0} recently updated tokens${
        options.network ? ` on ${options.network}` : " across all networks"
      }`,
      includes: options.include ? options.include.split(",") : [],
    };
  }

  async getPoolOHLCV(network, poolAddress, timeframe, options = {}) {
    if (!network || !poolAddress || !timeframe) {
      throw new Error(
        "Missing required parameters: network, poolAddress, timeframe"
      );
    }

    const result = await this.coinGeckoApi.getPoolOHLCV(
      network,
      poolAddress,
      timeframe,
      options
    );

    return {
      message: `OHLCV data for pool ${poolAddress} retrieved successfully`,
      data: result,
      summary: `Retrieved ${timeframe} OHLCV data for pool on ${network}`,
      timeframe: timeframe,
      aggregate: options.aggregate || "1",
      currency: options.currency || "usd",
      token: options.token || "base",
    };
  }

  async getPoolTrades(network, poolAddress, options = {}) {
    if (!network || !poolAddress) {
      throw new Error("Missing required parameters: network, poolAddress");
    }

    const result = await this.coinGeckoApi.getPoolTrades(
      network,
      poolAddress,
      options
    );

    return {
      message: `Pool trades for ${poolAddress} on ${network} retrieved successfully`,
      data: result,
      summary: `Found ${result.data?.length || 0} trades for pool`,
      minVolumeFilter: options.trade_volume_in_usd_greater_than || "none",
    };
  }

  // Gasless Aggregator API Methods
  async getGaslessPrice(params) {
    const { chainId, buyToken, sellToken, sellAmount } = params;

    if (!chainId || !buyToken || !sellToken || !sellAmount) {
      throw new Error(
        "Missing required parameters: chainId, buyToken, sellToken, sellAmount"
      );
    }

    const result = await this.agg.getGaslessPrice(params);

    return {
      message: "Gasless swap price retrieved successfully",
      data: result,
      note: "This is a gasless swap - no ETH needed for gas fees",
    };
  }

  async getGaslessQuote(params) {
    const { chainId, buyToken, sellToken, sellAmount } = params;

    if (!chainId || !buyToken || !sellToken || !sellAmount) {
      throw new Error(
        "Missing required parameters: chainId, buyToken, sellToken, sellAmount"
      );
    }

    // Add taker address if not provided (required for gasless quotes)
    const quoteParams = {
      ...params,
      taker: params.taker || this.userAddress,
    };

    if (!quoteParams.taker) {
      throw new Error("Taker address is required for gasless quotes");
    }

    const result = await this.agg.getGaslessQuote(quoteParams);

    return {
      message: "Gasless swap quote retrieved successfully",
      data: result,
      nextSteps: [
        "1. Review the quote details including approval and trade objects",
        "2. Use submit_gasless_swap tool to execute this gasless swap",
        "3. Both approval and trade signatures will be handled automatically",
      ],
      gaslessInfo: {
        hasApproval: !!result.approval,
        hasTrade: !!result.trade,
        approvalType: result.approval?.type,
        tradeType: result.trade?.type,
      },
    };
  }

  async submitGaslessSwap(params) {
    const { quoteData } = params;

    if (!quoteData) {
      throw new Error("Quote data from gasless quote is required");
    }

    if (!this.userPrivateKey) {
      throw new Error(
        "User private key is required for gasless swap execution"
      );
    }

    try {
      console.log("🚀 Processing gasless swap...");

      // Prepare the submission data - extract chainId from trade domain
      const chainId =
        quoteData.trade?.eip712?.domain?.chainId || params.chainId;
      if (!chainId) {
        throw new Error("Chain ID not found in quote data or parameters");
      }

      const submissionData = {
        chainId: chainId,
      };

      // Sign approval if present
      if (quoteData.approval) {
        console.log("🔐 Signing gasless approval...");
        const signedApproval = await this.blockchain.signGaslessApproval(
          quoteData.approval
        );
        submissionData.approval = signedApproval;
        console.log("✅ Approval signed");
      }

      // Sign trade (always required)
      if (!quoteData.trade) {
        throw new Error("Trade data is required in gasless quote");
      }

      console.log("🔐 Signing gasless trade...");
      const signedTrade = await this.blockchain.signGaslessTrade(
        quoteData.trade
      );
      submissionData.trade = signedTrade;
      console.log("✅ Trade signed");

      // Submit to Aggregator gasless API
      console.log("📤 Submitting gasless swap to Agg...");
      const result = await this.agg.submitGaslessSwap(submissionData);

      return {
        message: "Gasless swap submitted successfully",
        data: result,
        nextSteps: [
          "1. Gasless swap has been submitted to relayer",
          "2. Monitor status using get_gasless_status tool",
          "3. No gas fees required - relayer handles execution",
          `4. Trade hash: ${result.tradeHash}`,
        ],
        gaslessInfo: {
          tradeHash: result.tradeHash,
          approvalSigned: !!submissionData.approval,
          tradeSigned: !!submissionData.trade,
          relayerHandled: true,
        },
      };
    } catch (error) {
      throw new Error(`Gasless swap submission failed: ${error.message}`);
    }
  }

  async getGaslessStatus(params) {
    const { tradeHash, chainId } = params;

    if (!tradeHash || !chainId) {
      throw new Error("Missing required parameters: tradeHash, chainId");
    }

    const result = await this.agg.getGaslessStatus(tradeHash, chainId);

    return {
      message: `Gasless swap status for ${tradeHash} retrieved successfully`,
      data: result,
      summary: `Status: ${result.status || "unknown"}`,
      gaslessInfo: {
        tradeHash,
        chainId,
        isGasless: true,
        relayerManaged: true,
      },
    };
  }

  async getGaslessChains() {
    const result = await this.agg.getGaslessChains();

    return {
      message: "Gasless supported chains retrieved successfully",
      data: result,
      summary: `Found ${
        result.chains?.length || 0
      } chains supporting gasless swaps`,
      note: "These chains support meta-transaction based gasless swaps",
    };
  }

  async getGaslessApprovalTokens(params = {}) {
    // Default to Base chain if no chainId provided
    const chainId = params.chainId || 8453;

    const result = await this.agg.getGaslessApprovalTokens(chainId);

    return {
      message: "Gasless approval tokens retrieved successfully",
      data: result,
      summary: `Found ${
        result.tokens?.length || 0
      } tokens supporting gasless approvals on chain ${chainId}`,
      note: "These tokens support EIP-2612 permit or meta-transaction approvals",
      chainId,
    };
  }

  // Portfolio API Methods
  async getPortfolioTokens(params) {
    const {
      addresses,
      withMetadata,
      withPrices,
      includeNativeTokens,
      networks,
    } = params;

    // Use provided addresses or default to USER_ADDRESS with specified networks
    let targetAddresses;
    if (addresses && Array.isArray(addresses)) {
      targetAddresses = addresses;
    } else if (this.userAddress) {
      // Default to USER_ADDRESS with provided networks or common networks
      const defaultNetworks = networks || ["eth-mainnet", "base-mainnet"];
      targetAddresses = [
        {
          address: this.userAddress,
          networks: defaultNetworks,
        },
      ];
    } else {
      throw new Error(
        "Either addresses parameter or USER_ADDRESS environment variable is required"
      );
    }

    const result = await this.agg.getPortfolioTokens(targetAddresses, {
      withMetadata,
      withPrices,
      includeNativeTokens,
    });

    return {
      message: "Portfolio tokens retrieved successfully",
      data: result,
      summary: `Retrieved tokens for ${
        targetAddresses.length
      } address(es) across ${targetAddresses.reduce(
        (total, addr) => total + addr.networks.length,
        0
      )} network(s)`,
      addressUsed: targetAddresses[0].address,
      options: {
        withMetadata: withMetadata !== false,
        withPrices: withPrices !== false,
        includeNativeTokens: includeNativeTokens || false,
      },
    };
  }

  async getPortfolioBalances(params) {
    const { addresses, includeNativeTokens, networks } = params;

    // Use provided addresses or default to USER_ADDRESS with specified networks
    let targetAddresses;
    if (addresses && Array.isArray(addresses)) {
      targetAddresses = addresses;
    } else if (this.userAddress) {
      // Default to USER_ADDRESS with provided networks or common networks
      const defaultNetworks = networks || ["eth-mainnet", "base-mainnet"];
      targetAddresses = [
        {
          address: this.userAddress,
          networks: defaultNetworks,
        },
      ];
    } else {
      throw new Error(
        "Either addresses parameter or USER_ADDRESS environment variable is required"
      );
    }

    const result = await this.agg.getPortfolioBalances(targetAddresses, {
      includeNativeTokens,
    });

    return {
      message: "Portfolio balances retrieved successfully",
      data: result,
      summary: `Retrieved balances for ${
        targetAddresses.length
      } address(es) across ${targetAddresses.reduce(
        (total, addr) => total + addr.networks.length,
        0
      )} network(s)`,
      addressUsed: targetAddresses[0].address,
      note: "Balances only - no prices or metadata for faster response",
      options: {
        includeNativeTokens: includeNativeTokens || false,
      },
    };
  }

  async getPortfolioTransactions(params) {
    const { addresses, before, after, limit, networks } = params;

    // Use provided addresses or default to USER_ADDRESS with specified networks
    let targetAddresses;
    if (addresses && Array.isArray(addresses)) {
      targetAddresses = addresses;
    } else if (this.userAddress) {
      // Default to USER_ADDRESS with provided networks or BETA supported networks
      const defaultNetworks = networks || ["eth-mainnet", "base-mainnet"];
      targetAddresses = [
        {
          address: this.userAddress,
          networks: defaultNetworks,
        },
      ];
    } else {
      throw new Error(
        "Either addresses parameter or USER_ADDRESS environment variable is required"
      );
    }

    if (targetAddresses.length !== 1) {
      throw new Error(
        "Transactions API currently supports only 1 address (BETA limitation)"
      );
    }

    const result = await this.agg.getPortfolioTransactions(targetAddresses, {
      before,
      after,
      limit,
    });

    return {
      message: "Portfolio transactions retrieved successfully",
      data: result,
      summary: `Retrieved ${
        result.transactions?.length || 0
      } transactions for address ${targetAddresses[0].address}`,
      addressUsed: targetAddresses[0].address,
      pagination: {
        limit: limit || 25,
        before: result.before,
        after: result.after,
        totalCount: result.totalCount,
      },
      beta: {
        limitations:
          "Currently supports 1 address and max 2 networks (eth-mainnet, base-mainnet)",
        note: "This endpoint is in BETA with limited functionality",
      },
    };
  }

  // Conversion utility methods
  async convertWeiToFormatted(params) {
    const { amount, decimals } = params;

    if (!amount) {
      throw new Error("amount is required");
    }

    if (decimals === undefined || decimals === null) {
      throw new Error("decimals is required");
    }

    try {
      // Convert the amount to a BigNumber and format it
      const formattedAmount = ethers.formatUnits(amount.toString(), decimals);

      return {
        message: "Wei to formatted conversion completed successfully",
        data: {
          originalAmount: amount.toString(),
          decimals: decimals,
          formattedAmount: formattedAmount,
          unit: decimals === 18 ? "ETH" : `${decimals} decimals`,
        },
        summary: `Converted ${amount} wei to ${formattedAmount} (${decimals} decimals)`,
      };
    } catch (error) {
      throw new Error(`Wei to formatted conversion failed: ${error.message}`);
    }
  }

  async convertFormattedToWei(params) {
    const { amount, decimals } = params;

    if (!amount) {
      throw new Error("amount is required");
    }

    if (decimals === undefined || decimals === null) {
      throw new Error("decimals is required");
    }

    try {
      // Convert the formatted amount to wei (BigNumber)
      const weiAmount = ethers.parseUnits(amount.toString(), decimals);

      return {
        message: "Formatted to wei conversion completed successfully",
        data: {
          originalAmount: amount.toString(),
          decimals: decimals,
          weiAmount: weiAmount.toString(),
          unit: decimals === 18 ? "ETH" : `${decimals} decimals`,
        },
        summary: `Converted ${amount} (${decimals} decimals) to ${weiAmount.toString()} wei`,
      };
    } catch (error) {
      throw new Error(`Formatted to wei conversion failed: ${error.message}`);
    }
  }

  // Solana Methods
  async getSolanaBalance(params = {}) {
    const { cluster = 'mainnet-beta', address } = params;

    try {
      const result = await this.blockchain.getSolanaBalance(cluster, address);

      return {
        message: "Solana balance retrieved successfully",
        data: result,
        summary: `Balance: ${result.balanceSOL} SOL (${result.balance} lamports) on ${cluster}`,
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get Solana balance: ${error.message}`);
    }
  }

  async transferSOL(params) {
    const { toAddress, amount, cluster = 'mainnet-beta' } = params;

    if (!toAddress || amount === undefined) {
      throw new Error("Missing required parameters: toAddress, amount");
    }

    if (!this.solanaPrivateKey) {
      throw new Error("Solana private key is required for SOL transfers");
    }

    try {
      const result = await this.blockchain.transferSOL(toAddress, amount, cluster);

      return {
        message: "SOL transfer completed successfully",
        data: result,
        summary: `Transferred ${amount} SOL to ${toAddress}`,
        nextSteps: [
          "1. Transaction has been confirmed on the Solana blockchain",
          "2. Check the transaction on Solana explorer",
          `3. Transaction signature: ${result.signature}`
        ],
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`SOL transfer failed: ${error.message}`);
    }
  }

  async getSolanaAccountInfo(params) {
    const { address, cluster = 'mainnet-beta' } = params;

    if (!address) {
      throw new Error("address is required");
    }

    try {
      const result = await this.blockchain.getSolanaAccountInfo(address, cluster);

      return {
        message: "Solana account info retrieved successfully",
        data: result,
        summary: result.exists 
          ? `Account exists with ${result.lamports} lamports, owner: ${result.owner}`
          : "Account does not exist",
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get Solana account info: ${error.message}`);
    }
  }

  async getSolanaTransactionStatus(params) {
    const { signature, cluster = 'mainnet-beta' } = params;

    if (!signature) {
      throw new Error("signature is required");
    }

    try {
      const result = await this.blockchain.getSolanaTransactionStatus(signature, cluster);

      return {
        message: "Solana transaction status retrieved successfully",
        data: result,
        summary: `Transaction status: ${result.status}${result.confirmations ? ` (${result.confirmations} confirmations)` : ''}`,
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get Solana transaction status: ${error.message}`);
    }
  }

  async getSolanaTransactionDetails(params) {
    const { signature, cluster = 'mainnet-beta' } = params;

    if (!signature) {
      throw new Error("signature is required");
    }

    try {
      const result = await this.blockchain.getSolanaTransactionDetails(signature, cluster);

      return {
        message: "Solana transaction details retrieved successfully",
        data: result,
        summary: result.found 
          ? `Transaction found: ${result.success ? 'Success' : 'Failed'}, Fee: ${result.fee} lamports`
          : "Transaction not found",
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get Solana transaction details: ${error.message}`);
    }
  }

  async airdropSOL(params = {}) {
    const { amount = 1, cluster = 'devnet' } = params;

    if (cluster === 'mainnet-beta') {
      throw new Error("Airdrop is not available on mainnet-beta");
    }

    if (!this.solanaPrivateKey) {
      throw new Error("Solana private key is required for airdrops");
    }

    try {
      const result = await this.blockchain.airdropSOL(amount, cluster);

      return {
        message: "SOL airdrop completed successfully",
        data: result,
        summary: `Airdropped ${amount} SOL on ${cluster}`,
        nextSteps: [
          "1. SOL has been added to your wallet",
          "2. Check your balance with get_solana_balance tool",
          `3. Transaction signature: ${result.signature}`
        ],
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`SOL airdrop failed: ${error.message}`);
    }
  }

  async getSolanaSupportedClusters() {
    try {
      const clusters = this.blockchain.getSupportedSolanaClusters();

      return {
        message: "Supported Solana clusters retrieved successfully",
        data: { clusters },
        summary: `Found ${clusters.length} supported Solana clusters`,
        clusters: clusters
      };
    } catch (error) {
      throw new Error(`Failed to get supported Solana clusters: ${error.message}`);
    }
  }

  async getSolanaSlot(params = {}) {
    const { cluster = 'mainnet-beta' } = params;

    try {
      const result = await this.blockchain.getSolanaSlot(cluster);

      return {
        message: "Solana slot information retrieved successfully",
        data: result,
        summary: `Current slot: ${result.slot} on ${cluster}`,
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get Solana slot: ${error.message}`);
    }
  }

  async getSolanaEpochInfo(params = {}) {
    const { cluster = 'mainnet-beta' } = params;

    try {
      const result = await this.blockchain.getSolanaEpochInfo(cluster);

      return {
        message: "Solana epoch info retrieved successfully",
        data: result,
        summary: `Epoch ${result.epoch}: ${result.slotIndex}/${result.slotsInEpoch} slots, Block height: ${result.blockHeight}`,
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get Solana epoch info: ${error.message}`);
    }
  }

  async getSolanaClusterNodes(params = {}) {
    const { cluster = 'mainnet-beta' } = params;

    try {
      const result = await this.blockchain.getSolanaClusterNodes(cluster);

      return {
        message: "Solana cluster nodes retrieved successfully",
        data: result,
        summary: `Found ${result.count} active nodes on ${cluster}`,
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get Solana cluster nodes: ${error.message}`);
    }
  }

  getSolanaWalletAddress() {
    const address = this.blockchain.getSolanaWalletAddress();
    
    if (!address) {
      return {
        message: "No Solana wallet configured",
        data: null,
        summary: "Solana private key not provided",
        note: "Set SOLANA_PRIVATE_KEY environment variable to use Solana functions"
      };
    }

    return {
      message: "Solana wallet address retrieved successfully",
      data: { address },
      summary: `Solana wallet address: ${address}`,
      address: address
    };
  }

  // Advanced Solana DEX Trading Methods
  async swapOnSolanaDex(params) {
    const { inputToken, outputToken, amount, platform = 'auto', slippageBps = 50 } = params;

    if (!inputToken || !outputToken || !amount) {
      throw new Error("Missing required parameters: inputToken, outputToken, amount");
    }

    if (!this.solanaDex) {
      throw new Error("Solana DEX service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      let result;
      const formattedAmount = this.solanaDex.formatAmount(amount);

      if (platform === 'auto') {
        result = await this.solanaDex.executeSwapOnBestDex(
          this.solanaDex.getTokenAddress(inputToken),
          this.solanaDex.getTokenAddress(outputToken),
          formattedAmount,
          slippageBps
        );
      } else {
        // Execute on specific platform
        const quote = platform === 'jupiter' 
          ? await this.solanaDex.getJupiterQuote(
              this.solanaDex.getTokenAddress(inputToken),
              this.solanaDex.getTokenAddress(outputToken),
              formattedAmount,
              slippageBps
            )
          : await this.solanaDex.getRaydiumQuote(
              this.solanaDex.getTokenAddress(inputToken),
              this.solanaDex.getTokenAddress(outputToken),
              formattedAmount,
              slippageBps / 100
            );

        result = platform === 'jupiter'
          ? await this.solanaDex.executeJupiterSwap(quote)
          : await this.solanaDex.executeRaydiumSwap(quote);
      }

      return {
        message: "Solana DEX swap completed successfully",
        data: result,
        summary: `Swapped ${amount} ${inputToken} for ${this.solanaDex.formatPrice(result.outAmount)} ${outputToken} on ${result.platform}`,
        nextSteps: [
          "1. Transaction confirmed on Solana blockchain",
          "2. Check transaction on Solana explorer",
          `3. Transaction signature: ${result.signature}`
        ]
      };
    } catch (error) {
      throw new Error(`Solana DEX swap failed: ${error.message}`);
    }
  }

  async getSolanaDexQuote(params) {
    const { inputToken, outputToken, amount, platform = 'auto', slippageBps = 50 } = params;

    if (!inputToken || !outputToken || !amount) {
      throw new Error("Missing required parameters: inputToken, outputToken, amount");
    }

    if (!this.solanaDex) {
      throw new Error("Solana DEX service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const formattedAmount = this.solanaDex.formatAmount(amount);
      let result;

      if (platform === 'auto') {
        result = await this.solanaDex.getBestQuote(
          this.solanaDex.getTokenAddress(inputToken),
          this.solanaDex.getTokenAddress(outputToken),
          formattedAmount,
          slippageBps
        );
      } else {
        const quote = platform === 'jupiter'
          ? await this.solanaDex.getJupiterQuote(
              this.solanaDex.getTokenAddress(inputToken),
              this.solanaDex.getTokenAddress(outputToken),
              formattedAmount,
              slippageBps
            )
          : await this.solanaDex.getRaydiumQuote(
              this.solanaDex.getTokenAddress(inputToken),
              this.solanaDex.getTokenAddress(outputToken),
              formattedAmount,
              slippageBps / 100
            );

        result = { bestQuote: quote, allQuotes: [quote] };
      }

      return {
        message: "Solana DEX quote retrieved successfully",
        data: result,
        summary: `Best rate: ${this.solanaDex.formatPrice(result.bestQuote.outAmount)} ${outputToken} for ${amount} ${inputToken} on ${result.bestQuote.platform}`
      };
    } catch (error) {
      throw new Error(`Solana DEX quote failed: ${error.message}`);
    }
  }

  // Limit Order Methods
  async createSolanaLimitOrder(params) {
    const { type, inputToken, outputToken, amount, targetPrice, slippageBps = 100, expiry, platform = 'auto' } = params;

    if (!type || !inputToken || !outputToken || !amount || !targetPrice) {
      throw new Error("Missing required parameters: type, inputToken, outputToken, amount, targetPrice");
    }

    if (!this.solanaLimitOrders) {
      throw new Error("Solana limit order service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const result = await this.solanaLimitOrders.createLimitOrder({
        type,
        inputToken,
        outputToken,
        amount,
        targetPrice,
        slippageBps,
        expiry,
        platform
      });

      return {
        message: "Limit order created successfully",
        data: result,
        summary: `${type} order: ${amount} ${inputToken} at ${targetPrice} ${outputToken} each`,
        nextSteps: [
          "1. Limit order is now monitoring market prices",
          "2. Order will execute automatically when target price is reached",
          "3. Check order status with get_solana_limit_orders tool"
        ]
      };
    } catch (error) {
      throw new Error(`Limit order creation failed: ${error.message}`);
    }
  }

  async getSolanaLimitOrders(params = {}) {
    const { status = 'all' } = params;

    if (!this.solanaLimitOrders) {
      throw new Error("Solana limit order service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const result = await this.solanaLimitOrders.getLimitOrders(status);

      return {
        message: "Limit orders retrieved successfully",
        data: result,
        summary: `Found ${result.count} limit orders (${status}), monitoring: ${result.monitoring ? 'active' : 'inactive'}`
      };
    } catch (error) {
      throw new Error(`Failed to get limit orders: ${error.message}`);
    }
  }

  async cancelSolanaLimitOrder(params) {
    const { orderId } = params;

    if (!orderId) {
      throw new Error("Missing required parameter: orderId");
    }

    if (!this.solanaLimitOrders) {
      throw new Error("Solana limit order service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const result = await this.solanaLimitOrders.cancelLimitOrder(orderId);

      return {
        message: "Limit order cancelled successfully",
        data: result,
        summary: `Order ${orderId} has been cancelled`
      };
    } catch (error) {
      throw new Error(`Failed to cancel limit order: ${error.message}`);
    }
  }

  // Memecoin Trading Methods
  async getPumpFunTrending(params = {}) {
    const { limit = 50, sortBy = 'created_timestamp', includeNsfw = false } = params;

    if (!this.memecoinService) {
      throw new Error("Memecoin service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const result = await this.memecoinService.getPumpFunTrending(limit, sortBy, includeNsfw);

      return {
        message: "PumpFun trending tokens retrieved successfully",
        data: result,
        summary: `Found ${result.count} trending memecoins on PumpFun`,
        riskLevels: {
          low: result.trending.filter(t => t.riskLevel === 'low').length,
          medium: result.trending.filter(t => t.riskLevel === 'medium').length,
          high: result.trending.filter(t => t.riskLevel === 'high').length
        }
      };
    } catch (error) {
      throw new Error(`Failed to get PumpFun trending: ${error.message}`);
    }
  }

  async getPumpFunToken(params) {
    const { mintAddress } = params;

    if (!mintAddress) {
      throw new Error("Missing required parameter: mintAddress");
    }

    if (!this.memecoinService) {
      throw new Error("Memecoin service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const result = await this.memecoinService.getPumpFunToken(mintAddress);

      return {
        message: "PumpFun token info retrieved successfully",
        data: result,
        summary: `${result.symbol}: $${result.marketCap?.toLocaleString()} market cap, ${result.holders} holders, ${result.riskLevel} risk`
      };
    } catch (error) {
      throw new Error(`Failed to get PumpFun token: ${error.message}`);
    }
  }

  async quickBuyMemecoin(params) {
    const { tokenAddress, solAmount, riskLevel = 'medium', maxSlippage } = params;

    if (!tokenAddress || !solAmount) {
      throw new Error("Missing required parameters: tokenAddress, solAmount");
    }

    if (!this.memecoinService) {
      throw new Error("Memecoin service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const result = await this.memecoinService.quickBuyMemecoin({
        tokenAddress,
        solAmount,
        riskLevel,
        maxSlippage
      });

      return {
        message: "Memecoin quick buy completed successfully",
        data: result,
        summary: `Bought ${result.tokenInfo.symbol || 'MEMECOIN'} for ${solAmount} SOL (${riskLevel} risk)`,
        nextSteps: [
          "1. Transaction confirmed on Solana blockchain",
          "2. Monitor your position for profit opportunities", 
          "3. Consider setting stop-loss orders for risk management",
          `4. Transaction signature: ${result.signature}`
        ]
      };
    } catch (error) {
      throw new Error(`Memecoin quick buy failed: ${error.message}`);
    }
  }

  async scanNewMemecoins(params = {}) {
    if (!this.memecoinService) {
      throw new Error("Memecoin service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const result = await this.memecoinService.scanNewMemecoins(params);

      return {
        message: "Memecoin scan completed successfully",
        data: result,
        summary: `Found ${result.count} potential memecoins matching your criteria`,
        topPicks: result.coins.slice(0, 5).map(coin => ({
          symbol: coin.symbol,
          marketCap: coin.marketCap,
          score: coin.potentialScore,
          riskLevel: coin.riskLevel
        }))
      };
    } catch (error) {
      throw new Error(`Memecoin scan failed: ${error.message}`);
    }
  }

  // PumpFun Bot Tools
  async startPumpfunBot(params = {}) {
    if (!this.pumpFunBot) {
      throw new Error("PumpFun bot service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    const { filters = {}, autoTrading = false } = params;

    try {
      await this.pumpFunBot.startListening(filters);
      
      if (autoTrading) {
        await this.pumpFunBot.enableAutoTrading(autoTrading);
      }

      return {
        message: "PumpFun bot started successfully",
        data: this.pumpFunBot.getStatus(),
        summary: "Now monitoring PumpFun for new token launches",
        capabilities: [
          "Real-time token launch detection",
          "Configurable filtering system",
          "Auto-trading with risk controls",
          "Quick snipe functionality"
        ]
      };
    } catch (error) {
      throw new Error(`PumpFun bot startup failed: ${error.message}`);
    }
  }

  async stopPumpfunBot() {
    if (!this.pumpFunBot) {
      throw new Error("PumpFun bot service not initialized");
    }

    try {
      await this.pumpFunBot.stopListening();

      return {
        message: "PumpFun bot stopped successfully",
        data: this.pumpFunBot.getStatus(),
        summary: "Bot stopped monitoring token launches"
      };
    } catch (error) {
      throw new Error(`PumpFun bot stop failed: ${error.message}`);
    }
  }

  async pumpfunAutoBuy(params) {
    const { tokenMint, solAmount, options = {} } = params;
    
    if (!tokenMint || !solAmount) {
      throw new Error("Missing required parameters: tokenMint, solAmount");
    }

    if (!this.pumpFunBot) {
      throw new Error("PumpFun bot service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const result = await this.pumpFunBot.autoBuyToken(tokenMint, solAmount, options);

      return {
        message: "PumpFun auto-buy completed successfully",
        data: result,
        summary: `Bought ${solAmount} SOL worth of ${tokenMint}`,
        transactionDetails: {
          signature: result.signature,
          timestamp: new Date(result.timestamp).toISOString(),
          status: result.status
        }
      };
    } catch (error) {
      throw new Error(`PumpFun auto-buy failed: ${error.message}`);
    }
  }

  async pumpfunQuickSnipe(params) {
    const { tokenMint, solAmount = 0.1 } = params;
    
    if (!tokenMint) {
      throw new Error("Missing required parameter: tokenMint");
    }

    if (!this.pumpFunBot) {
      throw new Error("PumpFun bot service not initialized - provide SOLANA_PRIVATE_KEY");
    }

    try {
      const result = await this.pumpFunBot.quickSnipe(tokenMint, solAmount);

      return {
        message: "PumpFun quick snipe completed successfully",
        data: result,
        summary: `Sniped ${tokenMint} with ${solAmount} SOL`,
        warning: "Quick snipe uses high slippage and priority fees for speed",
        transactionDetails: {
          signature: result.signature,
          timestamp: new Date(result.timestamp).toISOString(),
          status: result.status
        }
      };
    } catch (error) {
      throw new Error(`PumpFun quick snipe failed: ${error.message}`);
    }
  }

  async setPumpfunFilters(params) {
    const filters = params;
    
    if (!this.pumpFunBot) {
      throw new Error("PumpFun bot service not initialized");
    }

    try {
      this.pumpFunBot.setFilters(filters);

      return {
        message: "PumpFun bot filters updated successfully",
        data: this.pumpFunBot.getStatus(),
        summary: "Bot will now use updated filtering criteria",
        activeFilters: filters
      };
    } catch (error) {
      throw new Error(`Filter update failed: ${error.message}`);
    }
  }

  async getPumpfunBotStatus() {
    if (!this.pumpFunBot) {
      throw new Error("PumpFun bot service not initialized");
    }

    try {
      const status = this.pumpFunBot.getStatus();

      return {
        message: "PumpFun bot status retrieved successfully",
        data: status,
        summary: status.isListening ? "Bot is actively monitoring" : "Bot is stopped",
        details: {
          monitoring: status.isListening,
          walletAddress: status.walletAddress,
          activeFilters: status.filters,
          registeredCallbacks: status.callbacks.length
        }
      };
    } catch (error) {
      throw new Error(`Status retrieval failed: ${error.message}`);
    }
  }

  // Market Maker Tools
  async initializeMarketMaker(config = {}) {
    if (!this.marketMaker) {
      throw new Error('Market maker service not available. Solana wallet required.');
    }

    if (!this.solanaPrivateKey) {
      throw new Error('Solana private key required for market maker initialization');
    }

    try {
      const result = await this.marketMaker.initialize(this.solanaPrivateKey);
      
      return {
        message: result.success ? 'Market maker initialized successfully' : 'Failed to initialize market maker',
        data: result,
        summary: result.success ? 
          `Market maker ready for wallet: ${result.walletAddress}` : 
          `Initialization failed: ${result.error}`
      };
    } catch (error) {
      throw new Error(`Market maker initialization failed: ${error.message}`);
    }
  }

  async startMarketMaker({ tokenMint, targetAllocation = 0.5, config = {} }) {
    if (!this.marketMaker) {
      throw new Error('Market maker service not available');
    }

    if (!tokenMint) {
      throw new Error('Token mint address required');
    }

    try {
      // Update configuration if provided
      if (Object.keys(config).length > 0) {
        this.marketMaker.updateConfig(config);
      }

      const result = await this.marketMaker.start(tokenMint, targetAllocation);
      
      return {
        message: result.success ? 'Market maker started successfully' : 'Failed to start market maker',
        data: {
          ...result,
          tokenMint,
          targetAllocation,
          configuration: this.marketMaker.config
        },
        summary: result.success ? 
          `Market maker started for ${tokenMint} with ${targetAllocation * 100}% SOL allocation` : 
          `Start failed: ${result.error}`
      };
    } catch (error) {
      throw new Error(`Market maker start failed: ${error.message}`);
    }
  }

  async stopMarketMaker() {
    if (!this.marketMaker) {
      throw new Error('Market maker service not available');
    }

    try {
      const result = await this.marketMaker.stop();
      
      return {
        message: result.success ? 'Market maker stopped successfully' : 'Failed to stop market maker',
        data: result,
        summary: result.success ? 
          'Market maker stopped and final stats recorded' : 
          `Stop failed: ${result.error}`
      };
    } catch (error) {
      throw new Error(`Market maker stop failed: ${error.message}`);
    }
  }

  async getMarketMakerStatus() {
    if (!this.marketMaker) {
      throw new Error('Market maker service not available');
    }

    try {
      const stats = this.marketMaker.getStats();
      
      return {
        message: 'Market maker status retrieved successfully',
        data: {
          status: stats.isRunning ? 'running' : 'stopped',
          configuration: this.marketMaker.config,
          statistics: stats,
          wallet: this.marketMaker.wallet ? this.marketMaker.wallet.publicKey.toString() : null
        },
        summary: `Market maker is ${stats.isRunning ? 'active' : 'inactive'} - ${stats.totalTrades} total trades, ${stats.successRate.toFixed(1)}% success rate`
      };
    } catch (error) {
      throw new Error(`Status retrieval failed: ${error.message}`);
    }
  }

  async updateMarketMakerConfig(newConfig) {
    if (!this.marketMaker) {
      throw new Error('Market maker service not available');
    }

    if (!newConfig || typeof newConfig !== 'object') {
      throw new Error('Configuration object required');
    }

    try {
      const updatedConfig = this.marketMaker.updateConfig(newConfig);
      
      return {
        message: 'Market maker configuration updated successfully',
        data: {
          previousConfig: { ...this.marketMaker.config, ...newConfig },
          newConfig: updatedConfig,
          isRunning: this.marketMaker.isRunning
        },
        summary: `Configuration updated. Key changes: ${Object.keys(newConfig).join(', ')}`
      };
    } catch (error) {
      throw new Error(`Configuration update failed: ${error.message}`);
    }
  }

  async getMarketMakerStats() {
    if (!this.marketMaker) {
      throw new Error('Market maker service not available');
    }

    try {
      const stats = this.marketMaker.getStats();
      
      return {
        message: 'Market maker statistics retrieved successfully',
        data: stats,
        summary: `Runtime: ${Math.round(stats.runtime / 1000 / 60)}min | Trades: ${stats.totalTrades} | Success: ${stats.successRate.toFixed(1)}% | Volume: ${stats.totalVolume}`
      };
    } catch (error) {
      throw new Error(`Statistics retrieval failed: ${error.message}`);
    }
  }

  // Wallet Management Tools
  async generateWallet({ type = 'solana', name = null }) {
    try {
      let wallet;
      
      if (type === 'solana') {
        wallet = this.walletManager.generateSolanaWallet();
      } else if (type === 'ethereum') {
        wallet = this.walletManager.generateEthereumWallet();
      } else {
        throw new Error('Unsupported wallet type. Use "solana" or "ethereum"');
      }

      // Add name if provided
      if (name) {
        wallet.name = name;
      }

      // Store in manager
      const key = type === 'solana' ? wallet.address : wallet.address.toLowerCase();
      this.walletManager.wallets.set(key, { 
        ...wallet, 
        generated: true,
        generatedAt: new Date().toISOString()
      });

      return {
        message: `${type.charAt(0).toUpperCase() + type.slice(1)} wallet generated successfully`,
        data: {
          type: wallet.type,
          name: wallet.name || `${type}-${wallet.address.slice(0, 8)}`,
          address: wallet.address,
          publicKey: wallet.publicKey,
          // Only return private key for generated wallets for security
          privateKey: wallet.privateKey
        },
        summary: `Generated ${type} wallet: ${wallet.address}`
      };
    } catch (error) {
      throw new Error(`Wallet generation failed: ${error.message}`);
    }
  }

  async importWallet({ type, privateKey, name = null }) {
    if (!type || !privateKey) {
      throw new Error('Both type and privateKey are required');
    }

    try {
      let result;
      
      if (type === 'solana') {
        result = await this.walletManager.importSolanaWallet(privateKey, name);
      } else if (type === 'ethereum') {
        result = await this.walletManager.importEthereumWallet(privateKey, name);
      } else {
        throw new Error('Unsupported wallet type. Use "solana" or "ethereum"');
      }

      return {
        message: result.message,
        data: result.success ? {
          type: result.wallet.type,
          name: result.wallet.name,
          address: result.wallet.address,
          publicKey: result.wallet.publicKey,
          imported: result.wallet.imported,
          importedAt: result.wallet.importedAt
        } : null,
        summary: result.success ? 
          `Imported ${type} wallet: ${result.wallet.address}` : 
          `Import failed: ${result.error}`
      };
    } catch (error) {
      throw new Error(`Wallet import failed: ${error.message}`);
    }
  }

  async exportWallet({ address }) {
    if (!address) {
      throw new Error('Wallet address is required');
    }

    try {
      const result = this.walletManager.exportWallet(address);
      
      return {
        message: result.message,
        data: result.success ? result.wallet : null,
        summary: result.success ? 
          `Exported wallet: ${result.wallet.address}` : 
          `Export failed: ${result.error}`
      };
    } catch (error) {
      throw new Error(`Wallet export failed: ${error.message}`);
    }
  }

  async listWallets() {
    try {
      const result = await this.walletManager.listWallets();
      
      return {
        message: result.message,
        data: {
          wallets: result.wallets,
          count: result.count
        },
        summary: `Found ${result.count} wallet(s) in memory`
      };
    } catch (error) {
      throw new Error(`Wallet listing failed: ${error.message}`);
    }
  }

  async removeWallet({ address }) {
    if (!address) {
      throw new Error('Wallet address is required');
    }

    try {
      const result = await this.walletManager.removeWallet(address);
      
      return {
        message: result.message,
        data: result.success ? result.removedWallet : null,
        summary: result.success ? 
          `Removed wallet: ${result.removedWallet.address}` : 
          `Removal failed: ${result.error}`
      };
    } catch (error) {
      throw new Error(`Wallet removal failed: ${error.message}`);
    }
  }

  async getWalletBalances({ rpcEndpoint = 'https://api.mainnet-beta.solana.com' } = {}) {
    try {
      const result = await this.walletManager.getWalletBalances(rpcEndpoint);
      
      return {
        message: result.message,
        data: {
          balances: result.balances,
          totalWallets: result.totalWallets
        },
        summary: `Retrieved balances for ${result.totalWallets} Solana wallet(s)`
      };
    } catch (error) {
      throw new Error(`Balance retrieval failed: ${error.message}`);
    }
  }

  async saveWalletsToFile({ password, filename = 'wallets.json' }) {
    if (!password) {
      throw new Error('Password is required for encryption');
    }

    try {
      const result = await this.walletManager.saveWalletsToFile(password, filename);
      
      return {
        message: result.message,
        data: result.success ? {
          filename: result.filename || filename,
          filePath: result.filePath,
          walletCount: result.walletCount
        } : null,
        summary: result.success ? 
          `Saved ${result.walletCount} wallet(s) to ${filename}` : 
          `Save failed: ${result.error}`
      };
    } catch (error) {
      throw new Error(`Wallet save failed: ${error.message}`);
    }
  }

  async loadWalletsFromFile({ password, filename = 'wallets.json' }) {
    if (!password) {
      throw new Error('Password is required for decryption');
    }

    try {
      const result = await this.walletManager.loadWalletsFromFile(password, filename);
      
      return {
        message: result.message,
        data: result.success ? {
          loadedCount: result.loadedCount,
          totalWallets: result.totalWallets
        } : null,
        summary: result.success ? 
          `Loaded ${result.loadedCount} wallet(s) from ${filename}` : 
          `Load failed: ${result.error}`
      };
    } catch (error) {
      throw new Error(`Wallet load failed: ${error.message}`);
    }
  }

  async createWalletBackup({ password, backupName = null }) {
    if (!password) {
      throw new Error('Password is required for backup encryption');
    }

    try {
      const result = await this.walletManager.createBackup(password, backupName);
      
      return {
        message: result.message,
        data: result.success ? {
          filename: result.filename,
          filePath: result.filePath,
          walletCount: result.walletCount
        } : null,
        summary: result.success ? 
          `Created backup: ${result.filename}` : 
          `Backup failed: ${result.error}`
      };
    } catch (error) {
      throw new Error(`Backup creation failed: ${error.message}`);
    }
  }
}
