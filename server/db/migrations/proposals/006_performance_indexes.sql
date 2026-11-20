-- ============================================================================
-- LEED Phase 17 — REVIEW-ONLY Performance Index Proposal (Migration 006)
-- ============================================================================
-- STATUS: PREPARED FOR OWNER REVIEW ONLY — NOT EXECUTED AGAINST PRODUCTION NEON
--
-- Purpose:
--   Eliminate sequential scans on foreign-key hydration lookups (lead_sources,
--   lead_notes, activities, tasks, lead_merge_history, campaign_messages) and
--   accelerate paginated / filtered / sorted CRM queries without duplicating
--   any existing indexes from Migrations 001–005.
--
-- Audit of existing indexes verified before authoring:
--   Already present in 001–005 (NOT duplicated here):
--     leads(domain), leads(registration_number), leads(phone_normalized),
--     leads(pipeline_stage_id), leads(status), leads(country_code),
--     leads(city), leads(region), leads(country),
--     lead_identifiers(type, normalized_value), lead_identifiers(country_code),
--     lead_identifiers(status), owner_sessions(token_hash),
--     owner_sessions(expires_at), tasks(due_date, completed),
--     campaign_messages(campaign_id, status), audit_events(created_at),
--     audit_events(sequence_number), audit_events(current_hash),
--     connector_runs(connector_id, executed_at DESC), connector_runs(status),
--     persons(email/linkedin_slug/phone_normalized/normalized_name),
--     company_person_relationships(lead_id/person_id/decision_maker_category).
-- ============================================================================

-- 1. Missing foreign-key indexes for batched lead hydration (eliminates full table scans on WHERE lead_id = ANY($1))
CREATE INDEX IF NOT EXISTS idx_lead_sources_lead_id
  ON lead_sources(lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_created
  ON lead_notes(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activities_lead_date
  ON activities(lead_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_lead_completed_due
  ON tasks(lead_id, completed, due_date);

CREATE INDEX IF NOT EXISTS idx_merge_history_survivor_merged
  ON lead_merge_history(survivor_lead_id, merged_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_messages_lead_id
  ON campaign_messages(lead_id);

-- 2. Stable pagination & composite filter/sort indexes for leads
CREATE INDEX IF NOT EXISTS idx_leads_created_at_id
  ON leads(created_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_leads_updated_at_id
  ON leads(updated_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_leads_stage_created_at
  ON leads(pipeline_stage_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_country_industry
  ON leads(country_code, industry);

-- 3. Auth session lookup & audit event filtering
CREATE INDEX IF NOT EXISTS idx_owner_sessions_owner_active
  ON owner_sessions(owner_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_action_created
  ON audit_events(action, created_at DESC);
