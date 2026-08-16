'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FollowButton } from '@/components/FollowButton';
import { PostCard } from '@/components/PostCard';
import { PostSkeletonList } from '@/components/Skeleton';
import { Spinner } from '@/components/icons';
import type { Post, User } from '@/lib/types';

type ProfileResponse = { user: User; isFollowing: boolean; isSelf: boolean };
type TimelineResponse = { posts: Post[]; nextCursor: string | null };

/** Chronological timeline, straight from Postgres - no ranking, no cache. */
export function ProfileBody({ username }: { username: string }) {
  const { user, loading } = useAuth();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
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

  if (isLoading || loading) return <PostSkeletonList count={2} />;

  return (
    <section className="space-y-3">
      {posts.length === 0 && (
        <div className="card p-10 text-center">
          <p className="font-medium">No posts yet</p>
          <p className="mt-1 text-sm text-muted">When {username} writes something, it lands here.</p>
        </div>
      )}

      {posts.map((item) => (
        <PostCard key={item.id} post={item} />
      ))}

      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="btn btn-ghost w-full py-2.5"
        >
          {isFetchingNextPage && <Spinner />}
          {isFetchingNextPage ? 'Loading' : 'Load more'}
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

  if (!data) return <div className="skeleton h-9 w-28 rounded-lg" />;

  return (
    <FollowButton username={username} initialFollowing={data.isFollowing} isSelf={data.isSelf} />
  );
}
