"""
SharedContext - Centralized Data and Indicator Storage
Feature Factory for calculating indicators and external data ONCE per canonical symbol.
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
import pandas as pd
import numpy as np
from symbol_mapper import to_canonical


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
                    trendline_data = self._detect_rsi_trendlines(rsi_series)
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
            context.htf_indicators['rsi'] = ta.rsi(df['close'], length=period)
        
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
        
        # Open Interest
        oi_history = external_data.get('oi_history', [])
        if oi_history and len(oi_history) > 0:
            context.external_data['open_interest'] = oi_history
            context.external_data['oi_available'] = True
            context.external_data['oi_status'] = oi_status
            
            # Calculate OI Z-Score
            try:
                oi_values = [float(x.get('value', 0)) for x in oi_history if 'value' in x]
                if len(oi_values) >= 14:
                    current_oi = oi_values[-1]
                    mean_oi = np.mean(oi_values[-30:])
                    std_oi = np.std(oi_values[-30:])
                    
                    if std_oi > 0:
                        oi_z_score = (current_oi - mean_oi) / std_oi
                        context.external_data['oi_z_score'] = float(oi_z_score)
                        context.external_data['oi_z_score_valid'] = oi_z_score > 1.5
                    else:
                        context.external_data['oi_z_score'] = 0.0
                        context.external_data['oi_z_score_valid'] = False
                else:
                    context.external_data['oi_z_score'] = 0.0
                    context.external_data['oi_z_score_valid'] = False
            except Exception as e:
                print(f"[BATCH] OI Z-Score calculation failed: {e}", flush=True)
                context.external_data['oi_z_score'] = 0.0
                context.external_data['oi_z_score_valid'] = False
        else:
            # Neutral - no OI data available
            context.external_data['oi_available'] = False
            context.external_data['oi_z_score_valid'] = False
            context.external_data['oi_status'] = 'neutral'
        
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
    
    def _detect_rsi_trendlines(self, rsi_series: pd.Series) -> Dict[str, Any]:
        """
        Detect RSI trendline pivots using k-order pivot logic per RSI_calc.md specification.
        
        SPECIFICATION COMPLIANCE:
        - Order (k): 5 bars (configurable 5-7)
        - A point is a Pivot High if: RSI_t > RSI_{t +/- i} for i in [1, k]
        - Trendline Validation: No intermediate RSI points can violate the line
        
        Args:
            rsi_series: RSI values as pandas Series
            
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
        
        # Detect RESISTANCE (Pivot Highs)
        try:
            pivot_highs = self._find_k_order_pivots(recent_rsi, k_order, 'HIGH')
            
            if len(pivot_highs) >= 2:
                # Find best valid trendline (chronological, no violations)
                trendline = self._find_valid_trendline(recent_rsi, pivot_highs, 'RESISTANCE')
                
                if trendline:
                    p1_idx = int(trendline['p1_idx'] + offset)
                    p2_idx = int(trendline['p2_idx'] + offset)
                    p1_val = float(rsi_values[p1_idx])
                    p2_val = float(rsi_values[p2_idx])
                    slope = trendline['slope']
                    intercept = trendline['intercept']
                    
                    # Calculate Reverse RSI (breakout price)
                    reverse_rsi_data = self._calculate_reverse_rsi(
                        rsi_values, p2_idx, slope, intercept, len(rsi_values) - 1
                    )
                    
                    result['resistance'] = {
                        'pivot_1': {'index': p1_idx, 'value': p1_val},
                        'pivot_2': {'index': p2_idx, 'value': p2_val},
                        'slope': float(slope),
                        'intercept': float(intercept),
                        'equation': f"y = {slope:.4f}x + {intercept:.2f}",
                        'reverse_rsi': reverse_rsi_data  # Breakout price calculation
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
                    p1_idx = int(trendline['p1_idx'] + offset)
                    p2_idx = int(trendline['p2_idx'] + offset)
                    p1_val = float(rsi_values[p1_idx])
                    p2_val = float(rsi_values[p2_idx])
                    slope = trendline['slope']
                    intercept = trendline['intercept']
                    
                    # Calculate Reverse RSI (breakout price)
                    reverse_rsi_data = self._calculate_reverse_rsi(
                        rsi_values, p2_idx, slope, intercept, len(rsi_values) - 1
                    )
                    
                    result['support'] = {
                        'pivot_1': {'index': p1_idx, 'value': p1_val},
                        'pivot_2': {'index': p2_idx, 'value': p2_val},
                        'slope': float(slope),
                        'intercept': float(intercept),
                        'equation': f"y = {slope:.4f}x + {intercept:.2f}",
                        'reverse_rsi': reverse_rsi_data  # Breakout price calculation
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
        Find valid trendline with NO violations between pivots.
        
        Trendline Validation: No intermediate RSI points between Pivot 1 and Pivot 2 can violate the line.
        """
        if len(pivots) < 2:
            return None
        
        # Try pairs of pivots chronologically
        for i in range(len(pivots) - 1):
            for j in range(i + 1, len(pivots)):
                p1 = pivots[i]
                p2 = pivots[j]
                
                # Calculate trendline
                slope = (p2['value'] - p1['value']) / (p2['index'] - p1['index'])
                intercept = p1['value'] - (slope * p1['index'])
                
                # Validate: check all intermediate points
                valid = True
                for idx in range(p1['index'] + 1, p2['index']):
                    projected = slope * idx + intercept
                    actual = rsi_values[idx]
                    
                    if direction == 'RESISTANCE':
                        # No point should be above the resistance line
                        if actual > projected + 0.5:  # Small tolerance for noise
                            valid = False
                            break
                    else:  # SUPPORT
                        # No point should be below the support line
                        if actual < projected - 0.5:  # Small tolerance for noise
                            valid = False
                            break
                
                if valid:
                    return {
                        'p1_idx': p1['index'],
                        'p2_idx': p2['index'],
                        'slope': slope,
                        'intercept': intercept
                    }
        
        return None
    
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
    }
