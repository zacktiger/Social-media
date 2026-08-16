'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, getAccessToken, refreshSession } from './api';

let socket: Socket | null = null;
let retriedAfterRefresh = false;

/**
 * One socket for the whole tab. Every component subscribes to it rather than
 * opening its own connection - a feed of 20 posts should not mean 20 sockets.
 */
export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(API_URL, {
    autoConnect: false,
    transports: ['websocket'],
    // A function (not an object) so the CURRENT token is read on every
    // reconnect attempt. With a fixed object, a socket that drops after the
    // 15-minute access token expired would retry forever with a dead token.
    auth: (cb) => cb({ token: getAccessToken() }),
  });

  socket.on('connect', () => {
    retriedAfterRefresh = false;
  });

  socket.on('connect_error', async (error) => {
    if (error.message !== 'unauthorized' || retriedAfterRefresh) return;
    // Refresh once, then let the normal reconnect logic take over. The guard
    // is what stops a failed refresh from becoming a reconnect loop.
    retriedAfterRefresh = true;
    if (await refreshSession()) socket?.connect();
  });

  return socket;
}

export function connectSocket(): Socket {
  const instance = getSocket();
  if (!instance.connected) instance.connect();
  return instance;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  retriedAfterRefresh = false;
}

/** Subscribe to a server event for as long as the component is mounted. */
export function useSocketEvent<T>(event: string, handler: (payload: T) => void, enabled = true) {
  // The handler is a new closure on every render; keeping it in a ref means
  // the listener is attached once instead of being torn down and re-added.
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const instance = getSocket();
    const listener = (payload: T) => latest.current(payload);
    instance.on(event, listener);
    return () => {
      instance.off(event, listener);
    };
  }, [event, enabled]);
}

/**
 * Joins the room for one post while it is on screen, so a busy post only
 * pushes updates to the clients actually looking at it.
 */
export function usePostRoom(postId: string, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const instance = getSocket();
    instance.emit('post:subscribe', postId);
    return () => {
      instance.emit('post:unsubscribe', postId);
    };
  }, [postId, enabled]);
}
