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

export interface NumverifyApiResponse {
  valid?: boolean;
  number?: string;
  local_format?: string;
  international_format?: string;
  country_prefix?: string;
  country_code?: string;
  country_name?: string;
  location?: string;
  carrier?: string;
  line_type?: 'landline' | 'mobile' | 'special_services' | 'toll_free' | 'premium_rate' | string | null;
  error?: { code?: number; type?: string; info?: string };
}

const APILAYER_NUMVERIFY_ENDPOINT = 'https://api.apilayer.com/number_verification/validate';

const NUMVERIFY_METADATA: ConnectorMetadata = {
  id: 'conn-numverify-phone',
  name: 'APILayer Numverify International Phone API',
  shortName: 'Numverify Phone',
  version: '1.0.0',
  sourceCategory: 'enrichment_verification',
  accessMode: 'live_api',
  description:
    'Authorized international phone validation API providing country, carrier, location, and line-type classification (landline, mobile, toll_free, special_services) over HTTPS with header authentication.',
  supportedCountries: ['GLOBAL'],
  supportsAllCountries: true,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportedIdentifierTypes: ['PHONE'],
  capabilities: ['contact_enrichment', 'identifier_validation', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'APILayer / Numverify API Key',
        required: true,
        secret: true,
        placeholder: 'apilayer_key...',
        helpText: 'Sent in HTTPS apikey header (never query string). Stored encrypted in the Credential Vault.',
      },
    ],
    envFallbackKeys: ['NUMVERIFY_API_KEY', 'APILAYER_NUMVERIFY_KEY'],
    setupInstructions:
      'Subscribe to Number Verification API on APILayer Marketplace and save your API key in the LEED Credential Vault.',
    obtainKeyUrl: 'https://apilayer.com/marketplace/number_verification-api',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 1,
    baseBackoffMs: 1000,
    maxBackoffMs: 4000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 20,
      windowMs: 60000,
      note: 'APILayer Number Verification monthly quota & plan rate limits apply',
      waitOnLimit: false,
    },
    defaultPageSize: 1,
    maxPageSize: 1,
    dedupeWindowMs: 5000,
  },
  attribution: 'APILayer Numverify Number Verification API',
  license: 'APILayer Commercial API Terms of Service',
  homepageUrl: 'https://apilayer.com/marketplace/number_verification-api',
};

export class NumverifyPhoneConnector implements IConnector {
  public readonly id = 'conn-numverify-phone';

  constructor(
    private readonly fetchFnOverride?: typeof fetch,
    private readonly dnsLookupOverride?: DnsLookupAllFn
  ) {}

  public getMetadata(): ConnectorMetadata {
    return NUMVERIFY_METADATA;
  }

  private requireApiKey(context: ConnectorExecutionContext): string {
    const key = (context.credentials.apiKey || context.credentials.token || '').trim();
    if (!key) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        retryable: false,
        message: 'Numverify / APILayer API key is not configured in the Credential Vault.',
        remediationHint: 'Add an authorized APILayer Number Verification API key in Owner Control Centre > Credentials.',
      });
    }
    return key;
  }

  public async verifyPhoneNumber(
    e164OrDigits: string,
    context: ConnectorExecutionContext
  ): Promise<NumverifyApiResponse> {
    const apiKey = this.requireApiKey(context);
    const digits = (e164OrDigits || '').replace(/[^0-9]/g, '');
    if (digits.length < 6 || digits.length > 15) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        retryable: false,
        message: 'A valid international telephone number (6–15 digits) is required for Numverify verification.',
      });
    }

    const url = `${APILAYER_NUMVERIFY_ENDPOINT}?number=${encodeURIComponent(digits)}`;
    const res = await executeRegistryJsonRequest<NumverifyApiResponse>({
      providerId: this.id,
      url,
      method: 'GET',
      headers: {
        apikey: apiKey,
      },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs || 9000,
      knownSecrets: [apiKey],
      fetchFn: this.fetchFnOverride,
      dnsLookupAll: this.dnsLookupOverride,
    });

    if (res.data?.error) {
      throw new ConnectorError({
        category: res.data.error.code === 101 ? 'authentication_failure' : 'unknown_provider_error',
        providerId: this.id,
        retryable: false,
        message: res.data.error.info || 'Numverify API returned an error.',
      });
    }

    return res.data || {};
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const start = Date.now();
      const data = await this.verifyPhoneNumber('442079460958', context);
      const valid = typeof data.valid === 'boolean';
      return {
        ok: valid,
        healthState: valid ? 'operational' : 'degraded',
        latencyMs: Date.now() - start,
        isLiveApi: true,
        message: 'APILayer Numverify Phone Validation API credentials verified.',
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
      message: 'Numverify connector is dedicated to phone number verification, not company search.',
    });
  }

  public async lookup(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const data = await this.verifyPhoneNumber(request.externalId, context);
    return {
      found: Boolean(data.valid),
      attribution: NUMVERIFY_METADATA.attribution,
      notes: [`Numverify line_type: ${data.line_type || 'unknown'}, carrier: ${data.carrier || 'unknown'}`],
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
