-- LEED Database Schema - Migration 003
-- Phase 3: Global Country and Regional Intelligence & International Business Identifiers
-- Pure PostgreSQL, idempotent, safe for live production data.

-- ============================================================================
-- 1. EXTEND LEAD_IDENTIFIERS TABLE WITH JURISDICTION & PROVENANCE COLUMNS
-- ============================================================================

-- Add country_code (ISO 3166-1 alpha-2)
ALTER TABLE lead_identifiers ADD COLUMN IF NOT EXISTS country_code TEXT;

-- Add normalized_value (clean uppercase stripped value for high-performance deduplication and cross-matching)
ALTER TABLE lead_identifiers ADD COLUMN IF NOT EXISTS normalized_value TEXT;

-- Add issuing_authority (e.g. 'UK Companies House', 'Brønnøysundregistrene', 'Australian Taxation Office', 'IRS', 'GLEIF')
ALTER TABLE lead_identifiers ADD COLUMN IF NOT EXISTS issuing_authority TEXT;

-- Add source (e.g. 'Official Registry API', 'User Input', 'CSV Import', 'Website Inspector')
ALTER TABLE lead_identifiers ADD COLUMN IF NOT EXISTS source TEXT;

-- Add status ('user_provided', 'discovered', 'syntax_validated', 'officially_verified')
ALTER TABLE lead_identifiers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'user_provided';

-- Backfill existing identifiers with normalized values and appropriate initial statuses
UPDATE lead_identifiers
SET normalized_value = UPPER(REGEXP_REPLACE(value, '[^a-zA-Z0-9]', '', 'g'))
WHERE normalized_value IS NULL;

UPDATE lead_identifiers
SET status = CASE 
    WHEN verified = TRUE THEN 'officially_verified'
    ELSE 'user_provided'
END
WHERE status = 'user_provided' AND verified = TRUE;

-- Create performance indexes for international identifier searches
CREATE INDEX IF NOT EXISTS idx_lead_identifiers_normalized ON lead_identifiers(type, normalized_value);
CREATE INDEX IF NOT EXISTS idx_lead_identifiers_country ON lead_identifiers(country_code);
CREATE INDEX IF NOT EXISTS idx_lead_identifiers_status ON lead_identifiers(status);

-- ============================================================================
-- 2. ENHANCE LEADS TABLE PERFORMANCE INDEXES FOR REGIONAL INTELLIGENCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city);
CREATE INDEX IF NOT EXISTS idx_leads_region ON leads(region);
CREATE INDEX IF NOT EXISTS idx_leads_country ON leads(country);

-- ============================================================================
-- 3. REFERENCE GEOGRAPHIC AND SOURCE CAPABILITY AUDIT TRACKING
-- ============================================================================

-- Table to store country capability override metadata if the owner updates notes or credentials
CREATE TABLE IF NOT EXISTS country_source_capabilities (
    id TEXT PRIMARY KEY,
    country_code TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    integration_status TEXT NOT NULL,
    auth_requirement TEXT NOT NULL,
    source_url TEXT,
    notes TEXT,
    licensing_info TEXT,
    last_checked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_country_provider UNIQUE (country_code, provider_name)
);

CREATE INDEX IF NOT EXISTS idx_country_caps_code ON country_source_capabilities(country_code);
CREATE INDEX IF NOT EXISTS idx_country_caps_status ON country_source_capabilities(integration_status);
