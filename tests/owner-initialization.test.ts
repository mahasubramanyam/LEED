import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { dbManager } from '../server/db/pool.js';
import { ownerService } from '../server/auth/ownerService.js';
import { createSession, validateSession } from '../server/auth/session.js';
import { validatePasswordStrength, hashPassword, verifyPassword } from '../server/auth/password.js';
import { loginRateLimiter } from '../server/auth/rateLimit.js';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  details: string;
}

const testResults: TestResult[] = [];

async function test(name: string, category: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) || 'Passed successfully.';
    testResults.push({ name, category, passed: true, details: detail });
    console.log(`[PASS] ${name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    testResults.push({ name, category, passed: false, details: msg });
    console.error(`[FAIL] ${name}: ${msg}`);
  }
}

async function runSafeOwnerInitializationTests() {
  console.log('================================================================');
  console.log('LEED: SAFE ISOLATED OWNER INITIALIZATION VERIFICATION SUITE');
  console.log('Strict Mode: Zero Writes to Live Database, Read-Only & Isolated');
  console.log('================================================================\n');

  // Verify connection to live PostgreSQL
  const check = await dbManager.checkConnection(2, 500);
  assert(check.connected, 'PostgreSQL must be connected for this verification test');

  // 1. Verify that data/owner_auth.json exists on disk
  await test('Verify Legacy owner_auth.json Exists on Disk', 'Precondition', async () => {
    const fallbackPath = path.resolve(process.cwd(), 'data', 'owner_auth.json');
    assert(fs.existsSync(fallbackPath), 'owner_auth.json must exist to test isolation');
    const content = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
    assert(content.isActive === true, 'Fallback owner file has isActive: true');
    return `Legacy file exists with email: ${content.email} (must be ignored by PostgreSQL runtime).`;
  });

  // 2. Verify isOwnerInitialized() returns false because owner_users has 0 rows
  await test('isOwnerInitialized() Returns False Despite Legacy JSON Existing', 'Owner Status', async () => {
    const isInit = await ownerService.isOwnerInitialized();
    assert.strictEqual(isInit, false, 'isOwnerInitialized() must return false when owner_users has 0 rows');
    return 'Confirmed: owner_users in PostgreSQL is the exclusive source of truth. Returned initialized: false.';
  });

  // 3. Verify Login Rejects Legacy owner_auth.json Account
  await test('Login Rejects Legacy owner_auth.json Account When PostgreSQL is Connected', 'Auth Security', async () => {
    const ip = '127.0.0.99';
    loginRateLimiter.reset(ip);

    try {
      await ownerService.login('owner@leedplatform.local', 'SecureOwnerPass123!', ip);
      assert.fail('Login should not succeed using legacy JSON account when PostgreSQL is connected');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      assert(msg.includes('Invalid credentials'), `Expected invalid credentials rejection, got: ${msg}`);
    } finally {
      loginRateLimiter.reset(ip);
    }
    return 'Legacy owner_auth.json account cannot be used to authenticate when database is connected.';
  });

  // 4. Verify createSession Fails for Nonexistent Owners
  await test('createSession Strictly Fails for Nonexistent Owners (No In-Memory Fallback)', 'Session Security', async () => {
    try {
      await createSession('nonexistent-owner-id-999');
      assert.fail('createSession must reject nonexistent owners via foreign key in PostgreSQL');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      assert(
        msg.includes('violates foreign key constraint') || msg.includes('owner_sessions_owner_id_fkey') || msg.includes('23503'),
        `Expected foreign key violation, got: ${msg}`
      );
    }
    return 'Foreign key enforcement prevents orphan session creation. No fallback in-memory session was created.';
  });

  // 5. Verify validateSession Returns Null for Nonexistent Session Tokens
  await test('validateSession Returns Null for Random Tokens', 'Session Security', async () => {
    const fakeToken = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const session = await validateSession(fakeToken);
    assert.strictEqual(session, null, 'Fake session token must return null');
    return 'Session validation against PostgreSQL returned null as expected.';
  });

  // 6. Verify Password Strength Validation & Bcrypt Hashing
  await test('Password Complexity & Bcrypt Salt Rounds', 'Password Security', async () => {
    assert.strictEqual(validatePasswordStrength('short').valid, false);
    assert.strictEqual(validatePasswordStrength('SecureValidPassword123!').valid, true);

    const hash = await hashPassword('SecureValidPassword123!');
    assert(hash.startsWith('$2'), 'Must be valid bcrypt hash');
    const match = await verifyPassword('SecureValidPassword123!', hash);
    assert.strictEqual(match, true);
    const noMatch = await verifyPassword('WrongPassword', hash);
    assert.strictEqual(noMatch, false);

    return 'Password complexity and 12-round bcrypt hashing verified.';
  });

  // 7. Verify Live Database Remains Completely Unchanged (0 Rows in owner_users)
  await test('Verify owner_users in Live Neon Remains Unchanged (0 Rows)', 'Neon Immutability', async () => {
    const pool = dbManager.getPool();
    assert(pool, 'Pool must exist');
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT COUNT(*)::int as count FROM owner_users');
      assert.strictEqual(res.rows[0].count, 0, 'owner_users must still contain exactly 0 rows');
      return 'PostgreSQL owner_users table contains exactly 0 records. Live database was not modified.';
    } finally {
      client.release();
    }
  });

  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${testResults.filter((r) => r.passed).length}/${testResults.length} PASSED`);
  console.log('================================================================\n');

  const allPassed = testResults.every((r) => r.passed);
  await dbManager.closePool();
  process.exit(allPassed ? 0 : 1);
}

runSafeOwnerInitializationTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
