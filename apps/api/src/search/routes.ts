import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../auth/middleware.js';
import { prisma } from '../lib/prisma.js';
import { toPostDto, toPublicUser } from '../lib/serialize.js';
import { likedPostIds } from '../feed/read.js';
import { limitSearch } from '../middleware/rate-limit.js';

export const searchRouter = Router();

/**
 * Both endpoints are a single indexed Postgres query. No Elasticsearch, no
 * Meilisearch, nothing extra to run, sync, or pay for - which at this scale is
 * the right call, and being able to say why is worth more than the feature.
 * The point where that stops being true: faceting, cross-field relevance
 * tuning, or a corpus large enough that GIN maintenance hurts write latency.
 */

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * Full-text post search. websearch_to_tsquery is the parser that accepts what
 * people actually type - quoted phrases, OR, leading minus - without throwing
 * a syntax error the way to_tsquery does on a stray character.
 */
searchRouter.get('/posts', limitSearch, optionalAuth, async (req, res) => {
  const { q, limit } = querySchema.parse(req.query);

  const rows = await prisma.$queryRaw<{ id: string; rank: number }[]>`
    SELECT p."id",
           ts_rank(p."searchVector", websearch_to_tsquery('english', ${q})) AS rank
    FROM "Post" p
    WHERE p."searchVector" @@ websearch_to_tsquery('english', ${q})
    ORDER BY rank DESC, p."createdAt" DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) return res.json({ posts: [] });

  // Hydrate through Prisma so the response shape matches every other endpoint.
  const posts = await prisma.post.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    include: { author: true },
  });

  const order = new Map(rows.map((row, index) => [row.id, index]));
  posts.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const liked = await likedPostIds(req.userId, posts.map((p) => p.id));

  res.json({
    posts: posts.map((post) => toPostDto(post, { likedByViewer: liked.has(post.id) })),
  });
});

/**
 * User search. Exact prefix matches rank first, then trigram similarity, so
 * "kai" finds @kai before it finds @kaitlyn - and "kshtij" still finds
 * @kshitij, which is the whole reason pg_trgm is here.
 */
searchRouter.get('/users', limitSearch, async (req, res) => {
  const { q, limit } = querySchema.parse(req.query);
  const prefix = `${q.toLowerCase()}%`;

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT u."id"
    FROM "User" u
    WHERE u."username" ILIKE ${prefix}
       OR u."displayName" ILIKE ${prefix}
       OR similarity(u."username", ${q}) > 0.25
       OR similarity(u."displayName", ${q}) > 0.25
    ORDER BY
      (u."username" ILIKE ${prefix}) DESC,
      GREATEST(similarity(u."username", ${q}), similarity(u."displayName", ${q})) DESC,
      u."followerCount" DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) return res.json({ users: [] });

  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
  const order = new Map(rows.map((row, index) => [row.id, index]));
  users.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  res.json({ users: users.map(toPublicUser) });
});

/** Kept for the README: shows the GIN index is actually being used. */
searchRouter.get('/explain', async (req, res) => {
  const { q } = querySchema.parse(req.query);
  const plan = await prisma.$queryRaw<{ 'QUERY PLAN': string }[]>(
    Prisma.sql`
      EXPLAIN ANALYZE
      SELECT p."id"
      FROM "Post" p
      WHERE p."searchVector" @@ websearch_to_tsquery('english', ${q})
      ORDER BY ts_rank(p."searchVector", websearch_to_tsquery('english', ${q})) DESC
      LIMIT 20
    `,
  );
  res.type('text/plain').send(plan.map((row) => row['QUERY PLAN']).join('\n'));
});
