import { searchAbn, validateAbnChecksum } from '../abnLookup.js';
import { classifyConnectorError, classifyHttpStatus, ConnectorError } from '../core/errors.js';
import { normalizeLegalCompanyStatus } from '../core/normalizer.js';
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

interface AbrMatchingNameItem {
  Abn?: string;
  AbnStatus?: string;
  IsCurrent?: boolean;
  Name?: string;
  NameType?: string;
  Postcode?: string;
  Score?: number;
  State?: string;
}

interface AbrAbnDetailsPayload {
  Abn?: string;
  AbnStatus?: string;
  AbnStatusEffectiveFrom?: string;
  Acn?: string;
  AddressDate?: string;
  AddressPostcode?: string;
  AddressState?: string;
  BusinessName?: string[];
  EntityName?: string;
  EntityTypeCode?: string;
  EntityTypeName?: string;
  Gst?: string | null;
  Message?: string;
}

const ABR_JSON_BASE = 'https://abr.business.gov.au/json';

function parseAbrJsonp<T = any>(rawText: string): T {
  const trimmed = rawText.trim();
  // ABR JSON endpoints wrap response in callback({...}) when callback=callback is passed
  const jsonpMatch = trimmed.match(/^[a-zA-Z0-9_$.]+\(([\s\S]*)\)\s*;?$/);
  const jsonStr = jsonpMatch ? jsonpMatch[1] : trimmed;
  return JSON.parse(jsonStr) as T;
}

function formatAbnDigits(digits: string): string {
  const clean = digits.replace(/\s+/g, '');
  if (!/^\d{11}$/.test(clean)) return digits;
  return `${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5, 8)} ${clean.slice(8)}`;
}

const ABN_METADATA: ConnectorMetadata = {
  id: 'conn-abn',
  name: 'Australian Business Register (ABN Lookup)',
  shortName: 'AU ABN / ABR',
  version: '4.1.0',
  sourceCategory: 'government_registry',
  accessMode: 'offline_reference',
  description:
    'Official Australian Business Register (ABR) integration. Executes live ABR JSON queries when an ABR Web Services GUID is configured; falls back honestly to local ATO Modulo-89 checksum validation and a 5-record offline sample when unconfigured.',
  supportedCountries: ['AU'],
  supportsAllCountries: false,
  supportsRegionFilter: true,
  supportsCityFilter: false,
  supportsPostalCodeFilter: true,
  supportedIdentifierTypes: ['AU_ABN', 'AU_ACN'],
  capabilities: ['company_search', 'registry_lookup', 'identifier_validation', 'connection_test'],
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
    timeoutMs: 9000,
    maxRetries: 2,
    baseBackoffMs: 400,
    maxBackoffMs: 3000,
    maxConcurrency: 4,
    rateLimit: {
      maxRequests: 60,
      windowMs: 60000,
      note: 'Free ABR Web Services GUID for live queries; local ATO Modulo-89 checksum offline fallback when unconfigured',
      waitOnLimit: false,
    },
    defaultPageSize: 10,
    maxPageSize: 50,
  },
  attribution: 'Commonwealth of Australia — Australian Business Register (ABR)',
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

    try {
      const url = `${ABR_JSON_BASE}/AbnDetails.aspx?abn=88098143410&callback=callback&guid=${encodeURIComponent(guid)}`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json, text/javascript',
          'User-Agent': context.userAgent,
        },
        signal: context.signal,
      });

      const latencyMs = Date.now() - start;
      if (!response.ok) {
        const httpClass = classifyHttpStatus(response.status);
        return {
          ok: false,
          healthState:
            response.status === 401 || response.status === 403
              ? 'authentication_required'
              : 'temporarily_unavailable',
          latencyMs,
          isLiveApi: true,
          errorCategory: httpClass.category,
          message: `ABR endpoint returned HTTP ${response.status}. Offline reference mode remains active.`,
          checkedAt,
        };
      }

      const text = await response.text();
      let parsed: AbrAbnDetailsPayload | null = null;
      try {
        parsed = parseAbrJsonp<AbrAbnDetailsPayload>(text);
      } catch {
        parsed = null;
      }

      const msg = (parsed?.Message || text || '').toLowerCase();
      if (msg.includes('invalid guid') || msg.includes('not registered') || msg.includes('authentication')) {
        return {
          ok: false,
          healthState: 'authentication_required',
          latencyMs,
          isLiveApi: true,
          errorCategory: 'authentication_failure',
          message: 'ABR rejected configured GUID. Check ABR Web Services registration.',
          checkedAt,
        };
      }

      if (!parsed || (!parsed.Abn && !parsed.EntityName)) {
        return {
          ok: false,
          healthState: 'authentication_required',
          latencyMs,
          isLiveApi: true,
          errorCategory: 'authentication_failure',
          message: parsed?.Message || 'ABR returned empty details for configured GUID.',
          checkedAt,
        };
      }

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `ABR live JSON API verified (${latencyMs}ms).`,
        checkedAt,
      };
    } catch (err) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState: 'temporarily_unavailable',
        latencyMs: Date.now() - start,
        isLiveApi: true,
        errorCategory: classified.category,
        message: `ABR live endpoint unreachable: ${classified.safeMessage}`,
        checkedAt,
      };
    }
  }

  public async search(
    request: ConnectorSearchRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorSearchResponse> {
    const query = request.query.trim();
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Search query cannot be empty.',
      });
    }

    const guid = context.credentials.apiKey?.trim();
    const retrievedAt = new Date().toISOString();

    if (guid) {
      const numericDigits = query.replace(/\s+/g, '');
      // Exact 11-digit ABN search hits AbnDetails.aspx directly
      if (/^\d{11}$/.test(numericDigits)) {
        const details = await this.fetchLiveAbnDetails(numericDigits, guid, context);
        const results = details
          ? [this.normalizeLiveAbnDetails(details, retrievedAt)].filter(
              (r): r is StandardizedConnectorResult => r !== null
            )
          : [];
        return {
          results,
          pagination: {
            page: 1,
            pageSize: 10,
            totalItems: results.length,
            totalPages: 1,
            hasMore: false,
          },
          rawCount: results.length,
          attribution: ABN_METADATA.attribution,
          notes: details ? [] : [`No live ABR entity found for ABN ${formatAbnDigits(numericDigits)}.`],
          isLiveApi: true,
          providerMetadata: {
            isLiveApi: true,
            lookupMode: 'live_abr_details',
            isChecksumValid: validateAbnChecksum(numericDigits),
          },
        };
      }

      const maxResults = Math.min(
        ABN_METADATA.executionPolicy.maxPageSize,
        Math.max(1, request.pageSize || ABN_METADATA.executionPolicy.defaultPageSize)
      );
      const url = new URL(`${ABR_JSON_BASE}/MatchingNames.aspx`);
      url.searchParams.set('name', query);
      url.searchParams.set('maxResults', String(maxResults));
      url.searchParams.set('callback', 'callback');
      url.searchParams.set('guid', guid);

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json, text/javascript',
          'User-Agent': context.userAgent,
        },
        signal: context.signal,
      });

      if (!response.ok) {
        const httpClass = classifyHttpStatus(response.status);
        throw new ConnectorError({
          category: httpClass.category,
          providerId: this.id,
          httpStatus: response.status,
          retryable: httpClass.retryable,
          message: `ABR MatchingNames returned HTTP ${response.status}`,
          knownSecrets: [guid],
        });
      }

      const rawText = await response.text();
      let payload: { Message?: string; Names?: AbrMatchingNameItem[] };
      try {
        payload = parseAbrJsonp(rawText);
      } catch {
        throw new ConnectorError({
          category: 'invalid_response',
          providerId: this.id,
          retryable: false,
          message: 'ABR returned malformed JSONP payload.',
          knownSecrets: [guid],
        });
      }

      const errMsg = (payload.Message || '').trim();
      if (errMsg && (errMsg.toLowerCase().includes('guid') || errMsg.toLowerCase().includes('not registered'))) {
        throw new ConnectorError({
          category: 'authentication_failure',
          providerId: this.id,
          retryable: false,
          message: `ABR rejected GUID: ${errMsg}`,
          knownSecrets: [guid],
        });
      }

      const stateFilter = request.region?.trim().toUpperCase();
      const postalFilter = request.postalCode?.trim().replace(/\s+/g, '');
      const rawItems = Array.isArray(payload.Names) ? payload.Names : [];

      const filtered = rawItems.filter((item) => {
        if (stateFilter && item.State && !item.State.toUpperCase().includes(stateFilter)) {
          return false;
        }
        if (postalFilter && item.Postcode && !item.Postcode.includes(postalFilter)) {
          return false;
        }
        return true;
      });

      const results = filtered
        .map((item) => this.normalizeLiveMatchingName(item, retrievedAt))
        .filter((r): r is StandardizedConnectorResult => r !== null);

      return {
        results,
        pagination: {
          page: 1,
          pageSize: maxResults,
          totalItems: results.length,
          totalPages: 1,
          hasMore: false,
        },
        rawCount: rawItems.length,
        attribution: ABN_METADATA.attribution,
        notes: errMsg ? [errMsg] : [],
        isLiveApi: true,
        providerMetadata: {
          isLiveApi: true,
          lookupMode: 'live_abr_matching_names',
        },
      };
    }

    // Honest offline fallback when ABR GUID is missing
    const res = await searchAbn(query);
    const cityFilter = request.city?.trim().toLowerCase();
    const postalFilter = request.postalCode?.trim().toLowerCase().replace(/\s+/g, '');
    const industryFilter = (request.industry || request.category || request.businessType || '').trim().toLowerCase();

    const results = res.leads
      .map((l) => this.normalizeResult(l, retrievedAt))
      .filter((r): r is StandardizedConnectorResult => r !== null)
      .filter((r) => {
        if (cityFilter && !(r.company.address?.city || '').toLowerCase().includes(cityFilter)) return false;
        if (postalFilter && !(r.company.address?.postalCode || '').toLowerCase().replace(/\s+/g, '').includes(postalFilter)) {
          return false;
        }
        if (industryFilter && !`${r.company.industry || ''} ${r.company.category || ''}`.toLowerCase().includes(industryFilter)) {
          return false;
        }
        return true;
      });

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
      attribution: `${ABN_METADATA.attribution} (Offline Reference & Modulo-89 Checksum)`,
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
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const clean = request.externalId.replace(/\s+/g, '');
    if (!/^\d{11}$/.test(clean)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: `Invalid Australian Business Number "${request.externalId}". Must be 11 digits.`,
      });
    }

    const valid = validateAbnChecksum(clean);
    const guid = context.credentials.apiKey?.trim();
    const retrievedAt = new Date().toISOString();

    if (guid) {
      const details = await this.fetchLiveAbnDetails(clean, guid, context);
      const normalized = details ? this.normalizeLiveAbnDetails(details, retrievedAt) : null;
      return {
        found: Boolean(normalized),
        result: normalized || undefined,
        attribution: ABN_METADATA.attribution,
        notes: normalized
          ? [`Verified live with Australian Business Register (ABN ${formatAbnDigits(clean)}).`]
          : [details?.Message || `ABN ${formatAbnDigits(clean)} not found in live ABR.`],
        isLiveApi: true,
        providerMetadata: {
          isLiveApi: true,
          isChecksumValid: valid,
          lookupMode: 'live_abr_details',
        },
      };
    }

    const res = await searchAbn(clean);
    const first = res.leads[0] ? this.normalizeResult(res.leads[0], retrievedAt) : null;

    return {
      found: Boolean(first),
      result: first || undefined,
      attribution: `${ABN_METADATA.attribution} (Offline Reference)`,
      notes: [
        `ATO Modulo-89 checksum ${valid ? 'PASSED' : 'FAILED'} for ${clean}. Live ABR API status requires ABR GUID.`,
      ],
      isLiveApi: false,
      providerMetadata: {
        isLiveApi: false,
        isChecksumValid: valid,
        lookupMode: res.lookupMode,
      },
    };
  }

  private async fetchLiveAbnDetails(
    cleanAbn: string,
    guid: string,
    context: ConnectorExecutionContext
  ): Promise<AbrAbnDetailsPayload | null> {
    const url = `${ABR_JSON_BASE}/AbnDetails.aspx?abn=${encodeURIComponent(cleanAbn)}&callback=callback&guid=${encodeURIComponent(guid)}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, text/javascript',
        'User-Agent': context.userAgent,
      },
      signal: context.signal,
    });

    if (!response.ok) {
      const httpClass = classifyHttpStatus(response.status);
      throw new ConnectorError({
        category: httpClass.category,
        providerId: this.id,
        httpStatus: response.status,
        retryable: httpClass.retryable,
        message: `ABR AbnDetails returned HTTP ${response.status}`,
        knownSecrets: [guid],
      });
    }

    const rawText = await response.text();
    let payload: AbrAbnDetailsPayload;
    try {
      payload = parseAbrJsonp<AbrAbnDetailsPayload>(rawText);
    } catch {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        retryable: false,
        message: 'ABR AbnDetails returned malformed JSONP payload.',
        knownSecrets: [guid],
      });
    }

    const errMsg = (payload.Message || '').trim();
    if (errMsg) {
      const lower = errMsg.toLowerCase();
      if (lower.includes('invalid guid') || lower.includes('not registered')) {
        throw new ConnectorError({
          category: 'authentication_failure',
          providerId: this.id,
          retryable: false,
          message: `ABR rejected GUID: ${errMsg}`,
          knownSecrets: [guid],
        });
      }
      if (lower.includes('not found') || lower.includes('no matching') || !payload.Abn) {
        return null;
      }
    }

    if (!payload.Abn && !payload.EntityName) return null;
    return payload;
  }

  private normalizeLiveAbnDetails(
    item: AbrAbnDetailsPayload,
    retrievedAt: string
  ): StandardizedConnectorResult | null {
    const cleanAbn = (item.Abn || '').replace(/\s+/g, '');
    const legalName = item.EntityName?.trim();
    if (!cleanAbn || !legalName) return null;

    const formattedAbn = formatAbnDigits(cleanAbn);
    const tradingName = Array.isArray(item.BusinessName) && item.BusinessName[0] ? item.BusinessName[0] : legalName;
    const companyStatus = normalizeLegalCompanyStatus(item.AbnStatus);
    const foundedYear = item.AbnStatusEffectiveFrom ? parseInt(item.AbnStatusEffectiveFrom.slice(0, 4), 10) : undefined;

    const identifiers: Array<{
      type: string;
      value: string;
      normalizedValue?: string;
      countryCode: string;
      issuingAuthority: string;
      source: string;
      status: 'officially_verified' | 'syntax_validated' | 'discovered' | 'user_provided';
      verified: boolean;
    }> = [
      {
        type: 'AU_ABN',
        value: formattedAbn,
        normalizedValue: cleanAbn,
        countryCode: 'AU',
        issuingAuthority: 'Australian Business Register (ABR)',
        source: 'abr_live_api',
        status: 'officially_verified',
        verified: true,
      },
    ];

    if (item.Acn && /^\d{9}$/.test(item.Acn.replace(/\s+/g, ''))) {
      const acnDigits = item.Acn.replace(/\s+/g, '');
      identifiers.push({
        type: 'AU_ACN',
        value: acnDigits,
        normalizedValue: acnDigits,
        countryCode: 'AU',
        issuingAuthority: 'Australian Securities & Investments Commission (ASIC)',
        source: 'abr_live_api',
        status: 'officially_verified',
        verified: true,
      });
    }

    const signals = ['Official Live Australian Business Register (ABR) Verification'];
    let score = 82;
    if (companyStatus === 'active') {
      score += 10;
      signals.push('Active ABN Registration Status Confirmed');
    }
    if (item.AddressState || item.AddressPostcode) {
      score += 5;
      signals.push('Registered State & Postcode Confirmed');
    }

    return {
      providerId: this.id,
      providerName: 'Australian Business Register (Live Official API)',
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'AU',
      externalSourceId: cleanAbn,
      company: {
        companyName: tradingName,
        legalName,
        registrationNumber: formattedAbn,
        registrationType: 'AU_ABN',
        companyStatus,
        address: {
          region: item.AddressState || undefined,
          postalCode: item.AddressPostcode || undefined,
          country: 'Australia',
          countryCode: 'AU',
        },
        industry: item.EntityTypeName || 'Australian Registered Entity',
        category: item.EntityTypeCode || 'ABN Entity',
        foundedYear: Number.isFinite(foundedYear) ? foundedYear : undefined,
        identifiers,
        tags: ['Australia', 'ABR Verified', item.AddressState || 'AU'].filter(Boolean),
        rawSource: {
          sourceName: 'Australian Business Register (Live Official API)',
          providerId: cleanAbn,
          url: `https://abr.business.gov.au/ABN/View?id=${cleanAbn}`,
          retrievedAt,
          license: ABN_METADATA.license,
          attribution: ABN_METADATA.attribution,
        },
      },
      sourceUrl: `https://abr.business.gov.au/ABN/View?id=${cleanAbn}`,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'Real-time ABR JSON API query',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: Math.min(100, score),
        signals,
      },
      providerMetadata: {
        isLiveApi: true,
        abnStatusLabel: item.AbnStatus,
        entityTypeCode: item.EntityTypeCode,
        entityTypeName: item.EntityTypeName,
        gstRegistered: Boolean(item.Gst),
        checksumValid: validateAbnChecksum(cleanAbn),
      },
    };
  }

  private normalizeLiveMatchingName(
    item: AbrMatchingNameItem,
    retrievedAt: string
  ): StandardizedConnectorResult | null {
    const cleanAbn = (item.Abn || '').replace(/\s+/g, '');
    const name = item.Name?.trim();
    if (!cleanAbn || !name) return null;

    const formattedAbn = formatAbnDigits(cleanAbn);
    const companyStatus = normalizeLegalCompanyStatus(
      item.AbnStatus || (item.IsCurrent ? 'Active' : undefined)
    );

    return {
      providerId: this.id,
      providerName: 'Australian Business Register (Live Official API)',
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'AU',
      externalSourceId: cleanAbn,
      company: {
        companyName: name,
        legalName: name,
        registrationNumber: formattedAbn,
        registrationType: 'AU_ABN',
        companyStatus,
        address: {
          region: item.State || undefined,
          postalCode: item.Postcode || undefined,
          country: 'Australia',
          countryCode: 'AU',
        },
        industry: item.NameType || 'Australian Registered Business',
        category: item.NameType || 'Entity Name',
        identifiers: [
          {
            type: 'AU_ABN',
            value: formattedAbn,
            normalizedValue: cleanAbn,
            countryCode: 'AU',
            issuingAuthority: 'Australian Business Register (ABR)',
            source: 'abr_live_api',
            status: 'officially_verified',
            verified: true,
          },
        ],
        tags: ['Australia', 'ABR Verified', item.State || 'AU'].filter(Boolean),
        rawSource: {
          sourceName: 'Australian Business Register (Live Official API)',
          providerId: cleanAbn,
          url: `https://abr.business.gov.au/ABN/View?id=${cleanAbn}`,
          retrievedAt,
          license: ABN_METADATA.license,
          attribution: ABN_METADATA.attribution,
        },
      },
      sourceUrl: `https://abr.business.gov.au/ABN/View?id=${cleanAbn}`,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'Real-time ABR MatchingNames query',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: Math.max(70, Math.min(95, item.Score || 80)),
        signals: ['Live ABR Name Index Match', `Name Type: ${item.NameType || 'Entity Name'}`],
      },
      providerMetadata: {
        isLiveApi: true,
        nameType: item.NameType,
        abnStatusLabel: item.AbnStatus,
        isCurrent: item.IsCurrent,
        checksumValid: validateAbnChecksum(cleanAbn),
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
