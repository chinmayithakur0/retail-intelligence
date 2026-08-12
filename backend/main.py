from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.routes import router
from apscheduler.schedulers.background import BackgroundScheduler
import requests
import atexit

app = FastAPI(
    title="Retail Intelligence API",
    description="Multi-Agent AI System for Dynamic Pricing & Demand Forecasting",
    version="1.0.0"
)

# Allow React frontend to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

@app.get("/")
def root():
    return {"status": "Retail Intelligence API is running"}

# ── Daily price refresh scheduler ─────────────────────────────
def refresh_live_prices():
    """
    Runs automatically every 24 hours.
    Fetches fresh prices from Trolley.co.uk for key products
    and updates the server-side live price cache.
    """
    print("🔄 Auto-refreshing live prices from Trolley.co.uk...")

    # Key products per category to refresh
    refresh_targets = [
        ('whole milk',    'fresh_food'),
        ('orange juice',  'drinks'),
        ('bread',         'bakery'),
        ('butter',        'fresh_food'),
        ('eggs',          'fresh_food'),
        ('frozen peas',   'frozen'),
        ('washing up liquid', 'household'),
        ('dog food',      'pets'),
        ('baby formula',  'baby_products'),
        ('gluten free bread', 'free-from'),
    ]

    success_count = 0
    for product, category in refresh_targets:
        try:
            r = requests.get(
                'http://localhost:8000/api/live-prices',
                params={'product_name': product, 'category': category},
                timeout=30
            )
            if r.status_code == 200:
                success_count += 1
                print(f"  ✅ {product} ({category})")
            else:
                print(f"  ⚠️ {product} — status {r.status_code}")
        except Exception as e:
            print(f"  ❌ {product} — {e}")

    print(f"🔄 Daily refresh complete: {success_count}/{len(refresh_targets)} categories updated")

# Start background scheduler
scheduler = BackgroundScheduler()

# Run once immediately on startup (after 10 seconds to let server fully start)
scheduler.add_job(
    refresh_live_prices,
    'interval',
    seconds=10,         # first run after 10 seconds
    id='startup_refresh',
    max_instances=1
)

# Then run every 24 hours
scheduler.add_job(
    refresh_live_prices,
    'interval',
    hours=24,
    id='daily_price_refresh',
    max_instances=1
)

scheduler.start()
print("✅ Daily price refresh scheduler started — prices will refresh every 24 hours")

# Shut down scheduler cleanly when server stops
atexit.register(lambda: scheduler.shutdown())