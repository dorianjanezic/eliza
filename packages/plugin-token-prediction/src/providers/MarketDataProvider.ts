import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import type { MarketData, OHLCVData } from '../types';

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

    async getTokenOHLCVData(
        tokenAddress: string,
        timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
        timeFrom: number,
        timeTo: number
    ): Promise<OHLCVData[]> {
        elizaLogger.info('Fetching OHLCV data from Birdeye:', { tokenAddress, timeframe, timeFrom, timeTo });
        try {
            const params = new URLSearchParams({
                address: tokenAddress,
                type: timeframe,
                currency: 'usd',
                time_from: timeFrom.toString(),
                time_to: timeTo.toString(),
            });
            const url = `${this.baseUrl}/defi/ohlcv?${params.toString()}`;
            const options: RequestInit = {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    'x-chain': 'solana',
                    'X-API-KEY': this.apiKey,
                },
            };

            const response = await this.fetchWithRetry(url, options);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const data = await response.json();
            if (!data.success || !data.data || !Array.isArray(data.data.items)) {
                throw new Error('Invalid OHLCV response from Birdeye API');
            }

            const ohlcvData: OHLCVData[] = data.data.items.map((item: any) => ({
                timestamp: item.unixTime,
                open: item.o,
                high: item.h,
                low: item.l,
                close: item.c,
                volume: item.v,
            }));

            elizaLogger.info('Successfully fetched OHLCV data:', {
                tokenAddress,
                candleCount: ohlcvData.length,
                latestClose: ohlcvData[ohlcvData.length - 1]?.close,
            });
            return ohlcvData;
        } catch (error) {
            elizaLogger.error('Birdeye OHLCV API error:', {
                tokenAddress,
                timeframe,
                timeFrom,
                timeTo,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
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

            // elizaLogger.success('Successfully fetched token data:', { tokenAddress, marketCap: data.data.marketCap });
            return {
                price: data.data.price,
                symbol: data.data.symbol,
                marketCap: data.data.marketCap,
                holderCount: data.data.holder,
                volume1hUSD: data.data.v1hUSD,
                volume24hUSD: data.data.v24hUSD,
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