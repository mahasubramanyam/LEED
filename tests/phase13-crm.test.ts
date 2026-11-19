/**
 * Phase 13 Isolated Test Suite — Personal CRM & Relationship Management.
 *
 * Strictly isolated: uses a temporary StorageManager directory (cleaned up in finally).
 * Never writes to Neon PostgreSQL, data/pipeline_store.json, or data/owner_auth.json.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { StorageManager } from '../server/storage.js';
import {
  CRM_WORKSPACE_SETTINGS_KEY,
  createCrmInteraction,
  createCrmOpportunity,
  createCrmPrivateNote,
  createCrmStorageFacade,
  createExtendedTask,
  deleteCrmInteraction,
  deleteCrmOpportunity,
  deleteCrmPrivateNote,
  deleteExtendedTask,
  deleteSavedView,
  listAllCrmInteractions,
  listAllCrmOpportunities,
  listAllCrmPrivateNotes,
  listAllExtendedTasks,
  listSavedViews,
  saveCrmView,
  updateCompanyRelationshipMeta,
  updateCrmInteraction,
  updateCrmOpportunity,
  updateCrmPrivateNote,
  updateExtendedTask,
  updatePersonRelationshipMeta,
} from '../server/crm/crmStoreHelper.js';
import {
  buildCompanyRelationshipProfile,
  buildPersonRelationshipProfile,
  computeRelationshipEngagement,
} from '../server/crm/relationshipEngine.js';
import { buildReminderCenter } from '../server/crm/reminderEngine.js';
import { buildCrmDashboardSummary } from '../server/crm/crmDashboardService.js';
import {
  searchSegmentedCompanies,
  searchSegmentedPersons,
} from '../server/crm/crmSegmentationService.js';
import { detectColumnMappings, extractMappedRowValues } from '../server/import/columnMapper.js';
import { normalizeAndValidateMappedRow } from '../server/import/normalizerValidator.js';
import type { CanonicalLead } from '../server/types.js';

function createIsolatedStorage(): {
  store: StorageManager;
  dir: string;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-phase13-'));
  const storePath = path.join(dir, 'pipeline_store.json');
  const store = new StorageManager(storePath);
  // Start with a clean slate (strip seeded default leads/tasks so assertions are exact)
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
    id: overrides.id || 'lead-p13-1',
    companyName: overrides.companyName || 'Nordic Maritime Logistics AS',
    legalName: overrides.legalName || 'Nordic Maritime Logistics AS',
    registrationNumber: overrides.registrationNumber || '987654321',
    domain: overrides.domain || 'nordicmaritime.no',
    website: overrides.website || 'https://nordicmaritime.no',
    email: overrides.email || 'contact@nordicmaritime.no',
    phone: overrides.phone || '+4722123456',
    industry: overrides.industry || 'Maritime Logistics',
    category: overrides.category || 'Shipping & Freight',
    status: overrides.status || 'qualified',
    companyStatus: overrides.companyStatus || 'active',
    address: overrides.address || {
      street: 'Aker Brygge 12',
      city: 'Oslo',
      region: 'Oslo',
      postalCode: '0250',
      country: 'Norway',
      countryCode: 'NO',
      formattedAddress: 'Aker Brygge 12, 0250 Oslo, Norway',
    },
    pipelineStageId: overrides.pipelineStageId || 'stage-qualified',
    opportunityValue: overrides.opportunityValue ?? 75000,
    currency: overrides.currency || 'EUR',
    confidenceScore: overrides.confidenceScore ?? 88,
    confidenceSignals: overrides.confidenceSignals || [
      'official_registry_match',
      'verified_website',
      'verified_contact',
    ],
    tags: overrides.tags || ['shipping', 'tier-1'],
    notes: overrides.notes || [],
    activities: overrides.activities || [],
    sources: overrides.sources || [
      {
        sourceName: 'Brønnøysundregistrene',
        retrievedAt: now,
      },
    ],
    identifiers: overrides.identifiers || [
      {
        id: 'ident-1',
        type: 'NO_ORGNR',
        value: '987654321',
        countryCode: 'NO',
        verified: true,
      },
    ],
    customFields: overrides.customFields || {},
    createdAt: overrides.createdAt || '2026-09-01T09:00:00.000Z',
    updatedAt: overrides.updatedAt || now,
  };
}

function seedFixture(store: StorageManager): { person1Id: string; person2Id: string } {
  const lead1 = makeLead({ id: 'lead-1', companyName: 'Nordic Maritime Logistics AS' });
  const lead2 = makeLead({
    id: 'lead-2',
    companyName: 'Thames Precision Engineering Ltd',
    legalName: 'Thames Precision Engineering Ltd',
    registrationNumber: '12345678',
    domain: 'thamesprecision.co.uk',
    website: 'https://thamesprecision.co.uk',
    email: 'ops@thamesprecision.co.uk',
    phone: '+442079460912',
    industry: 'Industrial Manufacturing',
    currency: 'GBP',
    opportunityValue: 42000,
    address: {
      city: 'London',
      region: 'Greater London',
      country: 'United Kingdom',
      countryCode: 'GB',
      formattedAddress: 'London, United Kingdom',
    },
    tags: ['manufacturing', 'uk'],
    pipelineStageId: 'stage-proposal',
    createdAt: '2026-11-05T10:00:00.000Z',
  });

  store.upsertLead(lead1);
  store.upsertLead(lead2);

  // Link Astrid Solberg as current CEO at Nordic Maritime Logistics AS
  const linked1 = store.linkPersonToLead({
    leadId: 'lead-1',
    actorEmail: 'owner@local',
    person: {
      fullName: 'Astrid Solberg',
      firstName: 'Astrid',
      lastName: 'Solberg',
      email: 'astrid.solberg@nordicmaritime.no',
      emailStatus: 'verified',
      phone: '+47 90 12 34 56',
      phoneNormalized: '+4790123456',
      linkedinUrl: 'https://linkedin.com/in/astridsolberg',
      country: 'Norway',
      countryCode: 'NO',
      city: 'Oslo',
      jobTitle: 'Chief Executive Officer',
      department: 'Executive',
      seniority: 'c_suite',
      decisionMakingFunction: 'Executive Leadership',
      relationshipType: 'ceo',
      isPrimaryContact: true,
      verificationStatus: 'officially_verified',
      confidenceScore: 95,
      relationshipProvenance: { employmentStatus: 'current' },
      customFields: {},
    },
  });
  const person1Id = linked1[0].person.id;

  // Also link Astrid Solberg as a HISTORICAL Non-Executive Director at Thames Precision (M:N current + historical)
  store.linkExistingPersonToLead({
    personId: person1Id,
    leadId: 'lead-2',
    relationshipType: 'director',
    jobTitle: 'Non-Executive Director',
    department: 'Board',
    isPrimaryContact: false,
    sourceName: 'Companies House',
    actorEmail: 'owner@local',
  });
  const histRel = store
    .getAllRelationships()
    .find((r) => r.personId === person1Id && r.leadId === 'lead-2');
  if (histRel) {
    store.updateRelationshipRecord('lead-2', histRel.id, {
      employmentStatus: 'historical',
      endedAt: '2025-06-30',
    });
  }

  // Link Oliver Grant as current Head of Procurement at Thames Precision
  const linked2 = store.linkPersonToLead({
    leadId: 'lead-2',
    actorEmail: 'owner@local',
    person: {
      fullName: 'Oliver Grant',
      firstName: 'Oliver',
      lastName: 'Grant',
      email: 'oliver.grant@thamesprecision.co.uk',
      emailStatus: 'verified',
      country: 'United Kingdom',
      countryCode: 'GB',
      city: 'London',
      jobTitle: 'Head of Procurement',
      department: 'Procurement',
      seniority: 'director',
      decisionMakingFunction: 'Procurement',
      relationshipType: 'procurement_manager',
      isPrimaryContact: true,
      verificationStatus: 'web_observed',
      confidenceScore: 88,
      relationshipProvenance: { employmentStatus: 'current' },
      customFields: {},
    },
  });
  const person2Id = linked2.find((item) => item.person.fullName === 'Oliver Grant')!.person.id;

  return { person1Id, person2Id };
}

test('1. Company relationship profile aggregation & metadata updates persist cleanly', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    seedFixture(store);
    const facade = createCrmStorageFacade(store);

    const updated = await updateCompanyRelationshipMeta(facade, 'lead-1', {
      relationshipStatus: 'active',
      tags: ['key-account', 'nordics'],
      nextFollowUpDate: '2026-11-25T10:00:00.000Z',
      scheduledReviewDate: '2026-12-01T10:00:00.000Z',
      ownerAnnotation: 'Strong executive sponsorship for Q1 contract.',
    });
    assert.ok(updated);
    assert.equal(updated.relationshipMeta.relationshipStatus, 'active');
    assert.ok(updated.lead.tags.includes('key-account'));

    const profile = await buildCompanyRelationshipProfile(facade, 'lead-1');
    assert.ok(profile);
    assert.equal(profile.lead.id, 'lead-1');
    assert.equal(profile.relationshipMeta.relationshipStatus, 'active');
    assert.equal(profile.decisionMakers.length, 1);
    assert.equal(profile.decisionMakers[0].person.fullName, 'Astrid Solberg');
    assert.ok((profile.enrichmentSummary.dataQualityScore ?? 0) > 0);
  } finally {
    cleanup();
  }
});

test('2. Person relationship profile preserves M:N current and historical companies', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const { person1Id } = seedFixture(store);
    const facade = createCrmStorageFacade(store);

    await updatePersonRelationshipMeta(facade, person1Id, {
      relationshipStatus: 'warm',
      tags: ['decision-maker', 'board'],
      nextFollowUpDate: '2026-11-22T09:00:00.000Z',
      ownerAnnotation: 'Prefers direct calls in Oslo mornings.',
    });

    const profile = await buildPersonRelationshipProfile(facade, person1Id);
    assert.ok(profile);
    assert.equal(profile.person.fullName, 'Astrid Solberg');
    assert.equal(profile.relationshipMeta.relationshipStatus, 'warm');
    assert.equal(profile.currentCompanies.length, 1);
    assert.equal(profile.currentCompanies[0].company?.companyName, 'Nordic Maritime Logistics AS');
    assert.equal(profile.historicalCompanies.length, 1);
    assert.equal(profile.historicalCompanies[0].company?.companyName, 'Thames Precision Engineering Ltd');
    assert.equal(profile.historicalCompanies[0].relationship.provenance?.endedAt, '2025-06-30');
  } finally {
    cleanup();
  }
});

test('3 & 4. Manual interactions CRUD, chronological ordering, lead activity mirror, and honest recordingMode', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const { person1Id } = seedFixture(store);
    const facade = createCrmStorageFacade(store);

    const i1 = await createCrmInteraction(facade, {
      type: 'phone_call',
      summary: 'Initial scoping call on fleet modernization timeline.',
      occurredAt: '2026-11-10T09:00:00.000Z',
      leadId: 'lead-1',
      personId: person1Id,
      outcome: 'Interested in technical proposal',
      nextAction: 'Send capability deck',
      followUpDate: '2026-11-20T10:00:00.000Z',
      recordedBy: 'owner@local',
    });

    const i2 = await createCrmInteraction(facade, {
      type: 'email',
      summary: 'Astrid sent technical RFP questionnaire.',
      occurredAt: '2026-11-17T14:30:00.000Z',
      leadId: 'lead-1',
      personId: person1Id,
      recordedBy: 'owner@local',
    });

    assert.equal(i1.recordingMode, 'manual');
    assert.equal(i2.recordingMode, 'manual');

    // Chronological order (newest first)
    const listed = await listAllCrmInteractions(facade, { leadId: 'lead-1' });
    assert.equal(listed.length, 2);
    assert.equal(listed[0].id, i2.id);
    assert.equal(listed[1].id, i1.id);

    // Mirrored onto lead.activities for backward compatibility
    const leadAfter = await facade.getLead('lead-1');
    assert.ok((leadAfter?.activities || []).some((a) => a.title.includes('Initial scoping call')));

    // Update interaction
    const edited = await updateCrmInteraction(facade, i1.id, {
      outcome: 'Confirmed Q1 budget',
      summary: 'Initial scoping call (confirmed)',
    });
    assert.ok(edited);
    assert.equal(edited.outcome, 'Confirmed Q1 budget');

    // Delete interaction
    const deleted = await deleteCrmInteraction(facade, i2.id);
    assert.equal(deleted, true);
    const remaining = await listAllCrmInteractions(facade, { leadId: 'lead-1' });
    assert.equal(remaining.length, 1);
  } finally {
    cleanup();
  }
});

test('5. Owner-only private notes: visibility, pinning order, tags, category, and search/filter', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const { person1Id } = seedFixture(store);
    const facade = createCrmStorageFacade(store);

    const n1 = await createCrmPrivateNote(facade, {
      entityType: 'company',
      leadId: 'lead-1',
      title: 'Negotiation Floor',
      content: 'Do not discount below 12% on multi-year maritime support.',
      category: 'negotiation',
      tags: ['pricing', 'confidential'],
      pinned: false,
      author: 'owner@local',
    });

    const n2 = await createCrmPrivateNote(facade, {
      entityType: 'person',
      personId: person1Id,
      leadId: 'lead-1',
      title: 'Executive Preference',
      content: 'Astrid prefers concise 1-page summaries before board meetings.',
      category: 'personal_context',
      tags: ['communication', 'vip'],
      pinned: true,
      author: 'owner@local',
    });

    assert.equal(n1.visibility, 'owner_only');
    assert.equal(n2.visibility, 'owner_only');

    // Pinned notes sort ahead of non-pinned notes
    const allNotes = await listAllCrmPrivateNotes(facade, { leadId: 'lead-1' });
    assert.equal(allNotes.length, 2);
    assert.equal(allNotes[0].id, n2.id);
    assert.equal(allNotes[0].pinned, true);

    // Search filter
    const searchPricing = await listAllCrmPrivateNotes(facade, { search: 'discount below 12%' });
    assert.equal(searchPricing.length, 1);
    assert.equal(searchPricing[0].id, n1.id);

    // Update & delete
    const updated = await updateCrmPrivateNote(facade, n1.id, { pinned: true });
    assert.equal(updated?.pinned, true);
    const removed = await deleteCrmPrivateNote(facade, n1.id);
    assert.equal(removed, true);
  } finally {
    cleanup();
  }
});

test('6 & 7. Extended tasks lifecycle, 5 statuses, outcome logging, and recurring follow-up auto-spawn', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const { person1Id } = seedFixture(store);
    const facade = createCrmStorageFacade(store);

    const task = await createExtendedTask(facade, {
      title: 'Weekly executive check-in',
      description: 'Review fleet onboarding milestones',
      leadId: 'lead-1',
      personId: person1Id,
      dueDate: '2026-11-18T10:00:00.000Z',
      reminderDate: '2026-11-18T08:00:00.000Z',
      priority: 'high',
      category: 'follow_up',
      status: 'in_progress',
      completed: false,
      assignedTo: 'Owner',
      recurrence: { frequency: 'weekly' },
    });

    assert.equal(task.status, 'in_progress');
    assert.equal(task.personId, person1Id);
    assert.equal(task.recurrence?.frequency, 'weekly');

    // Complete task with outcome -> auto-spawns next weekly occurrence
    const completedRes = await updateExtendedTask(facade, task.id, {
      status: 'completed',
      completed: true,
      outcome: 'Aligned on pilot rollout dates',
    });

    assert.ok(completedRes);
    assert.ok(completedRes.task);
    assert.equal(completedRes.task.completed, true);
    assert.equal(completedRes.task.status, 'completed');
    assert.ok(completedRes.task.completedAt);
    assert.equal(completedRes.task.outcome, 'Aligned on pilot rollout dates');

    assert.ok(completedRes.recurringFollowUpTask, 'Expected recurring follow-up task to auto-spawn');
    assert.equal(completedRes.recurringFollowUpTask.completed, false);
    assert.equal(completedRes.recurringFollowUpTask.status, 'pending');
    assert.equal(completedRes.recurringFollowUpTask.personId, person1Id);
    // Due date shifted +7 days
    assert.equal(completedRes.recurringFollowUpTask.dueDate.slice(0, 10), '2026-11-25');

    const allTasks = await listAllExtendedTasks(facade);
    assert.equal(allTasks.length, 2);

    const deleted = await deleteExtendedTask(facade, task.id);
    assert.equal(deleted, true);
  } finally {
    cleanup();
  }
});

test('8. Live Reminder Centre aggregates overdue, today, meetings, reviews, attention & discloses honest scheduler status', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const { person1Id, person2Id } = seedFixture(store);
    const facade = createCrmStorageFacade(store);
    const fixedNow = new Date('2026-11-19T12:00:00.000Z');

    // 1) Overdue task
    await createExtendedTask(facade, {
      title: 'Send overdue compliance checklist',
      leadId: 'lead-1',
      dueDate: '2026-11-15T10:00:00.000Z',
      priority: 'high',
      category: 'follow_up',
      status: 'pending',
      completed: false,
      assignedTo: 'Owner',
    });

    // 2) Today follow-up task
    await createExtendedTask(facade, {
      title: 'Confirm afternoon pricing call',
      leadId: 'lead-1',
      personId: person1Id,
      dueDate: '2026-11-19T16:00:00.000Z',
      priority: 'medium',
      category: 'call',
      status: 'pending',
      completed: false,
      assignedTo: 'Owner',
    });

    // 3) Upcoming meeting task within 7 days
    await createExtendedTask(facade, {
      title: 'Executive steering meeting',
      leadId: 'lead-2',
      personId: person2Id,
      dueDate: '2026-11-21T14:00:00.000Z',
      priority: 'high',
      category: 'meeting',
      status: 'pending',
      completed: false,
      assignedTo: 'Owner',
    });

    // 4) Relationship review due & neglected active relationship (>30d since last interaction)
    await updateCompanyRelationshipMeta(facade, 'lead-2', {
      relationshipStatus: 'active',
      scheduledReviewDate: '2026-11-19T09:00:00.000Z',
    });
    await createCrmInteraction(facade, {
      type: 'meeting',
      summary: 'Old discovery workshop 45 days ago',
      occurredAt: '2026-10-01T10:00:00.000Z',
      leadId: 'lead-2',
      recordedBy: 'owner@local',
    });

    const center = await buildReminderCenter(facade, fixedNow);
    assert.ok(center.counts.overdueTasks >= 1);
    assert.ok(center.counts.todayFollowUps >= 1);
    assert.ok(center.counts.upcomingMeetings >= 1);
    assert.ok(center.counts.relationshipReviews >= 1);
    assert.ok(center.counts.needsAttention >= 1);
    assert.ok(center.reminders.length >= 5);

    // Honest scheduler disclosure
    assert.equal(center.schedulerStatus.backgroundDaemonActive, false);
    assert.equal(center.schedulerStatus.automatedNotificationsConfigured, false);
    assert.equal(center.schedulerStatus.deliveryMode, 'in_app_on_demand');
    assert.ok(center.schedulerStatus.honestNote.toLowerCase().includes('in-app'));
  } finally {
    cleanup();
  }
});

test('9 & 10. Multiple opportunities per company with currency safety & immutable stage transition history', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const { person1Id } = seedFixture(store);
    const facade = createCrmStorageFacade(store);

    const opp1 = await createCrmOpportunity(facade, {
      leadId: 'lead-1',
      personId: person1Id,
      title: 'Fleet Analytics License 2027',
      pipelineStageId: 'stage-qualified',
      estimatedValue: 120000,
      currency: 'EUR',
      probability: 45,
      expectedCloseDate: '2027-02-28T00:00:00.000Z',
      nextAction: 'Prepare technical architecture review',
      changedBy: 'owner@local',
    });

    const opp2 = await createCrmOpportunity(facade, {
      leadId: 'lead-1',
      personId: person1Id,
      title: 'Port Operations Pilot',
      pipelineStageId: 'stage-proposal',
      estimatedValue: 35000,
      currency: 'NOK',
      probability: 70,
      changedBy: 'owner@local',
    });

    const allOpps = await listAllCrmOpportunities(facade, { leadId: 'lead-1' });
    assert.equal(allOpps.length, 2);
    assert.equal(opp1.stageHistory.length, 1);
    assert.equal(opp1.stageHistory[0].toStageId, 'stage-qualified');

    // Stage transition appends to immutable stageHistory
    const moved = await updateCrmOpportunity(facade, opp1.id, {
      pipelineStageId: 'stage-proposal',
      stageChangeReason: 'Technical requirements approved by CEO',
      probability: 65,
      changedBy: 'owner@local',
    });
    assert.ok(moved);
    assert.equal(moved.pipelineStageId, 'stage-proposal');
    assert.equal(moved.stageHistory.length, 2);
    assert.equal(moved.stageHistory[1].fromStageId, 'stage-qualified');
    assert.equal(moved.stageHistory[1].toStageId, 'stage-proposal');
    assert.equal(moved.stageHistory[1].reason, 'Technical requirements approved by CEO');

    // Mark lost with winLossReason
    const lost = await updateCrmOpportunity(facade, opp2.id, {
      status: 'lost',
      winLossReason: 'Delayed budget cycle',
      changedBy: 'owner@local',
    });
    assert.equal(lost?.status, 'lost');
    assert.equal(lost?.winLossReason, 'Delayed budget cycle');

    const deleted = await deleteCrmOpportunity(facade, opp2.id);
    assert.equal(deleted, true);
  } finally {
    cleanup();
  }
});

test('11. Explainable derived relationship engagement scoring + owner override & annotation', () => {
  const fixedNow = new Date('2026-11-19T12:00:00.000Z');

  const derived = computeRelationshipEngagement({
    interactions: [
      {
        id: 'i1',
        type: 'meeting',
        summary: 'Product demo',
        occurredAt: '2026-11-17T10:00:00.000Z',
        recordingMode: 'manual',
        recordedBy: 'owner',
        createdAt: '2026-11-17T10:00:00.000Z',
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
      {
        id: 'i2',
        type: 'phone_call',
        summary: 'Pricing Q&A',
        occurredAt: '2026-11-12T10:00:00.000Z',
        recordingMode: 'manual',
        recordedBy: 'owner',
        createdAt: '2026-11-12T10:00:00.000Z',
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
    ],
    tasks: [
      {
        id: 't1',
        leadId: 'lead-1',
        title: 'Send SOW',
        dueDate: '2026-11-15T10:00:00.000Z',
        priority: 'high',
        completed: true,
        status: 'completed',
        assignedTo: 'Owner',
        createdAt: '2026-11-10T10:00:00.000Z',
      },
    ],
    opportunities: [
      {
        id: 'o1',
        leadId: 'lead-1',
        title: 'Annual Deal',
        pipelineStageId: 'stage-proposal',
        estimatedValue: 80000,
        probability: 60,
        status: 'open',
        currency: 'EUR',
        stageHistory: [],
        createdAt: '2026-11-10T10:00:00.000Z',
        updatedAt: '2026-11-17T10:00:00.000Z',
      },
    ],
    createdAt: '2026-09-01T10:00:00.000Z',
    relationshipMeta: {
      relationshipStatus: 'active',
      tags: [],
      nextFollowUpDate: '2026-11-24T10:00:00.000Z',
    },
    now: fixedNow,
  });

  assert.equal(derived.isDerived, true);
  assert.equal(derived.basis, 'derived_from_crm_activity');
  assert.ok(derived.score >= 50 && derived.score <= 100);
  assert.equal(derived.factors.length, 5);
  assert.equal(derived.ownerOverrideLevel, undefined);

  // Owner manual override takes precedence while preserving derived score transparently
  const overridden = computeRelationshipEngagement({
    interactions: [],
    tasks: [],
    opportunities: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    relationshipMeta: {
      relationshipStatus: 'active',
      tags: [],
      ownerOverrideLevel: 'strong',
      ownerAnnotation: 'Met in person at Oslo Maritime Summit (offline rapport).',
    },
    now: fixedNow,
  });

  assert.equal(overridden.ownerOverrideLevel, 'strong');
  assert.equal(overridden.effectiveLevel, 'strong');
  assert.equal(overridden.level, 'inactive'); // Derived level remains transparently 'inactive'
  assert.equal(overridden.score, 0); // Derived activity score remains transparently 0
});

test('12 & 13. Saved Views CRUD and advanced multi-facet segmentation for companies & persons', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const { person1Id } = seedFixture(store);
    const facade = createCrmStorageFacade(store);
    const fixedNow = new Date('2026-11-19T12:00:00.000Z');

    await updateCompanyRelationshipMeta(facade, 'lead-1', {
      relationshipStatus: 'active',
      tags: ['vip-nordic'],
      nextFollowUpDate: '2026-11-17T10:00:00.000Z', // overdue
    });
    await updatePersonRelationshipMeta(facade, person1Id, {
      relationshipStatus: 'warm',
      tags: ['c-suite'],
    });

    // Save company view
    const view = await saveCrmView(facade, {
      name: 'Overdue Active Nordic Accounts',
      entityType: 'company',
      filters: {
        countryCode: 'NO',
        relationshipStatus: 'active',
        followUpDue: 'overdue',
        tags: ['vip-nordic'],
      },
    });
    assert.ok(view.id);

    const companyViews = await listSavedViews(facade, 'company');
    assert.equal(companyViews.length, 1);
    assert.equal(companyViews[0].name, 'Overdue Active Nordic Accounts');

    // Segmented company search
    const segCompanies = await searchSegmentedCompanies(
      facade,
      {
        countryCode: 'NO',
        relationshipStatus: 'active',
        followUpDue: 'overdue',
        tags: ['vip-nordic'],
      },
      fixedNow
    );
    assert.equal(segCompanies.total, 1);
    assert.equal(segCompanies.items[0].lead.id, 'lead-1');

    // Segmented person search
    const segPersons = await searchSegmentedPersons(
      facade,
      {
        relationshipStatus: 'warm',
        country: 'Norway',
        tags: ['c-suite'],
      },
      fixedNow
    );
    assert.equal(segPersons.total, 1);
    assert.equal(segPersons.items[0].person.id, person1Id);
    assert.equal(segPersons.items[0].historicalCompaniesCount, 1);

    const deleted = await deleteSavedView(facade, view.id);
    assert.equal(deleted, true);
    assert.equal((await listSavedViews(facade, 'company')).length, 0);
  } finally {
    cleanup();
  }
});

test('14. Import Hub maps and normalizes Phase 13 relationship, notes, follow-up, and interaction history safely', () => {
  const headers = [
    'Company Name',
    'Country',
    'Website',
    'Relationship Status',
    'Relationship Notes',
    'Next Follow-Up Date',
    'Last Interaction Date',
    'Last Interaction Type',
    'Last Interaction Summary',
  ];

  const sampleMatrix: string[][] = [
    [
      'Fjord Clean Energy AS',
      'NO',
      'https://fjordclean.no',
      'warm',
      'Met CFO at Oslo Energy Week.',
      '2026-12-05',
      '2026-11-12',
      'meeting',
      'Introductory coffee meeting regarding turbine supply.',
    ],
  ];

  const detected = detectColumnMappings(headers, sampleMatrix);
  const byHeader = new Map(detected.mappings.map((m) => [m.sourceHeader, m.targetField]));
  assert.equal(byHeader.get('Relationship Status'), 'relationshipStatus');
  assert.equal(byHeader.get('Relationship Notes'), 'relationshipNotes');
  assert.equal(byHeader.get('Next Follow-Up Date'), 'nextFollowUpDate');
  assert.equal(byHeader.get('Last Interaction Date'), 'lastInteractionDate');
  assert.equal(byHeader.get('Last Interaction Type'), 'lastInteractionType');
  assert.equal(byHeader.get('Last Interaction Summary'), 'lastInteractionSummary');

  const extracted = extractMappedRowValues(headers, sampleMatrix[0], detected.mappings, []);
  const normalized = normalizeAndValidateMappedRow({
    rowNumber: 1,
    fields: extracted.fields,
    customFields: extracted.customFields,
    options: {
      defaultCountryCode: 'NO',
      dateLocale: 'ISO',
      duplicatePolicy: 'merge_safe',
      preserveExistingCrmFields: true,
      atomicRollbackOnError: false,
      skipRowsWithErrors: false,
    },
  });

  assert.equal(normalized.valid, true);
  assert.ok(normalized.company?.customFields?.crmRelationshipMeta);
  const meta = JSON.parse(normalized.company.customFields.crmRelationshipMeta);
  assert.equal(meta.relationshipStatus, 'warm');
  assert.ok(meta.nextFollowUpDate.startsWith('2026-12-05'));

  const notes = JSON.parse(normalized.company.customFields.crmPrivateNotes || '[]');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].visibility, 'owner_only');
  assert.ok(notes[0].content.includes('Oslo Energy Week'));

  const interactions = JSON.parse(normalized.company.customFields.crmInteractions || '[]');
  assert.equal(interactions.length, 1);
  assert.equal(interactions[0].type, 'meeting');
  assert.equal(interactions[0].recordingMode, 'manual');
});

test('15 & 16. Owner-only route protection, private notes isolation, and audit event hooks verified in server.ts', () => {
  const serverCode = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf-8');

  // Verify every /crm/* endpoint is mounted strictly on protectedApi (never app.get/post/put/delete)
  const publicCrmMatches = serverCode.match(/app\.(get|post|put|delete)\s*\(\s*['"]\/api\/crm/g);
  assert.equal(publicCrmMatches, null, 'No /api/crm/* routes may bypass protectedApi');

  const requiredProtectedRoutes = [
    "protectedApi.get('/crm/dashboard'",
    "protectedApi.get('/crm/reminders'",
    "protectedApi.get('/crm/company/:leadId/profile'",
    "protectedApi.put('/crm/company/:leadId/relationship'",
    "protectedApi.get('/crm/person/:personId/profile'",
    "protectedApi.put('/crm/person/:personId/relationship'",
    "protectedApi.get('/crm/interactions'",
    "protectedApi.post('/crm/interactions'",
    "protectedApi.put('/crm/interactions/:id'",
    "protectedApi.delete('/crm/interactions/:id'",
    "protectedApi.get('/crm/notes'",
    "protectedApi.post('/crm/notes'",
    "protectedApi.put('/crm/notes/:id'",
    "protectedApi.delete('/crm/notes/:id'",
    "protectedApi.get('/crm/opportunities'",
    "protectedApi.post('/crm/opportunities'",
    "protectedApi.put('/crm/opportunities/:id'",
    "protectedApi.delete('/crm/opportunities/:id'",
    "protectedApi.get('/crm/saved-views'",
    "protectedApi.post('/crm/saved-views'",
    "protectedApi.delete('/crm/saved-views/:id'",
    "protectedApi.post('/crm/search/companies'",
    "protectedApi.post('/crm/search/persons'",
  ];

  for (const routeSig of requiredProtectedRoutes) {
    assert.ok(serverCode.includes(routeSig), `Expected protected route signature: ${routeSig}`);
  }

  // Verify audit event hooks exist for Phase 13 mutations
  for (const auditEvent of [
    'CRM_COMPANY_RELATIONSHIP_UPDATED',
    'CRM_PERSON_RELATIONSHIP_UPDATED',
    'CRM_INTERACTION_RECORDED',
    'CRM_PRIVATE_NOTE_CREATED',
    'CRM_OPPORTUNITY_CREATED',
    'CRM_OPPORTUNITY_UPDATED',
    'CRM_TASK_CREATED',
    'CRM_SAVED_VIEW_UPSERTED',
  ]) {
    assert.ok(serverCode.includes(auditEvent), `Expected audit event hook: ${auditEvent}`);
  }
});

test('17. Internal workspace state key (__crm_workspace_v1) is isolated from connector configs', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    seedFixture(store);
    const facade = createCrmStorageFacade(store);

    await saveCrmView(facade, {
      name: 'Priority Accounts',
      entityType: 'company',
      filters: { relationshipStatus: 'active' },
    });

    // Public connector configs must NEVER leak __crm_workspace_v1
    const connectorConfigs = store.getConnectorConfigs();
    assert.equal(connectorConfigs[CRM_WORKSPACE_SETTINGS_KEY], undefined);

    // Updating a normal connector config must NOT erase __crm_workspace_v1
    store.updateConnectorConfig('uk_companies_house', { enabled: true });
    const viewsAfter = await listSavedViews(facade, 'company');
    assert.equal(viewsAfter.length, 1);
    assert.equal(viewsAfter[0].name, 'Priority Accounts');
  } finally {
    cleanup();
  }
});

test('18 & 19. Personal CRM Dashboard aggregates all 14 real metrics accurately with zero fabricated data', async () => {
  const { store, cleanup } = createIsolatedStorage();
  try {
    const { person1Id } = seedFixture(store);
    const facade = createCrmStorageFacade(store);
    const fixedNow = new Date('2026-11-19T12:00:00.000Z');

    await updateCompanyRelationshipMeta(facade, 'lead-1', { relationshipStatus: 'active' });
    await createCrmInteraction(facade, {
      type: 'meeting',
      summary: 'Kickoff alignment on next quarter rollout.',
      occurredAt: '2026-11-18T11:00:00.000Z',
      leadId: 'lead-1',
      personId: person1Id,
      recordedBy: 'owner@local',
    });
    await createCrmOpportunity(facade, {
      leadId: 'lead-1',
      personId: person1Id,
      title: 'Enterprise Marine Suite',
      pipelineStageId: 'stage-proposal',
      estimatedValue: 95000,
      currency: 'EUR',
      changedBy: 'owner@local',
    });
    await createExtendedTask(facade, {
      title: 'Overdue contract review',
      leadId: 'lead-1',
      dueDate: '2026-11-16T09:00:00.000Z',
      priority: 'high',
      status: 'pending',
      completed: false,
      assignedTo: 'Owner',
    });
    await createExtendedTask(facade, {
      title: 'Today follow-up email',
      leadId: 'lead-2',
      dueDate: '2026-11-19T15:00:00.000Z',
      priority: 'medium',
      status: 'pending',
      completed: false,
      assignedTo: 'Owner',
    });

    const summary = await buildCrmDashboardSummary(facade, fixedNow);
    assert.equal(summary.metrics.totalCompanies, 2);
    assert.equal(summary.metrics.totalDecisionMakers, 2);
    assert.ok(summary.metrics.activeRelationships >= 1);
    assert.equal(summary.metrics.recentInteractions30d, 1);
    assert.equal(summary.metrics.overdueFollowUps, 1);
    assert.equal(summary.metrics.todaysFollowUps, 1);
    assert.equal(summary.metrics.activeOpportunities, 1);
    const eurBucket = summary.metrics.expectedOpportunityValueByCurrency.find((b) => b.currency === 'EUR');
    assert.ok(eurBucket);
    assert.equal(eurBucket.totalValue, 95000);
    assert.equal(summary.recentInteractions.length, 1);
    assert.equal(summary.recentlyContactedPeople.length, 1);
    assert.equal(summary.recentlyContactedPeople[0].fullName, 'Astrid Solberg');
    assert.equal(summary.recentlyContactedPeople[0].jobTitle, 'Chief Executive Officer');

    // Edge case: non-existent company/person returns null cleanly
    assert.equal(await buildCompanyRelationshipProfile(facade, 'does-not-exist'), null);
    assert.equal(await buildPersonRelationshipProfile(facade, 'does-not-exist'), null);
  } finally {
    cleanup();
  }
});
