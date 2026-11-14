import { classifyConnectorError, classifyHttpStatus, ConnectorError } from '../core/errors.js';
import { normalizeLegalCompanyStatus } from '../core/normalizer.js';
import { connectorRegistry } from '../core/registry.js';
import { normalizeUsCik, validateUsCik } from '../../identifiers/identifierEngine.js';
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

interface SecCompanyTickerRow {
  cik_str: number;
  ticker: string;
  title: string;
}

interface SecSubmissionAddress {
  street1?: string;
  street2?: string;
  city?: string;
  stateOrCountry?: string;
  zipCode?: string;
  stateOrCountryDescription?: string;
}

interface SecSubmissionProfile {
  cik: string;
  entityType?: string;
  sic?: string;
  sicDescription?: string;
  name: string;
  tickers?: string[];
  exchanges?: string[];
  ein?: string;
  stateOfIncorporation?: string;
  fiscalYearEnd?: string;
  website?: string;
  investorWebsite?: string;
  phone?: string;
  addresses?: {
    mailing?: SecSubmissionAddress;
    business?: SecSubmissionAddress;
  };
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
    };
  };
}

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const SEC_COMPANY_PAGE_BASE = 'https://www.sec.gov/edgar/browse/?CIK=';
const TICKER_CACHE_TTL_MS = 15 * 60 * 1000;

const US_SEC_METADATA: ConnectorMetadata = {
  id: 'conn-us-sec',
  name: 'U.S. SEC EDGAR Corporate Registry',
  shortName: 'US SEC EDGAR',
  version: '4.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official U.S. Securities and Exchange Commission (SEC) EDGAR public registry covering SEC-reporting public companies and filers (CIK, EIN, SIC, business address, filing status). Note: privately held US LLCs/corporations are registered at the state Secretary of State level.',
  supportedCountries: ['US'],
  supportsAllCountries: false,
  supportsRegionFilter: true,
  supportsCityFilter: true,
  supportsPostalCodeFilter: true,
  supportsIndustryFilter: true,
  supportedIdentifierTypes: ['US_CIK', 'US_EIN'],
  capabilities: ['company_search', 'registry_lookup', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions:
      'Open federal SEC EDGAR public API. Requires a declared descriptive User-Agent header and compliance with SEC Fair Access policy (<= 10 requests/sec).',
    obtainKeyUrl: 'https://www.sec.gov/os/accessing-edgar-data',
  },
  executionPolicy: {
    timeoutMs: 10000,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 5000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 8,
      windowMs: 1000,
      note: 'SEC Fair Access policy: <= 10 req/sec with declared User-Agent (throttled to 8 req/sec)',
      waitOnLimit: true,
    },
    defaultPageSize: 10,
    maxPageSize: 25,
    dedupeWindowMs: 5000,
  },
  attribution: 'U.S. Securities and Exchange Commission (SEC) EDGAR Public Data',
  license: 'U.S. Federal Public Domain (17 U.S.C. § 105)',
  homepageUrl: 'https://www.sec.gov/edgar/searchedgar/companysearch',
};

export class UsSecEdgarConnector implements IConnector {
  public readonly id = 'conn-us-sec';
  private tickerCache: { fetchedAt: number; rows: SecCompanyTickerRow[] } | null = null;

  public getMetadata(): ConnectorMetadata {
    return US_SEC_METADATA;
  }

  private buildHeaders(userAgent: string): Record<string, string> {
    const cleanUa =
      userAgent && userAgent.trim().length >= 8
        ? userAgent.trim()
        : 'LEED-Intelligence/1.0 (compliance@leed-pipeline.local)';
    return {
      Accept: 'application/json',
      'User-Agent': cleanUa,
    };
  }

  private async getTickerIndex(context: ConnectorExecutionContext): Promise<SecCompanyTickerRow[]> {
    if (this.tickerCache && Date.now() - this.tickerCache.fetchedAt < TICKER_CACHE_TTL_MS) {
      return this.tickerCache.rows;
    }

    const response = await fetch(SEC_TICKERS_URL, {
      headers: this.buildHeaders(context.userAgent),
      signal: context.signal,
    });

    if (!response.ok) {
      const httpClass = classifyHttpStatus(response.status);
      throw new ConnectorError({
        category: httpClass.category,
        providerId: this.id,
        httpStatus: response.status,
        retryable: httpClass.retryable,
        message: `SEC EDGAR ticker index returned HTTP ${response.status}: ${response.statusText}`,
        remediationHint: httpClass.remediationHint,
      });
    }

    let raw: Record<string, SecCompanyTickerRow>;
    try {
      raw = (await response.json()) as Record<string, SecCompanyTickerRow>;
    } catch {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        retryable: false,
        message: 'SEC EDGAR returned non-JSON payload for company tickers.',
      });
    }

    const rows = Object.values(raw || {}).filter(
      (r): r is SecCompanyTickerRow => Boolean(r && r.cik_str && r.title)
    );
    this.tickerCache = { fetchedAt: Date.now(), rows };
    return rows;
  }

  private async fetchSubmissionProfile(
    cik: string,
    context: ConnectorExecutionContext
  ): Promise<SecSubmissionProfile | null> {
    const padded = normalizeUsCik(cik);
    if (!padded) return null;

    const response = await fetch(`${SEC_SUBMISSIONS_BASE}/CIK${padded}.json`, {
      headers: this.buildHeaders(context.userAgent),
      signal: context.signal,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const httpClass = classifyHttpStatus(response.status);
      throw new ConnectorError({
        category: httpClass.category,
        providerId: this.id,
        httpStatus: response.status,
        retryable: httpClass.retryable,
        message: `SEC EDGAR submissions API returned HTTP ${response.status}`,
        remediationHint: httpClass.remediationHint,
      });
    }

    try {
      return (await response.json()) as SecSubmissionProfile;
    } catch {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        retryable: false,
        message: 'SEC EDGAR submissions API returned malformed JSON.',
      });
    }
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(`${SEC_SUBMISSIONS_BASE}/CIK0000320193.json`, {
        headers: this.buildHeaders(context.userAgent),
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
          message: `SEC EDGAR returned HTTP ${response.status}: ${response.statusText}`,
          checkedAt,
        };
      }

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `US SEC EDGAR official submissions API reachable (${latencyMs}ms).`,
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

    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(
      US_SEC_METADATA.executionPolicy.maxPageSize,
      Math.max(1, request.pageSize || US_SEC_METADATA.executionPolicy.defaultPageSize)
    );
    const retrievedAt = new Date().toISOString();
    const notes: string[] = [
      'SEC EDGAR covers US public/SEC-reporting corporations. Private LLCs and state-only corporations require state Secretary of State portals.',
    ];

    const digitsOnly = query.replace(/[^0-9]/g, '');
    if (/^\d{4,10}$/.test(digitsOnly) && digitsOnly === query.replace(/[\s-]/g, '')) {
      const profile = await this.fetchSubmissionProfile(digitsOnly, context);
      const norm = profile ? this.normalizeResult(profile, retrievedAt) : null;
      return {
        results: norm ? [norm] : [],
        pagination: {
          page: 1,
          pageSize,
          totalItems: norm ? 1 : 0,
          totalPages: 1,
          hasMore: false,
        },
        rawCount: profile ? 1 : 0,
        attribution: US_SEC_METADATA.attribution,
        notes,
        isLiveApi: true,
      };
    }

    const allRows = await this.getTickerIndex(context);
    const qLower = query.toLowerCase();
    const matchedRows = allRows.filter((row) => {
      const titleLower = row.title.toLowerCase();
      const tickerLower = (row.ticker || '').toLowerCase();
      return tickerLower === qLower || titleLower.includes(qLower);
    });

    // Prioritize exact ticker or prefix matches
    matchedRows.sort((a, b) => {
      const aExact = a.ticker?.toLowerCase() === qLower ? 2 : a.title.toLowerCase().startsWith(qLower) ? 1 : 0;
      const bExact = b.ticker?.toLowerCase() === qLower ? 2 : b.title.toLowerCase().startsWith(qLower) ? 1 : 0;
      return bExact - aExact;
    });

    const totalItems = matchedRows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const offset = (page - 1) * pageSize;
    const pageSlice = matchedRows.slice(offset, offset + pageSize);

    // Fetch authoritative SEC submission profiles for the current page (bounded batch)
    const profiles: Array<SecSubmissionProfile | SecCompanyTickerRow> = [];
    for (let i = 0; i < pageSlice.length; i += 3) {
      if (context.signal.aborted) break;
      const chunk = pageSlice.slice(i, i + 3);
      const chunkResults = await Promise.all(
        chunk.map(async (row) => {
          try {
            const prof = await this.fetchSubmissionProfile(String(row.cik_str), context);
            return prof || row;
          } catch {
            return row;
          }
        })
      );
      profiles.push(...chunkResults);
    }

    const cityFilter = request.city?.trim().toLowerCase();
    const regionFilter = request.region?.trim().toLowerCase();
    const postalFilter = request.postalCode?.trim().toLowerCase();
    const industryFilter = (request.industry || request.category || request.businessType || '').trim().toLowerCase();

    const normalized = profiles
      .map((item) => this.normalizeResult(item, retrievedAt))
      .filter((r): r is StandardizedConnectorResult => r !== null)
      .filter((r) => {
        if (cityFilter && !(r.company.address?.city || '').toLowerCase().includes(cityFilter)) return false;
        if (
          regionFilter &&
          !(r.company.address?.region || '').toLowerCase().includes(regionFilter)
        ) {
          return false;
        }
        if (postalFilter && !(r.company.address?.postalCode || '').toLowerCase().startsWith(postalFilter)) {
          return false;
        }
        if (industryFilter && !(r.company.industry || '').toLowerCase().includes(industryFilter)) {
          return false;
        }
        return true;
      });

    return {
      results: normalized,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasMore: offset + pageSlice.length < totalItems,
      },
      rawCount: pageSlice.length,
      attribution: US_SEC_METADATA.attribution,
      notes,
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const clean = request.externalId.trim();
    if (!validateUsCik(clean)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: `Invalid U.S. SEC CIK "${request.externalId}". Must be 1 to 10 digits.`,
      });
    }

    const profile = await this.fetchSubmissionProfile(clean, context);
    if (!profile) {
      return {
        found: false,
        attribution: US_SEC_METADATA.attribution,
        notes: [`CIK ${normalizeUsCik(clean)} not found in SEC EDGAR submissions database.`],
        isLiveApi: true,
      };
    }

    const result = this.normalizeResult(profile, new Date().toISOString()) || undefined;
    return {
      found: Boolean(result),
      result,
      attribution: US_SEC_METADATA.attribution,
      notes: [],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    if (!raw || typeof raw !== 'object') return null;

    // Handle full SecSubmissionProfile vs lightweight SecCompanyTickerRow fallback
    const maybeProfile = raw as Partial<SecSubmissionProfile & SecCompanyTickerRow>;
    const rawCik = maybeProfile.cik ?? (maybeProfile.cik_str ? String(maybeProfile.cik_str) : '');
    const companyName = (maybeProfile.name || maybeProfile.title || '').trim();
    if (!rawCik || !companyName) return null;

    const cik10 = normalizeUsCik(String(rawCik));
    const bizAddr = maybeProfile.addresses?.business || maybeProfile.addresses?.mailing;
    const street = [bizAddr?.street1, bizAddr?.street2].filter(Boolean).join(', ') || undefined;
    const city = bizAddr?.city || undefined;
    const region = bizAddr?.stateOrCountry || maybeProfile.stateOfIncorporation || undefined;
    const postalCode = bizAddr?.zipCode || undefined;

    const recentForms = maybeProfile.filings?.recent?.form || [];
    const hasSuspensionOrDereg = recentForms.slice(0, 5).some((f) => /^(15-|RW|25)/i.test(f));
    const companyStatus = maybeProfile.addresses || recentForms.length > 0
      ? hasSuspensionOrDereg
        ? normalizeLegalCompanyStatus('suspended')
        : normalizeLegalCompanyStatus('active')
      : 'active';

    const cleanEin = maybeProfile.ein && !/^0+$/.test(maybeProfile.ein) ? maybeProfile.ein : undefined;
    const identifiers: StandardizedConnectorResult['company']['identifiers'] = [
      {
        type: 'US_CIK',
        value: cik10,
        normalizedValue: cik10,
        countryCode: 'US',
        issuingAuthority: 'U.S. Securities and Exchange Commission (SEC)',
        source: 'sec_edgar_api',
        status: 'officially_verified',
        verified: true,
      },
    ];
    if (cleanEin) {
      identifiers.push({
        type: 'US_EIN',
        value: cleanEin,
        countryCode: 'US',
        issuingAuthority: 'Internal Revenue Service / SEC Filing',
        source: 'sec_edgar_api',
        status: 'officially_verified',
        verified: true,
      });
    }

    const signals = ['Official U.S. SEC EDGAR Registration (CIK Verified)'];
    let score = 70;
    if (cleanEin) {
      score += 10;
      signals.push('Federal EIN Present on SEC Filing');
    }
    if (street && city && region) {
      score += 10;
      signals.push('SEC Business Address on File');
    }
    if (maybeProfile.sicDescription) {
      score += 10;
      signals.push(`SEC SIC Classification: ${maybeProfile.sic || maybeProfile.sicDescription}`);
    }

    const websiteRaw = maybeProfile.website || maybeProfile.investorWebsite;
    const website = websiteRaw
      ? websiteRaw.startsWith('http://') || websiteRaw.startsWith('https://')
        ? websiteRaw
        : `https://${websiteRaw}`
      : undefined;

    const sourceUrl = `${SEC_COMPANY_PAGE_BASE}${cik10}`;
    const tickers = Array.isArray(maybeProfile.tickers)
      ? maybeProfile.tickers
      : maybeProfile.ticker
      ? [maybeProfile.ticker]
      : [];

    return {
      providerId: this.id,
      providerName: US_SEC_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'US',
      externalSourceId: cik10,
      company: {
        companyName,
        legalName: companyName,
        registrationNumber: cik10,
        registrationType: 'US_CIK',
        companyStatus,
        website,
        phone: maybeProfile.phone || undefined,
        address: {
          street,
          city,
          region,
          postalCode,
          country: 'United States',
          countryCode: 'US',
        },
        industry: maybeProfile.sicDescription || 'SEC Reporting Corporation',
        category: maybeProfile.entityType || 'Public / SEC Filer',
        identifiers,
        tags: ['United States', 'SEC EDGAR', ...tickers.slice(0, 2)].filter(Boolean),
        rawSource: {
          sourceName: US_SEC_METADATA.name,
          providerId: cik10,
          url: sourceUrl,
          retrievedAt,
          license: US_SEC_METADATA.license,
          attribution: US_SEC_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: maybeProfile.filings?.recent?.filingDate?.[0] || retrievedAt,
        freshnessNote: 'Real-time SEC EDGAR submissions & CIK index',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score,
        signals,
      },
      providerMetadata: {
        cik: cik10,
        ein: cleanEin,
        sic: maybeProfile.sic,
        tickers,
        exchanges: maybeProfile.exchanges,
        stateOfIncorporation: maybeProfile.stateOfIncorporation,
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
