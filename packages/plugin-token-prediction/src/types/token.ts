export interface TokenData {
    tokenId: string;
    address: string;
    symbol: string;
    name: string;
    marketCap: number;
    price?: number;
    bundleData?: {
        totalBundles: number;
        totalSolSpent: number;
        currentHeldPercentage: number;
        totalBundledPercentage: number;
    };
    creatorRiskProfile?: {
        totalCreated: number;
        currentTokenHeldPercent: number;
        devWarnings: string[];
    };
    distribution?: {
        topHolderPercent: number;
        topHolders: Array<{
            address: string;
            amount: number;
            percentage: number;
        }>;
        suspiciousDistribution: boolean;
   };
}

export interface MarketData {
    price?: number;
    marketCap: number;
    symbol: string;
    holderCount?: number;
    volume1hUSD?: number;
    volume24hUSD?: number;
    priceChange1h?: number;
    priceChange24h?: number;
    uniqueTraders1h?: number;
    trades1h?: number;
}

export interface OHLCVData {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface TokenUpdateEvent {
    tokenData: TokenData;
    timestamp: string;
  }