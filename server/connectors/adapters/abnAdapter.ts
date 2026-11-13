import { searchAbn, validateAbnChecksum } from '../abnLookup.js';
import { classifyConnectorError, ConnectorError } from '../core/errors.js';
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
import { CanonicalLead } from '../../types.js';

const ABN_METADATA: ConnectorMetadata = {
  id: 'conn-abn',
  name: 'Australian Business Register (ABN Lookup)',
  shortName: 'AU ABN Reference',
  version: '4.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'offline_reference',
  description:
    'Provides local ATO Modulo-89 ABN checksum validation and a 5-record offline reference sample. Live Australian Business Register XML/JSON lookups require an official ABR Web Services GUID.',
  supportedCountries: ['AU'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportedIdentifierTypes: ['AU_ABN'],
  capabilities: ['company_search', 'identifier_validation', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'ABR Web Services GUID',
        required: true,
        secret: true,
        placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        helpText: 'Issued by the Australian Business Register (abr.business.gov.au)',
      },
    ],
    envFallbackKeys: ['ABR_GUID'],
    setupInstructions:
      'Register for a free ABR Web Services GUID at abr.business.gov.au/Documentation/WebServiceMethods. Without a GUID, only local ATO Modulo-89 syntax checks and the 5-record offline reference sample run.',
    obtainKeyUrl: 'https://abr.business.gov.au/Documentation/WebServiceMethods',
  },
  executionPolicy: {
    timeoutMs: 8000,
    maxRetries: 1,
    baseBackoffMs: 400,
    maxBackoffMs: 2000,
    maxConcurrency: 4,
    rateLimit: {
      maxRequests: 60,
      windowMs: 60000,
      note: 'ATO Modulo-89 checksum & 5-record sample offline; live ABR API requires registered ABR GUID',
      waitOnLimit: false,
    },
    defaultPageSize: 10,
    maxPageSize: 20,
  },
  attribution: 'Commonwealth of Australia Open Data (ABR Offline Reference & Modulo-89 Checksum)',
  license: 'Commonwealth of Australia Open Data (ABR Terms of Access)',
  homepageUrl: 'https://abr.business.gov.au/Documentation/WebServiceMethods',
};

export class AbnConnector implements IConnector {
  public readonly id = 'conn-abn';

  public getMetadata(): ConnectorMetadata {
    return ABN_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const guid = context.credentials.apiKey?.trim();

    if (!guid) {
      return {
        ok: false,
        healthState: 'authentication_required',
        latencyMs: Date.now() - start,
        isLiveApi: false,
        errorCategory: 'missing_credentials',
        message:
          'ABR Web Services GUID is not configured. Offline ATO Modulo-89 checksum and 5-record sample are available, but live ABR API lookups are disabled.',
        checkedAt,
      };
    }

    // Validate GUID format and test ABR JSON endpoint if configured
    try {
      const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=88098143410&guid=${encodeURIComponent(guid)}`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': context.userAgent,
        },
        signal: context.signal,
      });

      const latencyMs = Date.now() - start;
      if (!response.ok) {
        return {
          ok: false,
          healthState: response.status === 401 || response.status === 403 ? 'authentication_required' : 'temporarily_unavailable',
          latencyMs,
          isLiveApi: false,
          errorCategory: response.status === 401 ? 'authentication_failure' : 'provider_unavailable',
          message: `ABR endpoint returned HTTP ${response.status}. Offline reference mode remains active.`,
          checkedAt,
        };
      }

      const text = await response.text();
      if (text.toLowerCase().includes('invalid guid') || text.toLowerCase().includes('not registered')) {
        return {
          ok: false,
          healthState: 'authentication_required',
          latencyMs,
          isLiveApi: false,
          errorCategory: 'authentication_failure',
          message: 'ABR rejected configured GUID. Check ABR Web Services registration.',
          checkedAt,
        };
      }

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `ABR GUID verified (${latencyMs}ms).`,
        checkedAt,
      };
    } catch (err) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState: 'temporarily_unavailable',
        latencyMs: Date.now() - start,
        isLiveApi: false,
        errorCategory: classified.category,
        message: `ABR live endpoint unreachable: ${classified.safeMessage}`,
        checkedAt,
      };
    }
  }

  public async search(
    request: ConnectorSearchRequest,
    _context: ConnectorExecutionContext
  ): Promise<ConnectorSearchResponse> {
    const query = request.query.trim();
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Search query cannot be empty.',
      });
    }

    const res = await searchAbn(query);
    const retrievedAt = new Date().toISOString();
    const results = res.leads
      .map((l) => this.normalizeResult(l, retrievedAt))
      .filter((r): r is StandardizedConnectorResult => r !== null);

    const notes = [res.message];
    if (request.region?.trim()) {
      notes.push(`Offline ABN reference search does not enforce state/territory filter "${request.region.trim()}".`);
    }

    return {
      results,
      pagination: {
        page: 1,
        pageSize: results.length || 10,
        totalItems: results.length,
        totalPages: 1,
        hasMore: false,
      },
      rawCount: results.length,
      attribution: ABN_METADATA.attribution,
      notes,
      isLiveApi: false,
      providerMetadata: {
        isLiveApi: false,
        lookupMode: res.lookupMode,
        isChecksumValid: res.isChecksumValid,
      },
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    _context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const clean = request.externalId.replace(/\s+/g, '');
    const valid = validateAbnChecksum(clean);
    const res = await searchAbn(clean);
    const retrievedAt = new Date().toISOString();
    const first = res.leads[0] ? this.normalizeResult(res.leads[0], retrievedAt) : null;

    return {
      found: Boolean(first),
      result: first || undefined,
      attribution: ABN_METADATA.attribution,
      notes: [
        `ATO Modulo-89 checksum ${valid ? 'PASSED' : 'FAILED'} for ${clean}. Live ABR API status requires ABR GUID.`,
      ],
      isLiveApi: false,
      providerMetadata: {
        isChecksumValid: valid,
        lookupMode: res.lookupMode,
      },
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const lead = raw as CanonicalLead;
    if (!lead || !lead.companyName) return null;

    const abnDigits = (lead.registrationNumber || lead.id.replace(/^abn-/, '')).replace(/\s+/g, '');

    return {
      providerId: this.id,
      providerName: ABN_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'offline_reference',
      countryCode: 'AU',
      externalSourceId: abnDigits,
      company: {
        companyName: lead.companyName,
        legalName: lead.legalName,
        registrationNumber: lead.registrationNumber,
        registrationType: 'AU_ABN',
        companyStatus: 'unknown',
        website: lead.website,
        domain: lead.domain,
        address: lead.address,
        industry: lead.industry,
        category: lead.category,
        identifiers: lead.identifiers,
        tags: lead.tags,
        rawSource: lead.sources[0],
      },
      sourceUrl: lead.sources[0]?.url,
      retrievedAt,
      dataFreshness: {
        freshnessNote: 'Offline 5-record reference sample + ATO Modulo-89 syntax validation',
        isRealtime: false,
      },
      verificationStatus: 'offline_reference',
      confidence: {
        supported: true,
        score: lead.confidenceScore,
        signals: lead.confidenceSignals,
      },
      providerMetadata: {
        isLiveApi: false,
        checksumValid: validateAbnChecksum(abnDigits),
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
