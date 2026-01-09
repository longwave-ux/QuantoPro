import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Zap, Activity, RefreshCw, Settings, Trophy, AlertTriangle, ArrowRight, BarChart2, Save, X, Terminal, Brain, Wallet,
    Clock, Download, Database, Upload, Globe, Send, WifiOff, CheckCircle2, AlertCircle, Bot, Bell
} from 'lucide-react';
import { runScannerWorkflow, exportHistoryJSON, restoreHistoryJSON, getSystemLogs, LogEntry } from './services/dataService';
import { AnalysisResult, NotificationSettings, DataSource } from './types';
import { ScannerTable } from './components/ScannerTable';
import { PerformancePanel } from './components/PerformancePanel';
import { ConfigPanel } from './components/ConfigPanel';
import { ExchangePanel } from './components/ExchangePanel';
import { AIAnalysisPanel } from './components/AIAnalysisPanel';
import { sendTelegramAlert } from './services/telegramService';

const REFRESH_INTERVAL = 15 * 60; // 15 minutes in seconds

const DEFAULT_SETTINGS: NotificationSettings = {
    enabled: false,
    entryAlerts: false,
    botToken: '',
    chatId: '',
    minScore: 85,
    activeExchange: 'HYPERLIQUID'
};

export default function App() {
    // PERSISTENT STATE: View Settings & Data
    const [timeframe, setTimeframe] = useState(() => localStorage.getItem('cs_timeframe') || '15m');
    const [dataSource, setDataSource] = useState(() => localStorage.getItem('cs_datasource') || 'MEXC');

    // Initial Data Load (Prevent Flash)
    const [data, setData] = useState<AnalysisResult[]>(() => {
        try {
            return [];
        } catch { return []; }
    });

    const [lastUpdated, setLastUpdated] = useState<Date | null>(() => {
        try {
            const saved = localStorage.getItem('cs_last_updated');
            return saved ? new Date(saved) : null;
        } catch { return null; }
    });

    const [isScanning, setIsScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [timeLeft, setTimeLeft] = useState(REFRESH_INTERVAL);

    // Main View State
    const [mainView, setMainView] = useState<'SCANNER' | 'PERFORMANCE' | 'EXCHANGE'>('SCANNER');

    // Performance Data State (Paper Trading / Foretest)
    const [tradeHistory, setTradeHistory] = useState<any[]>([]);
    const [perfStats, setPerfStats] = useState<any>({});

    const triggerPerformanceUpdate = useCallback(async () => {
        try {
            // Only fetch if we are in Performance view OR Strategy Modal is open (to show live results if needed)
            // But simpler to just fetch periodically
            const res = await fetch('/api/performance');
            if (res.ok) {
                const json = await res.json();
                setTradeHistory(json.history || []);
                setPerfStats(json.stats || {});
            }
        } catch (e) { console.error("Perf fetch error", e); }
    }, []);

    useEffect(() => {
        triggerPerformanceUpdate();
        // Poll every 30s for performance updates
        const interval = setInterval(triggerPerformanceUpdate, 30000);
        return () => clearInterval(interval);
    }, [triggerPerformanceUpdate]);

    // Notification Settings State
    const [showSettings, setShowSettings] = useState(false);
    const [showStrategyModal, setShowStrategyModal] = useState(false);
    const [modalDimensions, setModalDimensions] = useState({ width: 500, height: 600 });
    const [strategyModalDimensions, setStrategyModalDimensions] = useState({ width: 900, height: 800 });

    const handleModalResize = (e: React.MouseEvent, type: 'SETTINGS' | 'STRATEGY') => {
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startDims = type === 'SETTINGS' ? modalDimensions : strategyModalDimensions;
        const startWidth = startDims.width;
        const startHeight = startDims.height;

        const onMouseMove = (e: MouseEvent) => {
            const newWidth = startWidth + (e.clientX - startX);
            const newHeight = startHeight + (e.clientY - startY);
            if (type === 'SETTINGS') {
                setModalDimensions({
                    width: Math.max(400, Math.min(1600, newWidth)),
                    height: Math.max(500, Math.min(1200, newHeight))
                });
            } else {
                setStrategyModalDimensions({
                    width: Math.max(600, Math.min(1800, newWidth)),
                    height: Math.max(600, Math.min(1400, newHeight))
                });
            }
        };
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
    const [activeTab, setActiveTab] = useState<'ALERTS' | 'DATA' | 'LOGS' | 'TRADING' | 'AI' | 'STRATEGY'>('ALERTS');
    const [systemLogs, setSystemLogs] = useState<LogEntry[]>([]);
    const [testMsgStatus, setTestMsgStatus] = useState<'IDLE' | 'SENDING' | 'SUCCESS' | 'ERROR'>('IDLE');

    const [settings, setSettings] = useState<NotificationSettings>(() => {
        try {
            const saved = localStorage.getItem('crypto_scanner_settings');
            if (saved) {
                const parsed = JSON.parse(saved);
                // Merge with defaults to ensure all keys exist
                return { ...DEFAULT_SETTINGS, ...parsed };
            }
            return DEFAULT_SETTINGS;
        } catch (e) {
            console.error("Failed to parse settings", e);
            return DEFAULT_SETTINGS;
        }
    });

    // Sync View Settings to Storage
    useEffect(() => { localStorage.setItem('cs_timeframe', timeframe); }, [timeframe]);
    useEffect(() => { localStorage.setItem('cs_datasource', dataSource); }, [dataSource]);


    // ==========================================
    // FORETEST / SIMULATION STATE (LIFTED)
    // ==========================================
    const [foretestDays, setForetestDays] = useState(10);
    const [foretestStatus, setForetestStatus] = useState<any>({ status: 'IDLE', progress: 0, eta: 0 });
    const [simulationResults, setSimulationResults] = useState<any | null>(null);
    const [isSimulating, setIsSimulating] = useState(false);
    const foretestTimer = useRef<number | null>(null);

    // Poll Foretest Status
    useEffect(() => {
        if (isSimulating) {
            foretestTimer.current = window.setInterval(async () => {
                try {
                    const res = await fetch('/api/backtest/status');
                    const status = await res.json();
                    setForetestStatus(status);

                    if (status.status === 'COMPLETED') {
                        setSimulationResults(status.result);
                        setIsSimulating(false);
                        if (foretestTimer.current) clearInterval(foretestTimer.current);
                    } else if (status.status === 'ERROR') {
                        console.error("Backtest failed", status.error);
                        setIsSimulating(false);
                        if (foretestTimer.current) clearInterval(foretestTimer.current);
                    }
                } catch (e) {
                    console.error('Backtest poll failed', e);
                }
            }, 1000);
        }
        return () => {
            if (foretestTimer.current) clearInterval(foretestTimer.current);
        };
    }, [isSimulating]);

    const triggerForetest = async (cfg: any, days: number) => {
        setIsSimulating(true);
        // setSimulationResults(null); // Optional: Keep old results visible while recalculating?

        try {
            const res = await fetch('/api/backtest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: cfg, days })
            });
            const data = await res.json();
            if (!data.success) {
                console.error("Failed to start backtest", data);
                setIsSimulating(false);
            }
        } catch (e) {
            console.error("Failed to trigger backtest", e);
            setIsSimulating(false);
        }
    };

    // Use a ref to keep track of latest settings for the interval closure and scan callbacks
    const settingsRef = useRef(settings);

    // Auto-save settings to localStorage AND Server whenever they change
    useEffect(() => {
        settingsRef.current = settings;
        localStorage.setItem('crypto_scanner_settings', JSON.stringify(settings));

        // Sync to server for 24/7 alerts
        fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        }).catch(e => console.error("Failed to sync settings to server", e));

    }, [settings]);

    const closeSettings = () => {
        setShowSettings(false);
        setTestMsgStatus('IDLE');
    };

    const updateLogs = () => {
        setSystemLogs(getSystemLogs());
    };

    useEffect(() => {
        if (showSettings && activeTab === 'LOGS') {
            updateLogs();
            const interval = setInterval(updateLogs, 2000);
            return () => clearInterval(interval);
        }
    }, [showSettings, activeTab]);

    const handleTestAlert = async () => {
        if (!settings.botToken || !settings.chatId) return;
        setTestMsgStatus('SENDING');
        try {
            const url = `https://api.telegram.org/bot${settings.botToken}/sendMessage`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: settings.chatId,
                    text: "🔔 <b>Test Alert from CryptoScanner</b>\n\nIf you see this, your configuration is correct!",
                    parse_mode: 'HTML'
                })
            });
            if (res.ok) setTestMsgStatus('SUCCESS');
            else setTestMsgStatus('ERROR');
        } catch (e) {
            setTestMsgStatus('ERROR');
        }

        setTimeout(() => setTestMsgStatus('IDLE'), 3000);
    };

    const performScan = useCallback(async (selectedTf: string) => {
        setIsScanning(true);
        setScanError(null);
        try {
            const results = await runScannerWorkflow(selectedTf, dataSource, (msg) => console.log(msg));

            if (results.length === 0) {
                // If we got 0 results but no error thrown, it might be a silent failure or market conditions
            }

            setData(results);
            const now = new Date();
            setLastUpdated(now);
            setTimeLeft(REFRESH_INTERVAL);

            // Persist Results
            localStorage.setItem(`cs_last_results_${dataSource}`, JSON.stringify(results));
            localStorage.setItem('cs_last_updated', now.toISOString());

            // Trigger Notifications using the Ref to ensure latest settings are used
            await sendTelegramAlert(results, settingsRef.current);

        } catch (error: any) {
            console.error("Scan failed", error);
            setScanError(error.message || "Network Error: Could not fetch market data.");
        } finally {
            setIsScanning(false);
        }
    }, [dataSource]);

    // Initial load & Source Change
    useEffect(() => {
        const init = async () => {
            // 1. Try Local Storage for this specific source FIRST (Instant UI feedback)
            try {
                const localSaved = localStorage.getItem(`cs_last_results_${dataSource}`);
                if (localSaved) {
                    const parsed = JSON.parse(localSaved);
                    if (parsed.length > 0) {
                        setData(parsed);
                        // Don't return yet, check server for updates
                    }
                } else {
                    setData([]); // Clear old data if nothing found for this source
                }
            } catch (e) { console.error("Local load error", e); }

            // 2. Try to fetch pre-calculated results from the 24/7 server loop
            try {
                const res = await fetch(`/api/results?source=${dataSource}`);
                if (res.ok) {
                    const serverResults = await res.json();
                    if (Array.isArray(serverResults) && serverResults.length > 0) {
                        console.log("Loaded results from server cache");
                        setData(serverResults);
                        // Use the timestamp from the first result or current time
                        const resultTime = serverResults[0].timestamp ? new Date(serverResults[0].timestamp) : new Date();
                        setLastUpdated(resultTime);

                        // Update local storage with fresh server data
                        localStorage.setItem(`cs_last_results_${dataSource}`, JSON.stringify(serverResults));
                        return;
                    }
                }
            } catch (e) {
                console.log("Server cache unavailable, running local scan...");
            }

            // 3. Fallback to local scan ONLY if we have absolutely no data
            const currentData = localStorage.getItem(`cs_last_results_${dataSource}`);
            if (!currentData) {
                performScan(timeframe);
            }
        };
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataSource]);

    // Handle Timeframe Change
    const handleTimeframeChange = (tf: string) => {
        if (tf === timeframe) return;
        setTimeframe(tf);
        performScan(tf);
    };

    // Timer & Auto Refresh logic
    useEffect(() => {
        const timer = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    performScan(timeframe);
                    return REFRESH_INTERVAL;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [timeframe, performScan]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const exportCSV = () => {
        if (data.length === 0) return;

        const headers = ["Symbol", "Price", "Score", "Bias", "Action", "Entry", "SL", "TP", "RR", "Pullback%", "RSI"];
        const rows = data.map(d => [
            d.symbol,
            d.price.toFixed(4),
            d.score,
            d.htf.bias,
            d.setup ? d.setup.side : 'WAIT',
            d.setup ? d.setup.entry.toFixed(4) : '-',
            d.setup ? d.setup.sl.toFixed(4) : '-',
            d.setup ? d.setup.tp.toFixed(4) : '-',
            d.setup ? d.setup.rr : '-',
            (d.ltf.pullbackDepth * 100).toFixed(1) + '%',
            d.ltf.rsi.toFixed(1)
        ].join(","));

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `crypto_scan_${timeframe}_${dataSource}_${new Date().toISOString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleBackupHistory = () => {
        const json = exportHistoryJSON();
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "scanner_history_backup.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleRestoreHistory = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target?.result) {
                const success = restoreHistoryJSON(event.target.result as string);
                if (success) alert("History restored successfully! The next scan will use this data.");
                else alert("Invalid backup file.");
            }
        };
        reader.readAsText(file);
    };

    // Helper for display labels
    const getTimeframeLabel = (tf: string) => {
        switch (tf) {
            case '1h': return '1H + 5m';
            case '4h': return '4H + 15m';
            case '1d': return '1D + 1H';
            default: return tf.toUpperCase();
        }
    }

    return (
        <div className="min-h-screen bg-gray-950 text-gray-200 font-sans p-4 md:p-8 relative pb-20">
            {/* Strategy Modal */}
            {showStrategyModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div
                        style={{ width: `${strategyModalDimensions.width}px`, height: `${strategyModalDimensions.height}px` }}
                        className="bg-gray-900 border border-purple-500/30 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col relative"
                    >
                        <div
                            className="absolute right-0 bottom-0 w-8 h-8 cursor-nwse-resize flex items-end justify-end p-1 z-50 hover:bg-gray-800 rounded-br-xl transition-colors"
                            onMouseDown={(e) => handleModalResize(e, 'STRATEGY')}
                        >
                            <div className="w-3 h-3 border-r-2 border-b-2 border-gray-600 mr-1 mb-1"></div>
                        </div>

                        {/* Header */}
                        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-850">
                            <div>
                                <h3 className="font-bold text-white text-lg flex items-center gap-2">
                                    <BarChart2 className="w-5 h-5 text-purple-500" /> Strategy Configuration
                                </h3>
                                <p className="text-xs text-gray-500">Fine-tune your edge. Changes affect Scan & Foretest immediately.</p>
                            </div>
                            <button onClick={() => setShowStrategyModal(false)} className="text-gray-500 hover:text-white transition-colors bg-gray-800 p-2 rounded-full hover:bg-gray-700">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar bg-gray-950">
                            <ConfigPanel
                                onRunSimulation={triggerForetest}
                                isSimulating={isSimulating}
                            />
                        </div>

                        {/* Footer */}
                        <div className="p-4 bg-gray-900 border-t border-gray-800 flex justify-end gap-3">
                            <button
                                onClick={() => setShowStrategyModal(false)}
                                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-lg flex items-center gap-2 transition-transform active:scale-95"
                            >
                                <Save className="w-4 h-4" /> Save & Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Settings Modal */}
            {showSettings && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div
                        style={{ width: `${modalDimensions.width}px`, height: `${modalDimensions.height}px` }}
                        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col relative"
                    >
                        <div
                            className="absolute right-0 bottom-0 w-8 h-8 cursor-nwse-resize flex items-end justify-end p-1 z-50 hover:bg-gray-800 rounded-br-xl transition-colors"
                            onMouseDown={(e) => handleModalResize(e, 'SETTINGS')}
                        >
                            <div className="w-3 h-3 border-r-2 border-b-2 border-gray-600 mr-1 mb-1"></div>
                        </div>
                        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-850">
                            <h3 className="font-semibold text-white flex items-center gap-2">
                                <Settings className="w-5 h-5 text-gray-400" /> System Settings
                            </h3>
                            <button onClick={closeSettings} className="text-gray-500 hover:text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex border-b border-gray-800 bg-gray-900/50">
                            <button
                                onClick={() => setActiveTab('ALERTS')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition-colors border-b-2 ${activeTab === 'ALERTS' ? 'border-blue-500 text-blue-400 bg-blue-900/10' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                            >
                                Alerts
                            </button>
                            <button
                                onClick={() => setActiveTab('DATA')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition-colors border-b-2 ${activeTab === 'DATA' ? 'border-purple-500 text-purple-400 bg-purple-900/10' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                            >
                                Data
                            </button>
                            <button
                                onClick={() => setActiveTab('TRADING')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition-colors border-b-2 ${activeTab === 'TRADING' ? 'border-orange-500 text-orange-400 bg-orange-900/10' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                            >
                                Trading
                            </button>
                            <button
                                onClick={() => setActiveTab('AI')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition-colors border-b-2 ${activeTab === 'AI' ? 'border-purple-500 text-purple-400 bg-purple-900/10' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                            >
                                AI
                            </button>
                            <button
                                onClick={() => setActiveTab('LOGS')}
                                className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide transition-colors border-b-2 ${activeTab === 'LOGS' ? 'border-green-500 text-green-400 bg-green-900/10' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
                            >
                                Sys Logs
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">

                            {activeTab === 'ALERTS' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                                    <h4 className="text-xs uppercase font-bold text-blue-400 flex items-center gap-2">
                                        <Bell className="w-3 h-3" /> Telegram Configuration
                                    </h4>

                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-gray-300">Enable High Score Alerts</label>
                                        <button
                                            onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
                                            className={`w-12 h-6 rounded-full transition-colors relative ${settings.enabled ? 'bg-blue-600' : 'bg-gray-700'}`}
                                        >
                                            <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                                        </button>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-gray-300">Enable Entry Alerts</label>
                                        <button
                                            onClick={() => setSettings({ ...settings, entryAlerts: !settings.entryAlerts })}
                                            className={`w-12 h-6 rounded-full transition-colors relative ${settings.entryAlerts ? 'bg-yellow-600' : 'bg-gray-700'}`}
                                        >
                                            <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${settings.entryAlerts ? 'translate-x-6' : 'translate-x-0'}`}></div>
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs uppercase font-bold text-gray-500">Bot Token</label>
                                        <input
                                            type="text"
                                            value={settings.botToken}
                                            onChange={(e) => setSettings({ ...settings, botToken: e.target.value })}
                                            placeholder="123456:ABC..."
                                            autoComplete="off"
                                            className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:border-blue-500 focus:outline-none placeholder-gray-700"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs uppercase font-bold text-gray-500">Chat ID</label>
                                        <input
                                            type="text"
                                            value={settings.chatId}
                                            onChange={(e) => setSettings({ ...settings, chatId: e.target.value })}
                                            placeholder="123456789"
                                            autoComplete="off"
                                            className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:border-blue-500 focus:outline-none placeholder-gray-700"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs uppercase font-bold text-gray-500">Minimum Score</label>
                                        <input
                                            type="number"
                                            value={settings.minScore}
                                            onChange={(e) => setSettings({ ...settings, minScore: Number(e.target.value) })}
                                            placeholder="85"
                                            className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:border-blue-500 focus:outline-none placeholder-gray-700"
                                        />
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            onClick={handleTestAlert}
                                            disabled={!settings.botToken || !settings.chatId || testMsgStatus === 'SENDING'}
                                            className={`w-full py-2 rounded text-xs font-semibold flex items-center justify-center gap-2 transition-colors ${testMsgStatus === 'SUCCESS' ? 'bg-green-600 text-white' :
                                                testMsgStatus === 'ERROR' ? 'bg-red-600 text-white' :
                                                    'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                                                }`}
                                        >
                                            {testMsgStatus === 'SENDING' && <RefreshCw className="w-3 h-3 animate-spin" />}
                                            {testMsgStatus === 'SUCCESS' && "Test Message Sent!"}
                                            {testMsgStatus === 'ERROR' && "Failed to Send (Check Token/ID)"}
                                            {testMsgStatus === 'IDLE' && <><Send className="w-3 h-3" /> Send Test Alert</>}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'TRADING' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                                    <div className="flex items-center gap-2 mb-4">
                                        <button
                                            onClick={() => setSettings({ ...settings, activeExchange: 'MEXC' })}
                                            className={`flex-1 py-2 text-xs font-bold rounded border ${settings.activeExchange !== 'HYPERLIQUID' ? 'bg-orange-500/20 border-orange-500 text-orange-400' : 'bg-gray-900 border-gray-800 text-gray-500'}`}
                                        >
                                            MEXC
                                        </button>
                                        <button
                                            onClick={() => setSettings({ ...settings, activeExchange: 'HYPERLIQUID' })}
                                            className={`flex-1 py-2 text-xs font-bold rounded border ${settings.activeExchange === 'HYPERLIQUID' ? 'bg-cyan-500/20 border-cyan-500 text-cyan-400' : 'bg-gray-900 border-gray-800 text-gray-500'}`}
                                        >
                                            HYPERLIQUID
                                        </button>
                                    </div>

                                    {settings.activeExchange !== 'HYPERLIQUID' ? (
                                        <>
                                            <h4 className="text-xs uppercase font-bold text-orange-400 flex items-center gap-2">
                                                <Zap className="w-3 h-3" /> MEXC API Configuration
                                            </h4>
                                            <p className="text-[10px] text-gray-500 leading-relaxed">
                                                Configure your MEXC API keys here to enable direct trading from the scanner.
                                                Keys are stored locally and on your private server.
                                            </p>

                                            <div className="space-y-2">
                                                <label className="text-xs uppercase font-bold text-gray-500">API Key</label>
                                                <input
                                                    type="text"
                                                    value={settings.mexcApiKey || ''}
                                                    onChange={(e) => setSettings({ ...settings, mexcApiKey: e.target.value })}
                                                    placeholder="mx0..."
                                                    autoComplete="off"
                                                    className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:border-orange-500 focus:outline-none placeholder-gray-700"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs uppercase font-bold text-gray-500">Secret Key</label>
                                                <input
                                                    type="password"
                                                    value={settings.mexcApiSecret || ''}
                                                    onChange={(e) => setSettings({ ...settings, mexcApiSecret: e.target.value })}
                                                    placeholder="••••••••••••••••"
                                                    autoComplete="off"
                                                    className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:border-orange-500 focus:outline-none placeholder-gray-700"
                                                />
                                            </div>

                                            <div className="p-3 bg-orange-900/10 border border-orange-900/30 rounded text-[10px] text-orange-300/80">
                                                <strong className="block mb-1 text-orange-400">Security Note:</strong>
                                                Ensure your API keys have "Spot Trading" and "Futures Trading" permissions enabled.
                                                Do not enable "Withdrawal" permissions.
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <h4 className="text-xs uppercase font-bold text-cyan-400 flex items-center gap-2">
                                                <Zap className="w-3 h-3" /> Hyperliquid Configuration
                                            </h4>
                                            <p className="text-[10px] text-gray-500 leading-relaxed">
                                                Configure your Arbitrum Wallet Private Key to enable trading on Hyperliquid.
                                                The key is used to sign orders locally on the server.
                                            </p>

                                            <div className="space-y-2">
                                                <label className="text-xs uppercase font-bold text-gray-500">Wallet Private Key (Agent)</label>
                                                <input
                                                    type="password"
                                                    value={settings.hyperliquidPrivateKey || ''}
                                                    onChange={(e) => setSettings({ ...settings, hyperliquidPrivateKey: e.target.value })}
                                                    placeholder="0x..."
                                                    autoComplete="off"
                                                    className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none placeholder-gray-700"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-xs uppercase font-bold text-gray-500 flex items-center gap-2">
                                                    Main Account Address <span className="text-gray-600 text-[9px]">(Optional)</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    value={settings.hyperliquidMasterAddress || ''}
                                                    onChange={(e) => setSettings({ ...settings, hyperliquidMasterAddress: e.target.value })}
                                                    placeholder="0x... (If using Agent Key)"
                                                    autoComplete="off"
                                                    className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none placeholder-gray-700 font-mono"
                                                />
                                            </div>

                                            <div className="p-3 bg-cyan-900/10 border border-cyan-900/30 rounded text-[10px] text-cyan-300/80">
                                                <strong className="block mb-1 text-cyan-400">Agent Key Mode:</strong>
                                                If using an Agent Key (0 balance), enter your Main Account Address above to view your actual portfolio balance.
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {activeTab === 'STRATEGY' && (
                                <div className="animate-in fade-in slide-in-from-right-4 duration-200">
                                    <ConfigPanel
                                        onRunSimulation={triggerForetest}
                                        isSimulating={isSimulating}
                                    />
                                </div>
                            )}

                            {activeTab === 'AI' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                                    <h4 className="text-xs uppercase font-bold text-purple-400 flex items-center gap-2">
                                        <Bot className="w-3 h-3" /> Gemini AI Configuration
                                    </h4>
                                    <p className="text-[10px] text-gray-500 leading-relaxed">
                                        Configure your Google Gemini API Key to enable automated AI analysis of every scan result.
                                    </p>

                                    <div className="space-y-2">
                                        <label className="text-xs uppercase font-bold text-gray-500">Gemini API Key</label>
                                        <input
                                            type="text"
                                            value={settings.geminiLLMApiKey || ''}
                                            onChange={(e) => setSettings({ ...settings, geminiLLMApiKey: e.target.value })}
                                            placeholder="AIza..."
                                            autoComplete="off"
                                            className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm focus:border-purple-500 focus:outline-none placeholder-gray-700"
                                        />
                                    </div>

                                    <div className="p-3 bg-purple-900/10 border border-purple-900/30 rounded text-[10px] text-purple-300/80">
                                        <strong className="block mb-1 text-purple-400">Note:</strong>
                                        This key is used solely for generating trading insights via the Gemini LLM. It is not used for trading execution.
                                    </div>
                                </div>
                            )}

                            {activeTab === 'DATA' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                                    <h4 className="text-xs uppercase font-bold text-purple-400 flex items-center gap-2">
                                        <Database className="w-3 h-3" /> Backup & Restore
                                    </h4>
                                    <p className="text-[10px] text-gray-500 leading-relaxed">
                                        Your scan history is saved in your browser. Use this to transfer data between devices or clear your local cache.
                                    </p>

                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={handleBackupHistory}
                                            className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded border border-gray-700 transition-colors"
                                        >
                                            <Download className="w-3 h-3" /> Backup History
                                        </button>

                                        <label className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium rounded border border-gray-700 transition-colors cursor-pointer">
                                            <Upload className="w-3 h-3" /> Restore History
                                            <input type="file" accept=".json" onChange={handleRestoreHistory} className="hidden" />
                                        </label>
                                    </div>

                                    <div className="pt-4">
                                        <div className="text-[10px] text-gray-600 font-mono bg-gray-950 p-2 rounded border border-gray-800">
                                            Local Storage Usage: {((JSON.stringify(localStorage).length / 1024) / 1024).toFixed(2)} MB
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'LOGS' && (
                                <div className="h-full flex flex-col animate-in fade-in slide-in-from-right-4 duration-200">
                                    <h4 className="text-xs uppercase font-bold text-green-400 flex items-center gap-2 mb-4">
                                        <Terminal className="w-3 h-3" /> System Terminal
                                    </h4>
                                    <div className="flex-1 bg-black rounded-lg border border-gray-800 p-3 font-mono text-[10px] overflow-y-auto custom-scrollbar space-y-1">
                                        {systemLogs.length === 0 && <span className="text-gray-600 italic">No logs generated yet. Run a scan.</span>}
                                        {systemLogs.map((log, i) => (
                                            <div key={i} className="flex gap-2">
                                                <span className="text-gray-600 shrink-0">[{log.timestamp}]</span>
                                                <span className={`shrink-0 font-bold ${log.level === 'INFO' ? 'text-blue-400' :
                                                    log.level === 'SUCCESS' ? 'text-green-400' :
                                                        log.level === 'ERROR' ? 'text-red-500' : 'text-yellow-400'
                                                    }`}>{log.level}:</span>
                                                <span className="text-gray-300 break-all">{log.message}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 mt-2 justify-end">
                                        <button onClick={updateLogs} className="text-xs text-gray-500 hover:text-white flex items-center gap-1">
                                            <RefreshCw className="w-3 h-3" /> Refresh Logs
                                        </button>
                                    </div>
                                </div>
                            )}

                        </div>

                        <div className="p-4 bg-gray-950/50 border-t border-gray-800 flex justify-end">
                            <button
                                onClick={closeSettings}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
                            >
                                <Save className="w-4 h-4" /> Save & Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Top Bar */}
            <header className="flex flex-col xl:flex-row justify-between items-center mb-8 gap-6 border-b border-gray-800 pb-6">
                <div className="flex items-center gap-3 w-full xl:w-auto">
                    <div className="p-2 bg-blue-600 rounded-lg shadow-lg shadow-blue-900/20">
                        <Zap className="text-white w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-white tracking-tight">CryptoQuant Scanner Pro</h1>
                        <p className="text-xs text-gray-500">Scanning Top 200 Pairs by Volume • ATR Dynamic Risk • R:R &ge; 2.5</p>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row items-center gap-4 w-full xl:w-auto justify-between">

                    {/* Exchange Toggle */}
                    <div className="flex items-center bg-gray-900 p-1 rounded-lg border border-gray-800">
                        <button
                            onClick={() => !isScanning && setDataSource('KUCOIN')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1 transition-all ${dataSource === 'KUCOIN' ? 'bg-green-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
                        >
                            <Globe className="w-3 h-3" /> KUCOIN
                        </button>
                        <button
                            onClick={() => !isScanning && setDataSource('MEXC')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1 transition-all ${dataSource === 'MEXC' ? 'bg-blue-500 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
                        >
                            <Globe className="w-3 h-3" /> MEXC
                        </button>
                        <button
                            onClick={() => !isScanning && setDataSource('HYPERLIQUID')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md flex items-center gap-1 transition-all ${dataSource === 'HYPERLIQUID' ? 'bg-cyan-500 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
                        >
                            <Globe className="w-3 h-3" /> HYPERLIQUID
                        </button>
                    </div>

                    {/* Strategy Config Button (Replaces Timeframe Selector) */}
                    <button
                        onClick={() => setShowStrategyModal(true)}
                        className="px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold rounded-lg shadow-lg flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
                    >
                        <Settings className="w-5 h-5" /> STRATEGY CONFIG
                    </button>

                    {/* View Selector */}
                    <div className="bg-gray-900 p-1 rounded-lg border border-gray-800 flex items-center">
                        <button
                            onClick={() => setMainView('SCANNER')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${mainView === 'SCANNER'
                                ? 'bg-purple-600 text-white shadow-md'
                                : 'text-gray-400 hover:text-white hover:bg-gray-800'
                                }`}
                        >
                            <Activity className="w-3 h-3" /> Market Scanner
                        </button>
                        <button
                            onClick={() => setMainView('PERFORMANCE')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-2 ${mainView === 'PERFORMANCE'
                                ? 'bg-white text-purple-900 shadow-md'
                                : 'text-gray-400 hover:text-white hover:bg-gray-800'
                                }`}
                        >
                            <BarChart2 className="w-3 h-3" /> Backtest Results
                        </button>
                        <button
                            onClick={() => setMainView('EXCHANGE')}
                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${mainView === 'EXCHANGE'
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'text-gray-400 hover:text-white hover:bg-gray-800'
                                }`}
                        >
                            <Wallet className="w-3 h-3" /> Live Exchange
                        </button>
                    </div>

                    <div className="flex items-center gap-4">

                        {/* Settings Button */}
                        <button
                            onClick={() => setShowSettings(true)}
                            className={`p-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-all ${settings.enabled ? 'text-blue-400 border-blue-900' : 'text-gray-400'}`}
                            title="Settings & Alerts"
                        >
                            <Settings className="w-5 h-5" />
                        </button>

                        <div className="flex items-center gap-2 bg-gray-900 px-4 py-2 rounded-lg border border-gray-800">
                            <Clock className="w-4 h-4 text-blue-400" />
                            <span className="text-sm font-mono text-blue-400">{formatTime(timeLeft)}</span>
                            <span className="text-xs text-gray-600">until refresh</span>
                        </div>

                        <button
                            onClick={() => performScan(timeframe)}
                            disabled={isScanning}
                            className={`p-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-all ${isScanning ? 'animate-pulse' : ''}`}
                        >
                            <RefreshCw className={`w-5 h-5 text-gray-300 ${isScanning ? 'animate-spin' : ''}`} />
                        </button>

                        <button
                            onClick={exportCSV}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors shadow-lg shadow-blue-900/20"
                        >
                            <Download className="w-4 h-4" /> Export CSV
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Content (Full Width) */}
            <main className="w-full max-w-7xl mx-auto space-y-4">

                {/* FORETEST / SIMULATION FEEDBACK (When in Performance Mode) */}
                {mainView === 'PERFORMANCE' && (isSimulating || simulationResults) && (
                    <div className="animate-in fade-in slide-in-from-top-4 duration-500 mb-6">

                        {/* Progress Bar */}
                        {isSimulating && (
                            <div className="bg-gray-800 border border-purple-500/30 p-4 rounded-lg mb-4 flex items-center gap-4 shadow-lg shrink-0">
                                <div className="p-2 bg-purple-500/10 rounded-full"><RefreshCw className="text-purple-500 animate-spin" size={20} /></div>
                                <div className="flex-1">
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-gray-300 font-bold">Recalculating Foretest (Simulation)...</span>
                                        <span className="text-white font-mono">{foretestStatus.progress}% ({foretestStatus.eta}s left)</span>
                                    </div>
                                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${foretestStatus.progress}%` }} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Simulation Results Summary */}
                        {simulationResults && (
                            <div className="bg-gray-900 border border-purple-500/30 p-4 rounded-xl shadow-xl flex flex-col md:flex-row gap-6 items-center justify-between pb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Zap className="text-purple-500" size={20} />
                                        Simulation Results (New Parameters)
                                    </h3>
                                    <p className="text-xs text-gray-400">
                                        Projected performance over the last {foretestDays} days based on current settings.
                                    </p>
                                </div>
                                <div className="grid grid-cols-4 gap-4 text-center">
                                    <div className="bg-gray-800 p-2 rounded min-w-[80px]"><div className="text-gray-500 text-[10px] uppercase">Signals</div><div className="text-lg font-bold text-white">{simulationResults.totalSignals}</div></div>
                                    <div className="bg-gray-800 p-2 rounded min-w-[80px]"><div className="text-gray-500 text-[10px] uppercase">Win Rate</div><div className={`text-lg font-bold ${(simulationResults.wins / (simulationResults.wins + simulationResults.losses)) > 0.6 ? 'text-green-400' : 'text-yellow-400'}`}>{((simulationResults.wins / (simulationResults.wins + simulationResults.losses)) * 100).toFixed(1)}%</div></div>
                                    <div className="bg-gray-800 p-2 rounded min-w-[80px]"><div className="text-gray-500 text-[10px] uppercase">Wins</div><div className="text-lg font-bold text-green-500">{simulationResults.wins}</div></div>
                                    <div className="bg-gray-800 p-2 rounded min-w-[80px]"><div className="text-gray-500 text-[10px] uppercase">Losses</div><div className="text-lg font-bold text-red-500">{simulationResults.losses}</div></div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Network Error State */}
                {scanError && (
                    <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                        <div className="flex items-center gap-3">
                            <WifiOff className="w-5 h-5 text-red-400" />
                            <div>
                                <h3 className="text-sm font-bold text-red-200">Connection Failed</h3>
                                <p className="text-xs text-red-300/80">
                                    {scanError}. If you are deployed, ensure your proxy is active or try switching data sources.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => performScan(timeframe)}
                            className="px-3 py-1.5 bg-red-800 hover:bg-red-700 text-red-100 text-xs rounded transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                )}

                <div className="flex justify-between items-center">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        {mainView === 'SCANNER' && (
                            <><Activity className="w-5 h-5 text-green-400" /> Top Opportunities ({dataSource} • {timeframe.toUpperCase()})</>
                        )}
                        {mainView === 'PERFORMANCE' && (
                            <><CheckCircle2 className="w-5 h-5 text-purple-400" /> Forward Test Performance</>
                        )}
                        {mainView === 'EXCHANGE' && (
                            <><Wallet className="w-5 h-5 text-blue-400" /> Live Exchange Overview</>
                        )}
                    </h2>
                    <div className="flex items-center gap-3">
                        {isScanning && data.length > 0 && (
                            <span className="text-xs text-blue-400 animate-pulse flex items-center gap-1">
                                <RefreshCw className="w-3 h-3 animate-spin" /> Refreshing...
                            </span>
                        )}
                        <span className="text-xs text-gray-500">
                            Last Update: {lastUpdated ? lastUpdated.toLocaleTimeString() : '--:--'}
                        </span>
                    </div>
                </div>

                {mainView === 'SCANNER' && (
                    isScanning && data.length === 0 ? (
                        <div className="h-64 flex flex-col items-center justify-center border border-dashed border-gray-800 rounded-lg bg-gray-900/50">
                            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                            <span className="text-gray-500 text-sm">Fetching Top 200 Pairs from {dataSource}...</span>
                        </div>
                    ) : (
                        <ScannerTable
                            data={data}
                            activeExchange={settings.activeExchange}
                        />
                    )
                )}

                {mainView === 'PERFORMANCE' && (
                    <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <PerformancePanel history={tradeHistory} stats={perfStats} />
                    </div>
                )}

                {mainView === 'EXCHANGE' && (
                    <ExchangePanel dataSource={dataSource} />
                )}

            </main>

            {/* FOOTER DISCLAIMER */}
            <footer className="w-full max-w-7xl mx-auto mt-12 pt-8 border-t border-gray-800 text-center">
                <div className="flex flex-col items-center gap-2 opacity-60 hover:opacity-100 transition-opacity">
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                    <p className="text-[10px] text-gray-400 max-w-2xl leading-relaxed">
                        <strong>DISCLAIMER:</strong> This tool is for <strong>educational and informational purposes only</strong>.
                        Scores (0-100) are generated by an automated algorithm based on historical technical analysis (Trend, Structure, Volume) and do not guarantee future performance.
                        Cryptocurrency trading involves significant risk and can result in the loss of your entire capital.
                        <span className="text-orange-400"> Do not sell your house. Do not trade with money you cannot afford to lose.</span>
                    </p>
                </div>
            </footer>
        </div>
    );
}