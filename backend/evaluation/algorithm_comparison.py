import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, mean_absolute_error
from xgboost import XGBRegressor
import os

print("Loading data...")
PROCESSED = os.path.join(os.path.dirname(__file__), '../../data/processed')
df = pd.read_csv(os.path.join(PROCESSED, 'demand_enriched.csv'))

features = ['lag_1', 'lag_7', 'lag_30', 'rolling_7', 'rolling_30',
            'day_of_week', 'month', 'quarter', 'year',
            'day_of_year', 'is_weekend']

df = df.dropna(subset=features + ['sales'])
split = int(len(df) * 0.8)
train = df.iloc[:split]
test  = df.iloc[split:]

X_train = train[features]
y_train = train['sales']
X_test  = test[features]
y_test  = test['sales']

print(f"Train: {len(X_train):,} rows | Test: {len(X_test):,} rows\n")

results = {}

# ── XGBoost ──────────────────────────────────────────
print("Training XGBoost...")
xgb = XGBRegressor(n_estimators=100, max_depth=6,
                   learning_rate=0.1, random_state=42, n_jobs=-1)
xgb.fit(X_train, y_train)
pred = xgb.predict(X_test)
results['XGBoost'] = {
    'RMSE': round(np.sqrt(mean_squared_error(y_test, pred)), 4),
    'MAE':  round(mean_absolute_error(y_test, pred), 4)
}
print(f"XGBoost — RMSE: {results['XGBoost']['RMSE']}, MAE: {results['XGBoost']['MAE']}")

# ── Random Forest ─────────────────────────────────────
print("Training Random Forest...")
rf = RandomForestRegressor(n_estimators=100, max_depth=10,
                           random_state=42, n_jobs=-1)
rf.fit(X_train, y_train)
pred = rf.predict(X_test)
results['Random Forest'] = {
    'RMSE': round(np.sqrt(mean_squared_error(y_test, pred)), 4),
    'MAE':  round(mean_absolute_error(y_test, pred), 4)
}
print(f"Random Forest — RMSE: {results['Random Forest']['RMSE']}, MAE: {results['Random Forest']['MAE']}")

# ── Linear Regression ─────────────────────────────────
print("Training Linear Regression...")
lr = LinearRegression()
lr.fit(X_train, y_train)
pred = lr.predict(X_test)
results['Linear Regression'] = {
    'RMSE': round(np.sqrt(mean_squared_error(y_test, pred)), 4),
    'MAE':  round(mean_absolute_error(y_test, pred), 4)
}
print(f"Linear Regression — RMSE: {results['Linear Regression']['RMSE']}, MAE: {results['Linear Regression']['MAE']}")

# ── Prophet ───────────────────────────────────────────
print("Training Prophet...")
try:
    from prophet import Prophet

    # Prophet needs 'ds' (date) and 'y' (target) columns only
    prophet_train = train[['date', 'sales']].rename(
        columns={'date': 'ds', 'sales': 'y'}
    )
    prophet_test = test[['date', 'sales']].rename(
        columns={'date': 'ds', 'sales': 'y'}
    )

    # Convert date column to datetime
    prophet_train['ds'] = pd.to_datetime(prophet_train['ds'])
    prophet_test['ds']  = pd.to_datetime(prophet_test['ds'])

    m = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=True,
        daily_seasonality=False,
        seasonality_mode='multiplicative'
    )
    m.fit(prophet_train)

    future   = m.make_future_dataframe(periods=len(prophet_test))
    forecast = m.predict(future)

    prophet_pred = forecast['yhat'].tail(len(prophet_test)).values
    prophet_pred = np.maximum(prophet_pred, 0)  # no negative sales

    results['Prophet'] = {
        'RMSE': round(np.sqrt(mean_squared_error(y_test, prophet_pred)), 4),
        'MAE':  round(mean_absolute_error(y_test, prophet_pred), 4)
    }
    print(f"Prophet — RMSE: {results['Prophet']['RMSE']}, MAE: {results['Prophet']['MAE']}")

except ImportError:
    print("Prophet not installed — run: pip install prophet")
    results['Prophet'] = {'RMSE': 'N/A', 'MAE': 'N/A'}
except Exception as e:
    print(f"Prophet failed: {e}")
    results['Prophet'] = {'RMSE': 'N/A', 'MAE': 'N/A'}
# ── Summary ───────────────────────────────────────────
print("\n" + "="*50)
print("MODEL COMPARISON SUMMARY")
print("="*50)
print(f"{'Model':<20} {'RMSE':>8} {'MAE':>8}")
print("-"*38)
for model, scores in results.items():
    print(f"{model:<20} {scores['RMSE']:>8} {scores['MAE']:>8}")
print("="*50)

best = min(results.items(), key=lambda x: x[1]['RMSE'])
print(f"\nBest model: {best[0]} (RMSE: {best[1]['RMSE']})")
print("="*50)