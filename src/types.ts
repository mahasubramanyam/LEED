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

export interface AdministrativeDivision {
  code: string;
  name: string;
  type: string;
  nativeName?: string;
}

export interface AddressFormatSpec {
  hasRegions: boolean;
  regionLabel: string;
  hasPostalCodes: boolean;
  postalCodeLabel: string;
  postalCodePattern?: string;
  postalCodeExample?: string;
  addressOrder: 'street_first' | 'city_first' | 'postal_first';
}

export interface CountryReference {
  code: string;
  alpha3: string;
  numericCode?: string;
  name: string;
  officialName: string;
  nativeName?: string;
  flag: string;
  callingCode: string;
  currency: string;
  currencySymbol: string;
  timezones: string[];
  languages: string[];
  isSovereignState: boolean;
  unMember: boolean;
  continent: string;
  addressFormat: AddressFormatSpec;
  primaryIdentifierType?: string;
  supportedIdentifierTypes: string[];
  divisions?: AdministrativeDivision[];
}

export interface CityReference {
  id: string;
  name: string;
  countryCode: string;
  divisionCode?: string;
  divisionName?: string;
  population?: number;
  latitude?: number;
  longitude?: number;
}

export interface CountrySourceCapability {
  id: string;
  countryCode: string;
  countryName: string;
  flag: string;
  providerName: string;
  sourceType: string;
  integrationStatus: string;
  authRequirement: string;
  sourceUrl: string;
  lastCheckedAt?: string;
  notes: string;
  licensingInfo: string;
  coverageFeatures: string[];
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
  registrationType?: string;
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
    countryCode: string;
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
  confidenceScore: number;
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
  winProbability?: number;
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
  leadCount?: number;
  totalValue?: number;
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

export interface ConnectorStatus {
  id: string;
  name: string;
  category: 'government_registry' | 'maps_geo' | 'web_search' | 'ai_engine';
  countryCoverage: string[];
  status: 'healthy' | 'configured' | 'unconfigured' | 'degraded' | 'rate_limited';
  authType: 'none_open' | 'api_key' | 'environment';
  isConfigured: boolean;
  rateLimitNote: string;
  attribution: string;
  lastRunAt?: string;
  totalCalls: number;
  lastError?: string;
}

export interface DuplicateMatch {
  leadA: CanonicalLead;
  leadB: CanonicalLead;
  matchType: 'domain' | 'registration_number' | 'phone' | 'fuzzy_name';
  matchedValue: string;
  similarityScore: number;
  recommendedSurvivorId: string;
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
  autoDedupeThreshold: number;
  suppressionDomains: string[];
}

export interface AuditEvent {
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
  note?: string;
}

