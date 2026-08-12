import React, { useState, useEffect } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Legend
} from 'recharts';
import { CalendarRange, AlertCircle, Target, TrendingUp, Sun } from 'lucide-react';
import { getProducts, getStores, getWeeklyForecast, getWeather } from '../services/api';
import type { Product, Store, WeeklyForecast, WeatherData } from '../services/api';

function weatherEmoji(temp: number, rain: number) {
  if (rain > 5)  return '🌧️';
  if (temp > 25) return '☀️';
  if (temp < 5)  return '❄️';
  return '⛅';
}

export default function WeeklyForecastPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores,   setStores]   = useState<Store[]>([]);
  const [itemId,   setItemId]   = useState(1);
  const [storeId,  setStoreId]  = useState(1);
  const [data,     setData]     = useState<WeeklyForecast | null>(null);
  const [weather,  setWeather]  = useState<WeatherData | null>(null);
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
      const [result, weatherResult] = await Promise.all([
        getWeeklyForecast(storeId, itemId, '2024-06-11'),
        getWeather('fresh_food').catch(() => null),
      ]);
      setData(result);
      setWeather(weatherResult);
    } catch {
      setError('Failed to load forecast. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const selectClass =
    "bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 text-sm w-full";

  const chartData = data ? [
    ...data.past_days.map(d => ({
      day:        d.day_label,
      actual:     d.actual,
      predicted:  d.predicted,
      forecast:   null,
      is_weekend: d.is_weekend,
    })),
    ...data.future_days.map(d => ({
      day:        d.day_label,
      actual:     null,
      predicted:  null,
      forecast:   d.forecast,
      is_weekend: d.is_weekend,
    })),
  ] : [];

  const todayLabel = data?.past_days[data.past_days.length - 1]?.day_label ?? '';

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Weekly Demand Forecast</h1>
        <p className="text-slate-400 mt-1 text-sm">
          7 days of historical actuals vs model predictions, followed by a 7-day forward forecast.
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
            {loading ? 'Loading…' : 'Load Forecast'}
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
          {/* Weather Banner */}
          {weather && (
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">
                      {weatherEmoji(weather.temperature_c, weather.precipitation_mm)}
                    </span>
                    <div>
                      <div className="text-white font-semibold">
                        {weather.temperature_c}°C
                        {weather.precipitation_mm > 0.5 && ` · ${weather.precipitation_mm}mm rain`}
                      </div>
                      <div className="text-xs text-slate-400 capitalize">
                        {weather.season} · London
                        {weather.is_bank_holiday && ' · 🏖️ Bank Holiday'}
                        {weather.is_weekend && !weather.is_bank_holiday && ' · Weekend'}
                      </div>
                    </div>
                  </div>

                  <div className="h-8 w-px bg-slate-700" />

                  <div>
                    <div className={`text-sm font-semibold ${
                      weather.multiplier > 1 ? 'text-green-400' :
                      weather.multiplier < 1 ? 'text-red-400' : 'text-slate-400'
                    }`}>
                      {weather.multiplier > 1 ? '↑' : weather.multiplier < 1 ? '↓' : '→'}{' '}
                      {weather.multiplier > 1 ? '+' : ''}
                      {((weather.multiplier - 1) * 100).toFixed(1)}% demand adjustment
                    </div>
                    <div className="text-xs text-slate-500">weather impact on forecast</div>
                  </div>

                  <div className="h-8 w-px bg-slate-700" />

                  <div className="text-xs text-slate-400 space-y-0.5">
                    {weather.temp_effect !== 0 && (
                      <div>Temperature: {weather.temp_effect > 0 ? '+' : ''}{(weather.temp_effect * 100).toFixed(1)}%</div>
                    )}
                    {weather.rain_effect !== 0 && (
                      <div>Rainfall: {weather.rain_effect > 0 ? '+' : ''}{(weather.rain_effect * 100).toFixed(1)}%</div>
                    )}
                    {weather.event_effect !== 0 && (
                      <div>Event boost: +{(weather.event_effect * 100).toFixed(1)}%</div>
                    )}
                    {weather.season_effect !== 0 && (
                      <div>Season: +{(weather.season_effect * 100).toFixed(1)}%</div>
                    )}
                  </div>
                </div>
                <div className="text-xs text-slate-600">{weather.data_source}</div>
              </div>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Target size={16} className="text-indigo-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wide">Model Accuracy (MAE)</span>
              </div>
              <div className="text-2xl font-semibold text-white">
                {data.accuracy.mae !== null ? data.accuracy.mae.toFixed(1) : '—'} units
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Avg error over last 7 days
                {data.accuracy.mape !== null && ` (${data.accuracy.mape}% MAPE)`}
              </div>
            </div>
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-green-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wide">7-Day Forecast Total</span>
              </div>
              <div className="text-2xl font-semibold text-white">
                {data.summary.total_forecast_units.toFixed(0)} units
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Avg {data.summary.avg_forecast_per_day.toFixed(1)} units/day
                {weather && weather.multiplier !== 1 && (
                  <span className={`ml-1 ${weather.multiplier > 1 ? 'text-green-400' : 'text-red-400'}`}>
                    ({weather.multiplier > 1 ? '↑' : '↓'} weather)
                  </span>
                )}
              </div>
            </div>
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Sun size={16} className="text-yellow-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wide">Weekend Uplift</span>
              </div>
              <div className={`text-2xl font-semibold ${
                (data.summary.weekend_uplift_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {data.summary.weekend_uplift_pct !== null
                  ? `${data.summary.weekend_uplift_pct >= 0 ? '+' : ''}${data.summary.weekend_uplift_pct}%`
                  : '—'}
              </div>
              <div className="text-xs text-slate-500 mt-1">vs weekday average</div>
            </div>
            <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <CalendarRange size={16} className="text-slate-400" />
                <span className="text-xs text-slate-400 uppercase tracking-wide">Product</span>
              </div>
              <div className="text-lg font-semibold text-white">{data.product_name}</div>
              <div className="text-xs text-slate-500 mt-1">{data.store_name}</div>
            </div>
          </div>

          {/* Main chart */}
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 mb-6">
            <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
              14-Day Demand Timeline
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Solid lines = actual sales vs model predictions (past 7 days). Dashed line = forward forecast (next 7 days).
            </p>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  angle={-25}
                  textAnchor="end"
                  height={55}
                />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={(v: any, name: any) => [v != null ? `${Number(v).toFixed(1)} units` : '—', name]}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                <ReferenceLine
                  x={todayLabel}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{ value: 'today', position: 'top', fill: '#f59e0b', fontSize: 10 }}
                />
                <Line
                  type="monotone" dataKey="actual" name="Actual Sales"
                  stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false}
                />
                <Line
                  type="monotone" dataKey="predicted" name="Model Predicted (historical)"
                  stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 3"
                  dot={{ r: 2 }} connectNulls={false}
                />
                <Line
                  type="monotone" dataKey="forecast" name="Forward Forecast"
                  stroke="#6366f1" strokeWidth={2.5} strokeDasharray="6 3"
                  dot={{ r: 3 }} connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Day-by-day tables */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
                Past 7 Days — Actual vs Predicted
              </h2>
              <div className="space-y-2">
                {data.past_days.map(d => (
                  <div key={d.date} className="flex items-center justify-between py-1.5 border-b border-slate-700 last:border-0">
                    <span className={`text-sm ${d.is_weekend ? 'text-yellow-400' : 'text-slate-300'}`}>
                      {d.day_label}{d.is_weekend && ' 🟡'}
                    </span>
                    <div className="flex gap-4 text-sm">
                      <span className="text-green-400">{d.actual?.toFixed(0)} actual</span>
                      <span className="text-slate-500">{d.predicted?.toFixed(0)} predicted</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
              <h2 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-4">
                Next 7 Days — Forecast
                {weather && weather.multiplier !== 1 && (
                  <span className={`ml-2 text-xs font-normal ${weather.multiplier > 1 ? 'text-green-400' : 'text-red-400'}`}>
                    {weather.multiplier > 1 ? '↑' : '↓'} weather adjusted
                  </span>
                )}
              </h2>
              <div className="space-y-2">
                {data.future_days.map(d => (
                  <div key={d.date} className="flex items-center justify-between py-1.5 border-b border-slate-700 last:border-0">
                    <span className={`text-sm ${d.is_weekend ? 'text-yellow-400' : 'text-slate-300'}`}>
                      {d.day_label}{d.is_weekend && ' 🟡'}
                    </span>
                    <span className="text-indigo-400 font-medium text-sm">{d.forecast?.toFixed(0)} units</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Insight box */}
          <div className="bg-indigo-950 border border-indigo-700 rounded-xl p-6">
            <div className="flex items-start gap-4">
              <Target size={22} className="text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-white font-medium mb-2">Model Performance Summary</h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Over the past 7 days, the XGBoost demand model achieved a mean absolute error of{' '}
                  <span className="text-indigo-400 font-medium">
                    {data.accuracy.mae !== null ? `${data.accuracy.mae.toFixed(1)} units` : 'N/A'}
                  </span>
                  {data.accuracy.mape !== null && <> ({data.accuracy.mape}% MAPE)</>} for{' '}
                  <span className="text-indigo-400 font-medium">{data.product_name}</span> at{' '}
                  <span className="text-indigo-400 font-medium">{data.store_name}</span>.
                  {weather && (
                    <> Today's weather ({weather.temperature_c}°C, {weather.precipitation_mm}mm rain) applies a{' '}
                    <span className={`font-medium ${weather.multiplier > 1 ? 'text-green-400' : 'text-red-400'}`}>
                      {weather.multiplier > 1 ? '+' : ''}{((weather.multiplier - 1) * 100).toFixed(1)}% demand adjustment
                    </span> to the forward forecast.</>
                  )} The forward forecast projects{' '}
                  <span className="text-indigo-400 font-medium">
                    {data.summary.total_forecast_units.toFixed(0)} total units
                  </span>{' '}
                  over the next 7 days
                  {data.summary.weekend_uplift_pct !== null && (
                    <>, with weekends showing a{' '}
                      <span className={`font-medium ${data.summary.weekend_uplift_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {data.summary.weekend_uplift_pct >= 0 ? '+' : ''}{data.summary.weekend_uplift_pct}%
                      </span> demand shift vs weekdays
                    </>
                  )}.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {!data && !loading && !error && (
        <div className="bg-slate-800 rounded-xl p-12 border border-slate-700 text-center">
          <CalendarRange size={40} className="text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">
            Select a product and store, then click Load Forecast.
          </p>
        </div>
      )}
    </div>
  );
}