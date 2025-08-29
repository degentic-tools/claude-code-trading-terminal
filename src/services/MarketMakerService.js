/**
 * Solana Market Maker Service
 * Automated 50/50 portfolio rebalancing between SOL and SPL tokens
 * Based on gianlucamazza/solana-mmaker implementation
 */

import { Connection, PublicKey, Keypair, VersionedTransaction } from '@solana/web3.js';
import fetch from 'node-fetch';
import bs58 from 'bs58';

export class MarketMakerService {
    constructor(config = {}) {
        this.config = {
            rpcEndpoint: config.rpcEndpoint || 'https://api.mainnet-beta.solana.com',
            slippageBps: config.slippageBps || 50, // 0.5%
            priceTolerance: config.priceTolerance || 0.02, // 2%
            waitTime: config.waitTime || 60000, // 1 minute
            rebalanceThreshold: config.rebalanceThreshold || 0.05, // 5%
            priorityFee: config.priorityFee || 0.001, // SOL
            ...config
        };

        this.connection = new Connection(this.config.rpcEndpoint);
        this.wallet = null;
        this.isRunning = false;
        this.stats = {
            totalTrades: 0,
            successfulTrades: 0,
            failedTrades: 0,
            totalVolume: 0,
            startTime: null,
            lastRebalance: null
        };
    }

    /**
     * Initialize the market maker with wallet
     */
    async initialize(privateKey) {
        try {
            // Decode private key
            const secretKey = bs58.decode(privateKey);
            this.wallet = Keypair.fromSecretKey(secretKey);
            
            console.log(`Market Maker initialized for wallet: ${this.wallet.publicKey.toString()}`);
            return {
                success: true,
                walletAddress: this.wallet.publicKey.toString()
            };
        } catch (error) {
            console.error('Failed to initialize market maker:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Start the market making bot
     */
    async start(tokenMint, targetAllocation = 0.5) {
        if (!this.wallet) {
            throw new Error('Market maker not initialized. Call initialize() first.');
        }

        if (this.isRunning) {
            throw new Error('Market maker is already running');
        }

        this.isRunning = true;
        this.stats.startTime = Date.now();
        
        console.log(`Starting market maker for token: ${tokenMint}`);
        console.log(`Target allocation: ${targetAllocation * 100}% SOL / ${(1 - targetAllocation) * 100}% Token`);

        // Start the rebalancing loop
        this.rebalanceLoop(tokenMint, targetAllocation);

        return {
            success: true,
            message: 'Market maker started successfully',
            config: this.config
        };
    }

    /**
     * Stop the market making bot
     */
    async stop() {
        this.isRunning = false;
        console.log('Market maker stopped');
        
        return {
            success: true,
            message: 'Market maker stopped',
            stats: this.getStats()
        };
    }

    /**
     * Main rebalancing loop
     */
    async rebalanceLoop(tokenMint, targetAllocation) {
        while (this.isRunning) {
            try {
                await this.checkAndRebalance(tokenMint, targetAllocation);
                await this.sleep(this.config.waitTime);
            } catch (error) {
                console.error('Error in rebalance loop:', error);
                await this.sleep(this.config.waitTime);
            }
        }
    }

    /**
     * Check portfolio and rebalance if needed
     */
    async checkAndRebalance(tokenMint, targetAllocation) {
        try {
            // Get current portfolio
            const portfolio = await this.getPortfolio(tokenMint);
            
            // Calculate current allocation
            const totalValue = portfolio.solValue + portfolio.tokenValue;
            const currentSolAllocation = portfolio.solValue / totalValue;
            
            console.log(`Current allocation: ${(currentSolAllocation * 100).toFixed(2)}% SOL`);
            console.log(`Target allocation: ${(targetAllocation * 100).toFixed(2)}% SOL`);

            // Check if rebalancing is needed
            const allocationDiff = Math.abs(currentSolAllocation - targetAllocation);
            
            if (allocationDiff > this.config.rebalanceThreshold) {
                console.log(`Rebalancing needed. Difference: ${(allocationDiff * 100).toFixed(2)}%`);
                await this.executeRebalance(tokenMint, portfolio, targetAllocation);
            } else {
                console.log('Portfolio is balanced. No action needed.');
            }

        } catch (error) {
            console.error('Error checking portfolio:', error);
            this.stats.failedTrades++;
        }
    }

    /**
     * Execute portfolio rebalancing
     */
    async executeRebalance(tokenMint, portfolio, targetAllocation) {
        try {
            const totalValue = portfolio.solValue + portfolio.tokenValue;
            const currentSolAllocation = portfolio.solValue / totalValue;
            
            let swapAmount, inputToken, outputToken;
            
            if (currentSolAllocation > targetAllocation) {
                // Too much SOL, swap SOL for token
                const excessSol = portfolio.solValue - (totalValue * targetAllocation);
                swapAmount = Math.floor(excessSol * 0.95 * 1e9); // 95% to account for fees, convert to lamports
                inputToken = 'So11111111111111111111111111111111111111112'; // SOL mint
                outputToken = tokenMint;
                
                console.log(`Swapping ${excessSol.toFixed(4)} SOL for token`);
            } else {
                // Too much token, swap token for SOL
                const excessTokenValue = portfolio.tokenValue - (totalValue * (1 - targetAllocation));
                const tokenPrice = portfolio.tokenValue / portfolio.tokenBalance;
                swapAmount = Math.floor((excessTokenValue / tokenPrice) * 0.95); // 95% to account for fees
                inputToken = tokenMint;
                outputToken = 'So11111111111111111111111111111111111111112'; // SOL mint
                
                console.log(`Swapping ${(excessTokenValue / tokenPrice).toFixed(4)} tokens for SOL`);
            }

            // Execute the swap
            const swapResult = await this.executeSwap(inputToken, outputToken, swapAmount);
            
            if (swapResult.success) {
                this.stats.successfulTrades++;
                this.stats.totalVolume += swapAmount;
                this.stats.lastRebalance = Date.now();
                console.log('Rebalance completed successfully');
            } else {
                this.stats.failedTrades++;
                console.error('Rebalance failed:', swapResult.error);
            }

            this.stats.totalTrades++;

        } catch (error) {
            console.error('Error executing rebalance:', error);
            this.stats.failedTrades++;
        }
    }

    /**
     * Execute swap using Jupiter API
     */
    async executeSwap(inputMint, outputMint, amount) {
        try {
            // Get quote from Jupiter
            const quoteResponse = await fetch(
                `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${this.config.slippageBps}`
            );
            
            if (!quoteResponse.ok) {
                throw new Error(`Jupiter quote failed: ${quoteResponse.statusText}`);
            }

            const quoteData = await quoteResponse.json();

            // Get swap transaction
            const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    quoteResponse: quoteData,
                    userPublicKey: this.wallet.publicKey.toString(),
                    wrapAndUnwrapSol: true,
                    prioritizationFeeLamports: Math.floor(this.config.priorityFee * 1e9)
                }),
            });

            if (!swapResponse.ok) {
                throw new Error(`Jupiter swap failed: ${swapResponse.statusText}`);
            }

            const { swapTransaction } = await swapResponse.json();

            // Deserialize and sign transaction
            const transactionBuf = Buffer.from(swapTransaction, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuf);
            transaction.sign([this.wallet]);

            // Send transaction
            const signature = await this.connection.sendTransaction(transaction);
            
            // Confirm transaction
            const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
            
            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            return {
                success: true,
                signature,
                inputAmount: amount,
                outputAmount: quoteData.outAmount
            };

        } catch (error) {
            console.error('Swap execution error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get current portfolio balances and values
     */
    async getPortfolio(tokenMint) {
        try {
            // Get SOL balance
            const solBalance = await this.connection.getBalance(this.wallet.publicKey);
            const solAmount = solBalance / 1e9; // Convert lamports to SOL

            // Get token balance (simplified - would need SPL token account lookup)
            // This is a placeholder - actual implementation would need token account handling
            const tokenBalance = 0; // TODO: Implement token balance lookup
            
            // Get prices (simplified - would use Jupiter or other price API)
            const solPrice = await this.getSolPrice();
            const tokenPrice = await this.getTokenPrice(tokenMint);

            return {
                solBalance: solAmount,
                tokenBalance,
                solValue: solAmount * solPrice,
                tokenValue: tokenBalance * tokenPrice,
                solPrice,
                tokenPrice
            };

        } catch (error) {
            console.error('Error getting portfolio:', error);
            throw error;
        }
    }

    /**
     * Get SOL price in USD
     */
    async getSolPrice() {
        try {
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
            const data = await response.json();
            return data.solana.usd;
        } catch (error) {
            console.error('Error fetching SOL price:', error);
            return 100; // Fallback price
        }
    }

    /**
     * Get token price in USD
     */
    async getTokenPrice(tokenMint) {
        // Placeholder - would implement proper token price lookup
        // Could use Jupiter price API or other sources
        return 1; // Fallback price
    }

    /**
     * Get market maker statistics
     */
    getStats() {
        const runtime = this.stats.startTime ? Date.now() - this.stats.startTime : 0;
        
        return {
            ...this.stats,
            runtime,
            successRate: this.stats.totalTrades > 0 ? (this.stats.successfulTrades / this.stats.totalTrades) * 100 : 0,
            isRunning: this.isRunning
        };
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        return this.config;
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default MarketMakerService;