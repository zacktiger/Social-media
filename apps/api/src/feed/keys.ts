/** Every Redis key the feed system touches, in one place. */

/** ZSET: member = postId, score = hot score. One per user. */
export const feedKey = (userId: string) => `feed:${userId}`;

/**
 * The ids of every account currently over the fan-out threshold.
 *
 * Cached globally rather than per user on purpose. A per-user "celebrities I
 * follow" cache goes stale the instant an account crosses the threshold - all
 * of its existing followers would keep the old list and silently miss its
 * posts, which are no longer being fanned out to them. There is exactly one
 * copy of this list, so promotion invalidates it with a single DEL.
 * It stays small by definition: crossing the threshold is rare.
 */
export const CELEBRITY_IDS_KEY = 'celebrities:ids';
export const CELEBRITY_CACHE_TTL_SECONDS = 60;

/**
 * ZSET of userIds scored by the last time their feed was read. Lets the decay
 * job refresh only feeds somebody actually looks at, instead of walking every
 * user in the database.
 */
export const ACTIVE_FEEDS_KEY = 'feeds:active';

/**
 * Feeds are derived data, so they are allowed to expire. A user who has not
 * been seen in 30 days simply gets their feed rebuilt from Postgres on the
 * next read, which keeps Redis memory proportional to active users rather
 * than to registered users.
 */
export const FEED_TTL_SECONDS = 60 * 60 * 24 * 30;
