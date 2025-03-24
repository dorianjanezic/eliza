# Token Prediction Strategy

## BUY Strategy
- **Condition**: True if the maximum market cap (highest of all steps) is greater than or equal to 85% of the 10-minute predicted market cap.
- **Focus**: Only considers the peak versus the 10-minute goal, ignoring earlier steps' performance.

# Checks
OHLCV data can be called once at the end of all checks

# Fetching summaries
Can be done by latest and by memory embedding

## IGNORE Strategy
- **Condition**: True if the final market cap (10-minute actual) is less than or equal to 115% of the initial market cap.
- **Focus**: Only checks the endgame, indicating stagnation or decline by the 10-minute mark.

## GetRecentSummaries
- **Task**: Search for similar embeddings.

## Proposed RL Integration

### 1. RL Agent
- **Purpose**: Replace or augment the LLM-based `predictToken` with an RL agent that learns from trading simulations.
- **Implementation**:
  - Use a Deep RL framework like Stable-Baselines3 (Python) or a TypeScript equivalent (e.g., reinforce-js or custom-built).
  - Define the agent as a class, e.g., `TokenTradingAgent`, that interacts with your `PredictionService` and providers.

#### State Space
- Market data (price, volume, holders, trades).
- OHLCV trends (last hour's candles).
- Token distribution (topHolderPercent, suspiciousDistribution).
- Bundle data (totalBundles, currentHeldPercentage).
- Twitter sentiment (summarized, e.g., via Claude API).
- Historical accuracy/MAPE from `LearningService`.

#### Action Space
- Simple discrete actions:
  - `0`: IGNORE (do nothing).
  - `1`: BUY (enter a position).

#### Policy
- Start with a Q-learning or DQN (Deep Q-Network) approach, where the agent learns a value function for each state-action pair.

### 2. Reward System (Trading Simulation)
- **Concept**: Simulate a trading position for each token prediction to calculate rewards based on profit/loss.
- **Implementation**:
  - Add a `TradingSimulator` class that:
    - Takes an action (BUY/IGNORE) from the RL agent.
    - Simulates a trade using historical or real-time OHLCV data.
    - Calculates profit/loss over a 10-minute window (your current prediction horizon).

#### Reward Function
- **BUY**:
  - If market cap increases by >5% within 10 minutes: `reward = profit_percentage * 100` (e.g., +10 for 10% gain).
  - If market cap drops >5% (rug pull): `reward = -loss_percentage * 100` (e.g., -20 for 20% loss).
  - Small penalty for holding without significant change: `reward = -1` (encourages decisive outcomes).
- **IGNORE**:
  - If market cap increases >5%: `reward = -5` (missed opportunity).
  - If market cap drops >5% or stays flat: `reward = +5` (correct avoidance).
- **Normalization**: Cap rewards (e.g., -100 to +100) to stabilize learning.

#### Simulation Details
- Use `MarketDataProvider.getTokenOHLCVData` to fetch 1-minute candles for the last 10 minutes (post-action).
- Assume a fixed position size (e.g., 1 SOL worth of tokens at entry price).
- Exit position at the 10-minute mark or earlier if a rug pull is detected (e.g., >5% drop in one candle).

### 3. Environment
- **Class**: `TokenTradingEnv`
- **Structure**:
  - **Reset**: Start with a new token update from `TokenMigrationProvider`.
  - **Step**:
    - Agent chooses BUY/IGNORE.
    - Simulator runs the trade for 10 minutes (or until rug pull).
    - Returns new state (updated market data, OHLCV, etc.), reward, and done flag.
- **State**: Combines all provider data into a feature vector (e.g., normalize values to 0-1).
- **Integration**: Hook into `PredictionService.scheduleChecks` to use real check data as simulation steps.

### 4. Learning Loop
- **Training**:
  - **Offline**: Use historical token data from `LearningService` to replay past predictions and simulate trades.
  - **Online**: Process live `tokenUpdate` events, simulate trades, and update the agent's policy.
- **Update**:
  - For Q-learning: Update Q-values based on `reward + γ * max(Q(next_state))`.
  - For DQN: Use a neural network (e.g., TensorFlow.js in TypeScript) to approximate Q-values, trained on experience replay (store state, action, reward, next_state tuples).
- **Storage**: Save the agent's model periodically (e.g., weights in a file or database).

### 5. Claude API Integration
- **Role**: Use Claude (via API) to enhance state or reward interpretation, not as the RL agent itself.
- **Options**:
  - **Sentiment Analysis**: Replace `TwitterSentimentProvider`'s raw tweet formatting with a Claude prompt:
    - Analyze these tweets about a token and return a sentiment score (0-1, 1 being positive): `{tweets}`
    - Add this score to the RL state.
  - **Reasoning Augmentation**: Pass the RL agent's state to Claude for a qualitative analysis (e.g., "Is this token risky?"), parsed into risk factors for the state.
  - **Reward Shaping**: Ask Claude to evaluate check data for rug pull signals (e.g., "Did this token rug based on market cap and distribution?") to refine rewards.

  References:

  https://engineering.fb.com/2018/11/01/ml-applications/horizon/

  https://arxiv.org/ftp/arxiv/papers/1803/1803.03916.pdf

  https://github.com/karpathy/reinforcejs?tab=readme-ov-file

  https://medium.com/coinmonks/deep-reinforcement-learning-for-trading-cryptocurrencies-5b5502b1ece1

  https://github.com/NickKaparinos/Automated-Cryptocurrency-trading-using-Deep-RL


Data features

- moonshot listing
- DEX paid



