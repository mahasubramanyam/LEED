import React, { useCallback, useEffect, useState } from 'react';
import {
  Send,
  Plus,
  Pause,
  Play,
  Archive,
  Users,
  Sparkles,
  CheckCircle2,
  CalendarClock,
  MessageSquareReply,
  BarChart3,
  ShieldCheck,
  ListOrdered,
  RefreshCw,
  AlertTriangle,
  Bot,
  Trash2,
} from 'lucide-react';
import { OUTREACH_CHANNELS } from '../../shared/outreachSpecs.ts';
import type {
  AiDraftTone,
  CanonicalLead,
  IcpProfile,
  OutreachAnalyticsSummary,
  OutreachCampaign,
  OutreachCampaignModeV2,
  OutreachCampaignV2,
  OutreachChannelV2,
  OutreachEnrollment,
  OutreachFollowUpItem,
  OutreachLaunchContext,
  OutreachProviderStatus,
  OutreachSequence,
  OutreachWorkspaceState,
  PersonRecord,
} from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';
import { ApprovalQueuePanel } from './outreach/ApprovalQueuePanel.tsx';
import { FollowUpsAndRepliesPanel } from './outreach/FollowUpsAndRepliesPanel.tsx';
import { SuppressionAndProvidersPanel } from './outreach/SuppressionAndProvidersPanel.tsx';
import { FeatureBanner, KpiMetric, NoticeBanner, SegmentedTabs } from './ui/SunsetUI.tsx';

type OutreachTab =
  | 'campaigns'
  | 'sequences'
  | 'approvals'
  | 'follow_ups'
  | 'replies'
  | 'analytics'
  | 'compliance';

interface OutreachCampaignsProps {
  campaigns: OutreachCampaign[];
  leads: CanonicalLead[];
  launchContext?: OutreachLaunchContext | null;
  onRefreshCampaigns: () => void;
  onSelectLead?: (leadId: string) => void;
  onOpenAiAgent?: (leadId?: string, personId?: string) => void;
}

export const OutreachCampaigns: React.FC<OutreachCampaignsProps> = ({
  leads,
  launchContext,
  onRefreshCampaigns,
  onSelectLead,
  onOpenAiAgent,
}) => {
  const [activeTab, setActiveTab] = useState<OutreachTab>('campaigns');
  const [complianceSubTab, setComplianceSubTab] = useState<'suppression' | 'providers'>('suppression');

  const [workspace, setWorkspace] = useState<OutreachWorkspaceState | null>(null);
  const [providers, setProviders] = useState<OutreachProviderStatus[]>([]);
  const [analytics, setAnalytics] = useState<OutreachAnalyticsSummary | null>(null);
  const [icpProfiles, setIcpProfiles] = useState<IcpProfile[]>([]);
  const [persons, setPersons] = useState<PersonRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Campaign selection & creation
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newObjective, setNewObjective] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newMode, setNewMode] = useState<OutreachCampaignModeV2>('individual');
  const [newChannel, setNewChannel] = useState<OutreachChannelV2>('email');
  const [newIcpId, setNewIcpId] = useState('');
  const [newTone, setNewTone] = useState<AiDraftTone>('warm_professional');
  const [newMaxFollowUps, setNewMaxFollowUps] = useState(3);

  // Enrollment controls
  const [enrollLeadIds, setEnrollLeadIds] = useState<string[]>([]);
  const [enrollPersonId, setEnrollPersonId] = useState<string>('');
  const [customDraftInstructions, setCustomDraftInstructions] = useState('');
  const [includePrivateNotes, setIncludePrivateNotes] = useState(false);

  // Sequence editing state
  const [editingSeq, setEditingSeq] = useState<OutreachSequence | null>(null);

  const loadWorkspace = useCallback(async () => {
    try {
      const [overviewRes, icpRes, personsRes] = await Promise.all([
        apiFetch('/api/outreach/overview'),
        apiFetch('/api/ai/icp'),
        apiFetch('/api/persons'),
      ]);

      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setWorkspace(data.workspace || null);
        setProviders(Array.isArray(data.providers) ? data.providers : []);
        setAnalytics(data.analytics || null);
        if (data.workspace?.campaigns?.length > 0 && !selectedCampaignId) {
          setSelectedCampaignId(data.workspace.campaigns[0].id);
        }
      }
      if (icpRes.ok) {
        const icpData = await icpRes.json();
        setIcpProfiles(Array.isArray(icpData.profiles) ? icpData.profiles : []);
      }
      if (personsRes.ok) {
        const pData = await personsRes.json();
        setPersons(Array.isArray(pData) ? pData : Array.isArray(pData.persons) ? pData.persons : []);
      }
    } catch (err) {
      console.error('Failed to load outreach workspace:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!launchContext) return;
    if (launchContext.tab) {
      setActiveTab(launchContext.tab);
    }
    if (launchContext.leadId) {
      setEnrollLeadIds([launchContext.leadId]);
    }
    if (launchContext.personId) {
      setEnrollPersonId(launchContext.personId);
    }
  }, [launchContext]);

  const campaignsV2: OutreachCampaignV2[] = workspace?.campaigns || [];
  const selectedCampaign =
    campaignsV2.find((c) => c.id === selectedCampaignId) || campaignsV2[0] || null;
  const campaignEnrollments: OutreachEnrollment[] = selectedCampaign
    ? (workspace?.enrollments || []).filter((e) => e.campaignId === selectedCampaign.id)
    : [];
  const campaignSequence = selectedCampaign
    ? (workspace?.sequences || []).find(
        (s) => s.id === selectedCampaign.sequenceId || s.campaignId === selectedCampaign.id
      ) || null
    : null;

  useEffect(() => {
    if (campaignSequence) {
      setEditingSeq(JSON.parse(JSON.stringify(campaignSequence)));
    } else {
      setEditingSeq(null);
    }
  }, [campaignSequence?.id, selectedCampaign?.id]);

  const handleRefreshAll = async () => {
    await loadWorkspace();
    onRefreshCampaigns();
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newObjective.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch('/api/outreach/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          objective: newObjective.trim(),
          description: newDescription.trim() || undefined,
          mode: newMode,
          channel: newChannel,
          targetIcpId: newIcpId || undefined,
          defaultTone: newTone,
          maxFollowUps: Number(newMaxFollowUps),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create campaign.');
      setNewName('');
      setNewObjective('');
      setNewDescription('');
      setShowCreateForm(false);
      if (data.campaign?.id) setSelectedCampaignId(data.campaign.id);
      setNotice({ type: 'success', text: `Campaign "${data.campaign.name}" created with primary sequence.` });
      await handleRefreshAll();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Creation failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCampaignStatus = async (campaignId: string, status: OutreachCampaignV2['status']) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/outreach/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Status update failed.');
      setNotice({ type: 'success', text: `Campaign status updated to ${status}.` });
      await handleRefreshAll();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Status update failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleEnroll = async () => {
    if (!selectedCampaign || enrollLeadIds.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const recipients = enrollLeadIds.map((leadId) => ({
        leadId,
        personId: enrollLeadIds.length === 1 && enrollPersonId ? enrollPersonId : undefined,
      }));
      const res = await apiFetch(`/api/outreach/campaigns/${selectedCampaign.id}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enrollment failed.');
      const enrolledCount = data.enrolled?.length || 0;
      const rejectedList = (data.rejected || []) as Array<{ rejectedReason?: string }>;
      if (enrolledCount > 0) {
        setEnrollLeadIds([]);
        setEnrollPersonId('');
        setNotice({
          type: 'success',
          text: `Enrolled ${enrolledCount} recipient(s).${
            rejectedList.length > 0 ? ` ${rejectedList.length} skipped (${rejectedList[0].rejectedReason}).` : ''
          }`,
        });
      } else {
        setNotice({
          type: 'error',
          text: rejectedList[0]?.rejectedReason || 'No eligible recipients were enrolled.',
        });
      }
      await handleRefreshAll();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Enrollment failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateDraft = async (enrollment: OutreachEnrollment, stepNumber?: number) => {
    if (!selectedCampaign) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch('/api/outreach/messages/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: enrollment.campaignId,
          leadId: enrollment.leadId,
          personId: enrollment.personId,
          enrollmentId: enrollment.id,
          stepNumber: stepNumber ?? enrollment.currentStepNumber,
          customInstructions: customDraftInstructions.trim() || undefined,
          includePrivateNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate draft.');
      setNotice({
        type: 'success',
        text: `Generated grounded draft for ${enrollment.companyName}. Review and approve it in Approval Queue.`,
      });
      setActiveTab('approvals');
      await handleRefreshAll();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Draft generation failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDraftFromFollowUp = async (item: OutreachFollowUpItem) => {
    if (!item.campaignId) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch('/api/outreach/messages/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: item.campaignId,
          leadId: item.leadId,
          personId: item.personId,
          enrollmentId: item.enrollmentId,
          stepNumber: item.stepNumber || 2,
          customInstructions: `Follow-up context: ${item.explanation}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate follow-up draft.');
      setNotice({
        type: 'success',
        text: `Follow-up draft generated for ${item.companyName} and placed in Approval Queue.`,
      });
      setActiveTab('approvals');
      await handleRefreshAll();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to draft follow-up.' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSequence = async () => {
    if (!editingSeq) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await apiFetch('/api/outreach/sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingSeq),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save sequence.');
      setNotice({ type: 'success', text: `Saved sequence "${data.sequence.name}".` });
      await handleRefreshAll();
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Sequence save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const pendingApprovalCount = (workspace?.messages || []).filter(
    (m) => m.status === 'draft' || m.status === 'pending_approval'
  ).length;
  const approvedReadyCount = (workspace?.messages || []).filter((m) => m.status === 'approved').length;
  const activeFollowUpsCount = (workspace?.followUps || []).filter(
    (f) => f.status === 'scheduled' || f.status === 'pending_approval'
  ).length;
  const configuredProviderCount = providers.filter(
    (p) => p.automatedSendingSupported && p.configured && p.fromEmailConfigured
  ).length;

  const tabs: Array<{ id: OutreachTab; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'campaigns', label: 'Campaigns', icon: <Send className="h-3.5 w-3.5" />, count: campaignsV2.length },
    { id: 'sequences', label: 'Sequences', icon: <ListOrdered className="h-3.5 w-3.5" /> },
    {
      id: 'approvals',
      label: 'Approval Queue',
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      count: pendingApprovalCount + approvedReadyCount,
    },
    {
      id: 'follow_ups',
      label: 'Follow-Ups',
      icon: <CalendarClock className="h-3.5 w-3.5" />,
      count: activeFollowUpsCount,
    },
    {
      id: 'replies',
      label: 'Replies',
      icon: <MessageSquareReply className="h-3.5 w-3.5" />,
      count: workspace?.replies?.length || 0,
    },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { id: 'compliance', label: 'Providers & Compliance', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  ];

  const toggleEnrollLead = (id: string) => {
    setEnrollLeadIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  if (loading && !workspace) {
    return (
      <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Loading outreach workspace...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FeatureBanner
        tone="crimson"
        eyebrow="Human-in-the-Loop Outreach"
        title="Outreach Campaigns & Approval Queue"
        description={
          configuredProviderCount > 0
            ? `${configuredProviderCount} verified email provider configured. Every outbound draft requires explicit owner approval before dispatch.`
            : 'Draft & Manual Mode active. Compose personalised sequences, review every message, and track replies with full compliance.'
        }
        highlights={
          analytics
            ? [
                { label: 'Pending Approval', value: analytics.totals.messagesPendingApproval },
                { label: 'Active Campaigns', value: analytics.totals.campaignsActive },
                { label: 'Dispatched', value: analytics.totals.messagesTotalDispatched },
              ]
            : undefined
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => {
                setActiveTab('campaigns');
                setShowCreateForm(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-bold text-[#910303] hover:bg-[#FAF4F4] transition-colors shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" /> New Campaign
            </button>
            {onOpenAiAgent && (
              <button
                type="button"
                onClick={() => onOpenAiAgent(enrollLeadIds[0])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/12 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/22 transition-colors"
              >
                <Bot className="h-3.5 w-3.5" /> AI Sales Agent
              </button>
            )}
            <button
              type="button"
              onClick={handleRefreshAll}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/12 px-3 py-2 text-xs font-semibold text-white hover:bg-white/22 transition-colors"
              title="Refresh outreach workspace"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </>
        }
      />

      {/* KPI Strip */}
      {analytics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiMetric
            label="Active Campaigns"
            value={analytics.totals.campaignsActive}
            detail={`${analytics.totals.campaignsTotal} total`}
            variant="maroon"
          />
          <KpiMetric
            label="Enrollments"
            value={analytics.totals.enrollmentsActive}
            detail={`${analytics.totals.enrollmentsTotal} total`}
          />
          <KpiMetric
            label="Pending Approval"
            value={analytics.totals.messagesPendingApproval}
            detail={`${analytics.totals.messagesApproved} approved`}
            tone={analytics.totals.messagesPendingApproval > 0 ? 'amber' : 'default'}
          />
          <KpiMetric
            label="Dispatched"
            value={analytics.totals.messagesTotalDispatched}
            detail={`${analytics.totals.messagesSentViaProvider} API · ${analytics.totals.messagesManualSent} manual`}
          />
          <KpiMetric
            label="Replies"
            value={analytics.totals.repliesReceived}
            detail={`${analytics.totals.positiveResponses} positive`}
            tone="teal"
          />
          <KpiMetric
            label="Follow-Ups"
            value={analytics.totals.followUpsPending}
            detail={`${analytics.totals.followUpsOverdue} overdue`}
            tone={analytics.totals.followUpsOverdue > 0 ? 'danger' : 'default'}
          />
        </div>
      )}

      {/* Status Notice */}
      {notice && (
        <NoticeBanner
          tone={notice.type === 'success' ? 'success' : 'error'}
          message={notice.text}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* Tab Navigation */}
      <SegmentedTabs
        variant="underline"
        activeId={activeTab}
        onChange={(id) => setActiveTab(id)}
        items={tabs}
      />

      {/* TAB 1: CAMPAIGNS & ENROLLMENTS */}
      {activeTab === 'campaigns' && (
        <div className="space-y-4">
          {showCreateForm && (
            <form
              onSubmit={handleCreateCampaign}
              className="rounded-xl border border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#440303] p-5 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#7A1E1E] pb-2.5">
                <h3 className="text-base font-semibold text-slate-900 dark:text-[#FAF4F4]">New Outreach Campaign</h3>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="text-xs text-slate-500 dark:text-[#C9A7A7] hover:text-slate-900 dark:hover:text-[#FAF4F4]"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-800 dark:text-[#FAF4F4]">Campaign Name</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., Q2 DACH Manufacturing Expansion"
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#240202] px-2.5 py-1.5 text-xs font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:border-[#CE0404] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-800 dark:text-[#FAF4F4]">Campaign Objective</label>
                  <input
                    type="text"
                    required
                    value={newObjective}
                    onChange={(e) => setNewObjective(e.target.value)}
                    placeholder="e.g., Introduce strategic supply chain partnership"
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#240202] px-2.5 py-1.5 text-xs font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:border-[#CE0404] focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-[#FAF4F4]">Mode</label>
                  <select
                    value={newMode}
                    onChange={(e) => setNewMode(e.target.value as OutreachCampaignModeV2)}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#240202] px-2 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] focus:border-[#CE0404] focus:outline-none"
                  >
                    <option value="individual">Individual</option>
                    <option value="controlled_batch">Controlled Batch</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-[#FAF4F4]">Channel</label>
                  <select
                    value={newChannel}
                    onChange={(e) => setNewChannel(e.target.value as OutreachChannelV2)}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#240202] px-2 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] focus:border-[#CE0404] focus:outline-none"
                  >
                    {OUTREACH_CHANNELS.map((ch) => (
                      <option key={ch.value} value={ch.value}>
                        {ch.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-[#FAF4F4]">Target ICP (optional)</label>
                  <select
                    value={newIcpId}
                    onChange={(e) => setNewIcpId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#240202] px-2 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] focus:border-[#CE0404] focus:outline-none"
                  >
                    <option value="">None</option>
                    {icpProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-[#FAF4F4]">Default Tone</label>
                  <select
                    value={newTone}
                    onChange={(e) => setNewTone(e.target.value as AiDraftTone)}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#240202] px-2 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] focus:border-[#CE0404] focus:outline-none"
                  >
                    <option value="warm_professional">Warm Professional</option>
                    <option value="executive">Executive & Concise</option>
                    <option value="consultative">Consultative</option>
                    <option value="direct">Direct & Action-Oriented</option>
                    <option value="formal">Formal Business</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-[#FAF4F4]">Max Follow-Ups</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={newMaxFollowUps}
                    onChange={(e) => setNewMaxFollowUps(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#240202] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] tabular-nums focus:border-[#CE0404] focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-[#FAF4F4]">Description / Notes (optional)</label>
                <textarea
                  rows={2}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#240202] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] focus:border-[#CE0404] focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-md border border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#690303] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-[#FAF4F4] hover:bg-slate-50 dark:hover:bg-[#910303]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-[#B30303] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#CE0404] disabled:opacity-50"
                >
                  {busy ? 'Creating...' : 'Create Campaign'}
                </button>
              </div>
            </form>
          )}

          {campaignsV2.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#440303] p-10 text-center">
              <Send className="mx-auto h-8 w-8 text-slate-400 dark:text-[#C9A7A7]" />
              <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-[#FAF4F4]">No outreach campaigns yet</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-[#E6D2D2]">
                Create an individual or controlled-batch campaign to enroll CRM companies, generate evidence-grounded drafts, and review every message before dispatch.
              </p>
              <button
                onClick={() => setShowCreateForm(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[#B30303] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#CE0404]"
              >
                <Plus className="h-3.5 w-3.5" /> Create First Campaign
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* Left Campaign List */}
              <div className="lg:col-span-4 space-y-2">
                {campaignsV2.map((c) => {
                  const active = selectedCampaign?.id === c.id;
                  const countEnrolled = (workspace?.enrollments || []).filter((e) => e.campaignId === c.id).length;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCampaignId(c.id)}
                      className={`w-full rounded-lg border p-3.5 text-left transition-colors ${
                        active
                          ? 'border-[#CE0404] bg-[#910303]/10 dark:bg-[#690303]'
                          : 'border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#440303] hover:border-slate-300 dark:hover:border-[#CE0404]/70 dark:hover:bg-[#690303]/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-[#FAF4F4]">{c.name}</p>
                        <span className="rounded border border-slate-200 dark:border-[#7A1E1E] bg-slate-50 dark:bg-[#240202] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700 dark:text-[#FF9492]">
                          {c.status}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-[#E6D2D2]">{c.objective}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-500 dark:text-[#C9A7A7]">
                        <span className="uppercase">{c.channel}</span>
                        <span>{c.mode.replace('_', ' ')}</span>
                        <span className="tabular-nums">{countEnrolled} enrolled</span>
                        {c.targetIcpName && <span>ICP: {c.targetIcpName}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right Selected Campaign Workspace */}
              {selectedCampaign && (
                <div className="lg:col-span-8 space-y-4">
                  <div className="rounded-lg border border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#440303] p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-[#7A1E1E] pb-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-[#FAF4F4]">{selectedCampaign.name}</h3>
                        <p className="text-xs text-slate-600 dark:text-[#E6D2D2] mt-0.5">{selectedCampaign.objective}</p>
                        <p className="text-[11px] text-slate-500 dark:text-[#C9A7A7] mt-1">
                          Channel: {selectedCampaign.channel.toUpperCase()} · Tone: {selectedCampaign.defaultTone} · Max Follow-Ups: {selectedCampaign.maxFollowUps}
                          {selectedCampaign.targetIcpName ? ` · Target ICP: ${selectedCampaign.targetIcpName}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {selectedCampaign.status !== 'active' && selectedCampaign.status !== 'archived' && (
                          <button
                            onClick={() => handleCampaignStatus(selectedCampaign.id, 'active')}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-700/70 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
                          >
                            <Play className="h-3.5 w-3.5" /> Activate
                          </button>
                        )}
                        {selectedCampaign.status === 'active' && (
                          <button
                            onClick={() => handleCampaignStatus(selectedCampaign.id, 'paused')}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 dark:border-amber-600/60 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60"
                          >
                            <Pause className="h-3.5 w-3.5" /> Pause
                          </button>
                        )}
                        {selectedCampaign.status !== 'archived' && (
                          <button
                            onClick={() => handleCampaignStatus(selectedCampaign.id, 'archived')}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#690303] px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-[#E6D2D2] hover:bg-slate-50 dark:hover:bg-[#910303] dark:hover:text-[#FAF4F4]"
                          >
                            <Archive className="h-3.5 w-3.5" /> Archive
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Enroll CRM Companies / Decision-Makers */}
                    {selectedCampaign.status !== 'archived' && (
                      <div className="rounded-md border border-slate-200 dark:border-[#7A1E1E] bg-slate-50 dark:bg-[#240202] p-3 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-[#FAF4F4]">
                            <Users className="h-3.5 w-3.5 text-[#B30303] dark:text-[#FF9492]" />
                            Enroll CRM Companies & Decision-Makers
                          </span>
                          <span className="text-[11px] text-slate-500 dark:text-[#C9A7A7]">
                            Checks suppression, opt-outs, email validity & duplicate protection
                          </span>
                        </div>
                        <div className="max-h-36 overflow-y-auto rounded border border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#440303] divide-y divide-slate-100 dark:divide-[#7A1E1E]">
                          {leads.length === 0 ? (
                            <p className="p-3 text-xs text-slate-500 dark:text-[#C9A7A7]">No CRM companies available to enroll.</p>
                          ) : (
                            leads.slice(0, 40).map((l) => (
                              <label
                                key={l.id}
                                className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-[#690303] cursor-pointer"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={enrollLeadIds.includes(l.id)}
                                    onChange={() => toggleEnrollLead(l.id)}
                                    className="accent-[#B30303]"
                                  />
                                  <span className="font-medium text-slate-800 dark:text-[#FAF4F4] truncate">{l.companyName}</span>
                                  <span className="text-slate-500 dark:text-[#C9A7A7] truncate">{l.email || 'no company email'}</span>
                                </span>
                                <span className="text-[11px] text-slate-400 dark:text-[#C9A7A7] shrink-0">{l.status}</span>
                              </label>
                            ))
                          )}
                        </div>
                        {enrollLeadIds.length === 1 && persons.length > 0 && (
                          <div>
                            <label className="block text-[11px] font-medium text-slate-700 dark:text-[#FAF4F4]">
                              Specific Decision-Maker (optional)
                            </label>
                            <select
                              value={enrollPersonId}
                              onChange={(e) => setEnrollPersonId(e.target.value)}
                              className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#440303] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] focus:border-[#CE0404] focus:outline-none"
                            >
                              <option value="">Company-level contact</option>
                              {persons.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.fullName} {p.email ? `(${p.email})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-600 dark:text-[#E6D2D2] tabular-nums">
                            {enrollLeadIds.length} company selected
                          </span>
                          <button
                            type="button"
                            onClick={handleEnroll}
                            disabled={busy || enrollLeadIds.length === 0}
                            className="rounded-md bg-[#B30303] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#CE0404] disabled:opacity-50"
                          >
                            Enroll Selected
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Draft Generation Options */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <input
                        type="text"
                        value={customDraftInstructions}
                        onChange={(e) => setCustomDraftInstructions(e.target.value)}
                        placeholder="Optional instructions for AI personalization (never fabricates unverified facts)"
                        className="flex-1 min-w-[220px] rounded-md border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#240202] px-2.5 py-1.5 text-xs font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:border-[#CE0404] focus:outline-none"
                      />
                      <label className="inline-flex items-center gap-1.5 text-slate-700 dark:text-[#FAF4F4]">
                        <input
                          type="checkbox"
                          checked={includePrivateNotes}
                          onChange={(e) => setIncludePrivateNotes(e.target.checked)}
                          className="accent-[#B30303]"
                        />
                        Authorize Private Notes in AI Context
                      </label>
                    </div>

                    {/* Enrolled Recipients Table */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-[#E6D2D2]">
                        Enrolled Recipients ({campaignEnrollments.length})
                      </h4>
                      {campaignEnrollments.length === 0 ? (
                        <p className="rounded border border-dashed border-slate-200 dark:border-[#8C2828] p-4 text-center text-xs text-slate-500 dark:text-[#C9A7A7]">
                          No recipients enrolled in this campaign yet.
                        </p>
                      ) : (
                        <div className="divide-y divide-slate-100 dark:divide-[#7A1E1E] rounded-md border border-slate-200 dark:border-[#7A1E1E]">
                          {campaignEnrollments.map((enr) => (
                            <div
                              key={enr.id}
                              className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => onSelectLead?.(enr.leadId)}
                                    className="font-semibold text-slate-900 dark:text-[#FAF4F4] hover:text-[#B30303] dark:hover:text-[#FF9492] hover:underline"
                                  >
                                    {enr.companyName}
                                  </button>
                                  {enr.personName && (
                                    <span className="text-slate-600 dark:text-[#E6D2D2]">· {enr.personName}</span>
                                  )}
                                  <span className="rounded border border-slate-200 dark:border-[#7A1E1E] bg-slate-50 dark:bg-[#690303] px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-700 dark:text-[#FAF4F4]">
                                    {enr.status.replace(/_/g, ' ')}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-[#C9A7A7] mt-0.5">
                                  {enr.recipientEmail || 'No email'} · Step {enr.currentStepNumber}/{enr.maxSteps} · Sent: {enr.messagesSentCount}
                                  {enr.recipientTimezone ? ` · TZ: ${enr.recipientTimezone}` : ''}
                                </p>
                                {enr.exitReason && (
                                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">{enr.exitReason}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                {enr.status === 'active' && (
                                  <button
                                    type="button"
                                    onClick={() => handleGenerateDraft(enr)}
                                    disabled={busy}
                                    className="inline-flex items-center gap-1 rounded-md bg-[#B30303] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[#CE0404] disabled:opacity-50"
                                  >
                                    <Sparkles className="h-3.5 w-3.5" /> Draft Step {enr.currentStepNumber}
                                  </button>
                                )}
                              </div>
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
        </div>
      )}

      {/* TAB 2: SEQUENCES */}
      {activeTab === 'sequences' && (
        <div className="rounded-lg border border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#440303] p-5 space-y-4">
          {!editingSeq ? (
            <p className="text-xs text-slate-500 dark:text-[#C9A7A7] text-center py-8">
              Select or create a campaign first to configure its outreach sequence steps and follow-up timing.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-[#7A1E1E] pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-[#FAF4F4]">{editingSeq.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-[#E6D2D2]">
                    Every sequence step generates an owner-reviewable draft; nothing is sent without explicit approval.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingSeq({
                        ...editingSeq,
                        steps: [
                          ...editingSeq.steps,
                          {
                            id: `new-step-${Date.now()}`,
                            stepNumber: editingSeq.steps.length + 1,
                            name: `Follow-Up ${editingSeq.steps.length}`,
                            channel: selectedCampaign?.channel || 'email',
                            draftType: 'follow_up',
                            tone: selectedCampaign?.defaultTone || 'warm_professional',
                            delayDays: 4,
                            businessDaysOnly: editingSeq.businessDaysOnly,
                            subjectTemplate: 'Following up: {{campaign_objective}} ({{company_name}})',
                            bodyTemplate: '',
                            aiPersonalizationEnabled: true,
                          },
                        ],
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-[#7A1E1E] bg-white dark:bg-[#690303] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-[#FAF4F4] hover:bg-slate-50 dark:hover:bg-[#910303]"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Step
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveSequence}
                    disabled={busy}
                    className="rounded-md bg-[#B30303] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#CE0404] disabled:opacity-50"
                  >
                    Save Sequence
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-[#FAF4F4]">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={editingSeq.businessDaysOnly}
                    onChange={(e) => setEditingSeq({ ...editingSeq, businessDaysOnly: e.target.checked })}
                    className="accent-[#B30303]"
                  />
                  Business Days Only
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={editingSeq.stopOnReply}
                    onChange={(e) => setEditingSeq({ ...editingSeq, stopOnReply: e.target.checked })}
                    className="accent-[#B30303]"
                  />
                  Stop on Reply
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={editingSeq.stopOnMeetingBooked}
                    onChange={(e) => setEditingSeq({ ...editingSeq, stopOnMeetingBooked: e.target.checked })}
                    className="accent-[#B30303]"
                  />
                  Stop on Meeting Booked
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={editingSeq.stopOnOptOut}
                    onChange={(e) => setEditingSeq({ ...editingSeq, stopOnOptOut: e.target.checked })}
                    className="accent-[#B30303]"
                  />
                  Stop Immediately on Opt-Out
                </label>
              </div>

              <div className="space-y-3">
                {editingSeq.steps.map((step, idx) => (
                  <div key={step.id} className="rounded-md border border-slate-200 dark:border-[#7A1E1E] bg-slate-50 dark:bg-[#240202] p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-[#FAF4F4]">
                        Step {idx + 1}: {step.name}
                      </span>
                      {editingSeq.steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingSeq({
                              ...editingSeq,
                              steps: editingSeq.steps.filter((_, i) => i !== idx),
                            })
                          }
                          className="text-slate-400 dark:text-[#C9A7A7] hover:text-[#CE0404] dark:hover:text-[#FF8A87]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                      <input
                        type="text"
                        value={step.name}
                        onChange={(e) => {
                          const next = [...editingSeq.steps];
                          next[idx] = { ...step, name: e.target.value };
                          setEditingSeq({ ...editingSeq, steps: next });
                        }}
                        placeholder="Step label"
                        className="rounded border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#440303] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] focus:border-[#CE0404] focus:outline-none"
                      />
                      <select
                        value={step.channel}
                        onChange={(e) => {
                          const next = [...editingSeq.steps];
                          next[idx] = { ...step, channel: e.target.value as OutreachChannelV2 };
                          setEditingSeq({ ...editingSeq, steps: next });
                        }}
                        className="rounded border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#440303] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] focus:border-[#CE0404] focus:outline-none"
                      >
                        <option value="email">Email</option>
                        <option value="linkedin">LinkedIn (Manual)</option>
                        <option value="phone">Phone Script</option>
                        <option value="custom">Custom</option>
                      </select>
                      <input
                        type="number"
                        min={idx === 0 ? 0 : 1}
                        max={60}
                        value={step.delayDays}
                        onChange={(e) => {
                          const next = [...editingSeq.steps];
                          next[idx] = { ...step, delayDays: Number(e.target.value) };
                          setEditingSeq({ ...editingSeq, steps: next });
                        }}
                        className="rounded border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#440303] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#FAF4F4] tabular-nums focus:border-[#CE0404] focus:outline-none"
                        title="Delay in days"
                      />
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-[#FAF4F4] px-1">
                        <input
                          type="checkbox"
                          checked={step.aiPersonalizationEnabled}
                          onChange={(e) => {
                            const next = [...editingSeq.steps];
                            next[idx] = { ...step, aiPersonalizationEnabled: e.target.checked };
                            setEditingSeq({ ...editingSeq, steps: next });
                          }}
                          className="accent-[#B30303]"
                        />
                        AI Personalization
                      </label>
                    </div>
                    <input
                      type="text"
                      value={step.subjectTemplate}
                      onChange={(e) => {
                        const next = [...editingSeq.steps];
                        next[idx] = { ...step, subjectTemplate: e.target.value };
                        setEditingSeq({ ...editingSeq, steps: next });
                      }}
                      placeholder="Subject template (supports {{company_name}}, {{recipient_name}}, {{campaign_objective}})"
                      className="w-full rounded border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#440303] px-2.5 py-1.5 text-xs font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:border-[#CE0404] focus:outline-none"
                    />
                    <textarea
                      rows={2}
                      value={step.bodyTemplate}
                      onChange={(e) => {
                        const next = [...editingSeq.steps];
                        next[idx] = { ...step, bodyTemplate: e.target.value };
                        setEditingSeq({ ...editingSeq, steps: next });
                      }}
                      placeholder="Optional body template (leave blank for AI / grounded structured generation)"
                      className="w-full rounded border border-slate-300 dark:border-[#8C2828] bg-white dark:bg-[#440303] px-2.5 py-1.5 text-xs font-medium text-slate-950 dark:text-[#FAF4F4] placeholder:text-slate-500 dark:placeholder:text-[#C9A7A7] focus:border-[#CE0404] focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: APPROVAL QUEUE */}
      {activeTab === 'approvals' && workspace && (
        <ApprovalQueuePanel
          messages={workspace.messages}
          providers={providers}
          onRefresh={handleRefreshAll}
          onSelectLead={onSelectLead}
          onStatusNotice={setNotice}
        />
      )}

      {/* TAB 4: FOLLOW-UPS */}
      {activeTab === 'follow_ups' && workspace && (
        <FollowUpsAndRepliesPanel
          mode="follow_ups"
          followUps={workspace.followUps}
          replies={workspace.replies}
          campaigns={workspace.campaigns}
          leads={leads}
          onRefresh={handleRefreshAll}
          onDraftFollowUp={handleDraftFromFollowUp}
          onStatusNotice={setNotice}
        />
      )}

      {/* TAB 5: REPLIES */}
      {activeTab === 'replies' && workspace && (
        <FollowUpsAndRepliesPanel
          mode="replies"
          followUps={workspace.followUps}
          replies={workspace.replies}
          campaigns={workspace.campaigns}
          leads={leads}
          onRefresh={handleRefreshAll}
          onStatusNotice={setNotice}
        />
      )}

      {/* TAB 6: ANALYTICS */}
      {activeTab === 'analytics' && analytics && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: 'Reply Rate', value: analytics.rates.replyRatePercent !== null ? `${analytics.rates.replyRatePercent}%` : 'N/A' },
              { label: 'Positive Response Rate', value: analytics.rates.positiveResponseRatePercent !== null ? `${analytics.rates.positiveResponseRatePercent}%` : 'N/A' },
              { label: 'Meeting Conversion Rate', value: analytics.rates.meetingConversionRatePercent !== null ? `${analytics.rates.meetingConversionRatePercent}%` : 'N/A' },
              { label: 'Opt-Out Rate', value: analytics.rates.optOutRatePercent !== null ? `${analytics.rates.optOutRatePercent}%` : 'N/A' },
            ].map((r) => (
              <div key={r.label} className="rounded-lg border border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#440303] p-4">
                <p className="text-xs font-semibold text-slate-600 dark:text-[#E6D2D2]">{r.label}</p>
                <p className="mt-1 text-2xl font-extrabold text-slate-950 dark:text-[#FAF4F4] tabular-nums">{r.value}</p>
              </div>
            ))}
          </div>

          {/* By Campaign Table */}
          <div className="rounded-lg border border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#440303] p-4 space-y-2.5 overflow-x-auto">
            <h3 className="text-sm font-bold text-slate-950 dark:text-[#FAF4F4]">Performance by Campaign (Recorded Evidence Only)</h3>
            {analytics.byCampaign.length === 0 ? (
              <p className="text-xs font-medium text-slate-600 dark:text-[#E6D2D2] py-4">No campaigns recorded yet.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-[#7A1E1E] text-[11px] uppercase tracking-wider text-slate-700 dark:text-[#F4E8E8]">
                    <th className="py-2 pr-3 font-bold">Campaign</th>
                    <th className="py-2 px-2 font-bold">Channel</th>
                    <th className="py-2 px-2 font-bold text-right">Enrolled</th>
                    <th className="py-2 px-2 font-bold text-right">Drafted</th>
                    <th className="py-2 px-2 font-bold text-right">Sent</th>
                    <th className="py-2 px-2 font-bold text-right">Failed</th>
                    <th className="py-2 px-2 font-bold text-right">Replies</th>
                    <th className="py-2 pl-2 font-bold text-right">Opt-Outs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#7A1E1E] tabular-nums text-slate-700 dark:text-[#FAF4F4]">
                  {analytics.byCampaign.map((row) => (
                    <tr key={row.campaignId} className="hover:bg-slate-50 dark:hover:bg-[#690303]">
                      <td className="py-2 pr-3 font-medium text-slate-900 dark:text-[#FAF4F4]">{row.campaignName}</td>
                      <td className="py-2 px-2 uppercase text-slate-600 dark:text-[#C9A7A7]">{row.channel}</td>
                      <td className="py-2 px-2 text-right">{row.enrolled}</td>
                      <td className="py-2 px-2 text-right">{row.drafted}</td>
                      <td className="py-2 px-2 text-right font-semibold text-emerald-700 dark:text-emerald-300">{row.sent}</td>
                      <td className="py-2 px-2 text-right text-rose-700 dark:text-[#FF8A87]">{row.failed}</td>
                      <td className="py-2 px-2 text-right">{row.replies}</td>
                      <td className="py-2 pl-2 text-right">{row.optOuts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Honest Unavailable Metrics Disclosure */}
          <div className="rounded-lg border border-amber-200 dark:border-amber-600/60 bg-amber-50 dark:bg-[#4A2408]/60 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              Untracked & Unavailable Metrics (Zero Fabricated Telemetry)
            </div>
            <ul className="space-y-1.5 text-xs text-amber-900 dark:text-[#FAF4F4]">
              {analytics.unavailableMetrics.map((m) => (
                <li key={m.metric}>
                  <strong className="text-amber-950 dark:text-amber-300">{m.metric}</strong> [{m.status.toUpperCase()}]: {m.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* TAB 7: PROVIDERS & COMPLIANCE */}
      {activeTab === 'compliance' && workspace && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setComplianceSubTab('suppression')}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                complianceSubTab === 'suppression'
                  ? 'border-[#CE0404] bg-[#910303] text-white'
                  : 'border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#440303] text-slate-700 dark:text-[#E6D2D2] hover:dark:bg-[#690303] hover:dark:text-[#FAF4F4]'
              }`}
            >
              Suppression List & Compliance Rules
            </button>
            <button
              onClick={() => setComplianceSubTab('providers')}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                complianceSubTab === 'providers'
                  ? 'border-[#CE0404] bg-[#910303] text-white'
                  : 'border-slate-200 dark:border-[#7A1E1E] bg-white dark:bg-[#440303] text-slate-700 dark:text-[#E6D2D2] hover:dark:bg-[#690303] hover:dark:text-[#FAF4F4]'
              }`}
            >
              Communication Providers & Vault Health
            </button>
          </div>
          <SuppressionAndProvidersPanel
            mode={complianceSubTab}
            suppressions={workspace.suppressions}
            complianceConfig={workspace.complianceConfig}
            providerSettings={workspace.providerSettings}
            providers={providers}
            campaigns={workspace.campaigns}
            leads={leads}
            onRefresh={handleRefreshAll}
            onStatusNotice={setNotice}
          />
        </div>
      )}
    </div>
  );
};
