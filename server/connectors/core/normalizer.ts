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

export function normalizeLegalCompanyStatus(
  rawStatus?: string | null,
  flags?: {
    bankrupt?: boolean;
    underLiquidation?: boolean;
    underForcedDissolution?: boolean;
    cancelled?: boolean;
    explicitActive?: boolean;
  }
): 'active' | 'inactive' | 'dissolved' | 'unknown' {
  if (
    flags?.bankrupt ||
    flags?.underLiquidation ||
    flags?.underForcedDissolution ||
    flags?.cancelled
  ) {
    return 'dissolved';
  }
  const s = (rawStatus || '').trim().toLowerCase();
  if (!s) {
    return flags?.explicitActive ? 'active' : 'unknown';
  }

  // Evaluate dissolved / deregistered / inactive statuses BEFORE active / registered
  // so strings like "deregistered" or "inactive" never match "registered" or "active".
  if (
    s === 'dissolved' ||
    s === 'c' ||
    s === 'closed' ||
    s === 'ceased' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'deregistered' ||
    s === 'de-registered' ||
    s === 'struck off' ||
    s === 'struck-off' ||
    s === 'converted-closed' ||
    s === 'wound up' ||
    s === 'terminated' ||
    s.includes('dissolv') ||
    s.includes('deregister') ||
    s.includes('de-register') ||
    s.includes('cancel') ||
    s.includes('liquidation') ||
    s.includes('insolvency') ||
    s.includes('bankrupt') ||
    s.includes('struck') ||
    s.includes('wound up') ||
    s.includes('ceased')
  ) {
    return 'dissolved';
  }

  if (
    s === 'inactive' ||
    s === 'dormant' ||
    s === 'suspended' ||
    s === 'unregistered' ||
    s === 'not registered' ||
    s === 'administration' ||
    s === 'receivership' ||
    s === 'voluntary-arrangement' ||
    s.includes('inactive') ||
    s.includes('non-active') ||
    s.includes('not active') ||
    s.includes('unregistered') ||
    s.includes('not registered') ||
    s.includes('dormant') ||
    s.includes('suspend') ||
    s.includes('receivership')
  ) {
    return 'inactive';
  }

  if (
    s === 'active' ||
    s === 'a' ||
    s === 'open' ||
    s === 'registered' ||
    s === 'live' ||
    s === 'live company' ||
    s === 'normal' ||
    s === 'czynny' ||
    s === '0000000001' ||
    /\bactive\b/.test(s) ||
    /\bregistered\b/.test(s) ||
    /\blive\b/.test(s)
  ) {
    return 'active';
  }

  return flags?.explicitActive ? 'active' : 'unknown';
}

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
      ...(typeof result.providerMetadata?.rawRegistryStatus === 'string'
        ? { rawRegistryStatus: result.providerMetadata.rawRegistryStatus }
        : typeof result.providerMetadata?.uenStatusLabel === 'string'
        ? { rawRegistryStatus: result.providerMetadata.uenStatusLabel }
        : typeof result.providerMetadata?.etatAdministratif === 'string'
        ? { rawRegistryStatus: result.providerMetadata.etatAdministratif }
        : {}),
      ...(result.providerMetadata && Object.keys(result.providerMetadata).length > 0
        ? { providerMetadata: JSON.stringify(result.providerMetadata) }
        : {}),
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
  if (providerId === 'conn-us-sec') return `us-cik-${cleanExt}`;
  if (providerId === 'conn-fr-sirene') return `fr-siren-${cleanExt}`;
  if (providerId === 'conn-jp-nta') return `jp-cn-${cleanExt}`;
  if (providerId === 'conn-sg-acra') return `sg-uen-${cleanExt}`;
  if (providerId === 'conn-gleif') return `gleif-${cleanExt}`;
  if (providerId === 'conn-eu-vies') return `eu-vat-${cleanExt}`;
  if (providerId === 'conn-fi-prh') return `fi-ytunnus-${cleanExt}`;
  if (providerId === 'conn-pl-krs') return `pl-krs-${cleanExt}`;
  if (providerId === 'conn-nl-kvk') return `nl-kvk-${cleanExt}`;
  if (providerId === 'conn-nz-companies') return `nz-nzbn-${cleanExt}`;
  if (providerId === 'conn-ch-zefix') return `ch-uid-${cleanExt}`;
  if (providerId === 'conn-ie-cro') return `ie-cro-${cleanExt}`;
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

export function inferLeadTrustRank(lead: CanonicalLead): number {
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
    // Always preserve canonical CRM pipeline state, notes, and deal telemetry
    id: existing.id,
    createdAt: existing.createdAt,
    status: existing.status,
    pipelineStageId: existing.pipelineStageId,
    opportunityValue: existing.opportunityValue ?? incoming.opportunityValue,
    winProbability: existing.winProbability ?? incoming.winProbability,
    lostReason: existing.lostReason,
    currency: existing.currency || incoming.currency || 'USD',
    notes: existing.notes || [],
    activities: [
      ...(existing.activities || []),
      ...(incoming.activities || []).filter(
        (ia) => !(existing.activities || []).some((ea) => ea.id === ia.id)
      ),
    ],
    companyName: incomingIsStronger ? incoming.companyName : existing.companyName || incoming.companyName,
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
    socialLinks: { ...(incoming.socialLinks || {}), ...(existing.socialLinks || {}) },
    tags: Array.from(new Set([...(existing.tags || []), ...(incoming.tags || [])])),
    customFields: {
      ...(existing.customFields || {}),
      ...(incomingIsStronger ? incoming.customFields : {}),
      lastVerifiedRank: String(Math.max(existingRank, incomingRank)),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function mergeLeadWithTrustHierarchy(
  existing: CanonicalLead,
  incoming: CanonicalLead
): CanonicalLead {
  return mergeProviderObservationIntoLead(existing, incoming);
}

