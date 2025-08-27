// src/services/solanaService.js
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction, clusterApiUrl } from "@solana/web3.js";
import bs58 from "bs58";

export class SolanaService {
  constructor(privateKey) {
    this.keypair = null;
    this.connections = {};

    // Initialize wallet if private key is provided
    if (privateKey) {
      this.initializeWallet(privateKey);
    }

    // Initialize connections for supported Solana clusters
    this.initializeConnections();
  }

  initializeWallet(privateKey) {
    try {
      // Convert private key from different formats
      let secretKey;
      
      if (typeof privateKey === 'string') {
        // Handle base58, hex, or array string formats
        if (privateKey.startsWith('[') && privateKey.endsWith(']')) {
          // Array string format: "[1,2,3,...]"
          secretKey = new Uint8Array(JSON.parse(privateKey));
        } else if (privateKey.length === 128) {
          // Hex format (64 bytes as hex string)
          secretKey = new Uint8Array(Buffer.from(privateKey, 'hex'));
        } else {
          // Try as base58 format (most common Solana format)
          try {
            secretKey = bs58.decode(privateKey);
            if (secretKey.length !== 64) {
              throw new Error('Invalid key length - expected 64 bytes');
            }
          } catch (error) {
            // If base58 fails, try as hex
            if (privateKey.length === 128) {
              secretKey = new Uint8Array(Buffer.from(privateKey, 'hex'));
            } else {
              throw new Error(`Invalid private key format. Expected base58, hex (128 chars), or array format. Error: ${error.message}`);
            }
          }
        }
      } else if (Array.isArray(privateKey)) {
        secretKey = new Uint8Array(privateKey);
      } else if (privateKey instanceof Uint8Array) {
        secretKey = privateKey;
      } else {
        throw new Error('Private key must be string, array, or Uint8Array');
      }

      this.keypair = Keypair.fromSecretKey(secretKey);
      console.error("Solana wallet initialized:", this.keypair.publicKey.toString());
    } catch (error) {
      console.error("Failed to initialize Solana wallet:", error.message);
      throw new Error(`Invalid Solana private key provided: ${error.message}`);
    }
  }

  initializeConnections() {
    // Solana cluster configurations
    const clusterConfigs = {
      'mainnet-beta': {
        name: 'Mainnet Beta',
        rpc: 'https://api.mainnet-beta.solana.com',
        commitment: 'confirmed'
      },
      'devnet': {
        name: 'Devnet',
        rpc: clusterApiUrl('devnet'),
        commitment: 'confirmed'
      },
      'testnet': {
        name: 'Testnet', 
        rpc: clusterApiUrl('testnet'),
        commitment: 'confirmed'
      },
      'localnet': {
        name: 'Localnet',
        rpc: 'http://127.0.0.1:8899',
        commitment: 'confirmed'
      }
    };

    // Alternative RPC providers for mainnet-beta for better reliability
    const mainnetRpcUrls = [
      'https://api.mainnet-beta.solana.com',
      'https://solana-api.projectserum.com',
      'https://rpc.ankr.com/solana',
      'https://solana.blockdaemon.com'
    ];

    for (const [clusterId, config] of Object.entries(clusterConfigs)) {
      try {
        let rpcUrl = config.rpc;
        
        // For mainnet, try multiple RPC endpoints
        if (clusterId === 'mainnet-beta') {
          // Use first available mainnet RPC
          rpcUrl = mainnetRpcUrls[0];
        }

        this.connections[clusterId] = new Connection(rpcUrl, config.commitment);
        console.error(`Solana ${config.name} connection initialized: ${rpcUrl}`);
      } catch (error) {
        console.warn(`Failed to initialize Solana connection for ${config.name}:`, error.message);
      }
    }
  }

  getConnection(cluster = 'mainnet-beta') {
    const connection = this.connections[cluster];
    if (!connection) {
      throw new Error(`No connection configured for Solana cluster: ${cluster}`);
    }
    return connection;
  }

  getWalletPublicKey() {
    if (!this.keypair) {
      throw new Error("No Solana wallet initialized");
    }
    return this.keypair.publicKey;
  }

  getWalletAddress() {
    return this.getWalletPublicKey().toString();
  }

  async getBalance(cluster = 'mainnet-beta', address = null) {
    try {
      const connection = this.getConnection(cluster);
      const publicKey = address ? new PublicKey(address) : this.getWalletPublicKey();
      
      const balance = await connection.getBalance(publicKey);
      
      return {
        address: publicKey.toString(),
        balance: balance,
        balanceSOL: balance / LAMPORTS_PER_SOL,
        cluster: cluster,
        lamports: balance
      };
    } catch (error) {
      throw new Error(`Failed to get Solana balance: ${error.message}`);
    }
  }

  async getAccountInfo(address, cluster = 'mainnet-beta') {
    try {
      const connection = this.getConnection(cluster);
      const publicKey = new PublicKey(address);
      
      const accountInfo = await connection.getAccountInfo(publicKey);
      
      if (!accountInfo) {
        return {
          address: address,
          exists: false,
          cluster: cluster
        };
      }

      return {
        address: address,
        exists: true,
        executable: accountInfo.executable,
        lamports: accountInfo.lamports,
        owner: accountInfo.owner.toString(),
        rentEpoch: accountInfo.rentEpoch,
        space: accountInfo.space,
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get Solana account info: ${error.message}`);
    }
  }

  async transferSOL(toAddress, amount, cluster = 'mainnet-beta') {
    try {
      if (!this.keypair) {
        throw new Error("No Solana wallet configured for signing");
      }

      const connection = this.getConnection(cluster);
      const fromPublicKey = this.getWalletPublicKey();
      const toPublicKey = new PublicKey(toAddress);
      
      // Convert SOL to lamports
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

      // Create transfer instruction
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: fromPublicKey,
        toPubkey: toPublicKey,
        lamports: lamports,
      });

      // Create transaction
      const transaction = new Transaction().add(transferInstruction);
      
      // Get latest blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromPublicKey;

      console.log(`🚀 Sending ${amount} SOL to ${toAddress}...`);

      // Sign and send transaction
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [this.keypair],
        {
          commitment: 'confirmed',
          preflightCommitment: 'confirmed'
        }
      );

      console.log(`✅ SOL transfer completed: ${signature}`);

      return {
        signature: signature,
        from: fromPublicKey.toString(),
        to: toPublicKey.toString(),
        amount: amount,
        lamports: lamports,
        cluster: cluster,
        status: 'confirmed'
      };

    } catch (error) {
      throw new Error(`SOL transfer failed: ${error.message}`);
    }
  }

  async getTransactionStatus(signature, cluster = 'mainnet-beta') {
    try {
      const connection = this.getConnection(cluster);
      
      const status = await connection.getSignatureStatus(signature, {
        searchTransactionHistory: true
      });

      if (!status || !status.value) {
        return {
          signature: signature,
          status: 'not_found',
          cluster: cluster
        };
      }

      const confirmationStatus = status.value.confirmationStatus;
      const err = status.value.err;

      return {
        signature: signature,
        status: err ? 'failed' : confirmationStatus || 'unknown',
        confirmationStatus: confirmationStatus,
        confirmations: status.value.confirmations,
        error: err ? err.toString() : null,
        slot: status.value.slot,
        cluster: cluster
      };

    } catch (error) {
      throw new Error(`Failed to get transaction status: ${error.message}`);
    }
  }

  async getTransactionDetails(signature, cluster = 'mainnet-beta') {
    try {
      const connection = this.getConnection(cluster);
      
      const transaction = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        return {
          signature: signature,
          found: false,
          cluster: cluster
        };
      }

      return {
        signature: signature,
        found: true,
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        confirmations: transaction.transaction ? 'confirmed' : 'unknown',
        fee: transaction.meta?.fee || 0,
        success: transaction.meta?.err === null,
        error: transaction.meta?.err ? transaction.meta.err.toString() : null,
        preBalances: transaction.meta?.preBalances || [],
        postBalances: transaction.meta?.postBalances || [],
        logMessages: transaction.meta?.logMessages || [],
        cluster: cluster
      };

    } catch (error) {
      throw new Error(`Failed to get transaction details: ${error.message}`);
    }
  }

  async airdropSOL(amount, cluster = 'devnet') {
    try {
      if (cluster === 'mainnet-beta') {
        throw new Error("Airdrop is not available on mainnet-beta");
      }

      if (!this.keypair) {
        throw new Error("No Solana wallet configured");
      }

      const connection = this.getConnection(cluster);
      const publicKey = this.getWalletPublicKey();
      
      // Convert SOL to lamports
      const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

      console.log(`🪂 Requesting airdrop of ${amount} SOL on ${cluster}...`);

      // Request airdrop
      const signature = await connection.requestAirdrop(publicKey, lamports);

      // Wait for confirmation
      await connection.confirmTransaction(signature, 'confirmed');

      console.log(`✅ Airdrop completed: ${signature}`);

      return {
        signature: signature,
        address: publicKey.toString(),
        amount: amount,
        lamports: lamports,
        cluster: cluster,
        status: 'confirmed'
      };

    } catch (error) {
      throw new Error(`Airdrop failed: ${error.message}`);
    }
  }

  getSupportedClusters() {
    return Object.keys(this.connections);
  }

  isClusterSupported(cluster) {
    return this.getSupportedClusters().includes(cluster);
  }

  async getSlot(cluster = 'mainnet-beta') {
    try {
      const connection = this.getConnection(cluster);
      const slot = await connection.getSlot();
      
      return {
        slot: slot,
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get current slot: ${error.message}`);
    }
  }

  async getEpochInfo(cluster = 'mainnet-beta') {
    try {
      const connection = this.getConnection(cluster);
      const epochInfo = await connection.getEpochInfo();
      
      return {
        epoch: epochInfo.epoch,
        slotIndex: epochInfo.slotIndex,
        slotsInEpoch: epochInfo.slotsInEpoch,
        absoluteSlot: epochInfo.absoluteSlot,
        blockHeight: epochInfo.blockHeight,
        transactionCount: epochInfo.transactionCount,
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get epoch info: ${error.message}`);
    }
  }

  async getClusterNodes(cluster = 'mainnet-beta') {
    try {
      const connection = this.getConnection(cluster);
      const nodes = await connection.getClusterNodes();
      
      return {
        nodes: nodes.map(node => ({
          pubkey: node.pubkey,
          gossip: node.gossip,
          tpu: node.tpu,
          rpc: node.rpc,
          version: node.version,
          featureSet: node.featureSet
        })),
        count: nodes.length,
        cluster: cluster
      };
    } catch (error) {
      throw new Error(`Failed to get cluster nodes: ${error.message}`);
    }
  }
}