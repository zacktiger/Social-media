import { env } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { ACTIVE_FEEDS_KEY, FEED_TTL_SECONDS, feedKey } from './keys.js';

/**
 * Pages through "who follows this author" in batches. Ordering by followerId
 * (rather than createdAt) keeps the scan on the [followingId, followerId]
 * index and makes it stable even while new follows arrive mid-fan-out.
 */
export async function* iterateFollowerIds(
  authorId: string,
  batchSize = env.FANOUT_BATCH_SIZE,
): AsyncGenerator<string[]> {
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.follow.findMany({
      where: { followingId: authorId, ...(cursor ? { followerId: { gt: cursor } } : {}) },
      orderBy: { followerId: 'asc' },
      take: batchSize,
      select: { followerId: true },
    });

    if (rows.length === 0) return;
    yield rows.map((row) => row.followerId);
    if (rows.length < batchSize) return;
    cursor = rows[rows.length - 1]!.followerId;
  }
}

/** ZADD one post into many feeds, capping each feed's length. One round trip. */
export async function pushPostToFeeds(userIds: string[], postId: string, score: number) {
  if (userIds.length === 0) return;
  const pipe = redis.pipeline();

  for (const userId of userIds) {
    const key = feedKey(userId);
    pipe.zadd(key, score, postId);
    // Ranks are ascending by score, so dropping everything below the last
    // FEED_MAX_LENGTH entries keeps the highest-scoring window.
    pipe.zremrangebyrank(key, 0, -(env.FEED_MAX_LENGTH + 1));
    pipe.expire(key, FEED_TTL_SECONDS);
  }

  await pipe.exec();
}

/**
 * Apply an engagement delta to a post that is already sitting in these feeds.
 * `XX` matters: without it, INCR would create the member, injecting the post
 * into feeds it was never fanned out to (or that trimmed it away already).
 */
export async function bumpPostScoreInFeeds(userIds: string[], postId: string, delta: number) {
  if (userIds.length === 0 || delta === 0) return;
  const pipe = redis.pipeline();
  for (const userId of userIds) {
    pipe.zadd(feedKey(userId), 'XX', 'INCR', delta.toString(), postId);
  }
  await pipe.exec();
}

/** Add many posts to a single feed (used when backfilling a new follow). */
export async function addEntriesToFeed(userId: string, entries: { postId: string; score: number }[]) {
  if (entries.length === 0) return;
  const key = feedKey(userId);
  const args: (string | number)[] = [];
  for (const entry of entries) args.push(entry.score, entry.postId);

  await redis
    .pipeline()
    .zadd(key, ...args)
    .zremrangebyrank(key, 0, -(env.FEED_MAX_LENGTH + 1))
    .expire(key, FEED_TTL_SECONDS)
    .exec();
}

export async function removePostFromFeeds(userIds: string[], postIds: string[]) {
  if (userIds.length === 0 || postIds.length === 0) return;
  const pipe = redis.pipeline();
  for (const userId of userIds) {
    pipe.zrem(feedKey(userId), ...postIds);
  }
  await pipe.exec();
}

export type FeedEntry = { postId: string; score: number };

/**
 * Read a window of the cached feed, highest score first. `maxScore` is the
 * exclusive upper bound carried by the pagination cursor.
 */
export async function readFeedWindow(
  userId: string,
  limit: number,
  maxScore?: number,
): Promise<FeedEntry[]> {
  const max = maxScore === undefined ? '+inf' : `(${maxScore}`;
  const raw = await redis.zrevrangebyscore(
    feedKey(userId),
    max,
    '-inf',
    'WITHSCORES',
    'LIMIT',
    0,
    limit,
  );

  const entries: FeedEntry[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({ postId: raw[i]!, score: Number(raw[i + 1]) });
  }
  return entries;
}

export const feedLength = (userId: string) => redis.zcard(feedKey(userId));

/** Overwrite scores for entries already present in a feed (read repair). */
export async function updateFeedScores(userId: string, entries: FeedEntry[]) {
  if (entries.length === 0) return;
  const pipe = redis.pipeline();
  for (const entry of entries) {
    pipe.zadd(feedKey(userId), 'XX', entry.score, entry.postId);
  }
  await pipe.exec();
}

/** Replace a feed wholesale, used when rebuilding from Postgres. */
export async function replaceFeed(userId: string, entries: FeedEntry[]) {
  const key = feedKey(userId);
  const pipe = redis.pipeline();
  pipe.del(key);
  if (entries.length > 0) {
    const args: (string | number)[] = [];
    for (const entry of entries) args.push(entry.score, entry.postId);
    pipe.zadd(key, ...args);
    pipe.expire(key, FEED_TTL_SECONDS);
  }
  await pipe.exec();
}

/** Records that this user just read their feed, for the decay job to target. */
export async function markFeedActive(userId: string) {
  await redis.zadd(ACTIVE_FEEDS_KEY, Date.now(), userId);
}

export async function takeActiveFeedIds(sinceMs: number, limit: number): Promise<string[]> {
  const cutoff = Date.now() - sinceMs;
  // Drop everyone who has not read a feed within the window, then take the
  // most recently active ones. Bounded work per run, by construction.
  await redis.zremrangebyscore(ACTIVE_FEEDS_KEY, '-inf', `(${cutoff}`);
  return redis.zrevrange(ACTIVE_FEEDS_KEY, 0, limit - 1);
}
