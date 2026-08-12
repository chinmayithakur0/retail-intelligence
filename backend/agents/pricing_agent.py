import numpy as np
from crewai import Agent, Task
from .base_config import get_llm


DEFAULT_ELASTICITY = -1.5


def optimise_price(predicted_demand_at_base: float,
                   base_price: float,
                   competitor_prices: list,
                   price_elasticity: float = None,
                   category: str = None) -> dict:
    if price_elasticity is None:
        price_elasticity = DEFAULT_ELASTICITY

    min_price  = base_price * 0.70
    max_price  = base_price * 1.40
    price_range = np.arange(min_price, max_price, 0.05)

    best_price   = base_price
    best_revenue = 0
    results      = []

    avg_competitor = np.mean([c['price'] for c in competitor_prices])

    for price in price_range:
        price_change_pct  = (price - base_price) / base_price
        demand_change_pct = price_elasticity * price_change_pct
        adjusted_demand   = predicted_demand_at_base * (1 + demand_change_pct)
        adjusted_demand   = max(0, adjusted_demand)

        comp_diff = (avg_competitor - price) / avg_competitor
        adjusted_demand = adjusted_demand * (1 + 0.1 * comp_diff)

        revenue = price * adjusted_demand
        results.append({
            'price':   round(price, 2),
            'demand':  round(adjusted_demand, 2),
            'revenue': round(revenue, 2),
        })

        if revenue > best_revenue:
            best_revenue = revenue
            best_price   = price

    results_sorted = sorted(results, key=lambda x: x['revenue'], reverse=True)

    return {
        'optimal_price':         round(best_price, 2),
        'expected_demand':       round(predicted_demand_at_base * (
                                     1 + price_elasticity *
                                     (best_price - base_price) / base_price
                                 ), 2),
        'expected_revenue':      round(best_revenue, 2),
        'base_price':            round(base_price, 2),
        'avg_competitor_price':  round(avg_competitor, 2),
        'price_vs_competitor':   round(best_price - avg_competitor, 2),
        'top_3_options':         results_sorted[:3],
        'price_elasticity_used': price_elasticity,
    }


def optimise_price_no_competitors(predicted_demand_at_base: float,
                                   base_price: float,
                                   price_elasticity: float = None,
                                   category: str = None) -> dict:
    if price_elasticity is None:
        price_elasticity = DEFAULT_ELASTICITY

    min_price  = base_price * 0.70
    max_price  = base_price * 1.40
    price_range = np.arange(min_price, max_price, 0.05)

    best_price   = base_price
    best_revenue = 0
    results      = []

    for price in price_range:
        price_change_pct  = (price - base_price) / base_price
        demand_change_pct = price_elasticity * price_change_pct
        adjusted_demand   = predicted_demand_at_base * (1 + demand_change_pct)
        adjusted_demand   = max(0, adjusted_demand)

        revenue = price * adjusted_demand
        results.append({
            'price':   round(price, 2),
            'demand':  round(adjusted_demand, 2),
            'revenue': round(revenue, 2),
        })

        if revenue > best_revenue:
            best_revenue = revenue
            best_price   = price

    results_sorted = sorted(results, key=lambda x: x['revenue'], reverse=True)

    return {
        'optimal_price':         round(best_price, 2),
        'expected_demand':       round(predicted_demand_at_base * (
                                     1 + price_elasticity *
                                     (best_price - base_price) / base_price
                                 ), 2),
        'expected_revenue':      round(best_revenue, 2),
        'base_price':            round(base_price, 2),
        'top_3_options':         results_sorted[:3],
        'price_elasticity_used': price_elasticity,
    }


def get_elasticity_for_category(category: str = None) -> float:
    return DEFAULT_ELASTICITY


def create_pricing_agent() -> Agent:
    return Agent(
        role='Dynamic Pricing Optimisation Specialist',
        goal=(
            'Determine the optimal price for products to maximise revenue '
            'while remaining competitive against UK supermarket rivals.'
        ),
        backstory=(
            'You are an expert pricing strategist with deep knowledge of '
            'UK grocery retail economics, price elasticity, and competitive '
            'dynamics. You balance revenue maximisation with market share '
            'protection, always considering what Tesco, Sainsburys, Aldi, '
            'Asda and Morrisons are doing.'
        ),
        llm=get_llm(),
        verbose=True,
        allow_delegation=False,
    )


def create_pricing_task(agent: Agent, context: dict) -> Task:
    return Task(
        description=f"""
        Determine the optimal price for the following product:

        - Category: {context.get('category', 'fresh_food')}
        - Current base price: £{context.get('base_price', 2.50)}
        - Predicted demand at base price: {context.get('predicted_demand', 50)} units
        - Competitor prices: {context.get('competitor_prices', [])}

        Use the optimise_price logic to find the best price point, then provide:
        1. The recommended optimal price
        2. Expected demand and revenue at that price
        3. How it compares to competitors
        4. The pricing rationale and strategy recommendation
        5. Risk assessment if competitors respond aggressively
        """,
        expected_output=(
            'A pricing recommendation including optimal price, '
            'revenue projection, competitive positioning, and strategic rationale.'
        ),
        agent=agent,
    )