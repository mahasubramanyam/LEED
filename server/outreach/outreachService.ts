// Phase 15: Core Outreach & Follow-Up Automation Orchestration Service
// Enforces owner-only approval controls, duplicate enrollment protection, suppression & compliance checks,
// idempotent real provider dispatch (zero simulated delivery), CRM synchronization, and evidence-based analytics.

import crypto from 'crypto';
import {
  OUTREACH_CAMPAIGN_STATUS_SET,
  OUTREACH_CHANNEL_SET,
  OUTREACH_FOLLOWUP_TRIGGER_SET,
  OUTREACH_SUPPRESSION_TYPE_SET,
} from '../../shared/outreachSpecs.js';
import type {
  AiDraftTone,
  AiDraftType,
  CanonicalLead,
  OutreachAnalyticsSummary,
  OutreachCampaignModeV2,
  OutreachCampaignStatusV2,
  OutreachCampaignV2,
  OutreachChannelV2,
  OutreachComplianceConfig,
  OutreachEnrollment,
  OutreachEnrollmentStatusV2,
  OutreachFollowUpItem,
  OutreachFollowUpTriggerV2,
  OutreachMessageRecord,
  OutreachProviderSettings,
  OutreachProviderStatus,
  OutreachSequence,
  OutreachSequenceStep,
  OutreachSuppressionEntry,
  OutreachSuppressionScopeV2,
  OutreachSuppressionTypeV2,
  OutreachWorkspaceState,
  PersonRecord,
} from '../types.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import { createCrmInteraction, getEntityInteractions } from '../crm/crmStoreHelper.js';
import { getAiWorkspaceState } from '../ai/aiStoreHelper.js';
import type { CredentialManager } from '../connectors/core/credentialManager.js';
import {
  appendOutreachAudit,
  generateOutreachId,
  getOutreachWorkspaceState,
  saveOutreachWorkspaceState,
} from './outreachStoreHelper.js';
import {
  checkSuppressionStatus,
  createSuppressionRecord,
  evaluateOutreachCompliance,
  isEmailSyntaxValid,
  normalizeEmail,
} from './suppressionCompliance.js';
import {
  dispatchViaAuthorizedEmailProvider,
  isChannelAutomatedSendingAllowed,
  listOutreachProviderStatuses,
} from './providerAbstraction.js';
import {
  cancelPendingFollowUpsForEnrollment,
  evaluateOverdueFollowUps,
  resolveRecipientTimezone,
  scheduleContextualFollowUp,
} from './followUpScheduler.js';
import { generatePersonalizedOutreachDraft } from './outreachPersonalizationService.js';

function buildIdempotencyKey(parts: {
  campaignId: string;
  enrollmentId?: string;
  leadId: string;
  personId?: string;
  stepNumber: number;
  channel: string;
}): string {
  const raw = [
    parts.campaignId,
    parts.enrollmentId || 'direct',
    parts.leadId,
    parts.personId || 'company',
    `step-${parts.stepNumber}`,
    parts.channel,
  ].join('|');
  return `leed-outreach-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
}

// ============================================================================
// WORKSPACE OVERVIEW & ANALYTICS
// ============================================================================

export async function getOutreachWorkspaceOverview(
  facade: CrmStorageFacade,
  credentialManager?: CredentialManager
): Promise<{
  workspace: OutreachWorkspaceState;
  providers: OutreachProviderStatus[];
  analytics: OutreachAnalyticsSummary;
}> {
  const ws = await getOutreachWorkspaceState(facade);
  const providers = await listOutreachProviderStatuses(ws, credentialManager);
  const analytics = buildOutreachAnalytics(ws);
  return { workspace: ws, providers, analytics };
}

export function buildOutreachAnalytics(
  ws: OutreachWorkspaceState,
  now = new Date()
): OutreachAnalyticsSummary {
  const campaignsTotal = ws.campaigns.length;
  const campaignsActive = ws.campaigns.filter((c) => c.status === 'active').length;
  const enrollmentsTotal = ws.enrollments.length;
  const enrollmentsActive = ws.enrollments.filter((e) => e.status === 'active').length;

  const messagesDrafted = ws.messages.length;
  const messagesPendingApproval = ws.messages.filter(
    (m) => m.status === 'draft' || m.status === 'pending_approval'
  ).length;
  const messagesApproved = ws.messages.filter((m) => m.status === 'approved').length;
  const messagesSentViaProvider = ws.messages.filter((m) => m.status === 'sent').length;
  const messagesManualSent = ws.messages.filter((m) => m.status === 'manual_sent').length;
  const messagesTotalDispatched = messagesSentViaProvider + messagesManualSent;
  const deliveryFailures = ws.messages.filter((m) => m.status === 'failed').length;

  const repliesReceived = ws.replies.length;
  const positiveResponses = ws.replies.filter(
    (r) =>
      r.classification === 'positive' ||
      r.classification === 'meeting_interest' ||
      r.classification === 'information_request' ||
      r.classification === 'referral'
  ).length;
  const meetingsBooked =
    ws.replies.filter((r) => r.classification === 'meeting_interest').length +
    ws.followUps.filter((f) => f.triggerType === 'meeting_scheduled').length;

  const pendingFollowUps = ws.followUps.filter(
    (f) => f.status === 'scheduled' || f.status === 'pending_approval'
  );
  const overdueEval = evaluateOverdueFollowUps(ws, now);
  const optOutsAndSuppressions = ws.suppressions.filter((s) => s.active).length;

  const safeRate = (num: number, denom: number): number | null => {
    if (denom <= 0) return null;
    return Number(((num / denom) * 100).toFixed(1));
  };

  const optOutReplies = ws.replies.filter((r) => r.classification === 'unsubscribe').length;

  const byCampaign = ws.campaigns.map((c) => {
    const cEnroll = ws.enrollments.filter((e) => e.campaignId === c.id);
    const cMsgs = ws.messages.filter((m) => m.campaignId === c.id);
    const cReplies = ws.replies.filter((r) => r.campaignId === c.id);
    return {
      campaignId: c.id,
      campaignName: c.name,
      status: c.status,
      channel: c.channel,
      targetIcpName: c.targetIcpName,
      enrolled: cEnroll.length,
      drafted: cMsgs.length,
      approved: cMsgs.filter((m) => m.status === 'approved').length,
      sent: cMsgs.filter((m) => m.status === 'sent' || m.status === 'manual_sent').length,
      failed: cMsgs.filter((m) => m.status === 'failed').length,
      replies: cReplies.length,
      positiveReplies: cReplies.filter(
        (r) =>
          r.classification === 'positive' ||
          r.classification === 'meeting_interest' ||
          r.classification === 'information_request' ||
          r.classification === 'referral'
      ).length,
      meetingsBooked: cReplies.filter((r) => r.classification === 'meeting_interest').length,
      optOuts: cReplies.filter((r) => r.classification === 'unsubscribe').length,
    };
  });

  // Group by ICP
  const icpMap = new Map<
    string,
    {
      icpId: string;
      icpName: string;
      campaignsCount: number;
      enrolled: number;
      sent: number;
      replies: number;
      positiveReplies: number;
      meetingsBooked: number;
    }
  >();
  for (const row of byCampaign) {
    const camp = ws.campaigns.find((c) => c.id === row.campaignId);
    const key = camp?.targetIcpId || '__unassigned_icp';
    const name = camp?.targetIcpName || 'No ICP Assigned';
    const cur = icpMap.get(key) || {
      icpId: key,
      icpName: name,
      campaignsCount: 0,
      enrolled: 0,
      sent: 0,
      replies: 0,
      positiveReplies: 0,
      meetingsBooked: 0,
    };
    cur.campaignsCount += 1;
    cur.enrolled += row.enrolled;
    cur.sent += row.sent;
    cur.replies += row.replies;
    cur.positiveReplies += row.positiveReplies;
    cur.meetingsBooked += row.meetingsBooked;
    icpMap.set(key, cur);
  }

  const channels: OutreachChannelV2[] = ['email', 'linkedin', 'phone', 'custom'];
  const byChannel = channels.map((ch) => {
    const chMsgs = ws.messages.filter((m) => m.channel === ch);
    const chReplies = ws.replies.filter((r) => r.channel === ch);
    return {
      channel: ch,
      drafted: chMsgs.length,
      sent: chMsgs.filter((m) => m.status === 'sent').length,
      manualSent: chMsgs.filter((m) => m.status === 'manual_sent').length,
      failed: chMsgs.filter((m) => m.status === 'failed').length,
      replies: chReplies.length,
      positiveReplies: chReplies.filter(
        (r) =>
          r.classification === 'positive' ||
          r.classification === 'meeting_interest' ||
          r.classification === 'information_request' ||
          r.classification === 'referral'
      ).length,
    };
  });

  return {
    generatedAt: now.toISOString(),
    totals: {
      campaignsTotal,
      campaignsActive,
      enrollmentsTotal,
      enrollmentsActive,
      messagesDrafted,
      messagesPendingApproval,
      messagesApproved,
      messagesSentViaProvider,
      messagesManualSent,
      messagesTotalDispatched,
      deliveryFailures,
      repliesReceived,
      positiveResponses,
      meetingsBooked,
      followUpsPending: pendingFollowUps.length,
      followUpsOverdue: overdueEval.overdueItems.length,
      optOutsAndSuppressions,
    },
    rates: {
      replyRatePercent: safeRate(repliesReceived, messagesTotalDispatched),
      positiveResponseRatePercent: safeRate(positiveResponses, messagesTotalDispatched),
      meetingConversionRatePercent: safeRate(meetingsBooked, messagesTotalDispatched),
      optOutRatePercent: safeRate(optOutReplies, messagesTotalDispatched),
    },
    byCampaign,
    byIcp: Array.from(icpMap.values()),
    byChannel,
    unavailableMetrics: [
      {
        metric: 'Email Open Rate / Pixel Tracking',
        status: 'untracked',
        reason:
          'LEED intentionally omits hidden tracking pixels for B2B privacy and deliverability accuracy; open rates are not fabricated.',
      },
      {
        metric: 'Link Click-Through Rate (CTR)',
        status: 'untracked',
        reason: 'Link redirect wrapping is not enabled; click telemetry is not tracked.',
      },
      {
        metric: 'Automated Inbound Reply Sync & Delivery Webhooks',
        status: 'unavailable',
        reason:
          'No inbound IMAP/webhook receiver is active in this environment. Replies are logged via Manual Owner Reply Recording.',
      },
    ],
  };
}

// ============================================================================
// CAMPAIGN MANAGEMENT
// ============================================================================

export async function createOutreachCampaign(
  facade: CrmStorageFacade,
  input: {
    name: string;
    objective: string;
    description?: string;
    mode?: OutreachCampaignModeV2;
    channel?: OutreachChannelV2;
    targetIcpId?: string;
    defaultTone?: AiDraftTone;
    defaultProviderId?: string;
    dailySendLimit?: number;
    maxFollowUps?: number;
    complianceNotes?: string;
    createdBy: string;
    createDefaultSequence?: boolean;
  }
): Promise<{ campaign: OutreachCampaignV2; sequence?: OutreachSequence }> {
  const name = input.name.trim().slice(0, 140);
  const objective = input.objective.trim().slice(0, 300);
  if (!name) throw new Error('Campaign name is required.');
  if (!objective) throw new Error('Campaign objective is required.');

  const channel: OutreachChannelV2 =
    input.channel && OUTREACH_CHANNEL_SET.has(input.channel) ? input.channel : 'email';
  const mode: OutreachCampaignModeV2 =
    input.mode === 'controlled_batch' ? 'controlled_batch' : 'individual';

  const [ws, aiWs] = await Promise.all([
    getOutreachWorkspaceState(facade),
    getAiWorkspaceState(facade),
  ]);

  let targetIcpName: string | undefined;
  if (input.targetIcpId) {
    const icp = aiWs.icpProfiles.find((p) => p.id === input.targetIcpId);
    if (icp) targetIcpName = icp.name;
  }

  const now = new Date().toISOString();
  const campaignId = generateOutreachId('ocamp');
  const maxFollowUps = Math.min(10, Math.max(0, Math.round(input.maxFollowUps ?? 3)));
  const dailySendLimit = Math.min(200, Math.max(1, Math.round(input.dailySendLimit ?? 25)));

  const effectiveTone: AiDraftTone = input.defaultTone || 'warm_professional';
  let defaultSequence: OutreachSequence | undefined;
  if (input.createDefaultSequence !== false) {
    const seqId = generateOutreachId('oseq');
    const step1DraftType: AiDraftType = channel === 'linkedin' ? 'linkedin_message' : 'intro_email';
    const createdSeq: OutreachSequence = {
      id: seqId,
      campaignId,
      name: `${name} — Primary Sequence`,
      description: 'Initial outreach followed by spaced, approval-controlled follow-ups.',
      status: 'active',
      maxFollowUps,
      businessDaysOnly: ws.complianceConfig.businessDaysOnlyDefault,
      respectRecipientTimezone: true,
      stopOnReply: true,
      stopOnMeetingBooked: true,
      stopOnOpportunity: true,
      stopOnOptOut: true,
      steps: [
        {
          id: generateOutreachId('ostep'),
          stepNumber: 1,
          name: 'Initial Introduction',
          channel,
          draftType: step1DraftType,
          tone: effectiveTone,
          delayDays: 0,
          businessDaysOnly: ws.complianceConfig.businessDaysOnlyDefault,
          subjectTemplate: '{{campaign_objective}} — {{company_name}}',
          bodyTemplate: '',
          aiPersonalizationEnabled: true,
        },
        ...(maxFollowUps >= 1
          ? [
              {
                id: generateOutreachId('ostep'),
                stepNumber: 2,
                name: 'Follow-Up 1',
                channel,
                draftType: 'follow_up' as AiDraftType,
                tone: effectiveTone,
                delayDays: 3,
                businessDaysOnly: ws.complianceConfig.businessDaysOnlyDefault,
                subjectTemplate: 'Following up: {{campaign_objective}} ({{company_name}})',
                bodyTemplate: '',
                aiPersonalizationEnabled: true,
              },
            ]
          : []),
      ],
      createdAt: now,
      updatedAt: now,
    };
    defaultSequence = createdSeq;
    ws.sequences = [createdSeq, ...ws.sequences];
  }

  const campaign: OutreachCampaignV2 = {
    id: campaignId,
    name,
    objective,
    description: input.description?.trim().slice(0, 1200) || undefined,
    mode,
    channel,
    status: 'draft',
    targetIcpId: input.targetIcpId || undefined,
    targetIcpName,
    defaultTone: effectiveTone,
    defaultProviderId: input.defaultProviderId || undefined,
    sequenceId: defaultSequence?.id,
    dailySendLimit,
    maxFollowUps,
    complianceNotes: input.complianceNotes?.trim().slice(0, 600) || undefined,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  ws.campaigns = [campaign, ...ws.campaigns];
  appendOutreachAudit(ws, {
    actor: input.createdBy,
    action: 'campaign_created',
    entityType: 'campaign',
    entityId: campaign.id,
    summary: `Created outreach campaign "${campaign.name}" (${mode}, ${channel}).`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return { campaign, sequence: defaultSequence };
}

export async function updateOutreachCampaign(
  facade: CrmStorageFacade,
  campaignId: string,
  updates: Partial<{
    name: string;
    objective: string;
    description: string;
    mode: OutreachCampaignModeV2;
    channel: OutreachChannelV2;
    status: OutreachCampaignStatusV2;
    targetIcpId: string;
    defaultTone: AiDraftTone;
    defaultProviderId: string;
    dailySendLimit: number;
    maxFollowUps: number;
    complianceNotes: string;
  }>,
  actor: string
): Promise<OutreachCampaignV2> {
  const [ws, aiWs] = await Promise.all([
    getOutreachWorkspaceState(facade),
    getAiWorkspaceState(facade),
  ]);
  const idx = ws.campaigns.findIndex((c) => c.id === campaignId);
  if (idx === -1) throw new Error(`Campaign "${campaignId}" not found.`);

  const cur = ws.campaigns[idx];
  const now = new Date().toISOString();

  let targetIcpName = cur.targetIcpName;
  if (updates.targetIcpId !== undefined) {
    if (!updates.targetIcpId) {
      targetIcpName = undefined;
    } else {
      const icp = aiWs.icpProfiles.find((p) => p.id === updates.targetIcpId);
      targetIcpName = icp?.name;
    }
  }

  const nextStatus =
    updates.status && OUTREACH_CAMPAIGN_STATUS_SET.has(updates.status)
      ? updates.status
      : cur.status;

  const updated: OutreachCampaignV2 = {
    ...cur,
    name: updates.name !== undefined ? updates.name.trim().slice(0, 140) || cur.name : cur.name,
    objective:
      updates.objective !== undefined
        ? updates.objective.trim().slice(0, 300) || cur.objective
        : cur.objective,
    description:
      updates.description !== undefined
        ? updates.description.trim().slice(0, 1200) || undefined
        : cur.description,
    mode: updates.mode || cur.mode,
    channel:
      updates.channel && OUTREACH_CHANNEL_SET.has(updates.channel) ? updates.channel : cur.channel,
    status: nextStatus,
    targetIcpId: updates.targetIcpId !== undefined ? updates.targetIcpId || undefined : cur.targetIcpId,
    targetIcpName,
    defaultTone: updates.defaultTone || cur.defaultTone,
    defaultProviderId:
      updates.defaultProviderId !== undefined
        ? updates.defaultProviderId || undefined
        : cur.defaultProviderId,
    dailySendLimit:
      updates.dailySendLimit !== undefined
        ? Math.min(200, Math.max(1, Math.round(updates.dailySendLimit)))
        : cur.dailySendLimit,
    maxFollowUps:
      updates.maxFollowUps !== undefined
        ? Math.min(10, Math.max(0, Math.round(updates.maxFollowUps)))
        : cur.maxFollowUps,
    complianceNotes:
      updates.complianceNotes !== undefined
        ? updates.complianceNotes.trim().slice(0, 600) || undefined
        : cur.complianceNotes,
    archivedAt: nextStatus === 'archived' ? cur.archivedAt || now : undefined,
    updatedAt: now,
  };

  ws.campaigns[idx] = updated;

  // If campaign is paused or archived, pause active enrollments / cancel scheduled nudges if archived
  if (nextStatus === 'paused') {
    for (const enr of ws.enrollments) {
      if (enr.campaignId === campaignId && enr.status === 'active') {
        enr.status = 'paused';
        enr.updatedAt = now;
      }
    }
  } else if (nextStatus === 'active' && cur.status === 'paused') {
    for (const enr of ws.enrollments) {
      if (enr.campaignId === campaignId && enr.status === 'paused') {
        enr.status = 'active';
        enr.updatedAt = now;
      }
    }
  } else if (nextStatus === 'archived') {
    for (const enr of ws.enrollments) {
      if (enr.campaignId === campaignId && (enr.status === 'active' || enr.status === 'paused')) {
        enr.status = 'cancelled';
        enr.exitReason = 'Campaign archived by owner.';
        enr.updatedAt = now;
        cancelPendingFollowUpsForEnrollment(ws, enr.id, 'cancelled');
      }
    }
  }

  appendOutreachAudit(ws, {
    actor,
    action: nextStatus !== cur.status ? `campaign_${nextStatus}` : 'campaign_updated',
    entityType: 'campaign',
    entityId: campaignId,
    summary:
      nextStatus !== cur.status
        ? `Campaign "${updated.name}" transitioned from ${cur.status} to ${nextStatus}.`
        : `Updated campaign "${updated.name}".`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return updated;
}

// ============================================================================
// SEQUENCE MANAGEMENT
// ============================================================================

export async function upsertOutreachSequence(
  facade: CrmStorageFacade,
  input: {
    id?: string;
    campaignId: string;
    name: string;
    description?: string;
    status?: 'active' | 'paused' | 'archived';
    maxFollowUps?: number;
    businessDaysOnly?: boolean;
    respectRecipientTimezone?: boolean;
    stopOnReply?: boolean;
    stopOnMeetingBooked?: boolean;
    stopOnOpportunity?: boolean;
    stopOnOptOut?: boolean;
    steps: Array<{
      id?: string;
      stepNumber?: number;
      name: string;
      channel?: OutreachChannelV2;
      draftType?: AiDraftType;
      tone?: AiDraftTone;
      delayDays?: number;
      businessDaysOnly?: boolean;
      sendWindowStartHour?: number;
      sendWindowEndHour?: number;
      subjectTemplate?: string;
      bodyTemplate?: string;
      aiPersonalizationEnabled?: boolean;
      customInstructions?: string;
    }>;
  },
  actor: string
): Promise<OutreachSequence> {
  const ws = await getOutreachWorkspaceState(facade);
  const campaign = ws.campaigns.find((c) => c.id === input.campaignId);
  if (!campaign) throw new Error(`Campaign "${input.campaignId}" not found.`);
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error('A sequence must contain at least one step.');
  }

  const now = new Date().toISOString();
  const normalizedSteps: OutreachSequenceStep[] = input.steps.slice(0, 10).map((s, idx) => ({
    id: s.id || generateOutreachId('ostep'),
    stepNumber: idx + 1,
    name: (s.name || `Step ${idx + 1}`).trim().slice(0, 100),
    channel: s.channel && OUTREACH_CHANNEL_SET.has(s.channel) ? s.channel : campaign.channel,
    draftType: s.draftType || (idx === 0 ? 'intro_email' : 'follow_up'),
    tone: s.tone || campaign.defaultTone,
    delayDays: idx === 0 ? Math.max(0, Math.round(s.delayDays ?? 0)) : Math.max(1, Math.round(s.delayDays ?? 3)),
    businessDaysOnly: s.businessDaysOnly ?? input.businessDaysOnly ?? ws.complianceConfig.businessDaysOnlyDefault,
    sendWindowStartHour: s.sendWindowStartHour,
    sendWindowEndHour: s.sendWindowEndHour,
    subjectTemplate: (s.subjectTemplate || '').trim().slice(0, 220),
    bodyTemplate: (s.bodyTemplate || '').trim().slice(0, 6000),
    aiPersonalizationEnabled: s.aiPersonalizationEnabled !== false,
    customInstructions: s.customInstructions?.trim().slice(0, 600) || undefined,
  }));

  const existingIdx = input.id ? ws.sequences.findIndex((s) => s.id === input.id) : -1;
  const maxFollowUps = Math.min(
    10,
    Math.max(0, Math.round(input.maxFollowUps ?? Math.max(0, normalizedSteps.length - 1)))
  );

  const seq: OutreachSequence = {
    id: existingIdx >= 0 ? ws.sequences[existingIdx].id : generateOutreachId('oseq'),
    campaignId: campaign.id,
    name: input.name.trim().slice(0, 140) || `${campaign.name} Sequence`,
    description: input.description?.trim().slice(0, 600) || undefined,
    status: input.status || 'active',
    maxFollowUps,
    businessDaysOnly: input.businessDaysOnly ?? ws.complianceConfig.businessDaysOnlyDefault,
    respectRecipientTimezone: input.respectRecipientTimezone !== false,
    stopOnReply: input.stopOnReply !== false,
    stopOnMeetingBooked: input.stopOnMeetingBooked !== false,
    stopOnOpportunity: input.stopOnOpportunity !== false,
    stopOnOptOut: input.stopOnOptOut !== false,
    steps: normalizedSteps,
    createdAt: existingIdx >= 0 ? ws.sequences[existingIdx].createdAt : now,
    updatedAt: now,
  };

  if (existingIdx >= 0) {
    ws.sequences[existingIdx] = seq;
  } else {
    ws.sequences = [seq, ...ws.sequences];
  }

  campaign.sequenceId = seq.id;
  campaign.maxFollowUps = maxFollowUps;
  campaign.updatedAt = now;

  appendOutreachAudit(ws, {
    actor,
    action: existingIdx >= 0 ? 'sequence_updated' : 'sequence_created',
    entityType: 'sequence',
    entityId: seq.id,
    summary: `${existingIdx >= 0 ? 'Updated' : 'Created'} sequence "${seq.name}" (${seq.steps.length} step(s)).`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return seq;
}

// ============================================================================
// ENROLLMENT MANAGEMENT (WITH ELIGIBILITY, SUPPRESSION & DUPLICATE PROTECTION)
// ============================================================================

export interface EnrollmentAttemptOutcome {
  leadId: string;
  personId?: string;
  enrolled: boolean;
  enrollment?: OutreachEnrollment;
  rejectedReason?: string;
}

export async function enrollRecipientsInCampaign(
  facade: CrmStorageFacade,
  params: {
    campaignId: string;
    recipients: Array<{ leadId: string; personId?: string; recipientEmail?: string; recipientTimezone?: string }>;
    enrolledBy: string;
  }
): Promise<{
  enrolled: OutreachEnrollment[];
  rejected: EnrollmentAttemptOutcome[];
}> {
  const [ws, settings, relationships] = await Promise.all([
    getOutreachWorkspaceState(facade),
    facade.getSettings(),
    facade.getCompanyPersonRelationships(),
  ]);

  const campaign = ws.campaigns.find((c) => c.id === params.campaignId);
  if (!campaign) throw new Error(`Campaign "${params.campaignId}" not found.`);
  if (campaign.status === 'archived') {
    throw new Error('Cannot enroll recipients into an archived campaign.');
  }

  const sequence = campaign.sequenceId
    ? ws.sequences.find((s) => s.id === campaign.sequenceId)
    : ws.sequences.find((s) => s.campaignId === campaign.id);

  const enrolled: OutreachEnrollment[] = [];
  const rejected: EnrollmentAttemptOutcome[] = [];
  const now = new Date().toISOString();

  for (const target of params.recipients) {
    const lead = await facade.getLead(target.leadId);
    if (!lead) {
      rejected.push({
        leadId: target.leadId,
        personId: target.personId,
        enrolled: false,
        rejectedReason: 'Company/lead not found in CRM.',
      });
      continue;
    }

    const person = target.personId ? await facade.getPersonById(target.personId) : null;
    if (target.personId && !person) {
      rejected.push({
        leadId: target.leadId,
        personId: target.personId,
        enrolled: false,
        rejectedReason: 'Selected decision-maker not found in CRM.',
      });
      continue;
    }

    // Duplicate active/paused enrollment protection per campaign + lead + person
    const existingDuplicate = ws.enrollments.find(
      (e) =>
        e.campaignId === campaign.id &&
        e.leadId === lead.id &&
        (e.personId || '') === (person?.id || '') &&
        (e.status === 'active' || e.status === 'paused')
    );
    if (existingDuplicate) {
      rejected.push({
        leadId: lead.id,
        personId: person?.id,
        enrolled: false,
        rejectedReason: 'Duplicate enrollment prevented: recipient is already actively enrolled in this campaign.',
      });
      continue;
    }

    const recipientEmail = normalizeEmail(target.recipientEmail || person?.email || lead.email);
    const recipientEmailStatus = person?.emailStatus || lead.emailStatus;

    // Suppression & opt-out enforcement before enrollment
    const suppression = checkSuppressionStatus({
      ws,
      settings,
      lead,
      person,
      recipientEmail,
      campaignId: campaign.id,
    });
    if (suppression.suppressed) {
      rejected.push({
        leadId: lead.id,
        personId: person?.id,
        enrolled: false,
        rejectedReason: `Blocked by suppression/opt-out: ${suppression.reasons.join(' ')}`,
      });
      continue;
    }

    // Email channel eligibility validation
    const eligibilityNotes: string[] = [];
    if (campaign.channel === 'email') {
      if (!recipientEmail) {
        rejected.push({
          leadId: lead.id,
          personId: person?.id,
          enrolled: false,
          rejectedReason: 'Ineligible for email campaign: no email address recorded for this recipient.',
        });
        continue;
      }
      if (!isEmailSyntaxValid(recipientEmail)) {
        rejected.push({
          leadId: lead.id,
          personId: person?.id,
          enrolled: false,
          rejectedReason: `Ineligible for email campaign: invalid email syntax "${recipientEmail}".`,
        });
        continue;
      }
      if (recipientEmailStatus === 'unavailable') {
        rejected.push({
          leadId: lead.id,
          personId: person?.id,
          enrolled: false,
          rejectedReason: 'Ineligible for email campaign: recipient email is marked unavailable.',
        });
        continue;
      }
      if (recipientEmailStatus !== 'verified') {
        eligibilityNotes.push(
          `Email verification status is "${recipientEmailStatus || 'unverified'}"; review carefully prior to approval.`
        );
      }
    } else if (campaign.channel === 'linkedin') {
      eligibilityNotes.push('LinkedIn campaign: manual draft generation and manual external delivery only.');
    }

    const rel = person
      ? relationships.find((r) => r.personId === person.id && r.leadId === lead.id)
      : undefined;
    const personRole =
      rel?.jobTitle || rel?.designation || person?.decisionMakingFunction || person?.seniority;
    const countryCode = person?.countryCode || lead.address?.countryCode;
    const recipientTimezone = resolveRecipientTimezone(target.recipientTimezone, countryCode);

    const enrollment: OutreachEnrollment = {
      id: generateOutreachId('oenr'),
      campaignId: campaign.id,
      sequenceId: sequence?.id,
      leadId: lead.id,
      companyName: lead.companyName,
      personId: person?.id,
      personName: person?.fullName,
      personRole,
      recipientEmail,
      recipientEmailStatus,
      recipientCountryCode: countryCode,
      recipientTimezone,
      status: campaign.status === 'paused' ? 'paused' : 'active',
      currentStepNumber: 1,
      maxSteps: sequence ? sequence.steps.length : 1 + campaign.maxFollowUps,
      eligibilityNotes,
      enrolledBy: params.enrolledBy,
      enrolledAt: now,
      updatedAt: now,
      messagesSentCount: 0,
    };

    ws.enrollments = [enrollment, ...ws.enrollments];
    enrolled.push(enrollment);
  }

  if (enrolled.length > 0) {
    if (campaign.status === 'draft') {
      campaign.status = 'active';
      campaign.updatedAt = now;
    }
    appendOutreachAudit(ws, {
      actor: params.enrolledBy,
      action: 'recipients_enrolled',
      entityType: 'enrollment',
      entityId: campaign.id,
      summary: `Enrolled ${enrolled.length} recipient(s) into "${campaign.name}" (${rejected.length} ineligible/skipped).`,
    });
    await saveOutreachWorkspaceState(facade, ws);
  }

  return { enrolled, rejected };
}

export async function transitionEnrollmentStatus(
  facade: CrmStorageFacade,
  enrollmentId: string,
  status: OutreachEnrollmentStatusV2,
  reason: string | undefined,
  actor: string
): Promise<OutreachEnrollment> {
  const ws = await getOutreachWorkspaceState(facade);
  const enr = ws.enrollments.find((e) => e.id === enrollmentId);
  if (!enr) throw new Error(`Enrollment "${enrollmentId}" not found.`);

  const now = new Date().toISOString();
  enr.status = status;
  if (reason) enr.exitReason = reason.trim().slice(0, 300);
  enr.updatedAt = now;

  if (status !== 'active') {
    enr.nextScheduledAt = undefined;
    if (status !== 'paused') {
      cancelPendingFollowUpsForEnrollment(
        ws,
        enr.id,
        status === 'exited_opted_out' || status === 'exited_suppressed' ? 'suppressed' : 'cancelled'
      );
    }
  }

  appendOutreachAudit(ws, {
    actor,
    action: `enrollment_${status}`,
    entityType: 'enrollment',
    entityId: enr.id,
    summary: `Enrollment for ${enr.companyName}${enr.personName ? ` (${enr.personName})` : ''} set to ${status}.`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return enr;
}

// ============================================================================
// MESSAGE DRAFTING, EDITING, EXPLICIT APPROVAL & CONTROLLED DISPATCH
// ============================================================================

export async function generateOutreachMessageDraft(
  facade: CrmStorageFacade,
  params: {
    campaignId: string;
    leadId: string;
    personId?: string;
    enrollmentId?: string;
    stepNumber?: number;
    channel?: OutreachChannelV2;
    tone?: AiDraftTone;
    draftType?: AiDraftType;
    customInstructions?: string;
    includePrivateNotes?: boolean;
    actor: string;
  }
): Promise<OutreachMessageRecord> {
  const [ws, settings] = await Promise.all([
    getOutreachWorkspaceState(facade),
    facade.getSettings(),
  ]);

  const campaign = ws.campaigns.find((c) => c.id === params.campaignId);
  if (!campaign) throw new Error(`Campaign "${params.campaignId}" not found.`);

  const lead = await facade.getLead(params.leadId);
  if (!lead) throw new Error(`Company/lead "${params.leadId}" not found.`);

  const person = params.personId ? await facade.getPersonById(params.personId) : null;
  const enrollment = params.enrollmentId
    ? ws.enrollments.find((e) => e.id === params.enrollmentId)
    : ws.enrollments.find(
        (e) =>
          e.campaignId === campaign.id &&
          e.leadId === lead.id &&
          (e.personId || '') === (person?.id || '') &&
          e.status === 'active'
      );

  const sequence = campaign.sequenceId
    ? ws.sequences.find((s) => s.id === campaign.sequenceId)
    : undefined;
  const stepNumber = params.stepNumber ?? enrollment?.currentStepNumber ?? 1;
  const step = sequence?.steps.find((s) => s.stepNumber === stepNumber);
  const channel: OutreachChannelV2 = params.channel || step?.channel || campaign.channel;
  const tone: AiDraftTone = params.tone || step?.tone || campaign.defaultTone;
  const recipientEmail = normalizeEmail(enrollment?.recipientEmail || person?.email || lead.email);
  const recipientEmailStatus = enrollment?.recipientEmailStatus || person?.emailStatus || lead.emailStatus;

  // Hard block drafting if recipient is suppressed
  const suppression = checkSuppressionStatus({
    ws,
    settings,
    lead,
    person,
    recipientEmail,
    campaignId: campaign.id,
  });
  if (suppression.suppressed) {
    throw new Error(`Cannot draft outreach for suppressed recipient: ${suppression.reasons.join(' ')}`);
  }

  const personalized = await generatePersonalizedOutreachDraft({
    facade,
    campaign,
    lead,
    person,
    step,
    channel,
    tone,
    draftType: params.draftType,
    stepNumber,
    customInstructions: params.customInstructions,
    includePrivateNotes: params.includePrivateNotes === true,
    complianceConfig: ws.complianceConfig,
    ownerName: settings.ownerName || ws.complianceConfig.senderDisplayName,
  });

  const complianceCheck = evaluateOutreachCompliance({
    ws,
    settings,
    lead,
    person,
    recipientEmail,
    recipientEmailStatus,
    channel,
    campaignId: campaign.id,
    subject: personalized.subject,
    body: personalized.body,
  });

  const now = new Date().toISOString();
  const message: OutreachMessageRecord = {
    id: generateOutreachId('omsg'),
    campaignId: campaign.id,
    campaignName: campaign.name,
    sequenceId: sequence?.id,
    enrollmentId: enrollment?.id,
    stepNumber,
    leadId: lead.id,
    companyName: lead.companyName,
    personId: person?.id,
    recipientName: person?.fullName || enrollment?.personName,
    recipientRole: enrollment?.personRole,
    recipientEmail,
    recipientEmailStatus,
    channel,
    tone,
    subject: personalized.subject,
    body: personalized.body,
    status: 'pending_approval',
    idempotencyKey: buildIdempotencyKey({
      campaignId: campaign.id,
      enrollmentId: enrollment?.id,
      leadId: lead.id,
      personId: person?.id,
      stepNumber,
      channel,
    }),
    personalizationEvidence: personalized.personalizationEvidence,
    unknownsAndCaveats: personalized.unknownsAndCaveats,
    evidenceSources: personalized.evidenceSources,
    contextAudit: personalized.contextAudit,
    aiStatus: personalized.aiStatus,
    complianceCheck,
    createdAt: now,
    updatedAt: now,
    deliveryStatus: 'not_sent',
    attemptCount: 0,
  };

  ws.messages = [message, ...ws.messages];
  appendOutreachAudit(ws, {
    actor: params.actor,
    action: 'message_drafted',
    entityType: 'message',
    entityId: message.id,
    summary: `Generated outreach draft (Step ${stepNumber}, ${channel}) for ${lead.companyName} — awaiting owner approval.`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return message;
}

export async function editOutreachMessageDraft(
  facade: CrmStorageFacade,
  messageId: string,
  updates: { subject?: string; body?: string; recipientEmail?: string },
  actor: string
): Promise<OutreachMessageRecord> {
  const [ws, settings] = await Promise.all([
    getOutreachWorkspaceState(facade),
    facade.getSettings(),
  ]);
  const msg = ws.messages.find((m) => m.id === messageId);
  if (!msg) throw new Error(`Outreach message "${messageId}" not found.`);
  if (msg.status === 'sent' || msg.status === 'manual_sent' || msg.status === 'sending') {
    throw new Error('Cannot edit a message that has already been sent or is currently dispatching.');
  }

  const now = new Date().toISOString();
  const contentChanged =
    (updates.subject !== undefined && updates.subject.trim() !== msg.subject) ||
    (updates.body !== undefined && updates.body.trim() !== msg.body) ||
    (updates.recipientEmail !== undefined &&
      normalizeEmail(updates.recipientEmail) !== msg.recipientEmail);

  if (updates.subject !== undefined) msg.subject = updates.subject.trim().slice(0, 220);
  if (updates.body !== undefined) msg.body = updates.body.trim().slice(0, 12000);
  if (updates.recipientEmail !== undefined) {
    msg.recipientEmail = normalizeEmail(updates.recipientEmail);
  }

  // Critical safeguard: editing an approved draft invalidates prior approval so modified content must be re-approved
  if (contentChanged && msg.status === 'approved') {
    msg.status = 'pending_approval';
    msg.approvedAt = undefined;
    msg.approvedBy = undefined;
  } else if (msg.status === 'draft' || msg.status === 'rejected') {
    msg.status = 'pending_approval';
  }

  const [lead, person] = await Promise.all([
    facade.getLead(msg.leadId),
    msg.personId ? facade.getPersonById(msg.personId) : Promise.resolve(null),
  ]);

  msg.complianceCheck = evaluateOutreachCompliance({
    ws,
    settings,
    lead,
    person,
    recipientEmail: msg.recipientEmail,
    recipientEmailStatus: msg.recipientEmailStatus,
    channel: msg.channel,
    campaignId: msg.campaignId,
    subject: msg.subject,
    body: msg.body,
  });
  msg.updatedAt = now;

  appendOutreachAudit(ws, {
    actor,
    action: 'message_edited',
    entityType: 'message',
    entityId: msg.id,
    summary: `Edited outreach draft for ${msg.companyName}${
      contentChanged ? ' (approval reset; explicit re-approval required)' : ''
    }.`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return msg;
}

export async function approveOutreachMessage(
  facade: CrmStorageFacade,
  messageId: string,
  actor: string
): Promise<OutreachMessageRecord> {
  const [ws, settings] = await Promise.all([
    getOutreachWorkspaceState(facade),
    facade.getSettings(),
  ]);
  const msg = ws.messages.find((m) => m.id === messageId);
  if (!msg) throw new Error(`Outreach message "${messageId}" not found.`);
  if (msg.status === 'sent' || msg.status === 'manual_sent') {
    throw new Error('Message has already been sent.');
  }
  if (msg.status === 'cancelled') {
    throw new Error('Cancelled messages cannot be approved.');
  }
  if (!msg.body.trim()) {
    throw new Error('Message body cannot be empty.');
  }
  if (msg.channel === 'email' && !msg.subject.trim()) {
    throw new Error('Email subject cannot be empty.');
  }

  const [lead, person] = await Promise.all([
    facade.getLead(msg.leadId),
    msg.personId ? facade.getPersonById(msg.personId) : Promise.resolve(null),
  ]);

  const complianceCheck = evaluateOutreachCompliance({
    ws,
    settings,
    lead,
    person,
    recipientEmail: msg.recipientEmail,
    recipientEmailStatus: msg.recipientEmailStatus,
    channel: msg.channel,
    campaignId: msg.campaignId,
    subject: msg.subject,
    body: msg.body,
  });
  msg.complianceCheck = complianceCheck;

  if (!complianceCheck.passed) {
    await saveOutreachWorkspaceState(facade, ws);
    throw new Error(`Approval blocked by compliance checks: ${complianceCheck.blockedReasons.join(' ')}`);
  }

  const now = new Date().toISOString();
  msg.status = 'approved';
  msg.approvedAt = now;
  msg.approvedBy = actor;
  msg.rejectedAt = undefined;
  msg.rejectedBy = undefined;
  msg.rejectionReason = undefined;
  msg.updatedAt = now;

  appendOutreachAudit(ws, {
    actor,
    action: 'message_approved',
    entityType: 'message',
    entityId: msg.id,
    summary: `Owner approved outreach message for ${msg.companyName} (${msg.channel}, Step ${msg.stepNumber}).`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return msg;
}

export async function rejectOutreachMessage(
  facade: CrmStorageFacade,
  messageId: string,
  reason: string | undefined,
  actor: string
): Promise<OutreachMessageRecord> {
  const ws = await getOutreachWorkspaceState(facade);
  const msg = ws.messages.find((m) => m.id === messageId);
  if (!msg) throw new Error(`Outreach message "${messageId}" not found.`);
  if (msg.status === 'sent' || msg.status === 'manual_sent') {
    throw new Error('Cannot reject a message that was already sent.');
  }

  const now = new Date().toISOString();
  msg.status = 'rejected';
  msg.rejectedAt = now;
  msg.rejectedBy = actor;
  msg.rejectionReason = reason?.trim().slice(0, 300) || 'Rejected by owner during review.';
  msg.approvedAt = undefined;
  msg.approvedBy = undefined;
  msg.updatedAt = now;

  appendOutreachAudit(ws, {
    actor,
    action: 'message_rejected',
    entityType: 'message',
    entityId: msg.id,
    summary: `Rejected outreach draft for ${msg.companyName}.`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return msg;
}

export async function cancelOutreachMessage(
  facade: CrmStorageFacade,
  messageId: string,
  actor: string
): Promise<OutreachMessageRecord> {
  const ws = await getOutreachWorkspaceState(facade);
  const msg = ws.messages.find((m) => m.id === messageId);
  if (!msg) throw new Error(`Outreach message "${messageId}" not found.`);
  if (msg.status === 'sent' || msg.status === 'manual_sent') {
    throw new Error('Cannot cancel a message that was already dispatched.');
  }

  const now = new Date().toISOString();
  msg.status = 'cancelled';
  msg.cancelledAt = now;
  msg.cancelledBy = actor;
  msg.approvedAt = undefined;
  msg.approvedBy = undefined;
  msg.updatedAt = now;

  appendOutreachAudit(ws, {
    actor,
    action: 'message_cancelled',
    entityType: 'message',
    entityId: msg.id,
    summary: `Cancelled outreach message for ${msg.companyName} before dispatch.`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return msg;
}

async function recordOutboundCrmSyncAndAdvanceSequence(params: {
  facade: CrmStorageFacade;
  ws: OutreachWorkspaceState;
  settings: Awaited<ReturnType<CrmStorageFacade['getSettings']>>;
  msg: OutreachMessageRecord;
  lead: CanonicalLead;
  person: PersonRecord | null;
  actor: string;
}): Promise<{ nextFollowUp?: OutreachFollowUpItem }> {
  const { facade, ws, settings, msg, lead, person, actor } = params;
  const now = new Date().toISOString();

  // Deduplicated CRM Interaction sync
  const summary = `Outreach ${msg.deliveryMethod === 'manual_external' ? 'manually sent' : 'sent'} (${msg.channel}, Step ${msg.stepNumber}) — ${msg.campaignName}: ${msg.subject.slice(0, 80)}`;
  const existingInteractions = getEntityInteractions(lead.customFields);
  const dup = existingInteractions.find(
    (it) =>
      it.summary === summary &&
      Math.abs(new Date(it.occurredAt).getTime() - new Date(msg.sentAt || now).getTime()) < 60_000
  );

  if (!dup) {
    const interaction = await createCrmInteraction(facade, {
      leadId: lead.id,
      personId: person?.id,
      type:
        msg.channel === 'email'
          ? 'email'
          : msg.channel === 'linkedin'
          ? 'linkedin'
          : msg.channel === 'phone'
          ? 'phone_call'
          : 'note',
      occurredAt: msg.sentAt || now,
      summary,
      detailedNotes: msg.body,
      outcome:
        msg.deliveryMethod === 'manual_external'
          ? 'Manually sent externally by owner after explicit approval'
          : `Dispatched via ${msg.providerName || msg.providerId} (Message ID: ${msg.providerMessageId || 'n/a'})`,
      recordedBy: actor,
    });
    msg.crmInteractionId = interaction.id;
  } else {
    msg.crmInteractionId = dup.id;
  }

  // Update campaign attribution & conservative status progression on CRM lead
  const freshLead = await facade.getLead(lead.id);
  if (freshLead) {
    let existingAttribution: Array<{ campaignId: string; campaignName: string; lastSentAt: string; messageCount: number }> = [];
    try {
      const parsed = JSON.parse(freshLead.customFields?.outreachCampaignAttribution || '[]');
      if (Array.isArray(parsed)) existingAttribution = parsed;
    } catch {
      existingAttribution = [];
    }
    const attrIdx = existingAttribution.findIndex((a) => a.campaignId === msg.campaignId);
    if (attrIdx >= 0) {
      existingAttribution[attrIdx] = {
        ...existingAttribution[attrIdx],
        lastSentAt: msg.sentAt || now,
        messageCount: (existingAttribution[attrIdx].messageCount || 0) + 1,
      };
    } else {
      existingAttribution.push({
        campaignId: msg.campaignId,
        campaignName: msg.campaignName,
        lastSentAt: msg.sentAt || now,
        messageCount: 1,
      });
    }

    const nextLeadStatus =
      freshLead.status === 'new' || freshLead.status === 'reviewed' || freshLead.status === 'qualified'
        ? 'contacted'
        : freshLead.status;

    await facade.upsertLead({
      ...freshLead,
      status: nextLeadStatus,
      customFields: {
        ...(freshLead.customFields || {}),
        outreachCampaignAttribution: JSON.stringify(existingAttribution),
      },
      updatedAt: now,
    });
  }

  // Advance enrollment & schedule next sequence follow-up if applicable
  let nextFollowUp: OutreachFollowUpItem | undefined;
  const campaign = ws.campaigns.find((c) => c.id === msg.campaignId);
  const enrollment = msg.enrollmentId
    ? ws.enrollments.find((e) => e.id === msg.enrollmentId)
    : ws.enrollments.find(
        (e) =>
          e.campaignId === msg.campaignId &&
          e.leadId === msg.leadId &&
          (e.personId || '') === (msg.personId || '') &&
          e.status === 'active'
      );

  if (enrollment && enrollment.status === 'active') {
    enrollment.messagesSentCount = (enrollment.messagesSentCount || 0) + 1;
    enrollment.lastContactedAt = msg.sentAt || now;
    enrollment.updatedAt = now;

    const sequence = enrollment.sequenceId
      ? ws.sequences.find((s) => s.id === enrollment.sequenceId)
      : undefined;
    const nextStepNumber = msg.stepNumber + 1;
    const nextStep = sequence?.steps.find((s) => s.stepNumber === nextStepNumber);
    const maxAllowedMessages = 1 + (sequence?.maxFollowUps ?? campaign?.maxFollowUps ?? 3);

    if (
      enrollment.messagesSentCount < maxAllowedMessages &&
      (nextStep || nextStepNumber <= enrollment.maxSteps)
    ) {
      enrollment.currentStepNumber = nextStepNumber;
      const sched = scheduleContextualFollowUp({
        ws,
        settings,
        lead,
        person,
        campaign,
        sequence,
        enrollment,
        messageId: msg.id,
        stepNumber: nextStepNumber,
        triggerType: 'no_response',
        delayDays: nextStep?.delayDays ?? 3,
        businessDaysOnly: nextStep?.businessDaysOnly ?? sequence?.businessDaysOnly,
      });
      if (sched.scheduled && sched.item) {
        enrollment.nextScheduledAt = sched.item.scheduledFor;
        nextFollowUp = sched.item;
      }
    } else {
      enrollment.status = 'completed';
      enrollment.nextScheduledAt = undefined;
      enrollment.exitReason = 'All configured sequence steps completed.';
    }
  }

  return { nextFollowUp };
}

export async function dispatchApprovedOutreachMessage(
  facade: CrmStorageFacade,
  params: {
    messageId: string;
    providerId?: string;
    actor: string;
    credentialManager?: CredentialManager;
  }
): Promise<{
  sent: boolean;
  message: OutreachMessageRecord;
  nextFollowUp?: OutreachFollowUpItem;
  error?: string;
  httpStatus?: number;
}> {
  const [ws, settings] = await Promise.all([
    getOutreachWorkspaceState(facade),
    facade.getSettings(),
  ]);

  const msg = ws.messages.find((m) => m.id === params.messageId);
  if (!msg) throw new Error(`Outreach message "${params.messageId}" not found.`);

  // 1. STRICT EXPLICIT APPROVAL GATE
  if (msg.status !== 'approved') {
    throw new Error(
      `Dispatch refused: message status is "${msg.status}". Explicit owner approval is required before any message can be sent.`
    );
  }

  // 2. IDEMPOTENCY / DUPLICATE SEND GUARD
  const duplicateAlreadySent = ws.messages.some(
    (other) =>
      other.id !== msg.id &&
      other.idempotencyKey === msg.idempotencyKey &&
      (other.status === 'sent' || other.status === 'manual_sent')
  );
  if (msg.providerMessageId || duplicateAlreadySent) {
    throw new Error(
      'Duplicate dispatch blocked by idempotency protection: this outreach step has already been sent.'
    );
  }

  // 3. CHANNEL POLICY GUARD (LinkedIn automated sending strictly forbidden)
  if (!isChannelAutomatedSendingAllowed(msg.channel)) {
    throw new Error(
      `Automated sending is disabled for channel "${msg.channel}" by LEED compliance policy. Copy the approved draft and use "Record Manual Send" instead.`
    );
  }

  // 4. CAMPAIGN ACTIVE GUARD
  const campaign = ws.campaigns.find((c) => c.id === msg.campaignId);
  if (campaign && (campaign.status === 'paused' || campaign.status === 'archived')) {
    throw new Error(
      `Dispatch blocked because campaign "${campaign.name}" is currently "${campaign.status}".`
    );
  }

  const [lead, person] = await Promise.all([
    facade.getLead(msg.leadId),
    msg.personId ? facade.getPersonById(msg.personId) : Promise.resolve(null),
  ]);
  if (!lead) throw new Error(`Lead "${msg.leadId}" no longer exists in CRM.`);

  // 5. LIVE PRE-DISPATCH COMPLIANCE, SUPPRESSION & FREQUENCY CHECK
  const complianceCheck = evaluateOutreachCompliance({
    ws,
    settings,
    lead,
    person,
    recipientEmail: msg.recipientEmail,
    recipientEmailStatus: msg.recipientEmailStatus,
    channel: msg.channel,
    campaignId: msg.campaignId,
    subject: msg.subject,
    body: msg.body,
    checkFrequency: true,
  });
  msg.complianceCheck = complianceCheck;
  if (!complianceCheck.passed) {
    msg.updatedAt = new Date().toISOString();
    await saveOutreachWorkspaceState(facade, ws);
    throw new Error(`Dispatch blocked by compliance/suppression: ${complianceCheck.blockedReasons.join(' ')}`);
  }

  // 6. REAL SERVER-SIDE PROVIDER DISPATCH (NEVER SIMULATES DELIVERY WHEN UNCONFIGURED)
  const dispatchResult = await dispatchViaAuthorizedEmailProvider({
    ws,
    providerId: params.providerId || campaign?.defaultProviderId,
    payload: {
      toEmail: msg.recipientEmail!,
      toName: msg.recipientName,
      subject: msg.subject,
      textBody: msg.body,
      idempotencyKey: msg.idempotencyKey,
    },
    credentialManager: params.credentialManager,
  });

  const now = new Date().toISOString();

  // If no provider configured or sender email missing (attempts === 0 and 422), keep status='approved' honestly
  if (dispatchResult.attempts === 0 && !dispatchResult.response.ok) {
    msg.lastError = dispatchResult.response.error;
    msg.updatedAt = now;
    appendOutreachAudit(ws, {
      actor: params.actor,
      action: 'dispatch_blocked_unconfigured',
      entityType: 'message',
      entityId: msg.id,
      summary: `Dispatch did not execute for ${msg.companyName}: ${dispatchResult.response.summary}`,
    });
    await saveOutreachWorkspaceState(facade, ws);
    return {
      sent: false,
      message: msg,
      error: dispatchResult.response.error,
      httpStatus: dispatchResult.response.httpStatus,
    };
  }

  msg.attemptCount = (msg.attemptCount || 0) + dispatchResult.attempts;
  msg.lastAttemptAt = now;
  msg.providerId = dispatchResult.providerId;
  msg.providerName = dispatchResult.providerName;
  msg.providerResponseSummary = dispatchResult.response.summary;

  if (dispatchResult.response.ok) {
    msg.status = 'sent';
    msg.deliveryMethod = 'provider_api';
    msg.deliveryStatus = dispatchResult.response.deliveryStatus;
    msg.providerMessageId = dispatchResult.response.providerMessageId;
    msg.sentAt = now;
    msg.lastError = undefined;
    msg.updatedAt = now;

    const { nextFollowUp } = await recordOutboundCrmSyncAndAdvanceSequence({
      facade,
      ws,
      settings,
      msg,
      lead,
      person: person ?? null,
      actor: params.actor,
    });

    appendOutreachAudit(ws, {
      actor: params.actor,
      action: 'message_sent',
      entityType: 'message',
      entityId: msg.id,
      summary: `Sent approved email to ${msg.recipientEmail} via ${msg.providerName} (ID: ${msg.providerMessageId}).`,
    });

    await saveOutreachWorkspaceState(facade, ws);
    return { sent: true, message: msg, nextFollowUp, httpStatus: dispatchResult.response.httpStatus };
  }

  // Provider returned failure / bounce after bounded retries
  msg.status = 'failed';
  msg.deliveryMethod = 'provider_api';
  msg.deliveryStatus = dispatchResult.response.deliveryStatus;
  msg.lastError = dispatchResult.response.error;
  msg.updatedAt = now;

  if (dispatchResult.response.deliveryStatus === 'bounced' && msg.enrollmentId) {
    const enr = ws.enrollments.find((e) => e.id === msg.enrollmentId);
    if (enr) {
      enr.status = 'exited_bounced';
      enr.exitReason = `Provider rejected/bounced recipient (${dispatchResult.response.summary}).`;
      enr.updatedAt = now;
    }
  }

  scheduleContextualFollowUp({
    ws,
    settings,
    lead,
    person,
    campaign,
    messageId: msg.id,
    triggerType: 'failed_delivery',
    delayDays: 1,
    customExplanation: `Delivery failed via ${msg.providerName || 'provider'}: ${dispatchResult.response.summary}. Verify recipient email or retry.`,
  });

  appendOutreachAudit(ws, {
    actor: params.actor,
    action: 'message_dispatch_failed',
    entityType: 'message',
    entityId: msg.id,
    summary: `Email dispatch failed for ${msg.companyName} after ${dispatchResult.attempts} attempt(s): ${dispatchResult.response.summary}`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return {
    sent: false,
    message: msg,
    error: dispatchResult.response.error,
    httpStatus: dispatchResult.response.httpStatus,
  };
}

export async function markMessageManuallySent(
  facade: CrmStorageFacade,
  params: {
    messageId: string;
    notes?: string;
    actor: string;
  }
): Promise<{ message: OutreachMessageRecord; nextFollowUp?: OutreachFollowUpItem }> {
  const [ws, settings] = await Promise.all([
    getOutreachWorkspaceState(facade),
    facade.getSettings(),
  ]);
  const msg = ws.messages.find((m) => m.id === params.messageId);
  if (!msg) throw new Error(`Outreach message "${params.messageId}" not found.`);

  if (msg.status !== 'approved') {
    throw new Error(
      `Cannot record manual send while message status is "${msg.status}". Approve the draft first.`
    );
  }

  const [lead, person] = await Promise.all([
    facade.getLead(msg.leadId),
    msg.personId ? facade.getPersonById(msg.personId) : Promise.resolve(null),
  ]);
  if (!lead) throw new Error(`Lead "${msg.leadId}" not found.`);

  const complianceCheck = evaluateOutreachCompliance({
    ws,
    settings,
    lead,
    person,
    recipientEmail: msg.recipientEmail,
    recipientEmailStatus: msg.recipientEmailStatus,
    channel: msg.channel,
    campaignId: msg.campaignId,
    subject: msg.subject,
    body: msg.body,
    checkFrequency: false,
  });
  if (!complianceCheck.passed && msg.channel === 'email') {
    const suppressionOnly = checkSuppressionStatus({
      ws,
      settings,
      lead,
      person,
      recipientEmail: msg.recipientEmail,
      campaignId: msg.campaignId,
    });
    if (suppressionOnly.suppressed) {
      throw new Error(`Manual send blocked by suppression: ${suppressionOnly.reasons.join(' ')}`);
    }
  }

  const now = new Date().toISOString();
  msg.status = 'manual_sent';
  msg.deliveryMethod = 'manual_external';
  msg.deliveryStatus = 'manual_recorded';
  msg.providerResponseSummary =
    params.notes?.trim().slice(0, 260) ||
    `Manually sent externally by owner via ${msg.channel} (no automated provider dispatch).`;
  msg.sentAt = now;
  msg.updatedAt = now;

  const { nextFollowUp } = await recordOutboundCrmSyncAndAdvanceSequence({
    facade,
    ws,
    settings,
    msg,
    lead,
    person: person ?? null,
    actor: params.actor,
  });

  appendOutreachAudit(ws, {
    actor: params.actor,
    action: 'message_manual_sent',
    entityType: 'message',
    entityId: msg.id,
    summary: `Owner recorded manual external send (${msg.channel}) for ${msg.companyName}.`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return { message: msg, nextFollowUp };
}

// ============================================================================
// FOLLOW-UPS, SUPPRESSIONS, COMPLIANCE & PROVIDER SETTINGS
// ============================================================================

export async function createManualFollowUp(
  facade: CrmStorageFacade,
  input: {
    leadId: string;
    personId?: string;
    campaignId?: string;
    enrollmentId?: string;
    triggerType?: OutreachFollowUpTriggerV2;
    delayDays?: number;
    businessDaysOnly?: boolean;
    explanation?: string;
    recommendedAction?: string;
    actor: string;
  }
): Promise<{ scheduled: boolean; item?: OutreachFollowUpItem; skippedReason?: string }> {
  const [ws, settings] = await Promise.all([
    getOutreachWorkspaceState(facade),
    facade.getSettings(),
  ]);
  const lead = await facade.getLead(input.leadId);
  if (!lead) throw new Error(`Company/lead "${input.leadId}" not found.`);
  const person = input.personId ? await facade.getPersonById(input.personId) : null;
  const campaign = input.campaignId ? ws.campaigns.find((c) => c.id === input.campaignId) : undefined;
  const enrollment = input.enrollmentId
    ? ws.enrollments.find((e) => e.id === input.enrollmentId)
    : undefined;
  const triggerType: OutreachFollowUpTriggerV2 =
    input.triggerType && OUTREACH_FOLLOWUP_TRIGGER_SET.has(input.triggerType)
      ? input.triggerType
      : 'owner_requested';

  const result = scheduleContextualFollowUp({
    ws,
    settings,
    lead,
    person,
    campaign,
    enrollment,
    triggerType,
    delayDays: input.delayDays,
    businessDaysOnly: input.businessDaysOnly,
    customExplanation: input.explanation,
    recommendedAction: input.recommendedAction,
  });

  appendOutreachAudit(ws, {
    actor: input.actor,
    action: result.scheduled ? 'follow_up_scheduled' : 'follow_up_skipped',
    entityType: 'follow_up',
    entityId: result.item?.id || lead.id,
    summary: result.scheduled
      ? `Scheduled ${triggerType} follow-up for ${lead.companyName} on ${result.item!.scheduledFor.slice(0, 10)}.`
      : `Skipped ${triggerType} follow-up for ${lead.companyName}: ${result.skippedReason}`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return result;
}

export async function updateFollowUpStatus(
  facade: CrmStorageFacade,
  followUpId: string,
  updates: {
    status?: OutreachFollowUpItem['status'];
    scheduledFor?: string;
  },
  actor: string
): Promise<OutreachFollowUpItem> {
  const ws = await getOutreachWorkspaceState(facade);
  const item = ws.followUps.find((f) => f.id === followUpId);
  if (!item) throw new Error(`Follow-up "${followUpId}" not found.`);

  const now = new Date().toISOString();
  if (updates.status) item.status = updates.status;
  if (updates.scheduledFor && !Number.isNaN(new Date(updates.scheduledFor).getTime())) {
    item.scheduledFor = new Date(updates.scheduledFor).toISOString();
  }
  item.updatedAt = now;

  appendOutreachAudit(ws, {
    actor,
    action: `follow_up_${item.status}`,
    entityType: 'follow_up',
    entityId: item.id,
    summary: `Follow-up for ${item.companyName} updated to ${item.status}.`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return item;
}

export async function addSuppressionEntry(
  facade: CrmStorageFacade,
  input: {
    scope: OutreachSuppressionScopeV2;
    campaignId?: string;
    type: OutreachSuppressionTypeV2;
    email?: string;
    domain?: string;
    leadId?: string;
    personId?: string;
    reason: string;
    createdBy: string;
  }
): Promise<OutreachSuppressionEntry> {
  if (!OUTREACH_SUPPRESSION_TYPE_SET.has(input.type)) {
    throw new Error(`Invalid suppression type "${input.type}".`);
  }
  if (!input.email && !input.domain && !input.leadId && !input.personId) {
    throw new Error('Provide at least one target: email, domain, company/lead, or person.');
  }
  if (input.scope === 'campaign' && !input.campaignId) {
    throw new Error('Campaign-scoped suppression requires campaignId.');
  }

  const ws = await getOutreachWorkspaceState(facade);
  const lead = input.leadId ? await facade.getLead(input.leadId) : null;
  const person = input.personId ? await facade.getPersonById(input.personId) : null;

  const entry = createSuppressionRecord({
    scope: input.scope,
    campaignId: input.campaignId,
    type: input.type,
    email: input.email || person?.email,
    domain: input.domain,
    leadId: input.leadId,
    personId: input.personId,
    companyName: lead?.companyName,
    personName: person?.fullName,
    reason: input.reason || `Added ${input.type} suppression.`,
    createdBy: input.createdBy,
  });

  ws.suppressions = [entry, ...ws.suppressions];

  // Immediately exit matching active enrollments and suppress scheduled follow-ups
  const now = new Date().toISOString();
  for (const enr of ws.enrollments) {
    if (enr.status !== 'active' && enr.status !== 'paused') continue;
    if (entry.scope === 'campaign' && enr.campaignId !== entry.campaignId) continue;
    const enrDomain = enr.recipientEmail?.includes('@')
      ? enr.recipientEmail.toLowerCase().split('@')[1].replace(/^www\./, '')
      : undefined;
    const match =
      (entry.leadId && enr.leadId === entry.leadId) ||
      (entry.personId && enr.personId === entry.personId) ||
      (entry.email && enr.recipientEmail && enr.recipientEmail.toLowerCase() === entry.email) ||
      (entry.domain && enrDomain && enrDomain === entry.domain);
    if (match) {
      enr.status = entry.type === 'unsubscribe' ? 'exited_opted_out' : 'exited_suppressed';
      enr.exitReason = `Suppression applied (${entry.type}): ${entry.reason}`;
      enr.nextScheduledAt = undefined;
      enr.updatedAt = now;
      cancelPendingFollowUpsForEnrollment(ws, enr.id, 'suppressed');
    }
  }

  // If global do_not_contact or unsubscribe for a company, update lead status conservatively
  if (entry.scope === 'global' && (entry.type === 'do_not_contact' || entry.type === 'unsubscribe') && lead && !person) {
    await facade.upsertLead({
      ...lead,
      status: 'do_not_contact',
      updatedAt: now,
    });
  }

  appendOutreachAudit(ws, {
    actor: input.createdBy,
    action: 'suppression_added',
    entityType: 'suppression',
    entityId: entry.id,
    summary: `Added ${entry.scope} suppression (${entry.type}) for ${entry.email || entry.domain || entry.companyName || entry.personName}.`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return entry;
}

export async function deactivateSuppressionEntry(
  facade: CrmStorageFacade,
  suppressionId: string,
  actor: string
): Promise<OutreachSuppressionEntry> {
  const ws = await getOutreachWorkspaceState(facade);
  const entry = ws.suppressions.find((s) => s.id === suppressionId);
  if (!entry) throw new Error(`Suppression entry "${suppressionId}" not found.`);

  entry.active = false;
  entry.updatedAt = new Date().toISOString();

  appendOutreachAudit(ws, {
    actor,
    action: 'suppression_deactivated',
    entityType: 'suppression',
    entityId: entry.id,
    summary: `Deactivated suppression for ${entry.email || entry.domain || entry.companyName || entry.id}.`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return entry;
}

export async function updateOutreachComplianceConfig(
  facade: CrmStorageFacade,
  updates: Partial<OutreachComplianceConfig>,
  actor: string
): Promise<OutreachComplianceConfig> {
  const ws = await getOutreachWorkspaceState(facade);
  const now = new Date().toISOString();
  ws.complianceConfig = {
    ...ws.complianceConfig,
    ...updates,
    maxContactsPerCompanyPerWeek:
      updates.maxContactsPerCompanyPerWeek !== undefined
        ? Math.min(20, Math.max(1, Math.round(updates.maxContactsPerCompanyPerWeek)))
        : ws.complianceConfig.maxContactsPerCompanyPerWeek,
    maxContactsPerPersonPer14Days:
      updates.maxContactsPerPersonPer14Days !== undefined
        ? Math.min(10, Math.max(1, Math.round(updates.maxContactsPerPersonPer14Days)))
        : ws.complianceConfig.maxContactsPerPersonPer14Days,
    sendWindowStartHour:
      updates.sendWindowStartHour !== undefined
        ? Math.min(20, Math.max(6, Math.round(updates.sendWindowStartHour)))
        : ws.complianceConfig.sendWindowStartHour,
    sendWindowEndHour:
      updates.sendWindowEndHour !== undefined
        ? Math.min(22, Math.max(8, Math.round(updates.sendWindowEndHour)))
        : ws.complianceConfig.sendWindowEndHour,
    requireExplicitApprovalAlways: true,
    updatedAt: now,
  };

  appendOutreachAudit(ws, {
    actor,
    action: 'compliance_updated',
    entityType: 'compliance',
    entityId: 'compliance_config',
    summary: 'Updated outreach compliance settings and frequency guardrails.',
  });

  await saveOutreachWorkspaceState(facade, ws);
  return ws.complianceConfig;
}

export async function updateOutreachProviderSettings(
  facade: CrmStorageFacade,
  updates: Partial<OutreachProviderSettings>,
  actor: string
): Promise<OutreachProviderSettings> {
  const ws = await getOutreachWorkspaceState(facade);
  const now = new Date().toISOString();
  ws.providerSettings = {
    ...ws.providerSettings,
    defaultEmailProviderId:
      updates.defaultEmailProviderId !== undefined
        ? updates.defaultEmailProviderId || undefined
        : ws.providerSettings.defaultEmailProviderId,
    fromEmail:
      updates.fromEmail !== undefined ? updates.fromEmail.trim() : ws.providerSettings.fromEmail,
    fromName:
      updates.fromName !== undefined ? updates.fromName.trim().slice(0, 120) : ws.providerSettings.fromName,
    replyToEmail:
      updates.replyToEmail !== undefined
        ? updates.replyToEmail.trim() || undefined
        : ws.providerSettings.replyToEmail,
    maxRetries:
      updates.maxRetries !== undefined
        ? Math.min(3, Math.max(0, Math.round(updates.maxRetries)))
        : ws.providerSettings.maxRetries,
    rateLimitPerHourByProvider: {
      ...ws.providerSettings.rateLimitPerHourByProvider,
      ...(updates.rateLimitPerHourByProvider || {}),
    },
    updatedAt: now,
  };

  appendOutreachAudit(ws, {
    actor,
    action: 'provider_settings_updated',
    entityType: 'provider',
    entityId: 'provider_settings',
    summary: `Updated outreach provider settings (default: ${ws.providerSettings.defaultEmailProviderId || 'auto'}).`,
  });

  await saveOutreachWorkspaceState(facade, ws);
  return ws.providerSettings;
}
