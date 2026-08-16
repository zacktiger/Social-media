'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FollowButton } from '@/components/FollowButton';
import { PostCard } from '@/components/PostCard';
import type { Post, User } from '@/lib/types';

type ProfileResponse = { user: User; isFollowing: boolean; isSelf: boolean };
type TimelineResponse = { posts: Post[]; nextCursor: string | null };

/** Chronological timeline, straight from Postgres - no ranking, no cache. */
export function ProfileBody({ username }: { username: string }) {
  const { user, loading } = useAuth();

  const { data, fetchNextPage, hasNextPage, isLoading } = useInfiniteQuery({
    // These endpoints answer "did *you* like this", so the viewer is part of
    // the cache key and the request waits for the session to be restored.
    queryKey: ['timeline', username, user?.id ?? 'anon'],
    enabled: !loading,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<TimelineResponse>(
        `/api/users/${username}/posts?limit=10${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const posts = data?.pages.flatMap((page) => page.posts) ?? [];

  return (
    <section className="space-y-3">
      {isLoading && <p className="text-sm text-muted">Loading posts...</p>}
      {!isLoading && posts.length === 0 && (
        <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-muted">
          No posts yet.
        </p>
      )}

      {posts.map((item) => (
        <PostCard key={item.id} post={item} />
      ))}

      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          className="w-full rounded-md border border-edge py-2 text-sm text-muted hover:text-white"
        >
          Load more
        </button>
      )}
    </section>
  );
}

/**
 * The follow state depends on who is viewing, so it cannot come from the
 * server-rendered (cacheable, tokenless) half of the page.
 */
export function FollowSection({ username }: { username: string }) {
  const { user, loading } = useAuth();

  const { data } = useQuery({
    queryKey: ['profile', username, user?.id ?? 'anon'],
    // Without this the request goes out before the refresh cookie has been
    // exchanged for an access token, and the API answers as an anonymous
    // viewer - the button would render "Follow" for someone already following.
    enabled: !loading,
    queryFn: () => api<ProfileResponse>(`/api/users/${username}`),
  });

  if (!data) return null;

  return (
    <FollowButton username={username} initialFollowing={data.isFollowing} isSelf={data.isSelf} />
  );
}
