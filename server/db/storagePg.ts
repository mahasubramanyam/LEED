import pg from 'pg';
import { dbManager } from './pool.js';
import {
  CanonicalLead,
  PipelineStage,
  LeadTask,
  OutreachCampaign,
  MergeHistoryRecord,
  ConnectorStatus,
  AppSettings,
  LeadSource,
  LeadIdentifier,
  LeadNote,
  LeadActivity,
} from '../types.js';

export class PostgresStorage {
  private getClient(): pg.Pool {
    const pool = dbManager.getPool();
    if (!pool) throw new Error('PostgreSQL connection pool not initialized');
    return pool;
  }

  // --- LEADS ---
  public async getLeads(filters: {
    search?: string;
    country?: string;
    status?: string;
    stage?: string;
    category?: string;
    hasWebsite?: boolean;
    hasEmail?: boolean;
    hasPhone?: boolean;
  } = {}): Promise<CanonicalLead[]> {
    const pool = this.getClient();
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
            'type', i.type,
            'value', i.value,
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
      query += ` AND (
        l.company_name ILIKE $${paramIdx} OR
        l.registration_number ILIKE $${paramIdx} OR
        l.city ILIKE $${paramIdx} OR
        l.domain ILIKE $${paramIdx}
      )`;
      values.push(`%${filters.search}%`);
      paramIdx++;
    }

    if (filters.country && filters.country !== 'ALL') {
      query += ` AND (l.country_code = $${paramIdx} OR l.country = $${paramIdx})`;
      values.push(filters.country);
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

    if (filters.hasWebsite) {
      query += ` AND l.website IS NOT NULL`;
    }

    if (filters.hasEmail) {
      query += ` AND l.email IS NOT NULL`;
    }

    if (filters.hasPhone) {
      query += ` AND l.phone IS NOT NULL`;
    }

    query += ` GROUP BY l.id ORDER BY l.created_at DESC`;

    const { rows } = await pool.query(query, values);
    return rows.map((r: any) => this.mapRowToLead(r));
  }

  public async getLead(id: string): Promise<CanonicalLead | null> {
    const pool = this.getClient();
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
            'type', i.type,
            'value', i.value,
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

    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0) return null;
    return this.mapRowToLead(rows[0]);
  }

  public async upsertLead(lead: CanonicalLead): Promise<CanonicalLead> {
    const pool = this.getClient();
    const client = await pool.connect();
    const now = new Date().toISOString();

    try {
      await client.query('BEGIN');

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
          street = EXCLUDED.street,
          city = EXCLUDED.city,
          country = EXCLUDED.country,
          confidence_score = EXCLUDED.confidence_score,
          confidence_signals = EXCLUDED.confidence_signals,
          status = EXCLUDED.status,
          pipeline_stage_id = EXCLUDED.pipeline_stage_id,
          opportunity_value = EXCLUDED.opportunity_value,
          tags = EXCLUDED.tags,
          web_metadata = EXCLUDED.web_metadata,
          social_links = EXCLUDED.social_links,
          updated_at = NOW()`,
        [
          lead.id,
          lead.companyName,
          lead.legalName || null,
          lead.registrationNumber || null,
          lead.registrationType || null,
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
          lead.pipelineStageId || null,
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
               attribution = EXCLUDED.attribution`,
            [sId, lead.id, s.sourceName, s.providerId || null, s.url || null, s.retrievedAt || now, s.license || null, s.attribution || null]
          );
        }
      }

      await client.query('COMMIT');
      return lead;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async deleteLead(id: string): Promise<boolean> {
    const pool = this.getClient();
    const { rowCount } = await pool.query('DELETE FROM leads WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  // --- STAGES ---
  public async getStages(): Promise<PipelineStage[]> {
    const pool = this.getClient();
    const { rows } = await pool.query('SELECT * FROM pipeline_stages ORDER BY display_order ASC');
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      order: r.display_order,
    }));
  }

  // --- TASKS ---
  public async getTasks(): Promise<LeadTask[]> {
    const pool = this.getClient();
    const { rows } = await pool.query('SELECT * FROM tasks ORDER BY due_date ASC');
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
  }

  public async createTask(task: Omit<LeadTask, 'id' | 'createdAt'>): Promise<LeadTask> {
    const pool = this.getClient();
    const id = `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    await pool.query(
      `INSERT INTO tasks (id, lead_id, title, due_date, priority, completed, assigned_to, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, task.leadId || null, task.title, task.dueDate, task.priority, task.completed ?? false, task.assignedTo, now]
    );

    return { ...task, id, createdAt: now };
  }

  public async updateTask(id: string, updates: Partial<LeadTask>): Promise<LeadTask | null> {
    const pool = this.getClient();
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (rows.length === 0) return null;

    const current = rows[0];
    const newCompleted = updates.completed !== undefined ? updates.completed : current.completed;
    const newTitle = updates.title || current.title;
    const newPriority = updates.priority || current.priority;
    const newDueDate = updates.dueDate || current.due_date;

    await pool.query(
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
  }

  public async deleteTask(id: string): Promise<boolean> {
    const pool = this.getClient();
    const { rowCount } = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  // --- CAMPAIGNS ---
  public async getCampaigns(): Promise<OutreachCampaign[]> {
    const pool = this.getClient();
    const campsQuery = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
    const msgsQuery = await pool.query('SELECT * FROM campaign_messages ORDER BY created_at ASC');

    const msgsByCamp = new Map<string, any[]>();
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
  }

  // --- AUDIT LOGS ---
  public async recordAuditEvent(
    action: string,
    actorEmail: string,
    entityType?: string,
    entityId?: string,
    details?: any,
    ipAddress?: string
  ): Promise<void> {
    const pool = this.getClient();
    const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await pool.query(
      `INSERT INTO audit_events (id, action, actor_email, entity_type, entity_id, details, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [id, action, actorEmail, entityType || null, entityId || null, details ? JSON.stringify(details) : null, ipAddress || null]
    );
  }

  // Row mapper
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
      pipelineStageId: row.pipeline_stage_id || 'stage-discovered',
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
