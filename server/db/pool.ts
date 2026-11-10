import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export interface DbHealthStatus {
  isConfigured: boolean;
  isConnected: boolean;
  engine: 'postgresql' | 'unconfigured';
  error: string | null;
  poolActive: boolean;
  totalClients?: number;
  idleClients?: number;
  waitingClients?: number;
  lastCheckedAt?: string;
  consecutiveFailures: number;
}

class DatabaseManager {
  private pool: pg.Pool | null = null;
  private isConnected = false;
  private connectionError: string | null = null;
  private lastCheckedAt: Date | null = null;
  private consecutiveFailures = 0;
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
        max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 6000,
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
