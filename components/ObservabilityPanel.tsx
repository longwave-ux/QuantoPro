import React from 'react';
import { AnalysisResult, Observability, RsiVisuals } from '../types';
import { BarChart2, TrendingUp, TrendingDown, Activity, Eye } from 'lucide-react';

interface ObservabilityPanelProps {
  signal: AnalysisResult;
}

// Universal score parameter definitions
interface ScoreParameter {
  key: string;
  label: string;
  max: number;
  color: 'blue' | 'green' | 'purple' | 'yellow' | 'cyan' | 'orange' | 'pink' | 'red' | 'indigo';
  category: 'primary' | 'secondary' | 'bonus';
}

const SCORE_PARAMETERS: ScoreParameter[] = [
  // Legacy Strategy Parameters
  { key: 'trend_score', label: 'Trend', max: 25, color: 'blue', category: 'primary' },
  { key: 'structure_score', label: 'Structure', max: 25, color: 'green', category: 'primary' },
  { key: 'money_flow_score', label: 'Money Flow', max: 25, color: 'purple', category: 'primary' },
  { key: 'timing_score', label: 'Timing', max: 25, color: 'yellow', category: 'primary' },

  // Breakout Strategy Parameters
  { key: 'geometry_score', label: 'Geometry', max: 40, color: 'cyan', category: 'primary' },
  { key: 'momentum_score', label: 'Momentum', max: 30, color: 'orange', category: 'primary' },
  { key: 'oi_flow_score', label: 'OI Flow', max: 20, color: 'pink', category: 'secondary' },
  { key: 'sentiment_score', label: 'Sentiment', max: 10, color: 'indigo', category: 'secondary' },

  // Bonuses (if present)
  { key: 'bonuses', label: 'Bonuses', max: 30, color: 'red', category: 'bonus' },
];

export const ObservabilityPanel: React.FC<ObservabilityPanelProps> = ({ signal }) => {
  const obs = signal.observability;

  if (!obs) {
    return (
      <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
        <div className="flex items-center gap-2 text-gray-400">
          <Eye className="w-4 h-4" />
          <span className="text-sm">No observability data available</span>
        </div>
      </div>
    );
  }

  const { score_composition, rsi_visuals } = obs;

  // Filter parameters to only show those with values > 0 or defined
  const activeParameters = SCORE_PARAMETERS.filter(param => {
    const value = score_composition[param.key];
    return value !== undefined && value !== null && value > 0;
  });

  // Group by category
  const primaryParams = activeParameters.filter(p => p.category === 'primary');
  const secondaryParams = activeParameters.filter(p => p.category === 'secondary');
  const bonusParams = activeParameters.filter(p => p.category === 'bonus');

  return (
    <div className="space-y-4">
      {/* Score Composition Section */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="w-4 h-4 text-blue-400" />
          <h3 className="font-semibold text-white">Score Composition</h3>
        </div>

        <div className="space-y-3">
          {/* Primary Score Components */}
          {primaryParams.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-2">Core Components</div>
              <div className="grid grid-cols-2 gap-2">
                {primaryParams.map(param => (
                  <ScoreBar
                    key={param.key}
                    label={param.label}
                    value={score_composition[param.key] || 0}
                    max={param.max}
                    color={param.color}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Secondary Score Components */}
          {secondaryParams.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-2">Secondary Factors</div>
              <div className="grid grid-cols-2 gap-2">
                {secondaryParams.map(param => (
                  <ScoreBar
                    key={param.key}
                    label={param.label}
                    value={score_composition[param.key] || 0}
                    max={param.max}
                    color={param.color}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Bonus Components */}
          {bonusParams.length > 0 && (
            <div>
              <div className="text-xs text-gray-400 mb-2">Bonuses</div>
              <div className="grid grid-cols-2 gap-2">
                {bonusParams.map(param => (
                  <ScoreBar
                    key={param.key}
                    label={param.label}
                    value={score_composition[param.key] || 0}
                    max={param.max}
                    color={param.color}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Raw Indicators */}
          <div>
            <div className="text-xs text-gray-400 mb-2">Indicators</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {score_composition.rsi !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">RSI:</span>
                  <span className={`font-mono ${getRsiColor(score_composition.rsi)}`}>
                    {score_composition.rsi.toFixed(2)}
                  </span>
                </div>
              )}
              {score_composition.adx !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">ADX:</span>
                  <span className="font-mono text-white">{score_composition.adx.toFixed(2)}</span>
                </div>
              )}
              {score_composition.ema50 !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">EMA50:</span>
                  <span className="font-mono text-white">{score_composition.ema50.toFixed(2)}</span>
                </div>
              )}
              {score_composition.ema200 !== undefined && (
                <div className="flex justify-between">
                  <span className="text-gray-400">EMA200:</span>
                  <span className="font-mono text-white">{score_composition.ema200.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Conditions & Context */}
          <div>
            <div className="text-xs text-gray-400 mb-2">Context & Conditions</div>
            <div className="flex flex-wrap gap-2">
              {/* Exchange Badge - from signal.exchange */}
              {signal.exchange && (
                <div className="px-2 py-1 rounded border bg-blue-500/20 border-blue-500/50 text-blue-300 text-xs">
                  {signal.exchange}
                </div>
              )}

              {/* Cardwell Range Badge (V2) */}
              {score_composition.cardwell_range && (
                <div className={`px-2 py-1 rounded border text-xs ${score_composition.cardwell_range === 'BULLISH' ? 'bg-green-500/20 border-green-500/50 text-green-300' :
                  score_composition.cardwell_range === 'BEARISH' ? 'bg-red-500/20 border-red-500/50 text-red-300' :
                    score_composition.cardwell_range === 'OVERBOUGHT' ? 'bg-orange-500/20 border-orange-500/50 text-orange-300' :
                      score_composition.cardwell_range === 'OVERSOLD' ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' :
                        'bg-gray-500/20 border-gray-500/50 text-gray-300'
                  }`}>
                  {score_composition.cardwell_range}
                </div>
              )}

              {score_composition.pullback_detected !== undefined && (
                <ConditionBadge
                  label="Pullback"
                  active={score_composition.pullback_detected}
                  detail={score_composition.pullback_depth ?
                    `${(score_composition.pullback_depth * 100).toFixed(1)}%` : undefined}
                />
              )}
              {score_composition.adx_strong_trend !== undefined && (
                <ConditionBadge
                  label="Strong Trend"
                  active={score_composition.adx_strong_trend}
                />
              )}
              {score_composition.is_overextended !== undefined && (
                <ConditionBadge
                  label="Overextended"
                  active={score_composition.is_overextended}
                  warning
                />
              )}
              {score_composition.oi_available !== undefined && (
                <ConditionBadge
                  label="OI Data"
                  active={score_composition.oi_available}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RSI Trendlines Section */}
      {rsi_visuals && (rsi_visuals.resistance || rsi_visuals.support) && (
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-purple-400" />
            <h3 className="font-semibold text-white">RSI Trendlines</h3>
          </div>

          <div className="space-y-3">
            {rsi_visuals.resistance && (
              <TrendlineInfo
                type="resistance"
                trendline={rsi_visuals.resistance}
                icon={<TrendingDown className="w-4 h-4" />}
              />
            )}
            {rsi_visuals.support && (
              <TrendlineInfo
                type="support"
                trendline={rsi_visuals.support}
                icon={<TrendingUp className="w-4 h-4" />}
              />
            )}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="text-xs text-gray-500 flex justify-between">
        <span>Calculated at: {new Date(obs.calculated_at).toLocaleString()}</span>
        <span>Candle #{obs.candle_index}</span>
      </div>
    </div>
  );
};

// Helper Components

interface ScoreBarProps {
  label: string;
  value: number;
  max: number;
  color: 'blue' | 'green' | 'purple' | 'yellow' | 'cyan' | 'orange' | 'pink' | 'red' | 'indigo';
}

const ScoreBar: React.FC<ScoreBarProps> = ({ label, value, max, color }) => {
  const percentage = Math.min((value / max) * 100, 100);

  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    purple: 'bg-purple-500',
    yellow: 'bg-yellow-500',
    cyan: 'bg-cyan-500',
    orange: 'bg-orange-500',
    pink: 'bg-pink-500',
    red: 'bg-red-500',
    indigo: 'bg-indigo-500',
  };

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-mono">{value.toFixed(1)}</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClasses[color]} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

interface ConditionBadgeProps {
  label: string;
  active: boolean;
  detail?: string;
  warning?: boolean;
}

const ConditionBadge: React.FC<ConditionBadgeProps> = ({ label, active, detail, warning }) => {
  const bgColor = active
    ? (warning ? 'bg-red-500/20 border-red-500/50' : 'bg-green-500/20 border-green-500/50')
    : 'bg-gray-700/50 border-gray-600/50';

  const textColor = active
    ? (warning ? 'text-red-300' : 'text-green-300')
    : 'text-gray-500';

  return (
    <div className={`px-2 py-1 rounded border ${bgColor} ${textColor} text-xs flex items-center gap-1`}>
      <span>{label}</span>
      {detail && <span className="font-mono">({detail})</span>}
    </div>
  );
};

interface TrendlineInfoProps {
  type: 'resistance' | 'support';
  trendline: any;
  icon: React.ReactNode;
}

const TrendlineInfo: React.FC<TrendlineInfoProps> = ({ type, trendline, icon }) => {
  const color = type === 'resistance' ? 'text-red-400' : 'text-green-400';
  const bgColor = type === 'resistance' ? 'bg-red-500/10' : 'bg-green-500/10';

  return (
    <div className={`${bgColor} rounded p-3`}>
      <div className={`flex items-center gap-2 mb-2 ${color}`}>
        {icon}
        <span className="font-semibold capitalize">{type}</span>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Equation:</span>
          <span className="font-mono text-white">{trendline.equation}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Pivot 1:</span>
          <span className="font-mono text-white">
            [{trendline.pivot_1.index}, {trendline.pivot_1.value.toFixed(2)}]
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Pivot 2:</span>
          <span className="font-mono text-white">
            [{trendline.pivot_2.index}, {trendline.pivot_2.value.toFixed(2)}]
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Slope:</span>
          <span className={`font-mono ${trendline.slope > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trendline.slope.toFixed(4)}
          </span>
        </div>
      </div>
    </div>
  );
};

// Helper Functions

function getRsiColor(rsi: number): string {
  if (rsi >= 70) return 'text-red-400';
  if (rsi <= 30) return 'text-green-400';
  return 'text-yellow-400';
}
