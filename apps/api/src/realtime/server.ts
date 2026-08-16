import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import { verifyAccessToken } from '../auth/tokens.js';
import { env } from '../env.js';
import { createLogger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { postRoom, setRealtimeServer, userRoom } from './emit.js';

const log = createLogger('socket');

/** A client cannot hold more post subscriptions than this. */
const MAX_POST_ROOMS = 200;

export function createRealtimeServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
  });

  // With more than one API instance, an emit on instance A has to reach a
  // socket connected to instance B. The Redis adapter is what makes that work;
  // without it, real-time silently breaks the moment you scale past one box.
  io.adapter(createAdapter(redis.duplicate(), redis.duplicate()));

  // Same JWT as REST. The token is sent in the handshake rather than a header
  // because the WebSocket upgrade request cannot carry an Authorization header
  // from the browser.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') return next(new Error('unauthorized'));
    try {
      socket.data.userId = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    socket.join(userRoom(userId));

    const subscriptions = new Set<string>();

    socket.on('post:subscribe', (postId: unknown) => {
      if (typeof postId !== 'string' || subscriptions.size >= MAX_POST_ROOMS) return;
      subscriptions.add(postId);
      socket.join(postRoom(postId));
    });

    socket.on('post:unsubscribe', (postId: unknown) => {
      if (typeof postId !== 'string') return;
      subscriptions.delete(postId);
      socket.leave(postRoom(postId));
    });

    socket.on('disconnect', () => subscriptions.clear());
  });

  setRealtimeServer(io);
  log.info('realtime server attached');

  return io;
}
