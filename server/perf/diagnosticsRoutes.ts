// Phase 17: Owner-Only Performance & Reliability Diagnostics Routes
// Mounted onto protectedApi (requireOwnerAuth + validateCsrf).
// Exposes strictly sanitized operational metrics with explicit provenance tags.
// Never exposes credentials, SQL bind values, session tokens, private notes, or PII.

import type { Request, Response, Router } from 'express';
import { observabilityService } from './observabilityService.js';
import { leedCache, type CacheNamespace } from './cacheManager.js';
import {
  getBackupRestoreReadinessStatus,
  runIsolatedJsonBackupRestoreDrill,
} from './backupRestoreService.js';
import { connectorExecutionEngine, connectorRegistry, ensureConnectorsRegistered } from '../connectors/index.js';
import { dbManager } from '../db/pool.js';

export interface DiagnosticsRouteDependencies {
  getStorageInfo: () => { isPg: boolean; jsonFilePath: string };
  sanitizeApiError: (err: unknown, fallback: string) => string;
  normalizeClientIp?: (req: Request) => string;
  recordPgAuditEvent?: (
    eventType: string,
    actorEmail: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    ipAddress: string
  ) => Promise<unknown>;
}

export function registerDiagnosticsRoutes(
  router: Router,
  deps: DiagnosticsRouteDependencies
): void {
  const { getStorageInfo, sanitizeApiError, normalizeClientIp, recordPgAuditEvent } = deps;

  const logAudit = async (
    isPg: boolean,
    req: Request,
    eventType: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>
  ) => {
    if (!isPg || !req.owner || !recordPgAuditEvent) return;
    try {
      await recordPgAuditEvent(
        eventType,
        req.owner.email,
        resourceType,
        resourceId,
        metadata,
        normalizeClientIp ? normalizeClientIp(req) : req.ip || ''
      );
    } catch {
      // Never fail diagnostics route on secondary audit error
    }
  };

  router.get('/diagnostics/performance', async (_req: Request, res: Response) => {
    try {
      const { isPg } = getStorageInfo();
      const dbPoolHealth = dbManager.getHealthStatus() as unknown as Record<string, unknown>;
      const cacheStats = leedCache.getStats();
      const connectorRuntimeHealth = connectorExecutionEngine.getRuntimeHealthSnapshot() as unknown as Array<
        Record<string, unknown>
      >;
      const backupStatus = getBackupRestoreReadinessStatus() as unknown as Record<string, unknown>;

      const snapshot = observabilityService.buildPerformanceSnapshot({
        storageEngine: isPg ? 'postgresql' : 'json_store',
        dbPoolHealth,
        cacheStats,
        connectorRuntimeHealth,
        backupStatus,
      });

      res.json(snapshot);
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to collect performance diagnostics.') });
    }
  });

  router.post('/diagnostics/cache/clear', async (req: Request, res: Response) => {
    try {
      const { isPg } = getStorageInfo();
      const allowedNamespaces = new Set<CacheNamespace>([
        'bi_analytics',
        'crm_summary',
        'connector_metadata',
        'discovery_query',
        'quality_summary',
      ]);
      const rawNs =
        typeof req.body?.namespace === 'string' && req.body.namespace.trim()
          ? req.body.namespace.trim()
          : undefined;
      if (rawNs && !allowedNamespaces.has(rawNs as CacheNamespace)) {
        res.status(422).json({ error: 'Invalid cache namespace.', code: 'INVALID_CACHE_NAMESPACE' });
        return;
      }
      const namespace = rawNs as CacheNamespace | undefined;
      const clearedEntries = namespace
        ? leedCache.invalidateNamespace(namespace)
        : leedCache.clearAll();

      await logAudit(isPg, req, 'DIAGNOSTICS_CACHE_CLEARED', 'cache', namespace || 'all', {
        clearedEntries,
      });

      res.json({
        cleared: true,
        namespace: namespace || 'all',
        clearedEntries,
        cacheStats: leedCache.getStats(),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to clear performance cache.') });
    }
  });

  router.post('/diagnostics/connectors/:id/reset-circuit', async (req: Request, res: Response) => {
    try {
      ensureConnectorsRegistered();
      const connectorId = req.params.id?.trim();
      if (!connectorId) {
        res.status(422).json({ error: 'Connector ID is required.', code: 'INVALID_CONNECTOR_ID' });
        return;
      }
      const connector = connectorRegistry.getById(connectorId);
      if (!connector) {
        res.status(404).json({ error: 'Connector not found.', code: 'CONNECTOR_NOT_FOUND' });
        return;
      }

      const { isPg } = getStorageInfo();
      connectorExecutionEngine.resetCircuitBreaker(connectorId);
      await logAudit(isPg, req, 'DIAGNOSTICS_CIRCUIT_RESET', 'connector', connectorId, {
        connectorName: connector.getMetadata().name,
      });

      res.json({
        reset: true,
        connectorId,
        circuitState: connectorExecutionEngine.getCircuitState(connectorId),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to reset connector circuit breaker.') });
    }
  });

  router.post('/diagnostics/backup/verify-isolated', async (req: Request, res: Response) => {
    try {
      const { isPg, jsonFilePath } = getStorageInfo();
      const drill = runIsolatedJsonBackupRestoreDrill(jsonFilePath);
      await logAudit(isPg, req, 'DIAGNOSTICS_BACKUP_DRILL_EXECUTED', 'backup_drill', drill.drillType, {
        verified: drill.verified,
        durationMs: drill.durationMs,
        checksumVerified: drill.checksumVerified,
        tamperDetectionVerified: drill.tamperDetectionVerified,
        recordCountsMatched: drill.recordCountsMatched,
      });

      res.json({
        drill,
        readiness: getBackupRestoreReadinessStatus(),
      });
    } catch (err: unknown) {
      res.status(500).json({ error: sanitizeApiError(err, 'Failed to execute isolated backup verification drill.') });
    }
  });
}
