"""
SharedContext - Centralized Data and Indicator Storage
Feature Factory for calculating indicators and external data ONCE per canonical symbol.
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
import pandas as pd
import numpy as np
from symbol_mapper import to_canonical
import os


@dataclass
class SharedContext:
    """
    Centralized context object containing all pre-calculated data and indicators.
    Strategies read from this context instead of computing indicators themselves.
    """
    # Core Identity
    symbol: str  # Original exchange symbol
    canonical_symbol: str  # Canonical base symbol (e.g., BTC)
    exchange: str  # Source exchange
    
    # Price Data
    ltf_data: pd.DataFrame  # Low timeframe candles
    htf_data: Optional[pd.DataFrame] = None  # High timeframe candles
    
    # Technical Indicators (LTF)
    ltf_indicators: Dict[str, Any] = field(default_factory=dict)
    
    # Technical Indicators (HTF)
    htf_indicators: Dict[str, Any] = field(default_factory=dict)
    
    # External Data (Institutional)
    external_data: Dict[str, Any] = field(default_factory=dict)
    
    # Market Metadata
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    # Configuration
    config: Dict[str, Any] = field(default_factory=dict)
    
    def get_ltf_indicator(self, name: str, default=None):
        """Safely retrieve LTF indicator."""
        return self.ltf_indicators.get(name, default)
    
    def get_htf_indicator(self, name: str, default=None):
        """Safely retrieve HTF indicator."""
        return self.htf_indicators.get(name, default)
    
    def get_external(self, name: str, default=None):
        """Safely retrieve external data."""
        return self.external_data.get(name, default)
    
    def get_metadata(self, name: str, default=None):
        """Safely retrieve metadata."""
        return self.metadata.get(name, default)
    
    def has_htf_data(self) -> bool:
        """Check if HTF data is available."""
        return self.htf_data is not None and len(self.htf_data) > 0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert context to dictionary for serialization."""
        return {
            'symbol': self.symbol,
            'canonical_symbol': self.canonical_symbol,
            'exchange': self.exchange,
            'ltf_indicators': self.ltf_indicators,
            'htf_indicators': self.htf_indicators,
            'external_data': self.external_data,
            'metadata': self.metadata,
        }


class FeatureFactory:
    """
    Factory for calculating indicators and external data.
    Plug & Play: Add new indicators by adding methods and config keys.
    """
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize the feature factory with configuration.
        
        Args:
            config: Configuration dict containing indicator settings
        """
        self.config = config
        self.enabled_features = config.get('enabled_features', [])
    
    def build_context(
        self,
        symbol: str,
        exchange: str,
        ltf_data: pd.DataFrame,
        htf_data: Optional[pd.DataFrame] = None,
        metadata: Optional[Dict[str, Any]] = None,
        external_data: Optional[Dict[str, Any]] = None
    ) -> SharedContext:
        """
        Build a complete SharedContext with all enabled features.
        
        Args:
            symbol: Exchange-specific symbol
            exchange: Source exchange
            ltf_data: Low timeframe DataFrame
            htf_data: Optional high timeframe DataFrame
            metadata: Optional metadata dict
            external_data: Pre-fetched external data from batch processor (optional)
            
        Returns:
            Fully populated SharedContext
        """
        # Create canonical symbol
        canonical = to_canonical(symbol, exchange)
        
        # Initialize context
        context = SharedContext(
            symbol=symbol,
            canonical_symbol=canonical,
            exchange=exchange,
            ltf_data=ltf_data,
            htf_data=htf_data,
            metadata=metadata or {},
            config=self.config
        )
        
        # Calculate all features
        self._calculate_ltf_indicators(context)
        
        if context.has_htf_data():
            self._calculate_htf_indicators(context)
        
        # Use pre-fetched data if available, otherwise fetch
        if external_data:
            self._use_prefetched_data(context, external_data)
        else:
            self._fetch_external_data(context)
        
        return context
    
    def _calculate_ltf_indicators(self, context: SharedContext):
        """Calculate all LTF technical indicators with error handling."""
        df = context.ltf_data
        
        if len(df) < 50:
            print(f"[FEATURE_FACTORY] Insufficient LTF data ({len(df)} candles) for {context.symbol}", flush=True)
            return  # Insufficient data
        
        # Import pandas_ta here to avoid circular imports
        import pandas_ta as ta
        
        # RSI
        if self._is_enabled('rsi'):
            try:
                period = self.config.get('rsi_period', 14)
                rsi_series = ta.rsi(df['close'], length=period)
                context.ltf_indicators['rsi'] = rsi_series
                
                # RSI Trendline Pivot Detection for Observability
                if rsi_series is not None and len(rsi_series) > 50:
                    # Pass timestamps for LTF
                    timestamps = df['timestamp'] if 'timestamp' in df.columns else None
                    trendline_data = self._detect_rsi_trendlines(rsi_series, timestamps)
                    if trendline_data:
                        context.ltf_indicators['rsi_trendlines'] = trendline_data
            except Exception as e:
                print(f"[FEATURE_FACTORY] Warning: RSI calculation failed for {context.symbol}: {e}", flush=True)
        
        # EMA
        if self._is_enabled('ema'):
            try:
                fast = self.config.get('ema_fast', 50)
                slow = self.config.get('ema_slow', 200)
                context.ltf_indicators['ema_fast'] = ta.ema(df['close'], length=fast)
                context.ltf_indicators['ema_slow'] = ta.ema(df['close'], length=slow)
            except Exception as e:
                print(f"[FEATURE_FACTORY] Warning: EMA calculation failed for {context.symbol}: {e}", flush=True)
        
        # ADX
        if self._is_enabled('adx'):
            try:
                period = self.config.get('adx_period', 14)
                adx_df = ta.adx(df['high'], df['low'], df['close'], length=period)
                if adx_df is not None and not adx_df.empty:
                    context.ltf_indicators['adx'] = adx_df[f'ADX_{period}']
                    context.ltf_indicators['di_plus'] = adx_df[f'DMP_{period}']
                    context.ltf_indicators['di_minus'] = adx_df[f'DMN_{period}']
            except Exception as e:
                print(f"[FEATURE_FACTORY] Warning: ADX calculation failed for {context.symbol}: {e}", flush=True)
        
        # ATR
        if self._is_enabled('atr'):
            try:
                period = self.config.get('atr_period', 14)
                context.ltf_indicators['atr'] = ta.atr(df['high'], df['low'], df['close'], length=period)
            except Exception as e:
                print(f"[FEATURE_FACTORY] Warning: ATR calculation failed for {context.symbol}: {e}", flush=True)
        
        # Bollinger Bands
        if self._is_enabled('bollinger'):
            try:
                period = self.config.get('bb_period', 20)
                std = self.config.get('bb_std', 2)
                bb_df = ta.bbands(df['close'], length=period, std=std)
                if bb_df is not None and not bb_df.empty:
                    # Flexible column detection for different pandas_ta versions
                    cols = bb_df.columns.tolist()
                    bb_upper_col = [c for c in cols if 'BBU' in str(c)]
                    bb_middle_col = [c for c in cols if 'BBM' in str(c)]
                    bb_lower_col = [c for c in cols if 'BBL' in str(c)]
                    
                    if bb_upper_col and bb_middle_col and bb_lower_col:
                        context.ltf_indicators['bb_upper'] = bb_df[bb_upper_col[0]]
                        context.ltf_indicators['bb_middle'] = bb_df[bb_middle_col[0]]
                        context.ltf_indicators['bb_lower'] = bb_df[bb_lower_col[0]]
            except Exception as e:
                print(f"[FEATURE_FACTORY] Warning: Bollinger Bands calculation failed for {context.symbol}: {e}", flush=True)
        
        # OBV
        if self._is_enabled('obv'):
            try:
                context.ltf_indicators['obv'] = ta.obv(df['close'], df['volume'])
            except Exception as e:
                print(f"[FEATURE_FACTORY] Warning: OBV calculation failed for {context.symbol}: {e}", flush=True)
        
        # MACD (example of plug & play)
        if self._is_enabled('macd'):
            fast = self.config.get('macd_fast', 12)
            slow = self.config.get('macd_slow', 26)
            signal = self.config.get('macd_signal', 9)
            macd_df = ta.macd(df['close'], fast=fast, slow=slow, signal=signal)
            if macd_df is not None and not macd_df.empty:
                context.ltf_indicators['macd'] = macd_df[f'MACD_{fast}_{slow}_{signal}']
                context.ltf_indicators['macd_signal'] = macd_df[f'MACDs_{fast}_{slow}_{signal}']
                context.ltf_indicators['macd_histogram'] = macd_df[f'MACDh_{fast}_{slow}_{signal}']
        
        # Volume SMA
        if self._is_enabled('volume_sma'):
            period = self.config.get('volume_sma_period', 20)
            context.ltf_indicators['volume_sma'] = ta.sma(df['volume'], length=period)
        
        # Stochastic RSI (example of additional indicator)
        if self._is_enabled('stoch_rsi'):
            period = self.config.get('stoch_rsi_period', 14)
            stoch_df = ta.stochrsi(df['close'], length=period)
            if stoch_df is not None and not stoch_df.empty:
                context.ltf_indicators['stoch_rsi_k'] = stoch_df[f'STOCHRSIk_{period}_14_3_3']
                context.ltf_indicators['stoch_rsi_d'] = stoch_df[f'STOCHRSId_{period}_14_3_3']
    
    def _calculate_htf_indicators(self, context: SharedContext):
        """Calculate all HTF technical indicators."""
        df = context.htf_data
        
        if df is None or len(df) < 50:
            return
        
        import pandas_ta as ta
        
        # HTF EMA
        if self._is_enabled('ema'):
            fast = self.config.get('ema_fast', 50)
            slow = self.config.get('ema_slow', 200)
            context.htf_indicators['ema_fast'] = ta.ema(df['close'], length=fast)
            context.htf_indicators['ema_slow'] = ta.ema(df['close'], length=slow)
        
        # HTF ADX
        if self._is_enabled('adx'):
            period = self.config.get('adx_period', 14)
            adx_df = ta.adx(df['high'], df['low'], df['close'], length=period)
            if adx_df is not None and not adx_df.empty:
                context.htf_indicators['adx'] = adx_df[f'ADX_{period}']
        
        # HTF RSI
        if self._is_enabled('rsi'):
            period = self.config.get('rsi_period', 14)
            period = self.config.get('rsi_period', 14)
            rsi_series = ta.rsi(df['close'], length=period)
            context.htf_indicators['rsi'] = rsi_series
            
            # HTF RSI Trendlines (Critical for Breakout V2)
            if rsi_series is not None and len(rsi_series) > 50:
                timestamps = None
                if 'timestamp' in df.columns:
                     timestamps = df['timestamp']
                elif 'time' in df.columns:
                     timestamps = df['time']
                
                trendline_data = self._detect_rsi_trendlines(rsi_series, timestamps)
                if trendline_data:
                    context.htf_indicators['rsi_trendlines'] = trendline_data
        
        # HTF ATR
        if self._is_enabled('atr'):
            period = self.config.get('atr_period', 14)
            context.htf_indicators['atr'] = ta.atr(df['high'], df['low'], df['close'], length=period)
    
    def _use_prefetched_data(self, context: SharedContext, external_data: Dict[str, Any]):
        """
        Use pre-fetched external data from batch processor.
        
        Args:
            context: SharedContext to populate
            external_data: Pre-fetched data dict with keys:
                - oi_history: List of OI data points
                - funding_rate: Float or None
                - ls_ratio: Float or None
                - liquidations: Dict with 'longs' and 'shorts'
                - oi_status: "resolved" | "aggregated" | "neutral"
        """
        import numpy as np
        
        oi_status = external_data.get('oi_status', 'neutral')
        coinalyze_symbol = external_data.get('coinalyze_symbol')
        
        # Store coinalyze_symbol for strategies to access
        if coinalyze_symbol:
            context.external_data['coinalyze_symbol'] = coinalyze_symbol
        
        # Open Interest
        oi_history = external_data.get('oi_history', [])
        if oi_history and len(oi_history) > 0:
            context.external_data['open_interest'] = oi_history
            context.external_data['oi_available'] = True
            context.external_data['oi_status'] = oi_status
            
            # Calculate OI Z-Score with fallback to raw value
            try:
                oi_values = [float(x.get('value', 0)) for x in oi_history if 'value' in x]
                current_oi = oi_values[-1] if oi_values else 0
                
                # FALLBACK SAFETY: Always store the latest raw OI value
                context.external_data['oi_value'] = current_oi
                
                if len(oi_values) >= 14:
                    mean_oi = np.mean(oi_values[-30:])
                    std_oi = np.std(oi_values[-30:])
                    
                    if std_oi > 0:
                        oi_z_score = (current_oi - mean_oi) / std_oi
                        context.external_data['oi_z_score'] = float(oi_z_score)
                        context.external_data['oi_z_score_valid'] = oi_z_score > 1.5
                        print(f"[BATCH] OI Z-Score for {context.symbol}: {oi_z_score:.2f} (Current: {current_oi:.0f})", flush=True)
                    else:
                        # Std dev is 0 - use raw value
                        context.external_data['oi_z_score'] = 0.0
                        context.external_data['oi_z_score_valid'] = False
                        print(f"[BATCH] OI Z-Score invalid (std=0), using raw OI: {current_oi:.0f}", flush=True)
                else:
                    # Insufficient data for Z-score - use raw value
                    context.external_data['oi_z_score'] = 0.0
                    context.external_data['oi_z_score_valid'] = False
                    print(f"[BATCH] OI Z-Score invalid (n={len(oi_values)}), using raw OI: {current_oi:.0f}", flush=True)
            except Exception as e:
                print(f"[BATCH] OI Z-Score calculation failed: {e}, using raw value", flush=True)
                # Still store raw value even if calculation fails
                try:
                    current_oi = oi_values[-1] if oi_values else 0
                    context.external_data['oi_value'] = current_oi
                except:
                    context.external_data['oi_value'] = 0
                context.external_data['oi_z_score'] = 0.0
                context.external_data['oi_z_score_valid'] = False
        else:
            # Neutral - no OI data available
            context.external_data['oi_available'] = False
            context.external_data['oi_z_score_valid'] = False
            context.external_data['oi_status'] = 'neutral'
            context.external_data['oi_value'] = 0
        
        # Funding Rate
        funding_rate = external_data.get('funding_rate')
        if funding_rate is not None:
            context.external_data['funding_rate'] = funding_rate
            context.external_data['funding_available'] = True
        else:
            context.external_data['funding_available'] = False
        
        # Long/Short Ratio
        ls_ratio = external_data.get('ls_ratio')
        if ls_ratio is not None:
            context.external_data['long_short_ratio'] = ls_ratio
            context.external_data['ls_ratio_available'] = True
        else:
            context.external_data['ls_ratio_available'] = False
        
        # Liquidations
        liquidations = external_data.get('liquidations', {})
        if liquidations:
            context.external_data['liquidations'] = liquidations
            context.external_data['liquidations_available'] = True
        else:
            context.external_data['liquidations_available'] = False
    
    def _fetch_external_data(self, context: SharedContext):
        """Fetch external data (OI, funding, sentiment) if enabled with granular error handling."""
        if not self._is_enabled('external_data'):
            return
        
        try:
            from data_fetcher import CoinalyzeClient
            import os
            
            api_key = os.environ.get('COINALYZE_API_KEY')
            if not api_key:
                # Silently skip external data if API key not configured
                context.external_data['oi_available'] = False
                return
            
            client = CoinalyzeClient(api_key)
            symbol = context.symbol
            
            # Open Interest - isolated error handling with caching
            if self._is_enabled('open_interest'):
                try:
                    # Fetch OI history (24 hours) - uses local cache with 15min TTL
                    oi_data = client.get_open_interest_history(symbol, hours=24)
                    if oi_data and len(oi_data) > 0:
                        context.external_data['open_interest'] = oi_data
                        context.external_data['oi_available'] = True
                        
                        print(f"[COINALYZE] Fetched OI for {symbol}: {len(oi_data)} data points (cached)", flush=True)
                        
                        # Calculate OI Z-Score per RSI_calc.md specification
                        # Z-Score = (Current_OI - Mean_OI) / StdDev_OI
                        # Signal valid ONLY if Z-Score > 1.5
                        try:
                            oi_values = [float(x.get('value', 0)) for x in oi_data if 'value' in x]
                            if len(oi_values) >= 14:  # Need sufficient data for statistics
                                current_oi = oi_values[-1]
                                mean_oi = np.mean(oi_values[-30:])  # 30-period mean
                                std_oi = np.std(oi_values[-30:])    # 30-period std dev
                                
                                if std_oi > 0:
                                    oi_z_score = (current_oi - mean_oi) / std_oi
                                    context.external_data['oi_z_score'] = float(oi_z_score)
                                    context.external_data['oi_z_score_valid'] = oi_z_score > 1.5
                                    print(f"[COINALYZE] OI Z-Score for {symbol}: {oi_z_score:.2f} (Valid: {oi_z_score > 1.5})", flush=True)
                                else:
                                    context.external_data['oi_z_score'] = 0.0
                                    context.external_data['oi_z_score_valid'] = False
                            else:
                                context.external_data['oi_z_score'] = 0.0
                                context.external_data['oi_z_score_valid'] = False
                        except Exception as z_err:
                            print(f"[FEATURE_FACTORY] Warning: OI Z-Score calculation failed: {z_err}", flush=True)
                            context.external_data['oi_z_score'] = 0.0
                            context.external_data['oi_z_score_valid'] = False
                    else:
                        context.external_data['oi_available'] = False
                        context.external_data['oi_z_score_valid'] = False
                        print(f"[COINALYZE] No OI data for {symbol}", flush=True)
                except Exception as e:
                    print(f"[FEATURE_FACTORY] Warning: Open Interest fetch failed for {symbol}: {e}", flush=True)
                    context.external_data['oi_available'] = False
                    context.external_data['oi_z_score_valid'] = False
            
            # Funding Rate - isolated error handling with caching
            if self._is_enabled('funding_rate'):
                try:
                    funding_rate = client.get_funding_rate(symbol)
                    if funding_rate is not None:
                        context.external_data['funding_rate'] = funding_rate
                        print(f"[COINALYZE] Funding Rate for {symbol}: {funding_rate:.4f}% (cached)", flush=True)
                except Exception as e:
                    print(f"[FEATURE_FACTORY] Warning: Funding Rate fetch failed for {symbol}: {e}", flush=True)
            
            # Long/Short Ratio - isolated error handling with caching
            if self._is_enabled('long_short_ratio'):
                try:
                    ls_ratio = client.get_ls_ratio_top_traders(symbol)
                    if ls_ratio is not None:
                        context.external_data['long_short_ratio'] = ls_ratio
                        print(f"[COINALYZE] L/S Ratio for {symbol}: {ls_ratio:.2f} (cached)", flush=True)
                except Exception as e:
                    print(f"[FEATURE_FACTORY] Warning: Long/Short Ratio fetch failed for {symbol}: {e}", flush=True)
            
            # Liquidations - isolated error handling with caching
            if self._is_enabled('liquidations'):
                try:
                    liq_data = client.get_liquidation_history(symbol, interval='15min', lookback=3)
                    if liq_data:
                        context.external_data['liquidations'] = liq_data
                        print(f"[COINALYZE] Liquidations for {symbol}: L={liq_data.get('longs', 0):.0f}, S={liq_data.get('shorts', 0):.0f} (cached)", flush=True)
                except Exception as e:
                    print(f"[FEATURE_FACTORY] Warning: Liquidations fetch failed for {symbol}: {e}", flush=True)
        
        except Exception as e:
            print(f"[FEATURE_FACTORY] Error initializing external data client for {context.symbol}: {e}", flush=True)
            context.external_data['oi_available'] = False
    
    def _is_enabled(self, feature: str) -> bool:
        """Check if a feature is enabled in config."""
        # If no enabled_features list, enable all by default
        if not self.enabled_features:
            return True
        return feature in self.enabled_features
    
    def _detect_rsi_trendlines(self, rsi_series: pd.Series, timestamp_series: pd.Series = None) -> Dict[str, Any]:
        """
        Detect RSI trendline pivots using k-order pivot logic per RSI_calc.md specification.
        
        SPECIFICATION COMPLIANCE:
        - Order (k): 5 bars (configurable 5-7)
        - A point is a Pivot High if: RSI_t > RSI_{t +/- i} for i in [1, k]
        - Trendline Validation: No intermediate RSI points can violate the line
        
        Args:
            rsi_series: RSI values as pandas Series
            timestamp_series: Optional Series of timestamps corresponding to RSI series
            
        Returns:
            Dictionary containing validated pivot coordinates and trendline parameters
        """
        result = {}
        rsi_values = rsi_series.dropna().values
        
        if len(rsi_values) < 50:
            return result
        
        
        # Configuration per spec
        k_order = self.config.get('rsi_pivot_order', 5)  # 5 to 7 bars
        lookback = self.config.get('rsi_trendline_lookback', 100)
        
        # Use only recent data
        recent_rsi = rsi_values[-lookback:] if len(rsi_values) > lookback else rsi_values
        offset = len(rsi_values) - len(recent_rsi)
        
        # Dataframe/Series alignment for Timestamps
        timestamps = None
        if timestamp_series is not None:
             # Align timestamps: RSI array index -> Original Index -> Timestamp
             # If RSI has dropped NaNs (first 14), we need to handle that.
             # rsi_series has same index as original df (if strictly computed), but rsi_values is a numpy array (no index).
             # We assume rsi_values represents the TAIL of the data if NaNs were validly handled by caller
             # But here we used rsi_series.dropna().values.
             
             # Re-align:
             valid_indices = rsi_series.dropna().index
             if len(valid_indices) == len(rsi_values):
                 timestamps = timestamp_series.loc[valid_indices].values
                
        # Helper to get timestamp for an index in the 'recent_rsi' array
        def get_ts(idx_in_recent):
            if timestamps is None:
                return 0
            # idx_in_recent is relative to recent_rsi
            # absolute index in rsi_values is idx_in_recent + offset
            abs_idx = idx_in_recent + offset
            if abs_idx < len(timestamps):
                return int(timestamps[abs_idx])
            return 0

        # Detect RESISTANCE (Pivot Highs)
        try:
            pivot_highs = self._find_k_order_pivots(recent_rsi, k_order, 'HIGH')
            
            if len(pivot_highs) >= 2:
                # Find best valid trendline (chronological, no violations)
                trendline = self._find_valid_trendline(recent_rsi, pivot_highs, 'RESISTANCE')
                
                if trendline:
                    # Convert relative indices to absolute
                    p1_idx = int(trendline['p1_idx'] + offset)
                    p2_idx = int(trendline['p2_idx'] + offset)
                    p1_val = float(rsi_values[p1_idx])
                    p2_val = float(rsi_values[p2_idx])
                    slope = trendline['slope']
                    
                    # CRITICAL: Recalculate intercept with ABSOLUTE indices
                    # Slope is same, but intercept changes when we shift coordinates
                    intercept = p1_val - (slope * p1_idx)
                    
                    # Calculate Reverse RSI (breakout price)
                    reverse_rsi_data = self._calculate_reverse_rsi(
                        rsi_values, p2_idx, slope, intercept, len(rsi_values) - 1
                    )
                    
                    # Convert relative pivot indices to absolute
                    touch_indices = [int(idx + offset) for idx in trendline.get('pivot_indices', [])]
                    
                    result['resistance'] = {
                        'pivot_1': {'index': p1_idx, 'value': p1_val, 'time': get_ts(trendline['p1_idx'])},
                        'pivot_2': {'index': p2_idx, 'value': p2_val, 'time': get_ts(trendline['p2_idx'])},
                        'slope': float(slope),
                        'intercept': float(intercept),
                        'equation': f"y = {slope:.4f}x + {intercept:.2f}",
                        'reverse_rsi': reverse_rsi_data,  # Breakout price calculation
                        'touches_count': trendline.get('pivots_touched', 2),
                        'touch_indices': touch_indices
                    }
        except Exception as e:
            print(f"[FEATURE_FACTORY] Warning: RSI resistance trendline detection failed: {e}", flush=True)
        
        # Detect SUPPORT (Pivot Lows)
        try:
            pivot_lows = self._find_k_order_pivots(recent_rsi, k_order, 'LOW')
            
            if len(pivot_lows) >= 2:
                # Find best valid trendline (chronological, no violations)
                trendline = self._find_valid_trendline(recent_rsi, pivot_lows, 'SUPPORT')
                
                if trendline:
                    # Convert relative indices to absolute
                    p1_idx = int(trendline['p1_idx'] + offset)
                    p2_idx = int(trendline['p2_idx'] + offset)
                    p1_val = float(rsi_values[p1_idx])
                    p2_val = float(rsi_values[p2_idx])
                    slope = trendline['slope']
                    
                    # CRITICAL: Recalculate intercept with ABSOLUTE indices
                    # Slope is same, but intercept changes when we shift coordinates
                    intercept = p1_val - (slope * p1_idx)
                    
                    # Calculate Reverse RSI (breakout price)
                    reverse_rsi_data = self._calculate_reverse_rsi(
                        rsi_values, p2_idx, slope, intercept, len(rsi_values) - 1
                    )
                    
                    # Convert relative pivot indices to absolute
                    touch_indices = [int(idx + offset) for idx in trendline.get('pivot_indices', [])]
                    
                    result['support'] = {
                        'pivot_1': {'index': p1_idx, 'value': p1_val, 'time': get_ts(trendline['p1_idx'])},
                        'pivot_2': {'index': p2_idx, 'value': p2_val, 'time': get_ts(trendline['p2_idx'])},
                        'slope': float(slope),
                        'intercept': float(intercept),
                        'equation': f"y = {slope:.4f}x + {intercept:.2f}",
                        'reverse_rsi': reverse_rsi_data,  # Breakout price calculation
                        'touches_count': trendline.get('pivots_touched', 2),
                        'touch_indices': touch_indices
                    }
        except Exception as e:
            print(f"[FEATURE_FACTORY] Warning: RSI support trendline detection failed: {e}", flush=True)
        
        return result
    
    def _find_k_order_pivots(self, rsi_values: np.ndarray, k: int, pivot_type: str) -> list:
        """
        Find k-order pivots per specification.
        
        A point is a Pivot High if: RSI_t > RSI_{t +/- i} for i in [1, k]
        A point is a Pivot Low if: RSI_t < RSI_{t +/- i} for i in [1, k]
        """
        pivots = []
        
        for i in range(k, len(rsi_values) - k):
            is_pivot = True
            
            # Check k bars before and after
            for offset in range(1, k + 1):
                if pivot_type == 'HIGH':
                    # Must be higher than all surrounding bars
                    if rsi_values[i] <= rsi_values[i - offset] or rsi_values[i] <= rsi_values[i + offset]:
                        is_pivot = False
                        break
                else:  # LOW
                    # Must be lower than all surrounding bars
                    if rsi_values[i] >= rsi_values[i - offset] or rsi_values[i] >= rsi_values[i + offset]:
                        is_pivot = False
                        break
            
            if is_pivot:
                pivots.append({'index': i, 'value': rsi_values[i]})
        
        return pivots
    
    def _find_valid_trendline(self, rsi_values: np.ndarray, pivots: list, direction: str) -> Dict[str, Any]:
        """
        Find trendline touching MAXIMUM pivots (TradingView-style).
        
        KEY PHILOSOPHY: Best trendline = Most pivot touches + Long duration
        
        This is how professional traders draw trendlines:
        - Start from extreme zone pivot
        - Draw line that touches as many pivots as possible
        - Longer + more touches = More significant
        
        FILTERS:
        1. First pivot must be in extreme zone (>70 for resistance, <30 for support)
        2. Minimum distance between first and last pivot (at least 14 candles)
        3. Slope must be meaningful (not too flat or too steep)
        
        SCORING:
        - Primary: NUMBER OF PIVOTS TOUCHED (like your TradingView line with 5+ touches)
        - Secondary: Duration (longer is better)
        - Bonus: Optimal slope range
        
        Trendline Validation: No intermediate RSI points can violate the line.
        """
        if len(pivots) < 2:
            return None
        
        # Get configuration parameters
        min_slope = self.config.get('rsi_min_slope', 0.05)
        max_slope = self.config.get('rsi_max_slope', 2.0)
        tolerance = self.config.get('rsi_tolerance', 0.5)
        min_distance = self.config.get('rsi_min_pivot_distance', 14)
        
        # First pivot thresholds
        if direction == 'RESISTANCE':
            first_pivot_threshold = self.config.get('rsi_first_pivot_resistance_min', 70)
        else:
            first_pivot_threshold = self.config.get('rsi_first_pivot_support_max', 30)
        
        # Track all valid trendlines with scores
        valid_trendlines = []
        
        # OPTIMIZATION: Limit pivot search to first 5-10 pivots in extreme zone
        # This prevents exponential slowdown with k=3
        extreme_pivots = [p for p in pivots if (direction == 'RESISTANCE' and p['value'] >= first_pivot_threshold) or
                          (direction == 'SUPPORT' and p['value'] <= first_pivot_threshold)]
        
        # Use only first 10 extreme pivots to avoid combinatorial explosion
        search_pivots = extreme_pivots[:10] if len(extreme_pivots) > 10 else extreme_pivots
        
        # Try pairs of pivots to define possible trendlines
        # OPTIMIZATION: Only check reasonable pairs (not all combinations)
        # Try pairs of pivots to define possible trendlines
        # OPTIMIZATION: P1 must be extreme, but P2 can be any pivot after P1
        p1_candidates = extreme_pivots[:5]  # Only try first 5 extreme pivots as start points
        
        for i in range(len(p1_candidates)):
            p1 = p1_candidates[i]
            
            # Find P2 candidates: all pivots after p1
            # We can limit search depth if needed, but checking all usually fine for k=3 (15-20 pivots total)
            start_j_idx = -1
            for idx, p in enumerate(pivots):
                if p['index'] == p1['index']:
                    start_j_idx = idx
                    break
            
            if start_j_idx == -1: continue
            
            # Check potential P2s
            for j in range(start_j_idx + 1, len(pivots)):
                p2 = pivots[j]
                
                # Calculate distance between defining pivots
                duration = p2['index'] - p1['index']
                
                # FILTER: Minimum distance between first and last pivot
                if duration < min_distance:
                    continue  # Skip, pivots too close together
                
                # Calculate trendline parameters
                slope = (p2['value'] - p1['value']) / duration
                intercept = p1['value'] - (slope * p1['index'])
                
                # CRITICAL FILTER: Reject lines that project outside RSI bounds
                # Project to END of recent data (not just P2+20)
                last_idx = len(rsi_values) - 1  # Last index in the recent RSI data
                projected_end = slope * last_idx + intercept
                
                # Skip lines that go way out of bounds (prevents -200 RSI lines)
                if projected_end < -10 or projected_end > 110:
                    continue  # Line will go too far out of range
                
                # FILTER: Slope must be meaningful (not too flat or steep)
                if abs(slope) < min_slope or abs(slope) > max_slope:
                    continue  # Skip, slope not meaningful
                
                # Validate line and COUNT ALL PIVOTS IT TOUCHES
                valid = True
                pivots_touched = []  # List of pivot indices this line touches
                
                # Check if P1 and P2 touch the line (they define it, so they do)
                # Check P1-P2 context
                # Check ALL points between p1 and p2
                for idx in range(p1['index'] + 1, p2['index']):
                    projected = slope * idx + intercept
                    actual = rsi_values[idx]
                    
                    # Check if this index is a pivot point
                    is_pivot_at_idx = any(p['index'] == idx for p in pivots)
                    
                    # If it's a pivot, check if it touches the line
                    if is_pivot_at_idx:
                        dist = abs(actual - projected)
                        if dist <= tolerance:
                            pivots_touched.append(idx)  # This pivot touches the line!
                    
                    # Validate non-violation for ALL points (pivot or not)
                    if direction == 'RESISTANCE':
                        # No point should be above the resistance line
                        if actual > projected + tolerance:
                            valid = False
                            break
                    else:  # SUPPORT
                        # No point should be below the support line
                        if actual < projected - tolerance:
                            valid = False
                            break
                
                if not valid:
                    continue  # Line has violations, skip it
                
                # Restore P1 and P2 (accidentally removed)
                pivots_touched.append(p1['index'])
                pivots_touched.append(p2['index'])

                # EXTENDED CHECK: Count touches AFTER P2
                # This helps find lines that align with future pivots even if they aren't the defining P2
                for idx in range(p2['index'] + 1, len(rsi_values)):
                    projected = slope * idx + intercept
                    actual = rsi_values[idx]
                    is_pivot_at_idx = any(p['index'] == idx for p in pivots)
                    if is_pivot_at_idx:
                        dist = abs(actual - projected)
                        if dist <= tolerance:
                            pivots_touched.append(idx)
                
                # CRITICAL FILTER: Reject lines that project WAY outside RSI bounds
                # Project to P2 + 20 candles to see if line stays reasonable
                future_idx = p2['index'] + 20
                projected_future = slope * future_idx + intercept
                
                # Skip lines that go way out of bounds (prevents -200 RSI lines)
                if projected_future < -10 or projected_future > 110:
                    continue  # Line will go too far out of range
                
                # Count unique pivots touched
                total_pivots_touched = len(set(pivots_touched))
                
                # SCORING: Prioritize PIVOT TOUCHES (like TradingView manual drawing)
                # A 5-touch line is MUCH better than a 2-touch line
                
                # Base score: Pivots touched (WEIGHTED HEAVILY)
                # Each pivot touch is worth 20 points
                pivot_score = total_pivots_touched * 20
                
                # Duration bonus (longer is better, but secondary to touches)
                # Each candle is worth 1 point
                duration_score = duration
                
                # Bonus for optimal slope (within ideal range)
                slope_bonus = 0
                ideal_slope_min = 0.1
                ideal_slope_max = 1.0
                if ideal_slope_min <= abs(slope) <= ideal_slope_max:
                    slope_bonus = 10  # Bonus for ideal slope
                
                # Total score = (Pivots × 20) + Duration + Slope Bonus
                # Example: 5 pivots + 71 duration + 10 slope = 100 + 71 + 10 = 181 points
                total_score = pivot_score + duration_score + slope_bonus
                
                valid_trendlines.append({
                    'p1_idx': p1['index'],
                    'p2_idx': p2['index'],
                    'slope': slope,
                    'intercept': intercept,
                    'duration': duration,
                    'pivots_touched': total_pivots_touched,
                    'pivot_indices': pivots_touched,  # For debugging
                    'score': total_score
                })
        
        # Select best trendline (most pivots touched + longest duration)
        if not valid_trendlines:
            return None
        
        # Sort by score (descending) and return best
        best_trendline = max(valid_trendlines, key=lambda x: x['score'])
        
        return best_trendline
    
    def _calculate_reverse_rsi(self, rsi_values: np.ndarray, last_pivot_idx: int, 
                                slope: float, intercept: float, current_idx: int) -> Dict[str, Any]:
        """
        Calculate Reverse RSI: the exact price where RSI will hit the trendline.
        
        Per RSI_calc.md specification:
        - RS_target = RSI_TL / (100 - RSI_TL)
        - P_entry = Close_prev + [(RS_target * AvgD_prev * 13) - (AvgU_prev * 13)] / (1 + RS_target)
        
        Note: This requires access to AvgU and AvgD from RSI calculation.
        For now, we return the projected RSI value and index.
        Full implementation requires storing AvgU/AvgD in context.
        """
        # Project RSI at current candle
        rsi_tl = slope * current_idx + intercept
        rsi_tl = max(0, min(100, rsi_tl))  # Clamp to valid RSI range
        
        return {
            'projected_rsi': float(rsi_tl),
            'projection_index': int(current_idx),
            'note': 'Full Reverse RSI price calculation requires AvgU/AvgD from RSI internals'
        }


def create_default_config() -> Dict[str, Any]:
    """Create default configuration for FeatureFactory."""
    return {
        'enabled_features': [
            'rsi', 'ema', 'adx', 'atr', 'bollinger', 'obv',
            'volume_sma', 'external_data', 'open_interest',
            'funding_rate', 'long_short_ratio', 'liquidations'
        ],
        'rsi_period': 14,
        'ema_fast': 50,
        'ema_slow': 200,
        'adx_period': 14,
        'atr_period': 14,
        'bb_period': 20,
        'bb_std': 2,
        'volume_sma_period': 20,
        'macd_fast': 12,
        'macd_slow': 26,
        'macd_signal': 9,
        'stoch_rsi_period': 14,
        # RSI Trendline Detection Parameters
        'rsi_pivot_order': 3,  # k-order for pivot detection (lower = more pivots, like TradingView)
        'rsi_trendline_lookback': 150,  # 150 4H candles = ~25 days lookback
        'rsi_min_slope': 0.05,  # Minimum absolute slope to avoid flat lines
        'rsi_max_slope': 2.0,  # Maximum absolute slope to avoid steep lines
        'rsi_tolerance': 1.0,  # Tolerance for trendline validation (±1.0 RSI points, more lenient)
        'rsi_first_pivot_resistance_min': 70,  # Minimum RSI for first resistance pivot
        'rsi_first_pivot_support_max': 30,  # Maximum RSI for first support pivot
        'rsi_min_pivot_distance': 14,  # Minimum candles between p1 and p2 (longer = better)
    }
