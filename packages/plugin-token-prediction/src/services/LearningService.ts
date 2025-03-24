import { elizaLogger, type IAgentRuntime, stringToUuid, type UUID } from "@ai16z/eliza";
import type { PredictionResult, TokenPrediction } from "../types";
import { Portfolio } from "../types/portfolio";
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
            this.initializePortfolio(); // Add this
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
                // Ensure memory.id is a valid UUID
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
                maxDrawdownPercentage: 0
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
        // Update portfolio statistics before saving
        this.updatePortfolioStats(portfolio);

        const memory = {
            id: stringToUuid(`portfolio-${Date.now()}`),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: this.globalPortfolioRoomId,
            content: {
                text: `Portfolio Update - Balance: $${portfolio.currentBalance.toFixed(2)}`,
                metadata: portfolio
            },
            createdAt: Date.now()
        };

        await this.runtime.messageManager.createMemory(await this.runtime.messageManager.addEmbeddingToMemory(memory), true);

        logger.portfolio.updated(
            portfolio.currentBalance,
            portfolio.initialBalance,
            portfolio.stats.totalTrades,
            portfolio.stats.winRate
        );
    }

    /**
     * Updates portfolio statistics based on trade history
     */
    private updatePortfolioStats(portfolio: Portfolio) {
        const closedTrades = portfolio.trades.filter(t => t.status === 'CLOSED');
        const profitableTrades = closedTrades.filter(t => t.profitLoss > 0);
        const unprofitableTrades = closedTrades.filter(t => t.profitLoss <= 0);

        // Calculate basic stats
        const totalPnL = closedTrades.reduce((sum, trade) => sum + trade.profitLoss, 0);
        const avgPnL = closedTrades.length > 0 ? totalPnL / closedTrades.length : 0;
        const avgWin = profitableTrades.length > 0
            ? profitableTrades.reduce((sum, t) => sum + t.profitLoss, 0) / profitableTrades.length
            : 0;
        const avgLoss = unprofitableTrades.length > 0
            ? unprofitableTrades.reduce((sum, t) => sum + t.profitLoss, 0) / unprofitableTrades.length
            : 0;

        // Calculate max drawdown
        let maxBalance = portfolio.initialBalance;
        let maxDrawdown = 0;

        // Sort trades by exit time (if closed) or entry time (if open)
        const sortedTrades = [...portfolio.trades].sort((a, b) => {
            const aTime = a.exitTime ? new Date(a.exitTime).getTime() : new Date(a.entryTime).getTime();
            const bTime = b.exitTime ? new Date(b.exitTime).getTime() : new Date(b.entryTime).getTime();
            return aTime - bTime;
        });

        // Calculate running balance and track max drawdown
        let runningBalance = portfolio.initialBalance;

        for (const trade of sortedTrades) {
            if (trade.status === 'CLOSED') {
                runningBalance = runningBalance + trade.profitLoss;

                if (runningBalance > maxBalance) {
                    maxBalance = runningBalance;
                }

                const drawdown = maxBalance - runningBalance;
                if (drawdown > maxDrawdown) {
                    maxDrawdown = drawdown;
                }
            }
        }

        // Update portfolio stats
        portfolio.stats = {
            totalTrades: closedTrades.length,
            profitableTrades: profitableTrades.length,
            unprofitableTrades: unprofitableTrades.length,
            winRate: closedTrades.length > 0 ? (profitableTrades.length / closedTrades.length) * 100 : 0,
            totalPnL,
            avgPnL,
            avgWin,
            avgLoss,
            maxDrawdown,
            maxDrawdownPercentage: maxBalance > 0 ? (maxDrawdown / maxBalance) * 100 : 0
        };
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
                    maxDrawdownPercentage: 0
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

        // Ensure portfolio has the new fields (for backward compatibility)
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
                maxDrawdownPercentage: 0
            };
            // Update stats based on existing trades
            this.updatePortfolioStats(portfolio);
        }

        return portfolio;
    }

    // Sets up a global room for storing prediction summaries
    private async initializeGlobalRoom() {
        try {
            try {
                // Ensure the room exists in Eliza's memory system
                await this.runtime.ensureRoomExists(this.globalSummaryRoomId);
                elizaLogger.info("Created global summary room:", { roomId: this.globalSummaryRoomId });
            } catch (error: any) {
                // Handle case where room already exists (UNIQUE constraint)
                if (error?.message?.includes("UNIQUE constraint failed")) {
                    elizaLogger.info("Global summary room already exists:", { roomId: this.globalSummaryRoomId });
                } else {
                    throw error; // Rethrow unexpected errors
                }
            }
            // Ensure the agent is a participant in the room
            await this.runtime.ensureParticipantInRoom(this.runtime.agentId, this.globalSummaryRoomId);
            elizaLogger.success("Initialized global summary room:", { roomId: this.globalSummaryRoomId });
        } catch (error) {
            elizaLogger.error("Failed to initialize global summary room:", error);
            throw error; // Propagate error to caller
        }
    }

    // Records a prediction summary in the global room
    async recordPredictionSummary(tokenId: string, summary: PredictionResult): Promise<void> {
        try {
            // Create memory object with summary details
            const memory = {
                id: stringToUuid(`global-summary-${tokenId}`), // Unique ID for this token's summary
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                roomId: this.globalSummaryRoomId,
                content: {
                    text: `Prediction Summary for ${tokenId}\nDecision: ${summary.prediction.entryDecision}\nAchieved: ${summary.results.achievedTarget}\nReflection: ${summary.reflection}, Lessons Learned: ${summary.lessonsLearned?.join(", ") ?? "None"}`,
                    metadata: summary // Full PredictionResult stored in metadata
                },
                createdAt: Date.now()
            };

            // Add embedding and store in memory
            await this.runtime.messageManager.createMemory(await this.runtime.messageManager.addEmbeddingToMemory(memory), true);
            elizaLogger.success("Recorded global prediction summary:", {
                tokenId,
                achievedTarget: summary.results.achievedTarget,
                reflection: summary.reflection
            });
        } catch (error) {
            elizaLogger.error("Failed to record global summary:", { tokenId, error });
            throw error; // Let caller handle the failure
        }
    }

    // Retrieves a formatted string of recent prediction summaries
    async getRecentPredictions(limit: number = 5): Promise<string> {
        try {
            // Fetch all memories from the global summary room
            const memories = await this.runtime.messageManager.getMemoriesByRoomIds({ roomIds: [this.globalSummaryRoomId] });
            if (memories.length === 0) return "No recent predictions available.";

            // Sort by creation time (newest first) and take the top `limit`
            const sortedMemories = memories.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
            return sortedMemories.slice(0, limit).map(m => {
                const { prediction, results, reflection, lessonsLearned } = m.content.metadata as PredictionResult;
                // Format per-step results for detailed output
                const perStepResults = results.mapePerStep?.map(step =>
                    `      ${step.time}: Target ${prediction.marketCapPredictions[step.time as keyof typeof prediction.marketCapPredictions]} ` +
                    `(${step.achieved ? "✓" : "✗"}, MAPE: ${(step.mape * 100).toFixed(2)}%)`
                ).join('\n') ?? '';

                // Construct human-readable summary string
                return `Token Prediction (${new Date(m.createdAt ?? Date.now()).toISOString()}):
                        - Decision: ${prediction.entryDecision}
                        - Reasoning: ${prediction.reasoning}
                        - Target (10min): ${prediction.marketCapPredictions["10min"]}
                        - Actual Final: ${results?.finalMarketCap ?? 'N/A'}
                        - Achieved Target: ${results?.achievedTarget ? "Yes" : "No"}
                        - MAPE: ${results?.mape ? (results.mape * 100).toFixed(2) : 'N/A'}%
                        - Per-step Results:\n${perStepResults}
                        - Reflection: ${reflection ?? "No reflection available"}
                        - Lessons Learned: ${lessonsLearned?.join(", ") ?? "None"}
                        - Risk Factors: ${prediction.riskFactors.join(', ')}
                        - Supporting Factors: ${prediction.supportingFactors.join(', ')}`;
            }).join("\n\n"); // Separate each prediction with double newline
        } catch (error) {
            elizaLogger.error("Failed to get recent predictions:", error);
            return "Error retrieving recent predictions."; // Fallback message
        }
    }

    // Calculates historical accuracy and average MAPE from stored summaries
    async getHistoricalAccuracy(): Promise<{ percentage: number; count: number; avgMape: number }> {
        try {
            // Fetch all memories from the global summary room
            const memories = await this.runtime.messageManager.getMemoriesByRoomIds({
                roomIds: [this.globalSummaryRoomId]
            });
            // elizaLogger.info('Fetched memories for global summary:', { count: memories.length, roomId: this.globalSummaryRoomId });

            if (memories.length === 0) return { percentage: 0, count: 0, avgMape: 0 }; // Default for empty history

            const results = memories.map(m => m.content.metadata as PredictionResult);
            // Count correct predictions (where target was achieved)
            const correctPredictions = results.filter(r => r.results.achievedTarget).length;
            const percentage = results.length > 0 ? (correctPredictions / results.length) * 100 : 0;
            // Average MAPE across all predictions
            const avgMape = results.length > 0 ? results.reduce((sum, r) => sum + (r.results.mape || 0), 0) / results.length : 0;

            // Calculate average MAPE per time step for deeper insight
            const mapeByStep: { [key: string]: number[] } = {};
            results.forEach(r => {
                r.results.mapePerStep?.forEach(step => {
                    if (!mapeByStep[step.time]) mapeByStep[step.time] = [];
                    mapeByStep[step.time].push(step.mape);
                });
            });

            const avgMapeByStep = Object.entries(mapeByStep).map(([time, mapes]) => ({
                time,
                avgMape: mapes.reduce((sum, mape) => sum + mape, 0) / mapes.length
            }));

            // Log detailed stats for monitoring
            elizaLogger.info("Historical accuracy calculated:", {
                total: results.length,
                correct: correctPredictions,
                percentage: percentage.toFixed(2),
                avgMape: avgMape.toFixed(4),
                avgMapeByStep: avgMapeByStep.map(s =>
                    `${s.time}: ${(s.avgMape * 100).toFixed(2)}%`
                )
            });

            return { percentage, count: results.length, avgMape };
        } catch (error) {
            elizaLogger.error("Failed to calculate historical accuracy:", error);
            return { percentage: 0, count: 0, avgMape: 0 }; // Fallback for errors
        }
    }
}