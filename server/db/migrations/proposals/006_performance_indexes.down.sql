-- ============================================================================
-- LEED Phase 17 — Rollback Script for Review-Only Performance Index Proposal 006
-- ============================================================================
-- STATUS: PREPARED FOR OWNER REVIEW ONLY — NOT EXECUTED AGAINST PRODUCTION NEON

DROP INDEX IF EXISTS idx_audit_events_action_created;
DROP INDEX IF EXISTS idx_owner_sessions_owner_active;
DROP INDEX IF EXISTS idx_leads_country_industry;
DROP INDEX IF EXISTS idx_leads_stage_created_at;
DROP INDEX IF EXISTS idx_leads_updated_at_id;
DROP INDEX IF EXISTS idx_leads_created_at_id;
DROP INDEX IF EXISTS idx_campaign_messages_lead_id;
DROP INDEX IF EXISTS idx_merge_history_survivor_merged;
DROP INDEX IF EXISTS idx_tasks_lead_completed_due;
DROP INDEX IF EXISTS idx_activities_lead_date;
DROP INDEX IF EXISTS idx_lead_notes_lead_created;
DROP INDEX IF EXISTS idx_lead_sources_lead_id;
