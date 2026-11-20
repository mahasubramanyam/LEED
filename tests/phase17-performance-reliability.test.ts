/**
 * Phase 17 Isolated Test Suite — Performance, Scalability & Reliability Engineering.
 *
 * Strictly isolated: uses temporary StorageManager directories cleaned up in finally blocks.
 * Never touches Neon PostgreSQL, data/pipeline_store.json, or data/owner_auth.json.
 * Never sends real external requests or modifies production data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  paginateArray,
  parsePaginationParams,
  projectAllowedFields,
  stableSortBy,
  toCompactLead,
} from '../shared/paginationUtils.js';
import { LeedCacheManager, leedCache } from '../server/perf/cacheManager.js';
import {
  ObservabilityService,
  normalizeRouteKey,
  observabilityService,
  sanitizeDiagnosticText,
} from '../server/perf/observabilityService.js';
import {
  getBackupRestoreReadinessStatus,
  runIsolatedJsonBackupRestoreDrill,
} from '../server/perf/backupRestoreService.js';
import { registerDiagnosticsRoutes } from '../server/perf/diagnosticsRoutes.js';
import { dbManager, isTransientPgError } from '../server/db/pool.js';
import { StorageManager } from '../server/storage.js';
import { createCrmStorageFacade } from '../server/crm/crmStoreHelper.js';
import { buildBiAnalyticsDashboardCached } from '../server/bi/biAnalyticsService.js';
import { registerBiWorkflowRoutes } from '../server/bi/biWorkflowRoutes.js';
import {
  createWorkflowDefinition,
  dispatchWorkflowEvent,
  listWorkflowsWorkspace,
} from '../server/bi/workflowEngine.js';
import {
  addSuppressionEntry,
  approveOutreachMessage,
  createOutreachCampaign,
  enrollRecipientsInCampaign,
  generateOutreachMessageDraft,
  markMessageManuallySent,
} from '../server/outreach/outreachService.js';
import { ConnectorExecutionEngine } from '../server/connectors/core/executionEngine.js';
import { classifyConnectorError, ConnectorError } from '../server/connectors/core/errors.js';
import type {
  ConnectorMetadata,
  ConnectorSearchResponse,
  IConnector,
} from '../server/connectors/core/types.js';
import { requireOwnerAuth } from '../server/auth/middleware.js';
import { generateCsrfToken, validateCsrf } from '../server/auth/csrf.js';
import type { CanonicalLead } from '../server/types.js';

function createTempStore(): { dir: string; filePath: string; storage: StorageManager; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-phase17-'));
  const filePath = path.join(dir, 'pipeline_store.json');
  const storage = new StorageManager(filePath);
  return {
    dir,
    filePath,
    storage,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    },
  };
}

function makeSyntheticLead(index: number): CanonicalLead {
  const countries = [
    { code: 'GB', name: 'United Kingdom', city: 'London', currency: 'GBP' },
    { code: 'US', name: 'United States', city: 'Austin', currency: 'USD' },
    { code: 'DE', name: 'Germany', city: 'Berlin', currency: 'EUR' },
    { code: 'SG', name: 'Singapore', city: 'Singapore', currency: 'SGD' },
  ];
  const c = countries[index % countries.length];
  const ts = new Date(Date.UTC(2026, 0, 1 + (index % 28), 10, index % 60, 0)).toISOString();
  return {
    id: `lead-p17-${String(index).padStart(4, '0')}`,
    companyName: `Phase17 Synthetic Corp ${index}`,
    industry: index % 2 === 0 ? 'B2B Software' : 'Industrial Logistics',
    category: 'Enterprise',
    website: `https://corp-${index}.example.com`,
    domain: `corp-${index}.example.com`,
    email: `contact${index}@corp-${index}.example.com`,
    phone: `+44 20 7946 ${String(index).padStart(4, '0')}`,
    address: {
      street: `${index} Market Street`,
      city: c.city,
      country: c.name,
      countryCode: c.code,
    },
    registrationNumber: `REG-${String(index).padStart(6, '0')}`,
    pipelineStageId: index % 3 === 0 ? 'stage-qualified' : 'stage-discovered',
    status: index % 2 === 0 ? 'qualified' : 'new',
    confidenceScore: 70 + (index % 30),
    confidenceSignals: ['synthetic_test_record'],
    opportunityValue: 15000 + (index % 5) * 5000,
    currency: c.currency,
    tags: ['phase17', c.code.toLowerCase()],
    sources: [
      {
        sourceName: 'synthetic_seed',
        retrievedAt: ts,
      },
    ],
    identifiers: [
      {
        type: 'REG_NO',
        value: `REG-${String(index).padStart(6, '0')}`,
        normalizedValue: `REG${String(index).padStart(6, '0')}`,
        countryCode: c.code,
        verified: index % 2 === 0,
      },
    ],
    notes: [
      {
        id: `n-${index}`,
        content: `Detailed account note #${index} `.repeat(12),
        author: 'Owner',
        createdAt: ts,
      },
    ],
    activities: [
      {
        id: `a-${index}`,
        type: 'note',
        title: `Activity ${index}`,
        notes: `Historical activity log payload #${index} `.repeat(10),
        date: ts,
        actor: 'Owner',
      },
    ],
    createdAt: ts,
    updatedAt: ts,
  };
}

function makeMockConnector(
  id: string,
  name: string,
  searchImpl: () => Promise<ConnectorSearchResponse>
): IConnector {
  const metadata: ConnectorMetadata = {
    id,
    name,
    shortName: name,
    version: '1.0.0',
    description: name,
    sourceCategory: 'government_registry',
    accessMode: 'live_api',
    capabilities: ['company_search'],
    supportedCountries: ['GLOBAL'],
    supportsAllCountries: true,
    supportsRegionFilter: false,
    supportsCityFilter: false,
    supportedIdentifierTypes: [],
    credentialRequirements: {
      authType: 'none_open',
      required: false,
      envFallbackKeys: [],
      fields: [],
      setupInstructions: 'No credentials required for mock test connector',
    },
    executionPolicy: {
      timeoutMs: 2000,
      maxRetries: 0,
      baseBackoffMs: 5,
      maxBackoffMs: 10,
      maxConcurrency: 5,
      rateLimit: { maxRequests: 100, windowMs: 60_000, note: 'Test mock policy' },
      defaultPageSize: 10,
      maxPageSize: 50,
    },
    attribution: name,
    license: 'Test',
  };

  return {
    id,
    getMetadata: () => metadata,
    validateConnection: async () => ({
      ok: true,
      healthState: 'operational',
      message: 'ok',
      latencyMs: 1,
      isLiveApi: true,
      checkedAt: new Date().toISOString(),
    }),
    search: async () => searchImpl(),
    normalizeResult: () => null,
    classifyError: (err) => classifyConnectorError(err, id),
    getHealth: () => ({
      connectorId: id,
      healthState: 'operational',
      operational: true,
      summary: 'ok',
    }),
  };
}

// ============================================================================
// 1. PAGINATION, STABLE SORTING & COMPACT PROJECTION
// ============================================================================

test('Phase 17.1: Pagination enforces bounds, supports offset/limit, stable sort, and compact projection', () => {
  const clamped = parsePaginationParams({ page: '0', pageSize: '9999' });
  assert.equal(clamped.page, 1);
  assert.equal(clamped.pageSize, MAX_PAGE_SIZE);

  const defaults = parsePaginationParams({});
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, DEFAULT_PAGE_SIZE);
  assert.equal(defaults.offset, 0);

  const byOffset = parsePaginationParams({ offset: '20', limit: '10' });
  assert.equal(byOffset.offset, 20);
  assert.equal(byOffset.pageSize, 10);
  assert.equal(byOffset.page, 3);

  const items = [
    { id: 'b', score: 80 },
    { id: 'a', score: 80 },
    { id: 'c', score: 95 },
  ];
  const sorted = stableSortBy(items, (x) => x.score, 'desc');
  assert.deepEqual(
    sorted.map((x) => x.id),
    ['c', 'a', 'b']
  );

  const paged = paginateArray(sorted, parsePaginationParams({ page: 1, limit: 2 }));
  assert.equal(paged.items.length, 2);
  assert.equal(paged.pagination.total, 3);
  assert.equal(paged.pagination.totalPages, 2);
  assert.equal(paged.pagination.hasNextPage, true);
  assert.equal(paged.pagination.hasPrevPage, false);

  const fullLead = makeSyntheticLead(1);
  const compact = toCompactLead(fullLead);
  assert.equal(compact.id, fullLead.id);
  assert.equal(compact.notesCount, 1);
  assert.equal(compact.activitiesCount, 1);
  assert.equal('notes' in compact, false);
  assert.equal('activities' in compact, false);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(fullLead).length);

  const projected = projectAllowedFields(
    compact as Record<string, unknown>,
    ['companyName', 'domain', 'nonExistent'],
    ['id', 'companyName', 'domain', 'email']
  );
  assert.equal(projected.id, fullLead.id);
  assert.equal(projected.companyName, fullLead.companyName);
  assert.equal(projected.domain, fullLead.domain);
  assert.equal('email' in projected, false);
});

// ============================================================================
// 2. BOUNDED LRU+TTL CACHE MANAGER & SENSITIVE-KEY SAFETY
// ============================================================================

test('Phase 17.2: Bounded cache enforces LRU eviction, owner scoping, write invalidation, and blocks sensitive keys', () => {
  const cache = new LeedCacheManager({ maxEntries: 16, maxEstimatedBytes: 256 * 1024 });

  // Forbidden sensitive keys MUST throw
  const forbiddenKeys = [
    'auth:session',
    'session:abc',
    'csrf:token',
    'suppression:list',
    'dnc:email',
    'private_notes:lead-1',
    'credential:resend',
    'secret:vault',
  ];
  for (const key of forbiddenKeys) {
    assert.throws(
      () => cache.set('bi_analytics', 'owner-a', key, { x: 1 }, 5000),
      /Cache policy violation/
    );
  }

  // Fill 16 entries (LRU cap), touch entry 0 so entry 1 becomes least recently used
  for (let i = 0; i < 16; i++) {
    cache.set('bi_analytics', 'owner-a', `k${i}`, { v: i }, 30_000);
  }
  assert.deepEqual(cache.get('bi_analytics', 'owner-a', 'k0'), { v: 0 });
  // Owner-scope isolation
  assert.equal(cache.get('bi_analytics', 'owner-b', 'k0'), undefined);

  // Adding 17th entry must evict least-recently-used key (k1) while preserving k0
  cache.set('crm_summary', 'owner-a', 'k16', { v: 16 }, 30_000);
  assert.equal(cache.get('bi_analytics', 'owner-a', 'k1'), undefined, 'LRU entry k1 should be evicted');
  assert.deepEqual(cache.get('bi_analytics', 'owner-a', 'k0'), { v: 0 });

  const stats = cache.getStats();
  assert.equal(stats.currentEntries, 16);
  assert.ok(stats.evictions >= 1);
  assert.ok(stats.hits >= 2);
  assert.ok(stats.blockedSensitiveAttempts >= forbiddenKeys.length);

  // Explicit CRM write invalidation clears bi_analytics, crm_summary, quality_summary
  const removed = cache.invalidateOnCrmWrite();
  assert.equal(removed, 16);
  assert.equal(cache.getStats().currentEntries, 0);
});

// ============================================================================
// 3. O(N) MAP-INDEXED STORAGE + CACHED BI ANALYTICS + WRITE INVALIDATION
// ============================================================================

test('Phase 17.3: Batch lead upsert (600 leads), cached BI analytics hit/miss, and automatic facade invalidation', async () => {
  const { storage, cleanup } = createTempStore();
  try {
    leedCache.clearAll();
    const syntheticLeads = Array.from({ length: 600 }, (_, i) => makeSyntheticLead(i));

    const t0 = performance.now();
    const result = storage.batchUpsertLeads(syntheticLeads);
    const batchMs = performance.now() - t0;
    assert.equal(result.added, 600);
    assert.equal(result.updated, 0);
    assert.ok(batchMs < 5000, `Expected fast batch upsert, got ${batchMs.toFixed(1)}ms`);

    // Re-upserting 50 existing leads should update via Map index (zero duplicates)
    const repeat = storage.batchUpsertLeads(syntheticLeads.slice(0, 50));
    assert.equal(repeat.added, 0);
    assert.equal(repeat.updated, 50);
    const expectedTotal = storage.getLeads().length;
    assert.ok(expectedTotal >= 600);

    // Cached BI analytics: first call MISS, second call HIT, after facade write -> MISS
    const facade = createCrmStorageFacade(storage);
    const first = await buildBiAnalyticsDashboardCached(facade, {}, { ownerScope: 'owner-p17' });
    assert.equal(first.cacheHit, false);
    assert.equal(first.dashboard.leadIntelligence.totalCompanies, expectedTotal);

    const second = await buildBiAnalyticsDashboardCached(facade, {}, { ownerScope: 'owner-p17' });
    assert.equal(second.cacheHit, true);
    assert.equal(second.dashboard.leadIntelligence.totalCompanies, expectedTotal);

    // Mutate via facade -> must invalidate cache automatically
    await facade.upsertLead(makeSyntheticLead(999));
    const third = await buildBiAnalyticsDashboardCached(facade, {}, { ownerScope: 'owner-p17' });
    assert.equal(third.cacheHit, false);
    assert.equal(third.dashboard.leadIntelligence.totalCompanies, expectedTotal + 1);
  } finally {
    leedCache.clearAll();
    cleanup();
  }
});

// ============================================================================
// 4. WORKFLOW CONCURRENCY, MUTEX SERIALIZATION & RESTART-SAFE IDEMPOTENCY
// ============================================================================

test('Phase 17.4: Concurrent workflow triggers serialize safely and enforce restart-safe idempotency', async () => {
  const { filePath, storage, cleanup } = createTempStore();
  try {
    const facade = createCrmStorageFacade(storage);
    const lead = makeSyntheticLead(10);
    await facade.upsertLead(lead);

    const wf = await createWorkflowDefinition(
      facade,
      {
        name: 'Phase 17 Concurrency Guard Workflow',
        enabled: true,
        trigger: { type: 'lead_created' },
        conditions: [],
        actions: [{ type: 'create_task', taskTitle: 'Follow up {{companyName}}', taskDueDays: 2, taskPriority: 'high' }],
      },
      'Owner'
    );

    const event = {
      triggerType: 'lead_created' as const,
      entityType: 'lead' as const,
      entityId: lead.id,
      leadId: lead.id,
      eventKey: 'p17-concurrent-dedupe-key',
      actor: 'Owner',
    };

    // Fire 5 concurrent duplicate dispatches simultaneously
    const results = await Promise.all([
      dispatchWorkflowEvent(facade, event, { onlyWorkflowId: wf.id }),
      dispatchWorkflowEvent(facade, event, { onlyWorkflowId: wf.id }),
      dispatchWorkflowEvent(facade, event, { onlyWorkflowId: wf.id }),
      dispatchWorkflowEvent(facade, event, { onlyWorkflowId: wf.id }),
      dispatchWorkflowEvent(facade, event, { onlyWorkflowId: wf.id }),
    ]);

    const completedRuns = results.flat().filter((r) => r.status === 'completed');
    const skippedRuns = results.flat().filter((r) => r.status === 'skipped');
    assert.equal(completedRuns.length, 1, 'Exactly one concurrent run must execute the action');
    assert.equal(skippedRuns.length, 4, 'All 4 concurrent duplicates must be skipped');

    const tasksAfterConcurrent = await facade.getTasks();
    const createdByWf = tasksAfterConcurrent.filter((t) => t.leadId === lead.id);
    assert.equal(createdByWf.length, 1, 'Task must be created exactly once');

    // Simulate process restart by instantiating a brand-new StorageManager on the same temp file
    const restartedStorage = new StorageManager(filePath);
    const restartedFacade = createCrmStorageFacade(restartedStorage);
    const afterRestart = await dispatchWorkflowEvent(restartedFacade, event, { onlyWorkflowId: wf.id });
    assert.equal(afterRestart[0]?.status, 'skipped', 'Idempotency must survive restart');

    const ws = await listWorkflowsWorkspace(restartedFacade);
    assert.ok(ws.executions.length >= 2);
  } finally {
    cleanup();
  }
});

// ============================================================================
// 5. CONNECTOR CIRCUIT BREAKER, COOLDOWN RECOVERY & FAILURE ISOLATION
// ============================================================================

test('Phase 17.5: Connector circuit breaker opens on transient failures, fast-fails, recovers in half-open, and isolates failures', async () => {
  const engine = new ConnectorExecutionEngine();
  engine.configureCircuitBreaker({ failureThreshold: 3, cooldownMs: 60 });

  let transientAttempts = 0;
  let shouldFailTransient = true;

  const flakyConnector = makeMockConnector('test-flaky-p17', 'Flaky Transient Provider', async () => {
    transientAttempts++;
    if (shouldFailTransient) {
      throw new ConnectorError({
        category: 'timeout',
        providerId: 'test-flaky-p17',
        retryable: false,
        message: 'Simulated upstream timeout',
      });
    }
    return {
      results: [],
      pagination: { page: 1, pageSize: 10, totalReturned: 0, hasMore: false },
      isLiveApi: true,
      rawCount: 0,
      attribution: 'Flaky Transient Provider',
      notes: [],
    };
  });

  const healthyConnector = makeMockConnector('test-healthy-p17', 'Healthy Isolated Provider', async () => ({
    results: [],
    pagination: { page: 1, pageSize: 10, totalReturned: 0, hasMore: false },
    isLiveApi: true,
    rawCount: 0,
    attribution: 'Healthy Isolated Provider',
    notes: [],
  }));

  const configErrConnector = makeMockConnector('test-config-err-p17', 'Config Error Provider', async () => {
    throw new ConnectorError({
      category: 'configuration_error',
      providerId: 'test-config-err-p17',
      retryable: false,
      message: 'Missing API key',
    });
  });

  const req = { query: 'test', countryCode: 'GLOBAL', page: 1, pageSize: 10 };

  // 3 consecutive transient failures -> circuit transitions to OPEN
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => engine.executeSearch(flakyConnector, req), /timeout/i);
  }
  assert.equal(engine.getCircuitState('test-flaky-p17'), 'open');
  assert.equal(transientAttempts, 3);

  // 4th call while circuit is OPEN must fast-fail WITHOUT invoking connector.search
  await assert.rejects(
    () => engine.executeSearch(flakyConnector, req),
    /circuit breaker is open/i
  );
  assert.equal(transientAttempts, 3, 'Open circuit must block upstream invocation');

  // Non-transient configuration_error must NOT trip circuit breaker
  for (let i = 0; i < 4; i++) {
    await assert.rejects(() => engine.executeSearch(configErrConnector, req), /Missing API key/i);
  }
  assert.equal(engine.getCircuitState('test-config-err-p17'), 'closed');

  // Failure isolation: parallel execution of open flaky connector + healthy connector keeps healthy connector operational
  const [flakyOutcome, healthyOutcome] = await Promise.allSettled([
    engine.executeSearch(flakyConnector, req),
    engine.executeSearch(healthyConnector, req),
  ]);
  assert.equal(flakyOutcome.status, 'rejected');
  assert.equal(healthyOutcome.status, 'fulfilled');

  // Wait for cooldown -> half_open probe succeeds -> circuit closes
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(engine.getCircuitState('test-flaky-p17'), 'half_open');
  shouldFailTransient = false;
  const recovered = await engine.executeSearch(flakyConnector, req);
  assert.equal(recovered.runRecord.connectorId, 'test-flaky-p17');
  assert.equal(engine.getCircuitState('test-flaky-p17'), 'closed');

  const snapshot = engine.getRuntimeHealthSnapshot();
  const flakyStats = snapshot.find((s) => s.connectorId === 'test-flaky-p17');
  assert.ok(flakyStats);
  assert.equal(flakyStats.circuitOpens, 1);
  assert.ok(flakyStats.totalCalls >= 4);
});

// ============================================================================
// 6. TRANSIENT POSTGRESQL ERROR CLASSIFICATION & RETRY HELPER
// ============================================================================

test('Phase 17.6: Transient PostgreSQL error classifier retries network drops and fails fast on SQL errors', async () => {
  assert.equal(isTransientPgError({ code: 'ECONNRESET' }), true);
  assert.equal(isTransientPgError({ code: '57P01' }), true);
  assert.equal(isTransientPgError(new Error('Connection terminated unexpectedly')), true);
  assert.equal(isTransientPgError({ code: '23505', message: 'duplicate key violation' }), false);
  assert.equal(isTransientPgError({ code: '42601', message: 'syntax error' }), false);

  let attempts = 0;
  const recovered = await dbManager.executeWithRetry(
    async () => {
      attempts++;
      if (attempts < 2) {
        const err: any = new Error('Connection terminated unexpectedly');
        err.code = 'ECONNRESET';
        throw err;
      }
      return 'ok-recovered';
    },
    { maxRetries: 2, baseDelayMs: 25 }
  );
  assert.equal(recovered, 'ok-recovered');
  assert.equal(attempts, 2);

  let nonTransientAttempts = 0;
  await assert.rejects(
    () =>
      dbManager.executeWithRetry(
        async () => {
          nonTransientAttempts++;
          const err: any = new Error('duplicate key value violates unique constraint');
          err.code = '23505';
          throw err;
        },
        { maxRetries: 2, baseDelayMs: 25 }
      ),
    /unique constraint/
  );
  assert.equal(nonTransientAttempts, 1, 'Non-transient SQL error must not be retried');
});

// ============================================================================
// 7. ISOLATED JSON BACKUP & RESTORE DRILL + TAMPER REJECTION
// ============================================================================

test('Phase 17.7: Isolated JSON backup/restore drill verifies SHA-256, record counts, tamper rejection, and leaves live data untouched', () => {
  const { storage, cleanup } = createTempStore();
  try {
    storage.batchUpsertLeads([makeSyntheticLead(1), makeSyntheticLead(2), makeSyntheticLead(3)]);
    const liveDataPath = path.resolve(process.cwd(), 'data', 'pipeline_store.json');
    const liveMtimeBefore = fs.existsSync(liveDataPath) ? fs.statSync(liveDataPath).mtimeMs : null;

    const drill = runIsolatedJsonBackupRestoreDrill(storage.getDbFilePath());
    assert.equal(drill.verified, true);
    assert.equal(drill.checksumVerified, true);
    assert.equal(drill.tamperDetectionVerified, true);
    assert.equal(drill.recordCountsMatched, true);
    assert.equal(drill.productionNeonUntouched, true);
    assert.equal(drill.liveDataDirectoryUntouched, true);
    assert.equal(drill.recordCounts.leads, storage.getLeads().length);
    assert.equal(drill.sha256.length, 64);

    const readiness = getBackupRestoreReadinessStatus();
    assert.equal(readiness.isolatedJsonDrill.verified, true);
    assert.equal(readiness.productionPostgresBackupRestore.status, 'not_verified_in_runtime');

    if (liveMtimeBefore !== null) {
      assert.equal(
        fs.statSync(liveDataPath).mtimeMs,
        liveMtimeBefore,
        'Live data/pipeline_store.json must never be modified'
      );
    }
  } finally {
    cleanup();
  }
});

// ============================================================================
// 8. OBSERVABILITY RING BUFFERS, SECRET REDACTION & SQL PROPOSAL ISOLATION
// ============================================================================

test('Phase 17.8: Observability sanitizes secrets/PII, normalizes route IDs, bounds buffers, and isolates SQL index proposal', () => {
  assert.equal(
    normalizeRouteKey('GET', '/api/leads/lead-171234-abcd/notes?search=secret@example.com'),
    'GET /api/leads/:id/notes'
  );
  assert.equal(
    normalizeRouteKey('PUT', '/api/persons/550e8400-e29b-41d4-a716-446655440000'),
    'PUT /api/persons/:uuid'
  );

  const scrubbed = sanitizeDiagnosticText(
    'Failed connecting to postgresql://admin:SuperSecretPass@db.neon.tech/leed for alice@company.com Bearer sk_live_1234567890'
  );
  assert.equal(scrubbed.includes('SuperSecretPass'), false);
  assert.equal(scrubbed.includes('alice@company.com'), false);
  assert.equal(scrubbed.includes('sk_live_1234567890'), false);

  const obs = new ObservabilityService();
  for (let i = 0; i < 150; i++) {
    obs.recordApiRequest('GET', `/api/route-group-${i}`, 200, 10 + (i % 50));
  }
  const summary = obs.getApiLatencySummary();
  assert.ok(summary.trackedRouteGroups <= summary.maxTrackedRouteGroups, 'Route buckets must stay bounded');

  // Verify review-only SQL performance index proposal exists and is NOT in auto-run migrations/
  const proposalUp = path.resolve(process.cwd(), 'server/db/migrations/proposals/006_performance_indexes.sql');
  const proposalDown = path.resolve(process.cwd(), 'server/db/migrations/proposals/006_performance_indexes.down.sql');
  const autoRunPath = path.resolve(process.cwd(), 'server/db/migrations/006_performance_indexes.sql');

  assert.equal(fs.existsSync(proposalUp), true, 'Review-only 006_performance_indexes.sql must exist');
  assert.equal(fs.existsSync(proposalDown), true, 'Rollback 006_performance_indexes.down.sql must exist');
  assert.equal(fs.existsSync(autoRunPath), false, '006 proposal must NEVER be placed in auto-run migrations/');

  const upSql = fs.readFileSync(proposalUp, 'utf-8');
  assert.ok(upSql.includes('CREATE INDEX IF NOT EXISTS'));
  assert.equal(upSql.includes('DROP TABLE'), false);
});

// ============================================================================
// 9. HTTP SECURITY, DIAGNOSTICS ROUTES, CACHING HEADERS & LIVE SUPPRESSION
// ============================================================================

test('Phase 17.9: Diagnostics & BI endpoints enforce 401/403 security, cache invalidation, pagination, and uncached suppression', async () => {
  const { storage, cleanup } = createTempStore();
  let server: http.Server | null = null;

  try {
    leedCache.clearAll();
    const facade = createCrmStorageFacade(storage);
    const leadA = makeSyntheticLead(101);
    const leadB = makeSyntheticLead(102);
    await facade.upsertLead(leadA);
    await facade.upsertLead(leadB);

    // Mount real Express app with observability, auth, CSRF, diagnostics & BI routes
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api', observabilityService.createPerformanceMiddleware());

    // Public unauthenticated router tests requireOwnerAuth -> 401
    const unauthRouter = express.Router();
    unauthRouter.use(requireOwnerAuth);
    registerDiagnosticsRoutes(unauthRouter, {
      getStorageInfo: () => ({ isPg: false, jsonFilePath: storage.getDbFilePath() }),
      sanitizeApiError: (_e, fb) => fb,
    });
    app.use('/api/unauth-test', unauthRouter);

    // Authenticated owner router with real validateCsrf middleware
    const ownerRouter = express.Router();
    ownerRouter.use((req, _res, next) => {
      (req as any).owner = { id: 'owner-test-1', email: 'owner@test.local', fullName: 'Owner', role: 'owner' };
      next();
    });
    ownerRouter.use(validateCsrf);
    registerDiagnosticsRoutes(ownerRouter, {
      getStorageInfo: () => ({ isPg: false, jsonFilePath: storage.getDbFilePath() }),
      sanitizeApiError: (_e, fb) => fb,
    });
    registerBiWorkflowRoutes(ownerRouter, {
      getFacade: () => ({ facade, isPg: false }),
      aiRateLimitMiddleware: (_req, _res, next) => next(),
      sanitizeApiError: (_e, fb) => fb,
    });
    app.use('/api', ownerRouter);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server!.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const csrfToken = generateCsrfToken();

    // 1. Unauthenticated diagnostics access MUST return 401
    const unauthRes = await fetch(`${base}/api/unauth-test/diagnostics/performance`);
    assert.equal(unauthRes.status, 401);

    // 2. Authenticated POST without CSRF MUST return 403
    const noCsrfRes = await fetch(`${base}/api/diagnostics/cache/clear`, { method: 'POST' });
    assert.equal(noCsrfRes.status, 403);

    // 3. BI analytics cache MISS -> HIT -> clear invalidation -> MISS
    const bi1 = await fetch(`${base}/api/bi/analytics`);
    assert.equal(bi1.status, 200);
    assert.equal(bi1.headers.get('x-leed-cache'), 'MISS');

    const bi2 = await fetch(`${base}/api/bi/analytics`);
    assert.equal(bi2.status, 200);
    assert.equal(bi2.headers.get('x-leed-cache'), 'HIT');

    // Clear cache with valid CSRF -> 200
    const clearRes = await fetch(`${base}/api/diagnostics/cache/clear`, {
      method: 'POST',
      headers: {
        cookie: `leed_csrf=${csrfToken}`,
        'x-leed-csrf-token': csrfToken,
      },
    });
    assert.equal(clearRes.status, 200);
    const clearBody = (await clearRes.json()) as { cleared: boolean; clearedEntries: number };
    assert.equal(clearBody.cleared, true);
    assert.ok(clearBody.clearedEntries >= 1);

    const bi3 = await fetch(`${base}/api/bi/analytics`);
    assert.equal(bi3.headers.get('x-leed-cache'), 'MISS');

    // 4. Paginated BI report endpoint
    const repRes = await fetch(`${base}/api/bi/reports/generate?reportType=executive_overview&page=1&limit=2`);
    assert.equal(repRes.status, 200);
    const repBody = (await repRes.json()) as any;
    assert.equal(repBody.report.rows.length, 2);
    assert.equal(repBody.pagination.page, 1);
    assert.equal(repBody.pagination.pageSize, 2);
    assert.ok(repBody.pagination.total >= 2);

    // 5. Isolated backup/restore drill via HTTP endpoint
    const drillRes = await fetch(`${base}/api/diagnostics/backup/verify-isolated`, {
      method: 'POST',
      headers: {
        cookie: `leed_csrf=${csrfToken}`,
        'x-leed-csrf-token': csrfToken,
      },
    });
    assert.equal(drillRes.status, 200);
    const drillBody = (await drillRes.json()) as any;
    assert.equal(drillBody.drill.verified, true);
    assert.equal(drillBody.readiness.productionPostgresBackupRestore.status, 'not_verified_in_runtime');

    // 6. Diagnostics performance snapshot returns real measured API latency & provenance
    const diagRes = await fetch(`${base}/api/diagnostics/performance`);
    assert.equal(diagRes.status, 200);
    const diagBody = (await diagRes.json()) as any;
    assert.equal(diagBody.apiLatency.provenance, 'measured');
    assert.ok(diagBody.apiLatency.totalRequests >= 4);
    assert.equal(diagBody.backupRestore.isolatedJsonDrill.verified, true);

    // 7. Verify Phase 15 suppression enforcement remains live & uncached
    const camp = await createOutreachCampaign(facade, {
      name: 'P17 Suppression Live Check',
      objective: 'Verify live suppression never stale-cached',
      mode: 'individual',
      channel: 'email',
      createdBy: 'Owner',
    });
    const enrolled = await enrollRecipientsInCampaign(facade, {
      campaignId: camp.campaign.id,
      recipients: [{ leadId: leadA.id }],
      enrolledBy: 'Owner',
    });
    const draft = await generateOutreachMessageDraft(facade, {
      campaignId: camp.campaign.id,
      leadId: leadA.id,
      enrollmentId: enrolled.enrolled[0].id,
      stepNumber: 1,
      actor: 'Owner',
    });
    await approveOutreachMessage(facade, draft.id, 'Owner');
    await addSuppressionEntry(facade, {
      scope: 'global',
      type: 'do_not_contact',
      email: leadA.email!,
      reason: 'Owner marked do-not-contact in Phase 17 test',
      createdBy: 'Owner',
    });
    await assert.rejects(
      () => markMessageManuallySent(facade, { messageId: draft.id, actor: 'Owner' }),
      /suppressed|cancelled|do_not_contact|approved/i
    );
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    leedCache.clearAll();
    cleanup();
  }
});
