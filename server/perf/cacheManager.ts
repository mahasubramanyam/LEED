// Phase 17: Bounded In-Memory LRU + TTL Cache Manager (Zero external dependencies / No Redis)
// Safe caching policy:
// - Strictly owner-scoped keys
// - Bounded max entry count AND estimated memory cap with deterministic LRU eviction
// - Explicit invalidation hooks on write paths
// - Hard runtime block against caching auth decisions, sessions, CSRF, suppression/DNC compliance, credentials, or private notes.

export type CacheNamespace =
  | 'bi_analytics'
  | 'crm_summary'
  | 'connector_metadata'
  | 'discovery_query'
  | 'quality_summary';

const FORBIDDEN_KEY_PATTERN =
  /(^|:)(auth|session|csrf|suppression|do_not_contact|dnc|private_note|private_notes|credential|credentials|password|token|secret)(:|$)/i;

interface CacheEntry<T = unknown> {
  key: string;
  namespace: CacheNamespace;
  ownerScope: string;
  value: T;
  estimatedBytes: number;
  createdAt: number;
  expiresAt: number;
  hits: number;
}

export interface CacheStatsSnapshot {
  provenance: 'measured';
  maxEntries: number;
  maxEstimatedBytes: number;
  currentEntries: number;
  currentEstimatedBytes: number;
  hits: number;
  misses: number;
  hitRatePercent: number | null;
  evictions: number;
  expirations: number;
  invalidations: number;
  blockedSensitiveAttempts: number;
  byNamespace: Record<string, { entries: number; estimatedBytes: number; hits: number; misses: number }>;
  neverCachedCategories: string[];
}

function estimatePayloadBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json ? Buffer.byteLength(json, 'utf8') : 64;
  } catch {
    return 1024;
  }
}

export class LeedCacheManager {
  private readonly maxEntries: number;
  private readonly maxEstimatedBytes: number;
  private entries = new Map<string, CacheEntry>();
  private currentBytes = 0;

  private totalHits = 0;
  private totalMisses = 0;
  private totalEvictions = 0;
  private totalExpirations = 0;
  private totalInvalidations = 0;
  private blockedSensitiveAttempts = 0;
  private nsStats = new Map<string, { hits: number; misses: number }>();

  constructor(options: { maxEntries?: number; maxEstimatedBytes?: number } = {}) {
    this.maxEntries = Math.max(16, options.maxEntries ?? 256);
    this.maxEstimatedBytes = Math.max(256 * 1024, options.maxEstimatedBytes ?? 16 * 1024 * 1024);
  }

  private buildFullKey(namespace: CacheNamespace, ownerScope: string, key: string): string {
    const safeOwner = (ownerScope || 'owner').trim().toLowerCase();
    const full = `${namespace}:${safeOwner}:${key}`;
    if (FORBIDDEN_KEY_PATTERN.test(full)) {
      this.blockedSensitiveAttempts++;
      throw new Error(`Cache policy violation: sensitive key "${namespace}:${key}" is prohibited from caching.`);
    }
    return full;
  }

  private bumpNs(namespace: CacheNamespace, field: 'hits' | 'misses'): void {
    const cur = this.nsStats.get(namespace) || { hits: 0, misses: 0 };
    cur[field]++;
    this.nsStats.set(namespace, cur);
  }

  private evictIfNeeded(incomingBytes: number): void {
    // First purge expired entries
    const now = Date.now();
    for (const [k, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(k);
        this.currentBytes = Math.max(0, this.currentBytes - entry.estimatedBytes);
        this.totalExpirations++;
      }
    }

    // Evict least-recently-used entries (front of Map iteration order) until within bounds
    while (
      this.entries.size > 0 &&
      (this.entries.size >= this.maxEntries || this.currentBytes + incomingBytes > this.maxEstimatedBytes)
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) {
        this.currentBytes = Math.max(0, this.currentBytes - oldest.estimatedBytes);
      }
      this.totalEvictions++;
    }
  }

  public get<T>(namespace: CacheNamespace, ownerScope: string, key: string): T | undefined {
    const fullKey = this.buildFullKey(namespace, ownerScope, key);
    const entry = this.entries.get(fullKey);
    if (!entry) {
      this.totalMisses++;
      this.bumpNs(namespace, 'misses');
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(fullKey);
      this.currentBytes = Math.max(0, this.currentBytes - entry.estimatedBytes);
      this.totalExpirations++;
      this.totalMisses++;
      this.bumpNs(namespace, 'misses');
      return undefined;
    }

    // LRU promotion: delete and re-insert at end
    this.entries.delete(fullKey);
    entry.hits++;
    this.entries.set(fullKey, entry);

    this.totalHits++;
    this.bumpNs(namespace, 'hits');
    return entry.value as T;
  }

  public set<T>(
    namespace: CacheNamespace,
    ownerScope: string,
    key: string,
    value: T,
    ttlMs: number
  ): boolean {
    const fullKey = this.buildFullKey(namespace, ownerScope, key);
    const safeTtl = Math.max(500, Math.min(30 * 60 * 1000, ttlMs));
    const estimatedBytes = estimatePayloadBytes(value);

    // Refuse single entry exceeding 25% of total budget to avoid thrashing
    if (estimatedBytes > this.maxEstimatedBytes * 0.25) {
      return false;
    }

    const existing = this.entries.get(fullKey);
    if (existing) {
      this.entries.delete(fullKey);
      this.currentBytes = Math.max(0, this.currentBytes - existing.estimatedBytes);
    }

    this.evictIfNeeded(estimatedBytes);

    const now = Date.now();
    this.entries.set(fullKey, {
      key: fullKey,
      namespace,
      ownerScope: (ownerScope || 'owner').trim().toLowerCase(),
      value,
      estimatedBytes,
      createdAt: now,
      expiresAt: now + safeTtl,
      hits: 0,
    });
    this.currentBytes += estimatedBytes;
    return true;
  }

  public async getOrCompute<T>(params: {
    namespace: CacheNamespace;
    ownerScope: string;
    key: string;
    ttlMs: number;
    compute: () => Promise<T>;
  }): Promise<{ value: T; cacheHit: boolean }> {
    const cached = this.get<T>(params.namespace, params.ownerScope, params.key);
    if (cached !== undefined) {
      return { value: cached, cacheHit: true };
    }
    const fresh = await params.compute();
    this.set(params.namespace, params.ownerScope, params.key, fresh, params.ttlMs);
    return { value: fresh, cacheHit: false };
  }

  public invalidateNamespace(namespace: CacheNamespace): number {
    let removed = 0;
    for (const [k, entry] of this.entries.entries()) {
      if (entry.namespace === namespace) {
        this.entries.delete(k);
        this.currentBytes = Math.max(0, this.currentBytes - entry.estimatedBytes);
        removed++;
      }
    }
    this.totalInvalidations += removed;
    return removed;
  }

  public invalidateNamespaces(namespaces: CacheNamespace[]): number {
    let removed = 0;
    const set = new Set<CacheNamespace>(namespaces);
    for (const [k, entry] of this.entries.entries()) {
      if (set.has(entry.namespace)) {
        this.entries.delete(k);
        this.currentBytes = Math.max(0, this.currentBytes - entry.estimatedBytes);
        removed++;
      }
    }
    this.totalInvalidations += removed;
    return removed;
  }

  /**
   * Explicit domain write-path invalidators.
   */
  public invalidateOnCrmWrite(): number {
    return this.invalidateNamespaces(['bi_analytics', 'crm_summary', 'quality_summary']);
  }

  public invalidateOnOutreachOrWorkflowWrite(): number {
    return this.invalidateNamespaces(['bi_analytics', 'crm_summary']);
  }

  public invalidateOnConnectorWrite(): number {
    return this.invalidateNamespaces(['connector_metadata', 'discovery_query']);
  }

  public clearAll(): number {
    const count = this.entries.size;
    this.entries.clear();
    this.currentBytes = 0;
    this.totalInvalidations += count;
    return count;
  }

  public resetMetrics(): void {
    this.totalHits = 0;
    this.totalMisses = 0;
    this.totalEvictions = 0;
    this.totalExpirations = 0;
    this.totalInvalidations = 0;
    this.blockedSensitiveAttempts = 0;
    this.nsStats.clear();
  }

  public getStats(): CacheStatsSnapshot {
    // Purge expired entries before reporting live counts
    const now = Date.now();
    for (const [k, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(k);
        this.currentBytes = Math.max(0, this.currentBytes - entry.estimatedBytes);
        this.totalExpirations++;
      }
    }

    const byNamespace: CacheStatsSnapshot['byNamespace'] = {};
    for (const ns of ['bi_analytics', 'crm_summary', 'connector_metadata', 'discovery_query', 'quality_summary'] as const) {
      const counters = this.nsStats.get(ns) || { hits: 0, misses: 0 };
      byNamespace[ns] = { entries: 0, estimatedBytes: 0, hits: counters.hits, misses: counters.misses };
    }
    for (const entry of this.entries.values()) {
      const bucket = byNamespace[entry.namespace] || { entries: 0, estimatedBytes: 0, hits: 0, misses: 0 };
      bucket.entries++;
      bucket.estimatedBytes += entry.estimatedBytes;
      byNamespace[entry.namespace] = bucket;
    }

    const totalLookups = this.totalHits + this.totalMisses;
    return {
      provenance: 'measured',
      maxEntries: this.maxEntries,
      maxEstimatedBytes: this.maxEstimatedBytes,
      currentEntries: this.entries.size,
      currentEstimatedBytes: this.currentBytes,
      hits: this.totalHits,
      misses: this.totalMisses,
      hitRatePercent: totalLookups > 0 ? Number(((this.totalHits / totalLookups) * 100).toFixed(1)) : null,
      evictions: this.totalEvictions,
      expirations: this.totalExpirations,
      invalidations: this.totalInvalidations,
      blockedSensitiveAttempts: this.blockedSensitiveAttempts,
      byNamespace,
      neverCachedCategories: [
        'Authentication & session decisions',
        'CSRF token validation',
        'Outreach suppression, opt-out & do_not_contact checks',
        'Encrypted connector credentials',
        'Private owner CRM notes',
      ],
    };
  }
}

export const leedCache = new LeedCacheManager({
  maxEntries: 256,
  maxEstimatedBytes: 16 * 1024 * 1024,
});
