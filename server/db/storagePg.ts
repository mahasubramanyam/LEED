import pg from 'pg';
import { dbManager } from './pool.js';
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
    status?: string;
    stage?: string;
    category?: string;
    hasWebsite?: boolean;
    hasEmail?: boolean;
    hasPhone?: boolean;
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
        query += ` AND l.website IS NOT NULL AND l.website != ''`;
      }

      if (filters.hasEmail) {
        query += ` AND l.email IS NOT NULL AND l.email != ''`;
      }

      if (filters.hasPhone) {
        query += ` AND l.phone IS NOT NULL AND l.phone != ''`;
      }

      query += ` GROUP BY l.id ORDER BY l.created_at DESC`;

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

      const { rows } = await client.query(query, [id]);
      if (rows.length === 0) return null;
      return this.mapRowToLead(rows[0]);
    } finally {
      if (client) client.release();
    }
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
               attribution = EXCLUDED.attribution,
               retrieved_at = EXCLUDED.retrieved_at`,
            [sId, lead.id, s.sourceName, s.providerId || null, s.url || null, s.retrievedAt || now, s.license || null, s.attribution || null]
          );
        }
      }

      // Re-insert identifiers if present
      if (lead.identifiers && lead.identifiers.length > 0) {
        for (let idx = 0; idx < lead.identifiers.length; idx++) {
          const ident = lead.identifiers[idx];
          const identId = `ident-${lead.id}-${idx}`;
          await client.query(
            `INSERT INTO lead_identifiers (id, lead_id, type, value, verified, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (lead_id, type, value) DO UPDATE SET
               verified = EXCLUDED.verified`,
            [identId, lead.id, ident.type, ident.value, ident.verified ?? false]
          );
        }
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
      return lead;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  public async batchUpsertLeads(newLeads: CanonicalLead[]): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;
    for (const lead of newLeads) {
      const existing = await this.getLead(lead.id);
      if (existing) {
        await this.upsertLead({ ...existing, ...lead });
        updated++;
      } else {
        await this.upsertLead(lead);
        added++;
      }
    }
    return { added, updated };
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

      // Fetch stage details
      const stageRes = await client.query('SELECT name FROM pipeline_stages WHERE id = $1', [stageId]);
      const targetStageName = stageRes.rows[0]?.name || stageId;

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
      const { rows } = await client.query('SELECT * FROM pipeline_stages ORDER BY display_order ASC');
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
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      const { rows } = await client.query('SELECT * FROM app_settings WHERE id = $1', ['primary_settings']);
      if (rows.length > 0) {
        const r = rows[0];
        return {
          ownerName: r.owner_name,
          ownerEmail: r.owner_email,
          defaultCountry: r.default_country,
          defaultCurrency: r.default_currency,
          userAgent: r.user_agent,
          enableSafeWebsiteCrawl: r.enable_safe_website_crawl,
          outreachApprovalRequired: r.outreach_approval_required,
          autoDedupeThreshold: parseFloat(r.auto_dedupe_threshold),
          suppressionDomains: typeof r.suppression_domains === 'string' ? JSON.parse(r.suppression_domains) : r.suppression_domains || [],
        };
      }

      // Default fallback if not yet initialized in DB
      return {
        ownerName: 'Lead Intelligence Operator',
        ownerEmail: 'owner@pipeline.local',
        defaultCountry: 'GB',
        defaultCurrency: 'USD',
        userAgent: 'GlobalLeadPipeline/1.0',
        enableSafeWebsiteCrawl: true,
        outreachApprovalRequired: true,
        autoDedupeThreshold: 0.85,
        suppressionDomains: ['example.com', 'test.com', 'spamdomain.org'],
      };
    } finally {
      if (client) client.release();
    }
  }

  public async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const current = await this.getSettings();
    const updated = { ...current, ...updates };

    try {
      client = await pool.connect();
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
      return updated;
    } finally {
      if (client) client.release();
    }
  }

  // ==========================================
  // 7. CONNECTORS & AUDIT
  // ==========================================

  public async getConnectors(): Promise<ConnectorStatus[]> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    try {
      client = await pool.connect();
      // Aggregate statistics from connector_runs
      const { rows } = await client.query(`
        SELECT 
          connector_id,
          COUNT(*) as total_calls,
          MAX(executed_at) as last_run_at,
          (ARRAY_AGG(error_message ORDER BY executed_at DESC))[1] as last_error,
          (ARRAY_AGG(status ORDER BY executed_at DESC))[1] as last_status
        FROM connector_runs
        GROUP BY connector_id
      `);

      const statsMap = new Map<string, any>();
      for (const r of rows) {
        statsMap.set(r.connector_id, r);
      }

      const defaultConnectors: ConnectorStatus[] = [
        {
          id: 'conn-brreg',
          name: 'Brønnøysund Register Centre (Brreg)',
          category: 'government_registry',
          countryCoverage: ['NO'],
          status: 'healthy',
          authType: 'none_open',
          isConfigured: true,
          rateLimitNote: '100% Free Open API (data.brreg.no), no key required',
          attribution: 'Norwegian Licence for Open Government Data (NLOD)',
          totalCalls: 0,
        },
        {
          id: 'conn-companies-house',
          name: 'UK Companies House Registry',
          category: 'government_registry',
          countryCoverage: ['GB'],
          status: 'healthy',
          authType: 'api_key',
          isConfigured: !!process.env.COMPANIES_HOUSE_API_KEY,
          rateLimitNote: '600 reqs / 5 mins. Free key at developer.company-information.service.gov.uk',
          attribution: 'Crown Copyright (Open Government Licence v3.0)',
          totalCalls: 0,
        },
        {
          id: 'conn-osm',
          name: 'OpenStreetMap & Nominatim POI',
          category: 'maps_geo',
          countryCoverage: ['GLOBAL', 'GB', 'NO', 'US', 'AU', 'DE', 'FR', 'IN'],
          status: 'healthy',
          authType: 'none_open',
          isConfigured: true,
          rateLimitNote: 'Max 1 req/sec compliance with Nominatim Usage Policy',
          attribution: '© OpenStreetMap contributors (ODbL License)',
          totalCalls: 0,
        },
        {
          id: 'conn-abn',
          name: 'Australian Business Register (ABN Lookup)',
          category: 'government_registry',
          countryCoverage: ['AU'],
          status: 'healthy',
          authType: 'none_open',
          isConfigured: true,
          rateLimitNote: 'ABN modulo-89 algorithmic checksum verification',
          attribution: 'Commonwealth of Australia Open Data',
          totalCalls: 0,
        },
        {
          id: 'conn-web-inspector',
          name: 'Safe Website Inspector & SSRF Shield',
          category: 'web_search',
          countryCoverage: ['GLOBAL'],
          status: 'healthy',
          authType: 'none_open',
          isConfigured: true,
          rateLimitNote: 'DNS pinning, private IP range blocking, 300KB response cap',
          attribution: 'Direct HTTP Inspection via internal safe crawler',
          totalCalls: 0,
        },
        {
          id: 'conn-gemini',
          name: 'Gemini AI Sales & Intelligence Engine',
          category: 'ai_engine',
          countryCoverage: ['GLOBAL'],
          status: 'healthy',
          authType: 'environment',
          isConfigured: !!process.env.GEMINI_API_KEY,
          rateLimitNote: 'gemini-3.8-flash server-side inference',
          attribution: 'Google GenAI SDK',
          totalCalls: 0,
        },
      ];

      return defaultConnectors.map((conn) => {
        const stats = statsMap.get(conn.id);
        if (stats) {
          return {
            ...conn,
            totalCalls: parseInt(stats.total_calls, 10),
            lastRunAt: stats.last_run_at,
            lastError: stats.last_error || undefined,
            status: stats.last_status === 'error' ? 'degraded' : 'healthy',
          };
        }
        return conn;
      });
    } finally {
      if (client) client.release();
    }
  }

  public async recordConnectorActivity(connectorId: string, success: boolean, errorMessage?: string): Promise<void> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const id = `run-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      client = await pool.connect();
      await client.query(
        `INSERT INTO connector_runs (id, connector_id, total_found, total_saved, status, error_message, executed_at)
         VALUES ($1, $2, 0, 0, $3, $4, NOW())`,
        [id, connectorId, success ? 'success' : 'error', errorMessage || null]
      );
    } catch (err) {
      console.warn('[PostgresStorage] Could not record connector run:', err);
    } finally {
      if (client) client.release();
    }
  }

  public async recordAuditEvent(
    action: string,
    actorEmail: string,
    entityType?: string,
    entityId?: string,
    details?: any,
    ipAddress?: string
  ): Promise<void> {
    const pool = this.getClient();
    let client: pg.PoolClient | null = null;
    const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    try {
      client = await pool.connect();
      await client.query(
        `INSERT INTO audit_events (id, action, actor_email, entity_type, entity_id, details, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [id, action, actorEmail, entityType || null, entityId || null, details ? JSON.stringify(details) : null, ipAddress || null]
      );
    } catch (err) {
      console.warn('[PostgresStorage] Could not record audit event:', err);
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
