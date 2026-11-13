import pg from 'pg';
import { dbManager } from './pool.js';
import { canonicalizeIdentifierType, getIdentifierAliases } from '../../shared/identifierRegistry.js';
import { DEFAULT_PIPELINE_STAGES } from '../../shared/defaultStages.js';
import { normalizeIdentifierValue } from '../identifiers/identifierEngine.js';
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
} from '../types.js';

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

    const identRank = (ident: LeadIdentifier): number => {
      if (ident.verified || ident.status === 'officially_verified') return 4;
      if (ident.status === 'syntax_validated') return 3;
      if (ident.status === 'discovered') return 2;
      return 1;
    };

    const indexLead = (l: CanonicalLead) => {
      byId.set(l.id, l);
      if (l.domain) byDomain.set(l.domain.toLowerCase().trim(), l);
      if (l.registrationNumber) {
        const cleanReg = normalizeIdentifierValue(l.registrationNumber);
        if (cleanReg.length >= 4) byReg.set(cleanReg, l);
      }
      for (const ident of l.identifiers || []) {
        const cleanVal = normalizeIdentifierValue(ident.normalizedValue || ident.value);
        if (cleanVal.length >= 4) {
          const canonType = canonicalizeIdentifierType(ident.type, l.address?.countryCode);
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
          const cleanReg = normalizeIdentifierValue(lead.registrationNumber);
          if (cleanReg.length >= 4) match = byReg.get(cleanReg);
        }
        if (!match) {
          for (const ident of lead.identifiers || []) {
            const cleanVal = normalizeIdentifierValue(ident.normalizedValue || ident.value);
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
          const identKey = (i: LeadIdentifier) =>
            `${canonicalizeIdentifierType(i.type, i.countryCode || match!.address?.countryCode)}:${normalizeIdentifierValue(i.normalizedValue || i.value)}`;
          const mergedIdentsMap = new Map<string, LeadIdentifier>();
          for (const i of match.identifiers || []) mergedIdentsMap.set(identKey(i), i);
          for (const i of lead.identifiers || []) {
            const k = identKey(i);
            const prev = mergedIdentsMap.get(k);
            if (!prev || identRank(i) > identRank(prev)) {
              mergedIdentsMap.set(k, i);
            }
          }

          const sourceKey = (s: { sourceName: string; providerId?: string; url?: string }) =>
            `${s.sourceName}:${s.providerId || s.url || ''}`;
          const existingSourceKeys = new Set((match.sources || []).map(sourceKey));
          const combinedSources = [...(match.sources || [])];
          for (const s of lead.sources || []) {
            const sk = sourceKey(s);
            if (!existingSourceKeys.has(sk)) {
              existingSourceKeys.add(sk);
              combinedSources.push(s);
            }
          }

          const existingActIds = new Set((match.activities || []).map((a) => a.id));
          const mergedActivities = [
            ...(match.activities || []),
            ...(lead.activities || []).filter((a) => !existingActIds.has(a.id)),
          ];

          const merged: CanonicalLead = {
            ...match,
            id: match.id,
            createdAt: match.createdAt,
            updatedAt: new Date().toISOString(),
            companyName: match.companyName || lead.companyName,
            legalName: match.legalName || lead.legalName,
            registrationNumber: match.registrationNumber || lead.registrationNumber,
            registrationType: match.registrationType || lead.registrationType,
            companyStatus:
              match.companyStatus && match.companyStatus !== 'unknown'
                ? match.companyStatus
                : lead.companyStatus || match.companyStatus,
            website: match.website || lead.website,
            domain: match.domain || lead.domain,
            email: match.email || lead.email,
            emailStatus: match.email ? match.emailStatus : lead.emailStatus || match.emailStatus,
            phone: match.phone || lead.phone,
            phoneNormalized: match.phoneNormalized || lead.phoneNormalized,
            address: {
              street: match.address?.street || lead.address?.street,
              city: match.address?.city || lead.address?.city,
              region: match.address?.region || lead.address?.region,
              postalCode: match.address?.postalCode || lead.address?.postalCode,
              country: match.address?.country || lead.address?.country || 'International',
              countryCode: match.address?.countryCode || lead.address?.countryCode || 'US',
              formattedAddress: match.address?.formattedAddress || lead.address?.formattedAddress,
            },
            coordinates: match.coordinates || lead.coordinates,
            industry:
              match.industry && match.industry !== 'General Commerce & Services'
                ? match.industry
                : lead.industry || match.industry,
            category:
              match.category && match.category !== 'General'
                ? match.category
                : lead.category || match.category,
            employeeRange: match.employeeRange || lead.employeeRange,
            foundedYear: match.foundedYear || lead.foundedYear,
            status: match.status,
            pipelineStageId: match.pipelineStageId,
            opportunityValue: match.opportunityValue ?? lead.opportunityValue ?? 0,
            currency: match.currency || lead.currency || 'USD',
            winProbability: match.winProbability ?? lead.winProbability ?? 0,
            lostReason: match.lostReason,
            confidenceScore: Math.max(match.confidenceScore || 0, lead.confidenceScore || 0),
            confidenceSignals: Array.from(new Set([...(match.confidenceSignals || []), ...(lead.confidenceSignals || [])])),
            tags: Array.from(new Set([...(match.tags || []), ...(lead.tags || [])])),
            identifiers: Array.from(mergedIdentsMap.values()),
            sources: combinedSources,
            socialLinks: { ...(lead.socialLinks || {}), ...(match.socialLinks || {}) },
            webMetadata: match.webMetadata || lead.webMetadata,
            notes: match.notes || [],
            activities: mergedActivities,
            customFields: { ...(lead.customFields || {}), ...(match.customFields || {}) },
          };
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
          return parsed;
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
