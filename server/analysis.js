import {
    calculateEMA, calculateRSI, calculateSMA, calculateATR,
    detectRejection, findKeyLevels, calculateADX,
    calculateBollingerBands, getSwingHighLow, calculateOBV
} from './indicators.js';
import { CONFIG } from './config.js';

export const AnalysisEngine = {
    detectTrendHTF: (htfData, config = CONFIG) => {
        if (htfData.length < config.SCANNERS.MIN_HISTORY_HTF) return { bias: 'NONE', trendStruct: 'DOWN', ema50: 0, ema200: 0, adx: 0 };

        const ema50Arr = calculateEMA(htfData, config.INDICATORS.EMA.FAST);
        const ema200Arr = calculateEMA(htfData, config.INDICATORS.EMA.SLOW);
        const adxArr = calculateADX(htfData, config.INDICATORS.ADX.PERIOD);

        const close = htfData[htfData.length - 1].close;
        const closePrev3 = htfData[htfData.length - 3].close;

        const ema50 = ema50Arr[ema50Arr.length - 1];
        const ema200 = ema200Arr[ema200Arr.length - 1];
        const adx = adxArr[adxArr.length - 1];

        let bias = 'NONE';
        // FIX: Ensure EMAs are valid before comparing
        if (isNaN(ema50) || isNaN(ema200)) {
            bias = 'UNKNOWN';
        } else {
            if (close > ema50 && ema50 > ema200) bias = 'LONG';
            else if (close < ema50 && ema50 < ema200) bias = 'SHORT';
        }

        const trendStruct = close > closePrev3 ? 'UP' : 'DOWN';

        return { bias, trendStruct, ema50, ema200, adx };
    },

    checkBollinger: (ltfData, config = CONFIG) => {
        const bands = calculateBollingerBands(ltfData, config.INDICATORS.BOL_BANDS.PERIOD, config.INDICATORS.BOL_BANDS.STD_DEV);
        const lastBand = bands[bands.length - 1];
        const lastPrice = ltfData[ltfData.length - 1].close;
        return lastPrice > lastBand.upper || lastPrice < lastBand.lower;
    },

    checkOBVImbalance: (data, config = CONFIG) => {
        if (data.length < 30) return 'NEUTRAL';
        const lookback = config.INDICATORS.OBV.LOOKBACK;
        const fullObv = calculateOBV(data);
        const obvSlice = fullObv.slice(-lookback);
        const priceSlice = data.slice(-lookback).map(d => d.close);

        const minPrice = Math.min(...priceSlice);
        const maxPrice = Math.max(...priceSlice);
        const priceRange = maxPrice - minPrice;

        const minObv = Math.min(...obvSlice);
        const maxObv = Math.max(...obvSlice);
        const obvRange = maxObv - minObv;

        if (priceRange === 0 || obvRange === 0) return 'NEUTRAL';

        const currentPrice = priceSlice[priceSlice.length - 1];
        const currentObv = obvSlice[obvSlice.length - 1];

        const normPrice = (currentPrice - minPrice) / priceRange;
        const normObv = (currentObv - minObv) / obvRange;
        const diff = normObv - normPrice;

        if (diff > config.INDICATORS.OBV.THRESHOLD) return 'BULLISH';
        if (diff < -config.INDICATORS.OBV.THRESHOLD) return 'BEARISH';
        return 'NEUTRAL';
    },

    detectPullback: (ltfData, bias, config = CONFIG) => {
        if (ltfData.length === 0 || bias === 'NONE') return { isPullback: false, depth: 0, hasRejection: false };
        const { high: recentHigh, low: recentLow } = getSwingHighLow(ltfData, 50);
        const lastClose = ltfData[ltfData.length - 1].close;
        const range = recentHigh - recentLow;

        let depth = 0, isPullback = false;
        if (range === 0) return { isPullback: false, depth: 0, hasRejection: false };

        if (bias === 'LONG') depth = (recentHigh - lastClose) / range;
        else depth = (lastClose - recentLow) / range;

        isPullback = depth >= config.INDICATORS.PULLBACK.MIN_DEPTH && depth <= config.INDICATORS.PULLBACK.MAX_DEPTH;
        const lastCandle = ltfData[ltfData.length - 1];
        const hasRejection = detectRejection(lastCandle, bias);
        return { isPullback, depth, hasRejection };
    },

    checkVolume: (ltfData) => {
        if (ltfData.length < 20) return false;
        const volumes = ltfData.map(d => d.volume);
        const recentVol = volumes[volumes.length - 1];
        const meanVol = calculateSMA(volumes, 20).slice(-1)[0];
        return recentVol < meanVol;
    },

    checkMomentum: (ltfData, config = CONFIG) => {
        if (ltfData.length < config.SCANNERS.MIN_HISTORY_LTF) return { momentumOk: false, rsi: 50, divergence: 'NONE' };
        const rsiArr = calculateRSI(ltfData, config.INDICATORS.RSI.PERIOD);
        const currentRsi = rsiArr[rsiArr.length - 1];
        const momentumOk = currentRsi > config.INDICATORS.RSI.OVERSOLD && currentRsi < config.INDICATORS.RSI.OVERBOUGHT;

        let divergence = 'NONE';

        // Helper: Find completed pivots (requires left and right neighbors higher/lower)
        // We start looking from index-2 (last closed candle) backwards to ensure we use completed data
        const findPivots = (type, startIndex, lookback) => {
            const pivots = [];
            for (let i = startIndex; i > startIndex - lookback; i--) {
                if (i <= 1 || i >= ltfData.length - 1) continue;

                if (type === 'LOW') {
                    // Check if i is a local low
                    if (ltfData[i].low < ltfData[i - 1].low && ltfData[i].low < ltfData[i + 1].low) {
                        pivots.push({ index: i, price: ltfData[i].low, rsi: rsiArr[i] });
                    }
                } else {
                    // Check if i is a local high
                    if (ltfData[i].high > ltfData[i - 1].high && ltfData[i].high > ltfData[i + 1].high) {
                        pivots.push({ index: i, price: ltfData[i].high, rsi: rsiArr[i] });
                    }
                }
                if (pivots.length >= 2) break; // Found the 2 most recent pivots
            }
            return pivots;
        };

        const lastCompletedIndex = ltfData.length - 2;

        // 1. Check Bullish Divergence (Lower Low Price, Higher Low RSI)
        const lowPivots = findPivots('LOW', lastCompletedIndex, config.INDICATORS.PIVOT_LOOKBACK);
        if (lowPivots.length === 2) {
            const recent = lowPivots[0];  // Pivot B
            const previous = lowPivots[1]; // Pivot A

            if (recent.price < previous.price) { // Price made Lower Low
                if (recent.rsi > previous.rsi) { // RSI made Higher Low
                    // Filter: Previous RSI should be somewhat oversold to be significant
                    if (previous.rsi < 50) divergence = 'BULLISH';
                }
            }
        }

        // 2. Check Bearish Divergence (Higher High Price, Lower High RSI)
        if (divergence === 'NONE') {
            const highPivots = findPivots('HIGH', lastCompletedIndex, config.INDICATORS.PIVOT_LOOKBACK);
            if (highPivots.length === 2) {
                const recent = highPivots[0];
                const previous = highPivots[1];

                if (recent.price > previous.price) { // Price made Higher High
                    if (recent.rsi < previous.rsi) { // RSI made Lower High
                        // Filter: Previous RSI should be somewhat overbought to be significant
                        if (previous.rsi > 50) divergence = 'BEARISH';
                    }
                }
            }
        }


        return { momentumOk, rsi: currentRsi, divergence };
    },

    calculateTradeSetup: (ltfData, bias, adx, config = CONFIG) => {
        if (bias === 'NONE' || ltfData.length === 0) return null;

        const currentPrice = ltfData[ltfData.length - 1].close;
        const atr = calculateATR(ltfData, 14);

        // ADAPTIVE LOGIC: Adjust Confirmation Window based on Trend Strength
        // Only active if ENABLE_ADAPTIVE is true
        let lookbackWindow = 50;

        if (config.SYSTEM.ENABLE_ADAPTIVE) {
            if (adx > 50) lookbackWindow = 10;
            else if (adx > 25) lookbackWindow = 20;
        }

        const levels = findKeyLevels(ltfData, lookbackWindow);
        const { high: majorHigh, low: majorLow } = getSwingHighLow(ltfData, 120);
        const { high: swingHigh, low: swingLow } = getSwingHighLow(ltfData, 50);

        let entry = currentPrice;
        let sl = 0;
        let tp = 0;
        let confluenceType = 'ATR_REVERSION';

        // DYNAMIC ENTRY: Adjust pullback depth based on aggression
        // Only active if ENABLE_ADAPTIVE is true
        let fibRatio = 0.618;
        if (config.SYSTEM.ENABLE_ADAPTIVE && adx > 40) {
            fibRatio = 0.382;
        }

        if (bias === 'LONG') {
            const range = swingHigh - swingLow;
            const fibLevel = swingHigh - (range * fibRatio);

            // Filter supports relative to our dynamic Fib level
            const validSupports = levels.supports.filter(s => s < currentPrice && s >= fibLevel * 0.95);
            const bestSupport = validSupports.sort((a, b) => Math.abs(a - fibLevel) - Math.abs(b - fibLevel))[0];

            if (bestSupport) {
                entry = bestSupport;
                confluenceType = 'FIB_STRUCTURE';
            } else {
                const anySupport = levels.supports.filter(s => s < currentPrice).sort((a, b) => b - a)[0];
                if (anySupport) {
                    entry = anySupport;
                    confluenceType = 'STRUCTURE_ONLY';
                } else {
                    entry = currentPrice - (1 * atr);
                    confluenceType = 'ATR_REVERSION';
                }
            }
            const distToLow = (entry - swingLow) / entry;
            const buffer = config.RISK.SL_BUFFER || 0.005;
            if (distToLow < 0.05 && distToLow > 0) sl = swingLow * (1 - buffer);
            else sl = entry - ((config.RISK.ATR_MULTIPLIER || 2.5) * atr);

        } else {
            const range = swingHigh - swingLow;
            const fibLevel = swingLow + (range * fibRatio);
            const validResistances = levels.resistances.filter(r => r > currentPrice && r <= fibLevel * 1.05);
            const bestRes = validResistances.sort((a, b) => Math.abs(a - fibLevel) - Math.abs(b - fibLevel))[0];

            if (bestRes) {
                 entry = bestRes;
                confluenceType = 'FIB_STRUCTURE';
            } else {
                const anyRes = levels.resistances.filter(r => r > currentPrice).sort((a, b) => a - b)[0];
                if (anyRes) {
                    entry = anyRes;
                    confluenceType = 'STRUCTURE_ONLY';
                } else {
                    entry = currentPrice + (1 * atr);
                    confluenceType = 'ATR_REVERSION';
                }
            }
            const distToHigh = (swingHigh - entry) / entry;
            const buffer = config.RISK.SL_BUFFER || 0.005;
            if (distToHigh < 0.05 && distToHigh > 0) sl = swingHigh * (1 + buffer);
            else sl = entry + ((config.RISK.ATR_MULTIPLIER || 2.5) * atr);
        }

        if (bias === 'LONG') {
            if (majorHigh > entry * 1.015) tp = majorHigh;
            else tp = majorHigh + ((majorHigh - majorLow) * 0.618);
        } else {
            if (majorLow < entry * 0.985) tp = majorLow;
            else tp = majorLow - ((majorHigh - majorLow) * 0.618);
        }

        const risk = Math.abs(entry - sl);
        const reward = Math.abs(tp - entry);
        const rr = risk === 0 ? 0 : Number((reward / risk).toFixed(2));

        return { entry, sl, tp, rr, side: bias, confluenceType };
    },

    analyzePair: (symbol, htfData, ltfData, htf, ltf, now, source, config = CONFIG, optionalData = {}) => {
        if (config.SYSTEM.ENABLE_ADAPTIVE) {
            // console.log(`[ANALYSIS] Adaptive Mode ACTIVE for ${symbol}`);
        }
        const { bias, trendStruct, ema50, ema200, adx } = AnalysisEngine.detectTrendHTF(htfData, config);
        const { isPullback, depth, hasRejection } = AnalysisEngine.detectPullback(ltfData, bias, config);
        const volumeOk = AnalysisEngine.checkVolume(ltfData);
        const { momentumOk, rsi, divergence } = AnalysisEngine.checkMomentum(ltfData, config);
        const isOverextended = AnalysisEngine.checkBollinger(ltfData, config);
        const obvImbalance = AnalysisEngine.checkOBVImbalance(ltfData, config);

        // PASS ADX TO SETUP CALCULATOR
        const setup = (adx > config.INDICATORS.ADX.MIN_TREND) ? AnalysisEngine.calculateTradeSetup(ltfData, bias, adx, config) : null;

        let trendScore = 0, structureScore = 0, moneyFlowScore = 0, timingScore = 0;

        if (bias === 'LONG' && htfData[htfData.length - 1].close > ema50 && ema50 > ema200) {
            trendScore = config.SCORING.TREND.BASE; if (adx > config.INDICATORS.ADX.STRONG_TREND) trendScore += config.SCORING.TREND.STRONG_ADX;
        } else if (bias === 'SHORT' && htfData[htfData.length - 1].close < ema50 && ema50 < ema200) {
            trendScore = config.SCORING.TREND.BASE; if (adx > config.INDICATORS.ADX.STRONG_TREND) trendScore += config.SCORING.TREND.STRONG_ADX;
        } else { if (bias !== 'NONE') trendScore = config.SCORING.TREND.WEAK_BIAS; }

        if (setup) {
            if (setup.confluenceType === 'FIB_STRUCTURE') structureScore = config.SCORING.STRUCTURE.FIB;
            else if (setup.confluenceType === 'STRUCTURE_ONLY') structureScore = config.SCORING.STRUCTURE.LEVEL;

            if (setup.rr < 1.0) structureScore -= config.SCORING.STRUCTURE.POOR_RR_PENALTY;
            else if (setup.rr < 1.5) structureScore -= config.SCORING.STRUCTURE.MED_RR_PENALTY;
        }

        if (bias === 'LONG') {
            if (obvImbalance === 'BULLISH') moneyFlowScore += config.SCORING.MONEY_FLOW.OBV;
        } else if (bias === 'SHORT') {
            if (obvImbalance === 'BEARISH') moneyFlowScore += config.SCORING.MONEY_FLOW.OBV;
        }

        if (isPullback) {
            if (volumeOk) timingScore += config.SCORING.TIMING.PULLBACK;
        }
        if (hasRejection) timingScore += config.SCORING.TIMING.REJECTION;

        // ADAPTIVE SCORING (REGIME SWITCHING)
        // If Enabled and Trend is Strong, boost Trend/Timing and reduce Structure dependency
        if (config.SYSTEM.ENABLE_ADAPTIVE && adx > 25 && config.REGIMES?.TRENDING) {
            trendScore *= config.REGIMES.TRENDING.TREND_MULTIPLIER;
            structureScore *= config.REGIMES.TRENDING.STRUCTURE_MULTIPLIER;
            timingScore *= config.REGIMES.TRENDING.TIMING_MULTIPLIER;
        }

        let totalScore = trendScore + structureScore + moneyFlowScore + timingScore;

        if (isPullback && !volumeOk) totalScore -= config.SCORING.PENALTIES.HIGH_VOL_PULLBACK;

        if (bias === 'LONG' && obvImbalance === 'BEARISH') totalScore -= config.SCORING.PENALTIES.CONTRARIAN_OBV;
        if (bias === 'SHORT' && obvImbalance === 'BULLISH') totalScore -= config.SCORING.PENALTIES.CONTRARIAN_OBV;
        if (bias === 'LONG' && divergence === 'BEARISH') totalScore -= config.SCORING.PENALTIES.CONTRARIAN_DIV;
        if (bias === 'SHORT' && divergence === 'BULLISH') totalScore -= config.SCORING.PENALTIES.CONTRARIAN_DIV;
        if (isOverextended) totalScore -= config.SCORING.PENALTIES.OVEREXTENDED;

        // VOLATILITY PROTECTION
        // If ATR is > 3% of price, it's too volatile (likely a pump or crash).
        const currentPrice = ltfData[ltfData.length - 1].close;
        const atr = calculateATR(ltfData, 14);
        if ((atr / currentPrice) > 0.03 && config.SCORING.PENALTIES.HIGH_VOLATILITY) {
            totalScore -= config.SCORING.PENALTIES.HIGH_VOLATILITY;
        }

        // LIQUIDITY & SIZE OPTIMIZATION
        // 1. Calculate 24h Volume (Last 96 candles of 15m)
        let vol24h = 0;
        const volLookback = Math.min(ltfData.length, 96);
        for (let i = 0; i < volLookback; i++) {
            const c = ltfData[ltfData.length - 1 - i];
            vol24h += c.volume * c.close;
        }

        // 3. Market Cap Adjustments
        // optionalData.mcap passed from scanner
        const mcap = optionalData?.mcap || 0;

        // 2. High Volume Reward (Conditional: Must be > $50M Mcap to avoid dust pumps)
        if (config.SCORING.VOLUME?.ENABLE_VOLUME_LOGIC !== false) {
            if (vol24h > 100000000 && config.SCORING.VOLUME?.HIGH_VOLUME_REWARD) {
                if (mcap === 0 || mcap > 50000000) {
                    totalScore += config.SCORING.VOLUME.HIGH_VOLUME_REWARD;
                }
            }
        }

        if (mcap > 0 && config.SCORING.MARKET_CAP?.ENABLE_MCAP_LOGIC !== false) {
            if (mcap < 1000000000 && config.SCORING.MARKET_CAP?.SMALL_CAP_REWARD) {
                // < $1B: Reward (+5)
                totalScore += config.SCORING.MARKET_CAP.SMALL_CAP_REWARD;
            } else if (mcap > 10000000000 && config.SCORING.MARKET_CAP?.MEGA_CAP_REWARD) {
                // > $10B: Reward (+5) for Stability
                totalScore += config.SCORING.MARKET_CAP.MEGA_CAP_REWARD;
            }
        }

        if (adx < config.INDICATORS.ADX.MIN_TREND || !setup) totalScore = 0;

        return {
            symbol,
            source,
            price: htfData[htfData.length - 1].close,
            score: Math.max(0, Math.min(100, totalScore)),
            setup,
            meta: { htfInterval: htf, ltfInterval: ltf },
            details: { trendScore, structureScore, moneyFlowScore, timingScore, mcap, vol24h },
            htf: { trend: trendStruct, bias, ema50, ema200, adx },
            ltf: { rsi, divergence, obvImbalance, pullbackDepth: depth, isPullback, volumeOk, momentumOk, isOverextended },
            timestamp: now
        };
    }
};
