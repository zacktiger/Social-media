import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { env } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { unauthorized } from '../lib/http-error.js';

const REFRESH_COOKIE = 'pulse_rt';

/**
 * Access token: a short-lived JWT, sent in the Authorization header and held
 * in memory by the client. Never written to localStorage.
 */
export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): string {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof payload === 'string' || !payload.sub) throw new Error('malformed');
    return payload.sub as string;
  } catch {
    throw unauthorized('Invalid or expired access token', 'invalid_token');
  }
}

// Refresh tokens are opaque, so only the hash needs to live in the database.
// A leaked database dump can't be replayed as a session.
const hashToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt },
  });

  return raw;
}

/**
 * Rotation with reuse detection: a refresh token is single-use. If a token
 * that was already used shows up again, we assume it was stolen and revoke
 * every session for that user rather than quietly issuing a new one.
 */
export async function rotateRefreshToken(raw: string): Promise<{ userId: string; token: string }> {
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });

  if (!stored) throw unauthorized('Invalid refresh token', 'invalid_refresh');

  if (stored.revoked) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revoked: false },
      data: { revoked: true },
    });
    throw unauthorized('Refresh token reuse detected, all sessions revoked', 'token_reuse');
  }

  if (stored.expiresAt < new Date()) {
    throw unauthorized('Refresh token expired', 'expired_refresh');
  }

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
  const token = await issueRefreshToken(stored.userId);

  return { userId: stored.userId, token };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(raw) },
    data: { revoked: true },
  });
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // Cross-site cookies need SameSite=None + Secure in production. In dev,
    // localhost:3000 and localhost:4000 count as the same site, so Lax works.
    sameSite: env.isProd ? 'none' : 'lax',
    secure: env.isProd,
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

export const refreshCookieName = REFRESH_COOKIE;
