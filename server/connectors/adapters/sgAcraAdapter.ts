import { classifyConnectorError, classifyHttpStatus, ConnectorError } from '../core/errors.js';
import { normalizeLegalCompanyStatus } from '../core/normalizer.js';
import { connectorRegistry } from '../core/registry.js';
import { normalizeIdentifierValue, validateSingaporeUen } from '../../identifiers/identifierEngine.js';
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

interface SgAcraRecord {
  _id?: number;
  uen: string;
  issuance_agency_id?: string;
  entity_name: string;
  entity_type_desc?: string;
  business_constitution_desc?: string;
  company_type_desc?: string;
  paf_principle_desc?: string;
  entity_status_description?: string;
  uen_status_desc?: string;
  registration_incorporation_date?: string;
  uen_issue_date?: string;
  address_type?: string;
  block?: string;
  street_name?: string;
  level_no?: string;
  unit_no?: string;
  building_name?: string;
  postal_code?: string;
  reg_street_name?: string;
  reg_postal_code?: string;
  primary_ssic_code?: string;
  primary_ssic_description?: string;
}

const DATA_GOV_SG_API = 'https://data.gov.sg/api/action/datastore_search';
const ACRA_RESOURCE_ID = 'd_3f960c10fed6145404ca7b821f263b87';
const ACRA_DATASET_URL = `https://data.gov.sg/datasets/${ACRA_RESOURCE_ID}/view`;

const SG_ACRA_METADATA: ConnectorMetadata = {
  id: 'conn-sg-acra',
  name: 'Singapore ACRA Entities (data.gov.sg)',
  shortName: 'Singapore ACRA',
  version: '4.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official Singapore ACRA Registered Entities open dataset via data.gov.sg (UEN, legal name, entity status, SSIC industry classification, and registered office address). Note: transactional BizFile+ officer profiles require SingPass / ACRA API Mall.',
  supportedCountries: ['SG'],
  supportsAllCountries: false,
  supportsRegionFilter: false,
  supportsCityFilter: false,
  supportsPostalCodeFilter: true,
  supportsIndustryFilter: true,
  supportedIdentifierTypes: ['SG_UEN'],
  capabilities: ['company_search', 'registry_lookup', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions:
      'Open public government dataset via data.gov.sg CKAN DataStore API (Singapore Open Data Licence v1.0). No API key required.',
    obtainKeyUrl: ACRA_DATASET_URL,
  },
  executionPolicy: {
    timeoutMs: 10000,
    maxRetries: 2,
    baseBackoffMs: 500,
    maxBackoffMs: 5000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 25,
      windowMs: 60000,
      note: 'Open data.gov.sg CKAN DataStore API, client-throttled to 25 req/min',
      waitOnLimit: false,
    },
    defaultPageSize: 15,
    maxPageSize: 50,
    dedupeWindowMs: 5000,
  },
  attribution: 'Accounting and Corporate Regulatory Authority (ACRA) via data.gov.sg',
  license: 'Singapore Open Data Licence v1.0',
  homepageUrl: ACRA_DATASET_URL,
};

export class SgAcraConnector implements IConnector {
  public readonly id = 'conn-sg-acra';

  public getMetadata(): ConnectorMetadata {
    return SG_ACRA_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const url = new URL(DATA_GOV_SG_API);
      url.searchParams.set('resource_id', ACRA_RESOURCE_ID);
      url.searchParams.set('limit', '1');

      const response = await fetch(url.toString(), {
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
          message: `data.gov.sg ACRA API returned HTTP ${response.status}: ${response.statusText}`,
          checkedAt,
        };
      }

      const payload = (await response.json()) as { success?: boolean };
      if (payload.success === false) {
        return {
          ok: false,
          healthState: 'temporarily_unavailable',
          latencyMs,
          isLiveApi: true,
          errorCategory: 'provider_unavailable',
          message: 'data.gov.sg ACRA endpoint reported datastore unavailable.',
          checkedAt,
        };
      }

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `Singapore ACRA open dataset API reachable (${latencyMs}ms).`,
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
      SG_ACRA_METADATA.executionPolicy.maxPageSize,
      Math.max(1, request.pageSize || SG_ACRA_METADATA.executionPolicy.defaultPageSize)
    );
    const offset = (page - 1) * pageSize;

    const url = new URL(DATA_GOV_SG_API);
    url.searchParams.set('resource_id', ACRA_RESOURCE_ID);
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('offset', String(offset));

    if (validateSingaporeUen(query)) {
      url.searchParams.set('filters', JSON.stringify({ uen: normalizeIdentifierValue(query) }));
    } else {
      url.searchParams.set('q', query);
    }

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
        message: `Singapore ACRA API returned HTTP ${response.status}: ${response.statusText}`,
        remediationHint: httpClass.remediationHint,
      });
    }

    let payload: {
      success?: boolean;
      result?: {
        records?: SgAcraRecord[];
        total?: number;
      };
    };
    try {
      payload = (await response.json()) as any;
    } catch {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        retryable: false,
        message: 'Singapore ACRA API returned non-JSON payload.',
      });
    }

    const records = payload.result?.records || [];
    const retrievedAt = new Date().toISOString();
    const postalFilter = request.postalCode?.trim().toLowerCase();
    const industryFilter = (request.industry || request.category || request.businessType || '').trim().toLowerCase();

    const filtered = records.filter((rec) => {
      const post = (rec.reg_postal_code || rec.postal_code || '').toLowerCase();
      if (postalFilter && !post.startsWith(postalFilter)) return false;
      if (industryFilter) {
        const hay = `${rec.primary_ssic_description || ''} ${rec.primary_ssic_code || ''} ${rec.entity_type_desc || ''}`.toLowerCase();
        if (!hay.includes(industryFilter)) return false;
      }
      return true;
    });

    const results = filtered
      .map((rec) => this.normalizeResult(rec, retrievedAt))
      .filter((r): r is StandardizedConnectorResult => r !== null);

    const totalItems = payload.result?.total ?? results.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const notes: string[] = [];
    if (request.region?.trim()) {
      notes.push(`Singapore is a city-state; region filter "${request.region.trim()}" is not required.`);
    }

    return {
      results,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasMore: offset + records.length < totalItems,
      },
      rawCount: records.length,
      attribution: SG_ACRA_METADATA.attribution,
      notes,
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const cleanUen = normalizeIdentifierValue(request.externalId);
    if (!validateSingaporeUen(cleanUen)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: `Invalid Singapore UEN "${request.externalId}". Expected 9 or 10 character ACRA UEN format.`,
      });
    }

    const url = new URL(DATA_GOV_SG_API);
    url.searchParams.set('resource_id', ACRA_RESOURCE_ID);
    url.searchParams.set('filters', JSON.stringify({ uen: cleanUen }));
    url.searchParams.set('limit', '1');

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
        message: `Singapore ACRA UEN lookup returned HTTP ${response.status}`,
      });
    }

    const payload = (await response.json()) as { result?: { records?: SgAcraRecord[] } };
    const record = payload.result?.records?.[0];
    if (!record) {
      return {
        found: false,
        attribution: SG_ACRA_METADATA.attribution,
        notes: [`UEN ${cleanUen} not found in ACRA open dataset.`],
        isLiveApi: true,
      };
    }

    const result = this.normalizeResult(record, new Date().toISOString()) || undefined;
    return {
      found: Boolean(result),
      result,
      attribution: SG_ACRA_METADATA.attribution,
      notes: [],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const r = raw as SgAcraRecord;
    if (!r || !r.uen || !r.entity_name) return null;

    const uen = normalizeIdentifierValue(r.uen);
    const rawStatus = r.uen_status_desc || r.entity_status_description;
    const companyStatus = normalizeLegalCompanyStatus(rawStatus);

    const streetParts = [
      r.block ? `Blk ${r.block}` : undefined,
      r.reg_street_name || r.street_name,
      r.level_no && r.unit_no ? `#${r.level_no}-${r.unit_no}` : undefined,
      r.building_name,
    ].filter(Boolean);
    const street = streetParts.length > 0 ? streetParts.join(' ') : undefined;
    const postalCode = (r.reg_postal_code || r.postal_code || '').trim() || undefined;
    const regDate = r.registration_incorporation_date || r.uen_issue_date;
    const foundedYear = regDate ? parseInt(regDate.slice(0, 4), 10) : undefined;

    const signals = ['Official Singapore ACRA Registry Record (UEN Verified)'];
    let score = 68;
    if (companyStatus === 'active') {
      score += 10;
      signals.push('Active ACRA Registration Status');
    }
    if (street || postalCode) {
      score += 12;
      signals.push('Registered Singapore Office Address on File');
    }
    if (r.primary_ssic_description || r.primary_ssic_code) {
      score += 10;
      signals.push(`SSIC Classification: ${r.primary_ssic_code || r.primary_ssic_description}`);
    }

    return {
      providerId: this.id,
      providerName: SG_ACRA_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'SG',
      externalSourceId: uen,
      company: {
        companyName: r.entity_name,
        legalName: r.entity_name,
        registrationNumber: uen,
        registrationType: 'SG_UEN',
        companyStatus,
        address: {
          street,
          city: 'Singapore',
          postalCode,
          country: 'Singapore',
          countryCode: 'SG',
        },
        industry: r.primary_ssic_description || 'Corporate & Commercial Services',
        category: r.entity_type_desc || r.company_type_desc || 'Singapore Entity',
        foundedYear: Number.isFinite(foundedYear) ? foundedYear : undefined,
        identifiers: [
          {
            type: 'SG_UEN',
            value: uen,
            normalizedValue: uen,
            countryCode: 'SG',
            issuingAuthority: 'Accounting and Corporate Regulatory Authority (ACRA)',
            source: 'sg_datagov_acra',
            status: 'officially_verified',
            verified: true,
          },
        ],
        tags: ['Singapore', 'ACRA', r.entity_type_desc || 'UEN'].filter(Boolean),
        rawSource: {
          sourceName: SG_ACRA_METADATA.name,
          providerId: uen,
          url: ACRA_DATASET_URL,
          retrievedAt,
          license: SG_ACRA_METADATA.license,
          attribution: SG_ACRA_METADATA.attribution,
        },
      },
      sourceUrl: ACRA_DATASET_URL,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'ACRA open dataset via data.gov.sg DataStore API',
        isRealtime: true,
      },
      verificationStatus: 'officially_verified',
      confidence: {
        supported: true,
        score,
        signals,
      },
      providerMetadata: {
        uen,
        uenStatusLabel: rawStatus,
        entityType: r.entity_type_desc,
        primarySsicCode: r.primary_ssic_code,
        issuanceAgency: r.issuance_agency_id,
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
