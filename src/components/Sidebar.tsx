import React from 'react';
import {
  LayoutDashboard,
  Search,
  Building2,
  Kanban,
  CheckSquare,
  Send,
  GitMerge,
  Sparkles,
  Radio,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Globe2,
  FileSpreadsheet,
  BarChart3,
  Workflow,
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  leadsCount: number;
  pendingTasksCount: number;
  pendingApprovalsCount: number;
  ownerName: string;
  ownerEmail: string;
  isDbConnected: boolean;
  onLogout: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

export function Sidebar({
  currentTab,
  onSelectTab,
  collapsed,
  onToggleCollapsed,
  leadsCount,
  pendingTasksCount,
  pendingApprovalsCount,
  ownerName,
  ownerEmail,
  onLogout,
}: SidebarProps) {
  const navGroups: NavGroup[] = [
    {
      heading: 'Overview',
      items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
    },
    {
      heading: 'Discovery',
      items: [
        { id: 'discovery', label: 'Discover', icon: Search },
        { id: 'country-matrix', label: 'Registry Matrix', icon: Globe2 },
        { id: 'import', label: 'Import Hub', icon: FileSpreadsheet },
      ],
    },
    {
      heading: 'CRM',
      items: [
        { id: 'leads', label: 'Companies', icon: Building2, count: leadsCount },
        { id: 'pipeline', label: 'Pipeline', icon: Kanban },
        { id: 'tasks', label: 'Tasks', icon: CheckSquare, count: pendingTasksCount },
        { id: 'dedupe', label: 'Dedupe', icon: GitMerge },
      ],
    },
    {
      heading: 'Engagement',
      items: [
        { id: 'outreach', label: 'Outreach', icon: Send, count: pendingApprovalsCount },
        { id: 'ai-agent', label: 'AI Agent', icon: Sparkles },
      ],
    },
    {
      heading: 'Operations',
      items: [
        { id: 'bi-analytics', label: 'Analytics', icon: BarChart3 },
        { id: 'workflows', label: 'Workflows', icon: Workflow },
        { id: 'connectors', label: 'Connectors', icon: Radio },
        { id: 'control-centre', label: 'Control Centre', icon: ShieldCheck },
      ],
    },
  ];

  return (
    <aside
      aria-label="Primary navigation"
      className={`relative flex flex-col bg-[#440303] border-r border-[#7A1E1E] text-[#FAF4F4] transition-[width] duration-200 z-30 shrink-0 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-[#7A1E1E]/85">
        {!collapsed ? (
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            className="flex items-center gap-2.5 text-left focus-visible:outline-none group"
          >
            <span className="w-8 h-8 rounded-lg bg-[#240202] border border-[#CE0404]/80 flex items-center justify-center text-[#FAF4F4] font-extrabold text-base tracking-tight shrink-0">
              L
            </span>
            <span className="text-lg font-extrabold tracking-tight text-[#FAF4F4] whitespace-nowrap">
              LEED
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            title="LEED Dashboard"
            className="mx-auto w-8 h-8 rounded-lg bg-[#240202] border border-[#CE0404]/80 flex items-center justify-center text-[#FAF4F4] font-extrabold text-base"
          >
            L
          </button>
        )}

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`p-1.5 rounded-lg text-[#E6D2D2] hover:text-white hover:bg-[#690303] transition-colors ${
            collapsed
              ? 'hidden sm:flex items-center justify-center absolute -right-3 top-5 bg-[#440303] border border-[#8C2828] shadow-sm'
              : ''
          }`}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 px-2.5 py-4 space-y-4 overflow-y-auto scrollbar-thin">
        {navGroups.map((group) => (
          <div key={group.heading} className="space-y-0.5">
            {!collapsed && (
              <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#C9A7A7]">
                {group.heading}
              </div>
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#910303] text-white font-bold shadow-xs'
                      : 'text-[#E6D2D2] font-semibold hover:text-white hover:bg-[#690303]'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  {isActive && !collapsed && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-[#CE0404]"
                    />
                  )}
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-white' : 'text-[#D8BABA]'
                    }`}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {item.count !== undefined && item.count > 0 && (
                        <span
                          className={`text-xs font-bold font-mono tabular-nums ${
                            item.id === 'outreach'
                              ? 'px-1.5 py-0.5 rounded bg-[#E52825] text-white'
                              : isActive
                              ? 'text-[#FAF4F4]'
                              : 'text-[#D8BABA]'
                          }`}
                        >
                          {item.count}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Owner Footer */}
      <div className="p-3 border-t border-[#7A1E1E]/85 bg-[#240202]/70">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[#690303] border border-[#CE0404]/70 text-white flex items-center justify-center font-bold text-sm shrink-0">
                {ownerName ? ownerName.charAt(0).toUpperCase() : 'O'}
              </div>
              <div className="min-w-0">
                <span className="text-sm font-bold text-[#FAF4F4] block truncate leading-tight">
                  {ownerName || 'Owner'}
                </span>
                <span className="text-[11px] font-medium text-[#C9A7A7] block truncate">
                  {ownerEmail}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="p-1.5 text-[#E6D2D2] hover:text-white hover:bg-[#690303] rounded-lg transition-colors shrink-0"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div
              title={ownerName || 'Owner'}
              className="w-8 h-8 rounded-full bg-[#690303] border border-[#CE0404]/70 text-white flex items-center justify-center font-bold text-sm"
            >
              {ownerName ? ownerName.charAt(0).toUpperCase() : 'O'}
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="p-1.5 text-[#E6D2D2] hover:text-white hover:bg-[#690303] rounded-lg transition-colors"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
