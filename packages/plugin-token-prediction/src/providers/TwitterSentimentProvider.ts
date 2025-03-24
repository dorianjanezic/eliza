import { EventEmitter } from 'events';
import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import { TwitterSearchClient } from '@ai16z/client-twitter';
import type { TokenData } from '../types';
import { logger } from '../utils/logger';
// Importing SearchMode from agent-twitter-client (assumes it's part of the package)
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
            const initTimer = logger.performance.start('twitter_client_init');
            await this.twitterClient.init(); // Set up client (e.g., auth, config)
            this.initialized = true;
            initTimer.end();

            // Use custom categories from our logger
            logger.plugin.initialized();
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            logger.plugin.error(err);
            throw error; // Rethrow to let caller handle initialization failure
        }
    }

    // Fetches recent tweets for a token based on address or symbol
    public async getRecentTweetsForToken(tokenData: TokenData): Promise<string> {
        const tokenId = tokenData.tokenId || tokenData.address.substring(0, 8);

        if (!this.initialized) {
            await this.initialize(); // Ensure client is ready
        }

        // Build query: search for token address or $symbol, exclude retweets
        const query = `${tokenData.address} OR "${"$" + tokenData.symbol}" -is:retweet`;
        logger.api.request('twitter_search', {
            tokenId,
            query
        });

        try {
            // Start performance timer
            const fetchTimer = logger.performance.start('twitter_fetch', tokenId);

            // Fetch up to 100 recent tweets using TwitterSearchClient
            const tweetResponse = await this.twitterClient.fetchSearchTweets(
                query,
                100, // Max tweets to fetch
                SearchMode.Latest // Fetch latest tweets first
            );

            const tweets = tweetResponse.tweets || [];

            // Log performance stats
            fetchTimer.end({
                tweetsFound: tweets.length
            });

            if (!tweets.length) {
                logger.market.received(tokenId, tokenData.address, 'twitter', {
                    status: 'no_tweets_found'
                });
                return "No recent tweets available."; // Return fallback message
            }

            // Format the 10 most recent tweets (sorted by date descending)
            const recentTweets = tweets
                .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 10); // Take top 10

            const formattedTweets = recentTweets.map((tweet: any) => (
                `- Tweet ID: ${tweet.id}\n` +
                `  - Text: ${tweet.text}\n` +
                `  - Author: ${tweet.userId}\n` + // Note: userId instead of username
                `  - Date: ${tweet.createdAt}\n` +
                `  - Retweets: ${tweet.retweetCount || 0}\n` +
                `  - Likes: ${tweet.favoriteCount || 0}`
            )).join('\n');

            // Get engagement metrics for analysis
            const totalLikes = recentTweets.reduce((sum: number, tweet: any) => sum + (tweet.favoriteCount || 0), 0);
            const totalRetweets = recentTweets.reduce((sum: number, tweet: any) => sum + (tweet.retweetCount || 0), 0);
            const avgLikes = totalLikes / recentTweets.length;
            const avgRetweets = totalRetweets / recentTweets.length;

            // Get the most recent tweet's date (using any type to avoid linter errors with property access)
            const mostRecentTweet: any = recentTweets[0] || {};
            const mostRecentTweetTime = mostRecentTweet.createdAt ?
                new Date(mostRecentTweet.createdAt).getTime() :
                Date.now();
            const timeSinceLatestTweet = Date.now() - mostRecentTweetTime;
            const hoursSinceLatestTweet = timeSinceLatestTweet / (1000 * 60 * 60);

            // Log twitter data for analysis
            logger.market.received(tokenId, tokenData.address, 'twitter', {
                tweetCount: recentTweets.length,
                totalLikes,
                totalRetweets,
                avgLikes,
                avgRetweets,
                hoursSinceLatestTweet: hoursSinceLatestTweet.toFixed(1)
            });

            // Check for suspiciously high engagement metrics
            if (avgLikes > 1000 || avgRetweets > 500) {
                logger.market.suspicious(tokenId, tokenData.address, 'Unusually high Twitter engagement', {
                    avgLikes,
                    avgRetweets,
                    totalTweets: recentTweets.length
                });
            }

            // Emit event with fetched tweets for downstream listeners
            this.emit('tweetsFetched', { tokenData, tweets: formattedTweets });
            return formattedTweets; // Return formatted string for use in prediction
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            logger.market.error(tokenId, tokenData.address, 'twitter', err);
            return "Error fetching tweets."; // Return error message as fallback
        }
    }
}

export default TwitterSentimentProvider;