import { CountrySourceCapability, IntegrationStatus } from './types.js';
import { getAllCountries } from './countries.js';
import { ConnectorStatus } from '../types.js';

export interface CapabilityMatrixOptions {
  hasChKey?: boolean;
  overrides?: Map<string, { lastCheckedAt?: string; notes?: string }>;
}

export function buildCountryCapabilityMatrix(
  activeConnectors: ConnectorStatus[] = [],
  options: CapabilityMatrixOptions = {}
): CountrySourceCapability[] {
  const countries = getAllCountries();
  const connectorMap = new Map<string, ConnectorStatus>();
  for (const c of activeConnectors) {
    connectorMap.set(c.id, c);
  }
  const overrides = options.overrides;

  const matrix: CountrySourceCapability[] = [];

  // 1. Official Open Registry: Norway Brreg
  const brregConn = connectorMap.get('conn-brreg');
  matrix.push({
    id: 'cap-no-brreg',
    countryCode: 'NO',
    countryName: 'Norway',
    flag: '🇳🇴',
    providerName: 'Brønnøysund Register Centre (Brreg)',
    sourceType: 'official_open_registry',
    integrationStatus: brregConn?.healthState === 'disabled' ? 'unavailable' : 'live_open_api',
    authRequirement: 'none_open',
    sourceUrl: 'https://data.brreg.no/enhetsregisteret/api',
    lastCheckedAt: overrides?.get('NO')?.lastCheckedAt || brregConn?.lastRunAt || undefined,
    notes:
      overrides?.get('NO')?.notes ||
      'Official open government API. Real-time querying of 9-digit Norwegian organisation numbers (NO_ORG), legal status, NACE codes, and registered postal addresses.',
    licensingInfo: 'Norwegian Licence for Open Government Data (NLOD 2.0)',
    coverageFeatures: ['Company Search', 'Official OrgNr (NO_ORG)', 'NACE Classification', 'Registered Address', 'Legal Status Verification'],
  });

  // 2. Official Registry Integration: UK Companies House
  const chConn = connectorMap.get('conn-companies-house');
  const hasChKey = Boolean(
    options.hasChKey ||
      process.env.COMPANIES_HOUSE_API_KEY ||
      chConn?.isConfigured ||
      chConn?.status === 'configured' ||
      chConn?.status === 'healthy' ||
      chConn?.healthState === 'operational'
  );
  matrix.push({
    id: 'cap-gb-ch',
    countryCode: 'GB',
    countryName: 'United Kingdom',
    flag: '🇬🇧',
    providerName: 'UK Companies House Registry API',
    sourceType: 'official_api_credentials',
    integrationStatus:
      chConn?.healthState === 'disabled'
        ? 'unavailable'
        : hasChKey
        ? 'configured_api_key'
        : 'requires_api_key',
    authRequirement: 'api_key',
    sourceUrl: 'https://developer.company-information.service.gov.uk',
    lastCheckedAt: overrides?.get('GB')?.lastCheckedAt || chConn?.lastRunAt || undefined,
    notes:
      overrides?.get('GB')?.notes ||
      (hasChKey
        ? 'API key configured. Official live REST lookup active for UK Companies House (England, Wales, Scotland, Northern Ireland; 600 calls/5 min).'
        : 'Official Crown registry for England, Wales, Scotland, and Northern Ireland. Free API key required in Settings/Owner Control Centre; currently only offline sample fallback is available without a key.'),
    licensingInfo: 'Crown Copyright, Open Government Licence (OGL v3.0)',
    coverageFeatures: ['Company Search', 'Verified CRN (UK_CRN)', 'Filing History', 'Registered Office', 'Incorporation Date', 'SIC Codes'],
  });

  // 3. Credentialed Registry: Australia ABR / ABN Lookup (Live ABR API requires GUID; offline checksum utility only)
  const abnConn = connectorMap.get('conn-abn');
  const hasAbrGuid = Boolean(process.env.ABR_GUID || abnConn?.isConfigured);
  matrix.push({
    id: 'cap-au-abn',
    countryCode: 'AU',
    countryName: 'Australia',
    flag: '🇦🇺',
    providerName: 'Australian Business Register (ABR / ABN Lookup)',
    sourceType: 'official_api_credentials',
    integrationStatus:
      abnConn?.healthState === 'disabled'
        ? 'unavailable'
        : hasAbrGuid
        ? 'configured_api_key'
        : 'requires_api_key',
    authRequirement: 'api_key',
    sourceUrl: 'https://abr.business.gov.au/Documentation/WebServiceMethods',
    lastCheckedAt: overrides?.get('AU')?.lastCheckedAt || abnConn?.lastRunAt || undefined,
    notes:
      overrides?.get('AU')?.notes ||
      'Live Australian Business Register XML/JSON lookups require an official ABR Web Services GUID. Currently provides local ATO Modulo-89 checksum validation and a 5-record offline reference sample only.',
    licensingInfo: 'Commonwealth of Australia Open Data (ABR Terms of Access)',
    coverageFeatures: ['Offline ABN Modulo-89 Checksum', '5-Record Sample Reference', 'Live Registry Requires ABR GUID'],
  });

  // 4. Multi-Jurisdiction Geospatial Directory: OpenStreetMap Overpass & Nominatim
  const osmConn = connectorMap.get('conn-osm');
  matrix.push({
    id: 'cap-global-osm',
    countryCode: 'GLOBAL',
    countryName: 'Global (All 195 Sovereign States)',
    flag: '🌐',
    providerName: 'OpenStreetMap Nominatim & Overpass Commercial POI',
    sourceType: 'public_geo_directory',
    integrationStatus: osmConn?.healthState === 'disabled' ? 'unavailable' : 'live_open_api',
    authRequirement: 'none_open',
    sourceUrl: 'https://nominatim.openstreetmap.org',
    lastCheckedAt: overrides?.get('GLOBAL')?.lastCheckedAt || osmConn?.lastRunAt || undefined,
    notes:
      overrides?.get('GLOBAL')?.notes ||
      'Global crowdsourced business, retail, and commercial point-of-interest directory (NOT an official corporate registry). Throttled to 1 req/sec per Nominatim Usage Policy.',
    licensingInfo: 'Open Data Commons Open Database License (ODbL 1.0)',
    coverageFeatures: ['Commercial POI Search', 'Global Coordinates', 'Street Addresses', 'Website & Phone discovery'],
  });

  // 5. Public Website Sources Requiring Permitted Access: Safe Web Inspector
  const webConn = connectorMap.get('conn-web-inspector');
  matrix.push({
    id: 'cap-global-inspector',
    countryCode: 'GLOBAL',
    countryName: 'Global Web (Permitted Public Domains)',
    flag: '🛡️',
    providerName: 'SSRF-Protected Autonomous Web Inspector',
    sourceType: 'web_inspector',
    integrationStatus: webConn?.healthState === 'disabled' ? 'unavailable' : 'live_open_api',
    authRequirement: 'none',
    sourceUrl: 'https://internal.leed/inspection',
    lastCheckedAt: webConn?.lastRunAt || undefined,
    notes: 'Direct HTTP inspection of candidate domain homepages. Enforces DNS rebinding protection, RFC 1918 private IP blocking, 300KB streaming caps, and robots.txt compliance.',
    licensingInfo: 'Direct Target Web Inspection (Owner User-Agent Disclosed)',
    coverageFeatures: ['Email Extraction', 'SSL Validation', 'Social Profiles', 'Server Latency', 'Homepage Metadata'],
  });

  // 6. Paid / Credentialed API Integrations
  matrix.push({
    id: 'cap-us-sec',
    countryCode: 'US',
    countryName: 'United States',
    flag: '🇺🇸',
    providerName: 'SEC EDGAR / Commercial Data Provider (D&B / ZoomInfo)',
    sourceType: 'official_api_credentials',
    integrationStatus: 'requires_api_key',
    authRequirement: 'api_key',
    sourceUrl: 'https://www.sec.gov/edgar/searchedgar/companysearch',
    lastCheckedAt: overrides?.get('US')?.lastCheckedAt || undefined,
    notes:
      overrides?.get('US')?.notes ||
      'SEC EDGAR covers US publicly traded/reporting filings only (not a complete US state corporate registration database). Private US business enrichment requires state SOS or external provider credentials.',
    licensingInfo: 'Commercial Provider License / SEC Public Domain',
    coverageFeatures: ['Public SEC Filings Only', '10-K / 10-Q Reports', 'CIK Identifier', 'State-by-State Registry External'],
  });

  // 7. Restricted, Manual or Portal-Only Jurisdictions
  const restrictedJurisdictions = [
    {
      countryCode: 'DE',
      countryName: 'Germany',
      flag: '🇩🇪',
      providerName: 'Gemeinsames Registerportal der Länder (Handelsregister)',
      sourceUrl: 'https://www.handelsregister.de',
      notes: 'No free open REST API. Search interface accessible via manual web portal; bulk retrieval requires judicial subscription agreement.',
      status: 'restricted_manual_only' as IntegrationStatus,
    },
    {
      countryCode: 'FR',
      countryName: 'France',
      flag: '🇫🇷',
      providerName: 'INPI Registre National des Entreprises (RNE / SIRENE)',
      sourceUrl: 'https://data.inpi.fr',
      notes: 'Official French commercial register. Open data available via SIRENE database downloads; API access requires authenticated INPI account credentials.',
      status: 'public_directory_permit' as IntegrationStatus,
    },
    {
      countryCode: 'CH',
      countryName: 'Switzerland',
      flag: '🇨🇭',
      providerName: 'ZEFix (Central Business Name Index)',
      sourceUrl: 'https://www.zefix.ch',
      notes: 'Cantonal commercial registers index. Web portal search available; bulk queries or automated harvesting prohibited without permit.',
      status: 'restricted_manual_only' as IntegrationStatus,
    },
    {
      countryCode: 'JP',
      countryName: 'Japan',
      flag: '🇯🇵',
      providerName: 'National Tax Agency Corporate Number Publication Site',
      sourceUrl: 'https://www.houjin-bangou.nta.go.jp',
      notes: '13-digit Corporate Number registry. Public web search and bulk CSV downloads available; automated direct API requires registered application token.',
      status: 'restricted_manual_only' as IntegrationStatus,
    },
    {
      countryCode: 'SG',
      countryName: 'Singapore',
      flag: '🇸🇬',
      providerName: 'ACRA BizFile (Accounting and Corporate Regulatory Authority)',
      sourceUrl: 'https://www.bizfile.gov.sg',
      notes: 'Official registry for Singapore companies (UEN). Basic search is public; detailed company profiles require paid SingPass portal access.',
      status: 'restricted_manual_only' as IntegrationStatus,
    },
    {
      countryCode: 'IN',
      countryName: 'India',
      flag: '🇮🇳',
      providerName: 'Ministry of Corporate Affairs (MCA21 / GST Portal)',
      sourceUrl: 'https://www.mca.gov.in',
      notes: 'Company Identification Number (CIN) and GSTIN search. Portal protected by CAPTCHA; automated API access restricted to authorized GSP partners.',
      status: 'restricted_manual_only' as IntegrationStatus,
    },
  ];

  for (const item of restrictedJurisdictions) {
    matrix.push({
      id: `cap-${item.countryCode.toLowerCase()}-reg`,
      countryCode: item.countryCode,
      countryName: item.countryName,
      flag: item.flag,
      providerName: item.providerName,
      sourceType: 'manual_registry_portal',
      integrationStatus: item.status,
      authRequirement: 'manual_portal',
      sourceUrl: item.sourceUrl,
      lastCheckedAt: overrides?.get(item.countryCode)?.lastCheckedAt || undefined,
      notes: overrides?.get(item.countryCode)?.notes || item.notes,
      licensingInfo: 'Jurisdictional Portal Terms of Use',
      coverageFeatures: ['Company Name', 'Registration Number', 'Legal Status'],
    });
  }

  // 8. Add general geographic reference coverage indicator for all remaining sovereign states & territories
  const documentedCodes = new Set(matrix.map((m) => m.countryCode));
  for (const country of countries) {
    if (!documentedCodes.has(country.code)) {
      matrix.push({
        id: `cap-geo-${country.code.toLowerCase()}`,
        countryCode: country.code,
        countryName: country.name,
        flag: country.flag,
        providerName: `${country.name} Geographic & Address Reference`,
        sourceType: 'geographic_reference_only',
        integrationStatus: 'unavailable',
        authRequirement: 'none',
        sourceUrl: `https://en.wikipedia.org/wiki/ISO_3166-2:${country.code}`,
        lastCheckedAt: overrides?.get(country.code)?.lastCheckedAt || undefined,
        notes:
          overrides?.get(country.code)?.notes ||
          `Geographic reference only: ISO codes, postal rules, telephone dialing (+${country.callingCode.replace(/[^0-9]/g, '')}), currency (${country.currency}), and timezone specs verified. No official national business registry connector integrated.`,
        licensingInfo: 'ISO 3166 / ISO 4217 Open Reference Standards',
        coverageFeatures: ['ISO Alpha-2 / Alpha-3', 'Calling Code Normalization', 'Address Formatting Rules', 'Currency / Timezone Specs'],
      });
    }
  }

  return matrix;
}
