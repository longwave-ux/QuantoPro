
import React, { useState, useEffect } from 'react';
import {
    DollarSign, Briefcase, Activity, RefreshCw, AlertTriangle,
    ArrowUpRight, ArrowDownRight, Tablet, Wallet, TrendingUp, Lock
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ExchangePanelProps {
    dataSource: string; // 'MEXC' | 'HYPERLIQUID' | 'KUCOIN'
}

interface Position {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    entryPrice: number;
    pnl: number;
    leverage: number;
}

interface AccountData {
    balance: number;
    totalEquity: number;
    unrealizedPnL: number;
    marginUsage: number;
    positions: Position[];
}

export const ExchangePanel: React.FC<ExchangePanelProps> = ({ dataSource }) => {
    const [data, setData] = useState<AccountData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [chartTimeframe, setChartTimeframe] = useState<'1W' | '1M' | 'ALL'>('1W');

    // Mock Chart Data (Since we don't have historical PnL from exchange yet)
    // In a real app, we'd fetch this from a DB or specific endpoint
    const mockChartData = Array.from({ length: 30 }, (_, i) => ({
        date: `Day ${i + 1}`,
        value: 1000 + (Math.random() * 200 - 100) + (i * 10)
    }));

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/exchange/account?source=${dataSource}`);
            const json = await res.json();

            if (!res.ok) throw new Error(json.error || 'Failed to fetch account data');

            setData(json);
            setLastUpdated(new Date());
        } catch (e: any) {
            console.error("Exchange fetch failed", e);
            setError(e.message || "Connection Failed");
        } finally {
            setLoading(false);
        }
    };

    // Poll every 5s logic could be added here, but user asked for "Refresh" button or similar behavior.
    // Let's do initial fetch + manual refresh for now to avoid rapid API limit hits on private keys.
    useEffect(() => {
        fetchData();
    }, [dataSource]);

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-96 bg-gray-900/50 rounded-xl border border-gray-800 p-8 text-center animate-in fade-in zoom-in">
                <div className="bg-red-900/20 p-4 rounded-full mb-4">
                    <AlertTriangle className="w-12 h-12 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Connection Issue</h3>
                <p className="text-gray-400 max-w-md mb-6">{error}</p>
                {(error?.includes('Key') || error?.includes('missing') || error?.includes('configured')) && (
                    <div className="bg-blue-900/20 border border-blue-800 p-4 rounded text-sm text-blue-300 mb-6">
                        <strong>Configuration Required:</strong><br />
                        Please go to <b>Settings</b> and ensure your API Keys for <b>{dataSource}</b> are correctly entered.
                    </div>
                )}
                <button
                    onClick={fetchData}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                    <RefreshCw className="w-4 h-4" /> Retry Connection
                </button>
            </div>
        );
    }

    if (!data && loading) {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mb-4" />
                <span className="text-gray-500">Connecting to {dataSource}...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header / Refresh */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${dataSource === 'HYPERLIQUID' ? 'bg-cyan-500/10' : 'bg-blue-500/10'}`}>
                        <Wallet className={`w-6 h-6 ${dataSource === 'HYPERLIQUID' ? 'text-cyan-400' : 'text-blue-400'}`} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white">{dataSource} Futures</h2>
                        <p className="text-xs text-gray-500 flex items-center gap-2">
                            Connected • Last Sync: {lastUpdated?.toLocaleTimeString()}
                        </p>
                    </div>
                </div>
                <button
                    onClick={fetchData}
                    className={`p-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-all ${loading ? 'animate-pulse' : ''}`}
                >
                    <RefreshCw className={`w-5 h-5 text-gray-300 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Balance */}
                <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl relative overflow-hidden group hover:border-blue-500/30 transition-colors">
                    <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                        <DollarSign className="w-12 h-12 text-white" />
                    </div>
                    <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Total Equity (USDT)</p>
                    <h3 className="text-2xl font-bold text-white tracking-tight">
                        ${(data?.totalEquity || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </h3>
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                        <Wallet className="w-3 h-3" /> Available: ${(data?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                </div>

                {/* Unrealized PnL */}
                <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl relative overflow-hidden group hover:border-purple-500/30 transition-colors">
                    <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Activity className="w-12 h-12 text-white" />
                    </div>
                    <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Unrealized PnL</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${data?.unrealizedPnL && data.unrealizedPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {data?.unrealizedPnL && data.unrealizedPnL > 0 ? '+' : ''}
                        ${(data?.unrealizedPnL || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </h3>
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                        Today's Delta: <span className="text-gray-300">--</span>
                    </div>
                </div>

                {/* Margin Usage */}
                <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl relative overflow-hidden group hover:border-orange-500/30 transition-colors">
                    <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Lock className="w-12 h-12 text-white" />
                    </div>
                    <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Margin Usage</p>
                    <h3 className={`text-2xl font-bold tracking-tight ${data?.marginUsage && data.marginUsage > 80 ? 'text-red-500' : 'text-white'}`}>
                        {(data?.marginUsage || 0).toFixed(2)}%
                    </h3>
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                        {(100 - (data?.marginUsage || 0)).toFixed(2)}% Free
                    </div>
                </div>

                {/* Open Positions Count */}
                <div className="bg-gray-900 border border-gray-800 p-4 rounded-xl relative overflow-hidden group hover:border-cyan-500/30 transition-colors">
                    <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Briefcase className="w-12 h-12 text-white" />
                    </div>
                    <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Active Positions</p>
                    <h3 className="text-2xl font-bold text-white tracking-tight">
                        {data?.positions.length}
                    </h3>
                    <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                        Across {dataSource}
                    </div>
                </div>
            </div>

            {/* Positions Table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-gray-800 bg-gray-950/50 flex justify-between items-center">
                    <h3 className="font-bold text-gray-200 flex items-center gap-2">
                        <ArrowUpRight className="w-4 h-4 text-green-400" /> Open Positions
                    </h3>
                </div>

                {data?.positions.length === 0 ? (
                    <div className="p-8 text-center text-gray-500 text-sm italic">
                        No active positions found.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-gray-400">
                            <thead className="bg-gray-950/30 text-xs uppercase font-bold text-gray-500">
                                <tr>
                                    <th className="px-6 py-3">Symbol</th>
                                    <th className="px-6 py-3">Side</th>
                                    <th className="px-6 py-3">Size</th>
                                    <th className="px-6 py-3">Entry Price</th>
                                    <th className="px-6 py-3">Leverage</th>
                                    <th className="px-6 py-3 text-right">PnL (USDT)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {data?.positions.map((pos, idx) => (
                                    <tr key={idx} className="hover:bg-gray-800/50 transition-colors">
                                        <td className="px-6 py-3 font-medium text-white">{pos.symbol}</td>
                                        <td className="px-6 py-3">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${pos.side === 'LONG' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                                {pos.side}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-gray-300">{pos.size}</td>
                                        <td className="px-6 py-3 text-gray-300">${pos.entryPrice}</td>
                                        <td className="px-6 py-3 text-orange-400 font-mono">x{pos.leverage}</td>
                                        <td className={`px-6 py-3 text-right font-bold ${pos.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {pos.pnl > 0 ? '+' : ''}{pos.pnl.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Mock PnL Chart */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden p-6">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="font-bold text-gray-200 flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-blue-400" /> PnL Growth (Estimated)
                        </h3>
                        <p className="text-xs text-gray-500">Account equity curve over time.</p>
                    </div>
                    <div className="flex bg-gray-950 p-1 rounded-lg border border-gray-800">
                        {['1W', '1M', 'ALL'].map(tf => (
                            <button
                                key={tf}
                                onClick={() => setChartTimeframe(tf as any)}
                                className={`px-3 py-1 text-[10px] font-bold rounded transition-colors ${chartTimeframe === tf ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}
                            >
                                {tf}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={mockChartData}>
                            <defs>
                                <linearGradient id="colorPnL" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                            <XAxis
                                dataKey="date"
                                stroke="#4b5563"
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                interval={6}
                            />
                            <YAxis
                                stroke="#4b5563"
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(val) => `$${val}`}
                                domain={['auto', 'auto']}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', borderRadius: '8px', fontSize: '12px' }}
                                itemStyle={{ color: '#e5e7eb' }}
                                labelStyle={{ color: '#9ca3af', marginBottom: '4px' }}
                                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Equity']}
                            />
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorPnL)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

        </div>
    );
}
