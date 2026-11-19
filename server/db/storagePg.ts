import pg from 'pg';
import { dbManager } from './pool.js';
import { canonicalizeIdentifierType, getIdentifierAliases } from '../../shared/identifierRegistry.js';
import { DEFAULT_PIPELINE_STAGES } from '../../shared/defaultStages.js';
import { normalizeIdentifierValue, normalizeUkCrn, normalizeUsCik } from '../identifiers/identifierEngine.js';
import { mergeLeadWithTrustHierarchy } from '../connectors/core/normalizer.js';
import {
  ConnectorConfigRecord,
  ConnectorErrorCategory,
  ConnectorRunRecord,
} from '../connectors/core/types.js';
import {
  aggregateRunsByConnector,
  buildUnifiedConnectorStatus,
  connectorRegistry,
  credentialManager,
  ensureConnectorsRegistered,
} from '../connectors/index.js';
import {
  CanonicalLead,
  PipelineStage,
  LeadTask,
  OutreachCampaign,
  CampaignMessage,
  MergeHistoryRecord,
  ConnectorStatus,
  AppSettings,
  LeadSource,
  LeadIdentifier,
  LeadNote,
  LeadActivity,
  PersonRecord,
  CompanyPersonRelationship,
  LinkedPersonWithRelationship,
  ImportMappingTemplate,
  ImportBatchRecord,
  ImportBatchRowRecord,
  NormalizedImportPerson,
} from '../types.js';
import { ImportExecutionPlan, ImportExecutionResult } from '../import/importService.js';
import { findMatchingPerson } from '../import/dedupeClassifier.js';
import {
  buildCanonicalLeadFromImport,
  buildPersonRecordFromImport,
  buildRelationshipRecord,
  mergeImportedPersonSafely,
  safelyMergeImportedCompanyIntoLead,
} from '../import/crmMergeHelper.js';

export const AUDIT_GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';


export interface AuditEventRecord {
  id: string;
  sequenceNumber?: number;
  action: string;
  actorEmail: string;
  entityType?: string;
  entityId?: string;
  details?: any;
  ipAddress?: string;
  createdAt: string;
  prevHash?: string;
  currentHash?: string;
  hashVersion?: number;
}

export interface AuditVerificationResult {
  valid: boolean;
  totalEvents: number;
  latestSequence?: number;
  genesisHash: string;
  headHash?: string;
  firstInvalidSequence?: number;
  error?: string;
  details?: string;
  verifiedAt: string;
}

export class PostgresStorage {
  private getClient(): pg.Pool {
    const pool = dbManager.getPool();
    if (!pool) throw new Error('PostgreSQL connection pool not initialized');
    return pool;
  }

  // ==========================================
  // 1. LEADS MANAGEMENT
  // ==========================================

  public async getLeads(filters: {
    search?: string;
    country?: string;
    region?: string;
    city?: string;
    identifierType?: string;
    status?: string;
    stage?: string;
    category?: string;
    hasWebsite?: boolean;
    hasEmail?: boolean;
    hasPhone?: boolean;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  } = {}): Promise<CanonicalLead[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      let query = `
        SELECT 
          l.*,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'sourceName', s.source_name,
              'providerId', s.provider_id,
              'url', s.url,
              'retrievedAt', s.retrieved_at,
              'license', s.license,
              'attribution', s.attribution
            )) FILTER (WHERE s.id IS NOT NULL), '[]'::json
          ) as sources_json,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'id', i.id,
              'type', i.type,
              'value', i.value,
              'normalizedValue', i.normalized_value,
              'countryCode', i.country_code,
              'issuingAuthority', i.issuing_authority,
              'source', i.source,
              'status', i.status,
              'verified', i.verified
            )) FILTER (WHERE i.id IS NOT NULL), '[]'::json
          ) as identifiers_json,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'id', n.id,
              'content', n.content,
              'author', n.author,
              'createdAt', n.created_at
            )) FILTER (WHERE n.id IS NOT NULL), '[]'::json
          ) as notes_json,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'id', a.id,
              'type', a.type,
              'title', a.title,
              'notes', a.notes,
              'outcome', a.outcome,
              'actor', a.actor,
              'date', a.date
            )) FILTER (WHERE a.id IS NOT NULL), '[]'::json
          ) as activities_json
        FROM leads l
        LEFT JOIN lead_sources s ON s.lead_id = l.id
        LEFT JOIN lead_identifiers i ON i.lead_id = l.id
        LEFT JOIN lead_notes n ON n.lead_id = l.id
        LEFT JOIN activities a ON a.lead_id = l.id
        WHERE 1=1
      `;

      const values: any[] = [];
      let paramIdx = 1;

      if (filters.search) {
        const cleanSearchNorm = filters.search.toUpperCase().replace(/[^A-Z0-9]/g, '');
        query += ` AND (
          l.company_name ILIKE $${paramIdx} OR
          l.registration_number ILIKE $${paramIdx} OR
          l.city ILIKE $${paramIdx} OR
          l.region ILIKE $${paramIdx} OR
          l.country ILIKE $${paramIdx} OR
          l.domain ILIKE $${paramIdx} OR
          l.email ILIKE $${paramIdx} OR
          l.tags::text ILIKE $${paramIdx} OR
          EXISTS (
            SELECT 1 FROM lead_identifiers li
            WHERE li.lead_id = l.id
              AND (li.value ILIKE $${paramIdx} OR ($${paramIdx + 1} != '' AND li.normalized_value ILIKE $${paramIdx + 1}))
          )
        )`;
        values.push(`%${filters.search}%`, cleanSearchNorm ? `%${cleanSearchNorm}%` : '');
        paramIdx += 2;
      }

      if (filters.country && filters.country !== 'ALL') {
        query += ` AND (UPPER(l.country_code) = UPPER($${paramIdx}) OR UPPER(l.country) = UPPER($${paramIdx}))`;
        values.push(filters.country);
        paramIdx++;
      }

      if (filters.region && filters.region !== 'ALL') {
        query += ` AND l.region ILIKE $${paramIdx}`;
        values.push(`%${filters.region}%`);
        paramIdx++;
      }

      if (filters.city && filters.city !== 'ALL') {
        query += ` AND l.city ILIKE $${paramIdx}`;
        values.push(`%${filters.city}%`);
        paramIdx++;
      }

      if (filters.identifierType && filters.identifierType !== 'ALL') {
        const aliases = getIdentifierAliases(filters.identifierType);
        query += ` AND EXISTS (SELECT 1 FROM lead_identifiers li WHERE li.lead_id = l.id AND UPPER(li.type) = ANY($${paramIdx}::text[]))`;
        values.push(aliases);
        paramIdx++;
      }

      if (filters.status && filters.status !== 'ALL') {
        query += ` AND l.status = $${paramIdx}`;
        values.push(filters.status);
        paramIdx++;
      }

      if (filters.stage && filters.stage !== 'ALL') {
        query += ` AND l.pipeline_stage_id = $${paramIdx}`;
        values.push(filters.stage);
        paramIdx++;
      }

      if (filters.category && filters.category !== 'ALL') {
        query += ` AND l.category ILIKE $${paramIdx}`;
        values.push(`%${filters.category}%`);
        paramIdx++;
      }

      if (filters.hasWebsite) {
        query += ` AND l.website IS NOT NULL AND l.website != ''`;
      }

      if (filters.hasEmail) {
        query += ` AND l.email IS NOT NULL AND l.email != ''`;
      }

      if (filters.hasPhone) {
        query += ` AND ((l.phone IS NOT NULL AND l.phone != '') OR (l.phone_normalized IS NOT NULL AND l.phone_normalized != ''))`;
      }

      const sortColumns: Record<string, string> = {
        createdAt: 'l.created_at',
        updatedAt: 'l.updated_at',
        companyName: 'l.company_name',
        confidenceScore: 'l.confidence_score',
        opportunityValue: 'l.opportunity_value',
        country: 'l.country',
      };
      const sortCol = sortColumns[filters.sortBy || 'createdAt'] || 'l.created_at';
      const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

      query += ` GROUP BY l.id ORDER BY ${sortCol} ${sortDir}`;

      const { rows } = await client.query(query, values);
      return rows.map((r: any) => this.mapRowToLead(r));
    } finally {
      if (client) client.release();
    }
  }

  public async getLead(id: string): Promise<CanonicalLead | null> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const query = `
        SELECT 
          l.*,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'sourceName', s.source_name,
              'providerId', s.provider_id,
              'url', s.url,
              'retrievedAt', s.retrieved_at,
              'license', s.license,
              'attribution', s.attribution
            )) FILTER (WHERE s.id IS NOT NULL), '[]'::json
          ) as sources_json,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'id', i.id,
              'type', i.type,
              'value', i.value,
              'normalizedValue', i.normalized_value,
              'countryCode', i.country_code,
              'issuingAuthority', i.issuing_authority,
              'source', i.source,
              'status', i.status,
              'verified', i.verified
            )) FILTER (WHERE i.id IS NOT NULL), '[]'::json
          ) as identifiers_json,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'id', n.id,
              'content', n.content,
              'author', n.author,
              'createdAt', n.created_at
            )) FILTER (WHERE n.id IS NOT NULL), '[]'::json
          ) as notes_json,
          COALESCE(
            json_agg(DISTINCT jsonb_build_object(
              'id', a.id,
              'type', a.type,
              'title', a.title,
              'notes', a.notes,
              'outcome', a.outcome,
              'actor', a.actor,
              'date', a.date
            )) FILTER (WHERE a.id IS NOT NULL), '[]'::json
          ) as activities_json
        FROM leads l
        LEFT JOIN lead_sources s ON s.lead_id = l.id
        LEFT JOIN lead_identifiers i ON i.lead_id = l.id
        LEFT JOIN lead_notes n ON n.lead_id = l.id
        LEFT JOIN activities a ON a.lead_id = l.id
        WHERE l.id = $1
        GROUP BY l.id
      `;

      const { rows } = await client.query(query, [id]);
      if (rows.length === 0) return null;
      return this.mapRowToLead(rows[0]);
    } finally {
      if (client) client.release();
    }
  }

  public async upsertLead(
    lead: CanonicalLead,
    options: { autoInitStagesIfEmpty?: boolean } = {}
  ): Promise<CanonicalLead> {
    const pool = this.getClient();
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await client.query('BEGIN');

      const resolvedStageId = await this.resolvePipelineStageId(
        client,
        lead.pipelineStageId,
        options.autoInitStagesIfEmpty ?? true
      );

      const canonicalRegType = lead.registrationType
        ? canonicalizeIdentifierType(lead.registrationType, lead.address?.countryCode)
        : null;

      await client.query(
        `INSERT INTO leads (
          id, company_name, legal_name, registration_number, registration_type,
          company_status, website, domain, email, email_status, phone, phone_normalized,
          street, city, region, postal_code, country, country_code, formatted_address,
          latitude, longitude, industry, category, employee_range, founded_year,
          confidence_score, confidence_signals, status, pipeline_stage_id, opportunity_value,
          currency, win_probability, lost_reason, tags, web_metadata, social_links, custom_fields,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37,
          $38, $39
        )
        ON CONFLICT (id) DO UPDATE SET
          company_name = EXCLUDED.company_name,
          legal_name = EXCLUDED.legal_name,
          registration_number = EXCLUDED.registration_number,
          registration_type = EXCLUDED.registration_type,
          company_status = EXCLUDED.company_status,
          website = EXCLUDED.website,
          domain = EXCLUDED.domain,
          email = EXCLUDED.email,
          email_status = EXCLUDED.email_status,
          phone = EXCLUDED.phone,
          phone_normalized = EXCLUDED.phone_normalized,
          street = EXCLUDED.street,
          city = EXCLUDED.city,
          region = EXCLUDED.region,
          postal_code = EXCLUDED.postal_code,
          country = EXCLUDED.country,
          country_code = EXCLUDED.country_code,
          formatted_address = EXCLUDED.formatted_address,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          industry = EXCLUDED.industry,
          category = EXCLUDED.category,
          employee_range = EXCLUDED.employee_range,
          founded_year = EXCLUDED.founded_year,
          confidence_score = EXCLUDED.confidence_score,
          confidence_signals = EXCLUDED.confidence_signals,
          status = EXCLUDED.status,
          pipeline_stage_id = EXCLUDED.pipeline_stage_id,
          opportunity_value = EXCLUDED.opportunity_value,
          currency = EXCLUDED.currency,
          win_probability = EXCLUDED.win_probability,
          lost_reason = EXCLUDED.lost_reason,
          tags = EXCLUDED.tags,
          web_metadata = EXCLUDED.web_metadata,
          social_links = EXCLUDED.social_links,
          custom_fields = EXCLUDED.custom_fields,
          updated_at = NOW()`,
        [
          lead.id,
          lead.companyName,
          lead.legalName || null,
          lead.registrationNumber || null,
          canonicalRegType,
          lead.companyStatus || 'active',
          lead.website || null,
          lead.domain || null,
          lead.email || null,
          lead.emailStatus || 'unavailable',
          lead.phone || null,
          lead.phoneNormalized || null,
          lead.address?.street || null,
          lead.address?.city || null,
          lead.address?.region || null,
          lead.address?.postalCode || null,
          lead.address?.country || 'International',
          lead.address?.countryCode || 'US',
          lead.address?.formattedAddress || null,
          lead.coordinates?.lat || null,
          lead.coordinates?.lon || null,
          lead.industry || 'Commercial Services',
          lead.category || 'General',
          lead.employeeRange || null,
          lead.foundedYear || null,
          lead.confidenceScore || 50,
          JSON.stringify(lead.confidenceSignals || []),
          lead.status || 'new',
          resolvedStageId,
          lead.opportunityValue || 0,
          lead.currency || 'USD',
          lead.winProbability || 0,
          lead.lostReason || null,
          JSON.stringify(lead.tags || []),
          lead.webMetadata ? JSON.stringify(lead.webMetadata) : null,
          lead.socialLinks ? JSON.stringify(lead.socialLinks) : null,
          lead.customFields ? JSON.stringify(lead.customFields) : null,
          lead.createdAt || now,
          now,
        ]
      );

      // Re-insert sources if present
      if (lead.sources && lead.sources.length > 0) {
        for (let idx = 0; idx < lead.sources.length; idx++) {
          const s = lead.sources[idx];
          const sId = `src-${lead.id}-${idx}`;
          await client.query(
            `INSERT INTO lead_sources (id, lead_id, source_name, provider_id, url, retrieved_at, license, attribution)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
               source_name = EXCLUDED.source_name,
               provider_id = EXCLUDED.provider_id,
               url = EXCLUDED.url,
               license = EXCLUDED.license,
               attribution = EXCLUDED.attribution,
               retrieved_at = EXCLUDED.retrieved_at`,
            [sId, lead.id, s.sourceName, s.providerId || null, s.url || null, s.retrievedAt || now, s.license || null, s.attribution || null]
          );
        }
      }

      // Reconcile identifiers transactionally: delete removed rows while preserving/updating remaining ones
      const normalizedIdentifiers = (lead.identifiers || [])
        .filter((ident) => ident && ident.value && ident.value.trim().length > 0)
        .map((ident, idx) => {
          const cCode = (ident.countryCode || lead.address?.countryCode || 'US').toUpperCase();
          const canonType = canonicalizeIdentifierType(ident.type, cCode);
          const rawVal = ident.value.trim();
          const normVal = ident.normalizedValue || normalizeIdentifierValue(rawVal);
          const status = ident.status || (ident.verified ? 'officially_verified' : 'user_provided');
          return {
            id: ident.id || `ident-${lead.id}-${idx}-${Date.now().toString(36).slice(-4)}`,
            type: canonType,
            value: rawVal,
            normalizedValue: normVal,
            countryCode: cCode,
            issuingAuthority: ident.issuingAuthority || undefined,
            source: ident.source || undefined,
            status,
            verified: ident.verified ?? status === 'officially_verified',
          };
        });

      const keptPairs = new Set(normalizedIdentifiers.map((i) => `${i.type}\u0000${i.value}`));
      const existingIdentRes = await client.query(
        'SELECT id, type, value FROM lead_identifiers WHERE lead_id = $1',
        [lead.id]
      );
      const idsToDelete = existingIdentRes.rows
        .filter((row: { id: string; type: string; value: string }) => {
          const canonRowType = canonicalizeIdentifierType(row.type, lead.address?.countryCode);
          return (
            !keptPairs.has(`${row.type}\u0000${row.value}`) &&
            !keptPairs.has(`${canonRowType}\u0000${row.value}`)
          );
        })
        .map((row: { id: string }) => row.id);

      if (idsToDelete.length > 0) {
        await client.query(
          'DELETE FROM lead_identifiers WHERE lead_id = $1 AND id = ANY($2::text[])',
          [lead.id, idsToDelete]
        );
      }

      for (const ident of normalizedIdentifiers) {
        // Also ensure legacy alias duplicate rows with identical normalized type don't collide
        await client.query(
          `INSERT INTO lead_identifiers (id, lead_id, type, value, verified, country_code, normalized_value, issuing_authority, source, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
           ON CONFLICT (lead_id, type, value) DO UPDATE SET
             verified = EXCLUDED.verified,
             country_code = COALESCE(EXCLUDED.country_code, lead_identifiers.country_code),
             normalized_value = COALESCE(EXCLUDED.normalized_value, lead_identifiers.normalized_value),
             issuing_authority = COALESCE(EXCLUDED.issuing_authority, lead_identifiers.issuing_authority),
             source = COALESCE(EXCLUDED.source, lead_identifiers.source),
             status = EXCLUDED.status`,
          [
            ident.id,
            lead.id,
            ident.type,
            ident.value,
            ident.verified,
            ident.countryCode,
            ident.normalizedValue,
            ident.issuingAuthority || null,
            ident.source || null,
            ident.status,
          ]
        );
      }

      // Re-insert notes if present
      if (lead.notes && lead.notes.length > 0) {
        for (const n of lead.notes) {
          await client.query(
            `INSERT INTO lead_notes (id, lead_id, content, author, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET
               content = EXCLUDED.content`,
            [n.id, lead.id, n.content, n.author || 'Owner', n.createdAt || now]
          );
        }
      }

      // Re-insert activities if present
      if (lead.activities && lead.activities.length > 0) {
        for (const a of lead.activities) {
          await client.query(
            `INSERT INTO activities (id, lead_id, type, title, notes, outcome, actor, date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (id) DO UPDATE SET
               title = EXCLUDED.title,
               notes = EXCLUDED.notes,
               outcome = EXCLUDED.outcome`,
            [a.id, lead.id, a.type || 'note', a.title, a.notes || null, a.outcome || null, a.actor || 'Owner', a.date || now]
          );
        }
      }

      await client.query('COMMIT');
      return {
        ...lead,
        pipelineStageId: resolvedStageId ?? undefined,
        registrationType: canonicalRegType || lead.registrationType,
        identifiers: normalizedIdentifiers,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async batchUpsertLeads(
    newLeads: CanonicalLead[],
    options: { skipDuplicates?: boolean; autoInitStagesIfEmpty?: boolean } = {}
  ): Promise<{
    added: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: Array<{ row: number; companyName?: string; error: string }>;
    savedLeadIds: string[];
  }> {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ row: number; companyName?: string; error: string }> = [];
    const savedLeadIds: string[] = [];

    const existingLeads = await this.getLeads();
    const byId = new Map<string, CanonicalLead>();
    const byDomain = new Map<string, CanonicalLead>();
    const byReg = new Map<string, CanonicalLead>();
    const byIdent = new Map<string, CanonicalLead>();
    const byPhone = new Map<string, CanonicalLead>();

    const normByType = (val?: string, t?: string, cCode?: string): string => {
      if (!val) return '';
      const ct = t ? canonicalizeIdentifierType(t, cCode) : '';
      if (ct === 'UK_CRN') return normalizeUkCrn(val);
      if (ct === 'US_CIK') return normalizeUsCik(val);
      return normalizeIdentifierValue(val);
    };

    const indexLead = (l: CanonicalLead) => {
      byId.set(l.id, l);
      if (l.domain) byDomain.set(l.domain.toLowerCase().trim(), l);
      if (l.registrationNumber) {
        const cleanReg = normByType(l.registrationNumber, l.registrationType, l.address?.countryCode);
        if (cleanReg.length >= 4) byReg.set(cleanReg, l);
      }
      for (const ident of l.identifiers || []) {
        const canonType = canonicalizeIdentifierType(ident.type, l.address?.countryCode);
        const cleanVal = normByType(ident.normalizedValue || ident.value, canonType, ident.countryCode || l.address?.countryCode);
        if (cleanVal.length >= 4) {
          byIdent.set(`${canonType}:${cleanVal}`, l);
        }
      }
      const pDigits = (l.phoneNormalized || l.phone || '').replace(/[^0-9]/g, '');
      if (pDigits.length >= 7) byPhone.set(pDigits, l);
    };

    for (const ex of existingLeads) indexLead(ex);

    for (let rowIdx = 0; rowIdx < newLeads.length; rowIdx++) {
      const rawLead = newLeads[rowIdx];
      try {
        if (!rawLead || typeof rawLead.companyName !== 'string' || !rawLead.companyName.trim()) {
          failed++;
          errors.push({ row: rowIdx + 1, error: 'Missing required companyName' });
          continue;
        }

        const lead: CanonicalLead = {
          ...rawLead,
          companyName: rawLead.companyName.trim(),
          registrationType: rawLead.registrationType
            ? canonicalizeIdentifierType(rawLead.registrationType, rawLead.address?.countryCode)
            : undefined,
          identifiers: (rawLead.identifiers || []).map((i) => ({
            ...i,
            type: canonicalizeIdentifierType(i.type, i.countryCode || rawLead.address?.countryCode),
            normalizedValue: i.normalizedValue || normalizeIdentifierValue(i.value),
          })),
        };

        let match: CanonicalLead | undefined = byId.get(lead.id);
        if (!match && lead.domain) match = byDomain.get(lead.domain.toLowerCase().trim());
        if (!match && lead.registrationNumber) {
          const cleanReg = normByType(lead.registrationNumber, lead.registrationType, lead.address?.countryCode);
          if (cleanReg.length >= 4) match = byReg.get(cleanReg);
        }
        if (!match) {
          for (const ident of lead.identifiers || []) {
            const cleanVal = normByType(ident.normalizedValue || ident.value, ident.type, ident.countryCode || lead.address?.countryCode);
            if (cleanVal.length >= 4 && ident.type !== 'DOMAIN' && ident.type !== 'PHONE' && ident.type !== 'EMAIL') {
              match = byIdent.get(`${ident.type}:${cleanVal}`);
              if (match) break;
            }
          }
        }
        if (!match) {
          const pDigits = (lead.phoneNormalized || lead.phone || '').replace(/[^0-9]/g, '');
          if (pDigits.length >= 7) match = byPhone.get(pDigits);
        }

        if (match) {
          if (options.skipDuplicates) {
            skipped++;
            continue;
          }
          const merged = mergeLeadWithTrustHierarchy(match, lead);
          const saved = await this.upsertLead(merged, {
            autoInitStagesIfEmpty: options.autoInitStagesIfEmpty ?? true,
          });
          indexLead(saved);
          savedLeadIds.push(saved.id);
          updated++;
        } else {
          const saved = await this.upsertLead(lead, {
            autoInitStagesIfEmpty: options.autoInitStagesIfEmpty ?? true,
          });
          indexLead(saved);
          savedLeadIds.push(saved.id);
          added++;
        }
      } catch (rowErr: unknown) {
        failed++;
        errors.push({
          row: rowIdx + 1,
          companyName: rawLead?.companyName,
          error: rowErr instanceof Error ? rowErr.message : String(rowErr),
        });
      }
    }
    return { added, updated, skipped, failed, errors, savedLeadIds };
  }

  public async deleteLead(id: string): Promise<boolean> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const { rowCount } = await client.query('DELETE FROM leads WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0;
    } finally {
      if (client) client.release();
    }
  }

  public async addNote(leadId: string, content: string, author: string): Promise<CanonicalLead | null> {
    const pool = this.getClient();
    const client = await pool.connect();
    const now = new Date().toISOString();
    const noteId = `note-${Date.now()}`;
    const actId = `act-${Date.now()}`;

    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO lead_notes (id, lead_id, content, author, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [noteId, leadId, content, author, now]
      );

      await client.query(
        `INSERT INTO activities (id, lead_id, type, title, notes, outcome, actor, date, created_at)
         VALUES ($1, $2, 'note', 'Added Note', $3, 'Note recorded in CRM', $4, $5, NOW())`,
        [actId, leadId, content.slice(0, 100), author, now]
      );

      await client.query(`UPDATE leads SET updated_at = NOW() WHERE id = $1`, [leadId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.getLead(leadId);
  }

  public async addActivity(leadId: string, activity: Omit<LeadActivity, 'id'>): Promise<CanonicalLead | null> {
    const pool = this.getClient();
    const client = await pool.connect();
    const now = new Date().toISOString();
    const actId = `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO activities (id, lead_id, type, title, notes, outcome, actor, date, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          actId,
          leadId,
          activity.type || 'call',
          activity.title,
          activity.notes || null,
          activity.outcome || null,
          activity.actor || 'Owner',
          activity.date || now,
        ]
      );

      await client.query(`UPDATE leads SET updated_at = NOW() WHERE id = $1`, [leadId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.getLead(leadId);
  }

  public async moveLeadStage(leadId: string, stageId: string, lostReason?: string, actor = 'Owner'): Promise<CanonicalLead | null> {
    const pool = this.getClient();
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await client.query('BEGIN');

      // Validate target stage exists in pipeline_stages before updating lead
      const stageRes = await client.query('SELECT id, name FROM pipeline_stages WHERE id = $1', [stageId]);
      if (stageRes.rows.length === 0) {
        throw new Error(`Invalid pipelineStageId "${stageId}": stage does not exist in pipeline_stages.`);
      }
      const targetStageName = stageRes.rows[0].name;

      const newStatus = lostReason ? 'lost' : stageId === 'stage-won' ? 'converted' : 'active';

      await client.query(
        `UPDATE leads SET
          pipeline_stage_id = $1,
          status = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE status END,
          lost_reason = $3,
          updated_at = NOW()
        WHERE id = $4`,
        [stageId, newStatus, lostReason || null, leadId]
      );

      const actId = `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      await client.query(
        `INSERT INTO activities (id, lead_id, type, title, notes, outcome, actor, date, created_at)
         VALUES ($1, $2, 'stage_change', $3, $4, $5, $6, $7, NOW())`,
        [
          actId,
          leadId,
          `Stage Changed: ${targetStageName}`,
          lostReason ? `Reason: ${lostReason}` : `Progressed to ${targetStageName}`,
          targetStageName,
          actor,
          now,
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.getLead(leadId);
  }

  // ==========================================
  // 2. PIPELINE STAGES
  // ==========================================

  public async getStages(): Promise<PipelineStage[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const { rows } = await client.query('SELECT id, name, color, display_order FROM pipeline_stages ORDER BY display_order ASC');
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        order: r.display_order,
      }));
    } finally {
      if (client) client.release();
    }
  }

  /**
   * Idempotently initializes default pipeline stages inside a transaction ONLY if pipeline_stages is currently empty.
   * Never deletes, overwrites, or duplicates existing pipeline stages.
   */
  public async initializeDefaultStages(options: { client?: pg.PoolClient } = {}): Promise<{
    initialized: boolean;
    insertedCount: number;
    stages: PipelineStage[];
  }> {
    const externalClient = options.client;
    const pool = externalClient ? null : this.getClient();
    const client = externalClient || (await pool!.connect());

    try {
      if (!externalClient) {
        await client.query('BEGIN');
      }

      const existingRes = await client.query(
        'SELECT id, name, color, display_order FROM pipeline_stages ORDER BY display_order ASC'
      );

      if (existingRes.rows.length > 0) {
        const existingStages: PipelineStage[] = existingRes.rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          order: r.display_order,
        }));
        if (!externalClient) {
          await client.query('COMMIT');
        }
        return {
          initialized: false,
          insertedCount: 0,
          stages: existingStages,
        };
      }

      let insertedCount = 0;
      for (const stage of DEFAULT_PIPELINE_STAGES) {
        const insRes = await client.query(
          `INSERT INTO pipeline_stages (id, name, color, display_order, created_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [stage.id, stage.name, stage.color, stage.order]
        );
        insertedCount += typeof insRes.rowCount === 'number' ? insRes.rowCount : 1;
      }

      const afterRes = await client.query(
        'SELECT id, name, color, display_order FROM pipeline_stages ORDER BY display_order ASC'
      );
      const stages: PipelineStage[] =
        afterRes.rows.length > 0
          ? afterRes.rows.map((r: any) => ({
              id: r.id,
              name: r.name,
              color: r.color,
              order: r.display_order,
            }))
          : DEFAULT_PIPELINE_STAGES.map((s) => ({
              id: s.id,
              name: s.name,
              color: s.color,
              order: s.order,
            }));

      if (!externalClient) {
        await client.query('COMMIT');
      }

      return {
        initialized: true,
        insertedCount,
        stages,
      };
    } catch (err) {
      if (!externalClient) {
        await client.query('ROLLBACK');
      }
      throw err;
    } finally {
      if (!externalClient) {
        client.release();
      }
    }
  }

  /**
   * Resolves a valid existing pipeline_stages.id inside an active transaction.
   * When pipeline_stages is empty and autoInitIfEmpty=true, initializes default stages idempotently first.
   * Never uses hardcoded stage IDs and rejects nonexistent explicit stage references.
   */
  private async resolvePipelineStageId(
    client: pg.PoolClient,
    requestedStageId?: string | null,
    autoInitIfEmpty = true
  ): Promise<string | null> {
    const existingRes = await client.query(
      'SELECT id, name, color, display_order FROM pipeline_stages ORDER BY display_order ASC'
    );
    let stages: PipelineStage[] = existingRes.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      order: r.display_order,
    }));

    if (stages.length === 0) {
      if (autoInitIfEmpty) {
        const init = await this.initializeDefaultStages({ client });
        stages = init.stages;
      } else {
        const reqClean = typeof requestedStageId === 'string' ? requestedStageId.trim() : '';
        if (reqClean) {
          throw new Error(
            `Invalid pipelineStageId "${reqClean}": no pipeline stages exist in pipeline_stages.`
          );
        }
        return null;
      }
    }

    const reqClean = typeof requestedStageId === 'string' ? requestedStageId.trim() : '';
    if (!reqClean) {
      return stages[0]?.id ?? null;
    }

    if (stages.some((s) => s.id === reqClean)) {
      return reqClean;
    }

    throw new Error(
      `Invalid pipelineStageId "${reqClean}": stage does not exist in pipeline_stages.`
    );
  }

  // ==========================================
  // 3. TASKS
  // ==========================================

  public async getTasks(): Promise<LeadTask[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const { rows } = await client.query('SELECT * FROM tasks ORDER BY due_date ASC');
      return rows.map((r: any) => ({
        id: r.id,
        leadId: r.lead_id,
        title: r.title,
        dueDate: r.due_date,
        priority: r.priority,
        completed: r.completed,
        assignedTo: r.assigned_to,
        createdAt: r.created_at,
      }));
    } finally {
      if (client) client.release();
    }
  }

  public async createTask(task: Omit<LeadTask, 'id' | 'createdAt'>): Promise<LeadTask> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const id = `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    try {
      client = await pool.connect();
      await client.query(
        `INSERT INTO tasks (id, lead_id, title, due_date, priority, completed, assigned_to, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, task.leadId || null, task.title, task.dueDate, task.priority, task.completed ?? false, task.assignedTo, now]
      );
      return { ...task, id, createdAt: now };
    } finally {
      if (client) client.release();
    }
  }

  public async updateTask(id: string, updates: Partial<LeadTask>): Promise<LeadTask | null> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;

    try {
      client = await pool.connect();
      const { rows } = await client.query('SELECT * FROM tasks WHERE id = $1', [id]);
      if (rows.length === 0) return null;

      const current = rows[0];
      const newCompleted = updates.completed !== undefined ? updates.completed : current.completed;
      const newTitle = updates.title || current.title;
      const newPriority = updates.priority || current.priority;
      const newDueDate = updates.dueDate || current.due_date;

      await client.query(
        `UPDATE tasks SET completed = $1, title = $2, priority = $3, due_date = $4 WHERE id = $5`,
        [newCompleted, newTitle, newPriority, newDueDate, id]
      );

      return {
        id,
        leadId: current.lead_id,
        title: newTitle,
        dueDate: newDueDate,
        priority: newPriority,
        completed: newCompleted,
        assignedTo: current.assigned_to,
        createdAt: current.created_at,
      };
    } finally {
      if (client) client.release();
    }
  }

  public async deleteTask(id: string): Promise<boolean> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const { rowCount } = await client.query('DELETE FROM tasks WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0;
    } finally {
      if (client) client.release();
    }
  }

  // ==========================================
  // 4. CAMPAIGNS & APPROVAL QUEUE
  // ==========================================

  public async getCampaigns(): Promise<OutreachCampaign[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const campsQuery = await client.query('SELECT * FROM campaigns ORDER BY created_at DESC');
      const msgsQuery = await client.query('SELECT * FROM campaign_messages ORDER BY created_at ASC');

      const msgsByCamp = new Map<string, CampaignMessage[]>();
      for (const msg of msgsQuery.rows) {
        if (!msgsByCamp.has(msg.campaign_id)) msgsByCamp.set(msg.campaign_id, []);
        msgsByCamp.get(msg.campaign_id)!.push({
          id: msg.id,
          campaignId: msg.campaign_id,
          leadId: msg.lead_id,
          leadCompanyName: msg.lead_company_name,
          recipientEmail: msg.recipient_email,
          subject: msg.subject,
          content: msg.content,
          status: msg.status,
          deliveryId: msg.delivery_id,
          scheduledAt: msg.scheduled_at,
          sentAt: msg.sent_at,
        });
      }

      return campsQuery.rows.map((c: any) => ({
        id: c.id,
        name: c.name,
        channel: c.channel,
        subjectTemplate: c.subject_template,
        bodyTemplate: c.body_template,
        targetIndustry: c.target_industry,
        targetCountry: c.target_country,
        status: c.status,
        createdAt: c.created_at,
        messages: msgsByCamp.get(c.id) || [],
      }));
    } finally {
      if (client) client.release();
    }
  }

  public async createCampaign(campaign: Omit<OutreachCampaign, 'id' | 'createdAt'>): Promise<OutreachCampaign> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const id = `camp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    try {
      client = await pool.connect();
      await client.query(
        `INSERT INTO campaigns (id, name, channel, subject_template, body_template, target_industry, target_country, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          campaign.name,
          campaign.channel || 'email',
          campaign.subjectTemplate,
          campaign.bodyTemplate,
          campaign.targetIndustry || null,
          campaign.targetCountry || null,
          campaign.status || 'active',
          now,
        ]
      );

      return {
        ...campaign,
        id,
        createdAt: now,
        messages: [],
      };
    } finally {
      if (client) client.release();
    }
  }

  public async saveCampaignMessages(campaignId: string, messages: CampaignMessage[]): Promise<void> {
    const pool = this.getClient();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      for (const msg of messages) {
        await client.query(
          `INSERT INTO campaign_messages (
            id, campaign_id, lead_id, lead_company_name, recipient_email, subject, content, status, delivery_id, scheduled_at, sent_at, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            delivery_id = EXCLUDED.delivery_id,
            sent_at = EXCLUDED.sent_at`,
          [
            msg.id,
            campaignId,
            msg.leadId,
            msg.leadCompanyName,
            msg.recipientEmail || null,
            msg.subject,
            msg.content,
            msg.status || 'pending_approval',
            msg.deliveryId || null,
            msg.scheduledAt || null,
            msg.sentAt || null,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async updateCampaignMessageStatus(
    campaignId: string,
    messageId: string,
    status: 'pending_approval' | 'approved' | 'sent' | 'rejected' | 'opted_out',
    actor = 'Owner'
  ): Promise<boolean> {
    const pool = this.getClient();
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await client.query('BEGIN');

      const deliveryId = status === 'sent' ? `deliv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}` : null;
      const sentAt = status === 'sent' ? now : null;

      const res = await client.query(
        `UPDATE campaign_messages SET
          status = $1,
          delivery_id = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE delivery_id END,
          sent_at = CASE WHEN $3::timestamptz IS NOT NULL THEN $3::timestamptz ELSE sent_at END
        WHERE id = $4 AND campaign_id = $5
        RETURNING lead_id, subject`,
        [status, deliveryId, sentAt, messageId, campaignId]
      );

      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      // If message sent, log an activity on the recipient lead
      if (status === 'sent') {
        const { lead_id, subject } = res.rows[0];
        const actId = `act-${Date.now()}`;
        await client.query(
          `INSERT INTO activities (id, lead_id, type, title, notes, outcome, actor, date, created_at)
           VALUES ($1, $2, 'email', $3, 'Outreach campaign message dispatched', $4, $5, NOW(), NOW())`,
          [actId, lead_id, `Campaign Sent: ${subject}`, `Delivery ID: ${deliveryId}`, actor]
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // 5. MERGE HISTORY & RESTORATION (UNDO)
  // ==========================================

  public async recordMerge(historyRecord: MergeHistoryRecord): Promise<void> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query(
        `INSERT INTO lead_merge_history (id, survivor_lead_id, merged_lead_snapshot, merged_reason, actor, merged_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          historyRecord.id,
          historyRecord.survivorLeadId,
          JSON.stringify(historyRecord.mergedLeadSnapshot),
          historyRecord.mergedReason,
          'Owner',
          historyRecord.mergedAt || new Date().toISOString(),
        ]
      );
    } finally {
      if (client) client.release();
    }
  }

  public async getMergeHistory(): Promise<MergeHistoryRecord[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const { rows } = await client.query('SELECT * FROM lead_merge_history ORDER BY merged_at DESC');
      return rows.map((r: any) => ({
        id: r.id,
        survivorLeadId: r.survivor_lead_id,
        mergedLeadSnapshot: typeof r.merged_lead_snapshot === 'string' ? JSON.parse(r.merged_lead_snapshot) : r.merged_lead_snapshot,
        mergedReason: r.merged_reason,
        mergedAt: r.merged_at,
      }));
    } finally {
      if (client) client.release();
    }
  }

  public async undoMerge(historyId: string): Promise<boolean> {
    const pool = this.getClient();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM lead_merge_history WHERE id = $1', [historyId]);
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const record = rows[0];
      const snapshot: CanonicalLead =
        typeof record.merged_lead_snapshot === 'string'
          ? JSON.parse(record.merged_lead_snapshot)
          : record.merged_lead_snapshot;

      // Re-insert the restored lead
      await this.upsertLead(snapshot);

      // Remove merge record
      await client.query('DELETE FROM lead_merge_history WHERE id = $1', [historyId]);

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // 6. APPLICATION SETTINGS
  // ==========================================

  public async getSettings(): Promise<AppSettings> {
    ensureConnectorsRegistered();
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const settingsRes = await client.query('SELECT * FROM app_settings WHERE id = $1', ['primary_settings']);

      let companiesHouseApiKey: string | undefined;
      try {
        const chConn = connectorRegistry.getById('conn-companies-house');
        if (chConn) {
          const resolved = await credentialManager.resolveCredentialForExecution(
            'conn-companies-house',
            chConn.getMetadata().credentialRequirements,
            pool
          );
          if (resolved.credentials.apiKey) {
            companiesHouseApiKey = resolved.credentials.apiKey;
          }
        }
      } catch {
        // Encryption key missing or unreadable: leave companiesHouseApiKey undefined so settings endpoint remains resilient
      }

      if (settingsRes.rows.length > 0) {
        const r = settingsRes.rows[0];
        const rawConfigs =
          typeof r.connector_configs === 'string'
            ? JSON.parse(r.connector_configs)
            : r.connector_configs || {};
        return {
          ownerName: r.owner_name,
          ownerEmail: r.owner_email,
          defaultCountry: r.default_country,
          defaultCurrency: r.default_currency,
          companiesHouseApiKey,
          userAgent: r.user_agent,
          enableSafeWebsiteCrawl: r.enable_safe_website_crawl,
          outreachApprovalRequired: r.outreach_approval_required,
          autoDedupeThreshold: parseFloat(r.auto_dedupe_threshold),
          suppressionDomains: typeof r.suppression_domains === 'string' ? JSON.parse(r.suppression_domains) : r.suppression_domains || [],
          connectorConfigs: rawConfigs,
        };
      }

      // Default fallback if not yet initialized in DB
      return {
        ownerName: 'Lead Intelligence Operator',
        ownerEmail: 'owner@pipeline.local',
        defaultCountry: 'GB',
        defaultCurrency: 'USD',
        companiesHouseApiKey,
        userAgent: 'GlobalLeadPipeline/1.0',
        enableSafeWebsiteCrawl: true,
        outreachApprovalRequired: true,
        autoDedupeThreshold: 0.85,
        suppressionDomains: ['example.com', 'test.com', 'spamdomain.org'],
        connectorConfigs: {},
      };
    } finally {
      if (client) client.release();
    }
  }

  public async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    ensureConnectorsRegistered();
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const current = await this.getSettings();
    const updated: AppSettings = {
      ...current,
      ...updates,
      connectorConfigs: updates.connectorConfigs
        ? { ...(current.connectorConfigs || {}), ...updates.connectorConfigs }
        : current.connectorConfigs || {},
    };

    try {
      client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO app_settings (
            id, owner_name, owner_email, default_country, default_currency, user_agent,
            enable_safe_website_crawl, outreach_approval_required, auto_dedupe_threshold, suppression_domains, connector_configs, updated_at
          ) VALUES ('primary_settings', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          ON CONFLICT (id) DO UPDATE SET
            owner_name = EXCLUDED.owner_name,
            owner_email = EXCLUDED.owner_email,
            default_country = EXCLUDED.default_country,
            default_currency = EXCLUDED.default_currency,
            user_agent = EXCLUDED.user_agent,
            enable_safe_website_crawl = EXCLUDED.enable_safe_website_crawl,
            outreach_approval_required = EXCLUDED.outreach_approval_required,
            auto_dedupe_threshold = EXCLUDED.auto_dedupe_threshold,
            suppression_domains = EXCLUDED.suppression_domains,
            connector_configs = EXCLUDED.connector_configs,
            updated_at = NOW()`,
          [
            updated.ownerName,
            updated.ownerEmail,
            updated.defaultCountry,
            updated.defaultCurrency,
            updated.userAgent,
            updated.enableSafeWebsiteCrawl,
            updated.outreachApprovalRequired,
            updated.autoDedupeThreshold,
            JSON.stringify(updated.suppressionDomains),
            JSON.stringify(updated.connectorConfigs || {}),
          ]
        );
      } catch {
        // Fallback when Migration 004 connector_configs column has not yet been applied
        await client.query(
          `INSERT INTO app_settings (
            id, owner_name, owner_email, default_country, default_currency, user_agent,
            enable_safe_website_crawl, outreach_approval_required, auto_dedupe_threshold, suppression_domains, updated_at
          ) VALUES ('primary_settings', $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (id) DO UPDATE SET
            owner_name = EXCLUDED.owner_name,
            owner_email = EXCLUDED.owner_email,
            default_country = EXCLUDED.default_country,
            default_currency = EXCLUDED.default_currency,
            user_agent = EXCLUDED.user_agent,
            enable_safe_website_crawl = EXCLUDED.enable_safe_website_crawl,
            outreach_approval_required = EXCLUDED.outreach_approval_required,
            auto_dedupe_threshold = EXCLUDED.auto_dedupe_threshold,
            suppression_domains = EXCLUDED.suppression_domains,
            updated_at = NOW()`,
          [
            updated.ownerName,
            updated.ownerEmail,
            updated.defaultCountry,
            updated.defaultCurrency,
            updated.userAgent,
            updated.enableSafeWebsiteCrawl,
            updated.outreachApprovalRequired,
            updated.autoDedupeThreshold,
            JSON.stringify(updated.suppressionDomains),
          ]
        );
      }

      // Store/rotate Companies House key ONLY when a non-empty string is explicitly provided.
      // Never wipe existing working credentials when omitted or blank.
      if (typeof updates.companiesHouseApiKey === 'string' && updates.companiesHouseApiKey.trim().length > 0) {
        const keyVal = updates.companiesHouseApiKey.trim();
        const chConn = connectorRegistry.getById('conn-companies-house');
        if (chConn) {
          await credentialManager.setCredential(
            'conn-companies-house',
            { apiKey: keyVal },
            chConn.getMetadata().credentialRequirements,
            { isRotation: Boolean(current.companiesHouseApiKey), customPool: pool }
          );
          updated.companiesHouseApiKey = keyVal;
        }
      }

      return updated;
    } finally {
      if (client) client.release();
    }
  }

  // ==========================================
  // 7. CONNECTORS, CAPABILITY OVERRIDES & AUDIT
  // ==========================================

  public async getCapabilityOverrides(): Promise<Map<string, { lastCheckedAt?: string; notes?: string }>> {
    const overrides = new Map<string, { lastCheckedAt?: string; notes?: string }>();
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const tblCheck = await client.query(`SELECT to_regclass('public.country_source_capabilities') as tbl`);
      if (!tblCheck.rows[0]?.tbl) return overrides;
      const { rows } = await client.query(
        'SELECT country_code, notes, last_checked_at FROM country_source_capabilities'
      );
      for (const r of rows) {
        if (r.country_code) {
          overrides.set(String(r.country_code).toUpperCase(), {
            lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : undefined,
            notes: r.notes || undefined,
          });
        }
      }
      return overrides;
    } catch {
      return overrides;
    } finally {
      if (client) client.release();
    }
  }

  public async getConnectorConfigs(): Promise<Record<string, ConnectorConfigRecord>> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const { rows } = await client.query('SELECT connector_configs FROM app_settings WHERE id = $1', ['primary_settings']);
      if (rows.length > 0 && rows[0].connector_configs) {
        const parsed =
          typeof rows[0].connector_configs === 'string'
            ? JSON.parse(rows[0].connector_configs)
            : rows[0].connector_configs;
        if (parsed && typeof parsed === 'object') {
          const filtered: Record<string, ConnectorConfigRecord> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, ConnectorConfigRecord>)) {
            if (!k.startsWith('__')) {
              filtered[k] = v;
            }
          }
          return filtered;
        }
      }
      return {};
    } catch {
      return {};
    } finally {
      if (client) client.release();
    }
  }

  public async updateConnectorConfig(
    connectorId: string,
    partial: Partial<ConnectorConfigRecord>
  ): Promise<ConnectorConfigRecord> {
    ensureConnectorsRegistered();
    const connector = connectorRegistry.getById(connectorId);
    const meta = connector?.getMetadata();
    const currentConfigs = await this.getConnectorConfigs();
    const existing = currentConfigs[connectorId];
    const nextConfig: ConnectorConfigRecord = {
      connectorId,
      enabled: partial.enabled ?? existing?.enabled ?? true,
      timeoutMs: partial.timeoutMs ?? existing?.timeoutMs ?? meta?.executionPolicy.timeoutMs,
      maxRetries: partial.maxRetries ?? existing?.maxRetries ?? meta?.executionPolicy.maxRetries,
      rateLimitMax: partial.rateLimitMax ?? existing?.rateLimitMax ?? meta?.executionPolicy.rateLimit.maxRequests,
      rateLimitWindowMs:
        partial.rateLimitWindowMs ?? existing?.rateLimitWindowMs ?? meta?.executionPolicy.rateLimit.windowMs,
      customConfig: partial.customConfig ?? existing?.customConfig,
      updatedAt: new Date().toISOString(),
    };

    const mergedConfigs = {
      ...currentConfigs,
      [connectorId]: nextConfig,
    };

    connectorRegistry.setEnabledOverride(connectorId, nextConfig.enabled);
    await this.updateSettings({ connectorConfigs: mergedConfigs });
    return nextConfig;
  }

  public async recordConnectorRun(run: ConnectorRunRecord): Promise<void> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO connector_runs (
            id, connector_id, query_params, total_found, total_saved, status, error_message, executed_at,
            operation, started_at, completed_at, duration_ms, records_discovered, records_normalized,
            records_rejected, error_category, diagnostic_summary, rate_limit_remaining, rate_limit_reset_at, request_id
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20
          )`,
          [
            run.id,
            run.connectorId,
            run.queryParams ? JSON.stringify(run.queryParams) : null,
            run.recordsDiscovered ?? 0,
            run.recordsNormalized ?? 0,
            run.status,
            run.diagnosticSummary || null,
            run.completedAt || run.startedAt || new Date().toISOString(),
            run.operation,
            run.startedAt,
            run.completedAt || null,
            run.durationMs ?? null,
            run.recordsDiscovered ?? 0,
            run.recordsNormalized ?? 0,
            run.recordsRejected ?? 0,
            run.errorCategory || null,
            run.diagnosticSummary || null,
            run.rateLimitRemaining ?? null,
            run.rateLimitResetAt || null,
            run.requestId || null,
          ]
        );
      } catch {
        // Fallback when Migration 004 columns have not yet been applied
        await client.query(
          `INSERT INTO connector_runs (id, connector_id, query_params, total_found, total_saved, status, error_message, executed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            run.id,
            run.connectorId,
            run.queryParams ? JSON.stringify(run.queryParams) : null,
            run.recordsDiscovered ?? 0,
            run.recordsNormalized ?? 0,
            run.status === 'cancelled' ? 'error' : run.status,
            run.diagnosticSummary || null,
            run.completedAt || run.startedAt || new Date().toISOString(),
          ]
        );
      }
    } catch (err) {
      console.warn('[PostgresStorage] Could not record connector run:', err);
    } finally {
      if (client) client.release();
    }
  }

  public async getConnectorRuns(connectorId?: string, limit = 50): Promise<ConnectorRunRecord[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const whereClause = connectorId ? 'WHERE connector_id = $1' : '';
      const params = connectorId ? [connectorId, limit] : [limit];
      const limitParam = connectorId ? '$2' : '$1';

      try {
        const { rows } = await client.query(
          `SELECT id, connector_id, operation, query_params, started_at, completed_at, executed_at,
                  duration_ms, status, records_discovered, records_normalized, records_rejected,
                  total_found, total_saved, error_category, diagnostic_summary, error_message,
                  rate_limit_remaining, rate_limit_reset_at, request_id
           FROM connector_runs
           ${whereClause}
           ORDER BY COALESCE(started_at, executed_at) DESC
           LIMIT ${limitParam}`,
          params
        );
        return rows.map((r: any) => ({
          id: r.id,
          connectorId: r.connector_id,
          operation: (r.operation || 'search') as ConnectorRunRecord['operation'],
          queryParams:
            r.query_params && typeof r.query_params === 'string'
              ? JSON.parse(r.query_params)
              : r.query_params || undefined,
          startedAt: new Date(r.started_at || r.executed_at).toISOString(),
          completedAt: r.completed_at
            ? new Date(r.completed_at).toISOString()
            : r.executed_at
            ? new Date(r.executed_at).toISOString()
            : undefined,
          durationMs: r.duration_ms !== null && r.duration_ms !== undefined ? Number(r.duration_ms) : undefined,
          status: (r.status || 'success') as ConnectorRunRecord['status'],
          recordsDiscovered: Number(r.records_discovered ?? r.total_found ?? 0),
          recordsNormalized: Number(r.records_normalized ?? r.total_saved ?? 0),
          recordsRejected: Number(r.records_rejected ?? 0),
          errorCategory: (r.error_category || undefined) as ConnectorErrorCategory | undefined,
          diagnosticSummary: r.diagnostic_summary || r.error_message || undefined,
          rateLimitRemaining:
            r.rate_limit_remaining !== null && r.rate_limit_remaining !== undefined
              ? Number(r.rate_limit_remaining)
              : undefined,
          rateLimitResetAt: r.rate_limit_reset_at
            ? new Date(r.rate_limit_reset_at).toISOString()
            : undefined,
          requestId: r.request_id || undefined,
        }));
      } catch {
        // Fallback when Migration 004 columns have not yet been applied
        const { rows } = await client.query(
          `SELECT id, connector_id, query_params, total_found, total_saved, status, error_message, executed_at
           FROM connector_runs
           ${whereClause}
           ORDER BY executed_at DESC
           LIMIT ${limitParam}`,
          params
        );
        return rows.map((r: any) => ({
          id: r.id,
          connectorId: r.connector_id,
          operation: 'search',
          queryParams:
            r.query_params && typeof r.query_params === 'string'
              ? JSON.parse(r.query_params)
              : r.query_params || undefined,
          startedAt: new Date(r.executed_at).toISOString(),
          completedAt: new Date(r.executed_at).toISOString(),
          status: (r.status || 'success') as ConnectorRunRecord['status'],
          recordsDiscovered: Number(r.total_found ?? 0),
          recordsNormalized: Number(r.total_saved ?? 0),
          recordsRejected: 0,
          diagnosticSummary: r.error_message || undefined,
        }));
      }
    } catch {
      return [];
    } finally {
      if (client) client.release();
    }
  }

  public async getConnectors(): Promise<ConnectorStatus[]> {
    ensureConnectorsRegistered();
    const [runs, configs] = await Promise.all([
      this.getConnectorRuns(undefined, 250),
      this.getConnectorConfigs(),
    ]);

    for (const [id, cfg] of Object.entries(configs)) {
      if (typeof cfg?.enabled === 'boolean') {
        connectorRegistry.setEnabledOverride(id, cfg.enabled);
      }
    }

    const statsMap = aggregateRunsByConnector(runs);
    return Promise.all(
      connectorRegistry.listAll().map((connector) =>
        buildUnifiedConnectorStatus(connector, {
          stats: statsMap.get(connector.id),
          config: configs[connector.id],
        })
      )
    );
  }

  public async recordConnectorActivity(connectorId: string, success: boolean, errorMessage?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.recordConnectorRun({
      id: `run-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      connectorId,
      operation: 'search',
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      status: success ? 'success' : 'error',
      recordsDiscovered: 0,
      recordsNormalized: 0,
      recordsRejected: 0,
      diagnosticSummary: errorMessage,
    });
  }

  public async recordAuditEvent(
    action: string,
    actorEmail: string,
    entityType?: string,
    entityId?: string,
    details?: any,
    ipAddress?: string
  ): Promise<AuditEventRecord | null> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      client = await pool.connect();
      const res = await client.query(
        `INSERT INTO audit_events (id, action, actor_email, entity_type, entity_id, details, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING id, sequence_number as "sequenceNumber", action, actor_email as "actorEmail",
                   entity_type as "entityType", entity_id as "entityId", details, ip_address as "ipAddress",
                   created_at as "createdAt", prev_hash as "prevHash", current_hash as "currentHash", hash_version as "hashVersion"`,
        [id, action, actorEmail, entityType || null, entityId || null, details ? JSON.stringify(details) : null, ipAddress || null]
      );
      if (res.rows.length > 0) {
        const r = res.rows[0];
        return {
          ...r,
          sequenceNumber: r.sequenceNumber ? parseInt(r.sequenceNumber, 10) : undefined,
          createdAt: new Date(r.createdAt).toISOString(),
        };
      }
      return null;
    } catch (err) {
      console.warn('[PostgresStorage] Could not record audit event:', err);
      return null;
    } finally {
      if (client) client.release();
    }
  }

  public async getAuditEvents(limit = 100): Promise<AuditEventRecord[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const { rows } = await client.query(
        `SELECT id, sequence_number as "sequenceNumber", action, actor_email as "actorEmail", entity_type as "entityType",
                entity_id as "entityId", details, ip_address as "ipAddress", created_at as "createdAt",
                prev_hash as "prevHash", current_hash as "currentHash", hash_version as "hashVersion"
         FROM audit_events
         ORDER BY sequence_number DESC NULLS LAST, created_at DESC
         LIMIT $1`,
        [limit]
      );
      return rows.map((r: any) => ({
        ...r,
        sequenceNumber: r.sequenceNumber ? parseInt(r.sequenceNumber, 10) : undefined,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
      }));
    } catch (err) {
      console.warn('[PostgresStorage] Could not fetch audit events:', err);
      return [];
    } finally {
      if (client) client.release();
    }
  }

  /**
   * Cryptographically verifies the sequential integrity of the audit_events hash chain.
   * Checks sequence continuity (1..N), genesis/prev_hash linking, and recalculates SHA-256 digests.
   * Reports the first broken, missing, or tampered sequence number with full diagnostic context.
   */
  public async verifyAuditLogIntegrity(customClient?: pg.PoolClient | pg.Pool): Promise<AuditVerificationResult> {
    const pool = customClient || this.getClient();
    let client: pg.PoolClient | null = null;
    const isDedicatedPool = 'connect' in pool && typeof (pool as any).connect === 'function';

    try {
      client = isDedicatedPool ? await (pool as pg.Pool).connect() : (pool as pg.PoolClient);

      const { rows } = await client.query(`
        SELECT 
          id,
          sequence_number as "sequenceNumber",
          action,
          actor_email as "actorEmail",
          entity_type as "entityType",
          entity_id as "entityId",
          details,
          ip_address as "ipAddress",
          created_at as "createdAt",
          prev_hash as "prevHash",
          current_hash as "currentHash",
          hash_version as "hashVersion",
          LAG(current_hash) OVER (ORDER BY sequence_number ASC) as "expectedPrevHash",
          LAG(sequence_number) OVER (ORDER BY sequence_number ASC) as "prevSeqNumber",
          encode(sha256((
            sequence_number::TEXT || '|' ||
            id || '|' ||
            action || '|' ||
            actor_email || '|' ||
            COALESCE(entity_type, '') || '|' ||
            COALESCE(entity_id, '') || '|' ||
            COALESCE(details::TEXT, '{}') || '|' ||
            COALESCE(ip_address, '') || '|' ||
            TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
            prev_hash
          )::bytea), 'hex') as "computedHash"
        FROM audit_events
        ORDER BY sequence_number ASC
      `);

      if (rows.length === 0) {
        return {
          valid: true,
          totalEvents: 0,
          genesisHash: AUDIT_GENESIS_HASH,
          verifiedAt: new Date().toISOString(),
        };
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const seq = parseInt(row.sequenceNumber, 10);
        const expectedSeq = i + 1;

        // 1. Contiguous sequence verification
        if (seq !== expectedSeq) {
          return {
            valid: false,
            totalEvents: rows.length,
            firstInvalidSequence: expectedSeq,
            genesisHash: AUDIT_GENESIS_HASH,
            error: `Sequence gap or out-of-order event detected. Expected sequence ${expectedSeq}, found ${seq}.`,
            details: `Event ID: ${row.id}`,
            verifiedAt: new Date().toISOString(),
          };
        }

        // 2. Genesis / previous hash chain continuity
        if (i === 0) {
          if (row.prevHash !== AUDIT_GENESIS_HASH) {
            return {
              valid: false,
              totalEvents: rows.length,
              firstInvalidSequence: 1,
              genesisHash: AUDIT_GENESIS_HASH,
              error: `Invalid genesis prev_hash on first audit event. Expected ${AUDIT_GENESIS_HASH}, found ${row.prevHash}.`,
              details: `Event ID: ${row.id}`,
              verifiedAt: new Date().toISOString(),
            };
          }
        } else {
          const expectedPrevHash = row.expectedPrevHash;
          if (row.prevHash !== expectedPrevHash) {
            return {
              valid: false,
              totalEvents: rows.length,
              firstInvalidSequence: seq,
              genesisHash: AUDIT_GENESIS_HASH,
              error: `Broken cryptographic chain at sequence ${seq}. prev_hash does not match prior record's current_hash.`,
              details: `Expected: ${expectedPrevHash}, Found: ${row.prevHash}`,
              verifiedAt: new Date().toISOString(),
            };
          }
        }

        // 3. Cryptographic hash content integrity
        if (row.currentHash !== row.computedHash) {
          return {
            valid: false,
            totalEvents: rows.length,
            firstInvalidSequence: seq,
            genesisHash: AUDIT_GENESIS_HASH,
            error: `Hash digest mismatch at sequence ${seq}. Event content or metadata has been altered after record insertion.`,
            details: `Stored Hash: ${row.currentHash}, Recomputed Digest: ${row.computedHash}`,
            verifiedAt: new Date().toISOString(),
          };
        }
      }

      const lastRow = rows[rows.length - 1];
      return {
        valid: true,
        totalEvents: rows.length,
        latestSequence: parseInt(lastRow.sequenceNumber, 10),
        genesisHash: AUDIT_GENESIS_HASH,
        headHash: lastRow.currentHash,
        verifiedAt: new Date().toISOString(),
      };
    } finally {
      if (client && isDedicatedPool && 'release' in client) {
        try {
          (client as pg.PoolClient).release();
        } catch {
          // ignore
        }
      }
    }
  }

  public async getDatabaseSecurityStatus(): Promise<{
    diagnosticState: 'verified' | 'unavailable' | 'error';
    tlsProbeStatus: 'verified' | 'unavailable' | 'error';
    auditTriggerProbeStatus: 'verified' | 'unavailable' | 'error';
    sessionProbeStatus: 'verified' | 'unavailable' | 'error';
    credentialProbeStatus: 'verified' | 'unavailable' | 'error';
    tlsEncrypted: boolean;
    sslSetting: string;
    auditUpdateDeleteTrigger: boolean;
    auditTruncateTrigger: boolean;
    activeSessionCount: number | null;
    totalSessionCount: number | null;
    encryptedCredentialCount: number | null;
  }> {
    let pool: pg.Pool;
    try {
      pool = this.getClient();
    } catch {
      return {
        diagnosticState: 'unavailable',
        tlsProbeStatus: 'unavailable',
        auditTriggerProbeStatus: 'unavailable',
        sessionProbeStatus: 'unavailable',
        credentialProbeStatus: 'unavailable',
        tlsEncrypted: false,
        sslSetting: 'unavailable',
        auditUpdateDeleteTrigger: false,
        auditTruncateTrigger: false,
        activeSessionCount: null,
        totalSessionCount: null,
        encryptedCredentialCount: null,
      };
    }

    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();

      let tlsProbeStatus: 'verified' | 'error' = 'verified';
      let sslSetting = 'unknown';
      let tlsEncrypted = false;
      try {
        const [sslSettingSettled, sslUsedSettled] = await Promise.allSettled([
          client.query(`SHOW ssl`),
          client.query(`SELECT ssl_is_used() as used`),
        ]);
        if (sslSettingSettled.status === 'rejected' && sslUsedSettled.status === 'rejected') {
          tlsProbeStatus = 'error';
          sslSetting = 'error';
          console.warn('[DB Security] TLS probe failed.');
        } else {
          if (sslSettingSettled.status === 'fulfilled') {
            sslSetting = String(sslSettingSettled.value.rows[0]?.ssl || 'unknown');
          }
          const sslUsedVal =
            sslUsedSettled.status === 'fulfilled' ? sslUsedSettled.value.rows[0]?.used : null;
          tlsEncrypted = sslUsedVal === true || sslSetting.toLowerCase() === 'on';
        }
      } catch {
        tlsProbeStatus = 'error';
        sslSetting = 'error';
      }

      let auditTriggerProbeStatus: 'verified' | 'error' = 'verified';
      let auditUpdateDeleteTrigger = false;
      let auditTruncateTrigger = false;
      try {
        const trigRes = await client.query(
          `SELECT tgname FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
           WHERE c.relname = 'audit_events' AND NOT t.tgisinternal`
        );
        const trigNames = new Set((trigRes.rows || []).map((r: any) => String(r.tgname)));
        auditUpdateDeleteTrigger = trigNames.has('trg_audit_events_prevent_update_delete');
        auditTruncateTrigger = trigNames.has('trg_audit_events_prevent_truncate');
      } catch {
        auditTriggerProbeStatus = 'error';
        console.warn('[DB Security] Audit trigger verification query failed.');
      }

      let sessionProbeStatus: 'verified' | 'error' = 'verified';
      let activeSessionCount: number | null = null;
      let totalSessionCount: number | null = null;
      try {
        const sessRes = await client.query(
          `SELECT COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW()) AS active_cnt,
                  COUNT(*) AS total_cnt
           FROM owner_sessions`
        );
        const parsedActive = Number.parseInt(String(sessRes.rows[0]?.active_cnt ?? ''), 10);
        const parsedTotal = Number.parseInt(String(sessRes.rows[0]?.total_cnt ?? ''), 10);
        if (!Number.isFinite(parsedActive) || !Number.isFinite(parsedTotal)) {
          sessionProbeStatus = 'error';
        } else {
          activeSessionCount = parsedActive;
          totalSessionCount = parsedTotal;
        }
      } catch {
        sessionProbeStatus = 'error';
        console.warn('[DB Security] Session diagnostic query failed.');
      }

      let credentialProbeStatus: 'verified' | 'error' = 'verified';
      let encryptedCredentialCount: number | null = null;
      try {
        const credRes = await client.query(
          `SELECT COUNT(*) AS cnt
           FROM connector_credentials
           WHERE encrypted_payload IS NOT NULL AND encrypted_payload <> ''`
        );
        const parsedCred = Number.parseInt(String(credRes.rows[0]?.cnt ?? ''), 10);
        if (!Number.isFinite(parsedCred)) {
          credentialProbeStatus = 'error';
        } else {
          encryptedCredentialCount = parsedCred;
        }
      } catch {
        credentialProbeStatus = 'error';
        console.warn('[DB Security] Credential diagnostic query failed.');
      }

      const anyError =
        tlsProbeStatus === 'error' ||
        auditTriggerProbeStatus === 'error' ||
        sessionProbeStatus === 'error' ||
        credentialProbeStatus === 'error';

      return {
        diagnosticState: anyError ? 'error' : 'verified',
        tlsProbeStatus,
        auditTriggerProbeStatus,
        sessionProbeStatus,
        credentialProbeStatus,
        tlsEncrypted,
        sslSetting,
        auditUpdateDeleteTrigger,
        auditTruncateTrigger,
        activeSessionCount,
        totalSessionCount,
        encryptedCredentialCount,
      };
    } catch {
      console.warn('[DB Security] Failed to acquire database connection for security diagnostics.');
      return {
        diagnosticState: 'error',
        tlsProbeStatus: 'error',
        auditTriggerProbeStatus: 'error',
        sessionProbeStatus: 'error',
        credentialProbeStatus: 'error',
        tlsEncrypted: false,
        sslSetting: 'error',
        auditUpdateDeleteTrigger: false,
        auditTruncateTrigger: false,
        activeSessionCount: null,
        totalSessionCount: null,
        encryptedCredentialCount: null,
      };
    } finally {
      if (client) client.release();
    }
  }

  public async getDetailedDiagnostics(): Promise<{
    version: string;
    currentDatabase: string;
    currentUser: string;
    databaseSize: string;
    pool: { total: number; idle: number; waiting: number };
    tables: Array<{ name: string; count: number }>;
    totalRows: number;
  }> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const [verRes, dbRes, userRes, sizeRes] = await Promise.all([
        client.query('SELECT version()'),
        client.query('SELECT current_database()'),
        client.query('SELECT current_user'),
        client.query('SELECT pg_size_pretty(pg_database_size(current_database())) as size'),
      ]);

      const tableNames = [
        'schema_migrations',
        'owner_users',
        'owner_sessions',
        'pipeline_stages',
        'leads',
        'lead_sources',
        'lead_identifiers',
        'lead_notes',
        'activities',
        'tasks',
        'campaigns',
        'campaign_messages',
        'lead_merge_history',
        'connector_credentials',
        'connector_runs',
        'audit_events',
        'app_settings',
        'country_source_capabilities',
        'persons',
        'company_person_relationships',
        'import_mapping_templates',
        'import_batches',
        'import_batch_rows',
      ];

      const counts = await Promise.all(
        tableNames.map(async (table) => {
          try {
            const r = await client!.query(`SELECT COUNT(*) FROM "${table}"`);
            return { name: table, count: parseInt(r.rows[0].count, 10) };
          } catch {
            return { name: table, count: 0 };
          }
        })
      );

      const totalRows = counts.reduce((acc, curr) => acc + curr.count, 0);

      return {
        version: verRes.rows[0]?.version || 'Unknown',
        currentDatabase: dbRes.rows[0]?.current_database || 'Unknown',
        currentUser: userRes.rows[0]?.current_user || 'Unknown',
        databaseSize: sizeRes.rows[0]?.size || 'Unknown',
        pool: {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        },
        tables: counts,
        totalRows,
      };
    } finally {
      if (client) client.release();
    }
  }


  // ==========================================
  // 8. PHASE 7: PERSONS, M:N RELATIONSHIPS & IMPORT ENGINE
  // ==========================================

  private async ensureMigration005Tables(client: pg.PoolClient): Promise<void> {
    const res = await client.query(
      `SELECT to_regclass('public.persons') as persons,
              to_regclass('public.company_person_relationships') as rels,
              to_regclass('public.import_mapping_templates') as templates,
              to_regclass('public.import_batches') as batches,
              to_regclass('public.import_batch_rows') as batch_rows`
    );
    const row = res.rows[0] || {};
    if (!row.persons || !row.rels || !row.templates || !row.batches || !row.batch_rows) {
      throw new Error(
        'Migration 005 (005_import_and_relationships.sql) must be explicitly approved and applied before executing PostgreSQL import & relationship operations.'
      );
    }
  }

  public async getPersons(): Promise<PersonRecord[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const tbl = await client.query(`SELECT to_regclass('public.persons') as tbl`);
      if (!tbl.rows[0]?.tbl) return [];
      const { rows } = await client.query('SELECT * FROM persons ORDER BY created_at DESC');
      return rows.map((r: any) => this.mapRowToPerson(r));
    } catch {
      return [];
    } finally {
      if (client) client.release();
    }
  }

  public async getAllRelationships(): Promise<CompanyPersonRelationship[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const tbl = await client.query(`SELECT to_regclass('public.company_person_relationships') as tbl`);
      if (!tbl.rows[0]?.tbl) return [];
      const { rows } = await client.query('SELECT * FROM company_person_relationships ORDER BY created_at DESC');
      return rows.map((r: any) => this.mapRowToRelationship(r));
    } catch {
      return [];
    } finally {
      if (client) client.release();
    }
  }

  public async getLeadPersons(leadId: string): Promise<LinkedPersonWithRelationship[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const tbl = await client.query(`SELECT to_regclass('public.company_person_relationships') as tbl`);
      if (!tbl.rows[0]?.tbl) return [];

      const { rows } = await client.query(
        `SELECT r.*, p.id as p_id, p.full_name as p_full_name, p.first_name as p_first_name,
                p.last_name as p_last_name, p.normalized_name as p_normalized_name, p.email as p_email,
                p.email_status as p_email_status, p.phone as p_phone, p.phone_normalized as p_phone_normalized,
                p.linkedin_url as p_linkedin_url, p.linkedin_slug as p_linkedin_slug, p.country as p_country,
                p.country_code as p_country_code, p.city as p_city, p.sources as p_sources,
                p.confidence_score as p_confidence_score, p.verification_status as p_verification_status,
                p.custom_fields as p_custom_fields, p.created_at as p_created_at, p.updated_at as p_updated_at
         FROM company_person_relationships r
         JOIN persons p ON p.id = r.person_id
         WHERE r.lead_id = $1
         ORDER BY r.is_primary_contact DESC, r.created_at DESC`,
        [leadId]
      );

      if (rows.length === 0) return [];

      const personIds = Array.from(new Set(rows.map((r: any) => r.person_id)));
      const otherRes = await client.query(
        `SELECT r.person_id, r.lead_id, r.relationship_type, r.job_title, l.company_name
         FROM company_person_relationships r
         JOIN leads l ON l.id = r.lead_id
         WHERE r.person_id = ANY($1::text[]) AND r.lead_id <> $2`,
        [personIds, leadId]
      );

      const othersByPerson = new Map<
        string,
        Array<{ leadId: string; companyName: string; relationshipType: string; jobTitle?: string }>
      >();
      for (const or of otherRes.rows) {
        const list = othersByPerson.get(or.person_id) || [];
        list.push({
          leadId: or.lead_id,
          companyName: or.company_name,
          relationshipType: or.relationship_type,
          jobTitle: or.job_title || undefined,
        });
        othersByPerson.set(or.person_id, list);
      }

      return rows.map((r: any) => ({
        person: this.mapRowToPerson({
          id: r.p_id,
          full_name: r.p_full_name,
          first_name: r.p_first_name,
          last_name: r.p_last_name,
          normalized_name: r.p_normalized_name,
          email: r.p_email,
          email_status: r.p_email_status,
          phone: r.p_phone,
          phone_normalized: r.p_phone_normalized,
          linkedin_url: r.p_linkedin_url,
          linkedin_slug: r.p_linkedin_slug,
          country: r.p_country,
          country_code: r.p_country_code,
          city: r.p_city,
          sources: r.p_sources,
          confidence_score: r.p_confidence_score,
          verification_status: r.p_verification_status,
          custom_fields: r.p_custom_fields,
          created_at: r.p_created_at,
          updated_at: r.p_updated_at,
        }),
        relationship: this.mapRowToRelationship(r),
        otherCompanies: othersByPerson.get(r.person_id),
      }));
    } catch {
      return [];
    } finally {
      if (client) client.release();
    }
  }

  public async linkPersonToLead(input: {
    leadId: string;
    person: NormalizedImportPerson;
    actorEmail: string;
  }): Promise<LinkedPersonWithRelationship[]> {
    const pool = this.getClient();
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      await client.query('BEGIN');
      await this.ensureMigration005Tables(client);

      const pRes = await client.query('SELECT * FROM persons');
      const personsList = pRes.rows.map((r: any) => this.mapRowToPerson(r));
      const rRes = await client.query('SELECT * FROM company_person_relationships');
      const relsList = rRes.rows.map((r: any) => this.mapRowToRelationship(r));

      const pMatch = findMatchingPerson(input.person, input.leadId, personsList, relsList);
      let personId: string;

      if (pMatch.matchedPerson) {
        const { person: merged } = mergeImportedPersonSafely(
          pMatch.matchedPerson,
          input.person,
          'Manual CRM Entry',
          now
        );
        await this.upsertPersonInTransaction(client, merged, now);
        personId = merged.id;
      } else {
        const created = buildPersonRecordFromImport({
          person: input.person,
          filename: 'Manual CRM Entry',
          actorEmail: input.actorEmail,
          now,
        });
        await this.upsertPersonInTransaction(client, created, now);
        personId = created.id;
      }

      const rel = buildRelationshipRecord({
        leadId: input.leadId,
        personId,
        person: input.person,
        filename: input.person.relationshipProvenance?.sourceName || 'Manual CRM Entry',
        rowNumber: 1,
        now,
      });
      rel.sourceName = input.person.relationshipProvenance?.sourceName || 'Owner Manual Entry';
      await this.upsertRelationshipInTransaction(client, rel, now);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getLeadPersons(input.leadId);
  }

  public async linkExistingPersonToLead(input: {
    personId: string;
    leadId: string;
    relationshipType: string;
    jobTitle?: string;
    designation?: string;
    department?: string;
    decisionMakerCategory?: string;
    isPrimaryContact?: boolean;
    sourceName?: string;
    actorEmail: string;
  }): Promise<LinkedPersonWithRelationship[]> {
    const pool = this.getClient();
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      await client.query('BEGIN');
      await this.ensureMigration005Tables(client);

      const pRes = await client.query('SELECT * FROM persons WHERE id = $1', [input.personId]);
      if (pRes.rows.length === 0) throw new Error(`Person "${input.personId}" not found.`);
      const person = this.mapRowToPerson(pRes.rows[0]);

      const rel: CompanyPersonRelationship = {
        id: `cpr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        leadId: input.leadId,
        personId: input.personId,
        relationshipType: input.relationshipType || 'contact',
        jobTitle: input.jobTitle,
        designation: input.designation,
        department: input.department,
        decisionMakerCategory: input.decisionMakerCategory,
        isPrimaryContact: Boolean(input.isPrimaryContact),
        sourceName: input.sourceName || 'Owner Manual Link',
        provenance: {
          sourceName: input.sourceName || 'Owner Manual Link',
          sourceType: 'owner_manual',
          employmentStatus: 'current',
          firstObservedAt: now,
          lastObservedAt: now,
          reviewedByOwner: true,
          linkedBy: input.actorEmail,
        },
        confidenceScore: person.confidenceScore || 75,
        verificationStatus: 'user_provided',
        createdAt: now,
        updatedAt: now,
      };
      await this.upsertRelationshipInTransaction(client, rel, now);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getLeadPersons(input.leadId);
  }

  public async updatePersonRecord(
    personId: string,
    updates: Partial<{
      fullName: string;
      email: string | null;
      phone: string | null;
      linkedinUrl: string | null;
      city: string | null;
      country: string | null;
      countryCode: string | null;
      bioSummary: string | null;
      officialBioUrl: string | null;
      seniority: string | null;
      decisionMakingFunction: string | null;
      verificationStatus: PersonRecord['verificationStatus'];
      customFields: Record<string, string>;
    }>
  ): Promise<PersonRecord | null> {
    const pool = this.getClient();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureMigration005Tables(client);

      const curRes = await client.query('SELECT * FROM persons WHERE id = $1 FOR UPDATE', [personId]);
      if (curRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const cur = this.mapRowToPerson(curRes.rows[0]);
      const cf = { ...(cur.customFields || {}), ...(updates.customFields || {}) };
      if (updates.bioSummary !== undefined) {
        if (updates.bioSummary) cf.bioSummary = updates.bioSummary;
        else delete cf.bioSummary;
      }
      if (updates.officialBioUrl !== undefined) {
        if (updates.officialBioUrl) cf.officialBioUrl = updates.officialBioUrl;
        else delete cf.officialBioUrl;
      }
      if (updates.seniority !== undefined) {
        if (updates.seniority) cf.seniority = updates.seniority;
        else delete cf.seniority;
      }
      if (updates.decisionMakingFunction !== undefined) {
        if (updates.decisionMakingFunction) cf.decisionMakingFunction = updates.decisionMakingFunction;
        else delete cf.decisionMakingFunction;
      }

      const nextFullName = updates.fullName?.trim() || cur.fullName;
      const normalizedName = nextFullName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      const nextLinkedin =
        updates.linkedinUrl === null ? null : updates.linkedinUrl ?? cur.linkedinUrl ?? null;
      const nextSlug = nextLinkedin
        ? nextLinkedin.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]?.toLowerCase() || null
        : null;
      const nextEmail = updates.email === null ? null : updates.email ?? cur.email ?? null;
      const nextEmailStatus =
        updates.email === null
          ? 'unavailable'
          : updates.email
          ? 'syntax_valid'
          : cur.emailStatus;

      const { rows } = await client.query(
        `UPDATE persons SET
          full_name = $2,
          normalized_name = $3,
          email = $4,
          email_status = $5,
          phone = $6,
          linkedin_url = $7,
          linkedin_slug = $8,
          city = $9,
          country = $10,
          country_code = $11,
          verification_status = $12,
          custom_fields = $13,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
        [
          personId,
          nextFullName,
          normalizedName,
          nextEmail,
          nextEmailStatus,
          updates.phone === null ? null : updates.phone ?? cur.phone ?? null,
          nextLinkedin,
          nextSlug ?? cur.linkedinSlug ?? null,
          updates.city === null ? null : updates.city ?? cur.city ?? null,
          updates.country === null ? null : updates.country ?? cur.country ?? null,
          updates.countryCode === null ? null : updates.countryCode ?? cur.countryCode ?? null,
          updates.verificationStatus ?? cur.verificationStatus,
          Object.keys(cf).length > 0 ? JSON.stringify(cf) : null,
        ]
      );
      await client.query('COMMIT');
      return rows[0] ? this.mapRowToPerson(rows[0]) : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async updateRelationshipRecord(
    leadId: string,
    relationshipId: string,
    updates: Partial<{
      relationshipType: string;
      jobTitle: string | null;
      designation: string | null;
      department: string | null;
      decisionMakerCategory: string | null;
      isPrimaryContact: boolean;
      employmentStatus: 'current' | 'historical' | 'unknown';
      endedAt: string | null;
      uncertainMatch: boolean;
      reviewedByOwner: boolean;
    }>
  ): Promise<CompanyPersonRelationship | null> {
    const pool = this.getClient();
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      await client.query('BEGIN');
      await this.ensureMigration005Tables(client);

      const curRes = await client.query(
        `SELECT * FROM company_person_relationships WHERE id = $1 AND lead_id = $2 FOR UPDATE`,
        [relationshipId, leadId]
      );
      if (curRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const cur = this.mapRowToRelationship(curRes.rows[0]);

      if (updates.isPrimaryContact) {
        await client.query(
          `UPDATE company_person_relationships SET is_primary_contact = FALSE, updated_at = NOW()
           WHERE lead_id = $1 AND is_primary_contact = TRUE AND id <> $2`,
          [leadId, relationshipId]
        );
      }

      const nextProv = {
        ...(cur.provenance || {}),
        ...(updates.employmentStatus ? { employmentStatus: updates.employmentStatus } : {}),
        ...(updates.endedAt !== undefined ? { endedAt: updates.endedAt || undefined } : {}),
        ...(updates.employmentStatus === 'historical' && !cur.provenance?.endedAt && updates.endedAt === undefined
          ? { endedAt: now.slice(0, 10) }
          : {}),
        ...(updates.uncertainMatch !== undefined ? { uncertainMatch: updates.uncertainMatch } : {}),
        ...(updates.reviewedByOwner !== undefined ? { reviewedByOwner: updates.reviewedByOwner } : {}),
      };

      const { rows } = await client.query(
        `UPDATE company_person_relationships SET
          relationship_type = $3,
          job_title = $4,
          designation = $5,
          department = $6,
          decision_maker_category = $7,
          is_primary_contact = $8,
          provenance = $9,
          updated_at = NOW()
        WHERE id = $1 AND lead_id = $2
        RETURNING *`,
        [
          relationshipId,
          leadId,
          updates.relationshipType ?? cur.relationshipType,
          updates.jobTitle === null ? null : updates.jobTitle ?? cur.jobTitle ?? null,
          updates.designation === null ? null : updates.designation ?? cur.designation ?? null,
          updates.department === null ? null : updates.department ?? cur.department ?? null,
          updates.decisionMakerCategory === null
            ? null
            : updates.decisionMakerCategory ?? cur.decisionMakerCategory ?? null,
          updates.isPrimaryContact ?? cur.isPrimaryContact,
          JSON.stringify(nextProv),
        ]
      );
      await client.query('COMMIT');
      return rows[0] ? this.mapRowToRelationship(rows[0]) : null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async setPrimaryContact(leadId: string, relationshipId: string): Promise<LinkedPersonWithRelationship[]> {
    const pool = this.getClient();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureMigration005Tables(client);

      await client.query(`SELECT id FROM leads WHERE id = $1 FOR UPDATE`, [leadId]);
      const targetRes = await client.query(
        `SELECT id FROM company_person_relationships WHERE id = $1 AND lead_id = $2`,
        [relationshipId, leadId]
      );
      if (targetRes.rows.length === 0) {
        throw new Error(`Relationship "${relationshipId}" not found for company "${leadId}".`);
      }

      await client.query(
        `UPDATE company_person_relationships
         SET is_primary_contact = FALSE, updated_at = NOW()
         WHERE lead_id = $1 AND is_primary_contact = TRUE AND id <> $2`,
        [leadId, relationshipId]
      );

      await client.query(
        `UPDATE company_person_relationships
         SET is_primary_contact = TRUE, updated_at = NOW()
         WHERE id = $1 AND lead_id = $2`,
        [relationshipId, leadId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.getLeadPersons(leadId);
  }

  public async unlinkPersonFromLead(leadId: string, relationshipId: string): Promise<boolean> {
    const pool = this.getClient();
    const client = await pool.connect();
    try {
      const tbl = await client.query(`SELECT to_regclass('public.company_person_relationships') as tbl`);
      if (!tbl.rows[0]?.tbl) return false;
      const { rowCount } = await client.query(
        'DELETE FROM company_person_relationships WHERE id = $1 AND lead_id = $2',
        [relationshipId, leadId]
      );
      return (rowCount ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  public async getImportTemplates(): Promise<ImportMappingTemplate[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const tbl = await client.query(`SELECT to_regclass('public.import_mapping_templates') as tbl`);
      if (!tbl.rows[0]?.tbl) return [];
      const { rows } = await client.query('SELECT * FROM import_mapping_templates ORDER BY updated_at DESC');
      return rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description || undefined,
        sourceFormat: (r.source_format || 'csv') as 'csv' | 'xlsx',
        headerSignature: typeof r.header_signature === 'string' ? JSON.parse(r.header_signature) : r.header_signature || [],
        columnMappings: typeof r.column_mappings === 'string' ? JSON.parse(r.column_mappings) : r.column_mappings || [],
        mergeRules: typeof r.merge_rules === 'string' ? JSON.parse(r.merge_rules) : r.merge_rules || [],
        normalizationOptions:
          typeof r.normalization_options === 'string' ? JSON.parse(r.normalization_options) : r.normalization_options || {},
        createdBy: r.created_by || 'Owner',
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      }));
    } catch {
      return [];
    } finally {
      if (client) client.release();
    }
  }

  public async saveImportTemplate(
    tpl: Omit<ImportMappingTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<ImportMappingTemplate> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const now = new Date().toISOString();
    const id = tpl.id || `imp-tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      client = await pool.connect();
      await this.ensureMigration005Tables(client);
      const { rows } = await client.query(
        `INSERT INTO import_mapping_templates (
          id, name, description, source_format, header_signature, column_mappings,
          merge_rules, normalization_options, created_by, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          source_format = EXCLUDED.source_format,
          header_signature = EXCLUDED.header_signature,
          column_mappings = EXCLUDED.column_mappings,
          merge_rules = EXCLUDED.merge_rules,
          normalization_options = EXCLUDED.normalization_options,
          updated_at = NOW()
        RETURNING created_at, updated_at`,
        [
          id,
          tpl.name.trim(),
          tpl.description?.trim() || null,
          tpl.sourceFormat,
          JSON.stringify(tpl.headerSignature || []),
          JSON.stringify(tpl.columnMappings || []),
          JSON.stringify(tpl.mergeRules || []),
          JSON.stringify(tpl.normalizationOptions || {}),
          tpl.createdBy || 'Owner',
        ]
      );
      return {
        ...tpl,
        id,
        name: tpl.name.trim(),
        createdAt: rows[0]?.created_at ? new Date(rows[0].created_at).toISOString() : now,
        updatedAt: rows[0]?.updated_at ? new Date(rows[0].updated_at).toISOString() : now,
      };
    } finally {
      if (client) client.release();
    }
  }

  public async deleteImportTemplate(id: string): Promise<boolean> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const tbl = await client.query(`SELECT to_regclass('public.import_mapping_templates') as tbl`);
      if (!tbl.rows[0]?.tbl) return false;
      const { rowCount } = await client.query('DELETE FROM import_mapping_templates WHERE id = $1', [id]);
      return (rowCount ?? 0) > 0;
    } finally {
      if (client) client.release();
    }
  }

  public async getImportBatches(options: { page?: number; pageSize?: number } = {}): Promise<{
    batches: ImportBatchRecord[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const pageSize = Math.max(1, Math.min(100, options.pageSize || 20));
    const page = Math.max(1, options.page || 1);
    try {
      client = await pool.connect();
      const tbl = await client.query(`SELECT to_regclass('public.import_batches') as tbl`);
      if (!tbl.rows[0]?.tbl) {
        return { batches: [], total: 0, page: 1, pageSize, totalPages: 1 };
      }
      const countRes = await client.query('SELECT COUNT(*) FROM import_batches');
      const total = parseInt(countRes.rows[0]?.count || '0', 10);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * pageSize;

      const { rows } = await client.query(
        'SELECT * FROM import_batches ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [pageSize, offset]
      );
      return {
        batches: rows.map((r: any) => this.mapRowToImportBatch(r)),
        total,
        page: safePage,
        pageSize,
        totalPages,
      };
    } catch {
      return { batches: [], total: 0, page: 1, pageSize, totalPages: 1 };
    } finally {
      if (client) client.release();
    }
  }

  public async getImportBatchDetail(
    batchId: string,
    options: { page?: number; pageSize?: number; outcome?: string } = {}
  ): Promise<{
    batch: ImportBatchRecord;
    rows: ImportBatchRowRecord[];
    totalRows: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } | null> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const pageSize = Math.max(1, Math.min(500, options.pageSize || 50));
    const page = Math.max(1, options.page || 1);
    try {
      client = await pool.connect();
      const tbl = await client.query(`SELECT to_regclass('public.import_batches') as tbl`);
      if (!tbl.rows[0]?.tbl) return null;

      const bRes = await client.query('SELECT * FROM import_batches WHERE id = $1', [batchId]);
      if (bRes.rows.length === 0) return null;
      const batch = this.mapRowToImportBatch(bRes.rows[0]);

      const filterOutcome = options.outcome && options.outcome !== 'all' ? options.outcome : null;
      const countRes = filterOutcome
        ? await client.query(
            'SELECT COUNT(*) FROM import_batch_rows WHERE batch_id = $1 AND outcome = $2',
            [batchId, filterOutcome]
          )
        : await client.query('SELECT COUNT(*) FROM import_batch_rows WHERE batch_id = $1', [batchId]);
      const totalRows = parseInt(countRes.rows[0]?.count || '0', 10);
      const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
      const safePage = Math.min(page, totalPages);
      const offset = (safePage - 1) * pageSize;

      const rRes = filterOutcome
        ? await client.query(
            `SELECT * FROM import_batch_rows WHERE batch_id = $1 AND outcome = $2
             ORDER BY row_number ASC LIMIT $3 OFFSET $4`,
            [batchId, filterOutcome, pageSize, offset]
          )
        : await client.query(
            `SELECT * FROM import_batch_rows WHERE batch_id = $1
             ORDER BY row_number ASC LIMIT $2 OFFSET $3`,
            [batchId, pageSize, offset]
          );

      return {
        batch,
        rows: rRes.rows.map((r: any) => this.mapRowToImportBatchRow(r)),
        totalRows,
        page: safePage,
        pageSize,
        totalPages,
      };
    } finally {
      if (client) client.release();
    }
  }

  public async executeImportTransaction(
    plan: ImportExecutionPlan,
    options: { customClient?: pg.PoolClient } = {}
  ): Promise<ImportExecutionResult> {
    const startedMs = Date.now();
    const now = new Date().toISOString();
    const externalClient = options.customClient;
    const pool = externalClient ? null : this.getClient();
    const client = externalClient || (await pool!.connect());

    let createdCompanies = 0;
    let updatedCompanies = 0;
    let createdPersons = 0;
    let updatedPersons = 0;
    let createdRelationships = 0;
    let updatedRelationships = 0;
    let skippedRows = 0;
    let duplicateRows = 0;
    let conflictRows = 0;
    let failedRows = 0;
    let validRows = 0;
    let invalidRows = 0;

    const batchRowRecords: ImportBatchRowRecord[] = [];
    const createdLeadByGroupKey = new Map<string, string>();
    const existingLeadsCache = await (externalClient ? Promise.resolve([]) : this.getLeads());
    const existingPersonsCache = await (externalClient ? Promise.resolve([]) : this.getPersons());
    const existingRelsCache = await (externalClient ? Promise.resolve([]) : this.getAllRelationships());

    const leadById = new Map<string, CanonicalLead>(existingLeadsCache.map((l) => [l.id, l]));
    const personsList: PersonRecord[] = [...existingPersonsCache];
    const relsList: CompanyPersonRelationship[] = [...existingRelsCache];

    try {
      await client.query('BEGIN');
      if (!externalClient) {
        await this.ensureMigration005Tables(client);
      }

      // Enforce batch row_number uniqueness before persisting any row
      const seenRowNumbers = new Set<number>();
      for (const r of plan.rows) {
        if (seenRowNumbers.has(r.rowNumber)) {
          throw new Error(
            `Duplicate row_number ${r.rowNumber} detected in import batch "${plan.batchId}". Each row number within a batch must be unique.`
          );
        }
        seenRowNumbers.add(r.rowNumber);
      }

      const defaultStageId = await this.resolvePipelineStageId(client, undefined, true);

      // Insert pending batch record first so FK from import_batch_rows is satisfied
      await client.query(
        `INSERT INTO import_batches (
          id, filename, file_format, file_size_bytes, file_sha256, worksheet_name,
          encoding_detected, template_id, template_name, duplicate_policy, status,
          total_rows, actor_email, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12, $13)`,
        [
          plan.batchId,
          plan.filename,
          plan.fileFormat,
          plan.fileSizeBytes,
          plan.fileSha256,
          plan.worksheetName || null,
          plan.encodingDetected,
          plan.templateId || null,
          plan.templateName || null,
          plan.options.duplicatePolicy,
          plan.rows.length,
          plan.actorEmail,
          now,
        ]
      );

      for (const row of plan.rows) {
        if (plan.simulateFailureAtRow && row.rowNumber === plan.simulateFailureAtRow) {
          throw new Error(`Simulated mid-batch transaction failure at row ${row.rowNumber}`);
        }

        if (row.valid) validRows++;
        else invalidRows++;

        if (
          row.dedupe.classification === 'exact_crm_duplicate' ||
          row.dedupe.classification === 'possible_duplicate'
        ) {
          duplicateRows++;
        }
        if (row.dedupe.classification === 'conflicting_identity') {
          conflictRows++;
        }

        if (!row.valid) {
          failedRows++;
          if (plan.atomicRollbackOnError) {
            throw new Error(
              `Validation failed on row ${row.rowNumber}: ${row.errors.map((e) => e.message).join('; ')}`
            );
          }
          batchRowRecords.push({
            id: `imp-row-${plan.batchId}-${row.rowNumber}`,
            batchId: plan.batchId,
            rowNumber: row.rowNumber,
            dedupeClassification: row.dedupe.classification,
            actionTaken: 'validation_failed',
            outcome: 'failed',
            companyName: row.company?.companyName || row.rawData['Company Name'],
            personName: row.person?.fullName,
            matchedLeadId: row.dedupe.matchedCrmLeadId,
            rawData: row.rawData,
            normalizedData: { company: row.company, person: row.person },
            errors: row.errors,
            warnings: row.warnings,
            createdAt: now,
          });
          continue;
        }

        if (row.finalAction === 'needs_review' || row.finalAction === 'skip') {
          skippedRows++;
          batchRowRecords.push({
            id: `imp-row-${plan.batchId}-${row.rowNumber}`,
            batchId: plan.batchId,
            rowNumber: row.rowNumber,
            dedupeClassification: row.dedupe.classification,
            actionTaken: row.finalAction === 'needs_review' ? 'flagged_for_review' : 'skipped',
            outcome:
              row.finalAction === 'needs_review' &&
              row.dedupe.classification === 'conflicting_identity'
                ? 'conflict'
                : 'skipped',
            companyName: row.company?.companyName,
            personName: row.person?.fullName,
            matchedLeadId: row.dedupe.matchedCrmLeadId,
            rawData: row.rawData,
            normalizedData: { company: row.company, person: row.person },
            errors: row.errors,
            warnings: row.warnings,
            createdAt: now,
          });
          continue;
        }

        const spName = `sp_imp_row_${row.rowNumber}`;
        if (!plan.atomicRollbackOnError) {
          await client.query(`SAVEPOINT ${spName}`);
        }

        try {
          let targetLeadId: string | undefined = row.resolveToLeadId || row.dedupe.matchedCrmLeadId;
          let rowOutcome: ImportBatchRowRecord['outcome'] = 'created';

          if (row.company) {
            const groupKey = row.dedupe.inFileCompanyGroupKey;
            if (!targetLeadId && groupKey && createdLeadByGroupKey.has(groupKey)) {
              targetLeadId = createdLeadByGroupKey.get(groupKey);
            } else if (row.finalAction === 'update_existing' && targetLeadId) {
              const existingLead = leadById.get(targetLeadId);
              if (existingLead) {
                const { merged, fieldsEnriched } = safelyMergeImportedCompanyIntoLead({
                  existing: existingLead,
                  imported: row.company,
                  filename: plan.filename,
                  actorEmail: plan.actorEmail,
                  now,
                });
                await this.writeLeadInTransaction(client, merged, defaultStageId, now);
                leadById.set(merged.id, merged);
                if (fieldsEnriched.length > 0) updatedCompanies++;
                rowOutcome = 'updated';
              }
            } else if (row.finalAction === 'create_new') {
              const newLead = buildCanonicalLeadFromImport({
                company: row.company,
                filename: plan.filename,
                pipelineStageId: defaultStageId || undefined,
                actorEmail: plan.actorEmail,
                now,
              });
              await this.writeLeadInTransaction(client, newLead, defaultStageId, now);
              leadById.set(newLead.id, newLead);
              targetLeadId = newLead.id;
              if (groupKey) createdLeadByGroupKey.set(groupKey, newLead.id);
              createdCompanies++;
              rowOutcome = 'created';
            }
          }

          let persistedPersonId: string | undefined;
          let persistedRelationshipId: string | undefined;

          if (row.person) {
            const pMatch = findMatchingPerson(row.person, targetLeadId, personsList, relsList);
            if (pMatch.matchedPerson) {
              const { person: mergedPerson, updated } = mergeImportedPersonSafely(
                pMatch.matchedPerson,
                row.person,
                plan.filename,
                now
              );
              await this.upsertPersonInTransaction(client, mergedPerson, now);
              const idx = personsList.findIndex((p) => p.id === mergedPerson.id);
              if (idx >= 0) personsList[idx] = mergedPerson;
              if (updated) updatedPersons++;
              persistedPersonId = mergedPerson.id;
            } else {
              const newPerson = buildPersonRecordFromImport({
                person: row.person,
                filename: plan.filename,
                actorEmail: plan.actorEmail,
                now,
              });
              await this.upsertPersonInTransaction(client, newPerson, now);
              personsList.unshift(newPerson);
              persistedPersonId = newPerson.id;
              createdPersons++;
            }

            if (targetLeadId && persistedPersonId) {
              const relType = row.person.relationshipType || 'contact';
              const existingRel = relsList.find(
                (r) =>
                  r.leadId === targetLeadId &&
                  r.personId === persistedPersonId &&
                  r.relationshipType === relType
              );
              if (existingRel) {
                const updatedRel: CompanyPersonRelationship = {
                  ...existingRel,
                  jobTitle: existingRel.jobTitle || row.person.jobTitle || row.person.relationshipPosition,
                  designation: existingRel.designation || row.person.designation,
                  department: existingRel.department || row.person.department,
                  decisionMakerCategory:
                    existingRel.decisionMakerCategory || row.person.decisionMakerCategory,
                  isPrimaryContact: existingRel.isPrimaryContact || Boolean(row.person.isPrimaryContact),
                  updatedAt: now,
                };
                await this.upsertRelationshipInTransaction(client, updatedRel, now);
                if (updatedRel.isPrimaryContact) {
                  for (let i = 0; i < relsList.length; i++) {
                    if (
                      relsList[i].leadId === targetLeadId &&
                      !(relsList[i].personId === persistedPersonId && relsList[i].relationshipType === relType) &&
                      relsList[i].isPrimaryContact
                    ) {
                      relsList[i] = { ...relsList[i], isPrimaryContact: false, updatedAt: now };
                    }
                  }
                }
                const rIdx = relsList.findIndex((r) => r.id === updatedRel.id);
                if (rIdx >= 0) relsList[rIdx] = updatedRel;
                persistedRelationshipId = updatedRel.id;
                updatedRelationships++;
              } else {
                const newRel = buildRelationshipRecord({
                  leadId: targetLeadId,
                  personId: persistedPersonId,
                  person: row.person,
                  filename: plan.filename,
                  rowNumber: row.rowNumber,
                  now,
                });
                await this.upsertRelationshipInTransaction(client, newRel, now);
                if (newRel.isPrimaryContact) {
                  for (let i = 0; i < relsList.length; i++) {
                    if (relsList[i].leadId === targetLeadId && relsList[i].isPrimaryContact) {
                      relsList[i] = { ...relsList[i], isPrimaryContact: false, updatedAt: now };
                    }
                  }
                }
                relsList.unshift(newRel);
                persistedRelationshipId = newRel.id;
                createdRelationships++;
              }
            }
          }

          if (!plan.atomicRollbackOnError) {
            await client.query(`RELEASE SAVEPOINT ${spName}`);
          }

          batchRowRecords.push({
            id: `imp-row-${plan.batchId}-${row.rowNumber}`,
            batchId: plan.batchId,
            rowNumber: row.rowNumber,
            dedupeClassification: row.dedupe.classification,
            actionTaken: row.finalAction,
            outcome: rowOutcome,
            companyName: row.company?.companyName || row.person?.associatedCompanyName,
            personName: row.person?.fullName,
            matchedLeadId: row.dedupe.matchedCrmLeadId,
            persistedLeadId: targetLeadId,
            persistedPersonId,
            persistedRelationshipId,
            rawData: row.rawData,
            normalizedData: { company: row.company, person: row.person },
            errors: row.errors,
            warnings: row.warnings,
            createdAt: now,
          });
        } catch (rowErr: unknown) {
          if (plan.atomicRollbackOnError) {
            throw rowErr;
          }
          await client.query(`ROLLBACK TO SAVEPOINT ${spName}`);
          failedRows++;
          const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
          batchRowRecords.push({
            id: `imp-row-${plan.batchId}-${row.rowNumber}`,
            batchId: plan.batchId,
            rowNumber: row.rowNumber,
            dedupeClassification: row.dedupe.classification,
            actionTaken: 'persistence_failed',
            outcome: 'failed',
            companyName: row.company?.companyName || row.person?.associatedCompanyName,
            personName: row.person?.fullName,
            matchedLeadId: row.dedupe.matchedCrmLeadId,
            rawData: row.rawData,
            normalizedData: { company: row.company, person: row.person },
            errors: [
              ...row.errors,
              { field: 'database', code: 'PERSISTENCE_ERROR', message: msg, severity: 'error' },
            ],
            warnings: row.warnings,
            createdAt: now,
          });
        }
      }

      // Insert row ledger records & finalize batch counts inside transaction
      for (const rr of batchRowRecords) {
        await client.query(
          `INSERT INTO import_batch_rows (
            id, batch_id, row_number, dedupe_classification, action_taken, outcome,
            company_name, person_name, matched_lead_id, persisted_lead_id,
            persisted_person_id, persisted_relationship_id, raw_data, normalized_data,
            errors, warnings, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            rr.id,
            rr.batchId,
            rr.rowNumber,
            rr.dedupeClassification,
            rr.actionTaken,
            rr.outcome,
            rr.companyName || null,
            rr.personName || null,
            rr.matchedLeadId || null,
            rr.persistedLeadId || null,
            rr.persistedPersonId || null,
            rr.persistedRelationshipId || null,
            JSON.stringify(rr.rawData || {}),
            JSON.stringify(rr.normalizedData || {}),
            JSON.stringify(rr.errors || []),
            JSON.stringify(rr.warnings || []),
            now,
          ]
        );
      }

      const finalStatus: ImportBatchRecord['status'] =
        failedRows > 0 ? 'partial_failed' : 'completed';
      const durationMs = Math.max(1, Date.now() - startedMs);
      const completedAt = new Date().toISOString();

      await client.query(
        `UPDATE import_batches SET
          status = $1, valid_rows = $2, invalid_rows = $3,
          created_companies = $4, updated_companies = $5,
          created_persons = $6, updated_persons = $7,
          created_relationships = $8, updated_relationships = $9,
          skipped_rows = $10, duplicate_rows = $11, conflict_rows = $12,
          failed_rows = $13, duration_ms = $14, completed_at = $15
         WHERE id = $16`,
        [
          finalStatus,
          validRows,
          invalidRows,
          createdCompanies,
          updatedCompanies,
          createdPersons,
          updatedPersons,
          createdRelationships,
          updatedRelationships,
          skippedRows,
          duplicateRows,
          conflictRows,
          failedRows,
          durationMs,
          completedAt,
          plan.batchId,
        ]
      );

      await client.query('COMMIT');

      const batch: ImportBatchRecord = {
        id: plan.batchId,
        filename: plan.filename,
        fileFormat: plan.fileFormat,
        fileSizeBytes: plan.fileSizeBytes,
        fileSha256: plan.fileSha256,
        worksheetName: plan.worksheetName,
        encodingDetected: plan.encodingDetected,
        templateId: plan.templateId,
        templateName: plan.templateName,
        duplicatePolicy: plan.options.duplicatePolicy,
        status: finalStatus,
        totalRows: plan.rows.length,
        validRows,
        invalidRows,
        createdCompanies,
        updatedCompanies,
        createdPersons,
        updatedPersons,
        createdRelationships,
        updatedRelationships,
        skippedRows,
        duplicateRows,
        conflictRows,
        failedRows,
        durationMs,
        actorEmail: plan.actorEmail,
        createdAt: now,
        completedAt,
      };

      return { batch, rows: batchRowRecords };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const errMsg = err instanceof Error ? err.message : String(err);
      const durationMs = Math.max(1, Date.now() - startedMs);
      const completedAt = new Date().toISOString();

      const rolledBackBatch: ImportBatchRecord = {
        id: plan.batchId,
        filename: plan.filename,
        fileFormat: plan.fileFormat,
        fileSizeBytes: plan.fileSizeBytes,
        fileSha256: plan.fileSha256,
        worksheetName: plan.worksheetName,
        encodingDetected: plan.encodingDetected,
        templateId: plan.templateId,
        templateName: plan.templateName,
        duplicatePolicy: plan.options.duplicatePolicy,
        status: 'rolled_back',
        totalRows: plan.rows.length,
        validRows,
        invalidRows,
        createdCompanies: 0,
        updatedCompanies: 0,
        createdPersons: 0,
        updatedPersons: 0,
        createdRelationships: 0,
        updatedRelationships: 0,
        skippedRows: 0,
        duplicateRows,
        conflictRows,
        failedRows: plan.rows.length,
        durationMs,
        actorEmail: plan.actorEmail,
        errorMessage: errMsg,
        createdAt: now,
        completedAt,
      };

      const rolledBackRows: ImportBatchRowRecord[] = plan.rows.map((r) => ({
        id: `imp-row-${plan.batchId}-${r.rowNumber}`,
        batchId: plan.batchId,
        rowNumber: r.rowNumber,
        dedupeClassification: r.dedupe.classification,
        actionTaken: r.finalAction,
        outcome: 'rolled_back',
        companyName: r.company?.companyName,
        personName: r.person?.fullName,
        rawData: r.rawData,
        normalizedData: { company: r.company, person: r.person },
        errors: r.errors,
        warnings: r.warnings,
        createdAt: now,
      }));

      // Persist rolled_back ledger entry cleanly after rollback if schema exists
      try {
        await client.query(
          `INSERT INTO import_batches (
            id, filename, file_format, file_size_bytes, file_sha256, worksheet_name,
            encoding_detected, duplicate_policy, status, total_rows, valid_rows, invalid_rows,
            duplicate_rows, conflict_rows, failed_rows, duration_ms, actor_email, error_message,
            created_at, completed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'rolled_back', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [
            rolledBackBatch.id,
            rolledBackBatch.filename,
            rolledBackBatch.fileFormat,
            rolledBackBatch.fileSizeBytes,
            rolledBackBatch.fileSha256 || null,
            rolledBackBatch.worksheetName || null,
            rolledBackBatch.encodingDetected || null,
            rolledBackBatch.duplicatePolicy,
            rolledBackBatch.totalRows,
            rolledBackBatch.validRows,
            rolledBackBatch.invalidRows,
            rolledBackBatch.duplicateRows,
            rolledBackBatch.conflictRows,
            rolledBackBatch.failedRows,
            rolledBackBatch.durationMs,
            rolledBackBatch.actorEmail,
            errMsg,
            now,
            completedAt,
          ]
        );
      } catch {
        // ignore if Migration 005 tables do not yet exist
      }

      return { batch: rolledBackBatch, rows: rolledBackRows };
    } finally {
      if (!externalClient) {
        client.release();
      }
    }
  }

  private async writeLeadInTransaction(
    client: pg.PoolClient,
    lead: CanonicalLead,
    fallbackStageId: string | null,
    now: string
  ): Promise<void> {
    const stageId = lead.pipelineStageId || fallbackStageId;
    const canonRegType = lead.registrationType
      ? canonicalizeIdentifierType(lead.registrationType, lead.address?.countryCode)
      : null;

    await client.query(
      `INSERT INTO leads (
        id, company_name, legal_name, registration_number, registration_type,
        company_status, website, domain, email, email_status, phone, phone_normalized,
        street, city, region, postal_code, country, country_code, formatted_address,
        latitude, longitude, industry, category, employee_range, founded_year,
        confidence_score, confidence_signals, status, pipeline_stage_id, opportunity_value,
        currency, win_probability, lost_reason, tags, web_metadata, social_links, custom_fields,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37,
        $38, $39
      )
      ON CONFLICT (id) DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        registration_number = EXCLUDED.registration_number,
        registration_type = EXCLUDED.registration_type,
        company_status = EXCLUDED.company_status,
        website = EXCLUDED.website,
        domain = EXCLUDED.domain,
        email = EXCLUDED.email,
        email_status = EXCLUDED.email_status,
        phone = EXCLUDED.phone,
        phone_normalized = EXCLUDED.phone_normalized,
        street = EXCLUDED.street,
        city = EXCLUDED.city,
        region = EXCLUDED.region,
        postal_code = EXCLUDED.postal_code,
        country = EXCLUDED.country,
        country_code = EXCLUDED.country_code,
        formatted_address = EXCLUDED.formatted_address,
        industry = EXCLUDED.industry,
        category = EXCLUDED.category,
        employee_range = EXCLUDED.employee_range,
        founded_year = EXCLUDED.founded_year,
        tags = EXCLUDED.tags,
        social_links = EXCLUDED.social_links,
        custom_fields = EXCLUDED.custom_fields,
        updated_at = NOW()`,
      [
        lead.id,
        lead.companyName,
        lead.legalName || null,
        lead.registrationNumber || null,
        canonRegType,
        lead.companyStatus || 'unknown',
        lead.website || null,
        lead.domain || null,
        lead.email || null,
        lead.emailStatus || 'unavailable',
        lead.phone || null,
        lead.phoneNormalized || null,
        lead.address?.street || null,
        lead.address?.city || null,
        lead.address?.region || null,
        lead.address?.postalCode || null,
        lead.address?.country || 'International',
        lead.address?.countryCode || 'US',
        lead.address?.formattedAddress || null,
        lead.coordinates?.lat || null,
        lead.coordinates?.lon || null,
        lead.industry || 'Commercial Services',
        lead.category || 'Imported Prospect',
        lead.employeeRange || null,
        lead.foundedYear || null,
        lead.confidenceScore || 50,
        JSON.stringify(lead.confidenceSignals || []),
        lead.status || 'new',
        stageId,
        lead.opportunityValue || 0,
        lead.currency || 'USD',
        lead.winProbability || 0,
        lead.lostReason || null,
        JSON.stringify(lead.tags || []),
        lead.webMetadata ? JSON.stringify(lead.webMetadata) : null,
        lead.socialLinks ? JSON.stringify(lead.socialLinks) : null,
        lead.customFields ? JSON.stringify(lead.customFields) : null,
        lead.createdAt || now,
        now,
      ]
    );

    for (let idx = 0; idx < (lead.sources || []).length; idx++) {
      const s = lead.sources[idx];
      await client.query(
        `INSERT INTO lead_sources (id, lead_id, source_name, provider_id, url, retrieved_at, license, attribution)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          `src-${lead.id}-${idx}`,
          lead.id,
          s.sourceName,
          s.providerId || null,
          s.url || null,
          s.retrievedAt || now,
          s.license || null,
          s.attribution || null,
        ]
      );
    }

    for (let idx = 0; idx < (lead.identifiers || []).length; idx++) {
      const ident = lead.identifiers[idx];
      await client.query(
        `INSERT INTO lead_identifiers (id, lead_id, type, value, verified, country_code, normalized_value, issuing_authority, source, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (lead_id, type, value) DO NOTHING`,
        [
          ident.id || `ident-${lead.id}-${idx}`,
          lead.id,
          ident.type,
          ident.value,
          Boolean(ident.verified),
          ident.countryCode || lead.address?.countryCode || 'US',
          ident.normalizedValue || normalizeIdentifierValue(ident.value),
          ident.issuingAuthority || null,
          ident.source || 'import_engine',
          ident.status || 'user_provided',
        ]
      );
    }
  }

  private async upsertPersonInTransaction(
    client: pg.PoolClient,
    person: PersonRecord,
    now: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO persons (
        id, full_name, first_name, last_name, normalized_name,
        email, email_status, phone, phone_normalized, linkedin_url, linkedin_slug,
        country, country_code, city, sources, confidence_score, verification_status,
        custom_fields, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(persons.email, EXCLUDED.email),
        email_status = CASE WHEN persons.email IS NOT NULL THEN persons.email_status ELSE EXCLUDED.email_status END,
        phone = COALESCE(persons.phone, EXCLUDED.phone),
        phone_normalized = COALESCE(persons.phone_normalized, EXCLUDED.phone_normalized),
        linkedin_url = COALESCE(persons.linkedin_url, EXCLUDED.linkedin_url),
        linkedin_slug = COALESCE(persons.linkedin_slug, EXCLUDED.linkedin_slug),
        country = COALESCE(persons.country, EXCLUDED.country),
        country_code = COALESCE(persons.country_code, EXCLUDED.country_code),
        city = COALESCE(persons.city, EXCLUDED.city),
        sources = EXCLUDED.sources,
        confidence_score = GREATEST(COALESCE(persons.confidence_score, 0), COALESCE(EXCLUDED.confidence_score, 0)),
        verification_status = CASE
          WHEN persons.verification_status = 'officially_verified' THEN persons.verification_status
          ELSE EXCLUDED.verification_status
        END,
        custom_fields = COALESCE(persons.custom_fields, '{}'::jsonb) || COALESCE(EXCLUDED.custom_fields, '{}'::jsonb),
        updated_at = NOW()`,
      [
        person.id,
        person.fullName,
        person.firstName || null,
        person.lastName || null,
        person.normalizedName,
        person.email || null,
        person.emailStatus || 'unavailable',
        person.phone || null,
        person.phoneNormalized || null,
        person.linkedinUrl || null,
        person.linkedinSlug || null,
        person.country || null,
        person.countryCode || null,
        person.city || null,
        JSON.stringify(person.sources || []),
        person.confidenceScore || 50,
        person.verificationStatus || 'user_provided',
        person.customFields ? JSON.stringify(person.customFields) : null,
        person.createdAt || now,
        now,
      ]
    );
  }

  private async upsertRelationshipInTransaction(
    client: pg.PoolClient,
    rel: CompanyPersonRelationship,
    now: string
  ): Promise<void> {
    const relType = rel.relationshipType || 'contact';
    if (rel.isPrimaryContact) {
      await client.query(`SELECT id FROM leads WHERE id = $1 FOR UPDATE`, [rel.leadId]);
      await client.query(
        `UPDATE company_person_relationships
         SET is_primary_contact = FALSE, updated_at = NOW()
         WHERE lead_id = $1
           AND is_primary_contact = TRUE
           AND NOT (person_id = $2 AND relationship_type = $3)`,
        [rel.leadId, rel.personId, relType]
      );
    }

    await client.query(
      `INSERT INTO company_person_relationships (
        id, lead_id, person_id, relationship_type, job_title, designation,
        department, decision_maker_category, is_primary_contact, source_name,
        provenance, confidence_score, verification_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      ON CONFLICT (lead_id, person_id, relationship_type) DO UPDATE SET
        job_title = COALESCE(company_person_relationships.job_title, EXCLUDED.job_title),
        designation = COALESCE(company_person_relationships.designation, EXCLUDED.designation),
        department = COALESCE(company_person_relationships.department, EXCLUDED.department),
        decision_maker_category = COALESCE(company_person_relationships.decision_maker_category, EXCLUDED.decision_maker_category),
        is_primary_contact = company_person_relationships.is_primary_contact OR EXCLUDED.is_primary_contact,
        source_name = COALESCE(company_person_relationships.source_name, EXCLUDED.source_name),
        provenance = COALESCE(company_person_relationships.provenance, '{}'::jsonb) || COALESCE(EXCLUDED.provenance, '{}'::jsonb),
        confidence_score = GREATEST(COALESCE(company_person_relationships.confidence_score, 0), COALESCE(EXCLUDED.confidence_score, 0)),
        verification_status = CASE
          WHEN company_person_relationships.verification_status = 'officially_verified' THEN company_person_relationships.verification_status
          ELSE EXCLUDED.verification_status
        END,
        updated_at = NOW()`,
      [
        rel.id,
        rel.leadId,
        rel.personId,
        relType,
        rel.jobTitle || null,
        rel.designation || null,
        rel.department || null,
        rel.decisionMakerCategory || null,
        Boolean(rel.isPrimaryContact),
        rel.sourceName || 'Owner Import',
        JSON.stringify(rel.provenance || {}),
        rel.confidenceScore || 50,
        rel.verificationStatus || 'user_provided',
        rel.createdAt || now,
        now,
      ]
    );
  }

  private mapRowToPerson(r: any): PersonRecord {
    const cf = r.custom_fields
      ? typeof r.custom_fields === 'string'
        ? JSON.parse(r.custom_fields)
        : r.custom_fields
      : undefined;
    return {
      id: r.id,
      fullName: r.full_name,
      firstName: r.first_name || undefined,
      lastName: r.last_name || undefined,
      normalizedName: r.normalized_name,
      email: r.email || undefined,
      emailStatus: (r.email_status || 'unavailable') as PersonRecord['emailStatus'],
      phone: r.phone || undefined,
      phoneNormalized: r.phone_normalized || undefined,
      linkedinUrl: r.linkedin_url || undefined,
      linkedinSlug: r.linkedin_slug || undefined,
      country: r.country || undefined,
      countryCode: r.country_code || undefined,
      city: r.city || undefined,
      sources: typeof r.sources === 'string' ? JSON.parse(r.sources) : r.sources || [],
      confidenceScore: Number(r.confidence_score ?? 50),
      verificationStatus: (r.verification_status || 'user_provided') as PersonRecord['verificationStatus'],
      bioSummary: cf?.bioSummary || undefined,
      officialBioUrl: cf?.officialBioUrl || undefined,
      seniority: cf?.seniority || undefined,
      decisionMakingFunction: cf?.decisionMakingFunction || undefined,
      attributeProvenance: cf?.attributeProvenance || undefined,
      customFields: cf,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  private mapRowToRelationship(r: any): CompanyPersonRelationship {
    return {
      id: r.id,
      leadId: r.lead_id,
      personId: r.person_id,
      relationshipType: r.relationship_type || 'contact',
      jobTitle: r.job_title || undefined,
      designation: r.designation || undefined,
      department: r.department || undefined,
      decisionMakerCategory: r.decision_maker_category || undefined,
      isPrimaryContact: Boolean(r.is_primary_contact),
      sourceName: r.source_name || 'Owner Import',
      provenance:
        r.provenance && typeof r.provenance === 'string'
          ? JSON.parse(r.provenance)
          : r.provenance || undefined,
      confidenceScore: Number(r.confidence_score ?? 50),
      verificationStatus: (r.verification_status || 'user_provided') as CompanyPersonRelationship['verificationStatus'],
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  private mapRowToImportBatch(r: any): ImportBatchRecord {
    return {
      id: r.id,
      filename: r.filename,
      fileFormat: (r.file_format || 'csv') as 'csv' | 'xlsx',
      fileSizeBytes: Number(r.file_size_bytes || 0),
      fileSha256: r.file_sha256 || undefined,
      worksheetName: r.worksheet_name || undefined,
      encodingDetected: r.encoding_detected || undefined,
      templateId: r.template_id || undefined,
      templateName: r.template_name || undefined,
      duplicatePolicy: r.duplicate_policy || 'merge_safe',
      status: (r.status || 'completed') as ImportBatchRecord['status'],
      totalRows: Number(r.total_rows || 0),
      validRows: Number(r.valid_rows || 0),
      invalidRows: Number(r.invalid_rows || 0),
      createdCompanies: Number(r.created_companies || 0),
      updatedCompanies: Number(r.updated_companies || 0),
      createdPersons: Number(r.created_persons || 0),
      updatedPersons: Number(r.updated_persons || 0),
      createdRelationships: Number(r.created_relationships || 0),
      updatedRelationships: Number(r.updated_relationships || 0),
      skippedRows: Number(r.skipped_rows || 0),
      duplicateRows: Number(r.duplicate_rows || 0),
      conflictRows: Number(r.conflict_rows || 0),
      failedRows: Number(r.failed_rows || 0),
      durationMs: Number(r.duration_ms || 0),
      actorEmail: r.actor_email || 'Owner',
      summaryMetadata:
        r.summary_metadata && typeof r.summary_metadata === 'string'
          ? JSON.parse(r.summary_metadata)
          : r.summary_metadata || undefined,
      errorMessage: r.error_message || undefined,
      createdAt: new Date(r.created_at).toISOString(),
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : undefined,
    };
  }

  private mapRowToImportBatchRow(r: any): ImportBatchRowRecord {
    return {
      id: r.id,
      batchId: r.batch_id,
      rowNumber: Number(r.row_number),
      dedupeClassification: r.dedupe_classification,
      actionTaken: r.action_taken,
      outcome: r.outcome,
      companyName: r.company_name || undefined,
      personName: r.person_name || undefined,
      matchedLeadId: r.matched_lead_id || undefined,
      persistedLeadId: r.persisted_lead_id || undefined,
      persistedPersonId: r.persisted_person_id || undefined,
      persistedRelationshipId: r.persisted_relationship_id || undefined,
      rawData: typeof r.raw_data === 'string' ? JSON.parse(r.raw_data) : r.raw_data || {},
      normalizedData:
        typeof r.normalized_data === 'string'
          ? JSON.parse(r.normalized_data)
          : r.normalized_data || {},
      errors: typeof r.errors === 'string' ? JSON.parse(r.errors) : r.errors || [],
      warnings: typeof r.warnings === 'string' ? JSON.parse(r.warnings) : r.warnings || [],
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  // ==========================================
  // ROW MAPPER
  // ==========================================
  private mapRowToLead(row: any): CanonicalLead {
    const sources: LeadSource[] = row.sources_json || [];
    const identifiers: LeadIdentifier[] = row.identifiers_json || [];
    const notes: LeadNote[] = row.notes_json || [];
    const activities: LeadActivity[] = row.activities_json || [];

    return {
      id: row.id,
      companyName: row.company_name,
      legalName: row.legal_name || undefined,
      registrationNumber: row.registration_number || undefined,
      registrationType: row.registration_type || undefined,
      companyStatus: row.company_status,
      website: row.website || undefined,
      domain: row.domain || undefined,
      email: row.email || undefined,
      emailStatus: row.email_status,
      phone: row.phone || undefined,
      phoneNormalized: row.phone_normalized || undefined,
      address: {
        street: row.street || undefined,
        city: row.city || undefined,
        region: row.region || undefined,
        postalCode: row.postal_code || undefined,
        country: row.country,
        countryCode: row.country_code,
        formattedAddress: row.formatted_address || undefined,
      },
      coordinates: row.latitude && row.longitude ? { lat: row.latitude, lon: row.longitude } : undefined,
      industry: row.industry,
      category: row.category,
      employeeRange: row.employee_range || undefined,
      foundedYear: row.founded_year || undefined,
      confidenceScore: row.confidence_score,
      confidenceSignals: typeof row.confidence_signals === 'string' ? JSON.parse(row.confidence_signals) : row.confidence_signals || [],
      sources,
      identifiers,
      status: row.status,
      pipelineStageId: row.pipeline_stage_id || undefined,
      opportunityValue: row.opportunity_value ? parseFloat(row.opportunity_value) : 0,
      currency: row.currency || 'USD',
      winProbability: row.win_probability || 0,
      lostReason: row.lost_reason || undefined,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [],
      notes,
      activities,
      webMetadata: row.web_metadata ? (typeof row.web_metadata === 'string' ? JSON.parse(row.web_metadata) : row.web_metadata) : undefined,
      socialLinks: row.social_links ? (typeof row.social_links === 'string' ? JSON.parse(row.social_links) : row.social_links) : undefined,
      customFields: row.custom_fields ? (typeof row.custom_fields === 'string' ? JSON.parse(row.custom_fields) : row.custom_fields) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const postgresStorage = new PostgresStorage();
