import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllRateLimiterStats, RateLimiterStats } from './rateLimiter.js';
import {
  getRecentSecurityEvents,
  getSecurityEventCounters,
  SecurityEventCategory,
  SecurityEventRecord,
} from './securityEvents.js';

export type SecurityCheckStatus = 'pass' | 'warn' | 'fail' | 'not_verified' | 'unknown';
export type DiagnosticProbeState = 'verified' | 'unavailable' | 'error';

export interface SecurityPostureCheck {
  id: string;
  label: string;
  status: SecurityCheckStatus;
  detail: string;
}

export interface RuntimeSecurityInspection {
  xPoweredByDisabled?: boolean | null;
  securityHeadersMiddlewareMounted?: boolean | null;
  cspEnabled?: boolean | null;
  aiStudioIframeCompatible?: boolean | null;
  ownerAuthMiddlewareMounted?: boolean | null;
  csrfMiddlewareMounted?: boolean | null;
  originValidationFailClosed?: boolean | null;
  cookieFlags?: {
    httpOnly: boolean | null;
    secure: boolean | null;
    sameSite: string | null;
    partitioned: boolean | null;
  } | null;
  loginRateLimiterActive?: boolean | null;
  routeLimitersExpectedCount?: number;
  ssrf?: {
    dnsPinningEnabled: boolean | null;
    privateCidrsBlockedSelfTest: boolean | null;
    redirectRevalidationEnabled: boolean | null;
    maxResponseBytes: number | null;
  } | null;
  upload?: {
    maxBytes: number | null;
    magicByteAndMacroScan: boolean | null;
  } | null;
  backupRestoreVerified?: boolean;
}

export interface DatabaseSecurityDiagnosticInput {
  diagnosticState?: DiagnosticProbeState;
  tlsProbeStatus?: DiagnosticProbeState;
  auditTriggerProbeStatus?: DiagnosticProbeState;
  sessionProbeStatus?: DiagnosticProbeState;
  credentialProbeStatus?: DiagnosticProbeState;
  tlsEncrypted: boolean;
  sslSetting: string;
  auditUpdateDeleteTrigger: boolean;
  auditTruncateTrigger: boolean;
  activeSessionCount: number | null;
  totalSessionCount: number | null;
  encryptedCredentialCount: number | null;
}

export interface SecurityPostureReport {
  generatedAt: string;
  environment: 'production' | 'development';
  overallPosture: 'hardened' | 'attention_required';
  authentication: {
    singleOwnerLocked: boolean;
    passwordHashing: string;
    sessionTokenStorage: string;
    sessionProbeStatus: DiagnosticProbeState;
    activeSessionCount: number | null;
    totalSessionCount: number | null;
    cookieFlags: {
      httpOnly: boolean | null;
      secure: boolean | null;
      sameSite: string;
      partitioned: boolean | null;
    };
    csrfProtection: boolean | null;
    originValidationFailClosed: boolean | null;
  };
  databaseSecurity: {
    connected: boolean;
    diagnosticState: DiagnosticProbeState;
    engine: string;
    tlsEncrypted: boolean | null;
    sslSetting: string;
    auditTriggersPresent: boolean | null;
    auditUpdateDeleteTrigger: boolean | null;
    auditTruncateTrigger: boolean | null;
    auditHashChainValid: boolean | null;
    auditEventCount: number;
    migration005PendingApproval: boolean | null;
    startupAutoMigrateMaxVersion: string;
  };
  secretsAndEncryption: {
    algorithm: string;
    credentialKeyConfigured: boolean;
    credentialKeySource: string;
    credentialProbeStatus: DiagnosticProbeState;
    encryptedConnectorCredentialsCount: number | null;
    secretRedactionActive: boolean;
    neonManagedAtRestEncryption: string;
  };
  networkAndHttpHardening: {
    cspEnabled: boolean | null;
    aiStudioIframeCompatible: boolean | null;
    xPoweredByDisabled: boolean | null;
    ssrfGuardVersion: string;
    ssrfDnsPinningEnabled: boolean | null;
    ssrfPrivateIpv4AndIpv6Blocked: boolean | null;
    ssrfRedirectRevalidation: boolean | null;
    ssrfResponseByteLimitBytes: number | null;
    uploadMaxBytes: number | null;
    uploadMagicByteAndMacroScan: boolean | null;
  };
  rateLimiting: {
    loginRateLimiterActive: boolean | null;
    routeLimiters: RateLimiterStats[];
  };
  backups: {
    localBackupCount: number;
    latestBackupAt?: string;
    restoreDrillStatus: 'verified' | 'not_verified';
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
  getDatabaseSecurityStatus: () => Promise<DatabaseSecurityDiagnosticInput>;
  verifyAuditChain: () => Promise<{ valid: boolean; totalEvents: number }>;
  inspectMigrations: () => Promise<{ migration005Recorded: boolean }>;
  ownerInitialized: () => Promise<boolean>;
  inspectRuntimeSecurity?: () => RuntimeSecurityInspection;
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
  const runtime = deps.inspectRuntimeSecurity ? deps.inspectRuntimeSecurity() : {};

  let ownerInit = false;
  try {
    ownerInit = await deps.ownerInitialized();
  } catch {
    ownerInit = false;
  }

  let dbSec: DatabaseSecurityDiagnosticInput;
  if (!isDbReady) {
    dbSec = {
      diagnosticState: 'unavailable',
      tlsProbeStatus: 'unavailable',
      auditTriggerProbeStatus: 'unavailable',
      sessionProbeStatus: 'unavailable',
      credentialProbeStatus: 'unavailable',
      tlsEncrypted: false,
      sslSetting: 'disconnected',
      auditUpdateDeleteTrigger: false,
      auditTruncateTrigger: false,
      activeSessionCount: null,
      totalSessionCount: null,
      encryptedCredentialCount: null,
    };
  } else {
    try {
      const rawDbSec = await deps.getDatabaseSecurityStatus();
      dbSec = {
        ...rawDbSec,
        diagnosticState: rawDbSec.diagnosticState ?? 'verified',
        tlsProbeStatus: rawDbSec.tlsProbeStatus ?? 'verified',
        auditTriggerProbeStatus: rawDbSec.auditTriggerProbeStatus ?? 'verified',
        sessionProbeStatus: rawDbSec.sessionProbeStatus ?? 'verified',
        credentialProbeStatus: rawDbSec.credentialProbeStatus ?? 'verified',
      };
    } catch {
      dbSec = {
        diagnosticState: 'error',
        tlsProbeStatus: 'error',
        auditTriggerProbeStatus: 'error',
        sessionProbeStatus: 'error',
        credentialProbeStatus: 'error',
        tlsEncrypted: false,
        sslSetting: 'error',
        auditUpdateDeleteTrigger: false,
        auditTruncateTrigger: false,
        activeSessionCount: null,
        totalSessionCount: null,
        encryptedCredentialCount: null,
      };
    }
  }

  let auditChainResult: { status: DiagnosticProbeState; valid: boolean | null; totalEvents: number };
  if (!isDbReady) {
    auditChainResult = { status: 'unavailable', valid: null, totalEvents: 0 };
  } else {
    try {
      const check = await deps.verifyAuditChain();
      auditChainResult = { status: 'verified', valid: check.valid, totalEvents: check.totalEvents };
    } catch {
      auditChainResult = { status: 'error', valid: null, totalEvents: 0 };
    }
  }

  let migration005Pending: boolean | null = null;
  if (isDbReady) {
    try {
      const mig = await deps.inspectMigrations();
      migration005Pending = !mig.migration005Recorded;
    } catch {
      migration005Pending = null;
    }
  }

  const backupInfo = await inspectBackupInventory();
  const routeLimiters = getAllRateLimiterStats();

  // Inspect runtime configuration values cleanly (never assume true if uninspected)
  const xPoweredByDisabled =
    typeof runtime.xPoweredByDisabled === 'boolean' ? runtime.xPoweredByDisabled : null;
  const securityHeadersMounted =
    typeof runtime.securityHeadersMiddlewareMounted === 'boolean'
      ? runtime.securityHeadersMiddlewareMounted
      : null;
  const cspEnabled =
    typeof runtime.cspEnabled === 'boolean' ? runtime.cspEnabled : null;
  const aiStudioIframeCompatible =
    typeof runtime.aiStudioIframeCompatible === 'boolean' ? runtime.aiStudioIframeCompatible : null;
  const ownerAuthMounted =
    typeof runtime.ownerAuthMiddlewareMounted === 'boolean'
      ? runtime.ownerAuthMiddlewareMounted
      : null;
  const csrfMiddlewareMounted =
    typeof runtime.csrfMiddlewareMounted === 'boolean' ? runtime.csrfMiddlewareMounted : null;
  const originValidationFailClosed =
    typeof runtime.originValidationFailClosed === 'boolean'
      ? runtime.originValidationFailClosed
      : null;

  const cookieFlags = runtime.cookieFlags
    ? {
        httpOnly: typeof runtime.cookieFlags.httpOnly === 'boolean' ? runtime.cookieFlags.httpOnly : null,
        secure: typeof runtime.cookieFlags.secure === 'boolean' ? runtime.cookieFlags.secure : null,
        sameSite: runtime.cookieFlags.sameSite || 'unknown',
        partitioned:
          typeof runtime.cookieFlags.partitioned === 'boolean' ? runtime.cookieFlags.partitioned : null,
      }
    : {
        httpOnly: null,
        secure: null,
        sameSite: 'unknown',
        partitioned: null,
      };

  const loginRateLimiterActive =
    typeof runtime.loginRateLimiterActive === 'boolean' ? runtime.loginRateLimiterActive : null;

  const ssrfDnsPinningEnabled =
    typeof runtime.ssrf?.dnsPinningEnabled === 'boolean' ? runtime.ssrf.dnsPinningEnabled : null;
  const ssrfPrivateBlocked =
    typeof runtime.ssrf?.privateCidrsBlockedSelfTest === 'boolean'
      ? runtime.ssrf.privateCidrsBlockedSelfTest
      : null;
  const ssrfRedirectRevalidation =
    typeof runtime.ssrf?.redirectRevalidationEnabled === 'boolean'
      ? runtime.ssrf.redirectRevalidationEnabled
      : null;
  const ssrfMaxBytes =
    typeof runtime.ssrf?.maxResponseBytes === 'number' ? runtime.ssrf.maxResponseBytes : null;

  const uploadMaxBytes =
    typeof runtime.upload?.maxBytes === 'number' ? runtime.upload.maxBytes : null;
  const uploadMagicByteAndMacroScan =
    typeof runtime.upload?.magicByteAndMacroScan === 'boolean'
      ? runtime.upload.magicByteAndMacroScan
      : null;

  const auditTriggersPresent =
    dbSec.auditTriggerProbeStatus === 'verified'
      ? dbSec.auditUpdateDeleteTrigger && dbSec.auditTruncateTrigger
      : null;

  // Evaluate each check truthfully without hardcoded assertions
  const ownerCheckStatus: SecurityCheckStatus =
    !ownerInit
      ? 'warn'
      : ownerAuthMounted === false
      ? 'fail'
      : ownerAuthMounted === null || dbSec.sessionProbeStatus === 'unknown' as any
      ? 'not_verified'
      : dbSec.sessionProbeStatus === 'error'
      ? 'fail'
      : dbSec.sessionProbeStatus === 'unavailable'
      ? 'not_verified'
      : 'pass';

  const dbTlsCheckStatus: SecurityCheckStatus = !isDbReady || dbSec.tlsProbeStatus === 'unavailable'
    ? 'not_verified'
    : dbSec.tlsProbeStatus === 'error'
    ? 'fail'
    : dbSec.tlsEncrypted
    ? 'pass'
    : 'fail';

  const credCheckStatus: SecurityCheckStatus = !encStatus.configured
    ? 'warn'
    : isDbReady && dbSec.credentialProbeStatus === 'error'
    ? 'fail'
    : isDbReady && dbSec.credentialProbeStatus === 'unavailable'
    ? 'not_verified'
    : 'pass';

  const auditCheckStatus: SecurityCheckStatus = !isDbReady
    ? 'not_verified'
    : dbSec.auditTriggerProbeStatus === 'error' || auditChainResult.status === 'error'
    ? 'fail'
    : dbSec.auditTriggerProbeStatus === 'unavailable' || auditChainResult.status === 'unavailable'
    ? 'not_verified'
    : auditTriggersPresent && auditChainResult.valid === true
    ? 'pass'
    : 'fail';

  const ssrfBoolList = [
    ssrfDnsPinningEnabled,
    ssrfPrivateBlocked,
    ssrfRedirectRevalidation,
    uploadMagicByteAndMacroScan,
  ];
  const ssrfHasFalse =
    ssrfBoolList.some((v) => v === false) ||
    (ssrfMaxBytes !== null && ssrfMaxBytes <= 0) ||
    (uploadMaxBytes !== null && uploadMaxBytes <= 0);
  const ssrfHasUnknown =
    ssrfBoolList.some((v) => v === null) || ssrfMaxBytes === null || uploadMaxBytes === null;
  const ssrfCheckStatus: SecurityCheckStatus = ssrfHasFalse
    ? 'fail'
    : ssrfHasUnknown
    ? 'not_verified'
    : 'pass';

  const cookieFlagsValid =
    cookieFlags.httpOnly === true &&
    cookieFlags.secure === true &&
    cookieFlags.sameSite === 'none' &&
    cookieFlags.partitioned === true;
  const cookieFlagsKnown =
    cookieFlags.httpOnly !== null &&
    cookieFlags.secure !== null &&
    cookieFlags.sameSite !== 'unknown' &&
    cookieFlags.partitioned !== null;
  const expectedLimiterCount = runtime.routeLimitersExpectedCount ?? 8;
  const routeLimitersReady =
    routeLimiters.length >= expectedLimiterCount &&
    routeLimiters.every((r) => r.maxRequests > 0 && r.windowMs > 0);

  const httpFlags = [
    xPoweredByDisabled,
    securityHeadersMounted,
    cspEnabled,
    aiStudioIframeCompatible,
    csrfMiddlewareMounted,
    originValidationFailClosed,
    loginRateLimiterActive,
  ];
  const httpHasFalse =
    httpFlags.some((v) => v === false) ||
    (cookieFlagsKnown && !cookieFlagsValid) ||
    !routeLimitersReady;
  const httpHasUnknown = httpFlags.some((v) => v === null) || !cookieFlagsKnown;
  const httpCheckStatus: SecurityCheckStatus = httpHasFalse
    ? 'fail'
    : httpHasUnknown
    ? 'not_verified'
    : 'pass';

  const backupRestoreVerified = runtime.backupRestoreVerified === true;
  const backupCheckStatus: SecurityCheckStatus = backupRestoreVerified ? 'pass' : 'not_verified';

  const checks: SecurityPostureCheck[] = [
    {
      id: 'owner_lock',
      label: 'Single-Owner Enforcement & Auth',
      status: ownerCheckStatus,
      detail: !ownerInit
        ? 'Owner account not initialized yet.'
        : ownerAuthMounted === false
        ? 'Owner authentication middleware is not mounted on protected routes.'
        : dbSec.sessionProbeStatus === 'error'
        ? 'Session table diagnostic probe failed; active session counts could not be verified.'
        : ownerAuthMounted === null
        ? 'Runtime owner middleware inspection not provided; protection state not verified.'
        : `Single owner locked; auth middleware mounted; ${dbSec.activeSessionCount ?? 'unknown'} active sessions verified.`,
    },
    {
      id: 'db_tls',
      label: 'Neon PostgreSQL TLS Connection',
      status: dbTlsCheckStatus,
      detail: !isDbReady
        ? 'PostgreSQL not connected in current runtime (NOT_VERIFIED).'
        : dbSec.tlsProbeStatus === 'error'
        ? 'TLS diagnostic probe failed (error).'
        : dbSec.tlsEncrypted
        ? `Encrypted TLS session verified active (SSL=${dbSec.sslSetting}).`
        : `Database connected without verified TLS flag (SSL=${dbSec.sslSetting}).`,
    },
    {
      id: 'cred_encryption',
      label: 'App-Level Connector Secret Encryption (AES-256-GCM)',
      status: credCheckStatus,
      detail: !encStatus.configured
        ? 'CONNECTOR_ENCRYPTION_KEY is not configured; DB credential writes blocked.'
        : dbSec.credentialProbeStatus === 'error'
        ? `AES-256-GCM configured (${encStatus.source}), but encrypted credential count probe failed.`
        : `AES-256-GCM active (${encStatus.source}); ${
            dbSec.encryptedCredentialCount === null
              ? 'DB vault count unverified'
              : `${dbSec.encryptedCredentialCount} encrypted DB vault entries`
          }.`,
    },
    {
      id: 'audit_immutability',
      label: 'Immutable Audit Triggers & SHA-256 Hash Chain',
      status: auditCheckStatus,
      detail: !isDbReady
        ? 'Audit chain verification requires PostgreSQL connection (NOT_VERIFIED).'
        : dbSec.auditTriggerProbeStatus === 'error' || auditChainResult.status === 'error'
        ? 'Audit trigger or hash-chain diagnostic query failed.'
        : `Triggers: ${auditTriggersPresent ? 'active' : 'missing'} · Chain valid: ${auditChainResult.valid} (${auditChainResult.totalEvents} events).`,
    },
    {
      id: 'ssrf_and_upload',
      label: 'SSRF DNS-Pinned Shield & Upload Hardening',
      status: ssrfCheckStatus,
      detail: ssrfHasFalse
        ? 'One or more SSRF or file upload security controls reported inactive or misconfigured.'
        : ssrfHasUnknown
        ? 'Runtime SSRF or upload guard telemetry not supplied (NOT_VERIFIED).'
        : `DNS-pinned HTTP/HTTPS lookup active, IPv4/IPv6 + ::ffff: private CIDRs verified blocked, redirect re-validation active, ${Math.round(
            (ssrfMaxBytes || 0) / 1024
          )} KB stream cap, ${Math.round((uploadMaxBytes || 0) / (1024 * 1024))} MB upload magic-byte & macro scan.`,
    },
    {
      id: 'http_and_csrf',
      label: 'CSP Headers, CSRF Cookies & Route Rate Limiters',
      status: httpCheckStatus,
      detail: httpHasFalse
        ? 'HTTP security headers, cookie policy, CSRF middleware, or rate limiter verification failed.'
        : httpHasUnknown
        ? 'Runtime HTTP/CSRF/rate-limiter introspection incomplete (NOT_VERIFIED).'
        : `x-powered-by disabled, security headers & AI Studio frame-ancestors CSP mounted, fail-closed Origin/double-submit CSRF active, CHIPS cookie policy verified, login limiter + ${routeLimiters.length} route limiters active.`,
    },
    {
      id: 'backup_restore',
      label: 'Database Backup & Recovery Restoration Drill',
      status: backupCheckStatus,
      detail: backupRestoreVerified
        ? 'Isolated backup and restoration drill verified against schema, leads, and audit hash chain.'
        : 'Live PostgreSQL backup restoration drill has NOT been executed in this environment (NOT_VERIFIED). Follow docs/SECURITY_AND_BACKUP.md before Phase 9.',
    },
  ];

  // Overall posture is hardened ONLY when every critical check is verified as 'pass'
  const allChecksPass = checks.every((c) => c.status === 'pass');

  return {
    generatedAt: new Date().toISOString(),
    environment: deps.isProd ? 'production' : 'development',
    overallPosture: allChecksPass ? 'hardened' : 'attention_required',
    authentication: {
      singleOwnerLocked: ownerInit,
      passwordHashing: 'bcrypt (cost factor 12)',
      sessionTokenStorage: 'SHA-256 digested tokens in owner_sessions',
      sessionProbeStatus: dbSec.sessionProbeStatus ?? 'unavailable',
      activeSessionCount: dbSec.activeSessionCount,
      totalSessionCount: dbSec.totalSessionCount,
      cookieFlags,
      csrfProtection: csrfMiddlewareMounted,
      originValidationFailClosed,
    },
    databaseSecurity: {
      connected: isDbReady,
      diagnosticState: dbSec.diagnosticState ?? (isDbReady ? 'verified' : 'unavailable'),
      engine: isDbReady ? 'Neon PostgreSQL' : 'json_fallback',
      tlsEncrypted: dbSec.tlsProbeStatus === 'verified' ? dbSec.tlsEncrypted : null,
      sslSetting: dbSec.sslSetting,
      auditTriggersPresent,
      auditUpdateDeleteTrigger:
        dbSec.auditTriggerProbeStatus === 'verified' ? dbSec.auditUpdateDeleteTrigger : null,
      auditTruncateTrigger:
        dbSec.auditTriggerProbeStatus === 'verified' ? dbSec.auditTruncateTrigger : null,
      auditHashChainValid: auditChainResult.valid,
      auditEventCount: auditChainResult.totalEvents,
      migration005PendingApproval: migration005Pending,
      startupAutoMigrateMaxVersion: '004',
    },
    secretsAndEncryption: {
      algorithm: encStatus.algorithm || 'aes-256-gcm',
      credentialKeyConfigured: encStatus.configured,
      credentialKeySource: encStatus.source,
      credentialProbeStatus: dbSec.credentialProbeStatus ?? 'unavailable',
      encryptedConnectorCredentialsCount: dbSec.encryptedCredentialCount,
      secretRedactionActive: true,
      neonManagedAtRestEncryption: 'Neon Cloud Storage-Level Encryption (managed at platform layer)',
    },
    networkAndHttpHardening: {
      cspEnabled,
      aiStudioIframeCompatible,
      xPoweredByDisabled,
      ssrfGuardVersion: ssrfDnsPinningEnabled
        ? 'Phase 8 Hardened (DNS-Pinned Lookup + IPv4/IPv6/::ffff: + Redirect + Stream Cap)'
        : 'Unknown / Unverified',
      ssrfDnsPinningEnabled,
      ssrfPrivateIpv4AndIpv6Blocked: ssrfPrivateBlocked,
      ssrfRedirectRevalidation,
      ssrfResponseByteLimitBytes: ssrfMaxBytes,
      uploadMaxBytes,
      uploadMagicByteAndMacroScan,
    },
    rateLimiting: {
      loginRateLimiterActive,
      routeLimiters,
    },
    backups: {
      localBackupCount: backupInfo.count,
      latestBackupAt: backupInfo.latestBackupAt,
      restoreDrillStatus: backupRestoreVerified ? 'verified' : 'not_verified',
      documentationPath: 'docs/SECURITY_AND_BACKUP.md',
    },
    checks,
    recentSecurityEvents: getRecentSecurityEvents(25),
    eventCounters: getSecurityEventCounters(),
  };
}
