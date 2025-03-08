export interface TokenPrediction {
    entryDecision: 'BUY' | 'IGNORE';
    marketCapPredictions: {
        '2min': number;
        '4min': number;
        '6min': number;
        '8min': number;
        '10min': number;
    };
    confidence: number;
    supportingFactors: string[];
    riskFactors: string[];
}

export interface PredictionCheck {
    timestamp: string;
    marketCap: number;
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
}