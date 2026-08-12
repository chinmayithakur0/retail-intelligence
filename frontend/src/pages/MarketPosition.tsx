import React, { useState, useEffect } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, LabelList
} from 'recharts';
import { Map, AlertCircle, TrendingUp, Award } from 'lucide-react';
import { getStores, getMarketPosition } from '../services/api';
import type { Store, MarketPosition, MarketPlayer } from '../services/api';

const CATEGORY_OPTIONS = [
  { value: 'fresh_food',      label: 'Fresh Food' },
  { value: 'drinks',          label: 'Drinks' },
  { value: 'bakery',          label: 'Bakery' },
  { value: 'frozen',          label: 'Frozen' },
  { value: 'food_cupboard',   label: 'Food Cupboard' },
  { value: 'household',       label: 'Household' },
  { value: 'health_products', label: 'Health Products' },
  { value: 'pets',            label: 'Pets' },
  { value: 'baby_products',   label: 'Baby Products' },
  { value: 'free-from',       label: 'Free From' },
];

const QUADRANT_COLOURS: Record<string, string> = {
  'Value Leader':         '#10b981',
  'Premium':              '#f59e0b',
  'Discount':             '#3b82f6',
  'High Price Low Value': '#f43f5e',
};

const STRATEGY_LABELS: Record<string, string> = {
  'market_leader':      'Market Leader',
  'quality_premium':    'Quality Premium',
  'hard_discounter':    'Hard Discounter',
  'everyday_low_price': 'Everyday Low Price',
  'value_fresh':        'Value Fresh',
  'our_store':          'Our Store',
};

// Custom dot for the scatter chart — larger for our store
const CustomDot = (props: any) => {
  const { cx, cy, payload } = props;
  const size = payload.is_ours ? 18 : 12;
  return (
    <circle
      cx={cx} cy={cy} r={size}
      fill={payload.colour}
      stroke={payload.is_ours ? '#fff' : 'transparent'}
      strokeWidth={payload.is_ours ? 3 : 0}
      opacity={0.9}
    />
  );
};

// Custom tooltip
const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d: MarketPlayer = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-3 text-xs shadow-lg">
      <div className="font-semibold text-white mb-1"
        style={{ color: d.colour }}>{d.name}</div>
      <div className="text-slate-300">Price: £{d.price.toFixed(2)}</div>
      <div className="text-slate-300">Price Index: {d.price_index.toFixed(2)}</div>
      <div className="text-slate-300">Value Score: {d.value_score}</div>
      <div className="text-slate-400 mt-1">{STRATEGY_LABELS[d.strategy]}</div>
      <div className="mt-1 font-medium" style={{ color: QUADRANT_COLOURS[d.quadrant] }}>
        {d.quadrant}
      </div>
    </div>
  );
};

export default function MarketPositionPage() {
  const [stores,   setStores]   = useState<Store[]>([]);
  const [storeId,  setStoreId]  = useState(1);
  const [category, setCategory] = useState('fresh_food');
  const [data,     setData]     = useState<MarketPosition | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    getStores().then(setStores);
  }, []);

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMarketPosition(storeId, category, '2024-06-11');
      setData(result);
    } catch {
      setError('Failed to load market position. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const selectClass =
    "bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 text-sm w-full";

  // Format data for scatter chart — recharts needs x/y fields
  const scatterData = data?.players.map(p => ({
    ...p,
    x: p.price_index,
    y: p.value_score,
  })) ?? [];

  const categoryLabel = CATEGORY_OPTIONS.find(c => c.value === category)?.label ?? category;

  return (
    <div className="p-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Market Position Map</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Where does our store sit relative to Tesco, Sainsbury's, Aldi, Asda and Morrisons?
        </p>
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-6">
        <div className="grid grid-cols-3 gap-4 items-end">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Store</label>
            <select value={storeId} onChange={e => setStoreId(Number(e.target.value))}
              className={selectClass}>
              {stores.length === 0 && <option>Loading…</option>}
              {stores.map(s => (
                <option key={s.store_id} value={s.store_id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Product Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className={selectClass}>
              {CATEGORY_OPTIONS.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleRun}
            disabled={loading || stores.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white
                       px-6 py-2 rounded-lg font-medium transition-colors text-sm"
          >
            {loading ? 'Mapping…' : 'Generate Map'}
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
          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Our Position</div>
              <div className="text-lg font-semibold"
                style={{ color: QUADRANT_COLOURS[data.our_position] ?? '#6366f1' }}>
                {data.our_position}
              </div>
              <div className="text-xs text-slate-500 mt-1">{categoryLabel} category</div>
            </div>
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Market Average</div>
              <div className="text-2xl font-semibold text-white">£{data.market_avg.toFixed(2)}</div>
              <div className="text-xs text-slate-500 mt-1">
                Range: £{data.market_min.toFixed(2)} – £{data.market_max.toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Cheapest</div>
              <div className="text-lg font-semibold text-blue-400">{data.insights.cheapest}</div>
              <div className="text-xs text-slate-500 mt-1">Lowest category price</div>
            </div>
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Best Value Score</div>
              <div className="text-lg font-semibold text-green-400">{data.insights.best_value}</div>
              <div className="text-xs text-slate-500 mt-1">Price + value perception</div>
            </div>
          </div>

          {/* Scatter plot — the market map */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
              Market Position Map — {categoryLabel}
            </h2>
            <p className="text-xs text-slate-500 mb-6">
              X-axis: price index (1.0 = market average). Y-axis: value score (higher = better perceived value).
              Our store shown with white border.
            </p>

            {/* Quadrant labels */}
            <div className="relative">
              <div className="absolute top-0 left-1/2 right-0 text-center">
                <span className="text-xs text-yellow-400 font-medium">PREMIUM ↗</span>
              </div>
              <div className="absolute top-0 left-0 w-1/2 text-center">
                <span className="text-xs text-green-400 font-medium">↖ VALUE LEADER</span>
              </div>
              <div className="absolute bottom-8 left-0 w-1/2 text-center">
                <span className="text-xs text-blue-400 font-medium">↙ DISCOUNT</span>
              </div>
              <div className="absolute bottom-8 left-1/2 right-0 text-center">
                <span className="text-xs text-red-400 font-medium">HIGH PRICE LOW VALUE ↘</span>
              </div>

              <ResponsiveContainer width="100%" height={380}>
                <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Price Index"
                    domain={[0.7, 1.3]}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickFormatter={v => `${v.toFixed(1)}x`}
                    label={{ value: 'Price Index (1.0 = market avg)', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Value Score"
                    domain={[0, 100]}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    label={{ value: 'Value Score', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {/* Reference lines marking the four quadrants */}
                  <ReferenceLine x={1.0} stroke="#475569" strokeDasharray="4 4" />
                  <ReferenceLine y={50}  stroke="#475569" strokeDasharray="4 4" />
                  <Scatter
                    data={scatterData}
                    shape={<CustomDot />}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Player detail cards */}
          <div className="grid grid-cols-6 gap-3 mb-6">
            {data.players.map(p => (
              <div
                key={p.name}
                className={`rounded-xl p-4 border ${p.is_ours ? 'border-indigo-500' : 'border-slate-700'} bg-slate-800`}
                style={{ borderTopColor: p.colour, borderTopWidth: 3 }}
              >
                <div className="text-sm font-semibold mb-1"
                  style={{ color: p.is_ours ? '#a5b4fc' : '#e2e8f0' }}>
                  {p.name}
                </div>
                <div className="text-xs text-slate-500 mb-2">
                  {STRATEGY_LABELS[p.strategy]}
                </div>
                <div className="text-lg font-bold text-white">£{p.price.toFixed(2)}</div>
                <div className="text-xs text-slate-400 mt-1">
                  Index: {p.price_index.toFixed(2)}x
                </div>
                <div className="text-xs mt-1 font-medium"
                  style={{ color: QUADRANT_COLOURS[p.quadrant] }}>
                  {p.quadrant}
                </div>
                {/* Mini value bar */}
                <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${p.value_score}%`, backgroundColor: p.colour }}
                  />
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Value: {p.value_score}
                </div>
              </div>
            ))}
          </div>

          {/* Research insight */}
          <div className="bg-indigo-950 border border-indigo-700 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <Map size={22} className="text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-white font-medium mb-2">Research Insight</h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  In the <span className="text-indigo-400 font-medium">{categoryLabel}</span> category
                  at <span className="text-indigo-400 font-medium">{data.store_name}</span>, our store
                  occupies the{' '}
                  <span className="font-medium" style={{ color: QUADRANT_COLOURS[data.our_position] }}>
                    {data.our_position}
                  </span>{' '}
                  quadrant with a price index of{' '}
                  <span className="text-indigo-400 font-medium">
                    {data.players.find(p => p.is_ours)?.price_index.toFixed(2)}x
                  </span>{' '}
                  the market average (£{data.market_avg.toFixed(2)}).{' '}
                  <span className="text-indigo-400 font-medium">{data.insights.cheapest}</span> leads
                  on price while{' '}
                  <span className="text-indigo-400 font-medium">{data.insights.best_value}</span> leads
                  on value score. This visualises the competitive landscape that the multi-agent
                  pricing system must navigate when making recommendations — directly contextualising
                  the role of competitor intelligence in the dissertation's research question.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div className="bg-slate-800 rounded-xl p-12 border border-slate-700 text-center">
          <Map size={40} className="text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">
            Select a store and category, then click Generate Map.
          </p>
        </div>
      )}
    </div>
  );
}