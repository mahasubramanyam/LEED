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

interface GoogleCseItem {
  title?: string;
  link?: string;
  displayLink?: string;
  snippet?: string;
}

interface GoogleCseResponse {
  searchInformation?: {
    totalResults?: string;
  };
  queries?: {
    nextPage?: Array<{ startIndex?: number }>;
  };
  items?: GoogleCseItem[];
  error?: {
    code?: number;
    message?: string;
  };
}

const GOOGLE_CSE_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

const GOOGLE_CSE_METADATA: ConnectorMetadata = {
  id: 'conn-google-cse',
  name: 'Google Programmable Search JSON API (Legacy)',
  shortName: 'Google CSE',
  version: '1.0.0',
  sourceCategory: 'search_engine',
  accessMode: 'live_api',
  description:
    'Google Custom Search JSON API for owners with existing legacy API key & Search Engine ID (cx). Closed to new customers and scheduled for discontinuation Jan 1, 2027.',
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
        label: 'Google Custom Search API Key',
        required: true,
        secret: true,
        placeholder: 'AIza...',
        helpText: 'Existing Google Cloud API key with Custom Search API enabled.',
      },
      {
        key: 'cx',
        label: 'Programmable Search Engine ID (cx)',
        required: true,
        secret: false,
        placeholder: '0123456789abcdef:xyz',
        helpText: 'Configured Programmable Search Engine identifier.',
      },
    ],
    envFallbackKeys: ['GOOGLE_CSE_API_KEY', 'GOOGLE_CSE_CX'],
    setupInstructions:
      'Enter an existing Google Custom Search API Key and cx Engine ID. Note: Google closed Custom Search JSON API to new customers and plans discontinuation on January 1, 2027.',
    obtainKeyUrl: 'https://developers.google.com/custom-search/v1/overview',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 1,
    baseBackoffMs: 1000,
    maxBackoffMs: 4000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 15,
      windowMs: 60000,
      note: '100 free queries/day legacy quota (10k/day max)',
      waitOnLimit: false,
    },
    defaultPageSize: 10,
    maxPageSize: 10,
    dedupeWindowMs: 5000,
  },
  attribution: 'Google Programmable Search JSON API',
  license: 'Google APIs Terms of Service (Sunsetting Jan 1, 2027)',
  homepageUrl: 'https://developers.google.com/custom-search/v1/overview',
};

function buildGoogleQuery(request: ConnectorSearchRequest): string {
  const parts: string[] = [];
  if (request.query?.trim()) parts.push(request.query.trim());
  const prod = typeof request.filters?.productsServices === 'string' ? request.filters.productsServices.trim() : '';
  if (prod && !parts.join(' ').toLowerCase().includes(prod.toLowerCase())) parts.push(prod);
  if (request.industry?.trim() && !parts.join(' ').toLowerCase().includes(request.industry.trim().toLowerCase())) {
    parts.push(request.industry.trim());
  }
  if (request.businessType?.trim()) parts.push(request.businessType.trim());
  if (request.city?.trim()) parts.push(request.city.trim());
  if (request.region?.trim()) parts.push(request.region.trim());
  if (request.postalCode?.trim()) parts.push(request.postalCode.trim());
  const dom = (request.domain || request.website || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0];
  if (dom) parts.push(`site:${dom}`);
  return parts.join(' ').trim();
}

export class GoogleCseConnector implements IConnector {
  public readonly id = 'conn-google-cse';

  constructor(
    private readonly fetchFnOverride?: typeof fetch,
    private readonly dnsLookupOverride?: DnsLookupAllFn
  ) {}

  public getMetadata(): ConnectorMetadata {
    return GOOGLE_CSE_METADATA;
  }

  private requireCredentials(context: ConnectorExecutionContext): { apiKey: string; cx: string } {
    const apiKey = (context.credentials.apiKey || '').trim();
    const cx = (context.credentials.cx || process.env.GOOGLE_CSE_CX || '').trim();
    if (!apiKey || !cx) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        retryable: false,
        message: 'Google Custom Search requires both an API key (apiKey) and Search Engine ID (cx) in the Credential Vault.',
        remediationHint: 'Configure existing Google CSE apiKey and cx in Connectors Hub, or use Brave Search API.',
      });
    }
    return { apiKey, cx };
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const { apiKey, cx } = this.requireCredentials(context);
      const params = new URLSearchParams({ key: apiKey, cx, q: 'example', num: '1' });
      const res = await executeRegistryJsonRequest<GoogleCseResponse>({
        providerId: this.id,
        url: `${GOOGLE_CSE_ENDPOINT}?${params.toString()}`,
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        knownSecrets: [apiKey, cx],
        fetchFn: this.fetchFnOverride,
        dnsLookupAll: this.dnsLookupOverride,
      });

      const count = res.data?.items?.length ?? 0;
      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: `Connected to Google Programmable Search JSON API (${count} probe result; legacy API sunsetting Jan 1, 2027).`,
        checkedAt,
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
    const { apiKey, cx } = this.requireCredentials(context);
    const fullQuery = buildGoogleQuery(request);
    if (!fullQuery) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'At least one search term or domain is required for Google Custom Search.',
      });
    }

    const page = Math.max(1, request.page || 1);
    const num = Math.min(10, Math.max(1, request.pageSize || 10));
    const startIndex = Math.min(91, (page - 1) * num + 1);

    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q: fullQuery,
      num: String(num),
      start: String(startIndex),
    });

    if (request.countryCode && request.countryCode !== 'GLOBAL' && /^[A-Z]{2}$/i.test(request.countryCode)) {
      params.set('gl', request.countryCode.toLowerCase());
    }
    if (typeof request.filters?.language === 'string' && /^[a-z]{2}$/i.test(request.filters.language.trim())) {
      params.set('lr', `lang_${request.filters.language.trim().toLowerCase()}`);
    }

    const res = await executeRegistryJsonRequest<GoogleCseResponse>({
      providerId: this.id,
      url: `${GOOGLE_CSE_ENDPOINT}?${params.toString()}`,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets: [apiKey, cx],
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    if (res.data?.error) {
      throw new ConnectorError({
        category: res.data.error.code === 429 ? 'rate_limited' : 'unknown_provider_error',
        providerId: this.id,
        httpStatus: res.data.error.code,
        knownSecrets: [apiKey, cx],
        message: res.data.error.message || 'Google Custom Search returned an API error.',
      });
    }

    const retrievedAt = new Date().toISOString();
    const rawItems = Array.isArray(res.data?.items) ? res.data!.items : [];
    const targetCountry =
      request.countryCode && request.countryCode !== 'GLOBAL' ? request.countryCode.toUpperCase() : 'US';

    const results: StandardizedConnectorResult[] = [];
    const seenDomains = new Set<string>();

    for (const item of rawItems) {
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

    const totalItems = res.data?.searchInformation?.totalResults
      ? Math.min(100, parseInt(res.data.searchInformation.totalResults, 10) || results.length)
      : results.length;
    const hasMore = Boolean(res.data?.queries?.nextPage?.length) && startIndex + num <= 100;

    return {
      results,
      pagination: {
        page,
        pageSize: num,
        totalItems,
        hasMore,
      },
      rawCount: rawItems.length,
      attribution: GOOGLE_CSE_METADATA.attribution,
      notes: [
        `Queried Google Programmable Search JSON API for "${fullQuery}". Results are unverified web index matches; inspect websites or run official registry verification.`,
      ],
      isLiveApi: true,
      providerMetadata: {
        queryExecuted: fullQuery,
        startIndex,
      },
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    return this.normalizeSearchItem(raw as GoogleCseItem, retrievedAt, { countryCode: 'US' });
  }

  private normalizeSearchItem(
    item: GoogleCseItem,
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
    if (!item?.link) return null;
    let domain = item.displayLink?.toLowerCase().replace(/^www\./, '');
    if (!domain) {
      try {
        domain = new URL(item.link).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return null;
      }
    }

    const rawTitle = (item.title || domain).trim();
    const companyName = (rawTitle.split(/\s+(?:\||—|–|::)\s+/)[0]?.trim() || rawTitle).slice(0, 140);
    const snippet = item.snippet?.trim();
    const originUrl = `https://${domain}`;

    let score = 34;
    const signals = ['Web Search Result (Google CSE — Unverified Entity)'];
    if (item.link.startsWith('https://')) {
      score += 4;
      signals.push('HTTPS Domain Candidate');
    }
    if (snippet && snippet.length > 30) {
      score += 4;
      signals.push('Search Snippet Description Present');
    }

    return {
      providerId: this.id,
      providerName: GOOGLE_CSE_METADATA.name,
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
          title: rawTitle,
          description: snippet,
          isHttps: item.link.startsWith('https://'),
        },
        tags: ['Web Search', 'Google CSE', ctx.countryCode].filter(Boolean),
        rawSource: {
          sourceName: GOOGLE_CSE_METADATA.name,
          providerId: domain,
          url: item.link,
          retrievedAt,
          license: GOOGLE_CSE_METADATA.license,
          attribution: GOOGLE_CSE_METADATA.attribution,
        },
      },
      sourceUrl: item.link,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'Google Programmable Search index result (not registry-verified)',
        isRealtime: true,
      },
      verificationStatus: 'unverified',
      confidence: {
        supported: true,
        score: Math.min(48, score),
        signals,
      },
      providerMetadata: {
        searchProvider: 'google_cse',
        matchedPageUrl: item.link,
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
