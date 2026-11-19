// Phase 14: Dual-Storage Persistence Helper for AI Sales Agent State
// Stores ownerSalesGoals, icpProfiles, conversations, actionProposals, savedDrafts,
// and savedReports under internal '__ai_sales_agent_v1' key in app_settings.connector_configs JSONB.
// Works seamlessly across BOTH PostgreSQL and JSON StorageManager with zero new SQL DDL migrations.

import crypto from 'crypto';
import type {
  AiActionProposal,
  AiAgentConversation,
  AiCommunicationDraft,
  AiContextScope,
  AiWorkspaceState,
  IcpProfile,
  OwnerSalesGoals,
} from '../types.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';

export const AI_WORKSPACE_SETTINGS_KEY = '__ai_sales_agent_v1';

export function generateAiId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function cleanStringList(input: unknown, maxItems = 30, maxLen = 100): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    const cleaned = String(item || '').trim().slice(0, maxLen);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

export function getDefaultOwnerSalesGoals(): OwnerSalesGoals {
  return {
    businessName: '',
    valueProposition: '',
    productsAndServices: [],
    targetRegions: [],
    preferredDealSize: '',
    salesPriorities: [],
    communicationStyle: 'consultative',
    updatedAt: new Date().toISOString(),
  };
}

export async function getAiWorkspaceState(facade: CrmStorageFacade): Promise<AiWorkspaceState> {
  const settings = await facade.getSettings();
  const rawMap = (settings.connectorConfigs || {}) as Record<string, unknown>;
  const raw = rawMap[AI_WORKSPACE_SETTINGS_KEY] as Partial<AiWorkspaceState> | undefined;

  return {
    version: 1,
    ownerSalesGoals:
      raw?.ownerSalesGoals && typeof raw.ownerSalesGoals === 'object'
        ? {
            ...getDefaultOwnerSalesGoals(),
            ...raw.ownerSalesGoals,
            productsAndServices: cleanStringList(raw.ownerSalesGoals.productsAndServices),
            targetRegions: cleanStringList(raw.ownerSalesGoals.targetRegions),
            salesPriorities: cleanStringList(raw.ownerSalesGoals.salesPriorities),
          }
        : getDefaultOwnerSalesGoals(),
    icpProfiles: Array.isArray(raw?.icpProfiles) ? raw.icpProfiles : [],
    conversations: Array.isArray(raw?.conversations) ? raw.conversations : [],
    actionProposals: Array.isArray(raw?.actionProposals) ? raw.actionProposals : [],
    savedDrafts: Array.isArray(raw?.savedDrafts) ? raw.savedDrafts : [],
    savedReports: Array.isArray(raw?.savedReports) ? raw.savedReports : [],
    updatedAt: raw?.updatedAt || new Date().toISOString(),
  };
}

export async function saveAiWorkspaceState(
  facade: CrmStorageFacade,
  next: AiWorkspaceState
): Promise<AiWorkspaceState> {
  const stamped: AiWorkspaceState = {
    ...next,
    version: 1,
    conversations: next.conversations.slice(0, 40),
    actionProposals: next.actionProposals.slice(0, 150),
    savedDrafts: next.savedDrafts.slice(0, 80),
    savedReports: next.savedReports.slice(0, 80),
    updatedAt: new Date().toISOString(),
  };
  await facade.updateSettings({
    connectorConfigs: {
      [AI_WORKSPACE_SETTINGS_KEY]: stamped as any,
    },
  });
  return stamped;
}

// --- Owner Sales Goals ---

export async function updateOwnerSalesGoals(
  facade: CrmStorageFacade,
  updates: Partial<OwnerSalesGoals>
): Promise<OwnerSalesGoals> {
  const ws = await getAiWorkspaceState(facade);
  const nextGoals: OwnerSalesGoals = {
    businessName:
      updates.businessName !== undefined
        ? String(updates.businessName || '').trim().slice(0, 160)
        : ws.ownerSalesGoals.businessName,
    valueProposition:
      updates.valueProposition !== undefined
        ? String(updates.valueProposition || '').trim().slice(0, 1500)
        : ws.ownerSalesGoals.valueProposition,
    productsAndServices:
      updates.productsAndServices !== undefined
        ? cleanStringList(updates.productsAndServices, 25, 120)
        : ws.ownerSalesGoals.productsAndServices,
    targetRegions:
      updates.targetRegions !== undefined
        ? cleanStringList(updates.targetRegions, 25, 80)
        : ws.ownerSalesGoals.targetRegions,
    preferredDealSize:
      updates.preferredDealSize !== undefined
        ? String(updates.preferredDealSize || '').trim().slice(0, 120)
        : ws.ownerSalesGoals.preferredDealSize,
    salesPriorities:
      updates.salesPriorities !== undefined
        ? cleanStringList(updates.salesPriorities, 20, 160)
        : ws.ownerSalesGoals.salesPriorities,
    communicationStyle: updates.communicationStyle || ws.ownerSalesGoals.communicationStyle || 'consultative',
    updatedAt: new Date().toISOString(),
  };
  ws.ownerSalesGoals = nextGoals;
  await saveAiWorkspaceState(facade, ws);
  return nextGoals;
}

// --- Ideal Customer Profiles (Multi-ICP Support) ---

export async function listIcpProfiles(facade: CrmStorageFacade): Promise<IcpProfile[]> {
  const ws = await getAiWorkspaceState(facade);
  return ws.icpProfiles;
}

export async function upsertIcpProfile(
  facade: CrmStorageFacade,
  input: Partial<IcpProfile> & { name: string }
): Promise<IcpProfile> {
  const ws = await getAiWorkspaceState(facade);
  const now = new Date().toISOString();
  const isDefault = Boolean(input.isDefault) || ws.icpProfiles.length === 0;

  if (isDefault) {
    ws.icpProfiles = ws.icpProfiles.map((p) => ({ ...p, isDefault: false }));
  }

  const normalizedFields = {
    name: input.name.trim().slice(0, 120),
    description: input.description?.trim().slice(0, 600) || undefined,
    isDefault,
    targetIndustries: cleanStringList(input.targetIndustries, 30, 80),
    excludedIndustries: cleanStringList(input.excludedIndustries, 30, 80),
    targetCountries: cleanStringList(input.targetCountries, 40, 60).map((c) => c.toUpperCase()),
    targetBusinessTypes: cleanStringList(input.targetBusinessTypes, 20, 60),
    preferredKeywords: cleanStringList(input.preferredKeywords, 35, 80),
    targetDecisionMakerRoles: cleanStringList(input.targetDecisionMakerRoles, 25, 80),
    minDataQualityScore:
      input.minDataQualityScore !== undefined && Number.isFinite(Number(input.minDataQualityScore))
        ? Math.min(100, Math.max(0, Number(input.minDataQualityScore)))
        : undefined,
    minConfidenceScore:
      input.minConfidenceScore !== undefined && Number.isFinite(Number(input.minConfidenceScore))
        ? Math.min(100, Math.max(0, Number(input.minConfidenceScore)))
        : undefined,
    requireVerifiedContact: Boolean(input.requireVerifiedContact),
    requireWebsite: Boolean(input.requireWebsite),
    preferredSizeNotes: input.preferredSizeNotes?.trim().slice(0, 300) || undefined,
    strategicNotes: input.strategicNotes?.trim().slice(0, 1200) || undefined,
  };

  if (input.id) {
    const idx = ws.icpProfiles.findIndex((p) => p.id === input.id);
    if (idx !== -1) {
      const updated: IcpProfile = {
        ...ws.icpProfiles[idx],
        ...normalizedFields,
        updatedAt: now,
      };
      ws.icpProfiles[idx] = updated;
      if (!ws.icpProfiles.some((p) => p.isDefault) && ws.icpProfiles.length > 0) {
        ws.icpProfiles[0].isDefault = true;
      }
      await saveAiWorkspaceState(facade, ws);
      return updated;
    }
  }

  const created: IcpProfile = {
    id: generateAiId('icp'),
    ...normalizedFields,
    createdAt: now,
    updatedAt: now,
  };
  ws.icpProfiles = [created, ...ws.icpProfiles];
  await saveAiWorkspaceState(facade, ws);
  return created;
}

export async function deleteIcpProfile(facade: CrmStorageFacade, id: string): Promise<boolean> {
  const ws = await getAiWorkspaceState(facade);
  const filtered = ws.icpProfiles.filter((p) => p.id !== id);
  if (filtered.length === ws.icpProfiles.length) return false;
  if (filtered.length > 0 && !filtered.some((p) => p.isDefault)) {
    filtered[0].isDefault = true;
  }
  ws.icpProfiles = filtered;
  await saveAiWorkspaceState(facade, ws);
  return true;
}

// --- Conversations ---

export async function listAiConversations(facade: CrmStorageFacade): Promise<AiAgentConversation[]> {
  const ws = await getAiWorkspaceState(facade);
  return [...ws.conversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function createAiConversation(
  facade: CrmStorageFacade,
  input: { title?: string; contextScope: AiContextScope }
): Promise<AiAgentConversation> {
  const ws = await getAiWorkspaceState(facade);
  const now = new Date().toISOString();
  const conv: AiAgentConversation = {
    id: generateAiId('conv'),
    title: (input.title || 'New Sales Strategy Session').trim().slice(0, 140),
    contextScope: {
      scopeType: input.contextScope.scopeType || 'portfolio',
      leadId: input.contextScope.leadId || undefined,
      personId: input.contextScope.personId || undefined,
      opportunityId: input.contextScope.opportunityId || undefined,
      leadIds: Array.isArray(input.contextScope.leadIds) ? input.contextScope.leadIds.slice(0, 20) : undefined,
      includePrivateNotes: Boolean(input.contextScope.includePrivateNotes),
    },
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  ws.conversations = [conv, ...ws.conversations];
  await saveAiWorkspaceState(facade, ws);
  return conv;
}

export async function saveAiConversation(
  facade: CrmStorageFacade,
  conversation: AiAgentConversation
): Promise<AiAgentConversation> {
  const ws = await getAiWorkspaceState(facade);
  const now = new Date().toISOString();
  const trimmed: AiAgentConversation = {
    ...conversation,
    messages: conversation.messages.slice(-50),
    updatedAt: now,
  };
  const idx = ws.conversations.findIndex((c) => c.id === trimmed.id);
  if (idx !== -1) {
    ws.conversations[idx] = trimmed;
  } else {
    ws.conversations = [trimmed, ...ws.conversations];
  }
  await saveAiWorkspaceState(facade, ws);
  return trimmed;
}

export async function deleteAiConversation(facade: CrmStorageFacade, id: string): Promise<boolean> {
  const ws = await getAiWorkspaceState(facade);
  const filtered = ws.conversations.filter((c) => c.id !== id);
  if (filtered.length === ws.conversations.length) return false;
  ws.conversations = filtered;
  await saveAiWorkspaceState(facade, ws);
  return true;
}

// --- Action Proposals (Owner Approval Queue) ---

export async function listAiActionProposals(
  facade: CrmStorageFacade,
  statusFilter?: AiActionProposal['status'] | 'all'
): Promise<AiActionProposal[]> {
  const ws = await getAiWorkspaceState(facade);
  let list = [...ws.actionProposals];
  if (statusFilter && statusFilter !== 'all') {
    list = list.filter((a) => a.status === statusFilter);
  }
  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return list;
}

export async function addAiActionProposals(
  facade: CrmStorageFacade,
  proposals: AiActionProposal[]
): Promise<AiActionProposal[]> {
  if (!proposals.length) return [];
  const ws = await getAiWorkspaceState(facade);
  ws.actionProposals = [...proposals, ...ws.actionProposals];
  await saveAiWorkspaceState(facade, ws);
  return proposals;
}

export async function updateAiActionProposal(
  facade: CrmStorageFacade,
  id: string,
  updates: Partial<AiActionProposal>
): Promise<AiActionProposal | null> {
  const ws = await getAiWorkspaceState(facade);
  const idx = ws.actionProposals.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  ws.actionProposals[idx] = {
    ...ws.actionProposals[idx],
    ...updates,
  };
  await saveAiWorkspaceState(facade, ws);
  return ws.actionProposals[idx];
}

// --- Drafts & Reports History ---

export async function saveCommunicationDraft(
  facade: CrmStorageFacade,
  draft: AiCommunicationDraft
): Promise<AiCommunicationDraft> {
  const ws = await getAiWorkspaceState(facade);
  ws.savedDrafts = [draft, ...ws.savedDrafts.filter((d) => d.id !== draft.id)];
  await saveAiWorkspaceState(facade, ws);
  return draft;
}

export async function listSavedDrafts(
  facade: CrmStorageFacade,
  filters?: { leadId?: string; personId?: string }
): Promise<AiCommunicationDraft[]> {
  const ws = await getAiWorkspaceState(facade);
  let list = [...ws.savedDrafts];
  if (filters?.leadId) list = list.filter((d) => d.leadId === filters.leadId);
  if (filters?.personId) list = list.filter((d) => d.personId === filters.personId);
  return list;
}

export async function recordSavedReportSummary(
  facade: CrmStorageFacade,
  entry: AiWorkspaceState['savedReports'][number]
): Promise<void> {
  const ws = await getAiWorkspaceState(facade);
  ws.savedReports = [entry, ...ws.savedReports.filter((r) => r.id !== entry.id)];
  await saveAiWorkspaceState(facade, ws);
}
