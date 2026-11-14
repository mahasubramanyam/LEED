import { classifyConnectorError, classifyHttpStatus, ConnectorError } from '../core/errors.js';
import { normalizeLegalCompanyStatus } from '../core/normalizer.js';
import { connectorRegistry } from '../core/registry.js';
import { validateJapaneseCorporateNumber } from '../../identifiers/identifierEngine.js';
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

interface JpNtaCsvRow {
  corporateNumber: string;
  processCode?: string;
  updateDate?: string;
  name: string;
  kind?: string;
  prefectureName?: string;
  cityName?: string;
  streetNumber?: string;
  postCode?: string;
  closeDate?: string;
  closeCause?: string;
  enName?: string;
  enPrefectureName?: string;
  enCityName?: string;
}

const JP_NTA_API_BASE = 'https://api.houjin-bangou.nta.go.jp/4';
const JP_NTA_SITE_BASE = 'https://www.houjin-bangou.nta.go.jp/henkorireki-johoto.html?selHouzinNo=';

const JP_NTA_METADATA: ConnectorMetadata = {
  id: 'conn-jp-nta',
  name: 'Japan NTA Corporate Number (Houjin Bangou)',
  shortName: 'Japan NTA',
  version: '4.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official National Tax Agency of Japan (NTA) Corporate Number Publication Web-API v4. Requires a free registered NTA Application ID; provides offline 13-digit Modulo-9 syntax validation when unconfigured.',
  supportedCountries: ['JP'],
  supportsAllCountries: false,
  supportsRegionFilter: true,
  supportsCityFilter: true,
  supportsPostalCodeFilter: true,
  supportedIdentifierTypes: ['JP_CN'],
  capabilities: ['company_search', 'registry_lookup', 'identifier_validation', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'api_key',
    required: true,
    fields: [
      {
        key: 'apiKey',
        label: 'NTA Application ID',
        required: true,
        secret: true,
        placeholder: 'K1234567890...',
        helpText: 'Application ID issued by the National Tax Agency of Japan (houjin-bangou.nta.go.jp/webapi).',
      },
    ],
    envFallbackKeys: ['JP_NTA_APP_ID'],
    setupInstructions:
      'Apply for a free Web-API v4 Application ID on houjin-bangou.nta.go.jp/webapi and store it in Connectors Hub or set JP_NTA_APP_ID.',
    obtainKeyUrl: 'https://www.houjin-bangou.nta.go.jp/webapi/',
  },
  executionPolicy: {
    timeoutMs: 10000,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 5000,
    maxConcurrency: 2,
    rateLimit: {
      maxRequests: 30,
      windowMs: 60000,
      note: 'NTA Web-API v4 Application ID policy (CC BY 4.0 attribution required)',
      waitOnLimit: false,
    },
    defaultPageSize: 15,
    maxPageSize: 50,
    dedupeWindowMs: 5000,
  },
  attribution: 'National Tax Agency of Japan Corporate Number Publication Site (CC BY 4.0)',
  license: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
  homepageUrl: 'https://www.houjin-bangou.nta.go.jp/webapi/',
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

/**
 * Parses official NTA Web-API v4 UTF-8 CSV response (`type=02`).
 * Row 0 is the metadata header (lastUpdateDate, count, divideNumber, divideSize),
 * followed by corporate number rows (30 columns in NTA v4 format).
 */
function parseNtaCsvPayload(csvText: string): { totalCount: number; rows: JpNtaCsvRow[] } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { totalCount: 0, rows: [] };

  const rows: JpNtaCsvRow[] = [];
  let totalCount = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const cols = parseCsvLine(lines[idx]);
    if (idx === 0 && cols.length <= 6 && /^\d+$/.test((cols[1] || '').trim())) {
      totalCount = parseInt(cols[1], 10) || 0;
      continue;
    }
    const cn = (cols[1] || '').replace(/[^0-9]/g, '');
    const name = (cols[6] || '').trim();
    if (!cn || cn.length !== 13 || !name) continue;
    rows.push({
      corporateNumber: cn,
      processCode: cols[2]?.trim(),
      updateDate: cols[4]?.trim(),
      name,
      kind: cols[8]?.trim(),
      prefectureName: cols[9]?.trim(),
      cityName: cols[10]?.trim(),
      streetNumber: cols[11]?.trim(),
      postCode: cols[15]?.trim(),
      closeDate: cols[18]?.trim(),
      closeCause: cols[19]?.trim(),
      enName: cols[25]?.trim(),
      enPrefectureName: cols[26]?.trim(),
      enCityName: cols[27]?.trim(),
    });
  }

  return { totalCount: totalCount || rows.length, rows };
}

export class JpNtaConnector implements IConnector {
  public readonly id = 'conn-jp-nta';

  public getMetadata(): ConnectorMetadata {
    return JP_NTA_METADATA;
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
          'Japan NTA Application ID is not configured. Add an encrypted Application ID in Connectors Hub or set JP_NTA_APP_ID.',
        checkedAt,
      };
    }

    try {
      const url = new URL(`${JP_NTA_API_BASE}/num`);
      url.searchParams.set('id', apiKey);
      url.searchParams.set('number', '7000012010001');
      url.searchParams.set('type', '02');
      url.searchParams.set('history', '0');

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'text/csv, application/xml, */*',
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
            httpClass.category === 'authentication_failure' || httpClass.category === 'authorization_failure'
              ? 'authentication_required'
              : httpClass.category === 'rate_limited'
              ? 'rate_limited'
              : 'temporarily_unavailable',
          latencyMs,
          isLiveApi: true,
          errorCategory: httpClass.category,
          message:
            response.status === 403 || response.status === 401
              ? 'Japan NTA Web-API rejected the Application ID.'
              : `Japan NTA Web-API returned HTTP ${response.status}.`,
          checkedAt,
        };
      }

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `Japan NTA Corporate Number Web-API v4 reachable (${latencyMs}ms).`,
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

    const apiKey = context.credentials.apiKey?.trim();
    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(
      JP_NTA_METADATA.executionPolicy.maxPageSize,
      Math.max(1, request.pageSize || JP_NTA_METADATA.executionPolicy.defaultPageSize)
    );

    if (!apiKey) {
      return {
        results: [],
        pagination: {
          page: 1,
          pageSize,
          totalItems: 0,
          totalPages: 1,
          hasMore: false,
        },
        rawCount: 0,
        attribution: JP_NTA_METADATA.attribution,
        notes: [
          'Japan NTA Corporate Number Web-API v4 requires a registered Application ID. Configure JP_NTA_APP_ID to enable live queries.',
        ],
        isLiveApi: false,
      };
    }

    const cleanDigits = query.replace(/[^0-9]/g, '');
    const isCnQuery = /^\d{13}$/.test(cleanDigits);
    const endpoint = isCnQuery ? `${JP_NTA_API_BASE}/num` : `${JP_NTA_API_BASE}/name`;
    const url = new URL(endpoint);
    url.searchParams.set('id', apiKey);
    url.searchParams.set('type', '02');
    url.searchParams.set('history', '0');

    if (isCnQuery) {
      url.searchParams.set('number', cleanDigits);
    } else {
      url.searchParams.set('name', query);
      url.searchParams.set('mode', '2');
      url.searchParams.set('divide', String(page));
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'text/csv, text/plain, */*',
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
        message: `Japan NTA API returned HTTP ${response.status}: ${response.statusText}`,
        remediationHint: httpClass.remediationHint,
        knownSecrets: [apiKey],
      });
    }

    const csvText = await response.text();
    const { totalCount, rows } = parseNtaCsvPayload(csvText);
    const retrievedAt = new Date().toISOString();

    const cityFilter = request.city?.trim().toLowerCase();
    const regionFilter = request.region?.trim().toLowerCase();
    const postalFilter = request.postalCode?.trim().replace(/-/g, '').toLowerCase();

    const filtered = rows
      .filter((r) => {
        if (cityFilter) {
          const cityHay = `${r.cityName || ''} ${r.enCityName || ''}`.toLowerCase();
          if (!cityHay.includes(cityFilter)) return false;
        }
        if (regionFilter) {
          const regHay = `${r.prefectureName || ''} ${r.enPrefectureName || ''}`.toLowerCase();
          if (!regHay.includes(regionFilter)) return false;
        }
        if (postalFilter) {
          const p = (r.postCode || '').replace(/-/g, '').toLowerCase();
          if (!p.startsWith(postalFilter)) return false;
        }
        return true;
      })
      .slice(0, pageSize);

    const results = filtered
      .map((r) => this.normalizeResult(r, retrievedAt))
      .filter((r): r is StandardizedConnectorResult => r !== null);

    const totalItems = totalCount || results.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    return {
      results,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasMore: !isCnQuery && rows.length >= pageSize,
      },
      rawCount: rows.length,
      attribution: JP_NTA_METADATA.attribution,
      notes: [],
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const clean = request.externalId.replace(/[^0-9]/g, '');
    if (!validateJapaneseCorporateNumber(clean)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: `Invalid Japanese Corporate Number "${request.externalId}". Must be 13 digits passing NTA Modulo-9 checksum.`,
      });
    }

    const apiKey = context.credentials.apiKey?.trim();
    if (!apiKey) {
      return {
        found: false,
        attribution: JP_NTA_METADATA.attribution,
        notes: [
          `Corporate Number ${clean} passes NTA 13-digit Modulo-9 syntax check, but live lookup requires a configured Japan NTA Application ID.`,
        ],
        isLiveApi: false,
        providerMetadata: {
          checksumValid: true,
        },
      };
    }

    const url = new URL(`${JP_NTA_API_BASE}/num`);
    url.searchParams.set('id', apiKey);
    url.searchParams.set('number', clean);
    url.searchParams.set('type', '02');
    url.searchParams.set('history', '0');

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'text/csv, text/plain, */*',
        'User-Agent': context.userAgent,
      },
      signal: context.signal,
    });

    if (response.status === 404) {
      return {
        found: false,
        attribution: JP_NTA_METADATA.attribution,
        notes: [`Corporate Number ${clean} not found in NTA register.`],
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
        message: `Japan NTA lookup returned HTTP ${response.status}`,
        knownSecrets: [apiKey],
      });
    }

    const csvText = await response.text();
    const { rows } = parseNtaCsvPayload(csvText);
    const match = rows[0];
    if (!match) {
      return {
        found: false,
        attribution: JP_NTA_METADATA.attribution,
        notes: [`No NTA corporate record returned for ${clean}.`],
        isLiveApi: true,
      };
    }

    const result = this.normalizeResult(match, new Date().toISOString()) || undefined;
    return {
      found: Boolean(result),
      result,
      attribution: JP_NTA_METADATA.attribution,
      notes: [],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const r = raw as JpNtaCsvRow;
    if (!r || !r.corporateNumber || !r.name) return null;

    const companyStatus = normalizeLegalCompanyStatus(undefined, {
      cancelled: Boolean(r.closeDate || r.closeCause),
    });

    const sourceUrl = `${JP_NTA_SITE_BASE}${r.corporateNumber}`;
    const region = r.enPrefectureName || r.prefectureName || undefined;
    const city = r.enCityName || r.cityName || undefined;
    const street = r.streetNumber || undefined;

    const signals = ['Official Japan NTA Corporate Number Verified (13-digit Houjin Bangou)'];
    let score = 70;
    if (companyStatus === 'active') {
      score += 10;
      signals.push('Active NTA Corporate Registration');
    }
    if (city && region) {
      score += 10;
      signals.push('Registered Prefecture & Municipality on File');
    }
    if (r.postCode) {
      score += 10;
      signals.push('Registered Japanese Postal Code Verified');
    }

    return {
      providerId: this.id,
      providerName: JP_NTA_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'JP',
      externalSourceId: r.corporateNumber,
      company: {
        companyName: r.enName || r.name,
        legalName: r.name,
        registrationNumber: r.corporateNumber,
        registrationType: 'JP_CN',
        companyStatus,
        address: {
          street,
          city,
          region,
          postalCode: r.postCode,
          country: 'Japan',
          countryCode: 'JP',
        },
        industry: 'Registered Japanese Legal Entity',
        category: r.kind ? `NTA Kind ${r.kind}` : 'Corporate Entity',
        identifiers: [
          {
            type: 'JP_CN',
            value: r.corporateNumber,
            normalizedValue: r.corporateNumber,
            countryCode: 'JP',
            issuingAuthority: 'National Tax Agency of Japan (NTA)',
            source: 'jp_nta_webapi_v4',
            status: 'officially_verified',
            verified: true,
          },
        ],
        tags: ['Japan', 'NTA', 'Houjin Bangou'].filter(Boolean),
        rawSource: {
          sourceName: JP_NTA_METADATA.name,
          providerId: r.corporateNumber,
          url: sourceUrl,
          retrievedAt,
          license: JP_NTA_METADATA.license,
          attribution: JP_NTA_METADATA.attribution,
        },
      },
      sourceUrl,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: r.updateDate || retrievedAt,
        freshnessNote: 'Real-time NTA Web-API v4 query',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score,
        signals,
      },
      providerMetadata: {
        corporateNumber: r.corporateNumber,
        japaneseName: r.name,
        englishName: r.enName,
        closeDate: r.closeDate,
        closeCause: r.closeCause,
        kind: r.kind,
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
