import { getCountryByCode } from './countries.js';

export interface AddressComponents {
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country: string;
  countryCode?: string;
}

export interface AddressValidationResult {
  valid: boolean;
  formattedAddress: string;
  warnings?: string[];
}

/**
 * Formats international addresses according to country-specific postal standards:
 * - US / CA / AU / UK: Street, City, State/Region PostalCode, Country
 * - Continental Europe (DE, NO, FR, NL, CH, AT): Street, PostalCode City, Country
 * - East Asia (JP, CN): Country, PostalCode, Prefecture/Province, City, Street
 * - No postal code jurisdictions (AE, QA, PA): Street, City, Region, Country
 */
export function formatInternationalAddress(components: AddressComponents): string {
  const { street, city, region, postalCode, country, countryCode } = components;
  const countryObj = countryCode ? getCountryByCode(countryCode) : undefined;
  const order = countryObj?.addressFormat.addressOrder || 'street_first';

  const parts: string[] = [];

  if (order === 'city_first') {
    // East Asian convention
    if (country) parts.push(country);
    if (region) parts.push(region);
    if (city) parts.push(city);
    if (postalCode) parts.push(postalCode);
    if (street) parts.push(street);
    return parts.filter(Boolean).join(', ');
  }

  if (order === 'postal_first') {
    // Continental European convention: Street, [PostalCode City], Region, Country
    if (street) parts.push(street);
    const postalCity = [postalCode, city].filter(Boolean).join(' ');
    if (postalCity) parts.push(postalCity);
    if (region && region !== city) parts.push(region);
    if (country) parts.push(country);
    return parts.filter(Boolean).join(', ');
  }

  // Standard Western convention (street_first): Street, City, Region PostalCode, Country
  if (street) parts.push(street);
  if (city) parts.push(city);

  const regionPostal = [region, postalCode].filter(Boolean).join(' ');
  if (regionPostal) parts.push(regionPostal);

  if (country) parts.push(country);

  return parts.filter(Boolean).join(', ');
}

/**
 * Validates postal codes against country regex patterns when available.
 */
export function validatePostalCode(postalCode: string, countryCode?: string): { valid: boolean; message?: string } {
  if (!countryCode) return { valid: true };
  const countryObj = getCountryByCode(countryCode);
  if (!countryObj) return { valid: true };

  // If country does not use postal codes, empty is valid
  if (!countryObj.addressFormat.hasPostalCodes) {
    return { valid: true };
  }

  if (!postalCode || !postalCode.trim()) {
    return { valid: false, message: `${countryObj.name} requires a valid ${countryObj.addressFormat.postalCodeLabel}` };
  }

  const clean = postalCode.trim();
  if (countryObj.addressFormat.postalCodePattern) {
    const regex = new RegExp(countryObj.addressFormat.postalCodePattern, 'i');
    if (!regex.test(clean)) {
      return {
        valid: false,
        message: `Invalid format for ${countryObj.addressFormat.postalCodeLabel} in ${countryObj.name}. Example: ${countryObj.addressFormat.postalCodeExample || 'N/A'}`,
      };
    }
  }

  return { valid: true };
}
