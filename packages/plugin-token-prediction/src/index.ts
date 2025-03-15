import { Plugin, IAgentRuntime, Action } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { TokenMigrationProvider, MarketDataProvider } from "./providers";
import { TwitterSentimentProvider } from "./providers/TwitterSentimentProvider";
import { PredictionService, LearningService } from "./services";
import * as types from "./types";
import { Memory, State, HandlerCallback } from "@ai16z/eliza";
import { TokenData, OHLCVData } from "./types/token";
import { PublicKey } from "@solana/web3.js";
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

        let ohlcvData: OHLCVData[] = [];
        try {
          const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
          const timeFrom = currentTime - 3600; // Last hour
          ohlcvData = await marketDataProvider.getTokenOHLCVData(
            tokenData.address,
            '5m', // 5-minute candles
            timeFrom,
            currentTime
          );
          elizaLogger.info("Fetched OHLCV data:", {
            tokenAddress: tokenData.address,
            candleCount: ohlcvData.length,
          });
        } catch (apiError) {
          elizaLogger.warn("Failed to fetch OHLCV data, using empty array:", {
            tokenId: tokenData.tokenId,
            error: apiError instanceof Error ? apiError.message : "Unknown error",
          });
          ohlcvData = []; // Fallback to empty array
        }

        const enrichedTokenData = {
          ...tokenData,
          marketCap: marketData.marketCap || 0,
          volume1hUSD: marketData.volume1hUSD || 0,
          uniqueTraders1h: marketData.uniqueTraders1h || 0,
          holders: marketData.holderCount || 0,
          price: marketData.price || 0,
        };

        let tweets: string = "No recent tweets available.";
        if (twitterSentimentProviderInstance) {
          tweets = await twitterSentimentProviderInstance.getRecentTweetsForToken(tokenData);
        } else {
          elizaLogger.warn("TwitterSentimentProvider not available");
        }

        await predictionService.predictToken(enrichedTokenData, tweets, ohlcvData);
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

function isValidSolanaAddress(address: string): boolean {
    try {
        new PublicKey(address);
        return true;
    } catch (error) {
        return false;
    }
}

export const predictToken: Action = {
    name: "PREDICT_TOKEN",
    similes: [
        "ANALYZE_TOKEN",
        "TOKEN_PREDICTION",
        "PREDICT_COIN",
        "EVALUATE_TOKEN",
        "FORECAST_TOKEN",
    ],
    description: "Predict the performance of a Solana token based on its address or symbol.",
    validate: async (runtime: IAgentRuntime) => {
        const birdeyeApiKey = !!runtime.getSetting("BIRDEYE_API_KEY");
        const solanaRpcUrl = !!runtime.getSetting("SOLANA_RPC_URL");
        return birdeyeApiKey && solanaRpcUrl;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: {
            tokenAddress?: string;
            tokenSymbol?: string;
        },
        callback: HandlerCallback
    ) => {
        elizaLogger.info("Starting token prediction from chat:", { message: message.content.text });

        const marketDataProvider = new MarketDataProvider(runtime);
        const twitterSentimentProvider = new TwitterSentimentProvider(runtime);
        const predictionService = new PredictionService(runtime);

        try {
            await twitterSentimentProvider.initialize();
        } catch (error) {
            elizaLogger.warn("TwitterSentimentProvider initialization failed, proceeding without tweets:", {
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }

        let tokenAddress = options.tokenAddress;
        let tokenSymbol = options.tokenSymbol;

        if (!tokenAddress && !tokenSymbol) {
            const messageText = message.content.text;
            const addressMatch = messageText.match(/(?:predict\s+(?:token|coin)?\s+)?([1-9A-HJ-NP-Za-km-z]{32,44})/i);
            const symbolMatch = messageText.match(/predict\s+(?:token|coin)?\s*([A-Za-z0-9]{2,10})/i);

            if (addressMatch) {
                tokenAddress = addressMatch[1];
                elizaLogger.debug("Extracted address from message:", { tokenAddress, rawMatch: addressMatch[0] });
            }
            if (symbolMatch && !tokenAddress) {
                tokenSymbol = symbolMatch[1];
                elizaLogger.debug("Extracted symbol from message:", { tokenSymbol });
            }
        }

        if (!tokenAddress && !tokenSymbol) {
            const errorMsg = "Please provide a valid Solana token address or symbol to predict.";
            elizaLogger.info("No valid address or symbol, sending error:", { errorMsg });
            callback({ text: errorMsg }, []);
            return;
        }

        if (tokenAddress && !isValidSolanaAddress(tokenAddress)) {
            const errorMsg = `Invalid Solana token address: "${tokenAddress}". Please provide a valid Base58-encoded Solana public key (32-44 characters).`;
            elizaLogger.warn("Invalid address, sending error:", { tokenAddress, errorMsg });
            callback({ text: errorMsg }, []);
            return;
        }

        try {
            let tokenData: TokenData;
            if (tokenAddress) {
                elizaLogger.info("Fetching market data for token:", { tokenAddress });
                const marketData = await marketDataProvider.getTokenMarketData(tokenAddress);
                tokenData = {
                    tokenId: tokenAddress,
                    address: tokenAddress,
                    symbol: tokenSymbol || "UNKNOWN",
                    name: "Unknown Token",
                    marketCap: marketData.marketCap || 0,
                };
            } else {
                const errorMsg = "Token symbol provided without address. Please provide a Solana token address for accurate prediction.";
                elizaLogger.info("Symbol without address, sending error:", { tokenSymbol, errorMsg });
                callback({ text: errorMsg }, []);
                return;
            }

            const marketData = await marketDataProvider.getTokenMarketData(tokenData.address);
            const enrichedTokenData: TokenData = {
                ...tokenData,
                marketCap: marketData.marketCap || 0,
            };

            let tweets = "No recent tweets available.";
            try {
                tweets = await twitterSentimentProvider.getRecentTweetsForToken(enrichedTokenData);
            } catch (error) {
                elizaLogger.warn("Failed to fetch tweets:", {
                    tokenAddress: enrichedTokenData.address,
                    error: error instanceof Error ? error.message : "Unknown error",
                });
            }

            const prediction = await predictionService.predictToken(enrichedTokenData, tweets, []);

            const responseText = [
                `Token Prediction for ${enrichedTokenData.address} (${enrichedTokenData.symbol})`,
                `Decision: ${prediction.entryDecision}`,
                `Confidence: ${(prediction.confidence * 100).toFixed(2)}%`,
                `Market Cap Predictions:`,
                ...Object.entries(prediction.marketCapPredictions).map(([time, value]) => `  - ${time}: $${value.toLocaleString()}`),
                `Reasoning: ${prediction.reasoning}`,
                `Supporting Factors: ${prediction.supportingFactors.join(", ") || "None"}`,
                `Risk Factors: ${prediction.riskFactors.join(", ") || "None"}`,
                `Note: Checks scheduled every 2 minutes for the next 10 minutes.`
            ].join("\n");

            elizaLogger.info("Prediction completed, preparing response:", {
                tokenAddress: enrichedTokenData.address,
                decision: prediction.entryDecision,
                responseText,
            });

            // Explicitly call callback
            const response = { text: responseText, attachments: [] };
            elizaLogger.debug("Invoking callback with response:", { response });
            callback(response, []);
            elizaLogger.info("Callback invoked successfully");

        } catch (error) {
            const errorMsg = `Failed to predict token: ${error instanceof Error ? error.message : "Unknown error"}`;
            elizaLogger.error("Prediction failed, sending error:", {
                tokenAddress,
                tokenSymbol,
                errorMsg,
            });
            callback({ text: errorMsg }, []);
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Predict token 2RBko3xoz56aH69isQMUpzZd9NYHahhwC23A5F3Spkin" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Here's the prediction for token 2RBko3xoz56aH69isQMUpzZd9NYHahhwC23A5F3Spkin",
                    action: "PREDICT_TOKEN",
                },
            },
        ],
    ],
} as Action;

export const tokenPredictionPlugin: Plugin = {
  name: "token-prediction",
  description: "Token Prediction Plugin - Analyzes and predicts token performance",
  actions: [startPredictionStream, stopPredictionStream, predictToken],
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