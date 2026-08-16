/**
 * Small demo dataset: enough accounts, follows and posts to make the feed
 * look alive and to exercise both halves of the hybrid read path.
 *
 * This is NOT the load-testing dataset. That one (thousands of users with a
 * Zipfian follower distribution) belongs with the k6 work in a later phase.
 *
 * Run with:  npm run db:seed -w @pulse/api
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { env } from '../src/env.js';

const prisma = new PrismaClient();
const redis = new Redis(env.REDIS_URL);

/** Feeds are derived from Postgres, so a reseed must drop them too. */
async function clearFeedCache() {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'feed:*', 'COUNT', 500);
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== '0');

  await redis.del('celebrities:ids', 'feeds:active');
}

const PASSWORD = 'password123';

const PEOPLE = [
  ['nova', 'Nova Reyes', 'Distributed systems, coffee, and long walks through flame graphs.'],
  ['kai', 'Kai Almeida', 'Backend engineer. Postgres apologist.'],
  ['juno', 'Juno Park', 'Frontend. Making loading states nobody notices.'],
  ['rex', 'Rex Okafor', 'SRE. On call so you do not have to be.'],
  ['iris', 'Iris Volkov', 'Data engineer. Pipelines all the way down.'],
  ['milo', 'Milo Tanaka', 'Writes Rust, dreams in ownership.'],
  ['sage', 'Sage Dubois', 'Security. Assume breach.'],
  ['wren', 'Wren Castillo', 'Mobile dev. Battery life enthusiast.'],
] as const;

const POSTS = [
  'Spent the morning staring at a query plan. It was a sequential scan the whole time.',
  'Hot take: most caching bugs are actually invalidation bugs wearing a trench coat.',
  'Shipped a change that deleted 400 lines and fixed two bugs. Best kind of PR.',
  'The p99 was the monitoring, not the service. Classic.',
  'Reminder that an index you never query is just a write tax.',
  'Rewrote a cron job as a queue consumer and cut the runtime by half.',
  'Every distributed system is a group chat where somebody always misses a message.',
  'Turns out the retry storm was us retrying our own retries.',
  'Reading the source beats reading the docs more often than I would like to admit.',
  'The fan-out worker is finally keeping up with the write path.',
  'Nothing humbles you like a flaky test that only fails on Tuesdays.',
  'Migrated to cursor pagination. Offsets do not survive contact with real data.',
  'A queue is just a promise you make to your future self.',
  'Named a variable well today. That was the whole win.',
  'Load testing is how you find out which assumption was doing all the work.',
  'The cache hit rate went up because we stopped caching the wrong thing.',
];

async function main() {
  console.log('Clearing existing data...');
  await clearFeedCache();
  // Order matters only where cascades do not cover it.
  await prisma.notification.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.like.deleteMany();
  await prisma.post.deleteMany();
  await prisma.follow.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  console.log(`Creating ${PEOPLE.length} users...`);
  const users = await Promise.all(
    PEOPLE.map(([username, displayName, bio]) =>
      prisma.user.create({
        data: { username, displayName, bio, email: `${username}@pulse.dev`, passwordHash },
      }),
    ),
  );

  const byName = Object.fromEntries(users.map((user) => [user.username, user]));

  console.log('Building the follow graph...');
  const follows: { followerId: string; followingId: string }[] = [];
  for (const follower of users) {
    for (const following of users) {
      if (follower.id === following.id) continue;
      // Everyone follows nova; everyone else gets followed about half the time.
      if (following.username === 'nova' || Math.random() < 0.5) {
        follows.push({ followerId: follower.id, followingId: following.id });
      }
    }
  }
  await prisma.follow.createMany({ data: follows });

  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        followerCount: follows.filter((f) => f.followingId === user.id).length,
        followingCount: follows.filter((f) => f.followerId === user.id).length,
      },
    });
  }

  console.log('Writing posts...');
  const now = Date.now();
  const posts = await Promise.all(
    POSTS.map((content, index) => {
      const author = users[index % users.length]!;
      return prisma.post.create({
        data: {
          authorId: author.id,
          content,
          // Spread over the last two days so the decay term has something to do.
          createdAt: new Date(now - index * 3 * 3_600_000 - Math.random() * 3_600_000),
        },
      });
    }),
  );

  console.log('Adding likes and comments...');
  for (const post of posts) {
    const likers = users.filter((user) => user.id !== post.authorId && Math.random() < 0.45);
    if (likers.length > 0) {
      await prisma.like.createMany({
        data: likers.map((user) => ({ userId: user.id, postId: post.id })),
      });
      await prisma.post.update({
        where: { id: post.id },
        data: { likeCount: likers.length },
      });
    }

    if (Math.random() < 0.4) {
      const commenter = users[Math.floor(Math.random() * users.length)]!;
      await prisma.comment.create({
        data: { postId: post.id, authorId: commenter.id, content: 'Same experience here.' },
      });
      await prisma.post.update({
        where: { id: post.id },
        data: { commentCount: { increment: 1 } },
      });
    }
  }

  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: { postCount: posts.filter((post) => post.authorId === user.id).length },
    });
  }

  // In production this flag is flipped by the follow route once an account
  // crosses FANOUT_THRESHOLD followers. A demo dataset is nowhere near that,
  // so one account is marked by hand to make the pull path visible in the UI.
  await prisma.user.update({ where: { id: byName.nova!.id }, data: { isCelebrity: true } });

  console.log('\nSeed complete.');
  console.log(`  users:   ${users.length}`);
  console.log(`  follows: ${follows.length}`);
  console.log(`  posts:   ${posts.length}`);
  console.log(`\n  Sign in as any of: ${PEOPLE.map(([u]) => u).join(', ')}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`\n  @nova is flagged as a celebrity (real threshold: ${env.FANOUT_THRESHOLD}),`);
  console.log('  so her posts are pulled at read time instead of fanned out.');
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
