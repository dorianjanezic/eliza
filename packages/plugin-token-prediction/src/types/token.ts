export interface TokenData {
    tokenId: string;
    address: string; // mint_address
    symbol: string;
    name: string;
    description?: string; // From token_info
    createdAt?: string; // From token_info.created_at (token inception time)
    status?: string; // From token_info.status (e.g., "observe", "dead")
    marketCap: number; // From market_data
    uniqueHolders?: number; // From market_data.unique_holders
    pairCreatedAt?: string; // From market_data.pair_created_at (liquidity pair creation time)
    top10Percentage?: number; // From holder_distribution.top_10_percentage
    pumpfunTop10HoldersPercentage?: number; // From holder_distribution.pumpfun_top_10_holders_percentage
    ogHoldersPercentage?: number; // From holder_distribution.og_holders_percentage
    pumpfunTotalVolumeSol?: number; // From trading_activity.pumpfun_total_volume_sol
    pumpfunTotalTransactions?: number; // From trading_activity.pumpfun_total_transactions
    pumpfunUniqueTraders?: number; // From trading_activity.pumpfun_unique_traders
    pumpfunReplyCount?: number; // From trading_activity.pumpfun_reply_count
    numberOfBundles?: number; // From bundle_info
    bundleMaxPercentHeld?: number; // From bundle_info.bundle_max_percent_held
    numberOfBots?: number; // From bundle_info.number_of_bots
    devTokenPercentage?: number; // From developer_info.dev_token_percentage
    volume1h?: number; // From MarketDataProvider or trading_activity.volume_data.volume_1h
    uniqueTraders1h?: number; // From MarketDataProvider or trading_activity
    holders?: number; // From MarketDataProvider (holderCount), can override uniqueHolders if fresher
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
    tokenData: TokenData;
    timestamp: string;
  }