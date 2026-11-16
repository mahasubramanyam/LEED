import { classifyConnectorError, ConnectorError } from '../core/errors.js';
import { normalizeLegalCompanyStatus } from '../core/normalizer.js';
import { connectorRegistry } from '../core/registry.js';
import { executeRegistryJsonRequest } from '../core/registryHttp.js';
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
import { DnsLookupAllFn } from '../../security/ssrf.js';

interface OpenCorporatesCompany {
  name?: string;
  company_number?: string;
  jurisdiction_code?: string;
  incorporation_date?: string;
  company_type?: string;
  current_status?: string;
  inactive?: boolean;
  opencorporates_url?: string;
  registered_address_in_full?: string;
  registered_address?: {
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  };
}

interface OpenCorporatesSearchResponse {
  results?: {
    page?: number;
    per_page?: number;
    total_pages?: number;
    total_count?: number;
    companies?: Array<{ company?: OpenCorporatesCompany }>;
  };
}

interface OpenCorporatesLookupResponse {
  results?: {
    company?: OpenCorporatesCompany;
  };
}

const OC_BASE = 'https://api.opencorporates.com/v0.4';

const OC_METADATA: ConnectorMetadata = {
  id: 'conn-opencorporates',
  name: 'OpenCorporates Global Corporate Directory API v0.4',
  shortName: 'OpenCorporates',
  version: '1.0.0',
  sourceCategory: 'business_directory',
  accessMode: 'live_api',
  description:
    'Multi-jurisdiction corporate registry aggregator spanning 140+ jurisdictions. Requires an authorized OpenCorporates API token.',
  supportedCountries: ['GLOBAL'],
  supportsAllCountries: true,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['OTHER'],
  capabilities: ['company_search', 'registry_lookup', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiToken',
        label: 'OpenCorporates API Token',
        required: true,
        secret: true,
        placeholder: 'oc_token_...',
        helpText: 'OpenCorporates v0.4 API token stored encrypted in the Credential Vault.',
      },
    ],
    envFallbackKeys: ['OPENCORPORATES_API_TOKEN'],
    setupInstructions:
      'Enter an authorized OpenCorporates API v0.4 token. Commercial usage requires an OpenCorporates commercial license.',
    obtainKeyUrl: 'https://opencorporates.com/info/our-data/',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 1,
    baseBackoffMs: 1000,
    maxBackoffMs: 4000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: 'Token-tier dependent quota per OpenCorporates API policy',
      waitOnLimit: false,
    },
    defaultPageSize: 20,
    maxPageSize: 50,
    dedupeWindowMs: 5000,
  },
  attribution: 'OpenCorporates (https://opencorporates.com)',
  license: 'OpenCorporates API Terms / ODbL Share-Alike or Commercial License',
  homepageUrl: 'https://opencorporates.com',
};

export class OpenCorporatesConnector implements IConnector {
  public readonly id = 'conn-opencorporates';

  constructor(
    private readonly fetchFnOverride?: typeof fetch,
    private readonly dnsLookupOverride?: DnsLookupAllFn
  ) {}

  public getMetadata(): ConnectorMetadata {
    return OC_METADATA;
  }

  private requireToken(context: ConnectorExecutionContext): string {
    const token = (context.credentials.apiToken || context.credentials.apiKey || '').trim();
    if (!token) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        retryable: false,
        message: 'OpenCorporates API token is not configured in the Credential Vault.',
        remediationHint: 'Save an OpenCorporates v0.4 apiToken in Connectors Hub > Credentials.',
      });
    }
    return token;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const token = this.requireToken(context);
      const params = new URLSearchParams({
        q: 'equinor',
        per_page: '1',
        api_token: token,
      });
      const res = await executeRegistryJsonRequest<OpenCorporatesSearchResponse>({
        providerId: this.id,
        url: `${OC_BASE}/companies/search?${params.toString()}`,
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        knownSecrets: [token],
        fetchFn: this.fetchFnOverride,
        dnsLookupAll: this.dnsLookupOverride,
      });

      const count = res.data?.results?.companies?.length ?? 0;
      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: `Connected to OpenCorporates API v0.4 (${count} probe corporate record).`,
        checkedAt,
        rateLimitRemaining: res.rateLimitRemaining,
      };
    } catch (err: unknown) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState:
          classified.category === 'missing_credentials' || classified.category === 'authentication_failure'
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
    const token = this.requireToken(context);
    const query = (request.query || '').trim();
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'Company name query is required for OpenCorporates search.',
      });
    }

    const page = Math.max(1, request.page || 1);
    const perPage = Math.min(50, Math.max(1, request.pageSize || 20));
    const params = new URLSearchParams({
      q: query,
      page: String(page),
      per_page: String(perPage),
      api_token: token,
    });
    if (request.countryCode && request.countryCode !== 'GLOBAL' && /^[A-Z]{2}$/i.test(request.countryCode)) {
      params.set('country_code', request.countryCode.toLowerCase());
    }

    const res = await executeRegistryJsonRequest<OpenCorporatesSearchResponse>({
      providerId: this.id,
      url: `${OC_BASE}/companies/search?${params.toString()}`,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets: [token],
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    const retrievedAt = new Date().toISOString();
    const rawList = Array.isArray(res.data?.results?.companies) ? res.data!.results!.companies : [];
    const results: StandardizedConnectorResult[] = [];
    for (const entry of rawList) {
      if (!entry?.company) continue;
      const normalized = this.normalizeResult(entry.company, retrievedAt);
      if (normalized) results.push(normalized);
    }

    const totalPages = res.data?.results?.total_pages || 1;
    return {
      results,
      pagination: {
        page: res.data?.results?.page || page,
        pageSize: res.data?.results?.per_page || perPage,
        totalItems: res.data?.results?.total_count,
        totalPages,
        hasMore: page < totalPages,
      },
      rawCount: rawList.length,
      attribution: OC_METADATA.attribution,
      notes: [`Queried OpenCorporates v0.4 directory for "${query}".`],
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const token = this.requireToken(context);
    const jurisdiction = (request.countryCode || '').trim().toLowerCase();
    const number = request.externalId.trim();
    if (!jurisdiction || !number) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'Jurisdiction code and company number are required for OpenCorporates lookup.',
      });
    }

    const res = await executeRegistryJsonRequest<OpenCorporatesLookupResponse>({
      providerId: this.id,
      url: `${OC_BASE}/companies/${encodeURIComponent(jurisdiction)}/${encodeURIComponent(number)}?api_token=${encodeURIComponent(token)}`,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets: [token],
      allowNotFound: true,
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    if (res.notFound || !res.data?.results?.company) {
      return {
        found: false,
        attribution: OC_METADATA.attribution,
        notes: [`Record ${jurisdiction}/${number} not found in OpenCorporates.`],
        isLiveApi: true,
      };
    }

    const normalized = this.normalizeResult(res.data.results.company, new Date().toISOString());
    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: OC_METADATA.attribution,
      notes: ['Retrieved corporate directory profile from OpenCorporates API v0.4.'],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const c = raw as OpenCorporatesCompany;
    if (!c?.name || !c?.company_number) return null;

    const countryCode = (c.jurisdiction_code || 'US').split('_')[0].toUpperCase().slice(0, 2);
    const foundedYear =
      c.incorporation_date && /^\d{4}/.test(c.incorporation_date)
        ? parseInt(c.incorporation_date.slice(0, 4), 10)
        : undefined;
    const status = normalizeLegalCompanyStatus(c.current_status, {
      explicitActive: c.inactive === false,
    });
    const sourceUrl =
      c.opencorporates_url ||
      `https://opencorporates.com/companies/${encodeURIComponent((c.jurisdiction_code || countryCode).toLowerCase())}/${encodeURIComponent(c.company_number)}`;

    return {
      providerId: this.id,
      providerName: OC_METADATA.name,
      sourceCategory: 'business_directory',
      accessMode: 'live_api',
      countryCode,
      externalSourceId: `${c.jurisdiction_code || countryCode}:${c.company_number}`,
      company: {
        companyName: c.name.trim(),
        legalName: c.name.trim(),
        registrationNumber: c.company_number,
        registrationType: 'OTHER',
        companyStatus: status,
        address: {
          street: c.registered_address?.street_address || c.registered_address_in_full,
          city: c.registered_address?.locality,
          region: c.registered_address?.region,
          postalCode: c.registered_address?.postal_code,
          country: c.registered_address?.country,
          countryCode,
        },
        foundedYear,
        industry: 'Corporate Directory Entity',
        category: c.company_type || 'Registered Company',
        identifiers: [
          {
            type: 'OTHER',
            value: c.company_number,
            countryCode,
            source: this.id,
            status: 'discovered',
            verified: false,
          },
        ],
        tags: ['Business Directory', 'OpenCorporates', countryCode].filter(Boolean),
        rawSource: {
          sourceName: OC_METADATA.name,
          providerId: `${c.jurisdiction_code || countryCode}:${c.company_number}`,
          url: sourceUrl,
          retrievedAt,
          license: OC_METADATA.license,
          attribution: OC_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'OpenCorporates aggregated corporate directory',
        isRealtime: true,
      },
      verificationStatus: 'directory_listed',
      confidence: {
        supported: true,
        score: status === 'active' ? 66 : 56,
        signals: ['Aggregated Corporate Directory Match (OpenCorporates)', `Status: ${c.current_status || status}`],
      },
      providerMetadata: {
        jurisdictionCode: c.jurisdiction_code,
        companyType: c.company_type,
        provenanceType: 'business_directory',
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
