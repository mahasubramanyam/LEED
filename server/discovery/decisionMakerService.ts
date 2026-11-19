import crypto from 'node:crypto';
import {
  AttributeProvenanceEntry,
  CanonicalLead,
  CompanyPersonRelationship,
  DecisionMakerCandidate,
  DecisionMakerDiscoveryRequest,
  DecisionMakerDiscoveryResponse,
  DecisionMakerSourceSummary,
  EmploymentStatus,
  PersonRecord,
  PersonVerificationTier,
} from '../types.js';
import {
  classifyDecisionMakerRole,
  DecisionMakerCategory,
} from '../../shared/decisionMakerRoles.js';
import {
  ConnectorError,
  redactSecrets,
} from '../connectors/core/errors.js';
import {
  CredentialManager,
  credentialManager as defaultCredentialManager,
} from '../connectors/core/credentialManager.js';
import {
  ConnectorExecutionEngine,
  connectorExecutionEngine as defaultExecutionEngine,
} from '../connectors/core/executionEngine.js';
import {
  ConnectorRegistry,
  connectorRegistry as defaultRegistry,
} from '../connectors/core/registry.js';
import { executeRegistryJsonRequest } from '../connectors/core/registryHttp.js';
import { ConnectorConfigRecord } from '../connectors/core/types.js';
import { inspectWebsite } from '../connectors/webInspector.js';
import { ApolloPeopleConnector } from '../connectors/adapters/apolloPeopleAdapter.js';
import {
  analyzeDecisionMakerProfileWithAi,
  extractDecisionMakersFromLeadershipEvidence,
  generateDecisionMakerQueriesWithAi,
} from '../gemini.js';
import {
  evaluatePersonIdentityMatches,
} from '../import/dedupeClassifier.js';
import {
  normalizeLinkedInUrl,
  normalizePersonNameTokens,
} from '../import/normalizerValidator.js';
import { DnsLookupAllFn } from '../security/ssrf.js';

export interface DecisionMakerDeps {
  registry?: ConnectorRegistry;
  executionEngine?: ConnectorExecutionEngine;
  credentialManager?: CredentialManager;
  configs?: Record<string, ConnectorConfigRecord>;
  existingPersons?: PersonRecord[];
  existingRelationships?: CompanyPersonRelationship[];
  existingLeads?: CanonicalLead[];
  userAgent?: string;
  fetchFn?: typeof fetch;
  dnsLookupAll?: DnsLookupAllFn;
  inspectWebsiteFn?: typeof inspectWebsite;
  useAiAnalysis?: boolean;
}

interface RawDiscoveredPerson {
  fullName: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  designation?: string;
  department?: string;
  relationshipType?: string;
  decisionMakerCategory?: DecisionMakerCategory;
  seniority?: string;
  decisionMakingFunction?: string;
  email?: string;
  emailStatus?: 'verified' | 'syntax_valid' | 'unverified' | 'unavailable';
  phone?: string;
  linkedinUrl?: string;
  officialBioUrl?: string;
  bioSummary?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  employmentStatus: EmploymentStatus;
  firstObservedAt?: string;
  lastObservedAt?: string;
  endedAt?: string;
  sourceName: string;
  sourceType: AttributeProvenanceEntry['sourceType'];
  sourceUrl?: string;
  connectorId?: string;
  verificationTier: PersonVerificationTier;
  confidenceScore: number;
  isExplicitlyPublished: boolean;
  provenanceNotes: string[];
  attributeProvenance: Record<string, AttributeProvenanceEntry>;
}

function splitNameParts(fullName: string): { firstName?: string; lastName?: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function flipLastFirstName(raw: string): string {
  // Companies House returns "SURNAME, Forename Middle"
  const trimmed = raw.trim();
  if (!trimmed.includes(',')) return trimmed;
  const [surnamePart, givenPart] = trimmed.split(',').map((s) => s.trim());
  if (!surnamePart || !givenPart) return trimmed;
  const toTitle = (s: string) =>
    s
      .toLowerCase()
      .split(/(\s+|-)/)
      .map((tok) => (tok.length > 0 && /[a-z]/i.test(tok[0]) ? tok[0].toUpperCase() + tok.slice(1) : tok))
      .join('');
  return `${toTitle(givenPart)} ${toTitle(surnamePart)}`.replace(/\s+/g, ' ').trim();
}

function isConnectorEnabled(
  connectorId: string,
  registry: ConnectorRegistry,
  configs?: Record<string, ConnectorConfigRecord>
): boolean {
  if (configs?.[connectorId] && typeof configs[connectorId].enabled === 'boolean') {
    return configs[connectorId].enabled;
  }
  return registry.isEnabled(connectorId);
}

function buildAttributeProvenance(
  fields: Record<string, string | undefined>,
  meta: {
    sourceType: AttributeProvenanceEntry['sourceType'];
    sourceName: string;
    sourceUrl?: string;
    connectorId?: string;
    retrievedAt: string;
    method?: string;
  }
): Record<string, AttributeProvenanceEntry> {
  const out: Record<string, AttributeProvenanceEntry> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!value || !value.trim()) continue;
    out[key] = {
      attribute: key,
      value: value.trim().slice(0, 240),
      sourceType: meta.sourceType,
      sourceName: meta.sourceName,
      sourceUrl: meta.sourceUrl,
      retrievedAt: meta.retrievedAt,
      connectorId: meta.connectorId,
      method: meta.method,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source 1: Official Company Website Leadership & Announcements Pages
// ---------------------------------------------------------------------------
async function discoverFromOfficialWebsite(
  req: DecisionMakerDiscoveryRequest,
  deps: DecisionMakerDeps,
  retrievedAt: string
): Promise<{ candidates: RawDiscoveredPerson[]; summary: DecisionMakerSourceSummary }> {
  const targetUrl =
    req.website?.trim() || (req.domain?.trim() ? `https://${req.domain.trim().replace(/^https?:\/\//i, '')}` : '');

  if (!targetUrl) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-web-inspector',
        sourceName: 'Official Company Leadership Pages',
        status: 'skipped_not_applicable',
        candidatesFound: 0,
        message: 'Company website/domain is not specified; official leadership crawl skipped.',
      },
    };
  }

  try {
    const inspectFn = deps.inspectWebsiteFn || inspectWebsite;
    const inspected = await inspectFn(targetUrl, {
      dnsLookupAll: deps.dnsLookupAll,
      fetchFn: deps.fetchFn,
      userAgent: deps.userAgent,
      maxPages: 6,
      checkRobots: true,
    });

    if (!inspected.securityCheck.passed) {
      return {
        candidates: [],
        summary: {
          sourceId: 'conn-web-inspector',
          sourceName: 'Official Company Leadership Pages',
          status: 'error',
          candidatesFound: 0,
          message: inspected.securityCheck.reason || 'Website blocked by SSRF safety policy.',
        },
      };
    }

    if (!inspected.isOnline) {
      return {
        candidates: [],
        summary: {
          sourceId: 'conn-web-inspector',
          sourceName: 'Official Company Leadership Pages',
          status: 'no_results',
          candidatesFound: 0,
          message: inspected.securityCheck.reason || 'Company website was unreachable during inspection.',
        },
      };
    }

    const candidates: RawDiscoveredPerson[] = [];
    const seen = new Set<string>();

    for (const m of inspected.leadershipFound || []) {
      const normName = normalizePersonNameTokens(m.fullName);
      if (!normName) continue;
      const role = classifyDecisionMakerRole({ rawJobTitle: m.jobTitle });
      const liCheck = normalizeLinkedInUrl(m.linkedinUrl, 'person');
      const key = `${normName}::${role.relationshipType}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        fullName: m.fullName,
        ...splitNameParts(m.fullName),
        jobTitle: m.jobTitle || role.label,
        department: role.department,
        relationshipType: role.relationshipType,
        decisionMakerCategory: role.category,
        seniority: role.seniority,
        decisionMakingFunction: role.functionArea,
        linkedinUrl: liCheck.url,
        officialBioUrl: m.officialBioUrl,
        bioSummary: m.bioSnippet,
        countryCode: req.countryCode,
        employmentStatus: 'current',
        firstObservedAt: retrievedAt,
        lastObservedAt: retrievedAt,
        sourceName: 'Official Company Website',
        sourceType: 'official_website',
        sourceUrl: m.officialBioUrl,
        connectorId: 'conn-web-inspector',
        verificationTier: 'company_website',
        confidenceScore: m.method === 'json_ld_person' ? 84 : 78,
        isExplicitlyPublished: true,
        provenanceNotes: [
          `Explicitly published on official company website (${m.method === 'json_ld_person' ? 'Schema.org Person JSON-LD' : 'Leadership/Team HTML block'}).`,
        ],
        attributeProvenance: buildAttributeProvenance(
          {
            fullName: m.fullName,
            jobTitle: m.jobTitle,
            officialBioUrl: m.officialBioUrl,
            linkedinUrl: liCheck.url,
          },
          {
            sourceType: 'official_website',
            sourceName: 'Official Company Website',
            sourceUrl: m.officialBioUrl,
            connectorId: 'conn-web-inspector',
            retrievedAt,
            method: m.method,
          }
        ),
      });
    }

    // Optional grounded AI extraction on leadership/about/announcements excerpts
    if (deps.useAiAnalysis !== false && (inspected.pageExcerpts || []).length > 0) {
      const aiRes = await extractDecisionMakersFromLeadershipEvidence({
        companyName: req.companyName,
        pageExcerpts: inspected.pageExcerpts!,
      });
      for (const item of aiRes.extracted) {
        const normName = normalizePersonNameTokens(item.fullName);
        if (!normName) continue;
        const role = classifyDecisionMakerRole({ rawJobTitle: item.jobTitle });
        const key = `${normName}::${role.relationshipType}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({
          fullName: item.fullName,
          ...splitNameParts(item.fullName),
          jobTitle: item.jobTitle,
          department: role.department,
          relationshipType: role.relationshipType,
          decisionMakerCategory: role.category,
          seniority: role.seniority,
          decisionMakingFunction: role.functionArea,
          officialBioUrl: item.officialBioUrl || inspected.url,
          bioSummary: item.bioSummary,
          countryCode: req.countryCode,
          employmentStatus: 'current',
          firstObservedAt: retrievedAt,
          lastObservedAt: retrievedAt,
          sourceName: 'Official Company Website (AI Grounded Extraction)',
          sourceType: 'ai_extracted',
          sourceUrl: item.officialBioUrl || inspected.url,
          connectorId: 'conn-web-inspector',
          verificationTier: 'company_website',
          confidenceScore: 72,
          isExplicitlyPublished: true,
          provenanceNotes: [
            `Grounded extraction via ${aiRes.engine} from crawled official website page.`,
          ],
          attributeProvenance: buildAttributeProvenance(
            {
              fullName: item.fullName,
              jobTitle: item.jobTitle,
              officialBioUrl: item.officialBioUrl,
            },
            {
              sourceType: 'ai_extracted',
              sourceName: 'Official Company Website (AI Grounded Extraction)',
              sourceUrl: item.officialBioUrl,
              connectorId: 'conn-web-inspector',
              retrievedAt,
              method: aiRes.engine,
            }
          ),
        });
      }
    }

    return {
      candidates,
      summary: {
        sourceId: 'conn-web-inspector',
        sourceName: 'Official Company Leadership Pages',
        status: candidates.length > 0 ? 'success' : 'no_results',
        candidatesFound: candidates.length,
        message:
          candidates.length > 0
            ? `Extracted ${candidates.length} published leader(s) from ${inspected.pagesVisited?.length || 1} page(s).`
            : `Inspected ${inspected.pagesVisited?.length || 1} public website page(s); no named leadership bios detected.`,
      },
    };
  } catch (err: unknown) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-web-inspector',
        sourceName: 'Official Company Leadership Pages',
        status: 'error',
        candidatesFound: 0,
        message: err instanceof Error ? err.message : 'Official website leadership crawl failed.',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Source 2: Norway Brreg Roller (Official Officers & Board Registry)
// ---------------------------------------------------------------------------
async function discoverFromBrregRoller(
  req: DecisionMakerDiscoveryRequest,
  deps: DecisionMakerDeps,
  retrievedAt: string
): Promise<{ candidates: RawDiscoveredPerson[]; summary: DecisionMakerSourceSummary }> {
  const cc = (req.countryCode || '').toUpperCase();
  const cleanOrg = (req.registrationNumber || '').replace(/\s+/g, '');
  if (cc !== 'NO' || !/^\d{9}$/.test(cleanOrg)) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-brreg',
        sourceName: 'Norway Brreg Roller Registry',
        status: 'skipped_not_applicable',
        candidatesFound: 0,
        message: 'Applies to Norwegian entities with a 9-digit Brreg organization number.',
      },
    };
  }

  try {
    const url = `https://data.brreg.no/enhetsregisteret/api/enheter/${encodeURIComponent(cleanOrg)}/roller`;
    const res = await executeRegistryJsonRequest<{
      rollegrupper?: Array<{
        type?: { kode?: string; beskrivelse?: string };
        roller?: Array<{
          type?: { kode?: string; beskrivelse?: string };
          person?: {
            navn?: { fornavn?: string; mellomnavn?: string; etternavn?: string };
            fodselsdato?: string;
          };
          fratraadt?: boolean;
          rekkefolge?: number;
        }>;
      }>;
    }>({
      providerId: 'conn-brreg',
      url,
      userAgent: deps.userAgent || 'GlobalLeadEngine/11.0',
      timeoutMs: 8000,
      allowNotFound: true,
      fetchFn: deps.fetchFn,
      dnsLookupAll: deps.dnsLookupAll,
    });

    if (res.notFound || !Array.isArray(res.data?.rollegrupper)) {
      return {
        candidates: [],
        summary: {
          sourceId: 'conn-brreg',
          sourceName: 'Norway Brreg Roller Registry',
          status: 'no_results',
          candidatesFound: 0,
          message: `No officer roles listed in Brreg Roller for OrgNr ${cleanOrg}.`,
        },
      };
    }

    const candidates: RawDiscoveredPerson[] = [];
    const registryUrl = `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${cleanOrg}`;

    for (const grp of res.data.rollegrupper) {
      for (const roleItem of grp.roller || []) {
        const pName = roleItem.person?.navn;
        if (!pName) continue; // Skip corporate entity board members (enhet) without person name
        const fullName = [pName.fornavn, pName.mellomnavn, pName.etternavn].filter(Boolean).join(' ').trim();
        if (!fullName) continue;

        const rawRoleDesc = roleItem.type?.beskrivelse || grp.type?.beskrivelse || 'Officer';
        const roleCode = roleItem.type?.kode || grp.type?.kode || '';
        const role = classifyDecisionMakerRole({
          rawRelationshipType:
            roleCode === 'DAGL'
              ? 'executive'
              : roleCode === 'LEDE' || roleCode === 'MEDL' || roleCode === 'VARA'
              ? 'director'
              : undefined,
          rawJobTitle: rawRoleDesc,
        });
        const isResigned = Boolean(roleItem.fratraadt);

        candidates.push({
          fullName,
          firstName: pName.fornavn,
          lastName: pName.etternavn,
          jobTitle: rawRoleDesc,
          designation: roleCode || undefined,
          department: role.department,
          relationshipType: role.relationshipType,
          decisionMakerCategory: role.category,
          seniority: role.seniority,
          decisionMakingFunction: role.functionArea,
          country: 'Norway',
          countryCode: 'NO',
          employmentStatus: isResigned ? 'historical' : 'current',
          firstObservedAt: retrievedAt,
          lastObservedAt: retrievedAt,
          sourceName: 'Brreg Roller (Official Norwegian Registry)',
          sourceType: 'official_registry',
          sourceUrl: registryUrl,
          connectorId: 'conn-brreg',
          verificationTier: 'officially_verified',
          confidenceScore: isResigned ? 86 : 94,
          isExplicitlyPublished: true,
          provenanceNotes: [
            `Official Norwegian Central Coordinating Register (Brreg Roller ${cleanOrg})${isResigned ? ' — Marked fratrådt (resigned/historical)' : ''}.`,
          ],
          attributeProvenance: buildAttributeProvenance(
            {
              fullName,
              jobTitle: rawRoleDesc,
              designation: roleCode,
              employmentStatus: isResigned ? 'historical' : 'current',
            },
            {
              sourceType: 'official_registry',
              sourceName: 'Brreg Roller (Official Norwegian Registry)',
              sourceUrl: registryUrl,
              connectorId: 'conn-brreg',
              retrievedAt,
              method: 'brreg_roller_api',
            }
          ),
        });
      }
    }

    return {
      candidates,
      summary: {
        sourceId: 'conn-brreg',
        sourceName: 'Norway Brreg Roller Registry',
        status: candidates.length > 0 ? 'success' : 'no_results',
        candidatesFound: candidates.length,
        message: `Retrieved ${candidates.length} registered officer/board record(s) from Brreg Roller.`,
      },
    };
  } catch (err: unknown) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-brreg',
        sourceName: 'Norway Brreg Roller Registry',
        status: 'error',
        candidatesFound: 0,
        message: err instanceof Error ? err.message : 'Brreg Roller lookup failed.',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Source 3: UK Companies House Officers API
// ---------------------------------------------------------------------------
async function discoverFromCompaniesHouseOfficers(
  req: DecisionMakerDiscoveryRequest,
  deps: DecisionMakerDeps,
  credMgr: CredentialManager,
  registry: ConnectorRegistry,
  retrievedAt: string
): Promise<{ candidates: RawDiscoveredPerson[]; summary: DecisionMakerSourceSummary }> {
  const cc = (req.countryCode || '').toUpperCase();
  const crn = (req.registrationNumber || '').replace(/\s+/g, '').toUpperCase();
  if (cc !== 'GB' || !/^([A-Z]{2}[0-9]{6}|[0-9]{8})$/.test(crn)) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-companies-house',
        sourceName: 'UK Companies House Officers API',
        status: 'skipped_not_applicable',
        candidatesFound: 0,
        message: 'Applies to UK entities with an 8-character Companies House registration number (CRN).',
      },
    };
  }

  const conn = registry.getById('conn-companies-house');
  if (!conn) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-companies-house',
        sourceName: 'UK Companies House Officers API',
        status: 'skipped_not_applicable',
        candidatesFound: 0,
        message: 'Companies House connector not registered.',
      },
    };
  }

  const creds = await credMgr.resolveCredentialForExecution('conn-companies-house', conn.getMetadata().credentialRequirements);
  const apiKey = (creds.credentials.apiKey || '').trim();
  if (!apiKey) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-companies-house',
        sourceName: 'UK Companies House Officers API',
        status: 'skipped_missing_credentials',
        candidatesFound: 0,
        message: 'UK Companies House API key not configured in Credential Vault; live officer lookup skipped.',
      },
    };
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
    const url = `https://api.company-information.service.gov.uk/company/${encodeURIComponent(crn)}/officers?items_per_page=35`;
    const res = await executeRegistryJsonRequest<{
      items?: Array<{
        name?: string;
        officer_role?: string;
        occupation?: string;
        appointed_on?: string;
        resigned_on?: string;
        country_of_residence?: string;
        links?: { officer?: { appointments?: string } };
      }>;
    }>({
      providerId: 'conn-companies-house',
      url,
      headers: { Authorization: authHeader },
      userAgent: deps.userAgent || 'GlobalLeadEngine/11.0',
      timeoutMs: 8000,
      knownSecrets: [apiKey],
      allowNotFound: true,
      fetchFn: deps.fetchFn,
      dnsLookupAll: deps.dnsLookupAll,
    });

    if (res.notFound || !Array.isArray(res.data?.items)) {
      return {
        candidates: [],
        summary: {
          sourceId: 'conn-companies-house',
          sourceName: 'UK Companies House Officers API',
          status: 'no_results',
          candidatesFound: 0,
          message: `No officer appointments returned for UK CRN ${crn}.`,
        },
      };
    }

    const chUrl = `https://find-and-update.company-information.service.gov.uk/company/${crn}/officers`;
    const candidates: RawDiscoveredPerson[] = [];

    for (const item of res.data.items) {
      if (!item.name) continue;
      // Skip corporate officers if clearly marked corporate-director / corporate-secretary
      if (item.officer_role?.startsWith('corporate-')) continue;
      const fullName = flipLastFirstName(item.name);
      const roleLabel = item.occupation?.trim() || item.officer_role?.replace(/-/g, ' ') || 'Director';
      const role = classifyDecisionMakerRole({
        rawRelationshipType: item.officer_role?.includes('director') ? 'director' : 'officer',
        rawJobTitle: roleLabel,
      });
      const isResigned = Boolean(item.resigned_on);

      candidates.push({
        fullName,
        ...splitNameParts(fullName),
        jobTitle: roleLabel,
        designation: item.officer_role,
        department: role.department,
        relationshipType: role.relationshipType,
        decisionMakerCategory: role.category,
        seniority: role.seniority,
        decisionMakingFunction: role.functionArea,
        country: item.country_of_residence || 'United Kingdom',
        countryCode: 'GB',
        employmentStatus: isResigned ? 'historical' : 'current',
        firstObservedAt: item.appointed_on || retrievedAt,
        lastObservedAt: retrievedAt,
        endedAt: item.resigned_on,
        sourceName: 'UK Companies House Officers API',
        sourceType: 'official_registry',
        sourceUrl: chUrl,
        connectorId: 'conn-companies-house',
        verificationTier: 'officially_verified',
        confidenceScore: isResigned ? 86 : 94,
        isExplicitlyPublished: true,
        provenanceNotes: [
          `Official Crown filing (${crn}): role "${item.officer_role || 'officer'}"${item.appointed_on ? `, appointed ${item.appointed_on}` : ''}${item.resigned_on ? `, resigned ${item.resigned_on}` : ''}.`,
        ],
        attributeProvenance: buildAttributeProvenance(
          {
            fullName,
            jobTitle: roleLabel,
            employmentStatus: isResigned ? `historical (resigned ${item.resigned_on})` : 'current',
          },
          {
            sourceType: 'official_registry',
            sourceName: 'UK Companies House Officers API',
            sourceUrl: chUrl,
            connectorId: 'conn-companies-house',
            retrievedAt,
            method: 'companies_house_officers_api',
          }
        ),
      });
    }

    return {
      candidates,
      summary: {
        sourceId: 'conn-companies-house',
        sourceName: 'UK Companies House Officers API',
        status: candidates.length > 0 ? 'success' : 'no_results',
        candidatesFound: candidates.length,
        message: `Retrieved ${candidates.length} statutory officer filing(s) for UK CRN ${crn}.`,
      },
    };
  } catch (err: unknown) {
    const safeMsg = redactSecrets(err instanceof Error ? err.message : String(err), [apiKey]);
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-companies-house',
        sourceName: 'UK Companies House Officers API',
        status: 'error',
        candidatesFound: 0,
        message: safeMsg,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Source 4: Wikidata Key Corporate People (P112 Founder, P169 CEO, P488 Chair, P3320 Board)
// ---------------------------------------------------------------------------
async function discoverFromWikidataPeople(
  req: DecisionMakerDiscoveryRequest,
  deps: DecisionMakerDeps,
  retrievedAt: string
): Promise<{ candidates: RawDiscoveredPerson[]; summary: DecisionMakerSourceSummary }> {
  try {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      req.companyName
    )}&language=en&type=item&limit=3&format=json`;
    const sRes = await executeRegistryJsonRequest<{
      search?: Array<{ id: string; label?: string; description?: string }>;
    }>({
      providerId: 'conn-wikidata',
      url: searchUrl,
      userAgent: deps.userAgent || 'GlobalLeadEngine/11.0',
      timeoutMs: 8000,
      fetchFn: deps.fetchFn,
      dnsLookupAll: deps.dnsLookupAll,
    });

    const firstHit = (sRes.data?.search || []).find((h) => {
      const desc = (h.description || '').toLowerCase();
      return !/\b(album|song|film|novel|human|actor|footballer)\b/.test(desc);
    });
    if (!firstHit?.id) {
      return {
        candidates: [],
        summary: {
          sourceId: 'conn-wikidata',
          sourceName: 'Wikidata Corporate Leadership (CC0)',
          status: 'no_results',
          candidatesFound: 0,
          message: `No matching organization entity found on Wikidata for "${req.companyName}".`,
        },
      };
    }

    const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
      firstHit.id
    )}&props=labels|claims&languages=en&format=json`;
    const eRes = await executeRegistryJsonRequest<{ entities?: Record<string, any> }>({
      providerId: 'conn-wikidata',
      url: entUrl,
      userAgent: deps.userAgent || 'GlobalLeadEngine/11.0',
      timeoutMs: 8000,
      fetchFn: deps.fetchFn,
      dnsLookupAll: deps.dnsLookupAll,
    });

    const orgEnt = eRes.data?.entities?.[firstHit.id];
    const claims = orgEnt?.claims || {};
    const ROLE_PROPS: Array<{ prop: string; title: string; relType: string }> = [
      { prop: 'P112', title: 'Founder', relType: 'founder' },
      { prop: 'P169', title: 'Chief Executive Officer', relType: 'executive' },
      { prop: 'P488', title: 'Chairperson', relType: 'director' },
      { prop: 'P3320', title: 'Board Member', relType: 'director' },
    ];

    const personClaims: Array<{
      qid: string;
      title: string;
      relType: string;
      startTime?: string;
      endTime?: string;
    }> = [];
    for (const rp of ROLE_PROPS) {
      const list = Array.isArray(claims[rp.prop]) ? claims[rp.prop] : [];
      for (const c of list) {
        const qid = c?.mainsnak?.datavalue?.value?.id;
        if (typeof qid !== 'string' || !/^Q\d+$/.test(qid)) continue;
        const startRaw = c?.qualifiers?.P580?.[0]?.datavalue?.value?.time;
        const endRaw = c?.qualifiers?.P582?.[0]?.datavalue?.value?.time;
        const parseDate = (raw?: string) =>
          typeof raw === 'string' ? raw.replace(/^[+-]/, '').slice(0, 10) : undefined;
        personClaims.push({
          qid,
          title: rp.title,
          relType: rp.relType,
          startTime: parseDate(startRaw),
          endTime: parseDate(endRaw),
        });
      }
    }

    const uniquePersonQids = Array.from(new Set(personClaims.map((p) => p.qid))).slice(0, 25);
    if (uniquePersonQids.length === 0) {
      return {
        candidates: [],
        summary: {
          sourceId: 'conn-wikidata',
          sourceName: 'Wikidata Corporate Leadership (CC0)',
          status: 'no_results',
          candidatesFound: 0,
          message: `Wikidata entity ${firstHit.id} has no structured leadership claims (P112/P169/P488/P3320).`,
        },
      };
    }

    const pUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
      uniquePersonQids.join('|')
    )}&props=labels|descriptions&languages=en&format=json`;
    const pRes = await executeRegistryJsonRequest<{ entities?: Record<string, any> }>({
      providerId: 'conn-wikidata',
      url: pUrl,
      userAgent: deps.userAgent || 'GlobalLeadEngine/11.0',
      timeoutMs: 8000,
      fetchFn: deps.fetchFn,
      dnsLookupAll: deps.dnsLookupAll,
    });

    const pEntities = pRes.data?.entities || {};
    const orgSourceUrl = `https://www.wikidata.org/wiki/${encodeURIComponent(firstHit.id)}`;
    const candidates: RawDiscoveredPerson[] = [];

    for (const pc of personClaims) {
      const pEnt = pEntities[pc.qid];
      const fullName = pEnt?.labels?.en?.value;
      if (!fullName) continue;
      const role = classifyDecisionMakerRole({ rawRelationshipType: pc.relType, rawJobTitle: pc.title });
      const isHistorical = Boolean(pc.endTime);

      candidates.push({
        fullName,
        ...splitNameParts(fullName),
        jobTitle: pc.title,
        department: role.department,
        relationshipType: role.relationshipType,
        decisionMakerCategory: role.category,
        seniority: role.seniority,
        decisionMakingFunction: role.functionArea,
        officialBioUrl: `https://www.wikidata.org/wiki/${encodeURIComponent(pc.qid)}`,
        bioSummary: pEnt?.descriptions?.en?.value,
        countryCode: req.countryCode,
        employmentStatus: isHistorical ? 'historical' : 'current',
        firstObservedAt: pc.startTime || retrievedAt,
        lastObservedAt: retrievedAt,
        endedAt: pc.endTime,
        sourceName: 'Wikidata Knowledge Graph (CC0)',
        sourceType: 'business_directory',
        sourceUrl: orgSourceUrl,
        connectorId: 'conn-wikidata',
        verificationTier: 'directory_listed',
        confidenceScore: isHistorical ? 66 : 74,
        isExplicitlyPublished: true,
        provenanceNotes: [
          `Wikidata corporate relationship on ${firstHit.id} (${pc.title})${pc.endTime ? ` — historical (ended ${pc.endTime})` : ''}.`,
        ],
        attributeProvenance: buildAttributeProvenance(
          {
            fullName,
            jobTitle: pc.title,
            officialBioUrl: `https://www.wikidata.org/wiki/${encodeURIComponent(pc.qid)}`,
          },
          {
            sourceType: 'business_directory',
            sourceName: 'Wikidata Knowledge Graph (CC0)',
            sourceUrl: orgSourceUrl,
            connectorId: 'conn-wikidata',
            retrievedAt,
            method: 'wikidata_claims',
          }
        ),
      });
    }

    return {
      candidates,
      summary: {
        sourceId: 'conn-wikidata',
        sourceName: 'Wikidata Corporate Leadership (CC0)',
        status: candidates.length > 0 ? 'success' : 'no_results',
        candidatesFound: candidates.length,
        message: `Resolved ${candidates.length} leadership/founder claim(s) from Wikidata entity ${firstHit.id}.`,
      },
    };
  } catch (err: unknown) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-wikidata',
        sourceName: 'Wikidata Corporate Leadership (CC0)',
        status: 'error',
        candidatesFound: 0,
        message: err instanceof Error ? err.message : 'Wikidata leadership query failed.',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Source 5: OpenCorporates Officers API v0.4 (Credential-dependent)
// ---------------------------------------------------------------------------
async function discoverFromOpenCorporatesOfficers(
  req: DecisionMakerDiscoveryRequest,
  deps: DecisionMakerDeps,
  credMgr: CredentialManager,
  registry: ConnectorRegistry,
  retrievedAt: string
): Promise<{ candidates: RawDiscoveredPerson[]; summary: DecisionMakerSourceSummary }> {
  const cc = (req.countryCode || '').trim().toLowerCase();
  const regNum = (req.registrationNumber || '').trim();
  if (!cc || cc === 'global' || !regNum) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-opencorporates',
        sourceName: 'OpenCorporates Officers API v0.4',
        status: 'skipped_not_applicable',
        candidatesFound: 0,
        message: 'Requires country jurisdiction code and registration number.',
      },
    };
  }

  const conn = registry.getById('conn-opencorporates');
  if (!conn) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-opencorporates',
        sourceName: 'OpenCorporates Officers API v0.4',
        status: 'skipped_not_applicable',
        candidatesFound: 0,
        message: 'OpenCorporates connector not registered.',
      },
    };
  }

  const creds = await credMgr.resolveCredentialForExecution('conn-opencorporates', conn.getMetadata().credentialRequirements);
  const token = (creds.credentials.apiToken || creds.credentials.apiKey || '').trim();
  if (!token) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-opencorporates',
        sourceName: 'OpenCorporates Officers API v0.4',
        status: 'skipped_missing_credentials',
        candidatesFound: 0,
        message: 'OpenCorporates API token not configured in Credential Vault; officer lookup skipped.',
      },
    };
  }

  try {
    const url = `https://api.opencorporates.com/v0.4/companies/${encodeURIComponent(cc)}/${encodeURIComponent(
      regNum
    )}/officers?api_token=${encodeURIComponent(token)}`;
    const res = await executeRegistryJsonRequest<{
      results?: {
        officers?: Array<{
          officer?: {
            name?: string;
            position?: string;
            start_date?: string | null;
            end_date?: string | null;
            opencorporates_url?: string;
          };
        }>;
      };
    }>({
      providerId: 'conn-opencorporates',
      url,
      userAgent: deps.userAgent || 'GlobalLeadEngine/11.0',
      timeoutMs: 9000,
      knownSecrets: [token],
      allowNotFound: true,
      fetchFn: deps.fetchFn,
      dnsLookupAll: deps.dnsLookupAll,
    });

    const rawOfficers = res.data?.results?.officers || [];
    const candidates: RawDiscoveredPerson[] = [];
    for (const entry of rawOfficers) {
      const off = entry.officer;
      if (!off?.name) continue;
      const role = classifyDecisionMakerRole({ rawJobTitle: off.position || 'Officer' });
      const isHistorical = Boolean(off.end_date);
      candidates.push({
        fullName: off.name.trim(),
        ...splitNameParts(off.name),
        jobTitle: off.position?.trim() || 'Corporate Officer',
        department: role.department,
        relationshipType: role.relationshipType,
        decisionMakerCategory: role.category,
        seniority: role.seniority,
        decisionMakingFunction: role.functionArea,
        countryCode: cc.toUpperCase(),
        employmentStatus: isHistorical ? 'historical' : 'current',
        firstObservedAt: off.start_date || retrievedAt,
        lastObservedAt: retrievedAt,
        endedAt: off.end_date || undefined,
        sourceName: 'OpenCorporates Officers API v0.4',
        sourceType: 'business_directory',
        sourceUrl: off.opencorporates_url,
        connectorId: 'conn-opencorporates',
        verificationTier: 'directory_listed',
        confidenceScore: isHistorical ? 70 : 78,
        isExplicitlyPublished: true,
        provenanceNotes: [
          `OpenCorporates officer filing (${cc}/${regNum})${off.end_date ? ` — ended ${off.end_date}` : ''}.`,
        ],
        attributeProvenance: buildAttributeProvenance(
          {
            fullName: off.name.trim(),
            jobTitle: off.position?.trim(),
          },
          {
            sourceType: 'business_directory',
            sourceName: 'OpenCorporates Officers API v0.4',
            sourceUrl: off.opencorporates_url,
            connectorId: 'conn-opencorporates',
            retrievedAt,
            method: 'opencorporates_officers_v0_4',
          }
        ),
      });
    }

    return {
      candidates,
      summary: {
        sourceId: 'conn-opencorporates',
        sourceName: 'OpenCorporates Officers API v0.4',
        status: candidates.length > 0 ? 'success' : 'no_results',
        candidatesFound: candidates.length,
        message: `Retrieved ${candidates.length} officer record(s) from OpenCorporates v0.4.`,
      },
    };
  } catch (err: unknown) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-opencorporates',
        sourceName: 'OpenCorporates Officers API v0.4',
        status: 'error',
        candidatesFound: 0,
        message: redactSecrets(err instanceof Error ? err.message : String(err), [token]),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Source 6: Apollo.io Authorized B2B People API (Credential-dependent)
// ---------------------------------------------------------------------------
async function discoverFromApolloPeople(
  req: DecisionMakerDiscoveryRequest,
  deps: DecisionMakerDeps,
  credMgr: CredentialManager,
  registry: ConnectorRegistry,
  retrievedAt: string
): Promise<{ candidates: RawDiscoveredPerson[]; summary: DecisionMakerSourceSummary }> {
  const conn = registry.getById('conn-apollo') as ApolloPeopleConnector | undefined;
  if (!conn) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-apollo',
        sourceName: 'Apollo.io B2B People API',
        status: 'skipped_not_applicable',
        candidatesFound: 0,
        message: 'Apollo People connector not registered.',
      },
    };
  }

  const creds = await credMgr.resolveCredentialForExecution('conn-apollo', conn.getMetadata().credentialRequirements);
  const apiKey = (creds.credentials.apiKey || '').trim();
  if (!apiKey) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-apollo',
        sourceName: 'Apollo.io B2B People API',
        status: 'skipped_missing_credentials',
        candidatesFound: 0,
        message: 'Apollo.io API key not configured in Credential Vault; B2B people search skipped.',
      },
    };
  }

  try {
    const controller = new AbortController();
    const apolloClient =
      deps.fetchFn || deps.dnsLookupAll ? new ApolloPeopleConnector(deps.fetchFn, deps.dnsLookupAll) : conn;
    const response = await apolloClient.searchPeopleForCompany(
      {
        companyName: req.companyName,
        domain: req.domain,
        countryCode: req.countryCode,
        personTitles: req.targetJobTitle ? [req.targetJobTitle] : undefined,
        personSeniorities: req.targetSeniority ? [req.targetSeniority] : undefined,
        perPage: 15,
      },
      {
        requestId: `dm-${crypto.randomBytes(4).toString('hex')}`,
        signal: controller.signal,
        credentials: creds.credentials,
        credentialSource: creds.source,
        config: { connectorId: 'conn-apollo', enabled: true },
        userAgent: deps.userAgent || 'GlobalLeadEngine/11.0',
        timeoutMs: 10000,
      }
    );

    const candidates: RawDiscoveredPerson[] = [];
    for (const p of response.people) {
      const fullName =
        p.name?.trim() || [p.first_name?.trim(), p.last_name?.trim()].filter(Boolean).join(' ').trim();
      if (!fullName) continue;
      const role = classifyDecisionMakerRole({
        rawJobTitle: p.title || p.headline,
        rawDepartment: p.departments?.[0],
      });
      const liCheck = normalizeLinkedInUrl(p.linkedin_url, 'person');
      const currentHist = p.employment_history?.find(
        (h) =>
          h.organization_name &&
          h.organization_name.toLowerCase().includes(req.companyName.toLowerCase().slice(0, 6))
      );
      const isHistorical = currentHist ? currentHist.current === false || Boolean(currentHist.end_date) : false;

      candidates.push({
        fullName,
        firstName: p.first_name || splitNameParts(fullName).firstName,
        lastName: p.last_name || splitNameParts(fullName).lastName,
        jobTitle: p.title || p.headline || role.label,
        department: p.departments?.[0] || role.department,
        relationshipType: role.relationshipType,
        decisionMakerCategory: role.category,
        seniority: p.seniority || role.seniority,
        decisionMakingFunction: p.functions?.[0] || role.functionArea,
        email: p.email && !p.email.includes('email_not_unlocked') ? p.email : undefined,
        emailStatus:
          p.email && !p.email.includes('email_not_unlocked')
            ? p.email_status === 'verified'
              ? 'verified'
              : 'syntax_valid'
            : 'unavailable',
        linkedinUrl: liCheck.url,
        city: p.city,
        country: p.country,
        countryCode: req.countryCode,
        employmentStatus: isHistorical ? 'historical' : 'current',
        firstObservedAt: currentHist?.start_date || retrievedAt,
        lastObservedAt: retrievedAt,
        endedAt: currentHist?.end_date || undefined,
        sourceName: 'Apollo.io B2B People API',
        sourceType: 'authorized_provider',
        sourceUrl: liCheck.url || 'https://www.apollo.io',
        connectorId: 'conn-apollo',
        verificationTier: 'authorized_provider',
        confidenceScore: isHistorical ? 68 : 79,
        isExplicitlyPublished: true,
        provenanceNotes: ['Retrieved via authorized Apollo.io B2B People API.'],
        attributeProvenance: buildAttributeProvenance(
          {
            fullName,
            jobTitle: p.title,
            linkedinUrl: liCheck.url,
            email: p.email && !p.email.includes('email_not_unlocked') ? p.email : undefined,
          },
          {
            sourceType: 'authorized_provider',
            sourceName: 'Apollo.io B2B People API',
            sourceUrl: liCheck.url || 'https://www.apollo.io',
            connectorId: 'conn-apollo',
            retrievedAt,
            method: 'apollo_mixed_people_search',
          }
        ),
      });
    }

    return {
      candidates,
      summary: {
        sourceId: 'conn-apollo',
        sourceName: 'Apollo.io B2B People API',
        status: candidates.length > 0 ? 'success' : 'no_results',
        candidatesFound: candidates.length,
        message: `Retrieved ${candidates.length} authorized B2B contact(s) from Apollo.io.`,
      },
    };
  } catch (err: unknown) {
    const safeMsg =
      err instanceof ConnectorError
        ? redactSecrets(err.message, [apiKey])
        : redactSecrets(err instanceof Error ? err.message : String(err), [apiKey]);
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-apollo',
        sourceName: 'Apollo.io B2B People API',
        status: 'error',
        candidatesFound: 0,
        message: safeMsg,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Source 7: Brave Search / Google CSE Public Announcements (Strict search_result tier <= 48)
// ---------------------------------------------------------------------------
function extractPersonTitleMentionsFromSnippet(text: string): Array<{ fullName: string; jobTitle: string }> {
  const results: Array<{ fullName: string; jobTitle: string }> = [];
  const patterns = [
    /\b([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2})\s*(?:,|—|–|-|serves as|is)\s+(Chief\s+[A-Za-z\s]{3,35}Officer|CEO|CFO|COO|CTO|Founder|Co-Founder|Managing Director|Procurement (?:Manager|Director)|Head of Procurement|Sales Director|VP of [A-Za-z\s]{2,25}|President)\b/g,
    /\bappointed\s+([A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2})\s+as\s+(Chief\s+[A-Za-z\s]{3,35}Officer|CEO|CFO|COO|Managing Director|Director of [A-Za-z\s]{2,25}|Head of [A-Za-z\s]{2,25})\b/gi,
  ];

  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1]?.trim();
      const title = m[2]?.trim();
      if (name && title && name.split(/\s+/).length >= 2) {
        results.push({ fullName: name, jobTitle: title });
      }
    }
  }
  return results;
}

async function discoverFromSearchAnnouncements(
  req: DecisionMakerDiscoveryRequest,
  engine: ConnectorExecutionEngine,
  registry: ConnectorRegistry,
  configs: Record<string, ConnectorConfigRecord> | undefined,
  retrievedAt: string
): Promise<{ candidates: RawDiscoveredPerson[]; summary: DecisionMakerSourceSummary }> {
  const activeSearchId = ['conn-brave-search', 'conn-google-cse'].find((id) =>
    isConnectorEnabled(id, registry, configs)
  );
  if (!activeSearchId) {
    return {
      candidates: [],
      summary: {
        sourceId: 'conn-brave-search',
        sourceName: 'Public Announcements & Web Search',
        status: 'skipped_missing_credentials',
        candidatesFound: 0,
        message: 'No authorized web search provider (Brave Search / Google CSE) enabled.',
      },
    };
  }

  const connector = registry.getById(activeSearchId);
  if (!connector) {
    return {
      candidates: [],
      summary: {
        sourceId: activeSearchId,
        sourceName: 'Public Announcements & Web Search',
        status: 'skipped_missing_credentials',
        candidatesFound: 0,
        message: 'Configured web search provider is not registered.',
      },
    };
  }

  const query = req.targetJobTitle
    ? `"${req.companyName}" "${req.targetJobTitle}"`
    : `"${req.companyName}" (CEO OR "Managing Director" OR Founder OR Procurement OR "Sales Director")`;

  let results: Array<{
    providerName: string;
    sourceUrl?: string;
    company: { webMetadata?: { description?: string; title?: string } };
  }> = [];
  try {
    const execOutcome = await engine.executeSearch(
      connector,
      {
        query,
        countryCode: req.countryCode,
        page: 1,
        pageSize: 8,
      },
      { config: configs?.[activeSearchId] }
    );
    results = execOutcome.response.results;
  } catch (err: any) {
    const isMissingCreds = err?.category === 'missing_credentials';
    return {
      candidates: [],
      summary: {
        sourceId: activeSearchId,
        sourceName: 'Public Announcements & Web Search',
        status: isMissingCreds ? 'skipped_missing_credentials' : 'error',
        candidatesFound: 0,
        message:
          err?.message ||
          'Web search provider credentials not configured; announcement search skipped.',
      },
    };
  }

  const candidates: RawDiscoveredPerson[] = [];
  for (const hit of results) {
    // Strictly never treat scraped/unauthorized social URLs as primary social profiles
    const snippet = hit.company.webMetadata?.description || hit.company.webMetadata?.title || '';
    const extracted = extractPersonTitleMentionsFromSnippet(snippet);
    for (const item of extracted) {
      const role = classifyDecisionMakerRole({ rawJobTitle: item.jobTitle });
      candidates.push({
        fullName: item.fullName,
        ...splitNameParts(item.fullName),
        jobTitle: item.jobTitle,
        department: role.department,
        relationshipType: role.relationshipType,
        decisionMakerCategory: role.category,
        seniority: role.seniority,
        decisionMakingFunction: role.functionArea,
        officialBioUrl: hit.sourceUrl,
        countryCode: req.countryCode,
        employmentStatus: 'current',
        firstObservedAt: retrievedAt,
        lastObservedAt: retrievedAt,
        sourceName: `${hit.providerName} (Public Mention)`,
        sourceType: 'search_provider',
        sourceUrl: hit.sourceUrl,
        connectorId: activeSearchId,
        verificationTier: 'search_result',
        confidenceScore: 44, // Explicitly capped for uncorroborated search snippet
        isExplicitlyPublished: false,
        provenanceNotes: [
          `Public search snippet mention via ${hit.providerName}; confirm against official company site or registry before outreach.`,
        ],
        attributeProvenance: buildAttributeProvenance(
          {
            fullName: item.fullName,
            jobTitle: item.jobTitle,
          },
          {
            sourceType: 'search_provider',
            sourceName: hit.providerName,
            sourceUrl: hit.sourceUrl,
            connectorId: activeSearchId,
            retrievedAt,
            method: 'search_snippet_announcement',
          }
        ),
      });
    }
  }

  return {
    candidates,
    summary: {
      sourceId: activeSearchId,
      sourceName: 'Public Announcements & Web Search',
      status: candidates.length > 0 ? 'success' : 'no_results',
      candidatesFound: candidates.length,
      message:
        candidates.length > 0
          ? `Identified ${candidates.length} public executive mention(s) from ${results.length} search results.`
          : `Searched ${results.length} public web results; no unambiguous executive title pairs in snippets.`,
    },
  };
}

// ---------------------------------------------------------------------------
// Candidate Cross-Source Corroboration + CRM Identity Review (No Auto-Merge!)
// ---------------------------------------------------------------------------
const TIER_PRIORITY: Partial<Record<PersonVerificationTier, number>> = {
  officially_verified: 5,
  official_registry: 5,
  company_website: 4,
  official_company_published: 4,
  authorized_provider: 3,
  verified_professional: 3,
  directory_listed: 2,
  search_result: 1,
};

function matchesRoleFilters(c: DecisionMakerCandidate, req: DecisionMakerDiscoveryRequest): boolean {
  if (req.includeHistorical === false && c.employmentStatus === 'historical') {
    return false;
  }
  if (req.targetJobTitle?.trim()) {
    const q = req.targetJobTitle.trim().toLowerCase();
    const hay = `${c.jobTitle || ''} ${c.designation || ''} ${c.department || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (req.targetDepartment?.trim()) {
    const q = req.targetDepartment.trim().toLowerCase();
    if (!(c.department || '').toLowerCase().includes(q)) return false;
  }
  if (req.targetRelationshipType?.trim()) {
    if (c.relationshipType.toLowerCase() !== req.targetRelationshipType.trim().toLowerCase()) {
      return false;
    }
  }
  if (req.targetSeniority?.trim()) {
    if ((c.seniority || '').toLowerCase() !== req.targetSeniority.trim().toLowerCase()) {
      return false;
    }
  }
  if (req.targetDecisionFunction?.trim()) {
    if ((c.decisionMakingFunction || '').toLowerCase() !== req.targetDecisionFunction.trim().toLowerCase()) {
      return false;
    }
  }
  return true;
}

export async function discoverCompanyDecisionMakers(
  req: DecisionMakerDiscoveryRequest,
  deps: DecisionMakerDeps = {}
): Promise<DecisionMakerDiscoveryResponse> {
  const startedAt = Date.now();
  const retrievedAt = new Date().toISOString();
  const registry = deps.registry || defaultRegistry;
  const credMgr = deps.credentialManager || defaultCredentialManager;
  const engine = deps.executionEngine || defaultExecutionEngine;
  const existingPersons = deps.existingPersons || [];
  const existingRelationships = deps.existingRelationships || [];
  const leadNameById = new Map((deps.existingLeads || []).map((l) => [l.id, l.companyName]));

  const allowedSourceSet = req.sourceIds && req.sourceIds.length > 0 ? new Set(req.sourceIds) : null;
  const shouldRun = (id: string) =>
    (!allowedSourceSet || allowedSourceSet.has(id)) && isConnectorEnabled(id, registry, deps.configs);

  const [aiQueryPlan, webRes, brregRes, chRes, wdRes, ocRes, apolloRes, searchRes] = await Promise.all([
    generateDecisionMakerQueriesWithAi({
      companyName: req.companyName,
      domain: req.domain,
      countryCode: req.countryCode,
      industry: req.industry,
      targetJobTitle: req.targetJobTitle,
      targetDepartment: req.targetDepartment,
      targetRelationshipType: req.targetRelationshipType,
    }),
    shouldRun('conn-web-inspector')
      ? discoverFromOfficialWebsite(req, deps, retrievedAt)
      : Promise.resolve({
          candidates: [],
          summary: {
            sourceId: 'conn-web-inspector',
            sourceName: 'Official Company Leadership Pages',
            status: 'skipped_not_applicable' as const,
            candidatesFound: 0,
            message: 'Excluded by source selection or disabled.',
          },
        }),
    shouldRun('conn-brreg')
      ? discoverFromBrregRoller(req, deps, retrievedAt)
      : Promise.resolve({
          candidates: [],
          summary: {
            sourceId: 'conn-brreg',
            sourceName: 'Norway Brreg Roller Registry',
            status: 'skipped_not_applicable' as const,
            candidatesFound: 0,
            message: 'Excluded by source selection or disabled.',
          },
        }),
    shouldRun('conn-companies-house')
      ? discoverFromCompaniesHouseOfficers(req, deps, credMgr, registry, retrievedAt)
      : Promise.resolve({
          candidates: [],
          summary: {
            sourceId: 'conn-companies-house',
            sourceName: 'UK Companies House Officers API',
            status: 'skipped_not_applicable' as const,
            candidatesFound: 0,
            message: 'Excluded by source selection or disabled.',
          },
        }),
    shouldRun('conn-wikidata')
      ? discoverFromWikidataPeople(req, deps, retrievedAt)
      : Promise.resolve({
          candidates: [],
          summary: {
            sourceId: 'conn-wikidata',
            sourceName: 'Wikidata Corporate Leadership (CC0)',
            status: 'skipped_not_applicable' as const,
            candidatesFound: 0,
            message: 'Excluded by source selection or disabled.',
          },
        }),
    shouldRun('conn-opencorporates')
      ? discoverFromOpenCorporatesOfficers(req, deps, credMgr, registry, retrievedAt)
      : Promise.resolve({
          candidates: [],
          summary: {
            sourceId: 'conn-opencorporates',
            sourceName: 'OpenCorporates Officers API v0.4',
            status: 'skipped_not_applicable' as const,
            candidatesFound: 0,
            message: 'Excluded by source selection or disabled.',
          },
        }),
    shouldRun('conn-apollo')
      ? discoverFromApolloPeople(req, deps, credMgr, registry, retrievedAt)
      : Promise.resolve({
          candidates: [],
          summary: {
            sourceId: 'conn-apollo',
            sourceName: 'Apollo.io B2B People API',
            status: 'skipped_not_applicable' as const,
            candidatesFound: 0,
            message: 'Excluded by source selection or disabled.',
          },
        }),
    (!allowedSourceSet ||
      allowedSourceSet.has('conn-brave-search') ||
      allowedSourceSet.has('conn-google-cse'))
      ? discoverFromSearchAnnouncements(req, engine, registry, deps.configs, retrievedAt)
      : Promise.resolve({
          candidates: [],
          summary: {
            sourceId: 'conn-brave-search',
            sourceName: 'Public Announcements & Web Search',
            status: 'skipped_not_applicable' as const,
            candidatesFound: 0,
            message: 'Excluded by source selection.',
          },
        }),
  ]);

  const rawAll: RawDiscoveredPerson[] = [
    ...brregRes.candidates,
    ...chRes.candidates,
    ...webRes.candidates,
    ...apolloRes.candidates,
    ...ocRes.candidates,
    ...wdRes.candidates,
    ...searchRes.candidates,
  ];

  // Merge same person WITHIN THIS SINGLE COMPANY discovery ONLY when normalizedName + relationshipType match
  // or when email/linkedinUrl match for the same company.
  const mergedByKey = new Map<string, DecisionMakerCandidate>();

  for (const raw of rawAll) {
    const normName = normalizePersonNameTokens(raw.fullName);
    if (!normName) continue;
    const role = classifyDecisionMakerRole({
      rawRelationshipType: raw.relationshipType,
      rawJobTitle: raw.jobTitle,
      rawDepartment: raw.department,
    });
    const relType = raw.relationshipType || role.relationshipType;
    const key = raw.email
      ? `email:${raw.email.toLowerCase()}::${relType}`
      : raw.linkedinUrl
      ? `li:${raw.linkedinUrl.toLowerCase()}::${relType}`
      : `name:${normName}::${relType}`;

    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, {
        candidateId: `dmc-${crypto.createHash('sha1').update(`${req.companyName}:${key}`).digest('hex').slice(0, 12)}`,
        fullName: raw.fullName,
        firstName: raw.firstName,
        lastName: raw.lastName,
        normalizedName: normName,
        jobTitle: raw.jobTitle,
        designation: raw.designation,
        department: raw.department || role.department,
        relationshipType: relType,
        decisionMakerCategory: raw.decisionMakerCategory || role.category,
        seniority: raw.seniority || role.seniority,
        decisionMakingFunction: raw.decisionMakingFunction || role.functionArea,
        email: raw.email,
        emailStatus: raw.emailStatus || 'unavailable',
        phone: raw.phone,
        linkedinUrl: raw.linkedinUrl,
        officialBioUrl: raw.officialBioUrl,
        bioSummary: raw.bioSummary,
        city: raw.city,
        country: raw.country,
        countryCode: raw.countryCode,
        employmentStatus: raw.employmentStatus,
        firstObservedAt: raw.firstObservedAt,
        lastObservedAt: raw.lastObservedAt,
        endedAt: raw.endedAt,
        verificationTier: raw.verificationTier,
        confidenceScore: raw.confidenceScore,
        isExplicitlyPublished: raw.isExplicitlyPublished,
        sources: [
          {
            sourceName: raw.sourceName,
            sourceType: raw.sourceType,
            sourceUrl: raw.sourceUrl,
            connectorId: raw.connectorId,
            retrievedAt,
          },
        ],
        attributeProvenance: raw.attributeProvenance,
        provenanceNotes: [...raw.provenanceNotes],
      });
    } else {
      // Corroborate across sources without inflating search_result above its own evidence
      if (!existing.email && raw.email) {
        existing.email = raw.email;
        existing.emailStatus = raw.emailStatus || 'syntax_valid';
      }
      if (!existing.linkedinUrl && raw.linkedinUrl) existing.linkedinUrl = raw.linkedinUrl;
      if (!existing.officialBioUrl && raw.officialBioUrl) existing.officialBioUrl = raw.officialBioUrl;
      if (!existing.bioSummary && raw.bioSummary) existing.bioSummary = raw.bioSummary;
      if (!existing.city && raw.city) existing.city = raw.city;
      if (raw.isExplicitlyPublished) existing.isExplicitlyPublished = true;
      if ((TIER_PRIORITY[raw.verificationTier] ?? 0) > (TIER_PRIORITY[existing.verificationTier] ?? 0)) {
        existing.verificationTier = raw.verificationTier;
      }
      if (raw.employmentStatus === 'historical' && existing.employmentStatus !== 'current') {
        existing.employmentStatus = 'historical';
        existing.endedAt = existing.endedAt || raw.endedAt;
      }
      existing.confidenceScore = Math.min(97, Math.max(existing.confidenceScore, raw.confidenceScore) + 4);
      if (!existing.sources.some((s) => s.sourceName === raw.sourceName)) {
        existing.sources.push({
          sourceName: raw.sourceName,
          sourceType: raw.sourceType,
          sourceUrl: raw.sourceUrl,
          connectorId: raw.connectorId,
          retrievedAt,
        });
      }
      existing.attributeProvenance = { ...raw.attributeProvenance, ...existing.attributeProvenance };
      existing.provenanceNotes = Array.from(new Set([...existing.provenanceNotes, ...raw.provenanceNotes]));
    }
  }

  let candidates = Array.from(mergedByKey.values())
    .sort((a, b) => {
      // Prioritize current roles and higher verification tiers
      if (a.employmentStatus !== b.employmentStatus) {
        if (a.employmentStatus === 'current') return -1;
        if (b.employmentStatus === 'current') return 1;
      }
      return b.confidenceScore - a.confidenceScore;
    })
    .filter((c) => matchesRoleFilters(c, req));

  // Evaluate identity matching against existing CRM persons (exact vs uncertain match without auto-merge)
  for (const cand of candidates) {
    const liSlug = cand.linkedinUrl
      ? cand.linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]?.toLowerCase()
      : undefined;
    const identity = evaluatePersonIdentityMatches(
      {
        fullName: cand.fullName,
        normalizedName: cand.normalizedName,
        email: cand.email,
        linkedinSlug: liSlug,
        relationshipType: cand.relationshipType,
      },
      req.leadId,
      existingPersons,
      existingRelationships,
      leadNameById
    );

    if (identity.matchedPerson) {
      cand.matchedCrmPersonId = identity.matchedPerson.id;
    }
    if (identity.matchedRelationship) {
      cand.matchedRelationshipId = identity.matchedRelationship.id;
    }
    if (identity.uncertainMatches.length > 0) {
      cand.uncertainMatch = true;
      cand.uncertainMatchReasons = identity.uncertainMatches.map(
        (u) =>
          `${u.fullName} (ID: ${u.personId}${
            u.companyNames && u.companyNames.length > 0 ? ` — linked to ${u.companyNames.join(', ')}` : ''
          }): ${u.reason}`
      );
    }
  }

  // Enrich top 10 candidates with AI / deterministic profile relevance & bio summary
  if (deps.useAiAnalysis !== false && candidates.length > 0) {
    const enrichedTop = await Promise.all(
      candidates.slice(0, 10).map(async (c) => {
        const ai = await analyzeDecisionMakerProfileWithAi({
          companyName: req.companyName,
          companyIndustry: req.industry,
          fullName: c.fullName,
          jobTitle: c.jobTitle,
          department: c.department,
          employmentStatus: c.employmentStatus,
          endedAt: c.endedAt,
          sourceName: c.sources.map((s) => s.sourceName).join(', '),
          bioSnippet: c.bioSummary,
        });
        return {
          ...c,
          bioSummary: c.bioSummary || ai.bioSummary,
          relevanceExplanation: ai.relevanceExplanation,
          outdatedSignalNote: ai.outdatedSignalNote,
          seniority: c.seniority || ai.inferredSeniority,
          decisionMakingFunction: c.decisionMakingFunction || ai.inferredFunction,
        };
      })
    );
    candidates = [...enrichedTop, ...candidates.slice(10)];
  }

  const sourceSummaries: DecisionMakerSourceSummary[] = [
    webRes.summary,
    brregRes.summary,
    chRes.summary,
    wdRes.summary,
    ocRes.summary,
    apolloRes.summary,
    searchRes.summary,
  ];

  const allUnconfiguredOrEmpty =
    candidates.length === 0 &&
    sourceSummaries.some((s) => s.status === 'skipped_missing_credentials') &&
    sourceSummaries.every((s) => s.status !== 'success');

  return {
    companyName: req.companyName,
    leadId: req.leadId,
    candidates,
    sourceSummaries,
    aiQueryPlan,
    honestStatusNote:
      candidates.length > 0
        ? `Discovered ${candidates.length} candidate(s) across permitted sources. Select approved contacts to save or link into the CRM.`
        : allUnconfiguredOrEmpty
        ? 'No open website/registry decision-makers were published for this company, and credential-dependent sources (Companies House / OpenCorporates / Apollo / Search) are unconfigured in the Credential Vault.'
        : 'Completed permitted source checks; no published decision-makers matched your current role filters.',
    durationMs: Date.now() - startedAt,
  };
}
