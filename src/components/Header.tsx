import React from 'react';
import {
  ShieldCheck,
  Globe2,
  Database,
  Bot,
  Kanban,
  Send,
  GitMerge,
  Layers,
  CheckSquare,
  FileSpreadsheet,
  Download,
  Upload,
  Sparkles,
} from 'lucide-react';

interface HeaderProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  totalLeads: number;
  totalPipelineValue: number;
  activeConnectorsCount: number;
  onOpenImport: () => void;
  onExportCsv: () => void;
  aiAvailable: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  totalLeads,
  totalPipelineValue,
  activeConnectorsCount,
  onOpenImport,
  onExportCsv,
  aiAvailable,
}) => {
  const tabs = [
    { id: 'discovery', label: 'Discovery Engine', icon: Globe2 },
    { id: 'leads', label: 'Leads CRM', icon: Database, badge: totalLeads },
    { id: 'pipeline', label: 'Sales Pipeline', icon: Kanban },
    { id: 'ai-agent', label: 'AI Sales Agent', icon: Bot, isSpecial: true },
    { id: 'outreach', label: 'Outreach & Approval', icon: Send },
    { id: 'dedupe', label: 'Dedupe & Merge', icon: GitMerge },
    { id: 'connectors', label: 'Connectors & Health', icon: Layers, badge: `${activeConnectorsCount}/6` },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-950/95 sticky top-0 z-40 backdrop-blur-md">
      {/* Top Bar: System Status & Metrics */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 p-0.5 shadow-lg shadow-indigo-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[7px] flex items-center justify-center">
              <Globe2 className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                Global Lead Intelligence & Sales Pipeline
              </h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Single-Owner Production
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Multi-source registry discovery, SSRF-safe verification, canonical deduplication & AI automation
            </p>
          </div>
        </div>

        {/* Live KPIs */}
        <div className="flex items-center gap-6 text-xs">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-slate-400">Total Leads</span>
            <span className="text-sm font-semibold text-white">{totalLeads.toLocaleString()}</span>
          </div>

          <div className="hidden md:flex flex-col text-right">
            <span className="text-slate-400">Pipeline Value</span>
            <span className="text-sm font-semibold text-emerald-400">
              ${totalPipelineValue.toLocaleString()}
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-2 px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-md">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span className="text-slate-300">Connectors Active:</span>
            <span className="font-mono text-cyan-400 font-semibold">{activeConnectorsCount}/6</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenImport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded border border-slate-700 transition"
              title="Import CSV or Excel data"
            >
              <Upload className="w-3.5 h-3.5 text-slate-400" />
              <span>Import CSV</span>
            </button>

            <button
              onClick={onExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded border border-slate-700 transition"
              title="Export all leads to CSV"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Export</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-slate-800/80">
        <nav className="flex space-x-1 overflow-x-auto scrollbar-none py-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setCurrentTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded transition whitespace-nowrap ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                } ${tab.isSpecial && !isActive ? 'text-indigo-400 hover:text-indigo-300 font-semibold' : ''}`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : tab.isSpecial ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.isSpecial && (
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                )}
                {tab.badge !== undefined && (
                  <span
                    className={`ml-1 px-1.5 py-0.2 text-[10px] rounded ${
                      isActive ? 'bg-indigo-800 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
