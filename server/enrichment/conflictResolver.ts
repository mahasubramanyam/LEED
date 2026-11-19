import crypto from 'node:crypto';
import {
  evaluateFreshnessState,
  getAttributeSourcePrecedenceScore,
  getPrecedenceRationale,
} from '../../shared/enrichmentSpecs.js';
import {
  AttributeProvenanceType,
  EnrichmentConflictRecord,
  EnrichmentFieldProposal,
} from '../types.js';

export interface IncomingEnrichmentCandidate {
  field: string;
  label: string;
  value: string;
  sourceType: AttributeProvenanceType;
  sourceName: string;
  sourceUrl?: string;
  connectorId?: string;
  confidenceScore: number;
  retrievedAt: string;
}

export interface ExistingAttributeSnapshot {
  value?: string;
  sourceType?: AttributeProvenanceType;
  sourceName?: string;
  lastVerifiedAt?: string;
}

function normalizeForEquality(field: string, value: string): string {
  const trimmed = (value || '').trim();
  if (field === 'domain' || field === 'website') {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '');
  }
  if (field === 'phone' || field === 'phoneNormalized') {
    return trimmed.replace(/[^0-9+]/g, '');
  }
  if (field === 'email') {
    return trimmed.toLowerCase();
  }
  if (field === 'registrationNumber' || field === 'lei' || field === 'taxVatId') {
    return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  return trimmed.toLowerCase().replace(/\s+/g, ' ');
}

function deriveVerificationLabel(
  sourceType: AttributeProvenanceType,
  corroboratingCount: number,
  isConflict: boolean
): EnrichmentFieldProposal['verificationLabel'] {
  if (isConflict) return 'conflicting';
  if (sourceType === 'official_registry') return 'officially_verified';
  if (corroboratingCount >= 2 && (sourceType === 'official_website' || sourceType === 'authorized_verification_provider' || sourceType === 'authorized_provider')) {
    return 'multi_source_verified';
  }
  if (sourceType === 'authorized_verification_provider') return 'officially_verified';
  if (sourceType === 'ai_extracted') return 'ai_extracted';
  if (sourceType === 'inferred') return 'inferred';
  if (sourceType === 'not_verified') return 'unknown';
  return 'source_reported';
}

/**
 * Evaluates incoming multi-source attribute candidates against existing CRM values using
 * ATTRIBUTE-SPECIFIC source precedence.
 * - Never recommends silently overwriting stronger existing verified information with weaker source data.
 * - Flags transparent conflicts whenever distinct values disagree so the owner can inspect and decide.
 */
export function resolveEnrichmentProposalsAndConflicts(
  existingByField: Record<string, ExistingAttributeSnapshot>,
  incomingCandidates: IncomingEnrichmentCandidate[],
  nowMs: number = Date.now()
): {
  proposals: EnrichmentFieldProposal[];
  conflicts: EnrichmentConflictRecord[];
} {
  const proposals: EnrichmentFieldProposal[] = [];
  const conflicts: EnrichmentConflictRecord[] = [];

  // Group incoming candidates by field
  const byField = new Map<string, IncomingEnrichmentCandidate[]>();
  for (const c of incomingCandidates) {
    if (!c.value || !c.value.trim()) continue;
    const list = byField.get(c.field) || [];
    list.push(c);
    byField.set(c.field, list);
  }

  for (const [field, candidates] of byField.entries()) {
    // Group candidates by normalized value to detect corroboration vs inter-source conflicts
    const valueGroups = new Map<string, IncomingEnrichmentCandidate[]>();
    for (const c of candidates) {
      const norm = normalizeForEquality(field, c.value);
      if (!norm) continue;
      const g = valueGroups.get(norm) || [];
      g.push(c);
      valueGroups.set(norm, g);
    }
    if (valueGroups.size === 0) continue;

    // Pick strongest candidate group by attribute-specific precedence score
    const rankedGroups = Array.from(valueGroups.entries()).map(([norm, group]) => {
      const sorted = [...group].sort(
        (a, b) =>
          getAttributeSourcePrecedenceScore(field, b.sourceType) -
            getAttributeSourcePrecedenceScore(field, a.sourceType) ||
          b.confidenceScore - a.confidenceScore
      );
      const leadCand = sorted[0];
      const precedence = getAttributeSourcePrecedenceScore(field, leadCand.sourceType);
      const uniqueSources = Array.from(new Set(group.map((g) => g.sourceName)));
      return { norm, leadCand, precedence, uniqueSources };
    });

    rankedGroups.sort(
      (a, b) => b.precedence - a.precedence || b.uniqueSources.length - a.uniqueSources.length
    );

    const best = rankedGroups[0];
    const existing = existingByField[field];
    const existingVal = existing?.value?.trim();
    const existingSourceType: AttributeProvenanceType = existing?.sourceType || 'not_verified';
    const existingSourceName = existing?.sourceName || 'Existing CRM Record';
    const existingPrecedence = getAttributeSourcePrecedenceScore(field, existingSourceType);
    const freshness = evaluateFreshnessState(field, existing?.lastVerifiedAt, nowMs);
    const rationale = getPrecedenceRationale(field);

    // Also record inter-source conflicts if 2+ incoming sources returned genuinely different values
    if (rankedGroups.length > 1) {
      const runnerUp = rankedGroups[1];
      conflicts.push({
        id: `conf-${crypto.randomBytes(5).toString('hex')}`,
        field,
        label: best.leadCand.label,
        existingValue: runnerUp.leadCand.value,
        existingSourceName: runnerUp.leadCand.sourceName,
        existingSourceType: runnerUp.leadCand.sourceType,
        existingPrecedenceScore: runnerUp.precedence,
        incomingValue: best.leadCand.value,
        incomingSourceName: best.leadCand.sourceName,
        incomingSourceType: best.leadCand.sourceType,
        incomingPrecedenceScore: best.precedence,
        recommendedWinner:
          best.precedence > runnerUp.precedence ? 'incoming' : 'owner_review',
        rationale: `Multiple enrichment sources disagreed on ${best.leadCand.label}. ${rationale}`,
        detectedAt: new Date(nowMs).toISOString(),
        status: 'open',
      });
    }

    // Case A: Field currently missing in CRM -> safe fill proposal (still requires owner approval!)
    if (!existingVal) {
      proposals.push({
        field,
        label: best.leadCand.label,
        currentValue: undefined,
        proposedValue: best.leadCand.value,
        proposedSourceType: best.leadCand.sourceType,
        proposedSourceName: best.leadCand.sourceName,
        proposedSourceUrl: best.leadCand.sourceUrl,
        proposedConnectorId: best.leadCand.connectorId,
        verificationLabel: deriveVerificationLabel(
          best.leadCand.sourceType,
          best.uniqueSources.length,
          false
        ),
        confidenceScore: Math.min(98, best.leadCand.confidenceScore + (best.uniqueSources.length > 1 ? 5 : 0)),
        actionRecommendation: 'fill_missing',
        defaultSelected: best.leadCand.sourceType !== 'inferred' && best.leadCand.sourceType !== 'ai_extracted',
        isConflict: false,
        precedenceNote: rationale,
        corroboratingSources: best.uniqueSources,
        retrievedAt: best.leadCand.retrievedAt,
      });
      continue;
    }

    const existingNorm = normalizeForEquality(field, existingVal);

    // Case B: Value matches existing CRM value -> refresh verification provenance/freshness
    if (existingNorm === best.norm) {
      if (best.precedence > existingPrecedence || freshness.status === 'stale' || freshness.status === 'never_verified') {
        proposals.push({
          field,
          label: best.leadCand.label,
          currentValue: existingVal,
          proposedValue: best.leadCand.value,
          currentSourceType: existingSourceType,
          currentSourceName: existingSourceName,
          currentLastVerifiedAt: existing?.lastVerifiedAt,
          proposedSourceType: best.leadCand.sourceType,
          proposedSourceName: best.leadCand.sourceName,
          proposedSourceUrl: best.leadCand.sourceUrl,
          proposedConnectorId: best.leadCand.connectorId,
          verificationLabel: deriveVerificationLabel(
            best.leadCand.sourceType,
            best.uniqueSources.length + 1,
            false
          ),
          confidenceScore: Math.min(98, best.leadCand.confidenceScore + 6),
          actionRecommendation: best.precedence > existingPrecedence ? 'upgrade_stronger_source' : 'refresh_stale',
          defaultSelected: true,
          isConflict: false,
          precedenceNote: `Corroborates existing value and refreshes verification timestamp (${rationale})`,
          corroboratingSources: best.uniqueSources,
          retrievedAt: best.leadCand.retrievedAt,
        });
      }
      continue;
    }

    // Case C: Existing value DIFFERS from incoming value -> Transparent Conflict!
    const incomingStronger = best.precedence > existingPrecedence;
    const existingStronger = existingPrecedence > best.precedence;
    const recommendedWinner: EnrichmentConflictRecord['recommendedWinner'] = existingStronger
      ? 'existing'
      : incomingStronger
      ? 'incoming'
      : 'owner_review';

    conflicts.push({
      id: `conf-${crypto.randomBytes(5).toString('hex')}`,
      field,
      label: best.leadCand.label,
      existingValue: existingVal,
      existingSourceName,
      existingSourceType,
      existingPrecedenceScore: existingPrecedence,
      incomingValue: best.leadCand.value,
      incomingSourceName: best.leadCand.sourceName,
      incomingSourceType: best.leadCand.sourceType,
      incomingPrecedenceScore: best.precedence,
      recommendedWinner,
      rationale: existingStronger
        ? `Existing value from ${existingSourceName} (${existingSourceType}) outranks incoming ${best.leadCand.sourceName} (${best.leadCand.sourceType}). Existing value protected unless owner overrides.`
        : incomingStronger
        ? `Incoming value from ${best.leadCand.sourceName} (${best.leadCand.sourceType}) outranks existing ${existingSourceName} (${existingSourceType}). ${rationale}`
        : `Both sources hold equal precedence for ${best.leadCand.label}; explicit owner review required.`,
      detectedAt: new Date(nowMs).toISOString(),
      status: 'open',
    });

    proposals.push({
      field,
      label: best.leadCand.label,
      currentValue: existingVal,
      proposedValue: best.leadCand.value,
      currentSourceType: existingSourceType,
      currentSourceName: existingSourceName,
      currentLastVerifiedAt: existing?.lastVerifiedAt,
      proposedSourceType: best.leadCand.sourceType,
      proposedSourceName: best.leadCand.sourceName,
      proposedSourceUrl: best.leadCand.sourceUrl,
      proposedConnectorId: best.leadCand.connectorId,
      verificationLabel: 'conflicting',
      confidenceScore: best.leadCand.confidenceScore,
      actionRecommendation: existingStronger ? 'keep_existing_stronger' : 'conflict_review',
      // NEVER auto-select conflicting overwrites; require explicit owner checkbox!
      defaultSelected: false,
      isConflict: true,
      precedenceNote: existingStronger
        ? `Protected: existing ${existingSourceType} outranks ${best.leadCand.sourceType}. Select explicitly to override.`
        : rationale,
      corroboratingSources: best.uniqueSources,
      retrievedAt: best.leadCand.retrievedAt,
    });
  }

  return { proposals, conflicts };
}
