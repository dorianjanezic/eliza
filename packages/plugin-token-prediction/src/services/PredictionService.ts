import { elizaLogger, type IAgentRuntime, ModelClass, generateText, composeContext, stringToUuid, type UUID } from '@ai16z/eliza';
import type { TokenData, TokenPrediction, PredictionMemory, PredictionCheck, OHLCVData } from '../types';
import predictionTemplate from '../templates/prediction';
import { evaluatePredictionTemplate } from '../templates/evaluatePrediction';
import { LearningService } from './LearningService';
import { MarketDataProvider } from '../providers/MarketDataProvider';
import TokenMigrationProvider from '../providers/TokenMigrationProvider';
export class PredictionService {
    private learningService: LearningService;
    private marketDataProvider: MarketDataProvider;
    private tokenMigrationProvider: TokenMigrationProvider; // Declared here


    constructor(private runtime: IAgentRuntime) {
        this.learningService = new LearningService(runtime);
        this.marketDataProvider = new MarketDataProvider(runtime);
        this.tokenMigrationProvider = new TokenMigrationProvider(runtime);


    }

    async predictToken(tokenData: TokenData, tweets: string, ohlcvData: OHLCVData[]): Promise<TokenPrediction> {
        const roomId = stringToUuid(`token-${tokenData.tokenId}`);
        elizaLogger.info('Starting token prediction:', { tokenAddress: tokenData.address, roomId });

        try {
            const pastPredictions = await this.learningService.getRecentPredictions(3);
            const accuracyStats = await this.learningService.getHistoricalAccuracy();

            elizaLogger.info("Past Predictions:", { pastPredictions });

            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId,
                    agentId: this.runtime.agentId,
                    content: { text: JSON.stringify(tokenData), action: "PREDICT_TOKEN" }
                },
                {
                    tokenData: JSON.stringify(tokenData, null, 2),
                    tweets,
                    ohlcv: JSON.stringify(ohlcvData, null, 2),
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

            const prediction = this.parseAnalysisResponse(response);
            elizaLogger.info('Prediction:', { prediction });

            await this.runtime.ensureRoomExists(roomId);
            elizaLogger.info('Ensured room exists:', { roomId });

            const predictionMemory: PredictionMemory = {
                id: stringToUuid(`prediction-${tokenData.tokenId}`),
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                roomId,
                content: {
                    text: `Token Prediction\nToken: ${tokenData.address}\nDecision: ${prediction.entryDecision}`,
                    metadata: {
                        analysis: { token_details: { address: tokenData.address }, prediction },
                        originalToken: tokenData,
                        tweets,
                        ohlcvData
                    }
                },
                createdAt: Date.now()
            };

            const memoryWithEmbedding = await this.runtime.messageManager.addEmbeddingToMemory(predictionMemory);
            await this.runtime.messageManager.createMemory(memoryWithEmbedding, true);

            await this.scheduleChecks(tokenData.tokenId, roomId, tokenData.address, prediction);

            elizaLogger.success('Token prediction completed:', {
                tokenAddress: tokenData.address,
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
        const marketCapThreshold = 10000; // $10,000 threshold

        for (let i = 1; i <= numChecks; i++) {
            const delaySeconds = i * intervalSeconds;
            const executeAt = new Date(startTime + delaySeconds * 1000);
            const taskId = `check-${tokenId}-${i * 2}min`;

            await this.runtime.scheduleTask({
                taskId,
                executeAt,
                task: async () => {
                    try {
                        // Refetch data
                        const marketData = await this.marketDataProvider.getTokenMarketData(tokenAddress);
                        const distribution = await this.tokenMigrationProvider.checkTokenDistribution(tokenAddress);
                        const bundleAnalysis = await this.tokenMigrationProvider.analyzeMintAddress(tokenAddress);
                        const ohlcvData = await this.marketDataProvider.getTokenOHLCVData(tokenAddress, '1m', Math.floor(Date.now() / 1000) - 600, Math.floor(Date.now() / 1000));

                        const check: PredictionCheck = {
                            timestamp: new Date().toISOString(),
                            marketCap: marketData.marketCap,
                            marketData,
                            distribution: {
                                topHolderPercent: distribution.topHolderPercent,
                                topHolders: distribution.topHolders
                            },
                            bundleData: bundleAnalysis.success && bundleAnalysis.data ? {
                                totalBundles: Object.values(bundleAnalysis.data.bundles).filter((b: any) => b.holding_amount > 0).length,
                                totalSolSpent: bundleAnalysis.data.total_sol_spent,
                                currentHeldPercentage: bundleAnalysis.data.total_holding_percentage,
                                totalBundledPercentage: bundleAnalysis.data.total_percentage_bundled
                            } : undefined,
                            ohlcv: ohlcvData
                        };

                        checks.push(check);
                        elizaLogger.info('Scheduled check recorded:', {
                            tokenAddress,
                            checkNumber: i,
                            marketCap: marketData.marketCap,
                            holderCount: marketData.holderCount,
                            topHolderPercent: distribution.topHolderPercent,
                            totalBundles: check.bundleData?.totalBundles,
                            ohlcvCandleCount: ohlcvData.length
                        });

                        // Early termination if market cap drops below $10,000
                        if (marketData.marketCap < marketCapThreshold) {
                            elizaLogger.warn('Market cap below threshold, terminating checks early:', {
                                tokenAddress,
                                checkNumber: i,
                                marketCap: marketData.marketCap,
                                threshold: marketCapThreshold
                            });
                            await this.createTokenSummary(tokenId, roomId, prediction, checks);
                            return; // Exit the task, preventing further checks
                        }

                        if (i === numChecks) {
                            await this.createTokenSummary(tokenId, roomId, prediction, checks);
                        }
                    } catch (error) {
                        elizaLogger.error('Failed to execute scheduled check:', {
                            tokenAddress,
                            checkNumber: i,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        });
                    }
                }
            });
            elizaLogger.success('Scheduled check:', { taskId, executeAt: executeAt.toISOString() });
        }
    }

    private async evaluatePrediction(
        tokenData: TokenData,
        tweets: string,
        ohlcvData: OHLCVData[],
        prediction: TokenPrediction,
        checks: PredictionCheck[]
    ): Promise<{ reflection: string; lessonsLearned: string[] }> {
        const pastPredictions = await this.learningService.getRecentPredictions(3);
        const accuracyStats = await this.learningService.getHistoricalAccuracy();

        const state = await this.runtime.composeState(
            {
                userId: this.runtime.agentId,
                roomId: stringToUuid(`token-${tokenData.tokenId}`),
                agentId: this.runtime.agentId,
                content: { text: 'Evaluate prediction results' }
            },
            {
                tokenData: JSON.stringify(tokenData, null, 2),
                tweets,
                ohlcv: JSON.stringify(ohlcvData, null, 2),
                initialPrediction: JSON.stringify(prediction, null, 2),
                actualResults: JSON.stringify(checks, null, 2), // Now includes marketData, distribution, bundleData
                pastPredictions,
                historicalAccuracy: accuracyStats.percentage.toFixed(2),
                predictionCount: accuracyStats.count,
                avgMape: (accuracyStats.avgMape * 100).toFixed(2)
            }
        );

        const response = await generateText({
            runtime: this.runtime,
            context: composeContext({ state, template: evaluatePredictionTemplate }),
            modelClass: ModelClass.LARGE
        });

        const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (!codeBlockMatch) throw new Error('Evaluation response missing code block');

        const evaluationData = JSON.parse(codeBlockMatch[1].trim());
        return {
            reflection: evaluationData.reflection || "No reflection provided.",
            lessonsLearned: evaluationData.lessonsLearned || []
        };
    }

    private async createTokenSummary(tokenId: string, roomId: UUID, prediction: TokenPrediction, checks: PredictionCheck[]): Promise<void> {
        const initialMarketCap = checks[0].marketCap;
        const finalMarketCap = checks[checks.length - 1].marketCap;
        const maxMarketCap = Math.max(...checks.map(c => c.marketCap));

        const achievedTarget = prediction.entryDecision === "BUY"
            ? maxMarketCap >= prediction.marketCapPredictions["10min"] * 0.85
            : finalMarketCap <= initialMarketCap * 1.15;

        const mapePerStep = Object.entries(prediction.marketCapPredictions).map(([time, pred]) => {
            const minutes = parseInt(time.replace("min", ""));
            const check = checks.find(c => Math.abs((new Date(c.timestamp).getTime() - new Date(checks[0].timestamp).getTime()) / 60000 - minutes) < 1);
            const actual = check ? check.marketCap : finalMarketCap;
            const mape = actual > 0 ? Math.abs((pred - actual) / actual) : 0;
            const achieved = prediction.entryDecision === "BUY" ? actual >= pred * 0.85 : actual <= initialMarketCap * 1.15;
            return { time, mape, achieved };
        });
        const overallMape = mapePerStep.reduce((sum, step) => sum + step.mape, 0) / mapePerStep.length;

        const predictionId = stringToUuid(`prediction-${tokenId}`);
        const predictionMemory = await this.runtime.messageManager.getMemoryById(predictionId) as PredictionMemory | undefined;
        let tokenData: TokenData;
        let tweets: string;
        let ohlcvData: OHLCVData[];

        if (predictionMemory?.content?.metadata) {
            const metadata = predictionMemory.content.metadata;
            tokenData = metadata.originalToken;
            tweets = metadata.tweets ?? "No tweets available";
            ohlcvData = metadata.ohlcvData ?? [];
        } else {
            elizaLogger.warn('Initial prediction memory not found, using fallback data:', { tokenId, predictionId });
            tokenData = { tokenId, address: "unknown", symbol: "UNKNOWN", name: "Unknown", marketCap: initialMarketCap } as TokenData;
            tweets = "No tweets available";
            ohlcvData = [];
        }

        const evaluationResult = await this.evaluatePrediction(tokenData, tweets, ohlcvData, prediction, checks);

        const summary = {
            prediction,
            checks, // Now includes enriched data
            results: {
                initialMarketCap,
                finalMarketCap,
                maxMarketCap,
                achievedTarget,
                mape: overallMape,
                mapePerStep
            },
            reflection: evaluationResult.reflection,
            lessonsLearned: evaluationResult.lessonsLearned
        };

        const summaryText = [
            `Summary for ${tokenId}`,
            `Decision: ${prediction.entryDecision}`,
            `Achieved: ${achievedTarget}`,
            `MAPE: ${(overallMape * 100).toFixed(2)}%`,
            ...mapePerStep.map(step => `${step.time}: Predicted ${(prediction.marketCapPredictions[step.time as '2min' | '4min' | '6min' | '8min' | '10min']).toFixed(2)}, Actual ${(checks.find(c => Math.abs((new Date(c.timestamp).getTime() - new Date(checks[0].timestamp).getTime()) / 60000 - parseInt(step.time.replace("min", ""))) < 1)?.marketCap || finalMarketCap).toFixed(2)}, MAPE ${(step.mape * 100).toFixed(2)}%, Achieved: ${step.achieved}`),
            `Reflection: ${evaluationResult.reflection}`,
            `Lessons Learned: ${evaluationResult.lessonsLearned.join(", ") || "None"}`
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
        elizaLogger.success('Token summary created:', { tokenId, achievedTarget, mape: overallMape, reflection: evaluationResult.reflection });

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
                riskFactors: analysis.prediction.risk_factors,
                reasoning: analysis.prediction.reasoning || "No reasoning provided."
            };
        } catch (error) {
            elizaLogger.error('Failed to parse analysis response:', { error: error instanceof Error ? error.message : 'Unknown error', response });
            return {
                entryDecision: "IGNORE",
                marketCapPredictions: { "2min": 0, "4min": 0, "6min": 0, "8min": 0, "10min": 0 },
                confidence: 0,
                supportingFactors: ["Error in analysis"],
                riskFactors: ["Failed to analyze token"],
                reasoning: "Analysis failed due to parsing error."
            };
        }
    }
}