/** Standalone fan-out worker: `npm run dev:worker` */
import { env } from './env.js';
import { createLogger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import { closeQueue } from './feed/queue.js';
import { startFeedWorker } from './feed/worker.js';

const log = createLogger('worker');
const worker = await startFeedWorker();
log.info(`fan-out threshold: ${env.FANOUT_THRESHOLD} followers`);

async function shutdown(signal: string) {
  log.info(`${signal} received, finishing in-flight jobs`);
  await worker.close();
  await closeQueue();
  await disconnectPrisma();
  await disconnectRedis();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
