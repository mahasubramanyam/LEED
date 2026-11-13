/**
 * LEED Phase 3 Comprehensive Verification Suite
 * Global Country and Regional Intelligence, International Business Identity,
 * Localization, Capability Matrix, and Security Regression
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Geo modules
import {
  COUNTRIES_DATA,
  getCountryByCode,
  getAllCountries,
  getSovereignStatesCount,
  searchCountries,
} from '../server/geo/countries.ts';
import { getDivisionsForCountry, ADMINISTRATIVE_DIVISIONS } from '../server/geo/divisions.ts';
import { searchCities } from '../server/geo/cities.ts';
import { normalizePhoneNumber } from '../server/geo/phoneUtils.ts';
import { formatInternationalAddress, validatePostalCode } from '../server/geo/addressUtils.ts';
import { formatCurrencyLocale, formatNumberLocale, formatDateLocale } from '../server/geo/localization.ts';
import { buildCountryCapabilityMatrix } from '../server/geo/capabilityMatrix.ts';

// Identifier engine
import {
  validateIdentifier,
  normalizeIdentifierValue,
  validateNorwegianOrgNr,
  validateAustralianAbn,
  validateLuhn,
  validateLei,
} from '../server/identifiers/identifierEngine.ts';

// Deduplication
import { detectDuplicates, mergeLeads } from '../server/connectors/dedupeEngine.ts';
import { CanonicalLead } from '../server/types.ts';

// Owner Auth & CSRF regression
import { generateCsrfToken } from '../server/auth/csrf.ts';
import { hashPassword, verifyPassword } from '../server/auth/password.ts';

describe('LEED Phase 3 Verification Suite', () => {
  describe('1. Global Geographic Foundation (195 Sovereign States + Territories)', () => {
    it('should contain exactly 195 sovereign states (193 UN members + Holy See + State of Palestine)', () => {
      const sovereignStates = COUNTRIES_DATA.filter((c) => c.isSovereignState);
      assert.strictEqual(
        sovereignStates.length,
        195,
        `Expected exactly 195 sovereign states, found ${sovereignStates.length}`
      );
      assert.strictEqual(getSovereignStatesCount(), 195);

      const unMembers = sovereignStates.filter((c) => c.unMember);
      assert.strictEqual(unMembers.length, 193, 'Expected 193 UN member states');

      // Verify Holy See (VA) and Palestine (PS) are explicitly present as sovereign observer states
      const holySee = getCountryByCode('VA');
      assert.ok(holySee, 'Holy See (VA) must be present');
      assert.strictEqual(holySee.isSovereignState, true);
      assert.strictEqual(holySee.alpha3, 'VAT');

      const palestine = getCountryByCode('PS');
      assert.ok(palestine, 'State of Palestine (PS) must be present');
      assert.strictEqual(palestine.isSovereignState, true);
      assert.strictEqual(palestine.alpha3, 'PSE');
    });

    it('should include key dependent territories and separately searchable jurisdictions', () => {
      const territories = COUNTRIES_DATA.filter((c) => !c.isSovereignState);
      assert.ok(territories.length >= 15, 'Must contain at least 15 key territories');

      const hk = getCountryByCode('HK');
      assert.ok(hk, 'Hong Kong (HK) must be present');
      assert.strictEqual(hk.isSovereignState, false);
      assert.strictEqual(hk.alpha3, 'HKG');

      const pr = getCountryByCode('PR');
      assert.ok(pr, 'Puerto Rico (PR) must be present');
      assert.strictEqual(pr.isSovereignState, false);

      const bm = getCountryByCode('BM');
      assert.ok(bm, 'Bermuda (BM) must be present');

      const ky = getCountryByCode('KY');
      assert.ok(ky, 'Cayman Islands (KY) must be present');
    });

    it('should verify ISO 3166-1 alpha-2, alpha-3, dialing codes, currencies, and timezones for all entries', () => {
      const all = getAllCountries();
      assert.ok(all.length >= 210);
      const seenCodes = new Set<string>();
      const seenAlpha3 = new Set<string>();

      for (const country of all) {
        assert.ok(country.code && country.code.length === 2, `Country ${country.name} missing valid alpha-2`);
        assert.ok(country.alpha3 && country.alpha3.length === 3, `Country ${country.name} missing valid alpha-3`);
        assert.ok(!seenCodes.has(country.code), `Duplicate ISO alpha-2: ${country.code}`);
        assert.ok(!seenAlpha3.has(country.alpha3), `Duplicate ISO alpha-3: ${country.alpha3}`);
        seenCodes.add(country.code);
        seenAlpha3.add(country.alpha3);

        assert.ok(country.callingCode && country.callingCode.startsWith('+'), `Country ${country.name} missing calling code`);
        assert.ok(country.currency && country.currency.length === 3, `Country ${country.name} missing ISO 4217 currency`);
        assert.ok(country.timezones && country.timezones.length > 0, `Country ${country.name} missing IANA timezone`);
        assert.ok(country.addressFormat, `Country ${country.name} missing addressFormat specification`);
      }
    });

    it('should lookup and search countries case-insensitively by alpha-2, alpha-3, or name', () => {
      assert.strictEqual(getCountryByCode('no')?.code, 'NO');
      assert.strictEqual(getCountryByCode('nor')?.code, 'NO');
      assert.strictEqual(getCountryByCode('gbr')?.code, 'GB');
      assert.strictEqual(getCountryByCode('usa')?.code, 'US');
      assert.strictEqual(getCountryByCode('aus')?.code, 'AU');
      assert.strictEqual(getCountryByCode('Germany')?.code, 'DE');
      assert.strictEqual(getCountryByCode('Japan')?.code, 'JP');

      const nordics = searchCountries('Norw');
      assert.ok(nordics.some((c) => c.code === 'NO'));
    });
  });

  describe('2. Administrative Divisions & Dependent Relationships', () => {
    it('should provide administrative divisions for primary target economies', () => {
      const usDivs = getDivisionsForCountry('US');
      assert.ok(usDivs.length >= 51, 'US must have all 50 states plus DC');

      const gbDivs = getDivisionsForCountry('GB');
      assert.ok(gbDivs.length >= 4, 'GB must have England, Scotland, Wales, Northern Ireland');

      const noDivs = getDivisionsForCountry('NO');
      assert.ok(noDivs.length >= 10, 'Norway must have fylker (counties)');

      const auDivs = getDivisionsForCountry('AU');
      assert.ok(auDivs.length >= 8, 'Australia must have states & territories');

      const deDivs = getDivisionsForCountry('DE');
      assert.ok(deDivs.length >= 16, 'Germany must have 16 Bundesländer');

      assert.ok(Object.keys(ADMINISTRATIVE_DIVISIONS).length >= 15);
    });

    it('should resolve specific division codes cleanly', () => {
      const cal = getDivisionsForCountry('US').find((d) => d.code === 'CA');
      assert.ok(cal);
      assert.strictEqual(cal.name, 'California');

      const oslo = getDivisionsForCountry('NO').find((d) => d.code === 'NO-03');
      assert.ok(oslo);
      assert.strictEqual(oslo.name, 'Oslo');

      const nsw = getDivisionsForCountry('AU').find((d) => d.code === 'NSW');
      assert.ok(nsw);
      assert.strictEqual(nsw.name, 'New South Wales');
    });
  });

  describe('3. Scalable City Search & Locality Resolution', () => {
    it('should query cities with prefix and fuzzy matching without loading unbounded datasets', () => {
      const osloResults = searchCities({ query: 'Osl', countryCode: 'NO' });
      assert.ok(osloResults.length > 0);
      assert.strictEqual(osloResults[0].name, 'Oslo');
      assert.strictEqual(osloResults[0].countryCode, 'NO');

      const londonResults = searchCities({ query: 'Lond', countryCode: 'GB' });
      assert.ok(londonResults.length > 0);
      assert.strictEqual(londonResults[0].name, 'London');

      const sydneyResults = searchCities({ query: 'Sydn', countryCode: 'AU' });
      assert.ok(sydneyResults.length > 0);
      assert.strictEqual(sydneyResults[0].name, 'Sydney');
    });

    it('should respect query limits and paginate gracefully', () => {
      const allResults = searchCities({ limit: 10 });
      assert.strictEqual(allResults.length, 10);
    });
  });

  describe('4. Country-Specific Business Identifier Validation & Normalization', () => {
    it('should validate Norway Modulo-11 organization numbers', () => {
      // Valid Brreg OrgNr: 974760673 (Brønnøysundregistrene)
      assert.strictEqual(validateNorwegianOrgNr('974760673'), true);
      const resBrreg = validateIdentifier('NO_ORG', '974 760 673', 'NO');
      assert.strictEqual(resBrreg.valid, true, 'Official Brønnøysund registry orgnr must be valid');
      assert.strictEqual(resBrreg.normalizedValue, '974760673');
      assert.strictEqual(resBrreg.status, 'syntax_validated');

      // Invalid Mod-11 checksum check
      const resInvalid = validateIdentifier('NO_ORG', '974760679', 'NO');
      assert.strictEqual(resInvalid.valid, false, 'Tampered control digit must fail Modulo-11');
      assert.strictEqual(resInvalid.status, 'user_provided');
    });

    it('should validate Australia Modulo-89 ABN numbers', () => {
      // Valid ABN: 51 824 753 556 (Australian Taxation Office)
      assert.strictEqual(validateAustralianAbn('51824753556'), true);
      const resAbn = validateIdentifier('ABN', '51 824 753 556', 'AU');
      assert.strictEqual(resAbn.valid, true, 'ATO ABN must pass Modulo-89 check');
      assert.strictEqual(resAbn.normalizedValue, '51824753556');
      assert.strictEqual(resAbn.status, 'syntax_validated');

      const resInvalidAbn = validateIdentifier('ABN', '51 824 753 559', 'AU');
      assert.strictEqual(resInvalidAbn.valid, false, 'Invalid ABN must fail check');
    });

    it('should validate France SIREN using Luhn algorithm', () => {
      // Valid SIREN: 732 829 320
      assert.strictEqual(validateLuhn('732829320'), true);
      const resSiren = validateIdentifier('SIREN', '732 829 320', 'FR');
      assert.strictEqual(resSiren.valid, true, 'SIREN must pass Luhn algorithm');
      assert.strictEqual(resSiren.normalizedValue, '732829320');
      assert.strictEqual(resSiren.status, 'syntax_validated');

      const resBadSiren = validateIdentifier('SIREN', '732829325', 'FR');
      assert.strictEqual(resBadSiren.valid, false, 'Invalid Luhn SIREN must fail');
    });

    it('should validate Legal Entity Identifiers (LEI) using ISO 7064 Modulo 97-10', () => {
      // Valid LEI: 5493006MHB84DD0ZWV18
      assert.strictEqual(validateLei('5493006MHB84DD0ZWV18'), true);
      const resLei = validateIdentifier('LEI', '5493 006M HB84 DD0Z WV18');
      assert.strictEqual(resLei.valid, true, 'LEI must pass ISO 7064 Modulo 97-10');
      assert.strictEqual(resLei.normalizedValue, '5493006MHB84DD0ZWV18');
      assert.strictEqual(resLei.status, 'syntax_validated');

      const resBadLei = validateIdentifier('LEI', '5493006MHB84DD0ZWV19');
      assert.strictEqual(resBadLei.valid, false, 'Invalid LEI checksum must fail');
    });

    it('should validate UK Companies House CRN format', () => {
      const resCrn1 = validateIdentifier('CRN', '01234567', 'GB');
      assert.strictEqual(resCrn1.valid, true);
      assert.strictEqual(resCrn1.normalizedValue, '01234567');

      const resCrnSc = validateIdentifier('CRN', 'SC123456', 'GB');
      assert.strictEqual(resCrnSc.valid, true);
      assert.strictEqual(resCrnSc.normalizedValue, 'SC123456');
    });

    it('should normalize comparison without mutating original value and distinguish provenance statuses', () => {
      const raw = '  no-974.760.673  ';
      const norm = normalizeIdentifierValue(raw);
      assert.strictEqual(norm, 'NO974760673');

      assert.strictEqual(validateIdentifier('CRN', 'bad', 'GB').status, 'user_provided');
      assert.strictEqual(validateIdentifier('CRN', 'bad', 'GB', 'discovered').status, 'discovered');
      assert.strictEqual(validateIdentifier('CRN', '01234567', 'GB').status, 'syntax_validated');
      assert.strictEqual(validateIdentifier('CRN', '01234567', 'GB', 'officially_verified').status, 'officially_verified');
    });
  });

  describe('5. International Telephone Normalization & Localization', () => {
    it('should normalize national numbers to E.164 and international format', () => {
      const noPhone = normalizePhoneNumber('22 34 56 78', 'NO');
      assert.strictEqual(noPhone.e164, '+4722345678');
      assert.strictEqual(noPhone.valid, true);

      const gbPhone = normalizePhoneNumber('020 7946 0912', 'GB');
      assert.strictEqual(gbPhone.e164, '+442079460912');
      assert.strictEqual(gbPhone.valid, true);

      const auPhone = normalizePhoneNumber('02 9876 5432', 'AU');
      assert.strictEqual(auPhone.e164, '+61298765432');
      assert.strictEqual(auPhone.valid, true);

      const usPhone = normalizePhoneNumber('(415) 555-2671', 'US');
      assert.strictEqual(usPhone.e164, '+14155552671');
      assert.strictEqual(usPhone.valid, true);
    });

    it('should handle already-prefixed E.164 numbers and locale formatting', () => {
      const intl = normalizePhoneNumber('+47 987 65 432');
      assert.strictEqual(intl.e164, '+4798765432');
      assert.strictEqual(intl.valid, true);

      assert.ok(formatCurrencyLocale(12500, 'NOK', 'nb-NO').length > 0);
      assert.ok(formatNumberLocale(1234567, 'en-US').includes(','));
      assert.ok(formatDateLocale('2026-11-12T10:00:00Z', 'en-GB', 'Europe/London').includes('2026'));
    });
  });

  describe('6. Destination Nation Address Formatting & Postal Code Validation', () => {
    it('should format addresses adhering to destination country conventions', () => {
      const ukAddr = formatInternationalAddress({
        street: '10 Downing Street',
        city: 'London',
        postalCode: 'SW1A 2AA',
        country: 'United Kingdom',
        countryCode: 'GB',
      });
      assert.ok(ukAddr.includes('London'));
      assert.ok(ukAddr.includes('SW1A 2AA'));

      const noAddr = formatInternationalAddress({
        street: 'Karl Johans gate 1',
        city: 'Oslo',
        postalCode: '0154',
        country: 'Norway',
        countryCode: 'NO',
      });
      assert.ok(noAddr.includes('0154 Oslo'));

      const usAddr = formatInternationalAddress({
        street: '1600 Amphitheatre Pkwy',
        city: 'Mountain View',
        region: 'CA',
        postalCode: '94043',
        country: 'United States',
        countryCode: 'US',
      });
      assert.ok(usAddr.includes('Mountain View'));
      assert.ok(usAddr.includes('CA 94043'));
    });

    it('should validate postal code regular expressions', () => {
      assert.strictEqual(validatePostalCode('0154', 'NO').valid, true);
      assert.strictEqual(validatePostalCode('015', 'NO').valid, false);

      assert.strictEqual(validatePostalCode('SW1A 2AA', 'GB').valid, true);
      assert.strictEqual(validatePostalCode('94043', 'US').valid, true);
      assert.strictEqual(validatePostalCode('2000', 'AU').valid, true);
      assert.strictEqual(validatePostalCode('75008', 'FR').valid, true);
      assert.strictEqual(validatePostalCode('10115', 'DE').valid, true);

      // UAE does not enforce postal codes
      assert.strictEqual(validatePostalCode('', 'AE').valid, true);
    });
  });

  describe('7. Country and Source Capability Matrix', () => {
    it('should generate matrix covering all 210 jurisdictions and classify source tiers accurately', () => {
      const matrix = buildCountryCapabilityMatrix([]);
      assert.ok(matrix.length >= 210, `Expected at least 210 capability entries, got ${matrix.length}`);

      // Verify NO (Norway) capability tier
      const noCap = matrix.find((m) => m.countryCode === 'NO');
      assert.ok(noCap);
      assert.strictEqual(noCap.integrationStatus, 'live_open_api');
      assert.strictEqual(noCap.authRequirement, 'none_open');

      // Verify GB (UK) capability tier
      const gbCap = matrix.find((m) => m.countryCode === 'GB');
      assert.ok(gbCap);
      assert.strictEqual(gbCap.authRequirement, 'api_key');

      // Verify AU (Australia) capability tier — live ABR requires GUID, local tool provides offline checksum/sample
      const auCap = matrix.find((m) => m.countryCode === 'AU');
      assert.ok(auCap);
      assert.strictEqual(auCap.integrationStatus, 'requires_api_key');

      // Verify restricted/manual countries are never falsely shown as live open APIs
      const deCap = matrix.find((m) => m.countryCode === 'DE');
      assert.ok(deCap);
      assert.strictEqual(deCap.integrationStatus, 'restricted_manual_only');

      // Verify geographic reference only countries are marked unavailable
      const tvCap = matrix.find((m) => m.countryCode === 'TV');
      assert.ok(tvCap);
      assert.strictEqual(tvCap.integrationStatus, 'unavailable');
    });
  });

  describe('8. Database Migration 003 Idempotence & Safe Schema Verification', () => {
    it('should have non-destructive 003 migration and valid rollback script', () => {
      const upPath = join(process.cwd(), 'server/db/migrations/003_global_intelligence.sql');
      const downPath = join(process.cwd(), 'server/db/migrations/003_global_intelligence.down.sql');

      assert.ok(existsSync(upPath), '003_global_intelligence.sql must exist');
      assert.ok(existsSync(downPath), '003_global_intelligence.down.sql must exist');

      const upSql = readFileSync(upPath, 'utf8');
      const downSql = readFileSync(downPath, 'utf8');

      assert.ok(!upSql.includes('DROP TABLE leads'), 'Must not drop leads table');
      assert.ok(!upSql.includes('TRUNCATE'), 'Must not truncate any tables');
      assert.ok(upSql.includes('ADD COLUMN IF NOT EXISTS country_code'), 'Must safely add country_code');
      assert.ok(upSql.includes('ADD COLUMN IF NOT EXISTS normalized_value'), 'Must safely add normalized_value');
      assert.ok(upSql.includes('country_source_capabilities'), 'Must create capability matrix schema');
      assert.ok(downSql.includes('DROP TABLE IF EXISTS country_source_capabilities'), 'Down script must roll back safely');
    });
  });

  describe('9. Multi-Identifier Deduplication Engine Resilience', () => {
    it('should detect duplicates across formatted/unformatted registration numbers and secondary identifiers (LEI)', () => {
      const now = new Date().toISOString();
      const lead1: CanonicalLead = {
        id: 'lead-test-1',
        companyName: 'Brønnøysund Test Corp',
        registrationNumber: '974 760 673',
        registrationType: 'ORGNR',
        address: { countryCode: 'NO', city: 'Brønnøysund', country: 'Norway' },
        industry: 'Public Registry',
        category: 'Government',
        confidenceScore: 80,
        confidenceSignals: [],
        sources: [],
        identifiers: [
          { type: 'ORGNR', value: '974 760 673', normalizedValue: '974760673', countryCode: 'NO', verified: false },
          { type: 'LEI', value: '5493006MHB84DD0ZWV18', normalizedValue: '5493006MHB84DD0ZWV18', verified: false },
        ],
        status: 'new',
        pipelineStageId: 'stage-discovered',
        currency: 'NOK',
        tags: [],
        notes: [],
        activities: [],
        createdAt: now,
        updatedAt: now,
      };

      const lead2: CanonicalLead = {
        ...lead1,
        id: 'lead-test-2',
        companyName: 'Bronnoysund Test AS',
        registrationNumber: '974760673',
        identifiers: [{ type: 'ORGNR', value: '974760673', verified: false }],
      };

      const matches = detectDuplicates([lead1, lead2]);
      assert.strictEqual(matches.length, 1);
      assert.strictEqual(matches[0].matchType, 'registration_number');

      // Match via secondary LEI identifier even when primary reg numbers differ
      const lead3: CanonicalLead = {
        ...lead1,
        id: 'lead-test-3',
        companyName: 'Different Parent Entity',
        registrationNumber: undefined,
        identifiers: [{ type: 'LEI', value: '5493-006M-HB84-DD0Z-WV18', verified: false }],
      };

      const leiMatches = detectDuplicates([lead1, lead3]);
      assert.strictEqual(leiMatches.length, 1);
      assert.strictEqual(leiMatches[0].matchType, 'registration_number');
    });

    it('should merge incoming multi-identifiers into survivor preserving distinct types', () => {
      const now = new Date().toISOString();
      const primary: CanonicalLead = {
        id: 'lead-merge-1',
        companyName: 'Global Enterprises Ltd',
        registrationNumber: '01234567',
        registrationType: 'CRN',
        address: { countryCode: 'GB', city: 'London', country: 'United Kingdom' },
        industry: 'Financial Services',
        category: 'Enterprise',
        confidenceScore: 75,
        confidenceSignals: ['Companies House'],
        sources: [],
        identifiers: [
          { type: 'CRN', value: '01234567', normalizedValue: '01234567', countryCode: 'GB', verified: false },
        ],
        status: 'new',
        pipelineStageId: 'stage-discovered',
        currency: 'GBP',
        tags: [],
        notes: [],
        activities: [],
        createdAt: now,
        updatedAt: now,
      };

      const absorbed: CanonicalLead = {
        ...primary,
        id: 'lead-merge-2',
        identifiers: [
          { type: 'CRN', value: '01234567', verified: false }, // duplicate normalized CRN
          { type: 'VAT', value: 'GB123456789', countryCode: 'GB', verified: false },
          { type: 'LEI', value: '5493006MHB84DD0ZWV18', verified: false },
        ],
      };

      const { updatedSurvivor } = mergeLeads(primary, absorbed, 'exact_registration_match');
      assert.strictEqual(updatedSurvivor.identifiers.length, 3, 'Should deduplicate CRN/UK_CRN and combine EU_VAT + LEI');
      assert.ok(updatedSurvivor.identifiers.some((i) => i.type === 'EU_VAT'));
      assert.ok(updatedSurvivor.identifiers.some((i) => i.type === 'LEI'));
    });
  });

  describe('10. Phase 1 & Phase 2 Security Regression', () => {
    it('should verify single-owner password hashing and verification', async () => {
      const pass = 'OwnerSuperPass123!Secure';
      const hash = await hashPassword(pass);
      assert.ok(hash.startsWith('$2'), 'Hash must use bcrypt format');
      assert.strictEqual(await verifyPassword(pass, hash), true);
      assert.strictEqual(await verifyPassword('WrongPassword', hash), false);
    });

    it('should verify CSRF token generation', () => {
      const token = generateCsrfToken();
      assert.strictEqual(typeof token, 'string');
      assert.strictEqual(token.length, 64);
    });
  });
});
