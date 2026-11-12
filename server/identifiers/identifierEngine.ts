export interface BusinessIdentifierRecord {
  id?: string;
  type: string;
  countryCode?: string;
  value: string;
  normalizedValue: string;
  issuingAuthority: string;
  source: string;
  status: 'user_provided' | 'discovered' | 'syntax_validated' | 'officially_verified';
  verified: boolean;
  notes?: string;
}

export interface IdentifierValidationResult {
  valid: boolean;
  type: string;
  value: string;
  normalizedValue: string;
  countryCode: string;
  issuingAuthority: string;
  status: 'user_provided' | 'discovered' | 'syntax_validated' | 'officially_verified';
  error?: string;
}

/**
 * Normalizes any business identifier to an uppercase alphanumeric comparison string
 * without altering or losing the original formatting.
 */
export function normalizeIdentifierValue(value: string): string {
  if (!value) return '';
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Modulo-11 checksum for Norwegian Organization Numbers (Brreg OrgNr)
 * Exactly 9 digits. Weights: [3, 2, 7, 6, 5, 4, 3, 2]
 */
export function validateNorwegianOrgNr(value: string): boolean {
  const clean = value.replace(/[^0-9]/g, '');
  if (clean.length !== 9) return false;

  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(clean[i], 10) * weights[i];
  }

  const remainder = sum % 11;
  const controlDigit = remainder === 0 ? 0 : 11 - remainder;
  if (controlDigit === 10) return false;

  return controlDigit === parseInt(clean[8], 10);
}

/**
 * Modulo-89 checksum for Australian Business Numbers (ABN)
 * Exactly 11 digits. Subtract 1 from first digit, multiply by weights [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19].
 */
export function validateAustralianAbn(value: string): boolean {
  const clean = value.replace(/[^0-9]/g, '');
  if (clean.length !== 11) return false;

  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  let sum = (parseInt(clean[0], 10) - 1) * weights[0];

  for (let i = 1; i < 11; i++) {
    sum += parseInt(clean[i], 10) * weights[i];
  }

  return sum % 89 === 0;
}

/**
 * Luhn checksum algorithm for French SIREN (9 digits) and SIRET (14 digits)
 */
export function validateLuhn(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n = (n % 10) + 1;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * ISO 17442 Legal Entity Identifier (LEI) Checksum (ISO 7064 Modulo 97-10)
 * 20 alphanumeric characters:
 * - 4 chars: LOU identifier
 * - 14 chars: Entity identifier
 * - 2 digits: Check digits
 */
export function validateLei(value: string): boolean {
  const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 20) return false;

  // Convert letters to digits: A=10, B=11 ... Z=35
  let numericStr = '';
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      numericStr += (code - 55).toString();
    } else {
      numericStr += clean[i];
    }
  }

  // Large integer modulo 97 check
  let remainder = 0;
  for (let i = 0; i < numericStr.length; i++) {
    remainder = (remainder * 10 + parseInt(numericStr[i], 10)) % 97;
  }

  return remainder === 1;
}

/**
 * Comprehensive business identifier validation and provenance tagging
 */
export function validateIdentifier(
  type: string,
  value: string,
  countryHint = 'US',
  existingStatus?: 'user_provided' | 'discovered' | 'syntax_validated' | 'officially_verified'
): IdentifierValidationResult {
  const normType = (type || 'TAX_ID').toUpperCase().trim();
  const rawValue = (value || '').trim();
  const normalized = normalizeIdentifierValue(rawValue);

  let valid = false;
  let error: string | undefined;
  let countryCode = countryHint.toUpperCase();
  let issuingAuthority = 'National Commercial Authority';

  switch (normType) {
    case 'UK_CRN':
    case 'CRN': {
      countryCode = 'GB';
      issuingAuthority = 'UK Companies House';
      // 8 characters: 8 digits, or 2 letters (SC, NI, OC, SO, LP) followed by 6 digits
      const crnPattern = /^([A-Z]{2}[0-9]{6}|[0-9]{8})$/i;
      valid = crnPattern.test(normalized);
      if (!valid) error = 'UK CRN must be 8 digits or 2 letters followed by 6 digits (e.g. 01234567, SC123456)';
      break;
    }

    case 'NO_ORG':
    case 'BRREG_ORG': {
      countryCode = 'NO';
      issuingAuthority = 'Brønnøysundregistrene (Brreg)';
      valid = validateNorwegianOrgNr(normalized);
      if (!valid) error = 'Norwegian Organisasjonsnummer must be 9 digits with valid Modulo-11 checksum';
      break;
    }

    case 'AU_ABN':
    case 'ABN': {
      countryCode = 'AU';
      issuingAuthority = 'Australian Business Register (ABR)';
      valid = validateAustralianAbn(normalized);
      if (!valid) error = 'Australian Business Number (ABN) must be 11 digits with valid Modulo-89 checksum';
      break;
    }

    case 'AU_ACN':
    case 'ACN': {
      countryCode = 'AU';
      issuingAuthority = 'Australian Securities & Investments Commission (ASIC)';
      valid = /^[0-9]{9}$/.test(normalized);
      if (!valid) error = 'Australian Company Number (ACN) must be exactly 9 digits';
      break;
    }

    case 'US_EIN':
    case 'EIN': {
      countryCode = 'US';
      issuingAuthority = 'Internal Revenue Service (IRS)';
      // 9 digits, often written XX-XXXXXXX
      valid = /^[0-9]{9}$/.test(normalized);
      if (!valid) error = 'US EIN must be 9 digits (format: XX-XXXXXXX)';
      break;
    }

    case 'FR_SIREN':
    case 'SIREN': {
      countryCode = 'FR';
      issuingAuthority = 'Institut National de la Statistique et des Études Économiques (INSEE)';
      valid = /^[0-9]{9}$/.test(normalized) && validateLuhn(normalized);
      if (!valid) error = 'French SIREN must be 9 digits with valid Luhn checksum';
      break;
    }

    case 'FR_SIRET':
    case 'SIRET': {
      countryCode = 'FR';
      issuingAuthority = 'INSEE';
      valid = /^[0-9]{14}$/.test(normalized) && validateLuhn(normalized);
      if (!valid) error = 'French SIRET must be 14 digits with valid Luhn checksum';
      break;
    }

    case 'LEI': {
      issuingAuthority = 'Global Legal Entity Identifier Foundation (GLEIF)';
      valid = validateLei(normalized);
      if (!valid) error = 'LEI must be 20 alphanumeric characters adhering to ISO 17442 (Modulo 97-10)';
      break;
    }

    case 'EU_VAT':
    case 'VAT': {
      issuingAuthority = 'European Commission VIES / National Tax Office';
      // Starts with 2-letter country code followed by 8-12 alphanumeric characters
      const vatPattern = /^[A-Z]{2}[A-Z0-9]{8,12}$/;
      valid = vatPattern.test(normalized);
      if (valid) {
        countryCode = normalized.slice(0, 2);
      } else {
        error = 'VAT identifier must begin with 2-letter country code followed by 8-12 characters';
      }
      break;
    }

    case 'DE_HANDELSREGISTER': {
      countryCode = 'DE';
      issuingAuthority = 'Amtsgericht / Gemeinsames Registerportal';
      valid = normalized.length >= 4 && /HR[AB]/i.test(rawValue);
      if (!valid) error = 'German Handelsregisternummer must specify HRA/HRB and court registration';
      break;
    }

    case 'NONPROFIT_REG': {
      issuingAuthority = countryCode === 'GB' ? 'Charity Commission' : countryCode === 'US' ? 'IRS 501(c)(3)' : 'Charity Regulator';
      valid = normalized.length >= 4;
      break;
    }

    case 'BUSINESS_LICENSE': {
      issuingAuthority = 'Department of Economic Development / Municipality';
      valid = normalized.length >= 3;
      break;
    }

    default: {
      // General Tax ID / Registration number
      valid = normalized.length >= 3;
      issuingAuthority = 'National Business Register';
      break;
    }
  }

  // Determine status:
  // If already officially verified by a registry API connector, preserve it.
  // Otherwise, if valid, it is syntax_validated. If not, remains user_provided.
  let status: 'user_provided' | 'discovered' | 'syntax_validated' | 'officially_verified' =
    existingStatus === 'officially_verified'
      ? 'officially_verified'
      : existingStatus === 'discovered'
      ? 'discovered'
      : valid
      ? 'syntax_validated'
      : 'user_provided';

  return {
    valid,
    type: normType,
    value: rawValue,
    normalizedValue: normalized,
    countryCode,
    issuingAuthority,
    status,
    error,
  };
}
