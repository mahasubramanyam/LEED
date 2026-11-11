import React, { useState } from 'react';
import {
  Search,
  Moon,
  Sun,
  Download,
  Upload,
  Database,
  Menu,
  Key,
  Shield,
  X
} from 'lucide-react';
import { CanonicalLead } from '../types.ts';

interface TopBarProps {
  currentTab: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  isDbConnected: boolean;
  onOpenImport: () => void;
  onExportCsv: () => void;
  onOpenPasswordChange: () => void;
  onMobileMenuToggle: () => void;
  leads: CanonicalLead[];
  onSelectLead: (lead: CanonicalLead) => void;
}

export function TopBar({
  currentTab,
  theme,
  onToggleTheme,
  isDbConnected,
  onOpenImport,
  onExportCsv,
  onOpenPasswordChange,
  onMobileMenuToggle,
  leads,
  onSelectLead,
}: TopBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Tab label titles
  const tabTitles: Record<string, { title: string; subtitle: string }> = {
    dashboard: { title: 'Executive Dashboard', subtitle: 'Platform KPI overview, registry status, and pipeline health' },
    discovery: { title: 'Registry Discovery', subtitle: 'Live query engine across Norway (Brreg), UK (Companies House), Australia (ABN), & OSM' },
    leads: { title: 'Leads Intelligence', subtitle: 'Canonical CRM database with official registration numbers & confidence scores' },
    pipeline: { title: 'Pipeline Kanban', subtitle: 'Stage progression, opportunity values, and deal velocity' },
    tasks: { title: 'Tasks & Follow-ups', subtitle: 'Owner scheduled engagements and priority tracking' },
    outreach: { title: 'Campaigns & HITL Approval', subtitle: 'Human-in-the-Loop email outreach approval queue' },
    dedupe: { title: 'Deduplication Hub', subtitle: 'Cross-registry deduplication, deterministic matching, and rollback ledger' },
    'ai-agent': { title: 'AI Sales Agent', subtitle: 'Gemini-powered pitch generation, meeting briefings, and market analysis' },
    connectors: { title: 'Connectors Observability', subtitle: 'Status, rate limits, latency, and attribution telemetry' },
    'control-centre': { title: 'Owner Control Centre', subtitle: 'Sole administrator settings, active sessions, and Neon PostgreSQL diagnostics' },
  };

  const currentInfo = tabTitles[currentTab] || { title: 'Lead Intelligence', subtitle: 'Production single-owner platform' };

  // Filtered leads for global search
  const filteredLeads = searchQuery.trim()
    ? leads
        .filter(
          (l) =>
            l.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (l.registrationNumber && l.registrationNumber.includes(searchQuery)) ||
            (l.domain && l.domain.toLowerCase().includes(searchQuery.toLowerCase()))
        )
        .slice(0, 6)
    : [];

  return (
    <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-20 shadow-2xs">
      {/* Left: Mobile Toggle & Page Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMobileMenuToggle}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="truncate">
          <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight truncate">
            {currentInfo.title}
          </h1>
          <p className="hidden md:block text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {currentInfo.subtitle}
          </p>
        </div>
      </div>

      {/* Center: Global Search Bar */}
      <div className="relative flex-1 max-w-xs sm:max-w-md hidden sm:block">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search leads, CRN, or domains..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setShowSearchResults(false);
              }}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Global Search Results Dropdown */}
        {showSearchResults && searchQuery.trim() && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg overflow-hidden z-50">
            {filteredLeads.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">
                No matching leads found for &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredLeads.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => {
                      onSelectLead(l);
                      setShowSearchResults(false);
                      setSearchQuery('');
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between text-xs transition-colors"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-white block">
                        {l.companyName}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {l.registrationNumber ? `CRN: ${l.registrationNumber} · ` : ''}{l.address?.city || l.address?.country}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono font-medium text-blue-600 dark:text-blue-400">
                      ${(l.opportunityValue || 0).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Neon Database Live Indicator */}
        <div className="hidden xl:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 text-[11px] font-mono text-slate-600 dark:text-slate-300">
          <Database className="w-3.5 h-3.5 text-blue-500" />
          <span>Neon PG 18.6</span>
          <span className={`w-1.5 h-1.5 rounded-full ${isDbConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
        </div>

        {/* Quick CSV Export */}
        <button
          onClick={onExportCsv}
          title="Export CRM to CSV"
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors shadow-2xs"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>

        {/* Quick CSV Import */}
        <button
          onClick={onOpenImport}
          title="Batch Import Leads"
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-xs"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Import</span>
        </button>

        {/* Light / Dark Mode Toggle */}
        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
        </button>
      </div>
    </header>
  );
}
