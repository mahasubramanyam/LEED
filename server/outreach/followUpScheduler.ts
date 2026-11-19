// Phase 15: Follow-Up Automation & Business-Day Scheduling Engine
// Handles all 10 follow-up triggers with timezone & business-day adjustment,
// suppression/opt-out/frequency/CRM checks, and transparent explanations for every scheduled follow-up.

import { COUNTRY_DEFAULT_TIMEZONE } from '../../shared/outreachSpecs.js';
import type {
  AppSettings,
  CanonicalLead,
  OutreachCampaignV2,
  OutreachEnrollment,
  OutreachFollowUpItem,
  OutreachFollowUpTriggerV2,
  OutreachSequence,
  OutreachWorkspaceState,
  PersonRecord,
} from '../types.js';
import { getEntityRelationshipMeta } from '../crm/crmStoreHelper.js';
import { generateOutreachId } from './outreachStoreHelper.js';
import { checkContactFrequencyLimits, checkSuppressionStatus } from './suppressionCompliance.js';

export function resolveRecipientTimezone(
  explicitTimezone?: string,
  countryCode?: string
): string | undefined {
  if (explicitTimezone && explicitTimezone.trim()) return explicitTimezone.trim();
  if (!countryCode) return undefined;
  return COUNTRY_DEFAULT_TIMEZONE[countryCode.trim().toUpperCase()];
}

function isValidIanaTimezone(tz?: string): tz is string {
  if (!tz || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function getZonedDateParts(
  date: Date,
  timeZone: string
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value || '0');
  const rawHour = pick('hour');
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: pick('minute'),
    second: pick('second'),
  };
}

/**
 * Converts a recipient-local wall-clock date/time (year, month, day, hour, minute) in an IANA
 * timezone to the exact UTC instant, handling DST transitions via two-pass offset convergence.
 */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const wallAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (timeZone === 'UTC') {
    return new Date(wallAsUtcMs);
  }

  const offsetAt = (instantMs: number): number => {
    const p = getZonedDateParts(new Date(instantMs), timeZone);
    const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    return localAsUtc - instantMs;
  };

  // Pass 1: estimate UTC instant from offset at naive guess
  const firstGuessUtcMs = wallAsUtcMs - offsetAt(wallAsUtcMs);
  // Pass 2: re-evaluate offset at refined UTC instant (converges accurately across DST boundaries)
  const refinedUtcMs = wallAsUtcMs - offsetAt(firstGuessUtcMs);
  return new Date(refinedUtcMs);
}

/**
 * Computes a follow-up timestamp respecting delayDays, businessDaysOnly (skip Sat/Sun in
 * recipient-local calendar), and sendWindowStartHour interpreted in the recipient's resolved
 * IANA timezone (with DST support). Falls back to UTC only when no valid timezone is available.
 */
export function computeBusinessAwareScheduleDate(params: {
  baseDate?: Date;
  delayDays: number;
  businessDaysOnly: boolean;
  sendWindowStartHour?: number;
  recipientTimezone?: string;
}): {
  scheduledFor: string;
  businessDayAdjusted: boolean;
  resolvedTimezone: string;
  localScheduledSummary: string;
} {
  const base = params.baseDate ? new Date(params.baseDate.getTime()) : new Date();
  const resolvedTimezone = isValidIanaTimezone(params.recipientTimezone)
    ? params.recipientTimezone.trim()
    : 'UTC';
  const days = Math.max(0, Math.round(params.delayDays));
  let businessDayAdjusted = false;

  // Start from the recipient's local calendar date (using noon UTC cursor for DST-free date stepping)
  const baseLocal = getZonedDateParts(base, resolvedTimezone);
  const calendarCursor = new Date(Date.UTC(baseLocal.year, baseLocal.month - 1, baseLocal.day, 12, 0, 0, 0));

  if (params.businessDaysOnly && days > 0) {
    let added = 0;
    while (added < days) {
      calendarCursor.setUTCDate(calendarCursor.getUTCDate() + 1);
      const dow = calendarCursor.getUTCDay();
      if (dow === 0 || dow === 6) {
        businessDayAdjusted = true;
      } else {
        added++;
      }
    }
  } else {
    calendarCursor.setUTCDate(calendarCursor.getUTCDate() + days);
    if (params.businessDaysOnly) {
      const dow = calendarCursor.getUTCDay();
      if (dow === 6) {
        calendarCursor.setUTCDate(calendarCursor.getUTCDate() + 2);
        businessDayAdjusted = true;
      } else if (dow === 0) {
        calendarCursor.setUTCDate(calendarCursor.getUTCDate() + 1);
        businessDayAdjusted = true;
      }
    }
  }

  const hour =
    params.sendWindowStartHour !== undefined && Number.isFinite(params.sendWindowStartHour)
      ? Math.min(20, Math.max(7, Math.round(params.sendWindowStartHour)))
      : 9;

  const targetYear = calendarCursor.getUTCFullYear();
  const targetMonth = calendarCursor.getUTCMonth() + 1;
  const targetDay = calendarCursor.getUTCDate();
  const scheduledDate = zonedWallTimeToUtc(targetYear, targetMonth, targetDay, hour, 0, resolvedTimezone);

  const pad = (n: number) => String(n).padStart(2, '0');
  const localScheduledSummary = `${targetYear}-${pad(targetMonth)}-${pad(targetDay)} ${pad(hour)}:00 (${resolvedTimezone})`;

  return {
    scheduledFor: scheduledDate.toISOString(),
    businessDayAdjusted,
    resolvedTimezone,
    localScheduledSummary,
  };
}

const EXIT_TRIGGERS = new Set<OutreachFollowUpTriggerV2>([
  'contact_uninterested',
  'opt_out',
  'meeting_scheduled',
  'opportunity_created',
]);

export function scheduleContextualFollowUp(params: {
  ws: OutreachWorkspaceState;
  settings: AppSettings;
  lead: CanonicalLead;
  person?: PersonRecord | null;
  campaign?: OutreachCampaignV2;
  sequence?: OutreachSequence;
  enrollment?: OutreachEnrollment;
  messageId?: string;
  stepNumber?: number;
  triggerType: OutreachFollowUpTriggerV2;
  delayDays?: number;
  businessDaysOnly?: boolean;
  customExplanation?: string;
  recommendedAction?: string;
  now?: Date;
}): {
  scheduled: boolean;
  item?: OutreachFollowUpItem;
  skippedReason?: string;
} {
  const { ws, settings, lead, person, campaign, sequence, enrollment, triggerType } = params;
  const now = params.now || new Date();
  const nowIso = now.toISOString();

  // Exit / terminal triggers cancel pending sequence follow-ups instead of queuing new outbound nudges
  if (triggerType === 'opt_out' || triggerType === 'contact_uninterested') {
    for (const f of ws.followUps) {
      if (
        f.status === 'scheduled' &&
        f.leadId === lead.id &&
        (!person?.id || !f.personId || f.personId === person.id)
      ) {
        f.status = triggerType === 'opt_out' ? 'suppressed' : 'cancelled';
        f.updatedAt = nowIso;
      }
    }
    return {
      scheduled: false,
      skippedReason:
        triggerType === 'opt_out'
          ? 'Opt-out recorded: all pending follow-ups suppressed immediately.'
          : 'Contact marked uninterested: all pending sequence follow-ups cancelled.',
    };
  }

  // Check suppression & CRM relationship status before scheduling
  const suppression = checkSuppressionStatus({
    ws,
    settings,
    lead,
    person,
    recipientEmail: enrollment?.recipientEmail || person?.email || lead.email,
    campaignId: campaign?.id,
  });
  if (suppression.suppressed) {
    return {
      scheduled: false,
      skippedReason: `Follow-up blocked by suppression: ${suppression.reasons.join(' ')}`,
    };
  }

  const relMeta = getEntityRelationshipMeta(lead.customFields, lead.tags);
  if (relMeta.relationshipStatus === 'archived' || lead.status === 'lost' || lead.status === 'do_not_contact') {
    return {
      scheduled: false,
      skippedReason: `Follow-up skipped because company CRM status is "${lead.status}" / relationship "${relMeta.relationshipStatus}".`,
    };
  }

  // Enforce campaign/sequence max follow-up limits on no_response sequence nudges
  if (triggerType === 'no_response') {
    const maxFollowUps = sequence?.maxFollowUps ?? campaign?.maxFollowUps ?? 3;
    const sentFollowUps = enrollment ? Math.max(0, enrollment.messagesSentCount - 1) : 0;
    if (sentFollowUps >= maxFollowUps) {
      return {
        scheduled: false,
        skippedReason: `Sequence follow-up limit reached (${sentFollowUps}/${maxFollowUps}).`,
      };
    }

    const freq = checkContactFrequencyLimits({
      ws,
      leadId: lead.id,
      personId: person?.id,
      now,
    });
    if (freq.exceeded) {
      return {
        scheduled: false,
        skippedReason: `Follow-up deferred by contact frequency guardrail: ${freq.reasons.join(' ')}`,
      };
    }
  }

  const defaultDelays: Record<OutreachFollowUpTriggerV2, number> = {
    no_response: 3,
    response_received: 1,
    meeting_requested: 1,
    meeting_scheduled: 1,
    opportunity_created: 2,
    contact_uninterested: 0,
    opt_out: 0,
    failed_delivery: 1,
    owner_requested: 2,
    overdue_follow_up: 0,
  };

  const delayDays = params.delayDays !== undefined ? params.delayDays : defaultDelays[triggerType];
  const businessDaysOnly =
    params.businessDaysOnly !== undefined
      ? params.businessDaysOnly
      : sequence?.businessDaysOnly ?? ws.complianceConfig.businessDaysOnlyDefault;

  const recipientTimezone = resolveRecipientTimezone(
    enrollment?.recipientTimezone,
    person?.countryCode || lead.address?.countryCode
  );

  const sched = computeBusinessAwareScheduleDate({
    baseDate: now,
    delayDays,
    businessDaysOnly,
    sendWindowStartHour: ws.complianceConfig.sendWindowStartHour,
    recipientTimezone,
  });

  const defaultExplanations: Record<OutreachFollowUpTriggerV2, string> = {
    no_response: `Scheduled Step ${params.stepNumber ?? ((enrollment?.currentStepNumber || 1) + 1)} follow-up after ${delayDays} ${businessDaysOnly ? 'business ' : ''}day(s) with no recorded reply — scheduled for ${sched.localScheduledSummary}.`,
    response_received: `Inbound reply recorded; follow-up queued for owner review at ${sched.localScheduledSummary}.`,
    meeting_requested: `Contact expressed meeting interest; priority follow-up scheduled for ${sched.localScheduledSummary} to propose time slots.`,
    meeting_scheduled: `Meeting scheduled; pre-meeting preparation and confirmation reminder queued for ${sched.localScheduledSummary}.`,
    opportunity_created: `Opportunity created from outreach; commercial follow-up scheduled for ${sched.localScheduledSummary} to advance pipeline stage.`,
    contact_uninterested: 'Contact marked uninterested.',
    opt_out: 'Opt-out honored.',
    failed_delivery: `Previous delivery attempt failed; owner review queued for ${sched.localScheduledSummary} to verify recipient address or retry.`,
    owner_requested: `Explicitly scheduled by owner for relationship follow-up at ${sched.localScheduledSummary}.`,
    overdue_follow_up: `Existing follow-up passed its scheduled date without completion; review queued for ${sched.localScheduledSummary}.`,
  };

  const defaultActions: Record<OutreachFollowUpTriggerV2, string> = {
    no_response: 'Generate and approve next sequence follow-up draft before sending.',
    response_received: 'Review recorded reply and draft an owner-approved response.',
    meeting_requested: 'Send calendar availability and generate an AI Meeting Prep Brief.',
    meeting_scheduled: 'Run Meeting Preparation Brief in AI Sales Agent and confirm agenda.',
    opportunity_created: 'Review opportunity scope and prepare next commercial milestone.',
    contact_uninterested: 'No further outreach.',
    opt_out: 'No further outreach.',
    failed_delivery: 'Inspect bounce/failure reason and verify email via Phase 12 Enrichment.',
    owner_requested: 'Review relationship timeline and execute planned outreach step.',
    overdue_follow_up: 'Complete, reschedule, or cancel overdue follow-up.',
  };

  // Prevent duplicate identical active scheduled follow-ups for same enrollment + trigger + step
  const duplicate = ws.followUps.find(
    (f) =>
      f.status === 'scheduled' &&
      f.leadId === lead.id &&
      f.triggerType === triggerType &&
      f.enrollmentId === enrollment?.id &&
      f.stepNumber === params.stepNumber
  );
  if (duplicate) {
    return {
      scheduled: false,
      item: duplicate,
      skippedReason: 'An active scheduled follow-up already exists for this step and trigger.',
    };
  }

  // If terminal commercial progress happened (meeting_scheduled / opportunity_created), cancel earlier no_response nudges
  if (EXIT_TRIGGERS.has(triggerType)) {
    for (const f of ws.followUps) {
      if (f.status === 'scheduled' && f.triggerType === 'no_response' && f.leadId === lead.id) {
        f.status = 'cancelled';
        f.updatedAt = nowIso;
      }
    }
  }

  const item: OutreachFollowUpItem = {
    id: generateOutreachId('ofup'),
    campaignId: campaign?.id,
    campaignName: campaign?.name,
    enrollmentId: enrollment?.id,
    leadId: lead.id,
    companyName: lead.companyName,
    personId: person?.id,
    personName: person?.fullName,
    messageId: params.messageId,
    stepNumber: params.stepNumber,
    triggerType,
    status: 'scheduled',
    scheduledFor: sched.scheduledFor,
    businessDayAdjusted: sched.businessDayAdjusted,
    recipientTimezone: recipientTimezone || sched.resolvedTimezone,
    explanation:
      params.customExplanation?.trim() ||
      `${defaultExplanations[triggerType]}${sched.businessDayAdjusted ? ' (Weekend skipped per business-day policy.)' : ''}`,
    recommendedAction: params.recommendedAction?.trim() || defaultActions[triggerType],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  ws.followUps = [item, ...ws.followUps];
  return { scheduled: true, item };
}

export function cancelPendingFollowUpsForEnrollment(
  ws: OutreachWorkspaceState,
  enrollmentId: string,
  reasonStatus: 'cancelled' | 'suppressed' = 'cancelled'
): number {
  let count = 0;
  const nowIso = new Date().toISOString();
  for (const f of ws.followUps) {
    if (f.enrollmentId === enrollmentId && (f.status === 'scheduled' || f.status === 'pending_approval')) {
      f.status = reasonStatus;
      f.updatedAt = nowIso;
      count++;
    }
  }
  return count;
}

export function evaluateOverdueFollowUps(ws: OutreachWorkspaceState, now = new Date()): {
  overdueItems: OutreachFollowUpItem[];
  suppressedDuringSweep: number;
} {
  const nowMs = now.getTime();
  const overdueItems: OutreachFollowUpItem[] = [];
  let suppressedDuringSweep = 0;

  for (const item of ws.followUps) {
    if (item.status !== 'scheduled' && item.status !== 'pending_approval') continue;
    const dueMs = new Date(item.scheduledFor).getTime();
    if (Number.isFinite(dueMs) && dueMs < nowMs) {
      overdueItems.push(item);
    }
  }

  return { overdueItems, suppressedDuringSweep };
}
