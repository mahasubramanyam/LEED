import crypto from 'node:crypto';
import {
  AttributeProvenanceEntry,
  CanonicalLead,
  DiscoveryConnectorSummary,
  DiscoveryDuplicateInfo,
  DiscoveryPagination,
  DiscoverySearchRequest,
  DiscoverySearchResponse,
} from '../types.js';
import {
  ConnectorError,
  redactSecrets,
} from '../connectors/core/errors.js';
import {
  ConnectorExecutionEngine,
  connectorExecutionEngine as defaultExecutionEngine,
  RunRecorderFn,
} from '../connectors/core/executionEngine.js';
import {
  ConnectorRegistry,
  connectorRegistry as defaultRegistry,
} from '../connectors/core/registry.js';
import {
  ConnectorConfigRecord,
  ConnectorRunRecord,
  IConnector,
  SourceCategory,
} from '../connectors/core/types.js';
import { detectDiscoveryDuplicates } from '../connectors/dedupeEngine.js';
import { inspectWebsite, WebInspectionResult } from '../connectors/webInspector.js';
import { analyzeLeadWithAi, extractBusinessIntelFromWebEvidence } from '../gemini.js';
import { buildCsvDocument } from '../../shared/csvUtils.js';
import { canonicalizeIdentifierType } from '../../shared/identifierRegistry.js';

export interface DiscoveryExecutionDeps {
  registry?: ConnectorRegistry;
  executionEngine?: ConnectorExecutionEngine;
  configs?: Record<string, ConnectorConfigRecord>;
  configuredConnectorIds?: Set<string>;
  userAgent?: string;
  existingCrmLeads?: CanonicalLead[];
  onRecordRun?: RunRecorderFn;
  inspectWebsiteFn?: typeof inspectWebsite;
  analyzeLeadWithAiFn?: typeof analyzeLeadWithAi;
  extractWebIntelFn?: typeof extractBusinessIntelFromWebEvidence;
}

export interface SearchSessionRecord {
  searchId: string;
  requestId: string;
  createdAt: number;
  leads: CanonicalLead[];
  duplicateInfoByLeadId: Record<string, DiscoveryDuplicateInfo>;
  counts: {
    totalUnique: number;
    existingCrmMatches: number;
    ambiguousMatches: number;
    crossSourceCorroborations: number;
  };
  connectorSummaries: DiscoveryConnectorSummary[];
  selectedConnectorIds: string[];
  errors: string[];
  errorDetails: Array<{ connectorId: string; category: string; message: string }>;
  attribution: string;
  providerNote: string;
  abnLookupInfo?: {
    isLiveApi: boolean;
    lookupMode: string;
    isChecksumValid?: boolean;
  };
  appliedFilters: DiscoverySearchResponse['appliedFilters'];
  cancelled: boolean;
  durationMs: number;
}

export interface PaginatedResultsOptions {
  page?: number;
  pageSize?: number;
  duplicateFilter?: 'all' | 'unique' | 'existing_crm' | 'ambiguous';
  connectorId?: string;
  countryCode?: string;
  minConfidence?: number;
  sortBy?: 'confidence_desc' | 'name_asc';
}

const MAX_SESSIONS = 40;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_QUERIES_PER_BULK = 15;
const MAX_COUNTRIES_PER_SEARCH = 10;
const MAX_CONCURRENT_TASKS = 4;

interface SearchTask {
  connector: IConnector;
  countryCode?: string;
  query: string;
  isFallback?: boolean;
}

function normalizeSearchTaskQueries(req: DiscoverySearchRequest): string[] {
  const candidates: string[] = [];
  if (Array.isArray(req.queries)) {
    for (const q of req.queries) {
      if (typeof q === 'string' && q.trim()) candidates.push(q.trim());
    }
  }
  if (Array.isArray(req.keywords)) {
    for (const kw of req.keywords) {
      if (typeof kw === 'string' && kw.trim()) candidates.push(kw.trim());
    }
  }
  if (typeof req.query === 'string' && req.query.trim()) {
    // Support newline/semicolon separated query input transparently if passed inside query
    for (const line of req.query.split(/[\r\n;]+/)) {
      const cleaned = line.trim();
      if (cleaned) candidates.push(cleaned);
    }
  }
  if (candidates.length === 0) {
    const fallbackTerm =
      req.productsServices?.trim() ||
      req.industry?.trim() ||
      req.category?.trim() ||
      req.businessType?.trim() ||
      req.domain?.trim() ||
      req.website?.trim();
    if (fallbackTerm) candidates.push(fallbackTerm);
  }

  return Array.from(new Set(candidates)).slice(0, MAX_QUERIES_PER_BULK);
}

function normalizeTargetCountries(req: DiscoverySearchRequest): Array<string | undefined> {
  const rawList: string[] = [];
  if (Array.isArray(req.countryCodes)) {
    for (const c of req.countryCodes) {
      if (typeof c === 'string' && c.trim()) rawList.push(c.trim().toUpperCase());
    }
  }
  if (typeof req.countryCode === 'string' && req.countryCode.trim()) {
    rawList.push(req.countryCode.trim().toUpperCase());
  }

  const deduped = Array.from(new Set(rawList)).filter((c) => c !== 'GLOBAL');
  if (deduped.length === 0) {
    return [undefined]; // Global search
  }
  return deduped.slice(0, MAX_COUNTRIES_PER_SEARCH);
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  signal: AbortSignal,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let nextIdx = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  const runners = Array.from({ length: workerCount }, async () => {
    while (nextIdx < items.length) {
      if (signal.aborted) break;
      const current = nextIdx++;
      if (current >= items.length) break;
      await worker(items[current]);
    }
  });

  await Promise.all(runners);
}

export class DiscoveryService {
  private sessions = new Map<string, SearchSessionRecord>();
  private activeControllers = new Map<string, AbortController>();
  private inflightSearches = new Map<string, Promise<DiscoverySearchResponse>>();

  private pruneExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
    while (this.sessions.size > MAX_SESSIONS) {
      const oldestKey = this.sessions.keys().next().value;
      if (!oldestKey) break;
      this.sessions.delete(oldestKey);
    }
  }

  public getSession(searchId: string): SearchSessionRecord | undefined {
    this.pruneExpiredSessions();
    return this.sessions.get(searchId);
  }

  public getActiveSearchIds(): string[] {
    return Array.from(this.activeControllers.keys());
  }

  public cancelSearch(requestId: string): boolean {
    const controller = this.activeControllers.get(requestId);
    if (!controller) return false;
    controller.abort(new Error(`Discovery search ${requestId} cancelled by owner`));
    this.activeControllers.delete(requestId);
    return true;
  }

  public selectConnectorsForTarget(
    countryCode: string | undefined,
    req: DiscoverySearchRequest,
    registry: ConnectorRegistry,
    configs: Record<string, ConnectorConfigRecord>,
    configuredConnectorIds?: Set<string>
  ): {
    selected: IConnector[];
    skipped: Array<{ connectorId: string; connectorName: string; reason: string }>;
  } {
    const explicitIds = Array.from(
      new Set([
        ...(Array.isArray(req.connectorIds) ? req.connectorIds : []),
        ...(req.connectorId ? [req.connectorId] : []),
      ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0))
    );

    const skipped: Array<{ connectorId: string; connectorName: string; reason: string }> = [];

    const isEnabled = (id: string) => {
      if (configs[id] && typeof configs[id].enabled === 'boolean') {
        return configs[id].enabled;
      }
      return registry.isEnabled(id);
    };

    if (explicitIds.length > 0 && req.selectionMode !== 'auto') {
      const selected: IConnector[] = [];
      for (const id of explicitIds) {
        const conn = registry.getById(id);
        if (!conn) {
          throw new ConnectorError({
            category: 'invalid_request',
            providerId: id,
            retryable: false,
            message: `Unknown connector "${id}"`,
          });
        }
        const meta = conn.getMetadata();
        if (!isEnabled(id)) {
          skipped.push({
            connectorId: id,
            connectorName: meta.name,
            reason: `${meta.name} is currently disabled by owner configuration.`,
          });
          continue;
        }
        if (countryCode && !meta.supportsAllCountries && !meta.supportedCountries.includes(countryCode)) {
          skipped.push({
            connectorId: id,
            connectorName: meta.name,
            reason: `${meta.shortName} does not cover country ${countryCode}.`,
          });
          continue;
        }
        selected.push(conn);
      }
      return { selected, skipped };
    }

    // Dynamic auto-selection based on country coverage, source categories, credentials, and search filters
    const searchable = registry.filter({
      country: countryCode,
      capability: 'company_search',
    });

    const categoryFilter =
      Array.isArray(req.sourceCategories) && req.sourceCategories.length > 0
        ? new Set<SourceCategory>(req.sourceCategories)
        : null;

    const selected: IConnector[] = [];
    const seen = new Set<string>();

    const preferGeoPoi = Boolean(
      req.region?.trim() ||
        req.coordinates ||
        (typeof req.radiusKm === 'number' && req.radiusKm > 0) ||
        req.category?.trim() ||
        req.businessType?.trim()
    );
    const preferWebOrDirectory = Boolean(
      req.productsServices?.trim() ||
        (Array.isArray(req.keywords) && req.keywords.length > 0) ||
        req.industry?.trim() ||
        req.website?.trim() ||
        req.domain?.trim() ||
        !countryCode ||
        categoryFilter?.has('search_engine') ||
        categoryFilter?.has('business_directory')
    );

    // 1. Prioritize dedicated country registry connectors
    for (const conn of searchable) {
      const meta = conn.getMetadata();
      if (categoryFilter && !categoryFilter.has(meta.sourceCategory)) continue;
      if (!meta.supportsAllCountries && countryCode && meta.supportedCountries.includes(countryCode)) {
        if (!isEnabled(conn.id)) {
          skipped.push({
            connectorId: conn.id,
            connectorName: meta.name,
            reason: `${meta.shortName} is disabled; auto-selection skipped it.`,
          });
          continue;
        }
        if (
          meta.credentialRequirements.required &&
          configuredConnectorIds &&
          !configuredConnectorIds.has(conn.id)
        ) {
          skipped.push({
            connectorId: conn.id,
            connectorName: meta.name,
            reason: `${meta.shortName} requires API credentials in the Credential Vault.`,
          });
          continue;
        }
        selected.push(conn);
        seen.add(conn.id);
      }
    }

    // 2. Include global web search, business directories, and POI connectors when configured & relevant
    for (const conn of searchable) {
      if (seen.has(conn.id)) continue;
      const meta = conn.getMetadata();
      if (categoryFilter && !categoryFilter.has(meta.sourceCategory)) continue;
      if (!meta.supportsAllCountries) continue;

      const isCredentialGated = meta.credentialRequirements.required;
      const hasCredential = !isCredentialGated || Boolean(configuredConnectorIds?.has(conn.id));

      // Skip unconfigured credentialed global search/directory connectors in auto mode unless user explicitly filtered to that category
      if (isCredentialGated && !hasCredential) {
        if (categoryFilter?.has(meta.sourceCategory)) {
          skipped.push({
            connectorId: conn.id,
            connectorName: meta.name,
            reason: `${meta.shortName} requires API credentials in the Credential Vault.`,
          });
        }
        continue;
      }

      const shouldIncludeGlobal =
        categoryFilter !== null ||
        selected.length === 0 ||
        !countryCode ||
        (meta.sourceCategory === 'maps_geo' && preferGeoPoi) ||
        ((meta.sourceCategory === 'search_engine' || meta.sourceCategory === 'business_directory') &&
          preferWebOrDirectory);

      if (shouldIncludeGlobal) {
        if (!isEnabled(conn.id)) {
          skipped.push({
            connectorId: conn.id,
            connectorName: meta.name,
            reason: `${meta.shortName} is disabled.`,
          });
          continue;
        }
        selected.push(conn);
        seen.add(conn.id);
      }
    }

    return { selected, skipped };
  }

  public async executeSearch(
    req: DiscoverySearchRequest,
    deps: DiscoveryExecutionDeps = {}
  ): Promise<DiscoverySearchResponse> {
    const registry = deps.registry || defaultRegistry;
    const engine = deps.executionEngine || defaultExecutionEngine;
    const configs = deps.configs || {};
    const userAgent = deps.userAgent || 'GlobalLeadPipeline/1.0 (contact@internal-pipeline.local)';
    const existingCrmLeads = deps.existingCrmLeads || [];

    const queries = normalizeSearchTaskQueries(req);
    if (queries.length === 0) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: 'discovery',
        retryable: false,
        message: 'At least one search query, industry, or website domain is required.',
      });
    }

    const targetCountries = normalizeTargetCountries(req);
    const requestSignature = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          queries,
          targetCountries,
          region: req.region?.trim() || '',
          city: req.city?.trim() || '',
          postalCode: req.postalCode?.trim() || '',
          industry: req.industry?.trim() || '',
          category: req.category?.trim() || '',
          businessType: req.businessType?.trim() || '',
          website: req.website?.trim() || '',
          domain: req.domain?.trim() || '',
          radiusKm: req.radiusKm || 0,
          coordinates: req.coordinates || null,
          connectorIds: req.connectorIds || (req.connectorId ? [req.connectorId] : []),
          selectionMode: req.selectionMode || 'auto',
          page: req.page || 1,
          pageSize: req.pageSize || 25,
          fetchAllPages: Boolean(req.fetchAllPages),
        })
      )
      .digest('hex')
      .slice(0, 16);

    // Duplicate concurrent search guard (coalesce identical live searches unless caller provides a unique explicit requestId)
    if (!req.requestId && this.inflightSearches.has(requestSignature)) {
      const coalescedRes = await this.inflightSearches.get(requestSignature)!;
      return { ...coalescedRes, coalesced: true };
    }

    const requestId =
      (typeof req.requestId === 'string' && req.requestId.trim()) ||
      `disc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const searchId = `srch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const controller = new AbortController();
    this.activeControllers.set(requestId, controller);

    const runPromise = (async (): Promise<DiscoverySearchResponse> => {
      const startMs = Date.now();
      const tasks: SearchTask[] = [];
      const connectorSummaries: DiscoveryConnectorSummary[] = [];
      const selectedConnectorIds = new Set<string>();
      const allErrors: string[] = [];
      const errorDetails: Array<{ connectorId: string; category: string; message: string }> = [];
      const notes: string[] = [];
      let abnLookupInfo: DiscoverySearchResponse['abnLookupInfo'];
      let primaryAttribution = '';
      let lastRunId: string | undefined;

      // Resolve selected connectors per target country
      for (const cCode of targetCountries) {
        const { selected, skipped } = this.selectConnectorsForTarget(
          cCode,
          req,
          registry,
          configs,
          deps.configuredConnectorIds
        );

        for (const s of skipped) {
          notes.push(s.reason);
          const meta = registry.getById(s.connectorId)?.getMetadata();
          if (meta) {
            connectorSummaries.push({
              connectorId: s.connectorId,
              connectorName: meta.name,
              shortName: meta.shortName,
              sourceCategory: meta.sourceCategory,
              accessMode: meta.accessMode,
              isLiveApi: meta.accessMode === 'live_api',
              countryCode: cCode,
              query: queries[0],
              status: 'skipped',
              recordsDiscovered: 0,
              recordsNormalized: 0,
              durationMs: 0,
              errorCategory: 'configuration_error',
              message: s.reason,
            });
          }
        }

        if (selected.length === 0 && skipped.length > 0 && req.connectorId && targetCountries.length === 1) {
          throw new ConnectorError({
            category: 'configuration_error',
            providerId: req.connectorId,
            retryable: false,
            message: skipped[0].reason,
          });
        }

        for (const conn of selected) {
          selectedConnectorIds.add(conn.id);
          for (const q of queries) {
            tasks.push({ connector: conn, countryCode: cCode, query: q });
          }
        }
      }

      const rawLeads: CanonicalLead[] = [];

      const executeTask = async (task: SearchTask) => {
        if (controller.signal.aborted) return;
        const meta = task.connector.getMetadata();
        const cfg: ConnectorConfigRecord = configs[task.connector.id] || {
          connectorId: task.connector.id,
          enabled: registry.isEnabled(task.connector.id),
        };
        const taskStart = Date.now();
        const subRequestId = `${requestId}-${task.connector.id}-${Math.random().toString(36).slice(2, 5)}`;

        try {
          const outcome = await engine.executeSearch(
            task.connector,
            {
              query: task.query,
              countryCode: task.countryCode,
              region: req.region?.trim() || undefined,
              city: req.city?.trim() || undefined,
              postalCode: req.postalCode?.trim() || undefined,
              industry: req.industry?.trim() || undefined,
              category: req.category?.trim() || undefined,
              businessType: req.businessType?.trim() || undefined,
              website: req.website?.trim() || undefined,
              domain: req.domain?.trim() || undefined,
              radiusKm: req.radiusKm,
              coordinates: req.coordinates,
              page: typeof req.page === 'number' ? req.page : 1,
              pageSize: typeof req.pageSize === 'number' ? req.pageSize : undefined,
              fetchAllPages: Boolean(req.fetchAllPages),
              maxPages: typeof req.maxPages === 'number' ? req.maxPages : undefined,
              filters: {
                ...(req.productsServices?.trim() ? { productsServices: req.productsServices.trim() } : {}),
                ...(req.language?.trim() ? { language: req.language.trim() } : {}),
                ...(req.companySize?.trim() ? { companySize: req.companySize.trim() } : {}),
              },
            },
            {
              config: cfg,
              userAgent,
              signal: controller.signal,
              requestId: subRequestId,
              onRecordRun: deps.onRecordRun,
            }
          );

          rawLeads.push(...outcome.normalization.leads);
          if (!primaryAttribution && outcome.response.attribution) {
            primaryAttribution = outcome.response.attribution;
          }
          lastRunId = outcome.runRecord.id;
          for (const n of outcome.response.notes || []) {
            if (n && !notes.includes(n)) notes.push(n);
          }

          if (task.connector.id === 'conn-abn' && outcome.response.providerMetadata) {
            const pm = outcome.response.providerMetadata;
            abnLookupInfo = {
              isLiveApi: Boolean(pm.isLiveApi),
              lookupMode: String(pm.lookupMode || 'offline_reference'),
              isChecksumValid:
                typeof pm.isChecksumValid === 'boolean' ? pm.isChecksumValid : undefined,
            };
          }

          connectorSummaries.push({
            connectorId: task.connector.id,
            connectorName: meta.name,
            shortName: meta.shortName,
            sourceCategory: meta.sourceCategory,
            accessMode: meta.accessMode,
            isLiveApi: outcome.response.isLiveApi,
            countryCode: task.countryCode,
            query: task.query,
            status: 'success',
            recordsDiscovered: outcome.normalization.discovered,
            recordsNormalized: outcome.normalization.normalized,
            durationMs: Date.now() - taskStart,
            runId: outcome.runRecord.id,
            attribution: outcome.response.attribution,
            notes: outcome.response.notes,
          });
        } catch (err: unknown) {
          const isCancelled = controller.signal.aborted;
          const classified =
            err instanceof ConnectorError ? err.toClassified() : task.connector.classifyError(err);
          const safeMsg = redactSecrets(classified.safeMessage);
          if (!isCancelled) {
            allErrors.push(`${meta.shortName}${task.countryCode ? ` (${task.countryCode})` : ''}: ${safeMsg}`);
            errorDetails.push({
              connectorId: task.connector.id,
              category: classified.category,
              message: safeMsg,
            });
          }
          connectorSummaries.push({
            connectorId: task.connector.id,
            connectorName: meta.name,
            shortName: meta.shortName,
            sourceCategory: meta.sourceCategory,
            accessMode: meta.accessMode,
            isLiveApi: meta.accessMode === 'live_api',
            countryCode: task.countryCode,
            query: task.query,
            status: isCancelled ? 'cancelled' : 'error',
            recordsDiscovered: 0,
            recordsNormalized: 0,
            durationMs: Date.now() - taskStart,
            errorCategory: classified.category,
            message: isCancelled ? 'Search cancelled by owner' : safeMsg,
          });
        }
      };

      await runWithConcurrency(tasks, MAX_CONCURRENT_TASKS, controller.signal, executeTask);

      // Automatic OSM fallback in auto mode if country-specific registry queries produced 0 results
      const isExplicit = req.selectionMode === 'manual' || Boolean(req.connectorId) || Boolean(req.connectorIds?.length);
      if (!isExplicit && !controller.signal.aborted && rawLeads.length === 0) {
        const osmConn = registry.getById('conn-osm');
        const osmEnabled = configs['conn-osm']?.enabled ?? registry.isEnabled('conn-osm');
        if (osmConn && osmEnabled && !selectedConnectorIds.has('conn-osm')) {
          selectedConnectorIds.add('conn-osm');
          const fallbackTasks: SearchTask[] = [];
          for (const cCode of targetCountries) {
            for (const q of queries) {
              fallbackTasks.push({ connector: osmConn, countryCode: cCode, query: q, isFallback: true });
            }
          }
          await runWithConcurrency(fallbackTasks, 1, controller.signal, executeTask);
        }
      }

      // Deduplicate identical external records returned across overlapping bulk queries
      const uniqueByRecordId = new Map<string, CanonicalLead>();
      for (const lead of rawLeads) {
        if (!uniqueByRecordId.has(lead.id)) {
          uniqueByRecordId.set(lead.id, lead);
        }
      }
      let leads = Array.from(uniqueByRecordId.values()).sort(
        (a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0)
      );

      if (req.verificationFilter && req.verificationFilter !== 'all') {
        leads = leads.filter((l) => {
          const status = l.customFields?.lastVerificationStatus || '';
          const cat = l.customFields?.lastConnectorId || '';
          if (req.verificationFilter === 'officially_verified') {
            return status === 'officially_verified';
          }
          if (req.verificationFilter === 'official_website') {
            return status === 'web_observed' || Boolean(l.webMetadata?.inspectedAt);
          }
          if (req.verificationFilter === 'directory_listed') {
            return status === 'directory_listed' || cat === 'conn-wikidata' || cat === 'conn-osm' || cat === 'conn-opencorporates';
          }
          if (req.verificationFilter === 'search_engine') {
            return cat === 'conn-brave-search' || cat === 'conn-google-cse';
          }
          return true;
        });
      }

      if (typeof req.limit === 'number' && req.limit > 0) {
        leads = leads.slice(0, Math.min(250, req.limit));
      }

      const dedupeAnalysis = detectDiscoveryDuplicates(leads, existingCrmLeads);
      const durationMs = Date.now() - startMs;

      const regionSupportedByConnector = Array.from(selectedConnectorIds).some(
        (id) => Boolean(registry.getById(id)?.getMetadata().supportsRegionFilter)
      );

      const appliedFilters: DiscoverySearchResponse['appliedFilters'] = {
        query: queries.join('; '),
        queries: queries.length > 1 ? queries : undefined,
        keywords: req.keywords?.length ? req.keywords : undefined,
        countryCode: targetCountries[0],
        countryCodes: targetCountries.filter((c): c is string => Boolean(c)),
        region: req.region?.trim() || undefined,
        city: req.city?.trim() || undefined,
        postalCode: req.postalCode?.trim() || undefined,
        industry: req.industry?.trim() || undefined,
        category: req.category?.trim() || undefined,
        productsServices: req.productsServices?.trim() || undefined,
        businessType: req.businessType?.trim() || undefined,
        companySize: req.companySize?.trim() || undefined,
        website: req.website?.trim() || undefined,
        domain: req.domain?.trim() || undefined,
        language: req.language?.trim() || undefined,
        sourceCategories: req.sourceCategories?.length ? req.sourceCategories : undefined,
        verificationFilter: req.verificationFilter || undefined,
        radiusKm: req.radiusKm,
        coordinates: req.coordinates,
        regionSupportedByConnector,
      };

      const session: SearchSessionRecord = {
        searchId,
        requestId,
        createdAt: Date.now(),
        leads,
        duplicateInfoByLeadId: dedupeAnalysis.duplicateInfoByLeadId,
        counts: dedupeAnalysis.counts,
        connectorSummaries,
        selectedConnectorIds: Array.from(selectedConnectorIds),
        errors: allErrors,
        errorDetails,
        attribution: primaryAttribution,
        providerNote: notes.join(' '),
        abnLookupInfo,
        appliedFilters,
        cancelled: controller.signal.aborted,
        durationMs,
      };

      this.pruneExpiredSessions();
      this.sessions.set(searchId, session);

      const page = Math.max(1, req.page || 1);
      const pageSize = Math.min(100, Math.max(1, req.pageSize || 25));
      const paged = this.sliceSessionPage(session, { page, pageSize });

      return {
        searchId,
        requestId,
        leads: paged.leads,
        duplicateInfoByLeadId: paged.duplicateInfoByLeadId,
        totalDiscovered: leads.length,
        totalUnique: dedupeAnalysis.counts.totalUnique,
        existingCrmMatches: dedupeAnalysis.counts.existingCrmMatches,
        ambiguousMatches: dedupeAnalysis.counts.ambiguousMatches,
        crossSourceCorroborations: dedupeAnalysis.counts.crossSourceCorroborations,
        pagination: paged.pagination,
        connectorSummaries,
        selectedConnectorIds: Array.from(selectedConnectorIds),
        runId: lastRunId,
        errors: allErrors.length > 0 ? allErrors : undefined,
        errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
        attribution: primaryAttribution,
        providerNote: notes.join(' '),
        abnLookupInfo,
        appliedFilters,
        cancelled: controller.signal.aborted || undefined,
        durationMs,
      };
    })().finally(() => {
      this.activeControllers.delete(requestId);
      this.inflightSearches.delete(requestSignature);
    });

    if (!req.requestId) {
      this.inflightSearches.set(requestSignature, runPromise);
    }

    return runPromise;
  }

  public getPaginatedResults(
    searchId: string,
    options: PaginatedResultsOptions = {}
  ): {
    searchId: string;
    leads: CanonicalLead[];
    duplicateInfoByLeadId: Record<string, DiscoveryDuplicateInfo>;
    pagination: DiscoveryPagination;
    totalDiscovered: number;
    appliedFilters: DiscoverySearchResponse['appliedFilters'];
    connectorSummaries: DiscoveryConnectorSummary[];
  } | null {
    const session = this.getSession(searchId);
    if (!session) return null;
    const paged = this.sliceSessionPage(session, options);
    return {
      searchId: session.searchId,
      leads: paged.leads,
      duplicateInfoByLeadId: paged.duplicateInfoByLeadId,
      pagination: paged.pagination,
      totalDiscovered: session.leads.length,
      appliedFilters: session.appliedFilters,
      connectorSummaries: session.connectorSummaries,
    };
  }

  private sliceSessionPage(
    session: SearchSessionRecord,
    options: PaginatedResultsOptions
  ): {
    leads: CanonicalLead[];
    duplicateInfoByLeadId: Record<string, DiscoveryDuplicateInfo>;
    pagination: DiscoveryPagination;
  } {
    let list = [...session.leads];

    if (options.duplicateFilter && options.duplicateFilter !== 'all') {
      list = list.filter((l) => {
        const info = session.duplicateInfoByLeadId[l.id];
        if (options.duplicateFilter === 'unique') {
          return !info || info.status === 'unique' || (info.status === 'cross_source_match' && !info.requiresReview);
        }
        if (options.duplicateFilter === 'existing_crm') {
          return info?.status === 'existing_crm';
        }
        if (options.duplicateFilter === 'ambiguous') {
          return Boolean(info?.requiresReview);
        }
        return true;
      });
    }

    if (options.connectorId) {
      list = list.filter((l) => l.customFields?.lastConnectorId === options.connectorId);
    }

    if (options.countryCode) {
      const cUpper = options.countryCode.toUpperCase();
      list = list.filter((l) => (l.address?.countryCode || '').toUpperCase() === cUpper);
    }

    if (typeof options.minConfidence === 'number' && options.minConfidence > 0) {
      list = list.filter((l) => (l.confidenceScore || 0) >= options.minConfidence!);
    }

    if (options.sortBy === 'name_asc') {
      list.sort((a, b) => a.companyName.localeCompare(b.companyName));
    } else {
      list.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0));
    }

    const pageSize = Math.min(100, Math.max(1, options.pageSize || 25));
    const totalItems = list.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(totalPages, Math.max(1, options.page || 1));
    const offset = (page - 1) * pageSize;
    const slice = list.slice(offset, offset + pageSize);

    const duplicateInfoByLeadId: Record<string, DiscoveryDuplicateInfo> = {};
    for (const item of slice) {
      if (session.duplicateInfoByLeadId[item.id]) {
        duplicateInfoByLeadId[item.id] = session.duplicateInfoByLeadId[item.id];
      }
    }

    return {
      leads: slice,
      duplicateInfoByLeadId,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  public async enrichCandidate(
    params: {
      searchId?: string;
      lead: CanonicalLead;
      runWebInspector?: boolean;
      runAi?: boolean;
    },
    deps: Pick<
      DiscoveryExecutionDeps,
      'configs' | 'onRecordRun' | 'inspectWebsiteFn' | 'analyzeLeadWithAiFn' | 'extractWebIntelFn' | 'userAgent'
    > = {}
  ): Promise<{
    lead: CanonicalLead;
    inspection?: WebInspectionResult;
    aiAnalysis?: Awaited<ReturnType<typeof analyzeLeadWithAi>>;
    webIntelExtraction?: Awaited<ReturnType<typeof extractBusinessIntelFromWebEvidence>>;
    notes: string[];
  }> {
    const configs = deps.configs || {};
    const doInspect = deps.inspectWebsiteFn || inspectWebsite;
    const doAi = deps.analyzeLeadWithAiFn || analyzeLeadWithAi;
    const doWebExtract = deps.extractWebIntelFn || extractBusinessIntelFromWebEvidence;
    const notes: string[] = [];

    let updatedLead: CanonicalLead = {
      ...params.lead,
      confidenceSignals: [...(params.lead.confidenceSignals || [])],
      activities: [...(params.lead.activities || [])],
      identifiers: [...(params.lead.identifiers || [])],
      sources: [...(params.lead.sources || [])],
    };

    let inspection: WebInspectionResult | undefined;
    let aiAnalysis: Awaited<ReturnType<typeof analyzeLeadWithAi>> | undefined;
    let webIntelExtraction: Awaited<ReturnType<typeof extractBusinessIntelFromWebEvidence>> | undefined;

    if (params.runWebInspector && (updatedLead.website || updatedLead.domain)) {
      const cfg = configs['conn-web-inspector'];
      if (cfg && !cfg.enabled) {
        notes.push('Web Inspector connector is disabled; skipped live HTTP inspection.');
      } else {
        const targetUrl = updatedLead.website || `https://${updatedLead.domain}`;
        const startedAt = new Date().toISOString();
        const startMs = Date.now();
        inspection = await doInspect(targetUrl, {
          userAgent: deps.userAgent,
          checkRobots: doInspect === inspectWebsite,
        });

        if (deps.onRecordRun) {
          const run: ConnectorRunRecord = {
            id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            connectorId: 'conn-web-inspector',
            operation: 'enrich',
            queryParams: { url: targetUrl.slice(0, 200), leadId: updatedLead.id },
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startMs,
            status: inspection.securityCheck.passed && inspection.isOnline ? 'success' : 'error',
            recordsDiscovered: inspection.isOnline ? 1 : 0,
            recordsNormalized: inspection.isOnline ? 1 : 0,
            recordsRejected: inspection.isOnline ? 0 : 1,
            errorCategory: !inspection.securityCheck.passed
              ? 'invalid_request'
              : !inspection.isOnline
              ? 'network_failure'
              : undefined,
            diagnosticSummary:
              inspection.securityCheck.reason ||
              (inspection.isOnline
                ? `HTTP ${inspection.httpStatus} (${inspection.serverLatencyMs}ms, ${inspection.pagesVisited?.length || 1} page(s))`
                : 'Host unreachable'),
          };
          await deps.onRecordRun(run);
        }

        if (inspection.isOnline && inspection.securityCheck.passed) {
          const inspectedAt = new Date().toISOString();
          const mergedProv: Record<string, AttributeProvenanceEntry> = {
            ...(updatedLead.webMetadata?.attributeProvenance || {}),
            ...(inspection.attributeProvenance || {}),
          };

          updatedLead.webMetadata = {
            ...(updatedLead.webMetadata || {}),
            title: inspection.title || updatedLead.webMetadata?.title,
            description: inspection.description || updatedLead.webMetadata?.description,
            httpStatus: inspection.httpStatus,
            isHttps: inspection.isHttps,
            serverLatencyMs: inspection.serverLatencyMs,
            inspectedAt,
            aboutPageUrl: inspection.aboutPageUrl,
            productsPageUrl: inspection.productsPageUrl,
            contactPageUrl: inspection.contactPageUrl,
            locationsPageUrl: inspection.locationsPageUrl,
            imprintPageUrl: inspection.imprintPageUrl,
            pagesVisited: inspection.pagesVisited,
            productsServices: inspection.productsServices,
            locationsServed: inspection.locationsServed,
            operatingInfo: inspection.operatingInfo,
            addressesFound: inspection.addressesFound,
            phonesFound: inspection.phonesFound,
            emailsFound: inspection.emailsFound,
            attributeProvenance: Object.keys(mergedProv).length > 0 ? mergedProv : undefined,
          };

          if (inspection.emailsFound?.length && !updatedLead.email) {
            updatedLead.email = inspection.emailsFound[0];
            updatedLead.emailStatus = 'syntax_valid';
            updatedLead.confidenceScore = Math.min(100, (updatedLead.confidenceScore || 0) + 10);
            updatedLead.confidenceSignals.push('Public Business Email Discovered via Safe Website Inspection');
          }
          if (inspection.phonesFound?.length && !updatedLead.phone) {
            updatedLead.phone = inspection.phonesFound[0];
            updatedLead.confidenceScore = Math.min(100, (updatedLead.confidenceScore || 0) + 6);
            updatedLead.confidenceSignals.push('Public Phone Discovered via Safe Website Inspection');
          }
          if (inspection.socialLinks) {
            updatedLead.socialLinks = { ...(updatedLead.socialLinks || {}), ...inspection.socialLinks };
          }
          if (inspection.industry && (!updatedLead.industry || updatedLead.industry === 'General Commerce & Services' || updatedLead.industry === 'Web-Discovered Business')) {
            updatedLead.industry = inspection.industry;
          }
          updatedLead.activities.unshift({
            id: `act-${Date.now()}-web`,
            type: 'enrichment',
            title: `Live Website Inspected (${inspection.pagesVisited?.length || 1} page(s), SSRF Protected)`,
            outcome: `HTTP ${inspection.httpStatus} (${inspection.serverLatencyMs}ms)`,
            date: inspectedAt,
            actor: 'Web Inspector',
          });
        } else if (!inspection.securityCheck.passed) {
          notes.push(`Website inspection blocked: ${inspection.securityCheck.reason}`);
        } else {
          notes.push('Target website was unreachable during live inspection.');
        }
      }
    }

    if (params.runAi) {
      const cfg = configs['conn-gemini'];
      if (cfg && !cfg.enabled) {
        notes.push('Gemini AI connector is disabled; skipped AI enrichment.');
      } else {
        const startedAt = new Date().toISOString();
        const startMs = Date.now();
        aiAnalysis = await doAi(updatedLead);

        if (inspection?.isOnline && inspection.pageExcerpts && inspection.pageExcerpts.length > 0) {
          webIntelExtraction = await doWebExtract({
            companyName: updatedLead.companyName,
            url: inspection.url,
            pageExcerpts: inspection.pageExcerpts,
            existingIndustry: updatedLead.industry,
          });
          const aiNow = new Date().toISOString();
          const provMap: Record<string, AttributeProvenanceEntry> = {
            ...(updatedLead.webMetadata?.attributeProvenance || {}),
          };
          provMap.aiBusinessSummary = {
            attribute: 'aiBusinessSummary',
            value: webIntelExtraction.businessSummary.slice(0, 240),
            sourceType: webIntelExtraction.provenanceClassification,
            sourceName: `Gemini Web Extraction (${webIntelExtraction.engine})`,
            sourceUrl: inspection.url,
            retrievedAt: aiNow,
            connectorId: 'conn-gemini',
          };
          provMap.inferredIndustry = {
            attribute: 'inferredIndustry',
            value: webIntelExtraction.inferredIndustry,
            sourceType: 'inferred',
            sourceName: `Gemini Classification (${webIntelExtraction.engine})`,
            sourceUrl: inspection.url,
            retrievedAt: aiNow,
            connectorId: 'conn-gemini',
          };
          updatedLead.webMetadata = {
            ...(updatedLead.webMetadata || {}),
            productsServices: Array.from(
              new Set([
                ...(updatedLead.webMetadata?.productsServices || []),
                ...(webIntelExtraction.extractedProductsServices || []),
              ])
            ).slice(0, 12),
            locationsServed: Array.from(
              new Set([
                ...(updatedLead.webMetadata?.locationsServed || []),
                ...(webIntelExtraction.extractedLocationsServed || []),
              ])
            ).slice(0, 12),
            attributeProvenance: provMap,
          };
        }

        if (deps.onRecordRun) {
          await deps.onRecordRun({
            id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            connectorId: 'conn-gemini',
            operation: 'ai_inference',
            queryParams: { leadId: updatedLead.id, companyName: updatedLead.companyName },
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startMs,
            status: 'success',
            recordsDiscovered: 1,
            recordsNormalized: 1,
            recordsRejected: 0,
            diagnosticSummary: `AI fit score ${aiAnalysis.fitScore}% (${aiAnalysis.engine})`,
          });
        }

        updatedLead.customFields = {
          ...(updatedLead.customFields || {}),
          aiFitScore: String(aiAnalysis.fitScore),
          aiQualification: aiAnalysis.qualificationStatus,
          aiEngine: aiAnalysis.engine,
          aiSummary: (webIntelExtraction?.businessSummary || aiAnalysis.summary).slice(0, 400),
          ...(webIntelExtraction
            ? {
                aiInferredIndustry: webIntelExtraction.inferredIndustry,
                aiProvenance: webIntelExtraction.provenanceClassification,
              }
            : {}),
        };
        updatedLead.activities.unshift({
          id: `act-${Date.now()}-ai`,
          type: 'enrichment',
          title: `AI Intelligence Brief (${aiAnalysis.engine})`,
          outcome: `${aiAnalysis.qualificationStatus} · ${aiAnalysis.fitScore}% Fit`,
          date: new Date().toISOString(),
          actor: 'Gemini AI Engine',
        });
      }
    }

    updatedLead.updatedAt = new Date().toISOString();

    if (params.searchId) {
      const session = this.getSession(params.searchId);
      if (session) {
        const idx = session.leads.findIndex((l) => l.id === updatedLead.id);
        if (idx >= 0) {
          session.leads[idx] = updatedLead;
        }
      }
    }

    return { lead: updatedLead, inspection, aiAnalysis, webIntelExtraction, notes };
  }

  public exportSessionJson(searchId: string, selectedLeadIds?: string[]): string | null {
    const session = this.getSession(searchId);
    if (!session) return null;

    const filterSet = selectedLeadIds && selectedLeadIds.length > 0 ? new Set(selectedLeadIds) : null;
    const leads = filterSet ? session.leads.filter((l) => filterSet.has(l.id)) : session.leads;

    return JSON.stringify(
      {
        searchId: session.searchId,
        exportedAt: new Date().toISOString(),
        appliedFilters: session.appliedFilters,
        counts: session.counts,
        totalExported: leads.length,
        leads: leads.map((l) => ({
          ...l,
          duplicateStatus: session.duplicateInfoByLeadId[l.id] || { status: 'unique' },
        })),
      },
      null,
      2
    );
  }

  public exportSessionCsv(searchId: string, selectedLeadIds?: string[]): string | null {
    const session = this.getSession(searchId);
    if (!session) return null;

    const filterSet = selectedLeadIds && selectedLeadIds.length > 0 ? new Set(selectedLeadIds) : null;
    const rowsSource = filterSet
      ? session.leads.filter((l) => filterSet.has(l.id))
      : session.leads;

    const headers = [
      'Discovery ID',
      'Company Name',
      'Legal Name',
      'Country',
      'Country Code',
      'Region',
      'City',
      'Street',
      'Postal Code',
      'Formatted Address',
      'Registration Number',
      'Registration Type',
      'All Canonical Identifiers',
      'Verification Status',
      'Connector Source',
      'Duplicate Status',
      'Confidence Score',
      'Industry',
      'Category',
      'Products & Services',
      'Website',
      'Domain',
      'Email',
      'Phone',
      'Phone Normalized',
      'Pages Inspected',
      'Source URL',
      'Retrieved At',
    ];

    const rows = rowsSource.map((l) => {
      const dup = session.duplicateInfoByLeadId[l.id];
      const allIdents = (l.identifiers || [])
        .map((i) => `${canonicalizeIdentifierType(i.type, i.countryCode || l.address?.countryCode)}:${i.value}`)
        .join('; ');
      const primarySource = l.sources?.[0];
      return [
        l.id,
        l.companyName,
        l.legalName || '',
        l.address?.country || '',
        l.address?.countryCode || '',
        l.address?.region || '',
        l.address?.city || '',
        l.address?.street || '',
        l.address?.postalCode || '',
        l.address?.formattedAddress || '',
        l.registrationNumber || '',
        l.registrationType || '',
        allIdents,
        l.customFields?.lastVerificationStatus || 'unverified',
        primarySource?.sourceName || l.customFields?.lastConnectorId || '',
        dup?.status || 'unique',
        `${l.confidenceScore}%`,
        l.industry || '',
        l.category || '',
        (l.webMetadata?.productsServices || []).join('; '),
        l.website || '',
        l.domain || '',
        l.email || '',
        l.phone || '',
        l.phoneNormalized || '',
        (l.webMetadata?.pagesVisited || []).join('; '),
        primarySource?.url || '',
        primarySource?.retrievedAt || l.createdAt,
      ];
    });

    return buildCsvDocument(headers, rows, true);
  }
}

export const discoveryService = new DiscoveryService();
