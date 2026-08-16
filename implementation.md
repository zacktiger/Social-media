# Pulse (working name) - Real-Time Social Feed
## Implementation Plan

Rename the repo to whatever you like. This doc assumes ~15-20 hrs/week of focused build time; compress or stretch phases as your schedule allows.

---

## 1. Overview

A follower-graph social platform (posts, follows, likes, comments) where the core engineering story is the **feed generation pipeline**, not the CRUD. This is deliberately positioned against ImageBoard X: that project is anonymous/ephemeral, this one is identity-based with a social graph. Together they show range.

The one thing this project needs to do well: generate a personalized, ranked feed for thousands of simulated users without falling back to `SELECT * FROM posts WHERE author_id IN (...) ORDER BY created_at`. That query is the thing every recruiter has seen in a tutorial clone. The hybrid fan-out approach below is what turns this into a systems-design talking point.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router), TanStack Query, Tailwind | SSR for public profile pages (SEO), client-heavy interaction for feed/infinite scroll |
| Backend API | Node.js + Express | Standalone REST service, consistent with your SaaS project, keeps backend engineering signal separate from frontend framework |
| Primary DB | PostgreSQL | Source of truth: users, posts, follows, likes, comments |
| ORM | Prisma | Consistent with URL Shortener; drop to `$queryRaw` for the feed merge query and tsvector search |
| Cache / Feed Store | Redis | Per-user feed ZSETs, rate limiting, session/refresh token blocklist |
| Job Queue | BullMQ (Redis-backed) | Async fan-out on post create, periodic score decay job |
| Real-time | Socket.io | Live notifications, live like/comment counts |
| Media | Multer + Sharp + S3 (or Cloudinary) | Upload, resize, CDN delivery |
| Search | Postgres `tsvector` + GIN, `pg_trgm` for usernames | No need for Elasticsearch/Meilisearch at this scale, and defending "why not just add a search engine" is itself a good interview answer |
| Auth | JWT (short-lived access) + refresh token rotation | Same pattern as your SaaS project, reuse the middleware |
| Load testing | k6 or autocannon | To generate real numbers for resume bullets, not estimates |

---

## 3. System Architecture

```
                     ┌─────────────┐
                     │   Next.js    │
                     │  (frontend)  │
                     └──────┬───────┘
                            │ REST + WS
                            ▼
                     ┌─────────────┐
                     │  Express API │
                     └──┬───────┬───┘
                        │       │
          ┌─────────────┘       └─────────────┐
          ▼                                     ▼
   ┌─────────────┐                       ┌─────────────┐
   │  PostgreSQL  │                       │    Redis     │
   │ (source of   │                       │ feed ZSETs,  │
   │   truth)     │                       │ rate limits, │
   └─────────────┘                       │ BullMQ queue │
                                           └──────┬──────┘
                                                  │
                                           ┌──────▼──────┐
                                           │ Fan-out      │
                                           │ Worker       │
                                           │ (BullMQ job) │
                                           └─────────────┘

   Socket.io server sits alongside Express, shares the JWT auth middleware.
   Media uploads go Express -> Sharp -> S3/Cloudinary -> CDN URL stored in Postgres.
```

---

## 4. Data Model

```prisma
model User {
  id           String   @id @default(cuid())
  username     String   @unique
  email        String   @unique
  passwordHash String
  displayName  String
  bio          String?
  avatarUrl    String?
  isCelebrity  Boolean  @default(false)   // crosses the fan-out threshold
  createdAt    DateTime @default(now())
}

model Follow {
  followerId  String
  followingId String
  createdAt   DateTime @default(now())
  @@id([followerId, followingId])
  @@index([followingId])
}

model Post {
  id           String   @id @default(cuid())
  authorId     String
  content      String
  mediaUrls    Json?
  likeCount    Int      @default(0)
  commentCount Int      @default(0)
  createdAt    DateTime @default(now())
  @@index([authorId, createdAt])
}

model Like {
  userId    String
  postId    String
  createdAt DateTime @default(now())
  @@id([userId, postId])
  @@index([postId])
}

model Comment {
  id        String   @id @default(cuid())
  postId    String
  authorId  String
  content   String
  createdAt DateTime @default(now())
  @@index([postId, createdAt])
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String   // like | comment | follow
  actorId   String
  postId    String?
  read      Boolean  @default(false)
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  tokenHash String
  expiresAt DateTime
  revoked   Boolean  @default(false)
}
```

Add via raw migration (Prisma doesn't model these natively):
- `posts.search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` + GIN index
- `pg_trgm` extension + trigram index on `users.username` for fuzzy search

---

## 5. Feed Generation: Hybrid Fan-out

This is the centerpiece. Two paths depending on the author's follower count.

**Write path (fan-out-on-write, for normal users):**
1. Post inserted into `posts` (source of truth).
2. A BullMQ job is enqueued (don't block the request on this).
3. Worker fetches the author's follower list.
4. If `follower_count <= FANOUT_THRESHOLD` (start with 5,000 for a portfolio project, tunable): `ZADD feed:{followerId} score post_id` for each follower.
5. If over threshold: mark `isCelebrity = true`, skip fan-out entirely. Their posts are never pushed.

**Read path (fan-in on the celebrity side):**
1. `GET /api/feed?cursor=` pulls top N post IDs from `feed:{userId}` via `ZREVRANGEBYSCORE`.
2. Separately, query which celebrities the user follows, and pull their recent posts directly from Postgres (`authorId IN (...) ORDER BY createdAt DESC`, indexed).
3. Merge both sets by score, apply cursor pagination, batch-fetch full post data.

**Ranking score** (recomputed incrementally on engagement, not per read):
```
score = (1 + likes*1 + comments*2) / (age_in_hours + 2)^1.8
```
Same shape as the Reddit/HN "hot" ranking. On a like/comment event, `ZINCRBY` the cached entry directly instead of recalculating the whole feed. A periodic job (every 10-15 min) re-decays scores for active feeds only, not the entire dataset.

This gives you a defensible answer to "why not just sort by timestamp": timestamp sort can't surface a post that's getting real engagement 20 minutes after posting, and pure engagement sort without decay lets old viral posts dominate forever.

---

## 6. API Endpoints

**Auth**
`POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/refresh` · `POST /api/auth/logout`

**Users**
`GET /api/users/:username` · `PATCH /api/users/me` · `GET /api/users/:username/followers` · `GET /api/users/:username/following` · `POST /api/users/:username/follow` · `DELETE /api/users/:username/follow`

**Posts**
`POST /api/posts` · `GET /api/posts/:id` · `DELETE /api/posts/:id` · `POST /api/posts/:id/like` · `DELETE /api/posts/:id/like` · `GET /api/posts/:id/comments` · `POST /api/posts/:id/comments`

**Feed**
`GET /api/feed?cursor=&limit=` · `GET /api/feed/profile/:username`

**Search**
`GET /api/search/posts?q=` · `GET /api/search/users?q=`

**Media**
`POST /api/media/upload`

**Notifications**
`GET /api/notifications?cursor=` · `PATCH /api/notifications/:id/read`

---

## 7. Real-Time Layer

- Socket.io handshake authenticated via the same JWT used for REST.
- Every client joins room `user:{id}` on connect.
- Client emits `post:subscribe` / `post:unsubscribe` for posts currently visible in viewport.
- Server emits:
  - `notification:new` to `user:{id}` on like/comment/follow
  - `post:like_update`, `post:comment_update` to room `post:{id}`

No polling anywhere in the app.

---

## 8. Media Pipeline

1. Client uploads via `POST /api/media/upload` (multipart, Multer memory storage).
2. Sharp generates three sizes: thumbnail (200px), feed (600px width), original (compressed, capped resolution).
3. All three pushed to S3/Cloudinary.
4. URLs stored as JSON on the post: `{ thumb, feed, original }`.
5. Served through CDN, never proxied through your API.

---

## 9. Search

- Full-text post search via `tsvector`/GIN, ranked with `ts_rank`.
- Username search via `pg_trgm` similarity for typo tolerance.
- Both are a single indexed Postgres query, no separate search infra to run or pay for.

---

## 10. Auth & Rate Limiting

- Access token: 15 min expiry. Refresh token: rotated on use, hashed at rest, revocation list in Redis. Same pattern as your SaaS project, so you're reusing and hardening middleware you've already written once.
- Rate limits (Redis-backed, `rate-limiter-flexible`): post create 10/min, like 60/min, comment 20/min, follow 30/min. Reads unthrottled behind auth.

---

## 11. Build Phases

| Phase | Deliverable | Est. |
|---|---|---|
| 0 | Repo scaffold, Docker Compose (Postgres + Redis), Prisma schema, auth boilerplate | 2-3 days |
| 1 | Core CRUD: users, posts, follow/unfollow, likes, comments. Feed still naive (JOIN + ORDER BY) | 4-5 days |
| 2 | Redis fan-out worker (BullMQ), hybrid feed read path, ranking score | 5-6 days |
| 3 | Socket.io: notifications, live counts | 3-4 days |
| 4 | Media pipeline: upload, Sharp, S3/Cloudinary | 3 days |
| 5 | Search: tsvector + trigram | 2 days |
| 6 | Rate limiting, structured logging, error handling hardening | 2-3 days |
| 7 | Load testing, deployment, capture real metrics | 3-4 days |

Total: roughly 24-30 focused days.

**Explicitly out of scope for v1** (don't let this creep in): DMs, stories/ephemeral content, video, mobile app, read replicas. These are believable "future work" bullet points in an interview, not things you need to ship.

---

## 12. Load Testing & Metrics Plan

Do this before writing a single resume bullet. Seed the DB with a synthetic dataset (e.g. 5,000 users, a Zipfian follower distribution so a few "celebrity" accounts exist, 50,000 posts). Then use k6 to:

- Hit `GET /api/feed` under concurrent load, measure p50/p95 latency with warm vs cold Redis cache.
- Compare feed read latency: hybrid fan-out vs a naive JOIN query on the same dataset. This comparison number is your headline bullet.
- Measure fan-out worker throughput: posts/sec it can push to follower ZSETs at your chosen threshold.

Only write numbers into your resume once you've actually measured them.

---

## 13. Repo Structure

```
/apps
  /web        (Next.js frontend)
  /api        (Express backend, Socket.io, BullMQ worker)
/packages
  /shared     (shared types between web and api, if using a monorepo tool like pnpm workspaces)
docker-compose.yml   (postgres, redis, local dev)
```

Keep it as a single repo with two apps rather than splitting into two separate GitHub repos, since it's easier to review as one system in an interview.

---

## 14. Resume Bullet Seeds (fill in only after measuring)

- Engineered a hybrid fan-out feed generation system (Redis ZSETs + Postgres fallback for high-follower accounts), reducing feed read latency from [X]ms to [Y]ms at [N] simulated users versus a naive join query.
- Built an async fan-out pipeline with BullMQ, processing [N] follower writes/sec on post creation without blocking the write path.
- Implemented a decay-based engagement ranking algorithm, recomputed incrementally via Redis ZINCRBY, avoiding full feed recalculation on every read.
- Added real-time notifications and live engagement counts via Socket.io, eliminating client-side polling across [N] concurrent connections.

---

Ping me once Phase 1 or 2 is working and I'll help you write the actual bullets, or help debug specific pieces as you build.