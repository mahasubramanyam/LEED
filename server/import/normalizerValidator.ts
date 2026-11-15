import { getCountryByCode, getAllCountries } from '../geo/countries.js';
import type { CountryReference } from '../geo/types.js';
import { normalizePhoneNumber } from '../geo/phoneUtils.js';
import { formatInternationalAddress, validatePostalCode } from '../geo/addressUtils.js';
import {
  normalizeIdentifierValue,
  validateIdentifier,
} from '../identifiers/identifierEngine.js';
import {
  canonicalizeIdentifierType,
  getDefaultIdentifierTypeForCountry,
} from '../../shared/identifierRegistry.js';
import { normalizeLegalCompanyStatus } from '../connectors/core/normalizer.js';
import {
  ImportNormalizationOptions,
  ImportValidationIssue,
  LeadIdentifier,
  NormalizedImportCompany,
  NormalizedImportPerson,
} from '../types.js';

const ISO_CURRENCY_CODES = new Set([
  'USD', 'EUR', 'GBP', 'NOK', 'SEK', 'DKK', 'CHF', 'AUD', 'CAD', 'JPY', 'INR', 'SGD',
  'AED', 'CNY', 'HKD', 'NZD', 'ZAR', 'BRL', 'MXN', 'PLN', 'CZK', 'HUF', 'RON', 'TRY',
  'ILS', 'KRW', 'TWD', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'SAR', 'QAR', 'KWD', 'BHD',
]);

const SYMBOL_TO_CURRENCY: Record<string, string> = {
  '€': 'EUR',
  '£': 'GBP',
  '$': 'USD',
  '¥': 'JPY',
  '₹': 'INR',
  'CHF': 'CHF',
  'A$': 'AUD',
  'AU$': 'AUD',
  'C$': 'CAD',
  'CA$': 'CAD',
  'S$': 'SGD',
  'SG$': 'SGD',
};

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

let countryLookupCache: CountryReference[] | null = null;
function getCountriesCached(): CountryReference[] {
  if (!countryLookupCache) {
    countryLookupCache = getAllCountries();
  }
  return countryLookupCache;
}

export function resolveCountryReference(
  rawCountry?: string,
  rawCode?: string,
  fallbackCode = 'US'
): { countryRef?: CountryReference; matched: boolean; countryCode: string; countryName: string } {
  const list = getCountriesCached();
  const cleanCode = (rawCode || '').trim().toUpperCase();
  const cleanCountry = (rawCountry || '').trim();

  if (cleanCode) {
    const byAlpha2 = getCountryByCode(cleanCode);
    if (byAlpha2) {
      return {
        countryRef: byAlpha2,
        matched: true,
        countryCode: byAlpha2.code,
        countryName: byAlpha2.name,
      };
    }
    const byAlpha3 = list.find((c) => c.alpha3.toUpperCase() === cleanCode);
    if (byAlpha3) {
      return {
        countryRef: byAlpha3,
        matched: true,
        countryCode: byAlpha3.code,
        countryName: byAlpha3.name,
      };
    }
  }

  if (cleanCountry) {
    const upper = cleanCountry.toUpperCase();
    const lower = cleanCountry.toLowerCase();
    const found =
      getCountryByCode(upper) ||
      list.find(
        (c) =>
          c.alpha3.toUpperCase() === upper ||
          c.name.toLowerCase() === lower ||
          c.officialName.toLowerCase() === lower ||
          (c.nativeName && c.nativeName.toLowerCase() === lower)
      );
    if (found) {
      return {
        countryRef: found,
        matched: true,
        countryCode: found.code,
        countryName: found.name,
      };
    }
  }

  // Fallback safely
  const fb = getCountryByCode(fallbackCode) || getCountryByCode('US');
  return {
    countryRef: fb,
    matched: false,
    countryCode: fb?.code || 'US',
    countryName: cleanCountry || fb?.name || 'International',
  };
}

/**
 * Parses locale-formatted numbers (e.g. "1,250,000.50", "1.250.000,50", "€2.5M", "450k")
 * while detecting embedded ISO 4217 currency clues without performing any exchange conversion.
 */
export function parseLocaleNumericAmount(
  raw: string | undefined,
  localeHint: ImportNormalizationOptions['numberLocale'] = 'en-US'
): { valid: boolean; value?: number; detectedCurrency?: string } {
  if (!raw || !raw.trim()) return { valid: false };
  let working = raw.trim();

  let detectedCurrency: string | undefined;
  const isoPrefix = working.match(/\b([A-Z]{3})\b/);
  if (isoPrefix && ISO_CURRENCY_CODES.has(isoPrefix[1])) {
    detectedCurrency = isoPrefix[1];
  } else {
    for (const [sym, cur] of Object.entries(SYMBOL_TO_CURRENCY)) {
      if (working.includes(sym)) {
        detectedCurrency = cur;
        break;
      }
    }
  }

  // Detect magnitude suffix (K, M, B)
  let multiplier = 1;
  const suffixMatch = working.match(/([kmb])\s*$/i);
  if (suffixMatch) {
    const s = suffixMatch[1].toUpperCase();
    if (s === 'K') multiplier = 1_000;
    else if (s === 'M') multiplier = 1_000_000;
    else if (s === 'B') multiplier = 1_000_000_000;
    working = working.slice(0, suffixMatch.index).trim();
  }

  // Strip currency symbols, spaces, NBSP
  let numStr = working.replace(/[^0-9.,-]/g, '');
  if (!numStr || numStr === '-' || numStr === '.' || numStr === ',') {
    return { valid: false, detectedCurrency };
  }

  const lastComma = numStr.lastIndexOf(',');
  const lastDot = numStr.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      // European format: 1.234.567,89
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      // US/UK format: 1,234,567.89
      numStr = numStr.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const afterComma = numStr.length - lastComma - 1;
    if ((localeHint === 'de-DE' || localeHint === 'fr-FR') && afterComma !== 3) {
      numStr = numStr.replace(',', '.');
    } else if (afterComma === 1 || afterComma === 2) {
      numStr = numStr.replace(',', '.');
    } else {
      numStr = numStr.replace(/,/g, '');
    }
  } else if (lastDot >= 0) {
    const dotCount = (numStr.match(/\./g) || []).length;
    const afterDot = numStr.length - lastDot - 1;
    if (dotCount > 1 || ((localeHint === 'de-DE' || localeHint === 'fr-FR') && afterDot === 3)) {
      numStr = numStr.replace(/\./g, '');
    }
  }

  const parsed = Number(numStr);
  if (!Number.isFinite(parsed)) {
    return { valid: false, detectedCurrency };
  }
  return { valid: true, value: parsed * multiplier, detectedCurrency };
}

export function parseLocaleDateToIso(
  raw: string | undefined,
  dateLocale: ImportNormalizationOptions['dateLocale'] = 'ISO'
): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const s = raw.trim();
  // Pure ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
  }
  // Slash or dot separated DD/MM/YYYY or MM/DD/YYYY
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const p1 = parseInt(m[1], 10);
    const p2 = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    let day = p1;
    let month = p2;
    if (dateLocale === 'US' || (p2 > 12 && p1 <= 12)) {
      month = p1;
      day = p2;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? undefined : fallback.toISOString().slice(0, 10);
}

export function normalizeWebsiteAndDomain(rawWebsite?: string, rawDomain?: string): {
  website?: string;
  domain?: string;
  valid: boolean;
  error?: string;
} {
  const candidate = (rawWebsite || rawDomain || '').trim();
  if (!candidate) return { valid: true };

  // Block dangerous URI schemes cleanly
  if (/^(javascript|data|vbscript|file):/i.test(candidate)) {
    return { valid: false, error: `Unsafe URL scheme rejected: "${candidate}"` };
  }

  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const parsed = new URL(withScheme);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!hostname.includes('.') || hostname.length < 3 || /\s/.test(hostname)) {
      return { valid: false, error: `Malformed website domain "${candidate}"` };
    }
    const cleanDomain = rawDomain
      ? rawDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
      : hostname;
    return {
      website: rawWebsite ? parsed.toString() : `https://${cleanDomain}`,
      domain: cleanDomain,
      valid: true,
    };
  } catch {
    return { valid: false, error: `Malformed website URL "${candidate}"` };
  }
}

export function normalizeEmailField(raw?: string): {
  email?: string;
  status: 'syntax_valid' | 'unverified' | 'unavailable';
  valid: boolean;
} {
  if (!raw || !raw.trim()) {
    return { status: 'unavailable', valid: true };
  }
  const cleaned = raw.trim().toLowerCase();
  if (EMAIL_REGEX.test(cleaned)) {
    return { email: cleaned, status: 'syntax_valid', valid: true };
  }
  return { email: raw.trim(), status: 'unverified', valid: false };
}

export function normalizeLinkedInUrl(
  raw: string | undefined,
  expectedKind: 'company' | 'person'
): { url?: string; slug?: string; valid: boolean; warning?: string } {
  if (!raw || !raw.trim()) return { valid: true };
  const candidate = raw.trim();
  if (/^(javascript|data|vbscript):/i.test(candidate)) {
    return { valid: false, warning: `Rejected unsafe LinkedIn URL "${candidate}"` };
  }
  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.toLowerCase().includes('linkedin.com')) {
      return { url: withScheme, valid: false, warning: `URL "${candidate}" does not point to linkedin.com` };
    }
    const pathParts = u.pathname.split('/').filter(Boolean);
    if (expectedKind === 'person' && pathParts[0] === 'in' && pathParts[1]) {
      const slug = pathParts[1].toLowerCase();
      return { url: `https://www.linkedin.com/in/${slug}`, slug, valid: true };
    }
    if (expectedKind === 'company' && (pathParts[0] === 'company' || pathParts[0] === 'school') && pathParts[1]) {
      const slug = pathParts[1].toLowerCase();
      return { url: `https://www.linkedin.com/${pathParts[0]}/${slug}`, slug, valid: true };
    }
    return {
      url: u.toString(),
      slug: pathParts[1]?.toLowerCase(),
      valid: true,
      warning: `LinkedIn URL path "${u.pathname}" did not match standard /${expectedKind === 'person' ? 'in' : 'company'}/ format`,
    };
  } catch {
    return { valid: false, warning: `Malformed LinkedIn URL "${candidate}"` };
  }
}

export function normalizeRelationshipType(rawRel?: string, rawJobTitle?: string, rawRole?: string): string {
  const combined = `${rawRel || ''} ${rawRole || ''}`.trim().toLowerCase();
  if (!combined) {
    // Only classify explicit role keywords from job title into standard relationship types if user supplied relationshipType/role;
    // never invent titles or board links if absent
    const jt = (rawJobTitle || '').toLowerCase();
    if (!jt) return 'contact';
    if (/\b(co-?founder|founder)\b/.test(jt)) return 'founder';
    if (/\bdirector\b/.test(jt)) return 'director';
    if (/\b(owner|proprietor)\b/.test(jt)) return 'owner';
    if (/\b(procurement|purchasing|buyer)\b/.test(jt)) return 'procurement_contact';
    if (/\b(ceo|cfo|cto|coo|cmo|chief|president|vp|vice president)\b/.test(jt)) return 'executive';
    return 'contact';
  }
  if (/founder/.test(combined)) return 'founder';
  if (/owner|proprietor|shareholder/.test(combined)) return 'owner';
  if (/director|board/.test(combined)) return 'director';
  if (/officer/.test(combined)) return 'officer';
  if (/exec|ceo|cfo|cto|coo|vp|chief/.test(combined)) return 'executive';
  if (/procure|purchas|buyer|vendor/.test(combined)) return 'procurement_contact';
  if (/sales|account|bizdev|bd/.test(combined)) return 'sales_contact';
  if (/advis|counsel/.test(combined)) return 'advisor';
  if (/employ|staff|engineer|manager/.test(combined)) return 'employee';
  return combined.replace(/[^a-z0-9_]+/g, '_').slice(0, 40) || 'contact';
}

export function normalizePersonNameTokens(fullName: string): string {
  return fullName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseEmployeeCountRange(rawCount?: string, rawRange?: string): { range?: string; count?: number } {
  if (rawRange && rawRange.trim()) {
    return { range: rawRange.trim() };
  }
  if (!rawCount || !rawCount.trim()) return {};
  const digits = parseInt(rawCount.replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(digits) || digits <= 0) return { range: rawCount.trim() };
  if (digits <= 10) return { count: digits, range: '1-10' };
  if (digits <= 50) return { count: digits, range: '11-50' };
  if (digits <= 200) return { count: digits, range: '51-200' };
  if (digits <= 500) return { count: digits, range: '201-500' };
  if (digits <= 1000) return { count: digits, range: '501-1000' };
  return { count: digits, range: '1000+' };
}

function parseBooleanFlag(raw?: string): boolean {
  if (!raw) return false;
  const s = raw.trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'primary';
}

export function normalizeAndValidateMappedRow(input: {
  rowNumber: number;
  fields: Record<string, string>;
  customFields: Record<string, string>;
  options: ImportNormalizationOptions;
}): {
  importKind: 'company_only' | 'person_only' | 'company_and_person' | 'empty';
  company?: NormalizedImportCompany;
  person?: NormalizedImportPerson;
  errors: ImportValidationIssue[];
  warnings: ImportValidationIssue[];
  valid: boolean;
} {
  const { fields, customFields, options } = input;
  const errors: ImportValidationIssue[] = [];
  const warnings: ImportValidationIssue[] = [];

  const hasAnyCompanyField = Boolean(
    fields.companyName ||
      fields.legalName ||
      fields.tradingName ||
      fields.website ||
      fields.domain ||
      fields.registrationNumber ||
      fields.vatNumber ||
      fields.leiNumber
  );

  const composedFullName =
    fields.personFullName?.trim() ||
    [fields.personFirstName?.trim(), fields.personLastName?.trim()].filter(Boolean).join(' ').trim();

  const hasAnyPersonField = Boolean(
    composedFullName ||
      fields.personFirstName ||
      fields.personLastName ||
      fields.personEmail ||
      fields.personPhone ||
      fields.personLinkedInUrl ||
      fields.personJobTitle ||
      fields.personDesignation ||
      fields.personRole ||
      fields.relationshipType ||
      fields.associatedCompanyName ||
      fields.associatedCompanyRegNumber
  );

  if (!hasAnyCompanyField && !hasAnyPersonField && Object.keys(customFields).length === 0) {
    return {
      importKind: 'empty',
      errors: [{ field: 'row', code: 'EMPTY_ROW', message: 'Row contains no mapped business or contact fields.', severity: 'error' }],
      warnings: [],
      valid: false,
    };
  }

  // Country & currency resolution
  const defaultCountry = options.defaultCountryCode || 'US';
  const countryResolved = resolveCountryReference(
    fields.country || fields.personCountry,
    fields.countryCode,
    defaultCountry
  );
  if ((fields.country || fields.countryCode) && !countryResolved.matched) {
    warnings.push({
      field: 'country',
      code: 'UNRECOGNIZED_COUNTRY',
      message: `Country "${fields.countryCode || fields.country}" did not match ISO-3166; defaulted safely to ${countryResolved.countryCode}.`,
      severity: 'warning',
      rawValue: fields.countryCode || fields.country,
    });
  }
  const countryCode = countryResolved.countryCode;
  const countryName = countryResolved.countryName;

  // Determine importKind carefully
  const isPersonOnly =
    hasAnyPersonField &&
    !fields.companyName &&
    !fields.legalName &&
    !fields.tradingName &&
    !fields.website &&
    !fields.domain &&
    !fields.registrationNumber;

  let importKind: 'company_only' | 'person_only' | 'company_and_person' = 'company_only';
  if (isPersonOnly) {
    importKind = 'person_only';
  } else if (hasAnyCompanyField && hasAnyPersonField) {
    importKind = 'company_and_person';
  }

  let company: NormalizedImportCompany | undefined;
  let person: NormalizedImportPerson | undefined;

  // ==========================================
  // NORMALIZE COMPANY WHEN APPLICABLE
  // ==========================================
  if (importKind === 'company_only' || importKind === 'company_and_person') {
    const companyName = (fields.companyName || fields.legalName || fields.tradingName || '').trim();
    if (!companyName) {
      errors.push({
        field: 'companyName',
        code: 'MISSING_COMPANY_NAME',
        message: 'Company Name (or Legal/Trading Name) is required for company rows.',
        severity: 'error',
      });
    }

    // Website & domain (NO auto-crawl!)
    const webRes = normalizeWebsiteAndDomain(fields.website, fields.domain);
    if (!webRes.valid && webRes.error) {
      warnings.push({
        field: 'website',
        code: 'INVALID_WEBSITE',
        message: webRes.error,
        severity: 'warning',
        rawValue: fields.website || fields.domain,
      });
    }

    // Business email
    const emailRes = normalizeEmailField(fields.email);
    if (!emailRes.valid) {
      warnings.push({
        field: 'email',
        code: 'INVALID_EMAIL_SYNTAX',
        message: `Business email "${fields.email}" failed RFC syntax check; kept as unverified raw value.`,
        severity: 'warning',
        rawValue: fields.email,
      });
    }

    // Phone normalization
    const rawPhone = fields.phone?.trim() || undefined;
    let phoneNormalized: string | undefined;
    if (rawPhone) {
      const pRes = normalizePhoneNumber(rawPhone, countryCode);
      if (pRes.valid && pRes.e164) {
        phoneNormalized = pRes.e164;
      } else {
        warnings.push({
          field: 'phone',
          code: 'PHONE_NOT_E164_VALIDATED',
          message: pRes.error || `Telephone "${rawPhone}" could not be validated to E.164 for ${countryCode}; raw phone preserved.`,
          severity: 'warning',
          rawValue: rawPhone,
        });
      }
    }

    // Address & Postal validation
    const street = fields.street?.trim() || undefined;
    const city = fields.city?.trim() || undefined;
    const region = fields.region?.trim() || undefined;
    const postalCode = fields.postalCode?.trim() || undefined;
    const formattedAddress =
      formatInternationalAddress({
        street,
        city,
        region,
        postalCode,
        country: countryName,
        countryCode,
      }) || undefined;

    if (postalCode) {
      const postalCheck = validatePostalCode(postalCode, countryCode);
      if (!postalCheck.valid && postalCheck.message) {
        warnings.push({
          field: 'postalCode',
          code: 'POSTAL_FORMAT_WARNING',
          message: postalCheck.message,
          severity: 'warning',
          rawValue: postalCode,
        });
      }
    }

    // Currency & Numbers (NEVER perform unrequested currency conversion)
    const revParsed = parseLocaleNumericAmount(fields.annualRevenue, options.numberLocale);
    const oppParsed = parseLocaleNumericAmount(fields.opportunityValue, options.numberLocale);
    let currency = (fields.currency || '').trim().toUpperCase();
    if (currency && !ISO_CURRENCY_CODES.has(currency)) {
      warnings.push({
        field: 'currency',
        code: 'UNRECOGNIZED_CURRENCY',
        message: `Unrecognized currency code "${fields.currency}"; preserving raw code without FX conversion.`,
        severity: 'warning',
        rawValue: fields.currency,
      });
    }
    if (!currency) {
      currency =
        oppParsed.detectedCurrency ||
        revParsed.detectedCurrency ||
        countryResolved.countryRef?.currency ||
        'USD';
    }

    if (fields.annualRevenue && !revParsed.valid) {
      warnings.push({
        field: 'annualRevenue',
        code: 'INVALID_REVENUE_NUMBER',
        message: `Could not parse annual revenue "${fields.annualRevenue}" as numeric amount.`,
        severity: 'warning',
        rawValue: fields.annualRevenue,
      });
    }
    if (fields.opportunityValue && !oppParsed.valid) {
      warnings.push({
        field: 'opportunityValue',
        code: 'INVALID_OPPORTUNITY_VALUE',
        message: `Could not parse opportunity value "${fields.opportunityValue}" as numeric amount.`,
        severity: 'warning',
        rawValue: fields.opportunityValue,
      });
    }

    // Identifiers (strictly 'syntax_validated' max on import — NEVER 'officially_verified')
    const identifiers: LeadIdentifier[] = [];
    if (webRes.domain) {
      identifiers.push({
        type: 'DOMAIN',
        value: webRes.domain,
        normalizedValue: webRes.domain.toUpperCase(),
        countryCode,
        source: 'import_engine',
        status: 'syntax_validated',
        verified: false,
      });
    }

    let regNumber = fields.registrationNumber?.trim() || undefined;
    let regType: string | undefined;
    if (regNumber) {
      const candidateType =
        fields.registrationType?.trim() || getDefaultIdentifierTypeForCountry(countryCode);
      regType = canonicalizeIdentifierType(candidateType, countryCode);
      const check = validateIdentifier(regType, regNumber, countryCode, 'user_provided');
      if (!check.valid && check.error) {
        warnings.push({
          field: 'registrationNumber',
          code: 'IDENTIFIER_SYNTAX_WARNING',
          message: `${regType}: ${check.error} (preserved as user_provided)`,
          severity: 'warning',
          rawValue: regNumber,
        });
      }
      identifiers.push({
        type: regType,
        value: regNumber,
        normalizedValue: check.normalizedValue || normalizeIdentifierValue(regNumber),
        countryCode: check.countryCode || countryCode,
        issuingAuthority: check.issuingAuthority,
        source: 'import_engine',
        status: check.valid ? 'syntax_validated' : 'user_provided',
        verified: false, // Never fake official verification on import
      });
    }

    if (fields.vatNumber?.trim()) {
      const check = validateIdentifier('EU_VAT', fields.vatNumber.trim(), countryCode, 'user_provided');
      if (!check.valid && check.error) {
        warnings.push({
          field: 'vatNumber',
          code: 'VAT_SYNTAX_WARNING',
          message: `${check.error} (preserved as user_provided)`,
          severity: 'warning',
          rawValue: fields.vatNumber,
        });
      }
      identifiers.push({
        type: 'EU_VAT',
        value: fields.vatNumber.trim(),
        normalizedValue: check.normalizedValue,
        countryCode: check.countryCode || countryCode,
        issuingAuthority: check.issuingAuthority,
        source: 'import_engine',
        status: check.valid ? 'syntax_validated' : 'user_provided',
        verified: false,
      });
    }

    if (fields.leiNumber?.trim()) {
      const check = validateIdentifier('LEI', fields.leiNumber.trim(), countryCode, 'user_provided');
      if (!check.valid && check.error) {
        warnings.push({
          field: 'leiNumber',
          code: 'LEI_SYNTAX_WARNING',
          message: `${check.error} (preserved as user_provided)`,
          severity: 'warning',
          rawValue: fields.leiNumber,
        });
      }
      identifiers.push({
        type: 'LEI',
        value: fields.leiNumber.trim(),
        normalizedValue: check.normalizedValue,
        countryCode,
        issuingAuthority: check.issuingAuthority,
        source: 'import_engine',
        status: check.valid ? 'syntax_validated' : 'user_provided',
        verified: false,
      });
    }

    const companyStatus = fields.companyStatus
      ? normalizeLegalCompanyStatus(fields.companyStatus)
      : 'unknown';

    const liCompany = normalizeLinkedInUrl(fields.linkedinCompanyUrl, 'company');
    if (liCompany.warning) {
      warnings.push({
        field: 'linkedinCompanyUrl',
        code: 'LINKEDIN_COMPANY_URL_WARNING',
        message: liCompany.warning,
        severity: 'warning',
        rawValue: fields.linkedinCompanyUrl,
      });
    }

    const empParsed = parseEmployeeCountRange(fields.employeeCount, fields.employeeRange);

    let foundedYear: number | undefined;
    if (fields.foundedYear?.trim()) {
      const isoDate = parseLocaleDateToIso(fields.foundedYear, options.dateLocale);
      const yrMatch = (isoDate || fields.foundedYear).match(/\b(1[6-9]\d{2}|20[0-2]\d)\b/);
      if (yrMatch) {
        foundedYear = parseInt(yrMatch[1], 10);
      } else {
        warnings.push({
          field: 'foundedYear',
          code: 'INVALID_FOUNDED_YEAR',
          message: `Could not parse founded year from "${fields.foundedYear}".`,
          severity: 'warning',
          rawValue: fields.foundedYear,
        });
      }
    }

    const tags = fields.tags
      ? Array.from(new Set(fields.tags.split(/[;|,]/).map((t) => t.trim()).filter(Boolean)))
      : [];

    const companyCustom = { ...customFields };
    if (fields.annualRevenue?.trim()) {
      companyCustom.annualRevenueRaw = fields.annualRevenue.trim();
      if (revParsed.valid && revParsed.value !== undefined) {
        companyCustom.annualRevenueNumeric = String(revParsed.value);
      }
    }
    if (fields.tradingName?.trim()) {
      companyCustom.tradingName = fields.tradingName.trim();
    }
    if (fields.description?.trim()) {
      companyCustom.description = fields.description.trim();
    }
    if (fields.companyStatus?.trim()) {
      companyCustom.rawImportedCompanyStatus = fields.companyStatus.trim();
    }

    company = {
      companyName: companyName || undefined,
      legalName: fields.legalName?.trim() || undefined,
      tradingName: fields.tradingName?.trim() || undefined,
      registrationNumber: regNumber,
      registrationType: regType,
      companyStatus,
      website: webRes.website,
      domain: webRes.domain,
      email: emailRes.email,
      emailStatus: emailRes.status,
      phone: rawPhone,
      phoneNormalized,
      street,
      city,
      region,
      postalCode,
      country: countryName,
      countryCode,
      formattedAddress,
      industry: fields.industry?.trim() || undefined,
      category: fields.category?.trim() || undefined,
      description: fields.description?.trim() || undefined,
      annualRevenueRaw: fields.annualRevenue?.trim() || undefined,
      annualRevenueNumeric: revParsed.valid ? revParsed.value : undefined,
      employeeCountRaw: fields.employeeCount?.trim() || undefined,
      employeeRange: empParsed.range,
      foundedYear,
      currency,
      opportunityValue: oppParsed.valid ? oppParsed.value : undefined,
      linkedinCompanyUrl: liCompany.url,
      tags,
      identifiers,
      customFields: companyCustom,
    };
  }

  // ==========================================
  // NORMALIZE PERSON / DECISION-MAKER WHEN APPLICABLE
  // ==========================================
  if (importKind === 'person_only' || importKind === 'company_and_person') {
    if (!composedFullName) {
      if (importKind === 'person_only') {
        errors.push({
          field: 'personFullName',
          code: 'MISSING_PERSON_NAME',
          message: 'Person Full Name (or First + Last Name) is required for person import rows.',
          severity: 'error',
        });
      } else {
        warnings.push({
          field: 'personFullName',
          code: 'PARTIAL_PERSON_OMITTED_NAME',
          message: 'Contact/person columns are populated without a person name; person entity will not be created without a name.',
          severity: 'warning',
        });
      }
    }

    if (composedFullName) {
      const pEmail = normalizeEmailField(fields.personEmail);
      if (!pEmail.valid) {
        warnings.push({
          field: 'personEmail',
          code: 'INVALID_PERSON_EMAIL',
          message: `Person email "${fields.personEmail}" failed RFC syntax check; preserved as unverified.`,
          severity: 'warning',
          rawValue: fields.personEmail,
        });
      }

      const pCountry = fields.personCountry
        ? resolveCountryReference(fields.personCountry, undefined, countryCode)
        : countryResolved;

      const rawPPhone = fields.personPhone?.trim() || undefined;
      let pPhoneNormalized: string | undefined;
      if (rawPPhone) {
        const pRes = normalizePhoneNumber(rawPPhone, pCountry.countryCode);
        if (pRes.valid && pRes.e164) {
          pPhoneNormalized = pRes.e164;
        } else {
          warnings.push({
            field: 'personPhone',
            code: 'PERSON_PHONE_NOT_E164',
            message: pRes.error || `Person phone "${rawPPhone}" could not be validated to E.164.`,
            severity: 'warning',
            rawValue: rawPPhone,
          });
        }
      }

      const liPerson = normalizeLinkedInUrl(fields.personLinkedInUrl, 'person');
      if (liPerson.warning) {
        warnings.push({
          field: 'personLinkedInUrl',
          code: 'LINKEDIN_PERSON_URL_WARNING',
          message: liPerson.warning,
          severity: 'warning',
          rawValue: fields.personLinkedInUrl,
        });
      }

      const relType = normalizeRelationshipType(
        fields.relationshipType,
        fields.personJobTitle,
        fields.personRole
      );

      person = {
        fullName: composedFullName,
        firstName: fields.personFirstName?.trim() || composedFullName.split(/\s+/)[0],
        lastName:
          fields.personLastName?.trim() ||
          (composedFullName.includes(' ')
            ? composedFullName.split(/\s+/).slice(1).join(' ')
            : undefined),
        normalizedName: normalizePersonNameTokens(composedFullName),
        email: pEmail.email,
        emailStatus: pEmail.status,
        phone: rawPPhone,
        phoneNormalized: pPhoneNormalized,
        linkedinUrl: liPerson.url,
        linkedinSlug: liPerson.slug,
        country: pCountry.countryName,
        countryCode: pCountry.countryCode,
        city: fields.personCity?.trim() || fields.city?.trim() || undefined,
        jobTitle: fields.personJobTitle?.trim() || fields.personRole?.trim() || undefined,
        designation: fields.personDesignation?.trim() || undefined,
        department: fields.personDepartment?.trim() || undefined,
        relationshipType: relType,
        relationshipPosition: fields.relationshipPosition?.trim() || fields.personJobTitle?.trim() || undefined,
        decisionMakerCategory: fields.decisionMakerCategory?.trim() || undefined,
        isPrimaryContact: parseBooleanFlag(fields.isPrimaryContact),
        associatedCompanyName:
          fields.associatedCompanyName?.trim() || company?.companyName || undefined,
        associatedCompanyRegNumber:
          fields.associatedCompanyRegNumber?.trim() || company?.registrationNumber || undefined,
        customFields: importKind === 'person_only' ? { ...customFields } : {},
      };
    }
  }

  return {
    importKind,
    company,
    person,
    errors,
    warnings,
    valid: errors.length === 0,
  };
}
