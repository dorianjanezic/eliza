import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import type { MarketData, OHLCVData } from '../types';

// Provides market data and OHLCV data for tokens using the Birdeye API
export class MarketDataProvider {
    private baseUrl: string;
    private apiKey: string;
    private retryCount = 3; // Max retry attempts for failed API calls
    private retryDelay = 1000; // Base delay in ms between retries

    constructor(private runtime: IAgentRuntime) {
        // Fetch API key from runtime settings, default to empty string if missing
        this.apiKey = this.runtime.getSetting('BIRDEYE_API_KEY') || '';
        this.baseUrl = 'https://public-api.birdeye.so'; // Birdeye API endpoint

        // Warn if API key is not provided, as it’s required for authentication
        if (!this.apiKey) {
            elizaLogger.warn('MarketDataProvider initialized without API key');
        }
    }

    // Utility to pause execution for a given time (used in retries)
    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Fetches data with exponential backoff retry logic for rate limits or errors
    private async fetchWithRetry(url: string, options: RequestInit, attempts: number = 0): Promise<Response> {
        try {
            const response = await fetch(url, options);

            // Handle rate limiting (HTTP 429) with retries
            if (response.status === 429 && attempts < this.retryCount) {
                elizaLogger.warn('Rate limited by Birdeye API, retrying...', {
                    attempt: attempts + 1,
                    maxAttempts: this.retryCount,
                });
                // Exponential backoff: delay increases with each attempt (e.g., 1s, 2s, 4s)
                await this.delay(this.retryDelay * Math.pow(2, attempts));
                return this.fetchWithRetry(url, options, attempts + 1);
            }

            return response;
        } catch (error) {
            // Retry on network errors if attempts remain
            if (attempts < this.retryCount) {
                elizaLogger.warn('Birdeye API request failed, retrying...', {
                    attempt: attempts + 1,
                    maxAttempts: this.retryCount,
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
                await this.delay(this.retryDelay * Math.pow(2, attempts));
                return this.fetchWithRetry(url, options, attempts + 1);
            }
            // Throw error if retries are exhausted
            throw error;
        }
    }

    // Fetches OHLCV (Open, High, Low, Close, Volume) data for a token
    async getTokenOHLCVData(
        tokenAddress: string,
        timeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d', // Candle interval
        timeFrom: number, // Start time (Unix timestamp)
        timeTo: number // End time (Unix timestamp)
    ): Promise<OHLCVData[]> {
        // Log the request for debugging
        elizaLogger.info('Fetching OHLCV data from Birdeye:', { tokenAddress, timeframe, timeFrom, timeTo });
        try {
            // Build query parameters for the OHLCV endpoint
            const params = new URLSearchParams({
                address: tokenAddress,
                type: timeframe,
                currency: 'usd', // Prices in USD
                time_from: timeFrom.toString(),
                time_to: timeTo.toString(),
            });
            const url = `${this.baseUrl}/defi/ohlcv?${params.toString()}`;
            const options: RequestInit = {
                method: 'GET',
                headers: {
                    accept: 'application/json',
                    'x-chain': 'solana', // Specify Solana blockchain
                    'X-API-KEY': this.apiKey, // Authenticate with API key
                },
            };

            // Fetch data with retry logic
            const response = await this.fetchWithRetry(url, options);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const data = await response.json();
            // Validate response structure
            if (!data.success || !data.data || !Array.isArray(data.data.items)) {
                throw new Error('Invalid OHLCV response from Birdeye API');
            }

            // Map API response to OHLCVData type
            const ohlcvData: OHLCVData[] = data.data.items.map((item: any) => ({
                timestamp: item.unixTime, // Unix timestamp of candle
                open: item.o, // Opening price
                high: item.h, // Highest price
                low: item.l, // Lowest price
                close: item.c, // Closing price
                volume: item.v, // Trading volume
            }));

            // Log success with key details
            elizaLogger.info('Successfully fetched OHLCV data:', {
                tokenAddress,
                candleCount: ohlcvData.length,
                latestClose: ohlcvData[ohlcvData.length - 1]?.close, // Latest price for quick reference
            });
            return ohlcvData;
        } catch (error) {
            // Log detailed error and rethrow for caller to handle
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

    // Fetches current market data for a token
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
            elizaLogger.debug("Birdeye API request URL:", { url }); // Log URL for debugging

            // Fetch data with retry logic
            const response = await this.fetchWithRetry(url, options);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const data = await response.json();
            // Validate response structure
            if (!data.success || !data.data) {
                throw new Error('Invalid response from Birdeye API');
            }

            // Map API response to MarketData type
            return {
                price: data.data.price, // Current price in USD
                symbol: data.data.symbol, // Token symbol (e.g., "EXM")
                marketCap: data.data.marketCap, // Market capitalization in USD
                holderCount: data.data.holder, // Number of token holders
                volume1hUSD: data.data.v1hUSD, // 1-hour trading volume in USD
                volume24hUSD: data.data.v24hUSD, // 24-hour trading volume in USD
                priceChange1h: data.data.priceChange1hPercent, // 1-hour price change percentage
                priceChange24h: data.data.priceChange24hPercent, // 24-hour price change percentage
                uniqueTraders1h: data.data.uniqueWallet1h, // Number of unique traders in last hour
                trades1h: data.data.trade1h, // Number of trades in last hour
            };
        } catch (error) {
            // Log error and rethrow
            elizaLogger.error('Birdeye API error:', {
                tokenAddress,
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
        }
    }
}