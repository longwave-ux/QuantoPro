# QuantPro Crypto Scanner - Project Overview

**Version:** 1.0.0
**Last Updated:** 2026-01-09

## 1. Executive Summary

**QuantPro** is an automated, self-hosted crypto trading intelligence system. It runs 24/7 to scan the market for high-probability setups, providing **quantitative scoring** (0-100) for every asset based on Trend, Structure, Money Flow, and Timing.

Unlike simple signal bots, QuantPro uses a **Pro-Active Analysis Engine** that ranks opportunities and manages the entire lifecycle of a trade—from detection to execution (paper or live) to closure.

### Key Capabilities
-   **24/7 Market Scanning:** Scans top 200 pairs on KuCoin/MEXC/Hyperliquid every 15 minutes.
-   **Adaptive Intelligence:** Dynamic strategy that adjusts entry aggression based on ADX Trend Strength.
-   **Quantitative Scoring:** Objective "Score" for every pair to remove emotional bias.
-   **Backtesting & Optimization:** Built-in "Foretest" engine and "Auto-Optimizer" (Grid Search) to validate settings.
-   **Execution & Alerting:** Telegram notifications + Support for direct trading on MEXC & Hyperliquid.

---

## 2. System Architecture

The project follows a **Monolithic** architecture designed for simplicity, portability, and "Zero-Conf" deployment.

### Tech Stack
-   **Runtime:** Node.js (Backend)
-   **Frontend:** React + Vite + TailwindCSS (Served statically by Express)
-   **Database:** JSON Flat-Files (`/data/*.json`) - *Chosen for portability and ease of backup.*
-   **API Integrations:** Hyperliquid (DEX), MEXC (CEX), KuCoin (Data), Telegram (Alerts), Google Gemini (AI Analysis).

### Core Components
1.  **The Server Loop (`server.js`)**:
    -   **Scanner Loop (15m):** Fetches candles -> Runs Analysis -> Updates History -> Sends Alerts.
    -   **Tracker Loop (1m):** Monitors "Open" trades (Paper/Live) for TP/SL hits or Time-Based Exits.
2.  **Analysis Engine (`server/analysis.js`)**: Pure function logic that takes candles and config, returning a Score + Setup.
3.  **Data Service (`server/marketData.js`)**: Handles caching, rate-limiting, and fetching from multiple exchanges.
4.  **Frontend (`/src`)**: Single-Page Application (SPA) for visualizing data, configuring strategies, and running simulations.

---

## 3. Strategy Logic (The "Edge")

The core strategy is a **Trend-Following Pullback System** enhanced by adaptive logic.

### 1. Trend Identification (HTF - 4H)
-   **Bias:** Determined by EMA 50/200 crossover + Price location.
-   **Strength:** ADX > 25 indicates a strong trend.

### 2. Setup Detection (LTF - 15m)
-   **Pullbacks:** Measures depth of retracement from recent swing high.
-   **Confluence:** Looks for overlap between **Fibonacci Levels** (0.618 / 0.382) and **Structural Support/Resistance**.
-   **Momentum:** Uses RSI and RSI Divergence to time entries.
-   **Money Flow:** Uses OBV (On-Balance Volume) to detect accumulation during pullbacks.

### 3. Adaptive Regime (Unique Feature)
*Enabled via `ENABLE_ADAPTIVE` in System Config.*
-   **High Trend (ADX > 25):**
    -   **Entry:** Aggressive (0.382 Fib).
    -   **Window:** Short confirmation (10 candles).
    -   **Scoring:** Trend weight increased, Structure weight decreased.
-   **Low/Normal Trend:**
    -   **Entry:** Conservative (0.618 Fib).
    -   **Window:** Standard confirmation (50 candles).

---

## 4. Features & Workflows

### A. Foretesting (Simulation)
**Goal:** Verify strategy settings before deploying.
-   Users can click **"Test Current"** in the UI.
-   The server runs a backtest on the last `FORETEST_DAYS` (default 10) of data using the *current active settings*.
-   Results (Win Rate, Net PnL) are displayed instantly.

### B. Auto-Optimization
**Goal:** Find the mathematical best settings.
-   Accessible via the "Auto-Optimize" button.
-   Runs a Grid Search over key parameters (Lookback, RSI Period, Stop Loss Buffer).
-   Returns the parameter set with the highest Risk-Adjusted Return.

### C. Live Trading / Forward Test
-   **Paper Trading:** Default mode. Signals are logged to `trade_history.json` and tracked until closure.
-   **Live Execution:** Checks for valid API Keys (MEXC/Hyperliquid) and executes real orders if configured.
-   **Safety:** Includes "Time-Based Force Exit" (closes stale trades after N hours) and "Crash Protection" (invalidates long setups if price crashes through support).

---

## 5. Directory Structure Map

| Path | Description |
| :--- | :--- |
| **`/server.js`** | **Entry Point.** Express app + Main Loops. |
| **`/server/`** | Backend Logic |
| `├── scanner.js` | Orchestrator. Fetches data, calls analysis, saves results. |
| `├── analysis.js` | **Brain.** Contains all indicators, logic, and scoring rules. |
| `├── tracker.js` | **Lifecycle Manager.** Tracks open trades to closure. |
| `├── config.js` | **State.** Loads/Saves `data/config.json`. |
| `├── marketData.js` | **IO.** Exchange API wrappers and Caching. |
| `├── optimizer.js` | **Backtest Engine.** Grid search logic. |
| **`/src/`** | React Frontend |
| `├── App.tsx` | Main UI Layout & State Management. |
| `├── components/` | UI Components (ScannerTable, ConfigPanel, etc.) |
| **`/data/`** | **Persistence Layer** (JSON files) |
| `├── config.json` | User settings (Thresholds, API Keys). |
| `├── history.json` | Historical scan scores (for trend stability). |
| `├── trade_history.json` | Log of all signals and their outcomes (Win/Loss). |

---

## 6. Usage Guide

### Prerequisites
-   Node.js v16+
-   `npm install`

### Running the System
1.  **Development Mode (Frontend + Backend):**
    ```bash
    npm run dev
    ```
2.  **Production Mode:**
    ```bash
    npm run build   # Builds React to /dist
    npm start       # Runs Node server (files served from /dist)
    ```

### Configuration
-   Access the UI at `http://localhost:3000`.
-   Click the **Gear Icon** to open Settings.
-   **Strategy Tab:** Adjust thresholds, logic, and run simulations.
-   **Trading Tab:** Configure API Keys (stored locally on server).

---
