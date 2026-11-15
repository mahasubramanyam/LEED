-- LEED Database Schema - Migration 005
-- Phase 7: Lead Import Engine, Decision-Makers (Persons) & M:N Company-Person Relationships
-- Strictly additive, idempotent, safe for live production CRM data.

-- ============================================================================
-- 1. PERSONS (Business Contacts / Decision-Makers / Owners / Directors)
-- ============================================================================
CREATE TABLE IF NOT EXISTS persons (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    normalized_name TEXT NOT NULL,
    email TEXT,
    email_status TEXT NOT NULL DEFAULT 'unavailable',
    phone TEXT,
    phone_normalized TEXT,
    linkedin_url TEXT,
    linkedin_slug TEXT,
    country TEXT,
    country_code TEXT,
    city TEXT,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence_score INTEGER NOT NULL DEFAULT 50,
    verification_status TEXT NOT NULL DEFAULT 'user_provided',
    custom_fields JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_persons_email ON persons (LOWER(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS idx_persons_linkedin_slug ON persons (LOWER(linkedin_slug)) WHERE linkedin_slug IS NOT NULL AND linkedin_slug <> '';
CREATE INDEX IF NOT EXISTS idx_persons_phone_normalized ON persons (phone_normalized) WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';
CREATE INDEX IF NOT EXISTS idx_persons_normalized_name ON persons (normalized_name);

-- ============================================================================
-- 2. COMPANY-PERSON RELATIONSHIPS (Many-to-Many Association Entity)
-- ============================================================================
CREATE TABLE IF NOT EXISTS company_person_relationships (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL DEFAULT 'contact',
    job_title TEXT,
    designation TEXT,
    department TEXT,
    decision_maker_category TEXT,
    is_primary_contact BOOLEAN NOT NULL DEFAULT FALSE,
    source_name TEXT NOT NULL DEFAULT 'Owner Import',
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence_score INTEGER NOT NULL DEFAULT 50,
    verification_status TEXT NOT NULL DEFAULT 'user_provided',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_company_person_rel UNIQUE (lead_id, person_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_cpr_lead_id ON company_person_relationships (lead_id);
CREATE INDEX IF NOT EXISTS idx_cpr_person_id ON company_person_relationships (person_id);
CREATE INDEX IF NOT EXISTS idx_cpr_decision_category ON company_person_relationships (decision_maker_category);

-- ============================================================================
-- 3. IMPORT MAPPING TEMPLATES (Owner Reusable Column & Normalization Presets)
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_mapping_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    source_format TEXT NOT NULL DEFAULT 'csv',
    header_signature JSONB NOT NULL DEFAULT '[]'::jsonb,
    column_mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
    merge_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    normalization_options JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL DEFAULT 'Owner',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_templates_name ON import_mapping_templates (LOWER(name));

-- ============================================================================
-- 4. IMPORT BATCHES (Audit-Grade Import Run Ledger)
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    file_format TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL DEFAULT 0,
    file_sha256 TEXT,
    worksheet_name TEXT,
    encoding_detected TEXT,
    template_id TEXT REFERENCES import_mapping_templates(id) ON DELETE SET NULL,
    template_name TEXT,
    duplicate_policy TEXT NOT NULL DEFAULT 'merge_safe',
    status TEXT NOT NULL DEFAULT 'completed',
    total_rows INTEGER NOT NULL DEFAULT 0,
    valid_rows INTEGER NOT NULL DEFAULT 0,
    invalid_rows INTEGER NOT NULL DEFAULT 0,
    created_companies INTEGER NOT NULL DEFAULT 0,
    updated_companies INTEGER NOT NULL DEFAULT 0,
    created_persons INTEGER NOT NULL DEFAULT 0,
    updated_persons INTEGER NOT NULL DEFAULT 0,
    created_relationships INTEGER NOT NULL DEFAULT 0,
    updated_relationships INTEGER NOT NULL DEFAULT 0,
    skipped_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_rows INTEGER NOT NULL DEFAULT 0,
    conflict_rows INTEGER NOT NULL DEFAULT 0,
    failed_rows INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    actor_email TEXT NOT NULL DEFAULT 'Owner',
    summary_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_import_batches_created_at ON import_batches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches (status);

-- ============================================================================
-- 5. IMPORT BATCH ROWS (Row-Level Provenance, Validation & Outcome Tracking)
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_batch_rows (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    dedupe_classification TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    outcome TEXT NOT NULL,
    company_name TEXT,
    person_name TEXT,
    matched_lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    persisted_lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    persisted_person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
    persisted_relationship_id TEXT REFERENCES company_person_relationships(id) ON DELETE SET NULL,
    raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    errors JSONB NOT NULL DEFAULT '[]'::jsonb,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_batch_rows_batch_row ON import_batch_rows (batch_id, row_number);
CREATE INDEX IF NOT EXISTS idx_import_batch_rows_outcome ON import_batch_rows (batch_id, outcome);
