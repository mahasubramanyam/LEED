import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowRight,
  ChevronRight,
  RefreshCw,
  Bot,
  ShieldCheck,
} from 'lucide-react';
import {
  CanonicalLead,
  PipelineStage,
  LeadTask,
  ConnectorStatus,
  CrmDashboardSummary,
  AiAgentLaunchContext,
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
import { FeatureBanner, KpiMetric, SurfaceCard } from './ui/SunsetUI.tsx';

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
  onOpenAiAgent?: (ctx: AiAgentLaunchContext) => void;
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
  onOpenAiAgent,
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
      // Fall back gracefully to prop-derived counts
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    fetchCrmDashboard();
  }, [fetchCrmDashboard, leads.length, tasks.length]);

  const pipelineSummary = summarizeValuesByCurrency(leads, 'USD');
  const activeConnectorsCount = connectors.filter((c) => c.status === 'healthy').length;
  const pendingTasks = tasks.filter(
    (t) => !t.completed && t.status !== 'completed' && t.status !== 'cancelled'
  );

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
            stageColor: stage.color || '#B30303',
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
  const combinedFollowUps = [
    ...(crmSummary?.overdueFollowUpTasks || []),
    ...(crmSummary?.todaysFollowUpTasks || []),
  ];

  return (
    <div className="space-y-6">
      {/* Executive Feature Banner — Rich Blood Red, Dark Red & Crimson */}
      <FeatureBanner
        tone="blood"
        eyebrow="Executive Overview"
        title="Global Lead Intelligence & Sales Command"
        description={`${formatNumberLocale(activeRelationships)} active relationships across ${formatNumberLocale(
          totalCompanies
        )} tracked companies, backed by ${activeConnectorsCount} of ${connectors.length} healthy registry connectors.`}
        highlights={[
          {
            label: 'Active Relationships',
            value: formatNumberLocale(activeRelationships),
            sub: `${newRelationships30d} new (30d)`,
          },
          {
            label: 'Healthy Connectors',
            value: `${activeConnectorsCount}/${connectors.length}`,
            sub: `${upcomingMeetings7d} meetings (7d)`,
          },
        ]}
        actions={
          <>
            {onOpenAiAgent && (
              <button
                type="button"
                onClick={() => onOpenAiAgent({ tab: 'briefing' })}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-[#FAF0F0] text-[#910303] text-xs font-bold shadow-xs transition-colors whitespace-nowrap"
              >
                <Bot className="w-3.5 h-3.5 text-[#B30303]" />
                <span>Daily Briefing</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigateTab('discovery')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/12 hover:bg-white/22 text-white border border-white/25 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <span>Discover Leads</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={fetchCrmDashboard}
              disabled={loadingSummary}
              className="p-2 rounded-lg bg-white/12 hover:bg-white/22 text-white border border-white/25 transition-colors disabled:opacity-60"
              title="Refresh metrics"
              aria-label="Refresh metrics"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSummary ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      {/* Primary KPI Row — Contrasting White Cards + Selected Dark-Red Feature Card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiMetric
          label="Companies & Contacts"
          value={formatNumberLocale(totalCompanies)}
          detail={`${formatNumberLocale(totalDecisionMakers)} contacts · ${newRelationships30d} new (30d)`}
          tone="teal"
          onClick={() => onNavigateTab('leads')}
        />
        <KpiMetric
          label="Follow-Ups Due"
          value={todaysFollowUps}
          detail={
            overdueFollowUps > 0
              ? `${overdueFollowUps} overdue · ${pendingTasks.length} open tasks`
              : `${upcomingMeetings7d} meetings (7d) · ${pendingTasks.length} open`
          }
          tone={overdueFollowUps > 0 ? 'danger' : 'amber'}
          onClick={() => onNavigateTab('tasks')}
        />
        <KpiMetric
          label="Pipeline Value"
          value={expectedValueDisplay}
          detail={
            weightedValueDisplay
              ? `${activeOpportunities} open · Weighted ${weightedValueDisplay}`
              : `${activeOpportunities} open deals`
          }
          variant="maroon"
          onClick={() => onNavigateTab('pipeline')}
        />
        <KpiMetric
          label="Interactions (30d)"
          value={formatNumberLocale(recentInteractions30d)}
          detail={`${m?.relationshipsNeedingAttentionCount ?? 0} needing attention`}
          tone="default"
        />
      </div>

      {isEmpty ? (
        <SurfaceCard padding="lg">
          <div className="max-w-xl mx-auto text-center">
            <div className="w-11 h-11 rounded-xl bg-[#440303] border border-[#910303] text-white flex items-center justify-center mx-auto mb-3 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-[#440303] dark:text-[#FAF4F4]">
              Welcome to LEED
            </h2>
            <p className="text-sm font-medium text-[#543F3F] dark:text-[#E6D2D2] mt-1">
              Discover verified companies, import existing records, or schedule follow-ups.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 max-w-3xl mx-auto">
            <button
              type="button"
              onClick={() => onNavigateTab('discovery')}
              className="p-4 rounded-xl border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#240202] hover:border-[#B30303] hover:bg-white dark:hover:bg-[#690303] text-left transition-all shadow-[0_1px_2px_rgba(36,2,2,0.04)]"
            >
              <div className="text-base font-bold text-[#240202] dark:text-[#FAF4F4]">Discover Leads</div>
              <p className="text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2] mt-1">
                Search official registries and directories worldwide.
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#B30303] dark:text-[#FF9492]">
                Open Discovery <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenImport}
              className="p-4 rounded-xl border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#240202] hover:border-[#B30303] hover:bg-white dark:hover:bg-[#690303] text-left transition-all shadow-[0_1px_2px_rgba(36,2,2,0.04)]"
            >
              <div className="text-base font-bold text-[#240202] dark:text-[#FAF4F4]">Import Records</div>
              <p className="text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2] mt-1">
                Upload CSV or Excel files with deduplication preview.
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#B30303] dark:text-[#FF9492]">
                Open Import <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('tasks')}
              className="p-4 rounded-xl border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#240202] hover:border-[#B30303] hover:bg-white dark:hover:bg-[#690303] text-left transition-all shadow-[0_1px_2px_rgba(36,2,2,0.04)]"
            >
              <div className="text-base font-bold text-[#240202] dark:text-[#FAF4F4]">Schedule Follow-Ups</div>
              <p className="text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2] mt-1">
                Manage tasks, meetings, and opportunities.
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#B30303] dark:text-[#FF9492]">
                Open Tasks <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>
          </div>
        </SurfaceCard>
      ) : (
        <>
          {/* Pipeline Stage Overview */}
          <SurfaceCard>
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg font-bold text-[#440303] dark:text-[#FAF4F4]">
                Pipeline by Stage
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab('pipeline')}
                className="inline-flex items-center gap-1 text-xs font-bold text-[#B30303] hover:text-[#CE0404] dark:text-[#FF9492] hover:underline"
              >
                Open Pipeline <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {stageRows.map((row) => (
                <div
                  key={row.stageId}
                  className="p-3 rounded-lg border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#240202] hover:border-[#B30303]/45 transition-colors"
                >
                  <div className="text-xs font-semibold text-[#4E3737] dark:text-[#E6D2D2] truncate">
                    {row.stageName}
                  </div>
                  <div className="mt-1 text-xl font-extrabold font-mono tabular-nums text-[#240202] dark:text-[#FAF4F4]">
                    {formatNumberLocale(row.count)}
                  </div>
                  <span
                    className="text-xs font-semibold text-[#910303] dark:text-[#FF9492] font-mono tabular-nums block truncate"
                    title={row.currencySummary}
                  >
                    {row.currencySummary}
                  </span>
                </div>
              ))}
            </div>
          </SurfaceCard>

          {/* Operational Focus Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Follow-Ups */}
            <SurfaceCard padding="none" className="overflow-hidden flex flex-col">
              <div className="px-5 py-3.5 bg-[#FAF7F7] dark:bg-[#3A0202] border-b border-[#E4DADA] dark:border-[#7A1E1E] flex items-center justify-between">
                <h3 className="text-base font-bold text-[#440303] dark:text-[#FAF4F4]">
                  Follow-Ups
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('tasks')}
                  className="text-xs font-bold text-[#B30303] hover:text-[#CE0404] dark:text-[#FF9492] hover:underline"
                >
                  All Tasks
                </button>
              </div>
              <div className="divide-y divide-[#ECE3E3] dark:divide-[#7A1E1E] flex-1">
                {combinedFollowUps.length === 0 ? (
                  <div className="p-6 text-center text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2]">
                    No overdue or due-today tasks.
                  </div>
                ) : (
                  combinedFollowUps.slice(0, 6).map((task) => {
                    const isOverdue = (crmSummary?.overdueFollowUpTasks || []).some(
                      (t) => t.id === task.id
                    );
                    return (
                      <div
                        key={task.id}
                        className="px-5 py-3 hover:bg-[#FAF6F6] dark:hover:bg-[#690303] transition-colors"
                      >
                        <div className="text-sm font-semibold text-[#240202] dark:text-[#FAF4F4] truncate">
                          {task.title}
                        </div>
                        <div className="text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2] mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span
                            className={
                              isOverdue
                                ? 'text-[#CE0404] dark:text-[#FF8A87] font-bold'
                                : 'text-[#B45309] dark:text-[#FCD34D] font-bold'
                            }
                          >
                            {isOverdue ? 'Overdue' : 'Today'}
                          </span>
                          <span>·</span>
                          <span className="tabular-nums">
                            {new Date(task.dueDate).toLocaleDateString()}
                          </span>
                          {task.companyName && (
                            <>
                              <span>·</span>
                              <button
                                type="button"
                                onClick={() => handleOpenLeadById(task.leadId)}
                                className="text-[#910303] dark:text-[#FF9492] font-semibold hover:underline truncate"
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
            </SurfaceCard>

            {/* Recent Activity */}
            <SurfaceCard padding="none" className="overflow-hidden flex flex-col">
              <div className="px-5 py-3.5 bg-[#FAF7F7] dark:bg-[#3A0202] border-b border-[#E4DADA] dark:border-[#7A1E1E] flex items-center justify-between">
                <h3 className="text-base font-bold text-[#240202] dark:text-[#FAF4F4]">
                  Recent Activity
                </h3>
                <span className="text-xs font-semibold text-[#543F3F] dark:text-[#E6D2D2] tabular-nums">
                  {upcomingMeetings7d} upcoming
                </span>
              </div>
              <div className="divide-y divide-[#ECE3E3] dark:divide-[#7A1E1E] flex-1">
                {(crmSummary?.recentInteractions?.length || 0) === 0 ? (
                  <div className="p-6 text-center text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2]">
                    No interactions logged yet.
                  </div>
                ) : (
                  (crmSummary?.recentInteractions || []).slice(0, 6).map((item) => (
                    <div
                      key={item.id}
                      className="px-5 py-3 hover:bg-[#FAF6F6] dark:hover:bg-[#690303] transition-colors"
                    >
                      <div className="text-sm font-semibold text-[#240202] dark:text-[#FAF4F4] truncate">
                        {item.summary}
                      </div>
                      <div className="text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2] mt-0.5 truncate">
                        <span className="text-[#910303] dark:text-[#FF9492] font-semibold">
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
            </SurfaceCard>

            {/* Needs Attention */}
            <SurfaceCard padding="none" className="overflow-hidden flex flex-col">
              <div className="px-5 py-3.5 bg-[#FAF7F7] dark:bg-[#3A0202] border-b border-[#E4DADA] dark:border-[#7A1E1E] flex items-center justify-between">
                <h3 className="text-base font-bold text-[#240202] dark:text-[#FAF4F4]">
                  Needs Attention
                </h3>
                <span className="text-xs font-semibold text-[#B45309] dark:text-[#FCD34D] tabular-nums">
                  {crmSummary?.relationshipsNeedingAttention?.length || 0} flagged
                </span>
              </div>
              <div className="divide-y divide-[#ECE3E3] dark:divide-[#7A1E1E] flex-1">
                {(crmSummary?.relationshipsNeedingAttention?.length || 0) === 0 ? (
                  <div className="p-6 text-center text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2]">
                    All tracked relationships are on schedule.
                  </div>
                ) : (
                  (crmSummary?.relationshipsNeedingAttention || []).slice(0, 6).map((item) => (
                    <button
                      key={`${item.entityType}-${item.id}`}
                      type="button"
                      onClick={() =>
                        item.entityType === 'company'
                          ? handleOpenLeadById(item.id)
                          : onOpenPersonProfile?.(item.id)
                      }
                      className="w-full text-left px-5 py-3 hover:bg-[#FAF6F6] dark:hover:bg-[#690303] flex items-center justify-between gap-2 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#240202] dark:text-[#FAF4F4] truncate">
                          {item.name}
                        </div>
                        <div className="text-xs font-semibold text-[#B45309] dark:text-[#FCD34D] truncate mt-0.5">
                          {item.reason}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#6B5555] dark:text-[#E6D2D2] shrink-0" />
                    </button>
                  ))
                )}
              </div>
            </SurfaceCard>
          </div>

          {/* Bottom Row: Companies & Contacts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SurfaceCard padding="none" className="overflow-hidden">
              <div className="px-5 py-3.5 bg-[#FAF7F7] dark:bg-[#3A0202] border-b border-[#E4DADA] dark:border-[#7A1E1E] flex items-center justify-between">
                <h3 className="text-base font-bold text-[#440303] dark:text-[#FAF4F4]">
                  Recent Companies
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('leads')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#B30303] hover:text-[#CE0404] dark:text-[#FF9492] hover:underline"
                >
                  View All <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="divide-y divide-[#ECE3E3] dark:divide-[#7A1E1E]">
                {(crmSummary?.recentlyUpdatedCompanies || []).slice(0, 5).map((co) => {
                  const fullLead = leads.find((l) => l.id === co.id);
                  return (
                    <button
                      key={co.id}
                      type="button"
                      onClick={() => fullLead && onSelectLead(fullLead)}
                      className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-[#FAF6F6] dark:hover:bg-[#690303] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#240202] dark:text-[#FAF4F4] truncate">
                          {co.companyName}
                        </div>
                        <div className="text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2] truncate mt-0.5">
                          {[co.industry, co.country, getRelationshipStatusLabel(co.relationshipStatus)]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {fullLead && (fullLead.opportunityValue || 0) > 0 && (
                          <span className="text-xs font-mono tabular-nums font-bold text-[#910303] dark:text-[#FF9492]">
                            {formatCurrencyLocale(
                              fullLead.opportunityValue || 0,
                              fullLead.currency || 'USD',
                              getLocaleForCountry(fullLead.address?.countryCode, fullLead.currency)
                            )}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-[#6B5555] dark:text-[#E6D2D2]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </SurfaceCard>

            <SurfaceCard padding="none" className="overflow-hidden">
              <div className="px-5 py-3.5 bg-[#FAF7F7] dark:bg-[#3A0202] border-b border-[#E4DADA] dark:border-[#7A1E1E] flex items-center justify-between">
                <h3 className="text-base font-bold text-[#240202] dark:text-[#FAF4F4]">
                  Recent Contacts
                </h3>
                <button
                  type="button"
                  onClick={() => onNavigateTab('import')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#B30303] hover:text-[#CE0404] dark:text-[#FF9492] hover:underline"
                >
                  Directory <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="divide-y divide-[#ECE3E3] dark:divide-[#7A1E1E]">
                {(crmSummary?.recentlyContactedPeople?.length || 0) === 0 ? (
                  <div className="p-6 text-center text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2]">
                    No contact interactions recorded yet.
                  </div>
                ) : (
                  (crmSummary?.recentlyContactedPeople || []).slice(0, 5).map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => onOpenPersonProfile?.(person.id)}
                      className="w-full text-left px-5 py-3 flex items-center justify-between hover:bg-[#FAF6F6] dark:hover:bg-[#690303] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#240202] dark:text-[#FAF4F4] truncate">
                          {person.fullName}
                        </div>
                        <div className="text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2] truncate mt-0.5">
                          {[person.jobTitle, person.companyName].filter(Boolean).join(' · ') ||
                            'Contact'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-semibold font-mono tabular-nums text-[#240202] dark:text-[#FAF4F4]">
                          {new Date(person.lastContactDate).toLocaleDateString()}
                        </div>
                        {person.lastInteractionType && (
                          <div className="text-xs font-medium text-[#543F3F] dark:text-[#E6D2D2]">
                            {getInteractionTypeLabel(person.lastInteractionType)}
                          </div>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </SurfaceCard>
          </div>
        </>
      )}
    </div>
  );
}
