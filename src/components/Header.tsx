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
  Download,
  Upload,
  User,
  LogOut,
  KeyRound,
  HardDrive,
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
  owner?: { fullName: string; email: string } | null;
  storageEngine?: 'postgresql' | 'json_store';
  isDbConnected?: boolean;
  onOpenPasswordChange?: () => void;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  totalLeads,
  totalPipelineValue,
  activeConnectorsCount,
  onOpenImport,
  onExportCsv,
  owner,
  storageEngine = 'json_store',
  isDbConnected = false,
  onOpenPasswordChange,
  onLogout,
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-4">
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
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Private Owner Instance
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Multi-source registry discovery, SSRF-safe verification, canonical deduplication & AI automation
            </p>
          </div>
        </div>

        {/* Live KPIs & Storage/Owner Badges */}
        <div className="flex items-center gap-4 text-xs">
          {/* Storage Engine Status Badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-md">
            <HardDrive className={`w-3.5 h-3.5 ${isDbConnected ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span className="text-slate-400">Store:</span>
            <span className={`font-mono font-semibold ${isDbConnected ? 'text-emerald-300' : 'text-amber-300'}`}>
              {isDbConnected ? 'PostgreSQL' : 'JSON Verified'}
            </span>
          </div>

          <div className="hidden md:flex flex-col text-right">
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

          {/* Import / Export */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenImport}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded border border-slate-700 transition"
              title="Import CSV or Excel data"
            >
              <Upload className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden sm:inline">Import</span>
            </button>

            <button
              onClick={onExportCsv}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded border border-slate-700 transition"
              title="Export all leads to CSV"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>

          {/* Owner Account Controls */}
          {owner && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-slate-800">
              <div className="hidden xl:flex items-center gap-1.5 px-2 py-1 bg-slate-900 border border-slate-800 rounded text-slate-300">
                <User className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-medium text-white max-w-[120px] truncate">{owner.fullName}</span>
              </div>

              {onOpenPasswordChange && (
                <button
                  onClick={onOpenPasswordChange}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded border border-slate-800 transition"
                  title="Change Password"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
              )}

              {onLogout && (
                <button
                  onClick={onLogout}
                  className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded border border-red-500/20 transition"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
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
