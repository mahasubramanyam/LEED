import { validateNewZealandNzbn } from '../../identifiers/identifierEngine.js';
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

interface NzbnAddress {
  address1?: string;
  address2?: string;
  address3?: string;
  postCode?: string;
  countryCode?: string;
}

interface NzbnEntityRecord {
  nzbn?: string;
  entityName?: string;
  entityStatusCode?: string;
  entityStatusDescription?: string;
  entityTypeCode?: string;
  entityTypeDescription?: string;
  registrationDate?: string;
  sourceRegisterUniqueIdentifier?: string;
  addresses?: {
    addressList?: NzbnAddress[];
  };
  tradingNames?: Array<{ name?: string }>;
  industryClassifications?: Array<{ classificationDescription?: string }>;
  websites?: Array<{ url?: string }>;
}

interface NzbnSearchResponse {
  pageSize?: number;
  page?: number;
  totalItems?: number;
  items?: NzbnEntityRecord[];
}

const NZBN_BASE = 'https://api.business.govt.nz/gateway/nzbn/v5';

const NZ_COMPANIES_METADATA: ConnectorMetadata = {
  id: 'conn-nz-companies',
  name: 'New Zealand MBIE / Companies Office NZBN API (v5)',
  shortName: 'New Zealand NZBN',
  version: '1.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official New Zealand Ministry of Business, Innovation & Employment (MBIE) NZBN REST API v5 providing live 13-digit New Zealand Business Numbers (NZBN), entity status, trading names, ANZSIC classifications, and addresses.',
  supportedCountries: ['NZ'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: true,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['NZ_NZBN'],
  capabilities: ['company_search', 'registry_lookup', 'identifier_validation', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'MBIE API Subscription Key (Ocp-Apim-Subscription-Key)',
        required: true,
        secret: true,
        placeholder: 'Enter approved MBIE NZBN v5 subscription key...',
        helpText: 'Issued free via api.business.govt.nz developer portal.',
      },
    ],
    envFallbackKeys: ['NZ_NZBN_API_KEY'],
    setupInstructions: 'Create an account at api.business.govt.nz, subscribe to the NZBN v5 API product, and save the Ocp-Apim-Subscription-Key in LEED Connector Vault.',
    obtainKeyUrl: 'https://api.business.govt.nz/',
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
      note: 'MBIE NZBN API gateway subscription rate quota',
      waitOnLimit: false,
    },
    defaultPageSize: 20,
    maxPageSize: 100,
    dedupeWindowMs: 5000,
  },
  attribution: 'New Zealand Ministry of Business, Innovation & Employment (MBIE / NZBN)',
  license: 'CC BY 4.0 New Zealand Government Open Data',
  homepageUrl: 'https://api.business.govt.nz/',
};

export class NzCompaniesConnector implements IConnector {
  public readonly id = 'conn-nz-companies';

  constructor(private readonly fetchFnOverride?: typeof fetch) {}

  public getMetadata(): ConnectorMetadata {
    return NZ_COMPANIES_METADATA;
  }

  private getApiKey(context: ConnectorExecutionContext): { apiKey?: string; knownSecrets: string[] } {
    const apiKey = context.credentials.apiKey?.trim() || process.env.NZ_NZBN_API_KEY?.trim();
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
        message: 'New Zealand NZBN API subscription key (NZ_NZBN_API_KEY) is required before querying api.business.govt.nz.',
        checkedAt,
      };
    }

    try {
      const res = await executeRegistryJsonRequest<NzbnSearchResponse>({
        providerId: this.id,
        url: `${NZBN_BASE}/entities?search-term=Air+New+Zealand&page-size=1`,
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
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
        message: 'Connected to live New Zealand MBIE NZBN v5 API.',
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
        message: 'New Zealand MBIE NZBN API key is required for live queries. Configure NZ_NZBN_API_KEY in Connector Vault.',
      });
    }

    const query = (request.query || '').trim();
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Entity name or 13-digit NZBN is required for New Zealand registry search.',
      });
    }

    if (validateNewZealandNzbn(query)) {
      const lookup = await this.lookupById({ externalId: query, countryCode: 'NZ' }, context);
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
        attribution: NZ_COMPANIES_METADATA.attribution,
        notes: lookup.notes,
        isLiveApi: true,
      };
    }

    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(100, Math.max(1, request.pageSize || 20));
    const params = new URLSearchParams({
      'search-term': query,
      page: String(page - 1),
      'page-size': String(pageSize),
    });

    const res = await executeRegistryJsonRequest<NzbnSearchResponse>({
      providerId: this.id,
      url: `${NZBN_BASE}/entities?${params.toString()}`,
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets,
      fetchFn: this.fetchFnOverride,
    });

    const retrievedAt = new Date().toISOString();
    const rawList = Array.isArray(res.data?.items) ? res.data!.items : [];
    const results: StandardizedConnectorResult[] = [];
    for (const item of rawList) {
      const normalized = this.normalizeResult(item, retrievedAt);
      if (normalized) results.push(normalized);
    }

    const totalItems = typeof res.data?.totalItems === 'number' ? res.data.totalItems : results.length;
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
      attribution: NZ_COMPANIES_METADATA.attribution,
      notes: [`Queried live New Zealand MBIE NZBN v5 API for "${query}".`],
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
        message: 'New Zealand MBIE NZBN API key is required for NZBN lookup. Configure NZ_NZBN_API_KEY in Connector Vault.',
      });
    }

    const digits = request.externalId.replace(/[^0-9]/g, '');
    if (!validateNewZealandNzbn(digits)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Invalid NZBN. Expected a 13-digit EAN-13 identifier starting with 94.',
      });
    }

    const res = await executeRegistryJsonRequest<NzbnEntityRecord>({
      providerId: this.id,
      url: `${NZBN_BASE}/entities/${digits}`,
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets,
      allowNotFound: true,
      fetchFn: this.fetchFnOverride,
    });

    if (res.notFound || !res.data?.nzbn) {
      return {
        found: false,
        attribution: NZ_COMPANIES_METADATA.attribution,
        notes: [`NZBN ${digits} not found in MBIE NZBN register.`],
        isLiveApi: true,
      };
    }

    const retrievedAt = new Date().toISOString();
    const normalized = this.normalizeResult(res.data, retrievedAt);
    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: NZ_COMPANIES_METADATA.attribution,
      notes: [`Exact NZBN ${digits} verified via New Zealand MBIE API v5.`],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const rec = raw as NzbnEntityRecord;
    const nzbn = rec?.nzbn?.trim();
    const name = rec?.entityName?.trim();
    if (!nzbn || !name) return null;

    const addr = rec.addresses?.addressList?.[0];
    const street = [addr?.address1, addr?.address2].filter(Boolean).join(', ') || undefined;
    const city = addr?.address3 || undefined;
    const companyStatus = normalizeLegalCompanyStatus(rec.entityStatusDescription || rec.entityStatusCode, {
      explicitActive: rec.entityStatusCode === '50' || rec.entityStatusDescription?.toLowerCase() === 'registered',
    });

    const foundedYear =
      rec.registrationDate && /^\d{4}/.test(rec.registrationDate)
        ? parseInt(rec.registrationDate.slice(0, 4), 10)
        : undefined;
    const sourceUrl = `https://www.nzbn.govt.nz/mynzbn/nzbndetails/${encodeURIComponent(nzbn)}/`;

    return {
      providerId: this.id,
      providerName: NZ_COMPANIES_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'NZ',
      externalSourceId: nzbn,
      company: {
        companyName: name,
        legalName: name,
        registrationNumber: nzbn,
        registrationType: 'NZ_NZBN',
        companyStatus,
        website: rec.websites?.[0]?.url,
        address: {
          street,
          city,
          postalCode: addr?.postCode,
          country: 'New Zealand',
          countryCode: addr?.countryCode || 'NZ',
        },
        industry: rec.industryClassifications?.[0]?.classificationDescription || 'General Commerce & Services',
        category: rec.entityTypeDescription || rec.entityTypeCode || 'NZ Registered Entity',
        foundedYear,
        identifiers: [
          {
            type: 'NZ_NZBN',
            value: nzbn,
            normalizedValue: nzbn,
            countryCode: 'NZ',
            status: 'officially_verified',
            verified: true,
          },
        ],
        rawSource: {
          sourceName: NZ_COMPANIES_METADATA.name,
          providerId: nzbn,
          url: sourceUrl,
          retrievedAt,
          license: NZ_COMPANIES_METADATA.license,
          attribution: NZ_COMPANIES_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: 96,
        signals: ['New Zealand MBIE NZBN v5', 'EAN-13 Checksum Verified'],
      },
      providerMetadata: {
        rawApiRecord: raw,
        rawRegistryStatus: rec.entityStatusDescription || rec.entityStatusCode || 'UNKNOWN',
        sourceRegisterUniqueIdentifier: rec.sourceRegisterUniqueIdentifier,
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
