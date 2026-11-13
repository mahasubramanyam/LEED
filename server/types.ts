export interface LeadSource {
  sourceName: string;
  providerId?: string;
  url?: string;
  retrievedAt: string;
  license?: string;
  attribution?: string;
}

export interface LeadIdentifier {
  id?: string;
  type: string;
  value: string;
  normalizedValue?: string;
  countryCode?: string;
  issuingAuthority?: string;
  source?: string;
  status?: 'user_provided' | 'discovered' | 'syntax_validated' | 'officially_verified';
  verified: boolean;
  createdAt?: string;
}


export interface LeadNote {
  id: string;
  content: string;
  createdAt: string;
  author: string;
}

export interface LeadTask {
  id: string;
  title: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high';
  completed: boolean;
  assignedTo: string;
  leadId: string;
  createdAt: string;
}

export interface LeadActivity {
  id: string;
  type: 'call' | 'email' | 'meeting' | 'note' | 'enrichment' | 'stage_change' | 'merge';
  title: string;
  notes?: string;
  outcome?: string;
  date: string;
  actor: string;
}

export interface MergeHistoryRecord {
  id: string;
  survivorLeadId: string;
  mergedLeadSnapshot: CanonicalLead;
  mergedAt: string;
  mergedReason: string;
}

export type LeadStatus =
  | 'new'
  | 'reviewed'
  | 'qualified'
  | 'contacted'
  | 'meeting_set'
  | 'negotiation'
  | 'converted'
  | 'lost'
  | 'do_not_contact';

export interface CanonicalLead {
  id: string;
  companyName: string;
  legalName?: string;
  registrationNumber?: string;
  registrationType?: string; // 'UK_CRN' | 'NO_ORG' | 'AU_ABN' | 'FR_SIRENE' etc.
  companyStatus?: 'active' | 'inactive' | 'dissolved' | 'unknown';
  website?: string;
  domain?: string;
  email?: string;
  emailStatus?: 'verified' | 'syntax_valid' | 'unverified' | 'unavailable';
  phone?: string;
  phoneNormalized?: string;
  address?: {
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country: string;
    countryCode: string; // ISO 2-letter
    formattedAddress?: string;
  };
  coordinates?: {
    lat: number;
    lon: number;
  };
  industry: string;
  category: string;
  employeeRange?: string;
  foundedYear?: number;
  confidenceScore: number; // 0-100 calculated from verified facts
  confidenceSignals: string[];
  sources: LeadSource[];
  identifiers: LeadIdentifier[];
  socialLinks?: {
    linkedin?: string;
    facebook?: string;
    instagram?: string;
    twitter?: string;
    youtube?: string;
    github?: string;
  };
  webMetadata?: {
    title?: string;
    description?: string;
    httpStatus?: number;
    isHttps?: boolean;
    serverLatencyMs?: number;
    inspectedAt?: string;
  };
  status: LeadStatus;
  pipelineStageId: string;
  opportunityValue?: number;
  currency: string;
  winProbability?: number; // 0-100
  lostReason?: string;
  tags: string[];
  notes: LeadNote[];
  activities: LeadActivity[];
  customFields?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface OutreachCampaign {
  id: string;
  name: string;
  channel: 'email' | 'linkedin' | 'call';
  subjectTemplate: string;
  bodyTemplate: string;
  targetIndustry?: string;
  targetCountry?: string;
  status: 'draft' | 'scheduled' | 'active' | 'completed' | 'paused';
  createdAt: string;
  messages: CampaignMessage[];
}

export interface CampaignMessage {
  id: string;
  campaignId: string;
  leadId: string;
  leadCompanyName: string;
  recipientEmail?: string;
  subject: string;
  content: string;
  status: 'pending_approval' | 'approved' | 'sent' | 'rejected' | 'opted_out';
  deliveryId?: string;
  scheduledAt?: string;
  sentAt?: string;
}

import type {
  ConnectorAccessMode,
  ConnectorCapability,
  ConnectorConfigRecord,
  ConnectorCredentialStatus,
  ConnectorErrorCategory,
  ConnectorHealthState,
  CredentialRequirement,
  SourceCategory,
} from './connectors/core/types.js';

export interface ConnectorStatus {
  id: string;
  name: string;
  shortName?: string;
  version?: string;
  description?: string;
  category: 'government_registry' | 'maps_geo' | 'web_search' | 'ai_engine' | SourceCategory;
  sourceCategory?: SourceCategory;
  accessMode?: ConnectorAccessMode;
  countryCoverage: string[];
  supportsAllCountries?: boolean;
  supportsRegionFilter?: boolean;
  supportsCityFilter?: boolean;
  supportedIdentifierTypes?: string[];
  capabilities?: ConnectorCapability[];
  status: 'healthy' | 'configured' | 'unconfigured' | 'degraded' | 'rate_limited';
  healthState?: ConnectorHealthState;
  operational?: boolean;
  healthSummary?: string;
  authType: 'none_open' | 'api_key' | 'environment' | 'basic_auth' | 'oauth2';
  isConfigured: boolean;
  credentialRequirements?: CredentialRequirement;
  credentialStatus?: ConnectorCredentialStatus;
  config?: ConnectorConfigRecord;
  rateLimitNote: string;
  rateLimitState?: {
    limit: number;
    remaining: number;
    windowMs: number;
    resetAt?: string;
  };
  attribution: string;
  license?: string;
  homepageUrl?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  totalCalls: number;
  recentSuccessCount?: number;
  recentFailureCount?: number;
  consecutiveFailures?: number;
  lastError?: string;
  lastErrorCategory?: ConnectorErrorCategory;
}

export interface AppSettings {
  ownerName: string;
  ownerEmail: string;
  defaultCountry: string;
  defaultCurrency: string;
  companiesHouseApiKey?: string;
  userAgent: string;
  enableSafeWebsiteCrawl: boolean;
  outreachApprovalRequired: boolean;
  autoDedupeThreshold: number; // 0.85
  suppressionDomains: string[];
  connectorConfigs?: Record<string, ConnectorConfigRecord>;
}
