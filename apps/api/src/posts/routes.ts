import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { forbidden, notFound } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import {
  toCommentDto,
  toNotificationEvent,
  toPostDto,
  type NotificationWithActor,
} from '../lib/serialize.js';
import { emitCommentUpdate, emitLikeUpdate, emitNotification } from '../realtime/emit.js';
import { limitComment, limitLike, limitPostCreate } from '../middleware/rate-limit.js';
import { feedKey } from '../feed/keys.js';
import { enqueue } from '../feed/queue.js';
import { likedPostIds } from '../feed/read.js';
import { COMMENT_WEIGHT, LIKE_WEIGHT, engagementDelta, hotScore } from '../feed/score.js';
import { pushPostToFeeds } from '../feed/store.js';

export const postsRouter = Router();

/** Express 5 types route params as string | string[] unless you name them. */
type PostParams = { id: string };

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** The three renditions returned by POST /api/media/upload. */
const mediaSchema = z.object({
  thumb: z.string().url(),
  feed: z.string().url(),
  original: z.string().url(),
});

const createPostSchema = z
  .object({
    content: z.string().trim().max(2000),
    media: z.array(mediaSchema).max(4).optional(),
  })
  // A post needs to say something - text, pictures, or both.
  .refine((value) => value.content.length > 0 || (value.media?.length ?? 0) > 0, {
    message: 'Add some text or an image',
    path: ['content'],
  });

/**
 * The write path. Postgres commits, the author sees their own post
 * immediately, and the follower fan-out happens on the queue - the request
 * never waits on it, however many followers the author has.
 */
postsRouter.post('/', requireAuth, limitPostCreate, async (req, res) => {
  const { content, media } = createPostSchema.parse(req.body);
  const authorId = req.userId!;

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: { authorId, content, mediaUrls: media ?? undefined },
      include: { author: true },
    });
    await tx.user.update({ where: { id: authorId }, data: { postCount: { increment: 1 } } });
    return created;
  });

  const score = hotScore(post);

  // Your own feed is one ZADD, so it happens inline; everyone else's is a job.
  await pushPostToFeeds([authorId], post.id, score);
  void enqueue('fanout', {
    postId: post.id,
    authorId,
    score,
    createdAt: post.createdAt.toISOString(),
  });

  res.status(201).json({ post: toPostDto(post, { score }) });
});

postsRouter.get<PostParams>('/:id', optionalAuth, async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    include: { author: true },
  });
  if (!post) throw notFound('Post not found');

  const liked = await likedPostIds(req.userId, [post.id]);
  res.json({ post: toPostDto(post, { likedByViewer: liked.has(post.id) }) });
});

postsRouter.delete<PostParams>('/:id', requireAuth, async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    select: { id: true, authorId: true },
  });
  if (!post) throw notFound('Post not found');
  if (post.authorId !== req.userId) throw forbidden('You can only delete your own posts');

  await prisma.$transaction([
    prisma.post.delete({ where: { id: post.id } }),
    prisma.user.update({ where: { id: post.authorId }, data: { postCount: { decrement: 1 } } }),
  ]);

  // Copies sitting in other users' feeds are not chased down here: the read
  // path drops ids that no longer exist in Postgres and ZREMs them then.
  await redis.zrem(feedKey(post.authorId), post.id);

  res.status(204).end();
});

// --- likes -----------------------------------------------------------------

postsRouter.post<PostParams>('/:id/like', requireAuth, limitLike, async (req, res) => {
  const userId = req.userId!;
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    select: { id: true, authorId: true, createdAt: true },
  });
  if (!post) throw notFound('Post not found');

  let result: { likeCount: number; notification: NotificationWithActor | null } | null = null;

  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.like.create({ data: { userId, postId: post.id } });
      const updated = await tx.post.update({
        where: { id: post.id },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      });

      // include:{actor:true} makes the realtime payload free - the join rides
      // along with the insert that was going to run anyway.
      const notification =
        post.authorId === userId
          ? null
          : await tx.notification.create({
              data: { userId: post.authorId, type: 'like', actorId: userId, postId: post.id },
              include: { actor: true },
            });

      return { likeCount: updated.likeCount, notification };
    });

    void enqueue('engagement', {
      postId: post.id,
      authorId: post.authorId,
      delta: engagementDelta(LIKE_WEIGHT, post.createdAt),
    });
  } catch (err) {
    // Double-tap or a retried request: liking twice is a no-op, not an error.
    if (!isUniqueViolation(err)) throw err;
  }

  if (!result) {
    // Already liked - report the count as it stands.
    const fresh = await prisma.post.findUniqueOrThrow({
      where: { id: post.id },
      select: { likeCount: true },
    });
    return res.json({ liked: true, likeCount: fresh.likeCount });
  }

  // Emitted after the transaction commits, never from inside it: a rollback
  // would otherwise leave clients showing an event that never happened.
  emitLikeUpdate(post.id, result.likeCount);
  if (result.notification) {
    emitNotification(post.authorId, toNotificationEvent(result.notification));
  }

  res.json({ liked: true, likeCount: result.likeCount });
});

postsRouter.delete<PostParams>('/:id/like', requireAuth, limitLike, async (req, res) => {
  const userId = req.userId!;
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    select: { id: true, authorId: true, createdAt: true },
  });
  if (!post) throw notFound('Post not found');

  const removed = await prisma.like.deleteMany({ where: { userId, postId: post.id } });

  if (removed.count > 0) {
    const updated = await prisma.post.update({
      where: { id: post.id },
      data: { likeCount: { decrement: 1 } },
      select: { likeCount: true },
    });
    void enqueue('engagement', {
      postId: post.id,
      authorId: post.authorId,
      delta: -engagementDelta(LIKE_WEIGHT, post.createdAt),
    });
    emitLikeUpdate(post.id, updated.likeCount);
    return res.json({ liked: false, likeCount: updated.likeCount });
  }

  const fresh = await prisma.post.findUniqueOrThrow({
    where: { id: post.id },
    select: { likeCount: true },
  });
  res.json({ liked: false, likeCount: fresh.likeCount });
});

// --- comments --------------------------------------------------------------

const listCommentsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

postsRouter.get<PostParams>('/:id/comments', async (req, res) => {
  const { cursor, limit } = listCommentsSchema.parse(req.query);

  const comments = await prisma.comment.findMany({
    where: {
      postId: req.params.id,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { author: true },
  });

  const last = comments[comments.length - 1];
  res.json({
    comments: comments.map(toCommentDto),
    nextCursor: comments.length === limit && last ? last.createdAt.toISOString() : null,
  });
});

const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(1000),
});

postsRouter.post<PostParams>('/:id/comments', requireAuth, limitComment, async (req, res) => {
  const userId = req.userId!;
  const { content } = createCommentSchema.parse(req.body);

  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    select: { id: true, authorId: true, createdAt: true },
  });
  if (!post) throw notFound('Post not found');

  const { comment, commentCount, notification } = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { postId: post.id, authorId: userId, content },
      include: { author: true },
    });
    const updated = await tx.post.update({
      where: { id: post.id },
      data: { commentCount: { increment: 1 } },
      select: { commentCount: true },
    });

    const created_notification =
      post.authorId === userId
        ? null
        : await tx.notification.create({
            data: { userId: post.authorId, type: 'comment', actorId: userId, postId: post.id },
            include: { actor: true },
          });

    return {
      comment: created,
      commentCount: updated.commentCount,
      notification: created_notification,
    };
  });

  void enqueue('engagement', {
    postId: post.id,
    authorId: post.authorId,
    delta: engagementDelta(COMMENT_WEIGHT, post.createdAt),
  });

  emitCommentUpdate(post.id, commentCount);
  if (notification) emitNotification(post.authorId, toNotificationEvent(notification));

  res.status(201).json({ comment: toCommentDto(comment) });
});
