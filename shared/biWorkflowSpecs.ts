// Phase 16: Canonical Business Intelligence, Reporting & Workflow Automation Specifications
// Shared across backend validation, workflow execution engine, BI analytics, and frontend builder UI.

export interface WorkflowTriggerSpec {
  value: WorkflowTriggerType;
  label: string;
  category: 'lead' | 'pipeline' | 'task' | 'enrichment' | 'outreach' | 'opportunity';
  executionMode: 'event_driven' | 'on_demand_sweep';
  description: string;
  requiresStageId?: boolean;
  requiresDurationDays?: boolean;
}

export const WORKFLOW_TRIGGERS = [
  {
    value: 'lead_created',
    label: 'Lead Created',
    category: 'lead',
    executionMode: 'event_driven',
    description: 'Fires when a new company record is added to LEED CRM.',
  },
  {
    value: 'lead_updated',
    label: 'Lead Updated',
    category: 'lead',
    executionMode: 'event_driven',
    description: 'Fires when an existing company record is updated in LEED CRM.',
  },
  {
    value: 'lead_entered_stage',
    label: 'Lead Enters Pipeline Stage',
    category: 'pipeline',
    executionMode: 'event_driven',
    description: 'Fires when a company moves into a specific pipeline stage.',
    requiresStageId: true,
  },
  {
    value: 'lead_stage_duration',
    label: 'Lead Remains in Stage (Duration)',
    category: 'pipeline',
    executionMode: 'on_demand_sweep',
    description: 'Evaluated on-demand when a company has remained in a stage for at least N days.',
    requiresDurationDays: true,
  },
  {
    value: 'task_overdue',
    label: 'Task Becomes Overdue',
    category: 'task',
    executionMode: 'on_demand_sweep',
    description: 'Evaluated on-demand for open tasks whose due date has passed.',
  },
  {
    value: 'enrichment_completed',
    label: 'Enrichment Completes',
    category: 'enrichment',
    executionMode: 'event_driven',
    description: 'Fires after owner-approved company enrichment changes are applied.',
  },
  {
    value: 'verification_status_changed',
    label: 'Verification Status Changes',
    category: 'enrichment',
    executionMode: 'event_driven',
    description: 'Fires when a company registry or contact verification status changes.',
  },
  {
    value: 'outreach_reply_recorded',
    label: 'Outreach Reply Recorded',
    category: 'outreach',
    executionMode: 'event_driven',
    description: 'Fires when the owner records an outreach reply from a prospect.',
  },
  {
    value: 'positive_reply_received',
    label: 'Positive Reply Received',
    category: 'outreach',
    executionMode: 'event_driven',
    description: 'Fires when a recorded reply is classified as positive, meeting interest, referral, or information request.',
  },
  {
    value: 'meeting_scheduled',
    label: 'Meeting Scheduled',
    category: 'outreach',
    executionMode: 'event_driven',
    description: 'Fires when a confirmed meeting_scheduled event is recorded.',
  },
  {
    value: 'opportunity_created',
    label: 'Opportunity Created',
    category: 'opportunity',
    executionMode: 'event_driven',
    description: 'Fires when a new commercial opportunity is created for a company.',
  },
  {
    value: 'opportunity_closed',
    label: 'Opportunity Won or Lost',
    category: 'opportunity',
    executionMode: 'event_driven',
    description: 'Fires when an opportunity transitions to won or lost status.',
  },
] as const;

export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGERS)[number]['value'];
export const WORKFLOW_TRIGGER_SET = new Set<string>(WORKFLOW_TRIGGERS.map((t) => t.value));

export const WORKFLOW_CONDITION_FIELDS = [
  { value: 'country', label: 'Country / Country Code', valueType: 'string' },
  { value: 'industry', label: 'Industry', valueType: 'string' },
  { value: 'lead_source', label: 'Lead Source', valueType: 'string' },
  { value: 'pipeline_stage', label: 'Pipeline Stage', valueType: 'string' },
  { value: 'lead_quality', label: 'Lead Data Quality Score (0-100)', valueType: 'number' },
  { value: 'verification_status', label: 'Verification Status', valueType: 'string' },
  { value: 'company_size', label: 'Company Size / Employee Range', valueType: 'string' },
  { value: 'tags', label: 'Tags', valueType: 'array' },
  { value: 'engagement', label: 'Engagement Level / Recent Interactions', valueType: 'string' },
  { value: 'opportunity_value', label: 'Opportunity Value', valueType: 'number' },
  { value: 'assigned_task_status', label: 'Assigned Task Status', valueType: 'string' },
] as const;

export type WorkflowConditionField = (typeof WORKFLOW_CONDITION_FIELDS)[number]['value'];
export const WORKFLOW_CONDITION_FIELD_SET = new Set<string>(WORKFLOW_CONDITION_FIELDS.map((f) => f.value));

export const WORKFLOW_CONDITION_OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Does not equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'in', label: 'In list (comma-separated)' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater than or equal' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less than or equal' },
  { value: 'exists', label: 'Is present / non-empty' },
  { value: 'not_exists', label: 'Is missing / empty' },
] as const;

export type WorkflowConditionOperator = (typeof WORKFLOW_CONDITION_OPERATORS)[number]['value'];
export const WORKFLOW_CONDITION_OPERATOR_SET = new Set<string>(
  WORKFLOW_CONDITION_OPERATORS.map((o) => o.value)
);

export const WORKFLOW_ACTION_TYPES = [
  {
    value: 'create_task',
    label: 'Create Task',
    requiresApprovalByDefault: false,
    blockedWhenSuppressed: false,
    description: 'Creates a deduplicated owner task linked to the company/opportunity.',
  },
  {
    value: 'add_tag',
    label: 'Add Tag',
    requiresApprovalByDefault: false,
    blockedWhenSuppressed: false,
    description: 'Appends a non-destructive tag to the company record.',
  },
  {
    value: 'update_crm_field',
    label: 'Update Permitted CRM Field',
    requiresApprovalByDefault: true,
    blockedWhenSuppressed: false,
    description: 'Proposes or applies an update to an explicitly allowlisted non-destructive CRM field.',
  },
  {
    value: 'create_owner_notification',
    label: 'Create Owner Notification',
    requiresApprovalByDefault: false,
    blockedWhenSuppressed: false,
    description: 'Posts an in-app operational alert to the owner workflow inbox.',
  },
  {
    value: 'add_activity_record',
    label: 'Add Activity Record',
    requiresApprovalByDefault: false,
    blockedWhenSuppressed: false,
    description: 'Logs a structured system/workflow activity entry on the company timeline.',
  },
  {
    value: 'request_enrichment',
    label: 'Request Enrichment (Owner Review)',
    requiresApprovalByDefault: true,
    blockedWhenSuppressed: true,
    description: 'Queues an owner-reviewed Phase 12 enrichment request (never auto-harvests contacts).',
  },
  {
    value: 'create_follow_up_recommendation',
    label: 'Create Follow-Up Recommendation',
    requiresApprovalByDefault: false,
    blockedWhenSuppressed: true,
    description: 'Schedules a contextual follow-up recommendation (hard-blocked if suppressed or do_not_contact).',
  },
  {
    value: 'generate_ai_recommendation',
    label: 'Generate AI Recommendation',
    requiresApprovalByDefault: false,
    blockedWhenSuppressed: false,
    description: 'Generates an evidence-grounded AI next-step recommendation (never sends messages or mutates CRM).',
  },
  {
    value: 'queue_owner_approval',
    label: 'Queue Action for Owner Approval',
    requiresApprovalByDefault: true,
    blockedWhenSuppressed: false,
    description: 'Creates a pending approval item in the Owner Approval Queue for explicit sign-off.',
  },
] as const;

export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number]['value'];
export const WORKFLOW_ACTION_TYPE_SET = new Set<string>(WORKFLOW_ACTION_TYPES.map((a) => a.value));

/**
 * Strictly permitted non-destructive CRM fields for update_crm_field workflow actions.
 * Destructive fields, suppression overrides, and billing/auth fields are permanently excluded.
 */
export const WORKFLOW_PERMITTED_CRM_FIELDS = [
  'industry',
  'category',
  'employeeRange',
  'relationshipStatus',
  'nextFollowUpDate',
  'priorityNote',
] as const;

export type WorkflowPermittedCrmField = (typeof WORKFLOW_PERMITTED_CRM_FIELDS)[number];
export const WORKFLOW_PERMITTED_CRM_FIELD_SET = new Set<string>(WORKFLOW_PERMITTED_CRM_FIELDS);

/**
 * Permanently forbidden action names (defense-in-depth server validation).
 */
export const WORKFLOW_PROHIBITED_ACTIONS = new Set<string>([
  'send_email',
  'dispatch_email',
  'auto_send_email',
  'send_linkedin',
  'linkedin_message',
  'send_whatsapp',
  'send_sms',
  'harvest_contacts',
  'scrape_contacts',
  'delete_lead',
  'bulk_delete',
  'delete_company',
  'remove_suppression',
  'clear_do_not_contact',
  'execute_sql',
  'run_shell',
  'exec_command',
  'http_request',
  'webhook_call',
  'write_file',
]);

export const WORKFLOW_EXECUTION_STATUSES = [
  'completed',
  'awaiting_approval',
  'partial_failure',
  'failed',
  'skipped',
  'dry_run',
] as const;

export type WorkflowExecutionStatus = (typeof WORKFLOW_EXECUTION_STATUSES)[number];

export const WORKFLOW_SAFETY_LIMITS = {
  MAX_CONDITIONS_PER_WORKFLOW: 15,
  MAX_ACTIONS_PER_WORKFLOW: 10,
  MAX_WORKFLOWS_PER_EVENT: 20,
  MAX_RECURSION_DEPTH: 1,
  DEFAULT_MAX_RUNS_PER_HOUR: 50,
  ABSOLUTE_MAX_RUNS_PER_HOUR: 200,
} as const;

export const BI_REPORT_TYPES = [
  {
    value: 'executive_overview',
    label: 'Executive BI Overview',
    description: 'Cross-functional KPI summary covering leads, pipeline, outreach, activity, and quality.',
  },
  {
    value: 'pipeline_performance',
    label: 'Sales Pipeline & Opportunities',
    description: 'Stage distribution, multi-currency values, conversion rates, stage aging, and win/loss breakdown.',
  },
  {
    value: 'outreach_performance',
    label: 'Outreach & Follow-Up Performance',
    description: 'Campaign sends, manual sends, replies, meetings scheduled, suppressions, with provenance labels.',
  },
  {
    value: 'lead_quality',
    label: 'Lead Intelligence & Quality Distribution',
    description: 'Country, industry, source quality comparisons, decision-maker coverage, and verification tiers.',
  },
  {
    value: 'data_quality',
    label: 'Data Completeness, Verification & Freshness',
    description: 'Company data quality grades, stale attributes, conflicts, and re-verification backlog.',
  },
  {
    value: 'workflow_operations',
    label: 'Workflow Automation Operations',
    description: 'Active workflows, execution counts, success/failure rates, pending approvals, and compliance blocks.',
  },
] as const;

export type BiReportType = (typeof BI_REPORT_TYPES)[number]['value'];
export const BI_REPORT_TYPE_SET = new Set<string>(BI_REPORT_TYPES.map((r) => r.value));

export const BI_AI_ANALYSIS_MODES = [
  { value: 'analytics_explanation', label: 'Analytics Explanation' },
  { value: 'trend_summary', label: 'Trend Summary' },
  { value: 'opportunity_identification', label: 'Opportunity Identification' },
  { value: 'underperforming_campaigns', label: 'Underperforming Campaign Analysis' },
  { value: 'workflow_improvements', label: 'Recommended Workflow Improvements' },
  { value: 'daily_briefing', label: 'Daily Business Briefing' },
  { value: 'weekly_briefing', label: 'Weekly Business Briefing' },
  { value: 'strategic_recommendations', label: 'Strategic Recommendations' },
] as const;

export type BiAiAnalysisMode = (typeof BI_AI_ANALYSIS_MODES)[number]['value'];
export const BI_AI_ANALYSIS_MODE_SET = new Set<string>(BI_AI_ANALYSIS_MODES.map((m) => m.value));
