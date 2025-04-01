import { Plugin, IAgentRuntime, Action } from "@ai16z/eliza";
import { elizaLogger } from "@ai16z/eliza";
import { TokenMigrationProvider, MarketDataProvider } from "./providers";
import { TwitterSentimentProvider } from "./providers/TwitterSentimentProvider";
import { PredictionService, LearningService } from "./services";
import * as types from "./types";
import { Memory, State, HandlerCallback } from "@ai16z/eliza";
import { TokenData, OHLCVData } from "./types/token";
import { logger } from "./utils/logger";
import { PublicKey } from "@solana/web3.js";

// Global provider instances to be used across the plugin
let marketDataProviderInstance: MarketDataProvider | undefined;
let learningServiceInstance: LearningService | undefined;
let predictionServiceInstance: PredictionService | undefined;
let tokenMigrationProviderInstance: TokenMigrationProvider | undefined;
let twitterSentimentProviderInstance: TwitterSentimentProvider | undefined;

// Flag to track if the plugin has been initialized
let isPluginInitialized = false;
// Flag to track if the prediction stream has been started
let isPredictionStreamActive = false;
// Request throttling mechanism
let tokenProcessingQueue: Array<{
  token: types.TokenData;
  addedAt: number;
}> = [];
let activeProcessingCount = 0;
const MAX_CONCURRENT_TOKENS = 5; // Allow processing up to 5 tokens simultaneously
const TOKEN_PROCESSING_INTERVAL = 30000; // 30 seconds between token processing batches
const TOKEN_PROCESSING_DELAY = 60000; // 60 seconds delay before processing new tokens

// Helper function to create and initialize all services only once
function getOrCreateServices(runtime: IAgentRuntime) {
  // Only initialize services if they don't already exist and plugin hasn't been initialized
  if (!isPluginInitialized && !marketDataProviderInstance) {
    // Log plugin startup
    logger.plugin.start();

    // Create providers in the correct dependency order
    marketDataProviderInstance = new MarketDataProvider(runtime);
    learningServiceInstance = new LearningService(runtime);
    tokenMigrationProviderInstance = new TokenMigrationProvider(runtime);
    twitterSentimentProviderInstance = new TwitterSentimentProvider(runtime);

    // Create the prediction service last, injecting all dependencies
    predictionServiceInstance = new PredictionService(
      runtime,
      learningServiceInstance,
      marketDataProviderInstance,
      tokenMigrationProviderInstance
    );

    // Initialize Twitter client
    try {
      if (twitterSentimentProviderInstance) {
        twitterSentimentProviderInstance.initialize().catch(error => {
          const err = error instanceof Error ? error : new Error('Unknown error');
          logger.plugin.error(err);
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      logger.plugin.error(err);
    }

    // Set flag to avoid duplicate initialization
    isPluginInitialized = true;
  }

  // Ensure all instances exist before returning
  if (!marketDataProviderInstance || !learningServiceInstance || !predictionServiceInstance ||
      !tokenMigrationProviderInstance || !twitterSentimentProviderInstance) {
    throw new Error("Failed to initialize one or more required services");
  }

  return {
    marketDataProvider: marketDataProviderInstance,
    learningService: learningServiceInstance,
    predictionService: predictionServiceInstance,
    tokenMigrationProvider: tokenMigrationProviderInstance,
    twitterSentimentProvider: twitterSentimentProviderInstance
  };
}

// Helper function to clean up all services
function cleanupServices() {
  if (tokenMigrationProviderInstance) {
    logger.plugin.stopped();
    tokenMigrationProviderInstance.disconnect();
    tokenMigrationProviderInstance = undefined;
  }

  // Clear all other instances
  marketDataProviderInstance = undefined;
  learningServiceInstance = undefined;
  predictionServiceInstance = undefined;
  twitterSentimentProviderInstance = undefined;

  // Reset initialization flags
  isPluginInitialized = false;
  isPredictionStreamActive = false;

  // Clear the token processing queue
  tokenProcessingQueue = [];
}

// Process token from queue with rate limiting
async function processNextToken(services: {
  tokenMigrationProvider: TokenMigrationProvider;
  marketDataProvider: MarketDataProvider;
  predictionService: PredictionService;
  learningService: LearningService;
  twitterSentimentProvider: TwitterSentimentProvider;
}) {
  if (activeProcessingCount >= MAX_CONCURRENT_TOKENS || tokenProcessingQueue.length === 0) {
    return;
  }

  // Check if the first token in queue has waited long enough
  const now = Date.now();
  const nextToken = tokenProcessingQueue[0];
  if (now - nextToken.addedAt < TOKEN_PROCESSING_DELAY) {
    // If not waited long enough, schedule next check
    setTimeout(() => processNextToken(services), 1000);
    return;
  }

  activeProcessingCount++;
  const { token: tokenData } = tokenProcessingQueue.shift()!;

  try {
    // Fetch market data
    const [marketData, ohlcvData, tweets] = await Promise.all([
      // Parallel fetching of required data
      services.marketDataProvider.getTokenMarketData(tokenData.address),
      services.marketDataProvider.getTokenOHLCVData(
        tokenData.address,
        '1m',
        Math.floor(Date.now() / 1000) - (60 * 60),
        Math.floor(Date.now() / 1000)
      ),
      services.twitterSentimentProvider.getRecentTweetsForToken(tokenData)
    ]);

    // Update tokenData with market data
    const updatedTokenData = {
      ...tokenData,
      ...marketData,
      price: marketData.price,
      marketCap: marketData.marketCap,
      holderCount: marketData.holderCount,
      volume1hUSD: marketData.volume1hUSD,
      volume24hUSD: marketData.volume24hUSD,
      priceChange1h: marketData.priceChange1h,
      priceChange24h: marketData.priceChange24h,
      uniqueTraders1h: marketData.uniqueTraders1h,
      trades1h: marketData.trades1h
    };

    // Process the token with all fetched data
    await services.predictionService.predictToken(updatedTokenData, tweets, ohlcvData);

    // After successful processing, try to process next token if queue not empty
    if (tokenProcessingQueue.length > 0) {
      processNextToken(services);
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Unknown error processing token');
    logger.plugin.error(err);
  } finally {
    activeProcessingCount--;

    // Try to process more tokens if queue not empty and below max concurrent
    if (tokenProcessingQueue.length > 0 && activeProcessingCount < MAX_CONCURRENT_TOKENS) {
      processNextToken(services);
    }
  }
}

// Helper function to start processing tokens
function startProcessingTokens(services: {
  tokenMigrationProvider: TokenMigrationProvider;
  marketDataProvider: MarketDataProvider;
  predictionService: PredictionService;
  learningService: LearningService;
  twitterSentimentProvider: TwitterSentimentProvider;
}) {
  // Start multiple concurrent processors up to MAX_CONCURRENT_TOKENS
  for (let i = 0; i < Math.min(MAX_CONCURRENT_TOKENS, tokenProcessingQueue.length); i++) {
    processNextToken(services);
  }
}

export const startPredictionStream: Action = {
  name: "startPredictionStream",
  description: "Starts the token prediction stream automatically on agent startup",
  similes: [],
  examples: [],
  validate: async () => true,
  handler: async (runtime: IAgentRuntime) => {
    // If the prediction stream is already active, just log and return without reinitializing
    if (isPredictionStreamActive) {
      elizaLogger.info("Token prediction stream already running, not reinitializing");
      return {
        cleanup: async () => {
          cleanupServices();
        },
      };
    }

    // Log SOLANA_RPC_URL status from runtime settings
    const rpcUrl = runtime.getSetting('SOLANA_RPC_URL');
    elizaLogger.info(`Starting token prediction stream with SOLANA_RPC_URL: ${rpcUrl || 'Not defined, will use default'}`);

    // Get or create services (will only be created once due to the isPluginInitialized flag)
    const services = getOrCreateServices(runtime);

    // Log connection settings for debugging
    services.tokenMigrationProvider.logConnectionSettings();

    // Set up listener for token updates - with null check
    services.tokenMigrationProvider.on("tokenUpdate", async (tokenData: types.TokenData) => {
      // Add token to the processing queue with timestamp
      const queueItem = {
        token: tokenData,
        addedAt: Date.now()
      };
      tokenProcessingQueue.push(queueItem);
      elizaLogger.info(`Added token to processing queue: ${tokenData.tokenId} (${tokenData.address}) [Queue length: ${tokenProcessingQueue.length}] - Will process after ${TOKEN_PROCESSING_DELAY/1000} seconds`);

      // Start processing if we're below max concurrent tokens
      if (activeProcessingCount < MAX_CONCURRENT_TOKENS) {
        startProcessingTokens(services);
      }
    });

    // Connect to the token migration stream
    services.tokenMigrationProvider.connect();
    logger.plugin.initialized();

    // Mark the prediction stream as active
    isPredictionStreamActive = true;

    return {
      cleanup: async () => {
        cleanupServices();
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
    cleanupServices();
  },
};

function isValidSolanaAddress(address: string): boolean {
    try {
        // Attempt to create a PublicKey object
        new PublicKey(address);
        return true;
    } catch {
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
        const requestTimer = logger.performance.start('predict_token_request');

        // Get or create services (will only be created once)
        const services = getOrCreateServices(runtime);

        let tokenAddress = options.tokenAddress;
        let tokenSymbol = options.tokenSymbol;

        if (!tokenAddress && !tokenSymbol) {
            const messageText = message.content.text;
            const addressMatch = messageText.match(/(?:predict\s+(?:token|coin)?\s+)?([1-9A-HJ-NP-Za-km-z]{32,44})/i);
            const symbolMatch = messageText.match(/predict\s+(?:token|coin)?\s*([A-Za-z0-9]{2,10})/i);

            if (addressMatch) {
                tokenAddress = addressMatch[1];
                logger.api.request('extractAddress', { extracted: tokenAddress, rawMatch: addressMatch[0] });
            }
            if (symbolMatch && !tokenAddress) {
                tokenSymbol = symbolMatch[1];
                logger.api.request('extractSymbol', { extracted: tokenSymbol });
            }
        }

        if (!tokenAddress && !tokenSymbol) {
            const errorMsg = "Please provide a valid Solana token address or symbol to predict.";
            logger.plugin.error(new Error("No address or symbol provided for prediction"));
            callback({ text: errorMsg }, []);
            return;
        }

        if (tokenAddress && !isValidSolanaAddress(tokenAddress)) {
            const errorMsg = `Invalid Solana token address: "${tokenAddress}". Please provide a valid Base58-encoded Solana public key (32-44 characters).`;
            logger.plugin.error(new Error(`Invalid Solana address: ${tokenAddress}`));
            callback({ text: errorMsg }, []);
            return;
        }

        try {
            let tokenData: TokenData;
            if (tokenAddress) {
                logger.market.fetching('direct_request', tokenAddress, 'market_data');
                const marketData = await services.marketDataProvider.getTokenMarketData(tokenAddress);
                logger.market.received('direct_request', tokenAddress, 'market_data', {
                    marketCap: marketData.marketCap,
                    price: marketData.price
                });

                tokenData = {
                    tokenId: tokenAddress,
                    address: tokenAddress,
                    symbol: tokenSymbol || "UNKNOWN",
                    name: "Unknown Token",
                    marketCap: marketData.marketCap || 0,
                };
            } else {
                const errorMsg = "Token symbol provided without address. Please provide a Solana token address for accurate prediction.";
                logger.plugin.error(new Error("Symbol without address provided"));
                callback({ text: errorMsg }, []);
                return;
            }

            const marketData = await services.marketDataProvider.getTokenMarketData(tokenData.address);
            const enrichedTokenData: TokenData = {
                ...tokenData,
                marketCap: marketData.marketCap || 0,
            };

            let tweets = "No recent tweets available.";
            try {
                tweets = await services.twitterSentimentProvider.getRecentTweetsForToken(enrichedTokenData);
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown error');
                logger.plugin.error(err);
            }

            // Track prediction performance
            const predictionTimer = logger.performance.start('prediction_execution', tokenData.tokenId);
            const prediction = await services.predictionService.predictToken(enrichedTokenData, tweets, []);
            predictionTimer.end({
                decision: prediction.entryDecision,
                confidence: prediction.confidence
            });

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

            // Explicitly call callback
            const response = { text: responseText, attachments: [] };
            callback(response, []);

            // Log total request duration
            requestTimer.end({
                tokenAddress: tokenData.address,
                decision: prediction.entryDecision,
                responseLength: responseText.length
            });

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            logger.plugin.error(err);
            const errorMsg = `Failed to predict token: ${err.message}`;
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
  name: "Pump.fun Token Prediction Plugin",
  description: "Analyzes and predicts token performance from Pump.fun to Solana",
  actions: [startPredictionStream, stopPredictionStream, predictToken],
};

// And also export the same object as 'plugin' for compatibility
export { tokenPredictionPlugin as plugin };

process.on("SIGTERM", () => {
  cleanupServices();
});

export { PredictionService } from './services/PredictionService';
export { TokenData, TokenPrediction } from './types';
export { TwitterSentimentProvider } from './providers/TwitterSentimentProvider';
export { MarketDataProvider } from './providers/MarketDataProvider';