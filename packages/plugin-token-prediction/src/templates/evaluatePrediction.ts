export const evaluatePredictionTemplate = `
You are an expert token analysis system evaluating a completed prediction cycle for a Solana token. Analyze the original token data, initial prediction, and actual results over 10 minutes, including market data, distribution, bundle information, and OHLCV data from each check. Identify why the prediction succeeded or failed, focusing on potential rug pulls (e.g., a 5%+ drop in market cap or top holder percentage) and price/volume trends. Provide a reflection and lessons learned to improve future predictions.

Respond with ONLY a JSON code block:
\`\`\`json
{
    "reflection": "Explain what happened, e.g., 'The token rugged at 6min when market cap dropped 20%, topHolderPercent fell from 30% to 10%, and OHLCV showed a sharp volume spike with a price drop.'",
    "lessonsLearned": ["lesson1", "lesson2"]
}
\`\`\`

---

### Original Token Data (Initial State)
{{tokenData}}

---

### Initial Prediction
{{initialPrediction}}

---

### Actual Results (Checks with Market, Distribution, Bundle, and OHLCV Data)
{{actualResults}}

---

### Recent Twitter Activity
{{tweets}}

---

### OHLCV Data (Last Hour, Initial)
{{ohlcv}}

---

### Historical Context
{{pastPredictions}}
Historical Accuracy: {{historicalAccuracy}}% ({{predictionCount}} predictions, avg MAPE: {{avgMape}}%).

---

### Guidelines
- Compare initial tokenData with each check's marketData (e.g., holders, volume1hUSD), distribution (topHolderPercent), bundleData (currentHeldPercentage), and ohlcv (price/volume trends).
- Detect rug pulls: Look for >5% drops in marketCap or topHolderPercent, or sharp OHLCV price drops with volume spikes.
- Assess momentum: Use marketData.volume1hUSD, uniqueTraders1h, and ohlcv volume trends (v) alongside closing prices (c).
- Highlight bundle changes: Increases/decreases in currentHeldPercentage may signal buying/dumping.
---
`;