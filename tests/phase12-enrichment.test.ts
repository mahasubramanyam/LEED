/**
 * Phase 12 Isolated Test Suite — Lead Enrichment, Contact Verification & Data Quality Intelligence.
 *
 * Strictly isolated: uses mocked fetchFn, mocked dnsLookupAll, mocked emailDnsHooks,
 * and temporary StorageManager / CredentialManager directories.
 * Never writes to Neon PostgreSQL, data/pipeline_store.json, or data/owner_auth.json.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  connectorRegistry,
  ensureConnectorsRegistered,
  buildUnifiedConnectorStatus,
} from '../server/connectors/index.js';
import { ConnectorRegistry } from '../server/connectors/core/registry.js';
import { CredentialManager } from '../server/connectors/core/credentialManager.js';
import { buildEnrichmentProviderCatalog } from '../server/connectors/enrichmentCatalog.js';
import { HunterEmailConnector } from '../server/connectors/adapters/hunterEmailAdapter.js';
import { ZeroBounceEmailConnector } from '../server/connectors/adapters/zeroBounceEmailAdapter.js';
import { NumverifyPhoneConnector } from '../server/connectors/adapters/numverifyPhoneAdapter.js';
import { inspectWebsite } from '../server/connectors/webInspector.js';
import { verifyBusinessEmail, type EmailDnsHooks } from '../server/enrichment/emailVerifier.js';
import { verifyBusinessPhone } from '../server/enrichment/phoneVerifier.js';
import {
  evaluateCompanyDataQuality,
  evaluatePersonDataQuality,
} from '../server/enrichment/dataQualityEngine.js';
import { resolveEnrichmentProposalsAndConflicts } from '../server/enrichment/conflictResolver.js';
import {
  MAX_BULK_ENRICHMENT_BATCH,
  applyApprovedCompanyEnrichmentToClone,
  applyApprovedPersonEnrichmentToClone,
  previewBulkCompanyEnrichment,
  previewCompanyEnrichment,
  previewPersonEnrichment,
} from '../server/enrichment/enrichmentOrchestrator.js';
import { analyzeEnrichmentEvidenceWithAi } from '../server/gemini.js';
import {
  ATTRIBUTE_FRESHNESS_RULES,
  evaluateFreshnessState,
  getAttributeSourcePrecedenceScore,
} from '../shared/enrichmentSpecs.js';
import type {
  CanonicalLead,
  CompanyPersonRelationship,
  PersonRecord,
} from '../server/types.js';
import type { DnsLookupAllFn } from '../server/security/ssrf.js';

const PUBLIC_DNS_MOCK: DnsLookupAllFn = async () => [{ address: '93.184.216.34', family: 4 }];
const PRIVATE_DNS_MOCK: DnsLookupAllFn = async () => [{ address: '127.0.0.1', family: 4 }];

function createTempCredManager(): { mgr: CredentialManager; cleanup: () => void } {
  const prevSecret = process.env.CONNECTOR_ENCRYPTION_KEY;
  process.env.CONNECTOR_ENCRYPTION_KEY = 'phase12-isolated-test-encryption-secret-32chars!';
  const mgr = new CredentialManager();
  return {
    mgr,
    cleanup: () => {
      if (prevSecret === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
      else process.env.CONNECTOR_ENCRYPTION_KEY = prevSecret;
    },
  };
}

function makeSampleLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = new Date('2026-11-18T12:00:00.000Z').toISOString();
  return {
    id: 'lead-p12-1',
    companyName: 'Nordic Maritime Logistics AS',
    legalName: 'Nordic Maritime Logistics AS',
    registrationNumber: '987654321',
    registrationType: 'ORGNR',
    companyStatus: 'active',
    website: 'https://nordicmaritime.example.com',
    domain: 'nordicmaritime.example.com',
    email: 'contact@nordicmaritime.example.com',
    emailStatus: 'unverified',
    phone: '+47 22 44 55 66',
    phoneNormalized: '+4722445566',
    address: {
      street: 'Havnegata 12',
      city: 'Oslo',
      postalCode: '0150',
      country: 'Norway',
      countryCode: 'NO',
      formattedAddress: 'Havnegata 12, 0150 Oslo, Norway',
    },
    industry: 'Maritime Logistics',
    category: 'Freight & Shipping',
    confidenceScore: 72,
    confidenceSignals: ['Official registry ID present'],
    sources: [
      {
        sourceName: 'Brønnøysundregistrene',
        providerId: 'conn-brreg',
        retrievedAt: now,
      },
    ],
    identifiers: [
      {
        type: 'ORGNR',
        value: '987654321',
        countryCode: 'NO',
        source: 'Brønnøysundregistrene',
        status: 'officially_verified',
        verified: true,
      },
    ],
    status: 'qualified',
    currency: 'NOK',
    tags: [],
    notes: [],
    activities: [],
    customFields: {
      registryVerificationState: 'officially_verified',
      lastVerifiedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSamplePerson(overrides: Partial<PersonRecord> = {}): PersonRecord {
  const now = new Date('2026-11-18T12:00:00.000Z').toISOString();
  return {
    id: 'person-p12-1',
    fullName: 'Astrid Solberg',
    normalizedName: 'astrid solberg',
    email: 'astrid.solberg@nordicmaritime.example.com',
    emailStatus: 'unverified',
    phone: '+47 91 22 33 44',
    phoneNormalized: '+4791223344',
    countryCode: 'NO',
    city: 'Oslo',
    verificationStatus: 'web_observed',
    confidenceScore: 68,
    sources: [{ sourceName: 'Official Company Leadership Page', retrievedAt: now }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSampleRelationship(overrides: Partial<CompanyPersonRelationship> = {}): CompanyPersonRelationship {
  const now = new Date('2026-11-18T12:00:00.000Z').toISOString();
  return {
    id: 'rel-p12-1',
    leadId: 'lead-p12-1',
    personId: 'person-p12-1',
    relationshipType: 'ceo',
    jobTitle: 'Chief Executive Officer',
    department: 'Executive',
    decisionMakerCategory: 'executive_leadership',
    isPrimaryContact: true,
    sourceName: 'Official Company Leadership Page',
    confidenceScore: 82,
    verificationStatus: 'web_observed',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeHtmlResponse(html: string, url: string, status = 200): Response {
  const res = new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

// ============================================================================
// 1. Connector Registration & Transparent Provider Catalog
// ============================================================================
test('Phase 12: registers 26 connectors and exposes honest Enrichment Provider Catalog including retired/restricted/unavailable items', async () => {
  ensureConnectorsRegistered();
  const all = connectorRegistry.listAll();
  assert.ok(all.length >= 26, `Expected at least 26 connectors, got ${all.length}`);

  for (const id of ['conn-hunter-email', 'conn-zerobounce-email', 'conn-numverify-phone']) {
    assert.ok(connectorRegistry.getById(id), `Missing Phase 12 connector: ${id}`);
  }

  const statuses = await Promise.all(all.map((c) => buildUnifiedConnectorStatus(c)));
  const catalog = buildEnrichmentProviderCatalog(statuses);

  const ids = new Set(catalog.map((p) => p.providerId));
  assert.ok(ids.has('conn-hunter-email'));
  assert.ok(ids.has('conn-zerobounce-email'));
  assert.ok(ids.has('conn-numverify-phone'));
  assert.ok(ids.has('builtin-dns-mx-email'));
  assert.ok(ids.has('builtin-e164-phone'));

  const clearbit = catalog.find((p) => p.providerId === 'provider-clearbit-retired');
  assert.equal(clearbit?.operationalStatus, 'retired');

  const linkedin = catalog.find((p) => p.providerId === 'provider-linkedin-restricted');
  assert.equal(linkedin?.operationalStatus, 'restricted');

  const smtpProbe = catalog.find((p) => p.providerId === 'provider-direct-smtp-probing');
  assert.equal(smtpProbe?.operationalStatus, 'unavailable');
});

// ============================================================================
// 2-6. Verification Connectors: Missing Creds, Error, 429 Rate Limit, Timeout & Secret Redaction
// ============================================================================
test('Phase 12: Hunter, ZeroBounce, and Numverify connectors handle missing creds, 429, timeout, 500, and redact secrets', async () => {
  const secretKey = 'SUPER_SECRET_API_KEY_999888777';

  // Missing credentials -> throws missing_credentials without leaking secret
  const hunter = new HunterEmailConnector(async () => makeJsonResponse({}), PUBLIC_DNS_MOCK);
  await assert.rejects(
    () =>
      hunter.verifyEmailAddress('ceo@acme.example', {
        requestId: 'r1',
        signal: new AbortController().signal,
        credentials: {},
        credentialSource: 'none',
        config: { connectorId: 'conn-hunter-email', enabled: true },
        userAgent: 'Test/12',
        timeoutMs: 2000,
      }),
    (err: any) => err?.category === 'missing_credentials'
  );

  // Rate limit 429 -> rate_limited + secret redaction
  const hunter429 = new HunterEmailConnector(
    async () =>
      new Response(JSON.stringify({ errors: [{ details: `Quota exceeded for ${secretKey}` }] }), {
        status: 429,
      }),
    PUBLIC_DNS_MOCK
  );
  await assert.rejects(
    () =>
      hunter429.verifyEmailAddress('ceo@acme.example', {
        requestId: 'r2',
        signal: new AbortController().signal,
        credentials: { apiKey: secretKey },
        credentialSource: 'database_encrypted',
        config: { connectorId: 'conn-hunter-email', enabled: true },
        userAgent: 'Test/12',
        timeoutMs: 2000,
      }),
    (err: any) => err?.category === 'rate_limited' && !String(err.message).includes(secretKey)
  );

  // ZeroBounce 500 error -> secret redacted
  const zb500 = new ZeroBounceEmailConnector(
    async () => new Response(`Server error with key ${secretKey}`, { status: 500 }),
    PUBLIC_DNS_MOCK
  );
  await assert.rejects(
    () =>
      zb500.verifyEmailAddress('ceo@acme.example', {
        requestId: 'r3',
        signal: new AbortController().signal,
        credentials: { apiKey: secretKey },
        credentialSource: 'database_encrypted',
        config: { connectorId: 'conn-zerobounce-email', enabled: true },
        userAgent: 'Test/12',
        timeoutMs: 2000,
      }),
    (err: any) => !String(err.message).includes(secretKey)
  );

  // Numverify timeout -> aborts cleanly
  const nvTimeout = new NumverifyPhoneConnector(
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted due to timeout')));
      }),
    PUBLIC_DNS_MOCK
  );
  await assert.rejects(
    () =>
      nvTimeout.verifyPhoneNumber('+4722445566', {
        requestId: 'r4',
        signal: new AbortController().signal,
        credentials: { apiKey: secretKey },
        credentialSource: 'database_encrypted',
        config: { connectorId: 'conn-numverify-phone', enabled: true },
        userAgent: 'Test/12',
        timeoutMs: 40,
      }),
    (err: any) => err?.category === 'timeout' || /timeout|aborted/i.test(String(err?.message))
  );
});

// ============================================================================
// 7-12. Email Verification Honesty, Personal Webmail, Disposable, Role-Based, DNS & Live APIs
// ============================================================================
test('Phase 12: Email verification validates syntax, rejects personal webmail, detects disposable/role, checks DNS MX/SPF/DMARC without falsely claiming deliverability', async () => {
  const { mgr, cleanup } = createTempCredManager();
  try {
    const emptyRegistry = new ConnectorRegistry();
    const goodDns: EmailDnsHooks = {
      resolveMx: async () => [{ exchange: 'mail.nordicmaritime.example.com', priority: 10 }],
      resolveTxt: async (host) =>
        host.startsWith('_dmarc.')
          ? [['v=DMARC1; p=quarantine']]
          : [['v=spf1 include:_spf.example.com ~all']],
    };

    // Valid corporate email with MX + SPF + DMARC (NO authorized API -> MUST NOT claim deliverability!)
    const corp = await verifyBusinessEmail('astrid.solberg@nordicmaritime.example.com', {
      registry: emptyRegistry,
      credentialManager: mgr,
      dnsHooks: goodDns,
      companyDomain: 'nordicmaritime.example.com',
    });
    assert.equal(corp.syntaxValid, true);
    assert.equal(corp.mxRecordsPresent, true);
    assert.equal(corp.spfPresent, true);
    assert.equal(corp.dmarcPresent, true);
    assert.equal(corp.status, 'mail_config_verified');
    assert.equal(corp.deliverabilityClaimed, false);
    assert.equal(corp.crmEmailStatus, 'syntax_valid');

    // Invalid syntax
    const invalid = await verifyBusinessEmail('not-an-email', {
      registry: emptyRegistry,
      credentialManager: mgr,
      dnsHooks: goodDns,
    });
    assert.equal(invalid.syntaxValid, false);
    assert.equal(invalid.status, 'invalid_syntax');

    // Personal webmail rejected as verified business email
    const personal = await verifyBusinessEmail('founder.name@gmail.com', {
      registry: emptyRegistry,
      credentialManager: mgr,
      dnsHooks: goodDns,
    });
    assert.equal(personal.isFreePersonalWebmail, true);
    assert.equal(personal.status, 'personal_webmail_rejected');
    assert.equal(personal.deliverabilityClaimed, false);

    // Disposable domain detected
    const disp = await verifyBusinessEmail('test@mailinator.com', {
      registry: emptyRegistry,
      credentialManager: mgr,
      dnsHooks: goodDns,
    });
    assert.equal(disp.isDisposable, true);
    assert.equal(disp.status, 'disposable');

    // Role-based inbox detected
    const role = await verifyBusinessEmail('info@nordicmaritime.example.com', {
      registry: emptyRegistry,
      credentialManager: mgr,
      dnsHooks: goodDns,
    });
    assert.equal(role.isRoleBased, true);
    assert.equal(role.status, 'role_based');
    assert.equal(role.deliverabilityClaimed, false);

    // Authorized Hunter.io deliverable & catch-all
    const regWithHunter = new ConnectorRegistry();
    const hunterInst = new HunterEmailConnector();
    regWithHunter.register(hunterInst);
    await mgr.setCredential('conn-hunter-email', { apiKey: 'hunter-test-key' }, hunterInst.getMetadata().credentialRequirements);

    const hunterDeliverable = await verifyBusinessEmail('astrid@nordicmaritime.example.com', {
      registry: regWithHunter,
      credentialManager: mgr,
      dnsHooks: goodDns,
      dnsLookupAll: PUBLIC_DNS_MOCK,
      fetchFn: async () =>
        makeJsonResponse({
          data: {
            email: 'astrid@nordicmaritime.example.com',
            status: 'valid',
            result: 'deliverable',
            score: 96,
            mx_records: true,
            accept_all: false,
            disposable: false,
            webmail: false,
          },
        }),
    });
    assert.equal(hunterDeliverable.status, 'provider_deliverable');
    assert.equal(hunterDeliverable.deliverabilityClaimed, true);
    assert.equal(hunterDeliverable.crmEmailStatus, 'verified');

    const hunterCatchAll = await verifyBusinessEmail('catchall@nordicmaritime.example.com', {
      registry: regWithHunter,
      credentialManager: mgr,
      dnsHooks: goodDns,
      dnsLookupAll: PUBLIC_DNS_MOCK,
      fetchFn: async () =>
        makeJsonResponse({
          data: {
            email: 'catchall@nordicmaritime.example.com',
            status: 'accept_all',
            result: 'risky',
            score: 55,
            mx_records: true,
            accept_all: true,
          },
        }),
    });
    assert.equal(hunterCatchAll.status, 'catch_all');
    assert.equal(hunterCatchAll.isCatchAll, true);
    assert.equal(hunterCatchAll.deliverabilityClaimed, false);

    // Authorized ZeroBounce undeliverable
    const regWithZb = new ConnectorRegistry();
    const zbInst = new ZeroBounceEmailConnector();
    regWithZb.register(zbInst);
    await mgr.setCredential('conn-zerobounce-email', { apiKey: 'zb-test-key' }, zbInst.getMetadata().credentialRequirements);

    const zbInvalid = await verifyBusinessEmail('bounce@nordicmaritime.example.com', {
      registry: regWithZb,
      credentialManager: mgr,
      dnsHooks: goodDns,
      dnsLookupAll: PUBLIC_DNS_MOCK,
      fetchFn: async () =>
        makeJsonResponse({
          address: 'bounce@nordicmaritime.example.com',
          status: 'invalid',
          sub_status: 'mailbox_not_found',
          mx_found: 'true',
        }),
    });
    assert.equal(zbInvalid.status, 'undeliverable');
    assert.equal(zbInvalid.deliverabilityClaimed, false);
    assert.equal(zbInvalid.crmEmailStatus, 'unverified');
  } finally {
    cleanup();
  }
});

// ============================================================================
// 13-15. Phone Verification: E.164, Heuristic vs Numverify Carrier, Conflict, Person Privacy
// ============================================================================
test('Phase 12: Phone verification enforces E.164 normalization, distinguishes heuristic vs carrier verification, detects conflicts, and avoids unverified person attribution', async () => {
  const { mgr, cleanup } = createTempCredManager();
  try {
    const emptyRegistry = new ConnectorRegistry();

    // Valid international toll-free (heuristic)
    const tollFree = await verifyBusinessPhone('1-800-555-0199', {
      countryCode: 'US',
      registry: emptyRegistry,
      credentialManager: mgr,
    });
    assert.equal(tollFree.syntaxValid, true);
    assert.equal(tollFree.e164, '+18005550199');
    assert.equal(tollFree.lineType, 'toll_free');
    assert.equal(tollFree.lineTypeBasis, 'heuristic');
    assert.equal(tollFree.status, 'e164_valid');

    // Invalid phone
    const bad = await verifyBusinessPhone('123', {
      countryCode: 'US',
      registry: emptyRegistry,
      credentialManager: mgr,
    });
    assert.equal(bad.syntaxValid, false);
    assert.equal(bad.status, 'invalid_format');

    // Conflict with existing CRM phone
    const conflict = await verifyBusinessPhone('+47 22 99 88 77', {
      countryCode: 'NO',
      registry: emptyRegistry,
      credentialManager: mgr,
      existingPhoneNormalized: '+4722445566',
    });
    assert.equal(conflict.status, 'conflicting');

    // Person phone without verified association -> refuses claiming personal ownership
    const personPhone = await verifyBusinessPhone('+47 91 22 33 44', {
      countryCode: 'NO',
      registry: emptyRegistry,
      credentialManager: mgr,
      isPersonContact: true,
      personAssociationSourceVerified: false,
    });
    assert.equal(personPhone.personAssociationVerified, false);

    // Numverify carrier-verified lookup
    const regNv = new ConnectorRegistry();
    const nvInst = new NumverifyPhoneConnector();
    regNv.register(nvInst);
    await mgr.setCredential('conn-numverify-phone', { apiKey: 'nv-test-key' }, nvInst.getMetadata().credentialRequirements);

    const carrierVerified = await verifyBusinessPhone('+47 22 44 55 66', {
      countryCode: 'NO',
      registry: regNv,
      credentialManager: mgr,
      dnsLookupAll: PUBLIC_DNS_MOCK,
      fetchFn: async () =>
        makeJsonResponse({
          valid: true,
          number: '4722445566',
          international_format: '+4722445566',
          local_format: '22445566',
          country_prefix: '+47',
          country_code: 'NO',
          location: 'Oslo',
          carrier: 'Telenor Norge AS',
          line_type: 'landline',
        }),
    });
    assert.equal(carrierVerified.status, 'provider_verified');
    assert.equal(carrierVerified.lineTypeBasis, 'provider_verified');
    assert.equal(carrierVerified.lineType, 'landline');
    assert.equal(carrierVerified.carrier, 'Telenor Norge AS');
  } finally {
    cleanup();
  }
});

// ============================================================================
// 16-17. Website & Domain Intelligence + SSRF & Private Webmail Exclusion
// ============================================================================
test('Phase 12: Website Inspector extracts canonical domain, certifications, industries, size & trade signals, blocks SSRF, and excludes personal webmail', async () => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>Nordic Maritime Logistics AS — Global Shipping</title>
        <meta name="description" content="ISO 9001 and ISO 14001 certified maritime freight and international export logistics across 18 countries with over 250 employees." />
      </head>
      <body>
        <nav>
          <a href="/careers">Careers</a>
          <a href="/leadership">Leadership</a>
        </nav>
        <main>
          <h1>Nordic Maritime Logistics AS</h1>
          <p>We serve industries including Maritime, Energy, and Manufacturing with global export & import customs brokerage and worldwide shipping.</p>
          <p>Contact us at sales@nordicmaritime.no or personal@gmail.com</p>
        </main>
      </body>
    </html>
  `;
  const leadershipHtml = `
    <html>
      <body>
        <h2>Executive Team</h2>
        <div><h3>Astrid Solberg</h3><p>Chief Executive Officer</p><a href="https://www.linkedin.com/in/astrid-solberg">LinkedIn</a></div>
      </body>
    </html>
  `;

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 });
    if (url.includes('/leadership')) return makeHtmlResponse(leadershipHtml, url);
    return makeHtmlResponse(html, 'https://www.nordicmaritime.no/');
  };

  const result = await inspectWebsite('https://nordicmaritime.no', {
    fetchFn: mockFetch,
    dnsLookupAll: PUBLIC_DNS_MOCK,
    expectedCompanyName: 'Nordic Maritime Logistics AS',
    maxPages: 4,
  });

  assert.equal(result.isOnline, true);
  assert.equal(result.canonicalDomain, 'nordicmaritime.no');
  assert.equal(result.companyIdentityConsistent, true);
  assert.ok(result.certificationsFound?.includes('ISO 9001'));
  assert.ok(result.certificationsFound?.includes('ISO 14001'));
  assert.ok(result.careersPageUrl?.includes('/careers'));
  assert.ok((result.tradeActivitySignals?.length || 0) > 0);
  assert.ok((result.businessSizeIndicators?.length || 0) > 0);
  assert.ok(result.emailsFound.includes('sales@nordicmaritime.no'));
  assert.equal(result.emailsFound.includes('personal@gmail.com'), false);

  // SSRF private IP must be blocked cleanly
  const ssrfBlocked = await inspectWebsite('http://internal.corp.local', {
    fetchFn: mockFetch,
    dnsLookupAll: PRIVATE_DNS_MOCK,
  });
  assert.equal(ssrfBlocked.isOnline, false);
  assert.equal(ssrfBlocked.securityCheck.passed, false);
  assert.ok(/blocked|ssrf|private|loopback/i.test(ssrfBlocked.securityCheck.reason || ''));
});

// ============================================================================
// 18-21. Data Quality Scoring, Verification Cap, Freshness Rules & Duplicate Risk
// ============================================================================
test('Phase 12: Data Quality separates completeness/verification/freshness, enforces verification cap on unverified records, and flags stale attributes & duplicate risk', () => {
  const nowMs = new Date('2026-11-18T12:00:00.000Z').getTime();

  // Populated + fresh BUT low-verification lead -> must trigger verification cap <= 54!
  const recentIso = new Date(nowMs - 2 * 86_400_000).toISOString();
  const unverifiedPopulated = makeSampleLead({
    id: 'lead-unverified',
    employeeRange: '50-200',
    foundedYear: 2012,
    identifiers: [{ type: 'ORGNR', value: '987654321', status: 'syntax_validated', verified: false, source: 'Syntax Check' }],
    sources: [{ sourceName: 'Web Scrape', retrievedAt: recentIso }],
    emailStatus: 'unverified',
    webMetadata: { description: 'Maritime operator' },
    customFields: {
      attributeSources: JSON.stringify({
        legalName: { retrievedAt: recentIso, sourceType: 'business_directory' },
        companyStatus: { retrievedAt: recentIso, sourceType: 'business_directory' },
        registeredAddress: { retrievedAt: recentIso, sourceType: 'business_directory' },
        website: { retrievedAt: recentIso, sourceType: 'business_directory' },
        email: { retrievedAt: recentIso, sourceType: 'business_directory' },
        phone: { retrievedAt: recentIso, sourceType: 'business_directory' },
      }),
    },
  });
  const qUnverified = evaluateCompanyDataQuality(unverifiedPopulated, { nowMs });
  assert.ok(qUnverified.completenessScore >= 90, 'Populated lead should have high completeness');
  assert.ok(qUnverified.verificationScore < 25, 'Unverified lead should have low verification score');
  assert.equal(qUnverified.verificationCapApplied, true);
  assert.ok(qUnverified.overallScore <= 54, `Expected capped score <= 54, got ${qUnverified.overallScore}`);

  // Verified fresh lead -> high overall score without cap
  const freshIso = new Date(nowMs - 5 * 86_400_000).toISOString();
  const verifiedFresh = makeSampleLead({
    emailStatus: 'verified',
    webMetadata: { inspectedAt: freshIso, httpStatus: 200, description: 'Maritime logistics operator.' },
    customFields: {
      registryVerificationState: 'officially_verified',
      lastVerifiedAt: freshIso,
      emailVerificationMeta: JSON.stringify({ status: 'provider_deliverable', verifiedAt: freshIso }),
      phoneVerificationMeta: JSON.stringify({ status: 'provider_verified', verifiedAt: freshIso }),
      attributeSources: JSON.stringify({
        email: { verifiedAt: freshIso, sourceType: 'authorized_verification_provider' },
        phone: { verifiedAt: freshIso, sourceType: 'authorized_verification_provider' },
        companyStatus: { verifiedAt: freshIso, sourceType: 'official_registry' },
        website: { verifiedAt: freshIso, sourceType: 'official_website' },
        legalName: { verifiedAt: freshIso, sourceType: 'official_registry' },
      }),
    },
  });
  const qVerified = evaluateCompanyDataQuality(verifiedFresh, { nowMs });
  assert.equal(qVerified.verificationCapApplied, false);
  assert.ok(qVerified.overallScore >= 80, `Expected verified fresh score >= 80, got ${qVerified.overallScore}`);

  // Attribute-specific freshness intervals: 120d old -> email (90d) is STALE, legalName (365d) is FRESH!
  const aged120d = new Date(nowMs - 120 * 86_400_000).toISOString();
  assert.equal(evaluateFreshnessState('email', aged120d, nowMs).status, 'stale');
  assert.equal(evaluateFreshnessState('legalName', aged120d, nowMs).status, 'fresh');
  assert.equal(ATTRIBUTE_FRESHNESS_RULES.incorporationDate.maxAgeDays, 730);

  // Duplicate risk lowers overall quality
  const qDup = evaluateCompanyDataQuality(verifiedFresh, { nowMs, duplicateCandidatesCount: 2 });
  assert.ok(qDup.overallScore < qVerified.overallScore);
  assert.equal(qDup.duplicateRisk, 'high');

  // Person data quality evaluates relationship confidence & keeps unverified person score low (<= 54)
  const unverifiedPerson = makeSamplePerson({
    verificationStatus: 'unverified',
    emailStatus: 'unverified',
    confidenceScore: 30,
  });
  const qPerson = evaluatePersonDataQuality(unverifiedPerson, [makeSampleRelationship({ verificationStatus: 'unverified', confidenceScore: 35 })], { nowMs });
  assert.ok(qPerson.overallScore <= 54);
});

// ============================================================================
// 22-23. Conflict Detection & Attribute-Specific Source Precedence
// ============================================================================
test('Phase 12: Conflict resolver enforces attribute-specific precedence and never auto-overwrites stronger or conflicting values', () => {
  // Precedence order checks
  assert.ok(
    getAttributeSourcePrecedenceScore('legalName', 'official_registry') >
      getAttributeSourcePrecedenceScore('legalName', 'official_website')
  );
  assert.ok(
    getAttributeSourcePrecedenceScore('description', 'official_website') >
      getAttributeSourcePrecedenceScore('description', 'business_directory')
  );
  assert.ok(
    getAttributeSourcePrecedenceScore('email', 'authorized_verification_provider') >
      getAttributeSourcePrecedenceScore('email', 'official_website')
  );

  const nowIso = new Date().toISOString();
  const { proposals, conflicts } = resolveEnrichmentProposalsAndConflicts(
    {
      legalName: {
        value: 'Nordic Maritime Logistics AS',
        sourceType: 'official_registry',
        sourceName: 'Brønnøysundregistrene',
        lastVerifiedAt: nowIso,
      },
      description: {
        value: 'Old directory blurb',
        sourceType: 'business_directory',
        sourceName: 'Legacy Directory',
        lastVerifiedAt: nowIso,
      },
    },
    [
      // Weaker website tries to change registry-verified legalName -> MUST create conflict & NOT default-select!
      {
        field: 'legalName',
        label: 'Legal Name',
        value: 'Nordic Maritime Global Corp',
        sourceType: 'official_website',
        sourceName: 'Official Website',
        confidenceScore: 70,
        retrievedAt: nowIso,
      },
      // Stronger official website updates directory description -> conflict logged for review, NOT auto-selected
      {
        field: 'description',
        label: 'Business Description',
        value: 'ISO 9001 certified maritime freight & shipping operator.',
        sourceType: 'official_website',
        sourceName: 'Official Website',
        confidenceScore: 88,
        retrievedAt: nowIso,
      },
      // Missing field -> safe fill_missing, defaultSelected true
      {
        field: 'certifications',
        label: 'Certifications',
        value: 'ISO 9001, ISO 14001',
        sourceType: 'official_website',
        sourceName: 'Official Website',
        confidenceScore: 85,
        retrievedAt: nowIso,
      },
    ]
  );

  const legalConflict = conflicts.find((c) => c.field === 'legalName');
  assert.ok(legalConflict, 'Expected conflict for legalName');
  assert.equal(legalConflict.recommendedWinner, 'existing');

  const legalProposal = proposals.find((p) => p.field === 'legalName');
  assert.equal(legalProposal?.defaultSelected, false);
  assert.equal(legalProposal?.isConflict, true);

  const descConflict = conflicts.find((c) => c.field === 'description');
  assert.ok(descConflict, 'Expected conflict for description');
  assert.equal(descConflict.recommendedWinner, 'incoming');

  const certProposal = proposals.find((p) => p.field === 'certifications');
  assert.equal(certProposal?.defaultSelected, true);
  assert.equal(certProposal?.actionRecommendation, 'fill_missing');
});

// ============================================================================
// 24-27. Multi-Source Company & Person Preview, Selective Owner Apply & Bounded Bulk Batch
// ============================================================================
test('Phase 12: Multi-source Company Enrichment Preview requires owner approval, preserves verified data on failure, and applies ONLY selected updates', async () => {
  const { mgr, cleanup } = createTempCredManager();
  try {
    const emptyRegistry = new ConnectorRegistry();
    const originalLead = makeSampleLead({
      emailStatus: 'verified',
      customFields: {
        registryVerificationState: 'officially_verified',
        lastVerifiedAt: new Date().toISOString(),
      },
    });

    const siteHtml = `
      <html>
        <head>
          <title>Nordic Maritime Logistics AS</title>
          <meta name="description" content="ISO 9001 certified maritime freight specialist serving Europe." />
        </head>
        <body>
          <a href="/careers">Careers</a>
          <p>Export &amp; import container logistics with 150 employees.</p>
        </body>
      </html>
    `;

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 });
      return makeHtmlResponse(siteHtml, url);
    };

    const preview = await previewCompanyEnrichment(originalLead, {
      registry: emptyRegistry,
      credentialManager: mgr,
      fetchFn: mockFetch,
      dnsLookupAll: PUBLIC_DNS_MOCK,
      emailDnsHooks: {
        resolveMx: async () => [{ exchange: 'mx.nordicmaritime.example.com', priority: 10 }],
        resolveTxt: async () => [['v=spf1 ~all']],
      },
      runRegistryVerification: false,
      runWebsiteInspection: true,
      runEmailVerification: true,
      runPhoneVerification: true,
      runAiAssistance: true,
    });

    assert.equal(preview.requiresOwnerApproval, true);
    assert.ok(preview.proposals.length >= 1, 'Expected website enrichment proposals');
    assert.equal(preview.aiAssistance?.provenanceType, 'inferred');
    // Original lead must NOT be mutated by preview
    assert.equal(originalLead.customFields?.certifications, undefined);

    // Owner approves ONLY certifications proposal (not careersUrl or description)
    const certProp = preview.proposals.find((p) => p.field === 'certifications');
    assert.ok(certProp, 'Expected certifications proposal from ISO 9001');

    const applied = applyApprovedCompanyEnrichmentToClone(
      originalLead,
      [certProp],
      [],
      {
        // Simulate a failed email verification attempt -> MUST preserve existing 'verified' emailStatus!
        emailVerification: {
          ...preview.emailVerification!,
          status: 'verification_failed',
          crmEmailStatus: 'unverified',
        },
        phoneVerification: preview.phoneVerification,
        websiteSummary: preview.websiteSummary,
        providerRuns: preview.providerRuns,
        failedVerifications: [
          { provider: 'Hunter.io', reason: 'Transient timeout', existingDataPreserved: true },
        ],
      },
      'owner@leed.test'
    );

    assert.equal(applied.customFields?.certifications, certProp.proposedValue);
    assert.equal(applied.customFields?.careersUrl, undefined, 'Unapproved field must NOT be applied');
    assert.equal(applied.emailStatus, 'verified', 'Existing verified email status must be preserved on failed attempt');
    const history = JSON.parse(applied.customFields?.enrichmentHistory || '[]');
    assert.equal(history.length, 1);
    assert.equal(history[0].fieldsUpdated[0].field, 'certifications');

    // Bounded bulk enrichment enforces MAX_BULK_ENRICHMENT_BATCH = 20
    const batch25 = Array.from({ length: 25 }, (_, i) =>
      makeSampleLead({ id: `bulk-${i}`, companyName: `Bulk Co ${i}`, website: undefined, domain: undefined })
    );
    const bulkResult = await previewBulkCompanyEnrichment(batch25, {
      registry: emptyRegistry,
      credentialManager: mgr,
      runRegistryVerification: false,
      runWebsiteInspection: false,
      runEmailVerification: false,
      runPhoneVerification: false,
    });
    assert.equal(bulkResult.totalRequested, 25);
    assert.equal(bulkResult.processedCount, MAX_BULK_ENRICHMENT_BATCH);
    assert.equal(bulkResult.cappedAt, 20);
  } finally {
    cleanup();
  }
});

test('Phase 12: Decision-Maker enrichment preview & selective owner apply updates approved person/relationship fields and preserves history', async () => {
  const { mgr, cleanup } = createTempCredManager();
  try {
    const emptyRegistry = new ConnectorRegistry();
    const companyLead = makeSampleLead();
    const person = makeSamplePerson({ linkedinUrl: undefined, officialBioUrl: undefined });
    const rel = makeSampleRelationship({ jobTitle: 'Managing Director' });

    const leadershipHtml = `
      <html>
        <body>
          <h1>Leadership</h1>
          <section>
            <h3>Astrid Solberg</h3>
            <p>Chief Executive Officer</p>
            <a href="https://www.linkedin.com/in/astrid-solberg-official">LinkedIn</a>
          </section>
        </body>
      </html>
    `;
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /', { status: 200 });
      return makeHtmlResponse(leadershipHtml, 'https://nordicmaritime.example.com/leadership');
    };

    const preview = await previewPersonEnrichment(person, [rel], companyLead, {
      registry: emptyRegistry,
      credentialManager: mgr,
      fetchFn: mockFetch,
      dnsLookupAll: PUBLIC_DNS_MOCK,
      emailDnsHooks: {
        resolveMx: async () => [{ exchange: 'mx.nordicmaritime.example.com', priority: 10 }],
        resolveTxt: async () => [],
      },
    });

    assert.equal(preview.requiresOwnerApproval, true);
    const linkedinProp = preview.proposals.find((p) => p.field === 'linkedinUrl');
    assert.ok(linkedinProp, 'Expected LinkedIn URL proposal from official company leadership page');

    const { personUpdates, historyEntry } = applyApprovedPersonEnrichmentToClone(
      person,
      rel,
      [linkedinProp],
      {
        emailVerification: preview.emailVerification,
        phoneVerification: preview.phoneVerification,
        providerRuns: preview.providerRuns,
      },
      'owner@leed.test'
    );

    assert.equal(personUpdates.linkedinUrl, 'https://www.linkedin.com/in/astrid-solberg-official');
    assert.equal(historyEntry.entityType, 'person');
    assert.equal(historyEntry.fieldsUpdated.length, 1);
  } finally {
    cleanup();
  }
});

// ============================================================================
// 28. AI Enrichment Evidence Assistance — Deterministic Fallback & Zero Fabrication
// ============================================================================
test('Phase 12: AI enrichment assistance falls back cleanly without Gemini API key, labels output inferred, and never fabricates data', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const lead = makeSampleLead({ email: undefined, website: undefined, domain: undefined });
    const quality = evaluateCompanyDataQuality(lead);
    const res = await analyzeEnrichmentEvidenceWithAi({
      companyName: lead.companyName,
      countryCode: 'NO',
      industry: lead.industry,
      missingCriticalFields: quality.missingCriticalFields,
      staleAttributes: quality.staleAttributes.map((s) => s.label),
      conflicts: [],
      proposalsCount: 0,
      qualityBefore: {
        overallScore: quality.overallScore,
        completenessScore: quality.completenessScore,
        verificationScore: quality.verificationScore,
        freshnessScore: quality.freshnessScore,
      },
    });

    assert.equal(res.provenanceType, 'inferred');
    assert.equal(res.engine, 'deterministic-pipeline');
    assert.ok(res.summary.includes('Nordic Maritime Logistics AS'));
    assert.ok(res.missingDataRecommendations.length >= 1);
    assert.equal(res.summary.includes('@'), false, 'Fallback must never fabricate an email address');
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
  }
});
