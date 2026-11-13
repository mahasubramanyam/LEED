-- LEED Database Schema - Migration 004 Rollback
-- Reverts Phase 4 additive connector architecture columns safely

DROP INDEX IF EXISTS idx_connector_runs_conn_executed;
DROP INDEX IF EXISTS idx_connector_runs_status;

ALTER TABLE app_settings DROP COLUMN IF EXISTS connector_configs;

ALTER TABLE connector_runs DROP COLUMN IF EXISTS request_id;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS rate_limit_reset_at;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS rate_limit_remaining;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS diagnostic_summary;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS error_category;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS records_rejected;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS records_normalized;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS records_discovered;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS duration_ms;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS completed_at;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS started_at;
ALTER TABLE connector_runs DROP COLUMN IF EXISTS operation;

ALTER TABLE connector_credentials DROP COLUMN IF EXISTS validation_status;
ALTER TABLE connector_credentials DROP COLUMN IF EXISTS validated_at;
ALTER TABLE connector_credentials DROP COLUMN IF EXISTS rotated_at;
ALTER TABLE connector_credentials DROP COLUMN IF EXISTS masked_hint;
ALTER TABLE connector_credentials DROP COLUMN IF EXISTS key_version;
