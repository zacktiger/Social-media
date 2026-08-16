import type { Job } from 'bullmq';
import { env } from '../env.js';
import { prisma } from '../lib/prisma.js';
import { createLogger } from '../lib/logger.js';
import { invalidateCelebrityCache, refreshFeedScores } from './read.js';
import { hotScore } from './score.js';
import {
  addEntriesToFeed,
  bumpPostScoreInFeeds,
  iterateFollowerIds,
  pushPostToFeeds,
  removePostFromFeeds,
  takeActiveFeedIds,
} from './store.js';
import type { EngagementJob, FanoutJob, FollowJob } from './queue.js';

const log = createLogger('worker');

/** How many of an author's recent posts land in a feed when you follow them. */
const BACKFILL_LIMIT = 60;
/** How many feeds one decay run touches, and how far back "active" reaches. */
const DECAY_FEED_LIMIT = 200;
const DECAY_ACTIVE_WINDOW_MS = 60 * 60 * 1000;

/**
 * The write half of the hybrid design.
 *
 * Normal author  -> push the post id into every follower's ZSET now, so the
 *                   read is a single ZREVRANGEBYSCORE later.
 * Celebrity      -> write nothing. A million ZADDs to save one indexed query
 *                   per reader is a bad trade, so their posts are pulled from
 *                   Postgres at read time instead.
 */
async function handleFanout(data: FanoutJob) {
  const author = await prisma.user.findUnique({
    where: { id: data.authorId },
    select: { followerCount: true, isCelebrity: true },
  });
  if (!author) return { skipped: 'author_deleted' };

  if (author.isCelebrity || author.followerCount > env.FANOUT_THRESHOLD) {
    // Safety net: an author can cross the threshold between two posts.
    if (!author.isCelebrity) {
      await prisma.user.update({ where: { id: data.authorId }, data: { isCelebrity: true } });
      await invalidateCelebrityCache();
      log.info(`promoted ${data.authorId} to celebrity (${author.followerCount} followers)`);
    }
    return { strategy: 'pull', followers: author.followerCount };
  }

  let delivered = 0;
  for await (const followerIds of iterateFollowerIds(data.authorId)) {
    await pushPostToFeeds(followerIds, data.postId, data.score);
    delivered += followerIds.length;
  }

  return { strategy: 'push', delivered };
}

/**
 * A like or comment changed a post's score. Because the score is linear in
 * engagement, the new value can be applied to every cached copy with one
 * INCR each - no recompute, no re-sort, no re-read of the feed.
 */
async function handleEngagement(data: EngagementJob) {
  const author = await prisma.user.findUnique({
    where: { id: data.authorId },
    select: { isCelebrity: true },
  });
  // Celebrity posts are never in anyone's ZSET, so there is nothing to bump.
  if (!author || author.isCelebrity) return { skipped: 'pull_author' };

  let updated = 0;
  for await (const followerIds of iterateFollowerIds(data.authorId)) {
    await bumpPostScoreInFeeds(followerIds, data.postId, data.delta);
    updated += followerIds.length;
  }
  await bumpPostScoreInFeeds([data.authorId], data.postId, data.delta);

  return { updated };
}

/** New follow: pull the author's recent posts into the follower's feed now. */
async function handleFollowBackfill(data: FollowJob) {
  const target = await prisma.user.findUnique({
    where: { id: data.followingId },
    select: { isCelebrity: true },
  });
  if (!target || target.isCelebrity) return { skipped: 'pull_author' };

  const posts = await prisma.post.findMany({
    where: { authorId: data.followingId },
    orderBy: { createdAt: 'desc' },
    take: BACKFILL_LIMIT,
    select: { id: true, likeCount: true, commentCount: true, createdAt: true },
  });

  const now = new Date();
  await addEntriesToFeed(
    data.followerId,
    posts.map((post) => ({ postId: post.id, score: hotScore(post, now) })),
  );

  return { backfilled: posts.length };
}

/**
 * Unfollow: drop that author's recent posts out of the feed. Older posts may
 * linger; they age out of the capped ZSET on their own, and the read path
 * would have to fetch them anyway to know who wrote them.
 */
async function handleUnfollowCleanup(data: FollowJob) {
  const posts = await prisma.post.findMany({
    where: { authorId: data.followingId },
    orderBy: { createdAt: 'desc' },
    take: BACKFILL_LIMIT,
    select: { id: true },
  });

  await removePostFromFeeds([data.followerId], posts.map((p) => p.id));
  return { removed: posts.length };
}

/**
 * Periodic re-decay. Only feeds that were actually read in the last hour are
 * touched - refreshing scores for users who are not looking is pure waste.
 */
async function handleDecay() {
  const userIds = await takeActiveFeedIds(DECAY_ACTIVE_WINDOW_MS, DECAY_FEED_LIMIT);
  let refreshed = 0;
  for (const userId of userIds) refreshed += await refreshFeedScores(userId);
  return { feeds: userIds.length, posts: refreshed };
}

export async function processFeedJob(job: Job) {
  switch (job.name) {
    case 'fanout':
      return handleFanout(job.data as FanoutJob);
    case 'engagement':
      return handleEngagement(job.data as EngagementJob);
    case 'follow-backfill':
      return handleFollowBackfill(job.data as FollowJob);
    case 'unfollow-cleanup':
      return handleUnfollowCleanup(job.data as FollowJob);
    case 'decay':
      return handleDecay();
    default:
      throw new Error(`Unknown feed job: ${job.name}`);
  }
}
