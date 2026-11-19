import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  History,
  Mail,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Check,
  XCircle,
} from 'lucide-react';
import {
  CanonicalLead,
  CompanyEnrichmentPreviewResponse,
  DataQualityScoreBreakdown,
  EmailVerificationResult,
  EnrichmentConflictRecord,
  EnrichmentHistoryEntry,
  PhoneVerificationResult,
} from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';

interface LeadEnrichmentPanelProps {
  lead: CanonicalLead;
  mode?: 'crm' | 'candidate';
  onLeadUpdated?: (updatedLead: CanonicalLead) => void;
}

function gradeBadgeClasses(grade: DataQualityScoreBreakdown['grade']) {
  switch (grade) {
    case 'A':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60';
    case 'B':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/60';
    case 'C':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60';
    case 'D':
      return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/60';
    default:
      return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60';
  }
}

function verificationLabelBadge(label: string) {
  switch (label) {
    case 'officially_verified':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300';
    case 'multi_source_verified':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300';
    case 'source_reported':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
    case 'conflicting':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300';
    case 'ai_extracted':
    case 'inferred':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300';
    default:
      return 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300';
  }
}

export const LeadEnrichmentPanel: React.FC<LeadEnrichmentPanelProps> = ({
  lead,
  mode = 'crm',
  onLeadUpdated,
}) => {
  const [quality, setQuality] = useState<DataQualityScoreBreakdown | null>(null);
  const [savedEmailMeta, setSavedEmailMeta] = useState<EmailVerificationResult | null>(null);
  const [savedPhoneMeta, setSavedPhoneMeta] = useState<PhoneVerificationResult | null>(null);
  const [savedConflicts, setSavedConflicts] = useState<EnrichmentConflictRecord[]>([]);
  const [history, setHistory] = useState<EnrichmentHistoryEntry[]>([]);
  const [loadingQuality, setLoadingQuality] = useState(false);

  const [preview, setPreview] = useState<CompanyEnrichmentPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Enrichment execution options
  const [includeRegistry, setIncludeRegistry] = useState(true);
  const [includeWebsite, setIncludeWebsite] = useState(true);
  const [includeEmailCheck, setIncludeEmailCheck] = useState(true);
  const [includePhoneCheck, setIncludePhoneCheck] = useState(true);
  const [includeAiAssist, setIncludeAiAssist] = useState(false);

  // Owner selective approval state
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [conflictDecisions, setConflictDecisions] = useState<
    Record<string, 'kept_existing' | 'accepted_incoming'>
  >({});

  // Inline contact verification states
  const [verifyingContact, setVerifyingContact] = useState<'email' | 'phone' | null>(null);

  const loadQualitySnapshot = useCallback(async () => {
    if (mode !== 'crm' || !lead.id) return;
    setLoadingQuality(true);
    try {
      const res = await apiFetch(`/api/enrichment/company/${encodeURIComponent(lead.id)}/quality`);
      if (res.ok) {
        const data = await res.json();
        setQuality(data.quality || null);
        setSavedEmailMeta(data.emailVerification || null);
        setSavedPhoneMeta(data.phoneVerification || null);
        setSavedConflicts(Array.isArray(data.conflicts) ? data.conflicts : []);
        setHistory(Array.isArray(data.history) ? data.history : []);
      }
    } catch {
      // Non-blocking snapshot error
    } finally {
      setLoadingQuality(false);
    }
  }, [lead.id, mode]);

  useEffect(() => {
    setPreview(null);
    setErrorMsg(null);
    setSuccessMsg(null);
    setSelectedFields(new Set());
    setConflictDecisions({});
    loadQualitySnapshot();
  }, [lead.id, loadQualitySnapshot]);

  const handleRunPreview = async () => {
    setIsPreviewLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const payload =
        mode === 'crm'
          ? {
              leadId: lead.id,
              runRegistryVerification: includeRegistry,
              runWebsiteInspection: includeWebsite,
              runEmailVerification: includeEmailCheck,
              runPhoneVerification: includePhoneCheck,
              runAiAssistance: includeAiAssist,
            }
          : {
              candidateLead: lead,
              runRegistryVerification: includeRegistry,
              runWebsiteInspection: includeWebsite,
              runEmailVerification: includeEmailCheck,
              runPhoneVerification: includePhoneCheck,
              runAiAssistance: includeAiAssist,
            };

      const res = await apiFetch('/api/enrichment/company/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Enrichment preview failed.');
      }

      const typed = data as CompanyEnrichmentPreviewResponse;
      setPreview(typed);
      setQuality(typed.qualityBefore);
      if (typed.emailVerification) setSavedEmailMeta(typed.emailVerification);
      if (typed.phoneVerification) setSavedPhoneMeta(typed.phoneVerification);

      // Only pre-select non-conflicting proposals that the engine marked safe by default
      const defaults = new Set<string>();
      for (const p of typed.proposals) {
        if (p.defaultSelected && !p.isConflict) {
          defaults.add(p.field);
        }
      }
      setSelectedFields(defaults);
      setConflictDecisions({});
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Enrichment preview failed.');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleInlineContactVerify = async (type: 'email' | 'phone') => {
    const value = type === 'email' ? lead.email : lead.phoneNormalized || lead.phone;
    if (!value) return;
    setVerifyingContact(type);
    setErrorMsg(null);
    try {
      const res = await apiFetch('/api/enrichment/contact/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          value,
          companyDomain: lead.domain,
          countryCode: lead.address?.countryCode || 'US',
          existingPhoneNormalized: lead.phoneNormalized,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to verify ${type}.`);
      if (type === 'email') setSavedEmailMeta(data.result);
      else setSavedPhoneMeta(data.result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `Failed to verify ${type}.`);
    } finally {
      setVerifyingContact(null);
    }
  };

  const handleApplyApproved = async () => {
    if (!preview || mode !== 'crm') return;
    setIsApplying(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const approvedProposals = preview.proposals.filter((p) => {
        if (!p.isConflict) return selectedFields.has(p.field);
        const matchingConflict = preview.conflicts.find(
          (c) => c.field === p.field && c.incomingValue === p.proposedValue
        );
        if (matchingConflict && conflictDecisions[matchingConflict.id] === 'accepted_incoming') {
          return true;
        }
        return selectedFields.has(p.field);
      });

      const resolvedConflicts = Object.entries(conflictDecisions).map(([conflictId, resolution]) => ({
        conflictId,
        resolution,
      }));

      const res = await apiFetch(`/api/enrichment/company/${encodeURIComponent(lead.id)}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedProposals,
          resolvedConflicts,
          emailVerification: preview.emailVerification || savedEmailMeta || undefined,
          phoneVerification: preview.phoneVerification || savedPhoneMeta || undefined,
          websiteSummary: preview.websiteSummary,
          providerRuns: preview.providerRuns,
          failedVerifications: preview.failedVerifications,
          allConflicts: preview.conflicts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply approved enrichment.');

      setQuality(data.qualityAfter);
      setSuccessMsg(
        `Applied ${approvedProposals.length} approved field update${approvedProposals.length === 1 ? '' : 's'} and ${resolvedConflicts.length} conflict decision${resolvedConflicts.length === 1 ? '' : 's'}. Data Quality is now ${data.qualityAfter?.overallScore ?? '—'}/100.`
      );
      setPreview(null);
      if (onLeadUpdated && data.lead) {
        onLeadUpdated(data.lead);
      }
      await loadQualitySnapshot();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to apply approved enrichment.');
    } finally {
      setIsApplying(false);
    }
  };

  const activeQuality = preview ? preview.qualityBefore : quality;
  const activeEmailMeta = preview?.emailVerification || savedEmailMeta;
  const activePhoneMeta = preview?.phoneVerification || savedPhoneMeta;
  const openConflicts = (preview ? preview.conflicts : savedConflicts).filter((c) => c.status === 'open');

  return (
    <div className="space-y-5">
      {/* Header Action Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Enrichment, Contact Verification &amp; Data Quality
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Multi-source verification preview with attribute provenance, conflict precedence, and explicit owner approval.
            </p>
          </div>
          <button
            type="button"
            disabled={isPreviewLoading}
            onClick={handleRunPreview}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isPreviewLoading ? 'animate-spin' : ''}`} />
            {isPreviewLoading ? 'Running Multi-Source Preview...' : 'Run Enrichment Preview'}
          </button>
        </div>

        {/* Source Toggles */}
        <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-600 dark:text-slate-300">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeRegistry}
              onChange={(e) => setIncludeRegistry(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            Official Registry
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeWebsite}
              onChange={(e) => setIncludeWebsite(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            Website &amp; Domain Intel
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeEmailCheck}
              onChange={(e) => setIncludeEmailCheck(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            Email DNS/MX &amp; API
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includePhoneCheck}
              onChange={(e) => setIncludePhoneCheck(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            Phone E.164 &amp; Carrier
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeAiAssist}
              onChange={(e) => setIncludeAiAssist(e.target.checked)}
              className="rounded border-slate-300 text-purple-600"
            />
            <span className="inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-purple-500" />
              AI Evidence Assist (Inferred)
            </span>
          </label>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* 4-Dimension Data Quality Score Breakdown */}
      {loadingQuality && !activeQuality ? (
        <div className="text-xs text-slate-500 py-4 text-center">Evaluating record data quality...</div>
      ) : activeQuality ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className={`px-2.5 py-1 rounded-md border text-xs font-bold ${gradeBadgeClasses(activeQuality.grade)}`}
              >
                Grade {activeQuality.grade}
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Data Quality Score: {activeQuality.overallScore}/100
                  {preview && (
                    <span className="ml-2 text-xs font-normal text-blue-600 dark:text-blue-400">
                      → Projected {preview.qualityProjectedAfter.overallScore}/100 (Grade {preview.qualityProjectedAfter.grade})
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Duplicate Risk: <span className="font-medium capitalize">{activeQuality.duplicateRisk}</span>
                  {' · '}
                  Re-Verification: <span className="font-medium">{activeQuality.reverificationEligible ? 'Recommended' : 'Current'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Separate Dimension Bars */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Completeness', value: activeQuality.completenessScore, color: 'bg-blue-500' },
              { label: 'Verification', value: activeQuality.verificationScore, color: 'bg-emerald-500' },
              { label: 'Freshness', value: activeQuality.freshnessScore, color: 'bg-indigo-500' },
            ].map((dim) => (
              <div
                key={dim.label}
                className="rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 p-2.5"
              >
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-600 dark:text-slate-400">{dim.label}</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">{dim.value}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div className={`h-full ${dim.color}`} style={{ width: `${Math.min(100, dim.value)}%` }} />
                </div>
              </div>
            ))}
          </div>

          {activeQuality.verificationCapApplied && (
            <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Verification Cap Applied:</strong> {activeQuality.verificationCapReason}
              </span>
            </div>
          )}

          {/* Missing Critical & Stale Attributes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div className="font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
                Missing Critical Fields ({activeQuality.missingCriticalFields.length})
              </div>
              {activeQuality.missingCriticalFields.length === 0 ? (
                <div className="text-emerald-600 dark:text-emerald-400">All critical company attributes populated.</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {activeQuality.missingCriticalFields.map((f) => (
                    <span
                      key={f}
                      className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[11px]"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div className="font-semibold text-slate-700 dark:text-slate-200 mb-1.5 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                Freshness &amp; Stale Indicators ({activeQuality.staleAttributes.length})
              </div>
              {activeQuality.staleAttributes.length === 0 ? (
                <div className="text-emerald-600 dark:text-emerald-400">No stale attributes detected.</div>
              ) : (
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {activeQuality.staleAttributes.map((st) => (
                    <div key={st.attribute} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-700 dark:text-slate-300">{st.label}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-medium ${
                          st.status === 'stale'
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                        }`}
                      >
                        {st.status === 'never_verified'
                          ? 'Never verified'
                          : `${st.ageDays}d / ${st.maxAgeDays}d max`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Inline Contact Verification Cards (Email & Phone) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-blue-500" />
              Business Email Verification
            </div>
            {lead.email && (
              <button
                type="button"
                disabled={verifyingContact === 'email'}
                onClick={() => handleInlineContactVerify('email')}
                className="text-[11px] font-medium px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {verifyingContact === 'email' ? 'Checking...' : 'Verify Email'}
              </button>
            )}
          </div>
          <div className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate">
            {lead.email || 'No business email recorded'}
          </div>
          {activeEmailMeta ? (
            <div className="space-y-1.5 pt-1 text-[11px]">
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-medium">
                  Status: {activeEmailMeta.status}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                  MX: {activeEmailMeta.mxRecordsPresent ? 'Yes' : 'No'}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                  SPF: {activeEmailMeta.spfPresent ? 'Yes' : 'No'}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                  DMARC: {activeEmailMeta.dmarcPresent ? 'Yes' : 'No'}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{activeEmailMeta.honestSummary}</p>
              {activeEmailMeta.warnings.length > 0 && (
                <div className="text-amber-700 dark:text-amber-400">{activeEmailMeta.warnings.join(' ')}</div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">Run verification to inspect DNS MX/SPF/DMARC or authorized verifier status.</div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-emerald-500" />
              Business Phone Verification
            </div>
            {(lead.phone || lead.phoneNormalized) && (
              <button
                type="button"
                disabled={verifyingContact === 'phone'}
                onClick={() => handleInlineContactVerify('phone')}
                className="text-[11px] font-medium px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                {verifyingContact === 'phone' ? 'Checking...' : 'Verify Phone'}
              </button>
            )}
          </div>
          <div className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate">
            {lead.phoneNormalized || lead.phone || 'No business phone recorded'}
          </div>
          {activePhoneMeta ? (
            <div className="space-y-1.5 pt-1 text-[11px]">
              <div className="flex flex-wrap gap-1.5">
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-medium">
                  Status: {activePhoneMeta.status}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                  Line: {activePhoneMeta.lineType} ({activePhoneMeta.lineTypeBasis})
                </span>
                {activePhoneMeta.carrier && (
                  <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300">
                    Carrier: {activePhoneMeta.carrier}
                  </span>
                )}
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{activePhoneMeta.honestSummary}</p>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">Run verification to validate E.164 international format and optional carrier lookup.</div>
          )}
        </div>
      </div>

      {/* Preview Results: Provider Runs, Proposals & Conflicts */}
      {preview && (
        <div className="space-y-4 rounded-xl border-2 border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                Enrichment Preview — Explicit Owner Approval Required
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {preview.proposals.length} proposed attribute update(s), {preview.conflicts.length} conflict(s) detected in {preview.durationMs}ms.
              </p>
            </div>
            {mode === 'crm' ? (
              <button
                type="button"
                disabled={isApplying}
                onClick={handleApplyApproved}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                {isApplying ? 'Applying Updates...' : `Apply Approved (${selectedFields.size + Object.keys(conflictDecisions).length})`}
              </button>
            ) : (
              <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                Save candidate to CRM to persist enrichment updates.
              </span>
            )}
          </div>

          {/* Provider Execution Strip */}
          <div className="flex flex-wrap gap-2">
            {preview.providerRuns.map((run) => (
              <div
                key={`${run.providerId}-${run.providerName}`}
                className="text-[11px] px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center gap-1.5"
                title={run.message}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    run.status === 'success'
                      ? 'bg-emerald-500'
                      : run.status === 'skipped_missing_credentials'
                      ? 'bg-amber-400'
                      : run.status === 'error' || run.status === 'timeout' || run.status === 'rate_limited'
                      ? 'bg-rose-500'
                      : 'bg-slate-400'
                  }`}
                />
                <span className="font-medium text-slate-700 dark:text-slate-200">{run.providerName}</span>
                <span className="text-slate-400">({run.status.replace(/_/g, ' ')})</span>
              </div>
            ))}
          </div>

          {preview.failedVerifications.length > 0 && (
            <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
              <strong>Existing Verified Data Preserved:</strong>{' '}
              {preview.failedVerifications.map((f) => `${f.provider}: ${f.reason}`).join(' | ')}
            </div>
          )}

          {/* Website Intelligence Summary */}
          {preview.websiteSummary && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 text-xs space-y-1.5">
              <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-500" />
                Domain &amp; Website Verification ({preview.websiteSummary.canonicalDomain || preview.websiteSummary.url})
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                <span>Status: {preview.websiteSummary.isOnline ? 'Online' : 'Offline'}</span>
                {typeof preview.websiteSummary.companyIdentityConsistent === 'boolean' && (
                  <span>
                    Identity Match: {preview.websiteSummary.companyIdentityConsistent ? 'Consistent' : 'Review recommended'}
                  </span>
                )}
                {preview.websiteSummary.certificationsFound && preview.websiteSummary.certificationsFound.length > 0 && (
                  <span>Certifications: {preview.websiteSummary.certificationsFound.join(', ')}</span>
                )}
                {preview.websiteSummary.careersPageUrl && (
                  <span>Careers Page Detected</span>
                )}
              </div>
            </div>
          )}

          {/* Field-by-Field Selective Approval Table */}
          {preview.proposals.filter((p) => !p.isConflict).length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="py-2 px-3 w-8">Apply</th>
                    <th className="py-2 px-3">Attribute</th>
                    <th className="py-2 px-3">Current Value</th>
                    <th className="py-2 px-3">Proposed Value &amp; Source</th>
                    <th className="py-2 px-3">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {preview.proposals
                    .filter((p) => !p.isConflict)
                    .map((p) => {
                      const checked = selectedFields.has(p.field);
                      return (
                        <tr key={p.field} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedFields((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(p.field)) next.delete(p.field);
                                  else next.add(p.field);
                                  return next;
                                });
                              }}
                              className="rounded border-slate-300 text-blue-600"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200">
                            {p.label}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 max-w-[160px] truncate">
                            {p.currentValue || <span className="italic text-slate-400">Empty</span>}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900 dark:text-white break-words">
                              {p.proposedValue}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Source: {p.proposedSourceName}
                              {p.corroboratingSources.length > 0 && (
                                <span className="ml-1 text-blue-600 dark:text-blue-400">
                                  (+{p.corroboratingSources.length} corroborating)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${verificationLabelBadge(p.verificationLabel)}`}
                            >
                              {p.verificationLabel.replace(/_/g, ' ')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              No non-conflicting missing or stronger attribute updates found in this preview.
            </div>
          )}

          {/* AI Assistance Panel (Strictly Labeled Inferred) */}
          {preview.aiAssistance && (
            <div className="rounded-lg border border-purple-200 dark:border-purple-900/60 bg-purple-50/40 dark:bg-purple-950/20 p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  AI Evidence Analysis ({preview.aiAssistance.engine})
                </span>
                <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200 text-[10px] font-bold uppercase">
                  {preview.aiAssistance.provenanceType} — Not Verified Fact
                </span>
              </div>
              <p className="text-slate-700 dark:text-slate-300">{preview.aiAssistance.summary}</p>
              {preview.aiAssistance.missingDataRecommendations.length > 0 && (
                <ul className="list-disc pl-4 text-slate-600 dark:text-slate-400 space-y-0.5">
                  {preview.aiAssistance.missingDataRecommendations.map((rec, idx) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Conflict Resolution Panel */}
      {openConflicts.length > 0 && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/30 dark:bg-rose-950/15 p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-800 dark:text-rose-300">
            <AlertTriangle className="w-4 h-4" />
            Source Conflicts Requiring Owner Review ({openConflicts.length})
          </div>
          <div className="space-y-2.5">
            {openConflicts.map((c) => {
              const choice = conflictDecisions[c.id];
              return (
                <div
                  key={c.id}
                  className="rounded-lg border border-rose-200/80 dark:border-rose-900 bg-white dark:bg-slate-900 p-3 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white">{c.label}</span>
                    <span className="text-[11px] text-slate-500">
                      Recommended: <strong className="capitalize">{c.recommendedWinner.replace('_', ' ')}</strong>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="p-2 rounded bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <div className="text-[10px] uppercase text-slate-500">
                        Existing ({c.existingSourceName} · Precedence {c.existingPrecedenceScore})
                      </div>
                      <div className="font-medium text-slate-900 dark:text-white mt-0.5">{c.existingValue}</div>
                    </div>
                    <div className="p-2 rounded bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900">
                      <div className="text-[10px] uppercase text-blue-600 dark:text-blue-400">
                        Incoming ({c.incomingSourceName} · Precedence {c.incomingPrecedenceScore})
                      </div>
                      <div className="font-medium text-slate-900 dark:text-white mt-0.5">{c.incomingValue}</div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">{c.rationale}</p>
                  {preview && mode === 'crm' && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setConflictDecisions((prev) => ({ ...prev, [c.id]: 'kept_existing' }))
                        }
                        className={`px-2.5 py-1 rounded text-[11px] font-medium border ${
                          choice === 'kept_existing'
                            ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
                            : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        Keep Existing
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConflictDecisions((prev) => ({ ...prev, [c.id]: 'accepted_incoming' }))
                        }
                        className={`px-2.5 py-1 rounded text-[11px] font-medium border ${
                          choice === 'accepted_incoming'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        Accept Incoming
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Enrichment History & Audit Trail */}
      {mode === 'crm' && history.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <History className="w-3.5 h-3.5 text-slate-500" />
            Enrichment &amp; Verification History ({history.length})
          </div>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {history.map((h) => (
              <div
                key={h.id}
                className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 text-xs space-y-1"
              >
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-700 dark:text-slate-200 capitalize">
                    {h.action.replace(/_/g, ' ')} by {h.actor}
                  </span>
                  <span>{new Date(h.timestamp).toLocaleString()}</span>
                </div>
                {typeof h.qualityScoreBefore === 'number' && typeof h.qualityScoreAfter === 'number' && (
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    Quality Score: {h.qualityScoreBefore} → {h.qualityScoreAfter}/100
                  </div>
                )}
                {h.fieldsUpdated.length > 0 && (
                  <div className="space-y-0.5 text-[11px]">
                    {h.fieldsUpdated.map((fu, idx) => (
                      <div key={idx} className="text-slate-700 dark:text-slate-300">
                        <span className="font-mono">{fu.field}</span>:{' '}
                        <span className="line-through text-slate-400">{fu.previousValue || 'empty'}</span>{' '}
                        → <span className="font-medium">{fu.newValue}</span>{' '}
                        <span className="text-slate-400">({fu.newSource})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
