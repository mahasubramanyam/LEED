import crypto from 'node:crypto';
import {
  AttributeProvenanceEntry,
  AttributeProvenanceType,
  CanonicalLead,
  CompanyEnrichmentPreviewResponse,
  CompanyPersonRelationship,
  EmailVerificationResult,
  EnrichmentConflictRecord,
  EnrichmentFieldProposal,
  EnrichmentHistoryEntry,
  EnrichmentProviderRunSummary,
  PersonEnrichmentPreviewResponse,
  PersonRecord,
  PhoneVerificationResult,
} from '../types.js';
import { ConnectorConfigRecord } from '../connectors/core/types.js';
import { ConnectorRegistry, connectorRegistry as defaultRegistry } from '../connectors/core/registry.js';
import {
  ConnectorExecutionEngine,
  connectorExecutionEngine as defaultExecutionEngine,
  RunRecorderFn,
} from '../connectors/core/executionEngine.js';
import { CredentialManager, credentialManager as defaultCredentialManager } from '../connectors/core/credentialManager.js';
import { verifyLeadWithOfficialRegistry } from '../verification/registryVerificationService.js';
import { inspectWebsite, WebInspectionResult } from '../connectors/webInspector.js';
import { ApolloPeopleConnector } from '../connectors/adapters/apolloPeopleAdapter.js';
import { verifyBusinessEmail, EmailDnsHooks } from './emailVerifier.js';
import { verifyBusinessPhone } from './phoneVerifier.js';
import { evaluateCompanyDataQuality, evaluatePersonDataQuality } from './dataQualityEngine.js';
import {
  ExistingAttributeSnapshot,
  IncomingEnrichmentCandidate,
  resolveEnrichmentProposalsAndConflicts,
} from './conflictResolver.js';
import { analyzeEnrichmentEvidenceWithAi } from '../gemini.js';
import type { DnsLookupAllFn } from '../security/ssrf.js';

export const MAX_BULK_ENRICHMENT_BATCH = 20;

export interface EnrichmentOrchestratorOptions {
  registry?: ConnectorRegistry;
  executionEngine?: ConnectorExecutionEngine;
  credentialManager?: CredentialManager;
  configs?: Record<string, ConnectorConfigRecord>;
  userAgent?: string;
  onRecordRun?: RunRecorderFn;
  runRegistryVerification?: boolean;
  runWebsiteInspection?: boolean;
  runEmailVerification?: boolean;
  runPhoneVerification?: boolean;
  runAiAssistance?: boolean;
  checkRobots?: boolean;
  fetchFn?: typeof fetch;
  dnsLookupAll?: DnsLookupAllFn;
  emailDnsHooks?: EmailDnsHooks;
  nowMs?: number;
}

function parseJsonField<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function inferExistingSourceTypeForLead(
  lead: CanonicalLead,
  field: string,
  attrSources: Record<string, { sourceType?: string; sourceName?: string; retrievedAt?: string; verifiedAt?: string }>
): { sourceType: AttributeProvenanceType; sourceName: string; lastVerifiedAt?: string } {
  const fromAttr = attrSources[field];
  if (fromAttr?.sourceType) {
    return {
      sourceType: fromAttr.sourceType as AttributeProvenanceType,
      sourceName: fromAttr.sourceName || 'Stored Provenance',
      lastVerifiedAt: fromAttr.verifiedAt || fromAttr.retrievedAt,
    };
  }
  const hasVerifiedRegistry =
    lead.customFields?.registryVerificationState === 'officially_verified' ||
    (lead.identifiers || []).some((i) => i.verified || i.status === 'officially_verified');

  if (
    hasVerifiedRegistry &&
    ['legalName', 'registrationNumber', 'companyStatus', 'registeredAddress', 'foundedYear'].includes(field)
  ) {
    return {
      sourceType: 'official_registry',
      sourceName: lead.sources?.[0]?.sourceName || 'Official Registry',
      lastVerifiedAt: lead.customFields?.lastVerifiedAt || lead.updatedAt,
    };
  }

  if (field === 'website' || field === 'domain' || field === 'description') {
    if (lead.webMetadata?.inspectedAt) {
      return {
        sourceType: 'official_website',
        sourceName: 'Safe Website Inspector',
        lastVerifiedAt: lead.webMetadata.inspectedAt,
      };
    }
  }

  if (field === 'email') {
    const emailMeta = parseJsonField<{ sourceType?: AttributeProvenanceType; sourceName?: string; verifiedAt?: string } | null>(
      lead.customFields?.emailVerificationMeta,
      null
    );
    if (emailMeta?.sourceType) {
      return {
        sourceType: emailMeta.sourceType,
        sourceName: emailMeta.sourceName || 'Email Verifier',
        lastVerifiedAt: emailMeta.verifiedAt,
      };
    }
    if (lead.emailStatus === 'verified') {
      return {
        sourceType: 'authorized_verification_provider',
        sourceName: 'Previous Email Verification',
        lastVerifiedAt: lead.updatedAt,
      };
    }
  }

  if (field === 'phone') {
    const phoneMeta = parseJsonField<{ sourceType?: AttributeProvenanceType; sourceName?: string; verifiedAt?: string } | null>(
      lead.customFields?.phoneVerificationMeta,
      null
    );
    if (phoneMeta?.sourceType) {
      return {
        sourceType: phoneMeta.sourceType,
        sourceName: phoneMeta.sourceName || 'Phone Verifier',
        lastVerifiedAt: phoneMeta.verifiedAt,
      };
    }
  }

  return {
    sourceType: lead.sources?.[0]?.sourceName?.toLowerCase().includes('import')
      ? 'owner_manual'
      : 'business_directory',
    sourceName: lead.sources?.[0]?.sourceName || 'Existing CRM Record',
    lastVerifiedAt: lead.updatedAt,
  };
}

function buildExistingLeadSnapshots(lead: CanonicalLead): Record<string, ExistingAttributeSnapshot> {
  const cf = lead.customFields || {};
  const attrSources = parseJsonField<Record<string, { sourceType?: string; sourceName?: string; retrievedAt?: string; verifiedAt?: string }>>(
    cf.attributeSources,
    {}
  );

  const values: Record<string, string | undefined> = {
    legalName: lead.legalName,
    tradingName: cf.tradingName,
    legalEntityType: cf.legalEntityType,
    registrationNumber: lead.registrationNumber,
    taxVatId: cf.taxVatId || lead.identifiers?.find((i) => i.type.includes('VAT'))?.value,
    lei: cf.lei || lead.identifiers?.find((i) => i.type === 'LEI')?.value,
    companyStatus: lead.companyStatus && lead.companyStatus !== 'unknown' ? lead.companyStatus : undefined,
    incorporationDate: cf.incorporationDate || (lead.foundedYear ? String(lead.foundedYear) : undefined),
    registeredAddress: lead.address?.formattedAddress || [lead.address?.street, lead.address?.city, lead.address?.postalCode].filter(Boolean).join(', ') || undefined,
    operatingAddress: cf.operatingAddress,
    website: lead.website,
    domain: lead.domain,
    email: lead.email,
    phone: lead.phoneNormalized || lead.phone,
    industry: lead.industry && lead.industry !== 'Commercial Services' ? lead.industry : undefined,
    description: lead.webMetadata?.description || cf.businessDescription,
    productsServices: (lead.webMetadata?.productsServices || []).join('; ') || cf.productsServices,
    employeeRange: lead.employeeRange,
    revenueRange: cf.revenueRange,
    certifications: (lead.webMetadata?.certificationsFound || []).join(', ') || cf.certifications,
    tradeActivity: (lead.webMetadata?.tradeActivitySignals || []).join('; ') || cf.tradeActivity,
    careersUrl: lead.webMetadata?.careersPageUrl || cf.careersUrl,
    parentCompany: cf.parentCompany,
    'socialLinks.linkedin': lead.socialLinks?.linkedin,
    'socialLinks.twitter': lead.socialLinks?.twitter,
    'socialLinks.github': lead.socialLinks?.github,
  };

  const out: Record<string, ExistingAttributeSnapshot> = {};
  for (const [field, val] of Object.entries(values)) {
    const meta = inferExistingSourceTypeForLead(lead, field, attrSources);
    out[field] = {
      value: val,
      sourceType: val ? meta.sourceType : undefined,
      sourceName: val ? meta.sourceName : undefined,
      lastVerifiedAt: val ? meta.lastVerifiedAt : undefined,
    };
  }
  return out;
}

/**
 * Multi-Source Company Enrichment Preview Orchestrator.
 * Executes legitimate, configured providers, detects conflicts using attribute-specific precedence,
 * calculates before/after Data Quality scores, and NEVER writes to CRM until explicit owner approval.
 */
export async function previewCompanyEnrichment(
  lead: CanonicalLead,
  options: EnrichmentOrchestratorOptions = {}
): Promise<CompanyEnrichmentPreviewResponse> {
  const startMs = Date.now();
  const nowMs = options.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const registry = options.registry || defaultRegistry;
  const executionEngine = options.executionEngine || defaultExecutionEngine;
  const credMgr = options.credentialManager || defaultCredentialManager;

  const qualityBefore = evaluateCompanyDataQuality(lead, { nowMs });
  const providerRuns: EnrichmentProviderRunSummary[] = [];
  const failedVerifications: Array<{ provider: string; reason: string; existingDataPreserved: boolean }> = [];
  const incoming: IncomingEnrichmentCandidate[] = [];

  // 1. Official Corporate Registry Verification (reusing Phase 9 verifyLeadWithOfficialRegistry)
  if (options.runRegistryVerification !== false) {
    const regStart = Date.now();
    try {
      const regReport = await verifyLeadWithOfficialRegistry(lead, {
        registry,
        executionEngine,
        configs: options.configs,
        userAgent: options.userAgent,
        onRecordRun: options.onRecordRun,
      });

      const contributed: string[] = [];
      if (regReport.matchedRecord) {
        const mr = regReport.matchedRecord;
        const srcName = regReport.sourceName || 'Official Registry';
        const srcUrl = regReport.sourceUrl;
        const connId = regReport.connectorId;
        const srcType: AttributeProvenanceType =
          regReport.state === 'officially_verified' ? 'official_registry' : 'business_directory';
        const conf = regReport.state === 'officially_verified' ? 95 : 72;

        if (mr.legalName) {
          incoming.push({ field: 'legalName', label: 'Legal Company Name', value: mr.legalName, sourceType: srcType, sourceName: srcName, sourceUrl: srcUrl, connectorId: connId, confidenceScore: conf, retrievedAt: generatedAt });
          contributed.push('legalName');
        }
        if (mr.registrationNumber) {
          incoming.push({ field: 'registrationNumber', label: 'Registration Number', value: mr.registrationNumber, sourceType: srcType, sourceName: srcName, sourceUrl: srcUrl, connectorId: connId, confidenceScore: conf, retrievedAt: generatedAt });
          contributed.push('registrationNumber');
        }
        if (mr.companyStatus && mr.companyStatus !== 'unknown') {
          incoming.push({ field: 'companyStatus', label: 'Company Operating Status', value: mr.companyStatus, sourceType: srcType, sourceName: srcName, sourceUrl: srcUrl, connectorId: connId, confidenceScore: conf, retrievedAt: generatedAt });
          contributed.push('companyStatus');
        }
        if (mr.address?.formattedAddress) {
          incoming.push({ field: 'registeredAddress', label: 'Registered Address', value: mr.address.formattedAddress, sourceType: srcType, sourceName: srcName, sourceUrl: srcUrl, connectorId: connId, confidenceScore: conf, retrievedAt: generatedAt });
          contributed.push('registeredAddress');
        }
        if (mr.industry) {
          incoming.push({ field: 'industry', label: 'Industry / NACE / SIC', value: mr.industry, sourceType: srcType, sourceName: srcName, sourceUrl: srcUrl, connectorId: connId, confidenceScore: conf - 5, retrievedAt: generatedAt });
          contributed.push('industry');
        }
        if (mr.foundedYear) {
          incoming.push({ field: 'incorporationDate', label: 'Incorporation Year / Date', value: String(mr.foundedYear), sourceType: srcType, sourceName: srcName, sourceUrl: srcUrl, connectorId: connId, confidenceScore: conf, retrievedAt: generatedAt });
          contributed.push('incorporationDate');
        }
        if (mr.employeeRange) {
          incoming.push({ field: 'employeeRange', label: 'Employee Size Range', value: mr.employeeRange, sourceType: srcType, sourceName: srcName, sourceUrl: srcUrl, connectorId: connId, confidenceScore: conf - 8, retrievedAt: generatedAt });
          contributed.push('employeeRange');
        }
      }

      const isMissingCreds = Boolean(regReport.authRequired && regReport.state !== 'officially_verified');
      providerRuns.push({
        providerId: regReport.connectorId || 'registry-router',
        providerName: regReport.sourceName || 'Official Registry Verification',
        status: isMissingCreds
          ? 'skipped_missing_credentials'
          : contributed.length > 0
          ? 'success'
          : 'no_results',
        durationMs: Date.now() - regStart,
        attributesContributed: contributed,
        message: regReport.summary,
      });
    } catch (err: any) {
      const reason = err?.message || 'Registry verification request failed';
      failedVerifications.push({
        provider: 'Official Registry Verification',
        reason,
        existingDataPreserved: true,
      });
      providerRuns.push({
        providerId: 'registry-router',
        providerName: 'Official Registry Verification',
        status: err?.category === 'rate_limited' ? 'rate_limited' : err?.category === 'timeout' ? 'timeout' : 'error',
        durationMs: Date.now() - regStart,
        attributesContributed: [],
        message: reason,
      });
    }
  }

  // 2. Upgraded Website & Domain Intelligence (reusing Phase 10/11 SSRF-protected Website Inspector)
  let webRes: WebInspectionResult | undefined;
  let websiteSummary: CompanyEnrichmentPreviewResponse['websiteSummary'];
  const targetUrl = lead.website || (lead.domain ? `https://${lead.domain}` : undefined);

  if (options.runWebsiteInspection !== false && targetUrl) {
    const webStart = Date.now();
    try {
      webRes = await inspectWebsite(targetUrl, {
        dnsLookupAll: options.dnsLookupAll,
        fetchFn: options.fetchFn,
        userAgent: options.userAgent,
        checkRobots: options.checkRobots ?? true,
        maxPages: 5,
        expectedCompanyName: lead.legalName || lead.companyName,
      });

      const contributed: string[] = [];
      if (!webRes.securityCheck.passed) {
        const reason = webRes.securityCheck.reason || 'Blocked by SSRF guard';
        failedVerifications.push({
          provider: 'Safe Website Inspector',
          reason,
          existingDataPreserved: true,
        });
        providerRuns.push({
          providerId: 'conn-web-inspector',
          providerName: 'Safe Website Inspector',
          status: 'error',
          durationMs: Date.now() - webStart,
          attributesContributed: [],
          message: reason,
        });
      } else if (!webRes.isOnline) {
        const reason = webRes.securityCheck.reason || `Website unreachable (HTTP ${webRes.httpStatus || 'timeout'})`;
        failedVerifications.push({
          provider: 'Safe Website Inspector',
          reason,
          existingDataPreserved: true,
        });
        providerRuns.push({
          providerId: 'conn-web-inspector',
          providerName: 'Safe Website Inspector',
          status: 'error',
          durationMs: Date.now() - webStart,
          attributesContributed: [],
          message: reason,
        });
      } else {
        const addWeb = (field: string, label: string, value?: string, conf = 84) => {
          if (!value || !value.trim()) return;
          incoming.push({
            field,
            label,
            value: value.trim(),
            sourceType: 'official_website',
            sourceName: 'Safe Website Inspector',
            sourceUrl: webRes!.url,
            connectorId: 'conn-web-inspector',
            confidenceScore: conf,
            retrievedAt: generatedAt,
          });
          contributed.push(field);
        };

        addWeb('domain', 'Canonical Domain', webRes.canonicalDomain || webRes.domain, 88);
        addWeb('description', 'Business Description', webRes.description, 82);
        if (webRes.productsServices && webRes.productsServices.length > 0) {
          addWeb('productsServices', 'Products & Services', webRes.productsServices.join('; '), 80);
        }
        if (webRes.certificationsFound && webRes.certificationsFound.length > 0) {
          addWeb('certifications', 'Business Certifications', webRes.certificationsFound.join(', '), 85);
        }
        if (webRes.tradeActivitySignals && webRes.tradeActivitySignals.length > 0) {
          addWeb('tradeActivity', 'Export / Import & Trade Signals', webRes.tradeActivitySignals.join('; '), 78);
        }
        if (webRes.businessSizeIndicators && webRes.businessSizeIndicators.length > 0 && !lead.employeeRange) {
          addWeb('employeeRange', 'Published Size Indicator', webRes.businessSizeIndicators[0], 72);
        }
        if (webRes.careersPageUrl) {
          addWeb('careersUrl', 'Careers Page URL', webRes.careersPageUrl, 84);
        }
        if (webRes.emailsFound.length > 0) {
          addWeb('email', 'General Business Email', webRes.emailsFound[0], 82);
        }
        if (webRes.phonesFound.length > 0) {
          addWeb('phone', 'Business Telephone', webRes.phonesFound[0], 80);
        }
        if (webRes.addressesFound && webRes.addressesFound.length > 0) {
          addWeb('operatingAddress', 'Operating Address', webRes.addressesFound[0], 78);
        }
        if (webRes.socialLinks.linkedin) {
          addWeb('socialLinks.linkedin', 'Official LinkedIn Company Page', webRes.socialLinks.linkedin, 84);
        }
        if (webRes.socialLinks.twitter) {
          addWeb('socialLinks.twitter', 'Official X / Twitter Profile', webRes.socialLinks.twitter, 80);
        }
        if (webRes.socialLinks.github) {
          addWeb('socialLinks.github', 'Official GitHub Organization', webRes.socialLinks.github, 80);
        }

        websiteSummary = {
          url: webRes.url,
          isOnline: webRes.isOnline,
          canonicalDomain: webRes.canonicalDomain || webRes.domain,
          redirectChain: webRes.redirectChain,
          companyIdentityConsistent: webRes.companyIdentityConsistent,
          certificationsFound: webRes.certificationsFound,
          industriesServed: webRes.industriesServed,
          businessSizeIndicators: webRes.businessSizeIndicators,
          tradeActivitySignals: webRes.tradeActivitySignals,
          careersPageUrl: webRes.careersPageUrl,
          leadershipCount: webRes.leadershipFound?.length || 0,
        };

        providerRuns.push({
          providerId: 'conn-web-inspector',
          providerName: 'Safe Website Inspector',
          status: contributed.length > 0 ? 'success' : 'no_results',
          durationMs: Date.now() - webStart,
          attributesContributed: contributed,
          message: `Inspected ${webRes.pagesVisited?.length || 1} public page(s) on ${webRes.canonicalDomain || webRes.domain}.`,
        });
      }
    } catch (err: any) {
      const reason = err?.message || 'Website inspection error';
      failedVerifications.push({ provider: 'Safe Website Inspector', reason, existingDataPreserved: true });
      providerRuns.push({
        providerId: 'conn-web-inspector',
        providerName: 'Safe Website Inspector',
        status: 'error',
        durationMs: Date.now() - webStart,
        attributesContributed: [],
        message: reason,
      });
    }
  } else if (options.runWebsiteInspection !== false) {
    providerRuns.push({
      providerId: 'conn-web-inspector',
      providerName: 'Safe Website Inspector',
      status: 'skipped_not_applicable',
      durationMs: 0,
      attributesContributed: [],
      message: 'No website or domain available on company record.',
    });
  }

  // 3. Email Verification (existing lead email or newly observed website business email)
  let emailVerification: EmailVerificationResult | undefined;
  const emailToCheck = lead.email || webRes?.emailsFound?.[0];
  if (options.runEmailVerification !== false && emailToCheck) {
    const emStart = Date.now();
    emailVerification = await verifyBusinessEmail(emailToCheck, {
      registry,
      credentialManager: credMgr,
      dnsHooks: options.emailDnsHooks,
      fetchFn: options.fetchFn,
      dnsLookupAll: options.dnsLookupAll,
      userAgent: options.userAgent,
      companyDomain: webRes?.canonicalDomain || lead.domain,
    });
    if (emailVerification.status === 'verification_failed') {
      failedVerifications.push({
        provider: emailVerification.sourceName,
        reason: emailVerification.honestSummary,
        existingDataPreserved: true,
      });
    }
    providerRuns.push({
      providerId: emailVerification.providerUsed ? 'email-verifier-api' : 'builtin-dns-mx-email',
      providerName: emailVerification.sourceName,
      status: emailVerification.status === 'verification_failed' ? 'error' : 'success',
      durationMs: Date.now() - emStart,
      attributesContributed: ['emailStatus'],
      message: emailVerification.honestSummary,
    });
  }

  // 4. Business Phone Verification (existing lead phone or newly observed website phone)
  let phoneVerification: PhoneVerificationResult | undefined;
  const phoneToCheck = lead.phoneNormalized || lead.phone || webRes?.phonesFound?.[0];
  if (options.runPhoneVerification !== false && phoneToCheck) {
    const phStart = Date.now();
    phoneVerification = await verifyBusinessPhone(phoneToCheck, {
      countryCode: lead.address?.countryCode || 'US',
      registry,
      credentialManager: credMgr,
      fetchFn: options.fetchFn,
      dnsLookupAll: options.dnsLookupAll,
      userAgent: options.userAgent,
      existingPhoneNormalized: lead.phoneNormalized,
    });
    if (phoneVerification.syntaxValid && phoneVerification.e164) {
      incoming.push({
        field: 'phone',
        label: 'Business Telephone (E.164)',
        value: phoneVerification.e164,
        sourceType: phoneVerification.sourceType,
        sourceName: phoneVerification.sourceName,
        confidenceScore: phoneVerification.status === 'provider_verified' ? 92 : 76,
        retrievedAt: generatedAt,
      });
    }
    providerRuns.push({
      providerId: phoneVerification.providerUsed ? 'conn-numverify-phone' : 'builtin-e164-phone',
      providerName: phoneVerification.sourceName,
      status: phoneVerification.syntaxValid ? 'success' : 'error',
      durationMs: Date.now() - phStart,
      attributesContributed: phoneVerification.syntaxValid ? ['phone', 'phoneNormalized'] : [],
      message: phoneVerification.honestSummary,
    });
  }

  // 5. Attribute-Specific Precedence & Conflict Resolution
  const existingSnapshots = buildExistingLeadSnapshots(lead);
  const { proposals, conflicts } = resolveEnrichmentProposalsAndConflicts(
    existingSnapshots,
    incoming,
    nowMs
  );

  // 6. Project Data Quality After Applying Recommended (Non-Conflicting) Proposals
  const projectedLead = applyApprovedCompanyEnrichmentToClone(
    lead,
    proposals.filter((p) => p.defaultSelected),
    [],
    {
      emailVerification,
      phoneVerification,
      websiteSummary,
      providerRuns,
      failedVerifications,
    },
    'Preview Projection',
    nowMs
  );
  const qualityProjectedAfter = evaluateCompanyDataQuality(projectedLead, { nowMs });

  // 7. Optional AI-Assisted Evidence & Quality Analysis (strictly labeled inferred, deterministic fallback)
  let aiAssistance: CompanyEnrichmentPreviewResponse['aiAssistance'];
  if (options.runAiAssistance !== false) {
    aiAssistance = await analyzeEnrichmentEvidenceWithAi({
      companyName: lead.companyName,
      countryCode: lead.address?.countryCode,
      industry: lead.industry,
      missingCriticalFields: qualityBefore.missingCriticalFields,
      staleAttributes: qualityBefore.staleAttributes.map((s) => s.label),
      conflicts: conflicts.map((c) => ({
        field: c.field,
        existingValue: c.existingValue,
        incomingValue: c.incomingValue,
        rationale: c.rationale,
      })),
      qualityBefore,
      websiteDescription: webRes?.description || lead.webMetadata?.description,
      certificationsFound: webRes?.certificationsFound,
      proposalsCount: proposals.length,
    });
  }

  return {
    leadId: lead.id,
    companyName: lead.companyName,
    proposals,
    conflicts,
    emailVerification,
    phoneVerification,
    websiteSummary,
    providerRuns,
    failedVerifications,
    qualityBefore,
    qualityProjectedAfter,
    aiAssistance,
    requiresOwnerApproval: true,
    generatedAt,
    durationMs: Date.now() - startMs,
  };
}

/**
 * Pure helper applying ONLY owner-selected enrichment proposals and conflict decisions onto a lead clone.
 * Preserves previous values and historical sources in enrichmentHistory.
 * Never removes previously verified data when a verification attempt fails.
 */
export function applyApprovedCompanyEnrichmentToClone(
  lead: CanonicalLead,
  approvedProposals: EnrichmentFieldProposal[],
  resolvedConflicts: Array<{ conflictId: string; resolution: 'kept_existing' | 'accepted_incoming' }> = [],
  context: {
    emailVerification?: EmailVerificationResult;
    phoneVerification?: PhoneVerificationResult;
    websiteSummary?: CompanyEnrichmentPreviewResponse['websiteSummary'];
    providerRuns?: EnrichmentProviderRunSummary[];
    failedVerifications?: Array<{ provider: string; reason: string; existingDataPreserved: boolean }>;
    allConflicts?: EnrichmentConflictRecord[];
  } = {},
  actorEmail = 'Owner',
  nowMs: number = Date.now()
): CanonicalLead {
  const nowIso = new Date(nowMs).toISOString();
  const next: CanonicalLead = {
    ...lead,
    address: lead.address ? { ...lead.address } : undefined,
    socialLinks: { ...(lead.socialLinks || {}) },
    webMetadata: { ...(lead.webMetadata || {}) },
    sources: [...(lead.sources || [])],
    identifiers: [...(lead.identifiers || [])],
    activities: [...(lead.activities || [])],
    customFields: { ...(lead.customFields || {}) },
    updatedAt: nowIso,
  };

  const attrSources = parseJsonField<Record<string, any>>(next.customFields!.attributeSources, {});
  const history = parseJsonField<EnrichmentHistoryEntry[]>(next.customFields!.enrichmentHistory, []);
  const fieldsUpdated: EnrichmentHistoryEntry['fieldsUpdated'] = [];

  for (const p of approvedProposals) {
    const prevVal = p.currentValue;
    const prevSrc = p.currentSourceName;

    switch (p.field) {
      case 'legalName':
        next.legalName = p.proposedValue;
        break;
      case 'tradingName':
        next.customFields!.tradingName = p.proposedValue;
        break;
      case 'legalEntityType':
        next.customFields!.legalEntityType = p.proposedValue;
        break;
      case 'registrationNumber':
        next.registrationNumber = p.proposedValue;
        if (p.proposedSourceType === 'official_registry') {
          next.customFields!.registryVerificationState = 'officially_verified';
          next.customFields!.lastVerifiedAt = nowIso;
          if (!next.identifiers.some((i) => i.value === p.proposedValue)) {
            next.identifiers.push({
              type: next.registrationType || 'REG_ID',
              value: p.proposedValue,
              countryCode: next.address?.countryCode,
              source: p.proposedSourceName,
              status: 'officially_verified',
              verified: true,
            });
          }
        }
        break;
      case 'taxVatId':
        next.customFields!.taxVatId = p.proposedValue;
        break;
      case 'lei':
        next.customFields!.lei = p.proposedValue;
        break;
      case 'companyStatus':
        if (['active', 'inactive', 'dissolved', 'unknown'].includes(p.proposedValue)) {
          next.companyStatus = p.proposedValue as CanonicalLead['companyStatus'];
        }
        break;
      case 'incorporationDate': {
        next.customFields!.incorporationDate = p.proposedValue;
        const yr = parseInt(p.proposedValue.slice(0, 4), 10);
        if (!Number.isNaN(yr) && yr >= 1800 && yr <= 2100) next.foundedYear = yr;
        break;
      }
      case 'registeredAddress':
        if (!next.address) {
          next.address = { country: 'International', countryCode: 'US', formattedAddress: p.proposedValue };
        } else {
          next.address.formattedAddress = p.proposedValue;
        }
        break;
      case 'operatingAddress':
        next.customFields!.operatingAddress = p.proposedValue;
        break;
      case 'website':
        next.website = p.proposedValue;
        break;
      case 'domain':
        next.domain = p.proposedValue;
        break;
      case 'email':
        next.email = p.proposedValue;
        break;
      case 'phone':
        next.phone = p.proposedValue;
        if (p.proposedValue.startsWith('+')) next.phoneNormalized = p.proposedValue;
        break;
      case 'industry':
        next.industry = p.proposedValue;
        break;
      case 'description':
        next.webMetadata!.description = p.proposedValue;
        next.customFields!.businessDescription = p.proposedValue;
        break;
      case 'productsServices':
        next.webMetadata!.productsServices = p.proposedValue.split(';').map((s) => s.trim()).filter(Boolean);
        next.customFields!.productsServices = p.proposedValue;
        break;
      case 'employeeRange':
        next.employeeRange = p.proposedValue;
        break;
      case 'revenueRange':
        next.customFields!.revenueRange = p.proposedValue;
        break;
      case 'certifications':
        next.webMetadata!.certificationsFound = p.proposedValue.split(',').map((s) => s.trim()).filter(Boolean);
        next.customFields!.certifications = p.proposedValue;
        break;
      case 'tradeActivity':
        next.webMetadata!.tradeActivitySignals = p.proposedValue.split(';').map((s) => s.trim()).filter(Boolean);
        next.customFields!.tradeActivity = p.proposedValue;
        break;
      case 'careersUrl':
        next.webMetadata!.careersPageUrl = p.proposedValue;
        next.customFields!.careersUrl = p.proposedValue;
        break;
      case 'parentCompany':
        next.customFields!.parentCompany = p.proposedValue;
        break;
      case 'socialLinks.linkedin':
        next.socialLinks!.linkedin = p.proposedValue;
        break;
      case 'socialLinks.twitter':
        next.socialLinks!.twitter = p.proposedValue;
        break;
      case 'socialLinks.github':
        next.socialLinks!.github = p.proposedValue;
        break;
      default:
        next.customFields![p.field] = p.proposedValue;
    }

    attrSources[p.field] = {
      sourceType: p.proposedSourceType,
      sourceName: p.proposedSourceName,
      sourceUrl: p.proposedSourceUrl,
      connectorId: p.proposedConnectorId,
      verificationLabel: p.verificationLabel,
      verifiedAt: nowIso,
      retrievedAt: p.retrievedAt,
      previousValue: prevVal,
      previousSourceName: prevSrc,
    };

    fieldsUpdated.push({
      field: p.field,
      previousValue: prevVal,
      previousSource: prevSrc,
      newValue: p.proposedValue,
      newSource: p.proposedSourceName,
      verificationLabel: p.verificationLabel,
    });

    if (!next.sources.some((s) => s.sourceName === p.proposedSourceName)) {
      next.sources.push({
        sourceName: p.proposedSourceName,
        providerId: p.proposedConnectorId,
        url: p.proposedSourceUrl,
        retrievedAt: p.retrievedAt,
      });
    }
  }

  // Persist honest email verification metadata (NEVER delete existing verified email on failed attempt!)
  if (context.emailVerification) {
    const ev = context.emailVerification;
    if (ev.status !== 'verification_failed') {
      next.customFields!.emailVerificationMeta = JSON.stringify(ev);
      if (ev.crmEmailStatus === 'verified') {
        next.emailStatus = 'verified';
      } else if (next.emailStatus !== 'verified') {
        next.emailStatus = ev.crmEmailStatus;
      }
    }
  }

  // Persist honest phone verification metadata
  if (context.phoneVerification && context.phoneVerification.status !== 'verification_failed') {
    next.customFields!.phoneVerificationMeta = JSON.stringify(context.phoneVerification);
    if (context.phoneVerification.syntaxValid && context.phoneVerification.e164 && !next.phoneNormalized) {
      next.phoneNormalized = context.phoneVerification.e164;
    }
  }

  // Persist website summary metadata
  if (context.websiteSummary && context.websiteSummary.isOnline) {
    next.webMetadata = {
      ...(next.webMetadata || {}),
      inspectedAt: nowIso,
      httpStatus: 200,
      canonicalDomain: context.websiteSummary.canonicalDomain,
      redirectChain: context.websiteSummary.redirectChain,
      companyIdentityConsistent: context.websiteSummary.companyIdentityConsistent,
      certificationsFound: context.websiteSummary.certificationsFound,
      industriesServed: context.websiteSummary.industriesServed,
      businessSizeIndicators: context.websiteSummary.businessSizeIndicators,
      tradeActivitySignals: context.websiteSummary.tradeActivitySignals,
      careersPageUrl: context.websiteSummary.careersPageUrl,
    };
  }

  // Update open conflicts ledger
  const existingConflicts = parseJsonField<EnrichmentConflictRecord[]>(next.customFields!.enrichmentConflicts, []);
  const incomingConflicts = context.allConflicts || [];
  const mergedConflictsMap = new Map<string, EnrichmentConflictRecord>();
  for (const c of [...existingConflicts, ...incomingConflicts]) {
    mergedConflictsMap.set(c.id, { ...c });
  }
  for (const rc of resolvedConflicts) {
    const item = mergedConflictsMap.get(rc.conflictId);
    if (item) item.status = rc.resolution;
  }
  next.customFields!.enrichmentConflicts = JSON.stringify(
    Array.from(mergedConflictsMap.values()).slice(-30)
  );
  next.customFields!.attributeSources = JSON.stringify(attrSources);
  next.customFields!.lastEnrichedAt = nowIso;

  const qualityBefore = evaluateCompanyDataQuality(lead, { nowMs });
  const qualityAfter = evaluateCompanyDataQuality(next, { nowMs });
  next.customFields!.dataQualityScore = String(qualityAfter.overallScore);
  next.customFields!.dataQualityGrade = qualityAfter.grade;

  const entry: EnrichmentHistoryEntry = {
    id: `enr-${crypto.randomBytes(5).toString('hex')}`,
    timestamp: nowIso,
    actor: actorEmail,
    entityType: 'company',
    action:
      fieldsUpdated.length > 0
        ? 'enrichment_applied'
        : context.failedVerifications && context.failedVerifications.length > 0
        ? 'verification_attempt_failed'
        : 'contact_verified',
    providersExecuted: (context.providerRuns || []).map((r) => r.providerName),
    fieldsUpdated,
    failedVerifications: context.failedVerifications,
    conflictsResolved: resolvedConflicts.length,
    qualityScoreBefore: qualityBefore.overallScore,
    qualityScoreAfter: qualityAfter.overallScore,
  };
  history.unshift(entry);
  next.customFields!.enrichmentHistory = JSON.stringify(history.slice(0, 25));

  if (actorEmail !== 'Preview Projection') {
    next.activities.unshift({
      id: `act-${crypto.randomBytes(5).toString('hex')}`,
      type: 'enrichment',
      title: `Phase 12 Enrichment Applied (${fieldsUpdated.length} field${fieldsUpdated.length === 1 ? '' : 's'} updated)`,
      notes: `Quality score: ${qualityBefore.overallScore} → ${qualityAfter.overallScore}/100 (Grade ${qualityAfter.grade}).`,
      outcome: `Approved by ${actorEmail}`,
      date: nowIso,
      actor: actorEmail,
    });
  }

  return next;
}

/**
 * Decision-Maker Contact Enrichment Preview.
 * Reuses Phase 11 PersonRecord & CompanyPersonRelationship models.
 * Strictly refuses private/personal webmail as verified business email and never fabricates contacts.
 */
export async function previewPersonEnrichment(
  person: PersonRecord,
  relationships: CompanyPersonRelationship[],
  companyLead: CanonicalLead | undefined,
  options: EnrichmentOrchestratorOptions = {}
): Promise<PersonEnrichmentPreviewResponse> {
  const startMs = Date.now();
  const nowMs = options.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const registry = options.registry || defaultRegistry;
  const credMgr = options.credentialManager || defaultCredentialManager;

  const primaryRel = relationships.find((r) => r.isPrimaryContact) || relationships[0];
  const qualityBefore = evaluatePersonDataQuality(person, relationships, { nowMs });
  const providerRuns: EnrichmentProviderRunSummary[] = [];
  const failedVerifications: Array<{ provider: string; reason: string; existingDataPreserved: boolean }> = [];
  const incoming: IncomingEnrichmentCandidate[] = [];

  // 1. Optional Apollo.io B2B People Enrichment (only if configured in Credential Vault)
  const apolloConn = registry.getById('conn-apollo');
  if (apolloConn && registry.isEnabled('conn-apollo') && (companyLead?.domain || companyLead?.companyName)) {
    const apStart = Date.now();
    const creds = await credMgr.resolveCredentialForExecution(
      'conn-apollo',
      apolloConn.getMetadata().credentialRequirements
    );
    if (!creds.credentials.apiKey) {
      providerRuns.push({
        providerId: 'conn-apollo',
        providerName: 'Apollo.io B2B People API',
        status: 'skipped_missing_credentials',
        durationMs: Date.now() - apStart,
        attributesContributed: [],
        message: 'Apollo.io API key not configured in Credential Vault.',
      });
    } else {
      try {
        const client =
          options.fetchFn || options.dnsLookupAll
            ? new ApolloPeopleConnector(options.fetchFn, options.dnsLookupAll)
            : (apolloConn as ApolloPeopleConnector);
        const controller = new AbortController();
        const res = await client.searchPeopleForCompany(
          {
            companyName: companyLead.companyName,
            domain: companyLead.domain,
            countryCode: companyLead.address?.countryCode,
            perPage: 15,
          },
          {
            requestId: `per-enr-${crypto.randomBytes(4).toString('hex')}`,
            signal: controller.signal,
            credentials: creds.credentials,
            credentialSource: creds.source,
            config: { connectorId: 'conn-apollo', enabled: true },
            userAgent: options.userAgent || 'GlobalLeadEngine/12.0',
            timeoutMs: 10000,
          }
        );

        const match = res.people.find((p) => {
          const candName = (p.name || `${p.first_name || ''} ${p.last_name || ''}`).trim().toLowerCase();
          return candName === person.normalizedName || (person.linkedinSlug && (p.linkedin_url || '').toLowerCase().includes(person.linkedinSlug));
        });

        const contributed: string[] = [];
        if (match) {
          if (match.title) {
            incoming.push({ field: 'jobTitle', label: 'Current Job Title', value: match.title, sourceType: 'authorized_provider', sourceName: 'Apollo.io B2B People API', connectorId: 'conn-apollo', confidenceScore: 80, retrievedAt: generatedAt });
            contributed.push('jobTitle');
          }
          if (match.departments?.[0]) {
            incoming.push({ field: 'department', label: 'Department', value: match.departments[0], sourceType: 'authorized_provider', sourceName: 'Apollo.io B2B People API', connectorId: 'conn-apollo', confidenceScore: 76, retrievedAt: generatedAt });
            contributed.push('department');
          }
          if (match.seniority) {
            incoming.push({ field: 'seniority', label: 'Seniority', value: match.seniority, sourceType: 'authorized_provider', sourceName: 'Apollo.io B2B People API', connectorId: 'conn-apollo', confidenceScore: 76, retrievedAt: generatedAt });
            contributed.push('seniority');
          }
          if (match.linkedin_url) {
            incoming.push({ field: 'linkedinUrl', label: 'Published LinkedIn URL', value: match.linkedin_url, sourceType: 'authorized_provider', sourceName: 'Apollo.io B2B People API', connectorId: 'conn-apollo', confidenceScore: 82, retrievedAt: generatedAt });
            contributed.push('linkedinUrl');
          }
          if (match.city) {
            incoming.push({ field: 'city', label: 'Professional Location', value: match.city, sourceType: 'authorized_provider', sourceName: 'Apollo.io B2B People API', connectorId: 'conn-apollo', confidenceScore: 72, retrievedAt: generatedAt });
            contributed.push('city');
          }
        }

        providerRuns.push({
          providerId: 'conn-apollo',
          providerName: 'Apollo.io B2B People API',
          status: contributed.length > 0 ? 'success' : 'no_results',
          durationMs: Date.now() - apStart,
          attributesContributed: contributed,
          message: match ? `Matched ${person.fullName} in Apollo.io B2B records.` : `No matching profile found for ${person.fullName}.`,
        });
      } catch (err: any) {
        const reason = err?.message || 'Apollo.io enrichment failed';
        failedVerifications.push({ provider: 'Apollo.io B2B People API', reason, existingDataPreserved: true });
        providerRuns.push({
          providerId: 'conn-apollo',
          providerName: 'Apollo.io B2B People API',
          status: 'error',
          durationMs: Date.now() - apStart,
          attributesContributed: [],
          message: reason,
        });
      }
    }
  }

  // 2. Official Company Website Leadership Verification (when company website is present)
  if (options.runWebsiteInspection !== false && (companyLead?.website || companyLead?.domain)) {
    const webStart = Date.now();
    try {
      const web = await inspectWebsite(companyLead.website || `https://${companyLead.domain}`, {
        fetchFn: options.fetchFn,
        dnsLookupAll: options.dnsLookupAll,
        maxPages: 5,
        checkRobots: options.checkRobots ?? true,
        expectedCompanyName: companyLead.companyName,
      });
      const match = (web.leadershipFound || []).find(
        (m) => m.fullName.trim().toLowerCase() === person.normalizedName
      );
      const contributed: string[] = [];
      if (match) {
        if (match.jobTitle) {
          incoming.push({ field: 'jobTitle', label: 'Current Job Title', value: match.jobTitle, sourceType: 'official_website', sourceName: 'Official Company Leadership Page', sourceUrl: match.officialBioUrl, connectorId: 'conn-web-inspector', confidenceScore: 90, retrievedAt: generatedAt });
          contributed.push('jobTitle');
        }
        if (match.officialBioUrl) {
          incoming.push({ field: 'officialBioUrl', label: 'Official Biography URL', value: match.officialBioUrl, sourceType: 'official_website', sourceName: 'Official Company Leadership Page', sourceUrl: match.officialBioUrl, connectorId: 'conn-web-inspector', confidenceScore: 92, retrievedAt: generatedAt });
          contributed.push('officialBioUrl');
        }
        if (match.linkedinUrl) {
          incoming.push({ field: 'linkedinUrl', label: 'Published LinkedIn URL', value: match.linkedinUrl, sourceType: 'official_website', sourceName: 'Official Company Leadership Page', sourceUrl: match.officialBioUrl, connectorId: 'conn-web-inspector', confidenceScore: 90, retrievedAt: generatedAt });
          contributed.push('linkedinUrl');
        }
        if (match.bioSnippet) {
          incoming.push({ field: 'bioSummary', label: 'Professional Biography', value: match.bioSnippet, sourceType: 'official_website', sourceName: 'Official Company Leadership Page', sourceUrl: match.officialBioUrl, connectorId: 'conn-web-inspector', confidenceScore: 86, retrievedAt: generatedAt });
          contributed.push('bioSummary');
        }
      }
      providerRuns.push({
        providerId: 'conn-web-inspector',
        providerName: 'Official Company Leadership Page',
        status: contributed.length > 0 ? 'success' : 'no_results',
        durationMs: Date.now() - webStart,
        attributesContributed: contributed,
        message: match
          ? `Confirmed ${person.fullName} on official company site (${match.officialBioUrl}).`
          : `Inspected ${web.pagesVisited?.length || 1} page(s); ${person.fullName} was not explicitly listed.`,
      });
    } catch (err: any) {
      const reason = err?.message || 'Website leadership inspection failed';
      failedVerifications.push({ provider: 'Official Company Leadership Page', reason, existingDataPreserved: true });
      providerRuns.push({
        providerId: 'conn-web-inspector',
        providerName: 'Official Company Leadership Page',
        status: 'error',
        durationMs: Date.now() - webStart,
        attributesContributed: [],
        message: reason,
      });
    }
  }

  // 3. Email Verification (strictly rejects Gmail/Yahoo/Outlook as verified business emails!)
  let emailVerification: EmailVerificationResult | undefined;
  if (options.runEmailVerification !== false && person.email) {
    const emStart = Date.now();
    emailVerification = await verifyBusinessEmail(person.email, {
      registry,
      credentialManager: credMgr,
      dnsHooks: options.emailDnsHooks,
      fetchFn: options.fetchFn,
      dnsLookupAll: options.dnsLookupAll,
      companyDomain: companyLead?.domain,
      allowPersonalWebmail: false,
    });
    providerRuns.push({
      providerId: emailVerification.providerUsed ? 'email-verifier-api' : 'builtin-dns-mx-email',
      providerName: emailVerification.sourceName,
      status: emailVerification.status === 'verification_failed' ? 'error' : 'success',
      durationMs: Date.now() - emStart,
      attributesContributed: ['emailStatus'],
      message: emailVerification.honestSummary,
    });
  }

  // 4. Phone Verification (strictly refuses claiming personal ownership without verified evidence)
  let phoneVerification: PhoneVerificationResult | undefined;
  if (options.runPhoneVerification !== false && (person.phoneNormalized || person.phone)) {
    const phStart = Date.now();
    phoneVerification = await verifyBusinessPhone(person.phoneNormalized || person.phone || '', {
      countryCode: person.countryCode || companyLead?.address?.countryCode || 'US',
      registry,
      credentialManager: credMgr,
      fetchFn: options.fetchFn,
      dnsLookupAll: options.dnsLookupAll,
      isPersonContact: true,
      personAssociationSourceVerified: person.verificationStatus === 'officially_verified',
    });
    providerRuns.push({
      providerId: phoneVerification.providerUsed ? 'conn-numverify-phone' : 'builtin-e164-phone',
      providerName: phoneVerification.sourceName,
      status: phoneVerification.syntaxValid ? 'success' : 'error',
      durationMs: Date.now() - phStart,
      attributesContributed: phoneVerification.syntaxValid ? ['phoneNormalized'] : [],
      message: phoneVerification.honestSummary,
    });
  }

  const existingPersonMap: Record<string, ExistingAttributeSnapshot> = {
    jobTitle: {
      value: primaryRel?.jobTitle,
      sourceType: primaryRel?.provenance?.sourceType || (person.verificationStatus === 'officially_verified' ? 'official_registry' : 'business_directory'),
      sourceName: primaryRel?.sourceName || 'Existing Relationship',
      lastVerifiedAt: primaryRel?.provenance?.lastObservedAt || primaryRel?.updatedAt,
    },
    department: {
      value: primaryRel?.department,
      sourceType: primaryRel?.provenance?.sourceType || 'business_directory',
      sourceName: primaryRel?.sourceName || 'Existing Relationship',
      lastVerifiedAt: primaryRel?.updatedAt,
    },
    seniority: {
      value: person.seniority,
      sourceType: 'business_directory',
      sourceName: 'Existing Person Record',
      lastVerifiedAt: person.updatedAt,
    },
    linkedinUrl: {
      value: person.linkedinUrl,
      sourceType: person.attributeProvenance?.linkedinUrl?.sourceType || 'business_directory',
      sourceName: person.attributeProvenance?.linkedinUrl?.sourceName || 'Existing Person Record',
      lastVerifiedAt: person.attributeProvenance?.linkedinUrl?.retrievedAt || person.updatedAt,
    },
    officialBioUrl: {
      value: person.officialBioUrl,
      sourceType: 'official_website',
      sourceName: 'Existing Person Record',
      lastVerifiedAt: person.updatedAt,
    },
    bioSummary: {
      value: person.bioSummary,
      sourceType: 'business_directory',
      sourceName: 'Existing Person Record',
      lastVerifiedAt: person.updatedAt,
    },
    city: {
      value: person.city,
      sourceType: 'business_directory',
      sourceName: 'Existing Person Record',
      lastVerifiedAt: person.updatedAt,
    },
  };

  const { proposals, conflicts } = resolveEnrichmentProposalsAndConflicts(
    existingPersonMap,
    incoming,
    nowMs
  );

  // Project quality after recommended proposals
  const projectedPerson: PersonRecord = {
    ...person,
    customFields: {
      ...(person.customFields || {}),
      ...(emailVerification && emailVerification.status !== 'verification_failed'
        ? { emailVerificationMeta: JSON.stringify(emailVerification) }
        : {}),
    },
    emailStatus:
      emailVerification?.crmEmailStatus === 'verified'
        ? 'verified'
        : person.emailStatus,
    linkedinUrl:
      proposals.find((p) => p.field === 'linkedinUrl' && p.defaultSelected)?.proposedValue ||
      person.linkedinUrl,
    officialBioUrl:
      proposals.find((p) => p.field === 'officialBioUrl' && p.defaultSelected)?.proposedValue ||
      person.officialBioUrl,
    seniority:
      proposals.find((p) => p.field === 'seniority' && p.defaultSelected)?.proposedValue ||
      person.seniority,
  };
  const qualityProjectedAfter = evaluatePersonDataQuality(projectedPerson, relationships, { nowMs });

  return {
    personId: person.id,
    fullName: person.fullName,
    leadId: companyLead?.id || primaryRel?.leadId,
    companyName: companyLead?.companyName,
    proposals,
    conflicts,
    emailVerification,
    phoneVerification,
    providerRuns,
    failedVerifications,
    qualityBefore,
    qualityProjectedAfter,
    requiresOwnerApproval: true,
    generatedAt,
    durationMs: Date.now() - startMs,
  };
}

/**
 * Bounded bulk enrichment preview (max 20 leads per run) requiring explicit owner approval before commit.
 */
export async function previewBulkCompanyEnrichment(
  leads: CanonicalLead[],
  options: EnrichmentOrchestratorOptions = {}
): Promise<{
  totalRequested: number;
  processedCount: number;
  cappedAt: number;
  previews: CompanyEnrichmentPreviewResponse[];
  totalProposals: number;
  totalConflicts: number;
  averageQualityBefore: number;
  averageQualityProjected: number;
}> {
  const cappedLeads = leads.slice(0, MAX_BULK_ENRICHMENT_BATCH);
  const previews: CompanyEnrichmentPreviewResponse[] = [];

  for (const lead of cappedLeads) {
    const preview = await previewCompanyEnrichment(lead, {
      ...options,
      // Keep bulk preview fast & deterministic unless explicitly requested
      runAiAssistance: options.runAiAssistance ?? false,
    });
    previews.push(preview);
  }

  const totalProposals = previews.reduce((s, p) => s + p.proposals.length, 0);
  const totalConflicts = previews.reduce((s, p) => s + p.conflicts.length, 0);
  const averageQualityBefore =
    previews.length > 0
      ? Math.round(previews.reduce((s, p) => s + p.qualityBefore.overallScore, 0) / previews.length)
      : 0;
  const averageQualityProjected =
    previews.length > 0
      ? Math.round(previews.reduce((s, p) => s + p.qualityProjectedAfter.overallScore, 0) / previews.length)
      : 0;

  return {
    totalRequested: leads.length,
    processedCount: previews.length,
    cappedAt: MAX_BULK_ENRICHMENT_BATCH,
    previews,
    totalProposals,
    totalConflicts,
    averageQualityBefore,
    averageQualityProjected,
  };
}

/**
 * Pure helper applying ONLY owner-selected decision-maker enrichment proposals onto cloned person + relationship updates.
 * Preserves previous values and enrichment history in person.customFields.enrichmentHistory.
 */
export function applyApprovedPersonEnrichmentToClone(
  person: PersonRecord,
  primaryRelationship: CompanyPersonRelationship | undefined,
  approvedProposals: EnrichmentFieldProposal[],
  context: {
    emailVerification?: EmailVerificationResult;
    phoneVerification?: PhoneVerificationResult;
    providerRuns?: EnrichmentProviderRunSummary[];
    failedVerifications?: Array<{ provider: string; reason: string; existingDataPreserved: boolean }>;
  } = {},
  actorEmail = 'Owner',
  nowMs: number = Date.now()
): {
  personUpdates: Partial<PersonRecord>;
  relationshipUpdates?: Partial<CompanyPersonRelationship>;
  historyEntry: EnrichmentHistoryEntry;
} {
  const nowIso = new Date(nowMs).toISOString();
  const nextCustom: Record<string, string> = { ...(person.customFields || {}) };
  const nextAttrProv = { ...(person.attributeProvenance || {}) };
  const history = parseJsonField<EnrichmentHistoryEntry[]>(nextCustom.enrichmentHistory, []);
  const fieldsUpdated: EnrichmentHistoryEntry['fieldsUpdated'] = [];

  const personUpdates: Partial<PersonRecord> = {
    updatedAt: nowIso,
  };
  let relChanged = false;
  const relationshipUpdates: Partial<CompanyPersonRelationship> = {};

  for (const p of approvedProposals) {
    switch (p.field) {
      case 'jobTitle':
        relationshipUpdates.jobTitle = p.proposedValue;
        relChanged = true;
        break;
      case 'department':
        relationshipUpdates.department = p.proposedValue;
        relChanged = true;
        break;
      case 'seniority':
        personUpdates.seniority = p.proposedValue;
        break;
      case 'linkedinUrl':
        personUpdates.linkedinUrl = p.proposedValue;
        break;
      case 'officialBioUrl':
        personUpdates.officialBioUrl = p.proposedValue;
        break;
      case 'bioSummary':
        personUpdates.bioSummary = p.proposedValue;
        break;
      case 'city':
        personUpdates.city = p.proposedValue;
        break;
      default:
        nextCustom[p.field] = p.proposedValue;
    }

    nextAttrProv[p.field] = {
      attribute: p.field,
      sourceType: p.proposedSourceType,
      sourceName: p.proposedSourceName,
      sourceUrl: p.proposedSourceUrl,
      connectorId: p.proposedConnectorId,
      retrievedAt: p.retrievedAt || nowIso,
    };

    fieldsUpdated.push({
      field: p.field,
      previousValue: p.currentValue,
      previousSource: p.currentSourceName,
      newValue: p.proposedValue,
      newSource: p.proposedSourceName,
      verificationLabel: p.verificationLabel,
    });
  }

  if (context.emailVerification && context.emailVerification.status !== 'verification_failed') {
    nextCustom.emailVerificationMeta = JSON.stringify(context.emailVerification);
    if (context.emailVerification.crmEmailStatus === 'verified') {
      personUpdates.emailStatus = 'verified';
    } else if (person.emailStatus !== 'verified') {
      personUpdates.emailStatus = context.emailVerification.crmEmailStatus;
    }
  }

  if (context.phoneVerification && context.phoneVerification.status !== 'verification_failed') {
    nextCustom.phoneVerificationMeta = JSON.stringify(context.phoneVerification);
    if (context.phoneVerification.syntaxValid && context.phoneVerification.e164 && !person.phoneNormalized) {
      personUpdates.phoneNormalized = context.phoneVerification.e164;
    }
  }

  nextCustom.lastEnrichedAt = nowIso;

  const projectedPerson: PersonRecord = {
    ...person,
    ...personUpdates,
    attributeProvenance: nextAttrProv,
    customFields: nextCustom,
  };
  const relsForScore = primaryRelationship
    ? [{ ...primaryRelationship, ...(relChanged ? relationshipUpdates : {}) }]
    : [];
  const qualityBefore = evaluatePersonDataQuality(person, primaryRelationship ? [primaryRelationship] : [], { nowMs });
  const qualityAfter = evaluatePersonDataQuality(projectedPerson, relsForScore, { nowMs });

  nextCustom.dataQualityScore = String(qualityAfter.overallScore);
  nextCustom.dataQualityGrade = qualityAfter.grade;

  const historyEntry: EnrichmentHistoryEntry = {
    id: `penr-${crypto.randomBytes(5).toString('hex')}`,
    timestamp: nowIso,
    actor: actorEmail,
    entityType: 'person',
    action:
      fieldsUpdated.length > 0
        ? 'enrichment_applied'
        : context.failedVerifications && context.failedVerifications.length > 0
        ? 'verification_attempt_failed'
        : 'contact_verified',
    providersExecuted: (context.providerRuns || []).map((r) => r.providerName),
    fieldsUpdated,
    failedVerifications: context.failedVerifications,
    qualityScoreBefore: qualityBefore.overallScore,
    qualityScoreAfter: qualityAfter.overallScore,
  };
  history.unshift(historyEntry);
  nextCustom.enrichmentHistory = JSON.stringify(history.slice(0, 25));

  personUpdates.customFields = nextCustom;
  personUpdates.attributeProvenance = nextAttrProv;

  return {
    personUpdates,
    relationshipUpdates: relChanged ? relationshipUpdates : undefined,
    historyEntry,
  };
}

