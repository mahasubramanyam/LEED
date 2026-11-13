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
} from './types.js';
import { dbManager } from './db/pool.js';
import { PostgresStorage } from './db/storagePg.js';
import { migrator } from './db/migrator.js';
import { jsonMigrator, MigrationSummary } from './db/migrateJsonToSql.js';
import { canonicalizeIdentifierType } from '../shared/identifierRegistry.js';
import { normalizeIdentifierValue } from './identifiers/identifierEngine.js';
import { ConnectorConfigRecord, ConnectorRunRecord } from './connectors/core/types.js';
import {
  aggregateRunsByConnector,
  buildUnifiedConnectorStatus,
  connectorRegistry,
  ensureConnectorsRegistered,
} from './connectors/index.js';

interface DatabaseSchema {
  leads: CanonicalLead[];
  stages: PipelineStage[];
  tasks: LeadTask[];
  campaigns: OutreachCampaign[];
  mergeHistory: MergeHistoryRecord[];
  connectors: ConnectorStatus[];
  connectorConfigs?: Record<string, ConnectorConfigRecord>;
  connectorRuns?: ConnectorRunRecord[];
  settings: AppSettings;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'pipeline_store.json');

const DEFAULT_STAGES: PipelineStage[] = [
  { id: 'stage-discovered', name: 'Discovered', color: '#64748b', order: 1 },
  { id: 'stage-qualified', name: 'Qualified', color: '#3b82f6', order: 2 },
  { id: 'stage-pitch-ready', name: 'Outreach Drafted', color: '#8b5cf6', order: 3 },
  { id: 'stage-contacted', name: 'Contacted', color: '#f59e0b', order: 4 },
  { id: 'stage-meeting', name: 'Meeting Scheduled', color: '#06b6d4', order: 5 },
  { id: 'stage-proposal', name: 'Proposal / Review', color: '#ec4899', order: 6 },
  { id: 'stage-won', name: 'Closed Won', color: '#10b981', order: 7 },
  { id: 'stage-lost', name: 'Closed Lost', color: '#ef4444', order: 8 },
];

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

class StorageManager {
  private db: DatabaseSchema;

  constructor() {
    this.ensureDataDir();
    this.db = this.loadDatabase();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadDatabase(): DatabaseSchema {
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(raw);
      } catch (e) {
        console.error('Failed to read pipeline_store.json, creating fallback', e);
      }
    }

    const initialDb: DatabaseSchema = {
      leads: INITIAL_LEADS,
      stages: DEFAULT_STAGES,
      tasks: INITIAL_TASKS,
      campaigns: INITIAL_CAMPAIGNS,
      mergeHistory: [],
      connectors: DEFAULT_CONNECTORS,
      settings: DEFAULT_SETTINGS,
    };

    this.saveDatabase(initialDb);
    return initialDb;
  }

  private saveDatabase(data: DatabaseSchema) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to write pipeline_store.json', e);
    }
  }

  public getLeads(): CanonicalLead[] {
    return this.db.leads;
  }

  public getLead(id: string): CanonicalLead | undefined {
    return this.db.leads.find((l) => l.id === id);
  }

  public upsertLead(lead: CanonicalLead): CanonicalLead {
    const normalizedLead: CanonicalLead = {
      ...lead,
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
  ): { added: number; updated: number; skipped: number } {
    let added = 0;
    let updated = 0;
    let skipped = 0;
    const now = new Date().toISOString();

    for (const rawLead of newLeads) {
      const lead: CanonicalLead = {
        ...rawLead,
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

      const cleanReg = lead.registrationNumber ? normalizeIdentifierValue(lead.registrationNumber) : '';
      const pDigits = (lead.phoneNormalized || lead.phone || '').replace(/[^0-9]/g, '');

      const idx = this.db.leads.findIndex((existing) => {
        if (existing.id === lead.id) return true;
        if (lead.domain && existing.domain && existing.domain.toLowerCase() === lead.domain.toLowerCase()) return true;
        if (cleanReg.length >= 4 && existing.registrationNumber && normalizeIdentifierValue(existing.registrationNumber) === cleanReg) return true;
        if (lead.identifiers && existing.identifiers) {
          for (const idA of lead.identifiers) {
            const normA = normalizeIdentifierValue(idA.normalizedValue || idA.value);
            if (normA.length < 4) continue;
            for (const idB of existing.identifiers) {
              const normB = normalizeIdentifierValue(idB.normalizedValue || idB.value);
              const tB = canonicalizeIdentifierType(idB.type, idB.countryCode || existing.address?.countryCode);
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
        const mergedIdentsMap = new Map<string, any>();
        for (const i of existing.identifiers || []) {
          mergedIdentsMap.set(`${canonicalizeIdentifierType(i.type)}:${normalizeIdentifierValue(i.normalizedValue || i.value)}`, i);
        }
        for (const i of lead.identifiers || []) {
          const k = `${canonicalizeIdentifierType(i.type)}:${normalizeIdentifierValue(i.normalizedValue || i.value)}`;
          if (!mergedIdentsMap.has(k)) mergedIdentsMap.set(k, i);
        }
        this.db.leads[idx] = {
          ...existing,
          ...lead,
          id: existing.id,
          createdAt: existing.createdAt,
          phoneNormalized: lead.phoneNormalized || existing.phoneNormalized,
          identifiers: Array.from(mergedIdentsMap.values()),
          tags: Array.from(new Set([...(existing.tags || []), ...(lead.tags || [])])),
          updatedAt: now,
        };
        updated++;
      } else {
        this.db.leads.unshift(lead);
        added++;
      }
    }
    this.saveDatabase(this.db);
    return { added, updated, skipped };
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
    return this.db.connectorConfigs || this.db.settings?.connectorConfigs || {};
  }

  public updateConnectorConfig(
    connectorId: string,
    partial: Partial<ConnectorConfigRecord>
  ): ConnectorConfigRecord {
    ensureConnectorsRegistered();
    const meta = connectorRegistry.getById(connectorId)?.getMetadata();
    const currentConfigs = this.getConnectorConfigs();
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

    this.db.connectorConfigs = {
      ...currentConfigs,
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

  public async runSchemaMigrations() {
    return migrator.runMigrations();
  }

  public async runJsonMigration(dryRun = false): Promise<MigrationSummary> {
    return jsonMigrator.migrate({ dryRun });
  }
}

export const storage = new StorageManager();

