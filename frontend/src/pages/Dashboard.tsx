import React, { useEffect, useState } from 'react';
import {
  getProducts, getStores, quickPredict,
  getLivePrices, quickPredictWithLivePrice
} from '../services/api';
import type { QuickPredictResult, LivePricesResult } from '../services/api';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { TrendingUp, Package, DollarSign, AlertTriangle } from 'lucide-react';

interface DashboardProps {
  selectedItem:  number;
  selectedStore: number;
  onItemChange:  (id: number) => void;
  onStoreChange: (id: number) => void;
}

export default function Dashboard({
  selectedItem,
  selectedStore,
  onItemChange,
  onStoreChange,
}: DashboardProps) {
  const [products,      setProducts]      = useState<any[]>([]);
  const [stores,        setStores]        = useState<any[]>([]);
  const [result,        setResult]        = useState<QuickPredictResult | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [livePrices,    setLivePrices]    = useState<LivePricesResult | null>(null);
  const [liveLoading,   setLiveLoading]   = useState(false);
  const [liveUpdated,   setLiveUpdated]   = useState(false);
  const [sainsburysPrice, setSainsburysPrice] = useState<number | null>(null);

  useEffect(() => {
    getProducts().then(setProducts).catch(console.error);
    getStores().then(setStores).catch(console.error);
  }, []);

  const handleAnalyse = async () => {
    setLoading(true);
    setLivePrices(null);
    setLiveUpdated(false);
    setSainsburysPrice(null);
    try {
      // Step 1: Get initial prediction
      const data = await quickPredict(selectedStore, selectedItem, '2024-06-11');
      setResult(data);

      // Step 2: Automatically fetch live prices
      const live = await getLivePrices(data.product_name, data.category);
      setLivePrices(live);

      // Step 3: Build live price map
      const livePriceMap: { [key: string]: number } = {};
      live.live_prices.forEach(p => {
        if (p.is_live && p.price !== null) {
          livePriceMap[p.supermarket] = p.price;
        }
      });

      // Step 4: Re-run prediction with live prices
      if (Object.keys(livePriceMap).length > 0) {
        const updatedResult = await quickPredictWithLivePrice(
          selectedStore,
          selectedItem,
          '2024-06-11',
          livePriceMap
        );
        setResult(updatedResult);
        setLiveUpdated(true);
        setSainsburysPrice(Object.values(livePriceMap)[0]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLivePrices = async () => {
    if (!result) return;
    setLiveLoading(true);
    try {
      const live = await getLivePrices(result.product_name, result.category);
      setLivePrices(live);

      const livePriceMap: { [key: string]: number } = {};
      live.live_prices.forEach(p => {
        if (p.is_live && p.price !== null) {
          livePriceMap[p.supermarket] = p.price;
        }
      });

      if (Object.keys(livePriceMap).length > 0) {
        const updatedResult = await quickPredictWithLivePrice(
          selectedStore,
          selectedItem,
          '2024-06-11',
          livePriceMap
        );
        setResult(updatedResult);
        setLiveUpdated(true);
        setSainsburysPrice(Object.values(livePriceMap)[0]);
      }
    } finally {
      setLiveLoading(false);
    }
  };

  const statusColor = (status: string) => {
    if (status === 'OPTIMAL')   return 'text-green-400';
    if (status === 'UNDERSTOCK' || status === 'LOW_STOCK') return 'text-red-400';
    if (status === 'OVERSTOCK') return 'text-yellow-400';
    return 'text-slate-400';
  };

  const competitorColors = ['#6366f1','#22d3ee','#f59e0b','#10b981','#f43f5e'];

  const weatherEmoji = (weather: any) => {
    if (!weather) return '⛅';
    if (weather.precipitation_mm > 5) return '🌧️';
    if (weather.temperature_c > 25)   return '☀️';
    if (weather.temperature_c < 5)    return '❄️';
    return '⛅';
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">
          Retail Intelligence Dashboard
        </h1>
        <p className="text-slate-400 mt-1">
          Multi-Agent AI System — Dynamic Pricing & Demand Forecasting
        </p>
      </div>

      {/* Controls */}
      <div className="bg-slate-800 rounded-xl p-6 mb-6 border border-slate-700">
        <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
          Select Product & Store
        </h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <select
            className="bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600"
            value={selectedItem}
            onChange={e => onItemChange(Number(e.target.value))}
          >
            {products.map(p => (
              <option key={p.item_id} value={p.item_id}>{p.name}</option>
            ))}
          </select>
          <select
            className="bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600"
            value={selectedStore}
            onChange={e => onStoreChange(Number(e.target.value))}
          >
            {stores.map(s => (
              <option key={s.store_id} value={s.store_id}>{s.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleAnalyse}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50
                     text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          {loading ? 'Analysing + Fetching Live Prices...' : 'Analyse'}
        </button>
        <p className="text-xs text-slate-500 mt-2 text-center">
          📄 Export PDF will use the currently selected product and store
        </p>
      </div>

      {result && (
        <>
          {/* Live updated banner */}
          {liveUpdated && livePrices && (
            <div className="bg-slate-800 border border-green-700 rounded-xl p-3 mb-4
                            flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-green-400 text-xs">●</span>
                <p className="text-green-300 text-xs">
                  Live prices active system-wide — all pages now use Trolley.co.uk prices
                  for {livePrices.live_prices.filter(p => p.is_live).map(p => p.supermarket).join(', ')}
                </p>
              </div>
              <span className="text-slate-500 text-xs">5 min cache</span>
            </div>
          )}

          {/* Weather Banner */}
          {result.weather && (
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{weatherEmoji(result.weather)}</span>
                    <div>
                      <div className="text-white font-semibold text-sm">
                        {result.weather.temperature_c}°C
                        {result.weather.precipitation_mm > 0.5 &&
                          ` · ${result.weather.precipitation_mm}mm rain`}
                      </div>
                      <div className="text-xs text-slate-400 capitalize">
                        {result.weather.season}
                        {result.weather.is_bank_holiday && ' · 🏖️ Bank Holiday'}
                        {result.weather.is_weekend && !result.weather.is_bank_holiday && ' · Weekend'}
                      </div>
                    </div>
                  </div>

                  <div className="h-8 w-px bg-slate-700" />

                  <div>
                    <div className={`text-sm font-semibold ${
                      result.weather.multiplier > 1 ? 'text-green-400' :
                      result.weather.multiplier < 1 ? 'text-red-400' : 'text-slate-400'
                    }`}>
                      {result.weather.multiplier > 1 ? '↑' :
                       result.weather.multiplier < 1 ? '↓' : '→'}{' '}
                      {result.weather.multiplier > 1 ? '+' : ''}
                      {((result.weather.multiplier - 1) * 100).toFixed(1)}% demand
                    </div>
                    <div className="text-xs text-slate-500">weather adjustment</div>
                  </div>

                  <div className="h-8 w-px bg-slate-700" />

                  <div>
                    <div className="text-sm text-slate-300">
                      <span className="text-slate-500">Original: </span>
                      {(result.demand as any).predicted_units_original?.toFixed(0)
                        ?? result.demand.predicted_units.toFixed(0)} units
                      <span className="text-slate-500 mx-1">→</span>
                      <span className="text-white font-semibold">
                        {result.demand.predicted_units.toFixed(0)} units
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">after weather adjustment</div>
                  </div>
                </div>

                <div className="text-xs text-slate-600 text-right">
                  <div>{result.weather.data_source}</div>
                  <div className="text-slate-700 mt-0.5">
                    {result.weather.temp_effect !== 0 && `temp: ${result.weather.temp_effect > 0 ? '+' : ''}${(result.weather.temp_effect * 100).toFixed(1)}%`}
                    {result.weather.rain_effect !== 0 && ` rain: ${result.weather.rain_effect > 0 ? '+' : ''}${(result.weather.rain_effect * 100).toFixed(1)}%`}
                    {result.weather.event_effect !== 0 && ` event: +${(result.weather.event_effect * 100).toFixed(1)}%`}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Stat Cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">

            {/* Predicted Demand */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp size={18} className="text-indigo-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wide">
                  Predicted Demand
                </span>
              </div>
              <div className="text-2xl font-semibold text-white">
                {result.demand.predicted_units.toFixed(0)} units
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {result.demand.day_of_week}
                {result.weather && result.weather.multiplier !== 1 && (
                  <span className={`ml-2 ${result.weather.multiplier > 1 ? 'text-green-400' : 'text-red-400'}`}>
                    {result.weather.multiplier > 1 ? '↑' : '↓'} weather adjusted
                  </span>
                )}
              </div>
            </div>

            {/* Recommended Price */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={18} className="text-green-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wide">
                  Recommended Price
                </span>
                {liveUpdated && (
                  <span className="text-xs bg-green-800 text-green-300
                                   px-2 py-0.5 rounded-full font-medium">
                    ● Live
                  </span>
                )}
              </div>
              <div className="text-2xl font-semibold text-white">
                £{result.pricing.optimal_price.toFixed(2)}
              </div>
              <div className="text-xs mt-1">
                {result.pricing.optimal_price > result.pricing.base_price && (
                  <span className="text-green-400">
                    ↑ £{(result.pricing.optimal_price - result.pricing.base_price).toFixed(2)} increase
                  </span>
                )}
                {result.pricing.optimal_price < result.pricing.base_price && (
                  <span className="text-red-400">
                    ↓ £{(result.pricing.base_price - result.pricing.optimal_price).toFixed(2)} decrease
                  </span>
                )}
                {result.pricing.optimal_price === result.pricing.base_price && (
                  <span className="text-slate-400">No change recommended</span>
                )}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Base: £{result.pricing.base_price.toFixed(2)} · Avg competitor: £{result.pricing.avg_competitor_price.toFixed(2)}
              </div>
            </div>

            {/* Expected Revenue */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={18} className="text-yellow-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wide">
                  Expected Revenue
                </span>
                {liveUpdated && (
                  <span className="text-xs bg-green-800 text-green-300
                                   px-2 py-0.5 rounded-full font-medium">
                    ● Live
                  </span>
                )}
              </div>
              <div className="text-2xl font-semibold text-white">
                £{result.pricing.expected_revenue.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                At recommended price
              </div>
            </div>

            {/* Inventory Status */}
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="flex items-center gap-3 mb-2">
                <Package size={18} className="text-red-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wide">
                  Inventory Status
                </span>
              </div>
              <div className={`text-2xl font-semibold ${statusColor(result.inventory.status)}`}>
                {result.inventory.status}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {result.inventory.days_of_stock.toFixed(1)} days remaining
              </div>
              <div className="text-xs text-slate-400 mt-1">
                {result.stock_info?.current_stock?.toLocaleString()} units in stock
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                Sold last 30 days: {result.stock_info?.sold_last_30?.toLocaleString()} units
              </div>
            </div>

          </div>

          {/* Competitor Chart */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
              Competitor Price Comparison — {result.product_name}
            </h2>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={result.competitors}>
                <XAxis dataKey="supermarket" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={v => `£${v}`} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={(v: any) => [`£${Number(v).toFixed(2)}`, 'Price']}
                />
                <Bar dataKey="price" radius={[4, 4, 0, 0]}>
                  {result.competitors.map((_, i) => (
                    <Cell key={i} fill={competitorColors[i % competitorColors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Live Prices Section */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                  Live Market Prices
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Scraped live from Trolley.co.uk · Others: Jan–Apr 2024 dataset
                </p>
              </div>
              <button
                onClick={handleLivePrices}
                disabled={liveLoading}
                className="flex items-center gap-2 bg-green-700 hover:bg-green-600
                           disabled:opacity-50 text-white px-4 py-1.5 rounded-lg
                           text-xs font-medium transition-colors"
              >
                {liveLoading ? '⏳ Refreshing...' : '🔄 Refresh Live Prices'}
              </button>
            </div>

            {livePrices && livePrices.status === 'ok' && (
              <>
                <div className="grid grid-cols-5 gap-3 mb-4">
                  {livePrices.live_prices.map((p, i) => (
                    <div
                      key={i}
                      className={`rounded-lg p-3 border ${
                        p.is_live
                          ? 'bg-green-950 border-green-800'
                          : 'bg-slate-700 border-slate-600'
                      }`}
                    >
                      <div
                        className="text-xs font-medium mb-1"
                        style={{ color: p.is_live ? '#4ade80' : '#94a3b8' }}
                      >
                        {p.supermarket}
                      </div>
                      <div className="text-lg font-bold text-white">
                        {p.price !== null ? `£${p.price.toFixed(2)}` : 'N/A'}
                      </div>
                      {p.unit_price && (
                        <div className="text-xs text-slate-400">
                          £{p.unit_price.toFixed(2)}/ltr
                        </div>
                      )}
                      <div className={`text-xs mt-1 font-medium ${
                        p.is_live ? 'text-green-400' : 'text-slate-500'
                      }`}>
                        {p.is_live ? '● LIVE' : '● Dataset (Jan-Apr 2024)'}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-slate-900 rounded-lg p-3 text-xs text-slate-400">
                  Market avg:{' '}
                  <span className="text-white font-medium">
                    £{livePrices.avg_live_price?.toFixed(2)}
                  </span>
                  {' '}· {livePrices.live_lookups} live · {livePrices.dataset_lookups} from dataset
                  {liveUpdated && (
                    <span className="text-green-400 ml-2 font-medium">
                      ✓ Pricing updated with live data
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Inventory Alert */}
          {result.inventory.urgency !== 'NONE' && (
            <div className={`rounded-xl p-5 border flex items-start gap-4 ${
              result.inventory.urgency === 'CRITICAL' ||
              result.inventory.urgency === 'HIGH'
                ? 'bg-red-950 border-red-800'
                : 'bg-yellow-950 border-yellow-800'
            }`}>
              <AlertTriangle size={20} className="text-red-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-white">
                  {result.inventory.action}
                </div>
                <div className="text-sm text-slate-400 mt-1">
                  {result.inventory.reorder_quantity > 0
                    ? `Reorder ${result.inventory.reorder_quantity} units — only ${result.inventory.days_of_stock.toFixed(1)} days of stock remaining`
                    : 'Stock levels are healthy'}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!result && !loading && (
        <div className="text-center py-20 text-slate-600">
          Select a product and store, then click Analyse
        </div>
      )}
    </div>
  );
}