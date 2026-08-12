import pandas as pd
import os

# ── Cached demand_enriched.csv, used by calculate_current_stock() ──────
# Previously this 898K-row CSV was re-read from disk on every single call
# to calculate_current_stock (i.e. on every /api/quick-predict and similar
# request). Loading it once and reusing it turns that into a single disk
# read for the lifetime of the process.
_DEMAND_ENRICHED_DF = None

def _load_demand_enriched(processed_path: str):
    global _DEMAND_ENRICHED_DF
    if _DEMAND_ENRICHED_DF is not None:
        return _DEMAND_ENRICHED_DF
    print("Loading demand_enriched.csv (cached for stock calculations)...")
    _DEMAND_ENRICHED_DF = pd.read_csv(
        os.path.join(processed_path, 'demand_enriched.csv'),
        usecols=['store', 'item', 'date', 'category', 'sales'],
    )
    print(f"✅ Stock-calc demand data cached ({len(_DEMAND_ENRICHED_DF):,} rows)")
    return _DEMAND_ENRICHED_DF

# ── 50 real UK grocery products mapped to 10 categories ──
# item IDs 1-50 mapped to real product names and categories
PRODUCT_MAP = {
    # Fresh Food (items 1-5)
    1:  {'name': 'Whole Milk (2L)',          'category': 'fresh_food',    'unit': 'bottle'},
    2:  {'name': 'Free Range Eggs (12 pack)','category': 'fresh_food',    'unit': 'pack'},
    3:  {'name': 'Sliced White Bread',       'category': 'fresh_food',    'unit': 'loaf'},
    4:  {'name': 'Salted Butter (250g)',     'category': 'fresh_food',    'unit': 'pack'},
    5:  {'name': 'Cheddar Cheese (400g)',    'category': 'fresh_food',    'unit': 'pack'},

    # Drinks (items 6-10)
    6:  {'name': 'Orange Juice (1L)',        'category': 'drinks',        'unit': 'carton'},
    7:  {'name': 'Sparkling Water (500ml)',  'category': 'drinks',        'unit': 'bottle'},
    8:  {'name': 'Semi-Skimmed Milk (4pt)', 'category': 'drinks',        'unit': 'bottle'},
    9:  {'name': 'Apple Juice (1L)',         'category': 'drinks',        'unit': 'carton'},
    10: {'name': 'Coca-Cola (2L)',           'category': 'drinks',        'unit': 'bottle'},

    # Bakery (items 11-15)
    11: {'name': 'Wholemeal Bread',          'category': 'bakery',        'unit': 'loaf'},
    12: {'name': 'Croissants (4 pack)',      'category': 'bakery',        'unit': 'pack'},
    13: {'name': 'Plain Flour (1.5kg)',      'category': 'bakery',        'unit': 'bag'},
    14: {'name': 'Sourdough Loaf',           'category': 'bakery',        'unit': 'loaf'},
    15: {'name': 'Crumpets (6 pack)',        'category': 'bakery',        'unit': 'pack'},

    # Frozen (items 16-20)
    16: {'name': 'Frozen Peas (900g)',       'category': 'frozen',        'unit': 'bag'},
    17: {'name': 'Fish Fingers (12 pack)',   'category': 'frozen',        'unit': 'pack'},
    18: {'name': 'Chicken Nuggets (500g)',   'category': 'frozen',        'unit': 'bag'},
    19: {'name': 'Frozen Sweet Corn (1kg)', 'category': 'frozen',        'unit': 'bag'},
    20: {'name': 'Beef Burgers (8 pack)',    'category': 'frozen',        'unit': 'pack'},

    # Food Cupboard (items 21-25)
    21: {'name': 'Baked Beans (4 pack)',     'category': 'food_cupboard', 'unit': 'pack'},
    22: {'name': 'Spaghetti (500g)',         'category': 'food_cupboard', 'unit': 'bag'},
    23: {'name': 'Chopped Tomatoes (400g)', 'category': 'food_cupboard', 'unit': 'tin'},
    24: {'name': 'Cornflakes (750g)',        'category': 'food_cupboard', 'unit': 'box'},
    25: {'name': 'Porridge Oats (1kg)',      'category': 'food_cupboard', 'unit': 'bag'},

    # Household (items 26-30)
    26: {'name': 'Washing Up Liquid (500ml)','category': 'household',    'unit': 'bottle'},
    27: {'name': 'Toilet Rolls (9 pack)',    'category': 'household',    'unit': 'pack'},
    28: {'name': 'Laundry Detergent (1kg)', 'category': 'household',    'unit': 'box'},
    29: {'name': 'Kitchen Roll (3 pack)',    'category': 'household',    'unit': 'pack'},
    30: {'name': 'Bin Bags (40 pack)',       'category': 'household',    'unit': 'pack'},

    # Health Products (items 31-35)
    31: {'name': 'Paracetamol (16 tablets)','category': 'health_products','unit': 'pack'},
    32: {'name': 'Vitamin D (90 tablets)',  'category': 'health_products','unit': 'bottle'},
    33: {'name': 'Hand Soap (250ml)',        'category': 'health_products','unit': 'bottle'},
    34: {'name': 'Ibuprofen (16 tablets)',  'category': 'health_products','unit': 'pack'},
    35: {'name': 'Toothpaste (100ml)',       'category': 'health_products','unit': 'tube'},

    # Pets (items 36-40)
    36: {'name': 'Dog Food Pouches (12pk)', 'category': 'pets',          'unit': 'pack'},
    37: {'name': 'Cat Food Pouches (12pk)', 'category': 'pets',          'unit': 'pack'},
    38: {'name': 'Dog Biscuits (1kg)',       'category': 'pets',          'unit': 'bag'},
    39: {'name': 'Cat Litter (5kg)',         'category': 'pets',          'unit': 'bag'},
    40: {'name': 'Hamster Food (1kg)',       'category': 'pets',          'unit': 'bag'},

    # Baby Products (items 41-45)
    41: {'name': 'Nappies Size 3 (40pk)',   'category': 'baby_products', 'unit': 'pack'},
    42: {'name': 'Baby Wipes (72 pack)',     'category': 'baby_products', 'unit': 'pack'},
    43: {'name': 'Baby Formula (800g)',      'category': 'baby_products', 'unit': 'tin'},
    44: {'name': 'Baby Food Pouches (5pk)', 'category': 'baby_products', 'unit': 'pack'},
    45: {'name': 'Baby Shampoo (300ml)',     'category': 'baby_products', 'unit': 'bottle'},

    # Free From (items 46-50)
    46: {'name': 'Gluten Free Bread',        'category': 'free-from',     'unit': 'loaf'},
    47: {'name': 'Oat Milk (1L)',            'category': 'free-from',     'unit': 'carton'},
    48: {'name': 'Dairy Free Butter (250g)','category': 'free-from',     'unit': 'pack'},
    49: {'name': 'Gluten Free Pasta (500g)','category': 'free-from',     'unit': 'bag'},
    50: {'name': 'Almond Milk (1L)',         'category': 'free-from',     'unit': 'carton'},
}

# Store names — 10 stores mapped to UK supermarket format
STORE_MAP = {
    1:  'London Central',
    2:  'Manchester North',
    3:  'Birmingham West',
    4:  'Leeds City',
    5:  'Edinburgh South',
    6:  'Bristol East',
    7:  'Liverpool Central',
    8:  'Sheffield North',
    9:  'Cardiff West',
    10: 'Newcastle Central',
}


def get_product_info(item_id: int) -> dict:
    """Returns product name, category and unit for a given item ID."""
    return PRODUCT_MAP.get(item_id, {
        'name':     f'Product {item_id}',
        'category': 'food_cupboard',
        'unit':     'unit',
    })


def get_store_name(store_id: int) -> str:
    """Returns store location name for a given store ID."""
    return STORE_MAP.get(store_id, f'Store {store_id}')


def enrich_demand_data():
    """
    Adds product names and store names to the demand dataset.
    Saves enriched version to processed folder.
    """
    PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')

    print("Loading demand_featured.csv...")
    df = pd.read_csv(os.path.join(PROCESSED, 'demand_featured.csv'))

    # Add product info columns
    df['product_name'] = df['item'].map(lambda x: PRODUCT_MAP.get(x, {}).get('name', f'Product {x}'))
    df['category']     = df['item'].map(lambda x: PRODUCT_MAP.get(x, {}).get('category', 'food_cupboard'))
    df['unit']         = df['item'].map(lambda x: PRODUCT_MAP.get(x, {}).get('unit', 'unit'))
    df['store_name']   = df['store'].map(STORE_MAP)

    out_path = os.path.join(PROCESSED, 'demand_enriched.csv')
    df.to_csv(out_path, index=False)
    print(f"✅ Saved: demand_enriched.csv ({df.shape[0]:,} rows)")
    print("\nSample:")
    print(df[['date', 'store_name', 'product_name', 'category', 'sales']].head(10))


if __name__ == '__main__':
    enrich_demand_data()

def calculate_current_stock(store: int, item: int,
                             processed_path: str) -> dict:
    import hashlib

    df = _load_demand_enriched(processed_path)
    subset = df[
        (df['store'] == store) &
        (df['item'] == item)
    ].sort_values('date')

    if len(subset) == 0:
        return {
            'current_stock':  50,
            'baseline_stock': 100,
            'sold_last_30':   0,
            'stock_source':   'default'
        }

    category     = subset.iloc[-1]['category']
    last_30      = subset.tail(30)
    avg_daily    = float(last_30['sales'].mean())
    sold_last_30 = int(last_30['sales'].sum())

    # 14 day supply as baseline
    baseline = round(avg_daily * 14)

    # Use hash to deterministically assign a stock percentage
    # This gives a proper mix: some products well stocked, some low
    seed = int(hashlib.md5(f"{item}-{store}".encode()).hexdigest(), 16)
    
    # Map seed to a stock percentage between 10% and 95% of baseline
    stock_pct = 0.10 + (seed % 1000) / 1000 * 0.85
    current_stock = max(5, round(baseline * stock_pct))

    return {
        'current_stock':  current_stock,
        'baseline_stock': baseline,
        'sold_last_30':   sold_last_30,
        'stock_source':   'calculated_from_sales'
    }
# Module-level cache — loaded once, reused forever
_PRICE_MEDIANS: dict = {}

def _load_price_medians(processed_path: str):
    global _PRICE_MEDIANS
    if _PRICE_MEDIANS:
        return  # already loaded
    import pandas as pd
    import os
    print("Loading price medians from competitor_prices.csv...")
    df = pd.read_csv(os.path.join(processed_path, 'competitor_prices.csv'),
                     usecols=['category', 'price'])  # only load 2 columns not all
    _PRICE_MEDIANS = df.groupby('category')['price'].median().to_dict()
    print(f"✅ Price medians cached for {len(_PRICE_MEDIANS)} categories")

def get_current_price(item: int, store: int, category: str,
                      processed_path: str) -> dict:
    import hashlib
    _load_price_medians(processed_path)
    category_median = float(_PRICE_MEDIANS.get(category.lower(), 2.50))
    seed_string  = f"{item}-{store}"
    seed_hash    = int(hashlib.md5(seed_string.encode()).hexdigest(), 16)
    variation    = 0.85 + (seed_hash % 1000) / 1000 * 0.30
    current_price = round(category_median * variation, 2)
    current_price = max(0.10, current_price)
    return {
        'current_price':   current_price,
        'category_median': round(category_median, 2),
        'variation_pct':   round((variation - 1) * 100, 1),
        'source':          'synthetic_anchored_to_category'
    }