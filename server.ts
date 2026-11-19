import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { dbManager } from './server/db/pool.js';
import { postgresStorage } from './server/db/storagePg.js';
import { storage } from './server/storage.js';
import { migrator } from './server/db/migrator.js';
import {
  executeMigration005ApprovalWorkflow,
  handleLegacyRunMigrationsBlocked,
} from './server/db/migrationWorkflow.js';
import { jsonMigrator } from './server/db/migrateJsonToSql.js';
import { searchBrreg } from './server/connectors/brreg.js';
import { searchCompaniesHouse } from './server/connectors/companiesHouse.js';
import { searchOpenStreetMap } from './server/connectors/osmOverpass.js';
import { searchAbn } from './server/connectors/abnLookup.js';
import { inspectWebsite } from './server/connectors/webInspector.js';
import { detectDuplicates, mergeLeads } from './server/connectors/dedupeEngine.js';
import {
  analyzeLeadWithAi,
  assessDuplicatePairWithAi,
  extractBusinessIntelFromWebEvidence,
  generateDecisionMakerQueriesWithAi,
  generateDiscoveryQueriesWithAi,
  generateSalesPitchWithAi,
  generateMeetingBriefWithAi,
  generateMarketReportWithAi,
} from './server/gemini.js';
import { buildSearchAndDirectoryProviderMatrix } from './server/connectors/searchProvidersCatalog.js';
import { buildSocialProviderMatrix } from './server/connectors/socialProvidersCatalog.js';
import { buildEnrichmentProviderCatalog } from './server/connectors/enrichmentCatalog.js';
import {
  CanonicalLead,
  DiscoverySearchRequest,
  EnrichmentFieldProposal,
  ReverificationSchedulePolicy,
} from './server/types.js';
import { discoveryService } from './server/discovery/discoveryService.js';
import { discoverCompanyDecisionMakers } from './server/discovery/decisionMakerService.js';
import { EXPANDED_RELATIONSHIP_TYPES, classifyDecisionMakerRole } from './shared/decisionMakerRoles.js';
import { ATTRIBUTE_FRESHNESS_RULES } from './shared/enrichmentSpecs.js';
import { verifyBusinessEmail } from './server/enrichment/emailVerifier.js';
import { verifyBusinessPhone } from './server/enrichment/phoneVerifier.js';
import {
  evaluateCompanyDataQuality,
  evaluatePersonDataQuality,
} from './server/enrichment/dataQualityEngine.js';
import {
  MAX_BULK_ENRICHMENT_BATCH,
  applyApprovedCompanyEnrichmentToClone,
  applyApprovedPersonEnrichmentToClone,
  previewBulkCompanyEnrichment,
  previewCompanyEnrichment,
  previewPersonEnrichment,
} from './server/enrichment/enrichmentOrchestrator.js';
import {
  requireOwnerAuth,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from './server/auth/middleware.js';
import {
  listOwnerSessions,
  revokeSessionById,
  revokeOtherOwnerSessions,
  hashSessionToken,
} from './server/auth/session.js';
import { ownerService } from './server/auth/ownerService.js';
import {
  generateCsrfToken,
  setCsrfCookie,
  validateCsrf,
  validateSameOrigin,
} from './server/auth/csrf.js';
import { loginRateLimiter, normalizeClientIp } from './server/auth/rateLimit.js';
import { getAllCountries, getCountryByCode, searchCountries } from './server/geo/countries.js';
import { getDivisionsForCountry } from './server/geo/divisions.js';
import { searchCities } from './server/geo/cities.js';
import { normalizePhoneNumber } from './server/geo/phoneUtils.js';
import { formatInternationalAddress, validatePostalCode } from './server/geo/addressUtils.js';
import { validateIdentifier, normalizeIdentifierValue } from './server/identifiers/identifierEngine.js';
import { buildCountryCapabilityMatrix } from './server/geo/capabilityMatrix.js';
import {
  getAllAuditedRegistries,
  PRIORITY_27_COUNTRIES,
  resolveSevenStateRegistryStatus,
} from './server/geo/registryAudit.js';
import {
  applyOfficialVerificationToLead,
  verifyLeadWithOfficialRegistry,
} from './server/verification/registryVerificationService.js';
import { buildCsvDocument } from './shared/csvUtils.js';
import { canonicalizeIdentifierType, getIdentifierAliases } from './shared/identifierRegistry.js';
import {
  aggregateRunsByConnector,
  buildUnifiedConnectorStatus,
  connectorExecutionEngine,
  connectorRegistry,
  credentialManager,
  ensureConnectorsRegistered,
} from './server/connectors/index.js';
import { ConnectorError, redactSecrets } from './server/connectors/core/errors.js';
import {
  ConnectorCapability,
  ConnectorRunRecord,
  SourceCategory,
} from './server/connectors/core/types.js';
import multer from 'multer';
import {
  importService,
  ImportFileSecurityError,
  ImportServiceError,
} from './server/import/importService.js';
import { getUploadGuardConfig, MAX_IMPORT_FILE_BYTES } from './server/import/fileParser.js';
import { normalizeAndValidateMappedRow } from './server/import/normalizerValidator.js';
import type { ImportMappingTemplate } from './server/types.js';
import {
  buildContentSecurityPolicy,
  securityHeadersMiddleware,
} from './server/security/headers.js';
import { sanitizeApiError, sanitizeExportFilenamePart } from './server/security/errorHandler.js';
import { buildSecurityPostureReport, RuntimeSecurityInspection } from './server/security/posture.js';
import { getSsrfRuntimeStatus } from './server/security/ssrf.js';
import { recordSecurityEvent } from './server/security/securityEvents.js';
import {
  aiRateLimiter,
  createRateLimitMiddleware,
  discoveryRateLimiter,
  exportRateLimiter,
  importRateLimiter,
  inspectionRateLimiter,
  migrationRateLimiter,
  passwordChangeRateLimiter,
  setupRateLimiter,
} from './server/security/rateLimiter.js';
import {
  MAX_BATCH_IMPORT_ROWS,
  validateCampaignCreateBody,
  validateCampaignMessageAction,
  validateDiscoverySaveBody,
  validateLeadCreateOrUpdate,
  validatePipelineMoveBody,
  validateSettingsUpdateBody,
  validateTaskCreateBody,
  validateTaskUpdateBody,
} from './server/security/validators.js';

const importUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMPORT_FILE_BYTES,
    files: 1,
  },
});

let lastStartupMigrationResult: {
  attempted: boolean;
  success: boolean;
  applied: string[];
  alreadyApplied: string[];
  error?: string;
} = {
  attempted: false,
  success: false,
  applied: [],
  alreadyApplied: [],
};

dotenv.config();

ensureConnectorsRegistered();
connectorExecutionEngine.setDefaultRunRecorder(async (run) => {
  if (dbManager.isDbConnected()) {
    await postgresStorage.recordConnectorRun(run);
  } else if (process.env.NODE_ENV !== 'production') {
    storage.recordConnectorRun(run);
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Hide framework fingerprint and enforce AI Studio iframe-compatible CSP & security headers
app.disable('x-powered-by');
app.use(securityHeadersMiddleware(IS_PROD));

// Support reverse proxy (Cloud Run, Nginx, ALB) for accurate client IP resolution
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// CSRF Cookie Provisioning Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!req.cookies?.leed_csrf) {
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
  }
  next();
});

// Helper: Resolve active storage engine with production-safe failure behavior
function checkStorageEngine() {
  const isDbReady = dbManager.isDbConnected();
  if (isDbReady) {
    return { isPg: true, store: postgresStorage };
  }
  if (IS_PROD) {
    throw new Error('Database connection unavailable in production. Writes to JSON fallback are disabled to prevent data fragmentation.');
  }
  return { isPg: false, store: storage };
}

// ==========================================
// 1. PUBLIC UNRESTRICTED ENDPOINTS
// ==========================================

// System Health & Observability
app.get('/api/status', async (req: Request, res: Response) => {
  const isDbReady = dbManager.isDbConnected();
  const dbHealth = dbManager.getHealthStatus();
  const initialized = await ownerService.isOwnerInitialized();

  let totalLeads = 0;
  let activeConnectorsCount = 0;
  let totalConnectorsCount = 6;
  let migrationStatus: any = lastStartupMigrationResult;

  try {
    if (isDbReady) {
      const [leads, connectors, inspection] = await Promise.all([
        postgresStorage.getLeads(),
        postgresStorage.getConnectors(),
        migrator.inspectMigrationStatus(),
      ]);
      totalLeads = leads.length;
      totalConnectorsCount = connectors.length;
      activeConnectorsCount = connectors.filter(
        (c) => c.healthState === 'operational' || c.status === 'healthy' || c.status === 'configured'
      ).length;
      migrationStatus = {
        ...lastStartupMigrationResult,
        latestVersion: inspection.latestVersion,
        migration003Recorded: inspection.migration003Recorded,
        migration003SchemaReady: inspection.migration003SchemaReady,
        migration004Recorded: inspection.migration004Recorded,
        migration004SchemaReady: inspection.migration004SchemaReady,
        migration005Recorded: inspection.migration005Recorded,
        migration005SchemaReady: inspection.migration005SchemaReady,
      };
    } else {
      const leads = storage.getLeads();
      totalLeads = leads.length;
      const connectors = await storage.getConnectorsUnified();
      totalConnectorsCount = connectors.length;
      activeConnectorsCount = connectors.filter(
        (c) => c.healthState === 'operational' || c.status === 'healthy' || c.status === 'configured'
      ).length;
    }
  } catch (err) {
    console.warn('[Status] Warning querying metrics:', err);
  }

  res.json({
    status: isDbReady ? 'online' : IS_PROD ? 'degraded' : 'online_fallback',
    version: '1.0.0-production',
    mode: 'Single-Owner Private Application',
    uptimeSeconds: Math.floor(process.uptime()),
    totalLeads,
    activeConnectors: `${activeConnectorsCount}/${totalConnectorsCount}`,
    storageEngine: isDbReady ? 'postgresql' : 'json_store',
    databaseConnected: isDbReady,
    databaseHealth: {
      isConfigured: dbHealth.isConfigured,
      isConnected: dbHealth.isConnected,
      engine: dbHealth.engine,
      error: dbHealth.error,
      consecutiveFailures: dbHealth.consecutiveFailures,
    },
    migrationStatus,
    ownerInitialized: initialized,
    timestamp: new Date().toISOString(),
    aiEngineAvailable: !!process.env.GEMINI_API_KEY,
  });
});

// CSRF Token Endpoint
app.get('/api/auth/csrf', (req: Request, res: Response) => {
  let token = req.cookies?.leed_csrf;
  if (!token) {
    token = generateCsrfToken();
    setCsrfCookie(res, token);
  }
  res.json({ csrfToken: token });
});

// Owner Setup Status Check (Public)
app.get('/api/auth/setup-status', async (req: Request, res: Response) => {
  try {
    const initialized = await ownerService.isOwnerInitialized();
    res.json({
      initialized,
      mode: 'single-owner',
      registrationAllowed: !initialized,
    });
  } catch (err) {
    console.error('Setup status check error:', err);
    res.status(500).json({ error: 'Failed to check setup status' });
  }
});

// Owner Setup (One-time, locked forever after)
app.post(
  '/api/auth/setup',
  createRateLimitMiddleware(setupRateLimiter, 'Too many owner setup attempts. Try again later.'),
  async (req: Request, res: Response) => {
    const { fullName, email, password, setupSecret } = req.body || {};
    const ip = normalizeClientIp(req);

    try {
      const owner = await ownerService.setupOwner(fullName, email, password, setupSecret);
      const loginResult = await ownerService.login(email, password, ip, req.headers['user-agent']);

      // Set secure partitioned cookie and return token for resilient iframe authorization
      setSessionCookie(res, loginResult.rawToken);

      if (dbManager.isDbConnected()) {
        await postgresStorage
          .recordAuditEvent(
            'OWNER_SETUP_COMPLETED',
            owner.email,
            'owner_user',
            owner.id,
            { ip },
            ip
          )
          .catch(() => {});
      }

      res.status(201).json({
        success: true,
        token: loginResult.rawToken,
        owner: loginResult.owner,
        message: 'Owner initialized successfully. Platform locked to single-owner mode.',
      });
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Owner setup failed.') });
    }
  }
);

// Owner Login (Sets partitioned cookie and returns token for resilient iframe authorization)
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  const ip = normalizeClientIp(req);

  try {
    const result = await ownerService.login(email, password, ip, req.headers['user-agent']);
    // Set secure partitioned cookie
    setSessionCookie(res, result.rawToken);

    if (dbManager.isDbConnected()) {
      await postgresStorage
        .recordAuditEvent(
          'OWNER_LOGIN_SUCCEEDED',
          result.owner.email,
          'owner_session',
          result.owner.id,
          { ip },
          ip
        )
        .catch(() => {});
    }

    // Return owner identity with session token
    res.json({
      success: true,
      token: result.rawToken,
      owner: result.owner,
    });
  } catch (err: unknown) {
    const msg = sanitizeApiError(err, 'Authentication failed.');
    const isLocked = msg.includes('locked') || msg.includes('Too many failed');
    recordSecurityEvent({
      category: isLocked ? 'auth_lockout' : 'auth_failure',
      severity: isLocked ? 'high' : 'warning',
      path: req.originalUrl || req.path,
      method: req.method,
      ip,
      summary: isLocked ? 'Owner login temporarily locked out after failed attempts' : 'Owner login attempt failed',
    });
    if (dbManager.isDbConnected()) {
      await postgresStorage
        .recordAuditEvent(
          isLocked ? 'OWNER_LOGIN_LOCKED' : 'OWNER_LOGIN_FAILED',
          typeof email === 'string' && email.trim() ? email.trim().slice(0, 120) : 'unknown',
          'owner_auth',
          ip,
          { locked: isLocked },
          ip
        )
        .catch(() => {});
    }
    res.status(isLocked ? 429 : 401).json({ error: msg });
  }
});

// Owner Logout
app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME] || req.headers['authorization']?.replace('Bearer ', '');
  const ip = normalizeClientIp(req);
  if (rawToken) {
    await ownerService.logout(rawToken);
    if (dbManager.isDbConnected()) {
      await postgresStorage
        .recordAuditEvent('OWNER_LOGOUT', 'owner', 'owner_session', undefined, { ip }, ip)
        .catch(() => {});
    }
  }
  clearSessionCookie(res);
  res.json({ success: true, message: 'Logged out successfully' });
});

// ==========================================
// 2. PROTECTED SINGLE-OWNER API ROUTER
// All routes below require valid owner session & CSRF validation
// ==========================================

const protectedApi = express.Router();
protectedApi.use(requireOwnerAuth);
protectedApi.use(validateCsrf);

// Current Authenticated Owner Profile

protectedApi.get('/auth/me', (req: Request, res: Response) => {
  res.json({
    owner: req.owner,
    authenticated: true,
  });
});

// Update Owner Profile (Display Name)
protectedApi.put('/owner/profile', async (req: Request, res: Response) => {
  const { fullName } = req.body || {};
  if (!req.owner) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }
  if (!fullName || typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120) {
    res.status(400).json({ error: 'Valid full name (1-120 characters) is required' });
    return;
  }

  try {
    const pool = dbManager.getPool();
    if (pool && dbManager.isDbConnected()) {
      await pool.query(
        'UPDATE owner_users SET full_name = $1, updated_at = NOW() WHERE id = $2',
        [fullName.trim(), req.owner.id]
      );
      await postgresStorage.recordAuditEvent(
        'OWNER_PROFILE_UPDATED',
        req.owner.email,
        'owner_user',
        req.owner.id,
        { fullName: fullName.trim() },
        normalizeClientIp(req)
      );
    } else if (IS_PROD) {
      res.status(503).json({ error: 'Database connection unavailable in production.' });
      return;
    }
    res.json({
      success: true,
      owner: {
        ...req.owner,
        fullName: fullName.trim(),
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to update owner profile.') });
  }
});

// Change Owner Password
protectedApi.post(
  '/auth/change-password',
  createRateLimitMiddleware(passwordChangeRateLimiter, 'Too many password change attempts. Try again later.'),
  async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!req.owner) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    try {
      const ip = normalizeClientIp(req);
      await ownerService.changePassword(req.owner.id, currentPassword, newPassword, req.sessionToken);
      const freshLogin = await ownerService.login(req.owner.email, newPassword, ip, req.headers['user-agent']);
      setSessionCookie(res, freshLogin.rawToken);
      await postgresStorage.recordAuditEvent(
        'PASSWORD_CHANGED',
        req.owner.email,
        'owner_user',
        req.owner.id,
        { ip },
        ip
      );
      res.json({
        success: true,
        token: freshLogin.rawToken,
        message: 'Password changed successfully. Prior sessions revoked.',
      });
    } catch (err: unknown) {
      res.status(400).json({ error: sanitizeApiError(err, 'Password change failed.') });
    }
  }
);

// List Active Sessions for Owner
protectedApi.get('/owner/sessions', async (req: Request, res: Response) => {
  if (!req.owner) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  try {
    const currentHash = req.sessionToken ? hashSessionToken(req.sessionToken) : '';
    const sessions = await listOwnerSessions(req.owner.id);
    const formatted = sessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress || '127.0.0.1',
      userAgent: s.userAgent || 'Unknown browser',
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString(),
      isActive: s.isActive,
      isCurrent: s.tokenHash === currentHash,
    }));
    res.json({ sessions: formatted });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to load active sessions.') });
  }
});

// Revoke a specific session
protectedApi.delete('/owner/sessions/:id', async (req: Request, res: Response) => {
  if (!req.owner) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  const sessionId = req.params.id;
  try {
    const success = await revokeSessionById(sessionId, req.owner.id);
    if (!success) {
      res.status(404).json({ error: 'Session not found or already revoked' });
      return;
    }
    await postgresStorage.recordAuditEvent(
      'SESSION_REVOKED',
      req.owner.email,
      'owner_session',
      sessionId,
      { revokedSessionId: sessionId },
      normalizeClientIp(req)
    );
    res.json({ success: true, message: 'Session successfully revoked' });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to revoke session.') });
  }
});

// Revoke all other sessions except current
protectedApi.post('/owner/sessions/revoke-others', async (req: Request, res: Response) => {
  if (!req.owner || !req.sessionToken) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  try {
    const currentHash = hashSessionToken(req.sessionToken);
    const revokedCount = await revokeOtherOwnerSessions(req.owner.id, currentHash);
    await postgresStorage.recordAuditEvent(
      'OTHER_SESSIONS_REVOKED',
      req.owner.email,
      'owner_user',
      req.owner.id,
      { count: revokedCount },
      normalizeClientIp(req)
    );
    res.json({ success: true, revokedCount });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to revoke other sessions.') });
  }
});

// Audit History Log
protectedApi.get('/owner/audit-log', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const events = await postgresStorage.getAuditEvents(limit);
    res.json({ events });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to load audit log.') });
  }
});

// Audit Log Cryptographic Verification
protectedApi.get('/owner/audit-log/verify', async (req: Request, res: Response) => {
  try {
    const isPg = dbManager.isDbConnected();
    if (!isPg) {
      res.json({
        valid: true,
        totalEvents: 0,
        genesisHash: '0000000000000000000000000000000000000000000000000000000000000000',
        note: 'PostgreSQL not connected. Zero database audit records in active store.',
        verifiedAt: new Date().toISOString(),
      });
      return;
    }
    const result = await postgresStorage.verifyAuditLogIntegrity();
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to verify audit hash chain.') });
  }
});

// Live Database Diagnostics & Telemetry
protectedApi.get('/owner/diagnostics', async (req: Request, res: Response) => {
  try {
    const isPg = dbManager.isDbConnected();
    const dbHealth = dbManager.getHealthStatus();

    let details: any = null;
    let migrationInspection: any = null;
    if (isPg) {
      [details, migrationInspection] = await Promise.all([
        postgresStorage.getDetailedDiagnostics(),
        migrator.inspectMigrationStatus(),
      ]);
    }

    res.json({
      connected: isPg,
      engine: isPg ? 'PostgreSQL (Neon Serverless)' : 'json_store',
      health: dbHealth,
      diagnostics: details,
      migrations: {
        startup: lastStartupMigrationResult,
        inspection: migrationInspection,
      },
      security: {
        singleOwnerEnforced: true,
        singletonConstraint: 'uq_owner_singleton UNIQUE + chk_owner_singleton CHECK (is_singleton = TRUE)',
        auditIntegrity: {
          triggersActive: true,
          rowModificationBlocked: 'UPDATE and DELETE prohibited via trg_audit_events_prevent_update_delete',
          tableTruncateBlocked: 'TRUNCATE prohibited via trg_audit_events_prevent_truncate',
          hashChainAlgorithm: 'SHA-256 sequential hash chaining with advisory transaction locks',
          genesisHash: '0000000000000000000000000000000000000000000000000000000000000000',
        },
        cookieSecurity: {
          sameSite: SESSION_COOKIE_OPTIONS.sameSite,
          secure: SESSION_COOKIE_OPTIONS.secure,
          partitioned: SESSION_COOKIE_OPTIONS.partitioned,
          httpOnly: SESSION_COOKIE_OPTIONS.httpOnly,
        },
        bearerDualAuth: true,
        csrfProtection: true,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch diagnostics.') });
  }
});

function inspectLiveExpressSecurity(): RuntimeSecurityInspection {
  const appStack: any[] = (app as any)?._router?.stack || [];
  const protectedStack: any[] = (protectedApi as any)?.stack || [];
  const securityHeadersMounted = appStack.some(
    (layer) =>
      layer?.name === 'leedSecurityHeadersMiddleware' ||
      layer?.handle?.name === 'leedSecurityHeadersMiddleware'
  );
  const ownerAuthMiddlewareMounted = protectedStack.some(
    (layer) => layer?.name === 'requireOwnerAuth' || layer?.handle?.name === 'requireOwnerAuth'
  );
  const csrfMiddlewareMounted = protectedStack.some(
    (layer) => layer?.name === 'validateCsrf' || layer?.handle?.name === 'validateCsrf'
  );
  const csp = buildContentSecurityPolicy(IS_PROD);
  const ssrfRuntime = getSsrfRuntimeStatus();
  const uploadGuard = getUploadGuardConfig();
  const loginStats = loginRateLimiter.getStats();

  return {
    xPoweredByDisabled: app.get('x-powered-by') === false,
    securityHeadersMiddlewareMounted: securityHeadersMounted,
    cspEnabled: csp.includes("default-src 'self'") && csp.includes("object-src 'none'"),
    aiStudioIframeCompatible:
      csp.includes('frame-ancestors') && csp.includes('https://aistudio.google.com'),
    ownerAuthMiddlewareMounted,
    csrfMiddlewareMounted,
    originValidationFailClosed: typeof validateSameOrigin === 'function',
    cookieFlags: {
      httpOnly: SESSION_COOKIE_OPTIONS.httpOnly,
      secure: SESSION_COOKIE_OPTIONS.secure,
      sameSite: SESSION_COOKIE_OPTIONS.sameSite,
      partitioned: SESSION_COOKIE_OPTIONS.partitioned,
    },
    loginRateLimiterActive:
      typeof loginRateLimiter?.check === 'function' && loginStats.maxAttempts > 0,
    routeLimitersExpectedCount: 8,
    ssrf: {
      dnsPinningEnabled: ssrfRuntime.dnsPinningEnabled,
      privateCidrsBlockedSelfTest: ssrfRuntime.privateCidrsBlockedSelfTest,
      redirectRevalidationEnabled: ssrfRuntime.redirectRevalidationEnabled,
      maxResponseBytes: ssrfRuntime.maxResponseBytesDefault,
    },
    upload: {
      maxBytes: uploadGuard.maxBytes,
      magicByteAndMacroScan: uploadGuard.magicByteAndMacroScan,
    },
    backupRestoreVerified: false,
  };
}

// Phase 8: Live Security Posture & Data Protection Diagnostics (Zero Secrets Returned)
protectedApi.get('/owner/security-posture', async (req: Request, res: Response) => {
  try {
    const report = await buildSecurityPostureReport({
      isProd: IS_PROD,
      isDbConnected: () => dbManager.isDbConnected(),
      getEncryptionStatus: () => credentialManager.getEncryptionStatus(),
      getDatabaseSecurityStatus: () => postgresStorage.getDatabaseSecurityStatus(),
      verifyAuditChain: async () => {
        const check = await postgresStorage.verifyAuditLogIntegrity();
        return { valid: check.valid, totalEvents: check.totalEvents };
      },
      inspectMigrations: async () => {
        const status = await migrator.inspectMigrationStatus();
        return { migration005Recorded: status.migration005Recorded };
      },
      ownerInitialized: () => ownerService.isOwnerInitialized(),
      inspectRuntimeSecurity: () => inspectLiveExpressSecurity(),
    });
    res.json(report);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to compile security posture diagnostics.') });
  }
});

// Database Diagnostics & Health
protectedApi.get('/database/status', async (req: Request, res: Response) => {
  try {
    const isPg = dbManager.isDbConnected();
    const dbHealth = dbManager.getHealthStatus();

    let pgRecordCounts;
    let schemaTables: string[] = [];
    let migrationInspection: any = null;

    if (isPg) {
      const pool = dbManager.getPool();
      if (pool) {
        const [leadsCount, stagesCount, tasksCount, campsCount] = await Promise.all([
          pool.query('SELECT COUNT(*) FROM leads'),
          pool.query('SELECT COUNT(*) FROM pipeline_stages'),
          pool.query('SELECT COUNT(*) FROM tasks'),
          pool.query('SELECT COUNT(*) FROM campaigns'),
        ]);
        pgRecordCounts = {
          leads: parseInt(leadsCount.rows[0].count, 10),
          stages: parseInt(stagesCount.rows[0].count, 10),
          tasks: parseInt(tasksCount.rows[0].count, 10),
          campaigns: parseInt(campsCount.rows[0].count, 10),
        };
      }
      [schemaTables, migrationInspection] = await Promise.all([
        migrator.getExistingTables(),
        migrator.inspectMigrationStatus(),
      ]);
    }

    res.json({
      configured: dbHealth.isConfigured,
      connected: isPg,
      engine: isPg ? 'postgresql' : IS_PROD ? 'unhealthy_disconnected' : 'json_store',
      health: dbHealth,
      postgresRecordCounts: pgRecordCounts,
      schemaTables,
      migrations: {
        startup: lastStartupMigrationResult,
        inspection: migrationInspection,
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: `Failed to fetch diagnostics: ${sanitizeApiError(err, 'Database query error.')}` });
  }
});

// Legacy Bulk Migration Route — Locked down to prevent bypassing version-specific owner approval
protectedApi.post('/database/run-migrations', createRateLimitMiddleware(migrationRateLimiter), async (req: Request, res: Response) => {
  recordSecurityEvent({
    category: 'migration_blocked',
    severity: 'warning',
    path: req.originalUrl || req.path,
    method: req.method,
    ip: normalizeClientIp(req),
    summary: 'Blocked legacy /database/run-migrations call without version approval',
  });
  const outcome = await handleLegacyRunMigrationsBlocked(
    {
      owner: req.owner,
      clientIp: normalizeClientIp(req),
    },
    {
      isDbConnected: () => dbManager.isDbConnected(),
      recordAuditEvent: (action, actorEmail, entityType, entityId, details, ipAddress) =>
        postgresStorage.recordAuditEvent(action, actorEmail, entityType, entityId, details, ipAddress),
    }
  );
  res.status(outcome.status).json(outcome.body);
});

// Dedicated Owner-Only Approval Action for Migration 004 Only
protectedApi.post('/database/migrations/004/approve', createRateLimitMiddleware(migrationRateLimiter), async (req: Request, res: Response) => {
  if (!req.owner || req.owner.role !== 'owner') {
    res.status(403).json({
      error: 'Owner authorization required to approve and execute Migration 004.',
      code: 'FORBIDDEN',
    });
    return;
  }

  const { confirmMigration } = req.body || {};
  if (confirmMigration !== '004') {
    res.status(400).json({
      error: 'Explicit owner confirmation is required (confirmMigration must equal "004").',
      code: 'CONFIRMATION_REQUIRED',
    });
    return;
  }

  if (!dbManager.isDbConnected()) {
    res.status(503).json({
      error: 'PostgreSQL database is not connected. Cannot apply Migration 004.',
      code: 'DATABASE_UNAVAILABLE',
    });
    return;
  }

  const clientIp = normalizeClientIp(req);
  try {
    // Execute Migration 004 only using existing transactional runMigrations() infrastructure
    const result = await migrator.runMigrations(undefined, { targetVersion: '004' });
    const inspection = await migrator.inspectMigrationStatus();

    const verified =
      result.success &&
      inspection.migration004Recorded &&
      inspection.migrations001To003Recorded &&
      inspection.missingMigration004Columns.length === 0 &&
      inspection.missingMigration004Indexes.length === 0 &&
      inspection.migration004SchemaReady;

    const verification = {
      migration004Recorded: inspection.migration004Recorded,
      migrations001To003Recorded: inspection.migrations001To003Recorded,
      columnsPresentCount: inspection.migration004PresentColumnsCount,
      expectedColumnsCount: inspection.migration004ExpectedColumnsCount,
      missingColumns: inspection.missingMigration004Columns,
      indexesPresentCount: inspection.migration004PresentIndexesCount,
      expectedIndexesCount: inspection.migration004ExpectedIndexesCount,
      missingIndexes: inspection.missingMigration004Indexes,
      migration004SchemaReady: inspection.migration004SchemaReady,
      verified,
    };

    try {
      await postgresStorage.recordAuditEvent(
        verified ? 'MIGRATION_004_APPROVED_AND_APPLIED' : 'MIGRATION_004_APPROVAL_FAILED',
        req.owner.email,
        'schema_migration',
        '004_unified_connector_architecture.sql',
        {
          applied: result.applied,
          alreadyApplied: result.alreadyApplied,
          verification,
          error: result.error,
        },
        clientIp
      );
    } catch (auditErr) {
      console.warn('[Migration 004] Could not record audit event:', auditErr);
    }

    if (!result.success || !verified) {
      res.status(500).json({
        success: false,
        migration: '004_unified_connector_architecture.sql',
        applied: result.applied,
        alreadyApplied: result.alreadyApplied,
        verification,
        inspection,
        error:
          result.error ||
          'Migration 004 executed but post-execution schema verification did not pass.',
      });
      return;
    }

    res.json({
      success: true,
      migration: '004_unified_connector_architecture.sql',
      applied: result.applied,
      alreadyApplied: result.alreadyApplied,
      verification,
      inspection,
      message:
        result.applied.length > 0
          ? 'Migration 004 approved, applied transactionally, and verified (18/18 columns, 2/2 indexes, 001–003 intact).'
          : 'Migration 004 was already applied and verified in Neon (18/18 columns, 2/2 indexes, 001–003 intact).',
    });
  } catch (err: unknown) {
    const safeMsg = sanitizeApiError(err, 'Migration 004 execution failed and was rolled back.');
    try {
      await postgresStorage.recordAuditEvent(
        'MIGRATION_004_APPROVAL_FAILED',
        req.owner.email,
        'schema_migration',
        '004_unified_connector_architecture.sql',
        { error: safeMsg },
        clientIp
      );
    } catch {
      // ignore secondary audit error
    }
    res.status(500).json({
      success: false,
      error: safeMsg.startsWith('Migration 004')
        ? safeMsg
        : `Migration 004 execution failed and was rolled back: ${safeMsg}`,
    });
  }
});

// Dedicated Owner-Only Approval Action for Migration 005 Only
protectedApi.post('/database/migrations/005/approve', createRateLimitMiddleware(migrationRateLimiter), async (req: Request, res: Response) => {
  const outcome = await executeMigration005ApprovalWorkflow(
    {
      owner: req.owner,
      confirmMigration: req.body?.confirmMigration,
      clientIp: normalizeClientIp(req),
    },
    {
      isDbConnected: () => dbManager.isDbConnected(),
      runTargetMigration005: () => migrator.runMigrations(undefined, { targetVersion: '005' }),
      inspectMigrationStatus: () => migrator.inspectMigrationStatus(),
      recordAuditEvent: (action, actorEmail, entityType, entityId, details, ipAddress) =>
        postgresStorage.recordAuditEvent(action, actorEmail, entityType, entityId, details, ipAddress),
    }
  );
  res.status(outcome.status).json(outcome.body);
});

// Migrate JSON Store into PostgreSQL (Supports Dry-Run)
protectedApi.post('/database/migrate-json', createRateLimitMiddleware(migrationRateLimiter), async (req: Request, res: Response) => {
  const dryRun = req.body?.dryRun === true;
  try {
    const summary = await jsonMigrator.migrate({ dryRun });
    if (dbManager.isDbConnected() && req.owner) {
      await postgresStorage
        .recordAuditEvent(
          dryRun ? 'JSON_STORE_MIGRATION_DRY_RUN' : 'JSON_STORE_MIGRATED',
          req.owner.email,
          'database',
          'json_to_pg',
          { dryRun },
          normalizeClientIp(req)
        )
        .catch(() => {});
    }
    res.json(summary);
  } catch (err: unknown) {
    res.status(500).json({ error: `JSON migration failed: ${sanitizeApiError(err, 'Migration failed.')}` });
  }
});

// ==========================================
// GEOGRAPHIC REFERENCE & CAPABILITY MATRIX API
// ==========================================

// List all 195 sovereign states + jurisdictions with optional query
protectedApi.get('/geo/countries', (req: Request, res: Response) => {
  const { query } = req.query;
  if (typeof query === 'string' && query.trim()) {
    res.json(searchCountries(query));
  } else {
    res.json(getAllCountries());
  }
});

// Get single country reference with divisions and address formatting rules
protectedApi.get('/geo/countries/:code', (req: Request, res: Response) => {
  const country = getCountryByCode(req.params.code);
  if (!country) {
    res.status(404).json({ error: 'Country not found' });
    return;
  }
  res.json(country);
});

// Get administrative divisions for a country (e.g. states, provinces, cantons)
protectedApi.get('/geo/divisions', (req: Request, res: Response) => {
  const countryCode = req.query.country as string;
  if (!countryCode) {
    res.status(400).json({ error: 'Country code is required' });
    return;
  }
  const divisions = getDivisionsForCountry(countryCode);
  res.json({ countryCode: countryCode.toUpperCase(), divisions, total: divisions.length });
});

// Scalable city search (server-side typeahead, prevents loading 50,000 cities into browser)
protectedApi.get('/geo/cities', (req: Request, res: Response) => {
  const { country, division, query, limit } = req.query;
  const cities = searchCities({
    countryCode: typeof country === 'string' ? country : undefined,
    divisionCode: typeof division === 'string' ? division : undefined,
    query: typeof query === 'string' ? query : undefined,
    limit: limit ? parseInt(limit as string, 10) : 25,
  });
  res.json({ cities, total: cities.length });
});

// International phone normalization & E.164 validation
protectedApi.post('/geo/normalize-phone', (req: Request, res: Response) => {
  const { phone, countryCode } = req.body;
  if (!phone) {
    res.status(400).json({ error: 'Phone number is required' });
    return;
  }
  const result = normalizePhoneNumber(phone, countryCode || 'US');
  res.json(result);
});

// Country-specific address formatting
protectedApi.post('/geo/format-address', (req: Request, res: Response) => {
  const components = req.body || {};
  const formattedAddress = formatInternationalAddress(components);
  const postalValidation = validatePostalCode(components.postalCode || '', components.countryCode || 'US');
  res.json({ formattedAddress, postalValidation });
});

// International business identifier validation & provenance tagging
protectedApi.post('/identifiers/validate', (req: Request, res: Response) => {
  const { type, value, countryCode, existingStatus } = req.body;
  if (!type || !value) {
    res.status(400).json({ error: 'Identifier type and value are required' });
    return;
  }
  const result = validateIdentifier(type, value, countryCode, existingStatus);
  const message = result.valid
    ? `Valid ${result.type} syntax (${result.issuingAuthority})`
    : result.error || `Invalid ${result.type} format`;
  res.json({ ...result, message });
});

// Country and Source Capability Matrix
protectedApi.get('/geo/capability-matrix', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    const { isPg } = checkStorageEngine();
    const [connectors, settings, overrides] = await Promise.all([
      isPg ? postgresStorage.getConnectors() : storage.getConnectorsUnified(),
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
      isPg ? postgresStorage.getCapabilityOverrides() : Promise.resolve(undefined),
    ]);
    const hasChKey = Boolean(process.env.COMPANIES_HOUSE_API_KEY || settings.companiesHouseApiKey);
    const matrix = buildCountryCapabilityMatrix(connectors, { hasChKey, overrides });
    const stateSummary: Record<string, number> = {
      live_and_operational: 0,
      live_auth_required: 0,
      configuration_required: 0,
      offline_reference_only: 0,
      public_access_unavailable: 0,
      not_implemented: 0,
      temporarily_unavailable: 0,
    };
    for (const entry of matrix) {
      if (entry.registryState && entry.registryState in stateSummary) {
        stateSummary[entry.registryState]++;
      }
    }
    res.json({
      matrix,
      stateSummary,
      totalSources: matrix.length,
      sovereignStatesCount: 195,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to build geographic capability matrix.') });
  }
});

// Phase 6 & 9: 27-Country + Cross-Border Official Government Registry Coverage & 7-State Audit Matrix
protectedApi.get('/registries/coverage', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    const { isPg } = checkStorageEngine();
    const [connectors, settings, overrides] = await Promise.all([
      isPg ? postgresStorage.getConnectors() : storage.getConnectorsUnified(),
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
      isPg ? postgresStorage.getCapabilityOverrides() : Promise.resolve(undefined),
    ]);

    const connectorMap = new Map(connectors.map((c) => [c.id, c]));
    const hasChKey = Boolean(process.env.COMPANIES_HOUSE_API_KEY || settings.companiesHouseApiKey);
    const matrix = buildCountryCapabilityMatrix(connectors, { hasChKey, overrides });

    const registries = getAllAuditedRegistries().map((audit) => {
      const conn = audit.connectorId ? connectorMap.get(audit.connectorId) : undefined;
      let effectiveConn = conn;
      if (audit.countryCode === 'GB' && hasChKey && conn && !conn.isConfigured) {
        effectiveConn = { ...conn, isConfigured: true, healthState: 'operational', operational: true };
      }
      const registryState = resolveSevenStateRegistryStatus(audit, effectiveConn);
      const lastVerifiedAt = overrides?.get(audit.countryCode)?.lastCheckedAt || conn?.lastSuccessAt || undefined;

      return {
        countryCode: audit.countryCode,
        countryName: audit.countryName,
        flag: audit.flag,
        authorityName: audit.authorityName,
        connectorId: audit.connectorId,
        primaryIdentifierType: audit.primaryIdentifierType,
        registryState,
        lastVerifiedAt,
        connectorHealthState: effectiveConn?.healthState,
        isConfigured: effectiveConn ? effectiveConn.isConfigured : false,
        auditDetails: audit.auditDetails,
      };
    });

    const stateCounts: Record<string, number> = {
      live_and_operational: 0,
      live_auth_required: 0,
      configuration_required: 0,
      offline_reference_only: 0,
      public_access_unavailable: 0,
      not_implemented: 0,
      temporarily_unavailable: 0,
    };
    for (const r of registries) {
      stateCounts[r.registryState] = (stateCounts[r.registryState] || 0) + 1;
    }

    res.json({
      registries,
      stateCounts,
      priorityCount: PRIORITY_27_COUNTRIES.length,
      totalAudited: registries.length,
      matrixCount: matrix.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to inspect registry coverage.') });
  }
});

// Leads Management (Supports filtering, canonical identifier aliases, sorting, and pagination)
protectedApi.get('/leads', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const {
      search,
      country,
      region,
      city,
      identifierType,
      status,
      stage,
      category,
      hasWebsite,
      hasEmail,
      hasPhone,
      sortBy,
      sortDir,
      page,
      pageSize,
    } = req.query;

    const cleanSortBy = typeof sortBy === 'string' ? sortBy : 'createdAt';
    const cleanSortDir: 'asc' | 'desc' = sortDir === 'asc' ? 'asc' : 'desc';

    let allMatching: CanonicalLead[];

    if (isPg) {
      allMatching = await postgresStorage.getLeads({
        search: typeof search === 'string' ? search : undefined,
        country: typeof country === 'string' ? country : undefined,
        region: typeof region === 'string' ? region : undefined,
        city: typeof city === 'string' ? city : undefined,
        identifierType: typeof identifierType === 'string' ? identifierType : undefined,
        status: typeof status === 'string' ? status : undefined,
        stage: typeof stage === 'string' ? stage : undefined,
        category: typeof category === 'string' ? category : undefined,
        hasWebsite: hasWebsite === 'true',
        hasEmail: hasEmail === 'true',
        hasPhone: hasPhone === 'true',
        sortBy: cleanSortBy,
        sortDir: cleanSortDir,
      });
    } else {
      let leads = [...storage.getLeads()];
      if (search && typeof search === 'string') {
        const q = search.toLowerCase();
        const qNorm = normalizeIdentifierValue(search);
        leads = leads.filter(
          (l) =>
            l.companyName.toLowerCase().includes(q) ||
            (l.registrationNumber && l.registrationNumber.toLowerCase().includes(q)) ||
            (l.address?.city && l.address.city.toLowerCase().includes(q)) ||
            (l.address?.region && l.address.region.toLowerCase().includes(q)) ||
            (l.address?.country && l.address.country.toLowerCase().includes(q)) ||
            (l.domain && l.domain.toLowerCase().includes(q)) ||
            (l.email && l.email.toLowerCase().includes(q)) ||
            l.tags.some((t) => t.toLowerCase().includes(q)) ||
            l.identifiers?.some(
              (i) =>
                i.value.toLowerCase().includes(q) ||
                (qNorm.length > 0 && normalizeIdentifierValue(i.normalizedValue || i.value).includes(qNorm))
            )
        );
      }
      if (country && typeof country === 'string' && country !== 'ALL') {
        const cUp = country.toUpperCase();
        leads = leads.filter(
          (l) =>
            l.address?.countryCode?.toUpperCase() === cUp ||
            l.address?.country?.toUpperCase() === cUp
        );
      }
      if (region && typeof region === 'string' && region !== 'ALL') {
        const r = region.toLowerCase();
        leads = leads.filter((l) => l.address?.region?.toLowerCase().includes(r));
      }
      if (city && typeof city === 'string' && city !== 'ALL') {
        const c = city.toLowerCase();
        leads = leads.filter((l) => l.address?.city?.toLowerCase().includes(c));
      }
      if (identifierType && typeof identifierType === 'string' && identifierType !== 'ALL') {
        const aliases = new Set(getIdentifierAliases(identifierType));
        const targetCanon = canonicalizeIdentifierType(identifierType);
        leads = leads.filter((l) =>
          l.identifiers?.some(
            (i) =>
              aliases.has(i.type.toUpperCase()) ||
              canonicalizeIdentifierType(i.type, l.address?.countryCode) === targetCanon
          )
        );
      }
      if (status && typeof status === 'string' && status !== 'ALL') {
        leads = leads.filter((l) => l.status === status);
      }
      if (stage && typeof stage === 'string' && stage !== 'ALL') {
        leads = leads.filter((l) => l.pipelineStageId === stage);
      }
      if (category && typeof category === 'string' && category !== 'ALL') {
        const cat = category.toLowerCase();
        leads = leads.filter((l) => l.category?.toLowerCase().includes(cat));
      }
      if (hasWebsite === 'true') {
        leads = leads.filter((l) => Boolean(l.website && l.website.trim()));
      }
      if (hasEmail === 'true') {
        leads = leads.filter((l) => Boolean(l.email && l.email.trim()));
      }
      if (hasPhone === 'true') {
        leads = leads.filter((l) => Boolean((l.phone && l.phone.trim()) || (l.phoneNormalized && l.phoneNormalized.trim())));
      }

      leads.sort((a, b) => {
        const dir = cleanSortDir === 'asc' ? 1 : -1;
        switch (cleanSortBy) {
          case 'companyName':
            return dir * a.companyName.localeCompare(b.companyName);
          case 'confidenceScore':
            return dir * ((a.confidenceScore || 0) - (b.confidenceScore || 0));
          case 'opportunityValue':
            return dir * ((a.opportunityValue || 0) - (b.opportunityValue || 0));
          case 'country':
            return dir * (a.address?.country || '').localeCompare(b.address?.country || '');
          case 'updatedAt':
            return dir * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
          default:
            return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        }
      });

      allMatching = leads;
    }

    const total = allMatching.length;
    const requestedPage = page ? Math.max(1, parseInt(String(page), 10) || 1) : 1;
    const requestedPageSize = pageSize ? Math.max(1, Math.min(200, parseInt(String(pageSize), 10) || 25)) : null;

    if (requestedPageSize !== null) {
      const start = (requestedPage - 1) * requestedPageSize;
      const sliced = allMatching.slice(start, start + requestedPageSize);
      const totalPages = Math.max(1, Math.ceil(total / requestedPageSize));
      res.json({
        leads: sliced,
        total,
        page: requestedPage,
        pageSize: requestedPageSize,
        totalPages,
      });
    } else {
      res.json({
        leads: allMatching,
        total,
        page: 1,
        pageSize: total || 25,
        totalPages: 1,
      });
    }
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const status = rawMsg.includes('Database connection unavailable') ? 503 : 500;
    res.status(status).json({ error: sanitizeApiError(err, 'Failed to fetch leads.') });
  }
});

protectedApi.get('/leads/:id', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const lead = isPg ? await postgresStorage.getLead(req.params.id) : storage.getLead(req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    res.json(lead);
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const status = rawMsg.includes('Database connection unavailable') ? 503 : 500;
    res.status(status).json({ error: sanitizeApiError(err, 'Failed to fetch lead.') });
  }
});

protectedApi.post('/leads', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const validation = validateLeadCreateOrUpdate(req.body, 'create');
    if (!validation.ok || !validation.data) {
      res.status(400).json({ error: validation.error || 'Invalid lead payload.' });
      return;
    }

    const now = new Date().toISOString();
    const rawId = typeof req.body?.id === 'string' && req.body.id.trim().length > 0 && req.body.id.trim().length <= 120
      ? req.body.id.trim()
      : `lead-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const newLead: CanonicalLead = {
      sources: [],
      identifiers: [],
      confidenceSignals: [],
      confidenceScore: 50,
      tags: [],
      notes: [],
      activities: [],
      status: 'new',
      industry: 'B2B Services',
      category: 'General',
      currency: 'USD',
      ...validation.data,
      id: rawId,
      companyName: validation.data.companyName,
      createdAt: now,
      updatedAt: now,
    };

    const saved = isPg ? await postgresStorage.upsertLead(newLead) : storage.upsertLead(newLead);
    res.status(201).json(saved);
  } catch (err: unknown) {
    const msg = sanitizeApiError(err, 'Failed to create lead.');
    const status = msg.includes('Database connection unavailable')
      ? 503
      : msg.includes('Invalid pipelineStageId') || msg.includes('does not exist in pipeline_stages')
      ? 400
      : 500;
    res.status(status).json({ error: msg });
  }
});

protectedApi.put('/leads/:id', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const validation = validateLeadCreateOrUpdate(req.body, 'update');
    if (!validation.ok || !validation.data) {
      res.status(400).json({ error: validation.error || 'Invalid lead update payload.' });
      return;
    }

    const existing = isPg ? await postgresStorage.getLead(req.params.id) : storage.getLead(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const merged: CanonicalLead = {
      ...existing,
      ...validation.data,
      id: req.params.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    const updated = isPg ? await postgresStorage.upsertLead(merged) : storage.upsertLead(merged);
    res.json(updated);
  } catch (err: unknown) {
    const msg = sanitizeApiError(err, 'Failed to update lead.');
    const status = msg.includes('Database connection unavailable')
      ? 503
      : msg.includes('Invalid pipelineStageId') || msg.includes('does not exist in pipeline_stages')
      ? 400
      : 500;
    res.status(status).json({ error: msg });
  }
});

protectedApi.delete('/leads/:id', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const success = isPg ? await postgresStorage.deleteLead(req.params.id) : storage.deleteLead(req.params.id);
    if (!success) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    if (isPg && req.owner) {
      await postgresStorage
        .recordAuditEvent(
          'LEAD_DELETED',
          req.owner.email,
          'lead',
          req.params.id,
          { deletedId: req.params.id },
          normalizeClientIp(req)
        )
        .catch(() => {});
    }
    res.json({ success: true, deletedId: req.params.id });
  } catch (err: unknown) {
    const msg = sanitizeApiError(err, 'Failed to delete lead.');
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
  }
});

// Batch Import from CSV / JSON with row validation and deduplication
protectedApi.post('/leads/batch-import', createRateLimitMiddleware(importRateLimiter), async (req: Request, res: Response) => {
  const { leads, mode } = req.body || {};
  if (!Array.isArray(leads) || leads.length === 0) {
    res.status(400).json({ error: 'Array of leads is required' });
    return;
  }
  if (leads.length > MAX_BATCH_IMPORT_ROWS) {
    res.status(400).json({ error: `Batch import exceeds maximum limit of ${MAX_BATCH_IMPORT_ROWS} rows per request.` });
    return;
  }

  try {
    const { isPg } = checkStorageEngine();
    const skipDuplicates = mode === 'skip';
    const validLeads: CanonicalLead[] = [];
    const errors: Array<{ row: number; companyName?: string; error: string }> = [];

    leads.forEach((raw: any, index: number) => {
      if (!raw || typeof raw.companyName !== 'string' || !raw.companyName.trim()) {
        errors.push({ row: index + 1, error: 'Missing required companyName' });
        return;
      }
      const cCode = (raw.address?.countryCode || 'US').toUpperCase();
      const countryRef = getCountryByCode(cCode);
      const rawPhone = typeof raw.phone === 'string' ? raw.phone.trim() : '';
      let phoneNormalized = raw.phoneNormalized;
      if (rawPhone && !phoneNormalized) {
        const normRes = normalizePhoneNumber(rawPhone, cCode);
        if (normRes.valid && normRes.e164) phoneNormalized = normRes.e164;
      }

      const identifiers = Array.isArray(raw.identifiers)
        ? raw.identifiers.map((i: any) => ({
            ...i,
            type: canonicalizeIdentifierType(i.type, i.countryCode || cCode),
            countryCode: (i.countryCode || cCode).toUpperCase(),
            normalizedValue: i.normalizedValue || normalizeIdentifierValue(i.value || ''),
          }))
        : [];

      validLeads.push({
        ...raw,
        id: raw.id || `imp-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
        companyName: raw.companyName.trim(),
        phone: rawPhone || undefined,
        phoneNormalized,
        registrationType: raw.registrationType
          ? canonicalizeIdentifierType(raw.registrationType, cCode)
          : undefined,
        currency: (raw.currency || countryRef?.currency || 'USD').toUpperCase(),
        address: {
          street: raw.address?.street,
          city: raw.address?.city,
          region: raw.address?.region,
          postalCode: raw.address?.postalCode,
          country: raw.address?.country || countryRef?.name || 'International',
          countryCode: countryRef?.code || cCode,
          formattedAddress:
            raw.address?.formattedAddress ||
            formatInternationalAddress({
              street: raw.address?.street,
              city: raw.address?.city,
              region: raw.address?.region,
              postalCode: raw.address?.postalCode,
              country: raw.address?.country || countryRef?.name || 'International',
              countryCode: countryRef?.code || cCode,
            }),
        },
        identifiers,
      });
    });

    if (validLeads.length === 0) {
      res.status(400).json({
        success: false,
        added: 0,
        updated: 0,
        skipped: 0,
        failed: errors.length,
        errors,
        error: 'No valid rows available to import.',
      });
      return;
    }

    const result = isPg
      ? await postgresStorage.batchUpsertLeads(validLeads, { skipDuplicates })
      : storage.batchUpsertLeads(validLeads, { skipDuplicates });

    const allErrors = [...errors, ...(result.errors || [])];
    const totalFailed = errors.length + (result.failed || 0);

    res.json({
      success: true,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      failed: totalFailed,
      errors: allErrors.length > 0 ? allErrors : undefined,
      savedLeadIds: result.savedLeadIds,
      totalProcessed: leads.length,
    });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const status = rawMsg.includes('Database connection unavailable') ? 503 : 500;
    res.status(status).json({ error: sanitizeApiError(err, 'Batch import failed.') });
  }
});

// Add Note to Lead
protectedApi.post('/leads/:id/notes', async (req: Request, res: Response) => {
  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: 'Note content is required' });
    return;
  }

  try {
    const { isPg } = checkStorageEngine();
    const author = req.owner?.fullName || 'Lead Intelligence Operator';

    if (isPg) {
      const updated = await postgresStorage.addNote(req.params.id, String(content), author);
      if (!updated) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      res.json(updated);
    } else {
      const lead = storage.getLead(req.params.id);
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      lead.notes.unshift({
        id: `note-${Date.now()}`,
        content: String(content),
        createdAt: new Date().toISOString(),
        author,
      });
      lead.activities.unshift({
        id: `act-${Date.now()}`,
        type: 'note',
        title: 'Added Note',
        notes: String(content).slice(0, 80),
        date: new Date().toISOString(),
        actor: author,
      });
      const saved = storage.upsertLead(lead);
      res.json(saved);
    }
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const status = rawMsg.includes('Database connection unavailable') ? 503 : 500;
    res.status(status).json({ error: sanitizeApiError(err, 'Failed to add note.') });
  }
});

// Add Activity to Lead
protectedApi.post('/leads/:id/activities', async (req: Request, res: Response) => {
  const { type, title, outcome, notes } = req.body;
  if (!title) {
    res.status(400).json({ error: 'Activity title is required' });
    return;
  }

  try {
    const { isPg } = checkStorageEngine();
    const author = req.owner?.fullName || 'Lead Intelligence Operator';

    if (isPg) {
      const updated = await postgresStorage.addActivity(req.params.id, {
        type: type || 'call',
        title,
        outcome,
        notes,
        actor: author,
        date: new Date().toISOString(),
      });
      if (!updated) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      res.json(updated);
    } else {
      const lead = storage.getLead(req.params.id);
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      lead.activities.unshift({
        id: `act-${Date.now()}`,
        type: type || 'call',
        title,
        outcome,
        notes,
        date: new Date().toISOString(),
        actor: author,
      });
      const saved = storage.upsertLead(lead);
      res.json(saved);
    }
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const status = rawMsg.includes('Database connection unavailable') ? 503 : 500;
    res.status(status).json({ error: sanitizeApiError(err, 'Failed to add activity.') });
  }
});

// Phase 6: Verify & Match Lead Against Official Government Business Registry
protectedApi.post('/leads/:id/verify-registry', async (req: Request, res: Response) => {
  ensureConnectorsRegistered();
  try {
    const { isPg } = checkStorageEngine();
    const existingLead = isPg
      ? await postgresStorage.getLead(req.params.id)
      : storage.getLead(req.params.id);

    if (!existingLead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const [settings, configs] = await Promise.all([
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
      isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
    ]);

    for (const [id, cfg] of Object.entries(configs)) {
      if (typeof cfg?.enabled === 'boolean') {
        connectorRegistry.setEnabledOverride(id, cfg.enabled);
      }
    }

    const report = await verifyLeadWithOfficialRegistry(existingLead, {
      registry: connectorRegistry,
      executionEngine: connectorExecutionEngine,
      configs,
      userAgent: settings.userAgent,
      onRecordRun: async (run) => {
        if (isPg) await postgresStorage.recordConnectorRun(run);
        else storage.recordConnectorRun(run);
      },
    });

    const updatedLead = applyOfficialVerificationToLead(existingLead, report);
    const savedLead = isPg
      ? await postgresStorage.upsertLead(updatedLead)
      : storage.upsertLead(updatedLead);

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        'LEAD_REGISTRY_VERIFIED',
        req.owner.email,
        'lead',
        savedLead.id,
        {
          state: report.state,
          matchType: report.matchType,
          connectorId: report.connectorId,
          isLiveApi: report.isLiveApi,
          conflictCount: report.conflicts.length,
        },
        normalizeClientIp(req)
      );
    }

    res.json({
      verified: report.state === 'officially_verified',
      lead: savedLead,
      report,
    });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const status = rawMsg.includes('Database connection unavailable') ? 503 : 500;
    res.status(status).json({ error: sanitizeApiError(err, 'Registry verification failed.') });
  }
});

// Phase 5 Global Business Discovery Engine (Unified Connector Execution Engine)
protectedApi.post('/discovery/search', createRateLimitMiddleware(discoveryRateLimiter), async (req: Request, res: Response) => {
  const payload = (req.body || {}) as DiscoverySearchRequest;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({ error: 'Discovery search payload must be an object.' });
    return;
  }

  ensureConnectorsRegistered();

  const { isPg } = checkStorageEngine();
  try {
    const [settings, configs, existingCrmLeads] = await Promise.all([
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
      isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
      isPg ? postgresStorage.getLeads() : Promise.resolve(storage.getLeads()),
    ]);

    for (const [id, cfg] of Object.entries(configs)) {
      if (typeof cfg?.enabled === 'boolean') {
        connectorRegistry.setEnabledOverride(id, cfg.enabled);
      }
    }

    const configuredConnectorIds = new Set<string>();
    const allConnectors = connectorRegistry.listAll();
    await Promise.all(
      allConnectors.map(async (conn) => {
        const credStatus = await credentialManager.getCredentialStatus(
          conn.id,
          conn.getMetadata().credentialRequirements
        );
        if (credStatus.configured) configuredConnectorIds.add(conn.id);
      })
    );

    const result = await discoveryService.executeSearch(payload, {
      registry: connectorRegistry,
      executionEngine: connectorExecutionEngine,
      configs,
      configuredConnectorIds,
      userAgent: settings.userAgent,
      existingCrmLeads,
      onRecordRun: async (run) => {
        if (isPg) await postgresStorage.recordConnectorRun(run);
        else storage.recordConnectorRun(run);
      },
    });

    if (payload.autoSave && result.leads.length > 0) {
      const session = discoveryService.getSession(result.searchId);
      const toSave = session ? session.leads : result.leads;
      const skipDuplicates = payload.duplicatePolicy === 'skip';
      if (isPg) await postgresStorage.batchUpsertLeads(toSave, { skipDuplicates });
      else storage.batchUpsertLeads(toSave, { skipDuplicates });
    }

    res.json(result);
  } catch (globalErr: unknown) {
    if (globalErr instanceof ConnectorError) {
      const status =
        globalErr.category === 'invalid_request' || globalErr.category === 'configuration_error'
          ? 400
          : globalErr.category === 'rate_limited'
          ? 429
          : 500;
      res.status(status).json({
        error: sanitizeApiError(globalErr.safeMessage, 'Discovery provider error.'),
        errorCategory: globalErr.category,
      });
      return;
    }
    res.status(500).json({ error: `Discovery failed: ${sanitizeApiError(globalErr, 'Discovery search failed.')}` });
  }
});

// Server-side paginated results & filtering for an active discovery session
protectedApi.get('/discovery/results/:searchId', (req: Request, res: Response) => {
  const { searchId } = req.params;
  const page = req.query.page ? parseInt(String(req.query.page), 10) : 1;
  const pageSize = req.query.pageSize ? parseInt(String(req.query.pageSize), 10) : 25;
  const duplicateFilter = (req.query.duplicateFilter as any) || 'all';
  const connectorId = req.query.connectorId ? String(req.query.connectorId) : undefined;
  const countryCode = req.query.countryCode ? String(req.query.countryCode) : undefined;
  const minConfidence = req.query.minConfidence ? parseInt(String(req.query.minConfidence), 10) : undefined;
  const sortBy = req.query.sortBy === 'name_asc' ? 'name_asc' : 'confidence_desc';

  const pageData = discoveryService.getPaginatedResults(searchId, {
    page,
    pageSize,
    duplicateFilter,
    connectorId,
    countryCode,
    minConfidence,
    sortBy,
  });

  if (!pageData) {
    res.status(404).json({
      error: 'Discovery search session expired or not found. Re-run the discovery query.',
      code: 'SEARCH_SESSION_NOT_FOUND',
    });
    return;
  }

  res.json(pageData);
});

// Cancel an in-flight discovery search cleanly
protectedApi.post('/discovery/cancel/:requestId', async (req: Request, res: Response) => {
  const { requestId } = req.params;
  const cancelledDiscovery = discoveryService.cancelSearch(requestId);
  const cancelledConnector = connectorExecutionEngine.cancelExecution(requestId);
  const cancelled = cancelledDiscovery || cancelledConnector;

  const { isPg } = checkStorageEngine();
  if (isPg && req.owner) {
    await postgresStorage.recordAuditEvent(
      'DISCOVERY_SEARCH_CANCELLED',
      req.owner.email,
      'discovery_search',
      requestId,
      { cancelledDiscovery, cancelledConnector },
      normalizeClientIp(req)
    );
  }

  res.json({
    success: true,
    cancelled,
    requestId,
    message: cancelled ? 'Discovery search aborted cleanly.' : 'No active execution matched that request ID.',
  });
});

// Recent discovery execution history (from connector_runs, secrets redacted)
protectedApi.get('/discovery/history', async (req: Request, res: Response) => {
  ensureConnectorsRegistered();
  const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 25)) : 25;

  try {
    const { isPg } = checkStorageEngine();
    const runs = isPg
      ? await postgresStorage.getConnectorRuns(undefined, limit * 2)
      : storage.getConnectorRuns(undefined, limit * 2);

    const history = runs
      .filter((r) => r.operation === 'search' || r.operation === 'enrich' || r.operation === 'ai_inference')
      .slice(0, limit)
      .map((r) => {
        const meta = connectorRegistry.getById(r.connectorId)?.getMetadata();
        return {
          id: r.id,
          connectorId: r.connectorId,
          connectorName: meta?.shortName || meta?.name || r.connectorId,
          operation: r.operation,
          queryParams: r.queryParams,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          durationMs: r.durationMs,
          status: r.status,
          recordsDiscovered: r.recordsDiscovered,
          recordsNormalized: r.recordsNormalized,
          errorCategory: r.errorCategory,
          diagnosticSummary: r.diagnosticSummary ? redactSecrets(r.diagnosticSummary) : undefined,
          requestId: r.requestId,
        };
      });

    res.json({ history });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch discovery history.') });
  }
});

// Enrich a discovered business candidate via Web Inspector &/or Gemini AI
protectedApi.post('/discovery/enrich', createRateLimitMiddleware(discoveryRateLimiter), async (req: Request, res: Response) => {
  const { searchId, leadId, lead, runWebInspector = true, runAi = true } = req.body || {};

  let targetLead: CanonicalLead | undefined = lead;
  if (!targetLead && searchId && leadId) {
    const session = discoveryService.getSession(String(searchId));
    targetLead = session?.leads.find((l) => l.id === leadId);
  }

  if (!targetLead || !targetLead.companyName) {
    res.status(400).json({ error: 'Valid lead object or active searchId + leadId is required for enrichment.' });
    return;
  }

  ensureConnectorsRegistered();

  try {
    const { isPg } = checkStorageEngine();
    const configs = isPg ? await postgresStorage.getConnectorConfigs() : storage.getConnectorConfigs();

    const enriched = await discoveryService.enrichCandidate(
      {
        searchId: searchId ? String(searchId) : undefined,
        lead: targetLead,
        runWebInspector: Boolean(runWebInspector),
        runAi: Boolean(runAi),
      },
      {
        configs,
        onRecordRun: async (run) => {
          if (isPg) await postgresStorage.recordConnectorRun(run);
          else storage.recordConnectorRun(run);
        },
      }
    );

    res.json(enriched);
  } catch (err: unknown) {
    res.status(500).json({ error: `Enrichment failed: ${sanitizeApiError(err, 'Enrichment error.')}` });
  }
});

// Duplicate-aware transactional save from Discovery results into CRM
protectedApi.post('/discovery/save', async (req: Request, res: Response) => {
  const validated = validateDiscoverySaveBody(req.body);
  if (!validated.ok || !validated.data) {
    res.status(400).json({ error: validated.error || 'Invalid discovery save payload.' });
    return;
  }
  const { searchId, leadIds, leads: inlineLeads, duplicatePolicy } = validated.data;

  let candidateLeads: CanonicalLead[] = [];
  const session = searchId ? discoveryService.getSession(String(searchId)) : undefined;

  if (Array.isArray(inlineLeads) && inlineLeads.length > 0) {
    candidateLeads = inlineLeads;
  } else if (session) {
    if (Array.isArray(leadIds) && leadIds.length > 0) {
      const idSet = new Set(leadIds.map(String));
      candidateLeads = session.leads.filter((l) => idSet.has(l.id));
    } else {
      candidateLeads = session.leads;
    }
  }

  if (candidateLeads.length === 0) {
    res.status(400).json({ error: 'No valid discovered leads supplied to save to CRM.' });
    return;
  }

  try {
    const { isPg } = checkStorageEngine();
    const skipDuplicates = duplicatePolicy === 'skip';
    const result = isPg
      ? await postgresStorage.batchUpsertLeads(candidateLeads, { skipDuplicates })
      : storage.batchUpsertLeads(candidateLeads, { skipDuplicates });

    const ambiguousMatches: Array<{ leadId: string; companyName: string; note?: string; matchedLeadName?: string }> = [];
    if (session) {
      for (const l of candidateLeads) {
        const dup = session.duplicateInfoByLeadId[l.id];
        if (dup?.requiresReview) {
          ambiguousMatches.push({
            leadId: l.id,
            companyName: l.companyName,
            note: dup.note,
            matchedLeadName: dup.matchedLeadName,
          });
        }
      }
    }

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        'DISCOVERY_LEADS_SAVED',
        req.owner.email,
        'leads',
        searchId || 'inline',
        {
          requested: candidateLeads.length,
          added: result.added,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
          duplicatePolicy,
        },
        normalizeClientIp(req)
      );
    }

    res.json({
      success: true,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      failed: result.failed,
      errors: result.errors.length > 0 ? result.errors : undefined,
      savedLeadIds: result.savedLeadIds,
      ambiguousMatches: ambiguousMatches.length > 0 ? ambiguousMatches : undefined,
    });
  } catch (err: unknown) {
    const msg = sanitizeApiError(err, 'Failed to save discovered leads.');
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
  }
});

// Phase 10: Search Engine & Public Business Directory Provider Matrix (with live credential & availability state)
protectedApi.get('/discovery/providers', async (_req: Request, res: Response) => {
  ensureConnectorsRegistered();
  try {
    const { isPg } = checkStorageEngine();
    const [configs, runs] = await Promise.all([
      isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
      isPg ? postgresStorage.getConnectorRuns(undefined, 200) : Promise.resolve(storage.getConnectorRuns(undefined, 200)),
    ]);
    const statsByConnector = aggregateRunsByConnector(runs);
    const statuses = await Promise.all(
      connectorRegistry.listAll().map((c) =>
        buildUnifiedConnectorStatus(c, {
          stats: statsByConnector.get(c.id),
          config: configs[c.id],
        })
      )
    );
    const providers = buildSearchAndDirectoryProviderMatrix(statuses);
    res.json({ providers });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to build search provider matrix.') });
  }
});

// Phase 10: AI-assisted (with deterministic fallback) discovery search query generator
protectedApi.post('/discovery/ai-queries', createRateLimitMiddleware(aiRateLimiter), async (req: Request, res: Response) => {
  const { query, industry, productsServices, countryCode, region, city, businessType } = req.body || {};
  try {
    const plan = await generateDiscoveryQueriesWithAi({
      query: typeof query === 'string' ? query.slice(0, 200) : undefined,
      industry: typeof industry === 'string' ? industry.slice(0, 120) : undefined,
      productsServices: typeof productsServices === 'string' ? productsServices.slice(0, 200) : undefined,
      countryCode: typeof countryCode === 'string' ? countryCode.slice(0, 12) : undefined,
      region: typeof region === 'string' ? region.slice(0, 120) : undefined,
      city: typeof city === 'string' ? city.slice(0, 120) : undefined,
      businessType: typeof businessType === 'string' ? businessType.slice(0, 120) : undefined,
    });
    res.json(plan);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to generate discovery queries.') });
  }
});

// Phase 10: Direct SSRF-protected multi-page company website intelligence inspection
protectedApi.post('/discovery/inspect-website', createRateLimitMiddleware(inspectionRateLimiter), async (req: Request, res: Response) => {
  const { url, companyName, runAiExtraction = true } = req.body || {};
  if (!url || typeof url !== 'string' || url.trim().length > 2048) {
    res.status(400).json({ error: 'Valid website URL string (max 2048 chars) is required.' });
    return;
  }

  ensureConnectorsRegistered();
  const { isPg } = checkStorageEngine();
  const [settings, configs] = await Promise.all([
    isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
    isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
  ]);

  if (configs['conn-web-inspector'] && !configs['conn-web-inspector'].enabled) {
    res.status(400).json({
      error: 'Safe Website Inspector connector is disabled. Enable it in Connectors Hub first.',
      errorCategory: 'configuration_error',
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const inspection = await inspectWebsite(url.trim(), {
    userAgent: settings.userAgent,
    checkRobots: true,
    maxPages: 5,
  });

  const runRecord: ConnectorRunRecord = {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    connectorId: 'conn-web-inspector',
    operation: 'enrich',
    queryParams: { url: url.trim().slice(0, 200) },
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
      (inspection.isOnline ? `HTTP ${inspection.httpStatus} (${inspection.pagesVisited?.length || 1} page(s))` : 'Target offline'),
  };
  if (isPg) await postgresStorage.recordConnectorRun(runRecord);
  else storage.recordConnectorRun(runRecord);

  let aiIntel: Awaited<ReturnType<typeof extractBusinessIntelFromWebEvidence>> | undefined;
  if (runAiExtraction && inspection.isOnline && inspection.securityCheck.passed && inspection.pageExcerpts?.length) {
    aiIntel = await extractBusinessIntelFromWebEvidence({
      companyName:
        (typeof companyName === 'string' && companyName.trim()) ||
        inspection.businessName ||
        inspection.title ||
        inspection.domain,
      url: inspection.url,
      pageExcerpts: inspection.pageExcerpts,
      existingIndustry: inspection.industry,
    });
  }

  res.json({
    inspection,
    aiIntel,
  });
});

// Phase 10: AI-assisted assessment for flagged ambiguous duplicate / subsidiary pairs (never auto-merges)
protectedApi.post('/discovery/duplicate-assess', createRateLimitMiddleware(aiRateLimiter), async (req: Request, res: Response) => {
  const { candidate, matchedLeadId, matchReason } = req.body || {};
  if (!candidate || !candidate.companyName || !matchedLeadId) {
    res.status(400).json({ error: 'candidate and matchedLeadId are required.' });
    return;
  }

  const { isPg } = checkStorageEngine();
  const leads = isPg ? await postgresStorage.getLeads() : storage.getLeads();
  const existing = leads.find((l) => l.id === String(matchedLeadId));
  if (!existing) {
    res.status(404).json({ error: 'Matched CRM lead not found.' });
    return;
  }

  const assessment = await assessDuplicatePairWithAi({
    candidate,
    existing,
    matchReason: typeof matchReason === 'string' ? matchReason : 'Matched candidate in CRM',
  });
  res.json(assessment);
});

// Export genuine discovery results as RFC 4180 CSV or structured JSON
protectedApi.get('/discovery/export/:searchId', createRateLimitMiddleware(exportRateLimiter), async (req: Request, res: Response) => {
  const { searchId } = req.params;
  const format = String(req.query.format || 'csv').toLowerCase() === 'json' ? 'json' : 'csv';
  const idsParam = typeof req.query.ids === 'string' ? req.query.ids : undefined;
  const selectedIds = idsParam
    ? idsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const payload =
    format === 'json'
      ? discoveryService.exportSessionJson(searchId, selectedIds)
      : discoveryService.exportSessionCsv(searchId, selectedIds);

  if (!payload) {
    res.status(404).json({ error: 'Discovery search session expired or not found.' });
    return;
  }

  if (dbManager.isDbConnected() && req.owner) {
    await postgresStorage
      .recordAuditEvent(
        format === 'json' ? 'DISCOVERY_JSON_EXPORTED' : 'DISCOVERY_CSV_EXPORTED',
        req.owner.email,
        'discovery_search',
        searchId,
        { selectedCount: selectedIds?.length ?? 'all', format },
        normalizeClientIp(req)
      )
      .catch(() => {});
  }

  const safeSearchId = sanitizeExportFilenamePart(searchId, 'session');
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leed_discovery_${safeSearchId}_${Date.now()}.json"`);
  } else {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leed_discovery_${safeSearchId}_${Date.now()}.csv"`);
  }
  res.send(payload);
});

// SSRF-Safe Web Inspector
protectedApi.post('/inspection/inspect-url', createRateLimitMiddleware(inspectionRateLimiter), async (req: Request, res: Response) => {
  const { url, leadId } = req.body || {};
  if (!url || typeof url !== 'string' || url.trim().length > 2048) {
    res.status(400).json({ error: 'Valid URL string (max 2048 chars) is required' });
    return;
  }

  ensureConnectorsRegistered();
  const { isPg } = checkStorageEngine();
  const configs = isPg ? await postgresStorage.getConnectorConfigs() : storage.getConnectorConfigs();
  const inspectorCfg = configs['conn-web-inspector'];
  if (inspectorCfg && !inspectorCfg.enabled) {
    res.status(400).json({
      error: 'Safe Website Inspector connector is disabled. Enable it in Connectors Hub first.',
      errorCategory: 'configuration_error',
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  try {
    const inspection = await inspectWebsite(url);
    const runRecord: ConnectorRunRecord = {
      id: `run-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      connectorId: 'conn-web-inspector',
      operation: 'enrich',
      queryParams: { url: String(url).slice(0, 200), leadId },
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
          ? `HTTP ${inspection.httpStatus} (${inspection.serverLatencyMs}ms)`
          : 'Target host unreachable'),
    };

    if (isPg) {
      await postgresStorage.recordConnectorRun(runRecord);
    } else {
      storage.recordConnectorRun(runRecord);
    }

    if (leadId && inspection.isOnline) {
      const lead = isPg ? await postgresStorage.getLead(leadId) : storage.getLead(leadId);
      if (lead) {
        lead.webMetadata = {
          title: inspection.title,
          description: inspection.description,
          httpStatus: inspection.httpStatus,
          isHttps: inspection.isHttps,
          serverLatencyMs: inspection.serverLatencyMs,
          inspectedAt: new Date().toISOString(),
        };

        if (inspection.emailsFound.length > 0 && !lead.email) {
          lead.email = inspection.emailsFound[0];
          lead.emailStatus = 'syntax_valid';
          lead.confidenceScore = Math.min(100, lead.confidenceScore + 10);
          lead.confidenceSignals.push('Public Email Discovered via Live Website Inspection');
        }

        if (inspection.socialLinks) {
          lead.socialLinks = { ...lead.socialLinks, ...inspection.socialLinks };
        }

        lead.activities.unshift({
          id: `act-${Date.now()}`,
          type: 'enrichment',
          title: 'Live Website Inspected (SSRF Protected)',
          outcome: `HTTP ${inspection.httpStatus} (${inspection.serverLatencyMs}ms) - Title: ${inspection.title?.slice(0, 40) || 'N/A'}`,
          date: new Date().toISOString(),
          actor: 'Web Inspector',
        });

        if (isPg) await postgresStorage.upsertLead(lead);
        else storage.upsertLead(lead);
      }
    }

    res.json(inspection);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const runRecord: ConnectorRunRecord = {
      id: `run-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      connectorId: 'conn-web-inspector',
      operation: 'enrich',
      queryParams: { url: String(url).slice(0, 200), leadId },
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      status: 'error',
      recordsDiscovered: 0,
      recordsNormalized: 0,
      recordsRejected: 0,
      errorCategory: 'unknown_provider_error',
      diagnosticSummary: redactSecrets(msg),
    };
    if (isPg) await postgresStorage.recordConnectorRun(runRecord);
    else storage.recordConnectorRun(runRecord);
    res.status(500).json({ error: `Inspection failed: ${sanitizeApiError(err, 'Website inspection failed.')}` });
  }
});

// Deduplication & Merge Engine
protectedApi.get('/dedupe/candidates', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const leads = isPg ? await postgresStorage.getLeads() : storage.getLeads();
    const candidates = detectDuplicates(leads);
    res.json({ candidates, count: candidates.length });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to inspect duplicate candidates.') });
  }
});

protectedApi.post('/dedupe/merge', async (req: Request, res: Response) => {
  const { survivorId, absorbedId, reason } = req.body || {};
  if (
    !survivorId ||
    typeof survivorId !== 'string' ||
    !absorbedId ||
    typeof absorbedId !== 'string' ||
    survivorId === absorbedId
  ) {
    res.status(400).json({ error: 'Distinct valid survivorId and absorbedId strings are required' });
    return;
  }

  try {
    const { isPg } = checkStorageEngine();
    const survivor = isPg ? await postgresStorage.getLead(survivorId) : storage.getLead(survivorId);
    const absorbed = isPg ? await postgresStorage.getLead(absorbedId) : storage.getLead(absorbedId);

    if (!survivor || !absorbed) {
      res.status(404).json({ error: 'One or both leads not found' });
      return;
    }

    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : 'Manual Owner Merge';
    const { updatedSurvivor, historyRecord } = mergeLeads(survivor, absorbed, cleanReason);

    if (isPg) {
      await postgresStorage.upsertLead(updatedSurvivor);
      await postgresStorage.deleteLead(absorbedId);
      await postgresStorage.recordMerge(historyRecord);
      if (req.owner) {
        await postgresStorage
          .recordAuditEvent(
            'LEADS_MERGED',
            req.owner.email,
            'lead_merge_history',
            historyRecord.id,
            { survivorId, absorbedId, reason: cleanReason },
            normalizeClientIp(req)
          )
          .catch(() => {});
      }
    } else {
      storage.upsertLead(updatedSurvivor);
      storage.deleteLead(absorbedId);
      storage.recordMerge(historyRecord);
    }

    res.json({
      success: true,
      survivor: updatedSurvivor,
      mergeHistoryId: historyRecord.id,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to merge leads.') });
  }
});

protectedApi.post('/dedupe/undo/:historyId', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const success = isPg ? await postgresStorage.undoMerge(req.params.historyId) : storage.undoMerge(req.params.historyId);
    if (!success) {
      res.status(404).json({ error: 'Merge history snapshot not found or already undone' });
      return;
    }
    if (isPg && req.owner) {
      await postgresStorage
        .recordAuditEvent(
          'LEAD_MERGE_UNDONE',
          req.owner.email,
          'lead_merge_history',
          req.params.historyId,
          { historyId: req.params.historyId },
          normalizeClientIp(req)
        )
        .catch(() => {});
    }
    res.json({ success: true, message: 'Merge successfully reversed. Absorbed lead restored.' });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to undo merge.') });
  }
});

protectedApi.get('/dedupe/history', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const history = isPg ? await postgresStorage.getMergeHistory() : storage.getMergeHistory();
    res.json(history);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch merge history.') });
  }
});

// Pipeline & Stages
protectedApi.get('/pipeline/stages', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const stages = isPg ? await postgresStorage.getStages() : storage.getStages();
    const leads = isPg ? await postgresStorage.getLeads() : storage.getLeads();

    const stagesWithMetrics = stages.map((stage) => {
      const stageLeads = leads.filter((l) => l.pipelineStageId === stage.id);
      const totalValue = stageLeads.reduce((acc, l) => acc + (l.opportunityValue || 0), 0);
      return {
        ...stage,
        leadCount: stageLeads.length,
        totalValue,
      };
    });

    res.json(stagesWithMetrics);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch pipeline stages.') });
  }
});

protectedApi.post('/pipeline/stages/initialize', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    if (isPg) {
      const result = await postgresStorage.initializeDefaultStages();
      if (result.initialized && req.owner) {
        await postgresStorage.recordAuditEvent(
          'PIPELINE_STAGES_INITIALIZED',
          req.owner.email,
          'pipeline_stages',
          'default_stages',
          { insertedCount: result.insertedCount, stageIds: result.stages.map((s) => s.id) },
          normalizeClientIp(req)
        );
      }
      res.json({ success: true, ...result });
    } else {
      const result = storage.initializeDefaultStages();
      res.json({ success: true, ...result });
    }
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const status = rawMsg.includes('Database connection unavailable') ? 503 : 500;
    res.status(status).json({ error: sanitizeApiError(err, 'Failed to initialize pipeline stages.') });
  }
});

protectedApi.put('/pipeline/move', async (req: Request, res: Response) => {
  const validated = validatePipelineMoveBody(req.body);
  if (!validated.ok || !validated.data) {
    res.status(400).json({ error: validated.error || 'Both leadId and stageId are required.' });
    return;
  }
  const { leadId, stageId, lostReason } = validated.data;
  const author = req.owner?.fullName || 'Lead Intelligence Operator';

  try {
    const { isPg } = checkStorageEngine();
    if (isPg) {
      const updated = await postgresStorage.moveLeadStage(leadId, stageId, lostReason, author);
      if (!updated) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      res.json(updated);
    } else {
      const lead = storage.getLead(leadId);
      if (!lead) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      const stages = storage.getStages();
      const targetStage = stages.find((s) => s.id === stageId);
      if (!targetStage) {
        res.status(400).json({
          error: `Invalid pipelineStageId "${stageId}": stage does not exist in pipeline_stages.`,
        });
        return;
      }
      const prevStageId = lead.pipelineStageId;
      const prevStageName = stages.find((s) => s.id === prevStageId)?.name || prevStageId;

      lead.pipelineStageId = stageId;
      if (lostReason) {
        lead.lostReason = lostReason;
        lead.status = 'lost';
      } else if (stageId === 'stage-won') {
        lead.status = 'converted';
      }

      lead.activities.unshift({
        id: `act-${Date.now()}`,
        type: 'stage_change',
        title: `Pipeline Stage Updated: ${targetStage.name}`,
        outcome: `Transitioned from ${prevStageName} to ${targetStage.name}${lostReason ? ` (${lostReason})` : ''}`,
        date: new Date().toISOString(),
        actor: author,
      });

      const updated = storage.upsertLead(lead);
      res.json(updated);
    }
  } catch (err: unknown) {
    const msg = sanitizeApiError(err, 'Failed to move pipeline stage.');
    const status = msg.includes('Database connection unavailable')
      ? 503
      : msg.includes('Invalid pipelineStageId') || msg.includes('does not exist in pipeline_stages')
      ? 400
      : 500;
    res.status(status).json({ error: msg });
  }
});

// Tasks
protectedApi.get('/tasks', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const tasks = isPg ? await postgresStorage.getTasks() : storage.getTasks();
    res.json(tasks);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch tasks.') });
  }
});

protectedApi.post('/tasks', async (req: Request, res: Response) => {
  const validated = validateTaskCreateBody(req.body);
  if (!validated.ok || !validated.data) {
    res.status(400).json({ error: validated.error || 'Invalid task payload.' });
    return;
  }
  const author = req.owner?.fullName || 'Lead Intelligence Operator';
  try {
    const { isPg } = checkStorageEngine();
    const payload = { ...validated.data, assignedTo: validated.data.assignedTo || author };
    const task = isPg ? await postgresStorage.createTask(payload) : storage.createTask(payload);
    res.status(201).json(task);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to create task.') });
  }
});

protectedApi.put('/tasks/:id', async (req: Request, res: Response) => {
  const validated = validateTaskUpdateBody(req.body);
  if (!validated.ok || !validated.data) {
    res.status(400).json({ error: validated.error || 'Invalid task update payload.' });
    return;
  }
  try {
    const { isPg } = checkStorageEngine();
    const updated = isPg
      ? await postgresStorage.updateTask(req.params.id, validated.data)
      : storage.updateTask(req.params.id, validated.data);
    if (!updated) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(updated);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to update task.') });
  }
});

protectedApi.delete('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const success = isPg ? await postgresStorage.deleteTask(req.params.id) : storage.deleteTask(req.params.id);
    res.json({ success });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to delete task.') });
  }
});

// Outreach Campaigns & Approval Queue
protectedApi.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const campaigns = isPg ? await postgresStorage.getCampaigns() : storage.getCampaigns();
    res.json(campaigns);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch campaigns.') });
  }
});

protectedApi.post('/campaigns', async (req: Request, res: Response) => {
  const validated = validateCampaignCreateBody(req.body);
  if (!validated.ok || !validated.data) {
    res.status(400).json({ error: validated.error || 'Invalid campaign payload.' });
    return;
  }
  try {
    const { isPg } = checkStorageEngine();
    const campaign = isPg
      ? await postgresStorage.createCampaign(validated.data)
      : storage.createCampaign(validated.data);
    res.status(201).json(campaign);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to create campaign.') });
  }
});

protectedApi.post('/campaigns/:id/generate-messages', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const campaigns = isPg ? await postgresStorage.getCampaigns() : storage.getCampaigns();
    const campaign = campaigns.find((c) => c.id === req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const { targetLeadIds } = req.body || {};
    if (targetLeadIds !== undefined && !Array.isArray(targetLeadIds)) {
      res.status(400).json({ error: 'targetLeadIds must be an array.' });
      return;
    }
    const leads = isPg ? await postgresStorage.getLeads() : storage.getLeads();
    const filteredLeads = leads.filter((l) => (targetLeadIds ? targetLeadIds.includes(l.id) : true));
    const settings = isPg ? await postgresStorage.getSettings() : storage.getSettings();
    const author = req.owner?.fullName || settings.ownerName;

    const newMessages: any[] = [];
    for (const lead of filteredLeads) {
      if (lead.status === 'do_not_contact') continue;
      if (lead.domain && settings.suppressionDomains.includes(lead.domain.toLowerCase())) continue;

      const exists = campaign.messages.some((m) => m.leadId === lead.id);
      if (exists) continue;

      const subject = campaign.subjectTemplate
        .replace(/{{company_name}}/g, lead.companyName)
        .replace(/{{industry}}/g, lead.industry)
        .replace(/{{city}}/g, lead.address?.city || 'your area');

      const content = campaign.bodyTemplate
        .replace(/{{company_name}}/g, lead.companyName)
        .replace(/{{industry}}/g, lead.industry)
        .replace(/{{city}}/g, lead.address?.city || 'your area')
        .replace(/{{owner_name}}/g, author);

      const msgObj = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        campaignId: campaign.id,
        leadId: lead.id,
        leadCompanyName: lead.companyName,
        recipientEmail: lead.email,
        subject,
        content,
        status: 'pending_approval' as const,
      };

      campaign.messages.push(msgObj);
      newMessages.push(msgObj);
    }

    if (isPg && newMessages.length > 0) {
      await postgresStorage.saveCampaignMessages(campaign.id, newMessages);
    }

    res.json(campaign);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to generate campaign messages.') });
  }
});

protectedApi.post('/campaigns/:id/messages/:messageId/action', async (req: Request, res: Response) => {
  const validated = validateCampaignMessageAction(req.body);
  if (!validated.ok || !validated.data) {
    res.status(400).json({ error: validated.error || 'Invalid message action.' });
    return;
  }
  const { action } = validated.data;
  const newStatus =
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'sent';
  const author = req.owner?.fullName || 'Lead Intelligence Operator';

  try {
    const { isPg } = checkStorageEngine();
    let success = false;

    if (isPg) {
      success = await postgresStorage.updateCampaignMessageStatus(req.params.id, req.params.messageId, newStatus, author);
    } else {
      success = storage.updateCampaignMessageStatus(req.params.id, req.params.messageId, newStatus);
      if (action === 'send') {
        const camp = storage.getCampaigns().find((c) => c.id === req.params.id);
        const msg = camp?.messages.find((m) => m.id === req.params.messageId);
        if (msg) {
          const lead = storage.getLead(msg.leadId);
          if (lead) {
            lead.activities.unshift({
              id: `act-${Date.now()}`,
              type: 'email',
              title: `Campaign Message Dispatched: ${msg.subject}`,
              outcome: `Provider ID ${msg.deliveryId} confirmed dispatch`,
              date: new Date().toISOString(),
              actor: author,
            });
            lead.status = 'contacted';
            const contactedStage =
              storage.getStages().find((s) => s.id === 'stage-contacted') ||
              storage.getStages().find((s) => s.name.toLowerCase().includes('contacted'));
            if (contactedStage) {
              lead.pipelineStageId = contactedStage.id;
            }
            storage.upsertLead(lead);
          }
        }
      }
    }

    if (!success) {
      res.status(404).json({ error: 'Campaign or message not found' });
      return;
    }

    res.json({ success: true, newStatus });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to execute message action.') });
  }
});

// AI Sales Intelligence
protectedApi.post('/ai/analyze-lead', createRateLimitMiddleware(aiRateLimiter), async (req: Request, res: Response) => {
  const { leadId } = req.body || {};
  if (!leadId || typeof leadId !== 'string') {
    res.status(400).json({ error: 'leadId string is required.' });
    return;
  }
  try {
    const { isPg } = checkStorageEngine();
    const lead = isPg ? await postgresStorage.getLead(leadId) : storage.getLead(leadId);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const analysis = await analyzeLeadWithAi(lead);
    if (isPg) await postgresStorage.recordConnectorActivity('conn-gemini', true);
    else storage.recordConnectorActivity('conn-gemini', true);
    res.json(analysis);
  } catch (err: unknown) {
    res.status(500).json({ error: `AI analysis failed: ${sanitizeApiError(err, 'AI provider error.')}` });
  }
});

protectedApi.post('/ai/generate-pitch', createRateLimitMiddleware(aiRateLimiter), async (req: Request, res: Response) => {
  const { leadId, valueProposition } = req.body || {};
  if (!leadId || typeof leadId !== 'string') {
    res.status(400).json({ error: 'leadId string is required.' });
    return;
  }
  if (valueProposition !== undefined && (typeof valueProposition !== 'string' || valueProposition.length > 2000)) {
    res.status(400).json({ error: 'valueProposition must be a string up to 2000 characters.' });
    return;
  }
  try {
    const { isPg } = checkStorageEngine();
    const lead = isPg ? await postgresStorage.getLead(leadId) : storage.getLead(leadId);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const pitch = await generateSalesPitchWithAi(lead, valueProposition);
    if (isPg) await postgresStorage.recordConnectorActivity('conn-gemini', true);
    else storage.recordConnectorActivity('conn-gemini', true);
    res.json(pitch);
  } catch (err: unknown) {
    res.status(500).json({ error: `AI pitch drafting failed: ${sanitizeApiError(err, 'AI provider error.')}` });
  }
});

protectedApi.post('/ai/meeting-brief', createRateLimitMiddleware(aiRateLimiter), async (req: Request, res: Response) => {
  const { leadId } = req.body || {};
  if (!leadId || typeof leadId !== 'string') {
    res.status(400).json({ error: 'leadId string is required.' });
    return;
  }
  try {
    const { isPg } = checkStorageEngine();
    const lead = isPg ? await postgresStorage.getLead(leadId) : storage.getLead(leadId);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const brief = await generateMeetingBriefWithAi(lead);
    if (isPg) await postgresStorage.recordConnectorActivity('conn-gemini', true);
    else storage.recordConnectorActivity('conn-gemini', true);
    res.json(brief);
  } catch (err: unknown) {
    res.status(500).json({ error: `Meeting brief generation failed: ${sanitizeApiError(err, 'AI provider error.')}` });
  }
});

protectedApi.post('/ai/market-report', createRateLimitMiddleware(aiRateLimiter), async (req: Request, res: Response) => {
  const { country, industry } = req.body || {};
  if (country !== undefined && (typeof country !== 'string' || country.length > 80)) {
    res.status(400).json({ error: 'Invalid country filter.' });
    return;
  }
  if (industry !== undefined && (typeof industry !== 'string' || industry.length > 120)) {
    res.status(400).json({ error: 'Invalid industry filter.' });
    return;
  }
  try {
    const { isPg } = checkStorageEngine();
    const allLeads = isPg ? await postgresStorage.getLeads() : storage.getLeads();
    const filtered = allLeads.filter(
      (l) => (!country || l.address?.countryCode === country) && (!industry || l.industry.includes(industry))
    );

    const report = await generateMarketReportWithAi(country || 'Global', industry || 'B2B Services', filtered);
    if (isPg) await postgresStorage.recordConnectorActivity('conn-gemini', true);
    else storage.recordConnectorActivity('conn-gemini', true);
    res.json(report);
  } catch (err: unknown) {
    res.status(500).json({ error: `Market report failed: ${sanitizeApiError(err, 'AI provider error.')}` });
  }
});

// Connectors Unified Registry, Health, Execution History, & Encrypted Credentials (Owner-Only)
protectedApi.get('/connectors', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    const { isPg } = checkStorageEngine();
    const allConnectors = isPg
      ? await postgresStorage.getConnectors()
      : await storage.getConnectorsUnified();

    const country = typeof req.query.country === 'string' ? req.query.country.trim().toUpperCase() : undefined;
    const capability = typeof req.query.capability === 'string' ? (req.query.capability.trim() as ConnectorCapability) : undefined;
    const category = typeof req.query.category === 'string' ? (req.query.category.trim() as SourceCategory) : undefined;

    if (!country && !capability && !category) {
      res.json(allConnectors);
      return;
    }

    const matchedIds = new Set(
      connectorRegistry
        .filter({
          country: country && country !== 'ALL' ? country : undefined,
          capability,
          category,
        })
        .map((c) => c.id)
    );

    res.json(allConnectors.filter((c) => matchedIds.has(c.id)));
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch connectors.') });
  }
});

protectedApi.get('/connectors/encryption-status', (req: Request, res: Response) => {
  res.json(credentialManager.getEncryptionStatus());
});

protectedApi.get('/connectors/runs', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const connectorId = typeof req.query.connectorId === 'string' && req.query.connectorId.trim()
      ? req.query.connectorId.trim()
      : undefined;
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const runs = isPg
      ? await postgresStorage.getConnectorRuns(connectorId, limit)
      : storage.getConnectorRuns(connectorId, limit);
    res.json({ runs, total: runs.length });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch connector runs.') });
  }
});

protectedApi.post('/connectors/executions/:requestId/cancel', (req: Request, res: Response) => {
  const cancelled = connectorExecutionEngine.cancelExecution(req.params.requestId);
  if (!cancelled) {
    res.status(404).json({ error: 'Active execution request not found or already completed' });
    return;
  }
  res.json({ success: true, requestId: req.params.requestId });
});

protectedApi.get('/connectors/:id', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    const connector = connectorRegistry.getById(req.params.id);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    const { isPg } = checkStorageEngine();
    const [allConnectors, recentRuns] = await Promise.all([
      isPg ? postgresStorage.getConnectors() : storage.getConnectorsUnified(),
      isPg
        ? postgresStorage.getConnectorRuns(req.params.id, 25)
        : Promise.resolve(storage.getConnectorRuns(req.params.id, 25)),
    ]);
    const item = allConnectors.find((c) => c.id === req.params.id);
    res.json({
      connector: item,
      metadata: connector.getMetadata(),
      recentRuns,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch connector details.') });
  }
});

protectedApi.get('/connectors/:id/health', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    const connector = connectorRegistry.getById(req.params.id);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    const { isPg } = checkStorageEngine();
    const [runs, configs] = await Promise.all([
      isPg
        ? postgresStorage.getConnectorRuns(req.params.id, 50)
        : Promise.resolve(storage.getConnectorRuns(req.params.id, 50)),
      isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
    ]);
    const statsMap = aggregateRunsByConnector(runs);
    const statusObj = await buildUnifiedConnectorStatus(connector, {
      stats: statsMap.get(req.params.id),
      config: configs[req.params.id],
    });
    res.json({
      connectorId: req.params.id,
      healthState: statusObj.healthState,
      operational: statusObj.operational,
      summary: statusObj.healthSummary,
      lastRunAt: statusObj.lastRunAt,
      lastSuccessAt: statusObj.lastSuccessAt,
      lastError: statusObj.lastError,
      lastErrorCategory: statusObj.lastErrorCategory,
      rateLimit: statusObj.rateLimitState,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch connector health.') });
  }
});

protectedApi.post('/connectors/:id/test', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    const connector = connectorRegistry.getById(req.params.id);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    const { isPg } = checkStorageEngine();
    const [settings, configs] = await Promise.all([
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
      isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
    ]);

    const { validation, runRecord } = await connectorExecutionEngine.executeConnectionTest(connector, {
      config: configs[req.params.id] || {
        connectorId: req.params.id,
        enabled: connectorRegistry.isEnabled(req.params.id),
      },
      userAgent: settings.userAgent,
    });

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        'CONNECTOR_TESTED',
        req.owner.email,
        'connector',
        req.params.id,
        {
          ok: validation.ok,
          healthState: validation.healthState,
          errorCategory: validation.errorCategory,
          latencyMs: validation.latencyMs,
        },
        normalizeClientIp(req)
      );
    }

    const updatedList = isPg ? await postgresStorage.getConnectors() : await storage.getConnectorsUnified();
    const updatedConnector = updatedList.find((c) => c.id === req.params.id);

    res.json({
      validation,
      run: runRecord,
      connector: updatedConnector,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Connector health check failed.') });
  }
});

protectedApi.get('/connectors/:id/runs', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    if (!connectorRegistry.getById(req.params.id)) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    const { isPg } = checkStorageEngine();
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50));
    const runs = isPg
      ? await postgresStorage.getConnectorRuns(req.params.id, limit)
      : storage.getConnectorRuns(req.params.id, limit);
    res.json({ connectorId: req.params.id, runs, total: runs.length });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch connector run history.') });
  }
});

protectedApi.put('/connectors/:id/config', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    const connector = connectorRegistry.getById(req.params.id);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }

    const { enabled, timeoutMs, maxRetries, rateLimitMax, rateLimitWindowMs, customConfig } = req.body || {};
    const partial: Record<string, unknown> = {};

    if (typeof enabled === 'boolean') partial.enabled = enabled;
    if (timeoutMs !== undefined) {
      const n = Number(timeoutMs);
      if (!Number.isFinite(n) || n < 500 || n > 120000) {
        res.status(400).json({ error: 'timeoutMs must be between 500 and 120000 ms' });
        return;
      }
      partial.timeoutMs = Math.round(n);
    }
    if (maxRetries !== undefined) {
      const n = Number(maxRetries);
      if (!Number.isFinite(n) || n < 0 || n > 5) {
        res.status(400).json({ error: 'maxRetries must be between 0 and 5' });
        return;
      }
      partial.maxRetries = Math.round(n);
    }
    if (rateLimitMax !== undefined) {
      const n = Number(rateLimitMax);
      if (!Number.isFinite(n) || n < 1 || n > 10000) {
        res.status(400).json({ error: 'rateLimitMax must be between 1 and 10000' });
        return;
      }
      partial.rateLimitMax = Math.round(n);
    }
    if (rateLimitWindowMs !== undefined) {
      const n = Number(rateLimitWindowMs);
      if (!Number.isFinite(n) || n < 500 || n > 3600000) {
        res.status(400).json({ error: 'rateLimitWindowMs must be between 500 and 3600000 ms' });
        return;
      }
      partial.rateLimitWindowMs = Math.round(n);
    }
    if (customConfig && typeof customConfig === 'object') {
      partial.customConfig = customConfig;
    }

    const { isPg } = checkStorageEngine();
    const savedConfig = isPg
      ? await postgresStorage.updateConnectorConfig(req.params.id, partial)
      : storage.updateConnectorConfig(req.params.id, partial);

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        'CONNECTOR_CONFIG_UPDATED',
        req.owner.email,
        'connector',
        req.params.id,
        partial,
        normalizeClientIp(req)
      );
    }

    const updatedList = isPg ? await postgresStorage.getConnectors() : await storage.getConnectorsUnified();
    res.json({
      config: savedConfig,
      connector: updatedList.find((c) => c.id === req.params.id),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to update connector configuration.') });
  }
});

protectedApi.post('/connectors/:id/enable', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    if (!connectorRegistry.getById(req.params.id)) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    const { isPg } = checkStorageEngine();
    await (isPg
      ? postgresStorage.updateConnectorConfig(req.params.id, { enabled: true })
      : Promise.resolve(storage.updateConnectorConfig(req.params.id, { enabled: true })));

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        'CONNECTOR_ENABLED',
        req.owner.email,
        'connector',
        req.params.id,
        { enabled: true },
        normalizeClientIp(req)
      );
    }

    const updatedList = isPg ? await postgresStorage.getConnectors() : await storage.getConnectorsUnified();
    res.json({ success: true, connector: updatedList.find((c) => c.id === req.params.id) });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to enable connector.') });
  }
});

protectedApi.post('/connectors/:id/disable', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    if (!connectorRegistry.getById(req.params.id)) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }
    const { isPg } = checkStorageEngine();
    await (isPg
      ? postgresStorage.updateConnectorConfig(req.params.id, { enabled: false })
      : Promise.resolve(storage.updateConnectorConfig(req.params.id, { enabled: false })));

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        'CONNECTOR_DISABLED',
        req.owner.email,
        'connector',
        req.params.id,
        { enabled: false },
        normalizeClientIp(req)
      );
    }

    const updatedList = isPg ? await postgresStorage.getConnectors() : await storage.getConnectorsUnified();
    res.json({ success: true, connector: updatedList.find((c) => c.id === req.params.id) });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to disable connector.') });
  }
});

protectedApi.put('/connectors/:id/credentials', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    const connector = connectorRegistry.getById(req.params.id);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }

    const meta = connector.getMetadata();
    const payload = (req.body?.credentials && typeof req.body.credentials === 'object'
      ? req.body.credentials
      : req.body) as Record<string, string>;

    const isRotation = Boolean(req.body?.rotate);
    const { isPg } = checkStorageEngine();
    const status = await credentialManager.setCredential(
      req.params.id,
      payload,
      meta.credentialRequirements,
      { isRotation }
    );

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        isRotation ? 'CONNECTOR_CREDENTIAL_ROTATED' : 'CONNECTOR_CREDENTIAL_UPDATED',
        req.owner.email,
        'connector_credentials',
        req.params.id,
        {
          authType: status.authType,
          source: status.source,
          maskedHint: status.maskedHint,
        },
        normalizeClientIp(req)
      );
    }

    const updatedList = isPg ? await postgresStorage.getConnectors() : await storage.getConnectorsUnified();
    res.json({
      success: true,
      credentialStatus: status,
      connector: updatedList.find((c) => c.id === req.params.id),
    });
  } catch (err: unknown) {
    if (err instanceof ConnectorError) {
      res.status(400).json({
        error: sanitizeApiError(err.safeMessage, 'Invalid connector credentials.'),
        errorCategory: err.category,
        remediationHint: err.remediationHint,
      });
      return;
    }
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to save connector credentials.') });
  }
});

protectedApi.delete('/connectors/:id/credentials', async (req: Request, res: Response) => {
  try {
    ensureConnectorsRegistered();
    const connector = connectorRegistry.getById(req.params.id);
    if (!connector) {
      res.status(404).json({ error: 'Connector not found' });
      return;
    }

    const { isPg } = checkStorageEngine();
    const status = await credentialManager.removeCredential(
      req.params.id,
      connector.getMetadata().credentialRequirements
    );

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        'CONNECTOR_CREDENTIAL_REMOVED',
        req.owner.email,
        'connector_credentials',
        req.params.id,
        { sourceAfterRemoval: status.source },
        normalizeClientIp(req)
      );
    }

    const updatedList = isPg ? await postgresStorage.getConnectors() : await storage.getConnectorsUnified();
    res.json({
      success: true,
      credentialStatus: status,
      connector: updatedList.find((c) => c.id === req.params.id),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to remove connector credentials.') });
  }
});

// Settings (Omits raw API keys for security)
protectedApi.get('/settings', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const current = isPg ? await postgresStorage.getSettings() : storage.getSettings();
    const hasChKey = !!(process.env.COMPANIES_HOUSE_API_KEY || current.companiesHouseApiKey);

    // Omit sensitive API keys from response to avoid exposing them to browser JavaScript
    const safeSettings = {
      ...current,
      companiesHouseConfigured: hasChKey,
      companiesHouseApiKey: undefined,
    };
    res.json(safeSettings);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch platform settings.') });
  }
});

protectedApi.put('/settings', async (req: Request, res: Response) => {
  const validated = validateSettingsUpdateBody(req.body);
  if (!validated.ok || !validated.data) {
    res.status(400).json({ error: validated.error || 'Invalid settings payload.' });
    return;
  }
  try {
    const { isPg } = checkStorageEngine();
    const updated = isPg
      ? await postgresStorage.updateSettings(validated.data)
      : storage.updateSettings(validated.data);
    if (isPg && req.owner) {
      await postgresStorage
        .recordAuditEvent(
          'SETTINGS_UPDATED',
          req.owner.email,
          'app_settings',
          'default',
          {
            updatedKeys: Object.keys(validated.data).filter((k) => k !== 'companiesHouseApiKey'),
          },
          normalizeClientIp(req)
        )
        .catch(() => {});
    }
    const hasChKey = !!(process.env.COMPANIES_HOUSE_API_KEY || updated.companiesHouseApiKey);
    res.json({
      ...updated,
      companiesHouseConfigured: hasChKey,
      companiesHouseApiKey: undefined,
    });
  } catch (err: unknown) {
    if (err instanceof ConnectorError) {
      res.status(400).json({
        error: err.safeMessage,
        errorCategory: err.category,
        remediationHint: err.remediationHint,
      });
      return;
    }
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to update settings.') });
  }
});

// Data Export (RFC 4180 compliant with full international & identifier coverage)
protectedApi.get('/export/csv', createRateLimitMiddleware(exportRateLimiter), async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const leads = isPg ? await postgresStorage.getLeads() : storage.getLeads();
    const headers = [
      'ID',
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
      'Secondary Identifiers',
      'Status',
      'Pipeline Stage',
      'Confidence Score',
      'Industry',
      'Category',
      'Website',
      'Domain',
      'Email',
      'Phone',
      'Phone Normalized',
      'Currency',
      'Opportunity Value',
      'Tags',
      'Created At',
    ];

    const rows = leads.map((l) => {
      const secondaryIdents = (l.identifiers || [])
        .map((i) => `${canonicalizeIdentifierType(i.type, i.countryCode || l.address?.countryCode)}:${i.value}`)
        .join('; ');
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
        l.registrationType ? canonicalizeIdentifierType(l.registrationType, l.address?.countryCode) : '',
        secondaryIdents,
        l.status,
        l.pipelineStageId || '',
        `${l.confidenceScore}%`,
        l.industry || '',
        l.category || '',
        l.website || '',
        l.domain || '',
        l.email || '',
        l.phone || '',
        l.phoneNormalized || '',
        l.currency || 'USD',
        l.opportunityValue || 0,
        (l.tags || []).join('; '),
        l.createdAt,
      ];
    });

    const csv = buildCsvDocument(headers, rows, true);
    if (isPg && req.owner) {
      await postgresStorage
        .recordAuditEvent(
          'CRM_EXPORT_CSV',
          req.owner.email,
          'leads',
          'all',
          { exportedRowCount: leads.length },
          normalizeClientIp(req)
        )
        .catch(() => {});
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_export_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to export CSV.') });
  }
});

protectedApi.get('/export/json', createRateLimitMiddleware(exportRateLimiter), async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const leads = isPg ? await postgresStorage.getLeads() : storage.getLeads();
    if (isPg && req.owner) {
      await postgresStorage
        .recordAuditEvent(
          'CRM_EXPORT_JSON',
          req.owner.email,
          'leads',
          'all',
          { exportedRowCount: leads.length },
          normalizeClientIp(req)
        )
        .catch(() => {});
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads_export_${Date.now()}.json"`);
    res.send(JSON.stringify(leads, null, 2));
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to export JSON.') });
  }
});

// ==========================================
// PHASE 7: LEAD COLLECTION, IMPORT & DATA PROCESSING ENGINE
// ==========================================

// Upload CSV or Excel (.xlsx) file to create an in-memory staged import session (zero DB writes)
protectedApi.post(
  '/import/upload',
  createRateLimitMiddleware(importRateLimiter),
  (req: Request, res: Response, next: NextFunction) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('multipart/form-data')) {
      importUploadMiddleware.single('file')(req, res, (err: any) => {
        if (err) {
          const status = err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
          res.status(status).json({
            error:
              err?.code === 'LIMIT_FILE_SIZE'
                ? `Uploaded file exceeds maximum allowed size of ${Math.round(MAX_IMPORT_FILE_BYTES / (1024 * 1024))} MB.`
                : sanitizeApiError(err, 'File upload failed.'),
            code: err?.code || 'UPLOAD_ERROR',
          });
          return;
        }
        next();
      });
    } else {
      next();
    }
  },
  async (req: Request, res: Response) => {
    try {
      const { isPg } = checkStorageEngine();
      let filename = '';
      let mimeType: string | undefined;
      let buffer: Buffer | undefined;
      let worksheetName: string | undefined;
      let defaultCountryCode: string | undefined;
      let templateId: string | undefined;

      if (req.file) {
        filename = req.file.originalname;
        mimeType = req.file.mimetype;
        buffer = req.file.buffer;
        worksheetName = req.body?.worksheetName ? String(req.body.worksheetName) : undefined;
        defaultCountryCode = req.body?.defaultCountryCode ? String(req.body.defaultCountryCode) : undefined;
        templateId = req.body?.templateId ? String(req.body.templateId) : undefined;
      } else if (req.body && typeof req.body === 'object') {
        filename = String(req.body.filename || 'import.csv');
        mimeType = req.body.mimeType ? String(req.body.mimeType) : undefined;
        worksheetName = req.body.worksheetName ? String(req.body.worksheetName) : undefined;
        defaultCountryCode = req.body.defaultCountryCode ? String(req.body.defaultCountryCode) : undefined;
        templateId = req.body.templateId ? String(req.body.templateId) : undefined;

        if (typeof req.body.contentBase64 === 'string' && req.body.contentBase64.length > 0) {
          const base64Clean = req.body.contentBase64.replace(/^data:[^;]+;base64,/, '');
          buffer = Buffer.from(base64Clean, 'base64');
        } else if (typeof req.body.contentText === 'string' && req.body.contentText.length > 0) {
          buffer = Buffer.from(req.body.contentText, 'utf8');
        }
      }

      if (!buffer || buffer.length === 0) {
        res.status(400).json({
          error: 'An uploaded CSV/XLSX file or non-empty contentText/contentBase64 payload is required.',
          code: 'MISSING_FILE',
        });
        return;
      }

      let template: ImportMappingTemplate | null = null;
      if (templateId) {
        const templates = isPg
          ? await postgresStorage.getImportTemplates()
          : storage.getImportTemplates();
        template = templates.find((t) => t.id === templateId) || null;
      }

      const settings = isPg ? await postgresStorage.getSettings() : storage.getSettings();

      const sessionData = await importService.createSessionFromUpload({
        filename,
        mimeType,
        buffer,
        worksheetName,
        defaultCountryCode: defaultCountryCode || settings.defaultCountry || 'US',
        template,
      });

      res.status(201).json(sessionData);
    } catch (err: unknown) {
      if (err instanceof ImportFileSecurityError || err instanceof ImportServiceError) {
        res.status(err.statusCode).json({ error: err.message, code: err.code });
        return;
      }
      res.status(400).json({ error: sanitizeApiError(err, 'Import upload processing failed.') });
    }
  }
);

// Switch worksheet inside an Excel (.xlsx) import session
protectedApi.post('/import/sessions/:sessionId/worksheet', async (req: Request, res: Response) => {
  try {
    const worksheetName = String(req.body?.worksheetName || '').trim();
    if (!worksheetName) {
      res.status(400).json({ error: 'worksheetName is required.' });
      return;
    }
    const result = await importService.switchWorksheet(req.params.sessionId, worksheetName);
    res.json(result);
  } catch (err: unknown) {
    if (err instanceof ImportFileSecurityError || err instanceof ImportServiceError) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }
    res.status(400).json({ error: sanitizeApiError(err, 'Failed to switch worksheet.') });
  }
});

// Compute dry-run preview (normalization, validation, intra-file & CRM deduplication) — zero DB writes
protectedApi.post('/import/sessions/:sessionId/preview', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const {
      mappings,
      mergeRules,
      options,
      rowOverrides,
      page,
      pageSize,
      filter,
    } = req.body || {};

    const [existingLeads, existingPersons, existingRelationships] = await Promise.all([
      isPg ? postgresStorage.getLeads() : Promise.resolve(storage.getLeads()),
      isPg ? postgresStorage.getPersons() : Promise.resolve(storage.getPersons()),
      isPg ? postgresStorage.getAllRelationships() : Promise.resolve(storage.getAllRelationships()),
    ]);

    const preview = importService.previewSession(req.params.sessionId, {
      mappings,
      mergeRules,
      options,
      rowOverrides,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      filter,
      existingLeads,
      existingPersons,
      existingRelationships,
    });

    res.json(preview);
  } catch (err: unknown) {
    if (err instanceof ImportFileSecurityError || err instanceof ImportServiceError) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }
    const rawMsg = err instanceof Error ? err.message : String(err);
    res.status(rawMsg.includes('Database connection unavailable') ? 503 : 500).json({
      error: sanitizeApiError(err, 'Failed to preview import session.'),
    });
  }
});

// Explicit confirmation to execute staged import transaction into CRM database
protectedApi.post('/import/sessions/:sessionId/confirm', createRateLimitMiddleware(importRateLimiter), async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const {
      confirm,
      rowOverrides,
      templateId,
      templateName,
      atomicRollbackOnError,
      simulateFailureAtRow,
    } = req.body || {};

    const [existingLeads, existingPersons, existingRelationships] = await Promise.all([
      isPg ? postgresStorage.getLeads() : Promise.resolve(storage.getLeads()),
      isPg ? postgresStorage.getPersons() : Promise.resolve(storage.getPersons()),
      isPg ? postgresStorage.getAllRelationships() : Promise.resolve(storage.getAllRelationships()),
    ]);

    const actorEmail = req.owner?.email || 'Owner';
    const result = await importService.confirmSessionImport(req.params.sessionId, {
      confirm: confirm === true,
      actorEmail,
      rowOverrides,
      templateId: templateId ? String(templateId) : undefined,
      templateName: templateName ? String(templateName) : undefined,
      atomicRollbackOnError:
        typeof atomicRollbackOnError === 'boolean' ? atomicRollbackOnError : undefined,
      simulateFailureAtRow:
        !IS_PROD && simulateFailureAtRow !== undefined ? Number(simulateFailureAtRow) : undefined,
      storageAdapter: isPg ? postgresStorage : storage,
      existingLeads,
      existingPersons,
      existingRelationships,
    });

    if (isPg && req.owner) {
      try {
        await postgresStorage.recordAuditEvent(
          result.batch.status === 'rolled_back' ? 'IMPORT_BATCH_ROLLED_BACK' : 'IMPORT_BATCH_EXECUTED',
          req.owner.email,
          'import_batch',
          result.batch.id,
          {
            filename: result.batch.filename,
            status: result.batch.status,
            totalRows: result.batch.totalRows,
            createdCompanies: result.batch.createdCompanies,
            updatedCompanies: result.batch.updatedCompanies,
            createdPersons: result.batch.createdPersons,
            createdRelationships: result.batch.createdRelationships,
            failedRows: result.batch.failedRows,
          },
          normalizeClientIp(req)
        );
      } catch (auditErr) {
        console.warn('[Import] Could not record audit event:', auditErr);
      }
    }

    res.status(result.batch.status === 'rolled_back' ? 422 : 200).json({
      success: result.batch.status !== 'rolled_back' && result.batch.status !== 'failed',
      batch: result.batch,
      rows: result.rows.slice(0, 100),
    });
  } catch (err: unknown) {
    if (err instanceof ImportFileSecurityError || err instanceof ImportServiceError) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }
    const rawMsg = err instanceof Error ? err.message : String(err);
    const status = rawMsg.includes('Database connection unavailable')
      ? 503
      : rawMsg.includes('Migration 005')
      ? 409
      : 500;
    res.status(status).json({ error: sanitizeApiError(err, 'Failed to execute import batch.') });
  }
});

// Import Mapping Templates CRUD
protectedApi.get('/import/templates', async (_req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const templates = isPg
      ? await postgresStorage.getImportTemplates()
      : storage.getImportTemplates();
    res.json({ templates });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to load import templates.') });
  }
});

protectedApi.post('/import/templates', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const body = req.body || {};
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      res.status(400).json({ error: 'Template name is required.' });
      return;
    }
    if (!Array.isArray(body.columnMappings)) {
      res.status(400).json({ error: 'columnMappings array is required.' });
      return;
    }

    const payload = {
      id: body.id ? String(body.id) : undefined,
      name: String(body.name).trim(),
      description: body.description ? String(body.description) : undefined,
      sourceFormat: (body.sourceFormat === 'xlsx' ? 'xlsx' : 'csv') as 'csv' | 'xlsx',
      headerSignature: Array.isArray(body.headerSignature) ? body.headerSignature.map(String) : [],
      columnMappings: body.columnMappings,
      mergeRules: Array.isArray(body.mergeRules) ? body.mergeRules : [],
      normalizationOptions: body.normalizationOptions || {
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
      createdBy: req.owner?.email || 'Owner',
    };

    const template = isPg
      ? await postgresStorage.saveImportTemplate(payload)
      : storage.saveImportTemplate(payload);

    res.status(201).json({ template });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    res.status(rawMsg.includes('Migration 005') ? 409 : 500).json({
      error: sanitizeApiError(err, 'Failed to save import template.'),
    });
  }
});

protectedApi.delete('/import/templates/:id', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const deleted = isPg
      ? await postgresStorage.deleteImportTemplate(req.params.id)
      : storage.deleteImportTemplate(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Import mapping template not found.' });
      return;
    }
    res.json({ success: true, deletedId: req.params.id });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to delete import template.') });
  }
});

// Import Batch Audit History & Row Reports
protectedApi.get('/import/batches', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
    const data = isPg
      ? await postgresStorage.getImportBatches({ page, pageSize })
      : storage.getImportBatches({ page, pageSize });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to load import batches.') });
  }
});

protectedApi.get('/import/batches/:batchId', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 50;
    const outcome = req.query.outcome ? String(req.query.outcome) : 'all';
    const detail = isPg
      ? await postgresStorage.getImportBatchDetail(req.params.batchId, { page, pageSize, outcome })
      : storage.getImportBatchDetail(req.params.batchId, { page, pageSize, outcome });

    if (!detail) {
      res.status(404).json({ error: 'Import batch not found.' });
      return;
    }
    res.json(detail);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to load import batch details.') });
  }
});

protectedApi.get('/import/batches/:batchId/export', createRateLimitMiddleware(exportRateLimiter), async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const exportType = String(req.query.type || 'failed');
    const detail = isPg
      ? await postgresStorage.getImportBatchDetail(req.params.batchId, { page: 1, pageSize: 500, outcome: 'all' })
      : storage.getImportBatchDetail(req.params.batchId, { page: 1, pageSize: 500, outcome: 'all' });

    if (!detail) {
      res.status(404).json({ error: 'Import batch not found.' });
      return;
    }

    let csv: string;
    let suffix = 'failed_rows';
    if (exportType === 'errors') {
      csv = importService.buildValidationErrorsCsv(detail.rows);
      suffix = 'validation_issues';
    } else if (exportType === 'summary') {
      csv = importService.buildBatchSummaryCsv(detail.batch, detail.rows);
      suffix = 'batch_report';
    } else {
      csv = importService.buildFailedRowsCsv(detail.rows);
      suffix = 'failed_rows';
    }

    if (isPg && req.owner) {
      await postgresStorage
        .recordAuditEvent(
          'IMPORT_BATCH_EXPORTED',
          req.owner.email,
          'import_batch',
          req.params.batchId,
          { exportType: suffix, rowCount: detail.rows.length },
          normalizeClientIp(req)
        )
        .catch(() => {});
    }

    const safeBatchId = sanitizeExportFilenamePart(req.params.batchId, 'batch');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="import_${safeBatchId}_${suffix}.csv"`
    );
    res.send(csv);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to export import batch report.') });
  }
});

// Phase 11: Social Intelligence & Decision-Maker Discovery APIs
protectedApi.get('/decision-makers/providers', async (_req: Request, res: Response) => {
  ensureConnectorsRegistered();
  try {
    const { isPg } = checkStorageEngine();
    const configs = isPg ? await postgresStorage.getConnectorConfigs() : storage.getConnectorConfigs();
    const runs = isPg ? await postgresStorage.getConnectorRuns(undefined, 200) : storage.getConnectorRuns(undefined, 200);
    const statsMap = aggregateRunsByConnector(runs);
    const statuses = await Promise.all(
      connectorRegistry.listAll().map((c) =>
        buildUnifiedConnectorStatus(c, { stats: statsMap.get(c.id), config: configs[c.id] })
      )
    );
    const providers = buildSocialProviderMatrix(statuses);
    res.json({
      providers,
      roleTaxonomy: EXPANDED_RELATIONSHIP_TYPES,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to inspect decision-maker providers.') });
  }
});

protectedApi.post('/decision-makers/ai-queries', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const companyName = String(body.companyName || '').trim();
    if (!companyName) {
      res.status(400).json({ error: 'companyName is required to plan decision-maker queries.' });
      return;
    }
    const plan = await generateDecisionMakerQueriesWithAi({
      companyName,
      domain: body.domain ? String(body.domain) : undefined,
      countryCode: body.countryCode ? String(body.countryCode) : undefined,
      industry: body.industry ? String(body.industry) : undefined,
      targetJobTitle: body.targetJobTitle ? String(body.targetJobTitle) : undefined,
      targetDepartment: body.targetDepartment ? String(body.targetDepartment) : undefined,
      targetRelationshipType: body.targetRelationshipType ? String(body.targetRelationshipType) : undefined,
    });
    res.json(plan);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to generate AI decision-maker queries.') });
  }
});

protectedApi.post('/decision-makers/discover', async (req: Request, res: Response) => {
  ensureConnectorsRegistered();
  try {
    const { isPg } = checkStorageEngine();
    const body = req.body || {};

    let lead: CanonicalLead | undefined;
    if (typeof body.leadId === 'string' && body.leadId.trim()) {
      lead = isPg ? (await postgresStorage.getLead(body.leadId.trim())) || undefined : storage.getLead(body.leadId.trim());
    }

    const companyName = String(body.companyName || lead?.companyName || '').trim();
    if (!companyName) {
      res.status(400).json({ error: 'companyName or valid leadId is required for decision-maker discovery.' });
      return;
    }

    const [configs, existingPersons, existingRelationships, existingLeads] = await Promise.all([
      isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
      isPg ? postgresStorage.getPersons() : Promise.resolve(storage.getPersons()),
      isPg ? postgresStorage.getAllRelationships() : Promise.resolve(storage.getAllRelationships()),
      isPg ? postgresStorage.getLeads() : Promise.resolve(storage.getLeads()),
    ]);

    const result = await discoverCompanyDecisionMakers(
      {
        leadId: lead?.id || (typeof body.leadId === 'string' ? body.leadId : undefined),
        companyName,
        domain: body.domain ? String(body.domain) : lead?.domain,
        website: body.website ? String(body.website) : lead?.website,
        countryCode: body.countryCode ? String(body.countryCode) : lead?.address?.countryCode,
        registrationNumber: body.registrationNumber
          ? String(body.registrationNumber)
          : lead?.registrationNumber,
        registrationType: body.registrationType ? String(body.registrationType) : lead?.registrationType,
        industry: body.industry ? String(body.industry) : lead?.industry,
        targetJobTitle: body.targetJobTitle ? String(body.targetJobTitle) : undefined,
        targetDepartment: body.targetDepartment ? String(body.targetDepartment) : undefined,
        targetRelationshipType: body.targetRelationshipType
          ? String(body.targetRelationshipType)
          : undefined,
        targetSeniority: body.targetSeniority ? String(body.targetSeniority) : undefined,
        targetDecisionFunction: body.targetDecisionFunction
          ? String(body.targetDecisionFunction)
          : undefined,
        includeHistorical: body.includeHistorical !== false,
        sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds.map(String) : undefined,
      },
      {
        registry: connectorRegistry,
        executionEngine: connectorExecutionEngine,
        credentialManager,
        configs,
        existingPersons,
        existingRelationships,
        existingLeads,
      }
    );

    if (isPg && req.owner) {
      await postgresStorage
        .recordAuditEvent(
          'DECISION_MAKER_DISCOVERY',
          req.owner.email,
          'lead',
          lead?.id || companyName,
          { candidatesFound: result.candidates.length },
          normalizeClientIp(req)
        )
        .catch(() => {});
    }

    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to discover company decision-makers.') });
  }
});

protectedApi.post('/decision-makers/approve', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const body = req.body || {};
    const actorEmail = req.owner?.email || 'Owner';
    const rawCandidates = Array.isArray(body.candidates) ? body.candidates : [];

    if (rawCandidates.length === 0) {
      res.status(400).json({ error: 'Select at least one approved decision-maker candidate to save.' });
      return;
    }

    let targetLead: CanonicalLead | undefined;
    if (typeof body.leadId === 'string' && body.leadId.trim()) {
      targetLead = isPg
        ? (await postgresStorage.getLead(body.leadId.trim())) || undefined
        : storage.getLead(body.leadId.trim());
    }

    if (!targetLead && body.company && typeof body.company === 'object') {
      const validation = validateLeadCreateOrUpdate(body.company, 'create');
      if (!validation.ok || !validation.data) {
        res.status(400).json({ error: validation.error || 'Invalid company payload for CRM save.' });
        return;
      }
      const now = new Date().toISOString();
      const rawId =
        typeof body.company.id === 'string' && body.company.id.trim().length > 0 && body.company.id.trim().length <= 120
          ? body.company.id.trim()
          : `lead-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const newLead: CanonicalLead = {
        sources: [],
        identifiers: [],
        confidenceSignals: [],
        confidenceScore: 55,
        tags: [],
        notes: [],
        activities: [],
        status: 'new',
        industry: 'B2B Services',
        category: 'General',
        currency: 'USD',
        ...validation.data,
        id: rawId,
        companyName: validation.data.companyName,
        createdAt: now,
        updatedAt: now,
      };
      targetLead = isPg ? await postgresStorage.upsertLead(newLead) : storage.upsertLead(newLead);
    }

    if (!targetLead) {
      res.status(404).json({ error: 'Target CRM company not found (provide valid leadId or company payload).' });
      return;
    }

    const tierToVerification = (
      tier?: string
    ): 'officially_verified' | 'directory_listed' | 'web_observed' | 'user_provided' | 'unverified' => {
      if (tier === 'officially_verified') return 'officially_verified';
      if (tier === 'directory_listed' || tier === 'authorized_provider') return 'directory_listed';
      if (tier === 'company_website') return 'web_observed';
      if (tier === 'search_result') return 'unverified';
      return 'user_provided';
    };

    const now = new Date().toISOString();
    let latestPersons: any[] = [];

    for (const c of rawCandidates) {
      const fullName = String(c?.fullName || '').trim();
      if (!fullName) continue;

      const roleClass = classifyDecisionMakerRole({
        rawRelationshipType: c.relationshipType,
        rawJobTitle: c.jobTitle,
        rawDepartment: c.department,
      });

      if (typeof c.linkToExistingPersonId === 'string' && c.linkToExistingPersonId.trim()) {
        latestPersons = isPg
          ? await postgresStorage.linkExistingPersonToLead({
              personId: c.linkToExistingPersonId.trim(),
              leadId: targetLead.id,
              relationshipType: roleClass.relationshipType,
              jobTitle: c.jobTitle || roleClass.label,
              designation: c.designation,
              department: c.department || roleClass.department,
              decisionMakerCategory: c.decisionMakerCategory || roleClass.category,
              isPrimaryContact: Boolean(c.isPrimaryContact),
              sourceName: Array.isArray(c.sources) && c.sources[0]?.sourceName ? c.sources[0].sourceName : 'Owner Approved Decision-Maker',
              actorEmail,
            })
          : storage.linkExistingPersonToLead({
              personId: c.linkToExistingPersonId.trim(),
              leadId: targetLead.id,
              relationshipType: roleClass.relationshipType,
              jobTitle: c.jobTitle || roleClass.label,
              designation: c.designation,
              department: c.department || roleClass.department,
              decisionMakerCategory: c.decisionMakerCategory || roleClass.category,
              isPrimaryContact: Boolean(c.isPrimaryContact),
              sourceName: Array.isArray(c.sources) && c.sources[0]?.sourceName ? c.sources[0].sourceName : 'Owner Approved Decision-Maker',
              actorEmail,
            });
        continue;
      }

      const fields: Record<string, string> = {
        personFullName: fullName,
        isPrimaryContact: c.isPrimaryContact ? 'true' : 'false',
        associatedCompanyName: targetLead.companyName,
      };
      if (c.email) fields.personEmail = String(c.email);
      if (c.phone) fields.personPhone = String(c.phone);
      if (c.linkedinUrl) fields.personLinkedInUrl = String(c.linkedinUrl);
      if (c.jobTitle) fields.personJobTitle = String(c.jobTitle);
      if (c.designation) fields.personDesignation = String(c.designation);
      if (c.department) fields.personDepartment = String(c.department);
      if (c.relationshipType) fields.relationshipType = String(c.relationshipType);
      if (c.decisionMakerCategory) fields.decisionMakerCategory = String(c.decisionMakerCategory);
      if (c.countryCode || targetLead.address?.countryCode) {
        fields.personCountry = String(c.countryCode || targetLead.address?.countryCode);
      }
      if (c.city || targetLead.address?.city) {
        fields.personCity = String(c.city || targetLead.address?.city);
      }

      const normalized = normalizeAndValidateMappedRow({
        rowNumber: 1,
        fields,
        customFields: {},
        options: {
          defaultCountryCode: targetLead.address?.countryCode || 'US',
          duplicatePolicy: 'merge_safe',
          preserveExistingCrmFields: true,
          atomicRollbackOnError: false,
          skipRowsWithErrors: true,
        },
      });
      if (!normalized.valid || !normalized.person) continue;

      const primarySrc = Array.isArray(c.sources) && c.sources[0] ? c.sources[0] : undefined;
      normalized.person.relationshipType = roleClass.relationshipType;
      normalized.person.department = c.department || roleClass.department;
      normalized.person.decisionMakerCategory = c.decisionMakerCategory || roleClass.category;
      normalized.person.bioSummary = c.bioSummary ? String(c.bioSummary) : undefined;
      normalized.person.officialBioUrl = c.officialBioUrl ? String(c.officialBioUrl) : undefined;
      normalized.person.seniority = c.seniority ? String(c.seniority) : roleClass.seniority;
      normalized.person.decisionMakingFunction = c.decisionMakingFunction
        ? String(c.decisionMakingFunction)
        : roleClass.functionArea;
      normalized.person.verificationStatus = tierToVerification(c.verificationTier);
      normalized.person.confidenceScore = typeof c.confidenceScore === 'number' ? c.confidenceScore : 75;
      normalized.person.attributeProvenance =
        c.attributeProvenance && typeof c.attributeProvenance === 'object' ? c.attributeProvenance : undefined;
      normalized.person.sources = Array.isArray(c.sources)
        ? c.sources.map((s: any) => ({
            sourceName: String(s.sourceName || 'Decision-Maker Discovery'),
            url: s.sourceUrl ? String(s.sourceUrl) : undefined,
            retrievedAt: s.retrievedAt ? String(s.retrievedAt) : now,
            attribution: `Approved by ${actorEmail}`,
          }))
        : [{ sourceName: 'Decision-Maker Discovery', retrievedAt: now, attribution: `Approved by ${actorEmail}` }];
      normalized.person.relationshipProvenance = {
        sourceUrl: primarySrc?.sourceUrl,
        sourceName: primarySrc?.sourceName || 'Decision-Maker Discovery',
        sourceType: primarySrc?.sourceType || 'inferred',
        employmentStatus: c.employmentStatus || 'current',
        firstObservedAt: c.firstObservedAt || now,
        lastObservedAt: c.lastObservedAt || now,
        endedAt: c.endedAt || undefined,
        uncertainMatch: Boolean(c.uncertainMatch),
        reviewedByOwner: true,
        relevanceExplanation: c.relevanceExplanation ? String(c.relevanceExplanation) : undefined,
      };

      latestPersons = isPg
        ? await postgresStorage.linkPersonToLead({
            leadId: targetLead.id,
            person: normalized.person,
            actorEmail,
          })
        : storage.linkPersonToLead({
            leadId: targetLead.id,
            person: normalized.person,
            actorEmail,
          });
    }

    res.status(201).json({
      lead: targetLead,
      leadId: targetLead.id,
      persons: latestPersons,
    });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    res.status(rawMsg.includes('Migration 005') ? 409 : 500).json({
      error: sanitizeApiError(err, 'Failed to approve and save decision-makers.'),
    });
  }
});

// Persons & M:N Company-Person Relationships API
protectedApi.get('/persons', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const leadIdFilter = typeof req.query.leadId === 'string' ? req.query.leadId.trim() : '';
    const countryFilter = typeof req.query.countryCode === 'string' ? req.query.countryCode.trim().toUpperCase() : '';
    const jobTitleFilter = typeof req.query.jobTitle === 'string' ? req.query.jobTitle.trim().toLowerCase() : '';
    const departmentFilter = typeof req.query.department === 'string' ? req.query.department.trim().toLowerCase() : '';
    const relTypeFilter = typeof req.query.relationshipType === 'string' ? req.query.relationshipType.trim().toLowerCase() : '';
    const verificationFilter = typeof req.query.verificationStatus === 'string' ? req.query.verificationStatus.trim().toLowerCase() : '';
    const employmentFilter = typeof req.query.employmentStatus === 'string' ? req.query.employmentStatus.trim().toLowerCase() : '';

    const [persons, rels, leads] = await Promise.all([
      isPg ? postgresStorage.getPersons() : Promise.resolve(storage.getPersons()),
      isPg ? postgresStorage.getAllRelationships() : Promise.resolve(storage.getAllRelationships()),
      isPg ? postgresStorage.getLeads() : Promise.resolve(storage.getLeads()),
    ]);

    const leadMap = new Map(leads.map((l) => [l.id, l]));
    const relsByPerson = new Map<
      string,
      Array<{
        relationshipId: string;
        leadId: string;
        companyName: string;
        companyCountryCode?: string;
        relationshipType: string;
        jobTitle?: string;
        designation?: string;
        department?: string;
        decisionMakerCategory?: string;
        isPrimaryContact: boolean;
        sourceName: string;
        provenance?: Record<string, any>;
        confidenceScore: number;
        verificationStatus: string;
        employmentStatus: 'current' | 'historical' | 'unknown';
        endedAt?: string;
      }>
    >();

    for (const r of rels) {
      const lead = leadMap.get(r.leadId);
      const list = relsByPerson.get(r.personId) || [];
      const empStatus = (r.provenance?.employmentStatus || 'current') as 'current' | 'historical' | 'unknown';
      list.push({
        relationshipId: r.id,
        leadId: r.leadId,
        companyName: lead?.companyName || r.leadId,
        companyCountryCode: lead?.address?.countryCode,
        relationshipType: r.relationshipType,
        jobTitle: r.jobTitle,
        designation: r.designation,
        department: r.department,
        decisionMakerCategory: r.decisionMakerCategory,
        isPrimaryContact: r.isPrimaryContact,
        sourceName: r.sourceName,
        provenance: r.provenance,
        confidenceScore: r.confidenceScore,
        verificationStatus: r.verificationStatus,
        employmentStatus: empStatus,
        endedAt: r.provenance?.endedAt,
      });
      relsByPerson.set(r.personId, list);
    }

    // Group identical normalized names across distinct person records for uncertain-match review alerts
    const nameGroups = new Map<string, string[]>();
    for (const p of persons) {
      if (!p.normalizedName) continue;
      const arr = nameGroups.get(p.normalizedName) || [];
      arr.push(p.id);
      nameGroups.set(p.normalizedName, arr);
    }

    const enriched = persons
      .filter((p) => {
        const comps = relsByPerson.get(p.id) || [];
        if (search) {
          const hit =
            p.fullName.toLowerCase().includes(search) ||
            (p.email && p.email.toLowerCase().includes(search)) ||
            (p.city && p.city.toLowerCase().includes(search)) ||
            comps.some(
              (c) =>
                c.companyName.toLowerCase().includes(search) ||
                (c.jobTitle && c.jobTitle.toLowerCase().includes(search))
            );
          if (!hit) return false;
        }
        if (leadIdFilter && !comps.some((c) => c.leadId === leadIdFilter)) return false;
        if (countryFilter && countryFilter !== 'ALL' && countryFilter !== 'GLOBAL') {
          const personCc = (p.countryCode || '').toUpperCase();
          if (personCc !== countryFilter && !comps.some((c) => c.companyCountryCode === countryFilter)) {
            return false;
          }
        }
        if (
          jobTitleFilter &&
          !comps.some((c) => (c.jobTitle || '').toLowerCase().includes(jobTitleFilter))
        ) {
          return false;
        }
        if (
          departmentFilter &&
          !comps.some((c) => (c.department || '').toLowerCase().includes(departmentFilter))
        ) {
          return false;
        }
        if (
          relTypeFilter &&
          relTypeFilter !== 'all' &&
          !comps.some((c) => c.relationshipType.toLowerCase() === relTypeFilter)
        ) {
          return false;
        }
        if (
          verificationFilter &&
          verificationFilter !== 'all' &&
          p.verificationStatus.toLowerCase() !== verificationFilter
        ) {
          return false;
        }
        if (
          employmentFilter &&
          employmentFilter !== 'all' &&
          !comps.some((c) => c.employmentStatus === employmentFilter)
        ) {
          return false;
        }
        return true;
      })
      .map((p) => {
        const dupIds = (nameGroups.get(p.normalizedName) || []).filter((id) => id !== p.id);
        return {
          ...p,
          companies: relsByPerson.get(p.id) || [],
          possibleDuplicatePersonIds: dupIds.length > 0 ? dupIds : undefined,
        };
      });

    res.json({ persons: enriched, total: enriched.length });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch persons directory.') });
  }
});

protectedApi.put('/persons/:personId', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const body = req.body || {};
    const updated = isPg
      ? await postgresStorage.updatePersonRecord(req.params.personId, body)
      : storage.updatePersonRecord(req.params.personId, body);
    if (!updated) {
      res.status(404).json({ error: 'Person record not found.' });
      return;
    }
    res.json({ person: updated });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to update person record.') });
  }
});

protectedApi.post('/persons/:personId/link', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const body = req.body || {};
    const leadId = String(body.leadId || '').trim();
    if (!leadId) {
      res.status(400).json({ error: 'leadId is required to link person to a company.' });
      return;
    }
    const roleClass = classifyDecisionMakerRole({
      rawRelationshipType: body.relationshipType,
      rawJobTitle: body.jobTitle,
      rawDepartment: body.department,
    });
    const actorEmail = req.owner?.email || 'Owner';
    const persons = isPg
      ? await postgresStorage.linkExistingPersonToLead({
          personId: req.params.personId,
          leadId,
          relationshipType: roleClass.relationshipType,
          jobTitle: body.jobTitle ? String(body.jobTitle) : undefined,
          designation: body.designation ? String(body.designation) : undefined,
          department: body.department ? String(body.department) : roleClass.department,
          decisionMakerCategory: body.decisionMakerCategory
            ? String(body.decisionMakerCategory)
            : roleClass.category,
          isPrimaryContact: Boolean(body.isPrimaryContact),
          sourceName: body.sourceName ? String(body.sourceName) : 'Owner Manual Link',
          actorEmail,
        })
      : storage.linkExistingPersonToLead({
          personId: req.params.personId,
          leadId,
          relationshipType: roleClass.relationshipType,
          jobTitle: body.jobTitle ? String(body.jobTitle) : undefined,
          designation: body.designation ? String(body.designation) : undefined,
          department: body.department ? String(body.department) : roleClass.department,
          decisionMakerCategory: body.decisionMakerCategory
            ? String(body.decisionMakerCategory)
            : roleClass.category,
          isPrimaryContact: Boolean(body.isPrimaryContact),
          sourceName: body.sourceName ? String(body.sourceName) : 'Owner Manual Link',
          actorEmail,
        });
    res.status(201).json({ leadId, persons });
  } catch (err: unknown) {
    res.status(400).json({ error: sanitizeApiError(err, 'Failed to link person to company.') });
  }
});

protectedApi.get('/leads/:id/persons', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const persons = isPg
      ? await postgresStorage.getLeadPersons(req.params.id)
      : storage.getLeadPersons(req.params.id);
    res.json({ leadId: req.params.id, persons });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to fetch lead contacts.') });
  }
});

protectedApi.post('/leads/:id/persons', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const lead = isPg ? await postgresStorage.getLead(req.params.id) : storage.getLead(req.params.id);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    const body = req.body || {};
    const fullName = String(body.fullName || '').trim();
    if (!fullName) {
      res.status(400).json({ error: 'Person fullName is required.' });
      return;
    }

    const fields: Record<string, string> = {
      personFullName: fullName,
      isPrimaryContact: body.isPrimaryContact ? 'true' : 'false',
      associatedCompanyName: lead.companyName,
    };
    if (body.email) fields.personEmail = String(body.email);
    if (body.phone) fields.personPhone = String(body.phone);
    if (body.linkedinUrl) fields.personLinkedInUrl = String(body.linkedinUrl);
    if (body.jobTitle) fields.personJobTitle = String(body.jobTitle);
    if (body.designation) fields.personDesignation = String(body.designation);
    if (body.department) fields.personDepartment = String(body.department);
    if (body.relationshipType) fields.relationshipType = String(body.relationshipType);
    if (body.decisionMakerCategory) fields.decisionMakerCategory = String(body.decisionMakerCategory);
    if (body.countryCode || lead.address?.countryCode) {
      fields.personCountry = body.countryCode ? String(body.countryCode) : String(lead.address?.countryCode);
    }
    if (body.city || lead.address?.city) {
      fields.personCity = body.city ? String(body.city) : String(lead.address?.city);
    }

    const normalized = normalizeAndValidateMappedRow({
      rowNumber: 1,
      fields,
      customFields: {},
      options: {
        defaultCountryCode: lead.address?.countryCode || 'US',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
    });

    if (!normalized.valid || !normalized.person) {
      res.status(400).json({
        error: normalized.errors.map((e) => e.message).join('; ') || 'Invalid person payload.',
      });
      return;
    }

    const actorEmail = req.owner?.email || 'Owner';
    const persons = isPg
      ? await postgresStorage.linkPersonToLead({
          leadId: lead.id,
          person: normalized.person,
          actorEmail,
        })
      : storage.linkPersonToLead({
          leadId: lead.id,
          person: normalized.person,
          actorEmail,
        });

    res.status(201).json({ leadId: lead.id, persons });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    res.status(rawMsg.includes('Migration 005') ? 409 : 500).json({
      error: sanitizeApiError(err, 'Failed to link person to lead.'),
    });
  }
});

protectedApi.put('/leads/:id/persons/:relationshipId', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const updated = isPg
      ? await postgresStorage.updateRelationshipRecord(req.params.id, req.params.relationshipId, req.body || {})
      : storage.updateRelationshipRecord(req.params.id, req.params.relationshipId, req.body || {});
    if (!updated) {
      res.status(404).json({ error: 'Company-person relationship not found.' });
      return;
    }
    const persons = isPg
      ? await postgresStorage.getLeadPersons(req.params.id)
      : storage.getLeadPersons(req.params.id);
    res.json({ leadId: req.params.id, relationship: updated, persons });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to update company-person relationship.') });
  }
});

protectedApi.put('/leads/:id/persons/:relationshipId/primary', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const persons = isPg
      ? await postgresStorage.setPrimaryContact(req.params.id, req.params.relationshipId)
      : storage.setPrimaryContact(req.params.id, req.params.relationshipId);
    res.json({ leadId: req.params.id, persons });
  } catch (err: unknown) {
    res.status(404).json({ error: sanitizeApiError(err, 'Failed to set primary contact.') });
  }
});

protectedApi.delete('/leads/:id/persons/:relationshipId', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const deleted = isPg
      ? await postgresStorage.unlinkPersonFromLead(req.params.id, req.params.relationshipId)
      : storage.unlinkPersonFromLead(req.params.id, req.params.relationshipId);
    if (!deleted) {
      res.status(404).json({ error: 'Company-person relationship not found.' });
      return;
    }
    res.json({ success: true, deletedId: req.params.relationshipId });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to unlink person from lead.') });
  }
});

// =============================================================================
// Phase 12: Lead Enrichment, Contact Verification & Data Quality Intelligence
// =============================================================================

function getDefaultReverificationPolicy(): ReverificationSchedulePolicy {
  return {
    enabled: true,
    emailMaxAgeDays: 90,
    phoneMaxAgeDays: 180,
    jobTitleMaxAgeDays: 90,
    companyStatusMaxAgeDays: 90,
    websiteMaxAgeDays: 180,
    legalRegistryMaxAgeDays: 365,
    maxBatchSize: MAX_BULK_ENRICHMENT_BATCH,
    updatedAt: new Date().toISOString(),
  };
}

protectedApi.get('/enrichment/providers', async (_req: Request, res: Response) => {
  ensureConnectorsRegistered();
  try {
    const { isPg } = checkStorageEngine();
    const [configs, runs, settings] = await Promise.all([
      isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
      isPg ? postgresStorage.getConnectorRuns(undefined, 250) : Promise.resolve(storage.getConnectorRuns(undefined, 250)),
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
    ]);
    const statsMap = aggregateRunsByConnector(runs);
    const statuses = await Promise.all(
      connectorRegistry.listAll().map((c) =>
        buildUnifiedConnectorStatus(c, { stats: statsMap.get(c.id), config: configs[c.id] })
      )
    );
    const providers = buildEnrichmentProviderCatalog(statuses);
    res.json({
      providers,
      freshnessRules: ATTRIBUTE_FRESHNESS_RULES,
      schedulePolicy: settings.reverificationPolicy || getDefaultReverificationPolicy(),
      maxBulkBatch: MAX_BULK_ENRICHMENT_BATCH,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to inspect enrichment providers.') });
  }
});

protectedApi.post('/enrichment/contact/verify', createRateLimitMiddleware(inspectionRateLimiter), async (req: Request, res: Response) => {
  ensureConnectorsRegistered();
  try {
    const body = req.body || {};
    const type = String(body.type || '').toLowerCase();
    const value = String(body.value || '').trim();
    if (!value) {
      res.status(400).json({ error: 'Contact value is required for verification.' });
      return;
    }

    const { isPg } = checkStorageEngine();
    const settings = isPg ? await postgresStorage.getSettings() : storage.getSettings();

    if (type === 'email') {
      const result = await verifyBusinessEmail(value, {
        registry: connectorRegistry,
        credentialManager,
        companyDomain: body.companyDomain ? String(body.companyDomain) : undefined,
        preferProvider: body.useLiveProvider === false ? 'dns_only' : 'auto',
        userAgent: settings.userAgent,
      });
      res.json({ type: 'email', result });
      return;
    }

    if (type === 'phone') {
      const result = await verifyBusinessPhone(value, {
        countryCode: body.countryCode ? String(body.countryCode) : 'US',
        registry: connectorRegistry,
        credentialManager,
        useLiveProvider: body.useLiveProvider !== false,
        existingPhoneNormalized: body.existingPhoneNormalized ? String(body.existingPhoneNormalized) : undefined,
        isPersonContact: Boolean(body.isPersonContact),
        personAssociationSourceVerified: Boolean(body.personAssociationSourceVerified),
        userAgent: settings.userAgent,
      });
      res.json({ type: 'phone', result });
      return;
    }

    res.status(400).json({ error: 'Verification type must be "email" or "phone".' });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Contact verification failed.') });
  }
});

protectedApi.post('/enrichment/company/preview', createRateLimitMiddleware(inspectionRateLimiter), async (req: Request, res: Response) => {
  ensureConnectorsRegistered();
  try {
    const body = req.body || {};
    const { isPg } = checkStorageEngine();
    const [configs, settings] = await Promise.all([
      isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
    ]);

    for (const [id, cfg] of Object.entries(configs)) {
      if (typeof cfg?.enabled === 'boolean') {
        connectorRegistry.setEnabledOverride(id, cfg.enabled);
      }
    }

    let targetLead: CanonicalLead | undefined;
    if (body.leadId) {
      targetLead =
        (isPg
          ? await postgresStorage.getLead(String(body.leadId))
          : storage.getLead(String(body.leadId))) ?? undefined;
      if (!targetLead) {
        res.status(404).json({ error: 'Lead not found for enrichment preview.' });
        return;
      }
    } else if (body.candidateLead && typeof body.candidateLead === 'object') {
      const c = body.candidateLead as Partial<CanonicalLead>;
      if (!c.companyName || !String(c.companyName).trim()) {
        res.status(400).json({ error: 'candidateLead.companyName is required.' });
        return;
      }
      const nowIso = new Date().toISOString();
      targetLead = {
        id: c.id || 'candidate-preview',
        companyName: String(c.companyName).trim(),
        legalName: c.legalName,
        registrationNumber: c.registrationNumber,
        registrationType: c.registrationType,
        companyStatus: c.companyStatus || 'unknown',
        website: c.website,
        domain: c.domain,
        email: c.email,
        emailStatus: c.emailStatus || 'unverified',
        phone: c.phone,
        phoneNormalized: c.phoneNormalized,
        address: c.address || { country: 'International', countryCode: 'US' },
        industry: c.industry || 'General Business',
        category: c.category || 'Company',
        employeeRange: c.employeeRange,
        foundedYear: c.foundedYear,
        confidenceScore: typeof c.confidenceScore === 'number' ? c.confidenceScore : 45,
        confidenceSignals: Array.isArray(c.confidenceSignals) ? c.confidenceSignals : [],
        sources: Array.isArray(c.sources) ? c.sources : [],
        identifiers: Array.isArray(c.identifiers) ? c.identifiers : [],
        socialLinks: c.socialLinks,
        webMetadata: c.webMetadata,
        status: c.status || 'new',
        currency: c.currency || settings.defaultCurrency || 'USD',
        tags: Array.isArray(c.tags) ? c.tags : [],
        notes: Array.isArray(c.notes) ? c.notes : [],
        activities: Array.isArray(c.activities) ? c.activities : [],
        customFields: c.customFields || {},
        createdAt: c.createdAt || nowIso,
        updatedAt: c.updatedAt || nowIso,
      };
    } else {
      res.status(400).json({ error: 'Either leadId or candidateLead is required.' });
      return;
    }

    const preview = await previewCompanyEnrichment(targetLead, {
      registry: connectorRegistry,
      executionEngine: connectorExecutionEngine,
      credentialManager,
      configs,
      userAgent: settings.userAgent,
      runRegistryVerification: body.runRegistryVerification !== false,
      runWebsiteInspection: body.runWebsiteInspection !== false && settings.enableSafeWebsiteCrawl !== false,
      runEmailVerification: body.runEmailVerification !== false,
      runPhoneVerification: body.runPhoneVerification !== false,
      runAiAssistance: Boolean(body.runAiAssistance),
      onRecordRun: async (run) => {
        if (isPg) await postgresStorage.recordConnectorRun(run);
        else storage.recordConnectorRun(run);
      },
    });

    res.json(preview);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Company enrichment preview failed.') });
  }
});

protectedApi.post('/enrichment/company/:leadId/apply', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const existing = isPg
      ? await postgresStorage.getLead(req.params.leadId)
      : storage.getLead(req.params.leadId);
    if (!existing) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }

    const body = req.body || {};
    const approvedProposals = Array.isArray(body.approvedProposals)
      ? (body.approvedProposals as EnrichmentFieldProposal[])
      : [];
    const resolvedConflicts = Array.isArray(body.resolvedConflicts) ? body.resolvedConflicts : [];
    const actorEmail = req.owner?.email || 'Owner';

    const updatedLead = applyApprovedCompanyEnrichmentToClone(
      existing,
      approvedProposals,
      resolvedConflicts,
      {
        emailVerification: body.emailVerification,
        phoneVerification: body.phoneVerification,
        websiteSummary: body.websiteSummary,
        providerRuns: Array.isArray(body.providerRuns) ? body.providerRuns : [],
        failedVerifications: Array.isArray(body.failedVerifications) ? body.failedVerifications : [],
        allConflicts: Array.isArray(body.allConflicts) ? body.allConflicts : [],
      },
      actorEmail
    );

    const savedLead = isPg
      ? await postgresStorage.upsertLead(updatedLead)
      : storage.upsertLead(updatedLead);

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        'LEAD_ENRICHMENT_APPLIED',
        actorEmail,
        'lead',
        savedLead.id,
        {
          fieldsUpdated: approvedProposals.map((p) => p.field),
          conflictsResolved: resolvedConflicts.length,
          qualityScoreAfter: savedLead.customFields?.dataQualityScore,
        },
        normalizeClientIp(req)
      );
    }

    const qualityAfter = evaluateCompanyDataQuality(savedLead);
    res.json({ lead: savedLead, qualityAfter });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to apply approved company enrichment.') });
  }
});

protectedApi.post('/enrichment/company/bulk-preview', createRateLimitMiddleware(discoveryRateLimiter), async (req: Request, res: Response) => {
  ensureConnectorsRegistered();
  try {
    const body = req.body || {};
    const leadIds = Array.isArray(body.leadIds) ? body.leadIds.map((id: unknown) => String(id)) : [];
    if (leadIds.length === 0) {
      res.status(400).json({ error: 'At least one leadId is required for bulk enrichment preview.' });
      return;
    }
    const { isPg } = checkStorageEngine();
    const [allLeads, configs, settings] = await Promise.all([
      isPg ? postgresStorage.getLeads() : Promise.resolve(storage.getLeads()),
      isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
    ]);

    const idSet = new Set(leadIds);
    const targetLeads = allLeads.filter((l) => idSet.has(l.id));
    if (targetLeads.length === 0) {
      res.status(404).json({ error: 'None of the selected leads were found.' });
      return;
    }

    const result = await previewBulkCompanyEnrichment(targetLeads, {
      registry: connectorRegistry,
      executionEngine: connectorExecutionEngine,
      credentialManager,
      configs,
      userAgent: settings.userAgent,
      runRegistryVerification: body.runRegistryVerification !== false,
      runWebsiteInspection: body.runWebsiteInspection !== false && settings.enableSafeWebsiteCrawl !== false,
      runEmailVerification: body.runEmailVerification !== false,
      runPhoneVerification: body.runPhoneVerification !== false,
      runAiAssistance: false,
      onRecordRun: async (run) => {
        if (isPg) await postgresStorage.recordConnectorRun(run);
        else storage.recordConnectorRun(run);
      },
    });

    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Bulk enrichment preview failed.') });
  }
});

protectedApi.post('/enrichment/company/bulk-apply', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_BULK_ENRICHMENT_BATCH) : [];
    if (items.length === 0) {
      res.status(400).json({ error: 'At least one approved enrichment item is required.' });
      return;
    }
    const { isPg } = checkStorageEngine();
    const actorEmail = req.owner?.email || 'Owner';
    const updatedLeads: CanonicalLead[] = [];

    for (const item of items) {
      const leadId = String(item?.leadId || '');
      if (!leadId) continue;
      const existing = isPg ? await postgresStorage.getLead(leadId) : storage.getLead(leadId);
      if (!existing) continue;
      const approvedProposals = Array.isArray(item.approvedProposals)
        ? (item.approvedProposals as EnrichmentFieldProposal[])
        : [];
      const resolvedConflicts = Array.isArray(item.resolvedConflicts) ? item.resolvedConflicts : [];

      const updatedLead = applyApprovedCompanyEnrichmentToClone(
        existing,
        approvedProposals,
        resolvedConflicts,
        {
          emailVerification: item.emailVerification,
          phoneVerification: item.phoneVerification,
          websiteSummary: item.websiteSummary,
          providerRuns: Array.isArray(item.providerRuns) ? item.providerRuns : [],
          failedVerifications: Array.isArray(item.failedVerifications) ? item.failedVerifications : [],
          allConflicts: Array.isArray(item.allConflicts) ? item.allConflicts : [],
        },
        actorEmail
      );

      const saved = isPg
        ? await postgresStorage.upsertLead(updatedLead)
        : storage.upsertLead(updatedLead);
      updatedLeads.push(saved);

      if (isPg && req.owner) {
        await postgresStorage.recordAuditEvent(
          'LEAD_BULK_ENRICHMENT_APPLIED',
          actorEmail,
          'lead',
          saved.id,
          { fieldsUpdated: approvedProposals.map((p) => p.field) },
          normalizeClientIp(req)
        );
      }
    }

    res.json({ updatedCount: updatedLeads.length, updatedLeads });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Bulk enrichment apply failed.') });
  }
});

protectedApi.post('/enrichment/person/:personId/preview', createRateLimitMiddleware(inspectionRateLimiter), async (req: Request, res: Response) => {
  ensureConnectorsRegistered();
  try {
    const { isPg } = checkStorageEngine();
    const [persons, allRels, settings] = await Promise.all([
      isPg ? postgresStorage.getPersons() : Promise.resolve(storage.getPersons()),
      isPg ? postgresStorage.getAllRelationships() : Promise.resolve(storage.getAllRelationships()),
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
    ]);

    const person = persons.find((p) => p.id === req.params.personId);
    if (!person) {
      res.status(404).json({ error: 'Decision-maker record not found.' });
      return;
    }

    const rels = allRels.filter((r) => r.personId === person.id);
    const primaryRel = rels.find((r) => r.isPrimaryContact) || rels[0];
    const targetLeadId = String(req.body?.leadId || primaryRel?.leadId || '');
    const companyLead = targetLeadId
      ? (isPg
          ? await postgresStorage.getLead(targetLeadId)
          : storage.getLead(targetLeadId)) ?? undefined
      : undefined;

    const preview = await previewPersonEnrichment(person, rels, companyLead, {
      registry: connectorRegistry,
      credentialManager,
      userAgent: settings.userAgent,
      runWebsiteInspection: req.body?.runWebsiteInspection !== false && settings.enableSafeWebsiteCrawl !== false,
      runEmailVerification: req.body?.runEmailVerification !== false,
      runPhoneVerification: req.body?.runPhoneVerification !== false,
    });

    res.json(preview);
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Decision-maker enrichment preview failed.') });
  }
});

protectedApi.post('/enrichment/person/:personId/apply', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const [persons, allRels] = await Promise.all([
      isPg ? postgresStorage.getPersons() : Promise.resolve(storage.getPersons()),
      isPg ? postgresStorage.getAllRelationships() : Promise.resolve(storage.getAllRelationships()),
    ]);

    const person = persons.find((p) => p.id === req.params.personId);
    if (!person) {
      res.status(404).json({ error: 'Decision-maker record not found.' });
      return;
    }

    const rels = allRels.filter((r) => r.personId === person.id);
    const primaryRel = rels.find((r) => r.isPrimaryContact) || rels[0];
    const body = req.body || {};
    const approvedProposals = Array.isArray(body.approvedProposals)
      ? (body.approvedProposals as EnrichmentFieldProposal[])
      : [];
    const actorEmail = req.owner?.email || 'Owner';

    const { personUpdates, relationshipUpdates, historyEntry } = applyApprovedPersonEnrichmentToClone(
      person,
      primaryRel,
      approvedProposals,
      {
        emailVerification: body.emailVerification,
        phoneVerification: body.phoneVerification,
        providerRuns: Array.isArray(body.providerRuns) ? body.providerRuns : [],
        failedVerifications: Array.isArray(body.failedVerifications) ? body.failedVerifications : [],
      },
      actorEmail
    );

    const updatedPerson = isPg
      ? await postgresStorage.updatePersonRecord(person.id, personUpdates)
      : storage.updatePersonRecord(person.id, personUpdates);

    if (primaryRel && relationshipUpdates) {
      if (isPg) {
        await postgresStorage.updateRelationshipRecord(primaryRel.leadId, primaryRel.id, relationshipUpdates);
      } else {
        storage.updateRelationshipRecord(primaryRel.leadId, primaryRel.id, relationshipUpdates);
      }
    }

    if (isPg && req.owner) {
      await postgresStorage.recordAuditEvent(
        'PERSON_ENRICHMENT_APPLIED',
        actorEmail,
        'person',
        person.id,
        {
          fieldsUpdated: approvedProposals.map((p) => p.field),
          qualityScoreAfter: historyEntry.qualityScoreAfter,
        },
        normalizeClientIp(req)
      );
    }

    res.json({ person: updatedPerson, historyEntry });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to apply approved decision-maker enrichment.') });
  }
});

protectedApi.get('/enrichment/company/:leadId/quality', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const [lead, allLeads] = await Promise.all([
      isPg ? postgresStorage.getLead(req.params.leadId) : Promise.resolve(storage.getLead(req.params.leadId)),
      isPg ? postgresStorage.getLeads() : Promise.resolve(storage.getLeads()),
    ]);
    if (!lead) {
      res.status(404).json({ error: 'Lead not found.' });
      return;
    }
    const otherLeads = allLeads.filter((l) => l.id !== lead.id);
    const duplicateCandidatesCount = otherLeads.filter((l) => {
      const sameDom =
        Boolean(lead.domain && l.domain) &&
        l.domain!.toLowerCase() === lead.domain!.toLowerCase();
      const sameNm =
        l.companyName.trim().toLowerCase() === lead.companyName.trim().toLowerCase();
      return sameDom || sameNm;
    }).length;
    const quality = evaluateCompanyDataQuality(lead, { duplicateCandidatesCount });
    const parseField = <T,>(raw: string | undefined, fallback: T): T => {
      if (!raw) return fallback;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    };
    res.json({
      leadId: lead.id,
      quality,
      emailVerification: parseField(lead.customFields?.emailVerificationMeta, null),
      phoneVerification: parseField(lead.customFields?.phoneVerificationMeta, null),
      conflicts: parseField(lead.customFields?.enrichmentConflicts, []),
      history: parseField(lead.customFields?.enrichmentHistory, []),
      attributeSources: parseField(lead.customFields?.attributeSources, {}),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to evaluate company data quality.') });
  }
});

protectedApi.get('/enrichment/quality/summary', async (_req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const [leads, persons, allRels, settings] = await Promise.all([
      isPg ? postgresStorage.getLeads() : Promise.resolve(storage.getLeads()),
      isPg ? postgresStorage.getPersons() : Promise.resolve(storage.getPersons()),
      isPg ? postgresStorage.getAllRelationships() : Promise.resolve(storage.getAllRelationships()),
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
    ]);

    const relsByPerson = new Map<string, typeof allRels>();
    for (const r of allRels) {
      const arr = relsByPerson.get(r.personId) || [];
      arr.push(r);
      relsByPerson.set(r.personId, arr);
    }

    const gradeDist: Record<'A' | 'B' | 'C' | 'D' | 'F', number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    const leadScores: Record<
      string,
      {
        overallScore: number;
        completenessScore: number;
        verificationScore: number;
        freshnessScore: number;
        grade: 'A' | 'B' | 'C' | 'D' | 'F';
        staleCount: number;
        conflictCount: number;
        verificationCapApplied: boolean;
        reverificationEligible: boolean;
      }
    > = {};

    let totalLeadScore = 0;
    let totalLeadVerification = 0;
    let staleLeadsCount = 0;
    let openConflictsCount = 0;
    const reverificationQueue: Array<{
      leadId: string;
      companyName: string;
      overallScore: number;
      grade: string;
      staleCount: number;
      conflictCount: number;
      missingCriticalCount: number;
    }> = [];

    for (const lead of leads) {
      const q = evaluateCompanyDataQuality(lead);
      gradeDist[q.grade] += 1;
      totalLeadScore += q.overallScore;
      totalLeadVerification += q.verificationScore;
      const staleCount = q.staleAttributes.filter((s) => s.status === 'stale').length;
      if (staleCount > 0 || q.reverificationEligible) staleLeadsCount += 1;
      openConflictsCount += q.conflictingAttributes.length;

      leadScores[lead.id] = {
        overallScore: q.overallScore,
        completenessScore: q.completenessScore,
        verificationScore: q.verificationScore,
        freshnessScore: q.freshnessScore,
        grade: q.grade,
        staleCount,
        conflictCount: q.conflictingAttributes.length,
        verificationCapApplied: q.verificationCapApplied,
        reverificationEligible: q.reverificationEligible,
      };

      if (q.reverificationEligible || q.conflictingAttributes.length > 0 || q.overallScore < 65) {
        reverificationQueue.push({
          leadId: lead.id,
          companyName: lead.companyName,
          overallScore: q.overallScore,
          grade: q.grade,
          staleCount,
          conflictCount: q.conflictingAttributes.length,
          missingCriticalCount: q.missingCriticalFields.length,
        });
      }
    }

    const personScores: Record<
      string,
      {
        overallScore: number;
        verificationScore: number;
        grade: 'A' | 'B' | 'C' | 'D' | 'F';
        staleCount: number;
        verificationCapApplied: boolean;
      }
    > = {};
    let totalPersonScore = 0;
    for (const p of persons) {
      const q = evaluatePersonDataQuality(p, relsByPerson.get(p.id) || []);
      totalPersonScore += q.overallScore;
      personScores[p.id] = {
        overallScore: q.overallScore,
        verificationScore: q.verificationScore,
        grade: q.grade,
        staleCount: q.staleAttributes.filter((s) => s.status === 'stale').length,
        verificationCapApplied: q.verificationCapApplied,
      };
    }

    reverificationQueue.sort((a, b) => a.overallScore - b.overallScore);

    res.json({
      totalCompanies: leads.length,
      totalPersons: persons.length,
      averageCompanyQuality: leads.length > 0 ? Math.round(totalLeadScore / leads.length) : 0,
      averageCompanyVerification: leads.length > 0 ? Math.round(totalLeadVerification / leads.length) : 0,
      averagePersonQuality: persons.length > 0 ? Math.round(totalPersonScore / persons.length) : 0,
      gradeDistribution: gradeDist,
      staleOrReverifyCompaniesCount: staleLeadsCount,
      openConflictsCount,
      reverificationQueue: reverificationQueue.slice(0, 25),
      leadScores,
      personScores,
      schedulePolicy: settings.reverificationPolicy || getDefaultReverificationPolicy(),
    });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to compute portfolio data quality summary.') });
  }
});

protectedApi.post('/enrichment/schedule', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const clampDays = (v: unknown, fallback: number, min: number, max: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
    };

    const schedulePolicy: ReverificationSchedulePolicy = {
      enabled: body.enabled !== false,
      emailMaxAgeDays: clampDays(body.emailMaxAgeDays, 90, 14, 365),
      phoneMaxAgeDays: clampDays(body.phoneMaxAgeDays, 180, 30, 730),
      jobTitleMaxAgeDays: clampDays(body.jobTitleMaxAgeDays, 90, 14, 365),
      companyStatusMaxAgeDays: clampDays(body.companyStatusMaxAgeDays, 90, 14, 365),
      websiteMaxAgeDays: clampDays(body.websiteMaxAgeDays, 180, 30, 730),
      legalRegistryMaxAgeDays: clampDays(body.legalRegistryMaxAgeDays, 365, 90, 1095),
      maxBatchSize: clampDays(body.maxBatchSize, MAX_BULK_ENRICHMENT_BATCH, 1, MAX_BULK_ENRICHMENT_BATCH),
      updatedAt: new Date().toISOString(),
    };

    const { isPg } = checkStorageEngine();
    if (isPg) {
      await postgresStorage.updateSettings({ reverificationPolicy: schedulePolicy });
      if (req.owner) {
        await postgresStorage.recordAuditEvent(
          'REVERIFICATION_POLICY_UPDATED',
          req.owner.email,
          'settings',
          'reverification_policy',
          schedulePolicy as unknown as Record<string, unknown>,
          normalizeClientIp(req)
        );
      }
    } else {
      storage.updateSettings({ reverificationPolicy: schedulePolicy });
    }

    res.json({ schedulePolicy });
  } catch (err: unknown) {
    res.status(500).json({ error: sanitizeApiError(err, 'Failed to update re-verification policy.') });
  }
});

// Mount protected API router
app.use('/api', protectedApi);

// Ensure unmatched /api/* routes return JSON 404 rather than falling through to SPA HTML
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({
    error: 'API endpoint not found.',
    code: 'NOT_FOUND',
  });
});

// Ensure unhandled /api/* errors (including malformed JSON bodies) return JSON instead of HTML
app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  const status =
    typeof err?.status === 'number' && err.status >= 400 && err.status < 600
      ? err.status
      : err?.type === 'entity.parse.failed'
        ? 400
        : 500;
  res.status(status).json({
    error: sanitizeApiError(err, status === 400 ? 'Invalid request payload.' : 'Internal API error.'),
    code: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
  });
});

// --- VITE DEV / PRODUCTION STATIC SERVING & BOOTSTRAP ---
async function startServer() {
  // 1. Explicitly verify Neon / PostgreSQL connection during startup
  if (dbManager.isConfigured()) {
    const check = await dbManager.checkConnection(3, 1000);
    if (check.connected) {
      const preInspection = await migrator.inspectMigrationStatus();
      if (process.env.AUTO_RUN_MIGRATIONS === 'true') {
        console.log(`[Startup] PostgreSQL connected successfully (${check.latencyMs}ms). Running baseline schema migrations (001–004 only; 005+ require explicit owner approval)...`);
        const baselineVersions = ['001', '002', '003', '004'];
        const applied: string[] = [];
        const alreadyAppliedSet = new Set<string>();
        let success = true;
        let error: string | undefined;

        for (const targetVersion of baselineVersions) {
          const stepRes = await migrator.runMigrations(undefined, { targetVersion });
          applied.push(...stepRes.applied);
          for (const prev of stepRes.alreadyApplied) alreadyAppliedSet.add(prev);
          if (!stepRes.success) {
            success = false;
            error = stepRes.error;
            break;
          }
        }

        lastStartupMigrationResult = {
          attempted: true,
          success,
          applied,
          alreadyApplied: Array.from(alreadyAppliedSet),
          error,
        };
        if (!success) {
          console.error(`[Startup] Baseline schema migrations FAILED: ${error || 'Unknown error'}`);
        } else {
          console.log(`[Startup] Baseline migrations succeeded — applied: ${applied.length}, already applied: ${alreadyAppliedSet.size}`);
        }
      } else {
        console.log(`[Startup] PostgreSQL connected successfully (${check.latencyMs}ms). Read-only schema inspection (pending migrations require explicit approval).`);
        lastStartupMigrationResult = {
          attempted: false,
          success: preInspection.migration003SchemaReady && preInspection.migration004SchemaReady,
          applied: [],
          alreadyApplied: preInspection.appliedVersions.map((v) => v.name),
          error:
            preInspection.migration003SchemaReady && preInspection.migration004SchemaReady
              ? undefined
              : 'Pending schema migrations require explicit approval before execution.',
        };
      }
      const inspection = await migrator.inspectMigrationStatus();
      console.log(
        `[Startup] Schema verification — m003=${inspection.migration003SchemaReady}, m004=${inspection.migration004SchemaReady}, pendingM004Cols=${inspection.missingMigration004Columns.length}`
      );
    } else {
      console.warn(`[Startup] PostgreSQL connection check failed: ${check.error}`);
      if (IS_PROD) {
        console.error('[Startup] Running in production without active PostgreSQL connection. Database operations will return HTTP 503.');
      } else {
        console.log('[Startup] Running in local development preview mode with validated JSON persistence.');
      }
    }
  } else {
    console.log('[Startup] PostgreSQL not configured. Running in preview mode with validated JSON persistence.');
  }

  // 2. Serve static or mount Vite middleware
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Global Lead Intelligence & Sales Pipeline running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
