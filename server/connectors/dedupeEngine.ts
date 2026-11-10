import { CanonicalLead, MergeHistoryRecord } from '../types.js';

export interface DuplicateMatch {
  leadA: CanonicalLead;
  leadB: CanonicalLead;
  matchType: 'domain' | 'registration_number' | 'phone' | 'fuzzy_name';
  matchedValue: string;
  similarityScore: number; // 0 to 1
  recommendedSurvivorId: string;
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

function nameSimilarity(name1: string, name2: string): number {
  const clean1 = name1.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  const clean2 = name2.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
  if (clean1 === clean2) return 1.0;
  const maxLen = Math.max(clean1.length, clean2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(clean1, clean2);
  return Math.max(0, 1 - dist / maxLen);
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
        });
        continue;
      }

      // 2. Exact Registration Number Match
      if (
        a.registrationNumber &&
        b.registrationNumber &&
        a.registrationNumber.replace(/\s+/g, '') === b.registrationNumber.replace(/\s+/g, '')
      ) {
        matches.push({
          leadA: a,
          leadB: b,
          matchType: 'registration_number',
          matchedValue: a.registrationNumber,
          similarityScore: 1.0,
          recommendedSurvivorId: a.confidenceScore >= b.confidenceScore ? a.id : b.id,
        });
        continue;
      }

      // 3. Exact Phone Match
      if (
        a.phone &&
        b.phone &&
        a.phone.replace(/[^0-9]/g, '') === b.phone.replace(/[^0-9]/g, '') &&
        a.phone.replace(/[^0-9]/g, '').length >= 7
      ) {
        matches.push({
          leadA: a,
          leadB: b,
          matchType: 'phone',
          matchedValue: a.phone,
          similarityScore: 0.95,
          recommendedSurvivorId: a.confidenceScore >= b.confidenceScore ? a.id : b.id,
        });
        continue;
      }

      // 4. Fuzzy Name Match (same city or same country)
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
          });
        }
      }
    }
  }

  return matches;
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

  // Combine identifiers
  const existingIdKeys = new Set(survivor.identifiers.map((i) => `${i.type}:${i.value}`));
  const combinedIdentifiers = [...survivor.identifiers];
  for (const ident of absorbed.identifiers) {
    const key = `${ident.type}:${ident.value}`;
    if (!existingIdKeys.has(key)) {
      combinedIdentifiers.push(ident);
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
    registrationNumber: survivor.registrationNumber || absorbed.registrationNumber,
    registrationType: survivor.registrationType || absorbed.registrationType,
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
