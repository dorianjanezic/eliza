import { elizaLogger } from "@ai16z/eliza";

// Constants for log categories
export const LOG_CATEGORY = {
    PLUGIN: "PLUGIN",
    PREDICTION: "PREDICTION",
    PORTFOLIO: "PORTFOLIO",
    TRADE: "TRADE",
    API: "API",
    MARKET_DATA: "MARKET_DATA",
    TWITTER: "TWITTER",
    TOKEN_MIGRATION: "TOKEN_MIGRATION",
    PERFORMANCE: "PERFORMANCE",
};

// Create unique process ID for grouping related logs
const PROCESS_ID = Date.now().toString(36).toUpperCase();
let tradeSequence = 0;
let predictionSequence = 0;

/**
 * Formats log metadata with consistent structure
 */
function formatMetadata(category: string, tokenId?: string, tradeId?: string, additionalData?: Record<string, any>) {
    const metadata: Record<string, any> = {
        pid: PROCESS_ID,
        category,
        timestamp: new Date().toISOString(),
    };

    if (tokenId) metadata.tokenId = tokenId;
    if (tradeId) metadata.tradeId = tradeId;

    return { ...metadata, ...(additionalData || {}) };
}

/**
 * Generates a unique trade ID
 */
export function generateTradeId(tokenId: string): string {
    tradeSequence++;
    return `T-${PROCESS_ID.substring(0, 4)}-${tokenId.substring(0, 6)}-${tradeSequence}`;
}

/**
 * Generates a unique prediction ID
 */
export function generatePredictionId(tokenId: string): string {
    predictionSequence++;
    return `P-${PROCESS_ID.substring(0, 4)}-${tokenId.substring(0, 6)}-${predictionSequence}`;
}

/**
 * Enhanced logger for the Token Prediction Plugin
 */
export const logger = {
    // Plugin lifecycle logging
    plugin: {
        start: () => elizaLogger.info(
            '🔮 Token Prediction Plugin started',
            { component: 'plugin', event: 'start'}
        ),
        initialized: () => elizaLogger.success(
            '🔮 Token Prediction Plugin initialized successfully',
            { component: 'plugin', event: 'initialized'}
        ),
        stopped: () => elizaLogger.info(
            '🔮 Token Prediction Plugin stopped',
            { component: 'plugin', event: 'stopped'}
        ),
        error: (error: Error) => elizaLogger.error(
            `🔮 Token Prediction Plugin error: ${error.message}`,
            { component: 'plugin', event: 'error', error: error.stack || error.message }
        )
    },

    // General logging methods - for compatibility with existing code
    info: (message: string, metadata?: Record<string, any>) => elizaLogger.info(
        message,
        metadata || {}
    ),
    warn: (message: string, metadata?: Record<string, any>) => elizaLogger.warn(
        message,
        metadata || {}
    ),
    error: (message: string, metadata?: Record<string, any>) => elizaLogger.error(
        message,
        metadata || {}
    ),
    debug: (message: string, metadata?: Record<string, any>) => elizaLogger.debug(
        message,
        metadata || {}
    ),
    success: (message: string, metadata?: Record<string, any>) => elizaLogger.success(
        message,
        metadata || {}
    ),

    // WebSocket operations logging
    webSocket: {
        connected: (endpoint: string) => elizaLogger.info(
            `[WEBSOCKET] Connected to ${endpoint}`,
            formatMetadata("WEBSOCKET", undefined, undefined, { action: 'CONNECTED', endpoint })
        ),
        disconnected: (endpoint: string, code?: number, reason?: string) => elizaLogger.info(
            `[WEBSOCKET] Disconnected from ${endpoint}${code ? ` (code: ${code})` : ''}`,
            formatMetadata("WEBSOCKET", undefined, undefined, { action: 'DISCONNECTED', endpoint, code, reason })
        ),
        reconnecting: (endpoint: string, attempt: number, maxAttempts: number) => elizaLogger.info(
            `[WEBSOCKET] Reconnecting to ${endpoint} (attempt ${attempt}/${maxAttempts})`,
            formatMetadata("WEBSOCKET", undefined, undefined, { action: 'RECONNECTING', endpoint, attempt, maxAttempts })
        ),
        error: (endpoint: string, error: Error) => elizaLogger.error(
            `[WEBSOCKET] Error with connection to ${endpoint}`,
            formatMetadata("WEBSOCKET", undefined, undefined, { action: 'ERROR', endpoint, error: error.message, stack: error.stack })
        ),
        ping: (endpoint: string) => elizaLogger.debug(
            `[WEBSOCKET] Sending ping to ${endpoint}`,
            formatMetadata("WEBSOCKET", undefined, undefined, { action: 'PING', endpoint })
        ),
        pong: (endpoint: string, latency?: number) => elizaLogger.debug(
            `[WEBSOCKET] Received pong from ${endpoint}${latency ? ` (latency: ${latency}ms)` : ''}`,
            formatMetadata("WEBSOCKET", undefined, undefined, { action: 'PONG', endpoint, latency })
        ),
        message: (endpoint: string, messageType: string) => elizaLogger.debug(
            `[WEBSOCKET] Received message from ${endpoint} (type: ${messageType})`,
            formatMetadata("WEBSOCKET", undefined, undefined, { action: 'MESSAGE', endpoint, messageType })
        ),
        sent: (endpoint: string, messageType: string) => elizaLogger.debug(
            `[WEBSOCKET] Sent message to ${endpoint} (type: ${messageType})`,
            formatMetadata("WEBSOCKET", undefined, undefined, { action: 'SENT', endpoint, messageType })
        ),
    },

    // Prediction process logging
    prediction: {
        start: (tokenId: string, predictionId: string, tokenAddress: string) => elizaLogger.info(
            `[${LOG_CATEGORY.PREDICTION}] Starting prediction for token`,
            formatMetadata(LOG_CATEGORY.PREDICTION, tokenId, undefined, { action: 'START', predictionId, tokenAddress })
        ),
        result: (tokenId: string, predictionId: string, decision: string, confidence: number) => elizaLogger.info(
            `[${LOG_CATEGORY.PREDICTION}] Prediction result: ${decision}`,
            formatMetadata(LOG_CATEGORY.PREDICTION, tokenId, undefined, { action: 'RESULT', predictionId, decision, confidence })
        ),
        check: (tokenId: string, predictionId: string, checkNumber: number, marketCap: number, price: number) => elizaLogger.info(
            `[${LOG_CATEGORY.PREDICTION}] Check #${checkNumber}: Market cap $${marketCap.toFixed(2)}, Price $${price?.toFixed(6)}`,
            formatMetadata(LOG_CATEGORY.PREDICTION, tokenId, undefined, { action: 'CHECK', predictionId, checkNumber, marketCap, price })
        ),
        summary: (tokenId: string, predictionId: string, achieved: boolean, mape: number) => elizaLogger.success(
            `[${LOG_CATEGORY.PREDICTION}] Prediction completed, Target achieved: ${achieved}, MAPE: ${(mape * 100).toFixed(2)}%`,
            formatMetadata(LOG_CATEGORY.PREDICTION, tokenId, undefined, { action: 'SUMMARY', predictionId, achieved, mape })
        ),
        error: (tokenId: string, predictionId: string, error: Error) => elizaLogger.error(
            `[${LOG_CATEGORY.PREDICTION}] Prediction error for token`,
            formatMetadata(LOG_CATEGORY.PREDICTION, tokenId, undefined, { action: 'ERROR', predictionId, error: error.message, stack: error.stack })
        ),
    },

    // Portfolio management logging
    portfolio: {
        initialized: (initialBalance: number) => elizaLogger.info(
            `[${LOG_CATEGORY.PORTFOLIO}] Portfolio initialized with $${initialBalance.toFixed(2)}`,
            formatMetadata(LOG_CATEGORY.PORTFOLIO, undefined, undefined, { action: 'INITIALIZED', initialBalance })
        ),
        updated: (currentBalance: number, initialBalance: number, totalTrades: number, winRate: number) => elizaLogger.info(
            `[${LOG_CATEGORY.PORTFOLIO}] Portfolio updated: $${currentBalance.toFixed(2)} (${(currentBalance/initialBalance*100).toFixed(1)}% of initial)`,
            formatMetadata(LOG_CATEGORY.PORTFOLIO, undefined, undefined, {
                action: 'UPDATED',
                currentBalance,
                initialBalance,
                percentOfInitial: (currentBalance/initialBalance*100).toFixed(1),
                totalTrades,
                winRate: winRate.toFixed(1) + '%'
            })
        ),
        reset: () => elizaLogger.info(
            `[${LOG_CATEGORY.PORTFOLIO}] Portfolio reset to initial state`,
            formatMetadata(LOG_CATEGORY.PORTFOLIO, undefined, undefined, { action: 'RESET' })
        ),
        error: (error: Error) => elizaLogger.error(
            `[${LOG_CATEGORY.PORTFOLIO}] Portfolio error`,
            formatMetadata(LOG_CATEGORY.PORTFOLIO, undefined, undefined, { action: 'ERROR', error: error.message })
        ),
    },

    // Trade execution logging
    trade: {
        evaluating: (tokenId: string, tokenAddress: string, price: number) => {
            const tradeId = generateTradeId(tokenId);
            elizaLogger.info(
                `[${LOG_CATEGORY.TRADE}] Evaluating potential trade for token at $${price?.toFixed(6)}`,
                formatMetadata(LOG_CATEGORY.TRADE, tokenId, tradeId, { action: 'EVALUATING', tokenAddress, price })
            );
            return tradeId;
        },
        rejected: (tokenId: string, tradeId: string, reason: string, details?: Record<string, any>) => elizaLogger.warn(
            `[${LOG_CATEGORY.TRADE}] Trade rejected: ${reason}`,
            formatMetadata(LOG_CATEGORY.TRADE, tokenId, tradeId, { action: 'REJECTED', reason, ...details })
        ),
        opened: (tokenId: string, tradeId: string, entryPrice: number, amount: number, tokenAmount: number, details?: Record<string, any>) => elizaLogger.info(
            `[${LOG_CATEGORY.TRADE}] Trade opened: $${amount.toFixed(2)} at $${entryPrice.toFixed(6)} (${tokenAmount.toFixed(2)} tokens)`,
            formatMetadata(LOG_CATEGORY.TRADE, tokenId, tradeId, {
                action: 'OPENED',
                entryPrice,
                amount,
                tokenAmount,
                ...details
            })
        ),
        updated: (tokenId: string, tradeId: string, currentPrice: number, unrealizedPnL: number, percentChange: number) => elizaLogger.debug(
            `[${LOG_CATEGORY.TRADE}] Trade update: Price $${currentPrice.toFixed(6)}, PnL $${unrealizedPnL.toFixed(2)} (${percentChange.toFixed(2)}%)`,
            formatMetadata(LOG_CATEGORY.TRADE, tokenId, tradeId, {
                action: 'UPDATED',
                currentPrice,
                unrealizedPnL,
                percentChange
            })
        ),
        closed: (tokenId: string, tradeId: string, exitPrice: number, exitReason: string, profitLoss: number, profitLossPercent: number) => elizaLogger.info(
            `[${LOG_CATEGORY.TRADE}] Trade closed: ${exitReason}, PnL $${profitLoss.toFixed(2)} (${profitLossPercent.toFixed(2)}%)`,
            formatMetadata(LOG_CATEGORY.TRADE, tokenId, tradeId, {
                action: 'CLOSED',
                exitPrice,
                exitReason,
                profitLoss,
                profitLossPercent
            })
        ),
        status: (tokenId: string, tradeId: string, currentPrice: number, unrealizedPnL: number, percentChange: number, predictionId?: string) => elizaLogger.debug(
            `[${LOG_CATEGORY.TRADE}] Trade status: Price $${currentPrice?.toFixed(6)}, PnL $${unrealizedPnL?.toFixed(2)}${percentChange ? ` (${percentChange}%)` : ''}`,
            formatMetadata(LOG_CATEGORY.TRADE, tokenId, tradeId, {
                action: 'STATUS',
                currentPrice,
                unrealizedPnL,
                percentChange,
                predictionId
            })
        ),
        adjusted: (tokenId: string, tradeId: string, originalExitTime: string, adjustedExitTime: string, originalExitPrice: number, adjustedExitPrice: number, originalProfitLoss: number, adjustedProfitLoss: number, predictionId?: string) => elizaLogger.info(
            `[${LOG_CATEGORY.TRADE}] Trade exit adjusted based on OHLCV analysis: PnL change from $${originalProfitLoss.toFixed(2)} to $${adjustedProfitLoss.toFixed(2)}`,
            formatMetadata(LOG_CATEGORY.TRADE, tokenId, tradeId, {
                action: 'ADJUSTED',
                originalExitTime,
                adjustedExitTime,
                originalExitPrice,
                adjustedExitPrice,
                originalProfitLoss,
                adjustedProfitLoss,
                predictionId
            })
        ),
        comparison: (tokenId: string, tradeId: string, entryPrice: number, exitPrice: number, initialPositionValue: number, finalPositionValue: number, profitLoss: number, positionChangePercent: number, predictionId?: string) => elizaLogger.info(
            `[${LOG_CATEGORY.TRADE}] Trade evaluation: Initial $${initialPositionValue.toFixed(2)} to Final $${finalPositionValue.toFixed(2)} (${positionChangePercent.toFixed(2)}%)`,
            formatMetadata(LOG_CATEGORY.TRADE, tokenId, tradeId, {
                action: 'COMPARISON',
                entryPrice,
                exitPrice,
                initialPositionValue,
                finalPositionValue,
                profitLoss,
                positionChangePercent,
                predictionId
            })
        ),
        error: (tokenId: string, tradeId: string, error: Error) => elizaLogger.error(
            `[${LOG_CATEGORY.TRADE}] Trade error`,
            formatMetadata(LOG_CATEGORY.TRADE, tokenId, tradeId, { action: 'ERROR', error: error.message, stack: error.stack })
        ),
    },

    // API related logging
    api: {
        request: (endpoint: string, params?: Record<string, any>) => elizaLogger.debug(
            `[${LOG_CATEGORY.API}] API request to ${endpoint}`,
            formatMetadata(LOG_CATEGORY.API, undefined, undefined, { action: 'REQUEST', endpoint, params })
        ),
        rateLimit: (endpoint: string, retryAfter?: number) => elizaLogger.warn(
            `[${LOG_CATEGORY.API}] Rate limited on ${endpoint}${retryAfter ? `, retry after ${retryAfter}s` : ''}`,
            formatMetadata(LOG_CATEGORY.API, undefined, undefined, { action: 'RATE_LIMIT', endpoint, retryAfter })
        ),
        response: (endpoint: string, status: number, timing: number) => elizaLogger.debug(
            `[${LOG_CATEGORY.API}] API response from ${endpoint}: ${status} (${timing}ms)`,
            formatMetadata(LOG_CATEGORY.API, undefined, undefined, { action: 'RESPONSE', endpoint, status, timing })
        ),
        error: (endpoint: string, error: Error, attempt?: number, maxAttempts?: number) => elizaLogger.error(
            `[${LOG_CATEGORY.API}] API error for ${endpoint}${attempt ? ` (attempt ${attempt}/${maxAttempts})` : ''}`,
            formatMetadata(LOG_CATEGORY.API, undefined, undefined, {
                action: 'ERROR',
                endpoint,
                error: error.message,
                attempt,
                maxAttempts
            })
        ),
    },

    // Market data specific logging
    market: {
        fetching: (tokenId: string, tokenAddress: string, dataType: string) => elizaLogger.debug(
            `[${LOG_CATEGORY.MARKET_DATA}] Fetching ${dataType} for token`,
            formatMetadata(LOG_CATEGORY.MARKET_DATA, tokenId, undefined, { action: 'FETCHING', tokenAddress, dataType })
        ),
        received: (tokenId: string, tokenAddress: string, dataType: string, summary: Record<string, any>) => elizaLogger.debug(
            `[${LOG_CATEGORY.MARKET_DATA}] Received ${dataType} for token`,
            formatMetadata(LOG_CATEGORY.MARKET_DATA, tokenId, undefined, { action: 'RECEIVED', tokenAddress, dataType, summary })
        ),
        suspicious: (tokenId: string, tokenAddress: string, reason: string, details: Record<string, any>) => elizaLogger.warn(
            `[${LOG_CATEGORY.MARKET_DATA}] Suspicious token data: ${reason}`,
            formatMetadata(LOG_CATEGORY.MARKET_DATA, tokenId, undefined, { action: 'SUSPICIOUS', tokenAddress, reason, details })
        ),
        error: (tokenId: string, tokenAddress: string, dataType: string, error: Error) => elizaLogger.error(
            `[${LOG_CATEGORY.MARKET_DATA}] Error fetching ${dataType}`,
            formatMetadata(LOG_CATEGORY.MARKET_DATA, tokenId, undefined, {
                action: 'ERROR',
                tokenAddress,
                dataType,
                error: error.message
            })
        ),
    },

    // Performance monitoring logs
    performance: {
        start: (operation: string, tokenId?: string) => {
            const startTime = Date.now();
            return {
                end: (additionalData?: Record<string, any>) => {
                    const duration = Date.now() - startTime;
                    elizaLogger.debug(
                        `[${LOG_CATEGORY.PERFORMANCE}] Operation "${operation}" took ${duration}ms`,
                        formatMetadata(LOG_CATEGORY.PERFORMANCE, tokenId, undefined, {
                            action: 'TIMING',
                            operation,
                            duration,
                            ...additionalData
                        })
                    );
                    return duration;
                }
            };
        },
        checkpoint: (operation: string, checkpoint: string, tokenId?: string, elapsed?: number) => elizaLogger.debug(
            `[${LOG_CATEGORY.PERFORMANCE}] Checkpoint "${checkpoint}" for "${operation}"${elapsed ? ` at ${elapsed}ms` : ''}`,
            formatMetadata(LOG_CATEGORY.PERFORMANCE, tokenId, undefined, { action: 'CHECKPOINT', operation, checkpoint, elapsed })
        ),
    },

    // Add a new data namespace for token data collection
    data: {
        capture: (tokenId: string, checkType: string, recordId: string) => elizaLogger.info(
            `📊 Captured token data [${tokenId}] check=${checkType}`,
            { component: 'data', event: 'capture', tokenId, checkType, recordId }
        ),
        retrieve: (operation: string, count: number, filter?: Record<string, any>) => elizaLogger.debug(
            `📊 Retrieved ${count} token data records: ${operation}`,
            { component: 'data', event: 'retrieve', operation, count, filter }
        ),
        error: (operation: string, errorMessage: string) => elizaLogger.error(
            `📊 Token data error in ${operation}: ${errorMessage}`,
            { component: 'data', event: 'error', operation, error: errorMessage }
        )
    },
};