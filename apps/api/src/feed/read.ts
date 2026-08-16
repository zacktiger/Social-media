import type { Post, User } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { toPostDto, type PostDto } from '../lib/serialize.js';
import { CELEBRITY_CACHE_TTL_SECONDS, CELEBRITY_IDS_KEY, feedKey } from './keys.js';
import { hotScore } from './score.js';
import {
  feedLength,
  markFeedActive,
  readFeedWindow,
  replaceFeed,
  updateFeedScores,
  type FeedEntry,
} from './store.js';

type PostWithAuthor = Post & { author: User };

/**
 * How many extra candidates each half contributes beyond the page size.
 *
 * The top k of a merged list is always a subset of (top k of A) union
 * (top k of B), so k from each half is already enough to produce a correct
 * page - there is no need to over-fetch a multiple of it. The small buffer
 * covers the two ways a candidate can evaporate: ids still in Redis whose
 * posts were deleted, and the gap between the score cached in the ZSET and
 * the score recomputed at read time.
 */
const CANDIDATE_BUFFER = 12;

/** Cap on how many authors a rebuild will pull from, keeps the query bounded. */
const MAX_FOLLOWS_PER_REBUILD = 5_000;

// --- cursor ----------------------------------------------------------------
//
// The cursor carries three things:
//   score    - where the previous page stopped
//   postId   - tiebreak, because scores are not unique
//   anchorMs - the clock the first page was ranked against
//
// The anchor is what makes paging through a *decaying* ranking stable. Every
// post's score falls as it ages, so a page requested a second later scores the
// same post slightly lower than the cursor did - and a plain `score < cursor`
// test lets the last item of page 1 reappear at the top of page 2. Freezing
// the clock for the whole pagination session removes the drift entirely.

type Cursor = { score: number; postId: string; anchorMs: number };

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.score}|${cursor.postId}|${cursor.anchorMs}`).toString('base64url');
}

function decodeCursor(cursor?: string): Cursor | null {
  if (!cursor) return null;
  const [score, postId, anchorMs] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!postId || Number.isNaN(Number(score)) || Number.isNaN(Number(anchorMs))) return null;
  return { score: Number(score), postId, anchorMs: Number(anchorMs) };
}

// --- celebrity side --------------------------------------------------------

/** Every account over the fan-out threshold. Small list, cached globally. */
async function getCelebrityIds(): Promise<string[]> {
  const cached = await redis.get(CELEBRITY_IDS_KEY);
  if (cached !== null) return cached.length > 0 ? cached.split(',') : [];

  const rows = await prisma.user.findMany({ where: { isCelebrity: true }, select: { id: true } });
  const ids = rows.map((row) => row.id);
  await redis.set(CELEBRITY_IDS_KEY, ids.join(','), 'EX', CELEBRITY_CACHE_TTL_SECONDS);
  return ids;
}

/**
 * Which of those does this user follow? One primary-key lookup against the
 * follow table, restricted to a handful of ids - cheaper and always correct
 * compared with caching a derived per-user list that promotion would stale.
 */
export async function getCelebrityFollowIds(userId: string): Promise<string[]> {
  const celebrityIds = await getCelebrityIds();
  if (celebrityIds.length === 0) return [];

  const rows = await prisma.follow.findMany({
    where: { followerId: userId, followingId: { in: celebrityIds } },
    select: { followingId: true },
  });
  return rows.map((row) => row.followingId);
}

/** Called whenever an account is promoted past the threshold. */
export const invalidateCelebrityCache = () => redis.del(CELEBRITY_IDS_KEY);

// --- rebuild ---------------------------------------------------------------

/**
 * Rebuilds a feed from Postgres. Runs when Redis is cold (fresh deploy, evicted
 * key, brand-new user). This is what makes the cache safe to lose: Redis holds
 * no state that Postgres cannot regenerate.
 */
export async function rebuildFeed(userId: string): Promise<number> {
  const follows = await prisma.follow.findMany({
    where: { followerId: userId, following: { isCelebrity: false } },
    select: { followingId: true },
    take: MAX_FOLLOWS_PER_REBUILD,
  });

  // Your own posts belong in your own feed.
  const authorIds = [...follows.map((f) => f.followingId), userId];

  const posts = await prisma.post.findMany({
    where: { authorId: { in: authorIds } },
    orderBy: { createdAt: 'desc' },
    take: env.FEED_MAX_LENGTH,
    select: { id: true, likeCount: true, commentCount: true, createdAt: true },
  });

  const now = new Date();
  const entries: FeedEntry[] = posts.map((post) => ({
    postId: post.id,
    score: hotScore(post, now),
  }));

  await replaceFeed(userId, entries);
  return entries.length;
}

/**
 * Recomputes the scores of the top slice of a feed. The read path does this
 * for the page it is serving; the periodic job does it for feeds that were
 * read recently, so ranking stays fresh without touching idle users.
 */
export async function refreshFeedScores(userId: string, size = 200): Promise<number> {
  const entries = await readFeedWindow(userId, size);
  if (entries.length === 0) return 0;

  const posts = await prisma.post.findMany({
    where: { id: { in: entries.map((e) => e.postId) } },
    select: { id: true, likeCount: true, commentCount: true, createdAt: true },
  });

  const now = new Date();
  const fresh = posts.map((post) => ({ postId: post.id, score: hotScore(post, now) }));
  await updateFeedScores(userId, fresh);

  // Anything still in the ZSET but gone from Postgres was deleted; drop it.
  const alive = new Set(posts.map((p) => p.id));
  const dead = entries.filter((e) => !alive.has(e.postId)).map((e) => e.postId);
  if (dead.length > 0) await redis.zrem(feedKey(userId), ...dead);

  return fresh.length;
}

// --- the hybrid read -------------------------------------------------------

export type FeedPage = {
  items: PostDto[];
  nextCursor: string | null;
  /** Debug detail, surfaced in the UI so the two paths are visible. */
  meta: { fromCache: number; fromCelebrities: number; rebuilt: boolean };
};

export async function getFeedPage(
  userId: string,
  options: { limit: number; cursor?: string },
): Promise<FeedPage> {
  const { limit } = options;
  const cursor = decodeCursor(options.cursor);
  const window = limit + CANDIDATE_BUFFER;

  void markFeedActive(userId);

  // 1 + 2. The pushed half (this user's ZSET) and the question of which
  // pull-path accounts they follow are independent, so they are issued
  // together. Awaiting them in sequence added a whole round trip to every
  // feed read for no reason.
  const [initialCached, celebrityIds] = await Promise.all([
    readFeedWindow(userId, window, cursor?.score),
    getCelebrityFollowIds(userId),
  ]);

  let cached = initialCached;
  let rebuilt = false;
  if (cached.length === 0 && !cursor && (await feedLength(userId)) === 0) {
    await rebuildFeed(userId);
    cached = await readFeedWindow(userId, window);
    rebuilt = true;
  }

  const [cachedPosts, celebrityPosts] = await Promise.all([
    cached.length > 0
      ? prisma.post.findMany({
          where: { id: { in: cached.map((e) => e.postId) } },
          include: { author: true },
        })
      : Promise.resolve([] as PostWithAuthor[]),
    celebrityIds.length > 0
      ? prisma.post.findMany({
          where: { authorId: { in: celebrityIds } },
          orderBy: { createdAt: 'desc' },
          take: window,
          include: { author: true },
        })
      : Promise.resolve([] as PostWithAuthor[]),
  ]);

  // 3. Score both halves on the same clock so they are comparable, and write
  //    the corrected scores back to the ZSET (read repair: the cached score
  //    was computed when the post was fanned out and has decayed since).
  const anchor = cursor ? new Date(cursor.anchorMs) : new Date();
  const candidates = new Map<string, { post: PostWithAuthor; score: number }>();

  for (const post of cachedPosts) candidates.set(post.id, { post, score: hotScore(post, anchor) });
  for (const post of celebrityPosts) {
    if (!candidates.has(post.id)) candidates.set(post.id, { post, score: hotScore(post, anchor) });
  }

  if (cachedPosts.length > 0) {
    void updateFeedScores(
      userId,
      cachedPosts.map((post) => ({ postId: post.id, score: candidates.get(post.id)!.score })),
    );
    const alive = new Set(cachedPosts.map((p) => p.id));
    const deleted = cached.filter((e) => !alive.has(e.postId)).map((e) => e.postId);
    if (deleted.length > 0) void redis.zrem(feedKey(userId), ...deleted);
  }

  // 4. Merge, apply the cursor, cut the page.
  const merged = [...candidates.values()]
    .filter(({ post, score }) => {
      if (!cursor) return true;
      return score < cursor.score || (score === cursor.score && post.id < cursor.postId);
    })
    .sort((a, b) => b.score - a.score || (a.post.id < b.post.id ? 1 : -1))
    .slice(0, limit);

  const likedIds = await likedPostIds(
    userId,
    merged.map((m) => m.post.id),
  );

  const last = merged[merged.length - 1];
  return {
    items: merged.map(({ post, score }) =>
      toPostDto(post, { likedByViewer: likedIds.has(post.id), score }),
    ),
    nextCursor:
      merged.length === limit && last
        ? encodeCursor({ score: last.score, postId: last.post.id, anchorMs: anchor.getTime() })
        : null,
    meta: {
      fromCache: cachedPosts.length,
      fromCelebrities: celebrityPosts.length,
      rebuilt,
    },
  };
}

/**
 * Baseline 1: the tutorial query. Join the follow graph, order by time, no
 * cache.
 *
 * Worth being honest about what this measures: with a
 * [authorId, createdAt DESC] index, Postgres answers this as a merge of one
 * index descent per followed author and stops after 20 rows. It is fast, and
 * it stays fast as the posts table grows. If a chronological timeline is all
 * you need, this is the right answer and a feed cache is overhead.
 *
 * What it does NOT do is rank. That is the comparison that actually matters,
 * and it is `getRankedNoCacheFeedPage` below.
 */
export async function getNaiveFeedPage(
  userId: string,
  options: { limit: number; cursor?: string },
): Promise<{ items: PostDto[]; nextCursor: string | null }> {
  const before = options.cursor ? new Date(Buffer.from(options.cursor, 'base64url').toString()) : null;

  const posts = await prisma.post.findMany({
    where: {
      AND: [
        {
          OR: [
            { author: { followers: { some: { followerId: userId } } } },
            { authorId: userId },
          ],
        },
        ...(before ? [{ createdAt: { lt: before } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit,
    include: { author: true },
  });

  const likedIds = await likedPostIds(userId, posts.map((p) => p.id));
  const last = posts[posts.length - 1];

  return {
    items: posts.map((post) => toPostDto(post, { likedByViewer: likedIds.has(post.id) })),
    nextCursor:
      posts.length === options.limit && last
        ? Buffer.from(last.createdAt.toISOString()).toString('base64url')
        : null,
  };
}

/**
 * Baseline 2: the same *ranked* feed the hybrid path produces, computed from
 * scratch on every read. This is the query the fan-out pipeline exists to
 * avoid.
 *
 * No index can serve it. Ranking by a decaying engagement score means every
 * candidate post from every followed author inside the window has to be read,
 * scored, and sorted before the top 20 is known - so the work grows with how
 * much your network posted, not with how much you are about to look at. The
 * chronological baseline gets to stop after 20 rows; this one cannot.
 *
 * The window is capped at 7 days for exactly that reason. Without it the scan
 * grows without bound and the comparison stops being interesting.
 */
export async function getRankedNoCacheFeedPage(
  userId: string,
  options: { limit: number },
): Promise<{ items: PostDto[]; nextCursor: null }> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p."id"
    FROM "Post" p
    WHERE (
      p."authorId" IN (SELECT f."followingId" FROM "Follow" f WHERE f."followerId" = ${userId})
      OR p."authorId" = ${userId}
    )
      AND p."createdAt" > NOW() - INTERVAL '7 days'
    ORDER BY
      (1 + p."likeCount" + 2 * p."commentCount")
        / POWER(EXTRACT(EPOCH FROM (NOW() - p."createdAt")) / 3600.0 + 2, 1.8) DESC
    LIMIT ${options.limit}
  `;

  if (rows.length === 0) return { items: [], nextCursor: null };

  const posts = await prisma.post.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    include: { author: true },
  });

  const order = new Map(rows.map((row, index) => [row.id, index]));
  posts.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const liked = await likedPostIds(userId, posts.map((p) => p.id));
  const now = new Date();

  return {
    items: posts.map((post) =>
      toPostDto(post, { likedByViewer: liked.has(post.id), score: hotScore(post, now) }),
    ),
    nextCursor: null,
  };
}

/** One query to answer "which of these posts has the viewer already liked". */
export async function likedPostIds(userId: string | undefined, postIds: string[]): Promise<Set<string>> {
  if (!userId || postIds.length === 0) return new Set();
  const likes = await prisma.like.findMany({
    where: { userId, postId: { in: postIds } },
    select: { postId: true },
  });
  return new Set(likes.map((like) => like.postId));
}
