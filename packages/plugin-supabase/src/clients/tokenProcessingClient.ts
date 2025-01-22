import { EventEmitter } from 'events';
import { TokenUpdate } from '../types';
import { IAgentRuntime, ModelClass, stringToUuid, generateText, composeContext, elizaLogger } from '@ai16z/eliza';

const tokenProcessingTemplate = `
# Token Processing Directive
Analyze the following token completion data and generate insights:

Token Details:
{{tokenData}}

Knowledge Context:
{{knowledge}}

# Task:
1. Analyze token data against your knowledge base patterns and success metrics
2. Generate comprehensive token analysis including:
   - Token fundamentals and metrics evaluation
   - Holder distribution and behavior patterns
   - Trading volume and liquidity analysis
   - Developer wallet activity assessment
   - Risk factor identification
   - Trading recommendation with confidence level

3. Evaluate key metrics against proven thresholds:
   - Bundle max percent held (< 20%)
   - Bundle wallet holdings percentage (< 70%)
   - Currently held percentage of bots (< 20%)
   - Top 10 holders percentage (< 60%)
   - 24h volume (> 1000)
   - Name similarity (< 0.8)
   - Symbol similarity (< 0.8)
   - Total transactions (< 752)
   - Hours since inception (> 0.3)
   - Dev token percentage (<= 10%)
   - Dev wallet buy volume (<= 10)
   - Neutral holdings percentage (>= 50%)
   - New holdings percentage (<= 20%)
   - Bundle total holdings percentage (<= 20%)
   - Raydium holders percentage (<= 50%)
   - OG holders percentage (>= 40%)
   - Market cap ($20,000-$200,000 optimal range)

4. Calculate price predictions and risk levels based on:
   - Current market cap vs historical success ranges
   - Holder distribution patterns
   - Trading volume trends
   - Developer wallet behavior
   - Community engagement metrics

Format your response as JSON with the following structure:
{
    "contract_address": "Token contract/mint address",
    "symbol": "Token symbol",
    "name": "Token name",
    "summary": {
        "overview": "Comprehensive token overview",
        "holder_analysis": "Distribution and behavior patterns",
        "trading_patterns": "Volume and price action analysis",
        "community_metrics": "Engagement and sentiment analysis",
        "risk_factors": "Key risk considerations"
    },
    "metrics": {
        "bundle_max_percent_held": number,
        "bundle_wallet_holdings_percentage": number,
        "currently_held_percentage_of_bots": number,
        "top_10_holders_percentage": number,
        "volume_24h": number,
        "name_similarity": number,
        "symbol_similarity": number,
        "total_transactions": number,
        "hours_since_inception": number,
        "dev_token_percentage": number,
        "dev_wallet_buy_volume": number,
        "neutral_holdings_percentage": number,
        "new_holdings_percentage": number,
        "bundle_total_holdings_percentage": number,
        "raydium_holders_percentage": number,
        "og_holders_percentage": number,
        "market_cap": number,
        "current_price_usd": number,
        "liquidity_usd": number
    },
    "trading_recommendation": {
        "decision": "BUY" | "IGNORE",
        "confidence": number, // 0-1 scale
        "reasoning": string[],
        "suggested_position_size": {
            "conservative": number, // USD value
            "moderate": number,
            "aggressive": number
        }
    },
    "price_predictions": {
        "take_profit_levels": [
            {
                "level": number,
                "mcap_percentage": number, // % increase from current mcap
                "target_mcap": number,
                "probability": number,
                "timeframe_minutes": number,
                "description": string,
                "risk_rating": "LOW" | "MEDIUM" | "HIGH",
                "suggested_exit_size": number // % of position to exit
            }
        ],
        "stop_loss_levels": [
            {
                "level": number,
                "mcap_percentage": number, // % decrease from current mcap
                "target_mcap": number,
                "risk_rating": "LOW" | "MEDIUM" | "HIGH",
                "probability": number,
                "timeframe_minutes": number,
                "description": string,
                "suggested_exit_size": number // % of position to exit
            }
        ]
    },
    "risk_assessment": {
        "high_risk_factors": string[],
        "medium_risk_factors": string[],
        "low_risk_factors": string[],
        "overall_risk_rating": "LOW" | "MEDIUM" | "HIGH",
        "risk_score": number, // 0-100
        "validation_checks": {
            "liquidity_check": boolean,
            "holder_distribution_check": boolean,
            "dev_behavior_check": boolean,
            "market_cap_check": boolean,
            "trading_volume_check": boolean
        }
    },
    "historical_pattern_match": {
        "similar_tokens": string[],
        "pattern_confidence": number,
        "expected_trajectory": string,
        "key_similarities": string[]
    }
}`;

export class TokenProcessingClient extends EventEmitter {
    private runtime: IAgentRuntime;
    private processingTokens: Set<string>;

    constructor(runtime: IAgentRuntime) {
        super();
        this.runtime = runtime;
        this.processingTokens = new Set();
    }

    async processTokenUpdate(update: TokenUpdate) {
        if (!update?.record?.token_id) {
            elizaLogger.error('Invalid token update: missing token ID', update);
            return;
        }

        const tokenId = update.record.token_id;
        // elizaLogger.info(`Processing token update for ID: ${tokenId}`, {
        //     record: update.record,
        //     timestamp: update.timestamp
        // });

        if (this.processingTokens.has(tokenId)) {
            elizaLogger.warn(`Token ${tokenId} is already being processed`);
            return;
        }

        this.processingTokens.add(tokenId);

        try {
            elizaLogger.info(`Starting processing for token ${tokenId}`);
            const roomId = stringToUuid(`token-${tokenId}`);

            // Ensure room exists for this token
            await this.runtime.ensureRoomExists(roomId);
            await this.runtime.ensureParticipantInRoom(this.runtime.agentId, roomId);

            // Format token data for processing
            const tokenData = JSON.stringify(update, null, 2);

            // Compose state for LLM processing
            const state = await this.runtime.composeState(
                {
                    userId: this.runtime.agentId,
                    roomId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: tokenData,
                        action: "PROCESS_TOKEN",
                    },
                },
                {
                    tokenData,
                }
            );

            // Generate analysis using LLM
            const context = composeContext({
                state,
                template: tokenProcessingTemplate,
            });

            const analysisResponse = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.LARGE,
            });
            // console.log(analysisResponse);

            // Parse and validate the LLM response
            let analysis;
            console.log("analysisResponse", analysisResponse);
            try {
                const jsonMatch = analysisResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                const jsonString = jsonMatch ? jsonMatch[1] : analysisResponse;
                analysis = JSON.parse(jsonString);

                // Validate required fields
                if (!analysis.contract_address || !analysis.symbol || !analysis.name ||
                    !analysis.summary?.overview || !analysis.metrics ||
                    !analysis.trading_recommendation?.decision ||
                    !analysis.risk_assessment?.overall_risk_rating) {
                    throw new Error('Invalid analysis format: missing required fields');
                }

                // Validate trading recommendation
                if (!['BUY', 'IGNORE'].includes(analysis.trading_recommendation.decision)) {
                    throw new Error('Invalid trading decision');
                }

                if (typeof analysis.trading_recommendation.confidence !== 'number' ||
                    analysis.trading_recommendation.confidence < 0 ||
                    analysis.trading_recommendation.confidence > 1) {
                    throw new Error('Trading confidence must be between 0 and 1');
                }

                // Validate risk assessment
                if (!['LOW', 'MEDIUM', 'HIGH'].includes(analysis.risk_assessment.overall_risk_rating)) {
                    throw new Error('Invalid risk rating');
                }

                if (typeof analysis.risk_assessment.risk_score !== 'number' ||
                    analysis.risk_assessment.risk_score < 0 ||
                    analysis.risk_assessment.risk_score > 100) {
                    throw new Error('Risk score must be between 0 and 100');
                }

                // Validate price predictions
                if (analysis.price_predictions?.take_profit_levels) {
                    for (const level of analysis.price_predictions.take_profit_levels) {
                        if (!level.mcap_percentage || !level.target_mcap ||
                            !level.probability || level.probability < 0 || level.probability > 1 ||
                            !level.timeframe_minutes || level.timeframe_minutes <= 0) {
                            throw new Error('Invalid take profit level format');
                        }
                    }
                }

                if (analysis.price_predictions?.stop_loss_levels) {
                    for (const level of analysis.price_predictions.stop_loss_levels) {
                        if (typeof level.mcap_percentage !== 'number' ||
                            typeof level.target_mcap !== 'number' ||
                            typeof level.probability !== 'number' || level.probability < 0 || level.probability > 1 ||
                            typeof level.timeframe_minutes !== 'number' || level.timeframe_minutes <= 0) {
                            throw new Error('Invalid stop loss level format');
                        }
                    }
                }
            } catch (error: any) {
                throw new Error(`Failed to parse LLM response: ${error?.message || 'Unknown error'}`);
            }

            // Create memory entries for both rooms
            const tokenRoomId = stringToUuid(`token-${tokenId}`);
            const discordRoomId = "b5bac0cd-22dc-058a-bdb2-1d301305481e" as `${string}-${string}-${string}-${string}-${string}`;
            const telegramRoomId = "dedf5c0f-3644-0d90-8a40-2e2f29963dfe" as `${string}-${string}-${string}-${string}-${string}`;

            // Enhanced memory content structure including price predictions
            const baseMemory = {
                userId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: {
                    text: `Token Analysis Summary\n\n` +
                          `Name: ${analysis.name}\n` +
                          `Symbol: ${analysis.symbol}\n` +
                          `Contract: ${analysis.contract_address}\n\n` +
                          `Overview:\n${analysis.summary.overview}\n\n` +
                          `Holder Analysis:\n${analysis.summary.holder_analysis}\n\n` +
                          `Trading Patterns:\n${analysis.summary.trading_patterns}\n\n` +
                          `Community Metrics:\n${analysis.summary.community_metrics}\n\n` +
                          `Risk Factors:\n${analysis.summary.risk_factors}\n\n` +
                          `Trading Recommendation:\n` +
                          `Decision: ${analysis.trading_recommendation.decision}\n` +
                          `Confidence: ${(analysis.trading_recommendation.confidence * 100).toFixed(2)}%\n` +
                          `Reasoning:\n${analysis.trading_recommendation.reasoning.join('\n')}\n\n` +
                          `Price Predictions:\n${JSON.stringify(analysis.price_predictions, null, 2)}\n\n` +
                          `Risk Assessment:\n${JSON.stringify(analysis.risk_assessment, null, 2)}\n\n` +
                          `Historical Pattern Match:\n${JSON.stringify(analysis.historical_pattern_match, null, 2)}`,
                    metadata: {
                        metrics: analysis.metrics,
                        trading_recommendation: analysis.trading_recommendation,
                        price_predictions: analysis.price_predictions,
                        risk_assessment: analysis.risk_assessment,
                        historical_pattern_match: analysis.historical_pattern_match,
                        originalToken: update.record,
                        contract_address: analysis.contract_address,
                        symbol: analysis.symbol,
                        name: analysis.name,
                        summary: analysis.summary
                    },
                },
                createdAt: new Date(update.timestamp).getTime(),
            };

            // Create memory for token room with embedding
            try {
                const tokenRoomMemory = {
                    ...baseMemory,
                    id: stringToUuid(`token-${tokenId}-analysis`),
                    roomId: tokenRoomId,
                };

                const memoryWithEmbedding = await this.runtime.messageManager.addEmbeddingToMemory(tokenRoomMemory);
                await this.runtime.messageManager.createMemory(memoryWithEmbedding);

                // Create memory for Discord channel with embedding
                const discordMemory = {
                    ...baseMemory,
                    id: stringToUuid(`token-${tokenId}-discord-analysis`),
                    roomId: discordRoomId,
                };

                const discordMemoryWithEmbedding = await this.runtime.messageManager.addEmbeddingToMemory(discordMemory);
                await this.runtime.messageManager.createMemory(discordMemoryWithEmbedding);
            } catch (error: any) {
                throw new Error(`Failed to create memory entries: ${error?.message || 'Unknown error'}`);
            }

            elizaLogger.info('Token processing complete:', {
                tokenId: tokenId,
                memoryId: stringToUuid(`token-${tokenId}-analysis`),
                summary: analysis.summary,
            });

            // Emit success event with enhanced data
            this.emit('processingComplete', {
                tokenId,
                memoryId: stringToUuid(`token-${tokenId}-analysis`),
                success: true,
            });

        } catch (error: any) {
            elizaLogger.error('Error processing token update:', {
                tokenId,
                error: error?.message || 'Unknown error',
                stack: error?.stack
            });

            // Emit error event
            this.emit('processingError', {
                tokenId,
                error: error?.message || 'Unknown error'
            });

        } finally {
            this.processingTokens.delete(tokenId);
        }
    }
}