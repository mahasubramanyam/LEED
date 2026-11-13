-- LEED Database Schema - Migration 004
-- Phase 4: Unified Connector Architecture (Credential Metadata, Execution History & Configs)
-- Pure PostgreSQL, strictly additive, idempotent, safe for live production data.

-- ============================================================================
-- 1. EXTEND CONNECTOR_CREDENTIALS WITH ROTATION & VALIDATION METADATA
-- ============================================================================

ALTER TABLE connector_credentials ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE connector_credentials ADD COLUMN IF NOT EXISTS masked_hint TEXT;
ALTER TABLE connector_credentials ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
ALTER TABLE connector_credentials ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;
ALTER TABLE connector_credentials ADD COLUMN IF NOT EXISTS validation_status TEXT;

-- ============================================================================
-- 2. EXTEND CONNECTOR_RUNS WITH STRUCTURED EXECUTION & DIAGNOSTIC TELEMETRY
-- ============================================================================

ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'search';
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS records_discovered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS records_normalized INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS records_rejected INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS error_category TEXT;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS diagnostic_summary TEXT;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS rate_limit_remaining INTEGER;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS rate_limit_reset_at TIMESTAMPTZ;
ALTER TABLE connector_runs ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE INDEX IF NOT EXISTS idx_connector_runs_conn_executed ON connector_runs(connector_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_runs_status ON connector_runs(status);

-- ============================================================================
-- 3. EXTEND APP_SETTINGS WITH PER-CONNECTOR CONFIGURATION & ENABLED STATE
-- ============================================================================

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS connector_configs JSONB NOT NULL DEFAULT '{}'::jsonb;
