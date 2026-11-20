// Phase 16: Business Intelligence & Advanced Analytics Engine
// Computes 100% of metrics strictly from real LEED CRM, Enrichment, Pipeline, Outreach, and Workflow records.
// Zero fabricated statistics. Explicitly distinguishes provider-confirmed vs. manual owner-recorded vs. system-calculated metrics.

import type {
  BiActivityAnalyticsMetrics,
  BiAdvancedAnalyticsSection,
  BiAnalyticsFilter,
  BiBreakdownRow,
  BiDashboardResponse,
  BiLeadIntelligenceMetrics,
  BiOutreachAnalyticsSection,
  BiPipelineStageMetrics,
  BiSalesPipelineMetrics,
} from '../../shared/biWorkflowTypes.js';
import type { CanonicalLead, CrmOpportunity, OutreachWorkspaceState, PipelineStage } from '../types.js';
import {
  CrmStorageFacade,
  getEntityInteractions,
  getEntityRelationshipMeta,
  listAllCrmInteractions,
  listAllCrmOpportunities,
  listAllExtendedTasks,
} from '../crm/crmStoreHelper.js';
import { evaluateCompanyDataQuality } from '../enrichment/dataQualityEngine.js';
import { getOutreachWorkspaceState } from '../outreach/outreachStoreHelper.js';
import { buildOutreachAnalytics } from '../outreach/outreachService.js';
import { getBiWorkflowWorkspaceState } from './biWorkflowStoreHelper.js';

const DAY_MS = 86_400_000;

function parseDateMs(raw?: string): number | null {
  if (!raw || !String(raw).trim()) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function safePercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function safeAvg(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Number((sum / values.length).toFixed(1));
}

function isLeadOfficiallyVerified(lead: CanonicalLead): boolean {
  const cf = lead.customFields || {};
  if (cf.registryVerificationState === 'officially_verified') return true;
  if ((lead.identifiers || []).some((id) => id.verified || id.status === 'officially_verified')) {
    return true;
  }
  return false;
}

function getPrimaryLeadSource(lead: CanonicalLead): string {
  const first = lead.sources?.[0]?.sourceName?.trim();
  if (first) return first;
  if (lead.customFields?.importBatchId) return 'CSV/Excel Import';
  return 'Manual / Unspecified';
}

function toBreakdown(counts: Map<string, { label: string; count: number }>, total: number, limit = 15): BiBreakdownRow[] {
  return Array.from(counts.entries())
    .map(([key, item]) => ({
      key,
      label: item.label,
      count: item.count,
      percentage: total > 0 ? Number(((item.count / total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function formatMonthPeriod(iso?: string): string | null {
  if (!iso) return null;
  const ms = parseDateMs(iso);
  if (ms === null) return null;
  return new Date(ms).toISOString().slice(0, 7); // YYYY-MM
}

export async function buildBiAnalyticsDashboard(
  facade: CrmStorageFacade,
  rawFilter: BiAnalyticsFilter = {},
  now: Date = new Date()
): Promise<BiDashboardResponse> {
  const [
    allLeads,
    allPersons,
    allRelationships,
    stages,
    allTasks,
    allInteractions,
    allOpportunities,
    outreachWs,
    workflowWs,
  ] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    facade.getCompanyPersonRelationships(),
    facade.getStages(),
    listAllExtendedTasks(facade),
    listAllCrmInteractions(facade),
    listAllCrmOpportunities(facade),
    getOutreachWorkspaceState(facade),
    getBiWorkflowWorkspaceState(facade),
  ]);

  const nowMs = now.getTime();
  const dateFromMs = parseDateMs(rawFilter.dateFrom);
  // If dateTo is YYYY-MM-DD, include entire end day
  const rawDateToMs = parseDateMs(rawFilter.dateTo);
  const dateToMs =
    rawDateToMs !== null && rawFilter.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(rawFilter.dateTo.trim())
      ? rawDateToMs + DAY_MS - 1
      : rawDateToMs;

  const countryFilter = rawFilter.country?.trim().toUpperCase() || undefined;
  const industryFilter = rawFilter.industry?.trim().toLowerCase() || undefined;
  const sourceFilter = rawFilter.source?.trim().toLowerCase() || undefined;
  const stageFilter = rawFilter.stageId?.trim() || undefined;

  const inDateRange = (iso?: string): boolean => {
    if (dateFromMs === null && dateToMs === null) return true;
    const ms = parseDateMs(iso);
    if (ms === null) return false;
    if (dateFromMs !== null && ms < dateFromMs) return false;
    if (dateToMs !== null && ms > dateToMs) return false;
    return true;
  };

  // Build filter options from full unfiltered CRM state
  const countryOptMap = new Map<string, string>();
  const industryOptSet = new Set<string>();
  const sourceOptSet = new Set<string>();
  for (const l of allLeads) {
    const cc = (l.address?.countryCode || '').trim().toUpperCase();
    const cname = (l.address?.country || cc || '').trim();
    if (cc) countryOptMap.set(cc, cname || cc);
    if (l.industry && l.industry.trim()) industryOptSet.add(l.industry.trim());
    sourceOptSet.add(getPrimaryLeadSource(l));
  }

  // Filter leads according to active BI filters
  const filteredLeads = allLeads.filter((l) => {
    if (!inDateRange(l.createdAt)) return false;
    if (countryFilter) {
      const cc = (l.address?.countryCode || '').trim().toUpperCase();
      const cn = (l.address?.country || '').trim().toUpperCase();
      if (cc !== countryFilter && cn !== countryFilter) return false;
    }
    if (industryFilter && (l.industry || '').trim().toLowerCase() !== industryFilter) return false;
    if (sourceFilter && getPrimaryLeadSource(l).toLowerCase() !== sourceFilter) return false;
    if (stageFilter && l.pipelineStageId !== stageFilter) return false;
    return true;
  });

  const filteredLeadIds = new Set(filteredLeads.map((l) => l.id));
  const leadMap = new Map(allLeads.map((l) => [l.id, l]));
  const personMap = new Map(allPersons.map((p) => [p.id, p]));
  const stageMap = new Map<string, PipelineStage>(stages.map((s) => [s.id, s]));
  const sortedStages = [...stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const hasEntityDimensionFilter = Boolean(countryFilter || industryFilter || sourceFilter || stageFilter);
  const matchesLeadScope = (leadId?: string): boolean => {
    if (!hasEntityDimensionFilter && dateFromMs === null && dateToMs === null) return true;
    if (!hasEntityDimensionFilter) return true; // date filter applies to each record's own timestamp
    return Boolean(leadId && filteredLeadIds.has(leadId));
  };

  // Relationships & persons within scope
  const scopedRelationships = hasEntityDimensionFilter
    ? allRelationships.filter((r) => filteredLeadIds.has(r.leadId))
    : allRelationships.filter((r) => inDateRange(r.createdAt) || filteredLeadIds.has(r.leadId));
  const scopedPersonIds = new Set(scopedRelationships.map((r) => r.personId));
  const filteredPersons = allPersons.filter((p) => {
    if (hasEntityDimensionFilter) return scopedPersonIds.has(p.id);
    return inDateRange(p.createdAt);
  });

  // Pre-compute deterministic Data Quality breakdowns for filtered leads
  const relsByLead = new Map<string, typeof allRelationships>();
  for (const r of allRelationships) {
    const arr = relsByLead.get(r.leadId) || [];
    arr.push(r);
    relsByLead.set(r.leadId, arr);
  }
  const qualityByLeadId = new Map(
    filteredLeads.map((l) => {
      const rels = relsByLead.get(l.id) || [];
      return [
        l.id,
        evaluateCompanyDataQuality(l, {
          nowMs,
          linkedPersonsCount: rels.length,
          relationships: rels,
        }),
      ] as const;
    })
  );

  // =========================================================================
  // 1. LEAD INTELLIGENCE METRICS
  // =========================================================================
  const thirtyDaysAgoMs = nowMs - 30 * DAY_MS;
  let verifiedLeads = 0;
  let newlyDiscoveredLeads = 0;
  const countryCounts = new Map<string, { label: string; count: number }>();
  const industryCounts = new Map<string, { label: string; count: number }>();
  const sourceCounts = new Map<string, { label: string; count: number }>();
  const lifecycleCounts = new Map<string, { label: string; count: number }>();
  const gradeCounts: Record<'A' | 'B' | 'C' | 'D' | 'F', number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  const overallQualityScores: number[] = [];

  for (const lead of filteredLeads) {
    if (isLeadOfficiallyVerified(lead)) verifiedLeads++;
    const createdMs = parseDateMs(lead.createdAt);
    if (dateFromMs !== null || dateToMs !== null) {
      newlyDiscoveredLeads++;
    } else if (createdMs !== null && createdMs >= thirtyDaysAgoMs) {
      newlyDiscoveredLeads++;
    }

    const cc = (lead.address?.countryCode || 'UNKNOWN').trim().toUpperCase();
    const cname = lead.address?.country?.trim() || (cc === 'UNKNOWN' ? 'Unspecified' : cc);
    const cPrev = countryCounts.get(cc) || { label: cname, count: 0 };
    cPrev.count++;
    countryCounts.set(cc, cPrev);

    const ind = lead.industry?.trim() || 'Unspecified';
    const iKey = ind.toLowerCase();
    const iPrev = industryCounts.get(iKey) || { label: ind, count: 0 };
    iPrev.count++;
    industryCounts.set(iKey, iPrev);

    const src = getPrimaryLeadSource(lead);
    const sKey = src.toLowerCase();
    const sPrev = sourceCounts.get(sKey) || { label: src, count: 0 };
    sPrev.count++;
    sourceCounts.set(sKey, sPrev);

    const stageLabel =
      (lead.pipelineStageId && stageMap.get(lead.pipelineStageId)?.name) ||
      lead.status ||
      'Unstaged';
    const stKey = (lead.pipelineStageId || lead.status || 'unstaged').toLowerCase();
    const stPrev = lifecycleCounts.get(stKey) || { label: stageLabel, count: 0 };
    stPrev.count++;
    lifecycleCounts.set(stKey, stPrev);

    const dq = qualityByLeadId.get(lead.id)!;
    gradeCounts[dq.grade]++;
    overallQualityScores.push(dq.overallScore);
  }

  const leadIntelligence: BiLeadIntelligenceMetrics = {
    totalCompanies: filteredLeads.length,
    totalDecisionMakers: filteredPersons.length,
    verifiedLeads,
    unverifiedLeads: Math.max(0, filteredLeads.length - verifiedLeads),
    verificationRatePercent: safePercent(verifiedLeads, filteredLeads.length),
    newlyDiscoveredLeads,
    byCountry: toBreakdown(countryCounts, filteredLeads.length),
    byIndustry: toBreakdown(industryCounts, filteredLeads.length),
    bySource: toBreakdown(sourceCounts, filteredLeads.length),
    byLifecycleStage: toBreakdown(lifecycleCounts, filteredLeads.length),
    qualityDistribution: (['A', 'B', 'C', 'D', 'F'] as const).map((grade) => ({
      grade,
      count: gradeCounts[grade],
      percentage:
        filteredLeads.length > 0
          ? Number(((gradeCounts[grade] / filteredLeads.length) * 100).toFixed(1))
          : 0,
    })),
    averageQualityScore: safeAvg(overallQualityScores),
  };

  // =========================================================================
  // 2. SALES PIPELINE METRICS
  // =========================================================================
  const filteredOpportunities = allOpportunities.filter((opp) => {
    if (!inDateRange(opp.createdAt)) return false;
    if (hasEntityDimensionFilter) {
      if (!filteredLeadIds.has(opp.leadId)) return false;
    }
    if (stageFilter && opp.pipelineStageId !== stageFilter) return false;
    return true;
  });

  const useMultiOpps = filteredOpportunities.length > 0 || allOpportunities.length > 0;
  const openOpps = filteredOpportunities.filter((o) => o.status === 'open');
  const wonOpps = filteredOpportunities.filter((o) => o.status === 'won');
  const lostOpps = filteredOpportunities.filter((o) => o.status === 'lost');
  const onHoldOpps = filteredOpportunities.filter((o) => o.status === 'on_hold');

  // Lead-level fallback when no CrmOpportunity records exist yet
  const fallbackWonLeads = !useMultiOpps
    ? filteredLeads.filter((l) => l.status === 'converted' || l.pipelineStageId === 'stage-won')
    : [];
  const fallbackLostLeads = !useMultiOpps
    ? filteredLeads.filter((l) => l.status === 'lost' || l.pipelineStageId === 'stage-lost')
    : [];
  const fallbackOpenLeads = !useMultiOpps
    ? filteredLeads.filter(
        (l) =>
          (l.opportunityValue || 0) > 0 &&
          l.status !== 'converted' &&
          l.status !== 'lost' &&
          l.pipelineStageId !== 'stage-won' &&
          l.pipelineStageId !== 'stage-lost'
      )
    : [];

  const aggregateCurrencyBuckets = (
    items: Array<{ currency?: string; value: number; probability?: number }>
  ) => {
    const map = new Map<string, { totalValue: number; weightedValue: number; count: number }>();
    for (const item of items) {
      const cur = (item.currency || 'USD').toUpperCase();
      const prev = map.get(cur) || { totalValue: 0, weightedValue: 0, count: 0 };
      prev.totalValue += item.value;
      prev.weightedValue += (item.value * (item.probability ?? 50)) / 100;
      prev.count++;
      map.set(cur, prev);
    }
    return Array.from(map.entries()).map(([currency, b]) => ({
      currency,
      totalValue: Math.round(b.totalValue),
      weightedValue: Math.round(b.weightedValue),
      count: b.count,
    }));
  };

  const openValuesByCurrency = useMultiOpps
    ? aggregateCurrencyBuckets(
        openOpps.map((o) => ({ currency: o.currency, value: o.estimatedValue || 0, probability: o.probability }))
      )
    : aggregateCurrencyBuckets(
        fallbackOpenLeads.map((l) => ({
          currency: l.currency,
          value: l.opportunityValue || 0,
          probability: l.winProbability ?? 30,
        }))
      );

  const wonValuesByCurrency = (
    useMultiOpps
      ? aggregateCurrencyBuckets(wonOpps.map((o) => ({ currency: o.currency, value: o.estimatedValue || 0, probability: 100 })))
      : aggregateCurrencyBuckets(fallbackWonLeads.map((l) => ({ currency: l.currency, value: l.opportunityValue || 0, probability: 100 })))
  ).map(({ currency, totalValue, count }) => ({ currency, totalValue, count }));

  const lostValuesByCurrency = (
    useMultiOpps
      ? aggregateCurrencyBuckets(lostOpps.map((o) => ({ currency: o.currency, value: o.estimatedValue || 0, probability: 0 })))
      : aggregateCurrencyBuckets(fallbackLostLeads.map((l) => ({ currency: l.currency, value: l.opportunityValue || 0, probability: 0 })))
  ).map(({ currency, totalValue, count }) => ({ currency, totalValue, count }));

  const wonCount = useMultiOpps ? wonOpps.length : fallbackWonLeads.length;
  const lostCount = useMultiOpps ? lostOpps.length : fallbackLostLeads.length;
  const openCount = useMultiOpps ? openOpps.length : fallbackOpenLeads.length;
  const totalOppCount = useMultiOpps
    ? filteredOpportunities.length
    : openCount + wonCount + lostCount;

  // Stage aging & conversion rates
  const stageOrderIndex = new Map<string, number>(sortedStages.map((s, idx) => [s.id, idx]));

  const computeStageDays = (oppOrLead: { stageHistory?: CrmOpportunity['stageHistory']; updatedAt?: string; createdAt?: string; pipelineStageId?: string }): number | null => {
    const history = oppOrLead.stageHistory || [];
    let enteredMs: number | null = null;
    if (history.length > 0) {
      const latestEntry = [...history]
        .reverse()
        .find((h) => !oppOrLead.pipelineStageId || h.toStageId === oppOrLead.pipelineStageId);
      enteredMs = parseDateMs(latestEntry?.changedAt || history[history.length - 1]?.changedAt);
    }
    if (enteredMs === null) {
      enteredMs = parseDateMs(oppOrLead.updatedAt || oppOrLead.createdAt);
    }
    if (enteredMs === null) return null;
    return Math.max(0, Number(((nowMs - enteredMs) / DAY_MS).toFixed(1)));
  };

  const stageDistribution: BiPipelineStageMetrics[] = sortedStages.map((stage, idx) => {
    const stageLeads = filteredLeads.filter((l) => l.pipelineStageId === stage.id);
    const stageOpps = filteredOpportunities.filter((o) => o.pipelineStageId === stage.id);

    const valuesByCurrency = useMultiOpps
      ? aggregateCurrencyBuckets(
          stageOpps.map((o) => ({ currency: o.currency, value: o.estimatedValue || 0, probability: o.probability }))
        ).map(({ currency, totalValue, weightedValue }) => ({ currency, totalValue, weightedValue }))
      : aggregateCurrencyBuckets(
          stageLeads
            .filter((l) => (l.opportunityValue || 0) > 0)
            .map((l) => ({ currency: l.currency, value: l.opportunityValue || 0, probability: l.winProbability ?? 30 }))
        ).map(({ currency, totalValue, weightedValue }) => ({ currency, totalValue, weightedValue }));

    const agingList = (useMultiOpps ? stageOpps : stageLeads)
      .map((item) => computeStageDays(item as any))
      .filter((d): d is number => d !== null);

    // Stage conversion: share of entities reaching at least this stage that progressed past it (excluding terminal lost/won)
    const activeEntities = useMultiOpps ? filteredOpportunities : filteredLeads;
    const reachedOrPassed = activeEntities.filter((item) => {
      const sIdx = item.pipelineStageId ? stageOrderIndex.get(item.pipelineStageId) : undefined;
      if (sIdx !== undefined && sIdx >= idx) return true;
      if ('stageHistory' in item && Array.isArray(item.stageHistory)) {
        return item.stageHistory.some((h) => h.toStageId === stage.id || h.fromStageId === stage.id);
      }
      return false;
    }).length;
    const progressedBeyond = activeEntities.filter((item) => {
      const sIdx = item.pipelineStageId ? stageOrderIndex.get(item.pipelineStageId) : undefined;
      return sIdx !== undefined && sIdx > idx && item.pipelineStageId !== 'stage-lost';
    }).length;

    const isTerminal = stage.id === 'stage-won' || stage.id === 'stage-lost' || idx === sortedStages.length - 1;
    const conversionRatePercent =
      isTerminal || reachedOrPassed === 0 ? null : safePercent(progressedBeyond, reachedOrPassed);

    return {
      stageId: stage.id,
      stageName: stage.name,
      stageColor: stage.color,
      order: stage.order ?? idx,
      leadCount: stageLeads.length,
      opportunityCount: useMultiOpps ? stageOpps.length : stageLeads.length,
      valuesByCurrency,
      conversionRatePercent,
      avgDaysInStage: safeAvg(agingList),
      maxDaysInStage: agingList.length > 0 ? Math.max(...agingList) : null,
    };
  });

  // Sales velocity — ONLY computed when won opportunities with valid duration exist!
  const wonCycleDays: number[] = [];
  const wonSourceItems = useMultiOpps ? wonOpps : fallbackWonLeads;
  for (const item of wonSourceItems) {
    const startMs = parseDateMs(item.createdAt);
    const endMs = parseDateMs(item.updatedAt);
    if (startMs !== null && endMs !== null && endMs >= startMs) {
      const days = Math.max(1, (endMs - startMs) / DAY_MS);
      wonCycleDays.push(days);
    }
  }
  const avgCycleDays = safeAvg(wonCycleDays);
  const winRateFraction = wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : null;
  const salesVelocityAvailable = Boolean(
    avgCycleDays !== null && avgCycleDays > 0 && winRateFraction !== null && wonSourceItems.length > 0
  );

  const velocityByCurrency = salesVelocityAvailable
    ? wonValuesByCurrency.map((bucket) => {
        const avgDealVal = bucket.count > 0 ? bucket.totalValue / bucket.count : 0;
        const openBucket = openValuesByCurrency.find((o) => o.currency === bucket.currency);
        const oppVolume = (openBucket?.count || 0) + bucket.count;
        const dailyVel = (oppVolume * avgDealVal * (winRateFraction || 0)) / (avgCycleDays || 1);
        return {
          currency: bucket.currency,
          averageDealValue: Math.round(avgDealVal),
          estimatedMonthlyVelocity: Math.round(dailyVel * 30),
        };
      })
    : [];

  const salesPipeline: BiSalesPipelineMetrics = {
    dataSource: useMultiOpps ? 'crm_opportunities' : 'lead_pipeline_fallback',
    totalOpportunities: totalOppCount,
    openOpportunities: openCount,
    wonOpportunities: wonCount,
    lostOpportunities: lostCount,
    onHoldOpportunities: onHoldOpps.length,
    winRatePercent: safePercent(wonCount, wonCount + lostCount),
    openValuesByCurrency,
    wonValuesByCurrency,
    lostValuesByCurrency,
    stageDistribution,
    salesVelocity: {
      available: salesVelocityAvailable,
      averageCycleDays: avgCycleDays,
      closedWonSampleSize: wonCycleDays.length,
      byCurrency: velocityByCurrency,
      insufficientDataReason: salesVelocityAvailable
        ? undefined
        : 'Insufficient closed-won opportunity history to calculate reliable sales velocity (requires at least 1 closed-won opportunity with creation and close timestamps).',
    },
  };

  // =========================================================================
  // 3. OUTREACH ANALYTICS (Reusing Phase 15 + Explicit Provenance Tagging)
  // =========================================================================
  const scopedOutreachWs: OutreachWorkspaceState = {
    ...outreachWs,
    enrollments: outreachWs.enrollments.filter(
      (e) => inDateRange(e.enrolledAt) && matchesLeadScope(e.leadId)
    ),
    messages: outreachWs.messages.filter(
      (m) => inDateRange(m.sentAt || m.createdAt) && matchesLeadScope(m.leadId)
    ),
    replies: outreachWs.replies.filter(
      (r) => inDateRange(r.receivedAt || r.recordedAt) && matchesLeadScope(r.leadId)
    ),
    followUps: outreachWs.followUps.filter(
      (f) => inDateRange(f.createdAt) && matchesLeadScope(f.leadId)
    ),
    suppressions: outreachWs.suppressions.filter((s) => {
      if (!inDateRange(s.createdAt)) return false;
      if (hasEntityDimensionFilter && s.leadId) return filteredLeadIds.has(s.leadId);
      return true;
    }),
  };

  const phase15Analytics = buildOutreachAnalytics(scopedOutreachWs, now);
  const followUpsCompleted = scopedOutreachWs.followUps.filter((f) => f.status === 'completed').length;
  const followUpsSuppressed = scopedOutreachWs.followUps.filter((f) => f.status === 'suppressed').length;
  const followUpDenom = followUpsCompleted + phase15Analytics.totals.followUpsPending;

  const outreachAnalytics: BiOutreachAnalyticsSection = {
    metricsWithProvenance: {
      providerConfirmedSent: {
        label: 'Provider-Confirmed Email Sends',
        value: phase15Analytics.totals.messagesSentViaProvider,
        provenance: 'provider_confirmed',
        note: 'Confirmed via authorized email provider API response with real providerMessageId.',
      },
      providerConfirmedFailures: {
        label: 'Provider-Reported Delivery Failures',
        value: phase15Analytics.totals.deliveryFailures,
        provenance: 'provider_confirmed',
        note: 'Delivery rejections/bounces returned by email provider API.',
      },
      manualExternalSends: {
        label: 'Manual External Sends (LinkedIn / Phone / Custom)',
        value: phase15Analytics.totals.messagesManualSent,
        provenance: 'manual_owner_recorded',
        note: 'Explicitly marked sent externally by the owner; not provider-verified.',
      },
      manualRecordedReplies: {
        label: 'Recorded Prospect Replies',
        value: phase15Analytics.totals.repliesReceived,
        provenance: 'manual_owner_recorded',
        note: 'Logged via manual owner reply recording (no live inbound IMAP/webhook sync).',
      },
      manualPositiveReplies: {
        label: 'Positive / Interested Replies',
        value: phase15Analytics.totals.positiveResponses,
        provenance: 'manual_owner_recorded',
        note: 'Replies classified as positive, meeting_interest, information_request, or referral.',
      },
      confirmedMeetingsScheduled: {
        label: 'Confirmed Meetings Scheduled',
        value: phase15Analytics.totals.meetingsBooked,
        provenance: 'manual_owner_recorded',
        note: 'Deduplicated owner-recorded meeting_scheduled follow-ups or exited_meeting_booked enrollments (never unconfirmed meeting_interest replies).',
      },
      activeSuppressions: {
        label: 'Active Opt-Outs & Suppressions',
        value: phase15Analytics.totals.optOutsAndSuppressions,
        provenance: 'system_calculated',
        note: 'Active global and campaign suppression rules enforced prior to enrollment and dispatch.',
      },
    },
    totals: {
      campaignsTotal: phase15Analytics.totals.campaignsTotal,
      campaignsActive: phase15Analytics.totals.campaignsActive,
      enrollmentsTotal: phase15Analytics.totals.enrollmentsTotal,
      enrollmentsActive: phase15Analytics.totals.enrollmentsActive,
      messagesSentViaProvider: phase15Analytics.totals.messagesSentViaProvider,
      messagesManualSent: phase15Analytics.totals.messagesManualSent,
      messagesTotalDispatched: phase15Analytics.totals.messagesTotalDispatched,
      deliveryFailures: phase15Analytics.totals.deliveryFailures,
      repliesReceived: phase15Analytics.totals.repliesReceived,
      positiveResponses: phase15Analytics.totals.positiveResponses,
      meetingsScheduled: phase15Analytics.totals.meetingsBooked,
      activeSuppressions: phase15Analytics.totals.optOutsAndSuppressions,
      followUpsCompleted,
      followUpsPending: phase15Analytics.totals.followUpsPending,
      followUpsOverdue: phase15Analytics.totals.followUpsOverdue,
      followUpsSuppressed,
    },
    rates: {
      replyRatePercent: phase15Analytics.rates.replyRatePercent,
      positiveResponseRatePercent: phase15Analytics.rates.positiveResponseRatePercent,
      meetingConversionRatePercent: phase15Analytics.rates.meetingConversionRatePercent,
      optOutRatePercent: phase15Analytics.rates.optOutRatePercent,
      followUpCompletionRatePercent: safePercent(followUpsCompleted, followUpDenom),
    },
    campaigns: phase15Analytics.byCampaign.map((c) => {
      const cMsgs = scopedOutreachWs.messages.filter((m) => m.campaignId === c.campaignId);
      return {
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        status: c.status,
        channel: c.channel,
        enrolled: c.enrolled,
        providerSent: cMsgs.filter((m) => m.status === 'sent').length,
        manualSent: cMsgs.filter((m) => m.status === 'manual_sent').length,
        failed: c.failed,
        replies: c.replies,
        positiveReplies: c.positiveReplies,
        meetingsScheduled: c.meetingsBooked,
        optOuts: c.optOuts,
      };
    }),
    unavailableMetrics: phase15Analytics.unavailableMetrics,
  };

  // =========================================================================
  // 4. ACTIVITY ANALYTICS & DECLINING ENGAGEMENT
  // =========================================================================
  const filteredTasks = allTasks.filter((t) => {
    if (!inDateRange(t.createdAt)) return false;
    if (hasEntityDimensionFilter && t.leadId) return filteredLeadIds.has(t.leadId);
    return true;
  });
  const filteredInteractions = allInteractions.filter((i) => {
    if (!inDateRange(i.occurredAt || i.createdAt)) return false;
    if (hasEntityDimensionFilter && i.leadId) return filteredLeadIds.has(i.leadId);
    return true;
  });

  const tasksCompleted = filteredTasks.filter((t) => t.completed || t.status === 'completed').length;
  const openFilteredTasks = filteredTasks.filter(
    (t) => !t.completed && t.status !== 'completed' && t.status !== 'cancelled'
  );
  const tasksOverdue = openFilteredTasks.filter((t) => {
    const dueMs = parseDateMs(t.dueDate);
    return dueMs !== null && dueMs < nowMs;
  }).length;

  const interactionTypeCounts = new Map<string, { label: string; count: number }>();
  const ownerActivityMap = new Map<
    string,
    { interactionsLogged: number; tasksCompleted: number; outreachActions: number }
  >();

  for (const i of filteredInteractions) {
    const key = i.type || 'custom';
    const prev = interactionTypeCounts.get(key) || { label: key.replace(/_/g, ' '), count: 0 };
    prev.count++;
    interactionTypeCounts.set(key, prev);

    const actor = (i.recordedBy || 'Owner').trim();
    const aPrev = ownerActivityMap.get(actor) || {
      interactionsLogged: 0,
      tasksCompleted: 0,
      outreachActions: 0,
    };
    aPrev.interactionsLogged++;
    ownerActivityMap.set(actor, aPrev);
  }

  for (const t of filteredTasks) {
    if (t.completed || t.status === 'completed') {
      const actor = 'Owner';
      const aPrev = ownerActivityMap.get(actor) || {
        interactionsLogged: 0,
        tasksCompleted: 0,
        outreachActions: 0,
      };
      aPrev.tasksCompleted++;
      ownerActivityMap.set(actor, aPrev);
    }
  }
  for (const m of scopedOutreachWs.messages) {
    if (m.status === 'sent' || m.status === 'manual_sent') {
      const actor = (m.approvedBy || 'Owner').trim();
      const aPrev = ownerActivityMap.get(actor) || {
        interactionsLogged: 0,
        tasksCompleted: 0,
        outreachActions: 0,
      };
      aPrev.outreachActions++;
      ownerActivityMap.set(actor, aPrev);
    }
  }

  // Declining engagement detection:
  // Compare recent 30d vs prior 30d (30-60d ago) interactions OR warm/active company with >30d silence
  const sixtyDaysAgoMs = nowMs - 60 * DAY_MS;
  const decliningEngagement: BiActivityAnalyticsMetrics['decliningEngagement'] = [];
  const engagementTiers: Record<'high' | 'moderate' | 'low' | 'dormant' | 'declining', number> = {
    high: 0,
    moderate: 0,
    low: 0,
    dormant: 0,
    declining: 0,
  };

  for (const lead of filteredLeads) {
    const ints = getEntityInteractions(lead.customFields);
    const meta = getEntityRelationshipMeta(lead.customFields, lead.tags);
    let recent30 = 0;
    let prior30 = 0;
    let latestMs: number | null = null;
    for (const item of ints) {
      const ms = parseDateMs(item.occurredAt || item.createdAt);
      if (ms === null) continue;
      if (latestMs === null || ms > latestMs) latestMs = ms;
      if (ms >= thirtyDaysAgoMs) recent30++;
      else if (ms >= sixtyDaysAgoMs) prior30++;
    }
    const daysSince = latestMs !== null ? Math.floor((nowMs - latestMs) / DAY_MS) : null;
    const isDeclining =
      (prior30 >= 1 && recent30 < prior30) ||
      ((meta.relationshipStatus === 'active' || meta.relationshipStatus === 'warm') &&
        daysSince !== null &&
        daysSince > 30);

    if (isDeclining) {
      engagementTiers.declining++;
      decliningEngagement.push({
        entityType: 'company',
        id: lead.id,
        name: lead.companyName,
        subtitle: [lead.industry, lead.address?.country].filter(Boolean).join(' · ') || 'Company',
        recent30dInteractions: recent30,
        prior30dInteractions: prior30,
        daysSinceLastInteraction: daysSince,
        reason:
          prior30 > recent30
            ? `Interactions dropped from ${prior30} (prior 30d) to ${recent30} (last 30d)`
            : `Warm/active relationship with ${daysSince} days since last logged interaction`,
      });
    } else if (recent30 >= 3) {
      engagementTiers.high++;
    } else if (recent30 >= 1) {
      engagementTiers.moderate++;
    } else if (ints.length > 0) {
      engagementTiers.low++;
    } else {
      engagementTiers.dormant++;
    }
  }

  // Also check person-level declining engagement
  const personIntsMap = new Map<string, typeof allInteractions>();
  for (const i of allInteractions) {
    if (!i.personId) continue;
    const arr = personIntsMap.get(i.personId) || [];
    arr.push(i);
    personIntsMap.set(i.personId, arr);
  }
  for (const person of filteredPersons) {
    const pInts = personIntsMap.get(person.id) || [];
    let recent30 = 0;
    let prior30 = 0;
    let latestMs: number | null = null;
    for (const item of pInts) {
      const ms = parseDateMs(item.occurredAt || item.createdAt);
      if (ms === null) continue;
      if (latestMs === null || ms > latestMs) latestMs = ms;
      if (ms >= thirtyDaysAgoMs) recent30++;
      else if (ms >= sixtyDaysAgoMs) prior30++;
    }
    const daysSince = latestMs !== null ? Math.floor((nowMs - latestMs) / DAY_MS) : null;
    if (prior30 >= 1 && recent30 < prior30) {
      decliningEngagement.push({
        entityType: 'person',
        id: person.id,
        name: person.fullName,
        subtitle: person.decisionMakingFunction || person.seniority || 'Decision-Maker',
        recent30dInteractions: recent30,
        prior30dInteractions: prior30,
        daysSinceLastInteraction: daysSince,
        reason: `Contact interactions declined from ${prior30} to ${recent30} over the last 30 days`,
      });
    }
  }

  decliningEngagement.sort(
    (a, b) =>
      b.prior30dInteractions - b.recent30dInteractions - (a.prior30dInteractions - a.recent30dInteractions) ||
      (b.daysSinceLastInteraction ?? 0) - (a.daysSinceLastInteraction ?? 0)
  );

  const activityAnalytics: BiActivityAnalyticsMetrics = {
    tasksTotal: filteredTasks.length,
    tasksCompleted,
    tasksPending: openFilteredTasks.length,
    tasksOverdue,
    taskCompletionRatePercent: safePercent(tasksCompleted, filteredTasks.length),
    interactionsTotal: filteredInteractions.length,
    interactionsByType: toBreakdown(interactionTypeCounts, filteredInteractions.length),
    ownerActivity: Array.from(ownerActivityMap.entries())
      .map(([actor, stats]) => ({
        actor,
        ...stats,
        totalActions: stats.interactionsLogged + stats.tasksCompleted + stats.outreachActions,
      }))
      .sort((a, b) => b.totalActions - a.totalActions),
    followUpPerformance: {
      crmTasksCompleted: tasksCompleted,
      crmTasksOverdue: tasksOverdue,
      outreachFollowUpsCompleted: followUpsCompleted,
      outreachFollowUpsPending: phase15Analytics.totals.followUpsPending,
      outreachFollowUpsOverdue: phase15Analytics.totals.followUpsOverdue,
      outreachFollowUpsSuppressed: followUpsSuppressed,
    },
    decliningEngagement: decliningEngagement.slice(0, 20),
  };

  // =========================================================================
  // 5. ADVANCED ANALYTICS VIEWS
  // =========================================================================
  // 5a. Lead Acquisition Trends (monthly buckets)
  const trendMap = new Map<string, { newCompanies: number; verifiedCompanies: number; newOpportunities: number }>();
  for (const l of filteredLeads) {
    const p = formatMonthPeriod(l.createdAt);
    if (!p) continue;
    const cur = trendMap.get(p) || { newCompanies: 0, verifiedCompanies: 0, newOpportunities: 0 };
    cur.newCompanies++;
    if (isLeadOfficiallyVerified(l)) cur.verifiedCompanies++;
    trendMap.set(p, cur);
  }
  for (const o of filteredOpportunities) {
    const p = formatMonthPeriod(o.createdAt);
    if (!p) continue;
    const cur = trendMap.get(p) || { newCompanies: 0, verifiedCompanies: 0, newOpportunities: 0 };
    cur.newOpportunities++;
    trendMap.set(p, cur);
  }
  const leadAcquisitionTrends = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, stats]) => ({ period, ...stats }));

  // 5b. Country & Regional Performance
  const countryPerfMap = new Map<
    string,
    {
      countryCode: string;
      countryName: string;
      companies: number;
      verifiedCount: number;
      decisionMakerIds: Set<string>;
      opportunities: number;
      wonOpportunities: number;
      qualityScores: number[];
    }
  >();
  for (const l of filteredLeads) {
    const cc = (l.address?.countryCode || 'UNSPECIFIED').trim().toUpperCase();
    const cname = l.address?.country?.trim() || (cc === 'UNSPECIFIED' ? 'Unspecified' : cc);
    const cur = countryPerfMap.get(cc) || {
      countryCode: cc,
      countryName: cname,
      companies: 0,
      verifiedCount: 0,
      decisionMakerIds: new Set<string>(),
      opportunities: 0,
      wonOpportunities: 0,
      qualityScores: [],
    };
    cur.companies++;
    if (isLeadOfficiallyVerified(l)) cur.verifiedCount++;
    for (const r of relsByLead.get(l.id) || []) {
      cur.decisionMakerIds.add(r.personId);
    }
    const dq = qualityByLeadId.get(l.id);
    if (dq) cur.qualityScores.push(dq.overallScore);
    countryPerfMap.set(cc, cur);
  }
  for (const opp of filteredOpportunities) {
    const l = leadMap.get(opp.leadId);
    const cc = (l?.address?.countryCode || 'UNSPECIFIED').trim().toUpperCase();
    const cur = countryPerfMap.get(cc);
    if (cur) {
      cur.opportunities++;
      if (opp.status === 'won') cur.wonOpportunities++;
    }
  }
  const countryRegionalPerformance = Array.from(countryPerfMap.values())
    .map((c) => ({
      countryCode: c.countryCode,
      countryName: c.countryName,
      companies: c.companies,
      verifiedCount: c.verifiedCount,
      verifiedPercent: safePercent(c.verifiedCount, c.companies),
      decisionMakers: c.decisionMakerIds.size,
      opportunities: c.opportunities,
      wonOpportunities: c.wonOpportunities,
      avgQualityScore: safeAvg(c.qualityScores),
    }))
    .sort((a, b) => b.companies - a.companies);

  // 5c. Industry Opportunity Comparisons
  const industryPerfMap = new Map<
    string,
    {
      industry: string;
      companies: number;
      openOpportunities: number;
      wonOpportunities: number;
      lostOpportunities: number;
      openByCurrency: Map<string, number>;
      qualityScores: number[];
    }
  >();
  for (const l of filteredLeads) {
    const ind = l.industry?.trim() || 'Unspecified';
    const key = ind.toLowerCase();
    const cur = industryPerfMap.get(key) || {
      industry: ind,
      companies: 0,
      openOpportunities: 0,
      wonOpportunities: 0,
      lostOpportunities: 0,
      openByCurrency: new Map<string, number>(),
      qualityScores: [],
    };
    cur.companies++;
    const dq = qualityByLeadId.get(l.id);
    if (dq) cur.qualityScores.push(dq.overallScore);
    if (!useMultiOpps && (l.opportunityValue || 0) > 0) {
      if (l.status === 'converted' || l.pipelineStageId === 'stage-won') cur.wonOpportunities++;
      else if (l.status === 'lost' || l.pipelineStageId === 'stage-lost') cur.lostOpportunities++;
      else {
        cur.openOpportunities++;
        const c = (l.currency || 'USD').toUpperCase();
        cur.openByCurrency.set(c, (cur.openByCurrency.get(c) || 0) + (l.opportunityValue || 0));
      }
    }
    industryPerfMap.set(key, cur);
  }
  if (useMultiOpps) {
    for (const opp of filteredOpportunities) {
      const l = leadMap.get(opp.leadId);
      const ind = l?.industry?.trim() || 'Unspecified';
      const key = ind.toLowerCase();
      const cur = industryPerfMap.get(key);
      if (!cur) continue;
      if (opp.status === 'won') cur.wonOpportunities++;
      else if (opp.status === 'lost') cur.lostOpportunities++;
      else if (opp.status === 'open') {
        cur.openOpportunities++;
        const c = (opp.currency || 'USD').toUpperCase();
        cur.openByCurrency.set(c, (cur.openByCurrency.get(c) || 0) + (opp.estimatedValue || 0));
      }
    }
  }
  const industryOpportunityComparison = Array.from(industryPerfMap.values())
    .map((row) => ({
      industry: row.industry,
      companies: row.companies,
      openOpportunities: row.openOpportunities,
      wonOpportunities: row.wonOpportunities,
      lostOpportunities: row.lostOpportunities,
      winRatePercent: safePercent(row.wonOpportunities, row.wonOpportunities + row.lostOpportunities),
      openValueSummary:
        row.openByCurrency.size === 0
          ? '—'
          : Array.from(row.openByCurrency.entries())
              .map(([cur, v]) => `${cur} ${Math.round(v).toLocaleString()}`)
              .join(' · '),
      avgQualityScore: safeAvg(row.qualityScores),
    }))
    .sort((a, b) => b.companies - a.companies);

  // 5d. Source Quality Comparisons
  const sourcePerfMap = new Map<
    string,
    {
      sourceName: string;
      leadCount: number;
      verifiedCount: number;
      qualityScores: number[];
      opportunitiesCount: number;
    }
  >();
  const oppCountByLead = new Map<string, number>();
  for (const opp of filteredOpportunities) {
    oppCountByLead.set(opp.leadId, (oppCountByLead.get(opp.leadId) || 0) + 1);
  }
  for (const l of filteredLeads) {
    const src = getPrimaryLeadSource(l);
    const key = src.toLowerCase();
    const cur = sourcePerfMap.get(key) || {
      sourceName: src,
      leadCount: 0,
      verifiedCount: 0,
      qualityScores: [],
      opportunitiesCount: 0,
    };
    cur.leadCount++;
    if (isLeadOfficiallyVerified(l)) cur.verifiedCount++;
    const dq = qualityByLeadId.get(l.id);
    if (dq) cur.qualityScores.push(dq.overallScore);
    const oppCnt = oppCountByLead.get(l.id) || (!useMultiOpps && (l.opportunityValue || 0) > 0 ? 1 : 0);
    if (oppCnt > 0) cur.opportunitiesCount++;
    sourcePerfMap.set(key, cur);
  }
  const sourceQualityComparison = Array.from(sourcePerfMap.values())
    .map((s) => ({
      sourceName: s.sourceName,
      leadCount: s.leadCount,
      verifiedCount: s.verifiedCount,
      verifiedPercent: safePercent(s.verifiedCount, s.leadCount),
      avgQualityScore: safeAvg(s.qualityScores),
      opportunitiesCount: s.opportunitiesCount,
      opportunityConversionPercent: safePercent(s.opportunitiesCount, s.leadCount),
    }))
    .sort((a, b) => b.leadCount - a.leadCount);

  // 5e. Verification Quality & Data Completeness / Freshness
  let websiteInspectedCompanies = 0;
  let emailVerifiedCompanies = 0;
  let phoneVerifiedCompanies = 0;
  let unresolvedConflictsCount = 0;
  const completenessScores: number[] = [];
  const verificationScores: number[] = [];
  const freshnessScores: number[] = [];
  let staleAttributesTotal = 0;
  let reverificationEligibleCompanies = 0;
  let verificationCapAppliedCount = 0;

  for (const l of filteredLeads) {
    if (l.webMetadata?.inspectedAt && l.webMetadata?.httpStatus && l.webMetadata.httpStatus < 400) {
      websiteInspectedCompanies++;
    }
    if (l.emailStatus === 'verified') emailVerifiedCompanies++;
    if (l.phoneNormalized || (l.customFields?.phoneVerificationMeta || '').includes('provider_verified')) {
      phoneVerifiedCompanies++;
    }
    const dq = qualityByLeadId.get(l.id)!;
    completenessScores.push(dq.completenessScore);
    verificationScores.push(dq.verificationScore);
    freshnessScores.push(dq.freshnessScore);
    unresolvedConflictsCount += dq.conflictingAttributes.length;
    staleAttributesTotal += dq.staleAttributes.length;
    if (dq.reverificationEligible) reverificationEligibleCompanies++;
    if (dq.verificationCapApplied) verificationCapAppliedCount++;
  }

  const verifiedDecisionMakers = filteredPersons.filter(
    (p) => p.verificationStatus === 'officially_verified' || p.verificationStatus === 'web_observed'
  ).length;

  // 5f. Decision-Maker Coverage
  let companiesWithDm = 0;
  let totalDmLinks = 0;
  for (const l of filteredLeads) {
    const count = (relsByLead.get(l.id) || []).length;
    if (count > 0) companiesWithDm++;
    totalDmLinks += count;
  }

  // 5g. Pipeline Conversion Funnel
  const totalStageItems = stageDistribution.reduce((sum, s) => sum + s.opportunityCount, 0);
  const pipelineConversionFunnel = stageDistribution.map((s, idx) => {
    const prevCount = idx > 0 ? stageDistribution[idx - 1].opportunityCount : null;
    return {
      stageId: s.stageId,
      stageName: s.stageName,
      count: s.opportunityCount,
      shareOfTotalPercent: safePercent(s.opportunityCount, totalStageItems),
      stepConversionPercent: prevCount && prevCount > 0 ? safePercent(s.opportunityCount, prevCount) : null,
    };
  });

  // 5h. Outreach Performance Over Time
  const outreachTimeMap = new Map<
    string,
    {
      providerSent: number;
      manualSent: number;
      failed: number;
      replies: number;
      positiveReplies: number;
      meetingsScheduled: number;
    }
  >();
  const ensureOutreachPeriod = (period: string) => {
    let row = outreachTimeMap.get(period);
    if (!row) {
      row = { providerSent: 0, manualSent: 0, failed: 0, replies: 0, positiveReplies: 0, meetingsScheduled: 0 };
      outreachTimeMap.set(period, row);
    }
    return row;
  };
  for (const m of scopedOutreachWs.messages) {
    const p = formatMonthPeriod(m.sentAt || m.createdAt);
    if (!p) continue;
    const row = ensureOutreachPeriod(p);
    if (m.status === 'sent') row.providerSent++;
    else if (m.status === 'manual_sent') row.manualSent++;
    else if (m.status === 'failed') row.failed++;
  }
  for (const r of scopedOutreachWs.replies) {
    const p = formatMonthPeriod(r.receivedAt || r.recordedAt);
    if (!p) continue;
    const row = ensureOutreachPeriod(p);
    row.replies++;
    if (
      r.classification === 'positive' ||
      r.classification === 'meeting_interest' ||
      r.classification === 'information_request' ||
      r.classification === 'referral'
    ) {
      row.positiveReplies++;
    }
  }
  for (const f of scopedOutreachWs.followUps) {
    if (f.triggerType !== 'meeting_scheduled' || f.status === 'cancelled' || f.status === 'suppressed') continue;
    const p = formatMonthPeriod(f.scheduledFor || f.createdAt);
    if (!p) continue;
    ensureOutreachPeriod(p).meetingsScheduled++;
  }
  const outreachPerformanceOverTime = Array.from(outreachTimeMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, stats]) => ({ period, ...stats }));

  const engagementLabels: Record<keyof typeof engagementTiers, string> = {
    high: 'High Engagement (3+ interactions / 30d)',
    moderate: 'Moderate Engagement (1-2 interactions / 30d)',
    low: 'Low Historical Engagement (0 in 30d)',
    dormant: 'Dormant (No Logged Interactions)',
    declining: 'Declining / Stale Engagement',
  };

  const advancedAnalytics: BiAdvancedAnalyticsSection = {
    leadAcquisitionTrends,
    countryRegionalPerformance,
    industryOpportunityComparison,
    sourceQualityComparison,
    verificationQuality: {
      registryVerifiedCompanies: verifiedLeads,
      websiteInspectedCompanies,
      emailVerifiedCompanies,
      phoneVerifiedCompanies,
      unresolvedConflictsCount,
      verifiedDecisionMakers,
      totalDecisionMakers: filteredPersons.length,
    },
    companyEngagementDistribution: (['high', 'moderate', 'low', 'dormant', 'declining'] as const).map((tier) => ({
      tier,
      label: engagementLabels[tier],
      count: engagementTiers[tier],
      percentage:
        filteredLeads.length > 0
          ? Number(((engagementTiers[tier] / filteredLeads.length) * 100).toFixed(1))
          : 0,
    })),
    decisionMakerCoverage: {
      companiesWithDecisionMakers: companiesWithDm,
      companiesWithoutDecisionMakers: Math.max(0, filteredLeads.length - companiesWithDm),
      coveragePercent: safePercent(companiesWithDm, filteredLeads.length),
      averageDecisionMakersPerCompany:
        filteredLeads.length > 0 ? Number((totalDmLinks / filteredLeads.length).toFixed(2)) : null,
      verifiedDecisionMakerPercent: safePercent(verifiedDecisionMakers, filteredPersons.length),
    },
    pipelineConversionFunnel,
    outreachPerformanceOverTime,
    dataCompletenessAndFreshness: {
      averageCompletenessScore: safeAvg(completenessScores),
      averageVerificationScore: safeAvg(verificationScores),
      averageFreshnessScore: safeAvg(freshnessScores),
      averageOverallScore: safeAvg(overallQualityScores),
      staleAttributesTotal,
      reverificationEligibleCompanies,
      verificationCapAppliedCount,
    },
  };

  return {
    generatedAt: now.toISOString(),
    filtersApplied: {
      dateFrom: rawFilter.dateFrom || undefined,
      dateTo: rawFilter.dateTo || undefined,
      country: countryFilter,
      industry: rawFilter.industry?.trim() || undefined,
      source: rawFilter.source?.trim() || undefined,
      stageId: stageFilter,
    },
    filterOptions: {
      countries: Array.from(countryOptMap.entries())
        .map(([code, name]) => ({ code, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      industries: Array.from(industryOptSet).sort((a, b) => a.localeCompare(b)),
      sources: Array.from(sourceOptSet).sort((a, b) => a.localeCompare(b)),
      stages: sortedStages.map((s) => ({ id: s.id, name: s.name })),
    },
    leadIntelligence,
    salesPipeline,
    outreachAnalytics,
    activityAnalytics,
    advancedAnalytics,
    workflowSummary: {
      totalWorkflows: workflowWs.workflows.length,
      enabledWorkflows: workflowWs.workflows.filter((w) => w.enabled).length,
      totalExecutions: workflowWs.executions.length,
      completedExecutions: workflowWs.executions.filter((e) => e.status === 'completed').length,
      failedExecutions: workflowWs.executions.filter(
        (e) => e.status === 'failed' || e.status === 'partial_failure'
      ).length,
      awaitingApprovalExecutions: workflowWs.executions.filter((e) => e.status === 'awaiting_approval')
        .length,
      unreadNotifications: workflowWs.notifications.filter((n) => !n.read).length,
    },
    honestDisclosures: [
      'All BI metrics are calculated directly from live LEED CRM, Enrichment, Pipeline, Outreach, and Workflow records with zero fabricated data.',
      'Provider-confirmed email sends and failures are strictly separated from manual owner-recorded sends, replies, and confirmed meetings.',
      'Time-based workflow triggers (stage duration, overdue tasks) and reports run on-demand; no background cron scheduler is active.',
      'Email open/click tracking pixels, automated inbound IMAP/webhook reply sync, and automated external calendar sync are not enabled.',
    ],
  };
}
