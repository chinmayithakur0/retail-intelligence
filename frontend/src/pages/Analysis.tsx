import React, { useState, useEffect, useRef } from 'react';
import { Brain, Send, Loader, Zap, Users, Package, TrendingUp } from 'lucide-react';
import { getProducts, getStores, runCrew, quickPredict } from '../services/api';
import type { Product, Store } from '../services/api';

interface Message {
  role: 'user' | 'agent';
  content: string;
  data?: any;
}

// Quick-action chips shown below chat
const QUICK_ACTIONS = [
  { label: 'Run full multi-agent analysis', icon: Brain,      action: 'full' },
  { label: 'Quick demand forecast',         icon: Zap,        action: 'quick' },
  { label: 'Compare competitor prices',     icon: Users,      action: 'competitors' },
  { label: 'Inventory status',              icon: Package,    action: 'inventory' },
];

export default function Analysis() {
  const [products, setProducts] = useState<Product[]>([]);
  const [stores,   setStores]   = useState<Store[]>([]);

  // Selected IDs
  const [itemId,  setItemId]  = useState<number>(1);
  const [storeId, setStoreId] = useState<number>(1);
  const [stock,   setStock]   = useState<number>(100);
  const [price,   setPrice]   = useState<number>(2.50);

  const [messages, setMessages] = useState<Message[]>([{
    role: 'agent',
    content: "Hello! I'm your Retail Intelligence Orchestrator. Select a product and store above, then use a quick action or type a question below.",
  }]);

  const [input,   setInput]   = useState('');
  const [running, setRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load dropdowns on mount
  useEffect(() => {
    getProducts().then(data => {
      setProducts(data);
      // Auto-set price from first product if it has one
      if (data[0]?.current_price) setPrice(data[0].current_price);
    });
    getStores().then(data => setStores(data));
  }, []);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages]);

  // When product changes, try to auto-populate price
  const handleItemChange = (id: number) => {
    setItemId(id);
    const product = products.find(p => p.item_id === id);
    if (product?.current_price) setPrice(product.current_price);
  };

  const selectedProduct = products.find(p => p.item_id === itemId);
  const selectedStore   = stores.find(s => s.store_id === storeId);

  const addMessage = (msg: Message) =>
    setMessages(prev => [...prev, msg]);

  const addThinking = () =>
    addMessage({ role: 'agent', content: '⏳ Thinking...' });

  // Replace the last agent message (used to swap "Thinking..." with real result)
  const replaceLastAgent = (content: string, data?: any) =>
    setMessages(prev => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === 'agent') {
          copy[i] = { role: 'agent', content, data };
          break;
        }
      }
      return copy;
    });

  // ── Full CrewAI run ──────────────────────────────────────────────
  const runFullAnalysis = async () => {
    if (running) return;
    setRunning(true);

    const productName = selectedProduct?.name ?? `Item ${itemId}`;
    const storeName   = selectedStore?.name   ?? `Store ${storeId}`;

    addMessage({
      role: 'user',
      content: `Run full multi-agent analysis for ${productName} at ${storeName}`,
    });

    addMessage({
      role: 'agent',
      content: `🚀 Crew execution started. Running 9 agents through Ollama (Mistral 7B)…\n\n⏳ Demand Agent → Competitor Agents (×5) → Pricing Agent → Inventory Agent → Orchestrator\n\nThis will take 2–3 minutes…`,
    });

    try {
      const result = await runCrew({
        store: storeId, item: itemId,
        date: '2024-06-11',
        current_stock: stock,
        base_price: price,
        lag_1: 52, lag_7: 48, lag_30: 45,
        rolling_7: 50, rolling_30: 47,
      });

      replaceLastAgent(
        `✅ Analysis complete for **${result.product_name}** at **${result.store_name}**\n\n` +
        `📊 **Predicted Demand:** ${result.demand.predicted_units.toFixed(0)} units\n` +
        `💰 **Optimal Price:** £${result.pricing.optimal_price.toFixed(2)}\n` +
        `📈 **Expected Revenue:** £${result.pricing.expected_revenue.toFixed(2)}\n` +
        `📦 **Inventory Status:** ${result.inventory.status}\n\n` +
        `---\n\n**Orchestrator Narrative:**\n\n${result.narrative}`,
        result
      );
    } catch {
      replaceLastAgent('❌ Error running crew. Make sure the backend and Ollama are both running.');
    } finally {
      setRunning(false);
    }
  };

  // ── Quick predict (no LLM, instant) ─────────────────────────────
  const runQuickPredict = async () => {
    if (running) return;
    setRunning(true);

    const productName = selectedProduct?.name ?? `Item ${itemId}`;
    const storeName   = selectedStore?.name   ?? `Store ${storeId}`;

    addMessage({ role: 'user', content: `Quick demand forecast for ${productName} at ${storeName}` });
    addThinking();

    try {
      const result = await quickPredict(storeId, itemId, '2024-06-11');
      replaceLastAgent(
        `⚡ **Quick forecast for ${result.product_name}**\n\n` +
        `📊 **Predicted demand:** ${result.demand.predicted_units.toFixed(0)} units\n` +
        `📅 **Day:** ${result.demand.day_of_week}${result.demand.is_weekend ? ' (weekend — expect uplift)' : ''}\n` +
        `💰 **Optimal price:** £${result.pricing.optimal_price.toFixed(2)}\n` +
        `📈 **Expected revenue:** £${result.pricing.expected_revenue.toFixed(2)}\n` +
        `🏷️ **vs Avg competitor:** ${result.pricing.price_vs_competitor > 0 ? '+' : ''}${result.pricing.price_vs_competitor?.toFixed(1)}%`,
        result
      );
    } catch {
      replaceLastAgent('❌ Quick predict failed. Check the backend is running on port 8000.');
    } finally {
      setRunning(false);
    }
  };

  // ── Competitor prices ────────────────────────────────────────────
  const runCompetitorPrices = async () => {
    if (running) return;
    setRunning(true);

    const productName = selectedProduct?.name ?? `Item ${itemId}`;
    addMessage({ role: 'user', content: `Show competitor prices for ${productName}` });
    addThinking();

    try {
      const result = await quickPredict(storeId, itemId, '2024-06-11');
      const competitorLines = result.competitors
        .map(c => `• **${c.supermarket}:** £${c.price.toFixed(2)} (${c.strategy})`)
        .join('\n');

      replaceLastAgent(
        `🏪 **Competitor prices for ${result.product_name}**\n\n` +
        `${competitorLines}\n\n` +
        `💰 **Our optimal price:** £${result.pricing.optimal_price.toFixed(2)}\n` +
        `📊 **Avg competitor:** £${result.pricing.avg_competitor_price?.toFixed(2)}\n` +
        `📈 **Our position:** ${result.pricing.price_vs_competitor > 0 ? '+' : ''}${result.pricing.price_vs_competitor?.toFixed(1)}% vs market`,
        result
      );
    } catch {
      replaceLastAgent('❌ Failed to fetch competitor prices.');
    } finally {
      setRunning(false);
    }
  };

  // ── Inventory status ─────────────────────────────────────────────
  const runInventory = async () => {
    if (running) return;
    setRunning(true);

    const productName = selectedProduct?.name ?? `Item ${itemId}`;
    const storeName   = selectedStore?.name   ?? `Store ${storeId}`;

    addMessage({ role: 'user', content: `Inventory status for ${productName} at ${storeName}` });
    addThinking();

    try {
      const result = await quickPredict(storeId, itemId, '2024-06-11');
      const inv = result.inventory;
      const urgencyColour =
        inv.urgency === 'HIGH'   ? '🔴' :
        inv.urgency === 'MEDIUM' ? '🟡' : '🟢';

      replaceLastAgent(
        `📦 **Inventory — ${result.product_name} @ ${result.store_name}**\n\n` +
        `${urgencyColour} **Status:** ${inv.status}\n` +
        `📊 **Current stock:** ${inv.current_stock} units\n` +
        `📅 **Days of stock remaining:** ${inv.days_of_stock}\n` +
        `🔄 **Reorder quantity:** ${inv.reorder_quantity} units\n` +
        `✅ **Recommended action:** ${inv.action}`,
        result
      );
    } catch {
      replaceLastAgent('❌ Failed to fetch inventory status.');
    } finally {
      setRunning(false);
    }
  };

  // ── Quick action dispatcher ──────────────────────────────────────
  const handleQuickAction = (action: string) => {
    if (action === 'full')        runFullAnalysis();
    else if (action === 'quick')  runQuickPredict();
    else if (action === 'competitors') runCompetitorPrices();
    else if (action === 'inventory')   runInventory();
  };

  // ── Free-text chat input ─────────────────────────────────────────
  const handleSend = async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');

    addMessage({ role: 'user', content: text });
    addThinking();
    setRunning(true);

    // Simple intent routing on free text
    const lower = text.toLowerCase();
    try {
      if (lower.includes('full') || lower.includes('analysis') || lower.includes('crew')) {
        // Replace thinking with crew progress message, then run
        replaceLastAgent(
          `🚀 Running full 9-agent crew for ${selectedProduct?.name ?? `Item ${itemId}`}…\n\n` +
          `⏳ Demand → Competitor ×5 → Pricing → Inventory → Orchestrator\n\nThis takes 2–3 minutes…`
        );
        const result = await runCrew({
          store: storeId, item: itemId,
          date: '2024-06-11',
          current_stock: stock, base_price: price,
          lag_1: 52, lag_7: 48, lag_30: 45,
          rolling_7: 50, rolling_30: 47,
        });
        replaceLastAgent(
          `✅ Complete!\n\n📊 Demand: ${result.demand.predicted_units.toFixed(0)} units\n` +
          `💰 Optimal price: £${result.pricing.optimal_price.toFixed(2)}\n` +
          `📈 Revenue: £${result.pricing.expected_revenue.toFixed(2)}\n\n${result.narrative}`,
          result
        );
      } else if (lower.includes('competitor') || lower.includes('price') || lower.includes('market')) {
        const result = await quickPredict(storeId, itemId, '2024-06-11');
        const lines = result.competitors.map(c => `• ${c.supermarket}: £${c.price.toFixed(2)}`).join('\n');
        replaceLastAgent(`🏪 Competitor prices for ${result.product_name}:\n\n${lines}\n\n💰 Our optimal: £${result.pricing.optimal_price.toFixed(2)}`, result);
      } else if (lower.includes('inventory') || lower.includes('stock')) {
        const result = await quickPredict(storeId, itemId, '2024-06-11');
        const inv = result.inventory;
        replaceLastAgent(`📦 Stock: ${inv.current_stock} units | Status: ${inv.status} | Days remaining: ${inv.days_of_stock} | Action: ${inv.action}`, result);
      } else if (lower.includes('demand') || lower.includes('forecast') || lower.includes('predict')) {
        const result = await quickPredict(storeId, itemId, '2024-06-11');
        replaceLastAgent(`📊 Predicted demand for ${result.product_name}: **${result.demand.predicted_units.toFixed(0)} units** on ${result.demand.day_of_week}${result.demand.is_weekend ? ' (weekend)' : ''}.`, result);
      } else {
        // Fallback — run quick predict and give a general summary
        const result = await quickPredict(storeId, itemId, '2024-06-11');
        replaceLastAgent(
          `Here's what I know about **${result.product_name}** at **${result.store_name}**:\n\n` +
          `📊 Predicted demand: ${result.demand.predicted_units.toFixed(0)} units\n` +
          `💰 Optimal price: £${result.pricing.optimal_price.toFixed(2)}\n` +
          `📦 Stock status: ${result.inventory.status}\n\n` +
          `You can ask me about competitors, inventory, demand forecasts, or run a full multi-agent analysis.`,
          result
        );
      }
    } catch {
      replaceLastAgent('❌ Something went wrong. Make sure the backend is running on port 8000.');
    } finally {
      setRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Render ───────────────────────────────────────────────────────
  const selectClass =
    "bg-slate-700 text-white rounded-lg px-3 py-2 border border-slate-600 text-sm w-full";

  return (
    <div className="h-screen flex flex-col p-6 max-h-screen">

      {/* Header */}
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-semibold text-white">Multi-Agent Analysis</h1>
        <p className="text-slate-400 mt-1 text-sm">Full CrewAI orchestration with Ollama (Mistral 7B)</p>
      </div>

      {/* Config panel — dropdowns */}
      <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 mb-4 shrink-0">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

          {/* Product dropdown */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Product</label>
            <select
              value={itemId}
              onChange={e => handleItemChange(Number(e.target.value))}
              className={selectClass}
            >
              {products.length === 0 && (
                <option value={1}>Loading products…</option>
              )}
              {products.map(p => (
                <option key={p.item_id} value={p.item_id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Store dropdown */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Store</label>
            <select
              value={storeId}
              onChange={e => setStoreId(Number(e.target.value))}
              className={selectClass}
            >
              {stores.length === 0 && (
                <option value={1}>Loading stores…</option>
              )}
              {stores.map(s => (
                <option key={s.store_id} value={s.store_id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Current stock */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Current Stock</label>
            <input
              type="number"
              value={stock}
              onChange={e => setStock(Number(e.target.value))}
              className={selectClass}
            />
          </div>

          {/* Base price */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Base Price (£)</label>
            <input
              type="number"
              step={0.01}
              value={price}
              onChange={e => setPrice(Number(e.target.value))}
              className={selectClass}
            />
          </div>
        </div>

        {/* Selected context badge */}
        {selectedProduct && selectedStore && (
          <div className="mt-3 text-xs text-slate-500">
            Selected:{' '}
            <span className="text-indigo-400 font-medium">{selectedProduct.name}</span>
            {' '}({selectedProduct.category}) at{' '}
            <span className="text-indigo-400 font-medium">{selectedStore.name}</span>
          </div>
        )}
      </div>

      {/* Chat messages — scrollable */}
      <div className="flex-1 overflow-y-auto bg-slate-800 rounded-xl border border-slate-700 p-4 mb-3 space-y-4 min-h-0">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'agent' && (
              <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center shrink-0 mt-1">
                <Brain size={14} className="text-white" />
              </div>
            )}
            <div className={`max-w-2xl rounded-xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-700 text-slate-100'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {running && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center shrink-0">
              <Loader size={14} className="text-white animate-spin" />
            </div>
            <div className="bg-slate-700 rounded-xl px-4 py-3 text-sm text-slate-400 flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="inline-block w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="inline-block w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick action chips */}
      <div className="flex gap-2 mb-3 shrink-0 flex-wrap">
        {QUICK_ACTIONS.map(({ label, icon: Icon, action }) => (
          <button
            key={action}
            onClick={() => handleQuickAction(action)}
            disabled={running || products.length === 0}
            className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40
                       text-slate-300 border border-slate-700 px-3 py-1.5 rounded-full transition-colors"
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* Text input row */}
      <div className="flex gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about this product… (Enter to send)"
          disabled={running}
          className="flex-1 bg-slate-800 text-white placeholder-slate-500 border border-slate-700
                     rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={running || !input.trim()}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40
                     text-white px-5 py-3 rounded-xl font-medium transition-colors text-sm"
        >
          {running ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
          Send
        </button>
      </div>
    </div>
  );
}