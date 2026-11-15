import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

import { Migrator } from '../server/db/migrator.js';
import { PostgresStorage } from '../server/db/storagePg.js';
import { StorageManager } from '../server/storage.js';
import {
  executeMigration005ApprovalWorkflow,
  handleLegacyRunMigrationsBlocked,
} from '../server/db/migrationWorkflow.js';
import { ImportService } from '../server/import/importService.js';
import { normalizeAndValidateMappedRow } from '../server/import/normalizerValidator.js';
import { CanonicalLead } from '../server/types.js';

const tempDirs: string[] = [];

function createTempJsonStore(): StorageManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leed-phase7-remed-'));
  tempDirs.push(dir);
  return new StorageManager(path.join(dir, 'pipeline_store.json'));
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

/**
 * In-memory PostgreSQL transaction & constraint simulator that enforces:
 * - Row-level `SELECT ... FOR UPDATE` lock serialization across concurrent transactions
 * - `uq_cpr_single_primary_per_lead` partial unique index (lead_id WHERE is_primary_contact = TRUE)
 * - `uq_company_person_rel` unique constraint (lead_id, person_id, relationship_type)
 * - `uq_import_batch_rows_batch_row` unique index (batch_id, row_number)
 * - Full ROLLBACK restoration on mid-transaction failure
 */
class InMemoryPgSimulator {
  public leads = new Map<string, { id: string; company_name: string }>([
    ['lead-1', { id: 'lead-1', company_name: 'Nordic Precision AS' }],
  ]);
  public persons = new Map<string, any>();
  public rels = new Map<string, any>();
  public batches = new Map<string, any>();
  public batchRows = new Map<string, any>();
  private lockQueue: Promise<void> = Promise.resolve();
  private txLockHolders = 0;

  public createPool(): pg.Pool {
    const sim = this;
    return {
      connect: async () => sim.createClient(),
    } as unknown as pg.Pool;
  }

  public createClient(): pg.PoolClient {
    const sim = this;
    let inTx = false;
    let holdsLeadLock = false;
    let snapshot: {
      leads: Map<string, any>;
      persons: Map<string, any>;
      rels: Map<string, any>;
      batches: Map<string, any>;
      batchRows: Map<string, any>;
    } | null = null;
    let releaseQueueLock: (() => void) | null = null;

    const acquireLeadLock = async () => {
      if (holdsLeadLock) return;
      const prev = sim.lockQueue;
      let release!: () => void;
      sim.lockQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prev;
      holdsLeadLock = true;
      sim.txLockHolders++;
      releaseQueueLock = release;
    };

    const releaseLeadLock = () => {
      if (!holdsLeadLock) return;
      holdsLeadLock = false;
      sim.txLockHolders--;
      const fn = releaseQueueLock;
      releaseQueueLock = null;
      if (fn) fn();
    };

    const client = {
      query: async (sql: string, params: any[] = []) => {
        const trimmed = sql.trim();

        if (trimmed === 'BEGIN') {
          inTx = true;
          snapshot = {
            leads: new Map(JSON.parse(JSON.stringify(Array.from(sim.leads.entries())))),
            persons: new Map(JSON.parse(JSON.stringify(Array.from(sim.persons.entries())))),
            rels: new Map(JSON.parse(JSON.stringify(Array.from(sim.rels.entries())))),
            batches: new Map(JSON.parse(JSON.stringify(Array.from(sim.batches.entries())))),
            batchRows: new Map(JSON.parse(JSON.stringify(Array.from(sim.batchRows.entries())))),
          };
          return { rows: [], rowCount: 0 };
        }

        if (trimmed === 'COMMIT') {
          inTx = false;
          snapshot = null;
          releaseLeadLock();
          return { rows: [], rowCount: 0 };
        }

        if (trimmed === 'ROLLBACK') {
          if (snapshot) {
            sim.leads = snapshot.leads;
            sim.persons = snapshot.persons;
            sim.rels = snapshot.rels;
            sim.batches = snapshot.batches;
            sim.batchRows = snapshot.batchRows;
          }
          inTx = false;
          snapshot = null;
          releaseLeadLock();
          return { rows: [], rowCount: 0 };
        }

        if (trimmed.startsWith('SAVEPOINT') || trimmed.startsWith('RELEASE SAVEPOINT') || trimmed.startsWith('ROLLBACK TO SAVEPOINT')) {
          return { rows: [], rowCount: 0 };
        }

        if (trimmed.includes('to_regclass')) {
          return {
            rows: [
              {
                persons: 'persons',
                rels: 'company_person_relationships',
                templates: 'import_mapping_templates',
                batches: 'import_batches',
                batch_rows: 'import_batch_rows',
                tbl: 'company_person_relationships',
              },
            ],
          };
        }

        if (trimmed.includes('SELECT id FROM leads WHERE id = $1 FOR UPDATE')) {
          await acquireLeadLock();
          const lead = sim.leads.get(params[0]);
          return { rows: lead ? [{ id: lead.id }] : [] };
        }

        if (trimmed.includes('SELECT * FROM persons')) {
          return { rows: Array.from(sim.persons.values()) };
        }

        if (trimmed.includes('SELECT * FROM company_person_relationships')) {
          return { rows: Array.from(sim.rels.values()) };
        }

        if (trimmed.includes('SELECT id FROM company_person_relationships WHERE id = $1 AND lead_id = $2')) {
          const found = sim.rels.get(params[0]);
          return { rows: found && found.lead_id === params[1] ? [{ id: found.id }] : [] };
        }

        if (trimmed.includes('FROM company_person_relationships r') && trimmed.includes('JOIN persons p')) {
          const leadId = params[0];
          const joined = Array.from(sim.rels.values())
            .filter((r) => r.lead_id === leadId)
            .sort((a, b) => Number(b.is_primary_contact) - Number(a.is_primary_contact))
            .map((r) => {
              const p = sim.persons.get(r.person_id);
              return {
                ...r,
                p_id: p.id,
                p_full_name: p.full_name,
                p_first_name: p.first_name,
                p_last_name: p.last_name,
                p_normalized_name: p.normalized_name,
                p_email: p.email,
                p_email_status: p.email_status,
                p_phone: p.phone,
                p_phone_normalized: p.phone_normalized,
                p_linkedin_url: p.linkedin_url,
                p_linkedin_slug: p.linkedin_slug,
                p_country: p.country,
                p_country_code: p.country_code,
                p_city: p.city,
                p_sources: p.sources,
                p_confidence_score: p.confidence_score,
                p_verification_status: p.verification_status,
                p_custom_fields: p.custom_fields,
                p_created_at: p.created_at,
                p_updated_at: p.updated_at,
              };
            });
          return { rows: joined };
        }

        if (trimmed.includes('FROM company_person_relationships r') && trimmed.includes('JOIN leads l')) {
          return { rows: [] };
        }

        if (trimmed.startsWith('INSERT INTO persons')) {
          const row = {
            id: params[0],
            full_name: params[1],
            first_name: params[2],
            last_name: params[3],
            normalized_name: params[4],
            email: params[5],
            email_status: params[6],
            phone: params[7],
            phone_normalized: params[8],
            linkedin_url: params[9],
            linkedin_slug: params[10],
            country: params[11],
            country_code: params[12],
            city: params[13],
            sources: params[14],
            confidence_score: params[15],
            verification_status: params[16],
            custom_fields: params[17],
            created_at: params[18],
            updated_at: params[19],
          };
          sim.persons.set(row.id, row);
          return { rows: [], rowCount: 1 };
        }

        if (
          trimmed.startsWith('UPDATE company_person_relationships') &&
          trimmed.includes('SET is_primary_contact = FALSE') &&
          trimmed.includes('AND NOT (person_id = $2 AND relationship_type = $3)')
        ) {
          const [leadId, personId, relType] = params;
          for (const [k, r] of sim.rels.entries()) {
            if (r.lead_id === leadId && r.is_primary_contact && !(r.person_id === personId && r.relationship_type === relType)) {
              sim.rels.set(k, { ...r, is_primary_contact: false });
            }
          }
          return { rows: [], rowCount: 1 };
        }

        if (
          trimmed.startsWith('UPDATE company_person_relationships') &&
          trimmed.includes('SET is_primary_contact = FALSE') &&
          trimmed.includes('AND id <> $2')
        ) {
          const [leadId, relId] = params;
          for (const [k, r] of sim.rels.entries()) {
            if (r.lead_id === leadId && r.is_primary_contact && r.id !== relId) {
              sim.rels.set(k, { ...r, is_primary_contact: false });
            }
          }
          return { rows: [], rowCount: 1 };
        }

        if (trimmed.startsWith('UPDATE company_person_relationships') && trimmed.includes('SET is_primary_contact = TRUE')) {
          const [relId, leadId] = params;
          const existing = sim.rels.get(relId);
          if (existing && existing.lead_id === leadId) {
            const conflict = Array.from(sim.rels.values()).find(
              (r) => r.lead_id === leadId && r.is_primary_contact === true && r.id !== relId
            );
            if (conflict) {
              const err: any = new Error('duplicate key value violates unique constraint "uq_cpr_single_primary_per_lead"');
              err.code = '23505';
              throw err;
            }
            sim.rels.set(relId, { ...existing, is_primary_contact: true });
          }
          return { rows: [], rowCount: 1 };
        }

        if (trimmed.startsWith('INSERT INTO company_person_relationships')) {
          const row = {
            id: params[0],
            lead_id: params[1],
            person_id: params[2],
            relationship_type: params[3],
            job_title: params[4],
            designation: params[5],
            department: params[6],
            decision_maker_category: params[7],
            is_primary_contact: Boolean(params[8]),
            source_name: params[9],
            provenance: params[10],
            confidence_score: params[11],
            verification_status: params[12],
            created_at: params[13],
            updated_at: params[14],
          };

          const existingByComposite = Array.from(sim.rels.values()).find(
            (r) =>
              r.lead_id === row.lead_id &&
              r.person_id === row.person_id &&
              r.relationship_type === row.relationship_type
          );

          const finalIsPrimary = existingByComposite
            ? existingByComposite.is_primary_contact || row.is_primary_contact
            : row.is_primary_contact;

          // Enforce uq_cpr_single_primary_per_lead
          if (finalIsPrimary) {
            const conflictingPrimary = Array.from(sim.rels.values()).find(
              (r) =>
                r.lead_id === row.lead_id &&
                r.is_primary_contact === true &&
                r.id !== (existingByComposite?.id || row.id)
            );
            if (conflictingPrimary) {
              const err: any = new Error('duplicate key value violates unique constraint "uq_cpr_single_primary_per_lead"');
              err.code = '23505';
              throw err;
            }
          }

          if (existingByComposite) {
            sim.rels.set(existingByComposite.id, {
              ...existingByComposite,
              is_primary_contact: finalIsPrimary,
            });
          } else {
            sim.rels.set(row.id, row);
          }
          return { rows: [], rowCount: 1 };
        }

        if (trimmed.includes('FROM pipeline_stages')) {
          return { rows: [{ id: 'stage-1' }] };
        }

        if (trimmed.startsWith('INSERT INTO leads')) {
          sim.leads.set(params[0], { id: params[0], company_name: params[1] });
          return { rows: [], rowCount: 1 };
        }

        if (trimmed.startsWith('INSERT INTO import_batches')) {
          sim.batches.set(params[0], { id: params[0] });
          return { rows: [], rowCount: 1 };
        }

        if (trimmed.startsWith('UPDATE import_batches')) {
          return { rows: [], rowCount: 1 };
        }

        if (trimmed.startsWith('INSERT INTO import_batch_rows')) {
          const batchId = params[1];
          const rowNumber = params[2];
          const dup = Array.from(sim.batchRows.values()).find(
            (r) => r.batch_id === batchId && r.row_number === rowNumber
          );
          if (dup) {
            const err: any = new Error('duplicate key value violates unique constraint "uq_import_batch_rows_batch_row"');
            err.code = '23505';
            throw err;
          }
          sim.batchRows.set(params[0], { id: params[0], batch_id: batchId, row_number: rowNumber });
          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
      release: () => {
        if (inTx) {
          inTx = false;
        }
        releaseLeadLock();
      },
    } as unknown as pg.PoolClient;

    return client;
  }
}

function makeNormalizedPerson(fullName: string, email: string, isPrimaryContact: boolean, relType = 'director') {
  const norm = normalizeAndValidateMappedRow({
    rowNumber: 2,
    fields: {
      personFullName: fullName,
      personEmail: email,
      relationshipType: relType,
      isPrimaryContact: isPrimaryContact ? 'true' : 'false',
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
  return norm.person!;
}

describe('Phase 7 Migration 005 Integrity & Approval Remediation', () => {
  it('1. Enforces partial unique index uq_cpr_single_primary_per_lead in SQL & keeps only one primary contact per company', async () => {
    const upSql = fs.readFileSync(
      path.join(process.cwd(), 'server/db/migrations/005_import_and_relationships.sql'),
      'utf-8'
    );
    const downSql = fs.readFileSync(
      path.join(process.cwd(), 'server/db/migrations/005_import_and_relationships.down.sql'),
      'utf-8'
    );
    assert.match(
      upSql,
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_cpr_single_primary_per_lead\s+ON company_person_relationships\s*\(lead_id\)\s*WHERE is_primary_contact = TRUE/i
    );
    assert.match(downSql, /DROP INDEX IF EXISTS uq_cpr_single_primary_per_lead;/);

    // Bulk import where 2 rows for the same company are both marked primary: only the latest survives as primary
    const store = createTempJsonStore();
    const service = new ImportService();
    const csv = [
      'Company Name,Country Code,Contact Name,Contact Email,Relationship Type,Primary Contact',
      'Fjord Robotics AS,NO,Alice Lind,alice@fjord.no,founder,true',
      'Fjord Robotics AS,NO,Bjarne Holm,bjarne@fjord.no,director,true',
    ].join('\n');

    const sess = await service.createSessionFromUpload({
      filename: 'two_primaries.csv',
      buffer: Buffer.from(csv, 'utf8'),
      defaultCountryCode: 'NO',
    });
    const res = await service.confirmSessionImport(sess.sessionId, {
      confirm: true,
      actorEmail: 'owner@leed.local',
      storageAdapter: store,
      existingLeads: store.getLeads(),
      existingPersons: store.getPersons(),
      existingRelationships: store.getAllRelationships(),
    });

    assert.equal(res.batch.status, 'completed');
    const lead = store.getLeads().find((l) => l.companyName === 'Fjord Robotics AS')!;
    const linked = store.getLeadPersons(lead.id);
    assert.equal(linked.length, 2, 'Both people & relationships must remain intact');
    const primaries = linked.filter((l) => l.relationship.isPrimaryContact);
    assert.equal(primaries.length, 1, 'At most one primary contact per company');
    assert.equal(primaries[0].person.fullName, 'Bjarne Holm');
  });

  it('2. Switching primary contact demotes previous primary without deleting either person or relationship', async () => {
    const sim = new InMemoryPgSimulator();
    const pgStore = new PostgresStorage();
    (pgStore as any).getClient = () => sim.createPool();

    const p1 = makeNormalizedPerson('Astrid Solberg', 'astrid@nordic.no', true, 'founder');
    const p2 = makeNormalizedPerson('Henrik Dahl', 'henrik@nordic.no', false, 'director');
    await pgStore.linkPersonToLead({ leadId: 'lead-1', person: p1, actorEmail: 'owner@leed.local' });
    let linked = await pgStore.linkPersonToLead({ leadId: 'lead-1', person: p2, actorEmail: 'owner@leed.local' });
    assert.equal(linked.length, 2);
    assert.equal(linked.filter((x) => x.relationship.isPrimaryContact).length, 1);
    assert.equal(linked.find((x) => x.person.fullName === 'Astrid Solberg')?.relationship.isPrimaryContact, true);

    // Switch primary to Henrik via setPrimaryContact
    const henrikRelId = linked.find((x) => x.person.fullName === 'Henrik Dahl')!.relationship.id;
    linked = await pgStore.setPrimaryContact('lead-1', henrikRelId);
    assert.equal(linked.length, 2, 'No relationships or persons deleted on switch');
    assert.equal(linked.filter((x) => x.relationship.isPrimaryContact).length, 1);
    assert.equal(linked.find((x) => x.person.fullName === 'Henrik Dahl')?.relationship.isPrimaryContact, true);
    assert.equal(linked.find((x) => x.person.fullName === 'Astrid Solberg')?.relationship.isPrimaryContact, false);

    // Switch back via linkPersonToLead with isPrimaryContact = true
    const p1Promote = makeNormalizedPerson('Astrid Solberg', 'astrid@nordic.no', true, 'founder');
    linked = await pgStore.linkPersonToLead({ leadId: 'lead-1', person: p1Promote, actorEmail: 'owner@leed.local' });
    assert.equal(linked.filter((x) => x.relationship.isPrimaryContact).length, 1);
    assert.equal(linked.find((x) => x.person.fullName === 'Astrid Solberg')?.relationship.isPrimaryContact, true);
    assert.equal(linked.find((x) => x.person.fullName === 'Henrik Dahl')?.relationship.isPrimaryContact, false);
  });

  it('3. Primary-contact changes are transactional and roll back cleanly on mid-transaction error', async () => {
    const sim = new InMemoryPgSimulator();
    const pgStore = new PostgresStorage();
    (pgStore as any).getClient = () => sim.createPool();

    const p1 = makeNormalizedPerson('Initial Primary', 'primary@nordic.no', true, 'founder');
    await pgStore.linkPersonToLead({ leadId: 'lead-1', person: p1, actorEmail: 'owner@leed.local' });

    // Inject failure on final UPDATE inside setPrimaryContact transaction
    const basePool = sim.createPool();
    let seenBegin = false;
    let seenRollback = false;
    (pgStore as any).getClient = () => ({
      connect: async () => {
        const realClient = await basePool.connect();
        return {
          query: async (sql: string, params?: any[]) => {
            if (sql.trim() === 'BEGIN') seenBegin = true;
            if (sql.trim() === 'ROLLBACK') seenRollback = true;
            if (sql.includes('SET is_primary_contact = TRUE')) {
              throw new Error('Simulated crash after demotion');
            }
            return realClient.query(sql, params);
          },
          release: () => realClient.release(),
        } as unknown as pg.PoolClient;
      },
    });

    const p2 = makeNormalizedPerson('Second Contact', 'second@nordic.no', false, 'director');
    await pgStore.linkPersonToLead({ leadId: 'lead-1', person: p2, actorEmail: 'owner@leed.local' });
    const secondRel = Array.from(sim.rels.values()).find((r) => r.lead_id === 'lead-1' && !r.is_primary_contact)!;

    await assert.rejects(
      () => pgStore.setPrimaryContact('lead-1', secondRel.id),
      /Simulated crash after demotion/
    );

    assert.equal(seenBegin, true);
    assert.equal(seenRollback, true);
    const primariesAfterRollback = Array.from(sim.rels.values()).filter(
      (r) => r.lead_id === 'lead-1' && r.is_primary_contact === true
    );
    assert.equal(primariesAfterRollback.length, 1, 'Previous primary contact must be restored on rollback');
  });

  it('4. Concurrent primary-contact promotions serialize cleanly and partial unique index blocks raw duplicate primaries', async () => {
    const sim = new InMemoryPgSimulator();
    const pgStore = new PostgresStorage();
    (pgStore as any).getClient = () => sim.createPool();

    const pA = makeNormalizedPerson('Concurrent Alpha', 'alpha@nordic.no', true, 'founder');
    const pB = makeNormalizedPerson('Concurrent Beta', 'beta@nordic.no', true, 'director');
    const pC = makeNormalizedPerson('Concurrent Gamma', 'gamma@nordic.no', true, 'executive');

    await Promise.all([
      pgStore.linkPersonToLead({ leadId: 'lead-1', person: pA, actorEmail: 'owner@leed.local' }),
      pgStore.linkPersonToLead({ leadId: 'lead-1', person: pB, actorEmail: 'owner@leed.local' }),
      pgStore.linkPersonToLead({ leadId: 'lead-1', person: pC, actorEmail: 'owner@leed.local' }),
    ]);

    const linked = await pgStore.getLeadPersons('lead-1');
    assert.equal(linked.length, 3);
    assert.equal(
      linked.filter((x) => x.relationship.isPrimaryContact).length,
      1,
      'Concurrent promotions must result in strictly 1 primary contact'
    );

    // Direct raw SQL attempt to insert a second primary contact without demoting must fail with 23505
    const rawClient = sim.createClient();
    await assert.rejects(
      () =>
        rawClient.query(
          `INSERT INTO company_person_relationships (
            id, lead_id, person_id, relationship_type, job_title, designation,
            department, decision_maker_category, is_primary_contact, source_name,
            provenance, confidence_score, verification_status, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            'rel-raw-dup',
            'lead-1',
            'person-raw',
            'advisor',
            null,
            null,
            null,
            null,
            true,
            'Raw SQL',
            '{}',
            50,
            'user_provided',
            new Date().toISOString(),
            new Date().toISOString(),
          ]
        ),
      (err: any) => err?.code === '23505' && /uq_cpr_single_primary_per_lead/.test(err.message)
    );
    rawClient.release();
  });

  it('5 & 6. Rejects duplicate row_numbers within the same batch while allowing different batches to reuse row numbers', async () => {
    const upSql = fs.readFileSync(
      path.join(process.cwd(), 'server/db/migrations/005_import_and_relationships.sql'),
      'utf-8'
    );
    const downSql = fs.readFileSync(
      path.join(process.cwd(), 'server/db/migrations/005_import_and_relationships.down.sql'),
      'utf-8'
    );
    assert.match(
      upSql,
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batch_rows_batch_row ON import_batch_rows \(batch_id, row_number\)/
    );
    assert.doesNotMatch(upSql, /\bidx_import_batch_rows_batch_row\b/);
    assert.match(downSql, /DROP INDEX IF EXISTS uq_import_batch_rows_batch_row;/);

    const sim = new InMemoryPgSimulator();
    const pgStore = new PostgresStorage();
    (pgStore as any).getClient = () => sim.createPool();

    const leadRow = normalizeAndValidateMappedRow({
      rowNumber: 2,
      fields: { companyName: 'Batch Row Test Ltd', countryCode: 'GB' },
      customFields: {},
      options: {
        defaultCountryCode: 'GB',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
    });

    // Duplicate rowNumber=2 in the same batch must fail & roll back cleanly
    const dupRes = await pgStore.executeImportTransaction({
      batchId: 'batch-dup-1',
      filename: 'dup.csv',
      fileFormat: 'csv',
      fileSizeBytes: 120,
      fileSha256: 'abc',
      encodingDetected: 'UTF-8',
      options: {
        defaultCountryCode: 'GB',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
      actorEmail: 'owner@leed.local',
      atomicRollbackOnError: false,
      rows: [
        { ...leadRow, rowNumber: 2, rawData: {}, proposedAction: 'create_new', changesSummary: [], dedupe: { classification: 'new_record', recommendedAction: 'create_new' }, finalAction: 'create_new' },
        { ...leadRow, rowNumber: 2, rawData: {}, proposedAction: 'create_new', changesSummary: [], dedupe: { classification: 'new_record', recommendedAction: 'create_new' }, finalAction: 'create_new' },
      ],
    });

    assert.equal(dupRes.batch.status, 'rolled_back');
    assert.match(dupRes.batch.errorMessage || '', /Duplicate row_number 2/i);
    assert.equal(sim.batchRows.size, 0, 'Rolled back batch must not persist duplicate rows');

    // Different batches reusing rowNumber=2 and rowNumber=3 must both succeed
    const batchA = await pgStore.executeImportTransaction({
      batchId: 'batch-A',
      filename: 'a.csv',
      fileFormat: 'csv',
      fileSizeBytes: 100,
      fileSha256: 'sha-a',
      encodingDetected: 'UTF-8',
      options: {
        defaultCountryCode: 'GB',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
      actorEmail: 'owner@leed.local',
      atomicRollbackOnError: false,
      rows: [
        { ...leadRow, rowNumber: 2, rawData: {}, proposedAction: 'create_new', changesSummary: [], dedupe: { classification: 'new_record', recommendedAction: 'create_new' }, finalAction: 'create_new' },
      ],
    });
    const batchB = await pgStore.executeImportTransaction({
      batchId: 'batch-B',
      filename: 'b.csv',
      fileFormat: 'csv',
      fileSizeBytes: 100,
      fileSha256: 'sha-b',
      encodingDetected: 'UTF-8',
      options: {
        defaultCountryCode: 'GB',
        duplicatePolicy: 'merge_safe',
        preserveExistingCrmFields: true,
        atomicRollbackOnError: false,
        skipRowsWithErrors: true,
      },
      actorEmail: 'owner@leed.local',
      atomicRollbackOnError: false,
      rows: [
        { ...leadRow, rowNumber: 2, rawData: {}, proposedAction: 'create_new', changesSummary: [], dedupe: { classification: 'new_record', recommendedAction: 'create_new' }, finalAction: 'create_new' },
      ],
    });
    assert.equal(batchA.batch.status, 'completed');
    assert.equal(batchB.batch.status, 'completed');
    assert.equal(sim.batchRows.size, 2);
  });

  it('7 & 8. Migration 005 verification checks all 5 tables, all 13 indexes (11 original + 2 unique), 001–004 intact, and existing CRM tables preserved', async () => {
    const allPhase7Indexes = [
      'idx_persons_email',
      'idx_persons_linkedin_slug',
      'idx_persons_phone_normalized',
      'idx_persons_normalized_name',
      'idx_cpr_lead_id',
      'idx_cpr_person_id',
      'idx_cpr_decision_category',
      'uq_cpr_single_primary_per_lead',
      'idx_import_templates_name',
      'idx_import_batches_created_at',
      'idx_import_batches_status',
      'uq_import_batch_rows_batch_row',
      'idx_import_batch_rows_outcome',
    ];
    const allPreviousIndexes = [
      'idx_lead_identifiers_normalized',
      'idx_lead_identifiers_country',
      'idx_lead_identifiers_status',
      'idx_leads_city',
      'idx_leads_region',
      'idx_leads_country',
      'idx_country_caps_code',
      'idx_country_caps_status',
      'idx_connector_runs_conn_executed',
      'idx_connector_runs_status',
    ];
    const existingCrmTables = [
      'owner_users',
      'owner_sessions',
      'pipeline_stages',
      'leads',
      'lead_sources',
      'lead_identifiers',
      'lead_notes',
      'activities',
      'tasks',
      'lead_merge_history',
      'campaigns',
      'campaign_messages',
      'connector_credentials',
      'connector_runs',
      'audit_events',
      'app_settings',
      'country_source_capabilities',
    ];
    const phase7Tables = [
      'persons',
      'company_person_relationships',
      'import_mapping_templates',
      'import_batches',
      'import_batch_rows',
    ];

    const buildMockClient = (opts: { omitIndex?: string; omitMigration?: string; omitCrmTable?: string } = {}) =>
      ({
        query: async (sql: string) => {
          if (sql.includes('to_regclass')) {
            return { rows: [{ mig_tbl: 'schema_migrations', cap_tbl: 'country_source_capabilities' }] };
          }
          if (sql.includes('FROM schema_migrations')) {
            const versions = ['001', '002', '003', '004', '005'].filter((v) => v !== opts.omitMigration);
            return { rows: versions.map((v) => ({ version: v, name: `${v}_mig.sql`, applied_at: '2026-11-15T00:00:00Z' })) };
          }
          if (sql.includes("table_name = 'lead_identifiers'")) {
            return { rows: ['country_code', 'normalized_value', 'issuing_authority', 'source', 'status'].map((column_name) => ({ column_name })) };
          }
          if (sql.includes("table_name = 'connector_credentials'")) {
            return { rows: ['key_version', 'masked_hint', 'rotated_at', 'validated_at', 'validation_status'].map((column_name) => ({ column_name })) };
          }
          if (sql.includes("table_name = 'connector_runs'")) {
            return {
              rows: [
                'operation', 'started_at', 'completed_at', 'duration_ms',
                'records_discovered', 'records_normalized', 'records_rejected',
                'error_category', 'diagnostic_summary', 'rate_limit_remaining',
                'rate_limit_reset_at', 'request_id',
              ].map((column_name) => ({ column_name })),
            };
          }
          if (sql.includes("table_name = 'app_settings'")) {
            return { rows: [{ column_name: 'connector_configs' }] };
          }
          if (sql.includes('FROM pg_indexes')) {
            const idxs = [...allPreviousIndexes, ...allPhase7Indexes].filter((i) => i !== opts.omitIndex);
            return { rows: idxs.map((indexname) => ({ indexname })) };
          }
          if (sql.includes('FROM information_schema.tables')) {
            const tbls = [...existingCrmTables, ...phase7Tables].filter((t) => t !== opts.omitCrmTable);
            return { rows: tbls.map((table_name) => ({ table_name })) };
          }
          return { rows: [] };
        },
        release: () => {},
      }) as unknown as pg.PoolClient;

    const migrator = new Migrator();
    const auditCalls: Array<{ action: string; details: Record<string, unknown> }> = [];

    const okOutcome = await executeMigration005ApprovalWorkflow(
      { owner: { role: 'owner', email: 'owner@leed.local' }, confirmMigration: '005', clientIp: '127.0.0.1' },
      {
        isDbConnected: () => true,
        runTargetMigration005: async () => ({ success: true, applied: ['005_import_and_relationships.sql'], alreadyApplied: ['001', '002', '003', '004'] }),
        inspectMigrationStatus: () => migrator.inspectMigrationStatus(buildMockClient()),
        recordAuditEvent: async (action, _actor, _type, _id, details) => {
          auditCalls.push({ action, details });
        },
      }
    );

    assert.equal(okOutcome.status, 200);
    assert.equal(okOutcome.body.success, true);
    const v = okOutcome.body.verification as any;
    assert.equal(v.tablesPresentCount, 5);
    assert.equal(v.expectedTablesCount, 5);
    assert.equal(v.indexesPresentCount, 13);
    assert.equal(v.expectedIndexesCount, 13);
    assert.equal(v.migrations001To004Recorded, true);
    assert.equal(v.migration005Recorded, true);
    assert.equal(v.schemaReady, true);
    assert.equal(v.existingCrmTablesIntact, true);
    assert.equal(v.unrelatedSchemaUnchanged, true);
    assert.equal(v.verified, true);
    assert.equal(auditCalls[0].action, 'MIGRATION_005_APPROVED_AND_APPLIED');

    // Verify OwnerControlCentre.tsx consumes the exact verification property names
    const uiSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/OwnerControlCentre.tsx'), 'utf-8');
    assert.match(uiSrc, /verification\.tablesPresentCount/);
    assert.match(uiSrc, /verification\.expectedTablesCount/);
    assert.match(uiSrc, /verification\.indexesPresentCount/);
    assert.match(uiSrc, /verification\.expectedIndexesCount/);
    assert.match(uiSrc, /verification\.migrations001To004Recorded/);
    assert.match(uiSrc, /verification\.schemaReady/);

    // Missing unique index must fail verification
    const missingIdxOutcome = await executeMigration005ApprovalWorkflow(
      { owner: { role: 'owner', email: 'owner@leed.local' }, confirmMigration: '005' },
      {
        isDbConnected: () => true,
        runTargetMigration005: async () => ({ success: true, applied: ['005_import_and_relationships.sql'], alreadyApplied: [] }),
        inspectMigrationStatus: () =>
          migrator.inspectMigrationStatus(buildMockClient({ omitIndex: 'uq_cpr_single_primary_per_lead' })),
        recordAuditEvent: async () => {},
      }
    );
    assert.equal(missingIdxOutcome.status, 500);
    assert.equal((missingIdxOutcome.body.verification as any).schemaReady, false);
    assert.equal((missingIdxOutcome.body.verification as any).indexesPresentCount, 12);

    // Missing prior migration 004 or missing CRM table must fail verification
    const missing004Outcome = await executeMigration005ApprovalWorkflow(
      { owner: { role: 'owner', email: 'owner@leed.local' }, confirmMigration: '005' },
      {
        isDbConnected: () => true,
        runTargetMigration005: async () => ({ success: true, applied: [], alreadyApplied: [] }),
        inspectMigrationStatus: () => migrator.inspectMigrationStatus(buildMockClient({ omitMigration: '004' })),
        recordAuditEvent: async () => {},
      }
    );
    assert.equal(missing004Outcome.status, 500);
    assert.equal((missing004Outcome.body.verification as any).migrations001To004Recorded, false);

    const missingCrmOutcome = await executeMigration005ApprovalWorkflow(
      { owner: { role: 'owner', email: 'owner@leed.local' }, confirmMigration: '005' },
      {
        isDbConnected: () => true,
        runTargetMigration005: async () => ({ success: true, applied: [], alreadyApplied: [] }),
        inspectMigrationStatus: () => migrator.inspectMigrationStatus(buildMockClient({ omitCrmTable: 'leads' })),
        recordAuditEvent: async () => {},
      }
    );
    assert.equal(missingCrmOutcome.status, 500);
    assert.equal((missingCrmOutcome.body.verification as any).existingCrmTablesIntact, false);
  });

  it('9. Unexpected approval exceptions generate MIGRATION_005_APPROVAL_FAILED audit event without leaking SQL, secrets, or stacks', async () => {
    const auditEvents: Array<{ action: string; entityId: string; details: Record<string, unknown> }> = [];

    const outcome = await executeMigration005ApprovalWorkflow(
      { owner: { role: 'owner', email: 'owner@leed.local' }, confirmMigration: '005', clientIp: '127.0.0.1' },
      {
        isDbConnected: () => true,
        runTargetMigration005: async () => {
          const err = new Error(
            'CREATE TABLE persons failed on postgres://user:SuperSecretPass123@ep-neon.aws.neon.tech/neondb\n    at internalStackLine (server.ts:999)'
          );
          throw err;
        },
        inspectMigrationStatus: async () => {
          throw new Error('Should not be reached');
        },
        recordAuditEvent: async (action, _actor, _entityType, entityId, details) => {
          auditEvents.push({ action, entityId, details });
        },
      }
    );

    assert.equal(outcome.status, 500);
    assert.equal(outcome.body.success, false);
    const errText = String(outcome.body.error || '');
    assert.doesNotMatch(errText, /SuperSecretPass123/);
    assert.doesNotMatch(errText, /CREATE TABLE/);
    assert.doesNotMatch(errText, /internalStackLine/);

    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].action, 'MIGRATION_005_APPROVAL_FAILED');
    assert.equal(auditEvents[0].entityId, '005_import_and_relationships.sql');
    assert.equal(auditEvents[0].details.unexpectedException, true);
    assert.doesNotMatch(String(auditEvents[0].details.error), /SuperSecretPass123/);
  });

  it('10 & 11. Legacy migration endpoint and unapproved entry points cannot bypass approval while Migration 004 approval remains intact', async () => {
    const auditEvents: string[] = [];
    const blocked = await handleLegacyRunMigrationsBlocked(
      { owner: { role: 'owner', email: 'owner@leed.local' }, clientIp: '127.0.0.1' },
      {
        isDbConnected: () => true,
        recordAuditEvent: async (action) => {
          auditEvents.push(action);
        },
      }
    );
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'MIGRATION_APPROVAL_REQUIRED');
    assert.equal(blocked.body.success, false);
    assert.deepStrictEqual(auditEvents, ['LEGACY_MIGRATION_EXECUTION_BLOCKED']);

    // StorageManager.runSchemaMigrations must also reject unapproved bulk calls
    const store = createTempJsonStore();
    await assert.rejects(() => store.runSchemaMigrations(), /Explicit allowlisted targetVersion/i);

    // Static verification that server.ts has zero un-allowlisted migration entry points
    const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf-8');
    assert.match(serverSrc, /handleLegacyRunMigrationsBlocked/);
    assert.doesNotMatch(serverSrc, /migrator\.runMigrations\(\s*\)/, 'Unscoped migrator.runMigrations() must not exist in server.ts');
    assert.match(serverSrc, /protectedApi\.post\('\/database\/migrations\/004\/approve'/);
    assert.match(serverSrc, /runMigrations\(undefined,\s*\{\s*targetVersion:\s*'004'\s*\}\)/);
    assert.match(serverSrc, /baselineVersions\s*=\s*\['001',\s*'002',\s*'003',\s*'004'\]/);
  });
});
