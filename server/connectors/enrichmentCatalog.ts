import {
  ConnectorStatus,
  EnrichmentProviderCatalogEntry,
  EnrichmentProviderStatus,
  SourceReliabilityTier,
} from '../types.js';

interface ProviderDocOverride {
  category: EnrichmentProviderCatalogEntry['category'];
  enrichmentCapabilities: string[];
  dataCategories: string[];
  apiAvailability: string;
  endpointDoc?: string;
  costLimitations: string;
  commercialUsagePermitted: boolean;
  verificationCapability: boolean;
  reliabilityClassification: SourceReliabilityTier;
  honestLimitationNote: string;
}

const CONNECTOR_ENRICHMENT_META: Record<string, ProviderDocOverride> = {
  'conn-brreg': {
    category: 'company_registry',
    enrichmentCapabilities: ['Legal Name', 'Org Number', 'Legal Entity Type', 'Company Status', 'Registered Address', 'NACE Industry', 'Employee Count', 'Statutory Officers'],
    dataCategories: ['statutory_identity', 'address', 'status', 'leadership'],
    apiAvailability: 'Live Open Government API (No API key required)',
    endpointDoc: 'https://data.brreg.no/enhetsregisteret/api/enheter',
    costLimitations: 'Free public Norwegian registry open data (NLOD)',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'authoritative_registry',
    honestLimitationNote: 'Authoritative for Norwegian entities only; does not publish personal emails.',
  },
  'conn-companies-house': {
    category: 'company_registry',
    enrichmentCapabilities: ['Legal Name', 'CRN', 'Company Status', 'Incorporation Date', 'SIC Codes', 'Registered Office', 'Officers & Resignations'],
    dataCategories: ['statutory_identity', 'address', 'status', 'leadership'],
    apiAvailability: 'Live Government API (Requires owner API key)',
    endpointDoc: 'https://api.company-information.service.gov.uk',
    costLimitations: 'Free registration; 600 requests per 5 minutes',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'authoritative_registry',
    honestLimitationNote: 'Authoritative for UK registered companies; requires free Companies House API key.',
  },
  'conn-gleif': {
    category: 'company_registry',
    enrichmentCapabilities: ['LEI Verification', 'Legal Name', 'Jurisdiction', 'Entity Status', 'Headquarters & Legal Address', 'Parent/Child Relationships'],
    dataCategories: ['statutory_identity', 'address', 'ownership_hierarchy'],
    apiAvailability: 'Live Global Open API (No API key required)',
    endpointDoc: 'https://api.gleif.org/api/v1/lei-records',
    costLimitations: 'Free open global LEI data (CC0)',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'authoritative_registry',
    honestLimitationNote: 'Global coverage for entities holding an active or lapsed Legal Entity Identifier.',
  },
  'conn-eu-vies': {
    category: 'company_registry',
    enrichmentCapabilities: ['EU VAT Number Validation', 'Registered Legal Name (member-state dependent)', 'Registered Address (member-state dependent)'],
    dataCategories: ['tax_vat', 'statutory_identity'],
    apiAvailability: 'Live European Commission REST API (No API key required)',
    endpointDoc: 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number',
    costLimitations: 'Free EU public service; subject to member-state availability',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'authoritative_registry',
    honestLimitationNote: 'Covers EU27 + XI VAT numbers; Germany/Spain may withhold name/address due to national privacy rules.',
  },
  'conn-web-inspector': {
    category: 'website_domain',
    enrichmentCapabilities: ['Domain & Redirect Verification', 'Canonical Domain', 'Company Description', 'Products & Services', 'Certifications', 'Careers & Size Signals', 'Official Social Links', 'Business Contact Details', 'Leadership Pages', 'Schema.org JSON-LD'],
    dataCategories: ['website_domain', 'commercial_profile', 'contact_channels', 'leadership', 'certifications'],
    apiAvailability: 'Built-In SSRF-Protected Inspector (No API key required)',
    endpointDoc: 'Direct HTTPS public company pages (robots.txt & DNS-pinned)',
    costLimitations: 'Zero third-party API fees; bounded page and byte limits enforced',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'official_company_source',
    honestLimitationNote: 'Inspects only publicly accessible company pages respecting robots.txt and SSRF rules; never bypasses logins, CAPTCHAs, or paywalls.',
  },
  'conn-hunter-email': {
    category: 'email_verification',
    enrichmentCapabilities: ['Email Syntax & Domain Check', 'MX & SMTP Server Verification', 'Deliverability Classification', 'Catch-All Detection', 'Disposable & Webmail Detection', 'Public Web Source Sightings'],
    dataCategories: ['email_verification'],
    apiAvailability: 'Live Commercial API v2 (Requires owner Hunter.io API key)',
    endpointDoc: 'https://api.hunter.io/v2/email-verifier',
    costLimitations: 'Free tier (50 verifications/mo); paid plans for commercial scale; 10 req/s & 300 req/min',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'authorized_verification_api',
    honestLimitationNote: 'Requires Hunter.io API key in Credential Vault. Catch-all domains cannot guarantee individual mailbox existence.',
  },
  'conn-zerobounce-email': {
    category: 'email_verification',
    enrichmentCapabilities: ['Deliverability Verification', 'Catch-All & Abuse Detection', 'Spamtrap & Disposable Detection', 'Role-Based Detection', 'MX & SMTP Provider Identification'],
    dataCategories: ['email_verification'],
    apiAvailability: 'Live Commercial API v2 (Requires owner ZeroBounce API key)',
    endpointDoc: 'https://api.zerobounce.net/v2/validate',
    costLimitations: 'Pay-as-you-go verification credits; commercial B2B use permitted',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'authorized_verification_api',
    honestLimitationNote: 'Requires ZeroBounce API key in Credential Vault. Verification consumes 1 credit per valid/invalid/catch-all result.',
  },
  'conn-numverify-phone': {
    category: 'phone_verification',
    enrichmentCapabilities: ['International Phone Validation', 'E.164 & Local Formatting', 'Carrier Identification', 'Line Type (Landline / Mobile / Toll-Free)', 'Geographic Location'],
    dataCategories: ['phone_verification'],
    apiAvailability: 'Live Commercial API via APILayer HTTPS (Requires owner API key)',
    endpointDoc: 'https://api.apilayer.com/number_verification/validate',
    costLimitations: 'APILayer subscription quota applies (free & commercial tiers available)',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'authorized_verification_api',
    honestLimitationNote: 'Confirms carrier/line type and numbering plan validity; does not prove a specific individual owns the number.',
  },
  'conn-apollo': {
    category: 'b2b_people_enrichment',
    enrichmentCapabilities: ['Decision-Maker Titles & Departments', 'Seniority & Function', 'Published Professional Profile URLs', 'Employment History', 'Company Headcount & Domain Context'],
    dataCategories: ['decision_makers', 'employment_status', 'commercial_profile'],
    apiAvailability: 'Live Commercial B2B API v1 (Requires owner Apollo.io API key)',
    endpointDoc: 'https://api.apollo.io/api/v1/mixed_people/search',
    costLimitations: 'Apollo.io API plan credits and rate limits apply',
    commercialUsagePermitted: true,
    verificationCapability: false,
    reliabilityClassification: 'authorized_commercial_api',
    honestLimitationNote: 'Third-party commercial B2B dataset; treat as source-reported unless corroborated by official registry or company website.',
  },
  'conn-opencorporates': {
    category: 'company_registry',
    enrichmentCapabilities: ['Global Corporate Entity Lookup', 'Company Status & Incorporation Date', 'Registered Address', 'Corporate Officers & Positions'],
    dataCategories: ['statutory_identity', 'address', 'status', 'leadership'],
    apiAvailability: 'Live Commercial/Open API v0.4 (Requires owner API token)',
    endpointDoc: 'https://api.opencorporates.com/v0.4',
    costLimitations: 'Commercial API subscription token required for reliable production throughput',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'authorized_commercial_api',
    honestLimitationNote: 'Aggregates official national corporate registries globally; freshness varies by underlying jurisdiction.',
  },
  'conn-wikidata': {
    category: 'directory_reference',
    enrichmentCapabilities: ['Official Website', 'Headquarters', 'Parent/Subsidiary Links', 'Industry & Founded Date', 'Key Leadership (CEO/Founder/Chair)'],
    dataCategories: ['commercial_profile', 'ownership_hierarchy', 'leadership'],
    apiAvailability: 'Live Open MediaWiki/Wikidata API (No API key required)',
    endpointDoc: 'https://www.wikidata.org/w/api.php',
    costLimitations: 'Free CC0 structured knowledge graph; polite User-Agent rate limits apply',
    commercialUsagePermitted: true,
    verificationCapability: false,
    reliabilityClassification: 'open_public_directory',
    honestLimitationNote: 'Community-edited open data; primarily covers notable/medium-to-large enterprises and may lag recent executive changes.',
  },
  'conn-brave-search': {
    category: 'web_search',
    enrichmentCapabilities: ['Official Website Discovery', 'Public Company Announcements', 'Executive Appointment News'],
    dataCategories: ['website_domain', 'public_mentions'],
    apiAvailability: 'Live Commercial Web Search API (Requires owner Brave Search API key)',
    endpointDoc: 'https://api.search.brave.com/res/v1/web/search',
    costLimitations: 'Subscription tier rate & monthly query limits apply',
    commercialUsagePermitted: true,
    verificationCapability: false,
    reliabilityClassification: 'web_search_index',
    honestLimitationNote: 'Search snippets are unverified leads until confirmed against official company sites or registries.',
  },
  'conn-google-cse': {
    category: 'web_search',
    enrichmentCapabilities: ['Official Website Discovery', 'Public Announcements', 'Domain-Scoped Search'],
    dataCategories: ['website_domain', 'public_mentions'],
    apiAvailability: 'Live Commercial Search API (Requires API key + Search Engine CX ID)',
    endpointDoc: 'https://www.googleapis.com/customsearch/v1',
    costLimitations: '100 free queries/day; $5 per 1,000 queries up to 10k/day',
    commercialUsagePermitted: true,
    verificationCapability: false,
    reliabilityClassification: 'web_search_index',
    honestLimitationNote: 'Search snippets are never elevated to verified facts without authoritative corroboration.',
  },
  'conn-gemini': {
    category: 'ai_assistance',
    enrichmentCapabilities: ['Evidence Attribute Extraction', 'Company Profile Summarization', 'Industry Classification', 'Conflict Analysis', 'Data Quality Explanation'],
    dataCategories: ['ai_analysis'],
    apiAvailability: 'Server-Side Gemini API (Requires GEMINI_API_KEY; deterministic fallback active)',
    endpointDoc: '@google/genai server-side SDK (gemini-4-hydrogen)',
    costLimitations: 'Gemini API token quotas apply; platform operates deterministically without AI',
    commercialUsagePermitted: true,
    verificationCapability: false,
    reliabilityClassification: 'ai_assistance_only',
    honestLimitationNote: 'Strictly assistance-only. AI outputs are labeled ai_extracted/inferred and can never verify contacts or invent data.',
  },
};

/**
 * Built-in open-standard verification engines + honestly documented restricted/retired providers.
 */
const STATIC_ENRICHMENT_PROVIDERS: EnrichmentProviderCatalogEntry[] = [
  {
    providerId: 'builtin-dns-mx-email',
    name: 'Built-In DNS / MX / SPF / DMARC Email Inspector',
    category: 'email_verification',
    enrichmentCapabilities: [
      'RFC Syntax Validation',
      'Personal Webmail & Disposable Domain Detection',
      'Role-Based Address Classification',
      'Live DNS MX Record Lookup',
      'SPF & DMARC Mail Configuration Check',
    ],
    supportedCountries: ['GLOBAL'],
    dataCategories: ['email_verification'],
    apiAvailability: 'Operational Built-In Standards Check (Zero credentials required)',
    endpointDoc: 'Node.js DNS resolver (MX & TXT queries only — zero invasive SMTP probing)',
    credentialRequirements: 'None required',
    credentialStatus: 'none_required',
    operationalStatus: 'operational',
    rateLimits: 'Local DNS resolver limits; bounded timeout per lookup',
    costLimitations: 'Zero external API cost',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'authorized_verification_api',
    honestLimitationNote:
      'Confirms domain mail configuration (MX/SPF/DMARC) only. Never claims mailbox deliverability without an authorized verification API (Hunter/ZeroBounce) and never performs invasive SMTP probing.',
  },
  {
    providerId: 'builtin-e164-phone',
    name: 'Built-In International E.164 Phone Normalizer (Phase 3)',
    category: 'phone_verification',
    enrichmentCapabilities: [
      'E.164 Canonical Normalization',
      'Country Calling Code Detection',
      'National & International Formatting',
      'Toll-Free / Prefix Heuristics',
      'Invalid & Conflicting Phone Detection',
    ],
    supportedCountries: ['GLOBAL'],
    dataCategories: ['phone_verification'],
    apiAvailability: 'Operational Built-In Standards Engine (Zero credentials required)',
    endpointDoc: 'Local ITU-T E.164 & Phase 3 country numbering rules',
    credentialRequirements: 'None required',
    credentialStatus: 'none_required',
    operationalStatus: 'operational',
    rateLimits: 'Unrestricted local execution',
    costLimitations: 'Zero external API cost',
    commercialUsagePermitted: true,
    verificationCapability: true,
    reliabilityClassification: 'official_company_source',
    honestLimitationNote:
      'Validates numbering format and country length rules only; does not confirm live carrier activation or personal ownership.',
  },
  {
    providerId: 'provider-clearbit-retired',
    name: 'Clearbit Standalone Enrichment API',
    category: 'company_registry',
    enrichmentCapabilities: ['Historical B2B Company & Domain Enrichment (Retired)'],
    supportedCountries: ['GLOBAL'],
    dataCategories: ['commercial_profile'],
    apiAvailability: 'Retired — standalone public Clearbit API discontinued after HubSpot acquisition',
    credentialRequirements: 'Not available for new standalone integrations',
    credentialStatus: 'not_applicable',
    operationalStatus: 'retired',
    rateLimits: 'N/A (Retired)',
    costLimitations: 'Merged into HubSpot Breeze Intelligence ecosystem',
    commercialUsagePermitted: false,
    verificationCapability: false,
    reliabilityClassification: 'restricted_or_unavailable',
    honestLimitationNote:
      'Honest status: Clearbit standalone enrichment API is retired/sunsetted. LEED does not fabricate Clearbit responses.',
  },
  {
    providerId: 'provider-linkedin-restricted',
    name: 'LinkedIn Profile & Company Enrichment API',
    category: 'b2b_people_enrichment',
    enrichmentCapabilities: ['Restricted Partner-Only Profile & Employment API'],
    supportedCountries: ['GLOBAL'],
    dataCategories: ['decision_makers', 'employment_status'],
    apiAvailability: 'Restricted — closed partner program; scraping & automated login strictly prohibited',
    credentialRequirements: 'Restricted enterprise partner agreement',
    credentialStatus: 'not_applicable',
    operationalStatus: 'restricted',
    rateLimits: 'Closed partner limits',
    costLimitations: 'Not publicly available for general commercial API enrollment',
    commercialUsagePermitted: false,
    verificationCapability: false,
    reliabilityClassification: 'restricted_or_unavailable',
    honestLimitationNote:
      'LEED strictly prohibits scraping LinkedIn, bypassing logins/CAPTCHAs, or accessing private profiles. Only explicitly published LinkedIn URLs from company sites or authorized APIs are retained.',
  },
  {
    providerId: 'provider-direct-smtp-probing',
    name: 'Direct SMTP RCPT-TO Mailbox Probing',
    category: 'email_verification',
    enrichmentCapabilities: ['Prohibited — Invasive Mail Server Probing'],
    supportedCountries: ['GLOBAL'],
    dataCategories: ['email_verification'],
    apiAvailability: 'Unavailable by LEED Security & Compliance Policy',
    credentialRequirements: 'Not applicable',
    credentialStatus: 'not_applicable',
    operationalStatus: 'unavailable',
    rateLimits: 'Prohibited',
    costLimitations: 'Prohibited (triggers IP blocklists & false positives on catch-all relays)',
    commercialUsagePermitted: false,
    verificationCapability: false,
    reliabilityClassification: 'restricted_or_unavailable',
    honestLimitationNote:
      'LEED deliberately prohibits unauthorized SMTP probing. Use DNS MX/SPF/DMARC plus authorized commercial APIs (Hunter.io or ZeroBounce).',
  },
];

function mapConnectorToOperationalStatus(conn: ConnectorStatus): EnrichmentProviderStatus {
  if (conn.config && conn.config.enabled === false) {
    return 'unavailable';
  }
  const requiresAuth = conn.credentialRequirements?.required || conn.authType !== 'none_open';
  if (requiresAuth && !conn.isConfigured) {
    return 'missing_credentials';
  }
  if (conn.healthState === 'temporarily_unavailable' || conn.healthState === 'degraded') {
    return 'error';
  }
  if (requiresAuth && conn.isConfigured) {
    return 'operational_with_credentials';
  }
  return 'operational';
}

export function buildEnrichmentProviderCatalog(
  connectorStatuses: ConnectorStatus[]
): EnrichmentProviderCatalogEntry[] {
  const entries: EnrichmentProviderCatalogEntry[] = [...STATIC_ENRICHMENT_PROVIDERS];

  for (const conn of connectorStatuses) {
    const override = CONNECTOR_ENRICHMENT_META[conn.id];
    const requiresAuth = conn.credentialRequirements?.required || conn.authType !== 'none_open';
    const isRegistry = conn.sourceCategory === 'government_registry' || conn.category === 'government_registry';

    entries.push({
      providerId: conn.id,
      connectorId: conn.id,
      name: conn.name,
      category:
        override?.category ||
        (isRegistry
          ? 'company_registry'
          : conn.sourceCategory === 'maps_geo'
          ? 'directory_reference'
          : conn.sourceCategory === 'search_engine'
          ? 'web_search'
          : conn.sourceCategory === 'ai_engine'
          ? 'ai_assistance'
          : 'directory_reference'),
      enrichmentCapabilities:
        override?.enrichmentCapabilities ||
        (isRegistry
          ? ['Official Registration Lookup', 'Legal Name & Status', 'Registered Address']
          : conn.capabilities || ['Business Data Enrichment']),
      supportedCountries: conn.supportsAllCountries ? ['GLOBAL'] : conn.countryCoverage,
      dataCategories:
        override?.dataCategories ||
        (isRegistry ? ['statutory_identity', 'address', 'status'] : ['commercial_profile']),
      apiAvailability:
        override?.apiAvailability ||
        (requiresAuth
          ? `Live Official API (${conn.authType} credentials required)`
          : 'Live Open API (No API key required)'),
      endpointDoc: override?.endpointDoc || conn.homepageUrl,
      credentialRequirements: requiresAuth
        ? conn.credentialRequirements?.setupInstructions || `Requires ${conn.authType} in Credential Vault`
        : 'None required (open API)',
      credentialStatus: !requiresAuth
        ? 'none_required'
        : conn.isConfigured
        ? 'configured'
        : 'missing',
      operationalStatus: mapConnectorToOperationalStatus(conn),
      rateLimits: conn.rateLimitNote || 'Standard provider rate limits apply',
      costLimitations:
        override?.costLimitations ||
        (requiresAuth
          ? 'Subject to official provider API plan / registration terms'
          : 'Open public data / zero license fee'),
      commercialUsagePermitted: override?.commercialUsagePermitted ?? true,
      lastSuccessfulExecution: conn.lastSuccessAt,
      lastFailure: conn.lastError ? conn.lastRunAt : undefined,
      lastErrorMessage: conn.lastError,
      verificationCapability: override?.verificationCapability ?? isRegistry,
      reliabilityClassification:
        override?.reliabilityClassification ||
        (isRegistry ? 'authoritative_registry' : 'open_public_directory'),
      honestLimitationNote:
        override?.honestLimitationNote ||
        (requiresAuth && !conn.isConfigured
          ? 'Credentials not yet configured in the encrypted Credential Vault.'
          : conn.description || 'Active registered LEED connector.'),
    });
  }

  return entries;
}
