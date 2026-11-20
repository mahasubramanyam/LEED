// Phase 16: Operational Reporting, Saved Report Configurations & RFC 4180 CSV Export Service
// Reuses shared/csvUtils.ts (formula-injection neutralization) and real biAnalyticsService metrics.
// Explicitly discloses that scheduled background report delivery is not active (on-demand only).

import {
  BI_REPORT_TYPES,
  BI_REPORT_TYPE_SET,
  type BiReportType,
} from '../../shared/biWorkflowSpecs.js';
import type {
  BiAnalyticsFilter,
  BiGeneratedReport,
  BiSavedReportConfig,
} from '../../shared/biWorkflowTypes.js';
import { buildCsvDocument } from '../../shared/csvUtils.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import { buildBiAnalyticsDashboard } from './biAnalyticsService.js';
import {
  appendBiWorkflowAudit,
  generateBiWorkflowId,
  getBiWorkflowWorkspaceState,
  saveBiWorkflowWorkspaceState,
  withBiWorkflowLock,
} from './biWorkflowStoreHelper.js';

const SCHEDULING_DISCLOSURE =
  'Reports are generated and exported on-demand from live LEED records. No background scheduled report delivery service is active.';

export async function generateBiReport(
  facade: CrmStorageFacade,
  reportType: string,
  filters: BiAnalyticsFilter = {},
  now: Date = new Date()
): Promise<BiGeneratedReport> {
  if (!BI_REPORT_TYPE_SET.has(reportType)) {
    throw new Error(`Invalid report type "${reportType}".`);
  }
  const typed = reportType as BiReportType;
  const spec = BI_REPORT_TYPES.find((r) => r.value === typed)!;
  const bi = await buildBiAnalyticsDashboard(facade, filters, now);

  switch (typed) {
    case 'executive_overview': {
      const columns = ['Section', 'Metric', 'Value', 'Provenance'];
      const rows: Array<Record<string, string | number | null>> = [
        { Section: 'Leads', Metric: 'Total Companies', Value: bi.leadIntelligence.totalCompanies, Provenance: 'system_calculated' },
        { Section: 'Leads', Metric: 'Total Decision-Makers', Value: bi.leadIntelligence.totalDecisionMakers, Provenance: 'system_calculated' },
        { Section: 'Leads', Metric: 'Officially Verified Leads', Value: bi.leadIntelligence.verifiedLeads, Provenance: 'system_calculated' },
        { Section: 'Leads', Metric: 'Unverified Leads', Value: bi.leadIntelligence.unverifiedLeads, Provenance: 'system_calculated' },
        { Section: 'Leads', Metric: 'Average Quality Score', Value: bi.leadIntelligence.averageQualityScore ?? 'N/A', Provenance: 'system_calculated' },
        { Section: 'Pipeline', Metric: 'Open Opportunities', Value: bi.salesPipeline.openOpportunities, Provenance: 'system_calculated' },
        { Section: 'Pipeline', Metric: 'Won Opportunities', Value: bi.salesPipeline.wonOpportunities, Provenance: 'system_calculated' },
        { Section: 'Pipeline', Metric: 'Lost Opportunities', Value: bi.salesPipeline.lostOpportunities, Provenance: 'system_calculated' },
        { Section: 'Pipeline', Metric: 'Win Rate (%)', Value: bi.salesPipeline.winRatePercent ?? 'N/A', Provenance: 'system_calculated' },
        { Section: 'Outreach', Metric: 'Provider-Confirmed Sends', Value: bi.outreachAnalytics.totals.messagesSentViaProvider, Provenance: 'provider_confirmed' },
        { Section: 'Outreach', Metric: 'Manual External Sends', Value: bi.outreachAnalytics.totals.messagesManualSent, Provenance: 'manual_owner_recorded' },
        { Section: 'Outreach', Metric: 'Recorded Replies', Value: bi.outreachAnalytics.totals.repliesReceived, Provenance: 'manual_owner_recorded' },
        { Section: 'Outreach', Metric: 'Confirmed Meetings Scheduled', Value: bi.outreachAnalytics.totals.meetingsScheduled, Provenance: 'manual_owner_recorded' },
        { Section: 'Activity', Metric: 'Tasks Completed', Value: bi.activityAnalytics.tasksCompleted, Provenance: 'system_calculated' },
        { Section: 'Activity', Metric: 'Overdue Tasks', Value: bi.activityAnalytics.tasksOverdue, Provenance: 'system_calculated' },
        { Section: 'Workflows', Metric: 'Enabled Workflows', Value: bi.workflowSummary.enabledWorkflows, Provenance: 'system_calculated' },
        { Section: 'Workflows', Metric: 'Total Workflow Runs', Value: bi.workflowSummary.totalExecutions, Provenance: 'system_calculated' },
      ];
      return {
        reportType: typed,
        title: spec.label,
        description: spec.description,
        generatedAt: bi.generatedAt,
        filters: bi.filtersApplied,
        scheduledDeliveryAvailable: false,
        schedulingDisclosure: SCHEDULING_DISCLOSURE,
        summaryMetrics: [
          { label: 'Companies', value: bi.leadIntelligence.totalCompanies, provenance: 'system_calculated' },
          { label: 'Open Opportunities', value: bi.salesPipeline.openOpportunities, provenance: 'system_calculated' },
          { label: 'Provider-Confirmed Sends', value: bi.outreachAnalytics.totals.messagesSentViaProvider, provenance: 'provider_confirmed' },
          { label: 'Confirmed Meetings', value: bi.outreachAnalytics.totals.meetingsScheduled, provenance: 'manual_owner_recorded' },
        ],
        columns,
        rows,
        totalRows: rows.length,
      };
    }

    case 'pipeline_performance': {
      const columns = [
        'Stage',
        'Companies',
        'Opportunities',
        'Value Summary',
        'Stage Conversion (%)',
        'Avg Days in Stage',
        'Max Days in Stage',
      ];
      const rows = bi.salesPipeline.stageDistribution.map((s) => ({
        Stage: s.stageName,
        Companies: s.leadCount,
        Opportunities: s.opportunityCount,
        'Value Summary':
          s.valuesByCurrency.length === 0
            ? '—'
            : s.valuesByCurrency.map((v) => `${v.currency} ${v.totalValue.toLocaleString()}`).join(' | '),
        'Stage Conversion (%)': s.conversionRatePercent,
        'Avg Days in Stage': s.avgDaysInStage,
        'Max Days in Stage': s.maxDaysInStage,
      }));
      return {
        reportType: typed,
        title: spec.label,
        description: spec.description,
        generatedAt: bi.generatedAt,
        filters: bi.filtersApplied,
        scheduledDeliveryAvailable: false,
        schedulingDisclosure: SCHEDULING_DISCLOSURE,
        summaryMetrics: [
          { label: 'Total Opportunities', value: bi.salesPipeline.totalOpportunities, provenance: 'system_calculated' },
          { label: 'Won / Lost', value: `${bi.salesPipeline.wonOpportunities} / ${bi.salesPipeline.lostOpportunities}`, provenance: 'system_calculated' },
          { label: 'Win Rate', value: bi.salesPipeline.winRatePercent !== null ? `${bi.salesPipeline.winRatePercent}%` : 'Insufficient data', provenance: 'system_calculated' },
          { label: 'Avg Cycle Days', value: bi.salesPipeline.salesVelocity.averageCycleDays ?? 'Insufficient data', provenance: 'system_calculated' },
        ],
        columns,
        rows,
        totalRows: rows.length,
      };
    }

    case 'outreach_performance': {
      const columns = [
        'Campaign',
        'Status',
        'Channel',
        'Enrolled',
        'Provider-Confirmed Sent',
        'Manual External Sent',
        'Provider Failed',
        'Manual Replies',
        'Positive Replies',
        'Meetings Scheduled',
        'Opt-Outs',
      ];
      const rows = bi.outreachAnalytics.campaigns.map((c) => ({
        Campaign: c.campaignName,
        Status: c.status,
        Channel: c.channel,
        Enrolled: c.enrolled,
        'Provider-Confirmed Sent': c.providerSent,
        'Manual External Sent': c.manualSent,
        'Provider Failed': c.failed,
        'Manual Replies': c.replies,
        'Positive Replies': c.positiveReplies,
        'Meetings Scheduled': c.meetingsScheduled,
        'Opt-Outs': c.optOuts,
      }));
      return {
        reportType: typed,
        title: spec.label,
        description: spec.description,
        generatedAt: bi.generatedAt,
        filters: bi.filtersApplied,
        scheduledDeliveryAvailable: false,
        schedulingDisclosure: SCHEDULING_DISCLOSURE,
        summaryMetrics: [
          { label: 'Provider-Confirmed Sent', value: bi.outreachAnalytics.totals.messagesSentViaProvider, provenance: 'provider_confirmed' },
          { label: 'Manual External Sent', value: bi.outreachAnalytics.totals.messagesManualSent, provenance: 'manual_owner_recorded' },
          { label: 'Recorded Replies', value: bi.outreachAnalytics.totals.repliesReceived, provenance: 'manual_owner_recorded' },
          { label: 'Active Suppressions', value: bi.outreachAnalytics.totals.activeSuppressions, provenance: 'system_calculated' },
        ],
        columns,
        rows,
        totalRows: rows.length,
      };
    }

    case 'lead_quality': {
      const columns = [
        'Country Code',
        'Country',
        'Companies',
        'Verified Companies',
        'Verified (%)',
        'Decision-Makers',
        'Opportunities',
        'Won Opportunities',
        'Avg Quality Score',
      ];
      const rows = bi.advancedAnalytics.countryRegionalPerformance.map((c) => ({
        'Country Code': c.countryCode,
        Country: c.countryName,
        Companies: c.companies,
        'Verified Companies': c.verifiedCount,
        'Verified (%)': c.verifiedPercent,
        'Decision-Makers': c.decisionMakers,
        Opportunities: c.opportunities,
        'Won Opportunities': c.wonOpportunities,
        'Avg Quality Score': c.avgQualityScore,
      }));
      return {
        reportType: typed,
        title: spec.label,
        description: spec.description,
        generatedAt: bi.generatedAt,
        filters: bi.filtersApplied,
        scheduledDeliveryAvailable: false,
        schedulingDisclosure: SCHEDULING_DISCLOSURE,
        summaryMetrics: [
          { label: 'Total Companies', value: bi.leadIntelligence.totalCompanies, provenance: 'system_calculated' },
          { label: 'Verification Rate', value: bi.leadIntelligence.verificationRatePercent !== null ? `${bi.leadIntelligence.verificationRatePercent}%` : 'N/A', provenance: 'system_calculated' },
          { label: 'DM Coverage', value: bi.advancedAnalytics.decisionMakerCoverage.coveragePercent !== null ? `${bi.advancedAnalytics.decisionMakerCoverage.coveragePercent}%` : 'N/A', provenance: 'system_calculated' },
          { label: 'Avg Quality', value: bi.leadIntelligence.averageQualityScore ?? 'N/A', provenance: 'system_calculated' },
        ],
        columns,
        rows,
        totalRows: rows.length,
      };
    }

    case 'data_quality': {
      const columns = [
        'Source',
        'Leads',
        'Officially Verified',
        'Verified (%)',
        'Avg Quality Score',
        'With Opportunities',
        'Opp Conversion (%)',
      ];
      const rows = bi.advancedAnalytics.sourceQualityComparison.map((s) => ({
        Source: s.sourceName,
        Leads: s.leadCount,
        'Officially Verified': s.verifiedCount,
        'Verified (%)': s.verifiedPercent,
        'Avg Quality Score': s.avgQualityScore,
        'With Opportunities': s.opportunitiesCount,
        'Opp Conversion (%)': s.opportunityConversionPercent,
      }));
      const dq = bi.advancedAnalytics.dataCompletenessAndFreshness;
      return {
        reportType: typed,
        title: spec.label,
        description: spec.description,
        generatedAt: bi.generatedAt,
        filters: bi.filtersApplied,
        scheduledDeliveryAvailable: false,
        schedulingDisclosure: SCHEDULING_DISCLOSURE,
        summaryMetrics: [
          { label: 'Avg Completeness', value: dq.averageCompletenessScore ?? 'N/A', provenance: 'system_calculated' },
          { label: 'Avg Verification', value: dq.averageVerificationScore ?? 'N/A', provenance: 'system_calculated' },
          { label: 'Avg Freshness', value: dq.averageFreshnessScore ?? 'N/A', provenance: 'system_calculated' },
          { label: 'Re-verification Eligible', value: dq.reverificationEligibleCompanies, provenance: 'system_calculated' },
        ],
        columns,
        rows,
        totalRows: rows.length,
      };
    }

    case 'workflow_operations': {
      const ws = await getBiWorkflowWorkspaceState(facade);
      const columns = [
        'Workflow Name',
        'Trigger',
        'Enabled',
        'Total Runs',
        'Completed',
        'Awaiting Approval',
        'Failed',
        'Skipped',
        'Last Run At',
      ];
      const rows = ws.workflows.map((w) => ({
        'Workflow Name': w.name,
        Trigger: w.trigger.type,
        Enabled: w.enabled ? 'Yes' : 'No',
        'Total Runs': w.stats.totalRuns,
        Completed: w.stats.completedRuns,
        'Awaiting Approval': w.stats.awaitingApprovalRuns,
        Failed: w.stats.failedRuns,
        Skipped: w.stats.skippedRuns,
        'Last Run At': w.stats.lastRunAt || 'Never',
      }));
      return {
        reportType: typed,
        title: spec.label,
        description: spec.description,
        generatedAt: bi.generatedAt,
        filters: bi.filtersApplied,
        scheduledDeliveryAvailable: false,
        schedulingDisclosure: SCHEDULING_DISCLOSURE,
        summaryMetrics: [
          { label: 'Total Workflows', value: bi.workflowSummary.totalWorkflows, provenance: 'system_calculated' },
          { label: 'Enabled', value: bi.workflowSummary.enabledWorkflows, provenance: 'system_calculated' },
          { label: 'Completed Runs', value: bi.workflowSummary.completedExecutions, provenance: 'system_calculated' },
          { label: 'Failed Runs', value: bi.workflowSummary.failedExecutions, provenance: 'system_calculated' },
        ],
        columns,
        rows,
        totalRows: rows.length,
      };
    }
  }
}

export function exportBiReportToCsv(report: BiGeneratedReport): {
  filename: string;
  csvContent: string;
} {
  const rowsMatrix = report.rows.map((row) =>
    report.columns.map((col) => {
      const val = row[col];
      return val === null || val === undefined ? '' : val;
    })
  );
  const safeType = report.reportType.replace(/[^a-z0-9_-]/gi, '_');
  const dateStamp = report.generatedAt.slice(0, 10);
  return {
    filename: `leed_bi_${safeType}_${dateStamp}.csv`,
    csvContent: buildCsvDocument(report.columns, rowsMatrix, true),
  };
}

export async function listSavedBiReports(facade: CrmStorageFacade): Promise<BiSavedReportConfig[]> {
  const ws = await getBiWorkflowWorkspaceState(facade);
  return ws.savedReports;
}

export async function saveBiReportConfig(
  facade: CrmStorageFacade,
  input: {
    id?: string;
    name: string;
    description?: string;
    reportType: string;
    filters: BiAnalyticsFilter;
  },
  actor: string
): Promise<BiSavedReportConfig> {
  if (!input.name || !input.name.trim()) {
    throw new Error('Saved report name is required.');
  }
  if (!BI_REPORT_TYPE_SET.has(input.reportType)) {
    throw new Error(`Invalid report type "${input.reportType}".`);
  }
  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const now = new Date().toISOString();
    const record: BiSavedReportConfig = {
      id: input.id || generateBiWorkflowId('brep'),
      name: input.name.trim().slice(0, 140),
      description: input.description?.trim().slice(0, 400) || undefined,
      reportType: input.reportType as BiReportType,
      filters: {
        dateFrom: input.filters?.dateFrom || undefined,
        dateTo: input.filters?.dateTo || undefined,
        country: input.filters?.country || undefined,
        industry: input.filters?.industry || undefined,
        source: input.filters?.source || undefined,
        stageId: input.filters?.stageId || undefined,
      },
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    };
    const idx = ws.savedReports.findIndex((r) => r.id === record.id);
    if (idx !== -1) {
      record.createdAt = ws.savedReports[idx].createdAt;
      ws.savedReports[idx] = record;
    } else {
      ws.savedReports = [record, ...ws.savedReports];
    }
    appendBiWorkflowAudit(ws, {
      actor,
      action: 'saved_report_upserted',
      entityType: 'report',
      entityId: record.id,
      summary: `Saved BI report configuration "${record.name}" (${record.reportType}).`,
    });
    await saveBiWorkflowWorkspaceState(facade, ws);
    return record;
  });
}

export async function deleteSavedBiReportConfig(
  facade: CrmStorageFacade,
  id: string,
  actor: string
): Promise<boolean> {
  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const before = ws.savedReports.length;
    ws.savedReports = ws.savedReports.filter((r) => r.id !== id);
    if (ws.savedReports.length === before) return false;
    appendBiWorkflowAudit(ws, {
      actor,
      action: 'saved_report_deleted',
      entityType: 'report',
      entityId: id,
      summary: `Deleted saved BI report configuration ${id}.`,
    });
    await saveBiWorkflowWorkspaceState(facade, ws);
    return true;
  });
}
