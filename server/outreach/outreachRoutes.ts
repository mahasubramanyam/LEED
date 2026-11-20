// Phase 15: Owner-Authenticated Outreach & Follow-Up Automation Express Routes
// Mounted onto protectedApi (requireOwnerAuth + validateCsrf) in server.ts and reusable in isolated HTTP tests.

import type { Request, Response, Router, RequestHandler } from 'express';
import {
  OUTREACH_ENROLLMENT_STATUS_SET,
  OUTREACH_FOLLOWUP_STATUS_SET,
  OUTREACH_PROVIDER_MAP,
  OUTREACH_REPLY_CLASSIFICATION_SET,
} from '../../shared/outreachSpecs.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import type { CredentialManager } from '../connectors/core/credentialManager.js';
import {
  addSuppressionEntry,
  approveOutreachMessage,
  buildOutreachAnalytics,
  cancelOutreachMessage,
  createManualFollowUp,
  createOutreachCampaign,
  deactivateSuppressionEntry,
  dispatchApprovedOutreachMessage,
  editOutreachMessageDraft,
  enrollRecipientsInCampaign,
  generateOutreachMessageDraft,
  getOutreachWorkspaceOverview,
  markMessageManuallySent,
  rejectOutreachMessage,
  transitionEnrollmentStatus,
  updateFollowUpStatus,
  updateOutreachCampaign,
  updateOutreachComplianceConfig,
  updateOutreachProviderSettings,
  upsertOutreachSequence,
} from './outreachService.js';
import { recordOutreachReply } from './replyManager.js';
import {
  buildProviderCredentialRequirement,
  listOutreachProviderStatuses,
} from './providerAbstraction.js';
import {
  appendOutreachAudit,
  getOutreachWorkspaceState,
  saveOutreachWorkspaceState,
} from './outreachStoreHelper.js';
import { dispatchWorkflowEvent } from '../bi/workflowEngine.js';
import { paginateArray, parsePaginationParams } from '../../shared/paginationUtils.js';

export interface OutreachRouteDependencies {
  getFacade: () => { facade: CrmStorageFacade; isPg: boolean };
  credentialManager: CredentialManager;
  aiRateLimitMiddleware: RequestHandler;
  sanitizeApiError: (err: unknown, fallback: string) => string;
  normalizeClientIp: (req: Request) => string;
  recordPgAuditEvent?: (
    eventType: string,
    actorEmail: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    ipAddress: string
  ) => Promise<unknown>;
}

export function registerOutreachRoutes(
  router: Router,
  deps: OutreachRouteDependencies
): void {
  const {
    getFacade,
    credentialManager,
    aiRateLimitMiddleware,
    sanitizeApiError,
    normalizeClientIp,
    recordPgAuditEvent,
  } = deps;

  const logPgAudit = async (
    isPg: boolean,
    req: Request,
    eventType: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>
  ) => {
    if (isPg && req.owner && recordPgAuditEvent) {
      await recordPgAuditEvent(
        eventType,
        req.owner.email,
        resourceType,
        resourceId,
        metadata,
        normalizeClientIp(req)
      );
    }
  };

  router.get('/outreach/overview', async (req: Request, res: Response) => {
    try {
      const { facade } = getFacade();
      const overview = await getOutreachWorkspaceOverview(facade, credentialManager);
      const hasPagination =
        req.query.page !== undefined || req.query.pageSize !== undefined || req.query.limit !== undefined;
      if (hasPagination) {
        const params = parsePaginationParams(req.query as Record<string, unknown>, {
          defaultPageSize: 50,
          maxPageSize: 200,
        });
        const statusFilter =
          typeof req.query.status === 'string' && req.query.status.trim() && req.query.status !== 'all'
            ? req.query.status.trim()
            : undefined;
        const filteredMessages = statusFilter
          ? overview.workspace.messages.filter((m) => m.status === statusFilter)
          : overview.workspace.messages;
        const pagedMessages = paginateArray(filteredMessages, params);
        const pagedCampaigns = paginateArray(overview.workspace.campaigns, params);
        res.json({
          ...overview,
          workspace: {
            ...overview.workspace,
            campaigns: pagedCampaigns.items,
            messages: pagedMessages.items,
          },
          pagination: {
            campaigns: pagedCampaigns.pagination,
            messages: pagedMessages.pagination,
          },
        });
        return;
      }
      res.json(overview);
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to load outreach workspace.') });
    }
  });

  router.get('/outreach/analytics', async (_req: Request, res: Response) => {
    try {
      const { facade } = getFacade();
      const ws = await getOutreachWorkspaceState(facade);
      res.json({ analytics: buildOutreachAnalytics(ws) });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to compute outreach analytics.') });
    }
  });

  router.post('/outreach/campaigns', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    if (!body.name || typeof body.name !== 'string' || !body.objective || typeof body.objective !== 'string') {
      res.status(400).json({ error: 'name and objective strings are required.' });
      return;
    }
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const created = await createOutreachCampaign(facade, {
        name: body.name,
        objective: body.objective,
        description: typeof body.description === 'string' ? body.description : undefined,
        mode: body.mode === 'controlled_batch' ? 'controlled_batch' : 'individual',
        channel: body.channel,
        targetIcpId: typeof body.targetIcpId === 'string' ? body.targetIcpId : undefined,
        defaultTone: body.defaultTone,
        defaultProviderId: typeof body.defaultProviderId === 'string' ? body.defaultProviderId : undefined,
        dailySendLimit: body.dailySendLimit !== undefined ? Number(body.dailySendLimit) : undefined,
        maxFollowUps: body.maxFollowUps !== undefined ? Number(body.maxFollowUps) : undefined,
        complianceNotes: typeof body.complianceNotes === 'string' ? body.complianceNotes : undefined,
        createdBy: actor,
        createDefaultSequence: body.createDefaultSequence !== false,
      });
      await logPgAudit(isPg, req, 'OUTREACH_CAMPAIGN_CREATED', 'outreach_campaign', created.campaign.id, {
        name: created.campaign.name,
        mode: created.campaign.mode,
        channel: created.campaign.channel,
      });
      res.status(201).json(created);
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Failed to create outreach campaign.') });
    }
  });

  router.patch('/outreach/campaigns/:id', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const updated = await updateOutreachCampaign(facade, req.params.id, body, actor);
      await logPgAudit(isPg, req, 'OUTREACH_CAMPAIGN_UPDATED', 'outreach_campaign', updated.id, {
        status: updated.status,
      });
      res.json({ campaign: updated });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 400).json({
        error: sanitizeApiError(err, 'Failed to update outreach campaign.'),
      });
    }
  });

  router.post('/outreach/sequences', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    if (!body.campaignId || typeof body.campaignId !== 'string' || !Array.isArray(body.steps)) {
      res.status(400).json({ error: 'campaignId and steps array are required.' });
      return;
    }
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const sequence = await upsertOutreachSequence(facade, body as any, actor);
      res.json({ sequence });
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Failed to save outreach sequence.') });
    }
  });

  router.post('/outreach/campaigns/:id/enroll', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
      res.status(400).json({ error: 'recipients array is required.' });
      return;
    }
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const result = await enrollRecipientsInCampaign(facade, {
        campaignId: req.params.id,
        recipients: body.recipients.slice(0, 100),
        enrolledBy: actor,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Failed to enroll recipients.') });
    }
  });

  router.patch('/outreach/enrollments/:id', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    if (typeof body.status !== 'string' || !OUTREACH_ENROLLMENT_STATUS_SET.has(body.status)) {
      res.status(422).json({
        error: 'Invalid enrollment status. Must be a canonical outreach enrollment status.',
        code: 'INVALID_ENROLLMENT_STATUS',
      });
      return;
    }
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const enrollment = await transitionEnrollmentStatus(
        facade,
        req.params.id,
        body.status as any,
        typeof body.reason === 'string' ? body.reason : undefined,
        actor
      );
      res.json({ enrollment });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 422).json({
        error: sanitizeApiError(err, 'Failed to update enrollment status.'),
      });
    }
  });

  router.post('/outreach/messages/draft', aiRateLimitMiddleware, async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    if (!body.campaignId || !body.leadId) {
      res.status(400).json({ error: 'campaignId and leadId are required.' });
      return;
    }
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const message = await generateOutreachMessageDraft(facade, {
        campaignId: String(body.campaignId),
        leadId: String(body.leadId),
        personId: typeof body.personId === 'string' ? body.personId : undefined,
        enrollmentId: typeof body.enrollmentId === 'string' ? body.enrollmentId : undefined,
        stepNumber: body.stepNumber !== undefined ? Number(body.stepNumber) : undefined,
        channel: body.channel,
        tone: body.tone,
        draftType: body.draftType,
        customInstructions: typeof body.customInstructions === 'string' ? body.customInstructions : undefined,
        includePrivateNotes: body.includePrivateNotes === true,
        actor,
      });
      res.status(201).json({ message });
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Failed to generate outreach draft.') });
    }
  });

  router.patch('/outreach/messages/:id', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const message = await editOutreachMessageDraft(
        facade,
        req.params.id,
        {
          subject: typeof body.subject === 'string' ? body.subject : undefined,
          body: typeof body.body === 'string' ? body.body : undefined,
          recipientEmail: typeof body.recipientEmail === 'string' ? body.recipientEmail : undefined,
        },
        actor
      );
      res.json({ message });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 400).json({
        error: sanitizeApiError(err, 'Failed to edit outreach draft.'),
      });
    }
  });

  router.post('/outreach/messages/:id/approve', async (req: Request, res: Response) => {
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const message = await approveOutreachMessage(facade, req.params.id, actor);
      await logPgAudit(isPg, req, 'OUTREACH_MESSAGE_APPROVED', 'outreach_message', message.id, {
        companyName: message.companyName,
        channel: message.channel,
        stepNumber: message.stepNumber,
      });
      res.json({ message });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 422).json({
        error: sanitizeApiError(err, 'Failed to approve outreach message.'),
      });
    }
  });

  router.post('/outreach/messages/:id/reject', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const message = await rejectOutreachMessage(
        facade,
        req.params.id,
        typeof body.reason === 'string' ? body.reason : undefined,
        actor
      );
      res.json({ message });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 400).json({
        error: sanitizeApiError(err, 'Failed to reject outreach draft.'),
      });
    }
  });

  router.post('/outreach/messages/:id/cancel', async (req: Request, res: Response) => {
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const message = await cancelOutreachMessage(facade, req.params.id, actor);
      res.json({ message });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 400).json({
        error: sanitizeApiError(err, 'Failed to cancel outreach message.'),
      });
    }
  });

  router.post('/outreach/messages/:id/dispatch', aiRateLimitMiddleware, async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const result = await dispatchApprovedOutreachMessage(facade, {
        messageId: req.params.id,
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
        actor,
        credentialManager,
      });
      await logPgAudit(
        isPg,
        req,
        result.sent ? 'OUTREACH_MESSAGE_SENT' : 'OUTREACH_MESSAGE_DISPATCH_FAILED',
        'outreach_message',
        result.message.id,
        {
          sent: result.sent,
          providerId: result.message.providerId,
          providerMessageId: result.message.providerMessageId,
          deliveryStatus: result.message.deliveryStatus,
        }
      );
      res.status(result.sent ? 200 : result.httpStatus && result.httpStatus >= 400 ? result.httpStatus : 422).json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 422).json({
        error: sanitizeApiError(err, 'Outreach dispatch refused.'),
      });
    }
  });

  router.post('/outreach/messages/:id/manual-sent', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const result = await markMessageManuallySent(facade, {
        messageId: req.params.id,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        actor,
      });
      await logPgAudit(isPg, req, 'OUTREACH_MESSAGE_MANUAL_SENT', 'outreach_message', result.message.id, {
        channel: result.message.channel,
        companyName: result.message.companyName,
      });
      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 422).json({
        error: sanitizeApiError(err, 'Failed to record manual external send.'),
      });
    }
  });

  router.post('/outreach/follow-ups', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    if (!body.leadId || typeof body.leadId !== 'string') {
      res.status(400).json({ error: 'leadId is required.' });
      return;
    }
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const result = await createManualFollowUp(facade, {
        leadId: body.leadId,
        personId: typeof body.personId === 'string' ? body.personId : undefined,
        campaignId: typeof body.campaignId === 'string' ? body.campaignId : undefined,
        enrollmentId: typeof body.enrollmentId === 'string' ? body.enrollmentId : undefined,
        triggerType: body.triggerType,
        delayDays: body.delayDays !== undefined ? Number(body.delayDays) : undefined,
        businessDaysOnly: typeof body.businessDaysOnly === 'boolean' ? body.businessDaysOnly : undefined,
        explanation: typeof body.explanation === 'string' ? body.explanation : undefined,
        recommendedAction: typeof body.recommendedAction === 'string' ? body.recommendedAction : undefined,
        actor,
      });
      if (result.scheduled && result.item?.triggerType === 'meeting_scheduled') {
        try {
          await dispatchWorkflowEvent(facade, {
            triggerType: 'meeting_scheduled',
            entityType: 'lead',
            entityId: body.leadId,
            leadId: body.leadId,
            personId: typeof body.personId === 'string' ? body.personId : undefined,
            eventKey: `meeting-scheduled-${result.item.id}`,
            actor,
          });
        } catch {
          // Non-blocking workflow hook
        }
      }
      res.status(result.scheduled ? 201 : 200).json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Failed to schedule follow-up.') });
    }
  });

  router.patch('/outreach/follow-ups/:id', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    if (
      body.status !== undefined &&
      (typeof body.status !== 'string' || !OUTREACH_FOLLOWUP_STATUS_SET.has(body.status))
    ) {
      res.status(422).json({
        error: 'Invalid follow-up status. Must be a canonical follow-up status.',
        code: 'INVALID_FOLLOWUP_STATUS',
      });
      return;
    }
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const item = await updateFollowUpStatus(
        facade,
        req.params.id,
        {
          status: body.status,
          scheduledFor: typeof body.scheduledFor === 'string' ? body.scheduledFor : undefined,
        },
        actor
      );
      res.json({ followUp: item });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 422).json({
        error: sanitizeApiError(err, 'Failed to update follow-up.'),
      });
    }
  });

  router.post('/outreach/replies', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    if (!body.leadId || !body.body || typeof body.body !== 'string') {
      res.status(400).json({ error: 'leadId and reply body text are required.' });
      return;
    }
    if (
      body.overrideClassification !== undefined &&
      (typeof body.overrideClassification !== 'string' ||
        !OUTREACH_REPLY_CLASSIFICATION_SET.has(body.overrideClassification))
    ) {
      res.status(422).json({
        error: 'Invalid reply classification. Must be a canonical outreach reply classification.',
        code: 'INVALID_REPLY_CLASSIFICATION',
      });
      return;
    }
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const result = await recordOutreachReply(facade, {
        leadId: String(body.leadId),
        personId: typeof body.personId === 'string' ? body.personId : undefined,
        campaignId: typeof body.campaignId === 'string' ? body.campaignId : undefined,
        enrollmentId: typeof body.enrollmentId === 'string' ? body.enrollmentId : undefined,
        messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
        senderEmail: typeof body.senderEmail === 'string' ? body.senderEmail : undefined,
        channel: body.channel,
        subject: typeof body.subject === 'string' ? body.subject : undefined,
        body: body.body,
        receivedAt: typeof body.receivedAt === 'string' ? body.receivedAt : undefined,
        overrideClassification: body.overrideClassification,
        allowAiClassification: body.allowAiClassification === true,
        recordedBy: actor,
      });
      await logPgAudit(isPg, req, 'OUTREACH_REPLY_RECORDED', 'outreach_reply', result.reply.id, {
        leadId: result.reply.leadId,
        classification: result.reply.classification,
        suppressionCreated: result.suppressionCreated,
      });
      try {
        await dispatchWorkflowEvent(facade, {
          triggerType: 'outreach_reply_recorded',
          entityType: 'reply',
          entityId: result.reply.id,
          leadId: result.reply.leadId,
          personId: result.reply.personId,
          reply: result.reply,
          eventKey: `reply-recorded-${result.reply.id}`,
          actor,
        });
        if (
          ['positive', 'meeting_interest', 'information_request', 'referral'].includes(
            result.reply.classification
          )
        ) {
          await dispatchWorkflowEvent(facade, {
            triggerType: 'positive_reply_received',
            entityType: 'reply',
            entityId: result.reply.id,
            leadId: result.reply.leadId,
            personId: result.reply.personId,
            reply: result.reply,
            eventKey: `positive-reply-${result.reply.id}`,
            actor,
          });
        }
      } catch {
        // Non-blocking workflow hook
      }
      res.status(201).json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Failed to record reply.') });
    }
  });

  router.post('/outreach/suppressions', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    try {
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const suppression = await addSuppressionEntry(facade, {
        scope: body.scope === 'campaign' ? 'campaign' : 'global',
        campaignId: typeof body.campaignId === 'string' ? body.campaignId : undefined,
        type: body.type || 'do_not_contact',
        email: typeof body.email === 'string' ? body.email : undefined,
        domain: typeof body.domain === 'string' ? body.domain : undefined,
        leadId: typeof body.leadId === 'string' ? body.leadId : undefined,
        personId: typeof body.personId === 'string' ? body.personId : undefined,
        reason: typeof body.reason === 'string' ? body.reason : 'Owner-requested suppression',
        createdBy: actor,
      });
      await logPgAudit(isPg, req, 'OUTREACH_SUPPRESSION_ADDED', 'outreach_suppression', suppression.id, {
        scope: suppression.scope,
        type: suppression.type,
      });
      res.status(201).json({ suppression });
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Failed to add suppression entry.') });
    }
  });

  router.delete('/outreach/suppressions/:id', async (req: Request, res: Response) => {
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const suppression = await deactivateSuppressionEntry(facade, req.params.id, actor);
      res.json({ suppression });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      res.status(msg.includes('not found') ? 404 : 400).json({
        error: sanitizeApiError(err, 'Failed to deactivate suppression.'),
      });
    }
  });

  router.patch('/outreach/compliance', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const complianceConfig = await updateOutreachComplianceConfig(facade, body, actor);
      res.json({ complianceConfig });
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Failed to update compliance settings.') });
    }
  });

  router.patch('/outreach/providers/settings', async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, any>;
    try {
      const { facade } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const providerSettings = await updateOutreachProviderSettings(facade, body, actor);
      const ws = await getOutreachWorkspaceState(facade);
      const providers = await listOutreachProviderStatuses(ws, credentialManager);
      res.json({ providerSettings, providers });
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Failed to update provider settings.') });
    }
  });

  router.post('/outreach/providers/:providerId/credentials', async (req: Request, res: Response) => {
    const providerId = req.params.providerId;
    const entry = OUTREACH_PROVIDER_MAP.get(providerId);
    const requirement = buildProviderCredentialRequirement(providerId);
    if (!entry || !requirement) {
      res.status(400).json({ error: 'Unknown or manual-only communication provider.' });
      return;
    }
    const credentials = (req.body?.credentials || {}) as Record<string, string>;
    try {
      await credentialManager.setCredential(providerId, credentials, requirement, { isRotation: true });
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const ws = await getOutreachWorkspaceState(facade);
      appendOutreachAudit(ws, {
        actor,
        action: 'provider_credential_stored',
        entityType: 'provider',
        entityId: providerId,
        summary: `Stored encrypted credentials for outreach provider ${entry.name} (${providerId}).`,
      });
      await saveOutreachWorkspaceState(facade, ws);
      const providers = await listOutreachProviderStatuses(ws, credentialManager);
      await logPgAudit(isPg, req, 'OUTREACH_PROVIDER_CREDENTIAL_STORED', 'outreach_provider', providerId, {
        providerName: entry.name,
      });
      res.json({ success: true, providers });
    } catch (err: unknown) {
      res.status(400).json({
        error: sanitizeApiError(err, 'Failed to store encrypted provider credentials.'),
      });
    }
  });

  router.delete('/outreach/providers/:providerId/credentials', async (req: Request, res: Response) => {
    const providerId = req.params.providerId;
    const entry = OUTREACH_PROVIDER_MAP.get(providerId);
    const requirement = buildProviderCredentialRequirement(providerId);
    if (!entry || !requirement) {
      res.status(400).json({ error: 'Unknown or manual-only communication provider.' });
      return;
    }
    try {
      await credentialManager.removeCredential(providerId, requirement);
      const { facade, isPg } = getFacade();
      const actor = req.owner?.fullName || req.owner?.email || 'Owner';
      const ws = await getOutreachWorkspaceState(facade);
      appendOutreachAudit(ws, {
        actor,
        action: 'provider_credential_removed',
        entityType: 'provider',
        entityId: providerId,
        summary: `Removed stored encrypted credentials for outreach provider ${entry.name} (${providerId}).`,
      });
      await saveOutreachWorkspaceState(facade, ws);
      const providers = await listOutreachProviderStatuses(ws, credentialManager);
      await logPgAudit(isPg, req, 'OUTREACH_PROVIDER_CREDENTIAL_REMOVED', 'outreach_provider', providerId, {
        providerName: entry.name,
      });
      res.json({ success: true, providers });
    } catch (err: unknown) {
      res.status(400).json({
        error: sanitizeApiError(err, 'Failed to remove provider credentials.'),
      });
    }
  });
}
