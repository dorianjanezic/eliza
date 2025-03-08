export interface TokenData {
    tokenId: string;
    address: string;
    symbol: string;
    name: string;
    marketCap: number;
    volume1h?: number; // From MarketDataProvider
    uniqueTraders1h?: number; // From MarketDataProvider
    holders?: number; // From MarketDataProvider (holderCount)
}

export interface MarketData {
    price?: number;
    marketCap: number;
    holderCount?: number; // Birdeye: holder
    volume1h?: number; // Birdeye: v1h
    volume24h?: number; // Birdeye: v24h
    priceChange1h?: number; // Birdeye: priceChange1hPercent
    priceChange24h?: number; // Birdeye: priceChange24hPercent
    uniqueTraders1h?: number; // Birdeye: uniqueWallet1h
    trades1h?: number; // Birdeye: trade1h
}

export interface TokenUpdateEvent {
    tokenData: {
      tokenId: string;
      address: string;
      symbol: string;
      name: string;
    };
    timestamp: string;
  }