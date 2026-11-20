// Phase 17: Shared Pagination, Sorting & Payload Reduction Utilities
// Provides bounded, deterministic, backward-compatible server-side pagination and field projection.

export interface PaginationParams {
  isPaginated: boolean;
  page: number;
  pageSize: number;
  offset: number;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  compact: boolean;
  fields?: string[];
}

export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  boundedMaxPageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function parsePaginationParams(
  query: Record<string, unknown>,
  options: {
    defaultPageSize?: number;
    maxPageSize?: number;
    defaultSortBy?: string;
    defaultSortDir?: 'asc' | 'desc';
    allowedSortFields?: readonly string[];
  } = {}
): PaginationParams {
  const maxSize = Math.max(1, Math.min(500, options.maxPageSize ?? MAX_PAGE_SIZE));
  const defaultSize = Math.max(1, Math.min(maxSize, options.defaultPageSize ?? DEFAULT_PAGE_SIZE));

  const hasPage = query.page !== undefined && String(query.page).trim() !== '';
  const hasPageSize =
    (query.pageSize !== undefined && String(query.pageSize).trim() !== '') ||
    (query.limit !== undefined && String(query.limit).trim() !== '');
  const hasOffset = query.offset !== undefined && String(query.offset).trim() !== '';

  const isPaginated = hasPage || hasPageSize || hasOffset;

  const rawPage = hasPage ? parseInt(String(query.page), 10) : 1;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawLimitStr =
    query.pageSize !== undefined && String(query.pageSize).trim() !== ''
      ? String(query.pageSize)
      : query.limit !== undefined && String(query.limit).trim() !== ''
        ? String(query.limit)
        : '';
  const parsedLimit = rawLimitStr ? parseInt(rawLimitStr, 10) : defaultSize;
  const pageSize = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(maxSize, parsedLimit)
    : defaultSize;

  let offset = (page - 1) * pageSize;
  if (hasOffset && !hasPage) {
    const parsedOffset = parseInt(String(query.offset), 10);
    if (Number.isFinite(parsedOffset) && parsedOffset >= 0) {
      offset = parsedOffset;
    }
  }

  let sortBy = typeof query.sortBy === 'string' && query.sortBy.trim() ? query.sortBy.trim() : options.defaultSortBy;
  if (sortBy && options.allowedSortFields && !options.allowedSortFields.includes(sortBy)) {
    sortBy = options.defaultSortBy;
  }

  const rawDir = typeof query.sortDir === 'string' ? query.sortDir.trim().toLowerCase() : '';
  const sortDir: 'asc' | 'desc' =
    rawDir === 'asc' || rawDir === 'desc' ? rawDir : (options.defaultSortDir ?? 'desc');

  const compact = query.compact === 'true' || query.compact === true || query.compact === '1';

  let fields: string[] | undefined;
  if (typeof query.fields === 'string' && query.fields.trim()) {
    const parsedFields = query.fields
      .split(',')
      .map((f) => f.trim())
      .filter((f) => /^[a-zA-Z0-9_]+$/.test(f));
    if (parsedFields.length > 0) {
      fields = Array.from(new Set(parsedFields)).slice(0, 40);
    }
  }

  return {
    isPaginated,
    page: hasOffset && !hasPage ? Math.floor(offset / pageSize) + 1 : page,
    pageSize,
    offset,
    sortBy,
    sortDir,
    compact,
    fields,
  };
}

export function paginateArray<T>(
  items: T[],
  params: Pick<PaginationParams, 'page' | 'pageSize' | 'offset'>,
  maxPageSize = MAX_PAGE_SIZE
): PaginatedResult<T> {
  const total = items.length;
  const safePageSize = Math.max(1, Math.min(maxPageSize, params.pageSize));
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safeOffset = Math.max(0, params.offset);
  const sliced = items.slice(safeOffset, safeOffset + safePageSize);
  const currentPage = Math.max(1, Math.floor(safeOffset / safePageSize) + 1);

  return {
    items: sliced,
    pagination: {
      total,
      page: currentPage,
      pageSize: safePageSize,
      totalPages,
      hasNextPage: safeOffset + safePageSize < total,
      hasPrevPage: safeOffset > 0,
      boundedMaxPageSize: maxPageSize,
    },
  };
}

/**
 * Deterministic comparator with stable ID tie-breaker so pagination never drifts or duplicates rows across pages.
 */
export function stableSortBy<T extends { id?: string }>(
  items: T[],
  getValue: (item: T) => string | number | null | undefined,
  dir: 'asc' | 'desc' = 'desc'
): T[] {
  const mult = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = getValue(a);
    const vb = getValue(b);

    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb;
    } else {
      const sa = va === null || va === undefined ? '' : String(va);
      const sb = vb === null || vb === undefined ? '' : String(vb);
      cmp = sa.localeCompare(sb);
    }

    if (cmp !== 0) return cmp * mult;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

/**
 * Safe allowlisted field projection for payload reduction. Always preserves `id` if present.
 */
export function projectAllowedFields<T extends Record<string, any>>(
  item: T,
  requestedFields: string[] | undefined,
  allowedFields: readonly string[]
): Partial<T> | T {
  if (!requestedFields || requestedFields.length === 0) return item;
  const allowedSet = new Set(allowedFields);
  const out: Record<string, unknown> = {};
  if ('id' in item) out.id = item.id;
  for (const field of requestedFields) {
    if (allowedSet.has(field) && field in item) {
      out[field] = item[field];
    }
  }
  return out as Partial<T>;
}

/**
 * Compact lead projection for list views / high-volume pagination.
 * Strips large nested arrays (notes, activities, customFields, confidenceSignals) while keeping summary counts.
 */
export function toCompactLead<T extends Record<string, any>>(lead: T): Record<string, unknown> {
  return {
    id: lead.id,
    companyName: lead.companyName,
    legalName: lead.legalName,
    registrationNumber: lead.registrationNumber,
    registrationType: lead.registrationType,
    companyStatus: lead.companyStatus,
    website: lead.website,
    domain: lead.domain,
    email: lead.email,
    emailStatus: lead.emailStatus,
    phone: lead.phone,
    phoneNormalized: lead.phoneNormalized,
    address: lead.address,
    industry: lead.industry,
    category: lead.category,
    employeeRange: lead.employeeRange,
    confidenceScore: lead.confidenceScore,
    status: lead.status,
    pipelineStageId: lead.pipelineStageId,
    opportunityValue: lead.opportunityValue,
    currency: lead.currency,
    winProbability: lead.winProbability,
    tags: Array.isArray(lead.tags) ? lead.tags : [],
    sourcesCount: Array.isArray(lead.sources) ? lead.sources.length : 0,
    identifiersCount: Array.isArray(lead.identifiers) ? lead.identifiers.length : 0,
    notesCount: Array.isArray(lead.notes) ? lead.notes.length : 0,
    activitiesCount: Array.isArray(lead.activities) ? lead.activities.length : 0,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}
