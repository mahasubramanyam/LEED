/**
 * Canonical Business Identifier Registry shared between Backend & Frontend
 * Preserves backward compatibility with legacy aliases while normalizing to one canonical type system.
 */

export type CanonicalIdentifierType =
  | 'NO_ORG'
  | 'UK_CRN'
  | 'AU_ABN'
  | 'AU_ACN'
  | 'US_EIN'
  | 'FR_SIREN'
  | 'FR_SIRET'
  | 'DE_HANDELSREGISTER'
  | 'EU_VAT'
  | 'LEI'
  | 'TAX_ID'
  | 'NONPROFIT_REG'
  | 'BUSINESS_LICENSE'
  | 'OTHER'
  | 'DOMAIN'
  | 'PHONE'
  | 'EMAIL';

export interface IdentifierTypeSpec {
  code: CanonicalIdentifierType;
  label: string;
  shortLabel: string;
  countryCode?: string;
  issuingAuthority: string;
  placeholder: string;
  selectableInUi: boolean;
  aliases: string[];
}

export const CANONICAL_IDENTIFIER_TYPES: IdentifierTypeSpec[] = [
  {
    code: 'UK_CRN',
    label: 'UK CRN (Companies House)',
    shortLabel: 'CRN (UK)',
    countryCode: 'GB',
    issuingAuthority: 'UK Companies House',
    placeholder: 'e.g. 01234567 or SC123456',
    selectableInUi: true,
    aliases: ['UK_CRN', 'CRN'],
  },
  {
    code: 'NO_ORG',
    label: 'NO OrgNr (Brønnøysundregistrene)',
    shortLabel: 'OrgNr (NO)',
    countryCode: 'NO',
    issuingAuthority: 'Brønnøysundregistrene (Brreg)',
    placeholder: 'e.g. 974760673',
    selectableInUi: true,
    aliases: ['NO_ORG', 'ORGNR', 'BRREG_ORG', 'NO_ORGNR', 'ORG_NR'],
  },
  {
    code: 'AU_ABN',
    label: 'AU ABN (Australian Business No)',
    shortLabel: 'ABN (AU)',
    countryCode: 'AU',
    issuingAuthority: 'Australian Business Register (ABR)',
    placeholder: 'e.g. 51 824 753 556',
    selectableInUi: true,
    aliases: ['AU_ABN', 'ABN'],
  },
  {
    code: 'AU_ACN',
    label: 'AU ACN (Australian Company No)',
    shortLabel: 'ACN (AU)',
    countryCode: 'AU',
    issuingAuthority: 'Australian Securities & Investments Commission (ASIC)',
    placeholder: 'e.g. 123456789',
    selectableInUi: true,
    aliases: ['AU_ACN', 'ACN'],
  },
  {
    code: 'US_EIN',
    label: 'US EIN (Employer ID)',
    shortLabel: 'EIN (US)',
    countryCode: 'US',
    issuingAuthority: 'Internal Revenue Service (IRS)',
    placeholder: 'e.g. 12-3456789',
    selectableInUi: true,
    aliases: ['US_EIN', 'EIN'],
  },
  {
    code: 'FR_SIREN',
    label: 'FR SIREN (9-digit)',
    shortLabel: 'SIREN (FR)',
    countryCode: 'FR',
    issuingAuthority: 'INSEE',
    placeholder: 'e.g. 732 829 320',
    selectableInUi: true,
    aliases: ['FR_SIREN', 'SIREN'],
  },
  {
    code: 'FR_SIRET',
    label: 'FR SIRET (14-digit)',
    shortLabel: 'SIRET (FR)',
    countryCode: 'FR',
    issuingAuthority: 'INSEE',
    placeholder: 'e.g. 73282932000074',
    selectableInUi: true,
    aliases: ['FR_SIRET', 'SIRET'],
  },
  {
    code: 'DE_HANDELSREGISTER',
    label: 'DE Handelsregister (HRA/HRB)',
    shortLabel: 'Handelsregister (DE)',
    countryCode: 'DE',
    issuingAuthority: 'Amtsgericht / Gemeinsames Registerportal',
    placeholder: 'e.g. HRB 12345',
    selectableInUi: true,
    aliases: ['DE_HANDELSREGISTER', 'HANDELSREGISTER', 'HRA', 'HRB'],
  },
  {
    code: 'EU_VAT',
    label: 'VAT / Tax Identifier',
    shortLabel: 'VAT / Tax ID',
    issuingAuthority: 'European Commission VIES / National Tax Office',
    placeholder: 'e.g. GB123456789 or NO974760673MVA',
    selectableInUi: true,
    aliases: ['EU_VAT', 'VAT'],
  },
  {
    code: 'LEI',
    label: 'LEI (ISO 17442 20-char)',
    shortLabel: 'LEI (Global)',
    issuingAuthority: 'Global Legal Entity Identifier Foundation (GLEIF)',
    placeholder: 'e.g. 5493006MHB84DD0ZWV18',
    selectableInUi: true,
    aliases: ['LEI'],
  },
  {
    code: 'TAX_ID',
    label: 'National Tax ID',
    shortLabel: 'Tax ID',
    issuingAuthority: 'National Tax Authority',
    placeholder: 'National tax identifier',
    selectableInUi: true,
    aliases: ['TAX_ID', 'TIN'],
  },
  {
    code: 'NONPROFIT_REG',
    label: 'Nonprofit / Charity Reg No',
    shortLabel: 'Charity / Nonprofit',
    issuingAuthority: 'Charity Regulator',
    placeholder: 'Charity registration number',
    selectableInUi: true,
    aliases: ['NONPROFIT_REG', 'CHARITY'],
  },
  {
    code: 'BUSINESS_LICENSE',
    label: 'Business License Number',
    shortLabel: 'Business License',
    issuingAuthority: 'Department of Economic Development / Municipality',
    placeholder: 'Municipal or trade license number',
    selectableInUi: true,
    aliases: ['BUSINESS_LICENSE', 'LICENSE'],
  },
  {
    code: 'OTHER',
    label: 'Other Custom Registry',
    shortLabel: 'Other Registry',
    issuingAuthority: 'National Business Register',
    placeholder: 'Custom identifier value',
    selectableInUi: true,
    aliases: ['OTHER', 'REG'],
  },
  {
    code: 'DOMAIN',
    label: 'Verified Domain',
    shortLabel: 'Domain',
    issuingAuthority: 'DNS / Public Web',
    placeholder: 'example.com',
    selectableInUi: false,
    aliases: ['DOMAIN'],
  },
  {
    code: 'PHONE',
    label: 'Telephone',
    shortLabel: 'Phone',
    issuingAuthority: 'E.164 Telecommunications',
    placeholder: '+442079460912',
    selectableInUi: false,
    aliases: ['PHONE'],
  },
  {
    code: 'EMAIL',
    label: 'Email',
    shortLabel: 'Email',
    issuingAuthority: 'SMTP Domain',
    placeholder: 'contact@example.com',
    selectableInUi: false,
    aliases: ['EMAIL'],
  },
];

const ALIAS_TO_CANONICAL = new Map<string, CanonicalIdentifierType>();
const SPEC_BY_CANONICAL = new Map<CanonicalIdentifierType, IdentifierTypeSpec>();

for (const spec of CANONICAL_IDENTIFIER_TYPES) {
  SPEC_BY_CANONICAL.set(spec.code, spec);
  ALIAS_TO_CANONICAL.set(spec.code, spec.code);
  for (const alias of spec.aliases) {
    ALIAS_TO_CANONICAL.set(alias.toUpperCase(), spec.code);
  }
}

/**
 * Resolves any legacy or country-specific identifier type string to its canonical registry code.
 * Preserves unknown custom types uppercased so existing non-standard entries remain readable.
 */
export function canonicalizeIdentifierType(type?: string, countryHint?: string): string {
  const raw = (type || '').toUpperCase().trim();
  if (!raw || raw === 'REG') {
    const c = (countryHint || '').toUpperCase().trim();
    if (c === 'NO') return 'NO_ORG';
    if (c === 'GB' || c === 'UK') return 'UK_CRN';
    if (c === 'AU') return 'AU_ABN';
    if (c === 'DE') return 'DE_HANDELSREGISTER';
    if (c === 'FR') return 'FR_SIREN';
    if (c === 'US') return 'US_EIN';
    return raw || 'TAX_ID';
  }
  return ALIAS_TO_CANONICAL.get(raw) || raw;
}

/**
 * Suggests the default canonical identifier type for a given ISO 3166-1 alpha-2 country code.
 */
export function getDefaultIdentifierTypeForCountry(countryCode?: string): CanonicalIdentifierType {
  const c = (countryCode || '').toUpperCase().trim();
  switch (c) {
    case 'GB':
      return 'UK_CRN';
    case 'NO':
      return 'NO_ORG';
    case 'AU':
      return 'AU_ABN';
    case 'US':
      return 'US_EIN';
    case 'FR':
      return 'FR_SIREN';
    case 'DE':
      return 'DE_HANDELSREGISTER';
    default:
      return 'TAX_ID';
  }
}

export function getIdentifierSpec(type?: string): IdentifierTypeSpec | undefined {
  if (!type) return undefined;
  const canonical = canonicalizeIdentifierType(type) as CanonicalIdentifierType;
  return SPEC_BY_CANONICAL.get(canonical);
}

/**
 * Returns all known aliases (canonical + legacy) for backward-compatible filtering and matching.
 */
export function getIdentifierAliases(type: string): string[] {
  const raw = (type || '').toUpperCase().trim();
  const canonical = canonicalizeIdentifierType(raw) as CanonicalIdentifierType;
  const spec = SPEC_BY_CANONICAL.get(canonical);
  if (!spec) return [raw];
  return Array.from(new Set([spec.code, ...spec.aliases, raw]));
}

export function getUiIdentifierOptions(): IdentifierTypeSpec[] {
  return CANONICAL_IDENTIFIER_TYPES.filter((t) => t.selectableInUi);
}
