import { CanonicalLead, LeadSource, LeadIdentifier } from '../types.js';

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
    opening_hours?: string;
    operator?: string;
    brand?: string;
  };
}

let lastOsmRequestTime = 0;

export async function searchOpenStreetMap(
  query: string,
  countryCode?: string,
  city?: string
): Promise<{ leads: CanonicalLead[]; rawCount: number }> {
  // Rate limiting compliance: Nominatim usage policy requires <= 1 request/second
  const nowMs = Date.now();
  const elapsed = nowMs - lastOsmRequestTime;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastOsmRequestTime = Date.now();

  const searchParts: string[] = [query.trim()];
  if (city) searchParts.push(city.trim());

  const fullQuery = searchParts.join(', ');
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', fullQuery);
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('extratags', '1');
  url.searchParams.set('limit', '25');

  if (countryCode && countryCode.trim().length === 2) {
    url.searchParams.set('countrycodes', countryCode.toLowerCase());
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'GlobalLeadPipeline/1.0 (contact@internal-pipeline.local)',
    },
    signal: AbortSignal.timeout(9000),
  });

  if (!response.ok) {
    throw new Error(`OpenStreetMap Nominatim returned HTTP ${response.status}: ${response.statusText}`);
  }

  const items = (await response.json()) as NominatimResult[];
  const now = new Date().toISOString();

  const leads: CanonicalLead[] = items
    .filter((item) => {
      // Exclude pure administrative boundaries or streets without business name
      const hasSpecificName = item.name && item.name.trim().length > 1;
      const isPlacePOI = item.class === 'amenity' || item.class === 'shop' || item.class === 'office' || item.class === 'commercial' || item.class === 'tourism';
      return hasSpecificName || isPlacePOI;
    })
    .map((item) => {
      const compName = item.name || item.display_name.split(',')[0].trim();
      const addr = item.address;
      const street = [addr?.house_number, addr?.road].filter(Boolean).join(' ') || '';
      const locality = addr?.city || addr?.town || addr?.village || addr?.suburb || city || '';
      const region = addr?.state || '';
      const postalCode = addr?.postcode || '';
      const country = addr?.country || 'International';
      const cCode = (addr?.country_code || countryCode || 'US').toUpperCase();

      const website = item.extratags?.website || item.extratags?.['contact:website'];
      const phone = item.extratags?.phone || item.extratags?.['contact:phone'];
      const email = item.extratags?.email || item.extratags?.['contact:email'];

      let domain: string | undefined;
      if (website) {
        try {
          const urlObj = new URL(website.startsWith('http') ? website : `https://${website}`);
          domain = urlObj.hostname.replace(/^www\./, '');
        } catch {
          // ignore invalid url
        }
      }

      const sources: LeadSource[] = [
        {
          sourceName: 'OpenStreetMap (Nominatim & POI)',
          providerId: `osm-${item.osm_type}-${item.osm_id}`,
          url: `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`,
          retrievedAt: now,
          license: 'Open Data Commons Open Database License (ODbL)',
          attribution: '© OpenStreetMap contributors',
        },
      ];

      const identifiers: LeadIdentifier[] = [];
      if (domain) {
        identifiers.push({ type: 'DOMAIN', value: domain, verified: false });
      }
      if (phone) {
        identifiers.push({ type: 'PHONE', value: phone, verified: false });
      }
      if (email) {
        identifiers.push({ type: 'EMAIL', value: email, verified: false });
      }

      const signals: string[] = ['Geocoded Physical Location & Coordinates'];
      let confidenceScore = 40; // Base for verified geocoded POI

      if (street && locality) {
        confidenceScore += 15;
        signals.push('Detailed Street Address on Map');
      }
      if (website) {
        confidenceScore += 20;
        signals.push('Public Website Discovered');
      }
      if (phone) {
        confidenceScore += 15;
        signals.push('Public Telephone Discovered');
      }
      if (email) {
        confidenceScore += 10;
        signals.push('Direct Email Address Tagged');
      }

      const categoryName = item.type
        ? item.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : (item.class || 'Business');

      return {
        id: `osm-${item.osm_id}`,
        companyName: compName,
        website,
        domain,
        phone,
        email,
        emailStatus: email ? 'syntax_valid' : 'unavailable',
        address: {
          street,
          city: locality,
          region,
          postalCode,
          country,
          countryCode: cCode,
          formattedAddress: [street, locality, postalCode, country].filter(Boolean).join(', '),
        },
        coordinates: {
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
        },
        industry: item.class ? item.class.toUpperCase() : 'COMMERCIAL',
        category: categoryName,
        confidenceScore: Math.min(confidenceScore, 95),
        confidenceSignals: signals,
        sources,
        identifiers,
        status: 'new',
        pipelineStageId: 'stage-discovered',
        currency: cCode === 'GB' ? 'GBP' : cCode === 'NO' ? 'NOK' : cCode === 'AU' ? 'AUD' : cCode === 'DE' || cCode === 'FR' ? 'EUR' : 'USD',
        tags: [cCode, 'OpenStreetMap', categoryName].filter(Boolean),
        notes: [],
        activities: [
          {
            id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            type: 'enrichment',
            title: 'Discovered via OpenStreetMap Geographic Registry',
            outcome: `Coordinates: ${item.lat}, ${item.lon}`,
            date: now,
            actor: 'System Connector',
          },
        ],
        createdAt: now,
        updatedAt: now,
      };
    });

  return { leads, rawCount: leads.length };
}
