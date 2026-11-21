/**
 * Phase 19.2 Staging-Safety Remediation Isolated Verification Suite.
 *
 * Strictly isolated:
 * - Zero live Neon/PostgreSQL connections or writes.
 * - Zero SQL executed against real databases.
 * - Zero external network calls or emails.
 * - Uses temporary directories and in-memory mock pools/clients only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import pg from 'pg';

import { constantTimeSecretEquals, OwnerService } from '../server/auth/ownerService.js';
import { validateSameOrigin } from '../server/auth/csrf.js';
import { sanitizeApiError } from '../server/security/errorHandler.js';
import { PostgresStorage } from '../server/db/storagePg.js';
import { buildSecurityPostureReport } from '../server/security/posture.js';
import {
  Migrator,
  MIGRATION_ADVISORY_LOCK_KEY_1,
  MIGRATION_ADVISORY_LOCK_KEY_2,
} from '../server/db/migrator.js';
import { buildOwnerSetupPayload } from '../src/components/AuthModal.js';

function startTestServer(app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

// ============================================================================
// 1. CONSTANT-TIME SECRET COMPARISON
// ============================================================================

test('1. constantTimeSecretEquals handles equal, unequal, different-length, empty, and non-string inputs safely', () => {
  assert.equal(constantTimeSecretEquals('staging-secret-99', 'staging-secret-99'), true);
  assert.equal(constantTimeSecretEquals('staging-secret-98', 'staging-secret-99'), false);
  // Unequal byte lengths must return false without throwing RangeError
  assert.equal(constantTimeSecretEquals('short', 'much-longer-staging-secret-value'), false);
  assert.equal(constantTimeSecretEquals('much-longer-staging-secret-value', 'short'), false);
  // Multibyte UTF-8 characters with identical string length but different byte lengths
  assert.equal(constantTimeSecretEquals('éééé', 'aaaa'), false);
  assert.equal(constantTimeSecretEquals('éééé', 'éééé'), true);
  // Empty and non-string inputs
  assert.equal(constantTimeSecretEquals('', 'expected'), false);
  assert.equal(constantTimeSecretEquals('expected', ''), false);
  assert.equal(constantTimeSecretEquals(undefined, 'expected'), false);
  assert.equal(constantTimeSecretEquals(null, 'expected'), false);
  assert.equal(constantTimeSecretEquals(12345, '12345'), false);
  assert.equal(constantTimeSecretEquals({}, 'expected'), false);
});

// ============================================================================
// 2. SETUP_SECRET ENFORCEMENT, REDACTION & COMPATIBILITY WHEN UNSET
// ============================================================================

test('2. OwnerService.setupOwner enforces SETUP_SECRET when configured, rejects wrong secret, never leaks secret, and allows setup when unset', async () => {
  const prevSecret = process.env.SETUP_SECRET;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleLog = console.log;
  const capturedLogs: string[] = [];

  console.error = (...args: unknown[]) => capturedLogs.push(args.map(String).join(' '));
  console.warn = (...args: unknown[]) => capturedLogs.push(args.map(String).join(' '));
  console.log = (...args: unknown[]) => capturedLogs.push(args.map(String).join(' '));

  const configuredSecret = 'ultra-private-staging-setup-secret-2026!';
  const wrongSecret = 'wrong-attempted-secret-value-9999!';

  try {
    // Use an isolated mock OwnerService instance that never touches disk or live DB
    const svc = new OwnerService();
    let storedOwner: any = null;
    (svc as any).isOwnerInitialized = async () => storedOwner !== null;
    (svc as any).saveFallbackOwner = (owner: any) => {
      storedOwner = owner;
    };

    // Case A: SETUP_SECRET configured -> missing or wrong secret rejected
    process.env.SETUP_SECRET = configuredSecret;

    await assert.rejects(
      () => svc.setupOwner('Staging Owner', 'owner@staging.local', 'StrongPass123!'),
      /Invalid or missing SETUP_SECRET/
    );

    await assert.rejects(
      () => svc.setupOwner('Staging Owner', 'owner@staging.local', 'StrongPass123!', wrongSecret),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /Invalid or missing SETUP_SECRET/);
        assert.ok(!msg.includes(configuredSecret), 'Error message must never contain configured SETUP_SECRET');
        assert.ok(!msg.includes(wrongSecret), 'Error message must never contain supplied secret');
        return true;
      }
    );

    // Express endpoint integration: verify HTTP response & redaction never expose secrets
    const app = express();
    app.use(express.json());
    app.post('/api/auth/setup', (req, res, next) => {
      if (!validateSameOrigin(req)) {
        res.status(403).json({ error: 'Cross-origin request blocked.' });
        return;
      }
      next();
    }, async (req, res) => {
      const { fullName, email, password, setupSecret } = req.body || {};
      try {
        const owner = await svc.setupOwner(fullName, email, password, setupSecret);
        res.status(201).json({ success: true, owner });
      } catch (err: unknown) {
        const secretsToRedact = [
          process.env.SETUP_SECRET || '',
          typeof setupSecret === 'string' ? setupSecret : '',
        ].filter((s) => s.trim().length > 0);
        res.status(400).json({ error: sanitizeApiError(err, 'Owner setup failed.', secretsToRedact) });
      }
    });

    const srv = await startTestServer(app);
    try {
      // Wrong secret over HTTP
      const badRes = await fetch(`${srv.baseUrl}/api/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Staging Owner',
          email: 'owner@staging.local',
          password: 'StrongPass123!',
          setupSecret: wrongSecret,
        }),
      });
      assert.equal(badRes.status, 400);
      const badBody = await badRes.text();
      assert.ok(!badBody.includes(configuredSecret), 'API error response must never contain configured SETUP_SECRET');
      assert.ok(!badBody.includes(wrongSecret), 'API error response must never contain supplied setupSecret');

      // Correct secret over HTTP
      const okRes = await fetch(`${srv.baseUrl}/api/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Staging Owner',
          email: 'owner@staging.local',
          password: 'StrongPass123!',
          setupSecret: configuredSecret,
        }),
      });
      assert.equal(okRes.status, 201);
      const okBody = await okRes.text();
      const okJson = JSON.parse(okBody);
      assert.equal(okJson.success, true);
      assert.equal(okJson.owner.email, 'owner@staging.local');
      assert.ok(!okBody.includes(configuredSecret), 'Success response must never include SETUP_SECRET');
      assert.equal('setupSecret' in okJson, false);
      assert.equal('setupSecret' in okJson.owner, false);

      // Singleton lock preserved: second setup rejected even with valid secret
      const secondRes = await fetch(`${srv.baseUrl}/api/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Second Owner',
          email: 'second@staging.local',
          password: 'StrongPass123!',
          setupSecret: configuredSecret,
        }),
      });
      assert.equal(secondRes.status, 400);
      const secondJson = (await secondRes.json()) as { error: string };
      assert.match(secondJson.error, /Initial setup already completed/i);
    } finally {
      await srv.close();
    }

    // Case B: SETUP_SECRET intentionally unset -> setup succeeds without setupSecret
    delete process.env.SETUP_SECRET;
    const svcUnset = new OwnerService();
    let unsetStored: any = null;
    (svcUnset as any).isOwnerInitialized = async () => unsetStored !== null;
    (svcUnset as any).saveFallbackOwner = (owner: any) => {
      unsetStored = owner;
    };
    const unsetOwner = await svcUnset.setupOwner('Dev Owner', 'dev@local.test', 'StrongPass123!');
    assert.equal(unsetOwner.email, 'dev@local.test');

    // Verify neither secret ever appeared in logs
    const joinedLogs = capturedLogs.join('\n');
    assert.ok(!joinedLogs.includes(configuredSecret), 'Configured SETUP_SECRET must never be logged');
    assert.ok(!joinedLogs.includes(wrongSecret), 'Supplied setupSecret must never be logged');
  } finally {
    if (prevSecret === undefined) {
      delete process.env.SETUP_SECRET;
    } else {
      process.env.SETUP_SECRET = prevSecret;
    }
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.log = originalConsoleLog;
  }
});

// ============================================================================
// 3. OWNER SETUP FORM SUBMITS SETUP SECRET SAFELY
// ============================================================================

test('3. AuthModal setup form builds setupSecret payload only for setup, masks input, and clears secret on success/close', () => {
  // Payload helper includes setupSecret when provided
  const withSecret = buildOwnerSetupPayload({
    fullName: 'Owner Name',
    email: 'owner@example.com',
    password: 'StrongPassword123!',
    setupSecret: 'my-setup-secret',
  });
  assert.deepEqual(withSecret, {
    fullName: 'Owner Name',
    email: 'owner@example.com',
    password: 'StrongPassword123!',
    setupSecret: 'my-setup-secret',
  });

  // Payload helper omits setupSecret when blank so unset SETUP_SECRET remains compatible
  const withoutSecret = buildOwnerSetupPayload({
    fullName: 'Owner Name',
    email: 'owner@example.com',
    password: 'StrongPassword123!',
    setupSecret: '',
  });
  assert.deepEqual(withoutSecret, {
    fullName: 'Owner Name',
    email: 'owner@example.com',
    password: 'StrongPassword123!',
  });
  assert.equal('setupSecret' in withoutSecret, false);

  // Verify AuthModal.tsx source guarantees: masked password input, autoComplete="off",
  // rendered only in setup mode, cleared on success & close, never sent on login/change_password
  const modalSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/AuthModal.tsx'), 'utf-8');
  assert.match(modalSrc, /const \[setupSecret, setSetupSecret\] = useState\(''\);/);
  assert.match(modalSrc, /buildOwnerSetupPayload\(\{ fullName, email, password, setupSecret \}\)/);
  assert.match(modalSrc, /name="setupSecret"/);
  assert.match(modalSrc, /type="password"[\s\S]*?autoComplete="off"[\s\S]*?value=\{setupSecret\}/);
  assert.match(modalSrc, /if \(!isOpen\) \{[\s\S]*?setSetupSecret\(''\);/);
  assert.match(modalSrc, /setSetupSecret\(''\);[\s\S]*?onSuccess\(data\.owner, data\.token\);/);
  // Login & change_password branches must NOT submit setupSecret
  const loginIdx = modalSrc.indexOf("else if (mode === 'login')");
  const afterLogin = modalSrc.slice(loginIdx);
  assert.doesNotMatch(afterLogin, /body:\s*JSON\.stringify\([^)]*setupSecret/);
  // Never default to an env variable
  assert.doesNotMatch(modalSrc, /VITE_SETUP_SECRET|process\.env\.SETUP_SECRET/);
});

// ============================================================================
// 4. POSTGRESQL TLS DIAGNOSTICS (pg_stat_ssl ONLY — NO ssl_is_used OR SHOW ssl)
// ============================================================================

test('4. PostgreSQL TLS diagnostics query pg_stat_ssl, never use ssl_is_used or SHOW ssl, and handle missing/false/error honestly', async () => {
  const storageSrc = fs.readFileSync(path.join(process.cwd(), 'server/db/storagePg.ts'), 'utf-8');
  assert.doesNotMatch(storageSrc, /ssl_is_used/, 'storagePg.ts must not reference ssl_is_used()');
  assert.doesNotMatch(storageSrc, /SHOW ssl/i, 'storagePg.ts must not query SHOW ssl as TLS proof');
  assert.match(
    storageSrc,
    /SELECT current_database\(\), ssl, version, cipher, bits FROM pg_stat_ssl WHERE pid = pg_backend_pid\(\)/
  );

  // Case A: Active TLS session (ssl = true)
  const executedSql: string[] = [];
  const activeStore = new PostgresStorage();
  (activeStore as any).getClient = () => ({
    connect: async () => ({
      query: async (sql: string) => {
        executedSql.push(sql);
        if (sql.includes('pg_stat_ssl')) {
          return {
            rows: [
              {
                current_database: 'staging_db',
                ssl: true,
                version: 'TLSv1.3',
                cipher: 'TLS_AES_256_GCM_SHA384',
                bits: 256,
              },
            ],
          };
        }
        if (sql.includes('pg_trigger')) return { rows: [] };
        if (sql.includes('owner_sessions')) return { rows: [{ active_cnt: '1', total_cnt: '1' }] };
        if (sql.includes('connector_credentials')) return { rows: [{ cnt: '0' }] };
        return { rows: [] };
      },
      release: () => {},
    }),
  });

  const activeStatus = await activeStore.getDatabaseSecurityStatus();
  assert.equal(activeStatus.tlsProbeStatus, 'verified');
  assert.equal(activeStatus.tlsEncrypted, true);
  assert.equal(activeStatus.tlsVersion, 'TLSv1.3');
  assert.equal(activeStatus.tlsCipher, 'TLS_AES_256_GCM_SHA384');
  assert.equal(activeStatus.tlsBits, 256);
  assert.equal(activeStatus.sslSetting, 'TLSv1.3 (256-bit)');
  assert.ok(
    executedSql.some((q) =>
      q.includes('SELECT current_database(), ssl, version, cipher, bits FROM pg_stat_ssl WHERE pid = pg_backend_pid()')
    )
  );
  assert.ok(!executedSql.some((q) => q.includes('SHOW ssl')));
  assert.ok(!executedSql.some((q) => q.includes('ssl_is_used')));

  // Case B: Unencrypted current session (ssl = false) -> must report tlsEncrypted: false
  const plainStore = new PostgresStorage();
  (plainStore as any).getClient = () => ({
    connect: async () => ({
      query: async (sql: string) => {
        if (sql.includes('pg_stat_ssl')) {
          return { rows: [{ current_database: 'staging_db', ssl: false, version: null, cipher: null, bits: null }] };
        }
        if (sql.includes('pg_trigger')) return { rows: [] };
        if (sql.includes('owner_sessions')) return { rows: [{ active_cnt: '0', total_cnt: '0' }] };
        if (sql.includes('connector_credentials')) return { rows: [{ cnt: '0' }] };
        return { rows: [] };
      },
      release: () => {},
    }),
  });
  const plainStatus = await plainStore.getDatabaseSecurityStatus();
  assert.equal(plainStatus.tlsProbeStatus, 'verified');
  assert.equal(plainStatus.tlsEncrypted, false);
  assert.equal(plainStatus.sslSetting, 'off');

  // Case C: Missing / inaccessible pg_stat_ssl row -> must report unavailable (NOT encrypted!)
  const missingRowStore = new PostgresStorage();
  (missingRowStore as any).getClient = () => ({
    connect: async () => ({
      query: async (sql: string) => {
        if (sql.includes('pg_stat_ssl')) return { rows: [] };
        if (sql.includes('pg_trigger')) return { rows: [] };
        if (sql.includes('owner_sessions')) return { rows: [{ active_cnt: '0', total_cnt: '0' }] };
        if (sql.includes('connector_credentials')) return { rows: [{ cnt: '0' }] };
        return { rows: [] };
      },
      release: () => {},
    }),
  });
  const missingStatus = await missingRowStore.getDatabaseSecurityStatus();
  assert.equal(missingStatus.tlsProbeStatus, 'unavailable');
  assert.equal(missingStatus.tlsEncrypted, false);
  assert.equal(missingStatus.sslSetting, 'unavailable');

  // Posture report must treat unavailable pg_stat_ssl as not_verified & tlsEncrypted: null
  const postureUnavailable = await buildSecurityPostureReport({
    isProd: true,
    isDbConnected: () => true,
    getEncryptionStatus: () => ({ configured: true, source: 'env', algorithm: 'aes-256-gcm' }),
    getDatabaseSecurityStatus: async () => missingStatus,
    verifyAuditChain: async () => ({ valid: true, totalEvents: 0 }),
    inspectMigrations: async () => ({ migration005Recorded: true }),
    ownerInitialized: async () => true,
  });
  const tlsCheck = postureUnavailable.checks.find((c) => c.id === 'db_tls');
  assert.equal(tlsCheck?.status, 'not_verified');
  assert.equal(postureUnavailable.databaseSecurity.tlsEncrypted, null);
  assert.match(tlsCheck?.detail || '', /pg_stat_ssl.*unavailable|NOT_VERIFIED/i);

  // Case D: pg_stat_ssl permission error -> must report error, tlsEncrypted: false, no leaked PG message
  const errStore = new PostgresStorage();
  (errStore as any).getClient = () => ({
    connect: async () => ({
      query: async (sql: string) => {
        if (sql.includes('pg_stat_ssl')) throw new Error('permission denied for view pg_stat_ssl');
        if (sql.includes('pg_trigger')) return { rows: [] };
        if (sql.includes('owner_sessions')) return { rows: [{ active_cnt: '0', total_cnt: '0' }] };
        if (sql.includes('connector_credentials')) return { rows: [{ cnt: '0' }] };
        return { rows: [] };
      },
      release: () => {},
    }),
  });
  const errStatus = await errStore.getDatabaseSecurityStatus();
  assert.equal(errStatus.tlsProbeStatus, 'error');
  assert.equal(errStatus.tlsEncrypted, false);
  assert.equal(errStatus.sslSetting, 'error');
  assert.ok(!JSON.stringify(errStatus).includes('permission denied'));

  // Documentation check: docs/SECURITY_AND_BACKUP.md uses pg_stat_ssl and no longer references ssl_is_used() as current method
  const secDoc = fs.readFileSync(path.join(process.cwd(), 'docs/SECURITY_AND_BACKUP.md'), 'utf-8');
  assert.match(
    secDoc,
    /SELECT current_database\(\), ssl, version, cipher, bits[\s\S]*?FROM pg_stat_ssl[\s\S]*?WHERE pid = pg_backend_pid\(\);/
  );
});

// ============================================================================
// 5. MIGRATION FAILURE RETURNS ZERO FALSELY APPLIED MIGRATIONS
// ============================================================================

test('5. Migration batch failure after partial progress rolls back and returns empty applied array', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-p19-rollback-'));
  try {
    fs.writeFileSync(path.join(tmpDir, '001_first.sql'), 'CREATE TABLE t1 (id TEXT PRIMARY KEY);');
    fs.writeFileSync(path.join(tmpDir, '002_second_fails.sql'), 'CREATE TABLE t2_broken (id TEXT);');

    const executed: string[] = [];
    const committedVersions = new Set<string>();
    const txVersions = new Set<string>();

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executed.push(sql);
        if (sql === 'BEGIN') {
          txVersions.clear();
          return { rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [{ pg_advisory_xact_lock: '' }] };
        }
        if (sql.includes('SELECT version FROM schema_migrations')) {
          return { rows: Array.from(committedVersions).map((v) => ({ version: v })) };
        }
        if (sql.includes('t2_broken')) {
          throw new Error('simulated failure in migration 002');
        }
        if (sql.includes('INSERT INTO schema_migrations')) {
          txVersions.add(String(params?.[0]));
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
          txVersions.clear();
          return { rows: [] };
        }
        if (sql === 'COMMIT') {
          for (const v of txVersions) committedVersions.add(v);
          txVersions.clear();
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as unknown as pg.PoolClient;

    const migrator = new Migrator(tmpDir);
    const result = await migrator.runMigrations(mockClient);

    assert.equal(result.success, false);
    assert.deepEqual(result.applied, [], 'Rolled-back migration 001 must NOT be returned as applied');
    assert.match(result.error || '', /simulated failure in migration 002/);
    assert.equal(committedVersions.size, 0);
    assert.ok(executed.includes('ROLLBACK'));
    assert.ok(!executed.includes('COMMIT'));
    assert.ok(executed.some((q) => q.includes('pg_advisory_xact_lock($1, $2)')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// 6. CONCURRENT MIGRATION ATTEMPTS SERIALIZE VIA TRANSACTION ADVISORY LOCK
// ============================================================================

test('6. Concurrent migrator.runMigrations() calls serialize via pg_advisory_xact_lock and release lock on COMMIT/ROLLBACK', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-p19-concurrent-'));
  try {
    fs.writeFileSync(path.join(tmpDir, '001_init.sql'), 'CREATE TABLE c1 (id TEXT PRIMARY KEY);');
    fs.writeFileSync(path.join(tmpDir, '002_next.sql'), 'CREATE TABLE c2 (id TEXT PRIMARY KEY);');

    // In-memory PostgreSQL transaction + pg_advisory_xact_lock simulator
    let lockHolder: number | null = null;
    const lockWaiters: Array<() => void> = [];
    const committedVersions = new Set<string>();
    const ddlExecutions: string[] = [];
    let overlapDetected = false;
    let activeCriticalSections = 0;
    let nextClientId = 1;
    let failFirstRunOnce = false;

    const acquireLock = async (clientId: number, k1: number, k2: number) => {
      assert.equal(k1, MIGRATION_ADVISORY_LOCK_KEY_1);
      assert.equal(k2, MIGRATION_ADVISORY_LOCK_KEY_2);
      while (lockHolder !== null && lockHolder !== clientId) {
        await new Promise<void>((resolve) => lockWaiters.push(resolve));
      }
      lockHolder = clientId;
    };

    const releaseLock = (clientId: number) => {
      if (lockHolder === clientId) {
        lockHolder = null;
        const next = lockWaiters.shift();
        if (next) next();
      }
    };

    const mockPool = {
      connect: async () => {
        const clientId = nextClientId++;
        const pendingVersions = new Set<string>();
        return {
          query: async (sql: string, params?: unknown[]) => {
            if (sql === 'BEGIN') {
              pendingVersions.clear();
              return { rows: [] };
            }
            if (sql.includes('SELECT pg_advisory_xact_lock($1, $2)')) {
              await acquireLock(clientId, Number(params?.[0]), Number(params?.[1]));
              activeCriticalSections++;
              if (activeCriticalSections > 1) overlapDetected = true;
              return { rows: [{ pg_advisory_xact_lock: '' }] };
            }
            if (sql.includes('SELECT version FROM schema_migrations')) {
              return { rows: Array.from(committedVersions).map((v) => ({ version: v })) };
            }
            if (sql.includes('CREATE TABLE c1') || sql.includes('CREATE TABLE c2')) {
              // Yield briefly to expose any missing lock serialization
              await new Promise((r) => setTimeout(r, 20));
              if (failFirstRunOnce && sql.includes('CREATE TABLE c2')) {
                failFirstRunOnce = false;
                throw new Error('transient error during concurrent migration');
              }
              ddlExecutions.push(sql);
              return { rows: [] };
            }
            if (sql.includes('INSERT INTO schema_migrations')) {
              pendingVersions.add(String(params?.[0]));
              return { rows: [] };
            }
            if (sql === 'COMMIT') {
              for (const v of pendingVersions) committedVersions.add(v);
              pendingVersions.clear();
              activeCriticalSections = Math.max(0, activeCriticalSections - 1);
              releaseLock(clientId);
              return { rows: [] };
            }
            if (sql === 'ROLLBACK') {
              pendingVersions.clear();
              activeCriticalSections = Math.max(0, activeCriticalSections - 1);
              releaseLock(clientId);
              return { rows: [] };
            }
            return { rows: [] };
          },
          release: () => {},
        };
      },
    } as unknown as pg.Pool;

    const migrator = new Migrator(tmpDir);

    // Run 1: Two concurrent callers race; first commits 001+002, second sees both alreadyApplied
    const [resA, resB] = await Promise.all([
      migrator.runMigrations(mockPool),
      migrator.runMigrations(mockPool),
    ]);

    assert.equal(overlapDetected, false, 'Advisory xact lock must prevent overlapping critical sections');
    assert.equal(lockHolder, null, 'Transaction advisory lock must be released after COMMIT');
    assert.equal(resA.success, true);
    assert.equal(resB.success, true);

    const totalApplied = [...resA.applied, ...resB.applied];
    assert.deepEqual(totalApplied.sort(), ['001_init.sql', '002_next.sql']);
    assert.equal(ddlExecutions.length, 2, 'Each migration DDL must execute exactly once');

    // Run 2: Lock releases on ROLLBACK so a waiting caller succeeds cleanly afterwards
    committedVersions.clear();
    ddlExecutions.length = 0;
    failFirstRunOnce = true;

    const [failCaller, waiterCaller] = await Promise.all([
      migrator.runMigrations(mockPool),
      migrator.runMigrations(mockPool),
    ]);

    assert.equal(lockHolder, null, 'Transaction advisory lock must be released after ROLLBACK and COMMIT');
    assert.equal(failCaller.success, false);
    assert.deepEqual(failCaller.applied, [], 'Failed caller must not report rolled-back migrations as applied');
    assert.equal(waiterCaller.success, true);
    assert.deepEqual(waiterCaller.applied, ['001_init.sql', '002_next.sql']);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// 7. EXISTING MIGRATIONS 001–005 UNCHANGED & STARTUP POLICY PRESERVED
// ============================================================================

test('7. Existing migrations 001–005 remain intact and server.ts startup automatically targets only 001–004', () => {
  const migrationsDir = path.join(process.cwd(), 'server/db/migrations');
  const forwardFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  assert.deepEqual(forwardFiles, [
    '001_initial_schema.sql',
    '002_owner_singleton_and_audit_integrity.sql',
    '003_global_intelligence.sql',
    '004_unified_connector_architecture.sql',
    '005_import_and_relationships.sql',
  ]);

  // Verify Migration 002 was NOT silently reordered or rewritten
  const m002 = fs.readFileSync(
    path.join(migrationsDir, '002_owner_singleton_and_audit_integrity.sql'),
    'utf-8'
  );
  const triggerIdx = m002.indexOf('CREATE TRIGGER trg_audit_events_prevent_update_delete');
  const backfillIdx = m002.indexOf('UPDATE audit_events');
  assert.ok(triggerIdx > 0 && backfillIdx > 0 && triggerIdx < backfillIdx, 'Migration 002 must remain unmodified');

  // Verify Migration 002 safety boundary is documented in docs/DATABASE_AND_AUTH.md
  const dbDoc = fs.readFileSync(path.join(process.cwd(), 'docs/DATABASE_AND_AUTH.md'), 'utf-8');
  assert.match(dbDoc, /Migration 002 Fresh-Database Safety Boundary/);
  assert.match(dbDoc, /zero existing `audit_events` rows/i);

  // Verify proposed 006 remains isolated inside proposals/
  assert.ok(fs.existsSync(path.join(migrationsDir, 'proposals/006_performance_indexes.sql')));

  // Verify server.ts startup policy automatically targets only 001-004 and keeps 005 owner-approved
  const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');
  assert.match(serverSrc, /const baselineVersions = \['001', '002', '003', '004'\];/);
  assert.doesNotMatch(serverSrc, /const baselineVersions = \[[^\]]*'005'/);
  assert.match(serverSrc, /protectedApi\.post\('\/database\/migrations\/005\/approve'/);
  assert.doesNotMatch(serverSrc, /migrator\.runMigrations\(\s*\)/);
});
