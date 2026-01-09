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
      <div className="flex items-center gap-4 bg-gray-900 border border-gray-800 p-3 rounded-lg shadow-sm">
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
        <div className="ml-auto text-xs text-gray-600">
          Showing {data.filter(r => (strategyFilter === 'ALL' || r.strategy_name === strategyFilter) && (biasFilter === 'ALL' || r.htf.bias === biasFilter)).length} / {data.length} Signals
        </div>
      </div>

      <div className="overflow-hidden bg-gray-900 rounded-lg border border-gray-800 shadow-xl">
        <table className="w-full text-left text-sm text-gray-400">
          <thead className="bg-gray-800 text-gray-200 uppercase font-mono text-xs">
            <tr>
              <th className="px-6 py-3">Pair</th>
              <th className="px-6 py-3">Strategy</th>
              <th className="px-6 py-3">Price</th>
              <th className="px-6 py-3">HTF Bias</th>
              <th className="px-6 py-3 text-center">Consistency</th>
              <th className="px-6 py-3 text-center">Score</th>
              <th className="px-6 py-3 text-center">R:R</th>
              <th className="px-6 py-3 text-center">OBV</th>
              <th className="px-6 py-3 text-center">RSI</th>
              <th className="px-6 py-3 text-center">Pullback</th>
              <th className="px-6 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {data
              .filter(pair => {
                if (strategyFilter !== 'ALL' && pair.strategy_name !== strategyFilter) return false;
                const checkBias = pair.htf?.bias || pair.bias || 'NONE';
                if (biasFilter !== 'ALL' && checkBias !== biasFilter) return false;
                return true;
              })
              .map((pair, index) => {
                const displayBias = pair.htf?.bias || pair.bias || 'NONE';
                return (
                  <React.Fragment key={`${pair.symbol}-${pair.strategy_name}-${index}`}>
                    <tr
                      onClick={() => toggleExpand(pair.symbol)}
                      className={`hover:bg-gray-800 cursor-pointer transition-colors ${expandedSymbol === pair.symbol ? 'bg-gray-800 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}`}
                    >
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
                      <td className="px-6 py-4 text-center">
                        {renderConsistencyBadge(pair.history)}
                      </td>
                      <td className={`px-6 py-4 text-center ${getScoreColor(pair.score)}`}>
                        <div className="flex flex-col items-center leading-tight">
                          <span className="text-sm">{pair.score}</span>
                          {pair.history && pair.history.prevScore > 0 && Math.abs(pair.score - pair.history.prevScore) >= 1 && (
                            <span className={`text-[10px] font-mono mt-0.5 ${pair.score > pair.history.prevScore ? 'text-green-400' : 'text-red-400 opacity-80'}`}>
                              {pair.score > pair.history.prevScore ? '▲' : '▼'} {Math.abs(pair.score - pair.history.prevScore)}
                            </span>
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
                      <td className="px-6 py-4 text-center">
                        {pair.ltf.obvImbalance === 'BULLISH' && (
                          <div className="flex items-center justify-center gap-1 text-green-400" title="Bullish Volume Imbalance (Accumulation)">
                            <BarChart3 className="w-4 h-4" />
                            <span className="text-[10px] font-bold">ACC</span>
                          </div>
                        )}
                        {pair.ltf.obvImbalance === 'BEARISH' && (
                          <div className="flex items-center justify-center gap-1 text-red-400" title="Bearish Volume Imbalance (Distribution)">
                            <BarChart3 className="w-4 h-4" />
                            <span className="text-[10px] font-bold">DIST</span>
                          </div>
                        )}
                        {pair.ltf.obvImbalance === 'NEUTRAL' && <span className="text-gray-600 text-xs">-</span>}
                      </td>
                      <td className={`px-6 py-4 text-center font-mono`}>
                        <div className="flex flex-col items-center">
                          <span className={`${!pair.ltf.momentumOk ? 'text-orange-400' : ''}`}>{pair.ltf.rsi.toFixed(1)}</span>
                          {pair.ltf.divergence === 'BULLISH' && <span className="text-[10px] bg-green-900 text-green-400 px-1 rounded mt-1">BULL DIV</span>}
                          {pair.ltf.divergence === 'BEARISH' && <span className="text-[10px] bg-red-900 text-red-400 px-1 rounded mt-1">BEAR DIV</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {pair.ltf.isPullback ? (
                          <span className="px-2 py-1 bg-green-900/30 text-green-400 rounded text-xs border border-green-900">
                            {(pair.ltf.pullbackDepth * 100).toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">{(pair.ltf.pullbackDepth * 100).toFixed(0)}%</span>
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