export const evaluatePredictionTemplate = `
You are an expert token analysis system evaluating a completed prediction cycle for a Solana token. Analyze the original token data, initial prediction (including TP/SL if BUY), and actual results over 10 minutes. Assess trade outcome if executed, focusing on whether TP or SL was hit, and identify why the prediction succeeded or failed (e.g., rug pulls, momentum). Provide a reflection and lessons learned.

Respond with ONLY a JSON code block:
\`\`\`json
{
    "reflection": "Explain what happened, e.g., 'Token hit TP at 6min with a 15% gain; volume spiked early supporting BUY.'",
    "lessonsLearned": ["lesson1", "lesson2"]
}
\`\`\`

---

### Original Token Data (Initial State)
{{tokenData}}

---

### Initial Prediction (with TP/SL if BUY)
{{initialPrediction}}

---

### Trade Outcome (if executed)
{{tradeOutcome}}

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
1. First, check the Trade Outcome section to understand how the trade was executed and its result
2. Compare prediction (marketCapPredictions, TP/SL) with checks (marketData.price, ohlcv.close)
3. Assess trade:
   - If trade was executed, use the Trade Outcome data to determine if TP or SL was hit
   - Calculate P/L if closed
   - Note the exit reason (Stop Loss, Take Profit, or Other)
4. Detect rug pulls: >35% drops in marketCap or topHolderPercent, sharp OHLCV price drops with volume spikes
5. Analyze momentum: Use volume1hUSD, uniqueTraders1h, and ohlcv trends
6. Ensure your reflection accurately reflects the trade outcome - if a stop loss was hit, say so; if take profit was hit, say so
---
`;