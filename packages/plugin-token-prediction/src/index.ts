import { Plugin, IAgentRuntime, Action } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { TokenMigrationProvider, MarketDataProvider } from "./providers";
import { TwitterSentimentProvider } from "./providers/TwitterSentimentProvider";
import { PredictionService, LearningService } from "./services";
import * as types from "./types";

let tokenMigrationProviderInstance: TokenMigrationProvider | undefined;
let twitterSentimentProviderInstance: TwitterSentimentProvider | undefined;

export const startPredictionStream: Action = {
  name: "startPredictionStream",
  description: "Starts the token prediction stream automatically on agent startup",
  similes: [],
  examples: [],
  validate: async () => true,
  handler: async (runtime: IAgentRuntime) => {
    elizaLogger.info("[Token Prediction Plugin] Initializing on agent start...");

    const marketDataProvider = new MarketDataProvider(runtime);
    const predictionService = new PredictionService(runtime);
    const learningService = new LearningService(runtime);
    tokenMigrationProviderInstance = new TokenMigrationProvider(runtime);
    twitterSentimentProviderInstance = new TwitterSentimentProvider(runtime);

    try {
      await twitterSentimentProviderInstance.initialize();
    } catch (error) {
      elizaLogger.warn("Failed to initialize TwitterSentimentProvider, proceeding without tweets:", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    tokenMigrationProviderInstance.on("tokenUpdate", async (tokenData: types.TokenData) => {
      try {
        elizaLogger.info("Processing token update:", {
          tokenId: tokenData.tokenId,
          address: tokenData.address,
        });

        let marketData;
        try {
          marketData = await marketDataProvider.getTokenMarketData(tokenData.address);
          elizaLogger.info("Fetched market data:", {
            tokenAddress: tokenData.address,
            marketCap: marketData.marketCap,
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
          marketCap: marketData.marketCap || 0,
          volume1hUSD: marketData.volume1hUSD || 0,
          uniqueTraders1h: marketData.uniqueTraders1h || 0,
          holders: marketData.holderCount || 0,
        };

        let tweets: string = "No recent tweets available.";
        if (twitterSentimentProviderInstance) {
          tweets = await twitterSentimentProviderInstance.getRecentTweetsForToken(tokenData);
        } else {
          elizaLogger.warn("TwitterSentimentProvider not available");
        }

        await predictionService.predictToken(enrichedTokenData, tweets);
      } catch (error) {
        elizaLogger.error("Failed to process token update:", {
          tokenId: tokenData.tokenId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    tokenMigrationProviderInstance.connect();
    elizaLogger.success("[Token Prediction Plugin] Initialized and stream started successfully");

    return {
      cleanup: async () => {
        if (tokenMigrationProviderInstance) {
          elizaLogger.info("[Token Prediction Plugin] Stopping migration stream...");
          tokenMigrationProviderInstance.disconnect();
          tokenMigrationProviderInstance = undefined;
        }
        if (twitterSentimentProviderInstance) {
          elizaLogger.info("[Token Prediction Plugin] Stopping Twitter sentiment provider...");
          twitterSentimentProviderInstance = undefined;
        }
        elizaLogger.success("[Token Prediction Plugin] Prediction stream stopped successfully");
      },
    };
  },
};

export const stopPredictionStream: Action = {
  name: "stopPredictionStream",
  description: "Stops the token prediction stream",
  similes: [],
  examples: [],
  validate: async () => true,
  handler: async () => {
    if (tokenMigrationProviderInstance) {
      elizaLogger.info("[Token Prediction Plugin] Stopping migration stream...");
      tokenMigrationProviderInstance.disconnect();
      tokenMigrationProviderInstance = undefined;
    }
    if (twitterSentimentProviderInstance) {
      elizaLogger.info("[Token Prediction Plugin] Stopping Twitter sentiment provider...");
      twitterSentimentProviderInstance = undefined;
    }
    elizaLogger.success("[Token Prediction Plugin] Prediction stream stopped successfully");
  },
};

export const tokenPredictionPlugin: Plugin = {
  name: "token-prediction",
  description: "Token Prediction Plugin - Analyzes and predicts token performance",
  actions: [startPredictionStream, stopPredictionStream],
};

process.on("SIGTERM", () => {
  if (tokenMigrationProviderInstance) {
    elizaLogger.info("[Token Prediction Plugin] Cleaning up migration stream on process exit...");
    tokenMigrationProviderInstance.disconnect();
    tokenMigrationProviderInstance = undefined;
  }
  if (twitterSentimentProviderInstance) {
    elizaLogger.info("[Token Prediction Plugin] Cleaning up Twitter sentiment provider on process exit...");
    twitterSentimentProviderInstance = undefined;
  }
  elizaLogger.success("[Token Prediction Plugin] Cleanup complete");
});

export { PredictionService } from './services/PredictionService';
export { TokenData, TokenPrediction } from './types';
export { TwitterSentimentProvider } from './providers/TwitterSentimentProvider';
export { MarketDataProvider } from './providers/MarketDataProvider';