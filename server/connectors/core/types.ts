import { CanonicalLead, LeadIdentifier, LeadSource } from '../../types.js';

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

export type ConnectorAuthType =
  | 'none_open'
  | 'api_key'
  | 'environment'
  | 'basic_auth'
  | 'oauth2';

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

export type VerificationStatus =
  | 'officially_verified'
  | 'syntax_validated'
  | 'directory_listed'
  | 'web_observed'
  | 'unverified'
  | 'offline_reference';

export interface CredentialFieldSpec {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface CredentialRequirement {
  authType: ConnectorAuthType;
  required: boolean;
  fields: CredentialFieldSpec[];
  envFallbackKeys: string[];
  setupInstructions: string;
  obtainKeyUrl?: string;
}

export interface RateLimitPolicy {
  maxRequests: number;
  windowMs: number;
  note: string;
  waitOnLimit?: boolean;
}

export interface ExecutionPolicy {
  timeoutMs: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxConcurrency: number;
  rateLimit: RateLimitPolicy;
  defaultPageSize: number;
  maxPageSize: number;
  dedupeWindowMs?: number;
}

export interface ConnectorMetadata {
  id: string;
  name: string;
  shortName: string;
  version: string;
  sourceCategory: SourceCategory;
  accessMode: ConnectorAccessMode;
  description: string;
  supportedCountries: string[];
  supportsAllCountries: boolean;
  supportsRegionFilter: boolean;
  supportsCityFilter: boolean;
  supportedIdentifierTypes: string[];
  capabilities: ConnectorCapability[];
  credentialRequirements: CredentialRequirement;
  executionPolicy: ExecutionPolicy;
  attribution: string;
  license: string;
  homepageUrl?: string;
}

export interface ConnectorSearchRequest {
  query: string;
  countryCode?: string;
  region?: string;
  city?: string;
  page?: number;
  pageSize?: number;
  cursor?: string;
  fetchAllPages?: boolean;
  maxPages?: number;
  filters?: Record<string, string | boolean | number | undefined>;
}

export interface ConnectorLookupRequest {
  externalId: string;
  countryCode?: string;
  url?: string;
  leadId?: string;
}

export interface StandardizedCompanyInfo {
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
  address?: {
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
    countryCode?: string;
  };
  coordinates?: {
    lat: number;
    lon: number;
  };
  industry?: string;
  category?: string;
  employeeRange?: string;
  foundedYear?: number;
  identifiers?: Array<Partial<LeadIdentifier> & { type: string; value: string }>;
  socialLinks?: CanonicalLead['socialLinks'];
  webMetadata?: CanonicalLead['webMetadata'];
  tags?: string[];
  rawSource?: Partial<LeadSource>;
}

export interface StandardizedConnectorResult {
  providerId: string;
  providerName: string;
  sourceCategory: SourceCategory;
  accessMode: ConnectorAccessMode;
  countryCode: string;
  externalSourceId: string;
  company: StandardizedCompanyInfo;
  sourceUrl?: string;
  retrievedAt: string;
  dataFreshness?: {
    lastUpdatedAt?: string;
    freshnessNote?: string;
    isRealtime: boolean;
  };
  verificationStatus: VerificationStatus;
  confidence?: {
    supported: boolean;
    score?: number;
    signals?: string[];
  };
  providerMetadata: Record<string, unknown>;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalItems?: number;
  totalPages?: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface ConnectorSearchResponse {
  results: StandardizedConnectorResult[];
  pagination: PaginationInfo;
  rawCount: number;
  attribution: string;
  notes: string[];
  isLiveApi: boolean;
  providerMetadata?: Record<string, unknown>;
}

export interface ConnectorLookupResponse {
  found: boolean;
  result?: StandardizedConnectorResult;
  attribution: string;
  notes: string[];
  isLiveApi: boolean;
  providerMetadata?: Record<string, unknown>;
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

export interface ClassifiedConnectorError {
  category: ConnectorErrorCategory;
  httpStatus?: number;
  retryable: boolean;
  safeMessage: string;
  remediationHint?: string;
}

export interface ConnectorRuntimeState {
  enabled: boolean;
  credentialStatus: ConnectorCredentialStatus;
  totalCalls: number;
  recentSuccessCount: number;
  recentFailureCount: number;
  consecutiveFailures: number;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastErrorCategory?: ConnectorErrorCategory;
  lastValidation?: {
    ok: boolean;
    checkedAt: string;
    latencyMs?: number;
    message?: string;
    errorCategory?: ConnectorErrorCategory;
  };
  rateLimitState?: {
    remaining: number;
    limit: number;
    windowMs: number;
    resetAt?: string;
  };
}

export interface ConnectorHealthReport {
  connectorId: string;
  healthState: ConnectorHealthState;
  operational: boolean;
  summary: string;
  checkedAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastErrorCategory?: ConnectorErrorCategory;
  rateLimit?: {
    limit: number;
    remaining: number;
    windowMs: number;
    resetAt?: string;
  };
}

export interface ConnectorCredentialStatus {
  connectorId: string;
  authType: ConnectorAuthType;
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

export interface ConnectorExecutionContext {
  requestId: string;
  signal: AbortSignal;
  credentials: Record<string, string>;
  credentialSource: 'environment' | 'database_encrypted' | 'none';
  config: ConnectorConfigRecord;
  userAgent: string;
  timeoutMs: number;
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

export interface IConnector {
  readonly id: string;
  getMetadata(): ConnectorMetadata;
  validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult>;
  search(request: ConnectorSearchRequest, context: ConnectorExecutionContext): Promise<ConnectorSearchResponse>;
  lookupById?(request: ConnectorLookupRequest, context: ConnectorExecutionContext): Promise<ConnectorLookupResponse>;
  normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null;
  classifyError(error: unknown): ClassifiedConnectorError;
  getHealth(state: ConnectorRuntimeState): ConnectorHealthReport;
}
