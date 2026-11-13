import { AbnConnector } from './adapters/abnAdapter.js';
import { BrregConnector } from './adapters/brregAdapter.js';
import { CompaniesHouseConnector } from './adapters/companiesHouseAdapter.js';
import { GeminiConnector } from './adapters/geminiAdapter.js';
import { OsmConnector } from './adapters/osmAdapter.js';
import { WebInspectorConnector } from './adapters/webInspectorAdapter.js';
import { credentialManager, CredentialManager } from './core/credentialManager.js';
import { connectorExecutionEngine, ConnectorExecutionEngine } from './core/executionEngine.js';
import { connectorRegistry, ConnectorRegistry, mapHealthStateToLegacyStatus } from './core/registry.js';
import {
  ConnectorConfigRecord,
  ConnectorErrorCategory,
  ConnectorRunRecord,
  ConnectorRuntimeState,
  IConnector,
} from './core/types.js';
import { ConnectorStatus } from '../types.js';

let initialized = false;

export function ensureConnectorsRegistered(registry: ConnectorRegistry = connectorRegistry): void {
  if (initialized && registry === connectorRegistry) return;

  const defaults: IConnector[] = [
    new BrregConnector(),
    new CompaniesHouseConnector(),
    new OsmConnector(),
    new AbnConnector(),
    new WebInspectorConnector(),
    new GeminiConnector(),
  ];

  for (const conn of defaults) {
    if (!registry.getById(conn.id)) {
      registry.register(conn);
    }
  }

  if (registry === connectorRegistry) {
    initialized = true;
  }
}

// Auto-register defaults on module import
ensureConnectorsRegistered();

export interface ConnectorAggregateStats {
  totalCalls: number;
  recentSuccessCount: number;
  recentFailureCount: number;
  consecutiveFailures: number;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastErrorCategory?: ConnectorErrorCategory;
  lastValidation?: {
    ok: boolean;
    checkedAt: string;
    latencyMs?: number;
    message?: string;
    errorCategory?: ConnectorErrorCategory;
  };
}

export async function buildUnifiedConnectorStatus(
  connector: IConnector,
  options: {
    stats?: ConnectorAggregateStats;
    config?: ConnectorConfigRecord;
    credMgr?: CredentialManager;
    engine?: ConnectorExecutionEngine;
  } = {}
): Promise<ConnectorStatus> {
  const meta = connector.getMetadata();
  const credMgr = options.credMgr || credentialManager;
  const engine = options.engine || connectorExecutionEngine;
  const stats = options.stats || {
    totalCalls: 0,
    recentSuccessCount: 0,
    recentFailureCount: 0,
    consecutiveFailures: 0,
  };

  const config: ConnectorConfigRecord = {
    connectorId: connector.id,
    enabled: options.config?.enabled ?? connectorRegistry.isEnabled(connector.id),
    timeoutMs: options.config?.timeoutMs ?? meta.executionPolicy.timeoutMs,
    maxRetries: options.config?.maxRetries ?? meta.executionPolicy.maxRetries,
    rateLimitMax: options.config?.rateLimitMax ?? meta.executionPolicy.rateLimit.maxRequests,
    rateLimitWindowMs: options.config?.rateLimitWindowMs ?? meta.executionPolicy.rateLimit.windowMs,
    customConfig: options.config?.customConfig,
    updatedAt: options.config?.updatedAt,
  };

  const credentialStatus = await credMgr.getCredentialStatus(connector.id, meta.credentialRequirements);
  const rateLimitState = engine.getRateLimitSnapshot(connector, config);

  const runtimeState: ConnectorRuntimeState = {
    enabled: config.enabled,
    credentialStatus,
    totalCalls: stats.totalCalls,
    recentSuccessCount: stats.recentSuccessCount,
    recentFailureCount: stats.recentFailureCount,
    consecutiveFailures: stats.consecutiveFailures,
    lastRunAt: stats.lastRunAt,
    lastSuccessAt: stats.lastSuccessAt,
    lastError: stats.lastError,
    lastErrorCategory: stats.lastErrorCategory,
    lastValidation: stats.lastValidation,
    rateLimitState,
  };

  const health = connector.getHealth(runtimeState);

  const legacyCategory: ConnectorStatus['category'] =
    meta.sourceCategory === 'website_intelligence'
      ? 'web_search'
      : meta.sourceCategory === 'government_registry' ||
        meta.sourceCategory === 'maps_geo' ||
        meta.sourceCategory === 'ai_engine'
      ? meta.sourceCategory
      : meta.sourceCategory;

  const countryCoverage = meta.supportsAllCountries
    ? ['GLOBAL', ...meta.supportedCountries]
    : meta.supportedCountries;

  return {
    id: meta.id,
    name: meta.name,
    shortName: meta.shortName,
    version: meta.version,
    description: meta.description,
    category: legacyCategory,
    sourceCategory: meta.sourceCategory,
    accessMode: meta.accessMode,
    countryCoverage,
    supportsAllCountries: meta.supportsAllCountries,
    supportsRegionFilter: meta.supportsRegionFilter,
    supportsCityFilter: meta.supportsCityFilter,
    supportedIdentifierTypes: meta.supportedIdentifierTypes,
    capabilities: meta.capabilities,
    status: mapHealthStateToLegacyStatus(health.healthState),
    healthState: health.healthState,
    operational: health.operational,
    healthSummary: health.summary,
    authType: meta.credentialRequirements.authType,
    isConfigured: credentialStatus.configured,
    credentialRequirements: meta.credentialRequirements,
    credentialStatus,
    config,
    rateLimitNote: meta.executionPolicy.rateLimit.note,
    rateLimitState,
    attribution: meta.attribution,
    license: meta.license,
    homepageUrl: meta.homepageUrl,
    lastRunAt: stats.lastRunAt,
    lastSuccessAt: stats.lastSuccessAt,
    totalCalls: stats.totalCalls,
    recentSuccessCount: stats.recentSuccessCount,
    recentFailureCount: stats.recentFailureCount,
    consecutiveFailures: stats.consecutiveFailures,
    lastError: stats.lastError,
    lastErrorCategory: stats.lastErrorCategory,
  };
}

export function aggregateRunsByConnector(runs: ConnectorRunRecord[]): Map<string, ConnectorAggregateStats> {
  const map = new Map<string, ConnectorAggregateStats>();

  // Group runs newest-first
  const sorted = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  for (const r of sorted) {
    let agg = map.get(r.connectorId);
    if (!agg) {
      agg = {
        totalCalls: 0,
        recentSuccessCount: 0,
        recentFailureCount: 0,
        consecutiveFailures: 0,
      };
      map.set(r.connectorId, agg);
    }

    agg.totalCalls += 1;
    if (!agg.lastRunAt) agg.lastRunAt = r.startedAt;

    if (r.status === 'success') {
      agg.recentSuccessCount += 1;
      if (!agg.lastSuccessAt) agg.lastSuccessAt = r.completedAt || r.startedAt;
    } else if (r.status === 'error') {
      agg.recentFailureCount += 1;
      if (!agg.lastError && r.diagnosticSummary) agg.lastError = r.diagnosticSummary;
      if (!agg.lastErrorCategory && r.errorCategory) agg.lastErrorCategory = r.errorCategory;
    }

    if (r.operation === 'health_check' && !agg.lastValidation) {
      agg.lastValidation = {
        ok: r.status === 'success',
        checkedAt: r.completedAt || r.startedAt,
        latencyMs: r.durationMs,
        message: r.diagnosticSummary,
        errorCategory: r.errorCategory,
      };
    }
  }

  // Compute consecutive failures from newest run until first success
  const byConn = new Map<string, ConnectorRunRecord[]>();
  for (const r of sorted) {
    if (!byConn.has(r.connectorId)) byConn.set(r.connectorId, []);
    byConn.get(r.connectorId)!.push(r);
  }
  for (const [connId, list] of byConn.entries()) {
    let streak = 0;
    for (const r of list) {
      if (r.status === 'error') streak += 1;
      else if (r.status === 'success') break;
    }
    const agg = map.get(connId);
    if (agg) agg.consecutiveFailures = streak;
  }

  return map;
}

export {
  connectorRegistry,
  connectorExecutionEngine,
  credentialManager,
  BrregConnector,
  CompaniesHouseConnector,
  AbnConnector,
  OsmConnector,
  WebInspectorConnector,
  GeminiConnector,
};
