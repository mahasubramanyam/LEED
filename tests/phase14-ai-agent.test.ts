/**
 * Phase 14 Isolated Test Suite — AI Sales Agent & Intelligent Sales Assistance.
 *
 * Strictly isolated: uses a temporary StorageManager directory (cleaned up in finally).
 * Never writes to Neon PostgreSQL, data/pipeline_store.json, or data/owner_auth.json.
 * Uses deterministic in-process AI override hooks for zero external network calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { StorageManager } from '../server/storage.js';
import {
  createCrmInteraction,
  createCrmOpportunity,
  createCrmPrivateNote,
  createCrmStorageFacade,
  createExtendedTask,
  listAllCrmInteractions,
  listAllCrmOpportunities,
  listAllExtendedTasks,
  updateCompanyRelationshipMeta,
} from '../server/crm/crmStoreHelper.js';
import {
  getAiProviderStatus,
  redactAiSecrets,
  resolveConfiguredModel,
  setAiApiKeyOverrideForTests,
  setAiGeneratorOverrideForTests,
} from '../server/ai/aiProvider.js';
import {
  AI_WORKSPACE_SETTINGS_KEY,
  deleteIcpProfile,
  listAiActionProposals,
  listAiConversations,
  listIcpProfiles,
  listSavedDrafts,
  updateOwnerSalesGoals,
  upsertIcpProfile,
} from '../server/ai/aiStoreHelper.js';
import { buildControlledAiContext } from '../server/ai/contextBuilder.js';
import { evaluateCompanyAgainstIcp } from '../server/ai/icpEngine.js';
import { prioritizeCrmLeads, scoreLeadPriority } from '../server/ai/prioritizationEngine.js';
import { executeControlledAgentTool, listAuthorizedAgentTools } from '../server/ai/agentTools.js';
import {
  approveAndExecuteActionProposal,
  generateCompanySalesIntelligence,
  generateDailySalesBriefing,
  generateMeetingPreparation,
  generateSalesCommunicationDraft,
  rejectActionProposal,
  runSalesAgentConversationTurn,
} from '../server/ai/salesIntelligenceService.js';
import { DEFAULT_GEMINI_MODEL } from '../shared/aiAgentSpecs.js';
import type { CanonicalLead, LinkedPersonWithRelationship } from '../server/types.js';

function createIsolatedStorage(): {
  store: StorageManager;
  dir: string;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-phase14-'));
  const storePath = path.join(dir, 'pipeline_store.json');
  const store = new StorageManager(storePath);
  for (const l of [...store.getLeads()]) {
    store.deleteLead(l.id);
  }
  for (const t of [...store.getTasks()]) {
    store.deleteTask(t.id);
  }
  return {
    store,
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on temp dir
      }
    },
  };
}

function makeLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = '2026-11-18T10:00:00.000Z';
  return {
    id: overrides.id || 'lead-p14-1',
    companyName: overrides.companyName || 'Nordic Precision Robotics AS',
    legalName: overrides.legalName || 'Nordic Precision Robotics AS',
    registrationNumber: overrides.registrationNumber || '924551234',
    registrationType: overrides.registrationType || 'NO_ORG',
    domain: overrides.domain || 'nordicrobotics.no',
    website: overrides.website || 'https://nordicrobotics.no',
    email: overrides.email || 'hello@nordicrobotics.no',
    emailStatus: overrides.emailStatus || 'verified',
    phone: overrides.phone || '+4722889900',
    industry: overrides.industry !== undefined ? overrides.industry : 'Industrial Automation & Robotics',
    category: overrides.category !== undefined ? overrides.category : 'B2B Manufacturing',
    status: overrides.status || 'qualified',
    companyStatus: overrides.companyStatus || 'active',
    address:
      'address' in overrides
        ? overrides.address
        : {
            street: 'Teknologiveien 8',
            city: 'Trondheim',
            region: 'Trondelag',
            country: 'Norway',
            countryCode: 'NO',
            formattedAddress: 'Teknologiveien 8, Trondheim, Norway',
          },
    confidenceScore: overrides.confidenceScore ?? 88,
    confidenceSignals: overrides.confidenceSignals || ['Official registry verified', 'Official website inspected'],
    sources: overrides.sources || [
      {
        sourceName: 'Norway Brreg Registry',
        url: 'https://data.brreg.no/enhetsregisteret/api/enheter/924551234',
        retrievedAt: now,
      },
    ],
    identifiers: overrides.identifiers || [
      {
        type: 'NO_ORG',
        value: '924551234',
        verified: true,
        status: 'officially_verified',
      },
    ],
    webMetadata:
      'webMetadata' in overrides
        ? overrides.webMetadata
        : {
            title: 'Nordic Precision Robotics — Autonomous Factory Logistics',
            description: 'Industrial robotics and warehouse automation manufacturer serving European factories.',
          },
    currency: overrides.currency || 'EUR',
    opportunityValue: overrides.opportunityValue,
    tags: overrides.tags || ['robotics', 'automation', 'export'],
    notes: overrides.notes || [],
    activities: overrides.activities || [],
    customFields: overrides.customFields || {},
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

function linkCeoToLead(store: StorageManager, leadId: string): LinkedPersonWithRelationship {
  const linked = store.linkPersonToLead({
    leadId,
    actorEmail: 'owner@local',
    person: {
      fullName: 'Astrid Solberg',
      firstName: 'Astrid',
      lastName: 'Solberg',
      email: 'astrid.solberg@nordicrobotics.no',
      emailStatus: 'verified',
      phone: '+4791234567',
      phoneNormalized: '+4791234567',
      linkedinUrl: 'https://linkedin.com/in/astrid-solberg',
      country: 'Norway',
      countryCode: 'NO',
      city: 'Trondheim',
      jobTitle: 'Chief Executive Officer',
      department: 'Executive',
      seniority: 'c_suite',
      decisionMakingFunction: 'Executive Leadership',
      relationshipType: 'ceo',
      isPrimaryContact: true,
      verificationStatus: 'officially_verified',
      confidenceScore: 92,
      relationshipProvenance: { employmentStatus: 'current', isExplicitlyPublished: true },
      customFields: {},
    },
  });
  return linked[0];
}

function resetAiOverrides() {
  setAiGeneratorOverrideForTests(null);
  setAiApiKeyOverrideForTests(undefined);
}

// ============================================================================
// 1. AI PROVIDER STATUS, MODEL ALLOWLIST, SECRET REDACTION & FALLBACK HONESTY
// ============================================================================

test('Phase 14: AI provider status, model allowlist, honest disclosures, and secret redaction', async () => {
  try {
    setAiGeneratorOverrideForTests(null);
    setAiApiKeyOverrideForTests(null);

    assert.equal(resolveConfiguredModel(), DEFAULT_GEMINI_MODEL);
    assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-4-hydrogen');

    const unconfigured = getAiProviderStatus();
    assert.equal(unconfigured.provider, 'gemini');
    assert.equal(unconfigured.configured, false);
    assert.equal(unconfigured.mode, 'deterministic_fallback');
    assert.equal(unconfigured.capabilities.automatedBackgroundBriefingScheduler, false);
    assert.equal(unconfigured.capabilities.automatedEmailOrMessageSending, false);
    assert.ok(unconfigured.honestDisclosures.some((d) => d.includes('draft_only')));
    assert.ok(unconfigured.honestDisclosures.some((d) => d.includes('on demand')));

    const leaked =
      'Request failed with key AIzaSySecretKeyExample1234567890 and Bearer eyJhbGciOiJIUzI1NiJ9.abcdef and api_key=my_super_secret_token';
    const redacted = redactAiSecrets(leaked);
    assert.ok(!redacted.includes('AIzaSySecretKeyExample'));
    assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiJ9'));
    assert.ok(!redacted.includes('my_super_secret_token'));
    assert.ok(redacted.includes('[REDACTED_KEY]'));
    assert.ok(redacted.includes('Bearer [REDACTED]'));
  } finally {
    resetAiOverrides();
  }
});

// ============================================================================
// 2. STRICT PRIVATE NOTES PRIVACY GATE & CONTROLLED CONTEXT BUILDER
// ============================================================================

test('Phase 14: Owner private notes are withheld by default and only included upon explicit opt-in', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(store);
    const lead = makeLead();
    store.upsertLead(lead);
    linkCeoToLead(store, lead.id);

    const secretText = 'CONFIDENTIAL_OWNER_PRICING_FLOOR_42K_DO_NOT_SHARE';
    await createCrmPrivateNote(facade, {
      entityType: 'company',
      leadId: lead.id,
      title: 'Internal Negotiation Floor',
      content: secretText,
      category: 'negotiation',
      author: 'owner@local',
    });

    // Default (includePrivateNotes omitted / false): MUST exclude private notes
    const defaultCtx = await buildControlledAiContext(facade, {
      scopeType: 'company',
      leadId: lead.id,
    });
    assert.equal(defaultCtx.contextAudit.privateNotesAuthorized, false);
    assert.equal(defaultCtx.contextAudit.includedEntities.privateNotesIncluded, 0);
    assert.equal(defaultCtx.contextAudit.includedEntities.privateNotesRedactedCount, 1);
    assert.equal(defaultCtx.includedPrivateNotes.length, 0);
    assert.ok(!defaultCtx.promptContextText.includes(secretText));
    assert.ok(defaultCtx.evidenceSources.every((e) => e.entityType !== 'private_note'));

    // Explicit opt-in (includePrivateNotes: true): MUST include private notes and log authorization
    const optedInCtx = await buildControlledAiContext(facade, {
      scopeType: 'company',
      leadId: lead.id,
      includePrivateNotes: true,
    });
    assert.equal(optedInCtx.contextAudit.privateNotesAuthorized, true);
    assert.equal(optedInCtx.contextAudit.includedEntities.privateNotesIncluded, 1);
    assert.equal(optedInCtx.contextAudit.includedEntities.privateNotesRedactedCount, 0);
    assert.ok(optedInCtx.promptContextText.includes(secretText));
    assert.ok(optedInCtx.evidenceSources.some((e) => e.entityType === 'private_note'));
  } finally {
    cleanup();
  }
});

// ============================================================================
// 3. CONTROLLED AGENT TOOLS: ALLOWLIST, INJECTION GUARD, PRIVATE NOTE GATE & SSRF SHIELD
// ============================================================================

test('Phase 14: Controlled AI tools enforce allowlist, block SQL/shell payloads, gate private notes, and enforce SSRF', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(store);
    const lead = makeLead();
    store.upsertLead(lead);
    linkCeoToLead(store, lead.id);

    await createCrmPrivateNote(facade, {
      entityType: 'company',
      leadId: lead.id,
      title: 'Owner Strategy',
      content: 'Private board insight on Q4 renewal',
      category: 'general',
      author: 'owner@local',
    });

    const authorizedTools = listAuthorizedAgentTools();
    assert.ok(authorizedTools.length >= 14);

    // Unknown tool rejected
    await assert.rejects(
      () =>
        executeControlledAgentTool(
          { facade, includePrivateNotes: false },
          'execute_raw_sql_query',
          { sql: 'SELECT * FROM leads' }
        ),
      /Unauthorized AI tool/i
    );

    // SQL injection payload rejected
    await assert.rejects(
      () =>
        executeControlledAgentTool(
          { facade, includePrivateNotes: false },
          'search_crm_companies',
          { query: 'Nordic; DROP TABLE leads;' }
        ),
      /Blocked unsafe SQL or shell-like/i
    );

    // Shell payload rejected
    await assert.rejects(
      () =>
        executeControlledAgentTool(
          { facade, includePrivateNotes: false },
          'search_crm_companies',
          { query: '$(cat /etc/passwd)' }
        ),
      /Blocked unsafe SQL or shell-like/i
    );

    // Private notes tool blocked without opt-in
    await assert.rejects(
      () =>
        executeControlledAgentTool(
          { facade, includePrivateNotes: false },
          'search_private_notes',
          { leadId: lead.id }
        ),
      /without explicit owner opt-in/i
    );

    // Private notes tool succeeds WITH explicit opt-in
    const notesRes = await executeControlledAgentTool(
      { facade, includePrivateNotes: true },
      'search_private_notes',
      { leadId: lead.id }
    );
    assert.equal(notesRes.record.success, true);
    assert.equal((notesRes.data as any).count, 1);

    // Authorized read tools succeed
    const compRes = await executeControlledAgentTool(
      { facade, includePrivateNotes: false },
      'search_crm_companies',
      { query: 'Nordic' }
    );
    assert.equal(compRes.record.success, true);
    assert.equal((compRes.data as any).totalMatched, 1);

    const dmRes = await executeControlledAgentTool(
      { facade, includePrivateNotes: false },
      'search_decision_makers',
      { query: 'Chief Executive' }
    );
    assert.equal(dmRes.record.success, true);
    assert.equal((dmRes.data as any).totalMatched, 1);

    // SSRF shield blocks loopback and cloud metadata endpoints
    const ssrfLoopback = await executeControlledAgentTool(
      { facade, includePrivateNotes: false },
      'inspect_company_website_ssrf_safe',
      { url: 'http://127.0.0.1:3000/api/auth/status' }
    );
    assert.equal((ssrfLoopback.data as any).reachable, false);
    assert.equal((ssrfLoopback.data as any).ssrfProtected, true);

    const ssrfMeta = await executeControlledAgentTool(
      { facade, includePrivateNotes: false },
      'inspect_company_website_ssrf_safe',
      { url: 'http://169.254.169.254/latest/meta-data/' }
    );
    assert.equal((ssrfMeta.data as any).reachable, false);
  } finally {
    cleanup();
  }
});

// ============================================================================
// 4. MULTI-ICP MANAGEMENT & EXPLAINABLE ICP MATCHING ENGINE
// ============================================================================

test('Phase 14: Multi-ICP CRUD and explainable ICP matching for strong fit, excluded industry, missing data, and discovery candidates', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(store);
    const strongLead = makeLead();
    store.upsertLead(strongLead);
    const linkedCeo = linkCeoToLead(store, strongLead.id);

    const excludedLead = makeLead({
      id: 'lead-p14-excluded',
      companyName: 'Nordic Casino Entertainment AS',
      industry: 'Gambling & Online Betting',
      category: 'Gaming',
      domain: 'nordiccasino.no',
      website: 'https://nordiccasino.no',
      registrationNumber: '999888777',
    });
    store.upsertLead(excludedLead);

    const sparseLead = makeLead({
      id: 'lead-p14-sparse',
      companyName: 'Mystery Ventures Ltd',
      industry: '',
      category: '',
      website: undefined,
      domain: undefined,
      email: undefined,
      emailStatus: 'unavailable',
      phone: undefined,
      address: undefined,
      webMetadata: undefined,
      confidenceScore: 30,
      sources: [],
      identifiers: [],
      tags: [],
    });
    store.upsertLead(sparseLead);

    const icp = await upsertIcpProfile(facade, {
      name: 'European Robotics & Automation B2B',
      isDefault: true,
      targetIndustries: ['Robotics', 'Industrial Automation', 'Manufacturing'],
      excludedIndustries: ['Gambling', 'Betting', 'Tobacco'],
      targetCountries: ['NO', 'DE', 'SE'],
      targetBusinessTypes: ['B2B Manufacturing', 'NO_ORG'],
      preferredKeywords: ['automation', 'robotics', 'warehouse'],
      targetDecisionMakerRoles: ['CEO', 'Managing Director', 'CTO'],
      minDataQualityScore: 60,
      requireWebsite: true,
      requireVerifiedContact: true,
    });

    const icp2 = await upsertIcpProfile(facade, {
      name: 'Secondary Maritime ICP',
      targetIndustries: ['Maritime'],
      targetCountries: ['NO'],
    });

    const listed = await listIcpProfiles(facade);
    assert.equal(listed.length, 2);
    assert.equal(listed.filter((p) => p.isDefault).length, 1);

    // Evaluate strong match
    const strongResult = evaluateCompanyAgainstIcp({
      icp,
      lead: strongLead,
      decisionMakers: [linkedCeo],
    });
    assert.ok(strongResult.overallScore >= 80, `Expected strong ICP score >= 80, got ${strongResult.overallScore}`);
    assert.equal(strongResult.fitLabel, 'strong_fit');
    assert.ok(strongResult.matchingCriteria.length >= 5);

    // Evaluate excluded industry
    const excludedResult = evaluateCompanyAgainstIcp({
      icp,
      lead: excludedLead,
      decisionMakers: [],
    });
    assert.equal(excludedResult.fitLabel, 'excluded');
    assert.ok(excludedResult.overallScore <= 10);

    // Evaluate sparse company (missing data disclosed honestly)
    const sparseResult = evaluateCompanyAgainstIcp({
      icp,
      lead: sparseLead,
      decisionMakers: [],
    });
    assert.ok(sparseResult.missingInformation.length >= 3);
    assert.equal(sparseResult.isInferred, true);
    assert.ok(sparseResult.fitLabel === 'poor_fit' || sparseResult.fitLabel === 'partial_fit');

    // Evaluate discovery candidate before CRM import
    const candidateResult = evaluateCompanyAgainstIcp({
      icp,
      candidate: {
        companyName: 'Munich Factory Automation GmbH',
        industry: 'Industrial Automation',
        country: 'Germany',
        countryCode: 'DE',
        website: 'https://munich-automation.de',
        description: 'Warehouse robotics and factory automation integrator',
        confidenceScore: 78,
      },
    });
    assert.ok(candidateResult.overallScore >= 50);
    assert.ok(candidateResult.matchingCriteria.some((c) => c.criterion === 'Target Industry'));

    // Delete secondary ICP
    const deleted = await deleteIcpProfile(facade, icp2.id);
    assert.equal(deleted, true);
    assert.equal((await listIcpProfiles(facade)).length, 1);

    // Verify internal settings key is stripped from public connectorConfigs
    assert.equal(store.getConnectorConfigs()[AI_WORKSPACE_SETTINGS_KEY], undefined);
  } finally {
    cleanup();
  }
});

// ============================================================================
// 5. EXPLAINABLE LEAD PRIORITIZATION ENGINE
// ============================================================================

test('Phase 14: Lead Prioritization Engine ranks high-fit urgent accounts above weak accounts with explainable factors', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(store);
    const highLead = makeLead({ id: 'lead-high', companyName: 'Apex Robotics AS' });
    const lowLead = makeLead({
      id: 'lead-low',
      companyName: 'Small Cafe Co',
      industry: 'Hospitality',
      category: 'Retail',
      address: { country: 'Brazil', countryCode: 'BR' },
      website: undefined,
      email: undefined,
      emailStatus: 'unavailable',
      phone: undefined,
      confidenceScore: 35,
      sources: [],
      identifiers: [],
      tags: [],
    });
    store.upsertLead(highLead);
    store.upsertLead(lowLead);
    const linkedHigh = linkCeoToLead(store, 'lead-high');

    const icp = await upsertIcpProfile(facade, {
      name: 'Nordic Robotics ICP',
      isDefault: true,
      targetIndustries: ['Robotics', 'Automation'],
      targetCountries: ['NO'],
      targetDecisionMakerRoles: ['CEO'],
      requireWebsite: true,
    });

    const opp = await createCrmOpportunity(facade, {
      leadId: 'lead-high',
      title: 'Factory Automation Pilot',
      estimatedValue: 85000,
      currency: 'EUR',
      probability: 65,
      status: 'open',
      pipelineStageId: 'proposal',
      changedBy: 'owner@local',
    });

    const task = await createExtendedTask(facade, {
      leadId: 'lead-high',
      title: 'Send final proposal follow-up',
      dueDate: '2026-10-01T10:00:00.000Z', // overdue
      priority: 'high',
      category: 'proposal',
      completed: false,
      assignedTo: 'owner@local',
    });

    const ranked = await prioritizeCrmLeads(facade, { limit: 10 });
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].leadId, 'lead-high');
    assert.ok(ranked[0].priorityScore > ranked[1].priorityScore);
    assert.equal(ranked[0].factors.length, 6);
    assert.ok(ranked[0].recommendedNextAction.length > 5);

    const directScore = scoreLeadPriority({
      lead: highLead,
      decisionMakers: [linkedHigh],
      interactions: [],
      tasks: [task],
      opportunities: [opp],
      icp,
    });
    assert.equal(directScore.assessment.leadId, 'lead-high');
    assert.ok(directScore.icpMatch && directScore.icpMatch.overallScore >= 70);
  } finally {
    cleanup();
  }
});

// ============================================================================
// 6. COMPANY SALES INTELLIGENCE REPORT: 5-WAY SEPARATION, AI-ASSISTED + FALLBACK & ZERO SILENT WRITES
// ============================================================================

test('Phase 14: Company Sales Intelligence separates facts/analysis/hypotheses/unknowns, handles AI errors safely, and never silently mutates CRM', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(store);
    const lead = makeLead();
    store.upsertLead(lead);

    await updateOwnerSalesGoals(facade, {
      businessName: 'Vanguard Industrial Partners',
      valueProposition: 'Predictive maintenance analytics for robotics fleets.',
      productsAndServices: ['Fleet Telemetry', 'SLA Optimization'],
    });

    // 6a. Simulate AI provider failure containing secret key -> must redact secret & return honest deterministic fallback
    setAiGeneratorOverrideForTests(() => {
      throw new Error('Upstream 503 with key AIzaSyLeakAttempt9999999999999');
    });

    const tasksBefore = (await listAllExtendedTasks(facade)).length;
    const reportFallback = await generateCompanySalesIntelligence(facade, {
      leadId: lead.id,
      includePrivateNotes: false,
    });

    assert.equal(reportFallback.aiStatus.mode, 'deterministic_fallback');
    assert.ok(reportFallback.aiStatus.warning && !reportFallback.aiStatus.warning.includes('AIzaSyLeakAttempt'));
    assert.ok(reportFallback.verifiedFacts.length > 0);
    assert.ok(reportFallback.aiAnalysis.length > 0);
    assert.ok(reportFallback.hypotheses.length > 0);
    assert.ok(reportFallback.unknownInformation.some((u) => u.toLowerCase().includes('revenue')));
    assert.ok(reportFallback.unknownInformation.some((u) => u.toLowerCase().includes('headcount')));
    assert.ok(reportFallback.proposedActions.length > 0);
    assert.equal(reportFallback.proposedActions[0].status, 'pending_approval');

    // Verify ZERO silent CRM mutations happened!
    assert.equal((await listAllExtendedTasks(facade)).length, tasksBefore);

    // 6b. Simulate AI-assisted JSON response -> must report mode: 'ai_assisted'
    setAiGeneratorOverrideForTests(async () =>
      JSON.stringify({
        executiveSummary: 'Nordic Precision Robotics AS is a verified Norwegian robotics manufacturer with strong strategic fit.',
        businessModelOverview: 'Builds autonomous factory logistics hardware per official website metadata.',
        aiAnalysis: ['Registry verified active status in Norway strengthens commercial reliability.'],
        hypotheses: ['Fleet uptime analytics may resonate with operations leadership.'],
        recommendedOutreachStrategy: 'Identify CEO/CTO first, then initiate consultative outreach.',
        recommendedAngles: ['Reduce unplanned factory robot downtime'],
        risksAndGaps: ['No decision-makers linked yet'],
        recommendedNextSteps: ['Run Decision-Maker Discovery on Nordic Precision Robotics AS'],
      })
    );

    const reportAi = await generateCompanySalesIntelligence(facade, { leadId: lead.id });
    assert.equal(reportAi.aiStatus.mode, 'ai_assisted');
    assert.equal(reportAi.aiStatus.model, DEFAULT_GEMINI_MODEL);
    assert.ok(reportAi.executiveSummary.includes('Nordic Precision Robotics AS'));
  } finally {
    resetAiOverrides();
    cleanup();
  }
});

// ============================================================================
// 7. MEETING PREPARATION INTELLIGENCE (ZERO FABRICATED INTERACTIONS)
// ============================================================================

test('Phase 14: Meeting Preparation accurately reflects empty vs real interaction history without hallucination', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    setAiGeneratorOverrideForTests(null);
    setAiApiKeyOverrideForTests(null);

    const facade = createCrmStorageFacade(store);
    const lead = makeLead();
    store.upsertLead(lead);
    const linked = linkCeoToLead(store, lead.id);

    // Zero interactions recorded
    const coldPrep = await generateMeetingPreparation(facade, {
      leadId: lead.id,
      personId: linked.person.id,
      meetingGoal: 'Initial technical discovery',
    });
    assert.equal(coldPrep.previousInteractions.length, 0);
    assert.ok(coldPrep.relationshipHistorySummary.toLowerCase().includes('no previous interactions'));
    assert.ok(coldPrep.honestGroundingNote.toLowerCase().includes('zero prior interactions'));
    assert.ok(coldPrep.honestGroundingNote.toLowerCase().includes('no prior conversation history was invented'));
    assert.ok(coldPrep.strategicQuestions.length >= 3);

    // Record a real interaction and regenerate
    await createCrmInteraction(facade, {
      leadId: lead.id,
      personId: linked.person.id,
      type: 'video_meeting',
      occurredAt: '2026-11-15T14:00:00.000Z',
      summary: 'Reviewed warehouse robotics telemetry requirements',
      outcome: 'Requested follow-up architecture review',
      nextAction: 'Share reference deployment metrics',
      recordedBy: 'owner@local',
    });

    const warmPrep = await generateMeetingPreparation(facade, {
      leadId: lead.id,
      personId: linked.person.id,
    });
    assert.equal(warmPrep.previousInteractions.length, 1);
    assert.ok(warmPrep.previousInteractions[0].summary.includes('telemetry requirements'));
  } finally {
    resetAiOverrides();
    cleanup();
  }
});

// ============================================================================
// 8. ON-DEMAND DAILY SALES BRIEFING (HONEST SCHEDULER DISCLOSURE)
// ============================================================================

test('Phase 14: Daily Sales Briefing is strictly on-demand, discloses schedulerActive: false, and surfaces real CRM priorities', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    setAiGeneratorOverrideForTests(null);
    setAiApiKeyOverrideForTests(null);

    const facade = createCrmStorageFacade(store);
    const lead = makeLead();
    store.upsertLead(lead);

    await createExtendedTask(facade, {
      leadId: lead.id,
      title: 'Overdue follow-up call',
      dueDate: '2026-10-10T09:00:00.000Z',
      priority: 'high',
      category: 'call',
      completed: false,
      assignedTo: 'owner@local',
    });

    await createCrmOpportunity(facade, {
      leadId: lead.id,
      title: 'Annual Maintenance Contract',
      estimatedValue: 50000,
      currency: 'EUR',
      probability: 45,
      status: 'open',
      pipelineStageId: 'qualified',
      expectedCloseDate: '2026-10-15T00:00:00.000Z', // past close date -> at risk
      changedBy: 'owner@local',
    });

    const briefing = await generateDailySalesBriefing(facade);
    assert.equal(briefing.deliveryMode, 'on_demand_manual');
    assert.equal(briefing.schedulerActive, false);
    assert.ok(briefing.overdueAndDueFollowUps.length >= 1);
    assert.ok(briefing.priorityCompaniesToContact.length >= 1);
    assert.ok(briefing.opportunitiesRequiringAttention.length >= 1);
    assert.ok(briefing.companiesNeedingResearchOrEnrichment.length >= 1);
  } finally {
    resetAiOverrides();
    cleanup();
  }
});

// ============================================================================
// 9. DRAFT-ONLY COMMUNICATION DRAFTING (ZERO AUTOMATED SENDING)
// ============================================================================

test('Phase 14: Sales Communication Drafting enforces draft_only, autoSent: false, and persists drafts', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    setAiGeneratorOverrideForTests(null);
    setAiApiKeyOverrideForTests(null);

    const facade = createCrmStorageFacade(store);
    const lead = makeLead();
    store.upsertLead(lead);
    const linked = linkCeoToLead(store, lead.id);

    const emailDraft = await generateSalesCommunicationDraft(facade, {
      leadId: lead.id,
      personId: linked.person.id,
      draftType: 'cold_outreach',
      tone: 'executive',
    });
    assert.equal(emailDraft.status, 'draft_only');
    assert.equal(emailDraft.autoSent, false);
    assert.equal(emailDraft.channel, 'email');
    assert.ok(emailDraft.subject && emailDraft.subject.length > 3);
    assert.ok(emailDraft.body.includes('Astrid'));
    assert.ok(emailDraft.caveatsAndPlaceholders.some((c) => c.toLowerCase().includes('zero prior interactions')));

    const linkedinDraft = await generateSalesCommunicationDraft(facade, {
      leadId: lead.id,
      personId: linked.person.id,
      draftType: 'linkedin_message',
      tone: 'direct',
    });
    assert.equal(linkedinDraft.status, 'draft_only');
    assert.equal(linkedinDraft.autoSent, false);
    assert.equal(linkedinDraft.channel, 'linkedin');
    assert.equal(linkedinDraft.subject, undefined);

    const saved = await listSavedDrafts(facade, { leadId: lead.id });
    assert.equal(saved.length, 2);
  } finally {
    resetAiOverrides();
    cleanup();
  }
});

// ============================================================================
// 10. CONVERSATIONAL AGENT + OWNER APPROVAL WORKFLOW (NO SILENT CRM MUTATIONS)
// ============================================================================

test('Phase 14: Conversational AI Sales Agent persists history, queues pending_approval proposals, and executes CRM mutations ONLY on explicit approval', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    setAiGeneratorOverrideForTests(null);
    setAiApiKeyOverrideForTests(null);

    const facade = createCrmStorageFacade(store);
    const lead = makeLead();
    store.upsertLead(lead);

    // Owner asks agent to create a follow-up task -> MUST only queue pending_approval proposal
    const tasksBefore = (await listAllExtendedTasks(facade)).length;
    const turn1 = await runSalesAgentConversationTurn(facade, {
      userMessage: 'Please create a high-priority follow-up task for Nordic Precision Robotics.',
      contextScope: {
        scopeType: 'company',
        leadId: lead.id,
        includePrivateNotes: false,
      },
    });

    assert.equal(turn1.conversation.messages.length, 2);
    assert.ok(turn1.assistantMessage.toolsUsed && turn1.assistantMessage.toolsUsed.length >= 1);
    assert.equal(turn1.proposedActions.length, 1);
    assert.equal(turn1.proposedActions[0].status, 'pending_approval');

    // CRM task list MUST still be completely unchanged!
    assert.equal((await listAllExtendedTasks(facade)).length, tasksBefore);

    // Conversation persisted across reads
    const persistedConvs = await listAiConversations(facade);
    assert.equal(persistedConvs.length, 1);
    assert.equal(persistedConvs[0].id, turn1.conversation.id);

    // Explicitly APPROVE proposal -> NOW executes real CRM task creation
    const approvalResult = await approveAndExecuteActionProposal(
      facade,
      turn1.proposedActions[0].id,
      'owner@local'
    );
    assert.equal(approvalResult.proposal.status, 'approved_executed');
    assert.ok(approvalResult.executedEntityId);
    assert.equal((await listAllExtendedTasks(facade)).length, tasksBefore + 1);

    // Re-approving same proposal MUST be rejected (idempotency guard)
    await assert.rejects(
      () => approveAndExecuteActionProposal(facade, turn1.proposedActions[0].id, 'owner@local'),
      /already approved_executed/i
    );

    // Queue an opportunity proposal and REJECT it -> CRM opportunities MUST remain untouched
    const oppsBefore = (await listAllCrmOpportunities(facade)).length;
    const turn2 = await runSalesAgentConversationTurn(facade, {
      conversationId: turn1.conversation.id,
      userMessage: 'Please create an opportunity for this company.',
      contextScope: { scopeType: 'company', leadId: lead.id, includePrivateNotes: false },
    });
    assert.equal(turn2.conversation.messages.length, 4);
    assert.equal(turn2.proposedActions.length, 1);
    assert.equal((await listAllCrmOpportunities(facade)).length, oppsBefore);

    const rejected = await rejectActionProposal(
      facade,
      turn2.proposedActions[0].id,
      'owner@local',
      'Not qualified yet'
    );
    assert.equal(rejected.status, 'rejected');
    assert.equal((await listAllCrmOpportunities(facade)).length, oppsBefore);

    // Queue a schedule_review proposal and approve it -> updates company relationship metadata
    const turn3 = await runSalesAgentConversationTurn(facade, {
      conversationId: turn1.conversation.id,
      userMessage: 'Please schedule a relationship review for this account.',
      contextScope: { scopeType: 'company', leadId: lead.id, includePrivateNotes: false },
    });
    assert.equal(turn3.proposedActions.length, 1);
    assert.equal(turn3.proposedActions[0].actionType, 'schedule_review');

    const reviewExec = await approveAndExecuteActionProposal(
      facade,
      turn3.proposedActions[0].id,
      'owner@local'
    );
    assert.equal(reviewExec.proposal.status, 'approved_executed');

    const allProps = await listAiActionProposals(facade, 'all');
    assert.ok(allProps.some((p) => p.status === 'approved_executed'));
    assert.ok(allProps.some((p) => p.status === 'rejected'));
  } finally {
    resetAiOverrides();
    cleanup();
  }
});

// ============================================================================
// 11. RECORD_INTERACTION APPROVAL EXECUTION
// ============================================================================

test('Phase 14: Approving record_interaction proposal logs a real CRM interaction only after owner approval', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(store);
    const lead = makeLead();
    store.upsertLead(lead);
    await updateCompanyRelationshipMeta(facade, lead.id, { relationshipStatus: 'active' });

    const beforeCount = (await listAllCrmInteractions(facade, { leadId: lead.id })).length;

    const toolRes = await executeControlledAgentTool(
      { facade, includePrivateNotes: false },
      'propose_crm_action',
      {
        actionType: 'record_interaction',
        title: 'Log outbound intro call with Nordic Precision Robotics',
        rationale: 'Owner requested logging a brief intro call summary.',
        entityType: 'company',
        entityId: lead.id,
        entityName: lead.companyName,
        proposedChanges: {
          type: 'phone_call',
          summary: 'Introductory qualification call with operations team',
          outcome: 'Agreed to share overview',
        },
      }
    );

    const proposal = (toolRes.data as any).proposal;
    assert.equal(proposal.status, 'pending_approval');
    assert.equal((await listAllCrmInteractions(facade, { leadId: lead.id })).length, beforeCount);

    const executed = await approveAndExecuteActionProposal(facade, proposal.id, 'owner@local');
    assert.equal(executed.proposal.status, 'approved_executed');
    assert.equal((await listAllCrmInteractions(facade, { leadId: lead.id })).length, beforeCount + 1);
  } finally {
    cleanup();
  }
});
