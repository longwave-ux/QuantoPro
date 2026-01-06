import React, { useState, useEffect } from 'react';
import { Save, RefreshCw, AlertTriangle } from 'lucide-react';
import { Config } from '../types';

export const ConfigPanel: React.FC = () => {
    const [config, setConfig] = useState<Config | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/config');
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

    const renderInput = (label: string, path: string[], type: 'number' | 'text' = 'number', step = 1) => {
        let value: any = config;
        for (const key of path) value = value[key];

        return (
            <div className="mb-4">
                <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wider">{label}</label>
                <input
                    type={type}
                    step={step}
                    value={value}
                    onChange={(e) => updateConfig(path, type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-white">Strategy Configuration</h2>
                <div className="flex gap-2">
                    <button
                        onClick={fetchConfig}
                        className="p-2 text-gray-400 hover:text-white bg-gray-800 rounded hover:bg-gray-700"
                        title="Refresh"
                    >
                        <RefreshCw size={18} />
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium disabled:opacity-50"
                    >
                        <Save size={18} />
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded mb-4 flex items-center gap-2">
                    <AlertTriangle size={18} />
                    {error}
                </div>
            )}

            {success && (
                <div className="bg-green-500/10 border border-green-500/50 text-green-400 p-4 rounded mb-4">
                    {success}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* THRESHOLDS */}
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-blue-400 mb-4 border-b border-gray-800 pb-2">Thresholds</h3>
                    <div className="grid grid-cols-2 gap-4">
                        {renderInput('Min Score (Signal)', ['THRESHOLDS', 'MIN_SCORE_SIGNAL'])}
                        {renderInput('Min Score (Trending)', ['THRESHOLDS', 'MIN_SCORE_TRENDING'])}
                        {renderInput('Min Score (Save)', ['THRESHOLDS', 'MIN_SCORE_TO_SAVE'])}
                        {renderInput('Max Trade Age (Hours)', ['THRESHOLDS', 'MAX_TRADE_AGE_HOURS'])}
                    </div>
                </div>

                {/* SCORING WEIGHTS */}
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-800">
                    <h3 className="text-lg font-semibold text-purple-400 mb-4 border-b border-gray-800 pb-2">Scoring Weights</h3>
                    <div className="grid grid-cols-2 gap-4">
                        {renderInput('Trend Base', ['SCORING', 'TREND', 'BASE'])}
                        {renderInput('Structure (Fib)', ['SCORING', 'STRUCTURE', 'FIB'])}
                        {renderInput('Money Flow (OBV)', ['SCORING', 'MONEY_FLOW', 'OBV'])}
                        {renderInput('Timing (Pullback)', ['SCORING', 'TIMING', 'PULLBACK'])}
                    </div>
                </div>

                {/* INDICATORS */}
                <div className="bg-gray-900 p-4 rounded-lg border border-gray-800 md:col-span-2">
                    <h3 className="text-lg font-semibold text-green-400 mb-4 border-b border-gray-800 pb-2">Indicator Settings</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {renderInput('RSI Period', ['INDICATORS', 'RSI', 'PERIOD'])}
                        {renderInput('RSI Overbought', ['INDICATORS', 'RSI', 'OVERBOUGHT'])}
                        {renderInput('RSI Oversold', ['INDICATORS', 'RSI', 'OVERSOLD'])}
                        {renderInput('ADX Period', ['INDICATORS', 'ADX', 'PERIOD'])}
                        {renderInput('ADX Strong Trend', ['INDICATORS', 'ADX', 'STRONG_TREND'])}
                        {renderInput('EMA Fast', ['INDICATORS', 'EMA', 'FAST'])}
                        {renderInput('EMA Slow', ['INDICATORS', 'EMA', 'SLOW'])}
                        {renderInput('Pullback Min Depth', ['INDICATORS', 'PULLBACK', 'MIN_DEPTH'], 'number', 0.01)}
                        {renderInput('Pullback Max Depth', ['INDICATORS', 'PULLBACK', 'MAX_DEPTH'], 'number', 0.01)}
                    </div>
                </div>
            </div>
        </div>
    );
};
