/**
 * How a post is ranked in the feed.
 *
 *     score = (1 + likes + 2*comments) / (age_in_hours + 2)^1.8
 *
 * The top of the fraction rewards engagement and the bottom punishes age, so a
 * post has to keep earning attention to stay near the top. This is the same
 * idea Reddit and Hacker News use for their "hot" listings.
 *
 * Why not just show newest first? A post that only starts getting attention an
 * hour after it went up would never get its chance to rise.
 *
 * Why not just show most liked first? One old popular post would sit at the
 * top of everybody's feed forever.
 *
 * One detail here matters a lot elsewhere. Likes and comments are simply added
 * together, so for a post of a given age, every extra like is worth the same
 * fixed amount. A two hour old post with 10 likes scores exactly one like's
 * worth more than the same post with 9.
 *
 * That is what lets a new like be applied to a cached feed entry with a single
 * Redis command, instead of recalculating the post's score from scratch and
 * re-sorting the whole feed. See `engagementDelta` at the bottom of this file.
 */

/** How hard age drags a post down. Higher means the feed moves on faster. */
export const GRAVITY = 1.8;

export const LIKE_WEIGHT = 1;
/** A comment counts double, since writing one takes more effort than a tap. */
export const COMMENT_WEIGHT = 2;

/**
 * Added to the age before dividing. Without it a brand new post would divide
 * by almost zero and score absurdly high for its first few minutes.
 */
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
