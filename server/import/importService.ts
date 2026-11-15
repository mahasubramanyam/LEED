import crypto from 'node:crypto';
import {
  CanonicalLead,
  CompanyPersonRelationship,
  ColumnMappingRule,
  ImportBatchRecord,
  ImportBatchRowRecord,
  ImportDedupeClassification,
  ImportMappingTemplate,
  ImportNormalizationOptions,
  ImportPreviewRow,
  ImportRowDecisionAction,
  LinkedPersonWithRelationship,
  MappingAmbiguityWarning,
  MultiColumnMergeRule,
  ParsedImportFileSummary,
  PersonRecord,
} from '../types.js';
import { buildCsvDocument } from '../../shared/csvUtils.js';
import {
  applyTemplateToHeaders,
  detectColumnMappings,
  extractMappedRowValues,
  validateExplicitMappings,
} from './columnMapper.js';
import { classifyImportBatchDuplicates } from './dedupeClassifier.js';
import {
  ImportFileSecurityError,
  ParsedTabularData,
  parseImportFileBuffer,
} from './fileParser.js';
import { normalizeAndValidateMappedRow } from './normalizerValidator.js';

export class ImportServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, code = 'IMPORT_ERROR', statusCode = 400) {
    super(message);
    this.name = 'ImportServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface RowDecisionOverride {
  action?: ImportRowDecisionAction;
  resolveToLeadId?: string;
}

export interface ImportExecutionPlan {
  batchId: string;
  filename: string;
  fileFormat: 'csv' | 'xlsx';
  fileSizeBytes: number;
  fileSha256: string;
  worksheetName?: string;
  encodingDetected: string;
  templateId?: string;
  templateName?: string;
  options: ImportNormalizationOptions;
  actorEmail: string;
  rows: Array<
    ImportPreviewRow & {
      finalAction: ImportRowDecisionAction;
      resolveToLeadId?: string;
    }
  >;
  atomicRollbackOnError: boolean;
  simulateFailureAtRow?: number;
}

export interface ImportExecutionResult {
  batch: ImportBatchRecord;
  rows: ImportBatchRowRecord[];
}

export interface ImportStorageAdapter {
  executeImportTransaction(plan: ImportExecutionPlan): Promise<ImportExecutionResult>;
}

export interface ImportSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  parsed: ParsedTabularData;
  mappings: ColumnMappingRule[];
  mergeRules: MultiColumnMergeRule[];
  ambiguityWarnings: MappingAmbiguityWarning[];
  options: ImportNormalizationOptions;
  rowOverrides: Map<number, RowDecisionOverride>;
  lastPreviewRows?: ImportPreviewRow[];
  committedBatchId?: string;
}

export interface ImportPreviewSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  companyOnlyRows: number;
  personOnlyRows: number;
  companyAndPersonRows: number;
  emptyRows: number;
  newRecords: number;
  exactDuplicates: number;
  existingWithNewInfo: number;
  possibleDuplicates: number;
  conflicts: number;
  predictedCreatedCompanies: number;
  predictedUpdatedCompanies: number;
  predictedCreatedPersons: number;
  predictedLinkedRelationships: number;
  skippedRows: number;
}

export interface ImportPreviewResponse {
  sessionId: string;
  fileSummary: ParsedImportFileSummary;
  mappings: ColumnMappingRule[];
  mergeRules: MultiColumnMergeRule[];
  ambiguityWarnings: MappingAmbiguityWarning[];
  options: ImportNormalizationOptions;
  summary: ImportPreviewSummary;
  rows: ImportPreviewRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalFiltered: number;
    totalPages: number;
    filter: string;
  };
}

const MAX_SESSIONS = 30;
const SESSION_TTL_MS = 45 * 60 * 1000;

export class ImportService {
  private sessions = new Map<string, ImportSession>();
  private activeConfirmLock = false;

  private pruneExpiredSessions() {
    const now = Date.now();
    for (const [id, sess] of this.sessions.entries()) {
      if (now - sess.updatedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = Array.from(this.sessions.values()).sort((a, b) => a.updatedAt - b.updatedAt);
      for (let i = 0; i <= oldest.length - MAX_SESSIONS; i++) {
        this.sessions.delete(oldest[i].id);
      }
    }
  }

  public getSession(sessionId: string): ImportSession {
    this.pruneExpiredSessions();
    const sess = this.sessions.get(sessionId);
    if (!sess) {
      throw new ImportServiceError(
        'Import session not found or has expired. Please re-upload the file.',
        'SESSION_NOT_FOUND',
        404
      );
    }
    sess.updatedAt = Date.now();
    return sess;
  }

  public isConfirmInProgress(): boolean {
    return this.activeConfirmLock;
  }

  public async createSessionFromUpload(input: {
    filename: string;
    mimeType?: string;
    buffer: Buffer;
    worksheetName?: string;
    defaultCountryCode?: string;
    template?: ImportMappingTemplate | null;
  }): Promise<{
    sessionId: string;
    fileSummary: ParsedImportFileSummary;
    mappings: ColumnMappingRule[];
    mergeRules: MultiColumnMergeRule[];
    ambiguityWarnings: MappingAmbiguityWarning[];
    options: ImportNormalizationOptions;
    sampleRows: Array<{ rowNumber: number; cells: string[] }>;
  }> {
    this.pruneExpiredSessions();

    const parsed = await parseImportFileBuffer({
      filename: input.filename,
      mimeType: input.mimeType,
      buffer: input.buffer,
      worksheetName: input.worksheetName,
    });

    const detected = detectColumnMappings(parsed.headers, parsed.rows);
    const mappings = input.template
      ? applyTemplateToHeaders(parsed.headers, input.template)
      : detected.mappings;
    const mergeRules = input.template?.mergeRules?.length
      ? input.template.mergeRules
      : detected.suggestedMergeRules;
    const ambiguityWarnings = input.template
      ? validateExplicitMappings(parsed.headers, mappings, mergeRules)
      : detected.ambiguityWarnings;

    const defaultOptions: ImportNormalizationOptions = input.template?.normalizationOptions
      ? { ...input.template.normalizationOptions }
      : {
          defaultCountryCode: input.defaultCountryCode || 'US',
          dateLocale: 'ISO',
          numberLocale: 'en-US',
          duplicatePolicy: 'merge_safe',
          preserveExistingCrmFields: true,
          atomicRollbackOnError: false,
          skipRowsWithErrors: true,
        };

    const id = `imp-sess-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const session: ImportSession = {
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // CSVs do not switch worksheets; release raw file buffer immediately to minimize PII residency in RAM
      buffer: parsed.summary.format === 'xlsx' ? input.buffer : Buffer.alloc(0),
      filename: parsed.summary.filename,
      mimeType: input.mimeType,
      parsed,
      mappings,
      mergeRules,
      ambiguityWarnings,
      options: defaultOptions,
      rowOverrides: new Map(),
    };

    this.sessions.set(id, session);

    return {
      sessionId: id,
      fileSummary: parsed.summary,
      mappings,
      mergeRules,
      ambiguityWarnings,
      options: defaultOptions,
      sampleRows: parsed.rows.slice(0, 8).map((cells, idx) => ({
        rowNumber: idx + 2,
        cells,
      })),
    };
  }

  public async switchWorksheet(
    sessionId: string,
    worksheetName: string
  ): Promise<{
    sessionId: string;
    fileSummary: ParsedImportFileSummary;
    mappings: ColumnMappingRule[];
    mergeRules: MultiColumnMergeRule[];
    ambiguityWarnings: MappingAmbiguityWarning[];
    sampleRows: Array<{ rowNumber: number; cells: string[] }>;
  }> {
    const sess = this.getSession(sessionId);
    if (sess.committedBatchId) {
      throw new ImportServiceError(
        'Cannot switch worksheet after import batch has already been committed.',
        'SESSION_ALREADY_COMMITTED',
        409
      );
    }

    const parsed = await parseImportFileBuffer({
      filename: sess.filename,
      mimeType: sess.mimeType,
      buffer: sess.buffer,
      worksheetName,
    });

    const detected = detectColumnMappings(parsed.headers, parsed.rows);
    sess.parsed = parsed;
    sess.mappings = detected.mappings;
    sess.mergeRules = detected.suggestedMergeRules;
    sess.ambiguityWarnings = detected.ambiguityWarnings;
    sess.rowOverrides.clear();
    sess.lastPreviewRows = undefined;
    sess.updatedAt = Date.now();

    return {
      sessionId: sess.id,
      fileSummary: parsed.summary,
      mappings: sess.mappings,
      mergeRules: sess.mergeRules,
      ambiguityWarnings: sess.ambiguityWarnings,
      sampleRows: parsed.rows.slice(0, 8).map((cells, idx) => ({
        rowNumber: idx + 2,
        cells,
      })),
    };
  }

  public previewSession(
    sessionId: string,
    input: {
      mappings?: ColumnMappingRule[];
      mergeRules?: MultiColumnMergeRule[];
      options?: Partial<ImportNormalizationOptions>;
      rowOverrides?: Record<string, RowDecisionOverride>;
      page?: number;
      pageSize?: number;
      filter?: 'all' | 'valid' | 'errors' | 'duplicates' | 'conflicts' | 'new' | 'updates' | 'persons';
      existingLeads: CanonicalLead[];
      existingPersons: PersonRecord[];
      existingRelationships: CompanyPersonRelationship[];
    }
  ): ImportPreviewResponse {
    const sess = this.getSession(sessionId);

    if (Array.isArray(input.mappings)) {
      sess.mappings = input.mappings.map((m) => ({
        sourceColumnIndex: Number(m.sourceColumnIndex),
        sourceHeader: String(m.sourceHeader || sess.parsed.headers[m.sourceColumnIndex] || ''),
        targetField: m.targetField || 'ignore',
        confidence: m.confidence ?? 1,
        autoDetected: false,
      }));
    }

    if (Array.isArray(input.mergeRules)) {
      sess.mergeRules = input.mergeRules;
    }

    if (input.options && typeof input.options === 'object') {
      sess.options = {
        ...sess.options,
        ...input.options,
        preserveExistingCrmFields: true,
      };
    }

    if (input.rowOverrides && typeof input.rowOverrides === 'object') {
      for (const [rowKey, ov] of Object.entries(input.rowOverrides)) {
        const rn = parseInt(rowKey, 10);
        if (Number.isFinite(rn) && ov && typeof ov === 'object') {
          sess.rowOverrides.set(rn, {
            action: ov.action,
            resolveToLeadId: ov.resolveToLeadId,
          });
        }
      }
    }

    const ambiguityWarnings = validateExplicitMappings(sess.parsed.headers, sess.mappings, sess.mergeRules);
    sess.ambiguityWarnings = ambiguityWarnings;

    // 1. Extract & normalize each row (zero database writes!)
    const normalizedRows = sess.parsed.rows.map((cells, idx) => {
      const rowNumber = idx + 2; // 1-based accounting for header row at 1
      const { rawData, fields, customFields } = extractMappedRowValues(
        sess.parsed.headers,
        cells,
        sess.mappings,
        sess.mergeRules
      );

      const norm = normalizeAndValidateMappedRow({
        rowNumber,
        fields,
        customFields,
        options: sess.options,
      });

      return {
        rowNumber,
        rawData,
        ...norm,
      };
    });

    // 2. Deduplicate against intra-file & CRM companies, persons, and M:N relationships
    const { dedupeByRow, recommendedActionByRow, changesSummaryByRow } = classifyImportBatchDuplicates(
      normalizedRows,
      {
        existingLeads: input.existingLeads,
        existingPersons: input.existingPersons,
        existingRelationships: input.existingRelationships,
        options: sess.options,
      }
    );

    const previewRows: ImportPreviewRow[] = normalizedRows.map((row) => {
      const dedupe = dedupeByRow.get(row.rowNumber)!;
      const override = sess.rowOverrides.get(row.rowNumber);
      const recommended = recommendedActionByRow.get(row.rowNumber) || 'skip';
      const proposedAction = row.valid ? override?.action || recommended : 'skip';
      const changesSummary = [...(changesSummaryByRow.get(row.rowNumber) || [])];

      if (override?.resolveToLeadId && override.action === 'update_existing') {
        const resolvedLead = input.existingLeads.find((l) => l.id === override.resolveToLeadId);
        if (resolvedLead) {
          dedupe.matchedCrmLeadId = resolvedLead.id;
          dedupe.matchedCrmLeadName = resolvedLead.companyName;
          changesSummary.push(`Owner override: link/merge safely into "${resolvedLead.companyName}"`);
        }
      } else if (override?.action && override.action !== recommended) {
        changesSummary.push(`Owner decision override: ${override.action}`);
      }

      return {
        rowNumber: row.rowNumber,
        importKind: row.importKind,
        rawData: row.rawData,
        company: row.company,
        person: row.person,
        errors: row.errors,
        warnings: row.warnings,
        valid: row.valid,
        dedupe,
        proposedAction,
        changesSummary,
      };
    });

    sess.lastPreviewRows = previewRows;
    sess.updatedAt = Date.now();

    // 3. Build summary predictions
    const newCompanyGroupKeys = new Set<string>();
    const updatedLeadIds = new Set<string>();
    let predictedCreatedPersons = 0;
    let predictedLinkedRelationships = 0;

    let validRows = 0;
    let invalidRows = 0;
    let companyOnlyRows = 0;
    let personOnlyRows = 0;
    let companyAndPersonRows = 0;
    let emptyRows = 0;
    let newRecords = 0;
    let exactDuplicates = 0;
    let existingWithNewInfo = 0;
    let possibleDuplicates = 0;
    let conflicts = 0;
    let skippedRows = 0;

    for (const r of previewRows) {
      if (r.valid) validRows++;
      else invalidRows++;

      if (r.importKind === 'company_only') companyOnlyRows++;
      else if (r.importKind === 'person_only') personOnlyRows++;
      else if (r.importKind === 'company_and_person') companyAndPersonRows++;
      else emptyRows++;

      switch (r.dedupe.classification) {
        case 'new_record':
          newRecords++;
          break;
        case 'exact_crm_duplicate':
          exactDuplicates++;
          break;
        case 'existing_with_new_info':
          existingWithNewInfo++;
          break;
        case 'possible_duplicate':
          possibleDuplicates++;
          break;
        case 'conflicting_identity':
          conflicts++;
          break;
      }

      if (r.proposedAction === 'skip' || r.proposedAction === 'needs_review') {
        skippedRows++;
      } else if (r.proposedAction === 'create_new' && r.company) {
        const gKey = r.dedupe.inFileCompanyGroupKey || `row:${r.rowNumber}`;
        newCompanyGroupKeys.add(gKey);
        if (r.person) {
          if (!r.dedupe.matchedPersonId) predictedCreatedPersons++;
          predictedLinkedRelationships++;
        }
      } else if (r.proposedAction === 'update_existing' && r.dedupe.matchedCrmLeadId) {
        updatedLeadIds.add(r.dedupe.matchedCrmLeadId);
        if (r.person) {
          if (!r.dedupe.matchedPersonId) predictedCreatedPersons++;
          if (!r.dedupe.matchedRelationshipId) predictedLinkedRelationships++;
        }
      } else if (r.proposedAction === 'link_person_only' && r.person) {
        if (!r.dedupe.matchedPersonId) predictedCreatedPersons++;
        if (r.dedupe.matchedCrmLeadId && !r.dedupe.matchedRelationshipId) {
          predictedLinkedRelationships++;
        }
      }
    }

    const summary: ImportPreviewSummary = {
      totalRows: previewRows.length,
      validRows,
      invalidRows,
      companyOnlyRows,
      personOnlyRows,
      companyAndPersonRows,
      emptyRows,
      newRecords,
      exactDuplicates,
      existingWithNewInfo,
      possibleDuplicates,
      conflicts,
      predictedCreatedCompanies: newCompanyGroupKeys.size,
      predictedUpdatedCompanies: updatedLeadIds.size,
      predictedCreatedPersons,
      predictedLinkedRelationships,
      skippedRows,
    };

    // 4. Filter & paginate preview response
    const activeFilter = input.filter || 'all';
    const filtered = previewRows.filter((row) => {
      switch (activeFilter) {
        case 'valid':
          return row.valid;
        case 'errors':
          return !row.valid || row.errors.length > 0;
        case 'duplicates':
          return (
            row.dedupe.classification === 'exact_crm_duplicate' ||
            row.dedupe.classification === 'possible_duplicate'
          );
        case 'conflicts':
          return row.dedupe.classification === 'conflicting_identity';
        case 'new':
          return row.dedupe.classification === 'new_record' && row.valid;
        case 'updates':
          return row.dedupe.classification === 'existing_with_new_info';
        case 'persons':
          return Boolean(row.person);
        default:
          return true;
      }
    });

    const pageSize = Math.max(1, Math.min(200, input.pageSize || 50));
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const page = Math.max(1, Math.min(totalPages, input.page || 1));
    const start = (page - 1) * pageSize;

    return {
      sessionId: sess.id,
      fileSummary: sess.parsed.summary,
      mappings: sess.mappings,
      mergeRules: sess.mergeRules,
      ambiguityWarnings,
      options: sess.options,
      summary,
      rows: filtered.slice(start, start + pageSize),
      pagination: {
        page,
        pageSize,
        totalFiltered: filtered.length,
        totalPages,
        filter: activeFilter,
      },
    };
  }

  public async confirmSessionImport(
    sessionId: string,
    input: {
      confirm: boolean;
      actorEmail: string;
      rowOverrides?: Record<string, RowDecisionOverride>;
      templateId?: string;
      templateName?: string;
      atomicRollbackOnError?: boolean;
      simulateFailureAtRow?: number;
      storageAdapter: ImportStorageAdapter;
      existingLeads: CanonicalLead[];
      existingPersons: PersonRecord[];
      existingRelationships: CompanyPersonRelationship[];
    }
  ): Promise<ImportExecutionResult> {
    if (input.confirm !== true) {
      throw new ImportServiceError(
        'Explicit confirmation (confirm: true) is required after reviewing preview before saving to CRM.',
        'CONFIRMATION_REQUIRED',
        400
      );
    }

    const sess = this.getSession(sessionId);

    if (sess.committedBatchId) {
      throw new ImportServiceError(
        `This import session has already been committed as batch "${sess.committedBatchId}". Re-upload or start a new session to import again.`,
        'ALREADY_COMMITTED',
        409
      );
    }

    if (this.activeConfirmLock) {
      throw new ImportServiceError(
        'Another import batch transaction is currently executing. Please wait until it finishes before starting another import.',
        'IMPORT_CONCURRENCY_LOCKED',
        409
      );
    }

    this.activeConfirmLock = true;
    try {
      // Ensure latest preview computation with any final rowOverrides applied
      this.previewSession(sessionId, {
        rowOverrides: input.rowOverrides,
        existingLeads: input.existingLeads,
        existingPersons: input.existingPersons,
        existingRelationships: input.existingRelationships,
      });

      const previewRows = sess.lastPreviewRows || [];
      const atomicRollback =
        typeof input.atomicRollbackOnError === 'boolean'
          ? input.atomicRollbackOnError
          : sess.options.atomicRollbackOnError;

      const batchId = `imp-batch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const plan: ImportExecutionPlan = {
        batchId,
        filename: sess.filename,
        fileFormat: sess.parsed.summary.format,
        fileSizeBytes: sess.parsed.summary.fileSizeBytes,
        fileSha256: sess.parsed.summary.fileSha256,
        worksheetName: sess.parsed.summary.selectedWorksheet,
        encodingDetected: sess.parsed.summary.encodingDetected,
        templateId: input.templateId,
        templateName: input.templateName,
        options: sess.options,
        actorEmail: input.actorEmail,
        atomicRollbackOnError: atomicRollback,
        simulateFailureAtRow: input.simulateFailureAtRow,
        rows: previewRows.map((r) => {
          const ov = sess.rowOverrides.get(r.rowNumber);
          return {
            ...r,
            finalAction: r.proposedAction,
            resolveToLeadId: ov?.resolveToLeadId,
          };
        }),
      };

      const result = await input.storageAdapter.executeImportTransaction(plan);
      if (result.batch.status !== 'rolled_back') {
        sess.committedBatchId = result.batch.id;
        sess.buffer = Buffer.alloc(0);
      }
      sess.updatedAt = Date.now();
      return result;
    } finally {
      this.activeConfirmLock = false;
    }
  }

  public buildFailedRowsCsv(rows: ImportBatchRowRecord[]): string {
    const failed = rows.filter(
      (r) => r.outcome === 'failed' || r.outcome === 'conflict' || r.errors.length > 0
    );
    const rawHeaderSet = new Set<string>();
    for (const row of failed) {
      for (const k of Object.keys(row.rawData || {})) {
        rawHeaderSet.add(k);
      }
    }
    const rawHeaders = Array.from(rawHeaderSet);
    const headers = [
      'Row Number',
      'Outcome',
      'Dedupe Classification',
      'Error Summary',
      ...rawHeaders,
    ];
    const dataRows = failed.map((r) => {
      const errSummary =
        r.errors.map((e) => `${e.field}: ${e.message}`).join(' | ') ||
        (r.outcome === 'conflict' ? 'Identity conflict requires manual resolution' : r.actionTaken);
      return [
        r.rowNumber,
        r.outcome,
        r.dedupeClassification,
        errSummary,
        ...rawHeaders.map((h) => r.rawData?.[h] ?? ''),
      ];
    });
    return buildCsvDocument(headers, dataRows, true);
  }

  public buildValidationErrorsCsv(rows: ImportBatchRowRecord[]): string {
    const headers = [
      'Row Number',
      'Company Name',
      'Person Name',
      'Outcome',
      'Severity',
      'Field',
      'Code',
      'Message',
      'Raw Value',
    ];
    const outRows: unknown[][] = [];
    for (const r of rows) {
      for (const issue of [...(r.errors || []), ...(r.warnings || [])]) {
        outRows.push([
          r.rowNumber,
          r.companyName || '',
          r.personName || '',
          r.outcome,
          issue.severity,
          issue.field,
          issue.code,
          issue.message,
          issue.rawValue || '',
        ]);
      }
    }
    return buildCsvDocument(headers, outRows, true);
  }

  public buildBatchSummaryCsv(batch: ImportBatchRecord, rows: ImportBatchRowRecord[]): string {
    const headers = [
      'Batch ID',
      'Filename',
      'Status',
      'Row Number',
      'Company Name',
      'Person Name',
      'Classification',
      'Action Taken',
      'Outcome',
      'Persisted Lead ID',
      'Persisted Person ID',
      'Persisted Relationship ID',
      'Error Count',
      'Warning Count',
    ];
    const dataRows = rows.map((r) => [
      batch.id,
      batch.filename,
      batch.status,
      r.rowNumber,
      r.companyName || '',
      r.personName || '',
      r.dedupeClassification as ImportDedupeClassification,
      r.actionTaken,
      r.outcome,
      r.persistedLeadId || '',
      r.persistedPersonId || '',
      r.persistedRelationshipId || '',
      r.errors?.length || 0,
      r.warnings?.length || 0,
    ]);
    return buildCsvDocument(headers, dataRows, true);
  }
}

export const importService = new ImportService();
export { ImportFileSecurityError };
