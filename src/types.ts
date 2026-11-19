export type AttributeProvenanceType =
  | 'official_registry'
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

export interface CountrySourceCapability {
  id: string;
  countryCode: string;
  countryName: string;
  flag: string;
  providerName: string;
  sourceType: string;
  integrationStatus: string;
  registryState?: SevenStateRegistryStatus;
  connectorId?: string;
  authRequirement: string;
  sourceUrl: string;
  lastCheckedAt?: string;
  lastVerifiedAt?: string;
  notes: string;
  licensingInfo: string;
  coverageFeatures: string[];
  auditDetails?: RegistryAuditCriteria;
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
    attributeProvenance?: Record<string, AttributeProvenanceEntry>;
  };
  status: LeadStatus;
  pipelineStageId?: string;
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

export type SourceCategory =
  | 'government_registry'
  | 'business_directory'
  | 'search_engine'
  | 'maps_geo'
  | 'social_platform'
  | 'website_intelligence'
  | 'enrichment_verification'
  | 'ai_engine';

export type ConnectorAccessMode =
  | 'live_api'
  | 'offline_reference'
  | 'public_directory'
  | 'manual_portal'
  | 'internal_crawler'
  | 'ai_inference';

export type ConnectorCapability =
  | 'company_search'
  | 'registry_lookup'
  | 'identifier_validation'
  | 'poi_search'
  | 'website_inspection'
  | 'contact_enrichment'
  | 'ai_analysis'
  | 'pagination'
  | 'connection_test';

export type ConnectorHealthState =
  | 'operational'
  | 'degraded'
  | 'authentication_required'
  | 'configuration_required'
  | 'rate_limited'
  | 'temporarily_unavailable'
  | 'disabled'
  | 'not_tested';

export type ConnectorErrorCategory =
  | 'authentication_failure'
  | 'authorization_failure'
  | 'rate_limited'
  | 'timeout'
  | 'network_failure'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'invalid_request'
  | 'unsupported_country'
  | 'unsupported_capability'
  | 'missing_credentials'
  | 'configuration_error'
  | 'unknown_provider_error';

export interface CredentialFieldSpec {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface CredentialRequirement {
  authType: 'none_open' | 'api_key' | 'environment' | 'basic_auth' | 'oauth2';
  required: boolean;
  fields: CredentialFieldSpec[];
  envFallbackKeys: string[];
  setupInstructions: string;
  obtainKeyUrl?: string;
}

export interface ConnectorCredentialStatus {
  connectorId: string;
  authType: 'none_open' | 'api_key' | 'environment' | 'basic_auth' | 'oauth2';
  required: boolean;
  configured: boolean;
  source: 'environment' | 'database_encrypted' | 'none_required' | 'missing';
  maskedHint?: string;
  encryptionKeyConfigured: boolean;
  encryptionRequirement?: string;
  rotatedAt?: string;
  validatedAt?: string;
  validationStatus?: string;
}

export interface ConnectorConfigRecord {
  connectorId: string;
  enabled: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  customConfig?: Record<string, unknown>;
  updatedAt?: string;
}

export interface ConnectorRunRecord {
  id: string;
  connectorId: string;
  operation: 'search' | 'lookup' | 'health_check' | 'enrich' | 'ai_inference';
  queryParams?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: 'success' | 'error' | 'cancelled' | 'partial';
  recordsDiscovered: number;
  recordsNormalized: number;
  recordsRejected: number;
  errorCategory?: ConnectorErrorCategory;
  diagnosticSummary?: string;
  rateLimitRemaining?: number;
  rateLimitResetAt?: string;
  requestId?: string;
}

export interface ConnectionValidationResult {
  ok: boolean;
  healthState: ConnectorHealthState;
  latencyMs: number;
  isLiveApi: boolean;
  errorCategory?: ConnectorErrorCategory;
  message: string;
  checkedAt: string;
  rateLimitRemaining?: number;
  rateLimitResetAt?: string;
}

export interface ConnectorEncryptionStatus {
  configured: boolean;
  source: 'CONNECTOR_ENCRYPTION_KEY' | 'APP_ENCRYPTION_KEY' | 'missing' | 'invalid';
  requirementMessage?: string;
}

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

export interface DuplicateMatch {
  leadA: CanonicalLead;
  leadB: CanonicalLead;
  matchType: 'domain' | 'registration_number' | 'phone' | 'address' | 'fuzzy_name';
  matchedValue: string;
  similarityScore: number;
  recommendedSurvivorId: string;
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

export interface SearchDirectoryProviderDoc {
  id: string;
  connectorId?: string;
  name: string;
  category: SourceCategory | 'retired_search_engine';
  availability:
    | 'available_configured'
    | 'available_configuration_required'
    | 'available_open'
    | 'restricted_legacy_sunsetting'
    | 'retired_unavailable';
  officialEndpoint: string;
  documentationUrl: string;
  authentication: string;
  pricingAndQuota: string;
  supportedCountriesAndLanguages: string;
  queryAndPagination: string;
  rateLimits: string;
  commercialUsage: string;
  honestStatusNote: string;
  configuredInVault?: boolean;
  operational?: boolean;
  healthState?: string;
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
  connectorConfigs?: Record<string, ConnectorConfigRecord>;
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
}

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
  relevanceExplanation?: string;
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
  sources?: LeadSource[];
  confidenceScore: number;
  verificationStatus: 'user_provided' | 'syntax_validated' | 'officially_verified' | 'directory_listed' | 'web_observed' | 'unverified';
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
  verificationStatus: 'user_provided' | 'syntax_validated' | 'officially_verified' | 'directory_listed' | 'web_observed' | 'unverified';
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
  relationshipType: string;
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

export interface SocialProviderDoc {
  id: string;
  connectorId?: string;
  name: string;
  officialProvider: string;
  providerType?:
    | 'official_company_pages'
    | 'regulatory_filings'
    | 'public_directory'
    | 'web_search'
    | 'professional_data_provider'
    | 'social_platform'
    | 'retired_search';
  availability: 'operational' | 'credential_dependent' | 'restricted' | 'unavailable';
  apiAvailability: string;
  authentication: string;
  pricingAndRestrictions: string;
  countryCoverage: string;
  searchCapabilities: string;
  dataReturned: string;
  commercialUsage: string;
  honestStatusNote: string;
  configuredInVault?: boolean;
  operational?: boolean;
  healthState?: string;
}

export type ImportTargetField = string;

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
  targetField: ImportTargetField;
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

export interface ImportPreviewRow {
  rowNumber: number;
  importKind: 'company_only' | 'person_only' | 'company_and_person' | 'empty';
  rawData: Record<string, string>;
  company?: {
    companyName?: string;
    legalName?: string;
    registrationNumber?: string;
    registrationType?: string;
    companyStatus?: string;
    website?: string;
    domain?: string;
    email?: string;
    phone?: string;
    phoneNormalized?: string;
    city?: string;
    country?: string;
    countryCode?: string;
    formattedAddress?: string;
    currency?: string;
    opportunityValue?: number;
    industry?: string;
  };
  person?: {
    fullName?: string;
    email?: string;
    phone?: string;
    phoneNormalized?: string;
    linkedinUrl?: string;
    jobTitle?: string;
    designation?: string;
    department?: string;
    relationshipType?: string;
    decisionMakerCategory?: string;
    isPrimaryContact?: boolean;
    associatedCompanyName?: string;
    associatedCompanyRegNumber?: string;
  };
  errors: ImportValidationIssue[];
  warnings: ImportValidationIssue[];
  valid: boolean;
  dedupe: {
    classification: ImportDedupeClassification;
    recommendedAction: ImportRowDecisionAction;
    inFileDuplicateOfRow?: number;
    matchedCrmLeadId?: string;
    matchedCrmLeadName?: string;
    matchedCrmField?: string;
    matchedCrmValue?: string;
    similarityScore?: number;
    conflictDetails?: string[];
    newInfoFields?: string[];
    matchedPersonId?: string;
    matchedPersonName?: string;
    matchedPersonBy?: string;
  };
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
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ImportBatchRowRecord {
  id: string;
  batchId: string;
  rowNumber: number;
  dedupeClassification: string;
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

