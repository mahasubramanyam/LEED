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
    try {
      await pool.query(
        `INSERT INTO owner_sessions (id, token_hash, owner_id, ip_address, user_agent, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, tokenHash, ownerId, ipAddress || null, userAgent || null, expiresAt, createdAt]
      );
    } catch (err) {
      console.warn('[Session] Failed to persist session to Postgres, storing in-memory fallback:', err);
      inMemorySessions.set(tokenHash, sessionObj);
    }
  } else {
    inMemorySessions.set(tokenHash, sessionObj);
  }

  return { rawToken, session: sessionObj };
}

export async function validateSession(rawToken: string): Promise<OwnerSession | null> {
  if (!rawToken || typeof rawToken !== 'string') return null;

  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();

  const pool = dbManager.getPool();
  if (pool && dbManager.isDbConnected()) {
    try {
      const res = await pool.query(
        `SELECT id, token_hash as "tokenHash", owner_id as "ownerId", ip_address as "ipAddress",
                user_agent as "userAgent", expires_at as "expiresAt", revoked_at as "revokedAt", created_at as "createdAt"
         FROM owner_sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
        [tokenHash, now]
      );
      if (res.rows.length > 0) {
        return res.rows[0];
      }
    } catch (err) {
      console.warn('[Session] Failed to query Postgres for session, checking fallback:', err);
    }
  }

  // Check fallback store
  const memSession = inMemorySessions.get(tokenHash);
  if (memSession) {
    if (memSession.revokedAt || memSession.expiresAt <= now) {
      inMemorySessions.delete(tokenHash);
      return null;
    }
    return memSession;
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
    try {
      const res = await pool.query(
        `UPDATE owner_sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL`,
        [now, tokenHash]
      );
      if (res.rowCount && res.rowCount > 0) {
        revoked = true;
      }
    } catch (err) {
      console.warn('[Session] Failed to revoke session in Postgres:', err);
    }
  }

  const mem = inMemorySessions.get(tokenHash);
  if (mem) {
    mem.revokedAt = now;
    revoked = true;
  }

  return revoked;
}

export async function revokeAllOwnerSessions(ownerId: string): Promise<number> {
  const now = new Date();
  let count = 0;

  const pool = dbManager.getPool();
  if (pool && dbManager.isDbConnected()) {
    try {
      const res = await pool.query(
        `UPDATE owner_sessions SET revoked_at = $1 WHERE owner_id = $2 AND revoked_at IS NULL`,
        [now, ownerId]
      );
      count += res.rowCount || 0;
    } catch (err) {
      console.warn('[Session] Failed to revoke all sessions in Postgres:', err);
    }
  }

  for (const [key, sess] of inMemorySessions.entries()) {
    if (sess.ownerId === ownerId && !sess.revokedAt) {
      sess.revokedAt = now;
      count++;
    }
  }

  return count;
}
