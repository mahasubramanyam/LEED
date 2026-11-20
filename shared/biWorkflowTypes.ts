// Phase 16: Shared Types for Business Intelligence, Advanced Analytics, Reporting & Workflow Automation

import type {
  BiAiAnalysisMode,
  BiReportType,
  WorkflowActionType,
  WorkflowConditionField,
  WorkflowConditionOperator,
  WorkflowExecutionStatus,
  WorkflowPermittedCrmField,
  WorkflowTriggerType,
} from './biWorkflowSpecs.js';

export type MetricProvenanceType =
  | 'provider_confirmed'
  | 'manual_owner_recorded'
  | 'system_calculated';

export interface BiAnalyticsFilter {
  dateFrom?: string;
  dateTo?: string;
  country?: string;
  industry?: string;
  source?: string;
  stageId?: string;
}

export interface BiBreakdownRow {
  key: string;
  label: string;
  count: number;
  percentage: number;
}

export interface BiLeadIntelligenceMetrics {
  totalCompanies: number;
  totalDecisionMakers: number;
  verifiedLeads: number;
  unverifiedLeads: number;
  verificationRatePercent: number | null;
  newlyDiscoveredLeads: number;
  byCountry: BiBreakdownRow[];
  byIndustry: BiBreakdownRow[];
  bySource: BiBreakdownRow[];
  byLifecycleStage: BiBreakdownRow[];
  qualityDistribution: Array<{
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    count: number;
    percentage: number;
  }>;
  averageQualityScore: number | null;
}

export interface BiPipelineStageMetrics {
  stageId: string;
  stageName: string;
  stageColor?: string;
  order: number;
  leadCount: number;
  opportunityCount: number;
  valuesByCurrency: Array<{ currency: string; totalValue: number; weightedValue: number }>;
  conversionRatePercent: number | null;
  avgDaysInStage: number | null;
  maxDaysInStage: number | null;
}

export interface BiSalesPipelineMetrics {
  dataSource: 'crm_opportunities' | 'lead_pipeline_fallback';
  totalOpportunities: number;
  openOpportunities: number;
  wonOpportunities: number;
  lostOpportunities: number;
  onHoldOpportunities: number;
  winRatePercent: number | null;
  openValuesByCurrency: Array<{ currency: string; totalValue: number; weightedValue: number; count: number }>;
  wonValuesByCurrency: Array<{ currency: string; totalValue: number; count: number }>;
  lostValuesByCurrency: Array<{ currency: string; totalValue: number; count: number }>;
  stageDistribution: BiPipelineStageMetrics[];
  salesVelocity: {
    available: boolean;
    averageCycleDays: number | null;
    closedWonSampleSize: number;
    byCurrency: Array<{
      currency: string;
      averageDealValue: number;
      estimatedMonthlyVelocity: number | null;
    }>;
    insufficientDataReason?: string;
  };
}

export interface BiOutreachProvenanceMetric {
  label: string;
  value: number;
  provenance: MetricProvenanceType;
  note: string;
}

export interface BiOutreachAnalyticsSection {
  metricsWithProvenance: {
    providerConfirmedSent: BiOutreachProvenanceMetric;
    providerConfirmedFailures: BiOutreachProvenanceMetric;
    manualExternalSends: BiOutreachProvenanceMetric;
    manualRecordedReplies: BiOutreachProvenanceMetric;
    manualPositiveReplies: BiOutreachProvenanceMetric;
    confirmedMeetingsScheduled: BiOutreachProvenanceMetric;
    activeSuppressions: BiOutreachProvenanceMetric;
  };
  totals: {
    campaignsTotal: number;
    campaignsActive: number;
    enrollmentsTotal: number;
    enrollmentsActive: number;
    messagesSentViaProvider: number;
    messagesManualSent: number;
    messagesTotalDispatched: number;
    deliveryFailures: number;
    repliesReceived: number;
    positiveResponses: number;
    meetingsScheduled: number;
    activeSuppressions: number;
    followUpsCompleted: number;
    followUpsPending: number;
    followUpsOverdue: number;
    followUpsSuppressed: number;
  };
  rates: {
    replyRatePercent: number | null;
    positiveResponseRatePercent: number | null;
    meetingConversionRatePercent: number | null;
    optOutRatePercent: number | null;
    followUpCompletionRatePercent: number | null;
  };
  campaigns: Array<{
    campaignId: string;
    campaignName: string;
    status: string;
    channel: string;
    enrolled: number;
    providerSent: number;
    manualSent: number;
    failed: number;
    replies: number;
    positiveReplies: number;
    meetingsScheduled: number;
    optOuts: number;
  }>;
  unavailableMetrics: Array<{
    metric: string;
    status: 'unavailable' | 'untracked';
    reason: string;
  }>;
}

export interface BiActivityAnalyticsMetrics {
  tasksTotal: number;
  tasksCompleted: number;
  tasksPending: number;
  tasksOverdue: number;
  taskCompletionRatePercent: number | null;
  interactionsTotal: number;
  interactionsByType: BiBreakdownRow[];
  ownerActivity: Array<{
    actor: string;
    interactionsLogged: number;
    tasksCompleted: number;
    outreachActions: number;
    totalActions: number;
  }>;
  followUpPerformance: {
    crmTasksCompleted: number;
    crmTasksOverdue: number;
    outreachFollowUpsCompleted: number;
    outreachFollowUpsPending: number;
    outreachFollowUpsOverdue: number;
    outreachFollowUpsSuppressed: number;
  };
  decliningEngagement: Array<{
    entityType: 'company' | 'person';
    id: string;
    name: string;
    subtitle: string;
    recent30dInteractions: number;
    prior30dInteractions: number;
    daysSinceLastInteraction: number | null;
    reason: string;
  }>;
}

export interface BiAdvancedAnalyticsSection {
  leadAcquisitionTrends: Array<{
    period: string;
    newCompanies: number;
    verifiedCompanies: number;
    newOpportunities: number;
  }>;
  countryRegionalPerformance: Array<{
    countryCode: string;
    countryName: string;
    companies: number;
    verifiedCount: number;
    verifiedPercent: number | null;
    decisionMakers: number;
    opportunities: number;
    wonOpportunities: number;
    avgQualityScore: number | null;
  }>;
  industryOpportunityComparison: Array<{
    industry: string;
    companies: number;
    openOpportunities: number;
    wonOpportunities: number;
    lostOpportunities: number;
    winRatePercent: number | null;
    openValueSummary: string;
    avgQualityScore: number | null;
  }>;
  sourceQualityComparison: Array<{
    sourceName: string;
    leadCount: number;
    verifiedCount: number;
    verifiedPercent: number | null;
    avgQualityScore: number | null;
    opportunitiesCount: number;
    opportunityConversionPercent: number | null;
  }>;
  verificationQuality: {
    registryVerifiedCompanies: number;
    websiteInspectedCompanies: number;
    emailVerifiedCompanies: number;
    phoneVerifiedCompanies: number;
    unresolvedConflictsCount: number;
    verifiedDecisionMakers: number;
    totalDecisionMakers: number;
  };
  companyEngagementDistribution: Array<{
    tier: 'high' | 'moderate' | 'low' | 'dormant' | 'declining';
    label: string;
    count: number;
    percentage: number;
  }>;
  decisionMakerCoverage: {
    companiesWithDecisionMakers: number;
    companiesWithoutDecisionMakers: number;
    coveragePercent: number | null;
    averageDecisionMakersPerCompany: number | null;
    verifiedDecisionMakerPercent: number | null;
  };
  pipelineConversionFunnel: Array<{
    stageId: string;
    stageName: string;
    count: number;
    shareOfTotalPercent: number | null;
    stepConversionPercent: number | null;
  }>;
  outreachPerformanceOverTime: Array<{
    period: string;
    providerSent: number;
    manualSent: number;
    failed: number;
    replies: number;
    positiveReplies: number;
    meetingsScheduled: number;
  }>;
  dataCompletenessAndFreshness: {
    averageCompletenessScore: number | null;
    averageVerificationScore: number | null;
    averageFreshnessScore: number | null;
    averageOverallScore: number | null;
    staleAttributesTotal: number;
    reverificationEligibleCompanies: number;
    verificationCapAppliedCount: number;
  };
}

export interface BiDashboardResponse {
  generatedAt: string;
  filtersApplied: BiAnalyticsFilter;
  filterOptions: {
    countries: Array<{ code: string; name: string }>;
    industries: string[];
    sources: string[];
    stages: Array<{ id: string; name: string }>;
  };
  leadIntelligence: BiLeadIntelligenceMetrics;
  salesPipeline: BiSalesPipelineMetrics;
  outreachAnalytics: BiOutreachAnalyticsSection;
  activityAnalytics: BiActivityAnalyticsMetrics;
  advancedAnalytics: BiAdvancedAnalyticsSection;
  workflowSummary: {
    totalWorkflows: number;
    enabledWorkflows: number;
    totalExecutions: number;
    completedExecutions: number;
    failedExecutions: number;
    awaitingApprovalExecutions: number;
    unreadNotifications: number;
  };
  honestDisclosures: string[];
}

// ============================================================================
// WORKFLOW AUTOMATION TYPES
// ============================================================================

export interface WorkflowCondition {
  id: string;
  field: WorkflowConditionField;
  operator: WorkflowConditionOperator;
  value?: string | number | string[];
}

export interface WorkflowActionConfig {
  id: string;
  type: WorkflowActionType;
  requiresOwnerApproval?: boolean;
  // create_task
  taskTitle?: string;
  taskDescription?: string;
  taskPriority?: 'low' | 'medium' | 'high';
  taskDueInDays?: number;
  taskCategory?: 'follow_up' | 'call' | 'email' | 'meeting' | 'research' | 'proposal' | 'general';
  // add_tag
  tag?: string;
  // update_crm_field
  crmField?: WorkflowPermittedCrmField;
  crmValue?: string;
  // create_owner_notification
  notificationTitle?: string;
  notificationMessage?: string;
  notificationSeverity?: 'info' | 'warning' | 'action_required';
  // add_activity_record
  activityTitle?: string;
  activityDescription?: string;
  // request_enrichment
  enrichmentReason?: string;
  // create_follow_up_recommendation
  followUpDelayDays?: number;
  followUpNote?: string;
  // generate_ai_recommendation
  aiFocus?: string;
  // queue_owner_approval
  approvalSummary?: string;
  approvalActionType?: string;
}

export interface WorkflowTriggerConfig {
  type: WorkflowTriggerType;
  stageId?: string;
  durationDays?: number;
  opportunityOutcome?: 'won' | 'lost' | 'any';
  verificationStatus?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger: WorkflowTriggerConfig;
  conditionLogic: 'all' | 'any';
  conditions: WorkflowCondition[];
  actions: WorkflowActionConfig[];
  maxRunsPerHour: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  stats: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    skippedRuns: number;
    awaitingApprovalRuns: number;
    lastRunAt?: string;
    lastStatus?: WorkflowExecutionStatus;
  };
}

export interface WorkflowExecutionStepResult {
  stepIndex: number;
  actionId: string;
  actionType: WorkflowActionType;
  status:
    | 'succeeded'
    | 'failed'
    | 'awaiting_owner_approval'
    | 'approved_and_executed'
    | 'rejected_by_owner'
    | 'skipped_duplicate'
    | 'blocked_suppressed'
    | 'dry_run_preview';
  summary: string;
  error?: string;
  createdEntityId?: string;
  proposalId?: string;
  executedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface WorkflowExecutionRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  triggerType: WorkflowTriggerType;
  entityType: 'lead' | 'task' | 'opportunity' | 'reply' | 'follow_up' | 'system';
  entityId: string;
  companyName?: string;
  idempotencyKey: string;
  status: WorkflowExecutionStatus;
  dryRun: boolean;
  executionDepth: number;
  retryOfExecutionId?: string;
  retryCount: number;
  conditionsMatched: boolean;
  conditionDetails: Array<{
    field: string;
    operator: string;
    expected?: string;
    actual?: string;
    passed: boolean;
  }>;
  steps: WorkflowExecutionStepResult[];
  error?: string;
  actor: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface WorkflowOwnerNotification {
  id: string;
  workflowId: string;
  workflowName: string;
  executionId: string;
  leadId?: string;
  companyName?: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'action_required';
  read: boolean;
  createdAt: string;
  readAt?: string;
}

export interface BiSavedReportConfig {
  id: string;
  name: string;
  description?: string;
  reportType: BiReportType;
  filters: BiAnalyticsFilter;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BiWorkflowAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  entityType: 'workflow' | 'execution' | 'approval' | 'report' | 'notification';
  entityId: string;
  summary: string;
}

export interface BiWorkflowWorkspaceState {
  version: 1;
  workflows: WorkflowDefinition[];
  executions: WorkflowExecutionRecord[];
  notifications: WorkflowOwnerNotification[];
  savedReports: BiSavedReportConfig[];
  idempotencyLedger: Record<string, { executionId: string; recordedAt: string }>;
  auditLog: BiWorkflowAuditEntry[];
  updatedAt: string;
}

export interface BiGeneratedReport {
  reportType: BiReportType;
  title: string;
  description: string;
  generatedAt: string;
  filters: BiAnalyticsFilter;
  scheduledDeliveryAvailable: false;
  schedulingDisclosure: string;
  summaryMetrics: Array<{
    label: string;
    value: string | number;
    provenance: MetricProvenanceType;
  }>;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  totalRows: number;
}

export interface BiAiInsightResponse {
  mode: BiAiAnalysisMode;
  title: string;
  generatedAt: string;
  aiStatus: {
    mode: 'ai_assisted' | 'deterministic_fallback';
    model: string;
    warning?: string;
  };
  verifiedData: Array<{ label: string; detail: string }>;
  calculatedMetrics: Array<{ label: string; value: string; provenance: MetricProvenanceType }>;
  inferences: Array<{ observation: string; basis: string }>;
  recommendations: Array<{
    title: string;
    priority: 'high' | 'medium' | 'low';
    rationale: string;
    suggestedAction: string;
    requiresOwnerAction: true;
  }>;
  unavailableDataNotes: string[];
}
