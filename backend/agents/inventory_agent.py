from crewai import Agent, Task
from .base_config import get_llm


def calculate_reorder(current_stock: int, predicted_demand: float,
                      lead_time_days: int = 3,
                      safety_stock_days: int = 7) -> dict:
    """
    Calculates whether to reorder and how much.
    lead_time_days: days it takes supplier to deliver
    safety_stock_days: buffer stock to always keep
    """
    daily_demand      = predicted_demand
    lead_time_demand  = daily_demand * lead_time_days
    safety_stock      = daily_demand * safety_stock_days
    reorder_point     = lead_time_demand + safety_stock
    days_of_stock     = current_stock / daily_demand if daily_demand > 0 else 999

    if current_stock <= 0:
        status         = 'OUT_OF_STOCK'
        urgency        = 'CRITICAL'
        reorder_qty    = int(reorder_point * 2)
    elif current_stock < lead_time_demand:
        status         = 'UNDERSTOCK'
        urgency        = 'HIGH'
        reorder_qty    = int(reorder_point - current_stock)
    elif current_stock < reorder_point:
        status         = 'LOW_STOCK'
        urgency        = 'MEDIUM'
        reorder_qty    = int(reorder_point - current_stock)
    elif current_stock > reorder_point * 3:
        status         = 'OVERSTOCK'
        urgency        = 'LOW'
        reorder_qty    = 0
    else:
        status         = 'OPTIMAL'
        urgency        = 'NONE'
        reorder_qty    = 0

    return {
        'current_stock':    current_stock,
        'predicted_demand': round(daily_demand, 2),
        'days_of_stock':    round(days_of_stock, 1),
        'reorder_point':    round(reorder_point, 2),
        'safety_stock':     round(safety_stock, 2),
        'status':           status,
        'urgency':          urgency,
        'reorder_quantity': reorder_qty,
        'action':           'ORDER NOW' if reorder_qty > 0 else 'NO ACTION NEEDED',
    }


def create_inventory_agent() -> Agent:
    return Agent(
        role='Inventory Management Specialist',
        goal=(
            'Monitor stock levels and ensure optimal inventory by '
            'generating timely reorder recommendations based on '
            'predicted demand and supplier lead times.'
        ),
        backstory=(
            'You are an expert inventory manager for a UK grocery retailer. '
            'You understand the cost of overstocking (waste, storage costs) '
            'and understocking (lost sales, customer dissatisfaction). '
            'You use demand forecasts to make precise reorder decisions.'
        ),
        llm=get_llm(),
        verbose=True,
        allow_delegation=False,
    )


def create_inventory_task(agent: Agent, context: dict) -> Task:
    return Task(
        description=f"""
        Assess the inventory situation for the following product:

        - Category: {context.get('category', 'fresh_food')}
        - Current stock level: {context.get('current_stock', 100)} units
        - Predicted daily demand: {context.get('predicted_demand', 50)} units
        - Supplier lead time: {context.get('lead_time_days', 3)} days
        - Safety stock buffer: {context.get('safety_stock_days', 7)} days

        Provide:
        1. Current stock status (optimal/understock/overstock/critical)
        2. How many days of stock remain
        3. Reorder recommendation with quantity
        4. Urgency level and reasoning
        5. Business impact if no action is taken
        """,
        expected_output=(
            'An inventory assessment report including stock status, '
            'days remaining, reorder recommendation, and business impact.'
        ),
        agent=agent,
    )