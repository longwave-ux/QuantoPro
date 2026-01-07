# Dynamic Foretest UX Update (2026-01-07)

We have refined the Foretest user experience to be more intuitive, less intrusive, and better integrated into the main application workflow.

## Key Changes

### 1. **"Recalculating..." Bar Location**
- **Previously:** The progress bar appeared inside the "Strategy" configuration panel, shifting the UI layout.
- **Now:** The progress bar and results appear in the **Main View** (Performance Panel area), keeping the configuration panel clean and focused on settings.

### 2. **Preventing Auto-Run on Tab Switch**
- **Issue:** Entering the "Strategy" tab used to immediately trigger a foretest, even if no changes were made.
- **Fix:** The foretest now only triggers when you **change a parameter** or explicitly click "Test Current". It respects the initial load state.

### 3. **Integration with App State**
- Foretest logic has been lifted to `App.tsx`.
- Typically, you will tweak settings in the Config Panel, and see the **Simulation Results** box appear at the top of the main view, showing you the projected "Win Rate", "Total Signals", and "Net Wins" for the last 10 days (configurable).

## Configuration Persistence Fix
- **Issue:** Changing parameters (especially "Lookback") sometimes reverted on reload due to state desync and destructive file saves.
- **Fix:**
    - **Deep Merge:** Refactored server-side `saveConfig` to use a non-destructive Deep Merge strategy.
    - **State Unification:** Removed temporary local state for "Foretest Days" and wired the UI directly to the persistent `config.SYSTEM.FORETEST_DAYS`.
    - **Stability:** Ensures that even if the frontend sends a partial update (which shouldn't happen, but just in case), existing keys in `config.json` are preserved.

## How to Use

1. **Open Strategy Settings:** Click the **Settings** (gear icon) and go to the **Strategy** tab.
2. **Tweak Parameters:** Adjust any threshold (e.g., `Min Score`, `Lookback` days).
3. **Automatic Feedback:**
   - A "Recalculating Foretest..." bar will appear in the background main view.
   - After a few seconds, the **Simulation Results** box will update with the new performance stats.
4. **Test Current:** You can also manually trigger a run by clicking "Test Current" in the header of the Config Panel.
5. **Persistence:** Click **Save** to persist changes to `data/config.json`. These will survive server restarts.

## Verification
- **Build:** Verified successful production build with `npm run build`.
- **API:** Confirmed `/api/config` returns updated values after save and reload.
