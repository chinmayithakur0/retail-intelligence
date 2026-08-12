import React, { useState, useEffect, useCallback } from 'react';
import { getDecisionLog, clearDecisionLog, getDecisionLogStats } from '../services/api';
import type { DecisionLog, DecisionLogStats } from '../services/api';
import {
  ClipboardList, Trash2, RefreshCw, TrendingUp,
  TrendingDown, Zap, Target, Activity, Brain, AlertCircle
} from 'lucide-react';

// Badge colour per analysis type
const TYPE_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  'Quick Predict':        { bg: 'bg-blue-900',   text: 'text-blue-300',   icon: <Zap size={11} /> },
  'Ablation Study':       { bg: 'bg-purple-900', text: 'text-purple-300', icon: <Brain size={11} /> },
  'Competitor Influence': { bg: 'bg-orange-900', text: 'text-orange-300', icon: <Target size={11} /> },
  'Sensitivity Analysis': { bg: 'bg-teal-900',   text: 'text-teal-300',   icon: <Activity size={11} /> },
  'Full Crew':            { bg: 'bg-indigo-900', text: 'text-indigo-300', icon: <Brain size={11} /> },
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function TypeBadge({ type }: { type: string }) {
  const style = TYPE_STYLES[type] ?? { bg: 'bg-slate-700', text: 'text-slate-300', icon: null };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      {style.icon}{type}
    </span>
  );
}

export default function DecisionLogPage() {
  const [logs,    setLogs]    = useState<DecisionLog[]>([]);
  const [stats,   setStats]   = useState<DecisionLogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter,  setFilter]  = useState<string>('All');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [logData, statsData] = await Promise.all([
        getDecisionLog(100),
        getDecisionLogStats(),
      ]);
      setLogs(logData);
      setStats(statsData);
    } catch {
      setError('Failed to load decision log. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    if (!window.confirm('Clear all decision log entries? This cannot be undone.')) return;
    setClearing(true);
    await clearDecisionLog();
    setClearing(false);
    load();
  };

  const FILTER_TYPES = ['All', 'Quick Predict', 'Ablation Study', 'Competitor Influence', 'Sensitivity Analysis', 'Full Crew'];

  const filteredLogs = filter === 'All'
    ? logs
    : logs.filter(l => l.analysis_type === filter);

  const selectClass = "bg-slate-700 text-white rounded-lg px-3 py-1.5 border border-slate-600 text-xs";

  return (
    <div className="p-8">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Agent Decision Log</h1>
          <p className="text-slate-400 mt-1 text-sm">
            Full audit trail of every analysis run — what was decided and why.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300
                       px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={handleClear}
            disabled={clearing || logs.length === 0}
            className="flex items-center gap-1.5 bg-red-900 hover:bg-red-800 text-red-300
                       px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} />
            Clear Log
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Total Decisions</div>
            <div className="text-2xl font-semibold text-white">{stats.total_decisions}</div>
            <div className="text-xs text-slate-500 mt-1">Logged across all analysis types</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Avg Revenue Lift</div>
            <div className={`text-2xl font-semibold ${stats.avg_revenue_lift >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {stats.avg_revenue_lift >= 0 ? '+' : ''}£{stats.avg_revenue_lift.toFixed(2)}
            </div>
            <div className="text-xs text-slate-500 mt-1">Across ablation + sensitivity runs</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Most Analysed Product</div>
            <div className="text-sm font-semibold text-indigo-400 mt-1">
              {stats.most_analysed_product ?? '—'}
            </div>
            <div className="text-xs text-slate-500 mt-1">By number of analyses run</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
            <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Most Analysed Store</div>
            <div className="text-sm font-semibold text-indigo-400 mt-1">
              {stats.most_analysed_store ?? '—'}
            </div>
            <div className="text-xs text-slate-500 mt-1">By number of analyses run</div>
          </div>
        </div>
      )}

      {/* Analysis type breakdown */}
      {stats && stats.by_type.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 mb-6">
          <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-3">
            Breakdown by Analysis Type
          </h2>
          <div className="flex gap-4 flex-wrap">
            {stats.by_type.map(t => (
              <div key={t.analysis_type} className="flex items-center gap-2">
                <TypeBadge type={t.analysis_type} />
                <span className="text-white text-sm font-medium">{t.c}</span>
                <span className="text-slate-500 text-xs">run{t.c !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter + log table */}
      <div className="bg-slate-800 rounded-xl border border-slate-700">
        {/* Filter bar */}
        <div className="flex items-center gap-3 p-4 border-b border-slate-700">
          <ClipboardList size={16} className="text-slate-400" />
          <span className="text-xs text-slate-400 uppercase tracking-wide">Filter:</span>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className={selectClass}
          >
            {FILTER_TYPES.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500 ml-auto">
            {filteredLogs.length} entr{filteredLogs.length !== 1 ? 'ies' : 'y'}
          </span>
        </div>

        {/* Empty state */}
        {filteredLogs.length === 0 && !loading && (
          <div className="text-center py-16">
            <ClipboardList size={40} className="text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400 text-sm">
              {logs.length === 0
                ? 'No decisions logged yet. Run an analysis on any page to start the log.'
                : 'No entries match the selected filter.'}
            </p>
          </div>
        )}

        {/* Log entries */}
        <div className="divide-y divide-slate-700">
          {filteredLogs.map(log => (
            <div
              key={log.id}
              className="p-4 hover:bg-slate-750 cursor-pointer transition-colors"
              onClick={() => setExpanded(expanded === log.id ? null : log.id)}
            >
              {/* Row summary */}
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  <TypeBadge type={log.analysis_type} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-medium">{log.product_name}</span>
                    <span className="text-slate-500 text-xs">@</span>
                    <span className="text-slate-300 text-sm">{log.store_name}</span>
                    {log.revenue_lift !== null && (
                      <span className={`flex items-center gap-0.5 text-xs font-medium ${
                        log.revenue_lift >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {log.revenue_lift >= 0
                          ? <TrendingUp size={11} />
                          : <TrendingDown size={11} />}
                        {log.revenue_lift >= 0 ? '+' : ''}£{log.revenue_lift.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-xs mt-1 leading-relaxed">{log.summary}</p>
                </div>
                <div className="shrink-0 text-xs text-slate-500 text-right whitespace-nowrap">
                  {formatTimestamp(log.timestamp)}
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === log.id && (
                <div className="mt-4 ml-0 grid grid-cols-3 gap-3">
                  {log.our_price !== null && (
                    <div className="bg-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">Our Price</div>
                      <div className="text-white font-medium">£{log.our_price.toFixed(2)}</div>
                    </div>
                  )}
                  {log.optimal_price !== null && (
                    <div className="bg-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">Optimal Price</div>
                      <div className="text-indigo-400 font-medium">£{log.optimal_price.toFixed(2)}</div>
                    </div>
                  )}
                  {log.predicted_demand !== null && (
                    <div className="bg-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">Predicted Demand</div>
                      <div className="text-white font-medium">{log.predicted_demand.toFixed(0)} units</div>
                    </div>
                  )}
                  {log.expected_revenue !== null && (
                    <div className="bg-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">Expected Revenue</div>
                      <div className="text-green-400 font-medium">£{log.expected_revenue.toFixed(2)}</div>
                    </div>
                  )}
                  {log.inventory_status !== null && (
                    <div className="bg-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">Inventory Status</div>
                      <div className="text-white font-medium">{log.inventory_status}</div>
                    </div>
                  )}
                  {log.market_pressure !== null && (
                    <div className="bg-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">Market Pressure</div>
                      <div className={`font-medium ${
                        log.market_pressure === 'upward' ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {log.market_pressure === 'upward' ? '▲' : '▼'} {log.market_pressure}
                      </div>
                    </div>
                  )}
                  {log.most_influential !== null && (
                    <div className="bg-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">Most Influential</div>
                      <div className="text-indigo-400 font-medium">{log.most_influential}</div>
                    </div>
                  )}
                  {log.revenue_lift !== null && (
                    <div className="bg-slate-700 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">Revenue Lift</div>
                      <div className={`font-medium ${log.revenue_lift >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {log.revenue_lift >= 0 ? '+' : ''}£{log.revenue_lift.toFixed(2)}
                      </div>
                    </div>
                  )}
                  <div className="bg-slate-700 rounded-lg p-3">
                    <div className="text-xs text-slate-400 mb-1">Log ID</div>
                    <div className="text-slate-300 font-mono text-xs">#{log.id}</div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}