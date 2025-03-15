# Pump.fun Token Prediction Plugin for Eliza

A powerful plugin for the @ai16z/eliza framework that enables real-time analysis and prediction of tokens migrated from Pump.fun to Solana. This tool helps traders make informed decisions by providing BUY/IGNORE recommendations and market capitalization forecasts for newly migrated tokens.

![Pump.fun Token Prediction](https://via.placeholder.com/800x400?text=Pump.fun+Token+Prediction)

## 🚀 Features

- **Real-Time Token Streaming**: Monitors token migration events from Pump.fun using Solana WebSocket connections
- **Market Data Integration**: Fetches real-time metrics (market cap, volume, holders, OHLCV) via the Birdeye API
- **Prediction Engine**: Generates BUY/IGNORE decisions and 10-minute market cap forecasts using token metrics, Twitter sentiment, and historical trends
- **Learning System**: Records prediction outcomes and refines future predictions with historical accuracy
- **Scheduled Checks**: Tracks token performance every 2 minutes (2, 4, 6, 8, 10 minutes) with early termination if market cap drops below $10,000

## 📋 Prerequisites

- **Node.js**: Version 16.x or higher
- **Eliza Framework**: Installed and configured (@ai16z/eliza)
- **API Keys**:
  - Birdeye API key for market data (`BIRDEYE_API_KEY`)
- **Solana Network Access**:
  - `SOLANA_RPC_URL` (e.g., https://api.mainnet-beta.solana.com)
  - `SOLANA_WSS_URL` (e.g., wss://api.mainnet-beta.solana.com)

## 💻 Installation

### Clone the Repository

```bash
git clone https://github.com/your-org/pumpfun-eliza-plugin.git
cd pumpfun-eliza-plugin
```

### Install Dependencies

```bash
npm install
```

### Configure Environment Variables

Create a `.env` file in the root directory with:

```env
BIRDEYE_API_KEY=your_birdeye_api_key
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WSS_URL=wss://api.mainnet-beta.solana.com
```

> Replace `your_birdeye_api_key` with your Birdeye API key.
> Adjust Solana URLs if using a different RPC provider.

## 🔌 Integrate with Eliza

Add the plugin to your Eliza agent configuration:

```javascript
const { PredictionService } = require('@ai16z/plugin-token-prediction/dist/services/PredictionService');
const runtime = // your Eliza runtime instance
const predictionService = new PredictionService(runtime);

// Start the prediction stream
predictionService.startPredictionStream();
```

## 📊 Usage

### Starting the Token Stream

The `TokenMigrationProvider` connects to Solana's WebSocket to listen for token migrations:

```javascript
const { TokenMigrationProvider } = require('@ai16z/plugin-token-prediction/dist/providers/TokenMigrationProvider');
const runtime = // your Eliza runtime instance
const tokenStream = new TokenMigrationProvider(runtime);

tokenStream.on('tokenUpdate', (tokenData) => {
  console.log('New token migrated:', tokenData);
  predictionService.predictToken(tokenData, '', []).then(prediction => {
    console.log('Prediction:', prediction);
  });
});
```

> **Note**: `tweets` and `ohlcvData` are typically fetched internally by `predictToken` if not provided.

### Making a Manual Prediction

Analyze a token manually:

```javascript
const tokenData = {
  tokenId: 'example_token_id',
  address: '2RBko3xoz56aH69isQMUpzZd9NYHahhwC23A5F3Spkin',
  symbol: 'EXM',
  name: 'Example Token',
  marketCap: 50000
};

predictionService.predictToken(tokenData, 'Recent tweets about EXM', []).then(prediction => {
  console.log('Prediction Result:', JSON.stringify(prediction, null, 2));
}).catch(error => {
  console.error('Prediction failed:', error);
});
```

### Example Prediction Output

```json
{
  "entryDecision": "BUY",
  "marketCapPredictions": {
    "2min": 55000,
    "4min": 60000,
    "6min": 65000,
    "8min": 70000,
    "10min": 75000
  },
  "confidence": 0.85,
  "supportingFactors": ["High volume growth", "Positive Twitter sentiment"],
  "riskFactors": ["Moderate bundling detected"],
  "reasoning": "Strong initial volume and sentiment suggest short-term growth potential."
}
```

### Checking Historical Accuracy

Retrieve prediction performance:

```javascript
const learningService = predictionService.learningService;
learningService.getHistoricalAccuracy().then(stats => {
  console.log(`Accuracy: ${stats.percentage.toFixed(2)}% over ${stats.count} predictions`);
  console.log(`Average MAPE: ${(stats.avgMape * 100).toFixed(2)}%`);
});
```

## 🏗️ Architecture

### Key Components

#### TokenMigrationProvider
- Streams token migrations via Solana WebSocket
- Analyzes initial distribution and bundling
- Emits `tokenUpdate` events with `TokenData`

#### MarketDataProvider
- Fetches real-time data (market cap, holders, OHLCV) from Birdeye API
- Handles retries for rate limits and errors

#### PredictionService
- Predicts token performance using Eliza's AI
- Schedules 2-minute checks (up to 10 minutes or early termination at $10K market cap)
- Evaluates outcomes and generates summaries

#### LearningService
- Stores prediction results in memory
- Tracks historical accuracy and recent outcomes for feedback

### Data Flow

1. **Token Migration**: `TokenMigrationProvider` detects a new token
2. **Data Enrichment**: `MarketDataProvider` fetches market metrics; Twitter sentiment and OHLCV data are collected
3. **Prediction**: `PredictionService` generates a `TokenPrediction`
4. **Monitoring**: Checks run every 2 minutes, collecting `marketCap`, `holders`, `distribution`, `bundleData`, and `ohlcv`
5. **Evaluation**: After checks (or early termination), LLM evaluates the outcome
6. **Summary**: Results are summarized and stored for learning

## 📝 How Summaries Are Generated

Summaries are created by `PredictionService` after monitoring a token's performance over 10 minutes (or earlier if market cap < $10,000). The process compares predicted market caps against actual values, evaluates trends, and generates insights.

### Process

#### Prediction Initiation:
- `predictToken` generates a `TokenPrediction` with `entryDecision` (BUY/IGNORE) and `marketCapPredictions` for 2, 4, 6, 8, and 10 minutes.

#### Scheduled Checks:
- `scheduleChecks` fetches data every 2 minutes:
  - `marketCap`, `holders`, `volume1hUSD` (via `MarketDataProvider`)
  - `topHolderPercent`, `topHolders` (via `TokenMigrationProvider`)
  - `totalBundles`, `currentHeldPercentage` (via `TokenMigrationProvider`)
  - `ohlcv` (1-minute candles, last 10 minutes)
- If `marketCap` < $10,000, checks stop early, and `createTokenSummary` is called.

#### Evaluation (`evaluatePrediction`):
- Runs first within `createTokenSummary`
- LLM analyzes initial data, prediction, and checks (market cap, holders, distribution, bundles, OHLCV)
- Detects rug pulls (e.g., >5% drops in `marketCap` or `topHolderPercent`, OHLCV price crashes)
- Returns `reflection` and `lessonsLearned`

#### Summary Creation (`createTokenSummary`):
- **Metrics**:
  - `initialMarketCap`: First check
  - `finalMarketCap`: Last check
  - `maxMarketCap`: Highest across checks
  - `achievedTarget`:
    - BUY: `maxMarketCap` ≥ 85% of 10-minute prediction
    - IGNORE: `finalMarketCap` ≤ 115% of `initialMarketCap`
  - `mape`: Average error across steps (|Predicted - Actual| / Actual)
- Combines prediction, checks, results, reflection, and `lessonsLearned`
- Stores in memory and `LearningService`

#### Output: A detailed summary text, e.g.:
```
Summary for example_token_id
Decision: BUY
Achieved: False
MAPE: 15.00%
2min: Predicted 55000, Actual 54000, MAPE 1.85%, Achieved: True
4min: Predicted 60000, Actual 8000, MAPE 650.00%, Achieved: False
Reflection: Token rugged at 4min when market cap dropped below $10K with a sharp OHLCV price decline.
Lessons Learned: Low market cap and high topHolderPercent signal rug risk.
```

### Early Termination Example
If `marketCap` < $10,000 at 4min:
- Checks stop after 2 checks (2min, 4min)
- Summary reflects partial data with an early reflection (e.g., "Token failed early with market cap below $10K")

## 📄 License

MIT License

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request