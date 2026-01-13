import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Activity, Calendar, CheckCircle2, XCircle, Clock, ArrowUpRight, ArrowDownRight, X, Bell, BellOff } from 'lucide-react';

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
    alertEnabled?: boolean;
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

export const PerformancePanel: React.FC = () => {
    const [history, setHistory] = useState<Trade[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAllTrades, setShowAllTrades] = useState(false);

    const formatDuration = (start: string | null | undefined, end: string | null | undefined) => {
        if (!start || !end) return '-';
        const diff = new Date(end).getTime() - new Date(start).getTime();
        if (diff < 0) return '-';
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        return `${days}d ${hours}h ${minutes}m`;
    };

    const fetchData = async () => {
        try {
            const res = await fetch('/api/performance');
            const data = await res.json();
            // Sort by date descending
            const sortedHistory = data.history.sort((a: Trade, b: Trade) => 
                new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime()
            );
            setHistory(sortedHistory);
            setStats(data.stats);
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

    if (loading) return <div className="p-8 text-center text-gray-500">Loading performance data...</div>;

    const closedTrades = history.filter(t => t.status === 'CLOSED');

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            
            {/* All Trades Modal */}
            {showAllTrades && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-800/50 rounded-t-xl">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <CheckCircle2 className="w-5 h-5 text-purple-400" />
                                Closed Trades History
                            </h3>
                            <button 
                                onClick={() => setShowAllTrades(false)}
                                className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-700 rounded"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="overflow-auto flex-1 p-4">
                            <table className="w-full text-sm text-left">
                                <thead className="text-xs text-gray-500 uppercase bg-gray-800/50 border-b border-gray-700 sticky top-0 backdrop-blur-md">
                                    <tr>
                                        <th className="px-4 py-3">Created</th>
                                        <th className="px-4 py-3">Filled</th>
                                        <th className="px-4 py-3">Duration</th>
                                        <th className="px-4 py-3">Exchange</th>
                                        <th className="px-4 py-3">Pair</th>
                                        <th className="px-4 py-3">Side</th>
                                        <th className="px-4 py-3">Entry</th>
                                        <th className="px-4 py-3">Exit</th>
                                        <th className="px-4 py-3">Result</th>
                                        <th className="px-4 py-3 text-right">PnL</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800">
                                    {closedTrades.map((trade) => (
                                        <tr key={trade.id} className="hover:bg-gray-800/30 transition-colors">
                                            <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                                                {new Date(trade.entryDate).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                                                {trade.fillDate ? new Date(trade.fillDate).toLocaleString() : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-gray-300 font-mono text-xs">
                                                {formatDuration(trade.fillDate, trade.exitDate)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-300 text-xs font-bold">
                                                {trade.exchange || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 font-bold text-white">
                                                {trade.symbol}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`text-xs font-bold ${trade.side === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                                                    {trade.side}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-gray-300">
                                                ${trade.entryPrice}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-gray-300">
                                                ${trade.exitPrice || '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`text-xs px-2 py-1 rounded border font-bold ${
                                                    trade.result === 'WIN' 
                                                    ? 'bg-green-900/20 text-green-400 border-green-900' 
                                                    : trade.result === 'LOSS'
                                                    ? 'bg-red-900/20 text-red-400 border-red-900'
                                                    : 'bg-gray-700/20 text-gray-400 border-gray-700'
                                                }`}>
                                                    {trade.result}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono font-bold">
                                                <span className={trade.pnl && trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                                                    {trade.pnl ? (trade.pnl > 0 ? '+' : '') + trade.pnl.toFixed(2) + '%' : '-'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {closedTrades.length === 0 && (
                                        <tr>
                                            <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                                                No closed trades recorded yet.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                    <div className="text-gray-400 text-xs uppercase font-bold mb-1 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-400" /> Win Rate
                    </div>
                    <div className="text-2xl font-mono font-bold text-white">
                        {stats?.winRate || '0%'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        {stats?.wins} Wins / {stats?.losses} Losses
                    </div>
                </div>

                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                    <div className="text-gray-400 text-xs uppercase font-bold mb-1 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-green-400" /> Net PnL
                    </div>
                    <div className={`text-2xl font-mono font-bold ${parseFloat(stats?.netPnL || '0') >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {parseFloat(stats?.netPnL || '0') > 0 ? '+' : ''}{stats?.netPnL || '0%'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        Avg: {stats?.avgPnL || '0%'} / trade
                    </div>
                </div>

                <div 
                    onClick={() => setShowAllTrades(true)}
                    className="bg-gray-800 p-4 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-750 hover:border-purple-500/50 transition-all group"
                >
                    <div className="text-gray-400 text-xs uppercase font-bold mb-1 flex items-center gap-2 group-hover:text-purple-400">
                        <CheckCircle2 className="w-4 h-4 text-purple-400" /> Total Trades
                    </div>
                    <div className="text-2xl font-mono font-bold text-white">
                        {stats?.totalTrades || 0}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex justify-between">
                        <span>Closed Positions</span>
                        <span className="text-purple-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">View All →</span>
                    </div>
                </div>

                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                    <div className="text-gray-400 text-xs uppercase font-bold mb-1 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-yellow-400" /> Active
                    </div>
                    <div className="text-2xl font-mono font-bold text-white">
                        {history.filter(t => t.status === 'OPEN').length}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        Running Forward Tests
                    </div>
                </div>
            </div>

            {/* Trade History Table */}
            <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                    <h3 className="font-semibold text-gray-300 flex items-center gap-2">
                        <Calendar className="w-4 h-4" /> Trade History (Forward Test)
                    </h3>
                    <span className="text-xs text-gray-500">Auto-validated by Server</span>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-500 uppercase bg-gray-900/50 border-b border-gray-800">
                            <tr>
                                <th className="px-4 py-3">Date</th>
                                <th className="px-4 py-3">Exchange</th>
                                <th className="px-4 py-3">Pair</th>
                                <th className="px-4 py-3">Side</th>
                                <th className="px-4 py-3">Score</th>
                                <th className="px-4 py-3">Entry</th>
                                <th className="px-4 py-3">TP/SL</th>
                                <th className="px-4 py-3">Result</th>
                                <th className="px-4 py-3 text-right">PnL</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {history.map((trade) => (
                                <tr key={trade.id} className="hover:bg-gray-800/50 transition-colors">
                                    <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                                        {new Date(trade.entryDate).toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-gray-300 text-xs font-bold">
                                        {trade.exchange || 'N/A'}
                                    </td>
                                    <td className="px-4 py-3 font-bold text-white">
                                        {trade.symbol}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded ${trade.side === 'LONG' ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'}`}>
                                            {trade.side === 'LONG' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                            {trade.side}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="text-xs font-mono text-yellow-500">{trade.score}</span>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-gray-300">
                                        ${trade.entryPrice}
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                                        <div className="text-green-400/70">TP: {trade.tp}</div>
                                        <div className="text-red-400/70">SL: {trade.sl}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        {trade.status === 'OPEN' ? (
                                            trade.isFilled ? (
                                                <span className="text-xs bg-blue-900/20 text-blue-400 px-2 py-1 rounded border border-blue-900/50 animate-pulse">
                                                    RUNNING
                                                </span>
                                            ) : (
                                                <span className="text-xs bg-yellow-900/20 text-yellow-400 px-2 py-1 rounded border border-yellow-900/50">
                                                    WAITING ENTRY
                                                </span>
                                            )
                                        ) : (
                                            <span className={`text-xs px-2 py-1 rounded border font-bold ${
                                                trade.result === 'WIN' 
                                                ? 'bg-green-900/20 text-green-400 border-green-900' 
                                                : trade.result === 'LOSS'
                                                ? 'bg-red-900/20 text-red-400 border-red-900'
                                                : 'bg-gray-700/20 text-gray-400 border-gray-700'
                                            }`}>
                                                {trade.result}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono font-bold">
                                        {trade.pnl !== null ? (
                                            <span className={trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                                                {trade.pnl > 0 ? '+' : ''}{trade.pnl.toFixed(2)}%
                                            </span>
                                        ) : (
                                            <span className="text-gray-600">-</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {history.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500 italic">
                                        No trades recorded yet. Waiting for signals with Score ≥ 70...
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
