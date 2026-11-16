import { normalizeIdentifierValue } from '../../identifiers/identifierEngine.js';
import { classifyConnectorError, ConnectorError } from '../core/errors.js';
import { executeRegistryJsonRequest } from '../core/registryHttp.js';
import { connectorRegistry } from '../core/registry.js';
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

export const EU_VIES_MEMBER_COUNTRIES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR',
  'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SE', 'SI', 'SK', 'XI',
];

interface EuViesResponse {
  valid?: boolean;
  requestDate?: string;
  userError?: string;
  name?: string;
  address?: string;
  requestIdentifier?: string;
  vatNumber?: string;
  countryCode?: string;
}

const VIES_CHECK_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
const VIES_STATUS_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-status';

const EU_VIES_METADATA: ConnectorMetadata = {
  id: 'conn-eu-vies',
  name: 'European Commission VIES VAT Registry',
  shortName: 'EU VIES VAT',
  version: '1.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official European Commission VIES (VAT Information Exchange System) REST API verifying EU member-state VAT numbers across BE, DE, DK, ES, FI, FR, IE, IT, NL, PL, SE and all 27 EU member states.',
  supportedCountries: EU_VIES_MEMBER_COUNTRIES,
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['EU_VAT'],
  capabilities: ['registry_lookup', 'identifier_validation', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions: 'Open European Commission VIES REST API. No API key required. Requires a prefixed EU VAT number (e.g. IE6388047V, DE129274202).',
    obtainKeyUrl: 'https://ec.europa.eu/taxation_customs/vies/#/technical-information',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 4000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: 'EU VIES Member-State concurrency throttled; max 30 req/min client-side',
      waitOnLimit: false,
    },
    defaultPageSize: 1,
    maxPageSize: 1,
    dedupeWindowMs: 5000,
  },
  attribution: 'European Commission — VIES VAT Information Exchange System',
  license: 'European Commission Public Official Service',
  homepageUrl: 'https://ec.europa.eu/taxation_customs/vies/',
};

function parseEuVatInput(raw: string, fallbackCountry?: string): { countryCode: string; vatNumber: string } | null {
  const clean = normalizeIdentifierValue(raw);
  if (!clean || clean.length < 4) return null;

  if (/^[A-Z]{2}[A-Z0-9]{4,14}$/.test(clean)) {
    let cc = clean.slice(0, 2);
    if (cc === 'GR') cc = 'EL';
    return { countryCode: cc, vatNumber: clean.slice(2) };
  }

  if (fallbackCountry && /^[A-Z]{2}$/i.test(fallbackCountry)) {
    let cc = fallbackCountry.toUpperCase();
    if (cc === 'GR') cc = 'EL';
    if (EU_VIES_MEMBER_COUNTRIES.includes(cc)) {
      return { countryCode: cc, vatNumber: clean };
    }
  }

  return null;
}

export class EuViesConnector implements IConnector {
  public readonly id = 'conn-eu-vies';

  constructor(private readonly fetchFnOverride?: typeof fetch) {}

  public getMetadata(): ConnectorMetadata {
    return EU_VIES_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const res = await executeRegistryJsonRequest<{ vow?: { available?: boolean } }>({
        providerId: this.id,
        url: VIES_STATUS_URL,
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        fetchFn: this.fetchFnOverride,
      });

      const available = res.data?.vow?.available !== false;
      return {
        ok: available,
        healthState: available ? 'operational' : 'temporarily_unavailable',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: available
          ? 'Connected to live European Commission VIES REST status endpoint.'
          : 'EU VIES VOW gateway reported temporary unavailability.',
        checkedAt,
        rateLimitRemaining: res.rateLimitRemaining,
      };
    } catch (err: unknown) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState:
          classified.category === 'rate_limited'
            ? 'rate_limited'
            : classified.category === 'timeout' || classified.category === 'network_failure' || classified.category === 'provider_unavailable'
            ? 'temporarily_unavailable'
            : 'degraded',
        latencyMs: 0,
        isLiveApi: true,
        errorCategory: classified.category,
        message: classified.safeMessage,
        checkedAt,
      };
    }
  }

  public async search(
    request: ConnectorSearchRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorSearchResponse> {
    const parsed = parseEuVatInput(request.query, request.countryCode);
    if (!parsed) {
      return {
        results: [],
        pagination: { page: 1, pageSize: 1, totalItems: 0, totalPages: 1, hasMore: false },
        rawCount: 0,
        attribution: EU_VIES_METADATA.attribution,
        notes: [
          'EU VIES only supports exact EU VAT number verification (e.g. IE6388047V or NL001234567B01). Free-text company name search is not supported by VIES.',
        ],
        isLiveApi: true,
      };
    }

    const lookup = await this.lookupById(
      { externalId: `${parsed.countryCode}${parsed.vatNumber}`, countryCode: parsed.countryCode },
      context
    );
    return {
      results: lookup.result ? [lookup.result] : [],
      pagination: {
        page: 1,
        pageSize: 1,
        totalItems: lookup.result ? 1 : 0,
        totalPages: 1,
        hasMore: false,
      },
      rawCount: lookup.result ? 1 : 0,
      attribution: EU_VIES_METADATA.attribution,
      notes: lookup.notes,
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const parsed = parseEuVatInput(request.externalId, request.countryCode);
    if (!parsed || !EU_VIES_MEMBER_COUNTRIES.includes(parsed.countryCode)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Provide a valid EU member-state VAT identifier (e.g. DE129274202, FI01120389, IE6388047V).',
      });
    }

    const res = await executeRegistryJsonRequest<EuViesResponse>({
      providerId: this.id,
      url: VIES_CHECK_URL,
      method: 'POST',
      body: {
        countryCode: parsed.countryCode,
        vatNumber: parsed.vatNumber,
      },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      fetchFn: this.fetchFnOverride,
    });

    const data = res.data;
    if (!data) {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        message: 'Empty response from EU VIES check-vat-number endpoint.',
      });
    }

    if (
      data.userError &&
      ['MS_UNAVAILABLE', 'MS_MAX_CONCURRENT_REQ', 'SERVICE_UNAVAILABLE', 'GLOBAL_MAX_CONCURRENT_REQ', 'TIMEOUT'].includes(
        data.userError
      )
    ) {
      throw new ConnectorError({
        category: data.userError.includes('MAX_CONCURRENT') ? 'rate_limited' : 'provider_unavailable',
        providerId: this.id,
        retryable: true,
        message: `EU VIES member-state gateway (${parsed.countryCode}) reported ${data.userError}. Retry shortly.`,
      });
    }

    if (!data.valid) {
      return {
        found: false,
        attribution: EU_VIES_METADATA.attribution,
        notes: [`EU VIES returned valid=false for VAT ${parsed.countryCode}${parsed.vatNumber}.`],
        isLiveApi: true,
        providerMetadata: { rawApiRecord: data },
      };
    }

    const retrievedAt = new Date().toISOString();
    const normalized = this.normalizeResult(
      { ...data, countryCode: data.countryCode || parsed.countryCode, vatNumber: data.vatNumber || parsed.vatNumber },
      retrievedAt
    );

    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: EU_VIES_METADATA.attribution,
      notes: [`Verified active EU VAT registration ${parsed.countryCode}${parsed.vatNumber} via European Commission VIES.`],
      isLiveApi: true,
      providerMetadata: { rawApiRecord: data },
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const rec = raw as EuViesResponse;
    if (!rec || !rec.vatNumber || !rec.countryCode) return null;

    const cc = rec.countryCode === 'EL' ? 'GR' : rec.countryCode.toUpperCase();
    const fullVat = `${rec.countryCode.toUpperCase()}${rec.vatNumber}`;
    const rawName = (rec.name || '').trim();
    const companyName = rawName && rawName !== '---' ? rawName : `EU VAT Entity ${fullVat}`;
    const rawAddr = (rec.address || '').replace(/\n+/g, ', ').trim();

    return {
      providerId: this.id,
      providerName: EU_VIES_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: cc,
      externalSourceId: fullVat,
      company: {
        companyName,
        legalName: companyName,
        registrationNumber: fullVat,
        registrationType: 'EU_VAT',
        companyStatus: rec.valid ? 'active' : 'inactive',
        address: {
          street: rawAddr && rawAddr !== '---' ? rawAddr : undefined,
          countryCode: cc,
        },
        identifiers: [
          {
            type: 'EU_VAT',
            value: fullVat,
            normalizedValue: fullVat,
            countryCode: cc,
            status: 'officially_verified',
            verified: true,
          },
        ],
        rawSource: {
          sourceName: EU_VIES_METADATA.name,
          providerId: fullVat,
          url: EU_VIES_METADATA.homepageUrl,
          retrievedAt,
          license: EU_VIES_METADATA.license,
          attribution: EU_VIES_METADATA.attribution,
        },
      },
      sourceUrl: EU_VIES_METADATA.homepageUrl,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: rec.requestDate,
        freshnessNote: 'Real-time EU Member-State VAT Check',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: 92,
        signals: ['European Commission VIES Live Check'],
      },
      providerMetadata: {
        rawApiRecord: raw,
        rawRegistryStatus: rec.valid ? 'VALID' : 'INVALID',
        viesUserError: rec.userError,
      },
    };
  }

  public classifyError(error: unknown): ClassifiedConnectorError {
    return classifyConnectorError(error, this.id);
  }

  public getHealth(state: ConnectorRuntimeState): ConnectorHealthReport {
    return connectorRegistry.computeHealthReport(this, state);
  }
}
