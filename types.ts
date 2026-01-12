export interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
  adx: number | null;
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
  } | null;
}

export interface TrendlineInfo {
  m: number;
  c: number;
  start_idx: number;
  start_rsi: number;
  end_idx: number;
  end_rsi: number;
  current_projected_rsi: number;
}

export interface TradeSetup {
  entry: number;
  sl: number;
  tp: number;
  rr: number;
  side: 'LONG' | 'SHORT';
  confluenceType?: 'FIB_STRUCTURE' | 'STRUCTURE_ONLY' | 'ATR_REVERSION';
  trendline?: TrendlineInfo; // Added for Breakout Visualization
}

export type DataSource = 'KUCOIN' | 'MEXC' | 'HYPERLIQUID';

export interface AnalysisResult {
  symbol: string;
  source: DataSource;
  strategy_name?: string;
  bias?: string;
  action?: string; // Added for Breakout Watch/Wait
  price: number;
  score: number;
  setup: TradeSetup | null;
  history?: {
    consecutiveScans: number;
    prevScore: number;
    status: 'NEW' | 'STABLE' | 'WEAKENING' | 'STRENGTHENING';
  };
  meta: {
    htfInterval: string;
    ltfInterval: string;
  };
  exchange_tag?: string;
  components?: {
    symbol: string;
    price_change_pct: number;
    duration_candles: number;
    price_slope: number;
    rsi_slope: number;
    divergence_type: number;
    // Add other fields if necessary
  } | null;
  score_breakdown?: {
    geometry: number;
    momentum: number;
    base: number;
    total: number;
  } | null;
  details: {
    trendScore: number;
    structureScore: number;
    moneyFlowScore: number;
    timingScore: number;
    // Breakout Strategy Keys (camelCase to match Python)
    geometryScore?: number;
    momentumScore?: number;
    divergenceScore?: number;
    geometry_score?: number; // Legacy support if needed
    momentum_score?: number;
    divergence_score?: number;
    structure_score?: number;
    geometry_component?: number; // Added for UI tooltip
    momentum_component?: number; // Added for UI tooltip
    type?: string; // Added for Breakout/Retest type
    context_badge?: string;
    raw_components?: any;
    score_breakdown?: {
      geometry: number;
      momentum: number;
      base: number;
      total: number;
      oi_flow?: number;    // Added for Breakout
      sentiment?: number;  // Added for Breakout
      bonuses?: number;    // Added for Breakout
    };
    vol24h?: number;
  };
  htf: {
    trend: 'UP' | 'DOWN';       // Close[-1] > Close[-3]
    bias: 'LONG' | 'SHORT' | 'NONE'; // EMA Logic
    ema50: number;
    ema200: number;
    adx: number; // Strength of trend
  };
  ltf: {
    rsi: number;
    divergence: 'BULLISH' | 'BEARISH' | 'NONE';
    obvImbalance: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; // OBV vs Price Delta
    pullbackDepth: number;      // 0.0 to 1.0
    isPullback: boolean;        // 0.38 <= depth <= 0.61
    volumeOk: boolean;          // recent < avg
    momentumOk: boolean;        // 30 < rsi < 70
    isOverextended: boolean;    // Outside Bollinger Bands
  };
  timestamp: number;
}

export interface AnalysisState {
  isScanning: boolean;
  lastUpdated: number | null;
  results: AnalysisResult[];
  selectedPair: AnalysisResult | null;
  autoRefresh: boolean;
  timeRemaining: number;
  dataSource: DataSource;
}

export interface NotificationSettings {
  enabled: boolean;
  entryAlerts?: boolean;
  botToken: string;
  chatId: string;
  minScore: number;
  mexcApiKey?: string;
  mexcApiSecret?: string;
  hyperliquidPrivateKey?: string; // Added for Hyperliquid
  hyperliquidMasterAddress?: string; // Added for Agent Key support
  activeExchange?: 'MEXC' | 'HYPERLIQUID'; // Preferred execution venue
  geminiLLMApiKey?: string;
  strategies?: {
    Legacy: { enabled: boolean; minScore: number; };
    Breakout: { enabled: boolean; minScore: number; };
  };
}

export interface Config {
  SYSTEM: {
    SCAN_INTERVAL: number;
    TRACKER_INTERVAL: number;
    BATCH_SIZE: number;
    HTTP_PORT: number;
    ENABLE_ADAPTIVE: boolean;
    FORETEST_DAYS?: number;
  };
  SCANNERS: {
    HTF: string;
    LTF: string;
    MIN_HISTORY_HTF: number;
    MIN_HISTORY_LTF: number;
  };
  THRESHOLDS: {
    MIN_SCORE_TO_SAVE: number;
    MIN_SCORE_TRENDING: number;
    MIN_SCORE_SIGNAL: number;
    MAX_TRADE_AGE_HOURS: number;
  };
  INDICATORS: {
    RSI: { PERIOD: number; OVERBOUGHT: number; OVERSOLD: number };
    ADX: { PERIOD: number; STRONG_TREND: number; MIN_TREND: number };
    EMA: { FAST: number; SLOW: number };
    BOL_BANDS: { PERIOD: number; STD_DEV: number };
    OBV: { LOOKBACK: number; THRESHOLD: number };
    PULLBACK: { MIN_DEPTH: number; MAX_DEPTH: number };
    PIVOT_LOOKBACK: number;
  };
  SCORING: {
    TREND: { BASE: number; STRONG_ADX: number; WEAK_BIAS: number };
    STRUCTURE: { FIB: number; LEVEL: number; POOR_RR_PENALTY: number; MED_RR_PENALTY: number };
    MONEY_FLOW: { OBV: number; DIVERGENCE: number };
    TIMING: { PULLBACK: number; REJECTION: number };
    MARKET_CAP?: { SMALL_CAP_REWARD: number; MEGA_CAP_REWARD: number; ENABLE_MCAP_LOGIC: boolean };
    VOLUME?: { HIGH_VOLUME_REWARD: number; ENABLE_VOLUME_LOGIC: boolean };
    PENALTIES: { CONTRARIAN_OBV: number; CONTRARIAN_DIV: number; OVEREXTENDED: number; HIGH_VOL_PULLBACK: number; HIGH_VOLATILITY: number };
  };
  REGIMES?: {
    TRENDING: { TREND_MULTIPLIER: number; STRUCTURE_MULTIPLIER: number; TIMING_MULTIPLIER: number };
  };
  RISK: {
    ATR_MULTIPLIER: number;
    SL_BUFFER: number;
    TP_RR_MIN: number;
    ENTRY_ON_CANDLE_CLOSE?: boolean;
    ENABLE_TIME_BASED_STOP?: boolean;
    TIME_BASED_STOP_CANDLES?: number;
  };
}