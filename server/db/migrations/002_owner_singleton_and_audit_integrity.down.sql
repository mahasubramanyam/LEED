-- LEED Database Schema - Migration 002 Rollback Script
-- Phase 2 Security Remediation: Rollback script for single-owner check constraint and audit log integrity

-- 1. Drop audit_events cryptographic hash chaining trigger and function
DROP TRIGGER IF EXISTS trg_audit_events_hash_chain ON audit_events;
DROP FUNCTION IF EXISTS audit_events_hash_chain();

-- 2. Drop audit_events immutability triggers and functions
DROP TRIGGER IF EXISTS trg_audit_events_prevent_truncate ON audit_events;
DROP FUNCTION IF EXISTS audit_events_prevent_truncate();

DROP TRIGGER IF EXISTS trg_audit_events_prevent_update_delete ON audit_events;
DROP FUNCTION IF EXISTS audit_events_prevent_modify();

-- 3. Drop indexes and hash chain columns from audit_events
DROP INDEX IF EXISTS idx_audit_events_current_hash;
DROP INDEX IF EXISTS idx_audit_events_sequence;

ALTER TABLE audit_events DROP COLUMN IF EXISTS hash_version;
ALTER TABLE audit_events DROP COLUMN IF EXISTS current_hash;
ALTER TABLE audit_events DROP COLUMN IF EXISTS prev_hash;
ALTER TABLE audit_events DROP COLUMN IF EXISTS sequence_number;

-- 4. Drop check constraint from owner_users
ALTER TABLE owner_users DROP CONSTRAINT IF EXISTS chk_owner_singleton;
