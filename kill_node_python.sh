#!/bin/bash
pkill -f "node server/optimizer.js"
pkill -f "market_scanner.py"
pkill -f "analyze_drivers.js"
echo "Killed all optimization processes."
