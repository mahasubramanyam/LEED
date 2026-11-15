import crypto from 'node:crypto';
import {
  CanonicalLead,
  CompanyPersonRelationship,
  LeadIdentifier,
  NormalizedImportCompany,
  NormalizedImportPerson,
  PersonRecord,
} from '../types.js';
import { canonicalizeIdentifierType } from '../../shared/identifierRegistry.js';
import { normalizeIdentifierValue } from '../identifiers/identifierEngine.js';

export function buildCanonicalLeadFromImport(input: {
  company: NormalizedImportCompany;
  filename: string;
  pipelineStageId?: string;
  actorEmail: string;
  now: string;
}): CanonicalLead {
  const { company, filename, pipelineStageId, actorEmail, now } = input;
  const id = `imp-lead-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const identifiers: LeadIdentifier[] = (company.identifiers || []).map((ident, idx) => ({
    ...ident,
    id: ident.id || `ident-${id}-${idx}`,
    type: canonicalizeIdentifierType(ident.type, ident.countryCode || company.countryCode),
    normalizedValue: ident.normalizedValue || normalizeIdentifierValue(ident.value),
    status: ident.status === 'syntax_validated' ? 'syntax_validated' : 'user_provided',
    verified: false, // Never fabricate official verification during import
    source: ident.source || 'import_engine',
    createdAt: now,
  }));

  const signals: string[] = ['Imported via LEED File Import Engine'];
  let confidence = 45;
  if (company.domain) {
    confidence += 12;
    signals.push('Domain Normalized in Import File');
  }
  if (company.registrationNumber) {
    const hasSyntaxValid = identifiers.some(
      (i) => i.type === company.registrationType && i.status === 'syntax_validated'
    );
    confidence += hasSyntaxValid ? 18 : 10;
    signals.push(
      hasSyntaxValid
        ? 'Business Identifier Format Validated (Pending Official Registry Verification)'
        : 'Business Identifier Supplied by Owner'
    );
  }
  if (company.emailStatus === 'syntax_valid') {
    confidence += 10;
    signals.push('Business Email Syntax Validated');
  }
  if (company.phoneNormalized) {
    confidence += 10;
    signals.push('Phone Normalized to E.164');
  }
  if (company.formattedAddress) {
    confidence += 5;
  }

  return {
    id,
    companyName: company.companyName || company.legalName || company.tradingName || 'Unnamed Entity',
    legalName: company.legalName || undefined,
    registrationNumber: company.registrationNumber || undefined,
    registrationType: company.registrationType || undefined,
    companyStatus: company.companyStatus || 'unknown',
    website: company.website || undefined,
    domain: company.domain || undefined,
    email: company.email || undefined,
    emailStatus: company.emailStatus || 'unavailable',
    phone: company.phone || undefined,
    phoneNormalized: company.phoneNormalized || undefined,
    address: {
      street: company.street,
      city: company.city,
      region: company.region,
      postalCode: company.postalCode,
      country: company.country,
      countryCode: company.countryCode,
      formattedAddress: company.formattedAddress,
    },
    industry: company.industry || 'Commercial Services',
    category: company.category || 'Imported Prospect',
    employeeRange: company.employeeRange,
    foundedYear: company.foundedYear,
    confidenceScore: Math.min(90, confidence),
    confidenceSignals: signals,
    sources: [
      {
        sourceName: `File Import (${filename})`,
        providerId: company.registrationNumber || undefined,
        retrievedAt: now,
        attribution: `Imported by ${actorEmail}`,
      },
    ],
    identifiers,
    socialLinks: company.linkedinCompanyUrl ? { linkedin: company.linkedinCompanyUrl } : undefined,
    status: 'new',
    pipelineStageId,
    opportunityValue: company.opportunityValue ?? 0,
    currency: company.currency || 'USD',
    tags: Array.from(new Set(['Imported', company.countryCode, ...(company.tags || [])])),
    notes: [],
    activities: [
      {
        id: `act-${id}-1`,
        type: 'enrichment',
        title: `Imported from ${filename}`,
        outcome: `Normalized & deduplicated (${company.countryCode})`,
        date: now,
        actor: actorEmail,
      },
    ],
    customFields: Object.keys(company.customFields || {}).length > 0 ? { ...company.customFields } : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Safely enriches an existing CRM lead ONLY with missing non-CRM fields.
 * Strictly preserves: companyName, pipelineStageId, status, opportunityValue, winProbability,
 * lostReason, notes, existing activities, existing identifiers, and existing non-empty fields.
 */
export function safelyMergeImportedCompanyIntoLead(input: {
  existing: CanonicalLead;
  imported: NormalizedImportCompany;
  filename: string;
  actorEmail: string;
  now: string;
}): { merged: CanonicalLead; fieldsEnriched: string[] } {
  const { existing, imported, filename, actorEmail, now } = input;
  const fieldsEnriched: string[] = [];

  const nextLegalName = existing.legalName || imported.legalName;
  if (!existing.legalName && imported.legalName) fieldsEnriched.push('legalName');

  const nextRegNum = existing.registrationNumber || imported.registrationNumber;
  const nextRegType = existing.registrationNumber
    ? existing.registrationType
    : imported.registrationType || existing.registrationType;
  if (!existing.registrationNumber && imported.registrationNumber) {
    fieldsEnriched.push('registrationNumber');
  }

  const nextCompanyStatus =
    existing.companyStatus && existing.companyStatus !== 'unknown'
      ? existing.companyStatus
      : imported.companyStatus && imported.companyStatus !== 'unknown'
      ? imported.companyStatus
      : existing.companyStatus || 'unknown';
  if ((!existing.companyStatus || existing.companyStatus === 'unknown') && nextCompanyStatus !== 'unknown') {
    fieldsEnriched.push('companyStatus');
  }

  const nextWebsite = existing.website || imported.website;
  const nextDomain = existing.domain || imported.domain;
  if (!existing.website && imported.website) fieldsEnriched.push('website');

  const nextEmail = existing.email || imported.email;
  const nextEmailStatus = existing.email ? existing.emailStatus : imported.emailStatus || existing.emailStatus;
  if (!existing.email && imported.email) fieldsEnriched.push('email');

  const nextPhone = existing.phone || imported.phone;
  const nextPhoneNorm = existing.phoneNormalized || imported.phoneNormalized;
  if (!existing.phone && imported.phone) fieldsEnriched.push('phone');
  else if (!existing.phoneNormalized && imported.phoneNormalized) fieldsEnriched.push('phoneNormalized');

  const addr = { ...(existing.address || { country: imported.country, countryCode: imported.countryCode }) };
  if (!addr.street && imported.street) {
    addr.street = imported.street;
    fieldsEnriched.push('address.street');
  }
  if (!addr.city && imported.city) {
    addr.city = imported.city;
    fieldsEnriched.push('address.city');
  }
  if (!addr.region && imported.region) {
    addr.region = imported.region;
    fieldsEnriched.push('address.region');
  }
  if (!addr.postalCode && imported.postalCode) {
    addr.postalCode = imported.postalCode;
    fieldsEnriched.push('address.postalCode');
  }
  if (!addr.formattedAddress && imported.formattedAddress) {
    addr.formattedAddress = imported.formattedAddress;
  }

  const nextEmployeeRange = existing.employeeRange || imported.employeeRange;
  if (!existing.employeeRange && imported.employeeRange) fieldsEnriched.push('employeeRange');

  const nextFoundedYear = existing.foundedYear || imported.foundedYear;
  if (!existing.foundedYear && imported.foundedYear) fieldsEnriched.push('foundedYear');

  const nextIndustry =
    existing.industry && existing.industry !== 'Commercial Services'
      ? existing.industry
      : imported.industry || existing.industry;

  const nextCategory =
    existing.category && existing.category !== 'General' && existing.category !== 'Imported Prospect'
      ? existing.category
      : imported.category || existing.category;

  const nextSocialLinks = { ...(existing.socialLinks || {}) };
  if (!nextSocialLinks.linkedin && imported.linkedinCompanyUrl) {
    nextSocialLinks.linkedin = imported.linkedinCompanyUrl;
    fieldsEnriched.push('socialLinks.linkedin');
  }

  // Merge non-conflicting identifiers (never overwrite or mark officially_verified)
  const mergedIdentifiers: LeadIdentifier[] = [...(existing.identifiers || [])];
  for (const cand of imported.identifiers || []) {
    const canonType = canonicalizeIdentifierType(cand.type, cand.countryCode || addr.countryCode);
    const normVal = cand.normalizedValue || normalizeIdentifierValue(cand.value);
    const alreadyPresent = mergedIdentifiers.some(
      (ex) =>
        canonicalizeIdentifierType(ex.type, ex.countryCode || addr.countryCode) === canonType &&
        (ex.normalizedValue || normalizeIdentifierValue(ex.value)) === normVal
    );
    const conflictingSameType =
      canonType !== 'DOMAIN' &&
      mergedIdentifiers.some(
        (ex) =>
          canonicalizeIdentifierType(ex.type, ex.countryCode || addr.countryCode) === canonType &&
          (ex.normalizedValue || normalizeIdentifierValue(ex.value)) !== normVal
      );
    if (!alreadyPresent && !conflictingSameType) {
      mergedIdentifiers.push({
        ...cand,
        id: `ident-${existing.id}-${mergedIdentifiers.length}-${crypto.randomBytes(2).toString('hex')}`,
        type: canonType,
        normalizedValue: normVal,
        status: cand.status === 'syntax_validated' ? 'syntax_validated' : 'user_provided',
        verified: false,
        source: cand.source || 'import_engine',
        createdAt: now,
      });
      fieldsEnriched.push(`identifier:${canonType}`);
    }
  }

  // Merge customFields without overwriting any existing CRM customFields keys
  const mergedCustomFields: Record<string, string> = { ...(existing.customFields || {}) };
  for (const [k, v] of Object.entries(imported.customFields || {})) {
    if (mergedCustomFields[k] === undefined && v) {
      mergedCustomFields[k] = v;
      fieldsEnriched.push(`customField:${k}`);
    }
  }

  const mergedTags = Array.from(new Set([...(existing.tags || []), ...(imported.tags || [])]));
  const hasSourceAlready = (existing.sources || []).some((s) => s.sourceName === `File Import (${filename})`);
  const mergedSources = hasSourceAlready
    ? existing.sources || []
    : [
        ...(existing.sources || []),
        {
          sourceName: `File Import (${filename})`,
          providerId: imported.registrationNumber || undefined,
          retrievedAt: now,
          attribution: `Safe merge enrichment by ${actorEmail}`,
        },
      ];

  const mergedActivities = [...(existing.activities || [])];
  if (fieldsEnriched.length > 0) {
    mergedActivities.unshift({
      id: `act-imp-merge-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      type: 'enrichment',
      title: `Safely enriched from ${filename}`,
      notes: `Added missing fields: ${fieldsEnriched.join(', ')}`,
      outcome: 'CRM pipeline stage, notes, tasks, and verified facts preserved',
      date: now,
      actor: actorEmail,
    });
  }

  const merged: CanonicalLead = {
    ...existing,
    legalName: nextLegalName,
    registrationNumber: nextRegNum,
    registrationType: nextRegType,
    companyStatus: nextCompanyStatus,
    website: nextWebsite,
    domain: nextDomain,
    email: nextEmail,
    emailStatus: nextEmailStatus,
    phone: nextPhone,
    phoneNormalized: nextPhoneNorm,
    address: addr,
    industry: nextIndustry,
    category: nextCategory,
    employeeRange: nextEmployeeRange,
    foundedYear: nextFoundedYear,
    socialLinks: Object.keys(nextSocialLinks).length > 0 ? nextSocialLinks : existing.socialLinks,
    identifiers: mergedIdentifiers,
    sources: mergedSources,
    tags: mergedTags,
    activities: mergedActivities,
    customFields: Object.keys(mergedCustomFields).length > 0 ? mergedCustomFields : existing.customFields,
    // Strictly preserve CRM ownership/pipeline/value/status/notes:
    companyName: existing.companyName,
    status: existing.status,
    pipelineStageId: existing.pipelineStageId,
    opportunityValue: existing.opportunityValue,
    currency: existing.currency,
    winProbability: existing.winProbability,
    lostReason: existing.lostReason,
    notes: existing.notes,
    updatedAt: now,
  };

  return { merged, fieldsEnriched };
}

export function buildPersonRecordFromImport(input: {
  person: NormalizedImportPerson;
  filename: string;
  actorEmail: string;
  now: string;
}): PersonRecord {
  const { person, filename, actorEmail, now } = input;
  const id = `per-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const hasSyntaxValidated = person.emailStatus === 'syntax_valid' || Boolean(person.phoneNormalized);

  let confidence = 45;
  if (person.emailStatus === 'syntax_valid') confidence += 20;
  if (person.phoneNormalized) confidence += 15;
  if (person.linkedinSlug) confidence += 15;

  const cf = { ...(person.customFields || {}) };
  if (person.associatedCompanyName) cf.associatedCompanyName = person.associatedCompanyName;
  if (person.associatedCompanyRegNumber) cf.associatedCompanyRegNumber = person.associatedCompanyRegNumber;

  return {
    id,
    fullName: person.fullName || 'Unnamed Contact',
    firstName: person.firstName,
    lastName: person.lastName,
    normalizedName: person.normalizedName || (person.fullName || '').toLowerCase(),
    email: person.email,
    emailStatus: person.emailStatus || 'unavailable',
    phone: person.phone,
    phoneNormalized: person.phoneNormalized,
    linkedinUrl: person.linkedinUrl,
    linkedinSlug: person.linkedinSlug,
    country: person.country,
    countryCode: person.countryCode,
    city: person.city,
    sources: [
      {
        sourceName: `File Import (${filename})`,
        retrievedAt: now,
        attribution: `Imported by ${actorEmail}`,
      },
    ],
    confidenceScore: Math.min(90, confidence),
    verificationStatus: hasSyntaxValidated ? 'syntax_validated' : 'user_provided',
    customFields: Object.keys(cf).length > 0 ? cf : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function mergeImportedPersonSafely(
  existing: PersonRecord,
  imported: NormalizedImportPerson,
  filename: string,
  now: string
): { person: PersonRecord; updated: boolean } {
  let updated = false;
  const next: PersonRecord = { ...existing };

  if (!next.email && imported.email) {
    next.email = imported.email;
    next.emailStatus = imported.emailStatus || 'unverified';
    updated = true;
  }
  if (!next.phone && imported.phone) {
    next.phone = imported.phone;
    updated = true;
  }
  if (!next.phoneNormalized && imported.phoneNormalized) {
    next.phoneNormalized = imported.phoneNormalized;
    updated = true;
  }
  if (!next.linkedinUrl && imported.linkedinUrl) {
    next.linkedinUrl = imported.linkedinUrl;
    next.linkedinSlug = imported.linkedinSlug;
    updated = true;
  }
  if (!next.city && imported.city) {
    next.city = imported.city;
    updated = true;
  }
  if (!next.countryCode && imported.countryCode) {
    next.countryCode = imported.countryCode;
    next.country = imported.country;
    updated = true;
  }

  if (updated) {
    const hasSrc = (next.sources || []).some((s) => s.sourceName === `File Import (${filename})`);
    if (!hasSrc) {
      next.sources = [
        ...(next.sources || []),
        { sourceName: `File Import (${filename})`, retrievedAt: now },
      ];
    }
    next.updatedAt = now;
  }

  return { person: next, updated };
}

export function buildRelationshipRecord(input: {
  leadId: string;
  personId: string;
  person: NormalizedImportPerson;
  filename: string;
  rowNumber: number;
  now: string;
}): CompanyPersonRelationship {
  const { leadId, personId, person, filename, rowNumber, now } = input;
  const hasSyntaxValidated = person.emailStatus === 'syntax_valid' || Boolean(person.phoneNormalized);

  return {
    id: `cpr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    leadId,
    personId,
    relationshipType: person.relationshipType || 'contact',
    jobTitle: person.jobTitle || person.relationshipPosition,
    designation: person.designation,
    department: person.department,
    decisionMakerCategory: person.decisionMakerCategory,
    isPrimaryContact: Boolean(person.isPrimaryContact),
    sourceName: `File Import (${filename})`,
    provenance: {
      filename,
      rowNumber,
      importedAt: now,
    },
    confidenceScore: hasSyntaxValidated ? 75 : 55,
    verificationStatus: hasSyntaxValidated ? 'syntax_validated' : 'user_provided',
    createdAt: now,
    updatedAt: now,
  };
}
