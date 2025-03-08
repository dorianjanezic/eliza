import { elizaLogger, type IAgentRuntime, ModelClass, generateText, composeContext, stringToUuid, type UUID } from '@ai16z/eliza';
import type { TokenData, TokenPrediction, PredictionMemory, PredictionCheck } from '../types';
import predictionTemplate from '../templates/prediction';
import { LearningService } from './LearningService';
import { MarketDataProvider } from '../providers/MarketDataProvider';

export class PredictionService {
    private learningService: LearningService;
    private marketDataProvider: MarketDataProvider;

    constructor(private runtime: IAgentRuntime) {
        this.learningService = new LearningService(runtime);
        this.marketDataProvider = new MarketDataProvider(runtime);
    }

    async predictToken(tokenData: TokenData): Promise<TokenPrediction> {
        const roomId = stringToUuid(`token-${tokenData.tokenId}`);
        elizaLogger.info('Starting token prediction:', { tokenId: tokenData.tokenId, roomId });

        try {
            const pastPredictions = await this.learningService.getRecentPredictions();
            const accuracyStats = await this.learningService.getHistoricalAccuracy();

            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId,
                    agentId: this.runtime.agentId,
                    content: { text: JSON.stringify(tokenData), action: "PREDICT_TOKEN" }
                },
                {
                    tokenData: JSON.stringify(tokenData, null, 2),
                    pastPredictions,
                    historicalAccuracy: accuracyStats.percentage.toFixed(2),
                    predictionCount: accuracyStats.count,
                    avgMape: (accuracyStats.avgMape * 100).toFixed(2)
                }
            );

            const context = composeContext({ state, template: predictionTemplate });
            elizaLogger.info('LLM Input Context:', { context });

            const response = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.LARGE
            });
            elizaLogger.info('LLM Response:', { response });

            const prediction = this.parseAnalysisResponse(response);

            await this.runtime.ensureRoomExists(roomId);
            elizaLogger.info('Ensured room exists:', { roomId });

            const predictionMemory: PredictionMemory = {
                id: stringToUuid(`prediction-${tokenData.tokenId}`),
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                roomId,
                content: {
                    text: `Token Prediction\nToken: ${tokenData.tokenId}\nDecision: ${prediction.entryDecision}`,
                    metadata: { analysis: { token_details: { address: tokenData.address }, prediction }, originalToken: tokenData }
                },
                createdAt: Date.now()
            };

            const memoryWithEmbedding = await this.runtime.messageManager.addEmbeddingToMemory(predictionMemory);
            await this.runtime.messageManager.createMemory(memoryWithEmbedding, true);

            await this.scheduleChecks(tokenData.tokenId, roomId, tokenData.address, prediction);

            elizaLogger.success('Token prediction completed:', {
                tokenId: tokenData.tokenId,
                decision: prediction.entryDecision,
                confidence: prediction.confidence
            });

            return prediction;
        } catch (error) {
            elizaLogger.error('Failed to predict token:', {
                tokenId: tokenData.tokenId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }

    private async scheduleChecks(tokenId: string, roomId: UUID, tokenAddress: string, prediction: TokenPrediction): Promise<void> {
        const intervalSeconds = 2 * 60;
        const numChecks = 5;
        const startTime = Date.now();
        const checks: PredictionCheck[] = [];

        for (let i = 1; i <= numChecks; i++) {
            const delaySeconds = i * intervalSeconds;
            const executeAt = new Date(startTime + delaySeconds * 1000);
            const taskId = `check-${tokenId}-${i * 2}min`;

            await this.runtime.scheduleTask({
                taskId,
                executeAt,
                task: async () => {
                    try {
                        const marketData = await this.marketDataProvider.getTokenMarketData(tokenAddress);
                        const check: PredictionCheck = { timestamp: new Date().toISOString(), marketCap: marketData.marketCap };

                        const checkMemory = {
                            id: stringToUuid(taskId),
                            userId: this.runtime.agentId,
                            agentId: this.runtime.agentId,
                            roomId,
                            content: { text: `Check at ${i * 2}min: ${marketData.marketCap}`, metadata: { check } },
                            createdAt: Date.now()
                        };
                        await this.runtime.messageManager.createMemory(await this.runtime.messageManager.addEmbeddingToMemory(checkMemory), true);

                        checks.push(check);
                        elizaLogger.info('Scheduled check recorded:', { tokenId, checkNumber: i, marketCap: marketData.marketCap });

                        if (i === numChecks) {
                            await this.createTokenSummary(tokenId, roomId, prediction, checks);
                        }
                    } catch (error) {
                        elizaLogger.error('Failed to execute scheduled check:', {
                            tokenId,
                            checkNumber: i,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        });
                    }
                }
            });
            elizaLogger.success('Scheduled check:', { taskId, executeAt: executeAt.toISOString() });
        }
    }

    private async createTokenSummary(tokenId: string, roomId: UUID, prediction: TokenPrediction, checks: PredictionCheck[]): Promise<void> {
        const initialMarketCap = checks[0].marketCap;
        const finalMarketCap = checks[checks.length - 1].marketCap;
        const maxMarketCap = Math.max(...checks.map(c => c.marketCap));

        // Overall achievedTarget (based on 10min prediction)
        const achievedTarget = prediction.entryDecision === "BUY"
            ? maxMarketCap >= prediction.marketCapPredictions["10min"] * 0.9
            : finalMarketCap <= initialMarketCap * 1.05;

        // Per-step accuracy
        const mapePerStep = Object.entries(prediction.marketCapPredictions).map(([time, pred]) => {
            const minutes = parseInt(time.replace("min", ""));
            const check = checks.find(c => Math.abs((new Date(c.timestamp).getTime() - new Date(checks[0].timestamp).getTime()) / 60000 - minutes) < 1);
            const actual = check ? check.marketCap : finalMarketCap; // Fallback to final if exact check missing
            const mape = actual > 0 ? Math.abs((pred - actual) / actual) : 0; // Avoid division by zero
            const achieved = prediction.entryDecision === "BUY"
                ? actual >= pred * 0.9
                : actual <= initialMarketCap * 1.05;
            return { time, mape, achieved };
        });

        // Overall MAPE (average of per-step MAPE)
        const overallMape = mapePerStep.reduce((sum, step) => sum + step.mape, 0) / mapePerStep.length;

        const summary = {
            prediction,
            checks,
            results: {
                initialMarketCap,
                finalMarketCap,
                maxMarketCap,
                achievedTarget,
                mape: overallMape,
                mapePerStep // Add per-step results
            }
        };

        const summaryText = [
            `Summary for ${tokenId}`,
            `Decision: ${prediction.entryDecision}`,
            `Achieved: ${achievedTarget}`,
            `MAPE: ${(overallMape * 100).toFixed(2)}%`,
            ...mapePerStep.map(step => `${step.time}: Predicted ${(prediction.marketCapPredictions[step.time as '2min' | '4min' | '6min' | '8min' | '10min']).toFixed(2)}, Actual ${(checks.find(c => Math.abs((new Date(c.timestamp).getTime() - new Date(checks[0].timestamp).getTime()) / 60000 - parseInt(step.time.replace("min", ""))) < 1)?.marketCap || finalMarketCap).toFixed(2)}, MAPE ${(step.mape * 100).toFixed(2)}%, Achieved: ${step.achieved}`)
        ].join("\n");

        const summaryMemory = {
            id: stringToUuid(`summary-${tokenId}`),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId,
            content: {
                text: summaryText,
                metadata: summary
            },
            createdAt: Date.now()
        };

        await this.runtime.messageManager.createMemory(await this.runtime.messageManager.addEmbeddingToMemory(summaryMemory), true);
        elizaLogger.success('Token summary created:', { tokenId, achievedTarget, mape: overallMape, mapePerStep });

        await this.learningService.recordPredictionSummary(tokenId, summary);
    }

    private parseAnalysisResponse(response: string): TokenPrediction {
        try {
            const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (!codeBlockMatch) throw new Error('Response missing code block');

            const analysis = JSON.parse(codeBlockMatch[1].trim());
            if (!analysis.prediction || !analysis.prediction.market_cap_predictions) throw new Error('Invalid prediction format');

            return {
                entryDecision: analysis.prediction.entry_decision,
                marketCapPredictions: analysis.prediction.market_cap_predictions,
                confidence: analysis.prediction.confidence,
                supportingFactors: analysis.prediction.supporting_factors,
                riskFactors: analysis.prediction.risk_factors
            };
        } catch (error) {
            elizaLogger.error('Failed to parse analysis response:', { error: error instanceof Error ? error.message : 'Unknown error', response });
            return {
                entryDecision: "IGNORE",
                marketCapPredictions: { "2min": 0, "4min": 0, "6min": 0, "8min": 0, "10min": 0 },
                confidence: 0,
                supportingFactors: ["Error in analysis"],
                riskFactors: ["Failed to analyze token"]
            };
        }
    }
}