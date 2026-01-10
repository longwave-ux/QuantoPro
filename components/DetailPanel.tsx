import React, { useEffect, useState, useMemo } from 'react';
import { AnalysisResult, OHLCV } from '../types';
import { getChartData } from '../services/dataService';
import { analyzeWithGemini } from '../services/geminiService';
import { executeLimitOrder } from '../services/tradeService';
import { calculateOBV, calculateRSI, findKeyLevels, calculateVolumeProfile } from '../services/indicators';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, LineChart, Line, BarChart, Bar } from 'recharts';
import { Bot, Loader2, FileText, TrendingUp, Target, Shield, Crosshair, BarChart3, Anchor, Zap, AlertTriangle, Info, Wallet, ArrowRight, RefreshCw } from 'lucide-react';

interface DetailPanelProps {
    pair: AnalysisResult;
    activeExchange?: 'MEXC' | 'HYPERLIQUID';
}

const ScoreBar = ({ label, value, max, color, description }: { label: string, value: number, max: number, color: string, description: string }) => (
    <div className="space-y-1">
        <div className="flex justify-between items-center text-xs">
            <span className="text-gray-400 font-medium flex items-center gap-1" title={description}>
                {label} <Info className="w-3 h-3 text-gray-600" />
            </span>
            <span className="font-mono text-white">{value}/{max}</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
                className={`h-full ${color} transition-all duration-500`}
                style={{ width: `${(value / max) * 100}%` }}
            />
        </div>
    </div>
);

export const DetailPanel: React.FC<DetailPanelProps> = ({ pair, activeExchange = 'MEXC' }) => {
    const [chartData, setChartData] = useState<{ htf: OHLCV[], ltf: OHLCV[] } | null>(null);
    const [aiAnalysis, setAiAnalysis] = useState<string>('');
    const [loadingAi, setLoadingAi] = useState(false);

    // Trading State
    const [tradeAmount, setTradeAmount] = useState<string>('100');
    const [tradeStatus, setTradeStatus] = useState<'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'>('IDLE');
    const [tradeMessage, setTradeMessage] = useState<string>('');

    useEffect(() => {
        setChartData(null);
        setAiAnalysis('');
        setTradeStatus('IDLE');
        setTradeMessage('');
        // Use the specific intervals that generated this result AND the source
        const { htfInterval, ltfInterval } = pair.meta;
        getChartData(pair.symbol, htfInterval, ltfInterval, pair.source).then(setChartData);

        // Auto-trigger AI Analysis REMOVED to save quota
        // handleAskAI();
    }, [pair]);

    const handleAskAI = async () => {
        setLoadingAi(true);
        const analysis = await analyzeWithGemini(pair);
        setAiAnalysis(analysis);
        setLoadingAi(false);
    };

    const handlePlaceTrade = async () => {
        if (!pair.setup) return;
        const amount = parseFloat(tradeAmount);
        if (isNaN(amount) || amount <= 0) return;

        setTradeStatus('LOADING');
        const result = await executeLimitOrder(pair.symbol, pair.setup, amount, activeExchange);

        if (result.success) {
            setTradeStatus('SUCCESS');
            setTradeMessage(`Order ID: ${result.orderId}`);
        } else {
            setTradeStatus('ERROR');
            setTradeMessage(result.message || 'Failed to place order');
        }
    };

    const indicators = useMemo(() => {
        if (!chartData) return null;
        const obv = calculateOBV(chartData.ltf);
        const rsi = calculateRSI(chartData.ltf);
        const levels = findKeyLevels(chartData.ltf, 10);
        const volumeProfile = calculateVolumeProfile(chartData.ltf, 40); // 40 buckets for resolution

        // Calculate Y Domain to sync price chart and volume profile
        const allPrices = chartData.ltf.flatMap(d => [d.high, d.low]);
        const minPrice = Math.min(...allPrices);
        const maxPrice = Math.max(...allPrices);
        const padding = (maxPrice - minPrice) * 0.05; // 5% padding
        const yDomain = [minPrice - padding, maxPrice + padding];

        // Merge into data array for Recharts
        const mergedData = chartData.ltf.map((d, i) => ({
            ...d,
            obv: obv[i],
            rsi: rsi[i]
        }));

        return { data: mergedData, levels, volumeProfile, yDomain };
    }, [chartData]);

    const getSetupLabel = (type?: string) => {
        switch (type) {
            case 'FIB_STRUCTURE': return { label: 'Fibonacci + Structure', stable: true, icon: Anchor, desc: 'Static Level. Good for Limit Orders.' };
            case 'STRUCTURE_ONLY': return { label: 'Structural Support', stable: true, icon: Anchor, desc: 'Static Level. Good for Limit Orders.' };
            case 'ATR_REVERSION': return { label: 'ATR Reversion', stable: false, icon: Zap, desc: 'Dynamic Level. Moves with volatility.' };
            default: return { label: 'Unknown', stable: false, icon: Zap, desc: '' };
        }
    };

    const setupInfo = pair.setup ? getSetupLabel(pair.setup.confluenceType) : null;

    if (!chartData || !indicators) return <div className="p-8 flex justify-center text-gray-500"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="bg-gray-900/50 p-6 space-y-6">

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Main Price Chart + Volume Profile Container */}
                <div className="lg:col-span-2 space-y-4">
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 shadow-inner flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-blue-500" /> Price Action & Vol Profile ({pair.meta.ltfInterval})
                            </h3>
                            <div className="flex gap-2 text-xs">
                                {/* Setup Legend */}
                                {pair.setup && (
                                    <>
                                        <span className="flex items-center gap-1 text-green-400"><Target className="w-3 h-3" /> TP</span>
                                        <span className="flex items-center gap-1 text-blue-400"><Crosshair className="w-3 h-3" /> Entry</span>
                                        <span className="flex items-center gap-1 text-red-400"><Shield className="w-3 h-3" /> SL</span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Chart Area: Flex container for Price (Left) and VP (Right) */}
                        <div className="h-80 w-full flex gap-1">

                            {/* 1. Main Price Area Chart */}
                            <div className="flex-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={indicators.data}>
                                        <defs>
                                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                                        <XAxis dataKey="time" hide />
                                        {/* Sync Domain Here */}
                                        <YAxis domain={indicators.yDomain} hide />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f3f4f6' }}
                                            formatter={(value: number) => [value.toFixed(4), 'Price']}
                                        />
                                        <Area type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} fill="url(#colorPrice)" />

                                        {/* Trade Setup Lines */}
                                        {pair.setup && (
                                            <>
                                                <ReferenceLine y={pair.setup.tp} stroke="#4ade80" strokeDasharray="5 5" label={{ position: 'right', value: 'TP', fill: '#4ade80', fontSize: 10 }} />
                                                <ReferenceLine y={pair.setup.entry} stroke="#60a5fa" strokeWidth={1} label={{ position: 'right', value: 'ENTRY', fill: '#60a5fa', fontSize: 10 }} />
                                                <ReferenceLine y={pair.setup.sl} stroke="#f87171" strokeDasharray="5 5" label={{ position: 'right', value: 'SL', fill: '#f87171', fontSize: 10 }} />
                                            </>
                                        )}
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>

                            {/* 2. Volume Profile Bar Chart */}
                            <div className="w-24 border-l border-gray-800/50 pl-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart layout="vertical" data={indicators.volumeProfile} barCategoryGap={1}>
                                        <XAxis type="number" hide />
                                        {/* Sync Domain Here to align with Price Chart */}
                                        <YAxis type="number" dataKey="price" domain={indicators.yDomain} hide />
                                        <Tooltip
                                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                                            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f3f4f6', fontSize: '10px' }}
                                            formatter={(value: number) => [new Intl.NumberFormat('en', { notation: "compact" }).format(value), 'Vol']}
                                            labelFormatter={() => ''}
                                        />
                                        <Bar dataKey="volume" fill="#4b5563" opacity={0.6} radius={[0, 2, 2, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                        </div>
                    </div>

                    {/* AI Analysis Section */}
                    <div className="bg-gray-850 rounded-lg p-5 border border-gray-700 shadow-lg">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                                    <Bot className="text-purple-400 w-5 h-5" /> AI Trading Analyst
                                </h3>
                                <button
                                    onClick={handleAskAI}
                                    disabled={loadingAi}
                                    className="p-1.5 hover:bg-gray-700 rounded-md transition-colors text-gray-400 hover:text-white disabled:opacity-50"
                                    title="Regenerate Analysis"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${loadingAi ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                            {loadingAi && (
                                <div className="flex items-center gap-2 text-purple-400 text-xs animate-pulse">
                                    <Loader2 className="w-3 h-3 animate-spin" /> Analyzing market structure...
                                </div>
                            )}
                        </div>

                        {aiAnalysis ? (
                            <div className="text-sm text-gray-300 leading-relaxed font-mono animate-in fade-in duration-500 bg-gray-900/50 p-4 rounded border border-gray-800">
                                {aiAnalysis}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-3 bg-gray-900/30 p-6 rounded border border-gray-800/50 border-dashed">
                                {loadingAi ? (
                                    <span className="text-sm text-gray-500 italic">Waiting for Gemini LLM response...</span>
                                ) : (
                                    <button
                                        onClick={handleAskAI}
                                        className="px-4 py-2 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-500/30 text-purple-300 text-xs font-bold uppercase rounded flex items-center gap-2 transition-all"
                                    >
                                        <Bot className="w-4 h-4" /> Generate AI Analysis
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel: Trade Plan & Indicators */}
                <div className="space-y-4">

                    {/* Trade Plan Card */}
                    {pair.setup && setupInfo ? (
                        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 shadow-lg relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-blue-500/10 rounded-bl-full -mr-4 -mt-4"></div>
                            <h4 className="text-gray-300 font-semibold mb-3 flex items-center gap-2">
                                <Target className="w-4 h-4 text-blue-400" /> Execution Plan
                            </h4>

                            <div className="space-y-3">
                                <div className="flex justify-between items-end pb-2 border-b border-gray-700">
                                    <span className="text-xs text-gray-500 uppercase">Entry</span>
                                    <span className="font-mono text-lg text-blue-400 font-bold">${pair.setup.entry.toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between items-end pb-2 border-b border-gray-700">
                                    <span className="text-xs text-gray-500 uppercase">Take Profit</span>
                                    <span className="font-mono text-lg text-green-400 font-bold">${pair.setup.tp.toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between items-end pb-2 border-b border-gray-700">
                                    <span className="text-xs text-gray-500 uppercase">Stop Loss</span>
                                    <span className="font-mono text-lg text-red-400 font-bold">${pair.setup.sl.toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between items-center pt-1">
                                    <span className="text-xs text-gray-500 uppercase">Risk / Reward</span>
                                    <span className="px-2 py-1 bg-yellow-900/30 text-yellow-400 text-xs rounded border border-yellow-900 font-bold">
                                        1 : {pair.setup.rr}
                                    </span>
                                </div>

                                {/* TRADING INTERFACE */}
                                <div className="mt-4 pt-4 border-t border-gray-700 space-y-3">
                                    <div className="flex items-center gap-2 bg-gray-900/80 p-2 rounded border border-gray-700">
                                        <Wallet className="w-4 h-4 text-gray-400" />
                                        <span className="text-xs text-gray-400">$</span>
                                        <input
                                            type="number"
                                            value={tradeAmount}
                                            onChange={(e) => setTradeAmount(e.target.value)}
                                            className="bg-transparent w-full text-sm font-mono focus:outline-none text-white placeholder-gray-600"
                                            placeholder="Amount USD"
                                        />
                                    </div>

                                    {tradeStatus === 'IDLE' && (
                                        <button
                                            onClick={handlePlaceTrade}
                                            className={`w-full py-2 bg-gradient-to-r ${activeExchange === 'HYPERLIQUID' ? 'from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400' : 'from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400'} text-white text-xs font-bold uppercase rounded shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2 transition-all`}
                                        >
                                            Place Limit Order ({activeExchange}) <ArrowRight className="w-3 h-3" />
                                        </button>
                                    )}

                                    {tradeStatus === 'LOADING' && (
                                        <button disabled className="w-full py-2 bg-gray-700 text-gray-400 text-xs font-bold uppercase rounded flex items-center justify-center gap-2 cursor-not-allowed">
                                            <Loader2 className="w-3 h-3 animate-spin" /> Sending to {activeExchange}...
                                        </button>
                                    )}

                                    {tradeStatus === 'SUCCESS' && (
                                        <div className="w-full py-2 bg-green-900/20 border border-green-800 text-green-400 text-[10px] font-medium rounded flex flex-col items-center justify-center text-center p-2">
                                            <span className="flex items-center gap-1 font-bold"><Zap className="w-3 h-3" /> Trade Placed!</span>
                                            <span className="opacity-75">{tradeMessage}</span>
                                        </div>
                                    )}

                                    {tradeStatus === 'ERROR' && (
                                        <div className="w-full py-2 bg-red-900/20 border border-red-800 text-red-400 text-[10px] font-medium rounded flex flex-col items-center justify-center text-center p-2 break-all">
                                            <span className="flex items-center gap-1 font-bold"><AlertTriangle className="w-3 h-3" /> Error</span>
                                            <span className="opacity-75">{tradeMessage}</span>
                                        </div>
                                    )}

                                    <div className="text-[10px] text-gray-500 text-center">
                                        Est. Qty: {((parseFloat(tradeAmount) || 0) / pair.setup.entry).toFixed(4)} {pair.symbol.replace('USDT', '')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6 flex flex-col items-center justify-center text-center h-48">
                            <Shield className="w-8 h-8 text-gray-600 mb-2" />
                            <span className="text-sm text-gray-500">No clear setup identified<br />based on strict parameters.</span>
                        </div>
                    )}

                    {/* SCORE BREAKDOWN */}
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <BarChart3 className="w-3 h-3 text-purple-400" /> Score Composition
                        </h4>
                        <div className="space-y-3">
                            {pair.strategy_name === 'Breakout' ? (
                                <>
                                    <ScoreBar
                                        label="Geometry & Structure"
                                        value={pair.details.geometry_score || 0}
                                        max={40}
                                        color="bg-purple-500"
                                        description="Trendline Quality & Pivots (40pts)"
                                    />
                                    <ScoreBar
                                        label="Momentum"
                                        value={pair.details.momentum_score || 0}
                                        max={40}
                                        color="bg-blue-500"
                                        description="RSI Strength & MFI Filter (40pts)"
                                    />
                                    <ScoreBar
                                        label="Smart Money Cons."
                                        value={pair.details.structure_score || 0}
                                        max={20}
                                        color="bg-indigo-500"
                                        description="Coinalyze OI/CVD Confirmation (Bonus)"
                                    />
                                    <ScoreBar
                                        label="Divergence"
                                        value={pair.details.divergence_score || 0}
                                        max={30}
                                        color="bg-green-500"
                                        description="RSI Divergence Boost (30pts)"
                                    />
                                </>
                            ) : (
                                <>
                                    <ScoreBar
                                        label="Money Flow (OBV)"
                                        value={pair.details.moneyFlowScore}
                                        max={40}
                                        color="bg-purple-500"
                                        description="Volume Flow & Divergences (40pts)"
                                    />
                                    <ScoreBar
                                        label="Trend & Bias"
                                        value={pair.details.trendScore}
                                        max={25}
                                        color="bg-blue-500"
                                        description="EMA Alignment & ADX Strength (25pts)"
                                    />
                                    <ScoreBar
                                        label="Market Structure"
                                        value={pair.details.structureScore}
                                        max={25}
                                        color="bg-indigo-500"
                                        description="Support/Resistance & Fib Levels (25pts)"
                                    />
                                    <ScoreBar
                                        label="Timing"
                                        value={pair.details.timingScore}
                                        max={10}
                                        color="bg-green-500"
                                        description="Pullback Depth & Wick Rejections (10pts)"
                                    />
                                </>
                            )}
                        </div>
                    </div>

                    {/* RSI */}
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 h-32 flex flex-col">
                        <div className="text-xs font-semibold text-gray-400 mb-2">RSI (14)</div>
                        <div className="flex-1 min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={indicators.data}>
                                    <YAxis domain={[0, 100]} hide />
                                    <ReferenceLine y={70} stroke="#4b5563" strokeDasharray="3 3" />
                                    <ReferenceLine y={30} stroke="#4b5563" strokeDasharray="3 3" />
                                    <Line type="monotone" dataKey="rsi" stroke="#a855f7" dot={false} strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* OBV */}
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 h-32 flex flex-col">
                        <div className="text-xs font-semibold text-gray-400 mb-2">On-Balance Volume</div>
                        <div className="flex-1 min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={indicators.data}>
                                    <defs>
                                        <linearGradient id="colorObv" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <YAxis domain={['auto', 'auto']} hide />
                                    <Area type="monotone" dataKey="obv" stroke="#eab308" fill="url(#colorObv)" strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};