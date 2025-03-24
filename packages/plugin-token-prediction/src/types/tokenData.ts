import { UUID, IDatabaseAdapter } from "@ai16z/eliza";
import { OHLCVData, TokenData } from "./token";
import { TokenPrediction } from "./prediction";

export interface TwitterSentiment {
    score: number; // Normalized 0-1
    summary: string;
    tweetCount: number;
}

export interface TokenDataRecord {
    // Unique identifier
    id: string; // UUID for this record
    tokenId: string; // Original token ID
    timestamp: string; // When this data point was collected

    // Basic token info
    address: string;
    symbol: string;
    name: string;

    // Market data
    price?: number;
    marketCap: number;
    holderCount?: number;
    volume1hUSD?: number;
    volume24hUSD?: number;
    priceChange1h?: number;
    priceChange24h?: number;
    uniqueTraders1h?: number;
    trades1h?: number;

    // Distribution data
    topHolderPercent?: number;
    topHolders?: Array<{
        address: string;
        amount: number;
        percentage: number;
    }>;
    suspiciousDistribution?: boolean;

    // Bundle data
    totalBundles?: number;
    totalSolSpent?: number;
    currentHeldPercentage?: number;
    totalBundledPercentage?: number;

    // OHLCV data points (serialized as JSON in the DB)
    ohlcvData?: OHLCVData[];

    // Twitter sentiment if available (serialized as JSON in the DB)
    twitterSentiment?: TwitterSentiment;

    // Prediction data (if available at this snapshot) (serialized as JSON in the DB)
    currentPrediction?: Partial<TokenPrediction>;

    // Check-specific data
    checkNumber?: number; // 0 for initial, 1 for first check (2min), etc.
    isInitialCheck: boolean;
    checkType: 'INITIAL' | '2MIN' | '4MIN' | '6MIN' | '8MIN' | '10MIN' | 'FINAL';

    // For associating with prediction results
    predictionResultId?: string; // Reference to the final prediction result

    // Trade data (for backtesting and analysis)
    tradeId?: string;
    entryPrice?: number;
    entryTime?: string;
    exitPrice?: number;
    exitTime?: string;
    profitLoss?: number;
    profitLossPercent?: number;

    // Agent ID
    agentId: UUID;
}

// Database adapter methods for token data operations
export interface TokenDataAdapter {
    saveTokenData(data: SerializedTokenDataRecord): Promise<void>;
    getTokenDataByTokenId(tokenId: string): Promise<SerializedTokenDataRecord[]>;
    getTokenDataByPredictionId(predictionResultId: string): Promise<SerializedTokenDataRecord[]>;
    getTokenDataByAddressAndTimeRange(address: string, startTime: string, endTime: string): Promise<SerializedTokenDataRecord[]>;
    getTokenDataByCheckType(checkType: string): Promise<SerializedTokenDataRecord[]>;
    getAllTokensWithInitialChecks(): Promise<SerializedTokenDataRecord[]>;
}

// Extend the IDatabaseAdapter to include token data methods
export interface TokenDataExtendedAdapter extends IDatabaseAdapter, TokenDataAdapter {}

export interface TokenDataStorage {
    saveTokenData(data: TokenDataRecord): Promise<void>;
    getTokenDataByTokenId(tokenId: string): Promise<TokenDataRecord[]>;
    getTokenDataByPredictionId(predictionResultId: string): Promise<TokenDataRecord[]>;
    getTokenDataByAddressAndTimeRange(address: string, startTime: string, endTime: string): Promise<TokenDataRecord[]>;
    getTokenDataByCheckType(checkType: TokenDataRecord['checkType']): Promise<TokenDataRecord[]>;
    getAllTokensWithInitialChecks(): Promise<TokenDataRecord[]>;
}

// For serialization/deserialization
export interface SerializedTokenDataRecord extends Omit<TokenDataRecord, 'ohlcvData' | 'twitterSentiment' | 'currentPrediction' | 'topHolders' | 'isInitialCheck'> {
    ohlcvData?: string;
    twitterSentiment?: string;
    currentPrediction?: string;
    topHolders?: string;
    isInitialCheck: number; // Boolean in TokenDataRecord, number in database
}