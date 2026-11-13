/**
 * LEED Phase 4 Verification Suite
 * Unified Connector Architecture: Standardized Contracts, Registry, Encrypted Credentials,
 * Execution Engine, 13 Error Categories, Data Normalization & Trust Hierarchy,
 * 8-State Health, Run Ledger, Migration 004 Inspection, and Security Regressions.
 *
 * All network and database interactions in this suite use isolated in-memory mocks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';

import {
  ConnectorRegistry,
  mapHealthStateToLegacyStatus,
} from '../server/connectors/core/registry.js';
import {
  classifyConnectorError,
  classifyHttpStatus,
  ConnectorError,
  isRetryableCategory,
  redactSecrets,
} from '../server/connectors/core/errors.js';
import { CredentialManager } from '../server/connectors/core/credentialManager.js';
import { ConnectorExecutionEngine } from '../server/connectors/core/executionEngine.js';
import {
  mergeProviderObservationIntoLead,
  normalizeConnectorResult,
  normalizeConnectorResults,
} from '../server/connectors/core/normalizer.js';
import {
  ClassifiedConnectorError,
  ConnectionValidationResult,
  ConnectorErrorCategory,
  ConnectorExecutionContext,
  ConnectorHealthReport,
  ConnectorHealthState,
  ConnectorLookupRequest,
  ConnectorLookupResponse,
  ConnectorMetadata,
  ConnectorRuntimeState,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
  StandardizedConnectorResult,
} from '../server/connectors/core/types.js';
import {
  aggregateRunsByConnector,
  buildUnifiedConnectorStatus,
  connectorRegistry,
  ensureConnectorsRegistered,
} from '../server/connectors/index.js';
import { Migrator } from '../server/db/migrator.js';
import { PostgresStorage } from '../server/db/storagePg.js';
import { BrregConnector } from '../server/connectors/adapters/brregAdapter.js';
import { CompaniesHouseConnector } from '../server/connectors/adapters/companiesHouseAdapter.js';
import { AbnConnector } from '../server/connectors/adapters/abnAdapter.js';
import { OsmConnector } from '../server/connectors/adapters/osmAdapter.js';

function createMockConnector(
  id: string,
  overrides: Partial<ConnectorMetadata> = {},
  handlers: {
    search?: (req: ConnectorSearchRequest, ctx: ConnectorExecutionContext) => Promise<ConnectorSearchResponse>;
    lookupById?: (req: ConnectorLookupRequest, ctx: ConnectorExecutionContext) => Promise<ConnectorLookupResponse>;
    validateConnection?: (ctx: ConnectorExecutionContext) => Promise<ConnectionValidationResult>;
  } = {}
): IConnector {
  const metadata: ConnectorMetadata = {
    id,
    name: overrides.name || `Mock Provider (${id})`,
    shortName: overrides.shortName || id,
    version: '1.0.0',
    sourceCategory: overrides.sourceCategory || 'business_directory',
    accessMode: overrides.accessMode || 'live_api',
    description: 'Isolated test connector',
    supportedCountries: overrides.supportedCountries || ['NO', 'GB'],
    supportsAllCountries: overrides.supportsAllCountries ?? false,
    supportsRegionFilter: overrides.supportsRegionFilter ?? true,
    supportsCityFilter: overrides.supportsCityFilter ?? true,
    supportedIdentifierTypes: overrides.supportedIdentifierTypes || ['LOCAL_REG'],
    capabilities: overrides.capabilities || ['company_search', 'registry_lookup', 'connection_test'],
    credentialRequirements: overrides.credentialRequirements || {
      authType: 'none_open',
      required: false,
      fields: [],
      envFallbackKeys: [],
      setupInstructions: 'No credentials required',
    },
    executionPolicy: overrides.executionPolicy || {
      timeoutMs: 2000,
      maxRetries: 2,
      baseBackoffMs: 10,
      maxBackoffMs: 40,
      maxConcurrency: 2,
      rateLimit: {
        maxRequests: 10,
        windowMs: 60_000,
        note: '10 req/min',
        waitOnLimit: false,
      },
      defaultPageSize: 10,
      maxPageSize: 50,
    },
    attribution: 'Mock Attribution',
    license: 'MIT',
  };

  return {
    id,
    getMetadata: () => metadata,
    validateConnection:
      handlers.validateConnection ||
      (async () => ({
        ok: true,
        healthState: 'operational',
        latencyMs: 5,
        isLiveApi: metadata.accessMode === 'live_api',
        message: 'Mock validated',
        checkedAt: new Date().toISOString(),
      })),
    search:
      handlers.search ||
      (async (req) => ({
        results: [
          {
            providerId: id,
            providerName: metadata.name,
            sourceCategory: metadata.sourceCategory,
            accessMode: metadata.accessMode,
            countryCode: req.countryCode || 'NO',
            externalSourceId: `${id}-1`,
            company: {
              companyName: 'Mock Nordic AS',
              registrationNumber: '923609016',
              registrationType: 'NO_ORG',
              address: { countryCode: req.countryCode || 'NO', city: req.city || 'Oslo' },
            },
            retrievedAt: new Date().toISOString(),
            verificationStatus: 'directory_listed',
            providerMetadata: {},
          },
        ],
        pagination: { page: req.page || 1, pageSize: req.pageSize || 10, hasMore: false },
        rawCount: 1,
        attribution: metadata.attribution,
        notes: [],
        isLiveApi: metadata.accessMode === 'live_api',
      })),
    lookupById: handlers.lookupById,
    normalizeResult: (raw, retrievedAt) => raw as StandardizedConnectorResult,
    classifyError: (err): ClassifiedConnectorError => classifyConnectorError(err, id),
    getHealth: (state: ConnectorRuntimeState): ConnectorHealthReport => {
      const reg = new ConnectorRegistry();
      return reg.computeHealthReport(
        {
          id,
          getMetadata: () => metadata,
        } as unknown as IConnector,
        state
      );
    },
  };
}

function createMockCredentialPool() {
  const rows = new Map<string, any>();
  const queries: Array<{ sql: string; params?: any[] }> = [];

  const pool = {
    query: async (sql: string, params: any[] = []) => {
      queries.push({ sql, params });
      const normalized = sql.replace(/\s+/g, ' ').trim();

      if (normalized.startsWith('SELECT connector_id, auth_type, status,')) {
        const row = rows.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (normalized.startsWith('SELECT encrypted_payload, status FROM connector_credentials')) {
        const row = rows.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (normalized.startsWith('INSERT INTO connector_credentials')) {
        const [id, connector_id, auth_type, encrypted_payload, masked_hint, rotated_at] = params;
        const prev = rows.get(connector_id);
        rows.set(connector_id, {
          id,
          connector_id,
          auth_type,
          encrypted_payload,
          status: 'configured',
          key_version: prev ? Number(prev.key_version || 1) + 1 : 1,
          masked_hint,
          rotated_at: prev ? new Date().toISOString() : rotated_at,
          validated_at: null,
          validation_status: 'pending_validation',
          updated_at: new Date().toISOString(),
        });
        return { rows: [], rowCount: 1 };
      }

      if (normalized.startsWith('DELETE FROM connector_credentials')) {
        const existed = rows.delete(params[0]);
        return { rows: [], rowCount: existed ? 1 : 0 };
      }

      if (normalized.startsWith('UPDATE connector_credentials')) {
        const [connector_id, validation_status] = params;
        const prev = rows.get(connector_id);
        if (prev) {
          prev.validated_at = new Date().toISOString();
          prev.validation_status = validation_status;
          prev.updated_at = new Date().toISOString();
        }
        return { rows: [], rowCount: prev ? 1 : 0 };
      }

      return { rows: [], rowCount: 0 };
    },
  } as unknown as pg.Pool;

  return { pool, rows, queries };
}

describe('LEED Phase 4 Unified Connector Architecture Verification Suite', () => {
  describe('1. Connector Preservation, Standardized Metadata & Honest Classification', () => {
    it('preserves all 6 existing connector IDs and metadata via the default registry', () => {
      ensureConnectorsRegistered();
      const ids = connectorRegistry
        .listAll()
        .map((c) => c.id)
        .sort();

      assert.deepStrictEqual(ids, [
        'conn-abn',
        'conn-brreg',
        'conn-companies-house',
        'conn-gemini',
        'conn-osm',
        'conn-web-inspector',
      ]);
    });

    it('honestly classifies conn-abn as offline_reference and not a live API', () => {
      const abn = new AbnConnector();
      const meta = abn.getMetadata();
      assert.strictEqual(meta.accessMode, 'offline_reference');
      assert.strictEqual(meta.sourceCategory, 'government_registry');
      assert.strictEqual(meta.credentialRequirements.required, true);
      assert.deepStrictEqual(meta.credentialRequirements.envFallbackKeys, ['ABR_GUID']);
    });

    it('honestly refuses to claim operational health merely because a connector is registered', async () => {
      const reg = new ConnectorRegistry();
      const conn = createMockConnector('conn-untested');
      reg.register(conn);

      const status = await buildUnifiedConnectorStatus(conn, {
        credMgr: new CredentialManager(),
        engine: new ConnectorExecutionEngine(new CredentialManager()),
      });

      assert.strictEqual(status.healthState, 'not_tested');
      assert.strictEqual(status.operational, false);
    });

    it('never invents confidence scores when provider marks confidence.supported=false', () => {
      const res = normalizeConnectorResult({
        providerId: 'conn-osm',
        providerName: 'OpenStreetMap',
        sourceCategory: 'maps_geo',
        accessMode: 'public_directory',
        countryCode: 'DE',
        externalSourceId: 'node-9911',
        company: {
          companyName: 'Berlin Optics GmbH',
          address: { city: 'Berlin', countryCode: 'DE' },
        },
        retrievedAt: new Date().toISOString(),
        verificationStatus: 'directory_listed',
        confidence: { supported: false },
        providerMetadata: {},
      });

      assert.ok(res.lead);
      assert.strictEqual(res.lead.confidenceScore, 0);
      assert.deepStrictEqual(res.lead.confidenceSignals, []);
    });
  });

  describe('2. Central ConnectorRegistry Filtering & Lifecycle', () => {
    it('registers, guards ID mismatches, and filters by country, capability, and sourceCategory', () => {
      const reg = new ConnectorRegistry();
      const noConn = createMockConnector('conn-no-only', {
        supportedCountries: ['NO'],
        sourceCategory: 'government_registry',
        capabilities: ['company_search', 'registry_lookup'],
      });
      const globalMap = createMockConnector('conn-global-map', {
        supportedCountries: [],
        supportsAllCountries: true,
        sourceCategory: 'maps_geo',
        capabilities: ['company_search', 'poi_search'],
      });
      const inspector = createMockConnector('conn-inspector', {
        supportedCountries: [],
        supportsAllCountries: true,
        sourceCategory: 'website_intelligence',
        capabilities: ['website_inspection'],
      });

      reg.register(noConn);
      reg.register(globalMap);
      reg.register(inspector);

      assert.throws(() => {
        reg.register({
          id: 'conn-mismatch',
          getMetadata: () => ({ ...noConn.getMetadata(), id: 'conn-different' }),
        } as unknown as IConnector);
      }, /Connector ID mismatch/);

      assert.deepStrictEqual(
        reg.filterByCountry('NO').map((c) => c.id).sort(),
        ['conn-global-map', 'conn-inspector', 'conn-no-only']
      );
      assert.deepStrictEqual(
        reg.filterByCountry('JP').map((c) => c.id).sort(),
        ['conn-global-map', 'conn-inspector']
      );
      assert.deepStrictEqual(
        reg.filterByCapability('poi_search').map((c) => c.id),
        ['conn-global-map']
      );
      assert.deepStrictEqual(
        reg
          .filter({ country: 'NO', capability: 'company_search', category: 'government_registry' })
          .map((c) => c.id),
        ['conn-no-only']
      );

      reg.setEnabledOverride('conn-no-only', false);
      assert.strictEqual(reg.isEnabled('conn-no-only'), false);
      reg.unregister('conn-no-only');
      assert.strictEqual(reg.getById('conn-no-only'), undefined);
    });
  });

  describe('3. Credential Management, AES-256-GCM Encryption, Masking & Key Requirement', () => {
    it('reports missing CONNECTOR_ENCRYPTION_KEY instead of inventing a hardcoded fallback key', async () => {
      const origConnKey = process.env.CONNECTOR_ENCRYPTION_KEY;
      const origAppKey = process.env.APP_ENCRYPTION_KEY;
      delete process.env.CONNECTOR_ENCRYPTION_KEY;
      delete process.env.APP_ENCRYPTION_KEY;

      try {
        const cm = new CredentialManager();
        const encStatus = cm.getEncryptionStatus();
        assert.strictEqual(encStatus.configured, false);
        assert.strictEqual(encStatus.source, 'missing');
        assert.match(encStatus.requirementMessage || '', /CONNECTOR_ENCRYPTION_KEY/);

        assert.throws(() => {
          cm.encryptPayload({ apiKey: 'secret-123456' }, 'conn-companies-house');
        }, (err: any) => err instanceof ConnectorError && err.category === 'configuration_error');
      } finally {
        if (origConnKey !== undefined) process.env.CONNECTOR_ENCRYPTION_KEY = origConnKey;
        else delete process.env.CONNECTOR_ENCRYPTION_KEY;
        if (origAppKey !== undefined) process.env.APP_ENCRYPTION_KEY = origAppKey;
        else delete process.env.APP_ENCRYPTION_KEY;
      }
    });

    it('encrypts at rest, masks hints, rotates key_version, removes secrets, and protects against empty overwrites', async () => {
      const origConnKey = process.env.CONNECTOR_ENCRYPTION_KEY;
      process.env.CONNECTOR_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      const ch = new CompaniesHouseConnector();
      const chReq = ch.getMetadata().credentialRequirements;
      const { pool, rows } = createMockCredentialPool();

      try {
        const cm = new CredentialManager();
        assert.strictEqual(cm.getEncryptionStatus().configured, true);

        const initialStatus = await cm.setCredential(
          'conn-companies-house',
          { apiKey: 'ch-live-secret-998877' },
          chReq,
          { customPool: pool }
        );

        assert.strictEqual(initialStatus.configured, true);
        assert.strictEqual(initialStatus.source, 'database_encrypted');
        assert.strictEqual(initialStatus.maskedHint, '••••8877');
        assert.doesNotMatch(JSON.stringify(initialStatus), /ch-live-secret-998877/);

        const storedRow = rows.get('conn-companies-house');
        assert.ok(storedRow);
        assert.doesNotMatch(storedRow.encrypted_payload, /ch-live-secret-998877/);
        assert.strictEqual(storedRow.key_version, 1);

        // Decryption for backend execution works and captures knownSecrets
        const resolved = await cm.resolveCredentialForExecution('conn-companies-house', chReq, pool);
        assert.strictEqual(resolved.credentials.apiKey, 'ch-live-secret-998877');
        assert.strictEqual(resolved.source, 'database_encrypted');

        // Empty payload must be rejected WITHOUT overwriting existing working credential
        await assert.rejects(
          () => cm.setCredential('conn-companies-house', { apiKey: '   ' }, chReq, { customPool: pool }),
          (err: any) => err instanceof ConnectorError && err.category === 'invalid_request'
        );
        const afterInvalid = await cm.resolveCredentialForExecution('conn-companies-house', chReq, pool);
        assert.strictEqual(afterInvalid.credentials.apiKey, 'ch-live-secret-998877');

        // Rotation bumps key_version and rotatedAt
        const rotatedStatus = await cm.setCredential(
          'conn-companies-house',
          { apiKey: 'ch-live-rotated-4455' },
          chReq,
          { isRotation: true, customPool: pool }
        );
        assert.strictEqual(rotatedStatus.maskedHint, '••••4455');
        assert.strictEqual(rows.get('conn-companies-house').key_version, 2);

        // Removal deletes row cleanly
        const removed = await cm.removeCredential('conn-companies-house', chReq, pool);
        assert.strictEqual(rows.has('conn-companies-house'), false);
        assert.strictEqual(removed.source, process.env.COMPANIES_HOUSE_API_KEY ? 'environment' : 'missing');
      } finally {
        if (origConnKey !== undefined) process.env.CONNECTOR_ENCRYPTION_KEY = origConnKey;
        else delete process.env.CONNECTOR_ENCRYPTION_KEY;
      }
    });

    it('PostgresStorage.updateSettings preserves existing encrypted credentials when companiesHouseApiKey is omitted', async () => {
      const pgStore = new PostgresStorage();
      const queries: string[] = [];
      const mockClient = {
        query: async (sql: string) => {
          queries.push(sql);
          if (sql.includes('FROM app_settings')) {
            return {
              rows: [
                {
                  owner_name: 'Owner',
                  owner_email: 'owner@leed.local',
                  default_country: 'NO',
                  default_currency: 'NOK',
                  user_agent: 'LEED-Test/1.0',
                  enable_safe_website_crawl: true,
                  outreach_approval_required: true,
                  auto_dedupe_threshold: 88,
                  suppression_domains: [],
                  connector_configs: {},
                },
              ],
            };
          }
          return { rows: [] };
        },
        release: () => {},
      };
      const mockPool = {
        connect: async () => mockClient,
        query: mockClient.query,
      };
      (pgStore as any).getClient = () => mockPool;

      await pgStore.updateSettings({ ownerName: 'Updated Owner Name' });
      await pgStore.updateSettings({ ownerName: 'Updated Owner Name 2', companiesHouseApiKey: '   ' });
      const mutatedCredentials = queries.some(
        (q) =>
          q.includes('connector_credentials') &&
          /^\s*(INSERT|UPDATE|DELETE)/i.test(q)
      );
      assert.strictEqual(
        mutatedCredentials,
        false,
        'updateSettings without non-empty companiesHouseApiKey must never mutate or wipe connector_credentials'
      );
    });

    it('PostgresStorage.recordConnectorRun and getConnectorRuns persist and retrieve execution history cleanly', async () => {
      const pgStore = new PostgresStorage();
      const storedRuns: any[] = [];
      const mockClient = {
        query: async (sql: string, params: any[] = []) => {
          if (sql.includes('INSERT INTO connector_runs')) {
            storedRuns.push({
              id: params[0],
              connector_id: params[1],
              query_params: params[2],
              total_found: params[3],
              total_saved: params[4],
              status: params[5],
              error_message: params[6],
              executed_at: params[7],
              operation: params[8],
              started_at: params[9],
              completed_at: params[10],
              duration_ms: params[11],
              records_discovered: params[12],
              records_normalized: params[13],
              records_rejected: params[14],
              error_category: params[15],
              diagnostic_summary: params[16],
              rate_limit_remaining: params[17],
              rate_limit_reset_at: params[18],
              request_id: params[19],
            });
            return { rows: [] };
          }
          if (sql.includes('FROM connector_runs')) {
            const filtered = params.length === 2 ? storedRuns.filter((r) => r.connector_id === params[0]) : storedRuns;
            return { rows: filtered };
          }
          return { rows: [] };
        },
        release: () => {},
      };
      (pgStore as any).getClient = () => ({ connect: async () => mockClient, query: mockClient.query });

      await pgStore.recordConnectorRun({
        id: 'run-pg-1',
        connectorId: 'conn-brreg',
        operation: 'search',
        queryParams: { query: 'Nordic' },
        startedAt: '2026-11-12T12:00:00.000Z',
        completedAt: '2026-11-12T12:00:01.000Z',
        durationMs: 1000,
        status: 'success',
        recordsDiscovered: 4,
        recordsNormalized: 4,
        recordsRejected: 0,
        diagnosticSummary: 'Discovered 4, normalized 4',
        rateLimitRemaining: 59,
        requestId: 'req-pg-1',
      });

      const fetched = await pgStore.getConnectorRuns('conn-brreg', 10);
      assert.strictEqual(fetched.length, 1);
      assert.strictEqual(fetched[0].id, 'run-pg-1');
      assert.strictEqual(fetched[0].recordsDiscovered, 4);
      assert.strictEqual(fetched[0].operation, 'search');
      assert.strictEqual(fetched[0].rateLimitRemaining, 59);
    });
  });

  describe('4. Execution Engine: Timeouts, Retries, Rate Limits, Concurrency, Coalescing, Pagination & Cancellation', () => {
    it('retries transient provider_unavailable errors up to maxRetries and succeeds on recovery', async () => {
      let attempts = 0;
      const cm = new CredentialManager();
      const engine = new ConnectorExecutionEngine(cm);
      const runs: any[] = [];

      const conn = createMockConnector(
        'conn-retry-transient',
        {
          executionPolicy: {
            timeoutMs: 1000,
            maxRetries: 2,
            baseBackoffMs: 5,
            maxBackoffMs: 15,
            maxConcurrency: 2,
            rateLimit: { maxRequests: 20, windowMs: 60_000, note: '20 req/min' },
            defaultPageSize: 10,
            maxPageSize: 20,
          },
        },
        {
          search: async (req) => {
            attempts++;
            if (attempts < 3) {
              throw new ConnectorError({
                category: 'provider_unavailable',
                providerId: 'conn-retry-transient',
                httpStatus: 503,
                message: 'Upstream temporary 503',
              });
            }
            return {
              results: [],
              pagination: { page: 1, pageSize: 10, hasMore: false },
              rawCount: 0,
              attribution: 'Mock',
              notes: [`Recovered on attempt ${attempts}`],
              isLiveApi: true,
            };
          },
        }
      );

      const outcome = await engine.executeSearch(
        conn,
        { query: 'Nordic', countryCode: 'NO' },
        { onRecordRun: async (r) => void runs.push(r) }
      );

      assert.strictEqual(attempts, 3);
      assert.strictEqual(outcome.runRecord.status, 'success');
      assert.strictEqual(runs.length, 1);
    });

    it('never retries permanent authentication_failure or invalid_request errors', async () => {
      let attempts = 0;
      const cm = new CredentialManager();
      const engine = new ConnectorExecutionEngine(cm);

      const conn = createMockConnector(
        'conn-no-retry-auth',
        {},
        {
          search: async () => {
            attempts++;
            throw new ConnectorError({
              category: 'authentication_failure',
              providerId: 'conn-no-retry-auth',
              httpStatus: 401,
              message: 'Invalid API key sk-supersecret-123456',
            });
          },
        }
      );

      await assert.rejects(
        () => engine.executeSearch(conn, { query: 'Test', countryCode: 'GB' }),
        (err: any) => err instanceof ConnectorError && err.category === 'authentication_failure'
      );
      assert.strictEqual(attempts, 1, '401 auth failure must fail fast without retrying');
    });

    it('aborts slow upstream calls on timeout and supports manual request cancellation', async () => {
      const cm = new CredentialManager();
      const engine = new ConnectorExecutionEngine(cm);

      const slowConn = createMockConnector(
        'conn-slow',
        {
          executionPolicy: {
            timeoutMs: 40,
            maxRetries: 0,
            baseBackoffMs: 5,
            maxBackoffMs: 10,
            maxConcurrency: 2,
            rateLimit: { maxRequests: 10, windowMs: 60_000, note: '10/min' },
            defaultPageSize: 10,
            maxPageSize: 20,
          },
        },
        {
          search: async (_req, ctx) =>
            new Promise((_resolve, reject) => {
              ctx.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
            }),
        }
      );

      await assert.rejects(
        () => engine.executeSearch(slowConn, { query: 'Slow', countryCode: 'NO' }),
        (err: any) => err instanceof ConnectorError && err.category === 'timeout'
      );

      // Manual cancellation by requestId
      const cancellableConn = createMockConnector(
        'conn-cancel',
        {
          executionPolicy: {
            timeoutMs: 5000,
            maxRetries: 0,
            baseBackoffMs: 5,
            maxBackoffMs: 10,
            maxConcurrency: 2,
            rateLimit: { maxRequests: 10, windowMs: 60_000, note: '10/min' },
            defaultPageSize: 10,
            maxPageSize: 20,
          },
        },
        {
          search: async (_req, ctx) =>
            new Promise((_resolve, reject) => {
              ctx.signal.addEventListener('abort', () => reject(new Error('Cancelled by user')), { once: true });
            }),
        }
      );

      const reqId = 'req-manual-cancel-1';
      const pending = engine.executeSearch(
        cancellableConn,
        { query: 'CancelMe', countryCode: 'NO' },
        { requestId: reqId }
      );
      // Give event loop a tick for activeControllers registration
      await new Promise((r) => setTimeout(r, 15));
      assert.strictEqual(engine.cancelExecution(reqId), true);
      await assert.rejects(() => pending);
    });

    it('enforces per-provider rate limiting and coalesces duplicate concurrent in-flight requests', async () => {
      const cm = new CredentialManager();
      const engine = new ConnectorExecutionEngine(cm);
      let upstreamCalls = 0;

      const conn = createMockConnector(
        'conn-rl-dedupe',
        {
          executionPolicy: {
            timeoutMs: 2000,
            maxRetries: 0,
            baseBackoffMs: 5,
            maxBackoffMs: 10,
            maxConcurrency: 4,
            rateLimit: { maxRequests: 2, windowMs: 60_000, note: '2 req/min', waitOnLimit: false },
            defaultPageSize: 10,
            maxPageSize: 20,
          },
        },
        {
          search: async (req) => {
            upstreamCalls++;
            await new Promise((r) => setTimeout(r, 25));
            return {
              results: [],
              pagination: { page: 1, pageSize: 10, hasMore: false },
              rawCount: 0,
              attribution: 'Mock',
              notes: [],
              isLiveApi: true,
            };
          },
        }
      );

      // Two identical concurrent requests should coalesce into 1 upstream call
      await Promise.all([
        engine.executeSearch(conn, { query: 'SameQuery', countryCode: 'NO' }),
        engine.executeSearch(conn, { query: 'SameQuery', countryCode: 'NO' }),
      ]);
      assert.strictEqual(upstreamCalls, 1);

      // Second distinct query succeeds (2/2 limit used)
      await engine.executeSearch(conn, { query: 'QueryTwo', countryCode: 'NO' });
      assert.strictEqual(upstreamCalls, 2);

      // Third distinct query within window triggers rate_limited
      await assert.rejects(
        () => engine.executeSearch(conn, { query: 'QueryThree', countryCode: 'NO' }),
        (err: any) => err instanceof ConnectorError && err.category === 'rate_limited'
      );
    });

    it('handles multi-page pagination when fetchAllPages=true and deduplicates by externalSourceId', async () => {
      const cm = new CredentialManager();
      const engine = new ConnectorExecutionEngine(cm);
      const pagesRequested: number[] = [];

      const conn = createMockConnector(
        'conn-paged',
        {},
        {
          search: async (req) => {
            const p = req.page || 1;
            pagesRequested.push(p);
            const item = (extId: string, name: string): StandardizedConnectorResult => ({
              providerId: 'conn-paged',
              providerName: 'Paged Provider',
              sourceCategory: 'business_directory',
              accessMode: 'live_api',
              countryCode: 'GB',
              externalSourceId: extId,
              company: { companyName: name, address: { countryCode: 'GB' } },
              retrievedAt: new Date().toISOString(),
              verificationStatus: 'directory_listed',
              providerMetadata: {},
            });

            if (p === 1) {
              return {
                results: [item('id-1', 'Alpha Ltd'), item('id-2', 'Beta Ltd')],
                pagination: { page: 1, pageSize: 2, totalItems: 3, totalPages: 2, hasMore: true },
                rawCount: 2,
                attribution: 'Mock',
                notes: [],
                isLiveApi: true,
              };
            }
            return {
              // Include duplicate id-2 to ensure deduplication across pages
              results: [item('id-2', 'Beta Ltd'), item('id-3', 'Gamma Ltd')],
              pagination: { page: 2, pageSize: 2, totalItems: 3, totalPages: 2, hasMore: false },
              rawCount: 2,
              attribution: 'Mock',
              notes: [],
              isLiveApi: true,
            };
          },
        }
      );

      const outcome = await engine.executeSearch(conn, {
        query: 'Ltd',
        countryCode: 'GB',
        pageSize: 2,
        fetchAllPages: true,
        maxPages: 3,
      });

      assert.deepStrictEqual(pagesRequested, [1, 2]);
      assert.strictEqual(outcome.response.results.length, 3);
      assert.strictEqual(outcome.normalization.normalized, 3);
    });
  });

  describe('5. Standardized 13 Error Categories & Secret Redaction', () => {
    it('classifies HTTP statuses and runtime errors accurately across all standardized categories', () => {
      const allCategories: ConnectorErrorCategory[] = [
        'authentication_failure',
        'authorization_failure',
        'rate_limited',
        'timeout',
        'network_failure',
        'provider_unavailable',
        'invalid_response',
        'invalid_request',
        'unsupported_country',
        'unsupported_capability',
        'missing_credentials',
        'configuration_error',
        'unknown_provider_error',
      ];
      assert.strictEqual(allCategories.length, 13);

      assert.strictEqual(classifyHttpStatus(401).category, 'authentication_failure');
      assert.strictEqual(classifyHttpStatus(403).category, 'authorization_failure');
      assert.strictEqual(classifyHttpStatus(429).category, 'rate_limited');
      assert.strictEqual(classifyHttpStatus(400).category, 'invalid_request');
      assert.strictEqual(classifyHttpStatus(504).category, 'timeout');
      assert.strictEqual(classifyHttpStatus(503).category, 'provider_unavailable');

      assert.strictEqual(isRetryableCategory('timeout'), true);
      assert.strictEqual(isRetryableCategory('network_failure'), true);
      assert.strictEqual(isRetryableCategory('provider_unavailable'), true);
      assert.strictEqual(isRetryableCategory('authentication_failure'), false);
      assert.strictEqual(isRetryableCategory('invalid_request'), false);

      assert.strictEqual(
        classifyConnectorError(new Error('connect ECONNREFUSED 127.0.0.1:443'), 'conn-test').category,
        'network_failure'
      );
      assert.strictEqual(
        classifyConnectorError(new Error('Unexpected token < in JSON'), 'conn-test').category,
        'invalid_response'
      );
    });

    it('redacts Basic/Bearer tokens, API keys, URL passwords, and knownSecrets from errors', () => {
      const secret = 'my-secret-ch-key-991122';
      const raw = `GET https://user:dbpass@host.test/api?key=${secret} failed with Basic YWJjZGVmMTIzNDU2 and AIzaSyDummyKeyValue1234567890123`;
      const cleaned = redactSecrets(raw, [secret]);

      assert.doesNotMatch(cleaned, /my-secret-ch-key-991122/);
      assert.doesNotMatch(cleaned, /dbpass/);
      assert.doesNotMatch(cleaned, /YWJjZGVmMTIzNDU2/);
      assert.doesNotMatch(cleaned, /AIzaSyDummyKeyValue/);
      assert.match(cleaned, /\[REDACTED\]/);
    });
  });

  describe('6. Data Normalization, Phase 3 Identifiers, and Multi-Source Trust Hierarchy', () => {
    it('normalizes results with Phase 3 canonical identifiers and E.164 phone numbers, rejecting missing names', () => {
      const batch = normalizeConnectorResults([
        {
          providerId: 'conn-brreg',
          providerName: 'Brønnøysundregistrene',
          sourceCategory: 'government_registry',
          accessMode: 'live_api',
          countryCode: 'NO',
          externalSourceId: '923609016',
          company: {
            companyName: 'NORDIC SEMICONDUCTOR ASA',
            registrationNumber: '923609016',
            registrationType: 'ORGNR',
            phone: '+47 72 89 89 00',
            website: 'nordicsemi.com',
            address: {
              street: 'Otto Nielsens veg 12',
              city: 'Trondheim',
              postalCode: '7052',
              countryCode: 'NO',
            },
          },
          retrievedAt: '2026-11-12T10:00:00.000Z',
          verificationStatus: 'officially_verified',
          confidence: { supported: true, score: 96, signals: ['Official Norwegian Registry'] },
          providerMetadata: {},
        },
        {
          providerId: 'conn-osm',
          providerName: 'OpenStreetMap',
          sourceCategory: 'maps_geo',
          accessMode: 'public_directory',
          countryCode: 'NO',
          externalSourceId: 'node-empty',
          company: { companyName: '   ' },
          retrievedAt: '2026-11-12T10:00:00.000Z',
          verificationStatus: 'directory_listed',
          providerMetadata: {},
        },
      ]);

      assert.strictEqual(batch.discovered, 2);
      assert.strictEqual(batch.normalized, 1);
      assert.strictEqual(batch.rejected, 1);
      assert.strictEqual(batch.leads[0].registrationType, 'NO_ORG');
      assert.strictEqual(batch.leads[0].phoneNormalized, '+4772898900');
      assert.strictEqual(batch.leads[0].domain, 'nordicsemi.com');
      assert.strictEqual(batch.leads[0].identifiers[0].verified, true);
    });

    it('preserves officially_verified data when weaker directory_listed source contributes missing fields', () => {
      const officialLead = normalizeConnectorResult({
        providerId: 'conn-brreg',
        providerName: 'Brreg',
        sourceCategory: 'government_registry',
        accessMode: 'live_api',
        countryCode: 'NO',
        externalSourceId: '923609016',
        company: {
          companyName: 'NORDIC SEMICONDUCTOR ASA',
          registrationNumber: '923609016',
          registrationType: 'NO_ORG',
          address: {
            street: 'Otto Nielsens veg 12',
            city: 'Trondheim',
            postalCode: '7052',
            countryCode: 'NO',
          },
        },
        retrievedAt: '2026-11-12T10:00:00.000Z',
        verificationStatus: 'officially_verified',
        confidence: { supported: true, score: 95, signals: ['Brreg Verified'] },
        providerMetadata: {},
      }).lead!;

      const weakerDirectoryLead = normalizeConnectorResult({
        providerId: 'conn-osm',
        providerName: 'OpenStreetMap',
        sourceCategory: 'maps_geo',
        accessMode: 'public_directory',
        countryCode: 'NO',
        externalSourceId: 'node-882',
        company: {
          companyName: 'Nordic Semi Office Cafe',
          website: 'https://www.nordicsemi.com',
          phone: '+4772898900',
          address: {
            street: 'Wrong Unverified Street 99',
            city: 'Oslo',
            countryCode: 'NO',
          },
        },
        retrievedAt: '2026-11-12T10:05:00.000Z',
        verificationStatus: 'directory_listed',
        confidence: { supported: true, score: 50, signals: ['OSM Node'] },
        providerMetadata: {},
      }).lead!;

      const merged = mergeProviderObservationIntoLead(officialLead, weakerDirectoryLead);

      // Official fields MUST NOT be overwritten by weaker directory observation
      assert.strictEqual(merged.companyName, 'NORDIC SEMICONDUCTOR ASA');
      assert.strictEqual(merged.registrationNumber, '923609016');
      assert.strictEqual(merged.address?.street, 'Otto Nielsens veg 12');
      assert.strictEqual(merged.address?.city, 'Trondheim');

      // Missing non-conflicting enrichment fields from weaker source ARE added
      assert.strictEqual(merged.website, 'https://www.nordicsemi.com');
      assert.strictEqual(merged.phoneNormalized, '+4772898900');
      assert.strictEqual(merged.sources.length, 2);
    });
  });

  describe('7. 8-State Connector Health, Execution History & Migration 004 Inspection', () => {
    it('computes all 8 health states cleanly from runtime metrics and credential state', () => {
      const reg = new ConnectorRegistry();
      const ch = new CompaniesHouseConnector();
      const brreg = new BrregConnector();

      const baseState = (overrides: Partial<ConnectorRuntimeState>): ConnectorRuntimeState => ({
        enabled: true,
        credentialStatus: {
          connectorId: brreg.id,
          authType: 'none_open',
          required: false,
          configured: true,
          source: 'none_required',
          encryptionKeyConfigured: true,
        },
        totalCalls: 1,
        recentSuccessCount: 1,
        recentFailureCount: 0,
        consecutiveFailures: 0,
        ...overrides,
      });

      const assertState = (conn: IConnector, state: ConnectorRuntimeState, expected: ConnectorHealthState) => {
        const rep = reg.computeHealthReport(conn, state);
        assert.strictEqual(rep.healthState, expected);
      };

      assertState(brreg, baseState({ enabled: false }), 'disabled');
      assertState(
        ch,
        baseState({
          credentialStatus: {
            connectorId: ch.id,
            authType: 'basic_auth',
            required: true,
            configured: false,
            source: 'database_encrypted',
            encryptionKeyConfigured: false,
            encryptionRequirement: 'Missing CONNECTOR_ENCRYPTION_KEY',
          },
        }),
        'configuration_required'
      );
      assertState(
        ch,
        baseState({
          credentialStatus: {
            connectorId: ch.id,
            authType: 'basic_auth',
            required: true,
            configured: false,
            source: 'missing',
            encryptionKeyConfigured: true,
          },
        }),
        'authentication_required'
      );
      assertState(
        brreg,
        baseState({ consecutiveFailures: 1, lastErrorCategory: 'rate_limited', lastError: 'HTTP 429' }),
        'rate_limited'
      );
      assertState(
        brreg,
        baseState({ consecutiveFailures: 3, lastErrorCategory: 'provider_unavailable', lastError: '503' }),
        'temporarily_unavailable'
      );
      assertState(
        brreg,
        baseState({ consecutiveFailures: 1, lastErrorCategory: 'invalid_response', lastError: 'Bad JSON' }),
        'degraded'
      );
      assertState(brreg, baseState({ totalCalls: 0, lastSuccessAt: undefined, lastValidation: undefined }), 'not_tested');
      assertState(
        brreg,
        baseState({
          totalCalls: 2,
          lastSuccessAt: new Date().toISOString(),
          lastValidation: { ok: true, checkedAt: new Date().toISOString(), latencyMs: 120 },
        }),
        'operational'
      );

      assert.strictEqual(mapHealthStateToLegacyStatus('operational'), 'healthy');
      assert.strictEqual(mapHealthStateToLegacyStatus('not_tested'), 'configured');
      assert.strictEqual(mapHealthStateToLegacyStatus('authentication_required'), 'unconfigured');
      assert.strictEqual(mapHealthStateToLegacyStatus('rate_limited'), 'rate_limited');
      assert.strictEqual(mapHealthStateToLegacyStatus('disabled'), 'degraded');
    });

    it('aggregates consecutive failures & validation status per connector from ConnectorRunRecord history', () => {
      const map = aggregateRunsByConnector([
        {
          id: 'r1',
          connectorId: 'conn-brreg',
          operation: 'search',
          startedAt: '2026-11-12T10:00:00.000Z',
          completedAt: '2026-11-12T10:00:01.000Z',
          durationMs: 1000,
          status: 'success',
          recordsDiscovered: 5,
          recordsNormalized: 5,
          recordsRejected: 0,
        },
        {
          id: 'r2',
          connectorId: 'conn-brreg',
          operation: 'health_check',
          startedAt: '2026-11-12T10:05:00.000Z',
          completedAt: '2026-11-12T10:05:01.000Z',
          durationMs: 400,
          status: 'error',
          recordsDiscovered: 0,
          recordsNormalized: 0,
          recordsRejected: 0,
          errorCategory: 'provider_unavailable',
          diagnosticSummary: 'HTTP 503',
        },
        {
          id: 'r3',
          connectorId: 'conn-brreg',
          operation: 'search',
          startedAt: '2026-11-12T10:06:00.000Z',
          completedAt: '2026-11-12T10:06:01.000Z',
          durationMs: 500,
          status: 'error',
          recordsDiscovered: 0,
          recordsNormalized: 0,
          recordsRejected: 0,
          errorCategory: 'provider_unavailable',
          diagnosticSummary: 'HTTP 503 again',
        },
      ]);

      const stats = map.get('conn-brreg')!;
      assert.strictEqual(stats.totalCalls, 3);
      assert.strictEqual(stats.recentSuccessCount, 1);
      assert.strictEqual(stats.recentFailureCount, 2);
      assert.strictEqual(stats.consecutiveFailures, 2);
      assert.strictEqual(stats.lastValidation?.ok, false);
      assert.strictEqual(stats.lastErrorCategory, 'provider_unavailable');
    });

    it('verifies Migration 004 SQL scripts and Migrator.inspectMigrationStatus() readiness checks', async () => {
      const root = process.cwd();
      const upSql = fs.readFileSync(
        path.join(root, 'server/db/migrations/004_unified_connector_architecture.sql'),
        'utf-8'
      );
      const downSql = fs.readFileSync(
        path.join(root, 'server/db/migrations/004_unified_connector_architecture.down.sql'),
        'utf-8'
      );

      assert.match(upSql, /ALTER TABLE connector_credentials/);
      assert.match(upSql, /ALTER TABLE connector_runs/);
      assert.match(upSql, /connector_configs JSONB/);
      assert.match(downSql, /DROP COLUMN IF EXISTS request_id/);

      const expected004CredCols = [
        'key_version',
        'masked_hint',
        'rotated_at',
        'validated_at',
        'validation_status',
      ];
      const expected004RunCols = [
        'operation',
        'started_at',
        'completed_at',
        'duration_ms',
        'records_discovered',
        'records_normalized',
        'records_rejected',
        'error_category',
        'diagnostic_summary',
        'rate_limit_remaining',
        'rate_limit_reset_at',
        'request_id',
      ];
      const expected004SettingsCols = ['connector_configs'];

      const mockClient = {
        query: async (sql: string) => {
          if (sql.includes('to_regclass')) {
            return { rows: [{ mig_tbl: 'schema_migrations', cap_tbl: 'country_source_capabilities' }] };
          }
          if (sql.includes('FROM schema_migrations')) {
            return {
              rows: [
                { version: '001', name: '001_initial_schema.sql', applied_at: '2026-11-10T00:00:00Z' },
                { version: '002', name: '002_owner_singleton_and_audit_integrity.sql', applied_at: '2026-11-10T00:01:00Z' },
                { version: '003', name: '003_global_intelligence.sql', applied_at: '2026-11-11T00:00:00Z' },
                { version: '004', name: '004_unified_connector_architecture.sql', applied_at: '2026-11-12T00:00:00Z' },
              ],
            };
          }
          if (sql.includes("table_name = 'lead_identifiers'")) {
            return {
              rows: ['country_code', 'normalized_value', 'issuing_authority', 'source', 'status'].map(
                (column_name) => ({ column_name })
              ),
            };
          }
          if (sql.includes("table_name = 'connector_credentials'")) {
            return { rows: expected004CredCols.map((column_name) => ({ column_name })) };
          }
          if (sql.includes("table_name = 'connector_runs'")) {
            return { rows: expected004RunCols.map((column_name) => ({ column_name })) };
          }
          if (sql.includes("table_name = 'app_settings'")) {
            return { rows: expected004SettingsCols.map((column_name) => ({ column_name })) };
          }
          if (sql.includes('pg_indexes')) {
            return {
              rows: [
                'idx_lead_identifiers_normalized',
                'idx_lead_identifiers_country',
                'idx_lead_identifiers_status',
                'idx_leads_city',
                'idx_leads_region',
                'idx_leads_country',
                'idx_country_caps_code',
                'idx_country_caps_status',
                'idx_connector_runs_conn_executed',
                'idx_connector_runs_status',
              ].map((indexname) => ({ indexname })),
            };
          }
          return { rows: [] };
        },
        release: () => {},
      } as unknown as pg.PoolClient;

      const migrator = new Migrator();
      const status = await migrator.inspectMigrationStatus(mockClient);
      assert.strictEqual(status.migrations001To003Recorded, true);
      assert.strictEqual(status.migration004Recorded, true);
      assert.strictEqual(status.migration004SchemaReady, true);
      assert.strictEqual(status.migration004PresentColumnsCount, 18);
      assert.strictEqual(status.migration004PresentIndexesCount, 2);
      assert.deepStrictEqual(status.missingMigration004Columns, []);
      assert.deepStrictEqual(status.missingMigration004Indexes, []);
    });

    it('executes ONLY targetVersion 004 inside a transaction, leaves other pending migrations untouched, and rolls back on error', async () => {
      const os = await import('os');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-mig004-'));
      try {
        fs.writeFileSync(path.join(tmpDir, '001_init.sql'), 'SELECT 1;');
        fs.writeFileSync(path.join(tmpDir, '002_sec.sql'), 'SELECT 2;');
        fs.writeFileSync(path.join(tmpDir, '003_geo.sql'), 'SELECT 3;');
        fs.writeFileSync(path.join(tmpDir, '004_unified.sql'), 'ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS connector_configs JSONB;');
        fs.writeFileSync(path.join(tmpDir, '005_future.sql'), 'CREATE TABLE should_never_run(id TEXT);');

        const executed: string[] = [];
        const recorded = new Set(['001', '002', '003']);
        const mockClientSuccess = {
          query: async (sql: string, params?: any[]) => {
            executed.push(sql);
            if (sql.includes('SELECT version FROM schema_migrations')) {
              return { rows: Array.from(recorded).map((version) => ({ version })) };
            }
            if (sql.includes('INSERT INTO schema_migrations')) {
              recorded.add(params?.[0]);
            }
            return { rows: [] };
          },
        } as unknown as pg.PoolClient;

        const scopedMigrator = new Migrator(tmpDir);
        const res = await scopedMigrator.runMigrations(mockClientSuccess, { targetVersion: '004' });
        assert.strictEqual(res.success, true);
        assert.deepStrictEqual(res.applied, ['004_unified.sql']);
        assert.deepStrictEqual(res.alreadyApplied, ['001_init.sql', '002_sec.sql', '003_geo.sql']);
        assert.ok(recorded.has('004'));
        assert.strictEqual(recorded.has('005'), false);
        assert.strictEqual(executed.some((s) => s.includes('should_never_run')), false);
        assert.strictEqual(executed[0], 'BEGIN');
        assert.strictEqual(executed[executed.length - 1], 'COMMIT');

        // Failure case must ROLLBACK and not record 004
        const rollbackExecuted: string[] = [];
        const recordedOnFail = new Set(['001', '002', '003']);
        const mockClientFail = {
          query: async (sql: string, params?: any[]) => {
            rollbackExecuted.push(sql);
            if (sql.includes('SELECT version FROM schema_migrations')) {
              return { rows: Array.from(recordedOnFail).map((version) => ({ version })) };
            }
            if (sql.includes('ALTER TABLE app_settings')) {
              throw new Error('simulated DDL error');
            }
            if (sql.includes('INSERT INTO schema_migrations')) {
              recordedOnFail.add(params?.[0]);
            }
            return { rows: [] };
          },
        } as unknown as pg.PoolClient;

        const failRes = await scopedMigrator.runMigrations(mockClientFail, { targetVersion: '004' });
        assert.strictEqual(failRes.success, false);
        assert.match(failRes.error || '', /simulated DDL error/);
        assert.strictEqual(recordedOnFail.has('004'), false);
        assert.ok(rollbackExecuted.includes('ROLLBACK'));
        assert.strictEqual(rollbackExecuted.includes('COMMIT'), false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('verifies Migration 004 approval route enforces owner role, CSRF-protected router, explicit confirmation, and audit logging', () => {
      const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');
      assert.match(serverSrc, /protectedApi\.post\('\/database\/migrations\/004\/approve'/);
      assert.match(serverSrc, /req\.owner\.role !== 'owner'/);
      assert.match(serverSrc, /confirmMigration !== '004'/);
      assert.match(serverSrc, /runMigrations\(undefined,\s*\{\s*targetVersion:\s*'004'\s*\}\)/);
      assert.match(serverSrc, /MIGRATION_004_APPROVED_AND_APPLIED/);
    });
  });

  describe('8. Adapter Fetch Isolation & Security/Regression Invariants', () => {
    it('CompaniesHouseConnector formats Basic Auth header and masks/redacts secrets on mocked 401 failure', async () => {
      const origFetch = globalThis.fetch;
      let seenAuthHeader = '';

      globalThis.fetch = (async (_url: any, init: any) => {
        seenAuthHeader = init?.headers?.Authorization || '';
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;

      try {
        const ch = new CompaniesHouseConnector();
        const engine = new ConnectorExecutionEngine(new CredentialManager());

        // Inject credential via mocked environment variable temporarily
        const prevChKey = process.env.COMPANIES_HOUSE_API_KEY;
        process.env.COMPANIES_HOUSE_API_KEY = 'ch-secret-test-key-777';
        try {
          const { validation } = await engine.executeConnectionTest(ch);
          assert.strictEqual(validation.ok, false);
          assert.strictEqual(validation.healthState, 'authentication_required');
          assert.strictEqual(validation.errorCategory, 'authentication_failure');
          assert.ok(seenAuthHeader.startsWith('Basic '));
          assert.doesNotMatch(validation.message, /ch-secret-test-key-777/);
        } finally {
          if (prevChKey !== undefined) process.env.COMPANIES_HOUSE_API_KEY = prevChKey;
          else delete process.env.COMPANIES_HOUSE_API_KEY;
        }
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('verifies UI components strictly use apiFetch() and never call raw fetch()', () => {
      const files = [
        'src/components/ConnectorsView.tsx',
        'src/components/OwnerControlCentre.tsx',
        'src/components/DiscoveryEngine.tsx',
      ];
      for (const rel of files) {
        const content = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');
        const matches = content.match(/\bfetch\s*\(/g);
        assert.strictEqual(matches, null, `${rel} must use apiFetch(), found raw fetch()`);
      }
    });
  });
});
