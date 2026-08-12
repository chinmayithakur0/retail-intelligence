import axios from 'axios';

const API_BASE = 'http://localhost:8000/api';

export interface Product {
  item_id: number;
  name: string;
  category: string;
  unit: string;
  current_price?: number;
}

export interface Store {
  store_id: number;
  name: string;
}

export interface QuickPredictResult {
  product_name: string;
  store_name: string;
  category: string;
  demand: {
    predicted_units: number;
    is_weekend: boolean;
    day_of_week: string;
  };
  competitors: {
    supermarket: string;
    price: number;
    strategy: string;
  }[];
  pricing: {
    optimal_price: number;
    expected_revenue: number;
    base_price: number;
    avg_competitor_price: number;
    price_vs_competitor: number;
    expected_demand: number;
    current_stock: number;
    status: string;
    urgency: string;
    days_of_stock: number;
    reorder_quantity: number;
    action: string;
  };
  inventory: {
    current_stock: number;
    status: string;
    urgency: string;
    days_of_stock: number;
    reorder_quantity: number;
    action: string;
  };
  // Add to QuickPredictResult interface:
 weather?: WeatherData;
 stock_info?: {           // ← ADD THIS
    current_stock:   number;
    baseline_stock:  number;
    sold_last_30:    number;
    stock_source:    string;
  };
}

export interface CrewResult extends QuickPredictResult {
  narrative: string;
}

export const getProducts = async (): Promise<Product[]> => {
  const res = await axios.get(`${API_BASE}/products`);
  return res.data.products;
};

export const getStores = async (): Promise<Store[]> => {
  const res = await axios.get(`${API_BASE}/stores`);
  return res.data.stores;
};

export const quickPredict = async (
  store: number,
  item: number,
  date: string
): Promise<QuickPredictResult> => {
  const res = await axios.get(`${API_BASE}/quick-predict`, {
    params: { store, item, date }
  });
  return res.data;
};

export const runCrew = async (payload: {
  store: number;
  item: number;
  date: string;
  current_stock: number;
  base_price: number;
  lag_1: number;
  lag_7: number;
  lag_30: number;
  rolling_7: number;
  rolling_30: number;
}): Promise<CrewResult> => {
  const res = await axios.post(`${API_BASE}/run-crew`, payload);
  return res.data;
};

export interface CompetitorInfluence {
  product_name: string;
  store_name: string;
  our_price: number;
  avg_competitor_price: number;
  market_pressure: 'upward' | 'downward';
  pressure_magnitude: number;
  avg_influence_score: number;
  most_influential: string;
  competitors: {
    supermarket: string;
    strategy: string;
    their_price: number;
    our_price: number;
    price_diff: number;
    price_pull_pct: number;
    aggression: number;
    price_factor: number;
    direction: 'upward' | 'downward';
    influence_score: number;
  }[];
}

export const getCompetitorInfluence = async (
  store: number,
  item: number,
  date: string
): Promise<CompetitorInfluence> => {
  const res = await axios.get(`${API_BASE}/competitor-influence`, {
    params: { store, item, date }
  });
  return res.data;
};

export interface SensitivityPoint {
  elasticity: number;
  demand_only_price: number;
  competitor_aware_price: number;
  demand_only_revenue: number;
  competitor_aware_revenue: number;
  demand_only_demand: number;
  competitor_aware_demand: number;
  revenue_lift: number;
  revenue_lift_pct: number;
}

export interface SensitivityAnalysis {
  product_name: string;
  store_name: string;
  base_price: number;
  avg_competitor_price: number;
  assumed_elasticity: number;
  at_assumed_elasticity: SensitivityPoint;
  helps_in: number;
  hurts_in: number;
  total_tested: number;
  max_lift: SensitivityPoint;
  min_lift: SensitivityPoint;
  results: SensitivityPoint[];
}

export const getSensitivityAnalysis = async (
  store: number,
  item: number,
  date: string
): Promise<SensitivityAnalysis> => {
  const res = await axios.get(`${API_BASE}/sensitivity-analysis`, {
    params: { store, item, date }
  });
  return res.data;
};

export interface DecisionLog {
  id: number;
  timestamp: string;
  analysis_type: string;
  product_name: string;
  store_name: string;
  item_id: number;
  store_id: number;
  our_price: number | null;
  optimal_price: number | null;
  predicted_demand: number | null;
  expected_revenue: number | null;
  inventory_status: string | null;
  market_pressure: string | null;
  revenue_lift: number | null;
  most_influential: string | null;
  summary: string;
}

export interface DecisionLogStats {
  total_decisions: number;
  by_type: { analysis_type: string; c: number }[];
  avg_revenue_lift: number;
  most_analysed_product: string | null;
  most_analysed_store: string | null;
}

export const getDecisionLog = async (limit = 50): Promise<DecisionLog[]> => {
  const res = await axios.get(`${API_BASE}/decision-log`, { params: { limit } });
  return res.data.logs;
};

export const clearDecisionLog = async (): Promise<void> => {
  await axios.delete(`${API_BASE}/decision-log`);
};

export const getDecisionLogStats = async (): Promise<DecisionLogStats> => {
  const res = await axios.get(`${API_BASE}/decision-log/stats`);
  return res.data;
};

export interface ConfidenceFactor {
  score: number;
  label: string;
  explanation: string;
  [key: string]: any;
}

export interface PriceConfidence {
  product_name: string;
  store_name: string;
  category: string;
  recommended_price: number;
  confidence_score: number;
  confidence_label: 'HIGH' | 'MEDIUM' | 'LOW';
  factors: {
    data_depth: ConfidenceFactor & { record_count: number };
    agreement: ConfidenceFactor & { price_with: number; price_without: number; price_gap_pct: number };
    volatility: ConfidenceFactor;
  };
  weights: {
    data_depth: number;
    agreement: number;
    volatility: number;
  };
}

export const getPriceConfidence = async (
  store: number,
  item: number,
  date: string
): Promise<PriceConfidence> => {
  const res = await axios.get(`${API_BASE}/price-confidence`, {
    params: { store, item, date }
  });
  return res.data;
};

export interface ScenarioCompetitor {
  supermarket: string;
  price: number;
  strategy: string;
  aggression: number;
}

export interface ScenarioBase {
  product_name: string;
  store_name: string;
  category: string;
  base_price: number;
  base_demand: number;
  price_elasticity: number;
  competitors: ScenarioCompetitor[];
}

export const getScenarioBase = async (
  store: number,
  item: number,
  date: string
): Promise<ScenarioBase> => {
  const res = await axios.get(`${API_BASE}/scenario-base`, {
    params: { store, item, date }
  });
  return res.data;
};

export interface ForecastDay {
  date: string;
  day_label: string;
  actual?: number;
  predicted?: number;
  forecast?: number;
  is_weekend: boolean;
  type: 'historical' | 'forecast';
}

export interface WeeklyForecast {
  product_name: string;
  store_name: string;
  category: string;
  anchor_date: string;
  past_days: ForecastDay[];
  future_days: ForecastDay[];
  accuracy: {
    mae: number | null;
    mape: number | null;
  };
  summary: {
    total_forecast_units: number;
    avg_forecast_per_day: number;
    weekend_uplift_pct: number | null;
  };
}

export const getWeeklyForecast = async (
  store: number,
  item: number,
  date: string
): Promise<WeeklyForecast> => {
  const res = await axios.get(`${API_BASE}/weekly-forecast`, {
    params: { store, item, date }
  });
  return res.data;
};
export interface MarketPlayer {
  name: string;
  price: number;
  price_index: number;
  value_score: number;
  strategy: string;
  aggression: number;
  is_ours: boolean;
  colour: string;
  quadrant: string;
}

export interface MarketPosition {
  category: string;
  store_name: string;
  market_avg: number;
  market_min: number;
  market_max: number;
  our_position: string;
  players: MarketPlayer[];
  insights: {
    cheapest: string;
    most_expensive: string;
    best_value: string;
  };
}

export const getMarketPosition = async (
  store: number,
  category: string,
  date: string
): Promise<MarketPosition> => {
  const res = await axios.get(`${API_BASE}/market-position`, {
    params: { store, category, date }
  });
  return res.data;
};

export interface LivePrice {
  supermarket: string;
  product_name: string;
  price: number | null;
  unit_price: number | null;
  in_stock: boolean;
  source: string;
  scraped_at: string;
  is_live: boolean;
}

export interface LivePricesResult {
  status: string;
  product_name: string;
  category: string;
  live_prices: LivePrice[];
  avg_live_price: number | null;
  successful_lookups: number;
  live_lookups: number;
  dataset_lookups: number;
  source_note: string;
}

export const getLivePrices = async (
  product_name: string,
  category: string
): Promise<LivePricesResult> => {
  const res = await axios.get(`${API_BASE}/live-prices`, {
    params: { product_name, category }
  });
  return res.data;
};

export const quickPredictWithLivePrice = async (
  store: number,
  item: number,
  date: string,
  livePrices: { [supermarket: string]: number }
): Promise<QuickPredictResult> => {
  const params: any = { store, item, date };

  if (livePrices['Tesco'])      params.tesco_live_price      = livePrices['Tesco'];
  if (livePrices['Sainsburys']) params.sainsburys_live_price = livePrices['Sainsburys'];
  if (livePrices['Asda'])       params.asda_live_price       = livePrices['Asda'];
  if (livePrices['Morrisons'])  params.morrisons_live_price  = livePrices['Morrisons'];
  if (livePrices['Aldi'])       params.aldi_live_price       = livePrices['Aldi'];

  const res = await axios.get(`${API_BASE}/quick-predict`, { params });
  return res.data;
};

export interface WeatherData {
  multiplier: number;
  temperature_c: number;
  precipitation_mm: number;
  season: string;
  is_bank_holiday: boolean;
  is_weekend: boolean;
  temp_effect: number;
  rain_effect: number;
  event_effect: number;
  season_effect: number;
  data_source: string;
}

export const getWeather = async (category: string): Promise<WeatherData> => {
  const res = await axios.get(`${API_BASE}/weather`, { params: { category } });
  return res.data;
};