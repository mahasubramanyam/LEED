import { Request } from 'express';

interface RateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
  blockedUntil?: number;
}

export function normalizeClientIp(req: Request): string {
  // Uses Express req.ip (trusted when app.set('trust proxy', 1) is active)
  const rawIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  // Strip IPv4-mapped IPv6 prefix (e.g. ::ffff:192.168.1.1 -> 192.168.1.1)
  return rawIp.replace(/^::ffff:/, '').trim();
}

const MAX_LOGIN_ENTRIES = 2000;

export class LoginRateLimiter {
  private attemptsMap: Map<string, RateLimitEntry> = new Map();
  private maxAttempts: number;
  private windowMs: number;
  private lockoutMs: number;
  private blockedEvents = 0;

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000, lockoutMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.lockoutMs = lockoutMs;
  }

  private prune(now: number): void {
    for (const [k, entry] of this.attemptsMap.entries()) {
      const expiredWindow = now - entry.firstAttemptAt > this.windowMs;
      const expiredLock = !entry.blockedUntil || entry.blockedUntil <= now;
      if (expiredWindow && expiredLock) {
        this.attemptsMap.delete(k);
      }
    }
    if (this.attemptsMap.size > MAX_LOGIN_ENTRIES) {
      const oldest = Array.from(this.attemptsMap.entries()).sort(
        (a, b) => a[1].firstAttemptAt - b[1].firstAttemptAt
      );
      const dropCount = oldest.length - MAX_LOGIN_ENTRIES;
      for (let i = 0; i < dropCount; i++) {
        this.attemptsMap.delete(oldest[i][0]);
      }
    }
  }

  public check(ip: string): { allowed: boolean; remainingAttempts: number; retryAfterSeconds?: number } {
    const cleanIp = ip.replace(/^::ffff:/, '').trim();
    const now = Date.now();
    this.prune(now);
    const entry = this.attemptsMap.get(cleanIp);

    if (!entry) {
      return { allowed: true, remainingAttempts: this.maxAttempts };
    }

    // Check if lockout is still active
    if (entry.blockedUntil && entry.blockedUntil > now) {
      const retryAfterSeconds = Math.ceil((entry.blockedUntil - now) / 1000);
      return { allowed: false, remainingAttempts: 0, retryAfterSeconds };
    }

    // Check if window has expired
    if (now - entry.firstAttemptAt > this.windowMs) {
      this.attemptsMap.delete(cleanIp);
      return { allowed: true, remainingAttempts: this.maxAttempts };
    }

    const remaining = Math.max(0, this.maxAttempts - entry.attempts);
    return {
      allowed: entry.attempts < this.maxAttempts,
      remainingAttempts: remaining,
    };
  }

  public recordFailure(ip: string): { remainingAttempts: number; retryAfterSeconds?: number } {
    const cleanIp = ip.replace(/^::ffff:/, '').trim();
    const now = Date.now();
    this.prune(now);
    let entry = this.attemptsMap.get(cleanIp);

    if (!entry || now - entry.firstAttemptAt > this.windowMs) {
      entry = { attempts: 1, firstAttemptAt: now };
    } else {
      entry.attempts += 1;
    }

    if (entry.attempts >= this.maxAttempts) {
      entry.blockedUntil = now + this.lockoutMs;
      this.blockedEvents += 1;
      this.attemptsMap.set(cleanIp, entry);
      return {
        remainingAttempts: 0,
        retryAfterSeconds: Math.ceil(this.lockoutMs / 1000),
      };
    }

    this.attemptsMap.set(cleanIp, entry);
    return {
      remainingAttempts: this.maxAttempts - entry.attempts,
    };
  }

  public reset(ip: string): void {
    const cleanIp = ip.replace(/^::ffff:/, '').trim();
    this.attemptsMap.delete(cleanIp);
  }

  public clear(): void {
    this.attemptsMap.clear();
    this.blockedEvents = 0;
  }

  public getStats(): { activeTrackedIps: number; blockedEvents: number; maxAttempts: number } {
    this.prune(Date.now());
    return {
      activeTrackedIps: this.attemptsMap.size,
      blockedEvents: this.blockedEvents,
      maxAttempts: this.maxAttempts,
    };
  }
}

export const loginRateLimiter = new LoginRateLimiter();
