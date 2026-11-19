// Phase 14: Controlled, Privacy-Aware CRM Context Builder for AI Sales Agent
// Enforces strict private notes authorization: owner private notes are NEVER included
// unless includePrivateNotes === true is explicitly authorized by the owner.

import type {
  AiContextAudit,
  AiContextScope,
  AiEvidenceSource,
  CanonicalLead,
  CompanyRelationshipProfile,
  CrmInteraction,
  CrmOpportunity,
  CrmPrivateNote,
  IcpProfile,
  LeadTask,
  OwnerSalesGoals,
  PersonRelationshipProfile,
} from '../types.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import {
  listAllCrmInteractions,
  listAllCrmOpportunities,
  listAllCrmPrivateNotes,
  listAllExtendedTasks,
} from '../crm/crmStoreHelper.js';
import {
  buildCompanyRelationshipProfile,
  buildPersonRelationshipProfile,
} from '../crm/relationshipEngine.js';
import { evaluateCompanyDataQuality } from '../enrichment/dataQualityEngine.js';
import { getAiWorkspaceState } from './aiStoreHelper.js';

export interface AssembledAiContext {
  scope: AiContextScope;
  ownerGoals: OwnerSalesGoals;
  icpProfiles: IcpProfile[];
  companyProfile?: CompanyRelationshipProfile;
  personProfile?: PersonRelationshipProfile;
  opportunity?: CrmOpportunity;
  groupLeads?: CanonicalLead[];
  portfolioSummary?: {
    totalCompanies: number;
    totalPersons: number;
    openOpportunitiesCount: number;
    openTasksCount: number;
    recentInteractionsCount: number;
  };
  includedPrivateNotes: CrmPrivateNote[];
  evidenceSources: AiEvidenceSource[];
  contextAudit: AiContextAudit;
  promptContextText: string;
}

function safeExcerpt(text: string | undefined, maxLen = 220): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…` : cleaned;
}

export async function buildControlledAiContext(
  facade: CrmStorageFacade,
  scope: AiContextScope
): Promise<AssembledAiContext> {
  const includePrivateNotes = scope.includePrivateNotes === true;
  const ws = await getAiWorkspaceState(facade);
  const evidenceSources: AiEvidenceSource[] = [];

  let companyProfile: CompanyRelationshipProfile | undefined;
  let personProfile: PersonRelationshipProfile | undefined;
  let opportunity: CrmOpportunity | undefined;
  let groupLeads: CanonicalLead[] | undefined;
  let portfolioSummary: AssembledAiContext['portfolioSummary'];

  let rawPrivateNotes: CrmPrivateNote[] = [];
  let companiesCount = 0;
  let personsCount = 0;
  let interactionsCount = 0;
  let opportunitiesCount = 0;
  let tasksCount = 0;

  let effectiveLeadId = scope.leadId;

  // If opportunityId is provided, resolve its parent lead & person first
  if (scope.opportunityId) {
    const allOpps = await listAllCrmOpportunities(facade);
    opportunity = allOpps.find((o) => o.id === scope.opportunityId);
    if (opportunity && !effectiveLeadId) {
      effectiveLeadId = opportunity.leadId;
    }
  }

  if (scope.personId) {
    const pProf = await buildPersonRelationshipProfile(facade, scope.personId);
    if (pProf) {
      personProfile = pProf;
      personsCount += 1;
      interactionsCount += pProf.interactions.length;
      tasksCount += pProf.tasks.length;
      rawPrivateNotes.push(...pProf.privateNotes);

      if (!effectiveLeadId && pProf.currentCompanies[0]?.company?.id) {
        effectiveLeadId = pProf.currentCompanies[0].company.id;
      }

        const primaryRole =
          pProf.currentCompanies[0]?.relationship?.jobTitle ||
          pProf.currentCompanies[0]?.relationship?.designation ||
          pProf.person.decisionMakingFunction ||
          pProf.person.seniority;
        evidenceSources.push({
          id: `ev-person-${pProf.person.id}`,
          entityType: 'person',
          entityId: pProf.person.id,
          label: `Person: ${pProf.person.fullName}${primaryRole ? ` (${primaryRole})` : ''}`,
          classification:
            pProf.person.verificationStatus === 'officially_verified' ? 'verified_fact' : 'source_reported',
        excerpt: safeExcerpt(
          [
            pProf.person.email ? `Email: ${pProf.person.email} (${pProf.person.emailStatus || 'unverified'})` : undefined,
            pProf.person.linkedinUrl ? `LinkedIn: ${pProf.person.linkedinUrl}` : undefined,
            `Verification: ${pProf.person.verificationStatus}`,
          ]
            .filter(Boolean)
            .join(' · ')
        ),
        sourceUrl: pProf.person.officialBioUrl || pProf.person.linkedinUrl,
        timestamp: pProf.person.updatedAt,
      });
    }
  }

  if (effectiveLeadId) {
    const cProf = await buildCompanyRelationshipProfile(facade, effectiveLeadId);
    if (cProf) {
      companyProfile = cProf;
      companiesCount += 1;
      personsCount = Math.max(personsCount, cProf.decisionMakers.length);
      interactionsCount = Math.max(interactionsCount, cProf.interactions.length);
      opportunitiesCount = Math.max(opportunitiesCount, cProf.opportunities.length);
      tasksCount = Math.max(tasksCount, cProf.tasks.length);
      rawPrivateNotes.push(...cProf.privateNotes);

      const isRegistryVerified =
        cProf.enrichmentSummary.registryVerificationState === 'verified' ||
        cProf.lead.identifiers?.some((id) => id.verified);

      evidenceSources.push({
        id: `ev-company-${cProf.lead.id}`,
        entityType: 'company',
        entityId: cProf.lead.id,
        label: `Company CRM Record: ${cProf.lead.companyName}`,
        classification: isRegistryVerified ? 'verified_fact' : 'source_reported',
        excerpt: safeExcerpt(
          [
            cProf.lead.industry ? `Industry: ${cProf.lead.industry}` : undefined,
            cProf.lead.address?.country ? `Country: ${cProf.lead.address.country}` : undefined,
            cProf.lead.companyStatus ? `Status: ${cProf.lead.companyStatus}` : undefined,
            cProf.lead.website ? `Website: ${cProf.lead.website}` : undefined,
            cProf.lead.registrationNumber ? `Reg#: ${cProf.lead.registrationNumber}` : undefined,
          ]
            .filter(Boolean)
            .join(' · ')
        ),
        sourceUrl: cProf.lead.website,
        timestamp: cProf.lead.updatedAt,
      });

      if (cProf.lead.sources?.length) {
        for (const src of cProf.lead.sources.slice(0, 6)) {
          const sName = src.sourceName || 'External Source';
          const isRegistrySource =
            sName.toLowerCase().includes('registry') ||
            sName.toLowerCase().includes('house') ||
            sName.toLowerCase().includes('sec') ||
            sName.toLowerCase().includes('gleif') ||
            sName.toLowerCase().includes('sirene') ||
            sName.toLowerCase().includes('brreg');
          evidenceSources.push({
            id: `ev-src-${cProf.lead.id}-${sName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14)}`,
            entityType: isRegistrySource ? 'registry' : 'website',
            entityId: cProf.lead.id,
            label: `Source: ${sName}`,
            classification: isRegistrySource ? 'verified_fact' : 'source_reported',
            sourceUrl: src.url,
            timestamp: src.retrievedAt,
          });
        }
      }

      for (const dm of cProf.decisionMakers.slice(0, 8)) {
        if (!evidenceSources.some((e) => e.entityId === dm.person.id && e.entityType === 'person')) {
          evidenceSources.push({
            id: `ev-person-${dm.person.id}`,
            entityType: 'person',
            entityId: dm.person.id,
            label: `Decision-Maker: ${dm.person.fullName} (${dm.relationship.jobTitle || dm.relationship.designation || dm.relationship.relationshipType})`,
            classification: dm.person.verificationStatus === 'officially_verified' ? 'verified_fact' : 'source_reported',
            excerpt: safeExcerpt(
              `Status: ${dm.relationship.provenance?.employmentStatus || 'current'} · Confidence: ${dm.person.confidenceScore}%`
            ),
            sourceUrl: dm.person.officialBioUrl || dm.person.linkedinUrl,
            timestamp: dm.person.updatedAt,
          });
        }
      }

      for (const inter of cProf.interactions.slice(0, 8)) {
        evidenceSources.push({
          id: `ev-int-${inter.id}`,
          entityType: 'interaction',
          entityId: inter.id,
          label: `Interaction (${inter.type}) on ${inter.occurredAt.slice(0, 10)}`,
          classification: 'verified_fact',
          excerpt: safeExcerpt(`${inter.summary}${inter.outcome ? ` · Outcome: ${inter.outcome}` : ''}`),
          timestamp: inter.occurredAt,
        });
      }

      for (const opp of cProf.opportunities.slice(0, 6)) {
        evidenceSources.push({
          id: `ev-opp-${opp.id}`,
          entityType: 'opportunity',
          entityId: opp.id,
          label: `Opportunity: ${opp.title} (${opp.status})`,
          classification: 'verified_fact',
          excerpt: safeExcerpt(
            `Value: ${opp.currency} ${opp.estimatedValue} · Probability: ${opp.probability}%${opp.nextAction ? ` · Next: ${opp.nextAction}` : ''}`
          ),
          timestamp: opp.updatedAt,
        });
      }

      for (const task of cProf.tasks.slice(0, 6)) {
        evidenceSources.push({
          id: `ev-task-${task.id}`,
          entityType: 'task',
          entityId: task.id,
          label: `Task: ${task.title} (${task.status || (task.completed ? 'completed' : 'pending')})`,
          classification: 'verified_fact',
          excerpt: `Due: ${task.dueDate.slice(0, 10)} · Priority: ${task.priority}`,
          timestamp: task.updatedAt || task.createdAt,
        });
      }
    }
  } else if (scope.scopeType === 'group' && Array.isArray(scope.leadIds) && scope.leadIds.length > 0) {
    const allLeads = await facade.getLeads();
    const idSet = new Set(scope.leadIds);
    groupLeads = allLeads.filter((l) => idSet.has(l.id));
    companiesCount = groupLeads.length;
    for (const lead of groupLeads.slice(0, 10)) {
      evidenceSources.push({
        id: `ev-company-${lead.id}`,
        entityType: 'company',
        entityId: lead.id,
        label: `Company: ${lead.companyName}`,
        classification: lead.companyStatus === 'active' ? 'verified_fact' : 'source_reported',
        excerpt: `${lead.industry} · ${lead.address?.country || 'Unknown country'}`,
        timestamp: lead.updatedAt,
      });
    }
  } else {
    const [leads, persons, opps, tasks, interactions, allNotes] = await Promise.all([
      facade.getLeads(),
      facade.getPersons(),
      listAllCrmOpportunities(facade),
      listAllExtendedTasks(facade),
      listAllCrmInteractions(facade, { limit: 25 }),
      listAllCrmPrivateNotes(facade),
    ]);
    companiesCount = leads.length;
    personsCount = persons.length;
    opportunitiesCount = opps.length;
    tasksCount = tasks.length;
    interactionsCount = interactions.length;
    rawPrivateNotes = allNotes.slice(0, 15);
    portfolioSummary = {
      totalCompanies: leads.length,
      totalPersons: persons.length,
      openOpportunitiesCount: opps.filter((o) => o.status === 'open').length,
      openTasksCount: tasks.filter((t) => !t.completed && t.status !== 'completed' && t.status !== 'cancelled').length,
      recentInteractionsCount: interactions.length,
    };

    for (const lead of leads.slice(0, 8)) {
      evidenceSources.push({
        id: `ev-company-${lead.id}`,
        entityType: 'company',
        entityId: lead.id,
        label: `Company: ${lead.companyName}`,
        classification: 'source_reported',
        excerpt: `${lead.industry || 'Unknown industry'} · ${lead.address?.country || 'Unknown location'} · Confidence ${lead.confidenceScore}%`,
        timestamp: lead.updatedAt,
      });
    }
  }

  // Deduplicate rawPrivateNotes by ID
  const uniqueNotes = Array.from(new Map(rawPrivateNotes.map((n) => [n.id, n])).values());

  // STRICT PRIVACY ENFORCEMENT: Never include private notes unless explicitly opted in
  const includedPrivateNotes = includePrivateNotes ? uniqueNotes.slice(0, 12) : [];
  const privateNotesRedactedCount = includePrivateNotes ? 0 : uniqueNotes.length;

  if (includePrivateNotes) {
    for (const note of includedPrivateNotes) {
      evidenceSources.push({
        id: `ev-note-${note.id}`,
        entityType: 'private_note',
        entityId: note.id,
        label: `Owner Private Note: ${note.title || note.category}`,
        classification: 'verified_fact',
        excerpt: safeExcerpt(note.content, 160),
        timestamp: note.updatedAt,
      });
    }
  }

  const contextAudit: AiContextAudit = {
    scopeType: scope.scopeType,
    includedEntities: {
      companies: companiesCount,
      persons: personsCount,
      interactions: interactionsCount,
      opportunities: opportunitiesCount,
      tasks: tasksCount,
      privateNotesIncluded: includedPrivateNotes.length,
      privateNotesRedactedCount,
    },
    privateNotesAuthorized: includePrivateNotes,
    privateNotesNotice: includePrivateNotes
      ? `Owner explicitly authorized ${includedPrivateNotes.length} private note(s) for this request.`
      : privateNotesRedactedCount > 0
        ? `${privateNotesRedactedCount} owner-only private note(s) were withheld from AI context (opt-in disabled).`
        : 'Owner private notes are excluded by default unless explicitly authorized.',
  };

  // Build concise, grounded prompt context string (no secrets, no unauthorized private notes)
  const lines: string[] = [];
  lines.push('=== GROUNDING RULES ===');
  lines.push(
    'Only cite facts present in the LEED CRM context below. Never invent revenue, employee headcount, market share, prior conversations, referrals, or contact details. Explicitly label unknowns as missing.'
  );

  if (ws.ownerSalesGoals.businessName || ws.ownerSalesGoals.valueProposition) {
    lines.push('\n=== OWNER SALES CONTEXT ===');
    if (ws.ownerSalesGoals.businessName) lines.push(`Owner Business: ${ws.ownerSalesGoals.businessName}`);
    if (ws.ownerSalesGoals.valueProposition) lines.push(`Value Proposition: ${ws.ownerSalesGoals.valueProposition}`);
    if (ws.ownerSalesGoals.productsAndServices.length) {
      lines.push(`Offerings: ${ws.ownerSalesGoals.productsAndServices.join(', ')}`);
    }
    if (ws.ownerSalesGoals.salesPriorities.length) {
      lines.push(`Priorities: ${ws.ownerSalesGoals.salesPriorities.join('; ')}`);
    }
  }

  if (companyProfile) {
    const l = companyProfile.lead;
    const dq = evaluateCompanyDataQuality(l, { linkedPersonsCount: companyProfile.decisionMakers.length });
    lines.push('\n=== TARGET COMPANY RECORD ===');
    lines.push(`Name: ${l.companyName} (ID: ${l.id})`);
    if (l.legalName) lines.push(`Legal Name: ${l.legalName}`);
    lines.push(`Industry: ${l.industry || 'Unknown'}`);
    lines.push(`Status: ${l.companyStatus || 'unknown'} | Registry Verification: ${companyProfile.enrichmentSummary.registryVerificationState}`);
    lines.push(`Location: ${l.address?.formattedAddress || [l.address?.city, l.address?.country].filter(Boolean).join(', ') || 'Unknown'}`);
    if (l.website) lines.push(`Website: ${l.website}`);
    if (l.registrationNumber) lines.push(`Registration Number: ${l.registrationNumber}`);
    if (l.webMetadata?.description) lines.push(`Description: ${safeExcerpt(l.webMetadata.description, 450)}`);
    lines.push(`Data Quality: ${dq.overallScore}/100 (Grade ${dq.grade}) | Confidence: ${l.confidenceScore}%`);
    lines.push(`Relationship Status: ${companyProfile.relationshipMeta.relationshipStatus} | Engagement: ${companyProfile.engagement.score}/100 (${companyProfile.engagement.effectiveLevel}, derived)`);

    if (companyProfile.decisionMakers.length > 0) {
      lines.push('\nLinked Decision-Makers:');
      for (const dm of companyProfile.decisionMakers.slice(0, 8)) {
        lines.push(
          `- ${dm.person.fullName} | Title: ${dm.relationship.jobTitle || dm.relationship.designation || dm.relationship.relationshipType} | Employment: ${dm.relationship.provenance?.employmentStatus || 'current'} | Verification: ${dm.person.verificationStatus} | Email: ${dm.person.email ? `${dm.person.email} (${dm.person.emailStatus || 'unverified'})` : 'unavailable'}`
        );
      }
    } else {
      lines.push('Linked Decision-Makers: None recorded in LEED.');
    }

    if (companyProfile.interactions.length > 0) {
      lines.push('\nRecorded Interactions (newest first):');
      for (const inter of companyProfile.interactions.slice(0, 8)) {
        lines.push(
          `- [${inter.occurredAt.slice(0, 10)}] (${inter.type}) ${inter.summary}${inter.outcome ? ` | Outcome: ${inter.outcome}` : ''}${inter.nextAction ? ` | Next: ${inter.nextAction}` : ''}`
        );
      }
    } else {
      lines.push('\nRecorded Interactions: None recorded in LEED (do NOT fabricate prior calls or emails).');
    }

    if (companyProfile.opportunities.length > 0) {
      lines.push('\nOpportunities:');
      for (const opp of companyProfile.opportunities.slice(0, 6)) {
        lines.push(
          `- ${opp.title} | Status: ${opp.status} | Value: ${opp.currency} ${opp.estimatedValue} | Prob: ${opp.probability}% | Stage: ${opp.pipelineStageId}${opp.nextAction ? ` | Next: ${opp.nextAction}` : ''}`
        );
      }
    }

    if (companyProfile.tasks.length > 0) {
      lines.push('\nTasks:');
      for (const t of companyProfile.tasks.slice(0, 6)) {
        lines.push(`- [${t.status || (t.completed ? 'completed' : 'pending')}] ${t.title} (Due: ${t.dueDate.slice(0, 10)}, Priority: ${t.priority})`);
      }
    }
  }

  if (personProfile) {
    const p = personProfile.person;
    lines.push('\n=== TARGET PERSON RECORD ===');
    lines.push(`Full Name: ${p.fullName} (ID: ${p.id})`);
    const primaryRel = personProfile.currentCompanies[0]?.relationship;
    if (primaryRel?.jobTitle || primaryRel?.designation) lines.push(`Job Title: ${primaryRel.jobTitle || primaryRel.designation}`);
    if (primaryRel?.department) lines.push(`Department: ${primaryRel.department}`);
    if (p.seniority) lines.push(`Seniority: ${p.seniority}`);
    if (p.decisionMakingFunction) lines.push(`Function: ${p.decisionMakingFunction}`);
    lines.push(`Verification Status: ${p.verificationStatus} | Confidence: ${p.confidenceScore}%`);
    lines.push(`Email: ${p.email ? `${p.email} (${p.emailStatus || 'unverified'})` : 'unavailable'}`);
    if (personProfile.currentCompanies.length > 0) {
      lines.push(
        `Current Companies: ${personProfile.currentCompanies.map((c) => `${c.company?.companyName || c.relationship.leadId} (${c.relationship.jobTitle || c.relationship.designation || c.relationship.relationshipType})`).join('; ')}`
      );
    }
    if (personProfile.historicalCompanies.length > 0) {
      lines.push(
        `Historical Companies: ${personProfile.historicalCompanies.map((c) => `${c.company?.companyName || c.relationship.leadId} (${c.relationship.jobTitle || c.relationship.designation || c.relationship.relationshipType})`).join('; ')}`
      );
    }
  }

  if (opportunity) {
    lines.push('\n=== TARGET OPPORTUNITY ===');
    lines.push(
      `${opportunity.title} | Status: ${opportunity.status} | Value: ${opportunity.currency} ${opportunity.estimatedValue} | Probability: ${opportunity.probability}% | Expected Close: ${opportunity.expectedCloseDate?.slice(0, 10) || 'Unset'}`
    );
    if (opportunity.description) lines.push(`Description: ${safeExcerpt(opportunity.description, 350)}`);
    if (opportunity.nextAction) lines.push(`Next Action: ${opportunity.nextAction}`);
  }

  if (portfolioSummary) {
    lines.push('\n=== PORTFOLIO SNAPSHOT ===');
    lines.push(
      `Companies: ${portfolioSummary.totalCompanies} | Decision-Makers: ${portfolioSummary.totalPersons} | Open Opportunities: ${portfolioSummary.openOpportunitiesCount} | Open Tasks: ${portfolioSummary.openTasksCount} | Recent Interactions: ${portfolioSummary.recentInteractionsCount}`
    );
  }

  if (includePrivateNotes && includedPrivateNotes.length > 0) {
    lines.push('\n=== OWNER PRIVATE NOTES (EXPLICITLY AUTHORIZED) ===');
    for (const note of includedPrivateNotes) {
      lines.push(`- [${note.category}] ${note.title ? `${note.title}: ` : ''}${safeExcerpt(note.content, 300)}`);
    }
  }

  return {
    scope: { ...scope, includePrivateNotes },
    ownerGoals: ws.ownerSalesGoals,
    icpProfiles: ws.icpProfiles,
    companyProfile,
    personProfile,
    opportunity,
    groupLeads,
    portfolioSummary,
    includedPrivateNotes,
    evidenceSources,
    contextAudit,
    promptContextText: lines.join('\n'),
  };
}
