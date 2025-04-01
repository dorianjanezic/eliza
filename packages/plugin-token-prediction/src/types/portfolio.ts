export interface Trade {
    tokenId: string;
    address: string;
    symbol: string;
    entryPrice: number;
    entryMarketCap: number; // Market cap at entry
    entryAmount: number; // USD amount invested
    tokenAmount: number; // Tokens bought
    takeProfitPrice: number;
    stopLossPrice: number;
    entryTime: string;   // Added to track when the trade was opened
    exitPrice?: number;
    exitMarketCap?: number; // Market cap at exit
    exitTime?: string;
    profitLoss: number; // USD profit/loss, calculated on exit
    profitLossPercentage: number; // Percentage profit/loss
    status: 'OPEN' | 'CLOSED';
    currentMarketCap?: number; // Current market cap for open trades
    maxMarketCap?: number; // Maximum market cap reached during trade
    minMarketCap?: number; // Minimum market cap reached during trade
}

export interface PortfolioStats {
    totalTrades: number;
    profitableTrades: number;
    unprofitableTrades: number;
    winRate: number;
    totalPnL: number;
    avgPnL: number;
    avgWin: number;
    avgLoss: number;
    maxDrawdown: number;
    maxDrawdownPercentage: number;
    // New statistics
    activeTrades: number;
    closedTrades: number;
    avgTradeDuration: number; // in minutes
    bestTrade: {
        symbol: string;
        profitLoss: number;
        profitLossPercentage: number;
    };
    worstTrade: {
        symbol: string;
        profitLoss: number;
        profitLossPercentage: number;
    };
    currentOpenPositions: {
        symbol: string;
        entryPrice: number;
        currentPrice: number;
        entryMarketCap: number;
        currentMarketCap: number;
        profitLoss: number;
        profitLossPercentage: number;
    }[];
}

export interface Portfolio {
    initialBalance: number; // Always $1,000 per instance
    currentBalance: number; // Updated after trades
    trades: Trade[];
    maxActivePositions: number; // Maximum number of concurrent open trades
    maxPositionSize: number; // Maximum position size as a percentage of portfolio (0.01-1.0)
    minPortfolioThreshold: number; // Minimum portfolio threshold as a percentage of initial balance (0.01-1.0)
    stats: PortfolioStats;
}