import crypto from 'crypto';
import pg from 'pg';
import { dbManager } from '../db/pool.js';

export interface OwnerSession {
  id: string;
  tokenHash: string;
  ownerId: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

export interface OwnerUser {
  id: string;
  email: string;
  fullName: string;
  role: 'owner';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory / Fallback session store for disconnected preview or tests
const inMemorySessions: Map<string, OwnerSession> = new Map();

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  ownerId: string,
  ipAddress?: string,
  userAgent?: string,
  durationMs = SESSION_DURATION_MS
): Promise<{ rawToken: string; session: OwnerSession }> {
  const rawToken = generateSessionToken();
  const tokenHash = hashSessionToken(rawToken);
  const sessionId = `sess-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const expiresAt = new Date(Date.now() + durationMs);
  const createdAt = new Date();

  const sessionObj: OwnerSession = {
    id: sessionId,
    tokenHash,
    ownerId,
    ipAddress,
    userAgent,
    expiresAt,
    createdAt,
  };

  const pool = dbManager.getPool();
  if (pool && dbManager.isDbConnected()) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query(
        `INSERT INTO owner_sessions (id, token_hash, owner_id, ip_address, user_agent, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, tokenHash, ownerId, ipAddress || null, userAgent || null, expiresAt, createdAt]
      );
      return { rawToken, session: sessionObj };
    } finally {
      if (client) client.release();
    }
  }

  if (dbManager.isConfigured()) {
    throw new Error('Database is configured but not connected. Cannot create session.');
  }

  inMemorySessions.set(tokenHash, sessionObj);
  return { rawToken, session: sessionObj };
}

export async function validateSession(rawToken: string): Promise<OwnerSession | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;

  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();

  const pool = dbManager.getPool();
  if (pool && dbManager.isDbConnected()) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const res = await client.query(
        `SELECT id, token_hash as "tokenHash", owner_id as "ownerId", ip_address as "ipAddress",
                user_agent as "userAgent", expires_at as "expiresAt", revoked_at as "revokedAt", created_at as "createdAt"
         FROM owner_sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
        [tokenHash, now]
      );
      if (res.rows.length > 0) {
        return res.rows[0];
      }
      return null;
    } catch (err) {
      console.warn('[Session] Failed to query Postgres for session:', err);
      return null;
    } finally {
      if (client) client.release();
    }
  }

  if (!dbManager.isConfigured()) {
    // Check fallback store ONLY when database is not configured
    const memSession = inMemorySessions.get(tokenHash);
    if (memSession) {
      if (memSession.revokedAt || memSession.expiresAt <= now) {
        inMemorySessions.delete(tokenHash);
        return null;
      }
      return memSession;
    }
  }

  return null;
}

export async function revokeSession(rawToken: string): Promise<boolean> {
  if (!rawToken) return false;
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();

  let revoked = false;

  const pool = dbManager.getPool();
  if (pool && dbManager.isDbConnected()) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const res = await client.query(
        `UPDATE owner_sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL`,
        [now, tokenHash]
      );
      if (res.rowCount && res.rowCount > 0) {
        revoked = true;
      }
      return revoked;
    } catch (err) {
      console.warn('[Session] Failed to revoke session in Postgres:', err);
      return false;
    } finally {
      if (client) client.release();
    }
  }

  if (!dbManager.isConfigured()) {
    const mem = inMemorySessions.get(tokenHash);
    if (mem) {
      mem.revokedAt = now;
      revoked = true;
    }
  }

  return revoked;
}

export async function revokeAllOwnerSessions(ownerId: string): Promise<number> {
  const now = new Date();
  let count = 0;

  const pool = dbManager.getPool();
  if (pool && dbManager.isDbConnected()) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const res = await client.query(
        `UPDATE owner_sessions SET revoked_at = $1 WHERE owner_id = $2 AND revoked_at IS NULL`,
        [now, ownerId]
      );
      count += res.rowCount || 0;
      return count;
    } catch (err) {
      console.warn('[Session] Failed to revoke all sessions in Postgres:', err);
      return 0;
    } finally {
      if (client) client.release();
    }
  }

  if (!dbManager.isConfigured()) {
    for (const [key, sess] of inMemorySessions.entries()) {
      if (sess.ownerId === ownerId && !sess.revokedAt) {
        sess.revokedAt = now;
        count++;
      }
    }
  }

  return count;
}

export async function listOwnerSessions(ownerId: string): Promise<Array<{
  id: string;
  tokenHash: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
  isActive: boolean;
}>> {
  const now = new Date();
  const pool = dbManager.getPool();

  if (pool && dbManager.isDbConnected()) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const res = await client.query(
        `SELECT id, token_hash as "tokenHash", ip_address as "ipAddress",
                user_agent as "userAgent", expires_at as "expiresAt", revoked_at as "revokedAt", created_at as "createdAt"
         FROM owner_sessions
         WHERE owner_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [ownerId]
      );
      return res.rows.map((row: any) => ({
        id: row.id,
        tokenHash: row.tokenHash,
        ipAddress: row.ipAddress || undefined,
        userAgent: row.userAgent || undefined,
        expiresAt: new Date(row.expiresAt),
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : undefined,
        createdAt: new Date(row.createdAt),
        isActive: !row.revokedAt && new Date(row.expiresAt) > now,
      }));
    } finally {
      if (client) client.release();
    }
  }

  if (!dbManager.isConfigured()) {
    const list: Array<{
      id: string;
      tokenHash: string;
      ipAddress?: string;
      userAgent?: string;
      expiresAt: Date;
      revokedAt?: Date;
      createdAt: Date;
      isActive: boolean;
    }> = [];
    for (const [hash, sess] of inMemorySessions.entries()) {
      if (sess.ownerId === ownerId) {
        list.push({
          id: sess.id,
          tokenHash: hash,
          ipAddress: sess.ipAddress,
          userAgent: sess.userAgent,
          expiresAt: sess.expiresAt,
          revokedAt: sess.revokedAt,
          createdAt: sess.createdAt,
          isActive: !sess.revokedAt && sess.expiresAt > now,
        });
      }
    }
    return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  return [];
}

export async function revokeSessionById(sessionId: string, ownerId: string): Promise<boolean> {
  const now = new Date();
  const pool = dbManager.getPool();

  if (pool && dbManager.isDbConnected()) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const res = await client.query(
        `UPDATE owner_sessions SET revoked_at = $1 WHERE id = $2 AND owner_id = $3 AND revoked_at IS NULL`,
        [now, sessionId, ownerId]
      );
      return (res.rowCount || 0) > 0;
    } finally {
      if (client) client.release();
    }
  }

  if (!dbManager.isConfigured()) {
    for (const sess of inMemorySessions.values()) {
      if (sess.id === sessionId && sess.ownerId === ownerId && !sess.revokedAt) {
        sess.revokedAt = now;
        return true;
      }
    }
  }

  return false;
}

export async function revokeOtherOwnerSessions(ownerId: string, currentTokenHash: string): Promise<number> {
  const now = new Date();
  let count = 0;
  const pool = dbManager.getPool();

  if (pool && dbManager.isDbConnected()) {
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const res = await client.query(
        `UPDATE owner_sessions
         SET revoked_at = $1
         WHERE owner_id = $2 AND token_hash != $3 AND revoked_at IS NULL`,
        [now, ownerId, currentTokenHash]
      );
      return res.rowCount || 0;
    } finally {
      if (client) client.release();
    }
  }

  if (!dbManager.isConfigured()) {
    for (const [hash, sess] of inMemorySessions.entries()) {
      if (sess.ownerId === ownerId && hash !== currentTokenHash && !sess.revokedAt) {
        sess.revokedAt = now;
        count++;
      }
    }
  }

  return count;
}

