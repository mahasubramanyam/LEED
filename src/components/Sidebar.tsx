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
      className={`relative flex flex-col bg-[#0B1113] border-r border-[#3A4D50] text-[#F0F4F3] transition-[width] duration-200 z-30 shrink-0 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-[#3A4D50]/80">
        {!collapsed ? (
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            className="flex items-center gap-2.5 text-left focus-visible:outline-none group"
          >
            <span className="w-8 h-8 rounded-lg bg-[#192629] border border-[#C49A52]/60 flex items-center justify-center text-[#DFB76D] font-extrabold text-base tracking-tight shrink-0">
              L
            </span>
            <span className="text-lg font-extrabold tracking-tight text-[#F2F6F5] whitespace-nowrap">
              LEED
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            title="LEED Dashboard"
            className="mx-auto w-8 h-8 rounded-lg bg-[#192629] border border-[#C49A52]/60 flex items-center justify-center text-[#DFB76D] font-extrabold text-base"
          >
            L
          </button>
        )}

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`p-1.5 rounded-lg text-[#B8C7C4] hover:text-[#F2F6F5] hover:bg-[#243638] transition-colors ${
            collapsed
              ? 'hidden sm:flex items-center justify-center absolute -right-3 top-5 bg-[#192629] border border-[#3E5256] shadow-sm'
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
              <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#9EB2AE]">
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
                      ? 'bg-[#335C67]/40 text-[#F4F8F7] font-bold'
                      : 'text-[#C2D0CD] font-semibold hover:text-[#F4F8F7] hover:bg-[#243638]/85'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  {isActive && !collapsed && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-[#DFB76D]"
                    />
                  )}
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-[#DFB76D]' : 'text-[#A9BBB8]'
                    }`}
                  />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {item.count !== undefined && item.count > 0 && (
                        <span
                          className={`text-xs font-bold font-mono tabular-nums ${
                            isActive ? 'text-[#DFB76D]' : 'text-[#B8C7C4]'
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
      <div className="p-3 border-t border-[#3A4D50]/80 bg-[#0B1113]">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[#192629] border border-[#C49A52]/60 text-[#DFB76D] flex items-center justify-center font-bold text-sm shrink-0">
                {ownerName ? ownerName.charAt(0).toUpperCase() : 'O'}
              </div>
              <div className="min-w-0">
                <span className="text-sm font-bold text-[#F2F6F5] block truncate leading-tight">
                  {ownerName || 'Owner'}
                </span>
                <span className="text-[11px] font-medium text-[#B8C7C4] block truncate">
                  {ownerEmail}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="p-1.5 text-[#B8C7C4] hover:text-[#DFB76D] hover:bg-[#243638] rounded-lg transition-colors shrink-0"
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
              className="w-8 h-8 rounded-full bg-[#192629] border border-[#C49A52]/60 text-[#DFB76D] flex items-center justify-center font-bold text-sm"
            >
              {ownerName ? ownerName.charAt(0).toUpperCase() : 'O'}
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="p-1.5 text-[#B8C7C4] hover:text-[#DFB76D] hover:bg-[#243638] rounded-lg transition-colors"
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
