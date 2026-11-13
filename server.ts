import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { dbManager } from './server/db/pool.js';
import { postgresStorage } from './server/db/storagePg.js';
import { storage } from './server/storage.js';
import { migrator } from './server/db/migrator.js';
import { jsonMigrator } from './server/db/migrateJsonToSql.js';
import { searchBrreg } from './server/connectors/brreg.js';
import { searchCompaniesHouse } from './server/connectors/companiesHouse.js';
import { searchOpenStreetMap } from './server/connectors/osmOverpass.js';
import { searchAbn } from './server/connectors/abnLookup.js';
import { inspectWebsite } from './server/connectors/webInspector.js';
import { detectDuplicates, mergeLeads } from './server/connectors/dedupeEngine.js';
import {
  analyzeLeadWithAi,
  generateSalesPitchWithAi,
  generateMeetingBriefWithAi,
  generateMarketReportWithAi,
} from './server/gemini.js';
import { CanonicalLead } from './server/types.js';
import {
  requireOwnerAuth,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE_NAME,
} from './server/auth/middleware.js';
import {
  listOwnerSessions,
  revokeSessionById,
  revokeOtherOwnerSessions,
  hashSessionToken,
} from './server/auth/session.js';
import { ownerService } from './server/auth/ownerService.js';
import { generateCsrfToken, setCsrfCookie, validateCsrf } from './server/auth/csrf.js';
import { normalizeClientIp } from './server/auth/rateLimit.js';
import { getAllCountries, getCountryByCode, searchCountries } from './server/geo/countries.js';
import { getDivisionsForCountry } from './server/geo/divisions.js';
import { searchCities } from './server/geo/cities.js';
import { normalizePhoneNumber } from './server/geo/phoneUtils.js';
import { formatInternationalAddress, validatePostalCode } from './server/geo/addressUtils.js';
import { validateIdentifier, normalizeIdentifierValue } from './server/identifiers/identifierEngine.js';
import { buildCountryCapabilityMatrix } from './server/geo/capabilityMatrix.js';
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
app.post('/api/auth/setup', async (req: Request, res: Response) => {
  const { fullName, email, password, setupSecret } = req.body;
  const ip = normalizeClientIp(req);

  try {
    const owner = await ownerService.setupOwner(fullName, email, password, setupSecret);
    const loginResult = await ownerService.login(email, password, ip, req.headers['user-agent']);

    // Set secure partitioned cookie and return token for resilient iframe authorization
    setSessionCookie(res, loginResult.rawToken);

    res.status(201).json({
      success: true,
      token: loginResult.rawToken,
      owner: loginResult.owner,
      message: 'Owner initialized successfully. Platform locked to single-owner mode.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// Owner Login (Sets partitioned cookie and returns token for resilient iframe authorization)
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const ip = normalizeClientIp(req);

  try {
    const result = await ownerService.login(email, password, ip, req.headers['user-agent']);
    // Set secure partitioned cookie
    setSessionCookie(res, result.rawToken);

    // Return owner identity with session token
    res.json({
      success: true,
      token: result.rawToken,
      owner: result.owner,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isLocked = msg.includes('locked') || msg.includes('Too many failed');
    res.status(isLocked ? 429 : 401).json({ error: msg });
  }
});

// Owner Logout
app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const rawToken = req.cookies?.[SESSION_COOKIE_NAME] || req.headers['authorization']?.replace('Bearer ', '');
  if (rawToken) {
    await ownerService.logout(rawToken);
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
  const { fullName } = req.body;
  if (!req.owner) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }
  if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
    res.status(400).json({ error: 'Valid full name is required' });
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
    }
    res.json({
      success: true,
      owner: {
        ...req.owner,
        fullName: fullName.trim(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Change Owner Password
protectedApi.post('/auth/change-password', async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Audit History Log
protectedApi.get('/owner/audit-log', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const events = await postgresStorage.getAuditEvents(limit);
    res.json({ events });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
          sameSite: 'none',
          secure: true,
          partitioned: true,
          httpOnly: true,
        },
        bearerDualAuth: true,
        csrfProtection: true,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to fetch diagnostics: ${msg}` });
  }
});

// Run Schema Migrations (DDL) - Owner Role Enforced
protectedApi.post('/database/run-migrations', async (req: Request, res: Response) => {
  if (!req.owner || req.owner.role !== 'owner') {
    res.status(403).json({ error: 'Owner authorization required to run schema migrations.', code: 'FORBIDDEN' });
    return;
  }
  try {
    const result = await migrator.runMigrations();
    await postgresStorage.recordAuditEvent(
      result.success ? 'SCHEMA_MIGRATIONS_EXECUTED' : 'SCHEMA_MIGRATIONS_FAILED',
      req.owner.email,
      'schema_migration',
      result.applied.join(',') || 'none',
      { applied: result.applied, alreadyApplied: result.alreadyApplied, error: result.error },
      normalizeClientIp(req)
    );
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Schema migration failed: ${msg}` });
  }
});

// Dedicated Owner-Only Approval Action for Migration 004 Only
protectedApi.post('/database/migrations/004/approve', async (req: Request, res: Response) => {
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
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = rawMsg.replace(/:[^:@]+@/, ':***@');
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
      error: `Migration 004 execution failed and was rolled back: ${safeMsg}`,
    });
  }
});

// Migrate JSON Store into PostgreSQL (Supports Dry-Run)
protectedApi.post('/database/migrate-json', async (req: Request, res: Response) => {
  const dryRun = req.body?.dryRun === true;
  try {
    const summary = await jsonMigrator.migrate({ dryRun });
    res.json(summary);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `JSON migration failed: ${msg}` });
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
    const { isPg } = checkStorageEngine();
    const [connectors, settings, overrides] = await Promise.all([
      isPg ? postgresStorage.getConnectors() : storage.getConnectorsUnified(),
      isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
      isPg ? postgresStorage.getCapabilityOverrides() : Promise.resolve(undefined),
    ]);
    const hasChKey = Boolean(process.env.COMPANIES_HOUSE_API_KEY || settings.companiesHouseApiKey);
    const matrix = buildCountryCapabilityMatrix(connectors, { hasChKey, overrides });
    res.json({
      matrix,
      totalSources: matrix.length,
      sovereignStatesCount: 195,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
  }
});

protectedApi.post('/leads', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const newLead: CanonicalLead = req.body;
    if (!newLead.companyName) {
      res.status(400).json({ error: 'Company name is required' });
      return;
    }
    if (!newLead.id) {
      newLead.id = `lead-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    }
    newLead.createdAt = new Date().toISOString();
    newLead.updatedAt = newLead.createdAt;

    const saved = isPg ? await postgresStorage.upsertLead(newLead) : storage.upsertLead(newLead);
    res.status(201).json(saved);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
  }
});

protectedApi.put('/leads/:id', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const existing = isPg ? await postgresStorage.getLead(req.params.id) : storage.getLead(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    const updated = isPg
      ? await postgresStorage.upsertLead({ ...existing, ...req.body, id: req.params.id })
      : storage.upsertLead({ ...existing, ...req.body, id: req.params.id });
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
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
    res.json({ success: true, deletedId: req.params.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
  }
});

// Batch Import from CSV / JSON with row validation and deduplication
protectedApi.post('/leads/batch-import', async (req: Request, res: Response) => {
  const { leads, mode } = req.body;
  if (!Array.isArray(leads) || leads.length === 0) {
    res.status(400).json({ error: 'Array of leads is required' });
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

    res.json({
      success: true,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      totalProcessed: leads.length,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(msg.includes('Database connection unavailable') ? 503 : 500).json({ error: msg });
  }
});

// Multi-Source Discovery Engine (Unified Connector Execution Engine)
protectedApi.post('/discovery/search', async (req: Request, res: Response) => {
  const { query, countryCode, region, city, connectorId, autoSave, page, pageSize, fetchAllPages, maxPages, requestId } =
    req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    res.status(400).json({ error: 'Search query is required' });
    return;
  }

  ensureConnectorsRegistered();

  const trimmedQuery = query.trim();
  const cCode = (countryCode || '').toUpperCase().trim();
  const cleanCity = typeof city === 'string' && city.trim() ? city.trim() : undefined;
  const cleanRegion = typeof region === 'string' && region.trim() ? region.trim() : undefined;
  const results: CanonicalLead[] = [];
  const errors: string[] = [];
  const errorDetails: Array<{ connectorId: string; category: string; message: string }> = [];
  const notes: string[] = [];
  let attribution = '';
  let abnLookupInfo: { isLiveApi: boolean; lookupMode: string; isChecksumValid?: boolean } | undefined;
  let pagination: any;
  let lastRunId: string | undefined;

  const { isPg } = checkStorageEngine();
  const [settings, configs] = await Promise.all([
    isPg ? postgresStorage.getSettings() : Promise.resolve(storage.getSettings()),
    isPg ? postgresStorage.getConnectorConfigs() : Promise.resolve(storage.getConnectorConfigs()),
  ]);

  for (const [id, cfg] of Object.entries(configs)) {
    if (typeof cfg?.enabled === 'boolean') {
      connectorRegistry.setEnabledOverride(id, cfg.enabled);
    }
  }

  try {
    const targetIds: string[] = [];
    if (connectorId) {
      const explicit = connectorRegistry.getById(connectorId);
      if (!explicit) {
        res.status(404).json({ error: `Unknown connector "${connectorId}"` });
        return;
      }
      const cfg = configs[connectorId];
      if (!(cfg?.enabled ?? connectorRegistry.isEnabled(connectorId))) {
        res.status(400).json({
          error: `${explicit.getMetadata().name} is currently disabled. Enable it in Connectors Hub before running searches.`,
          errorCategory: 'configuration_error',
        });
        return;
      }
      targetIds.push(connectorId);
    } else {
      if (cCode === 'NO') targetIds.push('conn-brreg');
      else if (cCode === 'GB') targetIds.push('conn-companies-house');
      else if (cCode === 'AU') targetIds.push('conn-abn');
      else targetIds.push('conn-osm');
    }

    const runConnectorSearch = async (targetId: string) => {
      const connector = connectorRegistry.getById(targetId);
      if (!connector) return;
      const meta = connector.getMetadata();
      const cfg = configs[targetId] || {
        connectorId: targetId,
        enabled: connectorRegistry.isEnabled(targetId),
      };
      if (!cfg.enabled) {
        notes.push(`${meta.shortName} is disabled; skipped.`);
        return;
      }

      try {
        const outcome = await connectorExecutionEngine.executeSearch(
          connector,
          {
            query: trimmedQuery,
            countryCode: cCode || undefined,
            region: cleanRegion,
            city: cleanCity,
            page: typeof page === 'number' ? page : undefined,
            pageSize: typeof pageSize === 'number' ? pageSize : undefined,
            fetchAllPages: Boolean(fetchAllPages),
            maxPages: typeof maxPages === 'number' ? maxPages : undefined,
          },
          {
            config: cfg,
            userAgent: settings.userAgent,
            requestId: typeof requestId === 'string' ? requestId : undefined,
          }
        );

        results.push(...outcome.normalization.leads);
        if (!attribution) attribution = outcome.response.attribution;
        pagination = outcome.response.pagination;
        lastRunId = outcome.runRecord.id;
        for (const n of outcome.response.notes || []) {
          if (n && !notes.includes(n)) notes.push(n);
        }

        if (targetId === 'conn-abn' && outcome.response.providerMetadata) {
          const pm = outcome.response.providerMetadata;
          abnLookupInfo = {
            isLiveApi: Boolean(pm.isLiveApi),
            lookupMode: String(pm.lookupMode || 'offline_reference'),
            isChecksumValid:
              typeof pm.isChecksumValid === 'boolean' ? pm.isChecksumValid : undefined,
          };
        }
      } catch (err: unknown) {
        const classified =
          err instanceof ConnectorError ? err.toClassified() : connector.classifyError(err);
        const safeMsg = redactSecrets(classified.safeMessage);
        errors.push(`${meta.shortName}: ${safeMsg}`);
        errorDetails.push({
          connectorId: targetId,
          category: classified.category,
          message: safeMsg,
        });
      }
    };

    for (const id of targetIds) {
      await runConnectorSearch(id);
    }

    // Fallback to OpenStreetMap if auto-selected primary registry yielded 0 leads
    if (!connectorId && results.length === 0 && !targetIds.includes('conn-osm')) {
      await runConnectorSearch('conn-osm');
    }

    if (autoSave && results.length > 0) {
      if (isPg) await postgresStorage.batchUpsertLeads(results);
      else storage.batchUpsertLeads(results);
    }

    res.json({
      leads: results,
      totalDiscovered: results.length,
      pagination,
      runId: lastRunId,
      errors: errors.length > 0 ? errors : undefined,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
      attribution,
      providerNote: notes.join(' '),
      abnLookupInfo,
      appliedFilters: {
        query: trimmedQuery,
        countryCode: cCode || undefined,
        region: cleanRegion || undefined,
        city: cleanCity || undefined,
        regionSupportedByConnector: connectorId === 'conn-osm' || (!connectorId && !['NO', 'GB', 'AU'].includes(cCode)),
      },
    });
  } catch (globalErr: unknown) {
    const msg = globalErr instanceof Error ? globalErr.message : String(globalErr);
    res.status(500).json({ error: `Discovery failed: ${msg}`, errors });
  }
});

// SSRF-Safe Web Inspector
protectedApi.post('/inspection/inspect-url', async (req: Request, res: Response) => {
  const { url, leadId } = req.body;
  if (!url) {
    res.status(400).json({ error: 'URL is required' });
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
    res.status(500).json({ error: `Inspection failed: ${msg}` });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.post('/dedupe/merge', async (req: Request, res: Response) => {
  const { survivorId, absorbedId, reason } = req.body;
  if (!survivorId || !absorbedId) {
    res.status(400).json({ error: 'Both survivorId and absorbedId are required' });
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

    const { updatedSurvivor, historyRecord } = mergeLeads(survivor, absorbed, reason || 'Manual Owner Merge');

    if (isPg) {
      await postgresStorage.upsertLead(updatedSurvivor);
      await postgresStorage.deleteLead(absorbedId);
      await postgresStorage.recordMerge(historyRecord);
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    res.json({ success: true, message: 'Merge successfully reversed. Absorbed lead restored.' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.get('/dedupe/history', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const history = isPg ? await postgresStorage.getMergeHistory() : storage.getMergeHistory();
    res.json(history);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.put('/pipeline/move', async (req: Request, res: Response) => {
  const { leadId, stageId, lostReason } = req.body;
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
        title: `Pipeline Stage Updated: ${targetStage?.name || stageId}`,
        outcome: `Transitioned from ${prevStageName} to ${targetStage?.name || stageId}${lostReason ? ` (${lostReason})` : ''}`,
        date: new Date().toISOString(),
        actor: author,
      });

      const updated = storage.upsertLead(lead);
      res.json(updated);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Tasks
protectedApi.get('/tasks', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const tasks = isPg ? await postgresStorage.getTasks() : storage.getTasks();
    res.json(tasks);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.post('/tasks', async (req: Request, res: Response) => {
  const author = req.owner?.fullName || 'Lead Intelligence Operator';
  try {
    const { isPg } = checkStorageEngine();
    const task = isPg
      ? await postgresStorage.createTask({ ...req.body, assignedTo: req.body.assignedTo || author })
      : storage.createTask({ ...req.body, assignedTo: req.body.assignedTo || author });
    res.status(201).json(task);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.put('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const updated = isPg ? await postgresStorage.updateTask(req.params.id, req.body) : storage.updateTask(req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.delete('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const success = isPg ? await postgresStorage.deleteTask(req.params.id) : storage.deleteTask(req.params.id);
    res.json({ success });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Outreach Campaigns & Approval Queue
protectedApi.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const campaigns = isPg ? await postgresStorage.getCampaigns() : storage.getCampaigns();
    res.json(campaigns);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.post('/campaigns', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const campaign = isPg ? await postgresStorage.createCampaign(req.body) : storage.createCampaign(req.body);
    res.status(201).json(campaign);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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

    const { targetLeadIds } = req.body;
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.post('/campaigns/:id/messages/:messageId/action', async (req: Request, res: Response) => {
  const { action } = req.body;
  const newStatus =
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'send' ? 'sent' : 'pending_approval';
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
            lead.pipelineStageId = 'stage-contacted';
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// AI Sales Intelligence
protectedApi.post('/ai/analyze-lead', async (req: Request, res: Response) => {
  const { leadId } = req.body;
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `AI analysis failed: ${msg}` });
  }
});

protectedApi.post('/ai/generate-pitch', async (req: Request, res: Response) => {
  const { leadId, valueProposition } = req.body;
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `AI pitch drafting failed: ${msg}` });
  }
});

protectedApi.post('/ai/meeting-brief', async (req: Request, res: Response) => {
  const { leadId } = req.body;
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Meeting brief generation failed: ${msg}` });
  }
});

protectedApi.post('/ai/market-report', async (req: Request, res: Response) => {
  const { country, industry } = req.body;
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Market report failed: ${msg}` });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: redactSecrets(msg) });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
        error: err.safeMessage,
        errorCategory: err.category,
        remediationHint: err.remediationHint,
      });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: redactSecrets(msg) });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: redactSecrets(msg) });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.put('/settings', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const updated = isPg ? await postgresStorage.updateSettings(req.body) : storage.updateSettings(req.body);
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: redactSecrets(msg) });
  }
});

// Data Export (RFC 4180 compliant with full international & identifier coverage)
protectedApi.get('/export/csv', async (req: Request, res: Response) => {
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
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=leads_export_${Date.now()}.csv`);
    res.send(csv);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

protectedApi.get('/export/json', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const leads = isPg ? await postgresStorage.getLeads() : storage.getLeads();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=leads_export_${Date.now()}.json`);
    res.send(JSON.stringify(leads, null, 2));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Mount protected API router
app.use('/api', protectedApi);

// --- VITE DEV / PRODUCTION STATIC SERVING & BOOTSTRAP ---
async function startServer() {
  // 1. Explicitly verify Neon / PostgreSQL connection during startup
  if (dbManager.isConfigured()) {
    const check = await dbManager.checkConnection(3, 1000);
    if (check.connected) {
      const preInspection = await migrator.inspectMigrationStatus();
      if (process.env.AUTO_RUN_MIGRATIONS === 'true') {
        console.log(`[Startup] PostgreSQL connected successfully (${check.latencyMs}ms). Running schema migrations...`);
        const migResult = await migrator.runMigrations();
        lastStartupMigrationResult = {
          attempted: true,
          success: migResult.success,
          applied: migResult.applied,
          alreadyApplied: migResult.alreadyApplied,
          error: migResult.error,
        };
        if (!migResult.success) {
          console.error(`[Startup] Schema migrations FAILED: ${migResult.error || 'Unknown error'}`);
        } else {
          console.log(`[Startup] Migrations succeeded — applied: ${migResult.applied.length}, already applied: ${migResult.alreadyApplied.length}`);
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
