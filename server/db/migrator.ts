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

  /**
   * Executes pending forward (.sql) migrations in alphabetical order within a transaction.
   * Optionally scopes execution strictly to a single targetVersion (e.g. '004').
   * Tracks applied versions in `schema_migrations`.
   */
  public async runMigrations(
    clientOrPool?: pg.Pool | pg.PoolClient,
    options?: { targetVersion?: string }
  ): Promise<MigrationResult> {
    const targetVersion = options?.targetVersion?.trim();
    if (targetVersion && !/^\d{3}$/.test(targetVersion)) {
      return {
        success: false,
        applied: [],
        alreadyApplied: [],
        error: `Invalid target migration version "${targetVersion}".`,
      };
    }

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

      // 3. Read forward migration files (exclude .down.sql files)
      if (!fs.existsSync(this.migrationsDir)) {
        await client.query('COMMIT');
        return { success: true, applied: [], alreadyApplied: [] };
      }

      const allFiles = fs
        .readdirSync(this.migrationsDir)
        .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
        .sort();

      const files = targetVersion
        ? allFiles.filter((f) => f.split('_')[0] === targetVersion)
        : allFiles;

      if (targetVersion && files.length === 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          applied: [],
          alreadyApplied: allFiles.filter((f) => appliedSet.has(f.split('_')[0])),
          error: `Target migration ${targetVersion} script not found.`,
        };
      }

      if (targetVersion) {
        for (const f of allFiles) {
          const v = f.split('_')[0];
          if (v !== targetVersion && appliedSet.has(v)) {
            alreadyApplied.push(f);
          }
        }
      }

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
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = rawMsg.replace(/:[^:@]+@/, ':***@');
      return { success: false, applied, alreadyApplied, error: safeMsg };
    } finally {
      if ('release' in client) {
        try {
          client.release();
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Genuine rollback of the latest applied migration.
   * Requires and executes the corresponding `<version>_*.down.sql` DDL script.
   * Never just deletes the tracking row.
   */
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
      const baseName = lastMigration.name.replace(/\.sql$/, '');
      const downFileName = `${baseName}.down.sql`;
      const downFilePath = path.join(this.migrationsDir, downFileName);

      if (!fs.existsSync(downFilePath)) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: `Rollback aborted: Missing genuine down migration script (${downFileName}). Schema state left unchanged.`,
        };
      }

      const downSql = fs.readFileSync(downFilePath, 'utf-8');
      await client.query(downSql);

      await client.query('DELETE FROM schema_migrations WHERE version = $1', [lastMigration.version]);
      await client.query('COMMIT');
      return { success: true, rolledBack: lastMigration.name };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const rawMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: rawMsg.replace(/:[^:@]+@/, ':***@') };
    } finally {
      if ('release' in client) {
        try {
          client.release();
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Verifies existing schema tables in PostgreSQL.
   */
  public async getExistingTables(clientOrPool?: pg.Pool | pg.PoolClient): Promise<string[]> {
    const pool = clientOrPool || dbManager.getPool();
    if (!pool) return [];

    const client = 'connect' in pool ? await (pool as pg.Pool).connect() : (pool as pg.PoolClient);
    try {
      const { rows } = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name ASC`
      );
      return rows.map((r: { table_name: string }) => r.table_name);
    } catch (err) {
      console.error('[Migrator] Error checking existing tables:', err);
      return [];
    } finally {
      if ('release' in client) {
        try {
          client.release();
        } catch {
          // ignore
        }
      }
    }
  }
  /**
   * Read-only inspection of schema_migrations and Migration 003 / 004 schema objects.
   * Never executes DDL or mutates database state.
   */
  public async inspectMigrationStatus(clientOrPool?: pg.Pool | pg.PoolClient): Promise<{
    available: boolean;
    schemaMigrationsExists: boolean;
    appliedVersions: Array<{ version: string; name: string; appliedAt: string }>;
    latestVersion: string | null;
    migrations001To003Recorded: boolean;
    migration003Recorded: boolean;
    leadIdentifiersColumns: string[];
    expectedLeadIdentifierColumns: string[];
    missingLeadIdentifierColumns: string[];
    existingIndexes: string[];
    expectedMigration003Indexes: string[];
    missingMigration003Indexes: string[];
    countryCapabilitiesTableExists: boolean;
    migration003SchemaReady: boolean;
    migration004Recorded: boolean;
    migration004SchemaReady: boolean;
    migration004ExpectedColumnsCount: number;
    migration004PresentColumnsCount: number;
    missingMigration004Columns: string[];
    migration004ExpectedIndexesCount: number;
    migration004PresentIndexesCount: number;
    missingMigration004Indexes: string[];
    error?: string;
  }> {
    const expectedCols = ['country_code', 'normalized_value', 'issuing_authority', 'source', 'status'];
    const expectedIndexes = [
      'idx_lead_identifiers_normalized',
      'idx_lead_identifiers_country',
      'idx_lead_identifiers_status',
      'idx_leads_city',
      'idx_leads_region',
      'idx_leads_country',
      'idx_country_caps_code',
      'idx_country_caps_status',
    ];
    const expected004CredCols = [
      'key_version',
      'masked_hint',
      'rotated_at',
      'validated_at',
      'validation_status',
    ];
    const expected004RunCols = [
      'operation',
      'started_at',
      'completed_at',
      'duration_ms',
      'records_discovered',
      'records_normalized',
      'records_rejected',
      'error_category',
      'diagnostic_summary',
      'rate_limit_remaining',
      'rate_limit_reset_at',
      'request_id',
    ];
    const expected004SettingsCols = ['connector_configs'];
    const allExpected004Cols = [
      ...expected004CredCols.map((c) => `connector_credentials.${c}`),
      ...expected004RunCols.map((c) => `connector_runs.${c}`),
      ...expected004SettingsCols.map((c) => `app_settings.${c}`),
    ];
    const expected004Indexes = ['idx_connector_runs_conn_executed', 'idx_connector_runs_status'];

    const pool = clientOrPool || dbManager.getPool();
    if (!pool) {
      return {
        available: false,
        schemaMigrationsExists: false,
        appliedVersions: [],
        latestVersion: null,
        migrations001To003Recorded: false,
        migration003Recorded: false,
        leadIdentifiersColumns: [],
        expectedLeadIdentifierColumns: expectedCols,
        missingLeadIdentifierColumns: expectedCols,
        existingIndexes: [],
        expectedMigration003Indexes: expectedIndexes,
        missingMigration003Indexes: expectedIndexes,
        countryCapabilitiesTableExists: false,
        migration003SchemaReady: false,
        migration004Recorded: false,
        migration004SchemaReady: false,
        migration004ExpectedColumnsCount: allExpected004Cols.length,
        migration004PresentColumnsCount: 0,
        missingMigration004Columns: allExpected004Cols,
        migration004ExpectedIndexesCount: expected004Indexes.length,
        migration004PresentIndexesCount: 0,
        missingMigration004Indexes: expected004Indexes,
        error: 'Database connection pool not available',
      };
    }

    const client = 'connect' in pool ? await (pool as pg.Pool).connect() : (pool as pg.PoolClient);
    try {
      const regRes = await client.query(
        `SELECT to_regclass('public.schema_migrations') as mig_tbl, to_regclass('public.country_source_capabilities') as cap_tbl`
      );
      const schemaMigrationsExists = Boolean(regRes.rows[0]?.mig_tbl);
      const countryCapabilitiesTableExists = Boolean(regRes.rows[0]?.cap_tbl);

      let appliedVersions: Array<{ version: string; name: string; appliedAt: string }> = [];
      if (schemaMigrationsExists) {
        const migRows = await client.query(
          `SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC`
        );
        appliedVersions = migRows.rows.map((r: any) => ({
          version: String(r.version),
          name: String(r.name),
          appliedAt: r.applied_at ? new Date(r.applied_at).toISOString() : '',
        }));
      }

      const colRes = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'lead_identifiers' ORDER BY ordinal_position ASC`
      );
      const leadIdentifiersColumns = colRes.rows.map((r: { column_name: string }) => r.column_name);
      const colSet = new Set(leadIdentifiersColumns);
      const missingLeadIdentifierColumns = expectedCols.filter((c) => !colSet.has(c));

      const credColRes = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'connector_credentials' ORDER BY ordinal_position ASC`
      );
      const credColSet = new Set(credColRes.rows.map((r: { column_name: string }) => r.column_name));

      const runsColRes = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'connector_runs' ORDER BY ordinal_position ASC`
      );
      const runsColSet = new Set(runsColRes.rows.map((r: { column_name: string }) => r.column_name));

      const settingsColRes = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'app_settings' ORDER BY ordinal_position ASC`
      );
      const settingsColSet = new Set(settingsColRes.rows.map((r: { column_name: string }) => r.column_name));

      const missingMigration004Columns = [
        ...expected004CredCols.filter((c) => !credColSet.has(c)).map((c) => `connector_credentials.${c}`),
        ...expected004RunCols.filter((c) => !runsColSet.has(c)).map((c) => `connector_runs.${c}`),
        ...expected004SettingsCols.filter((c) => !settingsColSet.has(c)).map((c) => `app_settings.${c}`),
      ];

      const idxRes = await client.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname ASC`
      );
      const existingIndexes = idxRes.rows.map((r: { indexname: string }) => r.indexname);
      const idxSet = new Set(existingIndexes);
      const missingMigration003Indexes = expectedIndexes.filter((idx) => !idxSet.has(idx));
      const missingMigration004Indexes = expected004Indexes.filter((idx) => !idxSet.has(idx));

      const recordedSet = new Set(appliedVersions.map((v) => v.version));
      const migrations001To003Recorded = ['001', '002', '003'].every((v) => recordedSet.has(v));
      const migration003Recorded = recordedSet.has('003');
      const migration004Recorded = recordedSet.has('004');
      const latestVersion = appliedVersions.length > 0 ? appliedVersions[appliedVersions.length - 1].version : null;

      return {
        available: true,
        schemaMigrationsExists,
        appliedVersions,
        latestVersion,
        migrations001To003Recorded,
        migration003Recorded,
        leadIdentifiersColumns,
        expectedLeadIdentifierColumns: expectedCols,
        missingLeadIdentifierColumns,
        existingIndexes,
        expectedMigration003Indexes: expectedIndexes,
        missingMigration003Indexes,
        countryCapabilitiesTableExists,
        migration003SchemaReady:
          migration003Recorded &&
          missingLeadIdentifierColumns.length === 0 &&
          missingMigration003Indexes.length === 0 &&
          countryCapabilitiesTableExists,
        migration004Recorded,
        migration004SchemaReady:
          migration004Recorded &&
          missingMigration004Columns.length === 0 &&
          missingMigration004Indexes.length === 0,
        migration004ExpectedColumnsCount: allExpected004Cols.length,
        migration004PresentColumnsCount: allExpected004Cols.length - missingMigration004Columns.length,
        missingMigration004Columns,
        migration004ExpectedIndexesCount: expected004Indexes.length,
        migration004PresentIndexesCount: expected004Indexes.length - missingMigration004Indexes.length,
        missingMigration004Indexes,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        available: false,
        schemaMigrationsExists: false,
        appliedVersions: [],
        latestVersion: null,
        migrations001To003Recorded: false,
        migration003Recorded: false,
        leadIdentifiersColumns: [],
        expectedLeadIdentifierColumns: expectedCols,
        missingLeadIdentifierColumns: expectedCols,
        existingIndexes: [],
        expectedMigration003Indexes: expectedIndexes,
        missingMigration003Indexes: expectedIndexes,
        countryCapabilitiesTableExists: false,
        migration003SchemaReady: false,
        migration004Recorded: false,
        migration004SchemaReady: false,
        migration004ExpectedColumnsCount: allExpected004Cols.length,
        migration004PresentColumnsCount: 0,
        missingMigration004Columns: allExpected004Cols,
        migration004ExpectedIndexesCount: expected004Indexes.length,
        migration004PresentIndexesCount: 0,
        missingMigration004Indexes: expected004Indexes,
        error: msg.replace(/:[^:@]+@/, ':***@'),
      };
    } finally {
      if ('release' in client) {
        try {
          client.release();
        } catch {
          // ignore
        }
      }
    }
  }
}

export const migrator = new Migrator();
