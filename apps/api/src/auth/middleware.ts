import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../lib/http-error.js';
import { verifyAccessToken } from './tokens.js';

// Adds `req.userId` to Express's own Request type so route handlers stay clean.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Rejects the request unless a valid access token is present. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readBearer(req);
  if (!token) return next(unauthorized());
  req.userId = verifyAccessToken(token);
  next();
}

/**
 * Attaches the user when a valid token is present, but never fails the
 * request. Used by public reads that render extra state when signed in
 * (e.g. "did I already like this post").
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readBearer(req);
  if (token) {
    try {
      req.userId = verifyAccessToken(token);
    } catch {
      // ignore: an expired token on a public page is not an error
    }
  }
  next();
}
