import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Download,
  RefreshCw,
  Filter,
  Sparkles,
  FileSpreadsheet,
  Bookmark,
  Trash2,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Globe2,
  Building2,
  Target,
  Activity,
  Info,
} from 'lucide-react';
import type {
  BiAiInsightResponse,
  BiAnalyticsFilter,
  BiDashboardResponse,
  BiGeneratedReport,
  BiSavedReportConfig,
} from '../../shared/biWorkflowTypes.ts';
import {
  BI_AI_ANALYSIS_MODES,
  BI_REPORT_TYPES,
  type BiAiAnalysisMode,
  type BiReportType,
} from '../../shared/biWorkflowSpecs.ts';
import type { CanonicalLead, PipelineStage } from '../types.ts';
import { apiFetch } from '../utils/apiFetch.ts';

type BiSubTab = 'dashboard' | 'advanced' | 'reports' | 'ai_insights';

interface BiAnalyticsWorkspaceProps {
  leads: CanonicalLead[];
  stages: PipelineStage[];
  onSelectLead: (lead: CanonicalLead) => void;
  onOpenPersonProfile?: (personId: string) => void;
  onNavigateToWorkflows?: () => void;
}

const PROVENANCE_LABEL: Record<string, string> = {
  provider_confirmed: 'Provider-Confirmed',
  manual_owner_recorded: 'Manual Owner-Recorded',
  system_calculated: 'System Calculated',
};

function buildFilterQuery(filters: BiAnalyticsFilter): string {
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.country) params.set('country', filters.country);
  if (filters.industry) params.set('industry', filters.industry);
  if (filters.source) params.set('source', filters.source);
  if (filters.stageId) params.set('stageId', filters.stageId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function formatCurrencyTotals(totals: Array<{ currency: string; totalValue: number }>): string {
  if (!totals || totals.length === 0) return '—';
  return totals
    .map((t) => `${t.currency} ${Math.round(t.totalValue).toLocaleString()}`)
    .join(' · ');
}

export const BiAnalyticsWorkspace: React.FC<BiAnalyticsWorkspaceProps> = ({
  leads,
  stages,
  onSelectLead,
  onOpenPersonProfile,
  onNavigateToWorkflows,
}) => {
  const [subTab, setSubTab] = useState<BiSubTab>('dashboard');
  const [filters, setFilters] = useState<BiAnalyticsFilter>({});
  const [dashboard, setDashboard] = useState<BiDashboardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Reports state
  const [selectedReportType, setSelectedReportType] = useState<BiReportType>('executive_overview');
  const [generatedReport, setGeneratedReport] = useState<BiGeneratedReport | null>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [savedReports, setSavedReports] = useState<BiSavedReportConfig[]>([]);
  const [saveReportName, setSaveReportName] = useState<string>('');
  const [saveReportDesc, setSaveReportDesc] = useState<string>('');
  const [exportingCsv, setExportingCsv] = useState<boolean>(false);

  // AI BI Insights state
  const [aiMode, setAiMode] = useState<BiAiAnalysisMode>('analytics_explanation');
  const [aiQuestion, setAiQuestion] = useState<string>('');
  const [aiInsight, setAiInsight] = useState<BiAiInsightResponse | null>(null);
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  const filterOptions = useMemo(() => {
    const countries = Array.from(
      new Set(leads.map((l) => l.address?.countryCode || l.address?.country).filter(Boolean) as string[])
    ).sort();
    const industries = Array.from(
      new Set(leads.map((l) => l.industry).filter(Boolean) as string[])
    ).sort();
    const sources = Array.from(
      new Set(
        leads.flatMap((l) => (l.sources || []).map((s) => s.sourceName)).filter(Boolean)
      )
    ).sort();
    return { countries, industries, sources };
  }, [leads]);

  const fetchAnalytics = useCallback(async (activeFilters: BiAnalyticsFilter) => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildFilterQuery(activeFilters);
      const res = await apiFetch(`/api/bi/analytics${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: BiDashboardResponse = await res.json();
      setDashboard(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Business Intelligence analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSavedReports = useCallback(async () => {
    try {
      const res = await apiFetch('/api/bi/reports/saved');
      if (res.ok) {
        const data = await res.json();
        setSavedReports(data.savedReports || []);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchReport = useCallback(async (reportType: BiReportType, activeFilters: BiAnalyticsFilter) => {
    setReportLoading(true);
    try {
      const params = new URLSearchParams(buildFilterQuery(activeFilters).replace(/^\?/, ''));
      params.set('reportType', reportType);
      const res = await apiFetch(`/api/bi/reports/generate?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to generate report.');
      }
      const data = await res.json();
      setGeneratedReport(data.report);
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to generate report.' });
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalytics(filters);
  }, [fetchAnalytics, filters]);

  useEffect(() => {
    fetchSavedReports();
  }, [fetchSavedReports]);

  useEffect(() => {
    if (subTab === 'reports') {
      fetchReport(selectedReportType, filters);
    }
  }, [subTab, selectedReportType, filters, fetchReport]);

  const handleExportReportCsv = async () => {
    setExportingCsv(true);
    setNotice(null);
    try {
      const params = new URLSearchParams(buildFilterQuery(filters).replace(/^\?/, ''));
      params.set('reportType', selectedReportType);
      const res = await apiFetch(`/api/bi/reports/export/csv?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'CSV export failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leed_bi_${selectedReportType}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setNotice({ type: 'success', text: `Exported RFC 4180 CSV for ${selectedReportType.replace(/_/g, ' ')}.` });
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to export CSV.' });
    } finally {
      setExportingCsv(false);
    }
  };

  const handleSaveReportConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saveReportName.trim()) return;
    setNotice(null);
    try {
      const res = await apiFetch('/api/bi/reports/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveReportName.trim(),
          description: saveReportDesc.trim() || undefined,
          reportType: selectedReportType,
          filters,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save report configuration.');
      setSaveReportName('');
      setSaveReportDesc('');
      await fetchSavedReports();
      setNotice({ type: 'success', text: `Saved report configuration "${data.savedReport.name}".` });
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save report.' });
    }
  };

  const handleDeleteSavedReport = async (id: string) => {
    try {
      const res = await apiFetch(`/api/bi/reports/saved/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSavedReports((prev) => prev.filter((r) => r.id !== id));
      }
    } catch {
      // Ignore
    }
  };

  const handleRunAiAnalysis = async () => {
    setAiLoading(true);
    setNotice(null);
    try {
      const res = await apiFetch('/api/bi/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: aiMode,
          filters,
          question: aiQuestion.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI BI analysis failed.');
      setAiInsight(data.insights);
    } catch (err: unknown) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to generate AI BI insights.' });
    } finally {
      setAiLoading(false);
    }
  };

  const hasActiveFilters = Boolean(
    filters.dateFrom || filters.dateTo || filters.country || filters.industry || filters.source || filters.stageId
  );

  const openLeadById = (leadId: string) => {
    const found = leads.find((l) => l.id === leadId);
    if (found) onSelectLead(found);
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white tracking-tight">
            Business Intelligence &amp; Operational Reporting
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Live aggregates calculated strictly from LEED CRM, Pipeline, Enrichment, Outreach &amp; Workflow records
            {dashboard ? ` · Updated ${new Date(dashboard.generatedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-0.5">
            {[
              { id: 'dashboard', label: 'BI Dashboard', icon: BarChart3 },
              { id: 'advanced', label: 'Advanced Analytics', icon: Layers },
              { id: 'reports', label: 'Reports & CSV', icon: FileSpreadsheet },
              { id: 'ai_insights', label: 'AI Briefings', icon: Sparkles },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubTab(tab.id as BiSubTab)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    active
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => fetchAnalytics(filters)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Global Analytics Filter Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 mr-1 pb-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Filters</span>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">From Date</label>
            <input
              type="date"
              value={filters.dateFrom || ''}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined }))}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">To Date</label>
            <input
              type="date"
              value={filters.dateTo || ''}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || undefined }))}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex flex-col gap-1 min-w-[120px]">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Country</label>
            <select
              value={filters.country || ''}
              onChange={(e) => setFilters((f) => ({ ...f, country: e.target.value || undefined }))}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="">All Countries</option>
              {filterOptions.countries.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Industry</label>
            <select
              value={filters.industry || ''}
              onChange={(e) => setFilters((f) => ({ ...f, industry: e.target.value || undefined }))}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="">All Industries</option>
              {filterOptions.industries.map((ind) => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Source</label>
            <select
              value={filters.source || ''}
              onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value || undefined }))}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="">All Sources</option>
              {filterOptions.sources.map((src) => (
                <option key={src} value={src}>{src}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Pipeline Stage</label>
            <select
              value={filters.stageId || ''}
              onChange={(e) => setFilters((f) => ({ ...f, stageId: e.target.value || undefined }))}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
            >
              <option value="">All Stages</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => setFilters({})}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 rounded-lg"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-xs ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-xs underline ml-4">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3 text-xs text-red-700 dark:text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !dashboard && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center text-xs text-slate-500">
          Calculating live Business Intelligence metrics from LEED records...
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 1: EXECUTIVE BI DASHBOARD                                  */}
      {/* ================================================================== */}
      {dashboard && subTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Top KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Companies &amp; Decision-Makers</span>
                <Building2 className="w-4 h-4 text-slate-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {dashboard.leadIntelligence.totalCompanies.toLocaleString()}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  · {dashboard.leadIntelligence.totalDecisionMakers.toLocaleString()} DMs
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {dashboard.leadIntelligence.verifiedLeads} verified · {dashboard.leadIntelligence.unverifiedLeads} unverified · +{dashboard.leadIntelligence.newlyDiscoveredLeads} recent
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Sales Pipeline</span>
                <Target className="w-4 h-4 text-slate-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {dashboard.salesPipeline.openOpportunities}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  open · {dashboard.salesPipeline.wonOpportunities} won · {dashboard.salesPipeline.lostOpportunities} lost
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                {formatCurrencyTotals(dashboard.salesPipeline.openValuesByCurrency)}
                {dashboard.salesPipeline.winRatePercent !== null ? ` · ${dashboard.salesPipeline.winRatePercent}% win` : ''}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Outreach Execution</span>
                <Globe2 className="w-4 h-4 text-slate-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {dashboard.outreachAnalytics.totals.messagesSentViaProvider}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  provider-confirmed · {dashboard.outreachAnalytics.totals.messagesManualSent} manual
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {dashboard.outreachAnalytics.totals.repliesReceived} replies (manual) · {dashboard.outreachAnalytics.totals.meetingsScheduled} meetings
              </p>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Activity &amp; Workflows</span>
                <Activity className="w-4 h-4 text-slate-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {dashboard.activityAnalytics.tasksCompleted}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  tasks done · {dashboard.activityAnalytics.tasksOverdue} overdue
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>
                  {dashboard.workflowSummary.enabledWorkflows}/{dashboard.workflowSummary.totalWorkflows} workflows active
                </span>
                {onNavigateToWorkflows && (
                  <button
                    type="button"
                    onClick={onNavigateToWorkflows}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    Manage
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Section A: Lead Intelligence */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Lead Intelligence</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Avg Quality Score:{' '}
                  <span className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">
                    {dashboard.leadIntelligence.averageQualityScore !== null
                      ? `${dashboard.leadIntelligence.averageQualityScore}/100`
                      : 'N/A'}
                  </span>{' '}
                  · Verification Rate:{' '}
                  <span className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">
                    {dashboard.leadIntelligence.verificationRatePercent !== null
                      ? `${dashboard.leadIntelligence.verificationRatePercent}%`
                      : 'N/A'}
                  </span>{' '}
                  · Newly Discovered:{' '}
                  <span className="font-mono tabular-nums">
                    {dashboard.leadIntelligence.newlyDiscoveredLeads}
                  </span>
                </p>
              </div>
              <span className="text-[11px] text-slate-400">System Calculated · Live CRM</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* Quality Grade Distribution */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Quality Grade Distribution</h4>
                <div className="space-y-2">
                  {dashboard.leadIntelligence.qualityDistribution.map((q) => (
                    <div key={q.grade} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-300 font-medium">Grade {q.grade}</span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {q.count} ({q.percentage}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
                          style={{ width: `${Math.max(q.count > 0 ? 4 : 0, q.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* By Country */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Top Countries</h4>
                {dashboard.leadIntelligence.byCountry.length === 0 ? (
                  <p className="text-xs text-slate-400">No leads match current filter.</p>
                ) : (
                  <div className="space-y-1.5">
                    {dashboard.leadIntelligence.byCountry.slice(0, 6).map((item) => (
                      <div key={item.key} className="flex items-center justify-between text-xs">
                        <span className="text-slate-700 dark:text-slate-300 truncate pr-2">{item.label}</span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                          {item.count} · {item.percentage}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* By Industry */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Top Industries</h4>
                {dashboard.leadIntelligence.byIndustry.length === 0 ? (
                  <p className="text-xs text-slate-400">No industry records in scope.</p>
                ) : (
                  <div className="space-y-1.5">
                    {dashboard.leadIntelligence.byIndustry.slice(0, 6).map((item) => (
                      <div key={item.key} className="flex items-center justify-between text-xs">
                        <span className="text-slate-700 dark:text-slate-300 truncate pr-2">{item.label}</span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                          {item.count} · {item.percentage}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* By Source & Lifecycle */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Sources &amp; Lifecycle</h4>
                {dashboard.leadIntelligence.bySource.length === 0 ? (
                  <p className="text-xs text-slate-400">No sources recorded.</p>
                ) : (
                  <div className="space-y-1.5">
                    {dashboard.leadIntelligence.bySource.slice(0, 4).map((item) => (
                      <div key={item.key} className="flex items-center justify-between text-xs">
                        <span className="text-slate-700 dark:text-slate-300 truncate pr-2">{item.label}</span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                          {item.count}
                        </span>
                      </div>
                    ))}
                    <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
                      {dashboard.leadIntelligence.byLifecycleStage.slice(0, 4).map((st) => (
                        <div key={st.key} className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 dark:text-slate-400 capitalize">{st.label}</span>
                          <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">{st.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section B: Sales Pipeline & Velocity */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Sales Pipeline &amp; Stage Aging</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Data Source: <span className="font-mono">{dashboard.salesPipeline.dataSource}</span> · Open Value:{' '}
                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                    {formatCurrencyTotals(dashboard.salesPipeline.openValuesByCurrency)}
                  </span>{' '}
                  · Won Value:{' '}
                  <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatCurrencyTotals(dashboard.salesPipeline.wonValuesByCurrency)}
                  </span>
                </p>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {dashboard.salesPipeline.salesVelocity.available ? (
                  <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    Avg Cycle: {dashboard.salesPipeline.salesVelocity.averageCycleDays}d (n=
                    {dashboard.salesPipeline.salesVelocity.closedWonSampleSize}) ·{' '}
                    {dashboard.salesPipeline.salesVelocity.byCurrency
                      .map((v) =>
                        v.estimatedMonthlyVelocity !== null
                          ? `${v.currency} ${Math.round(v.estimatedMonthlyVelocity).toLocaleString()}/mo`
                          : `${v.currency} avg ${Math.round(v.averageDealValue).toLocaleString()}`
                      )
                      .join(' · ')}
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">
                    Sales velocity unavailable: {dashboard.salesPipeline.salesVelocity.insufficientDataReason}
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-4 font-medium">Stage</th>
                    <th className="py-2 px-3 font-medium text-right">Companies</th>
                    <th className="py-2 px-3 font-medium text-right">Opportunities</th>
                    <th className="py-2 px-3 font-medium">Value by Currency</th>
                    <th className="py-2 px-3 font-medium text-right">Stage Conversion</th>
                    <th className="py-2 pl-3 font-medium text-right">Avg / Max Age</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dashboard.salesPipeline.stageDistribution.map((row) => (
                    <tr key={row.stageId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-white">{row.stageName}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {row.leadCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {row.opportunityCount}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatCurrencyTotals(row.valuesByCurrency)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {row.conversionRatePercent !== null ? `${row.conversionRatePercent}%` : '—'}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {row.avgDaysInStage !== null ? `${row.avgDaysInStage}d` : '—'} /{' '}
                        {row.maxDaysInStage !== null ? `${row.maxDaysInStage}d` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section C: Outreach Analytics (Strict Provenance Separation) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Outreach Analytics &amp; Measurement Provenance
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Provider-confirmed delivery events are strictly separated from manual owner-recorded sends, replies, and meetings.
                </p>
              </div>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Active Suppressions:{' '}
                <strong className="font-mono tabular-nums">
                  {dashboard.outreachAnalytics.totals.activeSuppressions}
                </strong>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                dashboard.outreachAnalytics.metricsWithProvenance.providerConfirmedSent,
                dashboard.outreachAnalytics.metricsWithProvenance.providerConfirmedFailures,
                dashboard.outreachAnalytics.metricsWithProvenance.manualExternalSends,
                dashboard.outreachAnalytics.metricsWithProvenance.manualRecordedReplies,
                dashboard.outreachAnalytics.metricsWithProvenance.manualPositiveReplies,
                dashboard.outreachAnalytics.metricsWithProvenance.confirmedMeetingsScheduled,
              ].map((m) => (
                <div
                  key={m.label}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-800/30"
                  title={m.note}
                >
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{m.label}</div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {m.value}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">{PROVENANCE_LABEL[m.provenance]}</div>
                </div>
              ))}
            </div>

            {dashboard.outreachAnalytics.campaigns.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <th className="py-2 pr-4 font-medium">Campaign</th>
                      <th className="py-2 px-3 font-medium">Channel · Status</th>
                      <th className="py-2 px-3 font-medium text-right">Enrolled</th>
                      <th className="py-2 px-3 font-medium text-right">Provider Sends</th>
                      <th className="py-2 px-3 font-medium text-right">Manual Sends</th>
                      <th className="py-2 px-3 font-medium text-right">Replies</th>
                      <th className="py-2 pl-3 font-medium text-right">Meetings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {dashboard.outreachAnalytics.campaigns.map((c) => (
                      <tr key={c.campaignId}>
                        <td className="py-2 pr-4 font-medium text-slate-900 dark:text-white">{c.campaignName}</td>
                        <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                          {c.channel} · {c.status}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{c.enrolled}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{c.providerSent}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{c.manualSent}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {c.replies} ({c.positiveReplies} pos)
                        </td>
                        <td className="py-2 pl-3 text-right font-mono tabular-nums">{c.meetingsScheduled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No outreach campaigns exist yet. Create campaigns in Outreach &amp; HITL to populate campaign metrics.
              </p>
            )}

            {dashboard.outreachAnalytics.unavailableMetrics.length > 0 && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                <div className="font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-slate-400" />
                  <span>Unverified / Unavailable External Telemetry (Explicitly Disclosed)</span>
                </div>
                <ul className="space-y-0.5 pl-5 list-disc">
                  {dashboard.outreachAnalytics.unavailableMetrics.map((u) => (
                    <li key={u.metric}>
                      <span className="font-medium text-slate-700 dark:text-slate-300">{u.metric}:</span> {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Section D: Activity Analytics & Declining Engagement */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Activity &amp; Follow-Up Performance
              </h3>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500 dark:text-slate-400">Tasks Completed</div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {dashboard.activityAnalytics.tasksCompleted}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {dashboard.activityAnalytics.taskCompletionRatePercent !== null
                      ? `${dashboard.activityAnalytics.taskCompletionRatePercent}% completion`
                      : 'No tasks'}
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500 dark:text-slate-400">Overdue Tasks</div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                    {dashboard.activityAnalytics.tasksOverdue}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {dashboard.activityAnalytics.tasksPending} open total
                  </div>
                </div>
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="text-slate-500 dark:text-slate-400">Outreach Follow-Ups</div>
                  <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {dashboard.activityAnalytics.followUpPerformance.outreachFollowUpsCompleted}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {dashboard.activityAnalytics.followUpPerformance.outreachFollowUpsPending} pending ·{' '}
                    {dashboard.activityAnalytics.followUpPerformance.outreachFollowUpsOverdue} overdue
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Interactions Logged ({dashboard.activityAnalytics.interactionsTotal} total)
                </div>
                {dashboard.activityAnalytics.interactionsByType.length === 0 ? (
                  <p className="text-xs text-slate-400">No CRM interactions logged yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {dashboard.activityAnalytics.interactionsByType.map((it) => (
                      <div key={it.key} className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-300 capitalize">
                          {it.label}
                        </span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {it.count} ({it.percentage}%)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Declining Engagement */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4 text-amber-500" />
                  <span>Accounts &amp; Contacts with Declining Engagement</span>
                </h3>
                <span className="text-[11px] text-slate-400">30d vs prior 30d</span>
              </div>

              {dashboard.activityAnalytics.decliningEngagement.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No accounts or contacts show declining engagement in the current window.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
                  {dashboard.activityAnalytics.decliningEngagement.map((item) => (
                    <div key={`${item.entityType}-${item.id}`} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (item.entityType === 'company') openLeadById(item.id);
                            else if (onOpenPersonProfile) onOpenPersonProfile(item.id);
                          }}
                          className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline truncate block text-left"
                        >
                          {item.name}
                        </button>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {item.entityType} · {item.reason}
                        </p>
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                        {item.recent30dInteractions} vs {item.prior30dInteractions}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 2: ADVANCED ANALYTICS                                      */}
      {/* ================================================================== */}
      {dashboard && subTab === 'advanced' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Lead Acquisition Trends (Monthly)
                </h3>
                <span className="text-[11px] text-slate-400">Companies · Verified · Opportunities</span>
              </div>
              {dashboard.advancedAnalytics.leadAcquisitionTrends.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No acquisition data in current filter.</p>
              ) : (
                <div className="space-y-2.5">
                  {(() => {
                    const maxVal = Math.max(
                      1,
                      ...dashboard.advancedAnalytics.leadAcquisitionTrends.map((p) => p.newCompanies)
                    );
                    return dashboard.advancedAnalytics.leadAcquisitionTrends.slice(-8).map((pt) => (
                      <div key={pt.period} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-mono text-slate-600 dark:text-slate-300">{pt.period}</span>
                          <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {pt.newCompanies} added · {pt.verifiedCompanies} verified · {pt.newOpportunities} opps
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-blue-600 dark:bg-blue-500"
                            style={{ width: `${Math.round((pt.newCompanies / maxVal) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Pipeline Conversion Funnel
                </h3>
                <span className="text-[11px] text-slate-400">Stage Distribution &amp; Step Conversion</span>
              </div>
              <div className="space-y-2.5">
                {dashboard.advancedAnalytics.pipelineConversionFunnel.map((step) => (
                  <div key={step.stageId} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{step.stageName}</span>
                      <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {step.count} leads · {step.shareOfTotalPercent ?? 0}% share
                        {step.stepConversionPercent !== null ? ` · ${step.stepConversionPercent}% step` : ''}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 dark:bg-indigo-500"
                        style={{ width: `${Math.max(step.count > 0 ? 4 : 0, step.shareOfTotalPercent ?? 0)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Verification Quality</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Registry Verified Companies</span>
                  <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                    {dashboard.advancedAnalytics.verificationQuality.registryVerifiedCompanies}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Website Inspected</span>
                  <span className="font-mono tabular-nums">
                    {dashboard.advancedAnalytics.verificationQuality.websiteInspectedCompanies}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Email / Phone Verified</span>
                  <span className="font-mono tabular-nums">
                    {dashboard.advancedAnalytics.verificationQuality.emailVerifiedCompanies} /{' '}
                    {dashboard.advancedAnalytics.verificationQuality.phoneVerifiedCompanies}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Verified Decision-Makers</span>
                  <span className="font-mono tabular-nums">
                    {dashboard.advancedAnalytics.verificationQuality.verifiedDecisionMakers} /{' '}
                    {dashboard.advancedAnalytics.verificationQuality.totalDecisionMakers}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Unresolved Conflicts</span>
                  <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400">
                    {dashboard.advancedAnalytics.verificationQuality.unresolvedConflictsCount}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Decision-Maker Coverage</h3>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {dashboard.advancedAnalytics.decisionMakerCoverage.coveragePercent !== null
                  ? `${dashboard.advancedAnalytics.decisionMakerCoverage.coveragePercent}%`
                  : 'N/A'}
              </div>
              <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                <div>
                  Companies with DMs:{' '}
                  <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {dashboard.advancedAnalytics.decisionMakerCoverage.companiesWithDecisionMakers}
                  </span>
                </div>
                <div>
                  Companies without DMs:{' '}
                  <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {dashboard.advancedAnalytics.decisionMakerCoverage.companiesWithoutDecisionMakers}
                  </span>
                </div>
                <div>
                  Avg DMs per Company:{' '}
                  <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {dashboard.advancedAnalytics.decisionMakerCoverage.averageDecisionMakersPerCompany ?? '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Data Completeness &amp; Freshness</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Avg Completeness</span>
                  <span className="font-mono tabular-nums font-medium">
                    {dashboard.advancedAnalytics.dataCompletenessAndFreshness.averageCompletenessScore ?? 'N/A'}/100
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Avg Freshness</span>
                  <span className="font-mono tabular-nums font-medium">
                    {dashboard.advancedAnalytics.dataCompletenessAndFreshness.averageFreshnessScore ?? 'N/A'}/100
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Stale Attributes Total</span>
                  <span className="font-mono tabular-nums">
                    {dashboard.advancedAnalytics.dataCompletenessAndFreshness.staleAttributesTotal}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Eligible for Re-Verification</span>
                  <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400">
                    {dashboard.advancedAnalytics.dataCompletenessAndFreshness.reverificationEligibleCompanies}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Country &amp; Regional Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase text-slate-500">
                      <th className="py-2 pr-3 font-medium">Country</th>
                      <th className="py-2 px-2 font-medium text-right">Companies</th>
                      <th className="py-2 px-2 font-medium text-right">Verified</th>
                      <th className="py-2 px-2 font-medium text-right">Avg Quality</th>
                      <th className="py-2 pl-2 font-medium text-right">Won / Opps</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {dashboard.advancedAnalytics.countryRegionalPerformance.slice(0, 10).map((c) => (
                      <tr key={c.countryCode + c.countryName}>
                        <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-200">
                          {c.countryName} <span className="text-slate-400 font-mono">({c.countryCode})</span>
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{c.companies}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{c.verifiedCount}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{c.avgQualityScore ?? '—'}</td>
                        <td className="py-2 pl-2 text-right font-mono tabular-nums">
                          {c.wonOpportunities} / {c.opportunities}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Source Quality Comparison</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase text-slate-500">
                      <th className="py-2 pr-3 font-medium">Source</th>
                      <th className="py-2 px-2 font-medium text-right">Leads</th>
                      <th className="py-2 px-2 font-medium text-right">Verified %</th>
                      <th className="py-2 px-2 font-medium text-right">Avg Quality</th>
                      <th className="py-2 pl-2 font-medium text-right">Opp Conv %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {dashboard.advancedAnalytics.sourceQualityComparison.slice(0, 10).map((s) => (
                      <tr key={s.sourceName}>
                        <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-200">{s.sourceName}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{s.leadCount}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">
                          {s.verifiedPercent !== null ? `${s.verifiedPercent}%` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{s.avgQualityScore ?? '—'}</td>
                        <td className="py-2 pl-2 text-right font-mono tabular-nums">
                          {s.opportunityConversionPercent !== null ? `${s.opportunityConversionPercent}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Industry Opportunity Comparison</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase text-slate-500">
                      <th className="py-2 pr-3 font-medium">Industry</th>
                      <th className="py-2 px-2 font-medium text-right">Companies</th>
                      <th className="py-2 px-2 font-medium text-right">Open / Won</th>
                      <th className="py-2 pl-2 font-medium">Open Pipeline Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {dashboard.advancedAnalytics.industryOpportunityComparison.slice(0, 10).map((ind) => (
                      <tr key={ind.industry}>
                        <td className="py-2 pr-3 font-medium text-slate-800 dark:text-slate-200">{ind.industry}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">{ind.companies}</td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums">
                          {ind.openOpportunities} / {ind.wonOpportunities}
                        </td>
                        <td className="py-2 pl-2 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {ind.openValueSummary || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Company Engagement Distribution &amp; Outreach Over Time
              </h3>
              <div className="space-y-2">
                {dashboard.advancedAnalytics.companyEngagementDistribution.map((b) => (
                  <div key={b.tier} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-300">{b.label}</span>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {b.count} ({b.percentage}%)
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Outreach Performance Over Time
                </div>
                {dashboard.advancedAnalytics.outreachPerformanceOverTime.length === 0 ? (
                  <p className="text-xs text-slate-400">No outreach sends or replies recorded yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {dashboard.advancedAnalytics.outreachPerformanceOverTime.slice(-6).map((p) => (
                      <div key={p.period} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-slate-600 dark:text-slate-300">{p.period}</span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {p.providerSent} prov · {p.manualSent} manual · {p.replies} replies
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 3: OPERATIONAL REPORTS & CSV EXPORT                        */}
      {/* ================================================================== */}
      {subTab === 'reports' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Standard Operational Reports</h3>
              <div className="space-y-1.5">
                {BI_REPORT_TYPES.map((rep) => (
                  <button
                    key={rep.value}
                    type="button"
                    onClick={() => setSelectedReportType(rep.value)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border text-xs transition-colors ${
                      selectedReportType === rep.value
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30 text-slate-900 dark:text-white'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="font-semibold">{rep.label}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{rep.description}</div>
                  </button>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleSaveReportConfig}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
            >
              <h4 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5 text-slate-400" />
                <span>Save Current Report View</span>
              </h4>
              <input
                type="text"
                required
                placeholder="e.g. UK Q4 Pipeline Review"
                value={saveReportName}
                onChange={(e) => setSaveReportName(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
              <input
                type="text"
                placeholder="Optional description"
                value={saveReportDesc}
                onChange={(e) => setSaveReportDesc(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
              <button
                type="submit"
                className="w-full py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
              >
                Save Configuration
              </button>
            </form>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
              <h4 className="text-xs font-semibold text-slate-900 dark:text-white">
                Saved Configurations ({savedReports.length})
              </h4>
              {savedReports.length === 0 ? (
                <p className="text-xs text-slate-400">No saved report configurations yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {savedReports.map((sr) => (
                    <div key={sr.id} className="py-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReportType(sr.reportType);
                          setFilters(sr.filters || {});
                        }}
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline truncate">
                          {sr.name}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {sr.reportType.replace(/_/g, ' ')}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedReport(sr.id)}
                        title="Delete saved report"
                        className="p-1 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {generatedReport?.title || 'Operational Report'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {generatedReport?.description}
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportReportCsv}
                disabled={exportingCsv || !generatedReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{exportingCsv ? 'Exporting...' : 'Export RFC 4180 CSV'}</span>
              </button>
            </div>

            {generatedReport && (
              <>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 flex items-center gap-2">
                  <Info className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span>{generatedReport.schedulingDisclosure}</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {generatedReport.summaryMetrics.map((sm) => (
                    <div key={sm.label} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{sm.label}</div>
                      <div className="mt-1 text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                        {sm.value}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {PROVENANCE_LABEL[sm.provenance] || sm.provenance}
                      </div>
                    </div>
                  ))}
                </div>

                {reportLoading ? (
                  <div className="py-8 text-center text-xs text-slate-400">Generating report...</div>
                ) : generatedReport.rows.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    No records match the selected report and filter criteria.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[460px] overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase text-slate-500 dark:text-slate-400">
                          {generatedReport.columns.map((col) => (
                            <th key={col} className="py-2 px-3 font-medium whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {generatedReport.rows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            {generatedReport.columns.map((col) => (
                              <td key={col} className="py-2 px-3 text-slate-700 dark:text-slate-300 font-mono tabular-nums">
                                {row[col] === null || row[col] === undefined ? '—' : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* SUB-TAB 4: AI BI INSIGHTS & EXECUTIVE BRIEFINGS                    */}
      {/* ================================================================== */}
      {subTab === 'ai_insights' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                AI-Assisted Business Intelligence Briefings
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Strictly separates Verified Data, Calculated Metrics, Inferences, and Owner-Action Recommendations. Never auto-executes CRM mutations or external outreach.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Analysis Mode
                </label>
                <select
                  value={aiMode}
                  onChange={(e) => setAiMode(e.target.value as BiAiAnalysisMode)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {BI_AI_ANALYSIS_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Optional Owner Question
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aiQuestion}
                    onChange={(e) => setAiQuestion(e.target.value)}
                    placeholder="e.g. Which countries have verified leads ready for outreach?"
                    className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={handleRunAiAnalysis}
                    disabled={aiLoading}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{aiLoading ? 'Analyzing...' : 'Generate Briefing'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {aiInsight && (
            <div className="space-y-4">
              <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2 px-1">
                <span>
                  <strong className="text-slate-800 dark:text-slate-200">{aiInsight.title}</strong> · Generated{' '}
                  {new Date(aiInsight.generatedAt).toLocaleString()}
                </span>
                <span className="font-mono">
                  Mode: {aiInsight.aiStatus.mode}
                  {aiInsight.aiStatus.model ? ` · ${aiInsight.aiStatus.model}` : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                    1. Verified Data (Live LEED Records)
                  </h4>
                  <ul className="space-y-2 text-xs">
                    {aiInsight.verifiedData.map((v, i) => (
                      <li key={i} className="text-slate-700 dark:text-slate-300">
                        <span className="font-semibold text-slate-900 dark:text-white">{v.label}:</span> {v.detail}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                    2. Calculated Metrics
                  </h4>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {aiInsight.calculatedMetrics.map((m, i) => (
                      <div key={i} className="py-1.5 flex items-center justify-between text-xs">
                        <div>
                          <span className="text-slate-700 dark:text-slate-200">{m.label}</span>
                          <span className="ml-2 text-[10px] text-slate-400">
                            {PROVENANCE_LABEL[m.provenance] || m.provenance}
                          </span>
                        </div>
                        <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                          {m.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                    3. Analytical Inferences
                  </h4>
                  <ul className="space-y-2.5 text-xs">
                    {aiInsight.inferences.map((inf, i) => (
                      <li key={i}>
                        <div className="text-slate-800 dark:text-slate-200 font-medium">{inf.observation}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">Basis: {inf.basis}</div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                    4. Owner Recommendations (Review Required)
                  </h4>
                  <div className="space-y-3 text-xs">
                    {aiInsight.recommendations.map((rec, i) => (
                      <div key={i} className="border-b last:border-b-0 border-slate-100 dark:border-slate-800 pb-2.5 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">{rec.title}</span>
                          <span className="text-[10px] font-mono uppercase text-slate-500">
                            {rec.priority} priority
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mt-0.5">{rec.rationale}</p>
                        <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-1 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 shrink-0" />
                          <span>Suggested next step: {rec.suggestedAction}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {aiInsight.unavailableDataNotes.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                  <div className="font-semibold text-slate-700 dark:text-slate-300">Unavailable Data Disclosures</div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {aiInsight.unavailableDataNotes.map((n, idx) => (
                      <li key={idx}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
