// Phase 13: Personal CRM Dashboard Intelligence Service
// Computes every metric strictly from real CRM records (zero fabricated stats).

import type { CrmDashboardSummary } from '../types.js';
import {
  CrmStorageFacade,
  getEntityInteractions,
  getEntityRelationshipMeta,
  listAllCrmInteractions,
  listAllCrmOpportunities,
  listAllExtendedTasks,
} from './crmStoreHelper.js';
import { buildReminderCenter, startOfUtcDay } from './reminderEngine.js';

const DAY_MS = 86_400_000;

export async function buildCrmDashboardSummary(
  facade: CrmStorageFacade,
  now: Date = new Date()
): Promise<CrmDashboardSummary> {
  const [leads, persons, relationships, stages, tasks, interactions, opportunities, reminderCenter] =
    await Promise.all([
      facade.getLeads(),
      facade.getPersons(),
      facade.getCompanyPersonRelationships(),
      facade.getStages(),
      listAllExtendedTasks(facade),
      listAllCrmInteractions(facade),
      listAllCrmOpportunities(facade),
      buildReminderCenter(facade, now),
    ]);

  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const personMap = new Map(persons.map((p) => [p.id, p]));
  const nowMs = now.getTime();
  const thirtyDaysAgoMs = nowMs - 30 * DAY_MS;
  const todayStartMs = startOfUtcDay(now);
  const tomorrowStartMs = todayStartMs + DAY_MS;
  const sevenDaysAheadMs = nowMs + 7 * DAY_MS;

  // Active & new relationships
  let activeRelationships = 0;
  let newRelationships30d = 0;
  for (const lead of leads) {
    const meta = getEntityRelationshipMeta(lead.customFields, lead.tags);
    const leadInts = getEntityInteractions(lead.customFields);
    if (
      meta.relationshipStatus === 'active' ||
      meta.relationshipStatus === 'warm' ||
      meta.relationshipStatus === 'nurturing' ||
      leadInts.some((i) => new Date(i.occurredAt).getTime() >= thirtyDaysAgoMs)
    ) {
      activeRelationships++;
    }
    if (new Date(lead.createdAt).getTime() >= thirtyDaysAgoMs) {
      newRelationships30d++;
    }
  }

  const recentInteractions30d = interactions.filter(
    (i) => new Date(i.occurredAt).getTime() >= thirtyDaysAgoMs
  ).length;

  const openTasks = tasks.filter(
    (t) => !t.completed && t.status !== 'completed' && t.status !== 'cancelled'
  );
  const overdueFollowUpTasks = openTasks
    .filter((t) => new Date(t.dueDate).getTime() < todayStartMs)
    .map((t) => ({
      ...t,
      companyName: t.leadId ? leadMap.get(t.leadId)?.companyName : undefined,
      personName: t.personId ? personMap.get(t.personId)?.fullName : undefined,
    }));

  const todaysFollowUpTasks = openTasks
    .filter((t) => {
      const ms = new Date(t.dueDate).getTime();
      return ms >= todayStartMs && ms < tomorrowStartMs;
    })
    .map((t) => ({
      ...t,
      companyName: t.leadId ? leadMap.get(t.leadId)?.companyName : undefined,
      personName: t.personId ? personMap.get(t.personId)?.fullName : undefined,
    }));

  // Upcoming meetings in next 7 days (from meeting tasks + future meeting interactions)
  const upcomingMeetings: CrmDashboardSummary['upcomingMeetings'] = [];
  for (const t of openTasks) {
    const ms = new Date(t.dueDate).getTime();
    if (t.category === 'meeting' && ms >= todayStartMs && ms <= sevenDaysAheadMs) {
      upcomingMeetings.push({
        id: t.id,
        source: 'task',
        title: t.title,
        scheduledAt: t.dueDate,
        leadId: t.leadId || undefined,
        companyName: t.leadId ? leadMap.get(t.leadId)?.companyName : undefined,
        personId: t.personId,
        personName: t.personId ? personMap.get(t.personId)?.fullName : undefined,
      });
    }
  }
  for (const i of interactions) {
    const ms = new Date(i.occurredAt).getTime();
    if (
      (i.type === 'meeting' || i.type === 'video_meeting') &&
      ms >= todayStartMs &&
      ms <= sevenDaysAheadMs
    ) {
      upcomingMeetings.push({
        id: i.id,
        source: 'interaction',
        title: i.summary,
        scheduledAt: i.occurredAt,
        leadId: i.leadId,
        companyName: i.leadId ? leadMap.get(i.leadId)?.companyName : undefined,
        personId: i.personId,
        personName: i.personId ? personMap.get(i.personId)?.fullName : undefined,
      });
    }
  }
  upcomingMeetings.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  // Active opportunities & currency-safe expected value
  const openOpportunities = opportunities.filter((o) => o.status === 'open');
  const valueByCurrencyMap = new Map<string, { totalValue: number; weightedValue: number; count: number }>();
  for (const opp of openOpportunities) {
    const cur = (opp.currency || 'USD').toUpperCase();
    const bucket = valueByCurrencyMap.get(cur) || { totalValue: 0, weightedValue: 0, count: 0 };
    bucket.totalValue += opp.estimatedValue || 0;
    bucket.weightedValue += ((opp.estimatedValue || 0) * (opp.probability || 0)) / 100;
    bucket.count += 1;
    valueByCurrencyMap.set(cur, bucket);
  }
  // If no multi-opportunities created yet, fallback transparently to lead-level pipeline values for stage breakdown
  const useMultiOpportunities = opportunities.length > 0;
  if (!useMultiOpportunities) {
    for (const lead of leads) {
      if ((lead.opportunityValue || 0) <= 0) continue;
      if (lead.pipelineStageId === 'stage-lost' || lead.pipelineStageId === 'stage-won') continue;
      const cur = (lead.currency || 'USD').toUpperCase();
      const bucket = valueByCurrencyMap.get(cur) || { totalValue: 0, weightedValue: 0, count: 0 };
      bucket.totalValue += lead.opportunityValue || 0;
      bucket.weightedValue += ((lead.opportunityValue || 0) * (lead.winProbability ?? 30)) / 100;
      bucket.count += 1;
      valueByCurrencyMap.set(cur, bucket);
    }
  }

  const expectedOpportunityValueByCurrency = Array.from(valueByCurrencyMap.entries()).map(
    ([currency, stats]) => ({
      currency,
      totalValue: Math.round(stats.totalValue),
      weightedValue: Math.round(stats.weightedValue),
      count: stats.count,
    })
  );

  const opportunitiesByStage = stages.map((stage) => {
    const stageOpps = useMultiOpportunities
      ? openOpportunities.filter((o) => o.pipelineStageId === stage.id)
      : leads.filter((l) => l.pipelineStageId === stage.id);

    const byCur = new Map<string, number>();
    let totalValue = 0;
    for (const item of stageOpps) {
      const val = 'estimatedValue' in item ? item.estimatedValue || 0 : item.opportunityValue || 0;
      const cur = (item.currency || 'USD').toUpperCase();
      totalValue += val;
      if (val > 0) byCur.set(cur, (byCur.get(cur) || 0) + val);
    }

    const currencySummary =
      byCur.size === 0
        ? '—'
        : Array.from(byCur.entries())
            .map(([c, v]) => `${c} ${Math.round(v).toLocaleString()}`)
            .join(' · ');

    return {
      stageId: stage.id,
      stageName: stage.name,
      stageColor: stage.color,
      count: stageOpps.length,
      totalValue: Math.round(totalValue),
      currencySummary,
    };
  });

  // Recently updated companies
  const recentlyUpdatedCompanies = [...leads]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 6)
    .map((l) => {
      const meta = getEntityRelationshipMeta(l.customFields, l.tags);
      const leadInts = getEntityInteractions(l.customFields);
      const lastInteractionAt = leadInts.length
        ? leadInts.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0].occurredAt
        : undefined;
      return {
        id: l.id,
        companyName: l.companyName,
        industry: l.industry || 'General Business',
        country: l.address?.country,
        relationshipStatus: meta.relationshipStatus,
        updatedAt: l.updatedAt,
        lastInteractionAt,
      };
    });

  // Recently contacted people
  const primaryCompanyByPerson = new Map<string, { leadId: string; companyName: string; jobTitle?: string }>();
  for (const rel of relationships) {
    if (rel.provenance?.employmentStatus === 'historical') continue;
    const lead = leadMap.get(rel.leadId);
    if (!lead) continue;
    if (!primaryCompanyByPerson.has(rel.personId) || rel.isPrimaryContact) {
      primaryCompanyByPerson.set(rel.personId, {
        leadId: lead.id,
        companyName: lead.companyName,
        jobTitle: rel.jobTitle || rel.designation,
      });
    }
  }

  const latestIntByPerson = new Map<string, { occurredAt: string; type: CrmDashboardSummary['recentlyContactedPeople'][0]['lastInteractionType'] }>();
  for (const i of interactions) {
    if (!i.personId) continue;
    const prev = latestIntByPerson.get(i.personId);
    if (!prev || new Date(i.occurredAt).getTime() > new Date(prev.occurredAt).getTime()) {
      latestIntByPerson.set(i.personId, { occurredAt: i.occurredAt, type: i.type });
    }
  }

  const recentlyContactedPeople: CrmDashboardSummary['recentlyContactedPeople'] = Array.from(
    latestIntByPerson.entries()
  )
    .map(([personId, info]) => {
      const p = personMap.get(personId);
      if (!p) return null;
      const co = primaryCompanyByPerson.get(personId);
      return {
        id: p.id,
        fullName: p.fullName,
        jobTitle: co?.jobTitle || p.decisionMakingFunction,
        companyName: co?.companyName,
        leadId: co?.leadId,
        lastContactDate: info.occurredAt,
        lastInteractionType: info.type,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => new Date(b.lastContactDate).getTime() - new Date(a.lastContactDate).getTime())
    .slice(0, 6);

  // Relationships needing attention (flagged, overdue tasks, or >30d stale active/warm)
  const relationshipsNeedingAttention: CrmDashboardSummary['relationshipsNeedingAttention'] = [];
  for (const lead of leads) {
    const meta = getEntityRelationshipMeta(lead.customFields, lead.tags);
    const leadInts = getEntityInteractions(lead.customFields);
    const latestMs = leadInts.length
      ? Math.max(...leadInts.map((i) => new Date(i.occurredAt).getTime()))
      : null;
    const daysSince = latestMs !== null ? Math.floor((nowMs - latestMs) / DAY_MS) : null;
    const leadOverdue = overdueFollowUpTasks.filter((t) => t.leadId === lead.id).length;

    let reason = '';
    if (leadOverdue > 0) {
      reason = `${leadOverdue} overdue follow-up task(s)`;
    } else if (meta.relationshipStatus === 'needs_attention') {
      reason = 'Flagged as Needs Attention';
    } else if (
      (meta.relationshipStatus === 'active' || meta.relationshipStatus === 'warm') &&
      daysSince !== null &&
      daysSince > 30
    ) {
      reason = `No interaction in ${daysSince} days`;
    }

    if (reason) {
      relationshipsNeedingAttention.push({
        entityType: 'company',
        id: lead.id,
        name: lead.companyName,
        subtitle: [lead.industry, lead.address?.country].filter(Boolean).join(' · '),
        reason,
        daysSinceLastInteraction: daysSince,
        overdueTasksCount: leadOverdue,
        relationshipStatus: meta.relationshipStatus,
      });
    }
  }

  for (const person of persons) {
    const meta = getEntityRelationshipMeta(person.customFields);
    const personOverdue = overdueFollowUpTasks.filter((t) => t.personId === person.id).length;
    const lastInfo = latestIntByPerson.get(person.id);
    const daysSince = lastInfo
      ? Math.floor((nowMs - new Date(lastInfo.occurredAt).getTime()) / DAY_MS)
      : null;
    if (personOverdue > 0 || meta.relationshipStatus === 'needs_attention') {
      const co = primaryCompanyByPerson.get(person.id);
      relationshipsNeedingAttention.push({
        entityType: 'person',
        id: person.id,
        name: person.fullName,
        subtitle: [co?.jobTitle || person.decisionMakingFunction, co?.companyName].filter(Boolean).join(' · '),
        reason:
          personOverdue > 0
            ? `${personOverdue} overdue contact task(s)`
            : 'Flagged as Needs Attention',
        daysSinceLastInteraction: daysSince,
        overdueTasksCount: personOverdue,
        relationshipStatus: meta.relationshipStatus,
      });
    }
  }

  const recentInteractions = interactions.slice(0, 8).map((i) => ({
    ...i,
    companyName: i.leadId ? leadMap.get(i.leadId)?.companyName : undefined,
    personName: i.personId ? personMap.get(i.personId)?.fullName : undefined,
  }));

  return {
    generatedAt: now.toISOString(),
    metrics: {
      totalCompanies: leads.length,
      totalDecisionMakers: persons.length,
      activeRelationships,
      newRelationships30d,
      recentInteractions30d,
      todaysFollowUps: todaysFollowUpTasks.length,
      overdueFollowUps: overdueFollowUpTasks.length,
      upcomingMeetings7d: upcomingMeetings.length,
      activeOpportunities: useMultiOpportunities ? openOpportunities.length : leads.filter((l) => (l.opportunityValue || 0) > 0 && l.pipelineStageId !== 'stage-lost' && l.pipelineStageId !== 'stage-won').length,
      expectedOpportunityValueByCurrency,
      relationshipsNeedingAttentionCount: relationshipsNeedingAttention.length,
    },
    opportunitiesByStage,
    recentInteractions,
    todaysFollowUpTasks: todaysFollowUpTasks.slice(0, 8),
    overdueFollowUpTasks: overdueFollowUpTasks.slice(0, 8),
    upcomingMeetings: upcomingMeetings.slice(0, 8),
    recentlyUpdatedCompanies,
    recentlyContactedPeople,
    relationshipsNeedingAttention: relationshipsNeedingAttention.slice(0, 8),
    reminderCounts: reminderCenter.counts,
  };
}
