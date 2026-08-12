from crewai import Agent, Task, Crew, Process
from .base_config import get_llm
from .demand_agent import create_demand_agent, create_demand_task, predict_demand
from .competitor_agents import (create_competitor_agent, create_competitor_task,
                                 get_competitor_price, COMPETITOR_PROFILES)
from .pricing_agent import create_pricing_agent, create_pricing_task, optimise_price
from .inventory_agent import create_inventory_agent, create_inventory_task, calculate_reorder


def create_orchestrator_agent() -> Agent:
    return Agent(
        role='Retail Intelligence Orchestrator',
        goal=(
            'Synthesise insights from all specialist agents — demand forecasting, '
            'competitor intelligence, pricing optimisation, and inventory management '
            '— into a single coherent retail strategy recommendation.'
        ),
        backstory=(
            'You are the chief retail intelligence officer of a UK grocery retailer. '
            'You receive reports from your team of specialist AI agents and synthesise '
            'them into clear, actionable recommendations for store managers. '
            'You always consider the competitive landscape, demand patterns, '
            'and inventory position together before making a recommendation.'
        ),
        llm=get_llm(),
        verbose=True,
        allow_delegation=True,
    )


def run_crew(context: dict) -> dict:
    """
    Main entry point. Runs the full multi-agent crew for a given product context.
    Returns a structured recommendation dict.

    context keys:
        store, item, category, date,
        current_stock, base_price,
        lag_1, lag_7, lag_30, rolling_7, rolling_30,
        lead_time_days (optional), safety_stock_days (optional)
    """

    # ── Step 1: Get numeric outputs from ML tools ──────
    demand_result = predict_demand(
        store      = context.get('store', 1),
        item       = context.get('item', 1),
        date       = context.get('date'),
        lag_1      = context.get('lag_1', 50),
        lag_7      = context.get('lag_7', 48),
        lag_30     = context.get('lag_30', 45),
        rolling_7  = context.get('rolling_7', 49),
        rolling_30 = context.get('rolling_30', 47),
    )
    predicted_demand = demand_result['predicted_units']

    # ── Step 2: Get competitor prices ──────────────────
    competitor_prices = []
    for supermarket in COMPETITOR_PROFILES.keys():
        cp = get_competitor_price(
            supermarket = supermarket,
            category    = context.get('category', 'fresh_food'),
            date        = context.get('date'),
        )
        competitor_prices.append({
            'supermarket': supermarket,
            'price':       cp['price'],
            'strategy':    cp['strategy'],
        })

    # ── Step 3: Optimise price ─────────────────────────
    pricing_result = optimise_price(
        predicted_demand_at_base = predicted_demand,
        base_price               = context.get('base_price', 2.50),
        competitor_prices        = competitor_prices,
    )

    # ── Step 4: Inventory assessment ──────────────────
    inventory_result = calculate_reorder(
        current_stock    = context.get('current_stock', 100),
        predicted_demand = predicted_demand,
        lead_time_days   = context.get('lead_time_days', 3),
        safety_stock_days= context.get('safety_stock_days', 7),
    )

    # ── Step 5: Build CrewAI agents ────────────────────
    demand_agent      = create_demand_agent()
    pricing_agent     = create_pricing_agent()
    inventory_agent   = create_inventory_agent()
    orchestrator      = create_orchestrator_agent()

    competitor_agents = [
        create_competitor_agent(s) for s in COMPETITOR_PROFILES.keys()
    ]

    # ── Step 6: Build tasks ────────────────────────────
    demand_task = create_demand_task(demand_agent, {**context,
                                     'predicted_demand': predicted_demand})

    competitor_tasks = [
        create_competitor_task(agent, supermarket,
                               context.get('category', 'fresh_food'),
                               context.get('date'),
                               context.get('base_price', 2.50))
        for agent, supermarket in zip(competitor_agents, COMPETITOR_PROFILES.keys())
    ]

    pricing_context = {
        **context,
        'predicted_demand': predicted_demand,
        'competitor_prices': competitor_prices,
    }
    pricing_task    = create_pricing_task(pricing_agent, pricing_context)
    inventory_task  = create_inventory_task(inventory_agent, {
        **context,
        'predicted_demand': predicted_demand,
    })

    orchestrator_task = Task(
        description=f"""
        You have received reports from all specialist agents. 
        Synthesise everything into a final retail intelligence report.

        DEMAND FORECAST:
        {demand_result}

        COMPETITOR INTELLIGENCE:
        {competitor_prices}

        PRICING RECOMMENDATION:
        {pricing_result}

        INVENTORY STATUS:
        {inventory_result}

        Provide a comprehensive recommendation covering:
        1. Executive summary (2-3 sentences)
        2. Demand outlook
        3. Competitive position analysis — how do our competitors affect the optimal price?
        4. Recommended price with justification
        5. Inventory action required
        6. Overall risk assessment
        7. Key actions for the store manager
        """,
        expected_output=(
            'A comprehensive retail intelligence report with executive summary, '
            'demand forecast, competitive analysis, pricing recommendation, '
            'inventory action, and risk assessment.'
        ),
        agent=orchestrator,
    )

    # ── Step 7: Assemble and run the Crew ─────────────
    all_agents = [demand_agent] + competitor_agents + [pricing_agent,
                  inventory_agent, orchestrator]
    all_tasks  = ([demand_task] + competitor_tasks +
                  [pricing_task, inventory_task, orchestrator_task])

    crew = Crew(
        agents  = all_agents,
        tasks   = all_tasks,
        process = Process.sequential,
        verbose = True,
    )

    crew_output = crew.kickoff()

    return {
        'demand':      demand_result,
        'competitors': competitor_prices,
        'pricing':     pricing_result,
        'inventory':   inventory_result,
        'narrative':   str(crew_output),
    }