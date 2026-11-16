import { validateLei, normalizeIdentifierValue } from '../../identifiers/identifierEngine.js';
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

interface GleifAddress {
  addressLines?: string[];
  city?: string;
  region?: string;
  country?: string;
  postalCode?: string;
}

interface GleifLeiRecord {
  id?: string;
  attributes?: {
    lei?: string;
    entity?: {
      legalName?: { name?: string };
      otherNames?: Array<{ name?: string }>;
      legalAddress?: GleifAddress;
      headquartersAddress?: GleifAddress;
      registeredAt?: { id?: string; other?: string };
      registeredAs?: string;
      jurisdiction?: string;
      category?: string;
      legalForm?: { id?: string; other?: string };
      status?: string;
      creationDate?: string;
    };
    registration?: {
      initialRegistrationDate?: string;
      lastUpdateDate?: string;
      status?: string;
      validationSources?: string;
    };
  };
  links?: { self?: string };
}

interface GleifListResponse {
  data?: GleifLeiRecord | GleifLeiRecord[];
  meta?: {
    pagination?: {
      currentPage?: number;
      perPage?: number;
      total?: number;
      lastPage?: number;
    };
  };
}

const GLEIF_BASE = 'https://api.gleif.org/api/v1';

const GLEIF_METADATA: ConnectorMetadata = {
  id: 'conn-gleif',
  name: 'GLEIF Global LEI Registry',
  shortName: 'GLEIF LEI',
  version: '1.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official Global Legal Entity Identifier Foundation (GLEIF) ISO 17442 open registry covering legal entities worldwide with verified legal names, headquarters/legal addresses, registration authority links, and corporate status.',
  supportedCountries: ['GLOBAL'],
  supportsAllCountries: true,
  supportsRegionFilter: false,
  supportsCityFilter: true,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['LEI'],
  capabilities: ['company_search', 'registry_lookup', 'identifier_validation', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions: 'Open public GLEIF REST API (CC0 1.0 Public Domain Dedication). No API key required.',
    obtainKeyUrl: 'https://www.gleif.org/en/lei-data/gleif-api',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 4000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 60,
      windowMs: 60000,
      note: 'Open GLEIF API (60 req/min rate window per IP)',
      waitOnLimit: false,
    },
    defaultPageSize: 20,
    maxPageSize: 50,
    dedupeWindowMs: 5000,
  },
  attribution: 'Global Legal Entity Identifier Foundation (GLEIF) — CC0 1.0 Public Domain',
  license: 'CC0 1.0 Universal (Public Domain)',
  homepageUrl: 'https://www.gleif.org/en/lei-data/gleif-api',
};

export class GleifConnector implements IConnector {
  public readonly id = 'conn-gleif';

  constructor(private readonly fetchFnOverride?: typeof fetch) {}

  public getMetadata(): ConnectorMetadata {
    return GLEIF_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const res = await executeRegistryJsonRequest<GleifListResponse>({
        providerId: this.id,
        url: `${GLEIF_BASE}/lei-records?page[size]=1`,
        headers: { Accept: 'application/vnd.api+json' },
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        fetchFn: this.fetchFnOverride,
      });

      const count = Array.isArray(res.data?.data) ? res.data!.data.length : 0;
      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: `Connected to live GLEIF Global LEI Registry (${count} probe record verified).`,
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
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Company legal name or 20-character LEI is required for GLEIF search.',
      });
    }

    const cleanedLei = normalizeIdentifierValue(query);
    if (cleanedLei.length === 20 && validateLei(cleanedLei)) {
      const lookup = await this.lookupById({ externalId: cleanedLei, countryCode: request.countryCode }, context);
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
        attribution: GLEIF_METADATA.attribution,
        notes: lookup.notes,
        isLiveApi: true,
      };
    }

    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(50, Math.max(1, request.pageSize || 20));
    const params = new URLSearchParams({
      'filter[entity.legalName]': query,
      'page[number]': String(page),
      'page[size]': String(pageSize),
    });
    if (request.countryCode && request.countryCode !== 'GLOBAL' && /^[A-Z]{2}$/i.test(request.countryCode)) {
      params.set('filter[entity.legalAddress.country]', request.countryCode.toUpperCase());
    }

    const res = await executeRegistryJsonRequest<GleifListResponse>({
      providerId: this.id,
      url: `${GLEIF_BASE}/lei-records?${params.toString()}`,
      headers: { Accept: 'application/vnd.api+json' },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      fetchFn: this.fetchFnOverride,
    });

    const retrievedAt = new Date().toISOString();
    const rawList = Array.isArray(res.data?.data) ? res.data!.data : [];
    const results: StandardizedConnectorResult[] = [];
    for (const item of rawList) {
      const normalized = this.normalizeResult(item, retrievedAt);
      if (normalized) results.push(normalized);
    }

    const pg = res.data?.meta?.pagination;
    const totalItems = typeof pg?.total === 'number' ? pg.total : results.length;
    const totalPages = typeof pg?.lastPage === 'number' ? pg.lastPage : Math.max(1, Math.ceil(totalItems / pageSize));

    return {
      results,
      pagination: {
        page: pg?.currentPage || page,
        pageSize: pg?.perPage || pageSize,
        totalItems,
        totalPages,
        hasMore: page < totalPages,
      },
      rawCount: rawList.length,
      attribution: GLEIF_METADATA.attribution,
      notes: [`Queried live GLEIF Global LEI Registry for "${query}".`],
      isLiveApi: true,
      providerMetadata: { totalItems, currentPage: page },
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const cleanLei = normalizeIdentifierValue(request.externalId);
    if (!validateLei(cleanLei)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Invalid LEI format. Expected 20 alphanumeric characters passing ISO 17442 Modulo 97-10.',
      });
    }

    const res = await executeRegistryJsonRequest<GleifListResponse>({
      providerId: this.id,
      url: `${GLEIF_BASE}/lei-records/${encodeURIComponent(cleanLei)}`,
      headers: { Accept: 'application/vnd.api+json' },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      allowNotFound: true,
      fetchFn: this.fetchFnOverride,
    });

    if (res.notFound || !res.data?.data || Array.isArray(res.data.data)) {
      return {
        found: false,
        attribution: GLEIF_METADATA.attribution,
        notes: [`LEI ${cleanLei} not found in GLEIF Index.`],
        isLiveApi: true,
      };
    }

    const retrievedAt = new Date().toISOString();
    const normalized = this.normalizeResult(res.data.data, retrievedAt);
    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: GLEIF_METADATA.attribution,
      notes: [`Exact ISO 17442 LEI lookup verified via GLEIF API.`],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const record = raw as GleifLeiRecord;
    const lei = record?.attributes?.lei || record?.id;
    const legalName = record?.attributes?.entity?.legalName?.name?.trim();
    if (!lei || !legalName) return null;

    const entity = record.attributes!.entity!;
    const addr = entity.headquartersAddress || entity.legalAddress;
    const countryCode = (addr?.country || entity.jurisdiction || 'US').toUpperCase().slice(0, 2);
    const street = addr?.addressLines?.filter(Boolean).join(', ');
    const foundedYear =
      entity.creationDate && /^\d{4}/.test(entity.creationDate)
        ? parseInt(entity.creationDate.slice(0, 4), 10)
        : undefined;

    const status = normalizeLegalCompanyStatus(entity.status, {
      explicitActive: entity.status === 'ACTIVE',
    });

    const identifiers: Array<{ type: string; value: string; normalizedValue?: string; countryCode?: string; status?: 'officially_verified'; verified?: boolean }> = [
      {
        type: 'LEI',
        value: lei,
        normalizedValue: lei,
        countryCode,
        status: 'officially_verified',
        verified: true,
      },
    ];

    if (entity.registeredAs) {
      identifiers.push({
        type: 'OTHER',
        value: entity.registeredAs,
        countryCode,
        status: 'officially_verified',
        verified: true,
      });
    }

    const sourceUrl = `https://search.gleif.org/#/record/${encodeURIComponent(lei)}`;

    return {
      providerId: this.id,
      providerName: GLEIF_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode,
      externalSourceId: lei,
      company: {
        companyName: legalName,
        legalName,
        registrationNumber: lei,
        registrationType: 'LEI',
        companyStatus: status,
        address: {
          street,
          city: addr?.city,
          region: addr?.region,
          postalCode: addr?.postalCode,
          countryCode,
        },
        foundedYear,
        industry: entity.category || 'Legal Entity',
        category: entity.legalForm?.other || entity.legalForm?.id || 'LEI Registered Entity',
        identifiers,
        rawSource: {
          sourceName: GLEIF_METADATA.name,
          providerId: lei,
          url: sourceUrl,
          retrievedAt,
          license: GLEIF_METADATA.license,
          attribution: GLEIF_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: record.attributes?.registration?.lastUpdateDate,
        freshnessNote: 'Real-time GLEIF Golden Copy Index',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: status === 'active' ? 96 : 85,
        signals: ['GLEIF ISO 17442 LEI', `Registration status: ${record.attributes?.registration?.status || 'ISSUED'}`],
      },
      providerMetadata: {
        rawApiRecord: raw,
        rawRegistryStatus: entity.status,
        validationSources: record.attributes?.registration?.validationSources,
        registrationAuthorityId: entity.registeredAt?.id,
        localRegistrationId: entity.registeredAs,
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
