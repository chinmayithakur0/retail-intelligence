import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Legend, CartesianGrid
} from 'recharts';
import { AlertCircle, Activity } from 'lucide-react';
import { getProducts, getStores, getSensitivityAnalysis } from '../services/api';
import type { Product, Store, SensitivityAnalysis } from '../services/api';

export default function SensitivityAnalysisPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores,   setStores]   = useState<Store[]>([]);
  const [itemId,   setItemId]   = useState(1);
  const [storeId,  setStoreId]  = useState(1);
  const [data,     setData]     = useState<SensitivityAnalysis | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [metric,   setMetric]   = useState<'revenue' | 'price' | 'lift'>('revenue');

  useEffect(() => {
    getProducts().then(setProducts);
    getStores().then(setStores);
  }, []);

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSensitivityAnalysis(storeId, itemId, '2024-06-11');
      setData(result);
    } catch {
      setError('Failed to run sensitivity analysis. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const selectClass =
    "bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 text-sm w-full";

  const chartData = data?.results.map(r => ({
    elasticity:         r.elasticity,
    'Demand Only':      metric === 'revenue' ? r.demand_only_revenue
                      : metric === 'price'   ? r.demand_only_price
                      : 0,
    'Competitor Aware': metric === 'revenue' ? r.competitor_aware_revenue
                      : metric === 'price'   ? r.competitor_aware_price
                      : r.revenue_lift_pct,
    revenue_lift_pct:   r.revenue_lift_pct,
  })) ?? [];

  const assumed = data?.at_assumed_elasticity;

  const metricLabel =
    metric === 'revenue' ? 'Expected Revenue (£)' :
    metric === 'price'   ? 'Optimal Price (£)'    :
                           'Revenue Lift (%)';

  const formatY = (v: number) =>
    metric === 'lift' ? `${v.toFixed(1)}%` : `£${v.toFixed(2)}`;

  return (
    <div className="p-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Sensitivity Analysis</h1>
        <p className="text-slate-400 mt-1 text-sm">
          How robust is competitor intelligence across different price elasticity assumptions?
        </p>
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-6">
        <div className="grid grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Product</label>
            <select
              value={itemId}
              onChange={e => setItemId(Number(e.target.value))}
              className={selectClass}
            >
              {products.length === 0 && <option>Loading…</option>}
              {products.map(p => (
                <option key={p.item_id} value={p.item_id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Store</label>
            <select
              value={storeId}
              onChange={e => setStoreId(Number(e.target.value))}
              className={selectClass}
            >
              {stores.length === 0 && <option>Loading…</option>}
              {stores.map(s => (
                <option key={s.store_id} value={s.store_id}>{s.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleRun}
            disabled={loading || products.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white
                       px-6 py-2 rounded-lg font-medium transition-colors text-sm"
          >
            {loading ? 'Running…' : 'Run Sensitivity Analysis'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                Elasticity Range Tested
              </div>
              <div className="text-2xl font-semibold text-white">-0.5 → -3.0</div>
              <div className="text-xs text-slate-500 mt-1">{data.total_tested} values tested</div>
            </div>

            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                At Assumed Elasticity (−1.5)
              </div>
              <div className={`text-2xl font-semibold ${
                (assumed?.revenue_lift ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {(assumed?.revenue_lift ?? 0) >= 0 ? '+' : ''}
                £{assumed?.revenue_lift.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Revenue lift from competitor intelligence
              </div>
            </div>

            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                Competitor Intelligence Helps
              </div>
              <div className="text-2xl font-semibold text-green-400">
                {data.helps_in}/{data.total_tested}
              </div>
              <div className="text-xs text-slate-500 mt-1">elasticity values tested</div>
            </div>

            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                Max Revenue Lift
              </div>
              <div className="text-2xl font-semibold text-indigo-400">
                +£{data.max_lift.revenue_lift.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                at elasticity {data.max_lift.elasticity}
              </div>
            </div>
          </div>

          {/* Metric toggle */}
          <div className="flex gap-2 mb-4">
            {(['revenue', 'price', 'lift'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  metric === m
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {m === 'revenue' ? 'Expected Revenue' :
                 m === 'price'   ? 'Optimal Price'    :
                                   'Revenue Lift %'}
              </button>
            ))}
          </div>

          {/* Main chart */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
              {metricLabel} vs Price Elasticity
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Dashed line = dissertation's assumed elasticity of −1.5
            </p>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis
                  dataKey="elasticity"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickFormatter={v => `${v}`}
                  label={{
                    value: 'Price Elasticity',
                    position: 'insideBottom',
                    offset: -2,
                    fill: '#64748b',
                    fontSize: 11
                  }}
                  height={40}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickFormatter={formatY}
                  width={70}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 8
                  }}
                  formatter={(v: any, name: any) => [
                    metric === 'lift'
                      ? `${Number(v).toFixed(2)}%`
                      : `£${Number(v).toFixed(2)}`,
                    name
                  ]}
                  labelFormatter={l => `Elasticity: ${l}`}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }}
                />
                <ReferenceLine
                  x={-1.5}
                  stroke="#6366f1"
                  strokeDasharray="6 3"
                  label={{
                    value: 'assumed (−1.5)',
                    position: 'top',
                    fill: '#6366f1',
                    fontSize: 10
                  }}
                />
                {metric === 'lift' && (
                  <ReferenceLine y={0} stroke="#475569" />
                )}
                {metric !== 'lift' && (
                  <Line
                    type="monotone"
                    dataKey="Demand Only"
                    stroke="#475569"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="Competitor Aware"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Assumed elasticity spotlight + robustness summary */}
          {assumed && (
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
                  At Dissertation Assumption (Elasticity = −1.5)
                </h2>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-slate-700">
                    <span className="text-sm text-slate-400">Demand-only optimal price</span>
                    <span className="text-white font-medium">
                      £{assumed.demand_only_price.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-700">
                    <span className="text-sm text-slate-400">Competitor-aware price</span>
                    <span className="text-indigo-400 font-medium">
                      £{assumed.competitor_aware_price.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-700">
                    <span className="text-sm text-slate-400">Demand-only revenue</span>
                    <span className="text-white font-medium">
                      £{assumed.demand_only_revenue.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-700">
                    <span className="text-sm text-slate-400">Competitor-aware revenue</span>
                    <span className="text-indigo-400 font-medium">
                      £{assumed.competitor_aware_revenue.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-400">Revenue lift</span>
                    <span className={`font-medium ${
                      assumed.revenue_lift >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {assumed.revenue_lift >= 0 ? '+' : ''}
                      £{assumed.revenue_lift.toFixed(2)} ({assumed.revenue_lift_pct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
                  Robustness Summary
                </h2>
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-slate-700">
                    <span className="text-sm text-slate-400">Values where CI helps</span>
                    <span className="text-green-400 font-medium">
                      {data.helps_in}/{data.total_tested}{' '}
                      ({((data.helps_in / data.total_tested) * 100).toFixed(0)}%)
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-700">
                    <span className="text-sm text-slate-400">Values where CI hurts</span>
                    <span className="text-red-400 font-medium">
                      {data.hurts_in}/{data.total_tested}{' '}
                      ({((data.hurts_in / data.total_tested) * 100).toFixed(0)}%)
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-700">
                    <span className="text-sm text-slate-400">Best elasticity for CI</span>
                    <span className="text-white font-medium">{data.max_lift.elasticity}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-slate-700">
                    <span className="text-sm text-slate-400">Max revenue lift</span>
                    <span className="text-green-400 font-medium">
                      +£{data.max_lift.revenue_lift.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-slate-400">Min revenue lift</span>
                    <span className={`font-medium ${
                      data.min_lift.revenue_lift >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {data.min_lift.revenue_lift >= 0 ? '+' : ''}
                      £{data.min_lift.revenue_lift.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Dissertation insight */}
          <div className="bg-indigo-950 border border-indigo-700 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <Activity size={22} className="text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-white font-medium mb-2">Research Insight</h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  For{' '}
                  <span className="text-indigo-400 font-medium">{data.product_name}</span>,
                  competitor intelligence improves revenue in{' '}
                  <span className="text-indigo-400 font-medium">
                    {data.helps_in} of {data.total_tested}
                  </span>{' '}
                  elasticity scenarios tested (−0.5 to −3.0). At the dissertation's assumed
                  elasticity of{' '}
                  <span className="text-indigo-400 font-medium">−1.5</span>, the revenue lift
                  is{' '}
                  <span className={`font-medium ${
                    (assumed?.revenue_lift ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {(assumed?.revenue_lift ?? 0) >= 0 ? '+' : ''}
                    £{assumed?.revenue_lift.toFixed(2)} ({assumed?.revenue_lift_pct.toFixed(2)}%)
                  </span>.
                  This sensitivity analysis demonstrates that the competitor intelligence
                  advantage is{' '}
                  <span className="text-indigo-400 font-medium">robust</span> across a wide
                  range of elasticity assumptions, strengthening confidence in the
                  dissertation's findings.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="bg-slate-800 rounded-xl p-12 border border-slate-700 text-center">
          <Activity size={40} className="text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">
            Select a product and store, then click Run Sensitivity Analysis.
          </p>
        </div>
      )}
    </div>
  );
}