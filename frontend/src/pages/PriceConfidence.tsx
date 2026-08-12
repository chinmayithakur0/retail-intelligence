import React, { useState, useEffect } from 'react';
import { ShieldCheck, AlertCircle, TrendingUp, TrendingDown, Database, Scale, Activity } from 'lucide-react';
import { getProducts, getStores, getPriceConfidence } from '../services/api';
import type { Product, Store, PriceConfidence } from '../services/api';

const FACTOR_ICONS: Record<string, React.ReactNode> = {
  data_depth:  <Database size={16} />,
  agreement:   <Scale size={16} />,
  volatility:  <Activity size={16} />,
};

function ConfidenceRing({ score, label }: { score: number; label: string }) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const colour =
    score >= 70 ? '#10b981' :
    score >= 40 ? '#f59e0b' :
                  '#f43f5e';

  return (
    <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
      <svg width="180" height="180" className="-rotate-90">
        <circle cx="90" cy="90" r={radius} fill="none" stroke="#334155" strokeWidth="12" />
        <circle
          cx="90" cy="90" r={radius} fill="none"
          stroke={colour} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <div className="text-4xl font-bold text-white">{score}%</div>
        <div className="text-xs mt-1 font-medium" style={{ color: colour }}>{label}</div>
      </div>
    </div>
  );
}

function FactorBar({ factorKey, score, label, explanation, weight }: {
  factorKey: string; score: number; label: string; explanation: string; weight: number;
}) {
  const colour =
    score >= 70 ? '#10b981' :
    score >= 40 ? '#f59e0b' :
                  '#f43f5e';

  return (
    <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-slate-300">
          {FACTOR_ICONS[factorKey]}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="text-xs text-slate-500">weight: {(weight * 100).toFixed(0)}%</span>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${score}%`, backgroundColor: colour }}
          />
        </div>
        <span className="text-sm font-semibold text-white w-12 text-right">{score}%</span>
      </div>
      <p className="text-xs text-slate-500">{explanation}</p>
    </div>
  );
}

export default function PriceConfidencePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores,   setStores]   = useState<Store[]>([]);
  const [itemId,   setItemId]   = useState(1);
  const [storeId,  setStoreId]  = useState(1);
  const [data,     setData]     = useState<PriceConfidence | null>(null);
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
      const result = await getPriceConfidence(storeId, itemId, '2024-06-11');
      setData(result);
    } catch {
      setError('Failed to calculate price confidence. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const selectClass =
    "bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 text-sm w-full";

  return (
    <div className="p-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Price Confidence Score</h1>
        <p className="text-slate-400 mt-1 text-sm">
          How much should you trust the recommended price? A blended score from data depth, method agreement, and demand stability.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-6">
        <div className="grid grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Product</label>
            <select value={itemId} onChange={e => setItemId(Number(e.target.value))} className={selectClass}>
              {products.length === 0 && <option>Loading…</option>}
              {products.map(p => (
                <option key={p.item_id} value={p.item_id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Store</label>
            <select value={storeId} onChange={e => setStoreId(Number(e.target.value))} className={selectClass}>
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
            {loading ? 'Calculating…' : 'Calculate Confidence'}
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
          {/* Main confidence ring + recommended price */}
          <div className="bg-slate-800 rounded-xl p-8 border border-slate-700 mb-6">
            <div className="flex items-center gap-10">
              <ConfidenceRing score={data.confidence_score} label={data.confidence_label} />
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck size={20} className="text-indigo-400" />
                  <h2 className="text-lg font-semibold text-white">
                    {data.product_name} — {data.store_name}
                  </h2>
                </div>
                <p className="text-sm text-slate-400 mb-4">{data.category}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-white">
                    £{data.recommended_price.toFixed(2)}
                  </span>
                  <span className="text-sm text-slate-400">recommended price</span>
                </div>
                <p className="text-sm text-slate-400 mt-3 leading-relaxed">
                  This recommendation has a{' '}
                  <span className={`font-medium ${
                    data.confidence_label === 'HIGH'   ? 'text-green-400' :
                    data.confidence_label === 'MEDIUM' ? 'text-yellow-400' :
                                                          'text-red-400'
                  }`}>
                    {data.confidence_label.toLowerCase()}
                  </span>{' '}
                  confidence score of <span className="text-white font-medium">{data.confidence_score}%</span>,
                  based on data depth, method agreement, and demand stability.
                </p>
              </div>
            </div>
          </div>

          {/* Factor breakdown */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <FactorBar
              factorKey="data_depth"
              score={data.factors.data_depth.score}
              label={data.factors.data_depth.label}
              explanation={data.factors.data_depth.explanation}
              weight={data.weights.data_depth}
            />
            <FactorBar
              factorKey="agreement"
              score={data.factors.agreement.score}
              label={data.factors.agreement.label}
              explanation={data.factors.agreement.explanation}
              weight={data.weights.agreement}
            />
            <FactorBar
              factorKey="volatility"
              score={data.factors.volatility.score}
              label={data.factors.volatility.label}
              explanation={data.factors.volatility.explanation}
              weight={data.weights.volatility}
            />
          </div>

          {/* Method comparison detail */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
              Method Agreement Detail
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-700 rounded-lg p-4">
                <div className="text-xs text-slate-400 mb-1">Competitor-Aware Price</div>
                <div className="text-xl font-semibold text-indigo-400">
                  £{data.factors.agreement.price_with.toFixed(2)}
                </div>
              </div>
              <div className="bg-slate-700 rounded-lg p-4">
                <div className="text-xs text-slate-400 mb-1">Demand-Only Price</div>
                <div className="text-xl font-semibold text-white">
                  £{data.factors.agreement.price_without.toFixed(2)}
                </div>
              </div>
              <div className="bg-slate-700 rounded-lg p-4">
                <div className="text-xs text-slate-400 mb-1">Price Gap</div>
                <div className={`text-xl font-semibold flex items-center gap-1 ${
                  data.factors.agreement.price_gap_pct > 10 ? 'text-red-400' : 'text-green-400'
                }`}>
                  {data.factors.agreement.price_gap_pct > 10
                    ? <TrendingUp size={18} />
                    : <TrendingDown size={18} />}
                  {data.factors.agreement.price_gap_pct.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          {/* Data depth detail */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
              Sales History Available
            </h2>
            <div className="flex items-center gap-4">
              <Database size={28} className="text-indigo-400 shrink-0" />
              <div>
                <div className="text-2xl font-semibold text-white">
                  {data.factors.data_depth.record_count.toLocaleString()} records
                </div>
                <div className="text-sm text-slate-400 mt-1">
                  {data.factors.data_depth.record_count >= 365
                    ? 'Full year of historical sales data available — high reliability.'
                    : data.factors.data_depth.record_count >= 90
                    ? 'Several months of data available — reasonable reliability.'
                    : 'Limited historical data — recommendation should be treated cautiously.'}
                </div>
              </div>
            </div>
          </div>

          {/* Dissertation insight */}
          <div className="bg-indigo-950 border border-indigo-700 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <ShieldCheck size={22} className="text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-white font-medium mb-2">Research Insight</h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  The Price Confidence Score provides a transparent, auditable measure of how
                  much trust should be placed in any given pricing recommendation — addressing
                  a key limitation of black-box pricing systems. For{' '}
                  <span className="text-indigo-400 font-medium">{data.product_name}</span> at{' '}
                  <span className="text-indigo-400 font-medium">{data.store_name}</span>, the
                  system reports{' '}
                  <span className={`font-medium ${
                    data.confidence_label === 'HIGH'   ? 'text-green-400' :
                    data.confidence_label === 'MEDIUM' ? 'text-yellow-400' :
                                                          'text-red-400'
                  }`}>
                    {data.confidence_label}
                  </span>{' '}
                  confidence ({data.confidence_score}%), driven primarily by{' '}
                  {data.factors.data_depth.score === Math.max(
                    data.factors.data_depth.score,
                    data.factors.agreement.score,
                    data.factors.volatility.score
                  ) ? 'available sales history depth' :
                    data.factors.agreement.score === Math.max(
                      data.factors.data_depth.score,
                      data.factors.agreement.score,
                      data.factors.volatility.score
                    ) ? 'agreement between pricing methods' : 'demand stability'}.
                  This score can be used to flag low-confidence recommendations for manual
                  review rather than fully automated deployment.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="bg-slate-800 rounded-xl p-12 border border-slate-700 text-center">
          <ShieldCheck size={40} className="text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">
            Select a product and store, then click Calculate Confidence.
          </p>
        </div>
      )}
    </div>
  );
}