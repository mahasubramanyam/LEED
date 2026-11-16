import { formatSwissUid, validateSwissUid } from '../../identifiers/identifierEngine.js';
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

interface ZefixAddress {
  organisation?: string;
  careOf?: string;
  street?: string;
  houseNumber?: string;
  addon?: string;
  poBox?: string;
  city?: string;
  swissZipCode?: string;
  town?: string;
  swiss_zip_code?: string;
}

interface ZefixCompany {
  name?: string;
  ehraid?: number;
  uid?: string;
  uidFormatted?: string;
  uid_formatted?: string;
  chid?: string;
  legalSeatId?: number;
  legalSeat?: string;
  legal_seat?: string;
  legalForm?: { id?: number; uid?: string; name?: { en?: string; de?: string; fr?: string; it?: string } };
  status?: string;
  canton?: string;
  purpose?: string;
  address?: ZefixAddress;
  cantonalExcerptWeb?: string;
}

const ZEFIX_BASE = 'https://www.zefix.admin.ch/ZefixPublicREST/api/v1';

const CH_ZEFIX_METADATA: ConnectorMetadata = {
  id: 'conn-ch-zefix',
  name: 'Swiss Zefix Central Business Name Index (FOJ)',
  shortName: 'Switzerland Zefix',
  version: '1.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official Swiss Federal Office of Justice Zefix PublicREST API providing cantonal commercial register UID identifiers (CHE-XXX.XXX.XXX), legal names, legal forms, cantons, and registration status.',
  supportedCountries: ['CH'],
  supportsAllCountries: false,
  supportsRegionFilter: true,
  supportsCityFilter: true,
  supportsPostalCodeFilter: false,
  supportsRadiusFilter: false,
  supportsIndustryFilter: false,
  supportedIdentifierTypes: ['CH_UID'],
  capabilities: ['company_search', 'registry_lookup', 'identifier_validation', 'connection_test'],
  credentialRequirements: {
    authType: 'basic_auth',
    required: true,
    fields: [
      {
        key: 'username',
        label: 'Zefix PublicREST Username',
        required: true,
        secret: false,
        placeholder: 'Zefix API username issued by FOJ',
        helpText: 'Issued by the Swiss Federal Office of Justice (zefix@bj.admin.ch).',
      },
      {
        key: 'password',
        label: 'Zefix PublicREST Password',
        required: true,
        secret: true,
        placeholder: 'Enter Zefix API password...',
        helpText: 'Used with HTTP Basic Authentication against www.zefix.admin.ch/ZefixPublicREST.',
      },
    ],
    envFallbackKeys: ['ZEFIX_USERNAME', 'ZEFIX_PASSWORD'],
    setupInstructions: 'Request free public Zefix PublicREST credentials from zefix@bj.admin.ch and store username + password in LEED Credential Vault.',
    obtainKeyUrl: 'https://www.zefix.admin.ch/ZefixPublicREST/',
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
      note: 'Zefix PublicREST authenticated user fair-use quota',
      waitOnLimit: false,
    },
    defaultPageSize: 20,
    maxPageSize: 50,
    dedupeWindowMs: 5000,
  },
  attribution: 'Swiss Federal Office of Justice — Central Business Name Index (Zefix)',
  license: 'Swiss Federal Commercial Register PublicREST Terms',
  homepageUrl: 'https://www.zefix.admin.ch/ZefixPublicREST/',
};

export class ChZefixConnector implements IConnector {
  public readonly id = 'conn-ch-zefix';

  constructor(private readonly fetchFnOverride?: typeof fetch) {}

  public getMetadata(): ConnectorMetadata {
    return CH_ZEFIX_METADATA;
  }

  private getCredentials(context: ConnectorExecutionContext): {
    authHeader?: string;
    knownSecrets: string[];
  } {
    const username = context.credentials.username?.trim() || process.env.ZEFIX_USERNAME?.trim();
    const password = context.credentials.password?.trim() || process.env.ZEFIX_PASSWORD?.trim();
    if (!username || !password) {
      return { knownSecrets: [] };
    }
    const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    return {
      authHeader: `Basic ${token}`,
      knownSecrets: [password, token],
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
        message: 'Swiss Zefix PublicREST username and password (ZEFIX_USERNAME / ZEFIX_PASSWORD) are required.',
        checkedAt,
      };
    }

    try {
      const res = await executeRegistryJsonRequest<ZefixCompany[]>({
        providerId: this.id,
        url: `${ZEFIX_BASE}/company/uid/CHE-105.815.320`,
        headers: { Authorization: authHeader },
        userAgent: context.userAgent,
        timeoutMs: context.timeoutMs,
        knownSecrets,
        allowNotFound: true,
        fetchFn: this.fetchFnOverride,
      });

      return {
        ok: true,
        healthState: 'operational',
        latencyMs: res.latencyMs,
        isLiveApi: true,
        message: 'Connected to live Swiss Zefix PublicREST API.',
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
        message: 'Swiss Zefix PublicREST credentials are required. Store username & password in Owner Connector Vault.',
      });
    }

    const query = (request.query || '').trim();
    if (!query || query.length < 2) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Swiss company name or CHE UID is required for Zefix search.',
      });
    }

    if (validateSwissUid(query)) {
      const lookup = await this.lookupById({ externalId: query, countryCode: 'CH' }, context);
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
        attribution: CH_ZEFIX_METADATA.attribution,
        notes: lookup.notes,
        isLiveApi: true,
      };
    }

    const maxEntries = Math.min(50, Math.max(1, request.pageSize || 20));
    const body: Record<string, unknown> = {
      name: query,
      activeOnly: false,
      maxEntries,
    };
    if (request.region && /^[A-Z]{2}$/i.test(request.region.trim())) {
      body.canton = request.region.trim().toUpperCase();
    }

    const res = await executeRegistryJsonRequest<ZefixCompany[]>({
      providerId: this.id,
      url: `${ZEFIX_BASE}/company/search`,
      method: 'POST',
      headers: { Authorization: authHeader },
      body,
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets,
      fetchFn: this.fetchFnOverride,
    });

    const retrievedAt = new Date().toISOString();
    const rawList = Array.isArray(res.data) ? res.data : [];
    const results: StandardizedConnectorResult[] = [];
    for (const item of rawList) {
      const normalized = this.normalizeResult(item, retrievedAt);
      if (normalized) results.push(normalized);
    }

    return {
      results,
      pagination: {
        page: 1,
        pageSize: maxEntries,
        totalItems: results.length,
        totalPages: 1,
        hasMore: false,
      },
      rawCount: rawList.length,
      attribution: CH_ZEFIX_METADATA.attribution,
      notes: [`Queried live Swiss Zefix PublicREST API for "${query}".`],
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
        message: 'Swiss Zefix PublicREST credentials are required for UID lookup.',
      });
    }

    if (!validateSwissUid(request.externalId)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Invalid Swiss UID. Expected CHE-XXX.XXX.XXX with valid Modulo-11 checksum.',
      });
    }

    const formattedUid = formatSwissUid(request.externalId);
    const res = await executeRegistryJsonRequest<ZefixCompany[] | ZefixCompany>({
      providerId: this.id,
      url: `${ZEFIX_BASE}/company/uid/${encodeURIComponent(formattedUid)}`,
      headers: { Authorization: authHeader },
      userAgent: context.userAgent,
      timeoutMs: context.timeoutMs,
      knownSecrets,
      allowNotFound: true,
      fetchFn: this.fetchFnOverride,
    });

    const record = Array.isArray(res.data) ? res.data[0] : res.data;
    if (res.notFound || !record?.name) {
      return {
        found: false,
        attribution: CH_ZEFIX_METADATA.attribution,
        notes: [`Swiss UID ${formattedUid} not found in Zefix commercial register.`],
        isLiveApi: true,
      };
    }

    const retrievedAt = new Date().toISOString();
    const normalized = this.normalizeResult(record, retrievedAt);
    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: CH_ZEFIX_METADATA.attribution,
      notes: [`Exact Swiss UID ${formattedUid} verified via Zefix PublicREST API.`],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const rec = raw as ZefixCompany;
    const rawUid = rec?.uidFormatted || rec?.uid_formatted || rec?.uid;
    const name = rec?.name?.trim();
    if (!name || !rawUid) return null;

    const formattedUid = validateSwissUid(rawUid) ? formatSwissUid(rawUid) : rawUid;
    const addr = rec.address;
    const street = [addr?.street, addr?.houseNumber, addr?.addon].filter(Boolean).join(' ').trim() || undefined;
    const city = addr?.town || addr?.city || rec.legalSeat || rec.legal_seat;
    const postalCode = addr?.swissZipCode || addr?.swiss_zip_code;
    const companyStatus = normalizeLegalCompanyStatus(rec.status, {
      cancelled: rec.status === 'CANCELLED' || rec.status === 'DELETED',
      explicitActive: rec.status === 'ACTIVE',
    });

    const sourceUrl =
      rec.cantonalExcerptWeb || `https://www.zefix.ch/en/search/entity/list/firm/${encodeURIComponent(String(rec.ehraid || formattedUid))}`;

    return {
      providerId: this.id,
      providerName: CH_ZEFIX_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'CH',
      externalSourceId: formattedUid.replace(/[^A-Z0-9]/g, ''),
      company: {
        companyName: name,
        legalName: name,
        registrationNumber: formattedUid,
        registrationType: 'CH_UID',
        companyStatus,
        address: {
          street,
          city,
          region: rec.canton,
          postalCode,
          country: 'Switzerland',
          countryCode: 'CH',
        },
        category:
          rec.legalForm?.name?.en ||
          rec.legalForm?.name?.de ||
          rec.legalForm?.uid ||
          'Swiss Commercial Entity',
        identifiers: [
          {
            type: 'CH_UID',
            value: formattedUid,
            normalizedValue: formattedUid.replace(/[^A-Z0-9]/g, ''),
            countryCode: 'CH',
            status: 'officially_verified',
            verified: true,
          },
        ],
        rawSource: {
          sourceName: CH_ZEFIX_METADATA.name,
          providerId: formattedUid,
          url: sourceUrl,
          retrievedAt,
          license: CH_ZEFIX_METADATA.license,
          attribution: CH_ZEFIX_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score: 96,
        signals: ['Swiss Zefix Central Business Name Index', 'UID Mod-11 Verified'],
      },
      providerMetadata: {
        rawApiRecord: raw,
        rawRegistryStatus: rec.status || 'UNKNOWN',
        ehraid: rec.ehraid,
        chid: rec.chid,
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
