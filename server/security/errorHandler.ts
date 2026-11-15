import { redactSecrets } from '../connectors/core/errors.js';

const PG_DETAIL_PATTERNS = [
  /relation "[^"]+" does not exist/i,
  /column "[^"]+" (?:of relation "[^"]+" )?does not exist/i,
  /duplicate key value violates unique constraint/i,
  /violates foreign key constraint/i,
  /violates check constraint/i,
  /violates not-null constraint/i,
  /syntax error at or near/i,
  /invalid input syntax for type/i,
  /permission denied for (?:table|relation|schema)/i,
  /DETAIL:\s+/i,
  /STATEMENT:\s+/i,
  /pg_catalog\./i,
  /SELECT\s+.*?\s+FROM\s+/i,
  /INSERT\s+INTO\s+/i,
  /UPDATE\s+\S+\s+SET\s+/i,
  /DELETE\s+FROM\s+/i,
];

const INTERNAL_PATH_PATTERN = /(?:\/app\/applet\/|\/Users\/|\/home\/|[A-Za-z]:\\)[^\s:)]+(?::\d+(?::\d+)?)?/g;

const SAFE_EXPLICIT_PREFIXES = [
  'Database connection unavailable',
  'Invalid pipelineStageId',
  'Migration 004',
  'Migration 005',
  'Owner setup',
  'Invalid credentials',
  'Too many failed',
  'An owner account',
];

export function sanitizeApiError(
  err: unknown,
  fallback = 'Internal server error.',
  extraSecrets: string[] = []
): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const redacted = redactSecrets(raw, extraSecrets).trim();
  if (!redacted) return fallback;

  if (SAFE_EXPLICIT_PREFIXES.some((prefix) => redacted.startsWith(prefix))) {
    return redacted.replace(INTERNAL_PATH_PATTERN, '[internal-path]');
  }

  for (const pattern of PG_DETAIL_PATTERNS) {
    if (pattern.test(redacted)) {
      return fallback;
    }
  }

  // Strip multiline stack traces or filesystem paths
  const firstLine = redacted.split('\n')[0].trim();
  const withoutPaths = firstLine.replace(INTERNAL_PATH_PATTERN, '[internal-path]');

  if (
    withoutPaths.includes('ECONNREFUSED') ||
    withoutPaths.includes('ENOTFOUND') ||
    withoutPaths.includes('ETIMEDOUT')
  ) {
    // Allow brief safe connectivity hint without internal URIs
    return withoutPaths.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[redacted-host]');
  }

  return withoutPaths.length > 320 ? `${withoutPaths.slice(0, 317)}...` : withoutPaths;
}

export function sanitizeExportFilenamePart(raw: string, fallback = 'export'): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}
