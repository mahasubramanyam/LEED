import { Request, Response, NextFunction } from 'express';
import { validateSession, SESSION_DURATION_MS } from './session.js';
import { ownerService } from './ownerService.js';
import { OwnerUser } from './session.js';

export const SESSION_COOKIE_NAME = 'leed_session';

// Extend Express Request interface to include authenticated owner
declare global {
  namespace Express {
    interface Request {
      owner?: OwnerUser;
      sessionToken?: string;
    }
  }
}

export function setSessionCookie(res: Response, token: string): void {
  // Cross-origin iframe deployment in Google AI Studio requires SameSite=None, Secure, and Partitioned (CHIPS)
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
    maxAge: SESSION_DURATION_MS,
  } as any);
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
  } as any);
}

export async function requireOwnerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Extract token from HTTP-only cookie first, then fallback to Authorization header
  let rawToken: string | undefined = req.cookies?.[SESSION_COOKIE_NAME];

  if (!rawToken) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.substring(7).trim();
    }
  }

  if (!rawToken) {
    res.status(401).json({
      error: 'Authentication required. Please log in as owner.',
      code: 'UNAUTHORIZED',
    });
    return;
  }

  try {
    const session = await validateSession(rawToken);
    if (!session) {
      clearSessionCookie(res);
      res.status(401).json({
        error: 'Session expired or invalidated. Please log in again.',
        code: 'SESSION_EXPIRED',
      });
      return;
    }

    const owner = await ownerService.getOwnerBySession(session);
    if (!owner || !owner.isActive) {
      clearSessionCookie(res);
      res.status(403).json({
        error: 'Owner account is inactive or not found.',
        code: 'ACCOUNT_DISABLED',
      });
      return;
    }

    req.owner = owner;
    req.sessionToken = rawToken;
    next();
  } catch (err) {
    console.error('[Auth Middleware] Error verifying owner session:', err);
    res.status(500).json({
      error: 'Authentication verification encountered an internal error.',
      code: 'AUTH_INTERNAL_ERROR',
    });
  }
}
