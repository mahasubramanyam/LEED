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


dotenv.config();

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

  try {
    if (isDbReady) {
      const leads = await postgresStorage.getLeads();
      totalLeads = leads.length;
      const connectors = await postgresStorage.getConnectors();
      activeConnectorsCount = connectors.filter((c) => c.status === 'healthy').length;
    } else {
      const leads = storage.getLeads();
      totalLeads = leads.length;
      const connectors = storage.getConnectors();
      activeConnectorsCount = connectors.filter((c) => c.status === 'healthy').length;
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
    activeConnectors: `${activeConnectorsCount}/6`,
    storageEngine: isDbReady ? 'postgresql' : 'json_store',
    databaseConnected: isDbReady,
    databaseHealth: {
      isConfigured: dbHealth.isConfigured,
      isConnected: dbHealth.isConnected,
      engine: dbHealth.engine,
      error: dbHealth.error,
      consecutiveFailures: dbHealth.consecutiveFailures,
    },
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

// Live Database Diagnostics & Telemetry
protectedApi.get('/owner/diagnostics', async (req: Request, res: Response) => {
  try {
    const isPg = dbManager.isDbConnected();
    const dbHealth = dbManager.getHealthStatus();

    let details: any = null;
    if (isPg) {
      details = await postgresStorage.getDetailedDiagnostics();
    }

    res.json({
      connected: isPg,
      engine: isPg ? 'PostgreSQL 18.6 (Neon Serverless)' : 'json_store',
      health: dbHealth,
      diagnostics: details,
      security: {
        singleOwnerEnforced: true,
        singletonConstraint: 'uq_owner_singleton on owner_users',
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
      schemaTables = await migrator.getExistingTables();
    }

    res.json({
      configured: dbHealth.isConfigured,
      connected: isPg,
      engine: isPg ? 'postgresql' : IS_PROD ? 'unhealthy_disconnected' : 'json_store',
      health: dbHealth,
      postgresRecordCounts: pgRecordCounts,
      schemaTables,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to fetch diagnostics: ${msg}` });
  }
});

// Run Schema Migrations (DDL)
protectedApi.post('/database/run-migrations', async (req: Request, res: Response) => {
  try {
    const result = await migrator.runMigrations();
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Schema migration failed: ${msg}` });
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

// Leads Management
protectedApi.get('/leads', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const { search, country, status, stage, category, hasWebsite, hasEmail, hasPhone } = req.query;

    if (isPg) {
      const leads = await postgresStorage.getLeads({
        search: typeof search === 'string' ? search : undefined,
        country: typeof country === 'string' ? country : undefined,
        status: typeof status === 'string' ? status : undefined,
        stage: typeof stage === 'string' ? stage : undefined,
        category: typeof category === 'string' ? category : undefined,
        hasWebsite: hasWebsite === 'true',
        hasEmail: hasEmail === 'true',
        hasPhone: hasPhone === 'true',
      });
      res.json({ leads, total: leads.length });
    } else {
      let leads = storage.getLeads();
      if (search && typeof search === 'string') {
        const q = search.toLowerCase();
        leads = leads.filter(
          (l) =>
            l.companyName.toLowerCase().includes(q) ||
            (l.registrationNumber && l.registrationNumber.toLowerCase().includes(q)) ||
            (l.address?.city && l.address.city.toLowerCase().includes(q)) ||
            (l.domain && l.domain.toLowerCase().includes(q)) ||
            l.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      if (country && typeof country === 'string' && country !== 'ALL') {
        leads = leads.filter((l) => l.address?.countryCode === country || l.address?.country === country);
      }
      if (status && typeof status === 'string' && status !== 'ALL') {
        leads = leads.filter((l) => l.status === status);
      }
      if (stage && typeof stage === 'string' && stage !== 'ALL') {
        leads = leads.filter((l) => l.pipelineStageId === stage);
      }
      res.json({ leads, total: leads.length });
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

// Batch Import from CSV / JSON
protectedApi.post('/leads/batch-import', async (req: Request, res: Response) => {
  const { leads } = req.body;
  if (!Array.isArray(leads) || leads.length === 0) {
    res.status(400).json({ error: 'Array of leads is required' });
    return;
  }

  try {
    const { isPg } = checkStorageEngine();
    const result = isPg ? await postgresStorage.batchUpsertLeads(leads) : storage.batchUpsertLeads(leads);
    res.json({
      success: true,
      added: result.added,
      updated: result.updated,
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

// Multi-Source Discovery Engine
protectedApi.post('/discovery/search', async (req: Request, res: Response) => {
  const { query, countryCode, city, connectorId, autoSave } = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    res.status(400).json({ error: 'Search query is required' });
    return;
  }

  const trimmedQuery = query.trim();
  const cCode = (countryCode || '').toUpperCase();
  const results: CanonicalLead[] = [];
  const errors: string[] = [];
  let attribution = '';
  let providerNote = '';

  const { isPg } = checkStorageEngine();
  const settings = isPg ? await postgresStorage.getSettings() : storage.getSettings();

  // Securely wire Companies House API Key from environment or settings
  const chKey = process.env.COMPANIES_HOUSE_API_KEY || settings.companiesHouseApiKey;

  try {
    // 1. Norway Brreg
    if (connectorId === 'conn-brreg' || (!connectorId && cCode === 'NO')) {
      try {
        const brregRes = await searchBrreg(trimmedQuery, city);
        results.push(...brregRes.leads);
        attribution = 'Official open public data from the Brønnøysund Register Centre (NLOD license)';
        if (isPg) await postgresStorage.recordConnectorActivity('conn-brreg', true);
        else storage.recordConnectorActivity('conn-brreg', true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Brreg registry: ${msg}`);
        if (isPg) await postgresStorage.recordConnectorActivity('conn-brreg', false, msg);
        else storage.recordConnectorActivity('conn-brreg', false, msg);
      }
    }

    // 2. UK Companies House
    if (connectorId === 'conn-companies-house' || (!connectorId && cCode === 'GB')) {
      try {
        const ukRes = await searchCompaniesHouse(trimmedQuery, chKey, city);
        results.push(...ukRes.leads);
        attribution = 'UK Companies House (Open Government Licence v3.0)';
        if (ukRes.message) providerNote = ukRes.message;
        if (isPg) await postgresStorage.recordConnectorActivity('conn-companies-house', true);
        else storage.recordConnectorActivity('conn-companies-house', true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`UK Companies House: ${msg}`);
        if (isPg) await postgresStorage.recordConnectorActivity('conn-companies-house', false, msg);
        else storage.recordConnectorActivity('conn-companies-house', false, msg);
      }
    }

    // 3. Australia ABN
    if (connectorId === 'conn-abn' || (!connectorId && cCode === 'AU')) {
      try {
        const auRes = await searchAbn(trimmedQuery);
        results.push(...auRes.leads);
        attribution = 'Australian Business Register (Commonwealth of Australia Open Data)';
        if (isPg) await postgresStorage.recordConnectorActivity('conn-abn', true);
        else storage.recordConnectorActivity('conn-abn', true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`ABN Lookup: ${msg}`);
        if (isPg) await postgresStorage.recordConnectorActivity('conn-abn', false, msg);
        else storage.recordConnectorActivity('conn-abn', false, msg);
      }
    }

    // 4. OpenStreetMap / Nominatim POI
    if (connectorId === 'conn-osm' || (!connectorId && results.length === 0)) {
      try {
        const osmRes = await searchOpenStreetMap(trimmedQuery, cCode, city);
        results.push(...osmRes.leads);
        if (!attribution) attribution = '© OpenStreetMap contributors (ODbL License)';
        if (isPg) await postgresStorage.recordConnectorActivity('conn-osm', true);
        else storage.recordConnectorActivity('conn-osm', true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`OpenStreetMap: ${msg}`);
        if (isPg) await postgresStorage.recordConnectorActivity('conn-osm', false, msg);
        else storage.recordConnectorActivity('conn-osm', false, msg);
      }
    }

    if (autoSave && results.length > 0) {
      if (isPg) await postgresStorage.batchUpsertLeads(results);
      else storage.batchUpsertLeads(results);
    }

    res.json({
      leads: results,
      totalDiscovered: results.length,
      errors: errors.length > 0 ? errors : undefined,
      attribution,
      providerNote,
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

  try {
    const inspection = await inspectWebsite(url);
    const { isPg } = checkStorageEngine();

    if (isPg) {
      await postgresStorage.recordConnectorActivity('conn-web-inspector', inspection.securityCheck.passed, inspection.securityCheck.reason);
    } else {
      storage.recordConnectorActivity('conn-web-inspector', inspection.securityCheck.passed, inspection.securityCheck.reason);
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

// Connectors Health & Credentials
protectedApi.get('/connectors', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const connectors = isPg ? await postgresStorage.getConnectors() : storage.getConnectors();
    res.json(connectors);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
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
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// Data Export
protectedApi.get('/export/csv', async (req: Request, res: Response) => {
  try {
    const { isPg } = checkStorageEngine();
    const leads = isPg ? await postgresStorage.getLeads() : storage.getLeads();
    const headers = [
      'ID',
      'Company Name',
      'Registration Number',
      'Registration Type',
      'Status',
      'Confidence Score',
      'Industry',
      'Category',
      'City',
      'Country',
      'Website',
      'Email',
      'Phone',
      'Opportunity Value',
      'Created At',
    ];

    const rows = leads.map((l) => [
      `"${l.id}"`,
      `"${l.companyName.replace(/"/g, '""')}"`,
      `"${l.registrationNumber || ''}"`,
      `"${l.registrationType || ''}"`,
      `"${l.status}"`,
      `"${l.confidenceScore}%"`,
      `"${(l.industry || '').replace(/"/g, '""')}"`,
      `"${(l.category || '').replace(/"/g, '""')}"`,
      `"${(l.address?.city || '').replace(/"/g, '""')}"`,
      `"${l.address?.country || ''}"`,
      `"${l.website || ''}"`,
      `"${l.email || ''}"`,
      `"${l.phone || ''}"`,
      `"${l.opportunityValue || 0}"`,
      `"${l.createdAt}"`,
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
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
    res.setHeader('Content-Type', 'application/json');
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
      console.log(`[Startup] PostgreSQL connected successfully (${check.latencyMs}ms). Running schema migrations...`);
      const migResult = await migrator.runMigrations();
      console.log(`[Startup] Migrations applied: ${migResult.applied.length}, already applied: ${migResult.alreadyApplied.length}`);
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
