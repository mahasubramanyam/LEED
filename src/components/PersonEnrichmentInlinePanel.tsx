import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { PersonEnrichmentPreviewResponse } from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface PersonEnrichmentInlinePanelProps {
  personId: string;
  leadId?: string;
  onApplied: () => void;
}

export const PersonEnrichmentInlinePanel: React.FC<PersonEnrichmentInlinePanelProps> = ({
  personId,
  leadId,
  onApplied,
}) => {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState<PersonEnrichmentPreviewResponse | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  const handleRunPreview = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch(`/api/enrichment/person/${encodeURIComponent(personId)}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Decision-maker enrichment preview failed.');
      const typed = json as PersonEnrichmentPreviewResponse;
      setPreview(typed);
      const defaults = new Set<string>();
      for (const p of typed.proposals) {
        if (p.defaultSelected && !p.isConflict) defaults.add(p.field);
      }
      setSelectedFields(defaults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!preview) return;
    setApplying(true);
    setError(null);
    try {
      const approvedProposals = preview.proposals.filter(
        (p) => !p.isConflict && selectedFields.has(p.field)
      );
      const res = await apiFetch(`/api/enrichment/person/${encodeURIComponent(personId)}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedProposals,
          emailVerification: preview.emailVerification,
          phoneVerification: preview.phoneVerification,
          providerRuns: preview.providerRuns,
          failedVerifications: preview.failedVerifications,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to apply person enrichment.');
      setSuccess(
        `Applied ${approvedProposals.length} approved update(s). Quality: ${json.historyEntry?.qualityScoreAfter ?? '—'}/100.`
      );
      setPreview(null);
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800/70 space-y-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
          Decision-Maker Enrichment &amp; Contact Verification
        </span>
        <button
          type="button"
          disabled={loading}
          onClick={handleRunPreview}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#B30303] hover:bg-[#910303] text-white font-semibold text-[11px] disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Checking...' : preview ? 'Re-Run Preview' : 'Run Preview'}
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <XCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {preview && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
            <span>
              Quality: <strong>{preview.qualityBefore.overallScore}</strong> ({preview.qualityBefore.grade}) →{' '}
              <strong>{preview.qualityProjectedAfter.overallScore}</strong> ({preview.qualityProjectedAfter.grade})
            </span>
            <button
              type="button"
              disabled={applying}
              onClick={handleApply}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
            >
              <Check className="w-3 h-3" />
              {applying ? 'Applying...' : `Approve & Apply (${selectedFields.size})`}
            </button>
          </div>

          {preview.emailVerification && (
            <div className="p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px]">
              <div className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1">
                <Mail className="w-3 h-3 text-blue-500" />
                Email: {preview.emailVerification.status}
              </div>
              <div className="text-slate-500 mt-0.5">{preview.emailVerification.honestSummary}</div>
            </div>
          )}

          {preview.phoneVerification && (
            <div className="p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px]">
              <div className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1">
                <Phone className="w-3 h-3 text-emerald-500" />
                Phone: {preview.phoneVerification.status} ({preview.phoneVerification.lineType})
              </div>
              <div className="text-slate-500 mt-0.5">{preview.phoneVerification.honestSummary}</div>
            </div>
          )}

          {preview.proposals.length > 0 ? (
            <div className="space-y-1">
              {preview.proposals.map((p) => (
                <label
                  key={p.field}
                  className="flex items-start gap-2 p-1.5 rounded bg-slate-50 dark:bg-slate-950/60 text-[11px] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    disabled={p.isConflict}
                    checked={selectedFields.has(p.field)}
                    onChange={() =>
                      setSelectedFields((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.field)) next.delete(p.field);
                        else next.add(p.field);
                        return next;
                      })
                    }
                    className="mt-0.5 rounded border-slate-300 text-blue-600"
                  />
                  <div>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{p.label}:</span>{' '}
                    <span className="text-slate-400">{p.currentValue || 'empty'}</span> →{' '}
                    <span className="font-medium text-slate-900 dark:text-white">{p.proposedValue}</span>{' '}
                    <span className="text-slate-400">({p.proposedSourceName})</span>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 italic">
              No additional profile attributes proposed; contact verification status can still be saved.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
