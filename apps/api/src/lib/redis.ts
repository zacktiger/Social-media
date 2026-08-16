import { Redis } from 'ioredis';
import { env } from '../env.js';
import { createLogger } from './logger.js';

const log = createLogger('redis');

/**
 * Two connections on purpose:
 *  - `redis` for normal commands (feed ZSETs, cached lookups)
 *  - `queueConnection` for BullMQ, which needs `maxRetriesPerRequest: null`
 *    because its blocking commands must not time out.
 * Sharing one client between the two breaks BullMQ in subtle ways.
 */
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
});

export const queueConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redis.on('error', (err) => log.error('command connection error', err.message));
queueConnection.on('error', (err) => log.error('queue connection error', err.message));

export async function disconnectRedis() {
  await Promise.allSettled([redis.quit(), queueConnection.quit()]);
}
