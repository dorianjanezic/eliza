import { elizaLogger, type IAgentRuntime, stringToUuid, type UUID } from "@ai16z/eliza";
import type { PredictionResult, TokenPrediction } from "../types";

export class LearningService {
    private readonly globalSummaryRoomId: UUID = stringToUuid("token-prediction-summaries");
    private static initialized = false;

    constructor(private runtime: IAgentRuntime) {
        if (!LearningService.initialized) {
            this.initializeGlobalRoom();
            LearningService.initialized = true;
        }
    }

    private async initializeGlobalRoom() {
        try {
            try {
                await this.runtime.ensureRoomExists(this.globalSummaryRoomId);
                elizaLogger.info("Created global summary room:", { roomId: this.globalSummaryRoomId });
            } catch (error: any) {
                if (error?.message?.includes("UNIQUE constraint failed")) {
                    elizaLogger.info("Global summary room already exists:", { roomId: this.globalSummaryRoomId });
                } else {
                    throw error;
                }
            }
            await this.runtime.ensureParticipantInRoom(this.runtime.agentId, this.globalSummaryRoomId);
            elizaLogger.success("Initialized global summary room:", { roomId: this.globalSummaryRoomId });
        } catch (error) {
            elizaLogger.error("Failed to initialize global summary room:", error);
            throw error;
        }
    }

    async recordPredictionSummary(tokenId: string, summary: PredictionResult): Promise<void> {
        try {
          const memory = {
            id: stringToUuid(`global-summary-${tokenId}`),
            userId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: this.globalSummaryRoomId,
            content: {
              text: `Prediction Summary for ${tokenId}\nDecision: ${summary.prediction.entryDecision}\nAchieved: ${summary.results.achievedTarget}`,
              metadata: summary
            },
            createdAt: Date.now()
          };

          await this.runtime.messageManager.createMemory(await this.runtime.messageManager.addEmbeddingToMemory(memory), true);
          elizaLogger.success("Recorded global prediction summary:", {
            tokenId,
            achievedTarget: summary.results.achievedTarget
          });
        } catch (error) {
          elizaLogger.error("Failed to record global summary:", { tokenId, error });
          throw error;
        }
      }


      async getRecentPredictions(limit: number = 5): Promise<string> {
        try {
            const memories = await this.runtime.messageManager.getMemoriesByRoomIds({
                roomIds: [this.globalSummaryRoomId],
            });

            if (memories.length === 0) return "No recent predictions available.";

            return memories.map(m => {
                const { prediction, results } = m.content.metadata as PredictionResult;
                return `Token Prediction (${new Date(m.createdAt ?? Date.now()).toISOString()}):
                    - Decision: ${prediction.entryDecision}
                    - Target (10min): ${prediction.marketCapPredictions["10min"]}
                    - Actual Final: ${results?.finalMarketCap ?? 'N/A'}
                    - Achieved Target: ${results?.achievedTarget ? "Yes" : "No"}
                    - MAPE: ${results?.mape ? (results.mape * 100).toFixed(2) : 'N/A'}%`;
            }).join("\n\n");
        } catch (error) {
            elizaLogger.error("Failed to get recent predictions:", error);
            return "Error retrieving recent predictions.";
        }
    }

    async getHistoricalAccuracy(): Promise<{ percentage: number; count: number; avgMape: number }> {
        try {
          const memories = await this.runtime.messageManager.getMemoriesByRoomIds({
            roomIds: [this.globalSummaryRoomId]
          });
          elizaLogger.info('Fetched memories for global summary:', { count: memories.length, roomId: this.globalSummaryRoomId });

          if (memories.length === 0) return { percentage: 0, count: 0, avgMape: 0 };

          const results = memories.map(m => m.content.metadata as PredictionResult);
          const correctPredictions = results.filter(r => r.results.achievedTarget).length;
          const percentage = results.length > 0 ? (correctPredictions / results.length) * 100 : 0;
          const avgMape = results.length > 0 ? results.reduce((sum, r) => sum + (r.results.mape || 0), 0) / results.length : 0;

          elizaLogger.info("Historical accuracy calculated:", {
            total: results.length,
            correct: correctPredictions,
            percentage: percentage.toFixed(2),
            avgMape: avgMape.toFixed(4)
          });

          return { percentage, count: results.length, avgMape };
        } catch (error) {
          elizaLogger.error("Failed to calculate historical accuracy:", error);
          return { percentage: 0, count: 0, avgMape: 0 };
        }
      }
}