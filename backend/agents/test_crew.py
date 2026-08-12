from orchestrator_agent import run_crew
import json

result = run_crew({
    'store':          1,
    'item':           1,
    'category':       'fresh_food',
    'date':           '2024-06-11',
    'current_stock':  80,
    'base_price':     2.50,
    'lag_1':          52,
    'lag_7':          48,
    'lag_30':         45,
    'rolling_7':      50,
    'rolling_30':     47,
    'lead_time_days': 3,
    'safety_stock_days': 7,
})

print("\n" + "="*60)
print("FINAL CREW OUTPUT")
print("="*60)
print(f"Predicted demand:  {result['demand']['predicted_units']} units")
print(f"Optimal price:     £{result['pricing']['optimal_price']}")
print(f"Expected revenue:  £{result['pricing']['expected_revenue']}")
print(f"Inventory status:  {result['inventory']['status']}")
print(f"\nNARRATIVE:\n{result['narrative']}")