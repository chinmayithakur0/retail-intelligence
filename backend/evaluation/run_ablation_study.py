import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pandas as pd
import json
from agents.demand_agent import predict_demand
from agents.competitor_agents import get_competitor_price, COMPETITOR_PROFILES
from agents.pricing_agent import optimise_price, optimise_price_no_competitors
from data_pipeline.product_mapping import PRODUCT_MAP, STORE_MAP, get_product_info, get_store_name, get_current_price

PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')
DATE = "2024-06-11"


def run_single_ablation(store: int, item: int, df: pd.DataFrame) -> dict:
    """Runs the ablation comparison for a single store/item combination."""
    product = get_product_info(item)

    subset = df[(df['store'] == store) & (df['item'] == item)].sort_values('date')
    if len(subset) == 0:
        return None

    last = subset.iloc[-1]
    lag_1      = float(last['lag_1'])
    lag_7      = float(last['lag_7'])
    lag_30     = float(last['lag_30'])
    rolling_7  = float(last['rolling_7'])
    rolling_30 = float(last['rolling_30'])

    demand = predict_demand(
        store=store, item=item, date=DATE,
        lag_1=lag_1, lag_7=lag_7, lag_30=lag_30,
        rolling_7=rolling_7, rolling_30=rolling_30
    )

    price_info = get_current_price(item, store, product['category'], PROCESSED)
    base_price = price_info['current_price']

    competitors = []
    for supermarket in COMPETITOR_PROFILES.keys():
        cp = get_competitor_price(supermarket, product['category'], DATE)
        competitors.append({'supermarket': supermarket, 'price': cp['price'], 'strategy': cp['strategy']})

    with_comp = optimise_price(
        predicted_demand_at_base=demand['predicted_units'],
        base_price=base_price,
        competitor_prices=competitors,
    )
    without_comp = optimise_price_no_competitors(
        predicted_demand_at_base=demand['predicted_units'],
        base_price=base_price,
    )

    revenue_with    = with_comp['expected_revenue']
    revenue_without = without_comp['expected_revenue']
    revenue_diff    = revenue_with - revenue_without
    revenue_diff_pct = (revenue_diff / revenue_without * 100) if revenue_without > 0 else 0

    return {
        'store':            store,
        'store_name':       get_store_name(store),
        'item':             item,
        'product_name':     product['name'],
        'category':         product['category'],
        'base_price':       base_price,
        'predicted_demand': demand['predicted_units'],
        'price_with':       with_comp['optimal_price'],
        'price_without':    without_comp['optimal_price'],
        'price_diff':       round(with_comp['optimal_price'] - without_comp['optimal_price'], 2),
        'revenue_with':     revenue_with,
        'revenue_without':  revenue_without,
        'revenue_diff':     round(revenue_diff, 2),
        'revenue_diff_pct': round(revenue_diff_pct, 2),
    }


def main():
    print("Loading demand data...")
    df = pd.read_csv(os.path.join(PROCESSED, 'demand_enriched.csv'))

    results = []
    total = len(STORE_MAP) * len(PRODUCT_MAP)
    count = 0

    print(f"Running ablation study across {total} store/item combinations...")
    for store in STORE_MAP.keys():
        for item in PRODUCT_MAP.keys():
            count += 1
            r = run_single_ablation(store, item, df)
            if r:
                results.append(r)
            if count % 50 == 0:
                print(f"  Progress: {count}/{total}")

    print(f"\nCompleted {len(results)} combinations.")

    # Save raw results
    results_df = pd.DataFrame(results)
    out_path = os.path.join(PROCESSED, 'ablation_study_results.csv')
    results_df.to_csv(out_path, index=False)
    print(f"✅ Saved: ablation_study_results.csv")

    # ── Aggregate statistics ───────────────────────────
    summary = {
        'total_combinations':       len(results),
        'avg_revenue_diff_pct':     round(results_df['revenue_diff_pct'].mean(), 2),
        'median_revenue_diff_pct':  round(results_df['revenue_diff_pct'].median(), 2),
        'min_revenue_diff_pct':     round(results_df['revenue_diff_pct'].min(), 2),
        'max_revenue_diff_pct':     round(results_df['revenue_diff_pct'].max(), 2),
        'pct_positive':             round((results_df['revenue_diff_pct'] > 0).mean() * 100, 1),
        'pct_negative':             round((results_df['revenue_diff_pct'] < 0).mean() * 100, 1),
        'avg_price_diff':           round(results_df['price_diff'].mean(), 3),
        'total_revenue_with':       round(results_df['revenue_with'].sum(), 2),
        'total_revenue_without':    round(results_df['revenue_without'].sum(), 2),
        'total_revenue_diff':       round(results_df['revenue_with'].sum() - results_df['revenue_without'].sum(), 2),
        'total_revenue_diff_pct':   round((results_df['revenue_with'].sum() - results_df['revenue_without'].sum()) / results_df['revenue_without'].sum() * 100, 2),
    }

    # By category
    category_summary = results_df.groupby('category').agg(
        avg_revenue_diff_pct=('revenue_diff_pct', 'mean'),
        avg_price_diff=('price_diff', 'mean'),
        count=('item', 'count')
    ).round(2).to_dict('index')

    summary['by_category'] = category_summary

    summary_path = os.path.join(PROCESSED, 'ablation_study_summary.json')
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)
    print(f"✅ Saved: ablation_study_summary.json")

    # ── Print headline results ─────────────────────────
    print("\n" + "="*60)
    print("ABLATION STUDY — HEADLINE RESULTS")
    print("="*60)
    print(f"Total combinations tested: {summary['total_combinations']}")
    print(f"Average revenue improvement: {summary['avg_revenue_diff_pct']}%")
    print(f"Median revenue improvement:  {summary['median_revenue_diff_pct']}%")
    print(f"Range: {summary['min_revenue_diff_pct']}% to {summary['max_revenue_diff_pct']}%")
    print(f"Products where competitor agents IMPROVED revenue: {summary['pct_positive']}%")
    print(f"Products where competitor agents REDUCED revenue:  {summary['pct_negative']}%")
    print(f"\nTOTAL revenue with competitor agents:    £{summary['total_revenue_with']:,.2f}")
    print(f"TOTAL revenue without competitor agents: £{summary['total_revenue_without']:,.2f}")
    print(f"OVERALL improvement: £{summary['total_revenue_diff']:,.2f} ({summary['total_revenue_diff_pct']}%)")


if __name__ == '__main__':
    main()