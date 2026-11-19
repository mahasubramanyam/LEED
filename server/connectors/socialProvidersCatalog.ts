import type { ConnectorStatus } from '../types.js';
import type { SocialProviderDoc } from '../../src/types.js';

export type { SocialProviderDoc };

export const SOCIAL_AND_PROFESSIONAL_PROVIDERS: SocialProviderDoc[] = [
  {
    id: 'company-leadership-pages',
    connectorId: 'conn-web-inspector',
    name: 'Official Company Leadership, About & Announcements Pages',
    officialProvider: 'First-Party Company Websites (SSRF-Safe HTTP Inspection)',
    availability: 'operational',
    apiAvailability: 'Direct HTTPS/HTTP public page retrieval with SSRF IP-pinning and robots/login exclusion',
    authentication: 'Open public corporate web pages (no API credentials required)',
    pricingAndRestrictions: 'Free public access; excludes login-walled portals, CAPTCHAs, and private endpoints',
    countryCoverage: 'Global (195+ countries across any public corporate domain)',
    searchCapabilities: 'Inspects Homepage, About Us, Leadership, Management, Team, Board, Imprint, and Press/News pages',
    dataReturned: 'Explicitly published executive names, titles, board roles, official bio links, and Schema.org Person JSON-LD',
    commercialUsage: 'Permitted first-party public corporate disclosures; personal private emails/phones are not harvested',
    honestStatusNote: 'Active and operational without extra credentials. Extracts only explicitly published corporate leadership details.',
  },
  {
    id: 'brreg-roller-officers',
    connectorId: 'conn-brreg',
    name: 'Norway Brreg Roller (Official Officers & Board Registry)',
    officialProvider: 'Brønnøysundregistrene (Enhetsregisteret Roller API)',
    availability: 'operational',
    apiAvailability: 'Live public JSON REST API (/enheter/{orgnr}/roller)',
    authentication: 'Open public government API (no API key required)',
    pricingAndRestrictions: 'Free under Norwegian Licence for Open Government Data (NLOD 2.0)',
    countryCoverage: 'Norway (NO)',
    searchCapabilities: 'Direct lookup by 9-digit Norwegian organization number (or company lookup + roller fetch)',
    dataReturned: 'Daglig leder (CEO), Styreleder (Chair), Styremedlem (Board Member), Varamedlem, Signatur/Prokura, resignation flags',
    commercialUsage: 'Unrestricted commercial & CRM verification under NLOD 2.0 attribution',
    honestStatusNote: 'Active open official corporate officer registry for Norwegian companies.',
  },
  {
    id: 'wikidata-key-people',
    connectorId: 'conn-wikidata',
    name: 'Wikidata Structured Corporate Leadership & Founders (CC0)',
    officialProvider: 'Wikimedia Foundation (Wikidata MediaWiki API)',
    availability: 'operational',
    apiAvailability: 'Live public JSON REST API (wbsearchentities + wbgetentities)',
    authentication: 'Open public API (no API key required; descriptive User-Agent sent)',
    pricingAndRestrictions: 'Free under CC0 1.0 Public Domain Dedication subject to Wikimedia fair-use throttling',
    countryCoverage: 'Global (notable enterprises, public companies, and documented institutions)',
    searchCapabilities: 'Company Q-ID resolution extracting Founders (P112), CEOs (P169), Chairpersons (P488), Board Members (P3320)',
    dataReturned: 'Structured executive names, roles, and start/end temporal qualifiers (P580 / P582) distinguishing current vs historical',
    commercialUsage: 'CC0 1.0 Universal Public Domain Dedication',
    honestStatusNote: 'Operational open knowledge graph for notable companies; SMEs without Wikidata pages rely on registries & websites.',
  },
  {
    id: 'uk-companies-house-officers',
    connectorId: 'conn-companies-house',
    name: 'UK Companies House Officers API',
    officialProvider: 'UK Companies House Crown Registry',
    availability: 'credential_dependent',
    apiAvailability: 'Live REST API (/company/{company_number}/officers)',
    authentication: 'Requires Companies House REST API key (Basic Auth) stored in LEED encrypted Credential Vault',
    pricingAndRestrictions: 'Free government developer API key; 600 requests per 5 minutes quota',
    countryCoverage: 'United Kingdom (GB — England, Wales, Scotland, Northern Ireland)',
    searchCapabilities: 'Direct lookup by UK Company Registration Number (CRN) or resolved UK company search',
    dataReturned: 'Directors, Secretaries, LLP Members, appointment dates, resigned_on historical dates, occupation/role',
    commercialUsage: 'Permitted under Open Government Licence v3.0 (Crown Copyright)',
    honestStatusNote: 'Operational once owner configures a free UK Companies House API key; otherwise officer live fetch is skipped cleanly.',
  },
  {
    id: 'opencorporates-officers',
    connectorId: 'conn-opencorporates',
    name: 'OpenCorporates Officers API v0.4',
    officialProvider: 'OpenCorporates',
    availability: 'credential_dependent',
    apiAvailability: 'Live REST API (/v0.4/companies/{jurisdiction}/{company_number}/officers)',
    authentication: 'Requires authorized OpenCorporates v0.4 API token in LEED Credential Vault',
    pricingAndRestrictions: 'Commercial API subscription or approved public-benefit/journalism token required',
    countryCoverage: 'Global (140+ corporate jurisdictions)',
    searchCapabilities: 'Direct lookup by jurisdiction code + company number',
    dataReturned: 'Registered officers, positions, start_date / end_date (historical vs current), registry source attribution',
    commercialUsage: 'Governed by OpenCorporates API commercial license / ODbL share-alike terms',
    honestStatusNote: 'Credential-dependent; unauthenticated requests to v0.4 are blocked by OpenCorporates.',
  },
  {
    id: 'apollo-people-search',
    connectorId: 'conn-apollo',
    name: 'Apollo.io B2B Decision-Maker Search API',
    officialProvider: 'Apollo.io',
    availability: 'credential_dependent',
    apiAvailability: 'Live REST API (POST https://api.apollo.io/api/v1/mixed_people/search)',
    authentication: 'Requires owner Apollo.io API key (X-Api-Key header) in LEED encrypted Credential Vault',
    pricingAndRestrictions: 'Paid Apollo API plan required for people search / enrichment credits and rate limits',
    countryCoverage: 'Global B2B directory across 200+ countries and seniority levels',
    searchCapabilities: 'Filters by company domain, organization name, target job titles, seniorities, and country locations',
    dataReturned: 'Published business titles, departments, seniority levels, LinkedIn profile URLs, and verified work metadata (never fabricated)',
    commercialUsage: 'Authorized B2B API usage under customer Apollo.io API Terms of Service',
    honestStatusNote: 'Optional credential-dependent B2B intelligence connector. Returns missing_credentials cleanly when unconfigured.',
  },
  {
    id: 'brave-google-public-announcements',
    connectorId: 'conn-brave-search',
    name: 'Brave Search & Google CSE Public Leadership & Announcement Search',
    officialProvider: 'Brave Search API / Google Custom Search JSON API (Legacy)',
    availability: 'credential_dependent',
    apiAvailability: 'Live REST Web Search APIs using configured owner search tokens',
    authentication: 'Requires Brave Search API token (X-Subscription-Token) or legacy Google CSE API key + cx in Credential Vault',
    pricingAndRestrictions: 'Brave: $5/1k queries ($5/mo free credit). Google CSE: closed to new customers, retiring Jan 1, 2027.',
    countryCoverage: 'Global multilingual web search',
    searchCapabilities: 'Targeted queries for company leadership announcements, official press releases, and executive bios',
    dataReturned: 'Search snippets and public source URLs labeled strictly as search_result tier until verified against primary pages/registries',
    commercialUsage: 'Commercial search terms apply per provider; never used to scrape restricted social sites',
    honestStatusNote: 'Used strictly for public company announcements and open leadership mentions — never fabricates LinkedIn profiles.',
  },
  {
    id: 'linkedin-official-api',
    name: 'LinkedIn Official API (Profile / Organization / Sales Navigator)',
    officialProvider: 'LinkedIn Corporation (Microsoft)',
    availability: 'restricted',
    apiAvailability: 'No open B2B lead/decision-maker discovery API available to general third-party SaaS apps',
    authentication: 'Requires approved LinkedIn Marketing Developer / Sales Navigator Partner program + member OAuth 2.0',
    pricingAndRestrictions: 'Restricted partner-only enterprise agreements; public scraping and headless automation are strictly prohibited',
    countryCoverage: 'Global platform, but API access restricted by LinkedIn Partner approval',
    searchCapabilities: 'General people search and non-consented member directory lookup are not exposed on open self-serve LinkedIn APIs',
    dataReturned: 'Only authorized OAuth member fields or approved Marketing Partner org metrics — no unauthorized profile harvesting',
    commercialUsage: 'Strict User Agreement & API Terms prohibit unauthorized scraping, bypassing auth, or automated crawling',
    honestStatusNote: 'Restricted by LinkedIn platform terms. LEED never scrapes LinkedIn or bypasses logins; public LinkedIn links are preserved only when discovered from authorized APIs, owner imports, or official company sites.',
  },
  {
    id: 'microsoft-bing-people-search',
    name: 'Microsoft Bing Web Search API (Retired) & Grounding with Bing',
    officialProvider: 'Microsoft Azure',
    availability: 'unavailable',
    apiAvailability: 'Bing Web Search API v7 retired August 11, 2025; Grounding with Bing Search does not expose programmatic people-search JSON APIs',
    authentication: 'Decommissioned subscription keys',
    pricingAndRestrictions: 'Standalone Bing Web Search API discontinued; Grounding with Bing is LLM-agent only and restricts index persistence',
    countryCoverage: 'N/A — service unavailable for direct programmatic B2B search',
    searchCapabilities: 'No standalone JSON search index endpoint available',
    dataReturned: 'None — unavailable for automated people discovery',
    commercialUsage: 'Grounding terms prohibit persisting raw search index records into an independent CRM store',
    honestStatusNote: 'Unavailable since Bing Web Search retirement on August 11, 2025.',
  },
];

export function buildSocialProviderMatrix(connectorStatuses: ConnectorStatus[] = []): SocialProviderDoc[] {
  const byId = new Map(connectorStatuses.map((c) => [c.id, c]));

  return SOCIAL_AND_PROFESSIONAL_PROVIDERS.map((doc) => {
    if (!doc.connectorId) {
      return {
        ...doc,
        configuredInVault: false,
        operational: false,
      };
    }

    const status = byId.get(doc.connectorId);
    if (!status) return doc;

    let availability = doc.availability;
    if (status.authType === 'none_open') {
      availability = status.config?.enabled === false ? 'credential_dependent' : 'operational';
    } else {
      // Special check for Brave/Google combined row: mark operational if EITHER brave OR google cse is configured
      if (doc.id === 'brave-google-public-announcements') {
        const google = byId.get('conn-google-cse');
        const configured = Boolean(status.isConfigured || google?.isConfigured);
        const operational = Boolean(status.operational || google?.operational);
        return {
          ...doc,
          availability: configured ? 'operational' : 'credential_dependent',
          configuredInVault: configured,
          operational,
        };
      }
      availability = status.isConfigured ? 'operational' : 'credential_dependent';
    }

    return {
      ...doc,
      availability,
      configuredInVault: status.isConfigured,
      operational: status.operational,
    };
  });
}
