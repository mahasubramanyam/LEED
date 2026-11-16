import { formatFinnishYtunnus, validateFinnishYtunnus } from '../../identifiers/identifierEngine.js';
import { classifyConnectorError, ConnectorError } from '../core/errors.js';
import { normalizeLegalCompanyStatus } from '../core/normalizer.js';
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

interface PrhNameEntry {
  name?: string;
  type?: string;
  endDate?: string | null;
}

interface PrhAddressEntry {
  type?: number;
  street?: string;
  buildingNumber?: string;
  entrance?: string;
  postCode?: string;
  postOffices?: Array<{ city?: string; languageCode?: string }>;
  country?: string;
}

interface PrhCompanyRecord {
  businessId?: { value?: string; registrationDate?: string; source?: string };
  names?: PrhNameEntry[];
  addresses?: PrhAddressEntry[];
  website?: { url?: string };
  companyForms?: Array<{ type?: string; descriptions?: Array<{ description?: string; languageCode?: string }> }>;
  mainBusinessLine?: { type?: string; descriptions?: Array<{ description?: string; languageCode?: string }> };
  status?: string;
  endDate?: string | null;
  registrationDate?: string;
  lastModified?: string;
}

interface PrhV3Response {
  totalResults?: number;
  companies?: PrhCompanyRecord[];
}

const PRH_V3_BASE = 'https://avoindata.prh.fi/opendata-ytj-api/v3';

const FI_PRH_METADATA: ConnectorMetadata = {
  id: 'conn-fi-prh',
  name: 'Finnish PRH / YTJ Open Data Registry (v3)',
  shortName: 'Finland PRH/YTJ',
  version: '1.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official Finnish Patent and Registration Office (PRH) & Tax Administration YTJ Open Data REST API v3 providing live Finnish Business IDs (Y-tunnus), legal names, company forms, addresses, and registration status.',
  supportedCountries: ['FI'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: true,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['FI_YTUNNUS'],
  capabilities: ['company_search', 'registry_lookup', 'identifier_validation', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions: 'Open public Finnish government API (CC BY 4.0). No API key required.',
    obtainKeyUrl: 'https://avoindata.prh.fi/en/ytj',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 4000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: 'Open PRH YTJ API v3, client-throttled to 30 req/min',
      waitOnLimit: false,
    },
    defaultPageSize: 20,
    maxPageSize: 100,
    dedupeWindowMs: 5000,
  },
  attribution: 'Finnish Patent and Registration Office (PRH) — CC BY 4.0',
  license: 'Creative Commons Attribution 4.0 (CC BY 4.0)',
  homepageUrl: 'https://avoindata.prh.fi/en/ytj',
};

export class FiPrhConnector implements IConnector {
  public readonly id = 'conn-fi-prh';

  constructor(private readonly fetchFnOverride?: typeof fetch) {}

  public getMetadata(): ConnectorMetadata {
    return FI_PRH_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    try {
      const res = await executeRegistryJsonRequest<PrhV3Response>({
        providerId: this.id,
        url: `${PRH_V3_BASE}/companies?businessId=0112038-9`,
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        fetchFn: this.fetchFnOverride,
      });

      const count = res.data?.companies?.length || 0;
      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: `Connected to live Finnish PRH YTJ Open Data API v3 (${count} probe record verified).`,
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
    const query = (request.query || '').trim();
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Company name or Finnish Y-tunnus is required for PRH search.',
      });
    }

    if (validateFinnishYtunnus(query)) {
      const lookup = await this.lookupById({ externalId: query, countryCode: 'FI' }, context);
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
        attribution: FI_PRH_METADATA.attribution,
        notes: lookup.notes,
        isLiveApi: true,
      };
    }

    const page = Math.max(1, request.page || 1);
    const params = new URLSearchParams({
      name: query,
      page: String(page),
    });
    if (request.city) {
      params.set('location', request.city.trim());
    }

    const res = await executeRegistryJsonRequest<PrhV3Response>({
      providerId: this.id,
      url: `${PRH_V3_BASE}/companies?${params.toString()}`,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      fetchFn: this.fetchFnOverride,
    });

    const retrievedAt = new Date().toISOString();
    const rawList = Array.isArray(res.data?.companies) ? res.data!.companies : [];
    const results: StandardizedConnectorResult[] = [];
    for (const item of rawList) {
      const normalized = this.normalizeResult(item, retrievedAt);
      if (normalized) results.push(normalized);
    }

    const totalItems = typeof res.data?.totalResults === 'number' ? res.data.totalResults : results.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / 100));

    return {
      results,
      pagination: {
        page,
        pageSize: Math.max(1, rawList.length || 20),
        totalItems,
        totalPages,
        hasMore: page < totalPages,
      },
      rawCount: rawList.length,
      attribution: FI_PRH_METADATA.attribution,
      notes: [`Queried live Finnish PRH YTJ Open Data API v3 for "${query}".`],
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    if (!validateFinnishYtunnus(request.externalId)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Invalid Finnish Y-tunnus. Expected 7 digits + hyphen + Modulo-11 check digit (e.g. 0112038-9).',
      });
    }

    const formatted = formatFinnishYtunnus(request.externalId);
    const res = await executeRegistryJsonRequest<PrhV3Response>({
      providerId: this.id,
      url: `${PRH_V3_BASE}/companies?businessId=${encodeURIComponent(formatted)}`,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      allowNotFound: true,
      fetchFn: this.fetchFnOverride,
    });

    const record = res.data?.companies?.[0];
    if (res.notFound || !record) {
      return {
        found: false,
        attribution: FI_PRH_METADATA.attribution,
        notes: [`Finnish Y-tunnus ${formatted} not found in PRH YTJ registry.`],
        isLiveApi: true,
      };
    }

    const retrievedAt = new Date().toISOString();
    const normalized = this.normalizeResult(record, retrievedAt);
    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: FI_PRH_METADATA.attribution,
      notes: [`Exact Y-tunnus ${formatted} verified via Finnish PRH YTJ API v3.`],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const rec = raw as PrhCompanyRecord;
    const ytunnus = rec?.businessId?.value?.trim();
    if (!ytunnus) return null;

    const activeName =
      rec.names?.find((n) => !n.endDate && (n.type === '1' || n.type === '0'))?.name ||
      rec.names?.find((n) => !n.endDate)?.name ||
      rec.names?.[0]?.name;
    if (!activeName) return null;

    const addr = rec.addresses?.[0];
    const street = [addr?.street, addr?.buildingNumber, addr?.entrance].filter(Boolean).join(' ').trim() || undefined;
    const city =
      addr?.postOffices?.find((p) => p.languageCode === '3' || p.languageCode === '1')?.city ||
      addr?.postOffices?.[0]?.city;

    const formDesc =
      rec.companyForms?.[0]?.descriptions?.find((d) => d.languageCode === '3')?.description ||
      rec.companyForms?.[0]?.descriptions?.[0]?.description;

    const businessLine =
      rec.mainBusinessLine?.descriptions?.find((d) => d.languageCode === '3')?.description ||
      rec.mainBusinessLine?.descriptions?.[0]?.description;

    const isDissolved = Boolean(rec.endDate);
    const companyStatus = normalizeLegalCompanyStatus(rec.status, {
      cancelled: isDissolved,
      explicitActive: !isDissolved && rec.status === '2',
    });

    const regDate = rec.businessId?.registrationDate || rec.registrationDate;
    const foundedYear = regDate && /^\d{4}/.test(regDate) ? parseInt(regDate.slice(0, 4), 10) : undefined;
    const sourceUrl = `https://tietopalvelu.ytj.fi/yritys/${encodeURIComponent(ytunnus)}`;

    return {
      providerId: this.id,
      providerName: FI_PRH_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'FI',
      externalSourceId: ytunnus,
      company: {
        companyName: activeName.trim(),
        legalName: activeName.trim(),
        registrationNumber: ytunnus,
        registrationType: 'FI_YTUNNUS',
        companyStatus,
        website: rec.website?.url,
        address: {
          street,
          city,
          postalCode: addr?.postCode,
          country: 'Finland',
          countryCode: addr?.country || 'FI',
        },
        industry: businessLine || 'General Commerce & Services',
        category: formDesc || 'Finnish Registered Entity',
        foundedYear,
        identifiers: [
          {
            type: 'FI_YTUNNUS',
            value: ytunnus,
            normalizedValue: ytunnus.replace(/[^0-9]/g, ''),
            countryCode: 'FI',
            status: 'officially_verified',
            verified: true,
          },
        ],
        rawSource: {
          sourceName: FI_PRH_METADATA.name,
          providerId: ytunnus,
          url: sourceUrl,
          retrievedAt,
          license: FI_PRH_METADATA.license,
          attribution: FI_PRH_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: rec.lastModified,
        freshnessNote: 'Real-time PRH / YTJ Open Data v3',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: isDissolved ? 85 : 96,
        signals: ['Finnish PRH / YTJ Official Open Data', 'Y-tunnus Mod-11 Verified'],
      },
      providerMetadata: {
        rawApiRecord: raw,
        rawRegistryStatus: isDissolved ? 'ENDED' : rec.status || 'REGISTERED',
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
