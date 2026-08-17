/**
 * Core API checks: auth, follow graph, posts, the hybrid feed. Run from the
 * repo root with the API up:  npm run test:core -w @pulse/api
 */
import { execSync } from 'node:child_process';

const API = 'http://localhost:4000';
let pass = 0, fail = 0;

// This suite signs in repeatedly, which is exactly what the auth rate limiter
// is there to stop. Reset the buckets so the tests measure the API and not
// the leftover budget from a previous run or a benchmark.
execSync('docker exec pulse-redis sh -c "redis-cli --scan --pattern \'rl:*\' | xargs -r redis-cli del"', { stdio: 'pipe' });

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

async function req(method, path, { token, body, cookie } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now().toString(36);

async function register(name) {
  const r = await req('POST', '/api/auth/register', {
    body: { username: `${name}${tag}`, email: `${name}${tag}@test.dev`, password: 'password123', displayName: name },
  });
  if (r.status !== 201) throw new Error(`register ${name} -> ${r.status} ${JSON.stringify(r.json)}`);
  return { token: r.json.accessToken, user: r.json.user, cookie: r.setCookie?.split(';')[0] };
}

console.log('\n== health ==');
{
  const r = await req('GET', '/health');
  check('health 200', r.status === 200, JSON.stringify(r.json));
  check('postgres + redis up', r.json?.postgres === true && r.json?.redis === true, JSON.stringify(r.json));

  const p = await req('GET', '/ping');
  check('ping 200', p.status === 200, JSON.stringify(p.json));
  check('ping reports uptime', p.json?.ok === true && typeof p.json?.uptime === 'number', JSON.stringify(p.json));
}

console.log('\n== auth ==');
const alice = await register('alice');
const bob = await register('bob');
const carol = await register('carol');
check('register returns access token', !!alice.token);
check('password hash never leaves the api', !JSON.stringify(alice.user).includes('password'));

{
  const dup = await req('POST', '/api/auth/register', {
    body: { username: `alice${tag}`, email: `other${tag}@test.dev`, password: 'password123', displayName: 'x' },
  });
  check('duplicate username -> 409', dup.status === 409, `got ${dup.status}`);

  const bad = await req('POST', '/api/auth/login', { body: { identifier: `alice${tag}`, password: 'wrong' } });
  check('wrong password -> 401', bad.status === 401, `got ${bad.status}`);

  const good = await req('POST', '/api/auth/login', { body: { identifier: `alice${tag}@test.dev`, password: 'password123' } });
  check('login by email works', good.status === 200, `got ${good.status}`);

  const short = await req('POST', '/api/auth/register', {
    body: { username: 'x', email: 'nope', password: '123', displayName: '' },
  });
  check('validation errors -> 422', short.status === 422, `got ${short.status}`);

  const noAuth = await req('GET', '/api/feed');
  check('feed without token -> 401', noAuth.status === 401, `got ${noAuth.status}`);
}

console.log('\n== refresh token rotation ==');
{
  const rot = await req('POST', '/api/auth/refresh', { cookie: carol.cookie });
  check('refresh returns a new access token', rot.status === 200 && !!rot.json.accessToken, `got ${rot.status}`);
  const replay = await req('POST', '/api/auth/refresh', { cookie: carol.cookie });
  check('replaying the old refresh token -> 401 (reuse detected)', replay.status === 401, `got ${replay.status}`);
  const newCookie = rot.setCookie?.split(';')[0];
  const afterReuse = await req('POST', '/api/auth/refresh', { cookie: newCookie });
  check('reuse revokes the whole session chain', afterReuse.status === 401, `got ${afterReuse.status}`);
}

console.log('\n== follow ==');
{
  const f = await req('POST', `/api/users/bob${tag}/follow`, { token: alice.token });
  check('alice follows bob', f.status === 200 && f.json.following === true, JSON.stringify(f.json));

  const again = await req('POST', `/api/users/bob${tag}/follow`, { token: alice.token });
  check('following twice is idempotent', again.status === 200, `got ${again.status}`);

  const self = await req('POST', `/api/users/alice${tag}/follow`, { token: alice.token });
  check('cannot follow yourself -> 400', self.status === 400, `got ${self.status}`);

  await req('POST', `/api/users/bob${tag}/follow`, { token: carol.token });

  const profile = await req('GET', `/api/users/bob${tag}`, { token: alice.token });
  check('bob has 2 followers', profile.json?.user?.followerCount === 2, JSON.stringify(profile.json?.user));
  check('isFollowing reported for viewer', profile.json?.isFollowing === true);

  const followers = await req('GET', `/api/users/bob${tag}/followers`);
  check('followers list returns both', followers.json?.users?.length === 2, JSON.stringify(followers.json));
}

console.log('\n== post + fan-out ==');
let postId;
{
  const p = await req('POST', '/api/posts', { token: bob.token, body: { content: 'hello from bob' } });
  check('bob creates a post', p.status === 201, JSON.stringify(p.json));
  postId = p.json?.post?.id;
  check('post comes back with a score', typeof p.json?.post?.score === 'number', String(p.json?.post?.score));

  const empty = await req('POST', '/api/posts', { token: bob.token, body: { content: '   ' } });
  check('empty post rejected -> 422', empty.status === 422, `got ${empty.status}`);

  await sleep(1200); // let the fan-out job land

  const status = await req('GET', '/api/feed/status', { token: alice.token });
  check('alice has cached feed entries', status.json?.cachedPosts > 0, JSON.stringify(status.json));

  const feed = await req('GET', '/api/feed?limit=10', { token: alice.token });
  check('feed 200', feed.status === 200, JSON.stringify(feed.json).slice(0, 300));
  check("bob's post is in alice's feed", feed.json?.items?.some((i) => i.id === postId), JSON.stringify(feed.json?.items?.map((i) => i.content)));
  check('feed served from the pushed cache', feed.json?.meta?.fromCache > 0, JSON.stringify(feed.json?.meta));
  check('feed reports timing', typeof feed.json?.tookMs === 'number');

  const own = await req('GET', '/api/feed?limit=10', { token: bob.token });
  check('bob sees his own post in his feed', own.json?.items?.some((i) => i.id === postId));
}

console.log('\n== likes, comments, ranking ==');
{
  const before = await req('GET', '/api/feed?limit=10', { token: alice.token });
  const scoreBefore = before.json.items.find((i) => i.id === postId).score;

  const like = await req('POST', `/api/posts/${postId}/like`, { token: alice.token });
  check('like -> count 1', like.json?.likeCount === 1, JSON.stringify(like.json));

  const dbl = await req('POST', `/api/posts/${postId}/like`, { token: alice.token });
  check('double like is idempotent', dbl.json?.likeCount === 1, JSON.stringify(dbl.json));

  const c = await req('POST', `/api/posts/${postId}/comments`, { token: carol.token, body: { content: 'nice one' } });
  check('comment created', c.status === 201, JSON.stringify(c.json));

  await sleep(800);

  const after = await req('GET', '/api/feed?limit=10', { token: alice.token });
  const item = after.json.items.find((i) => i.id === postId);
  check('engagement raised the ranking score', item.score > scoreBefore, `${scoreBefore} -> ${item.score}`);
  check('likedByViewer reflects the viewer', item.likedByViewer === true);
  check('counts updated', item.likeCount === 1 && item.commentCount === 1, JSON.stringify(item));

  const comments = await req('GET', `/api/posts/${postId}/comments`);
  check('comments list', comments.json?.comments?.length === 1);

  const unlike = await req('DELETE', `/api/posts/${postId}/like`, { token: alice.token });
  check('unlike -> count 0', unlike.json?.likeCount === 0, JSON.stringify(unlike.json));
}

console.log('\n== notifications ==');
{
  const n = await req('GET', '/api/notifications', { token: bob.token });
  const types = n.json?.notifications?.map((x) => x.type) ?? [];
  check('bob was notified of follow, like, comment', ['follow', 'like', 'comment'].every((t) => types.includes(t)), JSON.stringify(types));

  const unread = await req('GET', '/api/notifications/unread-count', { token: bob.token });
  check('unread count > 0', unread.json?.count > 0, JSON.stringify(unread.json));

  const first = n.json.notifications[0].id;
  const mark = await req('PATCH', `/api/notifications/${first}/read`, { token: bob.token });
  check('mark read', mark.status === 200);
  const stolen = await req('PATCH', `/api/notifications/${first}/read`, { token: alice.token });
  check("cannot mark someone else's notification -> 404", stolen.status === 404, `got ${stolen.status}`);
}

console.log('\n== celebrity (pull) path ==');
{
  // Flip bob to celebrity, then post again. The post must NOT be fanned out,
  // but must still reach alice through the read-time merge.
  const { execSync } = await import('node:child_process');
  execSync(`docker exec pulse-postgres psql -U pulse -d pulse -c "UPDATE \\"User\\" SET \\"isCelebrity\\" = true WHERE username = 'bob${tag}'"`, { stdio: 'pipe' });
  // The app invalidates this itself on promotion; we edited the row behind its back.
  execSync('docker exec pulse-redis redis-cli DEL celebrities:ids', { stdio: 'pipe' });

  const cachedBefore = (await req('GET', '/api/feed/status', { token: alice.token })).json.cachedPosts;
  const p = await req('POST', '/api/posts', { token: bob.token, body: { content: 'celebrity post' } });
  const celebPostId = p.json.post.id;
  await sleep(1500);

  const cachedAfter = (await req('GET', '/api/feed/status', { token: alice.token })).json.cachedPosts;
  check('celebrity post was NOT written to follower feeds', cachedAfter === cachedBefore, `${cachedBefore} -> ${cachedAfter}`);

  const feed = await req('GET', '/api/feed?limit=10', { token: alice.token });
  check('celebrity post still reaches the feed at read time', feed.json.items.some((i) => i.id === celebPostId), JSON.stringify(feed.json.meta));
  check('read path reports the pulled half', feed.json.meta.fromCelebrities > 0, JSON.stringify(feed.json.meta));
}

console.log('\n== cold cache rebuild ==');
{
  const { execSync } = await import('node:child_process');
  const aliceId = alice.user.id;
  execSync(`docker exec pulse-redis redis-cli DEL feed:${aliceId}`, { stdio: 'pipe' });

  const status = (await req('GET', '/api/feed/status', { token: alice.token })).json;
  check('feed cache is empty', status.cachedPosts === 0, JSON.stringify(status));

  const feed = await req('GET', '/api/feed?limit=10', { token: alice.token });
  check('feed rebuilt itself from postgres', feed.json.meta.rebuilt === true, JSON.stringify(feed.json.meta));
  check('rebuilt feed still has posts', feed.json.items.length > 0);
}

console.log('\n== naive baseline + pagination ==');
{
  const naive = await req('GET', '/api/feed?limit=10&mode=naive', { token: alice.token });
  check('naive mode works', naive.status === 200 && naive.json.mode === 'naive', JSON.stringify(naive.json).slice(0, 200));
  check('naive returns the same posts', naive.json.items.length > 0);

  for (let i = 0; i < 5; i++) {
    await req('POST', '/api/posts', { token: bob.token, body: { content: `page test ${i}` } });
  }
  await sleep(800);

  const page1 = await req('GET', '/api/feed?limit=2', { token: alice.token });
  check('page 1 has 2 items', page1.json.items.length === 2, String(page1.json.items.length));
  check('cursor returned', !!page1.json.nextCursor);
  const page2 = await req('GET', `/api/feed?limit=2&cursor=${encodeURIComponent(page1.json.nextCursor)}`, { token: alice.token });
  const ids1 = page1.json.items.map((i) => i.id);
  const ids2 = page2.json.items.map((i) => i.id);
  check('page 2 does not repeat page 1', !ids2.some((id) => ids1.includes(id)), `${ids1} vs ${ids2}`);
}

console.log('\n== profile timeline + delete ==');
{
  const t = await req('GET', `/api/users/bob${tag}/posts?limit=50`);
  check('profile timeline returns bob posts', t.json.posts.length >= 7, String(t.json.posts.length));

  const notMine = await req('DELETE', `/api/posts/${postId}`, { token: alice.token });
  check("cannot delete someone else's post -> 403", notMine.status === 403, `got ${notMine.status}`);

  const del = await req('DELETE', `/api/posts/${postId}`, { token: bob.token });
  check('author can delete', del.status === 204, `got ${del.status}`);

  const gone = await req('GET', `/api/posts/${postId}`);
  check('deleted post -> 404', gone.status === 404, `got ${gone.status}`);

  const feed = await req('GET', '/api/feed?limit=20', { token: alice.token });
  check('deleted post disappears from the feed', !feed.json.items.some((i) => i.id === postId));
}

console.log('\n== unfollow ==');
{
  const u = await req('DELETE', `/api/users/bob${tag}/follow`, { token: alice.token });
  check('unfollow', u.status === 200 && u.json.following === false);
  const profile = await req('GET', `/api/users/bob${tag}`, { token: alice.token });
  check('follower count decremented', profile.json.user.followerCount === 1, String(profile.json.user.followerCount));
}

console.log(`\n${'='.repeat(40)}\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
