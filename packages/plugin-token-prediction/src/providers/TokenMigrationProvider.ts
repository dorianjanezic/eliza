import { Connection, PublicKey } from '@solana/web3.js';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import { TokenUpdateEvent } from '../types/token';
import { TrenchBundleResponse, BundleInfo } from '../types/bundles';
import { MarketData, OHLCVData } from '../types/token';
import axios from 'axios';
import { logger } from '../utils/logger';
import { MarketDataProvider } from './MarketDataProvider';

// Predefined public keys for Pump.fun liquidity migrator and token metadata program
const PUMP_BONDING_CURVE_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_AMM_PROGRAM = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Configuration for token distribution validation
const CONFIG = {
    MAX_TOP_HOLDER_PERCENT: 50, // Threshold for top holder percentage (50% max allowed)
};

// Monitors token migrations from Pump.fun to Solana, emitting events with token data
export class TokenMigrationProvider extends EventEmitter {
    private connection: Connection; // Solana RPC connection
    private ws: WebSocket | null = null; // WebSocket for real-time logs
    private heartbeatInterval: NodeJS.Timeout | null = null; // Heartbeat timer
    private reconnectTimeout: NodeJS.Timeout | null = null; // Reconnect timer
    private isConnected: boolean = false; // Tracks WebSocket connection status
    private reconnectAttempts: number = 0; // Number of reconnection attempts
    private maxReconnectAttempts: number = 10; // Max reconnection attempts before giving up
    private TRENCH_API_URL = 'https://trench.bot/api/bundle/bundle_advanced'; // Trench API URL
    private responseTimeHistory: { timestamp: number; responseTime: number }[] = []; // Tracks API response times
    private readonly MAX_HISTORY_LENGTH = 100; // Limits response time history size
    private lastReconnectTime: number = 0; // Last time a reconnection was attempted
    private backoffInterval: number = 1000; // Initial backoff interval in milliseconds
    // Add a simple cache for Trench API responses
    private trenchApiCache: Map<string, { data: TrenchBundleResponse, timestamp: number }> = new Map();
    private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minute cache TTL
    // Add ammLogsSubscriptionId property
    private ammLogsSubscriptionId: number | null = null;
    private logsSubscriptionId: number | null = null;
    private heartbeatId: number | null = null;
    private lastHeartbeatResponse: number = 0;
    private readonly PROCESSED_TOKENS_CACHE = new Map<string, number>(); // Cache for processed tokens
    private readonly TOKEN_PROCESSING_COOLDOWN = 60000; // 1 minute cooldown between processing same token

    constructor(private runtime: IAgentRuntime) {
        super();
        // Initialize Solana connection with RPC URL from settings or default
        const rpcUrl = this.runtime.getSetting('SOLANA_RPC_URL');

        if (!rpcUrl) {
            elizaLogger.warn(`TokenMigrationProvider: No SOLANA_RPC_URL setting found. Will use default endpoint.`);
            this.connection = new Connection('https://api.mainnet-beta.solana.com', {
                commitment: 'confirmed',
                confirmTransactionInitialTimeout: 60000,
                wsEndpoint: 'wss://api.mainnet-beta.solana.com'
            });
        } else {
            elizaLogger.info(`TokenMigrationProvider: Using SOLANA_RPC_URL from settings: ${rpcUrl}`);
            this.connection = new Connection(rpcUrl, {
                commitment: 'confirmed',
                confirmTransactionInitialTimeout: 60000,
                wsEndpoint: rpcUrl.replace('https', 'wss')
            });
        }

        logger.api.request('solana_connection_init', {
            rpcUrl: rpcUrl || 'https://api.mainnet-beta.solana.com',
            fromSettings: !!rpcUrl
        });

        // Don't connect automatically in constructor - connection will be initiated when explicitly requested
    }

    // Calculates average response time from history
    private calculateAverageResponseTime(): number {
        if (this.responseTimeHistory.length === 0) return 0;
        const total = this.responseTimeHistory.reduce((sum, entry) => sum + entry.responseTime, 0);
        return total / this.responseTimeHistory.length;
    }

    // Tracks Trench API response time, maintaining a capped history
    private trackResponseTime(responseTime: number) {
        this.responseTimeHistory.push({ timestamp: Date.now(), responseTime });
        if (this.responseTimeHistory.length > this.MAX_HISTORY_LENGTH) {
            this.responseTimeHistory.shift(); // Remove oldest entry
        }

        // Log performance metrics if we have enough data
        if (this.responseTimeHistory.length > 5) {
            const avgTime = this.calculateAverageResponseTime();
            logger.performance.checkpoint('trench_api', 'average_response_time', undefined, avgTime);
        }
    }

    // Fetches bundle data for a mint address from Trench API
    public async analyzeMintAddress(mintAddress: string): Promise<TrenchBundleResponse> {
        const tokenId = mintAddress.substring(0, 8); // Use part of address as token ID for logging

        // Check if we have a cached response that's still valid
        const cachedResponse = this.trenchApiCache.get(mintAddress);
        if (cachedResponse && (Date.now() - cachedResponse.timestamp) < this.CACHE_TTL_MS) {
            logger.api.response('trench_bundle_analysis_cached', 200, 0);
            logger.market.received(tokenId, mintAddress, 'bundle_analysis_cached', {
                bundleCount: cachedResponse.data.success && cachedResponse.data.data ?
                    Object.keys(cachedResponse.data.data.bundles || {}).length : 0,
                fromCache: true,
                cacheAge: Math.round((Date.now() - cachedResponse.timestamp) / 1000) + 's'
            });
            return cachedResponse.data;
        }

        const fullUrl = `${this.TRENCH_API_URL}/${mintAddress}`;

        logger.api.request('trench_bundle_analysis', { mintAddress, url: fullUrl });

        const startTime = Date.now();
        try {
            // Updated request with proper headers and GET method (not POST)
            const response = await axios.get(fullUrl, {
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 15000 // 15 second timeout
            });

            const responseTime = Date.now() - startTime;
            this.trackResponseTime(responseTime);

            // Log successful response
            logger.api.response('trench_bundle_analysis', response.status, responseTime);

            // Process the response as-is (the API returns the bundle data directly)
            if (response.data) {
                const bundleData = response.data;

                // Log key metrics from successful analysis
                logger.market.received(tokenId, mintAddress, 'bundle_analysis', {
                    bundleCount: Object.keys(bundleData.bundles || {}).length,
                    totalSolSpent: bundleData.total_sol_spent,
                    totalHoldingPercentage: bundleData.total_holding_percentage
                });

                // Wrap the response to match our expected format
                const result = {
                    success: true,
                    data: bundleData,
                    error: undefined
                };

                // Cache the successful response
                this.trenchApiCache.set(mintAddress, { data: result, timestamp: Date.now() });

                return result;
            } else {
                logger.api.error('trench_bundle_analysis', new Error('API returned empty response'));
                return {
                    success: false,
                    data: undefined,
                    error: 'API returned empty response'
                };
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error in Trench API request');
            logger.api.error('trench_bundle_analysis', err);

            // Continue with plugin operation by providing a default response
            logger.market.received(tokenId, mintAddress, 'bundle_analysis', {
                bundleCount: 0,
                totalSolSpent: 0,
                totalHoldingPercentage: 0,
                error: err.message
            });

            // Cache the error response too to prevent repeated failed calls
            const errorResult = {
                success: false,
                data: undefined,
                error: err.message
            };
            this.trenchApiCache.set(mintAddress, { data: errorResult, timestamp: Date.now() });

            return errorResult;
        }
    }

    // Analyzes token holder distribution for legitimacy validation
    public async checkTokenDistribution(tokenAddress: string): Promise<{
        topHolderPercent: number;
        topHolders: Array<{ address: string; amount: number; percentage: number }>;
        suspiciousDistribution: boolean;
        isValid: boolean;
    }> {
        const tokenId = tokenAddress.substring(0, 8); // Generate token ID for logging
        logger.market.fetching(tokenId, tokenAddress, 'token_distribution');

        try {
            // Fetch largest token holders from Solana RPC (single API call)
            const largestAccounts = await this.connection.getTokenLargestAccounts(new PublicKey(tokenAddress));

            // Use the data directly from largestAccounts without making additional RPC calls
            const holders = largestAccounts.value.map((account) => {
                const amountBN = account.amount;
                const amountNumber = Number(amountBN) / Math.pow(10, 9); // Assuming 9 decimals for SPL tokens
                return {
                    address: account.address.toString(),
                    amount: amountNumber,
                    percentage: 0, // Will calculate after getting total supply
                };
            });

            // Calculate total supply from sum of holder amounts
            const totalSupply = holders.reduce((sum, holder) => sum + holder.amount, 0);

            // Calculate percentage for each holder
            holders.forEach((holder) => {
                holder.percentage = (holder.amount / totalSupply) * 100;
            });

            // Sort by percentage (descending)
            holders.sort((a, b) => b.percentage - a.percentage);

            // Validate distribution
            const topHolderPercent = holders[1]?.percentage || 0;
            const suspiciousDistribution = topHolderPercent > CONFIG.MAX_TOP_HOLDER_PERCENT;
            const isValid = !suspiciousDistribution;

            // Log distribution analysis results
            logger.market.received(tokenId, tokenAddress, 'token_distribution', {
                holderCount: holders.length,
                topHolderPercent,
                topHoldersCount: holders.filter(h => h.percentage > 5).length,
                suspiciousDistribution,
                isValid
            });

            // Flag suspicious distribution patterns
            if (suspiciousDistribution) {
                logger.market.suspicious(tokenId, tokenAddress, 'Suspicious token distribution', {
                    topHolderPercent,
                    topHolderAddress: holders[0]?.address
                });
            }

            return {
                topHolderPercent,
                topHolders: holders.slice(1, 11), // Return top 10 holders
                suspiciousDistribution,
                isValid,
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            logger.market.error(tokenId, tokenAddress, 'token_distribution', err);

            // Return default values on error
            return {
                topHolderPercent: 0,
                topHolders: [],
                suspiciousDistribution: false,
                isValid: true, // Assume valid if we can't check
            };
        }
    }

    // Sets up a 30-second heartbeat to keep WebSocket alive
    private setupHeartbeat(): void {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                logger.api.request('solana_ws_ping', { timestamp: Date.now() });
                this.ws.ping();
            } else {
                logger.api.error('solana_ws_ping', new Error('WebSocket not open for heartbeat'));
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

    // Reconnect with exponential backoff
    private reconnect(): void {
        this.clearReconnectTimeout();

        // Check if we've recently tried to reconnect (within 5 seconds)
        const now = Date.now();
        if (now - this.lastReconnectTime < 5000) {
            // Increase backoff time exponentially up to a maximum of 2 minutes
            this.backoffInterval = Math.min(this.backoffInterval * 2, 120000);
        } else {
            // Reset backoff if it's been a while since the last reconnect attempt
            this.backoffInterval = 1000;
        }

        this.reconnectAttempts++;
        this.lastReconnectTime = now;

        // Log reconnection attempt with backoff information
        logger.info(`Attempting to reconnect (attempt ${this.reconnectAttempts} of ${this.maxReconnectAttempts}) in ${this.backoffInterval}ms`);

        this.reconnectTimeout = setTimeout(() => {
            // Only try to reconnect if we haven't already connected in the meantime
            if (!this.isConnected) {
                this.connect();
            }
        }, this.backoffInterval);
    }

    // Update connect to remove historical scanning
    connect(): void {
        if (this.isConnected) {
            logger.info('Already connected to Solana WebSocket');
            return;
        }

        // Generate WebSocket URL
        const wsUrl = this.connection.rpcEndpoint.replace('https', 'wss');
        logger.info('Establishing Solana WebSocket connection:', { url: wsUrl });

        try {
            // Create and setup WebSocket connection
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                this.isConnected = true;
                // Only reset reconnect attempts after successful connection
                this.reconnectAttempts = 0;
                logger.info('Connected to Solana WebSocket');
                this.emit('open');

                this.setupHeartbeat();
                this.subscribeToLogs(); // Subscribe to migration logs
            });

            this.ws.on('message', async (data: WebSocket.Data) => {
                try {
                    const response = JSON.parse(data.toString());

                    // Handle rate limiting or error responses
                    if (response.error) {
                        logger.warn('WebSocket error response:', {
                            code: response.error.code,
                            message: response.error.message
                        });

                        // If we're being rate limited, add some additional backoff
                        if (response.error.code === -32005 ||
                            response.error.message?.includes('rate limit') ||
                            response.error.message?.includes('429')) {
                            this.backoffInterval = Math.min(this.backoffInterval * 2, 300000); // up to 5 minutes
                            logger.warn(`Rate limiting detected, increasing backoff to ${this.backoffInterval}ms`);
                        }
                        return;
                    }

                    // Handle subscription confirmations
                    if (response.id !== undefined && response.result !== undefined) {
                        if (this.logsSubscriptionId === response.id) {
                            this.logsSubscriptionId = response.result;
                            logger.info('Bonding curve logs subscription confirmed', { subscriptionId: response.result });
                        } else if (this.ammLogsSubscriptionId === response.id) {
                            this.ammLogsSubscriptionId = response.result;
                            logger.info('AMM logs subscription confirmed', { subscriptionId: response.result });
                        }
                        return;
                    }

                    // Handle logs notifications
                    if (response.method === 'logsNotification') {
                        const params = response.params;
                        if (!params?.result?.value?.logs || !params.result.value.signature) return;

                        const logs: string[] = params.result.value.logs;
                        const signature = params.result.value.signature;

                        if (!logs.length) return;

                        // Analyze logs to detect potential migrations
                        try {
                            // Direct check for AMM create_pool instructions with burn - this is our strongest migration signal
                            const hasCreatePoolInstruction = logs.some((log: string) =>
                                (log.includes(PUMP_AMM_PROGRAM.toString()) && log.includes('create_pool')) ||
                                (log.includes('CreatePool')) ||
                                (log.includes('Program log: Instruction: CreatePool'))
                            );

                            const hasBurnInstruction = logs.some((log: string) =>
                                log.includes('Instruction: Burn') ||
                                log.includes('burn') ||
                                log.includes('Burn')
                            );

                            // Check for involvement of both programs
                            const isBondingCurveLog = logs.some((log: string) =>
                                log.includes(PUMP_BONDING_CURVE_PROGRAM.toString()) ||
                                log.includes('Pump.fun: Raydium Migration') ||
                                log.includes('Bonding Curve')
                            );

                            const isAmmLog = logs.some((log: string) =>
                                log.includes(PUMP_AMM_PROGRAM.toString()) &&
                                (log.includes('initialLiquidity') || log.includes('Add liquidity') || log.includes('LP token'))
                            );

                            // This pattern (create_pool + burn) is highly indicative of migrations
                            const hasHighConfidenceMigrationPattern = hasCreatePoolInstruction && hasBurnInstruction;
                            const isMigrationCandidate = hasHighConfidenceMigrationPattern ||
                                                        (hasCreatePoolInstruction && isBondingCurveLog) ||
                                                        (isBondingCurveLog && isAmmLog && hasBurnInstruction);

                            // Log detection details
                            if (hasHighConfidenceMigrationPattern) {
                                logger.info('Detected high-confidence migration pattern (create_pool + burn)', { signature });
                            } else if (hasCreatePoolInstruction && isBondingCurveLog) {
                                logger.info('Detected potential migration (create_pool + bonding curve)', { signature });
                            } else if (isBondingCurveLog && isAmmLog && hasBurnInstruction) {
                                logger.info('Detected potential migration (bonding curve + AMM + burn)', { signature });
                            } else if (hasCreatePoolInstruction) {
                                logger.debug('Detected AMM create_pool instruction (not migration)', { signature });
                                return; // Not a migration
                            } else if (isBondingCurveLog) {
                                logger.debug('Detected bonding curve activity (not migration)', { signature });
                                return; // Not a migration
                            } else if (isAmmLog) {
                                logger.debug('Detected AMM activity (not migration)', { signature });
                                return; // Not a migration
                            } else {
                                logger.debug('No migration pattern detected in logs', { signature });
                                return; // Not a migration
                            }

                            // Process migration if detected
                            if (isMigrationCandidate) {
                                await this.processMigrationLogs(signature, logs);
                            }
                        } catch (error) {
                            logger.error('Error analyzing transaction logs:', {
                                error: error instanceof Error ? error.message : 'Unknown error',
                                signature
                            });
                        }
                    }
                } catch (error) {
                    logger.error('Error processing WebSocket message:', {
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                }
            });

            this.ws.on('close', (code, reason) => {
                this.isConnected = false;
                logger.warn('WebSocket connection closed:', { code, reason: reason.toString() });
                elizaLogger.warn(`TokenMigrationProvider WebSocket closed with code ${code}: ${reason.toString()}`);
                this.clearHeartbeat();
                this.reconnect();
            });

            this.ws.on('error', (error) => {
                logger.error('WebSocket error:', { error: error.message });
                elizaLogger.error(`TokenMigrationProvider WebSocket error: ${error.message}`);
                this.isConnected = false;
                this.reconnect();
            });

            this.ws.on('pong', () => {
                logger.info('Received pong from server');
            });
        } catch (error) {
            logger.error('Error creating WebSocket connection:', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            elizaLogger.error(`Failed to create TokenMigrationProvider WebSocket: ${error instanceof Error ? error.message : 'Unknown error'}`);
            this.isConnected = false;
            this.reconnect();
        }
    }

    // Subscribes to logs mentioning both the Pump.fun bonding curve and AMM programs
    private subscribeToLogs(): void {
        if (!this.ws || !this.isConnected) {
            logger.error('Cannot subscribe to logs: WebSocket not connected');
            return;
        }

        try {
            // Subscribe to logs from the Pump AMM program
            const ammSubscriptionId = Math.floor(Math.random() * 1000) + 1;
            this.ammLogsSubscriptionId = ammSubscriptionId;

            const ammSubscribeMsg = {
                jsonrpc: '2.0',
                id: ammSubscriptionId,
                method: 'logsSubscribe',
                params: [
                    { mentions: [PUMP_AMM_PROGRAM.toString()] },
                    { commitment: 'finalized' }
                ]
            };

            this.ws.send(JSON.stringify(ammSubscribeMsg));
            logger.info('Subscribed to Pump AMM logs', { subscriptionId: ammSubscriptionId });
        } catch (error) {
            logger.error('Failed to subscribe to logs:', { error: error instanceof Error ? error.message : 'Unknown error' });
        }
    }

    // Process Migration Logs
    private async processMigrationLogs(signature: string, logs: string[]): Promise<void> {
        try {
            elizaLogger.info("Starting to process migration logs", { signature, logCount: logs.length });

            // Find token mint address using multiple methods
            let tokenMint: string | undefined;

            // Skip known system tokens and wSOL
            const SYSTEM_TOKENS = [
                'So11111111111111111111111111111111111111112', // wSOL
                'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
                'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
                'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'  // BONK
            ];

            // Method 1: Check postTokenBalances in transaction
            const tx = await this.connection.getTransaction(signature, {
                maxSupportedTransactionVersion: 0,
            });

            if (tx?.meta?.postTokenBalances) {
                // Find the first token balance that's not a system token
                const validTokenBalance = tx.meta.postTokenBalances.find(balance =>
                    !SYSTEM_TOKENS.includes(balance.mint)
                );

                if (validTokenBalance?.mint) {
                    tokenMint = validTokenBalance.mint;
                    elizaLogger.info("Found token mint from postTokenBalances:", { tokenMint });
                }
            }

            // Method 2: Look for InitializeMint2 instruction
            if (!tokenMint) {
                const initMintLog = logs.find(log =>
                    log.includes("InitializeMint2") ||
                    log.includes("InitializeMint")
                );
                if (initMintLog) {
                    const mintMatch = initMintLog.match(/mint: ([1-9A-HJ-NP-Za-km-z]{32,44})/);
                    if (mintMatch && !SYSTEM_TOKENS.includes(mintMatch[1])) {
                        tokenMint = mintMatch[1];
                        elizaLogger.info("Found token mint from InitializeMint2:", { tokenMint });
                    }
                }
            }

            // Method 3: Search logs for mint address pattern
            if (!tokenMint) {
                for (const log of logs) {
                    const mintMatch = log.match(/([1-9A-HJ-NP-Za-km-z]{32,44})/);
                    if (mintMatch && !SYSTEM_TOKENS.includes(mintMatch[1])) {
                        tokenMint = mintMatch[1];
                        elizaLogger.info("Found token mint from log pattern:", { tokenMint });
                        break;
                    }
                }
            }

            if (!tokenMint) {
                elizaLogger.warn("Could not find token mint in migration logs", { signature });
                return;
            }

            // Check if we've processed this token recently
            const lastProcessed = this.PROCESSED_TOKENS_CACHE.get(tokenMint);
            if (lastProcessed && Date.now() - lastProcessed < this.TOKEN_PROCESSING_COOLDOWN) {
                elizaLogger.info("Skipping recently processed token", {
                    tokenMint,
                    lastProcessed: new Date(lastProcessed).toISOString(),
                    cooldownRemaining: Math.ceil((this.TOKEN_PROCESSING_COOLDOWN - (Date.now() - lastProcessed)) / 1000) + "s"
                });
                return;
            }

            // Update cache with current timestamp
            this.PROCESSED_TOKENS_CACHE.set(tokenMint, Date.now());

            // Fetch additional data
            const tokenMetadata = await this.fetchTokenMetadata(tokenMint);
            const bundleAnalysis = await this.analyzeTokenBundles(tokenMint);
            const distributionAnalysis = await this.checkTokenDistribution(tokenMint);

            // Construct token update event
            const tokenUpdate: TokenUpdateEvent = {
                tokenData: {
                    tokenId: signature,
                    address: tokenMint,
                    symbol: tokenMetadata.symbol || "UNKNOWN",
                    name: tokenMetadata.name || "Unknown Token",
                    marketCap: 0, // Will be updated by market data provider
                    bundleData: bundleAnalysis,
                    creatorRiskProfile: {
                        totalCreated: 1,
                        currentTokenHeldPercent: 0,
                        devWarnings: []
                    },
                    distribution: distributionAnalysis
                },
                timestamp: new Date().toISOString()
            };

            elizaLogger.info("Token migration to AMM event emitted:", {
                signature,
                tokenAddress: tokenMint,
                tokenName: tokenUpdate.tokenData.name,
                symbol: tokenUpdate.tokenData.symbol,
                bundleAnalysisSuccess: !!bundleAnalysis,
                distributionValid: !distributionAnalysis.suspiciousDistribution
            });

            this.emit('tokenUpdate', tokenUpdate.tokenData);
        } catch (error) {
            elizaLogger.error("Error processing migration logs:", { error, signature });
        }
    }

    // Returns the connection status
    public getConnectionStatus(): { isConnected: boolean, reconnectAttempts: number } {
        return {
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts
        };
    }

    // Returns stats on Trench API response times
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

    // Explicitly disconnect from WebSocket and clean up resources
    public disconnect(): void {
        logger.info('Disconnecting from Solana WebSocket');
        this.clearHeartbeat();
        this.clearReconnectTimeout();

        if (this.ws) {
            // Remove all listeners before closing
            this.ws.removeAllListeners();

            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            this.ws = null;
        }

        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.backoffInterval = 1000;
        logger.info('Disconnected from Solana WebSocket');
    }

    // Public method to check and report on the RPC URL settings
    public logConnectionSettings(): void {
        const rpcUrl = this.runtime.getSetting('SOLANA_RPC_URL') || 'https://api.mainnet-beta.solana.com';
        const wsUrl = rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');

        elizaLogger.info('TokenMigrationProvider Connection Settings:', {
            httpRpcUrl: rpcUrl,
            derivedWsUrl: wsUrl,
            isCustomUrl: !!this.runtime.getSetting('SOLANA_RPC_URL'),
            connectionStatus: this.isConnected ? 'Connected' : 'Disconnected',
            reconnectAttempts: this.reconnectAttempts
        });
    }

    private async fetchTokenMetadata(tokenMint: string): Promise<{ name: string; symbol: string }> {
        try {
            // First try to fetch token metadata from on-chain data
            const [metadataAddress] = PublicKey.findProgramAddressSync(
                [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), new PublicKey(tokenMint).toBuffer()],
                TOKEN_METADATA_PROGRAM_ID
            );
            const accountInfo = await this.connection.getAccountInfo(metadataAddress);
            if (accountInfo?.data) {
                const nameLength = accountInfo.data[65];
                const name = accountInfo.data.slice(66, 66 + nameLength).toString('utf8').replace(/\0/g, '');
                const symbol = name.slice(0, 6).toUpperCase(); // Derive symbol from name (first 6 chars)
                return { name, symbol };
            }
        } catch (error) {
            elizaLogger.error("Error fetching token metadata:", { error, tokenMint });
        }
        return { name: "Unknown Token", symbol: "UNKNOWN" };
    }

    private async analyzeTokenBundles(tokenMint: string): Promise<{
        totalBundles: number;
        totalSolSpent: number;
        currentHeldPercentage: number;
        totalBundledPercentage: number;
    }> {
        try {
            const bundleAnalysis = await this.analyzeMintAddress(tokenMint);
            if (bundleAnalysis.success && bundleAnalysis.data) {
                return {
                    totalBundles: Object.values(bundleAnalysis.data.bundles || {}).filter((b: BundleInfo) => b.holding_amount > 0).length,
                    totalSolSpent: bundleAnalysis.data.total_sol_spent || 0,
                    currentHeldPercentage: bundleAnalysis.data.total_holding_percentage || 0,
                    totalBundledPercentage: bundleAnalysis.data.total_percentage_bundled || 0,
                };
            }
        } catch (error) {
            elizaLogger.error("Error analyzing token bundles:", { error, tokenMint });
        }
        return {
            totalBundles: 0,
            totalSolSpent: 0,
            currentHeldPercentage: 0,
            totalBundledPercentage: 0,
        };
    }
}

export default TokenMigrationProvider;