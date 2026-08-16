'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { FeedMode, FeedResponse } from '@/lib/types';
import { PostCard } from './PostCard';
import { PostSkeletonList } from './Skeleton';
import { Spinner } from './icons';

/**
 * All three read paths produce a page for the same viewer, which is the point
 * of exposing them here: switch between them and watch the timing chip while
 * the posts stay recognisably the same.
 */
const MODES: { value: FeedMode; label: string; hint: string }[] = [
  {
    value: 'hybrid',
    label: 'Hybrid',
    hint: 'Pre-ranked Redis feed merged with a Postgres pull for high-follower accounts',
  },
  {
    value: 'ranked-live',
    label: 'Ranked live',
    hint: 'The same ranked page, scored and sorted from scratch on every request',
  },
  {
    value: 'naive',
    label: 'Chronological',
    hint: 'A plain join ordered by time - a different page, and the fastest of the three',
  },
];

export function FeedList() {
  const [mode, setMode] = useState<FeedMode>('hybrid');
  const sentinel = useRef<HTMLDivElement>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch } =
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
  // The margin starts the fetch a screen early, so the spinner is usually gone
  // before the reader gets to it.
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const firstPage = data?.pages[0];
  const posts = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-3">
      <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 border-edge/70 bg-panel/50 p-2">
        <div
          role="group"
          aria-label="Feed read path"
          className="flex gap-0.5 rounded-lg bg-ink/60 p-0.5"
        >
          {MODES.map((option) => (
            <button
              key={option.value}
              onClick={() => setMode(option.value)}
              aria-pressed={mode === option.value}
              title={option.hint}
              className={`rounded-[7px] px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === option.value
                  ? 'bg-accent text-[#06111d]'
                  : 'text-muted hover:bg-white/5 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Instrumentation, straight off the response. It is the reason the
            mode switch is in the UI at all. */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {isLoading && !firstPage ? (
            <span className="chip text-faint">measuring…</span>
          ) : firstPage ? (
            <>
              <span className="chip" title="Server time for this page">
                <span className="tabular font-medium text-white">{firstPage.tookMs}</span> ms
              </span>
              {firstPage.meta && (
                <>
                  <span className="chip" title="Post ids read from this user's Redis ZSET">
                    pushed <span className="tabular">{firstPage.meta.fromCache}</span>
                  </span>
                  <span
                    className="chip"
                    title="Posts pulled from Postgres for high-follower accounts"
                  >
                    pulled <span className="tabular">{firstPage.meta.fromCelebrities}</span>
                  </span>
                  {firstPage.meta.rebuilt && (
                    <span
                      className="chip border-amber-500/30 bg-amber-500/10 text-amber-400"
                      title="This feed had expired, so it was rebuilt from Postgres on this read"
                    >
                      cache rebuilt
                    </span>
                  )}
                </>
              )}
            </>
          ) : null}
        </div>
      </div>

      {isLoading && <PostSkeletonList />}

      {error && (
        <div className="card p-6 text-center">
          <p className="text-sm text-rose-400">{(error as Error).message}</p>
          <button onClick={() => refetch()} className="btn btn-ghost mt-3">
            Try again
          </button>
        </div>
      )}

      {!isLoading && !error && posts.length === 0 && (
        <div className="card p-10 text-center">
          <p className="font-medium">Your feed is empty</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">
            Follow a few people, or write the first post above and watch it fan out.
          </p>
        </div>
      )}

      {posts.map((item) => (
        <PostCard key={item.id} post={item} />
      ))}

      <div ref={sentinel} aria-hidden="true" />

      {isFetchingNextPage && (
        <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted">
          <Spinner /> Loading more
        </p>
      )}

      {!isLoading && posts.length > 0 && !hasNextPage && (
        <p className="py-6 text-center text-sm text-faint">That is the end of the feed.</p>
      )}
    </section>
  );
}
