/**
 * Fan-out worker throughput: how many follower-feed writes per second the
 * pipeline sustains, and how long a post takes to reach its followers.
 *
 *   node loadtest/fanout-bench.mjs --posts 40
 *
 * Needs the API + worker running and the load dataset seeded.
 */
import { Redis } from 'ioredis';

const API = process.env.API_URL ?? 'http://localhost:4000';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const POST_COUNT = arg('posts', 30);
const redis = new Redis(REDIS_URL);

async function login(username) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: 'loadtest123' }),
  });
  if (!res.ok) throw new Error(`login ${username} -> ${res.status}`);
  return res.json();
}

/**
 * Find an account with a lot of followers that is still on the push path.
 * A celebrity would be the wrong subject: the whole point of the flag is that
 * their posts are never fanned out at all.
 */
async function findBusyAuthor() {
  for (let index = 0; index < 400; index++) {
    const { accessToken, user } = await login(`load${index}`);
    const profile = await fetch(`${API}/api/users/${user.username}`).then((r) => r.json());
    if (!profile.user.isCelebrity && profile.user.followerCount >= 20) {
      return { accessToken, user: profile.user };
    }
  }
  throw new Error('No push-path account with enough followers found. Seed a larger dataset.');
}

async function queueDepth() {
  // BullMQ keeps waiting jobs in a list and active ones in another.
  const [waiting, active] = await Promise.all([
    redis.llen('bull:feed:wait'),
    redis.llen('bull:feed:active'),
  ]);
  return waiting + active;
}

console.log(`Fan-out benchmark against ${API}\n`);

const { accessToken, user } = await findBusyAuthor();
console.log(`  author        @${user.username}`);
console.log(`  followers     ${user.followerCount}`);
console.log(`  posts to send ${POST_COUNT}`);
console.log(`  expected feed writes: ${user.followerCount * POST_COUNT}\n`);

// Drain anything left over so the measurement starts from a quiet queue.
while ((await queueDepth()) > 0) await new Promise((resolve) => setTimeout(resolve, 100));

const writeLatencies = [];
const startedAt = performance.now();

for (let index = 0; index < POST_COUNT; index++) {
  const before = performance.now();
  const res = await fetch(`${API}/api/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ content: `fan-out benchmark post ${index} ${Date.now()}` }),
  });
  if (!res.ok) throw new Error(`post failed: ${res.status} ${await res.text()}`);
  writeLatencies.push(performance.now() - before);
}

const acceptedAt = performance.now();

// The API returned as soon as Postgres committed; the queue is still working.
while ((await queueDepth()) > 0) await new Promise((resolve) => setTimeout(resolve, 20));

const drainedAt = performance.now();

const sorted = [...writeLatencies].sort((a, b) => a - b);
const acceptMs = acceptedAt - startedAt;
const drainMs = drainedAt - startedAt;
const feedWrites = user.followerCount * POST_COUNT;

console.log(`  POST /api/posts p50   ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms`);
console.log(`  POST /api/posts p95   ${sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(1)} ms`);
console.log(`  all writes accepted   ${acceptMs.toFixed(0)} ms`);
console.log(`  queue fully drained   ${drainMs.toFixed(0)} ms`);
console.log(`  posts/sec (accepted)  ${((POST_COUNT / acceptMs) * 1000).toFixed(1)}`);
console.log(`  feed writes/sec       ${((feedWrites / drainMs) * 1000).toFixed(0)}`);
console.log(
  `\n  The gap between accepted (${acceptMs.toFixed(0)}ms) and drained (${drainMs.toFixed(0)}ms) is`,
);
console.log('  exactly the work the request path did not have to wait for.\n');

redis.disconnect();
