/**
 * Feed benchmark: hybrid fan-out vs the naive join, on the same dataset,
 * through the same HTTP stack.
 *
 *   node loadtest/bench.mjs
 *   node loadtest/bench.mjs --users 50 --requests 400 --concurrency 20
 *
 * Needs the API running and the load dataset seeded:
 *   npm run db:seed:load -w @pulse/api
 *
 * Plain Node with no dependencies on purpose - `node loadtest/bench.mjs` works
 * on a fresh clone. The k6 script next to this file does the same measurement
 * with proper VU scheduling if you have k6 installed.
 */

const API = process.env.API_URL ?? 'http://localhost:4000';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const USER_COUNT = arg('users', 30);
const REQUESTS = arg('requests', 300);
const CONCURRENCY = arg('concurrency', 15);
const PAGE_SIZE = arg('limit', 20);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(name, samples, elapsedMs) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return {
    name,
    n: samples.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean,
    max: sorted[sorted.length - 1],
    rps: (samples.length / elapsedMs) * 1000,
  };
}

async function login(username) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: 'loadtest123' }),
  });
  if (!res.ok) throw new Error(`login ${username} failed: ${res.status}`);
  return (await res.json()).accessToken;
}

async function timeFeed(token, mode) {
  const startedAt = performance.now();
  const res = await fetch(`${API}/api/feed?limit=${PAGE_SIZE}&mode=${mode}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  const elapsed = performance.now() - startedAt;
  if (!res.ok) throw new Error(`feed ${mode} -> ${res.status} ${JSON.stringify(body)}`);
  return { elapsed, items: body.items?.length ?? 0, serverMs: body.tookMs };
}

/** Fixed concurrency: `concurrency` workers pulling from one shared counter. */
async function run(tokens, mode, requests, concurrency) {
  const samples = [];
  const serverSamples = [];
  let issued = 0;
  let items = 0;
  const startedAt = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const index = issued++;
        if (index >= requests) return;
        const token = tokens[index % tokens.length];
        const result = await timeFeed(token, mode);
        samples.push(result.elapsed);
        if (typeof result.serverMs === 'number') serverSamples.push(result.serverMs);
        items += result.items;
      }
    }),
  );

  const elapsed = performance.now() - startedAt;
  const wall = summarize(mode, samples, elapsed);
  const server = serverSamples.length > 0 ? summarize(mode, serverSamples, elapsed) : null;

  return { ...wall, items, serverP50: server?.p50 ?? 0, serverP95: server?.p95 ?? 0 };
}

const pad = (value, width) => String(value).padStart(width);
const fixed = (value, digits = 1) => value.toFixed(digits);

function printTable(rows) {
  console.log(
    `\n  ${'path'.padEnd(16)}${pad('reqs', 6)}${pad('p50', 8)}${pad('p95', 8)}${pad('p99', 8)}${pad('req/s', 8)}  |${pad('srv p50', 9)}${pad('srv p95', 9)}`,
  );
  console.log(`  ${'-'.repeat(78)}`);
  for (const row of rows) {
    console.log(
      `  ${row.label.padEnd(16)}${pad(row.n, 6)}${pad(fixed(row.p50), 8)}${pad(fixed(row.p95), 8)}${pad(fixed(row.p99), 8)}${pad(fixed(row.rps), 8)}  |${pad(fixed(row.serverP50, 2), 9)}${pad(fixed(row.serverP95, 2), 9)}`,
    );
  }
  console.log('\n  left  = wall clock over HTTP, so it includes queueing behind one Node process');
  console.log('  srv   = time inside the handler, i.e. the feed work itself (ms)\n');
}

// --- run ---------------------------------------------------------------------

console.log(`Benchmarking ${API}`);
console.log(`  ${USER_COUNT} users, ${REQUESTS} requests per path, concurrency ${CONCURRENCY}\n`);

const health = await fetch(`${API}/health`).then((r) => r.json());
if (health.status !== 'ok') {
  console.error('API is not healthy:', health);
  process.exit(1);
}

console.log('Signing in...');
const tokens = await Promise.all(
  Array.from({ length: USER_COUNT }, (_, index) => login(`load${index}`)),
).catch((error) => {
  console.error(`\n${error.message}`);
  if (error.message.includes('429')) {
    console.error('\nThe login rate limiter is throttling the benchmark itself.');
    console.error('Restart the API with the budgets raised:');
    console.error('  RATE_LIMIT_MULTIPLIER=1000 npm run dev:api\n');
  } else {
    console.error('Did you run:  npm run db:seed:load -w @pulse/api');
  }
  process.exit(1);
});

const results = [];

// 1. Cold cache: no feed has been built yet, so the first hybrid read for each
//    user rebuilds it from Postgres. This is the worst case, not the headline.
console.log('Measuring hybrid, cold cache (rebuilding from Postgres)...');
const cold = await run(tokens, 'hybrid', tokens.length, Math.min(CONCURRENCY, tokens.length));
results.push({ ...cold, label: 'hybrid (cold)' });

// 2. Warm cache: the steady state, where the feed is one ZREVRANGEBYSCORE plus
//    a batch fetch of the page.
console.log('Measuring hybrid, warm cache...');
await run(tokens, 'hybrid', tokens.length, CONCURRENCY); // settle
const warm = await run(tokens, 'hybrid', REQUESTS, CONCURRENCY);
results.push({ ...warm, label: 'hybrid (warm)' });

// 3. Chronological baseline: the tutorial join. Fast, but it is not a ranked
//    feed - it is a different product, and the index does all the work.
console.log('Measuring naive chronological join...');
const naive = await run(tokens, 'naive', REQUESTS, CONCURRENCY);
results.push({ ...naive, label: 'naive (time)' });

// 4. The comparison that is actually like-for-like: the same ranked feed,
//    computed on every read with no cache.
console.log('Measuring ranked feed with no cache...');
const ranked = await run(tokens, 'ranked-live', REQUESTS, CONCURRENCY);
results.push({ ...ranked, label: 'ranked (live)' });

printTable(results);

console.log('  Same output, cache vs no cache:');
console.log(
  `    p50  ${fixed(ranked.p50)}ms -> ${fixed(warm.p50)}ms   ${fixed(ranked.p50 / warm.p50, 2)}x faster`,
);
console.log(
  `    p95  ${fixed(ranked.p95)}ms -> ${fixed(warm.p95)}ms   ${fixed(ranked.p95 / warm.p95, 2)}x faster`,
);
console.log(
  `    throughput  ${fixed(ranked.rps)} -> ${fixed(warm.rps)} req/s\n`,
);

console.log('  Different output, for reference:');
console.log(
  `    a chronological join is ${fixed(warm.p50 / naive.p50, 2)}x faster than the ranked cache`,
);
console.log('    at this dataset size, because [authorId, createdAt DESC] answers it directly.');
console.log('    It cannot rank, which is the whole reason the cache exists.\n');
console.log('  Numbers are from YOUR machine. Re-run before quoting them anywhere.\n');
