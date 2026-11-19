// Phase 15: Reply Classification & Manual Owner Reply Recording Engine
// Classifies inbound replies into 7 canonical categories, records deduplicated CRM interactions,
// automatically exits active sequences, triggers global suppression & do_not_contact on unsubscribe,
// and schedules contextual follow-ups. Never fabricates inbound replies.

import { OUTREACH_REPLY_CLASSIFICATION_SET } from '../../shared/outreachSpecs.js';
import type {
  OutreachChannelV2,
  OutreachEnrollmentStatusV2,
  OutreachFollowUpItem,
  OutreachReplyClassificationV2,
  OutreachReplyRecord,
  OutreachWorkspaceState,
} from '../types.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import { createCrmInteraction, getEntityInteractions } from '../crm/crmStoreHelper.js';
import { generateStructuredJsonWithAi } from '../ai/aiProvider.js';
import {
  appendOutreachAudit,
  generateOutreachId,
  getOutreachWorkspaceState,
  saveOutreachWorkspaceState,
} from './outreachStoreHelper.js';
import { createSuppressionRecord } from './suppressionCompliance.js';
import {
  cancelPendingFollowUpsForEnrollment,
  scheduleContextualFollowUp,
} from './followUpScheduler.js';

export interface ReplyClassificationResult {
  classification: OutreachReplyClassificationV2;
  rationale: string;
  method: 'deterministic_rules' | 'ai_assisted';
}

const UNSUBSCRIBE_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bremove me\b/i,
  /\bstop (emailing|contacting|messaging)\b/i,
  /\bdo not contact\b/i,
  /\btake me off\b/i,
  /\bno further emails?\b/i,
];

const MEETING_PATTERNS = [
  /\b(schedule|book|set up|arrange)\b.{0,25}\b(call|meeting|chat|demo|time)\b/i,
  /\blet'?s (meet|talk|chat|connect|hop on a call)\b/i,
  /\bcalendar\b/i,
  /\bnext week\b.{0,25}\b(works|available|free|call|meet)\b/i,
  /\b(tuesday|wednesday|thursday|friday|monday)\b.{0,20}\b(am|pm|works|available)\b/i,
  /\bsend.{0,20}(invite|slots|times|availability)\b/i,
];

const REFERRAL_PATTERNS = [
  /\b(reach out to|contact|speak with|looping in|cc'?ing|copying|forward(ed|ing)? (this|your email) to)\b/i,
  /\bbetter person\b/i,
  /\bright person\b.{0,25}\bis\b/i,
  /\bhandles? this\b/i,
  /\bredirect(ing)? you to\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bnot interested\b/i,
  /\bno thanks?\b/i,
  /\bno thank you\b/i,
  /\bpass (for now|on this)\b/i,
  /\bnot a fit\b/i,
  /\bnot looking\b/i,
  /\balready have a (vendor|provider|solution)\b/i,
  /\bno budget\b/i,
];

const INFO_REQUEST_PATTERNS = [
  /\b(send|share)\b.{0,25}\b(more info|information|deck|pricing|brochure|details|case study|proposal)\b/i,
  /\bcan you tell me more\b/i,
  /\bwhat (does it cost|is your pricing|are your rates)\b/i,
  /\bhow does (it|this|your)\b/i,
  /\bmore details\b/i,
];

const POSITIVE_PATTERNS = [
  /\b(sounds|looks) (great|good|interesting|promising)\b/i,
  /\binterested\b/i,
  /\bthank(s| you) for reaching out\b/i,
  /\bhappy to (explore|discuss|learn more)\b/i,
  /\blove to\b/i,
];

export function classifyReplyDeterministic(
  body: string,
  subject?: string
): ReplyClassificationResult {
  const combined = `${subject || ''}\n${body || ''}`.trim();
  if (!combined) {
    return {
      classification: 'unknown',
      rationale: 'Empty reply text; requires owner review.',
      method: 'deterministic_rules',
    };
  }

  // Priority 1: Unsubscribe / Opt-Out (always highest compliance priority)
  if (UNSUBSCRIBE_PATTERNS.some((rx) => rx.test(combined))) {
    return {
      classification: 'unsubscribe',
      rationale: 'Matched explicit opt-out / unsubscribe language. Immediate suppression required.',
      method: 'deterministic_rules',
    };
  }

  // Priority 2: Meeting interest
  if (MEETING_PATTERNS.some((rx) => rx.test(combined))) {
    return {
      classification: 'meeting_interest',
      rationale: 'Reply expresses interest in scheduling a call, demo, or meeting.',
      method: 'deterministic_rules',
    };
  }

  // Priority 3: Negative / Not interested
  if (NEGATIVE_PATTERNS.some((rx) => rx.test(combined))) {
    return {
      classification: 'negative',
      rationale: 'Reply indicates lack of interest, fit, or current need.',
      method: 'deterministic_rules',
    };
  }

  // Priority 4: Referral to another contact
  if (REFERRAL_PATTERNS.some((rx) => rx.test(combined))) {
    return {
      classification: 'referral',
      rationale: 'Reply redirects or introduces another colleague as the appropriate contact.',
      method: 'deterministic_rules',
    };
  }

  // Priority 5: Information request
  if (INFO_REQUEST_PATTERNS.some((rx) => rx.test(combined))) {
    return {
      classification: 'information_request',
      rationale: 'Reply requests additional details, documentation, or pricing.',
      method: 'deterministic_rules',
    };
  }

  // Priority 6: Positive response
  if (POSITIVE_PATTERNS.some((rx) => rx.test(combined))) {
    return {
      classification: 'positive',
      rationale: 'Reply signals receptive/positive engagement.',
      method: 'deterministic_rules',
    };
  }

  return {
    classification: 'unknown',
    rationale: 'No clear deterministic intent pattern matched; marked unknown for owner judgment.',
    method: 'deterministic_rules',
  };
}

export async function classifyReplyContent(
  body: string,
  subject?: string,
  allowAiRefinement = false
): Promise<ReplyClassificationResult> {
  const det = classifyReplyDeterministic(body, subject);
  if (det.classification !== 'unknown' || !allowAiRefinement) {
    return det;
  }

  const aiRes = await generateStructuredJsonWithAi<{
    classification?: OutreachReplyClassificationV2;
    rationale?: string;
  }>({
    systemInstruction:
      'Classify the B2B reply into exactly one of: positive, negative, meeting_interest, information_request, referral, unsubscribe, unknown. Return JSON {"classification":"...","rationale":"..."}.',
    prompt: `Subject: ${subject || '(none)'}\nBody:\n${body.slice(0, 1500)}`,
    timeoutMs: 10000,
  });

  const allowed = new Set<OutreachReplyClassificationV2>([
    'positive',
    'negative',
    'meeting_interest',
    'information_request',
    'referral',
    'unsubscribe',
    'unknown',
  ]);
  if (aiRes.data?.classification && allowed.has(aiRes.data.classification)) {
    return {
      classification: aiRes.data.classification,
      rationale: (aiRes.data.rationale || 'Classified with AI assistance.').slice(0, 260),
      method: 'ai_assisted',
    };
  }
  return det;
}

function mapClassificationToEnrollmentExit(
  classification: OutreachReplyClassificationV2
): OutreachEnrollmentStatusV2 | null {
  switch (classification) {
    case 'unsubscribe':
      return 'exited_opted_out';
    case 'negative':
      return 'exited_uninterested';
    case 'meeting_interest':
    case 'positive':
    case 'information_request':
    case 'referral':
      return 'exited_replied';
    default:
      return null;
  }
}

export async function recordOutreachReply(
  facade: CrmStorageFacade,
  input: {
    leadId: string;
    personId?: string;
    campaignId?: string;
    enrollmentId?: string;
    messageId?: string;
    senderEmail?: string;
    channel?: OutreachChannelV2;
    subject?: string;
    body: string;
    receivedAt?: string;
    overrideClassification?: OutreachReplyClassificationV2;
    allowAiClassification?: boolean;
    recordedBy: string;
  }
): Promise<{
  reply: OutreachReplyRecord;
  followUp?: OutreachFollowUpItem;
  exitedEnrollmentIds: string[];
  suppressionCreated: boolean;
}> {
  const lead = await facade.getLead(input.leadId);
  if (!lead) {
    throw new Error(`Company/lead "${input.leadId}" not found.`);
  }

  const person = input.personId ? await facade.getPersonById(input.personId) : null;
  const [ws, settings] = await Promise.all([
    getOutreachWorkspaceState(facade),
    facade.getSettings(),
  ]);

  const matchedMessage = input.messageId
    ? ws.messages.find((m) => m.id === input.messageId)
    : undefined;
  const campaignId = input.campaignId || matchedMessage?.campaignId;
  const campaign = campaignId ? ws.campaigns.find((c) => c.id === campaignId) : undefined;
  const channel: OutreachChannelV2 = input.channel || matchedMessage?.channel || campaign?.channel || 'email';

  if (
    input.overrideClassification !== undefined &&
    !OUTREACH_REPLY_CLASSIFICATION_SET.has(input.overrideClassification)
  ) {
    throw new Error(`Invalid reply classification "${String(input.overrideClassification)}".`);
  }

  const autoClassified = await classifyReplyContent(
    input.body,
    input.subject,
    Boolean(input.allowAiClassification)
  );
  const classification: OutreachReplyClassificationV2 =
    input.overrideClassification || autoClassified.classification;
  const classificationRationale = input.overrideClassification
    ? `Owner-selected classification (${input.overrideClassification}). Auto-analysis: ${autoClassified.rationale}`
    : autoClassified.rationale;

  const nowIso = new Date().toISOString();
  const receivedAt = input.receivedAt && !Number.isNaN(new Date(input.receivedAt).getTime())
    ? new Date(input.receivedAt).toISOString()
    : nowIso;

  // Deduplicated CRM Interaction recording
  const interactionSummary = `Outreach reply (${classification})${
    campaign ? ` — ${campaign.name}` : ''
  }${input.subject ? `: ${input.subject.slice(0, 90)}` : ''}`;

  const existingLeadInteractions = getEntityInteractions(lead.customFields);
  const duplicateInteraction = existingLeadInteractions.find(
    (it) =>
      it.summary === interactionSummary &&
      it.detailedNotes?.trim() === input.body.trim().slice(0, 10000) &&
      Math.abs(new Date(it.occurredAt).getTime() - new Date(receivedAt).getTime()) < 60_000
  );

  let crmInteractionId = duplicateInteraction?.id;
  if (!crmInteractionId) {
    const createdInteraction = await createCrmInteraction(facade, {
      leadId: lead.id,
      personId: person?.id,
      type: channel === 'email' ? 'email' : channel === 'linkedin' ? 'linkedin' : 'note',
      occurredAt: receivedAt,
      summary: interactionSummary,
      detailedNotes: input.body.trim(),
      outcome: `Reply classified as ${classification}`,
      nextAction:
        classification === 'unsubscribe'
          ? 'Opt-out honored; do not contact.'
          : classification === 'meeting_interest'
          ? 'Propose meeting times and prepare AI Meeting Brief.'
          : classification === 'negative'
          ? 'Close sequence; no further unsolicited follow-ups.'
          : 'Review reply and respond.',
      recordedBy: input.recordedBy,
    });
    crmInteractionId = createdInteraction.id;
  }

  // Exit active matching enrollments & cancel pending no_response follow-ups
  const exitStatus = mapClassificationToEnrollmentExit(classification);
  const exitedEnrollmentIds: string[] = [];
  for (const enr of ws.enrollments) {
    const matchesTarget =
      (input.enrollmentId && enr.id === input.enrollmentId) ||
      (enr.leadId === lead.id &&
        (!campaignId || enr.campaignId === campaignId) &&
        (!person?.id || !enr.personId || enr.personId === person.id));

    if (!matchesTarget) continue;
    if (enr.status === 'active' || enr.status === 'paused') {
      if (exitStatus) {
        enr.status = exitStatus;
        enr.exitReason = `Reply recorded (${classification}): ${classificationRationale}`;
        enr.nextScheduledAt = undefined;
        enr.updatedAt = nowIso;
        exitedEnrollmentIds.push(enr.id);
        cancelPendingFollowUpsForEnrollment(
          ws,
          enr.id,
          classification === 'unsubscribe' ? 'suppressed' : 'cancelled'
        );
      }
    }
  }

  // On unsubscribe: immediately create global suppression, cancel all pending follow-ups, mark lead do_not_contact
  let suppressionCreated = false;
  if (classification === 'unsubscribe') {
    const targetEmail = (input.senderEmail || person?.email || lead.email || '').trim().toLowerCase() || undefined;
    const alreadySuppressed = ws.suppressions.some(
      (s) =>
        s.active &&
        s.scope === 'global' &&
        s.type === 'unsubscribe' &&
        ((targetEmail && s.email === targetEmail) || (s.leadId === lead.id && s.personId === person?.id))
    );
    if (!alreadySuppressed) {
      const supp = createSuppressionRecord({
        scope: 'global',
        type: 'unsubscribe',
        email: targetEmail,
        leadId: lead.id,
        personId: person?.id,
        companyName: lead.companyName,
        personName: person?.fullName,
        reason: `Automatic global opt-out triggered by recorded unsubscribe reply (${receivedAt.slice(0, 10)}).`,
        createdBy: input.recordedBy,
      });
      ws.suppressions = [supp, ...ws.suppressions];
      suppressionCreated = true;
    }

    // Cancel ALL scheduled follow-ups and pending drafts for this lead/person
    for (const f of ws.followUps) {
      if (
        (f.status === 'scheduled' || f.status === 'pending_approval') &&
        f.leadId === lead.id &&
        (!person?.id || !f.personId || f.personId === person.id)
      ) {
        f.status = 'suppressed';
        f.updatedAt = nowIso;
      }
    }
    for (const msg of ws.messages) {
      if (
        (msg.status === 'draft' || msg.status === 'pending_approval' || msg.status === 'approved') &&
        msg.leadId === lead.id &&
        (!person?.id || !msg.personId || msg.personId === person.id)
      ) {
        msg.status = 'cancelled';
        msg.cancelledAt = nowIso;
        msg.cancelledBy = input.recordedBy;
        msg.updatedAt = nowIso;
      }
    }

    // Update CRM lead status conservatively if company-wide or no distinct person
    if (!person?.id || lead.email?.toLowerCase() === targetEmail) {
      const freshLead = await facade.getLead(lead.id);
      if (freshLead && freshLead.status !== 'do_not_contact') {
        await facade.upsertLead({
          ...freshLead,
          status: 'do_not_contact',
          updatedAt: nowIso,
        });
      }
    }
  } else if (classification === 'negative') {
    // Schedule opt-out/uninterested sweep so no further nudges fire
    scheduleContextualFollowUp({
      ws,
      settings,
      lead,
      person,
      campaign,
      triggerType: 'contact_uninterested',
    });
  }

  // Schedule positive / meeting / info follow-up for owner review
  let scheduledFollowUp: OutreachFollowUpItem | undefined;
  if (classification === 'meeting_interest') {
    const res = scheduleContextualFollowUp({
      ws,
      settings,
      lead,
      person,
      campaign,
      triggerType: 'meeting_requested',
      delayDays: 0,
      customExplanation: 'Contact requested or showed interest in a meeting. Respond promptly with availability.',
    });
    scheduledFollowUp = res.item;
  } else if (
    classification === 'positive' ||
    classification === 'information_request' ||
    classification === 'referral'
  ) {
    const res = scheduleContextualFollowUp({
      ws,
      settings,
      lead,
      person,
      campaign,
      triggerType: 'response_received',
      delayDays: 1,
      customExplanation: `Inbound reply recorded (${classification}). Review and send an owner-approved response.`,
    });
    scheduledFollowUp = res.item;
  }

  const reply: OutreachReplyRecord = {
    id: generateOutreachId('orep'),
    campaignId: campaign?.id,
    campaignName: campaign?.name,
    enrollmentId: input.enrollmentId || exitedEnrollmentIds[0],
    messageId: matchedMessage?.id,
    leadId: lead.id,
    companyName: lead.companyName,
    personId: person?.id,
    personName: person?.fullName,
    senderEmail: input.senderEmail?.trim().toLowerCase() || person?.email || lead.email,
    channel,
    subject: input.subject?.trim().slice(0, 220) || undefined,
    body: input.body.trim().slice(0, 10000),
    source: 'manual_owner_recorded',
    classification,
    classificationRationale,
    receivedAt,
    recordedAt: nowIso,
    recordedBy: input.recordedBy,
    crmInteractionId,
    triggeredExit: exitedEnrollmentIds.length > 0,
    triggeredSuppression: suppressionCreated,
  };

  ws.replies = [reply, ...ws.replies];
  appendOutreachAudit(ws, {
    actor: input.recordedBy,
    action: 'reply_recorded',
    entityType: 'reply',
    entityId: reply.id,
    summary: `Recorded manual reply from ${lead.companyName} (${classification})${
      suppressionCreated ? ' — global opt-out suppression activated' : ''
    }.`,
    metadata: {
      leadId: lead.id,
      personId: person?.id,
      classification,
      exitedEnrollmentIds,
      suppressionCreated,
    },
  });

  await saveOutreachWorkspaceState(facade, ws);
  return {
    reply,
    followUp: scheduledFollowUp,
    exitedEnrollmentIds,
    suppressionCreated,
  };
}
