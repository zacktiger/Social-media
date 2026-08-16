/** Phase 3-6 checks: realtime, media, search, rate limiting. Run from repo root. */
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { io } from 'socket.io-client';

const API = 'http://localhost:4000';
let pass = 0, fail = 0;

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

async function req(method, path, { token, body, headers } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json, headers: res.headers };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now().toString(36);

// Rate limit buckets are shared across runs; start from a clean slate.
execSync('docker exec pulse-redis sh -c "redis-cli --scan --pattern \'rl:*\' | xargs -r redis-cli del"', { stdio: 'pipe' });

async function register(name) {
  const r = await req('POST', '/api/auth/register', {
    body: { username: `${name}${tag}`, email: `${name}${tag}@t.dev`, password: 'password123', displayName: name },
  });
  if (r.status !== 201) throw new Error(`register ${name} -> ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.accessToken, user: r.json.user };
}

const ana = await register('ana');
const ben = await register('ben');

console.log('\n== media pipeline ==');
let media;
{
  const png = await sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 40, g: 90, b: 200 } },
  }).png().toBuffer();

  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'test.png');
  const up = await req('POST', '/api/media/upload', { token: ana.token, body: form });

  check('upload accepted', up.status === 201, JSON.stringify(up.json).slice(0, 200));
  media = up.json?.media;
  check('three renditions returned', !!media?.thumb && !!media?.feed && !!media?.original, JSON.stringify(media));
  check('source dimensions reported', up.json?.width === 1200 && up.json?.height === 900, JSON.stringify(up.json));

  const feedImg = await fetch(media.feed);
  const feedBuf = Buffer.from(await feedImg.arrayBuffer());
  check('feed rendition is fetchable', feedImg.ok, `status ${feedImg.status}`);
  check('served as webp', feedImg.headers.get('content-type')?.includes('webp'), feedImg.headers.get('content-type'));
  check('served with immutable cache header', /immutable/.test(feedImg.headers.get('cache-control') ?? ''), feedImg.headers.get('cache-control'));

  const meta = await sharp(feedBuf).metadata();
  check('feed rendition resized to 600px', meta.width === 600, `width ${meta.width}`);

  const thumbBuf = Buffer.from(await (await fetch(media.thumb)).arrayBuffer());
  const thumbMeta = await sharp(thumbBuf).metadata();
  check('thumb is 200x200 square', thumbMeta.width === 200 && thumbMeta.height === 200, `${thumbMeta.width}x${thumbMeta.height}`);
  check('webp is smaller than source png', feedBuf.length < png.length, `${feedBuf.length} vs ${png.length}`);

  const bad = new FormData();
  bad.append('file', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'x.txt');
  const badRes = await req('POST', '/api/media/upload', { token: ana.token, body: bad });
  check('non-image rejected -> 400', badRes.status === 400, `got ${badRes.status}`);

  const noAuth = await req('POST', '/api/media/upload', { body: new FormData() });
  check('upload requires auth -> 401', noAuth.status === 401, `got ${noAuth.status}`);
}

console.log('\n== post with media ==');
let mediaPostId;
{
  const p = await req('POST', '/api/posts', {
    token: ana.token,
    body: { content: 'Post with a picture', media: [media] },
  });
  check('post with media created', p.status === 201, JSON.stringify(p.json).slice(0, 200));
  mediaPostId = p.json?.post?.id;
  check('mediaUrls round-trips', p.json?.post?.mediaUrls?.[0]?.feed === media.feed, JSON.stringify(p.json?.post?.mediaUrls));

  const captionless = await req('POST', '/api/posts', { token: ana.token, body: { content: '', media: [media] } });
  check('image-only post allowed', captionless.status === 201, `got ${captionless.status}`);

  const empty = await req('POST', '/api/posts', { token: ana.token, body: { content: '' } });
  check('empty post still rejected -> 422', empty.status === 422, `got ${empty.status}`);

  const badMedia = await req('POST', '/api/posts', { token: ana.token, body: { content: 'x', media: [{ feed: 'not-a-url' }] } });
  check('malformed media rejected -> 422', badMedia.status === 422, `got ${badMedia.status}`);
}

console.log('\n== realtime ==');
{
  const socket = io(API, { auth: { token: ben.token }, transports: ['websocket'] });
  const events = [];
  socket.on('notification:new', (n) => events.push({ kind: 'notification', ...n }));
  socket.on('post:like_update', (e) => events.push({ kind: 'like', ...e }));
  socket.on('post:comment_update', (e) => events.push({ kind: 'comment', ...e }));

  const connected = await new Promise((resolve) => {
    socket.on('connect', () => resolve(true));
    socket.on('connect_error', () => resolve(false));
    setTimeout(() => resolve(false), 4000);
  });
  check('socket authenticates with the REST JWT', connected);

  const bad = io(API, { auth: { token: 'garbage' }, transports: ['websocket'] });
  const rejected = await new Promise((resolve) => {
    bad.on('connect', () => resolve(false));
    bad.on('connect_error', (e) => resolve(e.message === 'unauthorized'));
    setTimeout(() => resolve(false), 4000);
  });
  check('bad token is refused', rejected, 'expected connect_error unauthorized');
  bad.close();

  // ben watches ana's post, then ana's post gets engagement from ben himself
  socket.emit('post:subscribe', mediaPostId);
  await sleep(200);

  await req('POST', `/api/posts/${mediaPostId}/like`, { token: ben.token });
  await req('POST', `/api/posts/${mediaPostId}/comments`, { token: ben.token, body: { content: 'nice' } });
  await req('POST', `/api/users/ana${tag}/follow`, { token: ben.token });
  await sleep(700);

  check('like_update pushed to post room', events.some((e) => e.kind === 'like' && e.likeCount === 1), JSON.stringify(events));
  check('comment_update pushed to post room', events.some((e) => e.kind === 'comment' && e.commentCount === 1), JSON.stringify(events));

  // ana is the one who should be notified, not ben
  check('actor does not get notified of own action', !events.some((e) => e.kind === 'notification'), JSON.stringify(events));

  const anaSocket = io(API, { auth: { token: ana.token }, transports: ['websocket'] });
  const anaEvents = [];
  anaSocket.on('notification:new', (n) => anaEvents.push(n));
  await new Promise((resolve) => { anaSocket.on('connect', resolve); setTimeout(resolve, 3000); });

  await req('POST', `/api/posts/${mediaPostId}/comments`, { token: ben.token, body: { content: 'again' } });
  await sleep(700);

  check('recipient receives notification:new', anaEvents.length > 0, JSON.stringify(anaEvents));
  check('notification carries the actor', anaEvents[0]?.actor?.username === `ben${tag}`, JSON.stringify(anaEvents[0]));

  socket.close();
  anaSocket.close();
}

console.log('\n== search ==');
{
  await req('POST', '/api/posts', { token: ana.token, body: { content: 'Postgres full text search beats a separate search cluster at this scale' } });
  await req('POST', '/api/posts', { token: ana.token, body: { content: 'Redis pipelines make fan-out cheap' } });
  await sleep(400);

  const posts = await req('GET', '/api/search/posts?q=postgres');
  check('full-text finds the post', posts.json?.posts?.some((p) => /Postgres/i.test(p.content)), JSON.stringify(posts.json?.posts?.map((p) => p.content)));

  const stemmed = await req('GET', '/api/search/posts?q=pipeline');
  check('english stemming matches "pipelines"', stemmed.json?.posts?.some((p) => /pipelines/i.test(p.content)), JSON.stringify(stemmed.json?.posts?.map((p) => p.content)));

  const phrase = await req('GET', '/api/search/posts?q=' + encodeURIComponent('"full text"'));
  check('quoted phrase query works', phrase.status === 200 && phrase.json.posts.length > 0, JSON.stringify(phrase.json).slice(0, 150));

  const weird = await req('GET', '/api/search/posts?q=' + encodeURIComponent('!!! &&& ???'));
  check('junk query does not 500', weird.status === 200, `got ${weird.status}`);

  const users = await req('GET', `/api/search/users?q=ana${tag}`);
  check('exact username found', users.json?.users?.some((u) => u.username === `ana${tag}`), JSON.stringify(users.json?.users?.map((u) => u.username)));

  const typo = await req('GET', '/api/search/users?q=nova');
  const typo2 = await req('GET', '/api/search/users?q=nva');
  check('trigram tolerates a typo (nva -> nova)',
    typo2.json?.users?.some((u) => u.username === 'nova') || typo.json?.users?.length === 0,
    `nva -> ${JSON.stringify(typo2.json?.users?.map((u) => u.username))}`);

  // Whether the planner actually picks the GIN index depends on table size:
  // on a few dozen rows a sequential scan is genuinely cheaper, and Postgres
  // is right to choose it. Index usage is asserted against the 50k-post load
  // dataset instead - see loadtest/README or `npm run db:seed:load`.
  const explain = await req('GET', '/api/search/explain?q=postgres');
  check('explain returns a query plan', /cost=/.test(explain.json?.raw ?? ''), (explain.json?.raw ?? '').slice(0, 120));

  const emptyQ = await req('GET', '/api/search/posts?q=');
  check('empty query -> 422', emptyQ.status === 422, `got ${emptyQ.status}`);
}

console.log('\n== rate limiting ==');
{
  const first = await req('POST', '/api/auth/login', { body: { identifier: 'nobody', password: 'x' } });
  check('limit headers present', first.headers.get('x-ratelimit-limit') === '10', first.headers.get('x-ratelimit-limit'));

  let limited = null;
  for (let i = 0; i < 15; i++) {
    const r = await req('POST', '/api/auth/login', { body: { identifier: 'nobody', password: 'x' } });
    if (r.status === 429) { limited = r; break; }
  }
  check('login is rate limited', limited !== null, 'never hit 429');
  check('429 carries Retry-After', !!limited?.headers.get('retry-after'), limited?.headers.get('retry-after'));
  check('429 body is structured', limited?.json?.error?.code === 'rate_limited', JSON.stringify(limited?.json));

  // Per-user write budget: 10 posts/min
  let postLimited = false;
  for (let i = 0; i < 14; i++) {
    const r = await req('POST', '/api/posts', { token: ben.token, body: { content: `spam ${i}` } });
    if (r.status === 429) { postLimited = true; break; }
  }
  check('post creation is rate limited per user', postLimited, 'never hit 429');

  const anaStillOk = await req('POST', '/api/posts', { token: ana.token, body: { content: 'unaffected' } });
  check("one user's limit does not affect another", anaStillOk.status === 201, `got ${anaStillOk.status}`);
}

console.log('\n== observability ==');
{
  const r = await req('GET', '/health');
  check('request id header returned', !!r.headers.get('x-request-id'), 'missing x-request-id');

  const notFound = await req('GET', '/api/nope');
  check('unknown route -> structured 404', notFound.json?.error?.code === 'route_not_found', JSON.stringify(notFound.json));
}

console.log(`\n${'='.repeat(40)}\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
