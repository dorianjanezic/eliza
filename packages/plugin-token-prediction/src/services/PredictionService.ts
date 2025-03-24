import { elizaLogger, type IAgentRuntime, ModelClass, generateText, composeContext, stringToUuid, type UUID } from '@ai16z/eliza';
import type { TokenData, TokenPrediction, PredictionMemory, PredictionCheck, OHLCVData } from '../types';
import predictionTemplate from '../templates/prediction';
import { evaluatePredictionTemplate } from '../templates/evaluatePrediction';
import { LearningService } from './LearningService';
import { TokenDataService } from './TokenDataService';
import { MarketDataProvider } from '../providers/MarketDataProvider';
import TokenMigrationProvider from '../providers/TokenMigrationProvider';
import { Trade } from '../types/portfolio';
import { logger, generatePredictionId, generateTradeId } from '../utils/logger';

// Orchestrates token prediction, monitoring, and evaluation
export class PredictionService {
    private tokenDataService: TokenDataService;

    // Dependencies will be injected rather than created inside
    constructor(
        private runtime: IAgentRuntime,
        private learningService: LearningService,
        private marketDataProvider: MarketDataProvider,
        private tokenMigrationProvider: TokenMigrationProvider
    ) {
        // Ensure portfolio is initialized
        this.learningService.initializePortfolio();
        // Initialize token data service
        this.tokenDataService = new TokenDataService(runtime);
    }

    // Generates a prediction for a token based on initial data
    // Update predictToken to initiate trade
    async predictToken(tokenData: TokenData, tweets: string, ohlcvData: OHLCVData[]): Promise<TokenPrediction> {
        const roomId = stringToUuid(`token-${tokenData.tokenId}`);
        const predictionId = generatePredictionId(tokenData.tokenId);

        // Start performance timer
        const perfTimer = logger.performance.start('predict_token', tokenData.tokenId);

        // Log prediction start
        logger.prediction.start(tokenData.tokenId, predictionId, tokenData.address);

        // Capture initial token data
        await this.tokenDataService.captureTokenData(
            {
                ...tokenData,
                // Ensure market data fields are populated even if missing from original tokenData
                holderCount: tokenData.holderCount || 0,
                volume1hUSD: tokenData.volume1hUSD || 0,
                volume24hUSD: tokenData.volume24hUSD || 0,
                priceChange1h: tokenData.priceChange1h || 0,
                priceChange24h: tokenData.priceChange24h || 0,
                uniqueTraders1h: tokenData.uniqueTraders1h || 0,
                trades1h: tokenData.trades1h || 0
            },
            'INITIAL',
            {
                ohlcvData,
                isInitialCheck: true,
                // Include Twitter sentiment if we have tweets
                ...(tweets && {
                    twitterSentiment: {
                        score: 0.5, // Neutral by default
                        summary: tweets.substring(0, 100) + (tweets.length > 100 ? '...' : ''),
                        tweetCount: tweets.split('\n').filter(line => line.trim().length > 0).length
                    }
                })
            }
        );

        const pastPredictions = await this.learningService.getRecentPredictions(3);
        const accuracyStats = await this.learningService.getHistoricalAccuracy();
        const portfolio = await this.learningService.getPortfolio();

        logger.performance.checkpoint('predict_token', 'data_prepared', tokenData.tokenId, perfTimer.end());

        const state = await this.runtime.composeState(
            { userId: this.runtime.agentId, roomId, agentId: this.runtime.agentId, content: { text: JSON.stringify(tokenData), action: "PREDICT_TOKEN" } },
            {
                tokenData: JSON.stringify({ ...tokenData, price: tokenData.price || 0 }, null, 2),
                tweets,
                ohlcv: JSON.stringify(ohlcvData, null, 2),
                pastPredictions,
                historicalAccuracy: accuracyStats.percentage.toFixed(2),
                predictionCount: accuracyStats.count,
                avgMape: (accuracyStats.avgMape * 100).toFixed(2)
            }
        );

        const context = composeContext({ state, template: predictionTemplate });

        // Time LLM prediction
        const llmTimer = logger.performance.start('llm_predict', tokenData.tokenId);
        const response = await generateText({ runtime: this.runtime, context, modelClass: ModelClass.LARGE });
        const llmDuration = llmTimer.end();

        const prediction = this.parseAnalysisResponse(response);

        // Store the prediction to token data
        await this.tokenDataService.captureTokenData(tokenData, 'INITIAL', {
            currentPrediction: prediction,
            isInitialCheck: true,
            predictionResultId: predictionId
        });

        // Log prediction result
        logger.prediction.result(tokenData.tokenId, predictionId, prediction.entryDecision, prediction.confidence);

        // Improved trade simulation logic
        if (prediction.entryDecision === "BUY" && tokenData.price && prediction.takeProfitPrice && prediction.stopLossPrice) {
            // Generate a trade ID for tracking this potential trade
            const tradeId = logger.trade.evaluating(tokenData.tokenId, tokenData.address, tokenData.price);

            // Check if we have enough balance (using portfolio's minPortfolioThreshold)
            const minPortfolioThreshold = portfolio.initialBalance * portfolio.minPortfolioThreshold;
            if (portfolio.currentBalance < minPortfolioThreshold) {
                logger.trade.rejected(
                    tokenData.tokenId,
                    tradeId,
                    "Portfolio below threshold",
                    {
                        currentBalance: portfolio.currentBalance,
                        threshold: minPortfolioThreshold,
                        percentOfInitial: (portfolio.currentBalance / portfolio.initialBalance * 100).toFixed(1) + '%'
                    }
                );
            } else {
                // Check for existing open trade for this token
                const existingTrade = portfolio.trades.find(t => t.tokenId === tokenData.tokenId && t.status === 'OPEN');
                if (existingTrade) {
                    logger.trade.rejected(
                        tokenData.tokenId,
                        tradeId,
                        "Already have an open position for this token",
                        { existingTradeEntryTime: existingTrade.entryTime }
                    );
                } else {
                    // Check if we have reached the maximum number of concurrent open positions
                    const activePositionsCount = portfolio.trades.filter(t => t.status === 'OPEN').length;
                    if (activePositionsCount >= portfolio.maxActivePositions) {
                        logger.trade.rejected(
                            tokenData.tokenId,
                            tradeId,
                            "Maximum number of concurrent positions reached",
                            {
                                activePositions: activePositionsCount,
                                maxAllowed: portfolio.maxActivePositions
                            }
                        );
                    } else {
                        // Determine investment amount - either use suggested percentage or default to 10%
                        const investmentPercentage = prediction.suggestedInvestmentPercentage || 0.1;
                        // Cap the max investment at portfolio's maxPositionSize
                        const actualPercentage = Math.min(investmentPercentage, portfolio.maxPositionSize);

                        const tradeAmount = Math.min(portfolio.currentBalance * actualPercentage, 100); // Max $100 per trade

                        // Check if tradeAmount is significant enough
                        if (tradeAmount >= 10) { // Minimum trade size of $10
                            const tokenAmount = tradeAmount / tokenData.price;

                            // Calculate risk-to-reward ratio
                            const potentialProfit = (prediction.takeProfitPrice - tokenData.price) * tokenAmount;
                            const potentialLoss = (tokenData.price - prediction.stopLossPrice) * tokenAmount;
                            const riskRewardRatio = potentialProfit / potentialLoss;

                            // Only proceed if risk-reward ratio is favorable (typically > 1)
                            if (riskRewardRatio >= 1) {
                                const trade: Trade = {
                                    tokenId: tokenData.tokenId,
                                    address: tokenData.address,
                                    symbol: tokenData.symbol,
                                    entryPrice: tokenData.price,
                                    entryAmount: tradeAmount,
                                    tokenAmount,
                                    takeProfitPrice: prediction.takeProfitPrice,
                                    stopLossPrice: prediction.stopLossPrice,
                                    entryTime: new Date().toISOString(),
                                    profitLoss: 0,
                                    status: 'OPEN'
                                };

                                // Execute the trade
                                portfolio.trades.push(trade);
                                portfolio.currentBalance -= tradeAmount;
                                await this.learningService.updatePortfolio(portfolio);

                                logger.trade.opened(
                                    tokenData.tokenId,
                                    tradeId,
                                    tokenData.price,
                                    tradeAmount,
                                    tokenAmount,
                                    {
                                        riskRewardRatio,
                                        remainingBalance: portfolio.currentBalance,
                                        percentOfInitial: (portfolio.currentBalance / portfolio.initialBalance * 100).toFixed(2) + '%',
                                        activePositions: activePositionsCount + 1,
                                        takeProfitPrice: prediction.takeProfitPrice,
                                        stopLossPrice: prediction.stopLossPrice
                                    }
                                );
                            } else {
                                logger.trade.rejected(
                                    tokenData.tokenId,
                                    tradeId,
                                    "Unfavorable risk-reward ratio",
                                    {
                                        riskRewardRatio,
                                        takeProfitPrice: prediction.takeProfitPrice,
                                        stopLossPrice: prediction.stopLossPrice,
                                        potentialProfit,
                                        potentialLoss
                                    }
                                );
                            }
                        } else {
                            logger.trade.rejected(
                                tokenData.tokenId,
                                tradeId,
                                "Trade amount too small",
                                {
                                    calculatedAmount: tradeAmount,
                                    minRequired: 10
                                }
                            );
                        }
                    }
                }
            }
        }

        await this.runtime.ensureRoomExists(roomId);
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
                    initialMarketCap: tokenData.marketCap,
                    tweets,
                    ohlcvData,
                    portfolio,
                    predictionId // Store the predictionId for tracing
                }
            },
            createdAt: Date.now()
        };

        await this.runtime.messageManager.createMemory(await this.runtime.messageManager.addEmbeddingToMemory(predictionMemory), true);
        await this.scheduleChecks(tokenData.tokenId, roomId, tokenData.address, prediction, predictionId);

        // Log total prediction time
        perfTimer.end({
            decision: prediction.entryDecision,
            llmDuration,
        });

        return prediction;
    }

    // Modified scheduleChecks method to capture token data
    private async scheduleChecks(tokenId: string, roomId: UUID, tokenAddress: string, prediction: TokenPrediction, predictionId: string): Promise<void> {
        const checks: PredictionCheck[] = [];
        let shouldStop = false;

        const checkToken = async (minuteMark: number): Promise<void> => {
            if (shouldStop) return;

            try {
                // Get updated market data
                const marketData = await this.marketDataProvider.getTokenMarketData(tokenAddress);

                // Check if we should stop early (marketCap < $10K)
                if (marketData.marketCap < 10000) {
                    shouldStop = true;
                }

                // Get updated distribution data
                const distributionData = await this.tokenMigrationProvider.checkTokenDistribution(tokenAddress);

                // Get bundle data
                let bundleData = undefined;
                try {
                    const bundleAnalysis = await this.tokenMigrationProvider.analyzeMintAddress(tokenAddress);
                    if (bundleAnalysis.success && bundleAnalysis.data) {
                        bundleData = {
                            totalBundles: Object.keys(bundleAnalysis.data.bundles || {}).length > 0 ?
                                Object.values(bundleAnalysis.data.bundles).filter((b: any) => b.holding_amount > 0).length : 0,
                            totalSolSpent: bundleAnalysis.data.total_sol_spent || 0,
                            currentHeldPercentage: bundleAnalysis.data.total_holding_percentage || 0,
                            totalBundledPercentage: bundleAnalysis.data.total_percentage_bundled || 0
                        };
                    }
                } catch (error) {
                    logger.api.error('bundle_analysis_check_schedule',
                        new Error(`Bundle analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }

                // Get OHLCV data (1-minute candles, last 10 minutes)
                const ohlcvData = await this.marketDataProvider.getTokenOHLCVData(
                    tokenAddress, '1m', Math.floor(Date.now() / 1000) - 600, Math.floor(Date.now() / 1000)
                );

                // Create the token data object for consistency
                const currentTokenData: TokenData = {
                    tokenId,
                    address: tokenAddress,
                    symbol: marketData.symbol,
                    name: marketData.symbol, // Use symbol as fallback
                    marketCap: marketData.marketCap,
                    price: marketData.price,
                    distribution: distributionData,
                    bundleData,
                    // Include additional market data fields
                    holderCount: marketData.holderCount,
                    volume1hUSD: marketData.volume1hUSD,
                    volume24hUSD: marketData.volume24hUSD,
                    priceChange1h: marketData.priceChange1h,
                    priceChange24h: marketData.priceChange24h,
                    uniqueTraders1h: marketData.uniqueTraders1h,
                    trades1h: marketData.trades1h
                };

                // Create the check object
                const check: PredictionCheck = {
                    timestamp: new Date().toISOString(),
                    marketCap: marketData.marketCap,
                    marketData,
                    distribution: distributionData,
                    bundleData,
                    ohlcv: ohlcvData
                };

                // Add to our checks array
                checks.push(check);

                // Log the check
                logger.prediction.check(
                    tokenId,
                    predictionId,
                    minuteMark / 2, // checkNumber (1 for 2min, 2 for 4min, etc.)
                    marketData.marketCap,
                    marketData.price || 0
                );

                // NEW CODE: Check if there's an open trade for this token and evaluate if we should close it
                await this.evaluateOpenTrade(tokenId, marketData.price, ohlcvData);

                // Capture token data for this check
                const checkTypeMap: Record<number, "2MIN" | "4MIN" | "6MIN" | "8MIN" | "10MIN"> = {
                    2: "2MIN",
                    4: "4MIN",
                    6: "6MIN",
                    8: "8MIN",
                    10: "10MIN"
                };

                const checkType = checkTypeMap[minuteMark];
                await this.tokenDataService.captureTokenData(currentTokenData, checkType, {
                    ohlcvData,
                    checkNumber: minuteMark / 2,
                    isInitialCheck: false,
                    predictionResultId: predictionId,
                    currentPrediction: prediction
                });

                // If this is the final check or we hit the early stop condition,
                // create the summary
                if (minuteMark === 10 || shouldStop) {
                    await this.createTokenSummary(tokenId, roomId, prediction, checks, predictionId);
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown error');
                logger.prediction.error(tokenId, predictionId, err);
            }
        };

        // Schedule checks at 2, 4, 6, 8, and 10 minutes
        setTimeout(() => checkToken(2), 2 * 60 * 1000);
        setTimeout(() => checkToken(4), 4 * 60 * 1000);
        setTimeout(() => checkToken(6), 6 * 60 * 1000);
        setTimeout(() => checkToken(8), 8 * 60 * 1000);
        setTimeout(() => checkToken(10), 10 * 60 * 1000);
    }

    // NEW METHOD: Evaluates and potentially closes open trades based on current price
    private async evaluateOpenTrade(tokenId: string, currentPrice: number | undefined, ohlcvData: OHLCVData[]): Promise<void> {
        if (!currentPrice) return; // Can't evaluate without a price

        // Get the portfolio to find the trade
        const portfolio = await this.learningService.getPortfolio();
        if (!portfolio) return;

        // Find the open trade for this token
        const tradeIndex = portfolio.trades.findIndex(t => t.tokenId === tokenId && t.status === 'OPEN');
        if (tradeIndex === -1) return; // No open trade found

        const trade = portfolio.trades[tradeIndex];
        const tradeId = generateTradeId(tokenId);

        // Calculate unrealized P/L for logging
        const unrealizedPnL = (currentPrice - trade.entryPrice) * trade.tokenAmount;
        const percentChange = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;

        // Log trade status
        logger.trade.status(tokenId, tradeId, currentPrice, unrealizedPnL, percentChange);

        // Check if stop loss or take profit has been hit
        let shouldClose = false;
        let exitReason = '';

        if (currentPrice <= trade.stopLossPrice) {
            shouldClose = true;
            exitReason = 'Stop loss triggered';
        } else if (currentPrice >= trade.takeProfitPrice) {
            shouldClose = true;
            exitReason = 'Take profit triggered';
        }

        // Also check OHLCV data to see if price previously hit SL/TP between checks
        // This handles cases where price briefly hit SL/TP and bounced back
        if (!shouldClose && ohlcvData.length > 0) {
            const entryTime = new Date(trade.entryTime).getTime() / 1000;

            for (const candle of ohlcvData) {
                if (candle.timestamp < entryTime) continue; // Skip candles before trade entry

                if (candle.low <= trade.stopLossPrice) {
                    shouldClose = true;
                    exitReason = 'Stop loss triggered in candle data';
                    currentPrice = Math.min(candle.close, trade.stopLossPrice);
                    break;
                } else if (candle.high >= trade.takeProfitPrice) {
                    shouldClose = true;
                    exitReason = 'Take profit triggered in candle data';
                    currentPrice = Math.max(candle.close, trade.takeProfitPrice);
                    break;
                }
            }
        }

        // Close the trade if needed
        if (shouldClose) {
            // Update trade with exit information
            const profitLoss = (currentPrice - trade.entryPrice) * trade.tokenAmount;
            const profitLossPercent = (profitLoss / trade.entryAmount) * 100;

            // Update the trade object
            portfolio.trades[tradeIndex].exitPrice = currentPrice;
            portfolio.trades[tradeIndex].exitTime = new Date().toISOString();
            portfolio.trades[tradeIndex].profitLoss = profitLoss;
            portfolio.trades[tradeIndex].status = 'CLOSED';

            // Update portfolio balance
            portfolio.currentBalance += trade.entryAmount + profitLoss;

            // Save updated portfolio
            await this.learningService.updatePortfolio(portfolio);

            // Log the closed trade
            logger.trade.closed(
                tokenId,
                tradeId,
                currentPrice,
                exitReason,
                profitLoss,
                profitLossPercent
            );
        }
    }

    // Evaluates prediction results using LLM
    private async evaluatePrediction(
        tokenData: TokenData,
        tweets: string,
        ohlcvData: OHLCVData[],
        prediction: TokenPrediction,
        checks: PredictionCheck[]
    ): Promise<{ reflection: string; lessonsLearned: string[] }> {
        const pastPredictions = await this.learningService.getRecentPredictions(3);
        const accuracyStats = await this.learningService.getHistoricalAccuracy();

        // Prepare state for LLM evaluation
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
                actualResults: JSON.stringify(checks, null, 2),
                pastPredictions,
                historicalAccuracy: accuracyStats.percentage.toFixed(2),
                predictionCount: accuracyStats.count,
                avgMape: (accuracyStats.avgMape * 100).toFixed(2)
            }
        );
        const context = composeContext({ state, template: evaluatePredictionTemplate });
        // elizaLogger.info('LLM Input State Evaluate Prediction:', context);
        const response = await generateText({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.LARGE
        });

        // Parse LLM response for reflection and lessons
        const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (!codeBlockMatch) throw new Error('Evaluation response missing code block');

        const evaluationData = JSON.parse(codeBlockMatch[1].trim());
        return {
            reflection: evaluationData.reflection || "No reflection provided.",
            lessonsLearned: evaluationData.lessonsLearned || []
        };
    }

    // Creates a summary of prediction results and stores it
    private async createTokenSummary(tokenId: string, roomId: UUID, prediction: TokenPrediction, checks: PredictionCheck[], predictionId: string): Promise<void> {
        // Fetch prediction memory and portfolio data
        const predictionMemory = await this.runtime.messageManager.getMemoryById(stringToUuid(`prediction-${tokenId}`)) as PredictionMemory | undefined;
        const portfolio = await this.learningService.getPortfolio() || { initialBalance: 1000, currentBalance: 1000, trades: [] };
        let trade = portfolio.trades.find(t => t.tokenId === tokenId);

        // Extract token data and OHLCV data
        let tokenData: TokenData = predictionMemory?.content.metadata.originalToken || { tokenId, address: "unknown", symbol: "UNKNOWN", name: "Unknown", marketCap: 0 } as TokenData;
        let tweets: string = predictionMemory?.content.metadata.tweets || "No tweets available";
        let ohlcvData: OHLCVData[] = checks[4]?.ohlcv || []; // OHLCV from the last check (10 minutes, 1-minute candles)
        let initialMarketCap: number = predictionMemory?.content.metadata.initialMarketCap || tokenData.marketCap;

        // Variables to track trade adjustments
        let adjustedExitTime: string | undefined;
        let adjustedExitPrice: number | undefined;
        let adjustedProfitLoss: number | undefined;
        let earliestExitTime: number | null = null;
        let earliestExitPrice: number | null = null;

        // Check if trade is still open and close it if necessary
        if (trade && trade.status === 'OPEN' && checks.length > 0) {
            const lastCheck = checks[checks.length - 1];
            const currentPrice = lastCheck.marketData?.price;

            if (currentPrice) {
                // Force close the trade with final price
                const tradeIndex = portfolio.trades.findIndex(t => t.tokenId === tokenId && t.status === 'OPEN');
                if (tradeIndex !== -1) {
                    const tradeId = generateTradeId(tokenId);
                    const profitLoss = (currentPrice - trade.entryPrice) * trade.tokenAmount;
                    const profitLossPercent = (profitLoss / trade.entryAmount) * 100;

                    // Update the trade object
                    portfolio.trades[tradeIndex].exitPrice = currentPrice;
                    portfolio.trades[tradeIndex].exitTime = new Date().toISOString();
                    portfolio.trades[tradeIndex].profitLoss = profitLoss;
                    portfolio.trades[tradeIndex].status = 'CLOSED';

                    // Update portfolio balance
                    portfolio.currentBalance += trade.entryAmount + profitLoss;

                    // Save updated portfolio
                    await this.learningService.updatePortfolio(portfolio);

                    // Log the closed trade
                    logger.trade.closed(
                        tokenId,
                        tradeId,
                        currentPrice,
                        'End of monitoring period',
                        profitLoss,
                        profitLossPercent
                    );

                    // Update the trade reference with the latest data
                    const updatedPortfolio = await this.learningService.getPortfolio();
                    if (updatedPortfolio) {
                        const updatedTrade = updatedPortfolio.trades.find(t => t.tokenId === tokenId);
                        if (updatedTrade) {
                            trade = updatedTrade;
                        }
                    }
                }
            }
        }

        // Evaluate trade using OHLCV data if applicable
        if (trade && ohlcvData.length > 0) {
            const entryTime = new Date(trade.entryTime).getTime() / 1000; // Convert to Unix timestamp (seconds)
            const slPrice = trade.stopLossPrice;
            const tpPrice = trade.takeProfitPrice;

            // Reset these variables
            earliestExitTime = null;
            earliestExitPrice = null;
            let exitType: 'SL' | 'TP' | null = null;

            // Analyze each candle for stop loss or take profit triggers
            for (const candle of ohlcvData) {
                const candleTime = candle.timestamp; // Assuming timestamp is in seconds
                if (candleTime < entryTime) continue; // Skip candles before trade entry

                if (candle.low <= slPrice) {
                    // Stop loss triggered
                    earliestExitTime = candleTime;
                    earliestExitPrice = Math.min(candle.close, slPrice); // Exit at SL price or candle close
                    exitType = 'SL';
                    break; // Exit at the earliest trigger
                } else if (candle.high >= tpPrice) {
                    // Take profit triggered
                    earliestExitTime = candleTime;
                    earliestExitPrice = Math.max(candle.close, tpPrice); // Exit at TP price or candle close
                    exitType = 'TP';
                    break; // Exit at the earliest trigger
                }
            }

            // Adjust trade details if an earlier exit is found in candle data
            if (earliestExitTime && earliestExitPrice) {
                const originalExitTime = trade.exitTime || '';
                const originalExitPrice = trade.exitPrice || 0;
                const originalProfitLoss = trade.profitLoss;

                adjustedExitTime = new Date(earliestExitTime * 1000).toISOString();
                adjustedExitPrice = earliestExitPrice;
                adjustedProfitLoss = (adjustedExitPrice - trade.entryPrice) * trade.tokenAmount;

                // Generate a trade ID for logging consistency
                const tradeId = generateTradeId(tokenId);

                logger.trade.adjusted(
                    tokenId,
                    tradeId,
                    originalExitTime,
                    adjustedExitTime,
                    originalExitPrice,
                    adjustedExitPrice,
                    originalProfitLoss,
                    adjustedProfitLoss,
                    predictionId
                );

                // Compare to initial trading position
                const initialPositionValue = trade.entryPrice * trade.tokenAmount;
                const finalPositionValue = adjustedExitPrice * trade.tokenAmount;
                const positionChangePercent = ((finalPositionValue - initialPositionValue) / initialPositionValue) * 100;

                logger.trade.comparison(
                    tokenId,
                    tradeId,
                    trade.entryPrice,
                    adjustedExitPrice,
                    initialPositionValue,
                    finalPositionValue,
                    adjustedProfitLoss,
                    positionChangePercent,
                    predictionId
                );
            } else if (trade.status === 'CLOSED') {
                // No earlier exit found, but trade was closed at a check
                // Generate a trade ID for logging consistency
                const tradeId = generateTradeId(tokenId);

                if (trade.exitPrice) {
                    const profitLossPercent = (trade.profitLoss / trade.entryAmount) * 100;

                    logger.trade.closed(
                        tokenId,
                        tradeId,
                        trade.exitPrice,
                        'Scheduled check',
                        trade.profitLoss,
                        profitLossPercent
                    );
                }
            }
        }

        // Calculate summary metrics
        const finalMarketCap = checks[checks.length - 1]?.marketCap || initialMarketCap;
        const maxMarketCap = checks.length > 0 ? Math.max(...checks.map(c => c.marketCap)) : initialMarketCap;
        const maxPredictedMarketCap = Math.max(...Object.values(prediction.marketCapPredictions));
        const achievedTarget = prediction.entryDecision === "BUY" ? maxMarketCap >= maxPredictedMarketCap * 0.90 : finalMarketCap <= initialMarketCap * 1.10;

        const timeSteps = ["2min", "4min", "6min", "8min", "10min"];
        const mapePerStep = timeSteps.map((time, index) => {
            const pred = prediction.marketCapPredictions[time as keyof typeof prediction.marketCapPredictions];
            const check = checks[index];
            const actual = check ? check.marketCap : finalMarketCap;
            const mape = actual > 0 ? Math.abs((pred - actual) / actual) : 0;
            const achieved = prediction.entryDecision === "BUY" ? actual >= pred * 0.90 : actual <= initialMarketCap * 1.10;
            return { time, mape, achieved };
        });
        const overallMape = mapePerStep.reduce((sum, step) => sum + step.mape, 0) / mapePerStep.length;

        const evaluationResult = await this.evaluatePrediction(tokenData, tweets, ohlcvData, prediction, checks);

        // Get the exit price to display (prefer adjusted if available, otherwise use trade exit price)
        let displayExitPrice: string = 'N/A';
        if (adjustedExitPrice !== undefined) {
            displayExitPrice = adjustedExitPrice.toFixed(6);
        } else if (trade?.exitPrice !== undefined) {
            displayExitPrice = trade.exitPrice.toFixed(6);
        }

        // Get the profit/loss to display (prefer adjusted if available, otherwise use trade profit/loss)
        let displayProfitLoss: number = 0;
        if (adjustedProfitLoss !== undefined) {
            displayProfitLoss = adjustedProfitLoss;
        } else if (trade?.profitLoss !== undefined) {
            displayProfitLoss = trade.profitLoss;
        }

        // Construct the summary object
        const summary = {
            prediction,
            checks,
            results: {
                initialMarketCap,
                finalMarketCap,
                maxMarketCap,
                achievedTarget,
                mape: overallMape,
                mapePerStep
            },
            reflection: evaluationResult.reflection,
            lessonsLearned: evaluationResult.lessonsLearned,
            tradeResult: trade ? {
                entryPrice: trade.entryPrice,
                exitPrice: adjustedExitPrice || trade.exitPrice,
                profitLoss: displayProfitLoss,
                status: trade.status
            } : undefined
        };

        // Generate summary text
        const summaryText = [
            `Summary for ${tokenData.address}`,
            `Decision: ${prediction.entryDecision}`,
            `Achieved: ${achievedTarget}`,
            `MAPE: ${(overallMape * 100).toFixed(2)}%`,
            ...mapePerStep.map(step => `${step.time}: Predicted ${(prediction.marketCapPredictions[step.time as '2min' | '4min' | '6min' | '8min' | '10min']).toFixed(2)}, Actual ${(checks[timeSteps.indexOf(step.time)]?.marketCap || finalMarketCap).toFixed(2)}, MAPE ${(step.mape * 100).toFixed(2)}%, Achieved: ${step.achieved}`),
            trade ? `Trade: Entry $${trade.entryPrice.toFixed(6)}, Exit $${displayExitPrice}, P/L $${displayProfitLoss.toFixed(2)}` : 'No trade executed',
            `Portfolio Balance: $${portfolio.currentBalance.toFixed(2)}`,
            `Reflection: ${evaluationResult.reflection}`,
            `Lessons Learned: ${evaluationResult.lessonsLearned.join(", ") || "None"}`
        ].join("\n");

        // Create and store summary memory
        const summaryMemory = {
            id: stringToUuid(`summary-${tokenId}`),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId,
            content: { text: summaryText, metadata: summary },
            createdAt: Date.now()
        };

        await this.runtime.messageManager.createMemory(await this.runtime.messageManager.addEmbeddingToMemory(summaryMemory), true);
        await this.learningService.recordPredictionSummary(tokenId, summary);

        // After creating the summary, store the FINAL token data record
        if (checks.length > 0) {
            const lastCheck = checks[checks.length - 1];
            const marketData = lastCheck.marketData;

            if (marketData) {
                // Create a final token data record
                const finalTokenData: TokenData = {
                    tokenId,
                    address: tokenData.address,
                    symbol: marketData.symbol,
                    name: marketData.symbol, // Use symbol as fallback
                    marketCap: marketData.marketCap,
                    price: marketData.price,
                    // Ensure distribution has all required fields
                    distribution: lastCheck.distribution ? {
                        topHolderPercent: lastCheck.distribution.topHolderPercent,
                        topHolders: lastCheck.distribution.topHolders,
                        suspiciousDistribution: false // Set a default value
                    } : undefined,
                    bundleData: lastCheck.bundleData,
                    // Include additional market data fields
                    holderCount: marketData.holderCount,
                    volume1hUSD: marketData.volume1hUSD,
                    volume24hUSD: marketData.volume24hUSD,
                    priceChange1h: marketData.priceChange1h,
                    priceChange24h: marketData.priceChange24h,
                    uniqueTraders1h: marketData.uniqueTraders1h,
                    trades1h: marketData.trades1h
                };

                // Capture the final data
                await this.tokenDataService.captureTokenData(finalTokenData, 'FINAL', {
                    ohlcvData: lastCheck.ohlcv,
                    checkNumber: checks.length,
                    isInitialCheck: false,
                    predictionResultId: predictionId,
                    // Add trade data if available
                    tradeId: trade ? generateTradeId(tokenId) : undefined,
                    entryPrice: trade?.entryPrice,
                    entryTime: trade?.entryTime,
                    exitPrice: adjustedExitPrice || trade?.exitPrice,
                    exitTime: adjustedExitTime || trade?.exitTime,
                    profitLoss: adjustedProfitLoss || trade?.profitLoss,
                    profitLossPercent: trade ? ((adjustedProfitLoss || trade.profitLoss || 0) / (trade.entryAmount || 1)) * 100 : undefined
                });
            }
        }
    }

    // Parses LLM response into a TokenPrediction object
    private parseAnalysisResponse(response: string): TokenPrediction {
        try {
            // First attempt to extract structured JSON from any code block
            const codeBlockMatch = response.match(/```(?:json)?([^```]+)```/);
            if (codeBlockMatch) {
                try {
                    // Extract content from code block and parse as JSON
                    const parsed = JSON.parse(codeBlockMatch[1].trim());
                    elizaLogger.info('Successfully parsed prediction JSON from code block');

                    // Validate required fields are present in parsed JSON
                    if (
                        parsed.entryDecision &&
                        parsed.marketCapPredictions &&
                        parsed.confidence !== undefined &&
                        Array.isArray(parsed.supportingFactors) &&
                        Array.isArray(parsed.riskFactors) &&
                        parsed.reasoning
                    ) {
                        // Validate and normalize investment percentage if present
                        let suggestedInvestmentPercentage = parsed.suggestedInvestmentPercentage;
                        if (suggestedInvestmentPercentage !== undefined) {
                            // Handle if it's given as a percentage (e.g., 10%) instead of decimal (0.1)
                            if (suggestedInvestmentPercentage > 1) {
                                suggestedInvestmentPercentage = suggestedInvestmentPercentage / 100;
                            }
                            // Ensure it's within reasonable bounds (0.01 to 0.2 or 1% to 20%)
                            suggestedInvestmentPercentage = Math.max(0.01, Math.min(0.2, suggestedInvestmentPercentage));
                        }

                        // Create structured prediction with validated fields
                        return {
                            entryDecision: parsed.entryDecision,
                            marketCapPredictions: parsed.marketCapPredictions,
                            confidence: parsed.confidence,
                            takeProfitPrice: parsed.takeProfitPrice,
                            stopLossPrice: parsed.stopLossPrice,
                            suggestedInvestmentPercentage,
                            supportingFactors: parsed.supportingFactors,
                            riskFactors: parsed.riskFactors,
                            reasoning: parsed.reasoning
                        };
                    }
                } catch (jsonError) {
                    elizaLogger.warn('Failed to parse JSON from code block:', { error: jsonError instanceof Error ? jsonError.message : 'Unknown error' });
                    // Continue to regex fallback approach
                }
            }

            // Fallback: Use regex extraction for each expected field
            const prediction: TokenPrediction = {
                entryDecision: (response.match(/Decision:\s*(BUY|IGNORE)/i)?.[1] || 'IGNORE').toUpperCase() as 'BUY' | 'IGNORE',
                marketCapPredictions: {
                    '2min': parseInt(response.match(/2\s*min(?:ute)?s?:?\s*\$?(\d+)/i)?.[1] || '0', 10),
                    '4min': parseInt(response.match(/4\s*min(?:ute)?s?:?\s*\$?(\d+)/i)?.[1] || '0', 10),
                    '6min': parseInt(response.match(/6\s*min(?:ute)?s?:?\s*\$?(\d+)/i)?.[1] || '0', 10),
                    '8min': parseInt(response.match(/8\s*min(?:ute)?s?:?\s*\$?(\d+)/i)?.[1] || '0', 10),
                    '10min': parseInt(response.match(/10\s*min(?:ute)?s?:?\s*\$?(\d+)/i)?.[1] || '0', 10)
                },
                confidence: parseFloat(response.match(/[Cc]onfidence:?\s*(\d*\.?\d+)/)?.[1] || '0'),
                takeProfitPrice: parseFloat(response.match(/[Tt]ake\s*[Pp]rofit\s*(?:[Pp]rice)?:?\s*\$?(\d*\.?\d+)/)?.[1] || '0') || undefined,
                stopLossPrice: parseFloat(response.match(/[Ss]top\s*[Ll]oss\s*(?:[Pp]rice)?:?\s*\$?(\d*\.?\d+)/)?.[1] || '0') || undefined,
                // Extract suggested investment percentage
                suggestedInvestmentPercentage: (() => {
                    const percentMatch = response.match(/[Ss]uggested\s*[Ii]nvestment\s*(?:[Pp]ercentage)?:?\s*(\d*\.?\d+)%?/);
                    if (percentMatch) {
                        let value = parseFloat(percentMatch[1]);
                        // Convert percentage to decimal if needed
                        if (value > 1) {
                            value = value / 100;
                        }
                        // Ensure it's within reasonable bounds
                        return Math.max(0.01, Math.min(0.2, value));
                    }
                    return undefined;
                })(),
                supportingFactors: (() => {
                    const factorMatch = response.match(/[Ss]upporting\s*[Ff]actors:?\s*([\s\S]*?)(?:(?:[Rr]isk|[Oo]ther).*?:|$)/);
                    if (factorMatch) {
                        return factorMatch[1]
                            .split(/\n|,|\.|•/)
                            .map(f => f.trim())
                            .filter(f => f.length > 0);
                    }
                    return [];
                })(),
                riskFactors: (() => {
                    const factorMatch = response.match(/[Rr]isk\s*[Ff]actors:?\s*([\s\S]*?)(?:(?:[Ss]upporting|[Rr]easoning|[Oo]ther).*?:|$)/);
                    if (factorMatch) {
                        return factorMatch[1]
                            .split(/\n|,|\.|•/)
                            .map(f => f.trim())
                            .filter(f => f.length > 0);
                    }
                    return [];
                })(),
                reasoning: response.match(/[Rr]easoning:?\s*([\s\S]*?)(?:(?:[Ss]upporting|[Rr]isk|[Oo]ther).*?:|$)/)?.[1]?.trim() || 'No reasoning provided'
            };

            // Clean up any undefined values in market cap predictions
            Object.keys(prediction.marketCapPredictions).forEach(key => {
                if (!prediction.marketCapPredictions[key as keyof typeof prediction.marketCapPredictions]) {
                    prediction.marketCapPredictions[key as keyof typeof prediction.marketCapPredictions] = 0;
                }
            });

            return prediction;
        } catch (error) {
            elizaLogger.error('Failed to parse prediction:', { error: error instanceof Error ? error.message : 'Unknown error' });
            // Return default values when parsing fails
            return {
                entryDecision: 'IGNORE',
                marketCapPredictions: { '2min': 0, '4min': 0, '6min': 0, '8min': 0, '10min': 0 },
                confidence: 0,
                supportingFactors: [],
                riskFactors: ['Parsing error in prediction'],
                reasoning: 'Failed to parse prediction response'
            };
        }
    }
}