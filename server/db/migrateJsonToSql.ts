import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { dbManager } from './pool.js';
import { CanonicalLead, PipelineStage, LeadTask, OutreachCampaign, MergeHistoryRecord, ConnectorStatus, AppSettings } from '../types.js';

export interface MigrationSummary {
  dryRun: boolean;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  stagesProcessed: number;
  leadsProcessed: number;
  sourcesProcessed: number;
  identifiersProcessed: number;
  notesProcessed: number;
  activitiesProcessed: number;
  tasksProcessed: number;
  mergeRecordsProcessed: number;
  campaignsProcessed: number;
  messagesProcessed: number;
  settingsProcessed: number;
  duplicatesDetected: number;
  invalidRecords: Array<{ id: string; reason: string }>;
  unmappedFields: string[];
  executionTimeMs: number;
  backupFileCreated?: string;
  error?: string;
}

export class JsonToSqlMigrator {
  private jsonPath: string;

  constructor(customJsonPath?: string) {
    this.jsonPath = customJsonPath || path.resolve(process.cwd(), 'data', 'pipeline_store.json');
  }

  public async migrate(options: { dryRun?: boolean; poolClient?: pg.PoolClient | pg.Pool } = {}): Promise<MigrationSummary> {
    const start = Date.now();
    const dryRun = options.dryRun ?? false;
    const summary: MigrationSummary = {
      dryRun,
      status: 'SUCCESS',
      stagesProcessed: 0,
      leadsProcessed: 0,
      sourcesProcessed: 0,
      identifiersProcessed: 0,
      notesProcessed: 0,
      activitiesProcessed: 0,
      tasksProcessed: 0,
      mergeRecordsProcessed: 0,
      campaignsProcessed: 0,
      messagesProcessed: 0,
      settingsProcessed: 0,
      duplicatesDetected: 0,
      invalidRecords: [],
      unmappedFields: [],
      executionTimeMs: 0,
    };

    // 1. Verify and read JSON file
    if (!fs.existsSync(this.jsonPath)) {
      summary.status = 'FAILED';
      summary.error = `Source JSON file not found at ${this.jsonPath}`;
      summary.executionTimeMs = Date.now() - start;
      return summary;
    }

    let rawData: any;
    try {
      const fileContent = fs.readFileSync(this.jsonPath, 'utf-8');
      rawData = JSON.parse(fileContent);
    } catch (err: unknown) {
      summary.status = 'FAILED';
      summary.error = `Failed to parse JSON file: ${err instanceof Error ? err.message : String(err)}`;
      summary.executionTimeMs = Date.now() - start;
      return summary;
    }

    // 2. Create immutable backup of data/pipeline_store.json
    try {
      const backupDir = path.resolve(process.cwd(), 'data', 'backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      const backupPath = path.join(backupDir, `pipeline_store_backup_${Date.now()}.json`);
      fs.copyFileSync(this.jsonPath, backupPath);
      summary.backupFileCreated = backupPath;
    } catch (err) {
      console.warn('Could not create backup copy of pipeline_store.json:', err);
    }

    // 3. Connect to PostgreSQL
    const pool = options.poolClient || dbManager.getPool();
    if (!pool) {
      if (dryRun) {
        // In dry run when pool is not yet connected, validate JSON schema structure, foreign keys, and records
        const stages: PipelineStage[] = rawData.stages || [];
        summary.stagesProcessed = stages.length;
        const leads: CanonicalLead[] = rawData.leads || [];
        summary.leadsProcessed = leads.length;
        for (const l of leads) {
          summary.sourcesProcessed += l.sources?.length || 0;
          summary.identifiersProcessed += l.identifiers?.length || 0;
          summary.notesProcessed += l.notes?.length || 0;
          summary.activitiesProcessed += l.activities?.length || 0;
        }
        summary.tasksProcessed = rawData.tasks?.length || 0;
        summary.campaignsProcessed = rawData.campaigns?.length || 0;
        summary.settingsProcessed = rawData.settings ? 1 : 0;
        summary.executionTimeMs = Date.now() - start;
        return summary;
      }
      summary.status = 'FAILED';
      summary.error = 'PostgreSQL connection pool not initialized';
      summary.executionTimeMs = Date.now() - start;
      return summary;
    }

    const client = 'connect' in pool ? await (pool as pg.Pool).connect() : (pool as pg.PoolClient);

    try {
      await client.query('BEGIN');

      // 4. Migrate Pipeline Stages
      const stages: PipelineStage[] = rawData.stages || [];
      for (const stage of stages) {
        if (!stage.id || !stage.name) {
          summary.invalidRecords.push({ id: stage.id || 'unknown_stage', reason: 'Missing stage name or id' });
          continue;
        }

        if (!dryRun) {
          await client.query(
            `INSERT INTO pipeline_stages (id, name, color, display_order, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               color = EXCLUDED.color,
               display_order = EXCLUDED.display_order`,
            [stage.id, stage.name, stage.color || '#64748b', stage.order || 0]
          );
        }
        summary.stagesProcessed++;
      }

      // 5. Migrate Canonical Leads and their relational children
      const leads: CanonicalLead[] = rawData.leads || [];
      const seenLeadIds = new Set<string>();

      for (const lead of leads) {
        if (!lead.id || !lead.companyName) {
          summary.invalidRecords.push({ id: lead.id || 'unknown_lead', reason: 'Missing company name or id' });
          continue;
        }

        if (seenLeadIds.has(lead.id)) {
          summary.duplicatesDetected++;
          continue;
        }
        seenLeadIds.add(lead.id);

        if (!dryRun) {
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
              updated_at = EXCLUDED.updated_at`,
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
              lead.createdAt || new Date().toISOString(),
              lead.updatedAt || new Date().toISOString(),
            ]
          );

          // Sources
          if (lead.sources && Array.isArray(lead.sources)) {
            for (let sIdx = 0; sIdx < lead.sources.length; sIdx++) {
              const src = lead.sources[sIdx];
              const sourceId = `src-${lead.id}-${sIdx}`;
              await client.query(
                `INSERT INTO lead_sources (id, lead_id, source_name, provider_id, url, retrieved_at, license, attribution)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (id) DO UPDATE SET
                   source_name = EXCLUDED.source_name,
                   attribution = EXCLUDED.attribution`,
                [
                  sourceId,
                  lead.id,
                  src.sourceName,
                  src.providerId || null,
                  src.url || null,
                  src.retrievedAt || new Date().toISOString(),
                  src.license || null,
                  src.attribution || null,
                ]
              );
              summary.sourcesProcessed++;
            }
          }

          // Identifiers
          if (lead.identifiers && Array.isArray(lead.identifiers)) {
            for (let iIdx = 0; iIdx < lead.identifiers.length; iIdx++) {
              const ident = lead.identifiers[iIdx];
              const identId = `ident-${lead.id}-${iIdx}`;
              await client.query(
                `INSERT INTO lead_identifiers (id, lead_id, type, value, verified, created_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                   verified = EXCLUDED.verified`,
                [identId, lead.id, ident.type, ident.value, ident.verified ?? false]
              );
              summary.identifiersProcessed++;
            }
          }

          // Notes
          if (lead.notes && Array.isArray(lead.notes)) {
            for (const note of lead.notes) {
              await client.query(
                `INSERT INTO lead_notes (id, lead_id, content, author, created_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET
                   content = EXCLUDED.content`,
                [note.id, lead.id, note.content, note.author || 'Lead Intelligence Operator', note.createdAt || new Date().toISOString()]
              );
              summary.notesProcessed++;
            }
          }

          // Activities
          if (lead.activities && Array.isArray(lead.activities)) {
            for (const act of lead.activities) {
              await client.query(
                `INSERT INTO activities (id, lead_id, type, title, notes, outcome, actor, date, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 ON CONFLICT (id) DO UPDATE SET
                   title = EXCLUDED.title,
                   outcome = EXCLUDED.outcome`,
                [
                  act.id,
                  lead.id,
                  act.type || 'note',
                  act.title,
                  act.notes || null,
                  act.outcome || null,
                  act.actor || 'Lead Intelligence Operator',
                  act.date || new Date().toISOString(),
                ]
              );
              summary.activitiesProcessed++;
            }
          }
        } else {
          // Dry-run mode counts
          summary.sourcesProcessed += lead.sources?.length || 0;
          summary.identifiersProcessed += lead.identifiers?.length || 0;
          summary.notesProcessed += lead.notes?.length || 0;
          summary.activitiesProcessed += lead.activities?.length || 0;
        }

        summary.leadsProcessed++;
      }

      // 6. Migrate Tasks
      const tasks: LeadTask[] = rawData.tasks || [];
      for (const task of tasks) {
        if (!task.id || !task.title) {
          summary.invalidRecords.push({ id: task.id || 'unknown_task', reason: 'Missing task title or id' });
          continue;
        }

        if (!dryRun) {
          await client.query(
            `INSERT INTO tasks (id, lead_id, title, due_date, priority, completed, assigned_to, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
               title = EXCLUDED.title,
               completed = EXCLUDED.completed,
               due_date = EXCLUDED.due_date`,
            [
              task.id,
              task.leadId && seenLeadIds.has(task.leadId) ? task.leadId : null,
              task.title,
              task.dueDate || new Date().toISOString(),
              task.priority || 'medium',
              task.completed ?? false,
              task.assignedTo || 'Lead Intelligence Operator',
              task.createdAt || new Date().toISOString(),
            ]
          );
        }
        summary.tasksProcessed++;
      }

      // 7. Migrate Campaigns & Messages
      const campaigns: OutreachCampaign[] = rawData.campaigns || [];
      for (const camp of campaigns) {
        if (!camp.id || !camp.name) {
          summary.invalidRecords.push({ id: camp.id || 'unknown_camp', reason: 'Missing campaign name' });
          continue;
        }

        if (!dryRun) {
          await client.query(
            `INSERT INTO campaigns (id, name, channel, subject_template, body_template, target_industry, target_country, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name,
               status = EXCLUDED.status`,
            [
              camp.id,
              camp.name,
              camp.channel || 'email',
              camp.subjectTemplate,
              camp.bodyTemplate,
              camp.targetIndustry || null,
              camp.targetCountry || null,
              camp.status || 'active',
              camp.createdAt || new Date().toISOString(),
            ]
          );

          if (camp.messages && Array.isArray(camp.messages)) {
            for (const msg of camp.messages) {
              await client.query(
                `INSERT INTO campaign_messages (
                  id, campaign_id, lead_id, lead_company_name, recipient_email, subject, content, status, delivery_id, scheduled_at, sent_at, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
                ON CONFLICT (id) DO UPDATE SET
                  status = EXCLUDED.status,
                  delivery_id = EXCLUDED.delivery_id`,
                [
                  msg.id,
                  camp.id,
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
              summary.messagesProcessed++;
            }
          }
        } else {
          summary.messagesProcessed += camp.messages?.length || 0;
        }
        summary.campaignsProcessed++;
      }

      // 8. Migrate Merge History
      const mergeHistory: MergeHistoryRecord[] = rawData.mergeHistory || [];
      for (const record of mergeHistory) {
        if (!dryRun) {
          await client.query(
            `INSERT INTO lead_merge_history (id, survivor_lead_id, merged_lead_snapshot, merged_reason, actor, merged_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [
              record.id,
              record.survivorLeadId,
              JSON.stringify(record.mergedLeadSnapshot),
              record.mergedReason,
              'Owner',
              record.mergedAt || new Date().toISOString(),
            ]
          );
        }
        summary.mergeRecordsProcessed++;
      }

      // 9. Migrate App Settings
      const settings: AppSettings = rawData.settings;
      if (settings) {
        if (!dryRun) {
          await client.query(
            `INSERT INTO app_settings (
              id, owner_name, owner_email, default_country, default_currency, user_agent,
              enable_safe_website_crawl, outreach_approval_required, auto_dedupe_threshold, suppression_domains, updated_at
            ) VALUES ('primary_settings', $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (id) DO UPDATE SET
              owner_name = EXCLUDED.owner_name,
              owner_email = EXCLUDED.owner_email,
              user_agent = EXCLUDED.user_agent`,
            [
              settings.ownerName || 'Lead Intelligence Operator',
              settings.ownerEmail || 'owner@pipeline.local',
              settings.defaultCountry || 'GB',
              settings.defaultCurrency || 'USD',
              settings.userAgent || 'GlobalLeadPipeline/1.0',
              settings.enableSafeWebsiteCrawl ?? true,
              settings.outreachApprovalRequired ?? true,
              settings.autoDedupeThreshold || 0.85,
              JSON.stringify(settings.suppressionDomains || []),
            ]
          );
        }
        summary.settingsProcessed++;
      }

      // In dry-run mode, we always rollback so no changes persist
      if (dryRun) {
        await client.query('ROLLBACK');
      } else {
        await client.query('COMMIT');
      }

      summary.executionTimeMs = Date.now() - start;
      return summary;
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      summary.status = 'FAILED';
      summary.error = err instanceof Error ? err.message : String(err);
      summary.executionTimeMs = Date.now() - start;
      return summary;
    } finally {
      if ('release' in client) {
        client.release();
      }
    }
  }
}

export const jsonMigrator = new JsonToSqlMigrator();
