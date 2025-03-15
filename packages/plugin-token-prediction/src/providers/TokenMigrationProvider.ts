// TokenMigrationProvider.ts
import { Connection, PublicKey } from '@solana/web3.js';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import { TokenUpdateEvent } from '../types/token';
import { TrenchBundleResponse, BundleInfo } from '../types/bundles';
import axios from 'axios';

const PUMP_LIQUIDITY_MIGRATOR = new PublicKey('39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg');
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const CONFIG = {
    MAX_TOP_HOLDER_PERCENT: 50, // Adjust as needed
};

export class TokenMigrationProvider extends EventEmitter {
    private connection: Connection;
    private ws: WebSocket | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private isConnected: boolean = false;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 10;
    private TRENCH_API_URL = 'https://trench.bot/api/bundle/bundle_advanced';
    private responseTimeHistory: { timestamp: number; responseTime: number }[] = [];
    private readonly MAX_HISTORY_LENGTH = 100;

    constructor(private runtime: IAgentRuntime) {
        super();
        const rpcUrl = this.runtime.getSetting('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.connect();
    }

    private calculateAverageResponseTime(): number {
        if (this.responseTimeHistory.length === 0) return 0;
        const total = this.responseTimeHistory.reduce((sum, entry) => sum + entry.responseTime, 0);
        return total / this.responseTimeHistory.length;
    }

    private trackResponseTime(responseTime: number) {
        this.responseTimeHistory.push({ timestamp: Date.now(), responseTime });
        if (this.responseTimeHistory.length > this.MAX_HISTORY_LENGTH) {
            this.responseTimeHistory.shift();
        }
        const avgResponseTime = this.calculateAverageResponseTime();
        // elizaLogger.info(`Trench API Response Time: ${responseTime}ms (Avg: ${avgResponseTime.toFixed(0)}ms)`);
    }

    private async analyzeMintAddress(mintAddress: string): Promise<TrenchBundleResponse> {
        const startTime = Date.now();
        try {
            // elizaLogger.info(`Starting bundle analysis for mint address: ${mintAddress}`);
            const response = await axios.get(`${this.TRENCH_API_URL}/${mintAddress}`, {
                headers: { 'Content-Type': 'application/json' },
            });
            const responseTime = Date.now() - startTime;
            this.trackResponseTime(responseTime);
            return { success: true, data: response.data };
        } catch (error: any) {
            const responseTime = Date.now() - startTime;
            this.trackResponseTime(responseTime);
            elizaLogger.error(`Error analyzing bundle for ${mintAddress}:`, {
                error: error.response?.data?.message || error.message,
            });
            return { success: false, error: error.response?.data?.message || error.message };
        }
    }

    private async checkTokenDistribution(tokenAddress: string): Promise<{
        holderCount: number;
        topHolderPercent: number;
        topHolders: Array<{ address: string; amount: number; percentage: number }>;
        suspiciousDistribution: boolean;
        isValid: boolean;
    }> {
        try {
            const tokenPublicKey = new PublicKey(tokenAddress);
            const accounts = await this.connection.getTokenLargestAccounts(tokenPublicKey);

            if (accounts.value.length === 0) {
                elizaLogger.warn('No token accounts found');
                return { isValid: false, holderCount: 0, topHolderPercent: 0, topHolders: [], suspiciousDistribution: false };
            }

            const totalSupply = BigInt(1e9 * 1e6); // 1B tokens, 6 decimals
            const topHolderAmount = BigInt(accounts.value[1].amount); // Top holder after liquidity pool
            const topHolderPercent = Number(topHolderAmount) / Number(totalSupply) * 100;

            const suspiciousThreshold = 0.03;
            const similarHoldingsThreshold = 10;
            let consecutiveSimilarCount = 0;
            let maxConsecutiveSimilar = 0;

            for (let i = 1; i < Math.min(accounts.value.length, 20); i++) {
                const currentAmount = BigInt(accounts.value[i].amount);
                const nextAmount = BigInt(accounts.value[i + 1]?.amount || 0);
                if (nextAmount === BigInt(0)) continue;
                const difference = currentAmount > nextAmount ? currentAmount - nextAmount : nextAmount - currentAmount;
                const percentDiff = Number(difference) / Number(currentAmount) * 100;
                if (percentDiff < suspiciousThreshold) {
                    consecutiveSimilarCount++;
                    maxConsecutiveSimilar = Math.max(maxConsecutiveSimilar, consecutiveSimilarCount);
                } else {
                    consecutiveSimilarCount = 0;
                }
            }

            const suspiciousDistribution = maxConsecutiveSimilar >= similarHoldingsThreshold;
            if (suspiciousDistribution) {
                elizaLogger.warn(`Suspicious token distribution detected: ${maxConsecutiveSimilar + 1} consecutive accounts have very similar holdings`);
            }

            const topHolders = accounts.value.slice(0, 20).map(account => ({
                address: account.address.toBase58(),
                amount: Number(account.amount) / 1e6, // Human-readable tokens
                percentage: (Number(account.amount) * 100) / Number(totalSupply),
            }));

            // elizaLogger.info(`Token distribution for ${tokenAddress}:`);
            // elizaLogger.info(`Total holders: ${accounts.value.length}`);
            // elizaLogger.info(`Top holder percentage: ${topHolderPercent.toFixed(2)}%`);
            // topHolders.forEach((holder, index) => {
                // elizaLogger.info(`  ${index + 1}. ${holder.address}: ${holder.amount.toFixed(6)} (${holder.percentage.toFixed(2)}%)`);
            // });

            const isValid = topHolderPercent <= CONFIG.MAX_TOP_HOLDER_PERCENT && !suspiciousDistribution;
            if (!isValid && suspiciousDistribution) {
                elizaLogger.warn('Token distribution appears manipulated with multiple accounts holding similar amounts');
            }

            return { isValid, holderCount: accounts.value.length, topHolderPercent, topHolders, suspiciousDistribution };
        } catch (error) {
            elizaLogger.error('Error checking token distribution:', { error: error instanceof Error ? error.message : 'Unknown error' });
            return { isValid: false, holderCount: 0, topHolderPercent: 0, topHolders: [], suspiciousDistribution: false };
        }
    }

    private async processMigrationLogs(logs: string[], signature: string): Promise<void> {
        try {
            const initialize2Log = logs.find(log => log.includes('Program log: initialize2: InitializeInstruction2'));
            if (!initialize2Log) return;

            const tx = await this.connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
            if (!tx || !tx.transaction.message) {
                elizaLogger.info(`Failed to fetch transaction details for signature: ${signature}`);
                return;
            }

            const accountKeys = tx.transaction.message.getAccountKeys();
            if (accountKeys.length <= 18) {
                elizaLogger.info(`Insufficient account keys in transaction: ${signature}`);
                return;
            }

            const tokenAddress = accountKeys.get(18)?.toString();
            const liquidityAddress = accountKeys.get(2)?.toString();

            if (!tokenAddress || !liquidityAddress) {
                elizaLogger.info('Missing token or liquidity address');
                return;
            }

            let tokenName = 'Unknown';
            let symbol = 'UNKNOWN';
            try {
                const [metadataAddress] = PublicKey.findProgramAddressSync(
                    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), new PublicKey(tokenAddress).toBuffer()],
                    TOKEN_METADATA_PROGRAM_ID
                );
                const accountInfo = await this.connection.getAccountInfo(metadataAddress);
                if (accountInfo?.data) {
                    const nameLength = accountInfo.data[65];
                    tokenName = accountInfo.data.slice(66, 66 + nameLength).toString('utf8').replace(/\0/g, '');
                    symbol = tokenName.slice(0, 6).toUpperCase();
                }
            } catch (error) {
                elizaLogger.error('Error fetching token metadata:', { error: error instanceof Error ? error.message : 'Unknown error' });
            }

            const bundleAnalysis = await this.analyzeMintAddress(tokenAddress);
            const distribution = await this.checkTokenDistribution(tokenAddress);

            const tokenUpdate: TokenUpdateEvent = {
                tokenData: {
                    tokenId: signature,
                    address: tokenAddress,
                    symbol,
                    name: tokenName,
                    marketCap: 0,
                    bundleData: bundleAnalysis.success && bundleAnalysis.data ? {
                        totalBundles: Object.values(bundleAnalysis.data.bundles).filter((b: BundleInfo) => b.holding_amount > 0).length,
                        totalSolSpent: bundleAnalysis.data.total_sol_spent,
                        currentHeldPercentage: bundleAnalysis.data.total_holding_percentage,
                        totalBundledPercentage: bundleAnalysis.data.total_percentage_bundled,
                        bonded: bundleAnalysis.data.bonded,
                    } : {
                        totalBundles: 0,
                        totalSolSpent: 0,
                        currentHeldPercentage: 0,
                        totalBundledPercentage: 0,
                        bonded: false,
                    },
                    creatorRiskProfile: bundleAnalysis.success && bundleAnalysis.data ? {
                        totalCreated: bundleAnalysis.data.creator_analysis.history.total_coins_created,
                        currentTokenHeldPercent: bundleAnalysis.data.creator_analysis.holding_percentage,
                        devWarnings: bundleAnalysis.data.creator_analysis.warning_flags.filter((w): w is string => w !== null),
                    } : {
                        totalCreated: 0,
                        currentTokenHeldPercent: 0,
                        devWarnings: [],
                    },
                    distribution: {
                        holderCount: distribution.holderCount,
                        topHolderPercent: distribution.topHolderPercent,
                        topHolders: distribution.topHolders,
                        suspiciousDistribution: distribution.suspiciousDistribution,
                    },
                },
                timestamp: new Date().toISOString(),
            };

            this.emit('tokenUpdate', tokenUpdate.tokenData);
            elizaLogger.info('Token migration event emitted:', {
                signature,
                tokenAddress,
                liquidityAddress,
                tokenName,
                symbol,
                bundleAnalysisSuccess: bundleAnalysis.success,
                distributionValid: distribution.isValid,
            });
        } catch (error) {
            elizaLogger.error('Error processing migration transaction:', {
                signature,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }

    private setupHeartbeat(): void {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                elizaLogger.info('Sending WebSocket ping...');
                this.ws.ping();
            } else {
                elizaLogger.warn('Heartbeat failed - WebSocket not open');
                this.reconnect();
            }
        }, 30000);
    }

    private clearHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private clearReconnectTimeout(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }

    connect(): void {
        if (this.isConnected) {
            elizaLogger.warn('Already connected to Solana WebSocket');
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            elizaLogger.error('Max reconnection attempts reached. Migration provider offline.');
            this.emit('streamOffline');
            return;
        }

        const wsUrl = this.runtime.getSetting('SOLANA_WSS_URL') || 'wss://api.mainnet-beta.solana.com';
        elizaLogger.info('Connecting to Solana WebSocket:', { url: wsUrl });

        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            elizaLogger.info('WebSocket connected');
            this.setupHeartbeat();
            this.subscribeToLogs();
        });

        this.ws.on('message', async (data: WebSocket.Data) => {
            try {
                const response = JSON.parse(data.toString());
                if (response.result !== undefined && response.id === 1) {
                    elizaLogger.info(`Subscription confirmed! Subscription ID: ${response.result}`);
                    return;
                }

                if (response.method !== 'logsNotification') return;

                const logs = response.params?.result?.value?.logs;
                const signature = response.params?.result?.value?.signature;
                if (!logs?.length) return;

                await this.processMigrationLogs(logs, signature);
            } catch (error) {
                elizaLogger.error('Error processing WebSocket message:', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        });

        this.ws.on('close', (code, reason) => {
            this.isConnected = false;
            elizaLogger.warn('WebSocket connection closed:', { code, reason: reason.toString() });
            this.clearHeartbeat();
            this.reconnect();
        });

        this.ws.on('error', (error) => {
            elizaLogger.error('WebSocket error:', { error: error.message });
            this.reconnect();
        });

        this.ws.on('pong', () => {
            elizaLogger.info('Received pong from server');
        });
    }

    private subscribeToLogs(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            elizaLogger.error('Cannot subscribe: WebSocket is not open');
            return;
        }

        const subscription = {
            jsonrpc: '2.0',
            id: 1,
            method: 'logsSubscribe',
            params: [
                { mentions: [PUMP_LIQUIDITY_MIGRATOR.toString()] },
                { commitment: 'confirmed' },
            ],
        };

        this.ws.send(JSON.stringify(subscription));
        elizaLogger.info('Subscription request sent');
    }

    private reconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            elizaLogger.error('Max reconnection attempts reached. Migration provider offline.');
            this.emit('streamOffline');
            return;
        }

        this.reconnectAttempts++;
        const reconnectDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        elizaLogger.info('Planning reconnection:', {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            delayMs: reconnectDelay,
        });

        this.clearReconnectTimeout();
        this.reconnectTimeout = setTimeout(() => {
            if (!this.isConnected) {
                if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
                    this.ws.close();
                }
                this.ws = null;
                elizaLogger.info('Attempting to reconnect...');
                this.connect();
            } else {
                elizaLogger.info('Reconnection skipped - already connected');
            }
        }, reconnectDelay);
    }

    disconnect(): void {
        this.clearHeartbeat();
        this.clearReconnectTimeout();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.reconnectAttempts = 0;
        elizaLogger.info('Disconnected from Solana WebSocket');
    }

    public getConnectionStatus(): { isConnected: boolean; reconnectAttempts: number } {
        return { isConnected: this.isConnected, reconnectAttempts: this.reconnectAttempts };
    }

    public getResponseTimeStats() {
        const times = this.responseTimeHistory;
        if (times.length === 0) return null;

        const responseTimesMs = times.map(t => t.responseTime);
        return {
            average: this.calculateAverageResponseTime(),
            min: Math.min(...responseTimesMs),
            max: Math.max(...responseTimesMs),
            last: responseTimesMs[responseTimesMs.length - 1],
            sampleSize: times.length,
        };
    }
}

export default TokenMigrationProvider;