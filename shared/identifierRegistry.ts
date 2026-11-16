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
  | 'US_CIK'
  | 'FR_SIREN'
  | 'FR_SIRET'
  | 'DE_HANDELSREGISTER'
  | 'CA_BN'
  | 'CA_CORP'
  | 'JP_CN'
  | 'IN_CIN'
  | 'SG_UEN'
  | 'FI_YTUNNUS'
  | 'PL_KRS'
  | 'PL_NIP'
  | 'NL_KVK'
  | 'NZ_NZBN'
  | 'CH_UID'
  | 'IE_CRO'
  | 'BE_KBO'
  | 'SE_ORG'
  | 'DK_CVR'
  | 'ES_CIF'
  | 'IT_CF'
  | 'KR_BRN'
  | 'AE_TRN'
  | 'SA_CR'
  | 'ZA_CIPC'
  | 'BR_CNPJ'
  | 'MX_RFC'
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
    code: 'US_CIK',
    label: 'US SEC CIK (10-digit Central Index Key)',
    shortLabel: 'SEC CIK (US)',
    countryCode: 'US',
    issuingAuthority: 'U.S. Securities and Exchange Commission (SEC)',
    placeholder: 'e.g. 0000320193',
    selectableInUi: true,
    aliases: ['US_CIK', 'CIK', 'SEC_CIK'],
  },
  {
    code: 'FR_SIREN',
    label: 'FR SIREN (9-digit)',
    shortLabel: 'SIREN (FR)',
    countryCode: 'FR',
    issuingAuthority: 'INSEE / Annuaire des Entreprises',
    placeholder: 'e.g. 732 829 320',
    selectableInUi: true,
    aliases: ['FR_SIREN', 'SIREN'],
  },
  {
    code: 'FR_SIRET',
    label: 'FR SIRET (14-digit)',
    shortLabel: 'SIRET (FR)',
    countryCode: 'FR',
    issuingAuthority: 'INSEE / Annuaire des Entreprises',
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
    code: 'CA_BN',
    label: 'CA Business Number (9-digit CRA BN)',
    shortLabel: 'BN (CA)',
    countryCode: 'CA',
    issuingAuthority: 'Canada Revenue Agency (CRA)',
    placeholder: 'e.g. 123456789',
    selectableInUi: true,
    aliases: ['CA_BN', 'CRA_BN', 'BN'],
  },
  {
    code: 'CA_CORP',
    label: 'CA Federal Corporation No (ISED)',
    shortLabel: 'Corp No (CA)',
    countryCode: 'CA',
    issuingAuthority: 'Corporations Canada (ISED)',
    placeholder: 'e.g. 0421562 or 1234567-8',
    selectableInUi: true,
    aliases: ['CA_CORP', 'CA_CORP_NO', 'CORP_CAN'],
  },
  {
    code: 'JP_CN',
    label: 'JP Corporate Number (Houjin Bangou)',
    shortLabel: 'Corporate No (JP)',
    countryCode: 'JP',
    issuingAuthority: 'National Tax Agency of Japan (NTA)',
    placeholder: 'e.g. 1010001008846',
    selectableInUi: true,
    aliases: ['JP_CN', 'HOUJIN_BANGOU', 'JP_HOUJIN', 'CORPORATE_NUMBER'],
  },
  {
    code: 'IN_CIN',
    label: 'IN CIN (MCA 21-char Corporate ID)',
    shortLabel: 'CIN (IN)',
    countryCode: 'IN',
    issuingAuthority: 'Ministry of Corporate Affairs (MCA)',
    placeholder: 'e.g. L22210MH1995PLC084781',
    selectableInUi: true,
    aliases: ['IN_CIN', 'CIN', 'MCA_CIN'],
  },
  {
    code: 'SG_UEN',
    label: 'SG UEN (ACRA Unique Entity No)',
    shortLabel: 'UEN (SG)',
    countryCode: 'SG',
    issuingAuthority: 'Accounting and Corporate Regulatory Authority (ACRA)',
    placeholder: 'e.g. 201201936C or T08LL1234A',
    selectableInUi: true,
    aliases: ['SG_UEN', 'UEN', 'ACRA_UEN'],
  },
  {
    code: 'FI_YTUNNUS',
    label: 'FI Y-tunnus (Finnish Business ID)',
    shortLabel: 'Y-tunnus (FI)',
    countryCode: 'FI',
    issuingAuthority: 'Finnish Patent and Registration Office (PRH)',
    placeholder: 'e.g. 0112038-9',
    selectableInUi: true,
    aliases: ['FI_YTUNNUS', 'YTUNNUS', 'Y_TUNNUS', 'FI_BUSINESS_ID'],
  },
  {
    code: 'PL_KRS',
    label: 'PL KRS (National Court Register)',
    shortLabel: 'KRS (PL)',
    countryCode: 'PL',
    issuingAuthority: 'Ministry of Justice Poland (KRS)',
    placeholder: 'e.g. 0000028860',
    selectableInUi: true,
    aliases: ['PL_KRS', 'KRS'],
  },
  {
    code: 'PL_NIP',
    label: 'PL NIP (Tax Identification No)',
    shortLabel: 'NIP (PL)',
    countryCode: 'PL',
    issuingAuthority: 'Ministry of Finance Poland (KAS / VAT White List)',
    placeholder: 'e.g. 5260250995',
    selectableInUi: true,
    aliases: ['PL_NIP', 'NIP'],
  },
  {
    code: 'NL_KVK',
    label: 'NL KVK-nummer (8-digit Chamber of Commerce)',
    shortLabel: 'KVK (NL)',
    countryCode: 'NL',
    issuingAuthority: 'Kamer van Koophandel (KVK)',
    placeholder: 'e.g. 34108286',
    selectableInUi: true,
    aliases: ['NL_KVK', 'KVK', 'KVK_NUMMER'],
  },
  {
    code: 'NZ_NZBN',
    label: 'NZ NZBN (13-digit Business Number)',
    shortLabel: 'NZBN (NZ)',
    countryCode: 'NZ',
    issuingAuthority: 'New Zealand Companies Office / MBIE',
    placeholder: 'e.g. 9429041935243',
    selectableInUi: true,
    aliases: ['NZ_NZBN', 'NZBN'],
  },
  {
    code: 'CH_UID',
    label: 'CH UID (Swiss Enterprise ID CHE-xxx)',
    shortLabel: 'UID (CH)',
    countryCode: 'CH',
    issuingAuthority: 'Federal Statistical Office / Zefix',
    placeholder: 'e.g. CHE-105.815.320',
    selectableInUi: true,
    aliases: ['CH_UID', 'ZEFIX', 'ZEFIX_UID', 'UID_CHE', 'CHE'],
  },
  {
    code: 'IE_CRO',
    label: 'IE CRO (Irish Companies Registration No)',
    shortLabel: 'CRO (IE)',
    countryCode: 'IE',
    issuingAuthority: 'Companies Registration Office (CRO)',
    placeholder: 'e.g. 363390',
    selectableInUi: true,
    aliases: ['IE_CRO', 'CRO'],
  },
  {
    code: 'BE_KBO',
    label: 'BE KBO/BCE (10-digit Enterprise No)',
    shortLabel: 'KBO/BCE (BE)',
    countryCode: 'BE',
    issuingAuthority: 'Crossroads Bank for Enterprises (FPS Economy)',
    placeholder: 'e.g. 0403.170.701',
    selectableInUi: true,
    aliases: ['BE_KBO', 'BE_BCE', 'KBO', 'BCE'],
  },
  {
    code: 'SE_ORG',
    label: 'SE Organisationsnummer (10-digit)',
    shortLabel: 'OrgNr (SE)',
    countryCode: 'SE',
    issuingAuthority: 'Bolagsverket / Skatteverket',
    placeholder: 'e.g. 556000-0757',
    selectableInUi: true,
    aliases: ['SE_ORG', 'SE_ORGNR', 'ORGNR_SE'],
  },
  {
    code: 'DK_CVR',
    label: 'DK CVR-nummer (8-digit)',
    shortLabel: 'CVR (DK)',
    countryCode: 'DK',
    issuingAuthority: 'Danish Business Authority (Erhvervsstyrelsen)',
    placeholder: 'e.g. 10150817',
    selectableInUi: true,
    aliases: ['DK_CVR', 'CVR'],
  },
  {
    code: 'ES_CIF',
    label: 'ES NIF/CIF (Tax & Registry ID)',
    shortLabel: 'NIF/CIF (ES)',
    countryCode: 'ES',
    issuingAuthority: 'Agencia Tributaria / Registro Mercantil',
    placeholder: 'e.g. A28015865',
    selectableInUi: true,
    aliases: ['ES_CIF', 'ES_NIF', 'CIF'],
  },
  {
    code: 'IT_CF',
    label: 'IT Codice Fiscale / REA',
    shortLabel: 'CF/PIVA (IT)',
    countryCode: 'IT',
    issuingAuthority: 'Registro Imprese / Agenzia delle Entrate',
    placeholder: 'e.g. 00159560366',
    selectableInUi: true,
    aliases: ['IT_CF', 'IT_PIVA', 'CODICE_FISCALE'],
  },
  {
    code: 'KR_BRN',
    label: 'KR BRN (10-digit Business Reg No)',
    shortLabel: 'BRN (KR)',
    countryCode: 'KR',
    issuingAuthority: 'National Tax Service of Korea (NTS)',
    placeholder: 'e.g. 120-81-47521',
    selectableInUi: true,
    aliases: ['KR_BRN', 'KR_BNO'],
  },
  {
    code: 'AE_TRN',
    label: 'AE TRN / Commercial License',
    shortLabel: 'TRN (AE)',
    countryCode: 'AE',
    issuingAuthority: 'UAE Federal Tax Authority / DED',
    placeholder: 'e.g. 100234567890003',
    selectableInUi: true,
    aliases: ['AE_TRN', 'UAE_TRN'],
  },
  {
    code: 'SA_CR',
    label: 'SA Commercial Registration (10-digit)',
    shortLabel: 'CR (SA)',
    countryCode: 'SA',
    issuingAuthority: 'Saudi Ministry of Commerce (MC / Wathq)',
    placeholder: 'e.g. 1010000154',
    selectableInUi: true,
    aliases: ['SA_CR', 'CR_SA'],
  },
  {
    code: 'ZA_CIPC',
    label: 'ZA CIPC Registration No',
    shortLabel: 'CIPC (ZA)',
    countryCode: 'ZA',
    issuingAuthority: 'Companies & Intellectual Property Commission (CIPC)',
    placeholder: 'e.g. 2015/123456/07',
    selectableInUi: true,
    aliases: ['ZA_CIPC', 'CIPC'],
  },
  {
    code: 'BR_CNPJ',
    label: 'BR CNPJ (14-digit Entity ID)',
    shortLabel: 'CNPJ (BR)',
    countryCode: 'BR',
    issuingAuthority: 'Receita Federal do Brasil',
    placeholder: 'e.g. 00.000.000/0001-91',
    selectableInUi: true,
    aliases: ['BR_CNPJ', 'CNPJ'],
  },
  {
    code: 'MX_RFC',
    label: 'MX RFC (Taxpayer Registry ID)',
    shortLabel: 'RFC (MX)',
    countryCode: 'MX',
    issuingAuthority: 'Servicio de Administración Tributaria (SAT)',
    placeholder: 'e.g. BIM011108DJ1',
    selectableInUi: true,
    aliases: ['MX_RFC', 'RFC'],
  },
  {
    code: 'EU_VAT',
    label: 'VAT / Tax Identifier',
    shortLabel: 'VAT / Tax ID',
    issuingAuthority: 'European Commission VIES / National Tax Office',
    placeholder: 'e.g. GB123456789 or NO974760673MVA',
    selectableInUi: true,
    aliases: ['EU_VAT', 'VAT', 'VIES', 'EU_VIES'],
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
    return getDefaultIdentifierTypeForCountry(c) || raw || 'TAX_ID';
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
    case 'UK':
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
    case 'CA':
      return 'CA_BN';
    case 'JP':
      return 'JP_CN';
    case 'IN':
      return 'IN_CIN';
    case 'SG':
      return 'SG_UEN';
    case 'FI':
      return 'FI_YTUNNUS';
    case 'PL':
      return 'PL_KRS';
    case 'NL':
      return 'NL_KVK';
    case 'NZ':
      return 'NZ_NZBN';
    case 'CH':
      return 'CH_UID';
    case 'IE':
      return 'IE_CRO';
    case 'BE':
      return 'BE_KBO';
    case 'SE':
      return 'SE_ORG';
    case 'DK':
      return 'DK_CVR';
    case 'ES':
      return 'ES_CIF';
    case 'IT':
      return 'IT_CF';
    case 'KR':
      return 'KR_BRN';
    case 'AE':
      return 'AE_TRN';
    case 'SA':
      return 'SA_CR';
    case 'ZA':
      return 'ZA_CIPC';
    case 'BR':
      return 'BR_CNPJ';
    case 'MX':
      return 'MX_RFC';
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
