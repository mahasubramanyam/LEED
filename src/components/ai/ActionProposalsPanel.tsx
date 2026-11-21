import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Clock,
  AlertTriangle,
  Building2,
} from 'lucide-react';
import type { AiActionProposal } from '../../types.ts';
import { apiFetch } from '../../utils/apiFetch.ts';

interface ActionProposalsPanelProps {
  proposals: AiActionProposal[];
  onRefresh: () => Promise<void>;
  onDataMutated?: () => void;
  onOpenCompany?: (leadId: string) => void;
}

export const ActionProposalsPanel: React.FC<ActionProposalsPanelProps> = ({
  proposals,
  onRefresh,
  onDataMutated,
  onOpenCompany,
}) => {
  const [filter, setFilter] = useState<'pending_approval' | 'all' | 'approved_executed' | 'rejected'>('pending_approval');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const visible = filter === 'all' ? proposals : proposals.filter((p) => p.status === filter);
  const pendingCount = proposals.filter((p) => p.status === 'pending_approval').length;

  const handleApprove = async (id: string) => {
    setBusyId(id);
    setErrorMsg(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/ai/actions/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to execute action.');
      setNotice(data.summary || 'Approved action executed in CRM.');
      await onRefresh();
      onDataMutated?.();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusyId(id);
    setErrorMsg(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/ai/actions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Rejected by owner in Approval Queue' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reject action.');
      setNotice('Proposal rejected. No CRM record was modified.');
      await onRefresh();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            Owner Approval Queue ({pendingCount} Pending)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            The AI Sales Agent never modifies CRM records automatically. Every proposed task, opportunity, review, or status change executes only after your explicit approval.
          </p>
        </div>
        <div className="flex items-center gap-1 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5 text-xs shrink-0">
          {([
            ['pending_approval', `Pending (${pendingCount})`],
            ['approved_executed', 'Approved'],
            ['rejected', 'Rejected'],
            ['all', 'All'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-2.5 py-1 rounded-md font-medium ${
                filter === key
                  ? 'bg-[#910303] text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-500">
          No action proposals in this view. Generate a Company Sales Intelligence report or ask the AI Sales Agent to suggest next actions.
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {visible.map((item) => (
            <div key={item.id} className="py-4 space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-900 dark:text-white">{item.title}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      {item.actionType}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span
                      className={
                        item.status === 'pending_approval'
                          ? 'text-amber-600 dark:text-amber-400 font-medium'
                          : item.status === 'approved_executed'
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : 'text-slate-500 font-medium'
                      }
                    >
                      {item.status === 'pending_approval'
                        ? 'Awaiting Owner Approval'
                        : item.status === 'approved_executed'
                          ? 'Approved & Executed'
                          : 'Rejected'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {item.affectedEntity.entityType === 'company' && item.affectedEntity.entityId && onOpenCompany ? (
                      <button
                        onClick={() => onOpenCompany(item.affectedEntity.entityId!)}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {item.affectedEntity.entityName}
                      </button>
                    ) : (
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {item.affectedEntity.entityName}
                      </span>
                    )}
                    <span className="text-slate-400">·</span>
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span className="tabular-nums">{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">{item.rationale}</p>
                </div>

                {item.status === 'pending_approval' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleApprove(item.id)}
                      disabled={busyId === item.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {busyId === item.id ? 'Executing...' : 'Approve & Execute'}
                    </button>
                    <button
                      onClick={() => handleReject(item.id)}
                      disabled={busyId === item.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                )}
              </div>

              {/* Proposed Changes Preview */}
              {Object.keys(item.proposedChanges || {}).length > 0 && (
                <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto">
                  {Object.entries(item.proposedChanges)
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                    .join('  |  ')}
                </div>
              )}

              {item.executionSummary && (
                <div className="text-xs text-emerald-700 dark:text-emerald-400">
                  Executed: {item.executionSummary}
                </div>
              )}
              {item.rejectionReason && (
                <div className="text-xs text-slate-500">
                  Rejection note: {item.rejectionReason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
