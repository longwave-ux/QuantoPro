import fetch from 'node-fetch';

/**
 * Coinalyze Batch API Client
 * Fetches OI, Funding, L/S Ratio, and Liquidation data in batches of 20 symbols.
 * Handles rate limiting and retries with exponential backoff.
 */
export class CoinalyzeClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.coinalyze.net/v1';
        this.lastReqTime = 0;
        this.reqInterval = 1500; // 1.5s between requests (40 req/min limit)
        this.successfulRequests = 0;
        this.failedRequests = 0;
    }

    /**
     * Enforce rate limit with adaptive spacing
     */
    async _waitForRateLimit() {
        const elapsed = Date.now() - this.lastReqTime;
        if (elapsed < this.reqInterval) {
            const waitTime = this.reqInterval - elapsed;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        this.lastReqTime = Date.now();
    }

    /**
     * Make API request with retry logic and exponential backoff
     */
    async _makeRequestWithRetry(endpoint, params, maxRetries = 3) {
        const baseDelay = 2000; // 2 seconds

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const queryString = new URLSearchParams(params).toString();
                const url = `${endpoint}?${queryString}`;

                const response = await fetch(url, { timeout: 30000 });

                if (response.status === 429) {
                    // Rate limit - check for Retry-After header
                    const retryAfter = response.headers.get('retry-after');
                    let waitTime;

                    if (retryAfter) {
                        waitTime = (parseInt(parseFloat(retryAfter)) + 1) * 1000;
                        console.error(`[RATE-LIMIT] 429 Detected. Waiting ${waitTime / 1000}s as requested by API...`);
                    } else {
                        waitTime = baseDelay * Math.pow(2, attempt);
                        console.error(`[RATE-LIMIT] 429 Detected (no Retry-After). Waiting ${waitTime / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
                    }

                    await new Promise(resolve => setTimeout(resolve, waitTime));

                    if (attempt === maxRetries - 1) {
                        throw new Error('Rate limit exceeded after retries');
                    }
                    continue;
                }

                if (response.status >= 500) {
                    // Server error - retry with backoff
                    const waitTime = baseDelay * Math.pow(2, attempt);
                    console.error(`[API-ERROR] ${response.status} Server Error. Retrying in ${waitTime / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));

                    if (attempt === maxRetries - 1) {
                        throw new Error(`Server error ${response.status} after retries`);
                    }
                    continue;
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                return await response.json();

            } catch (error) {
                if (attempt < maxRetries - 1 && error.name === 'FetchError') {
                    // Network error - retry
                    const waitTime = baseDelay * Math.pow(2, attempt);
                    console.error(`[NETWORK-ERROR] ${error.message}. Retrying in ${waitTime / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    throw error;
                }
            }
        }

        throw new Error('Max retries exceeded');
    }

    /**
     * Fetch OI history for multiple symbols in one request
     */
    async getOpenInterestHistoryBatch(symbols, hours = 24) {
        if (symbols.length > 20) {
            throw new Error('Maximum 20 symbols per batch request');
        }

        const now = Math.floor(Date.now() / 1000);
        const toTs = now - (now % 900); // Round to 15min
        const fromTs = toTs - (hours * 3600);

        await this._waitForRateLimit();

        const endpoint = `${this.baseUrl}/open-interest-history`;
        const params = {
            symbols: symbols.join(','),
            interval: '15min',
            from: fromTs,
            to: toTs,
            api_key: this.apiKey
        };

        try {
            const data = await this._makeRequestWithRetry(endpoint, params);
            this.successfulRequests++;
            console.log(`[API-SUCCESS] OI History batch fetched for ${symbols.length} symbols`);

            // Parse batch response
            const result = {};
            if (Array.isArray(data)) {
                for (const item of data) {
                    const symbol = item.symbol || '';
                    if (!symbol || !item.history) continue;

                    result[symbol] = item.history.map(h => ({
                        timestamp: h.t,
                        value: parseFloat(h.c)
                    }));
                }
            }

            return result;

        } catch (error) {
            this.failedRequests++;
            console.error(`[API-FAILED] OI History batch failed for ${symbols.length} symbols:`, error.message);
            return {};
        }
    }

    /**
     * Fetch funding rates for multiple symbols
     */
    async getFundingRateBatch(symbols) {
        if (symbols.length > 20) {
            throw new Error('Maximum 20 symbols per batch request');
        }

        await this._waitForRateLimit();

        const endpoint = `${this.baseUrl}/predicted-funding-rate`;
        const params = {
            symbols: symbols.join(','),
            api_key: this.apiKey
        };

        try {
            const data = await this._makeRequestWithRetry(endpoint, params);
            this.successfulRequests++;
            console.log(`[API-SUCCESS] Funding Rate batch fetched for ${symbols.length} symbols`);

            // Parse batch response
            const result = {};
            if (Array.isArray(data)) {
                for (const item of data) {
                    const symbol = item.symbol || '';
                    if (symbol) {
                        result[symbol] = parseFloat(item.pf || 0);
                    }
                }
            }

            return result;

        } catch (error) {
            this.failedRequests++;
            console.error(`[API-FAILED] Funding Rate batch failed for ${symbols.length} symbols:`, error.message);
            return {};
        }
    }

    /**
     * Fetch Long/Short ratios for multiple symbols
     */
    async getLsRatioBatch(symbols) {
        if (symbols.length > 20) {
            throw new Error('Maximum 20 symbols per batch request');
        }

        const now = Math.floor(Date.now() / 1000);
        const toTs = now - (now % 900);
        const fromTs = toTs - 3600;

        await this._waitForRateLimit();

        const endpoint = `${this.baseUrl}/long-short-ratio-history`;
        const params = {
            symbols: symbols.join(','),
            interval: '15min',
            from: fromTs,
            to: toTs,
            api_key: this.apiKey
        };

        try {
            const data = await this._makeRequestWithRetry(endpoint, params);
            this.successfulRequests++;
            console.log(`[API-SUCCESS] L/S Ratio batch fetched for ${symbols.length} symbols`);

            // Parse batch response
            const result = {};
            if (Array.isArray(data)) {
                for (const item of data) {
                    const symbol = item.symbol || '';
                    if (!symbol || !item.history) continue;

                    const hist = item.history;
                    if (hist.length > 0) {
                        const last = hist[hist.length - 1];
                        const l = parseFloat(last.l || 0);
                        const s = parseFloat(last.s || 0);
                        result[symbol] = s > 0 ? l / s : 1.0;
                    }
                }
            }

            return result;

        } catch (error) {
            this.failedRequests++;
            console.error(`[API-FAILED] L/S Ratio batch failed for ${symbols.length} symbols:`, error.message);
            return {};
        }
    }

    /**
     * Fetch liquidation data for multiple symbols
     */
    async getLiquidationsBatch(symbols, hours = 24) {
        if (symbols.length > 20) {
            throw new Error('Maximum 20 symbols per batch request');
        }

        const now = Math.floor(Date.now() / 1000);
        const toTs = now - (now % 900);
        const fromTs = toTs - (hours * 3600);

        await this._waitForRateLimit();

        const endpoint = `${this.baseUrl}/liquidation-history`;
        const params = {
            symbols: symbols.join(','),
            interval: '15min',
            from: fromTs,
            to: toTs,
            api_key: this.apiKey
        };

        try {
            const data = await this._makeRequestWithRetry(endpoint, params);
            this.successfulRequests++;
            console.log(`[API-SUCCESS] Liquidations batch fetched for ${symbols.length} symbols`);

            // Parse batch response
            const result = {};
            if (Array.isArray(data)) {
                for (const item of data) {
                    const symbol = item.symbol || '';
                    if (!symbol || !item.history) continue;

                    const history = item.history;
                    const lookback = Math.min(history.length, 4); // Last 4 periods (1 hour)
                    const relevant = history.slice(-lookback);

                    const totalLongs = relevant.reduce((sum, h) => sum + parseFloat(h.l || 0), 0);
                    const totalShorts = relevant.reduce((sum, h) => sum + parseFloat(h.s || 0), 0);

                    result[symbol] = {
                        longs: totalLongs,
                        shorts: totalShorts
                    };
                }
            }

            return result;

        } catch (error) {
            this.failedRequests++;
            console.error(`[API-FAILED] Liquidations batch failed for ${symbols.length} symbols:`, error.message);
            return {};
        }
    }

    /**
     * Fetch all data types for a batch of symbols
     */
    async fetchAllDataBatch(symbols) {
        if (symbols.length > 20) {
            throw new Error('Maximum 20 symbols per batch request');
        }

        // Fetch all data types in parallel (each respects rate limit internally)
        const [oiData, fundingData, lsData, liqData] = await Promise.all([
            this.getOpenInterestHistoryBatch(symbols),
            this.getFundingRateBatch(symbols),
            this.getLsRatioBatch(symbols),
            this.getLiquidationsBatch(symbols)
        ]);

        // Combine results
        const result = {};
        for (const symbol of symbols) {
            result[symbol] = {
                oi_history: oiData[symbol] || [],
                funding_rate: fundingData[symbol] || null,
                ls_ratio: lsData[symbol] || null,
                liquidations: liqData[symbol] || { longs: 0, shorts: 0 }
            };
        }

        return result;
    }

    /**
     * Get API request statistics
     */
    getStats() {
        return {
            successful: this.successfulRequests,
            failed: this.failedRequests,
            total: this.successfulRequests + this.failedRequests
        };
    }
}
