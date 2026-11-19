import crypto from 'node:crypto';
import { normalizePhoneNumber } from '../geo/phoneUtils.js';
import { PhoneLineType, PhoneVerificationResult } from '../types.js';
import { ConnectorRegistry, connectorRegistry as defaultRegistry } from '../connectors/core/registry.js';
import { CredentialManager, credentialManager as defaultCredentialManager } from '../connectors/core/credentialManager.js';
import { NumverifyPhoneConnector } from '../connectors/adapters/numverifyPhoneAdapter.js';
import type { DnsLookupAllFn } from '../security/ssrf.js';

export interface PhoneVerificationOptions {
  countryCode?: string;
  registry?: ConnectorRegistry;
  credentialManager?: CredentialManager;
  fetchFn?: typeof fetch;
  dnsLookupAll?: DnsLookupAllFn;
  userAgent?: string;
  useLiveProvider?: boolean;
  existingPhoneNormalized?: string;
  isPersonContact?: boolean;
  personAssociationSourceVerified?: boolean;
  timeoutMs?: number;
}

/**
 * Conservative country-specific line-type heuristics (explicitly marked `lineTypeBasis: 'heuristic'`,
 * never represented as carrier-verified).
 */
function inferLineTypeHeuristic(
  e164: string,
  countryCode: string
): { lineType: PhoneLineType; businessClassification: PhoneVerificationResult['businessClassification'] } {
  const cc = countryCode.toUpperCase();
  const digits = e164.replace(/[^0-9]/g, '');

  // Common international toll-free ranges
  if (
    (cc === 'US' || cc === 'CA') &&
    /^1(?:800|833|844|855|866|877|888)\d{7}$/.test(digits)
  ) {
    return { lineType: 'toll_free', businessClassification: 'likely_business' };
  }
  if (cc === 'GB' && /^44(?:800|808)\d{6,7}$/.test(digits)) {
    return { lineType: 'toll_free', businessClassification: 'likely_business' };
  }
  if (cc === 'NO' && /^47800\d{5}$/.test(digits)) {
    return { lineType: 'toll_free', businessClassification: 'likely_business' };
  }
  if (cc === 'DE' && /^49800\d{6,8}$/.test(digits)) {
    return { lineType: 'toll_free', businessClassification: 'likely_business' };
  }

  // Country-specific mobile vs landline prefix heuristics
  if (cc === 'NO') {
    const sub = digits.slice(2);
    if (/^[49]\d{7}$/.test(sub)) return { lineType: 'mobile', businessClassification: 'shared_or_unknown' };
    if (/^[23567]\d{7}$/.test(sub)) return { lineType: 'landline', businessClassification: 'likely_business' };
  }
  if (cc === 'GB') {
    const sub = digits.slice(2);
    if (/^7\d{9}$/.test(sub)) return { lineType: 'mobile', businessClassification: 'shared_or_unknown' };
    if (/^[123]\d{8,9}$/.test(sub)) return { lineType: 'landline', businessClassification: 'likely_business' };
  }
  if (cc === 'DE') {
    const sub = digits.slice(2);
    if (/^1[567]\d{8,9}$/.test(sub)) return { lineType: 'mobile', businessClassification: 'shared_or_unknown' };
    if (/^[2-9]\d{7,10}$/.test(sub)) return { lineType: 'landline', businessClassification: 'likely_business' };
  }
  if (cc === 'FR') {
    const sub = digits.slice(2);
    if (/^[67]\d{8}$/.test(sub)) return { lineType: 'mobile', businessClassification: 'shared_or_unknown' };
    if (/^[1-5]\d{8}$/.test(sub)) return { lineType: 'landline', businessClassification: 'likely_business' };
  }
  if (cc === 'AU') {
    const sub = digits.slice(2);
    if (/^4\d{8}$/.test(sub)) return { lineType: 'mobile', businessClassification: 'shared_or_unknown' };
    if (/^[2378]\d{8}$/.test(sub)) return { lineType: 'landline', businessClassification: 'likely_business' };
  }

  return { lineType: 'unknown', businessClassification: 'shared_or_unknown' };
}

function mapProviderLineType(raw?: string | null): PhoneLineType {
  const val = (raw || '').toLowerCase().trim();
  if (val === 'landline') return 'landline';
  if (val === 'mobile') return 'mobile';
  if (val === 'voip') return 'voip';
  if (val === 'toll_free') return 'toll_free';
  if (val === 'special_services' || val === 'premium_rate') return 'special_services';
  return 'unknown';
}

/**
 * Business Phone Validation & Normalization built on Phase 3 international phone infrastructure.
 * - Normalizes to canonical E.164 + country-aware international/national formats.
 * - Optionally verifies carrier & line type via APILayer Numverify (conn-numverify-phone) when configured.
 * - Never claims a phone number belongs to a specific person without verified association evidence.
 */
export async function verifyBusinessPhone(
  rawPhone: string,
  options: PhoneVerificationOptions = {}
): Promise<PhoneVerificationResult> {
  const verifiedAt = new Date().toISOString();
  const warnings: string[] = [];
  const hintCountry = (options.countryCode || 'US').toUpperCase();

  const normalized = normalizePhoneNumber(rawPhone, hintCountry);
  const personAssociationVerified = Boolean(
    options.isPersonContact ? options.personAssociationSourceVerified : false
  );

  if (!normalized.valid) {
    return {
      rawPhone: rawPhone || '',
      e164: normalized.e164,
      internationalFormatted: normalized.internationalFormatted,
      nationalFormatted: normalized.nationalFormatted,
      countryCode: normalized.countryCode,
      callingCode: normalized.callingCode,
      syntaxValid: false,
      status: 'invalid_format',
      lineType: 'unknown',
      lineTypeBasis: 'unknown',
      businessClassification: 'shared_or_unknown',
      personAssociationVerified: false,
      honestSummary: normalized.error || 'Telephone number failed international E.164 format validation.',
      warnings: [normalized.error || 'Invalid phone number format'],
      verifiedAt,
      sourceName: 'Phase 3 E.164 Phone Validator',
      sourceType: 'not_verified',
    };
  }

  // Detect conflicting existing phone
  let isConflict = false;
  if (options.existingPhoneNormalized) {
    const existingClean = options.existingPhoneNormalized.replace(/[^0-9+]/g, '');
    if (existingClean && existingClean !== normalized.e164) {
      isConflict = true;
      warnings.push(
        `Normalized phone (${normalized.e164}) conflicts with existing CRM phone (${existingClean}).`
      );
    }
  }

  if (options.isPersonContact && !personAssociationVerified) {
    warnings.push(
      'Personal attribution is not confirmed — do not assume this line belongs exclusively to the individual without direct source evidence.'
    );
  }

  // Optional live carrier verification via conn-numverify-phone
  if (options.useLiveProvider !== false) {
    const reg = options.registry || defaultRegistry;
    const credMgr = options.credentialManager || defaultCredentialManager;
    const conn = reg.getById('conn-numverify-phone');
    if (conn && reg.isEnabled('conn-numverify-phone')) {
      const resolved = await credMgr.resolveCredentialForExecution(
        'conn-numverify-phone',
        conn.getMetadata().credentialRequirements
      );
      if (resolved.credentials.apiKey) {
        const controller = new AbortController();
        try {
          const client =
            options.fetchFn || options.dnsLookupAll
              ? new NumverifyPhoneConnector(options.fetchFn, options.dnsLookupAll)
              : (conn as NumverifyPhoneConnector);
          const nv = await client.verifyPhoneNumber(normalized.e164, {
            requestId: `phone-ver-${crypto.randomBytes(4).toString('hex')}`,
            signal: controller.signal,
            credentials: resolved.credentials,
            credentialSource: resolved.source,
            config: { connectorId: 'conn-numverify-phone', enabled: true },
            userAgent: options.userAgent || 'GlobalLeadEngine/12.0',
            timeoutMs: options.timeoutMs || 9000,
          });

          const lineType = mapProviderLineType(nv.line_type);
          const businessClassification: PhoneVerificationResult['businessClassification'] =
            lineType === 'landline' || lineType === 'toll_free'
              ? 'likely_business'
              : 'shared_or_unknown';

          if (nv.valid === false) {
            return {
              rawPhone,
              e164: normalized.e164,
              internationalFormatted: normalized.internationalFormatted,
              nationalFormatted: normalized.nationalFormatted,
              countryCode: nv.country_code || normalized.countryCode,
              callingCode: nv.country_prefix || normalized.callingCode,
              syntaxValid: true,
              status: 'invalid_format',
              lineType,
              lineTypeBasis: 'provider_verified',
              businessClassification,
              carrier: nv.carrier || undefined,
              location: nv.location || undefined,
              providerUsed: 'APILayer Numverify Phone API',
              personAssociationVerified,
              honestSummary: 'Numverify reported this telephone number as invalid in the national numbering plan.',
              warnings: [...warnings, 'Carrier numbering plan rejected phone number.'],
              verifiedAt,
              sourceName: 'APILayer Numverify Phone API',
              sourceType: 'authorized_verification_provider',
            };
          }

          return {
            rawPhone,
            e164: normalized.e164,
            internationalFormatted: nv.international_format || normalized.internationalFormatted,
            nationalFormatted: nv.local_format || normalized.nationalFormatted,
            countryCode: nv.country_code || normalized.countryCode,
            callingCode: nv.country_prefix || normalized.callingCode,
            syntaxValid: true,
            status: isConflict ? 'conflicting' : 'provider_verified',
            lineType,
            lineTypeBasis: 'provider_verified',
            businessClassification,
            carrier: nv.carrier || undefined,
            location: nv.location || undefined,
            providerUsed: 'APILayer Numverify Phone API',
            personAssociationVerified,
            honestSummary: `Verified by Numverify (${nv.country_code || normalized.countryCode}, ${lineType}${nv.carrier ? `, carrier: ${nv.carrier}` : ''}).`,
            warnings,
            verifiedAt,
            sourceName: 'APILayer Numverify Phone API',
            sourceType: 'authorized_verification_provider',
          };
        } catch (err: any) {
          warnings.push(
            `Numverify verification failed (${err?.message || 'provider error'}); falling back to Phase 3 E.164 validation.`
          );
        }
      }
    }
  }

  const heuristic = inferLineTypeHeuristic(normalized.e164, normalized.countryCode);

  return {
    rawPhone,
    e164: normalized.e164,
    internationalFormatted: normalized.internationalFormatted,
    nationalFormatted: normalized.nationalFormatted,
    countryCode: normalized.countryCode,
    callingCode: normalized.callingCode,
    syntaxValid: true,
    status: isConflict ? 'conflicting' : 'e164_valid',
    lineType: heuristic.lineType,
    lineTypeBasis: heuristic.lineType === 'unknown' ? 'unknown' : 'heuristic',
    businessClassification: heuristic.businessClassification,
    personAssociationVerified,
    honestSummary: `Valid E.164 format (${normalized.internationalFormatted}, ${normalized.countryCode}). Carrier activation is not confirmed without an authorized phone verification API.`,
    warnings,
    verifiedAt,
    sourceName: 'Phase 3 E.164 Phone Validator',
    sourceType: 'official_website',
  };
}
