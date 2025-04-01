import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useParams } from 'react-router-dom';
import { useTokenPredictionWebSocket } from '@/hooks/useTokenPredictionWebSocket';

export function TokenPredictionDashboard() {
  const { agentId } = useParams<{ agentId: string }>();
  const { data, error } = useTokenPredictionWebSocket(agentId || '');

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8">Token Prediction Dashboard</h1>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="predictions">Predictions</TabsTrigger>
          <TabsTrigger value="market">Market Data</TabsTrigger>
          <TabsTrigger value="sentiment">Sentiment Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <h3 className="text-lg font-semibold">Active Tokens</h3>
              <p className="text-3xl font-bold">{data.activeTokens.length}</p>
            </Card>
            <Card className="p-4">
              <h3 className="text-lg font-semibold">Total Predictions</h3>
              <p className="text-3xl font-bold">{data.predictions.length}</p>
            </Card>
            <Card className="p-4">
              <h3 className="text-lg font-semibold">Average Confidence</h3>
              <p className="text-3xl font-bold">
                {data.predictions.length ?
                  (data.predictions.reduce((acc, p) => acc + p.confidence, 0) / data.predictions.length).toFixed(1) :
                  '0'}%
              </p>
            </Card>
            <Card className="p-4">
              <h3 className="text-lg font-semibold">Tokens Monitored</h3>
              <p className="text-3xl font-bold">{Object.keys(data.marketData).length}</p>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="predictions">
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4">Token Predictions</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Token</th>
                    <th className="text-left py-2">Prediction</th>
                    <th className="text-left py-2">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {data.predictions.map((pred, index) => (
                    <tr key={index} className="border-b">
                      <td className="py-2">{pred.token}</td>
                      <td className="py-2">{pred.prediction.toFixed(2)}%</td>
                      <td className="py-2">{pred.confidence.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="market">
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4">Market Data</h2>
            {/* TODO: Add market data visualization */}
            <div className="h-96 bg-gray-100 rounded flex items-center justify-center">
              Market Data Visualization Coming Soon
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="sentiment">
          <Card className="p-6">
            <h2 className="text-xl font-bold mb-4">Sentiment Analysis</h2>
            {/* TODO: Add sentiment visualization */}
            <div className="h-96 bg-gray-100 rounded flex items-center justify-center">
              Sentiment Analysis Visualization Coming Soon
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}