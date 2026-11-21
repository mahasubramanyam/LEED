import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bot,
  Send,
  Plus,
  Trash2,
  ShieldCheck,
  Lock,
  Unlock,
  Wrench,
  FileSearch,
  CalendarClock,
  TrendingUp,
  Building2,
  Users,
  Mail,
  Target,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react';
import type {
  AiActionProposal,
  AiAgentConversation,
  AiAgentLaunchContext,
  AiContextScope,
  AiProviderStatus,
  CanonicalLead,
  IcpProfile,
  PersonRecord,
} from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';
import { IcpAndGoalsPanel } from './ai/IcpAndGoalsPanel.tsx';
import { ActionProposalsPanel } from './ai/ActionProposalsPanel.tsx';
import { IntelligenceModulesPanel } from './ai/IntelligenceModulesPanel.tsx';
import { FeatureBanner, SegmentedTabs } from './ui/SunsetUI.tsx';

type AgentTab =
  | 'chat'
  | 'briefing'
  | 'prioritization'
  | 'company_intel'
  | 'meeting_prep'
  | 'drafting'
  | 'icp'
  | 'actions';

interface AiSalesAgentProps {
  leads: CanonicalLead[];
  selectedLeadId?: string;
  launchContext?: AiAgentLaunchContext | null;
  onLeadSelect?: (id: string) => void;
  onAddActivityToLead?: (leadId: string, activity: any) => void;
  onDataMutated?: () => void;
}

const STARTER_PROMPTS = [
  'Which companies in my CRM should I prioritize this week and why?',
  'Summarize overdue follow-ups and open opportunities that need attention.',
  'Analyze the selected company’s strengths, missing facts, and recommended outreach angle.',
  'Suggest a follow-up task for the selected company (for my approval).',
];

export const AiSalesAgent: React.FC<AiSalesAgentProps> = ({
  leads,
  selectedLeadId: initialLeadId,
  launchContext,
  onLeadSelect,
  onDataMutated,
}) => {
  const [activeTab, setActiveTab] = useState<AgentTab>(launchContext?.tab || 'chat');
  const [providerStatus, setProviderStatus] = useState<AiProviderStatus | null>(null);
  const [icpProfiles, setIcpProfiles] = useState<IcpProfile[]>([]);
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [conversations, setConversations] = useState<AiAgentConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [actionProposals, setActionProposals] = useState<AiActionProposal[]>([]);

  // Context Scope Controls
  const [scopeType, setScopeType] = useState<AiContextScope['scopeType']>(
    launchContext?.personId
      ? 'person'
      : launchContext?.leadId || initialLeadId
        ? 'company'
        : 'portfolio'
  );
  const [selectedLeadId, setSelectedLeadId] = useState<string>(
    launchContext?.leadId || initialLeadId || leads[0]?.id || ''
  );
  const [selectedPersonId, setSelectedPersonId] = useState<string>(launchContext?.personId || '');
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | undefined>(
    launchContext?.opportunityId
  );
  const [includePrivateNotes, setIncludePrivateNotes] = useState<boolean>(false);

  // Chat State
  const [chatInput, setChatInput] = useState<string>(launchContext?.prompt || '');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [inlineBusyProposalId, setInlineBusyProposalId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [statusRes, icpRes, convRes, actRes, personsRes] = await Promise.all([
        apiFetch('/api/ai/status'),
        apiFetch('/api/ai/icp'),
        apiFetch('/api/ai/conversations'),
        apiFetch('/api/ai/actions'),
        apiFetch('/api/persons'),
      ]);
      if (statusRes.ok) setProviderStatus(await statusRes.json());
      if (icpRes.ok) {
        const d = await icpRes.json();
        setIcpProfiles(d.icpProfiles || []);
      }
      if (convRes.ok) {
        const d = await convRes.json();
        const list: AiAgentConversation[] = d.conversations || [];
        setConversations(list);
        setActiveConversationId((prev) => prev || list[0]?.id || null);
      }
      if (actRes.ok) {
        const d = await actRes.json();
        setActionProposals(d.actions || []);
      }
      if (personsRes.ok) {
        const d = await personsRes.json();
        setPersons(Array.isArray(d) ? d : d.persons || []);
      }
    } catch {
      // non-blocking
    }
  }, []);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  // React to external contextual launches (from LeadDetailModal, Pipeline, Dashboard, Tasks, Person Drawer)
  useEffect(() => {
    if (!launchContext) return;
    if (launchContext.tab) setActiveTab(launchContext.tab);
    if (launchContext.leadId) {
      setSelectedLeadId(launchContext.leadId);
      setScopeType(launchContext.personId ? 'person' : 'company');
    }
    if (launchContext.personId) {
      setSelectedPersonId(launchContext.personId);
      setScopeType('person');
    }
    if (launchContext.opportunityId) {
      setSelectedOpportunityId(launchContext.opportunityId);
    }
    if (launchContext.prompt) {
      setChatInput(launchContext.prompt);
    }
  }, [launchContext]);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) || null;
  const pendingProposalsCount = actionProposals.filter((a) => a.status === 'pending_approval').length;

  const refreshIcps = async () => {
    const res = await apiFetch('/api/ai/icp');
    if (res.ok) {
      const d = await res.json();
      setIcpProfiles(d.icpProfiles || []);
    }
  };

  const refreshActions = async () => {
    const res = await apiFetch('/api/ai/actions');
    if (res.ok) {
      const d = await res.json();
      setActionProposals(d.actions || []);
    }
  };

  const handleStartNewConversation = async () => {
    setChatError(null);
    const contextScope: AiContextScope = {
      scopeType,
      leadId: scopeType === 'company' || scopeType === 'opportunity' ? selectedLeadId || undefined : undefined,
      personId: scopeType === 'person' ? selectedPersonId || undefined : undefined,
      opportunityId: selectedOpportunityId,
      includePrivateNotes,
    };
    const res = await apiFetch('/api/ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:
          scopeType === 'company' && selectedLeadId
            ? `Strategy: ${leads.find((l) => l.id === selectedLeadId)?.companyName || 'Company'}`
            : scopeType === 'person' && selectedPersonId
              ? `Contact: ${persons.find((p) => p.id === selectedPersonId)?.fullName || 'Person'}`
              : 'Portfolio Sales Strategy',
        contextScope,
      }),
    });
    if (res.ok) {
      const conv: AiAgentConversation = await res.json();
      setConversations((prev) => [conv, ...prev]);
      setActiveConversationId(conv.id);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    const res = await apiFetch(`/api/ai/conversations/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (activeConversationId === id) {
          setActiveConversationId(next[0]?.id || null);
        }
        return next;
      });
    }
  };

  const handleSendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? chatInput).trim();
    if (!text || sending) return;
    setSending(true);
    setChatError(null);

    try {
      const targetConvId = activeConversationId || 'new';
      const contextScope: AiContextScope = {
        scopeType,
        leadId:
          scopeType === 'company' || scopeType === 'opportunity'
            ? selectedLeadId || undefined
            : undefined,
        personId: scopeType === 'person' ? selectedPersonId || undefined : undefined,
        opportunityId: selectedOpportunityId,
        includePrivateNotes,
      };

      const res = await apiFetch(`/api/ai/conversations/${targetConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          contextScope,
          includePrivateNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send message.');

      const updatedConv: AiAgentConversation = data.conversation;
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === updatedConv.id);
        return exists
          ? prev.map((c) => (c.id === updatedConv.id ? updatedConv : c))
          : [updatedConv, ...prev];
      });
      setActiveConversationId(updatedConv.id);
      if (!overrideText) setChatInput('');
      if (Array.isArray(data.proposedActions) && data.proposedActions.length > 0) {
        await refreshActions();
      }
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const handleInlineProposalDecision = async (proposalId: string, decision: 'approve' | 'reject') => {
    setInlineBusyProposalId(proposalId);
    try {
      const res = await apiFetch(`/api/ai/actions/${proposalId}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision === 'reject' ? { reason: 'Rejected from conversation' } : {}),
      });
      if (res.ok) {
        await refreshActions();
        if (decision === 'approve') onDataMutated?.();
      }
    } finally {
      setInlineBusyProposalId(null);
    }
  };

  const tabs: Array<{ id: AgentTab; label: string; icon: React.ComponentType<any>; badge?: number }> = [
    { id: 'chat', label: 'Agent Chat', icon: MessageSquare },
    { id: 'briefing', label: 'Daily Briefing', icon: CalendarClock },
    { id: 'prioritization', label: 'Prioritization', icon: TrendingUp },
    { id: 'company_intel', label: 'Company Intel', icon: Building2 },
    { id: 'meeting_prep', label: 'Meeting Prep', icon: Users },
    { id: 'drafting', label: 'Draft Message', icon: Mail },
    { id: 'icp', label: 'ICP & Goals', icon: Target },
    { id: 'actions', label: 'Approval Queue', icon: ShieldCheck, badge: pendingProposalsCount },
  ];

  return (
    <div className="space-y-5">
      <FeatureBanner
        tone="maroon"
        eyebrow="Personal AI Sales Copilot"
        title="AI Sales Agent & Action Approvals"
        description={
          providerStatus
            ? providerStatus.configured
              ? `Connected to ${providerStatus.model}. Grounded strictly in your live CRM accounts, decision-makers, and deal history.`
              : 'Running in Deterministic Fallback Mode (no GEMINI_API_KEY configured). Safe CRM summaries and proposals remain available.'
            : 'Grounded in your live CRM portfolio with explicit owner approval required for every proposed mutation.'
        }
        highlights={[
          { label: 'Accounts in Scope', value: leads.length },
          { label: 'Pending Approvals', value: pendingProposalsCount },
        ]}
        actions={
          <>
            <button
              type="button"
              onClick={handleStartNewConversation}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white text-[#440303] hover:bg-[#FAF4F4] text-xs font-bold shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Session</span>
            </button>
            <button
              type="button"
              onClick={() => setIncludePrivateNotes((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-semibold whitespace-nowrap transition-colors ${
                includePrivateNotes
                  ? 'border-white bg-white/25 text-white'
                  : 'border-white/25 bg-white/12 text-white hover:bg-white/22'
              }`}
              title="Private owner notes are excluded from AI context by default. Toggle to explicitly authorize inclusion for requests."
            >
              {includePrivateNotes ? <Unlock className="w-3.5 h-3.5 text-amber-300" /> : <Lock className="w-3.5 h-3.5" />}
              <span>{includePrivateNotes ? 'Private Notes: Authorized' : 'Private Notes: Excluded'}</span>
            </button>
          </>
        }
      />

      <SegmentedTabs
        variant="underline"
        activeId={activeTab}
        onChange={(id) => setActiveTab(id)}
        items={tabs.map((tab) => {
          const Icon = tab.icon;
          return {
            id: tab.id,
            label: tab.label,
            icon: <Icon className="w-3.5 h-3.5" />,
            count: tab.badge,
          };
        })}
      />

      {/* ==================== TAB 1: CONVERSATIONAL AI SALES AGENT ==================== */}
      {activeTab === 'chat' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left Rail: Sessions & Context Selector */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white dark:bg-[#440303] border border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl p-4 space-y-3 shadow-[0_1px_3px_rgba(36,2,2,0.05)]">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#440303] dark:text-[#F4E8E8]">
                  Active CRM Context
                </h3>
                <button
                  onClick={handleStartNewConversation}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#B30303] dark:text-[#FF9492] hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Session
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#F8F5F5] dark:bg-[#240202] rounded-lg p-0.5 text-xs">
                {(['portfolio', 'company', 'person'] as const).map((sc) => (
                  <button
                    key={sc}
                    onClick={() => setScopeType(sc)}
                    className={`py-1.5 rounded-md font-semibold capitalize transition-colors ${
                      scopeType === sc
                        ? 'bg-[#910303] text-white shadow-xs'
                        : 'text-[#543F3F] dark:text-[#DEC2C2] hover:text-[#240202] dark:hover:text-white'
                    }`}
                  >
                    {sc}
                  </button>
                ))}
              </div>

              {scopeType === 'company' && (
                <select
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[#D4C2C2] dark:border-[#8C2828] bg-white dark:bg-[#240202] text-[#240202] dark:text-[#FAF4F4]"
                >
                  <option value="">Select company...</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.companyName} ({l.industry})
                    </option>
                  ))}
                </select>
              )}

              {scopeType === 'person' && (
                <select
                  value={selectedPersonId}
                  onChange={(e) => setSelectedPersonId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[#D4C2C2] dark:border-[#8C2828] bg-white dark:bg-[#240202] text-[#240202] dark:text-[#FAF4F4]"
                >
                  <option value="">Select decision-maker...</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName} {p.seniority || p.decisionMakingFunction ? `(${p.seniority || p.decisionMakingFunction})` : ''}
                    </option>
                  ))}
                </select>
              )}

              <p className="text-[11px] font-medium text-[#543F3F] dark:text-[#D1B0B0]">
                {includePrivateNotes
                  ? 'Owner private notes are explicitly authorized for this turn.'
                  : 'Owner private notes are withheld unless toggled on above.'}
              </p>
            </div>

            {/* Persisted Conversations */}
            <div className="bg-white dark:bg-[#440303] border border-[#E4DADA] dark:border-[#7A1E1E] rounded-xl p-4 space-y-2 shadow-[0_1px_3px_rgba(36,2,2,0.05)]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#440303] dark:text-[#F4E8E8]">
                Conversation History ({conversations.length})
              </h3>
              {conversations.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  Start asking questions to create your first saved session.
                </p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[340px] overflow-y-auto">
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      className={`py-2 px-2 rounded-lg flex items-center justify-between gap-2 cursor-pointer ${
                        c.id === activeConversationId
                          ? 'bg-blue-50 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                      onClick={() => {
                        setActiveConversationId(c.id);
                        setScopeType(c.contextScope.scopeType);
                        if (c.contextScope.leadId) setSelectedLeadId(c.contextScope.leadId);
                        if (c.contextScope.personId) setSelectedPersonId(c.contextScope.personId);
                      }}
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                          {c.title}
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {c.contextScope.scopeType} · {c.messages.length} msg(s)
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteConversation(c.id);
                        }}
                        className="p-1 text-slate-400 hover:text-red-600 shrink-0"
                        title="Delete conversation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Conversation Stream & Composer */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col min-h-[540px]">
            <div className="flex-1 p-5 space-y-4 overflow-y-auto max-h-[520px]">
              {!activeConversation || activeConversation.messages.length === 0 ? (
                <div className="py-8 space-y-4">
                  <div className="text-center space-y-1">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Ask your LEED AI Sales Agent
                    </h3>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Grounded directly in your CRM records via controlled read-only tools. Any proposed CRM change waits for your explicit approval.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                    {STARTER_PROMPTS.map((p) => (
                      <button
                        key={p}
                        onClick={() => handleSendMessage(p)}
                        className="p-3 text-left rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-xs text-slate-700 dark:text-slate-300"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                activeConversation.messages.map((msg) => {
                  const linkedProposals = (msg.proposedActionIds || [])
                    .map((pid) => actionProposals.find((a) => a.id === pid))
                    .filter((x): x is AiActionProposal => Boolean(x));

                  return (
                    <div
                      key={msg.id}
                      className={`space-y-2 ${msg.role === 'owner' ? 'pl-8' : 'pr-4'}`}
                    >
                      <div
                        className={`rounded-xl p-3.5 text-xs leading-relaxed whitespace-pre-wrap ${
                          msg.role === 'owner'
                            ? 'bg-[#440303] dark:bg-[#910303] text-white ml-auto max-w-2xl'
                            : 'bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {msg.content}
                      </div>

                      {msg.role === 'assistant' && (
                        <div className="space-y-2 pl-1">
                          {/* Tools Used & Evidence Metadata */}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                            {msg.aiStatus && (
                              <span className="font-mono">
                                {msg.aiStatus.mode === 'ai_assisted'
                                  ? `Gemini (${msg.aiStatus.model})`
                                  : 'Deterministic Fallback'}
                              </span>
                            )}
                            {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <Wrench className="w-3 h-3" />
                                Tools: {msg.toolsUsed.map((t) => t.toolName).join(', ')}
                              </span>
                            )}
                            {msg.evidenceSources && msg.evidenceSources.length > 0 && (
                              <span className="inline-flex items-center gap-1 tabular-nums">
                                <FileSearch className="w-3 h-3" />
                                {msg.evidenceSources.length} evidence source(s)
                              </span>
                            )}
                            {msg.contextAudit && (
                              <span>
                                {msg.contextAudit.privateNotesAuthorized
                                  ? `Private notes authorized (${msg.contextAudit.includedEntities.privateNotesIncluded})`
                                  : `Private notes excluded`}
                              </span>
                            )}
                          </div>

                          {/* Inline Pending Action Proposals */}
                          {linkedProposals.map((prop) => (
                            <div
                              key={prop.id}
                              className="p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                            >
                              <div>
                                <div className="font-semibold text-slate-900 dark:text-white">
                                  Proposed Action: {prop.title}
                                </div>
                                <div className="text-[11px] text-slate-600 dark:text-slate-400">
                                  {prop.actionType} · {prop.affectedEntity.entityName} · Status: {prop.status}
                                </div>
                              </div>
                              {prop.status === 'pending_approval' && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    onClick={() => handleInlineProposalDecision(prop.id, 'approve')}
                                    disabled={inlineBusyProposalId === prop.id}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    Approve
                                  </button>
                                  <button
                                    onClick={() => handleInlineProposalDecision(prop.id, 'reject')}
                                    disabled={inlineBusyProposalId === prop.id}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                                  >
                                    <XCircle className="w-3 h-3" />
                                    Reject
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {chatError && (
              <div className="mx-5 mb-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{chatError}</span>
              </div>
            )}

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-end gap-2">
              <textarea
                rows={2}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Ask about accounts, decision-makers, pipeline risks, outreach angles, or request a CRM action proposal..."
                className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white resize-none"
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={sending || !chatInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#B30303] hover:bg-[#910303] text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                {sending ? 'Thinking...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TABS 2–6: INTELLIGENCE MODULES ==================== */}
      {(activeTab === 'briefing' ||
        activeTab === 'prioritization' ||
        activeTab === 'company_intel' ||
        activeTab === 'meeting_prep' ||
        activeTab === 'drafting') && (
        <IntelligenceModulesPanel
          mode={activeTab}
          leads={leads}
          persons={persons}
          icpProfiles={icpProfiles}
          selectedLeadId={selectedLeadId}
          selectedPersonId={selectedPersonId}
          selectedOpportunityId={selectedOpportunityId}
          initialDraftType={launchContext?.draftType}
          includePrivateNotes={includePrivateNotes}
          onSelectLeadId={setSelectedLeadId}
          onSelectPersonId={setSelectedPersonId}
          onOpenCompany={onLeadSelect}
          onActionsUpdated={refreshActions}
          onJumpToMode={(nextMode, opts) => {
            if (opts?.leadId) setSelectedLeadId(opts.leadId);
            if (opts?.personId) setSelectedPersonId(opts.personId);
            setActiveTab(nextMode);
          }}
        />
      )}

      {/* ==================== TAB 7: ICP & OWNER GOALS ==================== */}
      {activeTab === 'icp' && (
        <IcpAndGoalsPanel
          leads={leads}
          icpProfiles={icpProfiles}
          onRefreshIcps={refreshIcps}
          onOpenCompany={onLeadSelect}
        />
      )}

      {/* ==================== TAB 8: OWNER APPROVAL QUEUE ==================== */}
      {activeTab === 'actions' && (
        <ActionProposalsPanel
          proposals={actionProposals}
          onRefresh={refreshActions}
          onDataMutated={onDataMutated}
          onOpenCompany={onLeadSelect}
        />
      )}
    </div>
  );
};
