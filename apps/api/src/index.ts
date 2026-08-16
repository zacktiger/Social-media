import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './env.js';
import { createLogger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import { closeQueue } from './feed/queue.js';
import { startFeedWorker } from './feed/worker.js';
import { createRealtimeServer } from './realtime/server.js';

const log = createLogger('api');

// Socket.io shares the HTTP server with Express, so both live on one port and
// the WebSocket upgrade needs no separate origin or proxy rule.
const httpServer = createServer(createApp());
const io = createRealtimeServer(httpServer);

httpServer.listen(env.PORT, () => {
  log.info(`listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// In production the worker runs as its own process so fan-out load can be
// scaled separately from request load. In dev, one terminal is nicer.
const worker = env.INLINE_WORKER ? await startFeedWorker() : null;

async function shutdown(signal: string) {
  log.info(`${signal} received, shutting down`);
  await io.close();
  httpServer.close();
  if (worker) await worker.close();
  await closeQueue();
  await disconnectPrisma();
  await disconnectRedis();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
