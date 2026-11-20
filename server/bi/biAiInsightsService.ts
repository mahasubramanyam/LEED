// Phase 16: AI Sales Agent Integration for Business Intelligence & Workflow Recommendations
// Reuses existing server/ai/aiProvider.ts (Gemini @google/genai) with deterministic evidence-grounded fallback.
// Strictly separates Verified Data, Calculated Metrics, Inferences, and Recommendations.
// Never fabricates metrics, never claims unavailable telemetry, and never auto-executes CRM/outreach actions.

import {
  BI_AI_ANALYSIS_MODES,
  BI_AI_ANALYSIS_MODE_SET,
  type BiAiAnalysisMode,
} from '../../shared/biWorkflowSpecs.js';
import type {
  BiAiInsightResponse,
  BiAnalyticsFilter,
  BiDashboardResponse,
} from '../../shared/biWorkflowTypes.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import { generateStructuredJsonWithAi } from '../ai/aiProvider.js';
import { buildBiAnalyticsDashboard } from './biAnalyticsService.js';

function buildDeterministicInsights(
  mode: BiAiAnalysisMode,
  bi: BiDashboardResponse
): Pick<BiAiInsightResponse, 'verifiedData' | 'calculatedMetrics' | 'inferences' | 'recommendations' | 'unavailableDataNotes'> {
  const verifiedData: BiAiInsightResponse['verifiedData'] = [
    {
      label: 'CRM Entity Inventory',
      detail: `${bi.leadIntelligence.totalCompanies} companies (${bi.leadIntelligence.verifiedLeads} officially verified, ${bi.leadIntelligence.unverifiedLeads} unverified) and ${bi.leadIntelligence.totalDecisionMakers} decision-makers in scope.`,
    },
    {
      label: 'Pipeline & Opportunities',
      detail: `${bi.salesPipeline.openOpportunities} open, ${bi.salesPipeline.wonOpportunities} won, and ${bi.salesPipeline.lostOpportunities} lost opportunities tracked via ${bi.salesPipeline.dataSource}.`,
    },
    {
      label: 'Outreach Delivery Provenance',
      detail: `${bi.outreachAnalytics.totals.messagesSentViaProvider} provider-confirmed email send(s), ${bi.outreachAnalytics.totals.messagesManualSent} manual external send(s), ${bi.outreachAnalytics.totals.repliesReceived} manually recorded repl(y/ies), ${bi.outreachAnalytics.totals.meetingsScheduled} confirmed scheduled meeting(s), and ${bi.outreachAnalytics.totals.activeSuppressions} active suppression(s).`,
    },
    {
      label: 'Workflow Automation State',
      detail: `${bi.workflowSummary.enabledWorkflows}/${bi.workflowSummary.totalWorkflows} enabled workflow(s); ${bi.workflowSummary.completedExecutions} completed, ${bi.workflowSummary.failedExecutions} failed, ${bi.workflowSummary.awaitingApprovalExecutions} awaiting owner approval.`,
    },
  ];

  const calculatedMetrics: BiAiInsightResponse['calculatedMetrics'] = [
    {
      label: 'Lead Verification Rate',
      value: bi.leadIntelligence.verificationRatePercent !== null ? `${bi.leadIntelligence.verificationRatePercent}%` : 'N/A (0 leads)',
      provenance: 'system_calculated',
    },
    {
      label: 'Average Data Quality Score',
      value: bi.leadIntelligence.averageQualityScore !== null ? `${bi.leadIntelligence.averageQualityScore}/100` : 'N/A',
      provenance: 'system_calculated',
    },
    {
      label: 'Decision-Maker Coverage',
      value:
        bi.advancedAnalytics.decisionMakerCoverage.coveragePercent !== null
          ? `${bi.advancedAnalytics.decisionMakerCoverage.coveragePercent}%`
          : 'N/A',
      provenance: 'system_calculated',
    },
    {
      label: 'Opportunity Win Rate',
      value: bi.salesPipeline.winRatePercent !== null ? `${bi.salesPipeline.winRatePercent}%` : 'Insufficient closed deals',
      provenance: 'system_calculated',
    },
    {
      label: 'Outreach Reply Rate',
      value: bi.outreachAnalytics.rates.replyRatePercent !== null ? `${bi.outreachAnalytics.rates.replyRatePercent}%` : 'N/A (0 dispatched)',
      provenance: 'manual_owner_recorded',
    },
    {
      label: 'Provider-Confirmed Sends',
      value: String(bi.outreachAnalytics.totals.messagesSentViaProvider),
      provenance: 'provider_confirmed',
    },
  ];

  const inferences: BiAiInsightResponse['inferences'] = [];
  const recommendations: BiAiInsightResponse['recommendations'] = [];

  if (bi.leadIntelligence.unverifiedLeads > 0) {
    inferences.push({
      observation: `${bi.leadIntelligence.unverifiedLeads} company record(s) lack official registry verification, capping their data quality score.`,
      basis: 'Calculated from leadIntelligence.unverifiedLeads and dataCompletenessAndFreshness.verificationCapAppliedCount.',
    });
    recommendations.push({
      title: 'Prioritize Phase 12 Enrichment & Registry Verification',
      priority: 'high',
      rationale: `${bi.advancedAnalytics.dataCompletenessAndFreshness.reverificationEligibleCompanies} company record(s) are eligible for enrichment/re-verification.`,
      suggestedAction: 'Configure a workflow triggering on lead_created to queue owner-reviewed enrichment for unverified accounts.',
      requiresOwnerAction: true,
    });
  }

  if (bi.activityAnalytics.tasksOverdue > 0 || bi.activityAnalytics.decliningEngagement.length > 0) {
    inferences.push({
      observation: `${bi.activityAnalytics.tasksOverdue} overdue task(s) and ${bi.activityAnalytics.decliningEngagement.length} account(s)/contact(s) show declining engagement.`,
      basis: 'Derived from tasksOverdue and 30d vs. prior-30d interaction comparisons.',
    });
    recommendations.push({
      title: 'Clear Overdue Follow-Ups & Re-Engage Cooling Accounts',
      priority: 'high',
      rationale: 'Unresolved overdue tasks and 30+ day interaction gaps indicate deal stagnation risk.',
      suggestedAction: 'Run the on-demand overdue-task workflow sweep and review declining accounts in CRM.',
      requiresOwnerAction: true,
    });
  }

  const underperforming = bi.outreachAnalytics.campaigns.filter(
    (c) => c.providerSent + c.manualSent >= 3 && c.replies === 0
  );
  if (underperforming.length > 0) {
    inferences.push({
      observation: `${underperforming.length} campaign(s) have dispatched >=3 messages with 0 recorded replies (${underperforming.map((c) => c.campaignName).slice(0, 3).join(', ')}).`,
      basis: 'Calculated from outreachAnalytics.campaigns dispatched vs. manual owner-recorded replies.',
    });
    recommendations.push({
      title: 'Audit Messaging & ICP Fit on Zero-Reply Campaigns',
      priority: 'medium',
      rationale: 'Low response across initial sends suggests tightening ICP targeting or verifying decision-maker roles before drafting follow-ups.',
      suggestedAction: 'Inspect campaign audience data quality and pause/refine underperforming sequences in Outreach.',
      requiresOwnerAction: true,
    });
  }

  if (bi.workflowSummary.failedExecutions > 0 || bi.workflowSummary.awaitingApprovalExecutions > 0) {
    inferences.push({
      observation: `Workflow operations have ${bi.workflowSummary.failedExecutions} failed execution(s) and ${bi.workflowSummary.awaitingApprovalExecutions} step(s) awaiting owner approval.`,
      basis: 'Read directly from workflow execution history.',
    });
    recommendations.push({
      title: 'Review Pending Workflow Approvals & Retry Recoverable Failures',
      priority: 'medium',
      rationale: 'Unreviewed approvals stall CRM updates and failed steps can be recovered idempotently.',
      suggestedAction: 'Open the Workflows workspace to approve/reject queued steps and retry failed executions.',
      requiresOwnerAction: true,
    });
  }

  if (inferences.length === 0) {
    inferences.push({
      observation: `Current dataset (${mode.replace(/_/g, ' ')}) shows no critical operational anomalies in the selected filter window.`,
      basis: 'Evaluated across live CRM, pipeline, outreach, and workflow aggregates.',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: 'Expand Verified Pipeline & Enable Guarded Workflows',
      priority: 'low',
      rationale: 'Baseline operations are clean; adding verified decision-makers and stage-duration workflows increases coverage.',
      suggestedAction: 'Discover and verify additional ICP companies or configure a stage-aging alert rule.',
      requiresOwnerAction: true,
    });
  }

  return {
    verifiedData,
    calculatedMetrics,
    inferences,
    recommendations,
    unavailableDataNotes: [
      ...bi.outreachAnalytics.unavailableMetrics.map((u) => `${u.metric} (${u.status}): ${u.reason}`),
      ...(bi.salesPipeline.salesVelocity.insufficientDataReason
        ? [`Sales Velocity: ${bi.salesPipeline.salesVelocity.insufficientDataReason}`]
        : []),
    ],
  };
}

export async function generateBiAiInsights(
  facade: CrmStorageFacade,
  params: {
    mode: string;
    filters?: BiAnalyticsFilter;
    question?: string;
    now?: Date;
  }
): Promise<BiAiInsightResponse> {
  if (!BI_AI_ANALYSIS_MODE_SET.has(params.mode)) {
    throw new Error(`Invalid BI AI analysis mode "${params.mode}".`);
  }
  const mode = params.mode as BiAiAnalysisMode;
  const spec = BI_AI_ANALYSIS_MODES.find((m) => m.value === mode)!;
  const now = params.now || new Date();
  const bi = await buildBiAnalyticsDashboard(facade, params.filters || {}, now);
  const deterministic = buildDeterministicInsights(mode, bi);

  const compactContext = {
    mode,
    question: params.question?.trim().slice(0, 400) || undefined,
    filtersApplied: bi.filtersApplied,
    leadIntelligence: {
      totalCompanies: bi.leadIntelligence.totalCompanies,
      totalDecisionMakers: bi.leadIntelligence.totalDecisionMakers,
      verifiedLeads: bi.leadIntelligence.verifiedLeads,
      unverifiedLeads: bi.leadIntelligence.unverifiedLeads,
      verificationRatePercent: bi.leadIntelligence.verificationRatePercent,
      averageQualityScore: bi.leadIntelligence.averageQualityScore,
      topCountries: bi.leadIntelligence.byCountry.slice(0, 6),
      topIndustries: bi.leadIntelligence.byIndustry.slice(0, 6),
    },
    salesPipeline: {
      dataSource: bi.salesPipeline.dataSource,
      openOpportunities: bi.salesPipeline.openOpportunities,
      wonOpportunities: bi.salesPipeline.wonOpportunities,
      lostOpportunities: bi.salesPipeline.lostOpportunities,
      winRatePercent: bi.salesPipeline.winRatePercent,
      openValuesByCurrency: bi.salesPipeline.openValuesByCurrency,
      salesVelocity: bi.salesPipeline.salesVelocity,
    },
    outreachTotals: bi.outreachAnalytics.totals,
    outreachRates: bi.outreachAnalytics.rates,
    outreachCampaigns: bi.outreachAnalytics.campaigns.slice(0, 10),
    activity: {
      tasksCompleted: bi.activityAnalytics.tasksCompleted,
      tasksOverdue: bi.activityAnalytics.tasksOverdue,
      interactionsTotal: bi.activityAnalytics.interactionsTotal,
      decliningEngagementCount: bi.activityAnalytics.decliningEngagement.length,
    },
    workflowSummary: bi.workflowSummary,
    unavailableMetrics: bi.outreachAnalytics.unavailableMetrics.map((m) => m.metric),
  };

  const aiResult = await generateStructuredJsonWithAi<{
    inferences?: Array<{ observation: string; basis: string }>;
    recommendations?: Array<{
      title: string;
      priority: 'high' | 'medium' | 'low';
      rationale: string;
      suggestedAction: string;
    }>;
  }>({
    systemInstruction:
      'You are LEED Owner Business Intelligence Advisor. Use ONLY the numbers provided in the JSON context. Never invent metrics, never claim access to email opens/clicks/calendar sync/automated inbound reply sync, and never recommend automatic external email or LinkedIn sending. Return valid JSON with keys "inferences" (array of {observation, basis}) and "recommendations" (array of {title, priority: "high"|"medium"|"low", rationale, suggestedAction}). Keep outputs concise and executive.',
    prompt: `Analyze the following real LEED BI metrics for mode "${spec.label}"${
      params.question ? ` addressing owner question: "${params.question.trim()}"` : ''
    }:\n${JSON.stringify(compactContext)}`,
  });

  const mergedInferences =
    Array.isArray(aiResult.data?.inferences) && aiResult.data.inferences.length > 0
      ? aiResult.data.inferences
          .filter((i) => i && typeof i.observation === 'string' && i.observation.trim())
          .slice(0, 6)
          .map((i) => ({
            observation: i.observation.trim().slice(0, 400),
            basis: (i.basis || 'Derived from provided LEED BI aggregates.').trim().slice(0, 240),
          }))
      : deterministic.inferences;

  const mergedRecommendations =
    Array.isArray(aiResult.data?.recommendations) && aiResult.data.recommendations.length > 0
      ? aiResult.data.recommendations
          .filter((r) => r && typeof r.title === 'string' && r.title.trim())
          .slice(0, 6)
          .map((r) => ({
            title: r.title.trim().slice(0, 140),
            priority: (r.priority === 'high' || r.priority === 'low' ? r.priority : 'medium') as
              | 'high'
              | 'medium'
              | 'low',
            rationale: (r.rationale || '').trim().slice(0, 400),
            suggestedAction: (r.suggestedAction || '').trim().slice(0, 300),
            requiresOwnerAction: true as const,
          }))
      : deterministic.recommendations;

  return {
    mode,
    title: spec.label,
    generatedAt: now.toISOString(),
    aiStatus: aiResult.meta,
    verifiedData: deterministic.verifiedData,
    calculatedMetrics: deterministic.calculatedMetrics,
    inferences: mergedInferences,
    recommendations: mergedRecommendations,
    unavailableDataNotes: deterministic.unavailableDataNotes,
  };
}
