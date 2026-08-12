import React, { useState, useEffect } from 'react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine
} from 'recharts';
import { TrendingUp, TrendingDown, Target, AlertCircle } from 'lucide-react';
import { getProducts, getStores, getCompetitorInfluence } from '../services/api';
import type { Product, Store, CompetitorInfluence } from '../services/api';

const SUPERMARKET_COLOURS: Record<string, string> = {
  Tesco:      '#003d7a',
  Sainsburys: '#ff7700',
  Aldi:       '#00529b',
  Asda:       '#7dc242',
  Morrisons:  '#ffd700',
};

const STRATEGY_LABELS: Record<string, string> = {
  market_leader:      'Market Leader',
  quality_premium:    'Quality Premium',
  hard_discounter:    'Hard Discounter',
  everyday_low_price: 'Everyday Low Price',
  value_fresh:        'Value Fresh',
};

export default function CompetitorInfluencePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores,   setStores]   = useState<Store[]>([]);
  const [itemId,   setItemId]   = useState(1);
  const [storeId,  setStoreId]  = useState(1);
  const [data,     setData]     = useState<CompetitorInfluence | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    getProducts().then(setProducts);
    getStores().then(setStores);
  }, []);

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getCompetitorInfluence(storeId, itemId, '2024-06-11');
      setData(result);
    } catch (e) {
      setError('Failed to load competitor influence data. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-run when dropdowns change and we already have a result
  useEffect(() => {
    if (data) handleRun();
  }, [itemId, storeId]);

  const selectClass =
    "bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 text-sm w-full";

  // Radar data — one axis per metric
  const radarData = data?.competitors.map(c => ({
    supermarket:    c.supermarket,
    'Influence':    c.influence_score,
    'Aggression':   c.aggression * 100,
    'Price Pull':   Math.min(c.price_pull_pct * 3, 100),
    'Price Factor': Math.abs(c.price_factor - 1) * 500,
  })) ?? [];

  return (
    <div className="p-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Competitor Influence Score</h1>
        <p className="text-slate-400 mt-1 text-sm">
          How much does each competitor pull our pricing decision — and in which direction?
        </p>
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-6">
        <div className="grid grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Product</label>
            <select value={itemId} onChange={e => setItemId(Number(e.target.value))} className={selectClass}>
              {products.length === 0 && <option>Loading…</option>}
              {products.map(p => <option key={p.item_id} value={p.item_id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Store</label>
            <select value={storeId} onChange={e => setStoreId(Number(e.target.value))} className={selectClass}>
              {stores.length === 0 && <option>Loading…</option>}
              {stores.map(s => <option key={s.store_id} value={s.store_id}>{s.name}</option>)}
            </select>
          </div>
          <button
            onClick={handleRun}
            disabled={loading || products.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white
                       px-6 py-2 rounded-lg font-medium transition-colors text-sm"
          >
            {loading ? 'Calculating…' : 'Calculate Influence'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Summary stat cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Our Price</div>
              <div className="text-2xl font-semibold text-white">£{data.our_price.toFixed(2)}</div>
              <div className="text-xs text-slate-500 mt-1">{data.product_name}</div>
            </div>
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Avg Competitor</div>
              <div className="text-2xl font-semibold text-white">£{data.avg_competitor_price.toFixed(2)}</div>
              <div className="text-xs text-slate-500 mt-1">Across 5 supermarkets</div>
            </div>
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Market Pressure</div>
              <div className={`text-2xl font-semibold flex items-center gap-2 ${
                data.market_pressure === 'downward' ? 'text-red-400' : 'text-green-400'
              }`}>
                {data.market_pressure === 'downward'
                  ? <TrendingDown size={22} />
                  : <TrendingUp size={22} />
                }
                {data.market_pressure === 'downward' ? '▼' : '▲'} {data.pressure_magnitude}%
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {data.market_pressure === 'downward'
                  ? 'Competitors cheaper — pressure to reduce'
                  : 'Competitors pricier — room to raise'
                }
              </div>
            </div>
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Most Influential</div>
              <div className="text-2xl font-semibold text-indigo-400">{data.most_influential}</div>
              <div className="text-xs text-slate-500 mt-1">
                Avg influence score: {data.avg_influence_score}
              </div>
            </div>
          </div>

          {/* Main content: bar chart + competitor cards */}
          <div className="grid grid-cols-2 gap-6 mb-6">

            {/* Influence score bar chart */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                Influence Score by Competitor
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Higher = greater pull on our pricing decision
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.competitors} layout="vertical">
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickFormatter={v => `${v}`} />
                  <YAxis type="category" dataKey="supermarket" width={90}
                    tick={{ fill: '#e2e8f0', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    formatter={(v: any) => [v.toFixed(1), 'Influence Score']}
                  />
                  <ReferenceLine x={data.avg_influence_score} stroke="#6366f1"
                    strokeDasharray="4 4" label={{ value: 'avg', fill: '#6366f1', fontSize: 10 }} />
                  <Bar dataKey="influence_score" radius={[0, 4, 4, 0]}>
                    {data.competitors.map((c, i) => (
                      <Cell key={i} fill={SUPERMARKET_COLOURS[c.supermarket] ?? '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Price pull direction chart */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                Price Pull Direction (£)
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Negative = competitor cheaper (pushes our price down)
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.competitors} layout="vertical">
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickFormatter={v => `£${v.toFixed(2)}`} />
                  <YAxis type="category" dataKey="supermarket" width={90}
                    tick={{ fill: '#e2e8f0', fontSize: 12 }} />
                  <ReferenceLine x={0} stroke="#475569" />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    formatter={(v: any) => [`£${Number(v).toFixed(2)}`, 'Price difference']}
                  />
                  <Bar dataKey="price_diff" radius={[0, 4, 4, 0]}>
                    {data.competitors.map((c, i) => (
                      <Cell key={i} fill={c.price_diff >= 0 ? '#10b981' : '#f43f5e'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Per-competitor detail cards */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            {data.competitors.map(c => (
              <div key={c.supermarket}
                className="bg-slate-800 rounded-xl p-4 border border-slate-700"
                style={{ borderTopColor: SUPERMARKET_COLOURS[c.supermarket] ?? '#6366f1', borderTopWidth: 3 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{c.supermarket}</span>
                  {c.direction === 'downward'
                    ? <TrendingDown size={14} className="text-red-400" />
                    : <TrendingUp size={14} className="text-green-400" />
                  }
                </div>
                <div className="text-xs text-slate-500 mb-3">
                  {STRATEGY_LABELS[c.strategy] ?? c.strategy}
                </div>

                {/* Influence score gauge */}
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-400">Influence</span>
                    <span className="text-white font-medium">{c.influence_score}</span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${c.influence_score}%`,
                        backgroundColor: SUPERMARKET_COLOURS[c.supermarket] ?? '#6366f1'
                      }}
                    />
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Their price</span>
                    <span className="text-slate-300">£{c.their_price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Difference</span>
                    <span className={c.price_diff >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {c.price_diff >= 0 ? '+' : ''}£{c.price_diff.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Aggression</span>
                    <span className="text-slate-300">{(c.aggression * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Dissertation insight box */}
          <div className="bg-indigo-950 border border-indigo-700 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <Target size={22} className="text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-white font-medium mb-2">Research Insight</h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  For <span className="text-indigo-400 font-medium">{data.product_name}</span> at{' '}
                  <span className="text-indigo-400 font-medium">{data.store_name}</span>,{' '}
                  <span className="text-indigo-400 font-medium">{data.most_influential}</span> exerts
                  the highest pricing influence (score: {data.competitors[0]?.influence_score}).
                  The market is applying{' '}
                  <span className={`font-medium ${data.market_pressure === 'downward' ? 'text-red-400' : 'text-green-400'}`}>
                    {data.market_pressure} pressure
                  </span>{' '}
                  of <span className="text-indigo-400 font-medium">{data.pressure_magnitude}%</span> on
                  our shelf price. This quantifies the mechanism by which competitor agents mediate
                  pricing decisions — a key variable in answering the dissertation research question.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="bg-slate-800 rounded-xl p-12 border border-slate-700 text-center">
          <Target size={40} className="text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">
            Select a product and store, then click Calculate Influence to see competitor scores.
          </p>
        </div>
      )}
    </div>
  );
}