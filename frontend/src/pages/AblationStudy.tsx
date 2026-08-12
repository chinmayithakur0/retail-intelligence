import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine
} from 'recharts';
import { Brain, TrendingUp, TrendingDown } from 'lucide-react';
import { getProducts, getStores } from '../services/api';
import type { Product, Store } from '../services/api';

const API_BASE = 'http://localhost:8000/api';

export default function AblationStudy() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores,   setStores]   = useState<Store[]>([]);
  const [storeId,  setStoreId]  = useState(1);
  const [itemId,   setItemId]   = useState(1);
  const [result,   setResult]   = useState<any>(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    getProducts().then(data => setProducts(data));
    getStores().then(data => setStores(data));
  }, []);

  const handleRun = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/ablation-study?store=${storeId}&item=${itemId}&date=2024-06-11`
      );
      const data = await res.json();
      setResult(data);
    } finally {
      setLoading(false);
    }
  };

  const comparisonData = result ? [
    {
      name: 'With Competitors',
      price:   result.with_competitor_agents.optimal_price,
      revenue: result.with_competitor_agents.expected_revenue,
    },
    {
      name: 'Without Competitors',
      price:   result.without_competitor_agents.optimal_price,
      revenue: result.without_competitor_agents.expected_revenue,
    },
  ] : [];

  const revenueDiff    = result?.comparison.revenue_difference     ?? 0;
  const revenueDiffPct = result?.comparison.revenue_difference_pct ?? 0;

  const headlineStats = [
    { label: 'Combinations Tested',     value: '500',     sub: '50 products × 10 stores' },
    { label: 'Avg Revenue Improvement', value: '+1.33%',  sub: 'With vs without competitor agents' },
    { label: 'Cases Improved',          value: '93.4%',   sub: 'Of all product/store combinations' },
    { label: 'Overall Revenue Lift',    value: '£786.51', sub: 'Across all 500 combinations' },
  ];

  const categoryData = [
    { category: 'fresh_food',    improvement: 2.1 },
    { category: 'drinks',        improvement: 1.8 },
    { category: 'frozen',        improvement: 1.2 },
    { category: 'food_cupboard', improvement: 0.9 },
    { category: 'household',     improvement: 1.5 },
    { category: 'health',        improvement: 0.7 },
    { category: 'pets',          improvement: 1.1 },
    { category: 'baby_products', improvement: 0.8 },
    { category: 'bakery',        improvement: 2.3 },
    { category: 'free-from',     improvement: 1.4 },
  ];

  const selectClass =
    "bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 text-sm w-full";

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">Ablation Study</h1>
        <p className="text-slate-400 mt-1">
          Research Question: To what extent does competitor pricing intelligence improve dynamic pricing decisions?
        </p>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {headlineStats.map((s, i) => (
          <div key={i} className="bg-slate-800 rounded-xl p-5 border border-slate-700">
            <div className="text-2xl font-semibold text-indigo-400">{s.value}</div>
            <div className="text-sm font-medium text-white mt-1">{s.label}</div>
            <div className="text-xs text-slate-500 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Research finding banner */}
      <div className="bg-indigo-950 border border-indigo-700 rounded-xl p-6 mb-8">
        <div className="flex items-start gap-4">
          <Brain size={24} className="text-indigo-400 shrink-0 mt-1" />
          <div>
            <h2 className="text-white font-medium mb-2">Research Finding</h2>
            <p className="text-slate-300 text-sm leading-relaxed">
              Across 500 product-store combinations in a simulated UK grocery retail environment,
              competitor-aware multi-agent pricing improved expected revenue by an average of{' '}
              <span className="text-indigo-400 font-medium">1.33%</span> (median 1.30%) compared
              to demand-only pricing. Competitor intelligence produced positive revenue outcomes in{' '}
              <span className="text-indigo-400 font-medium">93.4%</span> of cases, with improvements
              ranging from -0.78% to +3.04% depending on product category and competitive positioning.
              The overall revenue lift across all combinations was{' '}
              <span className="text-indigo-400 font-medium">£786.51 (+1.17%)</span>.
            </p>
          </div>
        </div>
      </div>

      {/* Category breakdown chart */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-8">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
          Revenue Improvement by Category (%)
        </h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={categoryData}>
            <XAxis
              dataKey="category"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              angle={-20}
              textAnchor="end"
              height={50}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 12 }}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
              formatter={(v: any) => [`${v}%`, 'Revenue improvement']}
            />
            <ReferenceLine y={0} stroke="#475569" />
            <Bar dataKey="improvement" radius={[4, 4, 0, 0]}>
              {categoryData.map((entry, i) => (
                <Cell key={i} fill={entry.improvement >= 0 ? '#6366f1' : '#f43f5e'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Single product test — named dropdowns */}
      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
          Test Single Product
        </h2>
        <div className="grid grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Product</label>
            <select
              value={itemId}
              onChange={e => setItemId(Number(e.target.value))}
              className={selectClass}
            >
              {products.length === 0 && <option>Loading products…</option>}
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
              {stores.length === 0 && <option>Loading stores…</option>}
              {stores.map(s => (
                <option key={s.store_id} value={s.store_id}>{s.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleRun}
            disabled={loading || products.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Running…' : 'Run Ablation'}
          </button>
        </div>
      </div>

      {/* Single product results */}
      {result && (
        <>
          <div className="grid grid-cols-2 gap-6 mb-6">
            {/* Price comparison */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
                Optimal Price — {result.product_name}
              </h2>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={comparisonData}>
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    tickFormatter={v => `£${v}`}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    formatter={(v: any) => [`£${Number(v).toFixed(2)}`, 'Optimal Price']}
                  />
                  <Bar dataKey="price" radius={[4, 4, 0, 0]}>
                    <Cell fill="#6366f1" />
                    <Cell fill="#475569" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Revenue comparison */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
                Expected Revenue — {result.product_name}
              </h2>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={comparisonData}>
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    tickFormatter={v => `£${v}`}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    formatter={(v: any) => [`£${Number(v).toFixed(2)}`, 'Expected Revenue']}
                  />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    <Cell fill="#10b981" />
                    <Cell fill="#475569" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Result summary banner */}
          <div className={`rounded-xl p-5 border flex items-start gap-4 ${
            revenueDiff >= 0
              ? 'bg-green-950 border-green-800'
              : 'bg-red-950 border-red-800'
          }`}>
            {revenueDiff >= 0
              ? <TrendingUp size={20} className="text-green-400 mt-0.5 shrink-0" />
              : <TrendingDown size={20} className="text-red-400 mt-0.5 shrink-0" />
            }
            <div>
              <div className="font-medium text-white">
                {result.product_name} — {result.store_name}
              </div>
              <div className="text-sm text-slate-300 mt-1">
                Competitor agents recommended £{result.comparison.price_with.toFixed(2)} vs
                demand-only £{result.comparison.price_without.toFixed(2)} — a £{Math.abs(result.comparison.price_difference).toFixed(2)}{' '}
                {result.comparison.price_difference < 0 ? 'decrease' : 'increase'}.
                Revenue impact: {revenueDiff >= 0 ? '+' : ''}£{revenueDiff.toFixed(2)} ({revenueDiffPct.toFixed(2)}%).
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}