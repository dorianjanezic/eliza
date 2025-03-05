import {
    IAgentRuntime,
    stringToUuid,
    elizaLogger,
    UUID,
    Memory as CoreMemory,
    Content,
} from '@ai16z/eliza';
import { BirdeyeClient, TokenMarketData } from './birdeyeClient';

interface CheckMemoryContent extends Content {
    text: string;
    metadata: {
        predictionMemoryId: UUID;
        checkNumber: number;
        marketData: TokenMarketData;
        initialMarketCap: number;
        [key: string]: any;
    };
}

interface CheckMemory extends CoreMemory {
    id: UUID;
    userId: UUID;
    agentId: UUID;
    roomId: UUID;
    content: CheckMemoryContent;
    createdAt: number;
}

interface PredictionMemoryContent extends Content {
    text: string;
    metadata: {
        analysis: SimplifiedAnalysis;
        originalToken?: any;
        [key: string]: any;
    };
}

interface PredictionMemory extends CoreMemory {
    id: UUID;
    userId: UUID;
    agentId: UUID;
    roomId: UUID;
    content: PredictionMemoryContent;
    createdAt: number;
}

interface SummaryMemoryContent extends Content {
    text: string;
    metadata: {
        tokenId: string;
        prediction: SimplifiedAnalysis;
        actualResults: {
            finalMarketCap: number;
            maxMarketCap: number;
            achievedExit: boolean;
            timestamp: string;
        };
        accuracy: {
            predictionCorrect: boolean;
            confidence: number;
        };
    };
}

interface SummaryMemory extends CoreMemory {
    id: UUID;
    userId: UUID;
    agentId: UUID;
    roomId: UUID;
    content: SummaryMemoryContent;
    createdAt: number;
}

interface SimplifiedAnalysis {
    token_details: { address: string; symbol: string; name: string };
    current_metrics: { market_cap: number; holders: number; volume_1h: number; unique_traders_1h: number };
    prediction: {
        entry_decision: 'BUY' | 'IGNORE';
        market_cap_predictions: { '2min': number; '4min': number; '6min': number; '8min': number; '10min': number };
        confidence: number;
        supporting_factors: string[];
        risk_factors: string[];
    };
    trading_decision: { action: 'BUY' | 'IGNORE'; confidence: number; reasoning: string[] };
}

export class TokenLearningManager {
    private runtime: IAgentRuntime;
    private birdeyeClient: BirdeyeClient;
    private globalSummaryRoomId: UUID = '73355b17-44c8-0a24-a652-a2d678404d84'; // Fixed UUID

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
        this.birdeyeClient = new BirdeyeClient(runtime);
        this.initializeGlobalRoom();
    }

    private async initializeGlobalRoom() {
        await this.runtime.ensureRoomExists(this.globalSummaryRoomId);
        await this.runtime.ensureParticipantInRoom(this.runtime.agentId, this.globalSummaryRoomId);
        elizaLogger.info('Initialized global summary room:', { roomId: this.globalSummaryRoomId });
    }

    async recordCheckResult(predictionMemory: PredictionMemory, checkNumber: number): Promise<void> {
        const tokenAddress = predictionMemory.content.metadata.analysis.token_details.address;
        const roomId = predictionMemory.roomId;
        const initialMarketCap = predictionMemory.content.metadata.analysis.current_metrics.market_cap;

        try {
            const marketData = await this.birdeyeClient.getTokenData(tokenAddress);
            const checkMemoryId = stringToUuid(`check-${predictionMemory.id}-${checkNumber * 2}min`);
            const checkMemory: CheckMemory = {
                id: checkMemoryId,
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                roomId,
                content: {
                    text: `Check at ${checkNumber * 2}min for ${tokenAddress}\nMarket Cap: ${marketData.marketCap}`,
                    metadata: {
                        predictionMemoryId: predictionMemory.id,
                        checkNumber,
                        marketData,
                        initialMarketCap,
                    },
                },
                createdAt: Date.now(),
            };

            const memoryWithEmbedding = await this.runtime.messageManager.addEmbeddingToMemory(checkMemory);
            await this.runtime.messageManager.createMemory(memoryWithEmbedding, true);
            elizaLogger.info('Check memory created:', { checkMemoryId, roomId, tokenAddress });

            const savedMemory = await this.runtime.messageManager.getMemoryById(checkMemoryId);
            if (!savedMemory) {
                elizaLogger.error('Check memory not persisted:', { checkMemoryId, roomId });
            } else {
                elizaLogger.success('Check memory verified:', { checkMemoryId, roomId });
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            elizaLogger.error('Failed to record check result:', { tokenAddress, error: (error as Error).message });
        }
    }

    async finalizeTokenSummary(predictionMemory: PredictionMemory): Promise<SummaryMemory | null> {
        const tokenId = predictionMemory.content.metadata.analysis.token_details.address;
        const roomId = predictionMemory.roomId;
        const prediction = predictionMemory.content.metadata.analysis;

        elizaLogger.info('Starting summary finalization:', { tokenId, predictionId: predictionMemory.id });

        let checkMemories: CheckMemory[] = [];
        for (let attempt = 1; attempt <= 10; attempt++) {
            checkMemories = await this.getCheckMemories(predictionMemory.id!);
            elizaLogger.info('Check memories retrieved:', {
                tokenId,
                attempt,
                checkCount: checkMemories.length,
                checks: checkMemories.map(m => ({
                    id: m.id,
                    time: `${m.content.metadata.checkNumber * 2}min`,
                    marketCap: m.content.metadata.marketData.marketCap,
                })),
            });
            if (checkMemories.length >= 5) break;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (checkMemories.length < 5) {
            elizaLogger.warn(`Insufficient check memories for token ${tokenId} after retries`, { checkCount: checkMemories.length });
            return null;
        }

        const marketCaps = checkMemories.map(cm => cm.content.metadata.marketData.marketCap);
        const finalMarketCap = marketCaps[marketCaps.length - 1];
        const maxMarketCap = Math.max(...marketCaps);

        const predicted10min = prediction.prediction.market_cap_predictions['10min'];
        const achievedExit = prediction.prediction.entry_decision === 'BUY'
            ? finalMarketCap >= predicted10min * 0.9
            : finalMarketCap <= prediction.current_metrics.market_cap * 1.2;

        const summaryMemory: SummaryMemory = {
            id: stringToUuid(`summary-${tokenId}-${predictionMemory.id}`),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: this.globalSummaryRoomId,
            content: {
                text: `Token Summary\nSymbol: ${prediction.token_details.symbol}\nPrediction: ${prediction.prediction.entry_decision} (10min MC: ${predicted10min}, Confidence: ${(prediction.prediction.confidence * 100).toFixed(2)}%)\nActual Results: Final MC: ${finalMarketCap}, Max MC: ${maxMarketCap}, Achieved Goal: ${achievedExit ? 'Yes' : 'No'}`,
                metadata: {
                    tokenId,
                    prediction,
                    actualResults: {
                        finalMarketCap,
                        maxMarketCap,
                        achievedExit,
                        timestamp: new Date().toISOString(),
                    },
                    accuracy: {
                        predictionCorrect: achievedExit,
                        confidence: prediction.prediction.confidence,
                    },
                },
            },
            createdAt: Date.now(),
        };

        let stored = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const memoryWithEmbedding = await this.runtime.messageManager.addEmbeddingToMemory(summaryMemory);
                await this.runtime.messageManager.createMemory(memoryWithEmbedding, true);
                const savedSummary = await this.runtime.messageManager.getMemoryById(summaryMemory.id);

                if (savedSummary && savedSummary.roomId === this.globalSummaryRoomId) {
                    elizaLogger.success('Summary memory stored and verified:', {
                        summaryId: summaryMemory.id,
                        roomId: this.globalSummaryRoomId,
                        symbol: prediction.token_details.symbol,
                        createdAt: new Date(savedSummary.createdAt ?? Date.now()).toISOString(),
                    });
                    stored = true;
                    break;
                } else {
                    elizaLogger.warn('Summary not verified on attempt:', { attempt, summaryId: summaryMemory.id });
                }
            } catch (error) {
                elizaLogger.error('Failed to store summary on attempt:', {
                    attempt,
                    tokenId,
                    error: (error as Error).message
                });
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (!stored) {
            elizaLogger.error('Failed to store summary after retries:', { tokenId, summaryId: summaryMemory.id });
            return null;
        }

        const allSummaries = await this.runtime.messageManager.getMemoriesByRoomIds({
            roomIds: [this.globalSummaryRoomId],
        });
        elizaLogger.info('Current summaries in global room after storing (via getMemoriesByRoomIds):', {
            totalSummaries: allSummaries.length,
            summaryIds: allSummaries.map(m => m.id),
            summarySymbols: allSummaries.map(m => (m.content as SummaryMemoryContent).metadata.prediction.token_details.symbol || 'Unknown'),
        });

        return summaryMemory;
    }

    async getRecentTokenSummaries(limit: number = 5): Promise<string> {
        let allMemories: CoreMemory[] = [];

        // Use getMemoriesByRoomIds
        try {
            allMemories = await this.runtime.messageManager.getMemoriesByRoomIds({
                roomIds: [this.globalSummaryRoomId],
            });

            elizaLogger.info('Fetched memories using getMemoriesByRoomIds:', {
                roomId: this.globalSummaryRoomId,
                totalMemories: allMemories.length,
                memoryIds: allMemories.map(m => m.id),
                memoryTexts: allMemories.map(m => m.content.text.slice(0, 50)),
                createdAts: allMemories.map(m => new Date(m.createdAt ?? Date.now()).toISOString()),
            });
        } catch (error) {
            elizaLogger.error('Failed to fetch memories with getMemoriesByRoomIds:', { error: (error as Error).message });

            // Fallback to direct database query
            try {
                // const query = `
                //     SELECT * FROM memories
                //     WHERE room_id = $1
                //     AND content->>'text' LIKE 'Token Summary%'
                //     ORDER BY created_at DESC
                // `;
                // const result = await this.runtime.databaseAdapter.query(query, [this.globalSummaryRoomId]);
                // allMemories = result.rows.map((row: any) => ({
                //     id: row.id,
                //     userId: row.user_id,
                //     agentId: row.agent_id,
                //     roomId: row.room_id,
                //     content: row.content,
                //     createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
                // })) as CoreMemory[];

                // elizaLogger.info('Fetched memories from database directly (fallback):', {
                //     roomId: this.globalSummaryRoomId,
                //     totalMemories: allMemories.length,
                //     memoryIds: allMemories.map(m => m.id),
                //     memoryTexts: allMemories.map(m => m.content.text.slice(0, 50)),
                //     createdAts: allMemories.map(m => new Date(m.createdAt ?? Date.now()).toISOString()),
                // });
            } catch (dbError) {
                elizaLogger.error('Failed to fetch memories from database:', { error: (dbError as Error).message });
            }
        }

        if (allMemories.length === 0) {
            elizaLogger.error('No memories retrieved from global summary room');
            return "No recent token summaries available.";
        }

        const summaryMemories = allMemories
            .filter(m => m.content.text.startsWith('Token Summary'))
            .sort((a, b) => (b.createdAt ?? Date.now()) - (a.createdAt ?? Date.now()))
            .slice(0, limit) as SummaryMemory[];

        elizaLogger.info('Filtered summary memories:', {
            totalSummaries: summaryMemories.length,
            summaryIds: summaryMemories.map(m => m.id),
            summarySymbols: summaryMemories.map(m => m.content.metadata.prediction.token_details.symbol),
        });

        if (summaryMemories.length === 0) {
            elizaLogger.warn('No summary memories found after filtering');
            return "No recent token summaries available.";
        }

        const summaryLines = summaryMemories.map(memory => {
            const { prediction, actualResults, accuracy } = memory.content.metadata;
            return `Recent Token (${prediction.token_details.symbol}, ${new Date(memory.createdAt ?? Date.now()).toISOString()}):
            - Prediction: ${prediction.prediction.entry_decision} (10min MC: ${prediction.prediction.market_cap_predictions['10min']})
            - Confidence: ${(prediction.prediction.confidence * 100).toFixed(2)}%
            - Actual: Final MC: ${actualResults.finalMarketCap}, Max MC: ${actualResults.maxMarketCap}
            - Outcome: ${accuracy.predictionCorrect ? 'Correct' : 'Incorrect'}`;
        });

        return summaryLines.join('\n\n');
    }

    async calculateHistoricalAccuracy(): Promise<{ percentage: number; count: number }> {
        let allMemories: CoreMemory[] = [];

        try {
            allMemories = await this.runtime.messageManager.getMemoriesByRoomIds({
                roomIds: [this.globalSummaryRoomId],
            });

            elizaLogger.info('Fetched memories for historical accuracy (getMemoriesByRoomIds):', {
                roomId: this.globalSummaryRoomId,
                totalMemories: allMemories.length,
                memoryIds: allMemories.map(m => m.id),
                memoryTexts: allMemories.map(m => m.content.text.slice(0, 50)),
            });
        } catch (error) {
            elizaLogger.error('Failed to fetch memories for accuracy with getMemoriesByRoomIds:', { error: (error as Error).message });

            // Fallback to direct database query
            try {
                // const query = `
                //     SELECT * FROM memories
                //     WHERE room_id = $1
                //     AND content->>'text' LIKE 'Token Summary%'
                //     ORDER BY created_at DESC
                // `;
                // const result = await this.runtime.databaseAdapter.query(query, [this.globalSummaryRoomId]);
                // allMemories = result.rows.map((row: any) => ({
                //     id: row.id,
                //     userId: row.user_id,
                //     agentId: row.agent_id,
                //     roomId: row.room_id,
                //     content: row.content,
                //     createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
                // })) as CoreMemory[];

                // elizaLogger.info('Fetched memories for historical accuracy (database fallback):', {
                //     roomId: this.globalSummaryRoomId,
                //     totalMemories: allMemories.length,
                //     memoryIds: allMemories.map(m => m.id),
                //     memoryTexts: allMemories.map(m => m.content.text.slice(0, 50)),
                // });
            } catch (dbError) {
                elizaLogger.error('Failed to fetch memories for accuracy from database:', { error: (dbError as Error).message });
            }
        }

        const summaryMemories = allMemories
            .filter(m => m.content.text.startsWith('Token Summary')) as SummaryMemory[];

        if (summaryMemories.length === 0) {
            return { percentage: 0, count: 0 };
        }

        const correctPredictions = summaryMemories.filter(m => m.content.metadata.accuracy.predictionCorrect).length;
        const totalPredictions = summaryMemories.length;
        const percentage = (correctPredictions / totalPredictions) * 100;

        return { percentage, count: totalPredictions };
    }

    private async getCheckMemories(predictionId: UUID): Promise<CheckMemory[]> {
        const predictionMemory = await this.runtime.messageManager.getMemoryById(predictionId);
        if (!predictionMemory?.roomId) {
            elizaLogger.error('Prediction memory or roomId not found:', { predictionId });
            return [];
        }

        const roomId = predictionMemory.roomId;
        elizaLogger.info('Fetching check memories for room:', { predictionId, roomId });

        const allMemories = await this.runtime.messageManager.getMemories({
            roomId,
            count: 100,
            unique: true,
        });

        const checkIntervals = [1, 2, 3, 4, 5];
        const checkMemoriesPromises = checkIntervals.map(async (checkNumber) => {
            const checkMemoryId = stringToUuid(`check-${predictionId}-${checkNumber * 2}min`);
            const memory = await this.runtime.messageManager.getMemoryById(checkMemoryId);
            if (memory) {
                elizaLogger.info('Found check memory by ID:', { checkMemoryId, checkNumber });
                return memory as CheckMemory;
            }
            return null;
        });

        const checkMemoriesFromIds = (await Promise.all(checkMemoriesPromises)).filter(m => m !== null) as CheckMemory[];

        const isCheckMemoryContent = (content: Content): content is CheckMemoryContent =>
            content && 'metadata' in content && 'predictionMemoryId' in (content as any).metadata;

        const checkMemoriesFromRoom = allMemories
            .filter(m => {
                const hasCheckPrefix = m.id?.includes('check-') || false;
                if (!isCheckMemoryContent(m.content)) return false;
                const content = m.content as CheckMemoryContent;
                const matchesPredictionId = content.metadata.predictionMemoryId?.toString() === predictionId.toString();
                return hasCheckPrefix && matchesPredictionId;
            })
            .map(m => m as CheckMemory);

        const combinedCheckMemories = [...checkMemoriesFromIds, ...checkMemoriesFromRoom];
        const uniqueCheckMemories = Array.from(
            new Map(combinedCheckMemories.map(m => [m.id, m])).values()
        );

        elizaLogger.info('Final check memories:', {
            predictionId,
            roomId,
            totalFound: uniqueCheckMemories.length,
            checkIds: uniqueCheckMemories.map(m => m.id),
        });

        return uniqueCheckMemories;
    }
}