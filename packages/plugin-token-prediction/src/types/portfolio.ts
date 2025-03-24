export interface Trade {
    tokenId: string;
    address: string;
    symbol: string;
    entryPrice: number;
    entryAmount: number; // USD amount invested
    tokenAmount: number; // Tokens bought
    takeProfitPrice: number;
    stopLossPrice: number;
    entryTime: string;   // Added to track when the trade was opened
    exitPrice?: number;
    exitTime?: string;
    profitLoss: number; // USD profit/loss, calculated on exit
    status: 'OPEN' | 'CLOSED';
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
}

export interface Portfolio {
    initialBalance: number; // Always $1,000 per instance
    currentBalance: number; // Updated after trades
    trades: Trade[];
    maxActivePositions: number; // Maximum number of concurrent open trades
    maxPositionSize: number; // Maximum position size as a percentage of portfolio (0.01-1.0)
    minPortfolioThreshold: number; // Minimum portfolio threshold as a percentage of initial balance (0.01-1.0)
    stats: PortfolioStats; // Trade performance statistics
}