// Phase 13: In-App Relationship Reminder Centre Engine
// Computes reminders live on demand from real tasks, interaction follow-ups,
// upcoming meetings, relationship review dates, and neglected active relationships.
// Explicitly discloses that no background cron/push/email scheduler daemon is configured.

import type {
  CrmReminderCenterResponse,
  CrmReminderItem,
} from '../types.js';
import {
  CrmStorageFacade,
  getEntityInteractions,
  getEntityRelationshipMeta,
  listAllCrmInteractions,
  listAllExtendedTasks,
} from './crmStoreHelper.js';

const DAY_MS = 86_400_000;

export function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function isSameCalendarDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCFullYear() === ref.getUTCFullYear() &&
    d.getUTCMonth() === ref.getUTCMonth() &&
    d.getUTCDate() === ref.getUTCDate()
  );
}

export async function buildReminderCenter(
  facade: CrmStorageFacade,
  now: Date = new Date()
): Promise<CrmReminderCenterResponse> {
  const [leads, persons, tasks, interactions] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    listAllExtendedTasks(facade),
    listAllCrmInteractions(facade),
  ]);

  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const personMap = new Map(persons.map((p) => [p.id, p]));

  const nowMs = now.getTime();
  const todayStartMs = startOfUtcDay(now);
  const tomorrowStartMs = todayStartMs + DAY_MS;
  const sevenDaysAheadMs = nowMs + 7 * DAY_MS;

  const reminders: CrmReminderItem[] = [];
  let overdueTasks = 0;
  let todayFollowUps = 0;
  let upcomingMeetings = 0;
  let relationshipReviews = 0;
  let needsAttention = 0;

  // 1. Task-based reminders (overdue, due today, upcoming meetings/tasks)
  for (const task of tasks) {
    if (task.completed || task.status === 'completed' || task.status === 'cancelled') continue;
    const dueMs = new Date(task.dueDate).getTime();
    if (Number.isNaN(dueMs)) continue;

    const lead = task.leadId ? leadMap.get(task.leadId) : undefined;
    const person = task.personId ? personMap.get(task.personId) : undefined;
    const isMeeting = task.category === 'meeting';

    if (dueMs < todayStartMs) {
      overdueTasks++;
      const daysOverdue = Math.max(1, Math.floor((todayStartMs - dueMs) / DAY_MS));
      reminders.push({
        id: `rem-task-overdue-${task.id}`,
        kind: 'overdue_task',
        severity: task.priority === 'high' || daysOverdue >= 3 ? 'urgent' : 'high',
        title: `Overdue: ${task.title}`,
        detail: `${daysOverdue} day(s) overdue · Priority: ${task.priority}${lead ? ` · ${lead.companyName}` : ''}`,
        dueAt: task.dueDate,
        leadId: task.leadId || undefined,
        companyName: lead?.companyName,
        personId: task.personId,
        personName: person?.fullName,
        taskId: task.id,
        opportunityId: task.opportunityId,
      });
    } else if (dueMs >= todayStartMs && dueMs < tomorrowStartMs) {
      todayFollowUps++;
      if (isMeeting) upcomingMeetings++;
      reminders.push({
        id: `rem-task-today-${task.id}`,
        kind: isMeeting ? 'upcoming_meeting' : 'today_task',
        severity: task.priority === 'high' ? 'high' : 'medium',
        title: `${isMeeting ? 'Meeting Today' : 'Due Today'}: ${task.title}`,
        detail: `Scheduled for today · Priority: ${task.priority}${lead ? ` · ${lead.companyName}` : ''}`,
        dueAt: task.dueDate,
        leadId: task.leadId || undefined,
        companyName: lead?.companyName,
        personId: task.personId,
        personName: person?.fullName,
        taskId: task.id,
        opportunityId: task.opportunityId,
      });
    } else if (dueMs <= sevenDaysAheadMs) {
      if (isMeeting) {
        upcomingMeetings++;
        reminders.push({
          id: `rem-task-meeting-${task.id}`,
          kind: 'upcoming_meeting',
          severity: 'medium',
          title: `Upcoming Meeting: ${task.title}`,
          detail: `Scheduled on ${new Date(task.dueDate).toLocaleDateString()}${lead ? ` · ${lead.companyName}` : ''}`,
          dueAt: task.dueDate,
          leadId: task.leadId || undefined,
          companyName: lead?.companyName,
          personId: task.personId,
          personName: person?.fullName,
          taskId: task.id,
          opportunityId: task.opportunityId,
        });
      } else if (task.reminderDate && new Date(task.reminderDate).getTime() <= nowMs) {
        reminders.push({
          id: `rem-task-upcoming-${task.id}`,
          kind: 'upcoming_task',
          severity: 'info',
          title: `Reminder: ${task.title}`,
          detail: `Due ${new Date(task.dueDate).toLocaleDateString()}${lead ? ` · ${lead.companyName}` : ''}`,
          dueAt: task.dueDate,
          leadId: task.leadId || undefined,
          companyName: lead?.companyName,
          personId: task.personId,
          personName: person?.fullName,
          taskId: task.id,
          opportunityId: task.opportunityId,
        });
      }
    }
  }

  // 2. Interaction follow-up dates & future scheduled meetings logged manually
  for (const interaction of interactions) {
    const lead = interaction.leadId ? leadMap.get(interaction.leadId) : undefined;
    const person = interaction.personId ? personMap.get(interaction.personId) : undefined;

    if (
      (interaction.type === 'meeting' || interaction.type === 'video_meeting') &&
      new Date(interaction.occurredAt).getTime() >= todayStartMs &&
      new Date(interaction.occurredAt).getTime() <= sevenDaysAheadMs
    ) {
      upcomingMeetings++;
      reminders.push({
        id: `rem-int-meeting-${interaction.id}`,
        kind: 'upcoming_meeting',
        severity: isSameCalendarDay(interaction.occurredAt, now) ? 'high' : 'medium',
        title: `Logged Meeting: ${interaction.summary}`,
        detail: `${new Date(interaction.occurredAt).toLocaleString()}${lead ? ` · ${lead.companyName}` : ''}${
          person ? ` · ${person.fullName}` : ''
        }`,
        dueAt: interaction.occurredAt,
        leadId: interaction.leadId,
        companyName: lead?.companyName,
        personId: interaction.personId,
        personName: person?.fullName,
        interactionId: interaction.id,
      });
    }

    if (interaction.followUpDate) {
      const fMs = new Date(interaction.followUpDate).getTime();
      if (!Number.isNaN(fMs) && fMs <= sevenDaysAheadMs) {
        const isPast = fMs < todayStartMs;
        const isToday = fMs >= todayStartMs && fMs < tomorrowStartMs;
        if (isToday) todayFollowUps++;
        reminders.push({
          id: `rem-int-fu-${interaction.id}`,
          kind: 'interaction_follow_up',
          severity: isPast ? 'urgent' : isToday ? 'high' : 'medium',
          title: `${isPast ? 'Overdue Follow-Up' : isToday ? 'Follow-Up Today' : 'Upcoming Follow-Up'}: ${
            interaction.nextAction || interaction.summary
          }`,
          detail: `From ${interaction.type.replace(/_/g, ' ')} on ${new Date(interaction.occurredAt).toLocaleDateString()}${
            lead ? ` · ${lead.companyName}` : ''
          }`,
          dueAt: interaction.followUpDate,
          leadId: interaction.leadId,
          companyName: lead?.companyName,
          personId: interaction.personId,
          personName: person?.fullName,
          interactionId: interaction.id,
        });
      }
    }
  }

  // 3. Scheduled Relationship Reviews & Active Relationships Needing Attention (> 30 days no contact)
  for (const lead of leads) {
    const meta = getEntityRelationshipMeta(lead.customFields, lead.tags);
    const leadInts = getEntityInteractions(lead.customFields);
    const latestIntMs = leadInts.length
      ? Math.max(...leadInts.map((i) => new Date(i.occurredAt).getTime()))
      : null;

    if (meta.scheduledReviewDate) {
      const revMs = new Date(meta.scheduledReviewDate).getTime();
      if (!Number.isNaN(revMs) && revMs <= sevenDaysAheadMs) {
        relationshipReviews++;
        reminders.push({
          id: `rem-review-lead-${lead.id}`,
          kind: 'relationship_review',
          severity: revMs < todayStartMs ? 'high' : 'medium',
          title: `Relationship Review: ${lead.companyName}`,
          detail: `Scheduled review date: ${new Date(meta.scheduledReviewDate).toLocaleDateString()}`,
          dueAt: meta.scheduledReviewDate,
          leadId: lead.id,
          companyName: lead.companyName,
        });
      }
    }

    if (meta.relationshipStatus === 'needs_attention') {
      needsAttention++;
      reminders.push({
        id: `rem-attn-lead-${lead.id}`,
        kind: 'needs_attention',
        severity: 'high',
        title: `Needs Attention: ${lead.companyName}`,
        detail: `Marked as Needs Attention${
          latestIntMs !== null
            ? ` · Last interaction ${Math.floor((nowMs - latestIntMs) / DAY_MS)}d ago`
            : ' · No interactions logged yet'
        }`,
        leadId: lead.id,
        companyName: lead.companyName,
      });
    } else if (
      (meta.relationshipStatus === 'active' || meta.relationshipStatus === 'warm') &&
      latestIntMs !== null &&
      nowMs - latestIntMs > 30 * DAY_MS
    ) {
      needsAttention++;
      const daysAgo = Math.floor((nowMs - latestIntMs) / DAY_MS);
      reminders.push({
        id: `rem-stale-lead-${lead.id}`,
        kind: 'needs_attention',
        severity: 'medium',
        title: `Cooling Relationship: ${lead.companyName}`,
        detail: `${meta.relationshipStatus} relationship has had no logged interaction for ${daysAgo} days`,
        leadId: lead.id,
        companyName: lead.companyName,
      });
    }
  }

  for (const person of persons) {
    const meta = getEntityRelationshipMeta(person.customFields);
    if (meta.scheduledReviewDate) {
      const revMs = new Date(meta.scheduledReviewDate).getTime();
      if (!Number.isNaN(revMs) && revMs <= sevenDaysAheadMs) {
        relationshipReviews++;
        reminders.push({
          id: `rem-review-person-${person.id}`,
          kind: 'relationship_review',
          severity: revMs < todayStartMs ? 'high' : 'medium',
          title: `Contact Review: ${person.fullName}`,
          detail: `Scheduled check-in date: ${new Date(meta.scheduledReviewDate).toLocaleDateString()}`,
          dueAt: meta.scheduledReviewDate,
          personId: person.id,
          personName: person.fullName,
        });
      }
    }
    if (meta.relationshipStatus === 'needs_attention') {
      needsAttention++;
      reminders.push({
        id: `rem-attn-person-${person.id}`,
        kind: 'needs_attention',
        severity: 'high',
        title: `Contact Needs Attention: ${person.fullName}`,
        detail: `${person.decisionMakingFunction || person.seniority || 'Decision-Maker'} flagged as Needs Attention`,
        personId: person.id,
        personName: person.fullName,
      });
    }
  }

  const severityOrder: Record<CrmReminderItem['severity'], number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    info: 3,
  };
  reminders.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    const aMs = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bMs = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aMs - bMs;
  });

  return {
    generatedAt: now.toISOString(),
    counts: {
      total: reminders.length,
      overdueTasks,
      todayFollowUps,
      upcomingMeetings,
      relationshipReviews,
      needsAttention,
    },
    reminders,
    schedulerStatus: {
      backgroundDaemonActive: false,
      automatedNotificationsConfigured: false,
      deliveryMode: 'in_app_on_demand',
      honestNote:
        'Reminders are computed live in-app from your CRM tasks, interactions, and follow-up dates whenever you open LEED. No background cron daemon, email pusher, or mobile push notification service is configured.',
    },
  };
}
