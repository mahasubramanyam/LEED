// Phase 16: Rule-Based Workflow Automation Engine (TRIGGER -> CONDITIONS -> ACTIONS)
// Enforces:
// - Strict server-side allowlists for triggers, condition fields/operators, and authorized actions
// - Unconditional block on automatic external email/LinkedIn sending, contact harvesting, destructive CRM ops, SQL/shell/HTTP/FS execution
// - Suppression, opt-out & do_not_contact enforcement via Phase 15 suppressionCompliance
// - Recursion & loop prevention (executionDepth + visitedWorkflowIds)
// - Restart-safe idempotency ledger
// - Duplicate task prevention
// - Execution rate limits (maxRunsPerHour & max workflows/actions per event)
// - Owner approval gates integrated with Phase 14 AI Action Proposal queue
// - Step-level failure recovery & idempotent retries

import crypto from 'crypto';
import {
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_ACTION_TYPE_SET,
  WORKFLOW_CONDITION_FIELD_SET,
  WORKFLOW_CONDITION_OPERATOR_SET,
  WORKFLOW_PERMITTED_CRM_FIELD_SET,
  WORKFLOW_PROHIBITED_ACTIONS,
  WORKFLOW_SAFETY_LIMITS,
  WORKFLOW_TRIGGER_SET,
  type WorkflowActionType,
  type WorkflowTriggerType,
} from '../../shared/biWorkflowSpecs.js';
import type {
  WorkflowActionConfig,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowExecutionRecord,
  WorkflowExecutionStepResult,
  WorkflowOwnerNotification,
  WorkflowTriggerConfig,
} from '../../shared/biWorkflowTypes.js';
import type { CanonicalLead, CrmOpportunity, LeadTask, OutreachReplyRecord } from '../types.js';
import {
  CrmStorageFacade,
  createExtendedTask,
  getEntityInteractions,
  getEntityRelationshipMeta,
  listAllCrmOpportunities,
  listAllExtendedTasks,
  updateCompanyRelationshipMeta,
} from '../crm/crmStoreHelper.js';
import { evaluateCompanyDataQuality } from '../enrichment/dataQualityEngine.js';
import { addAiActionProposals, generateAiId } from '../ai/aiStoreHelper.js';
import { getOutreachWorkspaceState, saveOutreachWorkspaceState } from '../outreach/outreachStoreHelper.js';
import { checkSuppressionStatus } from '../outreach/suppressionCompliance.js';
import { scheduleContextualFollowUp } from '../outreach/followUpScheduler.js';
import {
  appendBiWorkflowAudit,
  generateBiWorkflowId,
  getBiWorkflowWorkspaceState,
  saveBiWorkflowWorkspaceState,
  withBiWorkflowLock,
} from './biWorkflowStoreHelper.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const DANGEROUS_TEXT_PATTERN =
  /(\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\bUNION\s+SELECT\b|\bALTER\s+TABLE\b|;\s*SELECT\b|\bchild_process\b|\bexecSync\b|\bspawnSync\b|\brm\s+-rf\b|\bcurl\s+http|\beval\s*\()/i;

export class WorkflowValidationError extends Error {
  public readonly code: string;
  public readonly details: string[];

  constructor(message: string, code = 'INVALID_WORKFLOW_CONFIG', details: string[] = []) {
    super(message);
    this.name = 'WorkflowValidationError';
    this.code = code;
    this.details = details;
  }
}

export interface WorkflowEventPayload {
  triggerType: WorkflowTriggerType;
  entityType: WorkflowExecutionRecord['entityType'];
  entityId: string;
  eventKey: string;
  leadId?: string;
  personId?: string;
  stageId?: string;
  opportunity?: CrmOpportunity;
  opportunityOutcome?: 'won' | 'lost';
  task?: LeadTask;
  reply?: OutreachReplyRecord;
  verificationStatus?: string;
  actor?: string;
  executionDepth?: number;
  visitedWorkflowIds?: string[];
  now?: Date;
}

// ============================================================================
// SERVER-SIDE CONFIGURATION VALIDATION
// ============================================================================

export function validateWorkflowDefinitionInput(raw: Record<string, unknown>): {
  name: string;
  description?: string;
  enabled: boolean;
  trigger: WorkflowTriggerConfig;
  conditionLogic: 'all' | 'any';
  conditions: WorkflowCondition[];
  actions: WorkflowActionConfig[];
  maxRunsPerHour: number;
} {
  const errors: string[] = [];

  const serialized = JSON.stringify(raw || {});
  if (serialized.length > 32000) {
    throw new WorkflowValidationError(
      'Workflow configuration exceeds maximum permitted payload size.',
      'WORKFLOW_PAYLOAD_TOO_LARGE'
    );
  }
  if (DANGEROUS_TEXT_PATTERN.test(serialized)) {
    throw new WorkflowValidationError(
      'Workflow configuration blocked: unsafe SQL, shell, or code-execution pattern detected.',
      'WORKFLOW_UNSAFE_PAYLOAD'
    );
  }

  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 140) : '';
  if (!name) errors.push('Workflow name is required.');

  const description =
    typeof raw.description === 'string' && raw.description.trim()
      ? raw.description.trim().slice(0, 500)
      : undefined;

  const triggerRaw = (raw.trigger || {}) as Record<string, unknown>;
  const triggerType = typeof triggerRaw.type === 'string' ? triggerRaw.type.trim() : '';
  if (!WORKFLOW_TRIGGER_SET.has(triggerType)) {
    errors.push(`Unsupported workflow trigger "${triggerType || '(missing)'}".`);
  }

  const trigger: WorkflowTriggerConfig = {
    type: triggerType as WorkflowTriggerType,
    stageId: typeof triggerRaw.stageId === 'string' && triggerRaw.stageId.trim() ? triggerRaw.stageId.trim() : undefined,
    durationDays:
      triggerRaw.durationDays !== undefined && Number.isFinite(Number(triggerRaw.durationDays))
        ? Math.min(365, Math.max(1, Math.round(Number(triggerRaw.durationDays))))
        : undefined,
    opportunityOutcome:
      triggerRaw.opportunityOutcome === 'won' ||
      triggerRaw.opportunityOutcome === 'lost' ||
      triggerRaw.opportunityOutcome === 'any'
        ? triggerRaw.opportunityOutcome
        : undefined,
    verificationStatus:
      typeof triggerRaw.verificationStatus === 'string' && triggerRaw.verificationStatus.trim()
        ? triggerRaw.verificationStatus.trim().slice(0, 60)
        : undefined,
  };

  if (trigger.type === 'lead_stage_duration' && !trigger.durationDays) {
    trigger.durationDays = 7;
  }

  const conditionLogic: 'all' | 'any' = raw.conditionLogic === 'any' ? 'any' : 'all';

  const rawConditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  if (rawConditions.length > WORKFLOW_SAFETY_LIMITS.MAX_CONDITIONS_PER_WORKFLOW) {
    errors.push(`Maximum ${WORKFLOW_SAFETY_LIMITS.MAX_CONDITIONS_PER_WORKFLOW} conditions permitted per workflow.`);
  }
  const conditions: WorkflowCondition[] = [];
  for (let i = 0; i < rawConditions.length; i++) {
    const c = (rawConditions[i] || {}) as Record<string, unknown>;
    const field = typeof c.field === 'string' ? c.field.trim() : '';
    const operator = typeof c.operator === 'string' ? c.operator.trim() : '';
    if (!WORKFLOW_CONDITION_FIELD_SET.has(field)) {
      errors.push(`Condition #${i + 1}: unsupported field "${field || '(missing)'}".`);
      continue;
    }
    if (!WORKFLOW_CONDITION_OPERATOR_SET.has(operator)) {
      errors.push(`Condition #${i + 1}: unsupported operator "${operator || '(missing)'}".`);
      continue;
    }
    conditions.push({
      id: typeof c.id === 'string' && c.id.trim() ? c.id.trim().slice(0, 60) : generateBiWorkflowId('cond'),
      field: field as WorkflowCondition['field'],
      operator: operator as WorkflowCondition['operator'],
      value:
        Array.isArray(c.value)
          ? c.value.map((v) => String(v).trim()).filter(Boolean).slice(0, 30)
          : typeof c.value === 'number'
            ? c.value
            : typeof c.value === 'string'
              ? c.value.trim().slice(0, 200)
              : undefined,
    });
  }

  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  if (rawActions.length === 0) {
    errors.push('At least one authorized workflow action is required.');
  }
  if (rawActions.length > WORKFLOW_SAFETY_LIMITS.MAX_ACTIONS_PER_WORKFLOW) {
    errors.push(`Maximum ${WORKFLOW_SAFETY_LIMITS.MAX_ACTIONS_PER_WORKFLOW} actions permitted per workflow.`);
  }

  const actions: WorkflowActionConfig[] = [];
  for (let i = 0; i < rawActions.length; i++) {
    const a = (rawActions[i] || {}) as Record<string, unknown>;
    const actionType = typeof a.type === 'string' ? a.type.trim() : '';
    if (WORKFLOW_PROHIBITED_ACTIONS.has(actionType.toLowerCase())) {
      throw new WorkflowValidationError(
        `Action "${actionType}" is strictly prohibited by LEED workflow safety policy (no automated external sending, contact harvesting, destructive CRM deletes, or arbitrary execution).`,
        'PROHIBITED_WORKFLOW_ACTION',
        [`Prohibited action: ${actionType}`]
      );
    }
    if (!WORKFLOW_ACTION_TYPE_SET.has(actionType)) {
      errors.push(`Action #${i + 1}: unauthorized action type "${actionType || '(missing)'}".`);
      continue;
    }

    const spec = WORKFLOW_ACTION_TYPES.find((s) => s.value === actionType)!;
    const config: WorkflowActionConfig = {
      id: typeof a.id === 'string' && a.id.trim() ? a.id.trim().slice(0, 60) : generateBiWorkflowId('act'),
      type: actionType as WorkflowActionType,
      requiresOwnerApproval:
        a.requiresOwnerApproval !== undefined
          ? Boolean(a.requiresOwnerApproval)
          : spec.requiresApprovalByDefault,
    };

    if (actionType === 'create_task') {
      config.taskTitle = typeof a.taskTitle === 'string' && a.taskTitle.trim() ? a.taskTitle.trim().slice(0, 160) : 'Follow up on {{company_name}}';
      config.taskDescription = typeof a.taskDescription === 'string' ? a.taskDescription.trim().slice(0, 500) : undefined;
      config.taskPriority = a.taskPriority === 'high' || a.taskPriority === 'low' ? a.taskPriority : 'medium';
      config.taskDueInDays = Number.isFinite(Number(a.taskDueInDays))
        ? Math.min(90, Math.max(0, Math.round(Number(a.taskDueInDays))))
        : 2;
      config.taskCategory =
        typeof a.taskCategory === 'string' &&
        ['follow_up', 'call', 'email', 'meeting', 'research', 'proposal', 'general'].includes(a.taskCategory)
          ? (a.taskCategory as WorkflowActionConfig['taskCategory'])
          : 'follow_up';
    } else if (actionType === 'add_tag') {
      const tag = typeof a.tag === 'string' ? a.tag.trim().slice(0, 60) : '';
      if (!tag) errors.push(`Action #${i + 1} (add_tag): tag value is required.`);
      config.tag = tag;
    } else if (actionType === 'update_crm_field') {
      const field = typeof a.crmField === 'string' ? a.crmField.trim() : '';
      if (!WORKFLOW_PERMITTED_CRM_FIELD_SET.has(field)) {
        errors.push(`Action #${i + 1} (update_crm_field): field "${field || '(missing)'}" is not in the permitted non-destructive CRM field allowlist.`);
      }
      const val = typeof a.crmValue === 'string' ? a.crmValue.trim().slice(0, 200) : '';
      if (!val) errors.push(`Action #${i + 1} (update_crm_field): crmValue is required.`);
      config.crmField = field as WorkflowActionConfig['crmField'];
      config.crmValue = val;
      // Sensitive CRM field updates always require owner approval by policy
      config.requiresOwnerApproval = true;
    } else if (actionType === 'create_owner_notification') {
      config.notificationTitle =
        typeof a.notificationTitle === 'string' && a.notificationTitle.trim()
          ? a.notificationTitle.trim().slice(0, 140)
          : 'Workflow Alert: {{company_name}}';
      config.notificationMessage =
        typeof a.notificationMessage === 'string' && a.notificationMessage.trim()
          ? a.notificationMessage.trim().slice(0, 600)
          : 'Triggered by workflow rule.';
      config.notificationSeverity =
        a.notificationSeverity === 'warning' || a.notificationSeverity === 'action_required'
          ? a.notificationSeverity
          : 'info';
    } else if (actionType === 'add_activity_record') {
      config.activityTitle =
        typeof a.activityTitle === 'string' && a.activityTitle.trim()
          ? a.activityTitle.trim().slice(0, 140)
          : 'Workflow Activity';
      config.activityDescription =
        typeof a.activityDescription === 'string' && a.activityDescription.trim()
          ? a.activityDescription.trim().slice(0, 500)
          : 'Logged automatically by owner-configured workflow.';
    } else if (actionType === 'request_enrichment') {
      config.enrichmentReason =
        typeof a.enrichmentReason === 'string' && a.enrichmentReason.trim()
          ? a.enrichmentReason.trim().slice(0, 300)
          : 'Workflow requested Phase 12 enrichment review.';
      config.requiresOwnerApproval = true;
    } else if (actionType === 'create_follow_up_recommendation') {
      config.followUpDelayDays = Number.isFinite(Number(a.followUpDelayDays))
        ? Math.min(60, Math.max(0, Math.round(Number(a.followUpDelayDays))))
        : 2;
      config.followUpNote =
        typeof a.followUpNote === 'string' && a.followUpNote.trim()
          ? a.followUpNote.trim().slice(0, 400)
          : 'Recommended follow-up generated by workflow.';
    } else if (actionType === 'generate_ai_recommendation') {
      config.aiFocus =
        typeof a.aiFocus === 'string' && a.aiFocus.trim()
          ? a.aiFocus.trim().slice(0, 240)
          : 'Analyze relationship status and suggest next best commercial step.';
    } else if (actionType === 'queue_owner_approval') {
      config.approvalSummary =
        typeof a.approvalSummary === 'string' && a.approvalSummary.trim()
          ? a.approvalSummary.trim().slice(0, 300)
          : 'Owner review required for {{company_name}}.';
      config.approvalActionType =
        typeof a.approvalActionType === 'string' && a.approvalActionType.trim()
          ? a.approvalActionType.trim().slice(0, 60)
          : 'schedule_review';
      config.requiresOwnerApproval = true;
    }

    actions.push(config);
  }

  if (errors.length > 0) {
    throw new WorkflowValidationError(errors[0], 'INVALID_WORKFLOW_CONFIG', errors);
  }

  const maxRunsPerHour =
    raw.maxRunsPerHour !== undefined && Number.isFinite(Number(raw.maxRunsPerHour))
      ? Math.min(
          WORKFLOW_SAFETY_LIMITS.ABSOLUTE_MAX_RUNS_PER_HOUR,
          Math.max(1, Math.round(Number(raw.maxRunsPerHour)))
        )
      : WORKFLOW_SAFETY_LIMITS.DEFAULT_MAX_RUNS_PER_HOUR;

  return {
    name,
    description,
    enabled: raw.enabled !== false,
    trigger,
    conditionLogic,
    conditions,
    actions,
    maxRunsPerHour,
  };
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

export async function listWorkflowsWorkspace(facade: CrmStorageFacade) {
  const ws = await getBiWorkflowWorkspaceState(facade);
  return {
    workflows: ws.workflows,
    executions: ws.executions.slice(0, 120),
    notifications: ws.notifications.slice(0, 80),
    auditLog: ws.auditLog.slice(0, 80),
    stats: {
      totalWorkflows: ws.workflows.length,
      enabledWorkflows: ws.workflows.filter((w) => w.enabled).length,
      totalExecutions: ws.executions.length,
      completedExecutions: ws.executions.filter((e) => e.status === 'completed').length,
      failedExecutions: ws.executions.filter((e) => e.status === 'failed' || e.status === 'partial_failure').length,
      awaitingApprovalExecutions: ws.executions.filter((e) => e.status === 'awaiting_approval').length,
      unreadNotifications: ws.notifications.filter((n) => !n.read).length,
    },
    schedulingDisclosure:
      'Event-driven triggers execute automatically on CRM/outreach mutations. Time-based triggers (stage duration, overdue tasks) execute strictly on-demand via manual sweep — no hidden background cron worker is claimed.',
  };
}

export async function createWorkflowDefinition(
  facade: CrmStorageFacade,
  input: Record<string, unknown>,
  actor: string
): Promise<WorkflowDefinition> {
  const validated = validateWorkflowDefinitionInput(input);
  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const now = new Date().toISOString();
    const workflow: WorkflowDefinition = {
      id: generateBiWorkflowId('wf'),
      ...validated,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
      stats: {
        totalRuns: 0,
        completedRuns: 0,
        failedRuns: 0,
        skippedRuns: 0,
        awaitingApprovalRuns: 0,
      },
    };
    ws.workflows = [workflow, ...ws.workflows];
    appendBiWorkflowAudit(ws, {
      actor,
      action: 'workflow_created',
      entityType: 'workflow',
      entityId: workflow.id,
      summary: `Created workflow "${workflow.name}" (${workflow.trigger.type} -> ${workflow.actions.length} action(s)).`,
    });
    await saveBiWorkflowWorkspaceState(facade, ws);
    return workflow;
  });
}

export async function updateWorkflowDefinition(
  facade: CrmStorageFacade,
  workflowId: string,
  input: Record<string, unknown>,
  actor: string
): Promise<WorkflowDefinition> {
  const validated = validateWorkflowDefinitionInput(input);
  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const idx = ws.workflows.findIndex((w) => w.id === workflowId);
    if (idx === -1) throw new Error(`Workflow "${workflowId}" not found.`);
    const now = new Date().toISOString();
    const updated: WorkflowDefinition = {
      ...ws.workflows[idx],
      ...validated,
      updatedAt: now,
    };
    ws.workflows[idx] = updated;
    appendBiWorkflowAudit(ws, {
      actor,
      action: 'workflow_updated',
      entityType: 'workflow',
      entityId: updated.id,
      summary: `Updated workflow "${updated.name}".`,
    });
    await saveBiWorkflowWorkspaceState(facade, ws);
    return updated;
  });
}

export async function toggleWorkflowEnabled(
  facade: CrmStorageFacade,
  workflowId: string,
  enabled: boolean,
  actor: string
): Promise<WorkflowDefinition> {
  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const wf = ws.workflows.find((w) => w.id === workflowId);
    if (!wf) throw new Error(`Workflow "${workflowId}" not found.`);
    wf.enabled = Boolean(enabled);
    wf.updatedAt = new Date().toISOString();
    appendBiWorkflowAudit(ws, {
      actor,
      action: wf.enabled ? 'workflow_enabled' : 'workflow_disabled',
      entityType: 'workflow',
      entityId: wf.id,
      summary: `${wf.enabled ? 'Enabled' : 'Disabled'} workflow "${wf.name}".`,
    });
    await saveBiWorkflowWorkspaceState(facade, ws);
    return wf;
  });
}

export async function deleteWorkflowDefinition(
  facade: CrmStorageFacade,
  workflowId: string,
  actor: string
): Promise<boolean> {
  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const target = ws.workflows.find((w) => w.id === workflowId);
    if (!target) return false;
    ws.workflows = ws.workflows.filter((w) => w.id !== workflowId);
    appendBiWorkflowAudit(ws, {
      actor,
      action: 'workflow_deleted',
      entityType: 'workflow',
      entityId: workflowId,
      summary: `Deleted workflow "${target.name}".`,
    });
    await saveBiWorkflowWorkspaceState(facade, ws);
    return true;
  });
}

export async function markWorkflowNotificationRead(
  facade: CrmStorageFacade,
  notificationId: string
): Promise<WorkflowOwnerNotification> {
  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const item = ws.notifications.find((n) => n.id === notificationId);
    if (!item) throw new Error(`Notification "${notificationId}" not found.`);
    item.read = true;
    item.readAt = new Date().toISOString();
    await saveBiWorkflowWorkspaceState(facade, ws);
    return item;
  });
}

// ============================================================================
// CONDITION EVALUATION
// ============================================================================

interface ConditionEvaluationContext {
  lead?: CanonicalLead | null;
  opportunity?: CrmOpportunity | null;
  tasks: LeadTask[];
  qualityScore: number | null;
  verificationStatus: string;
  engagementTier: string;
  opportunityValue: number;
}

function interpolateTemplate(template: string, lead?: CanonicalLead | null, wfName?: string): string {
  return template
    .replace(/\{\{\s*company_name\s*\}\}/gi, lead?.companyName || 'Company')
    .replace(/\{\{\s*country\s*\}\}/gi, lead?.address?.country || lead?.address?.countryCode || 'Unknown')
    .replace(/\{\{\s*industry\s*\}\}/gi, lead?.industry || 'Unspecified')
    .replace(/\{\{\s*workflow_name\s*\}\}/gi, wfName || 'Workflow');
}

function extractFieldValue(field: WorkflowCondition['field'], ctx: ConditionEvaluationContext): unknown {
  const lead = ctx.lead;
  switch (field) {
    case 'country':
      return [lead?.address?.countryCode, lead?.address?.country].filter(Boolean).join(' ');
    case 'industry':
      return lead?.industry || '';
    case 'lead_source':
      return lead?.sources?.[0]?.sourceName || '';
    case 'pipeline_stage':
      return ctx.opportunity?.pipelineStageId || lead?.pipelineStageId || '';
    case 'lead_quality':
      return ctx.qualityScore ?? lead?.confidenceScore ?? 0;
    case 'verification_status':
      return ctx.verificationStatus;
    case 'company_size':
      return lead?.employeeRange || '';
    case 'tags':
      return lead?.tags || [];
    case 'engagement':
      return ctx.engagementTier;
    case 'opportunity_value':
      return ctx.opportunityValue;
    case 'assigned_task_status': {
      const leadTasks = ctx.tasks.filter((t) => !lead || t.leadId === lead.id);
      if (leadTasks.some((t) => !t.completed && t.status !== 'completed' && new Date(t.dueDate).getTime() < Date.now())) {
        return 'overdue';
      }
      if (leadTasks.some((t) => !t.completed && t.status !== 'completed')) return 'open';
      if (leadTasks.some((t) => t.completed || t.status === 'completed')) return 'completed';
      return 'none';
    }
    default:
      return '';
  }
}

export function evaluateWorkflowCondition(
  condition: WorkflowCondition,
  ctx: ConditionEvaluationContext
): { passed: boolean; actual: string; expected: string } {
  const rawActual = extractFieldValue(condition.field, ctx);
  const actualStr = Array.isArray(rawActual) ? rawActual.join(', ') : String(rawActual ?? '');
  const expectedStr = Array.isArray(condition.value)
    ? condition.value.join(', ')
    : String(condition.value ?? '');

  const actualLower = actualStr.toLowerCase().trim();
  const expectedLower = expectedStr.toLowerCase().trim();
  const actualNum = typeof rawActual === 'number' ? rawActual : Number(actualStr);
  const expectedNum = Number(expectedStr);

  switch (condition.operator) {
    case 'exists':
      return {
        passed: Array.isArray(rawActual) ? rawActual.length > 0 : actualLower.length > 0,
        actual: actualStr,
        expected: '(exists)',
      };
    case 'not_exists':
      return {
        passed: Array.isArray(rawActual) ? rawActual.length === 0 : actualLower.length === 0,
        actual: actualStr,
        expected: '(empty)',
      };
    case 'equals':
      if (condition.field === 'country' && ctx.lead) {
        const cc = (ctx.lead.address?.countryCode || '').toLowerCase();
        const cn = (ctx.lead.address?.country || '').toLowerCase();
        return { passed: cc === expectedLower || cn === expectedLower, actual: actualStr, expected: expectedStr };
      }
      if (Array.isArray(rawActual)) {
        return {
          passed: rawActual.some((v) => String(v).toLowerCase().trim() === expectedLower),
          actual: actualStr,
          expected: expectedStr,
        };
      }
      return { passed: actualLower === expectedLower, actual: actualStr, expected: expectedStr };
    case 'not_equals':
      if (condition.field === 'country' && ctx.lead) {
        const cc = (ctx.lead.address?.countryCode || '').toLowerCase();
        const cn = (ctx.lead.address?.country || '').toLowerCase();
        return { passed: cc !== expectedLower && cn !== expectedLower, actual: actualStr, expected: expectedStr };
      }
      if (Array.isArray(rawActual)) {
        return {
          passed: !rawActual.some((v) => String(v).toLowerCase().trim() === expectedLower),
          actual: actualStr,
          expected: expectedStr,
        };
      }
      return { passed: actualLower !== expectedLower, actual: actualStr, expected: expectedStr };
    case 'contains':
      return { passed: actualLower.includes(expectedLower) && expectedLower.length > 0, actual: actualStr, expected: expectedStr };
    case 'not_contains':
      return { passed: !actualLower.includes(expectedLower), actual: actualStr, expected: expectedStr };
    case 'in': {
      const list = (Array.isArray(condition.value) ? condition.value : expectedStr.split(','))
        .map((v) => String(v).toLowerCase().trim())
        .filter(Boolean);
      if (condition.field === 'country' && ctx.lead) {
        const cc = (ctx.lead.address?.countryCode || '').toLowerCase();
        const cn = (ctx.lead.address?.country || '').toLowerCase();
        return { passed: list.includes(cc) || list.includes(cn), actual: actualStr, expected: expectedStr };
      }
      if (Array.isArray(rawActual)) {
        return {
          passed: rawActual.some((v) => list.includes(String(v).toLowerCase().trim())),
          actual: actualStr,
          expected: expectedStr,
        };
      }
      return { passed: list.includes(actualLower), actual: actualStr, expected: expectedStr };
    }
    case 'gt':
      return { passed: Number.isFinite(actualNum) && Number.isFinite(expectedNum) && actualNum > expectedNum, actual: actualStr, expected: expectedStr };
    case 'gte':
      return { passed: Number.isFinite(actualNum) && Number.isFinite(expectedNum) && actualNum >= expectedNum, actual: actualStr, expected: expectedStr };
    case 'lt':
      return { passed: Number.isFinite(actualNum) && Number.isFinite(expectedNum) && actualNum < expectedNum, actual: actualStr, expected: expectedStr };
    case 'lte':
      return { passed: Number.isFinite(actualNum) && Number.isFinite(expectedNum) && actualNum <= expectedNum, actual: actualStr, expected: expectedStr };
    default:
      return { passed: false, actual: actualStr, expected: expectedStr };
  }
}

// ============================================================================
// EXECUTION ENGINE (WITH SAFETY, IDEMPOTENCY, RECURSION & RECOVERY)
// ============================================================================

export function buildWorkflowIdempotencyKey(parts: {
  workflowId: string;
  triggerType: WorkflowTriggerType;
  entityId: string;
  eventKey: string;
}): string {
  const raw = `${parts.workflowId}|${parts.triggerType}|${parts.entityId}|${parts.eventKey}`;
  return `wf-idem-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
}

async function buildConditionContext(
  facade: CrmStorageFacade,
  event: WorkflowEventPayload,
  nowMs: number
): Promise<ConditionEvaluationContext> {
  const lead = event.leadId ? await facade.getLead(event.leadId) : null;
  const [tasks, opps] = await Promise.all([
    listAllExtendedTasks(facade),
    lead ? listAllCrmOpportunities(facade, { leadId: lead.id }) : Promise.resolve([]),
  ]);

  let qualityScore: number | null = null;
  let verificationStatus = event.verificationStatus || 'unverified';
  let engagementTier = 'dormant';

  if (lead) {
    const dq = evaluateCompanyDataQuality(lead, { nowMs });
    qualityScore = dq.overallScore;
    if (
      lead.customFields?.registryVerificationState === 'officially_verified' ||
      (lead.identifiers || []).some((id) => id.verified || id.status === 'officially_verified')
    ) {
      verificationStatus = 'officially_verified';
    } else if (lead.emailStatus === 'verified') {
      verificationStatus = 'contact_verified';
    } else if (lead.webMetadata?.inspectedAt) {
      verificationStatus = 'web_observed';
    } else {
      verificationStatus = event.verificationStatus || 'unverified';
    }

    const ints = getEntityInteractions(lead.customFields);
    const recent30 = ints.filter((i) => nowMs - new Date(i.occurredAt || i.createdAt).getTime() <= 30 * DAY_MS).length;
    if (recent30 >= 3) engagementTier = 'high';
    else if (recent30 >= 1) engagementTier = 'moderate';
    else if (ints.length > 0) engagementTier = 'low';
    else engagementTier = 'dormant';
  }

  const opp = event.opportunity || opps.find((o) => o.status === 'open') || opps[0] || null;
  const opportunityValue = opp?.estimatedValue ?? lead?.opportunityValue ?? 0;

  return {
    lead,
    opportunity: opp,
    tasks,
    qualityScore,
    verificationStatus,
    engagementTier,
    opportunityValue,
  };
}

function triggerMatchesEvent(wf: WorkflowDefinition, event: WorkflowEventPayload): boolean {
  if (wf.trigger.type !== event.triggerType) return false;
  if (wf.trigger.type === 'lead_entered_stage' && wf.trigger.stageId && event.stageId !== wf.trigger.stageId) {
    return false;
  }
  if (
    wf.trigger.type === 'opportunity_closed' &&
    wf.trigger.opportunityOutcome &&
    wf.trigger.opportunityOutcome !== 'any' &&
    event.opportunityOutcome !== wf.trigger.opportunityOutcome
  ) {
    return false;
  }
  if (
    wf.trigger.type === 'verification_status_changed' &&
    wf.trigger.verificationStatus &&
    event.verificationStatus &&
    wf.trigger.verificationStatus.toLowerCase() !== event.verificationStatus.toLowerCase()
  ) {
    return false;
  }
  return true;
}

// Optional test hook to simulate a single action failure deterministically for recovery tests
let testActionFailureInjector: ((action: WorkflowActionConfig, attempt: number) => string | null) | null = null;
export function setWorkflowActionFailureInjectorForTests(
  fn: ((action: WorkflowActionConfig, attempt: number) => string | null) | null
): void {
  testActionFailureInjector = fn;
}

async function executeSingleWorkflowAction(params: {
  facade: CrmStorageFacade;
  workflow: WorkflowDefinition;
  action: WorkflowActionConfig;
  stepIndex: number;
  executionId: string;
  lead?: CanonicalLead | null;
  personId?: string;
  actor: string;
  dryRun: boolean;
  attemptNumber: number;
  now: Date;
  notificationsOut: WorkflowOwnerNotification[];
}): Promise<WorkflowExecutionStepResult> {
  const { facade, workflow, action, stepIndex, executionId, lead, personId, actor, dryRun, attemptNumber, now, notificationsOut } = params;
  const nowIso = now.toISOString();

  // Safety check: defense-in-depth prohibited action guard at execution time too
  if (WORKFLOW_PROHIBITED_ACTIONS.has(String(action.type).toLowerCase()) || !WORKFLOW_ACTION_TYPE_SET.has(action.type)) {
    return {
      stepIndex,
      actionId: action.id,
      actionType: action.type,
      status: 'failed',
      summary: `Blocked unauthorized workflow action "${action.type}".`,
      error: 'Action is prohibited by workflow security policy.',
      executedAt: nowIso,
    };
  }

  if (testActionFailureInjector) {
    const injectedErr = testActionFailureInjector(action, attemptNumber);
    if (injectedErr) {
      return {
        stepIndex,
        actionId: action.id,
        actionType: action.type,
        status: 'failed',
        summary: `Step "${action.type}" failed during execution.`,
        error: injectedErr,
        executedAt: nowIso,
      };
    }
  }

  // Suppression & do_not_contact check for outreach/enrichment actions
  const actionSpec = WORKFLOW_ACTION_TYPES.find((s) => s.value === action.type);
  if (actionSpec?.blockedWhenSuppressed && lead) {
    const [outreachWs, settings] = await Promise.all([
      getOutreachWorkspaceState(facade),
      facade.getSettings(),
    ]);
    const person = personId ? await facade.getPersonById(personId) : null;
    const suppression = checkSuppressionStatus({
      ws: outreachWs,
      settings,
      lead,
      person,
      recipientEmail: person?.email || lead.email,
    });
    if (suppression.suppressed) {
      return {
        stepIndex,
        actionId: action.id,
        actionType: action.type,
        status: 'blocked_suppressed',
        summary: `Blocked by suppression/do_not_contact compliance: ${suppression.reasons.join(' ')}`,
        executedAt: nowIso,
      };
    }
  }

  if (dryRun) {
    return {
      stepIndex,
      actionId: action.id,
      actionType: action.type,
      status: 'dry_run_preview',
      summary: `[Preview] Would execute "${action.type}"${action.requiresOwnerApproval ? ' (queued for owner approval)' : ''} on ${lead?.companyName || 'target entity'}.`,
      executedAt: nowIso,
    };
  }

  // Approval gate: sensitive actions or explicit requiresOwnerApproval MUST wait for owner approval
  const requiresApproval =
    action.requiresOwnerApproval === true ||
    action.type === 'update_crm_field' ||
    action.type === 'request_enrichment' ||
    action.type === 'queue_owner_approval';

  if (requiresApproval) {
    const proposalId = generateAiId('prop');
    const summaryText =
      action.type === 'update_crm_field'
        ? `Update ${action.crmField} to "${action.crmValue}" on ${lead?.companyName || 'company'}`
        : action.type === 'request_enrichment'
          ? `Run owner-reviewed Phase 12 enrichment for ${lead?.companyName || 'company'}: ${action.enrichmentReason || ''}`
          : interpolateTemplate(action.approvalSummary || `Approve workflow action for {{company_name}}`, lead, workflow.name);

    await addAiActionProposals(facade, [
      {
        id: proposalId,
        actionType:
          action.type === 'update_crm_field' && action.crmField === 'relationshipStatus'
            ? 'update_relationship_status'
            : 'create_task',
        status: 'pending_approval',
        title: `[Workflow: ${workflow.name}] ${summaryText}`.slice(0, 160),
        rationale: `Queued by Phase 16 workflow "${workflow.name}" (execution ${executionId}). Explicit owner approval required before mutating CRM.`,
        affectedEntity: {
          entityType: 'company',
          entityId: lead?.id,
          entityName: lead?.companyName || workflow.name,
        },
        proposedChanges: {
          workflowId: workflow.id,
          executionId,
          stepIndex,
          actionType: action.type,
          crmField: action.crmField,
          crmValue: action.crmValue,
          enrichmentReason: action.enrichmentReason,
          personId,
        },
        evidenceRefIds: [executionId],
        createdAt: nowIso,
      },
    ]);

    notificationsOut.push({
      id: generateBiWorkflowId('wnot'),
      workflowId: workflow.id,
      workflowName: workflow.name,
      executionId,
      leadId: lead?.id,
      companyName: lead?.companyName,
      title: `Approval Required: ${workflow.name}`,
      message: summaryText,
      severity: 'action_required',
      read: false,
      createdAt: nowIso,
    });

    return {
      stepIndex,
      actionId: action.id,
      actionType: action.type,
      status: 'awaiting_owner_approval',
      summary: `Queued for explicit owner approval: ${summaryText}`,
      proposalId,
      executedAt: nowIso,
    };
  }

  // Execute safe, non-destructive direct actions
  try {
    switch (action.type) {
      case 'create_task': {
        const title = interpolateTemplate(action.taskTitle || 'Follow up on {{company_name}}', lead, workflow.name);
        const existingTasks = await listAllExtendedTasks(facade, { leadId: lead?.id });
        const normTitle = title.trim().toLowerCase();
        const dup = existingTasks.find(
          (t) =>
            !t.completed &&
            t.status !== 'completed' &&
            t.status !== 'cancelled' &&
            (t.leadId || '') === (lead?.id || '') &&
            (t.personId || '') === (personId || '') &&
            t.title.trim().toLowerCase() === normTitle
        );
        if (dup) {
          return {
            stepIndex,
            actionId: action.id,
            actionType: action.type,
            status: 'skipped_duplicate',
            summary: `Duplicate open task prevented: "${title}" already exists (task ${dup.id}).`,
            createdEntityId: dup.id,
            executedAt: nowIso,
          };
        }
        const dueDate = new Date(now.getTime() + (action.taskDueInDays ?? 2) * DAY_MS).toISOString();
        const mappedCategory =
          action.taskCategory === 'call' ||
          action.taskCategory === 'follow_up' ||
          action.taskCategory === 'meeting' ||
          action.taskCategory === 'proposal' ||
          action.taskCategory === 'research'
            ? action.taskCategory
            : 'follow_up';
        const created = await createExtendedTask(facade, {
          leadId: lead?.id || '',
          personId,
          title,
          description: action.taskDescription
            ? interpolateTemplate(action.taskDescription, lead, workflow.name)
            : `Created by workflow "${workflow.name}".`,
          dueDate,
          priority: action.taskPriority || 'medium',
          category: mappedCategory,
          assignedTo: actor || 'Owner',
          completed: false,
          status: 'pending',
        });
        return {
          stepIndex,
          actionId: action.id,
          actionType: action.type,
          status: 'succeeded',
          summary: `Created task "${created.title}" due ${created.dueDate.slice(0, 10)}.`,
          createdEntityId: created.id,
          executedAt: nowIso,
        };
      }

      case 'add_tag': {
        if (!lead) throw new Error('add_tag requires a target company/lead.');
        const tag = (action.tag || '').trim();
        const existing = lead.tags || [];
        if (existing.some((t) => t.toLowerCase() === tag.toLowerCase())) {
          return {
            stepIndex,
            actionId: action.id,
            actionType: action.type,
            status: 'skipped_duplicate',
            summary: `Tag "${tag}" already present on ${lead.companyName}.`,
            executedAt: nowIso,
          };
        }
        await facade.upsertLead({
          ...lead,
          tags: [...existing, tag].slice(0, 30),
          updatedAt: nowIso,
        });
        return {
          stepIndex,
          actionId: action.id,
          actionType: action.type,
          status: 'succeeded',
          summary: `Added tag "${tag}" to ${lead.companyName}.`,
          executedAt: nowIso,
        };
      }

      case 'create_owner_notification': {
        const title = interpolateTemplate(action.notificationTitle || 'Workflow Notification', lead, workflow.name);
        const message = interpolateTemplate(action.notificationMessage || 'Workflow triggered.', lead, workflow.name);
        const notif: WorkflowOwnerNotification = {
          id: generateBiWorkflowId('wnot'),
          workflowId: workflow.id,
          workflowName: workflow.name,
          executionId,
          leadId: lead?.id,
          companyName: lead?.companyName,
          title,
          message,
          severity: action.notificationSeverity || 'info',
          read: false,
          createdAt: nowIso,
        };
        notificationsOut.push(notif);
        return {
          stepIndex,
          actionId: action.id,
          actionType: action.type,
          status: 'succeeded',
          summary: `Created owner notification: "${title}".`,
          createdEntityId: notif.id,
          executedAt: nowIso,
        };
      }

      case 'add_activity_record': {
        if (!lead) throw new Error('add_activity_record requires a target company/lead.');
        const title = interpolateTemplate(action.activityTitle || 'Workflow Event', lead, workflow.name);
        const description = interpolateTemplate(
          action.activityDescription || `Executed by workflow "${workflow.name}".`,
          lead,
          workflow.name
        );
        const nextActivities = [
          {
            id: generateBiWorkflowId('wact'),
            type: 'note' as const,
            title,
            outcome: description,
            date: nowIso,
            actor: `Workflow:${workflow.name}`,
          },
          ...(lead.activities || []),
        ].slice(0, 100);
        await facade.upsertLead({ ...lead, activities: nextActivities, updatedAt: nowIso });
        return {
          stepIndex,
          actionId: action.id,
          actionType: action.type,
          status: 'succeeded',
          summary: `Added activity "${title}" to ${lead.companyName}.`,
          executedAt: nowIso,
        };
      }

      case 'create_follow_up_recommendation': {
        if (!lead) throw new Error('create_follow_up_recommendation requires a target company/lead.');
        const [outreachWs, settings] = await Promise.all([
          getOutreachWorkspaceState(facade),
          facade.getSettings(),
        ]);
        const person = personId ? await facade.getPersonById(personId) : null;
        const sched = scheduleContextualFollowUp({
          ws: outreachWs,
          settings,
          lead,
          person,
          triggerType: 'owner_requested',
          delayDays: action.followUpDelayDays ?? 2,
          customExplanation: interpolateTemplate(
            action.followUpNote || `Recommended by workflow "${workflow.name}" for owner review (never auto-sent).`,
            lead,
            workflow.name
          ),
          now,
        });
        if (!sched.scheduled) {
          return {
            stepIndex,
            actionId: action.id,
            actionType: action.type,
            status: sched.skippedReason?.toLowerCase().includes('suppression') ? 'blocked_suppressed' : 'skipped_duplicate',
            summary: sched.skippedReason || 'Follow-up recommendation skipped.',
            executedAt: nowIso,
          };
        }
        await saveOutreachWorkspaceState(facade, outreachWs);
        return {
          stepIndex,
          actionId: action.id,
          actionType: action.type,
          status: 'succeeded',
          summary: `Queued follow-up recommendation for ${lead.companyName} (${sched.item?.scheduledFor.slice(0, 10)}).`,
          createdEntityId: sched.item?.id,
          executedAt: nowIso,
        };
      }

      case 'generate_ai_recommendation': {
        const dq = lead ? evaluateCompanyDataQuality(lead, { nowMs: now.getTime() }) : null;
        const recText = lead
          ? `Evidence-based recommendation for ${lead.companyName}: Quality ${dq?.overallScore ?? 0}/100 (Grade ${dq?.grade ?? 'N/A'}), status "${lead.status}". Focus: ${action.aiFocus || 'Next commercial step'}. Missing fields: ${dq?.missingCriticalFields.slice(0, 3).join(', ') || 'None'}.`
          : `Workflow AI recommendation: ${action.aiFocus || 'Review pipeline priorities.'}`;
        const proposalId = generateAiId('prop');
        await addAiActionProposals(facade, [
          {
            id: proposalId,
            actionType: 'create_task',
            status: 'pending_approval',
            title: `[AI Workflow Recommendation] ${lead?.companyName || workflow.name}`.slice(0, 160),
            rationale: recText,
            affectedEntity: {
              entityType: 'company',
              entityId: lead?.id,
              entityName: lead?.companyName || workflow.name,
            },
            proposedChanges: {
              workflowId: workflow.id,
              executionId,
              personId,
              source: 'workflow_ai_recommendation',
            },
            evidenceRefIds: [executionId],
            createdAt: nowIso,
          },
        ]);
        return {
          stepIndex,
          actionId: action.id,
          actionType: action.type,
          status: 'succeeded',
          summary: `Generated grounded AI recommendation (proposal ${proposalId}; owner review required before any CRM change).`,
          proposalId,
          executedAt: nowIso,
        };
      }

      default:
        return {
          stepIndex,
          actionId: action.id,
          actionType: action.type,
          status: 'failed',
          summary: `Unhandled action type "${action.type}".`,
          error: 'Unsupported action type.',
          executedAt: nowIso,
        };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Workflow action execution error.';
    return {
      stepIndex,
      actionId: action.id,
      actionType: action.type,
      status: 'failed',
      summary: `Step "${action.type}" failed.`,
      error: msg.slice(0, 300),
      executedAt: nowIso,
    };
  }
}

export async function dispatchWorkflowEvent(
  facade: CrmStorageFacade,
  event: WorkflowEventPayload,
  options: { dryRun?: boolean; onlyWorkflowId?: string } = {}
): Promise<WorkflowExecutionRecord[]> {
  const depth = event.executionDepth ?? 0;
  // Recursion safeguard: prevent cyclic / runaway workflow chaining
  if (depth >= WORKFLOW_SAFETY_LIMITS.MAX_RECURSION_DEPTH) {
    return [];
  }

  const visited = new Set(event.visitedWorkflowIds || []);
  const now = event.now || new Date();
  const nowMs = now.getTime();
  const actor = event.actor || 'System';

  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const matchingWorkflows = ws.workflows
      .filter((wf) => {
        if (options.onlyWorkflowId) return wf.id === options.onlyWorkflowId;
        if (!wf.enabled) return false;
        if (visited.has(wf.id)) return false;
        return triggerMatchesEvent(wf, event);
      })
      .slice(0, WORKFLOW_SAFETY_LIMITS.MAX_WORKFLOWS_PER_EVENT);

    if (matchingWorkflows.length === 0) return [];

    const condCtx = await buildConditionContext(facade, event, nowMs);
    const results: WorkflowExecutionRecord[] = [];
    const newNotifications: WorkflowOwnerNotification[] = [];

    for (const wf of matchingWorkflows) {
      const startedAtMs = Date.now();
      const idempotencyKey = buildWorkflowIdempotencyKey({
        workflowId: wf.id,
        triggerType: event.triggerType,
        entityId: event.entityId,
        eventKey: event.eventKey,
      });

      // Restart-safe idempotency check (skipped only in dryRun preview)
      if (!options.dryRun && ws.idempotencyLedger[idempotencyKey]) {
        const skippedRec: WorkflowExecutionRecord = {
          id: generateBiWorkflowId('wrun'),
          workflowId: wf.id,
          workflowName: wf.name,
          triggerType: event.triggerType,
          entityType: event.entityType,
          entityId: event.entityId,
          companyName: condCtx.lead?.companyName,
          idempotencyKey,
          status: 'skipped',
          dryRun: false,
          executionDepth: depth,
          retryCount: 0,
          conditionsMatched: false,
          conditionDetails: [],
          steps: [],
          error: `Idempotent duplicate skipped (already executed as ${ws.idempotencyLedger[idempotencyKey].executionId}).`,
          actor,
          startedAt: now.toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
        };
        wf.stats.skippedRuns++;
        ws.executions = [skippedRec, ...ws.executions];
        results.push(skippedRec);
        continue;
      }

      // Per-workflow hourly execution rate limit safeguard
      const runsLastHour = ws.executions.filter(
        (ex) =>
          ex.workflowId === wf.id &&
          !ex.dryRun &&
          ex.status !== 'skipped' &&
          nowMs - new Date(ex.startedAt).getTime() <= HOUR_MS
      ).length;
      if (!options.dryRun && runsLastHour >= wf.maxRunsPerHour) {
        const throttledRec: WorkflowExecutionRecord = {
          id: generateBiWorkflowId('wrun'),
          workflowId: wf.id,
          workflowName: wf.name,
          triggerType: event.triggerType,
          entityType: event.entityType,
          entityId: event.entityId,
          companyName: condCtx.lead?.companyName,
          idempotencyKey,
          status: 'skipped',
          dryRun: false,
          executionDepth: depth,
          retryCount: 0,
          conditionsMatched: false,
          conditionDetails: [],
          steps: [],
          error: `Execution rate limit reached (${runsLastHour}/${wf.maxRunsPerHour} runs in the last hour).`,
          actor,
          startedAt: now.toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
        };
        wf.stats.skippedRuns++;
        ws.executions = [throttledRec, ...ws.executions];
        results.push(throttledRec);
        continue;
      }

      // Evaluate conditions
      const conditionDetails = wf.conditions.map((c) => {
        const res = evaluateWorkflowCondition(c, condCtx);
        return {
          field: c.field,
          operator: c.operator,
          expected: res.expected,
          actual: res.actual,
          passed: res.passed,
        };
      });
      const conditionsMatched =
        conditionDetails.length === 0
          ? true
          : wf.conditionLogic === 'any'
            ? conditionDetails.some((d) => d.passed)
            : conditionDetails.every((d) => d.passed);

      const executionId = generateBiWorkflowId('wrun');
      const steps: WorkflowExecutionStepResult[] = [];

      if (conditionsMatched) {
        // Re-fetch lead before each step so sequential actions (e.g. add_tag + add_activity) see latest state
        for (let i = 0; i < wf.actions.length; i++) {
          const freshLead = event.leadId ? await facade.getLead(event.leadId) : condCtx.lead;
          const stepRes = await executeSingleWorkflowAction({
            facade,
            workflow: wf,
            action: wf.actions[i],
            stepIndex: i,
            executionId,
            lead: freshLead,
            personId: event.personId,
            actor,
            dryRun: Boolean(options.dryRun),
            attemptNumber: 1,
            now,
            notificationsOut: newNotifications,
          });
          steps.push(stepRes);
        }
      }

      const failedSteps = steps.filter((s) => s.status === 'failed');
      const approvalSteps = steps.filter((s) => s.status === 'awaiting_owner_approval');
      let status: WorkflowExecutionRecord['status'] = 'completed';
      if (options.dryRun) {
        status = 'dry_run';
      } else if (!conditionsMatched) {
        status = 'skipped';
      } else if (failedSteps.length > 0 && failedSteps.length === steps.length) {
        status = 'failed';
      } else if (failedSteps.length > 0) {
        status = 'partial_failure';
      } else if (approvalSteps.length > 0) {
        status = 'awaiting_approval';
      }

      const executionRecord: WorkflowExecutionRecord = {
        id: executionId,
        workflowId: wf.id,
        workflowName: wf.name,
        triggerType: event.triggerType,
        entityType: event.entityType,
        entityId: event.entityId,
        companyName: condCtx.lead?.companyName,
        idempotencyKey,
        status,
        dryRun: Boolean(options.dryRun),
        executionDepth: depth,
        retryCount: 0,
        conditionsMatched,
        conditionDetails,
        steps,
        error: failedSteps.length > 0 ? failedSteps.map((s) => s.error || s.summary).join('; ') : undefined,
        actor,
        startedAt: now.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
      };

      if (!options.dryRun) {
        wf.stats.totalRuns++;
        wf.stats.lastRunAt = executionRecord.completedAt;
        wf.stats.lastStatus = status;
        if (status === 'completed') wf.stats.completedRuns++;
        else if (status === 'failed' || status === 'partial_failure') wf.stats.failedRuns++;
        else if (status === 'awaiting_approval') wf.stats.awaitingApprovalRuns++;
        else wf.stats.skippedRuns++;

        if (conditionsMatched && status !== 'failed') {
          ws.idempotencyLedger[idempotencyKey] = {
            executionId: executionRecord.id,
            recordedAt: executionRecord.completedAt,
          };
        }
        ws.executions = [executionRecord, ...ws.executions];
      }

      results.push(executionRecord);
    }

    if (!options.dryRun) {
      if (newNotifications.length > 0) {
        ws.notifications = [...newNotifications, ...ws.notifications];
      }
      await saveBiWorkflowWorkspaceState(facade, ws);
    }

    return results;
  });
}

// ============================================================================
// EXPLICIT OWNER APPROVAL EXECUTION FOR QUEUED WORKFLOW STEPS
// ============================================================================

export async function decideQueuedWorkflowStep(
  facade: CrmStorageFacade,
  params: {
    executionId: string;
    stepIndex: number;
    decision: 'approve' | 'reject';
    actor: string;
  }
): Promise<{ execution: WorkflowExecutionRecord; step: WorkflowExecutionStepResult }> {
  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const exec = ws.executions.find((e) => e.id === params.executionId);
    if (!exec) throw new Error(`Workflow execution "${params.executionId}" not found.`);
    const step = exec.steps.find((s) => s.stepIndex === params.stepIndex);
    if (!step) throw new Error(`Execution step #${params.stepIndex} not found.`);
    if (step.status !== 'awaiting_owner_approval') {
      throw new Error(`Step #${params.stepIndex} is not awaiting approval (current status: ${step.status}).`);
    }

    const wf = ws.workflows.find((w) => w.id === exec.workflowId);
    const action = wf?.actions.find((a) => a.id === step.actionId);
    const nowIso = new Date().toISOString();

    if (params.decision === 'reject') {
      step.status = 'rejected_by_owner';
      step.approvedBy = params.actor;
      step.approvedAt = nowIso;
      step.summary = `${step.summary} — Rejected by ${params.actor}.`;
    } else {
      // Execute the approved sensitive action safely
      if (action?.type === 'update_crm_field' && exec.entityType === 'lead') {
        const lead = await facade.getLead(exec.entityId);
        if (!lead) throw new Error(`Target lead "${exec.entityId}" no longer exists.`);
        if (!action.crmField || !WORKFLOW_PERMITTED_CRM_FIELD_SET.has(action.crmField)) {
          throw new Error('CRM field is not permitted.');
        }
        const val = action.crmValue || '';
        if (action.crmField === 'relationshipStatus') {
          await updateCompanyRelationshipMeta(facade, lead.id, {
            relationshipStatus: val as any,
          });
        } else if (action.crmField === 'nextFollowUpDate') {
          await updateCompanyRelationshipMeta(facade, lead.id, {
            nextFollowUpDate: val,
          });
        } else if (action.crmField === 'priorityNote') {
          await facade.upsertLead({
            ...lead,
            customFields: { ...(lead.customFields || {}), workflowPriorityNote: val },
            updatedAt: nowIso,
          });
        } else {
          await facade.upsertLead({
            ...lead,
            [action.crmField]: val,
            updatedAt: nowIso,
          });
        }
        step.summary = `Owner approved & applied: updated ${action.crmField} to "${val}" on ${lead.companyName}.`;
      } else if (action?.type === 'request_enrichment') {
        const lead = await facade.getLead(exec.entityId);
        if (lead) {
          await createExtendedTask(facade, {
            leadId: lead.id,
            title: `Enrich ${lead.companyName} (Owner Approved)`,
            description: action.enrichmentReason || 'Run Phase 12 enrichment preview and review results.',
            dueDate: new Date(Date.now() + DAY_MS).toISOString(),
            priority: 'medium',
            category: 'research',
            assignedTo: params.actor || 'Owner',
            completed: false,
            status: 'pending',
          });
        }
        step.summary = `Owner approved enrichment request: queued enrichment review task.`;
      } else {
        step.summary = `Owner approved queued workflow action.`;
      }

      step.status = 'approved_and_executed';
      step.approvedBy = params.actor;
      step.approvedAt = nowIso;
    }

    // Recompute execution overall status
    const stillPending = exec.steps.some((s) => s.status === 'awaiting_owner_approval');
    const anyFailed = exec.steps.some((s) => s.status === 'failed');
    if (!stillPending) {
      exec.status = anyFailed ? 'partial_failure' : 'completed';
    }

    appendBiWorkflowAudit(ws, {
      actor: params.actor,
      action: params.decision === 'approve' ? 'workflow_step_approved' : 'workflow_step_rejected',
      entityType: 'approval',
      entityId: exec.id,
      summary: `${params.decision === 'approve' ? 'Approved' : 'Rejected'} step #${params.stepIndex} (${step.actionType}) on workflow "${exec.workflowName}".`,
    });

    await saveBiWorkflowWorkspaceState(facade, ws);
    return { execution: exec, step };
  });
}

// ============================================================================
// FAILURE RECOVERY (IDEMPOTENT RETRY OF FAILED STEPS ONLY)
// ============================================================================

export async function retryFailedWorkflowExecution(
  facade: CrmStorageFacade,
  executionId: string,
  actor: string
): Promise<WorkflowExecutionRecord> {
  return withBiWorkflowLock(async () => {
    const ws = await getBiWorkflowWorkspaceState(facade);
    const original = ws.executions.find((e) => e.id === executionId);
    if (!original) throw new Error(`Workflow execution "${executionId}" not found.`);
    if (original.status !== 'failed' && original.status !== 'partial_failure') {
      throw new Error(`Execution "${executionId}" has status "${original.status}" and does not require retry.`);
    }

    const wf = ws.workflows.find((w) => w.id === original.workflowId);
    if (!wf) throw new Error(`Workflow "${original.workflowId}" no longer exists.`);

    const startedAtMs = Date.now();
    const now = new Date();
    const newExecId = generateBiWorkflowId('wrun');
    const attemptNumber = (original.retryCount || 0) + 2;
    const newNotifications: WorkflowOwnerNotification[] = [];
    const lead = original.entityType === 'lead' ? await facade.getLead(original.entityId) : null;

    const updatedSteps: WorkflowExecutionStepResult[] = [];
    for (const prevStep of original.steps) {
      // Preserve already-succeeded or non-failed steps (idempotent recovery!)
      if (prevStep.status !== 'failed') {
        updatedSteps.push(prevStep);
        continue;
      }
      const action = wf.actions.find((a) => a.id === prevStep.actionId);
      if (!action) {
        updatedSteps.push(prevStep);
        continue;
      }
      const retriedStep = await executeSingleWorkflowAction({
        facade,
        workflow: wf,
        action,
        stepIndex: prevStep.stepIndex,
        executionId: newExecId,
        lead,
        actor,
        dryRun: false,
        attemptNumber,
        now,
        notificationsOut: newNotifications,
      });
      updatedSteps.push(retriedStep);
    }

    const failedSteps = updatedSteps.filter((s) => s.status === 'failed');
    const approvalSteps = updatedSteps.filter((s) => s.status === 'awaiting_owner_approval');
    const nextStatus: WorkflowExecutionRecord['status'] =
      failedSteps.length > 0
        ? failedSteps.length === updatedSteps.length
          ? 'failed'
          : 'partial_failure'
        : approvalSteps.length > 0
          ? 'awaiting_approval'
          : 'completed';

    const retryRecord: WorkflowExecutionRecord = {
      ...original,
      id: newExecId,
      retryOfExecutionId: original.id,
      retryCount: (original.retryCount || 0) + 1,
      status: nextStatus,
      steps: updatedSteps,
      error: failedSteps.length > 0 ? failedSteps.map((s) => s.error || s.summary).join('; ') : undefined,
      actor,
      startedAt: now.toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
    };

    ws.executions = [retryRecord, ...ws.executions];
    if (nextStatus === 'completed' || nextStatus === 'awaiting_approval') {
      ws.idempotencyLedger[original.idempotencyKey] = {
        executionId: retryRecord.id,
        recordedAt: retryRecord.completedAt,
      };
    }
    if (newNotifications.length > 0) {
      ws.notifications = [...newNotifications, ...ws.notifications];
    }
    appendBiWorkflowAudit(ws, {
      actor,
      action: 'workflow_execution_retried',
      entityType: 'execution',
      entityId: retryRecord.id,
      summary: `Retried execution ${original.id} for workflow "${wf.name}" -> ${nextStatus}.`,
    });

    await saveBiWorkflowWorkspaceState(facade, ws);
    return retryRecord;
  });
}

// ============================================================================
// ON-DEMAND SWEEP FOR TIME-BASED TRIGGERS (HONEST, NO FAKE BACKGROUND CRON)
// ============================================================================

export async function evaluateOnDemandTimerWorkflows(
  facade: CrmStorageFacade,
  actor: string,
  now: Date = new Date()
): Promise<{
  evaluatedAt: string;
  stageDurationExecutions: WorkflowExecutionRecord[];
  overdueTaskExecutions: WorkflowExecutionRecord[];
  schedulingMode: 'on_demand';
}> {
  const ws = await getBiWorkflowWorkspaceState(facade);
  const nowMs = now.getTime();
  const dateKey = now.toISOString().slice(0, 10);

  const stageDurationExecutions: WorkflowExecutionRecord[] = [];
  const overdueTaskExecutions: WorkflowExecutionRecord[] = [];

  const hasStageDurationWf = ws.workflows.some((w) => w.enabled && w.trigger.type === 'lead_stage_duration');
  if (hasStageDurationWf) {
    const leads = await facade.getLeads();
    for (const wf of ws.workflows.filter((w) => w.enabled && w.trigger.type === 'lead_stage_duration')) {
      const minDays = wf.trigger.durationDays ?? 7;
      for (const lead of leads) {
        if (wf.trigger.stageId && lead.pipelineStageId !== wf.trigger.stageId) continue;
        const refMs = new Date(lead.updatedAt || lead.createdAt).getTime();
        if (!Number.isFinite(refMs)) continue;
        const ageDays = (nowMs - refMs) / DAY_MS;
        if (ageDays >= minDays) {
          const runs = await dispatchWorkflowEvent(
            facade,
            {
              triggerType: 'lead_stage_duration',
              entityType: 'lead',
              entityId: lead.id,
              leadId: lead.id,
              stageId: lead.pipelineStageId,
              eventKey: `stage-duration-${lead.pipelineStageId || 'none'}-${minDays}d-${dateKey}`,
              actor,
              now,
            },
            { onlyWorkflowId: wf.id }
          );
          stageDurationExecutions.push(...runs);
        }
      }
    }
  }

  const hasOverdueWf = ws.workflows.some((w) => w.enabled && w.trigger.type === 'task_overdue');
  if (hasOverdueWf) {
    const tasks = await listAllExtendedTasks(facade);
    const overdueTasks = tasks.filter(
      (t) =>
        !t.completed &&
        t.status !== 'completed' &&
        t.status !== 'cancelled' &&
        new Date(t.dueDate).getTime() < nowMs
    );
    for (const task of overdueTasks) {
      const runs = await dispatchWorkflowEvent(facade, {
        triggerType: 'task_overdue',
        entityType: 'task',
        entityId: task.id,
        leadId: task.leadId || undefined,
        personId: task.personId,
        task,
        eventKey: `task-overdue-${task.id}-${dateKey}`,
        actor,
        now,
      });
      overdueTaskExecutions.push(...runs);
    }
  }

  return {
    evaluatedAt: now.toISOString(),
    stageDurationExecutions,
    overdueTaskExecutions,
    schedulingMode: 'on_demand',
  };
}
