import React, { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid
} from 'recharts';
import { Sliders, RotateCcw, AlertCircle, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { getProducts, getStores, getScenarioBase, getWeather } from '../services/api';
import type { Product, Store, ScenarioBase, WeatherData } from '../services/api';

const SUPERMARKET_COLOURS: Record<string, string> = {
  Tesco:      '#003d7a',
  Sainsburys: '#ff7700',
  Aldi:       '#00529b',
  Asda:       '#7dc242',
  Morrisons:  '#ffd700',
};

function weatherEmoji(temp: number, rain: number) {
  if (rain > 5)  return '🌧️';
  if (temp > 25) return '☀️';
  if (temp < 5)  return '❄️';
  return '⛅';
}

function simulatePricing(
  base: ScenarioBase,
  competitorShockPct: number,
  demandShockPct: number,
  priceAdjustPct: number,
  weatherShockPct: number
) {
  const elasticity = base.price_elasticity;

  const shockedCompetitors = base.competitors.map(c => ({
    ...c,
    shockedPrice: c.price * (1 + competitorShockPct / 100),
  }));
  const avgCompetitorPrice =
    shockedCompetitors.reduce((sum, c) => sum + c.shockedPrice, 0) / shockedCompetitors.length;

  const shockedBaseDemand = base.base_demand * (1 + demandShockPct / 100) * (1 + weatherShockPct / 100);
  const adjustedBasePrice = base.base_price * (1 + priceAdjustPct / 100);

  const minPrice = adjustedBasePrice * 0.7;
  const maxPrice = adjustedBasePrice * 1.4;
  const step = (maxPrice - minPrice) / 60;

  let bestPrice = adjustedBasePrice;
  let bestRevenue = 0;
  const curve: { price: number; revenue: number; demand: number }[] = [];

  for (let price = minPrice; price <= maxPrice; price += step) {
    const priceChangePct = (price - adjustedBasePrice) / adjustedBasePrice;
    const demandChangePct = elasticity * priceChangePct;
    let adjustedDemand = shockedBaseDemand * (1 + demandChangePct);
    adjustedDemand = Math.max(0, adjustedDemand);
    const compDiff = (avgCompetitorPrice - price) / avgCompetitorPrice;
    adjustedDemand = adjustedDemand * (1 + 0.1 * compDiff);
    const revenue = price * adjustedDemand;
    curve.push({
      price:   Math.round(price * 100) / 100,
      revenue: Math.round(revenue * 100) / 100,
      demand:  Math.round(adjustedDemand * 10) / 10
    });
    if (revenue > bestRevenue) {
      bestRevenue = revenue;
      bestPrice = price;
    }
  }

  const expectedDemandAtBest =
    shockedBaseDemand * (1 + elasticity * (bestPrice - adjustedBasePrice) / adjustedBasePrice);

  return {
    optimalPrice:       Math.round(bestPrice * 100) / 100,
    expectedRevenue:    Math.round(bestRevenue * 100) / 100,
    expectedDemand:     Math.round(expectedDemandAtBest * 10) / 10,
    avgCompetitorPrice: Math.round(avgCompetitorPrice * 100) / 100,
    shockedCompetitors,
    curve,
  };
}

function Slider({
  label, value, min, max, step, unit, onChange, accentColour,
}: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; onChange: (v: number) => void; accentColour: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-slate-300">{label}</span>
        <span className="text-sm font-semibold" style={{ color: accentColour }}>
          {value > 0 ? '+' : ''}{value}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer bg-slate-700"
        style={{
          background: `linear-gradient(to right, ${accentColour} 0%, ${accentColour} ${((value - min) / (max - min)) * 100}%, #334155 ${((value - min) / (max - min)) * 100}%, #334155 100%)`
        }}
      />
      <div className="flex justify-between text-xs text-slate-500 mt-1">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

const PRESETS = [
  { label: 'Default',               competitor: 0,   demand: 0,   price: 0,  weather: 0,  icon: '⚪' },
  { label: 'Aldi Price War',         competitor: -20, demand: 0,   price: 0,  weather: 0,  icon: '🔴' },
  { label: 'Heatwave',              competitor: 0,   demand: 0,   price: 0,  weather: 25, icon: '☀️' },
  { label: 'Rainy Day',             competitor: 0,   demand: 0,   price: 0,  weather: -5, icon: '🌧️' },
  { label: 'Recession Squeeze',     competitor: -10, demand: -25, price: 0,  weather: 0,  icon: '📉' },
  { label: 'Bank Holiday Rush',     competitor: 0,   demand: 15,  price: 0,  weather: 10, icon: '🏖️' },
  { label: 'Premium Repositioning', competitor: 15,  demand: -10, price: 15, weather: 0,  icon: '💎' },
];

export default function ScenarioSimulatorPage() {
  const [products,     setProducts]     = useState<Product[]>([]);
  const [stores,       setStores]       = useState<Store[]>([]);
  const [itemId,       setItemId]       = useState(1);
  const [storeId,      setStoreId]      = useState(1);
  const [base,         setBase]         = useState<ScenarioBase | null>(null);
  const [weather,      setWeather]      = useState<WeatherData | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const [competitorShock, setCompetitorShock] = useState(0);
  const [demandShock,     setDemandShock]     = useState(0);
  const [priceAdjust,     setPriceAdjust]     = useState(0);
  const [weatherShock,    setWeatherShock]    = useState(0);

  useEffect(() => {
    getProducts().then(setProducts);
    getStores().then(setStores);
  }, []);

  const loadBase = async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, weatherResult] = await Promise.all([
        getScenarioBase(storeId, itemId, '2024-06-11'),
        getWeather('fresh_food').catch(() => null),
      ]);
      setBase(result);
      setWeather(weatherResult);
      if (weatherResult) {
        setWeatherShock(Math.round((weatherResult.multiplier - 1) * 100));
      }
      setCompetitorShock(0);
      setDemandShock(0);
      setPriceAdjust(0);
    } catch {
      setError('Failed to load scenario data. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const simulation = useMemo(() => {
    if (!base) return null;
    return simulatePricing(base, competitorShock, demandShock, priceAdjust, weatherShock);
  }, [base, competitorShock, demandShock, priceAdjust, weatherShock]);

  const baseline = useMemo(() => {
    if (!base) return null;
    return simulatePricing(base, 0, 0, 0, 0);
  }, [base]);

  const handleReset = () => {
    setCompetitorShock(0);
    setDemandShock(0);
    setPriceAdjust(0);
    setWeatherShock(weather ? Math.round((weather.multiplier - 1) * 100) : 0);
  };

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setCompetitorShock(preset.competitor);
    setDemandShock(preset.demand);
    setPriceAdjust(preset.price);
    setWeatherShock(preset.weather);
  };

  const revenueDiff = simulation && baseline
    ? simulation.expectedRevenue - baseline.expectedRevenue : 0;
  const revenueDiffPct = baseline && baseline.expectedRevenue > 0
    ? (revenueDiff / baseline.expectedRevenue) * 100 : 0;

  const selectClass =
    "bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 text-sm w-full";

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Scenario Simulator</h1>
        <p className="text-slate-400 mt-1 text-sm">
          Drag the sliders to test how the pricing engine responds to market shocks — live, no waiting.
        </p>
      </div>

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
            onClick={loadBase}
            disabled={loading || products.length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white
                       px-6 py-2 rounded-lg font-medium transition-colors text-sm"
          >
            {loading ? 'Loading…' : 'Load Simulator'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 mb-6 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-400 shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Live weather banner */}
      {weather && base && (
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-6">
          <div className="flex items-center gap-4">
            <span className="text-2xl">{weatherEmoji(weather.temperature_c, weather.precipitation_mm)}</span>
            <div>
              <div className="text-white font-semibold text-sm">
                Today: {weather.temperature_c}°C
                {weather.precipitation_mm > 0.5 && ` · ${weather.precipitation_mm}mm rain`}
                {' · '}{weather.season}
                {weather.is_bank_holiday && ' · 🏖️ Bank Holiday'}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Live weather pre-loaded into Weather Demand Shock slider below
              </div>
            </div>
            <div className={`ml-auto text-sm font-semibold ${
              weather.multiplier > 1 ? 'text-green-400' :
              weather.multiplier < 1 ? 'text-red-400' : 'text-slate-400'
            }`}>
              {weather.multiplier > 1 ? '↑' : '↓'}{' '}
              {weather.multiplier > 1 ? '+' : ''}
              {((weather.multiplier - 1) * 100).toFixed(1)}% demand from weather
            </div>
          </div>
        </div>
      )}

      {base && simulation && baseline && (
        <>
          {/* Presets */}
          <div className="flex gap-2 mb-6 flex-wrap">
            {PRESETS.map(preset => (
              <button
                key={preset.label}
                onClick={() => applyPreset(preset)}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700
                           text-slate-300 px-3 py-1.5 rounded-full text-xs transition-colors"
              >
                <span>{preset.icon}</span>
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-6 mb-6">
            {/* Sliders panel */}
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Sliders size={16} className="text-indigo-400" />
                  <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                    Scenario Controls
                  </h2>
                </div>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-white transition-colors"
                >
                  <RotateCcw size={12} /> Reset
                </button>
              </div>

              <div className="space-y-6">
                <Slider
                  label="Competitor Price Shock"
                  value={competitorShock} min={-30} max={30} step={1} unit="%"
                  onChange={setCompetitorShock} accentColour="#f59e0b"
                />
                <Slider
                  label="Demand Shock"
                  value={demandShock} min={-50} max={100} step={5} unit="%"
                  onChange={setDemandShock} accentColour="#06b6d4"
                />
                <Slider
                  label="Your Base Price Adjustment"
                  value={priceAdjust} min={-20} max={20} step={1} unit="%"
                  onChange={setPriceAdjust} accentColour="#8b5cf6"
                />
                <div className="pt-2 border-t border-slate-700">
                  <Slider
                    label={`Weather Demand Shock ${weather ? `(live: ${weather.temperature_c}°C)` : ''}`}
                    value={weatherShock} min={-30} max={40} step={1} unit="%"
                    onChange={setWeatherShock} accentColour="#f97316"
                  />
                  <div className="text-xs text-slate-600 mt-1">
                    Pre-filled from today's Open-Meteo weather data
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-700">
                <p className="text-xs text-slate-500 leading-relaxed">
                  Simulating: <span className="text-white">{base.product_name}</span> at{' '}
                  <span className="text-white">{base.store_name}</span>. Elasticity: {base.price_elasticity}.
                </p>
              </div>
            </div>

            {/* Live results panel */}
            <div className="col-span-2 grid grid-cols-2 gap-4">
              <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Optimal Price</div>
                <div className="text-3xl font-bold text-indigo-400">£{simulation.optimalPrice.toFixed(2)}</div>
                <div className="text-xs text-slate-500 mt-1">Baseline: £{baseline.optimalPrice.toFixed(2)}</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Expected Demand</div>
                <div className="text-3xl font-bold text-white">{simulation.expectedDemand.toFixed(0)}</div>
                <div className="text-xs text-slate-500 mt-1">units (baseline: {baseline.expectedDemand.toFixed(0)})</div>
              </div>
              <div className="bg-slate-800 rounded-xl p-5 border border-slate-700 col-span-2">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-2">Expected Revenue vs Baseline</div>
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-bold text-green-400">£{simulation.expectedRevenue.toFixed(2)}</span>
                  <span className={`flex items-center gap-1 text-sm font-medium ${
                    revenueDiff >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {revenueDiff >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {revenueDiff >= 0 ? '+' : ''}£{revenueDiff.toFixed(2)} ({revenueDiffPct >= 0 ? '+' : ''}{revenueDiffPct.toFixed(1)}%)
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  vs no-shock baseline of £{baseline.expectedRevenue.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Revenue curve */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
              Revenue Curve — Live Simulation
            </h2>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={simulation.curve}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="price" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `£${v}`} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={v => `£${v}`} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={(v: any) => [`£${Number(v).toFixed(2)}`, 'Revenue']}
                  labelFormatter={l => `Price: £${l}`}
                />
                <ReferenceLine
                  x={simulation.optimalPrice} stroke="#6366f1" strokeDasharray="6 3"
                  label={{ value: 'optimal', position: 'top', fill: '#6366f1', fontSize: 10 }}
                />
                <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Competitor prices */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
              Competitor Prices Under Shock ({competitorShock > 0 ? '+' : ''}{competitorShock}%)
            </h2>
            <div className="grid grid-cols-5 gap-3">
              {simulation.shockedCompetitors.map(c => (
                <div
                  key={c.supermarket}
                  className="bg-slate-700 rounded-lg p-3 border-t-2"
                  style={{ borderTopColor: SUPERMARKET_COLOURS[c.supermarket] ?? '#6366f1' }}
                >
                  <div className="text-xs text-slate-400 mb-1">{c.supermarket}</div>
                  <div className="text-sm font-semibold text-white">£{c.shockedPrice.toFixed(2)}</div>
                  <div className="text-xs text-slate-500">was £{c.price.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Insight box */}
          <div className="bg-indigo-950 border border-indigo-700 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <Zap size={22} className="text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-white font-medium mb-2">Scenario Outcome</h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Under this scenario — competitor prices shifted{' '}
                  <span className="text-indigo-400 font-medium">{competitorShock > 0 ? '+' : ''}{competitorShock}%</span>,
                  demand shocked{' '}
                  <span className="text-indigo-400 font-medium">{demandShock > 0 ? '+' : ''}{demandShock}%</span>,
                  weather demand adjustment{' '}
                  <span className="text-orange-400 font-medium">{weatherShock > 0 ? '+' : ''}{weatherShock}%</span>,
                  base price adjusted{' '}
                  <span className="text-indigo-400 font-medium">{priceAdjust > 0 ? '+' : ''}{priceAdjust}%</span>{' '}
                  — the system recommends{' '}
                  <span className="text-indigo-400 font-medium">£{simulation.optimalPrice.toFixed(2)}</span>,{' '}
                  a {simulation.optimalPrice >= baseline.optimalPrice ? 'increase' : 'decrease'} from the
                  £{baseline.optimalPrice.toFixed(2)} baseline. This results in a{' '}
                  <span className={`font-medium ${revenueDiff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {revenueDiff >= 0 ? '+' : ''}£{revenueDiff.toFixed(2)} ({revenueDiffPct.toFixed(1)}%)
                  </span>{' '}
                  change in expected revenue.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {!base && !loading && !error && (
        <div className="bg-slate-800 rounded-xl p-12 border border-slate-700 text-center">
          <Sliders size={40} className="text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">
            Select a product and store, then click Load Simulator to start testing scenarios.
          </p>
        </div>
      )}
    </div>
  );
}