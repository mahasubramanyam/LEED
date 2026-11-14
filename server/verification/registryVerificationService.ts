import {
  CanonicalLead,
  LeadActivity,
  LeadIdentifier,
  LeadSource,
  RegistryMatchType,
  RegistryVerificationReport,
  RegistryVerificationState,
  VerificationConflict,
  VerificationHistoryEntry,
} from '../types.js';
import {
  ConnectorExecutionEngine,
  connectorExecutionEngine as defaultExecutionEngine,
  RunRecorderFn,
} from '../connectors/core/executionEngine.js';
import {
  ConnectorRegistry,
  connectorRegistry as defaultRegistry,
} from '../connectors/core/registry.js';
import { ConnectorConfigRecord, IConnector } from '../connectors/core/types.js';
import {
  normalizeIdentifierValue,
  normalizeUkCrn,
  normalizeUsCik,
} from '../identifiers/identifierEngine.js';
import { canonicalizeIdentifierType } from '../../shared/identifierRegistry.js';
import { TEN_COUNTRY_REGISTRY_AUDIT } from '../geo/registryAudit.js';
import { inferLeadTrustRank } from '../connectors/core/normalizer.js';
import { ConnectorError } from '../connectors/core/errors.js';

export interface RegistryVerificationDeps {
  registry?: ConnectorRegistry;
  executionEngine?: ConnectorExecutionEngine;
  configs?: Record<string, ConnectorConfigRecord>;
  userAgent?: string;
  onRecordRun?: RunRecorderFn;
}

const COUNTRY_TO_REGISTRY_CONNECTOR: Record<string, string> = {
  NO: 'conn-brreg',
  GB: 'conn-companies-house',
  AU: 'conn-abn',
  US: 'conn-us-sec',
  FR: 'conn-fr-sirene',
  SG: 'conn-sg-acra',
  JP: 'conn-jp-nta',
};

export function normalizeLegalNameForComparison(name: string): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(
      /\b(ltd|limited|plc|inc|incorporated|corp|corporation|llc|llp|gmbh|ag|sa|sas|sarl|as|asa|ans|da|ab|oy|oyj|bv|nv|pty|pte|kk|sdn|bhd|co)\b/gi,
      ' '
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function computeLegalNameSimilarity(nameA: string, nameB: string): number {
  const cleanA = normalizeLegalNameForComparison(nameA);
  const cleanB = normalizeLegalNameForComparison(nameB);
  if (!cleanA || !cleanB) return 0;
  if (cleanA === cleanB) return 1.0;

  const maxLen = Math.max(cleanA.length, cleanB.length);
  const editSim = Math.max(0, 1 - levenshtein(cleanA, cleanB) / maxLen);

  const tokensA = new Set(cleanA.split(' ').filter((t) => t.length >= 2));
  const tokensB = new Set(cleanB.split(' ').filter((t) => t.length >= 2));
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  const tokenSim = tokensA.size > 0 && tokensB.size > 0 ? overlap / Math.max(tokensA.size, tokensB.size) : 0;

  return parseFloat(Math.max(editSim, tokenSim * 0.95).toFixed(3));
}

export function computeAddressSimilarity(
  addrA?: CanonicalLead['address'],
  addrB?: CanonicalLead['address']
): number {
  if (!addrA || !addrB) return 0;
  let points = 0;
  let weightTotal = 0;

  const postA = (addrA.postalCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const postB = (addrB.postalCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (postA && postB) {
    weightTotal += 0.45;
    if (postA === postB) points += 0.45;
    else if (postA.slice(0, 3) === postB.slice(0, 3)) points += 0.2;
  }

  const cityA = (addrA.city || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const cityB = (addrB.city || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (cityA && cityB) {
    weightTotal += 0.3;
    if (cityA === cityB || cityA.includes(cityB) || cityB.includes(cityA)) points += 0.3;
  }

  const streetA = (addrA.street || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
  const streetB = (addrB.street || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
  if (streetA && streetB) {
    weightTotal += 0.25;
    const tokA = new Set(streetA.split(/\s+/).filter((t) => t.length >= 2));
    const tokB = new Set(streetB.split(/\s+/).filter((t) => t.length >= 2));
    let matches = 0;
    for (const t of tokA) if (tokB.has(t)) matches++;
    if (tokA.size > 0 && tokB.size > 0) {
      points += 0.25 * (matches / Math.max(tokA.size, tokB.size));
    }
  }

  if (weightTotal === 0) return 0;
  return parseFloat(Math.min(1, points / weightTotal).toFixed(3));
}

function normalizeRegValueForType(type: string | undefined, value: string, countryCode?: string): string {
  const canon = type ? canonicalizeIdentifierType(type, countryCode) : '';
  if (canon === 'UK_CRN') return normalizeUkCrn(value);
  if (canon === 'US_CIK') return normalizeUsCik(value);
  return normalizeIdentifierValue(value);
}

export function compareLeadAgainstOfficialRecord(
  crmLead: CanonicalLead,
  officialRecord: CanonicalLead,
  isLiveApi: boolean
): {
  state: RegistryVerificationState;
  matchType: RegistryMatchType;
  confidence: number;
  conflicts: VerificationConflict[];
  nameSimilarity: number;
  addressSimilarity: number;
  identifierMatched: boolean;
} {
  const conflicts: VerificationConflict[] = [];
  const crmCountry = (crmLead.address?.countryCode || '').toUpperCase();
  const offCountry = (officialRecord.address?.countryCode || '').toUpperCase();

  if (crmCountry && offCountry && crmCountry !== offCountry) {
    conflicts.push({
      field: 'countryCode',
      severity: 'high',
      crmValue: crmCountry,
      officialValue: offCountry,
      message: `Jurisdiction mismatch: CRM lead is in ${crmCountry}, official registry record is in ${offCountry}.`,
    });
  }

  // Compare registration numbers and canonical identifiers
  let identifierMatched = false;
  let identifierConflict = false;

  const offRegNorm = officialRecord.registrationNumber
    ? normalizeRegValueForType(officialRecord.registrationType, officialRecord.registrationNumber, offCountry)
    : '';
  const crmRegNorm = crmLead.registrationNumber
    ? normalizeRegValueForType(crmLead.registrationType || officialRecord.registrationType, crmLead.registrationNumber, crmCountry || offCountry)
    : '';

  if (crmRegNorm && offRegNorm) {
    if (crmRegNorm === offRegNorm) {
      identifierMatched = true;
    } else {
      const crmCanonType = canonicalizeIdentifierType(crmLead.registrationType || '', crmCountry);
      const offCanonType = canonicalizeIdentifierType(officialRecord.registrationType || '', offCountry);
      if (!crmCanonType || !offCanonType || crmCanonType === offCanonType) {
        identifierConflict = true;
        conflicts.push({
          field: 'registrationNumber',
          severity: 'high',
          crmValue: crmLead.registrationNumber!,
          officialValue: officialRecord.registrationNumber!,
          message: `Registration number conflict: CRM lists "${crmLead.registrationNumber}", official registry returned "${officialRecord.registrationNumber}".`,
        });
      }
    }
  }

  if (!identifierMatched) {
    for (const crmId of crmLead.identifiers || []) {
      const cType = canonicalizeIdentifierType(crmId.type, crmId.countryCode || crmCountry);
      if (cType === 'DOMAIN' || cType === 'PHONE' || cType === 'EMAIL') continue;
      const cVal = normalizeRegValueForType(cType, crmId.normalizedValue || crmId.value, crmId.countryCode || crmCountry);
      for (const offId of officialRecord.identifiers || []) {
        const oType = canonicalizeIdentifierType(offId.type, offId.countryCode || offCountry);
        const oVal = normalizeRegValueForType(oType, offId.normalizedValue || offId.value, offId.countryCode || offCountry);
        if (cType === oType && cVal && oVal && cVal === oVal) {
          identifierMatched = true;
          break;
        }
      }
      if (identifierMatched) break;
    }
  }

  const crmName = crmLead.legalName || crmLead.companyName;
  const offName = officialRecord.legalName || officialRecord.companyName;
  const nameSimilarity = computeLegalNameSimilarity(crmName, offName);
  const addressSimilarity = computeAddressSimilarity(crmLead.address, officialRecord.address);

  // Legal status conflict detection
  if (
    officialRecord.companyStatus &&
    (officialRecord.companyStatus === 'dissolved' || officialRecord.companyStatus === 'inactive') &&
    crmLead.companyStatus === 'active'
  ) {
    conflicts.push({
      field: 'companyStatus',
      severity: 'high',
      crmValue: crmLead.companyStatus,
      officialValue: officialRecord.companyStatus,
      message: `Legal status alert: CRM lists company as "active", but official registry reports "${officialRecord.companyStatus}".`,
    });
  }

  // Legal name divergence conflict
  if (identifierMatched && nameSimilarity < 0.65) {
    conflicts.push({
      field: 'legalName',
      severity: 'medium',
      crmValue: crmName,
      officialValue: offName,
      message: `Registered legal name "${offName}" differs from CRM name "${crmName}" (${Math.round(nameSimilarity * 100)}% similarity).`,
    });
  }

  // Address divergence (when both have postal codes in same jurisdiction and do not match)
  if (
    crmLead.address?.postalCode &&
    officialRecord.address?.postalCode &&
    crmLead.address.postalCode.replace(/\s+/g, '').toUpperCase() !==
      officialRecord.address.postalCode.replace(/\s+/g, '').toUpperCase()
  ) {
    conflicts.push({
      field: 'address',
      severity: 'low',
      crmValue: crmLead.address.postalCode,
      officialValue: officialRecord.address.postalCode,
      message: `Registered postal code differs (${crmLead.address.postalCode} in CRM vs ${officialRecord.address.postalCode} in official registry).`,
    });
  }

  let matchType: RegistryMatchType = 'none';
  let state: RegistryVerificationState = 'not_found';

  if (identifierConflict) {
    matchType = 'conflict';
    state = 'conflict_detected';
  } else if (identifierMatched) {
    matchType = 'exact_official_identifier';
    state = isLiveApi ? 'officially_verified' : 'offline_reference';
  } else if (nameSimilarity >= 0.9 && (!crmCountry || !offCountry || crmCountry === offCountry)) {
    matchType = 'exact_name_jurisdiction';
    state = isLiveApi ? 'officially_verified' : 'offline_reference';
  } else if (nameSimilarity >= 0.68 && (addressSimilarity >= 0.5 || !crmLead.address?.postalCode)) {
    matchType = 'probable_name_address';
    state = isLiveApi ? 'probable_match' : 'offline_reference';
  } else if (conflicts.length > 0) {
    matchType = 'conflict';
    state = 'conflict_detected';
  }

  if (
    state === 'officially_verified' &&
    conflicts.some((c) => c.field === 'countryCode' || c.field === 'registrationNumber')
  ) {
    state = 'conflict_detected';
    matchType = 'conflict';
  }

  const confidence = Math.round(
    Math.min(
      100,
      (identifierMatched ? 60 : 0) + nameSimilarity * 30 + addressSimilarity * 10
    )
  );

  return {
    state,
    matchType,
    confidence,
    conflicts,
    nameSimilarity,
    addressSimilarity,
    identifierMatched,
  };
}

export async function verifyLeadWithOfficialRegistry(
  lead: CanonicalLead,
  deps: RegistryVerificationDeps = {}
): Promise<RegistryVerificationReport> {
  const registry = deps.registry || defaultRegistry;
  const engine = deps.executionEngine || defaultExecutionEngine;
  const configs = deps.configs || {};
  const userAgent = deps.userAgent || 'GlobalLeadPipeline/1.0 (compliance@leed-pipeline.local)';
  const verifiedAt = new Date().toISOString();
  const countryCode = (lead.address?.countryCode || 'US').toUpperCase();
  const auditEntry = TEN_COUNTRY_REGISTRY_AUDIT[countryCode];
  const connectorId = COUNTRY_TO_REGISTRY_CONNECTOR[countryCode];

  if (!connectorId) {
    const auditMsg = auditEntry
      ? `${auditEntry.authorityName}: ${auditEntry.auditDetails.publicAccessSummary}`
      : `No official government business registry connector is integrated for country ${countryCode}.`;
    return {
      leadId: lead.id,
      state: 'unavailable',
      matchType: 'none',
      confidence: 0,
      isLiveApi: false,
      sourceName: auditEntry?.authorityName || `Country ${countryCode} Official Registry`,
      sourceUrl: auditEntry?.auditDetails.documentationUrl,
      verifiedAt,
      conflicts: [],
      nameSimilarity: 0,
      addressSimilarity: 0,
      identifierMatched: false,
      preservesHigherTrust: true,
      summary: auditMsg,
      notes: [auditMsg],
    };
  }

  const connector: IConnector | undefined = registry.getById(connectorId);
  if (!connector) {
    return {
      leadId: lead.id,
      state: 'unavailable',
      matchType: 'none',
      confidence: 0,
      isLiveApi: false,
      connectorId,
      sourceName: connectorId,
      verifiedAt,
      conflicts: [],
      nameSimilarity: 0,
      addressSimilarity: 0,
      identifierMatched: false,
      preservesHigherTrust: true,
      summary: `Official registry connector ${connectorId} is not registered.`,
      notes: [`Connector ${connectorId} missing from registry.`],
    };
  }

  const meta = connector.getMetadata();
  const cfg: ConnectorConfigRecord = configs[connectorId] || {
    connectorId,
    enabled: registry.isEnabled(connectorId),
  };

  if (!cfg.enabled) {
    return {
      leadId: lead.id,
      state: 'unavailable',
      matchType: 'none',
      confidence: 0,
      isLiveApi: false,
      connectorId,
      sourceName: meta.name,
      sourceUrl: meta.homepageUrl,
      verifiedAt,
      conflicts: [],
      nameSimilarity: 0,
      addressSimilarity: 0,
      identifierMatched: false,
      preservesHigherTrust: true,
      summary: `${meta.name} is currently disabled in Owner Connector Settings.`,
      notes: [`Enable ${meta.shortName} in Connectors Hub to verify leads.`],
    };
  }

  // 1. Prefer exact official identifier lookup if the lead already carries a supported identifier
  let matchedCandidate: CanonicalLead | undefined;
  let isLiveApi = false;
  let notes: string[] = [];

  const supportedTypes = new Set(meta.supportedIdentifierTypes || []);
  let lookupExternalId: string | undefined;
  let lookupIdentType: string | undefined;

  if (lead.registrationNumber) {
    const canonRegType = lead.registrationType
      ? canonicalizeIdentifierType(lead.registrationType, countryCode)
      : meta.supportedIdentifierTypes[0];
    if (canonRegType && supportedTypes.has(canonRegType)) {
      lookupExternalId = lead.registrationNumber;
      lookupIdentType = canonRegType;
    }
  }
  if (!lookupExternalId) {
    for (const ident of lead.identifiers || []) {
      const cType = canonicalizeIdentifierType(ident.type, ident.countryCode || countryCode);
      if (supportedTypes.has(cType)) {
        lookupExternalId = ident.value;
        lookupIdentType = cType;
        break;
      }
    }
  }

  if (lookupExternalId) {
    try {
      const lookupRes = await engine.executeLookup(
        connector,
        {
          externalId: lookupExternalId,
          countryCode,
        },
        {
          config: cfg,
          userAgent,
          onRecordRun: deps.onRecordRun,
        }
      );
      isLiveApi = lookupRes.response.isLiveApi;
      notes.push(...(lookupRes.response.notes || []));
      if (lookupRes.normalization?.leads && lookupRes.normalization.leads.length > 0) {
        matchedCandidate = lookupRes.normalization.leads[0];
      }
    } catch (err) {
      // If format invalid or 404/request issue, fall through to legal name search cleanly; preserve auth/unavailable errors
      if (err instanceof ConnectorError && err.category !== 'invalid_request') {
        notes.push(err.message);
      }
    }
  }

  // 2. Fallback or primary name/city search against official registry
  if (!matchedCandidate) {
    const searchQuery = (lead.legalName || lead.companyName || '').trim();
    if (searchQuery) {
      try {
        const searchRes = await engine.executeSearch(
          connector,
          {
            query: searchQuery,
            countryCode,
            city: lead.address?.city,
            postalCode: lead.address?.postalCode,
            page: 1,
            pageSize: 10,
          },
          {
            config: cfg,
            userAgent,
            onRecordRun: deps.onRecordRun,
          }
        );
        isLiveApi = searchRes.response.isLiveApi;
        notes.push(...(searchRes.response.notes || []));

        // Score all candidates and select the highest-scoring official match
        let bestScore = -1;
        for (const cand of searchRes.normalization.leads) {
          const cmp = compareLeadAgainstOfficialRecord(lead, cand, isLiveApi);
          const rankScore =
            (cmp.identifierMatched ? 100 : 0) + cmp.nameSimilarity * 60 + cmp.addressSimilarity * 20;
          if (rankScore > bestScore && (cmp.identifierMatched || cmp.nameSimilarity >= 0.55)) {
            bestScore = rankScore;
            matchedCandidate = cand;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          leadId: lead.id,
          state: 'unavailable',
          matchType: 'none',
          confidence: 0,
          isLiveApi: false,
          connectorId,
          sourceName: meta.name,
          sourceUrl: meta.homepageUrl,
          verifiedAt,
          conflicts: [],
          nameSimilarity: 0,
          addressSimilarity: 0,
          identifierMatched: false,
          preservesHigherTrust: true,
          summary: `Verification unavailable for ${meta.shortName}: ${msg}`,
          notes: [msg],
        };
      }
    }
  }

  if (!matchedCandidate) {
    return {
      leadId: lead.id,
      state: isLiveApi ? 'not_found' : 'offline_reference',
      matchType: 'none',
      confidence: 0,
      isLiveApi,
      connectorId,
      sourceName: meta.name,
      sourceUrl: meta.homepageUrl,
      verifiedAt,
      conflicts: [],
      nameSimilarity: 0,
      addressSimilarity: 0,
      identifierMatched: false,
      preservesHigherTrust: true,
      summary: isLiveApi
        ? `No matching corporate entity found in ${meta.name} for "${lead.companyName}".`
        : `${meta.name} could not perform live verification (credentials not configured or offline reference mode only).`,
      notes,
    };
  }

  const comparison = compareLeadAgainstOfficialRecord(lead, matchedCandidate, isLiveApi);
  const officialUrl = matchedCandidate.sources?.[0]?.url || meta.homepageUrl;

  let summary = '';
  if (comparison.state === 'officially_verified') {
    summary = `Verified via ${meta.name} (${matchedCandidate.registrationType || 'ID'} ${matchedCandidate.registrationNumber || 'N/A'}, status: ${matchedCandidate.companyStatus || 'unknown'}).`;
  } else if (comparison.state === 'probable_match') {
    summary = `Probable match found in ${meta.name}: "${matchedCandidate.legalName || matchedCandidate.companyName}" (${Math.round(comparison.nameSimilarity * 100)}% name match). Review before finalizing.`;
  } else if (comparison.state === 'offline_reference') {
    summary = `Matched against offline sample reference only (${meta.shortName} requires API credentials for live government verification).`;
  } else if (comparison.state === 'conflict_detected') {
    summary = `Conflict detected against ${meta.name}: ${comparison.conflicts.map((c) => c.message).join(' ')}`;
  } else {
    summary = `Official record retrieved from ${meta.name}, but similarity was below matching threshold.`;
  }

  return {
    leadId: lead.id,
    state: comparison.state,
    matchType: comparison.matchType,
    confidence: comparison.confidence,
    isLiveApi,
    connectorId,
    sourceName: meta.name,
    sourceUrl: officialUrl,
    verifiedAt,
    matchedRecord: matchedCandidate,
    conflicts: comparison.conflicts,
    nameSimilarity: comparison.nameSimilarity,
    addressSimilarity: comparison.addressSimilarity,
    identifierMatched: comparison.identifierMatched,
    preservesHigherTrust: true,
    summary,
    notes,
  };
}

function parseVerificationHistory(customFields?: Record<string, string>): VerificationHistoryEntry[] {
  if (!customFields?.verificationHistory) return [];
  try {
    const parsed = JSON.parse(customFields.verificationHistory);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function applyOfficialVerificationToLead(
  existingLead: CanonicalLead,
  report: RegistryVerificationReport
): CanonicalLead {
  const existingHistory = parseVerificationHistory(existingLead.customFields);
  const newHistoryEntry: VerificationHistoryEntry = {
    verifiedAt: report.verifiedAt,
    connectorId: report.connectorId || 'registry-audit',
    sourceName: report.sourceName,
    sourceUrl: report.sourceUrl,
    state: report.state,
    matchType: report.matchType,
    matchedRegistrationNumber: report.matchedRecord?.registrationNumber,
    matchedLegalName: report.matchedRecord?.legalName || report.matchedRecord?.companyName,
    matchedCompanyStatus: report.matchedRecord?.companyStatus,
    isLiveApi: report.isLiveApi,
    conflictCount: report.conflicts.length,
    summary: report.summary,
  };
  const updatedHistory = [newHistoryEntry, ...existingHistory].slice(0, 15);

  const activity: LeadActivity = {
    id: `act-reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'enrichment',
    title: `Registry Verification (${report.sourceName})`,
    outcome: report.summary.slice(0, 220),
    date: report.verifiedAt,
    actor: report.isLiveApi ? report.sourceName : 'Registry Verification Service',
  };

  const baseCustomFields: Record<string, string> = {
    ...(existingLead.customFields || {}),
    lastRegistryState: report.state,
    lastVerificationMatchType: report.matchType,
    lastVerifiedAt: report.verifiedAt,
    lastVerificationSource: report.sourceName,
    lastVerificationSourceUrl: report.sourceUrl || '',
    verificationConflicts: JSON.stringify(report.conflicts),
    verificationHistory: JSON.stringify(updatedHistory),
  };

  // Never overwrite verified legal identity with offline reference, unfound, or conflicting registration number results
  const matched = report.matchedRecord;
  const hasRegConflict = report.conflicts.some((c) => c.field === 'registrationNumber' || c.field === 'countryCode');
  const existingTrust = inferLeadTrustRank(existingLead);
  const canUpgradeLegalIdentity =
    Boolean(matched) &&
    report.isLiveApi &&
    !hasRegConflict &&
    (report.state === 'officially_verified' || report.state === 'probable_match') &&
    (report.state === 'officially_verified' || existingTrust < 5);

  if (!canUpgradeLegalIdentity || !matched) {
    return {
      ...existingLead,
      activities: [activity, ...(existingLead.activities || [])],
      customFields: baseCustomFields,
      updatedAt: report.verifiedAt,
    };
  }

  // Merge identifiers preserving highest verification rank
  const identMap = new Map<string, LeadIdentifier>();
  const rankOf = (i: LeadIdentifier) =>
    i.verified || i.status === 'officially_verified' ? 4 : i.status === 'syntax_validated' ? 3 : i.status === 'discovered' ? 2 : 1;

  for (const ident of [...(existingLead.identifiers || []), ...(matched.identifiers || [])]) {
    const cCode = ident.countryCode || matched.address?.countryCode || existingLead.address?.countryCode;
    const cType = canonicalizeIdentifierType(ident.type, cCode);
    const normVal = normalizeRegValueForType(cType, ident.normalizedValue || ident.value, cCode);
    const key = `${cType}:${normVal}`;
    const prev = identMap.get(key);
    if (!prev || rankOf(ident) > rankOf(prev)) {
      identMap.set(key, {
        ...prev,
        ...ident,
        type: cType,
        normalizedValue: normVal,
        verified: Boolean(ident.verified || prev?.verified || ident.status === 'officially_verified'),
      });
    }
  }

  // Merge sources without duplication
  const sourceKey = (s: LeadSource) => `${s.sourceName}:${s.providerId || s.url || ''}`;
  const seenSources = new Set((existingLead.sources || []).map(sourceKey));
  const combinedSources = [...(existingLead.sources || [])];
  for (const s of matched.sources || []) {
    const sk = sourceKey(s);
    if (!seenSources.has(sk)) {
      seenSources.add(sk);
      combinedSources.push(s);
    }
  }

  const isExactOfficial = report.state === 'officially_verified';

  return {
    ...existingLead,
    // Preserve CRM identity & pipeline state strictly
    id: existingLead.id,
    status: existingLead.status,
    pipelineStageId: existingLead.pipelineStageId,
    opportunityValue: existingLead.opportunityValue,
    winProbability: existingLead.winProbability,
    lostReason: existingLead.lostReason,
    currency: existingLead.currency,
    notes: existingLead.notes || [],
    createdAt: existingLead.createdAt,

    // Upgrade legal identity fields from authoritative official registry
    legalName: matched.legalName || matched.companyName || existingLead.legalName,
    registrationNumber: isExactOfficial
      ? matched.registrationNumber || existingLead.registrationNumber
      : existingLead.registrationNumber || matched.registrationNumber,
    registrationType: isExactOfficial
      ? matched.registrationType || existingLead.registrationType
      : existingLead.registrationType || matched.registrationType,
    companyStatus:
      matched.companyStatus && matched.companyStatus !== 'unknown'
        ? matched.companyStatus
        : existingLead.companyStatus,
    address: {
      street: matched.address?.street || existingLead.address?.street,
      city: matched.address?.city || existingLead.address?.city,
      region: matched.address?.region || existingLead.address?.region,
      postalCode: matched.address?.postalCode || existingLead.address?.postalCode,
      country: matched.address?.country || existingLead.address?.country || 'International',
      countryCode: matched.address?.countryCode || existingLead.address?.countryCode || 'US',
      formattedAddress: matched.address?.formattedAddress || existingLead.address?.formattedAddress,
    },
    coordinates: existingLead.coordinates || matched.coordinates,
    foundedYear: existingLead.foundedYear || matched.foundedYear,
    confidenceScore: Math.max(existingLead.confidenceScore || 0, matched.confidenceScore || 0),
    confidenceSignals: Array.from(
      new Set([
        ...(existingLead.confidenceSignals || []),
        ...(matched.confidenceSignals || []),
        isExactOfficial
          ? `Official Registry Verified (${report.sourceName})`
          : `Probable Registry Match (${report.sourceName})`,
      ])
    ),
    identifiers: Array.from(identMap.values()),
    sources: combinedSources,
    activities: [activity, ...(existingLead.activities || [])],
    customFields: {
      ...baseCustomFields,
      lastVerificationStatus: isExactOfficial ? 'officially_verified' : 'syntax_validated',
    },
    updatedAt: report.verifiedAt,
  };
}
