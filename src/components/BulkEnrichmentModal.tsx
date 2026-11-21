import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { CanonicalLead, CompanyEnrichmentPreviewResponse } from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface BulkEnrichmentModalProps {
  leadIds: string[];
  onClose: () => void;
  onCompleted: (updatedLeads: CanonicalLead[]) => void;
}

interface BulkPreviewPayload {
  totalRequested: number;
  processedCount: number;
  cappedAt: number;
  previews: CompanyEnrichmentPreviewResponse[];
  totalProposals: number;
  totalConflicts: number;
  averageQualityBefore: number;
  averageQualityProjected: number;
}

export const BulkEnrichmentModal: React.FC<BulkEnrichmentModalProps> = ({
  leadIds,
  onClose,
  onCompleted,
}) => {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BulkPreviewPayload | null>(null);
  const [selectedByLead, setSelectedByLead] = useState<Record<string, Set<string>>>({});

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch('/api/enrichment/company/bulk-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Bulk enrichment preview failed.');
        if (!active) return;
        const typed = json as BulkPreviewPayload;
        setData(typed);
        const initial: Record<string, Set<string>> = {};
        for (const p of typed.previews) {
          if (!p.leadId) continue;
          const s = new Set<string>();
          for (const prop of p.proposals) {
            if (prop.defaultSelected && !prop.isConflict) s.add(prop.field);
          }
          initial[p.leadId] = s;
        }
        setSelectedByLead(initial);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Bulk enrichment preview failed.');
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [leadIds]);

  const toggleField = (leadId: string, field: string) => {
    setSelectedByLead((prev) => {
      const next = new Set(prev[leadId] || []);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return { ...prev, [leadId]: next };
    });
  };

  const totalSelectedCount = Object.values(selectedByLead).reduce(
    (sum: number, s) => sum + (s as Set<string>).size,
    0
  );

  const handleApplyBulk = async () => {
    if (!data) return;
    setApplying(true);
    setError(null);
    try {
      const items = data.previews
        .filter((p) => p.leadId)
        .map((p) => {
          const chosen = selectedByLead[p.leadId!] || new Set<string>();
          const approvedProposals = p.proposals.filter(
            (prop) => !prop.isConflict && chosen.has(prop.field)
          );
          return {
            leadId: p.leadId!,
            approvedProposals,
            resolvedConflicts: [],
            emailVerification: p.emailVerification,
            phoneVerification: p.phoneVerification,
            websiteSummary: p.websiteSummary,
            providerRuns: p.providerRuns,
            failedVerifications: p.failedVerifications,
            allConflicts: p.conflicts,
          };
        })
        .filter(
          (item) =>
            item.approvedProposals.length > 0 ||
            item.emailVerification ||
            item.phoneVerification
        );

      const res = await apiFetch('/api/enrichment/company/bulk-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to apply bulk enrichment.');
      onCompleted(json.updatedLeads || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply bulk enrichment.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#240202]/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#440303] border border-[#E4DADA] dark:border-[#7A1E1E] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#7A1E1E] bg-gradient-to-r from-[#440303] via-[#690303] to-[#910303]">
          <div>
            <h2 className="text-base font-extrabold text-white flex items-center gap-2 tracking-tight">
              <ShieldCheck className="w-5 h-5 text-[#FFE2E1]" />
              Bulk Enrichment Preview &amp; Approval
            </h2>
            <p className="text-xs font-medium text-[#F5DADA]">
              Bounded preview (max 20 leads per run). Conflicts are never auto-overwritten.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bulk enrichment modal"
            className="p-1.5 rounded-lg hover:bg-white/15 text-[#F5DADA] hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-12 text-center space-y-2">
              <RefreshCw className="w-6 h-6 text-[#B30303] dark:text-[#FF9492] animate-spin mx-auto" />
              <div className="text-sm font-semibold text-[#240202] dark:text-[#FAF4F4]">
                Running multi-source enrichment preview on {Math.min(leadIds.length, 20)} selected lead(s)...
              </div>
              <div className="text-xs font-medium text-[#543F3F] dark:text-[#DEC2C2]">No CRM data will be modified until you explicitly approve.</div>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl border border-[#E52825]/60 bg-[#FFF1F1] dark:bg-[#2A0303] text-sm font-medium text-[#910303] dark:text-[#FFE0DF] flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : data ? (
            <>
              {data.totalRequested > data.cappedAt && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    You selected {data.totalRequested} leads. Bounded batch safety capped this preview at the first {data.cappedAt} leads.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#240202]/70 p-3">
                  <div className="text-[11px] font-semibold text-[#543F3F] dark:text-[#DEC2C2]">Processed Leads</div>
                  <div className="text-lg font-extrabold text-[#240202] dark:text-white tabular-nums">{data.processedCount}</div>
                </div>
                <div className="rounded-xl border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#240202]/70 p-3">
                  <div className="text-[11px] font-semibold text-[#543F3F] dark:text-[#DEC2C2]">Avg Quality Score</div>
                  <div className="text-lg font-extrabold text-[#910303] dark:text-[#FF9492] tabular-nums">
                    {data.averageQualityBefore} → {data.averageQualityProjected}
                  </div>
                </div>
                <div className="rounded-xl border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#240202]/70 p-3">
                  <div className="text-[11px] font-semibold text-[#543F3F] dark:text-[#DEC2C2]">Proposed Updates</div>
                  <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">{data.totalProposals}</div>
                </div>
                <div className="rounded-xl border border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#240202]/70 p-3">
                  <div className="text-[11px] font-semibold text-[#543F3F] dark:text-[#DEC2C2]">Conflicts Held Back</div>
                  <div className="text-lg font-extrabold text-[#CE0404] dark:text-[#FF8A87] tabular-nums">{data.totalConflicts}</div>
                </div>
              </div>

              <div className="space-y-3">
                {data.previews.map((p) => {
                  const safeProposals = p.proposals.filter((prop) => !prop.isConflict);
                  const chosen = p.leadId ? selectedByLead[p.leadId] || new Set<string>() : new Set<string>();
                  return (
                    <div
                      key={p.leadId || p.companyName}
                      className="rounded-xl border border-[#E4DADA] dark:border-[#7A1E1E] bg-white dark:bg-[#240202]/60 p-3.5 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-bold text-[#240202] dark:text-white">
                            {p.companyName}
                          </div>
                          <div className="text-[11px] font-medium text-[#543F3F] dark:text-[#DEC2C2]">
                            Quality: {p.qualityBefore.overallScore} ({p.qualityBefore.grade}) →{' '}
                            {p.qualityProjectedAfter.overallScore} ({p.qualityProjectedAfter.grade})
                            {p.conflicts.length > 0 && (
                              <span className="ml-2 text-[#CE0404] dark:text-[#FF9492] font-semibold">
                                · {p.conflicts.length} conflict(s) require individual review
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-xs font-mono font-semibold text-[#543F3F] dark:text-[#DEC2C2]">
                          {chosen.size} / {safeProposals.length} selected
                        </span>
                      </div>

                      {safeProposals.length > 0 ? (
                        <div className="divide-y divide-[#EFE8E8] dark:divide-[#690303] border-t border-[#EFE8E8] dark:border-[#690303] pt-1">
                          {safeProposals.map((prop) => (
                            <label
                              key={prop.field}
                              className="flex items-start gap-2.5 py-1.5 text-xs cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={chosen.has(prop.field)}
                                onChange={() => p.leadId && toggleField(p.leadId, prop.field)}
                                className="mt-0.5 rounded border-[#D4C2C2] dark:border-[#8C2828] accent-[#B30303]"
                              />
                              <div className="flex-1 min-w-0">
                                <span className="font-semibold text-[#440303] dark:text-[#FAF4F4]">
                                  {prop.label}:
                                </span>{' '}
                                <span className="text-[#6B5454] dark:text-[#C9A7A7]">{prop.currentValue || 'empty'}</span> →{' '}
                                <span className="font-bold text-[#240202] dark:text-white">
                                  {prop.proposedValue}
                                </span>{' '}
                                <span className="text-[11px] text-[#543F3F] dark:text-[#C9A7A7]">({prop.proposedSourceName})</span>
                              </div>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-[#543F3F] dark:text-[#C9A7A7] italic">
                          No safe non-conflicting attribute additions found (contact verification metadata still recorded if run).
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#E4DADA] dark:border-[#7A1E1E] bg-[#FAF7F7] dark:bg-[#240202]/70">
          <div className="text-xs font-medium text-[#543F3F] dark:text-[#DEC2C2]">
            Selected field updates across batch: <strong className="font-bold text-[#240202] dark:text-white">{totalSelectedCount}</strong>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-[#D4C2C2] dark:border-[#8C2828] bg-white dark:bg-[#440303] text-[#440303] dark:text-[#FAF4F4] hover:border-[#910303] hover:bg-[#FDF6F6] dark:hover:bg-[#690303] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading || applying || !data}
              onClick={handleApplyBulk}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-[#B30303] hover:bg-[#910303] text-white shadow-xs disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {applying ? 'Applying Approved Batch...' : 'Approve & Apply Enrichment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
