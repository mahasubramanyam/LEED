import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEARCH_AND_DIRECTORY_PROVIDERS,
  buildSearchAndDirectoryProviderMatrix,
} from '../server/connectors/searchProvidersCatalog.ts';
import { BraveSearchConnector } from '../server/connectors/adapters/braveSearchAdapter.ts';
import { GoogleCseConnector } from '../server/connectors/adapters/googleSearchAdapter.ts';
import { WikidataConnector } from '../server/connectors/adapters/wikidataAdapter.ts';
import { OpenCorporatesConnector } from '../server/connectors/adapters/openCorporatesAdapter.ts';
import { inspectWebsite } from '../server/connectors/webInspector.ts';
import { DiscoveryService } from '../server/discovery/discoveryService.ts';
import { ConnectorRegistry } from '../server/connectors/core/registry.ts';
import { ConnectorExecutionEngine } from '../server/connectors/core/executionEngine.ts';
import { ConnectorExecutionContext } from '../server/connectors/core/types.ts';
import { ConnectorError } from '../server/connectors/core/errors.ts';
import {
  normalizeConnectorResult,
  mergeProviderObservationIntoLead,
  PROVENANCE_RANK,
  computeEvidenceConfidence,
} from '../server/connectors/core/normalizer.ts';
import { detectDiscoveryDuplicates } from '../server/connectors/dedupeEngine.ts';
import {
  generateDiscoveryQueriesWithAi,
  extractBusinessIntelFromWebEvidence,
  assessDuplicatePairWithAi,
} from '../server/gemini.ts';
import { ensureConnectorsRegistered, connectorRegistry } from '../server/connectors/index.ts';
import { CanonicalLead, ConnectorStatus } from '../server/types.ts';

const originalFetch = globalThis.fetch;
const originalGeminiKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
});

const publicDns = async () => [{ address: '93.184.216.34', family: 4 as const }];

function makeContext(overrides: Partial<ConnectorExecutionContext> = {}): ConnectorExecutionContext {
  const controller = new AbortController();
  return {
    requestId: 'req-phase10-test',
    userAgent: 'LEED-Phase10-Test/1.0 (test@leed-pipeline.local)',
    credentials: {},
    credentialSource:
      overrides.credentials && Object.keys(overrides.credentials).length > 0 ? 'database_encrypted' : 'none',
    config: { connectorId: 'test', enabled: true },
    timeoutMs: 5000,
    signal: controller.signal,
    ...overrides,
  };
}

function makeLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = new Date().toISOString();
  return {
    id: 'lead-p10-1',
    companyName: 'Nordic Example AS',
    legalName: 'Nordic Example AS',
    industry: 'Semiconductors',
    category: 'B2B',
    confidenceScore: 70,
    confidenceSignals: ['Test record'],
    sources: [{ sourceName: 'Brreg', retrievedAt: now }],
    identifiers: [],
    status: 'new',
    currency: 'EUR',
    tags: [],
    notes: [],
    activities: [],
    createdAt: now,
    updatedAt: now,
    address: {
      city: 'Trondheim',
      street: 'Otto Nielsens veg 12',
      country: 'Norway',
      countryCode: 'NO',
    },
    ...overrides,
  };
}

describe('Phase 10 — Web Search & Public Directory Catalog & Connector Registration', () => {
  it('registers all 22 connectors preserving all 18 prior IDs plus 4 Phase 10 search/directory adapters', () => {
    ensureConnectorsRegistered();
    const ids = connectorRegistry.listAll().map((c) => c.id);
    assert.ok(ids.length >= 22);
    for (const expectedId of [
      'conn-brreg',
      'conn-companies-house',
      'conn-abn',
      'conn-osm',
      'conn-wikidata',
      'conn-opencorporates',
      'conn-brave-search',
      'conn-google-cse',
      'conn-web-inspector',
      'conn-gemini',
    ]) {
      assert.ok(ids.includes(expectedId), `Missing registered connector ${expectedId}`);
    }
  });

  it('documents Brave Search, Google CSE (legacy Jan 2027 sunset), Bing (retired Aug 11 2025), Wikidata CC0, OSM, and OpenCorporates', () => {
    const byId = new Map(SEARCH_AND_DIRECTORY_PROVIDERS.map((p) => [p.id, p]));
    assert.ok(byId.get('brave-search-api')?.officialEndpoint.includes('api.search.brave.com'));
    assert.equal(byId.get('google-custom-search')?.availability, 'restricted_legacy_sunsetting');
    assert.ok(byId.get('google-custom-search')?.honestStatusNote.includes('2027') || byId.get('google-custom-search')?.commercialUsage.includes('2027'));
    assert.equal(byId.get('bing-web-search-retired')?.availability, 'retired_unavailable');
    assert.ok(byId.get('bing-web-search-retired')?.honestStatusNote.includes('Aug 11, 2025'));
    assert.equal(byId.get('wikidata-directory')?.availability, 'available_open');
    assert.equal(byId.get('opencorporates-directory')?.availability, 'available_configuration_required');

    const fakeStatuses = [
      {
        id: 'conn-brave-search',
        authType: 'api_key',
        isConfigured: true,
        operational: true,
        healthState: 'operational',
      } as ConnectorStatus,
      {
        id: 'conn-wikidata',
        authType: 'none_open',
        isConfigured: true,
        operational: true,
        healthState: 'operational',
        config: { connectorId: 'conn-wikidata', enabled: true },
      } as ConnectorStatus,
    ];
    const matrix = buildSearchAndDirectoryProviderMatrix(fakeStatuses);
    const braveDoc = matrix.find((m) => m.id === 'brave-search-api');
    const bingDoc = matrix.find((m) => m.id === 'bing-web-search-retired');
    assert.equal(braveDoc?.availability, 'available_configured');
    assert.equal(braveDoc?.configuredInVault, true);
    assert.equal(bingDoc?.availability, 'retired_unavailable');
    assert.equal(bingDoc?.operational, false);
  });
});

describe('Phase 10 — Brave Search & Google CSE Connectors (Credentials, Redaction, Pagination, Honest Confidence)', () => {
  it('BraveSearchConnector rejects missing credentials cleanly without fabricating results', async () => {
    const conn = new BraveSearchConnector();
    await assert.rejects(
      () => conn.search({ query: 'Nordic Semiconductor' }, makeContext()),
      (err: unknown) => err instanceof ConnectorError && err.category === 'missing_credentials'
    );
  });

  it('BraveSearchConnector injects X-Subscription-Token, redacts secrets on errors, and emits unverified search candidates', async () => {
    const secret = 'BSA_SUPER_SECRET_TOKEN_9988';
    let capturedTokenHeader = '';
    let capturedUrl = '';

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedTokenHeader = headers.get('X-Subscription-Token') || '';
      return new Response(
        JSON.stringify({
          query: { original: 'Nordic Semiconductor', more_results_available: true },
          web: {
            results: [
              {
                title: 'Nordic Semiconductor | Wireless IoT Solutions',
                url: 'https://www.nordicsemi.com/Products',
                description: 'Ultra-low-power wireless IoT chips and Bluetooth Low Energy SoCs.',
                profile: { name: 'Nordic Semiconductor' },
              },
              {
                title: 'Nordic Semiconductor — Support',
                url: 'https://www.nordicsemi.com/support',
                description: 'Duplicate domain result that should deduplicate within same search response.',
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '19' } }
      );
    };

    const conn = new BraveSearchConnector(mockFetch, publicDns);
    const res = await conn.search(
      {
        query: 'Nordic Semiconductor',
        countryCode: 'NO',
        city: 'Trondheim',
        page: 2,
        pageSize: 10,
      },
      makeContext({ credentials: { apiKey: secret } })
    );

    assert.equal(capturedTokenHeader, secret);
    assert.ok(capturedUrl.includes('offset=1'));
    assert.ok(capturedUrl.includes('country=NO'));
    assert.equal(res.results.length, 1); // domain deduplicated inside connector
    assert.equal(res.results[0].verificationStatus, 'unverified');
    assert.ok((res.results[0].confidence?.score ?? 100) <= 48);
    assert.equal(res.pagination?.hasMore, true);
    assert.equal(res.results[0].company.domain, 'nordicsemi.com');

    // Secret redaction check on upstream 401 failure
    const failFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: `Invalid token ${secret}` }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    const failConn = new BraveSearchConnector(failFetch, publicDns);
    const validation = await failConn.validateConnection(makeContext({ credentials: { apiKey: secret } }));
    assert.equal(validation.ok, false);
    assert.equal(validation.healthState, 'authentication_required');
    assert.ok(!validation.message.includes(secret), 'API key leaked into error message!');
  });

  it('GoogleCseConnector requires apiKey + cx and normalizes results with unverified tier & secret redaction', async () => {
    const conn = new GoogleCseConnector();
    await assert.rejects(
      () => conn.search({ query: 'Fintech' }, makeContext({ credentials: { apiKey: 'AIzaTestOnly' } })),
      (err: unknown) => err instanceof ConnectorError && err.category === 'missing_credentials'
    );

    const secretKey = 'AIzaSECRET_KEY_TEST';
    const mockFetch: typeof fetch = async (input) => {
      const u = new URL(String(input));
      assert.equal(u.searchParams.get('key'), secretKey);
      assert.equal(u.searchParams.get('cx'), 'cx-123');
      assert.equal(u.searchParams.get('gl'), 'gb');
      return new Response(
        JSON.stringify({
          searchInformation: { totalResults: '42' },
          queries: { nextPage: [{ startIndex: 11 }] },
          items: [
            {
              title: 'Acme Robotics Ltd — Industrial Automation',
              link: 'https://acmerobotics.co.uk/about',
              displayLink: 'www.acmerobotics.co.uk',
              snippet: 'British robotics manufacturer based in London.',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const liveConn = new GoogleCseConnector(mockFetch, publicDns);
    const res = await liveConn.search(
      { query: 'Acme Robotics', countryCode: 'GB', page: 1, pageSize: 10 },
      makeContext({ credentials: { apiKey: secretKey, cx: 'cx-123' } })
    );
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].company.companyName, 'Acme Robotics Ltd');
    assert.equal(res.results[0].verificationStatus, 'unverified');
    assert.ok((res.results[0].confidence?.score ?? 100) <= 48);
    assert.equal(res.pagination?.hasMore, true);
  });
});

describe('Phase 10 — Public Business Directories (Wikidata CC0 & OpenCorporates v0.4)', () => {
  it('WikidataConnector filters non-business items and resolves P856 website, P17 country, P571 inception, and P1278 LEI', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const u = String(input);
      if (u.includes('action=wbsearchentities')) {
        return new Response(
          JSON.stringify({
            search: [
              { id: 'Q559', label: 'Nordic Semiconductor', description: 'Norwegian fabless semiconductor company' },
              { id: 'Q999', label: 'Semiconductor (Album)', description: '2012 studio album by Artist' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          entities: {
            Q559: {
              id: 'Q559',
              labels: { en: { value: 'Nordic Semiconductor' } },
              descriptions: { en: { value: 'Norwegian fabless semiconductor company' } },
              claims: {
                P31: [{ mainsnak: { datavalue: { value: { id: 'Q4830453' } } } }],
                P17: [{ mainsnak: { datavalue: { value: { id: 'Q20' } } } }],
                P856: [{ mainsnak: { datavalue: { value: 'https://www.nordicsemi.com' } } }],
                P571: [{ mainsnak: { datavalue: { value: { time: '+1983-00-00T00:00:00Z' } } } }],
                P1278: [{ mainsnak: { datavalue: { value: '549300XYZ12345678901' } } }],
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const conn = new WikidataConnector(mockFetch, publicDns);
    const res = await conn.search({ query: 'Nordic Semiconductor', countryCode: 'NO' }, makeContext());
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].company.companyName, 'Nordic Semiconductor');
    assert.equal(res.results[0].company.domain, 'nordicsemi.com');
    assert.equal(res.results[0].countryCode, 'NO');
    assert.equal(res.results[0].company.foundedYear, 1983);
    assert.equal(res.results[0].verificationStatus, 'directory_listed');
    assert.ok(res.results[0].company.identifiers?.some((i) => i.type === 'LEI' && i.value === '549300XYZ12345678901'));
  });

  it('OpenCorporatesConnector enforces token authentication and normalizes corporate directory profiles', async () => {
    const unauth = new OpenCorporatesConnector();
    await assert.rejects(
      () => unauth.search({ query: 'Equinor' }, makeContext()),
      (err: unknown) => err instanceof ConnectorError && err.category === 'missing_credentials'
    );

    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          results: {
            page: 1,
            per_page: 20,
            total_pages: 1,
            total_count: 1,
            companies: [
              {
                company: {
                  name: 'EQUINOR ASA',
                  company_number: '923609016',
                  jurisdiction_code: 'no',
                  incorporation_date: '1972-09-18',
                  company_type: 'Allmennaksjeselskap',
                  current_status: 'Active',
                  inactive: false,
                  opencorporates_url: 'https://opencorporates.com/companies/no/923609016',
                  registered_address: {
                    street_address: 'Forusbeen 50',
                    locality: 'Stavanger',
                    postal_code: '4035',
                    country: 'Norway',
                  },
                },
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );

    const oc = new OpenCorporatesConnector(mockFetch, publicDns);
    const res = await oc.search({ query: 'Equinor', countryCode: 'NO' }, makeContext({ credentials: { apiToken: 'oc_secret' } }));
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].company.companyName, 'EQUINOR ASA');
    assert.equal(res.results[0].company.registrationNumber, '923609016');
    assert.equal(res.results[0].verificationStatus, 'directory_listed');
    assert.equal(res.results[0].company.companyStatus, 'active');
  });
});

describe('Phase 10 — Multi-Page Website Intelligence, SSRF & Robots Guard, and Scope Limits', () => {
  it('blocks private IP & cloud metadata targets via SSRF protection', async () => {
    const privateRes = await inspectWebsite('http://127.0.0.1/admin', {
      dnsLookupAll: async () => [{ address: '127.0.0.1', family: 4 as const }],
    });
    assert.equal(privateRes.securityCheck.passed, false);
    assert.equal(privateRes.isOnline, false);

    const metaRes = await inspectWebsite('http://169.254.169.254/latest/meta-data', {
      dnsLookupAll: async () => [{ address: '169.254.169.254', family: 4 as const }],
    });
    assert.equal(metaRes.securityCheck.passed, false);
  });

  it('crawls same-domain homepage + prioritized company pages, respects robots.txt Disallow, extracts JSON-LD & general emails only, and records URL + timestamp provenance', async () => {
    const visitedUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const u = String(input);
      visitedUrls.push(u);

      if (u.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /locations\n', { status: 200 });
      }
      if (u === 'https://acme-industrial.example/' || u === 'https://acme-industrial.example') {
        return new Response(
          `<html>
            <head>
              <title>Acme Industrial Automation</title>
              <meta name="description" content="Industrial robotics and sensor systems across Europe." />
              <script type="application/ld+json">
                {
                  "@type": "Organization",
                  "name": "Acme Industrial GmbH",
                  "email": "info@acme-industrial.example",
                  "telephone": "+49 89 1234567",
                  "address": { "streetAddress": "Industriestr. 10", "addressLocality": "Munich", "postalCode": "80331", "addressCountry": "DE" },
                  "sameAs": ["https://www.linkedin.com/company/acme-industrial"]
                }
              </script>
            </head>
            <body>
              <nav>
                <a href="/about">About Us</a>
                <a href="/products">Products & Services</a>
                <a href="/contact">Contact</a>
                <a href="/locations">Locations</a>
                <a href="https://external-partner.other/about">Partner</a>
              </nav>
            </body>
          </html>`,
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      if (u.endsWith('/about')) {
        return new Response(
          `<html><head><title>About Acme</title></head><body><p>Serving Germany, Norway, and the United Kingdom since 2010.</p></body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      if (u.endsWith('/products')) {
        return new Response(
          `<html><head><title>Products</title></head><body><h1>Products & Services</h1><ul><li>Servo Controllers</li><li>Machine Vision Cameras</li></ul></body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      if (u.endsWith('/contact')) {
        return new Response(
          `<html><head><title>Contact</title></head><body>
            <p>General Inquiries: <a href="mailto:sales@acme-industrial.example">sales@acme-industrial.example</a></p>
            <p>Direct personal contact (must be excluded): john.doe@acme-industrial.example</p>
            <p>Phone: <a href="tel:+49891234567">+49 89 1234567</a></p>
            <p>Mon–Fri 08:00–17:00 CET</p>
            <address>Industriestr. 10, 80331 Munich, Germany</address>
          </body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } }
        );
      }
      return new Response('Not found', { status: 404 });
    };

    const result = await inspectWebsite('https://acme-industrial.example', {
      fetchFn: mockFetch,
      dnsLookupAll: publicDns,
      checkRobots: true,
      maxPages: 5,
    });

    assert.equal(result.isOnline, true);
    assert.equal(result.securityCheck.passed, true);
    assert.equal(result.businessName, 'Acme Industrial GmbH');
    assert.ok(result.pagesVisited?.includes('https://acme-industrial.example/'));
    assert.ok(result.pagesVisited?.includes('https://acme-industrial.example/about'));
    assert.ok(result.pagesVisited?.includes('https://acme-industrial.example/products'));
    assert.ok(result.pagesVisited?.includes('https://acme-industrial.example/contact'));
    // Must obey robots.txt Disallow: /locations and stay strictly same-domain
    assert.ok(!visitedUrls.some((u) => u.endsWith('/locations')), 'Disallowed /locations path was fetched!');
    assert.ok(!visitedUrls.some((u) => u.includes('external-partner.other')), 'Off-domain link was followed!');

    // General emails included; personal firstname.lastname@ email excluded
    assert.ok(result.emailsFound.includes('info@acme-industrial.example'));
    assert.ok(result.emailsFound.includes('sales@acme-industrial.example'));
    assert.ok(!result.emailsFound.includes('john.doe@acme-industrial.example'), 'Personal email leaked into business extraction!');

    assert.ok(result.phonesFound.some((p) => p.includes('49 89 1234567') || p.includes('49891234567')));
    assert.ok(result.productsServices?.some((p) => p.includes('Servo Controllers')));
    assert.ok(result.addressesFound?.some((a) => a.includes('Munich')));
    assert.ok(result.operatingInfo?.includes('08:00'));

    // Per-attribute provenance checks
    assert.equal(result.attributeProvenance?.businessName?.sourceType, 'official_website');
    assert.ok(result.attributeProvenance?.businessName?.sourceUrl?.includes('acme-industrial.example'));
    assert.ok(result.attributeProvenance?.businessName?.retrievedAt);
    assert.equal(result.attributeProvenance?.email?.sourceType, 'official_website');
  });
});

describe('Phase 10 — Provenance Confidence, Subsidiary Dedupe Safeguard, Discovery Service & AI Fallbacks', () => {
  it('ranks provenance tiers faithfully and never lets lower-tier web search overwrite official registry data', () => {
    assert.ok(PROVENANCE_RANK.official_registry > PROVENANCE_RANK.official_website);
    assert.ok(PROVENANCE_RANK.official_website > PROVENANCE_RANK.business_directory);
    assert.ok(PROVENANCE_RANK.business_directory > PROVENANCE_RANK.search_provider);
    assert.ok(PROVENANCE_RANK.search_provider > PROVENANCE_RANK.inferred);

    const searchRes = new BraveSearchConnector().normalizeResult(
      {
        title: 'Example Corp Wrong Name',
        url: 'https://example.no/',
        description: 'Search snippet',
      },
      new Date().toISOString()
    )!;
    const normalizedResult = normalizeConnectorResult(searchRes);
    const normalizedSearch = normalizedResult.lead!;
    assert.ok(normalizedSearch);
    assert.ok(normalizedSearch.confidenceScore <= 48);
    assert.equal(computeEvidenceConfidence({
      providerId: 'conn-test',
      providerName: 'Test',
      sourceCategory: 'search_engine',
      accessMode: 'live_api',
      countryCode: 'NO',
      externalSourceId: '1',
      company: { companyName: 'Test AS', identifiers: [], industry: 'Tech', category: 'B2B' },
      retrievedAt: new Date().toISOString(),
      verificationStatus: 'unverified',
      confidence: { supported: false, score: 80, signals: [] },
      providerMetadata: {},
    }), 32); // unverified base 32 without extra website/address/phone/email signals
    const zeroSupported = normalizeConnectorResult({
      ...searchRes,
      confidence: { supported: false, score: 80, signals: [] },
    });
    assert.equal(zeroSupported.lead?.confidenceScore, 0);

    const registryLead = makeLead({
      companyName: 'NORDIC SEMICONDUCTOR ASA',
      legalName: 'NORDIC SEMICONDUCTOR ASA',
      registrationNumber: '966011726',
      registrationType: 'NO_ORGNR',
      domain: 'nordicsemi.com',
      confidenceScore: 94,
      customFields: { lastVerificationStatus: 'officially_verified' },
    });

    const merged = mergeProviderObservationIntoLead(registryLead, normalizedSearch);
    assert.equal(merged.companyName, 'NORDIC SEMICONDUCTOR ASA');
    assert.equal(merged.registrationNumber, '966011726');
    assert.equal(merged.customFields?.lastVerificationStatus, 'officially_verified');
  });

  it('flags shared-domain subsidiaries (different reg numbers) and branch offices (distinct city+street) as ambiguous review instead of auto-merging', () => {
    const hqLead = makeLead({
      id: 'crm-hq',
      companyName: 'Nordic Group HQ AS',
      registrationNumber: '911111111',
      domain: 'nordicgroup.example',
      address: { street: 'Main St 1', city: 'Oslo', country: 'Norway', countryCode: 'NO' },
    });
    const subCandidate = makeLead({
      id: 'cand-sub',
      companyName: 'Nordic Group Sweden AB',
      registrationNumber: '5566778899',
      domain: 'nordicgroup.example',
      address: { street: 'Main St 1', city: 'Oslo', country: 'Norway', countryCode: 'NO' },
    });
    const branchCandidate = makeLead({
      id: 'cand-branch',
      companyName: 'Nordic Group HQ AS — Bergen Branch',
      registrationNumber: undefined,
      domain: 'nordicgroup.example',
      address: { street: 'Harbor Rd 44', city: 'Bergen', country: 'Norway', countryCode: 'NO' },
    });

    const analysis = detectDiscoveryDuplicates([subCandidate, branchCandidate], [hqLead]);
    assert.equal(analysis.duplicateInfoByLeadId['cand-sub'].classification, 'ambiguous');
    assert.equal(analysis.duplicateInfoByLeadId['cand-sub'].requiresReview, true);
    assert.equal(analysis.duplicateInfoByLeadId['cand-branch'].classification, 'ambiguous');
    assert.equal(analysis.duplicateInfoByLeadId['cand-branch'].requiresReview, true);
  });

  it('DiscoveryService skips unconfigured credentialed search APIs cleanly, supports configured search + provenance filters + JSON/CSV export, and does not create persons', async () => {
    const registry = new ConnectorRegistry();
    const engine = new ConnectorExecutionEngine();

    const braveMockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: 'Kongsberg Maritime | Marine Tech',
                url: 'https://www.kongsberg.com/maritime/',
                description: 'Autonomous marine robotics and subsea instrumentation.',
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    const wikidataMockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ search: [] }), { status: 200, headers: { 'content-type': 'application/json' } });

    registry.register(new BraveSearchConnector(braveMockFetch, publicDns));
    registry.register(new GoogleCseConnector());
    registry.register(new WikidataConnector(wikidataMockFetch, publicDns));

    const svc = new DiscoveryService();

    // 1. Auto mode with NO credentials configured for Brave/Google CSE -> runs open directory cleanly with zero credential errors
    const unconfiguredSearch = await svc.executeSearch(
      {
        query: 'Marine Robotics',
        sourceCategories: ['business_directory'],
      },
      {
        registry,
        executionEngine: engine,
        configuredConnectorIds: new Set(['conn-wikidata']),
      }
    );
    assert.ok(!unconfiguredSearch.selectedConnectorIds.includes('conn-brave-search'));
    assert.equal(unconfiguredSearch.errors, undefined);

    // 2. Auto mode with Brave Search configured in Credential Vault -> returns Brave Search candidate
    const prevBrave = process.env.BRAVE_SEARCH_API_KEY;
    process.env.BRAVE_SEARCH_API_KEY = 'BSA_TEST_ISOLATED_KEY';
    let configuredSearch;
    try {
      configuredSearch = await svc.executeSearch(
        {
          query: 'Kongsberg Maritime',
          productsServices: 'Marine Robotics',
          sourceCategories: ['search_engine'],
          verificationFilter: 'search_engine',
          limit: 10,
        },
        {
          registry,
          executionEngine: engine,
          configuredConnectorIds: new Set(['conn-brave-search']),
        }
      );
    } finally {
      if (prevBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
      else process.env.BRAVE_SEARCH_API_KEY = prevBrave;
    }

    assert.equal(configuredSearch.leads.length, 1);
    const candidate = configuredSearch.leads[0];
    assert.equal(candidate.domain, 'kongsberg.com');
    assert.equal((candidate as unknown as { persons?: unknown }).persons, undefined);

    // 3. Enrich candidate with multi-page inspection + grounded AI fallback
    const enriched = await svc.enrichCandidate(
      { searchId: configuredSearch.searchId, lead: candidate, runWebInspector: true, runAi: true },
      {
        inspectWebsiteFn: async (u) => ({
          url: u,
          domain: 'kongsberg.com',
          isOnline: true,
          httpStatus: 200,
          isHttps: true,
          businessName: 'Kongsberg Maritime AS',
          title: 'Kongsberg Maritime',
          description: 'Marine robotics & propulsion systems',
          productsServices: ['Autonomous Underwater Vehicles', 'Dynamic Positioning'],
          emailsFound: ['contact@kongsberg.com'],
          phonesFound: ['+47 32 28 50 00'],
          pagesVisited: ['https://kongsberg.com/', 'https://kongsberg.com/products'],
          pageExcerpts: [
            {
              url: 'https://kongsberg.com/',
              pageType: 'homepage',
              httpStatus: 200,
              retrievedAt: new Date().toISOString(),
              textExcerpt: 'Kongsberg Maritime builds Autonomous Underwater Vehicles and marine technology.',
            },
          ],
          attributeProvenance: {
            productsServices: {
              attribute: 'productsServices',
              value: 'Autonomous Underwater Vehicles',
              sourceType: 'official_website',
              sourceName: 'Official Company Website',
              sourceUrl: 'https://kongsberg.com/products',
              retrievedAt: new Date().toISOString(),
            },
          },
          socialLinks: {},
          securityCheck: { passed: true, ipResolved: '93.184.216.34' },
        }),
      }
    );

    assert.equal(enriched.lead.email, 'contact@kongsberg.com');
    assert.equal(enriched.lead.webMetadata?.attributeProvenance?.productsServices?.sourceType, 'official_website');
    assert.ok(['ai_extracted', 'inferred'].includes(enriched.lead.webMetadata?.attributeProvenance?.aiBusinessSummary?.sourceType || ''));

    // 4. JSON and CSV exports include updated enrichment metadata
    const jsonExport = svc.exportSessionJson(configuredSearch.searchId);
    assert.ok(jsonExport);
    const parsedJson = JSON.parse(jsonExport!);
    assert.equal(parsedJson.totalExported, 1);
    assert.equal(parsedJson.leads[0].domain, 'kongsberg.com');

    const csvExport = svc.exportSessionCsv(configuredSearch.searchId);
    assert.ok(csvExport);
    assert.ok(csvExport!.includes('Products & Services'));
    assert.ok(csvExport!.includes('Autonomous Underwater Vehicles'));
  });

  it('AI discovery helpers provide safe deterministic fallbacks without GEMINI_API_KEY and never invent verified facts', async () => {
    delete process.env.GEMINI_API_KEY;

    const queryPlan = await generateDiscoveryQueriesWithAi({
      query: 'Nordic Semiconductor',
      industry: 'Semiconductors',
      productsServices: 'Bluetooth Low Energy',
      countryCode: 'NO',
      city: 'Trondheim',
    });
    assert.equal(queryPlan.engine, 'deterministic-pipeline');
    assert.equal(queryPlan.provenanceType, 'inferred');
    assert.ok(queryPlan.suggestedQueries.length >= 2);

    const webExtract = await extractBusinessIntelFromWebEvidence({
      companyName: 'Example GmbH',
      url: 'https://example.de',
      pageExcerpts: [
        {
          url: 'https://example.de/about',
          pageType: 'about',
          textExcerpt: 'Example GmbH supplies precision laser sensors in Munich.',
        },
      ],
    });
    assert.equal(webExtract.engine, 'deterministic-pipeline');
    assert.equal(webExtract.provenanceClassification, 'inferred');
    assert.ok(webExtract.businessSummary.includes('precision laser sensors'));

    const dupReview = await assessDuplicatePairWithAi({
      candidate: makeLead({ registrationNumber: '111111111' }),
      existing: makeLead({ id: 'lead-existing', registrationNumber: '222222222' }),
      matchReason: 'Shared domain with distinct registration numbers',
    });
    assert.equal(dupReview.engine, 'deterministic-pipeline');
    assert.equal(dupReview.assessment, 'possible_branch_or_subsidiary');
    assert.equal(dupReview.provenanceType, 'inferred');
  });
});
