// Phase 16: Owner-Only Business Intelligence, Reporting & Workflow Automation Express Routes
// Mounted onto protectedApi (which enforces requireOwnerAuth + validateCsrf).
// Extracted so both server.ts and isolated HTTP tests run the exact same handlers.

import type { Request, Response, Router, RequestHandler } from 'express';
import {
  BI_AI_ANALYSIS_MODES,
  BI_AI_ANALYSIS_MODE_SET,
  BI_REPORT_TYPES,
  BI_REPORT_TYPE_SET,
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_CONDITION_FIELDS,
  WORKFLOW_CONDITION_OPERATORS,
  WORKFLOW_PERMITTED_CRM_FIELDS,
  WORKFLOW_PROHIBITED_ACTIONS,
  WORKFLOW_SAFETY_LIMITS,
  WORKFLOW_TRIGGERS,
} from '../../shared/biWorkflowSpecs.js';
import type { BiAnalyticsFilter } from '../../shared/biWorkflowTypes.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import { buildBiAnalyticsDashboard } from './biAnalyticsService.js';
import {
  createWorkflowDefinition,
  decideQueuedWorkflowStep,
  deleteWorkflowDefinition,
  dispatchWorkflowEvent,
  evaluateOnDemandTimerWorkflows,
  listWorkflowsWorkspace,
  markWorkflowNotificationRead,
  retryFailedWorkflowExecution,
  toggleWorkflowEnabled,
  updateWorkflowDefinition,
  WorkflowValidationError,
} from './workflowEngine.js';
import {
  deleteSavedBiReportConfig,
  exportBiReportToCsv,
  generateBiReport,
  listSavedBiReports,
  saveBiReportConfig,
} from './reportingService.js';
import { generateBiAiInsights } from './biAiInsightsService.js';

export interface BiWorkflowRouteDependencies {
  getFacade: () => { facade: CrmStorageFacade; isPg: boolean };
  aiRateLimitMiddleware: RequestHandler;
  sanitizeApiError: (err: unknown, fallback: string) => string;
  recordPgAuditEvent?: (params: {
    eventType: string;
    actorId: string;
    actorEmail: string;
    targetType: string;
    targetId: string;
    ipAddress: string;
    userAgent: string;
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;
}

function parseBiFilterQuery(query: Record<string, unknown>): BiAnalyticsFilter {
  const clean = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const trimmed = v.trim();
    return trimmed ? trimmed.slice(0, 120) : undefined;
  };
  return {
    dateFrom: clean(query.dateFrom),
    dateTo: clean(query.dateTo),
    country: clean(query.country),
    industry: clean(query.industry),
    source: clean(query.source),
    stageId: clean(query.stageId),
  };
}

export function registerBiWorkflowRoutes(router: Router, deps: BiWorkflowRouteDependencies): void {
  const { getFacade, aiRateLimitMiddleware, sanitizeApiError, recordPgAuditEvent } = deps;

  const logPgAudit = async (
    isPg: boolean,
    req: Request,
    eventType: string,
    targetType: string,
    targetId: string,
    metadata?: Record<string, unknown>
  ) => {
    if (!isPg || !recordPgAuditEvent) return;
    try {
      await recordPgAuditEvent({
        eventType,
        actorId: req.owner?.id || 'owner',
        actorEmail: req.owner?.email || 'owner',
        targetType,
        targetId,
        ipAddress: req.ip || '',
        userAgent: String(req.headers['user-agent'] || ''),
        metadata,
      });
    } catch {
      // Never fail primary route on secondary audit log error
    }
  };

  // ============================================================================
  // BUSINESS INTELLIGENCE DASHBOARD & ADVANCED ANALYTICS
  // ============================================================================

  router.get('/bi/analytics', async (req: Request, res: Response) => {
    try {
      const { facade } = getFacade();
      const filters = parseBiFilterQuery(req.query as Record<string, unknown>);
      const dashboard = await buildBiAnalyticsDashboard(facade, filters);
      res.json(dashboard);
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to compute Business Intelligence analytics.') });
    }
  });

  // ============================================================================
  // AI-ASSISTED BI INSIGHTS & EXECUTIVE BRIEFINGS
  // ============================================================================

  router.post('/bi/ai/insights', aiRateLimitMiddleware, async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const mode = typeof body.mode === 'string' ? body.mode.trim() : 'analytics_explanation';
    if (!BI_AI_ANALYSIS_MODE_SET.has(mode)) {
      res.status(422).json({
        error: 'Invalid BI AI analysis mode.',
        code: 'INVALID_BI_AI_MODE',
        allowedModes: BI_AI_ANALYSIS_MODES.map((m) => m.value),
      });
      return;
    }

    try {
      const { facade } = getFacade();
      const rawFilters =
        body.filters && typeof body.filters === 'object' ? (body.filters as Record<string, unknown>) : {};
      const filters = parseBiFilterQuery(rawFilters);
      const question = typeof body.question === 'string' ? body.question.trim().slice(0, 400) : undefined;
      const insights = await generateBiAiInsights(facade, {
        mode,
        filters,
        question,
      });
      res.json({ insights });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to generate BI insights.') });
    }
  });

  // ============================================================================
  // OPERATIONAL REPORTING, SAVED REPORTS & RFC 4180 CSV EXPORT
  // ============================================================================

  router.get('/bi/reports/generate', async (req: Request, res: Response) => {
    const reportType =
      typeof req.query.reportType === 'string' ? req.query.reportType.trim() : 'executive_overview';
    if (!BI_REPORT_TYPE_SET.has(reportType)) {
      res.status(422).json({
        error: 'Invalid reportType requested.',
        code: 'INVALID_REPORT_TYPE',
        allowedReportTypes: BI_REPORT_TYPES.map((r) => r.value),
      });
      return;
    }

    try {
      const { facade } = getFacade();
      const filters = parseBiFilterQuery(req.query as Record<string, unknown>);
      const report = await generateBiReport(facade, reportType, filters);
      res.json({ report, reportCatalog: BI_REPORT_TYPES });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to generate operational report.') });
    }
  });

  router.get('/bi/reports/export/csv', async (req: Request, res: Response) => {
    const reportType =
      typeof req.query.reportType === 'string' ? req.query.reportType.trim() : 'executive_overview';
    if (!BI_REPORT_TYPE_SET.has(reportType)) {
      res.status(422).json({
        error: 'Invalid reportType requested for CSV export.',
        code: 'INVALID_REPORT_TYPE',
      });
      return;
    }

    try {
      const { facade, isPg } = getFacade();
      const filters = parseBiFilterQuery(req.query as Record<string, unknown>);
      const report = await generateBiReport(facade, reportType, filters);
      const { filename, csvContent } = exportBiReportToCsv(report);
      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

      await logPgAudit(isPg, req, 'BI_REPORT_CSV_EXPORTED', 'bi_report', reportType, {
        reportType,
        totalRows: report.totalRows,
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      res.status(200).send(csvContent);
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to export BI report CSV.') });
    }
  });

  router.get('/bi/reports/saved', async (_req: Request, res: Response) => {
    try {
      const { facade } = getFacade();
      const savedReports = await listSavedBiReports(facade);
      res.json({ savedReports, reportCatalog: BI_REPORT_TYPES });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to load saved report configurations.') });
    }
  });

  router.post('/bi/reports/saved', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const reportType = typeof body.reportType === 'string' ? body.reportType.trim() : '';
    if (!name) {
      res.status(422).json({ error: 'Report configuration name is required.', code: 'INVALID_SAVED_REPORT' });
      return;
    }
    if (!BI_REPORT_TYPE_SET.has(reportType)) {
      res.status(422).json({ error: 'Invalid reportType for saved report.', code: 'INVALID_REPORT_TYPE' });
      return;
    }

    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const rawFilters =
        body.filters && typeof body.filters === 'object' ? (body.filters as Record<string, unknown>) : {};
      const saved = await saveBiReportConfig(
        facade,
        {
          id: typeof body.id === 'string' ? body.id : undefined,
          name,
          description: typeof body.description === 'string' ? body.description : undefined,
          reportType,
          filters: parseBiFilterQuery(rawFilters),
        },
        actor
      );
      await logPgAudit(isPg, req, 'BI_SAVED_REPORT_UPSERTED', 'bi_saved_report', saved.id, {
        name: saved.name,
        reportType: saved.reportType,
      });
      res.status(201).json({ savedReport: saved });
    } catch (err: unknown) {
      res.status(422).json({ error: sanitizeApiError(err, 'Failed to save report configuration.') });
    }
  });

  router.delete('/bi/reports/saved/:id', async (req: Request, res: Response) => {
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const deleted = await deleteSavedBiReportConfig(facade, req.params.id, actor);
      if (!deleted) {
        res.status(404).json({ error: 'Saved report configuration not found.' });
        return;
      }
      await logPgAudit(isPg, req, 'BI_SAVED_REPORT_DELETED', 'bi_saved_report', req.params.id);
      res.json({ deleted: true, id: req.params.id });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to delete saved report.') });
    }
  });

  // ============================================================================
  // WORKFLOW AUTOMATION ENGINE (CRUD, DRY-RUN, TIMERS, RETRY, APPROVALS)
  // ============================================================================

  router.get('/bi/workflows', async (_req: Request, res: Response) => {
    try {
      const { facade } = getFacade();
      const workspace = await listWorkflowsWorkspace(facade);
      res.json({
        ...workspace,
        catalog: {
          triggers: WORKFLOW_TRIGGERS,
          conditionFields: WORKFLOW_CONDITION_FIELDS,
          conditionOperators: WORKFLOW_CONDITION_OPERATORS,
          actions: WORKFLOW_ACTION_TYPES,
          permittedCrmFields: WORKFLOW_PERMITTED_CRM_FIELDS,
          prohibitedActions: Array.from(WORKFLOW_PROHIBITED_ACTIONS),
          safetyLimits: WORKFLOW_SAFETY_LIMITS,
          reportTypes: BI_REPORT_TYPES,
          aiAnalysisModes: BI_AI_ANALYSIS_MODES,
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to load workflow automation workspace.') });
    }
  });

  router.post('/bi/workflows', async (req: Request, res: Response) => {
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const workflow = await createWorkflowDefinition(
        facade,
        (req.body || {}) as Record<string, unknown>,
        actor
      );
      await logPgAudit(isPg, req, 'WORKFLOW_CREATED', 'workflow', workflow.id, {
        name: workflow.name,
        triggerType: workflow.trigger.type,
        actionTypes: workflow.actions.map((a) => a.type),
        enabled: workflow.enabled,
      });
      res.status(201).json({ workflow });
    } catch (err: unknown) {
      if (err instanceof WorkflowValidationError) {
        res.status(422).json({
          error: err.message,
          code: err.code,
          details: err.details,
        });
        return;
      }
      res.status(422).json({ error: sanitizeApiError(err, 'Failed to create workflow.') });
    }
  });

  router.put('/bi/workflows/:id', async (req: Request, res: Response) => {
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const workflow = await updateWorkflowDefinition(
        facade,
        req.params.id,
        (req.body || {}) as Record<string, unknown>,
        actor
      );
      await logPgAudit(isPg, req, 'WORKFLOW_UPDATED', 'workflow', workflow.id, {
        name: workflow.name,
        triggerType: workflow.trigger.type,
        actionTypes: workflow.actions.map((a) => a.type),
        enabled: workflow.enabled,
      });
      res.json({ workflow });
    } catch (err: unknown) {
      if (err instanceof WorkflowValidationError) {
        res.status(422).json({
          error: err.message,
          code: err.code,
          details: err.details,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 422).json({
        error: sanitizeApiError(err, 'Failed to update workflow.'),
      });
    }
  });

  router.patch('/bi/workflows/:id/toggle', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    if (typeof body.enabled !== 'boolean') {
      res.status(422).json({ error: 'Boolean "enabled" field is required.', code: 'INVALID_TOGGLE_PAYLOAD' });
      return;
    }
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const workflow = await toggleWorkflowEnabled(facade, req.params.id, body.enabled, actor);
      await logPgAudit(
        isPg,
        req,
        workflow.enabled ? 'WORKFLOW_ENABLED' : 'WORKFLOW_DISABLED',
        'workflow',
        workflow.id,
        { name: workflow.name, enabled: workflow.enabled }
      );
      res.json({ workflow });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 400).json({
        error: sanitizeApiError(err, 'Failed to toggle workflow status.'),
      });
    }
  });

  router.delete('/bi/workflows/:id', async (req: Request, res: Response) => {
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const deleted = await deleteWorkflowDefinition(facade, req.params.id, actor);
      if (!deleted) {
        res.status(404).json({ error: 'Workflow not found.' });
        return;
      }
      await logPgAudit(isPg, req, 'WORKFLOW_DELETED', 'workflow', req.params.id);
      res.json({ deleted: true, id: req.params.id });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to delete workflow.') });
    }
  });

  router.post('/bi/workflows/:id/test-run', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const dryRun = body.dryRun !== false;
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const ws = await listWorkflowsWorkspace(facade);
      const wf = ws.workflows.find((w) => w.id === req.params.id);
      if (!wf) {
        res.status(404).json({ error: 'Workflow not found.' });
        return;
      }
      const leadId = typeof body.leadId === 'string' && body.leadId.trim() ? body.leadId.trim() : undefined;
      const leads = leadId ? [] : await facade.getLeads();
      const targetLeadId = leadId || leads[0]?.id;
      if (!targetLeadId) {
        res.status(422).json({
          error: 'At least one CRM company record is required to run a workflow preview/test.',
          code: 'NO_TEST_ENTITY',
        });
        return;
      }

      const targetLead = await facade.getLead(targetLeadId);
      if (!targetLead) {
        res.status(404).json({ error: 'Selected CRM company lead not found.' });
        return;
      }

      const runs = await dispatchWorkflowEvent(
        facade,
        {
          triggerType: wf.trigger.type,
          entityType: 'lead',
          entityId: targetLead.id,
          leadId: targetLead.id,
          stageId: targetLead.pipelineStageId,
          opportunityOutcome:
            wf.trigger.opportunityOutcome === 'won' || wf.trigger.opportunityOutcome === 'lost'
              ? wf.trigger.opportunityOutcome
              : undefined,
          eventKey: `${dryRun ? 'dryrun' : 'manual-test'}-${wf.id}-${targetLead.id}-${Date.now()}`,
          actor,
        },
        { dryRun, onlyWorkflowId: wf.id }
      );

      if (!dryRun) {
        await logPgAudit(isPg, req, 'WORKFLOW_MANUAL_RUN', 'workflow', wf.id, {
          leadId: targetLead.id,
          status: runs[0]?.status || 'skipped',
        });
      }

      res.json({
        dryRun,
        execution: runs[0] || null,
        executions: runs,
      });
    } catch (err: unknown) {
      res.status(422).json({ error: sanitizeApiError(err, 'Failed to execute workflow test run.') });
    }
  });

  router.post('/bi/workflows/evaluate-timers', async (req: Request, res: Response) => {
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const result = await evaluateOnDemandTimerWorkflows(facade, actor);
      await logPgAudit(isPg, req, 'WORKFLOW_TIMERS_EVALUATED', 'workflow_sweep', 'on_demand', {
        stageDurationRuns: result.stageDurationExecutions.length,
        overdueTaskRuns: result.overdueTaskExecutions.length,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to evaluate time-based workflows.') });
    }
  });

  router.post('/bi/workflows/executions/:id/retry', async (req: Request, res: Response) => {
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const execution = await retryFailedWorkflowExecution(facade, req.params.id, actor);
      await logPgAudit(isPg, req, 'WORKFLOW_EXECUTION_RETRIED', 'workflow_execution', execution.id, {
        retryOfExecutionId: execution.retryOfExecutionId,
        status: execution.status,
      });
      res.json({ execution });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 422).json({
        error: sanitizeApiError(err, 'Failed to retry workflow execution.'),
      });
    }
  });

  router.post('/bi/workflows/executions/:id/approve-step/:stepIndex', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const decision = body.decision;
    if (decision !== 'approve' && decision !== 'reject') {
      res.status(422).json({
        error: 'decision must be either "approve" or "reject".',
        code: 'INVALID_APPROVAL_DECISION',
      });
      return;
    }
    const stepIndex = Number(req.params.stepIndex);
    if (!Number.isInteger(stepIndex) || stepIndex < 0) {
      res.status(422).json({ error: 'Invalid stepIndex.', code: 'INVALID_STEP_INDEX' });
      return;
    }

    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const result = await decideQueuedWorkflowStep(facade, {
        executionId: req.params.id,
        stepIndex,
        decision,
        actor,
      });
      await logPgAudit(
        isPg,
        req,
        decision === 'approve' ? 'WORKFLOW_STEP_APPROVED' : 'WORKFLOW_STEP_REJECTED',
        'workflow_execution',
        result.execution.id,
        {
          workflowId: result.execution.workflowId,
          stepIndex,
          actionType: result.step.actionType,
          decision,
        }
      );
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 422).json({
        error: sanitizeApiError(err, 'Failed to process workflow approval decision.'),
      });
    }
  });

  router.patch('/bi/notifications/:id/read', async (req: Request, res: Response) => {
    try {
      const { facade } = getFacade();
      const notification = await markWorkflowNotificationRead(facade, req.params.id);
      res.json({ notification });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 400).json({
        error: sanitizeApiError(err, 'Failed to mark notification read.'),
      });
    }
  });
}
