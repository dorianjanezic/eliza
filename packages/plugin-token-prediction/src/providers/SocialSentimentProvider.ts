// File: /packages/plugin-token-prediction/src/providers/SocialSentimentProvider.ts

import { EventEmitter } from 'events';
import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import axios from 'axios';
import type { TokenData } from '../types';

export class SocialSentimentProvider extends EventEmitter {
    private apiKey: string;
    private baseUrl = 'https://api.twitter.com/2'; // Using twitter.com domain as per current X API
    private maxTweets = 3; // Max results per API call

    constructor(private runtime: IAgentRuntime) {
        super();
        this.apiKey = this.runtime.getSetting('X_API_KEY') || '';
        if (!this.apiKey) {
            elizaLogger.warn('SocialSentimentProvider initialized without X API key');
        }
    }

    private async fetchTweets(query: string): Promise<any[]> {
        try {
            const response = await axios.get(`${this.baseUrl}/tweets/search/recent`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                params: {
                    query: `${query} -is:retweet`, // Exclude retweets
                    max_results: this.maxTweets,
                    tweet_fields: 'text,author_id,created_at,public_metrics',
                },
            });
            const tweets = response.data.data || [];
            return tweets;
        } catch (error) {
            elizaLogger.error('Failed to fetch X posts:', {
                error: error instanceof Error ? error.message : 'Unknown error',
                query,
            });
            return [];
        }
    }

    public async logTweetsForToken(tokenData: TokenData): Promise<void> {
        const query = `${tokenData.symbol} OR ${tokenData.address} OR "${tokenData.name}"`;
        elizaLogger.info('Fetching X posts for token:', { tokenId: tokenData.tokenId, query });

        const tweets = await this.fetchTweets(query);
        if (!tweets.length) {
            elizaLogger.info('No recent X posts found for token:', { tokenId: tokenData.tokenId });
            return;
        }

        tweets.forEach((tweet) => {
            elizaLogger.info('X post:', {
                tokenId: tokenData.tokenId,
                text: tweet.text,
                authorId: tweet.author_id,
                createdAt: tweet.created_at,
                metrics: tweet.public_metrics,
            });
        });

        this.emit('tweetsFetched', { tokenData, tweets });
    }
}

export default SocialSentimentProvider;