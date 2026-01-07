# Project Status & Architecture Log

This file tracks the project structure, key decisions, and ongoing development context to ensure continuity.

## Project Purpose & Reasoning

### Core Objective
The **QuantPro Crypto Scanner** is designed to solve the problem of "Analysis Paralysis" and "Screen Watching" for crypto traders. Manual trading requires hours of staring at charts to find valid setups, often leading to emotional errors or missed opportunities. This system automates the technical analysis process 24/7.

### Why This Architecture?
-   **Monolithic (Node.js + React):** Chosen for simplicity and ease of deployment on a single VPS. It avoids the complexity of microservices while keeping the "Scanner Loop" and "Frontend UI" tightly integrated via shared JSON state files.
-   **JSON Flat-File DB:** We deliberately avoided setting up a SQL/NoSQL database to keep the system portable and "zero-conf". `history.json` and `trade_history.json` provide sufficient persistence for the scale of tracking ~50-100 pairs.
-   **Pro-Active vs Reactive:** Unlike simple alert bots, this system *scores* every pair (0-100) based on Trend, Structure, Money Flow, and Timing. This allows for ranking opportunities rather than just flagging them.

## Recent Updates / Changelog

### **2026-01-06: Telegram Notification Fixes**
-   **Debugging & Fix:**
    -   Resolved issue where Telegram alerts were not sending despite being enabled.
    -   Added explicit checks for `settings.entryAlerts` in `server/tracker.js` before calling alert functions.
    -   Verified functionality with temporary debug logs, now removed.

### **2026-01-06: Adaptive Strategy & Optimization**
-   **Optimization Fix:**
    -   Investigated a reported crash (`Cannot set properties of undefined`) in the Auto-Optimizer.
    -   Verified that the `server/optimizer.js` handles missing/malformed `THRESHOLDS` gracefully.
    -   Confirmed by running a Stress Test Suite (`test_optimizer.js`) against the current codebase. Result: **Stable**.
-   **Adaptive Strategy Implementation:**
    -   **Concept:** Dynamic adjustment of entry parameters based on the ADX Trend Strength.
        -   *High Trend (ADX > 25):* Aggressive Entries (0.382 Fib), Shorter Confirmation Windows (10 candles).
        -   *Low Trend:* Conservative Entries (0.618 Fib), Longer Confirmation Windows.
    -   **Toggle Logic:**
        -   Added a global toggle `ENABLE_ADAPTIVE` in `server/config.js` and `ConfigPanel.tsx`.
        -   Fixed a persistence bug where the toggle appeared reset upon reload due to browser caching. **Fix:** Added timestamp `?t=...` to the `fetchConfig` call in React.
    -   **Verification:** Verified end-to-end configuration persistence with `verify_persistence.js` and manual API simulation.

### **2026-01-07: Foretest UX & Persistence Overhaul**
-   **Foretest UX Improvements:**
    -   Moved "Recalculating..." progress bar from Settings Modal to Main View (Performance Panel).
    -   Prevented annoying "Auto-Run" on simply opening the Strategy tab. It now only runs on parameter *changes*.
    -   Unified simulation state in `App.tsx` for cleaner architecture.
    -   See [Foretest_UX_Walkthrough.md](./Foretest_UX_Walkthrough.md) for details.
-   **Configuration Persistence Fix:**
    -   Debugged issue where parameters (especially `FORETEST_DAYS` lookback) were not saving.
    -   **Fix:** Refactored `server/config.js` to use **Deep Merge** for saving, preventing accidental overwrites of missing keys.
    -   **Fix:** Wired "Lookback" input directly to `config.SYSTEM` to fix state desync.
    -   **Fix:** Updated `types.ts` to include `FORETEST_DAYS`.

## Directory Structure & Key Files

### Root
-   `server.js`: Main entry point. Runs the Express server and the 24/7 scanning loops.
    -   **Scanner Loop:** Runs every 15 minutes (`runServerScan`).
    -   **Tracker Loop:** Runs every 1 minute (`updateOutcomes`).
-   `package.json`: Dependencies (Express, Ethers, Technical Indicators, React, etc.).

### Server (`/server`)
-   `scanner.js`: **Core Logic.** Fetches data, orchestrates analysis, and saves results.
-   `analysis.js`: **Logic Engine.** Contains the `AnalysisEngine` which holds all strategy rules (Trend, Pullback, scoring).
-   `optimizer.js`: **Grid Search.** Runs backtests on combinations of parameters to find the best settings.
-   `marketData.js`: Handles API requests (Binance, MEXC, Hyperliquid).
-   `tracker.js`: Forward-testing engine. Tracks "Open" signals to closure (TP/SL).
-   `config.js`: Centralized configuration management (Load/Save).
-   `logger.js`: Structured logging utility.

### Frontend (`/src`, `/components`)
-   `ConfigPanel.tsx`: Key UI for adjusting Strategy Parameters and toggling Adaptive Mode.
-   `ScannerTable.tsx`: Main view displaying the list of opportunities.

## Technical Decisions Log

-   **2026-01-05:** Created `server/logger.js` to replace `console.log` for better production observability.
-   **2026-01-05:** Modularized `AnalysisEngine` out of `scanner.js` to allow `optimizer.js` to import it without circular dependencies.
-   **2026-01-05:** Externalized all "Magic Numbers" (RSI period, Overbought levels, etc.) into `server/config.js` to allow on-the-fly "Hot Reloading" of strategy settings via the UI.
-   **2026-01-06:** **Adaptive Mode Persistence:** Switched frontend fetching to non-cached to ensure the user always sees the true server state.

## Pending / Roadmap
-   **Adaptive Logic Tuning:** Monitor the performance of "Adaptive Mode" in forward testing.
-   **UI Feedback:** Add visual indicators in `ScannerTable` when a setup was generated using "Aggressive" vs "Conservative" logic.

### **Development Note: Building Frontend**
> [!IMPORTANT]
> The application serves the frontend as static files from the `dist/` directory.
> Any changes made to React components (`src/`, `components/`) **MUST** be followed by a rebuild command to take effect in the production server:
> ```bash
> npm run build
> ```
