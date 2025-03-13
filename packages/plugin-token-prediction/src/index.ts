import { Plugin, IAgentRuntime, Action } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { TokenMigrationProvider, MarketDataProvider } from "./providers";
import { PredictionService, LearningService } from "./services";
import * as types from "./types";

// Global reference for cleanup
let tokenMigrationProviderInstance: TokenMigrationProvider | undefined;

const startPredictionStream: Action = {
  name: "startPredictionStream",
  description: "Starts the token prediction stream automatically on agent startup",
  similes: [],
  examples: [],
  validate: async () => true,
  handler: async (runtime: IAgentRuntime) => {
    // TokenMigrationProvider doesn’t require SUPABASE_URL or SUPABASE_ANON_KEY, so we remove this check
    elizaLogger.info("[Token Prediction Plugin] Initializing on agent start...");

    const marketDataProvider = new MarketDataProvider(runtime);
    const predictionService = new PredictionService(runtime);
    const learningService = new LearningService(runtime);
    tokenMigrationProviderInstance = new TokenMigrationProvider(runtime);

    tokenMigrationProviderInstance.on("tokenUpdate", async (tokenData: types.TokenData) => {
      try {
        elizaLogger.info("Processing token update:", {
          tokenId: tokenData.tokenId,
          address: tokenData.address,
        //   bundleData: tokenData.bundleData,
        //   creatorRiskProfile: tokenData.creatorRiskProfile,
        //   distribution: tokenData.distribution,
        });

        let marketData;
        try {
          marketData = await marketDataProvider.getTokenMarketData(tokenData.address);
          elizaLogger.info("Fetched market data:", {
            tokenId: tokenData.tokenId,
            marketCap: marketData.marketCap,
            volume1hUSD: marketData.volume1hUSD,
            uniqueTraders1h: marketData.uniqueTraders1h,
          });
        } catch (apiError) {
          elizaLogger.warn("Failed to fetch market data, using fallback:", {
            tokenId: tokenData.tokenId,
            error: apiError instanceof Error ? apiError.message : "Unknown error",
          });
          marketData = { marketCap: 0 };
        }

        const enrichedTokenData = {
          ...tokenData,
          marketCap: marketData.marketCap,
          volume1hUSD: marketData.volume1hUSD,
          uniqueTraders1h: marketData.uniqueTraders1h,
          holders: marketData.holderCount,
        };

        // elizaLogger.info("Enriched token data:", { enrichedTokenData });
        await predictionService.predictToken(enrichedTokenData);
      } catch (error) {
        elizaLogger.error("Failed to process token update:", {
          tokenId: tokenData.tokenId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    tokenMigrationProviderInstance.connect();
    elizaLogger.success("[Token Prediction Plugin] Initialized and stream started successfully");

    // Return cleanup function
    return {
      cleanup: async () => {
        if (tokenMigrationProviderInstance) {
          elizaLogger.info("[Token Prediction Plugin] Stopping prediction stream...");
          tokenMigrationProviderInstance.disconnect();
          tokenMigrationProviderInstance = undefined;
          elizaLogger.success("[Token Prediction Plugin] Prediction stream stopped successfully");
        }
      },
    };
  },
};

const stopPredictionStream: Action = {
  name: "stopPredictionStream",
  description: "Stops the token prediction stream",
  similes: [],
  examples: [],
  validate: async () => true,
  handler: async () => {
    if (tokenMigrationProviderInstance) {
      elizaLogger.info("[Token Prediction Plugin] Stopping prediction stream...");
      tokenMigrationProviderInstance.disconnect();
      tokenMigrationProviderInstance = undefined;
      elizaLogger.success("[Token Prediction Plugin] Prediction stream stopped successfully");
    } else {
      elizaLogger.warn("Prediction stream is not running");
    }
  },
};

export const tokenPredictionPlugin: Plugin = {
  name: "token-prediction",
  description: "Token Prediction Plugin - Analyzes and predicts token performance",
  actions: [startPredictionStream, stopPredictionStream],
};

// Cleanup on process exit
process.on("SIGTERM", () => {
  if (tokenMigrationProviderInstance) {
    elizaLogger.info("[Token Prediction Plugin] Cleaning up on process exit...");
    tokenMigrationProviderInstance.disconnect();
    elizaLogger.success("[Token Prediction Plugin] Cleanup complete");
  }
});