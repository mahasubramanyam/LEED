import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const CSRF_HEADER_NAME = 'x-leed-csrf-token';
const CSRF_COOKIE_NAME = 'leed_csrf';

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function setCsrfCookie(res: Response, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Frontend JavaScript needs to read this to attach to requests
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function validateCsrf(req: Request, res: Response, next: NextFunction): void {
  // Safe HTTP methods do not require CSRF validation
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Exempt public auth initialization & login endpoints
  const exemptPaths = ['/api/auth/setup', '/api/auth/login'];
  if (exemptPaths.includes(req.path)) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = (req.headers[CSRF_HEADER_NAME] || req.headers['x-csrf-token']) as string | undefined;

  // If request contains Bearer authorization in header, CSRF is not vulnerable because cross-origin form POSTs cannot forge custom headers
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

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
