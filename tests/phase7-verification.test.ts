import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';

import {
  parseImportFileBuffer,
  ImportFileSecurityError,
  sanitizeImportFilename,
} from '../server/import/fileParser.js';
import {
  detectColumnMappings,
  extractMappedRowValues,
  validateExplicitMappings,
  applyTemplateToHeaders,
} from '../server/import/columnMapper.js';
import {
  parseLocaleNumericAmount,
  parseLocaleDateToIso,
  normalizeAndValidateMappedRow,
} from '../server/import/normalizerValidator.js';
import { classifyImportBatchDuplicates, findMatchingPerson } from '../server/import/dedupeClassifier.js';
import {
  buildCanonicalLeadFromImport,
  safelyMergeImportedCompanyIntoLead,
} from '../server/import/crmMergeHelper.js';
import { ImportService, ImportServiceError } from '../server/import/importService.js';
import { StorageManager } from '../server/storage.js';
import { escapeCsvCell } from '../shared/csvUtils.js';
import { CanonicalLead, ImportMappingTemplate } from '../server/types.js';

const tempDirs: string[] = [];

function createTempStore(): { storage: StorageManager; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-phase7-test-'));
  tempDirs.push(dir);
  const dbPath = path.join(dir, 'pipeline_store.json');
  const storage = new StorageManager(dbPath);
  return { storage, dir };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

function makeExistingLead(overrides: Partial<CanonicalLead> = {}): CanonicalLead {
  const now = '2026-01-15T10:00:00.000Z';
  return {
    id: 'crm-lead-existing-1',
    companyName: 'Nordic Maritime Systems AS',
    legalName: 'Nordic Maritime Systems AS',
    registrationNumber: '974760673',
    registrationType: 'NO_ORG',
    companyStatus: 'active',
    website: 'https://nordicmaritime.no',
    domain: 'nordicmaritime.no',
    industry: 'Maritime Technology',
    category: 'B2B Marine',
    confidenceScore: 88,
    confidenceSignals: ['Verified via Brønnøysundregistrene'],
    sources: [
      {
        sourceName: 'Brønnøysundregistrene',
        providerId: '974760673',
        retrievedAt: now,
      },
    ],
    identifiers: [
      {
        id: 'id-no-1',
        type: 'NO_ORG',
        value: '974760673',
        normalizedValue: '974760673',
        countryCode: 'NO',
        status: 'officially_verified',
        verified: true,
        source: 'brreg',
      },
    ],
    status: 'negotiation',
    pipelineStageId: 'stage-proposal',
    opportunityValue: 185000,
    currency: 'NOK',
    winProbability: 75,
    tags: ['enterprise', 'vip'],
    notes: [
      {
        id: 'note-crm-1',
        content: 'Existing CFO alignment note - must never be overwritten.',
        createdAt: now,
        author: 'owner@leed.local',
      },
    ],
    activities: [],
    address: {
      city: 'Oslo',
      postalCode: '0154',
      country: 'Norway',
      countryCode: 'NO',
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Phase 7 — File Security & CSV/Excel Parsing', () => {
  it('parses UTF-8, UTF-8-BOM, semicolon delimiters, and UTF-16LE CSV safely', async () => {
    const semiCsv = 'Company Name;Country Code;Phone\n"Fjord Energy AS";NO;"22 34 56 78"\n';
    const bomBuffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(semiCsv, 'utf8')]);
    const parsedBom = await parseImportFileBuffer({
      filename: 'nordic_leads.csv',
      mimeType: 'text/csv',
      buffer: bomBuffer,
    });
    assert.equal(parsedBom.summary.format, 'csv');
    assert.equal(parsedBom.summary.encodingDetected, 'UTF-8-BOM');
    assert.equal(parsedBom.summary.delimiterDetected, ';');
    assert.deepEqual(parsedBom.headers, ['Company Name', 'Country Code', 'Phone']);
    assert.equal(parsedBom.rows[0][0], 'Fjord Energy AS');

    const utf16Content = 'Company Name,Website\n"Alpine AG",https://alpine.ch\n';
    const utf16Buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(utf16Content, 'utf16le')]);
    const parsed16 = await parseImportFileBuffer({
      filename: 'swiss.csv',
      buffer: utf16Buf,
    });
    assert.equal(parsed16.summary.encodingDetected, 'UTF-16LE');
    assert.equal(parsed16.rows[0][0], 'Alpine AG');
  });

  it('builds and parses multi-worksheet .xlsx workbooks and extracts cached formula results without evaluation', async () => {
    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet('Companies');
    ws1.addRow(['Company Name', 'Country', 'Opportunity Value']);
    ws1.addRow(['Thames Robotics Ltd', 'GB', 95000]);

    const ws2 = wb.addWorksheet('DecisionMakers');
    ws2.addRow(['Person Full Name', 'Associated Company Name', 'Job Title', 'FormulaCached']);
    ws2.addRow([
      'Clara Vance',
      'Thames Robotics Ltd',
      'VP Procurement',
      { formula: '1+1', result: 2 },
    ]);

    const rawBuffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);

    const parsedSheet1 = await parseImportFileBuffer({
      filename: 'multi_sheet.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: rawBuffer,
    });
    assert.equal(parsedSheet1.summary.format, 'xlsx');
    assert.equal(parsedSheet1.summary.worksheets.length, 2);
    assert.equal(parsedSheet1.summary.selectedWorksheet, 'Companies');
    assert.equal(parsedSheet1.rows[0][0], 'Thames Robotics Ltd');

    const parsedSheet2 = await parseImportFileBuffer({
      filename: 'multi_sheet.xlsx',
      buffer: rawBuffer,
      worksheetName: 'DecisionMakers',
    });
    assert.equal(parsedSheet2.summary.selectedWorksheet, 'DecisionMakers');
    assert.equal(parsedSheet2.rows[0][0], 'Clara Vance');
    assert.equal(parsedSheet2.rows[0][3], '2');
  });

  it('blocks macro-enabled formats, path traversal, disguised executables, and binary CSV payloads', async () => {
    assert.throws(
      () => sanitizeImportFilename('../../etc/passwd.csv'),
      (err: unknown) => err instanceof ImportFileSecurityError && err.code === 'PATH_TRAVERSAL'
    );

    await assert.rejects(
      () =>
        parseImportFileBuffer({
          filename: 'macro_book.xlsm',
          buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]),
        }),
      (err: unknown) => err instanceof ImportFileSecurityError && err.code === 'UNSAFE_MACRO_FORMAT'
    );

    await assert.rejects(
      () =>
        parseImportFileBuffer({
          filename: 'payload.csv',
          buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]), // PE MZ header
        }),
      (err: unknown) => err instanceof ImportFileSecurityError && err.code === 'INVALID_MAGIC_BYTES'
    );

    await assert.rejects(
      () =>
        parseImportFileBuffer({
          filename: 'fake.csv',
          buffer: Buffer.from('Company\0Binary'),
        }),
      (err: unknown) => err instanceof ImportFileSecurityError && err.code === 'BINARY_IN_CSV'
    );
  });
});

describe('Phase 7 — Column Mapping, Merge Rules, & Normalization', () => {
  it('auto-maps company + person columns, suggests First+Last merge rule, and surfaces duplicate mapping ambiguity', () => {
    const headers = ['Company Name', 'First Name', 'Last Name', 'Contact Email', 'Job Title', 'Country'];
    const sampleRows = [['Nordic Corp', 'Astrid', 'Solberg', 'astrid@nordic.no', 'CEO', 'Norway']];

    const detected = detectColumnMappings(headers, sampleRows);
    assert.equal(detected.mappings.find((m) => m.sourceHeader === 'Company Name')?.targetField, 'companyName');
    assert.equal(detected.mappings.find((m) => m.sourceHeader === 'Contact Email')?.targetField, 'personEmail');
    assert.ok(
      detected.suggestedMergeRules.some((r) => r.targetField === 'personFullName' && r.sourceColumnIndexes.length === 2),
      'Should suggest merging First Name + Last Name into personFullName'
    );

    const extracted = extractMappedRowValues(
      headers,
      sampleRows[0],
      detected.mappings,
      detected.suggestedMergeRules
    );
    assert.equal(extracted.fields.personFullName, 'Astrid Solberg');

    const ambiguousWarnings = validateExplicitMappings(
      ['Org', 'Legal Entity'],
      [
        { sourceColumnIndex: 0, sourceHeader: 'Org', targetField: 'companyName' },
        { sourceColumnIndex: 1, sourceHeader: 'Legal Entity', targetField: 'companyName' },
      ],
      []
    );
    assert.ok(ambiguousWarnings.length > 0, 'Duplicate mapping to companyName should produce ambiguity warning');

    const template: ImportMappingTemplate = {
      id: 'tpl-1',
      name: 'Standard',
      sourceFormat: 'csv',
      headerSignature: headers,
      columnMappings: [{ sourceHeader: 'Company Name', targetField: 'legalName' }],
      mergeRules: [],
      normalizationOptions: {
        defaultCountryCode: 'NO',
        dateLocale: 'ISO',
        numberLocale: 'en-US',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
      createdBy: 'owner@leed.local',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const templated = applyTemplateToHeaders(headers, template);
    assert.equal(templated[0].targetField, 'legalName');
  });

  it('normalizes locale numbers, dates, E.164 phones, domains, formula neutralization, and caps imported identifier status', () => {
    const euAmount = parseLocaleNumericAmount('€ 1.250.500,75', 'de-DE');
    assert.equal(euAmount.valid, true);
    assert.equal(euAmount.value, 1250500.75);
    assert.equal(euAmount.detectedCurrency, 'EUR');

    const suffixAmount = parseLocaleNumericAmount('USD 2.5M', 'en-US');
    assert.equal(suffixAmount.valid, true);
    assert.equal(suffixAmount.value, 2500000);
    assert.equal(suffixAmount.detectedCurrency, 'USD');

    assert.equal(parseLocaleDateToIso('24/03/2025', 'UK'), '2025-03-24');
    assert.equal(parseLocaleDateToIso('03/24/2025', 'US'), '2025-03-24');

    // CSV formula injection escaping
    assert.equal(escapeCsvCell('=CMD("calc")'), '"\'=CMD(""calc"")"');

    const normalized = normalizeAndValidateMappedRow({
      rowNumber: 2,
      fields: {
        companyName: 'British Precision Ltd',
        registrationNumber: '123456',
        country: 'United Kingdom',
        website: 'https://www.britishprecision.co.uk/about',
        email: 'INFO@BritishPrecision.co.uk',
        phone: '020 7946 0912',
        personFullName: 'Oliver Bennett',
        personEmail: 'oliver@britishprecision.co.uk',
        relationshipType: 'founder',
        isPrimaryContact: 'yes',
      },
      customFields: {},
      options: {
        defaultCountryCode: 'GB',
        dateLocale: 'UK',
        numberLocale: 'en-US',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
    });

    assert.equal(normalized.valid, true);
    assert.equal(normalized.importKind, 'company_and_person');
    assert.equal(normalized.company?.countryCode, 'GB');
    assert.equal(normalized.company?.domain, 'britishprecision.co.uk');
    assert.equal(normalized.company?.phoneNormalized, '+442079460912');
    assert.equal(normalized.company?.registrationType, 'UK_CRN');
    assert.equal(
      normalized.company?.identifiers.find((i) => i.type === 'UK_CRN')?.normalizedValue,
      '00123456'
    );
    assert.ok(
      normalized.company?.identifiers.every((i) => i.verified === false && i.status !== 'officially_verified'),
      'Imported identifiers must never be marked officially_verified'
    );
    assert.equal(normalized.person?.isPrimaryContact, true);
  });
});

describe('Phase 7 — Deduplication Classification & Safe CRM Merge', () => {
  it('classifies existing_with_new_info, conflicting_identity, intra-file grouping, and preserves CRM fields on merge', () => {
    const existing = makeExistingLead();

    const rowEnrich = normalizeAndValidateMappedRow({
      rowNumber: 2,
      fields: {
        companyName: 'Nordic Maritime Systems AS',
        registrationNumber: '974760673',
        countryCode: 'NO',
        website: 'https://nordicmaritime.no',
        phone: '22 34 56 78',
        email: 'contact@nordicmaritime.no',
        personFullName: 'Astrid Solberg',
        personEmail: 'astrid@nordicmaritime.no',
        relationshipType: 'director',
      },
      customFields: {},
      options: {
        defaultCountryCode: 'NO',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
    });

    const rowConflict = normalizeAndValidateMappedRow({
      rowNumber: 3,
      fields: {
        companyName: 'Nordic Maritime Systems AS',
        registrationNumber: '999999999',
        countryCode: 'NO',
        domain: 'nordicmaritime.no',
      },
      customFields: {},
      options: {
        defaultCountryCode: 'NO',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
    });

    const rowNew1 = normalizeAndValidateMappedRow({
      rowNumber: 4,
      fields: {
        companyName: 'Oslo CleanTech AS',
        countryCode: 'NO',
        website: 'https://oslocleantech.no',
        personFullName: 'Henrik Holm',
        personEmail: 'henrik@oslocleantech.no',
      },
      customFields: {},
      options: {
        defaultCountryCode: 'NO',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
    });

    const rowNew2 = normalizeAndValidateMappedRow({
      rowNumber: 5,
      fields: {
        companyName: 'Oslo CleanTech AS',
        countryCode: 'NO',
        website: 'https://oslocleantech.no',
        personFullName: 'Ingrid Berg',
        personEmail: 'ingrid@oslocleantech.no',
      },
      customFields: {},
      options: {
        defaultCountryCode: 'NO',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
    });

    const classified = classifyImportBatchDuplicates(
      [
        { rowNumber: 2, ...rowEnrich },
        { rowNumber: 3, ...rowConflict },
        { rowNumber: 4, ...rowNew1 },
        { rowNumber: 5, ...rowNew2 },
      ],
      {
        existingLeads: [existing],
        existingPersons: [],
        existingRelationships: [],
        options: {
          defaultCountryCode: 'NO',
          duplicatePolicy: 'merge_safe',
          preserveExistingCrmFields: true,
          atomicRollbackOnError: false,
          skipRowsWithErrors: true,
        },
      }
    );

    assert.equal(classified.dedupeByRow.get(2)?.classification, 'existing_with_new_info');
    assert.equal(classified.recommendedActionByRow.get(2), 'update_existing');

    assert.equal(classified.dedupeByRow.get(3)?.classification, 'conflicting_identity');
    assert.equal(classified.recommendedActionByRow.get(3), 'needs_review');

    assert.equal(classified.dedupeByRow.get(4)?.classification, 'new_record');
    assert.equal(classified.dedupeByRow.get(5)?.classification, 'new_record');
    assert.equal(
      classified.dedupeByRow.get(4)?.inFileCompanyGroupKey,
      classified.dedupeByRow.get(5)?.inFileCompanyGroupKey
    );

    // Verify safe CRM merge preserves existing protected CRM fields while adding phone/email
    const { merged, fieldsEnriched } = safelyMergeImportedCompanyIntoLead({
      existing,
      imported: rowEnrich.company!,
      filename: 'nordic.csv',
      actorEmail: 'owner@leed.local',
      now: new Date().toISOString(),
    });
    assert.equal(merged.pipelineStageId, 'stage-proposal');
    assert.equal(merged.status, 'negotiation');
    assert.equal(merged.opportunityValue, 185000);
    assert.equal(merged.notes.length, 1);
    assert.equal(merged.email, 'contact@nordicmaritime.no');
    assert.equal(merged.phoneNormalized, '+4722345678');
    assert.ok(fieldsEnriched.includes('email'));
    assert.ok(fieldsEnriched.includes('phone'));
  });
});

describe('Phase 7 — End-to-End ImportService, M:N Relationships, Rollback & CSV Exports', () => {
  it('stages upload -> dry-run preview (0 writes) -> explicit confirm -> M:N company-person links -> exports', async () => {
    const { storage } = createTempStore();
    const service = new ImportService();
    const initialLeadCount = storage.getLeads().length;

    const csvData = [
      'Company Name,Registration Number,Website,Country Code,City,Contact First Name,Contact Last Name,Job Title,Contact Email,Relationship Type,Primary Contact',
      '"Harbour Dynamics Ltd",04567891,https://harbourdynamics.co.uk,GB,London,Oliver,Grant,Founder & CEO,oliver@harbourdynamics.co.uk,founder,true',
      '"Harbour Dynamics Ltd",04567891,https://harbourdynamics.co.uk,GB,London,Maya,Patel,Head of Procurement,maya@harbourdynamics.co.uk,procurement_contact,false',
      '"Harbour Holdings PLC",07778889,https://harbourholdings.co.uk,GB,Manchester,Oliver,Grant,Non-Executive Director,oliver@harbourdynamics.co.uk,director,false',
      ',,https://missingname.co.uk,GB,London,,,,,,',
    ].join('\n');

    const session = await service.createSessionFromUpload({
      filename: 'uk_decision_makers.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csvData, 'utf8'),
      defaultCountryCode: 'GB',
    });

    assert.equal(session.fileSummary.totalRows, 4);
    assert.equal(storage.getLeads().length, initialLeadCount, 'Upload must not write to CRM');

    const preview = service.previewSession(session.sessionId, {
      existingLeads: storage.getLeads(),
      existingPersons: storage.getPersons(),
      existingRelationships: storage.getAllRelationships(),
    });

    assert.equal(preview.summary.totalRows, 4);
    assert.equal(preview.summary.validRows, 3);
    assert.equal(preview.summary.invalidRows, 1);
    assert.equal(preview.summary.predictedCreatedCompanies, 2);
    assert.equal(storage.getLeads().length, initialLeadCount, 'Preview must not write to CRM');

    // Reject missing confirmation
    await assert.rejects(
      () =>
        service.confirmSessionImport(session.sessionId, {
          confirm: false,
          actorEmail: 'owner@leed.local',
          storageAdapter: storage,
          existingLeads: storage.getLeads(),
          existingPersons: storage.getPersons(),
          existingRelationships: storage.getAllRelationships(),
        }),
      (err: unknown) => err instanceof ImportServiceError && err.code === 'CONFIRMATION_REQUIRED'
    );

    const exec = await service.confirmSessionImport(session.sessionId, {
      confirm: true,
      actorEmail: 'owner@leed.local',
      storageAdapter: storage,
      existingLeads: storage.getLeads(),
      existingPersons: storage.getPersons(),
      existingRelationships: storage.getAllRelationships(),
    });

    assert.equal(exec.batch.status, 'partial_failed');
    assert.equal(exec.batch.createdCompanies, 2);
    assert.equal(exec.batch.createdPersons, 2); // Oliver Grant deduplicated across both companies!
    assert.equal(exec.batch.createdRelationships, 3); // Oliver@Dynamics, Maya@Dynamics, Oliver@Holdings
    assert.equal(exec.batch.failedRows, 1);

    assert.equal(storage.getLeads().length, initialLeadCount + 2);
    const dynamicsLead = storage.getLeads().find((l) => l.companyName === 'Harbour Dynamics Ltd')!;
    const holdingsLead = storage.getLeads().find((l) => l.companyName === 'Harbour Holdings PLC')!;
    assert.ok(dynamicsLead);
    assert.ok(holdingsLead);

    const dynamicsPersons = storage.getLeadPersons(dynamicsLead.id);
    assert.equal(dynamicsPersons.length, 2);
    const oliverLink = dynamicsPersons.find((p) => p.person.fullName === 'Oliver Grant');
    assert.ok(oliverLink);
    assert.equal(oliverLink.relationship.isPrimaryContact, true);
    assert.equal(oliverLink.otherCompanies?.length, 1, 'Oliver should show M:N link to Harbour Holdings PLC');
    assert.equal(oliverLink.otherCompanies?.[0].companyName, 'Harbour Holdings PLC');

    // Test direct manual link/unlink helpers
    const holdingsPersonsBefore = storage.getLeadPersons(holdingsLead.id);
    assert.equal(holdingsPersonsBefore.length, 1);
    const unlinked = storage.unlinkPersonFromLead(holdingsLead.id, holdingsPersonsBefore[0].relationship.id);
    assert.equal(unlinked, true);
    assert.equal(storage.getLeadPersons(holdingsLead.id).length, 0);

    // Export helpers
    const failedCsv = service.buildFailedRowsCsv(exec.rows);
    assert.ok(failedCsv.includes('missingname.co.uk'));
    const summaryCsv = service.buildBatchSummaryCsv(exec.batch, exec.rows);
    assert.ok(summaryCsv.includes('Harbour Dynamics Ltd'));
  });

  it('performs full atomic rollback when atomicRollbackOnError is enabled and a mid-batch failure occurs', async () => {
    const { storage } = createTempStore();
    const service = new ImportService();
    const initialLeadCount = storage.getLeads().length;
    const initialPersonCount = storage.getPersons().length;

    const csvData = [
      'Company Name,Country Code,Contact Full Name,Contact Email',
      'Rollback Corp One,GB,Alice One,alice@one.co.uk',
      'Rollback Corp Two,GB,Bob Two,bob@two.co.uk',
    ].join('\n');

    const session = await service.createSessionFromUpload({
      filename: 'rollback_test.csv',
      buffer: Buffer.from(csvData, 'utf8'),
      defaultCountryCode: 'GB',
    });

    const result = await service.confirmSessionImport(session.sessionId, {
      confirm: true,
      actorEmail: 'owner@leed.local',
      atomicRollbackOnError: true,
      simulateFailureAtRow: 3, // Second data row (rowNumber 3)
      storageAdapter: storage,
      existingLeads: storage.getLeads(),
      existingPersons: storage.getPersons(),
      existingRelationships: storage.getAllRelationships(),
    });

    assert.equal(result.batch.status, 'rolled_back');
    assert.equal(result.batch.createdCompanies, 0);
    assert.equal(storage.getLeads().length, initialLeadCount, 'No partial leads may survive atomic rollback');
    assert.equal(storage.getPersons().length, initialPersonCount, 'No partial persons may survive atomic rollback');
    assert.equal(storage.getAllRelationships().length, 0);
  });
});
