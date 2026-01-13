import React, { useState } from 'react';
import { AnalysisResult } from '../types';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, BarChart3, Clock, Flame, Anchor } from 'lucide-react';
import { DetailPanel } from './DetailPanel';

interface ScannerTableProps {
  data: AnalysisResult[];
  activeExchange?: 'MEXC' | 'HYPERLIQUID';
}

export const ScannerTable: React.FC<ScannerTableProps> = ({ data, activeExchange = 'MEXC' }) => {
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState<string>('ALL');
  const [biasFilter, setBiasFilter] = useState<string>('ALL');
  const [exchangeFilter, setExchangeFilter] = useState<string>('ALL');

  const toggleExpand = (symbol: string) => {
    setExpandedSymbol(expandedSymbol === symbol ? null : symbol);
  };

  const getBiasIcon = (bias: string) => {
    if (bias === 'LONG') return <TrendingUp className="w-4 h-4 text-green-400" />;
    if (bias === 'SHORT') return <TrendingDown className="w-4 h-4 text-red-400" />;
    return <Minus className="w-4 h-4 text-gray-500" />;
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-400 font-bold';
    if (score >= 50) return 'text-yellow-400 font-medium';
    return 'text-red-400';
  };

  const renderConsistencyBadge = (history: AnalysisResult['history']) => {
    if (!history) return null;

    if (history.consecutiveScans > 1) {
      return (
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1 bg-blue-900/40 border border-blue-800 text-blue-300 px-2 py-0.5 rounded text-[10px] font-semibold" title={`Signal stable for ${(history.consecutiveScans * 15)} minutes`}>
            <Anchor className="w-3 h-3" />
            <span>{history.consecutiveScans}x</span>
          </div>
          {history.status === 'STRENGTHENING' && <span className="text-[9px] text-green-400 mt-0.5">Rising</span>}
          {history.status === 'WEAKENING' && <span className="text-[9px] text-red-400 mt-0.5">Fading</span>}
        </div>
      );
    } else {
      return (
        <div className="flex items-center gap-1 text-orange-400 bg-orange-900/20 px-2 py-0.5 rounded text-[10px] border border-orange-900/50" title="First appearance in scan">
          <Flame className="w-3 h-3" />
          <span>NEW</span>
        </div>
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex items-center gap-4 bg-gray-900 border border-gray-800 p-3 rounded-lg shadow-sm overflow-x-auto">

        {/* Exchange Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-mono uppercase">Exchange:</span>
          <select
            value={exchangeFilter}
            onChange={(e) => setExchangeFilter(e.target.value)}
            className="bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 px-2 py-1 outline-none focus:border-blue-500"
          >
            <option value="ALL">ALL</option>
            <option value="BIN">BINANCE</option>
            <option value="HL">HYPERLIQUID</option>
            <option value="MEX">MEXC</option>
            <option value="KUC">KUCOIN</option>
          </select>
        </div>

        <div className="h-4 w-px bg-gray-700 mx-2"></div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-mono uppercase">Strategy:</span>
          <select
            value={strategyFilter}
            onChange={(e) => setStrategyFilter(e.target.value)}
            className="bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 px-2 py-1 outline-none focus:border-blue-500"
          >
            <option value="ALL">ALL</option>
            <option value="Breakout">BREAKOUT</option>
            <option value="Legacy">LEGACY</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-mono uppercase">Bias:</span>
          <select
            value={biasFilter}
            onChange={(e) => setBiasFilter(e.target.value)}
            className="bg-gray-800 text-gray-300 text-xs rounded border border-gray-700 px-2 py-1 outline-none focus:border-blue-500"
          >
            <option value="ALL">ALL</option>
            <option value="LONG">BULLISH (LONG)</option>
            <option value="SHORT">BEARISH (SHORT)</option>
            <option value="NEUTRAL">NEUTRAL</option>
            <option value="WAIT">WAIT</option>
            <option value="NONE">NONE</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-gray-600 whitespace-nowrap">
          Showing {data.filter(r =>
            (strategyFilter === 'ALL' || r.strategy_name === strategyFilter) &&
            (biasFilter === 'ALL' || (r.htf?.bias || r.bias || 'NONE') === biasFilter) &&
            (exchangeFilter === 'ALL' || r.exchange_tag === exchangeFilter)
          ).length} / {data.length} Signals
        </div>
      </div>

      {/* STATS HEADER */}
      <div className="flex gap-4 mb-4 text-xs font-mono text-gray-400 bg-gray-900 p-2 rounded border border-gray-800">
        <span>Total Signals: <span className="text-white font-bold">{data.length}</span></span>
        <span className="text-gray-600">|</span>
        <span>HL: <span className="text-purple-400 font-bold">{data.filter(d => d.exchange_tag === 'HL').length}</span></span>
        <span className="text-gray-600">|</span>
        <span>MEXC: <span className="text-cyan-400 font-bold">{data.filter(d => d.exchange_tag === 'MEX').length}</span></span>
        <span className="text-gray-600">|</span>
        <span>KUCOIN: <span className="text-blue-400 font-bold">{data.filter(d => d.exchange_tag === 'KUC').length}</span></span>
      </div>

      <div className="overflow-hidden bg-gray-900 rounded-lg border border-gray-800 shadow-xl">
        <table className="w-full text-left text-sm text-gray-400">
          <thead className="bg-gray-800 text-gray-200 uppercase font-mono text-xs">
            <tr>
              <th className="px-6 py-3">Exch</th>
              <th className="px-6 py-3">Pair</th>
              <th className="px-6 py-3">Strategy</th>
              <th className="px-6 py-3">Price</th>
              <th className="px-6 py-3">Bias</th>
              <th className="px-6 py-3 text-center">Score</th>
              <th className="px-6 py-3 text-center">Context</th>
              <th className="px-6 py-3 text-center">R:R</th>
              <th className="px-6 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {data
              .filter(pair => {
                if (strategyFilter !== 'ALL' && pair.strategy_name !== strategyFilter) return false;
                const checkBias = pair.htf?.bias || pair.bias || 'NONE';
                if (biasFilter !== 'ALL' && checkBias !== biasFilter) return false;
                if (exchangeFilter !== 'ALL' && pair.exchange_tag !== exchangeFilter) return false;
                return true;
              })
              .map((pair, index) => {
                const displayBias = pair.htf?.bias || pair.bias || 'NONE';
                if (index === 0) console.log("Strategy:", pair.strategy_name, "Data:", pair.details?.score_breakdown);
                return (
                  <React.Fragment key={`${pair.symbol}-${pair.strategy_name}-${index}`}>
                    <tr
                      onClick={() => toggleExpand(pair.symbol)}
                      className={`hover:bg-gray-800 cursor-pointer transition-colors ${expandedSymbol === pair.symbol ? 'bg-gray-800 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}`}
                    >
                      <td className="px-6 py-4 font-mono text-xs">
                        {pair.exchange_tag === 'BIN' && <span className="text-yellow-400 font-bold">BIN</span>}
                        {pair.exchange_tag === 'HL' && <span className="text-purple-400 font-bold">HL</span>}
                        {pair.exchange_tag === 'MEX' && <span className="text-cyan-400 font-bold">MEX</span>}
                        {pair.exchange_tag === 'KUC' && <span className="text-blue-400 font-bold">KUC</span>}
                        {!['BIN', 'HL', 'MEX', 'KUC'].includes(pair.exchange_tag || '') && <span className="text-gray-500">{pair.exchange_tag}</span>}
                      </td>
                      <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${pair.score > 70 ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                        {pair.symbol}
                      </td>
                      <td className="px-6 py-4">
                        {pair.strategy_name?.toUpperCase() === 'BREAKOUT' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-purple-900/40 text-purple-300 border border-purple-800 font-bold tracking-wide">
                            BREAKOUT
                          </span>
                        ) : pair.strategy_name?.toUpperCase() === 'LEGACY' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-blue-900/20 text-blue-400 border border-blue-900/50">
                            LEGACY
                          </span>
                        ) : (
                          <span className="text-gray-600 text-[10px]">{pair.strategy_name || '-'}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono">${pair.price.toFixed(4)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {getBiasIcon(displayBias)}
                          <span className={`text-xs opacity-75 ${displayBias === 'LONG' ? 'text-green-300' : displayBias === 'SHORT' ? 'text-red-300' : ''}`}>
                            {displayBias}
                          </span>
                        </div>
                      </td>
                      <td className={`px-6 py-4 text-center group relative cursor-help ${pair.score >= 80 ? 'text-green-400 font-bold' : pair.score >= 60 ? 'text-orange-400 font-medium' : 'text-gray-500'}`}>
                        <div className="flex flex-col items-center leading-tight">
                          <span className="text-sm border-b border-dashed border-gray-600">{pair.score.toFixed(1)}</span>

                          {/* Tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-52 p-2 bg-gray-950 border border-gray-700 rounded shadow-xl z-50 text-[10px] text-left font-normal text-gray-300">
                            {pair.strategy_name === 'Legacy' || pair.strategy_name?.toUpperCase() === 'LEGACY' ? (
                              // LEGACY TOOLTIP
                              <div className="bg-gray-900 text-white text-xs p-2 rounded border border-gray-700 shadow-xl z-50 min-w-[150px]">
                                <div className="font-bold mb-1 border-b border-gray-700 pb-1">Legacy Score</div>

                                {/* Smart Money & Trend */}
                                <div className="flex justify-between items-center mb-1">
                                  <span>Smart Money & Trend:</span>
                                  <span className="text-blue-400 font-bold ml-2">
                                    {((pair.details?.trendScore || 0) + (pair.details?.moneyFlowScore || 0)).toFixed(1)} / 40
                                  </span>
                                </div>

                                {/* Structure */}
                                <div className="flex justify-between items-center mb-1">
                                  <span>Structure:</span>
                                  <span className="text-green-400 font-bold ml-2">
                                    {((pair.details?.structureScore || 0) + 10).toFixed(1)} / 40
                                  </span>
                                </div>

                                {/* Momentum & Timing */}
                                <div className="flex justify-between items-center">
                                  <span>Momentum & Timing:</span>
                                  <span className="text-gray-300 ml-2">
                                    {((pair.details?.timingScore || 0) + (pair.details?.vol24h ? 2 : 0)).toFixed(1)} / 20
                                  </span>
                                </div>
                              </div>
                            ) : pair.details?.score_breakdown ? (
                              // BREAKOUT TOOLTIP (Hybrid)
                              <div className="bg-gray-900 text-white text-xs p-2 rounded border border-gray-700 shadow-xl z-50 min-w-[150px]">
                                <div className="font-bold mb-1 border-b border-gray-700 pb-1">Score Breakdown</div>

                                {/* GEOMETRY */}
                                <div className="flex justify-between items-center mb-1">
                                  <span>Geometry & Structure:</span>
                                  <span className={(pair.details.score_breakdown?.geometry || 0) >= 35 ? "text-green-400 font-bold ml-2" : "text-gray-300 ml-2"}>
                                    {(pair.details.score_breakdown?.geometry || 0).toFixed(1)} / 60
                                  </span>
                                </div>

                                {/* MOMENTUM */}
                                <div className="flex justify-between items-center mb-1">
                                  <span>Momentum & Div:</span>
                                  <span className={(pair.details.score_breakdown?.momentum || 0) >= 15 ? "text-blue-400 font-bold ml-2" : "text-gray-300 ml-2"}>
                                    {(pair.details.score_breakdown?.momentum || 0).toFixed(1)} / 30
                                  </span>
                                </div>

                                {/* BASE */}
                                <div className="flex justify-between items-center">
                                  <span>Base / Context:</span>
                                  <span className="text-gray-400 ml-2">
                                    {(pair.details.score_breakdown?.base || 0).toFixed(1)} / 10
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="p-2">No detailed breakdown available</div>
                            )}

                            {pair.components && (
                              <div className="mt-1 pt-1 border-t border-gray-800 text-[9px] text-gray-500">
                                Area: {(Math.abs(pair.components.price_change_pct || 0) * (pair.components.duration_candles || 0)).toFixed(0)} <br />
                                Div Type: {pair.components.divergence_type || 0}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-wrap gap-1 justify-center">
                          {/* Consistency Badge */}
                          {pair.history && pair.history.consecutiveScans > 1 && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-900/40 text-blue-300 border border-blue-800">
                              {pair.history.consecutiveScans}x Stable
                            </span>
                          )}
                          {/* Context Badges */}
                          {pair.components && (
                            <>
                              {pair.details?.context_badge && (
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${pair.details.context_badge === 'DIV-PREP' ? 'bg-indigo-900 text-indigo-300 border-indigo-700' : 'bg-gray-700 text-gray-300'}`}>
                                  {pair.details.context_badge}
                                </span>
                              )}
                              {pair.components?.divergence_type >= 3 && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-900 text-purple-300 font-bold border border-purple-700">TRIPLE DIV</span>
                              )}
                              {(Math.abs(pair.components?.price_change_pct || 0) * (pair.components?.duration_candles || 0)) > 2000 && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-900 text-blue-300 font-bold border border-blue-700">HUGE AREA</span>
                              )}
                            </>
                          )}
                          {pair.details?.type === 'RETEST' && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-900/40 text-orange-300 border border-orange-800">RETEST</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center font-mono text-xs">
                        {pair.setup ? (
                          <span className={`px-2 py-1 rounded ${pair.setup.rr >= 2.5 ? 'bg-green-900/30 text-green-400' : 'text-yellow-400'}`}>
                            1:{pair.setup.rr}
                          </span>
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {expandedSymbol === pair.symbol ? <ChevronUp className="w-5 h-5 ml-auto text-blue-400" /> : <ChevronDown className="w-5 h-5 ml-auto" />}
                      </td>
                    </tr>
                    {expandedSymbol === pair.symbol && (
                      <tr>
                        <td colSpan={11} className="bg-gray-950/50 p-0 border-b border-gray-800 animate-in fade-in slide-in-from-top-2 duration-200">
                          <DetailPanel pair={pair} activeExchange={activeExchange} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
};