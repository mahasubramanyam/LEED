import { classifyHttpStatus, ConnectorError } from './errors.js';
import { DnsLookupAllFn, fetchWithSsrfProtection, SsrfBlockedError } from '../../security/ssrf.js';

export interface RegistryJsonRequestOptions {
  providerId: string;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
  knownSecrets?: string[];
  allowNotFound?: boolean;
  fetchFn?: typeof fetch;
  dnsLookupAll?: DnsLookupAllFn;
}

export interface RegistryJsonResponse<T> {
  status: number;
  notFound: boolean;
  data: T | null;
  headers: Headers;
  latencyMs: number;
  rateLimitRemaining?: number;
}

function parseRateLimitRemaining(headers: Headers): number | undefined {
  const candidates = [
    headers.get('x-ratelimit-remain'),
    headers.get('x-ratelimit-remaining'),
    headers.get('ratelimit-remaining'),
  ];
  for (const raw of candidates) {
    if (raw !== null && raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const sec = Number(raw);
  if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000);
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs) && dateMs > Date.now()) {
    return dateMs - Date.now();
  }
  return undefined;
}

/**
 * Shared SSRF-protected JSON client for international government registry adapters.
 * Enforces pinned DNS validation, bounded streaming, uniform HTTP status mapping,
 * secret redaction, and safe test injection hooks without bypassing SSRF rules.
 */
export async function executeRegistryJsonRequest<T = unknown>(
  options: RegistryJsonRequestOptions
): Promise<RegistryJsonResponse<T>> {
  const start = Date.now();
  const method = options.method === 'POST' ? 'POST' : 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': options.userAgent,
    ...(options.headers || {}),
  };

  let serializedBody: string | undefined;
  if (options.body !== undefined && method === 'POST') {
    serializedBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }

  try {
    const result = await fetchWithSsrfProtection(options.url, {
      method,
      headers,
      body: serializedBody,
      timeoutMs: options.timeoutMs ?? 8000,
      maxBytes: options.maxBytes ?? 350 * 1024,
      maxRedirects: 2,
      fetchFn: options.fetchFn,
      dnsLookupAll: options.dnsLookupAll,
    });

    const latencyMs = Date.now() - start;
    const status = result.response.status;
    const rateLimitRemaining = parseRateLimitRemaining(result.response.headers);

    if (status === 404 && options.allowNotFound) {
      return {
        status,
        notFound: true,
        data: null,
        headers: result.response.headers,
        latencyMs,
        rateLimitRemaining,
      };
    }

    if (!result.response.ok) {
      const classified = classifyHttpStatus(status);
      throw new ConnectorError({
        category: classified.category,
        providerId: options.providerId,
        httpStatus: status,
        retryable: classified.retryable,
        retryAfterMs: parseRetryAfterMs(result.response.headers),
        remediationHint: classified.remediationHint,
        knownSecrets: options.knownSecrets,
        message: `${options.providerId} returned HTTP ${status} ${result.response.statusText || ''}`.trim(),
      });
    }

    if (!result.bodyText || !result.bodyText.trim()) {
      return {
        status,
        notFound: false,
        data: null,
        headers: result.response.headers,
        latencyMs,
        rateLimitRemaining,
      };
    }

    try {
      const parsed = JSON.parse(result.bodyText) as T;
      return {
        status,
        notFound: false,
        data: parsed,
        headers: result.response.headers,
        latencyMs,
        rateLimitRemaining,
      };
    } catch {
      throw new ConnectorError({
        category: 'invalid_response',
        providerId: options.providerId,
        retryable: false,
        knownSecrets: options.knownSecrets,
        message: `${options.providerId} returned malformed JSON response`,
      });
    }
  } catch (err: unknown) {
    if (err instanceof ConnectorError) throw err;
    if (err instanceof SsrfBlockedError) {
      throw new ConnectorError({
        category: 'configuration_error',
        providerId: options.providerId,
        retryable: false,
        knownSecrets: options.knownSecrets,
        message: err.message,
      });
    }
    throw err;
  }
}
