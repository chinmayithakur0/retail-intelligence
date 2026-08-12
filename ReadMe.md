# Retail Intelligence — Competitor-Aware Dynamic Pricing

**MSc Artificial Intelligence Dissertation**  
Queen Mary University of London  

**Author:** Chinmayi Santosh Thakur  
**Supervisor:** Mohamed Hamza Bandukara

---

## Overview

This project builds a multi-agent AI system that helps UK grocery retailers make smarter pricing decisions by combining demand forecasting with real-time competitor intelligence.

The system deploys nine autonomous AI agents — one per UK supermarket competitor, plus agents for demand forecasting, price optimisation, inventory management, and an orchestrator that pulls everything together into a plain-English recommendation using a locally-hosted language model (Mistral 7B via Ollama).

---

## Research Question

*To what extent does competitor pricing intelligence, mediated by autonomous AI agents, improve dynamic pricing decisions in UK grocery retail compared to demand-only models?*

---

## Key Finding

Competitor-aware pricing improved revenue outcomes in the substantial majority of tested product-store combinations, confirmed statistically significant at a large effect size.

---

## System

- **9 AI agents** coordinated via CrewAI
- **Local LLM** — Mistral 7B running via Ollama (no cloud API)
- **Demand forecasting** — XGBoost trained on 898,000 rows of retail sales data
- **Live competitor prices** — scraped in real time from Trolley.co.uk
- **10 dashboard pages** built in React + FastAPI

---

## Setup

See the full setup instructions in the project documentation or contact the author.