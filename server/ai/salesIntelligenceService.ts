// Phase 14: AI Sales Intelligence, Briefing, Meeting Prep, Drafting, Conversational Agent,
// and Owner-Approved CRM Action Execution Service.
// Strictly evidence-grounded: separates Verified Facts, Source-Reported Facts, AI Analysis,
// Hypotheses, and Unknown Information. Zero silent CRM writes; zero automated message sending.

import {
  AI_DRAFT_TYPES,
  AI_DRAFT_TYPE_SET,
} from '../../shared/aiAgentSpecs.js';
import type {
  AiActionProposal,
  AiAgentConversation,
  AiAgentMessage,
  AiClaimItem,
  AiCommunicationDraft,
  AiContextScope,
  AiDraftTone,
  AiDraftType,
  AiEvidenceSource,
  AiToolExecutionRecord,
  CompanySalesIntelligenceReport,
  CrmInteractionType,
  CrmRelationshipStatus,
  DailySalesBriefing,
  IcpMatchResult,
  MeetingPreparationReport,
} from '../types.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import {
  createCrmInteraction,
  createCrmOpportunity,
  createExtendedTask,
  getEntityInteractions,
  getLeadOpportunities,
  listAllCrmOpportunities,
  updateCompanyRelationshipMeta,
  updateCrmOpportunity,
  updatePersonRelationshipMeta,
} from '../crm/crmStoreHelper.js';
import { buildCrmDashboardSummary } from '../crm/crmDashboardService.js';
import { buildReminderCenter } from '../crm/reminderEngine.js';
import { evaluateCompanyDataQuality } from '../enrichment/dataQualityEngine.js';
import {
  generateAgentTextWithAi,
  generateStructuredJsonWithAi,
} from './aiProvider.js';
import {
  addAiActionProposals,
  createAiConversation,
  generateAiId,
  getAiWorkspaceState,
  listAiConversations,
  listIcpProfiles,
  recordSavedReportSummary,
  saveAiConversation,
  saveCommunicationDraft,
  updateAiActionProposal,
} from './aiStoreHelper.js';
import { buildControlledAiContext } from './contextBuilder.js';
import { evaluateCompanyAgainstIcp } from './icpEngine.js';
import { prioritizeCrmLeads, scoreLeadPriority } from './prioritizationEngine.js';
import { executeControlledAgentTool } from './agentTools.js';

const ANTI_HALLUCINATION_SYSTEM_INSTRUCTION = `You are the LEED AI Sales Agent assisting the sole owner of a B2B sales intelligence and personal CRM platform.
STRICT RULES:
1. Ground every factual claim strictly in the provided LEED CRM records and tool outputs.
2. NEVER invent annual revenue, employee counts, funding, market share, growth percentages, prior conversations, mutual referrals, or unrecorded contact details.
3. Explicitly distinguish between: Verified Facts, Source-Reported Facts, AI Analysis, Hypotheses, and Unknown Information.
4. Never claim that an email, LinkedIn message, or WhatsApp message was sent or scheduled—all communications are draft_only.
5. Never claim that CRM records were automatically modified—all write recommendations require explicit owner approval.
6. Be concise, executive, and actionable.`;

// ============================================================================
// 1. COMPANY SALES INTELLIGENCE REPORT
// ============================================================================

export async function generateCompanySalesIntelligence(
  facade: CrmStorageFacade,
  params: {
    leadId: string;
    icpId?: string;
    includePrivateNotes?: boolean;
  }
): Promise<CompanySalesIntelligenceReport> {
  const ctx = await buildControlledAiContext(facade, {
    scopeType: 'company',
    leadId: params.leadId,
    includePrivateNotes: params.includePrivateNotes === true,
  });

  if (!ctx.companyProfile) {
    throw new Error('Company lead not found.');
  }

  const profile = ctx.companyProfile;
  const lead = profile.lead;
  const dq = evaluateCompanyDataQuality(lead, { linkedPersonsCount: profile.decisionMakers.length });

  const icps = await listIcpProfiles(facade);
  const selectedIcp = params.icpId
    ? icps.find((p) => p.id === params.icpId)
    : icps.find((p) => p.isDefault) || icps[0];

  const { assessment: priorityAssessment, icpMatch } = scoreLeadPriority({
    lead,
    decisionMakers: profile.decisionMakers,
    interactions: profile.interactions,
    tasks: profile.tasks,
    opportunities: profile.opportunities,
    icp: selectedIcp,
  });

  // --- Deterministic Fact Separation ---
  const companyEvId = `ev-company-${lead.id}`;
  const verifiedFacts: AiClaimItem[] = [];
  const sourceReportedFacts: AiClaimItem[] = [];
  const unknownInformation: string[] = [];

  const isRegistryVerified =
    profile.enrichmentSummary.registryVerificationState === 'verified' ||
    Boolean(lead.identifiers?.some((i) => i.verified));

  if (isRegistryVerified) {
    verifiedFacts.push({
      statement: `${lead.legalName || lead.companyName} is officially verified in registry records${lead.registrationNumber ? ` (Registration #: ${lead.registrationNumber})` : ''} with status "${lead.companyStatus || 'active'}".`,
      classification: 'verified_fact',
      evidenceRefIds: [companyEvId],
      confidence: 95,
    });
  } else if (lead.registrationNumber) {
    sourceReportedFacts.push({
      statement: `Registration identifier ${lead.registrationNumber} is recorded, though official registry verification is currently "${profile.enrichmentSummary.registryVerificationState}".`,
      classification: 'source_reported',
      evidenceRefIds: [companyEvId],
      confidence: 70,
    });
  } else {
    unknownInformation.push('Official company registration number and legal registry verification status are not yet confirmed.');
  }

  if (lead.address?.country || lead.address?.city) {
    const loc = lead.address.formattedAddress || [lead.address.city, lead.address.country].filter(Boolean).join(', ');
    (isRegistryVerified ? verifiedFacts : sourceReportedFacts).push({
      statement: `Recorded business location: ${loc}.`,
      classification: isRegistryVerified ? 'verified_fact' : 'source_reported',
      evidenceRefIds: [companyEvId],
    });
  } else {
    unknownInformation.push('Registered business address / operating country is missing.');
  }

  if (lead.industry) {
    sourceReportedFacts.push({
      statement: `Listed industry classification: ${lead.industry}${lead.category ? ` (${lead.category})` : ''}.`,
      classification: 'source_reported',
      evidenceRefIds: [companyEvId],
    });
  } else {
    unknownInformation.push('Industry sector is not specified.');
  }

  if (lead.website) {
    sourceReportedFacts.push({
      statement: `Official website on file: ${lead.website}${lead.webMetadata?.title ? ` ("${lead.webMetadata.title}")` : ''}.`,
      classification: 'source_reported',
      evidenceRefIds: [companyEvId],
    });
  } else {
    unknownInformation.push('Official company website has not been recorded.');
  }

  if (lead.email) {
    (lead.emailStatus === 'verified' ? verifiedFacts : sourceReportedFacts).push({
      statement: `Company email on file: ${lead.email} (status: ${lead.emailStatus || 'unverified'}).`,
      classification: lead.emailStatus === 'verified' ? 'verified_fact' : 'source_reported',
      evidenceRefIds: [companyEvId],
    });
  } else {
    unknownInformation.push('Direct company contact email is missing.');
  }

  if (lead.phone) {
    sourceReportedFacts.push({
      statement: `Company phone on file: ${lead.phone}.`,
      classification: 'source_reported',
      evidenceRefIds: [companyEvId],
    });
  } else {
    unknownInformation.push('Company telephone number is missing.');
  }

  // Always explicitly disclose absence of unrecorded firmographics rather than guessing
  if (!lead.customFields?.annualRevenue && !lead.customFields?.revenue) {
    unknownInformation.push('Annual revenue and financial scale are not recorded in LEED.');
  }
  if (!lead.customFields?.employeeCount && !lead.customFields?.employeeRange) {
    unknownInformation.push('Employee headcount / team size is not recorded in LEED.');
  }

  if (profile.decisionMakers.length > 0) {
    verifiedFacts.push({
      statement: `${profile.decisionMakers.length} decision-maker(s) linked in LEED: ${profile.decisionMakers
        .slice(0, 4)
        .map((d) => `${d.person.fullName} (${d.relationship.jobTitle || d.relationship.designation || d.relationship.relationshipType})`)
        .join(', ')}.`,
      classification: 'verified_fact',
      evidenceRefIds: profile.decisionMakers.slice(0, 4).map((d) => `ev-person-${d.person.id}`),
    });
  } else {
    unknownInformation.push('No verified decision-makers or executives are currently linked to this company.');
  }

  if (profile.interactions.length > 0) {
    verifiedFacts.push({
      statement: `${profile.interactions.length} CRM interaction(s) recorded; latest on ${profile.interactions[0].occurredAt.slice(0, 10)}: "${profile.interactions[0].summary}".`,
      classification: 'verified_fact',
      evidenceRefIds: [`ev-int-${profile.interactions[0].id}`],
    });
  } else {
    unknownInformation.push('No prior sales interactions have been logged with this company yet.');
  }

  if (profile.opportunities.length > 0) {
    verifiedFacts.push({
      statement: `${profile.opportunities.length} tracked opportunity(ies): ${profile.opportunities
        .slice(0, 3)
        .map((o) => `${o.title} (${o.status}, ${o.currency} ${o.estimatedValue})`)
        .join('; ')}.`,
      classification: 'verified_fact',
      evidenceRefIds: profile.opportunities.slice(0, 3).map((o) => `ev-opp-${o.id}`),
    });
  }

  // --- Optional AI Synthesis (with guaranteed deterministic fallback) ---
  interface AiCompanyIntelPayload {
    executiveSummary: string;
    businessModelOverview: string;
    aiAnalysis: string[];
    hypotheses: string[];
    recommendedOutreachStrategy: string;
    recommendedAngles: string[];
    risksAndGaps: string[];
    recommendedNextSteps: string[];
  }

  const aiResult = await generateStructuredJsonWithAi<AiCompanyIntelPayload>({
    systemInstruction: ANTI_HALLUCINATION_SYSTEM_INSTRUCTION,
    prompt: `Produce a structured Company Sales Intelligence Report strictly from the LEED context below.
Never invent metrics, headcount, revenue, or past conversations.

${ctx.promptContextText}

Computed Priority Score: ${priorityAssessment.priorityScore}/100 (${priorityAssessment.priorityTier})
${icpMatch ? `Computed ICP Match (${icpMatch.icpName}): ${icpMatch.overallScore}/100 (${icpMatch.fitLabel})` : 'No ICP configured.'}
Data Quality: ${dq.overallScore}/100 (Grade ${dq.grade})

Return ONLY JSON:
{
  "executiveSummary": "2-3 sentence grounded executive summary",
  "businessModelOverview": "Concise overview strictly from description/industry/website metadata; state clearly if limited",
  "aiAnalysis": ["2-4 analytical takeaways derived strictly from the CRM records"],
  "hypotheses": ["2-3 clearly framed hypotheses to test during discovery"],
  "recommendedOutreachStrategy": "Concrete channel and positioning strategy",
  "recommendedAngles": ["2-3 business value angles tied to owner goals and company sector"],
  "risksAndGaps": ["2-3 concrete risks or missing data gaps"],
  "recommendedNextSteps": ["2-4 prioritized next actions"]
}`,
  });

  const aiData = aiResult.data;
  const fallbackBusinessModel = lead.webMetadata?.description
    ? `Based on recorded source metadata, ${lead.companyName} operates in ${lead.industry || 'its registered sector'}: ${lead.webMetadata.description.slice(0, 260)}.`
    : `Limited business model detail is stored in LEED beyond industry "${lead.industry || 'Unknown'}"${lead.category ? ` (${lead.category})` : ''}. Inspect the company website or enrich the profile before deep pitching.`;

  const aiAnalysisItems: AiClaimItem[] = (
    aiData?.aiAnalysis?.length
      ? aiData.aiAnalysis
      : [
          `Lead priority is ${priorityAssessment.priorityScore}/100 (${priorityAssessment.priorityTier}) based on data quality (${dq.overallScore}/100), ${profile.decisionMakers.length} linked contact(s), and ${profile.interactions.length} recorded interaction(s).`,
          icpMatch
            ? `ICP evaluation against "${icpMatch.icpName}" scored ${icpMatch.overallScore}/100 (${icpMatch.fitLabel.replace('_', ' ')}).`
            : 'No default ICP profile is active; configuring an ICP will sharpen account qualification.',
          profile.interactions.length === 0
            ? 'This is a cold/uncontacted account in LEED; outreach should focus on relevance and low-friction discovery.'
            : `Relationship engagement is derived at ${profile.engagement.score}/100 (${profile.engagement.effectiveLevel}).`,
        ]
  ).map((statement) => ({
    statement,
    classification: 'ai_analysis' as const,
    evidenceRefIds: [companyEvId],
  }));

  const hypothesisItems: AiClaimItem[] = (
    aiData?.hypotheses?.length
      ? aiData.hypotheses
      : [
          `As a ${lead.industry || 'B2B'} business in ${lead.address?.country || 'its region'}, ${lead.companyName} may value streamlined operations, supplier reliability, or market intelligence aligned with ${ctx.ownerGoals.valueProposition || 'your core offering'}.`,
          profile.decisionMakers.length > 0
            ? `${profile.decisionMakers[0].person.fullName} (${profile.decisionMakers[0].relationship.jobTitle || profile.decisionMakers[0].relationship.designation || profile.decisionMakers[0].relationship.relationshipType || 'listed contact'}) is likely the best initial entry point to validate buying authority.`
            : 'Identifying a founder, director, or operations lead will materially increase reply probability.',
        ]
  ).map((statement) => ({
    statement,
    classification: 'hypothesis' as const,
    evidenceRefIds: [companyEvId],
  }));

  const reportId = generateAiId('intel');

  // Propose concrete CRM actions (strictly pending_approval — zero silent mutations)
  const proposals: AiActionProposal[] = [];
  if (profile.decisionMakers.length === 0) {
    proposals.push({
      id: generateAiId('actprop'),
      actionType: 'research_company',
      title: `Identify key decision-makers at ${lead.companyName}`,
      rationale: 'No decision-makers are currently linked to this company in LEED.',
      status: 'pending_approval',
      affectedEntity: { entityType: 'company', entityId: lead.id, entityName: lead.companyName },
      proposedChanges: {
        taskTitle: `Discover decision-makers for ${lead.companyName}`,
        category: 'research',
        priority: priorityAssessment.priorityScore >= 62 ? 'high' : 'medium',
        dueInDays: 2,
      },
      evidenceRefIds: [companyEvId],
      sourceReportId: reportId,
      createdAt: new Date().toISOString(),
    });
  } else if (dq.overallScore < 65) {
    proposals.push({
      id: generateAiId('actprop'),
      actionType: 'enrich_company',
      title: `Enrich & verify missing fields for ${lead.companyName}`,
      rationale: `Data quality score is ${dq.overallScore}/100 (Grade ${dq.grade}); verifying missing fields will improve outreach accuracy.`,
      status: 'pending_approval',
      affectedEntity: { entityType: 'company', entityId: lead.id, entityName: lead.companyName },
      proposedChanges: {
        taskTitle: `Run enrichment & contact verification for ${lead.companyName}`,
        category: 'verification',
        priority: 'medium',
        dueInDays: 3,
      },
      evidenceRefIds: [companyEvId],
      sourceReportId: reportId,
      createdAt: new Date().toISOString(),
    });
  } else {
    const primaryDm = profile.decisionMakers[0];
    proposals.push({
      id: generateAiId('actprop'),
      actionType: 'create_task',
      title: `Follow up with ${primaryDm?.person.fullName || lead.companyName}`,
      rationale: priorityAssessment.recommendedNextAction,
      status: 'pending_approval',
      affectedEntity: { entityType: 'company', entityId: lead.id, entityName: lead.companyName },
      proposedChanges: {
        taskTitle: priorityAssessment.recommendedNextAction,
        personId: primaryDm?.person.id,
        category: 'follow_up',
        priority: priorityAssessment.priorityScore >= 70 ? 'high' : 'medium',
        dueInDays: 2,
      },
      evidenceRefIds: [companyEvId],
      sourceReportId: reportId,
      createdAt: new Date().toISOString(),
    });
  }

  await addAiActionProposals(facade, proposals);

  const report: CompanySalesIntelligenceReport = {
    id: reportId,
    leadId: lead.id,
    companyName: lead.companyName,
    generatedAt: new Date().toISOString(),
    aiStatus: aiResult.meta,
    executiveSummary:
      aiData?.executiveSummary ||
      `${lead.companyName} (${lead.industry || 'Unknown industry'}, ${lead.address?.country || 'Unknown country'}) holds a derived priority score of ${priorityAssessment.priorityScore}/100 (${priorityAssessment.priorityTier}) with data quality ${dq.overallScore}/100 (Grade ${dq.grade}). ${profile.decisionMakers.length} decision-maker(s) and ${profile.interactions.length} prior interaction(s) are recorded in LEED.`,
    verifiedFacts,
    sourceReportedFacts,
    aiAnalysis: aiAnalysisItems,
    hypotheses: hypothesisItems,
    unknownInformation,
    businessModelOverview: aiData?.businessModelOverview || fallbackBusinessModel,
    decisionMakersSummary: profile.decisionMakers.map((d) => ({
      personId: d.person.id,
      fullName: d.person.fullName,
      jobTitle: d.relationship.jobTitle || d.relationship.designation,
      relationshipType: d.relationship.relationshipType,
      isPrimaryContact: d.relationship.isPrimaryContact,
      verificationStatus: d.person.verificationStatus,
      contactAvailability:
        [
          d.person.email ? `Email (${d.person.emailStatus || 'unverified'})` : null,
          d.person.phone ? 'Phone' : null,
          d.person.linkedinUrl ? 'LinkedIn' : null,
        ]
          .filter(Boolean)
          .join(', ') || 'No direct contact info recorded',
    })),
    icpFit: icpMatch,
    priorityAssessment,
    recommendedOutreachStrategy:
      aiData?.recommendedOutreachStrategy || priorityAssessment.recommendedNextAction,
    recommendedAngles:
      aiData?.recommendedAngles?.length
        ? aiData.recommendedAngles
        : [
            `Sector-relevant positioning for ${lead.industry || 'their operations'} in ${lead.address?.country || 'their region'}.`,
            ctx.ownerGoals.valueProposition
              ? `Direct alignment with owner value proposition: ${ctx.ownerGoals.valueProposition.slice(0, 140)}.`
              : 'Low-friction exploratory conversation to confirm current operational priorities.',
          ],
    risksAndGaps:
      aiData?.risksAndGaps?.length
        ? aiData.risksAndGaps
        : unknownInformation.slice(0, 3),
    recommendedNextSteps:
      aiData?.recommendedNextSteps?.length
        ? aiData.recommendedNextSteps
        : [
            priorityAssessment.recommendedNextAction,
            profile.decisionMakers.length > 0
              ? `Prepare a tailored draft message for ${profile.decisionMakers[0].person.fullName}.`
              : 'Run Decision-Maker Discovery on this company.',
            'Log all outreach outcomes in Personal CRM to keep relationship history accurate.',
          ],
    evidenceSources: ctx.evidenceSources,
    contextAudit: ctx.contextAudit,
    proposedActions: proposals,
  };

  await recordSavedReportSummary(facade, {
    id: report.id,
    reportType: 'company_intelligence',
    leadId: lead.id,
    title: `Company Sales Intelligence: ${lead.companyName}`,
    createdAt: report.generatedAt,
    summary: report.executiveSummary.slice(0, 220),
  });

  return report;
}

// ============================================================================
// 2. MEETING PREPARATION INTELLIGENCE
// ============================================================================

export async function generateMeetingPreparation(
  facade: CrmStorageFacade,
  params: {
    leadId?: string;
    personId?: string;
    opportunityId?: string;
    meetingGoal?: string;
    includePrivateNotes?: boolean;
  }
): Promise<MeetingPreparationReport> {
  if (!params.leadId && !params.personId && !params.opportunityId) {
    throw new Error('Provide at least one of leadId, personId, or opportunityId for meeting preparation.');
  }

  const ctx = await buildControlledAiContext(facade, {
    scopeType: params.opportunityId ? 'opportunity' : params.personId ? 'person' : 'company',
    leadId: params.leadId,
    personId: params.personId,
    opportunityId: params.opportunityId,
    includePrivateNotes: params.includePrivateNotes === true,
  });

  const company = ctx.companyProfile?.lead;
  const person = ctx.personProfile?.person;
  const opp = ctx.opportunity || ctx.companyProfile?.opportunities.find((o) => o.status === 'open');

  if (!company && !person) {
    throw new Error('Target company or person record not found in LEED.');
  }

  const interactions = (
    ctx.personProfile?.interactions.length
      ? ctx.personProfile.interactions
      : ctx.companyProfile?.interactions || []
  ).slice(0, 8);

  const openTasks = (
    ctx.personProfile?.tasks.length
      ? ctx.personProfile.tasks
      : ctx.companyProfile?.tasks || []
  )
    .filter((t) => !t.completed && t.status !== 'completed' && t.status !== 'cancelled')
    .slice(0, 8);

  const unknownsToVerify: string[] = [];
  if (!company?.webMetadata?.description) unknownsToVerify.push('Current strategic priorities and primary operational initiatives.');
  unknownsToVerify.push('Decision-making process, budget ownership, and evaluation timeline (not stored in LEED).');
  if (!opp) unknownsToVerify.push('Whether an active commercial project or vendor evaluation is currently underway.');
  if (interactions.length === 0) {
    unknownsToVerify.push('No prior recorded conversation exists in LEED—confirm stakeholder background and awareness.');
  }

  interface AiMeetingPrepPayload {
    suggestedObjectives: string[];
    keyDiscussionTopics: string[];
    strategicQuestions: string[];
    likelyObjections: Array<{ objection: string; suggestedResponse: string }>;
    recommendedOutcome: string;
    followUpSuggestions: string[];
  }

  const aiResult = await generateStructuredJsonWithAi<AiMeetingPrepPayload>({
    systemInstruction: ANTI_HALLUCINATION_SYSTEM_INSTRUCTION,
    prompt: `Prepare a grounded Meeting Preparation Brief strictly from the LEED context below.
CRITICAL: If Recorded Interactions is empty, DO NOT invent or imply any prior calls, emails, or commitments.

${ctx.promptContextText}

Owner's stated meeting goal: ${params.meetingGoal || 'Initial discovery and qualification'}

Return ONLY JSON:
{
  "suggestedObjectives": ["2-3 concrete meeting objectives"],
  "keyDiscussionTopics": ["3-4 grounded discussion topics"],
  "strategicQuestions": ["3-5 sharp discovery questions"],
  "likelyObjections": [
    { "objection": "realistic buyer concern", "suggestedResponse": "evidence-based consultative response" }
  ],
  "recommendedOutcome": "Specific desired agreement or next step by the end of the meeting",
  "followUpSuggestions": ["2-3 post-meeting actions to log in CRM"]
}`,
  });

  const aiData = aiResult.data;
  const subjectName = person
    ? `${person.fullName}${company ? ` (${company.companyName})` : ''}`
    : company?.companyName || 'Target Account';

  const report: MeetingPreparationReport = {
    id: generateAiId('mprep'),
    leadId: company?.id,
    personId: person?.id,
    opportunityId: opp?.id,
    meetingTitle: `Meeting Preparation: ${subjectName}`,
    meetingGoal: params.meetingGoal?.trim() || undefined,
    generatedAt: new Date().toISOString(),
    aiStatus: aiResult.meta,
    companySummary: company
      ? `${company.companyName} (${company.industry || 'Unknown industry'}, ${company.address?.country || 'Unknown location'}) · Status: ${company.companyStatus || 'unknown'} · Relationship: ${ctx.companyProfile?.relationshipMeta.relationshipStatus || 'new'}.`
      : 'No linked company record on file.',
    personSummary: person
      ? `${person.fullName}${ctx.personProfile?.currentCompanies[0]?.relationship?.jobTitle ? `, ${ctx.personProfile.currentCompanies[0].relationship.jobTitle}` : person.seniority ? `, ${person.seniority}` : ''} · Verification: ${person.verificationStatus} · ${person.email ? `Email: ${person.email}` : 'Email unrecorded'}.`
      : undefined,
    opportunitySummary: opp
      ? `${opp.title} · Status: ${opp.status} · Value: ${opp.currency} ${opp.estimatedValue.toLocaleString()} · Probability: ${opp.probability}%${opp.nextAction ? ` · Next Action: ${opp.nextAction}` : ''}.`
      : undefined,
    relationshipHistorySummary:
      interactions.length > 0
        ? `${interactions.length} recorded interaction(s) on file. Most recent: [${interactions[0].occurredAt.slice(0, 10)}] (${interactions[0].type}) ${interactions[0].summary}.`
        : 'No previous interactions are recorded in LEED for this contact or company. Treat this as a first documented conversation.',
    previousInteractions: interactions.map((i) => ({
      id: i.id,
      type: i.type,
      occurredAt: i.occurredAt,
      summary: i.summary,
      outcome: i.outcome,
      nextAction: i.nextAction,
    })),
    openTasks: openTasks.map((t) => ({
      id: t.id,
      title: t.title,
      dueDate: t.dueDate,
      priority: t.priority,
      status: t.status,
    })),
    suggestedObjectives:
      aiData?.suggestedObjectives?.length
        ? aiData.suggestedObjectives
        : [
            params.meetingGoal?.trim() || `Establish clear alignment on ${company?.companyName || subjectName}'s current priorities.`,
            'Confirm buying stakeholders, decision criteria, and realistic timeline.',
            'Agree on a concrete next step with an explicit follow-up date.',
          ],
    keyDiscussionTopics:
      aiData?.keyDiscussionTopics?.length
        ? aiData.keyDiscussionTopics
        : [
            `Current ${company?.industry || 'business'} priorities and operational bottlenecks.`,
            opp
              ? `Scope, timing, and success metrics for "${opp.title}".`
              : `Potential areas where ${ctx.ownerGoals.businessName || 'your business'} can create measurable value.`,
            interactions.length > 0
              ? `Follow-up on last recorded discussion: "${interactions[0].summary}".`
              : 'Mutual introductions and baseline qualification.',
          ],
    strategicQuestions:
      aiData?.strategicQuestions?.length
        ? aiData.strategicQuestions
        : [
            `What are the top 1–2 priorities for ${company?.companyName || 'your team'} over the next two quarters?`,
            'How are you currently handling this workflow, and where does friction appear most often?',
            'Who else should be involved if we explore a pilot or commercial proposal?',
            'What would make a follow-up session genuinely worth your time?',
          ],
    likelyObjections: (
      aiData?.likelyObjections?.length
        ? aiData.likelyObjections
        : [
            {
              objection: 'We already have an existing vendor or internal process.',
              suggestedResponse:
                'Acknowledge the current setup and ask where small gaps or reporting blind spots still exist—position as a focused complement rather than a disruptive replacement.',
            },
            {
              objection: 'Timing is tight this quarter.',
              suggestedResponse:
                'Clarify when planning cycles reopen and ask permission to schedule a concrete follow-up review date in LEED.',
            },
          ]
    ).map((o) => ({
      objection: o.objection,
      suggestedResponse: o.suggestedResponse,
      classification: 'hypothesis' as const,
    })),
    unknownsToVerify,
    recommendedOutcome:
      aiData?.recommendedOutcome ||
      'Secure agreement on one specific next milestone (technical review, scoped proposal, or scheduled follow-up date).',
    followUpSuggestions:
      aiData?.followUpSuggestions?.length
        ? aiData.followUpSuggestions
        : [
            'Log a manual meeting interaction in LEED immediately after the call with outcome and next action.',
            'Draft a concise meeting follow-up email summarizing agreed points (draft_only for owner review).',
            'Create or update an opportunity if budget, need, and timeline are confirmed.',
          ],
    evidenceSources: ctx.evidenceSources,
    contextAudit: ctx.contextAudit,
    honestGroundingNote:
      interactions.length > 0
        ? `Grounded strictly in ${interactions.length} verified LEED interaction(s) and ${openTasks.length} open task(s). Objectives and objection responses are AI analysis/hypotheses.`
        : 'Zero prior interactions exist in LEED for this record; no prior conversation history was invented. Discussion items and objections are analytical hypotheses.',
  };

  await recordSavedReportSummary(facade, {
    id: report.id,
    reportType: 'meeting_prep',
    leadId: company?.id,
    personId: person?.id,
    title: report.meetingTitle,
    createdAt: report.generatedAt,
    summary: report.relationshipHistorySummary.slice(0, 220),
  });

  return report;
}

// ============================================================================
// 3. ON-DEMAND DAILY SALES BRIEFING (NO FAKE SCHEDULER)
// ============================================================================

export async function generateDailySalesBriefing(
  facade: CrmStorageFacade,
  params?: { icpId?: string; now?: Date }
): Promise<DailySalesBriefing> {
  const now = params?.now || new Date();
  const [dashboard, reminders, icps, leads, rels, allOpps] = await Promise.all([
    buildCrmDashboardSummary(facade, now),
    buildReminderCenter(facade, now),
    listIcpProfiles(facade),
    facade.getLeads(),
    facade.getCompanyPersonRelationships(),
    listAllCrmOpportunities(facade),
  ]);

  const selectedIcp = params?.icpId
    ? icps.find((p) => p.id === params.icpId)
    : icps.find((p) => p.isDefault) || icps[0];

  const prioritized = await prioritizeCrmLeads(facade, {
    icp: selectedIcp,
    limit: 12,
    now,
  });

  const leadMap = new Map(leads.map((l) => [l.id, l]));
  const relCountByLead = new Map<string, number>();
  for (const r of rels) {
    relCountByLead.set(r.leadId, (relCountByLead.get(r.leadId) || 0) + 1);
  }

  // Identify companies needing research or enrichment (DQ < 60 or missing contacts/website)
  const needsResearch = leads
    .map((l) => {
      const dmCount = relCountByLead.get(l.id) || 0;
      const dq = evaluateCompanyDataQuality(l, { linkedPersonsCount: dmCount });
      const missing: string[] = [];
      if (!l.website) missing.push('website');
      if (!l.email && !l.phone) missing.push('company contact');
      if (dmCount === 0) missing.push('decision-makers');
      if (l.customFields?.registryVerificationState !== 'verified') missing.push('registry verification');
      return {
        leadId: l.id,
        companyName: l.companyName,
        dataQualityScore: dq.overallScore,
        dataQualityGrade: dq.grade,
        missingKeyFields: missing,
      };
    })
    .filter((c) => c.dataQualityScore < 65 || c.missingKeyFields.length >= 2)
    .sort((a, b) => a.dataQualityScore - b.dataQualityScore)
    .slice(0, 6);

  // Open opportunities requiring attention (past expectedCloseDate, overdue nextActionDate, or stale)
  const nowMs = now.getTime();
  const oppsNeedingAttention = allOpps
    .filter((o) => o.status === 'open')
    .map((o) => {
      const reasons: string[] = [];
      if (o.nextActionDate && new Date(o.nextActionDate).getTime() < nowMs) {
        reasons.push(`Next action overdue (${o.nextActionDate.slice(0, 10)})`);
      }
      if (o.expectedCloseDate && new Date(o.expectedCloseDate).getTime() < nowMs) {
        reasons.push(`Expected close date passed (${o.expectedCloseDate.slice(0, 10)})`);
      }
      if (!o.nextAction) {
        reasons.push('No next action specified');
      }
      const daysSinceUpdate = Math.floor((nowMs - new Date(o.updatedAt).getTime()) / 86_400_000);
      if (daysSinceUpdate >= 14) {
        reasons.push(`No update for ${daysSinceUpdate} days`);
      }
      return {
        opportunityId: o.id,
        leadId: o.leadId,
        companyName: leadMap.get(o.leadId)?.companyName || 'Company',
        title: o.title,
        estimatedValue: o.estimatedValue,
        currency: o.currency,
        reason: reasons.join(' · ') || 'Active open opportunity',
        nextAction: o.nextAction,
        urgencyWeight: reasons.length,
      };
    })
    .filter((x) => x.urgencyWeight > 0)
    .sort((a, b) => b.urgencyWeight - a.urgencyWeight || b.estimatedValue - a.estimatedValue)
    .slice(0, 6)
    .map(({ urgencyWeight: _w, ...rest }) => rest);

  const overdueAndDue = reminders.reminders
    .filter(
      (r) =>
        r.kind === 'overdue_task' ||
        r.kind === 'today_task' ||
        r.kind === 'interaction_follow_up' ||
        r.kind === 'relationship_review'
    )
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      category: r.kind,
      severity: r.severity,
      title: r.title,
      dueDate: r.dueAt,
      entityName: r.companyName || r.personName || 'CRM Record',
      leadId: r.leadId,
      personId: r.personId,
    }));

  const upcomingMeetings = reminders.reminders
    .filter((r) => r.kind === 'upcoming_meeting')
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      title: r.title,
      dueDate: r.dueAt,
      entityName: r.companyName || r.personName || 'CRM Record',
      leadId: r.leadId,
      personId: r.personId,
    }));

  const priorityCompanies = prioritized.slice(0, 6).map((p) => ({
    leadId: p.leadId,
    companyName: p.companyName,
    priorityScore: p.priorityScore,
    priorityTier: p.priorityTier,
    urgency: p.urgency,
    reason: p.explanation,
    recommendedAction: p.recommendedNextAction,
  }));

  const highPotentialLeads = prioritized
    .filter((p) => (p.icpScore !== undefined ? p.icpScore >= 65 : p.priorityScore >= 60))
    .slice(0, 5)
    .map((p) => ({
      leadId: p.leadId,
      companyName: p.companyName,
      icpScore: p.icpScore,
      priorityScore: p.priorityScore,
      highlight:
        p.icpScore !== undefined
          ? `ICP Fit ${p.icpScore}/100 · Priority ${p.priorityScore}/100 · ${p.decisionMakerCount} contact(s)`
          : `Priority ${p.priorityScore}/100 · Quality ${p.dataQualityScore ?? 'N/A'}/100`,
    }));

  const recentUpdates: DailySalesBriefing['recentRelationshipUpdates'] = [
    ...dashboard.recentlyUpdatedCompanies.slice(0, 4).map((c) => ({
      entityType: 'company' as const,
      id: c.id,
      title: c.companyName,
      subtitle: `${c.industry} · Status: ${c.relationshipStatus}`,
      timestamp: c.updatedAt,
    })),
    ...dashboard.recentInteractions.slice(0, 4).map((i) => ({
      entityType: 'interaction' as const,
      id: i.id,
      title: i.summary,
      subtitle: `${i.type} · ${i.companyName || i.personName || 'CRM Record'}`,
      timestamp: i.occurredAt,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 6);

  const openPipelineValue = (dashboard.metrics.expectedOpportunityValueByCurrency || []).reduce(
    (sum, b) => sum + (b.totalValue || 0),
    0
  );

  // Optional AI synthesis of the daily executive focus
  interface AiBriefingFocus {
    executiveFocus: string;
    recommendedActions: string[];
  }

  const aiResult = await generateStructuredJsonWithAi<AiBriefingFocus>({
    systemInstruction: ANTI_HALLUCINATION_SYSTEM_INSTRUCTION,
    prompt: `Write a crisp daily sales executive focus strictly from these live LEED CRM figures:
- Total Companies: ${dashboard.metrics.totalCompanies}
- Overdue Tasks: ${reminders.counts.overdueTasks}
- Due Today Follow-Ups: ${reminders.counts.todayFollowUps}
- Upcoming Meetings: ${reminders.counts.upcomingMeetings}
- Open Opportunities: ${dashboard.metrics.activeOpportunities} (Value: ${openPipelineValue})
- Top Priority Accounts: ${priorityCompanies.slice(0, 3).map((p) => `${p.companyName} (${p.priorityScore}/100)`).join(', ') || 'None yet'}
- Opportunities Needing Attention: ${oppsNeedingAttention.slice(0, 3).map((o) => `${o.title} at ${o.companyName}`).join(', ') || 'None'}
- Companies Needing Research: ${needsResearch.length}

Return ONLY JSON:
{
  "executiveFocus": "2-3 sentence grounded daily sales focus",
  "recommendedActions": ["3-5 concrete prioritized actions for today"]
}`,
  });

  const fallbackActions: string[] = [];
  if (reminders.counts.overdueTasks > 0) {
    fallbackActions.push(`Clear ${reminders.counts.overdueTasks} overdue follow-up task(s) first to protect active momentum.`);
  }
  if (upcomingMeetings.length > 0) {
    fallbackActions.push(`Generate Meeting Preparation briefs for ${upcomingMeetings.length} upcoming meeting(s).`);
  }
  if (priorityCompanies[0]) {
    fallbackActions.push(`Prioritize outreach to ${priorityCompanies[0].companyName} (Score ${priorityCompanies[0].priorityScore}/100): ${priorityCompanies[0].recommendedAction}`);
  }
  if (oppsNeedingAttention[0]) {
    fallbackActions.push(`Review opportunity "${oppsNeedingAttention[0].title}" at ${oppsNeedingAttention[0].companyName} (${oppsNeedingAttention[0].reason}).`);
  }
  if (needsResearch.length > 0) {
    fallbackActions.push(`Enrich or verify ${needsResearch.length} company record(s) with missing contact/registry fields.`);
  }
  if (fallbackActions.length === 0) {
    fallbackActions.push('Add or discover target companies in Discover Leads to build your daily action queue.');
  }

  const evidenceSources: AiEvidenceSource[] = [
    ...priorityCompanies.slice(0, 4).map((p) => ({
      id: `ev-brief-lead-${p.leadId}`,
      entityType: 'company' as const,
      entityId: p.leadId,
      label: `Priority Lead: ${p.companyName} (${p.priorityScore}/100)`,
      classification: 'ai_analysis' as const,
      excerpt: p.reason,
    })),
    ...overdueAndDue.slice(0, 4).map((r) => ({
      id: `ev-brief-rem-${r.id}`,
      entityType: 'task' as const,
      entityId: r.id,
      label: `Reminder: ${r.title}`,
      classification: 'verified_fact' as const,
      excerpt: `${r.entityName}${r.dueDate ? ` · Due ${r.dueDate.slice(0, 10)}` : ''}`,
    })),
  ];

  const briefing: DailySalesBriefing = {
    id: generateAiId('brief'),
    generatedAt: now.toISOString(),
    briefingDate: now.toISOString().slice(0, 10),
    deliveryMode: 'on_demand_manual',
    schedulerActive: false,
    schedulerDisclosure:
      'Generated live on demand from your current LEED CRM records. No background scheduled briefing daemon or automated email delivery is active.',
    aiStatus: aiResult.meta,
    executiveFocus:
      aiResult.data?.executiveFocus ||
      `Today's live briefing covers ${dashboard.metrics.totalCompanies} company record(s), ${reminders.counts.overdueTasks} overdue task(s), ${reminders.counts.todayFollowUps} follow-up(s) due today, and ${dashboard.metrics.activeOpportunities} open opportunity(ies). ${
        priorityCompanies[0]
          ? `Highest-priority account: ${priorityCompanies[0].companyName} (${priorityCompanies[0].priorityScore}/100).`
          : 'Add target companies to populate account priority rankings.'
      }`,
    summaryMetrics: {
      totalCompanies: dashboard.metrics.totalCompanies,
      overdueTasksCount: reminders.counts.overdueTasks,
      todayFollowUpsCount: reminders.counts.todayFollowUps,
      upcomingMeetingsCount: reminders.counts.upcomingMeetings,
      openOpportunitiesCount: dashboard.metrics.activeOpportunities,
      openPipelineValue,
      companiesNeedingResearchCount: needsResearch.length,
    },
    priorityCompaniesToContact: priorityCompanies,
    overdueAndDueFollowUps: overdueAndDue,
    upcomingMeetings,
    opportunitiesRequiringAttention: oppsNeedingAttention,
    companiesNeedingResearchOrEnrichment: needsResearch,
    highPotentialLeads,
    recentRelationshipUpdates: recentUpdates,
    recommendedActions:
      aiResult.data?.recommendedActions?.length ? aiResult.data.recommendedActions : fallbackActions,
    evidenceSources,
  };

  await recordSavedReportSummary(facade, {
    id: briefing.id,
    reportType: 'daily_briefing',
    title: `Daily Sales Briefing (${briefing.briefingDate})`,
    createdAt: briefing.generatedAt,
    summary: briefing.executiveFocus.slice(0, 220),
  });

  return briefing;
}

// ============================================================================
// 4. EVIDENCE-GROUNDED SALES COMMUNICATION DRAFTING (DRAFT ONLY — NEVER SENDS)
// ============================================================================

export async function generateSalesCommunicationDraft(
  facade: CrmStorageFacade,
  params: {
    leadId?: string;
    personId?: string;
    opportunityId?: string;
    draftType: AiDraftType;
    tone?: AiDraftTone;
    customInstructions?: string;
    includePrivateNotes?: boolean;
  }
): Promise<AiCommunicationDraft> {
  const draftType: AiDraftType = AI_DRAFT_TYPE_SET.has(params.draftType)
    ? params.draftType
    : 'intro_email';
  const spec = AI_DRAFT_TYPES.find((d) => d.value === draftType) || AI_DRAFT_TYPES[0];
  const tone: AiDraftTone = params.tone || 'consultative';

  const ctx = await buildControlledAiContext(facade, {
    scopeType: params.opportunityId ? 'opportunity' : params.personId ? 'person' : 'company',
    leadId: params.leadId,
    personId: params.personId,
    opportunityId: params.opportunityId,
    includePrivateNotes: params.includePrivateNotes === true,
  });

  const company = ctx.companyProfile?.lead;
  const person = ctx.personProfile?.person || ctx.companyProfile?.decisionMakers[0]?.person;
  const personRel = ctx.companyProfile?.decisionMakers.find((d) => d.person.id === person?.id)?.relationship;
  const opp = ctx.opportunity || ctx.companyProfile?.opportunities.find((o) => o.status === 'open');
  const interactions = ctx.personProfile?.interactions.length
    ? ctx.personProfile.interactions
    : ctx.companyProfile?.interactions || [];

  const personalizationBasis: AiClaimItem[] = [];
  const caveatsAndPlaceholders: string[] = [];

  if (company) {
    personalizationBasis.push({
      statement: `Company: ${company.companyName} (${company.industry || 'sector unrecorded'}, ${company.address?.country || 'location unrecorded'})`,
      classification: company.companyStatus === 'active' ? 'verified_fact' : 'source_reported',
      evidenceRefIds: [`ev-company-${company.id}`],
    });
  } else {
    caveatsAndPlaceholders.push('No company record selected; generic [Company Name] placeholder used.');
  }

  if (person) {
    personalizationBasis.push({
      statement: `Recipient: ${person.fullName} (${personRel?.jobTitle || personRel?.designation || person.seniority || 'linked contact'})`,
      classification: person.verificationStatus === 'officially_verified' ? 'verified_fact' : 'source_reported',
      evidenceRefIds: [`ev-person-${person.id}`],
    });
  } else {
    caveatsAndPlaceholders.push('No decision-maker name recorded; use [Recipient Name] placeholder before sending.');
  }

  if (interactions.length > 0) {
    personalizationBasis.push({
      statement: `Most recent interaction (${interactions[0].occurredAt.slice(0, 10)}): ${interactions[0].summary}`,
      classification: 'verified_fact',
      evidenceRefIds: [`ev-int-${interactions[0].id}`],
    });
  } else {
    caveatsAndPlaceholders.push('Zero prior interactions exist in LEED—draft avoids claiming any previous conversation or referral.');
  }

  if (opp) {
    personalizationBasis.push({
      statement: `Opportunity context: ${opp.title} (${opp.status})`,
      classification: 'verified_fact',
      evidenceRefIds: [`ev-opp-${opp.id}`],
    });
  }

  if (!ctx.ownerGoals.valueProposition) {
    caveatsAndPlaceholders.push('Owner value proposition is blank in Sales Goals—review and customize the value statement before use.');
  }

  interface AiDraftPayload {
    subject?: string;
    body: string;
  }

  const aiResult = await generateStructuredJsonWithAi<AiDraftPayload>({
    systemInstruction: ANTI_HALLUCINATION_SYSTEM_INSTRUCTION,
    prompt: `Draft a ${spec.label} (${spec.channel} channel, tone: ${tone}) strictly grounded in the LEED CRM context below.
RULES:
- NEVER invent past conversations, referrals, or unverified company metrics.
- If recipient name or value proposition is missing, use clean bracket placeholders like [Recipient Name] or [Your Signature].
- Keep it concise, respectful, and natural.
${spec.channel === 'linkedin' ? '- Keep body concise (under 450 characters) for LinkedIn.' : ''}

${ctx.promptContextText}

Custom Owner Instructions: ${params.customInstructions?.trim() || 'None'}

Return ONLY JSON:
{
  ${spec.channel !== 'linkedin' ? '"subject": "Concise, natural subject line",' : '"subject": "",'}
  "body": "Ready-to-review draft message body"
}`,
  });

  const greetingName = person?.firstName || person?.fullName || (company ? `${company.companyName} team` : '[Recipient Name]');
  const companyLabel = company?.companyName || '[Company Name]';
  const sectorLabel = company?.industry || 'your sector';
  const valueProp =
    ctx.ownerGoals.valueProposition ||
    '[brief summary of how your offering helps similar organizations]';
  const senderSignoff = ctx.ownerGoals.businessName
    ? `Best regards,\n[Your Name]\n${ctx.ownerGoals.businessName}`
    : 'Best regards,\n[Your Name]';

  let fallbackSubject =
    spec.channel === 'linkedin'
      ? undefined
      : `${spec.label.replace(' Email', '')} — ${companyLabel}`;
  let fallbackBody = '';

  if (spec.channel === 'linkedin') {
    fallbackBody = `Hi ${greetingName}, I noticed ${companyLabel}'s work in ${sectorLabel}${company?.address?.city ? ` in ${company.address.city}` : ''}. I work with organizations in this space on ${valueProp.slice(0, 120)} and would appreciate connecting.`;
  } else if (
    (draftType === 'follow_up' || draftType === 'meeting_follow_up' || draftType === 'negotiation_follow_up') &&
    interactions.length > 0
  ) {
    fallbackSubject = `Following up on our ${interactions[0].type.replace('_', ' ')} — ${companyLabel}`;
    fallbackBody = `Hi ${greetingName},\n\nThank you for our recent discussion on ${interactions[0].occurredAt.slice(0, 10)} regarding ${interactions[0].summary}.${
      interactions[0].nextAction ? `\n\nAs noted for our next step: ${interactions[0].nextAction}.` : ''
    }${
      opp ? `\n\nI would be glad to keep "${opp.title}" moving forward on a timeline that works for your team.` : ''
    }\n\nPlease let me know a convenient time to continue.\n\n${senderSignoff}`;
  } else {
    fallbackBody = `Hi ${greetingName},\n\nI am reaching out regarding ${companyLabel}'s work in ${sectorLabel}${
      company?.address?.country ? ` (${company.address.country})` : ''
    }.\n\nWe help organizations in this area with ${valueProp}.${
      params.customInstructions?.trim() ? `\n\n${params.customInstructions.trim()}` : ''
    }\n\nWould you be open to a brief 15-minute conversation next week to explore whether there is a relevant fit?\n\n${senderSignoff}`;
  }

  const draft: AiCommunicationDraft = {
    id: generateAiId('draft'),
    draftType,
    channel: spec.channel,
    tone,
    status: 'draft_only',
    autoSent: false,
    sendingNotice:
      'DRAFT ONLY — Saved for owner review and manual copy/edit. LEED does not automatically send emails, LinkedIn messages, or outreach campaigns in Phase 14.',
    leadId: company?.id,
    companyName: company?.companyName,
    personId: person?.id,
    recipientName: person?.fullName,
    recipientRole: personRel?.jobTitle || personRel?.designation || person?.seniority,
    opportunityId: opp?.id,
    subject:
      spec.channel === 'linkedin'
        ? undefined
        : aiResult.data?.subject?.trim() || fallbackSubject,
    body: aiResult.data?.body?.trim() || fallbackBody,
    personalizationBasis,
    caveatsAndPlaceholders,
    evidenceSources: ctx.evidenceSources,
    contextAudit: ctx.contextAudit,
    aiStatus: aiResult.meta,
    createdAt: new Date().toISOString(),
  };

  await saveCommunicationDraft(facade, draft);
  return draft;
}

// ============================================================================
// 5. CONVERSATIONAL AI SALES AGENT (CONTEXT + TOOLS + APPROVAL-ONLY PROPOSALS)
// ============================================================================

export async function runSalesAgentConversationTurn(
  facade: CrmStorageFacade,
  params: {
    conversationId?: string;
    userMessage: string;
    contextScope?: AiContextScope;
    includePrivateNotes?: boolean;
  }
): Promise<{
  conversation: AiAgentConversation;
  assistantMessage: AiAgentMessage;
  proposedActions: AiActionProposal[];
}> {
  const cleanedMessage = params.userMessage.trim();
  if (!cleanedMessage) {
    throw new Error('Message content cannot be empty.');
  }

  const conversations = await listAiConversations(facade);
  let conversation = params.conversationId
    ? conversations.find((c) => c.id === params.conversationId)
    : undefined;

  const effectiveScope: AiContextScope = {
    ...(conversation?.contextScope || { scopeType: 'portfolio' }),
    ...(params.contextScope || {}),
    includePrivateNotes:
      params.includePrivateNotes !== undefined
        ? params.includePrivateNotes === true
        : Boolean(params.contextScope?.includePrivateNotes ?? conversation?.contextScope.includePrivateNotes),
  };

  if (!conversation) {
    conversation = await createAiConversation(facade, {
      title: cleanedMessage.slice(0, 68),
      contextScope: effectiveScope,
    });
  } else {
    conversation = {
      ...conversation,
      contextScope: effectiveScope,
    };
  }

  const ctx = await buildControlledAiContext(facade, effectiveScope);

  // Execute relevant authorized read-only tools based on context & intent
  const toolsUsed: AiToolExecutionRecord[] = [];
  const toolSnippets: string[] = [];
  const lower = cleanedMessage.toLowerCase();

  const toolCtx = {
    facade,
    includePrivateNotes: effectiveScope.includePrivateNotes === true,
    conversationId: conversation.id,
  };

  if (effectiveScope.leadId) {
    const dqRes = await executeControlledAgentTool(toolCtx, 'get_enrichment_and_quality', {
      leadId: effectiveScope.leadId,
    });
    toolsUsed.push(dqRes.record);
    if (dqRes.record.success) toolSnippets.push(dqRes.record.summary);

    if (ctx.icpProfiles.length > 0 && (lower.includes('icp') || lower.includes('fit') || lower.includes('qualif') || lower.includes('analyz'))) {
      const icpRes = await executeControlledAgentTool(toolCtx, 'evaluate_icp_match', {
        leadId: effectiveScope.leadId,
      });
      toolsUsed.push(icpRes.record);
      if (icpRes.record.success) toolSnippets.push(icpRes.record.summary);
    }
  } else {
    if (lower.includes('priorit') || lower.includes('focus') || lower.includes('who should') || lower.includes('top lead') || lower.includes('contact')) {
      const prioRes = await executeControlledAgentTool(toolCtx, 'prioritize_leads', { limit: 6 });
      toolsUsed.push(prioRes.record);
      if (prioRes.record.success) {
        const items = ((prioRes.data as any)?.prioritizedLeads || []) as Array<{
          companyName: string;
          priorityScore: number;
          priorityTier: string;
          recommendedNextAction: string;
        }>;
        toolSnippets.push(
          `Top prioritized leads: ${items
            .slice(0, 5)
            .map((p) => `${p.companyName} (${p.priorityScore}/100 ${p.priorityTier} — ${p.recommendedNextAction})`)
            .join('; ')}`
        );
      }
    }
    if (lower.includes('overdue') || lower.includes('reminder') || lower.includes('today') || lower.includes('follow') || lower.includes('brief')) {
      const remRes = await executeControlledAgentTool(toolCtx, 'get_reminders', {});
      toolsUsed.push(remRes.record);
      if (remRes.record.success) toolSnippets.push(remRes.record.summary);
    }
    if (toolsUsed.length === 0) {
      const dashRes = await executeControlledAgentTool(toolCtx, 'get_crm_dashboard', {});
      toolsUsed.push(dashRes.record);
      if (dashRes.record.success) toolSnippets.push(dashRes.record.summary);
    }
  }

  // If owner asks to create/schedule/update a CRM item, queue an approval-only proposal via controlled tool
  const proposedActions: AiActionProposal[] = [];
  const wantsTask = /\b(create|add|schedule|set)\b.*\b(task|follow-?up|reminder|call)\b/i.test(cleanedMessage);
  const wantsReview = /\b(schedule)\b.*\b(review)\b/i.test(cleanedMessage);
  const wantsOpp = /\b(create|open|add)\b.*\b(opportunity|deal)\b/i.test(cleanedMessage);

  if (effectiveScope.leadId && ctx.companyProfile && (wantsTask || wantsReview || wantsOpp)) {
    const lead = ctx.companyProfile.lead;
    const actionType = wantsOpp ? 'create_opportunity' : wantsReview ? 'schedule_review' : 'create_task';
    const propRes = await executeControlledAgentTool(toolCtx, 'propose_crm_action', {
      actionType,
      title: wantsOpp
        ? `Create opportunity for ${lead.companyName}`
        : wantsReview
          ? `Schedule relationship review for ${lead.companyName}`
          : `Follow-up task for ${lead.companyName}`,
      rationale: `Proposed in response to owner request: "${cleanedMessage.slice(0, 180)}". Requires explicit owner approval before modifying CRM records.`,
      entityType: 'company',
      entityId: lead.id,
      entityName: lead.companyName,
      proposedChanges: wantsOpp
        ? {
            title: `${lead.companyName} — Commercial Opportunity`,
            estimatedValue: lead.opportunityValue || 0,
            currency: lead.currency || 'USD',
            nextAction: 'Confirm commercial scope with primary stakeholder',
          }
        : wantsReview
          ? {
              scheduledReviewInDays: 7,
              relationshipStatus: 'active',
            }
          : {
              taskTitle: `Follow up with ${lead.companyName}`,
              category: 'follow_up',
              priority: 'high',
              dueInDays: 2,
            },
      evidenceRefIds: [`ev-company-${lead.id}`],
    });
    toolsUsed.push(propRes.record);
    if (propRes.record.success && (propRes.data as any)?.proposal) {
      proposedActions.push((propRes.data as any).proposal);
    }
  }

  // Build history window (last 8 messages)
  const historyLines = conversation.messages
    .slice(-8)
    .map((m) => `${m.role === 'owner' ? 'Owner' : 'AI Sales Agent'}: ${m.content.slice(0, 600)}`)
    .join('\n');

  const aiTextRes = await generateAgentTextWithAi({
    systemInstruction: ANTI_HALLUCINATION_SYSTEM_INSTRUCTION,
    prompt: `${ctx.promptContextText}

=== AUTHORIZED TOOL OUTPUTS ===
${toolSnippets.length ? toolSnippets.map((s) => `- ${s}`).join('\n') : 'No extra tool output.'}
${proposedActions.length ? `\nPending Action Proposal Created (Awaiting Owner Approval): ${proposedActions.map((p) => p.title).join(', ')}` : ''}

=== CONVERSATION HISTORY ===
${historyLines || '(First message in session)'}

=== OWNER MESSAGE ===
${cleanedMessage}

Respond directly, concisely, and clearly. Label verified facts vs AI analysis/hypotheses and explicitly note any missing information. Never claim a CRM record was already changed or an email was sent.`,
  });

  // Deterministic grounded fallback when Gemini is unavailable
  let replyContent = aiTextRes.text;
  if (!replyContent) {
    const parts: string[] = [];
    if (ctx.companyProfile) {
      const l = ctx.companyProfile.lead;
      parts.push(
        `**Verified / Recorded Facts (${l.companyName}):** Industry is ${l.industry || 'unrecorded'}, location is ${l.address?.country || 'unrecorded'}, status is ${l.companyStatus || 'unknown'}, with ${ctx.companyProfile.decisionMakers.length} linked decision-maker(s), ${ctx.companyProfile.interactions.length} recorded interaction(s), and ${ctx.companyProfile.opportunities.length} opportunity(ies).`
      );
      if (ctx.companyProfile.decisionMakers.length > 0) {
        parts.push(
          `**Contacts on file:** ${ctx.companyProfile.decisionMakers
            .slice(0, 3)
            .map((d) => `${d.person.fullName} (${d.relationship.jobTitle || d.relationship.designation || d.relationship.relationshipType})`)
            .join(', ')}.`
        );
      } else {
        parts.push('**Unknown / Missing:** No decision-makers are linked yet.');
      }
    } else if (ctx.personProfile) {
      const p = ctx.personProfile.person;
      const pRole =
        ctx.personProfile.currentCompanies[0]?.relationship?.jobTitle ||
        ctx.personProfile.currentCompanies[0]?.relationship?.designation ||
        p.seniority ||
        'unrecorded';
      parts.push(
        `**Recorded Profile (${p.fullName}):** Role "${pRole}", verification "${p.verificationStatus}", ${ctx.personProfile.interactions.length} recorded interaction(s).`
      );
    } else if (ctx.portfolioSummary) {
      parts.push(
        `**Portfolio Snapshot (Verified CRM Counts):** ${ctx.portfolioSummary.totalCompanies} companies, ${ctx.portfolioSummary.totalPersons} decision-makers, ${ctx.portfolioSummary.openOpportunitiesCount} open opportunities, and ${ctx.portfolioSummary.openTasksCount} open tasks.`
      );
    }

    if (toolSnippets.length > 0) {
      parts.push(`**Live Tool Findings:**\n${toolSnippets.map((s) => `- ${s}`).join('\n')}`);
    }

    if (proposedActions.length > 0) {
      parts.push(
        `**Action Proposal Queued (Approval Required):** I prepared "${proposedActions[0].title}". No CRM record has been modified yet—review and approve it in the Action Proposals panel to execute.`
      );
    }

    parts.push(
      `**AI Analysis Note:** Running in deterministic CRM grounding mode because live Gemini synthesis is currently unavailable (${aiTextRes.meta.warning || 'unconfigured'}).`
    );

    replyContent = parts.join('\n\n');
  }

  const nowIso = new Date().toISOString();
  const ownerMsg: AiAgentMessage = {
    id: generateAiId('msg'),
    role: 'owner',
    content: cleanedMessage,
    createdAt: nowIso,
  };

  const verifiedCount = ctx.evidenceSources.filter((e) => e.classification === 'verified_fact').length;
  const sourceReportedCount = ctx.evidenceSources.filter((e) => e.classification === 'source_reported').length;

  const assistantMsg: AiAgentMessage = {
    id: generateAiId('msg'),
    role: 'assistant',
    content: replyContent,
    createdAt: new Date().toISOString(),
    aiStatus: aiTextRes.meta,
    toolsUsed,
    evidenceSources: ctx.evidenceSources.slice(0, 12),
    claimsBreakdown: {
      verifiedFactsCount: verifiedCount,
      sourceReportedCount,
      aiAnalysisCount: 1,
      hypothesesCount: proposedActions.length,
      unknownsCount: ctx.companyProfile && ctx.companyProfile.decisionMakers.length === 0 ? 1 : 0,
    },
    proposedActionIds: proposedActions.map((p) => p.id),
    contextAudit: ctx.contextAudit,
  };

  conversation = await saveAiConversation(facade, {
    ...conversation,
    title:
      conversation.messages.length === 0
        ? cleanedMessage.slice(0, 70)
        : conversation.title,
    messages: [...conversation.messages, ownerMsg, assistantMsg],
  });

  return {
    conversation,
    assistantMessage: assistantMsg,
    proposedActions,
  };
}

// ============================================================================
// 6. OWNER APPROVAL & EXECUTION WORKFLOW FOR PROPOSED CRM ACTIONS
// ============================================================================

export async function approveAndExecuteActionProposal(
  facade: CrmStorageFacade,
  proposalId: string,
  approvedBy: string
): Promise<{ proposal: AiActionProposal; executedEntityId?: string; summary: string }> {
  const ws = await getAiWorkspaceState(facade);
  const proposal = ws.actionProposals.find((p) => p.id === proposalId);
  if (!proposal) {
    throw new Error('Action proposal not found.');
  }
  if (proposal.status !== 'pending_approval') {
    throw new Error(`Action proposal is already ${proposal.status} and cannot be executed again.`);
  }

  const changes = proposal.proposedChanges || {};
  const leadId = proposal.affectedEntity.entityType === 'company' ? proposal.affectedEntity.entityId : (changes.leadId as string | undefined);
  const personId = proposal.affectedEntity.entityType === 'person' ? proposal.affectedEntity.entityId : (changes.personId as string | undefined);
  const dueInDays = Number.isFinite(Number(changes.dueInDays)) ? Math.max(0, Number(changes.dueInDays)) : 2;
  const dueDate =
    typeof changes.dueDate === 'string' && changes.dueDate
      ? changes.dueDate
      : new Date(Date.now() + dueInDays * 86_400_000).toISOString();

  let executedEntityId: string | undefined;
  let summary = '';

  switch (proposal.actionType) {
    case 'create_task':
    case 'research_company':
    case 'enrich_company':
    case 'verify_contact': {
      const categoryMap: Record<string, any> = {
        create_task: (changes.category as string) || 'follow_up',
        research_company: 'research',
        enrich_company: 'verification',
        verify_contact: 'verification',
      };
      const task = await createExtendedTask(facade, {
        leadId: leadId || '',
        personId,
        opportunityId: typeof changes.opportunityId === 'string' ? changes.opportunityId : undefined,
        title: String(changes.taskTitle || proposal.title).slice(0, 280),
        description: String(changes.description || proposal.rationale).slice(0, 2000),
        dueDate,
        priority: (['low', 'medium', 'high'].includes(String(changes.priority))
          ? String(changes.priority)
          : 'medium') as 'low' | 'medium' | 'high',
        category: categoryMap[proposal.actionType] || 'follow_up',
        status: 'pending',
        completed: false,
        assignedTo: approvedBy || 'Owner',
      });
      executedEntityId = task.id;
      summary = `Created CRM task "${task.title}" (Due ${task.dueDate.slice(0, 10)}).`;
      break;
    }

    case 'schedule_review':
    case 'update_relationship_status':
    case 'prioritize_lead': {
      const reviewDays = Number.isFinite(Number(changes.scheduledReviewInDays))
        ? Number(changes.scheduledReviewInDays)
        : 7;
      const reviewDate =
        typeof changes.scheduledReviewDate === 'string'
          ? changes.scheduledReviewDate
          : new Date(Date.now() + reviewDays * 86_400_000).toISOString();
      const nextStatus = changes.relationshipStatus as CrmRelationshipStatus | undefined;

      if (leadId) {
        const lead = await facade.getLead(leadId);
        if (!lead) throw new Error('Target company lead not found.');
        const extraTags =
          proposal.actionType === 'prioritize_lead'
            ? Array.from(new Set([...(lead.tags || []), String(changes.priorityTag || 'ai-priority')]))
            : undefined;
        await updateCompanyRelationshipMeta(facade, leadId, {
          relationshipStatus: nextStatus,
          scheduledReviewDate: proposal.actionType === 'schedule_review' ? reviewDate : undefined,
          nextFollowUpDate: proposal.actionType === 'prioritize_lead' ? dueDate : undefined,
          tags: extraTags,
          ownerAnnotation:
            typeof changes.ownerAnnotation === 'string' ? changes.ownerAnnotation : undefined,
        });
        executedEntityId = leadId;
        summary = `Updated relationship metadata for ${lead.companyName}.`;
      } else if (personId) {
        const res = await updatePersonRelationshipMeta(facade, personId, {
          relationshipStatus: nextStatus,
          scheduledReviewDate: proposal.actionType === 'schedule_review' ? reviewDate : undefined,
        });
        if (!res) throw new Error('Target person not found.');
        executedEntityId = personId;
        summary = `Updated relationship metadata for ${res.person.fullName}.`;
      } else {
        throw new Error('No target company or person ID specified on proposal.');
      }
      break;
    }

    case 'create_opportunity': {
      if (!leadId) throw new Error('leadId is required to create an opportunity.');
      const opp = await createCrmOpportunity(facade, {
        leadId,
        personId,
        title: String(changes.title || proposal.title).slice(0, 200),
        description: String(changes.description || proposal.rationale).slice(0, 2000),
        estimatedValue: Number(changes.estimatedValue) || 0,
        currency: typeof changes.currency === 'string' ? changes.currency : 'USD',
        nextAction: typeof changes.nextAction === 'string' ? changes.nextAction : undefined,
        changedBy: approvedBy || 'Owner',
      });
      executedEntityId = opp.id;
      summary = `Created opportunity "${opp.title}" (${opp.currency} ${opp.estimatedValue}).`;
      break;
    }

    case 'update_opportunity': {
      const oppId =
        proposal.affectedEntity.entityType === 'opportunity'
          ? proposal.affectedEntity.entityId
          : (changes.opportunityId as string | undefined);
      if (!oppId) throw new Error('opportunityId is required to update an opportunity.');
      const updated = await updateCrmOpportunity(facade, oppId, {
        pipelineStageId: typeof changes.pipelineStageId === 'string' ? changes.pipelineStageId : undefined,
        nextAction: typeof changes.nextAction === 'string' ? changes.nextAction : undefined,
        notes: typeof changes.notes === 'string' ? changes.notes : undefined,
        stageChangeReason: proposal.rationale,
        changedBy: approvedBy || 'Owner',
      });
      if (!updated) throw new Error('Opportunity not found.');
      executedEntityId = updated.id;
      summary = `Updated opportunity "${updated.title}".`;
      break;
    }

    case 'record_interaction': {
      const interaction = await createCrmInteraction(facade, {
        leadId,
        personId,
        opportunityId: typeof changes.opportunityId === 'string' ? changes.opportunityId : undefined,
        type: (typeof changes.type === 'string' ? changes.type : 'note') as CrmInteractionType,
        summary: String(changes.summary || proposal.title).slice(0, 480),
        detailedNotes: String(changes.detailedNotes || proposal.rationale).slice(0, 4000),
        nextAction: typeof changes.nextAction === 'string' ? changes.nextAction : undefined,
        recordedBy: approvedBy || 'Owner',
      });
      executedEntityId = interaction.id;
      summary = `Recorded manual CRM interaction "${interaction.summary}".`;
      break;
    }

    case 'prepare_draft': {
      const draft = await generateSalesCommunicationDraft(facade, {
        leadId,
        personId,
        draftType: (typeof changes.draftType === 'string' ? changes.draftType : 'intro_email') as AiDraftType,
        tone: (typeof changes.tone === 'string' ? changes.tone : 'consultative') as AiDraftTone,
        customInstructions: typeof changes.customInstructions === 'string' ? changes.customInstructions : undefined,
      });
      executedEntityId = draft.id;
      summary = `Saved draft_only communication "${draft.subject || draft.draftType}" (not sent).`;
      break;
    }

    default:
      throw new Error(`Unsupported action execution type: ${proposal.actionType}`);
  }

  const updatedProposal = await updateAiActionProposal(facade, proposalId, {
    status: 'approved_executed',
    reviewedAt: new Date().toISOString(),
    reviewedBy: approvedBy || 'Owner',
    executionSummary: summary,
    executedEntityId,
  });

  return {
    proposal: updatedProposal!,
    executedEntityId,
    summary,
  };
}

export async function rejectActionProposal(
  facade: CrmStorageFacade,
  proposalId: string,
  rejectedBy: string,
  reason?: string
): Promise<AiActionProposal> {
  const ws = await getAiWorkspaceState(facade);
  const proposal = ws.actionProposals.find((p) => p.id === proposalId);
  if (!proposal) {
    throw new Error('Action proposal not found.');
  }
  if (proposal.status !== 'pending_approval') {
    throw new Error(`Action proposal is already ${proposal.status}.`);
  }

  const updated = await updateAiActionProposal(facade, proposalId, {
    status: 'rejected',
    reviewedAt: new Date().toISOString(),
    reviewedBy: rejectedBy || 'Owner',
    rejectionReason: reason?.trim().slice(0, 500) || 'Rejected by owner',
  });

  return updated!;
}
