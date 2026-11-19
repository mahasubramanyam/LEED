import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import {
  DISPOSABLE_EMAIL_DOMAINS,
  FREE_PERSONAL_EMAIL_DOMAINS,
  ROLE_BASED_EMAIL_PREFIXES,
  evaluateFreshnessState,
} from '../../shared/enrichmentSpecs.js';
import { EmailVerificationResult } from '../types.js';
import { ConnectorRegistry, connectorRegistry as defaultRegistry } from '../connectors/core/registry.js';
import { CredentialManager, credentialManager as defaultCredentialManager } from '../connectors/core/credentialManager.js';
import { HunterEmailConnector } from '../connectors/adapters/hunterEmailAdapter.js';
import { ZeroBounceEmailConnector } from '../connectors/adapters/zeroBounceEmailAdapter.js';
import type { DnsLookupAllFn } from '../security/ssrf.js';

const RFC_EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export interface EmailDnsHooks {
  resolveMx?: (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;
  resolveTxt?: (domain: string) => Promise<string[][]>;
}

export interface EmailVerificationOptions {
  registry?: ConnectorRegistry;
  credentialManager?: CredentialManager;
  dnsHooks?: EmailDnsHooks;
  fetchFn?: typeof fetch;
  dnsLookupAll?: DnsLookupAllFn;
  userAgent?: string;
  preferProvider?: 'auto' | 'hunter' | 'zerobounce' | 'dns_only';
  previousVerifiedAt?: string;
  allowPersonalWebmail?: boolean;
  companyDomain?: string;
  timeoutMs?: number;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Legitimate Email Verification Framework.
 * - Never performs invasive SMTP RCPT-TO / VRFY probing.
 * - Never claims an email is deliverable merely because syntax or MX records are valid.
 * - Rejects personal webmail domains (Gmail, Yahoo, Outlook, etc.) as verified business emails.
 * - Integrates optional authorized commercial providers (Hunter.io / ZeroBounce) via Credential Vault.
 */
export async function verifyBusinessEmail(
  rawEmail: string,
  options: EmailVerificationOptions = {}
): Promise<EmailVerificationResult> {
  const verifiedAt = new Date().toISOString();
  const normalized = (rawEmail || '').trim().toLowerCase();
  const warnings: string[] = [];

  if (!normalized || !RFC_EMAIL_REGEX.test(normalized)) {
    return {
      email: rawEmail || '',
      normalizedEmail: normalized,
      domain: '',
      syntaxValid: false,
      domainValid: false,
      mxRecordsPresent: false,
      mxHosts: [],
      spfPresent: false,
      dmarcPresent: false,
      mailConfigVerified: false,
      isFreePersonalWebmail: false,
      isDisposable: false,
      isRoleBased: false,
      isCatchAll: null,
      status: 'invalid_syntax',
      crmEmailStatus: 'unverified',
      deliverabilityClaimed: false,
      honestSummary: 'Email address failed RFC syntax validation.',
      warnings: ['Invalid email format'],
      verifiedAt,
      sourceName: 'Built-In DNS / Email Verifier',
      sourceType: 'not_verified',
    };
  }

  const [localPart, domain] = normalized.split('@');
  const isFreePersonalWebmail = FREE_PERSONAL_EMAIL_DOMAINS.has(domain);
  const isDisposable = DISPOSABLE_EMAIL_DOMAINS.has(domain);
  const isRoleBased = ROLE_BASED_EMAIL_PREFIXES.has(localPart);

  if (options.companyDomain) {
    const cleanCompanyDomain = options.companyDomain.toLowerCase().replace(/^www\./, '').trim();
    if (cleanCompanyDomain && domain !== cleanCompanyDomain && !domain.endsWith(`.${cleanCompanyDomain}`)) {
      warnings.push(`Email domain (${domain}) differs from company domain (${cleanCompanyDomain}).`);
    }
  }

  if (isDisposable) {
    warnings.push('Disposable / temporary email domain detected; unsuitable for B2B CRM outreach.');
    return {
      email: rawEmail,
      normalizedEmail: normalized,
      domain,
      syntaxValid: true,
      domainValid: true,
      mxRecordsPresent: false,
      mxHosts: [],
      spfPresent: false,
      dmarcPresent: false,
      mailConfigVerified: false,
      isFreePersonalWebmail,
      isDisposable: true,
      isRoleBased,
      isCatchAll: null,
      status: 'disposable',
      crmEmailStatus: 'unverified',
      deliverabilityClaimed: false,
      honestSummary: `Disposable email domain (${domain}) detected. Rejected as verified business contact.`,
      warnings,
      verifiedAt,
      sourceName: 'Built-In DNS / Email Verifier',
      sourceType: 'authorized_verification_provider',
    };
  }

  if (isFreePersonalWebmail && !options.allowPersonalWebmail) {
    warnings.push(
      `Free personal webmail provider (${domain}) cannot be classified as a verified corporate business email.`
    );
    return {
      email: rawEmail,
      normalizedEmail: normalized,
      domain,
      syntaxValid: true,
      domainValid: true,
      mxRecordsPresent: false,
      mxHosts: [],
      spfPresent: false,
      dmarcPresent: false,
      mailConfigVerified: false,
      isFreePersonalWebmail: true,
      isDisposable: false,
      isRoleBased,
      isCatchAll: null,
      status: 'personal_webmail_rejected',
      crmEmailStatus: 'unverified',
      deliverabilityClaimed: false,
      honestSummary: `Personal email domain (${domain}) is not treated as a verified business email address.`,
      warnings,
      verifiedAt,
      sourceName: 'Built-In Privacy & Email Policy',
      sourceType: 'authorized_verification_provider',
    };
  }

  // Step 1: Non-invasive DNS MX / SPF / DMARC checks
  const dnsTimeout = Math.min(options.timeoutMs ?? 4000, 6000);
  const resolveMxFn = options.dnsHooks?.resolveMx || ((d: string) => dns.resolveMx(d));
  const resolveTxtFn = options.dnsHooks?.resolveTxt || ((d: string) => dns.resolveTxt(d));

  let mxHosts: string[] = [];
  let domainValid = false;
  let spfPresent = false;
  let dmarcPresent = false;
  let dnsFailed = false;

  try {
    const mxRecords = await withTimeout(resolveMxFn(domain), dnsTimeout);
    if (Array.isArray(mxRecords) && mxRecords.length > 0) {
      domainValid = true;
      mxHosts = mxRecords
        .sort((a, b) => a.priority - b.priority)
        .map((m) => m.exchange)
        .filter(Boolean)
        .slice(0, 6);
    }
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
      warnings.push(`No MX records published for domain "${domain}" (${code}).`);
    } else {
      dnsFailed = true;
      warnings.push(`DNS MX lookup could not complete (${err?.message || 'network timeout'}).`);
    }
  }

  if (mxHosts.length > 0) {
    try {
      const txtRecords = await withTimeout(resolveTxtFn(domain), dnsTimeout);
      const joined = (txtRecords || []).map((chunks) => chunks.join('')).join('\n').toLowerCase();
      spfPresent = joined.includes('v=spf1');
    } catch {
      // SPF check is best-effort
    }
    try {
      const dmarcRecords = await withTimeout(resolveTxtFn(`_dmarc.${domain}`), dnsTimeout);
      const joined = (dmarcRecords || []).map((chunks) => chunks.join('')).join('\n').toLowerCase();
      dmarcPresent = joined.includes('v=dmarc1');
    } catch {
      // DMARC check is best-effort
    }
  }

  const mxRecordsPresent = mxHosts.length > 0;
  const mailConfigVerified = mxRecordsPresent && (spfPresent || dmarcPresent);

  if (isRoleBased) {
    warnings.push(`Role-based business mailbox ("${localPart}@") — shared inbox rather than a named individual.`);
  }

  // Step 2: Optional Authorized Verification Provider (Hunter.io / ZeroBounce) via Credential Vault
  const prefer = options.preferProvider || 'auto';
  if (prefer !== 'dns_only') {
    const reg = options.registry || defaultRegistry;
    const credMgr = options.credentialManager || defaultCredentialManager;
    const candidateProviders: Array<'conn-hunter-email' | 'conn-zerobounce-email'> =
      prefer === 'hunter'
        ? ['conn-hunter-email']
        : prefer === 'zerobounce'
        ? ['conn-zerobounce-email']
        : ['conn-hunter-email', 'conn-zerobounce-email'];

    for (const providerId of candidateProviders) {
      const conn = reg.getById(providerId);
      if (!conn || !reg.isEnabled(providerId)) continue;
      const resolved = await credMgr.resolveCredentialForExecution(
        providerId,
        conn.getMetadata().credentialRequirements
      );
      if (!resolved.credentials.apiKey) continue;

      const controller = new AbortController();
      const execCtx = {
        requestId: `email-ver-${crypto.randomBytes(4).toString('hex')}`,
        signal: controller.signal,
        credentials: resolved.credentials,
        credentialSource: resolved.source,
        config: { connectorId: providerId, enabled: true },
        userAgent: options.userAgent || 'GlobalLeadEngine/12.0',
        timeoutMs: options.timeoutMs || 10000,
      };

      try {
        if (providerId === 'conn-hunter-email') {
          const client =
            options.fetchFn || options.dnsLookupAll
              ? new HunterEmailConnector(options.fetchFn, options.dnsLookupAll)
              : (conn as HunterEmailConnector);
          const h = await client.verifyEmailAddress(normalized, execCtx);
          const isCatchAll = Boolean(h.accept_all || h.status === 'accept_all');
          const providerDisposable = Boolean(h.disposable || h.status === 'disposable');
          const providerWebmail = Boolean(h.webmail || h.status === 'webmail');

          let status: EmailVerificationResult['status'] = 'unknown';
          let crmEmailStatus: EmailVerificationResult['crmEmailStatus'] = 'syntax_valid';
          let deliverabilityClaimed = false;

          if (providerDisposable) {
            status = 'disposable';
            crmEmailStatus = 'unverified';
          } else if (providerWebmail && !options.allowPersonalWebmail) {
            status = 'personal_webmail_rejected';
            crmEmailStatus = 'unverified';
          } else if (h.result === 'undeliverable' || h.status === 'invalid') {
            status = 'undeliverable';
            crmEmailStatus = 'unverified';
          } else if (isCatchAll) {
            status = 'catch_all';
            crmEmailStatus = 'syntax_valid';
            warnings.push('Domain is configured as catch-all (accept_all); individual mailbox delivery cannot be guaranteed.');
          } else if (h.result === 'deliverable' && h.status === 'valid') {
            status = 'provider_deliverable';
            crmEmailStatus = 'verified';
            deliverabilityClaimed = true;
          } else if (h.result === 'risky') {
            status = 'provider_risky';
            crmEmailStatus = 'syntax_valid';
          }

          return {
            email: rawEmail,
            normalizedEmail: normalized,
            domain,
            syntaxValid: true,
            domainValid: Boolean(h.mx_records ?? domainValid),
            mxRecordsPresent: Boolean(h.mx_records ?? mxRecordsPresent),
            mxHosts,
            spfPresent,
            dmarcPresent,
            mailConfigVerified: Boolean(h.smtp_server || mailConfigVerified),
            isFreePersonalWebmail: isFreePersonalWebmail || providerWebmail,
            isDisposable: providerDisposable,
            isRoleBased,
            isCatchAll,
            status,
            crmEmailStatus,
            providerUsed: 'Hunter.io Email Verification API',
            providerStatus: `${h.status || 'unknown'} / ${h.result || 'unknown'}`,
            providerScore: typeof h.score === 'number' ? h.score : undefined,
            deliverabilityClaimed,
            honestSummary: deliverabilityClaimed
              ? `Verified deliverable by Hunter.io (score ${h.score ?? 'N/A'}/100).`
              : `Hunter.io returned "${h.status || 'unknown'}" (${h.result || 'unknown'}). Deliverability not guaranteed.`,
            warnings,
            verifiedAt,
            sourceName: 'Hunter.io Email Verification API',
            sourceType: 'authorized_verification_provider',
          };
        }

        if (providerId === 'conn-zerobounce-email') {
          const client =
            options.fetchFn || options.dnsLookupAll
              ? new ZeroBounceEmailConnector(options.fetchFn, options.dnsLookupAll)
              : (conn as ZeroBounceEmailConnector);
          const zb = await client.verifyEmailAddress(normalized, execCtx);
          const zbStatus = (zb.status || 'unknown').toLowerCase();
          const sub = (zb.sub_status || '').toLowerCase();
          const isCatchAll = zbStatus === 'catch-all';
          const zbDisposable = sub.includes('disposable');
          const zbRole = sub.includes('role_based') || isRoleBased;

          let status: EmailVerificationResult['status'] = 'unknown';
          let crmEmailStatus: EmailVerificationResult['crmEmailStatus'] = 'syntax_valid';
          let deliverabilityClaimed = false;

          if (zbDisposable) {
            status = 'disposable';
            crmEmailStatus = 'unverified';
          } else if (zb.free_email && !options.allowPersonalWebmail) {
            status = 'personal_webmail_rejected';
            crmEmailStatus = 'unverified';
          } else if (zbStatus === 'invalid' || zbStatus === 'spamtrap' || zbStatus === 'abuse' || zbStatus === 'do_not_mail') {
            status = 'undeliverable';
            crmEmailStatus = 'unverified';
          } else if (isCatchAll) {
            status = 'catch_all';
            crmEmailStatus = 'syntax_valid';
            warnings.push('ZeroBounce detected a catch-all domain; individual recipient inbox cannot be guaranteed.');
          } else if (zbStatus === 'valid') {
            status = 'provider_deliverable';
            crmEmailStatus = 'verified';
            deliverabilityClaimed = true;
          }

          return {
            email: rawEmail,
            normalizedEmail: normalized,
            domain,
            syntaxValid: true,
            domainValid: zb.mx_found === true || zb.mx_found === 'true' || domainValid,
            mxRecordsPresent: zb.mx_found === true || zb.mx_found === 'true' || mxRecordsPresent,
            mxHosts: zb.mx_record ? Array.from(new Set([zb.mx_record, ...mxHosts])) : mxHosts,
            spfPresent,
            dmarcPresent,
            mailConfigVerified: Boolean(zb.mx_found === true || zb.mx_found === 'true' || mailConfigVerified),
            isFreePersonalWebmail: Boolean(zb.free_email || isFreePersonalWebmail),
            isDisposable: zbDisposable,
            isRoleBased: zbRole,
            isCatchAll,
            status,
            crmEmailStatus,
            providerUsed: 'ZeroBounce Email Validation API',
            providerStatus: sub ? `${zbStatus} (${sub})` : zbStatus,
            deliverabilityClaimed,
            honestSummary: deliverabilityClaimed
              ? 'Verified deliverable by ZeroBounce Email Validation API.'
              : `ZeroBounce returned "${zbStatus}"${sub ? ` (${sub})` : ''}. Deliverability not guaranteed.`,
            warnings,
            verifiedAt,
            sourceName: 'ZeroBounce Email Validation API',
            sourceType: 'authorized_verification_provider',
          };
        }
      } catch (err: any) {
        warnings.push(
          `${conn.getMetadata().shortName} verification failed (${err?.message || 'provider error'}); falling back to DNS mail configuration checks.`
        );
      }
    }
  }

  // Step 3: Honest DNS-only classification (NEVER claims mailbox deliverability!)
  let status: EmailVerificationResult['status'] = 'syntax_valid';
  let honestSummary =
    'Syntax valid only. Domain mail records could not be confirmed; deliverability is NOT verified.';

  if (dnsFailed && !mxRecordsPresent) {
    status = 'verification_failed';
    honestSummary =
      'DNS verification encountered a transient error. Syntax is valid, but mail configuration could not be confirmed.';
  } else if (mailConfigVerified) {
    status = isRoleBased ? 'role_based' : 'mail_config_verified';
    honestSummary = isRoleBased
      ? `Role-based inbox with verified domain MX + ${spfPresent ? 'SPF' : ''}${spfPresent && dmarcPresent ? '/' : ''}${dmarcPresent ? 'DMARC' : ''} configuration. Mailbox deliverability requires Hunter.io or ZeroBounce API key.`
      : `Domain MX + ${spfPresent ? 'SPF' : ''}${spfPresent && dmarcPresent ? '/' : ''}${dmarcPresent ? 'DMARC' : ''} mail configuration verified (no invasive SMTP probing). Individual mailbox deliverability is NOT claimed without an authorized verification API.`;
  } else if (mxRecordsPresent) {
    status = isRoleBased ? 'role_based' : 'mx_present';
    honestSummary =
      'Syntax valid and domain MX records present. Individual mailbox deliverability is NOT claimed without an authorized verification provider.';
  } else if (options.previousVerifiedAt) {
    const fresh = evaluateFreshnessState('email', options.previousVerifiedAt);
    if (fresh.status === 'stale') {
      status = 'stale';
      honestSummary = `Previously verified ${fresh.ageDays} days ago (exceeds ${fresh.maxAgeDays}-day email freshness policy); current DNS check did not confirm MX records.`;
    }
  }

  return {
    email: rawEmail,
    normalizedEmail: normalized,
    domain,
    syntaxValid: true,
    domainValid,
    mxRecordsPresent,
    mxHosts,
    spfPresent,
    dmarcPresent,
    mailConfigVerified,
    isFreePersonalWebmail,
    isDisposable: false,
    isRoleBased,
    isCatchAll: null,
    status,
    // Strictly never upgrade to 'verified' from DNS/syntax alone!
    crmEmailStatus: 'syntax_valid',
    deliverabilityClaimed: false,
    honestSummary,
    warnings,
    verifiedAt,
    sourceName: 'Built-In DNS / MX / SPF / DMARC Inspector',
    sourceType: 'authorized_verification_provider',
  };
}
