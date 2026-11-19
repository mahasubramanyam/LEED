import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EXPANDED_RELATIONSHIP_TYPES,
  ROLE_TAXONOMY_SPECS,
  classifyDecisionMakerRole,
  getRecommendedTargetTitlesForIndustry,
} from '../shared/decisionMakerRoles.js';
import {
  SOCIAL_AND_PROFESSIONAL_PROVIDERS,
  buildSocialProviderMatrix,
} from '../server/connectors/socialProvidersCatalog.js';
import { ApolloPeopleConnector } from '../server/connectors/adapters/apolloPeopleAdapter.js';
import { BraveSearchConnector } from '../server/connectors/adapters/braveSearchAdapter.js';
import { inspectWebsite } from '../server/connectors/webInspector.js';
import { discoverCompanyDecisionMakers } from '../server/discovery/decisionMakerService.js';
import { evaluatePersonIdentityMatches } from '../server/import/dedupeClassifier.js';
import {
  analyzeDecisionMakerProfileWithAi,
  generateDecisionMakerQueriesWithAi,
} from '../server/gemini.js';
import { ConnectorRegistry } from '../server/connectors/core/registry.js';
import { ConnectorExecutionEngine } from '../server/connectors/core/executionEngine.js';
import { CredentialManager } from '../server/connectors/core/credentialManager.js';
import {
  ensureConnectorsRegistered,
  connectorRegistry,
} from '../server/connectors/index.js';
import { StorageManager } from '../server/storage.js';
import type {
  CompanyPersonRelationship,
  ConnectorStatus,
  PersonRecord,
} from '../server/types.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const publicDnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

after(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }
});

describe('Phase 11 — Social Platform Intelligence & Decision-Maker Discovery', () => {
  it('1. Registers Apollo connector (23 total connectors) and accurately documents social/professional providers', () => {
    ensureConnectorsRegistered();
    const allConnectors = connectorRegistry.listAll();
    assert.ok(allConnectors.length >= 23, `Expected >= 23 connectors, found ${allConnectors.length}`);
    assert.ok(allConnectors.some((c) => c.id === 'conn-apollo'), 'ApolloPeopleConnector must be registered');

    const linkedin = SOCIAL_AND_PROFESSIONAL_PROVIDERS.find((p) => p.id === 'linkedin-official-api');
    const bing = SOCIAL_AND_PROFESSIONAL_PROVIDERS.find((p) => p.id === 'microsoft-bing-people-search');
    const apollo = SOCIAL_AND_PROFESSIONAL_PROVIDERS.find((p) => p.id === 'apollo-people-search');
    const brreg = SOCIAL_AND_PROFESSIONAL_PROVIDERS.find((p) => p.id === 'brreg-roller-officers');
    const web = SOCIAL_AND_PROFESSIONAL_PROVIDERS.find((p) => p.id === 'company-leadership-pages');

    assert.equal(linkedin?.availability, 'restricted');
    assert.equal(bing?.availability, 'unavailable');
    assert.equal(apollo?.availability, 'credential_dependent');
    assert.equal(brreg?.availability, 'operational');
    assert.equal(web?.availability, 'operational');

    const matrix = buildSocialProviderMatrix([
      {
        id: 'conn-apollo',
        name: 'Apollo',
        category: 'social_platform',
        countryCoverage: ['GLOBAL'],
        status: 'healthy',
        authType: 'api_key',
        isConfigured: true,
        operational: true,
        rateLimitNote: '',
        attribution: '',
        totalCalls: 0,
      } as ConnectorStatus,
    ]);
    const apolloRow = matrix.find((m) => m.id === 'apollo-people-search');
    assert.equal(apolloRow?.availability, 'operational');
    assert.equal(apolloRow?.configuredInVault, true);
  });

  it('2. Role taxonomy covers Ownership, Executive, Procurement, Sales/BD, and Other contacts', () => {
    assert.ok(EXPANDED_RELATIONSHIP_TYPES.length >= 30);
    assert.equal(classifyDecisionMakerRole({ rawJobTitle: 'Co-Founder & CEO' }).relationshipType, 'co_founder');
    assert.equal(classifyDecisionMakerRole({ rawJobTitle: 'Chief Financial Officer' }).relationshipType, 'cfo');
    assert.equal(classifyDecisionMakerRole({ rawJobTitle: 'Global Procurement Manager' }).category, 'procurement_purchasing');
    assert.equal(classifyDecisionMakerRole({ rawJobTitle: 'VP Business Development Manager' }).category, 'sales_business_dev');
    assert.equal(classifyDecisionMakerRole({ rawJobTitle: 'Daglig leder' }).relationshipType, 'managing_director');
    assert.equal(classifyDecisionMakerRole('chief_procurement_officer').department, 'Procurement');

    const mfgTitles = getRecommendedTargetTitlesForIndustry('Industrial Manufacturing');
    assert.ok(mfgTitles.includes('Chief Procurement Officer'));
    const saasTitles = getRecommendedTargetTitlesForIndustry('Enterprise SaaS Software');
    assert.ok(saasTitles.includes('CTO'));
    assert.ok(ROLE_TAXONOMY_SPECS.procurement_manager.label === 'Procurement Manager');
  });

  it('3. ApolloPeopleConnector fails cleanly when unconfigured, redacts secret on error, and parses live response', async () => {
    const mockFetch: typeof fetch = async (input, init) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      const apiKey = headers['X-Api-Key'] || headers['x-api-key'];
      if (apiKey === 'secret-bad-key-999') {
        return new Response(JSON.stringify({ error: 'Invalid key secret-bad-key-999' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      assert.equal(apiKey, 'apollo_live_valid_key');
      return new Response(
        JSON.stringify({
          people: [
            {
              id: 'ap-1',
              first_name: 'Henrik',
              last_name: 'Lindholm',
              name: 'Henrik Lindholm',
              title: 'Chief Procurement Officer',
              seniority: 'c_suite',
              departments: ['procurement'],
              linkedin_url: 'https://www.linkedin.com/in/henrik-lindholm-no',
              email: 'henrik.lindholm@nordicsemi.no',
              email_status: 'verified',
              city: 'Trondheim',
              country: 'Norway',
              organization: {
                name: 'Nordic Semiconductor ASA',
                primary_domain: 'nordicsemi.no',
              },
              employment_history: [
                { title: 'Chief Procurement Officer', organization_name: 'Nordic Semiconductor ASA', current: true, start_date: '2022-03-01' },
              ],
            },
          ],
          pagination: { page: 1, per_page: 10, total_entries: 1, total_pages: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const connector = new ApolloPeopleConnector(mockFetch, publicDnsLookup);

    // 3a. Missing credentials
    await assert.rejects(
      async () =>
        connector.searchPeopleForCompany(
          { companyName: 'Nordic Semiconductor ASA', domain: 'nordicsemi.no' },
          {
            requestId: 'req-1',
            signal: new AbortController().signal,
            credentials: {},
            credentialSource: 'none',
            config: { connectorId: 'conn-apollo', enabled: true },
            userAgent: 'LEED-Test/1.0',
            timeoutMs: 5000,
          }
        ),
      (err: any) => err?.category === 'missing_credentials'
    );

    // 3b. Secret redaction on 401
    await assert.rejects(
      async () =>
        connector.searchPeopleForCompany(
          { companyName: 'Nordic Semiconductor ASA', domain: 'nordicsemi.no' },
          {
            requestId: 'req-2',
            signal: new AbortController().signal,
            credentials: { apiKey: 'secret-bad-key-999' },
            credentialSource: 'database_encrypted',
            config: { connectorId: 'conn-apollo', enabled: true },
            userAgent: 'LEED-Test/1.0',
            timeoutMs: 5000,
          }
        ),
      (err: any) => !String(err?.message || '').includes('secret-bad-key-999')
    );

    // 3c. Structured result on valid key
    const res = await connector.searchPeopleForCompany(
      { companyName: 'Nordic Semiconductor ASA', domain: 'nordicsemi.no' },
      {
        requestId: 'req-3',
        signal: new AbortController().signal,
        credentials: { apiKey: 'apollo_live_valid_key' },
        credentialSource: 'database_encrypted',
        config: { connectorId: 'conn-apollo', enabled: true },
        userAgent: 'LEED-Test/1.0',
        timeoutMs: 5000,
      }
    );
    assert.equal(res.people.length, 1);
    assert.equal(res.people[0].name, 'Henrik Lindholm');
    assert.equal(res.people[0].title, 'Chief Procurement Officer');
  });

  it('4. Website Inspector extracts Schema.org Person + HTML leadership cards, excludes private emails, and enforces SSRF block', async () => {
    const pages: Record<string, string> = {
      'https://acme-nordic.example/': `
        <html>
          <head>
            <title>Acme Nordic Industrial Systems</title>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Organization",
                "name": "Acme Nordic Industrial Systems",
                "founder": {
                  "@type": "Person",
                  "name": "Klara Vestergaard",
                  "jobTitle": "Co-Founder & CEO",
                  "url": "https://acme-nordic.example/leadership#klara"
                }
              }
            </script>
          </head>
          <body>
            <a href="/leadership">Leadership Team</a>
            <a href="/contact">Contact Us</a>
            <p>Contact us at info@acme-nordic.example or personal@gmail.com</p>
          </body>
        </html>
      `,
      'https://acme-nordic.example/leadership': `
        <html>
          <head><title>Leadership — Acme Nordic</title></head>
          <body>
            <h1>Executive Leadership</h1>
            <div class="team-card">
              <h3>Martin Solheim</h3>
              <p class="role">Head of Procurement</p>
              <a href="https://www.linkedin.com/in/martin-solheim-proc">LinkedIn</a>
            </div>
            <div class="team-card">
              <h3>Ingrid Bakke</h3>
              <p class="title">Sales Director</p>
            </div>
          </body>
        </html>
      `,
      'https://acme-nordic.example/contact': `
        <html><head><title>Contact</title></head><body><p>sales@acme-nordic.example</p></body></html>
      `,
    };

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const html = pages[url];
      if (!html) return new Response('Not Found', { status: 404 });
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
    };

    const inspected = await inspectWebsite('https://acme-nordic.example', {
      fetchFn: mockFetch,
      dnsLookupAll: publicDnsLookup,
      maxPages: 4,
    });

    assert.equal(inspected.leadershipFound?.some((m) => m.fullName === 'Klara Vestergaard'), true);
    assert.equal(inspected.leadershipFound?.some((m) => m.fullName === 'Martin Solheim'), true);
    assert.ok(!inspected.emailsFound.includes('personal@gmail.com'), 'Must not harvest private gmail addresses');

    // SSRF check: private/loopback IP must be blocked cleanly
    const ssrfRes = await inspectWebsite('http://127.0.0.1/admin', {
      fetchFn: mockFetch,
    });
    assert.equal(ssrfRes.isOnline, false);
    assert.equal(ssrfRes.securityCheck.passed, false);
    assert.match(ssrfRes.securityCheck.reason || '', /SSRF|blocked|private|loopback|local|127\.0\.0\.1/i);
  });

  it('5. Company-to-person discovery orchestrates Brreg, UK CH, Wikidata, OpenCorporates, Brave, and flags historical roles + uncertain CRM matches without auto-merging', async () => {
    const prevEncKey = process.env.CONNECTOR_ENCRYPTION_KEY;
    process.env.CONNECTOR_ENCRYPTION_KEY = 'test-master-secret-32-chars-minimum!!';
    const reg = new ConnectorRegistry();
    ensureConnectorsRegistered(reg);
    const vault = new CredentialManager();
    // Configure UK Companies House & Brave Search tokens only; leave Apollo & OpenCorporates unconfigured
    await vault.setCredential(
      'conn-companies-house',
      { apiKey: 'ch-test-key' },
      reg.getById('conn-companies-house')!.getMetadata().credentialRequirements
    );
    await vault.setCredential(
      'conn-brave-search',
      { apiKey: 'brave-test-key' },
      reg.getById('conn-brave-search')!.getMetadata().credentialRequirements
    );
    const engine = new ConnectorExecutionEngine(vault);

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Norway Brreg Roller
      if (url.includes('data.brreg.no/enhetsregisteret/api/enheter/923609016/roller')) {
        return new Response(
          JSON.stringify({
            rollegrupper: [
              {
                type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
                roller: [
                  {
                    type: { kode: 'DAGL', beskrivelse: 'Daglig leder' },
                    person: { navn: { fornavn: 'Vegard', etternavn: 'Wollan' } },
                    fratraadt: false,
                  },
                ],
              },
              {
                type: { kode: 'STYR', beskrivelse: 'Styre' },
                roller: [
                  {
                    type: { kode: 'LEDE', beskrivelse: 'Styrets leder' },
                    person: { navn: { fornavn: 'Svenn-Tore', etternavn: 'Larsen' } },
                    fratraadt: true,
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // UK Companies House Officers
      if (url.includes('api.company-information.service.gov.uk/company/07386161/officers')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                name: 'HASSABIS, Demis',
                officer_role: 'director',
                appointed_on: '2010-09-23',
                occupation: 'Chief Executive Officer',
                address: { locality: 'London', country: 'United Kingdom' },
              },
              {
                name: 'SULEYMAN, Mustafa',
                officer_role: 'director',
                appointed_on: '2010-09-23',
                resigned_on: '2022-01-15',
                occupation: 'Co-Founder',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // Wikidata entity search & claims
      if (url.includes('wikidata.org/w/api.php') && url.includes('wbsearchentities')) {
        return new Response(
          JSON.stringify({ search: [{ id: 'Q999999', label: 'Nordic Semiconductor ASA' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('wikidata.org/w/api.php') && url.includes('wbgetentities') && url.includes('ids=Q999999')) {
        return new Response(
          JSON.stringify({
            entities: {
              Q999999: {
                claims: {
                  P169: [
                    {
                      mainsnak: { datavalue: { value: { id: 'Q1001' } } },
                    },
                  ],
                  P112: [
                    {
                      mainsnak: { datavalue: { value: { id: 'Q1002' } } },
                      qualifiers: {
                        P582: [{ datavalue: { value: { time: '+2020-06-01T00:00:00Z' } } }],
                      },
                    },
                  ],
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('wikidata.org/w/api.php') && url.includes('wbgetentities') && url.includes('Q1001')) {
        return new Response(
          JSON.stringify({
            entities: {
              Q1001: { labels: { en: { value: 'Vegard Wollan' } } },
              Q1002: { labels: { en: { value: 'Former Founder Example' } } },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // Brave Search public announcements
      if (url.includes('api.search.brave.com/res/v1/web/search')) {
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: 'Nordic Semiconductor appoints Elena Markovic as Procurement Manager',
                  url: 'https://news.example.com/nordic-appoints-elena-markovic',
                  description: 'Elena Markovic — Procurement Manager at Nordic Semiconductor ASA.',
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response('Not Found', { status: 404 });
    };

    reg.register(new BraveSearchConnector(mockFetch, publicDnsLookup));

    // Existing CRM person with same name "Vegard Wollan" at a DIFFERENT company (no email/LinkedIn corroboration)
    const existingPersons: PersonRecord[] = [
      {
        id: 'person-other-vegard',
        fullName: 'Vegard Wollan',
        normalizedName: 'vegard wollan',
        emailStatus: 'unavailable',
        sources: [],
        confidenceScore: 70,
        verificationStatus: 'user_provided',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const existingRelationships: CompanyPersonRelationship[] = [
      {
        id: 'rel-other-company',
        leadId: 'other-lead-999',
        personId: 'person-other-vegard',
        relationshipType: 'director',
        jobTitle: 'Director',
        isPrimaryContact: false,
        sourceName: 'Manual Entry',
        confidenceScore: 70,
        verificationStatus: 'user_provided',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    try {

    // 5a. Norway company discovery (Brreg + Wikidata + Brave + unconfigured Apollo/OpenCorporates)
    const noRes = await discoverCompanyDecisionMakers(
      {
        leadId: 'brreg-923609016',
        companyName: 'Nordic Semiconductor ASA',
        countryCode: 'NO',
        registrationNumber: '923609016',
        industry: 'Semiconductors',
        includeHistorical: true,
      },
      {
        registry: reg,
        executionEngine: engine,
        credentialManager: vault,
        existingPersons,
        existingRelationships,
        existingLeads: [
          {
            id: 'other-lead-999',
            companyName: 'Different Holding AS',
            address: { country: 'Norway', countryCode: 'NO', formattedAddress: 'Oslo' },
            industry: 'Finance',
            category: 'Holding',
            currency: 'NOK',
            confidenceScore: 80,
            confidenceSignals: [],
            sources: [],
            identifiers: [],
            status: 'new',
            tags: [],
            notes: [],
            activities: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        fetchFn: mockFetch,
        dnsLookupAll: publicDnsLookup,
        useAiAnalysis: true,
      }
    );

    const vegard = noRes.candidates.find((c) => c.fullName === 'Vegard Wollan');
    assert.ok(vegard, 'Vegard Wollan should be discovered from Brreg Roller');
    assert.equal(vegard.employmentStatus, 'current');
    assert.equal(vegard.verificationTier, 'officially_verified');
    assert.equal(vegard.matchedCrmPersonId, undefined, 'Must NOT auto-merge same name across different companies');
    assert.equal(vegard.uncertainMatch, true, 'Must flag uncertain identity match for owner review');
    assert.ok((vegard.uncertainMatchReasons?.length || 0) > 0);

    const resignedBoard = noRes.candidates.find((c) => c.fullName === 'Svenn-Tore Larsen');
    assert.ok(resignedBoard, 'Resigned Brreg officer should be returned when includeHistorical=true');
    assert.equal(resignedBoard.employmentStatus, 'historical');
    assert.ok(resignedBoard.outdatedSignalNote, 'Historical officer should have outdated signal warning');

    const apolloSummary = noRes.sourceSummaries.find((s) => s.sourceId === 'conn-apollo');
    assert.equal(apolloSummary?.status, 'skipped_missing_credentials');

    const braveCandidate = noRes.candidates.find((c) => c.fullName === 'Elena Markovic');
    if (braveCandidate) {
      assert.equal(braveCandidate.verificationTier, 'search_result');
      assert.ok(braveCandidate.confidenceScore <= 48, 'Unverified search snippet must remain low confidence');
    }

    // 5b. UK Companies House Officers + includeHistorical=false filter
    const ukRes = await discoverCompanyDecisionMakers(
      {
        companyName: 'DeepMind Technologies Limited',
        countryCode: 'GB',
        registrationNumber: '07386161',
        includeHistorical: false,
      },
      {
        registry: reg,
        executionEngine: engine,
        credentialManager: vault,
        fetchFn: mockFetch,
        dnsLookupAll: publicDnsLookup,
        useAiAnalysis: false,
      }
    );
    const demis = ukRes.candidates.find((c) => c.fullName === 'Demis Hassabis');
    assert.ok(demis, 'Companies House SURNAME, Forename must normalize to Demis Hassabis');
    assert.equal(demis.employmentStatus, 'current');
    assert.equal(
      ukRes.candidates.some((c) => c.fullName === 'Mustafa Suleyman'),
      false,
      'Resigned UK officer must be excluded when includeHistorical=false'
    );
    } finally {
      if (prevEncKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
      else process.env.CONNECTOR_ENCRYPTION_KEY = prevEncKey;
    }
  });

  it('6. Identity matcher corroborates email/LinkedIn but refuses name-only merge across different companies', () => {
    const existingPersons: PersonRecord[] = [
      {
        id: 'p-1',
        fullName: 'Alex Morgan',
        normalizedName: 'alex morgan',
        email: 'alex.morgan@company-a.com',
        emailStatus: 'verified',
        linkedinUrl: 'https://www.linkedin.com/in/alex-morgan-exec',
        linkedinSlug: 'alex-morgan-exec',
        sources: [],
        confidenceScore: 90,
        verificationStatus: 'officially_verified',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    const rels: CompanyPersonRelationship[] = [
      {
        id: 'r-1',
        leadId: 'lead-a',
        personId: 'p-1',
        relationshipType: 'ceo',
        isPrimaryContact: true,
        sourceName: 'Official',
        confidenceScore: 90,
        verificationStatus: 'officially_verified',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    // Name only at different company => uncertain, NOT matched
    const uncertainRes = evaluatePersonIdentityMatches(
      { fullName: 'Alex Morgan', normalizedName: 'alex morgan', relationshipType: 'director' },
      'lead-b',
      existingPersons,
      rels
    );
    assert.equal(uncertainRes.matchedPerson, undefined);
    assert.equal(uncertainRes.uncertainMatches.length, 1);

    // Email corroborated => exact match even at second company (M:N)
    const exactRes = evaluatePersonIdentityMatches(
      {
        fullName: 'Alex Morgan',
        normalizedName: 'alex morgan',
        email: 'alex.morgan@company-a.com',
        relationshipType: 'board_member',
      },
      'lead-b',
      existingPersons,
      rels
    );
    assert.equal(exactRes.matchedPerson?.id, 'p-1');
    assert.equal(exactRes.matchedBy, 'email');
  });

  it('7. AI decision-maker helpers return structured deterministic fallbacks without GEMINI_API_KEY', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const plan = await generateDecisionMakerQueriesWithAi({
        companyName: 'Acme Robotics AB',
        domain: 'acmerobotics.se',
        countryCode: 'SE',
        industry: 'Robotics Manufacturing',
        targetDepartment: 'Procurement',
      });
      assert.equal(plan.provenanceType, 'inferred');
      assert.ok(plan.suggestedQueries.length >= 3);
      assert.ok(plan.targetTitles.length >= 3);

      const profile = await analyzeDecisionMakerProfileWithAi({
        companyName: 'Acme Robotics AB',
        fullName: 'Lina Holm',
        jobTitle: 'VP Procurement',
        employmentStatus: 'historical',
        endedAt: '2023-09-01',
        sourceName: 'Official Registry',
      });
      assert.equal(profile.provenanceType, 'inferred');
      assert.ok(profile.relevanceExplanation.length > 10);
      assert.ok(profile.outdatedSignalNote?.includes('2023-09-01'));
    } finally {
      if (savedKey) process.env.GEMINI_API_KEY = savedKey;
    }
  });

  it('8. Isolated StorageManager persists approved decision-makers, multiple roles per company, M:N multi-company links, edits, and historical status', () => {
    const tmpDir = createTempDir('leed-phase11-store-');
    const store = new StorageManager(path.join(tmpDir, 'test_store.json'));

    const leads = store.getLeads();
    assert.ok(leads.length >= 2, 'Expected seed leads in isolated test store');
    const leadA = leads[0];
    const leadB = leads[1];

    // 8a. Link person as Founder
    const afterFounder = store.linkPersonToLead({
      leadId: leadA.id,
      actorEmail: 'owner@test.local',
      person: {
        fullName: 'Astrid Solberg',
        normalizedName: 'astrid solberg',
        email: 'astrid.solberg@nordicsemi.no',
        emailStatus: 'verified',
        relationshipType: 'founder',
        jobTitle: 'Founder',
        department: 'Executive Leadership',
        decisionMakerCategory: 'ownership_leadership',
        isPrimaryContact: true,
        bioSummary: 'Co-founded Nordic systems initiative.',
        verificationStatus: 'officially_verified',
        confidenceScore: 95,
        sources: [{ sourceName: 'Norway Brreg Roller', retrievedAt: new Date().toISOString() }],
        relationshipProvenance: {
          sourceName: 'Norway Brreg Roller',
          sourceType: 'official_registry',
          employmentStatus: 'current',
          reviewedByOwner: true,
        },
        customFields: {},
      },
    });

    assert.equal(afterFounder.length, 1);
    const personId = afterFounder[0].person.id;
    const founderRelId = afterFounder[0].relationship.id;
    assert.equal(afterFounder[0].person.verificationStatus, 'officially_verified');
    assert.equal(afterFounder[0].relationship.isPrimaryContact, true);

    // 8b. Add second role (CEO) for SAME person at SAME company
    const afterSecondRole = store.linkExistingPersonToLead({
      personId,
      leadId: leadA.id,
      relationshipType: 'ceo',
      jobTitle: 'Chief Executive Officer',
      department: 'Executive Management',
      decisionMakerCategory: 'ownership_leadership',
      isPrimaryContact: false,
      sourceName: 'Official Company Leadership Page',
      actorEmail: 'owner@test.local',
    });
    assert.equal(afterSecondRole.length, 2, 'Person must support multiple roles at same company');

    // 8c. Link SAME person to SECOND company (M:N)
    store.linkExistingPersonToLead({
      personId,
      leadId: leadB.id,
      relationshipType: 'board_member',
      jobTitle: 'Non-Executive Director',
      department: 'Board & Governance',
      decisionMakerCategory: 'ownership_leadership',
      isPrimaryContact: false,
      sourceName: 'UK Companies House Officers',
      actorEmail: 'owner@test.local',
    });
    const leadAPersons = store.getLeadPersons(leadA.id);
    assert.ok(
      leadAPersons[0].otherCompanies?.some((oc) => oc.leadId === leadB.id),
      'M:N link to second company must appear in otherCompanies'
    );

    // 8d. Edit person profile & mark relationship historical
    const updatedPerson = store.updatePersonRecord(personId, {
      city: 'Trondheim',
      bioSummary: 'Updated executive profile summary.',
    });
    assert.equal(updatedPerson?.city, 'Trondheim');

    const updatedRel = store.updateRelationshipRecord(leadA.id, founderRelId, {
      employmentStatus: 'historical',
      endedAt: '2025-12-31',
    });
    assert.equal(updatedRel?.provenance?.employmentStatus, 'historical');
    assert.equal(updatedRel?.provenance?.endedAt, '2025-12-31');

    // 8e. Switch primary contact to CEO relationship
    const ceoRel = afterSecondRole.find((r) => r.relationship.relationshipType === 'ceo');
    assert.ok(ceoRel);
    const afterPrimary = store.setPrimaryContact(leadA.id, ceoRel.relationship.id);
    assert.equal(
      afterPrimary.find((r) => r.relationship.id === ceoRel.relationship.id)?.relationship.isPrimaryContact,
      true
    );
    assert.equal(
      afterPrimary.find((r) => r.relationship.id === founderRelId)?.relationship.isPrimaryContact,
      false
    );

    // 8f. Unlink cleanly
    assert.equal(store.unlinkPersonFromLead(leadA.id, founderRelId), true);
    assert.equal(store.getLeadPersons(leadA.id).length, 1);
  });
});
