import { IAgentRuntime, elizaLogger } from '@ai16z/eliza';

interface TokenExtensions {
    coingeckoId?: string;
    serumV3Usdc?: string;
    serumV3Usdt?: string;
    website?: string;
    telegram?: string | null;
    twitter?: string;
    description?: string;
    discord?: string;
    medium?: string;
}

interface TokenOverviewResponse {
    data: {
        address: string;
        decimals: number;
        symbol: string;
        name: string;
        extensions: TokenExtensions;
        logoURI: string;
        liquidity: number;
        price: number;
        marketCap: number;
        holder: number;
        volume24h?: number;
        v24h: number;
        v24hUSD: number;
        priceChange24hPercent: number;
        totalSupply: number;
        circulatingSupply: number;
        v1h: number;
        priceChange1hPercent: number;
        uniqueWallet1h: number;
        trade1h: number;
    };
    success: boolean;
}

export interface TokenMarketData {
    price: number;
    marketCap: number;
    holderCount: number;
    volume1h: number;
    volume24h: number;
    priceChange1h: number;
    priceChange24h: number;
    uniqueTraders1h: number;
    trades1h: number;
}

export class BirdeyeClient {
    private runtime: IAgentRuntime;
    private baseUrl = 'https://public-api.birdeye.so';
    private apiKey: string;
    private retryCount = 3;
    private retryDelay = 1000; // 1 second

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
        this.apiKey = this.runtime.getSetting('BIRDEYE_API_KEY') || '';
        if (!this.apiKey) {
            elizaLogger.warn('BirdeyeClient initialized without API key');
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

    async getTokenData(tokenAddress: string): Promise<TokenMarketData> {
        elizaLogger.info('Fetching token data from Birdeye:', { tokenAddress });
        try {
            const options: RequestInit = {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    'x-chain': 'solana',
                    'x-api-key': this.apiKey,
                },
            };

            const response = await this.fetchWithRetry(
                `${this.baseUrl}/defi/token_overview?address=${tokenAddress}`,
                options
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json() as TokenOverviewResponse;
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