import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { conflict, unauthorized } from '../lib/http-error.js';
import { toPrivateUser } from '../lib/serialize.js';
import { requireAuth } from './middleware.js';
import { limitAuth, limitRegister } from '../middleware/rate-limit.js';
import {
  clearRefreshCookie,
  issueRefreshToken,
  refreshCookieName,
  revokeRefreshToken,
  rotateRefreshToken,
  setRefreshCookie,
  signAccessToken,
} from './tokens.js';

export const authRouter = Router();

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_]+$/i, 'Username may only contain letters, numbers and underscores'),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(50),
});

authRouter.post('/register', limitRegister, async (req, res) => {
  const body = registerSchema.parse(req.body);
  const username = body.username.toLowerCase();
  const email = body.email.toLowerCase();

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { username: true },
  });
  if (existing) {
    throw conflict(
      existing.username === username ? 'That username is taken' : 'That email is already registered',
    );
  }

  const user = await prisma.user.create({
    data: {
      username,
      email,
      displayName: body.displayName,
      passwordHash: await bcrypt.hash(body.password, 10),
    },
  });

  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);

  res.status(201).json({
    user: toPrivateUser(user),
    accessToken: signAccessToken(user.id),
  });
});

const loginSchema = z.object({
  // Accepts either, so users don't have to remember which one they signed up with.
  identifier: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post('/login', limitAuth, async (req, res) => {
  const { identifier, password } = loginSchema.parse(req.body);
  const value = identifier.toLowerCase();

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: value }, { email: value }] },
  });

  // Same error for "no such user" and "wrong password" so the endpoint can't
  // be used to enumerate accounts.
  const ok = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !ok) throw unauthorized('Incorrect username or password', 'invalid_credentials');

  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);

  res.json({ user: toPrivateUser(user), accessToken: signAccessToken(user.id) });
});

authRouter.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[refreshCookieName];
  if (!raw) throw unauthorized('No refresh token', 'no_refresh');

  const { userId, token } = await rotateRefreshToken(raw);
  setRefreshCookie(res, token);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  res.json({ user: toPrivateUser(user), accessToken: signAccessToken(userId) });
});

authRouter.post('/logout', async (req, res) => {
  const raw = req.cookies?.[refreshCookieName];
  if (raw) await revokeRefreshToken(raw);
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
  res.json({ user: toPrivateUser(user) });
});
