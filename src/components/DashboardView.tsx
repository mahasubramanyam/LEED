import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  DollarSign,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  ChevronRight,
  Users,
  Activity,
  AlertTriangle,
  Calendar,
  Bell,
  Briefcase,
  RefreshCw,
} from 'lucide-react';
import {
  CanonicalLead,
  PipelineStage,
  LeadTask,
  ConnectorStatus,
  CrmDashboardSummary,
} from '../types.ts';
import {
  summarizeValuesByCurrency,
  formatCurrencyLocale,
  formatNumberLocale,
  getLocaleForCountry,
} from '../../shared/localization.ts';
import {
  getInteractionTypeLabel,
  getRelationshipStatusLabel,
} from '../../shared/crmSpecs.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface DashboardViewProps {
  leads: CanonicalLead[];
  stages: PipelineStage[];
  tasks: LeadTask[];
  connectors: ConnectorStatus[];
  onNavigateTab: (tab: string) => void;
  onSelectLead: (lead: CanonicalLead) => void;
  onOpenImport: () => void;
  onOpenPersonProfile?: (personId: string) => void;
  onOpenReminderCenter?: () => void;
}

export function DashboardView({
  leads,
  stages,
  tasks,
  connectors,
  onNavigateTab,
  onSelectLead,
  onOpenImport,
  onOpenPersonProfile,
  onOpenReminderCenter,
}: DashboardViewProps) {
  const [crmSummary, setCrmSummary] = useState<CrmDashboardSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const fetchCrmDashboard = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const res = await apiFetch('/api/crm/dashboard');
      if (res.ok) {
        setCrmSummary(await res.json());
      }
    } catch {
      // Fall back gracefully to prop-derived real counts
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    fetchCrmDashboard();
  }, [fetchCrmDashboard, leads.length, tasks.length]);

  const pipelineSummary = summarizeValuesByCurrency(leads, 'USD');
  const activeConnectorsCount = connectors.filter((c) => c.status === 'healthy').length;
  const pendingTasks = tasks.filter((t) => !t.completed && t.status !== 'completed' && t.status !== 'cancelled');

  const m = crmSummary?.metrics;
  const totalCompanies = m ? m.totalCompanies : leads.length;
  const totalDecisionMakers = m ? m.totalDecisionMakers : 0;
  const activeRelationships = m ? m.activeRelationships : 0;
  const newRelationships30d = m ? m.newRelationships30d : 0;
  const recentInteractions30d = m ? m.recentInteractions30d : 0;
  const todaysFollowUps = m ? m.todaysFollowUps : 0;
  const overdueFollowUps = m ? m.overdueFollowUps : 0;
  const upcomingMeetings7d = m ? m.upcomingMeetings7d : 0;
  const activeOpportunities = m ? m.activeOpportunities : 0;

  const expectedValueDisplay =
    m && m.expectedOpportunityValueByCurrency.length > 0
      ? m.expectedOpportunityValueByCurrency
          .map((b) => `${b.currency} ${b.totalValue.toLocaleString()}`)
          .join(' · ')
      : pipelineSummary.primaryFormatted;

  const weightedValueDisplay =
    m && m.expectedOpportunityValueByCurrency.length > 0
      ? m.expectedOpportunityValueByCurrency
          .map((b) => `${b.currency} ${b.weightedValue.toLocaleString()}`)
          .join(' · ')
      : null;

  const stageRows =
    crmSummary?.opportunitiesByStage && crmSummary.opportunitiesByStage.length > 0
      ? crmSummary.opportunitiesByStage
      : stages.map((stage) => {
          const stageLeads = leads.filter((l) => l.pipelineStageId === stage.id);
          const summary = summarizeValuesByCurrency(stageLeads, 'USD');
          return {
            stageId: stage.id,
            stageName: stage.name,
            stageColor: stage.color || '#3b82f6',
            count: stageLeads.length,
            totalValue: 0,
            currencySummary: summary.primaryFormatted,
          };
        });

  const handleOpenLeadById = (leadId?: string) => {
    if (!leadId) return;
    const found = leads.find((l) => l.id === leadId);
    if (found) onSelectLead(found);
  };

  const isEmpty = leads.length === 0 && totalDecisionMakers === 0;

  return (
    <div className="space-y-6">
      {/* Header strip with live refresh & Reminder Centre */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
            Personal CRM &amp; Relationship Command Centre
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time metrics computed strictly from your CRM companies, decision-makers, interactions, tasks, and opportunities
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenReminderCenter && (
            <button
              onClick={onOpenReminderCenter}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
            >
              <Bell className="w-3.5 h-3.5 text-indigo-500" />
              <span>Reminders</span>
              {(crmSummary?.reminderCounts.total ?? 0) > 0 && (
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                  ({crmSummary?.reminderCounts.total})
                </span>
              )}
            </button>
          )}
          <button
            onClick={fetchCrmDashboard}
            disabled={loadingSummary}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 hover:text-slate-900 dark:hover:text-white"
            title="Refresh CRM metrics"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingSummary ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Primary KPI Grid (Row 1: Relationships & Activity) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Companies &amp; People</span>
            <Building2 className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono">
              {formatNumberLocale(totalCompanies)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              · {formatNumberLocale(totalDecisionMakers)} decision-makers
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {activeRelationships} active relationships · {newRelationships30d} new (30d)
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Follow-Ups &amp; Meetings</span>
            <Calendar className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono">
              {todaysFollowUps}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">today</span>
            {overdueFollowUps > 0 && (
              <span className="text-xs font-semibold text-rose-500">· {overdueFollowUps} overdue</span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {upcomingMeetings7d} upcoming meeting(s) (7d) · {pendingTasks.length} open tasks
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Active Opportunities</span>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold text-slate-900 dark:text-white font-mono truncate">
              {expectedValueDisplay}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate">
            {activeOpportunities} open deal(s)
            {weightedValueDisplay ? ` · Weighted: ${weightedValueDisplay}` : ''}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Interactions &amp; Health</span>
            <Activity className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono">
              {recentInteractions30d}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">logged (30d)</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {m?.relationshipsNeedingAttentionCount ?? 0} needing attention · {activeConnectorsCount}/{connectors.length} connectors healthy
          </p>
        </div>
      </div>

      {isEmpty ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
              Welcome to LEED Personal CRM &amp; Intelligence Platform
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              Your sole-owner CRM workspace is ready. Discover verified businesses, import existing company and contact records, or start logging business relationships.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 max-w-4xl mx-auto">
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Discover Global Leads</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  Search official business registries, directories, and websites worldwide.
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('discovery')}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400"
              >
                Open Discovery Engine <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Import CRM Relationships</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  Upload CSV/XLSX companies, decision-makers, notes, and interaction history with dedupe preview.
                </p>
              </div>
              <button
                onClick={onOpenImport}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
              >
                Open Import Hub <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Manage Follow-Ups</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                  Track tasks, meetings, private notes, and multi-opportunity pipelines.
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('tasks')}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400"
              >
                Open Task Manager <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Opportunities / Pipeline Stage Distribution */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Opportunities &amp; Pipeline by Stage
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Live stage breakdown across active deals and companies
                </p>
              </div>
              <button
                onClick={() => onNavigateTab('pipeline')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Open Pipeline &amp; Opportunities <ArrowRight className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {stageRows.map((row) => (
                <div
                  key={row.stageId}
                  className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30"
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: row.stageColor || '#3b82f6' }}
                    />
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
                      {row.stageName}
                    </span>
                  </div>
                  <div className="mt-1.5 text-base font-bold font-mono text-slate-900 dark:text-white">
                    {formatNumberLocale(row.count)}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono block truncate" title={row.currencySummary}>
                    {row.currencySummary}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Action Row: Follow-Ups (Overdue + Today), Upcoming Meetings, Relationships Needing Attention */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Today's & Overdue Follow-Ups */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-500" />
                  Due Today &amp; Overdue Follow-Ups
                </h3>
                <button
                  onClick={() => onNavigateTab('tasks')}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Manage Tasks
                </button>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
                {((crmSummary?.overdueFollowUpTasks?.length || 0) + (crmSummary?.todaysFollowUpTasks?.length || 0)) === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No overdue or due-today follow-up tasks.
                  </div>
                ) : (
                  [...(crmSummary?.overdueFollowUpTasks || []), ...(crmSummary?.todaysFollowUpTasks || [])]
                    .slice(0, 6)
                    .map((task) => {
                      const isOverdue = (crmSummary?.overdueFollowUpTasks || []).some((t) => t.id === task.id);
                      return (
                        <div key={task.id} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                            {task.title}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className={isOverdue ? 'text-rose-500 font-semibold' : 'text-amber-500 font-semibold'}>
                              {isOverdue ? 'Overdue' : 'Today'}
                            </span>
                            <span>·</span>
                            <span>{new Date(task.dueDate).toLocaleDateString()}</span>
                            {task.companyName && (
                              <>
                                <span>·</span>
                                <button
                                  onClick={() => handleOpenLeadById(task.leadId)}
                                  className="text-indigo-500 dark:text-indigo-400 hover:underline"
                                >
                                  {task.companyName}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            {/* Upcoming Meetings & Recent Interactions */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-indigo-500" />
                  Recent Interactions &amp; Meetings
                </h3>
                <span className="text-[11px] text-slate-500">{upcomingMeetings7d} meetings (7d)</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
                {(crmSummary?.recentInteractions?.length || 0) === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No manually logged interactions yet. Open any company or person to log a call, meeting, or note.
                  </div>
                ) : (
                  (crmSummary?.recentInteractions || []).slice(0, 6).map((item) => (
                    <div key={item.id} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                        {item.summary}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                        <span className="text-indigo-500 dark:text-indigo-400">
                          {getInteractionTypeLabel(item.type)}
                        </span>
                        {' · '}
                        {new Date(item.occurredAt).toLocaleDateString()}
                        {item.companyName && ` · ${item.companyName}`}
                        {item.personName && ` · ${item.personName}`}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Relationships Needing Attention */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  Relationships Needing Attention
                </h3>
                <span className="text-[11px] text-slate-500">
                  {crmSummary?.relationshipsNeedingAttention?.length || 0} flagged
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
                {(crmSummary?.relationshipsNeedingAttention?.length || 0) === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    All tracked relationships are currently healthy and on schedule.
                  </div>
                ) : (
                  (crmSummary?.relationshipsNeedingAttention || []).slice(0, 6).map((item) => (
                    <button
                      key={`${item.entityType}-${item.id}`}
                      onClick={() =>
                        item.entityType === 'company'
                          ? handleOpenLeadById(item.id)
                          : onOpenPersonProfile?.(item.id)
                      }
                      className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-rose-500 dark:text-rose-400 truncate mt-0.5">
                          {item.reason}
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Bottom Row: Recently Updated Companies & Recently Contacted People */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Recently Updated Companies */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                  Recently Updated Companies
                </h3>
                <button
                  onClick={() => onNavigateTab('leads')}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  All Companies <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(crmSummary?.recentlyUpdatedCompanies || []).slice(0, 5).map((co) => {
                  const fullLead = leads.find((l) => l.id === co.id);
                  return (
                    <div
                      key={co.id}
                      onClick={() => fullLead && onSelectLead(fullLead)}
                      className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {co.companyName}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {co.industry}
                          {co.country ? ` · ${co.country}` : ''} · {getRelationshipStatusLabel(co.relationshipStatus)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {fullLead && (fullLead.opportunityValue || 0) > 0 && (
                          <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                            {formatCurrencyLocale(
                              fullLead.opportunityValue || 0,
                              fullLead.currency || 'USD',
                              getLocaleForCountry(fullLead.address?.countryCode, fullLead.currency)
                            )}
                          </span>
                        )}
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recently Contacted People */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-emerald-500" />
                  Recently Contacted Decision-Makers
                </h3>
                <button
                  onClick={() => onNavigateTab('import')}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  People Directory <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(crmSummary?.recentlyContactedPeople?.length || 0) === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No person-level interactions logged yet. Record a call or meeting linked to a decision-maker to track contact recency here.
                  </div>
                ) : (
                  (crmSummary?.recentlyContactedPeople || []).slice(0, 5).map((person) => (
                    <div
                      key={person.id}
                      onClick={() => onOpenPersonProfile?.(person.id)}
                      className="px-5 py-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {person.fullName}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate mt-0.5">
                          {[person.jobTitle, person.companyName].filter(Boolean).join(' · ') || 'Decision-Maker'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                          {new Date(person.lastContactDate).toLocaleDateString()}
                        </div>
                        {person.lastInteractionType && (
                          <div className="text-[10px] text-slate-500">
                            {getInteractionTypeLabel(person.lastInteractionType)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
