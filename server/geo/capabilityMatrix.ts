import { AuthRequirement, CountrySourceCapability, IntegrationStatus } from './types.js';
import { getAllCountries } from './countries.js';
import { ConnectorStatus, SevenStateRegistryStatus } from '../types.js';
import {
  AuditedRegistryEntry,
  INTERNATIONAL_REGISTRY_AUDIT,
  PRIORITY_27_COUNTRIES,
  resolveSevenStateRegistryStatus,
} from './registryAudit.js';

export interface CapabilityMatrixOptions {
  hasChKey?: boolean;
  overrides?: Map<string, { lastCheckedAt?: string; notes?: string }>;
}

const LEGACY_CAPABILITY_IDS: Record<string, string> = {
  NO: 'cap-no-brreg',
  GB: 'cap-gb-ch',
  AU: 'cap-au-abn',
  US: 'cap-us-sec',
  DE: 'cap-de-handelsregister',
  FR: 'cap-fr-sirene',
  SG: 'cap-sg-acra',
  JP: 'cap-jp-nta',
  CA: 'cap-ca-corp',
  IN: 'cap-in-mca',
};

function mapSevenStateToLegacyIntegration(
  state: SevenStateRegistryStatus,
  authRequirement?: string
): IntegrationStatus {
  switch (state) {
    case 'live_and_operational':
      return authRequirement === 'api_key' || authRequirement === 'basic_auth'
        ? 'configured_api_key'
        : 'live_open_api';
    case 'live_auth_required':
      return 'requires_api_key';
    case 'configuration_required':
    case 'not_implemented':
    case 'temporarily_unavailable':
      return 'unavailable';
    case 'offline_reference_only':
      return 'public_directory_permit';
    case 'public_access_unavailable':
      return 'restricted_manual_only';
  }
}

function resolveAuditedCapabilityEntry(
  id: string,
  audit: AuditedRegistryEntry,
  connectorMap: Map<string, ConnectorStatus>,
  options: CapabilityMatrixOptions
): CountrySourceCapability {
  const conn = audit.connectorId ? connectorMap.get(audit.connectorId) : undefined;
  const override = options.overrides?.get(audit.countryCode);

  let effectiveConn = conn;
  if (audit.countryCode === 'GB' && options.hasChKey) {
    if (conn && !conn.isConfigured) {
      effectiveConn = { ...conn, isConfigured: true, healthState: 'operational', operational: true };
    } else if (!conn) {
      effectiveConn = {
        id: 'conn-companies-house',
        name: audit.authorityName,
        category: 'government_registry',
        countryCoverage: ['GB'],
        status: 'configured',
        healthState: 'operational',
        operational: true,
        authType: 'api_key',
        isConfigured: true,
        rateLimitNote: audit.auditDetails.rateLimitsAndPagination,
        attribution: audit.authorityName,
        totalCalls: 0,
      };
    }
  }

  const registryState = resolveSevenStateRegistryStatus(audit, effectiveConn);
  const lastVerifiedAt = override?.lastCheckedAt || conn?.lastSuccessAt || undefined;

  const authRequirement: AuthRequirement =
    effectiveConn?.authType === 'basic_auth' ||
    (!effectiveConn && (audit.countryCode === 'CH' || audit.countryCode === 'IE'))
      ? 'basic_auth'
      : effectiveConn?.authType === 'api_key' || audit.defaultState === 'live_auth_required'
      ? 'api_key'
      : effectiveConn?.authType === 'none_open' || audit.auditDetails.publicAccessPermitted
      ? 'none_open'
      : 'manual_portal';

  const sourceType =
    registryState === 'live_and_operational' && authRequirement === 'none_open'
      ? 'official_open_registry'
      : audit.connectorId
      ? 'official_api_credentials'
      : 'manual_registry_portal';

  return {
    id,
    countryCode: audit.countryCode,
    countryName: audit.countryName,
    flag: audit.flag,
    providerName: audit.authorityName,
    sourceType,
    integrationStatus: mapSevenStateToLegacyIntegration(registryState, authRequirement),
    registryState,
    connectorId: audit.connectorId,
    authRequirement,
    sourceUrl: audit.auditDetails.documentationUrl,
    lastCheckedAt: lastVerifiedAt,
    lastVerifiedAt,
    notes: override?.notes || `${audit.auditDetails.officialApiSummary} ${audit.auditDetails.accessRestrictions}`,
    licensingInfo: audit.auditDetails.commercialUseAndRedistribution,
    coverageFeatures: audit.auditDetails.searchAndVerificationCapabilities,
    auditDetails: audit.auditDetails,
  };
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

  // 1. Audited 27 Priority Countries
  for (const code of PRIORITY_27_COUNTRIES) {
    const audit = INTERNATIONAL_REGISTRY_AUDIT[code];
    if (!audit) continue;
    const capId = LEGACY_CAPABILITY_IDS[code] || `cap-${code.toLowerCase()}-official`;
    matrix.push(resolveAuditedCapabilityEntry(capId, audit, connectorMap, options));
  }

  // 2. Cross-Border Authoritative Official Registries (GLEIF LEI & EU VIES VAT)
  if (INTERNATIONAL_REGISTRY_AUDIT.GLOBAL_LEI) {
    matrix.push(
      resolveAuditedCapabilityEntry(
        'cap-global-gleif',
        INTERNATIONAL_REGISTRY_AUDIT.GLOBAL_LEI,
        connectorMap,
        options
      )
    );
  }
  if (INTERNATIONAL_REGISTRY_AUDIT.EU) {
    matrix.push(
      resolveAuditedCapabilityEntry('cap-eu-vies', INTERNATIONAL_REGISTRY_AUDIT.EU, connectorMap, options)
    );
  }

  // 3. Multi-Jurisdiction Geospatial Directory: OpenStreetMap Overpass & Nominatim
  const osmConn = connectorMap.get('conn-osm');
  const osmState: SevenStateRegistryStatus =
    osmConn?.healthState === 'disabled'
      ? 'configuration_required'
      : osmConn?.healthState === 'temporarily_unavailable' || osmConn?.healthState === 'rate_limited'
      ? 'temporarily_unavailable'
      : 'live_and_operational';
  matrix.push({
    id: 'cap-global-osm',
    countryCode: 'GLOBAL',
    countryName: 'Global (All 195 Sovereign States)',
    flag: '🌐',
    providerName: 'OpenStreetMap Nominatim & Overpass Commercial POI',
    sourceType: 'public_geo_directory',
    integrationStatus: mapSevenStateToLegacyIntegration(osmState),
    registryState: osmState,
    connectorId: 'conn-osm',
    authRequirement: 'none_open',
    sourceUrl: 'https://nominatim.openstreetmap.org',
    lastCheckedAt: overrides?.get('GLOBAL')?.lastCheckedAt || osmConn?.lastSuccessAt || undefined,
    lastVerifiedAt: overrides?.get('GLOBAL')?.lastCheckedAt || osmConn?.lastSuccessAt || undefined,
    notes:
      overrides?.get('GLOBAL')?.notes ||
      'Global crowdsourced business, retail, and commercial point-of-interest directory (NOT an official corporate registry). Throttled to 1 req/sec per Nominatim Usage Policy.',
    licensingInfo: 'Open Data Commons Open Database License (ODbL 1.0)',
    coverageFeatures: ['Commercial POI Search', 'Global Coordinates', 'Street Addresses', 'Website & Phone discovery'],
  });

  // 4. Public Website Sources Requiring Permitted Access: Safe Web Inspector
  const webConn = connectorMap.get('conn-web-inspector');
  const webState: SevenStateRegistryStatus =
    webConn?.healthState === 'disabled'
      ? 'configuration_required'
      : webConn?.healthState === 'temporarily_unavailable'
      ? 'temporarily_unavailable'
      : 'live_and_operational';
  matrix.push({
    id: 'cap-global-inspector',
    countryCode: 'GLOBAL',
    countryName: 'Global Web (Permitted Public Domains)',
    flag: '🛡️',
    providerName: 'SSRF-Protected Autonomous Web Inspector',
    sourceType: 'web_inspector',
    integrationStatus: mapSevenStateToLegacyIntegration(webState),
    registryState: webState,
    connectorId: 'conn-web-inspector',
    authRequirement: 'none',
    sourceUrl: 'https://internal.leed/inspection',
    lastCheckedAt: webConn?.lastSuccessAt || undefined,
    lastVerifiedAt: webConn?.lastSuccessAt || undefined,
    notes:
      'Direct HTTP inspection of candidate domain homepages. Enforces DNS rebinding protection, RFC 1918 private IP blocking, 300KB streaming caps, and robots.txt compliance.',
    licensingInfo: 'Direct Target Web Inspection (Owner User-Agent Disclosed)',
    coverageFeatures: ['Email Extraction', 'SSL Validation', 'Social Profiles', 'Server Latency', 'Homepage Metadata'],
  });

  // 5. Offline geographic & identifier reference coverage for all remaining sovereign states
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
        registryState: 'offline_reference_only',
        authRequirement: 'none',
        sourceUrl: `https://en.wikipedia.org/wiki/ISO_3166-2:${country.code}`,
        lastCheckedAt: overrides?.get(country.code)?.lastCheckedAt || undefined,
        lastVerifiedAt: overrides?.get(country.code)?.lastCheckedAt || undefined,
        notes:
          overrides?.get(country.code)?.notes ||
          `Offline reference only: ISO codes, postal rules, telephone dialing (+${country.callingCode.replace(/[^0-9]/g, '')}), currency (${country.currency}), and timezone specs verified. Cross-border verification available via GLEIF LEI when company holds an ISO 17442 LEI.`,
        licensingInfo: 'ISO 3166 / ISO 4217 Open Reference Standards',
        coverageFeatures: ['ISO Alpha-2 / Alpha-3', 'Calling Code Normalization', 'Address Formatting Rules', 'Currency / Timezone Specs'],
      });
    }
  }

  return matrix;
}
