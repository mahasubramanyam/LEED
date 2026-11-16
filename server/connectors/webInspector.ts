import {
  DnsLookupAllFn,
  fetchWithSsrfProtection,
  SsrfBlockedError,
  validateOutboundUrl,
} from '../security/ssrf.js';
import type { AttributeProvenanceEntry } from '../types.js';

export type CompanyPageType =
  | 'homepage'
  | 'about'
  | 'products'
  | 'contact'
  | 'locations'
  | 'imprint';

export interface CrawledPageExcerpt {
  url: string;
  pageType: CompanyPageType;
  title?: string;
  httpStatus: number;
  retrievedAt: string;
  textExcerpt: string;
}

export interface WebInspectionResult {
  url: string;
  domain: string;
  isOnline: boolean;
  httpStatus?: number;
  serverLatencyMs?: number;
  isHttps: boolean;
  businessName?: string;
  title?: string;
  description?: string;
  industry?: string;
  productsServices?: string[];
  addressesFound?: string[];
  emailsFound: string[];
  phonesFound: string[];
  locationsServed?: string[];
  operatingInfo?: string;
  aboutPageUrl?: string;
  productsPageUrl?: string;
  contactPageUrl?: string;
  locationsPageUrl?: string;
  imprintPageUrl?: string;
  pagesVisited?: string[];
  pageExcerpts?: CrawledPageExcerpt[];
  attributeProvenance?: Record<string, AttributeProvenanceEntry>;
  socialLinks: {
    linkedin?: string;
    facebook?: string;
    instagram?: string;
    twitter?: string;
    youtube?: string;
    github?: string;
  };
  securityCheck: {
    passed: boolean;
    ipResolved?: string;
    reason?: string;
  };
}

export interface InspectWebsiteOptions {
  dnsLookupAll?: DnsLookupAllFn;
  fetchFn?: typeof fetch;
  maxBytes?: number;
  maxPages?: number;
  userAgent?: string;
  checkRobots?: boolean;
}

const SKIP_PATH_PATTERNS = [
  /\/(?:login|signin|sign-in|signup|sign-up|register|auth|oauth|sso)\b/i,
  /\/(?:admin|wp-admin|wp-login|cart|checkout|account|dashboard)\b/i,
  /\.(?:pdf|zip|png|jpe?g|gif|svg|webp|ico|css|js|xml|json|mp4|mp3)$/i,
];

const GENERAL_BUSINESS_EMAIL_PREFIXES = new Set([
  'info',
  'contact',
  'hello',
  'hi',
  'sales',
  'support',
  'office',
  'admin',
  'team',
  'enquiries',
  'enquiry',
  'inquiries',
  'inquiry',
  'post',
  'mail',
  'service',
  'services',
  'billing',
  'accounts',
  'press',
  'media',
  'legal',
  'compliance',
  'privacy',
  'partners',
  'business',
  'company',
  'desk',
  'reception',
  'orders',
  'booking',
  'bookings',
  'general',
  'ir',
  'investor',
  'investors',
]);

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripHtmlToVisibleText(html: string): string {
  return decodeBasicEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(?:p|div|li|h[1-6]|tr|br|section|article|address)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sameRegistrableAlias(hostA: string, hostB: string): boolean {
  const a = hostA.toLowerCase().replace(/^www\./, '');
  const b = hostB.toLowerCase().replace(/^www\./, '');
  return a === b;
}

function isGeneralBusinessEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const local = lower.split('@')[0] || '';
  if (GENERAL_BUSINESS_EMAIL_PREFIXES.has(local)) return true;
  // Avoid personal firstname.lastname / firstname_lastname harvesting in Phase 10
  if (/^[a-z]{2,}\.[a-z]{2,}$/i.test(local) || /^[a-z]{2,}_[a-z]{2,}$/i.test(local)) {
    return false;
  }
  return !local.includes('noreply') && !local.includes('no-reply') && !local.includes('donotreply');
}

function extractValidEmails(html: string): string[] {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const rawEmails = html.match(emailRegex) || [];
  const deduped = Array.from(new Set(rawEmails.map((e) => e.trim())));
  return deduped.filter((e) => {
    const lower = e.toLowerCase();
    if (
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.js') ||
      lower.endsWith('.css') ||
      lower.includes('sentry') ||
      lower.includes('example.com') ||
      lower.includes('w3.org') ||
      lower.includes('schema.org') ||
      lower.includes('noreply') ||
      lower.includes('no-reply')
    ) {
      return false;
    }
    return isGeneralBusinessEmail(e);
  });
}

function extractBusinessPhones(html: string, visibleText: string): string[] {
  const found: string[] = [];
  const telLinks = Array.from(html.matchAll(/href=["']tel:([^"']+)["']/gi));
  for (const m of telLinks) {
    const cleaned = decodeBasicEntities(m[1]).replace(/[^\d+()\s.-]/g, '').trim();
    if (cleaned.replace(/\D/g, '').length >= 7) {
      found.push(cleaned);
    }
  }

  // Match explicit international/formatted business phone lines near Tel/Phone cues
  const phoneCueRegex = /(?:tel|telephone|phone|call|fax)\s*[:.]?\s*(\+?\d[\d\s().-]{6,18}\d)/gi;
  for (const m of visibleText.matchAll(phoneCueRegex)) {
    const candidate = m[1].trim();
    const digits = candidate.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) {
      found.push(candidate);
    }
  }

  return Array.from(new Set(found)).slice(0, 5);
}

function parseJsonLdOrganizations(html: string): Array<Record<string, any>> {
  const blocks: Array<Record<string, any>> = [];
  const matches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.['@graph'])
        ? parsed['@graph']
        : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const typeStr = String(item['@type'] || '').toLowerCase();
        if (
          typeStr.includes('organization') ||
          typeStr.includes('corporation') ||
          typeStr.includes('localbusiness') ||
          typeStr.includes('store') ||
          typeStr.includes('company')
        ) {
          blocks.push(item);
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }
  return blocks;
}

function formatJsonLdAddress(addr: any): string | undefined {
  if (!addr) return undefined;
  if (typeof addr === 'string') return addr.trim() || undefined;
  if (typeof addr !== 'object') return undefined;
  const parts = [
    addr.streetAddress,
    addr.addressLocality,
    addr.addressRegion,
    addr.postalCode,
    typeof addr.addressCountry === 'string' ? addr.addressCountry : addr.addressCountry?.name,
  ]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function extractAddressTags(html: string): string[] {
  const results: string[] = [];
  for (const m of html.matchAll(/<address\b[^>]*>([\s\S]*?)<\/address>/gi)) {
    const txt = stripHtmlToVisibleText(m[1]).replace(/\n+/g, ', ').trim();
    if (txt.length >= 10 && txt.length <= 260) {
      results.push(txt);
    }
  }
  return results;
}

function extractProductsServices(html: string, pageType: CompanyPageType): string[] {
  const items: string[] = [];
  // Extract headings & concise list items from products/services pages or relevant sections
  const listMatches =
    pageType === 'products'
      ? html.matchAll(/<(?:h[2-4]|li)\b[^>]*>([\s\S]{3,140}?)<\/(?:h[2-4]|li)>/gi)
      : html.matchAll(/<h[2-3]\b[^>]*>([\s\S]{3,120}?)<\/h[2-3]>/gi);

  for (const m of listMatches) {
    const clean = stripHtmlToVisibleText(m[1]).replace(/\s+/g, ' ').trim();
    if (
      clean.length >= 4 &&
      clean.length <= 90 &&
      !/^(home|about|contact|menu|login|sign in|privacy|terms|cookie|copyright)/i.test(clean)
    ) {
      items.push(clean);
    }
    if (items.length >= 15) break;
  }
  return Array.from(new Set(items)).slice(0, 10);
}

function classifyInternalLink(
  href: string,
  anchorText: string,
  baseUrl: URL
): { url: string; pageType: Exclude<CompanyPageType, 'homepage'>; priority: number } | null {
  try {
    const resolved = new URL(href, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    if (!sameRegistrableAlias(resolved.hostname, baseUrl.hostname)) return null;
    resolved.hash = '';
    const fullStr = resolved.toString();
    if (fullStr.replace(/\/$/, '') === baseUrl.toString().replace(/\/$/, '')) return null;
    const pathLower = resolved.pathname.toLowerCase();
    if (SKIP_PATH_PATTERNS.some((re) => re.test(pathLower))) return null;

    const combo = `${pathLower} ${anchorText.toLowerCase()}`;
    if (/(?:^|\/|-)(?:contact|contact-us|get-in-touch|kontakt|reach-us)\b/.test(combo)) {
      return { url: fullStr, pageType: 'contact', priority: 100 };
    }
    if (/(?:^|\/|-)(?:about|about-us|company|company-profile|who-we-are|om-oss|a-propos|uber-uns)\b/.test(combo)) {
      return { url: fullStr, pageType: 'about', priority: 90 };
    }
    if (/(?:^|\/|-)(?:products|services|solutions|offerings|capabilities|what-we-do|produkte)\b/.test(combo)) {
      return { url: fullStr, pageType: 'products', priority: 85 };
    }
    if (/(?:^|\/|-)(?:locations|offices|branches|global-presence|where-we-operate)\b/.test(combo)) {
      return { url: fullStr, pageType: 'locations', priority: 80 };
    }
    if (/(?:^|\/|-)(?:imprint|impressum|legal-notice|legal|corporate-info)\b/.test(combo)) {
      return { url: fullStr, pageType: 'imprint', priority: 75 };
    }
    return null;
  } catch {
    return null;
  }
}

function parseRobotsDisallow(robotsText: string, userAgent: string): string[] {
  const lines = robotsText.split(/\r?\n/);
  let applies = false;
  const disallows: string[] = [];
  const uaLower = userAgent.toLowerCase();

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const directive = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (directive === 'user-agent') {
      const target = value.toLowerCase();
      applies = target === '*' || uaLower.includes(target);
    } else if (directive === 'disallow' && applies && value) {
      disallows.push(value);
    }
  }
  return disallows;
}

function isPathAllowedByRobots(pathname: string, disallows: string[]): boolean {
  for (const rule of disallows) {
    if (rule === '/') return false;
    if (rule && pathname.startsWith(rule)) return false;
  }
  return true;
}

export async function inspectWebsite(
  rawUrl: string,
  testHooks?: InspectWebsiteOptions
): Promise<WebInspectionResult> {
  const result: WebInspectionResult = {
    url: rawUrl,
    domain: '',
    isOnline: false,
    isHttps: false,
    emailsFound: [],
    phonesFound: [],
    socialLinks: {},
    pagesVisited: [],
    pageExcerpts: [],
    attributeProvenance: {},
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

  const userAgent =
    testHooks?.userAgent || 'Mozilla/5.0 (compatible; GlobalLeadBot/1.0; +https://internal-pipeline.local)';
  const maxBytesPerPage = testHooks?.maxBytes ?? 300 * 1024;
  const maxPages = Math.max(1, Math.min(6, testHooks?.maxPages ?? 5));
  const provenance: Record<string, AttributeProvenanceEntry> = {};

  const recordProvenance = (
    key: string,
    value: string | undefined,
    pageUrl: string,
    retrievedAt: string,
    method: string
  ) => {
    if (!value || !value.trim()) return;
    if (!provenance[key]) {
      provenance[key] = {
        attribute: key,
        value: value.trim().slice(0, 240),
        sourceType: 'official_website',
        sourceName: 'Safe Website Inspector',
        sourceUrl: pageUrl,
        retrievedAt,
        connectorId: 'conn-web-inspector',
        method,
      };
    }
  };

  const start = Date.now();
  try {
    const homeFetched = await fetchWithSsrfProtection(preCheck.url.toString(), {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml',
      },
      timeoutMs: 6000,
      maxRedirects: 3,
      maxBytes: maxBytesPerPage,
      dnsLookupAll: testHooks?.dnsLookupAll,
      fetchFn: testHooks?.fetchFn,
    });

    const homeRetrievedAt = new Date().toISOString();
    result.serverLatencyMs = Date.now() - start;
    result.httpStatus = homeFetched.response.status;
    result.isOnline = homeFetched.response.ok;
    result.domain = homeFetched.finalUrl.hostname.replace(/^www\./, '');
    result.isHttps = homeFetched.finalUrl.protocol === 'https:';
    result.securityCheck = {
      passed: true,
      ipResolved: homeFetched.resolvedIps[0] || preCheck.resolvedIps?.[0],
    };

    if (!homeFetched.response.ok) {
      return result;
    }

    // Optional robots.txt check when explicitly requested or enabled
    let robotsDisallows: string[] = [];
    if (testHooks?.checkRobots) {
      try {
        const robotsUrl = new URL('/robots.txt', homeFetched.finalUrl).toString();
        const robotsRes = await fetchWithSsrfProtection(robotsUrl, {
          headers: { 'User-Agent': userAgent, Accept: 'text/plain' },
          timeoutMs: 2500,
          maxRedirects: 1,
          maxBytes: 32 * 1024,
          dnsLookupAll: testHooks?.dnsLookupAll,
          fetchFn: testHooks?.fetchFn,
        });
        if (robotsRes.response.ok && robotsRes.bodyText) {
          robotsDisallows = parseRobotsDisallow(robotsRes.bodyText, userAgent);
        }
      } catch {
        // Treat missing/unreachable robots.txt as allowed
      }
    }

    const emailsSet = new Set<string>();
    const phonesSet = new Set<string>();
    const addressesSet = new Set<string>();
    const productsSet = new Set<string>();
    const locationsSet = new Set<string>();
    const operatingSnippets: string[] = [];

    const parsePage = (
      htmlChunk: string,
      pageUrl: string,
      pageType: CompanyPageType,
      httpStatus: number,
      retrievedAt: string
    ) => {
      const safeHtml = htmlChunk.slice(0, maxBytesPerPage);
      const visibleText = stripHtmlToVisibleText(safeHtml);
      result.pagesVisited!.push(pageUrl);

      const titleMatch = safeHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pageTitle = titleMatch?.[1]?.trim().replace(/\s+/g, ' ');
      if (pageType === 'homepage' && pageTitle) {
        result.title = pageTitle;
        recordProvenance('websiteTitle', pageTitle, pageUrl, retrievedAt, 'html_title');
      }

      const ogSiteMatch =
        safeHtml.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i) ||
        safeHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
      if (pageType === 'homepage' && ogSiteMatch?.[1] && !result.businessName) {
        result.businessName = decodeBasicEntities(ogSiteMatch[1].trim());
        recordProvenance('businessName', result.businessName, pageUrl, retrievedAt, 'meta_og_site_name');
      }

      const descMatch =
        safeHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
        safeHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
      if (descMatch?.[1] && (!result.description || pageType === 'about')) {
        const desc = decodeBasicEntities(descMatch[1].trim());
        if (!result.description) {
          result.description = desc;
          recordProvenance('description', desc, pageUrl, retrievedAt, 'meta_description');
        }
      }

      // JSON-LD Organization / LocalBusiness structured data
      const jsonLds = parseJsonLdOrganizations(safeHtml);
      for (const org of jsonLds) {
        if (typeof org.name === 'string' && org.name.trim() && !result.businessName) {
          result.businessName = org.name.trim();
          recordProvenance('businessName', result.businessName, pageUrl, retrievedAt, 'json_ld');
        }
        if (typeof org.description === 'string' && org.description.trim() && !result.description) {
          result.description = org.description.trim();
          recordProvenance('description', result.description, pageUrl, retrievedAt, 'json_ld');
        }
        if (typeof org.industry === 'string' && org.industry.trim() && !result.industry) {
          result.industry = org.industry.trim();
          recordProvenance('industry', result.industry, pageUrl, retrievedAt, 'json_ld');
        }
        if (typeof org.email === 'string' && org.email.trim()) {
          const cleanMail = org.email.replace(/^mailto:/i, '').trim();
          if (isGeneralBusinessEmail(cleanMail)) {
            emailsSet.add(cleanMail);
            recordProvenance('email', cleanMail, pageUrl, retrievedAt, 'json_ld');
          }
        }
        if (typeof org.telephone === 'string' && org.telephone.trim()) {
          phonesSet.add(org.telephone.trim());
          recordProvenance('phone', org.telephone.trim(), pageUrl, retrievedAt, 'json_ld');
        }
        const addrStr = formatJsonLdAddress(org.address);
        if (addrStr) {
          addressesSet.add(addrStr);
          recordProvenance('address', addrStr, pageUrl, retrievedAt, 'json_ld');
        }
        if (typeof org.openingHours === 'string' || Array.isArray(org.openingHours)) {
          const hours = Array.isArray(org.openingHours) ? org.openingHours.join('; ') : org.openingHours;
          if (hours.trim()) {
            operatingSnippets.push(`Hours: ${hours.trim()}`);
            recordProvenance('operatingInfo', hours.trim(), pageUrl, retrievedAt, 'json_ld');
          }
        }
        if (typeof org.foundingDate === 'string' && org.foundingDate.trim()) {
          operatingSnippets.push(`Founded: ${org.foundingDate.trim()}`);
        }
        if (Array.isArray(org.areaServed)) {
          for (const area of org.areaServed) {
            const areaName = typeof area === 'string' ? area : area?.name;
            if (typeof areaName === 'string' && areaName.trim()) {
              locationsSet.add(areaName.trim());
              recordProvenance('locationsServed', areaName.trim(), pageUrl, retrievedAt, 'json_ld');
            }
          }
        } else if (typeof org.areaServed === 'string' && org.areaServed.trim()) {
          locationsSet.add(org.areaServed.trim());
          recordProvenance('locationsServed', org.areaServed.trim(), pageUrl, retrievedAt, 'json_ld');
        }
      }

      // Emails
      for (const email of extractValidEmails(safeHtml)) {
        emailsSet.add(email);
        recordProvenance('email', email, pageUrl, retrievedAt, 'html_email');
      }

      // Phones
      for (const phone of extractBusinessPhones(safeHtml, visibleText)) {
        phonesSet.add(phone);
        recordProvenance('phone', phone, pageUrl, retrievedAt, 'html_phone');
      }

      // Addresses
      for (const addr of extractAddressTags(safeHtml)) {
        addressesSet.add(addr);
        recordProvenance('address', addr, pageUrl, retrievedAt, 'html_address_tag');
      }

      // Products / services
      if (pageType === 'products' || pageType === 'homepage') {
        for (const p of extractProductsServices(safeHtml, pageType)) {
          productsSet.add(p);
          recordProvenance('productsServices', p, pageUrl, retrievedAt, 'html_section');
        }
      }

      // Locations served hints on Locations page
      if (pageType === 'locations') {
        for (const h of extractProductsServices(safeHtml, 'products').slice(0, 6)) {
          locationsSet.add(h);
          recordProvenance('locationsServed', h, pageUrl, retrievedAt, 'locations_page');
        }
      }

      // Explicit business hours / operating schedule when published on homepage or contact page
      if (pageType === 'contact' || pageType === 'homepage' || pageType === 'imprint') {
        const hoursMatch = visibleText.match(
          /\b(?:Mon(?:day)?(?:\s*[-–to]+\s*Fri(?:day)?|[-–]Sun(?:day)?)?|Opening\s*Hours|Business\s*Hours|Hours)\s*[:\-–]?\s*[^\n]{0,60}\b\d{1,2}:\d{2}\s*[-–to]+\s*\d{1,2}:\d{2}(?:\s*[A-Z]{2,4})?/i
        );
        if (hoursMatch?.[0]) {
          const cleanedHours = hoursMatch[0].replace(/\s+/g, ' ').trim();
          operatingSnippets.push(cleanedHours);
          recordProvenance('operatingInfo', cleanedHours, pageUrl, retrievedAt, 'html_hours');
        }
      }

      // Social Links
      const linkedinMatch = safeHtml.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|school)\/[a-zA-Z0-9_-]+/i)
        || safeHtml.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_-]+/i);
      if (linkedinMatch && !result.socialLinks.linkedin) {
        result.socialLinks.linkedin = linkedinMatch[0];
        recordProvenance('socialLinks.linkedin', linkedinMatch[0], pageUrl, retrievedAt, 'html_link');
      }

      const facebookMatch = safeHtml.match(/https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9_.-]+/i);
      if (facebookMatch && !facebookMatch[0].includes('sharer') && !result.socialLinks.facebook) {
        result.socialLinks.facebook = facebookMatch[0];
        recordProvenance('socialLinks.facebook', facebookMatch[0], pageUrl, retrievedAt, 'html_link');
      }

      const instagramMatch = safeHtml.match(/https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.-]+/i);
      if (instagramMatch && !result.socialLinks.instagram) {
        result.socialLinks.instagram = instagramMatch[0];
        recordProvenance('socialLinks.instagram', instagramMatch[0], pageUrl, retrievedAt, 'html_link');
      }

      const twitterMatch = safeHtml.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/i);
      if (twitterMatch && !twitterMatch[0].includes('intent') && !result.socialLinks.twitter) {
        result.socialLinks.twitter = twitterMatch[0];
        recordProvenance('socialLinks.twitter', twitterMatch[0], pageUrl, retrievedAt, 'html_link');
      }

      const ytMatch = safeHtml.match(/https?:\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/)[a-zA-Z0-9_-]+/i);
      if (ytMatch && !result.socialLinks.youtube) {
        result.socialLinks.youtube = ytMatch[0];
        recordProvenance('socialLinks.youtube', ytMatch[0], pageUrl, retrievedAt, 'html_link');
      }

      const ghMatch = safeHtml.match(/https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_-]+/i);
      if (ghMatch && !result.socialLinks.github) {
        result.socialLinks.github = ghMatch[0];
        recordProvenance('socialLinks.github', ghMatch[0], pageUrl, retrievedAt, 'html_link');
      }

      result.pageExcerpts!.push({
        url: pageUrl,
        pageType,
        title: pageTitle,
        httpStatus,
        retrievedAt,
        textExcerpt: visibleText.slice(0, 2500),
      });
    };

    // Parse Homepage
    const homeUrlStr = homeFetched.finalUrl.toString();
    parsePage(homeFetched.bodyText, homeUrlStr, 'homepage', homeFetched.response.status, homeRetrievedAt);

    // Discover & prioritize internal company pages (About, Products/Services, Contact, Locations, Imprint)
    if (maxPages > 1) {
      const candidateLinks = new Map<string, { url: string; pageType: Exclude<CompanyPageType, 'homepage'>; priority: number }>();
      const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      for (const m of homeFetched.bodyText.slice(0, maxBytesPerPage).matchAll(anchorRegex)) {
        const anchorText = stripHtmlToVisibleText(m[2]).slice(0, 80);
        const classified = classifyInternalLink(m[1], anchorText, homeFetched.finalUrl);
        if (!classified) continue;
        if (robotsDisallows.length > 0 && !isPathAllowedByRobots(new URL(classified.url).pathname, robotsDisallows)) {
          continue;
        }
        const existingForType = candidateLinks.get(classified.pageType);
        if (!existingForType || classified.priority > existingForType.priority) {
          candidateLinks.set(classified.pageType, classified);
        }
      }

      const orderedTargets = Array.from(candidateLinks.values())
        .sort((a, b) => b.priority - a.priority)
        .slice(0, maxPages - 1);

      for (const target of orderedTargets) {
        if (target.pageType === 'about') result.aboutPageUrl = target.url;
        if (target.pageType === 'products') result.productsPageUrl = target.url;
        if (target.pageType === 'contact') result.contactPageUrl = target.url;
        if (target.pageType === 'locations') result.locationsPageUrl = target.url;
        if (target.pageType === 'imprint') result.imprintPageUrl = target.url;

        try {
          const subFetched = await fetchWithSsrfProtection(target.url, {
            headers: {
              'User-Agent': userAgent,
              Accept: 'text/html,application/xhtml+xml',
            },
            timeoutMs: 4500,
            maxRedirects: 2,
            maxBytes: maxBytesPerPage,
            dnsLookupAll: testHooks?.dnsLookupAll,
            fetchFn: testHooks?.fetchFn,
          });
          if (subFetched.response.ok && subFetched.bodyText) {
            parsePage(
              subFetched.bodyText,
              subFetched.finalUrl.toString(),
              target.pageType,
              subFetched.response.status,
              new Date().toISOString()
            );
          }
        } catch {
          // Skip subpages blocked by SSRF, timeout, or HTTP failure while preserving homepage findings
        }
      }
    }

    if (!result.businessName && result.title) {
      result.businessName = result.title.split(/\s+(?:\||—|–|::)\s+/)[0]?.trim() || result.title;
      recordProvenance('businessName', result.businessName, homeUrlStr, homeRetrievedAt, 'html_title');
    }

    result.emailsFound = Array.from(emailsSet).slice(0, 6);
    result.phonesFound = Array.from(phonesSet).slice(0, 5);
    result.addressesFound = Array.from(addressesSet).slice(0, 4);
    result.productsServices = Array.from(productsSet).slice(0, 10);
    result.locationsServed = Array.from(locationsSet).slice(0, 10);
    if (operatingSnippets.length > 0) {
      result.operatingInfo = Array.from(new Set(operatingSnippets)).join(' · ').slice(0, 240);
    }
    result.attributeProvenance = provenance;

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
