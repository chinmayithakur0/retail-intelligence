import React, { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Analysis from './pages/Analysis';
import AblationStudy from './pages/AblationStudy';
import CompetitorInfluencePage from './pages/CompetitorInfluence';
import SensitivityAnalysisPage from './pages/SensitivityAnalysis';
import DecisionLogPage from './pages/DecisionLog';
import PriceConfidencePage from './pages/PriceConfidence';
import ScenarioSimulatorPage from './pages/ScenarioSimulator';
import WeeklyForecastPage from './pages/WeeklyForecast';
import MarketPositionPage from './pages/MarketPosition';
import {
  BarChart2, Brain, Home, FlaskConical,
  Target, Activity, ClipboardList, ShieldCheck,
  Sliders, CalendarRange, Map, FileText
} from 'lucide-react';

type Page = 'dashboard' | 'analysis' | 'ablation' | 'influence' | 'sensitivity'
          | 'log' | 'confidence' | 'simulator' | 'forecast' | 'market';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [selectedItem,  setSelectedItem]  = useState(1);
  const [selectedStore, setSelectedStore] = useState(1);

  const navBtn = (page: Page, icon: React.ReactNode, title: string) => (
    <button
      onClick={() => setCurrentPage(page)}
      className={`p-3 rounded-lg transition-colors ${
        currentPage === page
          ? 'bg-indigo-600 text-white'
          : 'text-slate-400 hover:text-white hover:bg-slate-700'
      }`}
      title={title}
    >
      {icon}
    </button>
  );

  const handleExport = () => {
    window.open(
      `http://localhost:8000/api/export-report?store=${selectedStore}&item=${selectedItem}&date=2024-06-11`,
      '_blank'
    );
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="fixed left-0 top-0 h-full w-16 bg-slate-800 border-r border-slate-700
                      flex flex-col items-center py-6 gap-4 z-50 overflow-y-auto">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
          <Brain size={18} className="text-white" />
        </div>
        {navBtn('dashboard',   <Home size={20} />,          'Dashboard')}
        {navBtn('analysis',    <BarChart2 size={20} />,     'Multi-Agent Analysis')}
        {navBtn('ablation',    <FlaskConical size={20} />,  'Ablation Study')}
        {navBtn('influence',   <Target size={20} />,        'Competitor Influence')}
        {navBtn('sensitivity', <Activity size={20} />,      'Sensitivity Analysis')}
        {navBtn('log',         <ClipboardList size={20} />, 'Decision Log')}
        {navBtn('confidence',  <ShieldCheck size={20} />,   'Price Confidence')}
        {navBtn('simulator',   <Sliders size={20} />,       'Scenario Simulator')}
        {navBtn('forecast',    <CalendarRange size={20} />, 'Weekly Forecast')}
        {navBtn('market',      <Map size={20} />,           'Market Position Map')}
        

        <div className="mt-auto">
          <button
            onClick={handleExport}
            className="p-3 rounded-lg transition-colors text-slate-400
                       hover:text-white hover:bg-green-700"
            title="Export PDF Report"
          >
            <FileText size={20} />
          </button>
        </div>
      </div>

      <div className="ml-16">
        {currentPage === 'dashboard'   && (
          <Dashboard
            selectedItem={selectedItem}
            selectedStore={selectedStore}
            onItemChange={setSelectedItem}
            onStoreChange={setSelectedStore}
          />
        )}
        {currentPage === 'analysis'    && <Analysis />}
        {currentPage === 'ablation'    && <AblationStudy />}
        {currentPage === 'influence'   && <CompetitorInfluencePage />}
        {currentPage === 'sensitivity' && <SensitivityAnalysisPage />}
        {currentPage === 'log'         && <DecisionLogPage />}
        {currentPage === 'confidence'  && <PriceConfidencePage />}
        {currentPage === 'simulator'   && <ScenarioSimulatorPage />}
        {currentPage === 'forecast'    && <WeeklyForecastPage />}
        {currentPage === 'market'      && <MarketPositionPage />}
        
      </div>
    </div>
  );
}

export default App;