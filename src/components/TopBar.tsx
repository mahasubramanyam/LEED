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
    <header className="h-16 bg-white dark:bg-[#440303]/95 backdrop-blur-xs border-b border-[#E4DADA] dark:border-[#7A1E1E] shadow-[0_1px_2px_rgba(36,2,2,0.04)] px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
      {/* Left: Mobile Menu & Bold Dark Maroon Page Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onMobileMenuToggle}
          aria-label="Open navigation menu"
          className="p-2 rounded-lg text-[#440303] hover:text-[#910303] dark:text-[#E6D2D2] dark:hover:text-white hover:bg-[#F5EDED] dark:hover:bg-[#690303] lg:hidden shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-xl sm:text-2xl font-extrabold text-[#440303] dark:text-[#FAF4F4] tracking-tight truncate">
          {pageTitle}
        </h1>
      </div>

      {/* Center: Global Search */}
      <div ref={searchRef} className="relative flex-1 max-w-sm hidden md:block">
        <Search className="w-4 h-4 text-[#5A4242] dark:text-[#C9A7A7] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          placeholder="Search companies, registration, or domain..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowSearchResults(true);
          }}
          onFocus={() => setShowSearchResults(true)}
          className="w-full pl-9 pr-8 py-1.5 text-sm font-medium rounded-lg border border-[#D8CACA] dark:border-[#8C2828] bg-[#F8F6F6] dark:bg-[#240202] text-[#240202] dark:text-[#FAF4F4] placeholder:text-[#6B5555] dark:placeholder:text-[#C9A7A7] focus:outline-none focus:border-[#CE0404] focus:bg-white dark:focus:bg-[#240202] transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setShowSearchResults(false);
            }}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#5A4242] dark:text-[#C9A7A7] hover:text-[#440303] dark:hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {showSearchResults && searchQuery.trim() && (
          <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-[#690303] border border-[#D8CACA] dark:border-[#8C2828] rounded-xl shadow-xl overflow-hidden z-50">
            {filteredLeads.length === 0 ? (
              <div className="px-4 py-3 text-center text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2]">
                No matching companies for &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              <div className="divide-y divide-[#ECE3E3] dark:divide-[#7A1E1E]">
                {filteredLeads.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      onSelectLead(l);
                      setShowSearchResults(false);
                      setSearchQuery('');
                    }}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#FAF5F5] dark:hover:bg-[#910303] flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-semibold text-[#240202] dark:text-[#FAF4F4] block truncate">
                        {l.companyName}
                      </span>
                      <span className="text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2] block truncate">
                        {[l.registrationNumber, l.address?.city || l.address?.country]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <span className="text-xs font-bold font-mono tabular-nums text-[#910303] dark:text-[#FF9492] shrink-0">
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#440303] dark:text-[#FAF4F4] bg-white dark:bg-[#240202] hover:bg-[#FDF6F6] hover:border-[#910303] dark:hover:bg-[#690303] border border-[#D4C2C2] dark:border-[#8C2828] rounded-lg transition-colors whitespace-nowrap"
          >
            <Bell className={`w-3.5 h-3.5 ${reminderCount > 0 ? 'text-[#E52825]' : 'text-[#690303] dark:text-[#C9A7A7]'}`} />
            <span className="hidden sm:inline">Reminders</span>
            {reminderCount > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-[#E52825] text-white font-bold font-mono tabular-nums text-[11px]">
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
              icon: <Upload className="w-3.5 h-3.5 text-[#B30303] dark:text-[#FF9492]" />,
              onClick: onOpenImport,
            },
            {
              label: 'Export CSV',
              icon: <Download className="w-3.5 h-3.5 text-[#B30303] dark:text-[#FF9492]" />,
              onClick: onExportCsv,
            },
            {
              label: 'Change Password',
              icon: <KeyRound className="w-3.5 h-3.5 text-[#543F3F] dark:text-[#E6D2D2]" />,
              onClick: onOpenPasswordChange,
            },
          ]}
        />

        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to balanced light theme' : 'Switch to dark maroon theme'}
          aria-label={theme === 'dark' ? 'Switch to balanced light theme' : 'Switch to dark maroon theme'}
          className="p-2 rounded-lg border border-[#D4C2C2] dark:border-[#8C2828] bg-white dark:bg-[#240202] text-[#440303] hover:text-[#910303] hover:border-[#910303] dark:text-[#FF9492] dark:hover:text-white hover:bg-[#FDF6F6] dark:hover:bg-[#690303] transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-[#FF9492]" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
