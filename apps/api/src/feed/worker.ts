import { Worker } from 'bullmq';
import { createLogger } from '../lib/logger.js';
import { queueConnection } from '../lib/redis.js';
import { processFeedJob } from './processors.js';
import { FEED_QUEUE, scheduleDecayJob } from './queue.js';

const log = createLogger('worker');

/**
 * Starts the fan-out worker. Called by the standalone `worker.ts` entry point,
 * or by the API process itself when INLINE_WORKER=true (handy in dev, so you
 * only have one terminal to watch).
 */
export async function startFeedWorker(concurrency = 5): Promise<Worker> {
  const worker = new Worker(FEED_QUEUE, processFeedJob, {
    connection: queueConnection,
    // Raise this to push more fan-out throughput. The ceiling is Postgres
    // follower-page reads, not Redis.
    concurrency,
  });

  worker.on('completed', (job, result) => log.info(`${job.name} #${job.id} ok`, result));
  worker.on('failed', (job, err) => log.error(`${job?.name} #${job?.id} failed: ${err.message}`));

  await scheduleDecayJob();
  log.info(`feed worker listening (concurrency ${concurrency})`);

  return worker;
}
