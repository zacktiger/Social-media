import type { NextFunction, Request, Response } from 'express';
import { RateLimiterRedis, type RateLimiterRes } from 'rate-limiter-flexible';
import { env } from '../env.js';
import { HttpError } from '../lib/http-error.js';
import { createLogger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

const log = createLogger('ratelimit');

type Scope = 'user' | 'ip';

/**
 * Redis-backed so the budget is shared across API instances - an in-process
 * counter would give an attacker one full allowance per instance.
 *
 * Writes are limited per authenticated user; auth endpoints are limited per IP,
 * because before you sign in there is no user to attribute the request to.
 */
function createLimiter(
  name: string,
  basePoints: number,
  durationSeconds: number,
  scope: Scope = 'user',
) {
  const points = Math.ceil(basePoints * env.RATE_LIMIT_MULTIPLIER);

  const limiter = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: `rl:${name}`,
    points,
    duration: durationSeconds,
  });

  return async function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = scope === 'user' && req.userId ? `u:${req.userId}` : `ip:${req.ip ?? 'unknown'}`;

    try {
      const result = await limiter.consume(key);
      res.setHeader('X-RateLimit-Limit', points);
      res.setHeader('X-RateLimit-Remaining', result.remainingPoints);
      next();
    } catch (err) {
      // A rejection carries the limiter state; a real Error means Redis itself
      // failed. Rate limiting is a guard rail, not a correctness requirement,
      // so an unreachable Redis lets the request through with a loud warning
      // rather than taking the whole API down with it.
      if (err instanceof Error) {
        log.warn(`limiter ${name} unavailable, allowing request`, err.message);
        return next();
      }

      const rejection = err as RateLimiterRes;
      const retryAfter = Math.ceil(rejection.msBeforeNext / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.setHeader('X-RateLimit-Limit', points);
      res.setHeader('X-RateLimit-Remaining', 0);

      next(
        new HttpError(
          429,
          `Too many requests. Try again in ${retryAfter}s.`,
          'rate_limited',
        ),
      );
    }
  };
}

// Write budgets, per signed-in user.
export const limitPostCreate = createLimiter('post', 10, 60);
export const limitLike = createLimiter('like', 60, 60);
export const limitComment = createLimiter('comment', 20, 60);
export const limitFollow = createLimiter('follow', 30, 60);
export const limitUpload = createLimiter('upload', 20, 3600);

// Per IP: these run before anyone is authenticated.
export const limitAuth = createLimiter('auth', 10, 900, 'ip');
export const limitRegister = createLimiter('register', 10, 3600, 'ip');
export const limitSearch = createLimiter('search', 60, 60, 'ip');
