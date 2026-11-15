import {
  CanonicalLead,
  CompanyPersonRelationship,
  ImportDedupeResult,
  ImportNormalizationOptions,
  ImportRowDecisionAction,
  NormalizedImportCompany,
  NormalizedImportPerson,
  PersonRecord,
} from '../types.js';
import { canonicalizeIdentifierType } from '../../shared/identifierRegistry.js';
import {
  normalizeIdentifierValue,
  normalizeUkCrn,
  normalizeUsCik,
} from '../identifiers/identifierEngine.js';

function normRegKey(value?: string, regType?: string, countryCode?: string): string {
  if (!value) return '';
  const canon = regType ? canonicalizeIdentifierType(regType, countryCode) : '';
  if (canon === 'UK_CRN') return normalizeUkCrn(value);
  if (canon === 'US_CIK') return normalizeUsCik(value);
  return normalizeIdentifierValue(value);
}

function cleanCompanyToken(name?: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|incorporated|llc|gmbh|as|asa|pty|corp|corporation|plc|sas|sarl|pte|kk)\b/gi, '')
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

export function companyNameSimilarity(nameA?: string, nameB?: string): number {
  const cleanA = cleanCompanyToken(nameA) || (nameA || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  const cleanB = cleanCompanyToken(nameB) || (nameB || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  if (!cleanA || !cleanB) return 0;
  if (cleanA === cleanB) return 1;
  const maxLen = Math.max(cleanA.length, cleanB.length);
  return Math.max(0, 1 - levenshtein(cleanA, cleanB) / maxLen);
}

function addressSignature(addr?: { street?: string; city?: string; postalCode?: string; countryCode?: string }): string | null {
  if (!addr) return null;
  const street = (addr.street || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const city = (addr.city || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const postal = (addr.postalCode || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  const cc = (addr.countryCode || '').toUpperCase().trim();
  if (street.length < 5 || (!city && !postal) || !cc) return null;
  return `${cc}|${city || postal}|${street}`;
}

export function buildCompanyGroupKey(company?: NormalizedImportCompany, person?: NormalizedImportPerson): string | undefined {
  if (company) {
    const regKey = normRegKey(company.registrationNumber, company.registrationType, company.countryCode);
    if (regKey.length >= 4) return `reg:${company.countryCode}:${regKey}`;
    if (company.domain) return `dom:${company.domain.toLowerCase()}`;
    if (company.companyName) return `name:${company.countryCode}:${cleanCompanyToken(company.companyName)}`;
  }
  if (person?.associatedCompanyRegNumber) {
    const regKey = normalizeIdentifierValue(person.associatedCompanyRegNumber);
    if (regKey.length >= 4) return `assoc_reg:${regKey}`;
  }
  if (person?.associatedCompanyName) {
    return `assoc_name:${cleanCompanyToken(person.associatedCompanyName)}`;
  }
  return undefined;
}

function findMatchingCrmLeadForCompany(
  company: {
    companyName?: string;
    legalName?: string;
    registrationNumber?: string;
    registrationType?: string;
    domain?: string;
    phoneNormalized?: string;
    phone?: string;
    street?: string;
    city?: string;
    postalCode?: string;
    countryCode?: string;
    identifiers?: Array<{ type: string; value: string; normalizedValue?: string; countryCode?: string }>;
  },
  existingLeads: CanonicalLead[]
): {
  kind: 'exact' | 'possible' | 'conflict' | 'none';
  matchedLead?: CanonicalLead;
  matchedField?: string;
  matchedValue?: string;
  similarityScore?: number;
  conflicts: string[];
} {
  const conflicts: string[] = [];
  const candReg = normRegKey(company.registrationNumber, company.registrationType, company.countryCode);
  const candDom = company.domain?.toLowerCase().trim();
  const candPhoneDigits = (company.phoneNormalized || company.phone || '').replace(/[^0-9]/g, '');
  const candAddr = addressSignature({
    street: company.street,
    city: company.city,
    postalCode: company.postalCode,
    countryCode: company.countryCode,
  });

  // 1. Registration Number or Secondary Canonical Identifier
  for (const crm of existingLeads) {
    const crmReg = normRegKey(crm.registrationNumber, crm.registrationType, crm.address?.countryCode);
    const regMatched = candReg.length >= 4 && crmReg.length >= 4 && candReg === crmReg;

    let secondaryMatch: { type: string; value: string } | undefined;
    if (!regMatched && company.identifiers) {
      for (const idA of company.identifiers) {
        const typeA = canonicalizeIdentifierType(idA.type, idA.countryCode || company.countryCode);
        if (typeA === 'DOMAIN' || typeA === 'PHONE' || typeA === 'EMAIL') continue;
        const normA = normRegKey(idA.normalizedValue || idA.value, typeA, idA.countryCode || company.countryCode);
        if (normA.length < 4) continue;
        for (const idB of crm.identifiers || []) {
          const typeB = canonicalizeIdentifierType(idB.type, idB.countryCode || crm.address?.countryCode);
          const normB = normRegKey(idB.normalizedValue || idB.value, typeB, idB.countryCode || crm.address?.countryCode);
          if (normA === normB && typeA === typeB) {
            secondaryMatch = { type: typeA, value: idB.value };
            break;
          }
        }
        if (secondaryMatch) break;
      }
    }

    if (regMatched || secondaryMatch) {
      const nameSim = companyNameSimilarity(
        company.legalName || company.companyName,
        crm.legalName || crm.companyName
      );
      const countryDiffers =
        company.countryCode &&
        crm.address?.countryCode &&
        company.countryCode.toUpperCase() !== crm.address.countryCode.toUpperCase() &&
        secondaryMatch?.type !== 'LEI';

      if ((company.companyName && nameSim < 0.55) || countryDiffers) {
        conflicts.push(
          countryDiffers
            ? `Matched identifier (${secondaryMatch?.value || crm.registrationNumber}) belongs to ${crm.companyName} in ${crm.address?.countryCode}, whereas imported row specifies ${company.countryCode}.`
            : `Matched registration number (${crm.registrationNumber}) belongs to "${crm.companyName}", which differs significantly from imported name "${company.companyName}".`
        );
        return {
          kind: 'conflict',
          matchedLead: crm,
          matchedField: secondaryMatch ? secondaryMatch.type : 'registrationNumber',
          matchedValue: secondaryMatch ? secondaryMatch.value : crm.registrationNumber,
          similarityScore: Number(nameSim.toFixed(2)),
          conflicts,
        };
      }

      return {
        kind: 'exact',
        matchedLead: crm,
        matchedField: secondaryMatch ? secondaryMatch.type : 'registrationNumber',
        matchedValue: secondaryMatch ? secondaryMatch.value : crm.registrationNumber,
        similarityScore: 1,
        conflicts,
      };
    }
  }

  // 2. Domain match (check for registration number conflict if both sides have one)
  if (candDom) {
    const domMatch = existingLeads.find((l) => l.domain?.toLowerCase() === candDom);
    if (domMatch) {
      const crmReg = normRegKey(domMatch.registrationNumber, domMatch.registrationType, domMatch.address?.countryCode);
      if (candReg.length >= 4 && crmReg.length >= 4 && candReg !== crmReg) {
        conflicts.push(
          `Domain "${candDom}" matches CRM lead "${domMatch.companyName}" (Reg: ${domMatch.registrationNumber}), which conflicts with imported Reg "${company.registrationNumber}".`
        );
        return {
          kind: 'conflict',
          matchedLead: domMatch,
          matchedField: 'domain',
          matchedValue: candDom,
          similarityScore: 0.9,
          conflicts,
        };
      }
      return {
        kind: 'exact',
        matchedLead: domMatch,
        matchedField: 'domain',
        matchedValue: candDom,
        similarityScore: 1,
        conflicts,
      };
    }
  }

  // 3. Phone match
  if (candPhoneDigits.length >= 7) {
    const phoneMatch = existingLeads.find((l) => {
      const exDigits = (l.phoneNormalized || l.phone || '').replace(/[^0-9]/g, '');
      return exDigits.length >= 7 && exDigits === candPhoneDigits;
    });
    if (phoneMatch) {
      const nameSim = company.companyName ? companyNameSimilarity(company.companyName, phoneMatch.companyName) : 1;
      if (company.companyName && nameSim < 0.5) {
        conflicts.push(
          `Phone number matches "${phoneMatch.companyName}" but imported company name "${company.companyName}" is dissimilar.`
        );
        return {
          kind: 'possible',
          matchedLead: phoneMatch,
          matchedField: 'phone',
          matchedValue: phoneMatch.phoneNormalized || phoneMatch.phone,
          similarityScore: Number(nameSim.toFixed(2)),
          conflicts,
        };
      }
      return {
        kind: 'exact',
        matchedLead: phoneMatch,
        matchedField: 'phone',
        matchedValue: phoneMatch.phoneNormalized || phoneMatch.phone,
        similarityScore: 0.96,
        conflicts,
      };
    }
  }

  // 4. Address + Fuzzy Name
  let bestPossible: { lead: CanonicalLead; field: string; value: string; sim: number } | null = null;
  for (const crm of existingLeads) {
    const crmAddr = addressSignature(crm.address);
    const sim = company.companyName ? companyNameSimilarity(company.companyName, crm.companyName) : 0;

    if (candAddr && crmAddr && candAddr === crmAddr) {
      if (sim >= 0.85) {
        return {
          kind: 'exact',
          matchedLead: crm,
          matchedField: 'address',
          matchedValue: crm.address?.formattedAddress || crmAddr,
          similarityScore: Number(Math.max(0.92, sim).toFixed(2)),
          conflicts,
        };
      }
      if (!bestPossible || sim > bestPossible.sim) {
        bestPossible = {
          lead: crm,
          field: 'address',
          value: crm.address?.formattedAddress || crmAddr,
          sim: Number(sim.toFixed(2)),
        };
      }
    }

    const sameCountry =
      company.countryCode &&
      crm.address?.countryCode &&
      company.countryCode.toUpperCase() === crm.address.countryCode.toUpperCase();
    const sameCity =
      company.city &&
      crm.address?.city &&
      company.city.toLowerCase().trim() === crm.address.city.toLowerCase().trim();

    if (sameCountry && sim === 1 && sameCity) {
      return {
        kind: 'exact',
        matchedLead: crm,
        matchedField: 'companyName+city',
        matchedValue: `${crm.companyName} (${crm.address?.city})`,
        similarityScore: 1,
        conflicts,
      };
    }

    if ((sameCountry && sim >= 0.82) || (!sameCountry && sim >= 0.96)) {
      if (!bestPossible || sim > bestPossible.sim) {
        bestPossible = {
          lead: crm,
          field: 'fuzzy_name',
          value: crm.companyName,
          sim: Number(sim.toFixed(2)),
        };
      }
    }
  }

  if (bestPossible) {
    return {
      kind: 'possible',
      matchedLead: bestPossible.lead,
      matchedField: bestPossible.field,
      matchedValue: bestPossible.value,
      similarityScore: bestPossible.sim,
      conflicts,
    };
  }

  return { kind: 'none', conflicts };
}

export function findMatchingPerson(
  person: NormalizedImportPerson,
  matchedLeadId: string | undefined,
  existingPersons: PersonRecord[],
  existingRelationships: CompanyPersonRelationship[]
): {
  matchedPerson?: PersonRecord;
  matchedBy?: 'email' | 'linkedin' | 'phone' | 'name_company';
  matchedRelationship?: CompanyPersonRelationship;
} {
  let matchedPerson: PersonRecord | undefined;
  let matchedBy: 'email' | 'linkedin' | 'phone' | 'name_company' | undefined;

  if (person.email) {
    const emailLower = person.email.toLowerCase();
    matchedPerson = existingPersons.find((p) => p.email?.toLowerCase() === emailLower);
    if (matchedPerson) matchedBy = 'email';
  }

  if (!matchedPerson && person.linkedinSlug) {
    const slugLower = person.linkedinSlug.toLowerCase();
    matchedPerson = existingPersons.find((p) => p.linkedinSlug?.toLowerCase() === slugLower);
    if (matchedPerson) matchedBy = 'linkedin';
  }

  if (!matchedPerson && person.phoneNormalized) {
    matchedPerson = existingPersons.find(
      (p) => p.phoneNormalized === person.phoneNormalized && p.normalizedName === person.normalizedName
    );
    if (matchedPerson) matchedBy = 'phone';
  }

  if (!matchedPerson && matchedLeadId && person.normalizedName) {
    const linkedIds = new Set(
      existingRelationships.filter((r) => r.leadId === matchedLeadId).map((r) => r.personId)
    );
    matchedPerson = existingPersons.find(
      (p) => linkedIds.has(p.id) && p.normalizedName === person.normalizedName
    );
    if (matchedPerson) matchedBy = 'name_company';
  }

  let matchedRelationship: CompanyPersonRelationship | undefined;
  if (matchedPerson && matchedLeadId) {
    matchedRelationship = existingRelationships.find(
      (r) =>
        r.leadId === matchedLeadId &&
        r.personId === matchedPerson!.id &&
        r.relationshipType.toLowerCase() === person.relationshipType.toLowerCase()
    );
  }

  return { matchedPerson, matchedBy, matchedRelationship };
}

function detectNewCompanyFields(existing: CanonicalLead, incoming: NormalizedImportCompany): string[] {
  const newFields: string[] = [];
  if (!existing.legalName && incoming.legalName) newFields.push('legalName');
  if (!existing.registrationNumber && incoming.registrationNumber) newFields.push('registrationNumber');
  if (!existing.website && incoming.website) newFields.push('website');
  if (!existing.domain && incoming.domain) newFields.push('domain');
  if (!existing.email && incoming.email) newFields.push('email');
  if (!existing.phone && incoming.phone) newFields.push('phone');
  if (!existing.address?.street && incoming.street) newFields.push('street');
  if (!existing.address?.city && incoming.city) newFields.push('city');
  if (!existing.address?.region && incoming.region) newFields.push('region');
  if (!existing.address?.postalCode && incoming.postalCode) newFields.push('postalCode');
  if (!existing.employeeRange && incoming.employeeRange) newFields.push('employeeRange');
  if (!existing.foundedYear && incoming.foundedYear) newFields.push('foundedYear');
  if (!existing.socialLinks?.linkedin && incoming.linkedinCompanyUrl) newFields.push('linkedinCompanyUrl');
  return newFields;
}

export function classifyImportBatchDuplicates(
  rows: Array<{
    rowNumber: number;
    valid: boolean;
    importKind: 'company_only' | 'person_only' | 'company_and_person' | 'empty';
    company?: NormalizedImportCompany;
    person?: NormalizedImportPerson;
  }>,
  context: {
    existingLeads: CanonicalLead[];
    existingPersons: PersonRecord[];
    existingRelationships: CompanyPersonRelationship[];
    options: ImportNormalizationOptions;
  }
): {
  dedupeByRow: Map<number, ImportDedupeResult>;
  recommendedActionByRow: Map<number, ImportRowDecisionAction>;
  changesSummaryByRow: Map<number, string[]>;
} {
  const dedupeByRow = new Map<number, ImportDedupeResult>();
  const recommendedActionByRow = new Map<number, ImportRowDecisionAction>();
  const changesSummaryByRow = new Map<number, string[]>();

  // Track seen companies & persons inside this file to avoid intra-file duplicates
  const seenCompanyByReg = new Map<string, { rowNumber: number; companyName: string }>();
  const seenCompanyByDomain = new Map<string, { rowNumber: number; companyName: string }>();
  const seenCompanyByKey = new Map<string, number>();
  const seenPersonKeys = new Map<string, number>();

  for (const row of rows) {
    if (!row.valid || row.importKind === 'empty') {
      dedupeByRow.set(row.rowNumber, {
        classification: 'new_record',
        recommendedAction: 'skip',
      });
      recommendedActionByRow.set(row.rowNumber, 'skip');
      changesSummaryByRow.set(row.rowNumber, ['Row invalid — excluded from CRM write']);
      continue;
    }

    const companyGroupKey = buildCompanyGroupKey(row.company, row.person);
    const changes: string[] = [];

    // Check in-file conflicts / exact duplicates
    let inFileConflict: string | undefined;
    let inFileDuplicateOfRow: number | undefined;
    let isRepeatCompanyForNewPerson = false;

    if (row.company) {
      const regKey = normRegKey(row.company.registrationNumber, row.company.registrationType, row.company.countryCode);
      if (regKey.length >= 4) {
        const prev = seenCompanyByReg.get(`${row.company.countryCode}:${regKey}`);
        if (prev) {
          if (companyNameSimilarity(prev.companyName, row.company.companyName) < 0.55) {
            inFileConflict = `Row ${row.rowNumber} shares registration number "${row.company.registrationNumber}" with Row ${prev.rowNumber} ("${prev.companyName}") under a different company name.`;
          } else if (row.person) {
            isRepeatCompanyForNewPerson = true;
          } else {
            inFileDuplicateOfRow = prev.rowNumber;
          }
        } else {
          seenCompanyByReg.set(`${row.company.countryCode}:${regKey}`, {
            rowNumber: row.rowNumber,
            companyName: row.company.companyName || '',
          });
        }
      }

      if (!inFileDuplicateOfRow && !inFileConflict && row.company.domain) {
        const domKey = row.company.domain.toLowerCase();
        const prev = seenCompanyByDomain.get(domKey);
        if (prev) {
          if (companyNameSimilarity(prev.companyName, row.company.companyName) < 0.55) {
            inFileConflict = `Row ${row.rowNumber} shares domain "${domKey}" with Row ${prev.rowNumber} ("${prev.companyName}") under a different company name.`;
          } else if (row.person) {
            isRepeatCompanyForNewPerson = true;
          } else {
            inFileDuplicateOfRow = prev.rowNumber;
          }
        } else {
          seenCompanyByDomain.set(domKey, {
            rowNumber: row.rowNumber,
            companyName: row.company.companyName || '',
          });
        }
      }

      if (!inFileDuplicateOfRow && !inFileConflict && companyGroupKey) {
        const prevRow = seenCompanyByKey.get(companyGroupKey);
        if (prevRow !== undefined) {
          if (row.person) {
            isRepeatCompanyForNewPerson = true;
          } else {
            inFileDuplicateOfRow = prevRow;
          }
        } else {
          seenCompanyByKey.set(companyGroupKey, row.rowNumber);
        }
      }
    }

    // Track in-file duplicate person
    const personUniqueKey = row.person
      ? row.person.email
        ? `email:${row.person.email.toLowerCase()}`
        : row.person.linkedinSlug
        ? `li:${row.person.linkedinSlug.toLowerCase()}`
        : row.person.normalizedName && companyGroupKey
        ? `name:${companyGroupKey}:${row.person.normalizedName}`
        : undefined
      : undefined;

    if (personUniqueKey) {
      const prevPersonRow = seenPersonKeys.get(personUniqueKey);
      if (prevPersonRow !== undefined) {
        inFileDuplicateOfRow = inFileDuplicateOfRow ?? prevPersonRow;
      } else {
        seenPersonKeys.set(personUniqueKey, row.rowNumber);
      }
    }

    if (inFileConflict) {
      dedupeByRow.set(row.rowNumber, {
        classification: 'conflicting_identity',
        recommendedAction: 'needs_review',
        inFileCompanyGroupKey: companyGroupKey,
        conflictDetails: [inFileConflict],
      });
      recommendedActionByRow.set(row.rowNumber, 'needs_review');
      changesSummaryByRow.set(row.rowNumber, ['Conflict in uploaded file — owner review required']);
      continue;
    }

    // Match company (or associatedCompany for person_only rows) against existing CRM
    const companyLookupInput = row.company
      ? row.company
      : row.person?.associatedCompanyName || row.person?.associatedCompanyRegNumber
      ? {
          companyName: row.person.associatedCompanyName,
          registrationNumber: row.person.associatedCompanyRegNumber,
        }
      : undefined;

    const crmMatch = companyLookupInput
      ? findMatchingCrmLeadForCompany(companyLookupInput, context.existingLeads)
      : { kind: 'none' as const, conflicts: [] };

    const personMatch = row.person
      ? findMatchingPerson(
          row.person,
          crmMatch.matchedLead?.id,
          context.existingPersons,
          context.existingRelationships
        )
      : {};

    if (crmMatch.kind === 'conflict') {
      dedupeByRow.set(row.rowNumber, {
        classification: 'conflicting_identity',
        recommendedAction: 'needs_review',
        inFileCompanyGroupKey: companyGroupKey,
        matchedCrmLeadId: crmMatch.matchedLead?.id,
        matchedCrmLeadName: crmMatch.matchedLead?.companyName,
        matchedCrmField: crmMatch.matchedField,
        matchedCrmValue: crmMatch.matchedValue,
        similarityScore: crmMatch.similarityScore,
        conflictDetails: crmMatch.conflicts,
        matchedPersonId: personMatch.matchedPerson?.id,
        matchedPersonName: personMatch.matchedPerson?.fullName,
        matchedPersonBy: personMatch.matchedBy,
      });
      recommendedActionByRow.set(row.rowNumber, 'needs_review');
      changesSummaryByRow.set(row.rowNumber, [
        `Identity conflict with CRM record "${crmMatch.matchedLead?.companyName}" — never auto-merged`,
      ]);
      continue;
    }

    if (crmMatch.kind === 'possible') {
      dedupeByRow.set(row.rowNumber, {
        classification: 'possible_duplicate',
        recommendedAction: 'needs_review',
        inFileCompanyGroupKey: companyGroupKey,
        matchedCrmLeadId: crmMatch.matchedLead?.id,
        matchedCrmLeadName: crmMatch.matchedLead?.companyName,
        matchedCrmField: crmMatch.matchedField,
        matchedCrmValue: crmMatch.matchedValue,
        similarityScore: crmMatch.similarityScore,
        conflictDetails: crmMatch.conflicts.length > 0 ? crmMatch.conflicts : undefined,
        matchedPersonId: personMatch.matchedPerson?.id,
        matchedPersonName: personMatch.matchedPerson?.fullName,
        matchedPersonBy: personMatch.matchedBy,
      });
      recommendedActionByRow.set(row.rowNumber, 'needs_review');
      changesSummaryByRow.set(row.rowNumber, [
        `Possible match (${Math.round((crmMatch.similarityScore || 0) * 100)}%) to "${crmMatch.matchedLead?.companyName}" via ${crmMatch.matchedField} — owner review required`,
      ]);
      continue;
    }

    if (crmMatch.kind === 'exact' && crmMatch.matchedLead) {
      const newCompanyFields = row.company
        ? detectNewCompanyFields(crmMatch.matchedLead, row.company)
        : [];
      const hasNewPersonOrRel =
        Boolean(row.person) && (!personMatch.matchedPerson || !personMatch.matchedRelationship);

      const newInfoFields = [
        ...newCompanyFields,
        ...(hasNewPersonOrRel ? [`decisionMaker:${row.person!.fullName}`] : []),
      ];

      const classification =
        newInfoFields.length > 0 ? 'existing_with_new_info' : 'exact_crm_duplicate';

      let recommendedAction: ImportRowDecisionAction = 'skip';
      if (context.options.duplicatePolicy === 'merge_safe') {
        if (classification === 'existing_with_new_info') {
          recommendedAction = row.importKind === 'person_only' ? 'link_person_only' : 'update_existing';
        } else {
          recommendedAction = 'skip';
        }
      } else if (context.options.duplicatePolicy === 'skip_existing') {
        // Still allow linking person if row is person_only? Wait: policy says skip_existing duplicates for company rows
        recommendedAction = 'skip';
      } else {
        recommendedAction = 'skip';
      }

      if (recommendedAction === 'update_existing' || recommendedAction === 'link_person_only') {
        if (newCompanyFields.length > 0) {
          changes.push(`Enrich "${crmMatch.matchedLead.companyName}" with: ${newCompanyFields.join(', ')}`);
        } else {
          changes.push(`Preserve "${crmMatch.matchedLead.companyName}" CRM fields unchanged`);
        }
        if (row.person) {
          if (personMatch.matchedPerson && !personMatch.matchedRelationship) {
            changes.push(`Link existing person "${personMatch.matchedPerson.fullName}" as ${row.person.relationshipType}`);
          } else if (!personMatch.matchedPerson) {
            changes.push(`Create & link "${row.person.fullName}" (${row.person.relationshipType})`);
          }
        }
      } else {
        changes.push(`Duplicate of CRM record "${crmMatch.matchedLead.companyName}" (${crmMatch.matchedField}) — skipped`);
      }

      dedupeByRow.set(row.rowNumber, {
        classification,
        recommendedAction,
        inFileDuplicateOfRow,
        inFileCompanyGroupKey: companyGroupKey,
        matchedCrmLeadId: crmMatch.matchedLead.id,
        matchedCrmLeadName: crmMatch.matchedLead.companyName,
        matchedCrmField: crmMatch.matchedField,
        matchedCrmValue: crmMatch.matchedValue,
        similarityScore: crmMatch.similarityScore,
        newInfoFields,
        matchedPersonId: personMatch.matchedPerson?.id,
        matchedPersonName: personMatch.matchedPerson?.fullName,
        matchedPersonBy: personMatch.matchedBy,
        matchedRelationshipId: personMatch.matchedRelationship?.id,
      });
      recommendedActionByRow.set(row.rowNumber, recommendedAction);
      changesSummaryByRow.set(row.rowNumber, changes);
      continue;
    }

    // Handle pure in-file duplicate (not in CRM)
    if (inFileDuplicateOfRow && !isRepeatCompanyForNewPerson) {
      dedupeByRow.set(row.rowNumber, {
        classification: 'exact_crm_duplicate',
        recommendedAction: 'skip',
        inFileDuplicateOfRow,
        inFileCompanyGroupKey: companyGroupKey,
      });
      recommendedActionByRow.set(row.rowNumber, 'skip');
      changesSummaryByRow.set(row.rowNumber, [
        `Duplicate of Row #${inFileDuplicateOfRow} within uploaded file — skipped`,
      ]);
      continue;
    }

    // New CRM record (or second decision-maker row for a new company in same file)
    let action: ImportRowDecisionAction = 'create_new';
    if (row.importKind === 'person_only') {
      action = 'link_person_only';
      if (row.person?.associatedCompanyName) {
        changes.push(`Create person "${row.person.fullName}" (associated company "${row.person.associatedCompanyName}" not yet in CRM — stored standalone with unlinked company reference)`);
      } else {
        changes.push(`Create standalone person "${row.person?.fullName}"`);
      }
    } else if (isRepeatCompanyForNewPerson && row.person) {
      changes.push(`Link "${row.person.fullName}" (${row.person.relationshipType}) to company from same file`);
    } else {
      if (row.company) {
        changes.push(`Create CRM company "${row.company.companyName}" (${row.company.countryCode})`);
      }
      if (row.person) {
        changes.push(
          personMatch.matchedPerson
            ? `Link existing person "${personMatch.matchedPerson.fullName}" (${row.person.relationshipType})`
            : `Create & link "${row.person.fullName}" (${row.person.relationshipType})`
        );
      }
    }

    dedupeByRow.set(row.rowNumber, {
      classification: 'new_record',
      recommendedAction: action,
      inFileCompanyGroupKey: companyGroupKey,
      matchedPersonId: personMatch.matchedPerson?.id,
      matchedPersonName: personMatch.matchedPerson?.fullName,
      matchedPersonBy: personMatch.matchedBy,
    });
    recommendedActionByRow.set(row.rowNumber, action);
    changesSummaryByRow.set(row.rowNumber, changes);
  }

  return { dedupeByRow, recommendedActionByRow, changesSummaryByRow };
}
