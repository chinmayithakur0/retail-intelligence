from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import sys, os, json, asyncio, sqlite3
from datetime import datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from agents.orchestrator_agent import run_crew
from agents.demand_agent import predict_demand
from agents.competitor_agents import get_competitor_price, COMPETITOR_PROFILES
from agents.inventory_agent import calculate_reorder
from agents.pricing_agent import optimise_price
from data_pipeline.product_mapping import PRODUCT_MAP, STORE_MAP, get_product_info, get_store_name
from agents.competitor_agents import get_competitor_price, COMPETITOR_PROFILES
router = APIRouter()
# ── Live price cache ─────────────────────────────────────────────
# Stores the most recently fetched Trolley.co.uk prices
# Structure: { 'category': { 'Tesco': 2.10, 'Sainsburys': 2.20, ... } }
_LIVE_PRICE_CACHE: dict = {}
_LIVE_PRICE_TIMESTAMP: dict = {}  # when each category was last fetched
LIVE_PRICE_TTL_SECONDS = 300      # 5 minute cache — refresh after 5 mins
# ── Pre-load large CSVs once at startup ───────────────
import pandas as _pd
import os as _os

_PROCESSED = _os.path.join(_os.path.dirname(__file__), '../../data/processed')

print("Loading demand_enriched.csv into memory...")
_DEMAND_DF = _pd.read_csv(_os.path.join(_PROCESSED, 'demand_enriched.csv'))
print(f"✅ Demand data loaded: {len(_DEMAND_DF):,} rows")

print("Loading competitor_prices.csv into memory...")
_COMPETITOR_DF = _pd.read_csv(_os.path.join(_PROCESSED, 'competitor_prices.csv'))
print(f"✅ Competitor data loaded: {len(_COMPETITOR_DF):,} rows")

# ── Sainsbury's live-price cache ──────────────────────
# Keyed by normalised product_name. Protects the demo/live pipeline from
# hammering Sainsbury's API on repeated requests, and gives us something
# sane to fall back to if the live call fails (timeout, 4xx/5xx, no results).
_SAINSBURYS_CACHE: dict = {}
_SAINSBURYS_CACHE_TTL_SECONDS = 300  # 5 minutes
# ── Request Models ─────────────────────────────────────
class CrewRequest(BaseModel):
    store:            int     = 1
    item:             int     = 1
    date:             str     = "2024-06-11"
    current_stock:    int     = 100
    base_price:       float   = 2.50
    lag_1:            float   = 50.0
    lag_7:            float   = 48.0
    lag_30:           float   = 45.0
    rolling_7:        float   = 49.0
    rolling_30:       float   = 47.0
    lead_time_days:   int     = 3
    safety_stock_days:int     = 7

def get_live_or_dataset_price(supermarket: str, category: str) -> dict:
    """
    Returns the best available price for a supermarket/category combination.
    Priority: 1) Live Trolley cache, 2) Dataset median, 3) Price factor estimate
    """
    import time

    # Check live cache first
    cache_key = category.lower()
    if cache_key in _LIVE_PRICE_CACHE:
        # Check if cache is still fresh
        age = time.time() - _LIVE_PRICE_TIMESTAMP.get(cache_key, 0)
        if age < LIVE_PRICE_TTL_SECONDS:
            supermarket_key = supermarket.lower().replace('sainsburys', 'sainsbury')
            for cached_name, cached_price in _LIVE_PRICE_CACHE[cache_key].items():
                if supermarket_key in cached_name.lower() or cached_name.lower() in supermarket_key:
                    return {
                        'price':  cached_price,
                        'source': 'LIVE — trolley.co.uk',
                        'is_live': True,
                    }

    # Fall back to dataset
    try:
        if _COMPETITOR_DF is not None:
            mask = _COMPETITOR_DF['supermarket'].str.lower().str.contains(
                supermarket.lower().replace('sainsburys', 'sainsbury')
            )
            if mask.any():
                return {
                    'price':  round(float(_COMPETITOR_DF[mask]['price'].median()), 2),
                    'source': 'dataset',
                    'is_live': False,
                }
    except Exception:
        pass

    # Final fallback — estimate from price factor
    PRICE_FACTORS = {
        'tesco': 1.00, 'sainsbury': 1.08, 'aldi': 0.82,
        'asda': 0.93, 'morrisons': 0.97
    }
    factor = PRICE_FACTORS.get(supermarket.lower().replace('sainsburys', 'sainsbury'), 1.0)
    return {
        'price':  round(2.50 * factor, 2),
        'source': 'estimated',
        'is_live': False,
    }

def get_weather_demand_multiplier(category: str, date: str) -> dict:
    """
    Fetches real weather data from Open-Meteo API (free, no auth).
    Returns a demand multiplier based on temperature, rain, season
    and UK bank holidays for the given date.
    """
    import requests as req
    from datetime import datetime, date as date_type
    import math

    # UK bank holidays 2024-2026 (static list — reliable, no API needed)
    UK_BANK_HOLIDAYS = {
        # 2024
        '2024-01-01', '2024-03-29', '2024-04-01', '2024-05-06',
        '2024-05-27', '2024-08-26', '2024-12-25', '2024-12-26',
        # 2025
        '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05',
        '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
        # 2026
        '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04',
        '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
    }

    # Category weather sensitivity profiles
    # Each tuple: (temp_sensitive, rain_sensitive, bank_holiday_boost)
    WEATHER_PROFILES = {
        'drinks':          (0.15,  -0.05, 0.10),  # hot=more drinks, rain=less, BH=more
        'fresh_food':      (0.08,  -0.03, 0.12),  # BBQ weather boost
        'bakery':          (-0.03,  0.08, 0.15),  # rainy=comfort baking, BH=more
        'frozen':          (0.10,  -0.02, 0.05),  # hot=more ice cream
        'food_cupboard':   (-0.02,  0.10, 0.08),  # rainy=stocking up
        'household':       (-0.01,  0.05, 0.05),  # mild weather effect
        'health_products': (-0.02,  0.03, 0.02),  # minimal weather effect
        'pets':            (0.05,  -0.08, 0.08),  # sunny=outdoor pets
        'baby_products':   (0.00,   0.02, 0.05),  # minimal weather effect
        'free-from':       (0.05,  -0.02, 0.08),  # similar to fresh food
    }

    try:
        # Open-Meteo API — London coordinates, free, no auth
        r = req.get(
            'https://api.open-meteo.com/v1/forecast',
            params={
                'latitude':            51.5074,
                'longitude':          -0.1278,
                'daily':              'temperature_2m_max,precipitation_sum',
                'timezone':           'Europe/London',
                'forecast_days':       1,
            },
            timeout=5
        )

        if r.status_code == 200:
            data        = r.json()
            temp_max    = float(data['daily']['temperature_2m_max'][0])
            precip_mm   = float(data['daily']['precipitation_sum'][0])
        else:
            temp_max  = 15.0  # UK average
            precip_mm =  2.0

    except Exception:
        temp_max  = 15.0
        precip_mm =  2.0

    # Season from date
    try:
        d = datetime.strptime(date, '%Y-%m-%d')
        month = d.month
    except Exception:
        month = datetime.now().month

    if month in [12, 1, 2]:
        season = 'winter'
    elif month in [3, 4, 5]:
        season = 'spring'
    elif month in [6, 7, 8]:
        season = 'summer'
    else:
        season = 'autumn'

    # Bank holiday check
    is_bank_holiday = date in UK_BANK_HOLIDAYS
    is_weekend      = datetime.strptime(date, '%Y-%m-%d').weekday() >= 5 if date else False

    # Compute multiplier
    profile = WEATHER_PROFILES.get(category.lower(), (0.03, 0.02, 0.05))
    temp_sens, rain_sens, bh_boost = profile

    # Temperature effect: baseline 15°C, each degree above/below shifts demand
    temp_effect = temp_sens * (temp_max - 15.0) / 10.0

    # Rain effect: baseline 2mm, each 5mm above shifts demand
    rain_effect = rain_sens * max(0, (precip_mm - 2.0)) / 5.0

    # Bank holiday / weekend boost
    event_effect = bh_boost if is_bank_holiday else (bh_boost * 0.4 if is_weekend else 0.0)

    # Season modifier
    season_modifiers = {
        'summer': {'drinks': 0.05, 'fresh_food': 0.05, 'frozen': 0.05},
        'winter': {'food_cupboard': 0.05, 'bakery': 0.05, 'household': 0.03},
        'spring': {'fresh_food': 0.03, 'pets': 0.03},
        'autumn': {'food_cupboard': 0.03, 'bakery': 0.03},
    }
    season_effect = season_modifiers.get(season, {}).get(category.lower(), 0.0)

    # Total multiplier — clamp between 0.7 and 1.4
    total_effect   = 1.0 + temp_effect + rain_effect + event_effect + season_effect
    total_effect   = max(0.7, min(1.4, total_effect))

    return {
        'multiplier':       round(total_effect, 4),
        'temperature_c':    round(temp_max, 1),
        'precipitation_mm': round(precip_mm, 1),
        'season':           season,
        'is_bank_holiday':  is_bank_holiday,
        'is_weekend':       is_weekend,
        'temp_effect':      round(temp_effect, 4),
        'rain_effect':      round(rain_effect, 4),
        'event_effect':     round(event_effect, 4),
        'season_effect':    round(season_effect, 4),
        'data_source':      'Open-Meteo API (live)' if temp_max != 15.0 else 'fallback defaults',
    }
# ── Decision Log helpers ────────────────────────────────

def get_db_path():
    return os.path.join(os.path.dirname(__file__), '../../data/decision_log.db')

def init_db():
    """Creates the decision log table if it doesn't exist."""
    conn = sqlite3.connect(get_db_path())
    conn.execute('''
        CREATE TABLE IF NOT EXISTS decision_log (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp        TEXT NOT NULL,
            analysis_type    TEXT NOT NULL,
            product_name     TEXT NOT NULL,
            store_name       TEXT NOT NULL,
            item_id          INTEGER NOT NULL,
            store_id         INTEGER NOT NULL,
            our_price        REAL,
            optimal_price    REAL,
            predicted_demand REAL,
            expected_revenue REAL,
            inventory_status TEXT,
            market_pressure  TEXT,
            revenue_lift     REAL,
            most_influential TEXT,
            summary          TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def log_decision(
    analysis_type:    str,
    product_name:     str,
    store_name:       str,
    item_id:          int,
    store_id:         int,
    summary:          str,
    our_price:        float = None,
    optimal_price:    float = None,
    predicted_demand: float = None,
    expected_revenue: float = None,
    inventory_status: str   = None,
    market_pressure:  str   = None,
    revenue_lift:     float = None,
    most_influential: str   = None,
):
    """Inserts one row into the decision log."""
    init_db()
    conn = sqlite3.connect(get_db_path())
    conn.execute('''
        INSERT INTO decision_log (
            timestamp, analysis_type, product_name, store_name,
            item_id, store_id, our_price, optimal_price,
            predicted_demand, expected_revenue, inventory_status,
            market_pressure, revenue_lift, most_influential, summary
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ''', (
        datetime.now().isoformat(),
        analysis_type, product_name, store_name,
        item_id, store_id, our_price, optimal_price,
        predicted_demand, expected_revenue, inventory_status,
        market_pressure, revenue_lift, most_influential, summary
    ))
    conn.commit()
    conn.close()

# ── Routes ─────────────────────────────────────────────

@router.get("/")
def health():
    return {"status": "ok", "message": "Retail Intelligence API running"}


@router.post("/run-crew")
def run_crew_endpoint(req: CrewRequest):
    """
    Main endpoint — runs the full multi-agent crew.
    Returns structured results + LLM narrative.
    """
    try:
        product = get_product_info(req.item)
        context = {
            'store':             req.store,
            'item':              req.item,
            'category':          product['category'],
            'date':              req.date,
            'current_stock':     req.current_stock,
            'base_price':        req.base_price,
            'lag_1':             req.lag_1,
            'lag_7':             req.lag_7,
            'lag_30':            req.lag_30,
            'rolling_7':         req.rolling_7,
            'rolling_30':        req.rolling_30,
            'lead_time_days':    req.lead_time_days,
            'safety_stock_days': req.safety_stock_days,
        }
        result = run_crew(context)

        result['product_name'] = product['name']
        result['store_name']   = get_store_name(req.store)
        result['category']     = product['category']

        log_decision(
            analysis_type    = "Full Crew",
            product_name     = product['name'],
            store_name       = get_store_name(req.store),
            item_id          = req.item,
            store_id         = req.store,
            our_price        = req.base_price,
            optimal_price    = result.get('pricing', {}).get('optimal_price'),
            predicted_demand = result.get('demand', {}).get('predicted_units'),
            expected_revenue = result.get('pricing', {}).get('expected_revenue'),
            inventory_status = result.get('inventory', {}).get('status'),
            summary          = (
                f"Full 9-agent crew run. "
                f"Predicted demand: {result.get('demand', {}).get('predicted_units', 0):.0f} units. "
                f"Optimal price: £{result.get('pricing', {}).get('optimal_price', 0):.2f}. "
                f"Revenue: £{result.get('pricing', {}).get('expected_revenue', 0):.2f}. "
                f"Stock: {result.get('inventory', {}).get('status', 'N/A')}."
            )
        )

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/products")
def get_products():
    """Returns all 50 products with their details."""
    products = []
    for item_id, info in PRODUCT_MAP.items():
        products.append({
            'item_id':  item_id,
            'name':     info['name'],
            'category': info['category'],
            'unit':     info['unit'],
        })
    return {'products': products}


@router.get("/stores")
def get_stores():
    """Returns all 10 stores."""
    stores = [{'store_id': k, 'name': v} for k, v in STORE_MAP.items()]
    return {'stores': stores}


@router.get("/quick-predict")
def quick_predict(
    store: int = 1,
    item:  int = 1,
    date:  str = "2024-06-11",
    sainsburys_live_price: float = None,
    tesco_live_price:      float = None,
    asda_live_price:       float = None,
    morrisons_live_price:  float = None,
    aldi_live_price:       float = None,
):
    import time
    t0 = time.time()

    product   = get_product_info(item)
    PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')

    df = _DEMAND_DF
    subset = df[(df['store'] == store) & (df['item'] == item)].sort_values('date')
    print(f"⏱️ CSV filter: {time.time()-t0:.2f}s")

    if len(subset) > 0:
        last       = subset.iloc[-1]
        lag_1      = float(last['lag_1'])
        lag_7      = float(last['lag_7'])
        lag_30     = float(last['lag_30'])
        rolling_7  = float(last['rolling_7'])
        rolling_30 = float(last['rolling_30'])
    else:
        lag_1 = lag_7 = lag_30 = rolling_7 = rolling_30 = 50.0

    from data_pipeline.product_mapping import calculate_current_stock
    stock_info    = calculate_current_stock(store, item, PROCESSED)
    current_stock = stock_info['current_stock']
    print(f"⏱️ Stock calc: {time.time()-t0:.2f}s")

    from data_pipeline.product_mapping import get_current_price
    price_info = get_current_price(item, store, product['category'], PROCESSED)
    base_price = price_info['current_price']
    print(f"⏱️ Price calc: {time.time()-t0:.2f}s")

    
    demand = predict_demand(
        store=store, item=item, date=date,
        lag_1=lag_1, lag_7=lag_7, lag_30=lag_30,
        rolling_7=rolling_7, rolling_30=rolling_30
    )

    # ── Weather demand adjustment ─────────────────────────────────
    weather = get_weather_demand_multiplier(product['category'], date)
    weather_adjusted_units = round(
        demand['predicted_units'] * weather['multiplier'], 1
    )
    demand['predicted_units_original'] = demand['predicted_units']
    demand['predicted_units']= weather_adjusted_units
    demand['weather']= weather
    print(f"⏱️ Demand predict: {time.time()-t0:.2f}s")

    competitors = []
    for supermarket in COMPETITOR_PROFILES.keys():
        cp = get_competitor_price(supermarket, product['category'], date)
        competitors.append({
            'supermarket': supermarket,
            'price':       cp['price'],
            'strategy':    cp['strategy'],
        })
        # Override competitor prices with live Trolley prices if provided
    live_overrides = {
        'sainsburys': sainsburys_live_price,
        'tesco':      tesco_live_price,
        'asda':       asda_live_price,
        'morrisons':  morrisons_live_price,
        'aldi':       aldi_live_price,
    }

    for c in competitors:
        key = c['supermarket'].lower()
        for override_key, override_price in live_overrides.items():
            if override_key in key and override_price is not None:
                c['price']  = override_price
                c['source'] = 'LIVE — trolley.co.uk'
                break
    print(f"⏱️ Competitor prices: {time.time()-t0:.2f}s")

    pricing = optimise_price(
        predicted_demand_at_base = demand['predicted_units'],
        base_price               = base_price,
        competitor_prices        = competitors,
        category                 = product['category'],
    )
    print(f"⏱️ Pricing optimise: {time.time()-t0:.2f}s")

    inventory = calculate_reorder(
        current_stock    = current_stock,
        predicted_demand = demand['predicted_units'],
    )
    print(f"⏱️ Inventory: {time.time()-t0:.2f}s")

    log_decision(
        analysis_type    = "Quick Predict",
        product_name     = product['name'],
        store_name       = get_store_name(store),
        item_id          = item,
        store_id         = store,
        our_price        = base_price,
        optimal_price    = pricing['optimal_price'],
        predicted_demand = demand['predicted_units'],
        expected_revenue = pricing['expected_revenue'],
        inventory_status = inventory['status'],
        summary          = (
            f"Predicted {demand['predicted_units']:.0f} units demand. "
            f"Optimal price: £{pricing['optimal_price']:.2f} "
            f"(base: £{base_price:.2f}). "
            f"Revenue: £{pricing['expected_revenue']:.2f}. "
            f"Stock: {inventory['status']}."
        )
    )
    print(f"⏱️ TOTAL: {time.time()-t0:.2f}s")

    return {
        'product_name': product['name'],
        'store_name':   get_store_name(store),
        'category':     product['category'],
        'demand':       demand,
        'competitors':  competitors,
        'pricing':      pricing,
        'inventory':    inventory,
        'stock_info':   stock_info,
        'price_info':   price_info,
        'weather':      weather,
    }


@router.get("/ablation-study")
def ablation_study(store: int = 1, item: int = 1, date: str = "2024-06-11"):
    """
    Runs pricing optimisation twice — with and without competitor agents —
    and returns the comparison.
    """
    import pandas as pd
    import os
    from agents.pricing_agent import optimise_price_no_competitors

    product   = get_product_info(item)
    PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')

    df = _DEMAND_DF  # already loaded once at module import - avoid re-reading 898K rows from disk
    subset = df[(df['store'] == store) & (df['item'] == item)].sort_values('date')

    if len(subset) > 0:
        last       = subset.iloc[-1]
        lag_1      = float(last['lag_1'])
        lag_7      = float(last['lag_7'])
        lag_30     = float(last['lag_30'])
        rolling_7  = float(last['rolling_7'])
        rolling_30 = float(last['rolling_30'])
    else:
        lag_1 = lag_7 = lag_30 = rolling_7 = rolling_30 = 50.0

    demand = predict_demand(
        store=store, item=item, date=date,
        lag_1=lag_1, lag_7=lag_7, lag_30=lag_30,
        rolling_7=rolling_7, rolling_30=rolling_30
    )

    from data_pipeline.product_mapping import get_current_price
    price_info = get_current_price(item, store, product['category'], PROCESSED)
    base_price = price_info['current_price']

    competitors = []
    for supermarket in COMPETITOR_PROFILES.keys():
        cp = get_competitor_price(supermarket, product['category'], date)
        competitors.append({
            'supermarket': supermarket,
            'price':       cp['price'],
            'strategy':    cp['strategy'],
        })

    # ── RUN A: WITH competitor agents ──────────────────
    with_competitors = optimise_price(
        predicted_demand_at_base = demand['predicted_units'],
        base_price               = base_price,
        competitor_prices        = competitors,
        category                 = product['category'],
    )

    # ── RUN B: WITHOUT competitor agents ───────────────
    without_competitors = optimise_price_no_competitors(
        predicted_demand_at_base = demand['predicted_units'],
        base_price               = base_price,
        category                 = product['category'],
    )

    revenue_with     = with_competitors['expected_revenue']
    revenue_without  = without_competitors['expected_revenue']
    revenue_diff     = revenue_with - revenue_without
    revenue_diff_pct = (revenue_diff / revenue_without * 100) if revenue_without > 0 else 0

    price_with    = with_competitors['optimal_price']
    price_without = without_competitors['optimal_price']
    price_diff    = price_with - price_without

    log_decision(
        analysis_type = "Ablation Study",
        product_name  = product['name'],
        store_name    = get_store_name(store),
        item_id       = item,
        store_id      = store,
        our_price     = base_price,
        optimal_price = price_with,
        revenue_lift  = round(revenue_diff, 2),
        summary       = (
            f"Competitor-aware price: £{price_with:.2f} vs "
            f"demand-only: £{price_without:.2f}. "
            f"Revenue lift: £{revenue_diff:.2f} ({revenue_diff_pct:.2f}%)."
        )
    )

    return {
        'product_name':  product['name'],
        'store_name':    get_store_name(store),
        'category':      product['category'],
        'base_price':    base_price,
        'predicted_demand': demand['predicted_units'],
        'competitors':   competitors,
        'with_competitor_agents':    with_competitors,
        'without_competitor_agents': without_competitors,
        'comparison': {
            'price_with':             price_with,
            'price_without':          price_without,
            'price_difference':       round(price_diff, 2),
            'revenue_with':           revenue_with,
            'revenue_without':        revenue_without,
            'revenue_difference':     round(revenue_diff, 2),
            'revenue_difference_pct': round(revenue_diff_pct, 2),
        }
    }


@router.get("/competitor-influence")
def competitor_influence(store: int = 1, item: int = 1, date: str = "2024-06-11"):
    import pandas as pd
    import numpy as np
    import os
    from data_pipeline.product_mapping import (
        get_product_info, get_store_name, get_current_price, STORE_MAP
    )

    product_info = get_product_info(item)
    product_name = product_info['name']
    category     = product_info['category']
    store_name   = get_store_name(store)

    PROCESSED  = os.path.join(os.path.dirname(__file__), '../../data/processed')
    price_info = get_current_price(item, store, category, PROCESSED)
    our_price  = price_info['current_price']

    competitor_configs = {
        "Tesco":      {"price_factor": 1.00, "aggression": 0.3, "strategy": "market_leader"},
        "Sainsburys": {"price_factor": 1.08, "aggression": 0.2, "strategy": "quality_premium"},
        "Aldi":       {"price_factor": 0.82, "aggression": 0.8, "strategy": "hard_discounter"},
        "Asda":       {"price_factor": 0.93, "aggression": 0.6, "strategy": "everyday_low_price"},
        "Morrisons":  {"price_factor": 0.97, "aggression": 0.4, "strategy": "value_fresh"},
    }

    try:
        df = _COMPETITOR_DF
        df_cat = df[df['category'].str.lower().str.replace(" ", "_") == category.lower()]

        real_prices = {}
        for supermarket, cfg in competitor_configs.items():
            mask = df_cat["supermarket"].str.lower().str.contains(supermarket.lower())
            if mask.any():
                real_prices[supermarket] = float(df_cat[mask]["price"].median())
            else:
                real_prices[supermarket] = our_price * cfg["price_factor"]
    except Exception:
        real_prices = {
            name: our_price * cfg["price_factor"]
            for name, cfg in competitor_configs.items()
        }

    results = []
    avg_competitor_price = float(np.mean(list(real_prices.values())))

    for name, cfg in competitor_configs.items():
        comp_price    = real_prices[name]
        price_diff    = comp_price - our_price
        price_pull    = abs(price_diff) / our_price if our_price > 0 else 0
        direction     = "upward" if comp_price > our_price else "downward"
        raw_score     = price_pull * cfg["aggression"] * 100
        outlier_boost = abs(cfg["price_factor"] - 1.0) * 20
        score         = min(100, round(raw_score + outlier_boost, 1))

        results.append({
            "supermarket":     name,
            "strategy":        cfg["strategy"],
            "their_price":     round(comp_price, 2),
            "our_price":       round(our_price, 2),
            "price_diff":      round(price_diff, 2),
            "price_pull_pct":  round(price_pull * 100, 1),
            "aggression":      cfg["aggression"],
            "price_factor":    cfg["price_factor"],
            "direction":       direction,
            "influence_score": score,
        })

    results.sort(key=lambda x: x["influence_score"], reverse=True)

    avg_influence      = round(float(np.mean([r["influence_score"] for r in results])), 1)
    market_pressure    = "downward" if avg_competitor_price < our_price else "upward"
    pressure_magnitude = round(abs(avg_competitor_price - our_price) / our_price * 100, 1)

    log_decision(
        analysis_type    = "Competitor Influence",
        product_name     = product_name,
        store_name       = store_name,
        item_id          = item,
        store_id         = store,
        our_price        = round(our_price, 2),
        market_pressure  = market_pressure,
        most_influential = results[0]["supermarket"],
        summary          = (
            f"Market pressure: {market_pressure} ({pressure_magnitude}%). "
            f"Most influential: {results[0]['supermarket']} "
            f"(score: {results[0]['influence_score']}). "
            f"Avg competitor: £{avg_competitor_price:.2f} vs ours: £{our_price:.2f}."
        )
    )

    return {
        "product_name":         product_name,
        "store_name":           store_name,
        "our_price":            round(our_price, 2),
        "avg_competitor_price": round(avg_competitor_price, 2),
        "market_pressure":      market_pressure,
        "pressure_magnitude":   pressure_magnitude,
        "avg_influence_score":  avg_influence,
        "most_influential":     results[0]["supermarket"],
        "competitors":          results,
    }


@router.get("/sensitivity-analysis")
def sensitivity_analysis(store: int = 1, item: int = 1, date: str = "2024-06-11"):
    import numpy as np
    import os
    from data_pipeline.product_mapping import get_product_info, get_store_name, get_current_price

    PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')

    product_info = get_product_info(item)
    product_name = product_info['name']
    category     = product_info['category']
    store_name   = get_store_name(store)

    price_info = get_current_price(item, store, category, PROCESSED)
    base_price = price_info['current_price']

    competitor_configs = {
        "Tesco":      {"price_factor": 1.00, "aggression": 0.3},
        "Sainsburys": {"price_factor": 1.08, "aggression": 0.2},
        "Aldi":       {"price_factor": 0.82, "aggression": 0.8},
        "Asda":       {"price_factor": 0.93, "aggression": 0.6},
        "Morrisons":  {"price_factor": 0.97, "aggression": 0.4},
    }

    # Use live cache if available, otherwise use price factor
    live_comp_prices = []
    for name, cfg in competitor_configs.items():
        price_data = get_competitor_price(name, category, date)
        live_comp_prices.append(price_data['price'])

    avg_competitor_price = float(np.mean(live_comp_prices)) if live_comp_prices else (
        base_price * np.mean([cfg["price_factor"] for cfg in competitor_configs.values()])
    )

    base_demand = 50.0

    def optimal_price_demand_only(elasticity: float) -> dict:
        if elasticity >= -1:
            opt_price = base_price
        else:
            opt_price = base_price * (elasticity / (elasticity + 1))
            opt_price = max(0.10, opt_price)
        demand  = base_demand * (opt_price / base_price) ** elasticity
        revenue = opt_price * demand
        return {"price": round(opt_price, 4), "demand": round(demand, 2), "revenue": round(revenue, 2)}

    def optimal_price_with_competitors(elasticity: float) -> dict:
        demand_only       = optimal_price_demand_only(elasticity)
        demand_only_price = demand_only["price"]
        avg_aggression    = np.mean([cfg["aggression"] for cfg in competitor_configs.values()])
        competitor_weight = avg_aggression * 0.6
        blended_price     = (
            (1 - competitor_weight) * demand_only_price +
            competitor_weight * avg_competitor_price
        )
        blended_price = max(0.10, round(blended_price, 4))
        demand  = base_demand * (blended_price / base_price) ** elasticity
        revenue = blended_price * demand
        return {"price": round(blended_price, 4), "demand": round(demand, 2), "revenue": round(revenue, 2)}

    elasticity_values = [round(-0.5 - i * 0.1, 1) for i in range(26)]

    results = []
    for e in elasticity_values:
        d_only = optimal_price_demand_only(e)
        d_comp = optimal_price_with_competitors(e)
        revenue_lift     = round(d_comp["revenue"] - d_only["revenue"], 2)
        revenue_lift_pct = round(
            (revenue_lift / d_only["revenue"] * 100) if d_only["revenue"] > 0 else 0, 2
        )
        results.append({
            "elasticity":               e,
            "demand_only_price":        d_only["price"],
            "competitor_aware_price":   d_comp["price"],
            "demand_only_revenue":      d_only["revenue"],
            "competitor_aware_revenue": d_comp["revenue"],
            "demand_only_demand":       d_only["demand"],
            "competitor_aware_demand":  d_comp["demand"],
            "revenue_lift":             revenue_lift,
            "revenue_lift_pct":         revenue_lift_pct,
        })

    assumed     = next(r for r in results if r["elasticity"] == -1.5)
    helps_count = sum(1 for r in results if r["revenue_lift"] > 0)
    hurts_count = sum(1 for r in results if r["revenue_lift"] < 0)
    max_lift    = max(results, key=lambda r: r["revenue_lift"])
    min_lift    = min(results, key=lambda r: r["revenue_lift"])

    log_decision(
        analysis_type = "Sensitivity Analysis",
        product_name  = product_name,
        store_name    = store_name,
        item_id       = item,
        store_id      = store,
        our_price     = round(base_price, 2),
        revenue_lift  = assumed['revenue_lift'],
        summary       = (
            f"CI helps in {helps_count}/{len(results)} elasticity scenarios. "
            f"At assumed elasticity -1.5: revenue lift "
            f"£{assumed['revenue_lift']:.2f} ({assumed['revenue_lift_pct']:.2f}%). "
            f"Max lift: £{max_lift['revenue_lift']:.2f} at e={max_lift['elasticity']}."
        )
    )

    return {
        "product_name":          product_name,
        "store_name":            store_name,
        "base_price":            round(base_price, 2),
        "avg_competitor_price":  round(float(avg_competitor_price), 2),
        "assumed_elasticity":    -1.5,
        "at_assumed_elasticity": assumed,
        "helps_in":              helps_count,
        "hurts_in":              hurts_count,
        "total_tested":          len(results),
        "max_lift":              max_lift,
        "min_lift":              min_lift,
        "results":               results,
    }


# ── Decision Log endpoints ──────────────────────────────

@router.get("/decision-log")
def get_decision_log(limit: int = 50):
    """Returns the most recent agent decisions."""
    init_db()
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        'SELECT * FROM decision_log ORDER BY id DESC LIMIT ?', (limit,)
    ).fetchall()
    conn.close()
    return {"logs": [dict(r) for r in rows]}


@router.delete("/decision-log")
def clear_decision_log():
    """Clears all decision log entries."""
    init_db()
    conn = sqlite3.connect(get_db_path())
    conn.execute('DELETE FROM decision_log')
    conn.commit()
    conn.close()
    return {"message": "Decision log cleared"}


@router.get("/decision-log/stats")
def decision_log_stats():
    """Returns summary statistics about the decision log."""
    init_db()
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row

    total = conn.execute(
        'SELECT COUNT(*) as c FROM decision_log'
    ).fetchone()['c']

    by_type = conn.execute(
        'SELECT analysis_type, COUNT(*) as c FROM decision_log GROUP BY analysis_type'
    ).fetchall()

    avg_lift = conn.execute(
        'SELECT AVG(revenue_lift) as avg FROM decision_log WHERE revenue_lift IS NOT NULL'
    ).fetchone()['avg']

    most_used_product = conn.execute(
        'SELECT product_name, COUNT(*) as c FROM decision_log '
        'GROUP BY product_name ORDER BY c DESC LIMIT 1'
    ).fetchone()

    most_used_store = conn.execute(
        'SELECT store_name, COUNT(*) as c FROM decision_log '
        'GROUP BY store_name ORDER BY c DESC LIMIT 1'
    ).fetchone()

    conn.close()
    return {
        "total_decisions":       total,
        "by_type":               [dict(r) for r in by_type],
        "avg_revenue_lift":      round(avg_lift, 2) if avg_lift else 0,
        "most_analysed_product": most_used_product['product_name'] if most_used_product else None,
        "most_analysed_store":   most_used_store['store_name']     if most_used_store   else None,
    }

@router.get("/price-confidence")
def price_confidence(store: int = 1, item: int = 1, date: str = "2024-06-11"):
    """
    Computes a Price Confidence Score (0-100%) for the recommended optimal price.
    Blends three signals:
      1. Data depth   - how much real sales history exists for this product/store
      2. Agreement    - how close demand-only and competitor-aware prices are
      3. Volatility   - how stable recent demand has been (lower volatility = higher confidence)
    """
    import pandas as pd
    import numpy as np
    import os
    from data_pipeline.product_mapping import (
        get_product_info, get_store_name, get_current_price, calculate_current_stock
    )
    from agents.pricing_agent import optimise_price, optimise_price_no_competitors

    product   = get_product_info(item)
    PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')

    df = _DEMAND_DF  # already loaded once at module import - avoid re-reading 898K rows from disk
    subset = df[(df['store'] == store) & (df['item'] == item)].sort_values('date')

    # ── Signal 1: Data depth ───────────────────────────────────────
    # How many real historical records exist for this exact product/store?
    record_count = len(subset)
    # Scale: 0 records = 0%, 365+ records (a full year) = 100%
    data_depth_score = min(100, round((record_count / 365) * 100, 1))

    if record_count > 0:
        last       = subset.iloc[-1]
        lag_1      = float(last['lag_1'])
        lag_7      = float(last['lag_7'])
        lag_30     = float(last['lag_30'])
        rolling_7  = float(last['rolling_7'])
        rolling_30 = float(last['rolling_30'])
    else:
        lag_1 = lag_7 = lag_30 = rolling_7 = rolling_30 = 50.0

    # ── Signal 2: Volatility ────────────────────────────────────────
    # Use the last 30 days of actual sales to compute coefficient of variation
    if record_count >= 10:
        recent_sales = subset.tail(30)['sales'].values
        mean_sales   = float(np.mean(recent_sales))
        std_sales    = float(np.std(recent_sales))
        cv = (std_sales / mean_sales) if mean_sales > 0 else 1.0
        # Lower CV = more stable = higher confidence
        # CV of 0 = 100% confidence, CV of 1.0+ = 0% confidence
        volatility_score = max(0, min(100, round((1 - cv) * 100, 1)))
    else:
        volatility_score = 30.0  # low confidence default when too little data

    # ── Get pricing from both methods ──────────────────────────────
    price_info    = get_current_price(item, store, product['category'], PROCESSED)
    base_price    = price_info['current_price']
    stock_info    = calculate_current_stock(store, item, PROCESSED)

    from agents.demand_agent import predict_demand
    from agents.competitor_agents import get_competitor_price, COMPETITOR_PROFILES

    demand = predict_demand(
        store=store, item=item, date=date,
        lag_1=lag_1, lag_7=lag_7, lag_30=lag_30,
        rolling_7=rolling_7, rolling_30=rolling_30
    )

    competitors = []
    for supermarket in COMPETITOR_PROFILES.keys():
        cp = get_competitor_price(supermarket, product['category'], date)
        competitors.append({
            'supermarket': supermarket,
            'price':       cp['price'],
            'strategy':    cp['strategy'],
        })

    with_comp = optimise_price(
        predicted_demand_at_base = demand['predicted_units'],
        base_price               = base_price,
        competitor_prices        = competitors,
        category                 = product['category'],
    )
    without_comp = optimise_price_no_competitors(
        predicted_demand_at_base = demand['predicted_units'],
        base_price               = base_price,
        category                 = product['category'],
    )

    # ── Signal 3: Agreement ─────────────────────────────────────────
    # How close are the two pricing methods? Smaller gap = more confidence
    price_a = with_comp['optimal_price']
    price_b = without_comp['optimal_price']
    price_gap_pct = abs(price_a - price_b) / base_price * 100 if base_price > 0 else 100

    # Gap of 0% = 100% agreement, gap of 20%+ = 0% agreement
    agreement_score = max(0, min(100, round((1 - price_gap_pct / 20) * 100, 1)))

    # ── Blended confidence score ────────────────────────────────────
    # Weights: data depth 35%, agreement 35%, volatility 30%
    confidence_score = round(
        data_depth_score * 0.35 +
        agreement_score  * 0.35 +
        volatility_score * 0.30,
        1
    )

    confidence_label = (
        'HIGH'   if confidence_score >= 70 else
        'MEDIUM' if confidence_score >= 40 else
        'LOW'
    )

    return {
        'product_name':       product['name'],
        'store_name':         get_store_name(store),
        'category':           product['category'],
        'recommended_price':  price_a,
        'confidence_score':   confidence_score,
        'confidence_label':   confidence_label,
        'factors': {
            'data_depth': {
                'score':         data_depth_score,
                'record_count':  record_count,
                'label':         'Sales History Depth',
                'explanation':   f'{record_count} historical records found for this product/store combination.',
            },
            'agreement': {
                'score':              agreement_score,
                'price_with':         price_a,
                'price_without':      price_b,
                'price_gap_pct':      round(price_gap_pct, 2),
                'label':              'Method Agreement',
                'explanation':        f'Demand-only and competitor-aware pricing differ by {price_gap_pct:.1f}%.',
            },
            'volatility': {
                'score':       volatility_score,
                'label':       'Demand Stability',
                'explanation': 'Based on coefficient of variation in last 30 days of sales.' if record_count >= 10
                                else 'Insufficient sales history for volatility calculation.',
            },
        },
        'weights': {
            'data_depth': 0.35,
            'agreement':  0.35,
            'volatility': 0.30,
        },
    }
@router.get("/scenario-base")
def scenario_base(store: int = 1, item: int = 1, date: str = "2024-06-11"):
    """
    Returns the base data needed to run client-side scenario simulations:
    base price, base demand, competitor prices, and elasticity.
    The frontend uses this to simulate shocks instantly without further API calls.
    """
    import pandas as pd
    import os
    from data_pipeline.product_mapping import (
        get_product_info, get_store_name, get_current_price
    )
    from agents.demand_agent import predict_demand
    from agents.competitor_agents import get_competitor_price, COMPETITOR_PROFILES

    product   = get_product_info(item)
    PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')

    df = _DEMAND_DF  # already loaded once at module import - avoid re-reading 898K rows from disk
    subset = df[(df['store'] == store) & (df['item'] == item)].sort_values('date')

    if len(subset) > 0:
        last       = subset.iloc[-1]
        lag_1      = float(last['lag_1'])
        lag_7      = float(last['lag_7'])
        lag_30     = float(last['lag_30'])
        rolling_7  = float(last['rolling_7'])
        rolling_30 = float(last['rolling_30'])
    else:
        lag_1 = lag_7 = lag_30 = rolling_7 = rolling_30 = 50.0

    price_info = get_current_price(item, store, product['category'], PROCESSED)
    base_price = price_info['current_price']

    demand = predict_demand(
        store=store, item=item, date=date,
        lag_1=lag_1, lag_7=lag_7, lag_30=lag_30,
        rolling_7=rolling_7, rolling_30=rolling_30
    )

    competitors = []
    for supermarket in COMPETITOR_PROFILES.keys():
        cp = get_competitor_price(supermarket, product['category'], date)
        competitors.append({
            'supermarket': supermarket,
            'price':       cp['price'],
            'strategy':    cp['strategy'],
            'aggression':  COMPETITOR_PROFILES[supermarket]['aggression'],
        })

    from agents.pricing_agent import get_elasticity_for_category
    elasticity_used = get_elasticity_for_category(product['category'])

    return {
        'product_name':    product['name'],
        'store_name':      get_store_name(store),
        'category':        product['category'],
        'base_price':      base_price,
        'base_demand':     demand['predicted_units'],
        'price_elasticity': elasticity_used,
        'competitors':     competitors,
    }

@router.get("/weekly-forecast")
def weekly_forecast(store: int = 1, item: int = 1, date: str = "2024-06-11"):
    import pandas as pd
    import numpy as np
    import os
    from datetime import timedelta, datetime as dt
    from data_pipeline.product_mapping import get_product_info, get_store_name
    from agents.demand_agent import predict_demand

    product   = get_product_info(item)
    PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')

    df = _DEMAND_DF.copy()
    df['date'] = pd.to_datetime(df['date'])
    subset = df[(df['store'] == store) & (df['item'] == item)].sort_values('date')

    # data_anchor = last real date in dataset (Dec 31 2017)
    # display_anchor = today's real date
    # We show today's dates but use 2017 data underneath
    today = pd.Timestamp(dt.now().date())

    if len(subset) > 0:
        data_anchor = subset['date'].max()       # 2017-12-31
        date_offset = today - data_anchor        # shift forward to today
    else:
        data_anchor = pd.to_datetime(date)
        date_offset = pd.Timedelta(0)

    # ── Past 7 days: actual sales + model predictions ──
    past_window = subset[
        (subset['date'] > data_anchor - timedelta(days=7)) &
        (subset['date'] <= data_anchor)
    ].sort_values('date')

    past_days  = []
    abs_errors = []

    for _, row in past_window.iterrows():
        actual    = float(row['sales'])
        predicted = predict_demand(
            store=store, item=item,
            date=row['date'].strftime('%Y-%m-%d'),
            lag_1=float(row['lag_1']),
            lag_7=float(row['lag_7']),
            lag_30=float(row['lag_30']),
            rolling_7=float(row['rolling_7']),
            rolling_30=float(row['rolling_30'])
        )['predicted_units']

        abs_errors.append(abs(actual - predicted))

        # Shift date forward so it shows recent dates
        display_date = row['date'] + date_offset

        past_days.append({
            'date':       display_date.strftime('%Y-%m-%d'),
            'day_label':  display_date.strftime('%a %d %b'),
            'actual':     round(actual, 1),
            'predicted':  round(predicted, 1),
            'is_weekend': display_date.dayofweek >= 5,
            'type':       'historical',
        })

    mae         = round(float(np.mean(abs_errors)), 2) if abs_errors else None
    mean_actual = round(float(np.mean([d['actual'] for d in past_days])), 2) if past_days else None
    mape        = round((mae / mean_actual) * 100, 1) if mae and mean_actual and mean_actual > 0 else None

    # ── Next 7 days: forward forecast using today as anchor ──
    future_days = []

    if len(subset) > 0:
        last_known     = subset.iloc[-1]
        rolling_lag_1  = float(last_known['lag_1'])
        rolling_lag_7  = float(last_known['lag_7'])
        rolling_lag_30 = float(last_known['lag_30'])
        rolling_7avg   = float(last_known['rolling_7'])
        rolling_30avg  = float(last_known['rolling_30'])
    else:
        rolling_lag_1 = rolling_lag_7 = rolling_lag_30 = 50.0
        rolling_7avg  = rolling_30avg = 50.0

    recent_predictions = []

    for i in range(1, 8):
        # Use real future dates from today
        forecast_date = today + timedelta(days=i)

        predicted = predict_demand(
            store=store, item=item,
            date=forecast_date.strftime('%Y-%m-%d'),
            lag_1=rolling_lag_1,
            lag_7=rolling_lag_7,
            lag_30=rolling_lag_30,
            rolling_7=rolling_7avg,
            rolling_30=rolling_30avg
        )['predicted_units']

        future_days.append({
            'date':       forecast_date.strftime('%Y-%m-%d'),
            'day_label':  forecast_date.strftime('%a %d %b'),
            'forecast':   round(predicted, 1),
            'is_weekend': forecast_date.dayofweek >= 5,
            'type':       'forecast',
        })

        recent_predictions.append(predicted)
        rolling_lag_1 = predicted
        if len(recent_predictions) >= 7:
            rolling_7avg = float(np.mean(recent_predictions[-7:]))

    total_forecast_units = round(sum(d['forecast'] for d in future_days), 1)
    avg_forecast_per_day = round(total_forecast_units / 7, 1)
    weekend_uplift_pct   = None
    weekday_avg = np.mean([d['forecast'] for d in future_days if not d['is_weekend']])
    weekend_avg = np.mean([d['forecast'] for d in future_days if d['is_weekend']])
    if weekday_avg > 0 and not np.isnan(weekend_avg):
        weekend_uplift_pct = round(((weekend_avg - weekday_avg) / weekday_avg) * 100, 1)

    return {
        'product_name': product['name'],
        'store_name':   get_store_name(store),
        'category':     product['category'],
        'anchor_date':  today.strftime('%Y-%m-%d'),
        'past_days':    past_days,
        'future_days':  future_days,
        'accuracy': {
            'mae':  mae,
            'mape': mape,
        },
        'summary': {
            'total_forecast_units': total_forecast_units,
            'avg_forecast_per_day': avg_forecast_per_day,
            'weekend_uplift_pct':   weekend_uplift_pct,
        },
    }

@router.get("/market-position")
def market_position(store: int = 1, category: str = "fresh_food", date: str = "2024-06-11"):
    """
    Computes market position of our store vs all 5 competitors for a given category.
    Returns price index and value score for each player, suitable for a scatter plot.
    Price index: our price / market average (1.0 = at market, <1 = cheaper, >1 = premium)
    Value score: estimated demand relative to price — higher = better value perception
    """
    import pandas as pd
    import numpy as np
    import os
    from data_pipeline.product_mapping import (
        get_store_name, get_current_price, PRODUCT_MAP
    )
    from agents.competitor_agents import get_competitor_price, COMPETITOR_PROFILES

    PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')

    # ── Get all products in this category ────────────────────────
    category_items = [
        item_id for item_id, info in PRODUCT_MAP.items()
        if info['category'] == category
    ]

    if not category_items:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Category '{category}' not found")

    # ── Our average price for this category across all items ──────
    our_prices = []
    for item_id in category_items:
        price_info = get_current_price(item_id, store, category, PROCESSED)
        our_prices.append(price_info['current_price'])

    our_avg_price = float(np.mean(our_prices))

    # ── Competitor average prices for this category ───────────────
    competitor_data = {}
    for supermarket, profile in COMPETITOR_PROFILES.items():
        cp = get_competitor_price(supermarket, category, date)
        competitor_data[supermarket] = {
            'price':       cp['price'],
            'strategy':    profile['strategy'],
            'aggression':  profile['aggression'],
            'price_factor': profile['price_factor'],
        }

    # ── Market average (all players including us) ─────────────────
    all_prices = [our_avg_price] + [c['price'] for c in competitor_data.values()]
    market_avg = float(np.mean(all_prices))
    market_min = float(np.min(all_prices))
    market_max = float(np.max(all_prices))

    # ── Compute position scores for each player ───────────────────
    def compute_position(price, aggression, is_ours=False):
        # Price index: relative to market average
        # 1.0 = at market, 0.8 = 20% below, 1.2 = 20% above
        price_index = round(price / market_avg, 4)

        # Value score: inverse of price × aggression signal
        # Higher aggression + lower price = higher perceived value
        # Normalised 0-100
        price_rank = 1 - ((price - market_min) / (market_max - market_min + 0.001))
        value_score = round((price_rank * 0.7 + (1 - aggression) * 0.3) * 100, 1)

        return price_index, value_score

    # Our position
    our_price_index, our_value_score = compute_position(our_avg_price, 0.5, is_ours=True)

    players = [{
        'name':         'Our Store',
        'price':        round(our_avg_price, 2),
        'price_index':  our_price_index,
        'value_score':  our_value_score,
        'strategy':     'our_store',
        'aggression':   0.5,
        'is_ours':      True,
        'colour':       '#6366f1',
    }]

    supermarket_colours = {
        'Tesco':      '#003d7a',
        'Sainsburys': '#ff7700',
        'Aldi':       '#00529b',
        'Asda':       '#7dc242',
        'Morrisons':  '#ffd700',
    }

    for supermarket, data in competitor_data.items():
        price_index, value_score = compute_position(
            data['price'], data['aggression']
        )
        players.append({
            'name':         supermarket,
            'price':        round(data['price'], 2),
            'price_index':  price_index,
            'value_score':  value_score,
            'strategy':     data['strategy'],
            'aggression':   data['aggression'],
            'is_ours':      False,
            'colour':       supermarket_colours.get(supermarket, '#6366f1'),
        })

    # ── Quadrant classification for each player ───────────────────
    for p in players:
        if p['price_index'] < 1.0 and p['value_score'] >= 50:
            p['quadrant'] = 'Value Leader'
        elif p['price_index'] >= 1.0 and p['value_score'] >= 50:
            p['quadrant'] = 'Premium'
        elif p['price_index'] < 1.0 and p['value_score'] < 50:
            p['quadrant'] = 'Discount'
        else:
            p['quadrant'] = 'High Price Low Value'

    our_player = next(p for p in players if p['is_ours'])

    return {
        'category':     category,
        'store_name':   get_store_name(store),
        'market_avg':   round(market_avg, 2),
        'market_min':   round(market_min, 2),
        'market_max':   round(market_max, 2),
        'our_position': our_player['quadrant'],
        'players':      players,
        'insights': {
            'cheapest':    min(players, key=lambda p: p['price'])['name'],
            'most_expensive': max(players, key=lambda p: p['price'])['name'],
            'best_value':  max(players, key=lambda p: p['value_score'])['name'],
        }
    }
@router.get("/export-report")
def export_report(store: int = 1, item: int = 1, date: str = "2024-06-11"):
    """
    Generates a full HTML report of all key dissertation findings.
    Open in browser and Ctrl+P → Save as PDF.
    """
    from fastapi.responses import HTMLResponse
    import pandas as pd
    import numpy as np
    import os
    from data_pipeline.product_mapping import (
        get_product_info, get_store_name, get_current_price
    )
    from agents.demand_agent import predict_demand
    from agents.competitor_agents import get_competitor_price, COMPETITOR_PROFILES
    from agents.pricing_agent import optimise_price, optimise_price_no_competitors

    product   = get_product_info(item)
    PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')

    # ── Base data ────────────────────────────────────────────────
    price_info = get_current_price(item, store, product['category'], PROCESSED)
    base_price = price_info['current_price']

    df = _DEMAND_DF  # already loaded once at module import - avoid re-reading 898K rows from disk
    subset = df[(df['store'] == store) & (df['item'] == item)].sort_values('date')

    if len(subset) > 0:
        last       = subset.iloc[-1]
        lag_1      = float(last['lag_1'])
        lag_7      = float(last['lag_7'])
        lag_30     = float(last['lag_30'])
        rolling_7  = float(last['rolling_7'])
        rolling_30 = float(last['rolling_30'])
    else:
        lag_1 = lag_7 = lag_30 = rolling_7 = rolling_30 = 50.0

    demand = predict_demand(
        store=store, item=item, date=date,
        lag_1=lag_1, lag_7=lag_7, lag_30=lag_30,
        rolling_7=rolling_7, rolling_30=rolling_30
    )

    competitors = []
    for supermarket in COMPETITOR_PROFILES.keys():
        cp = get_competitor_price(supermarket, product['category'], date)
        competitors.append({
            'supermarket': supermarket,
            'price':       cp['price'],
            'strategy':    cp['strategy'],
        })

    with_comp    = optimise_price(
        predicted_demand_at_base=demand['predicted_units'],
        base_price=base_price, competitor_prices=competitors,
        category=product['category']
    )
    without_comp = optimise_price_no_competitors(
        predicted_demand_at_base=demand['predicted_units'],
        base_price=base_price, category=product['category']
    )

    revenue_lift     = with_comp['expected_revenue'] - without_comp['expected_revenue']
    revenue_lift_pct = (revenue_lift / without_comp['expected_revenue'] * 100) if without_comp['expected_revenue'] > 0 else 0

    avg_comp_price = np.mean([c['price'] for c in competitors])
    store_name     = get_store_name(store)

    from datetime import datetime
    generated_at = datetime.now().strftime('%d %B %Y, %H:%M')

    competitor_rows = ''.join([
        f"""<tr>
            <td>{c['supermarket']}</td>
            <td>£{c['price']:.2f}</td>
            <td>{c['strategy'].replace('_', ' ').title()}</td>
            <td>{'▲' if c['price'] > base_price else '▼'} {'Higher' if c['price'] > base_price else 'Lower'}</td>
        </tr>"""
        for c in competitors
    ])

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Retail Intelligence — Research Report</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: 'Segoe UI', Arial, sans-serif;
    background: #fff;
    color: #1a1a2e;
    font-size: 13px;
    line-height: 1.6;
  }}

  /* ── Cover page ── */
  .cover {{
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
    color: white;
    padding: 60px;
    page-break-after: always;
  }}
  .cover-badge {{
    background: #6366f1;
    color: white;
    padding: 6px 18px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 32px;
  }}
  .cover h1 {{
    font-size: 36px;
    font-weight: 700;
    margin-bottom: 16px;
    line-height: 1.2;
  }}
  .cover h2 {{
    font-size: 18px;
    font-weight: 400;
    color: #a5b4fc;
    margin-bottom: 40px;
    max-width: 600px;
  }}
  .cover-meta {{
    border-top: 1px solid rgba(255,255,255,0.2);
    padding-top: 30px;
    margin-top: 30px;
    color: #94a3b8;
    font-size: 13px;
    line-height: 2;
  }}
  .cover-rq {{
    background: rgba(99,102,241,0.2);
    border: 1px solid rgba(99,102,241,0.4);
    border-radius: 12px;
    padding: 20px 30px;
    margin: 30px 0;
    font-style: italic;
    color: #c7d2fe;
    font-size: 15px;
    max-width: 700px;
  }}

  /* ── Content pages ── */
  .page {{
    padding: 50px 60px;
    page-break-after: always;
  }}
  .page:last-child {{ page-break-after: auto; }}

  h2.section-title {{
    font-size: 22px;
    font-weight: 700;
    color: #1e1b4b;
    border-bottom: 3px solid #6366f1;
    padding-bottom: 10px;
    margin-bottom: 24px;
  }}
  h3.sub-title {{
    font-size: 15px;
    font-weight: 600;
    color: #312e81;
    margin: 20px 0 10px;
  }}

  /* ── Stat grid ── */
  .stat-grid {{
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin: 20px 0;
  }}
  .stat-card {{
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px;
    border-top: 4px solid #6366f1;
  }}
  .stat-value {{
    font-size: 24px;
    font-weight: 700;
    color: #6366f1;
    margin-bottom: 4px;
  }}
  .stat-label {{
    font-size: 11px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }}
  .stat-sub {{
    font-size: 11px;
    color: #94a3b8;
    margin-top: 4px;
  }}

  /* ── Finding box ── */
  .finding-box {{
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    border-left: 5px solid #6366f1;
    border-radius: 8px;
    padding: 18px 22px;
    margin: 20px 0;
    font-size: 13px;
    color: #1e1b4b;
    line-height: 1.8;
  }}
  .finding-box strong {{ color: #4338ca; }}

  /* ── Table ── */
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 12px;
  }}
  th {{
    background: #1e1b4b;
    color: white;
    padding: 10px 14px;
    text-align: left;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }}
  td {{
    padding: 9px 14px;
    border-bottom: 1px solid #e2e8f0;
    color: #374151;
  }}
  tr:nth-child(even) td {{ background: #f8fafc; }}

  /* ── Two-col layout ── */
  .two-col {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin: 20px 0;
  }}
  .info-block {{
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 18px;
  }}
  .info-block h4 {{
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    color: #64748b;
    letter-spacing: 0.05em;
    margin-bottom: 12px;
  }}
  .info-row {{
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid #e2e8f0;
    font-size: 12px;
  }}
  .info-row:last-child {{ border-bottom: none; }}
  .info-label {{ color: #64748b; }}
  .info-value {{ font-weight: 600; color: #1e1b4b; }}

  /* ── Progress bar ── */
  .progress-bar {{
    background: #e2e8f0;
    border-radius: 4px;
    height: 8px;
    margin: 4px 0 12px;
    overflow: hidden;
  }}
  .progress-fill {{
    height: 100%;
    border-radius: 4px;
    background: #6366f1;
  }}
  .progress-label {{
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #64748b;
    margin-bottom: 2px;
  }}

  /* ── Footer ── */
  .footer {{
    text-align: center;
    color: #94a3b8;
    font-size: 11px;
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid #e2e8f0;
  }}

  /* ── Print styles ── */
  @media print {{
    body {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    .cover {{ min-height: 100vh; }}
    .no-print {{ display: none !important; }}
  }}
</style>
</head>
<body>

<!-- ── COVER PAGE ── -->
<div class="cover">
  <div class="cover-badge">MSc Artificial Intelligence — Dissertation</div>
  <h1>Retail Intelligence<br>Multi-Agent AI System</h1>
  <h2>Dynamic Pricing & Demand Forecasting in UK Grocery Retail</h2>
  <div class="cover-rq">
    "To what extent does competitor pricing intelligence, mediated by autonomous AI agents,
    improve dynamic pricing decisions in UK grocery retail compared to demand-only models?"
  </div>
  <div class="cover-meta">
    <div><strong style="color:white">Product:</strong> {product['name']}</div>
    <div><strong style="color:white">Store:</strong> {store_name}</div>
    <div><strong style="color:white">Generated:</strong> {generated_at}</div>
    <div style="margin-top:12px;color:#6366f1">
      Stack: FastAPI · CrewAI · Ollama (Mistral 7B) · XGBoost · React · TypeScript
    </div>
  </div>
</div>

<!-- ── PAGE 1: ABLATION STUDY ── -->
<div class="page">
  <h2 class="section-title">1. Ablation Study — Core Dissertation Finding</h2>
  <p style="color:#64748b;margin-bottom:20px">
    Competitor-aware pricing vs demand-only pricing across 500 product-store combinations.
    This directly answers the research question.
  </p>

  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-value">500</div>
      <div class="stat-label">Combinations Tested</div>
      <div class="stat-sub">50 products × 10 stores</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">+1.33%</div>
      <div class="stat-label">Avg Revenue Improvement</div>
      <div class="stat-sub">Competitor-aware vs demand-only</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">93.4%</div>
      <div class="stat-label">Cases Improved</div>
      <div class="stat-sub">Of all 500 combinations</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">£786.51</div>
      <div class="stat-label">Total Revenue Lift</div>
      <div class="stat-sub">Across all 500 combinations</div>
    </div>
  </div>

  <div class="finding-box">
    <strong>Research Finding:</strong> Across 500 product-store combinations in a simulated
    UK grocery retail environment, competitor-aware multi-agent pricing improved expected
    revenue by an average of <strong>1.33%</strong> (median 1.30%) compared to demand-only
    pricing. Competitor intelligence produced positive revenue outcomes in
    <strong>93.4%</strong> of cases, with improvements ranging from -0.78% to +3.04%
    depending on product category and competitive positioning. The overall revenue lift
    across all combinations was <strong>£786.51 (+1.17%)</strong>.
  </div>

  <h3 class="sub-title">Single Product Example — {product['name']} at {store_name}</h3>
  <div class="two-col">
    <div class="info-block">
      <h4>With Competitor Intelligence</h4>
      <div class="info-row">
        <span class="info-label">Optimal Price</span>
        <span class="info-value">£{with_comp['optimal_price']:.2f}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Expected Revenue</span>
        <span class="info-value">£{with_comp['expected_revenue']:.2f}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Avg Competitor Price</span>
        <span class="info-value">£{with_comp['avg_competitor_price']:.2f}</span>
      </div>
    </div>
    <div class="info-block">
      <h4>Without Competitor Intelligence (Baseline)</h4>
      <div class="info-row">
        <span class="info-label">Optimal Price</span>
        <span class="info-value">£{without_comp['optimal_price']:.2f}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Expected Revenue</span>
        <span class="info-value">£{without_comp['expected_revenue']:.2f}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Revenue Lift</span>
        <span class="info-value" style="color:#16a34a">+£{revenue_lift:.2f} ({revenue_lift_pct:.1f}%)</span>
      </div>
    </div>
  </div>

  <div class="footer">Retail Intelligence — MSc AI Dissertation | {generated_at}</div>
</div>

<!-- ── PAGE 2: SYSTEM ARCHITECTURE ── -->
<div class="page">
  <h2 class="section-title">2. Multi-Agent System Architecture</h2>
  <p style="color:#64748b;margin-bottom:20px">
    9-agent CrewAI pipeline with Ollama (Mistral 7B) as the local LLM,
    coordinated by an Orchestrator Agent.
  </p>

  <table>
    <tr>
      <th>#</th><th>Agent</th><th>Role</th><th>Technology</th><th>Key Output</th>
    </tr>
    <tr><td>1</td><td>Demand Agent</td><td>Demand Forecasting</td><td>XGBoost + LLM</td><td>Predicted units sold</td></tr>
    <tr><td>2</td><td>Tesco Agent</td><td>Competitor Intelligence</td><td>Real price data + LLM</td><td>Market leader price signal</td></tr>
    <tr><td>3</td><td>Sainsbury's Agent</td><td>Competitor Intelligence</td><td>Real price data + LLM</td><td>Premium tier signal</td></tr>
    <tr><td>4</td><td>Aldi Agent</td><td>Competitor Intelligence</td><td>Real price data + LLM</td><td>Discount floor signal</td></tr>
    <tr><td>5</td><td>Asda Agent</td><td>Competitor Intelligence</td><td>Real price data + LLM</td><td>Value tier signal</td></tr>
    <tr><td>6</td><td>Morrisons Agent</td><td>Competitor Intelligence</td><td>Real price data + LLM</td><td>Value-fresh signal</td></tr>
    <tr><td>7</td><td>Pricing Agent</td><td>Price Optimisation</td><td>Elasticity model (e=−1.5)</td><td>Optimal price recommendation</td></tr>
    <tr><td>8</td><td>Inventory Agent</td><td>Stock Management</td><td>Sales history analysis</td><td>Reorder recommendations</td></tr>
    <tr><td>9</td><td>Orchestrator Agent</td><td>Synthesis</td><td>Mistral 7B via Ollama</td><td>Natural language narrative</td></tr>
  </table>

  <h3 class="sub-title">Competitor Price Intelligence — {product['name']}</h3>
  <table>
    <tr>
      <th>Supermarket</th><th>Category Price</th><th>Strategy</th><th>vs Our Price (£{base_price:.2f})</th>
    </tr>
    {competitor_rows}
  </table>

  <h3 class="sub-title">Technology Stack</h3>
  <div class="two-col">
    <div class="info-block">
      <h4>Backend</h4>
      <div class="info-row"><span class="info-label">API Framework</span><span class="info-value">FastAPI (Python)</span></div>
      <div class="info-row"><span class="info-label">Agent Framework</span><span class="info-value">CrewAI</span></div>
      <div class="info-row"><span class="info-label">Local LLM</span><span class="info-value">Ollama — Mistral 7B</span></div>
      <div class="info-row"><span class="info-label">ML Model</span><span class="info-value">XGBoost (scikit-learn)</span></div>
      <div class="info-row"><span class="info-label">Database</span><span class="info-value">SQLite (decision log)</span></div>
    </div>
    <div class="info-block">
      <h4>Frontend & Data</h4>
      <div class="info-row"><span class="info-label">UI Framework</span><span class="info-value">React + TypeScript</span></div>
      <div class="info-row"><span class="info-label">Styling</span><span class="info-value">Tailwind CSS</span></div>
      <div class="info-row"><span class="info-label">Charts</span><span class="info-value">Recharts</span></div>
      <div class="info-row"><span class="info-label">Demand Dataset</span><span class="info-value">Kaggle — 898K rows (2013–2017)</span></div>
      <div class="info-row"><span class="info-label">Competitor Dataset</span><span class="info-value">Kaggle — 9.5M rows (2024)</span></div>
    </div>
  </div>

  <div class="footer">Retail Intelligence — MSc AI Dissertation | {generated_at}</div>
</div>

<!-- ── PAGE 3: DEMAND MODEL ── -->
<div class="page">
  <h2 class="section-title">3. XGBoost Demand Forecasting Model</h2>

  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-value">7.77</div>
      <div class="stat-label">RMSE</div>
      <div class="stat-sub">Root mean squared error</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">6.01</div>
      <div class="stat-label">MAE</div>
      <div class="stat-sub">Mean absolute error</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">898K</div>
      <div class="stat-label">Training Rows</div>
      <div class="stat-sub">demand_enriched.csv</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">13</div>
      <div class="stat-label">Features</div>
      <div class="stat-sub">Lag + rolling + temporal</div>
    </div>
  </div>

  <h3 class="sub-title">Feature Importance</h3>
  <div class="progress-label"><span>rolling_7 (7-day rolling average)</span><span>47%</span></div>
  <div class="progress-bar"><div class="progress-fill" style="width:47%"></div></div>
  <div class="progress-label"><span>lag_7 (sales 7 days ago)</span><span>25%</span></div>
  <div class="progress-bar"><div class="progress-fill" style="width:25%"></div></div>
  <div class="progress-label"><span>is_weekend</span><span>10%</span></div>
  <div class="progress-bar"><div class="progress-fill" style="width:10%"></div></div>
  <div class="progress-label"><span>lag_1 (yesterday's sales)</span><span>8%</span></div>
  <div class="progress-bar"><div class="progress-fill" style="width:8%"></div></div>
  <div class="progress-label"><span>Other features (month, quarter, day_of_year etc.)</span><span>10%</span></div>
  <div class="progress-bar"><div class="progress-fill" style="width:10%"></div></div>

  <h3 class="sub-title">Live Prediction — {product['name']} at {store_name}</h3>
  <div class="two-col">
    <div class="info-block">
      <h4>Inputs Used</h4>
      <div class="info-row"><span class="info-label">lag_1</span><span class="info-value">{lag_1:.1f} units</span></div>
      <div class="info-row"><span class="info-label">lag_7</span><span class="info-value">{lag_7:.1f} units</span></div>
      <div class="info-row"><span class="info-label">lag_30</span><span class="info-value">{lag_30:.1f} units</span></div>
      <div class="info-row"><span class="info-label">rolling_7</span><span class="info-value">{rolling_7:.1f} units</span></div>
      <div class="info-row"><span class="info-label">rolling_30</span><span class="info-value">{rolling_30:.1f} units</span></div>
    </div>
    <div class="info-block">
      <h4>Prediction Output</h4>
      <div class="info-row"><span class="info-label">Predicted Units</span><span class="info-value">{demand['predicted_units']:.0f} units</span></div>
      <div class="info-row"><span class="info-label">Day of Week</span><span class="info-value">{demand['day_of_week']}</span></div>
      <div class="info-row"><span class="info-label">Weekend Flag</span><span class="info-value">{'Yes' if demand['is_weekend'] else 'No'}</span></div>
      <div class="info-row"><span class="info-label">Base Price</span><span class="info-value">£{base_price:.2f}</span></div>
      <div class="info-row"><span class="info-label">Optimal Price</span><span class="info-value">£{with_comp['optimal_price']:.2f}</span></div>
    </div>
  </div>

  <div class="finding-box">
    <strong>Model Note:</strong> The demand model was trained on anonymous store/item IDs
    (Kaggle Store Item Demand Forecasting dataset, 2013–2017). Product names are mapped
    synthetically. Price elasticity is assumed at −1.5 as elasticity data was not available
    in the training set. These limitations are documented in the dissertation methodology.
  </div>

  <div class="footer">Retail Intelligence — MSc AI Dissertation | {generated_at}</div>
</div>

<!-- ── PAGE 4: SENSITIVITY + CONFIDENCE ── -->
<div class="page">
  <h2 class="section-title">4. Sensitivity Analysis & Price Confidence</h2>

  <h3 class="sub-title">4.1 Elasticity Sensitivity Analysis</h3>
  <p style="color:#64748b;margin-bottom:16px">
    Tests robustness of competitor intelligence advantage across elasticity values −0.5 to −3.0.
    Addresses the key methodological limitation of assuming elasticity = −1.5.
  </p>
  <div class="finding-box">
    <strong>Finding:</strong> Competitor intelligence improved revenue in the majority of
    elasticity scenarios tested (−0.5 to −3.0 in steps of 0.1, 26 values total).
    At the dissertation's assumed elasticity of <strong>−1.5</strong>, the revenue lift
    is consistent with the ablation study results. Even where competitor intelligence
    reduces revenue (minority of cases), the magnitude is small — demonstrating
    <strong>robustness</strong> of the finding across elasticity assumptions.
  </div>

  <h3 class="sub-title">4.2 Price Confidence Score Methodology</h3>
  <p style="color:#64748b;margin-bottom:16px">
    A transparent, auditable confidence metric for each price recommendation.
    Addresses the "black box" criticism of automated pricing systems.
  </p>
  <table>
    <tr>
      <th>Signal</th><th>Weight</th><th>Measures</th><th>Range</th>
    </tr>
    <tr>
      <td>Data Depth</td><td>35%</td>
      <td>How many historical sales records exist for this product/store</td>
      <td>0 records = 0%, 365+ records = 100%</td>
    </tr>
    <tr>
      <td>Method Agreement</td><td>35%</td>
      <td>How close are competitor-aware and demand-only optimal prices</td>
      <td>0% gap = 100%, 20%+ gap = 0%</td>
    </tr>
    <tr>
      <td>Demand Stability</td><td>30%</td>
      <td>Coefficient of variation in last 30 days of sales</td>
      <td>CV=0 (stable) = 100%, CV≥1 (volatile) = 0%</td>
    </tr>
  </table>

  <h3 class="sub-title">4.3 Limitations & Future Work</h3>
  <div class="two-col">
    <div class="info-block">
      <h4>Known Limitations</h4>
      <div class="info-row"><span class="info-label">Elasticity</span><span class="info-value">Assumed −1.5 (not measured)</span></div>
      <div class="info-row"><span class="info-label">Demand data</span><span class="info-value">Anonymous IDs, 2013–2017</span></div>
      <div class="info-row"><span class="info-label">Shelf prices</span><span class="info-value">Synthetically generated</span></div>
      <div class="info-row"><span class="info-label">Stock levels</span><span class="info-value">Estimated from sales history</span></div>
      <div class="info-row"><span class="info-label">Competitor data</span><span class="info-value">Jan–Apr 2024 snapshot</span></div>
    </div>
    <div class="info-block">
      <h4>Future Extensions</h4>
      <div class="info-row"><span class="info-label">Real-time prices</span><span class="info-value">Trolley.co.uk API integration</span></div>
      <div class="info-row"><span class="info-label">Elasticity</span><span class="info-value">Estimate per category from POS data</span></div>
      <div class="info-row"><span class="info-label">Multi-store</span><span class="info-value">Cross-store demand spillover</span></div>
      <div class="info-row"><span class="info-label">Promotions</span><span class="info-value">Add promotion/discount agent</span></div>
      <div class="info-row"><span class="info-label">Retraining</span><span class="info-value">Weekly model retraining pipeline</span></div>
    </div>
  </div>

  <div class="footer">Retail Intelligence — MSc AI Dissertation | {generated_at}</div>
</div>

<!-- ── PAGE 5: CONCLUSION ── -->
<div class="page">
  <h2 class="section-title">5. Conclusion</h2>

  <div class="finding-box" style="font-size:14px;line-height:2">
    This research demonstrates that <strong>competitor pricing intelligence, mediated by
    autonomous AI agents, measurably improves dynamic pricing decisions</strong> in simulated
    UK grocery retail. Across 500 product-store combinations, the multi-agent system
    achieved a <strong>+1.33% average revenue improvement</strong> (median +1.30%) over
    demand-only pricing, with positive outcomes in <strong>93.4% of cases</strong>.<br><br>
    The 9-agent CrewAI architecture — combining XGBoost demand forecasting with real
    UK competitor price intelligence and Mistral 7B narrative generation — provides a
    technically sound, extensible foundation for automated retail pricing. The sensitivity
    analysis confirms this advantage is <strong>robust across a wide range of elasticity
    assumptions</strong>, addressing the key methodological limitation of the assumed
    elasticity parameter.<br><br>
    The Scenario Simulator, Price Confidence Score, and Market Position Map provide
    <strong>explainability and decision support</strong> layers that address the "black box"
    criticism common to automated pricing systems, making the recommendations auditable
    and trustworthy for retail practitioners.
  </div>

  <h3 class="sub-title">Research Question — Answered</h3>
  <div class="info-block" style="margin-top:16px">
    <div style="font-style:italic;color:#4338ca;margin-bottom:12px;font-size:13px">
      "To what extent does competitor pricing intelligence, mediated by autonomous AI agents,
      improve dynamic pricing decisions in UK grocery retail compared to demand-only models?"
    </div>
    <div style="color:#374151;line-height:1.8">
      <strong>Answer:</strong> Competitor pricing intelligence improves expected revenue by
      <strong>+1.33% on average</strong>, with positive outcomes in <strong>93.4%</strong>
      of product-store combinations tested. The improvement is statistically consistent
      (median +1.30%, range −0.78% to +3.04%) and robust across elasticity assumptions
      from −0.5 to −3.0. The multi-agent architecture successfully mediates this intelligence
      into actionable, explainable pricing recommendations.
    </div>
  </div>

  <div class="footer" style="margin-top:60px">
    <div>Retail Intelligence — Multi-Agent AI System for Dynamic Pricing & Demand Forecasting</div>
    <div>MSc Artificial Intelligence Dissertation | Generated: {generated_at}</div>
    <div style="margin-top:8px;color:#6366f1">
      FastAPI · CrewAI · Ollama (Mistral 7B) · XGBoost · React · TypeScript · Tailwind CSS
    </div>
  </div>
</div>

</body>
</html>"""

    return HTMLResponse(content=html)

def _fetch_sainsburys_live_raw(product_name: str) -> dict:
    """
    Performs the actual live HTTP call to Sainsbury's product-search API and
    applies the smart product-matching logic. Raises on network/HTTP/parsing
    failure so the caller can decide how to fall back; returns a dict with
    price=None if the call succeeds but no matching product is found.
    """
    import requests as req

    url = "https://www.sainsburys.co.uk/groceries-api/gol-services/product/v1/product"
    params = {
        'filter[keyword]': product_name,
        'page_number':     1,
        'page_size':       10,  # get more results for better matching
    }
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
    }
    r = req.get(url, params=params, headers=headers, timeout=10)
    r.raise_for_status()

    data     = r.json()
    products = data.get('products', [])

    best_product = None
    if products:
        # ── Smart product matching ────────────────────────
        # Score each result — prefer:
        # 1. Own-brand / standard products (not premium/TTD/freshly squeezed)
        # 2. Products with price in a realistic range
        # 3. Name contains key search terms
        search_terms = product_name.lower().split()
        premium_keywords = [
            'taste the difference', 'ttd', 'freshly squeezed',
            'not from concentrate', 'with bits', 'organic',
            'premium', 'finest', 'extra special'
        ]

        def score_product(p):
            name  = p.get('name', '').lower()
            retail = p.get('retail_price', {})
            price  = retail.get('price') if isinstance(retail, dict) else None
            if not price:
                return -1

            score = 0

            # Boost if name contains all search terms
            for term in search_terms:
                if term in name:
                    score += 2

            # Penalise premium products
            for kw in premium_keywords:
                if kw in name:
                    score -= 3

            # Boost own-brand / standard
            if "sainsbury's pure" in name or "sainsbury's british" in name:
                score += 3
            if "sainsbury's" in name:
                score += 1

            return score

        scored = sorted(products, key=score_product, reverse=True)
        best_product = scored[0]

    if not best_product:
        return {
            'supermarket':  'Sainsburys',
            'product_name': product_name,
            'price':        None,
            'unit_price':   None,
            'in_stock':     None,
            'source':       'LIVE — no results found',
            'is_live':      True,
        }

    retail     = best_product.get('retail_price', {})
    unit       = best_product.get('unit_price', {})
    price      = retail.get('price') if isinstance(retail, dict) else None
    unit_price = unit.get('price') if isinstance(unit, dict) else None

    return {
        'supermarket':  'Sainsburys',
        'product_name': best_product.get('name', product_name),
        'price':        round(float(price), 2) if price else None,
        'unit_price':   round(float(unit_price), 2) if unit_price else None,
        'in_stock':     best_product.get('is_available', True),
        'source':       'LIVE — sainsburys.co.uk',
        'is_live':      True,
    }


def _get_sainsburys_price(product_name: str) -> dict:
    """
    Cached, fallback-aware wrapper around the live Sainsbury's fetch.

    - A fresh cache hit (< _SAINSBURYS_CACHE_TTL_SECONDS old) is served
      without hitting the live API at all — protects against rate-limiting
      and speeds up repeated demo/testing requests for the same product.
    - If the live fetch fails (timeout, HTTP error, malformed response),
      falls back to the last known-good cached value for this product,
      clearly marked as stale/cached rather than silently returning
      price=None to the rest of the pricing pipeline.
    - Only returns a genuine "no data available" state if there is no
      prior cached value to fall back to at all (e.g. very first request
      for a product happens to fail).
    """
    from datetime import datetime

    key = product_name.strip().lower()
    now = datetime.now()
    cached = _SAINSBURYS_CACHE.get(key)

    if cached is not None:
        age_seconds = (now - cached['fetched_at']).total_seconds()
        if age_seconds < _SAINSBURYS_CACHE_TTL_SECONDS:
            hit = dict(cached['data'])
            hit['source']     = f"{hit['source']} (cached, {int(age_seconds)}s old)"
            hit['scraped_at'] = cached['fetched_at'].isoformat()
            hit['cache_hit']  = True
            return hit

    try:
        fresh = _fetch_sainsburys_live_raw(product_name)
        fresh['scraped_at'] = now.isoformat()
        fresh['cache_hit']  = False
        if fresh.get('price') is not None:
            _SAINSBURYS_CACHE[key] = {'data': fresh, 'fetched_at': now}
        return fresh

    except Exception as e:
        if cached is not None:
            # Live call failed — degrade to the last known-good price
            # instead of silently breaking the pricing pipeline.
            age_seconds = (now - cached['fetched_at']).total_seconds()
            stale = dict(cached['data'])
            stale['source'] = (
                f"CACHED (stale, {int(age_seconds)}s old) — live fetch failed: {e}"
            )
            stale['scraped_at'] = cached['fetched_at'].isoformat()
            stale['cache_hit']  = True
            stale['is_live']    = False
            return stale

        return {
            'supermarket':  'Sainsburys',
            'product_name': product_name,
            'price':        None,
            'unit_price':   None,
            'in_stock':     None,
            'source':       f'LIVE — error, no cache available: {e}',
            'scraped_at':   now.isoformat(),
            'is_live':      True,
            'cache_hit':    False,
        }


@router.get("/live-prices")
def live_prices(product_name: str = "whole milk", category: str = "fresh_food"):
    """
    Scrapes real-time prices from Trolley.co.uk for all UK supermarkets.
    Trolley aggregates prices from Tesco, Sainsbury's, Asda, Waitrose,
    Morrisons, Iceland and more — all in one request, no auth needed.
    Falls back to dataset prices for any supermarket not found.
    """
    import requests as req
    from bs4 import BeautifulSoup
    import re
    import numpy as np
    from datetime import datetime

    scraped_at = datetime.now().isoformat()

    # ── Supermarkets we care about ────────────────────
    TARGET_SUPERMARKETS = {
        'tesco':       'Tesco',
        'sainsbury':   'Sainsburys',
        'asda':        'Asda',
        'morrisons':   'Morrisons',
        'aldi':        'Aldi',
        'waitrose':    'Waitrose',
        'iceland':     'Iceland',
        'ocado':       'Ocado',
    }

    live_results = {}

    try:
        search_query = product_name.replace(' ', '+')
        r = req.get(
            f'https://www.trolley.co.uk/search/?q={search_query}',
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout=15
        )

        soup = BeautifulSoup(r.text, 'html.parser')
        items = soup.find_all('div', class_='product-item')

        for item in items:
            try:
                brand_div = item.find('div', class_='_brand')
                desc_div  = item.find('div', class_='_desc')
                size_div  = item.find('div', class_='_size')
                price_div = item.find('div', class_='_price')

                if not brand_div or not price_div:
                    continue

                brand_text = brand_div.get_text(strip=True)
                brand_lower = brand_text.lower()

                # Match to one of our target supermarkets
                matched_key = None
                for key in TARGET_SUPERMARKETS:
                    if key in brand_lower:
                        matched_key = key
                        break

                if not matched_key:
                    continue

                # Extract price from HTML
                raw_html    = str(price_div)
                pound_match = re.search(r'£([\d]+\.[\d]+)', raw_html)
                if not pound_match:
                    text_match = re.search(r'([\d]+\.[\d]+)', price_div.get_text())
                    if not text_match:
                        continue
                    price = float(text_match.group(1))
                else:
                    price = float(pound_match.group(1))

                supermarket_name = TARGET_SUPERMARKETS[matched_key]

                # Only keep first (most relevant) result per supermarket
                if supermarket_name not in live_results:
                    live_results[supermarket_name] = {
                        'supermarket':  supermarket_name,
                        'product_name': desc_div.get_text(strip=True) if desc_div else product_name,
                        'size':         size_div.get_text(strip=True) if size_div else '',
                        'price':        round(price, 2),
                        'source':       'LIVE — trolley.co.uk',
                        'scraped_at':   scraped_at,
                        'is_live':      True,
                    }
            except Exception:
                continue

    except Exception as e:
        print(f"Trolley scrape error: {e}")

    # ── Build final results list ──────────────────────
    # Our 5 core competitors
    core_supermarkets = ['Tesco', 'Sainsburys', 'Aldi', 'Asda', 'Morrisons']

    results = []
    for supermarket in core_supermarkets:
        if supermarket in live_results:
            results.append(live_results[supermarket])
        else:
            # Fallback to dataset for any not found on Trolley
            try:
                dataset_price = None
                if _COMPETITOR_DF is not None:
                    mask = _COMPETITOR_DF['supermarket'].str.lower().str.contains(
                        supermarket.lower().replace('sainsburys', 'sainsbury')
                    )
                    if mask.any():
                        dataset_price = round(
                            float(_COMPETITOR_DF[mask]['price'].median()), 2
                        )
                results.append({
                    'supermarket':  supermarket,
                    'product_name': product_name,
                    'size':         '',
                    'price':        dataset_price,
                    'source':       'Dataset — Jan-Apr 2024',
                    'scraped_at':   scraped_at,
                    'is_live':      False,
                })
            except Exception:
                results.append({
                    'supermarket':  supermarket,
                    'product_name': product_name,
                    'size':         '',
                    'price':        None,
                    'source':       'Unavailable',
                    'scraped_at':   scraped_at,
                    'is_live':      False,
                })

    # Also add any extra supermarkets found (Waitrose, Iceland etc.)
    for name, data in live_results.items():
        if name not in core_supermarkets:
            results.append(data)

    successful     = [r for r in results if r.get('price') is not None]
    live_count     = sum(1 for r in results if r.get('is_live') and r.get('price'))
    dataset_count  = sum(1 for r in results if not r.get('is_live') and r.get('price'))
    avg_live_price = round(float(np.mean([r['price'] for r in successful])), 2) if successful else None
    
    # ── Update live price cache ───────────────────────
    import time
    cache_key = category.lower()
    _LIVE_PRICE_CACHE[cache_key] = {}
    for r in results:
        if r.get('is_live') and r.get('price') is not None:
            _LIVE_PRICE_CACHE[cache_key][r['supermarket']] = r['price']
    _LIVE_PRICE_TIMESTAMP[cache_key] = time.time()
    print(f"✅ Live price cache updated for {category}: {_LIVE_PRICE_CACHE[cache_key]}")
    return {
        'status':             'ok',
        'product_name':       product_name,
        'category':           category,
        'live_prices':        results,
        'avg_live_price':     avg_live_price,
        'successful_lookups': len(successful),
        'live_lookups':       live_count,
        'dataset_lookups':    dataset_count,
        'source_note':        f'Trolley.co.uk live scrape — {live_count} supermarkets found live, {dataset_count} from dataset.',
    }


@router.get("/live-price-cache")
def live_price_cache_status():
    """Shows what's currently in the live price cache."""
    import time
    status = {}
    for category, prices in _LIVE_PRICE_CACHE.items():
        age = time.time() - _LIVE_PRICE_TIMESTAMP.get(category, 0)
        status[category] = {
            'prices':        prices,
            'age_seconds':   round(age),
            'is_fresh':      age < LIVE_PRICE_TTL_SECONDS,
            'expires_in':    max(0, round(LIVE_PRICE_TTL_SECONDS - age)),
        }
    return {
        'cache':     status,
        'ttl':       LIVE_PRICE_TTL_SECONDS,
        'total_categories_cached': len(_LIVE_PRICE_CACHE),
    }

@router.get("/weather")
def get_weather_endpoint(category: str = "fresh_food"):
    today = datetime.now().strftime('%Y-%m-%d')
    return get_weather_demand_multiplier(category, today)