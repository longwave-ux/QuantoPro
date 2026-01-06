import {
    calculateEMA, calculateRSI, calculateSMA, calculateATR,
    detectRejection, findKeyLevels, calculateADX,
    calculateBollingerBands, getSwingHighLow, calculateOBV
} from './indicators.js';
import { CONFIG } from './config.js';

export const AnalysisEngine = {
    detectTrendHTF: (htfData) => {
        if (htfData.length < CONFIG.SCANNERS.MIN_HISTORY_HTF) return { bias: 'NONE', trendStruct: 'DOWN', ema50: 0, ema200: 0, adx: 0 };

        const ema50Arr = calculateEMA(htfData, CONFIG.INDICATORS.EMA.FAST);
        const ema200Arr = calculateEMA(htfData, CONFIG.INDICATORS.EMA.SLOW);
        const adxArr = calculateADX(htfData, CONFIG.INDICATORS.ADX.PERIOD);

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

    checkBollinger: (ltfData) => {
        const bands = calculateBollingerBands(ltfData, CONFIG.INDICATORS.BOL_BANDS.PERIOD, CONFIG.INDICATORS.BOL_BANDS.STD_DEV);
        const lastBand = bands[bands.length - 1];
        const lastPrice = ltfData[ltfData.length - 1].close;
        return lastPrice > lastBand.upper || lastPrice < lastBand.lower;
    },

    checkOBVImbalance: (data) => {
        if (data.length < 30) return 'NEUTRAL';
        const lookback = CONFIG.INDICATORS.OBV.LOOKBACK;
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

        if (diff > CONFIG.INDICATORS.OBV.THRESHOLD) return 'BULLISH';
        if (diff < -CONFIG.INDICATORS.OBV.THRESHOLD) return 'BEARISH';
        return 'NEUTRAL';
    },

    detectPullback: (ltfData, bias) => {
        if (ltfData.length === 0 || bias === 'NONE') return { isPullback: false, depth: 0, hasRejection: false };
        const { high: recentHigh, low: recentLow } = getSwingHighLow(ltfData, 50);
        const lastClose = ltfData[ltfData.length - 1].close;
        const range = recentHigh - recentLow;

        let depth = 0, isPullback = false;
        if (range === 0) return { isPullback: false, depth: 0, hasRejection: false };

        if (bias === 'LONG') depth = (recentHigh - lastClose) / range;
        else depth = (lastClose - recentLow) / range;

        isPullback = depth >= CONFIG.INDICATORS.PULLBACK.MIN_DEPTH && depth <= CONFIG.INDICATORS.PULLBACK.MAX_DEPTH;
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

    checkMomentum: (ltfData) => {
        if (ltfData.length < CONFIG.SCANNERS.MIN_HISTORY_LTF) return { momentumOk: false, rsi: 50, divergence: 'NONE' };
        const rsiArr = calculateRSI(ltfData, CONFIG.INDICATORS.RSI.PERIOD);
        const currentRsi = rsiArr[rsiArr.length - 1];
        const momentumOk = currentRsi > CONFIG.INDICATORS.RSI.OVERSOLD && currentRsi < CONFIG.INDICATORS.RSI.OVERBOUGHT;

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
        const lowPivots = findPivots('LOW', lastCompletedIndex, CONFIG.INDICATORS.PIVOT_LOOKBACK);
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
            const highPivots = findPivots('HIGH', lastCompletedIndex, CONFIG.INDICATORS.PIVOT_LOOKBACK);
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

    calculateTradeSetup: (ltfData, bias) => {
        if (bias === 'NONE' || ltfData.length === 0) return null;

        const currentPrice = ltfData[ltfData.length - 1].close;
        const atr = calculateATR(ltfData, 14);
        const levels = findKeyLevels(ltfData, 50);
        const { high: majorHigh, low: majorLow } = getSwingHighLow(ltfData, 120);
        const { high: swingHigh, low: swingLow } = getSwingHighLow(ltfData, 50);

        let entry = currentPrice;
        let sl = 0;
        let tp = 0;
        let confluenceType = 'ATR_REVERSION';

        if (bias === 'LONG') {
            const range = swingHigh - swingLow;
            const fibLevel = swingHigh - (range * 0.618);
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
            if (distToLow < 0.05 && distToLow > 0) sl = swingLow * 0.995;
            else sl = entry - (2.5 * atr);

        } else {
            const range = swingHigh - swingLow;
            const fibLevel = swingLow + (range * 0.618);
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
            if (distToHigh < 0.05 && distToHigh > 0) sl = swingHigh * 1.005;
            else sl = entry + (2.5 * atr);
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

    analyzePair: (symbol, htfData, ltfData, htf, ltf, now, source) => {
        const { bias, trendStruct, ema50, ema200, adx } = AnalysisEngine.detectTrendHTF(htfData);
        const { isPullback, depth, hasRejection } = AnalysisEngine.detectPullback(ltfData, bias);
        const volumeOk = AnalysisEngine.checkVolume(ltfData);
        const { momentumOk, rsi, divergence } = AnalysisEngine.checkMomentum(ltfData);
        const isOverextended = AnalysisEngine.checkBollinger(ltfData);
        const obvImbalance = AnalysisEngine.checkOBVImbalance(ltfData);

        const setup = (adx > CONFIG.INDICATORS.ADX.MIN_TREND) ? AnalysisEngine.calculateTradeSetup(ltfData, bias) : null;

        let trendScore = 0, structureScore = 0, moneyFlowScore = 0, timingScore = 0;

        if (bias === 'LONG' && htfData[htfData.length - 1].close > ema50 && ema50 > ema200) {
            trendScore = CONFIG.SCORING.TREND.BASE; if (adx > CONFIG.INDICATORS.ADX.STRONG_TREND) trendScore += CONFIG.SCORING.TREND.STRONG_ADX;
        } else if (bias === 'SHORT' && htfData[htfData.length - 1].close < ema50 && ema50 < ema200) {
            trendScore = CONFIG.SCORING.TREND.BASE; if (adx > CONFIG.INDICATORS.ADX.STRONG_TREND) trendScore += CONFIG.SCORING.TREND.STRONG_ADX;
        } else { if (bias !== 'NONE') trendScore = CONFIG.SCORING.TREND.WEAK_BIAS; }

        if (setup) {
            if (setup.confluenceType === 'FIB_STRUCTURE') structureScore = CONFIG.SCORING.STRUCTURE.FIB;
            else if (setup.confluenceType === 'STRUCTURE_ONLY') structureScore = CONFIG.SCORING.STRUCTURE.LEVEL;

            if (setup.rr < 1.0) structureScore -= CONFIG.SCORING.STRUCTURE.POOR_RR_PENALTY;
            else if (setup.rr < 1.5) structureScore -= CONFIG.SCORING.STRUCTURE.MED_RR_PENALTY;
        }

        if (bias === 'LONG') {
            if (obvImbalance === 'BULLISH') moneyFlowScore += CONFIG.SCORING.MONEY_FLOW.OBV;
        } else if (bias === 'SHORT') {
            if (obvImbalance === 'BEARISH') moneyFlowScore += CONFIG.SCORING.MONEY_FLOW.OBV;
        }

        if (isPullback) {
            if (volumeOk) timingScore += CONFIG.SCORING.TIMING.PULLBACK;
            else totalScore -= CONFIG.SCORING.PENALTIES.HIGH_VOL_PULLBACK;
        }
        if (hasRejection) timingScore += CONFIG.SCORING.TIMING.REJECTION;

        let totalScore = trendScore + structureScore + moneyFlowScore + timingScore;

        if (bias === 'LONG' && obvImbalance === 'BEARISH') totalScore -= CONFIG.SCORING.PENALTIES.CONTRARIAN_OBV;
        if (bias === 'SHORT' && obvImbalance === 'BULLISH') totalScore -= CONFIG.SCORING.PENALTIES.CONTRARIAN_OBV;
        if (bias === 'LONG' && divergence === 'BEARISH') totalScore -= CONFIG.SCORING.PENALTIES.CONTRARIAN_DIV;
        if (bias === 'SHORT' && divergence === 'BULLISH') totalScore -= CONFIG.SCORING.PENALTIES.CONTRARIAN_DIV;
        if (isOverextended) totalScore -= CONFIG.SCORING.PENALTIES.OVEREXTENDED;
        if (adx < CONFIG.INDICATORS.ADX.MIN_TREND || !setup) totalScore = 0;

        return {
            symbol,
            source,
            price: htfData[htfData.length - 1].close,
            score: Math.max(0, Math.min(100, totalScore)),
            setup,
            meta: { htfInterval: htf, ltfInterval: ltf },
            details: { trendScore, structureScore, moneyFlowScore, timingScore },
            htf: { trend: trendStruct, bias, ema50, ema200, adx },
            ltf: { rsi, divergence, obvImbalance, pullbackDepth: depth, isPullback, volumeOk, momentumOk, isOverextended },
            timestamp: now
        };
    }
};
