import type { Server } from 'socket.io';

/**
 * Routes need to push events without importing the Socket.io server (which
 * would drag the HTTP server into every module). The server registers itself
 * here at boot, and everything else emits through these helpers.
 *
 * If the realtime server was never started - the standalone worker process,
 * or a test - these are silent no-ops rather than crashes.
 */
let io: Server | null = null;

export const setRealtimeServer = (server: Server) => {
  io = server;
};

export const userRoom = (userId: string) => `user:${userId}`;
export const postRoom = (postId: string) => `post:${postId}`;

export type NotificationEvent = {
  id: string;
  type: string;
  postId: string | null;
  createdAt: string;
  actor: { username: string; displayName: string };
};

/** Delivered to every device the user has open. */
export function emitNotification(userId: string, notification: NotificationEvent) {
  io?.to(userRoom(userId)).emit('notification:new', notification);
}

/** Delivered only to clients currently looking at that post. */
export function emitLikeUpdate(postId: string, likeCount: number) {
  io?.to(postRoom(postId)).emit('post:like_update', { postId, likeCount });
}

export function emitCommentUpdate(postId: string, commentCount: number) {
  io?.to(postRoom(postId)).emit('post:comment_update', { postId, commentCount });
}
