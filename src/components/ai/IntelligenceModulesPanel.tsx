import React, { useState, useEffect } from 'react';
import {
  CalendarClock,
  TrendingUp,
  Building2,
  Users,
  Mail,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  FileText,
  HelpCircle,
  Lock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type {
  AiCommunicationDraft,
  AiDraftTone,
  AiDraftType,
  CanonicalLead,
  CompanySalesIntelligenceReport,
  DailySalesBriefing,
  IcpProfile,
  LeadPriorityAssessment,
  MeetingPreparationReport,
  PersonRecord,
} from '../../types.ts';
import { AI_DRAFT_TONES, AI_DRAFT_TYPES } from '../../../shared/aiAgentSpecs.ts';
import { apiFetch } from '../../utils/apiFetch.ts';

interface IntelligenceModulesPanelProps {
  mode: 'briefing' | 'prioritization' | 'company_intel' | 'meeting_prep' | 'drafting';
  leads: CanonicalLead[];
  persons: PersonRecord[];
  icpProfiles: IcpProfile[];
  selectedLeadId: string;
  selectedPersonId: string;
  selectedOpportunityId?: string;
  initialDraftType?: AiDraftType;
  includePrivateNotes: boolean;
  onSelectLeadId: (id: string) => void;
  onSelectPersonId: (id: string) => void;
  onOpenCompany?: (leadId: string) => void;
  onActionsUpdated?: () => Promise<void>;
  onJumpToMode?: (
    nextMode: 'company_intel' | 'meeting_prep' | 'drafting',
    opts?: { leadId?: string; personId?: string }
  ) => void;
}

export const IntelligenceModulesPanel: React.FC<IntelligenceModulesPanelProps> = ({
  mode,
  leads,
  persons,
  icpProfiles,
  selectedLeadId,
  selectedPersonId,
  selectedOpportunityId,
  initialDraftType,
  includePrivateNotes,
  onSelectLeadId,
  onSelectPersonId,
  onOpenCompany,
  onActionsUpdated,
  onJumpToMode,
}) => {
  const [selectedIcpId, setSelectedIcpId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Module outputs
  const [briefing, setBriefing] = useState<DailySalesBriefing | null>(null);
  const [prioritized, setPrioritized] = useState<LeadPriorityAssessment[]>([]);
  const [expandedPrioId, setExpandedPrioId] = useState<string | null>(null);
  const [companyReport, setCompanyReport] = useState<CompanySalesIntelligenceReport | null>(null);
  const [meetingReport, setMeetingReport] = useState<MeetingPreparationReport | null>(null);
  const [meetingGoal, setMeetingGoal] = useState('');

  // Drafting state
  const [draftType, setDraftType] = useState<AiDraftType>(initialDraftType || 'intro_email');
  const [tone, setTone] = useState<AiDraftTone>('consultative');
  const [customInstructions, setCustomInstructions] = useState('');
  const [activeDraft, setActiveDraft] = useState<AiCommunicationDraft | null>(null);
  const [savedDrafts, setSavedDrafts] = useState<AiCommunicationDraft[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (initialDraftType) setDraftType(initialDraftType);
  }, [initialDraftType]);

  // Auto-load prioritization or saved drafts when opening those tabs
  useEffect(() => {
    if (mode === 'prioritization' && prioritized.length === 0 && leads.length > 0) {
      runPrioritization();
    }
    if (mode === 'drafting') {
      loadSavedDrafts();
    }
  }, [mode]);

  const loadSavedDrafts = async () => {
    try {
      const res = await apiFetch('/api/ai/drafts');
      if (res.ok) {
        const data = await res.json();
        setSavedDrafts(data.drafts || []);
      }
    } catch {
      // non-blocking
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const runDailyBriefing = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/daily-briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icpId: selectedIcpId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate daily briefing.');
      setBriefing(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runPrioritization = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/prioritize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icpId: selectedIcpId || undefined, limit: 50 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to prioritize leads.');
      setPrioritized(data.prioritizedLeads || []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runCompanyIntel = async () => {
    const targetId = selectedLeadId || leads[0]?.id;
    if (!targetId) {
      setErrorMsg('Select a company first.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/company-intelligence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: targetId,
          icpId: selectedIcpId || undefined,
          includePrivateNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate company intelligence.');
      setCompanyReport(data);
      await onActionsUpdated?.();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runMeetingPrep = async () => {
    if (!selectedLeadId && !selectedPersonId && !selectedOpportunityId) {
      setErrorMsg('Select a company or decision-maker for meeting preparation.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/meeting-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLeadId || undefined,
          personId: selectedPersonId || undefined,
          opportunityId: selectedOpportunityId || undefined,
          meetingGoal: meetingGoal.trim() || undefined,
          includePrivateNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate meeting prep.');
      setMeetingReport(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const runDraftMessage = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/ai/draft-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: selectedLeadId || undefined,
          personId: selectedPersonId || undefined,
          opportunityId: selectedOpportunityId || undefined,
          draftType,
          tone,
          customInstructions: customInstructions.trim() || undefined,
          includePrivateNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to draft message.');
      setActiveDraft(data);
      await loadSavedDrafts();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ==================== DAILY SALES BRIEFING ==================== */}
      {mode === 'briefing' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-blue-600" />
                On-Demand Daily Sales Briefing
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Computed live on demand from your LEED tasks, reminders, opportunities, data quality, and lead priorities. No background scheduled delivery daemon is active.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {icpProfiles.length > 0 && (
                <select
                  value={selectedIcpId}
                  onChange={(e) => setSelectedIcpId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="">Default ICP</option>
                  {icpProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={runDailyBriefing}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                {busy ? 'Generating...' : 'Generate Today’s Briefing'}
              </button>
            </div>
          </div>

          {!briefing ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-900 dark:text-white">Ready to assemble your live daily briefing</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Click "Generate Today’s Briefing" to inspect overdue follow-ups, priority companies, at-risk opportunities, and accounts missing key research.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Honest Mode & KPI Strip */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <span>
                    Briefing Date: <strong className="text-slate-900 dark:text-white tabular-nums">{briefing.briefingDate}</strong>
                    {' · '}On-Demand Manual Generation (No Background Scheduler)
                  </span>
                  <span className="font-mono text-[11px]">
                    {briefing.aiStatus.mode === 'ai_assisted'
                      ? `Gemini AI-Assisted (${briefing.aiStatus.model})`
                      : 'Deterministic CRM Intelligence'}
                  </span>
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">{briefing.executiveFocus}</p>
                {briefing.aiStatus.warning && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">{briefing.aiStatus.warning}</p>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 pt-2">
                  {[
                    ['Companies', briefing.summaryMetrics.totalCompanies],
                    ['Overdue Tasks', briefing.summaryMetrics.overdueTasksCount],
                    ['Due Today', briefing.summaryMetrics.todayFollowUpsCount],
                    ['Meetings', briefing.summaryMetrics.upcomingMeetingsCount],
                    ['Open Deals', briefing.summaryMetrics.openOpportunitiesCount],
                    ['Needs Research', briefing.summaryMetrics.companiesNeedingResearchCount],
                  ].map(([label, val]) => (
                    <div key={String(label)} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500">{label}</div>
                      <div className="text-lg font-semibold text-slate-900 dark:text-white tabular-nums mt-0.5">
                        {val}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Priority Companies */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Priority Companies to Contact
                  </h4>
                  {briefing.priorityCompaniesToContact.length === 0 ? (
                    <p className="text-xs text-slate-500">No companies in CRM yet.</p>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {briefing.priorityCompaniesToContact.map((c) => (
                        <div key={c.leadId} className="py-2.5 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <button
                              onClick={() => onOpenCompany?.(c.leadId)}
                              className="font-semibold text-slate-900 dark:text-white hover:text-blue-600 text-left"
                            >
                              {c.companyName}
                            </button>
                            <span className="tabular-nums font-semibold text-blue-600 dark:text-blue-400">
                              {c.priorityScore}/100 · {c.priorityTier}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">{c.recommendedAction}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recommended Actions & Overdue Follow-Ups */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      Recommended Actions Today
                    </h4>
                    <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                      {briefing.recommendedActions.map((act, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-blue-600 font-semibold tabular-nums">{idx + 1}.</span>
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {briefing.overdueAndDueFollowUps.length > 0 && (
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-2">
                        Due / Overdue Follow-Ups ({briefing.overdueAndDueFollowUps.length})
                      </h4>
                      <div className="space-y-1.5">
                        {briefing.overdueAndDueFollowUps.map((f) => (
                          <div key={f.id} className="text-xs flex items-center justify-between gap-2">
                            <span className="text-slate-800 dark:text-slate-200 truncate">
                              {f.title} · <span className="text-slate-500">{f.entityName}</span>
                            </span>
                            {f.dueDate && (
                              <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                                {f.dueDate.slice(0, 10)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Opportunities Requiring Attention */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Opportunities Requiring Attention
                  </h4>
                  {briefing.opportunitiesRequiringAttention.length === 0 ? (
                    <p className="text-xs text-slate-500">No overdue or stalled open opportunities detected.</p>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {briefing.opportunitiesRequiringAttention.map((o) => (
                        <div key={o.opportunityId} className="py-2.5 space-y-0.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {o.title} · {o.companyName}
                            </span>
                            <span className="tabular-nums text-slate-700 dark:text-slate-300">
                              {o.currency} {o.estimatedValue.toLocaleString()}
                            </span>
                          </div>
                          <p className="text-[11px] text-amber-700 dark:text-amber-400">{o.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Companies Needing Research */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Companies Needing Research or Enrichment
                  </h4>
                  {briefing.companiesNeedingResearchOrEnrichment.length === 0 ? (
                    <p className="text-xs text-slate-500">All tracked companies meet baseline research completeness.</p>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {briefing.companiesNeedingResearchOrEnrichment.map((c) => (
                        <div key={c.leadId} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <button
                              onClick={() => onOpenCompany?.(c.leadId)}
                              className="font-semibold text-slate-900 dark:text-white hover:text-blue-600"
                            >
                              {c.companyName}
                            </button>
                            <p className="text-[11px] text-slate-500 truncate">
                              Missing: {c.missingKeyFields.join(', ')}
                            </p>
                          </div>
                          <span className="tabular-nums text-xs text-amber-600 shrink-0">
                            DQ {c.dataQualityScore} ({c.dataQualityGrade})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== LEAD PRIORITIZATION ==================== */}
      {mode === 'prioritization' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                Explainable Lead Prioritization ({prioritized.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Deterministic multi-factor ranking combining ICP alignment, data quality, senior decision-makers, pipeline value, engagement, and follow-up urgency.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {icpProfiles.length > 0 && (
                <select
                  value={selectedIcpId}
                  onChange={(e) => setSelectedIcpId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="">Default ICP</option>
                  {icpProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={runPrioritization}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
                Recalculate Priority
              </button>
            </div>
          </div>

          {prioritized.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              No CRM companies available to rank yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase tracking-wider text-slate-700 dark:text-[#D5E0DE]">
                    <th className="py-2 pr-3 font-bold">Company</th>
                    <th className="py-2 px-3 font-bold text-right">Priority</th>
                    <th className="py-2 px-3 font-bold text-right">ICP</th>
                    <th className="py-2 px-3 font-bold text-right">DQ</th>
                    <th className="py-2 px-3 font-bold text-right">Contacts</th>
                    <th className="py-2 px-3 font-bold">Recommended Next Action</th>
                    <th className="py-2 pl-3 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {prioritized.map((item) => {
                    const expanded = expandedPrioId === item.leadId;
                    return (
                      <React.Fragment key={item.leadId}>
                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 pr-3">
                            <button
                              onClick={() => setExpandedPrioId(expanded ? null : item.leadId)}
                              className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white hover:text-blue-600 text-left"
                            >
                              {expanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                              <span>{item.companyName}</span>
                            </button>
                            <div className="text-[11px] text-slate-500 pl-5">
                              {item.industry} {item.country ? `· ${item.country}` : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">
                            <span
                              className={
                                item.priorityTier === 'critical'
                                  ? 'font-semibold text-red-600 dark:text-red-400'
                                  : item.priorityTier === 'high'
                                    ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                                    : item.priorityTier === 'medium'
                                      ? 'font-semibold text-amber-600 dark:text-amber-400'
                                      : 'text-slate-500'
                              }
                            >
                              {item.priorityScore}/100
                            </span>
                            <div className="text-[10px] text-slate-500">{item.priorityTier} · {item.urgency.replace('_', ' ')}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {item.icpScore !== undefined ? `${item.icpScore}` : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {item.dataQualityScore ?? '—'} {item.dataQualityGrade ? `(${item.dataQualityGrade})` : ''}
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {item.decisionMakerCount} ({item.seniorDecisionMakerCount} sr)
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                            {item.recommendedNextAction}
                          </td>
                          <td className="py-2.5 pl-3 text-right whitespace-nowrap space-x-2">
                            <button
                              onClick={() => onJumpToMode?.('company_intel', { leadId: item.leadId })}
                              className="text-blue-600 hover:underline font-medium"
                            >
                              Intel
                            </button>
                            <button
                              onClick={() => onJumpToMode?.('drafting', { leadId: item.leadId })}
                              className="text-slate-600 dark:text-slate-300 hover:underline"
                            >
                              Draft
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-slate-50/70 dark:bg-slate-950/60">
                            <td colSpan={7} className="px-4 py-3 space-y-2">
                              <div className="text-xs text-slate-700 dark:text-slate-300">{item.explanation}</div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {item.factors.map((f) => (
                                  <div
                                    key={f.factor}
                                    className="p-2 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                                  >
                                    <div className="flex items-center justify-between text-[11px] font-medium">
                                      <span className="text-slate-800 dark:text-slate-200">{f.factor}</span>
                                      <span className="tabular-nums text-blue-600">
                                        {f.points}/{f.maxPoints}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">{f.detail}</div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================== COMPANY SALES INTELLIGENCE ==================== */}
      {mode === 'company_intel' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
              <select
                value={selectedLeadId}
                onChange={(e) => onSelectLeadId(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 min-w-[220px]"
              >
                <option value="">Select company...</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.companyName} ({l.address?.countryCode || l.industry})
                  </option>
                ))}
              </select>
              {icpProfiles.length > 0 && (
                <select
                  value={selectedIcpId}
                  onChange={(e) => setSelectedIcpId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="">Default ICP</option>
                  {icpProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <button
              onClick={runCompanyIntel}
              disabled={busy || (!selectedLeadId && leads.length === 0)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              {busy ? 'Generating Report...' : 'Generate Intelligence Report'}
            </button>
          </div>

          {!companyReport ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-900 dark:text-white">Evidence-Grounded Company Sales Intelligence</p>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                Separates Verified Facts, Source-Reported Information, AI Analysis, Hypotheses, and Unknown Information—and queues actionable CRM proposals for your explicit approval.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Executive Overview */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <h4 className="text-base font-semibold text-slate-900 dark:text-white">
                      {companyReport.companyName}
                    </h4>
                    <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                      Priority {companyReport.priorityAssessment.priorityScore}/100 ({companyReport.priorityAssessment.priorityTier})
                      {companyReport.icpFit ? ` · ICP Fit ${companyReport.icpFit.overallScore}/100 (${companyReport.icpFit.fitLabel.replace('_', ' ')})` : ''}
                      {' · '}
                      {companyReport.aiStatus.mode === 'ai_assisted'
                        ? `Gemini (${companyReport.aiStatus.model})`
                        : 'Deterministic Fallback'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onJumpToMode?.('meeting_prep', { leadId: companyReport.leadId })}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      Prep Meeting
                    </button>
                    <button
                      onClick={() => onJumpToMode?.('drafting', { leadId: companyReport.leadId })}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700"
                    >
                      Draft Outreach
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{companyReport.executiveSummary}</p>
                <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Lock className="w-3 h-3" />
                  <span>{companyReport.contextAudit.privateNotesNotice}</span>
                </div>
              </div>

              {/* Strict 5-Way Fact / Inference / Unknown Separation */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                  <div>
                    <h5 className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">
                      Verified Facts ({companyReport.verifiedFacts.length})
                    </h5>
                    {companyReport.verifiedFacts.length === 0 ? (
                      <p className="text-xs text-slate-500">No formally verified facts recorded yet.</p>
                    ) : (
                      <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                        {companyReport.verifiedFacts.map((f, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                            <span>{f.statement}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                    <h5 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">
                      Source-Reported Information ({companyReport.sourceReportedFacts.length})
                    </h5>
                    <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                      {companyReport.sourceReportedFacts.map((f, i) => (
                        <li key={i}>• {f.statement}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                    <h5 className="text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-400 mb-2 flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5" />
                      Unknown / Missing Information ({companyReport.unknownInformation.length})
                    </h5>
                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                      {companyReport.unknownInformation.map((u, i) => (
                        <li key={i}>• {u}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                  <div>
                    <h5 className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-2">
                      AI Analysis (Derived from Evidence)
                    </h5>
                    <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                      {companyReport.aiAnalysis.map((a, i) => (
                        <li key={i}>• {a.statement}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                    <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
                      Hypotheses to Validate in Discovery
                    </h5>
                    <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300">
                      {companyReport.hypotheses.map((h, i) => (
                        <li key={i}>• {h.statement}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                    <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2">
                      Recommended Strategy & Next Steps
                    </h5>
                    <p className="text-xs text-slate-800 dark:text-slate-200 mb-2">
                      {companyReport.recommendedOutreachStrategy}
                    </p>
                    <ol className="space-y-1 text-xs text-slate-600 dark:text-slate-400 list-decimal list-inside">
                      {companyReport.recommendedNextSteps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>

              {companyReport.proposedActions.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-xs text-slate-700 dark:text-slate-300 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                    Queued {companyReport.proposedActions.length} proposed CRM action(s) in the Approval Queue (no records were modified automatically).
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== MEETING PREPARATION ==================== */}
      {mode === 'meeting_prep' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Company</label>
                <select
                  value={selectedLeadId}
                  onChange={(e) => onSelectLeadId(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="">None / Select company...</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.companyName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Decision-Maker (Optional)</label>
                <select
                  value={selectedPersonId}
                  onChange={(e) => onSelectPersonId(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="">Any / Primary contact</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} {p.seniority || p.decisionMakingFunction ? `(${p.seniority || p.decisionMakingFunction})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Meeting Goal</label>
                <input
                  type="text"
                  value={meetingGoal}
                  onChange={(e) => setMeetingGoal(e.target.value)}
                  placeholder="e.g., Technical discovery & scope alignment"
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={runMeetingPrep}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                <Users className="w-3.5 h-3.5" />
                {busy ? 'Preparing Brief...' : 'Generate Meeting Preparation Brief'}
              </button>
            </div>
          </div>

          {meetingReport && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
              <div className="pb-3 border-b border-slate-200 dark:border-slate-800 space-y-1">
                <h4 className="text-base font-semibold text-slate-900 dark:text-white">{meetingReport.meetingTitle}</h4>
                <p className="text-xs text-slate-600 dark:text-slate-300">{meetingReport.companySummary}</p>
                {meetingReport.personSummary && (
                  <p className="text-xs text-slate-600 dark:text-slate-300">{meetingReport.personSummary}</p>
                )}
                <p className="text-[11px] text-amber-700 dark:text-amber-400">{meetingReport.honestGroundingNote}</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
                <div className="space-y-4">
                  <div>
                    <h5 className="font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                      Verified Relationship History ({meetingReport.previousInteractions.length})
                    </h5>
                    <p className="text-slate-700 dark:text-slate-300 mb-2">{meetingReport.relationshipHistorySummary}</p>
                    {meetingReport.previousInteractions.map((i) => (
                      <div key={i.id} className="py-1.5 border-t border-slate-100 dark:border-slate-800">
                        <span className="tabular-nums text-slate-500">{i.occurredAt.slice(0, 10)}</span> ·{' '}
                        <span className="font-medium text-slate-800 dark:text-slate-200">{i.summary}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h5 className="font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Suggested Objectives</h5>
                    <ul className="space-y-1 text-slate-700 dark:text-slate-300">
                      {meetingReport.suggestedObjectives.map((o, idx) => (
                        <li key={idx}>• {o}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h5 className="font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Strategic Questions</h5>
                    <ul className="space-y-1 text-slate-700 dark:text-slate-300">
                      {meetingReport.strategicQuestions.map((q, idx) => (
                        <li key={idx}>• {q}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h5 className="font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                      Likely Objections (Hypotheses)
                    </h5>
                    <div className="space-y-2.5">
                      {meetingReport.likelyObjections.map((obj, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                          <div className="font-medium text-slate-900 dark:text-white">{obj.objection}</div>
                          <div className="text-slate-600 dark:text-slate-400 mt-1">{obj.suggestedResponse}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h5 className="font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Unknowns to Confirm</h5>
                    <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                      {meetingReport.unknownsToVerify.map((u, idx) => (
                        <li key={idx}>• {u}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h5 className="font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Recommended Outcome</h5>
                    <p className="text-slate-800 dark:text-slate-200">{meetingReport.recommendedOutcome}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== COMMUNICATION DRAFTING (DRAFT ONLY) ==================== */}
      {mode === 'drafting' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-600" />
              Sales Message Drafting (Draft Only)
            </h3>
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              All outputs are strictly draft_only for owner review. LEED does not automatically send emails or messages.
            </p>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Company</label>
              <select
                value={selectedLeadId}
                onChange={(e) => onSelectLeadId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              >
                <option value="">Select company...</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.companyName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Recipient Person (Optional)</label>
              <select
                value={selectedPersonId}
                onChange={(e) => onSelectPersonId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              >
                <option value="">Auto-pick primary decision-maker</option>
                {persons.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} {p.seniority || p.decisionMakingFunction ? `(${p.seniority || p.decisionMakingFunction})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Message Type</label>
                <select
                  value={draftType}
                  onChange={(e) => setDraftType(e.target.value as AiDraftType)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  {AI_DRAFT_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Tone</label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as AiDraftTone)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                >
                  {AI_DRAFT_TONES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">Custom Instructions (Optional)</label>
              <textarea
                rows={3}
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="e.g., Mention we can start with a 2-week pilot and keep it under 100 words"
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
              />
            </div>
            <button
              onClick={runDraftMessage}
              disabled={busy}
              className="w-full py-2 rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Drafting...' : 'Generate Draft (Not Sent)'}
            </button>
          </div>

          <div className="lg:col-span-7 space-y-4">
            {activeDraft ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      {activeDraft.companyName || 'Draft Message'} {activeDraft.recipientName ? `· ${activeDraft.recipientName}` : ''}
                    </div>
                    <div className="text-[11px] text-amber-700 dark:text-amber-400">
                      DRAFT ONLY · autoSent: false · {activeDraft.channel} · {activeDraft.tone}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      handleCopy(
                        `${activeDraft.subject ? `Subject: ${activeDraft.subject}\n\n` : ''}${activeDraft.body}`,
                        'draft-full'
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {copiedField === 'draft-full' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedField === 'draft-full' ? 'Copied' : 'Copy Draft'}
                  </button>
                </div>

                {activeDraft.subject && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">Subject</div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white mt-0.5">{activeDraft.subject}</div>
                  </div>
                )}
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800 leading-relaxed">
                  {activeDraft.body}
                </pre>

                <div className="space-y-2 text-[11px]">
                  <div className="font-semibold text-slate-700 dark:text-slate-300">Personalization Evidence Used:</div>
                  <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                    {activeDraft.personalizationBasis.map((p, idx) => (
                      <li key={idx}>• [{p.classification}] {p.statement}</li>
                    ))}
                  </ul>
                  {activeDraft.caveatsAndPlaceholders.length > 0 && (
                    <div className="pt-2 text-amber-700 dark:text-amber-400">
                      <span className="font-semibold">Review Before Sending:</span>{' '}
                      {activeDraft.caveatsAndPlaceholders.join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center text-xs text-slate-500">
                Select a company, message type, and tone to draft evidence-grounded sales outreach.
              </div>
            )}

            {savedDrafts.length > 0 && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Recent Saved Drafts ({savedDrafts.length})
                </h4>
                <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-48 overflow-y-auto">
                  {savedDrafts.slice(0, 8).map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setActiveDraft(d)}
                      className="w-full py-2 text-left flex items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40 px-1 rounded"
                    >
                      <span className="truncate text-slate-800 dark:text-slate-200">
                        {d.subject || d.draftType} · <span className="text-slate-500">{d.companyName || 'General'}</span>
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                        {d.createdAt.slice(0, 10)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
