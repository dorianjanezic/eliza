import { EventEmitter } from 'events';
import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import { TwitterSearchClient } from '@ai16z/client-twitter';
import type { TokenData } from '../types';
// Importing SearchMode from agent-twitter-client (assumes it’s part of the package)
const { SearchMode } = require('agent-twitter-client') as { SearchMode: any };

// Fetches recent tweets related to a token for sentiment analysis
export class TwitterSentimentProvider extends EventEmitter {
    private twitterClient: TwitterSearchClient; // Client for Twitter API interactions
    private runtime: IAgentRuntime; // Eliza runtime for settings and context
    private initialized: boolean = false; // Tracks initialization status

    constructor(runtime: IAgentRuntime) {
        super();
        this.runtime = runtime;
        // Initialize Twitter client with runtime for config/auth
        this.twitterClient = new TwitterSearchClient(runtime);
    }

    // Initializes the Twitter client if not already done
    public async initialize(): Promise<void> {
        if (this.initialized) return; // Skip if already initialized
        try {
            await this.twitterClient.init(); // Set up client (e.g., auth, config)
            this.initialized = true;
            elizaLogger.info('TwitterSentimentProvider initialized successfully');
        } catch (error) {
            elizaLogger.error('Failed to initialize Twitter client:', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error; // Rethrow to let caller handle initialization failure
        }
    }

    // Fetches recent tweets for a token based on address or symbol
    public async getRecentTweetsForToken(tokenData: TokenData): Promise<string> {
        if (!this.initialized) {
            await this.initialize(); // Ensure client is ready
        }

        // Build query: search for token address or $symbol, exclude retweets
        const query = `${tokenData.address} OR "${"$" + tokenData.symbol}" -is:retweet`;
        elizaLogger.info('Fetching X posts for token:', { tokenAddress: tokenData.address, query });

        try {
            // Fetch up to 100 recent tweets using TwitterSearchClient
            const tweetResponse = await this.twitterClient.fetchSearchTweets(
                query,
                100, // Max tweets to fetch
                SearchMode.Latest // Fetch latest tweets first
            );

            const tweets = tweetResponse.tweets || [];
            if (!tweets.length) {
                elizaLogger.info('No recent X posts found for token:', { tokenAddress: tokenData.address });
                return "No recent tweets available."; // Return fallback message
            }

            // Format the 10 most recent tweets (sorted by date descending)
            const formattedTweets = tweets
                .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 10) // Take top 10
                .map((tweet: any) => (
                    `- Tweet ID: ${tweet.id}\n` +
                    `  - Text: ${tweet.text}\n` +
                    `  - Author: ${tweet.userId}\n` + // Note: userId instead of username
                    `  - Date: ${tweet.createdAt}\n` +
                    `  - Retweets: ${tweet.retweetCount || 0}\n` +
                    `  - Likes: ${tweet.favoriteCount || 0}`
                ))
                .join('\n');

            // Log each tweet for debugging/monitoring
            tweets.slice(0, 10).forEach((tweet: any) => {
                elizaLogger.info('X post:', {
                    tokenAddress: tokenData.address,
                    id: tweet.id,
                    text: tweet.text,
                    authorId: tweet.userId,
                    createdAt: tweet.createdAt,
                    retweetCount: tweet.retweetCount || 0,
                    likeCount: tweet.favoriteCount || 0,
                });
            });

            // Emit event with fetched tweets for downstream listeners
            this.emit('tweetsFetched', { tokenData, tweets: formattedTweets });
            return formattedTweets; // Return formatted string for use in prediction
        } catch (error) {
            elizaLogger.error('Failed to fetch tweets:', {
                tokenAddress: tokenData.address,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            return "Error fetching tweets."; // Return error message as fallback
        }
    }
}

export default TwitterSentimentProvider;