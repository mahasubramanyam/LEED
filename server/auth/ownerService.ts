import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { dbManager } from '../db/pool.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from './password.js';
import { createSession, revokeSession, revokeAllOwnerSessions, OwnerUser, OwnerSession, validateSession } from './session.js';
import { loginRateLimiter } from './rateLimit.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const OWNER_FALLBACK_FILE = path.join(DATA_DIR, 'owner_auth.json');

export interface StoredOwner {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: 'owner';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export class OwnerService {
  private fallbackOwner: StoredOwner | null = null;

  constructor() {
    this.ensureDataDir();
    this.loadFallbackOwner();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadFallbackOwner(): void {
    if (fs.existsSync(OWNER_FALLBACK_FILE)) {
      try {
        const raw = fs.readFileSync(OWNER_FALLBACK_FILE, 'utf-8');
        this.fallbackOwner = JSON.parse(raw);
      } catch (err) {
        console.error('[OwnerService] Failed to load owner fallback file:', err);
      }
    }
  }

  private saveFallbackOwner(owner: StoredOwner): void {
    this.fallbackOwner = owner;
    try {
      fs.writeFileSync(OWNER_FALLBACK_FILE, JSON.stringify(owner, null, 2), 'utf-8');
    } catch (err) {
      console.error('[OwnerService] Failed to persist owner fallback file:', err);
    }
  }

  /**
   * Checks whether the single owner account has been initialized.
   */
  public async isOwnerInitialized(): Promise<boolean> {
    const pool = dbManager.getPool();
    if (pool && dbManager.isDbConnected()) {
      try {
        const res = await pool.query(`SELECT COUNT(*) as count FROM owner_users WHERE is_active = TRUE`);
        const count = parseInt(res.rows[0]?.count || '0', 10);
        if (count > 0) return true;
      } catch (err) {
        console.warn('[OwnerService] Failed to check owner count in DB, checking fallback:', err);
      }
    }

    if (!this.fallbackOwner) {
      this.loadFallbackOwner();
    }
    return this.fallbackOwner !== null && this.fallbackOwner.isActive;
  }

  /**
   * Initializes the single private owner account.
   * Strictly enforces: Only one owner account can ever be registered.
   */
  public async setupOwner(fullName: string, email: string, password: string): Promise<OwnerUser> {
    const initialized = await this.isOwnerInitialized();
    if (initialized) {
      throw new Error('Initial setup already completed. LEED is a private single-owner platform.');
    }

    if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
      throw new Error('Owner full name is required');
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new Error('A valid owner email address is required');
    }

    const validation = validatePasswordStrength(password);
    if (!validation.valid) {
      throw new Error(validation.message || 'Invalid password');
    }

    const passwordHash = await hashPassword(password);
    const ownerId = `owner-${Date.now()}`;
    const now = new Date();
    const normalizedEmail = email.trim().toLowerCase();

    const stored: StoredOwner = {
      id: ownerId,
      email: normalizedEmail,
      fullName: fullName.trim(),
      passwordHash,
      role: 'owner',
      isActive: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    // Save to PostgreSQL if connected
    const pool = dbManager.getPool();
    if (pool && dbManager.isDbConnected()) {
      try {
        await pool.query(
          `INSERT INTO owner_users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'owner', TRUE, $5, $6)`,
          [ownerId, normalizedEmail, passwordHash, fullName.trim(), now, now]
        );
      } catch (err) {
        console.warn('[OwnerService] Failed to insert owner to PostgreSQL, saving fallback:', err);
      }
    }

    // Always keep fallback synchronized
    this.saveFallbackOwner(stored);

    return {
      id: ownerId,
      email: normalizedEmail,
      fullName: fullName.trim(),
      role: 'owner',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Authenticates the owner with email, password, and IP rate limiting.
   */
  public async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ rawToken: string; owner: Omit<OwnerUser, 'role'> & { role: 'owner' } }> {
    const ip = ipAddress || '127.0.0.1';

    // 1. Check Rate Limiter
    const rateCheck = loginRateLimiter.check(ip);
    if (!rateCheck.allowed) {
      throw new Error(`Too many failed login attempts. Account locked. Try again in ${rateCheck.retryAfterSeconds} seconds.`);
    }

    if (!email || !password) {
      loginRateLimiter.recordFailure(ip);
      throw new Error('Email and password are required');
    }

    const normalizedEmail = email.trim().toLowerCase();
    let targetOwner: StoredOwner | null = null;

    // Try finding in PostgreSQL first
    const pool = dbManager.getPool();
    if (pool && dbManager.isDbConnected()) {
      try {
        const res = await pool.query(
          `SELECT id, email, password_hash as "passwordHash", full_name as "fullName",
                  role, is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
           FROM owner_users WHERE email = $1 AND is_active = TRUE`,
          [normalizedEmail]
        );
        if (res.rows.length > 0) {
          targetOwner = res.rows[0];
        }
      } catch (err) {
        console.warn('[OwnerService] Postgres query failed, using fallback:', err);
      }
    }

    // Try fallback store
    if (!targetOwner) {
      this.loadFallbackOwner();
      if (this.fallbackOwner && this.fallbackOwner.email === normalizedEmail) {
        targetOwner = this.fallbackOwner;
      }
    }

    if (!targetOwner) {
      const failure = loginRateLimiter.recordFailure(ip);
      throw new Error(
        `Invalid credentials. ${failure.remainingAttempts > 0 ? `${failure.remainingAttempts} attempts remaining.` : 'Account locked.'}`
      );
    }

    // Verify Password
    const passwordMatch = await verifyPassword(password, targetOwner.passwordHash);
    if (!passwordMatch) {
      const failure = loginRateLimiter.recordFailure(ip);
      throw new Error(
        `Invalid credentials. ${failure.remainingAttempts > 0 ? `${failure.remainingAttempts} attempts remaining.` : 'Account locked.'}`
      );
    }

    // Success: Reset rate limiter for this IP
    loginRateLimiter.reset(ip);

    // Create secure session
    const { rawToken } = await createSession(targetOwner.id, ipAddress, userAgent);

    return {
      rawToken,
      owner: {
        id: targetOwner.id,
        email: targetOwner.email,
        fullName: targetOwner.fullName,
        role: 'owner',
        isActive: targetOwner.isActive,
        createdAt: new Date(targetOwner.createdAt),
        updatedAt: new Date(targetOwner.updatedAt),
      },
    };
  }

  /**
   * Logs out the current session.
   */
  public async logout(rawToken: string): Promise<boolean> {
    return revokeSession(rawToken);
  }

  /**
   * Changes the owner password and revokes existing sessions.
   */
  public async changePassword(
    ownerId: string,
    currentPass: string,
    newPass: string,
    currentRawToken?: string
  ): Promise<boolean> {
    const validation = validatePasswordStrength(newPass);
    if (!validation.valid) {
      throw new Error(validation.message || 'Invalid new password');
    }

    let ownerRecord: StoredOwner | null = null;
    const pool = dbManager.getPool();

    if (pool && dbManager.isDbConnected()) {
      try {
        const res = await pool.query(
          `SELECT id, email, password_hash as "passwordHash", full_name as "fullName",
                  role, is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
           FROM owner_users WHERE id = $1`,
          [ownerId]
        );
        if (res.rows.length > 0) ownerRecord = res.rows[0];
      } catch (err) {
        console.warn('[OwnerService] Postgres check failed in changePassword:', err);
      }
    }

    if (!ownerRecord && this.fallbackOwner && this.fallbackOwner.id === ownerId) {
      ownerRecord = this.fallbackOwner;
    }

    if (!ownerRecord) {
      throw new Error('Owner record not found');
    }

    const match = await verifyPassword(currentPass, ownerRecord.passwordHash);
    if (!match) {
      throw new Error('Current password is incorrect');
    }

    const newHash = await hashPassword(newPass);
    const now = new Date();

    if (pool && dbManager.isDbConnected()) {
      try {
        await pool.query(`UPDATE owner_users SET password_hash = $1, updated_at = $2 WHERE id = $3`, [
          newHash,
          now,
          ownerId,
        ]);
      } catch (err) {
        console.warn('[OwnerService] Failed to update password in Postgres:', err);
      }
    }

    if (this.fallbackOwner && this.fallbackOwner.id === ownerId) {
      this.fallbackOwner.passwordHash = newHash;
      this.fallbackOwner.updatedAt = now.toISOString();
      this.saveFallbackOwner(this.fallbackOwner);
    }

    // Revoke all previous sessions for security
    await revokeAllOwnerSessions(ownerId);

    return true;
  }

  /**
   * Resolves owner user from a valid session.
   */
  public async getOwnerBySession(session: OwnerSession): Promise<OwnerUser | null> {
    const pool = dbManager.getPool();
    if (pool && dbManager.isDbConnected()) {
      try {
        const res = await pool.query(
          `SELECT id, email, full_name as "fullName", role, is_active as "isActive",
                  created_at as "createdAt", updated_at as "updatedAt"
           FROM owner_users WHERE id = $1 AND is_active = TRUE`,
          [session.ownerId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            ...row,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
          };
        }
      } catch (err) {
        console.warn('[OwnerService] Postgres user lookup failed:', err);
      }
    }

    if (!this.fallbackOwner) {
      this.loadFallbackOwner();
    }
    if (this.fallbackOwner && this.fallbackOwner.id === session.ownerId && this.fallbackOwner.isActive) {
      return {
        id: this.fallbackOwner.id,
        email: this.fallbackOwner.email,
        fullName: this.fallbackOwner.fullName,
        role: 'owner',
        isActive: this.fallbackOwner.isActive,
        createdAt: new Date(this.fallbackOwner.createdAt),
        updatedAt: new Date(this.fallbackOwner.updatedAt),
      };
    }

    return null;
  }
}

export const ownerService = new OwnerService();
