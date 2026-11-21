/**
 * Phase 18 Isolated End-to-End Integration & Security Readiness Test Suite.
 *
 * Strictly isolated:
 * - Uses temporary StorageManager directories (cleaned up in finally blocks).
 * - Never writes to Neon PostgreSQL, data/pipeline_store.json, or data/owner_auth.json.
 * - Never sends real emails, LinkedIn messages, or live external HTTP requests.
 * - Clearly separates real in-process integration (Express HTTP, auth/CSRF, StorageManager,
 *   CrmStorageFacade, Dedupe, ImportService, Enrichment, AI context boundaries, Outreach,
 *   Workflows, BI, Pagination, Caching, Circuit Breaker, JSON backup/restore) from mocked
 *   external providers (deterministic fetchFn, DNS hooks, AI generator hook, outreach email transport hook).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';

import { StorageManager } from '../server/storage.js';
import {
  createCrmInteraction,
  createCrmOpportunity,
  createCrmPrivateNote,
  createCrmStorageFacade,
  createExtendedTask,
  listAllCrmOpportunities,
  listAllExtendedTasks,
  updateCrmOpportunity,
} from '../server/crm/crmStoreHelper.js';
import {
  buildCompanyRelationshipProfile,
  buildPersonRelationshipProfile,
} from '../server/crm/relationshipEngine.js';
import { buildReminderCenter } from '../server/crm/reminderEngine.js';
import { hashPassword, verifyPassword } from '../server/auth/password.js';
import { hashSessionToken } from '../server/auth/session.js';
import {
  generateCsrfToken,
  setCsrfCookie,
  validateCsrf,
  validateSameOrigin,
} from '../server/auth/csrf.js';
import {
  buildContentSecurityPolicy,
  securityHeadersMiddleware,
} from '../server/security/headers.js';
import { sanitizeApiError } from '../server/security/errorHandler.js';
import { buildCsvDocument, escapeCsvCell } from '../shared/csvUtils.js';
import { classifyDecisionMakerRole } from '../shared/decisionMakerRoles.js';
import { detectDuplicates, mergeLeads } from '../server/connectors/dedupeEngine.js';
import { ConnectorRegistry } from '../server/connectors/core/registry.js';
import { ConnectorExecutionEngine } from '../server/connectors/core/executionEngine.js';
import { CredentialManager } from '../server/connectors/core/credentialManager.js';
import { classifyConnectorError, ConnectorError } from '../server/connectors/core/errors.js';
import type {
  ConnectorMetadata,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
  StandardizedConnectorResult,
} from '../server/connectors/core/types.js';
import { DiscoveryService } from '../server/discovery/discoveryService.js';
import {
  verifyLeadWithOfficialRegistry,
  applyOfficialVerificationToLead,
} from '../server/verification/registryVerificationService.js';
import {
  previewCompanyEnrichment,
  applyApprovedCompanyEnrichmentToClone,
} from '../server/enrichment/enrichmentOrchestrator.js';
import { evaluateCompanyDataQuality } from '../server/enrichment/dataQualityEngine.js';
import { ImportService, ImportServiceError } from '../server/import/importService.js';
import { setAiGeneratorOverrideForTests } from '../server/ai/aiProvider.js';
import { executeControlledAgentTool } from '../server/ai/agentTools.js';
import {
  generateCompanySalesIntelligence,
  generateSalesCommunicationDraft,
} from '../server/ai/salesIntelligenceService.js';
import {
  addSuppressionEntry,
  approveOutreachMessage,
  createOutreachCampaign,
  dispatchApprovedOutreachMessage,
  enrollRecipientsInCampaign,
  generateOutreachMessageDraft,
} from '../server/outreach/outreachService.js';
import { registerOutreachRoutes } from '../server/outreach/outreachRoutes.js';
import {
  setOutreachEnvOverrideForTests,
  setOutreachProviderTransportForTests,
} from '../server/outreach/providerAbstraction.js';
import {
  createWorkflowDefinition,
  decideQueuedWorkflowStep,
  dispatchWorkflowEvent,
  listWorkflowsWorkspace,
} from '../server/bi/workflowEngine.js';
import { buildBiAnalyticsDashboardCached } from '../server/bi/biAnalyticsService.js';
import { generateBiReport, exportBiReportToCsv } from '../server/bi/reportingService.js';
import { LeedCacheManager } from '../server/perf/cacheManager.js';
import { runIsolatedJsonBackupRestoreDrill } from '../server/perf/backupRestoreService.js';
import {
  MAX_PAGE_SIZE,
  paginateArray,
  parsePaginationParams,
  stableSortBy,
} from '../shared/paginationUtils.js';
import type { CanonicalLead } from '../server/types.js';

function createTempStore(): { dir: string; store: StorageManager; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-phase18-e2e-'));
  const store = new StorageManager(path.join(dir, 'pipeline_store.json'));
  for (const l of [...store.getLeads()]) store.deleteLead(l.id);
  for (const t of [...store.getTasks()]) store.deleteTask(t.id);
  return {
    dir,
    store,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    },
  };
}

function makeSyntheticLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = new Date().toISOString();
  return {
    id: overrides.id || `lead-${crypto.randomBytes(4).toString('hex')}`,
    companyName: overrides.companyName || 'Nordic Precision Robotics AS',
    legalName: overrides.legalName || 'NORDIC PRECISION ROBOTICS AS',
    registrationNumber: overrides.registrationNumber || '924512345',
    registrationType: overrides.registrationType || 'ORG_NR',
    companyStatus: overrides.companyStatus || 'active',
    website: overrides.website || 'https://nordicrobotics.example',
    domain: overrides.domain || 'nordicrobotics.example',
    email: overrides.email !== undefined ? overrides.email : 'hello@nordicrobotics.example',
    emailStatus: overrides.emailStatus || 'unverified',
    phone: overrides.phone || '+47 21 98 44 00',
    phoneNormalized: overrides.phoneNormalized || '+4721984400',
    address: overrides.address || {
      street: 'Teknologiveien 12',
      city: 'Oslo',
      region: 'Oslo',
      postalCode: '0349',
      country: 'Norway',
      countryCode: 'NO',
    },
    industry: overrides.industry || 'Industrial Automation',
    category: overrides.category || 'Robotics',
    confidenceScore: overrides.confidenceScore ?? 72,
    confidenceSignals: overrides.confidenceSignals || ['User Created'],
    sources: overrides.sources || [
      {
        sourceName: 'Synthetic E2E Fixture',
        retrievedAt: now,
      },
    ],
    identifiers: overrides.identifiers || [
      {
        type: 'ORG_NR',
        value: '924512345',
        normalizedValue: '924512345',
        countryCode: 'NO',
        verified: false,
        status: 'user_provided',
      },
    ],
    status: overrides.status || 'qualified',
    pipelineStageId: overrides.pipelineStageId || 'stage-qualified',
    opportunityValue: overrides.opportunityValue ?? 45000,
    currency: overrides.currency || 'EUR',
    winProbability: overrides.winProbability ?? 50,
    tags: overrides.tags || ['nordics', 'automation'],
    notes: overrides.notes || [],
    activities: overrides.activities || [],
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    ...overrides,
  };
}

function makeMockConnector(
  id: string,
  name: string,
  opts: {
    sourceCategory?: ConnectorMetadata['sourceCategory'];
    supportedCountries?: string[];
    supportsAllCountries?: boolean;
    capabilities?: ConnectorMetadata['capabilities'];
    searchFn: (req: ConnectorSearchRequest) => Promise<ConnectorSearchResponse>;
  }
): IConnector {
  const metadata: ConnectorMetadata = {
    id,
    name,
    shortName: name,
    version: '1.0.0',
    description: `${name} isolated test connector`,
    sourceCategory: opts.sourceCategory || 'government_registry',
    accessMode: 'live_api',
    capabilities: opts.capabilities || ['company_search'],
    supportedCountries: opts.supportedCountries || ['NO'],
    supportsAllCountries: opts.supportsAllCountries ?? false,
    supportsRegionFilter: false,
    supportsCityFilter: true,
    supportedIdentifierTypes: ['NO_ORGNR'],
    credentialRequirements: {
      authType: 'none_open',
      required: false,
      envFallbackKeys: [],
      fields: [],
      setupInstructions: 'None required for isolated test fixture',
    },
    executionPolicy: {
      timeoutMs: 2000,
      maxRetries: 0,
      baseBackoffMs: 5,
      maxBackoffMs: 10,
      maxConcurrency: 4,
      rateLimit: { maxRequests: 100, windowMs: 60_000, note: 'Test fixture' },
      defaultPageSize: 10,
      maxPageSize: 50,
    },
    attribution: name,
    license: 'Test',
  };

  return {
    id,
    getMetadata: () => metadata,
    validateConnection: async () => ({
      ok: true,
      healthState: 'operational',
      message: 'ok',
      latencyMs: 1,
      isLiveApi: true,
      checkedAt: new Date().toISOString(),
    }),
    search: async (req) => opts.searchFn(req),
    normalizeResult: (raw) => raw as StandardizedConnectorResult,
    classifyError: (err) => classifyConnectorError(err, id),
    getHealth: () => ({
      connectorId: id,
      healthState: 'operational',
      operational: true,
      summary: 'ok',
    }),
  };
}

async function startHttpServer(app: express.Express): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const srv = http.createServer(app);
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const addr = srv.address();
  assert(addr && typeof addr === 'object');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => srv.close(() => resolve())),
  };
}

// ============================================================================
// SCENARIO 1 & 14: Owner Login, Protected Workspace Access, Auth, CSRF & CSP
// ============================================================================
test('Phase 18 E2E [1 & 14]: Owner auth lifecycle, protected workspace, same-origin auth guard, CSRF double-submit & strict prod CSP', async () => {
  const sessions = new Map<string, { ownerEmail: string; revoked: boolean }>();
  const ownerPasswordHash = await hashPassword('LeedOwner#Phase18!Strong');
  const ownerEmail = 'owner@leed-isolated.test';

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeadersMiddleware(true));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/auth/csrf', (_req, res) => {
    const token = generateCsrfToken();
    setCsrfCookie(res, token);
    res.json({ csrfToken: token });
  });

  const requireSameOriginAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!validateSameOrigin(req)) {
      res.status(403).json({ error: 'Cross-origin request blocked.', code: 'CSRF_CROSS_ORIGIN' });
      return;
    }
    next();
  };

  app.post('/api/auth/login', requireSameOriginAuth, async (req, res) => {
    const { email, password } = req.body || {};
    if (email !== ownerEmail || !(await verifyPassword(String(password || ''), ownerPasswordHash))) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }
    const rawToken = crypto.randomBytes(32).toString('hex');
    sessions.set(hashSessionToken(rawToken), { ownerEmail, revoked: false });
    res.cookie('leed_session', rawToken, { httpOnly: true, secure: true, sameSite: 'none', path: '/' });
    res.json({ success: true, token: rawToken, owner: { email: ownerEmail, role: 'owner' } });
  });

  app.post('/api/auth/logout', requireSameOriginAuth, (req, res) => {
    const rawToken = req.cookies?.leed_session || req.headers.authorization?.replace('Bearer ', '');
    if (rawToken) {
      const s = sessions.get(hashSessionToken(rawToken));
      if (s) s.revoked = true;
    }
    res.json({ success: true });
  });

  const protectedApi = express.Router();
  protectedApi.use((req, res, next) => {
    const rawToken = req.cookies?.leed_session || req.headers.authorization?.replace('Bearer ', '');
    const sess = rawToken ? sessions.get(hashSessionToken(rawToken)) : undefined;
    if (!sess || sess.revoked) {
      res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHORIZED' });
      return;
    }
    next();
  });
  protectedApi.use(validateCsrf);
  protectedApi.get('/workspace', (_req, res) => res.json({ workspace: 'owner-private', ok: true }));
  protectedApi.post('/workspace/mutate', (_req, res) => res.json({ mutated: true }));
  app.use('/api', protectedApi);

  const srv = await startHttpServer(app);
  try {
    // Unauthenticated access denied
    const unauth = await fetch(`${srv.baseUrl}/api/workspace`);
    assert.equal(unauth.status, 401);

    // Cross-origin login attempt blocked (Phase 18 remediation verified)
    const evilLogin = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil-attacker.example' },
      body: JSON.stringify({ email: ownerEmail, password: 'LeedOwner#Phase18!Strong' }),
    });
    assert.equal(evilLogin.status, 403);
    assert.equal(((await evilLogin.json()) as any).code, 'CSRF_CROSS_ORIGIN');

    // Legitimate owner login succeeds
    const loginRes = await fetch(`${srv.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ownerEmail, password: 'LeedOwner#Phase18!Strong' }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = (await loginRes.json()) as { token: string };
    assert.ok(loginData.token.length >= 32);

    // Cookie-based GET succeeds
    const okGet = await fetch(`${srv.baseUrl}/api/workspace`, {
      headers: { Cookie: `leed_session=${loginData.token}` },
    });
    assert.equal(okGet.status, 200);

    // Cookie-based POST without CSRF header fails closed with 403
    const csrfRes = await fetch(`${srv.baseUrl}/api/auth/csrf`);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    const missingCsrf = await fetch(`${srv.baseUrl}/api/workspace/mutate`, {
      method: 'POST',
      headers: { Cookie: `leed_session=${loginData.token}; leed_csrf=${csrfToken}` },
    });
    assert.equal(missingCsrf.status, 403);

    // Cookie-based POST with valid double-submit CSRF token succeeds
    const validCsrf = await fetch(`${srv.baseUrl}/api/workspace/mutate`, {
      method: 'POST',
      headers: {
        Cookie: `leed_session=${loginData.token}; leed_csrf=${csrfToken}`,
        'x-leed-csrf-token': csrfToken,
      },
    });
    assert.equal(validCsrf.status, 200);

    // Logout revokes session so subsequent access fails with 401
    const logoutRes = await fetch(`${srv.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(logoutRes.status, 200);

    const postLogout = await fetch(`${srv.baseUrl}/api/workspace`, {
      headers: { Authorization: `Bearer ${loginData.token}` },
    });
    assert.equal(postLogout.status, 401);

    // Production CSP and index.html check (Phase 18 remediation: zero inline <script> in index.html)
    const prodCsp = buildContentSecurityPolicy(true);
    assert.ok(prodCsp.includes("script-src 'self'"));
    const scriptDirective = prodCsp.split(';').find((d) => d.trim().startsWith('script-src')) || '';
    assert.ok(!scriptDirective.includes("'unsafe-inline'"), 'Prod script-src must not allow unsafe-inline');
    const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
    assert.ok(indexHtml.includes('<script src="/theme-init.js"></script>'));
    assert.ok(!/<script>\s*\(function/i.test(indexHtml), 'index.html must not contain inline scripts blocked by prod CSP');
    assert.ok(fs.existsSync(path.resolve(process.cwd(), 'public', 'theme-init.js')));
  } finally {
    await srv.close();
  }
});

// ============================================================================
// SCENARIO 2 & 3: Business Discovery, Deduplication & Official Registry Save
// ============================================================================
test('Phase 18 E2E [2 & 3]: Discovery orchestration (mocked adapters), cross-source dedupe, merge undo & verified CRM save', async () => {
  const { store, cleanup } = createTempStore();
  try {
    const registry = new ConnectorRegistry();
    const engine = new ConnectorExecutionEngine(new CredentialManager());
    const now = new Date().toISOString();

    const mockRegistryConnector = makeMockConnector('conn-brreg', 'Brønnøysundregistrene (Mocked E2E)', {
      sourceCategory: 'government_registry',
      supportedCountries: ['NO'],
      capabilities: ['company_search', 'registry_lookup'],
      searchFn: async () => ({
        results: [
          {
            providerId: 'conn-brreg',
            providerName: 'Brønnøysundregistrene',
            sourceCategory: 'government_registry',
            accessMode: 'live_api',
            countryCode: 'NO',
            externalSourceId: '924512345',
            sourceUrl: 'https://data.brreg.no/enhetsregisteret/oppslag/enheter/924512345',
            company: {
              companyName: 'Nordic Precision Robotics AS',
              legalName: 'NORDIC PRECISION ROBOTICS AS',
              registrationNumber: '924512345',
              registrationType: 'NO_ORGNR',
              companyStatus: 'active',
              website: 'https://nordicrobotics.example',
              domain: 'nordicrobotics.example',
              industry: 'Industrial Automation',
              address: {
                street: 'Teknologiveien 12',
                city: 'Oslo',
                postalCode: '0349',
                country: 'Norway',
                countryCode: 'NO',
              },
            },
            retrievedAt: now,
            verificationStatus: 'officially_verified',
            confidence: { supported: true, score: 95, signals: ['Official Registry Match'] },
            providerMetadata: {},
          },
        ],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1, hasMore: false },
        rawCount: 1,
        attribution: 'Mocked Official Registry',
        notes: [],
        isLiveApi: true,
      }),
    });

    const mockDirectoryConnector = makeMockConnector('conn-osm', 'OpenStreetMap (Mocked E2E)', {
      sourceCategory: 'maps_geo',
      supportedCountries: ['GLOBAL'],
      supportsAllCountries: true,
      capabilities: ['company_search'],
      searchFn: async () => ({
        results: [
          {
            providerId: 'conn-osm',
            providerName: 'OpenStreetMap',
            sourceCategory: 'maps_geo',
            accessMode: 'live_api',
            countryCode: 'NO',
            externalSourceId: 'osm-999',
            company: {
              companyName: 'Nordic Precision Robotics',
              website: 'https://nordicrobotics.example',
              domain: 'nordicrobotics.example',
              phone: '+47 21 98 44 00',
              address: {
                city: 'Oslo',
                country: 'Norway',
                countryCode: 'NO',
              },
            },
            retrievedAt: now,
            verificationStatus: 'directory_listed',
            confidence: { supported: true, score: 65, signals: ['OSM Listing'] },
            providerMetadata: {},
          },
        ],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1, hasMore: false },
        rawCount: 1,
        attribution: 'Mocked OSM',
        notes: [],
        isLiveApi: true,
      }),
    });

    registry.register(mockRegistryConnector);
    registry.register(mockDirectoryConnector);

    const discovery = new DiscoveryService();
    const discoveryRes = await discovery.executeSearch(
      {
        query: 'Nordic Precision Robotics',
        countryCodes: ['NO'],
        connectorIds: ['conn-brreg', 'conn-osm'],
      },
      {
        registry,
        executionEngine: engine,
        existingCrmLeads: [],
      }
    );

    assert.ok(discoveryRes.leads.length >= 1, 'Discovery should return deduplicated company candidate');
    const discoveredLead = discoveryRes.leads[0];
    assert.equal(discoveredLead.address?.countryCode, 'NO');

    // Cross-check dedupe engine + reversible merge directly
    const dupLead = makeSyntheticLead({
      id: 'lead-dup-1',
      companyName: 'Nordic Precision Robotics',
      domain: 'nordicrobotics.example',
      phone: '+47 21 98 44 00',
    });
    const dupMatches = detectDuplicates([discoveredLead, dupLead]);
    assert.ok(dupMatches.length >= 1, 'Dedupe engine should detect duplicate by shared domain/name');

    const merged = mergeLeads(discoveredLead, dupLead, 'Matched shared domain and Oslo HQ');
    assert.equal(merged.updatedSurvivor.id, discoveredLead.id);
    assert.equal(merged.historyRecord.mergedLeadSnapshot.id, dupLead.id);

    // Official verification via mocked registry connector + persist into isolated CRM
    const verifyReport = await verifyLeadWithOfficialRegistry(merged.updatedSurvivor, {
      registry,
      executionEngine: engine,
    });
    assert.equal(verifyReport.state, 'officially_verified');

    const verifiedLead = applyOfficialVerificationToLead(merged.updatedSurvivor, verifyReport);
    store.upsertLead(verifiedLead);

    const persisted = store.getLead(verifiedLead.id);
    assert.ok(persisted);
    assert.equal(persisted.customFields?.lastRegistryState, 'officially_verified');
    assert.equal(persisted.legalName, 'NORDIC PRECISION ROBOTICS AS');
  } finally {
    cleanup();
  }
});

// ============================================================================
// SCENARIO 4 & 5: Decision-Makers + Enrichment Preview & Owner-Approved Apply
// ============================================================================
test('Phase 18 E2E [4 & 5]: Decision-maker association + non-mutating enrichment preview & owner-approved apply', async () => {
  const { store, cleanup } = createTempStore();
  try {
    const facade = createCrmStorageFacade(store);
    const lead = makeSyntheticLead({
      id: 'lead-enrich-1',
      email: 'info@nordicrobotics.example',
      phone: '+47 21 98 44 00',
      emailStatus: 'unverified',
      confidenceScore: 55,
    });
    store.upsertLead(lead);

    // Scenario 4: Decision-maker role classification + M:N linking via StorageManager.linkPersonToLead
    const roleMatch = classifyDecisionMakerRole('Chief Technology Officer');
    assert.ok(roleMatch.decisionMakingFunction);

    const linked = store.linkPersonToLead({
      leadId: lead.id,
      actorEmail: 'owner@leed.test',
      person: {
        fullName: 'Ingrid Solberg',
        firstName: 'Ingrid',
        lastName: 'Solberg',
        email: 'ingrid.solberg@nordicrobotics.example',
        emailStatus: 'unverified',
        countryCode: 'NO',
        city: 'Oslo',
        jobTitle: 'Chief Technology Officer',
        department: roleMatch.department,
        seniority: roleMatch.seniority,
        decisionMakingFunction: roleMatch.decisionMakingFunction,
        relationshipType: roleMatch.relationshipType,
        isPrimaryContact: true,
        confidenceScore: 84,
        verificationStatus: 'officially_verified',
        relationshipProvenance: { employmentStatus: 'current', isExplicitlyPublished: true },
        customFields: {},
      },
    });
    const person = linked[0].person;

    const companyProfile = await buildCompanyRelationshipProfile(facade, lead.id);
    assert.ok(companyProfile);
    assert.equal(companyProfile.decisionMakers.length, 1);
    assert.equal(companyProfile.decisionMakers[0].person.fullName, 'Ingrid Solberg');

    const personProfile = await buildPersonRelationshipProfile(facade, person.id);
    assert.ok(personProfile);
    assert.equal(personProfile.currentCompanies.length, 1);

    // Scenario 5: Enrichment preview (deterministic mocked DNS/HTTP hooks) must NOT mutate lead
    const originalSnapshot = JSON.stringify(store.getLead(lead.id));
    const preview = await previewCompanyEnrichment(lead, {
      runRegistryVerification: false,
      runWebsiteInspection: true,
      runEmailVerification: true,
      runPhoneVerification: true,
      runAiAssistance: false,
      checkRobots: false,
      dnsLookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchFn: async () =>
        new Response(
          `<html><head><title>Nordic Precision Robotics</title><meta name="description" content="Industrial robotics in Oslo"></head><body>Contact sales@nordicrobotics.example or call +47 21 98 44 00</body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } }
        ),
      emailDnsHooks: {
        resolveMx: async () => [{ exchange: 'mx1.nordicrobotics.example', priority: 10 }],
        resolveTxt: async () => [['v=spf1 include:_spf.example ~all']],
      },
    });

    assert.equal(JSON.stringify(store.getLead(lead.id)), originalSnapshot, 'Preview must never mutate persisted lead');
    assert.equal(preview.emailVerification?.mxRecordsPresent, true);
    assert.equal(preview.phoneVerification?.syntaxValid, true);

    // Owner explicitly approves safe proposals
    const approvedProposals = preview.proposals.slice(0, 3);
    const enriched = applyApprovedCompanyEnrichmentToClone(
      lead,
      approvedProposals,
      [],
      {
        emailVerification: preview.emailVerification,
        phoneVerification: preview.phoneVerification,
        websiteSummary: preview.websiteSummary,
        providerRuns: preview.providerRuns,
      },
      'owner@leed.test'
    );
    store.upsertLead(enriched);

    const qualityAfter = evaluateCompanyDataQuality(enriched);
    assert.ok(qualityAfter.overallScore >= preview.qualityBefore.overallScore);
  } finally {
    cleanup();
  }
});

// ============================================================================
// SCENARIO 6: Import Validation, Mapping & Duplicate Handling
// ============================================================================
test('Phase 18 E2E [6]: CSV import staging, dry-run preview (0 writes), confirmation gate & duplicate merge handling', async () => {
  const { store, cleanup } = createTempStore();
  try {
    store.upsertLead(
      makeSyntheticLead({
        id: 'lead-existing-imp',
        companyName: 'Fjord Marine Systems AS',
        domain: 'fjordmarine.example',
        website: 'https://fjordmarine.example',
        email: '',
        address: { city: 'Bergen', country: 'Norway', countryCode: 'NO' },
      })
    );

    const csvText = [
      'Company Name,Website,Email,Country Code,City,Person Full Name,Job Title',
      'Fjord Marine Systems AS,https://fjordmarine.example,sales@fjordmarine.example,NO,Bergen,Lars Bakke,Managing Director',
      'Alpine MedTech GmbH,https://alpinemed.example,contact@alpinemed.example,DE,Munich,Clara Weber,CEO',
      ',https://missing-name.example,bad-email,XX,,',
    ].join('\r\n');

    const svc = new ImportService();
    const session = await svc.createSessionFromUpload({
      buffer: Buffer.from(csvText, 'utf-8'),
      filename: 'phase18_synthetic_import.csv',
      mimeType: 'text/csv',
      defaultCountryCode: 'NO',
    });

    const preview = svc.previewSession(session.sessionId, {
      existingLeads: store.getLeads(),
      existingPersons: store.getPersons(),
      existingRelationships: store.getAllRelationships(),
    });

    assert.equal(preview.summary.totalRows, 3);
    assert.equal(preview.summary.validRows, 2);
    assert.equal(preview.summary.invalidRows, 1, 'Row without company/person must be flagged invalid');
    assert.equal(store.getLeads().length, 1, 'Dry-run preview must perform 0 CRM writes');

    // Unconfirmed import must be rejected
    await assert.rejects(
      () =>
        svc.confirmSessionImport(session.sessionId, {
          confirm: false,
          actorEmail: 'owner@leed.test',
          storageAdapter: store,
          existingLeads: store.getLeads(),
          existingPersons: store.getPersons(),
          existingRelationships: store.getAllRelationships(),
        }),
      (err: unknown) => err instanceof ImportServiceError && err.code === 'CONFIRMATION_REQUIRED'
    );

    const exec = await svc.confirmSessionImport(session.sessionId, {
      confirm: true,
      actorEmail: 'owner@leed.test',
      storageAdapter: store,
      existingLeads: store.getLeads(),
      existingPersons: store.getPersons(),
      existingRelationships: store.getAllRelationships(),
    });

    assert.ok(exec.batch.createdCompanies >= 1, 'Alpine MedTech GmbH should be created');
    assert.ok(exec.batch.updatedCompanies >= 1 || exec.batch.skippedRows >= 1, 'Existing Fjord Marine Systems should be matched/merged');
    assert.ok(store.getPersons().length >= 2, 'Decision-makers from valid rows should be persisted');
  } finally {
    cleanup();
  }
});

// ============================================================================
// SCENARIO 7: CRM Tasks, Interactions, Private Notes, Opportunities & Reminders
// ============================================================================
test('Phase 18 E2E [7]: CRM tasks, interactions, private notes, opportunities & reminder center', async () => {
  const { store, cleanup } = createTempStore();
  try {
    const facade = createCrmStorageFacade(store);
    const lead = makeSyntheticLead({ id: 'lead-crm-1', companyName: 'Baltic Cloud Logistics OÜ' });
    store.upsertLead(lead);

    const interaction = await createCrmInteraction(facade, {
      leadId: lead.id,
      type: 'phone_call',
      occurredAt: new Date().toISOString(),
      summary: 'Introductory discovery call with operations director',
      outcome: 'Positive fit — requested proposal',
      nextAction: 'Send technical proposal',
      recordedBy: 'owner@leed.test',
    });
    assert.ok(interaction.id);

    const privateNote = await createCrmPrivateNote(facade, {
      entityType: 'company',
      leadId: lead.id,
      title: 'Confidential pricing floor',
      content: 'OWNER-ONLY SECRET: minimum floor is EUR 32k annual.',
      category: 'negotiation',
      tags: ['pricing'],
      pinned: true,
      author: 'owner@leed.test',
    });
    assert.ok(privateNote.id);

    const opp = await createCrmOpportunity(facade, {
      leadId: lead.id,
      title: 'Annual Telemetry License',
      estimatedValue: 64000,
      currency: 'EUR',
      pipelineStageId: 'stage-qualified',
      probability: 45,
      status: 'open',
      changedBy: 'owner@leed.test',
    });
    const updatedOpp = await updateCrmOpportunity(facade, opp.id, {
      pipelineStageId: 'stage-proposal',
      probability: 65,
      stageChangeReason: 'Technical scope approved',
      changedBy: 'owner@leed.test',
    });
    assert.ok(updatedOpp);
    assert.equal(updatedOpp.stageHistory.length, 2);

    const overdueTask = await createExtendedTask(facade, {
      leadId: lead.id,
      title: 'Send revised SLA redline',
      dueDate: new Date(Date.now() - 86400_000).toISOString(),
      priority: 'high',
      category: 'proposal',
      status: 'pending',
      completed: false,
      assignedTo: 'owner@leed.test',
    });
    assert.ok(overdueTask.id);

    const reminders = await buildReminderCenter(facade);
    assert.ok(reminders.counts.overdueTasks >= 1);
    assert.equal((await listAllCrmOpportunities(facade)).length, 1);
    assert.equal((await listAllExtendedTasks(facade)).length, 1);
  } finally {
    cleanup();
  }
});

// ============================================================================
// SCENARIO 8: AI Sales Agent Context Retrieval, Private Note Boundary & Drafts
// ============================================================================
test('Phase 18 E2E [8]: AI Sales Agent context retrieval, private note withholding by default & draft generation (mocked AI)', async () => {
  const { store, cleanup } = createTempStore();
  let capturedPrompt = '';
  setAiGeneratorOverrideForTests(async ({ prompt }) => {
    capturedPrompt = prompt;
    return JSON.stringify({
      executiveSummary: 'Qualified Nordic robotics prospect with clear operational fit.',
      fitRationale: 'Strong industrial automation alignment.',
      keySignals: ['Verified Norwegian entity'],
      risksAndGaps: ['Direct buyer email needs verification'],
      recommendedNextSteps: ['Share tailored case study'],
      subject: 'Automation workflow brief for Nordic Precision Robotics',
      body: 'Hello Ingrid, following our review of Nordic Precision Robotics in Oslo...',
      tone: 'consultative',
      evidenceUsed: ['Company profile: Nordic Precision Robotics AS'],
      caveats: ['Verify direct inbox before sending'],
    });
  });

  try {
    const facade = createCrmStorageFacade(store);
    const lead = makeSyntheticLead({ id: 'lead-ai-1' });
    store.upsertLead(lead);

    await createCrmPrivateNote(facade, {
      entityType: 'company',
      leadId: lead.id,
      title: 'Secret Margin Floor',
      content: 'CONFIDENTIAL_TOKEN_NEVER_LEAK_99182',
      category: 'negotiation',
      author: 'owner@leed.test',
    });

    // 1. Default AI call (includePrivateNotes omitted/false) MUST NOT receive private note text
    const intel = await generateCompanySalesIntelligence(facade, {
      leadId: lead.id,
      includePrivateNotes: false,
    });
    assert.equal(intel.contextAudit.privateNotesAuthorized, false);
    assert.ok(intel.contextAudit.includedEntities.privateNotesRedactedCount >= 1);
    assert.ok(!capturedPrompt.includes('CONFIDENTIAL_TOKEN_NEVER_LEAK_99182'));

    // 2. Controlled agent tool blocks private note access without explicit opt-in
    await assert.rejects(
      () =>
        executeControlledAgentTool(
          { facade, includePrivateNotes: false },
          'search_private_notes',
          { leadId: lead.id }
        ),
      /without explicit owner opt-in/i
    );

    // 3. Draft generation succeeds and remains human-reviewed (draft_only, autoSent: false)
    const draft = await generateSalesCommunicationDraft(facade, {
      leadId: lead.id,
      draftType: 'cold_outreach',
      includePrivateNotes: false,
    });
    assert.equal(draft.status, 'draft_only');
    assert.equal(draft.autoSent, false);
    assert.ok(draft.body.length > 10);
    assert.ok(!capturedPrompt.includes('CONFIDENTIAL_TOKEN_NEVER_LEAK_99182'));
  } finally {
    setAiGeneratorOverrideForTests(null);
    cleanup();
  }
});

// ============================================================================
// SCENARIO 9: Outreach Approval Queue, Suppression Enforcement & LinkedIn Block
// ============================================================================
test('Phase 18 E2E [9]: Outreach approval gate, all-channel suppression cancellation & unconditional LinkedIn block (mocked transport)', async () => {
  const { store, cleanup } = createTempStore();
  let externalSendCalls = 0;

  setAiGeneratorOverrideForTests(async () =>
    JSON.stringify({
      subject: 'Introductory note',
      body: 'Hello, sharing a concise overview tailored to your Oslo operations.',
      personalizationEvidence: [
        {
          statement: 'Company operates in Industrial Automation in Oslo, Norway.',
          classification: 'source_reported',
          sourceLabel: 'Company Profile',
        },
      ],
      unknownsAndCaveats: ['No prior conversation exists.'],
    })
  );
  setOutreachEnvOverrideForTests({
    RESEND_API_KEY: 're_test_synthetic_key_only',
    OUTREACH_FROM_EMAIL: 'owner@verified-sender.example',
    OUTREACH_FROM_NAME: 'LEED Owner',
  });
  setOutreachProviderTransportForTests(async () => {
    externalSendCalls++;
    return {
      status: 200,
      bodyText: JSON.stringify({ id: 'mock-msg-id-1' }),
    };
  });

  try {
    const facade = createCrmStorageFacade(store);
    const credMgr = new CredentialManager();
    const lead = makeSyntheticLead({
      id: 'lead-outreach-1',
      email: 'director@nordicrobotics.example',
    });
    store.upsertLead(lead);

    // Email campaign: draft -> approve -> suppress BEFORE dispatch -> auto-cancelled & blocked
    const { campaign: emailCampaign } = await createOutreachCampaign(facade, {
      name: 'Nordic Q4 Email',
      channel: 'email',
      mode: 'controlled_batch',
      objective: 'Book technical intro',
      createdBy: 'owner@leed.test',
    });
    const enrolled = await enrollRecipientsInCampaign(facade, {
      campaignId: emailCampaign.id,
      recipients: [{ leadId: lead.id }],
      enrolledBy: 'owner@leed.test',
    });
    assert.equal(enrolled.enrolled.length, 1);

    const draftMsg = await generateOutreachMessageDraft(facade, {
      campaignId: emailCampaign.id,
      leadId: lead.id,
      enrollmentId: enrolled.enrolled[0].id,
      stepNumber: 1,
      actor: 'owner@leed.test',
    });
    const approved = await approveOutreachMessage(facade, draftMsg.id, 'owner@leed.test');
    assert.equal(approved.status, 'approved');

    // Add suppression entry -> must invalidate existing approved message & block dispatch
    await addSuppressionEntry(facade, {
      scope: 'global',
      type: 'do_not_contact',
      email: 'director@nordicrobotics.example',
      reason: 'Manual opt-out before dispatch',
      createdBy: 'owner@leed.test',
    });

    await assert.rejects(
      () =>
        dispatchApprovedOutreachMessage(facade, {
          messageId: draftMsg.id,
          actor: 'owner@leed.test',
          credentialManager: credMgr,
        }),
      /suppressed|cancelled|explicit owner approval|cannot be dispatched/i
    );
    assert.equal(externalSendCalls, 0, 'Suppressed recipient must NEVER trigger external transport');

    // LinkedIn campaign: automated dispatch must be unconditionally blocked
    const { campaign: liCampaign } = await createOutreachCampaign(facade, {
      name: 'Nordic LinkedIn Assisted',
      channel: 'linkedin',
      mode: 'individual',
      objective: 'Manual LinkedIn connect note',
      createdBy: 'owner@leed.test',
    });
    const liLead = makeSyntheticLead({
      id: 'lead-li-1',
      companyName: 'Oslo Photonics AS',
      email: 'ceo@oslophotonics.example',
      socialLinks: { linkedin: 'https://linkedin.com/company/oslo-photonics' },
    });
    store.upsertLead(liLead);

    const liEnrolled = await enrollRecipientsInCampaign(facade, {
      campaignId: liCampaign.id,
      recipients: [{ leadId: liLead.id }],
      enrolledBy: 'owner@leed.test',
    });
    const liDraft = await generateOutreachMessageDraft(facade, {
      campaignId: liCampaign.id,
      leadId: liLead.id,
      enrollmentId: liEnrolled.enrolled[0].id,
      stepNumber: 1,
      channel: 'linkedin',
      actor: 'owner@leed.test',
    });
    await approveOutreachMessage(facade, liDraft.id, 'owner@leed.test');

    await assert.rejects(
      () =>
        dispatchApprovedOutreachMessage(facade, {
          messageId: liDraft.id,
          actor: 'owner@leed.test',
          credentialManager: credMgr,
        }),
      /LinkedIn|manual|automated/i
    );
    assert.equal(externalSendCalls, 0);

    // Verify mounted outreach HTTP route responds cleanly
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerOutreachRoutes(router, {
      getFacade: () => ({ facade, isPg: false }),
      credentialManager: credMgr,
      aiRateLimitMiddleware: (_req, _res, next) => next(),
      sanitizeApiError,
      normalizeClientIp: () => '127.0.0.1',
    });
    app.use('/api', router);
    const srv = await startHttpServer(app);
    try {
      const res = await fetch(`${srv.baseUrl}/api/outreach/overview`);
      assert.equal(res.status, 200);
      const data = (await res.json()) as { workspace: { campaigns: unknown[] } };
      assert.equal(data.workspace.campaigns.length, 2);
    } finally {
      await srv.close();
    }
  } finally {
    setAiGeneratorOverrideForTests(null);
    setOutreachEnvOverrideForTests(null);
    setOutreachProviderTransportForTests(null);
    cleanup();
  }
});

// ============================================================================
// SCENARIO 10 & 11: Workflows (Idempotency & Approval Gate) + BI Report Accuracy
// ============================================================================
test('Phase 18 E2E [10 & 11]: Workflow execution, idempotency, owner approval gates & BI analytics/report reconciliation', async () => {
  const { store, cleanup } = createTempStore();
  try {
    const facade = createCrmStorageFacade(store);
    const lead = makeSyntheticLead({
      id: 'lead-wf-1',
      companyName: 'Stockholm GridTech AB',
      opportunityValue: 80000,
      currency: 'EUR',
      status: 'qualified',
      industry: 'Energy',
      address: { city: 'Stockholm', country: 'Sweden', countryCode: 'SE' },
    });
    store.upsertLead(lead);

    // 1. Automated workflow with task creation + approval-gated CRM field update
    const wf = await createWorkflowDefinition(
      facade,
      {
        name: 'Qualified Lead Follow-Up Task',
        enabled: true,
        trigger: { type: 'lead_created' },
        conditions: [{ field: 'country', operator: 'equals', value: 'SE' }],
        actions: [
          {
            type: 'create_task',
            taskTitle: 'Qualify {{company_name}} scope',
            taskPriority: 'high',
            taskDueInDays: 2,
          },
          {
            type: 'update_crm_field',
            crmField: 'industry',
            crmValue: 'Smart Grid Infrastructure',
          },
        ],
      },
      'owner@leed.test'
    );
    assert.ok(wf.id);

    const eventKey = 'e2e-lead-created-wf-1';
    const firstRun = await dispatchWorkflowEvent(facade, {
      triggerType: 'lead_created',
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      eventKey,
      actor: 'owner@leed.test',
    });
    assert.equal(firstRun.length, 1);
    assert.equal(firstRun[0].status, 'awaiting_approval', 'Approval-gated CRM update must pause for owner approval');
    assert.equal(store.getLead(lead.id)?.industry, 'Energy', 'Industry must NOT change before owner approval');

    // Duplicate event with same eventKey must not create duplicate tasks
    await dispatchWorkflowEvent(facade, {
      triggerType: 'lead_created',
      entityType: 'lead',
      entityId: lead.id,
      leadId: lead.id,
      eventKey,
      actor: 'owner@leed.test',
    });
    const tasksAfterDup = await listAllExtendedTasks(facade);
    assert.equal(tasksAfterDup.length, 1, 'Idempotency must prevent duplicate workflow tasks');

    // Owner approves gated step 1
    const approvedRes = await decideQueuedWorkflowStep(facade, {
      executionId: firstRun[0].id,
      stepIndex: 1,
      decision: 'approve',
      actor: 'owner@leed.test',
    });
    assert.equal(approvedRes.step.status, 'approved_and_executed');
    assert.equal(store.getLead(lead.id)?.industry, 'Smart Grid Infrastructure');

    const wfWorkspace = await listWorkflowsWorkspace(facade);
    assert.ok(wfWorkspace.executions.length >= 1);

    // Scenario 11: BI Analytics & Report Accuracy
    await createCrmOpportunity(facade, {
      leadId: lead.id,
      title: 'Grid Telemetry Expansion',
      estimatedValue: 80000,
      currency: 'EUR',
      pipelineStageId: 'stage-qualified',
      probability: 60,
      status: 'open',
      changedBy: 'owner@leed.test',
    });

    const biResult = await buildBiAnalyticsDashboardCached(facade, {}, { ownerScope: 'owner-e2e' });
    assert.equal(biResult.dashboard.leadIntelligence.totalCompanies, 1);
    assert.equal(biResult.dashboard.salesPipeline.openOpportunities, 1);
    assert.ok(
      biResult.dashboard.salesPipeline.openValuesByCurrency.some(
        (c) => c.currency === 'EUR' && c.totalValue === 80000
      )
    );

    const report = await generateBiReport(facade, 'pipeline_performance');
    assert.equal(report.scheduledDeliveryAvailable, false, 'Must honestly disclose no background report scheduler');
    const csvOut = exportBiReportToCsv(report);
    assert.ok(csvOut.filename.endsWith('.csv'));
    assert.ok(csvOut.csvContent.length > 20);
  } finally {
    cleanup();
  }
});

// ============================================================================
// SCENARIO 12: Connector Failure, Timeout & Circuit Breaker Recovery
// ============================================================================
test('Phase 18 E2E [12]: Connector transient failure, timeout, circuit breaker open & half-open recovery', async () => {
  const engine = new ConnectorExecutionEngine(new CredentialManager());
  engine.configureCircuitBreaker({ failureThreshold: 2, cooldownMs: 60 });

  let callCount = 0;
  let shouldFail = true;
  const flakyConnector = makeMockConnector('conn-e2e-flaky', 'Flaky Registry Fixture', {
    supportedCountries: ['GB'],
    searchFn: async () => {
      callCount++;
      if (shouldFail) {
        throw new ConnectorError({
          category: 'timeout',
          providerId: 'conn-e2e-flaky',
          message: 'Upstream registry timed out',
          retryable: false,
        });
      }
      return {
        results: [
          {
            providerId: 'conn-e2e-flaky',
            providerName: 'Flaky Registry Fixture',
            sourceCategory: 'government_registry',
            accessMode: 'live_api',
            countryCode: 'GB',
            externalSourceId: 'gb-1',
            company: {
              companyName: 'Recovered UK Precision Ltd',
              address: { country: 'United Kingdom', countryCode: 'GB' },
            },
            retrievedAt: new Date().toISOString(),
            verificationStatus: 'officially_verified',
            confidence: { supported: true, score: 85, signals: ['Fixture'] },
            providerMetadata: {},
          },
        ],
        pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1, hasMore: false },
        rawCount: 1,
        attribution: 'Fixture',
        notes: [],
        isLiveApi: true,
      };
    },
  });

  // 2 consecutive transient failures open the circuit breaker
  await assert.rejects(() => engine.executeSearch(flakyConnector, { query: 'test' }));
  await assert.rejects(() => engine.executeSearch(flakyConnector, { query: 'test' }));
  assert.equal(engine.getCircuitState('conn-e2e-flaky'), 'open');

  // Immediate 3rd call fast-fails without hitting connector
  const callsBeforeFastFail = callCount;
  await assert.rejects(() => engine.executeSearch(flakyConnector, { query: 'test' }), /circuit/i);
  assert.equal(callCount, callsBeforeFastFail, 'Open circuit breaker must fast-fail without calling upstream');

  // Wait for cooldown -> half-open probe succeeds -> circuit closes
  await new Promise((r) => setTimeout(r, 80));
  shouldFail = false;
  const recovered = await engine.executeSearch(flakyConnector, { query: 'test' });
  assert.equal(recovered.response.results.length, 1);
  assert.equal(engine.getCircuitState('conn-e2e-flaky'), 'closed');
});

// ============================================================================
// SCENARIO 13: Pagination, Owner-Scoped Caching, Write Invalidation & Backup Drill
// ============================================================================
test('Phase 18 E2E [13]: Bounded pagination, stable sorting, cache hit/miss, sensitive-key blocking, write invalidation & isolated JSON restore drill', () => {
  const params = parsePaginationParams({ limit: '9999', offset: '-10', sortBy: 'companyName', sortDir: 'asc' });
  assert.ok(params.pageSize <= MAX_PAGE_SIZE, 'Pagination pageSize must be strictly bounded');
  assert.equal(params.offset, 0, 'Negative offset must clamp to 0');

  const items = Array.from({ length: 45 }, (_, idx) => ({
    id: `item-${String(idx).padStart(2, '0')}`,
    name: idx % 2 === 0 ? 'Alpha' : 'Beta',
    score: idx,
  }));
  const sorted = stableSortBy(items, (i) => i.name, 'asc');
  const page1 = paginateArray(sorted, parsePaginationParams({ page: 1, pageSize: 10 }));
  const page2 = paginateArray(sorted, parsePaginationParams({ page: 2, pageSize: 10 }));
  assert.equal(page1.items.length, 10);
  assert.equal(page1.pagination.total, 45);
  assert.equal(page1.pagination.hasNextPage, true);
  assert.notEqual(page1.items[0].id, page2.items[0].id);

  // Cache hit/miss, sensitive-key refusal, and write invalidation
  const cache = new LeedCacheManager({ maxEntries: 50, maxEstimatedBytes: 256 * 1024 });
  assert.throws(
    () => cache.set('bi_analytics', 'owner1', 'session:tok123', { secret: true }, 5000),
    /Cache policy violation/i
  );

  cache.set('bi_analytics', 'owner1', 'dashboard:default', { total: 45 }, 30_000);
  assert.deepEqual(cache.get('bi_analytics', 'owner1', 'dashboard:default'), { total: 45 });
  assert.equal(cache.get('bi_analytics', 'owner2', 'dashboard:default'), undefined, 'Owner scopes must be isolated');

  cache.invalidateOnCrmWrite();
  assert.equal(
    cache.get('bi_analytics', 'owner1', 'dashboard:default'),
    undefined,
    'CRM write must invalidate cached BI metrics'
  );

  // Isolated JSON backup & restore verification drill
  const { store, cleanup } = createTempStore();
  try {
    store.upsertLead(makeSyntheticLead({ id: 'lead-bak-1' }));
    const drill = runIsolatedJsonBackupRestoreDrill(store.getDbFilePath());
    assert.equal(drill.verified, true);
    assert.equal(drill.checksumVerified, true);
    assert.equal(drill.tamperDetectionVerified, true);
    assert.equal(drill.productionNeonUntouched, true);
  } finally {
    cleanup();
  }
});

// ============================================================================
// SCENARIO 15: CSV Export Safety & Sensitive-Data Redaction
// ============================================================================
test('Phase 18 E2E [15]: CSV formula injection neutralization, international phone preservation & error sanitization', () => {
  // Dangerous spreadsheet payloads must be neutralized with leading single quote
  assert.ok(escapeCsvCell("=CMD|' /C calc'!A0").startsWith("'="));
  assert.ok(escapeCsvCell('@SUM(A1:A10)').startsWith("'@"));
  assert.equal(escapeCsvCell(' =HYPERLINK("http://evil.example")'), '"\' =HYPERLINK(""http://evil.example"")"');
  assert.ok(escapeCsvCell('-1-1').startsWith("'-1-1"));
  assert.ok(escapeCsvCell('+1+2').startsWith("'+1+2"));
  assert.ok(escapeCsvCell('\t=1+1').startsWith("'\t"));
  assert.ok(escapeCsvCell('|cmd').startsWith("'|"));

  // Safe numeric scalars and international phone numbers remain cleanly formatted
  assert.equal(escapeCsvCell('-42.50'), '-42.50');
  assert.equal(escapeCsvCell('125000'), '125000');
  assert.equal(escapeCsvCell('+44 20 7946 0958'), '+44 20 7946 0958');
  assert.equal(escapeCsvCell('+1-555-010-2000'), '+1-555-010-2000');

  const csv = buildCsvDocument(
    ['Company', 'Phone', 'FormulaTest'],
    [['Acme, "Nordic" AS', '+47 21 98 44 00', '=1+1']],
    true
  );
  assert.ok(csv.startsWith('\uFEFF'), 'CSV should include UTF-8 BOM');
  assert.ok(csv.includes('"Acme, ""Nordic"" AS"'), 'Embedded commas and quotes must follow RFC 4180');
  assert.ok(csv.includes("'=1+1"), 'Formula cell must be neutralized');

  // Sensitive DB & secret errors must be sanitized before reaching API clients
  const pgLeak = sanitizeApiError(
    new Error('relation "owner_sessions" does not exist DETAIL: Key (token_hash)=(abc) failed'),
    'Safe fallback error.'
  );
  assert.equal(pgLeak, 'Safe fallback error.');

  const secretLeak = sanitizeApiError(
    new Error('Upstream failed with key sk_live_SUPER_SECRET_12345 at /app/applet/server/foo.ts:12'),
    'Safe fallback error.',
    ['sk_live_SUPER_SECRET_12345']
  );
  assert.ok(!secretLeak.includes('sk_live_SUPER_SECRET_12345'));
  assert.ok(!secretLeak.includes('/app/applet/server/foo.ts'));
});
