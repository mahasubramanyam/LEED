export interface AdministrativeDivision {
  code: string; // ISO 3166-2 division code or abbreviation (e.g. 'CA', 'TX', 'ENG', 'NSW', 'BY', 'NO-50')
  name: string; // Display name (e.g. 'California', 'Texas', 'England', 'New South Wales', 'Bayern', 'Trøndelag')
  type: string;
  nativeName?: string;
}

export interface AddressFormatSpec {
  hasRegions: boolean;
  regionLabel: string;
  hasPostalCodes: boolean;
  postalCodeLabel: string;
  postalCodePattern?: string; // Regex string for client & server validation
  postalCodeExample?: string;
  addressOrder: 'street_first' | 'city_first' | 'postal_first';
}

export interface CountryReference {
  code: string; // ISO 3166-1 alpha-2 (e.g. 'GB', 'US', 'NO')
  alpha3: string; // ISO 3166-1 alpha-3 (e.g. 'GBR', 'USA', 'NOR')
  numericCode?: string; // ISO 3166-1 numeric
  name: string; // Common English display name
  officialName: string; // Official state name
  nativeName?: string; // Native language name / endonym
  flag: string; // Unicode emoji flag
  callingCode: string; // International dialing code (e.g. '+44', '+1', '+47')
  currency: string; // ISO 4217 currency code (e.g. 'GBP', 'USD', 'NOK', 'EUR')
  currencySymbol: string; // Currency display symbol (e.g. '£', '$', 'kr', '€')
  timezones: string[]; // IANA timezone identifiers (e.g. ['Europe/London'])
  languages: string[]; // ISO 639-1 language codes (e.g. ['en'])
  isSovereignState: boolean; // True for 195 sovereign states; false for dependencies / territories
  unMember: boolean;
  continent: 'Europe' | 'North America' | 'South America' | 'Asia' | 'Africa' | 'Oceania' | 'Antarctica';
  addressFormat: AddressFormatSpec;
  primaryIdentifierType?: string; // e.g. 'UK_CRN', 'NO_ORG', 'AU_ABN', 'US_EIN', 'FR_SIREN'
  supportedIdentifierTypes: string[];
  divisions?: AdministrativeDivision[];
}

export interface CityReference {
  id: string;
  name: string;
  countryCode: string;
  divisionCode?: string;
  divisionName?: string;
  population?: number;
  latitude?: number;
  longitude?: number;
}

export type SourceType =
  | 'official_open_registry'
  | 'official_api_credentials'
  | 'public_geo_directory'
  | 'web_inspector'
  | 'manual_registry_portal'
  | 'restricted_unavailable';

export type IntegrationStatus =
  | 'live_open_api'
  | 'configured_api_key'
  | 'requires_api_key'
  | 'public_directory_permit'
  | 'restricted_manual_only'
  | 'unavailable';

export type AuthRequirement = 'none_open' | 'api_key' | 'environment' | 'manual_portal' | 'none';

export interface CountrySourceCapability {
  id: string;
  countryCode: string;
  countryName: string;
  flag: string;
  providerName: string;
  sourceType: SourceType;
  integrationStatus: IntegrationStatus;
  authRequirement: AuthRequirement;
  sourceUrl: string;
  lastCheckedAt?: string;
  notes: string;
  licensingInfo: string;
  coverageFeatures: string[];
}
