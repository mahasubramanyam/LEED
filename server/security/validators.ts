import type { LeadStatus, LeadTask, OutreachCampaign } from '../types.js';

export interface ValidationOutcome<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

const LEAD_STATUSES = new Set<LeadStatus>([
  'new',
  'reviewed',
  'qualified',
  'contacted',
  'meeting_set',
  'negotiation',
  'converted',
  'lost',
  'do_not_contact',
]);

const TASK_PRIORITIES = new Set(['low', 'medium', 'high']);
const CAMPAIGN_CHANNELS = new Set(['email', 'linkedin', 'call']);
const CAMPAIGN_STATUSES = new Set(['draft', 'scheduled', 'active', 'completed', 'paused']);
const CAMPAIGN_ACTIONS = new Set(['approve', 'reject', 'send']);
const MERGE_POLICIES = new Set(['merge_preserve_crm', 'skip', 'overwrite']);

export const MAX_BATCH_IMPORT_ROWS = 2000;

export function boundedString(
  val: unknown,
  maxLen: number,
  options?: { required?: boolean; label?: string }
): ValidationOutcome<string | undefined> {
  if (val === undefined || val === null || val === '') {
    if (options?.required) {
      return { ok: false, error: `${options.label || 'Field'} is required.` };
    }
    return { ok: true, data: undefined };
  }
  if (typeof val !== 'string') {
    return { ok: false, error: `${options?.label || 'Field'} must be a string.` };
  }
  const trimmed = val.trim();
  if (!trimmed) {
    if (options?.required) {
      return { ok: false, error: `${options.label || 'Field'} is required.` };
    }
    return { ok: true, data: undefined };
  }
  if (trimmed.length > maxLen) {
    return {
      ok: false,
      error: `${options?.label || 'Field'} exceeds maximum length of ${maxLen} characters.`,
    };
  }
  return { ok: true, data: trimmed };
}

export function validateLeadCreateOrUpdate(
  body: unknown,
  mode: 'create' | 'update'
): ValidationOutcome<Record<string, any>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const src = body as Record<string, any>;
  const clean: Record<string, any> = {};

  if (mode === 'create') {
    const companyName = boundedString(src.companyName, 250, {
      required: true,
      label: 'companyName',
    });
    if (!companyName.ok) return { ok: false, error: companyName.error };
    clean.companyName = companyName.data;
  } else if (src.companyName !== undefined) {
    const companyName = boundedString(src.companyName, 250, {
      required: true,
      label: 'companyName',
    });
    if (!companyName.ok) return { ok: false, error: companyName.error };
    clean.companyName = companyName.data;
  }

  const optionalStrings: Array<[string, number]> = [
    ['legalName', 250],
    ['industry', 120],
    ['category', 120],
    ['website', 500],
    ['domain', 253],
    ['email', 254],
    ['phone', 60],
    ['phoneNormalized', 30],
    ['registrationNumber', 100],
    ['registrationType', 60],
    ['pipelineStageId', 80],
    ['lostReason', 500],
    ['currency', 10],
    ['companyStatus', 80],
    ['emailStatus', 60],
    ['employeeRange', 60],
  ];

  for (const [key, maxLen] of optionalStrings) {
    if (src[key] !== undefined) {
      if (src[key] === null) {
        clean[key] = undefined;
      } else {
        const res = boundedString(src[key], maxLen, { label: key });
        if (!res.ok) return { ok: false, error: res.error };
        clean[key] = res.data;
      }
    }
  }

  if (src.status !== undefined) {
    if (typeof src.status !== 'string' || !LEAD_STATUSES.has(src.status as LeadStatus)) {
      return { ok: false, error: 'Invalid lead status.' };
    }
    clean.status = src.status;
  }

  if (src.opportunityValue !== undefined && src.opportunityValue !== null) {
    const n = Number(src.opportunityValue);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000_000) {
      return { ok: false, error: 'opportunityValue must be a non-negative finite number.' };
    }
    clean.opportunityValue = n;
  }

  if (src.winProbability !== undefined && src.winProbability !== null) {
    const n = Number(src.winProbability);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { ok: false, error: 'winProbability must be between 0 and 100.' };
    }
    clean.winProbability = Math.round(n);
  }

  if (src.foundedYear !== undefined && src.foundedYear !== null) {
    const n = Number(src.foundedYear);
    if (!Number.isInteger(n) || n < 1600 || n > 2100) {
      return { ok: false, error: 'foundedYear must be a valid four-digit year.' };
    }
    clean.foundedYear = n;
  }

  if (src.confidenceScore !== undefined) {
    const n = Number(src.confidenceScore);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { ok: false, error: 'confidenceScore must be between 0 and 100.' };
    }
    clean.confidenceScore = Math.round(n);
  }

  if (src.tags !== undefined) {
    if (!Array.isArray(src.tags) || src.tags.length > 50) {
      return { ok: false, error: 'tags must be an array of at most 50 strings.' };
    }
    const cleanTags: string[] = [];
    for (const t of src.tags) {
      if (typeof t !== 'string' || t.length > 80) {
        return { ok: false, error: 'Each tag must be a string up to 80 characters.' };
      }
      const trimmed = t.trim();
      if (trimmed) cleanTags.push(trimmed);
    }
    clean.tags = cleanTags;
  }

  if (src.address !== undefined) {
    if (!src.address || typeof src.address !== 'object' || Array.isArray(src.address)) {
      return { ok: false, error: 'address must be an object.' };
    }
    clean.address = {
      street: typeof src.address.street === 'string' ? src.address.street.slice(0, 250) : undefined,
      city: typeof src.address.city === 'string' ? src.address.city.slice(0, 120) : undefined,
      region: typeof src.address.region === 'string' ? src.address.region.slice(0, 120) : undefined,
      postalCode: typeof src.address.postalCode === 'string' ? src.address.postalCode.slice(0, 40) : undefined,
      country: typeof src.address.country === 'string' ? src.address.country.slice(0, 120) : '',
      countryCode:
        typeof src.address.countryCode === 'string'
          ? src.address.countryCode.trim().toUpperCase().slice(0, 4)
          : '',
      formattedAddress:
        typeof src.address.formattedAddress === 'string'
          ? src.address.formattedAddress.slice(0, 400)
          : undefined,
    };
  }

  const passthroughArrays = [
    'identifiers',
    'sources',
    'confidenceSignals',
    'notes',
    'activities',
    'verificationHistory',
  ];
  for (const field of passthroughArrays) {
    if (src[field] !== undefined) {
      if (!Array.isArray(src[field]) || src[field].length > 500) {
        return { ok: false, error: `${field} must be a valid bounded array.` };
      }
      clean[field] = src[field];
    }
  }

  const passthroughObjects = ['socialLinks', 'webMetadata', 'officialVerification', 'customFields', 'coordinates'];
  for (const field of passthroughObjects) {
    if (src[field] !== undefined) {
      if (src[field] !== null && (typeof src[field] !== 'object' || Array.isArray(src[field]))) {
        return { ok: false, error: `${field} must be an object.` };
      }
      clean[field] = src[field];
    }
  }

  return { ok: true, data: clean };
}

export function validatePipelineMoveBody(body: unknown): ValidationOutcome<{
  leadId: string;
  stageId: string;
  lostReason?: string;
}> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const src = body as Record<string, unknown>;
  const leadId = boundedString(src.leadId, 120, { required: true, label: 'leadId' });
  if (!leadId.ok) return { ok: false, error: leadId.error };
  const stageId = boundedString(src.stageId, 120, { required: true, label: 'stageId' });
  if (!stageId.ok) return { ok: false, error: stageId.error };
  const lostReason = boundedString(src.lostReason, 500, { label: 'lostReason' });
  if (!lostReason.ok) return { ok: false, error: lostReason.error };

  return {
    ok: true,
    data: {
      leadId: leadId.data!,
      stageId: stageId.data!,
      lostReason: lostReason.data,
    },
  };
}

export function validateTaskCreateBody(
  body: unknown
): ValidationOutcome<{
  title: string;
  leadId: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  assignedTo?: string;
}> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const src = body as Record<string, unknown>;
  const title = boundedString(src.title, 250, { required: true, label: 'title' });
  if (!title.ok) return { ok: false, error: title.error };
  const leadId = boundedString(src.leadId, 120, { label: 'leadId' });
  if (!leadId.ok) return { ok: false, error: leadId.error };
  const dueDate = boundedString(src.dueDate, 60, { label: 'dueDate' });
  if (!dueDate.ok) return { ok: false, error: dueDate.error };
  const assignedTo = boundedString(src.assignedTo, 120, { label: 'assignedTo' });
  if (!assignedTo.ok) return { ok: false, error: assignedTo.error };

  if (src.priority !== undefined && (typeof src.priority !== 'string' || !TASK_PRIORITIES.has(src.priority))) {
    return { ok: false, error: 'priority must be low, medium, or high.' };
  }
  if (src.completed !== undefined && typeof src.completed !== 'boolean') {
    return { ok: false, error: 'completed must be a boolean.' };
  }

  const priority = (typeof src.priority === 'string' && TASK_PRIORITIES.has(src.priority)
    ? src.priority
    : 'medium') as 'low' | 'medium' | 'high';

  return {
    ok: true,
    data: {
      title: title.data!,
      leadId: leadId.data || '',
      dueDate: dueDate.data || new Date(Date.now() + 86400000).toISOString(),
      priority,
      completed: typeof src.completed === 'boolean' ? src.completed : false,
      assignedTo: assignedTo.data,
    },
  };
}

export function validateTaskUpdateBody(body: unknown): ValidationOutcome<Partial<LeadTask>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const src = body as Record<string, unknown>;
  const clean: Partial<LeadTask> = {};

  if (src.title !== undefined) {
    const t = boundedString(src.title, 250, { required: true, label: 'title' });
    if (!t.ok) return { ok: false, error: t.error };
    clean.title = t.data;
  }
  if (src.dueDate !== undefined) {
    const d = boundedString(src.dueDate, 60, { label: 'dueDate' });
    if (!d.ok) return { ok: false, error: d.error };
    clean.dueDate = d.data;
  }
  if (src.priority !== undefined) {
    if (typeof src.priority !== 'string' || !TASK_PRIORITIES.has(src.priority)) {
      return { ok: false, error: 'priority must be low, medium, or high.' };
    }
    clean.priority = src.priority as 'low' | 'medium' | 'high';
  }
  if (src.completed !== undefined) {
    if (typeof src.completed !== 'boolean') {
      return { ok: false, error: 'completed must be a boolean.' };
    }
    clean.completed = src.completed;
  }
  if (src.assignedTo !== undefined) {
    const a = boundedString(src.assignedTo, 120, { label: 'assignedTo' });
    if (!a.ok) return { ok: false, error: a.error };
    clean.assignedTo = a.data;
  }

  return { ok: true, data: clean };
}

export function validateCampaignCreateBody(
  body: unknown
): ValidationOutcome<Omit<OutreachCampaign, 'id' | 'createdAt'>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const src = body as Record<string, unknown>;
  const name = boundedString(src.name, 200, { required: true, label: 'name' });
  if (!name.ok) return { ok: false, error: name.error };
  const subjectTemplate = boundedString(src.subjectTemplate, 400, {
    required: true,
    label: 'subjectTemplate',
  });
  if (!subjectTemplate.ok) return { ok: false, error: subjectTemplate.error };
  const bodyTemplate = boundedString(src.bodyTemplate, 10000, {
    required: true,
    label: 'bodyTemplate',
  });
  if (!bodyTemplate.ok) return { ok: false, error: bodyTemplate.error };
  const targetIndustry = boundedString(src.targetIndustry, 120, { label: 'targetIndustry' });
  if (!targetIndustry.ok) return { ok: false, error: targetIndustry.error };
  const targetCountry = boundedString(src.targetCountry, 120, { label: 'targetCountry' });
  if (!targetCountry.ok) return { ok: false, error: targetCountry.error };

  if (src.channel !== undefined && (typeof src.channel !== 'string' || !CAMPAIGN_CHANNELS.has(src.channel))) {
    return { ok: false, error: 'channel must be email, linkedin, or call.' };
  }
  if (src.status !== undefined && (typeof src.status !== 'string' || !CAMPAIGN_STATUSES.has(src.status))) {
    return { ok: false, error: 'status must be draft, scheduled, active, completed, or paused.' };
  }

  const channel = (typeof src.channel === 'string' && CAMPAIGN_CHANNELS.has(src.channel)
    ? src.channel
    : 'email') as OutreachCampaign['channel'];
  const status = (typeof src.status === 'string' && CAMPAIGN_STATUSES.has(src.status)
    ? src.status
    : 'active') as OutreachCampaign['status'];

  return {
    ok: true,
    data: {
      name: name.data!,
      channel,
      subjectTemplate: subjectTemplate.data!,
      bodyTemplate: bodyTemplate.data!,
      targetIndustry: targetIndustry.data,
      targetCountry: targetCountry.data,
      status,
      messages: [],
    },
  };
}

export function validateCampaignMessageAction(
  body: unknown
): ValidationOutcome<{ action: 'approve' | 'reject' | 'send' }> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const action = (body as Record<string, unknown>).action;
  if (typeof action !== 'string' || !CAMPAIGN_ACTIONS.has(action)) {
    return { ok: false, error: 'action must be one of: approve, reject, send.' };
  }
  return { ok: true, data: { action: action as 'approve' | 'reject' | 'send' } };
}

export function validateSettingsUpdateBody(body: unknown): ValidationOutcome<Record<string, any>> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Settings payload must be a JSON object.' };
  }
  const src = body as Record<string, unknown>;
  const clean: Record<string, any> = {};

  if (src.ownerName !== undefined) {
    const r = boundedString(src.ownerName, 120, { required: true, label: 'ownerName' });
    if (!r.ok) return { ok: false, error: r.error };
    clean.ownerName = r.data;
  }
  if (src.defaultCountry !== undefined) {
    const r = boundedString(src.defaultCountry, 12, { required: true, label: 'defaultCountry' });
    if (!r.ok) return { ok: false, error: r.error };
    clean.defaultCountry = r.data!.toUpperCase();
  }
  if (src.defaultCurrency !== undefined) {
    const r = boundedString(src.defaultCurrency, 10, { required: true, label: 'defaultCurrency' });
    if (!r.ok) return { ok: false, error: r.error };
    clean.defaultCurrency = r.data!.toUpperCase();
  }
  if (src.userAgent !== undefined) {
    const r = boundedString(src.userAgent, 250, { required: true, label: 'userAgent' });
    if (!r.ok) return { ok: false, error: r.error };
    clean.userAgent = r.data;
  }
  if (src.autoDedupeThreshold !== undefined) {
    const n = Number(src.autoDedupeThreshold);
    if (!Number.isFinite(n) || n < 0.5 || n > 1.0) {
      return { ok: false, error: 'autoDedupeThreshold must be between 0.5 and 1.0.' };
    }
    clean.autoDedupeThreshold = n;
  }
  if (src.suppressionDomains !== undefined) {
    if (!Array.isArray(src.suppressionDomains) || src.suppressionDomains.length > 500) {
      return { ok: false, error: 'suppressionDomains must be an array of up to 500 domains.' };
    }
    const cleanDomains: string[] = [];
    for (const d of src.suppressionDomains) {
      if (typeof d !== 'string' || d.trim().length > 253) {
        return { ok: false, error: 'Each suppression domain must be a valid hostname string.' };
      }
      const normalized = d.trim().toLowerCase();
      if (normalized) cleanDomains.push(normalized);
    }
    clean.suppressionDomains = Array.from(new Set(cleanDomains));
  }
  if (src.companiesHouseApiKey !== undefined) {
    const r = boundedString(src.companiesHouseApiKey, 300, { label: 'companiesHouseApiKey' });
    if (!r.ok) return { ok: false, error: r.error };
    if (r.data) clean.companiesHouseApiKey = r.data;
  }

  return { ok: true, data: clean };
}

export function validateDiscoverySaveBody(body: unknown): ValidationOutcome<{
  searchId?: string;
  leadIds?: string[];
  leads?: any[];
  duplicatePolicy: 'merge_preserve_crm' | 'skip' | 'overwrite';
}> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }
  const src = body as Record<string, unknown>;
  const policy =
    typeof src.duplicatePolicy === 'string' && MERGE_POLICIES.has(src.duplicatePolicy)
      ? (src.duplicatePolicy as 'merge_preserve_crm' | 'skip' | 'overwrite')
      : 'merge_preserve_crm';

  if (src.leadIds !== undefined && (!Array.isArray(src.leadIds) || src.leadIds.length > 500)) {
    return { ok: false, error: 'leadIds must be an array of at most 500 IDs.' };
  }
  if (src.leads !== undefined && (!Array.isArray(src.leads) || src.leads.length > 500)) {
    return { ok: false, error: 'leads must be an array of at most 500 records.' };
  }

  return {
    ok: true,
    data: {
      searchId: typeof src.searchId === 'string' ? src.searchId.slice(0, 120) : undefined,
      leadIds: Array.isArray(src.leadIds) ? src.leadIds.map(String) : undefined,
      leads: Array.isArray(src.leads) ? src.leads : undefined,
      duplicatePolicy: policy,
    },
  };
}
