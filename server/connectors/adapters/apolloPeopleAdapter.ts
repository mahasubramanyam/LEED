import { classifyConnectorError, ConnectorError } from '../core/errors.js';
import { connectorRegistry } from '../core/registry.js';
import { executeRegistryJsonRequest } from '../core/registryHttp.js';
import {
  ClassifiedConnectorError,
  ConnectionValidationResult,
  ConnectorExecutionContext,
  ConnectorHealthReport,
  ConnectorMetadata,
  ConnectorRuntimeState,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
  StandardizedConnectorResult,
} from '../core/types.js';
import { DnsLookupAllFn } from '../../security/ssrf.js';

export interface ApolloPersonResult {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  headline?: string;
  seniority?: string;
  departments?: string[];
  functions?: string[];
  linkedin_url?: string;
  email?: string;
  email_status?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: {
    name?: string;
    primary_domain?: string;
    website_url?: string;
    industry?: string;
  };
  employment_history?: Array<{
    title?: string;
    organization_name?: string;
    current?: boolean;
    start_date?: string;
    end_date?: string | null;
  }>;
}

export interface ApolloPeopleSearchApiResponse {
  people?: ApolloPersonResult[];
  contacts?: ApolloPersonResult[];
  pagination?: {
    page?: number;
    per_page?: number;
    total_entries?: number;
    total_pages?: number;
  };
}

const APOLLO_PEOPLE_SEARCH_ENDPOINT = 'https://api.apollo.io/api/v1/mixed_people/search';

const APOLLO_METADATA: ConnectorMetadata = {
  id: 'conn-apollo',
  name: 'Apollo.io B2B People & Decision-Maker API',
  shortName: 'Apollo People',
  version: '1.0.0',
  sourceCategory: 'social_platform',
  accessMode: 'live_api',
  description:
    'Authorized commercial B2B decision-maker intelligence provider for executive titles, departments, seniority, and published LinkedIn profiles. Requires an owner Apollo.io API key.',
  supportedCountries: ['GLOBAL'],
  supportsAllCountries: true,
  supportsRegionFilter: true,
  supportsCityFilter: true,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['DOMAIN'],
  capabilities: ['contact_enrichment', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'Apollo.io API Key',
        required: true,
        secret: true,
        placeholder: 'apollo_...',
        helpText: 'Sent in X-Api-Key header. Stored encrypted in the LEED Credential Vault.',
      },
    ],
    envFallbackKeys: ['APOLLO_API_KEY'],
    setupInstructions:
      'Generate an Apollo.io API key in Apollo Settings > Integrations > API and save it in the LEED Credential Vault.',
    obtainKeyUrl: 'https://docs.apollo.io/reference/people-search',
  },
  executionPolicy: {
    timeoutMs: 10000,
    maxRetries: 1,
    baseBackoffMs: 1000,
    maxBackoffMs: 4000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: 'Apollo.io API plan rate limits apply',
      waitOnLimit: false,
    },
    defaultPageSize: 10,
    maxPageSize: 25,
    dedupeWindowMs: 5000,
  },
  attribution: 'Apollo.io Commercial B2B Intelligence API',
  license: 'Apollo.io API Commercial Terms of Service',
  homepageUrl: 'https://docs.apollo.io',
};

export class ApolloPeopleConnector implements IConnector {
  public readonly id = 'conn-apollo';

  constructor(
    private readonly fetchFnOverride?: typeof fetch,
    private readonly dnsLookupOverride?: DnsLookupAllFn
  ) {}

  public getMetadata(): ConnectorMetadata {
    return APOLLO_METADATA;
  }

  private requireApiKey(context: ConnectorExecutionContext): string {
    const key = (context.credentials.apiKey || context.credentials.token || '').trim();
    if (!key) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        retryable: false,
        message: 'Apollo.io API key is not configured in the Credential Vault.',
        remediationHint: 'Add an authorized Apollo.io API key in Connectors Hub > Credentials.',
      });
    }
    return key;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const apiKey = this.requireApiKey(context);
      const res = await executeRegistryJsonRequest<ApolloPeopleSearchApiResponse>({
        providerId: this.id,
        url: APOLLO_PEOPLE_SEARCH_ENDPOINT,
        method: 'POST',
        headers: {
          'X-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q_organization_domains_list: ['apollo.io'],
          page: 1,
          per_page: 1,
        }),
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        knownSecrets: [apiKey],
        fetchFn: this.fetchFnOverride,
        dnsLookupAll: this.dnsLookupOverride,
      });

      const count = res.data?.people?.length ?? res.data?.contacts?.length ?? 0;
      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: `Connected to Apollo.io People API (${count} probe contact resolved).`,
        checkedAt,
        rateLimitRemaining: res.rateLimitRemaining,
      };
    } catch (err: unknown) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState:
          classified.category === 'missing_credentials' ||
          classified.category === 'authentication_failure' ||
          classified.category === 'authorization_failure'
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

  public async searchPeopleForCompany(
    params: {
      companyName?: string;
      domain?: string;
      countryCode?: string;
      personTitles?: string[];
      personSeniorities?: string[];
      page?: number;
      perPage?: number;
    },
    context: ConnectorExecutionContext
  ): Promise<{
    people: ApolloPersonResult[];
    totalEntries: number;
    page: number;
  }> {
    const apiKey = this.requireApiKey(context);
    const domain = params.domain?.trim().toLowerCase().replace(/^www\./, '');
    const companyName = params.companyName?.trim();

    if (!domain && !companyName) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'Company domain or company name is required for Apollo decision-maker lookup.',
      });
    }

    const payload: Record<string, unknown> = {
      page: Math.max(1, params.page || 1),
      per_page: Math.min(25, Math.max(1, params.perPage || 15)),
    };
    if (domain) {
      payload.q_organization_domains_list = [domain];
    } else if (companyName) {
      payload.q_organization_name = companyName;
    }
    if (Array.isArray(params.personTitles) && params.personTitles.length > 0) {
      payload.person_titles = params.personTitles;
    }
    if (Array.isArray(params.personSeniorities) && params.personSeniorities.length > 0) {
      payload.person_seniorities = params.personSeniorities;
    }

    const res = await executeRegistryJsonRequest<ApolloPeopleSearchApiResponse>({
      providerId: this.id,
      url: APOLLO_PEOPLE_SEARCH_ENDPOINT,
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets: [apiKey],
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    const people = [
      ...(Array.isArray(res.data?.people) ? res.data!.people! : []),
      ...(Array.isArray(res.data?.contacts) ? res.data!.contacts! : []),
    ];

    return {
      people,
      totalEntries: res.data?.pagination?.total_entries ?? people.length,
      page: res.data?.pagination?.page ?? (params.page || 1),
    };
  }

  public async search(
    request: ConnectorSearchRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorSearchResponse> {
    const domain = (request.domain || request.website || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0];
    const companyName = request.query?.trim();
    const res = await this.searchPeopleForCompany(
      {
        companyName,
        domain: domain || undefined,
        countryCode: request.countryCode,
        page: request.page,
        perPage: request.pageSize,
      },
      context
    );

    const retrievedAt = new Date().toISOString();
    const byCompany = new Map<string, StandardizedConnectorResult>();
    for (const p of res.people) {
      const orgName = p.organization?.name || companyName;
      const orgDom = p.organization?.primary_domain || domain;
      if (!orgName && !orgDom) continue;
      const key = (orgDom || orgName || '').toLowerCase();
      if (byCompany.has(key)) continue;
      byCompany.set(key, {
        providerId: this.id,
        providerName: APOLLO_METADATA.name,
        sourceCategory: 'social_platform',
        accessMode: 'live_api',
        countryCode: (request.countryCode && request.countryCode !== 'GLOBAL'
          ? request.countryCode
          : 'US'
        ).toUpperCase(),
        externalSourceId: orgDom || key,
        company: {
          companyName: orgName || orgDom || 'Company',
          domain: orgDom,
          website: p.organization?.website_url || (orgDom ? `https://${orgDom}` : undefined),
          industry: p.organization?.industry || 'Business Services',
          companyStatus: 'unknown',
          address: {
            city: p.city,
            region: p.state,
            country: p.country,
            countryCode: (request.countryCode && request.countryCode !== 'GLOBAL'
              ? request.countryCode
              : 'US'
            ).toUpperCase(),
          },
          tags: ['Apollo.io', 'Authorized B2B People Provider'],
        },
        sourceUrl: 'https://www.apollo.io',
        retrievedAt,
        verificationStatus: 'directory_listed',
        confidence: {
          supported: true,
          score: 72,
          signals: ['Authorized Apollo.io B2B Intelligence Match'],
        },
        providerMetadata: {
          peopleMatched: res.people.length,
        },
      });
    }

    return {
      results: Array.from(byCompany.values()),
      pagination: {
        page: res.page,
        pageSize: request.pageSize || 15,
        totalItems: res.totalEntries,
        hasMore: res.people.length >= (request.pageSize || 15),
      },
      rawCount: res.people.length,
      attribution: APOLLO_METADATA.attribution,
      notes: ['Queried Apollo.io People API for authorized decision-maker matches.'],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const p = raw as ApolloPersonResult;
    const orgName = p?.organization?.name;
    const orgDom = p?.organization?.primary_domain;
    if (!orgName && !orgDom) return null;
    return {
      providerId: this.id,
      providerName: APOLLO_METADATA.name,
      sourceCategory: 'social_platform',
      accessMode: 'live_api',
      countryCode: 'US',
      externalSourceId: p.id || orgDom || orgName || 'apollo',
      company: {
        companyName: orgName || orgDom || 'Company',
        domain: orgDom,
        website: p.organization?.website_url || (orgDom ? `https://${orgDom}` : undefined),
      },
      retrievedAt,
      verificationStatus: 'directory_listed',
      providerMetadata: { personId: p.id },
    };
  }

  public classifyError(error: unknown): ClassifiedConnectorError {
    return classifyConnectorError(error, this.id);
  }

  public getHealth(state: ConnectorRuntimeState): ConnectorHealthReport {
    return connectorRegistry.computeHealthReport(this, state);
  }
}
