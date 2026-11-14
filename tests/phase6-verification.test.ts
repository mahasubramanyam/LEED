import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { canonicalizeIdentifierType } from '../shared/identifierRegistry.ts';
import {
  validateIdentifier,
  validateJapaneseCorporateNumber,
  validateUsCik,
  normalizeUsCik,
  validateSingaporeUen,
  validateIndiaCin,
  normalizeUkCrn,
} from '../server/identifiers/identifierEngine.ts';
import {
  normalizeLegalCompanyStatus,
  mergeLeadWithTrustHierarchy,
  inferLeadTrustRank,
} from '../server/connectors/core/normalizer.ts';
import { ConnectorExecutionEngine } from '../server/connectors/core/executionEngine.ts';
import { ConnectorRegistry } from '../server/connectors/core/registry.ts';
import { ConnectorError } from '../server/connectors/core/errors.ts';
import { FrSireneConnector } from '../server/connectors/adapters/frSireneAdapter.ts';
import { UsSecEdgarConnector } from '../server/connectors/adapters/usSecEdgarAdapter.ts';
import { SgAcraConnector } from '../server/connectors/adapters/sgAcraAdapter.ts';
import { JpNtaConnector } from '../server/connectors/adapters/jpNtaAdapter.ts';
import { AbnConnector } from '../server/connectors/adapters/abnAdapter.ts';
import { BrregConnector } from '../server/connectors/adapters/brregAdapter.ts';
import { CompaniesHouseConnector } from '../server/connectors/adapters/companiesHouseAdapter.ts';
import {
  ensureConnectorsRegistered,
  connectorRegistry,
} from '../server/connectors/index.ts';
import { detectDuplicates } from '../server/connectors/dedupeEngine.ts';
import {
  compareLeadAgainstOfficialRecord,
  verifyLeadWithOfficialRegistry,
  applyOfficialVerificationToLead,
  computeLegalNameSimilarity,
} from '../server/verification/registryVerificationService.ts';
import {
  TEN_COUNTRY_REGISTRY_AUDIT,
  resolveSevenStateRegistryStatus,
} from '../server/geo/registryAudit.ts';
import { buildCountryCapabilityMatrix } from '../server/geo/capabilityMatrix.ts';
import { CanonicalLead, ConnectorStatus, SevenStateRegistryStatus } from '../server/types.ts';
import { ConnectorExecutionContext } from '../server/connectors/core/types.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeContext(overrides: Partial<ConnectorExecutionContext> = {}): ConnectorExecutionContext {
  const controller = new AbortController();
  return {
    requestId: 'req-test-1',
    userAgent: 'LEED-Phase6-Test/1.0 (test@leed-pipeline.local)',
    credentials: {},
    credentialSource: overrides.credentials && Object.keys(overrides.credentials).length > 0 ? 'environment' : 'none',
    config: { connectorId: 'test', enabled: true },
    timeoutMs: 5000,
    signal: controller.signal,
    ...overrides,
  };
}

function makeLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = new Date().toISOString();
  return {
    id: 'lead-test-1',
    companyName: 'Acme Corp',
    legalName: 'Acme Corp',
    industry: 'Software',
    category: 'B2B',
    confidenceScore: 55,
    confidenceSignals: ['Discovered via web search'],
    sources: [
      {
        sourceName: 'OpenStreetMap Nominatim',
        url: 'https://www.openstreetmap.org/node/1',
        retrievedAt: now,
      },
    ],
    identifiers: [],
    status: 'qualified',
    pipelineStageId: 'stage-negotiation',
    opportunityValue: 45000,
    currency: 'USD',
    winProbability: 65,
    tags: ['vip'],
    notes: [
      {
        id: 'note-1',
        content: 'Owner spoke with CFO on Tuesday.',
        createdAt: now,
        author: 'owner@leed.local',
      },
    ],
    activities: [],
    createdAt: now,
    updatedAt: now,
    address: {
      city: 'Oslo',
      postalCode: '0150',
      country: 'Norway',
      countryCode: 'NO',
    },
    ...overrides,
  };
}

describe('Phase 6 — Identifier Normalization & Legal Status Standards', () => {
  it('normalizes UK CRN and US CIK formats consistently', () => {
    assert.equal(normalizeUkCrn('123456'), '00123456');
    assert.equal(normalizeUkCrn('SC123456'), 'SC123456');
    assert.equal(normalizeUsCik('320193'), '0000320193');
    assert.equal(validateUsCik('320193'), true);
    assert.equal(validateUsCik('0'), false);
    assert.equal(canonicalizeIdentifierType('CIK', 'US'), 'US_CIK');
    assert.equal(canonicalizeIdentifierType('UEN', 'SG'), 'SG_UEN');
    assert.equal(canonicalizeIdentifierType('HOUJIN_BANGOU', 'JP'), 'JP_CN');
    assert.equal(canonicalizeIdentifierType('CIN', 'IN'), 'IN_CIN');
  });

  it('validates Japan 13-digit Modulo-9 Corporate Number, Singapore UEN, and India CIN', () => {
    assert.equal(validateJapaneseCorporateNumber('1180301018771'), true); // Toyota Motor Corp
    assert.equal(validateJapaneseCorporateNumber('7010401045660'), true); // Sony Group Corp
    assert.equal(validateJapaneseCorporateNumber('9180301018771'), false);

    assert.equal(validateSingaporeUen('201201936C'), true);
    assert.equal(validateSingaporeUen('T08LL1234A'), true);
    assert.equal(validateSingaporeUen('INVALID'), false);

    assert.equal(validateIndiaCin('L17110MH1973PLC019786'), true);
    assert.equal(validateIndiaCin('NOTACIN'), false);

    const jpCheck = validateIdentifier('JP_CN', '1180-3010-18771', 'JP');
    assert.equal(jpCheck.valid, true);
    assert.equal(jpCheck.normalizedValue, '1180301018771');
    assert.equal(jpCheck.status, 'syntax_validated');
  });

  it('normalizes international legal status codes to canonical companyStatus', () => {
    assert.equal(normalizeLegalCompanyStatus('active'), 'active');
    assert.equal(normalizeLegalCompanyStatus('A'), 'active');
    assert.equal(normalizeLegalCompanyStatus('Registered'), 'active');
    assert.equal(normalizeLegalCompanyStatus('dissolved'), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus('C'), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus('Cancelled'), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus(undefined, { cancelled: true }), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus('liquidation'), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus(undefined, { bankrupt: true }), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus('dormant'), 'inactive');
    assert.equal(normalizeLegalCompanyStatus('suspended'), 'inactive');
  });
});

describe('Phase 6 — Official Government Registry Adapters (Mocked Fetch)', () => {
  it('registers all 7 government registry connectors + global connectors in ConnectorRegistry', () => {
    ensureConnectorsRegistered();
    const ids = new Set(connectorRegistry.listAll().map((c) => c.id));
    for (const expectedId of [
      'conn-brreg',
      'conn-companies-house',
      'conn-abn',
      'conn-fr-sirene',
      'conn-us-sec',
      'conn-sg-acra',
      'conn-jp-nta',
    ]) {
      assert.ok(ids.has(expectedId), `Expected connector ${expectedId} to be registered`);
    }
  });

  it('FrSireneConnector parses live INSEE/Annuaire JSON, preserves Etalab license, pagination, and handles HTTP 429', async () => {
    const fr = new FrSireneConnector();
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          total_results: 35,
          total_pages: 3,
          page: 1,
          per_page: 15,
          results: [
            {
              siren: '552081317',
              nom_complet: 'ELECTRICITE DE FRANCE',
              nom_raison_sociale: 'ELECTRICITE DE FRANCE',
              etat_administratif: 'A',
              activite_principale: '35.11Z',
              nature_juridique: '5599',
              date_creation: '1955-01-01',
              siege: {
                siret: '55208131766522',
                adresse: '22 AVENUE DE WAGRAM',
                code_postal: '75008',
                libelle_commune: 'PARIS 8',
                region: '11',
                latitude: '48.8763',
                longitude: '2.2974',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const searchRes = await fr.search({ query: 'EDF', countryCode: 'FR', page: 1, pageSize: 15 }, makeContext());
    assert.equal(searchRes.isLiveApi, true);
    assert.equal(searchRes.pagination.hasMore, true);
    assert.equal(searchRes.pagination.totalPages, 3);
    assert.equal(searchRes.results.length, 1);
    assert.equal(searchRes.results[0].company.registrationNumber, '552081317');
    assert.equal(searchRes.results[0].company.registrationType, 'FR_SIREN');
    assert.equal(searchRes.results[0].company.companyStatus, 'active');
    assert.equal(searchRes.results[0].company.identifiers?.length, 2);
    assert.match(searchRes.results[0].company.rawSource?.license || '', /Licence Ouverte/i);

    globalThis.fetch = async () => new Response('Too many requests', { status: 429, statusText: 'Too Many Requests' });
    await assert.rejects(
      () => fr.search({ query: 'EDF', countryCode: 'FR' }, makeContext()),
      (err: any) => err instanceof ConnectorError && err.category === 'rate_limited'
    );
  });

  it('UsSecEdgarConnector fetches SEC index + submission profile, enforces User-Agent, and notes private LLC scope', async () => {
    const sec = new UsSecEdgarConnector();
    let seenUserAgent = '';
    globalThis.fetch = async (input, init) => {
      const headers = (init?.headers || {}) as Record<string, string>;
      seenUserAgent = headers['User-Agent'] || '';
      const urlStr = String(input);
      if (urlStr.includes('company_tickers.json')) {
        return new Response(
          JSON.stringify({
            '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
            '1': { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({
          cik: '0000320193',
          entityType: 'operating',
          sic: '3571',
          sicDescription: 'Electronic Computers',
          name: 'Apple Inc.',
          tickers: ['AAPL'],
          exchanges: ['Nasdaq'],
          ein: '942404110',
          stateOfIncorporation: 'CA',
          website: 'www.apple.com',
          addresses: {
            business: {
              street1: 'ONE APPLE PARK WAY',
              city: 'CUPERTINO',
              stateOrCountry: 'CA',
              zipCode: '95014',
            },
          },
          filings: {
            recent: {
              form: ['10-K'],
              filingDate: ['2025-11-01'],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await sec.search({ query: 'Apple', countryCode: 'US' }, makeContext());
    assert.ok(seenUserAgent.includes('LEED-Phase6-Test'));
    assert.equal(res.isLiveApi, true);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].company.registrationNumber, '0000320193');
    assert.equal(res.results[0].company.registrationType, 'US_CIK');
    assert.equal(res.results[0].company.companyStatus, 'active');
    assert.ok(res.results[0].company.identifiers?.some((i) => i.type === 'US_EIN' && i.value === '942404110'));
    assert.ok((res.notes || []).some((n) => n.toLowerCase().includes('secretary of state')));
  });

  it('SgAcraConnector queries data.gov.sg CKAN DataStore and normalizes SG_UEN', async () => {
    const sg = new SgAcraConnector();
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 1,
            records: [
              {
                uen: '201201936C',
                entity_name: 'MARINA TECH PTE. LTD.',
                entity_type_desc: 'Local Company',
                uen_status_desc: 'Registered',
                block: '10',
                reg_street_name: 'BAYFRONT AVENUE',
                reg_postal_code: '018956',
                primary_ssic_code: '62011',
                primary_ssic_description: 'Development of software and applications',
                registration_incorporation_date: '2012-01-20',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const lookup = await sg.lookupById({ externalId: '201201936C', countryCode: 'SG' }, makeContext());
    assert.equal(lookup.found, true);
    assert.equal(lookup.isLiveApi, true);
    assert.equal(lookup.result?.company.registrationNumber, '201201936C');
    assert.equal(lookup.result?.company.registrationType, 'SG_UEN');
    assert.equal(lookup.result?.company.companyStatus, 'active');
    assert.equal(lookup.result?.company.address?.postalCode, '018956');
  });

  it('JpNtaConnector requires Application ID without fabricating data, parses CSV v4 when configured, and redacts secret keys', async () => {
    const jp = new JpNtaConnector();

    const unconfVal = await jp.validateConnection(makeContext({ credentials: {} }));
    assert.equal(unconfVal.ok, false);
    assert.equal(unconfVal.healthState, 'authentication_required');
    assert.equal(unconfVal.isLiveApi, false);

    const unconfSearch = await jp.search({ query: 'Toyota', countryCode: 'JP' }, makeContext({ credentials: {} }));
    assert.equal(unconfSearch.isLiveApi, false);
    assert.equal(unconfSearch.results.length, 0);

    // Valid NTA CSV payload with Toyota row (30 columns, col 25 = enName, col 26 = enPrefecture, col 27 = enCity)
    const rowCols = Array(30).fill('""');
    rowCols[0] = '1';
    rowCols[1] = '1180301018771';
    rowCols[2] = '01';
    rowCols[4] = '2025-10-01';
    rowCols[6] = '"トヨタ自動車株式会社"';
    rowCols[8] = '301';
    rowCols[9] = '"愛知県"';
    rowCols[10] = '"豊田市"';
    rowCols[11] = '"トヨタ町１番地"';
    rowCols[15] = '4718571';
    rowCols[25] = '"Toyota Motor Corporation"';
    rowCols[26] = '"Aichi"';
    rowCols[27] = '"Toyota-shi"';
    const ntaCsv = ['2025-11-01,1,1,1', rowCols.join(',')].join('\n');

    globalThis.fetch = async () => new Response(ntaCsv, { status: 200, headers: { 'Content-Type': 'text/csv' } });
    const liveLookup = await jp.lookupById(
      { externalId: '1180301018771', countryCode: 'JP' },
      makeContext({ credentials: { apiKey: 'SECRET-NTA-KEY-999' } })
    );
    assert.equal(liveLookup.found, true);
    assert.equal(liveLookup.isLiveApi, true);
    assert.equal(liveLookup.result?.company.legalName, 'トヨタ自動車株式会社');
    assert.equal(liveLookup.result?.company.companyName, 'Toyota Motor Corporation');
    assert.equal(liveLookup.result?.company.registrationType, 'JP_CN');

    // Error must redact secret key
    globalThis.fetch = async () => new Response('Forbidden', { status: 403, statusText: 'SECRET-NTA-KEY-999 rejected' });
    await assert.rejects(
      () => jp.lookupById({ externalId: '1180301018771', countryCode: 'JP' }, makeContext({ credentials: { apiKey: 'SECRET-NTA-KEY-999' } })),
      (err: any) => {
        assert.ok(err instanceof ConnectorError);
        assert.equal(err.message.includes('SECRET-NTA-KEY-999'), false);
        return true;
      }
    );
  });

  it('AbnConnector executes live ABR JSONP when GUID is present and cleanly distinguishes offline reference when absent', async () => {
    const abn = new AbnConnector();

    const offlineRes = await abn.search({ query: '51824753556', countryCode: 'AU' }, makeContext({ credentials: {} }));
    assert.equal(offlineRes.isLiveApi, false);

    globalThis.fetch = async () =>
      new Response(
        'callback({"Abn":"51824753556","AbnStatus":"Active","AbnStatusEffectiveFrom":"2000-07-01","Acn":"000000014","AddressPostcode":"2000","AddressState":"NSW","BusinessName":["Woolworths Group"],"EntityName":"WOOLWORTHS GROUP LIMITED","EntityTypeCode":"PUB","EntityTypeName":"Australian Public Company","Gst":"2000-07-01","Message":""})',
        { status: 200 }
      );
    const liveLookup = await abn.lookupById(
      { externalId: '51 824 753 556', countryCode: 'AU' },
      makeContext({ credentials: { apiKey: 'test-abr-guid-1234' } })
    );
    assert.equal(liveLookup.isLiveApi, true);
    assert.equal(liveLookup.found, true);
    assert.equal(liveLookup.result?.verificationStatus, 'officially_verified');
    assert.equal(liveLookup.result?.company.legalName, 'WOOLWORTHS GROUP LIMITED');
    assert.equal(liveLookup.result?.company.companyStatus, 'active');
  });

  it('CompaniesHouseConnector zero-pads CRN in lookupById and BrregConnector flags slettedato as dissolved', async () => {
    const ch = new CompaniesHouseConnector();
    let seenUrl = '';
    globalThis.fetch = async (url) => {
      seenUrl = String(url);
      return new Response(
        JSON.stringify({
          company_number: '00445790',
          company_name: 'TESCO PLC',
          company_status: 'active',
          type: 'plc',
          registered_office_address: {
            address_line_1: 'Tesco House',
            locality: 'Welwyn Garden City',
            postal_code: 'AL7 1GA',
          },
        }),
        { status: 200 }
      );
    };

    const chLookup = await ch.lookupById(
      { externalId: '445790', countryCode: 'GB' },
      makeContext({ credentials: { apiKey: 'test-ch-key' } })
    );
    assert.ok(seenUrl.endsWith('/company/00445790'));
    assert.equal(chLookup.result?.company.registrationNumber, '00445790');
    assert.equal(chLookup.result?.company.companyStatus, 'active');

    const brreg = new BrregConnector();
    const dissolvedNorm = brreg.normalizeResult(
      {
        organisasjonsnummer: '999888777',
        navn: 'NORDIC TEST SLETTET AS',
        slettedato: '2024-05-01',
      },
      new Date().toISOString()
    );
    assert.equal(dissolvedNorm?.company.companyStatus, 'dissolved');
  });

  it('ConnectorExecutionEngine enforces cancellation signal cleanly', async () => {
    const engine = new ConnectorExecutionEngine();
    const fr = new FrSireneConnector();
    const abortCtrl = new AbortController();
    abortCtrl.abort();

    await assert.rejects(
      () =>
        engine.executeSearch(
          fr,
          { query: 'Renault', countryCode: 'FR' },
          { signal: abortCtrl.signal, userAgent: 'LEED-Test/1.0' }
        ),
      (err: any) =>
        err?.name === 'AbortError' ||
        String(err?.message).toLowerCase().includes('cancel') ||
        String(err?.message).toLowerCase().includes('abort')
    );
  });
});

describe('Phase 6 — Official Verification, Conflict Detection & Trust Hierarchy', () => {
  it('compares leads against official records for exact matches, probable matches, and conflicts', () => {
    const now = new Date().toISOString();
    const crmLead = makeLead({
      companyName: 'Tesco',
      registrationNumber: '445790',
      registrationType: 'UK_CRN',
      companyStatus: 'active',
      address: {
        street: 'Tesco House',
        city: 'Welwyn Garden City',
        postalCode: 'AL7 1GA',
        country: 'United Kingdom',
        countryCode: 'GB',
      },
    });

    const officialTesco = makeLead({
      companyName: 'TESCO PLC',
      legalName: 'TESCO PLC',
      registrationNumber: '00445790',
      registrationType: 'UK_CRN',
      companyStatus: 'dissolved',
      confidenceScore: 96,
      address: {
        street: 'Tesco House, Shire Park',
        city: 'Welwyn Garden City',
        postalCode: 'AL7 1GA',
        country: 'United Kingdom',
        countryCode: 'GB',
      },
    });

    const exactCheck = compareLeadAgainstOfficialRecord(crmLead, officialTesco, true);
    assert.equal(exactCheck.identifierMatched, true);
    assert.equal(exactCheck.matchType, 'exact_official_identifier');
    assert.equal(exactCheck.state, 'officially_verified');
    assert.ok(exactCheck.conflicts.some((c) => c.field === 'companyStatus' && c.severity === 'high'));

    // Conflict when registration numbers explicitly diverge
    const conflictingOfficial = makeLead({
      ...officialTesco,
      registrationNumber: '09999999',
    });
    const regConflictCheck = compareLeadAgainstOfficialRecord(crmLead, conflictingOfficial, true);
    assert.equal(regConflictCheck.state, 'conflict_detected');
    assert.ok(regConflictCheck.conflicts.some((c) => c.field === 'registrationNumber'));

    // Offline reference must never yield officially_verified
    const offlineCheck = compareLeadAgainstOfficialRecord(crmLead, officialTesco, false);
    assert.equal(offlineCheck.state, 'offline_reference');

    // Probable match when no identifier exists yet
    const crmUnverified = makeLead({
      companyName: 'Nordic Tech Solutions',
      legalName: 'Nordic Tech Solutions',
      registrationNumber: undefined,
      address: { city: 'Oslo', postalCode: '0150', country: 'Norway', countryCode: 'NO' },
    });
    const officialProbable = makeLead({
      companyName: 'NORDIC TECH SOLUTIONS GROUP AS',
      legalName: 'NORDIC TECH SOLUTIONS GROUP AS',
      registrationNumber: '987654321',
      registrationType: 'NO_ORG',
      address: { city: 'Oslo', postalCode: '0150', country: 'Norway', countryCode: 'NO' },
      confidenceScore: 95,
    });
    const probable = compareLeadAgainstOfficialRecord(crmUnverified, officialProbable, true);
    assert.equal(probable.state, 'probable_match');
    assert.equal(probable.matchType, 'probable_name_address');
    assert.ok(computeLegalNameSimilarity('Nordic Tech AS', 'Nordic Tech Limited') === 1);
  });

  it('runs verifyLeadWithOfficialRegistry + applyOfficialVerificationToLead while preserving CRM state', async () => {
    const registry = new ConnectorRegistry();
    registry.register(new FrSireneConnector());
    registry.register(new JpNtaConnector());
    const engine = new ConnectorExecutionEngine();

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          total_results: 1,
          total_pages: 1,
          results: [
            {
              siren: '552081317',
              nom_complet: 'ELECTRICITE DE FRANCE',
              nom_raison_sociale: 'ELECTRICITE DE FRANCE',
              etat_administratif: 'A',
              activite_principale: '35.11Z',
              siege: {
                siret: '55208131766522',
                adresse: '22 AVENUE DE WAGRAM',
                code_postal: '75008',
                libelle_commune: 'PARIS 8',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    const crmFrLead = makeLead({
      id: 'crm-fr-1',
      companyName: 'EDF France',
      legalName: 'EDF France',
      registrationNumber: '552081317',
      registrationType: 'FR_SIREN',
      status: 'negotiation',
      pipelineStageId: 'stage-custom-4',
      opportunityValue: 120000,
      currency: 'EUR',
      address: {
        city: 'Paris',
        postalCode: '75008',
        country: 'France',
        countryCode: 'FR',
      },
    });

    const report = await verifyLeadWithOfficialRegistry(crmFrLead, { registry, executionEngine: engine });
    assert.equal(report.state, 'officially_verified');
    assert.equal(report.isLiveApi, true);
    assert.equal(report.connectorId, 'conn-fr-sirene');

    const updated = applyOfficialVerificationToLead(crmFrLead, report);
    assert.equal(updated.legalName, 'ELECTRICITE DE FRANCE');
    assert.equal(updated.companyStatus, 'active');
    assert.equal(updated.pipelineStageId, 'stage-custom-4');
    assert.equal(updated.status, 'negotiation');
    assert.equal(updated.opportunityValue, 120000);
    assert.equal(updated.notes.length, 1);
    assert.equal(updated.customFields?.lastRegistryState, 'officially_verified');
    assert.ok(updated.customFields?.lastVerifiedAt);
    const history = JSON.parse(updated.customFields?.verificationHistory || '[]');
    assert.equal(history.length, 1);

    // Unavailable registry (Germany Handelsregister) never fabricates records
    const crmDeLead = makeLead({
      id: 'crm-de-1',
      companyName: 'Siemens AG',
      address: { country: 'Germany', countryCode: 'DE' },
    });
    const deReport = await verifyLeadWithOfficialRegistry(crmDeLead, { registry, executionEngine: engine });
    assert.equal(deReport.state, 'unavailable');
    assert.equal(deReport.isLiveApi, false);
    assert.equal(deReport.matchedRecord, undefined);
  });

  it('enforces higher-trust protection: lower-trust OSM/web data never overwrites verified legal identity', () => {
    const verifiedLead = makeLead({
      id: 'verified-no-1',
      companyName: 'EQUINOR ASA',
      legalName: 'EQUINOR ASA',
      registrationNumber: '923609016',
      registrationType: 'NO_ORG',
      companyStatus: 'active',
      confidenceScore: 95,
      status: 'meeting_set',
      pipelineStageId: 'stage-3',
      identifiers: [
        {
          type: 'NO_ORG',
          value: '923609016',
          normalizedValue: '923609016',
          countryCode: 'NO',
          status: 'officially_verified',
          verified: true,
        },
      ],
      sources: [
        {
          sourceName: 'Brønnøysundregistrene (Brreg)',
          providerId: '923609016',
          retrievedAt: new Date().toISOString(),
        },
      ],
    });

    const lowTrustOsmLead = makeLead({
      id: 'osm-no-1',
      companyName: 'Equinor Gas Station',
      legalName: 'Equinor Gas Station Local',
      registrationNumber: 'WRONG-999',
      registrationType: 'NO_ORG',
      companyStatus: 'unknown',
      confidenceScore: 42,
      website: 'https://equinor.com',
      sources: [
        {
          sourceName: 'OpenStreetMap Nominatim',
          providerId: 'node/999',
          retrievedAt: new Date().toISOString(),
        },
      ],
      identifiers: [],
    });

    assert.equal(inferLeadTrustRank(verifiedLead), 5);
    assert.equal(inferLeadTrustRank(lowTrustOsmLead), 2);

    const merged = mergeLeadWithTrustHierarchy(verifiedLead, lowTrustOsmLead);
    // Protected verified legal identity preserved!
    assert.equal(merged.legalName, 'EQUINOR ASA');
    assert.equal(merged.companyName, 'EQUINOR ASA');
    assert.equal(merged.registrationNumber, '923609016');
    assert.equal(merged.companyStatus, 'active');
    assert.equal(merged.status, 'meeting_set');
    assert.equal(merged.pipelineStageId, 'stage-3');
    // Additive contact enrichment allowed when missing, plus provenance preserved
    assert.equal(merged.website, 'https://equinor.com');
    assert.equal(merged.sources.length, 2);
  });

  it('detectDuplicates matches normalized UK_CRN and US_CIK identifiers across formatting differences', () => {
    const leadA = makeLead({
      id: 'dup-uk-1',
      companyName: 'Tesco',
      registrationNumber: '445790',
      registrationType: 'UK_CRN',
      address: { country: 'United Kingdom', countryCode: 'GB' },
    });
    const leadB = makeLead({
      id: 'dup-uk-2',
      companyName: 'TESCO PLC',
      registrationNumber: '00445790',
      registrationType: 'UK_CRN',
      confidenceScore: 95,
      address: { country: 'United Kingdom', countryCode: 'GB' },
    });

    const matches = detectDuplicates([leadA, leadB]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].matchType, 'registration_number');
    assert.equal(matches[0].recommendedSurvivorId, 'dup-uk-2');
  });
});

describe('Phase 6 — 10-Country Audit & 7-State Coverage Matrix', () => {
  it('documents all 10 required countries across all 8 official audit dimensions', () => {
    const requiredCountries = ['NO', 'GB', 'AU', 'US', 'DE', 'FR', 'CA', 'JP', 'IN', 'SG'];
    for (const code of requiredCountries) {
      const entry = TEN_COUNTRY_REGISTRY_AUDIT[code];
      assert.ok(entry, `Missing registry audit for ${code}`);
      assert.ok(entry.authorityName.length > 3);
      assert.equal(typeof entry.auditDetails.officialApiExists, 'boolean');
      assert.equal(typeof entry.auditDetails.publicAccessPermitted, 'boolean');
      assert.ok(entry.auditDetails.authenticationAndCredentials.length > 5);
      assert.ok(entry.auditDetails.documentationUrl.startsWith('http'));
      assert.ok(entry.auditDetails.accessRestrictions.length > 5);
      assert.ok(entry.auditDetails.availableBusinessFields.length >= 3);
      assert.ok(entry.auditDetails.searchAndVerificationCapabilities.length >= 2);
      assert.ok(entry.auditDetails.rateLimitsAndPagination.length > 5);
      assert.ok(entry.auditDetails.commercialUseAndRedistribution.length > 5);
    }
  });

  it('maps country coverage accurately across all 7 required states and never fabricates lastVerifiedAt', () => {
    const mockConnectors: ConnectorStatus[] = [
      {
        id: 'conn-brreg',
        name: 'Brreg',
        category: 'government_registry',
        accessMode: 'live_api',
        countryCoverage: ['NO'],
        status: 'healthy',
        healthState: 'operational',
        operational: true,
        authType: 'none_open',
        isConfigured: true,
        rateLimitNote: 'Open',
        attribution: 'Brreg',
        totalCalls: 4,
        lastSuccessAt: '2026-11-10T10:00:00.000Z',
      },
      {
        id: 'conn-companies-house',
        name: 'Companies House',
        category: 'government_registry',
        accessMode: 'live_api',
        countryCoverage: ['GB'],
        status: 'unconfigured',
        healthState: 'authentication_required',
        operational: false,
        authType: 'api_key',
        isConfigured: false,
        rateLimitNote: 'Key required',
        attribution: 'CH',
        totalCalls: 0,
      },
      {
        id: 'conn-abn',
        name: 'ABR',
        category: 'government_registry',
        accessMode: 'offline_reference',
        countryCoverage: ['AU'],
        status: 'unconfigured',
        healthState: 'authentication_required',
        operational: false,
        authType: 'api_key',
        isConfigured: false,
        rateLimitNote: 'GUID required',
        attribution: 'ABR',
        totalCalls: 0,
      },
      {
        id: 'conn-fr-sirene',
        name: 'France SIRENE',
        category: 'government_registry',
        accessMode: 'live_api',
        countryCoverage: ['FR'],
        status: 'rate_limited',
        healthState: 'temporarily_unavailable',
        operational: false,
        authType: 'none_open',
        isConfigured: true,
        rateLimitNote: 'Open',
        attribution: 'INSEE',
        totalCalls: 1,
      },
      {
        id: 'conn-sg-acra',
        name: 'SG ACRA',
        category: 'government_registry',
        accessMode: 'live_api',
        countryCoverage: ['SG'],
        status: 'unconfigured',
        healthState: 'configuration_required',
        operational: false,
        authType: 'none_open',
        isConfigured: false,
        rateLimitNote: 'Disabled',
        attribution: 'ACRA',
        totalCalls: 0,
      },
    ];

    const matrix = buildCountryCapabilityMatrix(mockConnectors);
    const byCountry = new Map(matrix.map((m) => [m.countryCode, m]));

    // Check genuine lastVerifiedAt behavior
    assert.equal(byCountry.get('NO')?.registryState, 'live_and_operational');
    assert.equal(byCountry.get('NO')?.lastVerifiedAt, '2026-11-10T10:00:00.000Z');
    assert.equal(byCountry.get('GB')?.registryState, 'live_auth_required');
    assert.equal(byCountry.get('GB')?.lastVerifiedAt, undefined);
    assert.equal(byCountry.get('FR')?.registryState, 'temporarily_unavailable');
    assert.equal(byCountry.get('SG')?.registryState, 'configuration_required');
    assert.equal(byCountry.get('DE')?.registryState, 'public_access_unavailable');
    assert.equal(byCountry.get('CA')?.registryState, 'not_implemented');

    // Offline reference countries present in sovereign matrix
    const offlineStateCheck = resolveSevenStateRegistryStatus(
      { ...TEN_COUNTRY_REGISTRY_AUDIT.AU },
      { ...mockConnectors[2], healthState: 'not_tested', operational: false }
    );
    assert.equal(offlineStateCheck, 'offline_reference_only');

    const observedStates = new Set<SevenStateRegistryStatus>(
      matrix.map((m) => m.registryState).filter((s): s is SevenStateRegistryStatus => Boolean(s))
    );
    observedStates.add(offlineStateCheck);
    for (const s of [
      'live_and_operational',
      'live_auth_required',
      'configuration_required',
      'offline_reference_only',
      'public_access_unavailable',
      'not_implemented',
      'temporarily_unavailable',
    ] as SevenStateRegistryStatus[]) {
      assert.ok(observedStates.has(s), `Expected 7-state model to cover ${s}`);
    }
  });
});
