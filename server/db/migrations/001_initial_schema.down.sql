-- LEED Database Schema - Migration 001 Rollback (DDL Down)
-- Genuine rollback script reversing all 12 tables and auxiliary tables in reverse dependency order

DROP TABLE IF EXISTS audit_events CASCADE;
DROP TABLE IF EXISTS connector_runs CASCADE;
DROP TABLE IF EXISTS connector_credentials CASCADE;
DROP TABLE IF EXISTS app_settings CASCADE;
DROP TABLE IF EXISTS campaign_messages CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS lead_merge_history CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS activities CASCADE;
DROP TABLE IF EXISTS lead_notes CASCADE;
DROP TABLE IF EXISTS lead_identifiers CASCADE;
DROP TABLE IF EXISTS lead_sources CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS pipeline_stages CASCADE;
DROP TABLE IF EXISTS owner_sessions CASCADE;
DROP TABLE IF EXISTS owner_users CASCADE;
