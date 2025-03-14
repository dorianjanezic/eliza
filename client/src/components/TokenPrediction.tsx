// File: /src/components/TokenPrediction.tsx
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type TokenPrediction = {
  token_details: { address: string; symbol: string; name: string };
  current_metrics: { market_cap: number; holders: number; unique_traders_1h: number; volume_1hUSD: number };
  prediction: {
    entry_decision: 'BUY' | 'IGNORE';
    market_cap_predictions: { '2min': number; '4min': number; '6min': number; '8min': number; '10min': number };
    confidence: number;
    supporting_factors: string[];
    risk_factors: string[];
  };
};

export default function TokenPrediction() {
  const { agentId } = useParams<{ agentId: string }>();

  const { data: predictions, isLoading, error } = useQuery({
    queryKey: ['predictions', agentId],
    queryFn: async () => {
      const res = await fetch(`/api/${agentId}/predictions`);
      if (!res.ok) throw new Error(`Failed to fetch predictions: ${res.statusText}`);
      return res.json() as Promise<TokenPrediction[]>;
    },
    refetchInterval: 5000, // Poll every 5 seconds for near real-time updates
  });

  return (
    <div className="flex flex-col h-screen max-h-screen w-full p-4 overflow-y-auto">
      <div className="max-w-4xl mx-auto w-full">
        <h1 className="text-2xl font-bold mb-4">Token Prediction Monitoring</h1>
        {isLoading && <p>Loading predictions...</p>}
        {error && <p className="text-red-500">Error: {(error as Error).message}</p>}
        {predictions && predictions.length === 0 && (
          <p className="text-muted-foreground">No predictions yet. Monitoring in progress...</p>
        )}
        {predictions && predictions.map((prediction, index) => (
          <Card key={index} className="mb-4">
            <CardHeader>
              <CardTitle>
                {prediction.token_details.name} ({prediction.token_details.symbol})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p><strong>Address:</strong> {prediction.token_details.address}</p>
              <p><strong>Current Market Cap:</strong> ${prediction.current_metrics.market_cap.toLocaleString()}</p>
              <p><strong>Decision:</strong> {prediction.prediction.entry_decision}</p>
              <p><strong>Confidence:</strong> {(prediction.prediction.confidence * 100).toFixed(2)}%</p>
              <p><strong>Market Cap Predictions:</strong></p>
              <ul className="list-disc pl-5">
                {Object.entries(prediction.prediction.market_cap_predictions).map(([time, value]) => (
                  <li key={time}>{time}: ${value.toLocaleString()}</li>
                ))}
              </ul>
              <p><strong>Supporting Factors:</strong> {prediction.prediction.supporting_factors.join(', ')}</p>
              <p><strong>Risk Factors:</strong> {prediction.prediction.risk_factors.join(', ')}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}