import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import {
  getFeedPage,
  getNaiveFeedPage,
  getRankedNoCacheFeedPage,
  rebuildFeed,
} from './read.js';
import { feedLength } from './store.js';

export const feedRouter = Router();

const feedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /**
   * Three ways to build the same page, so the load test compares them on one
   * dataset instead of against a remembered number:
   *   hybrid       push + pull + Redis ranking (what the app uses)
   *   naive        chronological join, no cache  (fast, but not ranked)
   *   ranked-live  the ranked feed computed from scratch on every read
   */
  mode: z.enum(['hybrid', 'naive', 'ranked-live']).default('hybrid'),
});

feedRouter.get('/', requireAuth, async (req, res) => {
  const { cursor, limit, mode } = feedQuerySchema.parse(req.query);
  const startedAt = performance.now();

  const page =
    mode === 'naive'
      ? await getNaiveFeedPage(req.userId!, { limit, cursor })
      : mode === 'ranked-live'
        ? await getRankedNoCacheFeedPage(req.userId!, { limit })
        : await getFeedPage(req.userId!, { limit, cursor });

  res.json({
    ...page,
    mode,
    tookMs: Number((performance.now() - startedAt).toFixed(2)),
  });
});

/** Debug helper: shows how many post ids are cached for the signed-in user. */
feedRouter.get('/status', requireAuth, async (req, res) => {
  res.json({ cachedPosts: await feedLength(req.userId!) });
});

/** Force a rebuild from Postgres. Useful after flushing Redis. */
feedRouter.post('/rebuild', requireAuth, async (req, res) => {
  const count = await rebuildFeed(req.userId!);
  res.json({ rebuilt: count });
});
