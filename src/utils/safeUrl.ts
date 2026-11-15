/**
 * Sanitizes external URLs before rendering in <a href={...}> to prevent
 * stored/reflected XSS via javascript:, data:, vbscript:, or file: schemes.
 * Allows only explicit http: and https: URLs.
 */
export function sanitizeExternalUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;

  // Reject control characters or whitespace-obfuscated dangerous protocols
  const noControl = trimmed.replace(/[\u0000-\u001f\u007f]/g, '');
  if (!noControl) return undefined;

  // Explicitly block scheme-relative or dangerous URI schemes before parsing
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(noControl)) {
    try {
      const parsed = new URL(noControl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  // Reject protocol-relative //evil.com or whitespace-prefixed javascript:
  if (noControl.startsWith('//') || /^\s*javascript\s*:/i.test(noControl)) {
    return undefined;
  }

  // If a bare domain/path is stored (e.g. "acme.com"), coerce cleanly to https://
  if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/.*)?$/.test(noControl)) {
    try {
      const parsed = new URL(`https://${noControl}`);
      if (parsed.protocol === 'https:') return parsed.toString();
    } catch {
      return undefined;
    }
  }

  return undefined;
}
