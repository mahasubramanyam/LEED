export type AttributeProvenanceType =
  | 'official_registry'
  | 'authorized_verification_provider'
  | 'official_website'
  | 'authorized_provider'
  | 'business_directory'
  | 'search_provider'
  | 'ai_extracted'
  | 'inferred'
  | 'owner_manual'
  | 'not_verified';

export interface AttributeProvenanceEntry {
  attribute: string;
  value?: string;
  sourceType: AttributeProvenanceType;
  sourceName: string;
  sourceUrl?: string;
  retrievedAt: string;
  connectorId?: string;
  method?: string;
}

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
  description?: string;
  dueDate: string;
  reminderDate?: string;
  priority: 'low' | 'medium' | 'high';
  category?:
    | 'follow_up'
    | 'call'
    | 'meeting'
    | 'proposal'
    | 'verification'
    | 'research'
    | 'relationship_review'
    | 'other';
  status?: 'pending' | 'in_progress' | 'waiting' | 'completed' | 'cancelled';
  completed: boolean;
  completedAt?: string;
  notes?: string;
  outcome?: string;
  recurrence?: {
    frequency: 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
    intervalDays?: number;
    endDate?: string;
  };
  assignedTo: string;
  leadId: string;
  personId?: string;
  opportunityId?: string;
  createdAt: string;
  updatedAt?: string;
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
    aboutPageUrl?: string;
    productsPageUrl?: string;
    contactPageUrl?: string;
    locationsPageUrl?: string;
    imprintPageUrl?: string;
    pagesVisited?: string[];
    productsServices?: string[];
    locationsServed?: string[];
    operatingInfo?: string;
    addressesFound?: string[];
    phonesFound?: string[];
    emailsFound?: string[];
    canonicalDomain?: string;
    redirectChain?: string[];
    companyIdentityConsistent?: boolean;
    careersPageUrl?: string;
    certificationsFound?: string[];
    industriesServed?: string[];
    businessSizeIndicators?: string[];
    tradeActivitySignals?: string[];
    attributeProvenance?: Record<string, AttributeProvenanceEntry>;
  };
  status: LeadStatus;
  pipelineStageId?: string;
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
  reverificationPolicy?: ReverificationSchedulePolicy;
}

export interface DiscoverySearchRequest {
  query?: string;
  queries?: string[];
  keywords?: string[];
  countryCode?: string;
  countryCodes?: string[];
  region?: string;
  city?: string;
  postalCode?: string;
  industry?: string;
  category?: string;
  productsServices?: string;
  businessType?: string;
  companySize?: string;
  website?: string;
  domain?: string;
  language?: string;
  limit?: number;
  radiusKm?: number;
  coordinates?: {
    lat: number;
    lon: number;
  };
  connectorId?: string;
  connectorIds?: string[];
  sourceCategories?: SourceCategory[];
  verificationFilter?: 'all' | 'officially_verified' | 'official_website' | 'directory_listed' | 'search_engine';
  selectionMode?: 'auto' | 'manual';
  autoSave?: boolean;
  duplicatePolicy?: 'skip' | 'merge_preserve_crm';
  page?: number;
  pageSize?: number;
  fetchAllPages?: boolean;
  maxPages?: number;
  requestId?: string;
}

export interface DiscoveryDuplicateInfo {
  status: 'unique' | 'existing_crm' | 'ambiguous_crm' | 'cross_source_match';
  classification: 'none' | 'exact' | 'ambiguous';
  requiresReview: boolean;
  matchedLeadId?: string;
  matchedLeadName?: string;
  matchType?: 'domain' | 'registration_number' | 'phone' | 'address' | 'fuzzy_name';
  matchedValue?: string;
  similarityScore?: number;
  crossSourceLeadIds?: string[];
  note?: string;
}

export interface DiscoveryConnectorSummary {
  connectorId: string;
  connectorName: string;
  shortName: string;
  sourceCategory: SourceCategory;
  accessMode: ConnectorAccessMode;
  isLiveApi: boolean;
  countryCode?: string;
  query: string;
  status: 'success' | 'error' | 'skipped' | 'cancelled';
  recordsDiscovered: number;
  recordsNormalized: number;
  durationMs: number;
  runId?: string;
  attribution?: string;
  errorCategory?: ConnectorErrorCategory;
  message?: string;
  notes?: string[];
}

export interface DiscoveryPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasMore: boolean;
}

export interface DiscoverySearchResponse {
  searchId: string;
  requestId: string;
  leads: CanonicalLead[];
  duplicateInfoByLeadId: Record<string, DiscoveryDuplicateInfo>;
  totalDiscovered: number;
  totalUnique: number;
  existingCrmMatches: number;
  ambiguousMatches: number;
  crossSourceCorroborations: number;
  pagination: DiscoveryPagination;
  connectorSummaries: DiscoveryConnectorSummary[];
  selectedConnectorIds: string[];
  runId?: string;
  errors?: string[];
  errorDetails?: Array<{ connectorId: string; category: string; message: string }>;
  attribution: string;
  providerNote: string;
  abnLookupInfo?: {
    isLiveApi: boolean;
    lookupMode: string;
    isChecksumValid?: boolean;
  };
  appliedFilters: {
    query: string;
    queries?: string[];
    keywords?: string[];
    countryCode?: string;
    countryCodes?: string[];
    region?: string;
    city?: string;
    postalCode?: string;
    industry?: string;
    category?: string;
    productsServices?: string;
    businessType?: string;
    companySize?: string;
    website?: string;
    domain?: string;
    language?: string;
    sourceCategories?: SourceCategory[];
    verificationFilter?: string;
    radiusKm?: number;
    coordinates?: { lat: number; lon: number };
    regionSupportedByConnector: boolean;
  };
  coalesced?: boolean;
  cancelled?: boolean;
  durationMs: number;
}

export interface DiscoveryHistoryItem {
  id: string;
  connectorId: string;
  connectorName: string;
  operation: string;
  queryParams?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: 'success' | 'error' | 'cancelled' | 'partial';
  recordsDiscovered: number;
  recordsNormalized: number;
  errorCategory?: string;
  diagnosticSummary?: string;
  requestId?: string;
}

export interface BatchUpsertResult {
  added: number;
  updated: number;
  skipped: number;
  failed?: number;
  errors?: Array<{ row: number; companyName?: string; error: string }>;
  warnings?: string[];
  savedLeadIds?: string[];
}

export type SevenStateRegistryStatus =
  | 'live_and_operational'
  | 'live_auth_required'
  | 'configuration_required'
  | 'offline_reference_only'
  | 'public_access_unavailable'
  | 'not_implemented'
  | 'temporarily_unavailable';

export interface RegistryAuditCriteria {
  officialApiExists: boolean;
  officialApiSummary: string;
  publicAccessPermitted: boolean;
  publicAccessSummary: string;
  authenticationAndCredentials: string;
  documentationUrl: string;
  accessRestrictions: string;
  availableBusinessFields: string[];
  searchAndVerificationCapabilities: string[];
  rateLimitsAndPagination: string;
  commercialUseAndRedistribution: string;
}

export type RegistryVerificationState =
  | 'officially_verified'
  | 'probable_match'
  | 'conflict_detected'
  | 'not_found'
  | 'offline_reference'
  | 'unavailable';

export type RegistryMatchType =
  | 'exact_official_identifier'
  | 'exact_name_jurisdiction'
  | 'probable_name_address'
  | 'conflict'
  | 'none';

export interface VerificationConflict {
  field: 'registrationNumber' | 'legalName' | 'companyStatus' | 'address' | 'countryCode';
  severity: 'high' | 'medium' | 'low';
  crmValue: string;
  officialValue: string;
  message: string;
}

export interface VerificationHistoryEntry {
  verifiedAt: string;
  connectorId: string;
  sourceName: string;
  sourceUrl?: string;
  state: RegistryVerificationState;
  matchType: RegistryMatchType;
  matchedRegistrationNumber?: string;
  matchedLegalName?: string;
  matchedCompanyStatus?: string;
  isLiveApi: boolean;
  conflictCount: number;
  summary: string;
}

export interface AttributeSourceProvenance {
  connectorId: string;
  sourceName: string;
  retrievedAt: string;
  verified: boolean;
}

export interface RegistryVerificationReport {
  leadId: string;
  state: RegistryVerificationState;
  matchType: RegistryMatchType;
  confidence: number;
  isLiveApi: boolean;
  authRequired?: boolean;
  connectorId?: string;
  sourceName: string;
  sourceUrl?: string;
  verifiedAt: string;
  matchedRecord?: CanonicalLead;
  conflicts: VerificationConflict[];
  nameSimilarity: number;
  addressSimilarity: number;
  identifierMatched: boolean;
  preservesHigherTrust: boolean;
  summary: string;
  notes: string[];
  attemptedConnectors?: string[];
  attributeSources?: Record<string, AttributeSourceProvenance>;
  provenance?: {
    queryMode: 'exact_identifier_lookup' | 'name_search';
    fallbackUsed?: boolean;
    queriedIdentifier?: string;
    queriedIdentifierType?: string;
    rawApiRecord?: unknown;
    providerMetadata?: Record<string, unknown>;
    retrievedAt?: string;
  };
}

// ============================================================================
// PHASE 7: PERSONS, RELATIONSHIPS & LEAD IMPORT ENGINE TYPES
// ============================================================================

export type EmploymentStatus = 'current' | 'historical' | 'unknown';

export type RelationshipType =
  | 'founder'
  | 'co_founder'
  | 'owner'
  | 'director'
  | 'managing_director'
  | 'ceo'
  | 'president'
  | 'chairman'
  | 'board_member'
  | 'cfo'
  | 'coo'
  | 'cto'
  | 'cio'
  | 'chro'
  | 'cmo'
  | 'executive'
  | 'officer'
  | 'procurement_manager'
  | 'chief_procurement_officer'
  | 'purchasing_manager'
  | 'sourcing_manager'
  | 'supply_chain_director'
  | 'procurement_contact'
  | 'sales_director'
  | 'business_development_director'
  | 'business_development_manager'
  | 'partnership_manager'
  | 'commercial_director'
  | 'sales_contact'
  | 'department_head'
  | 'operations_manager'
  | 'finance_manager'
  | 'hr_manager'
  | 'technical_director'
  | 'employee'
  | 'advisor'
  | 'contact';

export type ImportVerificationStatus =
  | 'user_provided'
  | 'syntax_validated'
  | 'officially_verified'
  | 'directory_listed'
  | 'web_observed'
  | 'unverified';

export type PersonVerificationTier =
  | 'officially_verified'
  | 'company_website'
  | 'authorized_provider'
  | 'directory_listed'
  | 'search_result'
  | 'verified_professional'
  | 'official_registry'
  | 'official_company_published'
  | 'ai_extracted'
  | 'inferred'
  | 'unknown'
  | 'user_provided'
  | 'syntax_validated';

export interface RelationshipProvenanceMeta {
  filename?: string;
  rowNumber?: number;
  importedAt?: string;
  sourceUrl?: string;
  sourceName?: string;
  sourceType?: AttributeProvenanceType;
  connectorId?: string;
  verificationTier?: PersonVerificationTier;
  isExplicitlyPublished?: boolean;
  employmentStatus?: EmploymentStatus;
  firstObservedAt?: string;
  lastObservedAt?: string;
  endedAt?: string;
  appointedAt?: string;
  uncertainMatch?: boolean;
  uncertainReason?: string;
  aiRelevanceNote?: string;
  outdatedRiskNote?: string;
  reviewedByOwner?: boolean;
  reviewedAt?: string;
  [key: string]: unknown;
}

export interface PersonRecord {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  normalizedName: string;
  email?: string;
  emailStatus: 'verified' | 'syntax_valid' | 'unverified' | 'unavailable';
  phone?: string;
  phoneNormalized?: string;
  linkedinUrl?: string;
  linkedinSlug?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  sources: LeadSource[];
  confidenceScore: number;
  verificationStatus: ImportVerificationStatus;
  customFields?: Record<string, string>;
  attributeProvenance?: Record<string, AttributeProvenanceEntry>;
  bioSummary?: string;
  officialBioUrl?: string;
  seniority?: string;
  decisionMakingFunction?: string;
  possibleDuplicateIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CompanyPersonRelationship {
  id: string;
  leadId: string;
  personId: string;
  relationshipType: RelationshipType | string;
  jobTitle?: string;
  designation?: string;
  department?: string;
  decisionMakerCategory?: string;
  isPrimaryContact: boolean;
  sourceName: string;
  provenance?: RelationshipProvenanceMeta;
  confidenceScore: number;
  verificationStatus: ImportVerificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedPersonWithRelationship {
  person: PersonRecord;
  relationship: CompanyPersonRelationship;
  otherCompanies?: Array<{
    leadId: string;
    companyName: string;
    relationshipType: string;
    jobTitle?: string;
    employmentStatus?: EmploymentStatus;
  }>;
}

export interface DecisionMakerCandidateSource {
  sourceName: string;
  sourceType: AttributeProvenanceType;
  sourceUrl?: string;
  connectorId?: string;
  retrievedAt: string;
}

export interface DecisionMakerCandidate {
  candidateId: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  normalizedName: string;
  jobTitle?: string;
  designation?: string;
  department?: string;
  relationshipType: RelationshipType | string;
  decisionMakerCategory?: string;
  roleCategory?: string;
  seniority?: string;
  decisionMakingFunction?: string;
  email?: string;
  emailStatus: 'verified' | 'syntax_valid' | 'unverified' | 'unavailable';
  phone?: string;
  profileUrl?: string;
  linkedinUrl?: string;
  officialBioUrl?: string;
  location?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  companyName?: string;
  companyDomain?: string;
  employmentStatus: EmploymentStatus;
  appointedAt?: string;
  endedAt?: string;
  firstObservedAt?: string;
  lastObservedAt?: string;
  verificationTier: PersonVerificationTier;
  confidenceScore: number;
  isExplicitlyPublished: boolean;
  sources: DecisionMakerCandidateSource[];
  provenanceNotes: string[];
  bioSummary?: string;
  relevanceExplanation?: string;
  outdatedSignalNote?: string;
  matchedCrmPersonId?: string;
  matchedRelationshipId?: string;
  uncertainMatch?: boolean;
  uncertainMatchReasons?: string[];
  attributeProvenance: Record<string, AttributeProvenanceEntry>;
}

export interface DecisionMakerDiscoveryRequest {
  leadId?: string;
  companyName: string;
  legalName?: string;
  website?: string;
  domain?: string;
  countryCode?: string;
  registrationNumber?: string;
  registrationType?: string;
  industry?: string;
  businessType?: string;
  targetJobTitle?: string;
  targetDepartment?: string;
  targetRelationshipType?: string;
  targetSeniority?: string;
  targetDecisionFunction?: string;
  includeHistorical?: boolean;
  runWebsiteInspection?: boolean;
  runAiAnalysis?: boolean;
  sourceIds?: string[];
  connectorIds?: string[];
  limit?: number;
}

export interface DecisionMakerSourceSummary {
  sourceId: string;
  connectorId?: string;
  sourceName: string;
  status: 'success' | 'no_results' | 'skipped_missing_credentials' | 'skipped_not_applicable' | 'skipped' | 'error';
  candidatesFound: number;
  durationMs?: number;
  message?: string;
}

export interface DecisionMakerDiscoveryResponse {
  companyName: string;
  leadId?: string;
  candidates: DecisionMakerCandidate[];
  sourceSummaries: DecisionMakerSourceSummary[];
  aiQueryPlan?: {
    suggestedQueries: string[];
    targetTitles: string[];
    rationale: string;
    provenanceType: 'inferred';
    engine: string;
  };
  honestStatusNote: string;
  durationMs: number;
}

export type ImportCanonicalField =
  | 'ignore'
  // Company fields
  | 'companyName'
  | 'legalName'
  | 'tradingName'
  | 'website'
  | 'domain'
  | 'industry'
  | 'category'
  | 'description'
  | 'country'
  | 'countryCode'
  | 'region'
  | 'city'
  | 'postalCode'
  | 'street'
  | 'registrationNumber'
  | 'registrationType'
  | 'vatNumber'
  | 'leiNumber'
  | 'companyStatus'
  | 'annualRevenue'
  | 'employeeCount'
  | 'employeeRange'
  | 'foundedYear'
  | 'currency'
  | 'opportunityValue'
  | 'phone'
  | 'email'
  | 'linkedinCompanyUrl'
  | 'tags'
  // Person / Decision-maker fields
  | 'personFirstName'
  | 'personLastName'
  | 'personFullName'
  | 'personJobTitle'
  | 'personDesignation'
  | 'personRole'
  | 'personDepartment'
  | 'personEmail'
  | 'personPhone'
  | 'personLinkedInUrl'
  | 'personCountry'
  | 'personCity'
  // Relationship fields
  | 'associatedCompanyName'
  | 'associatedCompanyRegNumber'
  | 'relationshipType'
  | 'relationshipPosition'
  | 'decisionMakerCategory'
  | 'isPrimaryContact'
  // Phase 13: Optional CRM relationship & interaction import fields
  | 'relationshipStatus'
  | 'relationshipNotes'
  | 'nextFollowUpDate'
  | 'lastInteractionDate'
  | 'lastInteractionType'
  | 'lastInteractionSummary';

export type ImportTargetField = ImportCanonicalField | `customField:${string}`;

export interface ColumnMappingRule {
  sourceColumnIndex: number;
  sourceHeader: string;
  targetField: ImportTargetField;
  confidence?: number;
  autoDetected?: boolean;
  ambiguousReason?: string;
}

export interface MultiColumnMergeRule {
  id: string;
  targetField: ImportCanonicalField | `customField:${string}`;
  sourceColumnIndexes: number[];
  separator?: string;
}

export interface MappingAmbiguityWarning {
  sourceColumnIndex: number;
  sourceHeader: string;
  suggestedTarget: ImportTargetField;
  candidateTargets: ImportTargetField[];
  reason: string;
  severity: 'high' | 'medium';
}

export interface ImportNormalizationOptions {
  defaultCountryCode?: string;
  dateLocale?: 'ISO' | 'US' | 'EU' | 'UK';
  numberLocale?: 'en-US' | 'de-DE' | 'fr-FR';
  duplicatePolicy: 'merge_safe' | 'skip_existing' | 'create_if_new_only';
  preserveExistingCrmFields: boolean;
  atomicRollbackOnError: boolean;
  skipRowsWithErrors: boolean;
}

export interface ImportMappingTemplate {
  id: string;
  name: string;
  description?: string;
  sourceFormat: 'csv' | 'xlsx';
  headerSignature: string[];
  columnMappings: Array<{
    sourceHeader: string;
    targetField: ImportTargetField;
  }>;
  mergeRules: MultiColumnMergeRule[];
  normalizationOptions: ImportNormalizationOptions;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImportValidationIssue {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
  rawValue?: string;
}

export type ImportDedupeClassification =
  | 'new_record'
  | 'exact_crm_duplicate'
  | 'possible_duplicate'
  | 'conflicting_identity'
  | 'existing_with_new_info';

export type ImportRowDecisionAction =
  | 'create_new'
  | 'update_existing'
  | 'link_person_only'
  | 'skip'
  | 'needs_review';

export interface ImportDedupeResult {
  classification: ImportDedupeClassification;
  recommendedAction: ImportRowDecisionAction;
  inFileDuplicateOfRow?: number;
  inFileCompanyGroupKey?: string;
  matchedCrmLeadId?: string;
  matchedCrmLeadName?: string;
  matchedCrmField?: string;
  matchedCrmValue?: string;
  similarityScore?: number;
  conflictDetails?: string[];
  newInfoFields?: string[];
  matchedPersonId?: string;
  matchedPersonName?: string;
  matchedPersonBy?: 'email' | 'linkedin' | 'phone' | 'name_company';
  matchedRelationshipId?: string;
}

export interface NormalizedImportCompany {
  companyName?: string;
  legalName?: string;
  tradingName?: string;
  registrationNumber?: string;
  registrationType?: string;
  companyStatus?: 'active' | 'inactive' | 'dissolved' | 'unknown';
  website?: string;
  domain?: string;
  email?: string;
  emailStatus?: 'verified' | 'syntax_valid' | 'unverified' | 'unavailable';
  phone?: string;
  phoneNormalized?: string;
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country: string;
  countryCode: string;
  formattedAddress?: string;
  industry?: string;
  category?: string;
  description?: string;
  annualRevenueRaw?: string;
  annualRevenueNumeric?: number;
  employeeCountRaw?: string;
  employeeRange?: string;
  foundedYear?: number;
  currency: string;
  opportunityValue?: number;
  linkedinCompanyUrl?: string;
  tags: string[];
  identifiers: LeadIdentifier[];
  customFields: Record<string, string>;
}

export interface NormalizedImportPerson {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  normalizedName?: string;
  email?: string;
  emailStatus?: 'verified' | 'syntax_valid' | 'unverified' | 'unavailable';
  phone?: string;
  phoneNormalized?: string;
  linkedinUrl?: string;
  linkedinSlug?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  jobTitle?: string;
  designation?: string;
  department?: string;
  relationshipType: string;
  relationshipPosition?: string;
  decisionMakerCategory?: string;
  isPrimaryContact: boolean;
  associatedCompanyName?: string;
  associatedCompanyRegNumber?: string;
  bioSummary?: string;
  officialBioUrl?: string;
  seniority?: string;
  decisionMakingFunction?: string;
  verificationStatus?: ImportVerificationStatus;
  confidenceScore?: number;
  attributeProvenance?: Record<string, AttributeProvenanceEntry>;
  sources?: LeadSource[];
  relationshipProvenance?: RelationshipProvenanceMeta;
  customFields: Record<string, string>;
}

export interface ImportPreviewRow {
  rowNumber: number;
  importKind: 'company_only' | 'person_only' | 'company_and_person' | 'empty';
  rawData: Record<string, string>;
  company?: NormalizedImportCompany;
  person?: NormalizedImportPerson;
  errors: ImportValidationIssue[];
  warnings: ImportValidationIssue[];
  valid: boolean;
  dedupe: ImportDedupeResult;
  proposedAction: ImportRowDecisionAction;
  changesSummary: string[];
}

export interface ImportWorksheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface ParsedImportFileSummary {
  filename: string;
  format: 'csv' | 'xlsx';
  fileSizeBytes: number;
  fileSha256: string;
  encodingDetected: string;
  delimiterDetected?: string;
  worksheets: ImportWorksheetInfo[];
  selectedWorksheet?: string;
  headers: string[];
  totalRows: number;
  truncated?: boolean;
  warnings: string[];
}

export interface ImportBatchRecord {
  id: string;
  filename: string;
  fileFormat: 'csv' | 'xlsx';
  fileSizeBytes: number;
  fileSha256?: string;
  worksheetName?: string;
  encodingDetected?: string;
  templateId?: string;
  templateName?: string;
  duplicatePolicy: string;
  status: 'completed' | 'partial_failed' | 'failed' | 'rolled_back';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdCompanies: number;
  updatedCompanies: number;
  createdPersons: number;
  updatedPersons: number;
  createdRelationships: number;
  updatedRelationships: number;
  skippedRows: number;
  duplicateRows: number;
  conflictRows: number;
  failedRows: number;
  durationMs: number;
  actorEmail: string;
  summaryMetadata?: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ImportBatchRowRecord {
  id: string;
  batchId: string;
  rowNumber: number;
  dedupeClassification: ImportDedupeClassification | string;
  actionTaken: string;
  outcome: 'created' | 'updated' | 'skipped' | 'failed' | 'conflict' | 'rolled_back';
  companyName?: string;
  personName?: string;
  matchedLeadId?: string;
  persistedLeadId?: string;
  persistedPersonId?: string;
  persistedRelationshipId?: string;
  rawData: Record<string, string>;
  normalizedData: Record<string, unknown>;
  errors: ImportValidationIssue[];
  warnings: ImportValidationIssue[];
  createdAt: string;
}

// ============================================================================
// PHASE 12 — Lead Enrichment, Contact Verification & Data Quality Intelligence
// ============================================================================

export type EnrichmentProviderStatus =
  | 'operational'
  | 'operational_with_credentials'
  | 'missing_credentials'
  | 'restricted'
  | 'unavailable'
  | 'retired'
  | 'not_implemented'
  | 'error';

export type SourceReliabilityTier =
  | 'authoritative_registry'
  | 'official_company_source'
  | 'authorized_verification_api'
  | 'authorized_commercial_api'
  | 'open_public_directory'
  | 'web_search_index'
  | 'ai_assistance_only'
  | 'restricted_or_unavailable';

export interface EnrichmentProviderCatalogEntry {
  providerId: string;
  connectorId?: string;
  name: string;
  category:
    | 'company_registry'
    | 'website_domain'
    | 'email_verification'
    | 'phone_verification'
    | 'b2b_people_enrichment'
    | 'web_search'
    | 'directory_reference'
    | 'ai_assistance';
  enrichmentCapabilities: string[];
  supportedCountries: string[];
  dataCategories: string[];
  apiAvailability: string;
  endpointDoc?: string;
  credentialRequirements: string;
  credentialStatus: 'none_required' | 'configured' | 'missing' | 'not_applicable';
  operationalStatus: EnrichmentProviderStatus;
  rateLimits: string;
  costLimitations: string;
  commercialUsagePermitted: boolean;
  lastSuccessfulExecution?: string;
  lastFailure?: string;
  lastErrorMessage?: string;
  verificationCapability: boolean;
  reliabilityClassification: SourceReliabilityTier;
  honestLimitationNote: string;
}

export interface EmailVerificationResult {
  email: string;
  normalizedEmail: string;
  domain: string;
  syntaxValid: boolean;
  domainValid: boolean;
  mxRecordsPresent: boolean;
  mxHosts: string[];
  spfPresent: boolean;
  dmarcPresent: boolean;
  mailConfigVerified: boolean;
  isFreePersonalWebmail: boolean;
  isDisposable: boolean;
  isRoleBased: boolean;
  isCatchAll: boolean | null;
  status:
    | 'provider_deliverable'
    | 'provider_risky'
    | 'catch_all'
    | 'disposable'
    | 'role_based'
    | 'undeliverable'
    | 'mail_config_verified'
    | 'mx_present'
    | 'domain_valid'
    | 'syntax_valid'
    | 'invalid_syntax'
    | 'personal_webmail_rejected'
    | 'stale'
    | 'verification_failed'
    | 'unknown';
  crmEmailStatus: 'verified' | 'syntax_valid' | 'unverified' | 'unavailable';
  providerUsed?: string;
  providerStatus?: string;
  providerScore?: number;
  deliverabilityClaimed: boolean;
  honestSummary: string;
  warnings: string[];
  verifiedAt: string;
  sourceName: string;
  sourceType: AttributeProvenanceType;
}

export type PhoneLineType =
  | 'landline'
  | 'mobile'
  | 'voip'
  | 'toll_free'
  | 'special_services'
  | 'unknown';

export interface PhoneVerificationResult {
  rawPhone: string;
  e164: string;
  internationalFormatted: string;
  nationalFormatted: string;
  countryCode: string;
  callingCode: string;
  syntaxValid: boolean;
  status:
    | 'provider_verified'
    | 'e164_valid'
    | 'format_valid_unverified'
    | 'invalid_format'
    | 'conflicting'
    | 'stale'
    | 'verification_failed'
    | 'unknown';
  lineType: PhoneLineType;
  lineTypeBasis: 'provider_verified' | 'heuristic' | 'unknown';
  businessClassification: 'likely_business' | 'likely_personal' | 'shared_or_unknown';
  carrier?: string;
  location?: string;
  providerUsed?: string;
  personAssociationVerified: boolean;
  honestSummary: string;
  warnings: string[];
  verifiedAt: string;
  sourceName: string;
  sourceType: AttributeProvenanceType;
}

export interface DataQualityFactor {
  dimension: 'completeness' | 'verification' | 'freshness' | 'consistency';
  impact: 'positive' | 'negative' | 'warning';
  points: number;
  label: string;
  detail: string;
}

export interface StaleAttributeIndicator {
  attribute: string;
  label: string;
  lastVerifiedAt?: string;
  ageDays: number | null;
  maxAgeDays: number;
  status: 'aging' | 'stale' | 'never_verified';
}

export interface DataQualityScoreBreakdown {
  entityType: 'company' | 'person';
  entityId: string;
  completenessScore: number;
  verificationScore: number;
  freshnessScore: number;
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  verificationCapApplied: boolean;
  verificationCapReason?: string;
  missingCriticalFields: string[];
  staleAttributes: StaleAttributeIndicator[];
  conflictingAttributes: string[];
  duplicateRisk: 'none' | 'possible' | 'high';
  relationshipConfidence?: number;
  reverificationEligible: boolean;
  factors: DataQualityFactor[];
  evaluatedAt: string;
}

export interface EnrichmentFieldProposal {
  field: string;
  label: string;
  currentValue?: string;
  proposedValue: string;
  currentSourceType?: AttributeProvenanceType;
  currentSourceName?: string;
  currentLastVerifiedAt?: string;
  proposedSourceType: AttributeProvenanceType;
  proposedSourceName: string;
  proposedSourceUrl?: string;
  proposedConnectorId?: string;
  verificationLabel:
    | 'officially_verified'
    | 'multi_source_verified'
    | 'source_reported'
    | 'ai_extracted'
    | 'inferred'
    | 'unknown'
    | 'conflicting'
    | 'outdated';
  confidenceScore: number;
  actionRecommendation: 'fill_missing' | 'upgrade_stronger_source' | 'refresh_stale' | 'conflict_review' | 'keep_existing_stronger';
  defaultSelected: boolean;
  isConflict: boolean;
  precedenceNote: string;
  corroboratingSources: string[];
  retrievedAt: string;
}

export interface EnrichmentConflictRecord {
  id: string;
  field: string;
  label: string;
  existingValue: string;
  existingSourceName: string;
  existingSourceType: AttributeProvenanceType;
  existingPrecedenceScore: number;
  incomingValue: string;
  incomingSourceName: string;
  incomingSourceType: AttributeProvenanceType;
  incomingPrecedenceScore: number;
  recommendedWinner: 'existing' | 'incoming' | 'owner_review';
  rationale: string;
  detectedAt: string;
  status: 'open' | 'kept_existing' | 'accepted_incoming';
}

export interface EnrichmentHistoryEntry {
  id: string;
  timestamp: string;
  actor: string;
  entityType: 'company' | 'person';
  action: 'enrichment_applied' | 'verification_attempt_failed' | 'contact_verified' | 'conflict_resolved';
  providersExecuted: string[];
  fieldsUpdated: Array<{
    field: string;
    previousValue?: string;
    previousSource?: string;
    newValue: string;
    newSource: string;
    verificationLabel: string;
  }>;
  failedVerifications?: Array<{
    provider: string;
    attribute?: string;
    reason: string;
    existingDataPreserved: boolean;
  }>;
  conflictsResolved?: number;
  qualityScoreBefore?: number;
  qualityScoreAfter?: number;
}

export interface EnrichmentProviderRunSummary {
  providerId: string;
  providerName: string;
  status: 'success' | 'no_results' | 'skipped_missing_credentials' | 'skipped_not_applicable' | 'rate_limited' | 'timeout' | 'error';
  durationMs: number;
  attributesContributed: string[];
  message: string;
}

export interface CompanyEnrichmentPreviewResponse {
  leadId?: string;
  companyName: string;
  proposals: EnrichmentFieldProposal[];
  conflicts: EnrichmentConflictRecord[];
  emailVerification?: EmailVerificationResult;
  phoneVerification?: PhoneVerificationResult;
  websiteSummary?: {
    url: string;
    isOnline: boolean;
    canonicalDomain?: string;
    redirectChain?: string[];
    companyIdentityConsistent?: boolean;
    certificationsFound?: string[];
    industriesServed?: string[];
    businessSizeIndicators?: string[];
    tradeActivitySignals?: string[];
    careersPageUrl?: string;
    leadershipCount: number;
  };
  providerRuns: EnrichmentProviderRunSummary[];
  failedVerifications: Array<{ provider: string; reason: string; existingDataPreserved: boolean }>;
  qualityBefore: DataQualityScoreBreakdown;
  qualityProjectedAfter: DataQualityScoreBreakdown;
  aiAssistance?: {
    summary: string;
    missingDataRecommendations: string[];
    suggestedProviders: string[];
    conflictNotes: string[];
    qualityExplanation: string;
    provenanceType: 'ai_extracted' | 'inferred';
    engine: string;
  };
  requiresOwnerApproval: true;
  generatedAt: string;
  durationMs: number;
}

export interface PersonEnrichmentPreviewResponse {
  personId: string;
  fullName: string;
  leadId?: string;
  companyName?: string;
  proposals: EnrichmentFieldProposal[];
  conflicts: EnrichmentConflictRecord[];
  emailVerification?: EmailVerificationResult;
  phoneVerification?: PhoneVerificationResult;
  providerRuns: EnrichmentProviderRunSummary[];
  failedVerifications: Array<{ provider: string; reason: string; existingDataPreserved: boolean }>;
  qualityBefore: DataQualityScoreBreakdown;
  qualityProjectedAfter: DataQualityScoreBreakdown;
  requiresOwnerApproval: true;
  generatedAt: string;
  durationMs: number;
}

export interface ReverificationSchedulePolicy {
  enabled: boolean;
  emailMaxAgeDays: number;
  phoneMaxAgeDays: number;
  jobTitleMaxAgeDays: number;
  companyStatusMaxAgeDays: number;
  websiteMaxAgeDays: number;
  legalRegistryMaxAgeDays: number;
  maxBatchSize: number;
  updatedAt: string;
}

// ============================================================================
// PHASE 13: PERSONAL CRM & RELATIONSHIP MANAGEMENT TYPES
// ============================================================================

export type CrmInteractionType =
  | 'phone_call'
  | 'meeting'
  | 'video_meeting'
  | 'email'
  | 'linkedin'
  | 'whatsapp'
  | 'introduction'
  | 'referral'
  | 'business_discussion'
  | 'negotiation'
  | 'note'
  | 'custom';

export interface CrmAttachmentMetadata {
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  referenceUrl?: string;
  note?: string;
}

export interface CrmInteraction {
  id: string;
  leadId?: string;
  personId?: string;
  opportunityId?: string;
  type: CrmInteractionType;
  customTypeLabel?: string;
  occurredAt: string;
  summary: string;
  detailedNotes?: string;
  outcome?: string;
  nextAction?: string;
  followUpDate?: string;
  attachments?: CrmAttachmentMetadata[];
  /** Explicitly documents that Phase 13 records are manually entered by the owner, never auto-sent/received */
  recordingMode: 'manual';
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type CrmNoteCategory =
  | 'general'
  | 'relationship'
  | 'meeting_prep'
  | 'negotiation'
  | 'follow_up'
  | 'personal_context'
  | 'risk_flag';

export interface CrmPrivateNote {
  id: string;
  entityType: 'company' | 'person' | 'interaction' | 'opportunity' | 'follow_up';
  leadId?: string;
  personId?: string;
  interactionId?: string;
  opportunityId?: string;
  title?: string;
  content: string;
  category: CrmNoteCategory;
  tags: string[];
  pinned: boolean;
  visibility: 'owner_only';
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityStageChange {
  id: string;
  fromStageId?: string;
  fromStageName?: string;
  toStageId: string;
  toStageName: string;
  changedAt: string;
  changedBy: string;
  reason?: string;
}

export interface CrmOpportunity {
  id: string;
  leadId: string;
  personId?: string;
  title: string;
  description?: string;
  estimatedValue: number;
  currency: string;
  expectedCloseDate?: string;
  pipelineStageId: string;
  probability: number; // 0-100
  source?: string;
  nextAction?: string;
  nextActionDate?: string;
  notes?: string;
  status: 'open' | 'won' | 'lost' | 'on_hold';
  winLossReason?: string;
  stageHistory: OpportunityStageChange[];
  createdAt: string;
  updatedAt: string;
}

export type CrmRelationshipStatus =
  | 'new'
  | 'active'
  | 'warm'
  | 'nurturing'
  | 'needs_attention'
  | 'dormant'
  | 'archived';

export interface RelationshipMetadata {
  relationshipStatus: CrmRelationshipStatus;
  nextFollowUpDate?: string;
  scheduledReviewDate?: string;
  tags: string[];
  ownerOverrideLevel?: 'strong' | 'active' | 'developing' | 'cooling' | 'inactive';
  ownerAnnotation?: string;
  updatedAt?: string;
}

export interface RelationshipEngagementFactor {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface RelationshipEngagementAssessment {
  score: number; // 0-100
  level: 'strong' | 'active' | 'developing' | 'cooling' | 'inactive';
  effectiveLevel: 'strong' | 'active' | 'developing' | 'cooling' | 'inactive';
  /** Explicitly derived/inferred from actual CRM records, NEVER presented as verified fact */
  isDerived: true;
  basis: 'derived_from_crm_activity';
  transparencyLabel: string;
  ownerOverrideLevel?: 'strong' | 'active' | 'developing' | 'cooling' | 'inactive';
  ownerAnnotation?: string;
  factors: RelationshipEngagementFactor[];
  metrics: {
    totalInteractions: number;
    interactionsLast30Days: number;
    interactionsLast90Days: number;
    daysSinceLastInteraction: number | null;
    completedTasksCount: number;
    overdueTasksCount: number;
    openOpportunitiesCount: number;
    relationshipAgeDays: number;
  };
  evaluatedAt: string;
}

export interface CompanyRelationshipProfile {
  lead: CanonicalLead;
  relationshipMeta: RelationshipMetadata;
  engagement: RelationshipEngagementAssessment;
  decisionMakers: LinkedPersonWithRelationship[];
  interactions: CrmInteraction[];
  privateNotes: CrmPrivateNote[];
  tasks: LeadTask[];
  opportunities: CrmOpportunity[];
  lastInteractionAt?: string;
  nextPlannedInteractionAt?: string;
  nextPlannedSummary?: string;
  enrichmentSummary: {
    confidenceScore: number;
    registryVerificationState: string;
    lastVerifiedAt?: string;
    dataQualityScore?: number;
    dataQualityGrade?: string;
  };
}

export interface PersonRelationshipProfile {
  person: PersonRecord;
  relationshipMeta: RelationshipMetadata;
  engagement: RelationshipEngagementAssessment;
  currentCompanies: Array<{
    relationship: CompanyPersonRelationship;
    company?: Pick<CanonicalLead, 'id' | 'companyName' | 'industry' | 'website' | 'address' | 'pipelineStageId' | 'companyStatus'>;
  }>;
  historicalCompanies: Array<{
    relationship: CompanyPersonRelationship;
    company?: Pick<CanonicalLead, 'id' | 'companyName' | 'industry' | 'website' | 'address' | 'pipelineStageId' | 'companyStatus'>;
  }>;
  interactions: CrmInteraction[];
  privateNotes: CrmPrivateNote[];
  tasks: LeadTask[];
  opportunities: CrmOpportunity[];
  lastContactDate?: string;
  nextFollowUpDate?: string;
  nextPlannedSummary?: string;
}

export interface CrmSavedView {
  id: string;
  name: string;
  entityType: 'company' | 'person';
  description?: string;
  filters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CrmReminderItem {
  id: string;
  kind:
    | 'overdue_task'
    | 'today_task'
    | 'upcoming_task'
    | 'interaction_follow_up'
    | 'upcoming_meeting'
    | 'relationship_review'
    | 'needs_attention';
  severity: 'urgent' | 'high' | 'medium' | 'info';
  title: string;
  detail: string;
  dueAt?: string;
  leadId?: string;
  companyName?: string;
  personId?: string;
  personName?: string;
  taskId?: string;
  interactionId?: string;
  opportunityId?: string;
}

export interface CrmReminderCenterResponse {
  generatedAt: string;
  counts: {
    total: number;
    overdueTasks: number;
    todayFollowUps: number;
    upcomingMeetings: number;
    relationshipReviews: number;
    needsAttention: number;
  };
  reminders: CrmReminderItem[];
  schedulerStatus: {
    backgroundDaemonActive: false;
    automatedNotificationsConfigured: false;
    deliveryMode: 'in_app_on_demand';
    honestNote: string;
  };
}

export interface CrmDashboardSummary {
  generatedAt: string;
  metrics: {
    totalCompanies: number;
    totalDecisionMakers: number;
    activeRelationships: number;
    newRelationships30d: number;
    recentInteractions30d: number;
    todaysFollowUps: number;
    overdueFollowUps: number;
    upcomingMeetings7d: number;
    activeOpportunities: number;
    expectedOpportunityValueByCurrency: Array<{ currency: string; totalValue: number; weightedValue: number; count: number }>;
    relationshipsNeedingAttentionCount: number;
  };
  opportunitiesByStage: Array<{
    stageId: string;
    stageName: string;
    stageColor: string;
    count: number;
    totalValue: number;
    currencySummary: string;
  }>;
  recentInteractions: Array<CrmInteraction & { companyName?: string; personName?: string }>;
  todaysFollowUpTasks: Array<LeadTask & { companyName?: string; personName?: string }>;
  overdueFollowUpTasks: Array<LeadTask & { companyName?: string; personName?: string }>;
  upcomingMeetings: Array<{
    id: string;
    source: 'task' | 'interaction';
    title: string;
    scheduledAt: string;
    leadId?: string;
    companyName?: string;
    personId?: string;
    personName?: string;
  }>;
  recentlyUpdatedCompanies: Array<{
    id: string;
    companyName: string;
    industry: string;
    country?: string;
    relationshipStatus: CrmRelationshipStatus;
    updatedAt: string;
    lastInteractionAt?: string;
  }>;
  recentlyContactedPeople: Array<{
    id: string;
    fullName: string;
    jobTitle?: string;
    companyName?: string;
    leadId?: string;
    lastContactDate: string;
    lastInteractionType?: CrmInteractionType;
  }>;
  relationshipsNeedingAttention: Array<{
    entityType: 'company' | 'person';
    id: string;
    name: string;
    subtitle?: string;
    reason: string;
    daysSinceLastInteraction: number | null;
    overdueTasksCount: number;
    relationshipStatus: CrmRelationshipStatus;
  }>;
  reminderCounts: CrmReminderCenterResponse['counts'];
}

export interface CrmCompanySearchFilter {
  search?: string;
  countryCode?: string;
  industry?: string;
  businessType?: string;
  companyStatus?: string;
  pipelineStageId?: string;
  relationshipStatus?: CrmRelationshipStatus | 'all';
  minQualityScore?: number;
  qualityGrade?: 'A' | 'B' | 'C' | 'D' | 'F' | 'all';
  lastInteractionWithinDays?: number;
  noInteractionForDays?: number;
  followUpDue?: 'all' | 'overdue' | 'today' | 'upcoming' | 'has_date';
  tags?: string[];
}

export interface CrmPersonSearchFilter {
  search?: string;
  leadId?: string;
  roleCategory?: string;
  department?: string;
  seniority?: string;
  country?: string;
  verificationStatus?: string;
  employmentStatus?: 'current' | 'former' | 'all';
  relationshipStatus?: CrmRelationshipStatus | 'all';
  lastInteractionWithinDays?: number;
  noInteractionForDays?: number;
  followUpDue?: 'all' | 'overdue' | 'today' | 'upcoming' | 'has_date';
  tags?: string[];
}



