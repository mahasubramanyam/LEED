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

interface FrAnnuaireSiege {
  siret?: string;
  adresse?: string;
  geo_adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
  departement?: string;
  region?: string;
  latitude?: string | number;
  longitude?: string | number;
  etat_administratif?: string;
}

interface FrAnnuaireResult {
  siren: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  etat_administratif?: string;
  nature_juridique?: string;
  activite_principale?: string;
  section_activite_principale?: string;
  date_creation?: string;
  siege?: FrAnnuaireSiege;
  matching_etablissements?: FrAnnuaireSiege[];
}

const FR_ANNUAIRE_BASE = 'https://recherche-entreprises.api.gouv.fr/search';

const FR_METADATA: ConnectorMetadata = {
  id: 'conn-fr-sirene',
  name: 'France Annuaire des Entreprises / INSEE SIRENE',
  shortName: 'France SIRENE',
  version: '6.0.0',
  sourceCategory: 'government_registry',
  accessMode: 'live_api',
  description:
    'Official French inter-ministerial open business registry API (DINUM / INSEE SIRENE / RNE). Provides live SIREN/SIRET numbers, legal names, NAF/APE codes, registered head-office addresses, and administrative status.',
  supportedCountries: ['FR'],
  supportsAllCountries: false,
  supportsRegionFilter: true,
  supportsCityFilter: true,
  supportsPostalCodeFilter: true,
  supportsIndustryFilter: true,
  supportedIdentifierTypes: ['FR_SIREN', 'FR_SIRET'],
  capabilities: ['company_search', 'registry_lookup', 'pagination', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions:
      'Open French Government API (Licence Ouverte 2.0 / Etalab). No API key required. Respect 7 req/sec rate ceiling.',
    obtainKeyUrl: 'https://annuaire-entreprises.data.gouv.fr/donnees/api',
  },
  executionPolicy: {
    timeoutMs: 12000,
    maxRetries: 2,
    baseBackoffMs: 600,
    maxBackoffMs: 5000,
    maxConcurrency: 3,
    rateLimit: {
      maxRequests: 25,
      windowMs: 60000,
      note: 'Open API (7 req/sec official ceiling); polite client throttling enforced',
      waitOnLimit: false,
    },
    defaultPageSize: 15,
    maxPageSize: 25,
    dedupeWindowMs: 5000,
  },
  attribution: 'République Française — Annuaire des Entreprises / INSEE SIRENE (Licence Ouverte v2.0)',
  license: 'Licence Ouverte v2.0 (Etalab / Open Licence 2.0)',
  homepageUrl: 'https://annuaire-entreprises.data.gouv.fr/donnees/api',
};

export class FrSireneConnector implements IConnector {
  public readonly id = 'conn-fr-sirene';

  public getMetadata(): ConnectorMetadata {
    return FR_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();

    try {
      const response = await fetch(`${FR_ANNUAIRE_BASE}?q=renault&per_page=1`, {
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
          message: `Annuaire des Entreprises API returned HTTP ${response.status}: ${response.statusText}`,
          checkedAt,
        };
      }

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `France Annuaire des Entreprises (SIRENE) API reachable (${latencyMs}ms).`,
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
      FR_METADATA.executionPolicy.maxPageSize,
      Math.max(1, request.pageSize || FR_METADATA.executionPolicy.defaultPageSize)
    );

    const cleanDigits = query.replace(/\s+/g, '');
    const url = new URL(FR_ANNUAIRE_BASE);
    url.searchParams.set('q', /^\d{9}$|^\d{14}$/.test(cleanDigits) ? cleanDigits : query);
    if (request.postalCode?.trim()) {
      url.searchParams.set('code_postal', request.postalCode.trim().replace(/\s+/g, ''));
    }
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(pageSize));

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
        message: `France Annuaire API returned HTTP ${response.status}: ${response.statusText}`,
        remediationHint: httpClass.remediationHint,
      });
    }

    let data: {
      results?: FrAnnuaireResult[];
      total_results?: number;
      total_pages?: number;
      page?: number;
      per_page?: number;
    };
    try {
      data = (await response.json()) as any;
    } catch {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        retryable: false,
        message: 'France Annuaire API returned malformed JSON payload.',
      });
    }

    const items = Array.isArray(data.results) ? data.results : [];
    const retrievedAt = new Date().toISOString();
    const cityFilter = request.city?.trim().toLowerCase();
    const regionFilter = request.region?.trim().toLowerCase();
    const industryFilter = (request.industry || request.category || request.businessType || '').trim().toLowerCase();

    const filtered = items.filter((item) => {
      const siege = item.siege;
      if (cityFilter && !(siege?.libelle_commune || '').toLowerCase().includes(cityFilter)) {
        return false;
      }
      if (regionFilter && !(siege?.region || siege?.departement || '').toLowerCase().includes(regionFilter)) {
        return false;
      }
      if (industryFilter) {
        const hay = `${item.activite_principale || ''} ${item.section_activite_principale || ''} ${item.nature_juridique || ''}`.toLowerCase();
        if (!hay.includes(industryFilter)) return false;
      }
      return true;
    });

    const results = filtered
      .map((item) => this.normalizeResult(item, retrievedAt))
      .filter((r): r is StandardizedConnectorResult => r !== null);

    const totalItems = data.total_results ?? results.length;
    const totalPages = data.total_pages ?? Math.max(1, Math.ceil(totalItems / pageSize));

    return {
      results,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
        hasMore: page < totalPages,
      },
      rawCount: items.length,
      attribution: FR_METADATA.attribution,
      notes: [],
      isLiveApi: true,
    };
  }

  public async lookupById(
    request: ConnectorLookupRequest,
    context: ConnectorExecutionContext
  ): Promise<ConnectorLookupResponse> {
    const clean = request.externalId.replace(/\s+/g, '');
    if (!/^\d{9}$|^\d{14}$/.test(clean)) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: `Invalid French SIREN (9 digits) or SIRET (14 digits): "${request.externalId}".`,
      });
    }

    const targetSiren = clean.slice(0, 9);
    const url = new URL(FR_ANNUAIRE_BASE);
    url.searchParams.set('q', clean);
    url.searchParams.set('page', '1');
    url.searchParams.set('per_page', '5');

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
        message: `France Annuaire lookup returned HTTP ${response.status}`,
      });
    }

    const data = (await response.json()) as { results?: FrAnnuaireResult[] };
    const items = Array.isArray(data.results) ? data.results : [];
    const exact = items.find((i) => i.siren === targetSiren) || items[0];

    if (!exact || exact.siren !== targetSiren) {
      return {
        found: false,
        attribution: FR_METADATA.attribution,
        notes: [`No French entity found for SIREN ${targetSiren}.`],
        isLiveApi: true,
      };
    }

    const normalized = this.normalizeResult(exact, new Date().toISOString());
    return {
      found: Boolean(normalized),
      result: normalized || undefined,
      attribution: FR_METADATA.attribution,
      notes: [],
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    const item = raw as FrAnnuaireResult;
    if (!item || !item.siren || !(item.nom_complet || item.nom_raison_sociale)) return null;

    const siren = item.siren.trim();
    const legalName = (item.nom_raison_sociale || item.nom_complet || '').trim();
    const displayName = (item.nom_complet || item.nom_raison_sociale || '').trim();
    const siege = item.siege;
    const companyStatus = normalizeLegalCompanyStatus(item.etat_administratif);

    const lat = siege?.latitude !== undefined ? Number(siege.latitude) : NaN;
    const lon = siege?.longitude !== undefined ? Number(siege.longitude) : NaN;
    const coordinates =
      Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;

    const foundedYear = item.date_creation ? parseInt(item.date_creation.slice(0, 4), 10) : undefined;

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
        type: 'FR_SIREN',
        value: siren,
        normalizedValue: siren,
        countryCode: 'FR',
        issuingAuthority: 'INSEE / Annuaire des Entreprises',
        source: 'fr_annuaire_api',
        status: 'officially_verified',
        verified: true,
      },
    ];

    if (siege?.siret && /^\d{14}$/.test(siege.siret.replace(/\s+/g, ''))) {
      const cleanSiret = siege.siret.replace(/\s+/g, '');
      identifiers.push({
        type: 'FR_SIRET',
        value: cleanSiret,
        normalizedValue: cleanSiret,
        countryCode: 'FR',
        issuingAuthority: 'INSEE / Annuaire des Entreprises',
        source: 'fr_annuaire_api',
        status: 'officially_verified',
        verified: true,
      });
    }

    const signals = ['Official French Government Registry Record (INSEE / SIRENE)'];
    let score = 78;
    if (companyStatus === 'active') {
      score += 10;
      signals.push('Administrative Status: Active (A)');
    }
    if (siege?.adresse && siege?.code_postal) {
      score += 10;
      signals.push('Registered Head Office (Siège Social) Confirmed');
    }

    const officialUrl = `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;

    return {
      providerId: this.id,
      providerName: FR_METADATA.name,
      sourceCategory: 'government_registry',
      accessMode: 'live_api',
      countryCode: 'FR',
      externalSourceId: siren,
      company: {
        companyName: displayName,
        legalName,
        registrationNumber: siren,
        registrationType: 'FR_SIREN',
        companyStatus,
        address: {
          street: siege?.adresse || siege?.geo_adresse || undefined,
          city: siege?.libelle_commune || undefined,
          region: siege?.region || siege?.departement || undefined,
          postalCode: siege?.code_postal || undefined,
          country: 'France',
          countryCode: 'FR',
        },
        coordinates,
        industry: item.activite_principale ? `NAF ${item.activite_principale}` : 'French Commercial Enterprise',
        category: item.nature_juridique || 'Société / Entreprise',
        foundedYear: Number.isFinite(foundedYear) ? foundedYear : undefined,
        identifiers,
        tags: ['France', 'SIRENE Verified', companyStatus === 'active' ? 'Active' : companyStatus].filter(Boolean),
        rawSource: {
          sourceName: FR_METADATA.name,
          providerId: siren,
          url: officialUrl,
          retrievedAt,
          license: FR_METADATA.license,
          attribution: FR_METADATA.attribution,
        },
      },
      sourceUrl: officialUrl,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'Real-time Annuaire des Entreprises (INSEE SIRENE) query',
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
        etatAdministratif: item.etat_administratif,
        nafCode: item.activite_principale,
        natureJuridique: item.nature_juridique,
        headOfficeSiret: siege?.siret,
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
