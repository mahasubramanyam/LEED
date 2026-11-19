// Phase 13: Shared Personal CRM & Relationship Management Specifications
// Strictly single-owner, manual interaction recording, transparent derived metrics.

export type CrmInteractionType =
  | 'phone_call'
  | 'meeting'
  | 'video_meeting'
  | 'email'
  | 'linkedin'
  | 'whatsapp'
  | 'introduction'
  | 'referral'
  | 'business_discussion'
  | 'negotiation'
  | 'note'
  | 'custom';

export interface InteractionTypeSpec {
  id: CrmInteractionType;
  label: string;
  shortLabel: string;
  isMeetingLike: boolean;
}

export const CRM_INTERACTION_TYPES: InteractionTypeSpec[] = [
  { id: 'phone_call', label: 'Phone Call', shortLabel: 'Call', isMeetingLike: false },
  { id: 'meeting', label: 'In-Person Meeting', shortLabel: 'Meeting', isMeetingLike: true },
  { id: 'video_meeting', label: 'Video Meeting', shortLabel: 'Video', isMeetingLike: true },
  { id: 'email', label: 'Email (Manually Logged)', shortLabel: 'Email', isMeetingLike: false },
  { id: 'linkedin', label: 'LinkedIn Message (Manual)', shortLabel: 'LinkedIn', isMeetingLike: false },
  { id: 'whatsapp', label: 'WhatsApp / Messaging (Manual)', shortLabel: 'WhatsApp', isMeetingLike: false },
  { id: 'introduction', label: 'Introduction', shortLabel: 'Intro', isMeetingLike: false },
  { id: 'referral', label: 'Referral', shortLabel: 'Referral', isMeetingLike: false },
  { id: 'business_discussion', label: 'Business Discussion', shortLabel: 'Discussion', isMeetingLike: false },
  { id: 'negotiation', label: 'Negotiation', shortLabel: 'Negotiation', isMeetingLike: false },
  { id: 'note', label: 'General Interaction Note', shortLabel: 'Note', isMeetingLike: false },
  { id: 'custom', label: 'Custom Interaction', shortLabel: 'Custom', isMeetingLike: false },
];

export const CRM_INTERACTION_TYPE_SET = new Set<string>(CRM_INTERACTION_TYPES.map((t) => t.id));

export type CrmTaskStatus = 'pending' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';

export const CRM_TASK_STATUSES: Array<{ id: CrmTaskStatus; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const CRM_TASK_STATUS_SET = new Set<string>(CRM_TASK_STATUSES.map((s) => s.id));

export type CrmTaskCategory =
  | 'follow_up'
  | 'call'
  | 'meeting'
  | 'proposal'
  | 'verification'
  | 'research'
  | 'relationship_review'
  | 'other';

export const CRM_TASK_CATEGORIES: Array<{ id: CrmTaskCategory; label: string }> = [
  { id: 'follow_up', label: 'Follow-Up' },
  { id: 'call', label: 'Phone Call' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'proposal', label: 'Proposal / Quote' },
  { id: 'verification', label: 'Data Verification' },
  { id: 'research', label: 'Account Research' },
  { id: 'relationship_review', label: 'Relationship Review' },
  { id: 'other', label: 'Other' },
];

export type CrmRecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

export const CRM_RECURRENCE_FREQUENCIES: Array<{ id: CrmRecurrenceFrequency; label: string; days?: number }> = [
  { id: 'none', label: 'One-Time' },
  { id: 'daily', label: 'Daily', days: 1 },
  { id: 'weekly', label: 'Weekly', days: 7 },
  { id: 'biweekly', label: 'Every 2 Weeks', days: 14 },
  { id: 'monthly', label: 'Monthly', days: 30 },
  { id: 'quarterly', label: 'Quarterly', days: 90 },
];

export type CrmRelationshipStatus =
  | 'new'
  | 'active'
  | 'warm'
  | 'nurturing'
  | 'needs_attention'
  | 'dormant'
  | 'archived';

export const CRM_RELATIONSHIP_STATUSES: Array<{ id: CrmRelationshipStatus; label: string }> = [
  { id: 'new', label: 'New' },
  { id: 'active', label: 'Active' },
  { id: 'warm', label: 'Warm' },
  { id: 'nurturing', label: 'Nurturing' },
  { id: 'needs_attention', label: 'Needs Attention' },
  { id: 'dormant', label: 'Dormant' },
  { id: 'archived', label: 'Archived' },
];

export const CRM_RELATIONSHIP_STATUS_SET = new Set<string>(CRM_RELATIONSHIP_STATUSES.map((s) => s.id));

export type CrmOpportunityStatus = 'open' | 'won' | 'lost' | 'on_hold';

export const CRM_OPPORTUNITY_STATUSES: Array<{ id: CrmOpportunityStatus; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'on_hold', label: 'On Hold' },
];

export const CRM_OPPORTUNITY_STATUS_SET = new Set<string>(CRM_OPPORTUNITY_STATUSES.map((s) => s.id));

export type CrmNoteCategory =
  | 'general'
  | 'relationship'
  | 'meeting_prep'
  | 'negotiation'
  | 'follow_up'
  | 'personal_context'
  | 'risk_flag';

export const CRM_NOTE_CATEGORIES: Array<{ id: CrmNoteCategory; label: string }> = [
  { id: 'general', label: 'General Note' },
  { id: 'relationship', label: 'Relationship Context' },
  { id: 'meeting_prep', label: 'Meeting Prep' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'follow_up', label: 'Follow-Up' },
  { id: 'personal_context', label: 'Personal Context' },
  { id: 'risk_flag', label: 'Risk / Caution' },
];

export type RelationshipStrengthLevel = 'strong' | 'active' | 'developing' | 'cooling' | 'inactive';

export function getInteractionTypeLabel(type: string): string {
  return CRM_INTERACTION_TYPES.find((t) => t.id === type)?.label || type;
}

export function getRelationshipStatusLabel(status?: string): string {
  return CRM_RELATIONSHIP_STATUSES.find((s) => s.id === status)?.label || 'New';
}

export function getTaskStatusLabel(status?: string): string {
  return CRM_TASK_STATUSES.find((s) => s.id === status)?.label || 'Pending';
}

export function getOpportunityStatusLabel(status?: string): string {
  return CRM_OPPORTUNITY_STATUSES.find((s) => s.id === status)?.label || 'Open';
}

export function getNoteCategoryLabel(category?: string): string {
  return CRM_NOTE_CATEGORIES.find((c) => c.id === category)?.label || 'General Note';
}
