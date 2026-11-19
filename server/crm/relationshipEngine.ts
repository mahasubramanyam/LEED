// Phase 13: Unified Relationship Profile & Transparent Engagement Intelligence Engine
// Computes explainable, derived engagement scores from actual CRM activity only.
// Explicitly labeled as derived/inferred — never presented as verified fact.

import type {
  CanonicalLead,
  CompanyPersonRelationship,
  CompanyRelationshipProfile,
  CrmInteraction,
  CrmOpportunity,
  CrmPrivateNote,
  LeadTask,
  LinkedPersonWithRelationship,
  PersonRecord,
  PersonRelationshipProfile,
  RelationshipEngagementAssessment,
  RelationshipEngagementFactor,
  RelationshipMetadata,
} from '../types.js';
import { evaluateCompanyDataQuality } from '../enrichment/dataQualityEngine.js';
import {
  CrmStorageFacade,
  getEntityRelationshipMeta,
  getLeadOpportunities,
  listAllCrmInteractions,
  listAllCrmOpportunities,
  listAllCrmPrivateNotes,
  listAllExtendedTasks,
} from './crmStoreHelper.js';

const DAY_MS = 86_400_000;

export function computeRelationshipEngagement(params: {
  interactions: CrmInteraction[];
  tasks: LeadTask[];
  opportunities: CrmOpportunity[];
  createdAt: string;
  relationshipMeta: RelationshipMetadata;
  now?: Date;
}): RelationshipEngagementAssessment {
  const now = params.now || new Date();
  const nowMs = now.getTime();
  const { interactions, tasks, opportunities, relationshipMeta } = params;

  const sortedInteractions = [...interactions].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );

  const totalInteractions = sortedInteractions.length;
  const interactionsLast30Days = sortedInteractions.filter(
    (i) => nowMs - new Date(i.occurredAt).getTime() <= 30 * DAY_MS
  ).length;
  const interactionsLast90Days = sortedInteractions.filter(
    (i) => nowMs - new Date(i.occurredAt).getTime() <= 90 * DAY_MS
  ).length;

  const lastInteractionMs =
    sortedInteractions.length > 0 ? new Date(sortedInteractions[0].occurredAt).getTime() : null;
  const daysSinceLastInteraction =
    lastInteractionMs !== null ? Math.max(0, Math.floor((nowMs - lastInteractionMs) / DAY_MS)) : null;

  const completedTasksCount = tasks.filter((t) => t.completed || t.status === 'completed').length;
  const openTasks = tasks.filter(
    (t) => !t.completed && t.status !== 'completed' && t.status !== 'cancelled'
  );
  const overdueTasksCount = openTasks.filter((t) => new Date(t.dueDate).getTime() < nowMs).length;
  const openOpportunitiesCount = opportunities.filter((o) => o.status === 'open').length;

  const createdMs = new Date(params.createdAt).getTime();
  const relationshipAgeDays = Number.isFinite(createdMs)
    ? Math.max(0, Math.floor((nowMs - createdMs) / DAY_MS))
    : 0;

  const factors: RelationshipEngagementFactor[] = [];

  // 1. Recency (max 30 pts)
  let recencyPoints = 0;
  let recencyDetail = 'No logged interactions yet.';
  if (daysSinceLastInteraction !== null) {
    if (daysSinceLastInteraction <= 7) {
      recencyPoints = 30;
      recencyDetail = `Last interaction was ${daysSinceLastInteraction} day(s) ago (within 7 days).`;
    } else if (daysSinceLastInteraction <= 21) {
      recencyPoints = 24;
      recencyDetail = `Last interaction was ${daysSinceLastInteraction} days ago (within 3 weeks).`;
    } else if (daysSinceLastInteraction <= 45) {
      recencyPoints = 16;
      recencyDetail = `Last interaction was ${daysSinceLastInteraction} days ago.`;
    } else if (daysSinceLastInteraction <= 90) {
      recencyPoints = 8;
      recencyDetail = `Last interaction was ${daysSinceLastInteraction} days ago (cooling).`;
    } else {
      recencyPoints = 2;
      recencyDetail = `Last interaction was ${daysSinceLastInteraction} days ago (stale).`;
    }
  }
  factors.push({
    key: 'recency',
    label: 'Interaction Recency',
    points: recencyPoints,
    maxPoints: 30,
    detail: recencyDetail,
  });

  // 2. Frequency (max 25 pts)
  const freqPoints = Math.min(25, interactionsLast30Days * 7 + Math.min(interactionsLast90Days, 4) * 2);
  factors.push({
    key: 'frequency',
    label: 'Interaction Frequency',
    points: freqPoints,
    maxPoints: 25,
    detail: `${interactionsLast30Days} interaction(s) in last 30 days · ${interactionsLast90Days} in last 90 days (${totalInteractions} total).`,
  });

  // 3. Follow-Up Consistency (max 20 pts)
  let followUpPoints = 0;
  let followUpDetail = 'No follow-up tasks or scheduled next actions tracked yet.';
  const hasFutureFollowUp =
    Boolean(relationshipMeta.nextFollowUpDate && new Date(relationshipMeta.nextFollowUpDate).getTime() >= nowMs - DAY_MS) ||
    openTasks.some((t) => new Date(t.dueDate).getTime() >= nowMs - DAY_MS);

  if (completedTasksCount > 0 || openTasks.length > 0 || relationshipMeta.nextFollowUpDate) {
    const base = Math.min(12, completedTasksCount * 4) + (hasFutureFollowUp ? 8 : 0);
    const overduePenalty = Math.min(14, overdueTasksCount * 7);
    followUpPoints = Math.max(0, Math.min(20, base - overduePenalty));
    followUpDetail = `${completedTasksCount} completed task(s), ${overdueTasksCount} overdue task(s)${
      hasFutureFollowUp ? ', next follow-up scheduled.' : ', no upcoming follow-up scheduled.'
    }`;
  }
  factors.push({
    key: 'follow_up_consistency',
    label: 'Follow-Up Consistency',
    points: followUpPoints,
    maxPoints: 20,
    detail: followUpDetail,
  });

  // 4. Active Commercial Opportunities (max 15 pts)
  const oppPoints = Math.min(15, openOpportunitiesCount * 10 + (opportunities.some((o) => o.status === 'won') ? 5 : 0));
  factors.push({
    key: 'opportunities',
    label: 'Active Opportunities',
    points: oppPoints,
    maxPoints: 15,
    detail:
      openOpportunitiesCount > 0
        ? `${openOpportunitiesCount} open opportunity record(s) linked.`
        : 'No open commercial opportunities currently tracked.',
  });

  // 5. Relationship Depth & Duration (max 10 pts)
  const depthPoints = Math.min(
    10,
    (totalInteractions >= 2 ? 5 : totalInteractions === 1 ? 2 : 0) +
      (relationshipAgeDays >= 30 && totalInteractions >= 2 ? 5 : relationshipAgeDays >= 7 && totalInteractions >= 1 ? 2 : 0)
  );
  factors.push({
    key: 'duration_depth',
    label: 'Relationship Continuity',
    points: depthPoints,
    maxPoints: 10,
    detail: `Tracked for ${relationshipAgeDays} day(s) with ${totalInteractions} manually logged interaction(s).`,
  });

  const score = Math.max(
    0,
    Math.min(100, factors.reduce((sum, f) => sum + f.points, 0))
  );

  let level: RelationshipEngagementAssessment['level'] = 'inactive';
  if (score >= 75) level = 'strong';
  else if (score >= 52) level = 'active';
  else if (score >= 28) level = 'developing';
  else if (score >= 10) level = 'cooling';
  else level = 'inactive';

  const effectiveLevel = relationshipMeta.ownerOverrideLevel || level;

  return {
    score,
    level,
    effectiveLevel,
    isDerived: true,
    basis: 'derived_from_crm_activity',
    transparencyLabel: relationshipMeta.ownerOverrideLevel
      ? `Derived score ${score}/100 (${level}) · Owner override applied: ${relationshipMeta.ownerOverrideLevel}`
      : `Derived from recorded CRM activity (${score}/100) — indicative estimate, not a verified external metric`,
    ownerOverrideLevel: relationshipMeta.ownerOverrideLevel,
    ownerAnnotation: relationshipMeta.ownerAnnotation,
    factors,
    metrics: {
      totalInteractions,
      interactionsLast30Days,
      interactionsLast90Days,
      daysSinceLastInteraction,
      completedTasksCount,
      overdueTasksCount,
      openOpportunitiesCount,
      relationshipAgeDays,
    },
    evaluatedAt: now.toISOString(),
  };
}

export function findNextPlannedAction(params: {
  tasks: LeadTask[];
  interactions: CrmInteraction[];
  relationshipMeta: RelationshipMetadata;
}): { nextAt?: string; summary?: string } {
  const candidates: Array<{ at: string; summary: string }> = [];

  for (const t of params.tasks) {
    if (!t.completed && t.status !== 'completed' && t.status !== 'cancelled' && t.dueDate) {
      candidates.push({ at: t.dueDate, summary: `Task: ${t.title}` });
    }
  }
  for (const i of params.interactions) {
    if (i.followUpDate) {
      candidates.push({
        at: i.followUpDate,
        summary: i.nextAction ? `Follow-up: ${i.nextAction}` : `Follow-up from ${i.summary}`,
      });
    }
  }
  if (params.relationshipMeta.nextFollowUpDate) {
    candidates.push({
      at: params.relationshipMeta.nextFollowUpDate,
      summary: 'Scheduled relationship follow-up',
    });
  }

  candidates.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const first = candidates[0];
  return first ? { nextAt: first.at, summary: first.summary } : {};
}

export async function buildCompanyRelationshipProfile(
  facade: CrmStorageFacade,
  leadId: string
): Promise<CompanyRelationshipProfile | null> {
  const lead = await facade.getLead(leadId);
  if (!lead) return null;

  const [allLeads, persons, relationships, interactions, privateNotes, tasks] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    facade.getCompanyPersonRelationships(),
    listAllCrmInteractions(facade, { leadId }),
    listAllCrmPrivateNotes(facade, { leadId }),
    listAllExtendedTasks(facade, { leadId }),
  ]);

  const personById = new Map(persons.map((p) => [p.id, p]));
  const decisionMakers: LinkedPersonWithRelationship[] = relationships
    .filter((r) => r.leadId === leadId)
    .map((rel) => {
      const person = personById.get(rel.personId);
      if (!person) return null;
      return { person, relationship: rel };
    })
    .filter((x): x is LinkedPersonWithRelationship => Boolean(x))
    .sort((a, b) => {
      if (a.relationship.isPrimaryContact !== b.relationship.isPrimaryContact) {
        return a.relationship.isPrimaryContact ? -1 : 1;
      }
      const aCurrent = a.relationship.provenance?.employmentStatus !== 'historical';
      const bCurrent = b.relationship.provenance?.employmentStatus !== 'historical';
      if (aCurrent !== bCurrent) {
        return aCurrent ? -1 : 1;
      }
      return b.person.confidenceScore - a.person.confidenceScore;
    });

  const opportunities = getLeadOpportunities(lead);
  const relationshipMeta = getEntityRelationshipMeta(lead.customFields, lead.tags);
  const engagement = computeRelationshipEngagement({
    interactions,
    tasks,
    opportunities,
    createdAt: lead.createdAt,
    relationshipMeta,
  });

  const lastInteractionAt = interactions[0]?.occurredAt;
  const nextPlanned = findNextPlannedAction({ tasks, interactions, relationshipMeta });

  let dataQualityScore: number | undefined;
  let dataQualityGrade: string | undefined;
  try {
    const dq = evaluateCompanyDataQuality(lead, { linkedPersonsCount: decisionMakers.length });
    dataQualityScore = dq.overallScore;
    dataQualityGrade = dq.grade;
  } catch {
    // Non-blocking
  }

  return {
    lead,
    relationshipMeta,
    engagement,
    decisionMakers,
    interactions,
    privateNotes,
    tasks,
    opportunities,
    lastInteractionAt,
    nextPlannedInteractionAt: nextPlanned.nextAt,
    nextPlannedSummary: nextPlanned.summary,
    enrichmentSummary: {
      confidenceScore: lead.confidenceScore,
      registryVerificationState: lead.customFields?.registryVerificationState || 'unverified',
      lastVerifiedAt: lead.customFields?.registryLastVerifiedAt,
      dataQualityScore,
      dataQualityGrade,
    },
  };
}

export async function buildPersonRelationshipProfile(
  facade: CrmStorageFacade,
  personId: string
): Promise<PersonRelationshipProfile | null> {
  const person = await facade.getPersonById(personId);
  if (!person) return null;

  const [leads, relationships, interactions, privateNotes, tasks, allOpps] = await Promise.all([
    facade.getLeads(),
    facade.getCompanyPersonRelationships(),
    listAllCrmInteractions(facade, { personId }),
    listAllCrmPrivateNotes(facade, { personId }),
    listAllExtendedTasks(facade, { personId }),
    listAllCrmOpportunities(facade),
  ]);

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const personRels = relationships.filter((r) => r.personId === personId);

  const pickCompany = (lead?: CanonicalLead) =>
    lead
      ? {
          id: lead.id,
          companyName: lead.companyName,
          industry: lead.industry,
          website: lead.website,
          address: lead.address,
          pipelineStageId: lead.pipelineStageId,
          companyStatus: lead.companyStatus,
        }
      : undefined;

  const currentCompanies = personRels
    .filter((r) => r.provenance?.employmentStatus !== 'historical')
    .map((relationship) => ({
      relationship,
      company: pickCompany(leadById.get(relationship.leadId)),
    }));

  const historicalCompanies = personRels
    .filter((r) => r.provenance?.employmentStatus === 'historical')
    .map((relationship) => ({
      relationship,
      company: pickCompany(leadById.get(relationship.leadId)),
    }));

  const linkedLeadIds = new Set(personRels.map((r) => r.leadId));
  const opportunities = allOpps.filter(
    (o) => o.personId === personId || (linkedLeadIds.has(o.leadId) && !o.personId)
  );

  const relationshipMeta = getEntityRelationshipMeta(person.customFields);
  const engagement = computeRelationshipEngagement({
    interactions,
    tasks,
    opportunities,
    createdAt: person.createdAt,
    relationshipMeta,
  });

  const lastContactDate = interactions[0]?.occurredAt;
  const nextPlanned = findNextPlannedAction({ tasks, interactions, relationshipMeta });

  return {
    person,
    relationshipMeta,
    engagement,
    currentCompanies,
    historicalCompanies,
    interactions,
    privateNotes,
    tasks,
    opportunities,
    lastContactDate,
    nextFollowUpDate: nextPlanned.nextAt || relationshipMeta.nextFollowUpDate,
    nextPlannedSummary: nextPlanned.summary,
  };
}
