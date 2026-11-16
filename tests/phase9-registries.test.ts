import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeIdentifierType, getDefaultIdentifierTypeForCountry } from '../shared/identifierRegistry.ts';
import {
  validateIdentifier,
  validateFinnishYtunnus,
  formatFinnishYtunnus,
  validatePolishNip,
  validatePolishKrs,
  normalizePolishKrs,
  validateDutchKvk,
  validateBelgianKbo,
  validateSwissUid,
  formatSwissUid,
  validateSwedishOrgnr,
  validateDanishCvr,
  validateNewZealandNzbn,
  validateBrazilianCnpj,
  validateKoreanBrn,
  validateIrishCro,
  validateLei,
} from '../server/identifiers/identifierEngine.ts';
import { normalizeLegalCompanyStatus } from '../server/connectors/core/normalizer.ts';
import { ConnectorError } from '../server/connectors/core/errors.ts';
import { ConnectorExecutionEngine } from '../server/connectors/core/executionEngine.ts';
import { ConnectorRegistry } from '../server/connectors/core/registry.ts';
import { ConnectorExecutionContext } from '../server/connectors/core/types.ts';
import { ensureConnectorsRegistered, connectorRegistry } from '../server/connectors/index.ts';
import { GleifConnector } from '../server/connectors/adapters/gleifAdapter.ts';
import { EuViesConnector } from '../server/connectors/adapters/euViesAdapter.ts';
import { FiPrhConnector } from '../server/connectors/adapters/fiPrhAdapter.ts';
import { PlKrsConnector } from '../server/connectors/adapters/plKrsAdapter.ts';
import { NlKvkConnector } from '../server/connectors/adapters/nlKvkAdapter.ts';
import { NzCompaniesConnector } from '../server/connectors/adapters/nzCompaniesAdapter.ts';
import { ChZefixConnector } from '../server/connectors/adapters/chZefixAdapter.ts';
import { IeCroConnector } from '../server/connectors/adapters/ieCroAdapter.ts';
import {
  getAllAuditedRegistries,
  getAuditedRegistryEntry,
  INTERNATIONAL_REGISTRY_AUDIT,
  PRIORITY_27_COUNTRIES,
  resolveSevenStateRegistryStatus,
} from '../server/geo/registryAudit.ts';
import { buildCountryCapabilityMatrix } from '../server/geo/capabilityMatrix.ts';
import {
  applyOfficialVerificationToLead,
  verifyLeadWithOfficialRegistry,
} from '../server/verification/registryVerificationService.ts';
import { executeRegistryJsonRequest } from '../server/connectors/core/registryHttp.ts';
import { CanonicalLead, ConnectorStatus } from '../server/types.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeContext(overrides: Partial<ConnectorExecutionContext> = {}): ConnectorExecutionContext {
  const controller = new AbortController();
  return {
    requestId: 'req-phase9-test',
    userAgent: 'LEED-Phase9-Test/1.0 (test@leed-pipeline.local)',
    credentials: {},
    credentialSource: overrides.credentials && Object.keys(overrides.credentials).length > 0 ? 'database_encrypted' : 'none',
    config: { connectorId: 'test', enabled: true },
    timeoutMs: 5000,
    signal: controller.signal,
    ...overrides,
  };
}

function makeLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = new Date().toISOString();
  return {
    id: 'lead-p9-1',
    companyName: 'Test Entity',
    legalName: 'Test Entity',
    industry: 'Technology',
    category: 'B2B',
    confidenceScore: 50,
    confidenceSignals: ['Imported spreadsheet'],
    sources: [
      {
        sourceName: 'Manual CRM Entry',
        retrievedAt: now,
      },
    ],
    identifiers: [],
    status: 'qualified',
    pipelineStageId: 'stage-negotiation',
    opportunityValue: 75000,
    currency: 'EUR',
    tags: ['enterprise'],
    notes: [
      {
        id: 'note-p9',
        content: 'Preserve executive call notes.',
        createdAt: now,
        author: 'owner@leed.local',
      },
    ],
    activities: [],
    createdAt: now,
    updatedAt: now,
    address: {
      city: 'Helsinki',
      postalCode: '00100',
      country: 'Finland',
      countryCode: 'FI',
    },
    ...overrides,
  };
}

describe('Phase 9 — 27-Country Mathematical Identifier Validation & Canonicalization', () => {
  it('canonicalizes and maps default identifier types across 27 priority countries', () => {
    assert.equal(getDefaultIdentifierTypeForCountry('FI'), 'FI_YTUNNUS');
    assert.equal(getDefaultIdentifierTypeForCountry('PL'), 'PL_KRS');
    assert.equal(getDefaultIdentifierTypeForCountry('NL'), 'NL_KVK');
    assert.equal(getDefaultIdentifierTypeForCountry('NZ'), 'NZ_NZBN');
    assert.equal(getDefaultIdentifierTypeForCountry('CH'), 'CH_UID');
    assert.equal(getDefaultIdentifierTypeForCountry('IE'), 'IE_CRO');
    assert.equal(getDefaultIdentifierTypeForCountry('BE'), 'BE_KBO');
    assert.equal(getDefaultIdentifierTypeForCountry('SE'), 'SE_ORG');
    assert.equal(getDefaultIdentifierTypeForCountry('DK'), 'DK_CVR');
    assert.equal(getDefaultIdentifierTypeForCountry('BR'), 'BR_CNPJ');
    assert.equal(getDefaultIdentifierTypeForCountry('KR'), 'KR_BRN');

    assert.equal(canonicalizeIdentifierType('YTUNNUS', 'FI'), 'FI_YTUNNUS');
    assert.equal(canonicalizeIdentifierType('KVK', 'NL'), 'NL_KVK');
    assert.equal(canonicalizeIdentifierType('ZEFIX', 'CH'), 'CH_UID');
    assert.equal(canonicalizeIdentifierType('CNPJ', 'BR'), 'BR_CNPJ');
    assert.equal(canonicalizeIdentifierType('VIES', 'DE'), 'EU_VAT');
  });

  it('validates mathematical checksums for FI, PL, NL, BE, CH, SE, DK, NZ, IE, BR, KR, and LEI', () => {
    // Finland Y-tunnus (Nokia Oyj 0112038-9)
    assert.equal(validateFinnishYtunnus('0112038-9'), true);
    assert.equal(formatFinnishYtunnus('01120389'), '0112038-9');
    assert.equal(validateFinnishYtunnus('0112038-1'), false);

    // Poland NIP & KRS
    assert.equal(validatePolishNip('5260250995'), true);
    assert.equal(validatePolishNip('5260250996'), false);
    assert.equal(validatePolishKrs('28860'), true);
    assert.equal(normalizePolishKrs('28860'), '0000028860');

    // Netherlands KVK
    assert.equal(validateDutchKvk('30169691'), true);
    assert.equal(validateDutchKvk('12345'), false);

    // Belgium KBO (Mod-97)
    assert.equal(validateBelgianKbo('BE 0403.170.701'), true);
    assert.equal(validateBelgianKbo('0403170702'), false);

    // Switzerland UID (Mod-11)
    assert.equal(validateSwissUid('CHE-103.867.266'), true);
    assert.equal(formatSwissUid('CHE103867266'), 'CHE-103.867.266');
    assert.equal(validateSwissUid('CHE-103.867.267'), false);

    // Sweden Luhn & Denmark Mod-11
    assert.equal(validateSwedishOrgnr('556000-4615'), true);
    assert.equal(validateSwedishOrgnr('556000-4616'), false);
    assert.equal(validateDanishCvr('10150817'), true);
    assert.equal(validateDanishCvr('10150818'), false);

    // New Zealand NZBN (EAN-13 GS1 94...) & Ireland CRO
    assert.equal(validateNewZealandNzbn('9429041561829'), true);
    assert.equal(validateNewZealandNzbn('9429041561820'), false);
    assert.equal(validateIrishCro('100007'), true);
    assert.equal(validateIrishCro('XX'), false);

    // Brazil CNPJ dual Mod-11 & Korea BRN weighted check
    assert.equal(validateBrazilianCnpj('00.000.000/0001-91'), true);
    assert.equal(validateBrazilianCnpj('00.000.000/0001-92'), false);
    assert.equal(validateKoreanBrn('120-81-47521'), true);
    assert.equal(validateKoreanBrn('120-81-47529'), false);

    // Unified engine
    const chCheck = validateIdentifier('CH_UID', '103867266', 'CH');
    assert.equal(chCheck.valid, true);
    assert.equal(chCheck.status, 'syntax_validated');

    const fiCheck = validateIdentifier('FI_YTUNNUS', '0112038-1', 'FI');
    assert.equal(fiCheck.valid, false);
    assert.ok(fiCheck.error);
  });

  it('normalizes new registry statuses (Normal, Czynny, explicitActive)', () => {
    assert.equal(normalizeLegalCompanyStatus('Normal'), 'active');
    assert.equal(normalizeLegalCompanyStatus('Czynny'), 'active');
    assert.equal(normalizeLegalCompanyStatus('CUSTOM_OK', { explicitActive: true }), 'active');
    assert.equal(normalizeLegalCompanyStatus('Dissolved'), 'dissolved');
  });
});

describe('Phase 9 — Shared SSRF-Protected Registry HTTP Client', () => {
  it('blocks private IP literals via fetchWithSsrfProtection and redacts secrets cleanly', async () => {
    await assert.rejects(
      () =>
        executeRegistryJsonRequest({
          providerId: 'conn-test',
          url: 'http://127.0.0.1/internal-admin',
          userAgent: 'LEED-Phase9-Test/1.0',
          knownSecrets: ['SUPER-SECRET-99'],
        }),
      (err: unknown) =>
        err instanceof ConnectorError &&
        /blocked|private|loopback|prohibited|invalid|network/i.test(err.message)
    );

    const fakeFetch: typeof fetch = async () =>
      new Response('{"error":"bad key SECRET-TOKEN-XYZ"}', {
        status: 401,
        statusText: 'Unauthorized SECRET-TOKEN-XYZ',
      });

    await assert.rejects(
      () =>
        executeRegistryJsonRequest({
          providerId: 'conn-nl-kvk',
          url: 'https://api.kvk.nl/api/v2/zoeken?naam=Philips',
          headers: { apikey: 'SECRET-TOKEN-XYZ' },
          userAgent: 'LEED-Phase9-Test/1.0',
          knownSecrets: ['SECRET-TOKEN-XYZ'],
          fetchFn: fakeFetch,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConnectorError);
        assert.equal(err.category, 'authentication_failure');
        assert.equal(err.message.includes('SECRET-TOKEN-XYZ'), false);
        return true;
      }
    );
  });

  it('handles HTTP 429 rate limits and malformed JSON gracefully', async () => {
    const rateLimitedFetch: typeof fetch = async () =>
      new Response('Rate limit exceeded', {
        status: 429,
        headers: { 'Retry-After': '15' },
      });

    await assert.rejects(
      () =>
        executeRegistryJsonRequest({
          providerId: 'conn-gleif',
          url: 'https://api.gleif.org/api/v1/lei-records?page[size]=1',
          userAgent: 'LEED-Phase9-Test/1.0',
          fetchFn: rateLimitedFetch,
        }),
      (err: unknown) => err instanceof ConnectorError && err.category === 'rate_limited' && err.retryAfterMs === 15000
    );

    const badJsonFetch: typeof fetch = async () =>
      new Response('<html>Gateway Bad JSON</html>', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await assert.rejects(
      () =>
        executeRegistryJsonRequest({
          providerId: 'conn-gleif',
          url: 'https://api.gleif.org/api/v1/lei-records?page[size]=1',
          userAgent: 'LEED-Phase9-Test/1.0',
          fetchFn: badJsonFetch,
        }),
      (err: unknown) => err instanceof ConnectorError && err.category === 'invalid_response'
    );
  });
});

describe('Phase 9 — Authoritative International Registry Adapters (Mocked SSRF-Safe Fetch)', () => {
  it('registers all 8 Phase 9 adapters alongside Phases 1-8 connectors', () => {
    ensureConnectorsRegistered();
    const ids = new Set(connectorRegistry.listAll().map((c) => c.id));
    for (const id of [
      'conn-gleif',
      'conn-eu-vies',
      'conn-fi-prh',
      'conn-pl-krs',
      'conn-nl-kvk',
      'conn-nz-companies',
      'conn-ch-zefix',
      'conn-ie-cro',
    ]) {
      assert.ok(ids.has(id), `Expected ${id} to be registered`);
    }
  });

  it('GleifConnector handles legalName search, pagination, exact LEI lookup, and 404 notFound', async () => {
    const gleif = new GleifConnector(async (url) => {
      const u = String(url);
      if (u.includes('5493001KJTIIGC8Y1R12')) {
        return new Response(
          JSON.stringify({
            data: {
              id: '5493001KJTIIGC8Y1R12',
              attributes: {
                lei: '5493001KJTIIGC8Y1R12',
                entity: {
                  legalName: { name: 'APPLE INC.' },
                  status: 'ACTIVE',
                  jurisdiction: 'US',
                  headquartersAddress: {
                    addressLines: ['One Apple Park Way'],
                    city: 'Cupertino',
                    region: 'US-CA',
                    postalCode: '95014',
                    country: 'US',
                  },
                  registeredAs: '0000320193',
                },
                registration: { status: 'ISSUED', lastUpdateDate: '2026-10-01T00:00:00Z' },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (u.includes('52990000000000000099')) {
        return new Response('{"errors":[{"status":"404"}]}', { status: 404 });
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              id: '5493001KJTIIGC8Y1R12',
              attributes: {
                lei: '5493001KJTIIGC8Y1R12',
                entity: { legalName: { name: 'APPLE INC.' }, status: 'ACTIVE', jurisdiction: 'US' },
              },
            },
          ],
          meta: { pagination: { currentPage: 1, perPage: 20, total: 42, lastPage: 3 } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const searchRes = await gleif.search({ query: 'Apple Inc', countryCode: 'US', page: 1, pageSize: 20 }, makeContext());
    assert.equal(searchRes.isLiveApi, true);
    assert.equal(searchRes.pagination.hasMore, true);
    assert.equal(searchRes.pagination.totalPages, 3);
    assert.equal(searchRes.results[0].company.registrationType, 'LEI');

    const lookup = await gleif.lookupById({ externalId: '5493001KJTIIGC8Y1R12' }, makeContext());
    assert.equal(lookup.found, true);
    assert.equal(lookup.result?.company.companyStatus, 'active');

    assert.equal(validateLei('5493001KJTIIGC8Y1R12'), true);
    await assert.rejects(
      () => gleif.lookupById({ externalId: 'INVALIDLEI' }, makeContext()),
      (e: unknown) => e instanceof ConnectorError && e.category === 'invalid_request'
    );
  });

  it('EuViesConnector sends POST JSON to VIES check-vat-number and propagates member-state unavailability', async () => {
    let seenMethod = '';
    let seenBody = '';
    const vies = new EuViesConnector(async (_url, init) => {
      seenMethod = init?.method || 'GET';
      seenBody = String(init?.body || '');
      if (seenBody.includes('999999999')) {
        return new Response(
          JSON.stringify({ valid: false, userError: 'MS_UNAVAILABLE', countryCode: 'DE', vatNumber: '999999999' }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          valid: true,
          countryCode: 'IE',
          vatNumber: '6388047V',
          name: 'GOOGLE IRELAND LIMITED',
          address: 'GORDON HOUSE, BARROW STREET\nDUBLIN 4',
          requestDate: '2026-11-15T12:00:00Z',
        }),
        { status: 200 }
      );
    });

    const ok = await vies.lookupById({ externalId: 'IE6388047V', countryCode: 'IE' }, makeContext());
    assert.equal(seenMethod, 'POST');
    assert.ok(seenBody.includes('"vatNumber":"6388047V"'));
    assert.equal(ok.found, true);
    assert.equal(ok.result?.company.legalName, 'GOOGLE IRELAND LIMITED');
    assert.equal(ok.result?.company.registrationType, 'EU_VAT');

    await assert.rejects(
      () => vies.lookupById({ externalId: 'DE999999999', countryCode: 'DE' }, makeContext()),
      (e: unknown) => e instanceof ConnectorError && e.category === 'provider_unavailable'
    );
  });

  it('FiPrhConnector queries Finnish PRH YTJ v3 open API and detects active vs ended entities', async () => {
    const fi = new FiPrhConnector(async () =>
      new Response(
        JSON.stringify({
          totalResults: 1,
          companies: [
            {
              businessId: { value: '0112038-9', registrationDate: '1978-03-17' },
              names: [{ name: 'Nokia Oyj', type: '1', endDate: null }],
              addresses: [
                {
                  type: 1,
                  street: 'Karakaari',
                  buildingNumber: '7',
                  postCode: '02610',
                  postOffices: [{ city: 'ESPOO', languageCode: '1' }],
                },
              ],
              website: { url: 'www.nokia.com' },
              status: '2',
              endDate: null,
            },
          ],
        }),
        { status: 200 }
      )
    );

    const lookup = await fi.lookupById({ externalId: '01120389', countryCode: 'FI' }, makeContext());
    assert.equal(lookup.found, true);
    assert.equal(lookup.isLiveApi, true);
    assert.equal(lookup.result?.company.registrationNumber, '0112038-9');
    assert.equal(lookup.result?.company.registrationType, 'FI_YTUNNUS');
    assert.equal(lookup.result?.company.legalName, 'Nokia Oyj');
    assert.equal(lookup.result?.company.companyStatus, 'active');
    assert.equal(lookup.result?.company.address?.city, 'ESPOO');
  });

  it('PlKrsConnector verifies Polish KRS via Ministry of Justice API and NIP via MF White List', async () => {
    const pl = new PlKrsConnector(async (url) => {
      const u = String(url);
      if (u.includes('wl-api.mf.gov.pl')) {
        return new Response(
          JSON.stringify({
            result: {
              subject: {
                name: 'ORLEN SPÓŁKA AKCYJNA',
                nip: '7740001454',
                krs: '0000028860',
                statusVat: 'Czynny',
                workingAddress: 'UL. CHEMIKÓW 7, 09-411 PŁOCK',
              },
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          odpis: {
            naglowekA: { numerKRS: '0000028860', dataRejestracjiWKRS: '2001-07-19' },
            dane: {
              dzial1: {
                danePodmiotu: {
                  nazwa: 'ORLEN SPÓŁKA AKCYJNA',
                  identyfikatory: { nip: '7740001454', regon: '610188201' },
                },
                siedzibaIAdres: {
                  adres: { ulica: 'CHEMIKÓW', nrDomu: '7', miejscowosc: 'PŁOCK', kodPocztowy: '09-411' },
                },
              },
            },
          },
        }),
        { status: 200 }
      );
    });

    const krsRes = await pl.lookupById({ externalId: '28860', countryCode: 'PL' }, makeContext());
    assert.equal(krsRes.found, true);
    assert.equal(krsRes.result?.company.registrationNumber, '0000028860');
    assert.equal(krsRes.result?.company.registrationType, 'PL_KRS');

    const nipRes = await pl.lookupById({ externalId: '5260250995', countryCode: 'PL' }, makeContext());
    assert.equal(nipRes.found, true);
    assert.equal(nipRes.result?.company.companyStatus, 'active');
  });

  it('NlKvkConnector & NzCompaniesConnector require credentials without fake data and execute cleanly when configured', async () => {
    const kvk = new NlKvkConnector(async (_url, init) => {
      const h = (init?.headers || {}) as Record<string, string>;
      assert.equal(h.apikey, 'KVK-TEST-KEY-999');
      return new Response(
        JSON.stringify({
          kvkNummer: '30169691',
          naam: 'Koninklijke Philips N.V.',
          _embedded: {
            hoofdvestiging: {
              adressen: [{ straatnaam: 'Amstelplein', huisnummer: 2, postcode: '1096BC', plaats: 'Amsterdam' }],
            },
          },
        }),
        { status: 200 }
      );
    });

    const kvkVal = await kvk.validateConnection(makeContext({ credentials: {} }));
    assert.equal(kvkVal.ok, false);
    assert.equal(kvkVal.healthState, 'authentication_required');
    await assert.rejects(
      () => kvk.search({ query: 'Philips', countryCode: 'NL' }, makeContext({ credentials: {} })),
      (e: unknown) => e instanceof ConnectorError && e.category === 'missing_credentials'
    );

    const kvkLookup = await kvk.lookupById(
      { externalId: '30169691', countryCode: 'NL' },
      makeContext({ credentials: { apiKey: 'KVK-TEST-KEY-999' } })
    );
    assert.equal(kvkLookup.found, true);
    assert.equal(kvkLookup.result?.company.registrationType, 'NL_KVK');
    assert.equal(kvkLookup.result?.company.address?.city, 'Amsterdam');

    const nz = new NzCompaniesConnector(async (_url, init) => {
      const h = (init?.headers || {}) as Record<string, string>;
      assert.equal(h['Ocp-Apim-Subscription-Key'], 'NZ-TEST-SUB-KEY');
      return new Response(
        JSON.stringify({
          nzbn: '9429041561829',
          entityName: 'AIR NEW ZEALAND LIMITED',
          entityStatusCode: '50',
          entityStatusDescription: 'Registered',
          addresses: { addressList: [{ address1: '185 Fanshawe Street', address2: 'Auckland', postCode: '1010', countryCode: 'NZ' }] },
        }),
        { status: 200 }
      );
    });

    await assert.rejects(
      () => nz.search({ query: 'Air New Zealand', countryCode: 'NZ' }, makeContext({ credentials: {} })),
      (e: unknown) => e instanceof ConnectorError && e.category === 'missing_credentials'
    );

    const nzLookup = await nz.lookupById(
      { externalId: '9429041561829', countryCode: 'NZ' },
      makeContext({ credentials: { apiKey: 'NZ-TEST-SUB-KEY' } })
    );
    assert.equal(nzLookup.found, true);
    assert.equal(nzLookup.result?.company.registrationType, 'NZ_NZBN');
    assert.equal(nzLookup.result?.company.companyStatus, 'active');
  });

  it('ChZefixConnector & IeCroConnector construct Basic Auth headers, redact passwords, and parse records cleanly', async () => {
    let chAuthHeader = '';
    const zefix = new ChZefixConnector(async (_url, init) => {
      const h = (init?.headers || {}) as Record<string, string>;
      chAuthHeader = h.Authorization || '';
      return new Response(
        JSON.stringify([
          {
            name: 'Novartis AG',
            uid: 'CHE103867266',
            uidFormatted: 'CHE-103.867.266',
            status: 'ACTIVE',
            canton: 'BS',
            address: { street: 'Lichtstrasse', houseNumber: '35', swissZipCode: '4056', city: 'Basel' },
          },
        ]),
        { status: 200 }
      );
    });

    await assert.rejects(
      () => zefix.search({ query: 'Novartis', countryCode: 'CH' }, makeContext({ credentials: {} })),
      (e: unknown) => e instanceof ConnectorError && e.category === 'missing_credentials'
    );

    const chLookup = await zefix.lookupById(
      { externalId: 'CHE-103.867.266', countryCode: 'CH' },
      makeContext({ credentials: { username: 'zefix-user', password: 'ZEFIX-SECRET-PASSWORD' } })
    );
    assert.ok(chAuthHeader.startsWith('Basic '));
    assert.equal(chLookup.found, true);
    assert.equal(chLookup.result?.company.registrationNumber, 'CHE-103.867.266');
    assert.equal(chLookup.result?.company.registrationType, 'CH_UID');

    let ieAuthHeader = '';
    const cro = new IeCroConnector(async (_url, init) => {
      const h = (init?.headers || {}) as Record<string, string>;
      ieAuthHeader = h.Authorization || '';
      return new Response(
        JSON.stringify({
          company_num: 100007,
          company_name: 'RYANAIR DESIGNATED ACTIVITY COMPANY',
          company_status_desc: 'Normal',
          company_addr_1: 'AIRSIDE BUSINESS PARK',
          company_addr_2: 'SWORDS',
          company_addr_3: 'CO. DUBLIN',
          eircode: 'K67 NY94',
        }),
        { status: 200 }
      );
    });

    const ieLookup = await cro.lookupById(
      { externalId: '100007', countryCode: 'IE' },
      makeContext({ credentials: { email: 'owner@leed.local', apiKey: 'CRO-KEY-SECRET' } })
    );
    assert.ok(ieAuthHeader.startsWith('Basic '));
    assert.equal(ieLookup.found, true);
    assert.equal(ieLookup.result?.company.registrationType, 'IE_CRO');
    assert.equal(ieLookup.result?.company.companyStatus, 'active');
  });
});

describe('Phase 9 — 27-Country Registry Audit & Capability Matrix Honesty', () => {
  it('documents all 27 priority countries plus EU and GLOBAL_LEI with complete 8-point audit criteria', () => {
    assert.equal(PRIORITY_27_COUNTRIES.length, 27);
    const audited = getAllAuditedRegistries();
    assert.equal(audited.length, 29);

    for (const cc of PRIORITY_27_COUNTRIES) {
      const entry = getAuditedRegistryEntry(cc);
      assert.ok(entry, `Missing audited entry for ${cc}`);
      assert.ok(entry.authorityName.length > 3);
      assert.ok(entry.auditDetails.documentationUrl.startsWith('http'));
      assert.ok(entry.auditDetails.availableBusinessFields.length >= 2);
      assert.ok(entry.auditDetails.searchAndVerificationCapabilities.length >= 1);
    }

    assert.ok(INTERNATIONAL_REGISTRY_AUDIT.EU);
    assert.ok(INTERNATIONAL_REGISTRY_AUDIT.GLOBAL_LEI);
    assert.equal(INTERNATIONAL_REGISTRY_AUDIT.AU.defaultState, 'live_auth_required');
  });

  it('builds capability matrix with 27 countries + cross-border registries and zero fabricated lastVerifiedAt', () => {
    const mockConnectors: ConnectorStatus[] = [
      {
        id: 'conn-fi-prh',
        name: 'Finland PRH',
        category: 'government_registry',
        accessMode: 'live_api',
        countryCoverage: ['FI'],
        status: 'healthy',
        healthState: 'operational',
        operational: true,
        authType: 'none_open',
        isConfigured: true,
        rateLimitNote: 'Open',
        attribution: 'PRH',
        totalCalls: 1,
        lastSuccessAt: '2026-11-15T10:00:00.000Z',
      },
      {
        id: 'conn-nl-kvk',
        name: 'Netherlands KVK',
        category: 'government_registry',
        accessMode: 'live_api',
        countryCoverage: ['NL'],
        status: 'unconfigured',
        healthState: 'authentication_required',
        operational: false,
        authType: 'api_key',
        isConfigured: false,
        rateLimitNote: 'Key req',
        attribution: 'KVK',
        totalCalls: 0,
      },
      {
        id: 'conn-ch-zefix',
        name: 'Swiss Zefix',
        category: 'government_registry',
        accessMode: 'live_api',
        countryCoverage: ['CH'],
        status: 'unconfigured',
        healthState: 'authentication_required',
        operational: false,
        authType: 'basic_auth',
        isConfigured: false,
        rateLimitNote: 'Basic Auth req',
        attribution: 'Zefix',
        totalCalls: 0,
      },
      {
        id: 'conn-gleif',
        name: 'GLEIF LEI',
        category: 'government_registry',
        accessMode: 'live_api',
        countryCoverage: ['GLOBAL'],
        status: 'healthy',
        healthState: 'operational',
        operational: true,
        authType: 'none_open',
        isConfigured: true,
        rateLimitNote: 'Open',
        attribution: 'GLEIF',
        totalCalls: 0,
      },
    ];

    const matrix = buildCountryCapabilityMatrix(mockConnectors);
    const byId = new Map(matrix.map((m) => [m.id, m]));
    const byCountry = new Map(matrix.map((m) => [m.countryCode, m]));

    assert.equal(byCountry.get('FI')?.registryState, 'live_and_operational');
    assert.equal(byCountry.get('FI')?.lastVerifiedAt, '2026-11-15T10:00:00.000Z');
    assert.equal(byCountry.get('NL')?.registryState, 'live_auth_required');
    assert.equal(byCountry.get('NL')?.lastVerifiedAt, undefined);
    assert.equal(byCountry.get('CH')?.authRequirement, 'basic_auth');
    assert.equal(byCountry.get('SE')?.registryState, 'not_implemented');
    assert.equal(byCountry.get('BR')?.registryState, 'public_access_unavailable');
    assert.equal(byCountry.get('AU')?.registryState, 'live_auth_required');
    assert.equal(byId.get('cap-global-gleif')?.registryState, 'live_and_operational');
    assert.equal(byId.get('cap-eu-vies')?.countryCode, 'EU');
    assert.equal(resolveSevenStateRegistryStatus(INTERNATIONAL_REGISTRY_AUDIT.CH, mockConnectors[2]), 'live_auth_required');
  });
});

describe('Phase 9 — Multi-Country Verification Routing, Fallback & Field Provenance', () => {
  it('verifies a Finnish lead via conn-fi-prh and populates per-field attributeSources', async () => {
    const registry = new ConnectorRegistry();
    registry.register(
      new FiPrhConnector(async () =>
        new Response(
          JSON.stringify({
            totalResults: 1,
            companies: [
              {
                businessId: { value: '0112038-9' },
                names: [{ name: 'Nokia Oyj', type: '1', endDate: null }],
                addresses: [{ type: 1, street: 'Karakaari', buildingNumber: '7', postCode: '02610', postOffices: [{ city: 'ESPOO' }] }],
                website: { url: 'https://www.nokia.com' },
                status: '2',
                endDate: null,
              },
            ],
          }),
          { status: 200 }
        )
      )
    );
    const engine = new ConnectorExecutionEngine();

    const fiLead = makeLead({
      id: 'lead-fi-1',
      companyName: 'Nokia',
      legalName: 'Nokia',
      registrationNumber: '0112038-9',
      registrationType: 'FI_YTUNNUS',
      address: { city: 'Espoo', postalCode: '02610', country: 'Finland', countryCode: 'FI' },
    });

    const report = await verifyLeadWithOfficialRegistry(fiLead, { registry, executionEngine: engine });
    assert.equal(report.state, 'officially_verified');
    assert.equal(report.connectorId, 'conn-fi-prh');
    assert.equal(report.isLiveApi, true);
    assert.deepEqual(report.attemptedConnectors, ['conn-fi-prh']);
    assert.equal(report.attributeSources?.legalName?.connectorId, 'conn-fi-prh');
    assert.equal(report.attributeSources?.registrationNumber?.verified, true);

    const updated = applyOfficialVerificationToLead(fiLead, report);
    assert.equal(updated.legalName, 'Nokia Oyj');
    assert.equal(updated.pipelineStageId, 'stage-negotiation');
    assert.equal(updated.notes.length, 1);
    const storedAttr = JSON.parse(updated.customFields?.attributeSources || '{}');
    assert.equal(storedAttr.legalName.connectorId, 'conn-fi-prh');
  });

  it('sets authRequired=true when national API lacks credentials, and falls back to EU VIES / GLEIF when identifier present', async () => {
    const registry = new ConnectorRegistry();
    registry.register(new NlKvkConnector());
    registry.register(
      new EuViesConnector(async () =>
        new Response(
          JSON.stringify({
            valid: true,
            countryCode: 'NL',
            vatNumber: '002233445B01',
            name: 'KONINKLIJKE PHILIPS N.V.',
            address: 'AMSTELPLEIN 2, AMSTERDAM',
            requestDate: '2026-11-15T12:00:00Z',
          }),
          { status: 200 }
        )
      )
    );
    registry.register(
      new GleifConnector(async () =>
        new Response(
          JSON.stringify({
            data: {
              id: '529900W18LQJJN6SJ336',
              attributes: {
                lei: '529900W18LQJJN6SJ336',
                entity: {
                  legalName: { name: 'Siemens Aktiengesellschaft' },
                  status: 'ACTIVE',
                  jurisdiction: 'DE',
                  headquartersAddress: { city: 'München', postalCode: '80333', country: 'DE' },
                },
              },
            },
          }),
          { status: 200 }
        )
      )
    );
    const engine = new ConnectorExecutionEngine();

    // 1. NL lead without EU_VAT/LEI and without KVK key -> authRequired=true, unavailable
    const nlNoFallback = makeLead({
      id: 'lead-nl-1',
      companyName: 'Philips',
      registrationNumber: '30169691',
      registrationType: 'NL_KVK',
      address: { city: 'Amsterdam', country: 'Netherlands', countryCode: 'NL' },
    });
    const rAuth = await verifyLeadWithOfficialRegistry(nlNoFallback, { registry, executionEngine: engine });
    assert.equal(rAuth.state, 'unavailable');
    assert.equal(rAuth.authRequired, true);
    assert.deepEqual(rAuth.attemptedConnectors, ['conn-nl-kvk']);

    // 2. NL lead WITH EU_VAT -> attempts conn-nl-kvk (auth error), falls back cleanly to conn-eu-vies
    const nlWithVat = makeLead({
      id: 'lead-nl-2',
      companyName: 'Koninklijke Philips N.V.',
      registrationNumber: '30169691',
      registrationType: 'NL_KVK',
      identifiers: [{ type: 'EU_VAT', value: 'NL002233445B01', verified: false }],
      address: { city: 'Amsterdam', country: 'Netherlands', countryCode: 'NL' },
    });
    const rVies = await verifyLeadWithOfficialRegistry(nlWithVat, { registry, executionEngine: engine });
    assert.equal(rVies.state, 'officially_verified');
    assert.equal(rVies.connectorId, 'conn-eu-vies');
    assert.equal(rVies.provenance?.fallbackUsed, true);
    assert.deepEqual(rVies.attemptedConnectors, ['conn-nl-kvk', 'conn-eu-vies']);

    // Preserve primary national KVK registrationNumber when cross-border EU_VAT fallback verifies the lead
    const updatedNl = applyOfficialVerificationToLead(nlWithVat, rVies);
    assert.equal(updatedNl.registrationNumber, '30169691');
    assert.equal(updatedNl.registrationType, 'NL_KVK');
    assert.ok(updatedNl.identifiers.some((i) => i.type === 'EU_VAT' && i.verified === true));

    // 3. German lead WITH LEI -> verifies via conn-gleif; DE lead WITHOUT LEI/EU_VAT -> remains unavailable
    const deWithLei = makeLead({
      id: 'lead-de-lei',
      companyName: 'Siemens AG',
      identifiers: [{ type: 'LEI', value: '529900W18LQJJN6SJ336', verified: false }],
      address: { city: 'München', country: 'Germany', countryCode: 'DE' },
    });
    const rDeLei = await verifyLeadWithOfficialRegistry(deWithLei, { registry, executionEngine: engine });
    assert.equal(rDeLei.state, 'officially_verified');
    assert.equal(rDeLei.connectorId, 'conn-gleif');

    const dePlain = makeLead({
      id: 'lead-de-plain',
      companyName: 'Siemens AG',
      identifiers: [],
      address: { city: 'München', country: 'Germany', countryCode: 'DE' },
    });
    const rDePlain = await verifyLeadWithOfficialRegistry(dePlain, { registry, executionEngine: engine });
    assert.equal(rDePlain.state, 'unavailable');
    assert.equal(rDePlain.matchedRecord, undefined);
  });
});
