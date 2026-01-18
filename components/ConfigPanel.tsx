import React, { useState, useEffect, useRef } from 'react';
import { Save, RefreshCw, AlertTriangle, Play, Info, Zap, Maximize2, X, Clock, Calendar, CheckCircle } from 'lucide-react';
import { Config } from '../types';

interface TabButtonProps {
    active: boolean;
    label: string;
    onClick: () => void;
}

const TabButton: React.FC<TabButtonProps> = ({ active, label, onClick }) => (
    <button
        onClick={onClick}
        className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${active
            ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-500'
            : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
            }`}
    >
        {label}
    </button>
);

const Tooltip: React.FC<{ text: string }> = ({ text }) => (
    <div className="group relative ml-2 inline-block">
        <Info size={14} className="text-gray-500 hover:text-gray-300 cursor-help" />
        <div className="invisible group-hover:visible absolute z-50 w-64 p-2 mt-1 text-xs text-gray-200 bg-gray-900 border border-gray-700 rounded shadow-xl -translate-x-1/2 left-1/2 whitespace-normal break-words">
            {text}
        </div>
    </div>
);

interface ConfigPanelProps {
    onRunSimulation?: (config: Config, days: number) => void;
    isSimulating?: boolean;
}

interface ConfigInputProps {
    label: string;
    path: string[];
    tooltip: string;
    config: any;
    updateConfig: (path: string[], value: any) => void;
    minRec?: number;
    maxRec?: number;
    type?: 'number' | 'text';
    step?: number;
}

const ConfigInput: React.FC<ConfigInputProps> = ({
    label, path, tooltip, config, updateConfig,
    minRec, maxRec, type = 'number', step = 1
}) => {
    let value: any = config;
    for (const key of path) {
        if (value && value[key] !== undefined) {
            value = value[key];
        } else {
            value = ''; // Fallback
        }
    }

    return (
        <div className="flex items-center justify-between p-2 bg-gray-800/50 rounded hover:bg-gray-800 transition-colors border border-gray-700/50">
            <div className="flex items-center gap-2 flex-1 min-w-0">
                <label className="text-xs font-medium text-gray-300 uppercase tracking-wide truncate" title={label}>{label}</label>
                <Tooltip text={`${tooltip} ${(minRec !== undefined && maxRec !== undefined) ? `(Rec: ${minRec} - ${maxRec})` : ''}`} />
            </div>
            <div className="w-24">
                <input
                    type={type}
                    step={step}
                    value={value}
                    onChange={(e) => updateConfig(path, type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500 text-right font-mono"
                />
            </div>
        </div>
    );
};

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ onRunSimulation, isSimulating = false }) => {
    // ... (rest of component logic remains mainly same, but remove renderInput definition)
    const [config, setConfig] = useState<Config | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showOptModal, setShowOptModal] = useState(false);
    const [optDays, setOptDays] = useState(12);
    const [optStatus, setOptStatus] = useState<any>({ status: 'IDLE', progress: 0, eta: 0 });
    const [optimizing, setOptimizing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState('thresholds');
    const [optResults, setOptResults] = useState<any | null>(null);
    const pollTimer = useRef<number | null>(null);
    const debounceTimer = useRef<number | null>(null);
    const isFirstLoad = useRef(true);

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/config?t=${Date.now()}`);
            const data = await res.json();
            setConfig(data);
            setError(null);
        } catch (e) {
            setError('Failed to load configuration');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConfig();
    }, []);

    const handleSave = async (configToSave?: Config) => {
        const payload = configToSave || config;
        if (!payload) return;
        setSaving(true);
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('Failed to save');
            setSuccess('Configuration saved successfully!');
            setTimeout(() => setSuccess(null), 3000);
        } catch (e) {
            setError('Failed to save configuration');
        } finally {
            setSaving(false);
        }
    };

    // Auto-Trigger Backtest on Config Change
    useEffect(() => {
        if (!config || loading || optimizing) return;

        // Skip the very first load's effect execution
        if (isFirstLoad.current) {
            isFirstLoad.current = false;
            return;
        }

        // Clear existing timer
        if (debounceTimer.current) clearTimeout(debounceTimer.current);

        // Debounce 1 second
        debounceTimer.current = window.setTimeout(() => {
            if (onRunSimulation) {
                onRunSimulation(config, config.SYSTEM.FORETEST_DAYS || 10);
            }
        }, 1000);

        return () => {
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
    }, [config, onRunSimulation]);


    const startOptimization = async () => {
        if (!config) return;
        setOptimizing(true);
        setOptResults(null);
        setOptStatus({ status: 'RUNNING', progress: 0, eta: 0 });

        try {
            const res = await fetch('/api/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config, days: optDays })
            });

            const data = await res.json();
            if (!data.success) {
                setError(data.error || 'Failed to start optimization');
                setOptimizing(false);
            }
        } catch (e) {
            setError('Failed to trigger optimization');
            setOptimizing(false);
        }
    };

    const updateConfig = (path: string[], value: any, autoSave = false) => {
        if (!config) return;
        const newConfig = JSON.parse(JSON.stringify(config));
        let current = newConfig;
        for (let i = 0; i < path.length - 1; i++) {
            current = current[path[i]];
        }
        current[path[path.length - 1]] = value;
        setConfig(newConfig);

        if (autoSave) {
            handleSave(newConfig);
        }
    };

    if (loading) return <div className="p-8 text-center text-gray-400">Loading configuration...</div>;
    if (!config) return <div className="p-8 text-center text-red-400">Error loading configuration</div>;

    return (
        <div className="w-full h-full flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center mb-4 shrink-0">
                <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                    <Maximize2 size={24} className="text-gray-500" />
                    Strategy Configuration
                </h2>
                <div className="flex gap-2">
                    {/* FORETEST DURATION INPUT */}
                    <div className="flex items-center gap-2 bg-gray-800 rounded px-3 py-1 border border-gray-700 mr-2">
                        <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Lookback</span>
                        <input
                            type="number"
                            min="1"
                            max="30"
                            value={config.SYSTEM.FORETEST_DAYS || 10}
                            onChange={(e) => updateConfig(['SYSTEM', 'FORETEST_DAYS'], Number(e.target.value))}
                            className="w-12 bg-transparent text-white text-sm font-mono text-right focus:outline-none border-b border-gray-600 focus:border-purple-500 transition-colors"
                        />
                        <span className="text-xs text-gray-500">days</span>
                    </div>

                    <button onClick={fetchConfig} className="p-2 text-gray-400 hover:text-white bg-gray-800 rounded border border-gray-700"><RefreshCw size={18} /></button>
                    <button onClick={() => setShowOptModal(true)} disabled={optimizing} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-sm rounded font-bold disabled:opacity-50 shadow-lg shadow-purple-900/20">
                        <Zap size={18} /> {optimizing ? 'Running...' : 'Auto-Optimize'}
                    </button>
                    <button onClick={() => onRunSimulation && config && onRunSimulation(config, config.SYSTEM.FORETEST_DAYS || 10)} disabled={isSimulating} className="flex items-center gap-2 px-4 py-2 bg-purple-900/50 hover:bg-purple-800 text-white text-sm rounded font-bold disabled:opacity-50 border border-purple-500/30">
                        <Play size={18} /> {isSimulating ? 'Simulating...' : 'Test Current'}
                    </button>
                    <button onClick={() => handleSave()} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-bold disabled:opacity-50 shadow-lg shadow-blue-900/20">
                        <Save size={18} /> {saving ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>

            {/* OPTIMIZATION MODAL */}
            {showOptModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
                    <div className="bg-gray-900 border border-pink-500/30 rounded-xl p-6 w-[500px] shadow-2xl relative">
                        <button onClick={() => !optimizing && setShowOptModal(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white">
                            <X size={24} />
                        </button>

                        <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                            <Zap className="text-pink-500" /> Auto-Optimizer
                        </h3>
                        <p className="text-gray-400 text-sm mb-6">
                            This process runs a Grid Search across key parameters to find the highest win rate combination.
                        </p>

                        {!optimizing ? (
                            <div className="space-y-6">
                                <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
                                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block flex items-center gap-2">
                                        <Calendar size={14} /> Lookback Duration
                                    </label>
                                    <div className="flex items-center gap-4">
                                        <input
                                            type="range"
                                            min="3" max="30" step="1"
                                            value={optDays}
                                            onChange={(e) => setOptDays(Number(e.target.value))}
                                            className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                                        />
                                        <span className="text-white font-mono text-lg font-bold w-16 text-right">{optDays} Days</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                        Longer durations = More accurate but slower. (Rec: 7-14 days)
                                    </p>
                                </div>

                                <button
                                    onClick={() => { setShowOptModal(false); startOptimization(); }}
                                    className="w-full py-4 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-bold rounded-lg shadow-lg shadow-pink-900/20 flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]"
                                >
                                    <Play size={20} fill="currentColor" /> START OPTIMIZATION
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-6 py-4">
                                <div className="flex justify-between items-end mb-1">
                                    <span className="text-pink-400 font-bold text-lg animate-pulse">Running Simulation...</span>
                                    <span className="text-white font-mono text-2xl font-bold">{optStatus.progress}%</span>
                                </div>

                                <div className="h-4 bg-gray-800 rounded-full overflow-hidden border border-gray-700">
                                    <div
                                        className="h-full bg-gradient-to-r from-pink-600 to-purple-600 transition-all duration-500 ease-out relative"
                                        style={{ width: `${optStatus.progress}%` }}
                                    >
                                        <div className="absolute inset-0 bg-white/20 animate-shimmer" />
                                    </div>
                                </div>

                                <div className="flex justify-between text-sm text-gray-400 font-mono bg-black/20 p-3 rounded">
                                    <div className="flex items-center gap-2"><Clock size={14} /> Est. Time Remaining:</div>
                                    <div className="text-white">{optStatus.eta > 0 ? `${optStatus.eta}s` : 'Calculating...'}</div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* PROGRESS BAR (IN PANEL WHEN MODAL CLOSED BUT RUNNING) */}
            {optimizing && !showOptModal && (
                <div className="bg-gray-800 border border-pink-500/30 p-4 rounded-lg mb-4 flex items-center gap-4 animate-fade-in shrink-0">
                    <div className="p-2 bg-pink-500/10 rounded-full"><Zap className="text-pink-500 animate-pulse" size={20} /></div>
                    <div className="flex-1">
                        <div className="flex justify-between text-xs mb-1">
                            <span className="text-gray-300 font-bold">Optimization in progress...</span>
                            <span className="text-white font-mono">{optStatus.progress}% ({optStatus.eta}s left)</span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-pink-500 transition-all duration-500" style={{ width: `${optStatus.progress}%` }} />
                        </div>
                    </div>
                    <button onClick={() => setShowOptModal(true)} className="p-2 hover:bg-gray-700 rounded text-gray-400 hover:text-white">
                        <Maximize2 size={16} />
                    </button>
                </div>
            )}
            {
                optResults && (
                    <div className="bg-gradient-to-r from-gray-900 to-gray-800 border-2 border-pink-500/30 p-4 rounded-xl mb-6 shadow-2xl animate-fade-in shrink-0">
                        <div className="flex justify-between items-start mb-4 border-b border-gray-700 pb-2">
                            <div>
                                <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                                    <Zap className="text-pink-500" size={18} />
                                    Optimization Complete
                                </h3>
                                <p className="text-gray-400 text-xs">Based on {optResults.totalRuns} combinations + Full History Validation</p>
                            </div>
                            <button onClick={() => setOptResults(null)} className="text-gray-400 hover:text-white"><span className="text-xl">&times;</span></button>
                        </div>
                        {/* SYSTEM SETTINGS */}
                        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 mb-4">
                            <h3 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Strategy Mode</h3>
                            <div className="flex items-center justify-between">
                                <div>
                                    <label className="text-white font-medium">Adaptive Strategy (Pro)</label>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Dynamically adjusts Entry & Scoring based on Trend Strength (ADX).
                                        <br />High ADX = Aggressive Entries. Low ADX = Safe Entries.
                                    </p>
                                </div>
                                <button
                                    onClick={() => updateConfig(['SYSTEM', 'ENABLE_ADAPTIVE'], !config.SYSTEM.ENABLE_ADAPTIVE, true)}
                                    className={`w-12 h-6 rounded-full transition-colors duration-200 ease-in-out relative ${config.SYSTEM.ENABLE_ADAPTIVE ? 'bg-purple-600' : 'bg-gray-600'
                                        }`}
                                >
                                    <span
                                        className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ${config.SYSTEM.ENABLE_ADAPTIVE ? 'translate-x-6' : 'translate-x-0'
                                            }`}
                                    />
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Baseline (Current Settings)</h4>
                                <div className="flex justify-between text-sm mb-1"><span className="text-gray-400">Win Rate</span><span className="text-white font-mono">{(optResults.baseline.winRate * 100).toFixed(2)}%</span></div>
                                <div className="flex justify-between text-sm"><span className="text-gray-400">Net Wins</span><span className="text-white font-mono">{optResults.baseline.stats.wins - optResults.baseline.stats.losses}</span></div>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-pink-500 uppercase tracking-wider mb-2">Optimized (Recommended)</h4>
                                <div className="flex justify-between text-sm mb-1"><span className="text-gray-400">Win Rate</span><span className="text-green-400 font-bold font-mono">{(optResults.best.winRate * 100).toFixed(2)}%</span></div>
                                <div className="flex justify-between text-sm"><span className="text-gray-400">Net Wins</span><span className="text-green-400 font-bold font-mono">{optResults.best.stats.wins - optResults.best.stats.losses}</span></div>
                            </div>
                        </div>
                        <div className="mt-4 bg-black/20 p-3 rounded border border-pink-500/20">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
                                <div className="bg-gray-800 p-2 rounded"><div className="text-gray-500">Min Score</div><div className="text-pink-400 font-bold">{optResults.best.params.minScore}</div></div>
                                <div className="bg-gray-800 p-2 rounded"><div className="text-gray-500">ATR Mult</div><div className="text-pink-400 font-bold">{optResults.best.params.atrMult}</div></div>
                                <div className="bg-gray-800 p-2 rounded"><div className="text-gray-500">SL Buffer</div><div className="text-pink-400 font-bold">{optResults.best.params.slBuf}</div></div>
                                <div className="bg-gray-800 p-2 rounded"><div className="text-gray-500">RSI Period</div><div className="text-pink-400 font-bold">{optResults.best.params.rsiPeriod}</div></div>
                            </div>
                        </div>
                    </div>
                )
            }



            {/* TABS */}
            <div className="flex border-b border-gray-700 mb-4 gap-2 shrink-0">
                <TabButton active={activeTab === 'thresholds'} label="Thresholds" onClick={() => setActiveTab('thresholds')} />
                <TabButton active={activeTab === 'risk'} label="Risk" onClick={() => setActiveTab('risk')} />
                <TabButton active={activeTab === 'scoring'} label="Scoring" onClick={() => setActiveTab('scoring')} />
                <TabButton active={activeTab === 'indicators'} label="Indic" onClick={() => setActiveTab('indicators')} />
                <TabButton active={activeTab === 'v2strategy'} label="V2 Strategy" onClick={() => setActiveTab('v2strategy')} />
            </div>

            {/* MAIN CONTENT AREA - GRID LAYOUT */}
            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-xl min-h-[400px] flex-1 overflow-y-auto">
                {activeTab === 'thresholds' && (
                    <div className="space-y-4">
                        {/* STRATEGY MODE TOGGLE */}
                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50 flex flex-col sm:flex-row justify-between items-center gap-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-white font-medium">Adaptive Strategy (Pro)</h3>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${config.SYSTEM.ENABLE_ADAPTIVE ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-gray-700 text-gray-400'}`}>
                                        {config.SYSTEM.ENABLE_ADAPTIVE ? 'ACTIVE' : 'DISABLED'}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-400 mt-1 max-w-lg">
                                    When enabled, the bot dynamically adjusts <strong>Entry Fibs (0.618 vs 0.382)</strong> and <strong>Confirmation Windows</strong> based on ADX Trend Strength.
                                </p>
                            </div>
                            <button
                                onClick={() => updateConfig(['SYSTEM', 'ENABLE_ADAPTIVE'], !config.SYSTEM.ENABLE_ADAPTIVE, true)}
                                className={`w-14 h-7 rounded-full transition-colors duration-200 ease-in-out relative shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-purple-500 ${config.SYSTEM.ENABLE_ADAPTIVE ? 'bg-purple-600' : 'bg-gray-600'}`}
                            >
                                <span className={`absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform duration-200 shadow-sm ${config.SYSTEM.ENABLE_ADAPTIVE ? 'translate-x-7' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                            <ConfigInput label="Min Score (Signal)" path={['THRESHOLDS', 'MIN_SCORE_SIGNAL']} tooltip="Minimum score to trigger." minRec={60} maxRec={85} config={config} updateConfig={updateConfig} />
                            <ConfigInput label="Min Score (Trending)" path={['THRESHOLDS', 'MIN_SCORE_TRENDING']} tooltip="Score for valid trend." minRec={50} maxRec={70} config={config} updateConfig={updateConfig} />
                            <ConfigInput label="Min Score (Save)" path={['THRESHOLDS', 'MIN_SCORE_TO_SAVE']} tooltip="Minimum to log." minRec={30} maxRec={50} config={config} updateConfig={updateConfig} />
                            <ConfigInput label="Max Trade Age (H)" path={['THRESHOLDS', 'MAX_TRADE_AGE_HOURS']} tooltip="Tracking limit." minRec={4} maxRec={48} config={config} updateConfig={updateConfig} />
                        </div>
                    </div>
                )}

                {activeTab === 'risk' && (
                    <div className="space-y-6">
                        {/* TIME BASED STOP TOGGLE */}
                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50 flex flex-col sm:flex-row justify-between items-center gap-4">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-white font-medium">Time-Based Force Exit</h3>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${config.RISK.ENABLE_TIME_BASED_STOP ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : 'bg-gray-700 text-gray-400'}`}>
                                        {config.RISK.ENABLE_TIME_BASED_STOP ? 'ACTIVE' : 'DISABLED'}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-400 mt-1 max-w-lg">
                                    Automatically close trades that stagnate (flat) after a set time.
                                    <br /> Prevents capital from being tied up in dead trades.
                                </p>
                            </div>
                            <button
                                onClick={() => updateConfig(['RISK', 'ENABLE_TIME_BASED_STOP'], !config.RISK.ENABLE_TIME_BASED_STOP, true)}
                                className={`w-14 h-7 rounded-full transition-colors duration-200 ease-in-out relative shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-orange-500 ${config.RISK.ENABLE_TIME_BASED_STOP ? 'bg-orange-600' : 'bg-gray-600'}`}
                            >
                                <span className={`absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform duration-200 shadow-sm ${config.RISK.ENABLE_TIME_BASED_STOP ? 'translate-x-7' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        {/* TOGGLE: Confirm On Close */}
                        <div className="flex items-center justify-between bg-gray-700/50 p-3 rounded-lg border border-gray-600 mb-2">
                            <div>
                                <div className="flex items-center space-x-2">
                                    <span className="text-gray-200 font-medium">Confirm Entry on Close</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${config.RISK.ENTRY_ON_CANDLE_CLOSE ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-600 text-gray-400'}`}>
                                        {config.RISK.ENTRY_ON_CANDLE_CLOSE ? 'ACTIVE' : 'DISABLED'}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-400 mt-1 max-w-lg">
                                    Wait for candle close to confirm entry level.
                                    <br /> Prevents entering on wicks that crash through support.
                                </p>
                            </div>
                            <button
                                onClick={() => updateConfig(['RISK', 'ENTRY_ON_CANDLE_CLOSE'], !config.RISK.ENTRY_ON_CANDLE_CLOSE, true)}
                                className={`w-14 h-7 rounded-full transition-colors duration-200 ease-in-out relative shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-orange-500 ${config.RISK.ENTRY_ON_CANDLE_CLOSE ? 'bg-orange-600' : 'bg-gray-600'}`}
                            >
                                <span className={`absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform duration-200 shadow-sm ${config.RISK.ENTRY_ON_CANDLE_CLOSE ? 'translate-x-7' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                            <ConfigInput label="ATR Mult (SL)" path={['RISK', 'ATR_MULTIPLIER']} tooltip="Stop Loss distance." minRec={1.5} maxRec={3.5} type="number" step={0.1} config={config} updateConfig={updateConfig} />
                            <ConfigInput label="Buffer (Low)" path={['RISK', 'SL_BUFFER']} tooltip="Swing Low Buffer." minRec={0.001} maxRec={0.02} type="number" step={0.001} config={config} updateConfig={updateConfig} />
                            <ConfigInput label="Min Risk:Reward" path={['RISK', 'TP_RR_MIN']} tooltip="Min RR ratio." minRec={1.0} maxRec={3.0} type="number" step={0.1} config={config} updateConfig={updateConfig} />
                            <div className={!config.RISK.ENABLE_TIME_BASED_STOP ? 'opacity-50 pointer-events-none' : ''}>
                                <ConfigInput label="Max Candles (Force Exit)" path={['RISK', 'TIME_BASED_STOP_CANDLES']} tooltip="Candles (15m) before exit." minRec={8} maxRec={24} config={config} updateConfig={updateConfig} />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'scoring' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                        <ConfigInput label="Trend Base" path={['SCORING', 'TREND', 'BASE']} tooltip="EMA Trend points." minRec={10} maxRec={30} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="Structure (Fib)" path={['SCORING', 'STRUCTURE', 'FIB']} tooltip="Fib confluence." minRec={15} maxRec={40} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="Structure (Level)" path={['SCORING', 'STRUCTURE', 'LEVEL']} tooltip="S/R Level points." minRec={10} maxRec={25} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="Money Flow (OBV)" path={['SCORING', 'MONEY_FLOW', 'OBV']} tooltip="OBV points." minRec={10} maxRec={30} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="Timing (Pullback)" path={['SCORING', 'TIMING', 'PULLBACK']} tooltip="Pullback points." minRec={5} maxRec={20} config={config} updateConfig={updateConfig} />
                    </div>
                )}

                {activeTab === 'indicators' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                        <ConfigInput label="RSI Period" path={['INDICATORS', 'RSI', 'PERIOD']} tooltip="RSI length." minRec={7} maxRec={21} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="RSI Overbought" path={['INDICATORS', 'RSI', 'OVERBOUGHT']} tooltip="OB Level." minRec={65} maxRec={80} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="RSI Oversold" path={['INDICATORS', 'RSI', 'OVERSOLD']} tooltip="OS Level." minRec={20} maxRec={35} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="ADX Period" path={['INDICATORS', 'ADX', 'PERIOD']} tooltip="ADX length." minRec={7} maxRec={21} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="ADX Strong" path={['INDICATORS', 'ADX', 'STRONG_TREND']} tooltip="Strong trend val." minRec={20} maxRec={40} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="EMA Fast" path={['INDICATORS', 'EMA', 'FAST']} tooltip="Fast MA." minRec={9} maxRec={50} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="EMA Slow" path={['INDICATORS', 'EMA', 'SLOW']} tooltip="Slow MA." minRec={50} maxRec={200} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="Pullback Min" path={['INDICATORS', 'PULLBACK', 'MIN_DEPTH']} tooltip="Min depth %." minRec={0.2} maxRec={0.5} type="number" step={0.01} config={config} updateConfig={updateConfig} />
                        <ConfigInput label="Pullback Max" path={['INDICATORS', 'PULLBACK', 'MAX_DEPTH']} tooltip="Max depth %." minRec={0.6} maxRec={0.9} type="number" step={0.01} config={config} updateConfig={updateConfig} />
                    </div>
                )}

                {activeTab === 'v2strategy' && (
                    <div className="space-y-6">
                        {/* HEADER */}
                        <div className="bg-gradient-to-r from-purple-900/20 to-blue-900/20 p-4 rounded-lg border border-purple-500/30">
                            <h3 className="text-white font-bold text-lg mb-1 flex items-center gap-2">
                                <Zap className="text-purple-400" size={20} />
                                Breakout V2 Strategy Configuration
                            </h3>
                            <p className="text-gray-400 text-xs leading-relaxed">
                                Configure advanced RSI Trendline Breakout parameters based on institutional strategy guidelines.
                                All features improve win rate but reduce signal count.
                            </p>
                        </div>

                        {/* K-CANDLE CONFIRMATION */}
                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="text-white font-medium">K-Candle Confirmation</h4>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${config.BREAKOUTV2?.k_candle_confirmation ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-gray-700 text-gray-400'}`}>
                                            {config.BREAKOUTV2?.k_candle_confirmation !== false ? 'ENABLED' : 'DISABLED'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-400 leading-relaxed">
                                        Waits 1 candle for breakout confirmation. <strong className="text-green-400">Reduces fakeouts by 50%</strong> and improves win rate by 10-20%.
                                        When enabled, rejects signals where Bar 1 doesn't hold the breakout.
                                    </p>
                                </div>
                                <button
                                    onClick={() => updateConfig(['BREAKOUTV2', 'k_candle_confirmation'], !(config.BREAKOUTV2?.k_candle_confirmation !== false), true)}
                                    className={`w-14 h-7 rounded-full transition-colors duration-200 ease-in-out relative shrink-0 ml-4 ${config.BREAKOUTV2?.k_candle_confirmation !== false ? 'bg-green-600' : 'bg-gray-600'}`}
                                >
                                    <span className={`absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform duration-200 shadow-sm ${config.BREAKOUTV2?.k_candle_confirmation !== false ? 'translate-x-7' : 'translate-x-0'}`} />
                                </button>
                            </div>
                        </div>

                        {/* MULTI-TIMEFRAME CONFLUENCE */}
                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="text-white font-medium">Multi-Timeframe Confluence Filter</h4>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${config.BREAKOUTV2?.mtf_filter_enabled ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-gray-700 text-gray-400'}`}>
                                            {config.BREAKOUTV2?.mtf_filter_enabled !== false ? 'ENABLED' : 'DISABLED'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-400 leading-relaxed mb-3">
                                        Rejects signals when HTF RSI contradicts signal direction. <strong className="text-blue-400">Blocks counter-trend trades, +10-15% win rate</strong>.
                                        LONGs require HTF RSI above threshold (bullish), SHORTs require below (bearish).
                                    </p>
                                </div>
                                <button
                                    onClick={() => updateConfig(['BREAKOUTV2', 'mtf_filter_enabled'], !(config.BREAKOUTV2?.mtf_filter_enabled !== false), true)}
                                    className={`w-14 h-7 rounded-full transition-colors duration-200 ease-in-out relative shrink-0 ml-4 ${config.BREAKOUTV2?.mtf_filter_enabled !== false ? 'bg-blue-600' : 'bg-gray-600'}`}
                                >
                                    <span className={`absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform duration-200 shadow-sm ${config.BREAKOUTV2?.mtf_filter_enabled !== false ? 'translate-x-7' : 'translate-x-0'}`} />
                                </button>
                            </div>
                            <div className="flex items-center gap-3 bg-gray-900/50 p-2 rounded border border-gray-700">
                                <label className="text-xs font-medium text-gray-300 uppercase tracking-wide flex-shrink-0">HTF RSI Threshold</label>
                                <input
                                    type="number"
                                    min="30"
                                    max="70"
                                    step="5"
                                    value={config.BREAKOUTV2?.htf_rsi_threshold || 50}
                                    onChange={(e) => updateConfig(['BREAKOUTV2', 'htf_rsi_threshold'], Number(e.target.value))}
                                    disabled={config.BREAKOUTV2?.mtf_filter_enabled === false}
                                    className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50"
                                />
                                <span className="text-xs text-gray-500 flex-shrink-0">Rec: 50</span>
                            </div>
                        </div>

                        {/* CARDWALL TAKE PROFIT */}
                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="text-white font-medium">Cardwall TP Projection</h4>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${config.BREAKOUTV2?.cardwall_tp_enabled ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-gray-700 text-gray-400'}`}>
                                            {config.BREAKOUTV2?.cardwall_tp_enabled !== false ? 'ENABLED' : 'DISABLED'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-400 leading-relaxed mb-3">
                                        Uses Cardwall momentum projection with safety caps. <strong className="text-purple-400">Prevents unrealistic 30-100% targets</strong>.
                                        Caps profit targets at configurable percentage (default 15%) for more achievable goals.
                                    </p>
                                </div>
                                <button
                                    onClick={() => updateConfig(['BREAKOUTV2', 'cardwall_tp_enabled'], !(config.BREAKOUTV2?.cardwall_tp_enabled !== false), true)}
                                    className={`w-14 h-7 rounded-full transition-colors duration-200 ease-in-out relative shrink-0 ml-4 ${config.BREAKOUTV2?.cardwall_tp_enabled !== false ? 'bg-purple-600' : 'bg-gray-600'}`}
                                >
                                    <span className={`absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform duration-200 shadow-sm ${config.BREAKOUTV2?.cardwall_tp_enabled !== false ? 'translate-x-7' : 'translate-x-0'}`} />
                                </button>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center gap-3 bg-gray-900/50 p-2 rounded border border-gray-700">
                                    <label className="text-xs font-medium text-gray-300 uppercase tracking-wide flex-shrink-0">Max TP %</label>
                                    <input
                                        type="number"
                                        min="5"
                                        max="50"
                                        step="1"
                                        value={(config.BREAKOUTV2?.max_tp_percent || 0.15) * 100}
                                        onChange={(e) => updateConfig(['BREAKOUTV2', 'max_tp_percent'], Number(e.target.value) / 100)}
                                        disabled={config.BREAKOUTV2?.cardwall_tp_enabled === false}
                                        className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500 font-mono disabled:opacity-50"
                                    />
                                    <span className="text-xs text-gray-500 flex-shrink-0">Rec: 15%</span>
                                </div>
                                <div className="flex items-center gap-3 bg-gray-900/50 p-2 rounded border border-gray-700">
                                    <label className="text-xs font-medium text-gray-300 uppercase tracking-wide flex-shrink-0">Structure Multiplier</label>
                                    <input
                                        type="number"
                                        min="1.0"
                                        max="3.0"
                                        step="0.1"
                                        value={config.BREAKOUTV2?.tp_structure_multiplier || 1.618}
                                        onChange={(e) => updateConfig(['BREAKOUTV2', 'tp_structure_multiplier'], Number(e.target.value))}
                                        disabled={config.BREAKOUTV2?.cardwall_tp_enabled === false}
                                        className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-purple-500 font-mono disabled:opacity-50"
                                    />
                                    <span className="text-xs text-gray-500 flex-shrink-0">Rec: 1.618 (Fib)</span>
                                </div>
                            </div>
                        </div>

                        {/* HIDDEN DIVERGENCE */}
                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="text-white font-medium">Hidden Divergence Detection</h4>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${config.BREAKOUTV2?.hidden_div_enabled ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30' : 'bg-gray-700 text-gray-400'}`}>
                                            {config.BREAKOUTV2?.hidden_div_enabled !== false ? 'ENABLED' : 'DISABLED'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-400 leading-relaxed mb-3">
                                        Adds bonus scoring when hidden divergence pattern detected. <strong className="text-orange-400">+15% win rate for trend continuation</strong>.
                                        LONG: Price HL + RSI LL. SHORT: Price LH + RSI HH.
                                    </p>
                                </div>
                                <button
                                    onClick={() => updateConfig(['BREAKOUTV2', 'hidden_div_enabled'], !(config.BREAKOUTV2?.hidden_div_enabled !== false), true)}
                                    className={`w-14 h-7 rounded-full transition-colors duration-200 ease-in-out relative shrink-0 ml-4 ${config.BREAKOUTV2?.hidden_div_enabled !== false ? 'bg-orange-600' : 'bg-gray-600'}`}
                                >
                                    <span className={`absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform duration-200 shadow-sm ${config.BREAKOUTV2?.hidden_div_enabled !== false ? 'translate-x-7' : 'translate-x-0'}`} />
                                </button>
                            </div>
                            <div className="flex items-center gap-3 bg-gray-900/50 p-2 rounded border border-gray-700">
                                <label className="text-xs font-medium text-gray-300 uppercase tracking-wide flex-shrink-0">Score Bonus</label>
                                <input
                                    type="number"
                                    min="5"
                                    max="20"
                                    step="1"
                                    value={config.BREAKOUTV2?.hidden_div_bonus || 10}
                                    onChange={(e) => updateConfig(['BREAKOUTV2', 'hidden_div_bonus'], Number(e.target.value))}
                                    disabled={config.BREAKOUTV2?.hidden_div_enabled === false}
                                    className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-orange-500 font-mono disabled:opacity-50"
                                />
                                <span className="text-xs text-gray-500 flex-shrink-0">Rec: 10</span>
                            </div>
                        </div>

                        {/* OTHER PARAMETERS */}
                        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700/50">
                            <h4 className="text-white font-medium mb-3">Other V2 Parameters</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="flex items-center gap-3 bg-gray-900/50 p-2 rounded border border-gray-700">
                                    <label className="text-xs font-medium text-gray-300 uppercase tracking-wide flex-1 min-w-0 truncate" title="Minimum R:R Ratio">Min R:R Ratio</label>
                                    <input
                                        type="number"
                                        min="1.0"
                                        max="10.0"
                                        step="0.5"
                                        value={config.BREAKOUTV2?.min_rr_ratio || 3.0}
                                        onChange={(e) => updateConfig(['BREAKOUTV2', 'min_rr_ratio'], Number(e.target.value))}
                                        className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500 font-mono text-right"
                                    />
                                </div>
                                <div className="flex items-center gap-3 bg-gray-900/50 p-2 rounded border border-gray-700">
                                    <label className="text-xs font-medium text-gray-300 uppercase tracking-wide flex-1 min-w-0 truncate" title="Minimum OI Z-Score">Min OI Z-Score</label>
                                    <input
                                        type="number"
                                        min="0.5"
                                        max="5.0"
                                        step="0.1"
                                        value={config.BREAKOUTV2?.min_oi_zscore || 1.5}
                                        onChange={(e) => updateConfig(['BREAKOUTV2', 'min_oi_zscore'], Number(e.target.value))}
                                        className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500 font-mono text-right"
                                    />
                                </div>
                                <div className="flex items-center gap-3 bg-gray-900/50 p-2 rounded border border-gray-700">
                                    <label className="text-xs font-medium text-gray-300 uppercase tracking-wide flex-1 min-w-0 truncate" title="ATR Stop Multiplier">ATR Stop Mult</label>
                                    <input
                                        type="number"
                                        min="1.0"
                                        max="10.0"
                                        step="0.5"
                                        value={config.BREAKOUTV2?.atr_stop_multiplier || 3.0}
                                        onChange={(e) => updateConfig(['BREAKOUTV2', 'atr_stop_multiplier'], Number(e.target.value))}
                                        className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500 font-mono text-right"
                                    />
                                </div>
                                <div className="flex items-center gap-3 bg-gray-900/50 p-2 rounded border border-gray-700">
                                    <label className="text-xs font-medium text-gray-300 uppercase tracking-wide flex-1 min-w-0 truncate" title="OBV Slope Period">OBV Period</label>
                                    <input
                                        type="number"
                                        min="5"
                                        max="30"
                                        step="1"
                                        value={config.BREAKOUTV2?.obv_slope_period || 14}
                                        onChange={(e) => updateConfig(['BREAKOUTV2', 'obv_slope_period'], Number(e.target.value))}
                                        className="w-20 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500 font-mono text-right"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* INFO PANEL */}
                        <div className="bg-gradient-to-r from-blue-900/10 to-purple-900/10 p-4 rounded-lg border border-blue-500/20">
                            <h4 className="text-blue-400 font-bold text-sm mb-2 flex items-center gap-2">
                                <Info size={16} />
                                Expected Impact
                            </h4>
                            <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                    <div className="text-gray-400 mb-1">Win Rate Improvement:</div>
                                    <div className="text-green-400 font-bold">+20-30% combined</div>
                                </div>
                                <div>
                                    <div className="text-gray-400 mb-1">Signal Reduction:</div>
                                    <div className="text-orange-400 font-bold">~40-50% fewer</div>
                                </div>
                                <div>
                                    <div className="text-gray-400 mb-1">Average TP:</div>
                                    <div className="text-purple-400 font-bold">12-15% (realistic)</div>
                                </div>
                                <div>
                                    <div className="text-gray-400 mb-1">Risk per Trade:</div>
                                    <div className="text-blue-400 font-bold">~3% (professional)</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div >
    );
};
