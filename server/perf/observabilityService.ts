// Phase 17: Performance Observability & Diagnostics Service
// Tracks bounded, sanitized runtime metrics:
// - API route-group latency (count, avg, p50, p95, max, errorCount)
// - Slow PostgreSQL queries (label + duration only; zero SQL bind values, credentials, or PII)
// - Workflow execution durations & failure counts
// - Recent sanitized application errors (redacted)
// - Process heap/RSS memory & uptime
// Every reported metric carries explicit provenance: 'measured' | 'calculated' | 'estimated' | 'unavailable'.

import type { Request, Response, NextFunction } from 'express';
import { redactSecrets } from '../connectors/core/errors.js';
import type { CacheStatsSnapshot } from './cacheManager.js';

export type MetricProvenance = 'measured' | 'calculated' | 'estimated' | 'unavailable';

interface RouteLatencyBucket {
  routeKey: string;
  samples: number[];
  count: number;
  errorCount: number;
  maxMs: number;
  lastStatus: number;
  lastSeenAt: string;
}

export interface SlowQueryRecord {
  id: string;
  label: string;
  durationMs: number;
  rowCount?: number;
  recordedAt: string;
}

export interface WorkflowPerfSample {
  workflowId: string;
  workflowName: string;
  status: string;
  durationMs: number;
  stepCount: number;
  recordedAt: string;
}

export interface SanitizedErrorRecord {
  id: string;
  source: string;
  statusCode?: number;
  message: string;
  recordedAt: string;
}

const MAX_ROUTE_BUCKETS = 100;
const MAX_SAMPLES_PER_ROUTE = 200;
const MAX_SLOW_QUERIES = 50;
const MAX_WORKFLOW_SAMPLES = 100;
const MAX_RECENT_ERRORS = 50;

export const SLOW_QUERY_THRESHOLD_MS = Math.max(
  10,
  parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '100', 10) || 100
);

/**
 * Normalizes dynamic entity IDs out of request paths so metrics remain bounded and PII-free.
 */
export function normalizeRouteKey(method: string, rawPath: string): string {
  const pathOnly = (rawPath || '/').split('?')[0];
  const normalized = pathOnly
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
    .replace(/\/(?:lead|person|task|camp|msg|wf|wexec|wnot|run|batch|opp|int|note|prop|sup|fu|rep|seq|enr|uk-crn|brreg|abn|osm|sec|gleif)-[a-zA-Z0-9_-]+/g, '/:id')
    .replace(/\/\d{2,}/g, '/:num');
  return `${method.toUpperCase()} ${normalized}`;
}

export function sanitizeDiagnosticText(input: unknown, maxLen = 220): string {
  const raw = input instanceof Error ? input.message : String(input ?? '');
  const scrubbed = redactSecrets(raw)
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, 'postgresql://***REDACTED***')
    .replace(/:[^:@\s]+@/g, ':***@')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '***@***')
    .replace(/\s+/g, ' ')
    .trim();
  return scrubbed.slice(0, maxLen);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

export class ObservabilityService {
  private routeBuckets = new Map<string, RouteLatencyBucket>();
  private slowQueries: SlowQueryRecord[] = [];
  private totalQueriesMeasured = 0;
  private totalQueryDurationMs = 0;
  private workflowSamples: WorkflowPerfSample[] = [];
  private recentErrors: SanitizedErrorRecord[] = [];
  private readonly startedAtMs = Date.now();

  public recordApiRequest(method: string, path: string, statusCode: number, durationMs: number): void {
    const safeDuration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    const key = normalizeRouteKey(method, path);

    let bucket = this.routeBuckets.get(key);
    if (!bucket) {
      if (this.routeBuckets.size >= MAX_ROUTE_BUCKETS) {
        const oldestKey = this.routeBuckets.keys().next().value;
        if (oldestKey) this.routeBuckets.delete(oldestKey);
      }
      bucket = {
        routeKey: key,
        samples: [],
        count: 0,
        errorCount: 0,
        maxMs: 0,
        lastStatus: statusCode,
        lastSeenAt: new Date().toISOString(),
      };
      this.routeBuckets.set(key, bucket);
    }

    bucket.count++;
    if (statusCode >= 500) bucket.errorCount++;
    if (safeDuration > bucket.maxMs) bucket.maxMs = safeDuration;
    bucket.lastStatus = statusCode;
    bucket.lastSeenAt = new Date().toISOString();
    bucket.samples.push(safeDuration);
    if (bucket.samples.length > MAX_SAMPLES_PER_ROUTE) {
      bucket.samples.shift();
    }
  }

  public recordDbQuery(label: string, durationMs: number, rowCount?: number): void {
    const safeDuration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    this.totalQueriesMeasured++;
    this.totalQueryDurationMs += safeDuration;

    if (safeDuration >= SLOW_QUERY_THRESHOLD_MS) {
      this.slowQueries.unshift({
        id: `sq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: sanitizeDiagnosticText(label, 120),
        durationMs: Number(safeDuration.toFixed(1)),
        rowCount,
        recordedAt: new Date().toISOString(),
      });
      if (this.slowQueries.length > MAX_SLOW_QUERIES) {
        this.slowQueries.length = MAX_SLOW_QUERIES;
      }
    }
  }

  public recordWorkflowExecution(sample: Omit<WorkflowPerfSample, 'recordedAt'>): void {
    this.workflowSamples.unshift({
      ...sample,
      workflowName: sanitizeDiagnosticText(sample.workflowName, 100),
      durationMs: Number(Math.max(0, sample.durationMs).toFixed(1)),
      recordedAt: new Date().toISOString(),
    });
    if (this.workflowSamples.length > MAX_WORKFLOW_SAMPLES) {
      this.workflowSamples.length = MAX_WORKFLOW_SAMPLES;
    }
  }

  public recordSanitizedError(source: string, err: unknown, statusCode?: number): void {
    this.recentErrors.unshift({
      id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: sanitizeDiagnosticText(source, 80),
      statusCode,
      message: sanitizeDiagnosticText(err, 220),
      recordedAt: new Date().toISOString(),
    });
    if (this.recentErrors.length > MAX_RECENT_ERRORS) {
      this.recentErrors.length = MAX_RECENT_ERRORS;
    }
  }

  public createPerformanceMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const startNs = process.hrtime.bigint();
      res.on('finish', () => {
        const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
        const routePath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
        this.recordApiRequest(req.method, routePath, res.statusCode, elapsedMs);
        if (res.statusCode >= 500) {
          this.recordSanitizedError(
            normalizeRouteKey(req.method, routePath),
            `HTTP ${res.statusCode} response`,
            res.statusCode
          );
        }
      });
      next();
    };
  }

  public getApiLatencySummary() {
    const allSamples: number[] = [];
    let totalRequests = 0;
    let totalServerErrors = 0;

    const routes = Array.from(this.routeBuckets.values())
      .map((b) => {
        totalRequests += b.count;
        totalServerErrors += b.errorCount;
        for (const s of b.samples) allSamples.push(s);
        const sorted = [...b.samples].sort((a, b2) => a - b2);
        const avg = sorted.length > 0 ? sorted.reduce((acc, v) => acc + v, 0) / sorted.length : 0;
        return {
          route: b.routeKey,
          count: b.count,
          errorCount: b.errorCount,
          avgMs: Number(avg.toFixed(1)),
          p50Ms: percentile(sorted, 50),
          p95Ms: percentile(sorted, 95),
          maxMs: Number(b.maxMs.toFixed(1)),
          lastStatus: b.lastStatus,
          lastSeenAt: b.lastSeenAt,
        };
      })
      .sort((a, b) => b.p95Ms - a.p95Ms || b.count - a.count);

    allSamples.sort((a, b) => a - b);
    const overallAvg =
      allSamples.length > 0 ? allSamples.reduce((acc, v) => acc + v, 0) / allSamples.length : 0;

    return {
      provenance: 'measured' as MetricProvenance,
      totalRequests,
      totalServerErrors,
      overallAvgMs: Number(overallAvg.toFixed(1)),
      overallP50Ms: percentile(allSamples, 50),
      overallP95Ms: percentile(allSamples, 95),
      trackedRouteGroups: routes.length,
      maxTrackedRouteGroups: MAX_ROUTE_BUCKETS,
      topSlowRoutes: routes.slice(0, 15),
    };
  }

  public getQueryDiagnostics() {
    return {
      provenance: (this.totalQueriesMeasured > 0 ? 'measured' : 'unavailable') as MetricProvenance,
      slowQueryThresholdMs: SLOW_QUERY_THRESHOLD_MS,
      totalQueriesMeasured: this.totalQueriesMeasured,
      avgQueryMs:
        this.totalQueriesMeasured > 0
          ? Number((this.totalQueryDurationMs / this.totalQueriesMeasured).toFixed(2))
          : null,
      slowQueryCount: this.slowQueries.length,
      recentSlowQueries: this.slowQueries.slice(0, 20),
    };
  }

  public getWorkflowDiagnostics() {
    const durations = this.workflowSamples.map((s) => s.durationMs).sort((a, b) => a - b);
    const failedCount = this.workflowSamples.filter(
      (s) => s.status === 'failed' || s.status === 'partial_failure'
    ).length;
    const avgMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

    return {
      provenance: (this.workflowSamples.length > 0 ? 'measured' : 'unavailable') as MetricProvenance,
      sampleCount: this.workflowSamples.length,
      failedCount,
      avgDurationMs: avgMs !== null ? Number(avgMs.toFixed(1)) : null,
      p95DurationMs: durations.length > 0 ? percentile(durations, 95) : null,
      recentExecutions: this.workflowSamples.slice(0, 15),
    };
  }

  public getProcessMemorySnapshot() {
    const mem = process.memoryUsage();
    const toMb = (bytes: number) => Number((bytes / (1024 * 1024)).toFixed(1));
    return {
      provenance: 'measured' as MetricProvenance,
      uptimeSeconds: Math.floor((Date.now() - this.startedAtMs) / 1000),
      rssMb: toMb(mem.rss),
      heapUsedMb: toMb(mem.heapUsed),
      heapTotalMb: toMb(mem.heapTotal),
      externalMb: toMb(mem.external),
      heapUtilizationPercent:
        mem.heapTotal > 0 ? Number(((mem.heapUsed / mem.heapTotal) * 100).toFixed(1)) : null,
    };
  }

  public getRecentErrors(): SanitizedErrorRecord[] {
    return this.recentErrors.slice(0, 25);
  }

  public reset(): void {
    this.routeBuckets.clear();
    this.slowQueries = [];
    this.totalQueriesMeasured = 0;
    this.totalQueryDurationMs = 0;
    this.workflowSamples = [];
    this.recentErrors = [];
  }

  public buildPerformanceSnapshot(deps: {
    storageEngine: 'postgresql' | 'json_store';
    dbPoolHealth: Record<string, unknown>;
    cacheStats: CacheStatsSnapshot;
    connectorRuntimeHealth: Array<Record<string, unknown>>;
    backupStatus: Record<string, unknown>;
  }) {
    return {
      generatedAt: new Date().toISOString(),
      provenanceLegend: {
        measured: 'Directly observed in-process during runtime execution.',
        calculated: 'Deterministically derived from measured runtime counters.',
        estimated: 'Approximate sizing (e.g., serialized JSON byte estimate).',
        unavailable: 'No observations recorded yet in this server process or requires external infrastructure.',
      },
      storageEngine: deps.storageEngine,
      process: this.getProcessMemorySnapshot(),
      apiLatency: this.getApiLatencySummary(),
      database: {
        provenance: (deps.storageEngine === 'postgresql' ? 'measured' : 'unavailable') as MetricProvenance,
        poolHealth: deps.dbPoolHealth,
        queries: this.getQueryDiagnostics(),
      },
      cache: deps.cacheStats,
      connectors: {
        provenance: (deps.connectorRuntimeHealth.length > 0 ? 'measured' : 'unavailable') as MetricProvenance,
        trackedCount: deps.connectorRuntimeHealth.length,
        openCircuitsCount: deps.connectorRuntimeHealth.filter((c) => c.circuitState === 'open').length,
        items: deps.connectorRuntimeHealth,
      },
      workflows: this.getWorkflowDiagnostics(),
      recentErrors: {
        provenance: 'measured' as MetricProvenance,
        count: this.recentErrors.length,
        items: this.getRecentErrors(),
      },
      backupRestore: deps.backupStatus,
    };
  }
}

export const observabilityService = new ObservabilityService();
