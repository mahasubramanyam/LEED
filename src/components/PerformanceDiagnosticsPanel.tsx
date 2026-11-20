import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Database,
  RefreshCw,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  HardDrive,
  RotateCcw,
  Layers,
  Workflow,
  CheckCircle,
} from 'lucide-react';

type MetricProvenance = 'measured' | 'calculated' | 'estimated' | 'unavailable';

interface PerformanceSnapshot {
  generatedAt: string;
  provenanceLegend: Record<MetricProvenance, string>;
  storageEngine: 'postgresql' | 'json_store';
  process: {
    provenance: MetricProvenance;
    uptimeSeconds: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    heapUtilizationPercent: number | null;
  };
  apiLatency: {
    provenance: MetricProvenance;
    totalRequests: number;
    totalServerErrors: number;
    overallAvgMs: number;
    overallP50Ms: number;
    overallP95Ms: number;
    trackedRouteGroups: number;
    maxTrackedRouteGroups: number;
    topSlowRoutes: Array<{
      route: string;
      count: number;
      errorCount: number;
      avgMs: number;
      p50Ms: number;
      p95Ms: number;
      maxMs: number;
      lastStatus: number;
      lastSeenAt: string;
    }>;
  };
  database: {
    provenance: MetricProvenance;
    poolHealth: {
      isConfigured?: boolean;
      isConnected?: boolean;
      engine?: string;
      totalClients?: number;
      idleClients?: number;
      waitingClients?: number;
      maxClients?: number;
      statementTimeoutMs?: number;
      reconnectAttempts?: number;
      consecutiveFailures?: number;
      error?: string;
    };
    queries: {
      provenance: MetricProvenance;
      slowQueryThresholdMs: number;
      totalQueriesMeasured: number;
      avgQueryMs: number | null;
      slowQueryCount: number;
      recentSlowQueries: Array<{
        id: string;
        label: string;
        durationMs: number;
        rowCount?: number;
        recordedAt: string;
      }>;
    };
  };
  cache: {
    provenance: MetricProvenance;
    currentEntries: number;
    maxEntries: number;
    currentEstimatedBytes: number;
    maxEstimatedBytes: number;
    hits: number;
    misses: number;
    hitRatePercent: number | null;
    evictions: number;
    invalidations: number;
  };
  connectors: {
    provenance: MetricProvenance;
    trackedCount: number;
    openCircuitsCount: number;
    items: Array<{
      connectorId: string;
      connectorName: string;
      totalCalls: number;
      successes: number;
      failures: number;
      failureRatePercent: number | null;
      timeouts: number;
      rateLimited: number;
      circuitState: 'closed' | 'open' | 'half_open';
      circuitOpens: number;
      avgLatencyMs: number | null;
      p95LatencyMs: number | null;
      lastErrorCategory?: string;
      lastRunAt?: string;
    }>;
  };
  workflows: {
    provenance: MetricProvenance;
    sampleCount: number;
    failedCount: number;
    avgDurationMs: number | null;
    p95DurationMs: number | null;
    recentExecutions: Array<{
      workflowId: string;
      workflowName: string;
      status: string;
      durationMs: number;
      stepCount: number;
      recordedAt: string;
    }>;
  };
  recentErrors: {
    provenance: MetricProvenance;
    count: number;
    items: Array<{
      id: string;
      source: string;
      statusCode?: number;
      message: string;
      recordedAt: string;
    }>;
  };
  backupRestore: {
    provenance: MetricProvenance;
    isolatedJsonDrill: {
      verified: boolean;
      lastVerifiedAt: string | null;
      lastChecksum: string | null;
      lastRecordCounts: Record<string, number> | null;
      tamperDetectionVerified: boolean;
    };
    productionPostgresBackupRestore: {
      status: string;
      reason: string;
      recommendedProcedure: string[];
    };
  };
}

interface PerformanceDiagnosticsPanelProps {
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const PROVENANCE_LABEL: Record<MetricProvenance, string> = {
  measured: 'Measured',
  calculated: 'Calculated',
  estimated: 'Estimated',
  unavailable: 'Unavailable',
};

function ProvenanceTag({ value }: { value: MetricProvenance }) {
  const tone =
    value === 'measured'
      ? 'text-emerald-700 dark:text-emerald-400'
      : value === 'calculated'
        ? 'text-blue-700 dark:text-blue-400'
        : value === 'estimated'
          ? 'text-amber-700 dark:text-amber-400'
          : 'text-slate-500 dark:text-slate-400';

  return (
    <span className={`text-[10px] font-mono uppercase tracking-wider ${tone}`}>
      {PROVENANCE_LABEL[value] || value}
    </span>
  );
}

function formatUptime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export const PerformanceDiagnosticsPanel: React.FC<PerformanceDiagnosticsPanelProps> = ({
  apiFetch,
}) => {
  const [snapshot, setSnapshot] = useState<PerformanceSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/diagnostics/performance');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: PerformanceSnapshot = await res.json();
      setSnapshot(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load performance diagnostics.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  const handleClearCache = async () => {
    setBusyAction('clear_cache');
    setNotice(null);
    try {
      const res = await apiFetch('/api/diagnostics/cache/clear', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clear cache.');
      setNotice({
        type: 'success',
        text: `Cleared ${data.clearedEntries ?? 0} bounded read-cache entries.`,
      });
      await loadSnapshot();
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to clear cache.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleResetCircuit = async (connectorId: string) => {
    setBusyAction(`circuit:${connectorId}`);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/diagnostics/connectors/${encodeURIComponent(connectorId)}/reset-circuit`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset circuit breaker.');
      setNotice({
        type: 'success',
        text: `Circuit breaker for ${connectorId} reset to closed.`,
      });
      await loadSnapshot();
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to reset circuit breaker.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleRunBackupDrill = async () => {
    setBusyAction('backup_drill');
    setNotice(null);
    try {
      const res = await apiFetch('/api/diagnostics/backup/verify-isolated', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Isolated backup verification drill failed.');
      const drill = data.drill;
      setNotice({
        type: drill?.verified ? 'success' : 'error',
        text: drill?.verified
          ? `Isolated JSON backup/restore drill verified in ${drill.durationMs}ms (SHA-256 + tamper rejection confirmed; live data untouched).`
          : `Isolated backup drill reported failure: ${drill?.error || 'Check checksum/schema integrity.'}`,
      });
      await loadSnapshot();
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Isolated backup drill failed.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500">
        Collecting sanitized runtime performance telemetry...
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-xl p-6 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-4">
        <span>{error}</span>
        <button
          onClick={loadSnapshot}
          className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!snapshot) return null;

  const cacheKb = ((snapshot.cache.currentEstimatedBytes || 0) / 1024).toFixed(1);
  const cacheMaxMb = ((snapshot.cache.maxEstimatedBytes || 16 * 1024 * 1024) / (1024 * 1024)).toFixed(0);

  return (
    <div className="space-y-6">
      {/* Header Controls Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Runtime Performance, Reliability &amp; Observability
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Sanitized in-process telemetry with bounded buffers. Zero credentials, SQL bind values, or private note bodies are logged.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadSnapshot}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleClearCache}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Read Cache
          </button>
          <button
            onClick={handleRunBackupDrill}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-900 dark:bg-blue-600 text-white hover:bg-slate-800 dark:hover:bg-blue-500 disabled:opacity-50"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {busyAction === 'backup_drill' ? 'Running Drill...' : 'Verify Isolated Backup'}
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs flex items-center gap-2 ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Primary KPI Strip (Zero pill clutter, crisp hairline borders, tabular numerals) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">API Latency (p95 / p50)</span>
            <ProvenanceTag value={snapshot.apiLatency.provenance} />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {snapshot.apiLatency.overallP95Ms} ms
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1.5">
              / {snapshot.apiLatency.overallP50Ms} ms
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {snapshot.apiLatency.totalRequests.toLocaleString()} requests · {snapshot.apiLatency.totalServerErrors} 5xx errors
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Bounded Read Cache</span>
            <ProvenanceTag value={snapshot.cache.provenance} />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {snapshot.cache.hitRatePercent !== null ? `${snapshot.cache.hitRatePercent}%` : '—'}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {snapshot.cache.currentEntries}/{snapshot.cache.maxEntries} keys · {cacheKb} KB / {cacheMaxMb} MB · {snapshot.cache.hits} hits / {snapshot.cache.misses} misses
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Node Heap / RSS</span>
            <ProvenanceTag value={snapshot.process.provenance} />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {snapshot.process.heapUsedMb} MB
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1.5">
              / {snapshot.process.rssMb} MB RSS
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Uptime {formatUptime(snapshot.process.uptimeSeconds)} · Heap util {snapshot.process.heapUtilizationPercent ?? 0}%
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">DB Queries &amp; Pool</span>
            <ProvenanceTag value={snapshot.database.queries.provenance} />
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white tabular-nums">
            {snapshot.database.queries.avgQueryMs !== null ? `${snapshot.database.queries.avgQueryMs} ms` : '—'}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {snapshot.database.queries.totalQueriesMeasured} measured · {snapshot.database.queries.slowQueryCount} slow (&ge;{snapshot.database.queries.slowQueryThresholdMs}ms) · Engine: {snapshot.storageEngine}
          </div>
        </div>
      </div>

      {/* API Route Group Latency Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white">Top API Route Groups by p95 Latency</h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Dynamic entity IDs are normalized to <code className="font-mono">:id</code> / <code className="font-mono">:uuid</code> to prevent PII leakage and cardinality growth.
            </p>
          </div>
          <ProvenanceTag value={snapshot.apiLatency.provenance} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                <th className="px-5 py-2.5 font-medium">Route</th>
                <th className="px-3 py-2.5 font-medium text-right">Calls</th>
                <th className="px-3 py-2.5 font-medium text-right">Avg (ms)</th>
                <th className="px-3 py-2.5 font-medium text-right">p50 (ms)</th>
                <th className="px-3 py-2.5 font-medium text-right">p95 (ms)</th>
                <th className="px-3 py-2.5 font-medium text-right">Max (ms)</th>
                <th className="px-5 py-2.5 font-medium text-right">5xx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
              {snapshot.apiLatency.topSlowRoutes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-slate-400">
                    No API route latency samples recorded yet in this server process.
                  </td>
                </tr>
              ) : (
                snapshot.apiLatency.topSlowRoutes.map((r) => (
                  <tr key={r.route} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="px-5 py-2 font-mono text-[11px] text-slate-800 dark:text-slate-200">{r.route}</td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{r.count}</td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{r.avgMs}</td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{r.p50Ms}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">{r.p95Ms}</td>
                    <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{r.maxMs}</td>
                    <td className={`px-5 py-2 text-right ${r.errorCount > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-400'}`}>
                      {r.errorCount}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2-Column Grid: Connector Circuit Breakers & Workflow / DB Slow Queries */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Connector Circuit Breaker & Runtime Health */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              Connector Circuit Breakers &amp; Failure Rates
            </h3>
            <ProvenanceTag value={snapshot.connectors.provenance} />
          </div>
          <div className="p-4">
            {snapshot.connectors.items.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                No connector executions recorded yet in this server process.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs tabular-nums">
                {snapshot.connectors.items.map((c) => (
                  <div key={c.connectorId} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100 truncate">
                        {c.connectorName || c.connectorId}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {c.totalCalls} calls · {c.failureRatePercent ?? 0}% fail · p95 {c.p95LatencyMs ?? 0}ms
                        {c.lastErrorCategory ? ` · last: ${c.lastErrorCategory}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[11px] font-mono uppercase ${
                          c.circuitState === 'closed'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : c.circuitState === 'half_open'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-rose-700 dark:text-rose-400 font-semibold'
                        }`}
                      >
                        {c.circuitState}
                      </span>
                      {c.circuitState !== 'closed' && (
                        <button
                          onClick={() => handleResetCircuit(c.connectorId)}
                          disabled={busyAction !== null}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Workflow Execution Reliability & Slow Queries */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Workflow className="w-3.5 h-3.5 text-slate-500" />
              Workflow Execution Telemetry &amp; Slow Queries
            </h3>
            <ProvenanceTag value={snapshot.workflows.provenance} />
          </div>
          <div className="p-4 space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-3 border-b border-slate-100 dark:border-slate-800 pb-3 tabular-nums">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Runs Sampled</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                  {snapshot.workflows.sampleCount}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Avg / p95 Duration</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                  {snapshot.workflows.avgDurationMs !== null
                    ? `${snapshot.workflows.avgDurationMs}ms / ${snapshot.workflows.p95DurationMs ?? 0}ms`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Failed Runs</div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                  {snapshot.workflows.failedCount}
                </div>
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-2 flex items-center justify-between">
                <span>Slow PostgreSQL Queries (&ge; {snapshot.database.queries.slowQueryThresholdMs}ms)</span>
                <span className="tabular-nums text-slate-400">{snapshot.database.queries.slowQueryCount} recorded</span>
              </div>
              {snapshot.database.queries.recentSlowQueries.length === 0 ? (
                <p className="text-[11px] text-slate-400">No slow PostgreSQL queries detected in this server process.</p>
              ) : (
                <div className="space-y-1.5 tabular-nums">
                  {snapshot.database.queries.recentSlowQueries.slice(0, 6).map((q) => (
                    <div key={q.id} className="flex items-center justify-between text-[11px] py-1 border-b border-slate-100 dark:border-slate-800/60">
                      <span className="font-mono text-slate-700 dark:text-slate-300 truncate pr-2">{q.label}</span>
                      <span className="font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                        {q.durationMs} ms
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Backup & Restore Readiness Verification */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <HardDrive className="w-3.5 h-3.5 text-slate-500" />
            Backup &amp; Restore Readiness Verification
          </h3>
          <ProvenanceTag value={snapshot.backupRestore.provenance} />
        </div>
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="space-y-2">
            <div className="font-semibold text-slate-900 dark:text-white flex items-center justify-between">
              <span>Isolated JSON Store Snapshot &amp; Restore Drill</span>
              <span
                className={`font-mono text-[11px] uppercase ${
                  snapshot.backupRestore.isolatedJsonDrill.verified
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {snapshot.backupRestore.isolatedJsonDrill.verified ? 'Verified' : 'Not Run Yet'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Creates a SHA-256 verified snapshot in an isolated OS temp directory, restores and compares record counts, verifies tamper rejection, and cleans up without touching live files.
            </p>
            {snapshot.backupRestore.isolatedJsonDrill.lastVerifiedAt && (
              <div className="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-1 font-mono text-[11px] tabular-nums">
                <div>Last Drill: {new Date(snapshot.backupRestore.isolatedJsonDrill.lastVerifiedAt).toLocaleString()}</div>
                <div className="truncate">SHA-256: {snapshot.backupRestore.isolatedJsonDrill.lastChecksum}</div>
                <div>
                  Tamper Rejection: {snapshot.backupRestore.isolatedJsonDrill.tamperDetectionVerified ? 'PASS' : 'FAIL'}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-slate-900 dark:text-white flex items-center justify-between">
              <span>Production Neon PostgreSQL Backup/Restore</span>
              <span className="font-mono text-[11px] uppercase text-amber-700 dark:text-amber-400">
                Not Verified in Runtime
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {snapshot.backupRestore.productionPostgresBackupRestore.reason}
            </p>
            <ol className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300 font-mono bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
              {snapshot.backupRestore.productionPostgresBackupRestore.recommendedProcedure.map((step, i) => (
                <li key={i} className="break-words">{step}</li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Recent Sanitized Errors & Cache Policy Footer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-slate-500" />
              PostgreSQL Pool Configuration
            </h3>
            <ProvenanceTag value={snapshot.database.provenance} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Active / Idle / Max Clients</div>
              <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                {snapshot.database.poolHealth.totalClients ?? 0} / {snapshot.database.poolHealth.idleClients ?? 0} / {snapshot.database.poolHealth.maxClients ?? 10}
              </div>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-2.5">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Statement Timeout / Reconnects</div>
              <div className="font-semibold text-slate-900 dark:text-white mt-0.5">
                {snapshot.database.poolHealth.statementTimeoutMs ?? 15000} ms / {snapshot.database.poolHealth.reconnectAttempts ?? 0}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-slate-500" />
              Recent Sanitized Server Errors ({snapshot.recentErrors.count})
            </h3>
            <ProvenanceTag value={snapshot.recentErrors.provenance} />
          </div>
          {snapshot.recentErrors.items.length === 0 ? (
            <p className="text-xs text-slate-400">No 5xx server errors recorded in this process.</p>
          ) : (
            <div className="space-y-1.5 text-[11px] max-h-40 overflow-y-auto">
              {snapshot.recentErrors.items.slice(0, 8).map((e) => (
                <div key={e.id} className="border-b border-slate-100 dark:border-slate-800 pb-1.5">
                  <div className="flex items-center justify-between font-mono text-slate-700 dark:text-slate-300">
                    <span>{e.source}</span>
                    <span className="text-rose-600 dark:text-rose-400">{e.statusCode ?? 'ERR'}</span>
                  </div>
                  <div className="text-slate-500 dark:text-slate-400 truncate">{e.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
