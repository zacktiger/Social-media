/**
 * Load-testing dataset. Separate from the demo seed because the shape matters
 * more than the content: a Zipfian follower distribution, so a handful of
 * accounts are followed by a large fraction of everybody and the two feed
 * strategies actually diverge.
 *
 *   npm run db:seed:load -w @pulse/api                 # 5k users, 50k posts
 *   npm run db:seed:load -w @pulse/api -- --users 20000 --posts 200000
 *
 * Every account gets the password `loadtest123` so the benchmark can sign in
 * as any of them.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { env } from '../src/env.js';

const prisma = new PrismaClient();
const redis = new Redis(env.REDIS_URL);

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const USERS = arg('users', 5_000);
const POSTS = arg('posts', 50_000);
const AVG_FOLLOWS = arg('follows', 40);
const LIKES = arg('likes', 150_000);
/** Accounts over this follower count are flagged for the pull path. */
const THRESHOLD = arg('threshold', 500);

const PASSWORD = 'loadtest123';
const BATCH = 5_000;

/**
 * Post text is sampled from this vocabulary rather than being one repeated
 * sentence. It matters: if every post contains the same words, every search
 * term matches every row, and Postgres correctly ignores the GIN index in
 * favour of a sequential scan - which would make any search benchmark run
 * against this data meaningless.
 */
const TOPICS = [
  'postgres', 'redis', 'kafka', 'sharding', 'replication', 'indexing', 'vacuum',
  'deadlock', 'partitioning', 'checkpoint', 'wal', 'mvcc', 'isolation', 'latency',
  'throughput', 'backpressure', 'idempotency', 'consistency', 'quorum', 'raft',
  'gossip', 'heartbeat', 'failover', 'sidecar', 'tracing', 'profiling', 'allocation',
  'garbage', 'compaction', 'bloom', 'cursor', 'pagination', 'migration', 'rollback',
  'webhook', 'throttling', 'debounce', 'websocket', 'polling', 'streaming',
];

const PHRASES = [
  'spent the morning debugging',
  'finally shipped the fix for',
  'still not convinced about',
  'wrote a benchmark for',
  'the p99 got worse after touching',
  'deleted a hundred lines of',
  'nobody warned me about',
  'reading the source for',
];

function sample<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function makeContent(index: number): string {
  const words = new Set<string>();
  const count = 2 + Math.floor(Math.random() * 4);
  while (words.size < count) words.add(sample(TOPICS));
  return `${sample(PHRASES)} ${[...words].join(' and ')} (#${index})`;
}

async function inBatches<T>(rows: T[], run: (chunk: T[]) => Promise<unknown>, label: string) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await run(rows.slice(i, i + BATCH));
    process.stdout.write(`\r  ${label}: ${Math.min(i + BATCH, rows.length)}/${rows.length}   `);
  }
  process.stdout.write('\n');
}

/**
 * Zipf: the k-th most popular account has weight 1/k^s. This is what produces
 * "a few accounts everyone follows" instead of a uniform graph where fan-out
 * on write would look great and never hit its pathological case.
 */
function zipfSampler(count: number, s = 0.9) {
  const cumulative = new Float64Array(count);
  let total = 0;
  for (let k = 0; k < count; k++) {
    total += 1 / Math.pow(k + 1, s);
    cumulative[k] = total;
  }

  return () => {
    const target = Math.random() * total;
    let low = 0;
    let high = count - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid]! < target) low = mid + 1;
      else high = mid;
    }
    return low;
  };
}

async function clearFeedCache() {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'feed:*', 'COUNT', 1000);
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== '0');
  await redis.del('celebrities:ids', 'feeds:active');
}

async function main() {
  const startedAt = Date.now();
  console.log(`Seeding ${USERS} users, ${POSTS} posts, ~${USERS * AVG_FOLLOWS} follows\n`);

  console.log('Clearing...');
  await clearFeedCache();
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Notification","Comment","Like","Post","Follow","RefreshToken","User" CASCADE`,
  );

  // One hash for everyone: bcrypt is deliberately slow, and hashing 5,000
  // distinct passwords would dominate the runtime of this script.
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const userIds = Array.from({ length: USERS }, () => crypto.randomUUID());

  await inBatches(
    userIds.map((id, index) => ({
      id,
      username: `load${index}`,
      email: `load${index}@loadtest.dev`,
      displayName: `Load User ${index}`,
      passwordHash,
    })),
    (chunk) => prisma.user.createMany({ data: chunk, skipDuplicates: true }),
    'users',
  );

  // --- follow graph --------------------------------------------------------
  const pickPopular = zipfSampler(USERS);
  const followerCounts = new Int32Array(USERS);
  const followingCounts = new Int32Array(USERS);
  const seen = new Set<string>();
  const follows: { followerId: string; followingId: string }[] = [];

  for (let follower = 0; follower < USERS; follower++) {
    // Vary how many people each account follows; a fixed number would make
    // every feed the same size.
    const count = Math.max(1, Math.round(AVG_FOLLOWS * (0.3 + Math.random() * 1.7)));
    for (let n = 0; n < count; n++) {
      const target = pickPopular();
      if (target === follower) continue;
      const key = `${follower}:${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      follows.push({ followerId: userIds[follower]!, followingId: userIds[target]! });
      followerCounts[target]! += 1;
      followingCounts[follower]! += 1;
    }
  }

  await inBatches(
    follows,
    (chunk) => prisma.follow.createMany({ data: chunk, skipDuplicates: true }),
    'follows',
  );

  // --- posts ---------------------------------------------------------------
  const now = Date.now();
  const THIRTY_DAYS = 30 * 24 * 3_600_000;
  const postIds: string[] = [];

  const posts = Array.from({ length: POSTS }, (_, index) => {
    const id = crypto.randomUUID();
    postIds.push(id);
    // Popular accounts post more, which is also how it works in reality.
    const author = Math.random() < 0.4 ? pickPopular() : Math.floor(Math.random() * USERS);
    return {
      id,
      authorId: userIds[author]!,
      content: makeContent(index),
      createdAt: new Date(now - Math.random() * THIRTY_DAYS),
      likeCount: 0,
      commentCount: 0,
    };
  });

  await inBatches(posts, (chunk) => prisma.post.createMany({ data: chunk }), 'posts');

  // --- likes ---------------------------------------------------------------
  const likeSeen = new Set<string>();
  const likes: { userId: string; postId: string }[] = [];
  for (let i = 0; i < LIKES; i++) {
    const user = Math.floor(Math.random() * USERS);
    // Likes concentrate on a minority of posts, same as engagement does.
    const post = Math.random() < 0.7 ? Math.floor(Math.random() * (POSTS * 0.2)) : Math.floor(Math.random() * POSTS);
    const key = `${user}:${post}`;
    if (likeSeen.has(key)) continue;
    likeSeen.add(key);
    likes.push({ userId: userIds[user]!, postId: postIds[post]! });
  }

  await inBatches(likes, (chunk) => prisma.like.createMany({ data: chunk, skipDuplicates: true }), 'likes');

  // --- denormalized counters ----------------------------------------------
  // Set in bulk rather than per row: this is what the application maintains
  // transactionally at runtime, and it has to be correct for the fan-out
  // worker's push-vs-pull decision to mean anything.
  console.log('  updating counters...');
  await prisma.$executeRawUnsafe(`
    UPDATE "User" u SET
      "followerCount"  = (SELECT COUNT(*) FROM "Follow" f WHERE f."followingId" = u."id"),
      "followingCount" = (SELECT COUNT(*) FROM "Follow" f WHERE f."followerId"  = u."id"),
      "postCount"      = (SELECT COUNT(*) FROM "Post"   p WHERE p."authorId"    = u."id")
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "Post" p SET "likeCount" = (
      SELECT COUNT(*) FROM "Like" l WHERE l."postId" = p."id"
    )
  `);

  // The planner needs fresh statistics before the benchmark runs, otherwise
  // the first queries are planned against an empty-table estimate.
  await prisma.$executeRawUnsafe(`ANALYZE "User", "Follow", "Post", "Like"`);

  const promoted = await prisma.user.updateMany({
    where: { followerCount: { gt: THRESHOLD } },
    data: { isCelebrity: true },
  });

  const topAccounts = await prisma.user.findMany({
    orderBy: { followerCount: 'desc' },
    take: 5,
    select: { username: true, followerCount: true, isCelebrity: true },
  });

  console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`  users   ${USERS}`);
  console.log(`  follows ${follows.length}`);
  console.log(`  posts   ${POSTS}`);
  console.log(`  likes   ${likes.length}`);
  console.log(`  pull-path accounts (> ${THRESHOLD} followers): ${promoted.count}`);
  console.log('\n  most-followed:');
  for (const account of topAccounts) {
    console.log(`    @${account.username}  ${account.followerCount} followers`);
  }
  console.log(`\n  Password for every account: ${PASSWORD}`);
  console.log(`\n  Set FANOUT_THRESHOLD=${THRESHOLD} in apps/api/.env so the API agrees`);
  console.log('  with the flags this script just set, then run the benchmark.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
