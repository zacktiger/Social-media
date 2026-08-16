'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSocketEvent } from '@/lib/socket';
import { useDismiss } from '@/lib/use-dismiss';
import { fullDate, timeAgo, type User } from '@/lib/types';
import { Avatar } from './Avatar';
import { BellIcon, CommentIcon, HeartIcon, UserPlusIcon } from './icons';

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

/** Small glyph over the actor's avatar, so the row is scannable without reading it. */
function TypeBadge({ type }: { type: string }) {
  const style =
    type === 'like'
      ? 'bg-like text-white'
      : type === 'comment'
        ? 'bg-accent text-[#06111d]'
        : 'bg-emerald-500 text-white';

  return (
    <span
      className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-panel ${style}`}
      aria-hidden="true"
    >
      {type === 'like' ? (
        <HeartIcon className="h-2.5 w-2.5" filled />
      ) : type === 'comment' ? (
        <CommentIcon className="h-2.5 w-2.5" />
      ) : (
        <UserPlusIcon className="h-2.5 w-2.5" />
      )}
    </span>
  );
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  useDismiss(container, () => setOpen(false), open);

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api<{ count: number }>('/api/notifications/unread-count'),
    enabled: !!user,
  });

  const { data: list, isLoading } = useQuery({
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
    <div className="relative" ref={container}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ''}`}
        className={`relative rounded-lg p-2 transition-colors hover:bg-white/5 hover:text-white ${
          open ? 'bg-white/5 text-white' : 'text-muted'
        }`}
      >
        <BellIcon />
        {count > 0 && (
          <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-ink bg-accent px-1 text-[10px] font-semibold text-[#06111d]">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="card absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] animate-rise overflow-hidden p-1 shadow-2xl shadow-black/50"
        >
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="text-sm font-medium">Notifications</span>
            {count > 0 && (
              <button
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="text-xs text-muted transition-colors hover:text-white disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto p-1">
            {isLoading && (
              <div className="space-y-2 p-2" role="status" aria-label="Loading notifications">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="flex items-center gap-2.5">
                    <div className="skeleton h-8 w-8 rounded-full" />
                    <div className="skeleton h-3 flex-1" />
                  </div>
                ))}
              </div>
            )}

            {list?.notifications.length === 0 && (
              <div className="px-3 py-8 text-center">
                <BellIcon className="mx-auto h-6 w-6 text-faint" />
                <p className="mt-2 text-sm text-muted">Nothing yet</p>
                <p className="mt-0.5 text-xs text-faint">
                  Likes, comments and follows land here in real time.
                </p>
              </div>
            )}

            {list?.notifications.map((item) => (
              <Link
                key={item.id}
                href={item.postId ? `/p/${item.postId}` : `/u/${item.actor.username}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-white/5 ${
                  item.read ? 'text-muted' : ''
                }`}
              >
                <span className="relative shrink-0">
                  <Avatar user={item.actor} size="sm" />
                  <TypeBadge type={item.type} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="font-medium">{item.actor.displayName}</span>{' '}
                  {VERB[item.type] ?? item.type}
                  <time
                    dateTime={item.createdAt}
                    title={fullDate(item.createdAt)}
                    className="ml-1.5 text-xs text-faint"
                  >
                    {timeAgo(item.createdAt)}
                  </time>
                </span>

                {!item.read && (
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent"
                    aria-label="Unread"
                  />
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
