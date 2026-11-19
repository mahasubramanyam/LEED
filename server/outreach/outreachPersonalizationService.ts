// Phase 15: AI-Assisted & Evidence-Grounded Outreach Personalization Engine
// Reuses Phase 14 buildControlledAiContext, evaluateCompanyAgainstIcp, and generateStructuredJsonWithAi.
// Strictly separates Verified Facts, Source-Reported Facts, AI Analysis, and Hypotheses/Caveats.
// Never fabricates achievements, prior calls/meetings, referrals, or missing contact information.

import type {
  AiClaimItem,
  AiContextAudit,
  AiDraftTone,
  AiDraftType,
  AiEvidenceSource,
  CanonicalLead,
  OutreachCampaignV2,
  OutreachChannelV2,
  OutreachComplianceConfig,
  OutreachSequenceStep,
  PersonRecord,
} from '../types.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import { buildControlledAiContext } from '../ai/contextBuilder.js';
import { getAiWorkspaceState } from '../ai/aiStoreHelper.js';
import { evaluateCompanyAgainstIcp } from '../ai/icpEngine.js';
import { generateStructuredJsonWithAi } from '../ai/aiProvider.js';
import { appendComplianceFooters } from './suppressionCompliance.js';

export interface PersonalizedOutreachDraftResult {
  subject: string;
  body: string;
  personalizationEvidence: AiClaimItem[];
  unknownsAndCaveats: string[];
  evidenceSources: AiEvidenceSource[];
  contextAudit: AiContextAudit;
  aiStatus: {
    mode: 'ai_assisted' | 'deterministic_fallback';
    model: string;
    warning?: string;
  };
}

interface AiOutreachDraftPayload {
  subject?: string;
  body?: string;
  personalizationEvidence?: Array<{
    statement: string;
    classification: 'verified_fact' | 'source_reported' | 'ai_analysis' | 'hypothesis';
    sourceLabel?: string;
  }>;
  unknownsAndCaveats?: string[];
}

export function renderOutreachTemplate(
  template: string,
  vars: Record<string, string | undefined>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const val = vars[key];
    return val && val.trim().length > 0 ? val.trim() : `[${key}]`;
  });
}

function resolvePrimaryRole(
  person: PersonRecord | null | undefined,
  leadId: string,
  relationships: Array<{
    personId: string;
    leadId: string;
    jobTitle?: string;
    designation?: string;
    department?: string;
    isCurrent?: boolean;
  }>
): string | undefined {
  if (!person) return undefined;
  const rel =
    relationships.find((r) => r.personId === person.id && r.leadId === leadId && r.isCurrent !== false) ||
    relationships.find((r) => r.personId === person.id && r.leadId === leadId);
  return rel?.jobTitle || rel?.designation || person.decisionMakingFunction || person.seniority || undefined;
}

export async function generatePersonalizedOutreachDraft(params: {
  facade: CrmStorageFacade;
  campaign: OutreachCampaignV2;
  lead: CanonicalLead;
  person?: PersonRecord | null;
  step?: OutreachSequenceStep;
  channel?: OutreachChannelV2;
  tone?: AiDraftTone;
  draftType?: AiDraftType;
  stepNumber?: number;
  customInstructions?: string;
  includePrivateNotes?: boolean;
  complianceConfig: OutreachComplianceConfig;
  ownerName?: string;
}): Promise<PersonalizedOutreachDraftResult> {
  const {
    facade,
    campaign,
    lead,
    person,
    step,
    complianceConfig,
  } = params;

  const channel: OutreachChannelV2 = params.channel || step?.channel || campaign.channel || 'email';
  const tone: AiDraftTone = params.tone || step?.tone || campaign.defaultTone || 'warm_professional';
  const stepNumber = params.stepNumber ?? step?.stepNumber ?? 1;
  const draftType: AiDraftType =
    params.draftType ||
    step?.draftType ||
    (stepNumber > 1 ? 'follow_up' : channel === 'linkedin' ? 'linkedin_message' : 'intro_email');

  const [ctx, aiWs, relationships] = await Promise.all([
    buildControlledAiContext(facade, {
      scopeType: 'company',
      leadId: lead.id,
      personId: person?.id,
      includePrivateNotes: params.includePrivateNotes === true,
    }),
    getAiWorkspaceState(facade),
    facade.getCompanyPersonRelationships(),
  ]);

  const recipientRole = resolvePrimaryRole(person, lead.id, relationships);
  const recipientName = person?.fullName;
  const senderDisplayName =
    params.ownerName?.trim() || complianceConfig.senderDisplayName || 'Owner';

  // Evaluate ICP alignment if campaign targets a specific ICP
  let icpEvidenceLine: string | undefined;
  if (campaign.targetIcpId) {
    const icp = aiWs.icpProfiles.find((p) => p.id === campaign.targetIcpId);
    if (icp) {
      const match = evaluateCompanyAgainstIcp({
        icp,
        lead,
        decisionMakers: ctx.companyProfile?.decisionMakers || [],
      });
      icpEvidenceLine = `ICP "${icp.name}" alignment: ${match.overallScore}/100 (${match.fitLabel}).`;
    }
  }

  // Build strict evidence claims (separated by verification class)
  const baseClaims: AiClaimItem[] = [];
  const unknownsAndCaveats: string[] = [];
  const leadEvId = `ev-company-${lead.id}`;
  const isOfficiallyVerified =
    (lead.identifiers || []).some((id) => id.verified || id.status === 'officially_verified') ||
    Boolean(lead.registrationNumber && lead.registrationType);
  const primarySourceName = lead.sources?.[0]?.sourceName || 'CRM discovery';

  if (isOfficiallyVerified) {
    baseClaims.push({
      statement: `Company "${lead.companyName}" is registry/officially verified in LEED CRM${
        lead.address?.country ? ` (${lead.address.country})` : ''
      }.`,
      classification: 'verified_fact',
      evidenceRefIds: [leadEvId],
    });
  } else {
    baseClaims.push({
      statement: `Company "${lead.companyName}" is recorded in LEED CRM from ${primarySourceName}.`,
      classification: 'source_reported',
      evidenceRefIds: [leadEvId],
    });
  }

  if (lead.industry) {
    baseClaims.push({
      statement: `Recorded industry: ${lead.industry}.`,
      classification: 'source_reported',
      evidenceRefIds: [leadEvId],
    });
  } else {
    unknownsAndCaveats.push('Company industry is not populated in CRM; avoid assuming sector specifics.');
  }

  if (lead.address?.city || lead.address?.country) {
    const loc = [lead.address?.city, lead.address?.country].filter(Boolean).join(', ');
    baseClaims.push({
      statement: `Recorded business location: ${loc}.`,
      classification: 'source_reported',
      evidenceRefIds: [leadEvId],
    });
  }

  if (lead.webMetadata?.description) {
    baseClaims.push({
      statement: `Website summary: ${lead.webMetadata.description.slice(0, 180)}`,
      classification: 'source_reported',
      evidenceRefIds: [leadEvId],
    });
  }

  if (person) {
    const isVerifiedPerson = person.verificationStatus === 'officially_verified';
    baseClaims.push({
      statement: `Recipient: ${person.fullName}${recipientRole ? ` (${recipientRole})` : ''}.`,
      classification: isVerifiedPerson ? 'verified_fact' : 'source_reported',
      evidenceRefIds: [`ev-person-${person.id}`],
    });
    if (channel === 'email' && person.emailStatus !== 'verified') {
      unknownsAndCaveats.push(
        `Recipient email verification status is "${person.emailStatus || 'unverified'}". Confirm before dispatch.`
      );
    }
  } else {
    unknownsAndCaveats.push(
      'No specific decision-maker selected; draft addresses the company team generally. Confirm recipient before approval.'
    );
  }

  const interactions = ctx.companyProfile?.interactions || [];
  if (interactions.length > 0) {
    const latest = interactions[0];
    baseClaims.push({
      statement: `Most recent recorded CRM interaction (${latest.occurredAt.slice(0, 10)}): ${latest.summary}`,
      classification: 'verified_fact',
      evidenceRefIds: [`ev-interaction-${latest.id}`],
    });
  } else {
    unknownsAndCaveats.push(
      'No prior CRM interactions recorded with this company; do not reference previous calls, emails, or meetings.'
    );
  }

  if (icpEvidenceLine) {
    baseClaims.push({
      statement: icpEvidenceLine,
      classification: 'ai_analysis',
      evidenceRefIds: [leadEvId],
    });
  }

  const templateVars: Record<string, string | undefined> = {
    company_name: lead.companyName,
    recipient_name: recipientName || `${lead.companyName} team`,
    recipient_role: recipientRole || 'leadership team',
    industry: lead.industry || 'your sector',
    city: lead.address?.city || undefined,
    country: lead.address?.country || undefined,
    owner_name: senderDisplayName,
    campaign_objective: campaign.objective,
  };

  // Build deterministic grounded draft first (also serves as safe fallback & template baseline)
  const deterministicDraft = buildDeterministicGroundedDraft({
    campaign,
    lead,
    recipientName,
    recipientRole,
    step,
    stepNumber,
    channel,
    tone,
    senderDisplayName,
    templateVars,
    latestInteractionSummary: interactions[0]?.summary,
  });

  // If sequence step explicitly disables AI personalization, return rendered template directly
  if (step && step.aiPersonalizationEnabled === false) {
    const bodyWithFooter = appendComplianceFooters(deterministicDraft.body, complianceConfig, channel);
    return {
      subject: deterministicDraft.subject,
      body: bodyWithFooter,
      personalizationEvidence: baseClaims,
      unknownsAndCaveats,
      evidenceSources: ctx.evidenceSources,
      contextAudit: ctx.contextAudit,
      aiStatus: {
        mode: 'deterministic_fallback',
        model: 'template-grounded',
        warning: 'AI personalization disabled on this sequence step; rendered from grounded template.',
      },
    };
  }

  const systemInstruction = [
    'You are the LEED Owner-Controlled Outreach Personalization Assistant.',
    'Generate a concise, respectful, evidence-grounded B2B outreach draft for owner review and explicit approval.',
    'CRITICAL ANTI-HALLUCINATION RULES:',
    '1. NEVER invent company achievements, awards, funding rounds, customer counts, partnerships, or news not explicitly present in the provided CRM evidence.',
    '2. NEVER claim prior conversations, calls, meetings, or referrals unless explicitly present in the CRM interaction history.',
    '3. NEVER invent missing recipient names, roles, emails, or phone numbers.',
    '4. If recipient or context details are sparse, keep the message straightforward and honest rather than embellishing.',
    '5. Do NOT include any unsubscribe footer yourself (the system appends verified compliance footers deterministically).',
    '6. Return strictly valid JSON with keys: subject (string), body (string), personalizationEvidence (array of {statement, classification, sourceLabel}), unknownsAndCaveats (string[]).',
    'Allowed classifications: "verified_fact", "source_reported", "ai_analysis", "hypothesis".',
  ].join('\n');

  const prompt = [
    `Campaign: ${campaign.name}`,
    `Campaign Objective: ${campaign.objective}`,
    campaign.description ? `Campaign Description: ${campaign.description}` : '',
    `Channel: ${channel} | Draft Type: ${draftType} | Tone: ${tone} | Sequence Step: ${stepNumber}`,
    `Sender Name: ${senderDisplayName}`,
    recipientName ? `Recipient: ${recipientName}${recipientRole ? ` (${recipientRole})` : ''}` : 'Recipient: General company contact (no specific person assigned)',
    step?.subjectTemplate ? `Reference Subject Template: ${renderOutreachTemplate(step.subjectTemplate, templateVars)}` : '',
    step?.bodyTemplate ? `Reference Body Template:\n${renderOutreachTemplate(step.bodyTemplate, templateVars)}` : '',
    params.customInstructions || step?.customInstructions
      ? `Owner Custom Instructions: ${params.customInstructions || step?.customInstructions}`
      : '',
    icpEvidenceLine ? `ICP Fit Note: ${icpEvidenceLine}` : '',
    '',
    'AUTHORIZED CRM CONTEXT (ONLY USE FACTS BELOW):',
    ctx.promptContextText,
  ]
    .filter(Boolean)
    .join('\n');

  const aiRes = await generateStructuredJsonWithAi<AiOutreachDraftPayload>({
    systemInstruction,
    prompt,
    timeoutMs: 18000,
  });

  if (aiRes.data && typeof aiRes.data.body === 'string' && aiRes.data.body.trim().length > 15) {
    const allowedClasses = new Set<AiClaimItem['classification']>([
      'verified_fact',
      'source_reported',
      'ai_analysis',
      'hypothesis',
    ]);
    const aiEvidence: AiClaimItem[] = Array.isArray(aiRes.data.personalizationEvidence)
      ? aiRes.data.personalizationEvidence
          .filter((c) => c && typeof c.statement === 'string' && c.statement.trim().length > 0)
          .slice(0, 8)
          .map((c) => ({
            statement: c.statement.trim().slice(0, 300),
            classification: allowedClasses.has(c.classification) ? c.classification : 'ai_analysis',
            evidenceRefIds: [leadEvId],
          }))
      : [];

    const mergedCaveats = Array.from(
      new Set([
        ...unknownsAndCaveats,
        ...(Array.isArray(aiRes.data.unknownsAndCaveats)
          ? aiRes.data.unknownsAndCaveats.map((s) => String(s || '').trim()).filter(Boolean)
          : []),
      ])
    ).slice(0, 8);

    const subject =
      (typeof aiRes.data.subject === 'string' && aiRes.data.subject.trim()) ||
      deterministicDraft.subject;
    const bodyWithFooter = appendComplianceFooters(aiRes.data.body.trim(), complianceConfig, channel);

    return {
      subject: subject.slice(0, 220),
      body: bodyWithFooter,
      personalizationEvidence: aiEvidence.length > 0 ? [...baseClaims, ...aiEvidence].slice(0, 12) : baseClaims,
      unknownsAndCaveats: mergedCaveats,
      evidenceSources: ctx.evidenceSources,
      contextAudit: ctx.contextAudit,
      aiStatus: {
        mode: aiRes.meta.mode,
        model: aiRes.meta.model,
        warning: aiRes.meta.warning,
      },
    };
  }

  const bodyWithFooter = appendComplianceFooters(deterministicDraft.body, complianceConfig, channel);
  return {
    subject: deterministicDraft.subject,
    body: bodyWithFooter,
    personalizationEvidence: baseClaims,
    unknownsAndCaveats,
    evidenceSources: ctx.evidenceSources,
    contextAudit: ctx.contextAudit,
    aiStatus: {
      mode: 'deterministic_fallback',
      model: aiRes.meta.model,
      warning: aiRes.meta.warning,
    },
  };
}

function buildDeterministicGroundedDraft(params: {
  campaign: OutreachCampaignV2;
  lead: CanonicalLead;
  recipientName?: string;
  recipientRole?: string;
  step?: OutreachSequenceStep;
  stepNumber: number;
  channel: OutreachChannelV2;
  tone: AiDraftTone;
  senderDisplayName: string;
  templateVars: Record<string, string | undefined>;
  latestInteractionSummary?: string;
}): { subject: string; body: string } {
  const {
    campaign,
    lead,
    recipientName,
    recipientRole,
    step,
    stepNumber,
    channel,
    tone,
    senderDisplayName,
    templateVars,
    latestInteractionSummary,
  } = params;

  if (step?.bodyTemplate && step.bodyTemplate.trim().length > 10) {
    const renderedSubject = step.subjectTemplate
      ? renderOutreachTemplate(step.subjectTemplate, templateVars)
      : `${campaign.objective.slice(0, 70)} — ${lead.companyName}`;
    const renderedBody = renderOutreachTemplate(step.bodyTemplate, templateVars);
    return { subject: renderedSubject, body: renderedBody };
  }

  const greeting = recipientName
    ? tone === 'executive'
      ? `Hello ${recipientName},`
      : `Hi ${recipientName},`
    : `Hello ${lead.companyName} team,`;

  const industryPhrase = lead.industry ? ` in ${lead.industry}` : '';
  const locationPhrase =
    lead.address?.city && lead.address?.country
      ? ` based in ${lead.address.city}, ${lead.address.country}`
      : lead.address?.country
      ? ` in ${lead.address.country}`
      : '';

  if (channel === 'linkedin') {
    return {
      subject: `LinkedIn Draft — ${lead.companyName}`,
      body: [
        greeting,
        '',
        `I reviewed ${lead.companyName}${industryPhrase}${locationPhrase}${
          recipientRole ? ` and noted your role as ${recipientRole}` : ''
        }.`,
        `I am reaching out regarding ${campaign.objective}. Would you be open to a brief introductory exchange?`,
        '',
        `Best regards,`,
        senderDisplayName,
      ].join('\n'),
    };
  }

  if (stepNumber > 1) {
    const subject = `Following up: ${campaign.objective.slice(0, 65)} (${lead.companyName})`;
    const body = [
      greeting,
      '',
      `I wanted to follow up on my earlier note regarding ${campaign.objective} for ${lead.companyName}.`,
      latestInteractionSummary
        ? `Context from our latest recorded note: ${latestInteractionSummary.slice(0, 140)}.`
        : 'I understand priorities shift, so please let me know if a brief 15-minute conversation makes sense or if another colleague is a better point of contact.',
      '',
      `Best regards,`,
      senderDisplayName,
    ].join('\n');
    return { subject, body };
  }

  const subject = `${campaign.objective.slice(0, 72)} — ${lead.companyName}`;
  const body = [
    greeting,
    '',
    `I am reaching out to ${lead.companyName}${industryPhrase}${locationPhrase} regarding ${campaign.objective}.`,
    lead.webMetadata?.description
      ? `From your public company overview, your focus aligns closely with what we are exploring.`
      : `Based on our research of ${lead.companyName}, I would welcome the chance to explore whether there is a practical fit.`,
    '',
    'Would you be open to a brief introductory call next week, or could you point me toward the right person on your team?',
    '',
    'Best regards,',
    senderDisplayName,
  ].join('\n');

  return { subject, body };
}
