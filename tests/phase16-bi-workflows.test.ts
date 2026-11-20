/**
 * Phase 16 Isolated Test Suite — Business Intelligence, Analytics & Workflow Automation.
 *
 * Strictly isolated: uses temporary StorageManager directories cleaned up in finally blocks.
 * Never touches Neon PostgreSQL, data/pipeline_store.json, or data/owner_auth.json.
 * Never sends real emails or calls external LLM APIs (uses deterministic test hooks).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';

import { StorageManager } from '../server/storage.js';
import {
  createCrmInteraction,
  createCrmOpportunity,
  createCrmStorageFacade,
  createExtendedTask,
  listAllExtendedTasks,
  updateCrmOpportunity,
} from '../server/crm/crmStoreHelper.js';
import { requireOwnerAuth } from '../server/auth/middleware.js';
import { generateCsrfToken, validateCsrf } from '../server/auth/csrf.js';
import { setAiGeneratorOverrideForTests } from '../server/ai/aiProvider.js';
import { executeControlledAgentTool, listAuthorizedAgentTools } from '../server/ai/agentTools.js';
import {
  addSuppressionEntry,
  approveOutreachMessage,
  createOutreachCampaign,
  dispatchApprovedOutreachMessage,
  enrollRecipientsInCampaign,
  generateOutreachMessageDraft,
  markMessageManuallySent,
  updateOutreachProviderSettings,
} from '../server/outreach/outreachService.js';
import { recordOutreachReply } from '../server/outreach/replyManager.js';
import {
  setOutreachEnvOverrideForTests,
  setOutreachProviderTransportForTests,
} from '../server/outreach/providerAbstraction.js';
import { CredentialManager } from '../server/connectors/core/credentialManager.js';
import { buildBiAnalyticsDashboard } from '../server/bi/biAnalyticsService.js';
import {
  BI_WORKFLOW_SETTINGS_KEY,
  getBiWorkflowWorkspaceState,
} from '../server/bi/biWorkflowStoreHelper.js';
import {
  createWorkflowDefinition,
  decideQueuedWorkflowStep,
  deleteWorkflowDefinition,
  dispatchWorkflowEvent,
  evaluateOnDemandTimerWorkflows,
  listWorkflowsWorkspace,
  retryFailedWorkflowExecution,
  setWorkflowActionFailureInjectorForTests,
  toggleWorkflowEnabled,
  validateWorkflowDefinitionInput,
  WorkflowValidationError,
} from '../server/bi/workflowEngine.js';
import {
  deleteSavedBiReportConfig,
  exportBiReportToCsv,
  generateBiReport,
  listSavedBiReports,
  saveBiReportConfig,
} from '../server/bi/reportingService.js';
import { generateBiAiInsights } from '../server/bi/biAiInsightsService.js';
import { registerBiWorkflowRoutes } from '../server/bi/biWorkflowRoutes.js';
import type { CanonicalLead, PersonRecord } from '../server/types.js';

function createIsolatedStorage(): {
  store: StorageManager;
  storePath: string;
  dir: string;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-phase16-'));
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
    storePath,
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore temp cleanup errors
      }
    },
  };
}

function makeLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = '2026-11-18T10:00:00.000Z';
  return {
    id: overrides.id || 'lead-p16-1',
    companyName: overrides.companyName || 'Nordic Precision Marine AS',
    legalName: overrides.legalName || 'Nordic Precision Marine AS',
    registrationNumber: overrides.registrationNumber || '924110221',
    registrationType: overrides.registrationType || 'NO_ORGNR',
    domain: overrides.domain || 'nordicmarine.no',
    website: overrides.website || 'https://nordicmarine.no',
    industry: overrides.industry || 'Maritime Engineering',
    category: overrides.category || 'Marine Equipment',
    currency: overrides.currency || 'EUR',
    email: overrides.email !== undefined ? overrides.email : 'contact@nordicmarine.no',
    emailStatus: overrides.emailStatus || 'verified',
    phone: overrides.phone || '+47 22 44 55 66',
    address: overrides.address || {
      city: 'Oslo',
      country: 'Norway',
      countryCode: 'NO',
    },
    status: overrides.status || 'qualified',
    pipelineStageId: overrides.pipelineStageId || 'stage-qualified',
    confidenceScore: overrides.confidenceScore ?? 90,
    confidenceSignals: overrides.confidenceSignals || ['Official Registry Verified'],
    tags: overrides.tags || ['nordics', 'enterprise'],
    identifiers: overrides.identifiers || [
      {
        type: 'NO_ORGNR',
        value: '924110221',
        source: 'Brønnøysundregistrene',
        verified: true,
      },
    ],
    sources: overrides.sources || [
      {
        sourceName: 'Norway Brreg',
        retrievedAt: now,
      },
    ],
    notes: overrides.notes || [],
    activities: overrides.activities || [],
    customFields: overrides.customFields ?? {
      registryVerificationState: 'officially_verified',
      websiteLastInspectedAt: now,
    },
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    ...overrides,
  };
}

function linkTestPerson(
  store: StorageManager,
  leadId: string,
  overrides: { fullName?: string; email?: string; countryCode?: string } = {}
): PersonRecord {
  const fullName = overrides.fullName || 'Ingrid Solberg';
  const parts = fullName.split(' ');
  const linked = store.linkPersonToLead({
    leadId,
    actorEmail: 'owner@local',
    person: {
      fullName,
      firstName: parts[0],
      lastName: parts[parts.length - 1],
      email: overrides.email ?? 'ingrid.solberg@nordicmarine.no',
      emailStatus: 'verified',
      countryCode: overrides.countryCode || 'NO',
      jobTitle: 'Managing Director',
      department: 'Executive',
      seniority: 'c_suite',
      decisionMakingFunction: 'Executive Leadership',
      relationshipType: 'managing_director',
      isPrimaryContact: true,
      verificationStatus: 'officially_verified',
      confidenceScore: 92,
      relationshipProvenance: { employmentStatus: 'current', isExplicitlyPublished: true },
      customFields: {},
    },
  });
  return linked[0].person;
}

// ============================================================================
// TEST 1: BI METRICS ACCURACY, PIPELINE CALCULATIONS, OUTREACH PROVENANCE & FILTERING
// ============================================================================
test('Phase 16: BI analytics accuracy, pipeline velocity honesty, outreach provenance & filtering', async () => {
  const iso = createIsolatedStorage();
  const prevEnv = process.env.RESEND_API_KEY;
  setAiGeneratorOverrideForTests(async () => JSON.stringify({ subject: 'Intro', body: 'Hello from LEED.' }));
  setOutreachEnvOverrideForTests({ RESEND_API_KEY: 're_test_phase16_key' });
  setOutreachProviderTransportForTests(async () => ({
    status: 200,
    bodyText: JSON.stringify({ id: 're_msg_p16_001' }),
  }));

  try {
    const facade = createCrmStorageFacade(iso.store);
    const now = new Date('2026-11-20T12:00:00.000Z');

    // Lead 1: Verified NO Maritime lead
    const lead1 = makeLead({
      id: 'lead-no-1',
      companyName: 'Nordic Precision Marine AS',
      address: { city: 'Oslo', country: 'Norway', countryCode: 'NO' },
      industry: 'Maritime Engineering',
      pipelineStageId: 'stage-proposal',
      createdAt: '2026-11-01T09:00:00.000Z',
      updatedAt: '2026-11-10T09:00:00.000Z',
    });

    // Lead 2: Unverified GB FinTech lead (declining engagement)
    const lead2 = makeLead({
      id: 'lead-gb-2',
      companyName: 'Thames Ledger Systems Ltd',
      registrationNumber: '',
      email: 'ops@thamesledger.co.uk',
      emailStatus: 'unverified',
      address: { city: 'London', country: 'United Kingdom', countryCode: 'GB' },
      industry: 'FinTech',
      pipelineStageId: 'stage-discovered',
      sources: [
        {
          sourceName: 'CSV Import',
          retrievedAt: '2026-08-01T09:00:00.000Z',
        },
      ],
      identifiers: [],
      customFields: { registryVerificationState: 'unverified' },
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-09-01T09:00:00.000Z',
    });

    iso.store.upsertLead(lead1);
    iso.store.upsertLead(lead2);

    const person1 = linkTestPerson(iso.store, lead1.id, {
      fullName: 'Ingrid Solberg',
      email: 'ingrid@nordicmarine.no',
      countryCode: 'NO',
    });

    // Open opportunity (EUR) -> verify sales velocity is NOT fabricated when 0 won deals
    const oppOpen = await createCrmOpportunity(facade, {
      leadId: lead1.id,
      title: 'Propulsion Telemetry Upgrade',
      estimatedValue: 45000,
      currency: 'EUR',
      pipelineStageId: 'stage-proposal',
      probability: 60,
      status: 'open',
      changedBy: 'Owner',
    });

    const biBeforeWon = await buildBiAnalyticsDashboard(facade, {}, now);
    assert.equal(biBeforeWon.leadIntelligence.totalCompanies, 2);
    assert.equal(biBeforeWon.leadIntelligence.totalDecisionMakers, 1);
    assert.equal(biBeforeWon.leadIntelligence.verifiedLeads, 1);
    assert.equal(biBeforeWon.leadIntelligence.unverifiedLeads, 1);
    assert.equal(biBeforeWon.salesPipeline.dataSource, 'crm_opportunities');
    assert.equal(biBeforeWon.salesPipeline.openOpportunities, 1);
    assert.equal(biBeforeWon.salesPipeline.salesVelocity.available, false);
    assert.ok(biBeforeWon.salesPipeline.salesVelocity.insufficientDataReason);

    // Add a closed-won opportunity -> sales velocity becomes available honestly
    const oppWon = await createCrmOpportunity(facade, {
      leadId: lead2.id,
      title: 'Compliance Audit Suite',
      estimatedValue: 20000,
      currency: 'GBP',
      pipelineStageId: 'stage-won',
      probability: 100,
      status: 'open',
      changedBy: 'Owner',
    });
    await updateCrmOpportunity(facade, oppWon.id, {
      status: 'won',
      changedBy: 'Owner',
    });

    // Add interactions: lead2 had 2 interactions 45 days ago and 0 in last 30d -> declining engagement!
    await createCrmInteraction(facade, {
      leadId: lead2.id,
      type: 'phone_call',
      summary: 'Initial scoping call — discussed roadmap.',
      occurredAt: '2026-10-05T10:00:00.000Z',
      recordedBy: 'Owner',
    });
    await createCrmInteraction(facade, {
      leadId: lead2.id,
      type: 'email',
      summary: 'Sent pricing sheet draft.',
      occurredAt: '2026-10-10T10:00:00.000Z',
      recordedBy: 'Owner',
    });
    await createCrmInteraction(facade, {
      leadId: lead1.id,
      type: 'meeting',
      summary: 'Demo session — strong buyer interest.',
      occurredAt: '2026-11-15T10:00:00.000Z',
      recordedBy: 'Owner',
    });

    // Tasks: 1 completed, 1 overdue
    await createExtendedTask(facade, {
      leadId: lead1.id,
      title: 'Completed prep task',
      dueDate: '2026-11-10T10:00:00.000Z',
      priority: 'medium',
      assignedTo: 'Owner',
      completed: true,
      status: 'completed',
    });
    await createExtendedTask(facade, {
      leadId: lead2.id,
      title: 'Overdue follow-up',
      dueDate: '2026-11-12T10:00:00.000Z',
      priority: 'high',
      assignedTo: 'Owner',
      completed: false,
      status: 'pending',
    });

    // Outreach: 1 provider-confirmed email send + 1 manual LinkedIn send + 1 recorded positive reply
    const credMgr = new CredentialManager();
    await updateOutreachProviderSettings(
      facade,
      {
        defaultEmailProviderId: 'comm-resend',
        fromEmail: 'owner@leed.test',
        fromName: 'LEED Owner',
      },
      'Owner'
    );
    const { campaign: campEmail } = await createOutreachCampaign(facade, {
      name: 'Nordic Maritime Q4',
      channel: 'email',
      mode: 'individual',
      objective: 'Book intro',
      createdBy: 'Owner',
    });
    await enrollRecipientsInCampaign(facade, {
      campaignId: campEmail.id,
      recipients: [{ leadId: lead1.id, personId: person1.id }],
      enrolledBy: 'Owner',
    });
    const draftEmail = await generateOutreachMessageDraft(facade, {
      campaignId: campEmail.id,
      leadId: lead1.id,
      personId: person1.id,
      channel: 'email',
      actor: 'Owner',
    });
    await approveOutreachMessage(facade, draftEmail.id, 'Owner');
    const dispatchRes = await dispatchApprovedOutreachMessage(facade, {
      messageId: draftEmail.id,
      providerId: 'comm-resend',
      actor: 'Owner',
      credentialManager: credMgr,
    });
    assert.equal(dispatchRes.sent, true);

    const { campaign: campLi } = await createOutreachCampaign(facade, {
      name: 'UK FinTech LinkedIn',
      channel: 'linkedin',
      mode: 'individual',
      objective: 'Manual DM',
      createdBy: 'Owner',
    });
    await enrollRecipientsInCampaign(facade, {
      campaignId: campLi.id,
      recipients: [{ leadId: lead2.id }],
      enrolledBy: 'Owner',
    });
    const draftLi = await generateOutreachMessageDraft(facade, {
      campaignId: campLi.id,
      leadId: lead2.id,
      channel: 'linkedin',
      actor: 'Owner',
    });
    await approveOutreachMessage(facade, draftLi.id, 'Owner');
    await markMessageManuallySent(facade, { messageId: draftLi.id, notes: 'Sent manually in LinkedIn', actor: 'Owner' });

    await recordOutreachReply(facade, {
      leadId: lead1.id,
      personId: person1.id,
      campaignId: campEmail.id,
      channel: 'email',
      body: 'Yes, very interested! Let us schedule a call next week.',
      recordedBy: 'Owner',
    });

    const bi = await buildBiAnalyticsDashboard(facade, {}, now);

    // Verify Pipeline metrics & velocity
    assert.equal(bi.salesPipeline.openOpportunities, 1);
    assert.equal(bi.salesPipeline.wonOpportunities, 1);
    assert.equal(bi.salesPipeline.winRatePercent, 100);
    assert.equal(bi.salesPipeline.salesVelocity.available, true);
    assert.equal(bi.salesPipeline.salesVelocity.closedWonSampleSize, 1);
    assert.ok(bi.salesPipeline.openValuesByCurrency.some((c) => c.currency === 'EUR' && c.totalValue === 45000));
    assert.ok(bi.salesPipeline.wonValuesByCurrency.some((c) => c.currency === 'GBP' && c.totalValue === 20000));

    // Verify Outreach provenance separation
    assert.equal(bi.outreachAnalytics.totals.messagesSentViaProvider, 1);
    assert.equal(bi.outreachAnalytics.totals.messagesManualSent, 1);
    assert.equal(bi.outreachAnalytics.totals.repliesReceived, 1);
    assert.equal(bi.outreachAnalytics.metricsWithProvenance.providerConfirmedSent.provenance, 'provider_confirmed');
    assert.equal(bi.outreachAnalytics.metricsWithProvenance.manualExternalSends.provenance, 'manual_owner_recorded');
    assert.equal(bi.outreachAnalytics.metricsWithProvenance.manualRecordedReplies.provenance, 'manual_owner_recorded');
    assert.ok(bi.outreachAnalytics.unavailableMetrics.length >= 3);

    // Verify Activity & Declining Engagement
    assert.equal(bi.activityAnalytics.tasksCompleted, 1);
    assert.equal(bi.activityAnalytics.tasksOverdue, 1);
    assert.ok(
      bi.activityAnalytics.decliningEngagement.some((d) => d.entityType === 'company' && d.id === lead2.id),
      'Thames Ledger should be flagged for declining engagement'
    );

    // Verify Filtering (country = NO -> only lead1, oppOpen)
    const biNorway = await buildBiAnalyticsDashboard(facade, { country: 'NO' }, now);
    assert.equal(biNorway.leadIntelligence.totalCompanies, 1);
    assert.equal(biNorway.leadIntelligence.verifiedLeads, 1);
    assert.equal(biNorway.salesPipeline.totalOpportunities, 1);
    assert.equal(biNorway.salesPipeline.openOpportunities, 1);
    assert.equal(biNorway.salesPipeline.wonOpportunities, 0);

    // Verify Filtering by date range (only November -> excludes August lead2)
    const biNov = await buildBiAnalyticsDashboard(
      facade,
      { dateFrom: '2026-10-15', dateTo: '2026-11-30' },
      now
    );
    assert.equal(biNov.leadIntelligence.totalCompanies, 1);
    assert.equal(oppOpen.leadId, lead1.id);
  } finally {
    setAiGeneratorOverrideForTests(null);
    setOutreachEnvOverrideForTests(null);
    setOutreachProviderTransportForTests(null);
    if (prevEnv !== undefined) process.env.RESEND_API_KEY = prevEnv;
    iso.cleanup();
  }
});

// ============================================================================
// TEST 2: WORKFLOW ENGINE — TRIGGERS, CONDITIONS, ACTIONS, IDEMPOTENCY, DUPLICATE TASKS, RECURSION & TIMERS
// ============================================================================
test('Phase 16: Workflow triggers, conditions, actions, restart-safe idempotency, duplicate task prevention, recursion & timers', async () => {
  const iso = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(iso.store);
    const now = new Date('2026-11-20T12:00:00.000Z');

    const lead = makeLead({
      id: 'lead-wf-1',
      companyName: 'Bergen Offshore Wind AS',
      address: { city: 'Bergen', country: 'Norway', countryCode: 'NO' },
      industry: 'Renewable Energy',
      pipelineStageId: 'stage-qualified',
      tags: ['wind'],
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    });
    iso.store.upsertLead(lead);

    // Create workflow: trigger on lead_created, condition country == NO AND industry contains Renewable
    const wf = await createWorkflowDefinition(
      facade,
      {
        name: 'Norwegian CleanTech Onboarding',
        enabled: true,
        trigger: { type: 'lead_created' },
        conditionLogic: 'all',
        conditions: [
          { field: 'country', operator: 'equals', value: 'NO' },
          { field: 'industry', operator: 'contains', value: 'Renewable' },
        ],
        actions: [
          { type: 'create_task', taskTitle: 'Qualify {{company_name}}', taskPriority: 'high', taskDueInDays: 2 },
          { type: 'add_tag', tag: 'nordic-priority' },
          { type: 'create_owner_notification', notificationTitle: 'New CleanTech Lead', notificationMessage: 'Check {{company_name}}' },
          { type: 'add_activity_record', activityTitle: 'Auto-qualified', activityDescription: 'Matched CleanTech rule' },
          { type: 'generate_ai_recommendation', aiFocus: 'Suggest maritime outreach angle' },
        ],
      },
      'Owner'
    );

    // 1. Dispatch event -> should match & execute all 5 actions
    const runs1 = await dispatchWorkflowEvent(facade, {
      triggerType: 'lead_created',
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      eventKey: 'evt-lead-created-1',
      actor: 'Owner',
      now,
    });
    assert.equal(runs1.length, 1);
    assert.equal(runs1[0].status, 'completed');
    assert.equal(runs1[0].conditionsMatched, true);
    assert.equal(runs1[0].steps.length, 5);
    assert.ok(runs1[0].steps.every((s) => s.status === 'succeeded'));

    const updatedLead = iso.store.getLead(lead.id)!;
    assert.ok(updatedLead.tags.includes('nordic-priority'));
    assert.ok(updatedLead.activities.some((a) => a.title === 'Auto-qualified'));

    const tasksAfter1 = await listAllExtendedTasks(facade, { leadId: lead.id });
    assert.equal(tasksAfter1.length, 1);
    assert.equal(tasksAfter1[0].title, 'Qualify Bergen Offshore Wind AS');

    // 2. Restart-safe idempotency: reload fresh StorageManager from same file and replay same eventKey
    const reloadedStore = new StorageManager(iso.storePath);
    const reloadedFacade = createCrmStorageFacade(reloadedStore);
    const runsReplay = await dispatchWorkflowEvent(reloadedFacade, {
      triggerType: 'lead_created',
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      eventKey: 'evt-lead-created-1',
      actor: 'Owner',
      now,
    });
    assert.equal(runsReplay.length, 1);
    assert.equal(runsReplay[0].status, 'skipped');
    assert.match(runsReplay[0].error || '', /idempotent/i);

    // 3. Duplicate task prevention: dispatch with a NEW eventKey -> task step skipped_duplicate, tag skipped_duplicate
    const runsNewKey = await dispatchWorkflowEvent(reloadedFacade, {
      triggerType: 'lead_created',
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      eventKey: 'evt-lead-created-2',
      actor: 'Owner',
      now,
    });
    assert.equal(runsNewKey[0].steps[0].status, 'skipped_duplicate');
    assert.equal(runsNewKey[0].steps[1].status, 'skipped_duplicate');
    const tasksAfter2 = await listAllExtendedTasks(reloadedFacade, { leadId: lead.id });
    assert.equal(tasksAfter2.length, 1, 'Duplicate open task must never be created');

    // 4. Recursion prevention: depth >= 1 or visitedWorkflowIds must block execution
    const runsDepthBlocked = await dispatchWorkflowEvent(reloadedFacade, {
      triggerType: 'lead_created',
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      eventKey: 'evt-recursive-1',
      executionDepth: 1,
      actor: 'Owner',
      now,
    });
    assert.equal(runsDepthBlocked.length, 0, 'Recursive workflow dispatch at depth >= 1 must be blocked');

    const runsVisitedBlocked = await dispatchWorkflowEvent(reloadedFacade, {
      triggerType: 'lead_created',
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      eventKey: 'evt-visited-1',
      visitedWorkflowIds: [wf.id],
      actor: 'Owner',
      now,
    });
    assert.equal(runsVisitedBlocked.length, 0, 'Visited workflow ID must be blocked from re-entering');

    // 5. On-demand timer triggers: lead_stage_duration (19 days > 7 days) + task_overdue
    await createExtendedTask(reloadedFacade, {
      leadId: lead.id,
      title: 'Send technical dossier',
      dueDate: '2026-11-10T10:00:00.000Z',
      priority: 'high',
      assignedTo: 'Owner',
      completed: false,
      status: 'pending',
    });
    await createWorkflowDefinition(
      reloadedFacade,
      {
        name: 'Stale Qualified Stage Alert',
        enabled: true,
        trigger: { type: 'lead_stage_duration', stageId: 'stage-qualified', durationDays: 7 },
        conditions: [],
        actions: [{ type: 'create_owner_notification', notificationTitle: 'Stale Lead', notificationMessage: '{{company_name}} > 7d' }],
      },
      'Owner'
    );
    await createWorkflowDefinition(
      reloadedFacade,
      {
        name: 'Overdue Task Escalation',
        enabled: true,
        trigger: { type: 'task_overdue' },
        conditions: [{ field: 'assigned_task_status', operator: 'equals', value: 'overdue' }],
        actions: [{ type: 'create_owner_notification', notificationTitle: 'Task Overdue', notificationMessage: 'Check {{company_name}}' }],
      },
      'Owner'
    );

    // At day 0 (immediately after lead was updated by earlier workflow actions), stage duration must NOT prematurely fire
    const timerDay0 = await evaluateOnDemandTimerWorkflows(reloadedFacade, 'Owner', now);
    assert.equal(timerDay0.schedulingMode, 'on_demand');
    assert.equal(timerDay0.stageDurationExecutions.length, 0);
    assert.equal(timerDay0.overdueTaskExecutions.length, 1);
    assert.equal(timerDay0.overdueTaskExecutions[0].status, 'completed');

    // 10 days later (> 7d threshold), stage duration workflow must fire cleanly
    const tenDaysLater = new Date('2026-11-30T12:00:00.000Z');
    const timerDay10 = await evaluateOnDemandTimerWorkflows(reloadedFacade, 'Owner', tenDaysLater);
    assert.equal(timerDay10.stageDurationExecutions.length, 1);
    assert.equal(timerDay10.stageDurationExecutions[0].status, 'completed');

    // Verify internal __bi_workflows_v1 key is stripped from public connector configs
    const publicConfigs = reloadedStore.getConnectorConfigs();
    assert.equal(publicConfigs[BI_WORKFLOW_SETTINGS_KEY], undefined);
  } finally {
    iso.cleanup();
  }
});

// ============================================================================
// TEST 3: OWNER APPROVAL GATES, SUPPRESSION COMPLIANCE & STEP-LEVEL FAILURE RECOVERY
// ============================================================================
test('Phase 16: Owner approval gates, suppression compliance & idempotent step-level failure recovery', async () => {
  const iso = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(iso.store);
    const now = new Date('2026-11-20T12:00:00.000Z');

    const lead = makeLead({
      id: 'lead-safe-1',
      companyName: 'Helvetia Biotech AG',
      email: 'info@helvetiabiotech.ch',
      industry: 'Biotech',
      address: { city: 'Basel', country: 'Switzerland', countryCode: 'CH' },
    });
    iso.store.upsertLead(lead);

    // 1. Approval gate test: update_crm_field must NOT mutate CRM until explicitly approved
    await createWorkflowDefinition(
      facade,
      {
        name: 'Update Industry With Approval',
        enabled: true,
        trigger: { type: 'lead_updated' },
        conditions: [],
        actions: [
          { type: 'update_crm_field', crmField: 'industry', crmValue: 'Life Sciences' },
          { type: 'queue_owner_approval', approvalSummary: 'Verify biotech vertical for {{company_name}}' },
        ],
      },
      'Owner'
    );

    const approvalRuns = await dispatchWorkflowEvent(facade, {
      triggerType: 'lead_updated',
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      eventKey: 'evt-approval-1',
      actor: 'Owner',
      now,
    });
    assert.equal(approvalRuns[0].status, 'awaiting_approval');
    assert.equal(approvalRuns[0].steps[0].status, 'awaiting_owner_approval');
    // Industry must still be Biotech before approval!
    assert.equal(iso.store.getLead(lead.id)?.industry, 'Biotech');

    // Reject step 1 -> stays rejected, does not mutate
    const rejRes = await decideQueuedWorkflowStep(facade, {
      executionId: approvalRuns[0].id,
      stepIndex: 1,
      decision: 'reject',
      actor: 'Owner',
    });
    assert.equal(rejRes.step.status, 'rejected_by_owner');
    assert.equal(iso.store.getLead(lead.id)?.industry, 'Biotech');

    // Approve step 0 -> applies industry update to Life Sciences
    const appRes = await decideQueuedWorkflowStep(facade, {
      executionId: approvalRuns[0].id,
      stepIndex: 0,
      decision: 'approve',
      actor: 'Owner',
    });
    assert.equal(appRes.step.status, 'approved_and_executed');
    assert.equal(appRes.execution.status, 'completed');
    assert.equal(iso.store.getLead(lead.id)?.industry, 'Life Sciences');

    // 2. Suppression compliance: add global do_not_contact suppression -> blocks follow-up & enrichment
    await addSuppressionEntry(facade, {
      scope: 'global',
      type: 'do_not_contact',
      leadId: lead.id,
      email: lead.email,
      reason: 'Owner opted out account',
      createdBy: 'Owner',
    });

    await createWorkflowDefinition(
      facade,
      {
        name: 'Suppressed Guarded Follow-up & Enrichment',
        enabled: true,
        trigger: { type: 'enrichment_completed' },
        conditions: [],
        actions: [
          { type: 'create_follow_up_recommendation', followUpDelayDays: 2, followUpNote: 'Follow up' },
          { type: 'request_enrichment', enrichmentReason: 'Re-enrich contact' },
        ],
      },
      'Owner'
    );

    const suppRuns = await dispatchWorkflowEvent(facade, {
      triggerType: 'enrichment_completed',
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      eventKey: 'evt-supp-1',
      actor: 'Owner',
      now,
    });
    assert.equal(suppRuns[0].steps[0].status, 'blocked_suppressed');
    assert.equal(suppRuns[0].steps[1].status, 'blocked_suppressed');

    // 3. Failure recovery: fail step 2 on attempt 1 while step 1 succeeds -> retry ONLY step 2!
    let step1Executions = 0;
    let step2Attempts = 0;
    const wfRetry = await createWorkflowDefinition(
      facade,
      {
        name: 'Two-Step Recovery Workflow',
        enabled: true,
        trigger: { type: 'opportunity_created' },
        conditions: [],
        actions: [
          { type: 'add_tag', tag: 'step1-ok' },
          { type: 'create_owner_notification', notificationTitle: 'Step 2 Alert', notificationMessage: 'Done' },
        ],
      },
      'Owner'
    );

    setWorkflowActionFailureInjectorForTests((action, attempt) => {
      if (action.type === 'add_tag') {
        step1Executions++;
        return null;
      }
      if (action.type === 'create_owner_notification') {
        step2Attempts++;
        return attempt === 1 ? 'Transient downstream store error' : null;
      }
      return null;
    });

    const partialRuns = await dispatchWorkflowEvent(
      facade,
      {
        triggerType: 'opportunity_created',
        entityType: 'lead',
        entityId: lead.id,
        leadId: lead.id,
        eventKey: 'evt-retry-1',
        actor: 'Owner',
        now,
      },
      { onlyWorkflowId: wfRetry.id }
    );
    assert.equal(partialRuns[0].status, 'partial_failure');
    assert.equal(partialRuns[0].steps[0].status, 'succeeded');
    assert.equal(partialRuns[0].steps[1].status, 'failed');
    assert.equal(step1Executions, 1);
    assert.equal(step2Attempts, 1);

    // Retry failed execution -> must preserve step 0 without re-running it, and succeed on step 1!
    const retried = await retryFailedWorkflowExecution(facade, partialRuns[0].id, 'Owner');
    assert.equal(retried.status, 'completed');
    assert.equal(retried.retryOfExecutionId, partialRuns[0].id);
    assert.equal(retried.steps[0].status, 'succeeded');
    assert.equal(retried.steps[1].status, 'succeeded');
    assert.equal(step1Executions, 1, 'Step 1 must NOT be re-executed during failed-step retry');
    assert.equal(step2Attempts, 2, 'Step 2 must be retried exactly once');
  } finally {
    setWorkflowActionFailureInjectorForTests(null);
    iso.cleanup();
  }
});

// ============================================================================
// TEST 4: REPORTS, SAVED REPORT CONFIGS, RFC 4180 CSV EXPORT & AI BI INSIGHTS + AGENT TOOL
// ============================================================================
test('Phase 16: Standard reports, saved configs, RFC 4180 CSV export, AI BI insights & read-only agent tool', async () => {
  const iso = createIsolatedStorage();
  setAiGeneratorOverrideForTests(async () => {
    throw new Error('Force deterministic fallback');
  });

  try {
    const facade = createCrmStorageFacade(iso.store);
    const lead = makeLead({
      id: 'lead-csv-1',
      companyName: 'Nordic Export AS',
      industry: 'Manufacturing',
      sources: [
        {
          sourceName: '=HYPERLINK("http://evil.test","Acme, Inc.")',
          retrievedAt: '2026-11-18T10:00:00.000Z',
        },
      ],
    });
    iso.store.upsertLead(lead);

    // Generate all 6 standard reports
    for (const reportType of [
      'executive_overview',
      'pipeline_performance',
      'outreach_performance',
      'lead_quality',
      'data_quality',
      'workflow_operations',
    ]) {
      const rep = await generateBiReport(facade, reportType);
      assert.equal(rep.reportType, reportType);
      assert.equal(rep.scheduledDeliveryAvailable, false);
      assert.match(rep.schedulingDisclosure, /on-demand/i);
      assert.ok(Array.isArray(rep.columns) && rep.columns.length > 0);
    }

    // RFC 4180 CSV export + formula injection neutralization on data_quality report
    const dataQualityReport = await generateBiReport(facade, 'data_quality');
    const { filename, csvContent } = exportBiReportToCsv(dataQualityReport);
    assert.match(filename, /^leed_bi_data_quality_\d{4}-\d{2}-\d{2}\.csv$/);
    assert.ok(csvContent.includes("'=HYPERLINK"), 'Formula-prefixed values must be neutralized in CSV');

    // Saved report configs CRUD
    const saved = await saveBiReportConfig(
      facade,
      {
        name: 'Norway Executive View',
        reportType: 'executive_overview',
        filters: { country: 'NO' },
      },
      'Owner'
    );
    const list1 = await listSavedBiReports(facade);
    assert.equal(list1.length, 1);
    assert.equal(list1[0].id, saved.id);
    const deleted = await deleteSavedBiReportConfig(facade, saved.id, 'Owner');
    assert.equal(deleted, true);
    assert.equal((await listSavedBiReports(facade)).length, 0);

    // AI BI Insights: strict separation of Verified Data, Calculated Metrics, Inferences, Recommendations
    const insights = await generateBiAiInsights(facade, { mode: 'daily_briefing' });
    assert.equal(insights.mode, 'daily_briefing');
    assert.ok(insights.verifiedData.length >= 3);
    assert.ok(insights.calculatedMetrics.length >= 4);
    assert.ok(insights.inferences.length >= 1);
    assert.ok(insights.recommendations.length >= 1);
    assert.ok(insights.recommendations.every((r) => r.requiresOwnerAction === true));

    // Read-only AI Agent tool get_bi_analytics_summary
    const tools = listAuthorizedAgentTools();
    const biTool = tools.find((t) => t.name === 'get_bi_analytics_summary');
    assert.ok(biTool);
    assert.equal(biTool.mode, 'read_only');

    const toolRes = await executeControlledAgentTool(
      { facade, includePrivateNotes: false },
      'get_bi_analytics_summary',
      {}
    );
    assert.equal(toolRes.record.success, true);
    assert.equal((toolRes.data as any).leadIntelligence.totalCompanies, 1);
  } finally {
    setAiGeneratorOverrideForTests(null);
    iso.cleanup();
  }
});

// ============================================================================
// TEST 5: ISOLATED HTTP ROUTE TESTS — AUTH, CSRF, 422 PROHIBITED ACTIONS, AUDIT & CSV HEADERS
// ============================================================================
test('Phase 16: Isolated HTTP routes enforce owner auth (401), CSRF (403), 422 safety validation, PG audit & CSV export', async () => {
  const iso = createIsolatedStorage();
  const auditEvents: Array<{ eventType: string; targetType: string; targetId: string }> = [];

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Mount real auth check on /api/unauth/* (must return 401 without session)
  const unauthRouter = express.Router();
  unauthRouter.use(requireOwnerAuth);
  registerBiWorkflowRoutes(unauthRouter, {
    getFacade: () => ({ facade: createCrmStorageFacade(iso.store), isPg: true }),
    aiRateLimitMiddleware: (_req, _res, next) => next(),
    sanitizeApiError: (err, fallback) => (err instanceof Error ? err.message : fallback),
  });
  app.use('/api/unauth', unauthRouter);

  // Mount authenticated owner router with real validateCsrf on /api/*
  const authedRouter = express.Router();
  authedRouter.use((req, _res, next) => {
    req.owner = {
      id: 'owner-test',
      email: 'owner@leed.test',
      fullName: 'Test Owner',
      role: 'owner',
      isActive: true,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    };
    next();
  });
  authedRouter.use(validateCsrf);
  registerBiWorkflowRoutes(authedRouter, {
    getFacade: () => ({ facade: createCrmStorageFacade(iso.store), isPg: true }),
    aiRateLimitMiddleware: (_req, _res, next) => next(),
    sanitizeApiError: (err, fallback) => (err instanceof Error ? err.message : fallback),
    recordPgAuditEvent: async (params) => {
      auditEvents.push({
        eventType: params.eventType,
        targetType: params.targetType,
        targetId: params.targetId,
      });
    },
  });
  app.use('/api', authedRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    iso.store.upsertLead(makeLead({ id: 'lead-http-1', companyName: 'Copenhagen Grid ApS' }));

    // 1. Unauthenticated request -> HTTP 401
    const r401 = await fetch(`${baseUrl}/api/unauth/bi/analytics`);
    assert.equal(r401.status, 401);

    // 2. Missing CSRF token on mutating POST -> HTTP 403
    const r403 = await fetch(`${baseUrl}/api/bi/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No CSRF' }),
    });
    assert.equal(r403.status, 403);

    const csrfToken = generateCsrfToken();
    const csrfHeaders = {
      'Content-Type': 'application/json',
      Cookie: `leed_csrf=${csrfToken}`,
      'X-CSRF-Token': csrfToken,
    };

    // 3. Prohibited actions rejected with HTTP 422 (auto email, auto LinkedIn, delete lead, SQL injection)
    for (const badAction of ['send_email', 'send_linkedin', 'delete_lead', 'execute_sql', 'harvest_contacts']) {
      const rBad = await fetch(`${baseUrl}/api/bi/workflows`, {
        method: 'POST',
        headers: csrfHeaders,
        body: JSON.stringify({
          name: `Blocked ${badAction}`,
          trigger: { type: 'lead_created' },
          conditions: [],
          actions: [{ type: badAction }],
        }),
      });
      assert.equal(rBad.status, 422, `Prohibited action "${badAction}" must be rejected with HTTP 422`);
    }

    // SQL injection payload in workflow description -> HTTP 422
    const rSql = await fetch(`${baseUrl}/api/bi/workflows`, {
      method: 'POST',
      headers: csrfHeaders,
      body: JSON.stringify({
        name: 'SQLi Attempt',
        description: '; DROP TABLE leads; --',
        trigger: { type: 'lead_created' },
        conditions: [],
        actions: [{ type: 'create_owner_notification', notificationTitle: 'Hi', notificationMessage: 'Test' }],
      }),
    });
    assert.equal(rSql.status, 422);

    // Invalid reportType & invalid AI mode -> HTTP 422
    const rBadRep = await fetch(`${baseUrl}/api/bi/reports/generate?reportType=invalid_report`);
    assert.equal(rBadRep.status, 422);
    const rBadAi = await fetch(`${baseUrl}/api/bi/ai/insights`, {
      method: 'POST',
      headers: csrfHeaders,
      body: JSON.stringify({ mode: 'fake_mode' }),
    });
    assert.equal(rBadAi.status, 422);

    // 4. Valid workflow create -> toggle -> dry-run -> delete + verify PG audit events recorded
    const rCreate = await fetch(`${baseUrl}/api/bi/workflows`, {
      method: 'POST',
      headers: csrfHeaders,
      body: JSON.stringify({
        name: 'HTTP Valid Workflow',
        trigger: { type: 'lead_created' },
        conditions: [],
        actions: [{ type: 'create_owner_notification', notificationTitle: 'Hello', notificationMessage: '{{company_name}}' }],
      }),
    });
    assert.equal(rCreate.status, 201);
    const { workflow } = (await rCreate.json()) as any;
    assert.ok(workflow.id);

    const rDry = await fetch(`${baseUrl}/api/bi/workflows/${workflow.id}/test-run`, {
      method: 'POST',
      headers: csrfHeaders,
      body: JSON.stringify({ dryRun: true, leadId: 'lead-http-1' }),
    });
    assert.equal(rDry.status, 200);
    const dryBody = (await rDry.json()) as any;
    assert.equal(dryBody.execution.status, 'dry_run');

    const rToggle = await fetch(`${baseUrl}/api/bi/workflows/${workflow.id}/toggle`, {
      method: 'PATCH',
      headers: csrfHeaders,
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(rToggle.status, 200);

    const rDel = await fetch(`${baseUrl}/api/bi/workflows/${workflow.id}`, {
      method: 'DELETE',
      headers: csrfHeaders,
    });
    assert.equal(rDel.status, 200);

    // 5. CSV export endpoint returns proper headers & body
    const rCsv = await fetch(`${baseUrl}/api/bi/reports/export/csv?reportType=executive_overview`);
    assert.equal(rCsv.status, 200);
    assert.match(rCsv.headers.get('content-type') || '', /text\/csv/i);
    assert.match(rCsv.headers.get('content-disposition') || '', /attachment; filename="leed_bi_executive_overview_/);
    const csvText = await rCsv.text();
    assert.ok(csvText.includes('Total Companies'));

    // Verify PG audit events logged for workflow & export actions
    const eventTypes = auditEvents.map((e) => e.eventType);
    assert.ok(eventTypes.includes('WORKFLOW_CREATED'));
    assert.ok(eventTypes.includes('WORKFLOW_DISABLED'));
    assert.ok(eventTypes.includes('WORKFLOW_DELETED'));
    assert.ok(eventTypes.includes('BI_REPORT_CSV_EXPORTED'));

    // Direct unit check on validateWorkflowDefinitionInput throwing WorkflowValidationError
    assert.throws(
      () => validateWorkflowDefinitionInput({ name: 'Bad', trigger: { type: 'unknown' }, actions: [] }),
      (err: unknown) => err instanceof WorkflowValidationError
    );

    // Verify helper exports remain consistent
    const ws = await listWorkflowsWorkspace(createCrmStorageFacade(iso.store));
    assert.equal(ws.workflows.length, 0);
    const rawWs = await getBiWorkflowWorkspaceState(createCrmStorageFacade(iso.store));
    assert.ok(rawWs.auditLog.length >= 3);
    assert.equal(await deleteWorkflowDefinition(createCrmStorageFacade(iso.store), 'nonexistent', 'Owner'), false);
    await assert.rejects(() => toggleWorkflowEnabled(createCrmStorageFacade(iso.store), 'nonexistent', true, 'Owner'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    iso.cleanup();
  }
});
