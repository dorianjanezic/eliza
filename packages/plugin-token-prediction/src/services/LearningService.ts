import { elizaLogger, type IAgentRuntime, stringToUuid, type UUID } from "@ai16z/eliza";
import type { PredictionResult, TokenPrediction } from "../types";
import { Portfolio, Trade } from "../types/portfolio";
import { logger } from "../utils/logger";

// Manages prediction summaries and historical accuracy for token predictions
export class LearningService {
    private readonly globalSummaryRoomId: UUID = stringToUuid("token-prediction-summaries"); // Unique room ID for storing all summaries
    private readonly globalPortfolioRoomId: UUID = stringToUuid("global-portfolio");
    private static initialized = false; // Static flag to ensure one-time initialization

    constructor(private runtime: IAgentRuntime) {
        // Initialize global room only once per instance creation
        if (!LearningService.initialized) {
            this.initializeGlobalRoom();
            LearningService.initialized = true;
            this.initializePortfolio();
        }
    }

    async initializePortfolio() {
        await this.runtime.ensureRoomExists(this.globalPortfolioRoomId);
        await this.runtime.ensureParticipantInRoom(this.runtime.agentId, this.globalPortfolioRoomId);

        // Get existing memories in the portfolio room
        const memories = await this.runtime.messageManager.getMemoriesByRoomIds({ roomIds: [this.globalPortfolioRoomId] });

        // Clear all existing memories to start completely fresh
        for (const memory of memories) {
            try {
                if (memory.id) {
                    await this.runtime.messageManager.removeMemory(memory.id);
                    logger.portfolio.reset();
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown error');
                logger.portfolio.error(err);
            }
        }

        // Create a fresh initial portfolio with $1000 and no trades
        const initialPortfolio: Portfolio = {
            initialBalance: 1000,
            currentBalance: 1000,
            trades: [],
            maxActivePositions: 3, // Limit concurrent trades to 3
            maxPositionSize: 0.2,  // Limit position size to 20% of portfolio
            minPortfolioThreshold: 0.6, // Don't enter trades when below 60% of initial
            stats: {
                totalTrades: 0,
                profitableTrades: 0,
                unprofitableTrades: 0,
                winRate: 0,
                totalPnL: 0,
                avgPnL: 0,
                avgWin: 0,
                avgLoss: 0,
                maxDrawdown: 0,
                maxDrawdownPercentage: 0,
                activeTrades: 0,
                closedTrades: 0,
                avgTradeDuration: 0,
                bestTrade: {
                    symbol: '',
                    profitLoss: 0,
                    profitLossPercentage: 0
                },
                worstTrade: {
                    symbol: '',
                    profitLoss: 0,
                    profitLossPercentage: 0
                },
                currentOpenPositions: []
            }
        };

        await this.runtime.messageManager.createMemory({
            id: stringToUuid("portfolio-initial"),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: this.globalPortfolioRoomId,
            content: { text: "Initial Portfolio", metadata: initialPortfolio },
            createdAt: Date.now()
        }, true);

        logger.portfolio.initialized(initialPortfolio.initialBalance);
    }

    async updatePortfolio(portfolio: Portfolio) {
        // Calculate portfolio statistics
        const closedTrades = portfolio.trades.filter(t => t.status === 'CLOSED');
        const openTrades = portfolio.trades.filter(t => t.status === 'OPEN');
        const profitableTrades = closedTrades.filter(t => t.profitLoss > 0);
        const unprofitableTrades = closedTrades.filter(t => t.profitLoss < 0);

        // Calculate trade statistics
        const totalPnL = closedTrades.reduce((sum, t) => sum + t.profitLoss, 0);
        const avgPnL = closedTrades.length > 0 ? totalPnL / closedTrades.length : 0;
        const avgWin = profitableTrades.length > 0 ? profitableTrades.reduce((sum, t) => sum + t.profitLoss, 0) / profitableTrades.length : 0;
        const avgLoss = unprofitableTrades.length > 0 ? unprofitableTrades.reduce((sum, t) => sum + t.profitLoss, 0) / unprofitableTrades.length : 0;

        // Calculate drawdown
        const balanceHistory = portfolio.trades.map(t => ({
            time: new Date(t.entryTime).getTime(),
            balance: t.entryAmount
        }));
        let maxDrawdown = 0;
        let maxDrawdownPercentage = 0;
        let peak = portfolio.initialBalance;

        for (const trade of portfolio.trades) {
            const balance = trade.entryAmount;
            if (balance > peak) {
                peak = balance;
            }
            const drawdown = peak - balance;
            const drawdownPercentage = (drawdown / peak) * 100;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
            maxDrawdownPercentage = Math.max(maxDrawdownPercentage, drawdownPercentage);
        }

        // Calculate best and worst trades
        const bestTrade = closedTrades.length > 0 ? closedTrades.reduce((best, current) =>
            current.profitLossPercentage > best.profitLossPercentage ? current : best
        ) : { symbol: 'N/A', profitLoss: 0, profitLossPercentage: 0 } as Trade;

        const worstTrade = closedTrades.length > 0 ? closedTrades.reduce((worst, current) =>
            current.profitLossPercentage < worst.profitLossPercentage ? current : worst
        ) : { symbol: 'N/A', profitLoss: 0, profitLossPercentage: 0 } as Trade;

        // Calculate average trade duration
        const avgTradeDuration = closedTrades.length > 0 ?
            closedTrades.reduce((sum, t) => {
                const entry = new Date(t.entryTime).getTime();
                const exit = new Date(t.exitTime || '').getTime();
                return sum + (exit - entry) / (1000 * 60); // Convert to minutes
            }, 0) / closedTrades.length : 0;

        // Update portfolio stats
        portfolio.stats = {
            totalTrades: portfolio.trades.length,
            profitableTrades: profitableTrades.length,
            unprofitableTrades: unprofitableTrades.length,
            winRate: closedTrades.length > 0 ? (profitableTrades.length / closedTrades.length) * 100 : 0,
            totalPnL,
            avgPnL,
            avgWin,
            avgLoss,
            maxDrawdown,
            maxDrawdownPercentage,
            activeTrades: openTrades.length,
            closedTrades: closedTrades.length,
            avgTradeDuration,
            bestTrade: {
                symbol: bestTrade.symbol,
                profitLoss: bestTrade.profitLoss,
                profitLossPercentage: bestTrade.profitLossPercentage
            },
            worstTrade: {
                symbol: worstTrade.symbol,
                profitLoss: worstTrade.profitLoss,
                profitLossPercentage: worstTrade.profitLossPercentage
            },
            currentOpenPositions: openTrades.map(t => ({
                symbol: t.symbol,
                entryPrice: t.entryPrice,
                currentPrice: t.entryPrice, // This should be updated with current price
                entryMarketCap: t.entryMarketCap,
                currentMarketCap: t.currentMarketCap || t.entryMarketCap,
                profitLoss: 0, // This should be calculated based on current price
                profitLossPercentage: 0 // This should be calculated based on current price
            }))
        };

        // Create a detailed text description of the portfolio state
        const text = [
            `Portfolio Update - Current State`,
            `Current Balance: $${portfolio.currentBalance.toFixed(2)} (${((portfolio.currentBalance / portfolio.initialBalance - 1) * 100).toFixed(2)}% change from initial)`,
            `Initial Balance: $${portfolio.initialBalance.toFixed(2)}`,
            `Risk Management:`,
            `- Active Positions: ${portfolio.trades.filter(t => t.status === 'OPEN').length} of ${portfolio.maxActivePositions} max`,
            `- Position Size Limit: ${(portfolio.maxPositionSize * 100).toFixed(0)}% of portfolio`,
            `- Portfolio Floor: ${(portfolio.minPortfolioThreshold * 100).toFixed(0)}% of initial balance`,
            `Performance Statistics:`,
            `- Total Trades: ${portfolio.stats.totalTrades}`,
            `- Win Rate: ${portfolio.stats.winRate.toFixed(2)}%`,
            `- Total P/L: $${portfolio.stats.totalPnL.toFixed(2)}`,
            `- Average P/L: $${portfolio.stats.avgPnL.toFixed(2)}`,
            `- Best Trade: ${portfolio.stats.bestTrade.symbol} (${portfolio.stats.bestTrade.profitLossPercentage.toFixed(2)}%)`,
            `- Worst Trade: ${portfolio.stats.worstTrade.symbol} (${portfolio.stats.worstTrade.profitLossPercentage.toFixed(2)}%)`,
            `- Max Drawdown: ${portfolio.stats.maxDrawdownPercentage.toFixed(2)}%`,
            `Active Trades:`,
            ...portfolio.trades
                .filter(t => t.status === 'OPEN')
                .map(t => `  - ${t.symbol}: Entry $${t.entryPrice.toFixed(6)}, Amount: $${t.entryAmount.toFixed(2)}, Stop Loss: $${t.stopLossPrice.toFixed(6)}, Take Profit: $${t.takeProfitPrice.toFixed(6)}`)
        ].join('\n');

        // Ensure we have valid text content for embedding
        if (!text.trim()) {
            elizaLogger.error('Cannot create portfolio memory: Empty text content');
            return;
        }

        // First, try to remove any existing portfolio memories to prevent duplicates
        try {
            const existingMemories = await this.runtime.messageManager.getMemoriesByRoomIds({ roomIds: [this.globalPortfolioRoomId] });
            for (const memory of existingMemories) {
                if (memory.id) {
                    await this.runtime.messageManager.removeMemory(memory.id);
                }
            }
        } catch (error) {
            elizaLogger.error('Failed to remove existing portfolio memories:', error);
        }

        const memory = {
            id: stringToUuid(`portfolio-${Date.now()}`),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: this.globalPortfolioRoomId,
            content: {
                text,
                metadata: portfolio
            },
            createdAt: Date.now()
        };

        try {
            // Try to create memory without embedding first
            await this.runtime.messageManager.createMemory(memory, true);
            logger.portfolio.updated(
                portfolio.currentBalance,
                portfolio.initialBalance,
                portfolio.trades.length,
                portfolio.stats.winRate
            );
        } catch (error) {
            elizaLogger.error('Failed to create portfolio memory:', error);
            // If that fails, try to create with embedding
            try {
                await this.runtime.messageManager.createMemory(await this.runtime.messageManager.addEmbeddingToMemory(memory), true);
            } catch (embeddingError) {
                elizaLogger.error('Failed to create portfolio memory with embedding:', embeddingError);
            }
        }
    }

    async getPortfolio(): Promise<Portfolio> {
        const memories = await this.runtime.messageManager.getMemoriesByRoomIds({ roomIds: [this.globalPortfolioRoomId] });
        if (memories.length === 0) {
            // Initialize with default values if no portfolio exists
            const initialPortfolio: Portfolio = {
                initialBalance: 1000,
                currentBalance: 1000,
                trades: [],
                maxActivePositions: 3,
                maxPositionSize: 0.2,
                minPortfolioThreshold: 0.6,
                stats: {
                    totalTrades: 0,
                    profitableTrades: 0,
                    unprofitableTrades: 0,
                    winRate: 0,
                    totalPnL: 0,
                    avgPnL: 0,
                    avgWin: 0,
                    avgLoss: 0,
                    maxDrawdown: 0,
                    maxDrawdownPercentage: 0,
                    activeTrades: 0,
                    closedTrades: 0,
                    avgTradeDuration: 0,
                    bestTrade: {
                        symbol: '',
                        profitLoss: 0,
                        profitLossPercentage: 0
                    },
                    worstTrade: {
                        symbol: '',
                        profitLoss: 0,
                        profitLossPercentage: 0
                    },
                    currentOpenPositions: []
                }
            };

            await this.runtime.messageManager.createMemory({
                id: stringToUuid("portfolio-initial"),
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                roomId: this.globalPortfolioRoomId,
                content: { text: "Initial Portfolio", metadata: initialPortfolio },
                createdAt: Date.now()
            }, true);
            elizaLogger.info("Created initial portfolio with default settings");
            return initialPortfolio;
        }

        const latest = memories.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
        const portfolio = latest.content.metadata as Portfolio;

        // Ensure portfolio has all required fields (for backward compatibility)
        if (!portfolio.maxActivePositions) portfolio.maxActivePositions = 3;
        if (!portfolio.maxPositionSize) portfolio.maxPositionSize = 0.2;
        if (!portfolio.minPortfolioThreshold) portfolio.minPortfolioThreshold = 0.6;
        if (!portfolio.stats) {
            portfolio.stats = {
                totalTrades: 0,
                profitableTrades: 0,
                unprofitableTrades: 0,
                winRate: 0,
                totalPnL: 0,
                avgPnL: 0,
                avgWin: 0,
                avgLoss: 0,
                maxDrawdown: 0,
                maxDrawdownPercentage: 0,
                activeTrades: 0,
                closedTrades: 0,
                avgTradeDuration: 0,
                bestTrade: {
                    symbol: '',
                    profitLoss: 0,
                    profitLossPercentage: 0
                },
                worstTrade: {
                    symbol: '',
                    profitLoss: 0,
                    profitLossPercentage: 0
                },
                currentOpenPositions: []
            };
        }

        return portfolio;
    }

    private async initializeGlobalRoom() {
        await this.runtime.ensureRoomExists(this.globalSummaryRoomId);
        await this.runtime.ensureParticipantInRoom(this.runtime.agentId, this.globalSummaryRoomId);
    }

    async recordPredictionSummary(tokenId: string, summary: PredictionResult): Promise<void> {
        const text = [
            `Token Prediction Summary for ${tokenId}`,
            `Initial Market Cap: $${summary.results.initialMarketCap.toLocaleString()}`,
            `Final Market Cap: $${summary.results.finalMarketCap.toLocaleString()}`,
            `Max Market Cap: $${summary.results.maxMarketCap.toLocaleString()}`,
            `Target Achieved: ${summary.results.achievedTarget ? 'Yes' : 'No'}`,
            `MAPE: ${summary.results.mape.toFixed(2)}%`,
            `Decision: ${summary.prediction.entryDecision}`,
            `Confidence: ${(summary.prediction.confidence * 100).toFixed(2)}%`,
            `Supporting Factors: ${summary.prediction.supportingFactors.join(', ')}`,
            `Risk Factors: ${summary.prediction.riskFactors.join(', ')}`,
            `Reflection: ${summary.reflection || 'No reflection available'}`
        ].join('\n');

        const memory = {
            id: stringToUuid(`prediction-${tokenId}-${Date.now()}`),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: this.globalSummaryRoomId,
            content: {
                text,
                metadata: {
                    ...summary,
                    results: {
                        ...summary.results,
                        achievedTarget: summary.results.achievedTarget
                    }
                }
            },
            createdAt: Date.now()
        };

        await this.runtime.messageManager.createMemory(await this.runtime.messageManager.addEmbeddingToMemory(memory), true);
    }

    async getRecentPredictions(limit: number = 5): Promise<string> {
        const memories = await this.runtime.messageManager.getMemoriesByRoomIds({ roomIds: [this.globalSummaryRoomId] });
        const sortedMemories = memories.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        const recentMemories = sortedMemories.slice(0, limit);

        if (recentMemories.length === 0) {
            return "No recent predictions available.";
        }

        return recentMemories.map(memory => memory.content.text).join('\n\n');
    }

    async getHistoricalAccuracy(): Promise<{
        percentage: number;
        count: number;
        avgMape: number;
    }> {
        const memories = await this.runtime.messageManager.getMemoriesByRoomIds({ roomIds: [this.globalSummaryRoomId] });
        const predictions = memories
            .filter(m => m.content.text.includes('Token Prediction Summary for'))
            .map(m => m.content.metadata as PredictionResult);

        if (predictions.length === 0) {
            return { percentage: 0, count: 0, avgMape: 0 };
        }

        const achievedTargets = predictions.filter(p => p.results.achievedTarget).length;
        const totalMape = predictions.reduce((sum, p) => sum + p.results.mape, 0);

        return {
            percentage: (achievedTargets / predictions.length) * 100,
            count: predictions.length,
            avgMape: totalMape / predictions.length
        };
    }

    async getDecisionAccuracy(): Promise<{
        buy: { percentage: number; correct: number; total: number };
        ignore: { percentage: number; correct: number; total: number };
        overall: { percentage: number; correct: number; total: number };
    }> {
        const memories = await this.runtime.messageManager.getMemoriesByRoomIds({ roomIds: [this.globalSummaryRoomId] });
        const predictions = memories
            .filter(m => m.content.text.includes('Token Prediction Summary for'))
            .map(m => m.content.metadata as PredictionResult)
            .filter(p => p.prediction.entryDecision && typeof p.results.achievedTarget === 'boolean');

        let buyCorrect = 0;
        let buyTotal = 0;
        let ignoreCorrect = 0;
        let ignoreTotal = 0;

        for (const prediction of predictions) {
            if (prediction.prediction.entryDecision === 'BUY') {
                buyTotal++;
                if (prediction.results.achievedTarget) {
                    buyCorrect++;
                }
            } else if (prediction.prediction.entryDecision === 'IGNORE') {
                ignoreTotal++;
                if (prediction.results.achievedTarget) {
                    ignoreCorrect++;
                }
            }
        }

        const total = buyTotal + ignoreTotal;
        const totalCorrect = buyCorrect + ignoreCorrect;

        return {
            buy: {
                percentage: buyTotal > 0 ? (buyCorrect / buyTotal) * 100 : 0,
                correct: buyCorrect,
                total: buyTotal
            },
            ignore: {
                percentage: ignoreTotal > 0 ? (ignoreCorrect / ignoreTotal) * 100 : 0,
                correct: ignoreCorrect,
                total: ignoreTotal
            },
            overall: {
                percentage: total > 0 ? (totalCorrect / total) * 100 : 0,
                correct: totalCorrect,
                total: total
            }
        };
    }
}