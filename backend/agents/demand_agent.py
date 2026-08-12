import os
import pickle
import pandas as pd
import numpy as np
from data_pipeline.product_mapping import get_product_info, get_store_name
from crewai import Agent, Task
from .base_config import get_llm


# ── Load model once when module is imported ────────────
_MODEL_DIR = os.path.join(os.path.dirname(__file__), '../models')

with open(os.path.join(_MODEL_DIR, 'demand_model.pkl'), 'rb') as f:
    _MODEL = pickle.load(f)

with open(os.path.join(_MODEL_DIR, 'feature_columns.pkl'), 'rb') as f:
    _FEATURES = pickle.load(f)


def predict_demand(store: int, item: int, date: str,
                   lag_1: float, lag_7: float, lag_30: float,
                   rolling_7: float, rolling_30: float) -> dict:
    """
    Predicts units sold for a given store/item/date combination.
    Called by the Demand Agent as a tool.
    """
    dt = pd.to_datetime(date)

    row = pd.DataFrame([{
        'store':       store,
        'item':        item,
        'day_of_week': dt.dayofweek,
        'month':       dt.month,
        'year':        dt.year,
        'day_of_year': dt.dayofyear,
        'is_weekend':  int(dt.dayofweek >= 5),
        'quarter':     dt.quarter,
        'lag_1':       lag_1,
        'lag_7':       lag_7,
        'lag_30':      lag_30,
        'rolling_7':   rolling_7,
        'rolling_30':  rolling_30,
    }])

    predicted = float(_MODEL.predict(row[_FEATURES])[0])
    predicted = max(0, round(predicted, 2))

    product = get_product_info(item)

    return {
        'store':           store,
        'store_name':      get_store_name(store),
        'item':            item,
        'product_name':    product['name'],
        'category':        product['category'],
        'date':            date,
        'predicted_units': predicted,
        'is_weekend':      bool(dt.dayofweek >= 5),
        'day_of_week':     dt.strftime('%A'),
    }


def create_demand_agent() -> Agent:
    """
    Creates the Demand Forecasting Agent.
    This agent wraps the XGBoost model and uses the LLM
    to interpret and explain the prediction in plain English.
    """
    return Agent(
        role='Demand Forecasting Specialist',
        goal=(
            'Predict future product demand accurately using the XGBoost '
            'forecasting model and provide clear business interpretations '
            'of the predictions.'
        ),
        backstory=(
            'You are an expert retail demand analyst with deep knowledge of '
            'UK grocery shopping patterns, seasonal trends, and consumer '
            'behaviour. You use machine learning predictions and explain '
            'them in clear, actionable business language.'
        ),
        llm=get_llm(),
        verbose=True,
        allow_delegation=False,
    )


def create_demand_task(agent: Agent, context: dict) -> Task:
    """
    Creates the demand forecasting task for a given product context.
    """
    return Task(
        description=f"""
        Analyse the demand for the following product and provide a forecast:

        Product context:
        - Store ID: {context.get('store', 1)}
        - Item ID: {context.get('item', 1)}
        - Date: {context.get('date', 'today')}
        - Recent sales (last 3 days): {context.get('lag_1', 50)}, 
          last week same day: {context.get('lag_7', 48)},
          last month same day: {context.get('lag_30', 45)}
        - 7-day rolling average: {context.get('rolling_7', 49)}
        - 30-day rolling average: {context.get('rolling_30', 47)}

        Use the predict_demand function to get the numeric forecast,
        then provide:
        1. The predicted demand figure
        2. Whether this is above or below recent averages
        3. Key factors driving this prediction
        4. A confidence assessment
        """,
        expected_output=(
            'A demand forecast report including predicted units, '
            'trend analysis, and business interpretation.'
        ),
        agent=agent,
    )