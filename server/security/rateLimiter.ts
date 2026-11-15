import { Request, Response, NextFunction } from 'express';
import { normalizeClientIp } from '../auth/rateLimit.js';
import { recordSecurityEvent } from './securityEvents.js';

interface WindowEntry {
  timestamps: number[];
  lastSeenAt: number;
}

export interface RateLimiterCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
}

export interface RateLimiterStats {
  name: string;
  maxRequests: number;
  windowMs: number;
  activeKeys: number;
  blockedCount: number;
}

const MAX_TRACKED_KEYS = 2000;

export class SlidingWindowRateLimiter {
  public readonly name: string;
  public readonly maxRequests: number;
  public readonly windowMs: number;
  private entries = new Map<string, WindowEntry>();
  private blockedCount = 0;

  constructor(name: string, maxRequests: number, windowMs: number) {
    this.name = name;
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [k, entry] of this.entries.entries()) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        this.entries.delete(k);
      }
    }
    if (this.entries.size > MAX_TRACKED_KEYS) {
      const sorted = Array.from(this.entries.entries()).sort(
        (a, b) => a[1].lastSeenAt - b[1].lastSeenAt
      );
      const toDrop = sorted.length - MAX_TRACKED_KEYS;
      for (let i = 0; i < toDrop; i++) {
        this.entries.delete(sorted[i][0]);
      }
    }
  }

  public consume(key: string): RateLimiterCheckResult {
    const now = Date.now();
    this.prune(now);

    const cleanKey = key || '127.0.0.1';
    const cutoff = now - this.windowMs;
    let entry = this.entries.get(cleanKey);
    if (!entry) {
      entry = { timestamps: [], lastSeenAt: now };
    } else {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      entry.lastSeenAt = now;
    }

    if (entry.timestamps.length >= this.maxRequests) {
      const oldest = entry.timestamps[0] || now;
      const resetAtMs = oldest + this.windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
      this.blockedCount += 1;
      this.entries.set(cleanKey, entry);
      return {
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        resetAtMs,
        retryAfterSeconds,
      };
    }

    entry.timestamps.push(now);
    this.entries.set(cleanKey, entry);
    const resetAtMs = (entry.timestamps[0] || now) + this.windowMs;
    return {
      allowed: true,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - entry.timestamps.length),
      resetAtMs,
      retryAfterSeconds: 0,
    };
  }

  public clear(): void {
    this.entries.clear();
    this.blockedCount = 0;
  }

  public getStats(): RateLimiterStats {
    this.prune(Date.now());
    return {
      name: this.name,
      maxRequests: this.maxRequests,
      windowMs: this.windowMs,
      activeKeys: this.entries.size,
      blockedCount: this.blockedCount,
    };
  }
}

export const setupRateLimiter = new SlidingWindowRateLimiter('auth_setup', 10, 15 * 60 * 1000);
export const passwordChangeRateLimiter = new SlidingWindowRateLimiter('auth_password_change', 5, 15 * 60 * 1000);
export const importRateLimiter = new SlidingWindowRateLimiter('import_operations', 30, 10 * 60 * 1000);
export const exportRateLimiter = new SlidingWindowRateLimiter('crm_exports', 20, 10 * 60 * 1000);
export const discoveryRateLimiter = new SlidingWindowRateLimiter('discovery_operations', 30, 5 * 60 * 1000);
export const inspectionRateLimiter = new SlidingWindowRateLimiter('web_inspection', 25, 5 * 60 * 1000);
export const aiRateLimiter = new SlidingWindowRateLimiter('ai_intelligence', 30, 5 * 60 * 1000);
export const migrationRateLimiter = new SlidingWindowRateLimiter('database_migrations', 10, 15 * 60 * 1000);

const ALL_LIMITERS: SlidingWindowRateLimiter[] = [
  setupRateLimiter,
  passwordChangeRateLimiter,
  importRateLimiter,
  exportRateLimiter,
  discoveryRateLimiter,
  inspectionRateLimiter,
  aiRateLimiter,
  migrationRateLimiter,
];

export function createRateLimitMiddleware(limiter: SlidingWindowRateLimiter, customMessage?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = normalizeClientIp(req);
    const result = limiter.consume(`${limiter.name}:${ip}`);

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAtMs / 1000)));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      recordSecurityEvent({
        category: 'rate_limited',
        severity: 'warning',
        path: req.originalUrl || req.path,
        method: req.method,
        ip,
        summary: `Rate limit exceeded on ${limiter.name} (${limiter.maxRequests}/${Math.round(limiter.windowMs / 1000)}s)`,
      });
      res.status(429).json({
        error:
          customMessage ||
          `Rate limit exceeded. Try again in ${result.retryAfterSeconds} seconds.`,
        code: 'RATE_LIMITED',
        retryAfterSeconds: result.retryAfterSeconds,
      });
      return;
    }

    next();
  };
}

export function getAllRateLimiterStats(): RateLimiterStats[] {
  return ALL_LIMITERS.map((l) => l.getStats());
}

export function resetAllSecurityRateLimiters(): void {
  for (const limiter of ALL_LIMITERS) {
    limiter.clear();
  }
}
