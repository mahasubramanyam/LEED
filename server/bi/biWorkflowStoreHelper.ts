// Phase 16: Dual-Storage Persistence Helper for Business Intelligence Reports & Workflow Automation
// Persists workflows, executions, notifications, saved report configs, idempotency ledger, and audit logs
// under '__bi_workflows_v1' inside app_settings.connector_configs JSONB via CrmStorageFacade.
// Works seamlessly across BOTH PostgreSQL and JSON StorageManager with zero new SQL migrations.
// Automatically stripped from public getConnectorConfigs() (all '__*' keys are excluded).

import crypto from 'crypto';
import type {
  BiWorkflowAuditEntry,
  BiWorkflowWorkspaceState,
} from '../../shared/biWorkflowTypes.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import { dbManager } from '../db/pool.js';
import { leedCache } from '../perf/cacheManager.js';

export const BI_WORKFLOW_SETTINGS_KEY = '__bi_workflows_v1';

// In-process serialized write queue + optional PostgreSQL advisory lock to prevent concurrent read-modify-write races
let writeQueue: Promise<unknown> = Promise.resolve();

export function withBiWorkflowLock<T>(fn: () => Promise<T>): Promise<T> {
  const wrapped = () => dbManager.withAdvisoryLock('leed:bi_workflows_v1', fn);
  const next = writeQueue.then(wrapped, wrapped);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export function generateBiWorkflowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export async function getBiWorkflowWorkspaceState(
  facade: CrmStorageFacade
): Promise<BiWorkflowWorkspaceState> {
  const settings = await facade.getSettings();
  const rawMap = (settings.connectorConfigs || {}) as Record<string, unknown>;
  const raw = rawMap[BI_WORKFLOW_SETTINGS_KEY] as Partial<BiWorkflowWorkspaceState> | undefined;

  return {
    version: 1,
    workflows: Array.isArray(raw?.workflows) ? raw.workflows : [],
    executions: Array.isArray(raw?.executions) ? raw.executions : [],
    notifications: Array.isArray(raw?.notifications) ? raw.notifications : [],
    savedReports: Array.isArray(raw?.savedReports) ? raw.savedReports : [],
    idempotencyLedger:
      raw?.idempotencyLedger && typeof raw.idempotencyLedger === 'object'
        ? raw.idempotencyLedger
        : {},
    auditLog: Array.isArray(raw?.auditLog) ? raw.auditLog : [],
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  };
}

export async function saveBiWorkflowWorkspaceState(
  facade: CrmStorageFacade,
  next: BiWorkflowWorkspaceState
): Promise<BiWorkflowWorkspaceState> {
  // Bound idempotency ledger to most recent 1500 keys so JSONB stays compact across restarts
  const ledgerEntries = Object.entries(next.idempotencyLedger || {});
  let trimmedLedger = next.idempotencyLedger || {};
  if (ledgerEntries.length > 1500) {
    ledgerEntries.sort((a, b) => (b[1]?.recordedAt || '').localeCompare(a[1]?.recordedAt || ''));
    trimmedLedger = Object.fromEntries(ledgerEntries.slice(0, 1500));
  }

  const stamped: BiWorkflowWorkspaceState = {
    version: 1,
    workflows: next.workflows.slice(0, 100),
    executions: next.executions.slice(0, 400),
    notifications: next.notifications.slice(0, 200),
    savedReports: next.savedReports.slice(0, 100),
    idempotencyLedger: trimmedLedger,
    auditLog: next.auditLog.slice(0, 300),
    updatedAt: new Date().toISOString(),
  };

  await facade.updateSettings({
    connectorConfigs: {
      [BI_WORKFLOW_SETTINGS_KEY]: stamped as any,
    },
  });
  leedCache.invalidateOnOutreachOrWorkflowWrite();
  return stamped;
}

export function appendBiWorkflowAudit(
  ws: BiWorkflowWorkspaceState,
  entry: Omit<BiWorkflowAuditEntry, 'id' | 'timestamp'>
): BiWorkflowAuditEntry {
  const item: BiWorkflowAuditEntry = {
    id: generateBiWorkflowId('bwaud'),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  ws.auditLog = [item, ...ws.auditLog].slice(0, 300);
  return item;
}
