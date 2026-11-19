// Phase 14: Deterministic, Explainable Lead Prioritization Engine
// Ranks companies strictly from verifiable CRM facts, ICP alignment, data quality,
// decision-maker seniority, pipeline opportunities, engagement, and follow-up urgency.

import type {
  AiPriorityTier,
  CanonicalLead,
  CrmInteraction,
  CrmOpportunity,
  IcpMatchResult,
  IcpProfile,
  LeadPriorityAssessment,
  LeadPriorityFactor,
  LeadTask,
  LinkedPersonWithRelationship,
} from '../types.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import {
  getEntityInteractions,
  getEntityRelationshipMeta,
  getLeadOpportunities,
  listAllExtendedTasks,
} from '../crm/crmStoreHelper.js';
import { computeRelationshipEngagement } from '../crm/relationshipEngine.js';
import { evaluateCompanyDataQuality } from '../enrichment/dataQualityEngine.js';
import { evaluateCompanyAgainstIcp } from './icpEngine.js';

const SENIOR_ROLE_REGEX =
  /\b(founder|co-founder|owner|ceo|chief|managing director|president|partner|vp|vice president|director|head of|procurement|purchasing)\b/i;

const DAY_MS = 86_400_000;

export function scoreLeadPriority(params: {
  lead: CanonicalLead;
  decisionMakers: LinkedPersonWithRelationship[];
  interactions: CrmInteraction[];
  tasks: LeadTask[];
  opportunities: CrmOpportunity[];
  icp?: IcpProfile;
  now?: Date;
}): { assessment: LeadPriorityAssessment; icpMatch?: IcpMatchResult } {
  const { lead, decisionMakers, interactions, tasks, opportunities, icp } = params;
  const now = params.now || new Date();
  const nowMs = now.getTime();

  const factors: LeadPriorityFactor[] = [];
  let totalPoints = 0;

  const relationshipMeta = getEntityRelationshipMeta(lead.customFields, lead.tags);
  const engagement = computeRelationshipEngagement({
    interactions,
    tasks,
    opportunities,
    createdAt: lead.createdAt,
    relationshipMeta,
    now,
  });
  const dq = evaluateCompanyDataQuality(lead, { linkedPersonsCount: decisionMakers.length });

  // 1. ICP Alignment (max 22 pts)
  let icpMatch: IcpMatchResult | undefined;
  if (icp) {
    icpMatch = evaluateCompanyAgainstIcp({ icp, lead, decisionMakers });
    const pts = Math.round((icpMatch.overallScore / 100) * 22);
    totalPoints += pts;
    factors.push({
      factor: `ICP Fit (${icp.name})`,
      points: pts,
      maxPoints: 22,
      detail: `${icpMatch.overallScore}/100 (${icpMatch.fitLabel.replace('_', ' ')})`,
      basis: 'derived_score',
    });
  } else {
    // Without a configured ICP, distribute a baseline completeness/industry readiness score (max 22)
    const industryReady = lead.industry && lead.industry !== 'Unknown' ? 10 : 3;
    const activeBonus = lead.companyStatus === 'active' ? 6 : 2;
    const pts = Math.min(22, industryReady + activeBonus);
    totalPoints += pts;
    factors.push({
      factor: 'Profile Readiness (No ICP Selected)',
      points: pts,
      maxPoints: 22,
      detail: `Company status: ${lead.companyStatus || 'unknown'} · Industry: ${lead.industry || 'Unset'}`,
      basis: 'verified_fact',
    });
  }

  // 2. Data Quality & Official Verification (max 16 pts)
  const isRegistryVerified =
    lead.customFields?.registryVerificationState === 'verified' ||
    Boolean(lead.identifiers?.some((i) => i.verified));
  const dqPoints = Math.round((dq.overallScore / 100) * 11) + (isRegistryVerified ? 5 : 0);
  totalPoints += dqPoints;
  factors.push({
    factor: 'Data Quality & Verification',
    points: dqPoints,
    maxPoints: 16,
    detail: `Quality ${dq.overallScore}/100 (Grade ${dq.grade})${isRegistryVerified ? ' · Registry verified' : ' · Unverified registry'}`,
    basis: 'verified_fact',
  });

  // 3. Decision-Maker Availability & Seniority (max 16 pts)
  const currentDms = decisionMakers.filter((d) => d.relationship.provenance?.employmentStatus !== 'historical');
  const seniorDms = currentDms.filter((d) =>
    SENIOR_ROLE_REGEX.test(
      `${d.relationship.jobTitle || ''} ${d.relationship.designation || ''} ${d.relationship.relationshipType || ''} ${d.person.seniority || ''}`
    )
  );
  const reachableDms = currentDms.filter((d) => Boolean(d.person.email || d.person.phone || d.person.linkedinUrl));
  const dmPoints = Math.min(
    16,
    (currentDms.length > 0 ? 5 : 0) +
      (seniorDms.length > 0 ? 6 : 0) +
      (reachableDms.length > 0 ? 5 : 0)
  );
  totalPoints += dmPoints;
  factors.push({
    factor: 'Decision-Maker Coverage',
    points: dmPoints,
    maxPoints: 16,
    detail: `${currentDms.length} active contact(s), ${seniorDms.length} senior executive(s), ${reachableDms.length} reachable`,
    basis: 'verified_fact',
  });

  // 4. Open Opportunity Value & Stage Momentum (max 16 pts)
  const openOpps = opportunities.filter((o) => o.status === 'open');
  const openValue = openOpps.reduce((sum, o) => sum + (o.estimatedValue || 0), 0) || (lead.opportunityValue || 0);
  const maxProb = openOpps.reduce((m, o) => Math.max(m, o.probability || 0), 0);
  let oppPoints = 0;
  if (openOpps.length > 0) {
    oppPoints += 6;
    if (openValue >= 50000) oppPoints += 5;
    else if (openValue >= 10000) oppPoints += 3;
    else if (openValue > 0) oppPoints += 2;
    if (maxProb >= 50) oppPoints += 5;
    else if (maxProb >= 25) oppPoints += 3;
  } else if (openValue > 0) {
    oppPoints += 4;
  }
  oppPoints = Math.min(16, oppPoints);
  totalPoints += oppPoints;
  factors.push({
    factor: 'Opportunity & Pipeline Value',
    points: oppPoints,
    maxPoints: 16,
    detail:
      openOpps.length > 0
        ? `${openOpps.length} open opportunity(ies) · ${lead.currency || 'USD'} ${openValue.toLocaleString()} (max prob ${maxProb}%)`
        : openValue > 0
          ? `Estimated lead value ${lead.currency || 'USD'} ${openValue.toLocaleString()} (no formal opportunity yet)`
          : 'No open opportunities tracked yet',
    basis: 'crm_activity',
  });

  // 5. Relationship Engagement & Recency (max 15 pts)
  const engPoints = Math.round((engagement.score / 100) * 15);
  totalPoints += engPoints;
  factors.push({
    factor: 'Relationship Engagement',
    points: engPoints,
    maxPoints: 15,
    detail: `Engagement ${engagement.score}/100 (${engagement.effectiveLevel}) · ${engagement.metrics.totalInteractions} interaction(s)`,
    basis: 'crm_activity',
  });

  // 6. Follow-Up Urgency (max 15 pts)
  const openTasks = tasks.filter((t) => !t.completed && t.status !== 'completed' && t.status !== 'cancelled');
  const overdueTasks = openTasks.filter((t) => new Date(t.dueDate).getTime() < nowMs);
  const dueSoonTasks = openTasks.filter((t) => {
    const ms = new Date(t.dueDate).getTime();
    return ms >= nowMs && ms <= nowMs + 3 * DAY_MS;
  });
  const coolingActive =
    (relationshipMeta.relationshipStatus === 'active' || relationshipMeta.relationshipStatus === 'warm') &&
    engagement.metrics.daysSinceLastInteraction !== null &&
    engagement.metrics.daysSinceLastInteraction >= 14;

  let urgencyPoints = 0;
  if (overdueTasks.length > 0) urgencyPoints += 9;
  else if (dueSoonTasks.length > 0) urgencyPoints += 6;
  if (coolingActive) urgencyPoints += 6;
  else if (relationshipMeta.nextFollowUpDate && new Date(relationshipMeta.nextFollowUpDate).getTime() <= nowMs + 2 * DAY_MS) {
    urgencyPoints += 5;
  }
  urgencyPoints = Math.min(15, urgencyPoints);
  totalPoints += urgencyPoints;
  factors.push({
    factor: 'Follow-Up Urgency',
    points: urgencyPoints,
    maxPoints: 15,
    detail:
      overdueTasks.length > 0
        ? `${overdueTasks.length} overdue task(s) requiring immediate action`
        : dueSoonTasks.length > 0
          ? `${dueSoonTasks.length} task(s) due within 72 hours`
          : coolingActive
            ? `Active relationship cooling (${engagement.metrics.daysSinceLastInteraction}d since last interaction)`
            : 'No immediate overdue follow-ups',
    basis: 'crm_activity',
  });

  // Penalize do_not_contact or dissolved/lost leads honestly
  let finalScore = Math.min(100, Math.max(0, totalPoints));
  if (lead.status === 'do_not_contact' || lead.companyStatus === 'dissolved') {
    finalScore = Math.min(finalScore, 10);
  } else if (icpMatch?.fitLabel === 'excluded') {
    finalScore = Math.min(finalScore, 15);
  }

  let priorityTier: AiPriorityTier = 'low';
  if (finalScore >= 80) priorityTier = 'critical';
  else if (finalScore >= 62) priorityTier = 'high';
  else if (finalScore >= 42) priorityTier = 'medium';

  const urgency: LeadPriorityAssessment['urgency'] =
    overdueTasks.length > 0 || finalScore >= 80
      ? 'immediate'
      : dueSoonTasks.length > 0 || coolingActive || finalScore >= 62
        ? 'this_week'
        : finalScore >= 42
          ? 'this_month'
          : 'monitor';

  // Concrete, grounded next action
  let recommendedNextAction = 'Review company profile and define outreach objective.';
  if (lead.status === 'do_not_contact') {
    recommendedNextAction = 'Respect do-not-contact status; do not initiate outreach.';
  } else if (overdueTasks.length > 0) {
    recommendedNextAction = `Complete overdue task: "${overdueTasks[0].title}".`;
  } else if (openOpps.length > 0 && openOpps[0].nextAction) {
    recommendedNextAction = `Advance "${openOpps[0].title}": ${openOpps[0].nextAction}.`;
  } else if (currentDms.length === 0) {
    recommendedNextAction = 'Run Decision-Maker Discovery to identify senior stakeholders before outreach.';
  } else if (dq.overallScore < 55) {
    recommendedNextAction = 'Run Phase 12 Enrichment & Verification to resolve missing company/contact fields.';
  } else if (interactions.length === 0) {
    recommendedNextAction = `Draft a personalized introductory message for ${seniorDms[0]?.person.fullName || currentDms[0].person.fullName}.`;
  } else if (coolingActive) {
    recommendedNextAction = `Re-engage ${lead.companyName} (${engagement.metrics.daysSinceLastInteraction} days since last recorded interaction).`;
  } else {
    recommendedNextAction = `Prepare a brief value follow-up with ${seniorDms[0]?.person.fullName || currentDms[0].person.fullName}.`;
  }

  const topDrivers = [...factors]
    .sort((a, b) => b.points / Math.max(1, b.maxPoints) - a.points / Math.max(1, a.maxPoints))
    .slice(0, 2)
    .map((f) => `${f.factor} (${f.points}/${f.maxPoints})`);

  const assessment: LeadPriorityAssessment = {
    leadId: lead.id,
    companyName: lead.companyName,
    industry: lead.industry || 'Unknown',
    country: lead.address?.country,
    priorityScore: finalScore,
    priorityTier,
    urgency,
    confidenceScore: Math.round((dq.overallScore * 0.5 + lead.confidenceScore * 0.5)),
    isDerived: true,
    icpScore: icpMatch?.overallScore,
    icpName: icpMatch?.icpName,
    dataQualityScore: dq.overallScore,
    dataQualityGrade: dq.grade,
    decisionMakerCount: currentDms.length,
    seniorDecisionMakerCount: seniorDms.length,
    openOpportunityValue: openValue,
    currency: lead.currency || 'USD',
    overdueTasksCount: overdueTasks.length,
    daysSinceLastInteraction: engagement.metrics.daysSinceLastInteraction,
    factors,
    explanation: `Priority ${finalScore}/100 (${priorityTier}) driven primarily by ${topDrivers.join(' and ')}.`,
    recommendedNextAction,
    evaluatedAt: now.toISOString(),
  };

  return { assessment, icpMatch };
}

export async function prioritizeCrmLeads(
  facade: CrmStorageFacade,
  options?: {
    icp?: IcpProfile;
    leadIds?: string[];
    limit?: number;
    now?: Date;
  }
): Promise<LeadPriorityAssessment[]> {
  const [leads, persons, relationships, tasks] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    facade.getCompanyPersonRelationships(),
    listAllExtendedTasks(facade),
  ]);

  const personMap = new Map(persons.map((p) => [p.id, p]));
  const relsByLead = new Map<string, LinkedPersonWithRelationship[]>();
  for (const rel of relationships) {
    const person = personMap.get(rel.personId);
    if (!person) continue;
    const arr = relsByLead.get(rel.leadId) || [];
    arr.push({ person, relationship: rel });
    relsByLead.set(rel.leadId, arr);
  }

  const tasksByLead = new Map<string, LeadTask[]>();
  for (const t of tasks) {
    if (!t.leadId) continue;
    const arr = tasksByLead.get(t.leadId) || [];
    arr.push(t);
    tasksByLead.set(t.leadId, arr);
  }

  const idFilter = options?.leadIds?.length ? new Set(options.leadIds) : null;
  const targetLeads = idFilter ? leads.filter((l) => idFilter.has(l.id)) : leads;

  const ranked = targetLeads.map((lead) => {
    const { assessment } = scoreLeadPriority({
      lead,
      decisionMakers: relsByLead.get(lead.id) || [],
      interactions: getEntityInteractions(lead.customFields),
      tasks: tasksByLead.get(lead.id) || [],
      opportunities: getLeadOpportunities(lead),
      icp: options?.icp,
      now: options?.now,
    });
    return assessment;
  });

  ranked.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (b.overdueTasksCount !== a.overdueTasksCount) return b.overdueTasksCount - a.overdueTasksCount;
    return b.openOpportunityValue - a.openOpportunityValue;
  });

  return options?.limit && options.limit > 0 ? ranked.slice(0, options.limit) : ranked;
}
