export interface TokenData {
    tokenId: string;
    address: string;
    symbol: string;
    name: string;
    marketCap: number;
    bundleData: {
        totalBundles: number;
        totalSolSpent: number;
        currentHeldPercentage: number;
        totalBundledPercentage: number;
        bonded: boolean;
    };
    creatorRiskProfile: {
        totalCreated: number;
        currentTokenHeldPercent: number;
        devWarnings: string[];
    };
    distribution: {
        holderCount: number;
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
    holderCount?: number; // Birdeye: holder
    volume1hUSD?: number; // Birdeye: v1h
    volume24hUSD?: number; // Birdeye: v24h
    priceChange1h?: number; // Birdeye: priceChange1hPercent
    priceChange24h?: number; // Birdeye: priceChange24hPercent
    uniqueTraders1h?: number; // Birdeye: uniqueWallet1h
    trades1h?: number; // Birdeye: trade1h
}

export interface TokenUpdateEvent {
    tokenData: TokenData;
    timestamp: string;
  }