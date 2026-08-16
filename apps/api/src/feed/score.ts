/**
 * Ranking score, same shape as the Reddit / Hacker News "hot" formula:
 *
 *     score = (1 + likes + 2*comments) / (age_in_hours + 2)^1.8
 *
 * Why not just sort by createdAt: a timestamp sort can never surface a post
 * that started getting real engagement twenty minutes after it was published.
 * Why not sort by engagement alone: without the decay term, one old viral post
 * sits at the top of every feed forever.
 *
 * The numerator is linear in likes and comments, which is the property the
 * whole incremental-update scheme rests on: at a fixed age, one extra like is
 * always worth exactly `1 / (age + 2)^1.8` more score. That means a like can
 * be applied to a cached feed entry with a single ZADD ... XX INCR, with no
 * need to recompute the post's score from scratch or re-sort the feed.
 */
export const GRAVITY = 1.8;
export const LIKE_WEIGHT = 1;
export const COMMENT_WEIGHT = 2;
const AGE_OFFSET_HOURS = 2;

function decayDivisor(createdAt: Date, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - createdAt.getTime()) / 3_600_000);
  return Math.pow(ageHours + AGE_OFFSET_HOURS, GRAVITY);
}

export function hotScore(
  post: { likeCount: number; commentCount: number; createdAt: Date },
  now: Date = new Date(),
): number {
  const engagement = 1 + post.likeCount * LIKE_WEIGHT + post.commentCount * COMMENT_WEIGHT;
  return engagement / decayDivisor(post.createdAt, now);
}

/**
 * How much a single like/comment (or its removal) changes the score of a post
 * that was created at `createdAt`. Applied to cached feed entries directly.
 */
export function engagementDelta(weight: number, createdAt: Date, now: Date = new Date()): number {
  return weight / decayDivisor(createdAt, now);
}
