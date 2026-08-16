import { Queue } from 'bullmq';
import { queueConnection } from '../lib/redis.js';

export const FEED_QUEUE = 'feed';

/**
 * Job payloads. Everything here is derived work that must not block an HTTP
 * request: a post insert returns as soon as Postgres has the row, and the
 * follower feeds catch up a moment later.
 */
export type FanoutJob = {
  postId: string;
  authorId: string;
  score: number;
  /** ISO string; job payloads are JSON, so Dates do not survive the round trip. */
  createdAt: string;
};

export type EngagementJob = {
  postId: string;
  authorId: string;
  /** Signed score change, already adjusted for the post's age. */
  delta: number;
};

export type FollowJob = {
  followerId: string;
  followingId: string;
};

export type JobNameMap = {
  fanout: FanoutJob;
  engagement: EngagementJob;
  'follow-backfill': FollowJob;
  'unfollow-cleanup': FollowJob;
  decay: Record<string, never>;
};

export const feedQueue = new Queue(FEED_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    // Keep a bounded history so Redis memory stays flat.
    removeOnComplete: 500,
    removeOnFail: 1_000,
  },
});

export function enqueue<K extends keyof JobNameMap>(name: K, data: JobNameMap[K]) {
  // Not awaited by callers on the request path on purpose: a failure to
  // enqueue must not fail the write that already committed to Postgres.
  return feedQueue.add(name, data).catch((err) => {
    console.error(`[queue] failed to enqueue ${name}:`, err);
  });
}

/** Registers the periodic score-decay job. Safe to call on every boot. */
export async function scheduleDecayJob(everyMs = 10 * 60 * 1000) {
  await feedQueue.upsertJobScheduler('feed-decay', { every: everyMs }, { name: 'decay', data: {} });
}

export async function closeQueue() {
  await feedQueue.close();
}
