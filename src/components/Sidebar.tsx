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
  User,
  ExternalLink,
  Globe2,
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
  isDbConnected,
  onLogout,
}: SidebarProps) {
  const navItems = [
    { id: 'dashboard', label: 'Executive Dashboard', shortLabel: 'Dashboard', icon: LayoutDashboard },
    { id: 'discovery', label: 'Registry Discovery', shortLabel: 'Discovery', icon: Search, badge: '4 Sources' },
    { id: 'country-matrix', label: 'Country Matrix', shortLabel: 'Matrix', icon: Globe2, badge: '195 States' },
    { id: 'leads', label: 'Leads Intelligence', shortLabel: 'Leads', icon: Building2, count: leadsCount },
    { id: 'pipeline', label: 'Pipeline Kanban', shortLabel: 'Pipeline', icon: Kanban },
    { id: 'tasks', label: 'Tasks & Follow-ups', shortLabel: 'Tasks', icon: CheckSquare, count: pendingTasksCount },
    { id: 'outreach', label: 'Outreach & HITL', shortLabel: 'Outreach', icon: Send, count: pendingApprovalsCount },
    { id: 'dedupe', label: 'Dedupe Hub', shortLabel: 'Dedupe', icon: GitMerge },
    { id: 'ai-agent', label: 'AI Sales Agent', shortLabel: 'AI Agent', icon: Sparkles },
    { id: 'connectors', label: 'Connectors Observability', shortLabel: 'Connectors', icon: Radio },
    { id: 'control-centre', label: 'Owner Control Centre', shortLabel: 'Admin', icon: ShieldCheck, isSpecial: true },
  ];

  return (
    <aside
      className={`relative flex flex-col bg-slate-900 border-r border-slate-800 text-slate-300 transition-all duration-300 z-30 shrink-0 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
        {!collapsed && (
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md shrink-0">
              L
            </div>
            <div className="truncate">
              <span className="font-bold text-sm text-white tracking-tight block">LEED Intel</span>
              <span className="text-[10px] text-blue-400 font-mono block -mt-0.5">SaaS Enterprise</span>
            </div>
          </div>
        )}

        {collapsed && (
          <div className="mx-auto w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
            L
          </div>
        )}

        <button
          onClick={onToggleCollapsed}
          className={`p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ${
            collapsed ? 'hidden sm:block absolute -right-3 top-5 bg-slate-800 border border-slate-700 shadow-sm' : ''
          }`}
          title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-2.5 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? item.isSpecial
                    ? 'bg-blue-600 text-white shadow-xs font-semibold'
                    : 'bg-slate-800 text-white font-semibold shadow-xs border border-slate-700/60'
                  : item.isSpecial
                  ? 'text-blue-400 hover:text-white hover:bg-blue-950/40'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : item.isSpecial ? 'text-blue-400' : 'text-slate-400'}`} />

              {!collapsed && (
                <>
                  <span className="flex-1 text-left truncate">{item.label}</span>
                  {item.count !== undefined && item.count > 0 && (
                    <span
                      className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full ${
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                  {item.badge && (
                    <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded-md bg-blue-950 text-blue-300 border border-blue-800">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Owner Profile Section */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/60">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">
                {ownerName ? ownerName.charAt(0).toUpperCase() : 'M'}
              </div>
              <div className="min-w-0">
                <span className="text-xs font-semibold text-white block truncate">{ownerName || 'Maha'}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${isDbConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span className="text-[10px] text-slate-400 truncate">Single Owner</span>
                </div>
              </div>
            </div>

            <button
              onClick={onLogout}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors shrink-0"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 text-blue-400 flex items-center justify-center font-bold text-xs">
              {ownerName ? ownerName.charAt(0).toUpperCase() : 'M'}
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
