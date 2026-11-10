import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { dbManager } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationResult {
  success: boolean;
  applied: string[];
  alreadyApplied: string[];
  error?: string;
}

export class Migrator {
  private migrationsDir: string;

  constructor(customDir?: string) {
    this.migrationsDir = customDir || path.resolve(__dirname, 'migrations');
  }

  public async runMigrations(clientOrPool?: pg.Pool | pg.PoolClient): Promise<MigrationResult> {
    const pool = clientOrPool || dbManager.getPool();
    if (!pool) {
      return {
        success: false,
        applied: [],
        alreadyApplied: [],
        error: 'Database connection pool not available',
      };
    }

    const client = 'connect' in pool ? await (pool as pg.Pool).connect() : (pool as pg.PoolClient);
    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    try {
      await client.query('BEGIN');

      // 1. Ensure migrations tracking table exists
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // 2. Fetch applied migrations
      const { rows } = await client.query('SELECT version FROM schema_migrations ORDER BY version ASC');
      const appliedSet = new Set(rows.map((r: { version: string }) => r.version));

      // 3. Read migration files
      if (!fs.existsSync(this.migrationsDir)) {
        await client.query('COMMIT');
        return { success: true, applied: [], alreadyApplied: [] };
      }

      const files = fs
        .readdirSync(this.migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        const version = file.split('_')[0];
        if (appliedSet.has(version)) {
          alreadyApplied.push(file);
          continue;
        }

        const sqlPath = path.join(this.migrationsDir, file);
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        // Execute migration within transaction
        await client.query(sql);

        // Record migration
        await client.query(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, NOW())',
          [version, file]
        );

        applied.push(file);
      }

      await client.query('COMMIT');
      return { success: true, applied, alreadyApplied };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, applied, alreadyApplied, error: msg };
    } finally {
      if ('release' in client) {
        client.release();
      }
    }
  }

  public async rollbackLast(clientOrPool?: pg.Pool | pg.PoolClient): Promise<{ success: boolean; rolledBack?: string; error?: string }> {
    const pool = clientOrPool || dbManager.getPool();
    if (!pool) return { success: false, error: 'Database connection pool not available' };

    const client = 'connect' in pool ? await (pool as pg.Pool).connect() : (pool as pg.PoolClient);

    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1');
      if (rows.length === 0) {
        await client.query('COMMIT');
        return { success: true, rolledBack: undefined };
      }

      const lastMigration = rows[0];
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [lastMigration.version]);
      await client.query('COMMIT');
      return { success: true, rolledBack: lastMigration.name };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    } finally {
      if ('release' in client) {
        client.release();
      }
    }
  }
}

export const migrator = new Migrator();
