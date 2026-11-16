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

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
  language?: string;
  profile?: {
    name?: string;
    long_name?: string;
    url?: string;
  };
  meta_url?: {
    hostname?: string;
    path?: string;
  };
}

interface BraveSearchApiResponse {
  query?: {
    original?: string;
    more_results_available?: boolean;
  };
  web?: {
    results?: BraveWebResult[];
  };
}

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

const BRAVE_METADATA: ConnectorMetadata = {
  id: 'conn-brave-search',
  name: 'Brave Web Search API',
  shortName: 'Brave Search',
  version: '1.0.0',
  sourceCategory: 'search_engine',
  accessMode: 'live_api',
  description:
    'Authorized web search index returning real company websites, descriptions, and domain metadata globally. Requires an owner Brave Search API subscription token.',
  supportedCountries: ['GLOBAL'],
  supportsAllCountries: true,
  supportsRegionFilter: true,
  supportsCityFilter: true,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: true,
  supportedIdentifierTypes: ['DOMAIN'],
  capabilities: ['company_search', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'Brave Search Subscription Token',
        required: true,
        secret: true,
        placeholder: 'BSA...',
        helpText: 'Sent as X-Subscription-Token header. Stored encrypted in the Credential Vault.',
      },
    ],
    envFallbackKeys: ['BRAVE_SEARCH_API_KEY'],
    setupInstructions: 'Obtain a subscription token from Brave Search API Dashboard and save it in the encrypted Credential Vault.',
    obtainKeyUrl: 'https://api-dashboard.search.brave.com/',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 1,
    baseBackoffMs: 1000,
    maxBackoffMs: 4000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 20,
      windowMs: 60000,
      note: 'Brave Search API subscription plan limits (X-RateLimit-Remaining honored)',
      waitOnLimit: false,
    },
    defaultPageSize: 10,
    maxPageSize: 20,
    dedupeWindowMs: 5000,
  },
  attribution: 'Brave Search API (Independent Web Index)',
  license: 'Brave Search API Commercial Terms',
  homepageUrl: 'https://brave.com/search/api/',
};

function buildSearchQueryString(request: ConnectorSearchRequest): string {
  const parts: string[] = [];
  if (request.query?.trim()) parts.push(request.query.trim());
  const prod = typeof request.filters?.productsServices === 'string' ? request.filters.productsServices.trim() : '';
  if (prod && !parts.join(' ').toLowerCase().includes(prod.toLowerCase())) parts.push(prod);
  if (request.industry?.trim() && !parts.join(' ').toLowerCase().includes(request.industry.trim().toLowerCase())) {
    parts.push(request.industry.trim());
  }
  if (request.category?.trim() && !parts.join(' ').toLowerCase().includes(request.category.trim().toLowerCase())) {
    parts.push(request.category.trim());
  }
  if (request.businessType?.trim()) parts.push(request.businessType.trim());
  if (request.city?.trim()) parts.push(request.city.trim());
  if (request.region?.trim()) parts.push(request.region.trim());
  if (request.postalCode?.trim()) parts.push(request.postalCode.trim());

  const targetDomain = (request.domain || request.website || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0];
  if (targetDomain && !parts.join(' ').toLowerCase().includes(targetDomain.toLowerCase())) {
    parts.push(`site:${targetDomain}`);
  }
  return parts.join(' ').trim();
}

function cleanCompanyTitle(rawTitle?: string, domain?: string): string {
  const t = (rawTitle || '').trim();
  if (!t) return domain || 'Unknown Business';
  // Strip common page suffix separators while keeping genuine company names intact
  const primary = t.split(/\s+(?:\||—|–|::)\s+/)[0]?.trim() || t;
  return primary.slice(0, 140);
}

function extractDomainFromUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export class BraveSearchConnector implements IConnector {
  public readonly id = 'conn-brave-search';

  constructor(
    private readonly fetchFnOverride?: typeof fetch,
    private readonly dnsLookupOverride?: DnsLookupAllFn
  ) {}

  public getMetadata(): ConnectorMetadata {
    return BRAVE_METADATA;
  }

  private requireApiKey(context: ConnectorExecutionContext): string {
    const key = context.credentials.apiKey || context.credentials.token || '';
    if (!key.trim()) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        retryable: false,
        message: 'Brave Search API subscription token is not configured in the Credential Vault.',
        remediationHint: 'Add your Brave Search API key in Connectors Hub > Credentials.',
      });
    }
    return key.trim();
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const apiKey = this.requireApiKey(context);
      const res = await executeRegistryJsonRequest<BraveSearchApiResponse>({
        providerId: this.id,
        url: `${BRAVE_ENDPOINT}?q=example&count=1`,
        headers: {
          'X-Subscription-Token': apiKey,
        },
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        knownSecrets: [apiKey],
        fetchFn: this.fetchFnOverride,
        dnsLookupAll: this.dnsLookupOverride,
      });

      const count = res.data?.web?.results?.length ?? 0;
      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: `Connected to Brave Search API (${count} probe web result received).`,
        checkedAt,
        rateLimitRemaining: res.rateLimitRemaining,
      };
    } catch (err: unknown) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState:
          classified.category === 'missing_credentials'
            ? 'authentication_required'
            : classified.category === 'authentication_failure' || classified.category === 'authorization_failure'
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
    const apiKey = this.requireApiKey(context);
    const fullQuery = buildSearchQueryString(request);
    if (!fullQuery) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'At least one search term, industry, or website domain is required for Brave Search.',
      });
    }

    const page = Math.max(1, request.page || 1);
    const offset = Math.min(9, page - 1);
    const count = Math.min(20, Math.max(1, request.pageSize || 10));

    const params = new URLSearchParams({
      q: fullQuery,
      count: String(count),
      offset: String(offset),
      safesearch: 'moderate',
    });

    if (request.countryCode && request.countryCode !== 'GLOBAL' && /^[A-Z]{2}$/i.test(request.countryCode)) {
      params.set('country', request.countryCode.toUpperCase());
    }
    if (typeof request.filters?.language === 'string' && request.filters.language.trim()) {
      params.set('search_lang', request.filters.language.trim().toLowerCase().slice(0, 5));
    }

    const res = await executeRegistryJsonRequest<BraveSearchApiResponse>({
      providerId: this.id,
      url: `${BRAVE_ENDPOINT}?${params.toString()}`,
      headers: {
        'X-Subscription-Token': apiKey,
      },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets: [apiKey],
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    const retrievedAt = new Date().toISOString();
    const rawItems = res.data?.web?.results;
    if (!Array.isArray(rawItems) && res.data?.web !== undefined) {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        retryable: false,
        knownSecrets: [apiKey],
        message: 'Brave Search API returned an unexpected web results structure.',
      });
    }

    const results: StandardizedConnectorResult[] = [];
    const seenDomains = new Set<string>();
    const targetCountry =
      request.countryCode && request.countryCode !== 'GLOBAL' ? request.countryCode.toUpperCase() : 'US';

    for (const item of rawItems || []) {
      const normalized = this.normalizeSearchItem(item, retrievedAt, {
        countryCode: targetCountry,
        city: request.city,
        region: request.region,
        industry: request.industry,
        category: request.category,
        query: fullQuery,
      });
      if (!normalized) continue;
      const domKey = normalized.company.domain || normalized.externalSourceId;
      if (seenDomains.has(domKey)) continue;
      seenDomains.add(domKey);
      results.push(normalized);
    }

    const hasMore = Boolean(res.data?.query?.more_results_available) && offset < 9 && results.length > 0;
    return {
      results,
      pagination: {
        page,
        pageSize: count,
        hasMore,
      },
      rawCount: rawItems?.length ?? 0,
      attribution: BRAVE_METADATA.attribution,
      notes: [`Queried Brave Web Search API for "${fullQuery}" (search engine results require official registry or website verification).`],
      isLiveApi: true,
      providerMetadata: {
        queryExecuted: fullQuery,
        offset,
        rateLimitRemaining: res.rateLimitRemaining,
      },
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    return this.normalizeSearchItem(raw as BraveWebResult, retrievedAt, { countryCode: 'US' });
  }

  private normalizeSearchItem(
    item: BraveWebResult,
    retrievedAt: string,
    ctx: {
      countryCode: string;
      city?: string;
      region?: string;
      industry?: string;
      category?: string;
      query?: string;
    }
  ): StandardizedConnectorResult | null {
    if (!item?.url) return null;
    const domain = extractDomainFromUrl(item.url) || item.meta_url?.hostname?.replace(/^www\./, '');
    if (!domain) return null;

    const companyName = cleanCompanyTitle(item.profile?.name || item.title, domain);
    const originUrl = `https://${domain}`;
    const snippet = item.description?.trim();

    let score = 34;
    const signals: string[] = ['Web Search Result (Brave Search Index — Unverified Entity)'];
    if (item.url.startsWith('https://')) {
      score += 4;
      signals.push('HTTPS Official Domain Candidate');
    }
    if (snippet && snippet.length > 30) {
      score += 4;
      signals.push('Search Snippet Business Description Present');
    }
    if (ctx.city || ctx.region) {
      score += 2;
    }

    return {
      providerId: this.id,
      providerName: BRAVE_METADATA.name,
      sourceCategory: 'search_engine',
      accessMode: 'live_api',
      countryCode: ctx.countryCode,
      externalSourceId: domain,
      company: {
        companyName,
        website: originUrl,
        domain,
        companyStatus: 'unknown',
        address: {
          city: ctx.city,
          region: ctx.region,
          countryCode: ctx.countryCode,
        },
        industry: ctx.industry || 'Web-Discovered Business',
        category: ctx.category || 'Search Result Candidate',
        identifiers: [
          {
            type: 'DOMAIN',
            value: domain,
            countryCode: ctx.countryCode,
            source: this.id,
            status: 'discovered',
            verified: false,
          },
        ],
        webMetadata: {
          title: item.title?.trim(),
          description: snippet,
          isHttps: item.url.startsWith('https://'),
        },
        tags: ['Web Search', 'Brave Search', ctx.countryCode].filter(Boolean),
        rawSource: {
          sourceName: BRAVE_METADATA.name,
          providerId: domain,
          url: item.url,
          retrievedAt,
          license: BRAVE_METADATA.license,
          attribution: BRAVE_METADATA.attribution,
        },
      },
      sourceUrl: item.url,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: item.page_age || item.age || retrievedAt,
        freshnessNote: 'Live Brave Search web index result (not registry-verified)',
        isRealtime: true,
      },
      verificationStatus: 'unverified',
      confidence: {
        supported: true,
        score: Math.min(48, score),
        signals,
      },
      providerMetadata: {
        searchProvider: 'brave_search',
        matchedPageUrl: item.url,
        snippet,
        query: ctx.query,
        provenanceType: 'search_provider',
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
