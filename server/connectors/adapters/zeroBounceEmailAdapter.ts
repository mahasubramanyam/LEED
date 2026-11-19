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

export interface ZeroBounceValidateApiResponse {
  address?: string;
  status?: 'valid' | 'invalid' | 'catch-all' | 'unknown' | 'spamtrap' | 'abuse' | 'do_not_mail';
  sub_status?: string;
  free_email?: boolean;
  did_you_mean?: string | null;
  account?: string;
  domain?: string;
  mx_found?: string | boolean;
  mx_record?: string;
  smtp_provider?: string;
  processed_at?: string;
  error?: string;
}

const ZEROBOUNCE_VALIDATE_ENDPOINT = 'https://api.zerobounce.net/v2/validate';
const ZEROBOUNCE_CREDITS_ENDPOINT = 'https://api.zerobounce.net/v2/getcredits';

const ZEROBOUNCE_METADATA: ConnectorMetadata = {
  id: 'conn-zerobounce-email',
  name: 'ZeroBounce Email Validation API',
  shortName: 'ZeroBounce',
  version: '1.0.0',
  sourceCategory: 'enrichment_verification',
  accessMode: 'live_api',
  description:
    'Authorized commercial email validation provider detecting valid, invalid, catch-all, disposable, spamtrap, abuse, role-based, and MX status. Requires an owner ZeroBounce API key.',
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
        label: 'ZeroBounce API Key',
        required: true,
        secret: true,
        placeholder: 'zb_api_key...',
        helpText: 'Stored encrypted in the LEED Credential Vault (AES-256-GCM). Never exposed to frontend.',
      },
    ],
    envFallbackKeys: ['ZEROBOUNCE_API_KEY'],
    setupInstructions:
      'Generate an API key from your ZeroBounce account dashboard and save it in the LEED Credential Vault.',
    obtainKeyUrl: 'https://www.zerobounce.net/docs/email-validation-api-quickstart/',
  },
  executionPolicy: {
    timeoutMs: 10000,
    maxRetries: 1,
    baseBackoffMs: 1000,
    maxBackoffMs: 4000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 25,
      windowMs: 60000,
      note: 'ZeroBounce pay-as-you-go credit limits apply per validation call',
      waitOnLimit: false,
    },
    defaultPageSize: 1,
    maxPageSize: 1,
    dedupeWindowMs: 5000,
  },
  attribution: 'ZeroBounce Email Validation API v2',
  license: 'ZeroBounce Commercial API Terms of Service',
  homepageUrl: 'https://www.zerobounce.net/docs/',
};

export class ZeroBounceEmailConnector implements IConnector {
  public readonly id = 'conn-zerobounce-email';

  constructor(
    private readonly fetchFnOverride?: typeof fetch,
    private readonly dnsLookupOverride?: DnsLookupAllFn
  ) {}

  public getMetadata(): ConnectorMetadata {
    return ZEROBOUNCE_METADATA;
  }

  private requireApiKey(context: ConnectorExecutionContext): string {
    const key = (context.credentials.apiKey || context.credentials.token || '').trim();
    if (!key) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        retryable: false,
        message: 'ZeroBounce API key is not configured in the Credential Vault.',
        remediationHint: 'Add an authorized ZeroBounce API key in Owner Control Centre > Credentials.',
      });
    }
    return key;
  }

  public async verifyEmailAddress(
    email: string,
    context: ConnectorExecutionContext
  ): Promise<ZeroBounceValidateApiResponse> {
    const apiKey = this.requireApiKey(context);
    const trimmed = (email || '').trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'A valid email address is required for ZeroBounce validation.',
      });
    }

    const url = `${ZEROBOUNCE_VALIDATE_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(trimmed)}&ip_address=`;
    const res = await executeRegistryJsonRequest<ZeroBounceValidateApiResponse>({
      providerId: this.id,
      url,
      method: 'GET',
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs || 10000,
      knownSecrets: [apiKey],
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    if (res.data?.error) {
      throw new ConnectorError({
        category: res.data.error.toLowerCase().includes('invalid api key')
          ? 'authentication_failure'
          : 'unknown_provider_error',
        providerId: this.id,
        retryable: false,
        message: `ZeroBounce returned error: ${res.data.error}`,
      });
    }

    return res.data || {};
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const apiKey = this.requireApiKey(context);
      const url = `${ZEROBOUNCE_CREDITS_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}`;
      const res = await executeRegistryJsonRequest<{ Credits?: string; error?: string }>({
        providerId: this.id,
        url,
        method: 'GET',
        userAgent: context.userAgent,
        timeoutMs: Math.min(context.timeoutMs || 8000, 8000),
        knownSecrets: [apiKey],
        fetchFn: this.fetchFnOverride,
        dnsLookupAll: this.dnsLookupOverride,
      });
      if (res.data?.error) {
        return {
          ok: false,
          healthState: 'authentication_required',
          latencyMs: res.latencyMs,
          isLiveApi: true,
          errorCategory: 'authentication_failure',
          message: res.data.error,
          checkedAt,
        };
      }
      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: 'ZeroBounce Email Validation API credentials verified.',
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
      message: 'ZeroBounce connector is dedicated to email verification, not company search.',
    });
  }

  public async lookup(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const data = await this.verifyEmailAddress(request.externalId, context);
    return {
      found: true,
      attribution: ZEROBOUNCE_METADATA.attribution,
      notes: [`ZeroBounce status: ${data.status || 'unknown'} (${data.sub_status || 'none'})`],
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
