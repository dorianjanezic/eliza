import { elizaLogger, type IAgentRuntime, stringToUuid, type UUID } from "@ai16z/eliza";
import { v4 as uuidv4 } from 'uuid';
import type { TokenDataRecord, TwitterSentiment, SerializedTokenDataRecord, TokenDataExtendedAdapter } from "../types/tokenData";
import type { TokenData, OHLCVData } from "../types/token";
import type { TokenPrediction } from "../types/prediction";
import { logger } from "../utils/logger";

export class TokenDataService {
    private readonly runtime: IAgentRuntime;
    private readonly adapter: TokenDataExtendedAdapter;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
        this.adapter = runtime.databaseAdapter as unknown as TokenDataExtendedAdapter;
    }

    /**
     * Captures token data at a specific point in time (initial detection, prediction, or check)
     */
    async captureTokenData(
        tokenData: TokenData,
        checkType: TokenDataRecord['checkType'],
        options: {
            ohlcvData?: OHLCVData[];
            twitterSentiment?: TwitterSentiment;
            currentPrediction?: Partial<TokenPrediction>;
            checkNumber?: number;
            isInitialCheck?: boolean;
            predictionResultId?: string;
            // Trade data
            tradeId?: string;
            entryPrice?: number;
            entryTime?: string;
            exitPrice?: number;
            exitTime?: string;
            profitLoss?: number;
            profitLossPercent?: number;
        } = {}
    ): Promise<string> {
        try {
            const recordId = uuidv4();
            const timestamp = new Date().toISOString();

            const {
                ohlcvData,
                twitterSentiment,
                currentPrediction,
                checkNumber,
                isInitialCheck = false,
                predictionResultId,
                // Trade data
                tradeId,
                entryPrice,
                entryTime,
                exitPrice,
                exitTime,
                profitLoss,
                profitLossPercent
            } = options;

            // Prepare the record
            const record: TokenDataRecord = {
                id: recordId,
                tokenId: tokenData.tokenId,
                timestamp,
                address: tokenData.address,
                symbol: tokenData.symbol,
                name: tokenData.name,
                price: tokenData.price,
                marketCap: tokenData.marketCap,

                // Market data fields
                holderCount: tokenData.holderCount,
                volume1hUSD: tokenData.volume1hUSD,
                volume24hUSD: tokenData.volume24hUSD,
                priceChange1h: tokenData.priceChange1h,
                priceChange24h: tokenData.priceChange24h,
                uniqueTraders1h: tokenData.uniqueTraders1h,
                trades1h: tokenData.trades1h,

                // Optional market data
                ...(tokenData.distribution && {
                    topHolderPercent: tokenData.distribution.topHolderPercent,
                    topHolders: tokenData.distribution.topHolders,
                    suspiciousDistribution: tokenData.distribution.suspiciousDistribution,
                }),

                // Optional bundle data
                ...(tokenData.bundleData && {
                    totalBundles: tokenData.bundleData.totalBundles,
                    totalSolSpent: tokenData.bundleData.totalSolSpent,
                    currentHeldPercentage: tokenData.bundleData.currentHeldPercentage,
                    totalBundledPercentage: tokenData.bundleData.totalBundledPercentage,
                }),

                // Optional additional data
                ohlcvData,
                twitterSentiment,
                currentPrediction,

                // Check metadata
                checkNumber,
                isInitialCheck,
                checkType,
                predictionResultId,

                // Trade data if provided
                tradeId,
                entryPrice,
                entryTime,
                exitPrice,
                exitTime,
                profitLoss,
                profitLossPercent,

                // Agent ID for reference
                agentId: this.runtime.agentId,
            };

            // Serialize for storage
            const serializedRecord = this.serializeTokenDataRecord(record);

            // Save to database
            await this.adapter.saveTokenData(serializedRecord);

            logger.data.capture(tokenData.tokenId, checkType, recordId);

            return recordId;
        } catch (error) {
            const err = error instanceof Error ? error.message : 'Unknown error';
            logger.data.error('captureTokenData', err);
            throw error;
        }
    }

    /**
     * Retrieves all token data points for a specific token
     */
    async getTokenDataByTokenId(tokenId: string): Promise<TokenDataRecord[]> {
        try {
            const records = await this.adapter.getTokenDataByTokenId(tokenId);
            return records.map(record => this.deserializeTokenDataRecord(record));
        } catch (error) {
            const err = error instanceof Error ? error.message : 'Unknown error';
            logger.data.error('getTokenDataByTokenId', err);
            return [];
        }
    }

    /**
     * Retrieves all token data points associated with a specific prediction result
     */
    async getTokenDataByPredictionId(predictionResultId: string): Promise<TokenDataRecord[]> {
        try {
            const records = await this.adapter.getTokenDataByPredictionId(predictionResultId);
            return records.map(record => this.deserializeTokenDataRecord(record));
        } catch (error) {
            const err = error instanceof Error ? error.message : 'Unknown error';
            logger.data.error('getTokenDataByPredictionId', err);
            return [];
        }
    }

    /**
     * Retrieves token data within a specified time range for a token address
     */
    async getTokenDataByAddressAndTimeRange(address: string, startTime: string, endTime: string): Promise<TokenDataRecord[]> {
        try {
            const records = await this.adapter.getTokenDataByAddressAndTimeRange(address, startTime, endTime);
            return records.map(record => this.deserializeTokenDataRecord(record));
        } catch (error) {
            const err = error instanceof Error ? error.message : 'Unknown error';
            logger.data.error('getTokenDataByAddressAndTimeRange', err);
            return [];
        }
    }

    /**
     * Retrieves token data by check type
     */
    async getTokenDataByCheckType(checkType: TokenDataRecord['checkType']): Promise<TokenDataRecord[]> {
        try {
            const records = await this.adapter.getTokenDataByCheckType(checkType);
            return records.map(record => this.deserializeTokenDataRecord(record));
        } catch (error) {
            const err = error instanceof Error ? error.message : 'Unknown error';
            logger.data.error('getTokenDataByCheckType', err);
            return [];
        }
    }

    /**
     * Retrieves all tokens with initial checks (useful for backtesting starting points)
     */
    async getAllTokensWithInitialChecks(): Promise<TokenDataRecord[]> {
        try {
            const records = await this.adapter.getAllTokensWithInitialChecks();
            return records.map(record => this.deserializeTokenDataRecord(record));
        } catch (error) {
            const err = error instanceof Error ? error.message : 'Unknown error';
            logger.data.error('getAllTokensWithInitialChecks', err);
            return [];
        }
    }

    /**
     * Helper function to serialize the token data record for database storage
     */
    private serializeTokenDataRecord(record: TokenDataRecord): SerializedTokenDataRecord {
        return {
            ...record,
            ohlcvData: record.ohlcvData ? JSON.stringify(record.ohlcvData) : undefined,
            twitterSentiment: record.twitterSentiment ? JSON.stringify(record.twitterSentiment) : undefined,
            currentPrediction: record.currentPrediction ? JSON.stringify(record.currentPrediction) : undefined,
            topHolders: record.topHolders ? JSON.stringify(record.topHolders) : undefined,
            isInitialCheck: record.isInitialCheck ? 1 : 0,
        };
    }

    /**
     * Helper function to deserialize database records to TokenDataRecord objects
     */
    private deserializeTokenDataRecord(record: SerializedTokenDataRecord): TokenDataRecord {
        return {
            ...record,
            ohlcvData: record.ohlcvData ? JSON.parse(record.ohlcvData) : undefined,
            twitterSentiment: record.twitterSentiment ? JSON.parse(record.twitterSentiment) : undefined,
            currentPrediction: record.currentPrediction ? JSON.parse(record.currentPrediction) : undefined,
            topHolders: record.topHolders ? JSON.parse(record.topHolders) : undefined,
            isInitialCheck: Boolean(record.isInitialCheck),
        };
    }
}