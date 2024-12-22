import { EventEmitter } from 'events';
import { TokenUpdate } from '../types';
import { IAgentRuntime, ModelClass, stringToUuid, generateText, composeContext, elizaLogger } from '@ai16z/eliza';

const tokenProcessingTemplate = `
# Token Processing Directive
Analyze the following token completion data and generate insights:

Token Details:
{{tokenData}}

# Task:
1. Analyze the token completion data
2. Generate a concise summary of the completion
3. Extract key metrics or insights
4. Identify any notable patterns or anomalies
5. Evaluate the following key metrics against standard thresholds:
   - Bundle max percent held (should be < 20%)
   - Bundle wallet holdings percentage (should be < 70%)
   - Currently held percentage of bots (should be < 20%)
   - Top 10 holders percentage (should be < 60%)
   - 24h volume (should be > 1000)
   - Name similarity (should be < 0.8)
   - Symbol similarity (should be < 0.8)
   - Total transactions (should be < 752)
   - Hours since inception (should be > 0.3)
   - Dev token percentage (should be <= 10%)
   - Dev wallet buy volume (should be <= 10)
   - Neutral holdings percentage (should be >= 50%)
   - New holdings percentage (should be <= 20%)
   - Bundle total holdings percentage (should be <= 20%)
   - Raydium holders percentage (should be <= 50%)
   - OG holders percentage (should be >= 40%)

Format your response as JSON with the following structure:
{
    "summary": "Brief summary of the completion",
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
        "og_holders_percentage": number
    },
    "insights": ["insight1", "insight2"],
    "patterns": ["pattern1", "pattern2"],
    "risk_assessment": {
        "high_risk_factors": [],
        "medium_risk_factors": [],
        "low_risk_factors": []
    }
}
`;

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
        elizaLogger.info(`Processing token update for ID: ${tokenId}`, {
            record: update.record,
            timestamp: update.timestamp
        });

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
            elizaLogger.info(`Generating analysis for token ${tokenId}`);
            const context = composeContext({
                state,
                template: tokenProcessingTemplate,
            });


            const analysisResponse = await generateText({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.MEDIUM,
            });
            console.log(analysisResponse);

            // Parse and validate the LLM response
            let analysis;
            try {
                // More flexible regex that handles variations in whitespace and formatting
                const jsonMatch = analysisResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                const jsonString = jsonMatch ? jsonMatch[1] : analysisResponse;
                analysis = JSON.parse(jsonString);

                // Validate required fields
                if (!analysis.summary || !analysis.metrics || !analysis.insights || !analysis.patterns) {
                    throw new Error('Invalid analysis format: missing required fields');
                }
            } catch (error: any) {
                throw new Error(`Failed to parse LLM response: ${error?.message || 'Unknown error'}`);
            }

            // Create memory entry
            const memoryId = stringToUuid(`token-${tokenId}-analysis`);
            elizaLogger.info(`Creating memory entry for token ${tokenId}`);

            try {
                await this.runtime.messageManager.createMemory({
                    id: memoryId,
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: analysis.summary,
                        metadata: {
                            metrics: analysis.metrics,
                            insights: analysis.insights,
                            patterns: analysis.patterns,
                            originalToken: update.record,
                        },
                        source: "token_processing",
                    },
                    roomId,
                    createdAt: new Date(update.timestamp).getTime(),
                });
            } catch (error: any) {
                throw new Error(`Failed to create memory entry: ${error?.message || 'Unknown error'}`);
            }

            elizaLogger.info('Token processing complete:', {
                tokenId: tokenId,
                memoryId: memoryId,
                summary: analysis.summary,
            });

            // Emit success event
            this.emit('processingComplete', {
                tokenId,
                memoryId,
                success: true
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