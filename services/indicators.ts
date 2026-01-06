import { OHLCV, TradeSetup } from '../types';

// Calculate SMA (Simple Moving Average)
export const calculateSMA = (data: number[], period: number): number[] => {
  const smaArray: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      smaArray.push(NaN);
      continue;
    }
    const slice = data.slice(i - period + 1, i + 1);
    const sum = slice.reduce((a, b) => a + b, 0);
    smaArray.push(sum / period);
  }
  return smaArray;
};

// Calculate EMA (Exponential Moving Average)
export const calculateEMA = (data: OHLCV[], period: number): number[] => {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];
  
  // Simple SMA for first value
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i].close;
  }
  let prevEma = sum / period;
  
  for(let i=0; i< data.length; i++) {
     if(i < period - 1) {
       emaArray.push(NaN); 
     } else if (i === period - 1) {
       emaArray.push(prevEma);
     } else {
       const currentEma = (data[i].close - prevEma) * k + prevEma;
       emaArray.push(currentEma);
       prevEma = currentEma;
     }
  }
  return emaArray;
};

// Calculate RSI (Wilder's Smoothing)
export const calculateRSI = (data: OHLCV[], period: number = 14): number[] => {
  const rsiArray: number[] = [];
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < period + 1 && i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      rsiArray.push(NaN);
      continue;
    }

    if (i > period) {
      const diff = data[i].close - data[i - 1].close;
      const currentGain = diff > 0 ? diff : 0;
      const currentLoss = diff < 0 ? Math.abs(diff) : 0;
      
      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }

    if (avgLoss === 0) {
      rsiArray.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsiArray.push(100 - (100 / (1 + rs)));
    }
  }
  return rsiArray;
};

// Calculate Bollinger Bands
export const calculateBollingerBands = (data: OHLCV[], period: number = 20, stdDev: number = 2) => {
  const closes = data.map(d => d.close);
  const sma = calculateSMA(closes, period);
  const bands: { upper: number; middle: number; lower: number; }[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      bands.push({ upper: 0, middle: 0, lower: 0 });
      continue;
    }
    
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i];
    
    // Calculate Standard Deviation
    const squaredDiffs = slice.map(val => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(variance);

    bands.push({
      upper: mean + (sd * stdDev),
      middle: mean,
      lower: mean - (sd * stdDev)
    });
  }
  return bands;
};

// Calculate ADX (Average Directional Index)
export const calculateADX = (data: OHLCV[], period: number = 14): number[] => {
  if (data.length < period * 2) return new Array(data.length).fill(0);

  const tr: number[] = [];
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];

  // 1. Calculate TR, +DM, -DM
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    const prevHigh = data[i - 1].high;
    const prevLow = data[i - 1].low;

    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) dmPlus.push(upMove);
    else dmPlus.push(0);

    if (downMove > upMove && downMove > 0) dmMinus.push(downMove);
    else dmMinus.push(0);
  }

  // Helper for Wilder's Smoothing
  const smooth = (prev: number, curr: number) => (prev * (period - 1) + curr) / period;

  // Initial Smoothing (First period)
  let trSmooth = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let dmPlusSmooth = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let dmMinusSmooth = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);

  const adx: number[] = new Array(period + 1).fill(0); // Offset for initial loop + 1st calc

  // Calculate DX and Smooth ADX
  let prevAdx = 10; // Seed value, converges quickly

  for (let i = period; i < tr.length; i++) {
    trSmooth = smooth(trSmooth, tr[i]);
    dmPlusSmooth = smooth(dmPlusSmooth, dmPlus[i]);
    dmMinusSmooth = smooth(dmMinusSmooth, dmMinus[i]);

    const diPlus = (dmPlusSmooth / trSmooth) * 100;
    const diMinus = (dmMinusSmooth / trSmooth) * 100;
    
    const dx = (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100;
    
    // Smooth DX to get ADX
    const currentAdx = (prevAdx * (period - 1) + dx) / period;
    adx.push(currentAdx);
    prevAdx = currentAdx;
  }

  // Pad the beginning to match data length
  return new Array(data.length - adx.length).fill(0).concat(adx);
};

// Calculate OBV (On-Balance Volume)
export const calculateOBV = (data: OHLCV[]): number[] => {
  const obv: number[] = [0];
  for (let i = 1; i < data.length; i++) {
    const prevObv = obv[i - 1];
    const currentPrice = data[i].close;
    const prevPrice = data[i - 1].close;
    const volume = data[i].volume;

    if (currentPrice > prevPrice) {
      obv.push(prevObv + volume);
    } else if (currentPrice < prevPrice) {
      obv.push(prevObv - volume);
    } else {
      obv.push(prevObv);
    }
  }
  return obv;
};

// Calculate ATR (Average True Range)
export const calculateATR = (data: OHLCV[], period: number = 14): number => {
  if (data.length < period + 1) return 0;
  
  let trSum = 0;
  // Calculate initial TRs
  for (let i = 1; i <= period; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i-1].close;
    
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  
  let atr = trSum / period;

  // Smoothing
  for (let i = period + 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i-1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    
    atr = ((atr * (period - 1)) + tr) / period;
  }
  
  return atr;
};

// Calculate Volume Profile
export interface VolumeProfileBucket {
  price: number;
  volume: number;
}

export const calculateVolumeProfile = (data: OHLCV[], buckets: number = 24): VolumeProfileBucket[] => {
  if (data.length === 0) return [];

  const minPrice = Math.min(...data.map(d => d.low));
  const maxPrice = Math.max(...data.map(d => d.high));
  const range = maxPrice - minPrice;
  const step = range / buckets;

  if (step === 0) return [];

  // Initialize buckets
  const profile: VolumeProfileBucket[] = Array.from({ length: buckets }, (_, i) => ({
    price: minPrice + (i * step) + (step / 2), // Midpoint of bucket
    volume: 0
  }));

  data.forEach(candle => {
    // Distribute volume to the bucket corresponding to the Close price
    // Simplified model: entire volume attributed to close price bucket
    const bucketIndex = Math.min(Math.floor((candle.close - minPrice) / step), buckets - 1);
    if (bucketIndex >= 0) {
      profile[bucketIndex].volume += candle.volume;
    }
  });

  return profile;
};

// Detect Price Action Rejection (Pinbar/Hammer)
export const detectRejection = (candle: OHLCV, bias: 'LONG' | 'SHORT'): boolean => {
    const bodySize = Math.abs(candle.close - candle.open);
    const totalSize = candle.high - candle.low;
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;

    if (totalSize === 0) return false;

    // Body should be relatively small (less than 40% of range)
    if (bodySize > totalSize * 0.4) return false;

    if (bias === 'LONG') {
        // Bullish Rejection: Long lower wick (at least 2x body)
        return lowerWick > (bodySize * 2) && lowerWick > upperWick;
    } else {
        // Bearish Rejection: Long upper wick (at least 2x body)
        return upperWick > (bodySize * 2) && upperWick > lowerWick;
    }
}

// Find Support and Resistance (Swing Highs/Lows)
export const findKeyLevels = (data: OHLCV[], window: number = 10) => {
  const supports: number[] = [];
  const resistances: number[] = [];

  for (let i = window; i < data.length - window; i++) {
    const currentLow = data[i].low;
    const currentHigh = data[i].high;
    
    // Check for swing low
    let isLow = true;
    for (let j = 1; j <= window; j++) {
      if (data[i - j].low <= currentLow || data[i + j].low <= currentLow) {
        isLow = false;
        break;
      }
    }
    if (isLow) supports.push(currentLow);

    // Check for swing high
    let isHigh = true;
    for (let j = 1; j <= window; j++) {
      if (data[i - j].high >= currentHigh || data[i + j].high >= currentHigh) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) resistances.push(currentHigh);
  }

  // Return unique sorted levels (simplified)
  const filterLevels = (levels: number[]) => {
    return levels.sort((a,b) => a-b).filter((val, idx, arr) => {
        if (idx === 0) return true;
        return (val - arr[idx-1]) / arr[idx-1] > 0.02; // 2% distance
    }).slice(-5); 
  }

  return {
    supports: filterLevels(supports),
    resistances: filterLevels(resistances)
  };
};

export const getSwingHighLow = (data: OHLCV[], lookback: number = 50) => {
    const slice = data.slice(-lookback);
    const high = Math.max(...slice.map(d => d.high));
    const low = Math.min(...slice.map(d => d.low));
    return { high, low };
}