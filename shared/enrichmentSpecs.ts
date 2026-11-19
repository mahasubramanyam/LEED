/**
 * Phase 12 — Shared Enrichment, Freshness, Source Precedence & Verification Specifications.
 * Used identically across backend orchestration and frontend Data Quality / Conflict UI.
 */

export type EnrichmentVerificationLabel =
  | 'officially_verified'
  | 'multi_source_verified'
  | 'source_reported'
  | 'ai_extracted'
  | 'inferred'
  | 'unknown'
  | 'conflicting'
  | 'outdated';

export type EnrichmentSourceClass =
  | 'official_registry'
  | 'authorized_verification_provider'
  | 'official_website'
  | 'authorized_provider'
  | 'owner_manual'
  | 'business_directory'
  | 'search_provider'
  | 'ai_extracted'
  | 'inferred'
  | 'not_verified';

export type EmailVerificationDetailedStatus =
  | 'provider_deliverable'
  | 'provider_risky'
  | 'catch_all'
  | 'disposable'
  | 'role_based'
  | 'undeliverable'
  | 'mail_config_verified'
  | 'mx_present'
  | 'domain_valid'
  | 'syntax_valid'
  | 'invalid_syntax'
  | 'personal_webmail_rejected'
  | 'stale'
  | 'verification_failed'
  | 'unknown';

export type PhoneVerificationDetailedStatus =
  | 'provider_verified'
  | 'e164_valid'
  | 'format_valid_unverified'
  | 'invalid_format'
  | 'conflicting'
  | 'stale'
  | 'verification_failed'
  | 'unknown';

export type PhoneLineType =
  | 'landline'
  | 'mobile'
  | 'voip'
  | 'toll_free'
  | 'special_services'
  | 'unknown';

export interface AttributeFreshnessSpec {
  attribute: string;
  label: string;
  entityType: 'company' | 'person' | 'contact';
  maxAgeDays: number;
  warningAgeDays: number;
  critical: boolean;
  rationale: string;
}

/**
 * Attribute-specific freshness intervals (NOT one arbitrary expiration date for all fields).
 */
export const ATTRIBUTE_FRESHNESS_RULES: Record<string, AttributeFreshnessSpec> = {
  // Company Legal & Registration
  legalName: {
    attribute: 'legalName',
    label: 'Legal Company Name',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 270,
    critical: true,
    rationale: 'Legal names change infrequently; annual registry check is appropriate.',
  },
  tradingName: {
    attribute: 'tradingName',
    label: 'Trading Name',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 270,
    critical: false,
    rationale: 'Commercial brand names typically persist for 12+ months.',
  },
  legalEntityType: {
    attribute: 'legalEntityType',
    label: 'Legal Entity Type',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 300,
    critical: false,
    rationale: 'Corporate structure changes rarely and requires registry filing.',
  },
  registrationNumber: {
    attribute: 'registrationNumber',
    label: 'Registration Number',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 300,
    critical: true,
    rationale: 'National registration numbers are persistent once officially verified.',
  },
  taxVatId: {
    attribute: 'taxVatId',
    label: 'Tax / VAT Identifier',
    entityType: 'company',
    maxAgeDays: 180,
    warningAgeDays: 120,
    critical: false,
    rationale: 'VAT registrations can be suspended or revoked; re-check semi-annually.',
  },
  lei: {
    attribute: 'lei',
    label: 'Legal Entity Identifier (LEI)',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 300,
    critical: false,
    rationale: 'GLEIF LEI renewals follow an annual certification cycle.',
  },
  companyStatus: {
    attribute: 'companyStatus',
    label: 'Company Operating Status',
    entityType: 'company',
    maxAgeDays: 90,
    warningAgeDays: 60,
    critical: true,
    rationale: 'Insolvency, liquidation, or dissolution can occur rapidly; verify quarterly.',
  },
  incorporationDate: {
    attribute: 'incorporationDate',
    label: 'Incorporation Date',
    entityType: 'company',
    maxAgeDays: 730,
    warningAgeDays: 540,
    critical: false,
    rationale: 'Historical founding date is immutable once officially verified.',
  },
  registeredAddress: {
    attribute: 'registeredAddress',
    label: 'Registered Address',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 270,
    critical: true,
    rationale: 'Official headquarters addresses change periodically; check annually.',
  },
  operatingAddress: {
    attribute: 'operatingAddress',
    label: 'Operating Address',
    entityType: 'company',
    maxAgeDays: 180,
    warningAgeDays: 120,
    critical: false,
    rationale: 'Office and branch locations change more often than statutory addresses.',
  },
  website: {
    attribute: 'website',
    label: 'Official Website',
    entityType: 'company',
    maxAgeDays: 180,
    warningAgeDays: 120,
    critical: true,
    rationale: 'Domains, redirects, and SSL availability should be confirmed semi-annually.',
  },
  domain: {
    attribute: 'domain',
    label: 'Canonical Domain',
    entityType: 'company',
    maxAgeDays: 180,
    warningAgeDays: 120,
    critical: true,
    rationale: 'Rebrands and domain migrations affect email and web deliverability.',
  },
  email: {
    attribute: 'email',
    label: 'Business Email',
    entityType: 'contact',
    maxAgeDays: 90,
    warningAgeDays: 60,
    critical: true,
    rationale: 'Email mailboxes and MX records churn frequently; verify every 90 days.',
  },
  phone: {
    attribute: 'phone',
    label: 'Business Telephone',
    entityType: 'contact',
    maxAgeDays: 180,
    warningAgeDays: 120,
    critical: true,
    rationale: 'Switchboard and direct business lines should be re-checked semi-annually.',
  },
  industry: {
    attribute: 'industry',
    label: 'Industry / Sector',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 270,
    critical: true,
    rationale: 'Primary business classification is generally stable year-over-year.',
  },
  description: {
    attribute: 'description',
    label: 'Business Description',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 270,
    critical: false,
    rationale: 'Official company overview and positioning refresh annually.',
  },
  productsServices: {
    attribute: 'productsServices',
    label: 'Products & Services',
    entityType: 'company',
    maxAgeDays: 270,
    warningAgeDays: 180,
    critical: false,
    rationale: 'Commercial offerings evolve across product cycles.',
  },
  employeeRange: {
    attribute: 'employeeRange',
    label: 'Employee Size Range',
    entityType: 'company',
    maxAgeDays: 180,
    warningAgeDays: 120,
    critical: false,
    rationale: 'Headcount bands shift with hiring and restructuring.',
  },
  revenueRange: {
    attribute: 'revenueRange',
    label: 'Revenue Range',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 270,
    critical: false,
    rationale: 'Published revenue figures align with annual fiscal filings.',
  },
  socialLinks: {
    attribute: 'socialLinks',
    label: 'Official Social Profiles',
    entityType: 'company',
    maxAgeDays: 270,
    warningAgeDays: 180,
    critical: false,
    rationale: 'Official company social handles occasionally rebrand.',
  },
  certifications: {
    attribute: 'certifications',
    label: 'Business Certifications',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 270,
    critical: false,
    rationale: 'ISO, SOC 2, and industry certifications renew annually.',
  },
  parentCompany: {
    attribute: 'parentCompany',
    label: 'Parent Company / Group',
    entityType: 'company',
    maxAgeDays: 365,
    warningAgeDays: 270,
    critical: false,
    rationale: 'Corporate ownership changes via M&A events.',
  },
  // Person / Decision-Maker attributes
  jobTitle: {
    attribute: 'jobTitle',
    label: 'Job Title / Role',
    entityType: 'person',
    maxAgeDays: 90,
    warningAgeDays: 60,
    critical: true,
    rationale: 'Executive and procurement roles turn over frequently; confirm quarterly.',
  },
  employmentStatus: {
    attribute: 'employmentStatus',
    label: 'Employment Status',
    entityType: 'person',
    maxAgeDays: 90,
    warningAgeDays: 60,
    critical: true,
    rationale: 'Detect departed/resigned officers promptly before outreach.',
  },
  linkedinUrl: {
    attribute: 'linkedinUrl',
    label: 'Professional Profile URL',
    entityType: 'person',
    maxAgeDays: 180,
    warningAgeDays: 120,
    critical: false,
    rationale: 'Published profile URLs remain stable unless renamed.',
  },
  officialBioUrl: {
    attribute: 'officialBioUrl',
    label: 'Official Biography URL',
    entityType: 'person',
    maxAgeDays: 180,
    warningAgeDays: 120,
    critical: false,
    rationale: 'Company leadership pages update when executives join or depart.',
  },
};

export function getFreshnessSpec(attribute: string): AttributeFreshnessSpec {
  return (
    ATTRIBUTE_FRESHNESS_RULES[attribute] || {
      attribute,
      label: attribute,
      entityType: 'company',
      maxAgeDays: 180,
      warningAgeDays: 120,
      critical: false,
      rationale: 'Standard 180-day semi-annual verification interval.',
    }
  );
}

/**
 * Attribute-specific source precedence (higher index = weaker; index 0 = highest authority).
 * Avoids applying one blind universal ranking across legal, website, and contact verification fields.
 */
const LEGAL_REGISTRY_ORDER: EnrichmentSourceClass[] = [
  'official_registry',
  'official_website',
  'authorized_provider',
  'business_directory',
  'owner_manual',
  'search_provider',
  'ai_extracted',
  'inferred',
  'not_verified',
];

const WEBSITE_PUBLISHED_ORDER: EnrichmentSourceClass[] = [
  'official_website',
  'official_registry',
  'authorized_provider',
  'owner_manual',
  'business_directory',
  'search_provider',
  'ai_extracted',
  'inferred',
  'not_verified',
];

const CONTACT_VERIFICATION_ORDER: EnrichmentSourceClass[] = [
  'authorized_verification_provider',
  'official_website',
  'official_registry',
  'authorized_provider',
  'owner_manual',
  'business_directory',
  'search_provider',
  'ai_extracted',
  'inferred',
  'not_verified',
];

const COMMERCIAL_INTELLIGENCE_ORDER: EnrichmentSourceClass[] = [
  'official_registry',
  'authorized_provider',
  'official_website',
  'owner_manual',
  'business_directory',
  'search_provider',
  'ai_extracted',
  'inferred',
  'not_verified',
];

const PERSON_ROLE_ORDER: EnrichmentSourceClass[] = [
  'official_registry',
  'official_website',
  'authorized_provider',
  'owner_manual',
  'business_directory',
  'search_provider',
  'ai_extracted',
  'inferred',
  'not_verified',
];

export const ATTRIBUTE_SOURCE_PRECEDENCE: Record<string, EnrichmentSourceClass[]> = {
  // Statutory / legal fields -> Government registries lead
  legalName: LEGAL_REGISTRY_ORDER,
  companyName: LEGAL_REGISTRY_ORDER,
  legalEntityType: LEGAL_REGISTRY_ORDER,
  registrationNumber: LEGAL_REGISTRY_ORDER,
  registrationType: LEGAL_REGISTRY_ORDER,
  taxVatId: LEGAL_REGISTRY_ORDER,
  lei: LEGAL_REGISTRY_ORDER,
  companyStatus: LEGAL_REGISTRY_ORDER,
  incorporationDate: LEGAL_REGISTRY_ORDER,
  foundedYear: LEGAL_REGISTRY_ORDER,
  registeredAddress: LEGAL_REGISTRY_ORDER,
  address: LEGAL_REGISTRY_ORDER,

  // Company-published brand/web fields -> Official company website leads
  tradingName: WEBSITE_PUBLISHED_ORDER,
  website: WEBSITE_PUBLISHED_ORDER,
  domain: WEBSITE_PUBLISHED_ORDER,
  operatingAddress: WEBSITE_PUBLISHED_ORDER,
  description: WEBSITE_PUBLISHED_ORDER,
  productsServices: WEBSITE_PUBLISHED_ORDER,
  socialLinks: WEBSITE_PUBLISHED_ORDER,
  certifications: WEBSITE_PUBLISHED_ORDER,
  careersUrl: WEBSITE_PUBLISHED_ORDER,
  locationsServed: WEBSITE_PUBLISHED_ORDER,
  tradeActivity: WEBSITE_PUBLISHED_ORDER,

  // Contact verification -> Authorized verification providers lead
  email: CONTACT_VERIFICATION_ORDER,
  emailStatus: CONTACT_VERIFICATION_ORDER,
  phone: CONTACT_VERIFICATION_ORDER,
  phoneNormalized: CONTACT_VERIFICATION_ORDER,

  // Commercial intelligence -> Official registry / Authorized commercial providers
  industry: COMMERCIAL_INTELLIGENCE_ORDER,
  sector: COMMERCIAL_INTELLIGENCE_ORDER,
  category: COMMERCIAL_INTELLIGENCE_ORDER,
  employeeRange: COMMERCIAL_INTELLIGENCE_ORDER,
  revenueRange: COMMERCIAL_INTELLIGENCE_ORDER,
  parentCompany: COMMERCIAL_INTELLIGENCE_ORDER,
  subsidiaries: COMMERCIAL_INTELLIGENCE_ORDER,

  // Person / Decision-Maker attributes
  fullName: PERSON_ROLE_ORDER,
  jobTitle: PERSON_ROLE_ORDER,
  department: PERSON_ROLE_ORDER,
  seniority: PERSON_ROLE_ORDER,
  employmentStatus: PERSON_ROLE_ORDER,
  linkedinUrl: WEBSITE_PUBLISHED_ORDER,
  officialBioUrl: WEBSITE_PUBLISHED_ORDER,
  bioSummary: WEBSITE_PUBLISHED_ORDER,
};

/**
 * Returns numeric authority score (higher = stronger authority) for a given attribute & source class.
 */
export function getAttributeSourcePrecedenceScore(
  attribute: string,
  sourceClass: EnrichmentSourceClass | string | undefined
): number {
  const order = ATTRIBUTE_SOURCE_PRECEDENCE[attribute] || COMMERCIAL_INTELLIGENCE_ORDER;
  const normalized = (sourceClass || 'not_verified') as EnrichmentSourceClass;
  const idx = order.indexOf(normalized);
  if (idx === -1) return 1;
  return (order.length - idx) * 10;
}

export function getPrecedenceRationale(attribute: string): string {
  const order = ATTRIBUTE_SOURCE_PRECEDENCE[attribute];
  if (order === LEGAL_REGISTRY_ORDER) {
    return 'Official government & corporate registries hold highest precedence for statutory and legal status attributes.';
  }
  if (order === WEBSITE_PUBLISHED_ORDER) {
    return 'Official company websites hold highest precedence for company-published brand, domain, products, and profile attributes.';
  }
  if (order === CONTACT_VERIFICATION_ORDER) {
    return 'Authorized contact verification providers and official company websites hold highest precedence for contact channels.';
  }
  if (order === PERSON_ROLE_ORDER) {
    return 'Statutory officer filings, official leadership pages, and authorized B2B providers take precedence for executive roles.';
  }
  return 'Official filings and authorized commercial data providers take precedence over general web directories and AI extraction.';
}

export const FREE_PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.fr',
  'yahoo.de',
  'ymail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.de',
  'web.de',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'tutanota.com',
  'fastmail.com',
]);

export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.org',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'getnada.com',
  'fakeinbox.com',
  'dispostable.com',
  'maildrop.cc',
  'mintemail.com',
  'mohmal.com',
  'burnermail.io',
]);

export const ROLE_BASED_EMAIL_PREFIXES = new Set([
  'info',
  'contact',
  'hello',
  'hi',
  'sales',
  'support',
  'help',
  'admin',
  'office',
  'mail',
  'enquiries',
  'inquiries',
  'enquiry',
  'inquiry',
  'team',
  'billing',
  'accounts',
  'finance',
  'hr',
  'careers',
  'jobs',
  'press',
  'media',
  'legal',
  'compliance',
  'privacy',
  'security',
  'abuse',
  'postmaster',
  'webmaster',
  'hostmaster',
  'noreply',
  'no-reply',
  'donotreply',
  'orders',
  'procurement',
  'purchasing',
  'partners',
  'partnerships',
  'marketing',
  'service',
  'reception',
  'desk',
  'general',
  'investor',
  'investors',
  'ir',
]);

export function evaluateFreshnessState(
  attribute: string,
  lastVerifiedAt?: string,
  nowMs: number = Date.now()
): {
  status: 'fresh' | 'aging' | 'stale' | 'never_verified';
  ageDays: number | null;
  maxAgeDays: number;
  reverificationEligible: boolean;
} {
  const spec = getFreshnessSpec(attribute);
  if (!lastVerifiedAt) {
    return {
      status: 'never_verified',
      ageDays: null,
      maxAgeDays: spec.maxAgeDays,
      reverificationEligible: true,
    };
  }
  const ts = Date.parse(lastVerifiedAt);
  if (Number.isNaN(ts)) {
    return {
      status: 'never_verified',
      ageDays: null,
      maxAgeDays: spec.maxAgeDays,
      reverificationEligible: true,
    };
  }
  const ageDays = Math.max(0, Math.floor((nowMs - ts) / (1000 * 60 * 60 * 24)));
  if (ageDays > spec.maxAgeDays) {
    return {
      status: 'stale',
      ageDays,
      maxAgeDays: spec.maxAgeDays,
      reverificationEligible: true,
    };
  }
  if (ageDays >= spec.warningAgeDays) {
    return {
      status: 'aging',
      ageDays,
      maxAgeDays: spec.maxAgeDays,
      reverificationEligible: true,
    };
  }
  return {
    status: 'fresh',
    ageDays,
    maxAgeDays: spec.maxAgeDays,
    reverificationEligible: false,
  };
}
