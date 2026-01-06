# Project Status & Architecture Log

This file tracks the project structure, key decisions, and ongoing development context to ensure continuity.

## Project Overview
- **Type:** 24/7 Crypto Trading Scanner & Bot.
- **Environment:** Node.js (Backend) + React/Vite (Frontend) running on a VPS.
- **Goal:** Scan markets (Binance, MEXC, Hyperliquid) for trade setups based on technical indicators and manage alerts/trades.

## Directory Structure & Key Files

### Root
- `server.js`: Main entry point. Runs the Express server and the 24/7 scanning loops.
  - **Scanner Loop:** Runs every 15 minutes (`runServerScan`).
  - **Tracker Loop:** Runs every 1 minute (`updateOutcomes`).
- `package.json`: Dependencies (Express, Ethers, Technical Indicators, React, etc.).

### Server (`/server`)
- `scanner.js`: **Core Logic.**
  - Fetches candles.
  - Calculates indicators (RSI, EMA, OBV, etc.).
  - Generates `AnalysisResult` with scores and trade setups.
  - Saves results to `data/latest_results_{SOURCE}.json`.
- `marketData.js`: Handles API requests to exchanges (Binance, MEXC, Hyperliquid) and caches candle data to JSON.
- `tracker.js`: Monitors active signals, checks if targets/SLs are hit, and updates `data/trade_history.json`.
- `telegram.js`: Manages Telegram notifications and bot settings.
- `indicators.js`: Pure functions for technical analysis (EMA, RSI, ATR, Structure, etc.).

### Frontend (`/src`, `/components`)
- React application for visualizing scanner results.
- `ScannerTable.tsx`: Main view displaying the list of opportunities.
- `DetailPanel.tsx`: Shows detailed metrics for a selected coin.

### Data (`/data`)
- JSON files used as a flat-file database.
- `history.json`: Scan history.
- `trade_history.json`: Log of all tracked trades and their outcomes.
- `latest_results_*.json`: The most recent scan output for the frontend.

## Current State & Logic
1.  **Scanning:** The system fetches OHLCV data, calculates a composite score (Trend, Structure, MoneyFlow, Timing), and filters for high-quality setups.
2.  **Execution:** Currently focuses on scanning and alerting.
3.  **Persistence:** Uses the file system (`fs/promises`) for data persistence, avoiding complex database setups for now.

## Decision Log
- **2026-01-05:** Created this log file to maintain context across sessions.
- **Architecture:** Kept monolithic (Server + Scanner in one process) for simplicity on the VPS.
- **Error Handling:** Global handlers in `server.js` prevent the process from crashing on unhandled exceptions to ensure 24/7 uptime.
- **2026-01-05:** Updated `checkMomentum` in `server/scanner.js` to use **Pivot-to-Pivot Divergence**.
    - *Old Logic:* Compared Current Price vs Past Pivot (prone to false positives).
    - *New Logic:* Compares Most Recent Completed Pivot vs Previous Completed Pivot.
    - *Benefit:* Ensures divergence is "locked in" and confirmed by a price turn before signaling.
- **2026-01-05:** Fixed "N/A" Exchange in Trade History.
    - Updated `server/tracker.js` to fetch candles from the correct exchange (instead of hardcoded Binance).
    - Patched `data/trade_history.json` to set default exchange to 'BINANCE' for 81 legacy trades.
- **2026-01-05:** Session started. AI Assistant onboarded and reviewed project status.
- **2026-01-05:** Analyzed "Performance/Foretest" logic.
    - **Frontend:** `PerformancePanel.tsx` fetches from `/api/performance`.
    - **Backend:** `server/tracker.js` manages `data/trade_history.json`.
    - **Logic:** Signals (Score >= 70) are auto-registered. `updateOutcomes` simulates execution (Entry -> TP/SL) using 15m candles.
- **2026-01-05:** Fixed "Binance" Exchange Issue in Trade History.
    - **Problem:** Legacy trades were defaulted to "BINANCE", which is not a scanned source.
    - **Fix:** Ran a script to cross-reference symbols with Hyperliquid and MEXC APIs.
    - **Result:** Updated 76 trades to their correct exchange (Hyperliquid or MEXC).
- **2026-01-05:** Externalized Configuration.
    - **Action:** Created `server/config.js` to centralize all hardcoded values (intervals, thresholds, scoring weights, indicator settings).
    - **Refactor:** Updated `server.js`, `server/scanner.js`, and `server/tracker.js` to import from `CONFIG`.
    - **Benefit:** Easier to tune strategy parameters without modifying core logic code.
- **2026-01-05:** Modularized Analysis Engine.
    - **Action:** Extracted `AnalysisEngine` from `server/scanner.js` to `server/analysis.js`.
    - **Refactor:** Updated `server/scanner.js` to import `AnalysisEngine`.
    - **Benefit:** Cleaner code, better separation of concerns (Data Fetching vs. Analysis), and easier to test.
- **2026-01-05:** Enhanced Logging.
    - **Action:** Created `server/logger.js` with structured logging (INFO, WARN, ERROR) and file persistence.
    - **Refactor:** Updated `server/scanner.js` and `server/tracker.js` to use `Logger` instead of `console.log`.
    - **Benefit:** Better observability and debugging capabilities. Logs are now saved to `logs/` directory.

## Active Tasks / Focus
- Recently working on `server/scanner.js`.
- Implemented Pivot-to-Pivot Divergence.
- Fixed Trade History display issues.
- Externalized Configuration.
- Modularized Analysis Engine.
- Enhanced Logging.
