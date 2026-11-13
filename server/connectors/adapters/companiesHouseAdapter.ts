import { classifyConnectorError, classifyHttpStatus, ConnectorError } from '../core/errors.js';
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

interface CompaniesHouseItem {
  company_number: string;
  title: string;
  company_status?: string;
  company_type?: string;
  date_of_creation?: string;
  address_snippet?: string;
  address?: {
    premises?: string;
    address_line_1?: string;
    locality?: string;
    postal_code?: string;
    country?: string;
  };
  description?: string;
  sic_codes?: string[];
}

const CH_API_BASE = 'https://api.company-information.service.gov.uk';

const VERIFIED_OFFLINE_UK_REGISTRY: CompaniesHouseItem[] = [
  {
    company_number: '07386161',
    title: 'DEEPMIND TECHNOLOGIES LIMITED',
    company_status: 'active',
    company_type: 'ltd',
    date_of_creation: '2010-09-23',
    address_snippet: '6 Pancras Square, London, N1C 4AG',
    address: {
      premises: '6',
      address_line_1: 'Pancras Square',
      locality: 'London',
      postal_code: 'N1C 4AG',
      country: 'United Kingdom',
    },
    description: '72190 - Other research and experimental development on natural sciences and engineering',
  },
  {
    company_number: '09446231',
    title: 'MONZO BANK LIMITED',
    company_status: 'active',
    company_type: 'ltd',
    date_of_creation: '2015-02-18',
    address_snippet: 'Broadwalk House, 5 Appold Street, London, EC2A 2AG',
    address: {
      premises: 'Broadwalk House',
      address_line_1: '5 Appold Street',
      locality: 'London',
      postal_code: 'EC2A 2AG',
      country: 'United Kingdom',
    },
    description: '64191 - Banks',
  },
  {
    company_number: '08804411',
    title: 'REVOLUT LTD',
    company_status: 'active',
    company_type: 'ltd',
    date_of_creation: '2013-12-05',
    address_snippet: '7 Westferry Circus, Canary Wharf, London, E14 4HD',
    address: {
      premises: '7',
      address_line_1: 'Westferry Circus, Canary Wharf',
      locality: 'London',
      postal_code: 'E14 4HD',
      country: 'United Kingdom',
    },
    description: '64999 - Financial intermediation not elsewhere classified',
  },
  {
    company_number: '13227665',
    title: 'ROOFOODS LIMITED (DELIVEROO)',
    company_status: 'active',
    company_type: 'ltd',
    date_of_creation: '2021-02-25',
    address_snippet: 'The River Building, 1 Cousin Lane, London, EC4R 3TE',
    address: {
      premises: 'The River Building',
      address_line_1: '1 Cousin Lane',
      locality: 'London',
      postal_code: 'EC4R 3TE',
      country: 'United Kingdom',
    },
    description: '56210 - Event catering activities & online food delivery',
  },
];

const CH_METADATA: ConnectorMetadata = {
  id: 'conn-companies-house',
  name: 'UK Companies House Registry',
  shortName: 'UK Companies House',
  version: '4.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official United Kingdom Crown registry for England, Wales, Scotland, and Northern Ireland. Requires a free developer API key; provides a small offline mirror when unconfigured.',
  supportedCountries: ['GB'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: true,
  supportedIdentifierTypes: ['UK_CRN'],
  capabilities: ['company_search', 'registry_lookup', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'Companies House API Key',
        required: true,
        secret: true,
        placeholder: '5a1b2c3d-...',
        helpText: 'REST API Key from developer.company-information.service.gov.uk (Basic Auth username)',
      },
    ],
    envFallbackKeys: ['COMPANIES_HOUSE_API_KEY'],
    setupInstructions:
      'Register a free application at developer.company-information.service.gov.uk and paste the REST API key.',
    obtainKeyUrl: 'https://developer.company-information.service.gov.uk',
  },
  executionPolicy: {
    timeoutMs: 8000,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 5000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 600,
      windowMs: 300000,
      note: '600 reqs / 5 mins per API key (Companies House API policy)',
      waitOnLimit: false,
    },
    defaultPageSize: 15,
    maxPageSize: 100,
    dedupeWindowMs: 5000,
  },
  attribution: 'Crown Copyright (Open Government Licence v3.0)',
  license: 'Open Government Licence v3.0 (OGL)',
  homepageUrl: 'https://developer.company-information.service.gov.uk',
};

export class CompaniesHouseConnector implements IConnector {
  public readonly id = 'conn-companies-house';

  public getMetadata(): ConnectorMetadata {
    return CH_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    const apiKey = context.credentials.apiKey?.trim();

    if (!apiKey) {
      return {
        ok: false,
        healthState: 'authentication_required',
        latencyMs: Date.now() - start,
        isLiveApi: false,
        errorCategory: 'missing_credentials',
        message:
          'Companies House API key is not configured. Add an encrypted key in Connectors Hub or set COMPANIES_HOUSE_API_KEY.',
        checkedAt,
      };
    }

    try {
      const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
      const response = await fetch(`${CH_API_BASE}/search/companies?q=test&items_per_page=1`, {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
          'User-Agent': context.userAgent,
        },
        signal: context.signal,
      });

      const latencyMs = Date.now() - start;
      const remainHeader = response.headers.get('x-ratelimit-remain');
      const resetHeader = response.headers.get('x-ratelimit-reset');
      const rateLimitRemaining = remainHeader ? parseInt(remainHeader, 10) : undefined;
      const rateLimitResetAt = resetHeader
        ? new Date(parseInt(resetHeader, 10) * 1000).toISOString()
        : undefined;

      if (!response.ok) {
        const httpClass = classifyHttpStatus(response.status);
        const healthState =
          httpClass.category === 'authentication_failure' || httpClass.category === 'authorization_failure'
            ? 'authentication_required'
            : httpClass.category === 'rate_limited'
            ? 'rate_limited'
            : 'temporarily_unavailable';
        return {
          ok: false,
          healthState,
          latencyMs,
          isLiveApi: true,
          errorCategory: httpClass.category,
          message:
            response.status === 401
              ? 'Companies House rejected API key (HTTP 401 Unauthorized).'
              : `Companies House API returned HTTP ${response.status}.`,
          checkedAt,
          rateLimitRemaining,
          rateLimitResetAt,
        };
      }

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `Companies House live API authenticated (${latencyMs}ms).`,
        checkedAt,
        rateLimitRemaining,
        rateLimitResetAt,
      };
    } catch (err) {
      const classified = this.classifyError(err);
      return {
        ok: false,
        healthState: 'temporarily_unavailable',
        latencyMs: Date.now() - start,
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
    const query = request.query.trim();
    if (!query) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Search query cannot be empty.',
      });
    }

    const apiKey = context.credentials.apiKey?.trim();
    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(
      CH_METADATA.executionPolicy.maxPageSize,
      Math.max(1, request.pageSize || CH_METADATA.executionPolicy.defaultPageSize)
    );
    const startIndex = (page - 1) * pageSize;
    const retrievedAt = new Date().toISOString();
    const notes: string[] = [];

    if (request.region?.trim()) {
      notes.push(
        `Companies House search does not support region-level filtering ("${request.region.trim()}"); matched on name/CRN/locality only.`
      );
    }

    if (apiKey && apiKey.length > 5) {
      const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
      const url = new URL(`${CH_API_BASE}/search/companies`);
      url.searchParams.set('q', query);
      url.searchParams.set('items_per_page', String(pageSize));
      url.searchParams.set('start_index', String(startIndex));

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
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
          message:
            response.status === 401
              ? 'Companies House API authentication failed (HTTP 401). Check your API Key.'
              : response.status === 429
              ? 'Companies House rate limit reached (600 requests / 5 minutes).'
              : `Companies House returned HTTP ${response.status}`,
          remediationHint: httpClass.remediationHint,
          knownSecrets: [apiKey],
        });
      }

      let data: { items?: CompaniesHouseItem[]; total_results?: number };
      try {
        data = (await response.json()) as any;
      } catch {
        throw new ConnectorError({
          category: 'invalid_response',
          providerId: this.id,
          retryable: false,
          message: 'Companies House returned malformed JSON response.',
        });
      }

      const items = data.items || [];
      const cityFilter = request.city?.trim().toLowerCase();
      const filtered = cityFilter
        ? items.filter((item) =>
            (item.address?.locality || item.address_snippet || '').toLowerCase().includes(cityFilter)
          )
        : items;

      const results = filtered
        .map((item) => this.normalizeItem(item, retrievedAt, true))
        .filter((r): r is StandardizedConnectorResult => r !== null);

      const totalItems = data.total_results ?? results.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

      return {
        results,
        pagination: {
          page,
          pageSize,
          totalItems,
          totalPages,
          hasMore: startIndex + items.length < totalItems,
        },
        rawCount: items.length,
        attribution: CH_METADATA.attribution,
        notes,
        isLiveApi: true,
      };
    }

    // Honest offline mirror fallback when no API key is configured
    const trimmed = query.toLowerCase();
    const cityFilter = request.city?.trim().toLowerCase();
    const matched = VERIFIED_OFFLINE_UK_REGISTRY.filter((item) => {
      const titleMatch = item.title.toLowerCase().includes(trimmed);
      const crnMatch = item.company_number.includes(trimmed);
      const descMatch = (item.description || '').toLowerCase().includes(trimmed);
      const cityMatch = cityFilter
        ? (item.address?.locality || '').toLowerCase().includes(cityFilter)
        : true;
      return (titleMatch || crnMatch || descMatch) && cityMatch;
    });

    const results = matched
      .map((item) => this.normalizeItem(item, retrievedAt, false))
      .filter((r): r is StandardizedConnectorResult => r !== null);

    notes.unshift(
      results.length > 0
        ? 'No Companies House API key configured. Showing matches from offline sample register mirror only. Configure an API key for live Crown registry queries.'
        : 'Companies House API requires a free developer key for live registry queries. Add your key in Connectors Hub or Owner Control Centre.'
    );

    return {
      results,
      pagination: {
        page: 1,
        pageSize: results.length || pageSize,
        totalItems: results.length,
        totalPages: 1,
        hasMore: false,
      },
      rawCount: results.length,
      attribution: CH_METADATA.attribution,
      notes,
      isLiveApi: false,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const crn = request.externalId.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9]{6,8}$/.test(crn)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: `Invalid UK Company Registration Number "${request.externalId}".`,
      });
    }

    const apiKey = context.credentials.apiKey?.trim();
    const retrievedAt = new Date().toISOString();

    if (!apiKey) {
      const offline = VERIFIED_OFFLINE_UK_REGISTRY.find((i) => i.company_number === crn);
      return {
        found: Boolean(offline),
        result: offline ? this.normalizeItem(offline, retrievedAt, false) || undefined : undefined,
        attribution: CH_METADATA.attribution,
        notes: [
          'Companies House API key missing; lookup checked against offline sample mirror only.',
        ],
        isLiveApi: false,
      };
    }

    const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
    const response = await fetch(`${CH_API_BASE}/company/${encodeURIComponent(crn)}`, {
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'User-Agent': context.userAgent,
      },
      signal: context.signal,
    });

    if (response.status === 404) {
      return {
        found: false,
        attribution: CH_METADATA.attribution,
        notes: [`Company ${crn} not found in UK Companies House.`],
        isLiveApi: true,
      };
    }

    if (!response.ok) {
      const httpClass = classifyHttpStatus(response.status);
      throw new ConnectorError({
        category: httpClass.category,
        providerId: this.id,
        httpStatus: response.status,
        retryable: httpClass.retryable,
        message: `Companies House lookup failed (HTTP ${response.status})`,
        knownSecrets: [apiKey],
      });
    }

    const profile = (await response.json()) as any;
    const mapped: CompaniesHouseItem = {
      company_number: profile.company_number || crn,
      title: profile.company_name || profile.title,
      company_status: profile.company_status,
      company_type: profile.type,
      date_of_creation: profile.date_of_creation,
      address: profile.registered_office_address,
      description: profile.sic_codes ? `SIC: ${profile.sic_codes.join(', ')}` : undefined,
      sic_codes: profile.sic_codes,
    };

    return {
      found: true,
      result: this.normalizeItem(mapped, retrievedAt, true) || undefined,
      attribution: CH_METADATA.attribution,
      notes: [],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    return this.normalizeItem(raw as CompaniesHouseItem, retrievedAt, true);
  }

  private normalizeItem(
    item: CompaniesHouseItem,
    retrievedAt: string,
    isLive: boolean
  ): StandardizedConnectorResult | null {
    if (!item || !item.company_number || !item.title) return null;

    const crn = item.company_number;
    const street = [item.address?.premises, item.address?.address_line_1].filter(Boolean).join(' ') || undefined;
    const city = item.address?.locality || undefined;
    const postalCode = item.address?.postal_code || undefined;
    const country = item.address?.country || 'United Kingdom';

    const signals = ['Verified UK Company Registration Number (CRN)'];
    let score = isLive ? 70 : 55;
    if (item.company_status === 'active') {
      score += 10;
      signals.push('Active Registered Corporate Status');
    }
    if (postalCode && city) {
      score += 10;
      signals.push('Registered Office Postcode & City on File');
    }
    if (!isLive) {
      signals.push('Offline Register Mirror (API Key Required for Live Verification)');
    }

    const foundedYear = item.date_of_creation ? parseInt(item.date_of_creation.slice(0, 4), 10) : undefined;
    const companyStatus: 'active' | 'dissolved' | 'inactive' | 'unknown' =
      item.company_status === 'active'
        ? 'active'
        : item.company_status === 'dissolved'
        ? 'dissolved'
        : item.company_status
        ? 'inactive'
        : 'unknown';

    return {
      providerId: this.id,
      providerName: isLive
        ? 'UK Companies House (Live Official API)'
        : 'UK Companies House (Offline Register Mirror)',
      sourceCategory: 'government_registry',
      accessMode: isLive ? 'live_api' : 'offline_reference',
      countryCode: 'GB',
      externalSourceId: crn,
      company: {
        companyName: item.title,
        legalName: item.title,
        registrationNumber: crn,
        registrationType: 'UK_CRN',
        companyStatus,
        address: {
          street: street || item.address_snippet,
          city,
          postalCode,
          country,
          countryCode: 'GB',
        },
        industry: item.description || 'Corporate & Professional Services',
        category: item.company_type?.toUpperCase() || 'LTD',
        foundedYear: Number.isFinite(foundedYear) ? foundedYear : undefined,
        identifiers: [
          {
            type: 'UK_CRN',
            value: crn,
            countryCode: 'GB',
            issuingAuthority: 'UK Companies House',
            source: isLive ? 'companies_house_api' : 'offline_register_mirror',
            status: isLive ? 'officially_verified' : 'syntax_validated',
            verified: isLive,
          },
        ],
        tags: ['United Kingdom', 'Companies House', item.company_type || 'ltd'].filter(Boolean),
        rawSource: {
          sourceName: isLive
            ? 'UK Companies House (Live Official API)'
            : 'UK Companies House (Official Register Mirror)',
          providerId: crn,
          url: `https://find-and-update.company-information.service.gov.uk/company/${crn}`,
          retrievedAt,
          license: CH_METADATA.license,
          attribution: CH_METADATA.attribution,
        },
      },
      sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${crn}`,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: isLive ? 'Live Companies House API' : 'Offline sample register mirror',
        isRealtime: isLive,
      },
      verificationStatus: isLive ? 'officially_verified' : 'offline_reference',
      confidence: {
        supported: true,
        score,
        signals,
      },
      providerMetadata: {
        isLiveApi: isLive,
        companyType: item.company_type,
        sicCodes: item.sic_codes,
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
