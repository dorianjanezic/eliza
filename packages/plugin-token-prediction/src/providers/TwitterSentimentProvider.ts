// File: /packages/plugin-token-prediction/src/providers/TwitterSentimentProvider.ts

import { EventEmitter } from 'events';
import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import { TwitterSearchClient } from '@ai16z/client-twitter';
import type { TokenData } from '../types';
const { SearchMode } = require('agent-twitter-client') as { SearchMode: any };

export class TwitterSentimentProvider extends EventEmitter {
    private twitterClient: TwitterSearchClient;
    private runtime: IAgentRuntime;
    private initialized: boolean = false;

    constructor(runtime: IAgentRuntime) {
      super();
      this.runtime = runtime;
      this.twitterClient = new TwitterSearchClient(runtime);
    }

    public async initialize(): Promise<void> {
      if (this.initialized) return;
      try {
        await this.twitterClient.init();
        this.initialized = true;
        elizaLogger.info('TwitterSentimentProvider initialized successfully');
      } catch (error) {
        elizaLogger.error('Failed to initialize Twitter client:', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    }

    public async getRecentTweetsForToken(tokenData: TokenData): Promise<string> {
      if (!this.initialized) {
        await this.initialize();
      }

      const query = `${tokenData.address} OR "${"$" + tokenData.symbol}" -is:retweet`;
      elizaLogger.info('Fetching X posts for token:', { tokenAddress: tokenData.address, query });

      try {
        const tweetResponse = await this.twitterClient.fetchSearchTweets(
          query,
          100, // Fetch up to 100 to ensure we get recent ones
          SearchMode.Latest
        );

        const tweets = tweetResponse.tweets || [];
        if (!tweets.length) {
          elizaLogger.info('No recent X posts found for token:', { tokenAddress: tokenData.address });
          return "No recent tweets available.";
        }

        // Sort by createdAt (newest first) and take top 10, then format as string
        const formattedTweets = tweets
          .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10)
          .map((tweet: any) => (
            `- Tweet ID: ${tweet.id}\n` +
            `  - Text: ${tweet.text}\n` +
            `  - Author: ${tweet.userId}\n` +
            `  - Date: ${tweet.createdAt}\n` +
            `  - Retweets: ${tweet.retweetCount || 0}\n` +
            `  - Likes: ${tweet.favoriteCount || 0}`
          ))
          .join('\n');

        // Log each tweet as before
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

        this.emit('tweetsFetched', { tokenData, tweets: formattedTweets });
        return formattedTweets;
      } catch (error) {
        elizaLogger.error('Failed to fetch tweets:', {
          tokenAddress: tokenData.address,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return "Error fetching tweets.";
      }
    }
  }

  export default TwitterSentimentProvider;