import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import type { MarketData } from '../types';

export class MarketDataProvider {
    private baseUrl: string;
    private apiKey: string;
    private retryCount = 3;
    private retryDelay = 1000; // 1 second

    constructor(private runtime: IAgentRuntime) {
        this.apiKey = this.runtime.getSetting('BIRDEYE_API_KEY') || '';
        this.baseUrl = 'https://public-api.birdeye.so';

        if (!this.apiKey) {
            elizaLogger.warn('MarketDataProvider initialized without API key');
        }
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async fetchWithRetry(url: string, options: RequestInit, attempts: number = 0): Promise<Response> {
        try {
            const response = await fetch(url, options);

            if (response.status === 429 && attempts < this.retryCount) {
                elizaLogger.warn('Rate limited by Birdeye API, retrying...', {
                    attempt: attempts + 1,
                    maxAttempts: this.retryCount,
                });
                await this.delay(this.retryDelay * Math.pow(2, attempts));
                return this.fetchWithRetry(url, options, attempts + 1);
            }

            return response;
        } catch (error) {
            if (attempts < this.retryCount) {
                elizaLogger.warn('Birdeye API request failed, retrying...', {
                    attempt: attempts + 1,
                    maxAttempts: this.retryCount,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
                await this.delay(this.retryDelay * Math.pow(2, attempts));
                return this.fetchWithRetry(url, options, attempts + 1);
            }
            throw error;
        }
    }

    async getTokenMarketData(tokenAddress: string): Promise<MarketData> {
        elizaLogger.info('Fetching token data from Birdeye:', { tokenAddress });
        try {
            const options: RequestInit = {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    'x-chain': 'solana',
                    'X-API-KEY': this.apiKey,
                },
            };

            const url = `${this.baseUrl}/defi/token_overview?address=${tokenAddress}`;
            elizaLogger.debug("Birdeye API request URL:", { url }); // Log exact URL

            const response = await this.fetchWithRetry(
                `${this.baseUrl}/defi/token_overview?address=${tokenAddress}`,
                options
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const data = await response.json();
            if (!data.success || !data.data) {
                throw new Error('Invalid response from Birdeye API');
            }

            elizaLogger.success('Successfully fetched token data:', { tokenAddress, marketCap: data.data.marketCap });
            return {
                price: data.data.price,
                marketCap: data.data.marketCap,
                holderCount: data.data.holder,
                volume1h: data.data.v1h,
                volume24h: data.data.v24h,
                priceChange1h: data.data.priceChange1hPercent,
                priceChange24h: data.data.priceChange24hPercent,
                uniqueTraders1h: data.data.uniqueWallet1h,
                trades1h: data.data.trade1h,
            };
        } catch (error) {
            elizaLogger.error('Birdeye API error:', {
                tokenAddress,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
        }
    }
}