/**
 * LEED Phase 5 Global Business Discovery Engine Verification Suite
 * Covers:
 *  1. Country & Location Filtering (Region, City, PostalCode, Coordinates + RadiusKm Haversine/viewbox)
 *  2. Industry, Category, Business Type & Website/Domain Filtering Across Adapters
 *  3. Multi-Country & Bulk Keyword Search Orchestration + Bounded Concurrency
 *  4. Dynamic vs Manual Connector Routing, Disabled Skipping & OSM Fallback
 *  5. Normalization, Provenance, No Invented Scores, Honest ABN Offline & Enrichment (SSRF + AI)
 *  6. Cross-Source & Cross-Country Deduplication + Non-Auto-Merged Ambiguous Review Flagging
 *  7. Server-Side Pagination Filtering/Sorting & RFC 4180 CSV Export
 *  8. Partial Connector Failure Resilience & Redacted Error Details
 *  9. Rate Limits & Transient Retries Through Phase 4 ExecutionEngine
 * 10. Search Cancellation & Duplicate Concurrent Search Coalescing
 * 11. Duplicate-Aware CRM Saving Preserving Existing Notes/Activities/Status/Stage (Pg + Json)
 * 12. Bulk Batch Upsert Partial Row Failure Reporting
 * 13. Owner Auth & CSRF Route Protection + No Secret Leakage Inspection
 *
 * All network and database interactions in this suite use isolated in-memory mocks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { OsmConnector } from '../server/connectors/adapters/osmAdapter.js';
import { BrregConnector } from '../server/connectors/adapters/brregAdapter.js';
import { CompaniesHouseConnector } from '../server/connectors/adapters/companiesHouseAdapter.js';
import { AbnConnector } from '../server/connectors/adapters/abnAdapter.js';
import { ConnectorRegistry } from '../server/connectors/core/registry.js';
import { ConnectorExecutionEngine } from '../server/connectors/core/executionEngine.js';
import { CredentialManager } from '../server/connectors/core/credentialManager.js';
import { classifyConnectorError, ConnectorError } from '../server/connectors/core/errors.js';
import {
  ClassifiedConnectorError,
  ConnectionValidationResult,
  ConnectorExecutionContext,
  ConnectorHealthReport,
  ConnectorMetadata,
  ConnectorRuntimeState,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
  StandardizedConnectorResult,
} from '../server/connectors/core/types.js';
import { detectDiscoveryDuplicates } from '../server/connectors/dedupeEngine.js';
import { DiscoveryService } from '../server/discovery/discoveryService.js';
import { PostgresStorage } from '../server/db/storagePg.js';
import { CanonicalLead } from '../server/types.js';
import { inspectWebsite } from '../server/connectors/webInspector.js';
import { normalizeConnectorResult } from '../server/connectors/core/normalizer.js';
import { DEFAULT_PIPELINE_STAGES } from '../shared/defaultStages.js';

function createContext(
  connectorId = 'test-conn',
  overrides: Partial<ConnectorExecutionContext> = {}
): ConnectorExecutionContext {
  return {
    requestId: overrides.requestId || 'req-test',
    signal: overrides.signal || new AbortController().signal,
    credentials: overrides.credentials || {},
    credentialSource: overrides.credentialSource || 'none',
    config: overrides.config || { connectorId, enabled: true },
    userAgent: overrides.userAgent || 'LEED-Phase5-Test/1.0',
    timeoutMs: overrides.timeoutMs || 5000,
  };
}

function createMockDiscoveryConnector(
  id: string,
  overrides: Partial<ConnectorMetadata> = {},
  searchFn?: (req: ConnectorSearchRequest, ctx: ConnectorExecutionContext) => Promise<ConnectorSearchResponse>
): IConnector {
  const metadata: ConnectorMetadata = {
    id,
    name: overrides.name || `Mock Connector (${id})`,
    shortName: overrides.shortName || id,
    version: '1.0.0',
    sourceCategory: overrides.sourceCategory || 'business_directory',
    accessMode: overrides.accessMode || 'live_api',
    description: 'Isolated Phase 5 mock connector',
    supportedCountries: overrides.supportedCountries ?? ['NO'],
    supportsAllCountries: overrides.supportsAllCountries ?? false,
    supportsRegionFilter: overrides.supportsRegionFilter ?? true,
    supportsCityFilter: overrides.supportsCityFilter ?? true,
    supportsPostalCodeFilter: overrides.supportsPostalCodeFilter ?? true,
    supportsRadiusFilter: overrides.supportsRadiusFilter ?? false,
    supportsIndustryFilter: overrides.supportsIndustryFilter ?? true,
    supportedIdentifierTypes: overrides.supportedIdentifierTypes || ['LOCAL_REG'],
    capabilities: overrides.capabilities || ['company_search', 'connection_test'],
    credentialRequirements: overrides.credentialRequirements || {
      authType: 'none_open',
      required: false,
      fields: [],
      envFallbackKeys: [],
      setupInstructions: 'None',
    },
    executionPolicy: overrides.executionPolicy || {
      timeoutMs: 3000,
      maxRetries: 2,
      baseBackoffMs: 5,
      maxBackoffMs: 20,
      maxConcurrency: 4,
      rateLimit: {
        maxRequests: 50,
        windowMs: 60_000,
        note: '50 req/min test policy',
        waitOnLimit: false,
      },
      defaultPageSize: 25,
      maxPageSize: 100,
    },
    attribution: overrides.attribution || `Mock Attribution (${id})`,
    license: 'MIT',
  };

  return {
    id,
    getMetadata: () => metadata,
    validateConnection: async (): Promise<ConnectionValidationResult> => ({
      ok: true,
      healthState: 'operational',
      latencyMs: 5,
      isLiveApi: metadata.accessMode === 'live_api',
      message: 'Mock operational',
      checkedAt: new Date().toISOString(),
    }),
    search:
      searchFn ||
      (async (req) => ({
        results: [
          {
            providerId: id,
            providerName: metadata.name,
            sourceCategory: metadata.sourceCategory,
            accessMode: metadata.accessMode,
            countryCode: req.countryCode || 'NO',
            externalSourceId: `${id}-${req.countryCode || 'XX'}-${req.query}`,
            company: {
              companyName: `${req.query} Corp (${req.countryCode || 'Global'})`,
              registrationNumber: `REG-${req.countryCode || 'XX'}-1001`,
              registrationType: 'LOCAL_REG',
              address: {
                country: req.countryCode || 'International',
                countryCode: req.countryCode || 'US',
                city: req.city || 'Oslo',
                postalCode: req.postalCode || '0150',
              },
              industry: req.industry || 'Technology',
            },
            retrievedAt: new Date().toISOString(),
            verificationStatus: 'directory_listed',
            confidence: { supported: true, score: 82, signals: ['Mock signal'] },
            providerMetadata: {},
          },
        ],
        pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1, hasMore: false },
        rawCount: 1,
        attribution: metadata.attribution,
        notes: [],
        isLiveApi: metadata.accessMode === 'live_api',
      })),
    normalizeResult: (raw) => raw as StandardizedConnectorResult,
    classifyError: (err): ClassifiedConnectorError => classifyConnectorError(err, id),
    getHealth: (state: ConnectorRuntimeState): ConnectorHealthReport =>
      new ConnectorRegistry().computeHealthReport(
        { id, getMetadata: () => metadata } as unknown as IConnector,
        state
      ),
  };
}

function makeSampleLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = '2026-11-13T10:00:00.000Z';
  return {
    id: overrides.id || 'lead-sample-1',
    companyName: overrides.companyName || 'Fjord Robotics AS',
    legalName: overrides.legalName || overrides.companyName || 'Fjord Robotics AS',
    registrationNumber: overrides.registrationNumber,
    registrationType: overrides.registrationType,
    companyStatus: overrides.companyStatus || 'active',
    website: overrides.website,
    domain: overrides.domain,
    email: overrides.email,
    emailStatus: overrides.emailStatus || 'unavailable',
    phone: overrides.phone,
    phoneNormalized: overrides.phoneNormalized,
    address: overrides.address || {
      street: 'Teknologiveien 1',
      city: 'Trondheim',
      postalCode: '7030',
      country: 'Norway',
      countryCode: 'NO',
    },
    coordinates: overrides.coordinates,
    industry: overrides.industry || 'Robotics',
    category: overrides.category || 'AS',
    confidenceScore: overrides.confidenceScore ?? 85,
    confidenceSignals: overrides.confidenceSignals || ['Registry Match'],
    sources: overrides.sources || [
      {
        sourceName: 'Norway Brreg',
        providerId: '991122334',
        url: 'https://data.brreg.no/enhetsregisteret/oppslag/enheter/991122334',
        retrievedAt: now,
      },
    ],
    identifiers: overrides.identifiers || [],
    status: overrides.status || 'new',
    pipelineStageId: overrides.pipelineStageId || 'stage-new',
    opportunityValue: overrides.opportunityValue ?? 0,
    currency: overrides.currency || 'USD',
    winProbability: overrides.winProbability,
    lostReason: overrides.lostReason,
    tags: overrides.tags || [],
    notes: overrides.notes || [],
    activities: overrides.activities || [],
    customFields: overrides.customFields,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

describe('LEED Phase 5 Global Business Discovery Engine Verification Suite', () => {
  describe('1. Country & Location Filtering (Region, City, PostalCode, Coordinates + RadiusKm)', () => {
    it('OsmConnector builds bounded Nominatim viewbox and applies strict Haversine radius, postalCode, and domain filters', async () => {
      const osm = new OsmConnector();
      const origFetch = globalThis.fetch;
      let capturedUrl = '';

      globalThis.fetch = (async (input: string | URL | Request) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(
          JSON.stringify([
            {
              place_id: 1,
              osm_id: 1001,
              osm_type: 'node',
              lat: '63.4305',
              lon: '10.3951',
              name: 'Trondheim Tech Clinic',
              class: 'office',
              type: 'company',
              display_name: 'Trondheim Tech Clinic, 7011 Trondheim, Norway',
              address: {
                road: 'Kongens gate',
                house_number: '14',
                city: 'Trondheim',
                state: 'Trøndelag',
                postcode: '7011',
                country: 'Norway',
                country_code: 'no',
              },
              extratags: {
                website: 'https://trondheimtech.no',
              },
            },
            {
              place_id: 2,
              osm_id: 1002,
              osm_type: 'node',
              lat: '59.9139',
              lon: '10.7522', // Oslo (~390km away from Trondheim center)
              name: 'Oslo Far Office',
              class: 'office',
              type: 'company',
              display_name: 'Oslo Far Office, 0150 Oslo, Norway',
              address: {
                road: 'Karl Johans gate',
                house_number: '1',
                city: 'Oslo',
                postcode: '0150',
                country: 'Norway',
                country_code: 'no',
              },
              extratags: {
                website: 'https://trondheimtech.no',
              },
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      try {
        const res = await osm.search(
          {
            query: 'Clinic',
            countryCode: 'NO',
            region: 'Trøndelag',
            city: 'Trondheim',
            postalCode: '7011',
            domain: 'trondheimtech.no',
            coordinates: { lat: 63.43, lon: 10.395 },
            radiusKm: 15,
          },
          createContext('conn-osm')
        );

        assert.match(capturedUrl, /viewbox=/);
        assert.match(capturedUrl, /bounded=1/);
        assert.match(capturedUrl, /countrycodes=no/);
        assert.strictEqual(res.results.length, 1);
        assert.strictEqual(res.results[0].company.companyName, 'Trondheim Tech Clinic');
        assert.strictEqual(res.results[0].company.address?.postalCode, '7011');
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it('BrregConnector passes postnummer upstream and filters by city, postalCode, industry & domain', async () => {
      const brreg = new BrregConnector();
      const origFetch = globalThis.fetch;
      let capturedUrl = '';

      globalThis.fetch = (async (input: string | URL | Request) => {
        capturedUrl = typeof input === 'string' ? input : input.toString();
        return new Response(
          JSON.stringify({
            _embedded: {
              enheter: [
                {
                  organisasjonsnummer: '923609016',
                  navn: 'NORDIC SEMICONDUCTOR ASA',
                  organisasjonsform: { kode: 'ASA', beskrivelse: 'Allmennaksjeselskap' },
                  naeringskode1: { kode: '71.129', beskrivelse: 'Annen teknisk konsulentvirksomhet' },
                  forretningsadresse: {
                    adresse: ['Otto Nielsens veg 12'],
                    postnummer: '7052',
                    poststed: 'TRONDHEIM',
                    land: 'Norge',
                    landkode: 'NO',
                  },
                  hjemmeside: 'www.nordicsemi.com',
                },
                {
                  organisasjonsnummer: '911111111',
                  navn: 'NORDIC BAKERY AS',
                  organisasjonsform: { kode: 'AS', beskrivelse: 'Aksjeselskap' },
                  naeringskode1: { kode: '10.710', beskrivelse: 'Produksjon av brød og bakervarer' },
                  forretningsadresse: {
                    adresse: ['Torget 2'],
                    postnummer: '5001',
                    poststed: 'BERGEN',
                    land: 'Norge',
                    landkode: 'NO',
                  },
                },
              ],
            },
            page: { totalElements: 2, totalPages: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      try {
        const res = await brreg.search(
          {
            query: 'Nordic',
            countryCode: 'NO',
            city: 'Trondheim',
            postalCode: '7052',
            industry: 'konsulentvirksomhet',
            domain: 'nordicsemi.com',
          },
          createContext('conn-brreg')
        );

        assert.match(capturedUrl, /postnummer=7052/);
        assert.strictEqual(res.results.length, 1);
        assert.strictEqual(res.results[0].externalSourceId, '923609016');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe('2. Industry, Category & PostalCode Filtering on UK Companies House & AU ABN Offline', () => {
    it('CompaniesHouseConnector filters offline mirror & live payload by postalCode and industry/SIC accurately', async () => {
      const ch = new CompaniesHouseConnector();
      const offlineRes = await ch.search(
        {
          query: 'DeepMind',
          countryCode: 'GB',
          city: 'London',
          postalCode: 'N1C 4AG',
          industry: 'engineering',
        },
        createContext('conn-companies-house', { credentials: {} })
      );

      assert.strictEqual(offlineRes.isLiveApi, false);
      assert.strictEqual(offlineRes.results.length, 1);
      assert.strictEqual(offlineRes.results[0].externalSourceId, '07386161');
    });

    it('AbnConnector stays strictly offline_reference and applies city/postalCode/industry post-filters', async () => {
      const abn = new AbnConnector();
      assert.strictEqual(abn.getMetadata().accessMode, 'offline_reference');

      const res = await abn.search(
        {
          query: 'Atlassian',
          countryCode: 'AU',
          city: 'Sydney',
          postalCode: '2000',
        },
        createContext('conn-abn')
      );

      assert.strictEqual(res.isLiveApi, false);
      assert.strictEqual(res.providerMetadata?.isLiveApi, false);
      assert.ok(res.results.every((r) => r.accessMode === 'offline_reference'));
      assert.ok(res.results.every((r) => r.verificationStatus === 'offline_reference'));
    });
  });

  describe('3. Multi-Country & Bulk Keyword Search Orchestration with Bounded Concurrency', () => {
    it('orchestrates multi-country + bulk queries cleanly and caps active worker concurrency at 4', async () => {
      const reg = new ConnectorRegistry();
      let activeWorkers = 0;
      let maxObservedWorkers = 0;

      const noConn = createMockDiscoveryConnector(
        'conn-no',
        { supportedCountries: ['NO'], sourceCategory: 'government_registry' },
        async (req) => {
          activeWorkers++;
          maxObservedWorkers = Math.max(maxObservedWorkers, activeWorkers);
          await new Promise((r) => setTimeout(r, 15));
          activeWorkers--;
          return {
            results: [
              {
                providerId: 'conn-no',
                providerName: 'Norway Reg',
                sourceCategory: 'government_registry',
                accessMode: 'live_api',
                countryCode: 'NO',
                externalSourceId: `no-${req.query}`,
                company: {
                  companyName: `NO ${req.query} AS`,
                  registrationNumber: `90000000${req.query.length}`,
                  address: { country: 'Norway', countryCode: 'NO', city: 'Oslo' },
                },
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'officially_verified',
                confidence: { supported: true, score: 90, signals: ['Verified'] },
                providerMetadata: {},
              },
            ],
            pagination: { page: 1, pageSize: 25, hasMore: false },
            rawCount: 1,
            attribution: 'NO Gov',
            notes: [],
            isLiveApi: true,
          };
        }
      );

      const gbConn = createMockDiscoveryConnector(
        'conn-gb',
        { supportedCountries: ['GB'], sourceCategory: 'government_registry' },
        async (req) => {
          activeWorkers++;
          maxObservedWorkers = Math.max(maxObservedWorkers, activeWorkers);
          await new Promise((r) => setTimeout(r, 15));
          activeWorkers--;
          return {
            results: [
              {
                providerId: 'conn-gb',
                providerName: 'UK Reg',
                sourceCategory: 'government_registry',
                accessMode: 'live_api',
                countryCode: 'GB',
                externalSourceId: `gb-${req.query}`,
                company: {
                  companyName: `GB ${req.query} Ltd`,
                  registrationNumber: `0800000${req.query.length}`,
                  address: { country: 'United Kingdom', countryCode: 'GB', city: 'London' },
                },
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'officially_verified',
                confidence: { supported: true, score: 88, signals: ['Verified'] },
                providerMetadata: {},
              },
            ],
            pagination: { page: 1, pageSize: 25, hasMore: false },
            rawCount: 1,
            attribution: 'UK Gov',
            notes: [],
            isLiveApi: true,
          };
        }
      );

      reg.register(noConn);
      reg.register(gbConn);

      const service = new DiscoveryService();
      const engine = new ConnectorExecutionEngine(new CredentialManager());

      const response = await service.executeSearch(
        {
          query: 'Alpha',
          queries: ['Alpha', 'Beta', 'Gamma'],
          countryCodes: ['NO', 'GB'],
          selectionMode: 'auto',
        },
        { registry: reg, executionEngine: engine }
      );

      assert.ok(maxObservedWorkers <= 4, `Observed concurrency ${maxObservedWorkers} exceeded 4`);
      assert.strictEqual(response.totalDiscovered, 6);
      assert.deepStrictEqual(response.appliedFilters.countryCodes, ['NO', 'GB']);
      assert.strictEqual(response.connectorSummaries.filter((s) => s.status === 'success').length, 6);
    });
  });

  describe('4. Dynamic vs Manual Connector Routing, Disabled Skipping & OSM Fallback', () => {
    it('skips disabled connectors cleanly and auto-falls back to conn-osm when primary yields zero leads', async () => {
      const reg = new ConnectorRegistry();
      let osmCalled = false;

      const disabledNo = createMockDiscoveryConnector('conn-no-disabled', { supportedCountries: ['NO'] });
      const emptyNo = createMockDiscoveryConnector(
        'conn-no-empty',
        { supportedCountries: ['NO'], sourceCategory: 'government_registry' },
        async () => ({
          results: [],
          pagination: { page: 1, pageSize: 25, hasMore: false },
          rawCount: 0,
          attribution: 'Empty',
          notes: [],
          isLiveApi: true,
        })
      );
      const osmFallback = createMockDiscoveryConnector(
        'conn-osm',
        { supportedCountries: [], supportsAllCountries: true, sourceCategory: 'maps_geo', accessMode: 'public_directory' },
        async () => {
          osmCalled = true;
          return {
            results: [
              {
                providerId: 'conn-osm',
                providerName: 'OpenStreetMap',
                sourceCategory: 'maps_geo',
                accessMode: 'public_directory',
                countryCode: 'NO',
                externalSourceId: 'node-55',
                company: {
                  companyName: 'Trondheim Solar Hub',
                  address: { country: 'Norway', countryCode: 'NO', city: 'Trondheim' },
                },
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'directory_listed',
                confidence: { supported: true, score: 55, signals: ['OSM Node'] },
                providerMetadata: {},
              },
            ],
            pagination: { page: 1, pageSize: 25, hasMore: false },
            rawCount: 1,
            attribution: 'OSM',
            notes: [],
            isLiveApi: true,
          };
        }
      );

      reg.register(disabledNo);
      reg.register(emptyNo);
      reg.register(osmFallback);

      const service = new DiscoveryService();
      const engine = new ConnectorExecutionEngine(new CredentialManager());

      const res = await service.executeSearch(
        { query: 'Solar', countryCode: 'NO', selectionMode: 'auto' },
        {
          registry: reg,
          executionEngine: engine,
          configs: {
            'conn-no-disabled': { connectorId: 'conn-no-disabled', enabled: false },
            'conn-no-empty': { connectorId: 'conn-no-empty', enabled: true },
            'conn-osm': { connectorId: 'conn-osm', enabled: true },
          },
        }
      );

      assert.strictEqual(osmCalled, true);
      assert.strictEqual(res.leads.length, 1);
      assert.strictEqual(res.leads[0].companyName, 'Trondheim Solar Hub');
      assert.ok(res.connectorSummaries.some((s) => s.connectorId === 'conn-no-disabled' && s.status === 'skipped'));
    });

    it('rejects explicit manual selection of a disabled connector with configuration_error', async () => {
      const reg = new ConnectorRegistry();
      reg.register(createMockDiscoveryConnector('conn-manual', { supportedCountries: ['NO'] }));
      const service = new DiscoveryService();

      await assert.rejects(
        () =>
          service.executeSearch(
            { query: 'Nordic', countryCode: 'NO', connectorId: 'conn-manual', selectionMode: 'manual' },
            {
              registry: reg,
              configs: { 'conn-manual': { connectorId: 'conn-manual', enabled: false } },
            }
          ),
        (err: unknown) => err instanceof ConnectorError && err.category === 'configuration_error'
      );
    });
  });

  describe('5. Enrichment Pipeline (SSRF-Protected Web Inspector + Gemini AI Fallback + Run Ledger)', () => {
    it('enriches candidates cleanly, logs ConnectorRunRecord entries, updates session cache, and blocks private SSRF targets', async () => {
      const ssrfBlocked = await inspectWebsite('http://127.0.0.1:8080/internal');
      assert.strictEqual(ssrfBlocked.securityCheck.passed, false);
      assert.strictEqual(ssrfBlocked.isOnline, false);

      const service = new DiscoveryService();
      const lead = makeSampleLead({
        id: 'enrich-1',
        companyName: 'Nordic Wind AS',
        website: 'https://nordicwind.no',
        domain: 'nordicwind.no',
        confidenceScore: 70,
      });

      const recordedRuns: any[] = [];
      const enriched = await service.enrichCandidate(
        {
          lead,
          runWebInspector: true,
          runAi: true,
        },
        {
          onRecordRun: async (r) => void recordedRuns.push(r),
          inspectWebsiteFn: async (rawUrl: string) => ({
            url: rawUrl,
            domain: 'nordicwind.no',
            isOnline: true,
            httpStatus: 200,
            isHttps: true,
            title: 'Nordic Wind Solutions',
            description: 'Clean wind power engineering in Norway.',
            emailsFound: ['contact@nordicwind.no'],
            phonesFound: [],
            socialLinks: { linkedin: 'https://linkedin.com/company/nordic-wind' },
            serverLatencyMs: 95,
            securityCheck: { passed: true },
          }),
          analyzeLeadWithAiFn: async () => ({
            fitScore: 91,
            qualificationStatus: 'Strong Fit',
            summary: 'Verified engineering operator in renewable sector.',
            keyStrengths: ['Verified corporate status'],
            missingDataGaps: [],
            recommendedStrategy: 'Send executive technical overview',
            suggestedQualificationQuestions: ['Are you expanding offshore wind maintenance?'],
            engine: 'deterministic-pipeline',
          }),
        }
      );

      assert.strictEqual(enriched.lead.email, 'contact@nordicwind.no');
      assert.strictEqual(enriched.lead.webMetadata?.httpStatus, 200);
      assert.strictEqual(enriched.lead.customFields?.aiFitScore, '91');
      assert.strictEqual(enriched.lead.confidenceScore, 80);
      assert.strictEqual(recordedRuns.length, 2);
      assert.deepStrictEqual(
        recordedRuns.map((r) => r.connectorId),
        ['conn-web-inspector', 'conn-gemini']
      );
    });
  });

  describe('6. Cross-Source & Cross-Country Deduplication + Non-Auto-Merged Ambiguous Review', () => {
    it('classifies existing CRM matches, cross-source corroborations, and flags ambiguous name/address/cross-country pairs without auto-merging', () => {
      const crmExisting = makeSampleLead({
        id: 'crm-1',
        companyName: 'NORDIC SEMICONDUCTOR ASA',
        registrationNumber: '923609016',
        registrationType: 'NO_ORG',
        domain: 'nordicsemi.com',
        phoneNormalized: '+4772898900',
        address: {
          street: 'Otto Nielsens veg 12',
          city: 'Trondheim',
          postalCode: '7052',
          country: 'Norway',
          countryCode: 'NO',
        },
      });

      const exactCrmCand = makeSampleLead({
        id: 'cand-exact',
        companyName: 'Nordic Semiconductor',
        registrationNumber: '923609016',
        address: { street: 'Other', city: 'Trondheim', country: 'Norway', countryCode: 'NO' },
      });

      const sharedAddressDiffName = makeSampleLead({
        id: 'cand-addr-ambig',
        companyName: 'Nordic Cafeteria & Catering',
        address: {
          street: 'Otto Nielsens veg 12',
          city: 'Trondheim',
          postalCode: '7052',
          country: 'Norway',
          countryCode: 'NO',
        },
      });

      const crossCountrySameName = makeSampleLead({
        id: 'cand-cross-country',
        companyName: 'NORDIC SEMICONDUCTOR ASA',
        address: {
          street: '100 First Street',
          city: 'Austin',
          country: 'United States',
          countryCode: 'US',
        },
      });

      const peerA = makeSampleLead({
        id: 'cand-peer-a',
        companyName: 'Bergen Marine Labs AS',
        domain: 'bergenmarine.no',
        address: { city: 'Bergen', country: 'Norway', countryCode: 'NO' },
      });
      const peerB = makeSampleLead({
        id: 'cand-peer-b',
        companyName: 'Bergen Marine Labs',
        domain: 'bergenmarine.no',
        address: { city: 'Bergen', country: 'Norway', countryCode: 'NO' },
      });

      const uniqueLead = makeSampleLead({
        id: 'cand-unique',
        companyName: 'Stavanger Subsea AS',
        domain: 'stavangersubsea.no',
        address: { city: 'Stavanger', country: 'Norway', countryCode: 'NO' },
      });

      const analysis = detectDiscoveryDuplicates(
        [exactCrmCand, sharedAddressDiffName, crossCountrySameName, peerA, peerB, uniqueLead],
        [crmExisting]
      );

      assert.strictEqual(analysis.duplicateInfoByLeadId['cand-exact'].status, 'existing_crm');
      assert.strictEqual(analysis.duplicateInfoByLeadId['cand-exact'].requiresReview, false);

      assert.strictEqual(analysis.duplicateInfoByLeadId['cand-addr-ambig'].status, 'ambiguous_crm');
      assert.strictEqual(analysis.duplicateInfoByLeadId['cand-addr-ambig'].requiresReview, true);
      assert.strictEqual(analysis.duplicateInfoByLeadId['cand-addr-ambig'].matchType, 'address');

      assert.strictEqual(analysis.duplicateInfoByLeadId['cand-cross-country'].status, 'ambiguous_crm');
      assert.strictEqual(analysis.duplicateInfoByLeadId['cand-cross-country'].requiresReview, true);

      assert.strictEqual(analysis.duplicateInfoByLeadId['cand-peer-a'].status, 'cross_source_match');
      assert.deepStrictEqual(analysis.duplicateInfoByLeadId['cand-peer-a'].crossSourceLeadIds, ['cand-peer-b']);

      assert.strictEqual(analysis.duplicateInfoByLeadId['cand-unique'].status, 'unique');
      assert.strictEqual(analysis.counts.existingCrmMatches, 1);
      assert.strictEqual(analysis.counts.ambiguousMatches, 2);
      assert.strictEqual(analysis.counts.crossSourceCorroborations, 2);
      assert.strictEqual(analysis.counts.totalUnique, 3);
    });
  });

  describe('7. Server-Side Pagination, Filtering & RFC 4180 Formula-Safe CSV Export', () => {
    it('paginates, filters by duplicate status/country, sorts, and exports formula-safe RFC 4180 CSV', async () => {
      const reg = new ConnectorRegistry();
      reg.register(
        createMockDiscoveryConnector(
          'conn-multi',
          { supportsAllCountries: true },
          async () => ({
            results: [
              {
                providerId: 'conn-multi',
                providerName: 'Multi Dir',
                sourceCategory: 'business_directory',
                accessMode: 'live_api',
                countryCode: 'NO',
                externalSourceId: 'm-1',
                company: {
                  companyName: '=HYPERLINK("http://evil.example","Zulu Systems")',
                  registrationNumber: '900111222',
                  address: { country: 'Norway', countryCode: 'NO', city: 'Oslo' },
                },
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'directory_listed',
                confidence: { supported: true, score: 90, signals: [] },
                providerMetadata: {},
              },
              {
                providerId: 'conn-multi',
                providerName: 'Multi Dir',
                sourceCategory: 'business_directory',
                accessMode: 'live_api',
                countryCode: 'GB',
                externalSourceId: 'm-2',
                company: {
                  companyName: 'Alpha Biotech Ltd',
                  registrationNumber: '07000111',
                  address: { country: 'United Kingdom', countryCode: 'GB', city: 'London' },
                },
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'directory_listed',
                confidence: { supported: true, score: 75, signals: [] },
                providerMetadata: {},
              },
              {
                providerId: 'conn-multi',
                providerName: 'Multi Dir',
                sourceCategory: 'business_directory',
                accessMode: 'live_api',
                countryCode: 'DE',
                externalSourceId: 'm-3',
                company: {
                  companyName: 'Mitte Cloud GmbH',
                  registrationNumber: 'HRB9911',
                  address: { country: 'Germany', countryCode: 'DE', city: 'Berlin' },
                },
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'directory_listed',
                confidence: { supported: true, score: 65, signals: [] },
                providerMetadata: {},
              },
            ],
            pagination: { page: 1, pageSize: 25, hasMore: false },
            rawCount: 3,
            attribution: 'Multi',
            notes: [],
            isLiveApi: true,
          })
        )
      );

      const service = new DiscoveryService();
      const res = await service.executeSearch(
        { query: 'Tech', page: 1, pageSize: 2 },
        { registry: reg, executionEngine: new ConnectorExecutionEngine(new CredentialManager()) }
      );

      assert.strictEqual(res.leads.length, 2);
      assert.strictEqual(res.pagination.totalItems, 3);
      assert.strictEqual(res.pagination.totalPages, 2);
      assert.strictEqual(res.pagination.hasMore, true);

      const page2 = service.getPaginatedResults(res.searchId, { page: 2, pageSize: 2, sortBy: 'name_asc' })!;
      assert.strictEqual(page2.leads.length, 1);

      const gbOnly = service.getPaginatedResults(res.searchId, { countryCode: 'GB' })!;
      assert.strictEqual(gbOnly.leads.length, 1);
      assert.strictEqual(gbOnly.leads[0].companyName, 'Alpha Biotech Ltd');

      const csv = service.exportSessionCsv(res.searchId)!;
      assert.ok(csv.startsWith('\uFEFF'));
      // Formula-injection protection prefixes '=' cells with single quote
      assert.match(csv, /'=HYPERLINK/);
      assert.match(csv, /Alpha Biotech Ltd/);
    });
  });

  describe('8. Partial Connector Failure Resilience & Secret Redaction', () => {
    it('preserves working connector results when another fails and redacts secrets from errorDetails', async () => {
      const reg = new ConnectorRegistry();
      reg.register(
        createMockDiscoveryConnector('conn-good', { supportedCountries: ['NO'] })
      );
      reg.register(
        createMockDiscoveryConnector(
          'conn-bad',
          {
            supportedCountries: ['NO'],
            executionPolicy: {
              timeoutMs: 1000,
              maxRetries: 0,
              baseBackoffMs: 5,
              maxBackoffMs: 10,
              maxConcurrency: 2,
              rateLimit: { maxRequests: 10, windowMs: 60_000, note: 'test' },
              defaultPageSize: 10,
              maxPageSize: 20,
            },
          },
          async () => {
            throw new ConnectorError({
              category: 'authentication_failure',
              providerId: 'conn-bad',
              httpStatus: 401,
              retryable: false,
              message: 'Rejected Basic ZGVtbzpwYXNzd29yZA== and AIzaSyDummySecretKey1234567890',
            });
          }
        )
      );

      const service = new DiscoveryService();
      const res = await service.executeSearch(
        { query: 'Nordic', countryCode: 'NO', selectionMode: 'auto' },
        { registry: reg, executionEngine: new ConnectorExecutionEngine(new CredentialManager()) }
      );

      assert.strictEqual(res.leads.length, 1);
      assert.ok(res.errorDetails && res.errorDetails.length === 1);
      assert.strictEqual(res.errorDetails[0].category, 'authentication_failure');
      assert.doesNotMatch(res.errorDetails[0].message, /ZGVtbzpwYXNzd29yZA==/);
      assert.doesNotMatch(res.errorDetails[0].message, /AIzaSyDummySecretKey/);
    });
  });

  describe('9. Rate Limits & Transient Retries via ConnectorExecutionEngine', () => {
    it('retries transient upstream 503 during discovery orchestration and succeeds cleanly', async () => {
      let attempts = 0;
      const reg = new ConnectorRegistry();
      reg.register(
        createMockDiscoveryConnector('conn-flaky', { supportedCountries: ['NO'] }, async (req) => {
          attempts++;
          if (attempts === 1) {
            throw new ConnectorError({
              category: 'provider_unavailable',
              providerId: 'conn-flaky',
              httpStatus: 503,
              retryable: true,
              message: 'Temporary 503',
            });
          }
          return {
            results: [
              {
                providerId: 'conn-flaky',
                providerName: 'Flaky',
                sourceCategory: 'business_directory',
                accessMode: 'live_api',
                countryCode: 'NO',
                externalSourceId: 'ok-1',
                company: {
                  companyName: `Recovered ${req.query}`,
                  address: { country: 'Norway', countryCode: 'NO', city: 'Oslo' },
                },
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'directory_listed',
                confidence: { supported: true, score: 80, signals: [] },
                providerMetadata: {},
              },
            ],
            pagination: { page: 1, pageSize: 25, hasMore: false },
            rawCount: 1,
            attribution: 'Mock',
            notes: [],
            isLiveApi: true,
          };
        })
      );

      const service = new DiscoveryService();
      const res = await service.executeSearch(
        { query: 'Energy', countryCode: 'NO', selectionMode: 'auto' },
        { registry: reg, executionEngine: new ConnectorExecutionEngine(new CredentialManager()) }
      );

      assert.strictEqual(attempts, 2);
      assert.strictEqual(res.leads.length, 1);
    });
  });

  describe('10. Search Cancellation & Duplicate Concurrent Search Coalescing', () => {
    it('cancels active searches via requestId and coalesces identical concurrent searches', async () => {
      const reg = new ConnectorRegistry();
      let calls = 0;

      reg.register(
        createMockDiscoveryConnector('conn-slow-coalesce', { supportedCountries: ['NO'] }, async (req, ctx) => {
          calls++;
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 40);
            ctx.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(t);
                reject(new Error('Aborted by owner'));
              },
              { once: true }
            );
          });
          return {
            results: [
              {
                providerId: 'conn-slow-coalesce',
                providerName: 'Slow',
                sourceCategory: 'business_directory',
                accessMode: 'live_api',
                countryCode: 'NO',
                externalSourceId: 'c-1',
                company: {
                  companyName: `Coalesced ${req.query}`,
                  address: { country: 'Norway', countryCode: 'NO' },
                },
                retrievedAt: new Date().toISOString(),
                verificationStatus: 'directory_listed',
                confidence: { supported: true, score: 77, signals: [] },
                providerMetadata: {},
              },
            ],
            pagination: { page: 1, pageSize: 25, hasMore: false },
            rawCount: 1,
            attribution: 'Mock',
            notes: [],
            isLiveApi: true,
          };
        })
      );

      const service = new DiscoveryService();
      const engine = new ConnectorExecutionEngine(new CredentialManager());

      const [r1, r2] = await Promise.all([
        service.executeSearch(
          { query: 'CoalesceMe', countryCode: 'NO', selectionMode: 'auto' },
          { registry: reg, executionEngine: engine }
        ),
        service.executeSearch(
          { query: 'CoalesceMe', countryCode: 'NO', selectionMode: 'auto' },
          { registry: reg, executionEngine: engine }
        ),
      ]);

      assert.strictEqual(calls, 1, 'Identical concurrent searches must coalesce to 1 execution');
      assert.strictEqual(r1.searchId, r2.searchId);
      assert.strictEqual(r2.coalesced, true);

      // Now verify cancellation
      const pending = service.executeSearch(
        { requestId: 'req-cancel-test-1', query: 'CancelTarget', countryCode: 'NO', selectionMode: 'auto' },
        { registry: reg, executionEngine: engine }
      );
      await new Promise((r) => setTimeout(r, 10));
      const cancelled = service.cancelSearch('req-cancel-test-1');
      assert.strictEqual(cancelled, true);

      const cancelResult = await pending;
      assert.strictEqual(cancelResult.cancelled, true);
      assert.ok(cancelResult.connectorSummaries.some((s) => s.status === 'cancelled'));
    });
  });

  describe('11 & 12. Duplicate-Aware CRM Saving (Pg Mock) Preserving CRM History & Partial Row Errors', () => {
    it('preserves existing CRM status, stage, notes, activities, and value while merging new sources/identifiers and reporting invalid rows', async () => {
      const pgStore = new PostgresStorage();

      const existingLead = makeSampleLead({
        id: 'crm-existing-no-1',
        companyName: 'NORDIC SEMICONDUCTOR ASA',
        registrationNumber: '923609016',
        registrationType: 'NO_ORG',
        domain: 'nordicsemi.com',
        status: 'qualified',
        pipelineStageId: 'stage-proposal',
        opportunityValue: 75000,
        currency: 'NOK',
        winProbability: 70,
        notes: [
          { id: 'note-crm-1', content: 'Owner spoken with VP Sales', createdAt: '2026-11-01T10:00:00Z', author: 'Owner' },
        ],
        activities: [
          { id: 'act-crm-1', type: 'call', title: 'Discovery call', outcome: 'Positive', date: '2026-11-02T10:00:00Z', actor: 'Owner' },
        ],
        sources: [{ sourceName: 'Norway Brreg', providerId: '923609016', retrievedAt: '2026-11-01T00:00:00Z' }],
        identifiers: [{ type: 'NO_ORG', value: '923609016', countryCode: 'NO', verified: true, status: 'officially_verified' }],
      });

      const savedPayloads: CanonicalLead[] = [];
      (pgStore as any).getLeads = async () => [existingLead];
      (pgStore as any).upsertLead = async (lead: CanonicalLead) => {
        savedPayloads.push(lead);
        return lead;
      };

      const incomingDuplicate = makeSampleLead({
        id: 'disc-osm-999',
        companyName: 'Nordic Semi HQ',
        registrationNumber: '923609016',
        domain: 'nordicsemi.com',
        status: 'new',
        pipelineStageId: 'stage-new',
        opportunityValue: 0,
        notes: [],
        activities: [
          { id: 'act-disc-1', type: 'enrichment', title: 'OSM tag found', outcome: 'Added phone', date: '2026-11-13T10:00:00Z', actor: 'OSM' },
        ],
        sources: [{ sourceName: 'OpenStreetMap POI', providerId: 'node-999', retrievedAt: '2026-11-13T10:00:00Z' }],
        identifiers: [
          { type: 'NO_ORG', value: '923609016', countryCode: 'NO', verified: false, status: 'discovered' },
          { type: 'DOMAIN', value: 'nordicsemi.com', countryCode: 'NO', verified: false, status: 'discovered' },
        ],
      });

      const incomingBrandNew = makeSampleLead({
        id: 'disc-new-2',
        companyName: 'Bergen Marine AI AS',
        registrationNumber: '988776655',
        domain: 'bergenmarineai.no',
      });

      const invalidRow = { id: 'bad-row', companyName: '   ' } as CanonicalLead;

      const summary = await pgStore.batchUpsertLeads([incomingDuplicate, incomingBrandNew, invalidRow]);

      assert.strictEqual(summary.added, 1);
      assert.strictEqual(summary.updated, 1);
      assert.strictEqual(summary.skipped, 0);
      assert.strictEqual(summary.failed, 1);
      assert.strictEqual(summary.errors.length, 1);
      assert.strictEqual(summary.errors[0].row, 3);

      const merged = savedPayloads.find((p) => p.id === 'crm-existing-no-1')!;
      assert.ok(merged);
      assert.strictEqual(merged.status, 'qualified');
      assert.strictEqual(merged.pipelineStageId, 'stage-proposal');
      assert.strictEqual(merged.opportunityValue, 75000);
      assert.strictEqual(merged.winProbability, 70);
      assert.strictEqual(merged.notes.length, 1);
      assert.strictEqual(merged.notes[0].content, 'Owner spoken with VP Sales');
      assert.strictEqual(merged.activities.length, 2);
      assert.strictEqual(merged.sources.length, 2);
      // Higher verification status on existing NO_ORG identifier MUST be preserved
      const orgIdent = merged.identifiers.find((i) => i.type === 'NO_ORG')!;
      assert.strictEqual(orgIdent.verified, true);
      assert.strictEqual(orgIdent.status, 'officially_verified');
    });
  });

  describe('13. Security, Owner Auth & UI API Hygiene Regressions', () => {
    it('registers all Phase 5 discovery routes under protectedApi and avoids raw fetch() in DiscoveryEngine UI', () => {
      const root = process.cwd();
      const serverCode = fs.readFileSync(path.join(root, 'server.ts'), 'utf-8');
      const discoveryUi = fs.readFileSync(path.join(root, 'src/components/DiscoveryEngine.tsx'), 'utf-8');

      for (const route of [
        "protectedApi.post('/discovery/search'",
        "protectedApi.get('/discovery/results/:searchId'",
        "protectedApi.post('/discovery/cancel/:requestId'",
        "protectedApi.get('/discovery/history'",
        "protectedApi.post('/discovery/enrich'",
        "protectedApi.post('/discovery/save'",
        "protectedApi.get('/discovery/export/:searchId'",
      ]) {
        assert.ok(serverCode.includes(route), `Missing protected route: ${route}`);
      }

      assert.doesNotMatch(
        discoveryUi,
        /\bfetch\s*\(/,
        'DiscoveryEngine.tsx must use apiFetch() exclusively (no raw fetch)'
      );
      assert.ok(discoveryUi.includes('apiFetch('));
    });
  });

  describe('14. Pipeline Stage Foreign-Key Resolution & Idempotent Initialization (Isolated Stateful Mock Pool)', () => {
    interface MockStageRow {
      id: string;
      name: string;
      color: string;
      display_order: number;
    }

    function createStatefulMockPgPool(initialStages: MockStageRow[] = []) {
      let stages = new Map<string, MockStageRow>(initialStages.map((s) => [s.id, { ...s }]));
      let leads = new Map<string, any>();
      let identifiers = new Map<string, any>();
      let sources = new Map<string, any>();
      let activities = new Map<string, any>();
      const txLog: string[] = [];

      const buildLeadRow = (l: any) => ({
        ...l,
        sources_json: Array.from(sources.values()).filter((s) => s.lead_id === l.id),
        identifiers_json: Array.from(identifiers.values()).filter((i) => i.lead_id === l.id),
        notes_json: [],
        activities_json: Array.from(activities.values()).filter((a) => a.lead_id === l.id),
      });

      return {
        txLog,
        getStageRows: () =>
          Array.from(stages.values()).sort((a, b) => a.display_order - b.display_order),
        getLeadRows: () => Array.from(leads.values()),
        async connect() {
          let snapshot: {
            stages: Map<string, MockStageRow>;
            leads: Map<string, any>;
            identifiers: Map<string, any>;
            sources: Map<string, any>;
            activities: Map<string, any>;
          } | null = null;

          return {
            async query(sql: string, params: any[] = []) {
              const q = sql.replace(/\s+/g, ' ').trim();
              if (q === 'BEGIN') {
                txLog.push('BEGIN');
                snapshot = {
                  stages: new Map(Array.from(stages.entries()).map(([k, v]) => [k, { ...v }])),
                  leads: new Map(Array.from(leads.entries()).map(([k, v]) => [k, { ...v }])),
                  identifiers: new Map(Array.from(identifiers.entries()).map(([k, v]) => [k, { ...v }])),
                  sources: new Map(Array.from(sources.entries()).map(([k, v]) => [k, { ...v }])),
                  activities: new Map(Array.from(activities.entries()).map(([k, v]) => [k, { ...v }])),
                };
                return { rows: [], rowCount: 0 };
              }
              if (q === 'COMMIT') {
                txLog.push('COMMIT');
                snapshot = null;
                return { rows: [], rowCount: 0 };
              }
              if (q === 'ROLLBACK') {
                txLog.push('ROLLBACK');
                if (snapshot) {
                  stages = snapshot.stages;
                  leads = snapshot.leads;
                  identifiers = snapshot.identifiers;
                  sources = snapshot.sources;
                  activities = snapshot.activities;
                  snapshot = null;
                }
                return { rows: [], rowCount: 0 };
              }
              if (q.startsWith('SELECT id, name, color, display_order FROM pipeline_stages')) {
                const rows = Array.from(stages.values()).sort((a, b) => a.display_order - b.display_order);
                return { rows, rowCount: rows.length };
              }
              if (q.startsWith('SELECT id, name FROM pipeline_stages WHERE id = $1')) {
                const found = stages.get(params[0]);
                return { rows: found ? [{ id: found.id, name: found.name }] : [], rowCount: found ? 1 : 0 };
              }
              if (q.startsWith('INSERT INTO pipeline_stages')) {
                const [id, name, color, display_order] = params;
                if (stages.has(id)) {
                  return { rows: [], rowCount: 0 };
                }
                stages.set(id, { id, name, color, display_order });
                return { rows: [], rowCount: 1 };
              }
              if (q.startsWith('SELECT l.*,')) {
                if (q.includes('WHERE l.id = $1')) {
                  const found = leads.get(params[0]);
                  return { rows: found ? [buildLeadRow(found)] : [], rowCount: found ? 1 : 0 };
                }
                const all = Array.from(leads.values()).map(buildLeadRow);
                return { rows: all, rowCount: all.length };
              }
              if (q.startsWith('INSERT INTO leads')) {
                const stageId = params[28];
                if (stageId !== null && stageId !== undefined && !stages.has(stageId)) {
                  throw new Error('insert or update on table "leads" violates foreign key constraint "leads_pipeline_stage_id_fkey"');
                }
                const row = {
                  id: params[0],
                  company_name: params[1],
                  legal_name: params[2],
                  registration_number: params[3],
                  registration_type: params[4],
                  company_status: params[5],
                  website: params[6],
                  domain: params[7],
                  email: params[8],
                  email_status: params[9],
                  phone: params[10],
                  phone_normalized: params[11],
                  street: params[12],
                  city: params[13],
                  region: params[14],
                  postal_code: params[15],
                  country: params[16],
                  country_code: params[17],
                  formatted_address: params[18],
                  latitude: params[19],
                  longitude: params[20],
                  industry: params[21],
                  category: params[22],
                  employee_range: params[23],
                  founded_year: params[24],
                  confidence_score: params[25],
                  confidence_signals: params[26],
                  status: params[27],
                  pipeline_stage_id: stageId,
                  opportunity_value: params[29],
                  currency: params[30],
                  win_probability: params[31],
                  lost_reason: params[32],
                  tags: params[33],
                  web_metadata: params[34],
                  social_links: params[35],
                  custom_fields: params[36],
                  created_at: params[37],
                  updated_at: params[38],
                };
                leads.set(row.id, row);
                return { rows: [], rowCount: 1 };
              }
              if (q.startsWith('UPDATE leads SET pipeline_stage_id = $1')) {
                const [stageId, newStatus, lostReason, leadId] = params;
                if (stageId !== null && stageId !== undefined && !stages.has(stageId)) {
                  throw new Error('insert or update on table "leads" violates foreign key constraint "leads_pipeline_stage_id_fkey"');
                }
                const existing = leads.get(leadId);
                if (existing) {
                  existing.pipeline_stage_id = stageId;
                  if (newStatus) existing.status = newStatus;
                  existing.lost_reason = lostReason;
                }
                return { rows: [], rowCount: existing ? 1 : 0 };
              }
              if (q.startsWith('SELECT id, type, value FROM lead_identifiers')) {
                const rows = Array.from(identifiers.values()).filter((i) => i.lead_id === params[0]);
                return { rows, rowCount: rows.length };
              }
              if (q.startsWith('INSERT INTO lead_identifiers')) {
                identifiers.set(`${params[1]}:${params[2]}:${params[3]}`, {
                  id: params[0],
                  lead_id: params[1],
                  type: params[2],
                  value: params[3],
                  verified: params[4],
                  country_code: params[5],
                  normalized_value: params[6],
                  issuing_authority: params[7],
                  source: params[8],
                  status: params[9],
                });
                return { rows: [], rowCount: 1 };
              }
              if (q.startsWith('INSERT INTO lead_sources')) {
                sources.set(params[0], {
                  id: params[0],
                  lead_id: params[1],
                  source_name: params[2],
                  provider_id: params[3],
                  url: params[4],
                  retrieved_at: params[5],
                  license: params[6],
                  attribution: params[7],
                });
                return { rows: [], rowCount: 1 };
              }
              if (q.startsWith('INSERT INTO activities')) {
                activities.set(params[0], {
                  id: params[0],
                  lead_id: params[1],
                  type: params[2],
                  title: params[3],
                  notes: params[4],
                  outcome: params[5],
                  actor: params[6],
                  date: params[7],
                });
                return { rows: [], rowCount: 1 };
              }
              return { rows: [], rowCount: 0 };
            },
            release() {
              // noop
            },
          };
        },
      };
    }

    it('14.1 Empty pipeline initializes default stages transactionally when saving normalized Norway Brreg lead', async () => {
      const normalized = normalizeConnectorResult({
        providerId: 'conn-brreg',
        providerName: 'Norway Brønnøysund Register (Brreg)',
        sourceCategory: 'government_registry',
        externalSourceId: '923609016',
        retrievedAt: '2026-11-13T12:00:00Z',
        accessMode: 'live_api',
        verificationStatus: 'officially_verified',
        countryCode: 'NO',
        company: {
          companyName: 'NORDIC SEMICONDUCTOR ASA',
          registrationNumber: '923609016',
          registrationType: 'NO_ORG',
          address: {
            city: 'Trondheim',
            country: 'Norway',
            countryCode: 'NO',
          },
          industry: 'Semiconductor Manufacturing',
        },
        providerMetadata: {},
      });
      assert.ok(normalized.lead, 'Brreg result should normalize cleanly');
      assert.strictEqual(
        normalized.lead.pipelineStageId,
        undefined,
        'Normalizer must NOT hardcode a fabricated pipelineStageId'
      );

      const mockPool = createStatefulMockPgPool([]); // empty pipeline_stages (0 rows)
      const pgStore = new PostgresStorage();
      (pgStore as any).getClient = () => mockPool;

      const summary = await pgStore.batchUpsertLeads([normalized.lead]);

      assert.strictEqual(summary.added, 1);
      assert.strictEqual(summary.failed, 0);
      assert.strictEqual(summary.errors.length, 0);
      assert.strictEqual(mockPool.getStageRows().length, DEFAULT_PIPELINE_STAGES.length);
      assert.strictEqual(mockPool.getLeadRows().length, 1);
      assert.strictEqual(mockPool.getLeadRows()[0].pipeline_stage_id, DEFAULT_PIPELINE_STAGES[0].id);
    });

    it('14.2 Existing custom pipeline is preserved untouched and omitted stage resolves to first custom stage', async () => {
      const mockPool = createStatefulMockPgPool([
        { id: 'custom-intake', name: 'Custom Intake', color: '#111111', display_order: 1 },
        { id: 'custom-won', name: 'Custom Won', color: '#222222', display_order: 2 },
      ]);
      const pgStore = new PostgresStorage();
      (pgStore as any).getClient = () => mockPool;

      const initRes = await pgStore.initializeDefaultStages();
      assert.strictEqual(initRes.initialized, false);
      assert.strictEqual(initRes.insertedCount, 0);
      assert.deepStrictEqual(
        mockPool.getStageRows().map((s) => s.id),
        ['custom-intake', 'custom-won']
      );

      const leadWithoutStage = makeSampleLead({
        id: 'lead-custom-pipeline-1',
        companyName: 'Oslo Maritime Systems AS',
        pipelineStageId: undefined,
      });
      leadWithoutStage.pipelineStageId = undefined;

      const saved = await pgStore.upsertLead(leadWithoutStage);
      assert.strictEqual(saved.pipelineStageId, 'custom-intake');
      assert.deepStrictEqual(
        mockPool.getStageRows().map((s) => s.id),
        ['custom-intake', 'custom-won']
      );
    });

    it('14.3 Repeated stage initialization is strictly idempotent with zero duplicates', async () => {
      const mockPool = createStatefulMockPgPool([]);
      const pgStore = new PostgresStorage();
      (pgStore as any).getClient = () => mockPool;

      const first = await pgStore.initializeDefaultStages();
      const second = await pgStore.initializeDefaultStages();
      const third = await pgStore.initializeDefaultStages();

      assert.strictEqual(first.initialized, true);
      assert.strictEqual(first.insertedCount, DEFAULT_PIPELINE_STAGES.length);
      assert.strictEqual(second.initialized, false);
      assert.strictEqual(second.insertedCount, 0);
      assert.strictEqual(third.initialized, false);
      assert.strictEqual(third.insertedCount, 0);
      assert.strictEqual(mockPool.getStageRows().length, DEFAULT_PIPELINE_STAGES.length);
    });

    it('14.4 Valid explicit stage insertion and moveLeadStage succeed cleanly', async () => {
      const mockPool = createStatefulMockPgPool([
        { id: 'custom-intake', name: 'Custom Intake', color: '#111111', display_order: 1 },
        { id: 'custom-won', name: 'Custom Won', color: '#222222', display_order: 2 },
      ]);
      const pgStore = new PostgresStorage();
      (pgStore as any).getClient = () => mockPool;

      const lead = makeSampleLead({
        id: 'lead-valid-stage-1',
        companyName: 'Bergen Energy AS',
        pipelineStageId: 'custom-intake',
      });
      const created = await pgStore.upsertLead(lead);
      assert.strictEqual(created.pipelineStageId, 'custom-intake');

      const moved = await pgStore.moveLeadStage('lead-valid-stage-1', 'custom-won', undefined, 'Owner');
      assert.ok(moved);
      assert.strictEqual(moved.pipelineStageId, 'custom-won');
    });

    it('14.5 Invalid stage reference triggers transactional rollback and reports clear per-row batch error', async () => {
      const mockPool = createStatefulMockPgPool([
        { id: 'custom-intake', name: 'Custom Intake', color: '#111111', display_order: 1 },
      ]);
      const pgStore = new PostgresStorage();
      (pgStore as any).getClient = () => mockPool;

      const badLead = makeSampleLead({
        id: 'lead-invalid-stage-1',
        companyName: 'Broken Stage Corp',
        pipelineStageId: 'stage-nonexistent-999',
      });

      await assert.rejects(
        async () => pgStore.upsertLead(badLead),
        /Invalid pipelineStageId "stage-nonexistent-999": stage does not exist in pipeline_stages\./
      );
      assert.ok(mockPool.txLog.includes('ROLLBACK'), 'Failed upsert must issue ROLLBACK');
      assert.strictEqual(mockPool.getLeadRows().length, 0, 'Rolled-back insert must leave leads table clean');

      const validLead = makeSampleLead({
        id: 'lead-valid-sibling-1',
        companyName: 'Trondheim Hydro AS',
        pipelineStageId: 'custom-intake',
      });

      const batchRes = await pgStore.batchUpsertLeads([validLead, badLead]);
      assert.strictEqual(batchRes.added, 1);
      assert.strictEqual(batchRes.failed, 1);
      assert.strictEqual(batchRes.errors.length, 1);
      assert.strictEqual(batchRes.errors[0].row, 2);
      assert.strictEqual(batchRes.errors[0].companyName, 'Broken Stage Corp');
      assert.match(batchRes.errors[0].error, /Invalid pipelineStageId "stage-nonexistent-999"/);

      await assert.rejects(
        async () => pgStore.moveLeadStage('lead-valid-sibling-1', 'stage-nonexistent-999', undefined, 'Owner'),
        /Invalid pipelineStageId "stage-nonexistent-999"/
      );
      assert.strictEqual(
        mockPool.getLeadRows()[0].pipeline_stage_id,
        'custom-intake',
        'Failed moveLeadStage must preserve existing stage via rollback'
      );
    });

    it('14.6 Server routes & frontend components avoid hardcoded stage-discovered and protect stage initialization', () => {
      const root = process.cwd();
      const serverCode = fs.readFileSync(path.join(root, 'server.ts'), 'utf-8');
      const importModalCode = fs.readFileSync(path.join(root, 'src/components/ImportModal.tsx'), 'utf-8');
      const leadsViewCode = fs.readFileSync(path.join(root, 'src/components/LeadsView.tsx'), 'utf-8');
      const normalizerCode = fs.readFileSync(path.join(root, 'server/connectors/core/normalizer.ts'), 'utf-8');
      const pipelineBoardCode = fs.readFileSync(path.join(root, 'src/components/PipelineBoard.tsx'), 'utf-8');

      assert.ok(
        serverCode.includes("protectedApi.post('/pipeline/stages/initialize'"),
        'Stage initialization endpoint must be registered under protectedApi'
      );
      assert.ok(
        !importModalCode.includes("pipelineStageId: 'stage-discovered'"),
        'ImportModal must not hardcode stage-discovered'
      );
      assert.ok(
        !leadsViewCode.includes("'stage-discovered'"),
        'LeadsView must not hardcode stage-discovered'
      );
      assert.ok(
        !normalizerCode.includes("'stage-discovered'"),
        'Connector normalizer must not hardcode stage-discovered'
      );
      assert.ok(
        pipelineBoardCode.includes('Initialize Default Pipeline Stages'),
        'PipelineBoard should expose owner-triggered empty pipeline initialization action'
      );
    });
  });
});
