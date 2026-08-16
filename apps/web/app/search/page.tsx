'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Avatar } from '@/components/Avatar';
import { PostCard } from '@/components/PostCard';
import { PostSkeletonList, UserRowSkeleton } from '@/components/Skeleton';
import { SearchIcon } from '@/components/icons';
import { compactCount, type Post, type User } from '@/lib/types';

type Tab = 'posts' | 'users';

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <SearchIcon className="mx-auto h-6 w-6 text-faint" />
      <p className="mt-3 text-sm text-muted">{children}</p>
    </div>
  );
}

function SearchResults() {
  const params = useSearchParams();
  const query = params.get('q') ?? '';
  const [tab, setTab] = useState<Tab>('posts');

  const posts = useQuery({
    queryKey: ['search', 'posts', query],
    queryFn: () => api<{ posts: Post[] }>(`/api/search/posts?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0 && tab === 'posts',
  });

  const users = useQuery({
    queryKey: ['search', 'users', query],
    queryFn: () => api<{ users: User[] }>(`/api/search/users?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0 && tab === 'users',
  });

  if (!query) {
    return (
      <div className="pt-10">
        <EmptyState>
          Search posts and people from the box above, or press <kbd className="chip">/</kbd> from
          anywhere.
        </EmptyState>
      </div>
    );
  }

  const active = tab === 'posts' ? posts : users;

  return (
    <div className="animate-fade-in space-y-4 pt-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">
          Results for <span className="text-accent">{query}</span>
        </h1>
        <p className="mt-0.5 text-xs text-faint">
          {/* Which index answered this is the interesting part of the feature. */}
          {tab === 'posts'
            ? 'Full-text over a generated tsvector column, ranked by ts_rank'
            : 'Trigram similarity on username and display name, so typos still match'}
        </p>
      </div>

      <div role="tablist" aria-label="Result type" className="flex gap-0.5 rounded-lg bg-ink/60 p-0.5 w-fit">
        {(['posts', 'users'] as Tab[]).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`rounded-[7px] px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === value
                ? 'bg-accent text-[#06111d]'
                : 'text-muted hover:bg-white/5 hover:text-white'
            }`}
          >
            {value === 'posts' ? 'Posts' : 'People'}
          </button>
        ))}
      </div>

      {active.isLoading && (tab === 'posts' ? <PostSkeletonList count={2} /> : <UserRowSkeleton />)}

      {active.error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {(active.error as Error).message}
        </p>
      )}

      {tab === 'posts' && posts.data && (
        <div className="space-y-3">
          {posts.data.posts.length === 0 && <EmptyState>No posts match “{query}”.</EmptyState>}
          {posts.data.posts.map((item) => (
            <PostCard key={item.id} post={item} />
          ))}
        </div>
      )}

      {tab === 'users' && users.data && (
        <div className="space-y-2">
          {users.data.users.length === 0 && <EmptyState>Nobody matches “{query}”.</EmptyState>}
          {users.data.users.map((person) => (
            <Link
              key={person.id}
              href={`/u/${person.username}`}
              className="card flex items-center gap-3 p-4 transition-colors hover:border-accent/50"
            >
              <Avatar user={person} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{person.displayName}</p>
                <p className="truncate text-sm text-muted">@{person.username}</p>
                {person.bio && <p className="mt-1 line-clamp-2 text-sm text-muted">{person.bio}</p>}
              </div>
              <span className="tabular shrink-0 text-xs text-faint">
                {compactCount(person.followerCount)} followers
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<div className="pt-6"><PostSkeletonList count={2} /></div>}>
      <SearchResults />
    </Suspense>
  );
}
