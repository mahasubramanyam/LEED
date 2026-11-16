import type { ConnectorStatus } from '../types.js';
import type { SourceCategory } from './core/types.js';

export type ProviderAvailabilityState =
  | 'available_configured'
  | 'available_configuration_required'
  | 'available_open'
  | 'restricted_legacy_sunsetting'
  | 'retired_unavailable';

export interface SearchDirectoryProviderDoc {
  id: string;
  connectorId?: string;
  name: string;
  category: SourceCategory | 'retired_search_engine';
  availability: ProviderAvailabilityState;
  officialEndpoint: string;
  documentationUrl: string;
  authentication: string;
  pricingAndQuota: string;
  supportedCountriesAndLanguages: string;
  queryAndPagination: string;
  rateLimits: string;
  commercialUsage: string;
  honestStatusNote: string;
  configuredInVault?: boolean;
  operational?: boolean;
  healthState?: string;
}

export const SEARCH_AND_DIRECTORY_PROVIDERS: SearchDirectoryProviderDoc[] = [
  {
    id: 'brave-search-api',
    connectorId: 'conn-brave-search',
    name: 'Brave Web Search API',
    category: 'search_engine',
    availability: 'available_configuration_required',
    officialEndpoint: 'https://api.search.brave.com/res/v1/web/search',
    documentationUrl: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started',
    authentication: 'Required: X-Subscription-Token header stored in LEED encrypted Credential Vault (or BRAVE_SEARCH_API_KEY env).',
    pricingAndQuota: 'Free $5/month credit (~1,000 queries/month); paid usage $5 per 1,000 requests.',
    supportedCountriesAndLanguages: 'Global coverage with ISO country codes (country) and search language parameters (search_lang).',
    queryAndPagination: 'Boolean/keyword/site: queries; count up to 20 per page, offset 0..9 (up to 200 results per query).',
    rateLimits: '1-second sliding window (plan-dependent QPS; honors X-RateLimit-Remaining and Retry-After).',
    commercialUsage: 'Commercial search & indexing permitted under Brave Search API Terms of Service.',
    honestStatusNote: 'Active commercial search provider. Requires an owner Brave Search API subscription token.',
  },
  {
    id: 'google-custom-search',
    connectorId: 'conn-google-cse',
    name: 'Google Programmable Search / Custom Search JSON API',
    category: 'search_engine',
    availability: 'restricted_legacy_sunsetting',
    officialEndpoint: 'https://www.googleapis.com/customsearch/v1',
    documentationUrl: 'https://developers.google.com/custom-search/v1/overview',
    authentication: 'Required: Google API Key + Programmable Search Engine ID (cx) stored in encrypted Credential Vault.',
    pricingAndQuota: 'Legacy quota: 100 free queries/day; $5 per 1,000 queries (10,000/day cap). Closed to new customers.',
    supportedCountriesAndLanguages: 'Global coverage via gl (country) and lr (language restrict) parameters.',
    queryAndPagination: 'Supports site:, intitle:, quotes; num up to 10 per page, start index 1..91 (max 100 results).',
    rateLimits: 'Daily quota and per-minute Cloud project limits enforced by Google APIs.',
    commercialUsage: 'Restricted to existing legacy API customers; Google scheduled full API discontinuation for January 1, 2027.',
    honestStatusNote: 'Supported only for owners who already hold legacy Google CSE credentials; no new onboarding from Google.',
  },
  {
    id: 'bing-web-search-retired',
    name: 'Bing Web Search API (Retired) & Grounding with Bing Search',
    category: 'retired_search_engine',
    availability: 'retired_unavailable',
    officialEndpoint: 'https://api.bing.microsoft.com/v7.0/search (Decommissioned)',
    documentationUrl: 'https://learn.microsoft.com/en-us/bing/search-apis/bing-web-search/overview',
    authentication: 'Decommissioned subscription key. Successor requires Azure AI Foundry Agent Service.',
    pricingAndQuota: 'Bing Search APIs retired Aug 11, 2025. Grounding with Bing Search (~$14/1k grounding calls) is LLM-agent only.',
    supportedCountriesAndLanguages: 'N/A — standalone Bing Web Search JSON API is no longer available.',
    queryAndPagination: 'Raw JSON search result arrays and deterministic offset pagination are not exposed by Grounding with Bing.',
    rateLimits: 'Service retired.',
    commercialUsage: 'Grounding with Bing Search prohibits storing raw web index results outside grounded LLM agent responses.',
    honestStatusNote: 'Retired Aug 11, 2025. Cannot be used as an independent programmatic web search provider in LEED.',
  },
  {
    id: 'wikidata-directory',
    connectorId: 'conn-wikidata',
    name: 'Wikidata Public Organization & Knowledge Graph Directory',
    category: 'business_directory',
    availability: 'available_open',
    officialEndpoint: 'https://www.wikidata.org/w/api.php & https://query.wikidata.org/sparql',
    documentationUrl: 'https://www.wikidata.org/wiki/Wikidata:Data_access',
    authentication: 'Open public API (no API key required). Requires descriptive User-Agent.',
    pricingAndQuota: 'Free open public infrastructure; subject to Wikimedia Foundation User-Agent & fair-use guidelines.',
    supportedCountriesAndLanguages: 'Global multilingual coverage across 195+ countries and 300+ languages.',
    queryAndPagination: 'Entity search (wbsearchentities) + structured property retrieval (official website P856, country P17, industry P452, inception P571, LEI P1278).',
    rateLimits: 'Conservative concurrency and polite throttling (60 requests/min ceiling in LEED).',
    commercialUsage: 'CC0 1.0 Universal Public Domain Dedication — unrestricted commercial and non-commercial use.',
    honestStatusNote: 'Active open directory for notable companies, brands, and global enterprises (not an exhaustive SME registry).',
  },
  {
    id: 'openstreetmap-nominatim',
    connectorId: 'conn-osm',
    name: 'OpenStreetMap & Nominatim Commercial Directory',
    category: 'maps_geo',
    availability: 'available_open',
    officialEndpoint: 'https://nominatim.openstreetmap.org/search',
    documentationUrl: 'https://operations.osmfoundation.org/policies/nominatim/',
    authentication: 'Open public API (no API key required). Requires compliant User-Agent.',
    pricingAndQuota: 'Free public community endpoint under strict 1 request/second fair-use policy.',
    supportedCountriesAndLanguages: 'Global coverage across all 195 sovereign states.',
    queryAndPagination: 'Keyword, category, countrycodes, postal/city, and bounded lat/lon viewbox queries (up to 50 items).',
    rateLimits: 'Strict <= 1 request/second enforced by LEED execution engine.',
    commercialUsage: 'Open Data Commons Open Database License (ODbL 1.0) with attribution required.',
    honestStatusNote: 'Active crowdsourced commercial POI & physical address directory.',
  },
  {
    id: 'opencorporates-directory',
    connectorId: 'conn-opencorporates',
    name: 'OpenCorporates Global Corporate Directory API v0.4',
    category: 'business_directory',
    availability: 'available_configuration_required',
    officialEndpoint: 'https://api.opencorporates.com/v0.4/companies/search',
    documentationUrl: 'https://api.opencorporates.com/documentation/API-Reference',
    authentication: 'Required: OpenCorporates API token (api_token) stored in encrypted Credential Vault.',
    pricingAndQuota: 'Paid commercial licensing (~£2,250+/yr); discounted/open-data plans for eligible non-commercial/journalism projects.',
    supportedCountriesAndLanguages: '140+ corporate jurisdictions worldwide using ISO/state jurisdiction codes.',
    queryAndPagination: 'Name/jurisdiction search and jurisdiction/company_number lookup; per_page up to 100, page pagination.',
    rateLimits: 'Token tier dependent (rate limit headers honored).',
    commercialUsage: 'Commercial license & share-alike/attribution rules apply per OpenCorporates Terms.',
    honestStatusNote: 'Requires valid OpenCorporates API token; unauthenticated requests are blocked on v0.4.',
  },
];

export function buildSearchAndDirectoryProviderMatrix(
  connectorStatuses: ConnectorStatus[] = []
): SearchDirectoryProviderDoc[] {
  const byId = new Map(connectorStatuses.map((c) => [c.id, c]));

  return SEARCH_AND_DIRECTORY_PROVIDERS.map((doc) => {
    if (!doc.connectorId) {
      return { ...doc, configuredInVault: false, operational: false, healthState: 'retired' };
    }
    const status = byId.get(doc.connectorId);
    if (!status) return doc;

    let availability = doc.availability;
    if (doc.availability !== 'restricted_legacy_sunsetting' && doc.availability !== 'retired_unavailable') {
      if (status.authType === 'none_open') {
        availability = status.config?.enabled === false ? 'available_configuration_required' : 'available_open';
      } else {
        availability = status.isConfigured ? 'available_configured' : 'available_configuration_required';
      }
    }

    return {
      ...doc,
      availability,
      configuredInVault: status.isConfigured,
      operational: status.operational,
      healthState: status.healthState,
    };
  });
}
