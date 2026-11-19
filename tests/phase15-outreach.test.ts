/**
 * Phase 15 Isolated Test Suite — Intelligent Outreach & Follow-Up Automation.
 *
 * Strictly isolated: uses a temporary StorageManager directory (cleaned up in finally).
 * Never writes to Neon PostgreSQL, data/pipeline_store.json, or data/owner_auth.json.
 * Never sends real emails or makes external network calls (deterministic transport & AI hooks).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { StorageManager } from '../server/storage.js';
import {
  createCrmStorageFacade,
  getEntityInteractions,
  listAllCrmInteractions,
} from '../server/crm/crmStoreHelper.js';
import { CredentialManager } from '../server/connectors/core/credentialManager.js';
import { setAiGeneratorOverrideForTests } from '../server/ai/aiProvider.js';
import { listAuthorizedAgentTools, executeControlledAgentTool } from '../server/ai/agentTools.js';
import { upsertIcpProfile } from '../server/ai/aiStoreHelper.js';
import {
  OUTREACH_WORKSPACE_SETTINGS_KEY,
  getOutreachWorkspaceState,
} from '../server/outreach/outreachStoreHelper.js';
import {
  addSuppressionEntry,
  approveOutreachMessage,
  buildOutreachAnalytics,
  cancelOutreachMessage,
  createManualFollowUp,
  createOutreachCampaign,
  deactivateSuppressionEntry,
  dispatchApprovedOutreachMessage,
  editOutreachMessageDraft,
  enrollRecipientsInCampaign,
  generateOutreachMessageDraft,
  getOutreachWorkspaceOverview,
  markMessageManuallySent,
  rejectOutreachMessage,
  transitionEnrollmentStatus,
  updateFollowUpStatus,
  updateOutreachCampaign,
  updateOutreachComplianceConfig,
  updateOutreachProviderSettings,
  upsertOutreachSequence,
} from '../server/outreach/outreachService.js';
import {
  classifyReplyDeterministic,
  recordOutreachReply,
} from '../server/outreach/replyManager.js';
import {
  buildProviderCredentialRequirement,
  listOutreachProviderStatuses,
  redactProviderSecrets,
  setOutreachEnvOverrideForTests,
  setOutreachProviderTransportForTests,
  setOutreachRetryDelayForTests,
} from '../server/outreach/providerAbstraction.js';
import {
  computeBusinessAwareScheduleDate,
  resolveRecipientTimezone,
} from '../server/outreach/followUpScheduler.js';
import type { CanonicalLead, PersonRecord } from '../server/types.js';

function createIsolatedStorage(): {
  store: StorageManager;
  dir: string;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-phase15-'));
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
  const now = '2026-11-19T09:00:00.000Z';
  return {
    id: overrides.id || 'lead-p15-1',
    companyName: overrides.companyName || 'Alpen Industrial Robotics GmbH',
    legalName: overrides.legalName || 'Alpen Industrial Robotics GmbH',
    registrationNumber: overrides.registrationNumber || 'HRB 245120',
    registrationType: overrides.registrationType || 'DE_HRB',
    domain: overrides.domain || 'alpenrobotics.de',
    website: overrides.website || 'https://alpenrobotics.de',
    industry: overrides.industry || 'Industrial Automation',
    category: overrides.category || 'Robotics Manufacturer',
    currency: overrides.currency || 'EUR',
    email: overrides.email !== undefined ? overrides.email : 'partnerships@alpenrobotics.de',
    emailStatus: overrides.emailStatus || 'verified',
    phone: overrides.phone || '+49 89 5550100',
    address: overrides.address || {
      city: 'Munich',
      country: 'Germany',
      countryCode: 'DE',
    },
    status: overrides.status || 'qualified',
    confidenceScore: overrides.confidenceScore ?? 88,
    confidenceSignals: overrides.confidenceSignals || ['Official Registry Verified'],
    tags: overrides.tags || ['automation', 'dach'],
    identifiers: overrides.identifiers || [
      {
        type: 'DE_HRB',
        value: 'HRB 245120',
        countryCode: 'DE',
        verified: true,
        status: 'officially_verified',
      },
    ],
    sources: overrides.sources || [
      {
        sourceName: 'Official Registry',
        retrievedAt: now,
      },
    ],
    notes: overrides.notes || [],
    activities: overrides.activities || [],
    customFields: overrides.customFields || {},
    webMetadata: overrides.webMetadata || {
      title: 'Alpen Industrial Robotics',
      description: 'Precision automated assembly lines for European industrial plants.',
    },
    createdAt: now,
    updatedAt: now,
  };
}

function linkTestPerson(
  store: StorageManager,
  leadId: string,
  overrides: { fullName?: string; email?: string; emailStatus?: PersonRecord['emailStatus']; countryCode?: string } = {}
): PersonRecord {
  const fullName = overrides.fullName || 'Dr. Hannah Weber';
  const parts = fullName.split(' ');
  const linked = store.linkPersonToLead({
    leadId,
    actorEmail: 'owner@local',
    person: {
      fullName,
      firstName: parts[0],
      lastName: parts[parts.length - 1],
      email: overrides.email ?? 'h.weber@alpenrobotics.de',
      emailStatus: overrides.emailStatus || 'verified',
      countryCode: overrides.countryCode || 'DE',
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

test('Phase 15 — 1. Campaign CRUD, lifecycle transitions, sequence editing & ICP targeting', async () => {
  const iso = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(iso.store);
    const icp = await upsertIcpProfile(facade, {
      name: 'DACH Robotics Buyers',
      description: 'Precision industrial robotics companies in Germany/Austria/Switzerland',
      targetIndustries: ['Industrial Automation', 'Robotics'],
      excludedIndustries: [],
      targetCountries: ['DE', 'AT', 'CH'],
      targetBusinessTypes: [],
      targetDecisionMakerRoles: ['CEO', 'Managing Director'],
      minDataQualityScore: 60,
      requireVerifiedContact: false,
    });

    const { campaign, sequence } = await createOutreachCampaign(facade, {
      name: 'Q4 DACH Robotics Outreach',
      objective: 'Explore European distribution partnership',
      mode: 'controlled_batch',
      channel: 'email',
      targetIcpId: icp.id,
      maxFollowUps: 2,
      createdBy: 'Owner',
    });

    assert.equal(campaign.status, 'draft');
    assert.equal(campaign.targetIcpName, 'DACH Robotics Buyers');
    assert.ok(sequence && sequence.steps.length === 2);

    // Edit sequence to 3 steps
    const updatedSeq = await upsertOutreachSequence(
      facade,
      {
        id: sequence.id,
        campaignId: campaign.id,
        name: '3-Step Executive Sequence',
        maxFollowUps: 2,
        businessDaysOnly: true,
        steps: [
          { name: 'Initial Note', delayDays: 0, subjectTemplate: 'Intro — {{company_name}}' },
          { name: 'Follow-Up 1', delayDays: 3, subjectTemplate: 'Following up — {{company_name}}' },
          { name: 'Final Check-In', delayDays: 5, subjectTemplate: 'Closing the loop — {{company_name}}' },
        ],
      },
      'Owner'
    );
    assert.equal(updatedSeq.steps.length, 3);

    // Lifecycle transitions: draft -> active -> paused -> active -> archived
    const active = await updateOutreachCampaign(facade, campaign.id, { status: 'active' }, 'Owner');
    assert.equal(active.status, 'active');

    const paused = await updateOutreachCampaign(facade, campaign.id, { status: 'paused' }, 'Owner');
    assert.equal(paused.status, 'paused');

    const archived = await updateOutreachCampaign(facade, campaign.id, { status: 'archived' }, 'Owner');
    assert.equal(archived.status, 'archived');
    assert.ok(archived.archivedAt);

    // Ensure internal workspace key is stripped from public connectorConfigs view
    const rawSettings = iso.store.getSettings();
    assert.ok((rawSettings.connectorConfigs as any)[OUTREACH_WORKSPACE_SETTINGS_KEY]);
    const sanitizedConfigs = iso.store.getConnectorConfigs();
    assert.equal((sanitizedConfigs as any)[OUTREACH_WORKSPACE_SETTINGS_KEY], undefined);
  } finally {
    iso.cleanup();
  }
});

test('Phase 15 — 2. Enrollment eligibility, duplicate protection, global & campaign suppression enforcement', async () => {
  const iso = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(iso.store);
    const validLead = makeLead({ id: 'lead-ok', companyName: 'Valid Corp', email: 'hello@validcorp.de' });
    const noEmailLead = makeLead({ id: 'lead-noemail', companyName: 'NoEmail Corp', email: '' });
    const dncLead = makeLead({ id: 'lead-dnc', companyName: 'DoNotContact Corp', status: 'do_not_contact', email: 'info@dnc.de' });
    const campSuppressedLead = makeLead({ id: 'lead-csupp', companyName: 'CampSupp Corp', email: 'sales@campsupp.de' });

    iso.store.upsertLead(validLead);
    iso.store.upsertLead(noEmailLead);
    iso.store.upsertLead(dncLead);
    iso.store.upsertLead(campSuppressedLead);

    const { campaign: c1 } = await createOutreachCampaign(facade, {
      name: 'Campaign 1',
      objective: 'Partnership outreach',
      channel: 'email',
      createdBy: 'Owner',
    });
    const { campaign: c2 } = await createOutreachCampaign(facade, {
      name: 'Campaign 2',
      objective: 'Second outreach',
      channel: 'email',
      createdBy: 'Owner',
    });

    // Add campaign-scoped suppression on Campaign 1 only
    await addSuppressionEntry(facade, {
      scope: 'campaign',
      campaignId: c1.id,
      type: 'manual_suppression',
      leadId: campSuppressedLead.id,
      reason: 'Exclude from Campaign 1 only',
      createdBy: 'Owner',
    });

    // Attempt batch enrollment in Campaign 1
    const res1 = await enrollRecipientsInCampaign(facade, {
      campaignId: c1.id,
      recipients: [
        { leadId: validLead.id },
        { leadId: noEmailLead.id },
        { leadId: dncLead.id },
        { leadId: campSuppressedLead.id },
      ],
      enrolledBy: 'Owner',
    });

    assert.equal(res1.enrolled.length, 1);
    assert.equal(res1.enrolled[0].leadId, validLead.id);
    assert.equal(res1.enrolled[0].recipientTimezone, 'Europe/Berlin');
    assert.equal(res1.rejected.length, 3);
    assert.ok(res1.rejected.some((r) => r.leadId === noEmailLead.id && r.rejectedReason?.includes('no email')));
    assert.ok(res1.rejected.some((r) => r.leadId === dncLead.id && r.rejectedReason?.includes('do_not_contact')));
    assert.ok(res1.rejected.some((r) => r.leadId === campSuppressedLead.id && r.rejectedReason?.includes('Campaign suppression')));

    // Duplicate enrollment protection
    const dupRes = await enrollRecipientsInCampaign(facade, {
      campaignId: c1.id,
      recipients: [{ leadId: validLead.id }],
      enrolledBy: 'Owner',
    });
    assert.equal(dupRes.enrolled.length, 0);
    assert.ok(dupRes.rejected[0].rejectedReason?.includes('Duplicate enrollment'));

    // Campaign-scoped suppression from c1 should NOT block c2
    const res2 = await enrollRecipientsInCampaign(facade, {
      campaignId: c2.id,
      recipients: [{ leadId: campSuppressedLead.id }],
      enrolledBy: 'Owner',
    });
    assert.equal(res2.enrolled.length, 1);

    // Global domain suppression blocks c2 immediately and exits active enrollment
    const globalSupp = await addSuppressionEntry(facade, {
      scope: 'global',
      type: 'do_not_contact',
      domain: 'campsupp.de',
      reason: 'Global domain suppression',
      createdBy: 'Owner',
    });
    const wsAfter = await getOutreachWorkspaceState(facade);
    const exited = wsAfter.enrollments.find((e) => e.id === res2.enrolled[0].id);
    assert.equal(exited?.status, 'exited_suppressed');

    // Deactivating suppression works cleanly
    const deactivated = await deactivateSuppressionEntry(facade, globalSupp.id, 'Owner');
    assert.equal(deactivated.active, false);
  } finally {
    iso.cleanup();
  }
});

test('Phase 15 — 3. AI-grounded personalization, evidence separation, anti-hallucination caveats & edit-invalidates-approval', async () => {
  const iso = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(iso.store);
    const lead = makeLead();
    iso.store.upsertLead(lead);
    const person = linkTestPerson(iso.store, lead.id);

    const { campaign } = await createOutreachCampaign(facade, {
      name: 'Precision Outreach',
      objective: 'Introduce modular robotics sensors',
      channel: 'email',
      createdBy: 'Owner',
    });

    setAiGeneratorOverrideForTests(async () =>
      JSON.stringify({
        subject: 'Modular robotics sensors for Alpen Industrial Robotics GmbH',
        body: 'Hello Dr. Hannah Weber,\n\nI noticed Alpen Industrial Robotics GmbH focuses on automated assembly lines in Munich and wanted to explore a potential fit.',
        personalizationEvidence: [
          {
            statement: 'Company operates in Industrial Automation in Munich, Germany.',
            classification: 'source_reported',
            sourceLabel: 'Company Profile',
          },
          {
            statement: 'Modular sensor integration may align with automated assembly lines.',
            classification: 'ai_analysis',
            sourceLabel: 'AI Outreach Analysis',
          },
        ],
        unknownsAndCaveats: ['No prior conversation exists; confirm interest before sharing pricing.'],
      })
    );

    const draft = await generateOutreachMessageDraft(facade, {
      campaignId: campaign.id,
      leadId: lead.id,
      personId: person.id,
      actor: 'Owner',
    });

    assert.equal(draft.status, 'pending_approval');
    assert.equal(draft.aiStatus?.mode, 'ai_assisted');
    assert.equal(draft.contextAudit?.privateNotesAuthorized, false);
    // Compliance unsubscribe footer must be appended deterministically
    assert.ok(draft.body.toLowerCase().includes('unsubscribe'));
    // Evidence strictly separates verified_fact / source_reported / ai_analysis
    assert.ok(draft.personalizationEvidence.some((e) => e.classification === 'verified_fact'));
    assert.ok(draft.personalizationEvidence.some((e) => e.classification === 'ai_analysis'));
    // Caveat honestly notes zero prior interactions
    assert.ok(draft.unknownsAndCaveats.some((c) => c.toLowerCase().includes('no prior')));

    // Approve draft
    const approved = await approveOutreachMessage(facade, draft.id, 'Owner');
    assert.equal(approved.status, 'approved');
    assert.ok(approved.approvedAt);
    assert.equal(approved.approvedBy, 'Owner');

    // Editing an approved draft MUST invalidate prior approval!
    const edited = await editOutreachMessageDraft(
      facade,
      draft.id,
      { subject: 'Updated Subject Line' },
      'Owner'
    );
    assert.equal(edited.status, 'pending_approval');
    assert.equal(edited.approvedAt, undefined);
    assert.equal(edited.approvedBy, undefined);

    // Reject & cancel workflow
    const rejected = await rejectOutreachMessage(facade, draft.id, 'Needs different tone', 'Owner');
    assert.equal(rejected.status, 'rejected');
    const cancelled = await cancelOutreachMessage(facade, draft.id, 'Owner');
    assert.equal(cancelled.status, 'cancelled');
  } finally {
    setAiGeneratorOverrideForTests(null);
    iso.cleanup();
  }
});

test('Phase 15 — 4. Strict sending authorization, zero simulated delivery, LinkedIn policy, idempotency, retries & secret redaction', async () => {
  const iso = createIsolatedStorage();
  try {
    setOutreachRetryDelayForTests(0);
    setOutreachEnvOverrideForTests({
      RESEND_API_KEY: '',
      SENDGRID_API_KEY: '',
      POSTMARK_SERVER_TOKEN: '',
      MAILGUN_API_KEY: '',
      MAILGUN_DOMAIN: '',
      OUTREACH_FROM_EMAIL: '',
    });
    setAiGeneratorOverrideForTests(null); // Use deterministic grounded fallback

    const facade = createCrmStorageFacade(iso.store);
    const lead = makeLead();
    iso.store.upsertLead(lead);
    const person = linkTestPerson(iso.store, lead.id);

    const { campaign } = await createOutreachCampaign(facade, {
      name: 'Email Controlled Dispatch',
      objective: 'Discuss distribution collaboration',
      channel: 'email',
      createdBy: 'Owner',
    });

    const enrollRes = await enrollRecipientsInCampaign(facade, {
      campaignId: campaign.id,
      recipients: [{ leadId: lead.id, personId: person.id }],
      enrolledBy: 'Owner',
    });
    const enrollment = enrollRes.enrolled[0];

    const draft = await generateOutreachMessageDraft(facade, {
      campaignId: campaign.id,
      leadId: lead.id,
      personId: person.id,
      enrollmentId: enrollment.id,
      actor: 'Owner',
    });

    // A) Sending BEFORE approval MUST be refused
    await assert.rejects(
      () =>
        dispatchApprovedOutreachMessage(facade, {
          messageId: draft.id,
          actor: 'Owner',
        }),
      /Explicit owner approval is required/
    );

    // Approve draft
    await approveOutreachMessage(facade, draft.id, 'Owner');

    // B) Sending with NO configured provider MUST NOT simulate delivery!
    const unconfRes = await dispatchApprovedOutreachMessage(facade, {
      messageId: draft.id,
      actor: 'Owner',
    });
    assert.equal(unconfRes.sent, false);
    assert.equal(unconfRes.message.status, 'approved'); // Remains approved, NEVER fake-sent
    assert.equal(unconfRes.message.providerMessageId, undefined);
    assert.ok(unconfRes.error?.includes('No authorized email sending provider'));

    // C) Configure Resend via encrypted CredentialManager vault & sender From Email
    const prevEncKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    process.env.CONNECTOR_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    try {
      const vault = new CredentialManager();
      const secretKey = 're_live_superSecretTestKey123456789';
      const req = buildProviderCredentialRequirement('comm-resend')!;
      await vault.setCredential('comm-resend', { apiKey: secretKey }, req);

      await updateOutreachProviderSettings(
        facade,
        {
          defaultEmailProviderId: 'comm-resend',
          fromEmail: 'owner@leed-verified-domain.com',
          fromName: 'LEED Owner',
          maxRetries: 2,
        },
        'Owner'
      );

      // Verify secret redaction never leaks raw key
      const redacted = redactProviderSecrets(`Upstream failed with key ${secretKey} Bearer ${secretKey}`, [secretKey]);
      assert.ok(!redacted.includes(secretKey));

      // D) Transient 429 retry succeeding on attempt 2 + real providerMessageId + CRM sync + follow-up scheduling
      let callCount = 0;
      let capturedIdempotencyKey = '';
      setOutreachProviderTransportForTests(async (reqArgs) => {
        callCount++;
        capturedIdempotencyKey = reqArgs.headers['Idempotency-Key'] || '';
        if (callCount === 1) {
          return { status: 429, bodyText: `Rate limited using ${secretKey}` };
        }
        return { status: 200, bodyText: JSON.stringify({ id: 'resend-msg-998877' }) };
      });

      const sentRes = await dispatchApprovedOutreachMessage(facade, {
        messageId: draft.id,
        actor: 'Owner',
        credentialManager: vault,
      });

      assert.equal(sentRes.sent, true);
      assert.equal(callCount, 2);
      assert.ok(capturedIdempotencyKey.startsWith('leed-outreach-'));
      assert.equal(sentRes.message.status, 'sent');
      assert.equal(sentRes.message.deliveryMethod, 'provider_api');
      assert.equal(sentRes.message.providerMessageId, 'resend-msg-998877');
      assert.equal(sentRes.message.attemptCount, 2);
      assert.ok(sentRes.message.crmInteractionId);
      // Next sequence follow-up should be scheduled automatically
      assert.ok(sentRes.nextFollowUp);
      assert.equal(sentRes.nextFollowUp?.triggerType, 'no_response');
      assert.equal(sentRes.nextFollowUp?.stepNumber, 2);

      // Verify CRM interaction & campaign attribution persisted
      const updatedLead = iso.store.getLead(lead.id)!;
      assert.equal(updatedLead.status, 'contacted');
      assert.ok(updatedLead.customFields?.outreachCampaignAttribution?.includes(campaign.id));
      const interactions = getEntityInteractions(updatedLead.customFields);
      assert.equal(interactions.length, 1);

      // E) Idempotency: attempting to send the same message or duplicate step again MUST fail
      await assert.rejects(
        () =>
          dispatchApprovedOutreachMessage(facade, {
            messageId: draft.id,
            actor: 'Owner',
            credentialManager: vault,
          }),
        /Explicit owner approval|already been sent/
      );

      // F) LinkedIn manual-only policy MUST block automated dispatch even after approval, while allowing explicit manual external recording
      const { campaign: liCamp } = await createOutreachCampaign(facade, {
        name: 'LinkedIn Executive Notes',
        objective: 'Warm connection request',
        channel: 'linkedin',
        createdBy: 'Owner',
      });
      const liDraft = await generateOutreachMessageDraft(facade, {
        campaignId: liCamp.id,
        leadId: lead.id,
        personId: person.id,
        actor: 'Owner',
      });
      await approveOutreachMessage(facade, liDraft.id, 'Owner');
      await assert.rejects(
        () =>
          dispatchApprovedOutreachMessage(facade, {
            messageId: liDraft.id,
            actor: 'Owner',
            credentialManager: vault,
          }),
        /Automated sending is disabled for channel "linkedin"/
      );

      const manualRes = await markMessageManuallySent(facade, {
        messageId: liDraft.id,
        notes: 'Sent manually via LinkedIn web app',
        actor: 'Owner',
      });
      assert.equal(manualRes.message.status, 'manual_sent');
      assert.equal(manualRes.message.deliveryMethod, 'manual_external');

      // G) Provider hard failure (422 bounce) records redacted error and schedules failed_delivery follow-up
      setOutreachProviderTransportForTests(async () => ({
        status: 422,
        bodyText: `Invalid recipient mailbox with key ${secretKey}`,
      }));
      const failDraft = await generateOutreachMessageDraft(facade, {
        campaignId: campaign.id,
        leadId: lead.id,
        personId: person.id,
        stepNumber: 3,
        actor: 'Owner',
      });
      // Verify default 14-day per-person frequency guardrail blocks a 3rd contact
      await assert.rejects(
        () => approveOutreachMessage(facade, failDraft.id, 'Owner'),
        /Person contact frequency limit reached/
      );
      // Raise frequency cap so approval succeeds and dispatch exercises the provider 422 bounce path
      await updateOutreachComplianceConfig(facade, { maxContactsPerCompanyPerWeek: 10, maxContactsPerPersonPer14Days: 10 }, 'Owner');
      await approveOutreachMessage(facade, failDraft.id, 'Owner');
      const failRes = await dispatchApprovedOutreachMessage(facade, {
        messageId: failDraft.id,
        actor: 'Owner',
        credentialManager: vault,
      });
      assert.equal(failRes.sent, false);
      assert.equal(failRes.message.status, 'failed');
      assert.equal(failRes.message.deliveryStatus, 'bounced');
      assert.ok(!failRes.message.lastError?.includes(secretKey));
    } finally {
      if (prevEncKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
      else process.env.CONNECTOR_ENCRYPTION_KEY = prevEncKey;
    }
  } finally {
    setOutreachProviderTransportForTests(null);
    setOutreachEnvOverrideForTests(null);
    setOutreachRetryDelayForTests(null);
    iso.cleanup();
  }
});

test('Phase 15 — 5. Follow-up scheduling (business days, timezone, triggers, frequency caps) & 7-category reply manager with unsubscribe auto-suppression', async () => {
  const iso = createIsolatedStorage();
  try {
    const facade = createCrmStorageFacade(iso.store);
    const lead = makeLead({ id: 'lead-rep-1', companyName: 'Helvetia MedTech AG', email: 'info@helvetia.ch', address: { city: 'Zurich', country: 'Switzerland', countryCode: 'CH' } });
    iso.store.upsertLead(lead);
    const person = linkTestPerson(iso.store, lead.id, { fullName: 'Lukas Meyer', email: 'l.meyer@helvetia.ch', countryCode: 'CH' });

    // Business-day scheduling skips Saturday/Sunday
    // 2026-11-20 is Friday; +1 business day MUST land on Monday 2026-11-23
    const fri = new Date('2026-11-20T10:00:00.000Z');
    const sched = computeBusinessAwareScheduleDate({
      baseDate: fri,
      delayDays: 1,
      businessDaysOnly: true,
      sendWindowStartHour: 9,
      recipientTimezone: resolveRecipientTimezone(undefined, 'CH'),
    });
    assert.equal(sched.businessDayAdjusted, true);
    assert.equal(new Date(sched.scheduledFor).getUTCDay(), 1); // Monday
    assert.equal(resolveRecipientTimezone(undefined, 'CH'), 'Europe/Zurich');

    // Verify all 7 deterministic reply classifications
    assert.equal(classifyReplyDeterministic('Please unsubscribe me from future emails.').classification, 'unsubscribe');
    assert.equal(classifyReplyDeterministic('Let us schedule a call next Tuesday at 2pm!').classification, 'meeting_interest');
    assert.equal(classifyReplyDeterministic('No thanks, we are not interested at this time.').classification, 'negative');
    assert.equal(classifyReplyDeterministic('Please reach out to Maria who handles this for our team.').classification, 'referral');
    assert.equal(classifyReplyDeterministic('Could you send more information and pricing details?').classification, 'information_request');
    assert.equal(classifyReplyDeterministic('Thanks for reaching out, sounds great!').classification, 'positive');
    assert.equal(classifyReplyDeterministic('Received your note.').classification, 'unknown');

    // Enroll + schedule manual follow-up + record meeting_interest reply
    const { campaign } = await createOutreachCampaign(facade, {
      name: 'Swiss MedTech Outreach',
      objective: 'Clinical logistics collaboration',
      channel: 'email',
      createdBy: 'Owner',
    });
    const { enrolled } = await enrollRecipientsInCampaign(facade, {
      campaignId: campaign.id,
      recipients: [{ leadId: lead.id, personId: person.id }],
      enrolledBy: 'Owner',
    });
    const enr = enrolled[0];

    const manualFup = await createManualFollowUp(facade, {
      leadId: lead.id,
      personId: person.id,
      campaignId: campaign.id,
      enrollmentId: enr.id,
      triggerType: 'owner_requested',
      delayDays: 2,
      actor: 'Owner',
    });
    assert.equal(manualFup.scheduled, true);

    const meetingReply = await recordOutreachReply(facade, {
      leadId: lead.id,
      personId: person.id,
      campaignId: campaign.id,
      enrollmentId: enr.id,
      subject: 'Re: Clinical logistics collaboration',
      body: 'This looks relevant — can we schedule a call next week?',
      recordedBy: 'Owner',
    });
    assert.equal(meetingReply.reply.classification, 'meeting_interest');
    assert.equal(meetingReply.reply.source, 'manual_owner_recorded');
    assert.equal(meetingReply.exitedEnrollmentIds.length, 1);
    assert.ok(meetingReply.followUp && meetingReply.followUp.triggerType === 'meeting_requested');

    // Record unsubscribe reply on a second company -> must create global suppression, cancel pending drafts, and set lead do_not_contact
    const optOutLead = makeLead({ id: 'lead-optout', companyName: 'OptOut GmbH', email: 'hello@optout.de' });
    iso.store.upsertLead(optOutLead);
    await enrollRecipientsInCampaign(facade, {
      campaignId: campaign.id,
      recipients: [{ leadId: optOutLead.id }],
      enrolledBy: 'Owner',
    });
    const pendingDraft = await generateOutreachMessageDraft(facade, {
      campaignId: campaign.id,
      leadId: optOutLead.id,
      actor: 'Owner',
    });

    const unsubRes = await recordOutreachReply(facade, {
      leadId: optOutLead.id,
      campaignId: campaign.id,
      body: 'Please remove me and unsubscribe immediately.',
      recordedBy: 'Owner',
    });
    assert.equal(unsubRes.reply.classification, 'unsubscribe');
    assert.equal(unsubRes.suppressionCreated, true);
    assert.equal(iso.store.getLead(optOutLead.id)?.status, 'do_not_contact');

    const wsAfter = await getOutreachWorkspaceState(facade);
    const cancelledDraft = wsAfter.messages.find((m) => m.id === pendingDraft.id);
    assert.equal(cancelledDraft?.status, 'cancelled');

    // Any subsequent follow-up or draft for opted-out company MUST be blocked
    const blockedFup = await createManualFollowUp(facade, {
      leadId: optOutLead.id,
      triggerType: 'owner_requested',
      actor: 'Owner',
    });
    assert.equal(blockedFup.scheduled, false);
    assert.ok(blockedFup.skippedReason?.includes('blocked by suppression'));

    // CRM interactions exist and are deduplicated
    const allInteractions = await listAllCrmInteractions(facade, { leadId: lead.id });
    assert.equal(allInteractions.length, 1);

    // Follow-up status update & enrollment status transition
    if (meetingReply.followUp) {
      const done = await updateFollowUpStatus(facade, meetingReply.followUp.id, { status: 'completed' }, 'Owner');
      assert.equal(done.status, 'completed');
    }
    const pausedEnr = await transitionEnrollmentStatus(facade, enr.id, 'cancelled', 'Manual close', 'Owner');
    assert.equal(pausedEnr.status, 'cancelled');
  } finally {
    iso.cleanup();
  }
});

test('Phase 15 — 6. Honest analytics, unavailable metrics disclosure, provider statuses & AI agent security boundary', async () => {
  const iso = createIsolatedStorage();
  try {
    setOutreachEnvOverrideForTests({
      RESEND_API_KEY: '',
      SENDGRID_API_KEY: '',
      POSTMARK_SERVER_TOKEN: '',
      MAILGUN_API_KEY: '',
      MAILGUN_DOMAIN: '',
      OUTREACH_FROM_EMAIL: '',
    });

    const facade = createCrmStorageFacade(iso.store);
    const overview = await getOutreachWorkspaceOverview(facade);

    // Zero fake metrics on empty workspace; rates must be null when 0 dispatched
    assert.equal(overview.analytics.totals.campaignsTotal, 0);
    assert.equal(overview.analytics.totals.messagesTotalDispatched, 0);
    assert.equal(overview.analytics.rates.replyRatePercent, null);
    assert.equal(overview.analytics.rates.positiveResponseRatePercent, null);
    assert.equal(overview.analytics.rates.meetingConversionRatePercent, null);
    assert.equal(overview.analytics.rates.optOutRatePercent, null);

    // Must explicitly declare untracked / unavailable metrics
    assert.ok(overview.analytics.unavailableMetrics.some((m) => m.metric.includes('Open Rate')));
    assert.ok(overview.analytics.unavailableMetrics.some((m) => m.metric.includes('Click-Through')));
    assert.ok(overview.analytics.unavailableMetrics.some((m) => m.metric.includes('Inbound Reply Sync')));

    // Providers honestly report unconfigured & LinkedIn policy_manual_only
    const providers = await listOutreachProviderStatuses(overview.workspace);
    const resend = providers.find((p) => p.id === 'comm-resend');
    const linkedin = providers.find((p) => p.id === 'comm-linkedin-manual');
    assert.equal(resend?.configured, false);
    assert.equal(resend?.healthState, 'unconfigured');
    assert.equal(linkedin?.automatedSendingSupported, false);
    assert.equal(linkedin?.healthState, 'policy_manual_only');

    // Security boundary: AI Sales Agent tools must NOT include any automated sending or approval bypass tool
    const tools = listAuthorizedAgentTools();
    assert.ok(!tools.some((t) => /send|dispatch|approve/i.test(t.name)));
    await assert.rejects(
      () =>
        executeControlledAgentTool(
          { facade, includePrivateNotes: false },
          'dispatch_outreach_email',
          {}
        ),
      /Unauthorized AI tool requested/
    );

    // Analytics calculation sanity check with buildOutreachAnalytics
    const recheck = buildOutreachAnalytics(overview.workspace);
    assert.equal(recheck.totals.optOutsAndSuppressions, 0);
  } finally {
    setOutreachEnvOverrideForTests(null);
    iso.cleanup();
  }
});
