# QuantPro Architecture

**Version:** 2.0  
**Last Updated:** January 16, 2026  
**Purpose:** System design, data flow, and component interactions

---

## System Overview

QuantPro is a three-tier architecture consisting of:
1. **Frontend** - React-based dashboard for signal visualization
2. **Backend** - Node.js API server for data aggregation and routing
3. **Scanner** - Python-based market analysis engine with batch processing

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND LAYER                           │
│                      (React + TypeScript)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ App.tsx      │  │ ScannerTable │  │ ObservabilityPanel   │ │
│  │ - State Mgmt │  │ - Filtering  │  │ - Score Composition  │ │
│  │ - Data Fetch │  │ - Sorting    │  │ - RSI Visuals        │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ DetailPanel  │  │ ConfigPanel  │  │ ExchangePanel        │ │
│  │ - Charts     │  │ - Settings   │  │ - Source Selection   │ │
│  │ - AI Analysis│  │ - Thresholds │  │                      │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP/JSON
                              │ GET /api/results
                              │ POST /api/scan/start
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND LAYER                            │
│                         (Node.js)                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ server.js                                                │  │
│  │ - Express API endpoints                                  │  │
│  │ - WebSocket for real-time updates                        │  │
│  │ - Static file serving                                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌──────────────────────────┼──────────────────────────────┐  │
│  │ server/scanner.js         │  server/analysis.js          │  │
│  │ - Scan orchestration      │  - Result aggregation        │  │
│  │ - Python subprocess mgmt  │  - Master feed management    │  │
│  └──────────────────────────┴──────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Subprocess (Python)
                              │ market_scanner_refactored.py
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SCANNER LAYER                            │
│                          (Python)                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ market_scanner_refactored.py                             │  │
│  │ - Entry point and orchestration                          │  │
│  │ - Directory scanning with --limit support                │  │
│  │ - Strategy factory and execution                         │  │
│  │ - Master feed JSON generation                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│         ┌────────────────────┼────────────────────┐            │
│         ▼                    ▼                    ▼            │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ Strategies  │  │ SharedContext    │  │ Batch Processor │  │
│  │             │  │                  │  │                 │  │
│  │ - Legacy    │  │ - Data Loading   │  │ - Symbol Res.   │  │
│  │ - Breakout  │  │ - Indicators     │  │ - API Batching  │  │
│  │ - BreakoutV2│  │ - Feature Calc   │  │ - Caching       │  │
│  └─────────────┘  └──────────────────┘  └─────────────────┘  │
│         │                    │                    │            │
│         └────────────────────┼────────────────────┘            │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Signal Output (JSON)                                     │  │
│  │ - Observability with score_composition                   │  │
│  │ - Setup details (entry, SL, TP, RR)                      │  │
│  │ - OI metadata and external data flags                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ API Calls (Batch)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL DATA LAYER                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Coinalyze    │  │ MEXC         │  │ Hyperliquid          │ │
│  │ - OI History │  │ - OHLCV Data │  │ - OHLCV Data         │ │
│  │ - Funding    │  │              │  │                      │ │
│  │ - L/S Ratio  │  │              │  │                      │ │
│  │ - Liquidations│ │              │  │                      │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Scan Initialization

```
User Triggers Scan (Frontend)
    │
    ▼
POST /api/scan/start (Backend)
    │
    ▼
runServerScan() spawns Python subprocess
    │
    ▼
market_scanner_refactored.py starts
```

### 2. Data Collection Phase

```
Directory Scanning
    │
    ├─ Load JSON files (OHLCV data)
    │  └─ Apply --limit if specified
    │
    ├─ Extract symbols and exchanges
    │  └─ Filter by --symbol if specified
    │
    └─ Build symbols_list for batch processing
```

### 3. Batch Processing Phase

```
BatchProcessor.process_symbols(symbols_list)
    │
    ├─ CoinalyzeResolver.resolve_symbols()
    │  └─ Map local symbols to Coinalyze format
    │     (e.g., BTCUSDT_BINANCE → BTCUSDT_PERP.A)
    │
    ├─ CoinalyzeBatchClient.fetch_batches()
    │  ├─ Check cache (TTL: 1 hour)
    │  ├─ Batch symbols (max 20 per request)
    │  ├─ Fetch OI History
    │  ├─ Fetch Funding Rates
    │  ├─ Fetch L/S Ratios
    │  └─ Fetch Liquidations
    │
    └─ Distribute data back to local symbols
       └─ Calculate OI Z-Score for each symbol
```

### 4. Analysis Phase

```
For each symbol:
    │
    ├─ Load LTF data (15m candles)
    ├─ Load HTF data (4h candles)
    │
    ├─ SharedContext.build_context()
    │  ├─ Calculate indicators (RSI, OBV, ATR, EMA, ADX)
    │  ├─ Find RSI trendlines
    │  ├─ Inject external_data from batch
    │  └─ Return populated context
    │
    ├─ Strategy.analyze(context)
    │  ├─ Apply strategy logic
    │  ├─ Calculate scores
    │  ├─ Build observability dict
    │  └─ Return signal with setup
    │
    └─ Collect signal for aggregation
```

### 5. Aggregation Phase

```
Aggregate all signals
    │
    ├─ Sanitize for JSON (handle numpy types)
    ├─ Add metadata (mcap, vol_24h)
    │
    └─ Write to master_feed.json
       {
         "last_updated": timestamp,
         "signals": [...]
       }
```

### 6. Frontend Display Phase

```
Frontend polls /api/results
    │
    ├─ Backend reads master_feed.json
    ├─ Returns structured JSON
    │
    └─ Frontend processes
       ├─ Update ScannerTable
       ├─ Update ObservabilityPanel
       └─ Trigger DetailPanel on selection
```

---

## Component Details

### Frontend Components

#### **App.tsx**
- **Responsibilities:**
  - Global state management (data, settings, filters)
  - API communication with backend
  - Scan orchestration
  - Data source selection

- **Key State:**
  ```typescript
  const [data, setData] = useState<AnalysisResult[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [dataSource, setDataSource] = useState<DataSource>('MEXC');
  ```

#### **ScannerTable.tsx**
- **Responsibilities:**
  - Display signals in sortable table
  - Apply filters (strategy, bias, exchange)
  - Row selection for detail view

- **Filters:**
  - Strategy: All, Legacy, Breakout, BreakoutV2
  - Bias: All, LONG, SHORT
  - Exchange: All, MEXC, HYPERLIQUID, BINANCE

#### **ObservabilityPanel.tsx**
- **Responsibilities:**
  - Display score composition
  - Show RSI visuals (trendlines)
  - Render filter status badges

- **Data Mapping:**
  - Reads `signal.observability.score_composition`
  - Maps V2 metrics to standard keys (see STRATEGY_V2_SPEC.md)

#### **DetailPanel.tsx**
- **Responsibilities:**
  - Display detailed charts (HTF/LTF)
  - Show setup details (entry, SL, TP, RR)
  - AI analysis integration (Gemini)
  - Trade execution interface

### Backend Components

#### **server.js**
- **Endpoints:**
  - `GET /api/results` - Returns master feed
  - `GET /api/results?source=MEXC` - Filtered by exchange
  - `POST /api/scan/start` - Triggers new scan
  - `GET /api/scan/status` - Returns scan status

- **WebSocket:**
  - Real-time scan progress updates
  - Signal count updates

#### **server/scanner.js**
- **Responsibilities:**
  - Spawn Python subprocess
  - Monitor scan progress
  - Trigger results_aggregator.py after scan
  - Update master_feed.json

#### **server/analysis.js**
- **Responsibilities:**
  - Read master_feed.json
  - Parse and validate JSON structure
  - Handle both legacy (array) and new (object) formats

### Scanner Components

#### **market_scanner_refactored.py**
- **Responsibilities:**
  - Parse command-line arguments
  - Directory scanning with --limit support
  - Strategy factory initialization
  - Batch processing orchestration
  - Signal aggregation and JSON output

- **Key Functions:**
  - `main()` - Entry point
  - `analyze_symbol()` - Per-symbol analysis
  - `extract_symbol_from_filename()` - Symbol parsing
  - `sanitize_for_json()` - JSON serialization

#### **strategies_refactored.py**
- **Classes:**
  - `Strategy` (Abstract Base)
  - `QuantProLegacyRefactored`
  - `QuantProBreakoutRefactored`
  - `QuantProBreakoutV2Refactored`

- **Common Methods:**
  - `analyze(context)` - Main analysis logic
  - `_build_observability_dict()` - Observability creation (V2 only)
  - `_wait_result()` - WAIT signal with diagnostics
  - `_empty_result()` - Empty signal for insufficient data

#### **shared_context.py**
- **Classes:**
  - `SharedContext` - Data container
  - `FeatureFactory` - Indicator calculator

- **Responsibilities:**
  - Load and validate OHLCV data
  - Calculate technical indicators
  - Find RSI trendlines
  - Inject external data from batch
  - Provide unified interface for strategies

#### **batch_processor.py**
- **Class:** `BatchProcessor`

- **Responsibilities:**
  - Resolve symbols to Coinalyze format
  - Orchestrate batch API calls
  - Calculate OI Z-Scores
  - Distribute data to local symbols

- **Key Methods:**
  - `process_symbols()` - Main batch processing
  - `get_data_for_symbol()` - Retrieve data for specific symbol

#### **coinalyze_batch_client.py**
- **Class:** `CoinalyzeBatchClient`

- **Responsibilities:**
  - Batch API requests (max 20 symbols)
  - Rate limiting (1.5s spacing)
  - Retry-After header handling
  - Caching (1-hour TTL)

- **Endpoints:**
  - `/futures/open-interest/history/batch`
  - `/futures/funding-rate/history/batch`
  - `/futures/long-short-ratio/history/batch`
  - `/futures/liquidations/history/batch`

#### **coinalyze_resolver.py**
- **Class:** `CoinalyzeResolver`

- **Responsibilities:**
  - Symbol mapping (local → Coinalyze)
  - Cache management (13-hour TTL)
  - Fallback to aggregated symbols

---

## Data Structures

### Signal Structure (Complete)

```typescript
interface AnalysisResult {
  // Identity
  strategy_name: string;        // Full name (e.g., "BreakoutV2")
  strategy: string;             // Short name (same as strategy_name)
  symbol: string;               // Trading pair (e.g., "BTCUSDT")
  canonical_symbol: string;     // Base asset (e.g., "BTC")
  exchange: string;             // Exchange name (e.g., "BINANCE")
  
  // Price and Score
  price: number;                // Current price
  score: number;                // Legacy score field
  total_score: number;          // Primary score field (same as score)
  
  // Direction
  bias: string;                 // "LONG" | "SHORT" | "NONE"
  action: string;               // "LONG" | "SHORT" | "WAIT"
  
  // Setup
  setup: TradeSetup | null;     // Entry, SL, TP, RR, side
  
  // Details
  details: {
    total: number;
    oi_z_score?: number;
    obv_slope?: number;
    cardwell_range?: string;
    breakout_type?: string;
    // ... strategy-specific fields
  };
  
  // HTF/LTF Context
  htf: {
    trend: string;
    bias: string;
    adx: number;
  };
  ltf: {
    rsi: number;
    bias: string;
    cardwell_range?: string;
    // ... other LTF metrics
  };
  
  // Observability (CRITICAL)
  observability: {
    score_composition: {
      // Raw metrics
      rsi: number;
      close_price: number;
      oi_z_score: number;
      oi_z_score_valid: boolean;
      obv_slope: number;
      cardwell_range: string;
      breakout_type: string | null;
      atr: number;
      
      // Mapped to standard Dashboard keys
      trend_score: number;        // OI Z-Score * 10
      structure_score: number;    // |OBV Slope| * 100
      money_flow_score: number;   // RSI / 4
      timing_score: number;       // Cardwell range score
      
      // Filter status
      filters_passed: {
        oi_zscore: boolean;
        obv_slope: boolean;
      };
      
      // Data availability
      oi_available: boolean;
      funding_available: boolean;
      ls_ratio_available: boolean;
      liquidations_available: boolean;
    };
    rsi_visuals: {
      resistance?: RsiTrendline;
      support?: RsiTrendline;
    };
    calculated_at: number;        // Unix timestamp
    candle_index: number;         // Index in dataframe
  };
  
  // OI Metadata
  oi_metadata: {
    status: string;               // "aggregated" | "neutral"
    coinalyze_symbol: string | null;
    value: number;                // Current OI value
  };
  
  // Metadata
  metadata?: {
    mcap: number;
    vol_24h?: number;
  };
}
```

### Master Feed Structure

```json
{
  "last_updated": 1768556245031,
  "signals": [
    // Array of AnalysisResult objects
  ]
}
```

---

## Performance Optimization

### Caching Strategy

1. **Coinalyze API Cache**
   - Location: `data/coinalyze_cache/`
   - TTL: 3600 seconds (1 hour)
   - Format: JSON files with batch hash
   - Benefit: 4x reduction in API calls

2. **Symbol Resolution Cache**
   - Location: `data/coinalyze_cache/symbols_cache.json`
   - TTL: 46800 seconds (13 hours)
   - Format: JSON mapping
   - Benefit: Instant symbol resolution

### Batch Processing

- **Batch Size:** 20 symbols per request (Coinalyze limit)
- **Parallelization:** 4 endpoints fetched per batch
- **Rate Limiting:** 1.5s spacing between requests
- **Retry Logic:** Exponential backoff with Retry-After header respect

### --limit Parameter

- **Purpose:** Reduce scan time for testing/development
- **Implementation:** Applied during directory scanning phase
- **Impact:** 
  - `--limit 2` → 2 files → 2 symbols → ~5 seconds
  - `--limit 100` → 100 files → 100 symbols → ~2 minutes

---

## Error Handling

### Rate Limiting (429 Errors)

```python
@retry_with_backoff(max_retries=3, base_delay=2.0)
def _request(self, endpoint, params):
    # Check Retry-After header
    if response.status_code == 429:
        retry_after = response.headers.get('Retry-After', '60')
        wait_time = int(float(retry_after)) + 1
        print(f"[RATE-LIMIT] 429 Detected. Waiting {wait_time}s...")
        time.sleep(wait_time)
        raise Exception("Rate limited")
```

### Missing Data

```python
# Strategy handles missing data gracefully
if len(df) < 50:
    return self._empty_result(context)

# External data defaults
oi_z_score = context.get_external('oi_z_score', 0.0)
oi_z_score_valid = context.get_external('oi_z_score_valid', False)
```

### JSON Serialization

```python
def sanitize_for_json(obj):
    """Handle numpy types and other non-JSON-serializable objects."""
    if isinstance(obj, (np.integer, np.floating)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    # ... handle other types
```

---

## Security

### API Key Management

- **Storage:** `.env` file (gitignored)
- **Access:** Environment variables only
- **Validation:** Checked at startup

### Data Validation

- **Input:** Validate file paths, symbol names
- **Output:** Sanitize JSON before writing
- **API:** Validate response structure

---

## Monitoring

### Logs

- **Scanner:** Console output with prefixes `[BATCH]`, `[API-SUCCESS]`, `[RATE-LIMIT]`
- **Backend:** Express logs for API requests
- **Frontend:** Console logs for state changes

### Metrics

- **API Statistics:** Tracked in `CoinalyzeBatchClient`
  - `successful_requests`
  - `failed_requests`
  - Total requests

- **Scan Statistics:** Displayed at end
  - Symbols processed
  - Signals generated
  - Execution time

---

## Deployment

### Production Checklist

- [ ] Environment variables configured
- [ ] API keys valid and tested
- [ ] Cache directory writable
- [ ] Data files present
- [ ] Node.js and Python dependencies installed
- [ ] Frontend built (`npm run build`)
- [ ] Backend running (`node server.js`)

### Scaling Considerations

- **Horizontal:** Multiple scanner instances with different symbol ranges
- **Vertical:** Increase batch size (if API allows)
- **Caching:** Redis for distributed cache (future)
- **Database:** PostgreSQL for historical signals (future)

---

## Future Enhancements

1. **Real-time Data Streaming** - WebSocket integration for live price updates
2. **Historical Backtesting** - Database storage for signal performance tracking
3. **Machine Learning** - Pattern recognition for signal quality scoring
4. **Multi-Exchange Aggregation** - Combine signals across exchanges
5. **Alert System** - Push notifications for high-score signals

---

**For detailed strategy specifications and data mappings, see `STRATEGY_V2_SPEC.md`**
