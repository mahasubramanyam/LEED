import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export interface DbConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  maxConnections?: number;
}

class DatabaseManager {
  private pool: pg.Pool | null = null;
  private isConnected = false;
  private connectionError: string | null = null;

  constructor() {
    this.initPool();
  }

  public initPool(): pg.Pool | null {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString && !process.env.PGHOST) {
      this.connectionError = 'DATABASE_URL or PGHOST not configured in environment';
      this.isConnected = false;
      return null;
    }

    try {
      const isProduction = process.env.NODE_ENV === 'production';
      const useSsl = process.env.DATABASE_SSL === 'true' || (connectionString && connectionString.includes('sslmode=require'));

      this.pool = new Pool({
        connectionString: connectionString || undefined,
        host: process.env.PGHOST || undefined,
        port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : undefined,
        user: process.env.PGUSER || undefined,
        password: process.env.PGPASSWORD || undefined,
        database: process.env.PGDATABASE || undefined,
        max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 15,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      });

      this.pool.on('error', (err) => {
        console.error('Unexpected idle PostgreSQL client error:', err.message);
        this.connectionError = err.message;
        this.isConnected = false;
      });

      return this.pool;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.connectionError = msg;
      this.isConnected = false;
      return null;
    }
  }

  public getPool(): pg.Pool | null {
    return this.pool;
  }

  public async checkConnection(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
    if (!this.pool) {
      this.initPool();
      if (!this.pool) {
        return { connected: false, error: this.connectionError || 'PostgreSQL pool not initialized' };
      }
    }

    const start = Date.now();
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1 AS healthcheck');
      client.release();
      this.isConnected = true;
      this.connectionError = null;
      return { connected: true, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.isConnected = false;
      this.connectionError = msg;
      return { connected: false, error: msg };
    }
  }

  public isDbConnected(): boolean {
    return this.isConnected;
  }

  public getHealthStatus() {
    return {
      isConfigured: !!(process.env.DATABASE_URL || process.env.PGHOST),
      isConnected: this.isConnected,
      error: this.connectionError,
      poolActive: !!this.pool,
    };
  }

  public async closePool(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.isConnected = false;
    }
  }
}

export const dbManager = new DatabaseManager();
