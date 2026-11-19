// Phase 13: Dual-Storage Personal CRM Persistence Helper
// Reuses existing CanonicalLead, PersonRecord, CompanyPersonRelationship, LeadTask,
// LeadNote, LeadActivity, and AppSettings JSONB storage across BOTH PostgreSQL and JSON
// StorageManager — zero parallel CRM databases and zero new DDL migrations required.

import crypto from 'crypto';
import type {
  AppSettings,
  CanonicalLead,
  CompanyPersonRelationship,
  CrmInteraction,
  CrmInteractionType,
  CrmNoteCategory,
  CrmOpportunity,
  CrmPrivateNote,
  CrmRelationshipStatus,
  CrmSavedView,
  LeadActivity,
  LeadTask,
  OpportunityStageChange,
  PersonRecord,
  PipelineStage,
  RelationshipMetadata,
} from '../types.js';
import {
  CRM_INTERACTION_TYPE_SET,
  CRM_OPPORTUNITY_STATUS_SET,
  CRM_RELATIONSHIP_STATUS_SET,
  CRM_TASK_STATUS_SET,
} from '../../shared/crmSpecs.js';

export const CRM_WORKSPACE_SETTINGS_KEY = '__crm_workspace_v1';

export interface ExtendedTaskMetadata {
  personId?: string;
  opportunityId?: string;
  description?: string;
  reminderDate?: string;
  category?: LeadTask['category'];
  status?: LeadTask['status'];
  completedAt?: string;
  notes?: string;
  outcome?: string;
  recurrence?: LeadTask['recurrence'];
  updatedAt?: string;
}

export interface CrmWorkspaceState {
  version: 1;
  savedViews: CrmSavedView[];
  taskMetadata: Record<string, ExtendedTaskMetadata>;
  standaloneInteractions: CrmInteraction[];
  standaloneNotes: CrmPrivateNote[];
  updatedAt: string;
}

export interface CrmStorageFacade {
  getLeads(): Promise<CanonicalLead[]>;
  getLead(id: string): Promise<CanonicalLead | undefined | null>;
  upsertLead(lead: CanonicalLead): Promise<CanonicalLead>;
  getPersons(): Promise<PersonRecord[]>;
  getPersonById(id: string): Promise<PersonRecord | undefined | null>;
  upsertPerson(person: PersonRecord): Promise<PersonRecord>;
  getCompanyPersonRelationships(): Promise<CompanyPersonRelationship[]>;
  getStages(): Promise<PipelineStage[]>;
  getTasks(): Promise<LeadTask[]>;
  createTask(task: Omit<LeadTask, 'id' | 'createdAt'>): Promise<LeadTask>;
  updateTask(id: string, updates: Partial<LeadTask>): Promise<LeadTask | undefined | null>;
  deleteTask(id: string): Promise<boolean>;
  getSettings(): Promise<AppSettings>;
  updateSettings(updates: Partial<AppSettings>): Promise<AppSettings>;
  addLeadNote?(leadId: string, content: string, author: string): Promise<CanonicalLead | undefined | null>;
  addLeadActivity?(leadId: string, activity: Omit<LeadActivity, 'id'>): Promise<CanonicalLead | undefined | null>;
}

/**
 * Wraps either synchronous JSON StorageManager or async PostgresStorage into a uniform async facade.
 */
export function createCrmStorageFacade(adapter: any): CrmStorageFacade {
  const resolveVal = async <T>(val: T | Promise<T>): Promise<T> => await Promise.resolve(val);
  return {
    getLeads: async () => {
      const raw = await resolveVal(
        typeof adapter.getLeads === 'function'
          ? adapter.getLeads({ page: 1, pageSize: 10000 })
          : []
      );
      if (Array.isArray(raw)) return raw;
      if (raw && Array.isArray((raw as any).leads)) return (raw as any).leads;
      return [];
    },
    getLead: (id) => resolveVal(adapter.getLead(id)),
    upsertLead: (lead) => resolveVal(adapter.upsertLead(lead)),
    getPersons: () => resolveVal(adapter.getPersons()),
    getPersonById: async (id) => {
      if (typeof adapter.getPersonById === 'function') {
        return resolveVal(adapter.getPersonById(id));
      }
      const all: PersonRecord[] = await resolveVal(adapter.getPersons());
      return all.find((p) => p.id === id) || null;
    },
    upsertPerson: async (person) => {
      if (typeof adapter.upsertPerson === 'function') {
        return resolveVal(adapter.upsertPerson(person));
      }
      const updated = await resolveVal(
        adapter.updatePersonRecord(person.id, {
          customFields: person.customFields || {},
        })
      );
      return updated || person;
    },
    getCompanyPersonRelationships: () => {
      if (typeof adapter.getAllRelationships === 'function') {
        return resolveVal(adapter.getAllRelationships());
      }
      return resolveVal(adapter.getCompanyPersonRelationships());
    },
    getStages: () => resolveVal(adapter.getStages()),
    getTasks: () => resolveVal(adapter.getTasks()),
    createTask: (task) => resolveVal(adapter.createTask(task)),
    updateTask: (id, updates) => resolveVal(adapter.updateTask(id, updates)),
    deleteTask: (id) => resolveVal(adapter.deleteTask(id)),
    getSettings: () => resolveVal(adapter.getSettings()),
    updateSettings: (updates) => resolveVal(adapter.updateSettings(updates)),
    addLeadNote: adapter.addNote
      ? (leadId, content, author) => resolveVal(adapter.addNote(leadId, content, author))
      : undefined,
    addLeadActivity: adapter.addActivity
      ? (leadId, activity) => resolveVal(adapter.addActivity(leadId, activity))
      : undefined,
  };
}

function safeParseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && parsed !== undefined ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

export function generateCrmId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

export function normalizeDateIso(raw?: string): string | undefined {
  if (!raw || !String(raw).trim()) return undefined;
  const d = new Date(String(raw).trim());
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function sanitizeTags(tags?: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const cleaned = String(t || '').trim().slice(0, 60);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out.slice(0, 30);
}

// ============================================================================
// WORKSPACE STATE (Saved Views, Extended Task Metadata, Standalone Records)
// ============================================================================

export async function getCrmWorkspaceState(facade: CrmStorageFacade): Promise<CrmWorkspaceState> {
  const settings = await facade.getSettings();
  const rawMap = (settings.connectorConfigs || {}) as Record<string, unknown>;
  const rawState = rawMap[CRM_WORKSPACE_SETTINGS_KEY] as Partial<CrmWorkspaceState> | undefined;
  return {
    version: 1,
    savedViews: Array.isArray(rawState?.savedViews) ? rawState.savedViews : [],
    taskMetadata:
      rawState?.taskMetadata && typeof rawState.taskMetadata === 'object' ? rawState.taskMetadata : {},
    standaloneInteractions: Array.isArray(rawState?.standaloneInteractions)
      ? rawState.standaloneInteractions
      : [],
    standaloneNotes: Array.isArray(rawState?.standaloneNotes) ? rawState.standaloneNotes : [],
    updatedAt: rawState?.updatedAt || new Date().toISOString(),
  };
}

export async function saveCrmWorkspaceState(
  facade: CrmStorageFacade,
  next: CrmWorkspaceState
): Promise<CrmWorkspaceState> {
  const stamped: CrmWorkspaceState = {
    ...next,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  await facade.updateSettings({
    connectorConfigs: {
      [CRM_WORKSPACE_SETTINGS_KEY]: stamped as any,
    },
  });
  return stamped;
}

// ============================================================================
// ENTITY CUSTOM-FIELDS PARSERS (Lead & Person)
// ============================================================================

export function getEntityRelationshipMeta(
  customFields?: Record<string, string>,
  fallbackTags: string[] = []
): RelationshipMetadata {
  const parsed = safeParseJson<Partial<RelationshipMetadata>>(customFields?.crmRelationshipMeta, {});
  const status: CrmRelationshipStatus =
    parsed.relationshipStatus && CRM_RELATIONSHIP_STATUS_SET.has(parsed.relationshipStatus)
      ? parsed.relationshipStatus
      : 'new';
  return {
    relationshipStatus: status,
    nextFollowUpDate: parsed.nextFollowUpDate,
    scheduledReviewDate: parsed.scheduledReviewDate,
    tags: Array.isArray(parsed.tags) ? sanitizeTags(parsed.tags) : sanitizeTags(fallbackTags),
    ownerOverrideLevel: parsed.ownerOverrideLevel,
    ownerAnnotation: parsed.ownerAnnotation,
    updatedAt: parsed.updatedAt,
  };
}

export function getEntityInteractions(customFields?: Record<string, string>): CrmInteraction[] {
  const arr = safeParseJson<CrmInteraction[]>(customFields?.crmInteractions, []);
  return Array.isArray(arr)
    ? arr.map((item) => ({
        ...item,
        recordingMode: 'manual' as const,
      }))
    : [];
}

export function getEntityPrivateNotes(customFields?: Record<string, string>): CrmPrivateNote[] {
  const arr = safeParseJson<CrmPrivateNote[]>(customFields?.crmPrivateNotes, []);
  return Array.isArray(arr)
    ? arr.map((n) => ({
        ...n,
        visibility: 'owner_only' as const,
        tags: Array.isArray(n.tags) ? n.tags : [],
        pinned: Boolean(n.pinned),
      }))
    : [];
}

export function getLeadOpportunities(lead: CanonicalLead): CrmOpportunity[] {
  const arr = safeParseJson<CrmOpportunity[]>(lead.customFields?.crmOpportunities, []);
  return Array.isArray(arr) ? arr : [];
}

// ============================================================================
// AGGREGATED READERS (Unified Across Entities + Workspace)
// ============================================================================

export async function listAllCrmInteractions(
  facade: CrmStorageFacade,
  filters?: {
    leadId?: string;
    personId?: string;
    opportunityId?: string;
    type?: string;
    search?: string;
    limit?: number;
  }
): Promise<CrmInteraction[]> {
  const [leads, persons, workspace] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    getCrmWorkspaceState(facade),
  ]);

  const byId = new Map<string, CrmInteraction>();
  for (const lead of leads) {
    for (const item of getEntityInteractions(lead.customFields)) {
      byId.set(item.id, item);
    }
  }
  for (const person of persons) {
    for (const item of getEntityInteractions(person.customFields)) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
  }
  for (const item of workspace.standaloneInteractions) {
    if (!byId.has(item.id)) {
      byId.set(item.id, { ...item, recordingMode: 'manual' });
    }
  }

  let list = Array.from(byId.values());
  if (filters?.leadId) {
    list = list.filter((i) => i.leadId === filters.leadId);
  }
  if (filters?.personId) {
    list = list.filter((i) => i.personId === filters.personId);
  }
  if (filters?.opportunityId) {
    list = list.filter((i) => i.opportunityId === filters.opportunityId);
  }
  if (filters?.type && filters.type !== 'all') {
    list = list.filter((i) => i.type === filters.type);
  }
  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    list = list.filter(
      (i) =>
        i.summary.toLowerCase().includes(q) ||
        (i.detailedNotes && i.detailedNotes.toLowerCase().includes(q)) ||
        (i.outcome && i.outcome.toLowerCase().includes(q)) ||
        (i.nextAction && i.nextAction.toLowerCase().includes(q))
    );
  }

  // Strictly chronological newest-first by occurredAt, tie-break by createdAt
  list.sort((a, b) => {
    const diff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    if (diff !== 0) return diff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  if (filters?.limit && filters.limit > 0) {
    return list.slice(0, filters.limit);
  }
  return list;
}

export async function listAllCrmPrivateNotes(
  facade: CrmStorageFacade,
  filters?: {
    entityType?: string;
    leadId?: string;
    personId?: string;
    interactionId?: string;
    opportunityId?: string;
    category?: string;
    tag?: string;
    pinnedOnly?: boolean;
    search?: string;
  }
): Promise<CrmPrivateNote[]> {
  const [leads, persons, workspace] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    getCrmWorkspaceState(facade),
  ]);

  const byId = new Map<string, CrmPrivateNote>();
  for (const lead of leads) {
    for (const n of getEntityPrivateNotes(lead.customFields)) {
      byId.set(n.id, n);
    }
    // Also surface legacy lead.notes seamlessly as owner-only company notes if not already mirrored
    for (const legacy of lead.notes || []) {
      const legacyId = `legacy-note-${legacy.id}`;
      const alreadyMirrored = Array.from(byId.values()).some(
        (existing) =>
          existing.leadId === lead.id &&
          existing.content.trim() === legacy.content.trim() &&
          Math.abs(new Date(existing.createdAt).getTime() - new Date(legacy.createdAt).getTime()) < 5000
      );
      if (!alreadyMirrored && !byId.has(legacyId)) {
        byId.set(legacyId, {
          id: legacyId,
          entityType: 'company',
          leadId: lead.id,
          content: legacy.content,
          category: 'general',
          tags: [],
          pinned: false,
          visibility: 'owner_only',
          author: legacy.author || 'Owner',
          createdAt: legacy.createdAt,
          updatedAt: legacy.createdAt,
        });
      }
    }
  }
  for (const person of persons) {
    for (const n of getEntityPrivateNotes(person.customFields)) {
      if (!byId.has(n.id)) {
        byId.set(n.id, n);
      }
    }
  }
  for (const n of workspace.standaloneNotes) {
    if (!byId.has(n.id)) {
      byId.set(n.id, { ...n, visibility: 'owner_only' });
    }
  }

  let list = Array.from(byId.values());
  if (filters?.entityType && filters.entityType !== 'all') {
    list = list.filter((n) => n.entityType === filters.entityType);
  }
  if (filters?.leadId) {
    list = list.filter((n) => n.leadId === filters.leadId);
  }
  if (filters?.personId) {
    list = list.filter((n) => n.personId === filters.personId);
  }
  if (filters?.interactionId) {
    list = list.filter((n) => n.interactionId === filters.interactionId);
  }
  if (filters?.opportunityId) {
    list = list.filter((n) => n.opportunityId === filters.opportunityId);
  }
  if (filters?.category && filters.category !== 'all') {
    list = list.filter((n) => n.category === filters.category);
  }
  if (filters?.tag && filters.tag.trim()) {
    const tagLower = filters.tag.trim().toLowerCase();
    list = list.filter((n) => n.tags.some((t) => t.toLowerCase() === tagLower));
  }
  if (filters?.pinnedOnly) {
    list = list.filter((n) => n.pinned);
  }
  if (filters?.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    list = list.filter(
      (n) =>
        n.content.toLowerCase().includes(q) ||
        (n.title && n.title.toLowerCase().includes(q)) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  // Pinned first, then newest updatedAt
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return list;
}

export async function listAllCrmOpportunities(
  facade: CrmStorageFacade,
  filters?: {
    leadId?: string;
    personId?: string;
    stageId?: string;
    status?: string;
  }
): Promise<CrmOpportunity[]> {
  const leads = await facade.getLeads();
  const all: CrmOpportunity[] = [];
  for (const lead of leads) {
    for (const opp of getLeadOpportunities(lead)) {
      all.push(opp);
    }
  }

  let list = all;
  if (filters?.leadId) list = list.filter((o) => o.leadId === filters.leadId);
  if (filters?.personId) list = list.filter((o) => o.personId === filters.personId);
  if (filters?.stageId && filters.stageId !== 'all') list = list.filter((o) => o.pipelineStageId === filters.stageId);
  if (filters?.status && filters.status !== 'all') list = list.filter((o) => o.status === filters.status);

  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return list;
}

export async function listAllExtendedTasks(
  facade: CrmStorageFacade,
  filters?: {
    leadId?: string;
    personId?: string;
    opportunityId?: string;
    status?: string;
    priority?: string;
    category?: string;
  }
): Promise<LeadTask[]> {
  const [tasks, workspace] = await Promise.all([facade.getTasks(), getCrmWorkspaceState(facade)]);
  let merged: LeadTask[] = tasks.map((t) => {
    const meta = workspace.taskMetadata[t.id] || {};
    const status: LeadTask['status'] =
      meta.status && CRM_TASK_STATUS_SET.has(meta.status)
        ? meta.status
        : t.completed
          ? 'completed'
          : 'pending';
    return {
      ...t,
      personId: meta.personId ?? t.personId,
      opportunityId: meta.opportunityId ?? t.opportunityId,
      description: meta.description ?? t.description,
      reminderDate: meta.reminderDate ?? t.reminderDate,
      category: meta.category ?? t.category ?? 'follow_up',
      status,
      completed: status === 'completed' || t.completed,
      completedAt: meta.completedAt ?? t.completedAt,
      notes: meta.notes ?? t.notes,
      outcome: meta.outcome ?? t.outcome,
      recurrence: meta.recurrence ?? t.recurrence,
      updatedAt: meta.updatedAt ?? t.updatedAt ?? t.createdAt,
    };
  });

  if (filters?.leadId) merged = merged.filter((t) => t.leadId === filters.leadId);
  if (filters?.personId) merged = merged.filter((t) => t.personId === filters.personId);
  if (filters?.opportunityId) merged = merged.filter((t) => t.opportunityId === filters.opportunityId);
  if (filters?.status && filters.status !== 'all') merged = merged.filter((t) => t.status === filters.status);
  if (filters?.priority && filters.priority !== 'all') merged = merged.filter((t) => t.priority === filters.priority);
  if (filters?.category && filters.category !== 'all') merged = merged.filter((t) => t.category === filters.category);

  merged.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  return merged;
}

// ============================================================================
// MUTATION HELPERS (Interactions, Notes, Tasks, Opportunities, Relationship Meta)
// ============================================================================

function mapInteractionToLegacyActivityType(type: CrmInteractionType): LeadActivity['type'] {
  if (type === 'phone_call') return 'call';
  if (type === 'email') return 'email';
  if (type === 'meeting' || type === 'video_meeting') return 'meeting';
  return 'note';
}

export async function createCrmInteraction(
  facade: CrmStorageFacade,
  input: {
    leadId?: string;
    personId?: string;
    opportunityId?: string;
    type: CrmInteractionType;
    customTypeLabel?: string;
    occurredAt?: string;
    summary: string;
    detailedNotes?: string;
    outcome?: string;
    nextAction?: string;
    followUpDate?: string;
    attachments?: CrmInteraction['attachments'];
    recordedBy: string;
  }
): Promise<CrmInteraction> {
  const now = new Date().toISOString();
  const type: CrmInteractionType = CRM_INTERACTION_TYPE_SET.has(input.type) ? input.type : 'note';
  const occurredAt = normalizeDateIso(input.occurredAt) || now;
  const followUpDate = normalizeDateIso(input.followUpDate);

  const interaction: CrmInteraction = {
    id: generateCrmId('int'),
    leadId: input.leadId?.trim() || undefined,
    personId: input.personId?.trim() || undefined,
    opportunityId: input.opportunityId?.trim() || undefined,
    type,
    customTypeLabel: input.customTypeLabel?.trim().slice(0, 80) || undefined,
    occurredAt,
    summary: input.summary.trim().slice(0, 500),
    detailedNotes: input.detailedNotes?.trim().slice(0, 10000) || undefined,
    outcome: input.outcome?.trim().slice(0, 500) || undefined,
    nextAction: input.nextAction?.trim().slice(0, 500) || undefined,
    followUpDate,
    attachments: Array.isArray(input.attachments) ? input.attachments.slice(0, 10) : undefined,
    recordingMode: 'manual',
    recordedBy: input.recordedBy || 'Owner',
    createdAt: now,
    updatedAt: now,
  };

  let persistedOnEntity = false;

  if (interaction.leadId) {
    const lead = await facade.getLead(interaction.leadId);
    if (lead) {
      const existing = getEntityInteractions(lead.customFields);
      const nextList = [interaction, ...existing];
      const nextCustomFields: Record<string, string> = {
        ...(lead.customFields || {}),
        crmInteractions: JSON.stringify(nextList),
      };
      // Update company nextFollowUpDate if interaction has follow-up date and company has none or older
      if (followUpDate) {
        const meta = getEntityRelationshipMeta(nextCustomFields, lead.tags);
        if (!meta.nextFollowUpDate || new Date(followUpDate).getTime() > new Date(meta.nextFollowUpDate).getTime()) {
          nextCustomFields.crmRelationshipMeta = JSON.stringify({
            ...meta,
            relationshipStatus: meta.relationshipStatus === 'new' ? 'active' : meta.relationshipStatus,
            nextFollowUpDate: followUpDate,
            updatedAt: now,
          });
        }
      } else {
        const meta = getEntityRelationshipMeta(nextCustomFields, lead.tags);
        if (meta.relationshipStatus === 'new') {
          nextCustomFields.crmRelationshipMeta = JSON.stringify({
            ...meta,
            relationshipStatus: 'active',
            updatedAt: now,
          });
        }
      }

      const legacyActivity: LeadActivity = {
        id: `act-${interaction.id}`,
        type: mapInteractionToLegacyActivityType(interaction.type),
        title: interaction.summary,
        notes: interaction.detailedNotes,
        outcome: interaction.outcome,
        date: interaction.occurredAt,
        actor: interaction.recordedBy,
      };

      await facade.upsertLead({
        ...lead,
        customFields: nextCustomFields,
        activities: [legacyActivity, ...(lead.activities || [])],
        updatedAt: now,
      });
      persistedOnEntity = true;
    }
  }

  if (interaction.personId) {
    const person = await facade.getPersonById(interaction.personId);
    if (person) {
      const existing = getEntityInteractions(person.customFields);
      const nextList = [interaction, ...existing];
      const nextCustomFields: Record<string, string> = {
        ...(person.customFields || {}),
        crmInteractions: JSON.stringify(nextList),
      };
      const meta = getEntityRelationshipMeta(nextCustomFields);
      if (followUpDate || meta.relationshipStatus === 'new') {
        nextCustomFields.crmRelationshipMeta = JSON.stringify({
          ...meta,
          relationshipStatus: meta.relationshipStatus === 'new' ? 'active' : meta.relationshipStatus,
          nextFollowUpDate: followUpDate || meta.nextFollowUpDate,
          updatedAt: now,
        });
      }
      await facade.upsertPerson({
        ...person,
        customFields: nextCustomFields,
        updatedAt: now,
      });
      persistedOnEntity = true;
    }
  }

  if (!persistedOnEntity) {
    const ws = await getCrmWorkspaceState(facade);
    ws.standaloneInteractions = [interaction, ...ws.standaloneInteractions];
    await saveCrmWorkspaceState(facade, ws);
  }

  return interaction;
}

export async function updateCrmInteraction(
  facade: CrmStorageFacade,
  id: string,
  updates: Partial<
    Pick<
      CrmInteraction,
      | 'type'
      | 'customTypeLabel'
      | 'occurredAt'
      | 'summary'
      | 'detailedNotes'
      | 'outcome'
      | 'nextAction'
      | 'followUpDate'
      | 'attachments'
      | 'opportunityId'
    >
  >
): Promise<CrmInteraction | null> {
  const now = new Date().toISOString();
  const [leads, persons, ws] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    getCrmWorkspaceState(facade),
  ]);

  let updatedRecord: CrmInteraction | null = null;

  const applyPatch = (item: CrmInteraction): CrmInteraction => ({
    ...item,
    type: updates.type && CRM_INTERACTION_TYPE_SET.has(updates.type) ? updates.type : item.type,
    customTypeLabel:
      updates.customTypeLabel !== undefined ? updates.customTypeLabel?.trim() || undefined : item.customTypeLabel,
    occurredAt: updates.occurredAt ? normalizeDateIso(updates.occurredAt) || item.occurredAt : item.occurredAt,
    summary: updates.summary !== undefined ? updates.summary.trim().slice(0, 500) : item.summary,
    detailedNotes:
      updates.detailedNotes !== undefined ? updates.detailedNotes?.trim().slice(0, 10000) || undefined : item.detailedNotes,
    outcome: updates.outcome !== undefined ? updates.outcome?.trim().slice(0, 500) || undefined : item.outcome,
    nextAction: updates.nextAction !== undefined ? updates.nextAction?.trim().slice(0, 500) || undefined : item.nextAction,
    followUpDate:
      updates.followUpDate !== undefined
        ? updates.followUpDate
          ? normalizeDateIso(updates.followUpDate)
          : undefined
        : item.followUpDate,
    attachments: updates.attachments !== undefined ? updates.attachments : item.attachments,
    opportunityId: updates.opportunityId !== undefined ? updates.opportunityId || undefined : item.opportunityId,
    recordingMode: 'manual',
    updatedAt: now,
  });

  for (const lead of leads) {
    const list = getEntityInteractions(lead.customFields);
    const idx = list.findIndex((i) => i.id === id);
    if (idx !== -1) {
      list[idx] = applyPatch(list[idx]);
      updatedRecord = list[idx];
      await facade.upsertLead({
        ...lead,
        customFields: { ...(lead.customFields || {}), crmInteractions: JSON.stringify(list) },
        updatedAt: now,
      });
    }
  }

  for (const person of persons) {
    const list = getEntityInteractions(person.customFields);
    const idx = list.findIndex((i) => i.id === id);
    if (idx !== -1) {
      list[idx] = applyPatch(list[idx]);
      updatedRecord = updatedRecord || list[idx];
      await facade.upsertPerson({
        ...person,
        customFields: { ...(person.customFields || {}), crmInteractions: JSON.stringify(list) },
        updatedAt: now,
      });
    }
  }

  const wsIdx = ws.standaloneInteractions.findIndex((i) => i.id === id);
  if (wsIdx !== -1) {
    ws.standaloneInteractions[wsIdx] = applyPatch(ws.standaloneInteractions[wsIdx]);
    updatedRecord = updatedRecord || ws.standaloneInteractions[wsIdx];
    await saveCrmWorkspaceState(facade, ws);
  }

  return updatedRecord;
}

export async function deleteCrmInteraction(facade: CrmStorageFacade, id: string): Promise<boolean> {
  const [leads, persons, ws] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    getCrmWorkspaceState(facade),
  ]);
  let deleted = false;
  const now = new Date().toISOString();

  for (const lead of leads) {
    const list = getEntityInteractions(lead.customFields);
    const filtered = list.filter((i) => i.id !== id);
    if (filtered.length !== list.length) {
      deleted = true;
      await facade.upsertLead({
        ...lead,
        customFields: { ...(lead.customFields || {}), crmInteractions: JSON.stringify(filtered) },
        activities: (lead.activities || []).filter((a) => a.id !== `act-${id}`),
        updatedAt: now,
      });
    }
  }

  for (const person of persons) {
    const list = getEntityInteractions(person.customFields);
    const filtered = list.filter((i) => i.id !== id);
    if (filtered.length !== list.length) {
      deleted = true;
      await facade.upsertPerson({
        ...person,
        customFields: { ...(person.customFields || {}), crmInteractions: JSON.stringify(filtered) },
        updatedAt: now,
      });
    }
  }

  const filteredStandalone = ws.standaloneInteractions.filter((i) => i.id !== id);
  if (filteredStandalone.length !== ws.standaloneInteractions.length) {
    deleted = true;
    ws.standaloneInteractions = filteredStandalone;
    await saveCrmWorkspaceState(facade, ws);
  }

  return deleted;
}

// --- Private Owner-Only Notes ---

export async function createCrmPrivateNote(
  facade: CrmStorageFacade,
  input: {
    entityType: CrmPrivateNote['entityType'];
    leadId?: string;
    personId?: string;
    interactionId?: string;
    opportunityId?: string;
    title?: string;
    content: string;
    category?: CrmNoteCategory;
    tags?: string[];
    pinned?: boolean;
    author: string;
  }
): Promise<CrmPrivateNote> {
  const now = new Date().toISOString();
  const note: CrmPrivateNote = {
    id: generateCrmId('note'),
    entityType: input.entityType || 'company',
    leadId: input.leadId?.trim() || undefined,
    personId: input.personId?.trim() || undefined,
    interactionId: input.interactionId?.trim() || undefined,
    opportunityId: input.opportunityId?.trim() || undefined,
    title: input.title?.trim().slice(0, 200) || undefined,
    content: input.content.trim().slice(0, 10000),
    category: input.category || 'general',
    tags: sanitizeTags(input.tags),
    pinned: Boolean(input.pinned),
    visibility: 'owner_only',
    author: input.author || 'Owner',
    createdAt: now,
    updatedAt: now,
  };

  let persistedOnEntity = false;

  if (note.leadId) {
    const lead = await facade.getLead(note.leadId);
    if (lead) {
      const existing = getEntityPrivateNotes(lead.customFields);
      await facade.upsertLead({
        ...lead,
        customFields: {
          ...(lead.customFields || {}),
          crmPrivateNotes: JSON.stringify([note, ...existing]),
        },
        updatedAt: now,
      });
      persistedOnEntity = true;
    }
  }

  if (note.personId) {
    const person = await facade.getPersonById(note.personId);
    if (person) {
      const existing = getEntityPrivateNotes(person.customFields);
      await facade.upsertPerson({
        ...person,
        customFields: {
          ...(person.customFields || {}),
          crmPrivateNotes: JSON.stringify([note, ...existing]),
        },
        updatedAt: now,
      });
      persistedOnEntity = true;
    }
  }

  if (!persistedOnEntity) {
    const ws = await getCrmWorkspaceState(facade);
    ws.standaloneNotes = [note, ...ws.standaloneNotes];
    await saveCrmWorkspaceState(facade, ws);
  }

  return note;
}

export async function updateCrmPrivateNote(
  facade: CrmStorageFacade,
  id: string,
  updates: Partial<Pick<CrmPrivateNote, 'title' | 'content' | 'category' | 'tags' | 'pinned'>>
): Promise<CrmPrivateNote | null> {
  const now = new Date().toISOString();
  const [leads, persons, ws] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    getCrmWorkspaceState(facade),
  ]);

  let updatedNote: CrmPrivateNote | null = null;
  const applyPatch = (n: CrmPrivateNote): CrmPrivateNote => ({
    ...n,
    title: updates.title !== undefined ? updates.title?.trim().slice(0, 200) || undefined : n.title,
    content: updates.content !== undefined ? updates.content.trim().slice(0, 10000) : n.content,
    category: updates.category ?? n.category,
    tags: updates.tags !== undefined ? sanitizeTags(updates.tags) : n.tags,
    pinned: updates.pinned !== undefined ? Boolean(updates.pinned) : n.pinned,
    visibility: 'owner_only',
    updatedAt: now,
  });

  for (const lead of leads) {
    const list = getEntityPrivateNotes(lead.customFields);
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      list[idx] = applyPatch(list[idx]);
      updatedNote = list[idx];
      await facade.upsertLead({
        ...lead,
        customFields: { ...(lead.customFields || {}), crmPrivateNotes: JSON.stringify(list) },
        updatedAt: now,
      });
    }
  }

  for (const person of persons) {
    const list = getEntityPrivateNotes(person.customFields);
    const idx = list.findIndex((n) => n.id === id);
    if (idx !== -1) {
      list[idx] = applyPatch(list[idx]);
      updatedNote = updatedNote || list[idx];
      await facade.upsertPerson({
        ...person,
        customFields: { ...(person.customFields || {}), crmPrivateNotes: JSON.stringify(list) },
        updatedAt: now,
      });
    }
  }

  const wsIdx = ws.standaloneNotes.findIndex((n) => n.id === id);
  if (wsIdx !== -1) {
    ws.standaloneNotes[wsIdx] = applyPatch(ws.standaloneNotes[wsIdx]);
    updatedNote = updatedNote || ws.standaloneNotes[wsIdx];
    await saveCrmWorkspaceState(facade, ws);
  }

  return updatedNote;
}

export async function deleteCrmPrivateNote(facade: CrmStorageFacade, id: string): Promise<boolean> {
  const [leads, persons, ws] = await Promise.all([
    facade.getLeads(),
    facade.getPersons(),
    getCrmWorkspaceState(facade),
  ]);
  let deleted = false;
  const now = new Date().toISOString();

  for (const lead of leads) {
    const list = getEntityPrivateNotes(lead.customFields);
    const filtered = list.filter((n) => n.id !== id);
    if (filtered.length !== list.length) {
      deleted = true;
      await facade.upsertLead({
        ...lead,
        customFields: { ...(lead.customFields || {}), crmPrivateNotes: JSON.stringify(filtered) },
        updatedAt: now,
      });
    }
  }

  for (const person of persons) {
    const list = getEntityPrivateNotes(person.customFields);
    const filtered = list.filter((n) => n.id !== id);
    if (filtered.length !== list.length) {
      deleted = true;
      await facade.upsertPerson({
        ...person,
        customFields: { ...(person.customFields || {}), crmPrivateNotes: JSON.stringify(filtered) },
        updatedAt: now,
      });
    }
  }

  const filteredWs = ws.standaloneNotes.filter((n) => n.id !== id);
  if (filteredWs.length !== ws.standaloneNotes.length) {
    deleted = true;
    ws.standaloneNotes = filteredWs;
    await saveCrmWorkspaceState(facade, ws);
  }

  return deleted;
}

// --- Opportunities (Multiple per Company with Immutable Stage History) ---

export async function createCrmOpportunity(
  facade: CrmStorageFacade,
  input: {
    leadId: string;
    personId?: string;
    title: string;
    description?: string;
    estimatedValue?: number;
    currency?: string;
    expectedCloseDate?: string;
    pipelineStageId?: string;
    probability?: number;
    source?: string;
    nextAction?: string;
    nextActionDate?: string;
    notes?: string;
    status?: CrmOpportunity['status'];
    changedBy: string;
  }
): Promise<CrmOpportunity> {
  const lead = await facade.getLead(input.leadId);
  if (!lead) {
    throw new Error('Company lead not found for opportunity.');
  }
  const stages = await facade.getStages();
  const stageId = input.pipelineStageId || lead.pipelineStageId || stages[0]?.id || 'stage-new';
  const stage = stages.find((s) => s.id === stageId);
  const now = new Date().toISOString();

  const status: CrmOpportunity['status'] =
    input.status && CRM_OPPORTUNITY_STATUS_SET.has(input.status) ? input.status : 'open';

  const initialStageChange: OpportunityStageChange = {
    id: generateCrmId('stg'),
    toStageId: stageId,
    toStageName: stage?.name || stageId,
    changedAt: now,
    changedBy: input.changedBy || 'Owner',
    reason: 'Opportunity created',
  };

  const opp: CrmOpportunity = {
    id: generateCrmId('opp'),
    leadId: lead.id,
    personId: input.personId?.trim() || undefined,
    title: input.title.trim().slice(0, 200),
    description: input.description?.trim().slice(0, 4000) || undefined,
    estimatedValue: Number.isFinite(Number(input.estimatedValue)) ? Math.max(0, Number(input.estimatedValue)) : 0,
    currency: (input.currency || lead.currency || 'USD').toUpperCase().slice(0, 3),
    expectedCloseDate: normalizeDateIso(input.expectedCloseDate),
    pipelineStageId: stageId,
    probability: Number.isFinite(Number(input.probability))
      ? Math.min(100, Math.max(0, Number(input.probability)))
      : 30,
    source: input.source?.trim().slice(0, 120) || undefined,
    nextAction: input.nextAction?.trim().slice(0, 400) || undefined,
    nextActionDate: normalizeDateIso(input.nextActionDate),
    notes: input.notes?.trim().slice(0, 4000) || undefined,
    status,
    stageHistory: [initialStageChange],
    createdAt: now,
    updatedAt: now,
  };

  const existing = getLeadOpportunities(lead);
  const nextOpps = [opp, ...existing];
  const openSum = nextOpps
    .filter((o) => o.status === 'open')
    .reduce((acc, o) => acc + (o.estimatedValue || 0), 0);

  await facade.upsertLead({
    ...lead,
    opportunityValue: openSum > 0 ? openSum : lead.opportunityValue,
    customFields: {
      ...(lead.customFields || {}),
      crmOpportunities: JSON.stringify(nextOpps),
    },
    updatedAt: now,
  });

  return opp;
}

export async function updateCrmOpportunity(
  facade: CrmStorageFacade,
  id: string,
  updates: Partial<
    Pick<
      CrmOpportunity,
      | 'personId'
      | 'title'
      | 'description'
      | 'estimatedValue'
      | 'currency'
      | 'expectedCloseDate'
      | 'pipelineStageId'
      | 'probability'
      | 'source'
      | 'nextAction'
      | 'nextActionDate'
      | 'notes'
      | 'status'
      | 'winLossReason'
    >
  > & { stageChangeReason?: string; changedBy?: string }
): Promise<CrmOpportunity | null> {
  const [leads, stages] = await Promise.all([facade.getLeads(), facade.getStages()]);
  const now = new Date().toISOString();

  for (const lead of leads) {
    const list = getLeadOpportunities(lead);
    const idx = list.findIndex((o) => o.id === id);
    if (idx === -1) continue;

    const current = list[idx];
    const nextStageId = updates.pipelineStageId || current.pipelineStageId;
    const stageHistory = [...(current.stageHistory || [])];

    if (nextStageId !== current.pipelineStageId) {
      const fromStage = stages.find((s) => s.id === current.pipelineStageId);
      const toStage = stages.find((s) => s.id === nextStageId);
      stageHistory.push({
        id: generateCrmId('stg'),
        fromStageId: current.pipelineStageId,
        fromStageName: fromStage?.name || current.pipelineStageId,
        toStageId: nextStageId,
        toStageName: toStage?.name || nextStageId,
        changedAt: now,
        changedBy: updates.changedBy || 'Owner',
        reason: updates.stageChangeReason?.trim() || updates.winLossReason?.trim() || undefined,
      });
    }

    const nextStatus: CrmOpportunity['status'] =
      updates.status && CRM_OPPORTUNITY_STATUS_SET.has(updates.status)
        ? updates.status
        : nextStageId === 'stage-won'
          ? 'won'
          : nextStageId === 'stage-lost'
            ? 'lost'
            : current.status;

    const updatedOpp: CrmOpportunity = {
      ...current,
      personId: updates.personId !== undefined ? updates.personId || undefined : current.personId,
      title: updates.title !== undefined ? updates.title.trim().slice(0, 200) : current.title,
      description:
        updates.description !== undefined ? updates.description?.trim().slice(0, 4000) || undefined : current.description,
      estimatedValue:
        updates.estimatedValue !== undefined && Number.isFinite(Number(updates.estimatedValue))
          ? Math.max(0, Number(updates.estimatedValue))
          : current.estimatedValue,
      currency: updates.currency ? updates.currency.toUpperCase().slice(0, 3) : current.currency,
      expectedCloseDate:
        updates.expectedCloseDate !== undefined
          ? updates.expectedCloseDate
            ? normalizeDateIso(updates.expectedCloseDate)
            : undefined
          : current.expectedCloseDate,
      pipelineStageId: nextStageId,
      probability:
        updates.probability !== undefined && Number.isFinite(Number(updates.probability))
          ? Math.min(100, Math.max(0, Number(updates.probability)))
          : current.probability,
      source: updates.source !== undefined ? updates.source?.trim().slice(0, 120) || undefined : current.source,
      nextAction: updates.nextAction !== undefined ? updates.nextAction?.trim().slice(0, 400) || undefined : current.nextAction,
      nextActionDate:
        updates.nextActionDate !== undefined
          ? updates.nextActionDate
            ? normalizeDateIso(updates.nextActionDate)
            : undefined
          : current.nextActionDate,
      notes: updates.notes !== undefined ? updates.notes?.trim().slice(0, 4000) || undefined : current.notes,
      status: nextStatus,
      winLossReason:
        updates.winLossReason !== undefined
          ? updates.winLossReason?.trim().slice(0, 500) || undefined
          : current.winLossReason,
      stageHistory,
      updatedAt: now,
    };

    list[idx] = updatedOpp;
    const openSum = list
      .filter((o) => o.status === 'open')
      .reduce((acc, o) => acc + (o.estimatedValue || 0), 0);

    await facade.upsertLead({
      ...lead,
      opportunityValue: openSum > 0 ? openSum : lead.opportunityValue,
      customFields: {
        ...(lead.customFields || {}),
        crmOpportunities: JSON.stringify(list),
      },
      updatedAt: now,
    });
    return updatedOpp;
  }

  return null;
}

export async function deleteCrmOpportunity(facade: CrmStorageFacade, id: string): Promise<boolean> {
  const leads = await facade.getLeads();
  const now = new Date().toISOString();
  for (const lead of leads) {
    const list = getLeadOpportunities(lead);
    const filtered = list.filter((o) => o.id !== id);
    if (filtered.length !== list.length) {
      await facade.upsertLead({
        ...lead,
        customFields: {
          ...(lead.customFields || {}),
          crmOpportunities: JSON.stringify(filtered),
        },
        updatedAt: now,
      });
      return true;
    }
  }
  return false;
}

// --- Extended Tasks (with Recurrence Follow-Up Support) ---

function computeNextRecurrenceDueDate(currentDueIso: string, recurrence: NonNullable<LeadTask['recurrence']>): string | null {
  if (!recurrence || recurrence.frequency === 'none') return null;
  const base = new Date(currentDueIso);
  if (Number.isNaN(base.getTime())) return null;
  const daysMap: Record<string, number> = {
    daily: 1,
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    quarterly: 90,
  };
  const stepDays = recurrence.intervalDays && recurrence.intervalDays > 0
    ? recurrence.intervalDays
    : daysMap[recurrence.frequency] || 7;
  const next = new Date(base.getTime() + stepDays * 86_400_000);
  if (recurrence.endDate) {
    const end = new Date(recurrence.endDate);
    if (!Number.isNaN(end.getTime()) && next.getTime() > end.getTime()) {
      return null;
    }
  }
  return next.toISOString();
}

export async function createExtendedTask(
  facade: CrmStorageFacade,
  input: Omit<LeadTask, 'id' | 'createdAt'>
): Promise<LeadTask> {
  const now = new Date().toISOString();
  const status: LeadTask['status'] =
    input.status && CRM_TASK_STATUS_SET.has(input.status)
      ? input.status
      : input.completed
        ? 'completed'
        : 'pending';
  const completed = status === 'completed' || Boolean(input.completed);
  const dueDate = normalizeDateIso(input.dueDate) || new Date(Date.now() + 86_400_000 * 2).toISOString();

  const created = await facade.createTask({
    leadId: input.leadId || '',
    title: input.title.trim().slice(0, 300),
    dueDate,
    priority: input.priority || 'medium',
    completed,
    assignedTo: input.assignedTo || 'Owner',
  });

  const ws = await getCrmWorkspaceState(facade);
  const meta: ExtendedTaskMetadata = {
    personId: input.personId?.trim() || undefined,
    opportunityId: input.opportunityId?.trim() || undefined,
    description: input.description?.trim().slice(0, 4000) || undefined,
    reminderDate: normalizeDateIso(input.reminderDate),
    category: input.category || 'follow_up',
    status,
    completedAt: completed ? input.completedAt || now : undefined,
    notes: input.notes?.trim().slice(0, 4000) || undefined,
    outcome: input.outcome?.trim().slice(0, 1000) || undefined,
    recurrence: input.recurrence && input.recurrence.frequency !== 'none' ? input.recurrence : undefined,
    updatedAt: now,
  };
  ws.taskMetadata[created.id] = meta;
  await saveCrmWorkspaceState(facade, ws);

  return {
    ...created,
    ...meta,
    completed,
  };
}

export async function updateExtendedTask(
  facade: CrmStorageFacade,
  id: string,
  updates: Partial<LeadTask>
): Promise<{ task: LeadTask; recurringFollowUpTask?: LeadTask } | null> {
  const all = await listAllExtendedTasks(facade);
  const existing = all.find((t) => t.id === id);
  if (!existing) return null;

  const now = new Date().toISOString();
  let nextStatus = existing.status || (existing.completed ? 'completed' : 'pending');
  let nextCompleted = existing.completed;

  if (updates.status && CRM_TASK_STATUS_SET.has(updates.status)) {
    nextStatus = updates.status;
    nextCompleted = updates.status === 'completed';
  } else if (updates.completed !== undefined) {
    nextCompleted = Boolean(updates.completed);
    nextStatus = nextCompleted ? 'completed' : nextStatus === 'completed' ? 'pending' : nextStatus;
  }

  const baseUpdated = await facade.updateTask(id, {
    title: updates.title !== undefined ? updates.title.trim().slice(0, 300) : existing.title,
    dueDate: updates.dueDate ? normalizeDateIso(updates.dueDate) || existing.dueDate : existing.dueDate,
    priority: updates.priority || existing.priority,
    completed: nextCompleted,
  });
  if (!baseUpdated) return null;

  const ws = await getCrmWorkspaceState(facade);
  const prevMeta = ws.taskMetadata[id] || {};
  const nextMeta: ExtendedTaskMetadata = {
    personId: updates.personId !== undefined ? updates.personId || undefined : prevMeta.personId,
    opportunityId:
      updates.opportunityId !== undefined ? updates.opportunityId || undefined : prevMeta.opportunityId,
    description:
      updates.description !== undefined ? updates.description?.trim().slice(0, 4000) || undefined : prevMeta.description,
    reminderDate:
      updates.reminderDate !== undefined
        ? updates.reminderDate
          ? normalizeDateIso(updates.reminderDate)
          : undefined
        : prevMeta.reminderDate,
    category: updates.category ?? prevMeta.category ?? 'follow_up',
    status: nextStatus,
    completedAt: nextCompleted ? prevMeta.completedAt || now : undefined,
    notes: updates.notes !== undefined ? updates.notes?.trim().slice(0, 4000) || undefined : prevMeta.notes,
    outcome: updates.outcome !== undefined ? updates.outcome?.trim().slice(0, 1000) || undefined : prevMeta.outcome,
    recurrence: updates.recurrence !== undefined ? updates.recurrence : prevMeta.recurrence,
    updatedAt: now,
  };
  ws.taskMetadata[id] = nextMeta;
  await saveCrmWorkspaceState(facade, ws);

  const task: LeadTask = {
    ...baseUpdated,
    ...nextMeta,
    completed: nextCompleted,
  };

  // If newly transitioned to completed and has recurrence, spawn the next scheduled follow-up task
  let recurringFollowUpTask: LeadTask | undefined;
  if (!existing.completed && nextCompleted && nextMeta.recurrence && nextMeta.recurrence.frequency !== 'none') {
    const nextDue = computeNextRecurrenceDueDate(task.dueDate, nextMeta.recurrence);
    if (nextDue) {
      recurringFollowUpTask = await createExtendedTask(facade, {
        leadId: task.leadId,
        personId: task.personId,
        opportunityId: task.opportunityId,
        title: task.title,
        description: task.description,
        dueDate: nextDue,
        priority: task.priority,
        category: task.category,
        status: 'pending',
        completed: false,
        notes: task.notes,
        recurrence: task.recurrence,
        assignedTo: task.assignedTo,
      });
    }
  }

  return { task, recurringFollowUpTask };
}

export async function deleteExtendedTask(facade: CrmStorageFacade, id: string): Promise<boolean> {
  const deleted = await facade.deleteTask(id);
  const ws = await getCrmWorkspaceState(facade);
  if (ws.taskMetadata[id]) {
    delete ws.taskMetadata[id];
    await saveCrmWorkspaceState(facade, ws);
  }
  return deleted;
}

// --- Company & Person Relationship Metadata ---

export async function updateCompanyRelationshipMeta(
  facade: CrmStorageFacade,
  leadId: string,
  updates: Partial<RelationshipMetadata>
): Promise<{ lead: CanonicalLead; relationshipMeta: RelationshipMetadata } | null> {
  const lead = await facade.getLead(leadId);
  if (!lead) return null;
  const now = new Date().toISOString();
  const current = getEntityRelationshipMeta(lead.customFields, lead.tags);
  const nextMeta: RelationshipMetadata = {
    relationshipStatus:
      updates.relationshipStatus && CRM_RELATIONSHIP_STATUS_SET.has(updates.relationshipStatus)
        ? updates.relationshipStatus
        : current.relationshipStatus,
    nextFollowUpDate:
      updates.nextFollowUpDate !== undefined
        ? updates.nextFollowUpDate
          ? normalizeDateIso(updates.nextFollowUpDate)
          : undefined
        : current.nextFollowUpDate,
    scheduledReviewDate:
      updates.scheduledReviewDate !== undefined
        ? updates.scheduledReviewDate
          ? normalizeDateIso(updates.scheduledReviewDate)
          : undefined
        : current.scheduledReviewDate,
    tags: updates.tags !== undefined ? sanitizeTags(updates.tags) : current.tags,
    ownerOverrideLevel:
      updates.ownerOverrideLevel !== undefined
        ? updates.ownerOverrideLevel || undefined
        : current.ownerOverrideLevel,
    ownerAnnotation:
      updates.ownerAnnotation !== undefined
        ? updates.ownerAnnotation?.trim().slice(0, 1000) || undefined
        : current.ownerAnnotation,
    updatedAt: now,
  };

  const savedLead = await facade.upsertLead({
    ...lead,
    tags: nextMeta.tags,
    customFields: {
      ...(lead.customFields || {}),
      crmRelationshipMeta: JSON.stringify(nextMeta),
    },
    updatedAt: now,
  });

  return { lead: savedLead, relationshipMeta: nextMeta };
}

export async function updatePersonRelationshipMeta(
  facade: CrmStorageFacade,
  personId: string,
  updates: Partial<RelationshipMetadata>
): Promise<{ person: PersonRecord; relationshipMeta: RelationshipMetadata } | null> {
  const person = await facade.getPersonById(personId);
  if (!person) return null;
  const now = new Date().toISOString();
  const current = getEntityRelationshipMeta(person.customFields);
  const nextMeta: RelationshipMetadata = {
    relationshipStatus:
      updates.relationshipStatus && CRM_RELATIONSHIP_STATUS_SET.has(updates.relationshipStatus)
        ? updates.relationshipStatus
        : current.relationshipStatus,
    nextFollowUpDate:
      updates.nextFollowUpDate !== undefined
        ? updates.nextFollowUpDate
          ? normalizeDateIso(updates.nextFollowUpDate)
          : undefined
        : current.nextFollowUpDate,
    scheduledReviewDate:
      updates.scheduledReviewDate !== undefined
        ? updates.scheduledReviewDate
          ? normalizeDateIso(updates.scheduledReviewDate)
          : undefined
        : current.scheduledReviewDate,
    tags: updates.tags !== undefined ? sanitizeTags(updates.tags) : current.tags,
    ownerOverrideLevel:
      updates.ownerOverrideLevel !== undefined
        ? updates.ownerOverrideLevel || undefined
        : current.ownerOverrideLevel,
    ownerAnnotation:
      updates.ownerAnnotation !== undefined
        ? updates.ownerAnnotation?.trim().slice(0, 1000) || undefined
        : current.ownerAnnotation,
    updatedAt: now,
  };

  const savedPerson = await facade.upsertPerson({
    ...person,
    customFields: {
      ...(person.customFields || {}),
      crmRelationshipMeta: JSON.stringify(nextMeta),
    },
    updatedAt: now,
  });

  return { person: savedPerson, relationshipMeta: nextMeta };
}

// --- Saved Views ---

export async function listSavedViews(
  facade: CrmStorageFacade,
  entityType?: 'company' | 'person'
): Promise<CrmSavedView[]> {
  const ws = await getCrmWorkspaceState(facade);
  return entityType ? ws.savedViews.filter((v) => v.entityType === entityType) : ws.savedViews;
}

export async function saveCrmView(
  facade: CrmStorageFacade,
  input: {
    id?: string;
    name: string;
    entityType: 'company' | 'person';
    description?: string;
    filters: Record<string, unknown>;
  }
): Promise<CrmSavedView> {
  const ws = await getCrmWorkspaceState(facade);
  const now = new Date().toISOString();

  if (input.id) {
    const idx = ws.savedViews.findIndex((v) => v.id === input.id);
    if (idx !== -1) {
      ws.savedViews[idx] = {
        ...ws.savedViews[idx],
        name: input.name.trim().slice(0, 120),
        description: input.description?.trim().slice(0, 300) || undefined,
        filters: input.filters || {},
        updatedAt: now,
      };
      await saveCrmWorkspaceState(facade, ws);
      return ws.savedViews[idx];
    }
  }

  const created: CrmSavedView = {
    id: generateCrmId('view'),
    name: input.name.trim().slice(0, 120),
    entityType: input.entityType,
    description: input.description?.trim().slice(0, 300) || undefined,
    filters: input.filters || {},
    createdAt: now,
    updatedAt: now,
  };
  ws.savedViews = [created, ...ws.savedViews];
  await saveCrmWorkspaceState(facade, ws);
  return created;
}

export async function deleteSavedView(facade: CrmStorageFacade, id: string): Promise<boolean> {
  const ws = await getCrmWorkspaceState(facade);
  const filtered = ws.savedViews.filter((v) => v.id !== id);
  if (filtered.length === ws.savedViews.length) return false;
  ws.savedViews = filtered;
  await saveCrmWorkspaceState(facade, ws);
  return true;
}
