// tokenProcessingClient.ts
import { EventEmitter } from 'events';
import {
    IAgentRuntime,
    ModelClass,
    stringToUuid,
    generateText,
    composeContext,
    elizaLogger,
    UUID,
    Memory as CoreMemory,
    Content,
} from '@ai16z/eliza';
import { TokenUpdate } from '../types';
import { TokenLearningManager } from './tokenLearningManager';

interface MemoryContent extends Content {
    text: string;
    metadata: {
        analysis: SimplifiedAnalysis;
        originalToken?: any;
        [key: string]: any;
    };
}

interface Memory extends CoreMemory {
    id: UUID;
    userId: UUID;
    agentId: UUID;
    roomId: UUID;
    content: MemoryContent;
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

interface ScheduleTask {
    taskId: string;
    executeAt: Date;
    task: () => Promise<void>;
}

declare module '@ai16z/eliza' {
    interface IAgentRuntime {
        scheduleTask(task: ScheduleTask): Promise<void>;
    }
}

const tokenProcessingTemplate = `
You are a token analysis system for Pump.fun migrated tokens. Analyze the provided data and predict the market cap at 2, 4, 6, 8, and 10 minutes after receiving this update. Decide whether to BUY or IGNORE based on your assessment of the token's potential.

IMPORTANT: Respond with ONLY a JSON code block in this exact format:

\`\`\`json
{
    "token_details": { "address": "string", "symbol": "string", "name": "string" },
    "current_metrics": { "market_cap": 0, "holders": 0, "volume_1h": 0, "unique_traders_1h": 0 },
    "prediction": {
        "entry_decision": "BUY" | "IGNORE",
        "market_cap_predictions": { "2min": 0, "4min": 0, "6min": 0, "8min": 0, "10min": 0 },
        "confidence": 0.0,
        "supporting_factors": ["factor1", "factor2"],
        "risk_factors": ["risk1", "risk2"]
    },
    "trading_decision": { "action": "BUY" | "IGNORE", "confidence": 0.0, "reasoning": ["reason1", "reason2"] }
}
\`\`\`

Token Data (Migration Event):
{{tokenData}}

Summaries of Recent Tokens (Prediction and Actual Results):
{{pastPredictions}}

Historical Accuracy: {{historicalAccuracy}}% (based on {{predictionCount}} predictions)

Guidelines:
1. Entry Decision
   - Assess the likelihood of a significant market cap increase within 10 minutes based on current metrics, trends, and past token performance.
   - Consider BUY if the token shows strong growth potential (e.g., rising market cap, high volume_1h, increasing unique_traders_1h).
   - Consider IGNORE if the token appears stagnant, declining, or overly concentrated (e.g., top_10_percentage > 50%).
   - Weigh factors like volume_1h, unique_traders_1h, market_cap, holders, and total_transactions.
2. Market Cap Predictions
   - Provide specific market cap predictions for 2, 4, 6, 8, and 10 minutes after this update.
   - Base predictions on current_metrics (market_cap, volume_1h, unique_traders_1h, holders), concentration (top_10_percentage), and activity (total_volume_sol, total_transactions, reply_count).
   - Use timing (inception_datetime, pair_created_at) to assess token age and momentum.
3. Risk Assessment
   - Identify risks such as high top_10_percentage or pumpfun_top_10_holders_percentage (>50%), low volume_1h, or few unique_traders_1h.
   - Include these in your risk_factors to justify your decision.
`;

export class TokenProcessingClient extends EventEmitter {
    private runtime: IAgentRuntime;
    private processingTokens: Set<string>;
    private learningManager: TokenLearningManager;

    constructor(runtime: IAgentRuntime) {
        super();
        this.runtime = runtime;
        this.processingTokens = new Set();
        this.learningManager = new TokenLearningManager(runtime);
    }

    private normalizeTokenData(update: TokenUpdate) {
        const record = update.record;
        const normalized = {
            token_details: {
                address: record.mint || '',
                symbol: record.symbol || record.symbol_normalized || '',
                name: record.name || record.name_normalized || '',
            },
            current_metrics: {
                market_cap: record.market_cap || 0,
                holders: record.unique_holders || record.holders || 0,
                volume_1h: record.volume_1h || record.pumpfun_total_volume_sol || 0,
                unique_traders_1h: record.pumpfun_unique_traders || record.unique_traders_1h || 0,
            },
            concentration: {
                top_10_percentage: record.top_10_percentage || 0,
                pumpfun_top_10_holders_percentage: record.pumpfun_top_10_holders_percentage || 0,
            },
            activity: {
                total_volume_sol: record.pumpfun_total_volume_sol || 0,
                total_transactions: record.pumpfun_total_transactions || 0,
                reply_count: record.pumpfun_reply_count || 0,
            },
            timing: {
                inception_datetime: record.inception_datetime || '',
                pair_created_at: record.pair_created_at || '',
            },
        };

        // Log warnings for missing critical fields
        if (!normalized.token_details.address) {
            elizaLogger.warn('Missing token address (mint)', { tokenId: record.token_id });
        }
        if (!normalized.current_metrics.market_cap) {
            elizaLogger.warn('Missing market cap', { tokenId: record.token_id });
        }

        return normalized;
    }

    async processTokenUpdate(update: TokenUpdate): Promise<void> {
        const tokenId = update.record.token_id;
        if (!tokenId) {
            elizaLogger.error('Invalid token update: missing token ID');
            return;
        }

        if (this.processingTokens.has(tokenId)) {
            elizaLogger.warn(`Token ${tokenId} already being processed`);
            return;
        }

        this.processingTokens.add(tokenId);

        try {
            elizaLogger.info(`Starting processing for token ${tokenId}`);
            const roomId = stringToUuid(`token-${tokenId}`);
            await this.runtime.ensureRoomExists(roomId);
            await this.runtime.ensureParticipantInRoom(this.runtime.agentId, roomId);

            const normalizedData = this.normalizeTokenData(update);
            const tokenDataString = JSON.stringify(normalizedData, null, 2);

            // Add a slight delay to ensure previous summaries are persisted
            await new Promise(resolve => setTimeout(resolve, 1000));

            const recentTokenSummaries = await this.learningManager.getRecentTokenSummaries();
            const accuracyStats = await this.learningManager.calculateHistoricalAccuracy();
            const historicalAccuracy = accuracyStats.percentage.toFixed(2);
            const predictionCount = accuracyStats.count;

            const state = await this.runtime.composeState(
                { userId: this.runtime.agentId, roomId, agentId: this.runtime.agentId, content: { text: tokenDataString, action: "PROCESS_TOKEN" } },
                {
                    tokenData: tokenDataString,
                    pastPredictions: recentTokenSummaries,
                    historicalAccuracy: historicalAccuracy,
                    predictionCount: predictionCount,
                }
            );

            const context = composeContext({ state, template: tokenProcessingTemplate });
            elizaLogger.info('Full LLM Prompt:', { tokenId, prompt: context });

            const analysisResponse = await generateText({ runtime: this.runtime, context, modelClass: ModelClass.LARGE });
            const analysis = this.parseAnalysis(analysisResponse, tokenId);

            const predictionMemory: Memory = {
                id: stringToUuid(`prediction-${tokenId}`),
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                roomId,
                content: {
                    text: `Token Prediction\nName: ${analysis.token_details.name}\nSymbol: ${analysis.token_details.symbol}\nDecision: ${analysis.prediction.entry_decision}\n10min Market Cap: ${analysis.prediction.market_cap_predictions['10min']}\nConfidence: ${(analysis.prediction.confidence * 100).toFixed(2)}%`,
                    metadata: {
                        analysis,
                        originalToken: update.record, // Keep full record for reference
                    },
                },
                createdAt: Date.now(),
            };

            const memoryWithEmbedding = await this.runtime.messageManager.addEmbeddingToMemory(predictionMemory);
            await this.runtime.messageManager.createMemory(memoryWithEmbedding, true);

            await this.scheduleChecks(predictionMemory);

            elizaLogger.info('Token processing complete:', {
                tokenId,
                memoryId: predictionMemory.id,
                prediction: analysis.prediction,
            });
            this.emit('processingComplete', { tokenId, memoryId: predictionMemory.id, success: true });
        } catch (error: any) {
            elizaLogger.error('Token processing failed:', { tokenId, error: error.message });
            this.emit('processingError', { tokenId, error: error.message });
        } finally {
            this.processingTokens.delete(tokenId);
        }
    }

    private parseAnalysis(response: string, tokenId: string): SimplifiedAnalysis {
        const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (!codeBlockMatch) {
            throw new Error('Response missing code block');
        }
        const analysis = JSON.parse(codeBlockMatch[1].trim());

        if (!analysis.prediction?.market_cap_predictions) {
            throw new Error('Missing market_cap_predictions in analysis');
        }
        return analysis;
    }

    private async scheduleChecks(predictionMemory: Memory): Promise<void> {
        const tokenAddress = predictionMemory.content.metadata.analysis.token_details.address;
        const intervalSeconds = 2 * 60; // 120 seconds (2 minutes)
        const numChecks = 5; // Checks at 2, 4, 6, 8, 10 minutes
        const startTime = Date.now();

        for (let i = 1; i <= numChecks; i++) {
            const delaySeconds = i * intervalSeconds;
            const executeAt = new Date(startTime + delaySeconds * 1000);
            const taskId = `check-${predictionMemory.id}-${i * 2}min`;

            await this.runtime.scheduleTask({
                taskId,
                executeAt,
                task: async () => {
                    await this.learningManager.recordCheckResult(predictionMemory as any, i);
                    elizaLogger.info('Scheduled check executed:', { tokenAddress, checkNumber: i, time: `${i * 2}min` });

                    if (i === numChecks) {
                        elizaLogger.info('Triggering summary after final check:', { tokenAddress, checkNumber: i });
                        await this.learningManager.finalizeTokenSummary(predictionMemory as any);
                    }
                },
            });
            elizaLogger.success('Scheduled check:', { taskId, executeAt: executeAt.toISOString() });
        }
    }
}