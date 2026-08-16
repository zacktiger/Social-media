'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSocketEvent } from '@/lib/socket';
import { timeAgo, type User } from '@/lib/types';

type Notification = {
  id: string;
  type: 'like' | 'comment' | 'follow' | string;
  postId: string | null;
  read: boolean;
  createdAt: string;
  actor: User;
};

const VERB: Record<string, string> = {
  like: 'liked your post',
  comment: 'commented on your post',
  follow: 'started following you',
};

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api<{ count: number }>('/api/notifications/unread-count'),
    enabled: !!user,
  });

  const { data: list } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api<{ notifications: Notification[] }>('/api/notifications?limit=15'),
    enabled: !!user && open,
  });

  // Pushed by the server the moment someone likes, comments, or follows.
  // There is no polling anywhere in this app.
  useSocketEvent<Notification>(
    'notification:new',
    () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    !!user,
  );

  const markAll = useMutation({
    mutationFn: () => post('/api/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!user) return null;
  const count = unread?.count ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="relative rounded-md border border-edge px-3 py-1.5 text-muted hover:text-white"
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
      >
        Alerts
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-accent px-1.5 text-xs font-semibold text-ink">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-edge bg-panel p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-medium">Notifications</span>
            {count > 0 && (
              <button
                onClick={() => markAll.mutate()}
                className="text-xs text-muted hover:text-white"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {list?.notifications.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted">Nothing yet.</p>
            )}

            {list?.notifications.map((item) => (
              <Link
                key={item.id}
                href={item.postId ? `/p/${item.postId}` : `/u/${item.actor.username}`}
                onClick={() => setOpen(false)}
                className={`block rounded-lg px-2 py-2 text-sm hover:bg-ink ${
                  item.read ? 'text-muted' : ''
                }`}
              >
                <span className="font-medium">{item.actor.displayName}</span>{' '}
                {VERB[item.type] ?? item.type}
                <span className="ml-1 text-xs text-muted">{timeAgo(item.createdAt)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
