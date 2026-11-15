-- LEED Database Schema - Migration 005 Rollback
-- Reverts Phase 7 additive tables safely without affecting Phases 1-6 tables.

DROP INDEX IF EXISTS idx_import_batch_rows_outcome;
DROP INDEX IF EXISTS idx_import_batch_rows_batch_row;
DROP TABLE IF EXISTS import_batch_rows;

DROP INDEX IF EXISTS idx_import_batches_status;
DROP INDEX IF EXISTS idx_import_batches_created_at;
DROP TABLE IF EXISTS import_batches;

DROP INDEX IF EXISTS idx_import_templates_name;
DROP TABLE IF EXISTS import_mapping_templates;

DROP INDEX IF EXISTS idx_cpr_decision_category;
DROP INDEX IF EXISTS idx_cpr_person_id;
DROP INDEX IF EXISTS idx_cpr_lead_id;
DROP TABLE IF EXISTS company_person_relationships;

DROP INDEX IF EXISTS idx_persons_normalized_name;
DROP INDEX IF EXISTS idx_persons_phone_normalized;
DROP INDEX IF EXISTS idx_persons_linkedin_slug;
DROP INDEX IF EXISTS idx_persons_email;
DROP TABLE IF EXISTS persons;
