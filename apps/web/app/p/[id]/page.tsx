'use client';

import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PostCard } from '@/components/PostCard';
import { PostSkeleton } from '@/components/Skeleton';
import { ArrowLeftIcon } from '@/components/icons';
import type { Post } from '@/lib/types';

/** Single post view, linked from notifications. */
export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['post', id, user?.id ?? 'anon'],
    enabled: !loading,
    queryFn: () => api<{ post: Post }>(`/api/posts/${id}`),
  });

  return (
    <div className="pt-6">
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-white"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to feed
      </Link>

      {(isLoading || loading) && <PostSkeleton />}

      {error && (
        <div className="card p-10 text-center">
          <p className="font-medium">This post is not available</p>
          <p className="mt-1 text-sm text-muted">{(error as Error).message}</p>
        </div>
      )}

      {data && <PostCard post={data.post} />}
    </div>
  );
}
