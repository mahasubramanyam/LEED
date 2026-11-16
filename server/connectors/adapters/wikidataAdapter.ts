import { classifyConnectorError, ConnectorError } from '../core/errors.js';
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

interface WikidataSearchHit {
  id: string;
  label?: string;
  description?: string;
  concepturi?: string;
}

interface WikidataSearchResponse {
  search?: WikidataSearchHit[];
  'search-continue'?: number;
}

interface WikidataClaimValue {
  mainsnak?: {
    datavalue?: {
      type?: string;
      value?: any;
    };
  };
}

interface WikidataEntity {
  id: string;
  labels?: Record<string, { value?: string }>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<string, WikidataClaimValue[]>;
  sitelinks?: Record<string, { url?: string; title?: string }>;
}

interface WikidataEntitiesResponse {
  entities?: Record<string, WikidataEntity>;
}

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';

// Minimal curated Wikidata Country Q-ID -> ISO 3166-1 alpha-2 mapping for fast offline resolution
const COUNTRY_QID_TO_ISO: Record<string, string> = {
  Q30: 'US',
  Q145: 'GB',
  Q20: 'NO',
  Q34: 'SE',
  Q35: 'DK',
  Q33: 'FI',
  Q183: 'DE',
  Q142: 'FR',
  Q55: 'NL',
  Q39: 'CH',
  Q27: 'IE',
  Q36: 'PL',
  Q38: 'IT',
  Q29: 'ES',
  Q45: 'PT',
  Q40: 'AT',
  Q31: 'BE',
  Q408: 'AU',
  Q664: 'NZ',
  Q16: 'CA',
  Q17: 'JP',
  Q334: 'SG',
  Q668: 'IN',
  Q155: 'BR',
  Q96: 'MX',
  Q884: 'KR',
  Q878: 'AE',
  Q851: 'SA',
  Q258: 'ZA',
};

const NON_BUSINESS_DESCRIPTION_TERMS = [
  'album',
  'song',
  'single by',
  'film',
  'movie',
  'television series',
  'video game',
  'novel',
  'book by',
  'wikimedia disambiguation',
  'disambiguation page',
  'human',
  'politician',
  'actor',
  'singer',
  'footballer',
  'municipality',
  'village in',
  'river in',
];

const BUSINESS_DESCRIPTION_TERMS = [
  'company',
  'corporation',
  'enterprise',
  'business',
  'manufacturer',
  'airline',
  'bank',
  'retailer',
  'software',
  'telecommunications',
  'conglomerate',
  'firm',
  'holding',
  'provider',
  'group',
  'inc',
  'limited',
  'ltd',
  'gmbh',
  'asa',
  's.a.',
];

// Wikidata P31 (instance of) Q-IDs known to represent companies / organizations (partial fast set)
const BUSINESS_INSTANCE_QIDS = new Set([
  'Q4830453', // business
  'Q783794', // company
  'Q6881511', // enterprise
  'Q891723', // public company
  'Q167037', // corporation
  'Q1589009', // privately held company
  'Q43229', // organization
  'Q46970', // airline
  'Q22687', // bank
  'Q134161', // joint-stock company
  'Q163740', // nonprofit organization
  'Q206652', // software company
]);

const WIKIDATA_METADATA: ConnectorMetadata = {
  id: 'conn-wikidata',
  name: 'Wikidata Global Company Directory (CC0)',
  shortName: 'Wikidata Directory',
  version: '1.0.0',
  sourceCategory: 'business_directory',
  accessMode: 'public_directory',
  description:
    'Open CC0 public business knowledge graph covering notable global corporations, brands, official websites (P856), headquarters countries (P17), inception dates, and LEI identifiers.',
  supportedCountries: ['GLOBAL'],
  supportsAllCountries: true,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: true,
  supportedIdentifierTypes: ['LEI', 'DOMAIN'],
  capabilities: ['company_search', 'registry_lookup', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions: 'Open Wikimedia / Wikidata API (CC0 1.0 Public Domain). No API key required.',
    obtainKeyUrl: 'https://www.wikidata.org/wiki/Wikidata:Data_access',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 1,
    baseBackoffMs: 700,
    maxBackoffMs: 3000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 40,
      windowMs: 60000,
      note: 'Open Wikimedia API fair-use policy with descriptive User-Agent',
      waitOnLimit: true,
    },
    defaultPageSize: 15,
    maxPageSize: 30,
    dedupeWindowMs: 5000,
  },
  attribution: 'Wikidata Contributors — CC0 1.0 Universal Public Domain',
  license: 'CC0 1.0 Universal (Public Domain Dedication)',
  homepageUrl: 'https://www.wikidata.org',
};

function getClaimString(entity: WikidataEntity, prop: string): string | undefined {
  const claims = entity.claims?.[prop];
  if (!Array.isArray(claims) || claims.length === 0) return undefined;
  const val = claims[0]?.mainsnak?.datavalue?.value;
  return typeof val === 'string' ? val.trim() : undefined;
}

function getClaimEntityIds(entity: WikidataEntity, prop: string): string[] {
  const claims = entity.claims?.[prop];
  if (!Array.isArray(claims)) return [];
  return claims
    .map((c) => c?.mainsnak?.datavalue?.value?.id)
    .filter((v): v is string => typeof v === 'string');
}

function getClaimYear(entity: WikidataEntity, prop: string): number | undefined {
  const claims = entity.claims?.[prop];
  if (!Array.isArray(claims) || claims.length === 0) return undefined;
  const timeStr = claims[0]?.mainsnak?.datavalue?.value?.time;
  if (typeof timeStr !== 'string') return undefined;
  const m = timeStr.match(/^[+-]?(\d{4})/);
  if (!m) return undefined;
  const yr = parseInt(m[1], 10);
  return yr >= 1600 && yr <= 2100 ? yr : undefined;
}

function extractDomain(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    return new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export class WikidataConnector implements IConnector {
  public readonly id = 'conn-wikidata';

  constructor(
    private readonly fetchFnOverride?: typeof fetch,
    private readonly dnsLookupOverride?: DnsLookupAllFn
  ) {}

  public getMetadata(): ConnectorMetadata {
    return WIKIDATA_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const res = await executeRegistryJsonRequest<WikidataSearchResponse>({
        providerId: this.id,
        url: `${WIKIDATA_API}?action=wbsearchentities&search=Equinor&language=en&limit=1&format=json`,
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        fetchFn: this.fetchFnOverride,
        dnsLookupAll: this.dnsLookupOverride,
      });

      const count = res.data?.search?.length ?? 0;
      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: `Connected to live Wikidata Public Company Directory (${count} probe entity resolved).`,
        checkedAt,
      };
    } catch (err: unknown) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState: 'temporarily_unavailable',
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
    const query = [
      request.query?.trim(),
      request.industry?.trim(),
      request.city?.trim(),
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'Company or organization search query is required for Wikidata directory lookup.',
      });
    }

    const page = Math.max(1, request.page || 1);
    const limit = Math.min(30, Math.max(1, request.pageSize || 15));
    const offset = (page - 1) * limit;
    const lang =
      typeof request.filters?.language === 'string' && /^[a-z]{2}$/i.test(request.filters.language.trim())
        ? request.filters.language.trim().toLowerCase()
        : 'en';

    const searchParams = new URLSearchParams({
      action: 'wbsearchentities',
      search: query,
      language: lang,
      type: 'item',
      limit: String(limit),
      continue: String(offset),
      format: 'json',
    });

    const searchRes = await executeRegistryJsonRequest<WikidataSearchResponse>({
      providerId: this.id,
      url: `${WIKIDATA_API}?${searchParams.toString()}`,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    const hits = Array.isArray(searchRes.data?.search) ? searchRes.data!.search : [];
    const candidateIds = hits
      .filter((h) => {
        const desc = (h.description || '').toLowerCase();
        if (!desc) return true;
        return !NON_BUSINESS_DESCRIPTION_TERMS.some((term) => desc.includes(term));
      })
      .map((h) => h.id)
      .slice(0, 30);

    if (candidateIds.length === 0) {
      return {
        results: [],
        pagination: { page, pageSize: limit, hasMore: false },
        rawCount: hits.length,
        attribution: WIKIDATA_METADATA.attribution,
        notes: [`No business organization entries matched "${query}" in Wikidata.`],
        isLiveApi: true,
      };
    }

    const entityParams = new URLSearchParams({
      action: 'wbgetentities',
      ids: candidateIds.join('|'),
      props: 'labels|descriptions|claims|sitelinks',
      languages: `${lang}|en`,
      format: 'json',
    });

    const entitiesRes = await executeRegistryJsonRequest<WikidataEntitiesResponse>({
      providerId: this.id,
      url: `${WIKIDATA_API}?${entityParams.toString()}`,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    const retrievedAt = new Date().toISOString();
    const entities = entitiesRes.data?.entities || {};
    const targetCountry =
      request.countryCode && request.countryCode !== 'GLOBAL' ? request.countryCode.toUpperCase() : undefined;

    const results: StandardizedConnectorResult[] = [];
    for (const qid of candidateIds) {
      const entity = entities[qid];
      if (!entity) continue;
      const normalized = this.normalizeEntity(entity, retrievedAt, lang, targetCountry);
      if (!normalized) continue;
      if (targetCountry && normalized.countryCode !== targetCountry) {
        // Keep only matching country when a single country filter was explicitly selected and P17 resolved
        const p17List = getClaimEntityIds(entity, 'P17');
        if (p17List.length > 0) continue;
      }
      results.push(normalized);
    }

    return {
      results,
      pagination: {
        page,
        pageSize: limit,
        hasMore: Boolean(searchRes.data?.['search-continue']) && hits.length >= limit,
      },
      rawCount: hits.length,
      attribution: WIKIDATA_METADATA.attribution,
      notes: [`Queried open CC0 Wikidata Directory for "${query}".`],
      isLiveApi: true,
      providerMetadata: { query, language: lang },
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const qid = request.externalId.trim().toUpperCase();
    if (!/^Q\d+$/.test(qid)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'Wikidata lookup requires a valid Q-identifier (e.g. Q312).',
      });
    }

    const params = new URLSearchParams({
      action: 'wbgetentities',
      ids: qid,
      props: 'labels|descriptions|claims|sitelinks',
      languages: 'en',
      format: 'json',
    });

    const res = await executeRegistryJsonRequest<WikidataEntitiesResponse>({
      providerId: this.id,
      url: `${WIKIDATA_API}?${params.toString()}`,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    const entity = res.data?.entities?.[qid];
    if (!entity || !entity.labels) {
      return {
        found: false,
        attribution: WIKIDATA_METADATA.attribution,
        notes: [`Wikidata entity ${qid} not found.`],
        isLiveApi: true,
      };
    }

    const normalized = this.normalizeEntity(entity, new Date().toISOString(), 'en');
    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: WIKIDATA_METADATA.attribution,
      notes: [`Resolved Wikidata organization profile ${qid} (CC0).`],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    return this.normalizeEntity(raw as WikidataEntity, retrievedAt, 'en');
  }

  private normalizeEntity(
    entity: WikidataEntity,
    retrievedAt: string,
    lang: string,
    fallbackCountry?: string
  ): StandardizedConnectorResult | null {
    if (!entity?.id) return null;
    const label = entity.labels?.[lang]?.value || entity.labels?.en?.value;
    if (!label) return null;

    const description = entity.descriptions?.[lang]?.value || entity.descriptions?.en?.value || '';
    const descLower = description.toLowerCase();
    const instanceQids = getClaimEntityIds(entity, 'P31');
    const website = getClaimString(entity, 'P856');
    const lei = getClaimString(entity, 'P1278');

    const looksBusinessByInstance = instanceQids.some((id) => BUSINESS_INSTANCE_QIDS.has(id));
    const looksBusinessByDesc = BUSINESS_DESCRIPTION_TERMS.some((term) => descLower.includes(term));
    const explicitlyNonBusiness = NON_BUSINESS_DESCRIPTION_TERMS.some((term) => descLower.includes(term));
    if (explicitlyNonBusiness && !looksBusinessByInstance) return null;
    if (!looksBusinessByInstance && !looksBusinessByDesc && !website && !lei) return null;

    const countryQids = getClaimEntityIds(entity, 'P17');
    const resolvedCountry =
      countryQids.map((q) => COUNTRY_QID_TO_ISO[q]).find(Boolean) || fallbackCountry || 'US';

    const domain = extractDomain(website);
    const foundedYear = getClaimYear(entity, 'P571');
    const sourceUrl = `https://www.wikidata.org/wiki/${encodeURIComponent(entity.id)}`;

    const identifiers: StandardizedConnectorResult['company']['identifiers'] = [];
    if (domain) {
      identifiers.push({
        type: 'DOMAIN',
        value: domain,
        countryCode: resolvedCountry,
        source: this.id,
        status: 'discovered',
        verified: false,
      });
    }
    if (lei) {
      identifiers.push({
        type: 'LEI',
        value: lei,
        countryCode: resolvedCountry,
        source: this.id,
        status: 'syntax_validated',
        verified: false,
      });
    }

    let score = 48;
    const signals = ['Public Directory Listing (Wikidata CC0 Knowledge Graph)'];
    if (website) {
      score += 10;
      signals.push('Official Website Listed (P856)');
    }
    if (lei) {
      score += 8;
      signals.push('LEI Cross-Reference Listed (P1278)');
    }
    if (foundedYear) {
      score += 2;
    }

    return {
      providerId: this.id,
      providerName: WIKIDATA_METADATA.name,
      sourceCategory: 'business_directory',
      accessMode: 'public_directory',
      countryCode: resolvedCountry,
      externalSourceId: entity.id,
      company: {
        companyName: label,
        website,
        domain,
        companyStatus: 'unknown',
        address: {
          countryCode: resolvedCountry,
        },
        foundedYear,
        industry: description ? description.slice(0, 100) : 'Publicly Cataloged Organization',
        category: 'Business Directory Entity',
        identifiers,
        webMetadata: description ? { description } : undefined,
        tags: ['Business Directory', 'Wikidata', resolvedCountry].filter(Boolean),
        rawSource: {
          sourceName: WIKIDATA_METADATA.name,
          providerId: entity.id,
          url: sourceUrl,
          retrievedAt,
          license: WIKIDATA_METADATA.license,
          attribution: WIKIDATA_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'Live Wikidata Knowledge Graph lookup',
        isRealtime: true,
      },
      verificationStatus: 'directory_listed',
      confidence: {
        supported: true,
        score: Math.min(68, score),
        signals,
      },
      providerMetadata: {
        wikidataId: entity.id,
        description,
        instanceQids,
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
