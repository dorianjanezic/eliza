# Pump.fun Token Prediction Plugin for Eliza

A powerful plugin for the ai16z/eliza framework that enables real-time analysis and prediction of tokens migrated from Pump.fun. This tool helps traders make informed decisions by providing BUY/IGNORE recommendations and market capitalization forecasts for newly migrated tokens.

## Features

- **Real-Time Token Streaming**: Subscribe to token migration events from Pump.fun using WebSocket connections.
- **Market Data Integration**: Fetch real-time token metrics (market cap, volume, holders) via the Birdeye API.
- **Prediction Engine**: Generate BUY/IGNORE decisions and market cap forecasts based on token metrics and historical trends.
- **Learning System**: Record prediction results and calculate historical accuracy to refine future predictions.
- **Scheduled Checks**: Monitor token performance at specified intervals (2, 4, 6, 8, and 10 minutes) to validate predictions.

## Prerequisites

- **Node.js**: Version 16.x or higher
- **Eliza Framework**: Installed and configured (@ai16z/eliza)
- **API Keys**:
  - Birdeye API key for market data
  - Supabase API key for WebSocket streaming (if applicable)
- **Solana Network Access**: Knowledge of Solana token addresses for validation

## Installation

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

Create a `.env` file in the root directory with the following:

```env
BIRDEYE_API_KEY=your_birdeye_api_key
SUPABASE_URL=your_supabase_realtime_url
SUPABASE_API_KEY=your_supabase_api_key
```

- Replace `your_birdeye_api_key` with your Birdeye API key
- Replace `your_supabase_realtime_url` and `your_supabase_api_key` with your Supabase credentials if using the default TokenStreamProvider

### Integrate with Eliza

Ensure the Eliza framework is installed and running in your environment. Add this plugin to your Eliza agent configuration:

```javascript
const { PredictionService } = require('./path/to/PredictionService');
const runtime = // your Eliza runtime instance
const predictionService = new PredictionService(runtime);
```

## Usage

### Starting the Token Stream

The TokenStreamProvider connects to a WebSocket endpoint to listen for token migration events.

```javascript
const { TokenStreamProvider } = require('./path/to/TokenStreamProvider');
const runtime = // your Eliza runtime instance
const tokenStream = new TokenStreamProvider('your_supabase_url', 'your_supabase_api_key', runtime);

tokenStream.on('tokenUpdate', (tokenData) => {
  console.log('New token update:', tokenData);
  // Trigger prediction
  predictionService.predictToken(tokenData).then(prediction => {
    console.log('Prediction:', prediction);
  });
});
```

### Making a Prediction

Use the PredictionService to analyze a token and generate a prediction:

```javascript
const tokenData = {
  tokenId: 'example_token_id',
  address: 'So11111111111111111111111111111111111111112',
  symbol: 'EXM',
  name: 'Example Token',
  marketCap: 1000000,
  volume1h: 50000,
  uniqueTraders1h: 200,
  holders: 1500
};

predictionService.predictToken(tokenData).then(prediction => {
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
    "2min": 1100000,
    "4min": 1200000,
    "6min": 1300000,
    "8min": 1400000,
    "10min": 1500000
  },
  "confidence": 0.85,
  "supportingFactors": ["High volume_1h", "Increasing unique traders"],
  "riskFactors": ["Moderate holder concentration"]
}
```

### Checking Historical Accuracy

Retrieve the historical accuracy of predictions:

```javascript
const learningService = predictionService.learningService;
learningService.getHistoricalAccuracy().then(stats => {
  console.log(`Accuracy: ${stats.percentage.toFixed(2)}% over ${stats.count} predictions`);
  console.log(`Average MAPE: ${(stats.avgMape * 100).toFixed(2)}%`);
});
```

## Architecture

### Key Components

#### TokenStreamProvider
- Streams real-time token updates via WebSocket
- Handles reconnection logic and heartbeats
- Emits `tokenUpdate` events with TokenData

#### MarketDataProvider
- Fetches token metrics from the Birdeye API
- Supports retry logic for rate limits and errors
- Returns MarketData objects

#### PredictionService
- Orchestrates token prediction using Eliza's AI capabilities
- Schedules market cap checks at 2-minute intervals
- Stores predictions and results in memory

#### LearningService
- Maintains a global summary of prediction results
- Provides historical accuracy and recent prediction summaries
- Uses Eliza's memory system for persistence

### Data Flow

1. **Token Update**: TokenStreamProvider detects a new token migration
2. **Data Enrichment**: MarketDataProvider fetches current market metrics
3. **Prediction**: PredictionService analyzes the token and generates a TokenPrediction
4. **Validation**: Scheduled tasks check market cap at 2, 4, 6, 8, and 10 minutes
5. **Learning**: LearningService records results and updates historical accuracy

## How Summaries Are Generated

Summaries are created by the PredictionService after a prediction is made and validated through scheduled checks. The process involves comparing predicted market caps against actual values collected at 2-minute intervals over 10 minutes, then calculating performance metrics like MAPE (Mean Absolute Percentage Error) and whether the target was achieved.

### Process

1. **Prediction Initiation**:
   * A TokenPrediction is generated with an entryDecision (BUY or IGNORE) and market cap predictions for 2, 4, 6, 8, and 10 minutes.

2. **Scheduled Checks**:
   * The `scheduleChecks` method fetches actual market cap data from the MarketDataProvider at 2-minute intervals (e.g., 2, 4, 6, 8, 10 minutes) using the Birdeye API.
   * Each check is stored as a PredictionCheck with a timestamp and market cap.

3. **Summary Creation (`createTokenSummary`)**:
   * **Initial and Final Values**: The initial market cap (from the first check) and final market cap (from the last check) are recorded. The maximum market cap across all checks is also noted.
   * **Achieved Target**:
      * For BUY: True if the maximum market cap reaches at least 90% of the 10-minute prediction.
      * For IGNORE: True if the final market cap is within 105% of the initial market cap (indicating no significant growth).
   * **MAPE Per Step**: For each time step, MAPE is calculated as:
     ```
     MAPE = |((Predicted Market Cap - Actual Market Cap) / Actual Market Cap)|
     ```
   * **Overall MAPE**: The average of MAPE values across all steps.
   * **Storage**: The summary is saved as a PredictionResult in memory and recorded in the LearningService for historical analysis.

4. **Output**: A human-readable summary text is generated, including the decision, achievement status, and per-step results.

### Example Summary Output

Below is an example of a summary for a token with ID example_token_id:

```text
Summary for example_token_id
Decision: BUY
Achieved: True
MAPE: 8.24%
2min: Predicted 1100000, Actual 1080000, MAPE 1.85%, Achieved: True
4min: Predicted 1200000, Actual 1150000, MAPE 4.35%, Achieved: True
6min: Predicted 1300000, Actual 1250000, MAPE 4.00%, Achieved: True
8min: Predicted 1400000, Actual 1280000, MAPE 9.38%, Achieved: True
10min: Predicted 1500000, Actual 1350000, MAPE 11.11%, Achieved: True
```

**Interpretation**:
* The prediction was to BUY, expecting growth.
* The target was achieved because the maximum market cap (e.g., 1350000) was at least 90% of 1500000 (1350000 ≥ 1350000).
* Overall MAPE of 8.24% indicates an average error of 8.24% across all steps.
* Each step shows the predicted vs. actual market cap, with individual MAPE values and whether the step met its target (e.g., actual ≥ 90% of predicted for BUY).

## License

[Add your license information here]

## Contributing

[Add contributing guidelines here]