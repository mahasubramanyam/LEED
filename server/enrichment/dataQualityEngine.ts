import {
  evaluateFreshnessState,
  getFreshnessSpec,
} from '../../shared/enrichmentSpecs.js';
import {
  AttributeProvenanceEntry,
  CanonicalLead,
  CompanyPersonRelationship,
  DataQualityFactor,
  DataQualityScoreBreakdown,
  EnrichmentConflictRecord,
  PersonRecord,
  StaleAttributeIndicator,
} from '../types.js';

function parseJsonSafe<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getGrade(score: number): DataQualityScoreBreakdown['grade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Deterministic, explainable Data Quality Engine for Companies.
 * Separates Completeness, Verification, Freshness, and Overall score.
 * Explicitly prevents a company with many unverified fields from receiving a misleading high overall score.
 */
export function evaluateCompanyDataQuality(
  lead: CanonicalLead,
  options: {
    nowMs?: number;
    linkedPersonsCount?: number;
    duplicateCandidatesCount?: number;
    relationships?: CompanyPersonRelationship[];
  } = {}
): DataQualityScoreBreakdown {
  const nowMs = options.nowMs ?? Date.now();
  const factors: DataQualityFactor[] = [];
  const missingCriticalFields: string[] = [];
  const staleAttributes: StaleAttributeIndicator[] = [];

  const cf = lead.customFields || {};
  const attrSources = parseJsonSafe<Record<string, { retrievedAt?: string; sourceType?: string; sourceName?: string; verifiedAt?: string }>>(
    cf.attributeSources,
    {}
  );
  const webProv: Record<string, AttributeProvenanceEntry> = lead.webMetadata?.attributeProvenance || {};
  const openConflicts = [
    ...parseJsonSafe<EnrichmentConflictRecord[]>(cf.enrichmentConflicts, []).filter((c) => c.status === 'open'),
    ...parseJsonSafe<Array<{ field?: string }>>(cf.verificationConflicts, []),
  ];
  const conflictingAttributes = Array.from(
    new Set(openConflicts.map((c) => c.field).filter((f): f is string => Boolean(f)))
  );

  // 1. COMPLETENESS SCORE (0–100)
  const completenessChecks: Array<{
    key: string;
    label: string;
    weight: number;
    critical: boolean;
    present: boolean;
  }> = [
    { key: 'legalName', label: 'Legal Company Name', weight: 12, critical: true, present: Boolean(lead.legalName || lead.companyName) },
    { key: 'registrationNumber', label: 'Registration / Tax ID', weight: 14, critical: true, present: Boolean(lead.registrationNumber || (lead.identifiers?.length || 0) > 0) },
    { key: 'companyStatus', label: 'Company Status', weight: 8, critical: true, present: Boolean(lead.companyStatus && lead.companyStatus !== 'unknown') },
    { key: 'registeredAddress', label: 'Registered Address & Country', weight: 12, critical: true, present: Boolean(lead.address?.countryCode && (lead.address?.city || lead.address?.formattedAddress)) },
    { key: 'website', label: 'Official Website / Domain', weight: 12, critical: true, present: Boolean(lead.website || lead.domain) },
    { key: 'email', label: 'Business Email', weight: 10, critical: true, present: Boolean(lead.email) },
    { key: 'phone', label: 'Business Telephone', weight: 8, critical: true, present: Boolean(lead.phone || lead.phoneNormalized) },
    { key: 'industry', label: 'Industry / Category', weight: 8, critical: true, present: Boolean(lead.industry && lead.industry !== 'Commercial Services') },
    { key: 'description', label: 'Business Description', weight: 6, critical: false, present: Boolean(lead.webMetadata?.description || cf.businessDescription) },
    { key: 'employeeRange', label: 'Employee Size / Firmographics', weight: 5, critical: false, present: Boolean(lead.employeeRange || lead.foundedYear || cf.revenueRange) },
    { key: 'socialLinks', label: 'Official Social / Leadership Presence', weight: 5, critical: false, present: Boolean(Object.values(lead.socialLinks || {}).some(Boolean) || (options.linkedPersonsCount || 0) > 0) },
  ];

  let completenessEarned = 0;
  for (const check of completenessChecks) {
    if (check.present) {
      completenessEarned += check.weight;
    } else if (check.critical) {
      missingCriticalFields.push(check.label);
    }
  }
  const completenessScore = clamp(completenessEarned);
  if (missingCriticalFields.length > 0) {
    factors.push({
      dimension: 'completeness',
      impact: 'negative',
      points: -(100 - completenessScore),
      label: `${missingCriticalFields.length} critical field(s) missing`,
      detail: `Missing: ${missingCriticalFields.slice(0, 5).join(', ')}`,
    });
  } else {
    factors.push({
      dimension: 'completeness',
      impact: 'positive',
      points: completenessScore,
      label: 'All critical company profile fields populated',
      detail: 'Legal identity, address, website, business contact channels, and industry are present.',
    });
  }

  // 2. VERIFICATION SCORE (0–100) — evidence-backed only!
  let verificationPoints = 0;
  const hasOfficialRegistryId = (lead.identifiers || []).some(
    (id) => id.verified || id.status === 'officially_verified'
  );
  const registryState = cf.registryVerificationState;
  const sourceCount = (lead.sources || []).length;
  const distinctSources = new Set((lead.sources || []).map((s) => s.sourceName.toLowerCase())).size;

  if (hasOfficialRegistryId || registryState === 'officially_verified') {
    verificationPoints += 40;
    factors.push({
      dimension: 'verification',
      impact: 'positive',
      points: 40,
      label: 'Officially verified against corporate registry',
      detail: 'Legal entity status/identifier corroborated by an authoritative registry.',
    });
  } else if ((lead.identifiers || []).some((id) => id.status === 'syntax_validated')) {
    verificationPoints += 12;
    factors.push({
      dimension: 'verification',
      impact: 'warning',
      points: 12,
      label: 'Identifier syntax-validated only',
      detail: 'Mathematical checksum valid, but live official registry verification has not confirmed this record.',
    });
  } else {
    factors.push({
      dimension: 'verification',
      impact: 'negative',
      points: 0,
      label: 'No official registry verification on record',
      detail: 'Run multi-source enrichment or registry verification to confirm legal existence.',
    });
  }

  // Website & Domain verification
  if (lead.webMetadata?.inspectedAt && lead.webMetadata?.httpStatus && lead.webMetadata.httpStatus < 400) {
    const webPts = lead.webMetadata.companyIdentityConsistent === false ? 8 : 20;
    verificationPoints += webPts;
    factors.push({
      dimension: 'verification',
      impact: lead.webMetadata.companyIdentityConsistent === false ? 'warning' : 'positive',
      points: webPts,
      label:
        lead.webMetadata.companyIdentityConsistent === false
          ? 'Website reachable, but domain identity mismatch flagged'
          : 'Official website availability & domain inspected',
      detail: `Last inspected ${lead.webMetadata.inspectedAt.slice(0, 10)} (HTTP ${lead.webMetadata.httpStatus}).`,
    });
  }

  // Email verification evidence
  const emailVerMeta = parseJsonSafe<{ status?: string; deliverabilityClaimed?: boolean; verifiedAt?: string } | null>(
    cf.emailVerificationMeta,
    null
  );
  if (lead.emailStatus === 'verified' || emailVerMeta?.deliverabilityClaimed) {
    verificationPoints += 18;
    factors.push({
      dimension: 'verification',
      impact: 'positive',
      points: 18,
      label: 'Business email verified by authorized provider',
      detail: `Email status: ${emailVerMeta?.status || lead.emailStatus}.`,
    });
  } else if (emailVerMeta?.status === 'mail_config_verified' || emailVerMeta?.status === 'mx_present') {
    verificationPoints += 10;
    factors.push({
      dimension: 'verification',
      impact: 'warning',
      points: 10,
      label: 'Email domain MX/mail configuration verified',
      detail: 'DNS mail routing confirmed; full mailbox deliverability requires Hunter.io or ZeroBounce.',
    });
  } else if (lead.email && lead.emailStatus === 'syntax_valid') {
    verificationPoints += 4;
  }

  // Phone verification evidence
  const phoneVerMeta = parseJsonSafe<{ status?: string } | null>(cf.phoneVerificationMeta, null);
  if (phoneVerMeta?.status === 'provider_verified') {
    verificationPoints += 12;
    factors.push({
      dimension: 'verification',
      impact: 'positive',
      points: 12,
      label: 'Business telephone verified via carrier API',
      detail: 'Numbering plan and line type confirmed.',
    });
  } else if (lead.phoneNormalized || phoneVerMeta?.status === 'e164_valid') {
    verificationPoints += 6;
  }

  // Multi-source independent corroboration
  if (distinctSources >= 2) {
    const bonus = Math.min(10, distinctSources * 4);
    verificationPoints += bonus;
    factors.push({
      dimension: 'verification',
      impact: 'positive',
      points: bonus,
      label: `Corroborated across ${distinctSources} independent sources`,
      detail: `Total provenance sightings recorded: ${sourceCount}.`,
    });
  }

  // Consistency penalties
  let consistencyPenalty = 0;
  if (conflictingAttributes.length > 0) {
    consistencyPenalty += Math.min(20, conflictingAttributes.length * 8);
    factors.push({
      dimension: 'consistency',
      impact: 'negative',
      points: -consistencyPenalty,
      label: `${conflictingAttributes.length} unresolved attribute conflict(s)`,
      detail: `Conflicting fields: ${conflictingAttributes.join(', ')}. Owner resolution required.`,
    });
  }
  if (lead.companyStatus === 'dissolved' || lead.companyStatus === 'inactive') {
    consistencyPenalty += 15;
    factors.push({
      dimension: 'consistency',
      impact: 'warning',
      points: -15,
      label: `Company status reported as "${lead.companyStatus}"`,
      detail: 'Inactive or dissolved entities carry high outreach risk.',
    });
  }

  const verificationScore = clamp(verificationPoints - Math.round(consistencyPenalty * 0.5));

  // 3. FRESHNESS SCORE (0–100) using attribute-specific rules
  const trackedAttrs: Array<{ attr: string; present: boolean; timestamp?: string }> = [
    {
      attr: 'companyStatus',
      present: Boolean(lead.companyStatus),
      timestamp: attrSources.companyStatus?.verifiedAt || attrSources.companyStatus?.retrievedAt || cf.lastVerifiedAt,
    },
    {
      attr: 'legalName',
      present: Boolean(lead.legalName || lead.companyName),
      timestamp: attrSources.legalName?.verifiedAt || attrSources.legalName?.retrievedAt || cf.lastVerifiedAt,
    },
    {
      attr: 'registeredAddress',
      present: Boolean(lead.address?.formattedAddress || lead.address?.city),
      timestamp: attrSources.registeredAddress?.verifiedAt || attrSources.address?.retrievedAt || cf.lastVerifiedAt,
    },
    {
      attr: 'website',
      present: Boolean(lead.website || lead.domain),
      timestamp: lead.webMetadata?.inspectedAt || webProv.websiteTitle?.retrievedAt || attrSources.website?.retrievedAt,
    },
    {
      attr: 'email',
      present: Boolean(lead.email),
      timestamp: emailVerMeta?.verifiedAt || attrSources.email?.verifiedAt || attrSources.email?.retrievedAt,
    },
    {
      attr: 'phone',
      present: Boolean(lead.phone || lead.phoneNormalized),
      timestamp:
        parseJsonSafe<{ verifiedAt?: string } | null>(cf.phoneVerificationMeta, null)?.verifiedAt ||
        attrSources.phone?.verifiedAt ||
        attrSources.phone?.retrievedAt,
    },
  ];

  let freshWeightedTotal = 0;
  let freshWeightDenom = 0;

  for (const item of trackedAttrs) {
    if (!item.present) continue;
    const spec = getFreshnessSpec(item.attr);
    const weight = spec.critical ? 2 : 1;
    freshWeightDenom += weight;
    const evalRes = evaluateFreshnessState(item.attr, item.timestamp, nowMs);
    if (evalRes.status === 'fresh') {
      freshWeightedTotal += weight * 100;
    } else if (evalRes.status === 'aging') {
      freshWeightedTotal += weight * 65;
      staleAttributes.push({
        attribute: item.attr,
        label: spec.label,
        lastVerifiedAt: item.timestamp,
        ageDays: evalRes.ageDays,
        maxAgeDays: evalRes.maxAgeDays,
        status: 'aging',
      });
    } else if (evalRes.status === 'stale') {
      freshWeightedTotal += weight * 25;
      staleAttributes.push({
        attribute: item.attr,
        label: spec.label,
        lastVerifiedAt: item.timestamp,
        ageDays: evalRes.ageDays,
        maxAgeDays: evalRes.maxAgeDays,
        status: 'stale',
      });
    } else {
      freshWeightedTotal += weight * 15;
      staleAttributes.push({
        attribute: item.attr,
        label: spec.label,
        lastVerifiedAt: undefined,
        ageDays: null,
        maxAgeDays: evalRes.maxAgeDays,
        status: 'never_verified',
      });
    }
  }

  const freshnessScore = freshWeightDenom > 0 ? clamp(freshWeightedTotal / freshWeightDenom) : 0;
  const staleCount = staleAttributes.filter((s) => s.status === 'stale' || s.status === 'never_verified').length;
  if (staleCount > 0) {
    factors.push({
      dimension: 'freshness',
      impact: 'warning',
      points: -(100 - freshnessScore),
      label: `${staleCount} attribute(s) stale or never verified`,
      detail: staleAttributes
        .slice(0, 4)
        .map((s) => `${s.label} (${s.status === 'never_verified' ? 'never verified' : `${s.ageDays}d / ${s.maxAgeDays}d`})`)
        .join('; '),
    });
  } else if (freshWeightDenom > 0) {
    factors.push({
      dimension: 'freshness',
      impact: 'positive',
      points: freshnessScore,
      label: 'All populated tracked attributes are within freshness policy',
      detail: 'No stale fields requiring immediate re-verification.',
    });
  }

  // Duplicate risk consistency penalty
  const dupCount = options.duplicateCandidatesCount || 0;
  if (dupCount >= 2) {
    consistencyPenalty += 18;
    factors.push({
      dimension: 'consistency',
      impact: 'negative',
      points: -7,
      label: `High duplicate risk (${dupCount} matching CRM records)`,
      detail: 'Review potential duplicate companies before relying on or exporting this record.',
    });
  } else if (dupCount === 1) {
    consistencyPenalty += 10;
    factors.push({
      dimension: 'consistency',
      impact: 'warning',
      points: -4,
      label: 'Possible duplicate company detected',
      detail: 'One other CRM lead shares a matching company name or domain.',
    });
  }

  // 4. OVERALL SCORE WITH VERIFICATION CAP
  // Verification carries the highest weight (48%), followed by Completeness (32%) and Freshness (20%).
  let rawOverall = completenessScore * 0.32 + verificationScore * 0.48 + freshnessScore * 0.2 - consistencyPenalty * 0.4;
  let verificationCapApplied = false;
  let verificationCapReason: string | undefined;

  // Hard honesty guardrail: A company with many unverified fields MUST NOT receive a misleading high score!
  if (verificationScore < 25 && rawOverall > 54) {
    rawOverall = 54;
    verificationCapApplied = true;
    verificationCapReason =
      'Overall score capped at 54/100 because verification evidence is below 25/100 (populated but unverified data is not high quality).';
    factors.push({
      dimension: 'verification',
      impact: 'warning',
      points: 0,
      label: 'Verification quality cap applied (max 54)',
      detail: verificationCapReason,
    });
  } else if (verificationScore < 45 && rawOverall > 68) {
    rawOverall = 68;
    verificationCapApplied = true;
    verificationCapReason =
      'Overall score capped at 68/100 pending stronger authoritative registry or contact verification.';
  }

  const overallScore = clamp(rawOverall);
  const duplicateRisk: DataQualityScoreBreakdown['duplicateRisk'] =
    (options.duplicateCandidatesCount || 0) >= 2
      ? 'high'
      : (options.duplicateCandidatesCount || 0) === 1
      ? 'possible'
      : 'none';

  const relationshipConfidence =
    options.relationships && options.relationships.length > 0
      ? Math.round(
          options.relationships.reduce((acc, r) => acc + (r.confidenceScore || 50), 0) /
            options.relationships.length
        )
      : undefined;

  return {
    entityType: 'company',
    entityId: lead.id,
    completenessScore,
    verificationScore,
    freshnessScore,
    overallScore,
    grade: getGrade(overallScore),
    verificationCapApplied,
    verificationCapReason,
    missingCriticalFields,
    staleAttributes,
    conflictingAttributes,
    duplicateRisk,
    relationshipConfidence,
    reverificationEligible: staleAttributes.length > 0 || verificationScore < 60,
    factors,
    evaluatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * Deterministic, explainable Data Quality Engine for Decision-Makers (PersonRecord + relationships).
 */
export function evaluatePersonDataQuality(
  person: PersonRecord,
  relationships: CompanyPersonRelationship[],
  options: { nowMs?: number } = {}
): DataQualityScoreBreakdown {
  const nowMs = options.nowMs ?? Date.now();
  const factors: DataQualityFactor[] = [];
  const missingCriticalFields: string[] = [];
  const staleAttributes: StaleAttributeIndicator[] = [];
  const cf = person.customFields || {};

  const primaryRel = relationships.find((r) => r.isPrimaryContact) || relationships[0];
  const openConflicts = parseJsonSafe<EnrichmentConflictRecord[]>(cf.enrichmentConflicts, []).filter(
    (c) => c.status === 'open'
  );
  const conflictingAttributes = Array.from(new Set(openConflicts.map((c) => c.field)));

  // Completeness
  const checks = [
    { key: 'fullName', label: 'Full Name', weight: 15, critical: true, present: Boolean(person.fullName) },
    { key: 'jobTitle', label: 'Current Job Title', weight: 20, critical: true, present: Boolean(primaryRel?.jobTitle || primaryRel?.designation) },
    { key: 'company', label: 'Linked Company', weight: 15, critical: true, present: relationships.length > 0 },
    { key: 'email', label: 'Business Email', weight: 18, critical: true, present: Boolean(person.email) },
    { key: 'linkedinUrl', label: 'Professional Profile / Official Bio', weight: 12, critical: false, present: Boolean(person.linkedinUrl || person.officialBioUrl) },
    { key: 'department', label: 'Department / Seniority', weight: 10, critical: false, present: Boolean(primaryRel?.department || person.seniority) },
    { key: 'phone', label: 'Business Phone', weight: 10, critical: false, present: Boolean(person.phone || person.phoneNormalized) },
  ];

  let compEarned = 0;
  for (const c of checks) {
    if (c.present) compEarned += c.weight;
    else if (c.critical) missingCriticalFields.push(c.label);
  }
  const completenessScore = clamp(compEarned);

  // Verification
  let verPts = 0;
  if (person.verificationStatus === 'officially_verified') {
    verPts += 45;
    factors.push({
      dimension: 'verification',
      impact: 'positive',
      points: 45,
      label: 'Officially verified officer / executive',
      detail: 'Identity corroborated by official corporate registry filing.',
    });
  } else if (person.verificationStatus === 'web_observed') {
    verPts += 32;
    factors.push({
      dimension: 'verification',
      impact: 'positive',
      points: 32,
      label: 'Published on official company website',
      detail: 'Role observed directly on company leadership or corporate pages.',
    });
  } else if (person.verificationStatus === 'directory_listed') {
    verPts += 20;
  } else {
    factors.push({
      dimension: 'verification',
      impact: 'warning',
      points: 0,
      label: 'Contact not yet corroborated by official source',
      detail: `Current verification status: ${person.verificationStatus}.`,
    });
  }

  const emailVerMeta = parseJsonSafe<{ status?: string; deliverabilityClaimed?: boolean; verifiedAt?: string } | null>(
    cf.emailVerificationMeta,
    null
  );
  if (person.emailStatus === 'verified' || emailVerMeta?.deliverabilityClaimed) {
    verPts += 25;
  } else if (emailVerMeta?.status === 'mail_config_verified' || emailVerMeta?.status === 'mx_present') {
    verPts += 14;
  } else if (person.email && person.emailStatus === 'syntax_valid') {
    verPts += 6;
  }

  if (primaryRel?.provenance?.employmentStatus === 'historical') {
    verPts -= 20;
    factors.push({
      dimension: 'consistency',
      impact: 'warning',
      points: -20,
      label: 'Historical / resigned company role',
      detail: 'Officer or executive has a recorded departure/resignation indicator.',
    });
  }

  const distinctSources = new Set((person.sources || []).map((s) => s.sourceName.toLowerCase())).size;
  if (distinctSources >= 2) {
    verPts += 12;
  }

  const verificationScore = clamp(verPts);

  // Freshness
  const tracked = [
    { attr: 'jobTitle', present: Boolean(primaryRel?.jobTitle), ts: primaryRel?.provenance?.lastObservedAt || primaryRel?.updatedAt },
    { attr: 'email', present: Boolean(person.email), ts: emailVerMeta?.verifiedAt || person.attributeProvenance?.email?.retrievedAt },
    { attr: 'employmentStatus', present: relationships.length > 0, ts: primaryRel?.provenance?.lastObservedAt || primaryRel?.updatedAt },
  ];

  let fSum = 0;
  let fCount = 0;
  for (const t of tracked) {
    if (!t.present) continue;
    fCount += 1;
    const spec = getFreshnessSpec(t.attr);
    const res = evaluateFreshnessState(t.attr, t.ts, nowMs);
    if (res.status === 'fresh') fSum += 100;
    else if (res.status === 'aging') {
      fSum += 65;
      staleAttributes.push({ attribute: t.attr, label: spec.label, lastVerifiedAt: t.ts, ageDays: res.ageDays, maxAgeDays: res.maxAgeDays, status: 'aging' });
    } else if (res.status === 'stale') {
      fSum += 25;
      staleAttributes.push({ attribute: t.attr, label: spec.label, lastVerifiedAt: t.ts, ageDays: res.ageDays, maxAgeDays: res.maxAgeDays, status: 'stale' });
    } else {
      fSum += 15;
      staleAttributes.push({ attribute: t.attr, label: spec.label, ageDays: null, maxAgeDays: res.maxAgeDays, status: 'never_verified' });
    }
  }
  const freshnessScore = fCount > 0 ? clamp(fSum / fCount) : 0;

  let rawOverall = completenessScore * 0.3 + verificationScore * 0.5 + freshnessScore * 0.2 - conflictingAttributes.length * 8;
  let verificationCapApplied = false;
  let verificationCapReason: string | undefined;
  if (verificationScore < 25 && rawOverall > 52) {
    rawOverall = 52;
    verificationCapApplied = true;
    verificationCapReason = 'Overall person quality capped at 52/100 due to low verification evidence.';
  }

  const overallScore = clamp(rawOverall);
  const relConf =
    relationships.length > 0
      ? Math.round(relationships.reduce((s, r) => s + (r.confidenceScore || 50), 0) / relationships.length)
      : 0;

  return {
    entityType: 'person',
    entityId: person.id,
    completenessScore,
    verificationScore,
    freshnessScore,
    overallScore,
    grade: getGrade(overallScore),
    verificationCapApplied,
    verificationCapReason,
    missingCriticalFields,
    staleAttributes,
    conflictingAttributes,
    duplicateRisk: (person.possibleDuplicateIds?.length || 0) > 0 ? 'possible' : 'none',
    relationshipConfidence: relConf,
    reverificationEligible: staleAttributes.length > 0 || verificationScore < 55,
    factors,
    evaluatedAt: new Date(nowMs).toISOString(),
  };
}
