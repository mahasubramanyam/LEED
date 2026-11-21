import React, { useState } from 'react';
import {
  CalendarClock,
  MessageSquareReply,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Plus,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import {
  OUTREACH_FOLLOWUP_TRIGGERS,
  OUTREACH_REPLY_CLASSIFICATIONS,
} from '../../../shared/outreachSpecs.ts';
import type {
  CanonicalLead,
  OutreachCampaignV2,
  OutreachChannelV2,
  OutreachFollowUpItem,
  OutreachFollowUpTriggerV2,
  OutreachReplyClassificationV2,
  OutreachReplyRecord,
} from '../../types.ts';
import { apiFetch } from '../../utils/apiFetch.ts';

interface FollowUpsAndRepliesPanelProps {
  mode: 'follow_ups' | 'replies';
  followUps: OutreachFollowUpItem[];
  replies: OutreachReplyRecord[];
  campaigns: OutreachCampaignV2[];
  leads: CanonicalLead[];
  onRefresh: () => Promise<void>;
  onDraftFollowUp?: (item: OutreachFollowUpItem) => void;
  onStatusNotice?: (notice: { type: 'success' | 'error'; text: string }) => void;
}

const REPLY_CLASS_TONE: Record<string, string> = {
  positive: 'text-emerald-800 dark:text-[#7CB0A6] bg-emerald-50 dark:bg-[#192629] border-emerald-200 dark:border-[#31645C]',
  meeting_interest: 'text-indigo-800 dark:text-[#C49A52] bg-indigo-50 dark:bg-[#243638] border-indigo-200 dark:border-[#C49A52]/60',
  information_request: 'text-sky-800 dark:text-[#9FC1CB] bg-sky-50 dark:bg-[#335C67]/30 border-sky-200 dark:border-[#335C67]',
  referral: 'text-violet-800 dark:text-[#C7B3BA] bg-violet-50 dark:bg-[#6F565F]/30 border-violet-200 dark:border-[#6F565F]',
  negative: 'text-slate-700 dark:text-[#A1ADAA] bg-slate-100 dark:bg-[#101719] border-slate-200 dark:border-[#344447]',
  unsubscribe: 'text-rose-800 dark:text-[#E1B9BB] bg-rose-50 dark:bg-[#280D0F]/80 border-rose-200 dark:border-[#8F3438]',
  unknown: 'text-amber-800 dark:text-[#D3B073] bg-amber-50 dark:bg-[#243638] border-amber-200 dark:border-[#C49A52]/40',
};

export const FollowUpsAndRepliesPanel: React.FC<FollowUpsAndRepliesPanelProps> = ({
  mode,
  followUps,
  replies,
  campaigns,
  leads,
  onRefresh,
  onDraftFollowUp,
  onStatusNotice,
}) => {
  // Follow-up form state
  const [fupLeadId, setFupLeadId] = useState(leads[0]?.id || '');
  const [fupCampaignId, setFupCampaignId] = useState('');
  const [fupTrigger, setFupTrigger] = useState<OutreachFollowUpTriggerV2>('owner_requested');
  const [fupDelayDays, setFupDelayDays] = useState(2);
  const [fupExplanation, setFupExplanation] = useState('');
  const [fupFilter, setFupFilter] = useState<'active' | 'overdue' | 'all'>('active');

  // Reply form state
  const [repLeadId, setRepLeadId] = useState(leads[0]?.id || '');
  const [repCampaignId, setRepCampaignId] = useState('');
  const [repChannel, setRepChannel] = useState<OutreachChannelV2>('email');
  const [repSubject, setRepSubject] = useState('');
  const [repBody, setRepBody] = useState('');
  const [repOverrideClass, setRepOverrideClass] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const nowMs = Date.now();

  const handleCreateFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fupLeadId) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/outreach/follow-ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: fupLeadId,
          campaignId: fupCampaignId || undefined,
          triggerType: fupTrigger,
          delayDays: Number(fupDelayDays),
          explanation: fupExplanation || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to schedule follow-up.');
      if (!data.scheduled) {
        onStatusNotice?.({ type: 'error', text: data.skippedReason || 'Follow-up skipped by compliance rules.' });
      } else {
        setFupExplanation('');
        onStatusNotice?.({ type: 'success', text: 'Follow-up scheduled with business-day & timezone rules.' });
      }
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({ type: 'error', text: err instanceof Error ? err.message : 'Failed to schedule follow-up.' });
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateFollowUp = async (id: string, status: OutreachFollowUpItem['status']) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/outreach/follow-ups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update follow-up.');
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleRecordReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repLeadId || !repBody.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/outreach/replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: repLeadId,
          campaignId: repCampaignId || undefined,
          channel: repChannel,
          subject: repSubject || undefined,
          body: repBody,
          overrideClassification: (repOverrideClass || undefined) as OutreachReplyClassificationV2 | undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record reply.');
      setRepSubject('');
      setRepBody('');
      setRepOverrideClass('');
      onStatusNotice?.({
        type: 'success',
        text: `Reply logged as "${data.reply?.classification}"${
          data.suppressionCreated ? ' — global opt-out suppression & sequence exit applied immediately.' : ''
        }`,
      });
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({ type: 'error', text: err instanceof Error ? err.message : 'Failed to record reply.' });
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'follow_ups') {
    const visibleFollowUps = followUps.filter((f) => {
      const isActive = f.status === 'scheduled' || f.status === 'pending_approval';
      const isOverdue = isActive && new Date(f.scheduledFor).getTime() < nowMs;
      if (fupFilter === 'overdue') return isOverdue;
      if (fupFilter === 'active') return isActive;
      return true;
    });

    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left: Schedule New Follow-Up */}
        <form
          onSubmit={handleCreateFollowUp}
          className="lg:col-span-4 rounded-lg border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] p-4 space-y-3 h-fit"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-[#344447] pb-2.5">
            <CalendarClock className="h-4 w-4 text-[#335C67] dark:text-[#C49A52]" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-[#D8DEDC]">Schedule Contextual Follow-Up</h3>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Company</label>
            <select
              value={fupLeadId}
              onChange={(e) => setFupLeadId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
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
            <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Campaign (optional)</label>
            <select
              value={fupCampaignId}
              onChange={(e) => setFupCampaignId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
            >
              <option value="">Standalone Relationship Follow-Up</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Trigger Reason</label>
              <select
                value={fupTrigger}
                onChange={(e) => setFupTrigger(e.target.value as OutreachFollowUpTriggerV2)}
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#101719] px-2 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
              >
                {OUTREACH_FOLLOWUP_TRIGGERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Delay (days)</label>
              <input
                type="number"
                min={0}
                max={60}
                value={fupDelayDays}
                onChange={(e) => setFupDelayDays(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] tabular-nums focus:border-[#C49A52] focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-800 dark:text-[#F2F6F5]">Explanation / Context</label>
            <textarea
              rows={2}
              value={fupExplanation}
              onChange={(e) => setFupExplanation(e.target.value)}
              placeholder="Why is this follow-up scheduled?"
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#3E5256] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:border-[#C49A52] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !fupLeadId}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-[#335C67] px-3 py-2 text-xs font-bold text-white hover:bg-[#3D6C79] disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            Schedule Follow-Up
          </button>
        </form>

        {/* Right: Follow-Up Queue */}
        <div className="lg:col-span-8 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-[#D8DEDC]">
              Scheduled & Automated Follow-Ups ({visibleFollowUps.length})
            </h3>
            <div className="flex items-center gap-1.5">
              {(['active', 'overdue', 'all'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFupFilter(tab)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                    fupFilter === tab
                      ? 'border-[#335C67] bg-[#335C67] text-[#D8DEDC]'
                      : 'border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] text-slate-600 dark:text-[#A1ADAA] hover:bg-slate-50 dark:hover:bg-[#243638] dark:hover:text-[#D8DEDC]'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {visibleFollowUps.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 dark:border-[#344447] bg-white dark:bg-[#192629] p-8 text-center text-xs text-slate-500 dark:text-[#A1ADAA]">
              No follow-ups in this view.
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleFollowUps.map((item) => {
                const overdue =
                  (item.status === 'scheduled' || item.status === 'pending_approval') &&
                  new Date(item.scheduledFor).getTime() < nowMs;
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] p-4 space-y-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-[#D8DEDC]">{item.companyName}</span>
                          {item.personName && (
                            <span className="text-xs text-slate-600 dark:text-[#A1ADAA]">· {item.personName}</span>
                          )}
                          <span className="rounded border border-slate-200 dark:border-[#344447] bg-slate-50 dark:bg-[#243638] px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:text-[#D8DEDC]">
                            {item.triggerType.replace(/_/g, ' ')}
                          </span>
                          {overdue && (
                            <span className="inline-flex items-center gap-1 rounded border border-rose-200 dark:border-[#8F3438] bg-rose-50 dark:bg-[#280D0F]/80 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-[#E1B9BB]">
                              <AlertTriangle className="h-3 w-3" /> Overdue
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-700 dark:text-[#D8DEDC]">{item.explanation}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-[#A1ADAA]">
                          Recommended: {item.recommendedAction}
                        </p>
                      </div>
                      <div className="text-right text-xs tabular-nums">
                        <div className="inline-flex items-center gap-1 font-medium text-slate-800 dark:text-[#D8DEDC]">
                          <Clock className="h-3.5 w-3.5 text-slate-400 dark:text-[#C49A52]" />
                          {new Date(item.scheduledFor).toLocaleDateString()}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-[#A1ADAA]">
                          {item.recipientTimezone || 'UTC'}
                          {item.businessDayAdjusted ? ' · Biz-day adjusted' : ''}
                        </div>
                      </div>
                    </div>

                    {(item.status === 'scheduled' || item.status === 'pending_approval') && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-[#344447] pt-2.5">
                        {item.campaignId && onDraftFollowUp && (
                          <button
                            onClick={() => onDraftFollowUp(item)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-[#335C67] px-2.5 py-1 text-xs font-medium text-[#D8DEDC] hover:bg-[#3D6C79]"
                          >
                            <Sparkles className="h-3.5 w-3.5 text-[#C49A52]" /> Generate Approval Draft
                          </button>
                        )}
                        <button
                          onClick={() => handleUpdateFollowUp(item.id, 'completed')}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#243638] px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-[#D8DEDC] hover:bg-slate-50 dark:hover:bg-[#2D4245]"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-[#7CB0A6]" /> Mark Completed
                        </button>
                        <button
                          onClick={() => handleUpdateFollowUp(item.id, 'cancelled')}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-[#A1ADAA] hover:bg-slate-50 dark:hover:bg-[#243638] dark:hover:text-[#D8DEDC]"
                        >
                          <XCircle className="h-3.5 w-3.5 text-slate-400 dark:text-[#A1ADAA]" /> Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // REPLIES MODE
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left: Manual Owner Reply Recorder */}
      <form
        onSubmit={handleRecordReply}
        className="lg:col-span-5 rounded-lg border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] p-4 space-y-3 h-fit"
      >
        <div className="border-b border-slate-100 dark:border-[#344447] pb-2.5">
          <div className="flex items-center gap-2">
            <MessageSquareReply className="h-4 w-4 text-[#335C67] dark:text-[#C49A52]" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-[#D8DEDC]">Record Inbound Reply (Manual Owner Entry)</h3>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-[#A1ADAA]">
            Automated IMAP/webhook reply sync is not active. Log genuine replies here to classify intent, sync CRM interactions, exit sequences, and honor opt-outs automatically.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Company</label>
          <select
            value={repLeadId}
            onChange={(e) => setRepLeadId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
          >
            <option value="">Select company...</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.companyName}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Campaign (optional)</label>
            <select
              value={repCampaignId}
              onChange={(e) => setRepCampaignId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#101719] px-2 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
            >
              <option value="">Any / Direct</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Channel</label>
            <select
              value={repChannel}
              onChange={(e) => setRepChannel(e.target.value as OutreachChannelV2)}
              className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#101719] px-2 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
            >
              <option value="email">Email</option>
              <option value="linkedin">LinkedIn</option>
              <option value="phone">Phone</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-800 dark:text-[#E6EEEC]">Subject (optional)</label>
          <input
            type="text"
            value={repSubject}
            onChange={(e) => setRepSubject(e.target.value)}
            placeholder="Re: Partnership inquiry"
            className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#3E5256] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:border-[#C49A52] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-800 dark:text-[#E6EEEC]">Reply Content</label>
          <textarea
            rows={4}
            required
            value={repBody}
            onChange={(e) => setRepBody(e.target.value)}
            placeholder="Paste or summarize the recipient's actual reply..."
            className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#3E5256] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:border-[#C49A52] focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">
            Classification (leave Auto to classify automatically)
          </label>
          <select
            value={repOverrideClass}
            onChange={(e) => setRepOverrideClass(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
          >
            <option value="">Auto-Classify (7 Canonical Intents)</option>
            {OUTREACH_REPLY_CLASSIFICATIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={busy || !repLeadId || !repBody.trim()}
          className="w-full rounded-md bg-[#335C67] px-3 py-2 text-xs font-semibold text-[#D8DEDC] hover:bg-[#3D6C79] disabled:opacity-50"
        >
          {busy ? 'Recording...' : 'Record Reply & Update CRM'}
        </button>
      </form>

      {/* Right: Recorded Replies */}
      <div className="lg:col-span-7 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-[#D8DEDC]">
          Recorded Replies & Classification Log ({replies.length})
        </h3>
        {replies.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-[#344447] bg-white dark:bg-[#192629] p-8 text-center text-xs text-slate-500 dark:text-[#A1ADAA]">
            No replies recorded yet. LEED never fabricates inbound replies.
          </div>
        ) : (
          <div className="space-y-2.5">
            {replies.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] p-4 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-[#D8DEDC]">
                      {r.companyName}
                      {r.personName ? ` · ${r.personName}` : ''}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-[#A1ADAA]">
                      {r.campaignName || 'Direct'} · {r.channel.toUpperCase()} · Manual Owner Recorded ·{' '}
                      {new Date(r.receivedAt).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`rounded border px-2 py-0.5 text-[11px] font-semibold uppercase ${
                      REPLY_CLASS_TONE[r.classification] || REPLY_CLASS_TONE.unknown
                    }`}
                  >
                    {r.classification.replace(/_/g, ' ')}
                  </span>
                </div>
                {r.subject && <p className="text-xs font-medium text-slate-800 dark:text-[#D8DEDC]">{r.subject}</p>}
                <p className="rounded border border-slate-100 dark:border-[#344447] bg-slate-50 dark:bg-[#101719] p-2.5 text-xs text-slate-700 dark:text-[#D8DEDC] whitespace-pre-wrap">
                  {r.body}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-[#A1ADAA]">
                  <span>Rationale: {r.classificationRationale}</span>
                  {r.triggeredExit && <span className="font-medium text-[#335C67] dark:text-[#C49A52]">Sequence Exited</span>}
                  {r.triggeredSuppression && (
                    <span className="inline-flex items-center gap-1 font-semibold text-rose-700 dark:text-[#E1B9BB]">
                      <ShieldAlert className="h-3.5 w-3.5" /> Global Suppression Activated
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
