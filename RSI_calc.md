# Quantitative Strategy Specification: RSI Trendline Breakout & Reverse RSI

## 1. RSI Core Calculation (Wilder Smoothing)
The RSI MUST use the Smoothed Moving Average (SMMA/Wilder) method, not the simple EMA.
- Period (N): 14
- Recursive Formula: 
  - AvgU_t = (AvgU_{t-1} * 13 + U_t) / 14
  - AvgD_t = (AvgD_{t-1} * 13 + D_t) / 14

## 2. Pivot Detection Logic (Geometric Anchors)
To draw accurate trendlines, the Pivot Detector must find local maxima/minima:
- Order (k): 5 to 7 bars.
- A point is a Pivot High if: RSI_t > RSI_{t +/- i} for i in [1, k].
- Trendline Validation: No intermediate RSI points between Pivot 1 and Pivot 2 can violate the line.

## 3. Reverse RSI Formula (The "Leading" Indicator)
To calculate the exact price ($P_{entry}$) where RSI hits the Trendline ($RSI_{TL}$):
- $RS_{target} = RSI_{TL} / (100 - RSI_{TL})$
- $P_{entry} = Close_{prev} + \frac{(RS_{target} * AvgD_{prev} * 13) - (AvgU_{prev} * 13)}{1 + RS_{target}}$

## 4. Range Rules (Cardwell Shift)
The scoring must be weighted based on the current RSI Range:
- Bull Market Range: 40 - 80 (Support at 40 is a Buy signal).
- Bear Market Range: 20 - 60 (Resistance at 60 is a Sell signal).
- Range Shift: A break of RSI 60 to the upside is a structural Bullish shift.

## 5. Institutional Confirmation (Filters)
A signal is valid ONLY if confirmed by:
- **OI Z-Score:** (Current_OI - Mean_OI) / StdDev_OI > 1.5.
- **OBV Slope:** Linear regression slope of OBV over 14 periods must be POSITIVE for Longs.

## 6. Exit & Risk Management
- **Stop Loss (ATR):** Entry - (3.0 * ATR_14).
- **Take Profit (Cardwell):** Project the amplitude of the momentum (H_mom + (H_mom - L_mom)).
- **Secondary Target:** 1.618 Fibonacci extension of the previous impulse.