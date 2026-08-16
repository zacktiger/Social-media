/**
 * k6 version of the feed benchmark, with real VU scheduling and ramping.
 *
 *   k6 run loadtest/feed.k6.js
 *   k6 run -e MODE=naive loadtest/feed.k6.js
 *   k6 run -e VUS=100 -e DURATION=60s loadtest/feed.k6.js
 *
 * Install k6:  winget install k6  |  brew install k6  |  https://k6.io/docs
 *
 * Run it once per mode and compare the two `feed_latency` trends. The Node
 * script next to this file measures the same thing without installing k6, but
 * cannot model ramping VUs the way this does.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const API = __ENV.API_URL || 'http://localhost:4000';
const MODE = __ENV.MODE || 'hybrid';
const USERS = Number(__ENV.USERS || 50);
const VUS = Number(__ENV.VUS || 30);
const DURATION = __ENV.DURATION || '30s';

const feedLatency = new Trend('feed_latency', true);
const serverLatency = new Trend('feed_server_reported', true);
const emptyFeeds = new Rate('empty_feeds');

export const options = {
  scenarios: {
    feed: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '10s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Deliberately loose. Tighten once you know what your own box does.
    feed_latency: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

/** Runs once, before any VU starts: sign every synthetic user in. */
export function setup() {
  const tokens = [];
  for (let i = 0; i < USERS; i++) {
    const res = http.post(
      `${API}/api/auth/login`,
      JSON.stringify({ identifier: `load${i}`, password: 'loadtest123' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (res.status === 200) tokens.push(res.json('accessToken'));
  }
  if (tokens.length === 0) {
    throw new Error('No logins succeeded. Run: npm run db:seed:load -w @pulse/api');
  }
  console.log(`signed in ${tokens.length} users, mode=${MODE}`);
  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU + __ITER) % data.tokens.length];

  const res = http.get(`${API}/api/feed?limit=20&mode=${MODE}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { mode: MODE },
  });

  feedLatency.add(res.timings.duration);

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has items': (r) => {
      try {
        return Array.isArray(r.json('items'));
      } catch {
        return false;
      }
    },
  });

  if (ok) {
    const items = res.json('items');
    emptyFeeds.add(items.length === 0);
    const took = res.json('tookMs');
    if (typeof took === 'number') serverLatency.add(took);
  }

  sleep(0.1);
}
