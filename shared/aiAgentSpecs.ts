// Phase 14: Canonical AI Sales Agent Specifications & Constants
// Shared across backend services, API validation, and frontend workspace.

export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

export const ALLOWED_GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-4-neon',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
] as const;

export const AI_CLAIM_CLASSIFICATIONS = [
  {
    value: 'verified_fact',
    label: 'Verified Fact',
    description: 'Confirmed via official registry, verified contact check, or direct CRM record.',
  },
  {
    value: 'source_reported',
    label: 'Source-Reported',
    description: 'Observed on a company website, directory, or external source; not independently verified.',
  },
  {
    value: 'ai_analysis',
    label: 'AI Analysis',
    description: 'Synthesis or strategic reasoning derived from available CRM and source evidence.',
  },
  {
    value: 'hypothesis',
    label: 'Hypothesis',
    description: 'Unconfirmed assumption or suggested angle to test in conversation.',
  },
  {
    value: 'unknown',
    label: 'Unknown / Missing',
    description: 'Information is absent from LEED records and not fabricated.',
  },
] as const;

export type AiClaimClassification = (typeof AI_CLAIM_CLASSIFICATIONS)[number]['value'];

export const AI_DRAFT_TYPES = [
  { value: 'intro_email', label: 'Introductory Email', channel: 'email' },
  { value: 'cold_outreach', label: 'Cold Outreach', channel: 'email' },
  { value: 'warm_intro', label: 'Warm Introduction', channel: 'email' },
  { value: 'follow_up', label: 'Follow-Up Email', channel: 'email' },
  { value: 'meeting_request', label: 'Meeting Request', channel: 'email' },
  { value: 'meeting_follow_up', label: 'Meeting Follow-Up', channel: 'email' },
  { value: 'partnership_proposal', label: 'Partnership Proposal', channel: 'email' },
  { value: 'business_inquiry', label: 'Business Inquiry', channel: 'email' },
  { value: 'negotiation_follow_up', label: 'Negotiation Follow-Up', channel: 'email' },
  { value: 'linkedin_message', label: 'LinkedIn Message Draft', channel: 'linkedin' },
  { value: 're_engagement', label: 'Re-Engagement Note', channel: 'email' },
  { value: 'custom', label: 'Custom Message Draft', channel: 'custom' },
] as const;

export type AiDraftType = (typeof AI_DRAFT_TYPES)[number]['value'];
export const AI_DRAFT_TYPE_SET = new Set<string>(AI_DRAFT_TYPES.map((d) => d.value));

export const AI_DRAFT_TONES = [
  { value: 'consultative', label: 'Consultative' },
  { value: 'executive', label: 'Executive & Concise' },
  { value: 'warm_professional', label: 'Warm Professional' },
  { value: 'direct', label: 'Direct & Action-Oriented' },
  { value: 'formal', label: 'Formal Business' },
] as const;

export type AiDraftTone = (typeof AI_DRAFT_TONES)[number]['value'];

export const AI_ACTION_PROPOSAL_TYPES = [
  {
    value: 'create_task',
    label: 'Create Follow-Up Task',
    mutatesCrm: true,
    description: 'Creates a task in LEED Tasks after explicit owner approval.',
  },
  {
    value: 'schedule_review',
    label: 'Schedule Relationship Review',
    mutatesCrm: true,
    description: 'Sets a scheduled review or follow-up date on a company or person.',
  },
  {
    value: 'update_relationship_status',
    label: 'Update Relationship Status',
    mutatesCrm: true,
    description: 'Updates relationship status and optional owner annotation on approval.',
  },
  {
    value: 'create_opportunity',
    label: 'Create Opportunity',
    mutatesCrm: true,
    description: 'Adds a new tracked opportunity under the company record.',
  },
  {
    value: 'update_opportunity',
    label: 'Update Opportunity',
    mutatesCrm: true,
    description: 'Updates stage, next action, or notes on an existing opportunity.',
  },
  {
    value: 'record_interaction',
    label: 'Log Manual Interaction',
    mutatesCrm: true,
    description: 'Records an interaction entry on the company or person timeline.',
  },
  {
    value: 'prepare_draft',
    label: 'Save Communication Draft',
    mutatesCrm: false,
    description: 'Saves a draft_only message for owner review (never auto-sent).',
  },
  {
    value: 'research_company',
    label: 'Queue Company Research Task',
    mutatesCrm: true,
    description: 'Creates a targeted research task to resolve missing facts.',
  },
  {
    value: 'enrich_company',
    label: 'Queue Enrichment Review Task',
    mutatesCrm: true,
    description: 'Creates an owner task to run Phase 12 enrichment on the record.',
  },
  {
    value: 'verify_contact',
    label: 'Queue Contact Verification Task',
    mutatesCrm: true,
    description: 'Creates an owner task to verify unconfirmed contact details.',
  },
  {
    value: 'prioritize_lead',
    label: 'Apply Lead Priority Tag / Follow-Up',
    mutatesCrm: true,
    description: 'Tags the lead priority tier and sets next follow-up date on approval.',
  },
] as const;

export type AiActionProposalType = (typeof AI_ACTION_PROPOSAL_TYPES)[number]['value'];
export const AI_ACTION_PROPOSAL_TYPE_SET = new Set<string>(AI_ACTION_PROPOSAL_TYPES.map((t) => t.value));

export const AI_PRIORITY_TIERS = [
  { value: 'critical', label: 'Critical Priority', minScore: 80 },
  { value: 'high', label: 'High Priority', minScore: 62 },
  { value: 'medium', label: 'Medium Priority', minScore: 42 },
  { value: 'low', label: 'Low Priority', minScore: 0 },
] as const;

export type AiPriorityTier = (typeof AI_PRIORITY_TIERS)[number]['value'];

export interface AiAuthorizedToolSpec {
  name: string;
  label: string;
  mode: 'read_only' | 'proposal_only';
  requiresPrivateNoteConsent?: boolean;
  description: string;
}

export const AI_AUTHORIZED_TOOLS: AiAuthorizedToolSpec[] = [
  {
    name: 'search_crm_companies',
    label: 'Search CRM Companies',
    mode: 'read_only',
    description: 'Search existing LEED companies by name, industry, country, or status.',
  },
  {
    name: 'search_decision_makers',
    label: 'Search Decision-Makers',
    mode: 'read_only',
    description: 'Search linked people in the Decision-Makers Directory by name, title, or company.',
  },
  {
    name: 'get_company_profile',
    label: 'Get Company Relationship Profile',
    mode: 'read_only',
    description: 'Load full company record, decision-makers, opportunities, tasks, and interactions (private notes excluded unless authorized).',
  },
  {
    name: 'get_person_profile',
    label: 'Get Person Relationship Profile',
    mode: 'read_only',
    description: 'Load person identity, current/historical company roles, interactions, and tasks.',
  },
  {
    name: 'get_relationship_history',
    label: 'Get Relationship History',
    mode: 'read_only',
    description: 'Inspect chronological interactions and engagement score factors for a company or person.',
  },
  {
    name: 'list_opportunities',
    label: 'List Opportunities',
    mode: 'read_only',
    description: 'List tracked opportunities by company, person, stage, or status.',
  },
  {
    name: 'list_tasks',
    label: 'List Tasks & Follow-Ups',
    mode: 'read_only',
    description: 'List owner tasks and follow-ups filtered by entity, status, or priority.',
  },
  {
    name: 'list_interactions',
    label: 'List Interactions',
    mode: 'read_only',
    description: 'Retrieve logged manual interactions across companies and decision-makers.',
  },
  {
    name: 'search_private_notes',
    label: 'Search Owner Private Notes',
    mode: 'read_only',
    requiresPrivateNoteConsent: true,
    description: 'Read owner-only private notes ONLY when includePrivateNotes is explicitly authorized.',
  },
  {
    name: 'get_enrichment_and_quality',
    label: 'Inspect Enrichment & Data Quality',
    mode: 'read_only',
    description: 'Evaluate data quality grade, missing fields, verification status, and attribute provenance.',
  },
  {
    name: 'evaluate_icp_match',
    label: 'Evaluate ICP Match',
    mode: 'read_only',
    description: 'Score a company against an owner-defined Ideal Customer Profile with criteria breakdown.',
  },
  {
    name: 'prioritize_leads',
    label: 'Prioritize Leads',
    mode: 'read_only',
    description: 'Rank CRM leads with explainable priority scores and recommended next actions.',
  },
  {
    name: 'get_crm_dashboard',
    label: 'Get CRM Dashboard Summary',
    mode: 'read_only',
    description: 'Retrieve real-time CRM metrics, pipeline summary, and neglected relationships.',
  },
  {
    name: 'get_reminders',
    label: 'Get Relationship Reminders',
    mode: 'read_only',
    description: 'Retrieve overdue tasks, today follow-ups, upcoming meetings, and scheduled reviews.',
  },
  {
    name: 'inspect_company_website_ssrf_safe',
    label: 'Inspect Company Website (SSRF-Safe)',
    mode: 'read_only',
    description: 'Inspect a public company URL via LEED SSRF-protected webInspector (blocks private/loopback IPs).',
  },
  {
    name: 'get_bi_analytics_summary',
    label: 'Get Business Intelligence Analytics Summary',
    mode: 'read_only',
    description: 'Read computed BI metrics across lead intelligence, sales pipeline, outreach provenance, activity, and workflow automation.',
  },
  {
    name: 'propose_crm_action',
    label: 'Propose CRM Action (Requires Owner Approval)',
    mode: 'proposal_only',
    description: 'Create a pending CRM action recommendation that executes only after explicit owner approval.',
  },
];

export const AI_AUTHORIZED_TOOL_NAMES = new Set<string>(AI_AUTHORIZED_TOOLS.map((t) => t.name));
