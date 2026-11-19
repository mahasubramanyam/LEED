// Phase 14: Controlled Server-Side AI Agent Tool Architecture
// Strictly enforces an allowlist of LEED services, validates inputs, blocks SQL/shell payloads,
// enforces explicit opt-in for owner private notes, reuses SSRF-safe website inspection,
// and never silently mutates CRM records (all writes become pending_approval proposals).

import {
  AI_ACTION_PROPOSAL_TYPE_SET,
  AI_AUTHORIZED_TOOLS,
  AI_AUTHORIZED_TOOL_NAMES,
} from '../../shared/aiAgentSpecs.js';
import type {
  AiActionProposal,
  AiActionProposalType,
  AiToolExecutionRecord,
} from '../types.js';
import type { CrmStorageFacade } from '../crm/crmStoreHelper.js';
import {
  listAllCrmInteractions,
  listAllCrmOpportunities,
  listAllCrmPrivateNotes,
  listAllExtendedTasks,
} from '../crm/crmStoreHelper.js';
import {
  buildCompanyRelationshipProfile,
  buildPersonRelationshipProfile,
} from '../crm/relationshipEngine.js';
import { buildCrmDashboardSummary } from '../crm/crmDashboardService.js';
import { buildReminderCenter } from '../crm/reminderEngine.js';
import { evaluateCompanyDataQuality } from '../enrichment/dataQualityEngine.js';
import { inspectWebsite } from '../connectors/webInspector.js';
import {
  addAiActionProposals,
  generateAiId,
  listIcpProfiles,
} from './aiStoreHelper.js';
import { evaluateCompanyAgainstIcp } from './icpEngine.js';
import { prioritizeCrmLeads } from './prioritizationEngine.js';

export interface ControlledToolExecutionContext {
  facade: CrmStorageFacade;
  includePrivateNotes: boolean;
  conversationId?: string;
}

export interface ControlledToolResult {
  record: AiToolExecutionRecord;
  data: unknown;
}

const DANGEROUS_PAYLOAD_PATTERN =
  /(\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\bUNION\s+SELECT\b|\bALTER\s+TABLE\b|;\s*SELECT\b|\bexec\s*\(|\bchild_process\b|\$\(.*\)|`[^`]*rm\s+-rf)/i;

function assertSafeArguments(args: Record<string, unknown>): void {
  const serialized = JSON.stringify(args || {});
  if (serialized.length > 12000) {
    throw new Error('Tool argument payload exceeds maximum allowed size.');
  }
  if (DANGEROUS_PAYLOAD_PATTERN.test(serialized)) {
    throw new Error('Blocked unsafe SQL or shell-like argument payload.');
  }
}

export function listAuthorizedAgentTools() {
  return AI_AUTHORIZED_TOOLS;
}

export async function executeControlledAgentTool(
  ctx: ControlledToolExecutionContext,
  toolName: string,
  rawArgs: Record<string, unknown> = {}
): Promise<ControlledToolResult> {
  const startedAt = Date.now();
  const executedAt = new Date().toISOString();

  if (!AI_AUTHORIZED_TOOL_NAMES.has(toolName)) {
    throw new Error(`Unauthorized AI tool requested: "${toolName}". Only allowlisted LEED tools are permitted.`);
  }

  const toolSpec = AI_AUTHORIZED_TOOLS.find((t) => t.name === toolName)!;
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  assertSafeArguments(args);

  if (toolSpec.requiresPrivateNoteConsent && !ctx.includePrivateNotes) {
    throw new Error(
      'Access denied: owner private notes cannot be read by the AI agent without explicit owner opt-in (includePrivateNotes: true).'
    );
  }

  try {
    let data: unknown;
    let summary = '';

    switch (toolName) {
      case 'search_crm_companies': {
        const query = String(args.query || '').trim().toLowerCase();
        const country = String(args.country || '').trim().toUpperCase();
        const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));
        const leads = await ctx.facade.getLeads();
        const filtered = leads
          .filter((l) => {
            if (country && (l.address?.countryCode || '').toUpperCase() !== country) return false;
            if (!query) return true;
            return (
              l.companyName.toLowerCase().includes(query) ||
              (l.industry || '').toLowerCase().includes(query) ||
              (l.address?.country || '').toLowerCase().includes(query) ||
              (l.address?.city || '').toLowerCase().includes(query)
            );
          })
          .slice(0, limit)
          .map((l) => ({
            id: l.id,
            companyName: l.companyName,
            industry: l.industry,
            country: l.address?.country,
            countryCode: l.address?.countryCode,
            website: l.website,
            status: l.status,
            confidenceScore: l.confidenceScore,
          }));
        data = { totalMatched: filtered.length, companies: filtered };
        summary = `Searched CRM companies${query ? ` for "${query}"` : ''}: ${filtered.length} match(es).`;
        break;
      }

      case 'search_decision_makers': {
        const query = String(args.query || '').trim().toLowerCase();
        const leadId = typeof args.leadId === 'string' ? args.leadId.trim() : undefined;
        const [persons, rels] = await Promise.all([
          ctx.facade.getPersons(),
          ctx.facade.getCompanyPersonRelationships(),
        ]);
        const allowedPersonIds = leadId
          ? new Set(rels.filter((r) => r.leadId === leadId).map((r) => r.personId))
          : null;
        const relByPerson = new Map<string, (typeof rels)[number]>();
        for (const r of rels) {
          if (!relByPerson.has(r.personId) || r.isPrimaryContact) {
            relByPerson.set(r.personId, r);
          }
        }
        const filtered = persons
          .filter((p) => {
            if (allowedPersonIds && !allowedPersonIds.has(p.id)) return false;
            if (!query) return true;
            const rel = relByPerson.get(p.id);
            return (
              p.fullName.toLowerCase().includes(query) ||
              (rel?.jobTitle || '').toLowerCase().includes(query) ||
              (rel?.department || '').toLowerCase().includes(query) ||
              (p.seniority || '').toLowerCase().includes(query) ||
              (p.decisionMakingFunction || '').toLowerCase().includes(query)
            );
          })
          .slice(0, 20)
          .map((p) => {
            const rel = relByPerson.get(p.id);
            return {
              id: p.id,
              fullName: p.fullName,
              jobTitle: rel?.jobTitle || rel?.designation || rel?.relationshipType,
              department: rel?.department,
              seniority: p.seniority,
              verificationStatus: p.verificationStatus,
              email: p.email,
              emailStatus: p.emailStatus,
            };
          });
        data = { totalMatched: filtered.length, decisionMakers: filtered };
        summary = `Searched decision-makers: ${filtered.length} match(es).`;
        break;
      }

      case 'get_company_profile': {
        const leadId = String(args.leadId || '').trim();
        if (!leadId) throw new Error('leadId is required for get_company_profile.');
        const profile = await buildCompanyRelationshipProfile(ctx.facade, leadId);
        if (!profile) throw new Error('Company lead not found.');
        data = {
          ...profile,
          // Strictly strip private notes unless explicitly authorized
          privateNotes: ctx.includePrivateNotes ? profile.privateNotes : [],
          privateNotesWithheldCount: ctx.includePrivateNotes ? 0 : profile.privateNotes.length,
        };
        summary = `Loaded company profile for ${profile.lead.companyName} (${profile.decisionMakers.length} contact(s), ${profile.interactions.length} interaction(s)).`;
        break;
      }

      case 'get_person_profile': {
        const personId = String(args.personId || '').trim();
        if (!personId) throw new Error('personId is required for get_person_profile.');
        const profile = await buildPersonRelationshipProfile(ctx.facade, personId);
        if (!profile) throw new Error('Person not found.');
        data = {
          ...profile,
          privateNotes: ctx.includePrivateNotes ? profile.privateNotes : [],
          privateNotesWithheldCount: ctx.includePrivateNotes ? 0 : profile.privateNotes.length,
        };
        summary = `Loaded person profile for ${profile.person.fullName} (${profile.currentCompanies.length} current company link(s)).`;
        break;
      }

      case 'get_relationship_history': {
        const leadId = typeof args.leadId === 'string' ? args.leadId.trim() : undefined;
        const personId = typeof args.personId === 'string' ? args.personId.trim() : undefined;
        const interactions = await listAllCrmInteractions(ctx.facade, {
          leadId,
          personId,
          limit: 20,
        });
        data = { count: interactions.length, interactions };
        summary = `Loaded ${interactions.length} chronological relationship interaction(s).`;
        break;
      }

      case 'list_opportunities': {
        const leadId = typeof args.leadId === 'string' ? args.leadId.trim() : undefined;
        const status = typeof args.status === 'string' ? args.status.trim() : undefined;
        const opps = await listAllCrmOpportunities(ctx.facade, { leadId, status });
        data = { count: opps.length, opportunities: opps.slice(0, 25) };
        summary = `Listed ${opps.length} CRM opportunity record(s).`;
        break;
      }

      case 'list_tasks': {
        const leadId = typeof args.leadId === 'string' ? args.leadId.trim() : undefined;
        const personId = typeof args.personId === 'string' ? args.personId.trim() : undefined;
        const status = typeof args.status === 'string' ? args.status.trim() : undefined;
        const tasks = await listAllExtendedTasks(ctx.facade, { leadId, personId, status });
        data = { count: tasks.length, tasks: tasks.slice(0, 30) };
        summary = `Listed ${tasks.length} CRM task(s).`;
        break;
      }

      case 'list_interactions': {
        const leadId = typeof args.leadId === 'string' ? args.leadId.trim() : undefined;
        const personId = typeof args.personId === 'string' ? args.personId.trim() : undefined;
        const interactions = await listAllCrmInteractions(ctx.facade, { leadId, personId, limit: 25 });
        data = { count: interactions.length, interactions };
        summary = `Listed ${interactions.length} interaction(s).`;
        break;
      }

      case 'search_private_notes': {
        const leadId = typeof args.leadId === 'string' ? args.leadId.trim() : undefined;
        const personId = typeof args.personId === 'string' ? args.personId.trim() : undefined;
        const search = typeof args.search === 'string' ? args.search.trim() : undefined;
        const notes = await listAllCrmPrivateNotes(ctx.facade, { leadId, personId, search });
        data = { count: notes.length, notes: notes.slice(0, 20), ownerAuthorized: true };
        summary = `Searched owner-authorized private notes: ${notes.length} note(s).`;
        break;
      }

      case 'get_enrichment_and_quality': {
        const leadId = String(args.leadId || '').trim();
        if (!leadId) throw new Error('leadId is required for get_enrichment_and_quality.');
        const profile = await buildCompanyRelationshipProfile(ctx.facade, leadId);
        if (!profile) throw new Error('Company lead not found.');
        const dq = evaluateCompanyDataQuality(profile.lead, {
          linkedPersonsCount: profile.decisionMakers.length,
        });
        data = {
          leadId,
          companyName: profile.lead.companyName,
          dataQuality: dq,
          registryVerificationState: profile.enrichmentSummary.registryVerificationState,
          sourcesCount: profile.lead.sources?.length || 0,
        };
        summary = `Evaluated data quality for ${profile.lead.companyName}: ${dq.overallScore}/100 (Grade ${dq.grade}).`;
        break;
      }

      case 'evaluate_icp_match': {
        const leadId = String(args.leadId || '').trim();
        const icpId = typeof args.icpId === 'string' ? args.icpId.trim() : undefined;
        const icps = await listIcpProfiles(ctx.facade);
        const icp = icpId ? icps.find((p) => p.id === icpId) : icps.find((p) => p.isDefault) || icps[0];
        if (!icp) {
          data = { evaluated: false, message: 'No ICP profile configured yet.' };
          summary = 'No ICP profile configured for matching.';
          break;
        }
        const profile = leadId ? await buildCompanyRelationshipProfile(ctx.facade, leadId) : null;
        if (!profile) throw new Error('Company lead not found for ICP evaluation.');
        const result = evaluateCompanyAgainstIcp({
          icp,
          lead: profile.lead,
          decisionMakers: profile.decisionMakers,
        });
        data = result;
        summary = `Evaluated ${profile.lead.companyName} against ICP "${icp.name}": ${result.overallScore}/100 (${result.fitLabel}).`;
        break;
      }

      case 'prioritize_leads': {
        const icpId = typeof args.icpId === 'string' ? args.icpId.trim() : undefined;
        const limit = Math.min(25, Math.max(1, Number(args.limit) || 10));
        const icps = await listIcpProfiles(ctx.facade);
        const icp = icpId ? icps.find((p) => p.id === icpId) : icps.find((p) => p.isDefault) || icps[0];
        const ranked = await prioritizeCrmLeads(ctx.facade, { icp, limit });
        data = { count: ranked.length, icpUsed: icp?.name || null, prioritizedLeads: ranked };
        summary = `Prioritized ${ranked.length} CRM company lead(s).`;
        break;
      }

      case 'get_crm_dashboard': {
        const summaryData = await buildCrmDashboardSummary(ctx.facade);
        data = summaryData;
        summary = `Loaded live CRM dashboard (${summaryData.metrics.totalCompanies} companies, ${summaryData.metrics.activeOpportunities} open opportunities).`;
        break;
      }

      case 'get_reminders': {
        const reminders = await buildReminderCenter(ctx.facade);
        data = reminders;
        summary = `Loaded Reminder Centre (${reminders.counts.overdueTasks} overdue, ${reminders.counts.todayFollowUps} due today).`;
        break;
      }

      case 'inspect_company_website_ssrf_safe': {
        const url = String(args.url || '').trim();
        if (!url) throw new Error('url is required for inspect_company_website_ssrf_safe.');
        const inspection = await inspectWebsite(url);
        data = {
          url: inspection.url || url,
          reachable: inspection.isOnline,
          statusCode: inspection.httpStatus,
          title: inspection.title,
          description: inspection.description,
          emails: inspection.emailsFound,
          phones: inspection.phonesFound,
          socialLinks: inspection.socialLinks,
          securityCheck: inspection.securityCheck,
          error: inspection.securityCheck?.passed === false ? inspection.securityCheck.reason : undefined,
          ssrfProtected: true,
        };
        summary = inspection.isOnline
          ? `Inspected ${url} via SSRF-safe crawler (HTTP ${inspection.httpStatus ?? 'OK'}).`
          : `Website inspection blocked or unreachable (${inspection.securityCheck?.reason || 'unreachable'}).`;
        break;
      }

      case 'propose_crm_action': {
        const actionType = String(args.actionType || '') as AiActionProposalType;
        if (!AI_ACTION_PROPOSAL_TYPE_SET.has(actionType)) {
          throw new Error(`Unsupported CRM action proposal type: "${actionType}".`);
        }
        const title = String(args.title || '').trim().slice(0, 200);
        const rationale = String(args.rationale || '').trim().slice(0, 600);
        if (!title || !rationale) {
          throw new Error('Both title and rationale are required to propose a CRM action.');
        }
        const entityType = (['company', 'person', 'opportunity', 'task', 'draft'].includes(
          String(args.entityType || '')
        )
          ? String(args.entityType)
          : 'company') as AiActionProposal['affectedEntity']['entityType'];
        const proposal: AiActionProposal = {
          id: generateAiId('actprop'),
          actionType,
          title,
          rationale,
          status: 'pending_approval',
          affectedEntity: {
            entityType,
            entityId: typeof args.entityId === 'string' ? args.entityId.trim() : undefined,
            entityName: String(args.entityName || 'CRM Record').trim().slice(0, 140),
          },
          proposedChanges:
            args.proposedChanges && typeof args.proposedChanges === 'object'
              ? (args.proposedChanges as Record<string, unknown>)
              : {},
          evidenceRefIds: Array.isArray(args.evidenceRefIds)
            ? args.evidenceRefIds.map(String).slice(0, 10)
            : [],
          conversationId: ctx.conversationId,
          createdAt: new Date().toISOString(),
        };
        await addAiActionProposals(ctx.facade, [proposal]);
        data = { proposal, requiresOwnerApproval: true };
        summary = `Queued CRM action proposal "${proposal.title}" (pending explicit owner approval).`;
        break;
      }

      default:
        throw new Error(`Unhandled authorized tool: ${toolName}`);
    }

    return {
      record: {
        toolName,
        mode: toolSpec.mode,
        executedAt,
        durationMs: Date.now() - startedAt,
        success: true,
        summary,
      },
      data,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      record: {
        toolName,
        mode: toolSpec.mode,
        executedAt,
        durationMs: Date.now() - startedAt,
        success: false,
        summary: `Tool ${toolName} failed.`,
        error: msg,
      },
      data: null,
    };
  }
}
