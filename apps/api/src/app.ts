import crypto from 'node:crypto';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './env.js';
import { rootLogger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './auth/routes.js';
import { usersRouter } from './users/routes.js';
import { postsRouter } from './posts/routes.js';
import { feedRouter } from './feed/routes.js';
import { notificationsRouter } from './notifications/routes.js';
import { mediaRouter } from './media/routes.js';
import { searchRouter } from './search/routes.js';

export function createApp() {
  const app = express();

  // Rate limiting keys off req.ip, which is the proxy's address unless this
  // is set. Behind more than one proxy hop, raise the number to match.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Images are served cross-origin to the web app on another port.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // credentials:true is required for the refresh-token cookie to cross from
  // the web app's origin to the API's.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use(
    pinoHttp({
      logger: rootLogger,
      // Every log line for a request shares this id, so one failure can be
      // traced across the request, the error, and anything it enqueued.
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = typeof existing === 'string' ? existing : crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  if (env.STORAGE === 'local') {
    // Development convenience only. With STORAGE=s3 the API never serves an
    // image byte - the CDN does, and this route does not exist.
    const uploadRoot = path.isAbsolute(env.UPLOAD_DIR)
      ? env.UPLOAD_DIR
      : path.join(env.apiRoot, env.UPLOAD_DIR);

    app.use(
      '/uploads',
      express.static(uploadRoot, {
        immutable: true,
        maxAge: '1y',
        fallthrough: false,
      }),
    );
  }

  app.get('/health', async (_req, res) => {
    const [db, cache] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    const healthy = db.status === 'fulfilled' && cache.status === 'fulfilled';
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      postgres: db.status === 'fulfilled',
      redis: cache.status === 'fulfilled',
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/posts', postsRouter);
  app.use('/api/feed', feedRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/media', mediaRouter);
  app.use('/api/search', searchRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
