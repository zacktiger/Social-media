import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth } from '../auth/middleware.js';
import { env } from '../env.js';
import { badRequest, notFound } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { toNotificationEvent, toPostDto, toPrivateUser, toPublicUser } from '../lib/serialize.js';
import { emitNotification } from '../realtime/emit.js';
import { limitFollow } from '../middleware/rate-limit.js';
import { enqueue } from '../feed/queue.js';
import { invalidateCelebrityCache, likedPostIds } from '../feed/read.js';

export const usersRouter = Router();

/** Express 5 types route params as string | string[] unless you name them. */
type UserParams = { username: string };

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

async function findUserByUsername(username: string) {
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  if (!user) throw notFound('User not found');
  return user;
}

const updateMeSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(280).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

usersRouter.patch('/me', requireAuth, async (req, res) => {
  const data = updateMeSchema.parse(req.body);
  const user = await prisma.user.update({ where: { id: req.userId! }, data });
  res.json({ user: toPrivateUser(user) });
});

usersRouter.get<UserParams>('/:username', optionalAuth, async (req, res) => {
  const user = await findUserByUsername(req.params.username);

  const isFollowing =
    req.userId && req.userId !== user.id
      ? (await prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: req.userId, followingId: user.id } },
          select: { followerId: true },
        })) !== null
      : false;

  res.json({ user: toPublicUser(user), isFollowing, isSelf: req.userId === user.id });
});

const timelineSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Profile timeline: strictly chronological and read straight from Postgres.
 * No ranking and no cache - the [authorId, createdAt DESC] index answers it
 * directly, so there is nothing for a feed cache to add here.
 */
usersRouter.get<UserParams>('/:username/posts', optionalAuth, async (req, res) => {
  const { cursor, limit } = timelineSchema.parse(req.query);
  const user = await findUserByUsername(req.params.username);

  const posts = await prisma.post.findMany({
    where: { authorId: user.id, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { author: true },
  });

  const liked = await likedPostIds(req.userId, posts.map((p) => p.id));
  const last = posts[posts.length - 1];

  res.json({
    posts: posts.map((post) => toPostDto(post, { likedByViewer: liked.has(post.id) })),
    nextCursor: posts.length === limit && last ? last.createdAt.toISOString() : null,
  });
});

/** People who follow this user, newest first. */
usersRouter.get<UserParams>('/:username/followers', async (req, res) => {
  const { cursor, limit } = timelineSchema.parse(req.query);
  const user = await findUserByUsername(req.params.username);

  const rows = await prisma.follow.findMany({
    where: { followingId: user.id, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { follower: true },
  });

  const last = rows[rows.length - 1];
  res.json({
    users: rows.map((row) => toPublicUser(row.follower)),
    nextCursor: rows.length === limit && last ? last.createdAt.toISOString() : null,
  });
});

/** People this user follows, newest first. */
usersRouter.get<UserParams>('/:username/following', async (req, res) => {
  const { cursor, limit } = timelineSchema.parse(req.query);
  const user = await findUserByUsername(req.params.username);

  const rows = await prisma.follow.findMany({
    where: { followerId: user.id, ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { following: true },
  });

  const last = rows[rows.length - 1];
  res.json({
    users: rows.map((row) => toPublicUser(row.following)),
    nextCursor: rows.length === limit && last ? last.createdAt.toISOString() : null,
  });
});

// --- follow / unfollow -----------------------------------------------------

usersRouter.post<UserParams>('/:username/follow', requireAuth, limitFollow, async (req, res) => {
  const followerId = req.userId!;
  const target = await findUserByUsername(req.params.username);
  if (target.id === followerId) throw badRequest('You cannot follow yourself');

  try {
    const { promoted, notification } = await prisma.$transaction(async (tx) => {
      await tx.follow.create({ data: { followerId, followingId: target.id } });

      const updated = await tx.user.update({
        where: { id: target.id },
        data: { followerCount: { increment: 1 } },
      });
      await tx.user.update({ where: { id: followerId }, data: { followingCount: { increment: 1 } } });

      const created = await tx.notification.create({
        data: { userId: target.id, type: 'follow', actorId: followerId },
        include: { actor: true },
      });

      // The moment an account crosses the threshold it stops being fanned out.
      // Note there is no demotion path: posts written while flagged were never
      // pushed to anyone, so flipping the flag back would silently hide them.
      const crossed = !updated.isCelebrity && updated.followerCount > env.FANOUT_THRESHOLD;
      if (crossed) {
        await tx.user.update({ where: { id: target.id }, data: { isCelebrity: true } });
      }

      return { promoted: crossed, notification: created };
    });

    if (promoted) await invalidateCelebrityCache();
    emitNotification(target.id, toNotificationEvent(notification));
    void enqueue('follow-backfill', { followerId, followingId: target.id });
  } catch (err) {
    // Already following: treat as success so the button is idempotent.
    if (!isUniqueViolation(err)) throw err;
  }

  res.json({ following: true });
});

usersRouter.delete<UserParams>('/:username/follow', requireAuth, limitFollow, async (req, res) => {
  const followerId = req.userId!;
  const target = await findUserByUsername(req.params.username);

  const removed = await prisma.follow.deleteMany({
    where: { followerId, followingId: target.id },
  });

  if (removed.count > 0) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { followerCount: { decrement: 1 } } }),
      prisma.user.update({ where: { id: followerId }, data: { followingCount: { decrement: 1 } } }),
    ]);
    void enqueue('unfollow-cleanup', { followerId, followingId: target.id });
  }

  res.json({ following: false });
});
