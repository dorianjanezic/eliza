import { MarketData, OHLCVData } from "./token";

export interface TokenPrediction {
    entryDecision: 'BUY' | 'IGNORE';
    marketCapPredictions: { '2min': number; '4min': number; '6min': number; '8min': number; '10min': number };
    confidence: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    /**
     * Suggested percentage of the portfolio to invest in this token (0.01 - 0.2)
     * - Values are expressed in decimal form (e.g., 0.1 means 10%)
     * - Defaults to 0.1 (10%) if not provided
     * - Will be capped at 0.2 (20%) to manage risk
     */
    suggestedInvestmentPercentage?: number;
    supportingFactors: string[];
    riskFactors: string[];
    reasoning: string;
}

export interface PredictionCheck {
    timestamp: string;
    marketCap: number;
    marketData?: MarketData;
    distribution?: {
        topHolderPercent: number;
        topHolders: Array<{ address: string; amount: number; percentage: number }>;
    };
    bundleData?: {
        totalBundles: number;
        totalSolSpent: number;
        currentHeldPercentage: number;
        totalBundledPercentage: number;
    };
    ohlcv?: OHLCVData[];
}



export interface PredictionResult {
    prediction: TokenPrediction;
    checks?: PredictionCheck[];
    results: {
        initialMarketCap: number;
        finalMarketCap: number;
        maxMarketCap: number;
        achievedTarget: boolean;
        mape: number;
        mapePerStep: { time: string; mape: number; achieved: boolean }[];
    };
    reflection?: string;
    lessonsLearned?: string[];
    tradeResult?: {
        entryPrice: number;
        exitPrice?: number;
        profitLoss: number;
        status: 'OPEN' | 'CLOSED';
    };
}