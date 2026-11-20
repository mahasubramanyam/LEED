// Phase 17: Isolated Backup & Restore Verification Service
// - Never mutates live data/pipeline_store.json, data/owner_auth.json, or production Neon PostgreSQL.
// - Performs deterministic JSON store snapshot + SHA-256 integrity checksum + isolated temp restore drill.
// - Explicitly distinguishes verified isolated JSON drills from production Neon PostgreSQL pg_dump drills.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface JsonBackupManifest {
  backupId: string;
  createdAt: string;
  sourcePath: string;
  snapshotPath: string;
  byteSize: number;
  sha256: string;
  recordCounts: {
    leads: number;
    stages: number;
    tasks: number;
    campaigns: number;
    persons: number;
    relationships: number;
    mergeHistory: number;
  };
}

export interface IsolatedRestoreDrillResult {
  verified: boolean;
  drillType: 'isolated_json_store_roundtrip';
  executedAt: string;
  durationMs: number;
  sourceByteSize: number;
  sha256: string;
  checksumVerified: boolean;
  tamperDetectionVerified: boolean;
  recordCountsMatched: boolean;
  recordCounts: JsonBackupManifest['recordCounts'];
  productionNeonUntouched: true;
  liveDataDirectoryUntouched: true;
  error?: string;
}

export interface BackupReadinessSummary {
  provenance: 'measured' | 'unavailable';
  isolatedJsonDrill: {
    verified: boolean;
    lastVerifiedAt: string | null;
    lastChecksum: string | null;
    lastRecordCounts: JsonBackupManifest['recordCounts'] | null;
    tamperDetectionVerified: boolean;
  };
  productionPostgresBackupRestore: {
    status: 'not_verified_in_runtime';
    reason: string;
    recommendedProcedure: string[];
  };
}

let lastIsolatedDrillResult: IsolatedRestoreDrillResult | null = null;

function computeSha256(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function extractRecordCounts(parsed: Record<string, unknown>): JsonBackupManifest['recordCounts'] {
  const len = (k: string) => (Array.isArray(parsed[k]) ? (parsed[k] as unknown[]).length : 0);
  return {
    leads: len('leads'),
    stages: len('stages'),
    tasks: len('tasks'),
    campaigns: len('campaigns'),
    persons: len('persons'),
    relationships: len('companyPersonRelationships'),
    mergeHistory: len('mergeHistory'),
  };
}

/**
 * Creates a verified JSON snapshot + manifest in the specified target directory (typically an isolated temp or backup dir).
 */
export function createVerifiedJsonBackup(
  sourceFilePath: string,
  outputDir: string
): JsonBackupManifest {
  if (!fs.existsSync(sourceFilePath)) {
    throw new Error('Source JSON store file does not exist.');
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const rawBuffer = fs.readFileSync(sourceFilePath);
  const parsed = JSON.parse(rawBuffer.toString('utf-8')) as Record<string, unknown>;
  const sha256 = computeSha256(rawBuffer);
  const backupId = `bkp-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const snapshotPath = path.join(outputDir, `${backupId}.json`);
  const manifestPath = path.join(outputDir, `${backupId}.manifest.json`);

  // Atomic write to temp then rename
  const tmpSnap = `${snapshotPath}.tmp`;
  fs.writeFileSync(tmpSnap, rawBuffer);
  fs.renameSync(tmpSnap, snapshotPath);

  const manifest: JsonBackupManifest = {
    backupId,
    createdAt: new Date().toISOString(),
    sourcePath: path.basename(sourceFilePath),
    snapshotPath,
    byteSize: rawBuffer.byteLength,
    sha256,
    recordCounts: extractRecordCounts(parsed),
  };

  const tmpManifest = `${manifestPath}.tmp`;
  fs.writeFileSync(tmpManifest, JSON.stringify(manifest, null, 2), 'utf-8');
  fs.renameSync(tmpManifest, manifestPath);

  return manifest;
}

/**
 * Restores a verified JSON snapshot to a target destination ONLY after validating its SHA-256 checksum
 * and JSON structural integrity. Never overwrites a destination if verification fails.
 */
export function restoreVerifiedJsonBackup(
  snapshotPath: string,
  expectedSha256: string,
  targetRestorePath: string
): { restored: boolean; recordCounts: JsonBackupManifest['recordCounts']; sha256: string } {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error('Backup snapshot file not found.');
  }
  const rawBuffer = fs.readFileSync(snapshotPath);
  const actualSha256 = computeSha256(rawBuffer);
  if (actualSha256 !== expectedSha256) {
    throw new Error('Backup integrity check failed: SHA-256 checksum mismatch.');
  }
  const parsed = JSON.parse(rawBuffer.toString('utf-8')) as Record<string, unknown>;
  if (!Array.isArray(parsed.leads) || !Array.isArray(parsed.stages)) {
    throw new Error('Backup integrity check failed: missing required canonical leads/stages arrays.');
  }

  fs.mkdirSync(path.dirname(targetRestorePath), { recursive: true });
  const tmpTarget = `${targetRestorePath}.restore.tmp`;
  fs.writeFileSync(tmpTarget, rawBuffer);
  fs.renameSync(tmpTarget, targetRestorePath);

  return {
    restored: true,
    recordCounts: extractRecordCounts(parsed),
    sha256: actualSha256,
  };
}

/**
 * Executes a completely isolated backup & restoration verification drill in os.tmpdir().
 * Never modifies live data files or production Neon PostgreSQL.
 */
export function runIsolatedJsonBackupRestoreDrill(sourceFilePath: string): IsolatedRestoreDrillResult {
  const startedMs = Date.now();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-backup-drill-'));

  try {
    const backupDir = path.join(tempRoot, 'backups');
    const restoreFile = path.join(tempRoot, 'restored', 'pipeline_store.restored.json');

    // 1. Create snapshot + manifest in temp dir
    const manifest = createVerifiedJsonBackup(sourceFilePath, backupDir);

    // 2. Restore snapshot into isolated temp path with checksum verification
    const restored = restoreVerifiedJsonBackup(manifest.snapshotPath, manifest.sha256, restoreFile);
    const restoredBuf = fs.readFileSync(restoreFile);
    const restoredSha = computeSha256(restoredBuf);
    const checksumVerified = restoredSha === manifest.sha256;

    const recordCountsMatched =
      JSON.stringify(restored.recordCounts) === JSON.stringify(manifest.recordCounts);

    // 3. Negative tamper detection test: corrupt a copy and confirm restore rejects it
    const tamperedPath = path.join(backupDir, 'tampered.json');
    fs.writeFileSync(tamperedPath, Buffer.concat([restoredBuf, Buffer.from(' ')]));
    let tamperDetectionVerified = false;
    try {
      restoreVerifiedJsonBackup(tamperedPath, manifest.sha256, path.join(tempRoot, 'should_not_exist.json'));
    } catch (tamperErr) {
      if (tamperErr instanceof Error && tamperErr.message.includes('checksum mismatch')) {
        tamperDetectionVerified = true;
      }
    }

    const result: IsolatedRestoreDrillResult = {
      verified: checksumVerified && recordCountsMatched && tamperDetectionVerified,
      drillType: 'isolated_json_store_roundtrip',
      executedAt: new Date().toISOString(),
      durationMs: Math.max(1, Date.now() - startedMs),
      sourceByteSize: manifest.byteSize,
      sha256: manifest.sha256,
      checksumVerified,
      tamperDetectionVerified,
      recordCountsMatched,
      recordCounts: manifest.recordCounts,
      productionNeonUntouched: true,
      liveDataDirectoryUntouched: true,
    };

    lastIsolatedDrillResult = result;
    return result;
  } catch (err: unknown) {
    const failed: IsolatedRestoreDrillResult = {
      verified: false,
      drillType: 'isolated_json_store_roundtrip',
      executedAt: new Date().toISOString(),
      durationMs: Math.max(1, Date.now() - startedMs),
      sourceByteSize: 0,
      sha256: '',
      checksumVerified: false,
      tamperDetectionVerified: false,
      recordCountsMatched: false,
      recordCounts: { leads: 0, stages: 0, tasks: 0, campaigns: 0, persons: 0, relationships: 0, mergeHistory: 0 },
      productionNeonUntouched: true,
      liveDataDirectoryUntouched: true,
      error: err instanceof Error ? err.message : 'Isolated backup drill failed.',
    };
    lastIsolatedDrillResult = failed;
    return failed;
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup
    }
  }
}

export function getBackupRestoreReadinessStatus(): BackupReadinessSummary {
  return {
    provenance: lastIsolatedDrillResult ? 'measured' : 'unavailable',
    isolatedJsonDrill: {
      verified: Boolean(lastIsolatedDrillResult?.verified),
      lastVerifiedAt: lastIsolatedDrillResult?.executedAt ?? null,
      lastChecksum: lastIsolatedDrillResult?.sha256 ?? null,
      lastRecordCounts: lastIsolatedDrillResult?.recordCounts ?? null,
      tamperDetectionVerified: Boolean(lastIsolatedDrillResult?.tamperDetectionVerified),
    },
    productionPostgresBackupRestore: {
      status: 'not_verified_in_runtime',
      reason:
        'Production Neon PostgreSQL restore drills are intentionally never executed automatically from the application runtime to protect production data.',
      recommendedProcedure: [
        '1. Create an isolated Neon branch or temporary PostgreSQL database.',
        '2. Run `pg_dump --format=custom --no-owner "$DATABASE_URL" -f leed_backup.dump` and record its SHA-256 hash.',
        '3. Run `pg_restore --clean --if-exists --dbname="$ISOLATED_DATABASE_URL" leed_backup.dump`.',
        '4. Verify table row counts (`leads`, `persons`, `audit_events`, `schema_migrations`) and run SHA-256 audit hash-chain verification against the isolated database.',
      ],
    },
  };
}
