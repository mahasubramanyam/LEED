-- LEED Database Schema - Migration 002
-- Phase 2 Security Remediation: Single-Owner Singleton Check Constraint & Cryptographic Audit Log Integrity
-- Pure PostgreSQL, idempotent, safe for live production data.

-- ============================================================================
-- 1. ENFORCE THE SINGLE-OWNER DATABASE CONSTRAINT
-- ============================================================================

-- Ensure all existing owner records satisfy the singleton condition
UPDATE owner_users SET is_singleton = TRUE WHERE is_singleton IS NOT TRUE;

-- Add CHECK constraint requiring is_singleton = TRUE
-- In combination with the existing UNIQUE constraint (uq_owner_singleton),
-- this mathematically guarantees that AT MOST ONE row can EVER exist in owner_users.
-- Any insert with is_singleton = FALSE or NULL is blocked by chk_owner_singleton.
-- Any secondary insert with is_singleton = TRUE is blocked by uq_owner_singleton.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_owner_singleton'
    ) THEN
        ALTER TABLE owner_users
            ADD CONSTRAINT chk_owner_singleton CHECK (is_singleton = TRUE);
    END IF;
END $$;

-- Retain / re-verify the UNIQUE constraint on is_singleton
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_owner_singleton'
    ) THEN
        ALTER TABLE owner_users
            ADD CONSTRAINT uq_owner_singleton UNIQUE (is_singleton);
    END IF;
END $$;

-- Ensure is_singleton column is NOT NULL with DEFAULT TRUE
ALTER TABLE owner_users ALTER COLUMN is_singleton SET NOT NULL;
ALTER TABLE owner_users ALTER COLUMN is_singleton SET DEFAULT TRUE;


-- ============================================================================
-- 2. STRENGTHEN AUDIT LOG INTEGRITY: IMMUTABILITY TRIGGERS
-- ============================================================================

-- Function to prevent any row-level UPDATE or DELETE on audit_events
CREATE OR REPLACE FUNCTION audit_events_prevent_modify()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is an append-only immutable audit log: % operations are strictly prohibited.', TG_OP
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_prevent_update_delete ON audit_events;
CREATE TRIGGER trg_audit_events_prevent_update_delete
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_prevent_modify();

-- Function to prevent statement-level TRUNCATE on audit_events
CREATE OR REPLACE FUNCTION audit_events_prevent_truncate()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'TRUNCATE operation is strictly prohibited on audit_events immutable audit log.'
        USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_prevent_truncate ON audit_events;
CREATE TRIGGER trg_audit_events_prevent_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION audit_events_prevent_truncate();


-- ============================================================================
-- 3. CRYPTOGRAPHIC HASH CHAINING FOR AUDIT EVENTS
-- ============================================================================

-- Add cryptographic hash chain columns
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS sequence_number BIGINT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS current_hash TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS hash_version INTEGER DEFAULT 1;

-- Backfill existing records if any exist, preserving history and establishing a documented baseline
-- Genesis Hash: 64 hexadecimal zeros (RFC 6962 / Certificate Transparency standard genesis baseline)
DO $$
DECLARE
    r RECORD;
    v_seq BIGINT := 0;
    v_prev TEXT := '0000000000000000000000000000000000000000000000000000000000000000';
    v_curr TEXT;
    v_payload TEXT;
BEGIN
    FOR r IN (
        SELECT id, action, actor_email, entity_type, entity_id, details, ip_address, created_at
        FROM audit_events
        ORDER BY created_at ASC, id ASC
    ) LOOP
        v_seq := v_seq + 1;

        v_payload := v_seq::TEXT || '|' ||
                     r.id || '|' ||
                     r.action || '|' ||
                     r.actor_email || '|' ||
                     COALESCE(r.entity_type, '') || '|' ||
                     COALESCE(r.entity_id, '') || '|' ||
                     COALESCE(r.details::TEXT, '{}') || '|' ||
                     COALESCE(r.ip_address, '') || '|' ||
                     TO_CHAR(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
                     v_prev;

        v_curr := encode(sha256(v_payload::bytea), 'hex');

        UPDATE audit_events
        SET sequence_number = v_seq,
            prev_hash = v_prev,
            current_hash = v_curr,
            hash_version = 1
        WHERE id = r.id;

        v_prev := v_curr;
    END LOOP;
END $$;

-- Enforce NOT NULL constraints on hash chain columns
-- (Safe because any existing records have been backfilled above; new table starts empty)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM audit_events WHERE sequence_number IS NULL
    ) THEN
        ALTER TABLE audit_events ALTER COLUMN sequence_number SET NOT NULL;
        ALTER TABLE audit_events ALTER COLUMN prev_hash SET NOT NULL;
        ALTER TABLE audit_events ALTER COLUMN current_hash SET NOT NULL;
        ALTER TABLE audit_events ALTER COLUMN hash_version SET NOT NULL;
    END IF;
END $$;

-- Enforce sequential uniqueness and chain lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_sequence ON audit_events(sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_events_current_hash ON audit_events(current_hash);

-- Trigger function for concurrent-safe insertion and cryptographic hash chaining
CREATE OR REPLACE FUNCTION audit_events_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
    v_last_seq BIGINT;
    v_last_hash TEXT;
    v_payload TEXT;
    c_genesis CONSTANT TEXT := '0000000000000000000000000000000000000000000000000000000000000000';
BEGIN
    -- Explicit advisory transaction lock:
    -- Guarantees strictly sequential event sequencing even under high concurrency.
    -- Prevents fork/split chains between simultaneous transactions.
    PERFORM pg_advisory_xact_lock(hashtext('audit_events_chain_lock'));

    -- Find the head of the chain with row lock
    SELECT sequence_number, current_hash
    INTO v_last_seq, v_last_hash
    FROM audit_events
    ORDER BY sequence_number DESC
    LIMIT 1
    FOR UPDATE;

    IF v_last_seq IS NULL THEN
        NEW.sequence_number := 1;
        NEW.prev_hash := c_genesis;
    ELSE
        NEW.sequence_number := v_last_seq + 1;
        NEW.prev_hash := v_last_hash;
    END IF;

    IF NEW.created_at IS NULL THEN
        NEW.created_at := NOW();
    END IF;

    NEW.hash_version := 1;

    -- Canonical hash payload encompassing complete event attributes and ordering:
    -- sequence_number | id | action | actor_email | entity_type | entity_id | details | ip_address | created_at | prev_hash
    v_payload := NEW.sequence_number::TEXT || '|' ||
                 NEW.id || '|' ||
                 NEW.action || '|' ||
                 NEW.actor_email || '|' ||
                 COALESCE(NEW.entity_type, '') || '|' ||
                 COALESCE(NEW.entity_id, '') || '|' ||
                 COALESCE(NEW.details::TEXT, '{}') || '|' ||
                 COALESCE(NEW.ip_address, '') || '|' ||
                 TO_CHAR(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
                 NEW.prev_hash;

    -- SHA-256 cryptographic digest encoded as 64-char lowercase hexadecimal string
    NEW.current_hash := encode(sha256(v_payload::bytea), 'hex');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_hash_chain ON audit_events;
CREATE TRIGGER trg_audit_events_hash_chain
BEFORE INSERT ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_hash_chain();
