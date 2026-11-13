import { ClassifiedConnectorError, ConnectorErrorCategory } from './types.js';

const RETRYABLE_CATEGORIES = new Set<ConnectorErrorCategory>([
  'timeout',
  'network_failure',
  'provider_unavailable',
]);

/**
 * Redacts potential secrets, API keys, Bearer/Basic headers, and DB credentials
 * from diagnostic strings before logging or returning to callers.
 */
export function redactSecrets(input: string, extraSecrets: string[] = []): string {
  if (!input) return '';
  let out = input;

  // Redact explicit extra secrets first (only if >= 6 chars to avoid corrupting normal words)
  for (const secret of extraSecrets) {
    const trimmed = secret?.trim();
    if (trimmed && trimmed.length >= 6) {
      out = out.split(trimmed).join('[REDACTED]');
    }
  }

  // Redact URL credentials (e.g. postgres://user:pass@host)
  out = out.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/g, '$1[REDACTED]$2');
  // Redact Basic / Bearer auth tokens
  out = out.replace(/(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 [REDACTED]');
  // Redact common query parameter secrets
  out = out.replace(/([?&](?:key|api_key|apikey|token|secret|guid|auth|password)=)[^&\s]+/gi, '$1[REDACTED]');
  // Redact known key prefixes (Google AIza, etc.)
  out = out.replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]');

  return out;
}

export class ConnectorError extends Error {
  public readonly category: ConnectorErrorCategory;
  public readonly providerId: string;
  public readonly httpStatus?: number;
  public readonly retryable: boolean;
  public readonly safeMessage: string;
  public readonly remediationHint?: string;
  public readonly retryAfterMs?: number;

  constructor(options: {
    category: ConnectorErrorCategory;
    providerId: string;
    message: string;
    httpStatus?: number;
    retryable?: boolean;
    remediationHint?: string;
    retryAfterMs?: number;
    knownSecrets?: string[];
  }) {
    const cleanMsg = redactSecrets(options.message, options.knownSecrets);
    super(cleanMsg);
    this.name = 'ConnectorError';
    this.category = options.category;
    this.providerId = options.providerId;
    this.httpStatus = options.httpStatus;
    this.retryable =
      options.retryable !== undefined
        ? options.retryable
        : RETRYABLE_CATEGORIES.has(options.category);
    this.safeMessage = cleanMsg;
    this.remediationHint = options.remediationHint;
    this.retryAfterMs = options.retryAfterMs;
  }

  public toClassified(): ClassifiedConnectorError {
    return {
      category: this.category,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      safeMessage: this.safeMessage,
      remediationHint: this.remediationHint,
    };
  }
}

export function isRetryableCategory(category: ConnectorErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category);
}

export function classifyHttpStatus(status: number): {
  category: ConnectorErrorCategory;
  retryable: boolean;
  remediationHint?: string;
} {
  if (status === 401) {
    return {
      category: 'authentication_failure',
      retryable: false,
      remediationHint: 'Verify API key or authentication credentials in Connector Settings.',
    };
  }
  if (status === 403) {
    return {
      category: 'authorization_failure',
      retryable: false,
      remediationHint: 'Credentials are valid but lack permission or quota for this resource.',
    };
  }
  if (status === 429) {
    return {
      category: 'rate_limited',
      retryable: false,
      remediationHint: 'Wait for the provider rate-limit window to reset before retrying.',
    };
  }
  if (status === 400 || status === 404 || status === 422) {
    return {
      category: 'invalid_request',
      retryable: false,
      remediationHint: 'Check search query, country code, or lookup identifier format.',
    };
  }
  if (status === 408 || status === 504) {
    return {
      category: 'timeout',
      retryable: true,
      remediationHint: 'Upstream provider timed out; retry or increase connector timeout.',
    };
  }
  if (status >= 500) {
    return {
      category: 'provider_unavailable',
      retryable: true,
      remediationHint: 'Upstream provider service returned a server error; retry shortly.',
    };
  }
  return {
    category: 'unknown_provider_error',
    retryable: false,
  };
}

export function classifyConnectorError(
  error: unknown,
  providerId: string,
  knownSecrets: string[] = []
): ClassifiedConnectorError {
  if (error instanceof ConnectorError) {
    return {
      category: error.category,
      httpStatus: error.httpStatus,
      retryable: error.retryable,
      safeMessage: redactSecrets(error.safeMessage, knownSecrets),
      remediationHint: error.remediationHint,
    };
  }

  const rawMsg = error instanceof Error ? error.message : String(error);
  const msg = redactSecrets(rawMsg, knownSecrets);
  const lower = msg.toLowerCase();
  const errName = error instanceof Error ? error.name : '';

  if (
    errName === 'AbortError' ||
    errName === 'TimeoutError' ||
    lower.includes('timed out') ||
    lower.includes('timeout') ||
    lower.includes('aborted')
  ) {
    return {
      category: 'timeout',
      retryable: true,
      safeMessage: msg || `${providerId} request timed out`,
      remediationHint: 'Increase connector timeout or verify upstream responsiveness.',
    };
  }

  if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed') ||
    lower.includes('network')
  ) {
    return {
      category: 'network_failure',
      retryable: true,
      safeMessage: msg,
      remediationHint: 'Check outbound network connectivity and DNS resolution.',
    };
  }

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key')) {
    return {
      category: 'authentication_failure',
      httpStatus: 401,
      retryable: false,
      safeMessage: msg,
      remediationHint: 'Check configured API key or authentication token.',
    };
  }

  if (lower.includes('403') || lower.includes('forbidden')) {
    return {
      category: 'authorization_failure',
      httpStatus: 403,
      retryable: false,
      safeMessage: msg,
    };
  }

  if (lower.includes('429') || lower.includes('rate limit')) {
    return {
      category: 'rate_limited',
      httpStatus: 429,
      retryable: false,
      safeMessage: msg,
    };
  }

  if (lower.includes('json') || lower.includes('unexpected token') || lower.includes('invalid response')) {
    return {
      category: 'invalid_response',
      retryable: false,
      safeMessage: msg,
    };
  }

  return {
    category: 'unknown_provider_error',
    retryable: false,
    safeMessage: msg || `Unexpected error from ${providerId}`,
  };
}
