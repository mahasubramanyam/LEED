import { classifyConnectorError, classifyHttpStatus, ConnectorError } from '../core/errors.js';
import { normalizeLegalCompanyStatus } from '../core/normalizer.js';
import { connectorRegistry } from '../core/registry.js';
import { normalizeIdentifierValue, validateSingaporeUen } from '../../identifiers/identifierEngine.js';
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

interface SgAcraRecord {
  _id?: number;
  uen: string;
  issuance_agency_id?: string;
  entity_name: string;
  entity_type_desc?: string;
  business_constitution_desc?: string;
  company_type_desc?: string;
  paf_principle_desc?: string;
  entity_status_description?: string;
  uen_status_desc?: string;
  registration_incorporation_date?: string;
  uen_issue_date?: string;
  address_type?: string;
  block?: string;
  street_name?: string;
  level_no?: string;
  unit_no?: string;
  building_name?: string;
  postal_code?: string;
  reg_street_name?: string;
  reg_postal_code?: string;
  primary_ssic_code?: string;
  primary_ssic_description?: string;
}

interface SgAcraFieldMeta {
  id: string;
  type?: string;
}

interface SgAcraDatasetMetadataCache {
  resourceId: string;
  fields: string[];
  fieldTypes: Record<string, string>;
  totalRecords?: number;
  cachedAt: number;
  expiresAt: number;
}

interface SgAcraCacheEntry<T> {
  value: T;
  cachedAt: number;
  expiresAt: number;
}

export interface SgAcraConnectorOptions {
  searchCacheTtlMs?: number;
  lookupCacheTtlMs?: number;
  metadataCacheTtlMs?: number;
  defaultTimeoutMs?: number;
}

export interface SgAcraRuntimeMetrics {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  dedupedRequests: number;
  timeoutCount: number;
  lastLatencyMs?: number;
  lastTimeoutAt?: string;
  lastErrorMessage?: string;
}

const DATA_GOV_SG_API = 'https://data.gov.sg/api/action/datastore_search';
const ACRA_RESOURCE_ID = 'd_3f960c10fed6145404ca7b821f263b87';
const ACRA_DATASET_URL = `https://data.gov.sg/datasets/${ACRA_RESOURCE_ID}/view`;

const DEFAULT_SG_ACRA_TIMEOUT_MS =
  Number(process.env.SG_ACRA_TIMEOUT_MS) > 0 ? Number(process.env.SG_ACRA_TIMEOUT_MS) : 15000;
const DEFAULT_METADATA_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LOOKUP_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 150;

const ACRA_SELECT_FIELDS = [
  'uen',
  'issuance_agency_id',
  'entity_name',
  'entity_type_desc',
  'business_constitution_desc',
  'company_type_desc',
  'entity_status_description',
  'uen_status_desc',
  'registration_incorporation_date',
  'uen_issue_date',
  'block',
  'street_name',
  'level_no',
  'unit_no',
  'building_name',
  'postal_code',
  'reg_street_name',
  'reg_postal_code',
  'primary_ssic_code',
  'primary_ssic_description',
];

const ACRA_INDEXED_FILTER_FIELDS = new Set([
  'uen',
  'reg_postal_code',
  'postal_code',
  'primary_ssic_code',
  'uen_status_desc',
  'entity_status_description',
  'entity_type_desc',
]);

const SG_ACRA_METADATA: ConnectorMetadata = {
  id: 'conn-sg-acra',
  name: 'Singapore ACRA Entities (data.gov.sg)',
  shortName: 'Singapore ACRA',
  version: '4.1.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official Singapore ACRA Registered Entities open dataset via data.gov.sg (UEN, legal name, entity status, SSIC industry classification, and registered office address). Note: transactional BizFile+ officer profiles require SingPass / ACRA API Mall.',
  supportedCountries: ['SG'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportsPostalCodeFilter: true,
  supportsIndustryFilter: true,
  supportedIdentifierTypes: ['SG_UEN'],
  capabilities: ['company_search', 'registry_lookup', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions:
      'Open public government dataset via data.gov.sg CKAN DataStore API (Singapore Open Data Licence v1.0). No API key required.',
    obtainKeyUrl: ACRA_DATASET_URL,
  },
  executionPolicy: {
    timeoutMs: DEFAULT_SG_ACRA_TIMEOUT_MS,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 5000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 25,
      windowMs: 60000,
      note: 'Open data.gov.sg CKAN DataStore API, client-throttled to 25 req/min',
      waitOnLimit: false,
    },
    defaultPageSize: 15,
    maxPageSize: 50,
    dedupeWindowMs: 5000,
  },
  attribution: 'Accounting and Corporate Regulatory Authority (ACRA) via data.gov.sg',
  license: 'Singapore Open Data Licence v1.0',
  homepageUrl: ACRA_DATASET_URL,
};

export class SgAcraConnector implements IConnector {
  public readonly id = 'conn-sg-acra';
  private readonly searchCacheTtlMs: number;
  private readonly lookupCacheTtlMs: number;
  private readonly metadataCacheTtlMs: number;
  private readonly defaultTimeoutMs: number;

  private datasetMetadataCache: SgAcraDatasetMetadataCache | null = null;
  private searchCache = new Map<string, SgAcraCacheEntry<ConnectorSearchResponse>>();
  private lookupCache = new Map<string, SgAcraCacheEntry<ConnectorLookupResponse>>();
  private inflightSearch = new Map<string, Promise<ConnectorSearchResponse>>();
  private inflightLookup = new Map<string, Promise<ConnectorLookupResponse>>();
  private metrics: SgAcraRuntimeMetrics = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    dedupedRequests: 0,
    timeoutCount: 0,
  };

  constructor(options: SgAcraConnectorOptions = {}) {
    this.searchCacheTtlMs = options.searchCacheTtlMs ?? DEFAULT_SEARCH_CACHE_TTL_MS;
    this.lookupCacheTtlMs = options.lookupCacheTtlMs ?? DEFAULT_LOOKUP_CACHE_TTL_MS;
    this.metadataCacheTtlMs = options.metadataCacheTtlMs ?? DEFAULT_METADATA_CACHE_TTL_MS;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_SG_ACRA_TIMEOUT_MS;
  }

  public getMetadata(): ConnectorMetadata {
    return SG_ACRA_METADATA;
  }

  public clearCache(): void {
    this.datasetMetadataCache = null;
    this.searchCache.clear();
    this.lookupCache.clear();
  }

  public getDatasetMetadata(): SgAcraDatasetMetadataCache | null {
    if (this.datasetMetadataCache && Date.now() < this.datasetMetadataCache.expiresAt) {
      return { ...this.datasetMetadataCache, fields: [...this.datasetMetadataCache.fields] };
    }
    this.datasetMetadataCache = null;
    return null;
  }

  public getRuntimeMetrics(): SgAcraRuntimeMetrics {
    return { ...this.metrics };
  }

  private getEffectiveTimeoutMs(context: ConnectorExecutionContext): number {
    const cfgTimeout = context.config?.timeoutMs;
    if (typeof cfgTimeout === 'number' && cfgTimeout > 0) return cfgTimeout;
    const customTimeout = context.config?.customConfig?.timeoutMs;
    if (typeof customTimeout === 'number' && customTimeout > 0) return customTimeout;
    if (typeof context.timeoutMs === 'number' && context.timeoutMs > 0) return context.timeoutMs;
    return this.defaultTimeoutMs;
  }

  private updateDatasetMetadataCache(
    fields?: SgAcraFieldMeta[],
    total?: number
  ): SgAcraDatasetMetadataCache | null {
    if (!Array.isArray(fields) || fields.length === 0) {
      return this.getDatasetMetadata();
    }
    const now = Date.now();
    const fieldIds = fields.map((f) => f.id).filter(Boolean);
    const fieldTypes: Record<string, string> = {};
    for (const f of fields) {
      if (f.id && f.type) fieldTypes[f.id] = f.type;
    }
    this.datasetMetadataCache = {
      resourceId: ACRA_RESOURCE_ID,
      fields: fieldIds,
      fieldTypes,
      totalRecords: typeof total === 'number' ? total : this.datasetMetadataCache?.totalRecords,
      cachedAt: now,
      expiresAt: now + this.metadataCacheTtlMs,
    };
    return this.getDatasetMetadata();
  }

  private setBoundedCache<T>(
    map: Map<string, SgAcraCacheEntry<T>>,
    key: string,
    value: T,
    ttlMs: number
  ): SgAcraCacheEntry<T> {
    const now = Date.now();
    // Prune expired entries first
    for (const [k, v] of map.entries()) {
      if (now >= v.expiresAt) map.delete(k);
    }
    while (map.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = map.keys().next().value;
      if (!oldestKey) break;
      map.delete(oldestKey);
    }
    const entry: SgAcraCacheEntry<T> = {
      value,
      cachedAt: now,
      expiresAt: now + ttlMs,
    };
    map.set(key, entry);
    return entry;
  }

  private getSupportedFieldsParam(): string {
    const meta = this.getDatasetMetadata();
    if (meta && meta.fields.length > 0) {
      const available = new Set(meta.fields);
      const supported = ACRA_SELECT_FIELDS.filter((f) => available.has(f));
      if (supported.length > 0) return supported.join(',');
    }
    return ACRA_SELECT_FIELDS.join(',');
  }

  private filterSupportedCkanFilters(
    filters: Record<string, string>
  ): Record<string, string> {
    const meta = this.getDatasetMetadata();
    const available = meta && meta.fields.length > 0 ? new Set(meta.fields) : null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(filters)) {
      if (!v) continue;
      if (available && !available.has(k)) continue;
      if (!available && !ACRA_INDEXED_FILTER_FIELDS.has(k)) continue;
      out[k] = v;
    }
    return out;
  }

  private async fetchWithTimeout<T>(
    url: string,
    context: ConnectorExecutionContext,
    timeoutMs: number,
    ignoreCallerSignal = false
  ): Promise<{ payload: T; latencyMs: number }> {
    const start = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onCallerAbort = () => {
      controller.abort(context.signal.reason || new Error('Cancelled by caller'));
    };

    if (!ignoreCallerSignal && context.signal) {
      if (context.signal.aborted) {
        throw new ConnectorError({
          category: 'timeout',
          providerId: this.id,
          retryable: false,
          message: 'Singapore ACRA API request aborted before dispatch.',
        });
      }
      context.signal.addEventListener('abort', onCallerAbort, { once: true });
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        const elapsed = Date.now() - start;
        controller.abort(new Error(`Timed out after ${elapsed}ms`));
        reject(
          new ConnectorError({
            category: 'timeout',
            providerId: this.id,
            retryable: true,
            message: `Singapore ACRA API request timed out after ${elapsed}ms (timeout=${timeoutMs}ms).`,
            remediationHint: 'Increase SG_ACRA_TIMEOUT_MS or retry when data.gov.sg load subsides.',
          })
        );
      }, timeoutMs);
    });

    const callerAbortPromise =
      !ignoreCallerSignal && context.signal
        ? new Promise<never>((_, reject) => {
            context.signal.addEventListener(
              'abort',
              () => {
                reject(
                  new ConnectorError({
                    category: 'timeout',
                    providerId: this.id,
                    retryable: false,
                    message: `Singapore ACRA API request cancelled after ${Date.now() - start}ms.`,
                  })
                );
              },
              { once: true }
            );
          })
        : null;

    this.metrics.totalRequests += 1;

    try {
      const fetchAndParse = async (): Promise<T> => {
        const response = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': context.userAgent,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const httpClass = classifyHttpStatus(response.status);
          throw new ConnectorError({
            category: httpClass.category,
            providerId: this.id,
            httpStatus: response.status,
            retryable: httpClass.retryable,
            message: `Singapore ACRA API returned HTTP ${response.status}: ${response.statusText}`,
            remediationHint: httpClass.remediationHint,
          });
        }

        try {
          return (await response.json()) as T;
        } catch (parseErr) {
          if (timedOut) {
            throw new ConnectorError({
              category: 'timeout',
              providerId: this.id,
              retryable: true,
              message: `Singapore ACRA API response timed out while reading JSON after ${Date.now() - start}ms.`,
            });
          }
          throw new ConnectorError({
            category: 'invalid_response',
            providerId: this.id,
            retryable: false,
            message: `Singapore ACRA API returned malformed JSON payload: ${
              parseErr instanceof Error ? parseErr.message : String(parseErr)
            }`,
          });
        }
      };

      const racers: Promise<T>[] = [fetchAndParse(), timeoutPromise];
      if (callerAbortPromise) racers.push(callerAbortPromise);
      const payload = await Promise.race(racers);
      const latencyMs = Date.now() - start;
      this.metrics.lastLatencyMs = latencyMs;
      return { payload, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      this.metrics.lastLatencyMs = latencyMs;
      if (timedOut || (err instanceof ConnectorError && err.category === 'timeout')) {
        this.metrics.timeoutCount += 1;
        this.metrics.lastTimeoutAt = new Date().toISOString();
      }
      this.metrics.lastErrorMessage = err instanceof Error ? err.message : String(err);
      if (err instanceof ConnectorError) throw err;
      const classified = this.classifyError(err);
      throw new ConnectorError({
        category: classified.category,
        providerId: this.id,
        httpStatus: classified.httpStatus,
        retryable: classified.retryable,
        message: `${classified.safeMessage} (${latencyMs}ms)`,
        remediationHint: classified.remediationHint,
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (!ignoreCallerSignal && context.signal) {
        context.signal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  private async awaitWithCallerSignal<T>(
    promise: Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) {
      throw new ConnectorError({
        category: 'timeout',
        providerId: this.id,
        retryable: false,
        message: 'Singapore ACRA request cancelled by caller.',
      });
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(
          new ConnectorError({
            category: 'timeout',
            providerId: this.id,
            retryable: false,
            message: 'Singapore ACRA request cancelled by caller.',
          })
        );
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (val) => {
          signal.removeEventListener('abort', onAbort);
          resolve(val);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const timeoutMs = this.getEffectiveTimeoutMs(context);
    try {
      const url = new URL(DATA_GOV_SG_API);
      url.searchParams.set('resource_id', ACRA_RESOURCE_ID);
      url.searchParams.set('limit', '1');

      const { payload, latencyMs } = await this.fetchWithTimeout<{
        success?: boolean;
        result?: {
          fields?: SgAcraFieldMeta[];
          total?: number;
        };
      }>(url.toString(), context, timeoutMs);

      if (payload.success === false) {
        return {
          ok: false,
          healthState: 'temporarily_unavailable',
          latencyMs,
          isLiveApi: true,
          errorCategory: 'provider_unavailable',
          message: 'data.gov.sg ACRA endpoint reported datastore unavailable.',
          checkedAt,
        };
      }

      this.updateDatasetMetadataCache(payload.result?.fields, payload.result?.total);

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `Singapore ACRA open dataset API reachable (${latencyMs}ms).`,
        checkedAt,
      };
    } catch (err) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState: classified.category === 'rate_limited' ? 'rate_limited' : 'temporarily_unavailable',
        latencyMs: Date.now() - start,
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
    const query = request.query.replace(/\s+/g, ' ').trim();
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Search query cannot be empty.',
      });
    }

    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(
      SG_ACRA_METADATA.executionPolicy.maxPageSize,
      Math.max(1, request.pageSize || SG_ACRA_METADATA.executionPolicy.defaultPageSize)
    );
    const offset = (page - 1) * pageSize;

    const postalFilter = request.postalCode?.trim().toLowerCase() || '';
    const industryFilter = (request.industry || request.category || request.businessType || '')
      .trim()
      .toLowerCase();

    // Build selective CKAN query, avoiding unnecessary full-text `q` when indexed filters apply
    const rawCkanFilters: Record<string, string> = {};
    let useFullTextQ = false;
    let queryStrategy = 'full_text_search';
    const compactQuery = query.replace(/\s+/g, '');

    if (validateSingaporeUen(query)) {
      rawCkanFilters.uen = normalizeIdentifierValue(query);
      queryStrategy = 'indexed_uen_filter';
    } else if (/^\d{6}$/.test(compactQuery)) {
      rawCkanFilters.reg_postal_code = compactQuery;
      queryStrategy = 'indexed_postal_filter';
    } else if (/^\d{5}$/.test(compactQuery)) {
      rawCkanFilters.primary_ssic_code = compactQuery;
      queryStrategy = 'indexed_ssic_filter';
    } else {
      useFullTextQ = true;
      if (request.filters) {
        for (const [k, v] of Object.entries(request.filters)) {
          if (typeof v === 'string' && v.trim() && ACRA_INDEXED_FILTER_FIELDS.has(k)) {
            rawCkanFilters[k] = v.trim();
          }
        }
      }
      if (/^\d{5}$/.test(industryFilter)) {
        rawCkanFilters.primary_ssic_code = industryFilter;
      }
    }

    const ckanFilters = this.filterSupportedCkanFilters(rawCkanFilters);
    const cacheKey = JSON.stringify({
      resourceId: ACRA_RESOURCE_ID,
      strategy: queryStrategy,
      q: useFullTextQ ? query.toLowerCase() : undefined,
      filters: ckanFilters,
      page,
      pageSize,
      postalFilter,
      industryFilter,
      region: request.region?.trim().toLowerCase() || '',
    });

    const cached = this.searchCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this.metrics.cacheHits += 1;
      return {
        ...cached.value,
        providerMetadata: {
          ...(cached.value.providerMetadata || {}),
          cacheHit: true,
          cachedAt: new Date(cached.cachedAt).toISOString(),
          expiresAt: new Date(cached.expiresAt).toISOString(),
          latencyMs: 0,
        },
      };
    }
    if (cached) {
      this.searchCache.delete(cacheKey);
    }

    const existingInflight = this.inflightSearch.get(cacheKey);
    if (existingInflight) {
      this.metrics.dedupedRequests += 1;
      const shared = await this.awaitWithCallerSignal(existingInflight, context.signal);
      return {
        ...shared,
        providerMetadata: {
          ...(shared.providerMetadata || {}),
          deduped: true,
        },
      };
    }

    this.metrics.cacheMisses += 1;
    const timeoutMs = this.getEffectiveTimeoutMs(context);

    const runSearch = async (): Promise<ConnectorSearchResponse> => {
      const url = new URL(DATA_GOV_SG_API);
      url.searchParams.set('resource_id', ACRA_RESOURCE_ID);
      url.searchParams.set('limit', String(pageSize));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('fields', this.getSupportedFieldsParam());

      if (Object.keys(ckanFilters).length > 0) {
        url.searchParams.set('filters', JSON.stringify(ckanFilters));
      }
      if (useFullTextQ) {
        url.searchParams.set('q', query);
      }

      const { payload, latencyMs } = await this.fetchWithTimeout<{
        success?: boolean;
        error?: { message?: string };
        result?: {
          fields?: SgAcraFieldMeta[];
          records?: SgAcraRecord[];
          total?: number;
        };
      }>(url.toString(), context, timeoutMs, true);

      if (payload.success === false) {
        throw new ConnectorError({
          category: 'provider_unavailable',
          providerId: this.id,
          retryable: true,
          message: `Singapore ACRA CKAN DataStore reported failure${
            payload.error?.message ? `: ${payload.error.message}` : ''
          }.`,
        });
      }

      if (!payload.result || !Array.isArray(payload.result.records)) {
        throw new ConnectorError({
          category: 'invalid_response',
          providerId: this.id,
          retryable: false,
          message: 'Singapore ACRA CKAN DataStore response missing result.records array.',
        });
      }

      const metaSnapshot = this.updateDatasetMetadataCache(
        payload.result.fields,
        payload.result.total
      );

      const records = payload.result.records;
      const upstreamTotal = payload.result.total;
      if (typeof upstreamTotal === 'number' && offset < upstreamTotal && records.length === 0) {
        throw new ConnectorError({
          category: 'invalid_response',
          providerId: this.id,
          retryable: true,
          message: `Singapore ACRA CKAN returned 0 records at offset ${offset} despite total=${upstreamTotal}; refusing to return partial results as complete.`,
        });
      }

      const retrievedAt = new Date().toISOString();
      const filtered = records.filter((rec) => {
        const post = (rec.reg_postal_code || rec.postal_code || '').toLowerCase();
        if (postalFilter && !post.startsWith(postalFilter)) return false;
        if (industryFilter) {
          const hay = `${rec.primary_ssic_description || ''} ${rec.primary_ssic_code || ''} ${
            rec.entity_type_desc || ''
          }`.toLowerCase();
          if (!hay.includes(industryFilter)) return false;
        }
        return true;
      });

      const seenUens = new Set<string>();
      const results: StandardizedConnectorResult[] = [];
      for (const rec of filtered) {
        const norm = this.normalizeResult(rec, retrievedAt);
        if (!norm) continue;
        if (seenUens.has(norm.externalSourceId)) continue;
        seenUens.add(norm.externalSourceId);
        results.push(norm);
      }

      const totalItems = typeof upstreamTotal === 'number' ? upstreamTotal : undefined;
      const totalPages =
        typeof totalItems === 'number' ? Math.max(1, Math.ceil(totalItems / pageSize)) : undefined;
      const hasMore =
        typeof totalItems === 'number'
          ? offset + records.length < totalItems && records.length > 0
          : records.length >= pageSize;

      const notes: string[] = [];
      if (request.region?.trim()) {
        notes.push(`Singapore is a city-state; region filter "${request.region.trim()}" is not required.`);
      }

      const responseObj: ConnectorSearchResponse = {
        results,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
          hasMore,
        },
        rawCount: records.length,
        attribution: SG_ACRA_METADATA.attribution,
        notes,
        isLiveApi: true,
        providerMetadata: {
          queryStrategy,
          ckanFilters,
          usedFullTextQ: useFullTextQ,
          latencyMs,
          timeoutMs,
          cacheHit: false,
          deduped: false,
          datasetMetadataCached: Boolean(metaSnapshot),
          datasetFieldCount: metaSnapshot?.fields.length ?? 0,
        },
      };

      const entry = this.setBoundedCache(
        this.searchCache,
        cacheKey,
        responseObj,
        this.searchCacheTtlMs
      );
      return {
        ...responseObj,
        providerMetadata: {
          ...responseObj.providerMetadata,
          cachedAt: new Date(entry.cachedAt).toISOString(),
          expiresAt: new Date(entry.expiresAt).toISOString(),
        },
      };
    };

    const inflightPromise = runSearch().finally(() => {
      this.inflightSearch.delete(cacheKey);
    });
    this.inflightSearch.set(cacheKey, inflightPromise);

    return this.awaitWithCallerSignal(inflightPromise, context.signal);
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const cleanUen = normalizeIdentifierValue(request.externalId);
    if (!validateSingaporeUen(cleanUen)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: `Invalid Singapore UEN "${request.externalId}". Expected 9 or 10 character ACRA UEN format.`,
      });
    }

    const cacheKey = `uen:${cleanUen}`;
    const cached = this.lookupCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      this.metrics.cacheHits += 1;
      return {
        ...cached.value,
        providerMetadata: {
          ...(cached.value.providerMetadata || {}),
          cacheHit: true,
          cachedAt: new Date(cached.cachedAt).toISOString(),
          expiresAt: new Date(cached.expiresAt).toISOString(),
          latencyMs: 0,
        },
      };
    }
    if (cached) {
      this.lookupCache.delete(cacheKey);
    }

    const existingInflight = this.inflightLookup.get(cacheKey);
    if (existingInflight) {
      this.metrics.dedupedRequests += 1;
      const shared = await this.awaitWithCallerSignal(existingInflight, context.signal);
      return {
        ...shared,
        providerMetadata: {
          ...(shared.providerMetadata || {}),
          deduped: true,
        },
      };
    }

    this.metrics.cacheMisses += 1;
    const timeoutMs = this.getEffectiveTimeoutMs(context);

    const runLookup = async (): Promise<ConnectorLookupResponse> => {
      const url = new URL(DATA_GOV_SG_API);
      url.searchParams.set('resource_id', ACRA_RESOURCE_ID);
      url.searchParams.set('filters', JSON.stringify({ uen: cleanUen }));
      url.searchParams.set('limit', '1');
      url.searchParams.set('fields', this.getSupportedFieldsParam());

      const { payload, latencyMs } = await this.fetchWithTimeout<{
        success?: boolean;
        error?: { message?: string };
        result?: { fields?: SgAcraFieldMeta[]; records?: SgAcraRecord[]; total?: number };
      }>(url.toString(), context, timeoutMs, true);

      if (payload.success === false) {
        throw new ConnectorError({
          category: 'provider_unavailable',
          providerId: this.id,
          retryable: true,
          message: `Singapore ACRA UEN lookup reported failure${
            payload.error?.message ? `: ${payload.error.message}` : ''
          }.`,
        });
      }

      if (!payload.result || !Array.isArray(payload.result.records)) {
        throw new ConnectorError({
          category: 'invalid_response',
          providerId: this.id,
          retryable: false,
          message: 'Singapore ACRA UEN lookup missing result.records array.',
        });
      }

      this.updateDatasetMetadataCache(payload.result.fields, payload.result.total);

      const record = payload.result.records[0];
      if (!record) {
        const notFoundRes: ConnectorLookupResponse = {
          found: false,
          attribution: SG_ACRA_METADATA.attribution,
          notes: [`UEN ${cleanUen} not found in ACRA open dataset.`],
          isLiveApi: true,
          providerMetadata: {
            latencyMs,
            timeoutMs,
            cacheHit: false,
            deduped: false,
          },
        };
        this.setBoundedCache(this.lookupCache, cacheKey, notFoundRes, this.lookupCacheTtlMs);
        return notFoundRes;
      }

      const result = this.normalizeResult(record, new Date().toISOString()) || undefined;
      const foundRes: ConnectorLookupResponse = {
        found: Boolean(result),
        result,
        attribution: SG_ACRA_METADATA.attribution,
        notes: [],
        isLiveApi: true,
        providerMetadata: {
          latencyMs,
          timeoutMs,
          cacheHit: false,
          deduped: false,
        },
      };
      this.setBoundedCache(this.lookupCache, cacheKey, foundRes, this.lookupCacheTtlMs);
      return foundRes;
    };

    const inflightPromise = runLookup().finally(() => {
      this.inflightLookup.delete(cacheKey);
    });
    this.inflightLookup.set(cacheKey, inflightPromise);

    return this.awaitWithCallerSignal(inflightPromise, context.signal);
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const r = raw as SgAcraRecord;
    if (!r || !r.uen || !r.entity_name) return null;

    const uen = normalizeIdentifierValue(r.uen);
    const rawStatus = r.uen_status_desc || r.entity_status_description;
    const companyStatus = normalizeLegalCompanyStatus(rawStatus);

    const streetParts = [
      r.block ? `Blk ${r.block}` : undefined,
      r.reg_street_name || r.street_name,
      r.level_no && r.unit_no ? `#${r.level_no}-${r.unit_no}` : undefined,
      r.building_name,
    ].filter(Boolean);
    const street = streetParts.length > 0 ? streetParts.join(' ') : undefined;
    const postalCode = (r.reg_postal_code || r.postal_code || '').trim() || undefined;
    const regDate = r.registration_incorporation_date || r.uen_issue_date;
    const foundedYear = regDate ? parseInt(regDate.slice(0, 4), 10) : undefined;

    const signals = ['Official Singapore ACRA Registry Record (UEN Verified)'];
    let score = 68;
    if (companyStatus === 'active') {
      score += 10;
      signals.push(`Active ACRA Registration Status (${rawStatus})`);
    } else if (companyStatus === 'dissolved' || companyStatus === 'inactive') {
      signals.push(`ACRA Status: ${rawStatus}`);
    }
    if (street || postalCode) {
      score += 12;
      signals.push('Registered Singapore Office Address on File');
    }
    if (r.primary_ssic_description || r.primary_ssic_code) {
      score += 10;
      signals.push(`SSIC Classification: ${r.primary_ssic_code || r.primary_ssic_description}`);
    }

    return {
      providerId: this.id,
      providerName: SG_ACRA_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'SG',
      externalSourceId: uen,
      company: {
        companyName: r.entity_name,
        legalName: r.entity_name,
        registrationNumber: uen,
        registrationType: 'SG_UEN',
        companyStatus,
        address: {
          street,
          city: 'Singapore',
          postalCode,
          country: 'Singapore',
          countryCode: 'SG',
        },
        industry: r.primary_ssic_description || 'Corporate & Commercial Services',
        category: r.entity_type_desc || r.company_type_desc || 'Singapore Entity',
        foundedYear: Number.isFinite(foundedYear) ? foundedYear : undefined,
        identifiers: [
          {
            type: 'SG_UEN',
            value: uen,
            normalizedValue: uen,
            countryCode: 'SG',
            issuingAuthority: 'Accounting and Corporate Regulatory Authority (ACRA)',
            source: 'sg_datagov_acra',
            status: 'officially_verified',
            verified: true,
          },
        ],
        tags: ['Singapore', 'ACRA', r.entity_type_desc || 'UEN'].filter(Boolean),
        rawSource: {
          sourceName: SG_ACRA_METADATA.name,
          providerId: uen,
          url: ACRA_DATASET_URL,
          retrievedAt,
          license: SG_ACRA_METADATA.license,
          attribution: SG_ACRA_METADATA.attribution,
        },
      },
      sourceUrl: ACRA_DATASET_URL,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'ACRA open dataset via data.gov.sg DataStore API',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score,
        signals,
      },
      providerMetadata: {
        uen,
        uenStatusLabel: rawStatus,
        uenStatusDesc: r.uen_status_desc,
        entityStatusDescription: r.entity_status_description,
        rawRegistryStatus: rawStatus,
        entityType: r.entity_type_desc,
        primarySsicCode: r.primary_ssic_code,
        issuanceAgency: r.issuance_agency_id,
        rawApiRecord: r,
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
