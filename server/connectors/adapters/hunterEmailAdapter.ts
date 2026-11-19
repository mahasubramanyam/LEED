import {
  ClassifiedConnectorError,
  ConnectionValidationResult,
  ConnectorExecutionContext,
  ConnectorHealthReport,
  ConnectorLookupRequest,
  ConnectorLookupResponse,
  ConnectorMetadata,
  ConnectorRuntimeState,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
  StandardizedConnectorResult,
} from '../core/types.js';
import { ConnectorError, classifyConnectorError } from '../core/errors.js';
import { connectorRegistry } from '../core/registry.js';
import { executeRegistryJsonRequest } from '../core/registryHttp.js';
import type { DnsLookupAllFn } from '../../security/ssrf.js';

export interface HunterEmailVerifyApiResponse {
  data?: {
    status?: 'valid' | 'invalid' | 'accept_all' | 'webmail' | 'disposable' | 'unknown';
    result?: 'deliverable' | 'undeliverable' | 'risky';
    score?: number;
    email?: string;
    regexp?: boolean;
    gibberish?: boolean;
    disposable?: boolean;
    webmail?: boolean;
    mx_records?: boolean;
    smtp_server?: boolean;
    smtp_check?: boolean;
    accept_all?: boolean;
    block?: boolean;
    sources?: Array<{ domain?: string; uri?: string; extracted_on?: string; still_on_page?: boolean }>;
  };
  errors?: Array<{ id?: string; code?: number; details?: string }>;
}

const HUNTER_VERIFY_ENDPOINT = 'https://api.hunter.io/v2/email-verifier';
const HUNTER_ACCOUNT_ENDPOINT = 'https://api.hunter.io/v2/account';

const HUNTER_METADATA: ConnectorMetadata = {
  id: 'conn-hunter-email',
  name: 'Hunter.io Email Verification API',
  shortName: 'Hunter Email',
  version: '1.0.0',
  sourceCategory: 'enrichment_verification',
  accessMode: 'live_api',
  description:
    'Authorized commercial B2B email verification provider checking syntax, MX, SMTP server availability, catch-all (accept_all), disposable, webmail, and deliverability status. Requires an owner Hunter.io API key.',
  supportedCountries: ['GLOBAL'],
  supportsAllCountries: true,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportedIdentifierTypes: ['EMAIL'],
  capabilities: ['contact_enrichment', 'identifier_validation', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'Hunter.io API Key',
        required: true,
        secret: true,
        placeholder: 'hunter_api_key...',
        helpText: 'Stored encrypted in the LEED Credential Vault (AES-256-GCM). Never exposed to frontend.',
      },
    ],
    envFallbackKeys: ['HUNTER_API_KEY'],
    setupInstructions:
      'Generate an API key in your Hunter.io dashboard (API section) and save it in the LEED Credential Vault.',
    obtainKeyUrl: 'https://hunter.io/api-documentation/v2#email-verifier',
  },
  executionPolicy: {
    timeoutMs: 10000,
    maxRetries: 1,
    baseBackoffMs: 1000,
    maxBackoffMs: 4000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 10,
      windowMs: 60000,
      note: 'Hunter.io API limits: 10 requests/second and 300 requests/minute (plan credit limits apply)',
      waitOnLimit: false,
    },
    defaultPageSize: 1,
    maxPageSize: 1,
    dedupeWindowMs: 5000,
  },
  attribution: 'Hunter.io Email Verification API v2',
  license: 'Hunter.io Commercial API Terms of Service',
  homepageUrl: 'https://hunter.io/api-documentation/v2',
};

export class HunterEmailConnector implements IConnector {
  public readonly id = 'conn-hunter-email';

  constructor(
    private readonly fetchFnOverride?: typeof fetch,
    private readonly dnsLookupOverride?: DnsLookupAllFn
  ) {}

  public getMetadata(): ConnectorMetadata {
    return HUNTER_METADATA;
  }

  private requireApiKey(context: ConnectorExecutionContext): string {
    const key = (context.credentials.apiKey || context.credentials.token || '').trim();
    if (!key) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        retryable: false,
        message: 'Hunter.io API key is not configured in the Credential Vault.',
        remediationHint: 'Add an authorized Hunter.io API key in Owner Control Centre > Credentials.',
      });
    }
    return key;
  }

  public async verifyEmailAddress(
    email: string,
    context: ConnectorExecutionContext
  ): Promise<NonNullable<HunterEmailVerifyApiResponse['data']>> {
    const apiKey = this.requireApiKey(context);
    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'A valid email address string is required for Hunter.io email verification.',
      });
    }

    const url = `${HUNTER_VERIFY_ENDPOINT}?email=${encodeURIComponent(trimmed)}&api_key=${encodeURIComponent(apiKey)}`;
    const res = await executeRegistryJsonRequest<HunterEmailVerifyApiResponse>({
      providerId: this.id,
      url,
      method: 'GET',
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs || 10000,
      knownSecrets: [apiKey],
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    if (!res.data?.data) {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        retryable: false,
        message: 'Hunter.io API returned an unexpected payload without verification data.',
      });
    }

    return res.data.data;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const apiKey = this.requireApiKey(context);
      const url = `${HUNTER_ACCOUNT_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}`;
      const res = await executeRegistryJsonRequest<Record<string, unknown>>({
        providerId: this.id,
        url,
        method: 'GET',
        userAgent: context.userAgent,
        timeoutMs: Math.min(context.timeoutMs || 8000, 8000),
        knownSecrets: [apiKey],
        fetchFn: this.fetchFnOverride,
        dnsLookupAll: this.dnsLookupOverride,
      });
      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: 'Hunter.io Email Verification API credentials verified.',
        checkedAt,
      };
    } catch (err: unknown) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState:
          classified.category === 'missing_credentials' ||
          classified.category === 'authentication_failure' ||
          classified.category === 'authorization_failure'
            ? 'authentication_required'
            : classified.category === 'rate_limited'
            ? 'rate_limited'
            : 'temporarily_unavailable',
        latencyMs: 0,
        isLiveApi: true,
        errorCategory: classified.category,
        message: classified.safeMessage,
        checkedAt,
      };
    }
  }

  public async search(
    _request: ConnectorSearchRequest,
    _context: ConnectorExecutionContext
  ): Promise<ConnectorSearchResponse> {
    throw new ConnectorError({
      category: 'unsupported_capability',
      providerId: this.id,
      retryable: false,
      message: 'Hunter Email connector is dedicated to email verification, not company search.',
    });
  }

  public async lookup(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const data = await this.verifyEmailAddress(request.externalId, context);
    return {
      found: true,
      attribution: HUNTER_METADATA.attribution,
      notes: [`Hunter verification status: ${data.status || 'unknown'} (result: ${data.result || 'unknown'})`],
      isLiveApi: true,
      providerMetadata: data as Record<string, unknown>,
    };
  }

  public normalizeResult(_raw: unknown, _retrievedAt: string): StandardizedConnectorResult | null {
    return null;
  }

  public classifyError(error: unknown): ClassifiedConnectorError {
    return classifyConnectorError(error, this.id);
  }

  public getHealth(runtimeState: ConnectorRuntimeState): ConnectorHealthReport {
    return connectorRegistry.computeHealthReport(this, runtimeState);
  }
}
