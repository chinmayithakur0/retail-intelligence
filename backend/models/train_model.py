import pandas as pd
import numpy as np
import pickle
import os
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, mean_absolute_error

# ── Paths ──────────────────────────────────────────────
PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')
MODELS_DIR = os.path.dirname(__file__)

# ── Load featured demand data ──────────────────────────
print("Loading demand_featured.csv...")
df = pd.read_csv(os.path.join(PROCESSED, 'demand_featured.csv'))
print(f"Loaded: {df.shape}")

# ── Define features and target ─────────────────────────
FEATURES = [
    'store', 'item',
    'day_of_week', 'month', 'year',
    'day_of_year', 'is_weekend', 'quarter',
    'lag_1', 'lag_7', 'lag_30',
    'rolling_7', 'rolling_30'
]
TARGET = 'sales'

X = df[FEATURES]
y = df[TARGET]

# ── Train/test split ───────────────────────────────────
# Use last 20% of data as test (time-based split)
split_idx = int(len(df) * 0.8)
X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

print(f"Train size: {X_train.shape[0]:,}")
print(f"Test size:  {X_test.shape[0]:,}")

# ── Train XGBoost model ────────────────────────────────
print("\nTraining XGBoost model...")
model = XGBRegressor(
    n_estimators=500,
    learning_rate=0.05,
    max_depth=6,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
    n_jobs=-1,
    early_stopping_rounds=20,
    eval_metric='rmse'
)

model.fit(
    X_train, y_train,
    eval_set=[(X_test, y_test)],
    verbose=50
)

# ── Evaluate ───────────────────────────────────────────
print("\nEvaluating...")
preds = model.predict(X_test)
rmse = np.sqrt(mean_squared_error(y_test, preds))
mae  = mean_absolute_error(y_test, preds)

print(f"RMSE: {rmse:.4f}")
print(f"MAE:  {mae:.4f}")

# Feature importance
importance = pd.Series(
    model.feature_importances_,
    index=FEATURES
).sort_values(ascending=False)
print("\nTop 5 features:")
print(importance.head())

# ── Save model ─────────────────────────────────────────
model_path = os.path.join(MODELS_DIR, 'demand_model.pkl')
with open(model_path, 'wb') as f:
    pickle.dump(model, f)

# Save feature list
features_path = os.path.join(MODELS_DIR, 'feature_columns.pkl')
with open(features_path, 'wb') as f:
    pickle.dump(FEATURES, f)

print(f"\n✅ Model saved: demand_model.pkl")
print(f"✅ Features saved: feature_columns.pkl")
print("\n✅ Phase 2 Step 2 — XGBoost training complete!")