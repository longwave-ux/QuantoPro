# QuantPro v2.1 - System Master Documentation

**Latest Update:** 2026-01-12
**Architecture:** Hybrid (Node.js Orchestrator + Python Analysis Engine)
**Status:** Live - Parallel Strategy Execution

---

## 1. Executive Summary & Architecture

QuantPro has evolved from a simple JavaScript bot into a **Hybrid Quantitative Engine**. It combines the IO efficiency of Node.js with the mathematical power of Python (Pandas/SciPy).

### The "Sidecar" Mechanism
Instead of running analysis in the main Node.js event loop (which blocks functionality), the system uses a **Sidecar Pattern**:
1.  **Node.js (`server/scanner.js`)**: Fetches raw market data (Candles) from Exchanges.
2.  **Data Bridge**: Saves 15m/4h data to JSON files in `./data/`.
3.  **Analysis Trigger**: Spawns ephemeral Python processes (`venv/bin/python market_scanner.py`) to analyze these files.
    *   *Optimization:* Uses **Batch Processing (Chunk Size: 10)** to prevent CPU exhaustion.
    *   *Safety:* Enforces a **30s Hard Timeout** per batch to prevent hangs.
4.  **Result Integration**: Python returns structured JSON to `stdout`, which Node.js parses and pushes to the Frontend/Telegram.

---

## 2. Strategy Ecosystem (Parallel Execution)

The engine now runs **3 Strategies** simultaneously for every symbol. The Frontend displays all results, allowing "Consensus" trading.

### A. Strategy: Legacy (Trend Following)
*Ported from original JS logic.*
*   **Target:** Safe, mid-term trend rides.
*   **Logic:**
    *   **Bias:** EMA 50 > EMA 200 (Golden Cross logic).
    *   **Strength:** ADX > 25.
    *   **Entry:** Fibonacci Pullbacks (0.618) in direction of trend.

### B. Strategy V1: Geometric Breakout (The "Hunter")
*   **Target:** High-momentum explosive moves.
*   **Logic:** Identifies **RSI Trendlines** (Resistance/Support) using a "Consensus of Pivots" algorithm (mimics human eye).
*   **Scoring Model (0-100):**
    1.  **Geometry (40%)**: Quality of trendline (Touches, Duration, Slope).
    2.  **Momentum (30%)**: RSI Slope & Divergence.
    3.  **OI Flow (20%)**: Open Interest Slope (via Coinalyze). *Must be positive.*
    4.  **Sentiment (10%)**: Institutional positioning (Top Trader L/S Ratio, Funding Rate).
    5.  **Bonuses**: Retests, "Squeeze" detection.
*   **External Data:** Connects to **Coinalyze API** to validate setups.

### C. Strategy V2: Institutional Breakout (The "Sniper")
*   **Target:** Validated breakouts with Institutional Footprints.
*   **Core Constraint (The 70/30 Rule):**
    *   For **Bullish Breakouts**: The Trendline Anchor (First Pivot) **MUST be > 70 RSI**.
    *   *Why?* Ensures we are breaking a structure that started from Overbought conditions (true resistance), not weak drift.
*   **State Machine:**
    *   `IDLE`: Scanning for 70/30 Anchor + RSI Crossing 60.
    *   `WAITING_RETEST`: Breakout detected -> Waits for RSI 60 Retest ("The Kiss").
    *   `IN_TRADE`: Signal Active.
*   **Persistence:** Saves state to `data/v2_state.json` to track retests over hours/days.

---

## 3. Data Flow & Critical Components

### Data Fetching
*   **Primary Market Data:** KuCoin/MEXC/Hyperliquid (Candles).
*   **Institutional Data (`data_fetcher.py`):**
    *   **Source:** Coinalyze API.
    *   **Metrics:** Open Interest History, Predicted Funding Rate, Top Trader L/S Ratio.
    *   **Logic:** `CoinalyzeClient` handles rate limits and response parsing.

### Scoring Engine (`scoring_engine.py`)
Centralized logic for strictly calculating scores.
*   **Rules:**
    *   **Funding Filter:** Hard Reject if Funding > |0.05%|.
    *   **JSON Safety:** All `NaN` / `Infinity` values are sanitized to `0` or `null` before output.

### The Dashboard (Frontend)
*   **Multi-Strategy View:** Table rows now have a "Strategy Name" column.
*   **Manual Refresh:** Triggers the **Server-Side Batch Scanner**.
*   **Responsiveness:** Shows "Refreshing..." during Python execution.

---

## 4. Key Files Map

| File | Role | Key Functionality |
| :--- | :--- | :--- |
| **`server/scanner.js`** | **Bridge** | Batch Processing, Python Execution, Timeout Management. |
| **`market_scanner.py`** | **Runner** | Loads JSON, Instantiates Strategies, Prints Results. |
| **`strategies.py`** | **Brain** | Contains `QuantProLegacy`, `QuantProBreakout`, `QuantProBreakoutV2` classes. |
| **`data_fetcher.py`** | **Eye** | `CoinalyzeClient` implementation for "Blind Spot" data (OI, Sentiment). |
| **`scoring_engine.py`** | **Judge** | Calculates the raw 0-100 score based on components. |
| **`strategy_config.py`** | **Config** | Central store for Weights, Thresholds, and API Keys. |

---

## 5. Recent Critical Fixes (Log)

*   **[FIX] Dashboard Refresh Hang:** Implemented **Batching (Chunk 10)** and **30s Timeout** in `scanner.js` to prevent 200 concurrent Python processes from freezing the server.
*   **[FIX] Zero Scores (Enablement):** Added missing `get_open_interest_history` and `get_funding_rate` methods to `data_fetcher.py`, enabling Live Mode scoring.
*   **[FEATURE] Parallel Mode:** Registry updated to run ALL strategies per scan, effectively tripling market coverage.
