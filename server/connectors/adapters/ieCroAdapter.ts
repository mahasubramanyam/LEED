import { validateIrishCro } from '../../identifiers/identifierEngine.js';
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

interface CroCompanyItem {
  company_num?: number | string;
  company_name?: string;
  company_bus_ind?: string;
  company_type_code?: number | string;
  company_type_desc?: string;
  company_status_code?: number | string;
  company_status_desc?: string;
  company_reg_date?: string;
  company_addr_1?: string;
  company_addr_2?: string;
  company_addr_3?: string;
  company_addr_4?: string;
  place_of_business?: string;
  eircode?: string;
}

const CRO_BASE = 'https://services.cro.ie/cws';

const IE_CRO_METADATA: ConnectorMetadata = {
  id: 'conn-ie-cro',
  name: 'Ireland Companies Registration Office (CRO) Open Services',
  shortName: 'Ireland CRO',
  version: '1.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official Irish Companies Registration Office (CRO) Customer Web Services REST API providing Irish company registration numbers (CRO), legal names, company types, statuses, Eircodes, and registered office addresses.',
  supportedCountries: ['IE'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: true,
  supportsPostalCodeFilter: true,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['IE_CRO'],
  capabilities: ['company_search', 'registry_lookup', 'identifier_validation', 'connection_test'],
  credentialRequirements: {
    authType: 'basic_auth',
    required: true,
    fields: [
      {
        key: 'email',
        label: 'CRO Registered Email',
        required: true,
        secret: false,
        placeholder: 'Registered CRO Open Services account email',
        helpText: 'Email registered on services.cro.ie Open Services.',
      },
      {
        key: 'apiKey',
        label: 'CRO Customer API Key',
        required: true,
        secret: true,
        placeholder: 'Enter CRO API key...',
        helpText: 'Paired with registered email in HTTP Basic Authentication.',
      },
    ],
    envFallbackKeys: ['IE_CRO_EMAIL', 'IE_CRO_API_KEY'],
    setupInstructions: 'Register for free CRO Open Services Web API credentials at services.cro.ie and enter your email + Customer API key in LEED Connector Vault.',
    obtainKeyUrl: 'https://services.cro.ie/',
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
      note: 'CRO Open Services fair-use quota',
      waitOnLimit: false,
    },
    defaultPageSize: 20,
    maxPageSize: 50,
    dedupeWindowMs: 5000,
  },
  attribution: 'Companies Registration Office (CRO) Ireland',
  license: 'Irish Public Sector Open Data / CRO Web Services Terms',
  homepageUrl: 'https://services.cro.ie/',
};

export class IeCroConnector implements IConnector {
  public readonly id = 'conn-ie-cro';

  constructor(private readonly fetchFnOverride?: typeof fetch) {}

  public getMetadata(): ConnectorMetadata {
    return IE_CRO_METADATA;
  }

  private getCredentials(context: ConnectorExecutionContext): {
    authHeader?: string;
    knownSecrets: string[];
  } {
    const email = context.credentials.email?.trim() || process.env.IE_CRO_EMAIL?.trim();
    const apiKey = context.credentials.apiKey?.trim() || process.env.IE_CRO_API_KEY?.trim();
    if (!email || !apiKey) {
      return { knownSecrets: [] };
    }
    const token = Buffer.from(`${email}:${apiKey}`, 'utf8').toString('base64');
    return {
      authHeader: `Basic ${token}`,
      knownSecrets: [apiKey, token],
    };
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const checkedAt = new Date().toISOString();
    const { authHeader, knownSecrets } = this.getCredentials(context);
    if (!authHeader) {
      return {
        ok: false,
        healthState: 'authentication_required',
        latencyMs: 0,
        isLiveApi: false,
        errorCategory: 'missing_credentials',
        message: 'Ireland CRO email and API key (IE_CRO_EMAIL / IE_CRO_API_KEY) are required.',
        checkedAt,
      };
    }

    try {
      const res = await executeRegistryJsonRequest<CroCompanyItem[]>({
        providerId: this.id,
        url: `${CRO_BASE}/companies?company_name=Ryanair&max=1&format=json`,
        headers: { Authorization: authHeader },
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        knownSecrets,
        fetchFn: this.fetchFnOverride,
      });

      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: 'Connected to live Ireland CRO Open Services API.',
        checkedAt,
        rateLimitRemaining: res.rateLimitRemaining,
      };
    } catch (err: unknown) {
      const classified = classifyConnectorError(err, this.id, knownSecrets);
      return {
        ok: false,
        healthState:
          classified.category === 'authentication_failure' || classified.category === 'authorization_failure'
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
    request: ConnectorSearchRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorSearchResponse> {
    const { authHeader, knownSecrets } = this.getCredentials(context);
    if (!authHeader) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        message: 'Ireland CRO Open Services credentials are required. Store email & API key in Connector Vault.',
      });
    }

    const query = (request.query || '').trim();
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Irish company name or CRO number is required for search.',
      });
    }

    if (/^\d{4,7}$/.test(query)) {
      const lookup = await this.lookupById({ externalId: query, countryCode: 'IE' }, context);
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
        attribution: IE_CRO_METADATA.attribution,
        notes: lookup.notes,
        isLiveApi: true,
      };
    }

    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(50, Math.max(1, request.pageSize || 20));
    const params = new URLSearchParams({
      company_name: query,
      htmlEnc: '0',
      max: String(pageSize),
      skip: String((page - 1) * pageSize),
      format: 'json',
    });

    const res = await executeRegistryJsonRequest<CroCompanyItem[] | { companies?: CroCompanyItem[] }>({
      providerId: this.id,
      url: `${CRO_BASE}/companies?${params.toString()}`,
      headers: { Authorization: authHeader },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets,
      fetchFn: this.fetchFnOverride,
    });

    const retrievedAt = new Date().toISOString();
    const rawList = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.companies)
      ? res.data!.companies!
      : [];
    const results: StandardizedConnectorResult[] = [];
    for (const item of rawList) {
      const normalized = this.normalizeResult(item, retrievedAt);
      if (normalized) results.push(normalized);
    }

    return {
      results,
      pagination: {
        page,
        pageSize,
        totalItems: results.length,
        totalPages: rawList.length === pageSize ? page + 1 : page,
        hasMore: rawList.length === pageSize,
      },
      rawCount: rawList.length,
      attribution: IE_CRO_METADATA.attribution,
      notes: [`Queried live Ireland CRO Open Services API for "${query}".`],
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const { authHeader, knownSecrets } = this.getCredentials(context);
    if (!authHeader) {
      throw new ConnectorError({
        category: 'missing_credentials',
        providerId: this.id,
        message: 'Ireland CRO Open Services credentials are required for CRO lookup.',
      });
    }

    if (!validateIrishCro(request.externalId)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Invalid Irish CRO number format.',
      });
    }

    const cleanNum = request.externalId.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const res = await executeRegistryJsonRequest<CroCompanyItem>({
      providerId: this.id,
      url: `${CRO_BASE}/company/${encodeURIComponent(cleanNum)}/C?format=json`,
      headers: { Authorization: authHeader },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets,
      allowNotFound: true,
      fetchFn: this.fetchFnOverride,
    });

    if (res.notFound || !res.data?.company_name) {
      return {
        found: false,
        attribution: IE_CRO_METADATA.attribution,
        notes: [`Irish CRO number ${cleanNum} not found.`],
        isLiveApi: true,
      };
    }

    const retrievedAt = new Date().toISOString();
    const normalized = this.normalizeResult(res.data, retrievedAt);
    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: IE_CRO_METADATA.attribution,
      notes: [`Exact Irish CRO ${cleanNum} verified via CRO Open Services API.`],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const rec = raw as CroCompanyItem;
    const croNum = rec?.company_num !== undefined ? String(rec.company_num).trim() : '';
    const name = rec?.company_name?.trim();
    if (!croNum || !name) return null;

    const addressLines = [rec.company_addr_1, rec.company_addr_2, rec.company_addr_3, rec.company_addr_4]
      .filter((s): s is string => Boolean(s && s.trim()))
      .map((s) => s.trim());
    const street = addressLines.slice(0, 2).join(', ') || undefined;
    const city = addressLines.length > 2 ? addressLines[addressLines.length - 1] : rec.place_of_business;

    const companyStatus = normalizeLegalCompanyStatus(rec.company_status_desc, {
      explicitActive: rec.company_status_desc?.toLowerCase() === 'normal',
    });

    const foundedYear =
      rec.company_reg_date && /\d{4}/.test(rec.company_reg_date)
        ? parseInt(rec.company_reg_date.match(/\d{4}/)![0], 10)
        : undefined;
    const sourceUrl = `https://core.cro.ie/`;

    return {
      providerId: this.id,
      providerName: IE_CRO_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'IE',
      externalSourceId: croNum,
      company: {
        companyName: name,
        legalName: name,
        registrationNumber: croNum,
        registrationType: 'IE_CRO',
        companyStatus,
        address: {
          street,
          city,
          postalCode: rec.eircode,
          country: 'Ireland',
          countryCode: 'IE',
        },
        category: rec.company_type_desc || 'Irish Registered Company',
        foundedYear,
        identifiers: [
          {
            type: 'IE_CRO',
            value: croNum,
            normalizedValue: croNum,
            countryCode: 'IE',
            status: 'officially_verified',
            verified: true,
          },
        ],
        rawSource: {
          sourceName: IE_CRO_METADATA.name,
          providerId: croNum,
          url: sourceUrl,
          retrievedAt,
          license: IE_CRO_METADATA.license,
          attribution: IE_CRO_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: 96,
        signals: ['Ireland CRO Official Open Services API'],
      },
      providerMetadata: {
        rawApiRecord: raw,
        rawRegistryStatus: rec.company_status_desc || String(rec.company_status_code || ''),
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
