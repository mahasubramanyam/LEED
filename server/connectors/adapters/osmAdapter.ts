import { classifyConnectorError, classifyHttpStatus, ConnectorError } from '../core/errors.js';
import { connectorRegistry } from '../core/registry.js';
import {
  ClassifiedConnectorError,
  ConnectionValidationResult,
  ConnectorExecutionContext,
  ConnectorHealthReport,
  ConnectorMetadata,
  ConnectorRuntimeState,
  ConnectorSearchRequest,
  ConnectorSearchResponse,
  IConnector,
  StandardizedConnectorResult,
} from '../core/types.js';
import { getCountryByCode } from '../../geo/countries.js';

interface NominatimResult {
  place_id: number;
  osm_id: number;
  osm_type: string;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  class?: string;
  type?: string;
  address?: {
    road?: string;
    house_number?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
  extratags?: {
    website?: string;
    'contact:website'?: string;
    phone?: string;
    'contact:phone'?: string;
    email?: string;
    'contact:email'?: string;
  };
}

const OSM_METADATA: ConnectorMetadata = {
  id: 'conn-osm',
  name: 'OpenStreetMap & Nominatim POI',
  shortName: 'OpenStreetMap POI',
  version: '4.0.0',
  sourceCategory: 'maps_geo',
  accessMode: 'public_directory',
  description:
    'Global crowdsourced commercial point-of-interest and geocoding directory across 195 sovereign states. Supports country, administrative division, and city filters (not an official corporate registry).',
  supportedCountries: [],
  supportsAllCountries: true,
  supportsRegionFilter: true,
  supportsCityFilter: true,
  supportsPostalCodeFilter: true,
  supportsRadiusFilter: true,
  supportsIndustryFilter: true,
  supportedIdentifierTypes: ['DOMAIN', 'PHONE', 'EMAIL'],
  capabilities: ['company_search', 'poi_search', 'connection_test'],
  credentialRequirements: {
    authType: 'none_open',
    required: false,
    fields: [],
    envFallbackKeys: [],
    setupInstructions: 'Public OpenStreetMap Nominatim endpoint. Requires compliant HTTP User-Agent and <= 1 request/sec throttling.',
    obtainKeyUrl: 'https://operations.osmfoundation.org/policies/nominatim/',
  },
  executionPolicy: {
    timeoutMs: 9000,
    maxRetries: 2,
    baseBackoffMs: 1200,
    maxBackoffMs: 5000,
    maxConcurrency: 1,
    rateLimit: {
      maxRequests: 1,
      windowMs: 1100,
      note: 'Max 1 req/sec compliance with Nominatim Usage Policy',
      waitOnLimit: true,
    },
    defaultPageSize: 25,
    maxPageSize: 50,
    dedupeWindowMs: 5000,
  },
  attribution: '© OpenStreetMap contributors (ODbL 1.0)',
  license: 'Open Data Commons Open Database License (ODbL 1.0)',
  homepageUrl: 'https://nominatim.openstreetmap.org',
};

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeHostDomain(raw?: string): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw.trim()}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw.trim().toLowerCase().replace(/^www\./, '').split('/')[0] || undefined;
  }
}

export class OsmConnector implements IConnector {
  public readonly id = 'conn-osm';

  public getMetadata(): ConnectorMetadata {
    return OSM_METADATA;
  }

  public async validateConnection(context: ConnectorExecutionContext): Promise<ConnectionValidationResult> {
    const start = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch('https://nominatim.openstreetmap.org/status.php?format=json', {
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
          message: `Nominatim status endpoint returned HTTP ${response.status}.`,
          checkedAt,
        };
      }

      return {
        ok: true,
        healthState: 'operational',
        latencyMs,
        isLiveApi: true,
        message: `OpenStreetMap Nominatim reachable (${latencyMs}ms; 1 req/sec policy active).`,
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
    const domainFilter = normalizeHostDomain(request.domain || request.website);
    const industryTerm = (request.industry || request.category || request.businessType || '').trim();
    const baseQuery = request.query?.trim() || industryTerm || domainFilter || '';
    if (!baseQuery) {
      throw new ConnectorError({
        category: 'invalid_request',
        providerId: this.id,
        message: 'Search query cannot be empty.',
      });
    }

    const parts: string[] = [baseQuery];
    if (industryTerm && !baseQuery.toLowerCase().includes(industryTerm.toLowerCase())) {
      parts.push(industryTerm);
    }
    if (request.city?.trim()) parts.push(request.city.trim());
    if (request.region?.trim()) parts.push(request.region.trim());
    if (request.postalCode?.trim()) parts.push(request.postalCode.trim());

    const limit = Math.min(
      OSM_METADATA.executionPolicy.maxPageSize,
      Math.max(1, request.pageSize || OSM_METADATA.executionPolicy.defaultPageSize)
    );

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', parts.join(', '));
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('extratags', '1');
    url.searchParams.set('limit', String(limit));

    if (request.countryCode && request.countryCode.trim().length === 2 && request.countryCode.toUpperCase() !== 'GLOBAL') {
      url.searchParams.set('countrycodes', request.countryCode.trim().toLowerCase());
    }

    const notes: string[] = [];
    const hasCoords =
      request.coordinates &&
      Number.isFinite(request.coordinates.lat) &&
      Number.isFinite(request.coordinates.lon);
    const radiusKm =
      typeof request.radiusKm === 'number' && Number.isFinite(request.radiusKm) && request.radiusKm > 0
        ? Math.min(250, request.radiusKm)
        : undefined;

    if (hasCoords && radiusKm) {
      const { lat, lon } = request.coordinates!;
      const latDelta = radiusKm / 111.32;
      const cosLat = Math.max(0.1, Math.abs(Math.cos((lat * Math.PI) / 180)));
      const lonDelta = radiusKm / (111.32 * cosLat);
      const west = Math.max(-180, lon - lonDelta).toFixed(5);
      const east = Math.min(180, lon + lonDelta).toFixed(5);
      const north = Math.min(90, lat + latDelta).toFixed(5);
      const south = Math.max(-90, lat - latDelta).toFixed(5);
      url.searchParams.set('viewbox', `${west},${north},${east},${south}`);
      url.searchParams.set('bounded', '1');
      notes.push(`Applied geographic bounding viewbox (~${radiusKm}km around ${lat.toFixed(3)}, ${lon.toFixed(3)}).`);
    } else if (radiusKm && !hasCoords) {
      notes.push(
        `Radius filter (${radiusKm}km) requires coordinates for strict Nominatim viewbox bounding; executed keyword/location search.`
      );
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
        message: `OpenStreetMap Nominatim returned HTTP ${response.status}: ${response.statusText}`,
        remediationHint: httpClass.remediationHint,
      });
    }

    let items: NominatimResult[];
    try {
      items = (await response.json()) as NominatimResult[];
    } catch {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: this.id,
        retryable: false,
        message: 'OpenStreetMap Nominatim returned malformed JSON response.',
      });
    }

    const retrievedAt = new Date().toISOString();
    const postalFilter = request.postalCode?.trim().toLowerCase().replace(/\s+/g, '');

    const filtered = items.filter((item) => {
      const hasSpecificName = Boolean(item.name && item.name.trim().length > 1);
      const isPlacePOI =
        item.class === 'amenity' ||
        item.class === 'shop' ||
        item.class === 'office' ||
        item.class === 'commercial' ||
        item.class === 'tourism';
      if (!hasSpecificName && !isPlacePOI) return false;

      if (postalFilter && item.address?.postcode) {
        const itemPost = item.address.postcode.toLowerCase().replace(/\s+/g, '');
        if (!itemPost.startsWith(postalFilter) && !itemPost.includes(postalFilter)) {
          return false;
        }
      }

      if (domainFilter) {
        const itemSite = item.extratags?.website || item.extratags?.['contact:website'];
        const itemDom = normalizeHostDomain(itemSite);
        if (!itemDom || (!itemDom.includes(domainFilter) && !domainFilter.includes(itemDom))) {
          return false;
        }
      }

      if (hasCoords && radiusKm) {
        const lat = parseFloat(item.lat);
        const lon = parseFloat(item.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          const dist = haversineDistanceKm(request.coordinates!.lat, request.coordinates!.lon, lat, lon);
          if (dist > radiusKm) return false;
        }
      }

      return true;
    });

    const results = filtered
      .map((item) =>
        this.normalizeNominatimItem(item, retrievedAt, {
          countryCode: request.countryCode,
          city: request.city,
          region: request.region,
        })
      )
      .filter((r): r is StandardizedConnectorResult => r !== null);

    return {
      results,
      pagination: {
        page: 1,
        pageSize: limit,
        totalItems: results.length,
        totalPages: 1,
        hasMore: false,
      },
      rawCount: items.length,
      attribution: OSM_METADATA.attribution,
      notes,
      isLiveApi: true,
    };
  }

  public normalizeResult(raw: unknown, retrievedAt: string): StandardizedConnectorResult | null {
    return this.normalizeNominatimItem(raw as NominatimResult, retrievedAt, {});
  }

  private normalizeNominatimItem(
    item: NominatimResult,
    retrievedAt: string,
    fallback: { countryCode?: string; city?: string; region?: string }
  ): StandardizedConnectorResult | null {
    if (!item || !item.osm_id) return null;
    const compName = (item.name || item.display_name?.split(',')[0] || '').trim();
    if (!compName) return null;

    const addr = item.address;
    const street = [addr?.house_number, addr?.road].filter(Boolean).join(' ') || undefined;
    const locality = addr?.city || addr?.town || addr?.village || addr?.suburb || fallback.city || undefined;
    const resolvedRegion = addr?.state || fallback.region || undefined;
    const postalCode = addr?.postcode || undefined;
    const cCode = (addr?.country_code || fallback.countryCode || 'US').toUpperCase();
    const countryRef = getCountryByCode(cCode);
    const country = countryRef?.name || addr?.country || 'International';

    const website = item.extratags?.website || item.extratags?.['contact:website'];
    const phone = item.extratags?.phone || item.extratags?.['contact:phone'];
    const email = item.extratags?.email || item.extratags?.['contact:email'];

    let domain: string | undefined;
    if (website) {
      try {
        const urlObj = new URL(website.startsWith('http') ? website : `https://${website}`);
        domain = urlObj.hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        domain = undefined;
      }
    }

    const identifiers: StandardizedConnectorResult['company']['identifiers'] = [];
    if (domain) {
      identifiers.push({
        type: 'DOMAIN',
        value: domain,
        countryCode: cCode,
        source: 'osm_nominatim',
        status: 'discovered',
        verified: false,
      });
    }
    if (phone) {
      identifiers.push({
        type: 'PHONE',
        value: phone,
        countryCode: cCode,
        source: 'osm_nominatim',
        status: 'discovered',
        verified: false,
      });
    }
    if (email) {
      identifiers.push({
        type: 'EMAIL',
        value: email,
        countryCode: cCode,
        source: 'osm_nominatim',
        status: 'discovered',
        verified: false,
      });
    }

    const signals = ['Geocoded Physical Location & Coordinates (Crowdsourced Directory)'];
    let score = 40;
    if (street && locality) {
      score += 15;
      signals.push('Detailed Street Address on Map');
    }
    if (website) {
      score += 20;
      signals.push('Public Website Discovered');
    }
    if (phone) {
      score += 15;
      signals.push('Public Telephone Discovered');
    }
    if (email) {
      score += 10;
      signals.push('Direct Email Address Tagged');
    }

    const categoryName = item.type
      ? item.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : item.class || 'Business';

    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);

    return {
      providerId: this.id,
      providerName: OSM_METADATA.name,
      sourceCategory: 'maps_geo',
      accessMode: 'public_directory',
      countryCode: cCode,
      externalSourceId: `osm-${item.osm_type}-${item.osm_id}`,
      company: {
        companyName: compName,
        website,
        domain,
        phone,
        email,
        emailStatus: email ? 'syntax_valid' : 'unavailable',
        address: {
          street,
          city: locality,
          region: resolvedRegion,
          postalCode,
          country,
          countryCode: cCode,
        },
        coordinates: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined,
        industry: item.class ? item.class.toUpperCase() : 'COMMERCIAL',
        category: categoryName,
        identifiers,
        tags: [cCode, 'OpenStreetMap', categoryName].filter(Boolean),
        rawSource: {
          sourceName: 'OpenStreetMap (Nominatim & POI)',
          providerId: `osm-${item.osm_type}-${item.osm_id}`,
          url: `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`,
          retrievedAt,
          license: OSM_METADATA.license,
          attribution: OSM_METADATA.attribution,
        },
      },
      sourceUrl: `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`,
      retrievedAt,
      dataFreshness: {
        lastUpdatedAt: retrievedAt,
        freshnessNote: 'Live crowdsourced OpenStreetMap POI index',
        isRealtime: true,
      },
      verificationStatus: 'directory_listed',
      confidence: {
        supported: true,
        score: Math.min(score, 95),
        signals,
      },
      providerMetadata: {
        placeId: item.place_id,
        osmType: item.osm_type,
        osmId: item.osm_id,
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
