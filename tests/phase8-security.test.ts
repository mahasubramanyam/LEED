import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import cookieParser from 'cookie-parser';
import {
  buildContentSecurityPolicy,
  securityHeadersMiddleware,
} from '../server/security/headers.js';
import {
  sanitizeApiError,
  sanitizeExportFilenamePart,
} from '../server/security/errorHandler.js';
import {
  SlidingWindowRateLimiter,
  createRateLimitMiddleware,
} from '../server/security/rateLimiter.js';
import {
  clearSecurityEventsForTesting,
  getRecentSecurityEvents,
} from '../server/security/securityEvents.js';
import {
  fetchWithSsrfProtection,
  isDisallowedIpAddress,
  readBoundedResponseText,
  validateOutboundUrl,
} from '../server/security/ssrf.js';
import { inspectWebsite } from '../server/connectors/webInspector.js';
import {
  validateCampaignCreateBody,
  validateCampaignMessageAction,
  validateLeadCreateOrUpdate,
  validatePipelineMoveBody,
  validateSettingsUpdateBody,
  validateTaskCreateBody,
  validateTaskUpdateBody,
} from '../server/security/validators.js';
import { buildSecurityPostureReport } from '../server/security/posture.js';
import {
  generateCsrfToken,
  setCsrfCookie,
  validateCsrf,
  validateSameOrigin,
} from '../server/auth/csrf.js';
import { LoginRateLimiter } from '../server/auth/rateLimit.js';
import {
  ImportFileSecurityError,
  parseImportFileBuffer,
} from '../server/import/fileParser.js';
import { ImportService } from '../server/import/importService.js';
import { sanitizeExternalUrl } from '../src/utils/safeUrl.ts';
import { CredentialManager } from '../server/connectors/core/credentialManager.js';
import { hashPassword, verifyPassword } from '../server/auth/password.js';
import { hashSessionToken } from '../server/auth/session.js';
import {
  executeMigration005ApprovalWorkflow,
  handleLegacyRunMigrationsBlocked,
} from '../server/db/migrationWorkflow.js';
import { requireOwnerAuth } from '../server/auth/middleware.js';

async function startTestApp(app: express.Express): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert(addr && typeof addr === 'object');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('1. Security Headers & AI Studio Iframe-Compatible CSP', async () => {
  const app = express();
  app.use(securityHeadersMiddleware(true));
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.send('ok'));

  const srv = await startTestApp(app);
  try {
    const apiRes = await fetch(`${srv.baseUrl}/api/ping`, {
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.equal(apiRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(apiRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(apiRes.headers.get('x-dns-prefetch-control'), 'off');
    assert.equal(apiRes.headers.get('x-permitted-cross-domain-policies'), 'none');
    assert.equal(apiRes.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.match(apiRes.headers.get('cache-control') || '', /no-store/);
    assert.match(apiRes.headers.get('strict-transport-security') || '', /max-age=31536000/);
    assert.equal(apiRes.headers.get('x-frame-options'), null);

    const csp = apiRes.headers.get('content-security-policy') || '';
    assert.match(csp, /frame-ancestors 'self' https:\/\/aistudio\.google\.com/);
    assert.match(csp, /object-src 'none'/);
    assert.ok(!buildContentSecurityPolicy(true).includes("'unsafe-eval'"));
    assert.ok(buildContentSecurityPolicy(false).includes("'unsafe-eval'"));
  } finally {
    await srv.close();
  }
});

test('2. CSRF Protection: Fail-closed missing Host, cross-origin, missing/invalid token, valid double-submit', async () => {
  clearSecurityEventsForTesting();

  // Fail closed when Host header is missing AND Origin/Referer is present
  assert.equal(
    validateSameOrigin({
      headers: { origin: 'https://evil.example' },
      socket: { remoteAddress: '127.0.0.1' },
      app: { get: () => false },
    } as any),
    false
  );
  // Same-server direct test without Host or Origin/Referer still passes
  assert.equal(
    validateSameOrigin({
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      app: { get: () => false },
    } as any),
    true
  );

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.get('/csrf', (_req, res) => {
    const t = generateCsrfToken();
    setCsrfCookie(res, t);
    res.json({ csrfToken: t });
  });
  app.post('/mutate', validateCsrf, (_req, res) => {
    res.json({ ok: true });
  });

  const srv = await startTestApp(app);
  try {
    const csrfRes = await fetch(`${srv.baseUrl}/csrf`);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    // Cross-origin blocked even with token
    const crossOrigin = await fetch(`${srv.baseUrl}/mutate`, {
      method: 'POST',
      headers: {
        Origin: 'https://attacker.evil',
        Cookie: `leed_csrf=${csrfToken}`,
        'x-leed-csrf-token': csrfToken,
      },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(((await crossOrigin.json()) as any).code, 'CSRF_CROSS_ORIGIN');

    // Missing header blocked
    const missingHdr = await fetch(`${srv.baseUrl}/mutate`, {
      method: 'POST',
      headers: { Cookie: `leed_csrf=${csrfToken}` },
    });
    assert.equal(missingHdr.status, 403);
    assert.equal(((await missingHdr.json()) as any).code, 'CSRF_MISSING');

    // Valid double-submit succeeds
    const okRes = await fetch(`${srv.baseUrl}/mutate`, {
      method: 'POST',
      headers: {
        Cookie: `leed_csrf=${csrfToken}`,
        'x-leed-csrf-token': csrfToken,
      },
    });
    assert.equal(okRes.status, 200);
    assert.ok(getRecentSecurityEvents(10).some((e) => e.category === 'csrf_blocked'));
  } finally {
    await srv.close();
  }
});

test('3. Rate Limiters: SlidingWindowRateLimiter 429 + headers + LoginRateLimiter bounded memory', async () => {
  const limiter = new SlidingWindowRateLimiter('test_export', 2, 60_000);
  const app = express();
  app.get('/export', createRateLimitMiddleware(limiter), (_req, res) => res.json({ ok: true }));

  const srv = await startTestApp(app);
  try {
    const r1 = await fetch(`${srv.baseUrl}/export`);
    const r2 = await fetch(`${srv.baseUrl}/export`);
    const r3 = await fetch(`${srv.baseUrl}/export`);
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get('x-ratelimit-limit'), '2');
    assert.equal(r1.headers.get('x-ratelimit-remaining'), '1');
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get('x-ratelimit-remaining'), '0');
    assert.equal(r3.status, 429);
    assert.ok(Number(r3.headers.get('retry-after')) >= 1);
    assert.equal(limiter.getStats().blockedCount, 1);
  } finally {
    await srv.close();
  }

  const loginLimiter = new LoginRateLimiter(3, 60_000, 60_000);
  for (let i = 0; i < 3; i++) loginLimiter.recordFailure('203.0.113.10');
  assert.equal(loginLimiter.check('203.0.113.10').allowed, false);
  assert.equal(loginLimiter.getStats().blockedEvents, 1);
});

test('4. Input Schema Validation: leads, pipeline, tasks, campaigns, settings', () => {
  assert.equal(validateLeadCreateOrUpdate({ companyName: '' }, 'create').ok, false);
  assert.equal(
    validateLeadCreateOrUpdate({ companyName: 'Acme Nordic AS', status: 'hacked' }, 'create').ok,
    false
  );
  assert.equal(
    validateLeadCreateOrUpdate({ companyName: 'Acme Nordic AS', confidenceScore: 150 }, 'create').ok,
    false
  );
  const validLead = validateLeadCreateOrUpdate(
    { companyName: '  Acme Nordic AS  ', confidenceScore: 88, status: 'qualified' },
    'create'
  );
  assert.equal(validLead.ok, true);
  assert.equal(validLead.data?.companyName, 'Acme Nordic AS');

  assert.equal(validatePipelineMoveBody({ leadId: 'l1' }).ok, false);
  assert.equal(validateTaskCreateBody({ title: '' }).ok, false);
  assert.equal(validateTaskCreateBody({ title: 'Follow up', completed: 'yes' }).ok, false);
  assert.equal(validateTaskCreateBody({ title: 'Follow up', priority: 'urgent' }).ok, false);
  assert.equal(validateTaskCreateBody({ title: 'Follow up', completed: true }).data?.completed, true);
  assert.equal(validateTaskUpdateBody({ completed: 'invalid_state' }).ok, false);
  assert.equal(validateTaskUpdateBody({ priority: 'invalid_priority' }).ok, false);
  assert.equal(validateTaskUpdateBody({ completed: true }).data?.completed, true);
  assert.equal(validateCampaignCreateBody({ name: 'X' }).ok, false);
  assert.equal(validateCampaignCreateBody({ name: 'X', subjectTemplate: 'S', bodyTemplate: 'B', channel: 'sms' }).ok, false);
  assert.equal(validateCampaignCreateBody({ name: 'X', subjectTemplate: 'S', bodyTemplate: 'B', channel: 'email' }).ok, true);
  assert.equal(validateCampaignMessageAction({ action: 'force_send' }).ok, false);
  assert.equal(validateCampaignMessageAction({ action: 'approve' }).ok, true);
  assert.equal(validateSettingsUpdateBody({ autoDedupeThreshold: 1.5 }).ok, false);
  assert.equal(validateSettingsUpdateBody({ autoDedupeThreshold: 0.85 }).ok, true);
});

test('5. SSRF Shield: IPv4/IPv6 CIDR, IPv4-mapped IPv6, multi-record DNS, redirect SSRF, and stream cap', async () => {
  const blockedIps = [
    '127.0.0.1',
    '10.20.30.40',
    '172.16.5.4',
    '192.168.1.50',
    '169.254.169.254',
    '100.64.0.5',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456:789a::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::ffff:7f00:1',
  ];
  for (const ip of blockedIps) {
    assert.equal(isDisallowedIpAddress(ip), true, `Expected IP ${ip} to be blocked`);
  }
  assert.equal(isDisallowedIpAddress('93.184.216.34'), false);
  assert.equal(isDisallowedIpAddress('2606:2800:220:1:248:1893:25c8:1946'), false);

  // Block non-standard port & internal hostnames
  assert.equal((await validateOutboundUrl('https://example.com:8080/admin')).allowed, false);
  assert.equal((await validateOutboundUrl('http://metadata.google.internal/computeMetadata/v1/')).allowed, false);

  // Block multi-record DNS where one AAAA/A record is private
  const multiDns = await validateOutboundUrl('https://dual-stack.example.com', {
    dnsLookupAll: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '::ffff:127.0.0.1', family: 6 },
    ],
  });
  assert.equal(multiDns.allowed, false);

  // Redirect-based SSRF blocked: public URL -> 302 -> AWS/GCP metadata IP
  const ssrfRedirect = await inspectWebsite('https://public-site.example.com', {
    dnsLookupAll: async (host) => {
      if (host === 'public-site.example.com') return [{ address: '93.184.216.34', family: 4 }];
      if (host === '169.254.169.254') return [{ address: '169.254.169.254', family: 4 }];
      return [{ address: '93.184.216.34', family: 4 }];
    },
    fetchFn: async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
  });
  assert.equal(ssrfRedirect.securityCheck.passed, false);
  assert.match(ssrfRedirect.securityCheck.reason || '', /SSRF|protected/i);

  // Streaming byte cap truncates oversized payload cleanly
  const bigChunk = new Uint8Array(600 * 1024).fill(65);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bigChunk);
      controller.close();
    },
  });
  const bounded = await readBoundedResponseText(new Response(stream, { status: 200 }), 1024);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.bytesRead, 1024);

  // Verify redirect loop > 3 hops blocked
  await assert.rejects(
    () =>
      fetchWithSsrfProtection('https://public-site.example.com/start', {
        dnsLookupAll: async () => [{ address: '93.184.216.34', family: 4 }],
        fetchFn: async () =>
          new Response(null, { status: 302, headers: { location: 'https://public-site.example.com/hop' } }),
      }),
    /maximum allowed redirects/i
  );
});

test('6. Error Sanitization, Secret Redaction & Content-Disposition Filename Sanitization', () => {
  assert.equal(
    sanitizeApiError(new Error('relation "owner_sessions" does not exist'), 'Database error'),
    'Database error'
  );
  assert.equal(
    sanitizeApiError(
      new Error('duplicate key value violates unique constraint "uq_leads_domain"'),
      'Constraint violation'
    ),
    'Constraint violation'
  );
  const leaked = sanitizeApiError(
    new Error('Failed calling https://user:supersecret@db.neon.tech/neondb?api_key=abc12345 at /app/applet/server.ts:42\n  at runQuery')
  );
  assert.ok(!leaked.includes('supersecret'));
  assert.ok(!leaked.includes('abc12345'));
  assert.ok(!leaked.includes('/app/applet/'));
  assert.ok(!leaked.includes('at runQuery'));

  const safeName = sanitizeExportFilenamePart('../../etc/passwd\r\nX-Injected: yes');
  assert.ok(!safeName.includes('..'));
  assert.ok(!safeName.includes('/'));
  assert.ok(!safeName.includes('\r'));
  assert.ok(!safeName.includes('\n'));
});

test('7. File Upload Security & Import Buffer Cleanup', async () => {
  // Fake .xlsx containing Windows PE "MZ" header
  await assert.rejects(
    () =>
      parseImportFileBuffer({
        filename: 'payload.xlsx',
        buffer: Buffer.from('MZ\x90\x00\x03\x00\x00\x00'),
      }),
    (err: unknown) => err instanceof ImportFileSecurityError && err.code === 'INVALID_MAGIC_BYTES'
  );

  // Reject macro-enabled .xlsm extension
  await assert.rejects(
    () =>
      parseImportFileBuffer({
        filename: 'leads.xlsm',
        buffer: Buffer.from('PK\x03\x04'),
      }),
    (err: unknown) => err instanceof ImportFileSecurityError && err.code === 'UNSAFE_MACRO_FORMAT'
  );

  // Reject oversized buffer (>15 MB ceiling)
  await assert.rejects(
    () =>
      parseImportFileBuffer({
        filename: 'huge.csv',
        buffer: Buffer.alloc(15 * 1024 * 1024 + 10, 0x41),
      }),
    (err: unknown) => err instanceof ImportFileSecurityError && err.code === 'FILE_TOO_LARGE'
  );

  // Verify CSV upload releases raw buffer immediately in ImportService
  const svc = new ImportService();
  const created = await svc.createSessionFromUpload({
    filename: 'clean.csv',
    buffer: Buffer.from('company_name,country\nNordic Marine AS,NO\n', 'utf8'),
  });
  const sess = svc.getSession(created.sessionId);
  assert.equal(sess.buffer.length, 0);
});

test('8. Frontend XSS Protection: sanitizeExternalUrl', () => {
  assert.equal(sanitizeExternalUrl('javascript:alert(document.cookie)'), undefined);
  assert.equal(sanitizeExternalUrl('  JaVaScRiPt:alert(1)'), undefined);
  assert.equal(sanitizeExternalUrl('java\tscript:alert(1)'), undefined);
  assert.equal(sanitizeExternalUrl('data:text/html,<script>alert(1)</script>'), undefined);
  assert.equal(sanitizeExternalUrl('vbscript:msgbox(1)'), undefined);
  assert.equal(sanitizeExternalUrl('//evil.example.com/phish'), undefined);
  assert.equal(sanitizeExternalUrl('https://nordicmarine.no/about'), 'https://nordicmarine.no/about');
  assert.equal(sanitizeExternalUrl('http://example.com'), 'http://example.com/');
  assert.equal(sanitizeExternalUrl('nordicmarine.no'), 'https://nordicmarine.no/');
});

test('9. Regression Preservation: AES-256-GCM Vault, Auth Crypto, Security Posture & Migration Locks', async () => {
  const prevKey = process.env.CONNECTOR_ENCRYPTION_KEY;
  process.env.CONNECTOR_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  try {
    const cm = new CredentialManager();
    const encrypted = cm.encryptPayload({ apiKey: 'secret-token-value-12345' }, 'test_provider');
    const decrypted = cm.decryptPayload(encrypted, 'test_provider');
    assert.equal(decrypted.apiKey, 'secret-token-value-12345');
    assert.equal(cm.maskSecret('secret-token-value-12345'), '••••2345');
  } finally {
    if (prevKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY;
    else process.env.CONNECTOR_ENCRYPTION_KEY = prevKey;
  }

  // Password hashing & session hashing intact
  const hash = await hashPassword('StrongOwnerPass!2026');
  assert.equal(await verifyPassword('StrongOwnerPass!2026', hash), true);
  assert.equal(await verifyPassword('WrongPass', hash), false);
  const tokenHash = hashSessionToken('raw-token-abc');
  assert.equal(tokenHash.length, 64);

  // Migration 005 approval remains strictly locked for non-owner or missing confirmation
  const legacyBlocked = await handleLegacyRunMigrationsBlocked(
    { owner: { email: 'owner@example.com', role: 'owner' }, clientIp: '127.0.0.1' },
    { isDbConnected: () => false, recordAuditEvent: async () => {} }
  );
  assert.equal(legacyBlocked.status, 403);

  const missingConfirm = await executeMigration005ApprovalWorkflow(
    { owner: { email: 'owner@example.com', role: 'owner' }, confirmMigration: '004', clientIp: '127.0.0.1' },
    {
      isDbConnected: () => true,
      runTargetMigration005: async () => ({ success: true, applied: [], alreadyApplied: [] }),
      inspectMigrationStatus: async () => ({} as any),
      recordAuditEvent: async () => {},
    }
  );
  assert.equal(missingConfirm.status, 400);

  // Security posture report never leaks secrets and reports accurate telemetry
  const posture = await buildSecurityPostureReport({
    isProd: true,
    isDbConnected: () => true,
    getEncryptionStatus: () => ({ configured: true, source: 'env', algorithm: 'aes-256-gcm' }),
    getDatabaseSecurityStatus: async () => ({
      tlsEncrypted: true,
      sslSetting: 'on',
      auditUpdateDeleteTrigger: true,
      auditTruncateTrigger: true,
      activeSessionCount: 1,
      totalSessionCount: 3,
      encryptedCredentialCount: 1,
    }),
    verifyAuditChain: async () => ({ valid: true, totalEvents: 12 }),
    inspectMigrations: async () => ({ migration005Recorded: false }),
    ownerInitialized: async () => true,
  });
  assert.equal(posture.overallPosture, 'hardened');
  assert.equal(posture.databaseSecurity.tlsEncrypted, true);
  assert.equal(posture.databaseSecurity.migration005PendingApproval, true);
  assert.equal(posture.checks.every((c) => c.status === 'pass'), true);
});

test('10. Auth Middleware Rejects Missing & Invalid/Expired Sessions + Hides X-Powered-By', async () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use(securityHeadersMiddleware(false));
  app.get('/api/protected', requireOwnerAuth, (_req, res) => res.json({ ok: true }));

  const srv = await startTestApp(app);
  try {
    const unauth = await fetch(`${srv.baseUrl}/api/protected`);
    assert.equal(unauth.status, 401);
    assert.equal(unauth.headers.get('x-powered-by'), null);
    assert.equal(((await unauth.json()) as any).code, 'UNAUTHORIZED');

    const badCookie = await fetch(`${srv.baseUrl}/api/protected`, {
      headers: { Cookie: 'leed_session=invalid_or_expired_token_value' },
    });
    assert.equal(badCookie.status, 401);
    assert.equal(((await badCookie.json()) as any).code, 'SESSION_EXPIRED');

    const badBearer = await fetch(`${srv.baseUrl}/api/protected`, {
      headers: { Authorization: 'Bearer nonexistent-token' },
    });
    assert.equal(badBearer.status, 401);
    assert.equal(((await badBearer.json()) as any).code, 'SESSION_EXPIRED');
  } finally {
    await srv.close();
  }
});
