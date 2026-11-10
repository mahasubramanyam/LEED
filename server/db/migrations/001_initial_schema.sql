-- LEED Database Schema - Migration 001
-- Approved 12-Table Architecture + Security & Audit
-- Pure PostgreSQL relational schema with foreign key constraints and indexes

-- 1. Owner Users (Single-Owner Authentication)
CREATE TABLE IF NOT EXISTS owner_users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Owner Sessions (Secure Revocable Sessions)
CREATE TABLE IF NOT EXISTS owner_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,
    owner_id TEXT NOT NULL REFERENCES owner_users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Pipeline Stages
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    display_order INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Canonical Leads
CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    legal_name TEXT,
    registration_number TEXT,
    registration_type TEXT,
    company_status TEXT NOT NULL DEFAULT 'active',
    website TEXT,
    domain TEXT,
    email TEXT,
    email_status TEXT NOT NULL DEFAULT 'unavailable',
    phone TEXT,
    phone_normalized TEXT,
    street TEXT,
    city TEXT,
    region TEXT,
    postal_code TEXT,
    country TEXT NOT NULL DEFAULT 'International',
    country_code TEXT NOT NULL DEFAULT 'US',
    formatted_address TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    industry TEXT NOT NULL DEFAULT 'Commercial Services',
    category TEXT NOT NULL DEFAULT 'General',
    employee_range TEXT,
    founded_year INTEGER,
    confidence_score INTEGER NOT NULL DEFAULT 50,
    confidence_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'new',
    pipeline_stage_id TEXT REFERENCES pipeline_stages(id) ON DELETE SET NULL,
    opportunity_value NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    win_probability INTEGER NOT NULL DEFAULT 0,
    lost_reason TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    web_metadata JSONB,
    social_links JSONB,
    custom_fields JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Lead Sources (Immutable Observation Provenance)
CREATE TABLE IF NOT EXISTS lead_sources (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL,
    provider_id TEXT,
    url TEXT,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    license TEXT,
    attribution TEXT
);

-- 6. Lead Identifiers (Normalized Identification Proofs)
CREATE TABLE IF NOT EXISTS lead_identifiers (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lead_identifier UNIQUE (lead_id, type, value)
);

-- 7. Lead Notes
CREATE TABLE IF NOT EXISTS lead_notes (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Activities (Sales & Enrichment Touchpoints)
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT,
    outcome TEXT,
    actor TEXT NOT NULL,
    date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Tasks & Follow-Up Reminders
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_to TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Lead Merge History (Full Snapshot for 100% Reversible Undo)
CREATE TABLE IF NOT EXISTS lead_merge_history (
    id TEXT PRIMARY KEY,
    survivor_lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    merged_lead_snapshot JSONB NOT NULL,
    merged_reason TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'Owner',
    merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Outreach Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'email',
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    target_industry TEXT,
    target_country TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Campaign Messages (Human-in-the-Loop Approval Queue)
CREATE TABLE IF NOT EXISTS campaign_messages (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    lead_company_name TEXT NOT NULL,
    recipient_email TEXT,
    subject TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_approval',
    delivery_id TEXT,
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auxiliary Operational Tables
-- Connector Credentials
CREATE TABLE IF NOT EXISTS connector_credentials (
    id TEXT PRIMARY KEY,
    connector_id TEXT UNIQUE NOT NULL,
    auth_type TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Connector Observability Runs
CREATE TABLE IF NOT EXISTS connector_runs (
    id TEXT PRIMARY KEY,
    connector_id TEXT NOT NULL,
    query_params JSONB,
    total_found INTEGER NOT NULL DEFAULT 0,
    total_saved INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    status TEXT NOT NULL,
    error_message TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit Events
CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Application Settings
CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY DEFAULT 'primary_settings',
    owner_name TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    default_country TEXT NOT NULL DEFAULT 'GB',
    default_currency TEXT NOT NULL DEFAULT 'USD',
    user_agent TEXT NOT NULL,
    enable_safe_website_crawl BOOLEAN NOT NULL DEFAULT TRUE,
    outreach_approval_required BOOLEAN NOT NULL DEFAULT TRUE,
    auto_dedupe_threshold NUMERIC(3,2) NOT NULL DEFAULT 0.85,
    suppression_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Relational Performance Indexes
CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(domain);
CREATE INDEX IF NOT EXISTS idx_leads_registration ON leads(registration_number);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline_stage ON leads(pipeline_stage_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_country_code ON leads(country_code);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON owner_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON owner_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_tasks_due_completed ON tasks(due_date, completed);
CREATE INDEX IF NOT EXISTS idx_campaign_msgs_status ON campaign_messages(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_events(created_at);
