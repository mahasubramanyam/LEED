/**
 * LEED Phase 3 Localization & Formatting Utilities
 * Standard ISO 4217, ISO 639-1, and IANA timezone handling
 */

export function formatCurrencyLocale(
  amount: number,
  currencyCode = 'USD',
  locale = 'en-US'
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currencyCode.toUpperCase()} ${amount.toLocaleString()}`;
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
