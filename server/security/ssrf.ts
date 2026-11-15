import dns from 'dns/promises';
import type dnsTypes from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { recordSecurityEvent } from './securityEvents.js';

export interface DnsAddressRecord {
  address: string;
  family: number;
}

export type DnsLookupAllFn = (hostname: string) => Promise<DnsAddressRecord[]>;

export interface SsrfValidationResult {
  allowed: boolean;
  url?: URL;
  resolvedIps?: string[];
  resolvedRecords?: DnsAddressRecord[];
  reason?: string;
}

export type PinnedLookupFn = (
  hostname: string,
  options: dnsTypes.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dnsTypes.LookupAddress[], family?: number) => void
) => void;

const INTERNAL_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
  '100.100.100.200',
]);

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa'];

function parseIpv4Int(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    num = ((num << 8) | n) >>> 0;
  }
  return num;
}

function isDisallowedIpv4Int(n: number): boolean {
  const b0 = (n >>> 24) & 0xff;
  const b1 = (n >>> 16) & 0xff;
  const b2 = (n >>> 8) & 0xff;

  if (b0 === 0) return true; // 0.0.0.0/8 ("this" network)
  if (b0 === 10) return true; // 10.0.0.0/8 (RFC1918)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (b0 === 127) return true; // 127.0.0.0/8 (Loopback)
  if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 (Link-local & Cloud Metadata)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12 (RFC1918)
  if (b0 === 192 && b1 === 0 && b2 === 0) return true; // 192.0.0.0/24 (IETF Protocol)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16 (RFC1918)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true; // 198.18.0.0/15 (Benchmarking)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (b0 >= 224) return true; // 224.0.0.0/4 Multicast & 240.0.0.0/4 Reserved/Broadcast
  return false;
}

function expandIpv6Groups(raw: string): number[] | null {
  const withoutZone = raw.split('%')[0].toLowerCase();
  if (!withoutZone) return null;

  // Handle embedded IPv4 dotted suffix like ::ffff:127.0.0.1
  let working = withoutZone;
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const ipv4Part = working.slice(lastColon + 1);
    const v4Int = parseIpv4Int(ipv4Part);
    if (v4Int === null) return null;
    const hi = ((v4Int >>> 16) & 0xffff).toString(16);
    const lo = (v4Int & 0xffff).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const doubleColonParts = working.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSegmentList = (seg: string): number[] | null => {
    if (!seg) return [];
    const parts = seg.split(':');
    const out: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };

  if (doubleColonParts.length === 1) {
    const groups = parseSegmentList(doubleColonParts[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const head = parseSegmentList(doubleColonParts[0]);
  const tail = parseSegmentList(doubleColonParts[1]);
  if (!head || !tail) return null;
  const missing = 8 - (head.length + tail.length);
  if (missing < 1) return null;
  return [...head, ...new Array(missing).fill(0), ...tail];
}

export function isDisallowedIpAddress(ip: string): boolean {
  const cleaned = String(ip || '')
    .trim()
    .replace(/^\[|\]$/g, '');
  if (!cleaned) return true;

  const family = net.isIP(cleaned);
  if (family === 4) {
    const v4 = parseIpv4Int(cleaned);
    return v4 === null || isDisallowedIpv4Int(v4);
  }

  if (family === 6) {
    const groups = expandIpv6Groups(cleaned);
    if (!groups) return true;

    const allZero = groups.every((g) => g === 0);
    if (allZero) return true; // ::/128 unspecified

    const isLoopback = groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
    if (isLoopback) return true; // ::1/128

    // IPv4-mapped IPv6 ::ffff:0:0/96 or IPv4-compatible ::/96
    const isV4Mapped =
      groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
    const isV4Compat =
      groups.slice(0, 6).every((g) => g === 0) && !(groups[6] === 0 && groups[7] <= 1);
    if (isV4Mapped || isV4Compat) {
      const v4Int = (((groups[6] << 16) | groups[7]) >>> 0);
      return isDisallowedIpv4Int(v4Int);
    }

    // 64:ff9b::/96 (NAT64) or 64:ff9b:1::/48
    if (groups[0] === 0x0064 && groups[1] === 0xff9b) return true;

    // fc00::/7 Unique Local IPv6 (fc00..fdff)
    if ((groups[0] & 0xfe00) === 0xfc00) return true;

    // fe80::/10 Link-local IPv6 (fe80..febf)
    if ((groups[0] & 0xffc0) === 0xfe80) return true;

    // fec0::/10 Site-local (deprecated) & ff00::/8 Multicast
    if ((groups[0] & 0xffc0) === 0xfec0 || (groups[0] & 0xff00) === 0xff00) return true;

    // 100::/64 Discard-Only
    if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) {
      return true;
    }

    // 2001:db8::/32 Documentation
    if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;

    return false;
  }

  // Unrecognized IP literal fails closed
  return true;
}

export function isDisallowedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!lower) return true;
  if (INTERNAL_HOSTNAMES.has(lower)) return true;
  if (INTERNAL_SUFFIXES.some((s) => lower.endsWith(s))) return true;
  if (net.isIP(lower)) {
    return isDisallowedIpAddress(lower);
  }
  return false;
}

export async function defaultDnsLookupAll(hostname: string): Promise<DnsAddressRecord[]> {
  const clean = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(clean)) {
    return [{ address: clean, family: net.isIP(clean) }];
  }
  const results = await dns.lookup(clean, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
}

export async function validateOutboundUrl(
  rawUrl: string,
  options?: { dnsLookupAll?: DnsLookupAllFn; allowStandardPortsOnly?: boolean }
): Promise<SsrfValidationResult> {
  let targetUrl: URL;
  try {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) {
      return { allowed: false, reason: 'Empty URL' };
    }
    const formatted =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;
    targetUrl = new URL(formatted);
  } catch {
    return { allowed: false, reason: 'Malformed URL scheme' };
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return { allowed: false, reason: 'Invalid protocol. Only HTTP/HTTPS allowed' };
  }

  if (targetUrl.username || targetUrl.password) {
    return { allowed: false, reason: 'Embedded credentials prohibited' };
  }

  const allowStandardPortsOnly = options?.allowStandardPortsOnly !== false;
  if (allowStandardPortsOnly && targetUrl.port) {
    const portNum = Number(targetUrl.port);
    if (portNum !== 80 && portNum !== 443) {
      recordSecurityEvent({
        category: 'ssrf_blocked',
        severity: 'warning',
        summary: `Blocked non-standard outbound port ${targetUrl.port} for ${targetUrl.hostname}`,
      });
      return { allowed: false, reason: `Non-standard outbound port ${targetUrl.port} is prohibited` };
    }
  }

  const cleanHost = targetUrl.hostname.replace(/^\[|\]$/g, '');
  if (isDisallowedHostname(cleanHost)) {
    recordSecurityEvent({
      category: 'ssrf_blocked',
      severity: 'high',
      summary: `Blocked internal/private host target: ${cleanHost}`,
    });
    return {
      allowed: false,
      reason: `Hostname "${cleanHost}" resolves to a protected internal network (SSRF blocked)`,
    };
  }

  const lookupFn = options?.dnsLookupAll || defaultDnsLookupAll;
  try {
    const records = await lookupFn(cleanHost);
    if (!records || records.length === 0) {
      return { allowed: false, reason: `DNS lookup returned no addresses for ${cleanHost}` };
    }

    const resolvedIps = records.map((r) => r.address);
    for (const rec of records) {
      if (isDisallowedIpAddress(rec.address)) {
        recordSecurityEvent({
          category: 'ssrf_blocked',
          severity: 'high',
          summary: `Blocked SSRF target IP ${rec.address} for host ${cleanHost}`,
        });
        return {
          allowed: false,
          resolvedIps,
          reason: `Target IP ${rec.address} resolved to protected/private network (SSRF blocked)`,
        };
      }
    }

    return { allowed: true, url: targetUrl, resolvedIps, resolvedRecords: records };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { allowed: false, reason: `DNS lookup failed for hostname: ${msg}` };
  }
}

export function createPinnedLookup(
  expectedHostname: string,
  pinnedRecords: DnsAddressRecord[]
): PinnedLookupFn {
  const normalizedExpected = expectedHostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  const safeRecords = pinnedRecords.filter((rec) => !isDisallowedIpAddress(rec.address));
  if (safeRecords.length === 0) {
    throw new SsrfBlockedError(`No safe public IP addresses available to pin for ${normalizedExpected}`);
  }

  return (hostname, opts, callback) => {
    const reqHost = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    if (reqHost !== normalizedExpected) {
      callback(
        new SsrfBlockedError(`Pinned DNS lookup rejected unexpected host "${reqHost}"`) as NodeJS.ErrnoException,
        '',
        4
      );
      return;
    }

    const familyFilter = typeof opts === 'object' && opts ? Number(opts.family) || 0 : 0;
    const matching = familyFilter ? safeRecords.filter((r) => r.family === familyFilter) : safeRecords;
    const chosen = matching.length > 0 ? matching : safeRecords;

    if (typeof opts === 'object' && opts && opts.all) {
      callback(
        null,
        chosen.map((r) => ({ address: r.address, family: r.family }))
      );
      return;
    }

    callback(null, chosen[0].address, chosen[0].family);
  };
}

async function requestWithPinnedDns(
  targetUrl: URL,
  pinnedRecords: DnsAddressRecord[],
  options: {
    headers?: Record<string, string>;
    timeoutMs: number;
    maxBytes: number;
  }
): Promise<{
  response: globalThis.Response;
  bodyText: string;
  truncated: boolean;
}> {
  const isHttps = targetUrl.protocol === 'https:';
  const cleanHost = targetUrl.hostname.replace(/^\[|\]$/g, '');
  const lookup = createPinnedLookup(cleanHost, pinnedRecords);
  const port = targetUrl.port ? Number(targetUrl.port) : isHttps ? 443 : 80;
  const pathWithQuery = `${targetUrl.pathname || '/'}${targetUrl.search || ''}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let deliberatelyClosed = false;
    let truncated = false;
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const finishResolve = (
      status: number,
      statusText: string,
      rawHeaders: http.IncomingHttpHeaders,
      bodyText: string
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const headers = new Headers();
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (!k || v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, String(item));
        } else {
          headers.set(k, String(v));
        }
      }

      // 304/204/3xx statuses don't need body in Response wrapper; bodyText carries bounded content
      const response = new Response(null, { status, statusText, headers });
      resolve({ response, bodyText, truncated });
    };

    const finishReject = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    const reqOptions: https.RequestOptions = {
      protocol: targetUrl.protocol,
      hostname: cleanHost,
      port,
      path: pathWithQuery,
      method: 'GET',
      headers: options.headers,
      agent: false,
      lookup: lookup as any,
      ...(isHttps
        ? {
            rejectUnauthorized: true,
            servername: net.isIP(cleanHost) ? undefined : cleanHost,
          }
        : {}),
    };

    const transport = isHttps ? https : http;
    const req = transport.request(reqOptions, (res) => {
      const status = res.statusCode || 0;
      const statusText = res.statusMessage || '';

      if (status >= 300 && status < 400) {
        deliberatelyClosed = true;
        res.resume();
        req.destroy();
        finishResolve(status, statusText, res.headers, '');
        return;
      }

      if (status < 200 || status >= 300) {
        deliberatelyClosed = true;
        res.resume();
        req.destroy();
        finishResolve(status, statusText, res.headers, '');
        return;
      }

      res.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (totalBytes + buf.length > options.maxBytes) {
          const remaining = options.maxBytes - totalBytes;
          if (remaining > 0) {
            chunks.push(buf.subarray(0, remaining));
            totalBytes += remaining;
          }
          truncated = true;
          deliberatelyClosed = true;
          res.destroy();
          req.destroy();
          finishResolve(status, statusText, res.headers, Buffer.concat(chunks).toString('utf8'));
          return;
        }
        chunks.push(buf);
        totalBytes += buf.length;
      });

      res.on('end', () => {
        finishResolve(status, statusText, res.headers, Buffer.concat(chunks).toString('utf8'));
      });

      res.on('error', (err) => {
        if (deliberatelyClosed) {
          finishResolve(status, statusText, res.headers, Buffer.concat(chunks).toString('utf8'));
          return;
        }
        finishReject(err);
      });
    });

    const timer = setTimeout(() => {
      const timeoutErr = new Error(`Outbound request timed out after ${options.timeoutMs}ms`);
      req.destroy(timeoutErr);
      finishReject(timeoutErr);
    }, options.timeoutMs);

    req.on('error', (err) => {
      if (deliberatelyClosed) return;
      finishReject(err);
    });

    req.end();
  });
}

export async function readBoundedResponseText(
  response: globalThis.Response,
  maxBytes = 350 * 1024
): Promise<{ text: string; truncated: boolean; bytesRead: number }> {
  if (!response.body) {
    const fallback = await response.text();
    const buf = Buffer.from(fallback, 'utf8');
    if (buf.length > maxBytes) {
      return { text: buf.subarray(0, maxBytes).toString('utf8'), truncated: true, bytesRead: maxBytes };
    }
    return { text: fallback, truncated: false, bytesRead: buf.length };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      if (total + value.byteLength > maxBytes) {
        const remaining = maxBytes - total;
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
          total += remaining;
        }
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }

      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'),
    truncated,
    bytesRead: total,
  };
}

export async function fetchWithSsrfProtection(
  rawUrl: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxRedirects?: number;
    maxBytes?: number;
    dnsLookupAll?: DnsLookupAllFn;
    fetchFn?: typeof fetch;
  }
): Promise<{
  response: globalThis.Response;
  finalUrl: URL;
  resolvedIps: string[];
  bodyText: string;
  truncated: boolean;
}> {
  const maxRedirects = options?.maxRedirects ?? 3;
  const timeoutMs = options?.timeoutMs ?? 6000;
  const maxBytes = options?.maxBytes ?? 350 * 1024;
  const customFetchFn = options?.fetchFn;

  let currentUrl = rawUrl;
  let hops = 0;

  while (true) {
    const validation = await validateOutboundUrl(currentUrl, {
      dnsLookupAll: options?.dnsLookupAll,
      allowStandardPortsOnly: true,
    });
    if (!validation.allowed || !validation.url) {
      throw new SsrfBlockedError(validation.reason || 'Outbound request blocked by SSRF guard', validation.resolvedIps?.[0]);
    }

    let response: globalThis.Response;
    let bodyText = '';
    let truncated = false;

    if (customFetchFn) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await customFetchFn(validation.url.toString(), {
          method: 'GET',
          headers: options?.headers,
          signal: controller.signal,
          redirect: 'manual',
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel?.().catch(() => {});
        if (!location) {
          throw new Error(`HTTP ${response.status} redirect missing Location header`);
        }
        if (hops >= maxRedirects) {
          recordSecurityEvent({
            category: 'ssrf_blocked',
            severity: 'warning',
            summary: `Blocked outbound redirect chain exceeding ${maxRedirects} hops`,
          });
          throw new SsrfBlockedError(`Exceeded maximum allowed redirects (${maxRedirects})`, validation.resolvedIps?.[0]);
        }
        const nextUrl = new URL(location, validation.url);
        currentUrl = nextUrl.toString();
        hops += 1;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        return {
          response,
          finalUrl: validation.url,
          resolvedIps: validation.resolvedIps || [],
          bodyText: '',
          truncated: false,
        };
      }

      const bounded = await readBoundedResponseText(response, maxBytes);
      bodyText = bounded.text;
      truncated = bounded.truncated;
    } else {
      const pinnedRecords =
        validation.resolvedRecords && validation.resolvedRecords.length > 0
          ? validation.resolvedRecords
          : (validation.resolvedIps || []).map((ip) => ({ address: ip, family: net.isIP(ip) || 4 }));

      const pinnedResult = await requestWithPinnedDns(validation.url, pinnedRecords, {
        headers: options?.headers,
        timeoutMs,
        maxBytes,
      });
      response = pinnedResult.response;
      bodyText = pinnedResult.bodyText;
      truncated = pinnedResult.truncated;

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`HTTP ${response.status} redirect missing Location header`);
        }
        if (hops >= maxRedirects) {
          recordSecurityEvent({
            category: 'ssrf_blocked',
            severity: 'warning',
            summary: `Blocked outbound redirect chain exceeding ${maxRedirects} hops`,
          });
          throw new SsrfBlockedError(`Exceeded maximum allowed redirects (${maxRedirects})`, validation.resolvedIps?.[0]);
        }
        const nextUrl = new URL(location, validation.url);
        currentUrl = nextUrl.toString();
        hops += 1;
        continue;
      }

      if (!response.ok) {
        return {
          response,
          finalUrl: validation.url,
          resolvedIps: validation.resolvedIps || [],
          bodyText: '',
          truncated: false,
        };
      }
    }

    return {
      response,
      finalUrl: validation.url,
      resolvedIps: validation.resolvedIps || [],
      bodyText,
      truncated,
    };
  }
}

export function getSsrfRuntimeStatus() {
  const selfChecks = {
    loopbackV4Blocked: isDisallowedIpAddress('127.0.0.1'),
    metadataV4Blocked: isDisallowedIpAddress('169.254.169.254'),
    mappedV6Blocked: isDisallowedIpAddress('::ffff:127.0.0.1'),
    ulaV6Blocked: isDisallowedIpAddress('fc00::1'),
    publicV4Allowed: !isDisallowedIpAddress('93.184.216.34'),
  };
  return {
    dnsPinningEnabled: typeof createPinnedLookup === 'function',
    pinnedTransport: 'node_http_https_pinned_lookup',
    privateCidrsBlockedSelfTest: Object.values(selfChecks).every(Boolean),
    redirectRevalidationEnabled: true,
    maxRedirectsDefault: 3,
    maxResponseBytesDefault: 350 * 1024,
    standardPortsOnlyDefault: true,
  };
}

export class SsrfBlockedError extends Error {
  public readonly ipResolved?: string;
  constructor(message: string, ipResolved?: string) {
    super(message);
    this.name = 'SsrfBlockedError';
    this.ipResolved = ipResolved;
  }
}
