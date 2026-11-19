// Phase 15: Suppression, Opt-Out, Contact Frequency & Compliance Engine
// Enforced strictly before enrollment, draft generation for sending, approval, and dispatch.

import type {
  AppSettings,
  CanonicalLead,
  OutreachChannelV2,
  OutreachComplianceConfig,
  OutreachMessageComplianceCheck,
  OutreachSuppressionEntry,
  OutreachSuppressionScopeV2,
  OutreachSuppressionTypeV2,
  OutreachWorkspaceState,
  PersonRecord,
} from '../types.js';
import { getEntityRelationshipMeta } from '../crm/crmStoreHelper.js';
import { generateOutreachId } from './outreachStoreHelper.js';

const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY_MS = 86_400_000;

export function normalizeEmail(email?: string): string | undefined {
  if (!email) return undefined;
  const cleaned = email.trim().toLowerCase();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function extractDomainFromEmailOrUrl(email?: string, domainOrUrl?: string): string | undefined {
  if (email && email.includes('@')) {
    const part = email.trim().toLowerCase().split('@')[1];
    if (part) return part.replace(/^www\./, '');
  }
  if (domainOrUrl) {
    try {
      const url = domainOrUrl.startsWith('http') ? domainOrUrl : `https://${domainOrUrl}`;
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return domainOrUrl.trim().toLowerCase().replace(/^www\./, '') || undefined;
    }
  }
  return undefined;
}

export function isEmailSyntaxValid(email?: string): boolean {
  if (!email) return false;
  return SIMPLE_EMAIL_REGEX.test(email.trim());
}

export interface SuppressionCheckResult {
  suppressed: boolean;
  matchedEntries: OutreachSuppressionEntry[];
  reasons: string[];
}

export function checkSuppressionStatus(params: {
  ws: OutreachWorkspaceState;
  settings: AppSettings;
  lead?: CanonicalLead | null;
  person?: PersonRecord | null;
  recipientEmail?: string;
  campaignId?: string;
}): SuppressionCheckResult {
  const { ws, settings, lead, person, campaignId } = params;
  const emailNorm = normalizeEmail(params.recipientEmail || person?.email || lead?.email);
  const domainNorm = extractDomainFromEmailOrUrl(emailNorm, lead?.domain || lead?.website);
  const matchedEntries: OutreachSuppressionEntry[] = [];
  const reasons: string[] = [];

  if (lead?.status === 'do_not_contact') {
    reasons.push(`Company "${lead.companyName}" is marked do_not_contact in LEED CRM.`);
  }

  if (lead) {
    const relMeta = getEntityRelationshipMeta(lead.customFields, lead.tags);
    if (relMeta.relationshipStatus === 'archived') {
      reasons.push(`Company "${lead.companyName}" relationship status is archived.`);
    }
  }

  if (domainNorm && Array.isArray(settings.suppressionDomains)) {
    const suppressedDomains = settings.suppressionDomains.map((d) => d.trim().toLowerCase().replace(/^www\./, ''));
    if (suppressedDomains.includes(domainNorm)) {
      reasons.push(`Domain "${domainNorm}" is on global LEED suppressionDomains list.`);
    }
  }

  for (const entry of ws.suppressions) {
    if (!entry.active) continue;
    if (entry.scope === 'campaign' && entry.campaignId && campaignId && entry.campaignId !== campaignId) {
      continue;
    }
    if (entry.scope === 'campaign' && !campaignId) {
      continue;
    }

    const emailHit = Boolean(emailNorm && entry.email && normalizeEmail(entry.email) === emailNorm);
    const domainHit = Boolean(
      domainNorm &&
        entry.domain &&
        entry.domain.trim().toLowerCase().replace(/^www\./, '') === domainNorm
    );
    const leadHit = Boolean(lead?.id && entry.leadId && entry.leadId === lead.id);
    const personHit = Boolean(person?.id && entry.personId && entry.personId === person.id);

    if (emailHit || domainHit || leadHit || personHit) {
      matchedEntries.push(entry);
      const scopeLabel = entry.scope === 'global' ? 'Global' : 'Campaign';
      reasons.push(`${scopeLabel} suppression (${entry.type}): ${entry.reason}`);
    }
  }

  return {
    suppressed: reasons.length > 0,
    matchedEntries,
    reasons,
  };
}

export interface FrequencyCheckResult {
  exceeded: boolean;
  companyContactsLast7Days: number;
  personContactsLast14Days: number;
  reasons: string[];
}

export function checkContactFrequencyLimits(params: {
  ws: OutreachWorkspaceState;
  leadId: string;
  personId?: string;
  now?: Date;
}): FrequencyCheckResult {
  const { ws, leadId, personId } = params;
  const nowMs = (params.now || new Date()).getTime();
  const cfg = ws.complianceConfig;
  const sevenDaysAgo = nowMs - 7 * DAY_MS;
  const fourteenDaysAgo = nowMs - 14 * DAY_MS;

  let companyCount = 0;
  let personCount = 0;

  for (const msg of ws.messages) {
    if (msg.status !== 'sent' && msg.status !== 'manual_sent') continue;
    const sentMs = msg.sentAt ? new Date(msg.sentAt).getTime() : new Date(msg.updatedAt).getTime();
    if (!Number.isFinite(sentMs)) continue;
    if (msg.leadId === leadId && sentMs >= sevenDaysAgo) {
      companyCount++;
    }
    if (personId && msg.personId === personId && sentMs >= fourteenDaysAgo) {
      personCount++;
    }
  }

  const reasons: string[] = [];
  if (cfg.maxContactsPerCompanyPerWeek > 0 && companyCount >= cfg.maxContactsPerCompanyPerWeek) {
    reasons.push(
      `Company contact frequency limit reached (${companyCount}/${cfg.maxContactsPerCompanyPerWeek} dispatched in the last 7 days).`
    );
  }
  if (
    personId &&
    cfg.maxContactsPerPersonPer14Days > 0 &&
    personCount >= cfg.maxContactsPerPersonPer14Days
  ) {
    reasons.push(
      `Person contact frequency limit reached (${personCount}/${cfg.maxContactsPerPersonPer14Days} dispatched in the last 14 days).`
    );
  }

  return {
    exceeded: reasons.length > 0,
    companyContactsLast7Days: companyCount,
    personContactsLast14Days: personCount,
    reasons,
  };
}

export function evaluateOutreachCompliance(params: {
  ws: OutreachWorkspaceState;
  settings: AppSettings;
  lead?: CanonicalLead | null;
  person?: PersonRecord | null;
  recipientEmail?: string;
  recipientEmailStatus?: string;
  channel: OutreachChannelV2;
  campaignId?: string;
  subject?: string;
  body?: string;
  checkFrequency?: boolean;
  now?: Date;
}): OutreachMessageComplianceCheck {
  const blockedReasons: string[] = [];
  const warnings: string[] = [];
  const cfg = params.ws.complianceConfig;

  const suppression = checkSuppressionStatus({
    ws: params.ws,
    settings: params.settings,
    lead: params.lead,
    person: params.person,
    recipientEmail: params.recipientEmail,
    campaignId: params.campaignId,
  });

  if (suppression.suppressed) {
    blockedReasons.push(...suppression.reasons);
  }

  if (params.channel === 'email') {
    const email = normalizeEmail(params.recipientEmail || params.person?.email || params.lead?.email);
    if (!email) {
      blockedReasons.push('Missing recipient email address for email channel.');
    } else if (!isEmailSyntaxValid(email)) {
      blockedReasons.push(`Recipient email "${email}" fails syntax validation.`);
    }

    const emailStatus = params.recipientEmailStatus || params.person?.emailStatus || params.lead?.emailStatus;
    if (emailStatus === 'unavailable') {
      blockedReasons.push('Recipient email status is marked unavailable.');
    } else if (emailStatus !== 'verified') {
      warnings.push(
        `Recipient email verification status is "${emailStatus || 'unverified'}". Confirm accuracy before approving dispatch.`
      );
    }
  } else if (params.channel === 'linkedin') {
    warnings.push(
      'LinkedIn channel is strictly manual-draft only. Automated LinkedIn sending is disabled by LEED compliance policy.'
    );
  }

  if (params.checkFrequency !== false && params.lead?.id) {
    const freq = checkContactFrequencyLimits({
      ws: params.ws,
      leadId: params.lead.id,
      personId: params.person?.id,
      now: params.now,
    });
    if (freq.exceeded) {
      blockedReasons.push(...freq.reasons);
    }
  }

  if (params.channel === 'email' && params.body) {
    const lowerBody = params.body.toLowerCase();
    if (
      cfg.includeUnsubscribeFooter &&
      !lowerBody.includes('unsubscribe') &&
      !lowerBody.includes('opt out') &&
      !lowerBody.includes('opt-out') &&
      !lowerBody.includes('not to receive')
    ) {
      warnings.push(
        'Message body does not contain an explicit opt-out / unsubscribe instruction. Consider including sender unsubscribe notice.'
      );
    }
  }

  if (!cfg.senderOrganization && !cfg.senderDisplayName) {
    warnings.push('Configure sender display name and organization in Compliance Settings for transparent identification.');
  }

  warnings.push(
    'Compliance reminder: Publicly listed business contact information does not constitute blanket permission for unsolicited bulk marketing; verify jurisdictional B2B rules before approving.'
  );

  return {
    passed: blockedReasons.length === 0,
    warnings,
    blockedReasons,
    checkedAt: new Date().toISOString(),
  };
}

export function appendComplianceFooters(body: string, cfg: OutreachComplianceConfig, channel: OutreachChannelV2): string {
  if (channel !== 'email') return body;
  let out = body.trim();
  const lower = out.toLowerCase();

  if (cfg.includeIdentificationFooter) {
    const idParts = [cfg.senderDisplayName, cfg.senderOrganization, cfg.senderPhysicalAddress]
      .map((s) => (s || '').trim())
      .filter(Boolean);
    if (idParts.length > 0 && !lower.includes(idParts[0].toLowerCase())) {
      out += `\n\n—\n${idParts.join(' | ')}`;
    }
  }

  if (
    cfg.includeUnsubscribeFooter &&
    cfg.unsubscribeNoticeText.trim() &&
    !lower.includes('unsubscribe') &&
    !lower.includes('not to receive')
  ) {
    out += `\n\n${cfg.unsubscribeNoticeText.trim()}`;
  }

  return out;
}

export function createSuppressionRecord(input: {
  scope: OutreachSuppressionScopeV2;
  campaignId?: string;
  type: OutreachSuppressionTypeV2;
  email?: string;
  domain?: string;
  leadId?: string;
  personId?: string;
  companyName?: string;
  personName?: string;
  reason: string;
  createdBy: string;
}): OutreachSuppressionEntry {
  const now = new Date().toISOString();
  return {
    id: generateOutreachId('supp'),
    scope: input.scope,
    campaignId: input.scope === 'campaign' ? input.campaignId : undefined,
    type: input.type,
    email: normalizeEmail(input.email),
    domain: input.domain ? input.domain.trim().toLowerCase().replace(/^www\./, '') : undefined,
    leadId: input.leadId?.trim() || undefined,
    personId: input.personId?.trim() || undefined,
    companyName: input.companyName?.trim() || undefined,
    personName: input.personName?.trim() || undefined,
    reason: input.reason.trim().slice(0, 400),
    active: true,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}
