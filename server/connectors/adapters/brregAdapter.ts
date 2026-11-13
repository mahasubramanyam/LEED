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

interface BrregAddress {
  adresse?: string[];
  postnummer?: string;
  poststed?: string;
  kommunenummer?: string;
  kommune?: string;
  landkode?: string;
  land?: string;
}

interface BrregEnhet {
  organisasjonsnummer: string;
  navn: string;
  organisasjonsform?: {
    kode: string;
    beskrivelse: string;
  };
  naeringskode1?: {
    kode: string;
    beskrivelse: string;
  };
  forretningsadresse?: BrregAddress;
  postadresse?: BrregAddress;
  hjemmeside?: string;
  registreringsdatoEnhetsregisteret?: string;
  konkurs?: boolean;
  underAvvikling?: boolean;
}

const BRREG_BASE = 'https://data.brreg.no/enhetsregisteret/api';

const BRREG_METADATA: ConnectorMetadata = {
  id: 'conn-brreg',
  name: 'Brønnøysund Register Centre (Brreg)',
  shortName: 'Norway Brreg',
  version: '4.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official open Norwegian Central Coordinating Register for Legal Entities (Enhetsregisteret). Provides live organization numbers, NACE codes, legal forms, and registered addresses.',
  supportedCountries: ['NO'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: true,
  supportedIdentifierTypes: ['NO_ORG'],
  capabilities: ['company_search', 'registry_lookup', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions: 'Open public government API (NLOD 2.0). No API key or authentication required.',
    obtainKeyUrl: 'https://data.brreg.no/enhetsregisteret/api/docs/index.html',
  },
  executionPolicy: {
    timeoutMs: 8000,
    maxRetries: 2,
    baseBackoffMs: 400,
    maxBackoffMs: 4000,
    maxConcurrency: 4,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: '100% Free Open API (data.brreg.no), polite client throttling (30 req/min)',
      waitOnLimit: false,
    },
    defaultPageSize: 20,
    maxPageSize: 100,
    dedupeWindowMs: 5000,
  },
  attribution: 'Official open public data from the Brønnøysund Register Centre (NLOD 2.0)',
  license: 'Norwegian Licence for Open Government Data (NLOD 2.0)',
  homepageUrl: 'https://data.brreg.no/enhetsregisteret/api',
};

export class BrregConnector implements IConnector {
  public readonly id = 'conn-brreg';

  public getMetadata(): ConnectorMetadata {
    return BRREG_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(`${BRREG_BASE}/enheter?size=1`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': context.userAgent,
        },
        signal: context.signal,
      });

      const latencyMs = Date.now() - start;
      if (!response.ok) {
        const httpClass = classifyHttpStatus(response.status);
        return {
          ok: false,
          healthState: httpClass.category === 'rate_limited' ? 'rate_limited' : 'temporarily_unavailable',
          latencyMs,
          isLiveApi: true,
          errorCategory: httpClass.category,
          message: `Brreg API returned HTTP ${response.status}: ${response.statusText}`,
          checkedAt,
        };
      }

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `Brreg Enhetsregisteret API reachable (${latencyMs}ms).`,
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

    const pageOneBased = Math.max(1, request.page || 1);
    const pageZeroBased = pageOneBased - 1;
    const size = Math.min(
      BRREG_METADATA.executionPolicy.maxPageSize,
      Math.max(1, request.pageSize || BRREG_METADATA.executionPolicy.defaultPageSize)
    );

    const url = new URL(`${BRREG_BASE}/enheter`);
    // If query looks like a 9-digit Norwegian org number, also try exact org lookup
    const cleanDigits = query.replace(/\s+/g, '');
    if (/^\d{9}$/.test(cleanDigits)) {
      url.searchParams.set('organisasjonsnummer', cleanDigits);
    } else {
      url.searchParams.set('navn', query);
    }
    url.searchParams.set('page', String(pageZeroBased));
    url.searchParams.set('size', String(size));

    const response = await fetch(url.toString(), {
      headers: {
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
        message: `Brreg registry returned HTTP ${response.status}: ${response.statusText}`,
        remediationHint: httpClass.remediationHint,
      });
    }

    let data: {
      _embedded?: { enheter?: BrregEnhet[] };
      page?: { totalElements?: number; totalPages?: number; number?: number; size?: number };
    };
    try {
      data = (await response.json()) as any;
    } catch {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        retryable: false,
        message: 'Brreg registry returned non-JSON response payload.',
      });
    }

    const enheter = data._embedded?.enheter || [];
    const retrievedAt = new Date().toISOString();
    const cityFilter = request.city?.trim().toLowerCase();

    const filtered = enheter.filter((e) => {
      if (!cityFilter) return true;
      const addr = e.forretningsadresse || e.postadresse;
      const city = addr?.poststed || '';
      return city.toLowerCase().includes(cityFilter);
    });

    const results = filtered
      .map((e) => this.normalizeResult(e, retrievedAt))
      .filter((r): r is StandardizedConnectorResult => r !== null);

    const totalItems = data.page?.totalElements ?? results.length;
    const totalPages = data.page?.totalPages ?? 1;
    const notes: string[] = [];
    if (request.region?.trim()) {
      notes.push(
        `Brreg search endpoint filters by company name/org number (and city poststed) only; region "${request.region.trim()}" was not applied by the upstream registry.`
      );
    }

    return {
      results,
      pagination: {
        page: pageOneBased,
        pageSize: size,
        totalItems,
        totalPages,
        hasMore: pageOneBased < totalPages,
      },
      rawCount: enheter.length,
      attribution: BRREG_METADATA.attribution,
      notes,
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const cleanOrg = request.externalId.replace(/\s+/g, '');
    if (!/^\d{9}$/.test(cleanOrg)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: `Invalid Norwegian Organization Number "${request.externalId}". Must be 9 digits.`,
      });
    }

    const response = await fetch(`${BRREG_BASE}/enheter/${encodeURIComponent(cleanOrg)}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': context.userAgent,
      },
      signal: context.signal,
    });

    if (response.status === 404) {
      return {
        found: false,
        attribution: BRREG_METADATA.attribution,
        notes: [`No Norwegian entity found for OrgNr ${cleanOrg}.`],
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
        message: `Brreg lookup returned HTTP ${response.status}`,
      });
    }

    const enhet = (await response.json()) as BrregEnhet;
    const normalized = this.normalizeResult(enhet, new Date().toISOString());

    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: BRREG_METADATA.attribution,
      notes: [],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const e = raw as BrregEnhet;
    if (!e || !e.organisasjonsnummer || !e.navn) return null;

    const addr = e.forretningsadresse || e.postadresse;
    const street = addr?.adresse?.join(', ') || undefined;
    const city = addr?.poststed || undefined;
    const postalCode = addr?.postnummer || undefined;
    const country = addr?.land || 'Norway';
    const countryCode = (addr?.landkode || 'NO').toUpperCase();

    const website = e.hjemmeside
      ? e.hjemmeside.startsWith('http://') || e.hjemmeside.startsWith('https://')
        ? e.hjemmeside
        : `https://${e.hjemmeside}`
      : undefined;

    let domain: string | undefined;
    if (website) {
      try {
        domain = new URL(website).hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        domain = undefined;
      }
    }

    const isDissolved = Boolean(e.konkurs || e.underAvvikling);
    const foundedYear = e.registreringsdatoEnhetsregisteret
      ? parseInt(e.registreringsdatoEnhetsregisteret.slice(0, 4), 10)
      : undefined;

    const signals: string[] = ['Official Government Registry Record (Brreg Verified)'];
    let score = 65;
    if (website) {
      score += 15;
      signals.push('Official Registered Website Present');
    }
    if (e.naeringskode1?.beskrivelse) {
      score += 10;
      signals.push(`Standard NACE Industry Code: ${e.naeringskode1.kode}`);
    }
    if (street && city) {
      score += 10;
      signals.push('Physical Registered Address Verified');
    }

    const identifiers: Array<{
      type: string;
      value: string;
      countryCode: string;
      issuingAuthority: string;
      source: string;
      status: 'officially_verified' | 'syntax_validated' | 'discovered' | 'user_provided';
      verified: boolean;
    }> = [
      {
        type: 'NO_ORG',
        value: e.organisasjonsnummer,
        countryCode: 'NO',
        issuingAuthority: 'Brønnøysundregistrene (Brreg)',
        source: 'brreg_api',
        status: 'officially_verified',
        verified: true,
      },
    ];
    if (domain) {
      identifiers.push({
        type: 'DOMAIN',
        value: domain,
        countryCode: 'NO',
        issuingAuthority: 'DNS / Domain Registry',
        source: 'brreg_api',
        status: 'discovered' as const,
        verified: false,
      });
    }

    return {
      providerId: this.id,
      providerName: BRREG_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode,
      externalSourceId: e.organisasjonsnummer,
      company: {
        companyName: e.navn,
        legalName: e.navn,
        registrationNumber: e.organisasjonsnummer,
        registrationType: 'NO_ORG',
        companyStatus: isDissolved ? 'dissolved' : 'active',
        website,
        domain,
        address: {
          street,
          city,
          postalCode,
          country,
          countryCode,
        },
        industry: e.naeringskode1?.beskrivelse || 'General Commerce & Services',
        category: e.organisasjonsform?.beskrivelse || 'Aksjeselskap (AS)',
        foundedYear: Number.isFinite(foundedYear) ? foundedYear : undefined,
        identifiers,
        tags: ['Norway', 'Official Registry', e.organisasjonsform?.kode || 'AS'].filter(Boolean),
        rawSource: {
          sourceName: BRREG_METADATA.name,
          providerId: e.organisasjonsnummer,
          url: `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${e.organisasjonsnummer}`,
          retrievedAt,
          license: BRREG_METADATA.license,
          attribution: BRREG_METADATA.attribution,
        },
      },
      sourceUrl: `https://data.brreg.no/enhetsregisteret/oppslag/enheter/${e.organisasjonsnummer}`,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'Real-time query against Enhetsregisteret',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score,
        signals,
      },
      providerMetadata: {
        orgFormCode: e.organisasjonsform?.kode,
        naceCode: e.naeringskode1?.kode,
        konkurs: Boolean(e.konkurs),
        underAvvikling: Boolean(e.underAvvikling),
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
