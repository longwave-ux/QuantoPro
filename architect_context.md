# QuantPro (v2.1) - Architectural Context

**Architecture:** Hybrid (Node.js Orchestrator + Python Analysis Engine) with React (Vite) UI.

## Folder / File Structure (high signal)

- **`server.js`**
  - Express server + long-running 24/7 scan loop.
  - Serves `/dist` (React build) and exposes JSON APIs (`/api/results`, `/api/scan/*`, `/api/config`, etc.).

- **`server/`** (Node orchestrator core)
  - **`scanner.js`**: orchestrates scans, runs Python sidecar, merges/persists results, triggers aggregation, sends Telegram, updates tracker.
  - **`marketData.js`**: fetches candles from exchanges + caches them to `data/`.
  - **`analysis.js`**: Node-based analysis engine (legacy logic). Still used for some features; Python engine is authoritative for multi-strategy signals.
  - **`config.js`**: runtime config (defaults + deep-merge persistence to `data/config.json`).
  - **`tracker.js`**: forward-test tracker using `data/trade_history.json`.
  - **`telegram.js`**: notifications + settings persistence (`data/settings.json`).
  - **`mcapService.js`**: market cap enrichment cache.
  - **`optimizer.js`**: optimization job runner.

- **Python analysis engine (repo root)**
  - **`market_scanner.py`**: CLI entrypoint invoked by Node. Loads candle JSON, runs strategies, prints JSON to stdout.
  - **`strategies.py`**: contains strategy implementations (Legacy + Breakout + BreakoutV2). Produces standardized result objects.
  - **`scoring_engine.py`**: centralized scoring function used by Breakout family.
  - **`data_fetcher.py`**: Coinalyze “institutional” data client (OI, funding, L/S ratio, liquidations) with caching.
  - **`results_aggregator.py`**: builds `data/master_feed.json` by deduping/normalizing results across exchanges.
  - **`strategy_config.py`**: Python-side constants (timeframes/weights/thresholds).

- **Frontend (React/Vite, mostly root + `components/` + `services/`)**
  - **`index.html`, `index.tsx`, `App.tsx`**: React entry + UI orchestration.
  - **`components/`**: tables/panels for results, tooltips, etc.
  - **`services/`**: TS API clients (data, telegram, trade, gemini).
  - **`types.ts`**: shared result interfaces.

- **`data/` (state + cache + outputs)**
  - **Candle cache**: `${SOURCE}_${SYMBOL}_${INTERVAL}.json` (e.g. `HYPERLIQUID_SUSHIUSDT_15m.json`).
  - **Per-exchange latest signals**: `latest_results_${SOURCE}.json`.
  - **Global aggregated feed (UI target)**: `master_feed.json`.
  - **Config/state**: `config.json`, `settings.json`, `scanner_timestamps.json`, `history.json`, `trade_history.json`, `v2_state.json`.
  - **Coinalyze cache**: `coinalyze_cache/` and `coinalyze_cache.json`.

## Core Classes / Modules and Responsibilities

### Node.js Orchestrator

- **`server.js`**
  - Starts Express.
  - Starts the *infinite* scan loop: sequentially calls `runServerScan('HYPERLIQUID'|'MEXC'|'KUCOIN', 'all')` every minute (interval gating is inside `runServerScan`).
  - Exposes APIs:
    - **`GET /api/results`** -> reads `data/master_feed.json`.
    - **`POST /api/scan/manual`** -> force scan.
    - **`GET/POST /api/config`** -> reads/writes `CONFIG` to `data/config.json`.
    - **`GET /api/performance`** -> reads tracker outputs.
    - **Trading endpoints**: `/api/trade/mexc`, `/api/trade/hyperliquid`.
    - **LLM endpoint**: `/api/ai/analyze` (Gemini).

- **`server/scanner.js`** (authoritative scan orchestration)
  - **Batching + throttling**:
    - Splits symbols into chunks (`CHUNK_SIZE=10`) and batches (`BATCH_SIZE=5`).
    - Runs Python via `execFile` with timeout (`timeout: 60000`).
  - **Sidecar invocation**:
    - Executes `venv/bin/python market_scanner.py <ltf_file> --strategy <...> --symbol <...> --config <json>`.
    - Parses `stdout` as JSON and enriches with `source`, `timestamp`, `meta`, `details.mcap`.
  - **Persistence/merge**:
    - Writes `data/latest_results_${SOURCE}.json` (atomic write).
    - Preserves strategies not run in partial scans.
    - “Sticky signals” logic for Breakout (score>=80 and age<24h).
  - **Aggregation trigger**:
    - Runs `venv/bin/python results_aggregator.py` to produce `data/master_feed.json`.
  - **Downstream actions**:
    - Writes logs (signal log), registers signals into tracker, sends Telegram alerts.

- **`server/marketData.js`**
  - Fetches candles from:
    - **KuCoin Futures** (`https://api-futures.kucoin.com/api/v1/kline/query`)
    - **MEXC** (`https://api.mexc.com/api/v3/klines`)
    - **Hyperliquid** (`https://api.hyperliquid.xyz/info` with `candleSnapshot`)
  - Caches to `data/${source}_${symbol}_${interval}.json` and performs delta-refresh.
  - Fetches “top pairs” per exchange for scanning.

- **`server/config.js`**
  - Default config + deep-merge load/save:
    - Reads/writes `data/config.json`.
    - Provides scanner intervals (`SYSTEM.LEGACY_INTERVAL`, `SYSTEM.BREAKOUT_INTERVAL`).

- **`server/tracker.js`**
  - Forward-test system:
    - `registerSignals()` writes OPEN trades to `data/trade_history.json`.
    - `updateOutcomes()` re-fetches candles and updates OPEN → CLOSED based on entry/tp/sl logic.

### Python Analysis Engine

- **`market_scanner.py`** (runner / adapter)
  - Loads candle JSON written by Node (`data/${SOURCE}_${SYMBOL}_${interval}.json`).
  - Normalizes schema (`time`→`timestamp`, numeric coercion).
  - Instantiates strategies based on `--strategy`:
    - `QuantProLegacy`, `QuantProBreakout`, `QuantProBreakoutV2`.
  - Outputs an array of results to stdout (JSON), sanitizing NaN/Inf (`clean_nans`).

- **`strategies.py`** (core “brain”)
  - Defines base `Strategy` (ABC) and concrete strategies.
  - **`QuantProLegacy`**:
    - Computes EMA/RSI/ADX/ATR/OBV/Bollinger via `pandas_ta`.
    - Produces bias + scoring components (trend/structure/moneyflow/timing) and trade setup.
  - **`QuantProBreakout`**:
    - Breakout detection on HTF context + uses institutional data (OI, funding, sentiment).
    - Calls `data_fetcher.CoinalyzeClient` (cached) when DF lacks OI.
    - Uses `scoring_engine.calculate_score()` to produce normalized score breakdown.
  - **`QuantProBreakoutV2`**:
    - V2 “state machine” style breakout logic with persistence (`data/v2_state.json`).

- **`data_fetcher.py`**
  - `CoinalyzeClient`:
    - Rate limiting (min request interval ~2.2s).
    - File cache in `data/coinalyze_cache/` (TTL 15m).
    - Endpoints used (Coinalyze):
      - `/open-interest-history`
      - `/predicted-funding-rate`
      - `/long-short-ratio-history`
      - `/liquidation-history`
    - Symbol mapping helper `convert_symbol()` (maps e.g. `AAVEUSDT` → `AAVEUSDT_PERP.A`).

- **`scoring_engine.py`**
  - Loads `data/scoring_settings.json`.
  - Computes breakout score components:
    - geometry (triangle area = |pct_change| * duration)
    - momentum (divergence score + RSI/price slope decoupling)
    - base weight
  - Prints `[SCORE-DEBUG]` to stderr for audit.

- **`results_aggregator.py`** (final output builder)
  - Reads all `data/latest_results_*.json`.
  - Enriches each signal with:
    - `exchange_tag`, `priority_score`, `base_symbol`.
    - `components` (from `raw_components` / `details.raw_components`).
    - `score_breakdown` (from `details.score_breakdown`).
  - De-duplicates by `(strategy_name, base_symbol)` and selects “winner” by:
    - volume desc → exchange priority desc → score desc.
  - Sanitizes schema (injects defaults) to prevent frontend crashes.
  - Writes `data/master_feed.json` (atomic rename).

## Data Flow (prices in → JSON out)

1. **Scan loop starts**
   - `server.js` runs `startScannerLoop()`.
   - For each exchange source: calls `runServerScan(source, 'all')`.

2. **Select symbols**
   - `server/marketData.js::fetchTopVolumePairs(source)` returns top ~200 symbols.

3. **Fetch candles + cache**
   - `server/marketData.js::fetchCandles(symbol, interval, source)`:
     - Reads `data/${source}_${symbol}_${interval}.json` if present.
     - Otherwise fetches from exchange API and writes cache.

4. **Run Python sidecar**
   - `server/scanner.js::processBatch()`:
     - Ensures LTF file path exists (`data/${source}_${symbol}_${ltf}.json`).
     - Spawns `venv/bin/python market_scanner.py <ltfFile> --strategy <...> --symbol <symbol> --config <CONFIG as JSON string>`.

5. **Python produces per-strategy results**
   - `market_scanner.py` loads candles + optional HTF file, runs strategy classes.
   - Outputs JSON array to stdout.

6. **Node merges & persists per-exchange latest**
   - `server/scanner.js` parses stdout, enriches results, merges with previous run, applies quotas.
   - Writes `data/latest_results_${SOURCE}.json`.

7. **Aggregation step produces global feed**
   - `server/scanner.js` calls `results_aggregator.py`.
   - Aggregator writes `data/master_feed.json`.

8. **UI consumes final JSON**
   - `GET /api/results` returns `data/master_feed.json`.
   - Frontend renders rows (multi-strategy view, score breakdown tooltips, etc.).

## Critical Dependencies

### Node / Frontend (npm)
- **Runtime**: `express`, `node-fetch`, `dotenv`, `ethers`.
- **UI**: `react`, `react-dom`, `recharts`, `lucide-react`.
- **Build**: `vite`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`.

### Python (pip)
- `pandas`, `numpy`, `scipy`, `pandas_ta`.

### External APIs
- **Exchange market data**:
  - KuCoin Futures REST
  - MEXC REST
  - Hyperliquid REST
- **Institutional/derivatives data**:
  - Coinalyze REST (`api.coinalyze.net/v1`)
- **LLM**:
  - Google Gemini API (`generativelanguage.googleapis.com`)
- **Market Cap**:
  - CoinMarketCap API key is present in `server/config.js` (`CONFIG.SYSTEM.CMC_API_KEY`).

### Secrets / Config
- Node reads secrets from `.env` first, falls back to persisted `data/settings.json` for some keys.
- Relevant env keys observed:
  - `MEXC_API_KEY`, `MEXC_SECRET_KEY`
  - `HYPERLIQUID_PRIVATE_KEY`
  - `GEMINI_LLM_API_KEY`
  - `COINALYZE_API_KEY` (used by Python, passed via environment)

---

**Note on “authoritative output”:** the frontend’s main feed is `data/master_feed.json`, generated by `results_aggregator.py` from `data/latest_results_${SOURCE}.json` files, which are produced by `server/scanner.js` after parsing Python `market_scanner.py` stdout.
