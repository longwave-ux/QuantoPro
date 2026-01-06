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

export const ConfigPanel: React.FC = () => {
    const [config, setConfig] = useState<Config | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    // Optimization State
    const [showOptModal, setShowOptModal] = useState(false);
    const [optDays, setOptDays] = useState(12);
    const [optStatus, setOptStatus] = useState<any>({ status: 'IDLE', progress: 0, eta: 0 });
    const [optimizing, setOptimizing] = useState(false); // Keeps track if job is running locally

    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState('thresholds');
    const [testResults, setTestResults] = useState<any | null>(null);
    const [optResults, setOptResults] = useState<any | null>(null);
    const pollTimer = useRef<number | null>(null);

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

    const handleSave = async () => {
        if (!config) return;
        setSaving(true);
        try {
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
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

    const handleBacktest = async () => {
        if (!config) return;
        setTesting(true);
        setTestResults(null);
        setOptResults(null);
        try {
            // Explicitly running on all data
            const res = await fetch('/api/backtest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            const data = await res.json();
            if (data.success && data.stats) {
                setTestResults(data.stats);
            } else {
                setError('Backtest failed');
            }
        } catch (e) {
            setError('Failed to run backtest');
        } finally {
            setTesting(false);
        }
    };

    useEffect(() => {
        // Poll status if running
        if (optimizing) {
            pollTimer.current = window.setInterval(async () => {
                try {
                    const res = await fetch('/api/optimize/status');
                    const status = await res.json();
                    setOptStatus(status);

                    if (status.status === 'COMPLETED') {
                        setOptResults(status.result);
                        setOptimizing(false);
                        setSuccess('Optimization Completed!');
                        if (pollTimer.current) clearInterval(pollTimer.current);
                    } else if (status.status === 'ERROR') {
                        setError(`Optimization Error: ${status.error}`);
                        setOptimizing(false);
                        if (pollTimer.current) clearInterval(pollTimer.current);
                    }
                } catch (e) {
                    console.error('Poll failed', e);
                }
            }, 1000);
        }
        return () => {
            if (pollTimer.current) clearInterval(pollTimer.current);
        };
    }, [optimizing]);

    const startOptimization = async () => {
        if (!config) return;
        setOptimizing(true);
        setOptResults(null);
        setTestResults(null);
        setOptStatus({ status: 'RUNNING', progress: 0, eta: 0 }); // Reset UI immediately

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

    const updateConfig = (path: string[], value: any) => {
        if (!config) return;
        const newConfig = JSON.parse(JSON.stringify(config));
        let current = newConfig;
        for (let i = 0; i < path.length - 1; i++) {
            current = current[path[i]];
        }
        current[path[path.length - 1]] = value;
        setConfig(newConfig);
    };

    if (loading) return <div className="p-8 text-center text-gray-400">Loading configuration...</div>;
    if (!config) return <div className="p-8 text-center text-red-400">Error loading configuration</div>;

    const renderInput = (label: string, path: string[], tooltip: string, minRec?: number, maxRec?: number, type: 'number' | 'text' = 'number', step = 1) => {
        let value: any = config;
        for (const key of path) value = value[key];

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

    return (
        <div className="w-full h-full flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center mb-4 shrink-0">
                <h2 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                    <Maximize2 size={24} className="text-gray-500" />
                    Strategy Configuration
                </h2>
                <div className="flex gap-2">
                    <button onClick={fetchConfig} className="p-2 text-gray-400 hover:text-white bg-gray-800 rounded border border-gray-700"><RefreshCw size={18} /></button>
                    <button onClick={() => setShowOptModal(true)} disabled={optimizing} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-sm rounded font-bold disabled:opacity-50 shadow-lg shadow-purple-900/20">
                        <Zap size={18} /> {optimizing ? 'Running...' : 'Auto-Optimize'}
                    </button>
                    <button onClick={handleBacktest} disabled={testing} className="flex items-center gap-2 px-4 py-2 bg-purple-900/50 hover:bg-purple-800 text-white text-sm rounded font-bold disabled:opacity-50 border border-purple-500/30">
                        <Play size={18} /> {testing ? 'Simulating...' : 'Test Current'}
                    </button>
                    <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded font-bold disabled:opacity-50 shadow-lg shadow-blue-900/20">
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

            {error && <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded mb-4 flex items-center gap-2 text-sm shrink-0"><AlertTriangle size={16} />{error}</div>}
            {success && <div className="bg-green-500/10 border border-green-500/50 text-green-400 p-3 rounded mb-4 text-sm font-medium text-center shrink-0">{success}</div>}

            {/* OPTIMIZATION RESULTS */}
            {optResults && (
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
                                onClick={() => updateConfig(['SYSTEM', 'ENABLE_ADAPTIVE'], !config.SYSTEM.ENABLE_ADAPTIVE)}
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
            )}

            {/* BACKTEST RESULTS */}
            {testResults && (
                <div className="bg-gray-900 border border-purple-500/30 p-4 rounded-xl mb-6 shrink-0">
                    <div className="flex justify-between items-start mb-4">
                        <h3 className="text-lg font-bold text-white">Backtest Results</h3>
                        <button onClick={() => setTestResults(null)} className="text-gray-400 hover:text-white text-xl">&times;</button>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-center">
                        <div className="bg-gray-800 p-2 rounded"><div className="text-gray-500 text-xs">Total</div><div className="text-xl font-bold text-white">{testResults.totalSignals}</div></div>
                        <div className="bg-gray-800 p-2 rounded"><div className="text-gray-500 text-xs">Win Rate</div><div className={`text-xl font-bold ${(testResults.wins / (testResults.wins + testResults.losses)) > 0.6 ? 'text-green-400' : 'text-yellow-400'}`}>{((testResults.wins / (testResults.wins + testResults.losses)) * 100).toFixed(1)}%</div></div>
                        <div className="bg-gray-800 p-2 rounded"><div className="text-gray-500 text-xs">Wins</div><div className="text-xl font-bold text-green-500">{testResults.wins}</div></div>
                        <div className="bg-gray-800 p-2 rounded"><div className="text-gray-500 text-xs">Losses</div><div className="text-xl font-bold text-red-500">{testResults.losses}</div></div>
                    </div>
                </div>
            )}

            {/* TABS */}
            <div className="flex border-b border-gray-700 mb-4 gap-2 shrink-0">
                <TabButton active={activeTab === 'thresholds'} label="Thresholds" onClick={() => setActiveTab('thresholds')} />
                <TabButton active={activeTab === 'risk'} label="Risk" onClick={() => setActiveTab('risk')} />
                <TabButton active={activeTab === 'scoring'} label="Scoring" onClick={() => setActiveTab('scoring')} />
                <TabButton active={activeTab === 'indicators'} label="Indicators" onClick={() => setActiveTab('indicators')} />
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
                                onClick={() => updateConfig(['SYSTEM', 'ENABLE_ADAPTIVE'], !config.SYSTEM.ENABLE_ADAPTIVE)}
                                className={`w-14 h-7 rounded-full transition-colors duration-200 ease-in-out relative shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-purple-500 ${config.SYSTEM.ENABLE_ADAPTIVE ? 'bg-purple-600' : 'bg-gray-600'}`}
                            >
                                <span className={`absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-transform duration-200 shadow-sm ${config.SYSTEM.ENABLE_ADAPTIVE ? 'translate-x-7' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                            {renderInput('Min Score (Signal)', ['THRESHOLDS', 'MIN_SCORE_SIGNAL'], 'Minimum score to trigger.', 60, 85)}
                            {renderInput('Min Score (Trending)', ['THRESHOLDS', 'MIN_SCORE_TRENDING'], 'Score for valid trend.', 50, 70)}
                            {renderInput('Min Score (Save)', ['THRESHOLDS', 'MIN_SCORE_TO_SAVE'], 'Minimum to log.', 30, 50)}
                            {renderInput('Max Trade Age (H)', ['THRESHOLDS', 'MAX_TRADE_AGE_HOURS'], 'Tracking limit.', 4, 48)}
                        </div>
                    </div>
                )}

                {activeTab === 'risk' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                        {renderInput('ATR Mult (SL)', ['RISK', 'ATR_MULTIPLIER'], 'Stop Loss distance.', 1.5, 3.5, 'number', 0.1)}
                        {renderInput('Buffer (Low)', ['RISK', 'SL_BUFFER'], 'Swing Low Buffer.', 0.001, 0.02, 'number', 0.001)}
                        {renderInput('Min Risk:Reward', ['RISK', 'TP_RR_MIN'], 'Min RR ratio.', 1.0, 3.0, 'number', 0.1)}
                    </div>
                )}

                {activeTab === 'scoring' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                        {renderInput('Trend Base', ['SCORING', 'TREND', 'BASE'], 'EMA Trend points.', 10, 30)}
                        {renderInput('Structure (Fib)', ['SCORING', 'STRUCTURE', 'FIB'], 'Fib confluence.', 15, 40)}
                        {renderInput('Structure (Level)', ['SCORING', 'STRUCTURE', 'LEVEL'], 'S/R Level points.', 10, 25)}
                        {renderInput('Money Flow (OBV)', ['SCORING', 'MONEY_FLOW', 'OBV'], 'OBV points.', 10, 30)}
                        {renderInput('Timing (Pullback)', ['SCORING', 'TIMING', 'PULLBACK'], 'Pullback points.', 5, 20)}
                    </div>
                )}

                {activeTab === 'indicators' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
                        {renderInput('RSI Period', ['INDICATORS', 'RSI', 'PERIOD'], 'RSI length.', 7, 21)}
                        {renderInput('RSI Overbought', ['INDICATORS', 'RSI', 'OVERBOUGHT'], 'OB Level.', 65, 80)}
                        {renderInput('RSI Oversold', ['INDICATORS', 'RSI', 'OVERSOLD'], 'OS Level.', 20, 35)}
                        {renderInput('ADX Period', ['INDICATORS', 'ADX', 'PERIOD'], 'ADX length.', 7, 21)}
                        {renderInput('ADX Strong', ['INDICATORS', 'ADX', 'STRONG_TREND'], 'Strong trend val.', 20, 40)}
                        {renderInput('EMA Fast', ['INDICATORS', 'EMA', 'FAST'], 'Fast MA.', 9, 50)}
                        {renderInput('EMA Slow', ['INDICATORS', 'EMA', 'SLOW'], 'Slow MA.', 50, 200)}
                        {renderInput('Pullback Min', ['INDICATORS', 'PULLBACK', 'MIN_DEPTH'], 'Min depth %.', 0.2, 0.5, 'number', 0.01)}
                        {renderInput('Pullback Max', ['INDICATORS', 'PULLBACK', 'MAX_DEPTH'], 'Max depth %.', 0.6, 0.9, 'number', 0.01)}
                    </div>
                )}
            </div>
        </div>
    );
};
