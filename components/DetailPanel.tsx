import React, { useEffect, useState, useMemo } from 'react';
import { AnalysisResult, OHLCV } from '../types';
import { getChartData } from '../services/dataService';
import { analyzeWithGemini } from '../services/geminiService';
import { executeLimitOrder } from '../services/tradeService';
import { calculateOBV, calculateRSI, findKeyLevels, calculateVolumeProfile } from '../services/indicators';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, LineChart, Line, BarChart, Bar } from 'recharts';
import { Bot, Loader2, FileText, TrendingUp, Target, Shield, Crosshair, BarChart3, Anchor, Zap, AlertTriangle, Info, Wallet, ArrowRight, RefreshCw } from 'lucide-react';
import { ObservabilityPanel } from './ObservabilityPanel';
import { cleanSymbol, getTradingViewSymbol } from '../utils/symbolUtils';

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
            <span className="font-mono text-white">{value.toFixed(1)}/{max}</span>
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
        const { htfInterval = '4h', ltfInterval = '15m' } = pair?.meta || {};
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

        // LTF Indicators
        const obv = calculateOBV(chartData.ltf);
        const ltfRsi = calculateRSI(chartData.ltf);
        const levels = findKeyLevels(chartData.ltf, 10);
        const volumeProfile = calculateVolumeProfile(chartData.ltf, 40);

        // HTF Indicators (For Breakout Strategy)
        const htfRsi = calculateRSI(chartData.htf); // 4H RSI

        // Merge LTF
        const ltfData = chartData.ltf.map((d, i) => ({
            ...d,
            obv: obv[i],
            rsi: ltfRsi[i],
            index: i
        }));

        // Merge HTF
        const htfData = chartData.htf.map((d, i) => ({
            ...d,
            rsi: htfRsi[i],
            index: i
        }));

        const allPrices = chartData.ltf.flatMap(d => [d.high, d.low]);
        const minPrice = Math.min(...allPrices);
        const maxPrice = Math.max(...allPrices);
        const padding = (maxPrice - minPrice) * 0.05;
        const yDomain = [minPrice - padding, maxPrice + padding];

        return { ltfData, htfData, levels, volumeProfile, yDomain };
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

    // Trendline Visualization Data with Time-based X-Axis
    const getTrendlineData = () => {
        if (!pair.setup?.trendline) return { segment: null, projection: null };

        if (!pair.setup?.trendline) return { segment: null, projection: null };

        const isBreakout = pair.strategy_name === 'Breakout' || pair.strategy_name === 'BreakoutV2';
        const sourceData = isBreakout ? indicators.htfData : indicators.ltfData;

        // Get timestamps instead of indices
        const startCandle = sourceData[pair.setup.trendline.start_idx];
        const endCandle = sourceData[pair.setup.trendline.end_idx];
        const currentCandle = sourceData[sourceData.length - 1];

        if (!startCandle || !endCandle) return { segment: null, projection: null };

        const segment = [
            { x: startCandle.time, y: pair.setup.trendline.start_rsi },
            { x: endCandle.time, y: pair.setup.trendline.end_rsi }
        ];

        const projection = [
            { x: endCandle.time, y: pair.setup.trendline.end_rsi },
            { x: currentCandle.time, y: pair.setup.trendline.current_projected_rsi }
        ];

        return { segment, projection };
    };

    const { segment: trendLineSegment, projection: trendLineProjection } = getTrendlineData();

    // Calculate Slice Start for Zoomed View
    const getZoomedData = () => {
        const isBreakout = pair.strategy_name === 'Breakout' || pair.strategy_name === 'BreakoutV2';
        const sourceData = isBreakout ? indicators.htfData : indicators.ltfData;

        let sliceStart = 0;
        if (pair.setup?.trendline?.start_idx) {
            sliceStart = Math.max(0, pair.setup.trendline.start_idx - 10);
        }

        return {
            slicedData: sourceData.slice(sliceStart),
            isZoomed: sliceStart > 0
        };
    };

    const { slicedData, isZoomed } = getZoomedData();

    // Observability RSI Trendlines
    const getObservabilityTrendlines = () => {
        if (!pair.observability?.rsi_visuals) return { resistance: null, support: null };

        const isBreakout = pair.strategy_name === 'Breakout' || pair.strategy_name === 'BreakoutV2';
        const sourceData = isBreakout ? indicators.htfData : indicators.ltfData;

        const result: any = {};

        // Resistance trendline
        if (pair.observability.rsi_visuals.resistance) {
            const res = pair.observability.rsi_visuals.resistance;
            const p1 = sourceData[res.pivot_1.index];
            const p2 = sourceData[res.pivot_2.index];
            const current = sourceData[sourceData.length - 1];

            if (p1 && p2 && current) {
                const currentY = res.slope * (sourceData.length - 1) + res.intercept;
                result.resistance = {
                    segment: [
                        { x: p1.time, y: res.pivot_1.value },
                        { x: p2.time, y: res.pivot_2.value }
                    ],
                    projection: [
                        { x: p2.time, y: res.pivot_2.value },
                        { x: current.time, y: Math.max(0, Math.min(100, currentY)) }
                    ]
                };
            }
        }

        // Support trendline
        if (pair.observability.rsi_visuals.support) {
            const sup = pair.observability.rsi_visuals.support;
            const p1 = sourceData[sup.pivot_1.index];
            const p2 = sourceData[sup.pivot_2.index];
            const current = sourceData[sourceData.length - 1];

            if (p1 && p2 && current) {
                const currentY = sup.slope * (sourceData.length - 1) + sup.intercept;
                result.support = {
                    segment: [
                        { x: p1.time, y: sup.pivot_1.value },
                        { x: p2.time, y: sup.pivot_2.value }
                    ],
                    projection: [
                        { x: p2.time, y: sup.pivot_2.value },
                        { x: current.time, y: Math.max(0, Math.min(100, currentY)) }
                    ]
                };
            }
        }

        return result;
    };

    const observabilityTrendlines = getObservabilityTrendlines();

    // Get cleaned symbol for display - FORCED CLEANING with inline fallback
    const displaySymbol = cleanSymbol(pair.symbol) || pair.symbol.replace(/USDTM?$/, '').replace(/-USDTM?$/, '');
    const tvSymbol = getTradingViewSymbol(pair.symbol);

    return (
        <div className="bg-gray-900/50 p-6 space-y-6">
            {/* Header with cleaned symbol - FORCED INLINE CLEANING */}
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-2xl font-bold text-white">
                    {displaySymbol || pair.symbol.replace(/USDTM?$/, '')}
                </h2>
                <span className="text-xs text-gray-500 bg-gray-800 px-3 py-1 rounded-full border border-gray-700">{pair.strategy_name}</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* LEFT COLUMN: Price Chart, AI, RSI (Main) */}
                <div className="lg:col-span-2 space-y-4">

                    {/* 1. PRICE CHART */}
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 shadow-inner flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                                <TrendingUp className="w-4 h-4 text-blue-500" /> Price Action ({pair?.meta?.ltfInterval || '15m'})
                            </h3>
                            <div className="flex gap-2 text-xs">
                                {pair.setup && (
                                    <>
                                        <span className="flex items-center gap-1 text-green-400"><Target className="w-3 h-3" /> TP</span>
                                        <span className="flex items-center gap-1 text-blue-400"><Crosshair className="w-3 h-3" /> Entry</span>
                                        <span className="flex items-center gap-1 text-red-400"><Shield className="w-3 h-3" /> SL</span>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="h-80 w-full flex gap-1">
                            <div className="flex-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={indicators.ltfData}>
                                        <defs>
                                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                                        <XAxis dataKey="index" hide />
                                        <YAxis domain={indicators.yDomain} hide />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f3f4f6' }}
                                            formatter={(value: number) => [value.toFixed(4), 'Price']}
                                            labelFormatter={(label) => ''}
                                        />
                                        <Area type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} fill="url(#colorPrice)" />

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
                            <div className="w-24 border-l border-gray-800/50 pl-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart layout="vertical" data={indicators.volumeProfile} barCategoryGap={1}>
                                        <XAxis type="number" hide />
                                        <YAxis type="number" dataKey="price" domain={indicators.yDomain} hide />
                                        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ backgroundColor: '#111827' }} />
                                        <Bar dataKey="volume" fill="#4b5563" opacity={0.6} radius={[0, 2, 2, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* 2. RSI CHART (LARGE) - Showing 4H for Breakout Strategy */}
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 h-64 flex flex-col relative">
                        <div className="flex justify-between items-center mb-2">
                            <div className="text-sm font-semibold text-gray-300 uppercase flex items-center gap-2">
                                <Zap className="w-4 h-4 text-purple-500" /> RSI Analysis ({(pair.strategy_name === 'Breakout' || pair.strategy_name === 'BreakoutV2') ? '4H' : '15m'})
                            </div>

                            {/* CONDITION LABEL FOR WATCH */}
                            {pair.strategy_name === 'Breakout' && pair.action === 'WATCH' && (
                                <span className="text-xs bg-yellow-500/10 text-yellow-400 px-2 py-1 rounded border border-yellow-500/30 flex items-center gap-1 font-bold animate-pulse">
                                    <AlertTriangle className="w-3 h-3" /> Condition: RSI Testing Resistance
                                    {pair.setup?.trendline && pair.setup.trendline.current_projected_rsi && (
                                        <span className="ml-1 opacity-75">
                                            (Diff: {(pair.ltf.rsi - pair.setup.trendline.current_projected_rsi).toFixed(2)})
                                        </span>
                                    )}
                                </span>
                            )}
                        </div>

                        <div className="flex-1 min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                {/* Use Sliced Data for Zoom effect */}
                                <LineChart data={slicedData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                                    <XAxis
                                        dataKey="time"
                                        tickFormatter={(time) => new Date(time).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        stroke="#4b5563"
                                        fontSize={10}
                                        minTickGap={30}
                                    />
                                    <YAxis domain={[0, 100]} ticks={[30, 50, 70]} stroke="#374151" fontSize={10} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f3f4f6' }}
                                        formatter={(value: number) => [value.toFixed(2), 'RSI']}
                                        labelFormatter={(label) => new Date(label).toLocaleString()}
                                    />
                                    <ReferenceLine y={70} stroke="#4b5563" strokeDasharray="3 3" />
                                    <ReferenceLine y={30} stroke="#4b5563" strokeDasharray="3 3" />
                                    <Line type="monotone" dataKey="rsi" stroke="#a855f7" dot={false} strokeWidth={2} isAnimationActive={false} />

                                    {/* Draw Trendline if Breakout */}
                                    {pair.strategy_name === 'Breakout' && trendLineSegment && (
                                        <>
                                            {/* Historic Segment */}
                                            <ReferenceLine segment={trendLineSegment} stroke="#eab308" strokeWidth={2} isFront />
                                            {/* Projection */}
                                            {trendLineProjection && (
                                                <ReferenceLine segment={trendLineProjection} stroke="#eab308" strokeDasharray="4 4" strokeWidth={2} isFront />
                                            )}
                                        </>
                                    )}

                                    {/* Observability RSI Trendlines - Resistance */}
                                    {observabilityTrendlines.resistance && (
                                        <>
                                            <ReferenceLine 
                                                segment={observabilityTrendlines.resistance.segment} 
                                                stroke="#ef4444" 
                                                strokeWidth={2} 
                                                isFront 
                                            />
                                            <ReferenceLine 
                                                segment={observabilityTrendlines.resistance.projection} 
                                                stroke="#ef4444" 
                                                strokeDasharray="4 4" 
                                                strokeWidth={2} 
                                                isFront 
                                            />
                                        </>
                                    )}

                                    {/* Observability RSI Trendlines - Support */}
                                    {observabilityTrendlines.support && (
                                        <>
                                            <ReferenceLine 
                                                segment={observabilityTrendlines.support.segment} 
                                                stroke="#22c55e" 
                                                strokeWidth={2} 
                                                isFront 
                                            />
                                            <ReferenceLine 
                                                segment={observabilityTrendlines.support.projection} 
                                                stroke="#22c55e" 
                                                strokeDasharray="4 4" 
                                                strokeWidth={2} 
                                                isFront 
                                            />
                                        </>
                                    )}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* AI Analysis */}
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
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${loadingAi ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        </div>
                        {aiAnalysis ? (
                            <div className="text-sm text-gray-300 leading-relaxed font-mono bg-gray-900/50 p-4 rounded border border-gray-800">
                                {aiAnalysis}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-3 bg-gray-900/30 p-6 rounded border border-gray-800/50 border-dashed">
                                <button onClick={handleAskAI} className="px-4 py-2 bg-purple-900/30 hover:bg-purple-900/50 border border-purple-500/30 text-purple-300 text-xs font-bold uppercase rounded flex items-center gap-2">
                                    <Bot className="w-4 h-4" /> Generate AI Analysis
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT COLUMN: Trade Plan, Scores, OBV */}
                <div className="space-y-4">

                    {/* Trade Plan (Existing Logic) */}
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
                                    <span className="text-xs text-gray-500 uppercase">TP</span>
                                    <span className="font-mono text-lg text-green-400 font-bold">${pair.setup.tp.toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between items-end pb-2 border-b border-gray-700">
                                    <span className="text-xs text-gray-500 uppercase">SL</span>
                                    <span className="font-mono text-lg text-red-400 font-bold">${pair.setup.sl.toFixed(4)}</span>
                                </div>
                                <div className="flex justify-between items-center pt-1">
                                    <span className="text-xs text-gray-500 uppercase">RR</span>
                                    <span className="px-2 py-1 bg-yellow-900/30 text-yellow-400 text-xs rounded border border-yellow-900 font-bold">1 : {pair.setup.rr}</span>
                                </div>
                                <div className="mt-4 pt-4 border-t border-gray-700 space-y-3">
                                    {/* ... keeping simplified trading interface ... */}
                                    <div className="flex items-center gap-2 bg-gray-900/80 p-2 rounded border border-gray-700">
                                        <Wallet className="w-4 h-4 text-gray-400" />
                                        <input type="number" value={tradeAmount} onChange={(e) => setTradeAmount(e.target.value)} className="bg-transparent w-full text-sm font-mono focus:outline-none text-white" />
                                    </div>
                                    <button onClick={handlePlaceTrade} className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase rounded">
                                        Place Order ({activeExchange})
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6 flex flex-col items-center justify-center text-center h-48">
                            <Shield className="w-8 h-8 text-gray-600 mb-2" />
                            <span className="text-sm text-gray-500">No Setup</span>
                        </div>
                    )}

                    {/* SCORE BREAKDOWN - ONLY SHOW FOR CLICKED STRATEGY */}
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-3 flex items-center gap-2 justify-between">
                            <span className="flex items-center gap-2"><BarChart3 className="w-3 h-3 text-purple-400" /> Score Composition</span>
                            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded border border-gray-700">{pair.strategy_name}</span>
                        </h4>
                        <div className="space-y-3">
                            {pair.strategy_name === 'Breakout' ? (
                                <>
                                    <ScoreBar
                                        label="Geometry"
                                        value={pair.details.score_breakdown?.geometry || 0}
                                        max={40}
                                        color="bg-purple-500"
                                        description="Trendline Force: (Price% × Duration) / Target Area"
                                    />
                                    <ScoreBar
                                        label="Momentum"
                                        value={pair.details.score_breakdown?.momentum || 0}
                                        max={30}
                                        color="bg-blue-500"
                                        description="RSI Divergence + Slope Decoupling"
                                    />
                                    <ScoreBar
                                        label="Sentiment"
                                        value={pair.details.score_breakdown?.sentiment || 0}
                                        max={10}
                                        color="bg-pink-500"
                                        description="Liquidation Ratio + Top Traders"
                                    />
                                    <ScoreBar
                                        label="Action Bonuses"
                                        value={pair.details.score_breakdown?.bonuses || 0}
                                        max={25}
                                        color="bg-green-500"
                                        description="Retest (+15), Squeeze (+10), Deep RSI (+5)"
                                    />
                                </>
                            ) : pair.strategy_name === 'BreakoutV2' ? (
                                <>
                                    <ScoreBar
                                        label="Trend (OI Z-Score)"
                                        value={pair.observability?.score_composition?.trend_score || 0}
                                        max={25}
                                        color="bg-blue-500"
                                        description="Institutional Flow Confirmation"
                                    />
                                    <ScoreBar
                                        label="Structure (OBV Slope)"
                                        value={pair.observability?.score_composition?.structure_score || 0}
                                        max={25}
                                        color="bg-purple-500"
                                        description="Money Flow Structure"
                                    />
                                    <ScoreBar
                                        label="Money Flow (RSI)"
                                        value={pair.observability?.score_composition?.money_flow_score || 0}
                                        max={25}
                                        color="bg-cyan-500"
                                        description="RSI Scaled (0-25)"
                                    />
                                    <ScoreBar
                                        label="Timing (Cardwell)"
                                        value={pair.observability?.score_composition?.timing_score || 0}
                                        max={25}
                                        color="bg-green-500"
                                        description="Cardwell Range Score"
                                    />
                                </>
                            ) : (
                                <>
                                    <ScoreBar
                                        label="Money Flow (OBV)"
                                        value={pair.details.moneyFlowScore || 0}
                                        max={40}
                                        color="bg-purple-500"
                                        description="Volume Flow & Divergences (40pts)"
                                    />
                                    <ScoreBar
                                        label="Trend & Bias"
                                        value={pair.details.trendScore || 0}
                                        max={25}
                                        color="bg-blue-500"
                                        description="EMA Alignment & ADX Strength (25pts)"
                                    />
                                    <ScoreBar
                                        label="Market Structure"
                                        value={pair.details.structureScore || 0}
                                        max={25}
                                        color="bg-indigo-500"
                                        description="Support/Resistance & Fib Levels (25pts)"
                                    />
                                    <ScoreBar
                                        label="Timing"
                                        value={pair.details.timingScore || 0}
                                        max={10}
                                        color="bg-green-500"
                                        description="Pullback Depth & Wick Rejections (10pts)"
                                    />
                                </>
                            )}
                        </div>
                    </div>

                    {/* OBV (Moved here as RSI is now main) */}
                    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 h-32 flex flex-col">
                        <div className="text-xs font-semibold text-gray-400 mb-2">On-Balance Volume</div>
                        <div className="flex-1 min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={indicators.ltfData}>
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

                    {/* Observability Panel - Enhanced Visual Data Enrichment */}
                    <div className="col-span-2">
                        <ObservabilityPanel signal={pair} />
                    </div>
                </div>

            </div>
        </div >
    );
};