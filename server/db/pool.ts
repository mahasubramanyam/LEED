import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const DEFAULT_DB_POOL_MAX = Math.max(2, Math.min(30, parseInt(process.env.DB_POOL_MAX || '10', 10) || 10));
export const DEFAULT_DB_IDLE_TIMEOUT_MS = Math.max(5000, parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10) || 30000);
export const DEFAULT_DB_CONN_TIMEOUT_MS = Math.max(2000, parseInt(process.env.DB_CONN_TIMEOUT_MS || '6000', 10) || 6000);
export const DEFAULT_DB_STATEMENT_TIMEOUT_MS = Math.max(
  2000,
  parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '15000', 10) || 15000
);

const TRANSIENT_PG_CODES = new Set([
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '53300',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EPIPE',
]);
const TRANSIENT_MSG_PATTERN =
  /(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|Connection terminated unexpectedly|Client has encountered a connection error|terminating connection due to administrator command)/i;

export function isTransientPgError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: unknown }).code || '');
  if (code && TRANSIENT_PG_CODES.has(code)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_MSG_PATTERN.test(msg);
}

function hashLockKeyPair(lockName: string): [number, number] {
  const digest = crypto.createHash('sha256').update(lockName).digest();
  // Read two signed 32-bit integers for pg_advisory_lock(int4, int4)
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export interface DbHealthStatus {
  isConfigured: boolean;
  isConnected: boolean;
  engine: 'postgresql' | 'unconfigured';
  error: string | null;
  poolActive: boolean;
  totalClients?: number;
  idleClients?: number;
  waitingClients?: number;
  maxClients?: number;
  statementTimeoutMs?: number;
  idleTimeoutMs?: number;
  reconnectAttempts?: number;
  lastCheckedAt?: string;
  consecutiveFailures: number;
}

class DatabaseManager {
  private pool: pg.Pool | null = null;
  private isConnected = false;
  private connectionError: string | null = null;
  private lastCheckedAt: Date | null = null;
  private consecutiveFailures = 0;
  private reconnectAttempts = 0;
  private shutdownInitiated = false;

  constructor() {
    this.initPool();
  }

  /**
   * Initializes the PostgreSQL connection pool using environment configuration.
   * Never prints secrets, connection strings, or credentials to logs.
   */
  public initPool(): pg.Pool | null {
    if (this.shutdownInitiated) return null;

    const connectionString = process.env.DATABASE_URL;
    const hasHost = !!process.env.PGHOST;

    if (!connectionString && !hasHost) {
      this.connectionError = 'DATABASE_URL or PGHOST is not configured in environment';
      this.isConnected = false;
      return null;
    }

    try {
      // Determine SSL requirements. Neon requires SSL with valid certificate validation.
      const sslMode = (process.env.PGSSLMODE || '').toLowerCase();
      const requiresSsl =
        sslMode === 'require' ||
        sslMode === 'verify-full' ||
        sslMode === 'verify-ca' ||
        (connectionString && (connectionString.includes('sslmode=require') || connectionString.includes('neon.tech')));

      // Default rejectUnauthorized to true for secure TLS validation (e.g. Neon Let's Encrypt CAs)
      const rejectUnauthorized = sslMode !== 'no-verify';

      const poolConfig: pg.PoolConfig = {
        connectionString: connectionString || undefined,
        host: process.env.PGHOST || undefined,
        port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : undefined,
        user: process.env.PGUSER || undefined,
        password: process.env.PGPASSWORD || undefined,
        database: process.env.PGDATABASE || undefined,
        max: DEFAULT_DB_POOL_MAX,
        idleTimeoutMillis: DEFAULT_DB_IDLE_TIMEOUT_MS,
        connectionTimeoutMillis: DEFAULT_DB_CONN_TIMEOUT_MS,
        statement_timeout: DEFAULT_DB_STATEMENT_TIMEOUT_MS,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
        allowExitOnIdle: true,
        ssl: requiresSsl ? { rejectUnauthorized } : undefined,
      };

      this.pool = new Pool(poolConfig);

      this.pool.on('error', (err) => {
        // Redact any potential credential leakage in error messages
        const safeMsg = err.message.replace(/:[^:@]+@/, ':***@');
        console.error('[PostgreSQL Pool] Unexpected error on idle client:', safeMsg);
        this.connectionError = safeMsg;
        this.isConnected = false;
        this.consecutiveFailures++;
      });

      this.connectionError = null;
      return this.pool;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.connectionError = msg.replace(/:[^:@]+@/, ':***@');
      this.isConnected = false;
      this.consecutiveFailures++;
      return null;
    }
  }

  public getPool(): pg.Pool | null {
    if (!this.pool && (process.env.DATABASE_URL || process.env.PGHOST)) {
      this.initPool();
    }
    return this.pool;
  }

  /**
   * Executes an async DB operation with bounded retry on transient disconnect/reset errors.
   * Never retries constraint, validation, or SQL syntax errors.
   */
  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: { maxRetries?: number; baseDelayMs?: number } = {}
  ): Promise<T> {
    const maxRetries = Math.max(0, Math.min(3, options.maxRetries ?? 2));
    const baseDelayMs = Math.max(25, options.baseDelayMs ?? 150);
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        if (attempt > 0) {
          this.isConnected = true;
          this.connectionError = null;
          this.consecutiveFailures = 0;
        }
        return result;
      } catch (err: unknown) {
        lastError = err;
        if (!isTransientPgError(err) || attempt >= maxRetries || this.shutdownInitiated) {
          throw err;
        }
        this.reconnectAttempts++;
        this.consecutiveFailures++;
        const waitMs = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    throw lastError;
  }

  /**
   * Acquires a PostgreSQL session advisory lock for cross-process / concurrent safety when PG is connected.
   * Always unlocks and releases the client in `finally`. Falls back to direct execution if PG is inactive.
   */
  public async withAdvisoryLock<T>(lockName: string, fn: () => Promise<T>): Promise<T> {
    if (!this.isConnected || this.shutdownInitiated) {
      return fn();
    }
    const pool = this.getPool();
    if (!pool) return fn();

    const [k1, k2] = hashLockKeyPair(lockName);
    let client: pg.PoolClient | null = null;
    let locked = false;

    try {
      client = await pool.connect();
      await client.query('SELECT pg_advisory_lock($1, $2)', [k1, k2]);
      locked = true;
      return await fn();
    } finally {
      if (client) {
        if (locked) {
          try {
            await client.query('SELECT pg_advisory_unlock($1, $2)', [k1, k2]);
          } catch {
            // Connection dropped automatically releases session advisory lock in PostgreSQL
          }
        }
        try {
          client.release();
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Verifies the PostgreSQL connection with retry and exponential backoff.
   * Releases client back to the pool in both success and failure cases.
   */
  public async checkConnection(retries = 1, delayMs = 500): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
    if (this.shutdownInitiated) {
      return { connected: false, error: 'Database shutdown initiated' };
    }

    let attempt = 0;
    while (attempt <= retries) {
      const pool = this.getPool();
      if (!pool) {
        return { connected: false, error: this.connectionError || 'PostgreSQL pool not initialized' };
      }

      const start = Date.now();
      let client: pg.PoolClient | null = null;
      try {
        client = await pool.connect();
        await client.query('SELECT 1 AS healthcheck');
        this.isConnected = true;
        this.connectionError = null;
        this.consecutiveFailures = 0;
        this.lastCheckedAt = new Date();
        return { connected: true, latencyMs: Date.now() - start };
      } catch (err: unknown) {
        attempt++;
        const rawMsg = err instanceof Error ? err.message : String(err);
        const safeMsg = rawMsg.replace(/:[^:@]+@/, ':***@');
        this.connectionError = safeMsg;
        this.consecutiveFailures++;
        this.lastCheckedAt = new Date();

        if (attempt <= retries) {
          this.reconnectAttempts++;
          const waitTime = delayMs * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        } else {
          this.isConnected = false;
          return { connected: false, error: safeMsg };
        }
      } finally {
        if (client) {
          try {
            client.release();
          } catch {
            // Ignore release errors
          }
        }
      }
    }

    return { connected: false, error: this.connectionError || 'Connection check failed' };
  }

  public isDbConnected(): boolean {
    return this.isConnected;
  }

  public isConfigured(): boolean {
    return !!(process.env.DATABASE_URL || process.env.PGHOST);
  }

  public getHealthStatus(): DbHealthStatus {
    const isConfig = this.isConfigured();
    return {
      isConfigured: isConfig,
      isConnected: this.isConnected,
      engine: this.isConnected ? 'postgresql' : isConfig ? 'postgresql' : 'unconfigured',
      error: this.connectionError,
      poolActive: !!this.pool,
      totalClients: this.pool?.totalCount,
      idleClients: this.pool?.idleCount,
      waitingClients: this.pool?.waitingCount,
      maxClients: DEFAULT_DB_POOL_MAX,
      statementTimeoutMs: DEFAULT_DB_STATEMENT_TIMEOUT_MS,
      idleTimeoutMs: DEFAULT_DB_IDLE_TIMEOUT_MS,
      reconnectAttempts: this.reconnectAttempts,
      lastCheckedAt: this.lastCheckedAt ? this.lastCheckedAt.toISOString() : undefined,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * Graceful database pool shutdown. Closes all active clients and prevents new acquisitions.
   */
  public async closePool(): Promise<void> {
    this.shutdownInitiated = true;
    if (this.pool) {
      try {
        await this.pool.end();
      } catch (err) {
        console.error('[PostgreSQL Pool] Error during graceful shutdown:', err);
      } finally {
        this.pool = null;
        this.isConnected = false;
      }
    }
  }
}

export const dbManager = new DatabaseManager();

// Register process exit listeners for safe shutdown
process.on('SIGINT', async () => {
  await dbManager.closePool();
});
process.on('SIGTERM', async () => {
  await dbManager.closePool();
});
