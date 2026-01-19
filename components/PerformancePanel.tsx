import React, { useEffect, useState, useMemo } from 'react';
import { StrategyPerformanceCard } from './StrategyPerformanceCard';
import { ScoreFilterSlider } from './ScoreFilterSlider';
import { TrendingUp, Activity, CheckCircle2, Clock } from 'lucide-react';

interface Trade {
    id: string;
    symbol: string;
    exchange?: string;
    entryDate: string;
    status: 'OPEN' | 'CLOSED';
    result: 'PENDING' | 'WIN' | 'LOSS' | 'EXPIRED' | 'INVALIDATED';
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    tp: number;
    sl: number;
    score: number;
    exitPrice?: number | null;
    exitDate: string | null;
    pnl: number | null;
    isFilled?: boolean;
    fillDate?: string | null;
}

interface Stats {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: string;
    avgPnL: string;
    netPnL: string;
}

interface StrategyData {
    stats: Stats;
    history: Trade[];
}

interface PerformanceData {
    strategies: Record<string, StrategyData>;
    overall: {
        stats: Stats;
        history: Trade[];
    };
}

const STRATEGY_COLORS: Record<string, 'blue' | 'purple' | 'emerald' | 'orange'> = {
    'Legacy': 'blue',
    'Breakout': 'purple',
    'BreakoutV2': 'emerald'
};

export const PerformancePanel: React.FC = () => {
    const [data, setData] = useState<PerformanceData | null>(null);
    const [activeTab, setActiveTab] = useState('all');
    const [loading, setLoading] = useState(true);
    const [scoreFilter, setScoreFilter] = useState(0); // Min score filter

    const fetchData = async () => {
        try {
            const res = await fetch('/api/performance');
            const perfData = await res.json();
            setData(perfData);
        } catch (error) {
            console.error("Failed to fetch performance data", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, []);

    // Filter function - applied to trades
    const filterTrades = (trades: Trade[]) => {
        return trades.filter(t => t.score >= scoreFilter);
    };

    // Calculate stats from filtered trades
    const calculateStats = (trades: Trade[]): Stats => {
        const closed = trades.filter(t => t.status === 'CLOSED');
        const validTrades = closed.filter(t => t.result === 'WIN' || t.result === 'LOSS');

        if (validTrades.length === 0) {
            return {
                totalTrades: closed.length,
                wins: 0,
                losses: 0,
                winRate: '0.0%',
                avgPnL: '0.00%',
                netPnL: '0.00%'
            };
        }

        const wins = validTrades.filter(t => t.result === 'WIN').length;
        const losses = validTrades.filter(t => t.result === 'LOSS').length;
        const pnlValues = validTrades.filter(t => t.pnl !== null).map(t => t.pnl!);
        const totalPnL = pnlValues.reduce((sum, val) => sum + val, 0);
        const avgPnL = pnlValues.length > 0 ? totalPnL / pnlValues.length : 0;

        return {
            totalTrades: closed.length,
            wins,
            losses,
            winRate: ((wins / validTrades.length) * 100).toFixed(1) + '%',
            avgPnL: avgPnL.toFixed(2) + '%',
            netPnL: totalPnL.toFixed(2) + '%'
        };
    };

    // Apply filter to all strategies using useMemo for performance
    // IMPORTANT: This MUST be called before any conditional returns to maintain hook order
    const filteredData = useMemo(() => {
        if (!data) return null;

        const filteredStrategies: Record<string, StrategyData> = {};

        for (const [name, stratData] of Object.entries(data.strategies)) {
            const filteredHistory = filterTrades(stratData.history);
            filteredStrategies[name] = {
                stats: calculateStats(filteredHistory),
                history: filteredHistory
            };
        }

        const allTrades = data.overall?.history || [];
        const filteredAllTrades = filterTrades(allTrades);

        return {
            strategies: filteredStrategies,
            overall: {
                stats: calculateStats(filteredAllTrades),
                history: filteredAllTrades
            },
            // Store original counts for UI display
            originalCounts: {
                overall: allTrades.length,
                strategies: Object.fromEntries(
                    Object.entries(data.strategies).map(([name, stratData]) => [
                        name,
                        stratData.history.length
                    ])
                )
            }
        };
    }, [data, scoreFilter]);

    // Early return AFTER all hooks
    if (loading) return <div className="p-8 text-center text-gray-500">Loading performance data...</div>;

    const strategies = filteredData?.strategies || {};
    const strategyNames = Object.keys(strategies);
    const isFiltered = scoreFilter > 0;

    return (
        <div className="space-y-6">
            {/* Score Filter Slider */}
            <ScoreFilterSlider
                value={scoreFilter}
                onChange={setScoreFilter}
                onReset={() => setScoreFilter(0)}
            />

            {/* Strategy Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-gray-800 pb-4">
                <button
                    onClick={() => setActiveTab('all')}
                    className={`px-4 py-2 rounded-t-lg font-semibold transition-all ${activeTab === 'all'
                        ? 'bg-gray-800 text-white border-b-2 border-blue-500'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
                        }`}
                >
                    All Strategies
                </button>
                {strategyNames.map((name) => {
                    const color = STRATEGY_COLORS[name] || 'orange';
                    const borderColor = {
                        blue: 'border-blue-500',
                        purple: 'border-purple-500',
                        emerald: 'border-emerald-500',
                        orange: 'border-orange-500'
                    }[color];

                    return (
                        <button
                            key={name}
                            onClick={() => setActiveTab(name)}
                            className={`px-4 py-2 rounded-t-lg font-semibold transition-all ${activeTab === name
                                ? `bg-gray-800 text-white border-b-2 ${borderColor}`
                                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
                                }`}
                        >
                            {name}
                            <span className="ml-2 text-xs opacity-70">
                                ({strategies[name]?.history?.length || 0})
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Content based on active tab */}
            {activeTab === 'all' ? (
                // Overall Stats View
                <div className="space-y-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                            <div className="text-gray-400 text-xs uppercase font-bold mb-1 flex items-center gap-2">
                                <Activity className="w-4 h-4 text-blue-400" /> Win Rate
                            </div>
                            <div className="text-2xl font-mono font-bold text-white">
                                {filteredData?.overall?.stats?.winRate || '0%'}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {filteredData?.overall?.stats?.wins || 0} Wins / {filteredData?.overall?.stats?.losses || 0} Losses
                            </div>
                        </div>

                        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                            <div className="text-gray-400 text-xs uppercase font-bold mb-1 flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-green-400" /> Net PnL
                            </div>
                            <div className={`text-2xl font-mono font-bold ${parseFloat(filteredData?.overall?.stats?.netPnL || '0') >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {parseFloat(filteredData?.overall?.stats?.netPnL || '0') > 0 ? '+' : ''}{filteredData?.overall?.stats?.netPnL || '0%'}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                Avg: {filteredData?.overall?.stats?.avgPnL || '0%'} / trade
                            </div>
                        </div>

                        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                            <div className="text-gray-400 text-xs uppercase font-bold mb-1 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-purple-400" /> Total Trades
                            </div>
                            <div className="text-2xl font-mono font-bold text-white">
                                {filteredData?.overall?.stats?.totalTrades || 0}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                {isFiltered ? `Filtered from ${(filteredData as any)?.originalCounts?.overall || 0}` : 'All Strategies Combined'}
                            </div>
                        </div>

                        <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                            <div className="text-gray-400 text-xs uppercase font-bold mb-1 flex items-center gap-2">
                                <Clock className="w-4 h-4 text-yellow-400" /> Active
                            </div>
                            <div className="text-2xl font-mono font-bold text-white">
                                {filteredData?.overall?.history?.filter(t => t.status === 'OPEN').length || 0}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                                Running Tests
                            </div>
                        </div>
                    </div>

                    {/* Strategy Breakdown */}
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
                        <h3 className="text-lg font-bold text-white mb-4">Strategy Breakdown</h3>
                        <div className="grid md:grid-cols-3 gap-4">
                            {strategyNames.map((name) => {
                                const color = STRATEGY_COLORS[name] || 'orange';
                                const stratData = strategies[name];
                                return (
                                    <div
                                        key={name}
                                        onClick={() => setActiveTab(name)}
                                        className={`p-4 rounded-lg border cursor-pointer hover:scale-105 transition-transform ${color === 'blue' ? 'bg-blue-900/20 border-blue-700' :
                                            color === 'purple' ? 'bg-purple-900/20 border-purple-700' :
                                                color === 'emerald' ? 'bg-emerald-900/20 border-emerald-700' :
                                                    'bg-orange-900/20 border-orange-700'
                                            }`}
                                    >
                                        <h4 className="font-bold text-white mb-2">{name}</h4>
                                        <div className="text-sm text-gray-400 space-y-1">
                                            <div className="flex justify-between">
                                                <span>Win Rate:</span>
                                                <span className="font-mono text-white">{stratData.stats.winRate}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Net PnL:</span>
                                                <span className={`font-mono ${parseFloat(stratData.stats.netPnL) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                    {stratData.stats.netPnL}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Trades:</span>
                                                <span className="font-mono text-white">{stratData.stats.totalTrades}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : (
                // Individual Strategy View
                <StrategyPerformanceCard
                    strategyName={activeTab}
                    stats={strategies[activeTab]?.stats || {
                        totalTrades: 0,
                        wins: 0,
                        losses: 0,
                        winRate: '0%',
                        avgPnL: '0%',
                        netPnL: '0%'
                    }}
                    history={strategies[activeTab]?.history || []}
                    color={STRATEGY_COLORS[activeTab] || 'orange'}
                />
            )}
        </div>
    );
};
