import pandas as pd
import numpy as np
import os

# ── Paths ──────────────────────────────────────────────
RAW = os.path.join(os.path.dirname(__file__), '../../data/raw')
PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')
os.makedirs(PROCESSED, exist_ok=True)

# ── Step 1: Load & combine all supermarket files ───────
print("Loading supermarket datasets...")
files = {
    'Aldi':       'All_Data_Aldi.csv',
    'Asda':       'All_Data_ASDA.csv',
    'Morrisons':  'All_Data_Morrisons.csv',
    'Sainsburys': 'All_Data_Sains.csv',
    'Tesco':      'All_Data_Tesco.csv',
}

dfs = []
for name, file in files.items():
    df = pd.read_csv(os.path.join(RAW, file), low_memory=False)
    df['supermarket'] = name  # standardise name
    dfs.append(df)

prices = pd.concat(dfs, ignore_index=True)
print(f"Combined shape: {prices.shape}")

# ── Step 2: Clean supermarket data ─────────────────────
print("Cleaning supermarket data...")

# Rename columns for clarity
prices.rename(columns={
    'prices_(£)':      'price',
    'prices_unit_(£)': 'price_per_unit',
    'names':           'product_name',
}, inplace=True)

# Parse date
prices['date'] = pd.to_datetime(prices['date'], format='%Y%m%d', errors='coerce')

# Drop rows with missing price or date
prices.dropna(subset=['price', 'date'], inplace=True)

# Drop duplicates
prices.drop_duplicates(inplace=True)

# Clean category — lowercase, strip spaces
prices['category'] = prices['category'].str.lower().str.strip()

# own_brand — convert to boolean
prices['own_brand'] = prices['own_brand'].astype(str).str.lower().isin(['true', '1', 'yes'])

print(f"Cleaned shape: {prices.shape}")
print(f"Date range: {prices['date'].min()} → {prices['date'].max()}")
print(f"Supermarkets: {prices['supermarket'].unique()}")
print(f"Categories: {prices['category'].unique()}")

# ── Step 3: Save combined competitor prices ────────────
out_path = os.path.join(PROCESSED, 'competitor_prices.csv')
prices.to_csv(out_path, index=False)
print(f"\n✅ Saved: competitor_prices.csv ({prices.shape[0]:,} rows)")

# ── Step 4: Load & clean demand data ───────────────────
print("\nCleaning demand data...")
demand = pd.read_csv(os.path.join(RAW, 'train.csv'))
demand['date'] = pd.to_datetime(demand['date'])

# ── Step 5: Feature engineering on demand data ─────────
print("Engineering features...")

demand = demand.sort_values(['store', 'item', 'date']).reset_index(drop=True)

# Calendar features
demand['day_of_week']  = demand['date'].dt.dayofweek       # 0=Mon, 6=Sun
demand['month']        = demand['date'].dt.month
demand['year']         = demand['date'].dt.year
demand['day_of_year']  = demand['date'].dt.dayofyear
demand['is_weekend']   = (demand['day_of_week'] >= 5).astype(int)
demand['quarter']      = demand['date'].dt.quarter

# Lag features (per store-item)
grp = demand.groupby(['store', 'item'])['sales']
demand['lag_1']  = grp.shift(1)   # sales yesterday
demand['lag_7']  = grp.shift(7)   # sales same day last week
demand['lag_30'] = grp.shift(30)  # sales same day last month

# Rolling averages
demand['rolling_7']  = grp.transform(lambda x: x.shift(1).rolling(7).mean())
demand['rolling_30'] = grp.transform(lambda x: x.shift(1).rolling(30).mean())

# Drop rows where lag features are NaN (first 30 days per store-item)
demand.dropna(inplace=True)

print(f"Featured demand shape: {demand.shape}")
print(f"Columns: {demand.columns.tolist()}")

# Save
out_path2 = os.path.join(PROCESSED, 'demand_featured.csv')
demand.to_csv(out_path2, index=False)
print(f"\n✅ Saved: demand_featured.csv ({demand.shape[0]:,} rows)")
print("\n✅ Phase 2 Step 1 — Data pipeline complete!")