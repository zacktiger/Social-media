'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PostCard } from '@/components/PostCard';
import type { Post, User } from '@/lib/types';

type Tab = 'posts' | 'users';

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
    return <p className="pt-10 text-center text-sm text-muted">Type something in the search box.</p>;
  }

  const active = tab === 'posts' ? posts : users;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center gap-2 text-sm">
        {(['posts', 'users'] as Tab[]).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`rounded-md px-3 py-1.5 ${
              tab === value ? 'bg-accent text-ink' : 'border border-edge text-muted hover:text-white'
            }`}
          >
            {value === 'posts' ? 'Posts' : 'People'}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">
          {tab === 'posts' ? 'full-text, ts_rank' : 'trigram similarity'}
        </span>
      </div>

      {active.isLoading && <p className="text-sm text-muted">Searching...</p>}
      {active.error && <p className="text-sm text-red-400">{(active.error as Error).message}</p>}

      {tab === 'posts' && posts.data && (
        <div className="space-y-3">
          {posts.data.posts.length === 0 && (
            <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-muted">
              No posts match “{query}”.
            </p>
          )}
          {posts.data.posts.map((item) => (
            <PostCard key={item.id} post={item} />
          ))}
        </div>
      )}

      {tab === 'users' && users.data && (
        <div className="space-y-2">
          {users.data.users.length === 0 && (
            <p className="rounded-xl border border-edge bg-panel p-6 text-center text-sm text-muted">
              Nobody matches “{query}”.
            </p>
          )}
          {users.data.users.map((person) => (
            <Link
              key={person.id}
              href={`/u/${person.username}`}
              className="flex items-center justify-between rounded-xl border border-edge bg-panel p-4 hover:border-accent"
            >
              <div>
                <p className="font-medium">{person.displayName}</p>
                <p className="text-sm text-muted">@{person.username}</p>
                {person.bio && <p className="mt-1 text-sm text-muted">{person.bio}</p>}
              </div>
              <span className="text-xs text-muted">{person.followerCount} followers</span>
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
    <Suspense fallback={<p className="pt-10 text-center text-sm text-muted">Loading...</p>}>
      <SearchResults />
    </Suspense>
  );
}
