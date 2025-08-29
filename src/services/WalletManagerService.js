/**
 * Wallet Manager Service
 * Import/Export and manage multiple wallets with private keys
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export class WalletManagerService {
    constructor() {
        this.wallets = new Map(); // In-memory wallet storage
        this.walletsDir = path.join(os.homedir(), '.cc-trading-terminal', 'wallets');
        this.walletFile = path.join(this.walletsDir, 'wallets.json');
        this.initialized = false;
        this.ensureWalletsDir().then(() => this.loadWallets()).then(() => {
            this.initialized = true;
        });
    }

    /**
     * Ensure wallets directory exists
     */
    async ensureWalletsDir() {
        try {
            await fs.mkdir(this.walletsDir, { recursive: true });
        } catch (error) {
            console.warn('Could not create wallets directory:', error.message);
        }
    }

    /**
     * Load wallets from persistent storage
     */
    async loadWallets() {
        try {
            const data = await fs.readFile(this.walletFile, 'utf-8');
            const walletsData = JSON.parse(data);
            // Don't clear existing wallets - merge with persisted ones
            for (const [address, wallet] of Object.entries(walletsData)) {
                this.wallets.set(address, wallet);
            }
        } catch (error) {
            // File doesn't exist or is empty - that's okay
        }
    }

    /**
     * Save wallets to persistent storage
     */
    async saveWallets() {
        try {
            const walletsData = Object.fromEntries(this.wallets);
            await fs.writeFile(this.walletFile, JSON.stringify(walletsData, null, 2));
        } catch (error) {
            console.warn('Could not save wallets:', error.message);
        }
    }

    /**
     * Generate new Solana wallet
     */
    generateSolanaWallet() {
        const keypair = Keypair.generate();
        const privateKey = bs58.encode(keypair.secretKey);
        const publicKey = keypair.publicKey.toString();

        return {
            type: 'solana',
            privateKey,
            publicKey,
            address: publicKey
        };
    }

    /**
     * Generate new Ethereum wallet
     */
    generateEthereumWallet() {
        const wallet = ethers.Wallet.createRandom();
        
        return {
            type: 'ethereum',
            privateKey: wallet.privateKey,
            publicKey: wallet.publicKey,
            address: wallet.address
        };
    }

    /**
     * Import Solana wallet from private key
     */
    async importSolanaWallet(privateKey, name = null) {
        try {
            let secretKey;
            
            // Handle different private key formats
            if (privateKey.length === 128) {
                // Hex format
                secretKey = new Uint8Array(Buffer.from(privateKey, 'hex'));
            } else if (privateKey.length === 88 || privateKey.length === 87) {
                // Base58 format (87 or 88 characters)
                secretKey = bs58.decode(privateKey);
            } else if (Array.isArray(privateKey)) {
                // Array format
                secretKey = new Uint8Array(privateKey);
            } else {
                throw new Error(`Invalid private key format. Length: ${privateKey.length}, expected 87-88 (base58) or 128 (hex)`);
            }

            const keypair = Keypair.fromSecretKey(secretKey);
            const publicKey = keypair.publicKey.toString();
            
            const walletData = {
                type: 'solana',
                privateKey: bs58.encode(keypair.secretKey),
                publicKey,
                address: publicKey,
                name: name || `Solana-${publicKey.slice(0, 8)}`,
                imported: true,
                importedAt: new Date().toISOString()
            };

            // Store in memory
            this.wallets.set(publicKey, walletData);
            await this.saveWallets();

            return {
                success: true,
                wallet: walletData,
                message: 'Solana wallet imported successfully'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                message: 'Failed to import Solana wallet'
            };
        }
    }

    /**
     * Import Ethereum wallet from private key
     */
    async importEthereumWallet(privateKey, name = null) {
        try {
            // Ensure private key starts with 0x
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }

            const wallet = new ethers.Wallet(privateKey);
            
            const walletData = {
                type: 'ethereum',
                privateKey: wallet.privateKey,
                publicKey: wallet.publicKey,
                address: wallet.address,
                name: name || `Ethereum-${wallet.address.slice(0, 8)}`,
                imported: true,
                importedAt: new Date().toISOString()
            };

            // Store in memory
            this.wallets.set(wallet.address.toLowerCase(), walletData);
            await this.saveWallets();

            return {
                success: true,
                wallet: walletData,
                message: 'Ethereum wallet imported successfully'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                message: 'Failed to import Ethereum wallet'
            };
        }
    }

    /**
     * Export wallet by address
     */
    exportWallet(address) {
        const wallet = this.wallets.get(address) || this.wallets.get(address.toLowerCase());
        
        if (!wallet) {
            return {
                success: false,
                error: 'Wallet not found',
                message: `No wallet found with address: ${address}`
            };
        }

        return {
            success: true,
            wallet: {
                type: wallet.type,
                name: wallet.name,
                address: wallet.address,
                privateKey: wallet.privateKey,
                publicKey: wallet.publicKey
            },
            message: 'Wallet exported successfully'
        };
    }

    /**
     * Wait for initialization to complete
     */
    async waitForInit() {
        while (!this.initialized) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    /**
     * List all imported wallets
     */
    async listWallets() {
        await this.waitForInit();
        const walletsList = Array.from(this.wallets.values()).map(wallet => ({
            type: wallet.type,
            name: wallet.name,
            address: wallet.address,
            publicKey: wallet.publicKey,
            imported: wallet.imported || false,
            importedAt: wallet.importedAt || null
        }));

        return {
            success: true,
            wallets: walletsList,
            count: walletsList.length,
            message: `Found ${walletsList.length} wallet(s)`
        };
    }

    /**
     * Remove wallet from memory
     */
    async removeWallet(address) {
        const key = this.wallets.has(address) ? address : address.toLowerCase();
        const wallet = this.wallets.get(key);
        
        if (!wallet) {
            return {
                success: false,
                error: 'Wallet not found',
                message: `No wallet found with address: ${address}`
            };
        }

        this.wallets.delete(key);
        await this.saveWallets();

        return {
            success: true,
            removedWallet: {
                type: wallet.type,
                name: wallet.name,
                address: wallet.address
            },
            message: 'Wallet removed successfully'
        };
    }

    /**
     * Save wallets to encrypted file
     */
    async saveWalletsToFile(password, filename = 'wallets.json') {
        try {
            const walletsData = Array.from(this.wallets.values());
            
            if (walletsData.length === 0) {
                return {
                    success: false,
                    error: 'No wallets to save',
                    message: 'No wallets found in memory'
                };
            }

            // Encrypt the data
            const encryptedData = this.encryptData(JSON.stringify(walletsData), password);
            const filePath = path.join(this.walletsDir, filename);
            
            await fs.writeFile(filePath, encryptedData);

            return {
                success: true,
                filePath,
                walletCount: walletsData.length,
                message: `${walletsData.length} wallet(s) saved to ${filename}`
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                message: 'Failed to save wallets to file'
            };
        }
    }

    /**
     * Load wallets from encrypted file
     */
    async loadWalletsFromFile(password, filename = 'wallets.json') {
        try {
            const filePath = path.join(this.walletsDir, filename);
            const encryptedData = await fs.readFile(filePath, 'utf8');
            
            // Decrypt the data
            const decryptedData = this.decryptData(encryptedData, password);
            const walletsData = JSON.parse(decryptedData);
            
            // Load wallets into memory
            let loadedCount = 0;
            for (const wallet of walletsData) {
                const key = wallet.type === 'solana' ? wallet.address : wallet.address.toLowerCase();
                this.wallets.set(key, wallet);
                loadedCount++;
            }

            return {
                success: true,
                loadedCount,
                totalWallets: this.wallets.size,
                message: `${loadedCount} wallet(s) loaded from ${filename}`
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                message: 'Failed to load wallets from file'
            };
        }
    }

    /**
     * Get wallet balances (Solana)
     */
    async getWalletBalances(rpcEndpoint = 'https://api.mainnet-beta.solana.com') {
        const connection = new Connection(rpcEndpoint);
        const balances = [];

        for (const [address, wallet] of this.wallets.entries()) {
            if (wallet.type === 'solana') {
                try {
                    const publicKey = new PublicKey(wallet.address);
                    const balance = await connection.getBalance(publicKey);
                    
                    balances.push({
                        name: wallet.name,
                        address: wallet.address,
                        type: wallet.type,
                        balance: balance,
                        balanceSOL: balance / 1e9
                    });
                } catch (error) {
                    balances.push({
                        name: wallet.name,
                        address: wallet.address,
                        type: wallet.type,
                        error: error.message,
                        balance: 0,
                        balanceSOL: 0
                    });
                }
            }
        }

        return {
            success: true,
            balances,
            totalWallets: balances.length,
            message: `Retrieved balances for ${balances.length} Solana wallet(s)`
        };
    }

    /**
     * Encrypt data with password
     */
    encryptData(text, password) {
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(password, 'salt', 32);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher(algorithm, key);
        
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    }

    /**
     * Decrypt data with password
     */
    decryptData(encryptedData, password) {
        const algorithm = 'aes-256-cbc';
        const key = crypto.scryptSync(password, 'salt', 32);
        const parts = encryptedData.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        
        const decipher = crypto.createDecipher(algorithm, key);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    /**
     * Create wallet backup with metadata
     */
    async createBackup(password, backupName = null) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = backupName || `wallet-backup-${timestamp}.json`;
        
        const walletsData = Array.from(this.wallets.values());
        const backupData = {
            version: '1.0',
            createdAt: new Date().toISOString(),
            walletCount: walletsData.length,
            wallets: walletsData
        };

        try {
            const encryptedData = this.encryptData(JSON.stringify(backupData), password);
            const filePath = path.join(this.walletsDir, filename);
            
            await fs.writeFile(filePath, encryptedData);

            return {
                success: true,
                filename,
                filePath,
                walletCount: walletsData.length,
                message: `Backup created: ${filename}`
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                message: 'Failed to create backup'
            };
        }
    }
}

export default WalletManagerService;