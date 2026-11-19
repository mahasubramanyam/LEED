import fs from 'fs';
import path from 'path';
import {
  CanonicalLead,
  PipelineStage,
  LeadTask,
  OutreachCampaign,
  MergeHistoryRecord,
  ConnectorStatus,
  AppSettings,
  PersonRecord,
  CompanyPersonRelationship,
  LinkedPersonWithRelationship,
  ImportMappingTemplate,
  ImportBatchRecord,
  ImportBatchRowRecord,
  NormalizedImportPerson,
} from './types.js';
import { dbManager } from './db/pool.js';
import { PostgresStorage } from './db/storagePg.js';
import { migrator } from './db/migrator.js';
import { jsonMigrator, MigrationSummary } from './db/migrateJsonToSql.js';
import { canonicalizeIdentifierType } from '../shared/identifierRegistry.js';
import { DEFAULT_PIPELINE_STAGES } from '../shared/defaultStages.js';
import { normalizeIdentifierValue, normalizeUkCrn, normalizeUsCik } from './identifiers/identifierEngine.js';
import { mergeLeadWithTrustHierarchy } from './connectors/core/normalizer.js';
import { ConnectorConfigRecord, ConnectorRunRecord } from './connectors/core/types.js';
import {
  aggregateRunsByConnector,
  buildUnifiedConnectorStatus,
  connectorRegistry,
  ensureConnectorsRegistered,
} from './connectors/index.js';
import { ImportExecutionPlan, ImportExecutionResult, ImportStorageAdapter } from './import/importService.js';
import { findMatchingPerson } from './import/dedupeClassifier.js';
import {
  buildCanonicalLeadFromImport,
  buildPersonRecordFromImport,
  buildRelationshipRecord,
  mergeImportedPersonSafely,
  safelyMergeImportedCompanyIntoLead,
} from './import/crmMergeHelper.js';

interface DatabaseSchema {
  leads: CanonicalLead[];
  stages: PipelineStage[];
  tasks: LeadTask[];
  campaigns: OutreachCampaign[];
  mergeHistory: MergeHistoryRecord[];
  connectors: ConnectorStatus[];
  connectorConfigs?: Record<string, ConnectorConfigRecord>;
  connectorRuns?: ConnectorRunRecord[];
  persons?: PersonRecord[];
  companyPersonRelationships?: CompanyPersonRelationship[];
  importMappingTemplates?: ImportMappingTemplate[];
  importBatches?: ImportBatchRecord[];
  importBatchRows?: ImportBatchRowRecord[];
  settings: AppSettings;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'pipeline_store.json');

const DEFAULT_STAGES: PipelineStage[] = DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s }));

const DEFAULT_CONNECTORS: ConnectorStatus[] = [
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
    totalCalls: 18,
    lastRunAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'conn-companies-house',
    name: 'UK Companies House Registry',
    category: 'government_registry',
    countryCoverage: ['GB'],
    status: 'healthy',
    authType: 'api_key',
    isConfigured: true,
    rateLimitNote: '600 reqs / 5 mins. Free key available at developer.company-information.service.gov.uk',
    attribution: 'Crown Copyright (Open Government Licence v3.0)',
    totalCalls: 12,
    lastRunAt: new Date(Date.now() - 7200000).toISOString(),
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
    totalCalls: 45,
    lastRunAt: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: 'conn-abn',
    name: 'Australian Business Register (ABN Lookup)',
    category: 'government_registry',
    countryCoverage: ['AU'],
    status: process.env.ABR_GUID ? 'configured' : 'unconfigured',
    authType: 'api_key',
    isConfigured: Boolean(process.env.ABR_GUID),
    rateLimitNote: 'ATO Modulo-89 checksum & 5-record sample offline; live ABR API requires registered ABR GUID',
    attribution: 'Commonwealth of Australia Open Data (ABR)',
    totalCalls: 8,
    lastRunAt: new Date(Date.now() - 86400000).toISOString(),
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
    totalCalls: 64,
    lastRunAt: new Date(Date.now() - 900000).toISOString(),
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
    totalCalls: 29,
    lastRunAt: new Date().toISOString(),
  },
];

const DEFAULT_SETTINGS: AppSettings = {
  ownerName: 'Lead Intelligence Operator',
  ownerEmail: 'owner@pipeline.local',
  defaultCountry: 'GB',
  defaultCurrency: 'USD',
  userAgent: 'GlobalLeadPipeline/1.0 (contact@internal-pipeline.local)',
  enableSafeWebsiteCrawl: true,
  outreachApprovalRequired: true,
  autoDedupeThreshold: 0.85,
  suppressionDomains: ['example.com', 'test.com', 'spamdomain.org'],
};

// Initial verified foundation leads across multiple countries and official registries
const INITIAL_LEADS: CanonicalLead[] = [
  {
    id: 'brreg-923609016',
    companyName: 'NORDIC SEMICONDUCTOR ASA',
    legalName: 'NORDIC SEMICONDUCTOR ASA',
    registrationNumber: '923609016',
    registrationType: 'NO_ORG',
    companyStatus: 'active',
    website: 'https://www.nordicsemi.com',
    domain: 'nordicsemi.com',
    email: 'post@nordicsemi.no',
    emailStatus: 'syntax_valid',
    phone: '+47 72 89 89 00',
    phoneNormalized: '+4772898900',
    address: {
      street: 'Otto Nielsens veg 12',
      city: 'Trondheim',
      region: 'Trøndelag',
      postalCode: '7052',
      country: 'Norway',
      countryCode: 'NO',
      formattedAddress: 'Otto Nielsens veg 12, 7052 Trondheim, Norway',
    },
    coordinates: { lat: 63.421, lon: 10.435 },
    industry: 'Engineering and technical consultancy activities',
    category: 'Allmennaksjeselskap (ASA)',
    employeeRange: '1000-5000',
    foundedYear: 1983,
    confidenceScore: 95,
    confidenceSignals: [
      'Official Government Registry Record (Brreg Verified)',
      'Active Registered Corporate Status',
      'Official Registered Website Present',
      'Physical Registered Address Verified',
      'Valid Corporate Telephone',
    ],
    sources: [
      {
        sourceName: 'Brønnøysund Register Centre (Brreg)',
        providerId: '923609016',
        url: 'https://data.brreg.no/enhetsregisteret/oppslag/enheter/923609016',
        retrievedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        license: 'Norwegian Licence for Open Government Data (NLOD)',
        attribution: 'Official open public data from the Brønnøysund Register Centre',
      },
    ],
    identifiers: [
      { type: 'NO_ORG', value: '923609016', normalizedValue: '923609016', countryCode: 'NO', verified: true },
      { type: 'DOMAIN', value: 'nordicsemi.com', normalizedValue: 'NORDICSEMICOM', countryCode: 'NO', verified: true },
    ],
    webMetadata: {
      title: 'Nordic Semiconductor | Low Power Short-Range Wireless IoT Solutions',
      description: 'Nordic Semiconductor is a fabless semiconductor company specializing in wireless technology for the IoT.',
      httpStatus: 200,
      isHttps: true,
      serverLatencyMs: 142,
      inspectedAt: new Date(Date.now() - 3600000).toISOString(),
    },
    socialLinks: {
      linkedin: 'https://www.linkedin.com/company/nordic-semiconductor',
      twitter: 'https://twitter.com/NordicTweets',
      youtube: 'https://www.youtube.com/NordicSemi',
    },
    status: 'qualified',
    pipelineStageId: 'stage-qualified',
    opportunityValue: 45000,
    currency: 'USD',
    winProbability: 60,
    tags: ['Norway', 'Semiconductors', 'IoT', 'High Value'],
    notes: [
      {
        id: 'note-1',
        content: 'Verified publicly available quarterly reporting. Strong candidate for European enterprise pipeline expansion.',
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        author: 'Lead Intelligence Operator',
      },
    ],
    activities: [
      {
        id: 'act-1',
        type: 'enrichment',
        title: 'Initial registry import from Brreg',
        outcome: '923609016 confirmed active',
        date: new Date(Date.now() - 86400000 * 3).toISOString(),
        actor: 'Brreg Connector',
      },
      {
        id: 'act-2',
        type: 'stage_change',
        title: 'Moved to Qualified',
        outcome: 'Firmographic criteria satisfied',
        date: new Date(Date.now() - 86400000).toISOString(),
        actor: 'Lead Intelligence Operator',
      },
    ],
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'uk-crn-07386161',
    companyName: 'DEEPMIND TECHNOLOGIES LIMITED',
    legalName: 'DEEPMIND TECHNOLOGIES LIMITED',
    registrationNumber: '07386161',
    registrationType: 'UK_CRN',
    companyStatus: 'active',
    website: 'https://deepmind.google',
    domain: 'deepmind.google',
    phone: '+44 20 7031 3000',
    phoneNormalized: '+442070313000',
    address: {
      street: '6 Pancras Square',
      city: 'London',
      region: 'Greater London',
      postalCode: 'N1C 4AG',
      country: 'United Kingdom',
      countryCode: 'GB',
      formattedAddress: '6 Pancras Square, London, N1C 4AG, United Kingdom',
    },
    coordinates: { lat: 51.532, lon: -0.125 },
    industry: 'Other research and experimental development on natural sciences',
    category: 'Private Limited Company (LTD)',
    employeeRange: '1000+',
    foundedYear: 2010,
    confidenceScore: 92,
    confidenceSignals: [
      'Verified UK Company Registration Number (CRN 07386161)',
      'Active Registered Corporate Status in Companies House',
      'Registered Office Postcode & City on File',
      'Live Verified Domain Presence',
    ],
    sources: [
      {
        sourceName: 'UK Companies House (Official Register)',
        providerId: '07386161',
        url: 'https://find-and-update.company-information.service.gov.uk/company/07386161',
        retrievedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        license: 'Open Government Licence v3.0 (OGL)',
        attribution: 'Crown copyright. Contains public sector information licensed under the Open Government Licence v3.0.',
      },
    ],
    identifiers: [
      { type: 'UK_CRN', value: '07386161', normalizedValue: '07386161', countryCode: 'GB', verified: true },
      { type: 'DOMAIN', value: 'deepmind.google', normalizedValue: 'DEEPMINDGOOGLE', countryCode: 'GB', verified: true },
    ],
    webMetadata: {
      title: 'Google DeepMind | Research and Artificial Intelligence',
      description: 'Advancing science and benefiting humanity through artificial intelligence development.',
      httpStatus: 200,
      isHttps: true,
      serverLatencyMs: 98,
      inspectedAt: new Date(Date.now() - 7200000).toISOString(),
    },
    status: 'pitch_ready' as unknown as any,
    pipelineStageId: 'stage-pitch-ready',
    opportunityValue: 120000,
    currency: 'GBP',
    winProbability: 40,
    tags: ['United Kingdom', 'Companies House', 'Artificial Intelligence', 'London HQ'],
    notes: [
      {
        id: 'note-2',
        content: 'AI research division. Pitch should highlight automated dataset governance and provenance tracking.',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        author: 'Lead Intelligence Operator',
      },
    ],
    activities: [
      {
        id: 'act-3',
        type: 'enrichment',
        title: 'Companies House lookup completed',
        outcome: 'CRN 07386161 confirmed active with registered office at Pancras Square',
        date: new Date(Date.now() - 86400000 * 5).toISOString(),
        actor: 'Companies House Connector',
      },
    ],
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'abn-88098143410',
    companyName: 'ATLASSIAN PTY LTD',
    legalName: 'ATLASSIAN PTY LTD',
    registrationNumber: '88 098 143 410',
    registrationType: 'AU_ABN',
    companyStatus: 'active',
    website: 'https://www.atlassian.com',
    domain: 'atlassian.com',
    phone: '+61 2 9262 1077',
    address: {
      street: '341 George Street',
      city: 'Sydney',
      region: 'NSW',
      postalCode: '2000',
      country: 'Australia',
      countryCode: 'AU',
      formattedAddress: '341 George Street, Sydney NSW 2000, Australia',
    },
    coordinates: { lat: -33.868, lon: 151.207 },
    industry: 'Australian Proprietary Company, Limited By Shares',
    category: 'Enterprise Software & Collaboration',
    employeeRange: '5000+',
    foundedYear: 2002,
    confidenceScore: 90,
    confidenceSignals: [
      'Official Australian Business Number (ABN Checksum Validated)',
      'Active Status in Australian Business Register',
      'Verified Enterprise Domain (atlassian.com)',
    ],
    sources: [
      {
        sourceName: 'Australian Business Register (ABN Lookup)',
        providerId: '88098143410',
        url: 'https://abr.business.gov.au/ABN/View?id=88098143410',
        retrievedAt: new Date(Date.now() - 86400000 * 4).toISOString(),
        license: 'Commonwealth of Australia Open Data',
        attribution: 'Data sourced from Australian Business Register (abr.business.gov.au)',
      },
    ],
    identifiers: [
      { type: 'AU_ABN', value: '88 098 143 410', normalizedValue: '88098143410', countryCode: 'AU', verified: false },
      { type: 'DOMAIN', value: 'atlassian.com', normalizedValue: 'ATLASSIANCOM', countryCode: 'AU', verified: false },
    ],
    status: 'contacted',
    pipelineStageId: 'stage-contacted',
    opportunityValue: 75000,
    currency: 'AUD',
    winProbability: 50,
    tags: ['Australia', 'Enterprise', 'Software', 'Sydney'],
    notes: [],
    activities: [
      {
        id: 'act-4',
        type: 'email',
        title: 'Initial Partnership Proposal Drafted',
        outcome: 'Awaiting response from procurement office',
        date: new Date(Date.now() - 86400000).toISOString(),
        actor: 'Lead Intelligence Operator',
      },
    ],
    createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'osm-2481940182',
    companyName: 'St. Thomas Hospital Dental Clinic',
    website: 'https://www.guysandstthomas.nhs.uk',
    domain: 'guysandstthomas.nhs.uk',
    phone: '+44 20 7188 7188',
    email: 'contact@guysandstthomas.nhs.uk',
    emailStatus: 'syntax_valid',
    address: {
      street: 'Westminster Bridge Road',
      city: 'London',
      region: 'Greater London',
      postalCode: 'SE1 7EH',
      country: 'United Kingdom',
      countryCode: 'GB',
      formattedAddress: 'Westminster Bridge Road, London, SE1 7EH, United Kingdom',
    },
    coordinates: { lat: 51.5008, lon: -0.1195 },
    industry: 'AMENITY',
    category: 'Healthcare & Clinic',
    confidenceScore: 82,
    confidenceSignals: [
      'Geocoded Physical Location & Coordinates',
      'Detailed Street Address on Map',
      'Public Telephone Discovered',
      'Direct Email Address Tagged',
    ],
    sources: [
      {
        sourceName: 'OpenStreetMap (Nominatim & POI)',
        providerId: 'osm-node-2481940182',
        url: 'https://www.openstreetmap.org/node/2481940182',
        retrievedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        license: 'Open Data Commons Open Database License (ODbL)',
        attribution: '© OpenStreetMap contributors',
      },
    ],
    identifiers: [
      { type: 'DOMAIN', value: 'guysandstthomas.nhs.uk', verified: false },
      { type: 'PHONE', value: '+44 20 7188 7188', verified: false },
    ],
    status: 'new',
    pipelineStageId: 'stage-discovered',
    currency: 'GBP',
    tags: ['United Kingdom', 'Healthcare', 'Clinic', 'London'],
    notes: [],
    activities: [
      {
        id: 'act-5',
        type: 'enrichment',
        title: 'Geocoded via OpenStreetMap POI search',
        outcome: 'Discovered dental clinic near Westminster Bridge',
        date: new Date(Date.now() - 86400000 * 2).toISOString(),
        actor: 'OpenStreetMap Connector',
      },
    ],
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

const INITIAL_TASKS: LeadTask[] = [
  {
    id: 'task-1',
    title: 'Review Companies House filing for DeepMind executive contact points',
    dueDate: new Date(Date.now() + 86400000 * 2).toISOString(),
    priority: 'high',
    completed: false,
    assignedTo: 'Lead Intelligence Operator',
    leadId: 'uk-crn-07386161',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'task-2',
    title: 'Verify website contact form on Nordic Semiconductor web portal',
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
    priority: 'medium',
    completed: false,
    assignedTo: 'Lead Intelligence Operator',
    leadId: 'brreg-923609016',
    createdAt: new Date().toISOString(),
  },
];

const INITIAL_CAMPAIGNS: OutreachCampaign[] = [
  {
    id: 'camp-q4-europe-tech',
    name: 'Nordic & UK High-Growth Tech Infrastructure',
    channel: 'email',
    subjectTemplate: 'Quick question regarding {{company_name}} data infrastructure',
    bodyTemplate:
      'Hi {{company_name}} team,\n\nI noticed your recent technological developments in {{city}} within the {{industry}} space.\n\nWe specialize in automated data integrity and registry compliance pipelines for global tech leaders.\n\nWould you be open to reviewing a short 3-minute executive brief on this?\n\nBest regards,\n{{owner_name}}',
    targetIndustry: 'Technology & Engineering',
    targetCountry: 'NO',
    status: 'active',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    messages: [
      {
        id: 'msg-1',
        campaignId: 'camp-q4-europe-tech',
        leadId: 'brreg-923609016',
        leadCompanyName: 'NORDIC SEMICONDUCTOR ASA',
        recipientEmail: 'post@nordicsemi.no',
        subject: 'Quick question regarding NORDIC SEMICONDUCTOR ASA data infrastructure',
        content:
          'Hi NORDIC SEMICONDUCTOR ASA team,\n\nI noticed your recent technological developments in Trondheim within the Engineering and technical consultancy activities space.\n\nWe specialize in automated data integrity and registry compliance pipelines for global tech leaders.\n\nWould you be open to reviewing a short 3-minute executive brief on this?\n\nBest regards,\nLead Intelligence Operator',
        status: 'pending_approval',
      },
    ],
  },
];

export class StorageManager implements ImportStorageAdapter {
  private db: DatabaseSchema;
  private readonly dbFilePath: string;
  private readonly dataDirPath: string;

  constructor(customDbFilePath?: string) {
    this.dbFilePath = customDbFilePath ? path.resolve(customDbFilePath) : DB_FILE;
    this.dataDirPath = path.dirname(this.dbFilePath);
    this.ensureDataDir();
    this.db = this.loadDatabase();
  }

  private ensureDataDir() {
    if (!fs.existsSync(this.dataDirPath)) {
      fs.mkdirSync(this.dataDirPath, { recursive: true });
    }
  }

  private loadDatabase(): DatabaseSchema {
    if (fs.existsSync(this.dbFilePath)) {
      try {
        const raw = fs.readFileSync(this.dbFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as DatabaseSchema;
        parsed.persons = parsed.persons || [];
        parsed.companyPersonRelationships = parsed.companyPersonRelationships || [];
        parsed.importMappingTemplates = parsed.importMappingTemplates || [];
        parsed.importBatches = parsed.importBatches || [];
        parsed.importBatchRows = parsed.importBatchRows || [];
        return parsed;
      } catch (e) {
        console.error('Failed to read pipeline store JSON, creating fallback', e);
      }
    }

    const initialDb: DatabaseSchema = {
      leads: INITIAL_LEADS,
      stages: DEFAULT_STAGES,
      tasks: INITIAL_TASKS,
      campaigns: INITIAL_CAMPAIGNS,
      mergeHistory: [],
      connectors: DEFAULT_CONNECTORS,
      persons: [],
      companyPersonRelationships: [],
      importMappingTemplates: [],
      importBatches: [],
      importBatchRows: [],
      settings: DEFAULT_SETTINGS,
    };

    this.saveDatabase(initialDb);
    return initialDb;
  }

  private saveDatabase(data: DatabaseSchema) {
    try {
      fs.writeFileSync(this.dbFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to write pipeline store JSON', e);
    }
  }

  public getLeads(): CanonicalLead[] {
    return this.db.leads;
  }

  public getLead(id: string): CanonicalLead | undefined {
    return this.db.leads.find((l) => l.id === id);
  }

  private resolveStageId(requestedStageId?: string): string | undefined {
    const clean = typeof requestedStageId === 'string' ? requestedStageId.trim() : '';
    if (!clean) {
      return this.db.stages[0]?.id;
    }
    if (this.db.stages.some((s) => s.id === clean)) {
      return clean;
    }
    throw new Error(`Invalid pipelineStageId "${clean}": stage does not exist in pipeline_stages.`);
  }

  public upsertLead(lead: CanonicalLead): CanonicalLead {
    const resolvedStageId = this.resolveStageId(lead.pipelineStageId);
    const normalizedLead: CanonicalLead = {
      ...lead,
      pipelineStageId: resolvedStageId,
      registrationType: lead.registrationType
        ? canonicalizeIdentifierType(lead.registrationType, lead.address?.countryCode)
        : undefined,
      identifiers: (lead.identifiers || [])
        .filter((i) => i && i.value && i.value.trim().length > 0)
        .map((i) => ({
          ...i,
          type: canonicalizeIdentifierType(i.type, i.countryCode || lead.address?.countryCode),
          value: i.value.trim(),
          normalizedValue: i.normalizedValue || normalizeIdentifierValue(i.value),
        })),
      updatedAt: new Date().toISOString(),
    };
    const idx = this.db.leads.findIndex((l) => l.id === normalizedLead.id);
    if (idx >= 0) {
      this.db.leads[idx] = normalizedLead;
    } else {
      this.db.leads.unshift(normalizedLead);
    }
    this.saveDatabase(this.db);
    return normalizedLead;
  }

  public batchUpsertLeads(
    newLeads: CanonicalLead[],
    options: { skipDuplicates?: boolean } = {}
  ): {
    added: number;
    updated: number;
    skipped: number;
    failed: number;
    errors: Array<{ row: number; companyName?: string; error: string }>;
    savedLeadIds: string[];
  } {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ row: number; companyName?: string; error: string }> = [];
    const savedLeadIds: string[] = [];
    const now = new Date().toISOString();

    for (let rowIdx = 0; rowIdx < newLeads.length; rowIdx++) {
      const rawLead = newLeads[rowIdx];
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
        updatedAt: now,
      };

      const normByType = (val?: string, t?: string, cCode?: string): string => {
        if (!val) return '';
        const ct = t ? canonicalizeIdentifierType(t, cCode) : '';
        if (ct === 'UK_CRN') return normalizeUkCrn(val);
        if (ct === 'US_CIK') return normalizeUsCik(val);
        return normalizeIdentifierValue(val);
      };

      const cleanReg = normByType(lead.registrationNumber, lead.registrationType, lead.address?.countryCode);
      const pDigits = (lead.phoneNormalized || lead.phone || '').replace(/[^0-9]/g, '');

      const idx = this.db.leads.findIndex((existing) => {
        if (existing.id === lead.id) return true;
        if (lead.domain && existing.domain && existing.domain.toLowerCase() === lead.domain.toLowerCase()) return true;
        if (cleanReg.length >= 4 && existing.registrationNumber) {
          const exReg = normByType(existing.registrationNumber, existing.registrationType, existing.address?.countryCode);
          if (exReg === cleanReg) return true;
        }
        if (lead.identifiers && existing.identifiers) {
          for (const idA of lead.identifiers) {
            if (idA.type === 'DOMAIN' || idA.type === 'PHONE' || idA.type === 'EMAIL') continue;
            const normA = normByType(idA.normalizedValue || idA.value, idA.type, idA.countryCode || lead.address?.countryCode);
            if (normA.length < 4) continue;
            for (const idB of existing.identifiers) {
              const tB = canonicalizeIdentifierType(idB.type, idB.countryCode || existing.address?.countryCode);
              const normB = normByType(idB.normalizedValue || idB.value, tB, idB.countryCode || existing.address?.countryCode);
              if (normA === normB && idA.type === tB) return true;
            }
          }
        }
        const exPhone = (existing.phoneNormalized || existing.phone || '').replace(/[^0-9]/g, '');
        if (pDigits.length >= 7 && exPhone === pDigits) return true;
        return false;
      });

        if (idx >= 0) {
          if (options.skipDuplicates) {
            skipped++;
            continue;
          }
          const existing = this.db.leads[idx];
          const resolvedStageId = this.resolveStageId(existing.pipelineStageId);
          const mergedLead = mergeLeadWithTrustHierarchy(existing, lead);
          mergedLead.pipelineStageId = resolvedStageId;
          mergedLead.updatedAt = now;
          this.db.leads[idx] = mergedLead;
          savedLeadIds.push(mergedLead.id);
          updated++;
        } else {
          try {
            const resolvedStageId = this.resolveStageId(lead.pipelineStageId);
            const persistedLead: CanonicalLead = { ...lead, pipelineStageId: resolvedStageId };
            this.db.leads.unshift(persistedLead);
            savedLeadIds.push(persistedLead.id);
            added++;
          } catch (rowErr: unknown) {
            failed++;
            errors.push({
              row: rowIdx + 1,
              companyName: lead.companyName,
              error: rowErr instanceof Error ? rowErr.message : String(rowErr),
            });
          }
        }
    }
    this.saveDatabase(this.db);
    return { added, updated, skipped, failed, errors, savedLeadIds };
  }

  public deleteLead(id: string): boolean {
    const prevLen = this.db.leads.length;
    this.db.leads = this.db.leads.filter((l) => l.id !== id);
    if (this.db.leads.length !== prevLen) {
      this.saveDatabase(this.db);
      return true;
    }
    return false;
  }

  public getStages(): PipelineStage[] {
    return this.db.stages;
  }

  public initializeDefaultStages(): { initialized: boolean; insertedCount: number; stages: PipelineStage[] } {
    if (this.db.stages && this.db.stages.length > 0) {
      return { initialized: false, insertedCount: 0, stages: this.db.stages };
    }
    this.db.stages = DEFAULT_STAGES.map((s) => ({ ...s }));
    this.saveDatabase(this.db);
    return { initialized: true, insertedCount: this.db.stages.length, stages: this.db.stages };
  }

  public getTasks(): LeadTask[] {
    return this.db.tasks;
  }

  public createTask(task: Omit<LeadTask, 'id' | 'createdAt'>): LeadTask {
    const newTask: LeadTask = {
      ...task,
      id: `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    this.db.tasks.unshift(newTask);
    this.saveDatabase(this.db);
    return newTask;
  }

  public updateTask(id: string, updates: Partial<LeadTask>): LeadTask | undefined {
    const task = this.db.tasks.find((t) => t.id === id);
    if (!task) return undefined;
    Object.assign(task, updates);
    this.saveDatabase(this.db);
    return task;
  }

  public deleteTask(id: string): boolean {
    const prev = this.db.tasks.length;
    this.db.tasks = this.db.tasks.filter((t) => t.id !== id);
    if (this.db.tasks.length !== prev) {
      this.saveDatabase(this.db);
      return true;
    }
    return false;
  }

  public getCampaigns(): OutreachCampaign[] {
    return this.db.campaigns;
  }

  public createCampaign(campaign: Omit<OutreachCampaign, 'id' | 'createdAt'>): OutreachCampaign {
    const newCamp: OutreachCampaign = {
      ...campaign,
      id: `camp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: new Date().toISOString(),
    };
    this.db.campaigns.unshift(newCamp);
    this.saveDatabase(this.db);
    return newCamp;
  }

  public updateCampaignMessageStatus(
    campaignId: string,
    messageId: string,
    status: 'pending_approval' | 'approved' | 'sent' | 'rejected' | 'opted_out'
  ): boolean {
    const camp = this.db.campaigns.find((c) => c.id === campaignId);
    if (!camp) return false;
    const msg = camp.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.status = status;
    if (status === 'sent') {
      msg.sentAt = new Date().toISOString();
      msg.deliveryId = `deliv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }
    this.saveDatabase(this.db);
    return true;
  }

  public recordMerge(historyRecord: MergeHistoryRecord) {
    this.db.mergeHistory.unshift(historyRecord);
    this.saveDatabase(this.db);
  }

  public getMergeHistory(): MergeHistoryRecord[] {
    return this.db.mergeHistory;
  }

  public undoMerge(historyId: string): boolean {
    const idx = this.db.mergeHistory.findIndex((h) => h.id === historyId);
    if (idx < 0) return false;

    const record = this.db.mergeHistory[idx];
    // Restore the absorbed lead snapshot back to database
    this.db.leads.unshift(record.mergedLeadSnapshot);
    // Remove merge record
    this.db.mergeHistory.splice(idx, 1);
    this.saveDatabase(this.db);
    return true;
  }

  public getConnectorConfigs(): Record<string, ConnectorConfigRecord> {
    const raw = this.db.connectorConfigs || this.db.settings?.connectorConfigs || {};
    const filtered: Record<string, ConnectorConfigRecord> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!k.startsWith('__')) {
        filtered[k] = v;
      }
    }
    return filtered;
  }

  public updateConnectorConfig(
    connectorId: string,
    partial: Partial<ConnectorConfigRecord>
  ): ConnectorConfigRecord {
    ensureConnectorsRegistered();
    const meta = connectorRegistry.getById(connectorId)?.getMetadata();
    const rawConfigs = this.db.connectorConfigs || this.db.settings?.connectorConfigs || {};
    const existing = rawConfigs[connectorId];
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

    this.db.connectorConfigs = {
      ...rawConfigs,
      [connectorId]: nextConfig,
    };
    if (this.db.settings) {
      this.db.settings.connectorConfigs = this.db.connectorConfigs;
    }
    connectorRegistry.setEnabledOverride(connectorId, nextConfig.enabled);
    this.saveDatabase(this.db);
    return nextConfig;
  }

  public recordConnectorRun(run: ConnectorRunRecord): void {
    if (!Array.isArray(this.db.connectorRuns)) {
      this.db.connectorRuns = [];
    }
    this.db.connectorRuns.unshift(run);
    if (this.db.connectorRuns.length > 250) {
      this.db.connectorRuns = this.db.connectorRuns.slice(0, 250);
    }

    const conn = this.db.connectors.find((c) => c.id === run.connectorId);
    if (conn) {
      conn.totalCalls += 1;
      conn.lastRunAt = run.completedAt || run.startedAt;
      if (run.status === 'error') {
        conn.lastError = run.diagnosticSummary;
        conn.status = run.errorCategory === 'rate_limited' ? 'rate_limited' : 'degraded';
      } else {
        conn.lastError = undefined;
        conn.status = 'healthy';
      }
    }
    this.saveDatabase(this.db);
  }

  public getConnectorRuns(connectorId?: string, limit = 50): ConnectorRunRecord[] {
    const runs = Array.isArray(this.db.connectorRuns) ? this.db.connectorRuns : [];
    const filtered = connectorId ? runs.filter((r) => r.connectorId === connectorId) : runs;
    return filtered.slice(0, limit);
  }

  public async getConnectorsUnified(): Promise<ConnectorStatus[]> {
    ensureConnectorsRegistered();
    const configs = this.getConnectorConfigs();
    for (const [id, cfg] of Object.entries(configs)) {
      if (typeof cfg?.enabled === 'boolean') {
        connectorRegistry.setEnabledOverride(id, cfg.enabled);
      }
    }
    const runs = this.getConnectorRuns(undefined, 250);
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

  public getConnectors(): ConnectorStatus[] {
    const hasChKey = Boolean(process.env.COMPANIES_HOUSE_API_KEY || this.db.settings?.companiesHouseApiKey);
    const hasAbrGuid = Boolean(process.env.ABR_GUID);
    const configs = this.getConnectorConfigs();
    return this.db.connectors.map((c) => {
      const cfg = configs[c.id];
      const enabled = cfg?.enabled ?? true;
      if (!enabled) {
        return {
          ...c,
          status: 'degraded',
          healthState: 'disabled',
          operational: false,
          config: cfg,
        };
      }
      if (c.id === 'conn-companies-house') {
        return {
          ...c,
          isConfigured: hasChKey,
          status: hasChKey ? (c.status === 'degraded' ? 'degraded' : 'healthy') : 'unconfigured',
          config: cfg,
        };
      }
      if (c.id === 'conn-abn') {
        return {
          ...c,
          authType: 'api_key',
          isConfigured: hasAbrGuid,
          status: hasAbrGuid ? 'healthy' : 'unconfigured',
          rateLimitNote: 'ATO Modulo-89 checksum & 5-record sample offline; live ABR API requires registered ABR GUID',
          config: cfg,
        };
      }
      return { ...c, config: cfg };
    });
  }

  public recordConnectorActivity(connectorId: string, success: boolean, errorMessage?: string) {
    const now = new Date().toISOString();
    this.recordConnectorRun({
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

  public getSettings(): AppSettings {
    return this.db.settings;
  }

  public updateSettings(updates: Partial<AppSettings>): AppSettings {
    const nextSettings: AppSettings = {
      ...this.db.settings,
      ...updates,
      companiesHouseApiKey:
        typeof updates.companiesHouseApiKey === 'string' && updates.companiesHouseApiKey.trim().length > 0
          ? updates.companiesHouseApiKey.trim()
          : this.db.settings.companiesHouseApiKey,
      connectorConfigs: updates.connectorConfigs
        ? { ...(this.db.settings.connectorConfigs || {}), ...updates.connectorConfigs }
        : this.db.settings.connectorConfigs,
    };
    this.db.settings = nextSettings;
    if (updates.connectorConfigs) {
      this.db.connectorConfigs = nextSettings.connectorConfigs;
    }
    this.saveDatabase(this.db);
    return this.db.settings;
  }

  // PostgreSQL Integration & Dual-Engine Status
  public readonly pgStorage = new PostgresStorage();

  public isPostgresConnected(): boolean {
    return dbManager.isDbConnected();
  }

  public getStorageEngine(): 'postgresql' | 'json_store' {
    return dbManager.isDbConnected() ? 'postgresql' : 'json_store';
  }

  public async getDatabaseDiagnostics(): Promise<{
    configured: boolean;
    connected: boolean;
    engine: 'postgresql' | 'json_store';
    connectionStringConfigured: boolean;
    poolStatus: any;
    jsonRecords: {
      leads: number;
      stages: number;
      tasks: number;
      campaigns: number;
      mergeRecords: number;
    };
    postgresRecords?: {
      leads: number;
      stages: number;
      tasks: number;
      campaigns: number;
      schemaVersion?: string;
    };
  }> {
    const configured = !!process.env.DATABASE_URL;
    const connected = dbManager.isDbConnected();
    const pool = dbManager.getPool();

    let postgresRecords;
    if (connected && pool) {
      try {
        const leadsRes = await pool.query('SELECT COUNT(*) as count FROM leads');
        const stagesRes = await pool.query('SELECT COUNT(*) as count FROM pipeline_stages');
        const tasksRes = await pool.query('SELECT COUNT(*) as count FROM tasks');
        const campsRes = await pool.query('SELECT COUNT(*) as count FROM campaigns');
        const migRes = await pool.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');

        postgresRecords = {
          leads: parseInt(leadsRes.rows[0]?.count || '0', 10),
          stages: parseInt(stagesRes.rows[0]?.count || '0', 10),
          tasks: parseInt(tasksRes.rows[0]?.count || '0', 10),
          campaigns: parseInt(campsRes.rows[0]?.count || '0', 10),
          schemaVersion: migRes.rows[0]?.version || 'none',
        };
      } catch (err) {
        console.warn('Failed to query diagnostics from postgres:', err);
      }
    }

    return {
      configured,
      connected,
      engine: connected ? 'postgresql' : 'json_store',
      connectionStringConfigured: configured,
      poolStatus: dbManager.getHealthStatus(),
      jsonRecords: {
        leads: this.db.leads.length,
        stages: this.db.stages.length,
        tasks: this.db.tasks.length,
        campaigns: this.db.campaigns.length,
        mergeRecords: this.db.mergeHistory.length,
      },
      postgresRecords,
    };
  }

  public async runSchemaMigrations(options?: { targetVersion?: '004' | '005'; confirmMigration?: string }) {
    if (
      !options?.targetVersion ||
      !['004', '005'].includes(options.targetVersion) ||
      options.confirmMigration !== options.targetVersion
    ) {
      throw new Error(
        'Unrestricted bulk migration execution is disabled. Explicit allowlisted targetVersion and confirmMigration are required.'
      );
    }
    return migrator.runMigrations(undefined, { targetVersion: options.targetVersion });
  }

  public async runJsonMigration(dryRun = false): Promise<MigrationSummary> {
    return jsonMigrator.migrate({ dryRun });
  }

  // ==========================================
  // PHASE 7: PERSONS, M:N RELATIONSHIPS & IMPORT ENGINE
  // ==========================================

  public getPersons(): PersonRecord[] {
    if (!this.db.persons) this.db.persons = [];
    return this.db.persons;
  }

  public getAllRelationships(): CompanyPersonRelationship[] {
    if (!this.db.companyPersonRelationships) this.db.companyPersonRelationships = [];
    return this.db.companyPersonRelationships;
  }

  public getLeadPersons(leadId: string): LinkedPersonWithRelationship[] {
    const persons = this.getPersons();
    const rels = this.getAllRelationships();
    const leadMap = new Map(this.db.leads.map((l) => [l.id, l]));

    const attached = rels.filter((r) => r.leadId === leadId);
    const out: LinkedPersonWithRelationship[] = [];

    for (const rel of attached) {
      const person = persons.find((p) => p.id === rel.personId);
      if (!person) continue;
      const otherCompanies = rels
        .filter((other) => other.personId === person.id && other.leadId !== leadId)
        .map((other) => ({
          leadId: other.leadId,
          companyName: leadMap.get(other.leadId)?.companyName || other.leadId,
          relationshipType: other.relationshipType,
          jobTitle: other.jobTitle,
        }));

      out.push({
        person,
        relationship: rel,
        otherCompanies: otherCompanies.length > 0 ? otherCompanies : undefined,
      });
    }

    return out;
  }

  public linkPersonToLead(input: {
    leadId: string;
    person: NormalizedImportPerson;
    actorEmail: string;
  }): LinkedPersonWithRelationship[] {
    if (!this.db.persons) this.db.persons = [];
    if (!this.db.companyPersonRelationships) this.db.companyPersonRelationships = [];
    const now = new Date().toISOString();

    const pMatch = findMatchingPerson(
      input.person,
      input.leadId,
      this.db.persons,
      this.db.companyPersonRelationships
    );

    let personId: string;
    if (pMatch.matchedPerson) {
      const idx = this.db.persons.findIndex((p) => p.id === pMatch.matchedPerson!.id);
      const { person: merged } = mergeImportedPersonSafely(
        this.db.persons[idx],
        input.person,
        'Manual CRM Entry',
        now
      );
      this.db.persons[idx] = merged;
      personId = merged.id;
    } else {
      const created = buildPersonRecordFromImport({
        person: input.person,
        filename: 'Manual CRM Entry',
        actorEmail: input.actorEmail,
        now,
      });
      this.db.persons.unshift(created);
      personId = created.id;
    }

    const relType = input.person.relationshipType || 'contact';
    const relIdx = this.db.companyPersonRelationships.findIndex(
      (r) => r.leadId === input.leadId && r.personId === personId && r.relationshipType === relType
    );

    const promoteToPrimary = Boolean(input.person.isPrimaryContact);
    if (promoteToPrimary) {
      for (let i = 0; i < this.db.companyPersonRelationships.length; i++) {
        const cur = this.db.companyPersonRelationships[i];
        if (
          cur.leadId === input.leadId &&
          !(cur.personId === personId && cur.relationshipType === relType) &&
          cur.isPrimaryContact
        ) {
          this.db.companyPersonRelationships[i] = { ...cur, isPrimaryContact: false, updatedAt: now };
        }
      }
    }

    if (relIdx >= 0) {
      const cur = this.db.companyPersonRelationships[relIdx];
      this.db.companyPersonRelationships[relIdx] = {
        ...cur,
        jobTitle: input.person.jobTitle || cur.jobTitle,
        designation: input.person.designation || cur.designation,
        department: input.person.department || cur.department,
        decisionMakerCategory: input.person.decisionMakerCategory || cur.decisionMakerCategory,
        isPrimaryContact: cur.isPrimaryContact || promoteToPrimary,
        updatedAt: now,
      };
    } else {
      const rel = buildRelationshipRecord({
        leadId: input.leadId,
        personId,
        person: input.person,
        filename: input.person.relationshipProvenance?.sourceName || 'Manual CRM Entry',
        rowNumber: 1,
        now,
      });
      rel.sourceName = input.person.relationshipProvenance?.sourceName || 'Owner Manual Entry';
      this.db.companyPersonRelationships.unshift(rel);
    }

    this.saveDatabase(this.db);
    return this.getLeadPersons(input.leadId);
  }

  public linkExistingPersonToLead(input: {
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
  }): LinkedPersonWithRelationship[] {
    if (!this.db.persons) this.db.persons = [];
    if (!this.db.companyPersonRelationships) this.db.companyPersonRelationships = [];
    const person = this.db.persons.find((p) => p.id === input.personId);
    if (!person) {
      throw new Error(`Person "${input.personId}" not found.`);
    }
    const lead = this.db.leads.find((l) => l.id === input.leadId);
    if (!lead) {
      throw new Error(`Company "${input.leadId}" not found.`);
    }
    const now = new Date().toISOString();
    const relType = input.relationshipType || 'contact';

    if (input.isPrimaryContact) {
      for (let i = 0; i < this.db.companyPersonRelationships.length; i++) {
        const cur = this.db.companyPersonRelationships[i];
        if (cur.leadId === input.leadId && cur.isPrimaryContact) {
          this.db.companyPersonRelationships[i] = { ...cur, isPrimaryContact: false, updatedAt: now };
        }
      }
    }

    const existingIdx = this.db.companyPersonRelationships.findIndex(
      (r) => r.leadId === input.leadId && r.personId === input.personId && r.relationshipType === relType
    );

    if (existingIdx >= 0) {
      const cur = this.db.companyPersonRelationships[existingIdx];
      this.db.companyPersonRelationships[existingIdx] = {
        ...cur,
        jobTitle: input.jobTitle ?? cur.jobTitle,
        designation: input.designation ?? cur.designation,
        department: input.department ?? cur.department,
        decisionMakerCategory: input.decisionMakerCategory ?? cur.decisionMakerCategory,
        isPrimaryContact: Boolean(input.isPrimaryContact ?? cur.isPrimaryContact),
        provenance: {
          ...(cur.provenance || {}),
          lastObservedAt: now,
          reviewedByOwner: true,
        },
        updatedAt: now,
      };
    } else {
      this.db.companyPersonRelationships.unshift({
        id: `cpr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        leadId: input.leadId,
        personId: input.personId,
        relationshipType: relType,
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
      });
    }

    this.saveDatabase(this.db);
    return this.getLeadPersons(input.leadId);
  }

  public updatePersonRecord(
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
  ): PersonRecord | null {
    if (!this.db.persons) this.db.persons = [];
    const idx = this.db.persons.findIndex((p) => p.id === personId);
    if (idx < 0) return null;

    const cur = this.db.persons[idx];
    const now = new Date().toISOString();
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
    const nextLinkedin =
      updates.linkedinUrl === null ? undefined : updates.linkedinUrl ?? cur.linkedinUrl;
    const nextSlug = nextLinkedin
      ? nextLinkedin.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]?.toLowerCase()
      : undefined;

    const updated: PersonRecord = {
      ...cur,
      fullName: nextFullName,
      normalizedName: nextFullName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
      email: updates.email === null ? undefined : updates.email ?? cur.email,
      emailStatus:
        updates.email === null
          ? 'unavailable'
          : updates.email
          ? 'syntax_valid'
          : cur.emailStatus,
      phone: updates.phone === null ? undefined : updates.phone ?? cur.phone,
      linkedinUrl: nextLinkedin,
      linkedinSlug: nextSlug ?? cur.linkedinSlug,
      city: updates.city === null ? undefined : updates.city ?? cur.city,
      country: updates.country === null ? undefined : updates.country ?? cur.country,
      countryCode: updates.countryCode === null ? undefined : updates.countryCode ?? cur.countryCode,
      bioSummary: updates.bioSummary === null ? undefined : updates.bioSummary ?? cur.bioSummary,
      officialBioUrl:
        updates.officialBioUrl === null ? undefined : updates.officialBioUrl ?? cur.officialBioUrl,
      seniority: updates.seniority === null ? undefined : updates.seniority ?? cur.seniority,
      decisionMakingFunction:
        updates.decisionMakingFunction === null
          ? undefined
          : updates.decisionMakingFunction ?? cur.decisionMakingFunction,
      verificationStatus: updates.verificationStatus ?? cur.verificationStatus,
      customFields: Object.keys(cf).length > 0 ? cf : undefined,
      updatedAt: now,
    };

    this.db.persons[idx] = updated;
    this.saveDatabase(this.db);
    return updated;
  }

  public updateRelationshipRecord(
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
  ): CompanyPersonRelationship | null {
    if (!this.db.companyPersonRelationships) return null;
    const idx = this.db.companyPersonRelationships.findIndex(
      (r) => r.id === relationshipId && r.leadId === leadId
    );
    if (idx < 0) return null;

    const now = new Date().toISOString();
    const cur = this.db.companyPersonRelationships[idx];
    if (updates.isPrimaryContact) {
      for (let i = 0; i < this.db.companyPersonRelationships.length; i++) {
        const r = this.db.companyPersonRelationships[i];
        if (r.leadId === leadId && r.id !== relationshipId && r.isPrimaryContact) {
          this.db.companyPersonRelationships[i] = { ...r, isPrimaryContact: false, updatedAt: now };
        }
      }
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

    const nextRel: CompanyPersonRelationship = {
      ...cur,
      relationshipType: updates.relationshipType ?? cur.relationshipType,
      jobTitle: updates.jobTitle === null ? undefined : updates.jobTitle ?? cur.jobTitle,
      designation: updates.designation === null ? undefined : updates.designation ?? cur.designation,
      department: updates.department === null ? undefined : updates.department ?? cur.department,
      decisionMakerCategory:
        updates.decisionMakerCategory === null
          ? undefined
          : updates.decisionMakerCategory ?? cur.decisionMakerCategory,
      isPrimaryContact: updates.isPrimaryContact ?? cur.isPrimaryContact,
      provenance: nextProv,
      updatedAt: now,
    };

    this.db.companyPersonRelationships[idx] = nextRel;
    this.saveDatabase(this.db);
    return nextRel;
  }

  public setPrimaryContact(leadId: string, relationshipId: string): LinkedPersonWithRelationship[] {
    if (!this.db.companyPersonRelationships) this.db.companyPersonRelationships = [];
    const targetIdx = this.db.companyPersonRelationships.findIndex(
      (r) => r.id === relationshipId && r.leadId === leadId
    );
    if (targetIdx < 0) {
      throw new Error(`Relationship "${relationshipId}" not found for company "${leadId}".`);
    }
    const now = new Date().toISOString();
    for (let i = 0; i < this.db.companyPersonRelationships.length; i++) {
      const cur = this.db.companyPersonRelationships[i];
      if (cur.leadId !== leadId) continue;
      if (cur.id === relationshipId) {
        this.db.companyPersonRelationships[i] = { ...cur, isPrimaryContact: true, updatedAt: now };
      } else if (cur.isPrimaryContact) {
        this.db.companyPersonRelationships[i] = { ...cur, isPrimaryContact: false, updatedAt: now };
      }
    }
    this.saveDatabase(this.db);
    return this.getLeadPersons(leadId);
  }

  public unlinkPersonFromLead(leadId: string, relationshipId: string): boolean {
    if (!this.db.companyPersonRelationships) return false;
    const prev = this.db.companyPersonRelationships.length;
    this.db.companyPersonRelationships = this.db.companyPersonRelationships.filter(
      (r) => !(r.id === relationshipId && r.leadId === leadId)
    );
    if (this.db.companyPersonRelationships.length !== prev) {
      this.saveDatabase(this.db);
      return true;
    }
    return false;
  }

  public getImportTemplates(): ImportMappingTemplate[] {
    if (!this.db.importMappingTemplates) this.db.importMappingTemplates = [];
    return [...this.db.importMappingTemplates].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  public saveImportTemplate(
    tpl: Omit<ImportMappingTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): ImportMappingTemplate {
    if (!this.db.importMappingTemplates) this.db.importMappingTemplates = [];
    const now = new Date().toISOString();
    const id = tpl.id || `imp-tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const existingIdx = this.db.importMappingTemplates.findIndex((t) => t.id === id);

    const record: ImportMappingTemplate = {
      id,
      name: tpl.name.trim(),
      description: tpl.description?.trim() || undefined,
      sourceFormat: tpl.sourceFormat,
      headerSignature: tpl.headerSignature,
      columnMappings: tpl.columnMappings,
      mergeRules: tpl.mergeRules || [],
      normalizationOptions: tpl.normalizationOptions,
      createdBy: tpl.createdBy || 'Owner',
      createdAt:
        existingIdx >= 0 ? this.db.importMappingTemplates[existingIdx].createdAt : now,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      this.db.importMappingTemplates[existingIdx] = record;
    } else {
      this.db.importMappingTemplates.unshift(record);
    }
    this.saveDatabase(this.db);
    return record;
  }

  public deleteImportTemplate(id: string): boolean {
    if (!this.db.importMappingTemplates) return false;
    const prev = this.db.importMappingTemplates.length;
    this.db.importMappingTemplates = this.db.importMappingTemplates.filter((t) => t.id !== id);
    if (this.db.importMappingTemplates.length !== prev) {
      this.saveDatabase(this.db);
      return true;
    }
    return false;
  }

  public getImportBatches(options: { page?: number; pageSize?: number } = {}): {
    batches: ImportBatchRecord[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } {
    if (!this.db.importBatches) this.db.importBatches = [];
    const sorted = [...this.db.importBatches].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const total = sorted.length;
    const pageSize = Math.max(1, Math.min(100, options.pageSize || 20));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.max(1, Math.min(totalPages, options.page || 1));
    const start = (page - 1) * pageSize;
    return {
      batches: sorted.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  public getImportBatchDetail(
    batchId: string,
    options: { page?: number; pageSize?: number; outcome?: string } = {}
  ): {
    batch: ImportBatchRecord;
    rows: ImportBatchRowRecord[];
    totalRows: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } | null {
    const batch = (this.db.importBatches || []).find((b) => b.id === batchId);
    if (!batch) return null;

    let rows = (this.db.importBatchRows || [])
      .filter((r) => r.batchId === batchId)
      .sort((a, b) => a.rowNumber - b.rowNumber);

    if (options.outcome && options.outcome !== 'all') {
      rows = rows.filter((r) => r.outcome === options.outcome);
    }

    const totalRows = rows.length;
    const pageSize = Math.max(1, Math.min(500, options.pageSize || 50));
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const page = Math.max(1, Math.min(totalPages, options.page || 1));
    const start = (page - 1) * pageSize;

    return {
      batch,
      rows: rows.slice(start, start + pageSize),
      totalRows,
      page,
      pageSize,
      totalPages,
    };
  }

  public async executeImportTransaction(plan: ImportExecutionPlan): Promise<ImportExecutionResult> {
    const startedMs = Date.now();
    const now = new Date().toISOString();

    if (!this.db.persons) this.db.persons = [];
    if (!this.db.companyPersonRelationships) this.db.companyPersonRelationships = [];
    if (!this.db.importBatches) this.db.importBatches = [];
    if (!this.db.importBatchRows) this.db.importBatchRows = [];

    // Full snapshot for atomic rollback safety
    const preTransactionSnapshot = JSON.parse(JSON.stringify(this.db)) as DatabaseSchema;

    const batchRowRecords: ImportBatchRowRecord[] = [];
    const createdLeadByGroupKey = new Map<string, string>();
    const defaultStageId = this.db.stages[0]?.id;

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

    try {
      const seenRowNumbers = new Set<number>();
      for (const r of plan.rows) {
        if (seenRowNumbers.has(r.rowNumber)) {
          throw new Error(
            `Duplicate row_number ${r.rowNumber} detected in import batch "${plan.batchId}". Each row number within a batch must be unique.`
          );
        }
        seenRowNumbers.add(r.rowNumber);
      }

      for (let i = 0; i < plan.rows.length; i++) {
        const row = plan.rows[i];

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

        // Invalid or skipped rows
        if (!row.valid) {
          failedRows++;
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
          if (plan.atomicRollbackOnError) {
            throw new Error(
              `Validation error on row ${row.rowNumber}: ${row.errors.map((e) => e.message).join('; ')}`
            );
          }
          continue;
        }

        if (row.finalAction === 'needs_review') {
          skippedRows++;
          batchRowRecords.push({
            id: `imp-row-${plan.batchId}-${row.rowNumber}`,
            batchId: plan.batchId,
            rowNumber: row.rowNumber,
            dedupeClassification: row.dedupe.classification,
            actionTaken: 'flagged_for_review',
            outcome: row.dedupe.classification === 'conflicting_identity' ? 'conflict' : 'skipped',
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

        if (row.finalAction === 'skip') {
          skippedRows++;
          batchRowRecords.push({
            id: `imp-row-${plan.batchId}-${row.rowNumber}`,
            batchId: plan.batchId,
            rowNumber: row.rowNumber,
            dedupeClassification: row.dedupe.classification,
            actionTaken: 'skipped',
            outcome: 'skipped',
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

        let targetLeadId: string | undefined = row.resolveToLeadId || row.dedupe.matchedCrmLeadId;
        let rowOutcome: ImportBatchRowRecord['outcome'] = 'created';

        // 1. Company creation or safe merge
        if (row.company) {
          const groupKey = row.dedupe.inFileCompanyGroupKey;
          if (!targetLeadId && groupKey && createdLeadByGroupKey.has(groupKey)) {
            targetLeadId = createdLeadByGroupKey.get(groupKey);
            rowOutcome = 'created';
          } else if (row.finalAction === 'update_existing' && targetLeadId) {
            const leadIdx = this.db.leads.findIndex((l) => l.id === targetLeadId);
            if (leadIdx >= 0) {
              const { merged, fieldsEnriched } = safelyMergeImportedCompanyIntoLead({
                existing: this.db.leads[leadIdx],
                imported: row.company,
                filename: plan.filename,
                actorEmail: plan.actorEmail,
                now,
              });
              this.db.leads[leadIdx] = merged;
              if (fieldsEnriched.length > 0) updatedCompanies++;
              rowOutcome = 'updated';
            }
          } else if (row.finalAction === 'create_new') {
            const newLead = buildCanonicalLeadFromImport({
              company: row.company,
              filename: plan.filename,
              pipelineStageId: defaultStageId,
              actorEmail: plan.actorEmail,
              now,
            });
            this.db.leads.unshift(newLead);
            targetLeadId = newLead.id;
            if (groupKey) createdLeadByGroupKey.set(groupKey, newLead.id);
            createdCompanies++;
            rowOutcome = 'created';
          }
        }

        // 2. Person creation / enrichment + M:N Relationship linking
        let persistedPersonId: string | undefined;
        let persistedRelationshipId: string | undefined;

        if (row.person) {
          const pMatch = findMatchingPerson(
            row.person,
            targetLeadId,
            this.db.persons,
            this.db.companyPersonRelationships
          );

          if (pMatch.matchedPerson) {
            const pIdx = this.db.persons.findIndex((p) => p.id === pMatch.matchedPerson!.id);
            if (pIdx >= 0) {
              const { person: mergedPerson, updated } = mergeImportedPersonSafely(
                this.db.persons[pIdx],
                row.person,
                plan.filename,
                now
              );
              this.db.persons[pIdx] = mergedPerson;
              if (updated) updatedPersons++;
              persistedPersonId = mergedPerson.id;
            }
          } else {
            const createdPerson = buildPersonRecordFromImport({
              person: row.person,
              filename: plan.filename,
              actorEmail: plan.actorEmail,
              now,
            });
            this.db.persons.unshift(createdPerson);
            persistedPersonId = createdPerson.id;
            createdPersons++;
          }

          if (targetLeadId && persistedPersonId) {
            const relType = row.person!.relationshipType || 'contact';
            const existingRelIdx = this.db.companyPersonRelationships.findIndex(
              (r) =>
                r.leadId === targetLeadId &&
                r.personId === persistedPersonId &&
                r.relationshipType === relType
            );
            const willBePrimary =
              existingRelIdx >= 0
                ? this.db.companyPersonRelationships[existingRelIdx].isPrimaryContact ||
                  Boolean(row.person.isPrimaryContact)
                : Boolean(row.person.isPrimaryContact);

            if (willBePrimary) {
              for (let rIdx = 0; rIdx < this.db.companyPersonRelationships.length; rIdx++) {
                const curRel = this.db.companyPersonRelationships[rIdx];
                if (
                  curRel.leadId === targetLeadId &&
                  !(curRel.personId === persistedPersonId && curRel.relationshipType === relType) &&
                  curRel.isPrimaryContact
                ) {
                  this.db.companyPersonRelationships[rIdx] = {
                    ...curRel,
                    isPrimaryContact: false,
                    updatedAt: now,
                  };
                }
              }
            }

            if (existingRelIdx >= 0) {
              const cur = this.db.companyPersonRelationships[existingRelIdx];
              const nextRel: CompanyPersonRelationship = {
                ...cur,
                jobTitle: cur.jobTitle || row.person.jobTitle || row.person.relationshipPosition,
                designation: cur.designation || row.person.designation,
                department: cur.department || row.person.department,
                decisionMakerCategory: cur.decisionMakerCategory || row.person.decisionMakerCategory,
                isPrimaryContact: cur.isPrimaryContact || Boolean(row.person.isPrimaryContact),
                updatedAt: now,
              };
              this.db.companyPersonRelationships[existingRelIdx] = nextRel;
              persistedRelationshipId = nextRel.id;
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
              this.db.companyPersonRelationships.unshift(newRel);
              persistedRelationshipId = newRel.id;
              createdRelationships++;
            }
          }
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
      }

      const batchRecord: ImportBatchRecord = {
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
        status: failedRows > 0 ? 'partial_failed' : 'completed',
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
        durationMs: Math.max(1, Date.now() - startedMs),
        actorEmail: plan.actorEmail,
        createdAt: now,
        completedAt: new Date().toISOString(),
      };

      this.db.importBatches.unshift(batchRecord);
      this.db.importBatchRows.push(...batchRowRecords);
      this.saveDatabase(this.db);

      return { batch: batchRecord, rows: batchRowRecords };
    } catch (err: unknown) {
      // Atomic rollback of entire database state
      this.db = preTransactionSnapshot;
      if (!this.db.importBatches) this.db.importBatches = [];
      if (!this.db.importBatchRows) this.db.importBatchRows = [];

      const errMsg = err instanceof Error ? err.message : String(err);
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
        durationMs: Math.max(1, Date.now() - startedMs),
        actorEmail: plan.actorEmail,
        errorMessage: errMsg,
        createdAt: now,
        completedAt: new Date().toISOString(),
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

      this.db.importBatches.unshift(rolledBackBatch);
      this.db.importBatchRows.push(...rolledBackRows);
      this.saveDatabase(this.db);

      return { batch: rolledBackBatch, rows: rolledBackRows };
    }
  }
}

export const storage = new StorageManager();


