import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Send,
  Edit3,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  Ban,
  ExternalLink,
  Sparkles,
  FileCheck,
} from 'lucide-react';
import type {
  OutreachMessageRecord,
  OutreachProviderStatus,
} from '../../types.ts';
import { apiFetch } from '../../utils/apiFetch.ts';

interface ApprovalQueuePanelProps {
  messages: OutreachMessageRecord[];
  providers: OutreachProviderStatus[];
  onRefresh: () => Promise<void>;
  onSelectLead?: (leadId: string) => void;
  onStatusNotice?: (notice: { type: 'success' | 'error'; text: string }) => void;
}

const CLAIM_LABEL: Record<string, { label: string; tone: string }> = {
  verified_fact: {
    label: 'Verified Fact',
    tone: 'text-emerald-700 dark:text-[#7CB0A6] bg-emerald-50 dark:bg-[#192629] border-emerald-200 dark:border-[#31645C]',
  },
  source_reported: {
    label: 'Source-Reported',
    tone: 'text-sky-700 dark:text-[#9FC1CB] bg-sky-50 dark:bg-[#192629] border-sky-200 dark:border-[#335C67]',
  },
  ai_analysis: {
    label: 'AI Analysis',
    tone: 'text-indigo-700 dark:text-[#C49A52] bg-indigo-50 dark:bg-[#192629] border-indigo-200 dark:border-[#C49A52]/50',
  },
  hypothesis: {
    label: 'Hypothesis / Caveat',
    tone: 'text-amber-700 dark:text-[#D3B073] bg-amber-50 dark:bg-[#243638] border-amber-200 dark:border-[#C49A52]/50',
  },
};

const STATUS_BADGE: Record<string, string> = {
  draft: 'text-slate-700 dark:text-[#A1ADAA] bg-slate-100 dark:bg-[#101719] border-slate-200 dark:border-[#344447]',
  pending_approval: 'text-amber-800 dark:text-[#C49A52] bg-amber-50 dark:bg-[#243638] border-amber-200 dark:border-[#C49A52]/50',
  approved: 'text-indigo-800 dark:text-[#9FC1CB] bg-indigo-50 dark:bg-[#335C67]/30 border-indigo-200 dark:border-[#335C67]',
  sending: 'text-sky-800 dark:text-[#9FC1CB] bg-sky-50 dark:bg-[#335C67]/25 border-sky-200 dark:border-[#335C67]',
  sent: 'text-emerald-800 dark:text-[#7CB0A6] bg-emerald-50 dark:bg-[#192629] border-emerald-200 dark:border-[#31645C]',
  manual_sent: 'text-teal-800 dark:text-[#7CB0A6] bg-teal-50 dark:bg-[#192629] border-teal-200 dark:border-[#31645C]',
  failed: 'text-rose-800 dark:text-[#E1B9BB] bg-rose-50 dark:bg-[#280D0F]/80 border-rose-200 dark:border-[#8F3438]',
  rejected: 'text-slate-600 dark:text-[#A1ADAA] bg-slate-100 dark:bg-[#101719] border-slate-200 dark:border-[#344447]',
  cancelled: 'text-slate-500 dark:text-[#A1ADAA]/80 bg-slate-50 dark:bg-[#101719] border-slate-200 dark:border-[#344447]',
};

export const ApprovalQueuePanel: React.FC<ApprovalQueuePanelProps> = ({
  messages,
  providers,
  onRefresh,
  onSelectLead,
  onStatusNotice,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('needs_action');
  const [selectedId, setSelectedId] = useState<string | null>(messages[0]?.id || null);
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [manualNotes, setManualNotes] = useState('');

  const configuredEmailProviders = providers.filter(
    (p) => p.channel === 'email' && p.automatedSendingSupported && p.configured && p.fromEmailConfigured
  );

  const filtered = messages.filter((m) => {
    if (filterStatus === 'needs_action') {
      return m.status === 'draft' || m.status === 'pending_approval' || m.status === 'approved' || m.status === 'failed';
    }
    if (filterStatus === 'all') return true;
    if (filterStatus === 'dispatched') return m.status === 'sent' || m.status === 'manual_sent';
    return m.status === filterStatus;
  });

  const selected =
    filtered.find((m) => m.id === selectedId) ||
    messages.find((m) => m.id === selectedId) ||
    filtered[0] ||
    null;

  const startEdit = (msg: OutreachMessageRecord) => {
    setEditSubject(msg.subject);
    setEditBody(msg.body);
    setEditEmail(msg.recipientEmail || '');
    setEditing(true);
  };

  const runAction = async (label: string, fn: () => Promise<void>) => {
    setBusyAction(label);
    try {
      await fn();
      await onRefresh();
    } catch (err: unknown) {
      onStatusNotice?.({
        type: 'error',
        text: err instanceof Error ? err.message : `Action "${label}" failed.`,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    await runAction('save', async () => {
      const res = await apiFetch(`/api/outreach/messages/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: editSubject,
          body: editBody,
          recipientEmail: editEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save draft changes.');
      setEditing(false);
      onStatusNotice?.({
        type: 'success',
        text: 'Draft updated. Review and explicitly approve before sending.',
      });
    });
  };

  const handleApprove = async (msg: OutreachMessageRecord) => {
    await runAction('approve', async () => {
      const res = await apiFetch(`/api/outreach/messages/${msg.id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approval blocked.');
      onStatusNotice?.({
        type: 'success',
        text: `Approved message for ${msg.companyName}. Ready for controlled dispatch or manual send.`,
      });
    });
  };

  const handleReject = async (msg: OutreachMessageRecord) => {
    await runAction('reject', async () => {
      const res = await apiFetch(`/api/outreach/messages/${msg.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected by owner during approval review.' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject draft.');
      onStatusNotice?.({ type: 'success', text: `Rejected draft for ${msg.companyName}.` });
    });
  };

  const handleCancel = async (msg: OutreachMessageRecord) => {
    await runAction('cancel', async () => {
      const res = await apiFetch(`/api/outreach/messages/${msg.id}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel message.');
      onStatusNotice?.({ type: 'success', text: `Cancelled outreach message for ${msg.companyName}.` });
    });
  };

  const handleDispatch = async (msg: OutreachMessageRecord) => {
    await runAction('dispatch', async () => {
      const res = await apiFetch(`/api/outreach/messages/${msg.id}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: selectedProviderId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.sent) {
        throw new Error(data.error || data.message?.lastError || 'Dispatch did not complete.');
      }
      onStatusNotice?.({
        type: 'success',
        text: `Dispatched to ${msg.recipientEmail} via ${data.message?.providerName || 'provider'} (ID: ${data.message?.providerMessageId}).`,
      });
    });
  };

  const handleManualSent = async (msg: OutreachMessageRecord) => {
    await runAction('manual_sent', async () => {
      const res = await apiFetch(`/api/outreach/messages/${msg.id}/manual-sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: manualNotes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record manual external send.');
      setManualNotes('');
      onStatusNotice?.({
        type: 'success',
        text: `Recorded manual external send for ${msg.companyName} and logged CRM interaction.`,
      });
    });
  };

  const handleCopy = async (msg: OutreachMessageRecord) => {
    const text = `Subject: ${msg.subject}\n\n${msg.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(msg.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard may be restricted in iframe
    }
  };

  return (
    <div className="space-y-4">
      {/* Safety Governance Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-[#344447] bg-slate-50 dark:bg-[#192629] px-4 py-3 text-xs text-slate-700 dark:text-[#A1ADAA]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-[#C49A52] shrink-0" />
          <span>
            <strong className="font-semibold text-slate-900 dark:text-[#D8DEDC]">Explicit Owner Approval Required:</strong> No outreach message is ever dispatched automatically. Editing an approved draft automatically requires fresh re-approval.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {[
            { id: 'needs_action', label: 'Queue' },
            { id: 'pending_approval', label: 'Pending' },
            { id: 'approved', label: 'Approved' },
            { id: 'dispatched', label: 'Sent' },
            { id: 'failed', label: 'Failed' },
            { id: 'all', label: 'All' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterStatus(f.id)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                filterStatus === f.id
                  ? 'border-[#335C67] bg-[#335C67] text-[#D8DEDC]'
                  : 'border-slate-200 dark:border-[#344447] bg-white dark:bg-[#101719] text-slate-600 dark:text-[#A1ADAA] hover:bg-slate-100 dark:hover:bg-[#243638] dark:hover:text-[#D8DEDC]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-[#344447] bg-white dark:bg-[#192629] p-10 text-center">
          <FileCheck className="mx-auto h-8 w-8 text-slate-400 dark:text-[#A1ADAA]" />
          <p className="mt-2 text-sm font-medium text-slate-800 dark:text-[#D8DEDC]">No outreach drafts match this filter</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-[#A1ADAA]">
            Enroll companies or decision-makers in a campaign and generate AI-grounded drafts to review them here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left Queue List */}
          <div className="lg:col-span-5 space-y-2 max-h-[680px] overflow-y-auto pr-1">
            {filtered.map((msg) => {
              const active = selected?.id === msg.id;
              return (
                <button
                  key={msg.id}
                  onClick={() => {
                    setSelectedId(msg.id);
                    setEditing(false);
                  }}
                  className={`w-full rounded-lg border p-3.5 text-left transition-colors ${
                    active
                      ? 'border-[#335C67] dark:border-[#C49A52] bg-[#335C67]/10 dark:bg-[#243638]'
                      : 'border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] hover:border-slate-300 dark:hover:border-[#C49A52]/40 dark:hover:bg-[#243638]/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-[#D8DEDC]">{msg.companyName}</p>
                      <p className="truncate text-xs text-slate-600 dark:text-[#A1ADAA]">
                        {msg.recipientName ? `${msg.recipientName}` : 'General company contact'}
                        {msg.recipientEmail ? ` · ${msg.recipientEmail}` : ''}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                        STATUS_BADGE[msg.status] || 'text-slate-700 dark:text-[#A1ADAA] bg-slate-100 dark:bg-[#101719] border-slate-200 dark:border-[#344447]'
                      }`}
                    >
                      {msg.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-xs font-medium text-slate-800 dark:text-[#D8DEDC]">{msg.subject}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-[#A1ADAA]">
                    <span>{msg.campaignName}</span>
                    <span>Step {msg.stepNumber}</span>
                    <span className="uppercase">{msg.channel}</span>
                    {!msg.complianceCheck.passed && (
                      <span className="font-semibold text-rose-600 dark:text-[#D08B8E]">Compliance Blocked</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Inspection & Approval Pane */}
          {selected && (
            <div className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-[#344447] pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-[#D8DEDC]">{selected.companyName}</h3>
                    {onSelectLead && (
                      <button
                        onClick={() => onSelectLead(selected.leadId)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#335C67] dark:text-[#C49A52] hover:underline"
                      >
                        CRM Profile <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-[#A1ADAA]">
                    To: <span className="font-medium text-slate-800 dark:text-[#D8DEDC]">{selected.recipientName || 'Company Contact'}</span>
                    {selected.recipientRole ? ` (${selected.recipientRole})` : ''} ·{' '}
                    <span className="font-mono">{selected.recipientEmail || 'No email recorded'}</span>
                    {selected.recipientEmailStatus ? ` [${selected.recipientEmailStatus}]` : ''}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-[#A1ADAA]">
                    Campaign: {selected.campaignName} · Step {selected.stepNumber} · Channel: {selected.channel.toUpperCase()} · Tone: {selected.tone}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopy(selected)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#243638] px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-[#D8DEDC] hover:bg-slate-50 dark:hover:bg-[#2D4245]"
                  >
                    {copiedId === selected.id ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-[#7CB0A6]" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === selected.id ? 'Copied' : 'Copy'}
                  </button>
                  {selected.status !== 'sent' && selected.status !== 'manual_sent' && !editing && (
                    <button
                      onClick={() => startEdit(selected)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#243638] px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-[#D8DEDC] hover:bg-slate-50 dark:hover:bg-[#2D4245]"
                    >
                      <Edit3 className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                </div>
              </div>

              {/* Compliance Evaluation Box */}
              {!selected.complianceCheck.passed ? (
                <div className="rounded-md border border-rose-200 dark:border-[#8F3438] bg-rose-50 dark:bg-[#280D0F]/80 p-3 text-xs text-rose-800 dark:text-[#E1B9BB] space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    Compliance / Suppression Blockers
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {selected.complianceCheck.blockedReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : selected.complianceCheck.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-200 dark:border-[#C49A52]/50 bg-amber-50 dark:bg-[#243638] p-3 text-xs text-amber-900 dark:text-[#D3B073] space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-[#C49A52]" />
                    Compliance & Verification Advisories
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-amber-900 dark:text-[#D8DEDC]">
                    {selected.complianceCheck.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Message Preview or Editor */}
              {editing ? (
                <div className="space-y-3 rounded-md border border-[#335C67]/40 dark:border-[#C49A52]/50 bg-slate-50 dark:bg-[#101719] p-3.5">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Recipient Email</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#192629] px-3 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Subject</label>
                    <input
                      type="text"
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#192629] px-3 py-1.5 text-xs text-slate-900 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-[#D8DEDC]">Message Body</label>
                    <textarea
                      rows={9}
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#192629] px-3 py-2 text-xs text-slate-900 dark:text-[#D8DEDC] font-sans leading-relaxed focus:border-[#C49A52] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setEditing(false)}
                      className="rounded-md border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#243638] px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-[#D8DEDC] hover:bg-slate-50 dark:hover:bg-[#2D4245]"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={busyAction !== null}
                      className="rounded-md bg-[#335C67] px-3 py-1.5 text-xs font-medium text-[#D8DEDC] hover:bg-[#3D6C79] disabled:opacity-50"
                    >
                      {busyAction === 'save' ? 'Saving...' : 'Save Changes (Requires Re-Approval)'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-md border border-slate-200 dark:border-[#344447] bg-slate-50 dark:bg-[#101719] px-3 py-2 text-xs">
                    <span className="font-semibold text-slate-600 dark:text-[#A1ADAA]">Subject: </span>
                    <span className="font-medium text-slate-900 dark:text-[#D8DEDC]">{selected.subject}</span>
                  </div>
                  <div className="rounded-md border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#101719] p-3.5 text-xs text-slate-800 dark:text-[#D8DEDC] whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                    {selected.body}
                  </div>
                </div>
              )}

              {/* Evidence Grounding & Caveats */}
              {(selected.personalizationEvidence.length > 0 || selected.unknownsAndCaveats.length > 0) && (
                <div className="rounded-md border border-slate-200 dark:border-[#344447] bg-slate-50 dark:bg-[#101719] p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-[#D8DEDC]">
                      <Sparkles className="h-3.5 w-3.5 text-[#335C67] dark:text-[#C49A52]" />
                      Evidence Grounding ({selected.aiStatus?.mode === 'ai_assisted' ? `AI Assisted · ${selected.aiStatus.model}` : 'Deterministic Grounded'})
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-[#A1ADAA]">
                      Private notes: {selected.contextAudit?.privateNotesAuthorized ? 'Authorized' : 'Excluded'}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {selected.personalizationEvidence.slice(0, 6).map((item, idx) => {
                      const meta = CLAIM_LABEL[item.classification] || CLAIM_LABEL.ai_analysis;
                      return (
                        <div key={idx} className="flex items-start gap-2 text-xs text-slate-700 dark:text-[#D8DEDC]">
                          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.tone}`}>
                            {meta.label}
                          </span>
                          <span>{item.statement}</span>
                        </div>
                      );
                    })}
                  </div>
                  {selected.unknownsAndCaveats.length > 0 && (
                    <div className="border-t border-slate-200 dark:border-[#344447] pt-2 text-[11px] text-slate-600 dark:text-[#A1ADAA]">
                      <strong className="font-semibold text-slate-800 dark:text-[#D8DEDC]">Unknowns & Caveats:</strong>{' '}
                      {selected.unknownsAndCaveats.join(' · ')}
                    </div>
                  )}
                </div>
              )}

              {/* Delivery Audit Metadata */}
              {(selected.approvedAt || selected.sentAt || selected.lastError) && (
                <div className="rounded-md border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#101719] px-3 py-2 text-xs text-slate-600 dark:text-[#A1ADAA] space-y-1">
                  {selected.approvedAt && (
                    <p>
                      Approved by <strong className="text-slate-800 dark:text-[#D8DEDC]">{selected.approvedBy}</strong> on{' '}
                      {new Date(selected.approvedAt).toLocaleString()}
                    </p>
                  )}
                  {selected.sentAt && (
                    <p className="text-emerald-700 dark:text-[#7CB0A6]">
                      Dispatched ({selected.deliveryMethod === 'manual_external' ? 'Manual External' : selected.providerName}) on{' '}
                      {new Date(selected.sentAt).toLocaleString()}
                      {selected.providerMessageId ? ` · Provider ID: ${selected.providerMessageId}` : ''}
                    </p>
                  )}
                  {selected.lastError && (
                    <p className="text-rose-700 dark:text-[#E1B9BB]">
                      <strong>Last Provider Notice:</strong> {selected.lastError}
                    </p>
                  )}
                </div>
              )}

              {/* Approval & Controlled Dispatch Controls */}
              {selected.status !== 'sent' && selected.status !== 'manual_sent' && selected.status !== 'cancelled' && (
                <div className="border-t border-slate-200 dark:border-[#344447] pt-3 space-y-3">
                  {(selected.status === 'draft' || selected.status === 'pending_approval' || selected.status === 'rejected' || selected.status === 'failed') && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => handleApprove(selected)}
                        disabled={busyAction !== null || !selected.complianceCheck.passed}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#335C67] px-3.5 py-2 text-xs font-semibold text-[#D8DEDC] hover:bg-[#3D6C79] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4 text-[#C49A52]" />
                        {busyAction === 'approve' ? 'Approving...' : 'Approve for Dispatch'}
                      </button>
                      <button
                        onClick={() => handleReject(selected)}
                        disabled={busyAction !== null}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#243638] px-3 py-2 text-xs font-medium text-slate-700 dark:text-[#D8DEDC] hover:bg-slate-50 dark:hover:bg-[#2D4245]"
                      >
                        <XCircle className="h-4 w-4 text-slate-500 dark:text-[#A1ADAA]" />
                        Reject
                      </button>
                      <button
                        onClick={() => handleCancel(selected)}
                        disabled={busyAction !== null}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] px-3 py-2 text-xs font-medium text-slate-600 dark:text-[#A1ADAA] hover:bg-slate-50 dark:hover:bg-[#243638] dark:hover:text-[#D8DEDC]"
                      >
                        <Ban className="h-4 w-4 text-slate-400 dark:text-[#A1ADAA]" />
                        Cancel
                      </button>
                    </div>
                  )}

                  {selected.status === 'approved' && (
                    <div className="space-y-3 rounded-md border border-[#335C67]/40 dark:border-[#C49A52]/50 bg-[#335C67]/5 dark:bg-[#243638] p-3.5">
                      {selected.channel === 'email' ? (
                        configuredEmailProviders.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={selectedProviderId}
                              onChange={(e) => setSelectedProviderId(e.target.value)}
                              className="rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs text-slate-800 dark:text-[#D8DEDC] focus:border-[#C49A52] focus:outline-none"
                            >
                              <option value="">Default Configured Provider ({configuredEmailProviders[0].name})</option>
                              {configuredEmailProviders.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.fromEmail})
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => handleDispatch(selected)}
                              disabled={busyAction !== null}
                              className="inline-flex items-center gap-1.5 rounded-md bg-[#335C67] px-3.5 py-1.5 text-xs font-semibold text-[#D8DEDC] hover:bg-[#3D6C79] disabled:opacity-50"
                            >
                              <Send className="h-3.5 w-3.5 text-[#C49A52]" />
                              {busyAction === 'dispatch' ? 'Dispatching...' : 'Send Approved Email Now'}
                            </button>
                          </div>
                        ) : (
                          <div className="rounded border border-amber-200 dark:border-[#C49A52]/50 bg-amber-50 dark:bg-[#192629] p-2.5 text-xs text-amber-900 dark:text-[#D3B073]">
                            <strong>No authorized email provider configured:</strong> Automated sending is disabled (LEED never simulates delivery). Configure Resend, SendGrid, Postmark, or Mailgun in <em>Providers & Compliance</em>, or send externally and record it honestly below.
                          </div>
                        )
                      ) : (
                        <div className="rounded border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] p-2.5 text-xs text-slate-700 dark:text-[#D8DEDC]">
                          <strong>Manual Channel Policy ({selected.channel.toUpperCase()}):</strong> Automated sending is disabled by policy. Copy the approved message above, send externally, and record manual completion below.
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={manualNotes}
                          onChange={(e) => setManualNotes(e.target.value)}
                          placeholder="Optional note (e.g., sent via Gmail / LinkedIn manually)"
                          className="flex-1 min-w-[200px] rounded-md border border-slate-300 dark:border-[#3E5256] bg-white dark:bg-[#101719] px-2.5 py-1.5 text-xs font-medium text-slate-950 dark:text-[#F2F6F5] placeholder:text-slate-500 dark:placeholder:text-[#9FB2AF] focus:border-[#C49A52] focus:outline-none"
                        />
                        <button
                          onClick={() => handleManualSent(selected)}
                          disabled={busyAction !== null}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 dark:border-[#344447] bg-white dark:bg-[#192629] px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-[#D8DEDC] hover:bg-slate-50 dark:hover:bg-[#2D4245]"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 text-teal-600 dark:text-[#7CB0A6]" />
                          Record Manual External Send
                        </button>
                        <button
                          onClick={() => handleCancel(selected)}
                          disabled={busyAction !== null}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-[#344447] bg-white dark:bg-[#192629] px-2.5 py-1.5 text-xs text-slate-600 dark:text-[#A1ADAA] hover:bg-slate-50 dark:hover:bg-[#2D4245]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
