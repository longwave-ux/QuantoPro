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

export interface RsiTrendlinePivot {
  index: number;
  value: number;
  time?: number; // Timestamp for robust matching
}

export interface RsiTrendline {
  pivot_1: RsiTrendlinePivot;
  pivot_2: RsiTrendlinePivot;
  slope: number;
  intercept: number;
  equation: string;
}

export interface RsiVisuals {
  resistance?: RsiTrendline;
  support?: RsiTrendline;
}

export interface ScoreComposition {
  // Raw indicator values
  rsi?: number;
  adx?: number;
  ema50?: number;
  ema200?: number;
  close_price?: number;

  // V2 Strategy specific
  oi_z_score?: number;
  oi_z_score_valid?: boolean;
  obv_slope?: number;
  cardwell_range?: string;
  breakout_type?: string | null;
  filters_passed?: {
    oi_zscore?: boolean;
    obv_slope?: boolean;
  };

  // Scoring components
  trend_score?: number;
  structure_score?: number;
  money_flow_score?: number;
  timing_score?: number;
  geometry_score?: number;
  momentum_score?: number;
  oi_flow_score?: number;

  // Weights and multipliers
  adx_strong_trend?: boolean;
  volume_multiplier?: number;
  pullback_detected?: boolean;
  pullback_depth?: number;

  // Trendline data (Breakout strategy)
  trendline_slope?: number;
  trendline_start_idx?: number;
  trendline_end_idx?: number;

  // External data availability
  oi_available?: boolean;
  funding_available?: boolean;
  ls_ratio_available?: boolean;
  liquidations_available?: boolean;

  // Market context
  mcap?: number;
  vol_24h?: number;
  divergence?: string;
  obv_imbalance?: string;
  is_overextended?: boolean;
  atr?: number;
  obv_signal?: string;
}

export interface Observability {
  // Enhanced structure (Tier 1 + Tier 2)
  core_strategy?: {
    name: string;
    scoring_method: string;
    components: any;  // Strategy-specific structure
    total_score: number;
    decision: string;
    filters_passed?: boolean;
    modifiers?: any;
  };
  market_context?: {
    institutional?: {
      oi_z_score: number;
      oi_available: boolean;
      funding_rate?: number | null;
      ls_ratio?: number | null;
      liquidations?: any;
      coinalyze_symbol?: string | null;
      oi_status?: string;
    };
    technical?: {
      adx: number;
      trend: string;
      pullback_detected: boolean;
      pullback_depth: number;
      obv_slope: number;
      obv_imbalance: string;
      volume_ok: boolean;
      is_overextended: boolean;
    };
    rsi_analysis?: {
      current: number;
      cardwell_range: string;
      divergence: string;
      trendlines?: any;
    };
  };

  // Old format (backward compatibility)
  score_composition: ScoreComposition;
  rsi_visuals: RsiVisuals;
  calculated_at: number;
  candle_index: number;
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
  exchange?: string;        // Exchange name (BINANCE, MEXC, etc.)
  canonical_symbol?: string; // Base asset (BTC, ETH, etc.)
  strategy_name?: string;
  strategy?: string;        // ADDED
  bias?: string;
  action?: string;
  price: number;
  score: number;
  total_score?: number;     // ADDED
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
  // Breakout V2 Top-Level Fields
  rr?: number;
  entry?: number;
  stop_loss?: number;
  take_profit?: number;

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
    context_badge?: string; // V2: Context badges (OI DATA, RETEST, etc.)
    setup_type?: string;     // V2: RETEST, INITIAL_BREAKOUT
    retest_quality?: number; // V2: 0-100 quality score for retests
    raw_components?: any;
    score_breakdown?: {
      geometry: number;
      momentum: number;
      base: number;
      total: number;
      sentiment?: number;  // Added for Breakout
      bonuses?: number;    // Added for Breakout
    };
    oi_meta?: {
      oi_slope: number;
      oi_points: number;
      oi_avg: number;
    };
    sentiment_meta?: {
      liq_longs: number;
      liq_shorts: number;
      liq_ratio: number;
      top_ls_ratio: number;
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
  observability?: Observability; // Enhanced visual data enrichment
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