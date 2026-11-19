// Phase 13: Advanced Search & Segmentation Engine for Companies and Decision-Makers
// Reuses existing CanonicalLead, PersonRecord, CompanyPersonRelationship, and DataQualityEngine.

import type {
  CanonicalLead,
  CrmCompanySearchFilter,
  CrmPersonSearchFilter,
  PersonRecord,
} from '../types.js';
import { evaluateCompanyDataQuality } from '../enrichment/dataQualityEngine.js';
import {
  CrmStorageFacade,
  getEntityInteractions,
  getEntityRelationshipMeta,
  getLeadOpportunities,
  listAllExtendedTasks,
} from './crmStoreHelper.js';
import { startOfUtcDay } from './reminderEngine.js';

const DAY_MS = 86_400_000;

export interface SegmentedCompanyItem {
  lead: CanonicalLead;
  relationshipStatus: string;
  lastInteractionAt?: string;
  nextFollowUpDate?: string;
  openOpportunitiesCount: number;
  openTasksCount: number;
  dataQualityScore: number;
  dataQualityGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  tags: string[];
}

export interface SegmentedPersonItem {
  person: PersonRecord;
  relationshipStatus: string;
  lastInteractionAt?: string;
  nextFollowUpDate?: string;
  currentCompanies: Array<{ leadId: string; companyName: string; relationshipType: string; isPrimaryContact: boolean }>;
  historicalCompaniesCount: number;
  openTasksCount: number;
  tags: string[];
}

function matchesFollowUpFilter(
  followUpIso: string | undefined,
  filter: CrmCompanySearchFilter['followUpDue'],
  now: Date
): boolean {
  if (!filter || filter === 'all') return true;
  if (!followUpIso) return false;
  if (filter === 'has_date') return true;
  const ms = new Date(followUpIso).getTime();
  if (Number.isNaN(ms)) return false;
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = todayStart + DAY_MS;
  if (filter === 'overdue') return ms < todayStart;
  if (filter === 'today') return ms >= todayStart && ms < tomorrowStart;
  if (filter === 'upcoming') return ms >= tomorrowStart;
  return true;
}

export async function searchSegmentedCompanies(
  facade: CrmStorageFacade,
  filter: CrmCompanySearchFilter,
  now: Date = new Date()
): Promise<{ total: number; items: SegmentedCompanyItem[] }> {
  const [leads, tasks] = await Promise.all([facade.getLeads(), listAllExtendedTasks(facade)]);
  const nowMs = now.getTime();
  const q = filter.search?.trim().toLowerCase();

  const items: SegmentedCompanyItem[] = [];

  for (const lead of leads) {
    const meta = getEntityRelationshipMeta(lead.customFields, lead.tags);
    const ints = getEntityInteractions(lead.customFields).sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );
    const lastInteractionAt = ints[0]?.occurredAt;
    const leadTasks = tasks.filter(
      (t) => t.leadId === lead.id && !t.completed && t.status !== 'completed' && t.status !== 'cancelled'
    );
    const nextTaskDue = leadTasks[0]?.dueDate;
    const nextFollowUpDate = meta.nextFollowUpDate || ints.find((i) => i.followUpDate)?.followUpDate || nextTaskDue;
    const openOpps = getLeadOpportunities(lead).filter((o) => o.status === 'open');
    const dq = evaluateCompanyDataQuality(lead);
    const mergedTags = Array.from(new Set([...(lead.tags || []), ...(meta.tags || [])]));

    if (q) {
      const hay = [
        lead.companyName,
        lead.legalName,
        lead.customFields?.tradingName,
        lead.domain,
        lead.industry,
        lead.category,
        lead.registrationNumber,
        lead.address?.city,
        lead.address?.country,
        ...mergedTags,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }

    if (filter.countryCode && filter.countryCode !== 'ALL') {
      if ((lead.address?.countryCode || '').toUpperCase() !== filter.countryCode.toUpperCase()) continue;
    }
    if (filter.industry && filter.industry !== 'ALL') {
      if (!(lead.industry || '').toLowerCase().includes(filter.industry.toLowerCase())) continue;
    }
    if (filter.businessType && filter.businessType !== 'ALL') {
      const bt = (lead.customFields?.legalEntityType || lead.category || '').toLowerCase();
      if (!bt.includes(filter.businessType.toLowerCase())) continue;
    }
    if (filter.companyStatus && filter.companyStatus !== 'ALL') {
      if ((lead.companyStatus || 'unknown') !== filter.companyStatus) continue;
    }
    if (filter.pipelineStageId && filter.pipelineStageId !== 'ALL') {
      if (lead.pipelineStageId !== filter.pipelineStageId) continue;
    }
    if (filter.relationshipStatus && filter.relationshipStatus !== 'all') {
      if (meta.relationshipStatus !== filter.relationshipStatus) continue;
    }
    if (typeof filter.minQualityScore === 'number' && dq.overallScore < filter.minQualityScore) {
      continue;
    }
    if (filter.qualityGrade && filter.qualityGrade !== 'all' && dq.grade !== filter.qualityGrade) {
      continue;
    }
    if (typeof filter.lastInteractionWithinDays === 'number' && filter.lastInteractionWithinDays > 0) {
      if (!lastInteractionAt) continue;
      if (nowMs - new Date(lastInteractionAt).getTime() > filter.lastInteractionWithinDays * DAY_MS) continue;
    }
    if (typeof filter.noInteractionForDays === 'number' && filter.noInteractionForDays > 0) {
      if (lastInteractionAt && nowMs - new Date(lastInteractionAt).getTime() < filter.noInteractionForDays * DAY_MS) {
        continue;
      }
    }
    if (!matchesFollowUpFilter(nextFollowUpDate, filter.followUpDue, now)) {
      continue;
    }
    if (Array.isArray(filter.tags) && filter.tags.length > 0) {
      const lowerTags = new Set(mergedTags.map((t) => t.toLowerCase()));
      const hasAll = filter.tags.every((t) => lowerTags.has(t.toLowerCase()));
      if (!hasAll) continue;
    }

    items.push({
      lead,
      relationshipStatus: meta.relationshipStatus,
      lastInteractionAt,
      nextFollowUpDate,
      openOpportunitiesCount: openOpps.length,
      openTasksCount: leadTasks.length,
      dataQualityScore: dq.overallScore,
      dataQualityGrade: dq.grade,
      tags: mergedTags,
    });
  }

  return { total: items.length, items };
}

export async function searchSegmentedPersons(
  facade: CrmStorageFacade,
  filter: CrmPersonSearchFilter,
  now: Date = new Date()
): Promise<{ total: number; items: SegmentedPersonItem[] }> {
  const [leads, persons, relationships, tasks] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    facade.getCompanyPersonRelationships(),
    listAllExtendedTasks(facade),
  ]);

  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const nowMs = now.getTime();
  const q = filter.search?.trim().toLowerCase();

  const items: SegmentedPersonItem[] = [];

  for (const person of persons) {
    const meta = getEntityRelationshipMeta(person.customFields);
    const ints = getEntityInteractions(person.customFields).sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );
    const lastInteractionAt = ints[0]?.occurredAt;
    const personTasks = tasks.filter(
      (t) => t.personId === person.id && !t.completed && t.status !== 'completed' && t.status !== 'cancelled'
    );
    const nextFollowUpDate =
      meta.nextFollowUpDate || ints.find((i) => i.followUpDate)?.followUpDate || personTasks[0]?.dueDate;

    const personRels = relationships.filter((r) => r.personId === person.id);
    const currentCompanies = personRels
      .filter((r) => r.provenance?.employmentStatus !== 'historical')
      .map((r) => ({
        leadId: r.leadId,
        companyName: leadMap.get(r.leadId)?.companyName || 'Unknown Company',
        relationshipType: r.relationshipType,
        isPrimaryContact: r.isPrimaryContact,
      }));
    const historicalCompaniesCount = personRels.filter(
      (r) => r.provenance?.employmentStatus === 'historical'
    ).length;

    if (q) {
      const hay = [
        person.fullName,
        person.seniority,
        person.decisionMakingFunction,
        person.email,
        person.phone,
        person.country,
        person.countryCode,
        person.city,
        ...personRels.flatMap((r) => [r.jobTitle, r.designation, r.department, r.relationshipType]),
        ...currentCompanies.map((c) => c.companyName),
        ...meta.tags,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }

    if (filter.leadId && filter.leadId !== 'all') {
      if (!personRels.some((r) => r.leadId === filter.leadId)) continue;
    }
    if (filter.roleCategory && filter.roleCategory !== 'all') {
      const roleMatch =
        person.decisionMakingFunction === filter.roleCategory ||
        personRels.some((r) => r.relationshipType === filter.roleCategory);
      if (!roleMatch) continue;
    }
    if (filter.department && filter.department !== 'all') {
      const deptNeedle = filter.department.toLowerCase();
      const deptMatch = personRels.some((r) => (r.department || '').toLowerCase().includes(deptNeedle));
      if (!deptMatch) continue;
    }
    if (filter.seniority && filter.seniority !== 'all') {
      if ((person.seniority || '').toLowerCase() !== filter.seniority.toLowerCase()) continue;
    }
    if (filter.country && filter.country !== 'all') {
      const countryNeedle = filter.country.toLowerCase();
      const countryVal = [person.country, person.countryCode].filter(Boolean).join(' ').toLowerCase();
      if (!countryVal.includes(countryNeedle)) continue;
    }
    if (filter.verificationStatus && filter.verificationStatus !== 'all') {
      const hasVerif =
        person.emailStatus === filter.verificationStatus ||
        person.verificationStatus === filter.verificationStatus ||
        personRels.some((r) => r.verificationStatus === filter.verificationStatus);
      if (!hasVerif) continue;
    }
    if (filter.employmentStatus === 'current' && currentCompanies.length === 0) continue;
    if (filter.employmentStatus === 'former' && historicalCompaniesCount === 0) continue;

    if (filter.relationshipStatus && filter.relationshipStatus !== 'all') {
      if (meta.relationshipStatus !== filter.relationshipStatus) continue;
    }
    if (typeof filter.lastInteractionWithinDays === 'number' && filter.lastInteractionWithinDays > 0) {
      if (!lastInteractionAt) continue;
      if (nowMs - new Date(lastInteractionAt).getTime() > filter.lastInteractionWithinDays * DAY_MS) continue;
    }
    if (typeof filter.noInteractionForDays === 'number' && filter.noInteractionForDays > 0) {
      if (lastInteractionAt && nowMs - new Date(lastInteractionAt).getTime() < filter.noInteractionForDays * DAY_MS) {
        continue;
      }
    }
    if (!matchesFollowUpFilter(nextFollowUpDate, filter.followUpDue, now)) {
      continue;
    }
    if (Array.isArray(filter.tags) && filter.tags.length > 0) {
      const lowerTags = new Set(meta.tags.map((t) => t.toLowerCase()));
      if (!filter.tags.every((t) => lowerTags.has(t.toLowerCase()))) continue;
    }

    items.push({
      person,
      relationshipStatus: meta.relationshipStatus,
      lastInteractionAt,
      nextFollowUpDate,
      currentCompanies,
      historicalCompaniesCount,
      openTasksCount: personTasks.length,
      tags: meta.tags,
    });
  }

  return { total: items.length, items };
}
