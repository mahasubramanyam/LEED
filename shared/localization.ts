/**
 * Shared Locale-Aware Currency, Number, and Date/Timezone Formatting Utilities
 * Presentation-only formatting using ISO 4217 currencies and IANA timezones.
 */

const COUNTRY_DEFAULT_LOCALE: Record<string, { locale: string; timezone: string; currency: string }> = {
  US: { locale: 'en-US', timezone: 'America/New_York', currency: 'USD' },
  GB: { locale: 'en-GB', timezone: 'Europe/London', currency: 'GBP' },
  NO: { locale: 'nb-NO', timezone: 'Europe/Oslo', currency: 'NOK' },
  AU: { locale: 'en-AU', timezone: 'Australia/Sydney', currency: 'AUD' },
  DE: { locale: 'de-DE', timezone: 'Europe/Berlin', currency: 'EUR' },
  FR: { locale: 'fr-FR', timezone: 'Europe/Paris', currency: 'EUR' },
  CA: { locale: 'en-CA', timezone: 'America/Toronto', currency: 'CAD' },
  CH: { locale: 'de-CH', timezone: 'Europe/Zurich', currency: 'CHF' },
  JP: { locale: 'ja-JP', timezone: 'Asia/Tokyo', currency: 'JPY' },
  IN: { locale: 'en-IN', timezone: 'Asia/Kolkata', currency: 'INR' },
  SG: { locale: 'en-SG', timezone: 'Asia/Singapore', currency: 'SGD' },
  AE: { locale: 'en-AE', timezone: 'Asia/Dubai', currency: 'AED' },
  NL: { locale: 'nl-NL', timezone: 'Europe/Amsterdam', currency: 'EUR' },
  SE: { locale: 'sv-SE', timezone: 'Europe/Stockholm', currency: 'SEK' },
  DK: { locale: 'da-DK', timezone: 'Europe/Copenhagen', currency: 'DKK' },
  ES: { locale: 'es-ES', timezone: 'Europe/Madrid', currency: 'EUR' },
  IT: { locale: 'it-IT', timezone: 'Europe/Rome', currency: 'EUR' },
};

const CURRENCY_DEFAULT_LOCALE: Record<string, string> = {
  USD: 'en-US',
  GBP: 'en-GB',
  NOK: 'nb-NO',
  AUD: 'en-AU',
  EUR: 'de-DE',
  CAD: 'en-CA',
  CHF: 'de-CH',
  JPY: 'ja-JP',
  INR: 'en-IN',
  SGD: 'en-SG',
  AED: 'en-AE',
  SEK: 'sv-SE',
  DKK: 'da-DK',
};

export function getLocaleForCountry(countryCode?: string, currencyCode?: string): string {
  const c = (countryCode || '').toUpperCase().trim();
  if (c && COUNTRY_DEFAULT_LOCALE[c]) {
    return COUNTRY_DEFAULT_LOCALE[c].locale;
  }
  const cur = (currencyCode || '').toUpperCase().trim();
  if (cur && CURRENCY_DEFAULT_LOCALE[cur]) {
    return CURRENCY_DEFAULT_LOCALE[cur];
  }
  return 'en-US';
}

export function getTimezoneForCountry(countryCode?: string): string | undefined {
  const c = (countryCode || '').toUpperCase().trim();
  return c ? COUNTRY_DEFAULT_LOCALE[c]?.timezone : undefined;
}

export function formatCurrencyLocale(
  amount: number,
  currencyCode = 'USD',
  locale?: string
): string {
  const safeCurrency = (currencyCode || 'USD').toUpperCase().trim();
  const resolvedLocale = locale || CURRENCY_DEFAULT_LOCALE[safeCurrency] || 'en-US';
  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: safeCurrency === 'JPY' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${safeCurrency} ${amount.toLocaleString()}`;
  }
}

export function formatNumberLocale(
  num: number,
  locale = 'en-US'
): string {
  try {
    return new Intl.NumberFormat(locale).format(num);
  } catch {
    return num.toLocaleString();
  }
}

export function formatDateLocale(
  dateIso: string | Date,
  locale = 'en-US',
  timezone?: string
): string {
  try {
    const d = typeof dateIso === 'string' ? new Date(dateIso) : dateIso;
    if (isNaN(d.getTime())) return String(dateIso);
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || undefined,
    };
    return new Intl.DateTimeFormat(locale, options).format(d);
  } catch {
    return String(dateIso);
  }
}

export interface CurrencySummary {
  totals: Array<{ currency: string; amount: number; formatted: string }>;
  isMixed: boolean;
  primaryFormatted: string;
  primaryCurrency: string;
}

/**
 * Aggregates opportunity values grouped by ISO 4217 currency without converting or falsifying exchange rates.
 */
export function summarizeValuesByCurrency(
  items: Array<{ opportunityValue?: number; currency?: string; address?: { countryCode?: string } }>,
  defaultCurrency = 'USD'
): CurrencySummary {
  const map = new Map<string, number>();

  for (const item of items) {
    const val = Number(item.opportunityValue || 0);
    if (val === 0 && items.length > 0) continue;
    const cur = (item.currency || COUNTRY_DEFAULT_LOCALE[item.address?.countryCode?.toUpperCase() || '']?.currency || defaultCurrency).toUpperCase();
    map.set(cur, (map.get(cur) || 0) + val);
  }

  if (map.size === 0) {
    const cur = (defaultCurrency || 'USD').toUpperCase();
    const formatted = formatCurrencyLocale(0, cur);
    return {
      totals: [{ currency: cur, amount: 0, formatted }],
      isMixed: false,
      primaryFormatted: formatted,
      primaryCurrency: cur,
    };
  }

  const totals = Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([currency, amount]) => ({
      currency,
      amount,
      formatted: formatCurrencyLocale(amount, currency),
    }));

  return {
    totals,
    isMixed: totals.length > 1,
    primaryFormatted: totals.length === 1 ? totals[0].formatted : totals.map((t) => t.formatted).join(' · '),
    primaryCurrency: totals[0].currency,
  };
}
