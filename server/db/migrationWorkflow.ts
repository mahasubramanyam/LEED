import { redactSecrets } from '../connectors/core/errors.js';
import type { MigrationResult } from './migrator.js';

export interface Migration005InspectionSnapshot {
  migrations001To004Recorded: boolean;
  migration003SchemaReady: boolean;
  migration004SchemaReady: boolean;
  migration005Recorded: boolean;
  migration005SchemaReady: boolean;
  migration005Tables: string[];
  missingMigration005Tables: string[];
  migration005ExpectedTablesCount: number;
  migration005PresentTablesCount: number;
  migration005PresentIndexes: string[];
  missingMigration005Indexes: string[];
  migration005ExpectedIndexesCount: number;
  migration005PresentIndexesCount: number;
  existingCrmTablesExpectedCount: number;
  existingCrmTablesPresentCount: number;
  missingExistingCrmTables: string[];
  existingCrmTablesIntact: boolean;
}

export interface Migration005VerificationPayload {
  tablesPresentCount: number;
  expectedTablesCount: number;
  indexesPresentCount: number;
  expectedIndexesCount: number;
  migrations001To004Recorded: boolean;
  migration005Recorded: boolean;
  schemaReady: boolean;
  migration005SchemaReady: boolean;
  existingCrmTablesIntact: boolean;
  existingCrmTablesPresentCount: number;
  existingCrmTablesExpectedCount: number;
  missingExistingCrmTables: string[];
  migration005Tables: string[];
  missingMigration005Tables: string[];
  migration005PresentIndexes: string[];
  missingMigration005Indexes: string[];
  unrelatedSchemaUnchanged: boolean;
  verified: boolean;
}

export function sanitizeMigrationError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown migration error');
  const redacted = redactSecrets(raw).split('\n')[0].trim();
  // Strip raw SQL statements/blocks if a driver error leaked SQL text
  if (/\b(CREATE\s+TABLE|CREATE\s+UNIQUE\s+INDEX|ALTER\s+TABLE|DROP\s+TABLE|INSERT\s+INTO)\b/i.test(redacted)) {
    return 'Database schema execution error (details logged securely).';
  }
  return redacted.slice(0, 240) || 'Database schema execution error.';
}

export function buildMigration005Verification(
  runResult: Pick<MigrationResult, 'success'>,
  inspection: Migration005InspectionSnapshot
): Migration005VerificationPayload {
  const unrelatedSchemaUnchanged =
    Boolean(inspection.migrations001To004Recorded) &&
    Boolean(inspection.existingCrmTablesIntact) &&
    Boolean(inspection.migration003SchemaReady) &&
    Boolean(inspection.migration004SchemaReady);

  const schemaReady =
    Boolean(inspection.migration005Recorded) &&
    inspection.missingMigration005Tables.length === 0 &&
    inspection.missingMigration005Indexes.length === 0 &&
    Boolean(inspection.migration005SchemaReady);

  const verified = Boolean(runResult.success) && schemaReady && unrelatedSchemaUnchanged;

  return {
    tablesPresentCount: inspection.migration005PresentTablesCount,
    expectedTablesCount: inspection.migration005ExpectedTablesCount,
    indexesPresentCount: inspection.migration005PresentIndexesCount,
    expectedIndexesCount: inspection.migration005ExpectedIndexesCount,
    migrations001To004Recorded: inspection.migrations001To004Recorded,
    migration005Recorded: inspection.migration005Recorded,
    schemaReady,
    migration005SchemaReady: schemaReady,
    existingCrmTablesIntact: inspection.existingCrmTablesIntact,
    existingCrmTablesPresentCount: inspection.existingCrmTablesPresentCount,
    existingCrmTablesExpectedCount: inspection.existingCrmTablesExpectedCount,
    missingExistingCrmTables: inspection.missingExistingCrmTables,
    migration005Tables: inspection.migration005Tables,
    missingMigration005Tables: inspection.missingMigration005Tables,
    migration005PresentIndexes: inspection.migration005PresentIndexes,
    missingMigration005Indexes: inspection.missingMigration005Indexes,
    unrelatedSchemaUnchanged,
    verified,
  };
}

export interface Migration005WorkflowDeps {
  isDbConnected: () => boolean;
  runTargetMigration005: () => Promise<MigrationResult>;
  inspectMigrationStatus: () => Promise<Migration005InspectionSnapshot>;
  recordAuditEvent: (
    action: string,
    actorEmail: string,
    entityType: string,
    entityId: string,
    details: Record<string, unknown>,
    ipAddress?: string
  ) => Promise<unknown>;
}

export async function executeMigration005ApprovalWorkflow(
  input: {
    owner?: { role?: string; email?: string } | null;
    confirmMigration?: unknown;
    clientIp?: string;
  },
  deps: Migration005WorkflowDeps
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.owner || input.owner.role !== 'owner') {
    return {
      status: 403,
      body: {
        error: 'Owner authorization required to approve and execute Migration 005.',
        code: 'FORBIDDEN',
      },
    };
  }

  if (input.confirmMigration !== '005') {
    return {
      status: 400,
      body: {
        error: 'Explicit owner confirmation is required (confirmMigration must equal "005").',
        code: 'CONFIRMATION_REQUIRED',
      },
    };
  }

  if (!deps.isDbConnected()) {
    return {
      status: 503,
      body: {
        error: 'PostgreSQL database is not connected. Cannot apply Migration 005.',
        code: 'DATABASE_UNAVAILABLE',
      },
    };
  }

  const actorEmail = input.owner.email || 'Owner';

  try {
    const result = await deps.runTargetMigration005();
    const inspection = await deps.inspectMigrationStatus();
    const verification = buildMigration005Verification(result, inspection);
    const safeResultError = result.error ? sanitizeMigrationError(result.error) : undefined;

    try {
      await deps.recordAuditEvent(
        verification.verified ? 'MIGRATION_005_APPROVED_AND_APPLIED' : 'MIGRATION_005_APPROVAL_FAILED',
        actorEmail,
        'schema_migration',
        '005_import_and_relationships.sql',
        {
          applied: result.applied,
          alreadyApplied: result.alreadyApplied,
          verification,
          error: safeResultError,
        },
        input.clientIp
      );
    } catch {
      // Do not fail response or leak details on secondary audit failure
    }

    if (!result.success || !verification.verified) {
      return {
        status: 500,
        body: {
          success: false,
          migration: '005_import_and_relationships.sql',
          applied: result.applied,
          alreadyApplied: result.alreadyApplied,
          verification,
          inspection,
          error:
            safeResultError ||
            'Migration 005 executed but post-execution schema verification did not pass.',
        },
      };
    }

    return {
      status: 200,
      body: {
        success: true,
        migration: '005_import_and_relationships.sql',
        applied: result.applied,
        alreadyApplied: result.alreadyApplied,
        verification,
        inspection,
        message:
          result.applied.length > 0
            ? `Migration 005 approved, applied transactionally, and verified (${verification.tablesPresentCount}/${verification.expectedTablesCount} Phase 7 tables, ${verification.indexesPresentCount}/${verification.expectedIndexesCount} indexes, 001–004 intact).`
            : `Migration 005 was already applied and verified in Neon (${verification.tablesPresentCount}/${verification.expectedTablesCount} Phase 7 tables, ${verification.indexesPresentCount}/${verification.expectedIndexesCount} indexes, 001–004 intact).`,
      },
    };
  } catch (err: unknown) {
    const safeMsg = sanitizeMigrationError(err);
    try {
      await deps.recordAuditEvent(
        'MIGRATION_005_APPROVAL_FAILED',
        actorEmail,
        'schema_migration',
        '005_import_and_relationships.sql',
        { error: safeMsg, unexpectedException: true },
        input.clientIp
      );
    } catch {
      // Ignore secondary audit failure
    }
    return {
      status: 500,
      body: {
        success: false,
        code: 'MIGRATION_005_EXECUTION_FAILED',
        error: `Migration 005 execution failed and was rolled back: ${safeMsg}`,
      },
    };
  }
}

export async function handleLegacyRunMigrationsBlocked(
  input: {
    owner?: { role?: string; email?: string } | null;
    clientIp?: string;
  },
  deps: {
    isDbConnected: () => boolean;
    recordAuditEvent: Migration005WorkflowDeps['recordAuditEvent'];
  }
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!input.owner || input.owner.role !== 'owner') {
    return {
      status: 403,
      body: {
        error: 'Owner authorization required to run schema migrations.',
        code: 'FORBIDDEN',
      },
    };
  }

  if (deps.isDbConnected()) {
    try {
      await deps.recordAuditEvent(
        'LEGACY_MIGRATION_EXECUTION_BLOCKED',
        input.owner.email || 'Owner',
        'schema_migration',
        'run-migrations',
        {
          reason:
            'Unscoped bulk migration execution is disabled; explicit version-specific owner approval is required.',
        },
        input.clientIp
      );
    } catch {
      // Ignore secondary audit failure
    }
  }

  return {
    status: 403,
    body: {
      success: false,
      code: 'MIGRATION_APPROVAL_REQUIRED',
      error:
        'Unrestricted bulk migration execution is disabled. Pending migrations require explicit version-specific owner approval with confirmMigration.',
      allowedApprovalEndpoints: [
        '/api/database/migrations/004/approve',
        '/api/database/migrations/005/approve',
      ],
    },
  };
}
