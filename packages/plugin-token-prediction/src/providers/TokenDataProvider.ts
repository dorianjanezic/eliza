import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import { EventEmitter } from 'events';
import type { TokenDataRecord } from '../types/tokenData';
import type { TokenData, TokenUpdateEvent } from '../types/token';
import { TokenDataService } from '../services/TokenDataService';
import { logger } from '../utils/logger';

/**
 * TokenDataProvider - A provider that emits historical token data for backtesting
 * Can be used as a drop-in replacement for TokenMigrationProvider
 */
export class TokenDataProvider extends EventEmitter {
    private tokenDataService: TokenDataService;
    private isRunning = false;
    private currentTokenIndex = 0;
    private tokens: TokenDataRecord[] = [];
    private emitIntervalMs: number;
    private emitInterval: NodeJS.Timeout | null = null;

    /**
     * Constructor
     * @param runtime The Eliza runtime
     * @param options.initialTokens Optional array of token data records to use
     * @param options.emitIntervalMs How frequently to emit tokens in milliseconds (defaults to 5000)
     */
    constructor(
        private runtime: IAgentRuntime,
        private options: {
            initialTokens?: TokenDataRecord[];
            emitIntervalMs?: number;
        } = {}
    ) {
        super();
        this.tokenDataService = new TokenDataService(runtime);
        this.tokens = options.initialTokens || [];
        this.emitIntervalMs = options.emitIntervalMs || 5000; // Default to emitting every 5 seconds
    }

    /**
     * Loads tokens from the database based on criteria
     */
    async loadTokens(options: {
        tokenIds?: string[];
        startTime?: string;
        endTime?: string;
        onlyInitial?: boolean;
        limit?: number;
    } = {}): Promise<TokenDataRecord[]> {
        try {
            let tokens: TokenDataRecord[] = [];

            if (options.onlyInitial) {
                // Get all tokens with initial checks
                tokens = await this.tokenDataService.getAllTokensWithInitialChecks();

                // Log the operation
                logger.data.retrieve('loadTokens', tokens.length, { onlyInitial: true });
            } else if (options.tokenIds?.length) {
                // Get all data for specific token IDs
                const allTokensData: TokenDataRecord[] = [];

                for (const tokenId of options.tokenIds) {
                    const tokenData = await this.tokenDataService.getTokenDataByTokenId(tokenId);
                    allTokensData.push(...tokenData);
                }

                // Filter only initial checks for each token
                const tokenMap = new Map<string, TokenDataRecord>();
                for (const record of allTokensData) {
                    if (record.isInitialCheck && !tokenMap.has(record.tokenId)) {
                        tokenMap.set(record.tokenId, record);
                    }
                }

                tokens = Array.from(tokenMap.values());

                // Log the operation
                logger.data.retrieve('loadTokens', tokens.length, { tokenIds: options.tokenIds });
            }

            // Apply limit if specified
            if (options.limit && tokens.length > options.limit) {
                tokens = tokens.slice(0, options.limit);
            }

            // Set the loaded tokens
            this.tokens = tokens;
            this.currentTokenIndex = 0;

            return tokens;
        } catch (error) {
            const err = error instanceof Error ? error.message : 'Unknown error';
            logger.data.error('loadTokens', err);
            return [];
        }
    }

    /**
     * Start emitting token data for backtesting
     */
    start(): void {
        if (this.isRunning) {
            logger.warn('TokenDataProvider already running', { component: 'provider', type: 'backtest' });
            return;
        }

        if (this.tokens.length === 0) {
            logger.warn('No tokens loaded for backtesting', { component: 'provider', type: 'backtest' });
            this.emit('error', new Error('No tokens loaded for backtesting'));
            return;
        }

        this.isRunning = true;
        logger.info(`Started TokenDataProvider with ${this.tokens.length} tokens`, { component: 'provider', type: 'backtest' });

        // Start emitting tokens at the specified interval
        this.emitInterval = setInterval(async () => {
            await this.emitNextToken();
        }, this.emitIntervalMs);

        // Emit the first token immediately
        this.emitNextToken().catch(error => {
            logger.error('Error emitting first token', { error: error.message });
        });
    }

    /**
     * Stop emitting token data
     */
    stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        if (this.emitInterval) {
            clearInterval(this.emitInterval);
            this.emitInterval = null;
        }

        logger.info('Stopped TokenDataProvider', { component: 'provider', type: 'backtest' });
    }

    /**
     * Emit the next token in the sequence
     */
    private async emitNextToken(): Promise<void> {
        if (!this.isRunning || this.tokens.length === 0) {
            return;
        }

        // If we've reached the end, stop or loop based on configuration
        if (this.currentTokenIndex >= this.tokens.length) {
            logger.info('Finished emitting all tokens', { component: 'provider', type: 'backtest' });
            this.stop();
            this.emit('complete');
            return;
        }

        const tokenRecord = this.tokens[this.currentTokenIndex];

        // Convert TokenDataRecord to TokenData format
        const tokenData: TokenData = {
            tokenId: tokenRecord.tokenId,
            address: tokenRecord.address,
            symbol: tokenRecord.symbol,
            name: tokenRecord.name,
            marketCap: tokenRecord.marketCap,
            price: tokenRecord.price,

            // Convert distribution if available
            ...(tokenRecord.topHolderPercent && tokenRecord.topHolders && {
                distribution: {
                    topHolderPercent: tokenRecord.topHolderPercent,
                    topHolders: tokenRecord.topHolders,
                    suspiciousDistribution: !!tokenRecord.suspiciousDistribution
                }
            }),

            // Convert bundle data if available
            ...(tokenRecord.totalBundles && {
                bundleData: {
                    totalBundles: tokenRecord.totalBundles,
                    totalSolSpent: tokenRecord.totalSolSpent || 0,
                    currentHeldPercentage: tokenRecord.currentHeldPercentage || 0,
                    totalBundledPercentage: tokenRecord.totalBundledPercentage || 0
                }
            })
        };

        // Create the token update event
        const updateEvent: TokenUpdateEvent = {
            tokenData,
            timestamp: tokenRecord.timestamp
        };

        // Emit the token update event (same event that TokenMigrationProvider emits)
        this.emit('tokenUpdate', updateEvent);

        // Log the emitted token
        logger.info(`Emitted token ${tokenData.symbol} [${tokenData.tokenId}] for backtesting`,
                   { component: 'provider', type: 'backtest', tokenId: tokenData.tokenId, index: this.currentTokenIndex });

        // Wait for token processing to complete
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                logger.warn(`Token processing timeout for ${tokenData.tokenId}`, { component: 'provider', type: 'backtest' });
                this.currentTokenIndex++;
                resolve();
            }, 30000); // 30 second timeout

            // Listen for token processing completion
            const onComplete = (completedTokenId: string) => {
                if (completedTokenId === tokenData.tokenId) {
                    clearTimeout(timeout);
                    this.removeListener('tokenProcessed', onComplete);
                    this.currentTokenIndex++;
                    resolve();
                }
            };

            this.on('tokenProcessed', onComplete);
        });
    }

    /**
     * Reset to start emitting tokens from the beginning
     */
    reset(): void {
        this.currentTokenIndex = 0;

        if (this.isRunning) {
            logger.info('Reset TokenDataProvider to start from beginning', { component: 'provider', type: 'backtest' });
        }
    }

    /**
     * Sets the interval between token emissions
     * @param intervalMs Interval in milliseconds
     */
    setEmitInterval(intervalMs: number): void {
        if (intervalMs > 0) {
            this.emitIntervalMs = intervalMs;
            logger.info(`TokenDataProvider interval set to ${intervalMs}ms`,
                      { component: 'provider', type: 'backtest', action: 'setInterval' });

            // If we're already running, restart the interval with new timing
            if (this.isRunning && this.emitInterval) {
                clearInterval(this.emitInterval);
                this.emitInterval = setInterval(() => this.emitNextToken(), this.emitIntervalMs);
            }
        }
    }
}

export default TokenDataProvider;