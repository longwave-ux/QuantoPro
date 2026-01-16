# QuantPro - Automated Trading Signal Scanner

**Version:** 2.0  
**Last Updated:** January 16, 2026  
**Status:** Production Ready

---

## Overview

QuantPro is a high-performance cryptocurrency trading signal scanner that combines technical analysis, institutional data (Open Interest, Funding Rates, L/S Ratios), and multiple trading strategies to identify high-probability trade setups across 1100+ trading pairs.

### Key Features

- 🎯 **Multi-Strategy Analysis** - Legacy, Breakout V1, and Breakout V2 strategies
- 📊 **Institutional Data Integration** - Real-time OI, funding rates, liquidations via Coinalyze API
- ⚡ **Batch Processing** - Efficient API usage with intelligent caching (1-hour TTL)
- 🔍 **Full Observability** - Complete score composition and diagnostic data for every signal
- 🚀 **Performance Optimized** - Scans 1100+ pairs in ~5 minutes with rate-limit resilience
- 📈 **Real-time Dashboard** - React-based UI with live market data and AI analysis

---

## Quick Start

### Installation

```bash
# Clone repository
git clone <repository-url>
cd QuantPro

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
npm install

# Configure API keys
cp .env.example .env
# Edit .env and add your API keys:
# - COINALYZE_API_KEY=your_key_here
# - GEMINI_API_KEY=your_key_here (optional, for AI analysis)
```

### Running a Scan

```bash
# Quick test (2 symbols)
python market_scanner_refactored.py data/ --strategy BreakoutV2 --limit 2

# Medium scan (100 symbols)
python market_scanner_refactored.py data/ --strategy BreakoutV2 --limit 100

# Full scan (all symbols)
python market_scanner_refactored.py data/ --strategy all

# Start the dashboard
npm start
```

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ ScannerTable │  │ DetailPanel  │  │ Observability│     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ HTTP (JSON)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend (Node.js)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   server.js  │  │  scanner.js  │  │ analysis.js  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ Subprocess
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Market Scanner (Python)                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         market_scanner_refactored.py                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Strategies   │  │ SharedContext│  │ Batch Processor│   │
│  │ - Legacy     │  │ - Indicators │  │ - Coinalyze  │     │
│  │ - Breakout   │  │ - Features   │  │ - Caching    │     │
│  │ - BreakoutV2 │  │              │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ API Calls
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  External Data Sources                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Coinalyze   │  │    MEXC      │  │ Hyperliquid  │     │
│  │  (OI, FR,    │  │  (Price Data)│  │ (Price Data) │     │
│  │   L/S, Liq)  │  │              │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Data Collection** - Market scanner loads OHLCV data from JSON files
2. **Batch Processing** - Symbols resolved to Coinalyze format, external data fetched in batches
3. **Context Building** - SharedContext combines price data + indicators + external data
4. **Strategy Analysis** - Each strategy analyzes the context and returns signals
5. **Aggregation** - Results aggregated into `master_feed.json` with observability
6. **Frontend Display** - Dashboard fetches and displays signals with score composition

---

## Strategies

### 1. Legacy Strategy

**Focus:** Multi-factor scoring with trend, structure, money flow, and timing

**Key Metrics:**
- Trend Score (0-25): EMA alignment, ADX strength
- Structure Score (0-25): Pullback depth, Fibonacci levels
- Money Flow Score (0-25): OBV imbalance, volume confirmation
- Timing Score (0-25): RSI position, momentum alignment

**Entry Criteria:**
- Total score > threshold (configurable)
- HTF bias alignment
- Volume confirmation
- Pullback within acceptable range

### 2. Breakout Strategy

**Focus:** RSI trendline breakouts with institutional confirmation

**Key Metrics:**
- Geometry Score (0-40): Trendline quality, breakout strength
- Momentum Score (0-40): RSI momentum, divergence detection
- OI Flow Score (0-20): Open Interest confirmation

**Entry Criteria:**
- RSI trendline breakout (resistance for LONG, support for SHORT)
- OI Z-Score > 1.5 (institutional confirmation)
- OBV slope alignment with bias
- Cardwell range compliance

### 3. Breakout V2 Strategy (Recommended)

**Focus:** Cardwell RSI methodology with strict institutional filters

**Key Metrics:**
- OI Z-Score: Institutional flow (HARD REQUIREMENT: > 1.5)
- OBV Slope: Money flow direction (HARD REQUIREMENT: aligned with bias)
- Cardwell Range: RSI classification (BULLISH, BEARISH, NEUTRAL, OVERBOUGHT, OVERSOLD)
- Breakout Type: RESISTANCE_BREAK or SUPPORT_BREAK

**Entry Criteria (ALL REQUIRED):**
1. OI Z-Score > 1.5 (MANDATORY)
2. OBV Slope > 0 for LONG, < 0 for SHORT (MANDATORY)
3. RSI trendline breakout confirmed
4. Cardwell range compliance

**Why V2 is Recommended:**
- Strictest filters reduce false signals
- Institutional confirmation ensures high-probability setups
- Cardwell methodology provides clear RSI context
- Full observability for every signal (including WAIT)

---

## Configuration

### Environment Variables

```bash
# Required
COINALYZE_API_KEY=your_api_key_here

# Optional
GEMINI_API_KEY=your_gemini_key_here  # For AI analysis
PORT=3001                             # Backend server port
```

### Strategy Configuration

Edit `strategy_config.py` to customize strategy parameters:

```python
# Example: Adjust BreakoutV2 thresholds
BREAKOUT_V2_CONFIG = {
    'oi_z_score_threshold': 1.5,  # Institutional confirmation
    'obv_period': 14,              # OBV slope calculation period
    'atr_multiplier': 1.5,         # Stop-loss distance
    'cardwell_ranges': {
        'BULLISH': (40, 80),
        'BEARISH': (20, 60),
        # ...
    }
}
```

### Scanner Options

```bash
# Limit number of symbols
--limit 100

# Specific strategy
--strategy BreakoutV2  # Options: all, Legacy, Breakout, BreakoutV2

# Specific symbol
--symbol BTCUSDT

# Custom output file
--output custom_feed.json
```

---

## Performance

### Scan Times

| Symbols | Strategy | Time | API Calls |
|---------|----------|------|-----------|
| 2 | BreakoutV2 | ~5s | 4 |
| 10 | BreakoutV2 | ~15s | 4 |
| 100 | BreakoutV2 | ~2min | 20 |
| 1112 (Full) | All | ~5-6min | ~176 |

### Cache Optimization

- **Cache TTL:** 1 hour (3600 seconds)
- **Cache Hit Rate:** ~100% for repeated scans within 1 hour
- **Storage:** `data/coinalyze_cache/`

### Rate Limiting

- **Coinalyze API:** 40 requests/min
- **Implementation:** 1.5s spacing + Retry-After header respect
- **Resilience:** Automatic backoff on 429 errors

---

## Output Format

### Master Feed Structure

```json
{
  "last_updated": 1768556245031,
  "signals": [
    {
      "strategy_name": "BreakoutV2",
      "strategy": "BreakoutV2",
      "symbol": "BTCUSDT",
      "canonical_symbol": "BTC",
      "exchange": "BINANCE",
      "price": 42000.50,
      "score": 45.3,
      "total_score": 45.3,
      "bias": "LONG",
      "action": "LONG",
      "setup": {
        "entry": 42100.00,
        "sl": 41500.00,
        "tp": 44200.00,
        "rr": 3.5,
        "side": "LONG"
      },
      "observability": {
        "score_composition": {
          "oi_z_score": 2.5,
          "obv_slope": 0.15,
          "cardwell_range": "BULLISH",
          "trend_score": 25.0,
          "structure_score": 15.0,
          "money_flow_score": 16.25,
          "timing_score": 20.0
        },
        "rsi_visuals": { ... }
      },
      "oi_metadata": {
        "status": "aggregated",
        "coinalyze_symbol": "BTCUSDT_PERP.A",
        "value": 1250000000
      }
    }
  ]
}
```

---

## Troubleshooting

### Common Issues

**Issue:** `--limit` parameter not working
- **Solution:** Ensure you're using the latest code with the limit fix

**Issue:** Observability is null in output
- **Solution:** Run a fresh scan to regenerate signals with new structure

**Issue:** Rate limiting errors (429)
- **Solution:** Reduce scan frequency or use `--limit` for testing

**Issue:** Cache not being used
- **Solution:** Clear cache: `rm -rf data/coinalyze_cache/*`

### Logs

```bash
# View scanner logs
tail -f /tmp/scanner.log

# View API statistics
grep "API Statistics" /tmp/scanner.log
```

---

## Development

### Project Structure

```
QuantPro/
├── market_scanner_refactored.py  # Main scanner entry point
├── strategies_refactored.py      # Strategy implementations
├── shared_context.py             # Context builder with indicators
├── batch_processor.py            # Batch API orchestrator
├── coinalyze_batch_client.py     # Coinalyze API client
├── coinalyze_resolver.py         # Symbol resolution
├── server.js                     # Backend API server
├── App.tsx                       # Frontend main component
├── components/                   # React components
│   ├── ScannerTable.tsx
│   ├── DetailPanel.tsx
│   └── ObservabilityPanel.tsx
├── services/                     # Frontend services
│   ├── dataService.ts
│   └── geminiService.ts
├── data/                         # Market data and cache
│   ├── master_feed.json
│   └── coinalyze_cache/
└── docs/                         # Documentation
    ├── ARCHITECTURE.md
    └── STRATEGY_V2_SPEC.md
```

### Adding a New Strategy

1. Create strategy class in `strategies_refactored.py`
2. Inherit from `Strategy` base class
3. Implement `analyze(context: SharedContext)` method
4. Return standardized signal structure with observability
5. Add to strategy factory in `market_scanner_refactored.py`

### Code Quality Standards

- **Modularity:** Each strategy is a separate class
- **Observability:** Every signal includes full score composition
- **Type Safety:** TypeScript types for all data structures
- **Documentation:** Inline comments for complex logic
- **Testing:** Verify with `--limit 2` before full scans

---

## API Documentation

### Backend Endpoints

**GET /api/results**
- Returns aggregated master feed
- Optional `?source=MEXC` to filter by exchange

**GET /api/scan/status**
- Returns current scan status

**POST /api/scan/start**
- Triggers new scan
- Body: `{ strategy: "BreakoutV2", limit: 100 }`

---

## Contributing

### Guidelines

1. Follow Jan 15 Principle: Modular, scalable, clear blocks
2. Update documentation when changing data structures
3. Test with `--limit 2` before committing
4. Ensure observability is included in all return paths
5. Maintain backward compatibility

### Pull Request Checklist

- [ ] Code follows project structure
- [ ] Documentation updated (README, ARCHITECTURE, STRATEGY_V2_SPEC)
- [ ] TypeScript types updated if data structure changed
- [ ] Tested with small and full scans
- [ ] No breaking changes to API

---

## License

Proprietary - All Rights Reserved

---

## Support

For issues, questions, or feature requests, please refer to:
- `ARCHITECTURE.md` - System design and data flow
- `STRATEGY_V2_SPEC.md` - Complete strategy specification with data dictionary
- `.cursorrules` - Global project rules for AI agents

---

**Last Scan:** Check `data/master_feed.json` for `last_updated` timestamp  
**Version History:** See `CHANGELOG.md` for detailed version history
