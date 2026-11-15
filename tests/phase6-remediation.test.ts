import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeLegalCompanyStatus, normalizeConnectorResult } from '../server/connectors/core/normalizer.ts';
import { ConnectorError } from '../server/connectors/core/errors.ts';
import { ConnectorRegistry } from '../server/connectors/core/registry.ts';
import { ConnectorExecutionEngine } from '../server/connectors/core/executionEngine.ts';
import { ConnectorExecutionContext } from '../server/connectors/core/types.ts';
import { BrregConnector } from '../server/connectors/adapters/brregAdapter.ts';
import { SgAcraConnector } from '../server/connectors/adapters/sgAcraAdapter.ts';
import { UsSecEdgarConnector } from '../server/connectors/adapters/usSecEdgarAdapter.ts';
import { FrSireneConnector } from '../server/connectors/adapters/frSireneAdapter.ts';
import {
  compareLeadAgainstOfficialRecord,
  verifyLeadWithOfficialRegistry,
  applyOfficialVerificationToLead,
} from '../server/verification/registryVerificationService.ts';
import { CanonicalLead } from '../server/types.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeContext(overrides: Partial<ConnectorExecutionContext> = {}): ConnectorExecutionContext {
  const controller = new AbortController();
  return {
    requestId: 'req-remediation-test',
    userAgent: 'LEED-Phase6-Remediation-Test/1.0 (test@leed-pipeline.local)',
    credentials: {},
    credentialSource: 'none',
    config: { connectorId: 'test', enabled: true },
    timeoutMs: 5000,
    signal: controller.signal,
    ...overrides,
  };
}

function makeLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = new Date().toISOString();
  return {
    id: 'lead-rem-1',
    companyName: 'RENAULT',
    legalName: 'RENAULT',
    industry: 'Automotive',
    category: 'Enterprise',
    confidenceScore: 55,
    confidenceSignals: ['Imported CRM record'],
    sources: [
      {
        sourceName: 'Manual Import',
        retrievedAt: now,
      },
    ],
    identifiers: [],
    status: 'new',
    currency: 'EUR',
    tags: [],
    notes: [],
    activities: [],
    createdAt: now,
    updatedAt: now,
    address: {
      city: 'Boulogne-Billancourt',
      postalCode: '92100',
      country: 'France',
      countryCode: 'FR',
    },
    ...overrides,
  };
}

describe('Phase 6 Final Remediation — Isolated Regression Suite', () => {
  it('1. Active Brreg entity normalizes to active and incomplete records stay unknown', () => {
    const brreg = new BrregConnector();
    const now = new Date().toISOString();

    const activeRecord = brreg.normalizeResult(
      {
        organisasjonsnummer: '923609016',
        navn: 'EQUINOR ASA',
        organisasjonsform: { kode: 'ASA', beskrivelse: 'Allmennaksjeselskap' },
        registreringsdatoEnhetsregisteret: '1972-09-18',
        konkurs: false,
        underAvvikling: false,
        underTvangsavviklingEllerTvangsopplosning: false,
        forretningsadresse: {
          adresse: ['Forusbeen 50'],
          postnummer: '4035',
          poststed: 'STAVANGER',
          landkode: 'NO',
          land: 'Norway',
        },
      },
      now
    );

    assert.ok(activeRecord);
    assert.equal(activeRecord.company.companyStatus, 'active');
    assert.equal(activeRecord.providerMetadata.konkurs, false);
    assert.equal(activeRecord.providerMetadata.underAvvikling, false);
    assert.match(String(activeRecord.providerMetadata.rawRegistryStatus), /aktiv/i);
    assert.ok(activeRecord.providerMetadata.rawApiRecord);

    // Must NOT infer active solely from absence of one negative flag when source record is incomplete
    const partialOnlyKonkurs = brreg.normalizeResult(
      {
        organisasjonsnummer: '912345678',
        navn: 'PARTIAL RECORD AS',
        konkurs: false,
      },
      now
    );
    assert.equal(partialOnlyKonkurs?.company.companyStatus, 'unknown');
    assert.equal(partialOnlyKonkurs?.providerMetadata.konkurs, false);
    assert.equal(partialOnlyKonkurs?.providerMetadata.underAvvikling, undefined);

    const noFlagsAtAll = brreg.normalizeResult(
      {
        organisasjonsnummer: '912345679',
        navn: 'NO FLAGS AS',
      },
      now
    );
    assert.equal(noFlagsAtAll?.company.companyStatus, 'unknown');
    assert.equal(noFlagsAtAll?.providerMetadata.rawRegistryStatus, 'incomplete_status_flags');
  });

  it('2. Dissolved or bankrupt Brreg entity recognizes bankruptcy, liquidation, deletion, and forced dissolution', () => {
    const brreg = new BrregConnector();
    const now = new Date().toISOString();

    const bankrupt = brreg.normalizeResult(
      {
        organisasjonsnummer: '999000111',
        navn: 'NORDIC KONKURS AS',
        konkurs: true,
        underAvvikling: false,
      },
      now
    );
    assert.equal(bankrupt?.company.companyStatus, 'dissolved');
    assert.match(String(bankrupt?.providerMetadata.rawRegistryStatus), /konkurs=true/);

    const liquidating = brreg.normalizeResult(
      {
        organisasjonsnummer: '999000222',
        navn: 'NORDIC AVVIKLING AS',
        konkurs: false,
        underAvvikling: true,
      },
      now
    );
    assert.equal(liquidating?.company.companyStatus, 'dissolved');
    assert.match(String(liquidating?.providerMetadata.rawRegistryStatus), /underAvvikling=true/);

    const forcedDissolution = brreg.normalizeResult(
      {
        organisasjonsnummer: '999000333',
        navn: 'NORDIC TVANGSOPPLOSNING AS',
        konkurs: false,
        underAvvikling: false,
        underTvangsavviklingEllerTvangsopplosning: true,
      },
      now
    );
    assert.equal(forcedDissolution?.company.companyStatus, 'dissolved');
    assert.match(
      String(forcedDissolution?.providerMetadata.rawRegistryStatus),
      /underTvangsavviklingEllerTvangsopplosning=true/
    );

    const deleted = brreg.normalizeResult(
      {
        organisasjonsnummer: '999000444',
        navn: 'NORDIC SLETTET AS',
        slettedato: '2025-02-10',
        slettegrunn: 'Slettet',
      },
      now
    );
    assert.equal(deleted?.company.companyStatus, 'dissolved');
    assert.match(String(deleted?.providerMetadata.rawRegistryStatus), /slettedato=2025-02-10/);
  });

  it('3. Singapore Deregistered status normalizes to dissolved (not active) and preserves raw label', () => {
    assert.equal(normalizeLegalCompanyStatus('Deregistered'), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus('De-registered'), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus('Struck Off'), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus('Struck-off'), 'dissolved');
    assert.equal(normalizeLegalCompanyStatus('Inactive'), 'inactive');
    assert.equal(normalizeLegalCompanyStatus('Unregistered'), 'inactive');

    const sg = new SgAcraConnector();
    const norm = sg.normalizeResult(
      {
        uen: '201201936C',
        entity_name: 'FORMER SINGAPORE CO PTE. LTD.',
        uen_status_desc: 'Deregistered',
      },
      new Date().toISOString()
    );
    assert.ok(norm);
    assert.equal(norm.company.companyStatus, 'dissolved');
    assert.equal(norm.providerMetadata.uenStatusLabel, 'Deregistered');
    assert.equal(norm.providerMetadata.rawRegistryStatus, 'Deregistered');
  });

  it('4. Singapore Registered and Live entities normalize to active and preserve raw ACRA label', () => {
    assert.equal(normalizeLegalCompanyStatus('Registered'), 'active');
    assert.equal(normalizeLegalCompanyStatus('Live'), 'active');
    assert.equal(normalizeLegalCompanyStatus('Live Company'), 'active');

    const sg = new SgAcraConnector();
    const regNorm = sg.normalizeResult(
      {
        uen: '201201936C',
        entity_name: 'MARINA TECH PTE. LTD.',
        uen_status_desc: 'Registered',
      },
      new Date().toISOString()
    );
    assert.equal(regNorm?.company.companyStatus, 'active');
    assert.equal(regNorm?.providerMetadata.uenStatusLabel, 'Registered');

    const liveNorm = sg.normalizeResult(
      {
        uen: '53012345A',
        entity_name: 'LION CITY TRADING',
        entity_status_description: 'Live',
      },
      new Date().toISOString()
    );
    assert.equal(liveNorm?.company.companyStatus, 'active');
    assert.equal(liveNorm?.providerMetadata.uenStatusLabel, 'Live');
  });

  it('5. Apple Inc. remains active or unknown (never inactive) despite Form 25 / 25-NSE filings and distinguishes US_CIK vs US_EIN', async () => {
    const sec = new UsSecEdgarConnector();
    const now = new Date().toISOString();

    const appleWithForm25 = sec.normalizeResult(
      {
        cik: '0000320193',
        entityType: 'operating',
        sic: '3571',
        sicDescription: 'Electronic Computers',
        name: 'Apple Inc.',
        tickers: ['AAPL'],
        exchanges: ['Nasdaq'],
        ein: '942404110',
        stateOfIncorporation: 'CA',
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
            form: ['25-NSE', '25', '8-K', '10-K'],
            filingDate: ['2026-08-15', '2026-08-14', '2026-08-01', '2025-11-01'],
          },
        },
      },
      now
    );

    assert.ok(appleWithForm25);
    assert.notEqual(appleWithForm25.company.companyStatus, 'inactive');
    assert.notEqual(appleWithForm25.company.companyStatus, 'dissolved');
    assert.ok(
      appleWithForm25.company.companyStatus === 'active' ||
        appleWithForm25.company.companyStatus === 'unknown'
    );
    assert.equal(appleWithForm25.company.registrationType, 'US_CIK');
    assert.equal(appleWithForm25.company.registrationNumber, '0000320193');
    assert.ok(
      appleWithForm25.company.identifiers?.some(
        (i) => i.type === 'US_CIK' && i.value === '0000320193'
      )
    );
    assert.ok(
      appleWithForm25.company.identifiers?.some(
        (i) => i.type === 'US_EIN' && i.value === '942404110'
      )
    );

    // Universal EIN search must NOT be misrepresented as CIK lookup
    assert.deepEqual(sec.getMetadata().supportedIdentifierTypes, ['US_CIK']);
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    };
    const einSearch = await sec.search({ query: '94-2404110', countryCode: 'US' }, makeContext());
    assert.equal(fetchCalled, false);
    assert.equal(einSearch.results.length, 0);
    assert.ok(einSearch.notes.some((n) => n.includes('US_EIN')));
  });

  it('6. SEC filing codes cannot independently establish issuer legal status', () => {
    const sec = new UsSecEdgarConnector();
    const now = new Date().toISOString();

    const delistingOnly = sec.normalizeResult(
      {
        cik: '0001234567',
        name: 'FILING ONLY CORP',
        filings: {
          recent: {
            form: ['25', '25-NSE', '15-12G', 'RW'],
            filingDate: ['2026-01-10', '2026-01-09', '2026-01-05', '2026-01-02'],
          },
        },
      },
      now
    );
    assert.equal(delistingOnly?.company.companyStatus, 'unknown');

    const tenKOnly = sec.normalizeResult(
      {
        cik: '0001234568',
        name: 'PERIODIC FILER CORP',
        filings: {
          recent: {
            form: ['10-K', '10-Q'],
            filingDate: ['2026-02-01', '2025-11-01'],
          },
        },
      },
      now
    );
    assert.equal(tenKOnly?.company.companyStatus, 'unknown');

    const tickerRowFallback = sec.normalizeResult(
      {
        cik_str: 320193,
        ticker: 'AAPL',
        title: 'Apple Inc.',
      },
      now
    );
    assert.equal(tickerRowFallback?.company.companyStatus, 'unknown');
  });

  it('7. Singapore pagination remains distinct, deduplicated, and refuses silent partial completion', async () => {
    const sg = new SgAcraConnector();
    const seenUrls: string[] = [];

    globalThis.fetch = async (input) => {
      const urlStr = String(input);
      seenUrls.push(urlStr);
      const u = new URL(urlStr);
      const offset = Number(u.searchParams.get('offset') || '0');
      if (offset === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              total: 4,
              fields: [{ id: 'uen' }, { id: 'entity_name' }, { id: 'uen_status_desc' }],
              records: [
                { uen: '201201936C', entity_name: 'ALPHA SG PTE. LTD.', uen_status_desc: 'Registered' },
                { uen: '201201936C', entity_name: 'ALPHA SG PTE. LTD.', uen_status_desc: 'Registered' }, // duplicate
                { uen: '201301936D', entity_name: 'BETA SG PTE. LTD.', uen_status_desc: 'Registered' },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 4,
            records: [
              { uen: '201401936E', entity_name: 'GAMMA SG PTE. LTD.', uen_status_desc: 'Registered' },
              { uen: '201501936F', entity_name: 'DELTA SG PTE. LTD.', uen_status_desc: 'Deregistered' },
            ],
          },
        }),
        { status: 200 }
      );
    };

    const page1 = await sg.search({ query: 'SG', countryCode: 'SG', page: 1, pageSize: 2 }, makeContext());
    const page2 = await sg.search({ query: 'SG', countryCode: 'SG', page: 2, pageSize: 2 }, makeContext());

    assert.equal(seenUrls.length, 2);
    assert.equal(page1.pagination.page, 1);
    assert.equal(page1.pagination.hasMore, true);
    assert.equal(page1.results.length, 2); // deduplicated within page
    assert.deepEqual(
      page1.results.map((r) => r.externalSourceId),
      ['201201936C', '201301936D']
    );

    assert.equal(page2.pagination.page, 2);
    assert.equal(page2.results.length, 2);
    assert.deepEqual(
      page2.results.map((r) => r.externalSourceId),
      ['201401936E', '201501936F']
    );
    assert.equal(page2.results[1].company.companyStatus, 'dissolved');

    // Selective UEN search must NOT send full-text `q`
    globalThis.fetch = async (input) => {
      seenUrls.push(String(input));
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 1,
            records: [{ uen: '201900001A', entity_name: 'INDEXED CO PTE LTD', uen_status_desc: 'Live' }],
          },
        }),
        { status: 200 }
      );
    };
    await sg.search({ query: '201900001A', countryCode: 'SG' }, makeContext());
    const uenUrl = new URL(seenUrls[seenUrls.length - 1]);
    assert.equal(uenUrl.searchParams.get('q'), null);
    assert.equal(uenUrl.searchParams.get('filters'), JSON.stringify({ uen: '201900001A' }));

    // Refuse silent partial results when upstream reports success:false or empty records despite nonzero total
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, error: { message: 'datastore timeout' } }), { status: 200 });
    await assert.rejects(
      () => sg.search({ query: 'FAIL TEST', countryCode: 'SG' }, makeContext()),
      (err: any) => err instanceof ConnectorError && err.category === 'provider_unavailable'
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: true, result: { total: 50, records: [] } }), { status: 200 });
    await assert.rejects(
      () => sg.search({ query: 'TRUNCATED TEST', countryCode: 'SG', page: 1, pageSize: 10 }, makeContext()),
      (err: any) => err instanceof ConnectorError && err.category === 'invalid_response'
    );
  });

  it('8. Singapore timeout, cache expiration, metadata cache, and concurrent deduplication work reliably', async () => {
    // (a) Short TTL cache + expiration + dataset metadata cache + concurrent request dedupe
    const sg = new SgAcraConnector({
      searchCacheTtlMs: 40,
      metadataCacheTtlMs: 500,
    });

    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      await new Promise((r) => setTimeout(r, 15));
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 1,
            fields: [
              { id: 'uen', type: 'text' },
              { id: 'entity_name', type: 'text' },
              { id: 'uen_status_desc', type: 'text' },
            ],
            records: [
              { uen: '201201936C', entity_name: 'MARINA TECH PTE. LTD.', uen_status_desc: 'Registered' },
            ],
          },
        }),
        { status: 200 }
      );
    };

    // Concurrent identical searches must coalesce into 1 upstream fetch
    const [r1, r2] = await Promise.all([
      sg.search({ query: 'Marina Tech', countryCode: 'SG' }, makeContext()),
      sg.search({ query: 'Marina Tech', countryCode: 'SG' }, makeContext()),
    ]);
    assert.equal(fetchCount, 1);
    assert.equal(r1.results.length, 1);
    assert.equal(r2.results.length, 1);
    assert.equal(r2.providerMetadata?.deduped, true);
    assert.ok(typeof r1.providerMetadata?.latencyMs === 'number');
    assert.ok(sg.getDatasetMetadata()?.fields.includes('uen'));

    // Immediate repeat hits cache without another fetch
    const r3 = await sg.search({ query: 'Marina Tech', countryCode: 'SG' }, makeContext());
    assert.equal(fetchCount, 1);
    assert.equal(r3.providerMetadata?.cacheHit, true);

    // After TTL expiration, re-fetches cleanly
    await new Promise((r) => setTimeout(r, 55));
    const r4 = await sg.search({ query: 'Marina Tech', countryCode: 'SG' }, makeContext());
    assert.equal(fetchCount, 2);
    assert.equal(r4.providerMetadata?.cacheHit, false);

    // (b) Timeout enforcement & metrics recording
    const sgTimeout = new SgAcraConnector({ defaultTimeoutMs: 30 });
    globalThis.fetch = async () =>
      new Promise((resolve) => setTimeout(() => resolve(new Response('{}', { status: 200 })), 300));

    await assert.rejects(
      () => sgTimeout.search({ query: 'Slow Query', countryCode: 'SG' }, makeContext({ timeoutMs: 30 })),
      (err: any) => err instanceof ConnectorError && err.category === 'timeout'
    );
    const metrics = sgTimeout.getRuntimeMetrics();
    assert.equal(metrics.timeoutCount, 1);
    assert.ok(metrics.lastTimeoutAt);
    assert.ok((metrics.lastLatencyMs ?? 0) >= 25);
  });

  it('9. France Renault SIREN exact identity matching prioritizes official SIREN 780129987 over 982770919 and preserves provenance', async () => {
    const registry = new ConnectorRegistry();
    registry.register(new FrSireneConnector());
    const engine = new ConnectorExecutionEngine();

    const renaultSasApiRecord = {
      siren: '780129987',
      nom_complet: 'RENAULT SAS',
      nom_raison_sociale: 'RENAULT SAS',
      etat_administratif: 'A',
      activite_principale: '29.10Z',
      nature_juridique: '5710',
      siege: {
        siret: '78012998703591',
        adresse: '122 AVENUE DU GENERAL LECLERC',
        code_postal: '92100',
        libelle_commune: 'BOULOGNE-BILLANCOURT',
      },
    };
    const unrelatedRenaultRecord = {
      siren: '982770919',
      nom_complet: 'RENAULT',
      nom_raison_sociale: 'RENAULT',
      etat_administratif: 'A',
      activite_principale: '45.11Z',
      siege: {
        siret: '98277091900010',
        adresse: '1 RUE EXEMPLE',
        code_postal: '69001',
        libelle_commune: 'LYON',
      },
    };

    const queriesSeen: string[] = [];
    globalThis.fetch = async (input) => {
      const urlStr = String(input);
      queriesSeen.push(urlStr);
      // Even if API returns the namesake 982770919 first, exact SIREN lookup finds 780129987
      return new Response(
        JSON.stringify({
          total_results: 2,
          total_pages: 1,
          results: [unrelatedRenaultRecord, renaultSasApiRecord],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const crmRenaultLead = makeLead({
      id: 'fr-renault-sas',
      companyName: 'Renault',
      legalName: 'Renault SAS',
      registrationNumber: '780129987',
      registrationType: 'FR_SIREN',
      address: {
        city: 'Boulogne-Billancourt',
        postalCode: '92100',
        country: 'France',
        countryCode: 'FR',
      },
    });

    const report = await verifyLeadWithOfficialRegistry(crmRenaultLead, {
      registry,
      executionEngine: engine,
    });

    assert.ok(queriesSeen[0].includes('780129987'));
    assert.equal(report.state, 'officially_verified');
    assert.equal(report.matchType, 'exact_official_identifier');
    assert.equal(report.identifierMatched, true);
    assert.equal(report.matchedRecord?.registrationNumber, '780129987');
    assert.equal(report.matchedRecord?.legalName, 'RENAULT SAS');
    assert.equal(report.provenance?.queryMode, 'exact_identifier_lookup');
    assert.equal(report.provenance?.queriedIdentifier, '780129987');
    assert.deepEqual(report.provenance?.rawApiRecord, renaultSasApiRecord);

    // Direct SIREN search on FrSireneConnector must filter out non-matching SIRENs
    const fr = new FrSireneConnector();
    const sirenSearch = await fr.search({ query: '780129987', countryCode: 'FR' }, makeContext());
    assert.equal(sirenSearch.results.length, 1);
    assert.equal(sirenSearch.results[0].company.registrationNumber, '780129987');
    assert.deepEqual(sirenSearch.results[0].providerMetadata.rawApiRecord, renaultSasApiRecord);
  });

  it('10. Similar company names cannot override conflicting official identifiers or claim exact verification', async () => {
    const registry = new ConnectorRegistry();
    registry.register(new FrSireneConnector());
    const engine = new ConnectorExecutionEngine();

    // Case A: Lead has official SIREN 780129987, but name search only returns namesake RENAULT (982770919)
    globalThis.fetch = async (input) => {
      const urlStr = String(input);
      if (urlStr.includes('780129987')) {
        return new Response(JSON.stringify({ total_results: 0, total_pages: 0, results: [] }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          total_results: 1,
          total_pages: 1,
          results: [
            {
              siren: '982770919',
              nom_complet: 'RENAULT',
              nom_raison_sociale: 'RENAULT',
              etat_administratif: 'A',
              siege: {
                siret: '98277091900010',
                code_postal: '69001',
                libelle_commune: 'LYON',
              },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const crmRenaultWithSiren = makeLead({
      id: 'fr-renault-conflict',
      companyName: 'RENAULT',
      legalName: 'RENAULT SAS',
      registrationNumber: '780129987',
      registrationType: 'FR_SIREN',
      address: {
        country: 'France',
        countryCode: 'FR',
      },
      identifiers: [
        {
          type: 'FR_SIREN',
          value: '780129987',
          normalizedValue: '780129987',
          countryCode: 'FR',
          status: 'user_provided',
          verified: false,
        },
      ],
    });

    const conflictReport = await verifyLeadWithOfficialRegistry(crmRenaultWithSiren, {
      registry,
      executionEngine: engine,
    });
    assert.equal(conflictReport.state, 'conflict_detected');
    assert.equal(conflictReport.matchType, 'conflict');
    assert.equal(conflictReport.identifierMatched, false);
    assert.ok(
      conflictReport.conflicts.some(
        (c) =>
          c.field === 'registrationNumber' &&
          c.crmValue === '780129987' &&
          c.officialValue === '982770919'
      )
    );

    const afterConflictApply = applyOfficialVerificationToLead(crmRenaultWithSiren, conflictReport);
    assert.equal(afterConflictApply.registrationNumber, '780129987');

    // Case B: Lead has NO registration number yet ("RENAULT") and search returns namesake 982770919.
    // Even with 100% name similarity, it must stay probable_match and NEVER become officially_verified!
    const crmRenaultNameOnly = makeLead({
      id: 'fr-renault-name-only',
      companyName: 'RENAULT',
      legalName: 'RENAULT',
      registrationNumber: undefined,
      registrationType: undefined,
      identifiers: [],
      address: {
        city: 'Lyon',
        postalCode: '69001',
        country: 'France',
        countryCode: 'FR',
      },
    });

    const probableReport = await verifyLeadWithOfficialRegistry(crmRenaultNameOnly, {
      registry,
      executionEngine: engine,
    });
    assert.equal(probableReport.state, 'probable_match');
    assert.notEqual(probableReport.state, 'officially_verified');
    assert.equal(probableReport.identifierMatched, false);

    // Applying a probable_match must NOT attach 982770919 as the lead's verified registrationNumber
    const afterProbableApply = applyOfficialVerificationToLead(crmRenaultNameOnly, probableReport);
    assert.equal(afterProbableApply.registrationNumber, undefined);
    assert.equal(afterProbableApply.identifiers.length, 0);
    assert.equal(afterProbableApply.customFields?.lastRegistryState, 'probable_match');
    assert.equal(afterProbableApply.customFields?.probableMatchRegistrationNumber, '982770919');

    // Case C: compareLeadAgainstOfficialRecord catches conflicting identifiers even when only in identifiers[]
    const leadViaIdentArray = makeLead({
      registrationNumber: undefined,
      registrationType: undefined,
      identifiers: [
        {
          type: 'FR_SIREN',
          value: '780129987',
          normalizedValue: '780129987',
          countryCode: 'FR',
          status: 'user_provided',
          verified: false,
        },
      ],
    });
    const officialNamesake = normalizeConnectorResult(
      new FrSireneConnector().normalizeResult(
        {
          siren: '982770919',
          nom_complet: 'RENAULT',
          nom_raison_sociale: 'RENAULT',
          etat_administratif: 'A',
        },
        new Date().toISOString()
      )!
    ).lead!;

    const cmp = compareLeadAgainstOfficialRecord(leadViaIdentArray, officialNamesake, true);
    assert.equal(cmp.state, 'conflict_detected');
    assert.equal(cmp.matchType, 'conflict');
    assert.ok(cmp.conflicts.some((c) => c.field === 'registrationNumber'));
  });
});

describe('Phase 6 — Singapore ACRA Final Reliability Fix (HTTP 409 Regression)', () => {
  const CONFIRMED_NINE_FIELDS = [
    '_id',
    'uen',
    'issuance_agency_desc',
    'uen_status_desc',
    'entity_name',
    'entity_type_desc',
    'uen_issue_date',
    'reg_street_name',
    'reg_postal_code',
  ];

  const UNSUPPORTED_THIRTEEN_FIELDS = [
    'issuance_agency_id',
    'business_constitution_desc',
    'company_type_desc',
    'entity_status_description',
    'registration_incorporation_date',
    'block',
    'street_name',
    'level_no',
    'unit_no',
    'building_name',
    'postal_code',
    'primary_ssic_code',
    'primary_ssic_description',
  ];

  function assertNoUnsupportedFieldsInUrl(urlStr: string) {
    const u = new URL(urlStr);
    const fieldsParam = u.searchParams.get('fields') || '';
    const filtersParam = u.searchParams.get('filters') || '';
    const fieldTokens = fieldsParam ? fieldsParam.split(',').map((s) => s.trim()) : [];
    const filterKeys = filtersParam ? Object.keys(JSON.parse(filtersParam)) : [];

    for (const badField of UNSUPPORTED_THIRTEEN_FIELDS) {
      assert.equal(
        fieldTokens.includes(badField),
        false,
        `Request fields= must not include unsupported field "${badField}" (url=${urlStr})`
      );
      assert.equal(
        filterKeys.includes(badField),
        false,
        `Request filters= must not include unsupported field "${badField}" (url=${urlStr})`
      );
    }
  }

  it('1. Empty placeholder metadata ({}) and synthetic ranking fields do not overwrite a valid nine-field schema', async () => {
    const sg = new SgAcraConnector();
    let callIdx = 0;

    globalThis.fetch = async () => {
      callIdx += 1;
      if (callIdx === 1) {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              total: 2127089,
              fields: CONFIRMED_NINE_FIELDS.map((id) => ({ id, type: id === '_id' ? 'int4' : 'text' })),
              records: [],
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 2,
            fields: [
              { type: 'int4', id: '_id' },
              {},
              {},
              { type: 'int8', id: '_full_count' },
              { type: 'float4', id: 'rank' },
            ],
            records: [
              { uen: '198600294G', entity_name: 'DBS VICKERS SECURITIES PTE LTD', uen_status_desc: 'Registered' },
            ],
          },
        }),
        { status: 200 }
      );
    };

    const val = await sg.validateConnection(makeContext());
    assert.equal(val.ok, true);
    assert.deepEqual(sg.getDatasetMetadata()?.fields, CONFIRMED_NINE_FIELDS);

    const searchRes = await sg.search({ query: 'DBS', countryCode: 'SG' }, makeContext());
    assert.equal(searchRes.results.length, 1);
    assert.deepEqual(sg.getDatasetMetadata()?.fields, CONFIRMED_NINE_FIELDS);
  });

  it('2. Malformed metadata (non-array, strings, empty strings, missing id) does not overwrite the valid schema', async () => {
    const sg = new SgAcraConnector();
    let mode: 'valid' | 'empty_array' | 'malformed_string' | 'missing_ids' = 'valid';

    globalThis.fetch = async () => {
      const fieldsPayload =
        mode === 'valid'
          ? CONFIRMED_NINE_FIELDS.map((id) => ({ id, type: 'text' }))
          : mode === 'empty_array'
          ? []
          : mode === 'malformed_string'
          ? 'corrupted-schema'
          : [{ id: '' }, { id: '   ' }, { name: 'uen' }, null, 42];

      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 1,
            fields: fieldsPayload,
            records: [
              { uen: '198600294G', entity_name: 'DBS VICKERS SECURITIES PTE LTD', uen_status_desc: 'Registered' },
            ],
          },
        }),
        { status: 200 }
      );
    };

    await sg.validateConnection(makeContext());
    assert.deepEqual(sg.getDatasetMetadata()?.fields, CONFIRMED_NINE_FIELDS);

    for (const badMode of ['empty_array', 'malformed_string', 'missing_ids'] as const) {
      mode = badMode;
      await sg.search({ query: `DBS-${badMode}`, countryCode: 'SG' }, makeContext());
      assert.deepEqual(sg.getDatasetMetadata()?.fields, CONFIRMED_NINE_FIELDS);
    }
  });

  it('3 & 4 & 7. Search and Lookup both work without calling validateConnection() first and never request unsupported fields', async () => {
    const sgSearch = new SgAcraConnector();
    const sgLookup = new SgAcraConnector();
    const seenUrls: string[] = [];

    globalThis.fetch = async (input) => {
      const urlStr = String(input);
      seenUrls.push(urlStr);
      assertNoUnsupportedFieldsInUrl(urlStr);

      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 1,
            fields: [{}, {}],
            records: [
              {
                _id: 1,
                uen: '198600294G',
                issuance_agency_desc: 'ACRA',
                uen_status_desc: 'Registered',
                entity_name: 'DBS VICKERS SECURITIES (SINGAPORE) PTE LTD',
                entity_type_desc: 'Local Company',
                uen_issue_date: '2008-09-09',
                reg_street_name: 'MARINA BOULEVARD',
                reg_postal_code: '018982',
              },
            ],
          },
        }),
        { status: 200 }
      );
    };

    const sRes = await sgSearch.search({ query: 'DBS VICKERS', countryCode: 'SG' }, makeContext());
    assert.equal(sRes.results.length, 1);
    assert.equal(sRes.results[0].company.companyStatus, 'active');

    const lRes = await sgLookup.lookupById({ externalId: '198600294G', countryCode: 'SG' }, makeContext());
    assert.equal(lRes.found, true);
    assert.equal(lRes.result?.company.registrationNumber, '198600294G');

    assert.equal(seenUrls.length, 2);
    for (const urlStr of seenUrls) {
      const u = new URL(urlStr);
      assert.deepEqual(u.searchParams.get('fields')?.split(','), CONFIRMED_NINE_FIELDS);
    }
  });

  it('5 & 6 & Live-Repro. validateConnection -> {} projected search -> page 2 pagination and consecutive UEN lookups succeed cleanly', async () => {
    const sg = new SgAcraConnector();
    const seenUrls: string[] = [];

    globalThis.fetch = async (input) => {
      const urlStr = String(input);
      seenUrls.push(urlStr);
      assertNoUnsupportedFieldsInUrl(urlStr);

      const u = new URL(urlStr);
      const hasFieldsParam = u.searchParams.has('fields');
      const filtersRaw = u.searchParams.get('filters');
      const offset = Number(u.searchParams.get('offset') || '0');

      // Validate connection (no fields param) -> returns full 9-field schema
      if (!hasFieldsParam) {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              total: 2127089,
              fields: CONFIRMED_NINE_FIELDS.map((id) => ({ id, type: id === '_id' ? 'int4' : 'text' })),
              records: [{ uen: '198600294G', entity_name: 'DBS VICKERS', uen_status_desc: 'Registered' }],
            },
          }),
          { status: 200 }
        );
      }

      // When fields param is present, mimic live data.gov.sg returning `{}` placeholder objects!
      if (filtersRaw) {
        const parsed = JSON.parse(filtersRaw) as { uen?: string };
        if (parsed.uen === '198600294G') {
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                total: 1,
                fields: [{}, {}, {}],
                records: [
                  {
                    uen: '198600294G',
                    entity_name: 'DBS VICKERS SECURITIES (SINGAPORE) PTE LTD',
                    uen_status_desc: 'Registered',
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
        if (parsed.uen === '195800116D') {
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                total: 1,
                fields: [{}, {}, {}],
                records: [
                  {
                    uen: '195800116D',
                    entity_name: 'FAR EASTERN BANK LIMITED',
                    uen_status_desc: 'Deregistered',
                  },
                ],
              },
            }),
            { status: 200 }
          );
        }
      }

      if (offset === 0) {
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              total: 4,
              fields: [{}, {}, {}],
              records: [
                { uen: '200803195Z', entity_name: 'ALPHA ONE PTE LTD', uen_status_desc: 'Registered' },
                { uen: '201511638H', entity_name: 'BETA TWO PTE LTD', uen_status_desc: 'Registered' },
              ],
            },
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 4,
            fields: [{}, {}, {}],
            records: [
              { uen: '196800152R', entity_name: 'GAMMA THREE LTD', uen_status_desc: 'Deregistered' },
              { uen: '201333447D', entity_name: 'DELTA FOUR PTE LTD', uen_status_desc: 'Registered' },
            ],
          },
        }),
        { status: 200 }
      );
    };

    // Exact live sequence reproduction:
    // 1. validateConnection
    const val = await sg.validateConnection(makeContext());
    assert.equal(val.ok, true);
    assert.deepEqual(sg.getDatasetMetadata()?.fields, CONFIRMED_NINE_FIELDS);

    // 2. First projected search (returns `{}` field metadata) -> page 1
    const page1 = await sg.search({ query: 'SINGAPORE', countryCode: 'SG', page: 1, pageSize: 2 }, makeContext());
    assert.equal(page1.results.length, 2);
    assert.equal(page1.pagination.hasMore, true);
    assert.deepEqual(sg.getDatasetMetadata()?.fields, CONFIRMED_NINE_FIELDS);

    // 3. Second paginated search -> page 2 (must succeed without HTTP 409/unsupported fields)
    const page2 = await sg.search({ query: 'SINGAPORE', countryCode: 'SG', page: 2, pageSize: 2 }, makeContext());
    assert.equal(page2.results.length, 2);
    assert.deepEqual(
      page2.results.map((r) => r.externalSourceId),
      ['196800152R', '201333447D']
    );
    assert.equal(page2.results[0].company.companyStatus, 'dissolved');

    // 4. Consecutive lookups for two different UENs (registered + deregistered)
    const lookup1 = await sg.lookupById({ externalId: '198600294G', countryCode: 'SG' }, makeContext());
    const lookup2 = await sg.lookupById({ externalId: '195800116D', countryCode: 'SG' }, makeContext());
    assert.equal(lookup1.found, true);
    assert.equal(lookup1.result?.company.companyStatus, 'active');
    assert.equal(lookup2.found, true);
    assert.equal(lookup2.result?.company.companyStatus, 'dissolved');
    assert.equal(seenUrls.length, 5);
  });

  it('8. Indexed UEN and postal-code filtering continue to work without full-text q', async () => {
    const sg = new SgAcraConnector();
    const seenUrls: URL[] = [];

    globalThis.fetch = async (input) => {
      const u = new URL(String(input));
      seenUrls.push(u);
      assertNoUnsupportedFieldsInUrl(u.toString());
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 1,
            fields: [{}],
            records: [
              {
                uen: '201201936C',
                entity_name: 'MARINA TECH PTE. LTD.',
                uen_status_desc: 'Registered',
                reg_postal_code: '018956',
              },
            ],
          },
        }),
        { status: 200 }
      );
    };

    const uenRes = await sg.search({ query: '201201936C', countryCode: 'SG' }, makeContext());
    assert.equal(uenRes.results.length, 1);
    assert.equal(seenUrls[0].searchParams.get('q'), null);
    assert.equal(seenUrls[0].searchParams.get('filters'), JSON.stringify({ uen: '201201936C' }));

    const postRes = await sg.search({ query: '018956', countryCode: 'SG' }, makeContext());
    assert.equal(postRes.results.length, 1);
    assert.equal(seenUrls[1].searchParams.get('q'), null);
    assert.equal(seenUrls[1].searchParams.get('filters'), JSON.stringify({ reg_postal_code: '018956' }));
  });

  it('9. Unsupported SSIC and unconfirmed field filters are clearly reported rather than silently applied', async () => {
    const sg = new SgAcraConnector();
    const seenUrls: URL[] = [];

    globalThis.fetch = async (input) => {
      const u = new URL(String(input));
      seenUrls.push(u);
      assertNoUnsupportedFieldsInUrl(u.toString());
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            total: 1,
            fields: [{}],
            records: [
              {
                uen: '198600294G',
                entity_name: 'DBS VICKERS SECURITIES (SINGAPORE) PTE LTD',
                uen_status_desc: 'Registered',
              },
            ],
          },
        }),
        { status: 200 }
      );
    };

    // Case A: explicit unsupported filters + SSIC industry code
    const resA = await sg.search(
      {
        query: 'DBS',
        countryCode: 'SG',
        industry: '62011',
        filters: {
          primary_ssic_code: '62011',
          uen_status_desc: 'Registered',
        },
      },
      makeContext()
    );

    assert.equal(resA.results.length, 1);
    assert.deepEqual(seenUrls[0].searchParams.get('filters'), JSON.stringify({ uen_status_desc: 'Registered' }));
    assert.deepEqual(resA.providerMetadata?.appliedFilters, { uen_status_desc: 'Registered' });
    const unsupportedA = (resA.providerMetadata?.unsupportedFilters || []) as Array<{ field: string }>;
    assert.ok(unsupportedA.some((f) => f.field === 'primary_ssic_code'));
    assert.ok(resA.notes.some((n) => n.includes('primary_ssic_code')));

    // Case B: 5-digit SSIC code as main query must not emit primary_ssic_code filter
    const resB = await sg.search({ query: '62011', countryCode: 'SG' }, makeContext());
    assert.equal(seenUrls[1].searchParams.get('filters'), null);
    assert.equal(seenUrls[1].searchParams.get('q'), '62011');
    const unsupportedB = (resB.providerMetadata?.unsupportedFilters || []) as Array<{ field: string }>;
    assert.ok(unsupportedB.some((f) => f.field === 'primary_ssic_code'));
    assert.ok(resB.notes.some((n) => n.includes('primary_ssic_code')));
  });

  it('10. Genuine upstream HTTP errors (e.g. 409/503) and incomplete responses produce ConnectorError rather than false success', async () => {
    const sg = new SgAcraConnector();

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: false, error: { message: 'Invalid field' } }), {
        status: 409,
        statusText: 'Conflict',
      });
    await assert.rejects(
      () => sg.lookupById({ externalId: '198600294G', countryCode: 'SG' }, makeContext()),
      (err: any) => err instanceof ConnectorError && err.httpStatus === 409
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ success: true, result: { total: 25, records: [] } }), { status: 200 });
    await assert.rejects(
      () => sg.search({ query: 'DBS', countryCode: 'SG', page: 1, pageSize: 5 }, makeContext()),
      (err: any) => err instanceof ConnectorError && err.category === 'invalid_response'
    );
  });
});

