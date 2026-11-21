import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  Moon,
  Sun,
  Download,
  Upload,
  Menu,
  KeyRound,
  X,
  Bell,
} from 'lucide-react';
import { CanonicalLead } from '../types.ts';
import { ActionMenu } from './ui/SunsetUI.tsx';

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
  reminderCount?: number;
  onOpenReminders?: () => void;
}

const TAB_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  discovery: 'Discover Leads',
  'country-matrix': 'Registry Matrix',
  leads: 'Companies',
  import: 'Import Hub',
  pipeline: 'Pipeline',
  tasks: 'Tasks',
  outreach: 'Outreach',
  dedupe: 'Dedupe Hub',
  'ai-agent': 'AI Sales Agent',
  'bi-analytics': 'Business Intelligence',
  workflows: 'Workflows',
  connectors: 'Connectors',
  'control-centre': 'Owner Control Centre',
};

export function TopBar({
  currentTab,
  theme,
  onToggleTheme,
  onOpenImport,
  onExportCsv,
  onOpenPasswordChange,
  onMobileMenuToggle,
  leads,
  onSelectLead,
  reminderCount = 0,
  onOpenReminders,
}: TopBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSearchResults) return;
    const handleOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSearchResults(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [showSearchResults]);

  const pageTitle = TAB_TITLES[currentTab] || 'LEED';

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
    <header className="h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
      {/* Left: Mobile Menu & Crisp Page Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onMobileMenuToggle}
          aria-label="Open navigation menu"
          className="p-2 rounded-lg text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-50 tracking-tight truncate">
          {pageTitle}
        </h1>
      </div>

      {/* Center: Global Search */}
      <div ref={searchRef} className="relative flex-1 max-w-sm hidden md:block">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          placeholder="Search companies, registration, or domain..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowSearchResults(true);
          }}
          onFocus={() => setShowSearchResults(true)}
          className="w-full pl-9 pr-8 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-[#E09F3E] focus:bg-white dark:focus:bg-slate-900 transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setShowSearchResults(false);
            }}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {showSearchResults && searchQuery.trim() && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden z-50">
            {filteredLeads.length === 0 ? (
              <div className="px-4 py-3 text-center text-xs text-slate-500 dark:text-slate-400">
                No matching companies for &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredLeads.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      onSelectLead(l);
                      setShowSearchResults(false);
                      setSearchQuery('');
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#FFF9D8]/60 dark:hover:bg-slate-800 flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white block truncate">
                        {l.companyName}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 block truncate">
                        {[l.registrationNumber, l.address?.city || l.address?.country]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-[#335C67] dark:text-[#E09F3E] shrink-0">
                      ${(l.opportunityValue || 0).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Concise Utility Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {onOpenReminders && (
          <button
            type="button"
            onClick={onOpenReminders}
            title="Reminders"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-[#FFF9D8]/60 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Bell className={`w-3.5 h-3.5 ${reminderCount > 0 ? 'text-[#E09F3E]' : 'text-slate-400'}`} />
            <span className="hidden sm:inline">Reminders</span>
            {reminderCount > 0 && (
              <span className="font-mono tabular-nums text-[#540B0E] dark:text-[#FFF3B0]">
                {reminderCount}
              </span>
            )}
          </button>
        )}

        <ActionMenu
          label="Actions"
          items={[
            {
              label: 'Import Leads',
              icon: <Upload className="w-3.5 h-3.5 text-[#335C67] dark:text-[#8AB0BA]" />,
              onClick: onOpenImport,
            },
            {
              label: 'Export CSV',
              icon: <Download className="w-3.5 h-3.5 text-[#335C67] dark:text-[#8AB0BA]" />,
              onClick: onExportCsv,
            },
            {
              label: 'Change Password',
              icon: <KeyRound className="w-3.5 h-3.5 text-slate-500" />,
              onClick: onOpenPasswordChange,
            },
          ]}
        />

        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 hover:text-slate-900 dark:text-[#FFF3B0] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-[#E09F3E]" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
