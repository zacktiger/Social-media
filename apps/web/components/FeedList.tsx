'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { FeedResponse } from '@/lib/types';
import { PostCard } from './PostCard';

type Mode = 'hybrid' | 'naive';

export function FeedList() {
  const [mode, setMode] = useState<Mode>('hybrid');
  const sentinel = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error } =
    useInfiniteQuery({
      queryKey: ['feed', mode],
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) =>
        api<FeedResponse>(
          `/api/feed?limit=10&mode=${mode}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        ),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    });

  // Infinite scroll: load the next page when the sentinel enters the viewport.
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const firstPage = data?.pages[0];
  const posts = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-panel/50 px-3 py-2 text-xs text-muted">
        <span className="font-medium text-white">Feed path</span>
        {(['hybrid', 'naive'] as Mode[]).map((value) => (
          <button
            key={value}
            onClick={() => setMode(value)}
            className={`rounded px-2 py-1 ${
              mode === value ? 'bg-accent text-ink' : 'border border-edge hover:text-white'
            }`}
          >
            {value === 'hybrid' ? 'hybrid fan-out' : 'naive join'}
          </button>
        ))}

        {firstPage && (
          <span className="ml-auto flex gap-3">
            <span>{firstPage.tookMs} ms</span>
            {firstPage.meta && (
              <>
                <span title="Post ids read from this user's Redis ZSET">
                  pushed {firstPage.meta.fromCache}
                </span>
                <span title="Posts pulled from Postgres for high-follower accounts">
                  pulled {firstPage.meta.fromCelebrities}
                </span>
                {firstPage.meta.rebuilt && <span className="text-amber-400">cache rebuilt</span>}
              </>
            )}
          </span>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted">Loading feed...</p>}
      {error && <p className="text-sm text-red-400">{(error as Error).message}</p>}

      {!isLoading && posts.length === 0 && (
        <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-muted">
          Nothing here yet. Follow someone, or write the first post.
        </p>
      )}

      {posts.map((item) => (
        <PostCard key={item.id} post={item} />
      ))}

      <div ref={sentinel} className="h-10" />
      {isFetchingNextPage && <p className="text-center text-sm text-muted">Loading more...</p>}
    </section>
  );
}
