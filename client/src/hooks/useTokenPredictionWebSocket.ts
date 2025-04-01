import { useEffect, useRef, useState } from 'react';

interface TokenData {
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

interface OHLCVData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface DashboardData {
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

export function useTokenPredictionWebSocket(agentId: string) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!agentId) return;

    // Connect to the WebSocket
    const wsUrl = `ws://localhost:3000/${agentId}/ws`;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log('Connected to token prediction WebSocket');
      // Subscribe to token prediction updates
      wsRef.current?.send(JSON.stringify({ type: 'subscribe', channel: 'token-predictions' }));
    };

    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'token-prediction-update') {
          setData(message.data);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
        setError('Failed to parse WebSocket message');
      }
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error');
    };

    wsRef.current.onclose = () => {
      console.log('WebSocket connection closed');
    };

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [agentId]);

  return { data, error };
}