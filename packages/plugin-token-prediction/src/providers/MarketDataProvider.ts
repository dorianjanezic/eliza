import { elizaLogger, type IAgentRuntime } from '@ai16z/eliza';
import type { MarketData, OHLCVData } from '../types';
import { logger } from '../utils/logger';

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

        // Warn if API key is not provided, as it's required for authentication
        if (!this.apiKey) {
            logger.api.error('birdeye', new Error('MarketDataProvider initialized without API key'));
        } else {
            logger.api.request('birdeye_init', { hasApiKey: true, keyLength: this.apiKey.length });
            elizaLogger.info(`MarketDataProvider initialized with Birdeye API key (${this.apiKey.length} chars)`);
        }
    }

    // Utility to pause execution for a given time (used in retries)
    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Fetches data with exponential backoff retry logic for rate limits or errors
    private async fetchWithRetry(url: string, options: RequestInit, attempts: number = 0): Promise<Response> {
        const requestTimer = logger.performance.start('api_request');
        try {
            const response = await fetch(url, options);
            const requestTime = requestTimer.end({ status: response.status });

            // Handle rate limiting (HTTP 429) with retries
            if (response.status === 429 && attempts < this.retryCount) {
                const retryAfter = parseInt(response.headers.get('retry-after') || '1', 10);
                logger.api.rateLimit(url.split('?')[0], retryAfter);

                // Exponential backoff: delay increases with each attempt (e.g., 1s, 2s, 4s)
                await this.delay(this.retryDelay * Math.pow(2, attempts));
                return this.fetchWithRetry(url, options, attempts + 1);
            }

            logger.api.response(url.split('?')[0], response.status, requestTime);
            return response;
        } catch (error) {
            // Retry on network errors if attempts remain
            if (attempts < this.retryCount) {
                const err = error instanceof Error ? error : new Error('Unknown network error');
                logger.api.error(url.split('?')[0], err, attempts + 1, this.retryCount);

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
        const tokenId = tokenAddress.substring(0, 8); // Use part of address as tokenId for logging
        logger.market.fetching(tokenId, tokenAddress, 'ohlcv');

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

            // Log API request
            logger.api.request('defi/ohlcv', {
                tokenAddress,
                timeframe,
                timeFrom,
                timeTo
            });

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

            // Check for suspiciously large changes within candles
            for (const candle of ohlcvData) {
                const highLowDiff = candle.high / candle.low;
                if (highLowDiff > 2) { // Price doubled or halved within a single candle
                    logger.market.suspicious(tokenId, tokenAddress, 'Large price swing in candle', {
                        timestamp: candle.timestamp,
                        highToLowRatio: highLowDiff,
                        open: candle.open,
                        high: candle.high,
                        low: candle.low,
                        close: candle.close
                    });
                }
            }

            // Log success with key details
            logger.market.received(tokenId, tokenAddress, 'ohlcv', {
                candleCount: ohlcvData.length,
                timeframe,
                startTime: new Date(timeFrom * 1000).toISOString(),
                endTime: new Date(timeTo * 1000).toISOString(),
                latestClose: ohlcvData[ohlcvData.length - 1]?.close // Latest price for quick reference
            });

            return ohlcvData;
        } catch (error) {
            // Log detailed error and rethrow for caller to handle
            const err = error instanceof Error ? error : new Error('Unknown error');
            logger.market.error(tokenId, tokenAddress, 'ohlcv', err);
            throw error;
        }
    }

    // Fetches current market data for a token
    async getTokenMarketData(tokenAddress: string): Promise<MarketData> {
        const tokenId = tokenAddress.substring(0, 8); // Use part of address as tokenId for logging
        logger.market.fetching(tokenId, tokenAddress, 'market_data');

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

            // Log API request
            logger.api.request('defi/token_overview', { tokenAddress });

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

            // Check for suspicious market data
            if (data.data.marketCap && data.data.marketCap < 10000) {
                logger.market.suspicious(tokenId, tokenAddress, 'Very low market cap', {
                    marketCap: data.data.marketCap,
                    price: data.data.price
                });
            }

            if (data.data.holder < 10) {
                logger.market.suspicious(tokenId, tokenAddress, 'Very few holders', {
                    holderCount: data.data.holder
                });
            }

            // Map API response to MarketData type
            const marketData = {
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

            // Log received data
            logger.market.received(tokenId, tokenAddress, 'market_data', {
                symbol: marketData.symbol,
                price: marketData.price,
                marketCap: marketData.marketCap,
                holderCount: marketData.holderCount,
                volume1h: marketData.volume1hUSD,
                priceChange1h: marketData.priceChange1h
            });

            return marketData;
        } catch (error) {
            // Log error and rethrow
            const err = error instanceof Error ? error : new Error('Unknown error');
            logger.market.error(tokenId, tokenAddress, 'market_data', err);
            throw error;
        }
    }
}