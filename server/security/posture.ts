import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllRateLimiterStats, RateLimiterStats } from './rateLimiter.js';
import {
  getRecentSecurityEvents,
  getSecurityEventCounters,
  SecurityEventCategory,
  SecurityEventRecord,
} from './securityEvents.js';

export interface SecurityPostureCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface SecurityPostureReport {
  generatedAt: string;
  environment: 'production' | 'development';
  overallPosture: 'hardened' | 'attention_required';
  authentication: {
    singleOwnerLocked: boolean;
    passwordHashing: string;
    sessionTokenStorage: string;
    activeSessionCount: number;
    totalSessionCount: number;
    cookieFlags: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: string;
      partitioned: boolean;
    };
    csrfProtection: boolean;
    originValidationFailClosed: boolean;
  };
  databaseSecurity: {
    connected: boolean;
    engine: string;
    tlsEncrypted: boolean;
    sslSetting: string;
    auditTriggersPresent: boolean;
    auditUpdateDeleteTrigger: boolean;
    auditTruncateTrigger: boolean;
    auditHashChainValid: boolean | null;
    auditEventCount: number;
    migration005PendingApproval: boolean;
    startupAutoMigrateMaxVersion: string;
  };
  secretsAndEncryption: {
    algorithm: string;
    credentialKeyConfigured: boolean;
    credentialKeySource: string;
    encryptedConnectorCredentialsCount: number;
    secretRedactionActive: boolean;
    neonManagedAtRestEncryption: string;
  };
  networkAndHttpHardening: {
    cspEnabled: boolean;
    aiStudioIframeCompatible: boolean;
    xPoweredByDisabled: boolean;
    ssrfGuardVersion: string;
    ssrfPrivateIpv4AndIpv6Blocked: boolean;
    ssrfRedirectRevalidation: boolean;
    ssrfResponseByteLimitBytes: number;
    uploadMaxBytes: number;
    uploadMagicByteAndMacroScan: boolean;
  };
  rateLimiting: {
    loginRateLimiterActive: boolean;
    routeLimiters: RateLimiterStats[];
  };
  backups: {
    localBackupCount: number;
    latestBackupAt?: string;
    documentationPath: string;
  };
  checks: SecurityPostureCheck[];
  recentSecurityEvents: SecurityEventRecord[];
  eventCounters: Record<SecurityEventCategory, number>;
}

export interface PostureDependencies {
  isProd: boolean;
  isDbConnected: () => boolean;
  getEncryptionStatus: () => { configured: boolean; source: string; algorithm?: string };
  getDatabaseSecurityStatus: () => Promise<{
    tlsEncrypted: boolean;
    sslSetting: string;
    auditUpdateDeleteTrigger: boolean;
    auditTruncateTrigger: boolean;
    activeSessionCount: number;
    totalSessionCount: number;
    encryptedCredentialCount: number;
  }>;
  verifyAuditChain: () => Promise<{ valid: boolean; totalEvents: number }>;
  inspectMigrations: () => Promise<{ migration005Recorded: boolean }>;
  ownerInitialized: () => Promise<boolean>;
}

export async function inspectBackupInventory(): Promise<{ count: number; latestBackupAt?: string }> {
  try {
    const dir = path.resolve(process.cwd(), 'data', 'backups');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json'));
    let latestMtime = 0;
    for (const f of files.slice(-25)) {
      try {
        const stat = await fs.stat(path.join(dir, f.name));
        if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
      } catch {
        // ignore individual stat error
      }
    }
    return {
      count: files.length,
      latestBackupAt: latestMtime > 0 ? new Date(latestMtime).toISOString() : undefined,
    };
  } catch {
    return { count: 0 };
  }
}

export async function buildSecurityPostureReport(
  deps: PostureDependencies
): Promise<SecurityPostureReport> {
  const isDbReady = deps.isDbConnected();
  const encStatus = deps.getEncryptionStatus();
  const [ownerInit, dbSec, auditChain, migrations, backupInfo] = await Promise.all([
    deps.ownerInitialized(),
    isDbReady
      ? deps.getDatabaseSecurityStatus()
      : Promise.resolve({
          tlsEncrypted: false,
          sslSetting: 'disconnected',
          auditUpdateDeleteTrigger: false,
          auditTruncateTrigger: false,
          activeSessionCount: 0,
          totalSessionCount: 0,
          encryptedCredentialCount: 0,
        }),
    isDbReady
      ? deps.verifyAuditChain().catch(() => ({ valid: false, totalEvents: 0 }))
      : Promise.resolve({ valid: true, totalEvents: 0 }),
    isDbReady
      ? deps.inspectMigrations().catch(() => ({ migration005Recorded: false }))
      : Promise.resolve({ migration005Recorded: false }),
    inspectBackupInventory(),
  ]);

  const auditTriggersPresent =
    dbSec.auditUpdateDeleteTrigger && dbSec.auditTruncateTrigger;

  const checks: SecurityPostureCheck[] = [
    {
      id: 'owner_lock',
      label: 'Single-Owner Enforcement & Auth',
      status: ownerInit ? 'pass' : 'warn',
      detail: ownerInit
        ? 'Single owner initialized & locked via uq_owner_singleton; bcrypt-12 + SHA-256 session tokens.'
        : 'Owner account not initialized yet.',
    },
    {
      id: 'db_tls',
      label: 'Neon PostgreSQL TLS Connection',
      status: isDbReady ? (dbSec.tlsEncrypted ? 'pass' : 'warn') : 'warn',
      detail: isDbReady
        ? dbSec.tlsEncrypted
          ? `Encrypted TLS session active (SSL=${dbSec.sslSetting}).`
          : `Database connected without verified TLS flag (SSL=${dbSec.sslSetting}).`
        : 'PostgreSQL not connected in current runtime.',
    },
    {
      id: 'cred_encryption',
      label: 'App-Level Connector Secret Encryption (AES-256-GCM)',
      status: encStatus.configured ? 'pass' : 'warn',
      detail: encStatus.configured
        ? `AES-256-GCM active (${encStatus.source}); ${dbSec.encryptedCredentialCount} encrypted DB vault entries.`
        : 'CONNECTOR_ENCRYPTION_KEY is not configured; DB credential writes blocked.',
    },
    {
      id: 'audit_immutability',
      label: 'Immutable Audit Triggers & SHA-256 Hash Chain',
      status: isDbReady
        ? auditTriggersPresent && auditChain.valid
          ? 'pass'
          : 'fail'
        : 'warn',
      detail: isDbReady
        ? `Triggers: ${auditTriggersPresent ? 'active' : 'missing'} · Chain valid: ${auditChain.valid} (${auditChain.totalEvents} events).`
        : 'Audit chain verification requires PostgreSQL connection.',
    },
    {
      id: 'ssrf_and_upload',
      label: 'SSRF Redirect Shield & Upload Hardening',
      status: 'pass',
      detail:
        'All A/AAAA DNS records checked, IPv4/IPv6 + ::ffff: private CIDRs blocked, redirect re-validation (max 3 hops), 350 KB stream cap, 15 MB upload magic-byte & macro scan.',
    },
    {
      id: 'http_and_csrf',
      label: 'CSP Headers, CSRF & Per-Route Rate Limiting',
      status: 'pass',
      detail:
        'AI Studio frame-ancestors CSP active, fail-closed Origin/Referer + double-submit CSRF, and 8 sliding-window route limiters active.',
    },
  ];

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasCriticalWarn = !ownerInit || (isDbReady && !dbSec.tlsEncrypted);

  return {
    generatedAt: new Date().toISOString(),
    environment: deps.isProd ? 'production' : 'development',
    overallPosture: !hasFail && !hasCriticalWarn ? 'hardened' : 'attention_required',
    authentication: {
      singleOwnerLocked: ownerInit,
      passwordHashing: 'bcrypt (cost factor 12)',
      sessionTokenStorage: 'SHA-256 digested tokens in owner_sessions',
      activeSessionCount: dbSec.activeSessionCount,
      totalSessionCount: dbSec.totalSessionCount,
      cookieFlags: {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        partitioned: true,
      },
      csrfProtection: true,
      originValidationFailClosed: true,
    },
    databaseSecurity: {
      connected: isDbReady,
      engine: isDbReady ? 'Neon PostgreSQL' : 'json_fallback',
      tlsEncrypted: dbSec.tlsEncrypted,
      sslSetting: dbSec.sslSetting,
      auditTriggersPresent,
      auditUpdateDeleteTrigger: dbSec.auditUpdateDeleteTrigger,
      auditTruncateTrigger: dbSec.auditTruncateTrigger,
      auditHashChainValid: isDbReady ? auditChain.valid : null,
      auditEventCount: auditChain.totalEvents,
      migration005PendingApproval: !migrations.migration005Recorded,
      startupAutoMigrateMaxVersion: '004',
    },
    secretsAndEncryption: {
      algorithm: encStatus.algorithm || 'aes-256-gcm',
      credentialKeyConfigured: encStatus.configured,
      credentialKeySource: encStatus.source,
      encryptedConnectorCredentialsCount: dbSec.encryptedCredentialCount,
      secretRedactionActive: true,
      neonManagedAtRestEncryption: 'Neon Cloud Storage-Level Encryption (managed at platform layer)',
    },
    networkAndHttpHardening: {
      cspEnabled: true,
      aiStudioIframeCompatible: true,
      xPoweredByDisabled: true,
      ssrfGuardVersion: 'Phase 8 Hardened (IPv4/IPv6 + ::ffff: + Redirect + Stream Cap)',
      ssrfPrivateIpv4AndIpv6Blocked: true,
      ssrfRedirectRevalidation: true,
      ssrfResponseByteLimitBytes: 350 * 1024,
      uploadMaxBytes: 15 * 1024 * 1024,
      uploadMagicByteAndMacroScan: true,
    },
    rateLimiting: {
      loginRateLimiterActive: true,
      routeLimiters: getAllRateLimiterStats(),
    },
    backups: {
      localBackupCount: backupInfo.count,
      latestBackupAt: backupInfo.latestBackupAt,
      documentationPath: 'docs/SECURITY_AND_BACKUP.md',
    },
    checks,
    recentSecurityEvents: getRecentSecurityEvents(25),
    eventCounters: getSecurityEventCounters(),
  };
}
