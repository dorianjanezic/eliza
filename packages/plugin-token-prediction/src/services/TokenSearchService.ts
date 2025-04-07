import { IAgentRuntime, Memory, UUID } from '@ai16z/eliza';
import { stringToUuid } from '@ai16z/eliza';
import { TokenData, OHLCVData } from '../types';
import { elizaLogger } from '@ai16z/eliza';

export class TokenSearchService {
    private readonly tokenSearchRoomId: UUID;

    constructor(private runtime: IAgentRuntime) {
        this.tokenSearchRoomId = stringToUuid('token-search-room');
    }

    private createFeatureDescription(tokenData: TokenData): string {
        // Extract key metrics from bundle data
        const bundleMetrics = tokenData.bundleData ? {
            totalBundles: tokenData.bundleData.totalBundles,
            totalSolSpent: tokenData.bundleData.totalSolSpent,
            currentHeldPercentage: tokenData.bundleData.currentHeldPercentage
        } : null;

        // Extract key risk metrics
        const riskMetrics = tokenData.creatorRiskProfile ? {
            tokensCreated: tokenData.creatorRiskProfile.totalCreated,
            currentHolding: tokenData.creatorRiskProfile.currentTokenHeldPercent,
            devWarnings: tokenData.creatorRiskProfile.devWarnings
        } : null;

        // Create a structured description with key metrics
        return [
            // Bundle metrics
            bundleMetrics ? `Bundle: ${bundleMetrics.totalBundles} bundles, ${bundleMetrics.totalSolSpent} SOL spent, ${bundleMetrics.currentHeldPercentage}% held` : null,

            // Risk profile
            riskMetrics ? `Risk: ${riskMetrics.tokensCreated} tokens created, ${riskMetrics.currentHolding}% held${riskMetrics.devWarnings.length > 0 ? `, ${riskMetrics.devWarnings.length} warnings` : ''}` : null,

            // Trading activity
            `Trading: ${tokenData.uniqueTraders1h} traders, ${tokenData.trades1h} trades, ${tokenData.volume1hUSD} USD 1h`,

            // Market metrics
            `Market: ${tokenData.holderCount} holders, ${tokenData.marketCap} USD cap`,

            // Price changes
            `Price: ${tokenData.priceChange1h}% 1h, ${tokenData.priceChange24h}% 24h`,

            // Risk flags
            tokenData.distribution?.suspiciousDistribution ? 'Suspicious distribution detected' : null
        ]
        .filter(Boolean) // Remove null values
        .join(' | ');
    }

    async storeTokenForSearch(tokenData: TokenData) {
        // Ensure the search room exists
        await this.runtime.ensureRoomExists(this.tokenSearchRoomId);
        await this.runtime.ensureParticipantInRoom(this.runtime.agentId, this.tokenSearchRoomId);

        const searchMemory: Memory = {
            id: stringToUuid(`search-${tokenData.tokenId}`),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: this.tokenSearchRoomId,
            content: {
                text: this.createFeatureDescription(tokenData),
                metadata: {
                    type: "token_search",
                    tokenId: tokenData.tokenId,
                    symbol: tokenData.symbol,
                    features: {
                        bundleData: tokenData.bundleData,
                        creatorRiskProfile: tokenData.creatorRiskProfile,
                        tradingActivity: {
                            uniqueTraders: tokenData.uniqueTraders1h,
                            tradeCount: tokenData.trades1h
                        },
                        priceChanges: {
                            oneHour: tokenData.priceChange1h,
                            twentyFourHour: tokenData.priceChange24h
                        },
                        volume: {
                            oneHour: tokenData.volume1hUSD,
                            twentyFourHour: tokenData.volume24hUSD
                        },
                        marketMetrics: {
                            holderCount: tokenData.holderCount,
                            marketCap: tokenData.marketCap
                        },
                        riskMetrics: {
                            suspiciousDistribution: tokenData.distribution?.suspiciousDistribution,
                            creatorHistory: tokenData.creatorRiskProfile?.totalCreated,
                            currentHoldings: tokenData.creatorRiskProfile?.currentTokenHeldPercent
                        }
                    }
                }
            },
            createdAt: Date.now()
        };

        await this.runtime.messageManager.addEmbeddingToMemory(searchMemory);
        await this.runtime.messageManager.createMemory(searchMemory);
        elizaLogger.info(`Stored token search data for ${tokenData.tokenId}`);
    }

    async findSimilarTokens(tokenData: TokenData, limit: number = 3): Promise<Array<{
        tokenId: string;
        symbol: string;
        similarity: number;
    }>> {
        // Log all tokens in the search room using getMemoriesByRoomIds
        const allMemories = await this.runtime.messageManager.getMemoriesByRoomIds({
            roomIds: [this.tokenSearchRoomId]
        });

        elizaLogger.info('Tokens in search room:', {
            count: allMemories.length,
            tokens: allMemories.map(m => ({
                id: m.id,
                tokenId: (m.content.metadata as { tokenId?: string })?.tokenId,
                symbol: (m.content.metadata as { symbol?: string })?.symbol,
                type: (m.content.metadata as { type?: string })?.type
            }))
        });

        const searchMemory: Memory = {
            id: stringToUuid('temp-search'),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: this.tokenSearchRoomId,
            content: {
                text: this.createFeatureDescription(tokenData),
                metadata: {
                    type: "token_search",
                    features: {
                        bundleData: tokenData.bundleData,
                        creatorRiskProfile: tokenData.creatorRiskProfile,
                        tradingActivity: {
                            uniqueTraders: tokenData.uniqueTraders1h,
                            tradeCount: tokenData.trades1h
                        },
                        priceChanges: {
                            oneHour: tokenData.priceChange1h,
                            twentyFourHour: tokenData.priceChange24h
                        },
                        volume: {
                            oneHour: tokenData.volume1hUSD,
                            twentyFourHour: tokenData.volume24hUSD
                        },
                        marketMetrics: {
                            holderCount: tokenData.holderCount,
                            marketCap: tokenData.marketCap
                        },
                        riskMetrics: {
                            suspiciousDistribution: tokenData.distribution?.suspiciousDistribution,
                            creatorHistory: tokenData.creatorRiskProfile?.totalCreated,
                            currentHoldings: tokenData.creatorRiskProfile?.currentTokenHeldPercent
                        }
                    }
                }
            },
            createdAt: Date.now()
        };

        const memoryWithEmbedding = await this.runtime.messageManager.addEmbeddingToMemory(searchMemory);

        if (!memoryWithEmbedding.embedding) {
            elizaLogger.warn('Failed to generate embedding for token search');
            return [];
        }

        const similarMemories = await this.runtime.messageManager.searchMemoriesByEmbedding(
            memoryWithEmbedding.embedding,
            {
                roomId: this.tokenSearchRoomId,
                match_threshold: 0,
                count: limit,
                unique: false
            }
        );

        // Extract tokenIds and calculate similarity scores
        const similarTokens = similarMemories
            .map(memory => {
                const metadata = memory.content.metadata as { tokenId: string; symbol: string };
                return {
                    tokenId: metadata.tokenId,
                    symbol: metadata.symbol,
                    similarity: memory.similarity || 0
                };
            })
            .filter(token => token.tokenId !== tokenData.tokenId); // Exclude the current token

        elizaLogger.info(`Found ${similarTokens.length} similar tokens for ${tokenData.tokenId}`);
        return similarTokens;
    }
}