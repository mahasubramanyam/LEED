import {
  DnsLookupAllFn,
  fetchWithSsrfProtection,
  SsrfBlockedError,
  validateOutboundUrl,
} from '../security/ssrf.js';

export interface WebInspectionResult {
  url: string;
  domain: string;
  isOnline: boolean;
  httpStatus?: number;
  serverLatencyMs?: number;
  isHttps: boolean;
  title?: string;
  description?: string;
  emailsFound: string[];
  phonesFound: string[];
  socialLinks: {
    linkedin?: string;
    facebook?: string;
    instagram?: string;
    twitter?: string;
    youtube?: string;
  };
  securityCheck: {
    passed: boolean;
    ipResolved?: string;
    reason?: string;
  };
}

export async function inspectWebsite(
  rawUrl: string,
  testHooks?: { dnsLookupAll?: DnsLookupAllFn; fetchFn?: typeof fetch; maxBytes?: number }
): Promise<WebInspectionResult> {
  const result: WebInspectionResult = {
    url: rawUrl,
    domain: '',
    isOnline: false,
    isHttps: false,
    emailsFound: [],
    phonesFound: [],
    socialLinks: {},
    securityCheck: { passed: false },
  };

  const preCheck = await validateOutboundUrl(rawUrl, {
    dnsLookupAll: testHooks?.dnsLookupAll,
    allowStandardPortsOnly: true,
  });

  if (!preCheck.allowed || !preCheck.url) {
    result.domain = preCheck.url?.hostname?.replace(/^www\./, '') || '';
    result.securityCheck = {
      passed: false,
      ipResolved: preCheck.resolvedIps?.[0],
      reason: preCheck.reason || 'Outbound target rejected by SSRF guard',
    };
    return result;
  }

  result.domain = preCheck.url.hostname.replace(/^www\./, '');
  result.isHttps = preCheck.url.protocol === 'https:';
  result.securityCheck = { passed: true, ipResolved: preCheck.resolvedIps?.[0] };

  const start = Date.now();
  try {
    const fetched = await fetchWithSsrfProtection(preCheck.url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GlobalLeadBot/1.0; +https://internal-pipeline.local)',
        Accept: 'text/html,application/xhtml+xml',
      },
      timeoutMs: 6000,
      maxRedirects: 3,
      maxBytes: testHooks?.maxBytes ?? 300 * 1024,
      dnsLookupAll: testHooks?.dnsLookupAll,
      fetchFn: testHooks?.fetchFn,
    });

    result.serverLatencyMs = Date.now() - start;
    result.httpStatus = fetched.response.status;
    result.isOnline = fetched.response.ok;
    result.domain = fetched.finalUrl.hostname.replace(/^www\./, '');
    result.isHttps = fetched.finalUrl.protocol === 'https:';
    result.securityCheck = {
      passed: true,
      ipResolved: fetched.resolvedIps[0] || preCheck.resolvedIps?.[0],
    };

    if (!fetched.response.ok) {
      return result;
    }

    const safeHtml = fetched.bodyText.slice(0, 300000);

    // Extract Title
    const titleMatch = safeHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      result.title = titleMatch[1].trim().replace(/\s+/g, ' ');
    }

    // Extract Meta Description
    const descMatch =
      safeHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      safeHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (descMatch && descMatch[1]) {
      result.description = descMatch[1].trim();
    }

    // Extract Public Emails
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const rawEmails = safeHtml.match(emailRegex) || [];
    const validEmails = Array.from(new Set(rawEmails)).filter((e) => {
      const lower = e.toLowerCase();
      return (
        !lower.endsWith('.png') &&
        !lower.endsWith('.jpg') &&
        !lower.endsWith('.svg') &&
        !lower.endsWith('.js') &&
        !lower.includes('sentry') &&
        !lower.includes('example.com') &&
        !lower.includes('w3.org')
      );
    });
    result.emailsFound = validEmails.slice(0, 5);

    // Extract Social Links (http/https only)
    const linkedinMatch = safeHtml.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
    if (linkedinMatch) result.socialLinks.linkedin = linkedinMatch[0];

    const facebookMatch = safeHtml.match(/https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9_.-]+/i);
    if (facebookMatch && !facebookMatch[0].includes('sharer')) result.socialLinks.facebook = facebookMatch[0];

    const instagramMatch = safeHtml.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.-]+/i);
    if (instagramMatch) result.socialLinks.instagram = instagramMatch[0];

    const twitterMatch = safeHtml.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/i);
    if (twitterMatch && !twitterMatch[0].includes('intent')) result.socialLinks.twitter = twitterMatch[0];

    const ytMatch = safeHtml.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/)[a-zA-Z0-9_-]+/i);
    if (ytMatch) result.socialLinks.youtube = ytMatch[0];

    return result;
  } catch (err: unknown) {
    result.serverLatencyMs = Date.now() - start;
    result.isOnline = false;
    if (err instanceof SsrfBlockedError) {
      result.securityCheck = {
        passed: false,
        ipResolved: err.ipResolved || result.securityCheck.ipResolved,
        reason: err.message,
      };
      return result;
    }
    const msg = err instanceof Error ? err.message : String(err);
    result.securityCheck = {
      passed: true,
      ipResolved: result.securityCheck.ipResolved,
      reason: `HTTP request error: ${msg}`,
    };
    return result;
  }
}
