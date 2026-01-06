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

export interface TradeSetup {
  entry: number;
  sl: number;
  tp: number;
  rr: number;
  side: 'LONG' | 'SHORT';
  confluenceType?: 'FIB_STRUCTURE' | 'STRUCTURE_ONLY' | 'ATR_REVERSION';
}

export type DataSource = 'KUCOIN' | 'MEXC' | 'HYPERLIQUID';

export interface AnalysisResult {
  symbol: string;
  source: DataSource; // Added source
  price: number;
  score: number;
  setup: TradeSetup | null;
  history?: {
    consecutiveScans: number; // How many consecutive times it appeared (1 = New, 2 = 30m, 3 = 45m, etc)
    prevScore: number;        // Score from the last scan
    status: 'NEW' | 'STABLE' | 'WEAKENING' | 'STRENGTHENING';
  };
  meta: {
    htfInterval: string;
    ltfInterval: string;
  };
  details: {
    trendScore: number;     // Max 25 (Trend Strength & Alignment)
    structureScore: number; // Max 25 (Fib + Support/Res)
    moneyFlowScore: number; // Max 40 (OBV [25] + Divergence [15]) - Heavy weighting
    timingScore: number;    // Max 10 (Pullback & Wick)
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
  activeExchange?: 'MEXC' | 'HYPERLIQUID'; // Preferred execution venue
  geminiLLMApiKey?: string;
}

export interface Config {
  SYSTEM: {
    SCAN_INTERVAL: number;
    TRACKER_INTERVAL: number;
    BATCH_SIZE: number;
    HTTP_PORT: number;
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
    PENALTIES: { CONTRARIAN_OBV: number; CONTRARIAN_DIV: number; OVEREXTENDED: number };
  };
}