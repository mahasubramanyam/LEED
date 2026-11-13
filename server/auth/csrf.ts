import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const CSRF_HEADER_NAME = 'x-leed-csrf-token';
const CSRF_COOKIE_NAME = 'leed_csrf';

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function setCsrfCookie(res: Response, token: string): void {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Frontend reads this to attach x-leed-csrf-token header
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  } as any);
}

function extractHostHeader(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const first = raw.split(',')[0]?.trim().toLowerCase();
  return first || null;
}

/**
 * Validates Origin/Referer headers against Host (and trusted proxy X-Forwarded-Host)
 * headers to block cross-origin requests even behind reverse proxies like Nginx/Cloud Run.
 */
export function validateSameOrigin(req: Request): boolean {
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  const host = extractHostHeader(req.headers['host']);

  if (!host) return true;

  const allowedHosts = new Set<string>([host]);

  const trustProxyEnabled = Boolean((req as any).app?.get?.('trust proxy'));
  const isLoopbackUpstreamHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const remoteAddr = req.socket?.remoteAddress || '';
  const isLoopbackRemote =
    remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';

  if (trustProxyEnabled || isLoopbackUpstreamHost || isLoopbackRemote) {
    const forwardedHost = extractHostHeader(req.headers['x-forwarded-host']);
    if (forwardedHost) {
      allowedHosts.add(forwardedHost);
    }
  }

  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (!allowedHosts.has(originHost)) return false;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const refererHost = new URL(referer).host.toLowerCase();
      if (!allowedHosts.has(refererHost)) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export function validateCsrf(req: Request, res: Response, next: NextFunction): void {
  // Safe HTTP methods do not require CSRF validation
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Cross-origin check
  if (!validateSameOrigin(req)) {
    res.status(403).json({
      error: 'Cross-origin request blocked.',
      code: 'CSRF_CROSS_ORIGIN',
    });
    return;
  }

  // If request contains Bearer authorization in header, standard CSRF does not apply (browsers cannot inject custom auth headers via cross-site form POST)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  // Exempt only login (since users might not have a session yet), but still enforce same-origin above
  if (req.path === '/api/auth/login') {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = (req.headers[CSRF_HEADER_NAME] || req.headers['x-csrf-token']) as string | undefined;

  if (!cookieToken || !headerToken) {
    res.status(403).json({
      error: 'CSRF token missing. Please refresh or provide X-LEED-CSRF-TOKEN header.',
      code: 'CSRF_MISSING',
    });
    return;
  }

  // Constant-time comparison
  const cookieBuf = Buffer.from(cookieToken);
  const headerBuf = Buffer.from(headerToken);

  if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
    res.status(403).json({
      error: 'Invalid CSRF token.',
      code: 'CSRF_INVALID',
    });
    return;
  }

  next();
}
