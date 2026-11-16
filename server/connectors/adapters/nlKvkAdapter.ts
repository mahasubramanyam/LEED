import { validateDutchKvk } from '../../identifiers/identifierEngine.js';
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

interface KvkSearchResultItem {
  kvkNummer?: string;
  rsin?: string;
  vestigingsnummer?: string;
  naam?: string;
  adres?: {
    binnenlandsAdres?: {
      type?: string;
      straatnaam?: string;
      huisnummer?: number;
      huisletter?: string;
      postcode?: string;
      plaats?: string;
    };
  };
  type?: string;
  actief?: string;
}

interface KvkSearchResponse {
  pagina?: number;
  resultatenPerPagina?: number;
  totaal?: number;
  resultaten?: KvkSearchResultItem[];
}

interface KvkBasisprofielResponse {
  kvkNummer?: string;
  naam?: string;
  statutaireNaam?: string;
  handelsnamen?: Array<{ naam?: string; volgorde?: number }>;
  sbiActiviteiten?: Array<{ sbiCode?: string; sbiOmschrijving?: string; indHoofdactiviteit?: string }>;
  formeleRegistratiedatum?: string;
  indNonMailing?: string;
  _embedded?: {
    hoofdvestiging?: {
      vestigingsnummer?: string;
      adressen?: Array<{
        type?: string;
        straatnaam?: string;
        huisnummer?: number;
        huisletter?: string;
        postcode?: string;
        plaats?: string;
        land?: string;
      }>;
      websites?: string[];
    };
    eigenaar?: {
      rechtsvorm?: string;
      uitgebreideRechtsvorm?: string;
      rsin?: string;
    };
  };
}

const KVK_BASE = 'https://api.kvk.nl/api';

const NL_KVK_METADATA: ConnectorMetadata = {
  id: 'conn-nl-kvk',
  name: 'Netherlands Chamber of Commerce (KVK) Handelsregister API',
  shortName: 'Netherlands KVK',
  version: '1.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official Kamer van Koophandel (KVK) Dutch Commercial Register REST API (v2 Search & v1 Basisprofiel) providing verified 8-digit KVK numbers, legal names, SBI codes, legal forms, and registered office addresses.',
  supportedCountries: ['NL'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: true,
  supportsPostalCodeFilter: true,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['NL_KVK'],
  capabilities: ['company_search', 'registry_lookup', 'identifier_validation', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'KVK Production API Key (apikey header)',
        required: true,
        secret: true,
        placeholder: 'Enter registered KVK API key...',
        helpText: 'Issued via developer.kvk.nl and sent via lowercase HTTP header "apikey".',
      },
    ],
    envFallbackKeys: ['KVK_API_KEY'],
    setupInstructions: 'Register on developer.kvk.nl, subscribe to KVK Zoeken & Basisprofiel APIs, and store the API key encrypted in LEED.',
    obtainKeyUrl: 'https://developers.kvk.nl/',
  },
  executionPolicy: {
    timeoutMs: 8000,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 4000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: 'Per-subscription KVK Developer Portal API quota (pay-per-call for Basisprofiel)',
      waitOnLimit: false,
    },
    defaultPageSize: 20,
    maxPageSize: 100,
    dedupeWindowMs: 5000,
  },
  attribution: 'Kamer van Koophandel (KVK Handelsregister)',
  license: 'KVK API Terms of Service',
  homepageUrl: 'https://developers.kvk.nl/',
};

export class NlKvkConnector implements IConnector {
  public readonly id = 'conn-nl-kvk';

  constructor(private readonly fetchFnOverride?: typeof fetch) {}

  public getMetadata(): ConnectorMetadata {
    return NL_KVK_METADATA;
  }

  private getApiKey(context: ConnectorExecutionContext): { apiKey?: string; knownSecrets: string[] } {
    const apiKey = context.credentials.apiKey?.trim() || process.env.KVK_API_KEY?.trim();
    const knownSecrets = apiKey ? [apiKey] : [];
    return { apiKey, knownSecrets };
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    const { apiKey, knownSecrets } = this.getApiKey(context);
    if (!apiKey) {
      return {
        ok: false,
        healthState: 'authentication_required',
        latencyMs: 0,
        isLiveApi: false,
        errorCategory: 'missing_credentials',
        message: 'Netherlands KVK API key (KVK_API_KEY) is required before connecting to api.kvk.nl.',
        checkedAt,
      };
    }

    try {
      const res = await executeRegistryJsonRequest<KvkSearchResponse>({
        providerId: this.id,
        url: `${KVK_BASE}/v2/zoeken?kvkNummer=69599088&resultatenPerPagina=1`,
        headers: { apikey: apiKey },
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        knownSecrets,
        fetchFn: this.fetchFnOverride,
      });

      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: 'Connected to live Netherlands KVK Handelsregister API v2.',
        checkedAt,
        rateLimitRemaining: res.rateLimitRemaining,
      };
    } catch (err: unknown) {
      const classified = classifyConnectorError(err, this.id, knownSecrets);
      return {
        ok: false,
        healthState:
          classified.category === 'authentication_failure' || classified.category === 'authorization_failure'
            ? 'authentication_required'
            : classified.category === 'rate_limited'
            ? 'rate_limited'
            : 'temporarily_unavailable',
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
    const { apiKey, knownSecrets } = this.getApiKey(context);
    if (!apiKey) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        message: 'Netherlands KVK API key is required for live KVK searches. Configure KVK_API_KEY in Connector Vault.',
      });
    }

    const query = (request.query || '').trim();
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Company name or 8-digit KVK number is required for KVK search.',
      });
    }

    if (validateDutchKvk(query)) {
      const lookup = await this.lookupById({ externalId: query, countryCode: 'NL' }, context);
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
        attribution: NL_KVK_METADATA.attribution,
        notes: lookup.notes,
        isLiveApi: true,
      };
    }

    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(100, Math.max(1, request.pageSize || 20));
    const params = new URLSearchParams({
      naam: query,
      pagina: String(page),
      resultatenPerPagina: String(pageSize),
    });
    if (request.city) params.set('plaats', request.city.trim());
    if (request.postalCode) params.set('postcode', request.postalCode.replace(/\s+/g, '').toUpperCase());

    const res = await executeRegistryJsonRequest<KvkSearchResponse>({
      providerId: this.id,
      url: `${KVK_BASE}/v2/zoeken?${params.toString()}`,
      headers: { apikey: apiKey },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets,
      fetchFn: this.fetchFnOverride,
    });

    const retrievedAt = new Date().toISOString();
    const rawList = Array.isArray(res.data?.resultaten) ? res.data!.resultaten : [];
    const results: StandardizedConnectorResult[] = [];
    for (const item of rawList) {
      const normalized = this.normalizeResult(item, retrievedAt);
      if (normalized) results.push(normalized);
    }

    const totalItems = typeof res.data?.totaal === 'number' ? res.data.totaal : results.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    return {
      results,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasMore: page < totalPages,
      },
      rawCount: rawList.length,
      attribution: NL_KVK_METADATA.attribution,
      notes: [`Queried live Netherlands KVK Handelsregister API v2 for "${query}".`],
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const { apiKey, knownSecrets } = this.getApiKey(context);
    if (!apiKey) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        message: 'Netherlands KVK API key is required for KVK lookup. Configure KVK_API_KEY in Connector Vault.',
      });
    }

    const digits = request.externalId.replace(/[^0-9]/g, '');
    if (!validateDutchKvk(digits)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Invalid Dutch KVK-nummer. Expected exactly 8 digits.',
      });
    }

    const res = await executeRegistryJsonRequest<KvkBasisprofielResponse>({
      providerId: this.id,
      url: `${KVK_BASE}/v1/basisprofielen/${digits}`,
      headers: { apikey: apiKey },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets,
      allowNotFound: true,
      fetchFn: this.fetchFnOverride,
    });

    if (res.notFound || !res.data?.kvkNummer) {
      return {
        found: false,
        attribution: NL_KVK_METADATA.attribution,
        notes: [`KVK number ${digits} not found in KVK Handelsregister.`],
        isLiveApi: true,
      };
    }

    const retrievedAt = new Date().toISOString();
    const normalized = this.normalizeResult(res.data, retrievedAt);
    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: NL_KVK_METADATA.attribution,
      notes: [`Exact KVK ${digits} verified via Netherlands KVK Basisprofiel API.`],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const r = raw as KvkSearchResultItem & KvkBasisprofielResponse;
    const kvkNum = r?.kvkNummer?.trim();
    const name = (r?.naam || r?.statutaireNaam || r?.handelsnamen?.[0]?.naam || '').trim();
    if (!kvkNum || !name) return null;

    const searchAddr = r.adres?.binnenlandsAdres;
    const profileAddr = r._embedded?.hoofdvestiging?.adressen?.[0];
    const addr = profileAddr || searchAddr;
    const street = [addr?.straatnaam, addr?.huisnummer, addr?.huisletter].filter(Boolean).join(' ').trim() || undefined;

    const website = r._embedded?.hoofdvestiging?.websites?.[0];
    const primarySbi = r.sbiActiviteiten?.find((s) => s.indHoofdactiviteit === 'Ja') || r.sbiActiviteiten?.[0];
    const foundedYear =
      r.formeleRegistratiedatum && /^\d{4}/.test(r.formeleRegistratiedatum)
        ? parseInt(r.formeleRegistratiedatum.slice(0, 4), 10)
        : undefined;

    const companyStatus =
      r.actief === 'Nee'
        ? 'inactive'
        : r.actief === 'Ja' || r.kvkNummer
        ? normalizeLegalCompanyStatus(r.actief, { explicitActive: true })
        : 'unknown';

    const sourceUrl = `https://www.kvk.nl/zoeken/handelsregister/?kvknummer=${encodeURIComponent(kvkNum)}`;

    return {
      providerId: this.id,
      providerName: NL_KVK_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'NL',
      externalSourceId: kvkNum,
      company: {
        companyName: name,
        legalName: (r.statutaireNaam || name).trim(),
        registrationNumber: kvkNum,
        registrationType: 'NL_KVK',
        companyStatus,
        website,
        address: {
          street,
          city: addr?.plaats,
          postalCode: addr?.postcode,
          country: 'Netherlands',
          countryCode: 'NL',
        },
        industry: primarySbi?.sbiOmschrijving || 'General Commerce & Services',
        category: r._embedded?.eigenaar?.uitgebreideRechtsvorm || r.type || 'Dutch Registered Entity',
        foundedYear,
        identifiers: [
          {
            type: 'NL_KVK',
            value: kvkNum,
            normalizedValue: kvkNum,
            countryCode: 'NL',
            status: 'officially_verified',
            verified: true,
          },
        ],
        rawSource: {
          sourceName: NL_KVK_METADATA.name,
          providerId: kvkNum,
          url: sourceUrl,
          retrievedAt,
          license: NL_KVK_METADATA.license,
          attribution: NL_KVK_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: 96,
        signals: ['Netherlands KVK Official Handelsregister API'],
      },
      providerMetadata: {
        rawApiRecord: raw,
        rawRegistryStatus: r.actief || 'REGISTERED',
        rsin: r.rsin || r._embedded?.eigenaar?.rsin,
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
