import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { storage } from './server/storage.js';
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
import { ownerService } from './server/auth/ownerService.js';
import { generateCsrfToken, setCsrfCookie, validateCsrf } from './server/auth/csrf.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// CSRF Token Cookie Provisioning Middleware
app.use((req: Request, res: Response, next) => {
  if (!req.cookies?.leed_csrf) {
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
  }
  next();
});

// ==========================================
// 1. PUBLIC UNRESTRICTED ENDPOINTS
// ==========================================

// System Health & Observability
app.get('/api/status', async (req: Request, res: Response) => {
  const leads = storage.getLeads();
  const connectors = storage.getConnectors();
  const activeConnectors = connectors.filter((c) => c.status === 'healthy').length;
  const initialized = await ownerService.isOwnerInitialized();

  res.json({
    status: 'online',
    version: '1.0.0-production',
    mode: 'Single-Owner Private Application',
    uptimeSeconds: Math.floor(process.uptime()),
    totalLeads: leads.length,
    activeConnectors: `${activeConnectors}/${connectors.length}`,
    storageEngine: storage.getStorageEngine(),
    databaseConnected: storage.isPostgresConnected(),
    ownerInitialized: initialized,
    timestamp: new Date().toISOString(),
    aiEngineAvailable: !!process.env.GEMINI_API_KEY,
  });
});

// CSRF Token Endpoint (for frontend retrieval)
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

// Owner Setup (One-time only, locked forever after)
app.post('/api/auth/setup', async (req: Request, res: Response) => {
  const { fullName, email, password } = req.body;
  try {
    const owner = await ownerService.setupOwner(fullName, email, password);
    // Automatically log in after setup
    const loginResult = await ownerService.login(email, password, req.ip, req.headers['user-agent']);
    setSessionCookie(res, loginResult.rawToken);
    res.status(201).json({
      success: true,
      owner: loginResult.owner,
      token: loginResult.rawToken,
      message: 'Owner initialized successfully. Platform locked to single-owner mode.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// Owner Login (Rate-limited, sets HTTP-only cookie)
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const result = await ownerService.login(email, password, req.ip, req.headers['user-agent']);
    setSessionCookie(res, result.rawToken);
    res.json({
      success: true,
      owner: result.owner,
      token: result.rawToken,
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

// Change Owner Password (Revokes older sessions)
protectedApi.post('/auth/change-password', async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!req.owner) {
    res.status(401).json({ error: 'Unauthenticated' });
    return;
  }

  try {
    await ownerService.changePassword(req.owner.id, currentPassword, newPassword, req.sessionToken);
    // Issue fresh session for current client
    const freshLogin = await ownerService.login(req.owner.email, newPassword, req.ip, req.headers['user-agent']);
    setSessionCookie(res, freshLogin.rawToken);
    res.json({ success: true, message: 'Password changed successfully. Prior sessions revoked.' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// Database Status & Diagnostics
protectedApi.get('/database/status', async (req: Request, res: Response) => {
  try {
    const diagnostics = await storage.getDatabaseDiagnostics();
    res.json(diagnostics);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to fetch diagnostics: ${msg}` });
  }
});

// Run Schema Migrations (DDL)
protectedApi.post('/database/run-migrations', async (req: Request, res: Response) => {
  try {
    const result = await storage.runSchemaMigrations();
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
    const summary = await storage.runJsonMigration(dryRun);
    res.json(summary);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `JSON migration failed: ${msg}` });
  }
});

// Leads Management
protectedApi.get('/leads', (req: Request, res: Response) => {
  let leads = storage.getLeads();

  const { search, country, status, stage, category, hasWebsite, hasEmail, hasPhone } = req.query;

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

  if (category && typeof category === 'string' && category !== 'ALL') {
    leads = leads.filter((l) => l.category.toLowerCase().includes(category.toLowerCase()));
  }

  if (hasWebsite === 'true') {
    leads = leads.filter((l) => !!l.website);
  }

  if (hasEmail === 'true') {
    leads = leads.filter((l) => !!l.email);
  }

  if (hasPhone === 'true') {
    leads = leads.filter((l) => !!l.phone);
  }

  res.json({
    leads,
    total: leads.length,
  });
});

protectedApi.get('/leads/:id', (req: Request, res: Response) => {
  const lead = storage.getLead(req.params.id);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  res.json(lead);
});

protectedApi.post('/leads', (req: Request, res: Response) => {
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

  const saved = storage.upsertLead(newLead);
  res.status(201).json(saved);
});

protectedApi.put('/leads/:id', (req: Request, res: Response) => {
  const existing = storage.getLead(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  const updated = storage.upsertLead({ ...existing, ...req.body, id: req.params.id });
  res.json(updated);
});

protectedApi.delete('/leads/:id', (req: Request, res: Response) => {
  const success = storage.deleteLead(req.params.id);
  if (!success) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }
  res.json({ success: true, deletedId: req.params.id });
});

// Batch Import from CSV / JSON
protectedApi.post('/leads/batch-import', (req: Request, res: Response) => {
  const { leads } = req.body;
  if (!Array.isArray(leads) || leads.length === 0) {
    res.status(400).json({ error: 'Array of leads is required' });
    return;
  }

  const result = storage.batchUpsertLeads(leads);
  res.json({
    success: true,
    added: result.added,
    updated: result.updated,
    totalProcessed: leads.length,
  });
});

// Add Note to Lead
protectedApi.post('/leads/:id/notes', (req: Request, res: Response) => {
  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: 'Note content is required' });
    return;
  }
  const lead = storage.getLead(req.params.id);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const author = req.owner?.fullName || storage.getSettings().ownerName;
  const note = {
    id: `note-${Date.now()}`,
    content: String(content),
    createdAt: new Date().toISOString(),
    author,
  };

  lead.notes.unshift(note);
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
});

// Add Activity to Lead
protectedApi.post('/leads/:id/activities', (req: Request, res: Response) => {
  const { type, title, outcome, notes } = req.body;
  if (!title) {
    res.status(400).json({ error: 'Activity title is required' });
    return;
  }
  const lead = storage.getLead(req.params.id);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const author = req.owner?.fullName || storage.getSettings().ownerName;
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

  const settings = storage.getSettings();

  try {
    // 1. Norway Brreg
    if (connectorId === 'conn-brreg' || (!connectorId && cCode === 'NO')) {
      try {
        const brregRes = await searchBrreg(trimmedQuery, city);
        results.push(...brregRes.leads);
        attribution = 'Official open public data from the Brønnøysund Register Centre (NLOD license)';
        storage.recordConnectorActivity('conn-brreg', true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Brreg registry: ${msg}`);
        storage.recordConnectorActivity('conn-brreg', false, msg);
      }
    }

    // 2. UK Companies House
    if (connectorId === 'conn-companies-house' || (!connectorId && cCode === 'GB')) {
      try {
        const ukRes = await searchCompaniesHouse(trimmedQuery, settings.companiesHouseApiKey, city);
        results.push(...ukRes.leads);
        attribution = 'UK Companies House (Open Government Licence v3.0)';
        if (ukRes.message) {
          providerNote = ukRes.message;
        }
        storage.recordConnectorActivity('conn-companies-house', true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`UK Companies House: ${msg}`);
        storage.recordConnectorActivity('conn-companies-house', false, msg);
      }
    }

    // 3. Australia ABN
    if (connectorId === 'conn-abn' || (!connectorId && cCode === 'AU')) {
      try {
        const auRes = await searchAbn(trimmedQuery);
        results.push(...auRes.leads);
        attribution = 'Australian Business Register (Commonwealth of Australia Open Data)';
        storage.recordConnectorActivity('conn-abn', true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`ABN Lookup: ${msg}`);
        storage.recordConnectorActivity('conn-abn', false, msg);
      }
    }

    // 4. OpenStreetMap / Nominatim POI
    if (connectorId === 'conn-osm' || (!connectorId && results.length === 0)) {
      try {
        const osmRes = await searchOpenStreetMap(trimmedQuery, cCode, city);
        results.push(...osmRes.leads);
        if (!attribution) attribution = '© OpenStreetMap contributors (ODbL License)';
        storage.recordConnectorActivity('conn-osm', true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`OpenStreetMap: ${msg}`);
        storage.recordConnectorActivity('conn-osm', false, msg);
      }
    }

    if (autoSave && results.length > 0) {
      storage.batchUpsertLeads(results);
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
    storage.recordConnectorActivity('conn-web-inspector', inspection.securityCheck.passed, inspection.securityCheck.reason);

    if (leadId && inspection.isOnline) {
      const lead = storage.getLead(leadId);
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

        storage.upsertLead(lead);
      }
    }

    res.json(inspection);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Inspection failed: ${msg}` });
  }
});

// Deduplication & Merge Engine
protectedApi.get('/dedupe/candidates', (req: Request, res: Response) => {
  const leads = storage.getLeads();
  const candidates = detectDuplicates(leads);
  res.json({ candidates, count: candidates.length });
});

protectedApi.post('/dedupe/merge', (req: Request, res: Response) => {
  const { survivorId, absorbedId, reason } = req.body;
  if (!survivorId || !absorbedId) {
    res.status(400).json({ error: 'Both survivorId and absorbedId are required' });
    return;
  }

  const survivor = storage.getLead(survivorId);
  const absorbed = storage.getLead(absorbedId);

  if (!survivor || !absorbed) {
    res.status(404).json({ error: 'One or both leads not found' });
    return;
  }

  const { updatedSurvivor, historyRecord } = mergeLeads(survivor, absorbed, reason || 'Manual Owner Merge');

  storage.upsertLead(updatedSurvivor);
  storage.deleteLead(absorbedId);
  storage.recordMerge(historyRecord);

  res.json({
    success: true,
    survivor: updatedSurvivor,
    mergeHistoryId: historyRecord.id,
  });
});

protectedApi.post('/dedupe/undo/:historyId', (req: Request, res: Response) => {
  const success = storage.undoMerge(req.params.historyId);
  if (!success) {
    res.status(404).json({ error: 'Merge history snapshot not found or already undone' });
    return;
  }
  res.json({ success: true, message: 'Merge successfully reversed. Absorbed lead restored.' });
});

protectedApi.get('/dedupe/history', (req: Request, res: Response) => {
  res.json(storage.getMergeHistory());
});

// Pipeline & Stages
protectedApi.get('/pipeline/stages', (req: Request, res: Response) => {
  const stages = storage.getStages();
  const leads = storage.getLeads();

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
});

protectedApi.put('/pipeline/move', (req: Request, res: Response) => {
  const { leadId, stageId, lostReason } = req.body;
  const lead = storage.getLead(leadId);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  const stages = storage.getStages();
  const targetStage = stages.find((s) => s.id === stageId);
  if (!targetStage) {
    res.status(400).json({ error: 'Invalid stage ID' });
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

  const author = req.owner?.fullName || storage.getSettings().ownerName;
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
});

// Tasks
protectedApi.get('/tasks', (req: Request, res: Response) => {
  res.json(storage.getTasks());
});

protectedApi.post('/tasks', (req: Request, res: Response) => {
  const author = req.owner?.fullName || storage.getSettings().ownerName;
  const task = storage.createTask({
    ...req.body,
    assignedTo: req.body.assignedTo || author,
  });
  res.status(201).json(task);
});

protectedApi.put('/tasks/:id', (req: Request, res: Response) => {
  const updated = storage.updateTask(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(updated);
});

protectedApi.delete('/tasks/:id', (req: Request, res: Response) => {
  const success = storage.deleteTask(req.params.id);
  res.json({ success });
});

// Outreach Campaigns & Approval Queue
protectedApi.get('/campaigns', (req: Request, res: Response) => {
  res.json(storage.getCampaigns());
});

protectedApi.post('/campaigns', (req: Request, res: Response) => {
  const campaign = storage.createCampaign(req.body);
  res.status(201).json(campaign);
});

protectedApi.post('/campaigns/:id/generate-messages', async (req: Request, res: Response) => {
  const campaign = storage.getCampaigns().find((c) => c.id === req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }

  const { targetLeadIds } = req.body;
  const leads = storage.getLeads().filter((l) => (targetLeadIds ? targetLeadIds.includes(l.id) : true));
  const settings = storage.getSettings();
  const author = req.owner?.fullName || settings.ownerName;

  for (const lead of leads) {
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

    campaign.messages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      campaignId: campaign.id,
      leadId: lead.id,
      leadCompanyName: lead.companyName,
      recipientEmail: lead.email,
      subject,
      content,
      status: 'pending_approval',
    });
  }

  res.json(campaign);
});

protectedApi.post('/campaigns/:id/messages/:messageId/action', (req: Request, res: Response) => {
  const { action } = req.body;
  const newStatus =
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'send' ? 'sent' : 'pending_approval';

  const success = storage.updateCampaignMessageStatus(req.params.id, req.params.messageId, newStatus);
  if (!success) {
    res.status(404).json({ error: 'Campaign or message not found' });
    return;
  }

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
          actor: req.owner?.fullName || storage.getSettings().ownerName,
        });
        lead.status = 'contacted';
        lead.pipelineStageId = 'stage-contacted';
        storage.upsertLead(lead);
      }
    }
  }

  res.json({ success: true, newStatus });
});

// AI Sales Intelligence
protectedApi.post('/ai/analyze-lead', async (req: Request, res: Response) => {
  const { leadId } = req.body;
  const lead = storage.getLead(leadId);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  try {
    const analysis = await analyzeLeadWithAi(lead);
    storage.recordConnectorActivity('conn-gemini', true);
    res.json(analysis);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    storage.recordConnectorActivity('conn-gemini', false, msg);
    res.status(500).json({ error: `AI analysis failed: ${msg}` });
  }
});

protectedApi.post('/ai/generate-pitch', async (req: Request, res: Response) => {
  const { leadId, valueProposition } = req.body;
  const lead = storage.getLead(leadId);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  try {
    const pitch = await generateSalesPitchWithAi(lead, valueProposition);
    storage.recordConnectorActivity('conn-gemini', true);
    res.json(pitch);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    storage.recordConnectorActivity('conn-gemini', false, msg);
    res.status(500).json({ error: `AI pitch drafting failed: ${msg}` });
  }
});

protectedApi.post('/ai/meeting-brief', async (req: Request, res: Response) => {
  const { leadId } = req.body;
  const lead = storage.getLead(leadId);
  if (!lead) {
    res.status(404).json({ error: 'Lead not found' });
    return;
  }

  try {
    const brief = await generateMeetingBriefWithAi(lead);
    storage.recordConnectorActivity('conn-gemini', true);
    res.json(brief);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    storage.recordConnectorActivity('conn-gemini', false, msg);
    res.status(500).json({ error: `Meeting brief generation failed: ${msg}` });
  }
});

protectedApi.post('/ai/market-report', async (req: Request, res: Response) => {
  const { country, industry } = req.body;
  const allLeads = storage.getLeads();
  const filtered = allLeads.filter(
    (l) => (!country || l.address?.countryCode === country) && (!industry || l.industry.includes(industry))
  );

  try {
    const report = await generateMarketReportWithAi(country || 'Global', industry || 'B2B Services', filtered);
    storage.recordConnectorActivity('conn-gemini', true);
    res.json(report);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    storage.recordConnectorActivity('conn-gemini', false, msg);
    res.status(500).json({ error: `Market report failed: ${msg}` });
  }
});

// Connectors Health & Credentials
protectedApi.get('/connectors', (req: Request, res: Response) => {
  res.json(storage.getConnectors());
});

// Settings
protectedApi.get('/settings', (req: Request, res: Response) => {
  const current = storage.getSettings();
  const masked = {
    ...current,
    companiesHouseApiKey: current.companiesHouseApiKey
      ? `${current.companiesHouseApiKey.slice(0, 4)}...${current.companiesHouseApiKey.slice(-4)}`
      : '',
  };
  res.json(masked);
});

protectedApi.put('/settings', (req: Request, res: Response) => {
  const updated = storage.updateSettings(req.body);
  res.json(updated);
});

// Data Export
protectedApi.get('/export/csv', (req: Request, res: Response) => {
  const leads = storage.getLeads();
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
});

protectedApi.get('/export/json', (req: Request, res: Response) => {
  const leads = storage.getLeads();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=leads_export_${Date.now()}.json`);
  res.send(JSON.stringify(leads, null, 2));
});

// Mount protected API router
app.use('/api', protectedApi);

// --- VITE DEV / PRODUCTION STATIC SERVING ---
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
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
