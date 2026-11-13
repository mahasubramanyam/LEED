/**
 * LEED Phase 3 Completion & CRM Integration Remediation Verification Suite
 * 100% Isolated (Zero live Neon DB mutations; uses mocked SQL clients and isolated fixtures).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  canonicalizeIdentifierType,
  getDefaultIdentifierTypeForCountry,
  getIdentifierAliases,
  getUiIdentifierOptions,
} from '../shared/identifierRegistry.ts';
import {
  parseCsvRfc4180,
  escapeCsvCell,
  buildCsvDocument,
} from '../shared/csvUtils.ts';
import {
  summarizeValuesByCurrency,
  formatCurrencyLocale,
  formatDateLocale,
  getLocaleForCountry,
} from '../shared/localization.ts';
import { validateIdentifier } from '../server/identifiers/identifierEngine.ts';
import { normalizePhoneNumber } from '../server/geo/phoneUtils.ts';
import { validatePostalCode, formatInternationalAddress } from '../server/geo/addressUtils.ts';
import { buildCountryCapabilityMatrix } from '../server/geo/capabilityMatrix.ts';
import { searchAbn } from '../server/connectors/abnLookup.ts';
import { searchOpenStreetMap } from '../server/connectors/osmOverpass.ts';
import { PostgresStorage } from '../server/db/storagePg.ts';
import { Migrator } from '../server/db/migrator.ts';
import { CanonicalLead } from '../server/types.ts';

function createBaseLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = '2026-11-12T10:00:00.000Z';
  return {
    id: 'lead-remed-1',
    companyName: 'Nordic Example AS',
    industry: 'Software',
    category: 'Technology',
    companyStatus: 'active',
    confidenceScore: 85,
    confidenceSignals: ['Test Signal'],
    sources: [],
    identifiers: [],
    status: 'new',
    pipelineStageId: 'stage-discovered',
    currency: 'NOK',
    tags: [],
    notes: [],
    activities: [],
    address: {
      city: 'Oslo',
      country: 'Norway',
      countryCode: 'NO',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('LEED Phase 3 Remediation Verification Suite', () => {
  describe('1. Transactional Identifier Deletion & Upsert Persistence', () => {
    it('should execute DELETE for removed identifiers and preserve surviving identifiers inside a transaction', async () => {
      const queries: Array<{ sql: string; params?: any[] }> = [];
      const mockClient = {
        query: async (sql: string, params?: any[]) => {
          const trimmed = sql.trim().replace(/\s+/g, ' ');
          queries.push({ sql: trimmed, params });
          if (trimmed.includes('FROM lead_identifiers WHERE lead_id =')) {
            return {
              rows: [
                { id: 'ident-keep', type: 'NO_ORG', value: '974 760 673' },
                { id: 'ident-remove', type: 'LEI', value: '5493006MHB84DD0ZWV18' },
              ],
            };
          }
          return { rows: [], rowCount: 1 };
        },
        release: () => {},
      };
      const mockPool = {
        connect: async () => mockClient,
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
      } as any;

      const pgStore = new PostgresStorage();
      (pgStore as any).getClient = () => mockPool;

      const leadToSave = createBaseLead({
        id: 'lead-tx-test',
        registrationNumber: '974 760 673',
        registrationType: 'ORGNR',
        identifiers: [
          {
            id: 'ident-keep',
            type: 'ORGNR',
            value: '974 760 673',
            countryCode: 'NO',
            verified: false,
          },
          {
            type: 'EU_VAT',
            value: 'NO974760673MVA',
            countryCode: 'NO',
            verified: false,
          },
        ],
      });

      const saved = await pgStore.upsertLead(leadToSave);

      assert.strictEqual(queries[0].sql, 'BEGIN');
      assert.strictEqual(queries[queries.length - 1].sql, 'COMMIT');

      const deleteStmt = queries.find((q) => q.sql.startsWith('DELETE FROM lead_identifiers'));
      assert.ok(deleteStmt, 'Must issue DELETE statement for removed identifiers');
      assert.deepStrictEqual(deleteStmt.params?.[1], ['ident-remove']);

      const upsertStmts = queries.filter((q) => q.sql.startsWith('INSERT INTO lead_identifiers'));
      assert.strictEqual(upsertStmts.length, 2, 'Must upsert both retained and newly added identifiers');
      assert.strictEqual(saved.identifiers[0].type, 'NO_ORG', 'ORGNR should normalize to canonical NO_ORG');
    });

    it('should delete ALL lead_identifiers when lead is saved with empty identifiers array', async () => {
      const queries: Array<{ sql: string; params?: any[] }> = [];
      const mockClient = {
        query: async (sql: string, params?: any[]) => {
          const trimmed = sql.trim().replace(/\s+/g, ' ');
          queries.push({ sql: trimmed, params });
          if (trimmed.includes('FROM lead_identifiers WHERE lead_id =')) {
            return { rows: [{ id: 'ident-old', type: 'TAX_ID', value: '12345' }] };
          }
          return { rows: [], rowCount: 1 };
        },
        release: () => {},
      };
      const mockPool = { connect: async () => mockClient } as any;

      const pgStore = new PostgresStorage();
      (pgStore as any).getClient = () => mockPool;

      await pgStore.upsertLead(createBaseLead({ id: 'lead-clear-idents', identifiers: [] }));

      const deleteStmt = queries.find((q) => q.sql.startsWith('DELETE FROM lead_identifiers'));
      assert.ok(deleteStmt, 'Must execute DELETE statement for removed identifiers when incoming array is empty');
      assert.deepStrictEqual(deleteStmt.params?.[1], ['ident-old']);
    });
  });

  describe('2. Canonical Identifier Registry & Legacy Backward Compatibility', () => {
    it('should unify all legacy alias types cleanly across NO, UK, AU, DE, FR, US', () => {
      assert.strictEqual(canonicalizeIdentifierType('ORGNR'), 'NO_ORG');
      assert.strictEqual(canonicalizeIdentifierType('BRREG_ORG'), 'NO_ORG');
      assert.strictEqual(canonicalizeIdentifierType('NO_ORG'), 'NO_ORG');

      assert.strictEqual(canonicalizeIdentifierType('CRN'), 'UK_CRN');
      assert.strictEqual(canonicalizeIdentifierType('UK_CRN'), 'UK_CRN');

      assert.strictEqual(canonicalizeIdentifierType('ABN'), 'AU_ABN');
      assert.strictEqual(canonicalizeIdentifierType('AU_ABN'), 'AU_ABN');

      assert.strictEqual(canonicalizeIdentifierType('HANDELSREGISTER'), 'DE_HANDELSREGISTER');
      assert.strictEqual(canonicalizeIdentifierType('DE_HANDELSREGISTER'), 'DE_HANDELSREGISTER');
      assert.strictEqual(canonicalizeIdentifierType('HRB'), 'DE_HANDELSREGISTER');

      assert.strictEqual(canonicalizeIdentifierType('SIREN'), 'FR_SIREN');
      assert.strictEqual(canonicalizeIdentifierType('EIN'), 'US_EIN');
      assert.strictEqual(canonicalizeIdentifierType('VAT'), 'EU_VAT');

      assert.strictEqual(getDefaultIdentifierTypeForCountry('DE'), 'DE_HANDELSREGISTER');
      assert.strictEqual(getDefaultIdentifierTypeForCountry('NO'), 'NO_ORG');
      assert.strictEqual(getDefaultIdentifierTypeForCountry('AU'), 'AU_ABN');
      assert.strictEqual(getDefaultIdentifierTypeForCountry('GB'), 'UK_CRN');
    });

    it('should expand alias list for filtering legacy PostgreSQL records and validate syntax accurately', () => {
      const noAliases = getIdentifierAliases('NO_ORG');
      assert.ok(noAliases.includes('ORGNR'));
      assert.ok(noAliases.includes('BRREG_ORG'));
      assert.ok(noAliases.includes('NO_ORG'));

      const deRes = validateIdentifier('HANDELSREGISTER', 'HRB 123456', 'DE');
      assert.strictEqual(deRes.type, 'DE_HANDELSREGISTER');
      assert.strictEqual(deRes.valid, true);
      assert.strictEqual(deRes.status, 'syntax_validated');

      const uiOpts = getUiIdentifierOptions();
      assert.ok(uiOpts.some((o) => o.code === 'DE_HANDELSREGISTER'));
      assert.ok(!uiOpts.some((o) => o.code === 'DOMAIN'));
    });
  });

  describe('3. Separate Raw phone and E.164 phoneNormalized Storage', () => {
    it('should normalize phone numbers to E.164 in phoneNormalized while preserving raw user formatting', () => {
      const rawInput = '020 7946 0912';
      const norm = normalizePhoneNumber(rawInput, 'GB');
      assert.strictEqual(norm.valid, true);
      assert.strictEqual(norm.e164, '+442079460912');

      const lead = createBaseLead({
        phone: rawInput,
        phoneNormalized: norm.e164,
        address: { city: 'London', country: 'United Kingdom', countryCode: 'GB' },
      });

      assert.strictEqual(lead.phone, '020 7946 0912');
      assert.strictEqual(lead.phoneNormalized, '+442079460912');
    });
  });

  describe('4. Authentication Consistency Static Audit (Zero Unauthenticated Protected Calls)', () => {
    it('should ensure all protected UI components use apiFetch() and avoid window.open() on protected exports', () => {
      const componentsDir = join(process.cwd(), 'src', 'components');
      const filesToCheck = [
        'DedupeHub.tsx',
        'LeadDetailModal.tsx',
        'OutreachCampaigns.tsx',
        'AiSalesAgent.tsx',
        'ImportModal.tsx',
        'LeadsView.tsx',
        'DiscoveryEngine.tsx',
        'CountryMatrixView.tsx',
      ];

      for (const file of filesToCheck) {
        const content = readFileSync(join(componentsDir, file), 'utf8');
        const rawFetchMatches = content.match(/\bfetch\s*\(/g);
        assert.strictEqual(
          rawFetchMatches,
          null,
          `${file} must use apiFetch() instead of raw fetch()`
        );
      }

      const authModal = readFileSync(join(componentsDir, 'AuthModal.tsx'), 'utf8');
      assert.ok(
        authModal.includes("apiFetch('/api/auth/change-password'"),
        'AuthModal must use apiFetch() for protected change-password endpoint'
      );

      const appTsx = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
      assert.ok(!appTsx.includes("window.open('/api/export/csv'"), 'App.tsx must not open CSV export via unauthenticated window.open');
      assert.ok(appTsx.includes("apiFetch('/api/export/csv')"), 'App.tsx must download CSV via authenticated apiFetch blob');
    });
  });

  describe('5. Discovery Region Forwarding & Honest AU ABN Mode', () => {
    it('should forward region into OpenStreetMap query parameters cleanly', async () => {
      const originalFetch = globalThis.fetch;
      let capturedUrl = '';
      globalThis.fetch = (async (input: string | URL | Request) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(JSON.stringify([]), { status: 200 });
      }) as any;

      try {
        await searchOpenStreetMap('Semiconductor', 'NO', 'Trondheim', 'Trøndelag');
        assert.ok(capturedUrl.includes('Tr%C3%B8ndelag') || capturedUrl.includes('Trondelag') || decodeURIComponent(capturedUrl).includes('Trøndelag'), 'OSM query must include region parameter');
        assert.ok(capturedUrl.includes('countrycodes=no'), 'OSM query must pass countrycodes=no');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should clearly identify AU ABN connector as offline checksum + reference sample (never live ABR)', async () => {
      const res = await searchAbn('Atlassian');
      assert.strictEqual(res.isLiveApi, false);
      assert.strictEqual(res.lookupMode, 'checksum_and_offline_reference');
      assert.ok(res.message.toLowerCase().includes('guid'), 'Message must state official ABR GUID is required');
      assert.strictEqual(res.leads.length, 1);
      assert.strictEqual(res.leads[0].registrationType, 'AU_ABN');
      assert.strictEqual(res.leads[0].identifiers[0].type, 'AU_ABN');
      assert.strictEqual(res.leads[0].identifiers[0].status, 'syntax_validated');
      assert.strictEqual(res.leads[0].identifiers[0].verified, false);
    });
  });

  describe('6. RFC 4180 CSV Parser & Export Escaping', () => {
    it('should parse quoted commas, escaped quotes, CRLF, BOM, and multi-line fields accurately', () => {
      const rawCsv =
        '\uFEFF"Company Name","Country Code","Phone","Secondary Identifiers","Notes"\r\n' +
        '"Acme, Inc. ""Global""","GB","020 7946 0912","UK_CRN:01234567","Line 1\nLine 2"\r\n' +
        '"Nordic Tech AS","NO","22 34 56 78","NO_ORG:974760673","Oslo HQ"\r\n';

      const parsed = parseCsvRfc4180(rawCsv);
      assert.strictEqual(parsed.errors.length, 0);
      assert.deepStrictEqual(parsed.headers, [
        'Company Name',
        'Country Code',
        'Phone',
        'Secondary Identifiers',
        'Notes',
      ]);
      assert.strictEqual(parsed.rows.length, 2);
      assert.strictEqual(parsed.rows[0][0], 'Acme, Inc. "Global"');
      assert.strictEqual(parsed.rows[0][4], 'Line 1\nLine 2');
      assert.strictEqual(parsed.rows[1][0], 'Nordic Tech AS');
    });

    it('should serialize RFC 4180 CSV with UTF-8 BOM and preserve Unicode names', () => {
      const doc = buildCsvDocument(
        ['Company', 'Address'],
        [['Brønnøysund "Hub", AS', 'Oslo, Norway']],
        true
      );
      assert.ok(doc.startsWith('\uFEFF'), 'Must include UTF-8 BOM');
      assert.ok(doc.includes('"Brønnøysund ""Hub"", AS"'));
      assert.strictEqual(escapeCsvCell(null), '');
    });
  });

  describe('7. Source Capability Matrix Accuracy', () => {
    it('should not fabricate lastCheckedAt and must classify AU ABN, OSM, Web Inspector, and DB CH keys honestly', () => {
      const origCh = process.env.COMPANIES_HOUSE_API_KEY;
      const origAbn = process.env.ABR_GUID;
      delete process.env.COMPANIES_HOUSE_API_KEY;
      delete process.env.ABR_GUID;

      try {
        const matrixNoKeys = buildCountryCapabilityMatrix([], { hasChKey: false });

        const au = matrixNoKeys.find((c) => c.id === 'cap-au-abn');
        assert.ok(au);
        assert.strictEqual(au.integrationStatus, 'requires_api_key');
        assert.strictEqual(au.lastCheckedAt, undefined, 'Must not fabricate current timestamp when un-run');

        const gbNoKey = matrixNoKeys.find((c) => c.id === 'cap-gb-ch');
        assert.strictEqual(gbNoKey?.integrationStatus, 'requires_api_key');

        const matrixWithDbChKey = buildCountryCapabilityMatrix([], { hasChKey: true });
        const gbWithKey = matrixWithDbChKey.find((c) => c.id === 'cap-gb-ch');
        assert.strictEqual(gbWithKey?.integrationStatus, 'configured_api_key');

        const osm = matrixNoKeys.find((c) => c.id === 'cap-global-osm');
        assert.strictEqual(osm?.sourceType, 'public_geo_directory');

        const geoOnly = matrixNoKeys.find((c) => c.countryCode === 'LI');
        assert.strictEqual(geoOnly?.sourceType, 'geographic_reference_only');
        assert.strictEqual(geoOnly?.integrationStatus, 'unavailable');
      } finally {
        if (origCh !== undefined) process.env.COMPANIES_HOUSE_API_KEY = origCh;
        if (origAbn !== undefined) process.env.ABR_GUID = origAbn;
      }
    });
  });

  describe('8. Mixed Currency Safety, Localization & Postal Validation', () => {
    it('should group multi-currency totals separately instead of summing into fake USD', () => {
      const leads = [
        createBaseLead({ opportunityValue: 100000, currency: 'NOK', address: { country: 'Norway', countryCode: 'NO' } }),
        createBaseLead({ opportunityValue: 50000, currency: 'GBP', address: { country: 'United Kingdom', countryCode: 'GB' } }),
        createBaseLead({ opportunityValue: 25000, currency: 'NOK', address: { country: 'Norway', countryCode: 'NO' } }),
      ];

      const summary = summarizeValuesByCurrency(leads, 'USD');
      assert.strictEqual(summary.isMixed, true);
      assert.strictEqual(summary.totals.length, 2);
      const nokBucket = summary.totals.find((t) => t.currency === 'NOK');
      const gbpBucket = summary.totals.find((t) => t.currency === 'GBP');
      assert.strictEqual(nokBucket?.amount, 125000);
      assert.strictEqual(gbpBucket?.amount, 50000);
      assert.ok(formatCurrencyLocale(50000, 'GBP', 'en-GB').includes('£'));
      assert.strictEqual(getLocaleForCountry('NO', 'NOK'), 'nb-NO');
      assert.ok(formatDateLocale('2026-11-12T10:00:00Z', 'en-GB', 'Europe/London').includes('2026'));
    });

    it('should require non-empty valid postal codes where destination country mandates them', () => {
      assert.strictEqual(validatePostalCode('', 'GB').valid, false);
      assert.strictEqual(validatePostalCode('   ', 'NO').valid, false);
      assert.strictEqual(validatePostalCode('', 'US').valid, false);
      assert.strictEqual(validatePostalCode('SW1A 2AA', 'GB').valid, true);
      assert.strictEqual(validatePostalCode('', 'AE').valid, true);

      const formattedDe = formatInternationalAddress({
        street: 'Friedrichstraße 10',
        city: 'Berlin',
        postalCode: '10117',
        country: 'Germany',
        countryCode: 'DE',
      });
      assert.ok(formattedDe.includes('10117 Berlin'));
    });
  });

  describe('9. Diagnostics Table Ledger & Migration 003 Read-Only Inspector', () => {
    it('should query actual Neon schema table names (excluding legacy nonexistent tables)', async () => {
      const queriedTables: string[] = [];
      const mockClient = {
        query: async (sql: string) => {
          if (sql.includes('SELECT version()')) return { rows: [{ version: 'PostgreSQL 18.6' }] };
          if (sql.includes('current_database()')) return { rows: [{ current_database: 'neondb' }] };
          if (sql.includes('current_user')) return { rows: [{ current_user: 'neondb_owner' }] };
          if (sql.includes('pg_size_pretty')) return { rows: [{ size: '8 MB' }] };
          const match = sql.match(/FROM "([^"]+)"/);
          if (match) queriedTables.push(match[1]);
          return { rows: [{ count: '0' }] };
        },
        release: () => {},
      };
      const mockPool = {
        connect: async () => mockClient,
        totalCount: 1,
        idleCount: 1,
        waitingCount: 0,
      } as any;

      const pgStore = new PostgresStorage();
      (pgStore as any).getClient = () => mockPool;

      const diag = await pgStore.getDetailedDiagnostics();
      assert.ok(queriedTables.includes('schema_migrations'));
      assert.ok(queriedTables.includes('lead_merge_history'));
      assert.ok(queriedTables.includes('country_source_capabilities'));
      assert.ok(!queriedTables.includes('dedupe_candidates'));
      assert.ok(!queriedTables.includes('merge_history'));
      assert.strictEqual(diag.tables.length, 18);
    });

    it('should accurately detect applied vs incomplete Migration 003 schemas without executing DDL', async () => {
      const executedSql: string[] = [];
      const mockClientPending = {
        query: async (sql: string) => {
          executedSql.push(sql);
          if (sql.includes('to_regclass')) return { rows: [{ mig_tbl: 'schema_migrations', cap_tbl: null }] };
          if (sql.includes('FROM schema_migrations')) {
            return { rows: [{ version: '001', name: '001_initial_schema.sql' }, { version: '002', name: '002_owner.sql' }] };
          }
          if (sql.includes('information_schema.columns')) {
            return { rows: [{ column_name: 'id' }, { column_name: 'type' }, { column_name: 'value' }] };
          }
          if (sql.includes('FROM pg_indexes')) return { rows: [] };
          return { rows: [] };
        },
        release: () => {},
      };

      const migrator = new Migrator();
      const pendingStatus = await migrator.inspectMigrationStatus({ connect: async () => mockClientPending } as any);
      assert.strictEqual(pendingStatus.migration003Recorded, false);
      assert.strictEqual(pendingStatus.countryCapabilitiesTableExists, false);
      assert.strictEqual(pendingStatus.missingLeadIdentifierColumns.length, 5);
      assert.strictEqual(pendingStatus.missingMigration003Indexes.length, 8);
      assert.strictEqual(pendingStatus.migration003SchemaReady, false);
      assert.ok(executedSql.every((s) => !/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i.test(s)), 'Inspection must be strictly read-only');
    });
  });
});
