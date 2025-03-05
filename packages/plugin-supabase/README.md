# @ai16z/plugin-supabase

A plugin for monitoring and analyzing token migrations on Solana using Supabase real-time capabilities and BirdEye API.

## Overview

This plugin provides real-time monitoring and analysis of token migrations on Solana blockchain. It connects to Supabase for real-time updates, processes token data through BirdEye API, and maintains a learning system to track and improve prediction accuracy.

## Key Features

### Real-time Token Monitoring
- Connects to Supabase via WebSocket for real-time token migration updates
- Handles automatic reconnection and heartbeat maintenance
- Prevents duplicate processing of tokens

### Token Analysis
- Analyzes token metrics including:
  - Market cap
  - Holder count
  - Trading volume
  - Unique traders
- Makes trading decisions (BUY/IGNORE) based on:
  - Volume thresholds (>300 SOL in 1h)
  - Market cap growth potential (>20%)
  - Holder distribution patterns
  - Historical performance

### Performance Tracking
- Monitors prediction accuracy over time
- Tracks actual market performance against predictions
- Maintains historical records of:
  - Trading decisions
  - Price movements
  - Success rates
  - Confidence levels

### Learning System
- Updates prediction models based on historical accuracy
- Tracks performance metrics:
  - Total predictions
  - Successful predictions
  - Average confidence
  - Average error rate

## Components

### TokenUpdateClient
- Manages WebSocket connection to Supabase
- Handles real-time token migration events
- Ensures reliable message delivery

### TokenProcessingClient
- Processes token updates
- Generates trading decisions
- Manages prediction lifecycle

### TokenLearningManager
- Tracks prediction accuracy
- Updates performance metrics
- Schedules follow-up checks

### BirdeyeClient
- Fetches real-time token data
- Provides market metrics
- Handles API rate limiting

## Configuration

Required environment variables:


How to Make It More Recursive?
To enhance the recursive learning aspect, consider these upgrades:
Explicit Accuracy Tracking:
Add a method in TokenLearningManager to calculate aggregate accuracy (e.g., % of correct predictions) from all summaries.

Feed this into the template (e.g., "Historical Accuracy: 75%") to adjust confidence dynamically.

Adjust Guidelines:
Analyze summaries to refine rules (e.g., if many BUYs fail at volume < 400 SOL, raise the threshold).

Example: After 10 tokens, if volume_1h > 350 SOL yields 80% success vs. 60% for 300 SOL, update the template.

Fine-Tune the LLM:
Periodically retrain the LLM on a dataset of { tokenData, pastSummaries, actualOutcome } pairs to improve its prediction logic.

Requires storing more data and integrating with xAI’s model training pipeline.

Adaptive Confidence:
Adjust confidence based on how similar the current token is to past successes (e.g., using embeddings, though we moved to recency).

Example: If recent BUYs succeeded 9/10 times, boost confidence for similar conditions.



To make the system truly advanced, combine these strategies:

Use dynamic factor weights to prioritize predictive metrics.

Maintain a recursive model state for growth and confidence adjustments.

Cluster tokens for pattern-specific predictions.

Integrate external sentiment data for context.

Optimize confidence thresholds for better decision-making.


