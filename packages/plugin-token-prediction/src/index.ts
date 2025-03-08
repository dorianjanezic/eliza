import { Plugin, IAgentRuntime, Action } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { TokenStreamProvider, MarketDataProvider } from "./providers";
import { PredictionService, LearningService } from "./services";
import * as types from "./types";

// Global reference for cleanup
let tokenStreamProviderInstance: TokenStreamProvider | undefined;

const startPredictionStream: Action = {
  name: "startPredictionStream",
  description: "Starts the token prediction stream automatically on agent startup",
  similes: [],
  examples: [],
  validate: async () => true,
  handler: async (runtime: IAgentRuntime) => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables");
    }

    elizaLogger.info("[Token Prediction Plugin] Initializing on agent start...");

    const marketDataProvider = new MarketDataProvider(runtime);
    const predictionService = new PredictionService(runtime);
    const learningService = new LearningService(runtime);
    tokenStreamProviderInstance = new TokenStreamProvider(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
      runtime
    );

    tokenStreamProviderInstance.on("tokenUpdate", async (update: types.TokenData) => {
        try {
          elizaLogger.info("Processing token update:", {
            tokenId: update.tokenId,
            address: update.address,
            symbol: update.symbol,
            name: update.name
          });
          let marketData;
          try {
            marketData = await marketDataProvider.getTokenMarketData(update.address);
            elizaLogger.info("Fetched market data:", {
              tokenId: update.tokenId,
              marketCap: marketData.marketCap
            });
          } catch (apiError) {
            elizaLogger.warn("Failed to fetch market data, using fallback:", {
              tokenId: update.tokenId,
              error: apiError instanceof Error ? apiError.message : "Unknown error",
            });
            marketData = { marketCap: 0 };
          }
          const enrichedTokenData = {
            ...update,
            marketCap: marketData.marketCap,
            volume1h: marketData.volume1h,
            uniqueTraders1h: marketData.uniqueTraders1h,
            holders: marketData.holderCount,
          };
          await predictionService.predictToken(enrichedTokenData);
        } catch (error) {
          elizaLogger.error("Failed to process token update:", {
            tokenId: update.tokenId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      });

    tokenStreamProviderInstance.connect();
    elizaLogger.success("[Token Prediction Plugin] Initialized and stream started successfully");

    // Return cleanup function
    return {
      cleanup: async () => {
        if (tokenStreamProviderInstance) {
          elizaLogger.info("[Token Prediction Plugin] Stopping prediction stream...");
          tokenStreamProviderInstance.disconnect();
          tokenStreamProviderInstance = undefined;
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
    if (tokenStreamProviderInstance) {
      elizaLogger.info("[Token Prediction Plugin] Stopping prediction stream...");
      tokenStreamProviderInstance.disconnect();
      tokenStreamProviderInstance = undefined;
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
  if (tokenStreamProviderInstance) {
    elizaLogger.info("[Token Prediction Plugin] Cleaning up on process exit...");
    tokenStreamProviderInstance.disconnect();
    elizaLogger.success("[Token Prediction Plugin] Cleanup complete");
  }
});