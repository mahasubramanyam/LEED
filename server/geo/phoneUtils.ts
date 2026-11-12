import { getCountryByCode, getAllCountries } from './countries.js';

export interface PhoneNormalizationResult {
  valid: boolean;
  raw: string;
  e164: string;
  internationalFormatted: string;
  nationalFormatted: string;
  countryCode: string; // ISO 2-letter
  callingCode: string;
  error?: string;
}

/**
 * Common national trunk prefixes and national length constraints.
 */
const COUNTRY_PHONE_SPECS: Record<
  string,
  {
    callingCode: string;
    trunkPrefix?: string;
    subscriberLengths: number[]; // e.g. 8 for Norway, 10 for US/UK
    formatPattern?: (digits: string) => { national: string; international: string };
  }
> = {
  NO: {
    callingCode: '+47',
    trunkPrefix: '',
    subscriberLengths: [8],
    formatPattern: (d) => ({
      national: `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)}`,
      international: `+47 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} ${d.slice(6, 8)}`,
    }),
  },
  GB: {
    callingCode: '+44',
    trunkPrefix: '0',
    subscriberLengths: [10, 9, 11],
    formatPattern: (d) => ({
      national: `0${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`,
      international: `+44 ${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`,
    }),
  },
  US: {
    callingCode: '+1',
    trunkPrefix: '1',
    subscriberLengths: [10],
    formatPattern: (d) => ({
      national: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
      international: `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
    }),
  },
  CA: {
    callingCode: '+1',
    trunkPrefix: '1',
    subscriberLengths: [10],
    formatPattern: (d) => ({
      national: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
      international: `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`,
    }),
  },
  AU: {
    callingCode: '+61',
    trunkPrefix: '0',
    subscriberLengths: [9],
    formatPattern: (d) => ({
      national: `0${d.slice(0, 1)} ${d.slice(1, 5)} ${d.slice(5)}`,
      international: `+61 ${d.slice(0, 1)} ${d.slice(1, 5)} ${d.slice(5)}`,
    }),
  },
  DE: {
    callingCode: '+49',
    trunkPrefix: '0',
    subscriberLengths: [9, 10, 11],
    formatPattern: (d) => ({
      national: `0${d.slice(0, 3)} ${d.slice(3)}`,
      international: `+49 ${d.slice(0, 3)} ${d.slice(3)}`,
    }),
  },
  FR: {
    callingCode: '+33',
    trunkPrefix: '0',
    subscriberLengths: [9],
    formatPattern: (d) => ({
      national: `0${d.slice(0, 1)} ${d.slice(1, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`,
      international: `+33 ${d.slice(0, 1)} ${d.slice(1, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`,
    }),
  },
  IN: {
    callingCode: '+91',
    trunkPrefix: '0',
    subscriberLengths: [10],
    formatPattern: (d) => ({
      national: `${d.slice(0, 5)} ${d.slice(5)}`,
      international: `+91 ${d.slice(0, 5)} ${d.slice(5)}`,
    }),
  },
};

/**
 * Normalizes phone numbers to standard E.164 and localized display formats.
 */
export function normalizePhoneNumber(
  rawPhone: string,
  hintCountryCode = 'US'
): PhoneNormalizationResult {
  if (!rawPhone || typeof rawPhone !== 'string' || !rawPhone.trim()) {
    return {
      valid: false,
      raw: rawPhone || '',
      e164: '',
      internationalFormatted: '',
      nationalFormatted: '',
      countryCode: hintCountryCode.toUpperCase(),
      callingCode: '',
      error: 'Phone number is empty',
    };
  }

  const cleaned = rawPhone.trim();
  const digitsOnly = cleaned.replace(/[^0-9]/g, '');

  if (digitsOnly.length < 5 || digitsOnly.length > 15) {
    return {
      valid: false,
      raw: cleaned,
      e164: cleaned.startsWith('+') ? `+${digitsOnly}` : digitsOnly,
      internationalFormatted: cleaned,
      nationalFormatted: cleaned,
      countryCode: hintCountryCode.toUpperCase(),
      callingCode: '',
      error: `Invalid telephone length (${digitsOnly.length} digits; expected 6-15)`,
    };
  }

  // 1. Detect if input starts with a '+' or '00' international prefix
  let detectedCountryCode = hintCountryCode.toUpperCase();
  let subscriberDigits = digitsOnly;
  let callingCode = '';

  const allCountries = getAllCountries();
  const sortedCallingCodes = allCountries
    .map((c) => ({ code: c.code, call: c.callingCode.replace(/[^0-9]/g, '') }))
    .filter((c) => c.call.length > 0)
    .sort((a, b) => b.call.length - a.call.length); // match longest calling code first

  if (cleaned.startsWith('+') || cleaned.startsWith('00')) {
    const intlDigits = cleaned.startsWith('00') ? digitsOnly.slice(2) : digitsOnly;
    for (const item of sortedCallingCodes) {
      if (intlDigits.startsWith(item.call)) {
        detectedCountryCode = item.code;
        callingCode = `+${item.call}`;
        subscriberDigits = intlDigits.slice(item.call.length);
        break;
      }
    }
  } else {
    // Check if default country calling code is embedded
    const defaultCountry = getCountryByCode(hintCountryCode);
    const defCallDigits = defaultCountry?.callingCode.replace(/[^0-9]/g, '');
    if (defaultCountry && defCallDigits && digitsOnly.startsWith(defCallDigits) && digitsOnly.length > defCallDigits.length + 6) {
      detectedCountryCode = defaultCountry.code;
      callingCode = `+${defCallDigits}`;
      subscriberDigits = digitsOnly.slice(defCallDigits.length);
    } else {
      callingCode = defaultCountry?.callingCode || '+1';
      // Strip local trunk prefix if present (e.g. leading 0 in UK/DE/AU/FR)
      const spec = COUNTRY_PHONE_SPECS[detectedCountryCode];
      if (spec?.trunkPrefix && subscriberDigits.startsWith(spec.trunkPrefix)) {
        subscriberDigits = subscriberDigits.slice(spec.trunkPrefix.length);
      }
    }
  }

  // Clean subscriber digits from any accidental remaining leading zero
  const spec = COUNTRY_PHONE_SPECS[detectedCountryCode];
  if (spec?.trunkPrefix && subscriberDigits.startsWith(spec.trunkPrefix) && subscriberDigits.length > 8) {
    subscriberDigits = subscriberDigits.slice(spec.trunkPrefix.length);
  }

  const e164 = `${callingCode}${subscriberDigits}`;

  // Validate length against country rules or ITU-T E.164 generic limit (<= 15 total digits)
  let valid = true;
  let error: string | undefined;

  if (spec && spec.subscriberLengths) {
    if (!spec.subscriberLengths.includes(subscriberDigits.length)) {
      valid = false;
      error = `Subscriber number length for ${detectedCountryCode} is ${subscriberDigits.length} (expected ${spec.subscriberLengths.join(' or ')})`;
    }
  } else if (e164.length < 8 || e164.length > 16) {
    valid = false;
    error = `International phone number length invalid (${e164.length} digits)`;
  }

  // Format outputs
  let nationalFormatted = subscriberDigits;
  let internationalFormatted = e164;

  if (spec?.formatPattern && valid) {
    const formatted = spec.formatPattern(subscriberDigits);
    nationalFormatted = formatted.national;
    internationalFormatted = formatted.international;
  } else {
    internationalFormatted = `${callingCode} ${subscriberDigits}`;
    nationalFormatted = subscriberDigits;
  }

  return {
    valid,
    raw: cleaned,
    e164,
    internationalFormatted,
    nationalFormatted,
    countryCode: detectedCountryCode,
    callingCode,
    error,
  };
}
