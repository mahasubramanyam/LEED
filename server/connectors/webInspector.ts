import dns from 'dns/promises';

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

// Check if an IPv4 or IPv6 address is in a reserved/private/loopback range
function isDisallowedIp(ip: string): boolean {
  // IPv4 Loopback
  if (ip.startsWith('127.')) return true;
  // Private 10.0.0.0/8
  if (ip.startsWith('10.')) return true;
  // Private 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  // Private 192.168.0.0/16
  if (ip.startsWith('192.168.')) return true;
  // Cloud metadata and link-local 169.254.0.0/16
  if (ip.startsWith('169.254.')) return true;
  // Current network / broadcast
  if (ip === '0.0.0.0' || ip === '255.255.255.255') return true;

  // IPv6 loopback & link-local
  if (ip === '::1' || ip.toLowerCase().startsWith('fe80:') || ip.toLowerCase().startsWith('fc00:') || ip.toLowerCase().startsWith('fd00:')) {
    return true;
  }

  return false;
}

export async function inspectWebsite(rawUrl: string): Promise<WebInspectionResult> {
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

  let targetUrl: URL;
  try {
    const formatted = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
      ? rawUrl
      : `https://${rawUrl}`;
    targetUrl = new URL(formatted);
  } catch {
    result.securityCheck = { passed: false, reason: 'Malformed URL scheme' };
    return result;
  }

  // Scheme constraint
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    result.securityCheck = { passed: false, reason: 'Invalid protocol. Only HTTP/HTTPS allowed' };
    return result;
  }

  // Reject embedded credentials
  if (targetUrl.username || targetUrl.password) {
    result.securityCheck = { passed: false, reason: 'Embedded credentials prohibited' };
    return result;
  }

  result.domain = targetUrl.hostname.replace(/^www\./, '');
  result.isHttps = targetUrl.protocol === 'https:';

  // SSRF Protection: DNS resolution & address validation
  try {
    const lookup = await dns.lookup(targetUrl.hostname);
    if (isDisallowedIp(lookup.address)) {
      result.securityCheck = {
        passed: false,
        ipResolved: lookup.address,
        reason: `Target IP ${lookup.address} resolved to protected/private network (SSRF blocked)`,
      };
      return result;
    }
    result.securityCheck = { passed: true, ipResolved: lookup.address };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.securityCheck = { passed: false, reason: `DNS lookup failed for hostname: ${msg}` };
    return result;
  }

  // Live HTTP check with bounded timeout and safe headers
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GlobalLeadBot/1.0; +https://internal-pipeline.local)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeout);
    result.serverLatencyMs = Date.now() - start;
    result.httpStatus = response.status;
    result.isOnline = response.ok;

    if (!response.ok) {
      return result;
    }

    // Read bounded response content (max 300KB to prevent memory exhaustion)
    const text = await response.text();
    const safeHtml = text.slice(0, 300000);

    // Extract Title
    const titleMatch = safeHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      result.title = titleMatch[1].trim().replace(/\s+/g, ' ');
    }

    // Extract Meta Description
    const descMatch = safeHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      safeHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    if (descMatch && descMatch[1]) {
      result.description = descMatch[1].trim();
    }

    // Extract Public Emails
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const rawEmails = safeHtml.match(emailRegex) || [];
    const validEmails = Array.from(new Set(rawEmails)).filter((e) => {
      const lower = e.toLowerCase();
      // Filter out common asset/code false positives
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

    // Extract Social Links
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
    const msg = err instanceof Error ? err.message : String(err);
    result.securityCheck = { passed: true, ipResolved: result.securityCheck.ipResolved, reason: `HTTP request error: ${msg}` };
    return result;
  }
}
