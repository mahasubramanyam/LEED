import {
  normalizePolishKrs,
  validatePolishKrs,
  validatePolishNip,
} from '../../identifiers/identifierEngine.js';
import { classifyConnectorError, ConnectorError } from '../core/errors.js';
import { normalizeLegalCompanyStatus } from '../core/normalizer.js';
import { executeRegistryJsonRequest } from '../core/registryHttp.js';
import { connectorRegistry } from '../core/registry.js';
import {
  ClassifiedConnectorError,
  ConnectionValidationResult,
  ConnectorExecutionContext,
  ConnectorHealthReport,
  ConnectorLookupRequest,
  ConnectorLookupResponse,
  ConnectorMetadata,
  ConnectorRuntimeState,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
  StandardizedConnectorResult,
} from '../core/types.js';

interface PlKrsResponse {
  odpis?: {
    rodzaj?: string;
    naglowekA?: {
      rejestr?: string;
      numerKRS?: string;
      dataRejestracjiWKRS?: string;
      czyPosiadaStatusOPP?: boolean;
    };
    dane?: {
      dzial1?: {
        danePodmiotu?: {
          formaPrawna?: string;
          nazwa?: string;
          identyfikatory?: { regon?: string; nip?: string };
        };
        siedzibaIAdres?: {
          siedziba?: { kraj?: string; miejscowosc?: string; gmina?: string; powiat?: string; wojewodztwo?: string };
          adres?: { ulica?: string; nrDomu?: string; nrLokalu?: string; miejscowosc?: string; kodPocztowy?: string; kraj?: string };
          adresStronyInternetowej?: string;
          adresPocztyElektronicznej?: string;
        };
      };
    };
  };
}

interface PlVatWhiteListResponse {
  result?: {
    subject?: {
      name?: string;
      nip?: string;
      statusVat?: string;
      regon?: string;
      krs?: string;
      workingAddress?: string;
      residenceAddress?: string;
      registrationLegalDate?: string;
    } | null;
    requestDateTime?: string;
    requestId?: string;
  };
}

const KRS_BASE = 'https://api-krs.ms.gov.pl/api/krs';
const MF_VAT_BASE = 'https://wl-api.mf.gov.pl/api/search/nip';

const PL_KRS_METADATA: ConnectorMetadata = {
  id: 'conn-pl-krs',
  name: 'Polish Ministry of Justice KRS & MF VAT Registry',
  shortName: 'Poland KRS/VAT',
  version: '1.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official Polish National Court Register (KRS Open API — api-krs.ms.gov.pl) & Ministry of Finance VAT White List (wl-api.mf.gov.pl) verifying entities by 10-digit KRS or 10-digit NIP.',
  supportedCountries: ['PL'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['PL_KRS', 'PL_NIP'],
  capabilities: ['registry_lookup', 'identifier_validation', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions: 'Open official Polish government APIs. No API key required. Supports exact 10-digit KRS or 10-digit NIP lookup.',
    obtainKeyUrl: 'https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000028860?rejestr=P&format=json',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 4000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: 'KRS open API (unauthenticated exact KRS lookup) + MF VAT White List (100 req/day)',
      waitOnLimit: false,
    },
    defaultPageSize: 1,
    maxPageSize: 1,
    dedupeWindowMs: 5000,
  },
  attribution: 'Ministry of Justice Poland (KRS) & Ministry of Finance (KAS)',
  license: 'Polish Public Sector Information Open Access',
  homepageUrl: 'https://ekrs.ms.gov.pl/',
};

export class PlKrsConnector implements IConnector {
  public readonly id = 'conn-pl-krs';

  constructor(private readonly fetchFnOverride?: typeof fetch) {}

  public getMetadata(): ConnectorMetadata {
    return PL_KRS_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const res = await executeRegistryJsonRequest<PlKrsResponse>({
        providerId: this.id,
        url: `${KRS_BASE}/OdpisAktualny/0000028860?rejestr=P&format=json`,
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        fetchFn: this.fetchFnOverride,
      });

      const ok = Boolean(res.data?.odpis?.naglowekA?.numerKRS);
      return {
        ok,
        healthState: ok ? 'operational' : 'degraded',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: ok
          ? `Connected to live Polish KRS Open API (probe KRS ${res.data?.odpis?.naglowekA?.numerKRS} verified).`
          : 'Polish KRS Open API responded without expected OdpisAktualny structure.',
        checkedAt,
        rateLimitRemaining: res.rateLimitRemaining,
      };
    } catch (err: unknown) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState:
          classified.category === 'rate_limited'
            ? 'rate_limited'
            : classified.category === 'timeout' || classified.category === 'network_failure' || classified.category === 'provider_unavailable'
            ? 'temporarily_unavailable'
            : 'degraded',
        latencyMs: 0,
        isLiveApi: true,
        errorCategory: classified.category,
        message: classified.safeMessage,
        checkedAt,
      };
    }
  }

  public async search(
    request: ConnectorSearchRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorSearchResponse> {
    const query = (request.query || '').trim();
    const digits = query.replace(/[^0-9]/g, '');

    if (digits.length === 10 && (validatePolishNip(digits) || validatePolishKrs(digits))) {
      const lookup = await this.lookupById({ externalId: digits, countryCode: 'PL' }, context);
      return {
        results: lookup.result ? [lookup.result] : [],
        pagination: {
          page: 1,
          pageSize: 1,
          totalItems: lookup.result ? 1 : 0,
          totalPages: 1,
          hasMore: false,
        },
        rawCount: lookup.result ? 1 : 0,
        attribution: PL_KRS_METADATA.attribution,
        notes: lookup.notes,
        isLiveApi: true,
      };
    }

    return {
      results: [],
      pagination: { page: 1, pageSize: 1, totalItems: 0, totalPages: 1, hasMore: false },
      rawCount: 0,
      attribution: PL_KRS_METADATA.attribution,
      notes: [
        'Polish Ministry of Justice KRS Open API strictly supports exact 10-digit KRS or 10-digit NIP lookup. Free-text company name search is not exposed on the public REST endpoint.',
      ],
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const cleanDigits = request.externalId.toUpperCase().replace(/^PL/, '').replace(/[^0-9]/g, '');
    const looksLikeKrs = /^0{2,}/.test(cleanDigits) || (cleanDigits.length > 0 && cleanDigits.length < 10);

    // If NIP checksum validates and it doesn't have KRS leading-zero pattern, try MF VAT White List first
    if (cleanDigits.length === 10 && validatePolishNip(cleanDigits) && !looksLikeKrs) {
      const today = new Date().toISOString().slice(0, 10);
      const vatRes = await executeRegistryJsonRequest<PlVatWhiteListResponse>({
        providerId: this.id,
        url: `${MF_VAT_BASE}/${cleanDigits}?date=${today}`,
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        allowNotFound: true,
        fetchFn: this.fetchFnOverride,
      });

      const subj = vatRes.data?.result?.subject;
      if (subj && subj.name) {
        // If MF returns KRS, also enrich or return directly
        const normalized = this.normalizeResult({ source: 'mf_vat', subject: subj }, new Date().toISOString());
        if (normalized) {
          return {
            found: true,
            result: normalized,
            attribution: PL_KRS_METADATA.attribution,
            notes: [`Verified Polish NIP ${cleanDigits} via Ministry of Finance VAT White List.`],
            isLiveApi: true,
          };
        }
      }
    }

    if (!validatePolishKrs(cleanDigits)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Provide a valid 10-digit Polish KRS number or 10-digit NIP.',
      });
    }

    const paddedKrs = normalizePolishKrs(cleanDigits);
    for (const rej of ['P', 'S'] as const) {
      const krsRes = await executeRegistryJsonRequest<PlKrsResponse>({
        providerId: this.id,
        url: `${KRS_BASE}/OdpisAktualny/${paddedKrs}?rejestr=${rej}&format=json`,
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        allowNotFound: true,
        fetchFn: this.fetchFnOverride,
      });

      if (!krsRes.notFound && krsRes.data?.odpis?.dane?.dzial1?.danePodmiotu?.nazwa) {
        const normalized = this.normalizeResult(
          { source: 'krs', odpis: krsRes.data.odpis },
          new Date().toISOString()
        );
        return {
          found: Boolean(normalized),
          result: normalized || undefined,
          attribution: PL_KRS_METADATA.attribution,
          notes: [`Verified Polish KRS ${paddedKrs} (Rejestr ${rej}) via Ministry of Justice KRS Open API.`],
          isLiveApi: true,
        };
      }
    }

    return {
      found: false,
      attribution: PL_KRS_METADATA.attribution,
      notes: [`No Polish entity found for KRS/NIP ${cleanDigits}.`],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const wrapper = raw as
      | { source?: 'krs'; odpis?: PlKrsResponse['odpis'] }
      | { source?: 'mf_vat'; subject?: NonNullable<PlVatWhiteListResponse['result']>['subject'] };

    if (!wrapper) return null;

    if ('subject' in wrapper && wrapper.subject) {
      const subj = wrapper.subject;
      if (!subj.name || !subj.nip) return null;
      const identifiers: Array<{ type: string; value: string; normalizedValue?: string; countryCode?: string; status?: 'officially_verified'; verified?: boolean }> = [
        { type: 'PL_NIP', value: subj.nip, normalizedValue: subj.nip, countryCode: 'PL', status: 'officially_verified', verified: true },
      ];
      if (subj.krs) {
        identifiers.push({
          type: 'PL_KRS',
          value: normalizePolishKrs(subj.krs),
          normalizedValue: normalizePolishKrs(subj.krs),
          countryCode: 'PL',
          status: 'officially_verified',
          verified: true,
        });
      }
      const active = subj.statusVat?.toLowerCase() === 'czynny';
      return {
        providerId: this.id,
        providerName: PL_KRS_METADATA.name,
        sourceCategory: 'government_registry',
        accessMode: 'live_api',
        countryCode: 'PL',
        externalSourceId: subj.krs || subj.nip,
        company: {
          companyName: subj.name.trim(),
          legalName: subj.name.trim(),
          registrationNumber: subj.krs ? normalizePolishKrs(subj.krs) : subj.nip,
          registrationType: subj.krs ? 'PL_KRS' : 'PL_NIP',
          companyStatus: active ? 'active' : normalizeLegalCompanyStatus(subj.statusVat),
          address: {
            street: subj.workingAddress || subj.residenceAddress,
            country: 'Poland',
            countryCode: 'PL',
          },
          identifiers,
          rawSource: {
            sourceName: PL_KRS_METADATA.name,
            providerId: subj.nip,
            url: 'https://wl-api.mf.gov.pl/',
            retrievedAt,
            license: PL_KRS_METADATA.license,
            attribution: PL_KRS_METADATA.attribution,
          },
        },
        sourceUrl: 'https://wl-api.mf.gov.pl/',
        retrievedAt,
        verificationStatus: 'officially_verified',
        confidence: {
          supported: true,
          score: 94,
          signals: ['Polish Ministry of Finance VAT White List', 'NIP Checksum Verified'],
        },
        providerMetadata: {
          rawApiRecord: subj,
          rawRegistryStatus: subj.statusVat || 'UNKNOWN',
        },
      };
    }

    const odpis = 'odpis' in wrapper ? wrapper.odpis : (raw as PlKrsResponse['odpis']);
    const dzial1 = odpis?.dane?.dzial1;
    const podmiot = dzial1?.danePodmiotu;
    const krs = odpis?.naglowekA?.numerKRS;
    if (!podmiot?.nazwa || !krs) return null;

    const adres = dzial1?.siedzibaIAdres?.adres;
    const siedziba = dzial1?.siedzibaIAdres?.siedziba;
    const street = [adres?.ulica, adres?.nrDomu, adres?.nrLokalu ? `/${adres.nrLokalu}` : '']
      .filter(Boolean)
      .join(' ')
      .trim() || undefined;

    const identifiers: Array<{ type: string; value: string; normalizedValue?: string; countryCode?: string; status?: 'officially_verified'; verified?: boolean }> = [
      {
        type: 'PL_KRS',
        value: normalizePolishKrs(krs),
        normalizedValue: normalizePolishKrs(krs),
        countryCode: 'PL',
        status: 'officially_verified',
        verified: true,
      },
    ];
    if (podmiot.identyfikatory?.nip) {
      identifiers.push({
        type: 'PL_NIP',
        value: podmiot.identyfikatory.nip,
        normalizedValue: podmiot.identyfikatory.nip.replace(/[^0-9]/g, ''),
        countryCode: 'PL',
        status: 'officially_verified',
        verified: true,
      });
    }

    const regDate = odpis?.naglowekA?.dataRejestracjiWKRS;
    const foundedYear =
      regDate && /\d{4}/.test(regDate) ? parseInt(regDate.match(/\d{4}/)![0], 10) : undefined;
    const sourceUrl = `https://wyszukiwarka-krs.ms.gov.pl/`;

    return {
      providerId: this.id,
      providerName: PL_KRS_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'PL',
      externalSourceId: normalizePolishKrs(krs),
      company: {
        companyName: podmiot.nazwa.trim(),
        legalName: podmiot.nazwa.trim(),
        registrationNumber: normalizePolishKrs(krs),
        registrationType: 'PL_KRS',
        companyStatus: odpis?.rodzaj === 'Aktualny' ? 'active' : 'unknown',
        website: dzial1?.siedzibaIAdres?.adresStronyInternetowej,
        email: dzial1?.siedzibaIAdres?.adresPocztyElektronicznej,
        address: {
          street,
          city: adres?.miejscowosc || siedziba?.miejscowosc,
          region: siedziba?.wojewodztwo,
          postalCode: adres?.kodPocztowy,
          country: 'Poland',
          countryCode: 'PL',
        },
        category: podmiot.formaPrawna || 'Polish KRS Entity',
        foundedYear,
        identifiers,
        rawSource: {
          sourceName: PL_KRS_METADATA.name,
          providerId: normalizePolishKrs(krs),
          url: sourceUrl,
          retrievedAt,
          license: PL_KRS_METADATA.license,
          attribution: PL_KRS_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: 96,
        signals: ['Polish Ministry of Justice KRS Open API', 'Odpis Aktualny'],
      },
      providerMetadata: {
        rawApiRecord: raw,
        rawRegistryStatus: odpis?.rodzaj || 'Aktualny',
        regon: podmiot.identyfikatory?.regon,
      },
    };
  }

  public classifyError(error: unknown): ClassifiedConnectorError {
    return classifyConnectorError(error, this.id);
  }

  public getHealth(state: ConnectorRuntimeState): ConnectorHealthReport {
    return connectorRegistry.computeHealthReport(this, state);
  }
}
