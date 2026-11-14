import { ConnectorStatus, RegistryAuditCriteria, SevenStateRegistryStatus } from '../types.js';

export interface AuditedRegistryEntry {
  countryCode: string;
  countryName: string;
  flag: string;
  authorityName: string;
  connectorId?: string;
  primaryIdentifierType: string;
  defaultState: SevenStateRegistryStatus;
  auditDetails: RegistryAuditCriteria;
}

export const TEN_COUNTRY_REGISTRY_AUDIT: Record<string, AuditedRegistryEntry> = {
  NO: {
    countryCode: 'NO',
    countryName: 'Norway',
    flag: '🇳🇴',
    authorityName: 'Brønnøysund Register Centre (Brreg / Enhetsregisteret)',
    connectorId: 'conn-brreg',
    primaryIdentifierType: 'NO_ORG',
    defaultState: 'live_and_operational',
    auditDetails: {
      officialApiExists: true,
      officialApiSummary: 'Yes — Enhetsregisteret REST JSON API (https://data.brreg.no/enhetsregisteret/api).',
      publicAccessPermitted: true,
      publicAccessSummary: 'Yes — open unauthenticated public REST endpoints and bulk downloads.',
      authenticationAndCredentials: 'None required (anonymous open access; descriptive User-Agent recommended).',
      documentationUrl: 'https://data.brreg.no/enhetsregisteret/api/docs/index.html',
      accessRestrictions: 'Polite throttling enforced; returns HAL JSON with max 10,000 result window per query.',
      availableBusinessFields: [
        'organisasjonsnummer (NO_ORG)',
        'navn (Legal Name)',
        'organisasjonsform (Legal Form)',
        'naeringskode1 (NACE)',
        'forretningsadresse / postadresse',
        'hjemmeside (Website)',
        'konkurs / underAvvikling / slettedato (Legal Status)',
      ],
      searchAndVerificationCapabilities: [
        'Name search (?navn=...)',
        'Exact 9-digit OrgNr lookup (/enheter/{orgnr})',
        'Postal code filter (?postnummer=...)',
        'Modulo-11 checksum verification',
      ],
      rateLimitsAndPagination: 'HAL pagination (?page=0..N&size=1..100); client throttled to 30 req/min.',
      commercialUseAndRedistribution: 'Permitted with attribution under Norwegian Licence for Open Government Data (NLOD 2.0).',
    },
  },
  GB: {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    flag: '🇬🇧',
    authorityName: 'UK Companies House',
    connectorId: 'conn-companies-house',
    primaryIdentifierType: 'UK_CRN',
    defaultState: 'live_auth_required',
    auditDetails: {
      officialApiExists: true,
      officialApiSummary: 'Yes — Companies House Public Data REST API (https://api.company-information.service.gov.uk).',
      publicAccessPermitted: true,
      publicAccessSummary: 'Yes — free developer access via registered Companies House API key.',
      authenticationAndCredentials: 'HTTP Basic authentication using free Companies House REST API key (COMPANIES_HOUSE_API_KEY).',
      documentationUrl: 'https://developer-specs.company-information.service.gov.uk/',
      accessRestrictions: 'Returns HTTP 401 without valid key; offline sample fallback only when unconfigured.',
      availableBusinessFields: [
        'company_number (UK_CRN)',
        'company_name / title (Legal Name)',
        'company_status (active/dissolved/liquidation)',
        'type (ltd/plc/llp)',
        'date_of_creation',
        'registered_office_address',
        'sic_codes',
      ],
      searchAndVerificationCapabilities: [
        'Company name & number search (/search/companies)',
        'Exact CRN profile lookup (/company/{crn})',
        '8-char alphanumeric / 0-padded CRN normalization',
      ],
      rateLimitsAndPagination: '600 requests per 5 minutes (HTTP X-Ratelimit-Remain header); start_index & items_per_page pagination.',
      commercialUseAndRedistribution: 'Permitted under Crown Copyright Open Government Licence v3.0 (OGL v3.0) with attribution.',
    },
  },
  AU: {
    countryCode: 'AU',
    countryName: 'Australia',
    flag: '🇦🇺',
    authorityName: 'Australian Business Register (ABR / ABN Lookup Web Services)',
    connectorId: 'conn-abn',
    primaryIdentifierType: 'AU_ABN',
    defaultState: 'live_auth_required',
    auditDetails: {
      officialApiExists: true,
      officialApiSummary: 'Yes — ABR XML/SOAP & JSONP Web Services (https://abr.business.gov.au/json/).',
      publicAccessPermitted: true,
      publicAccessSummary: 'Yes — open free access with an official ABR Web Services GUID; ATO Mod-89 works offline.',
      authenticationAndCredentials: 'Free ABR GUID required (`ABR_GUID` / Connector credential).',
      documentationUrl: 'https://abr.business.gov.au/Documentation/WebServiceMethods',
      accessRestrictions: 'Non-public personal tax details excluded; requires valid GUID for live entity lookup.',
      availableBusinessFields: [
        'Abn (11-digit AU_ABN) & Acn (9-digit AU_ACN)',
        'EntityName / BusinessName',
        'AbnStatus (Active/Cancelled)',
        'EntityTypeName',
        'AddressState & AddressPostcode',
        'Gst Registration Status',
      ],
      searchAndVerificationCapabilities: [
        'Business name search (MatchingNames.aspx)',
        'Exact ABN / ACN lookup (AbnDetails.aspx / AcnDetails.aspx)',
        'Offline ATO Modulo-89 checksum validation',
      ],
      rateLimitsAndPagination: 'Max 200 matches per name call (maxResults); GUID usage monitored against fair-use quotas.',
      commercialUseAndRedistribution: 'Subject to ABR Terms of Access; bulk extracts provided via data.gov.au under CC BY 3.0 AU.',
    },
  },
  US: {
    countryCode: 'US',
    countryName: 'United States',
    flag: '🇺🇸',
    authorityName: 'U.S. SEC EDGAR (Federal Public Filers) + State SOS Portals',
    connectorId: 'conn-us-sec',
    primaryIdentifierType: 'US_CIK',
    defaultState: 'live_and_operational',
    auditDetails: {
      officialApiExists: true,
      officialApiSummary: 'Yes for SEC-reporting corporations (data.sec.gov/submissions, sec.gov/files/company_tickers.json). No unified federal API exists for private state LLCs/corps.',
      publicAccessPermitted: true,
      publicAccessSummary: 'Yes — SEC EDGAR JSON APIs are open to the public without API keys.',
      authenticationAndCredentials: 'No API key required; mandatory descriptive User-Agent header under SEC Fair Access rules.',
      documentationUrl: 'https://www.sec.gov/edgar/sec-api-documentation',
      accessRestrictions: 'Private companies are incorporated per-state across 50 Secretary of State registries without a single free federal REST API.',
      availableBusinessFields: [
        'cik (10-digit US_CIK)',
        'ein (Federal Employer ID)',
        'name (Legal Registrant Name)',
        'sic & sicDescription',
        'stateOfIncorporation',
        'addresses.business (Street, City, State, ZIP)',
        'tickers & exchanges',
      ],
      searchAndVerificationCapabilities: [
        'Ticker & legal name search against SEC issuer index',
        'Exact 10-digit CIK lookup (/submissions/CIK{10}.json)',
        'State/city/postal filtering on SEC business addresses',
      ],
      rateLimitsAndPagination: 'Strictly <= 10 requests/second per declared User-Agent (throttled to 8 req/s); local slice pagination over SEC index.',
      commercialUseAndRedistribution: 'U.S. Federal Government works are Public Domain (17 U.S.C. § 105).',
    },
  },
  DE: {
    countryCode: 'DE',
    countryName: 'Germany',
    flag: '🇩🇪',
    authorityName: 'Gemeinsames Registerportal der Länder (Handelsregister)',
    primaryIdentifierType: 'DE_HANDELSREGISTER',
    defaultState: 'public_access_unavailable',
    auditDetails: {
      officialApiExists: false,
      officialApiSummary: 'No free open public REST API. Programmatic bulk/XJustiz access is restricted to registered judicial/commercial subscribers.',
      publicAccessPermitted: false,
      publicAccessSummary: 'Interactive web portal allows human searches only; automated scraping or bulk harvesting is prohibited.',
      authenticationAndCredentials: 'Judicial portal registration / commercial bulk data contract (RegisSTAR / Bundesanzeiger-Verlag) required for API access.',
      documentationUrl: 'https://www.handelsregister.de',
      accessRestrictions: 'Session cookies, strict rate caps, and legal restrictions prohibit unauthorized automated scraping.',
      availableBusinessFields: [
        'Handelsregisternummer (HRA / HRB)',
        'Registergericht (Local Court)',
        'Firma (Legal Name)',
        'Sitz (Registered City)',
        'Status (active/deleted)',
      ],
      searchAndVerificationCapabilities: [
        'Offline HRA/HRB + Registergericht syntax validation only',
        'Automated live lookup intentionally disabled to comply with portal access controls',
      ],
      rateLimitsAndPagination: 'Not applicable (no public unauthenticated REST API).',
      commercialUseAndRedistribution: 'Statutory German commercial register data redistribution governed by HGB § 9 / Justizverwaltung agreements.',
    },
  },
  FR: {
    countryCode: 'FR',
    countryName: 'France',
    flag: '🇫🇷',
    authorityName: 'DINUM Annuaire des Entreprises / INSEE SIRENE',
    connectorId: 'conn-fr-sirene',
    primaryIdentifierType: 'FR_SIREN',
    defaultState: 'live_and_operational',
    auditDetails: {
      officialApiExists: true,
      officialApiSummary: 'Yes — official French inter-ministerial open REST API (https://recherche-entreprises.api.gouv.fr/search).',
      publicAccessPermitted: true,
      publicAccessSummary: 'Yes — completely open public government API backed by INSEE SIRENE & RNE.',
      authenticationAndCredentials: 'None required for Annuaire Recherche Entreprises API (INSEE direct API portal also offers free OAuth keys).',
      documentationUrl: 'https://annuaire-entreprises.data.gouv.fr/donnees/api',
      accessRestrictions: 'Non-diffusible (privacy-opted-out sole proprietors) masked per INSEE rules.',
      availableBusinessFields: [
        'siren (9-digit FR_SIREN) & siege.siret (14-digit FR_SIRET)',
        'nom_complet / nom_raison_sociale',
        'etat_administratif (A = Active, C = Ceased)',
        'activite_principale (NAF/APE code)',
        'nature_juridique',
        'siege (Address, postal code, commune, lat/lon)',
      ],
      searchAndVerificationCapabilities: [
        'Name, SIREN, SIRET, and postal code search',
        'Exact SIREN / SIRET verification',
        'Luhn checksum validation',
      ],
      rateLimitsAndPagination: '7 requests/second ceiling; native page & per_page (up to 25) pagination.',
      commercialUseAndRedistribution: 'Permitted including commercial reuse with attribution under Licence Ouverte v2.0 (Etalab).',
    },
  },
  CA: {
    countryCode: 'CA',
    countryName: 'Canada',
    flag: '🇨🇦',
    authorityName: 'Corporations Canada (ISED) & Provincial Corporate Registries',
    primaryIdentifierType: 'CA_BN',
    defaultState: 'not_implemented',
    auditDetails: {
      officialApiExists: true,
      officialApiSummary: 'Corporations Canada provides a REST API via ISED API Store requiring subscription approval; provinces (ON, QC, BC, AB) maintain separate registries.',
      publicAccessPermitted: true,
      publicAccessSummary: 'Federal HTML lookup and Open Government CKAN dataset catalogue are public; transactional ISED REST API requires API Store registration.',
      authenticationAndCredentials: 'ISED API Portal OAuth2 / subscription key required for federal REST endpoints; provincial APIs vary.',
      documentationUrl: 'https://ised-isde.canada.ca/site/corporations-canada/en',
      accessRestrictions: 'Federal API covers CBCA/federal corporations only; provincial corporations require provincial registry integration.',
      availableBusinessFields: [
        'Corporation Number (CA_CORP) & Business Number (CA_BN)',
        'Corporate Name',
        'Governing Legislation & Status',
        'Registered Office Province & Address',
      ],
      searchAndVerificationCapabilities: [
        'Offline CRA 9-digit BN Luhn checksum validation & Federal Corp syntax check',
        'Live ISED API adapter pending owner portal credential integration',
      ],
      rateLimitsAndPagination: 'Managed by ISED API gateway tier once subscribed.',
      commercialUseAndRedistribution: 'Open Government Licence — Canada (federal open datasets); provincial terms vary by province.',
    },
  },
  JP: {
    countryCode: 'JP',
    countryName: 'Japan',
    flag: '🇯🇵',
    authorityName: 'National Tax Agency of Japan (NTA) Corporate Number Site',
    connectorId: 'conn-jp-nta',
    primaryIdentifierType: 'JP_CN',
    defaultState: 'live_auth_required',
    auditDetails: {
      officialApiExists: true,
      officialApiSummary: 'Yes — NTA Corporate Number Publication Web-API v4 (https://api.houjin-bangou.nta.go.jp/4/).',
      publicAccessPermitted: true,
      publicAccessSummary: 'Yes — public Web-API v4 and bulk CSV downloads available upon free Application ID registration.',
      authenticationAndCredentials: 'Free NTA Web-API Application ID required (`JP_NTA_APP_ID` / Connector credential).',
      documentationUrl: 'https://www.houjin-bangou.nta.go.jp/webapi/',
      accessRestrictions: 'Queries fail without registered Application ID; bulk downloads serve full historical snapshots.',
      availableBusinessFields: [
        'corporateNumber (13-digit Houjin Bangou / JP_CN)',
        'name & enName (Legal Name + English)',
        'prefectureName / cityName / streetNumber / postCode',
        'kind (Entity Classification)',
        'closeDate / closeCause (Closure Status)',
      ],
      searchAndVerificationCapabilities: [
        'Corporate name search (/4/name)',
        'Exact 13-digit Corporate Number lookup (/4/num)',
        'Offline 13-digit Modulo-9 checksum validation',
      ],
      rateLimitsAndPagination: 'Split pagination via `divide` parameter (up to 2,000 rows per chunk); respects NTA Web-API guidelines.',
      commercialUseAndRedistribution: 'Permitted for commercial use with attribution under Creative Commons Attribution 4.0 (CC BY 4.0).',
    },
  },
  IN: {
    countryCode: 'IN',
    countryName: 'India',
    flag: '🇮🇳',
    authorityName: 'Ministry of Corporate Affairs (MCA21)',
    primaryIdentifierType: 'IN_CIN',
    defaultState: 'public_access_unavailable',
    auditDetails: {
      officialApiExists: false,
      officialApiSummary: 'No free open public unauthenticated API. Official MCA V2/V3 & GST APIs are restricted to authorized GST Suvidha Providers (GSPs) or paid API Setu / commercial licensees.',
      publicAccessPermitted: false,
      publicAccessSummary: 'Public web portal requires CAPTCHA verification and session tokens; automated scraping is blocked and prohibited.',
      authenticationAndCredentials: 'Authorized GSP / API Setu enterprise credentials required for programmatic verification.',
      documentationUrl: 'https://www.mca.gov.in',
      accessRestrictions: 'Strict CAPTCHA & WAF controls on MCA21 public master data portal.',
      availableBusinessFields: [
        'CIN (21-char Corporate Identification Number)',
        'Company Name & ROC Jurisdiction',
        'Company Status & Paid-up Capital',
        'Registered Office Address',
      ],
      searchAndVerificationCapabilities: [
        'Offline 21-char IN_CIN structural validation ([L|U] + NIC + State + Year + Ownership + ROC)',
        'No automated unauthenticated live querying',
      ],
      rateLimitsAndPagination: 'Restricted to authorized partner gateways.',
      commercialUseAndRedistribution: 'Subject to Ministry of Corporate Affairs portal and API Setu terms.',
    },
  },
  SG: {
    countryCode: 'SG',
    countryName: 'Singapore',
    flag: '🇸🇬',
    authorityName: 'ACRA Entities via data.gov.sg (+ BizFile+ Portal)',
    connectorId: 'conn-sg-acra',
    primaryIdentifierType: 'SG_UEN',
    defaultState: 'live_and_operational',
    auditDetails: {
      officialApiExists: true,
      officialApiSummary: 'Yes — official ACRA Registered Entities dataset via data.gov.sg CKAN DataStore REST API; transactional BizFile+ APIs reside on ACRA API Mall.',
      publicAccessPermitted: true,
      publicAccessSummary: 'Yes — ACRA UEN directory dataset on data.gov.sg is openly accessible without authentication.',
      authenticationAndCredentials: 'None required for data.gov.sg ACRA dataset; SingPass / paid API Mall credentials required for BizFile+ officer extracts.',
      documentationUrl: 'https://data.gov.sg/datasets/d_3f960c10fed6145404ca7b821f263b87/view',
      accessRestrictions: 'Open dataset provides core UEN registration, status, SSIC, and address (does not include private director/shareholder details).',
      availableBusinessFields: [
        'uen (Singapore Unique Entity Number / SG_UEN)',
        'entity_name',
        'uen_status_desc (Registered / Ceased / Deregistered)',
        'entity_type_desc',
        'reg_street_name & reg_postal_code',
        'primary_ssic_code & primary_ssic_description',
      ],
      searchAndVerificationCapabilities: [
        'Entity name full-text search (?q=...)',
        'Exact UEN lookup (?filters={"uen":...})',
        'SG_UEN structural regex validation',
      ],
      rateLimitsAndPagination: 'CKAN limit/offset pagination; client-throttled to 25 req/min.',
      commercialUseAndRedistribution: 'Permitted under Singapore Open Data Licence v1.0 with attribution.',
    },
  },
};

export function resolveSevenStateRegistryStatus(
  entry: AuditedRegistryEntry,
  connector?: ConnectorStatus
): SevenStateRegistryStatus {
  if (!connector) {
    return entry.defaultState;
  }

  if (connector.healthState === 'disabled') {
    return 'configuration_required';
  }
  if (connector.healthState === 'configuration_required') {
    return 'configuration_required';
  }
  if (connector.healthState === 'authentication_required') {
    return 'live_auth_required';
  }
  if (connector.healthState === 'temporarily_unavailable' || connector.healthState === 'rate_limited') {
    return 'temporarily_unavailable';
  }
  if (connector.accessMode === 'offline_reference' && !connector.isConfigured) {
    return 'offline_reference_only';
  }
  if (connector.healthState === 'operational' || connector.healthState === 'not_tested' || connector.operational) {
    return connector.isConfigured ? 'live_and_operational' : 'live_auth_required';
  }
  if (connector.healthState === 'degraded') {
    return 'temporarily_unavailable';
  }

  return entry.defaultState;
}
