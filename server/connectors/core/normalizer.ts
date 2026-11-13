import { CanonicalLead, LeadIdentifier, LeadSource } from '../../types.js';
import { getCountryByCode } from '../../geo/countries.js';
import { formatInternationalAddress } from '../../geo/addressUtils.js';
import { normalizePhoneNumber } from '../../geo/phoneUtils.js';
import { normalizeIdentifierValue, validateIdentifier } from '../../identifiers/identifierEngine.js';
import { canonicalizeIdentifierType } from '../../../shared/identifierRegistry.js';
import { StandardizedConnectorResult, VerificationStatus } from './types.js';

export interface NormalizationBatchSummary {
  leads: CanonicalLead[];
  discovered: number;
  normalized: number;
  rejected: number;
  rejectionReasons: string[];
}

const VERIFICATION_RANK: Record<VerificationStatus | 'user_provided' | 'discovered', number> = {
  officially_verified: 5,
  syntax_validated: 4,
  web_observed: 3,
  directory_listed: 2,
  discovered: 1,
  user_provided: 1,
  unverified: 0,
  offline_reference: 0,
};

function getIdentifierStatusRank(status?: LeadIdentifier['status'], verified?: boolean): number {
  if (verified || status === 'officially_verified') return 4;
  if (status === 'syntax_validated') return 3;
  if (status === 'discovered') return 2;
  return 1;
}

function cleanText(val?: string): string | undefined {
  if (!val || typeof val !== 'string') return undefined;
  const cleaned = val.trim().replace(/\s+/g, ' ');
  return cleaned.length > 0 ? cleaned : undefined;
}

function extractDomain(website?: string, fallbackDomain?: string): string | undefined {
  if (fallbackDomain && fallbackDomain.trim()) {
    return fallbackDomain.trim().toLowerCase().replace(/^www\./, '');
  }
  if (!website) return undefined;
  try {
    const normalizedUrl =
      website.startsWith('http://') || website.startsWith('https://') ? website : `https://${website}`;
    return new URL(normalizedUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/**
 * Common normalization pipeline transforming any StandardizedConnectorResult
 * into a validated CanonicalLead with Phase 3 canonical identifiers and E.164 phones.
 * Does NOT invent missing company facts or confidence scores.
 */
export function normalizeConnectorResult(result: StandardizedConnectorResult): {
  lead?: CanonicalLead;
  rejectedReason?: string;
} {
  const companyName = cleanText(result.company?.companyName);
  if (!companyName) {
    return { rejectedReason: `Missing companyName for externalSourceId=${result.externalSourceId}` };
  }

  const countryCode = (result.company.address?.countryCode || result.countryCode || 'US').toUpperCase();
  const countryRef = getCountryByCode(countryCode);
  const countryName = cleanText(result.company.address?.country) || countryRef?.name || 'International';

  const rawWebsite = cleanText(result.company.website);
  const website = rawWebsite
    ? rawWebsite.startsWith('http://') || rawWebsite.startsWith('https://')
      ? rawWebsite
      : `https://${rawWebsite}`
    : undefined;
  const domain = extractDomain(website, result.company.domain);

  const rawPhone = cleanText(result.company.phone);
  let phoneNormalized: string | undefined;
  if (rawPhone) {
    const phoneRes = normalizePhoneNumber(rawPhone, countryCode);
    if (phoneRes.valid && phoneRes.e164) {
      phoneNormalized = phoneRes.e164;
    }
  }

  const street = cleanText(result.company.address?.street);
  const city = cleanText(result.company.address?.city);
  const region = cleanText(result.company.address?.region);
  const postalCode = cleanText(result.company.address?.postalCode);
  const formattedAddress =
    formatInternationalAddress({
      street,
      city,
      region,
      postalCode,
      country: countryName,
      countryCode,
    }) || undefined;

  const regNumber = cleanText(result.company.registrationNumber);
  const regType = result.company.registrationType
    ? canonicalizeIdentifierType(result.company.registrationType, countryCode)
    : undefined;

  // Normalize & deduplicate identifiers while preserving verification provenance
  const identMap = new Map<string, LeadIdentifier>();
  const rawIdentifiers = result.company.identifiers || [];

  for (const rawIdent of rawIdentifiers) {
    const rawVal = cleanText(rawIdent.value);
    if (!rawVal) continue;
    const identCountry = (rawIdent.countryCode || countryCode).toUpperCase();
    const canonType = canonicalizeIdentifierType(rawIdent.type, identCountry);
    const normVal = rawIdent.normalizedValue || normalizeIdentifierValue(rawVal);

    let status: LeadIdentifier['status'] = rawIdent.status || 'discovered';
    let verified = Boolean(rawIdent.verified);
    let issuingAuthority = rawIdent.issuingAuthority;

    if (
      status !== 'officially_verified' &&
      canonType !== 'DOMAIN' &&
      canonType !== 'EMAIL' &&
      canonType !== 'PHONE'
    ) {
      const check = validateIdentifier(canonType, rawVal, identCountry, status);
      if (check.valid && status !== 'syntax_validated') {
        status = 'syntax_validated';
      }
      if (!issuingAuthority && check.issuingAuthority) {
        issuingAuthority = check.issuingAuthority;
      }
    }

    if (status === 'officially_verified') {
      verified = true;
    }

    const dedupeKey = `${canonType}:${normVal}`;
    const existing = identMap.get(dedupeKey);
    if (!existing || getIdentifierStatusRank(status, verified) > getIdentifierStatusRank(existing.status, existing.verified)) {
      identMap.set(dedupeKey, {
        type: canonType,
        value: rawVal,
        normalizedValue: normVal,
        countryCode: identCountry,
        issuingAuthority,
        source: rawIdent.source || result.providerId,
        status,
        verified,
      });
    }
  }

  // Ensure registrationNumber is represented in identifiers if not already present
  if (regNumber && regType) {
    const normReg = normalizeIdentifierValue(regNumber);
    const key = `${regType}:${normReg}`;
    if (!identMap.has(key)) {
      const isOfficial = result.verificationStatus === 'officially_verified';
      const check = validateIdentifier(regType, regNumber, countryCode, isOfficial ? 'officially_verified' : 'discovered');
      identMap.set(key, {
        type: regType,
        value: regNumber,
        normalizedValue: normReg,
        countryCode,
        issuingAuthority: check.issuingAuthority,
        source: result.providerId,
        status: isOfficial ? 'officially_verified' : check.valid ? 'syntax_validated' : 'discovered',
        verified: isOfficial,
      });
    }
  }

  // Build LeadSource with full provenance
  const source: LeadSource = {
    sourceName: result.company.rawSource?.sourceName || result.providerName,
    providerId: result.company.rawSource?.providerId || result.externalSourceId,
    url: result.company.rawSource?.url || result.sourceUrl,
    retrievedAt: result.retrievedAt,
    license: result.company.rawSource?.license,
    attribution: result.company.rawSource?.attribution,
  };

  // Use provider-reported confidence only when supported; never fabricate arbitrary confidence
  const confidenceScore =
    result.confidence?.supported && typeof result.confidence.score === 'number'
      ? Math.max(0, Math.min(100, Math.round(result.confidence.score)))
      : 0;

  const confidenceSignals = result.confidence?.signals ? [...result.confidence.signals] : [];

  const deterministicLeadId = buildDeterministicLeadId(result.providerId, result.externalSourceId);
  const now = result.retrievedAt || new Date().toISOString();

  const lead: CanonicalLead = {
    id: deterministicLeadId,
    companyName,
    legalName: cleanText(result.company.legalName),
    registrationNumber: regNumber,
    registrationType: regType,
    companyStatus: result.company.companyStatus || 'unknown',
    website,
    domain,
    email: cleanText(result.company.email),
    emailStatus: result.company.emailStatus || (result.company.email ? 'syntax_valid' : 'unavailable'),
    phone: rawPhone,
    phoneNormalized,
    address: {
      street,
      city,
      region,
      postalCode,
      country: countryName,
      countryCode,
      formattedAddress,
    },
    coordinates: result.company.coordinates,
    industry: cleanText(result.company.industry) || 'General Commerce & Services',
    category: cleanText(result.company.category) || 'General',
    employeeRange: cleanText(result.company.employeeRange),
    foundedYear: result.company.foundedYear,
    confidenceScore,
    confidenceSignals,
    sources: [source],
    identifiers: Array.from(identMap.values()),
    socialLinks: result.company.socialLinks,
    webMetadata: result.company.webMetadata,
    status: 'new',
    pipelineStageId: 'stage-discovered',
    currency: countryRef?.currency || 'USD',
    tags: Array.from(new Set(result.company.tags || [])),
    notes: [],
    activities: [
      {
        id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: 'enrichment',
        title: `Discovered via ${result.providerName}`,
        outcome: `Source ID ${result.externalSourceId} (${result.verificationStatus})`,
        date: now,
        actor: result.providerName,
      },
    ],
    customFields: {
      lastConnectorId: result.providerId,
      lastVerificationStatus: result.verificationStatus,
      lastAccessMode: result.accessMode,
    },
    createdAt: now,
    updatedAt: now,
  };

  return { lead };
}

function buildDeterministicLeadId(providerId: string, externalSourceId: string): string {
  const cleanExt = externalSourceId.replace(/[^a-zA-Z0-9_-]/g, '-');
  if (providerId === 'conn-brreg') return `brreg-${cleanExt}`;
  if (providerId === 'conn-companies-house') return `uk-crn-${cleanExt}`;
  if (providerId === 'conn-abn') return `abn-${cleanExt}`;
  if (providerId === 'conn-osm') {
    const osmNumeric = cleanExt.replace(/^osm-(?:node|way|relation)-/, '');
    return `osm-${osmNumeric}`;
  }
  return `${providerId.replace(/^conn-/, '')}-${cleanExt}`;
}

export function normalizeConnectorResults(results: StandardizedConnectorResult[]): NormalizationBatchSummary {
  const leads: CanonicalLead[] = [];
  const rejectionReasons: string[] = [];

  for (const r of results) {
    const normalized = normalizeConnectorResult(r);
    if (normalized.lead) {
      leads.push(normalized.lead);
    } else if (normalized.rejectedReason) {
      rejectionReasons.push(normalized.rejectedReason);
    }
  }

  return {
    leads,
    discovered: results.length,
    normalized: leads.length,
    rejected: rejectionReasons.length,
    rejectionReasons,
  };
}

function inferLeadTrustRank(lead: CanonicalLead): number {
  const customRank = lead.customFields?.lastVerificationStatus as VerificationStatus | undefined;
  if (customRank && customRank in VERIFICATION_RANK) {
    return VERIFICATION_RANK[customRank];
  }
  const hasOfficialIdent = (lead.identifiers || []).some((i) => i.verified || i.status === 'officially_verified');
  if (hasOfficialIdent) return VERIFICATION_RANK.officially_verified;
  const hasSyntaxValid = (lead.identifiers || []).some((i) => i.status === 'syntax_validated');
  if (hasSyntaxValid) return VERIFICATION_RANK.syntax_validated;
  if (lead.webMetadata?.inspectedAt) return VERIFICATION_RANK.web_observed;
  if (lead.sources?.some((s) => s.sourceName.toLowerCase().includes('openstreetmap'))) {
    return VERIFICATION_RANK.directory_listed;
  }
  return VERIFICATION_RANK.unverified;
}

/**
 * Merges a newly observed company record from another provider into an existing CanonicalLead.
 * Strictly preserves higher-verified information and prevents weaker/unverified sources
 * from overwriting officially verified fields.
 */
export function mergeProviderObservationIntoLead(
  existing: CanonicalLead,
  incoming: CanonicalLead
): CanonicalLead {
  const existingRank = inferLeadTrustRank(existing);
  const incomingRank = inferLeadTrustRank(incoming);
  const incomingIsStronger = incomingRank > existingRank;

  const pickField = <T>(currentVal: T | undefined, incomingVal: T | undefined): T | undefined => {
    if (!currentVal && incomingVal) return incomingVal;
    if (currentVal && incomingVal && incomingIsStronger) return incomingVal;
    return currentVal;
  };

  // Merge sources without duplicates
  const sourceKeys = new Set(existing.sources.map((s) => `${s.sourceName}:${s.providerId || s.url || ''}`));
  const combinedSources = [...existing.sources];
  for (const s of incoming.sources) {
    const key = `${s.sourceName}:${s.providerId || s.url || ''}`;
    if (!sourceKeys.has(key)) {
      sourceKeys.add(key);
      combinedSources.push(s);
    }
  }

  // Merge identifiers keeping the highest verification status for each canonical (type, normalizedValue)
  const identMap = new Map<string, LeadIdentifier>();
  const addIdent = (ident: LeadIdentifier, fallbackCountry?: string) => {
    const canonType = canonicalizeIdentifierType(ident.type, ident.countryCode || fallbackCountry);
    const normVal = ident.normalizedValue || normalizeIdentifierValue(ident.value);
    const key = `${canonType}:${normVal}`;
    const prev = identMap.get(key);
    const nextRank = getIdentifierStatusRank(ident.status, ident.verified);
    const prevRank = prev ? getIdentifierStatusRank(prev.status, prev.verified) : -1;
    if (!prev || nextRank > prevRank) {
      identMap.set(key, {
        ...prev,
        ...ident,
        type: canonType,
        normalizedValue: normVal,
        verified: Boolean(ident.verified || prev?.verified),
      });
    }
  };

  for (const i of existing.identifiers || []) addIdent(i, existing.address?.countryCode);
  for (const i of incoming.identifiers || []) addIdent(i, incoming.address?.countryCode);

  const existingAddr = existing.address || { country: 'International', countryCode: 'US' };
  const incomingAddr = incoming.address || { country: 'International', countryCode: 'US' };

  const mergedAddress = {
    street: pickField(existingAddr.street, incomingAddr.street),
    city: pickField(existingAddr.city, incomingAddr.city),
    region: pickField(existingAddr.region, incomingAddr.region),
    postalCode: pickField(existingAddr.postalCode, incomingAddr.postalCode),
    country: incomingIsStronger ? incomingAddr.country || existingAddr.country : existingAddr.country || incomingAddr.country,
    countryCode: incomingIsStronger
      ? incomingAddr.countryCode || existingAddr.countryCode
      : existingAddr.countryCode || incomingAddr.countryCode,
    formattedAddress: pickField(existingAddr.formattedAddress, incomingAddr.formattedAddress),
  };

  const mergedRegNumber = pickField(existing.registrationNumber, incoming.registrationNumber);
  const mergedRegType = pickField(existing.registrationType, incoming.registrationType);

  return {
    ...existing,
    companyName: incomingIsStronger ? incoming.companyName : existing.companyName,
    legalName: pickField(existing.legalName, incoming.legalName),
    registrationNumber: mergedRegNumber,
    registrationType: mergedRegType,
    companyStatus:
      existing.companyStatus && existing.companyStatus !== 'unknown' && !incomingIsStronger
        ? existing.companyStatus
        : incoming.companyStatus || existing.companyStatus,
    website: pickField(existing.website, incoming.website),
    domain: pickField(existing.domain, incoming.domain),
    email: pickField(existing.email, incoming.email),
    emailStatus:
      existing.emailStatus === 'verified'
        ? 'verified'
        : incoming.emailStatus === 'verified'
        ? 'verified'
        : existing.email
        ? existing.emailStatus
        : incoming.emailStatus,
    phone: pickField(existing.phone, incoming.phone),
    phoneNormalized: pickField(existing.phoneNormalized, incoming.phoneNormalized),
    address: mergedAddress,
    coordinates: pickField(existing.coordinates, incoming.coordinates),
    industry: existing.industry && existing.industry !== 'General Commerce & Services' && !incomingIsStronger
      ? existing.industry
      : incoming.industry || existing.industry,
    category: existing.category && existing.category !== 'General' && !incomingIsStronger
      ? existing.category
      : incoming.category || existing.category,
    foundedYear: pickField(existing.foundedYear, incoming.foundedYear),
    employeeRange: pickField(existing.employeeRange, incoming.employeeRange),
    confidenceScore: Math.max(existing.confidenceScore || 0, incoming.confidenceScore || 0),
    confidenceSignals: Array.from(new Set([...(existing.confidenceSignals || []), ...(incoming.confidenceSignals || [])])),
    sources: combinedSources,
    identifiers: Array.from(identMap.values()),
    webMetadata: incoming.webMetadata || existing.webMetadata,
    socialLinks: { ...(existing.socialLinks || {}), ...(incoming.socialLinks || {}) },
    tags: Array.from(new Set([...(existing.tags || []), ...(incoming.tags || [])])),
    customFields: {
      ...(existing.customFields || {}),
      ...(incomingIsStronger ? incoming.customFields : {}),
      lastVerifiedRank: String(Math.max(existingRank, incomingRank)),
    },
    updatedAt: new Date().toISOString(),
  };
}
