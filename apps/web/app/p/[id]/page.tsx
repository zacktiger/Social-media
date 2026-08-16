'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PostCard } from '@/components/PostCard';
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
      {(isLoading || loading) && <p className="text-sm text-muted">Loading post...</p>}
      {error && (
        <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-muted">
          {(error as Error).message}
        </p>
      )}
      {data && <PostCard post={data.post} />}
    </div>
  );
}
