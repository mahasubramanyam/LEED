-- LEED Database Schema - Migration 003 Rollback
-- Reverts Phase 3 global intelligence additions cleanly

DROP TABLE IF EXISTS country_source_capabilities CASCADE;

DROP INDEX IF EXISTS idx_leads_city;
DROP INDEX IF EXISTS idx_leads_region;
DROP INDEX IF EXISTS idx_leads_country;

DROP INDEX IF EXISTS idx_lead_identifiers_normalized;
DROP INDEX IF EXISTS idx_lead_identifiers_country;
DROP INDEX IF EXISTS idx_lead_identifiers_status;

ALTER TABLE lead_identifiers DROP COLUMN IF EXISTS status;
ALTER TABLE lead_identifiers DROP COLUMN IF EXISTS source;
ALTER TABLE lead_identifiers DROP COLUMN IF EXISTS issuing_authority;
ALTER TABLE lead_identifiers DROP COLUMN IF EXISTS normalized_value;
ALTER TABLE lead_identifiers DROP COLUMN IF EXISTS country_code;
