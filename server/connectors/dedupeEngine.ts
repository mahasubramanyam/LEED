import { CanonicalLead, DiscoveryDuplicateInfo, MergeHistoryRecord } from '../types.js';
import { canonicalizeIdentifierType } from '../../shared/identifierRegistry.js';

export interface DuplicateMatch {
  leadA: CanonicalLead;
  leadB: CanonicalLead;
  matchType: 'domain' | 'registration_number' | 'phone' | 'address' | 'fuzzy_name';
  matchedValue: string;
  similarityScore: number; // 0 to 1
  recommendedSurvivorId: string;
  classification?: 'exact' | 'ambiguous';
  autoMergeSafe?: boolean;
}

export interface DiscoveryDedupeAnalysis {
  duplicateInfoByLeadId: Record<string, DiscoveryDuplicateInfo>;
  counts: {
    totalUnique: number;
    existingCrmMatches: number;
    ambiguousMatches: number;
    crossSourceCorroborations: number;
  };
}

// Simple Levenshtein distance for fuzzy name comparison
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function normalizeCompanyToken(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|incorporated|llc|gmbh|as|asa|pty|corp|corporation|plc)\b/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameSimilarity(name1: string, name2: string): number {
  const clean1 = normalizeCompanyToken(name1) || name1.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  const clean2 = normalizeCompanyToken(name2) || name2.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  if (clean1 === clean2 && clean1.length > 0) return 1.0;
  const maxLen = Math.max(clean1.length, clean2.length);
  if (maxLen === 0) return 0;
  const dist = levenshteinDistance(clean1, clean2);
  return Math.max(0, 1 - dist / maxLen);
}

export function normalizeAddressSignature(lead: CanonicalLead): string | null {
  const street = (lead.address?.street || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
  const city = (lead.address?.city || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
  const postal = (lead.address?.postalCode || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
  const country = (lead.address?.countryCode || '').toUpperCase().trim();

  if (street.length < 5 || (!city && !postal) || !country) {
    return null;
  }
  return `${country}|${city || postal}|${street}`;
}

export function detectDuplicates(leads: CanonicalLead[]): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const checkedPairs = new Set<string>();

  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      const a = leads[i];
      const b = leads[j];
      const pairKey = [a.id, b.id].sort().join(':::');
      if (checkedPairs.has(pairKey)) continue;
      checkedPairs.add(pairKey);

      // 1. Exact Domain Match
      if (a.domain && b.domain && a.domain.toLowerCase() === b.domain.toLowerCase()) {
        matches.push({
          leadA: a,
          leadB: b,
          matchType: 'domain',
          matchedValue: a.domain,
          similarityScore: 1.0,
          recommendedSurvivorId: a.confidenceScore >= b.confidenceScore ? a.id : b.id,
          classification: 'exact',
          autoMergeSafe: true,
        });
        continue;
      }

      // 2. Exact or Normalized Registration Number Match
      const cleanRegA = (a.registrationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cleanRegB = (b.registrationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cleanRegA && cleanRegB && cleanRegA === cleanRegB) {
        matches.push({
          leadA: a,
          leadB: b,
          matchType: 'registration_number',
          matchedValue: a.registrationNumber || cleanRegA,
          similarityScore: 1.0,
          recommendedSurvivorId: a.confidenceScore >= b.confidenceScore ? a.id : b.id,
          classification: 'exact',
          autoMergeSafe: true,
        });
        continue;
      }

      // 2b. Match across multiple normalized identifiers (e.g. matching LEI, VAT, OrgNr, CRN) using canonical aliases
      let matchedIdent: string | null = null;
      if (a.identifiers && b.identifiers) {
        for (const idA of a.identifiers) {
          const normA = (idA.normalizedValue || idA.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (!normA || normA.length < 5) continue;
          const typeA = canonicalizeIdentifierType(idA.type, a.address?.countryCode);
          for (const idB of b.identifiers) {
            const normB = (idB.normalizedValue || idB.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            const typeB = canonicalizeIdentifierType(idB.type, b.address?.countryCode);
            if (normA === normB && typeA === typeB) {
              matchedIdent = `${typeA}: ${idA.value}`;
              break;
            }
          }
          if (matchedIdent) break;
        }
      }

      if (matchedIdent) {
        matches.push({
          leadA: a,
          leadB: b,
          matchType: 'registration_number',
          matchedValue: matchedIdent,
          similarityScore: 1.0,
          recommendedSurvivorId: a.confidenceScore >= b.confidenceScore ? a.id : b.id,
          classification: 'exact',
          autoMergeSafe: true,
        });
        continue;
      }

      // 3. Exact Phone Match (checking phoneNormalized E.164 and raw digits)
      const phoneA = (a.phoneNormalized || a.phone || '').replace(/[^0-9]/g, '');
      const phoneB = (b.phoneNormalized || b.phone || '').replace(/[^0-9]/g, '');
      if (phoneA && phoneB && phoneA === phoneB && phoneA.length >= 7) {
        matches.push({
          leadA: a,
          leadB: b,
          matchType: 'phone',
          matchedValue: a.phoneNormalized || a.phone || phoneA,
          similarityScore: 0.95,
          recommendedSurvivorId: a.confidenceScore >= b.confidenceScore ? a.id : b.id,
          classification: 'exact',
          autoMergeSafe: true,
        });
        continue;
      }

      // 4. Normalized Street Address Match (ambiguous unless names are also highly similar)
      const addrA = normalizeAddressSignature(a);
      const addrB = normalizeAddressSignature(b);
      if (addrA && addrB && addrA === addrB) {
        const sim = nameSimilarity(a.companyName, b.companyName);
        matches.push({
          leadA: a,
          leadB: b,
          matchType: 'address',
          matchedValue: a.address?.formattedAddress || `${a.address?.street}, ${a.address?.city || a.address?.postalCode}`,
          similarityScore: parseFloat(Math.max(0.85, sim).toFixed(2)),
          recommendedSurvivorId: a.confidenceScore >= b.confidenceScore ? a.id : b.id,
          classification: sim >= 0.85 ? 'exact' : 'ambiguous',
          autoMergeSafe: sim >= 0.9,
        });
        continue;
      }

      // 5. Fuzzy Name Match (same country)
      const sameCountry =
        a.address?.countryCode &&
        b.address?.countryCode &&
        a.address.countryCode.toLowerCase() === b.address.countryCode.toLowerCase();

      if (sameCountry) {
        const sim = nameSimilarity(a.companyName, b.companyName);
        if (sim >= 0.85) {
          matches.push({
            leadA: a,
            leadB: b,
            matchType: 'fuzzy_name',
            matchedValue: `${a.companyName} ~ ${b.companyName}`,
            similarityScore: parseFloat(sim.toFixed(2)),
            recommendedSurvivorId: a.confidenceScore >= b.confidenceScore ? a.id : b.id,
            classification: 'ambiguous',
            autoMergeSafe: false,
          });
        }
      }
    }
  }

  return matches;
}

interface PairComparison {
  classification: 'exact' | 'ambiguous';
  matchType: DuplicateMatch['matchType'];
  matchedValue: string;
  similarityScore: number;
  note: string;
}

function compareLeadPair(candidate: CanonicalLead, target: CanonicalLead): PairComparison | null {
  if (candidate.id === target.id) {
    return {
      classification: 'exact',
      matchType: 'registration_number',
      matchedValue: target.id,
      similarityScore: 1.0,
      note: 'Identical canonical lead ID',
    };
  }

  // 1. Registration number
  const regA = (candidate.registrationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const regB = (target.registrationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (regA.length >= 4 && regB.length >= 4 && regA === regB) {
    return {
      classification: 'exact',
      matchType: 'registration_number',
      matchedValue: target.registrationNumber || regB,
      similarityScore: 1.0,
      note: `Exact registration number match (${target.registrationNumber || regB})`,
    };
  }

  // 2. Canonical identifiers (VAT, LEI, ORG, CRN, etc.)
  for (const idA of candidate.identifiers || []) {
    const normA = (idA.normalizedValue || idA.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normA.length < 5) continue;
    const typeA = canonicalizeIdentifierType(idA.type, idA.countryCode || candidate.address?.countryCode);
    if (typeA === 'DOMAIN' || typeA === 'PHONE' || typeA === 'EMAIL') continue;
    for (const idB of target.identifiers || []) {
      const normB = (idB.normalizedValue || idB.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const typeB = canonicalizeIdentifierType(idB.type, idB.countryCode || target.address?.countryCode);
      if (normA === normB && typeA === typeB) {
        return {
          classification: 'exact',
          matchType: 'registration_number',
          matchedValue: `${typeA}: ${idB.value}`,
          similarityScore: 1.0,
          note: `Canonical identifier match (${typeA}: ${idB.value})`,
        };
      }
    }
  }

  // 3. Domain match
  if (candidate.domain && target.domain && candidate.domain.toLowerCase() === target.domain.toLowerCase()) {
    return {
      classification: 'exact',
      matchType: 'domain',
      matchedValue: target.domain,
      similarityScore: 1.0,
      note: `Exact domain match (${target.domain})`,
    };
  }

  // 4. Phone match
  const phoneA = (candidate.phoneNormalized || candidate.phone || '').replace(/[^0-9]/g, '');
  const phoneB = (target.phoneNormalized || target.phone || '').replace(/[^0-9]/g, '');
  if (phoneA.length >= 7 && phoneB.length >= 7 && phoneA === phoneB) {
    return {
      classification: 'exact',
      matchType: 'phone',
      matchedValue: target.phoneNormalized || target.phone || phoneB,
      similarityScore: 0.96,
      note: `Exact telephone match (${target.phoneNormalized || target.phone})`,
    };
  }

  // 5. Normalized address match
  const addrA = normalizeAddressSignature(candidate);
  const addrB = normalizeAddressSignature(target);
  const nameSim = nameSimilarity(candidate.companyName, target.companyName);
  if (addrA && addrB && addrA === addrB) {
    if (nameSim >= 0.85) {
      return {
        classification: 'exact',
        matchType: 'address',
        matchedValue: target.address?.formattedAddress || addrB,
        similarityScore: parseFloat(Math.max(0.92, nameSim).toFixed(2)),
        note: 'Exact street address and name match',
      };
    }
    return {
      classification: 'ambiguous',
      matchType: 'address',
      matchedValue: target.address?.formattedAddress || addrB,
      similarityScore: parseFloat(nameSim.toFixed(2)),
      note: 'Same physical address with different business name (requires owner review; not auto-merged)',
    };
  }

  // 6. Fuzzy / cross-country name match
  const sameCountry =
    candidate.address?.countryCode &&
    target.address?.countryCode &&
    candidate.address.countryCode.toUpperCase() === target.address.countryCode.toUpperCase();
  const sameCity =
    candidate.address?.city &&
    target.address?.city &&
    candidate.address.city.toLowerCase().trim() === target.address.city.toLowerCase().trim();

  if (sameCountry) {
    if (nameSim === 1.0 && sameCity) {
      return {
        classification: 'exact',
        matchType: 'fuzzy_name',
        matchedValue: `${target.companyName} (${target.address?.city})`,
        similarityScore: 1.0,
        note: 'Exact company name and city match in same country',
      };
    }
    if (nameSim >= 0.82) {
      return {
        classification: 'ambiguous',
        matchType: 'fuzzy_name',
        matchedValue: target.companyName,
        similarityScore: parseFloat(nameSim.toFixed(2)),
        note: `Similar business name (${Math.round(nameSim * 100)}%) in ${target.address?.countryCode} — requires owner review`,
      };
    }
  } else if (nameSim >= 0.96) {
    return {
      classification: 'ambiguous',
      matchType: 'fuzzy_name',
      matchedValue: `${target.companyName} (${target.address?.countryCode || 'Foreign'})`,
      similarityScore: parseFloat(nameSim.toFixed(2)),
      note: `Matching corporate name in another country (${target.address?.countryCode}) — multi-national entity review required`,
    };
  }

  return null;
}

/**
 * Classifies discovered leads against existing CRM leads AND cross-source peers in the same batch.
 * Never auto-merges uncertain/ambiguous pairs; surfaces explicit review metadata instead.
 */
export function detectDiscoveryDuplicates(
  candidates: CanonicalLead[],
  existingCrmLeads: CanonicalLead[]
): DiscoveryDedupeAnalysis {
  const duplicateInfoByLeadId: Record<string, DiscoveryDuplicateInfo> = {};
  let existingCrmMatches = 0;
  let ambiguousMatches = 0;
  let crossSourceCorroborations = 0;
  let totalUnique = 0;

  for (const cand of candidates) {
    let bestExact: { target: CanonicalLead; cmp: PairComparison } | null = null;
    let bestAmbiguous: { target: CanonicalLead; cmp: PairComparison } | null = null;

    for (const crm of existingCrmLeads) {
      const cmp = compareLeadPair(cand, crm);
      if (!cmp) continue;
      if (cmp.classification === 'exact') {
        if (!bestExact || cmp.similarityScore > bestExact.cmp.similarityScore) {
          bestExact = { target: crm, cmp };
        }
      } else if (!bestAmbiguous || cmp.similarityScore > bestAmbiguous.cmp.similarityScore) {
        bestAmbiguous = { target: crm, cmp };
      }
    }

    const crossMatches: string[] = [];
    let bestCrossAmbiguous: { target: CanonicalLead; cmp: PairComparison } | null = null;

    for (const peer of candidates) {
      if (peer.id === cand.id) continue;
      const cmp = compareLeadPair(cand, peer);
      if (!cmp) continue;
      if (cmp.classification === 'exact') {
        crossMatches.push(peer.id);
      } else if (!bestCrossAmbiguous || cmp.similarityScore > bestCrossAmbiguous.cmp.similarityScore) {
        bestCrossAmbiguous = { target: peer, cmp };
      }
    }

    if (bestExact) {
      existingCrmMatches++;
      duplicateInfoByLeadId[cand.id] = {
        status: 'existing_crm',
        classification: 'exact',
        requiresReview: false,
        matchedLeadId: bestExact.target.id,
        matchedLeadName: bestExact.target.companyName,
        matchType: bestExact.cmp.matchType,
        matchedValue: bestExact.cmp.matchedValue,
        similarityScore: bestExact.cmp.similarityScore,
        crossSourceLeadIds: crossMatches.length > 0 ? crossMatches : undefined,
        note: bestExact.cmp.note,
      };
    } else if (bestAmbiguous) {
      ambiguousMatches++;
      duplicateInfoByLeadId[cand.id] = {
        status: 'ambiguous_crm',
        classification: 'ambiguous',
        requiresReview: true,
        matchedLeadId: bestAmbiguous.target.id,
        matchedLeadName: bestAmbiguous.target.companyName,
        matchType: bestAmbiguous.cmp.matchType,
        matchedValue: bestAmbiguous.cmp.matchedValue,
        similarityScore: bestAmbiguous.cmp.similarityScore,
        crossSourceLeadIds: crossMatches.length > 0 ? crossMatches : undefined,
        note: bestAmbiguous.cmp.note,
      };
    } else if (crossMatches.length > 0) {
      crossSourceCorroborations++;
      totalUnique++;
      duplicateInfoByLeadId[cand.id] = {
        status: 'cross_source_match',
        classification: 'exact',
        requiresReview: false,
        crossSourceLeadIds: crossMatches,
        note: `Corroborated across ${crossMatches.length + 1} discovered records`,
      };
    } else if (bestCrossAmbiguous) {
      ambiguousMatches++;
      duplicateInfoByLeadId[cand.id] = {
        status: 'cross_source_match',
        classification: 'ambiguous',
        requiresReview: true,
        matchedLeadId: bestCrossAmbiguous.target.id,
        matchedLeadName: bestCrossAmbiguous.target.companyName,
        matchType: bestCrossAmbiguous.cmp.matchType,
        matchedValue: bestCrossAmbiguous.cmp.matchedValue,
        similarityScore: bestCrossAmbiguous.cmp.similarityScore,
        note: bestCrossAmbiguous.cmp.note,
      };
    } else {
      totalUnique++;
      duplicateInfoByLeadId[cand.id] = {
        status: 'unique',
        classification: 'none',
        requiresReview: false,
      };
    }
  }

  return {
    duplicateInfoByLeadId,
    counts: {
      totalUnique,
      existingCrmMatches,
      ambiguousMatches,
      crossSourceCorroborations,
    },
  };
}

export function mergeLeads(
  survivor: CanonicalLead,
  absorbed: CanonicalLead,
  reason: string
): { updatedSurvivor: CanonicalLead; historyRecord: MergeHistoryRecord } {
  const now = new Date().toISOString();

  // Create snapshot of absorbed lead for 100% reliable undo
  const historyRecord: MergeHistoryRecord = {
    id: `merge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    survivorLeadId: survivor.id,
    mergedLeadSnapshot: JSON.parse(JSON.stringify(absorbed)),
    mergedAt: now,
    mergedReason: reason,
  };

  // Combine sources while avoiding duplicates
  const existingSourceUrls = new Set(survivor.sources.map((s) => s.url || s.sourceName));
  const combinedSources = [...survivor.sources];
  for (const src of absorbed.sources) {
    if (!existingSourceUrls.has(src.url || src.sourceName)) {
      combinedSources.push(src);
    }
  }

  // Combine identifiers with canonical + normalized deduplication
  const normKey = (i: any) =>
    `${canonicalizeIdentifierType(i.type)}:${(i.normalizedValue || i.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
  const existingIdKeys = new Set(survivor.identifiers.map(normKey));
  const combinedIdentifiers = survivor.identifiers.map((ident) => ({
    ...ident,
    type: canonicalizeIdentifierType(ident.type, ident.countryCode || survivor.address?.countryCode),
  }));
  for (const ident of absorbed.identifiers) {
    const key = normKey(ident);
    if (!existingIdKeys.has(key)) {
      existingIdKeys.add(key);
      combinedIdentifiers.push({
        ...ident,
        type: canonicalizeIdentifierType(ident.type, ident.countryCode || absorbed.address?.countryCode),
      });
    }
  }

  // Combine tags
  const combinedTags = Array.from(new Set([...survivor.tags, ...absorbed.tags, 'merged']));

  // Combine notes
  const combinedNotes = [...survivor.notes, ...absorbed.notes];

  // Combine activities
  const combinedActivities = [
    ...survivor.activities,
    {
      id: `act-${Date.now()}-merge`,
      type: 'merge' as const,
      title: `Merged with duplicate: ${absorbed.companyName}`,
      outcome: `Absorbed ID ${absorbed.id} (${reason})`,
      date: now,
      actor: 'Owner',
    },
    ...absorbed.activities,
  ];

  // Take strongest fields
  const updatedSurvivor: CanonicalLead = {
    ...survivor,
    website: survivor.website || absorbed.website,
    domain: survivor.domain || absorbed.domain,
    email: survivor.email || absorbed.email,
    phone: survivor.phone || absorbed.phone,
    phoneNormalized: survivor.phoneNormalized || absorbed.phoneNormalized,
    registrationNumber: survivor.registrationNumber || absorbed.registrationNumber,
    registrationType: survivor.registrationType ? canonicalizeIdentifierType(survivor.registrationType) : (absorbed.registrationType ? canonicalizeIdentifierType(absorbed.registrationType) : undefined),
    address: {
      street: survivor.address?.street || absorbed.address?.street,
      city: survivor.address?.city || absorbed.address?.city,
      region: survivor.address?.region || absorbed.address?.region,
      postalCode: survivor.address?.postalCode || absorbed.address?.postalCode,
      country: survivor.address?.country || absorbed.address?.country || 'International',
      countryCode: survivor.address?.countryCode || absorbed.address?.countryCode || 'US',
      formattedAddress: survivor.address?.formattedAddress || absorbed.address?.formattedAddress,
    },
    coordinates: survivor.coordinates || absorbed.coordinates,
    confidenceScore: Math.min(100, Math.max(survivor.confidenceScore, absorbed.confidenceScore) + 5),
    confidenceSignals: Array.from(new Set([...survivor.confidenceSignals, ...absorbed.confidenceSignals, 'Merged Multi-Source Evidence'])),
    sources: combinedSources,
    identifiers: combinedIdentifiers,
    tags: combinedTags,
    notes: combinedNotes,
    activities: combinedActivities,
    updatedAt: now,
  };

  return { updatedSurvivor, historyRecord };
}
