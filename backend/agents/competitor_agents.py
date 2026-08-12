import pandas as pd
import numpy as np
import os
import time
from crewai import Agent, Task
from .base_config import get_llm

# ── Load competitor prices once ────────────────────────
_PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')
_prices_df = None
_category_medians: dict = {}

def _load_prices():
    global _prices_df, _category_medians
    if _category_medians:
        return
    print("Loading competitor price medians...")
    df = pd.read_csv(
        os.path.join(_PROCESSED, 'competitor_prices.csv'),
        usecols=['supermarket', 'category', 'price']
    )
    _category_medians = (
        df.groupby(['supermarket', 'category'])['price']
        .median()
        .to_dict()
    )
    print(f"✅ Competitor medians cached: {len(_category_medians)} pairs")


# ── Competitor strategy profiles ──────────────────────
COMPETITOR_PROFILES = {
    'Tesco': {
        'strategy':     'market_leader',
        'price_factor': 1.00,
        'description':  'UK market leader, matches or slightly undercuts rivals on key value items',
        'aggression':   0.3,
    },
    'Sainsburys': {
        'strategy':     'quality_premium',
        'price_factor': 1.08,
        'description':  'Premium positioning, higher prices justified by quality perception',
        'aggression':   0.2,
    },
    'Aldi': {
        'strategy':     'hard_discounter',
        'price_factor': 0.82,
        'description':  'Aggressive discounter, significantly lower prices, own-brand focus',
        'aggression':   0.8,
    },
    'Asda': {
        'strategy':     'everyday_low_price',
        'price_factor': 0.93,
        'description':  'Everyday low price strategy, consistently cheap across all categories',
        'aggression':   0.6,
    },
    'Morrisons': {
        'strategy':     'value_fresh',
        'price_factor': 0.97,
        'description':  'Value positioning with fresh food focus, slightly below Tesco',
        'aggression':   0.4,
    },
}


def get_competitor_price(supermarket: str, category: str, date: str) -> dict:
    """
    Returns competitor price — checks live Trolley cache first,
    falls back to dataset, then to price factor estimate.
    """
    profile = COMPETITOR_PROFILES.get(supermarket, COMPETITOR_PROFILES['Tesco'])

    # ── Try live cache from routes.py ────────────────
    try:
        from api.routes import (
            _LIVE_PRICE_CACHE, _LIVE_PRICE_TIMESTAMP, LIVE_PRICE_TTL_SECONDS
        )

        cache_key = category.lower()
        if cache_key in _LIVE_PRICE_CACHE:
            age = time.time() - _LIVE_PRICE_TIMESTAMP.get(cache_key, 0)
            if age < LIVE_PRICE_TTL_SECONDS:
                supermarket_key = supermarket.lower().replace('sainsburys', 'sainsbury')
                for cached_name, cached_price in _LIVE_PRICE_CACHE[cache_key].items():
                    if (supermarket_key in cached_name.lower() or
                            cached_name.lower() in supermarket_key):
                        return {
                            'supermarket': supermarket,
                            'category':    category,
                            'date':        date,
                            'price':       cached_price,
                            'strategy':    profile['strategy'],
                            'aggression':  profile['aggression'],
                            'source':      'LIVE — trolley.co.uk',
                        }
    except ImportError:
        pass
    except Exception:
        pass

    # ── Fall back to dataset ──────────────────────────
    _load_prices()
    key = (supermarket, category.lower())
    if key in _category_medians:
        return {
            'supermarket': supermarket,
            'category':    category,
            'date':        date,
            'price':       round(float(_category_medians[key]), 2),
            'strategy':    profile['strategy'],
            'aggression':  profile['aggression'],
            'source':      'dataset',
        }

    # ── Final fallback — price factor estimate ────────
    noise     = np.random.normal(0, 0.05)
    avg_price = round(2.50 * profile['price_factor'] * (1 + noise), 2)
    return {
        'supermarket': supermarket,
        'category':    category,
        'date':        date,
        'price':       avg_price,
        'strategy':    profile['strategy'],
        'aggression':  profile['aggression'],
        'source':      'estimated',
    }


def create_competitor_agent(supermarket: str) -> Agent:
    """Creates a CrewAI agent for a specific supermarket."""
    profile = COMPETITOR_PROFILES.get(supermarket, COMPETITOR_PROFILES['Tesco'])
    return Agent(
        role=f'{supermarket} Competitor Intelligence Agent',
        goal=(
            f'Monitor and analyse {supermarket} pricing strategy. '
            f'{supermarket} follows a {profile["strategy"]} approach: '
            f'{profile["description"]}'
        ),
        backstory=(
            f'You are a specialist retail analyst focused exclusively on {supermarket}. '
            f'You understand their pricing philosophy ({profile["strategy"]}) and can '
            f'predict how they will respond to market changes. Your aggression score '
            f'of {profile["aggression"]} reflects how actively they compete on price.'
        ),
        llm=get_llm(),
        verbose=False,
        allow_delegation=False,
    )


def create_competitor_task(
    supermarket: str,
    agent: Agent,
    category: str,
    date: str,
    our_price: float,
) -> Task:
    """Creates a pricing analysis task for a competitor agent."""
    price_data = get_competitor_price(supermarket, category, date)
    price      = price_data['price']
    profile    = COMPETITOR_PROFILES.get(supermarket, COMPETITOR_PROFILES['Tesco'])
    source     = price_data.get('source', 'dataset')

    price_diff = price - our_price
    direction  = 'higher' if price_diff > 0 else 'lower'

    return Task(
        description=(
            f'Analyse {supermarket}\'s current pricing for {category} products. '
            f'Their current price is £{price:.2f} (source: {source}), which is '
            f'£{abs(price_diff):.2f} {direction} than our price of £{our_price:.2f}. '
            f'Strategy: {profile["strategy"]}. Aggression: {profile["aggression"]}. '
            f'Provide a brief assessment of the competitive threat and recommended response.'
        ),
        expected_output=(
            f'A brief competitive analysis of {supermarket}\'s pricing position '
            f'and recommended pricing response for {category}.'
        ),
        agent=agent,
    )