export interface TokenData {
  tokenId: string;
  address: string;
  symbol: string;
  name: string;
  marketCap: number;
  price?: number;
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

export interface DashboardData {
  activeTokens: TokenData[];
  predictions: {
    token: string;
    prediction: number;
    confidence: number;
  }[];
  marketData: {
    [key: string]: OHLCVData[];
  };
  sentiment: {
    [key: string]: {
      score: number;
      volume: number;
    };
  };
}

export async function fetchDashboardData(agentId: string): Promise<DashboardData> {
  const response = await fetch(`/api/agents/${agentId}/token-prediction/dashboard`);
  if (!response.ok) {
    throw new Error('Failed to fetch dashboard data');
  }
  return response.json();
}

export async function fetchMarketData(agentId: string, token: string): Promise<OHLCVData[]> {
  const response = await fetch(`/api/agents/${agentId}/token-prediction/market-data/${token}`);
  if (!response.ok) {
    throw new Error('Failed to fetch market data');
  }
  return response.json();
}

export async function fetchSentimentData(agentId: string, token: string): Promise<{
  score: number;
  volume: number;
}> {
  const response = await fetch(`/api/agents/${agentId}/token-prediction/sentiment/${token}`);
  if (!response.ok) {
    throw new Error('Failed to fetch sentiment data');
  }
  return response.json();
}

export async function fetchPredictions(agentId: string): Promise<{
  token: string;
  prediction: number;
  confidence: number;
}[]> {
  const response = await fetch(`/api/agents/${agentId}/token-prediction/predictions`);
  if (!response.ok) {
    throw new Error('Failed to fetch predictions');
  }
  return response.json();
}