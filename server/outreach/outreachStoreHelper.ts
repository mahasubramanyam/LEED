// Phase 15: Dual-Storage Persistence Helper for Outreach & Follow-Up Automation
// Persists campaigns, sequences, enrollments, messages, follow-ups, replies, suppressions,
// compliance config, provider settings, telemetry, and audit logs under '__outreach_automation_v1'
// inside app_settings.connector_configs JSONB via CrmStorageFacade.
// Works seamlessly across BOTH PostgreSQL and JSON StorageManager with zero new SQL migrations.
// Note: Provider API keys/secrets are NEVER stored here — they live exclusively in CredentialManager (AES-256-GCM) or server env vars.

import crypto from 'crypto';
import type {
  OutreachAuditEntry,
  OutreachComplianceConfig,
  OutreachProviderSettings,
  OutreachWorkspaceState,
} from '../types.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import { leedCache } from '../perf/cacheManager.js';

export const OUTREACH_WORKSPACE_SETTINGS_KEY = '__outreach_automation_v1';

export function generateOutreachId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export function getDefaultComplianceConfig(ownerName = '', ownerEmail = ''): OutreachComplianceConfig {
  return {
    senderDisplayName: ownerName || 'Owner',
    senderEmail: ownerEmail || process.env.OUTREACH_FROM_EMAIL?.trim() || '',
    senderOrganization: '',
    senderPhysicalAddress: '',
    unsubscribeNoticeText:
      'If you prefer not to receive future emails from us, simply reply with "Unsubscribe" and we will promptly honor your request.',
    legalBasisDefault:
      'Targeted B2B commercial inquiry reviewed by the owner; public availability of contact information is NOT treated as blanket marketing consent.',
    includeIdentificationFooter: true,
    includeUnsubscribeFooter: true,
    requireExplicitApprovalAlways: true,
    maxContactsPerCompanyPerWeek: 3,
    maxContactsPerPersonPer14Days: 2,
    businessDaysOnlyDefault: true,
    sendWindowStartHour: 9,
    sendWindowEndHour: 17,
    updatedAt: new Date().toISOString(),
  };
}

export function getDefaultProviderSettings(ownerName = '', ownerEmail = ''): OutreachProviderSettings {
  return {
    defaultEmailProviderId: undefined,
    fromEmail: process.env.OUTREACH_FROM_EMAIL?.trim() || ownerEmail || '',
    fromName: process.env.OUTREACH_FROM_NAME?.trim() || ownerName || '',
    replyToEmail: undefined,
    maxRetries: 2,
    rateLimitPerHourByProvider: {
      'comm-resend': 100,
      'comm-sendgrid': 100,
      'comm-postmark': 100,
      'comm-mailgun': 100,
    },
    updatedAt: new Date().toISOString(),
  };
}

export async function getOutreachWorkspaceState(
  facade: CrmStorageFacade
): Promise<OutreachWorkspaceState> {
  const settings = await facade.getSettings();
  const rawMap = (settings.connectorConfigs || {}) as Record<string, unknown>;
  const raw = rawMap[OUTREACH_WORKSPACE_SETTINGS_KEY] as Partial<OutreachWorkspaceState> | undefined;

  const defaultCompliance = getDefaultComplianceConfig(settings.ownerName, settings.ownerEmail);
  const defaultProvider = getDefaultProviderSettings(settings.ownerName, settings.ownerEmail);

  return {
    version: 1,
    campaigns: Array.isArray(raw?.campaigns) ? raw.campaigns : [],
    sequences: Array.isArray(raw?.sequences) ? raw.sequences : [],
    enrollments: Array.isArray(raw?.enrollments) ? raw.enrollments : [],
    messages: Array.isArray(raw?.messages) ? raw.messages : [],
    followUps: Array.isArray(raw?.followUps) ? raw.followUps : [],
    replies: Array.isArray(raw?.replies) ? raw.replies : [],
    suppressions: Array.isArray(raw?.suppressions) ? raw.suppressions : [],
    complianceConfig:
      raw?.complianceConfig && typeof raw.complianceConfig === 'object'
        ? {
            ...defaultCompliance,
            ...raw.complianceConfig,
            requireExplicitApprovalAlways: true,
          }
        : defaultCompliance,
    providerSettings:
      raw?.providerSettings && typeof raw.providerSettings === 'object'
        ? {
            ...defaultProvider,
            ...raw.providerSettings,
            rateLimitPerHourByProvider: {
              ...defaultProvider.rateLimitPerHourByProvider,
              ...(raw.providerSettings.rateLimitPerHourByProvider || {}),
            },
          }
        : defaultProvider,
    providerTelemetry:
      raw?.providerTelemetry && typeof raw.providerTelemetry === 'object'
        ? raw.providerTelemetry
        : {},
    auditLog: Array.isArray(raw?.auditLog) ? raw.auditLog : [],
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  };
}

export async function saveOutreachWorkspaceState(
  facade: CrmStorageFacade,
  next: OutreachWorkspaceState
): Promise<OutreachWorkspaceState> {
  const stamped: OutreachWorkspaceState = {
    ...next,
    version: 1,
    complianceConfig: {
      ...next.complianceConfig,
      requireExplicitApprovalAlways: true,
    },
    auditLog: next.auditLog.slice(0, 300),
    updatedAt: new Date().toISOString(),
  };
  await facade.updateSettings({
    connectorConfigs: {
      [OUTREACH_WORKSPACE_SETTINGS_KEY]: stamped as any,
    },
  });
  leedCache.invalidateOnOutreachOrWorkflowWrite();
  return stamped;
}

export function appendOutreachAudit(
  ws: OutreachWorkspaceState,
  entry: Omit<OutreachAuditEntry, 'id' | 'timestamp'>
): OutreachAuditEntry {
  const item: OutreachAuditEntry = {
    id: generateOutreachId('oaud'),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  ws.auditLog = [item, ...ws.auditLog].slice(0, 300);
  return item;
}
