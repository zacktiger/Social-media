'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { NotificationBell } from './NotificationBell';

export function Nav() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');

  return (
    <header className="sticky top-0 z-10 border-b border-edge bg-ink/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Pulse
        </Link>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) router.push(`/search?q=${encodeURIComponent(query.trim())}`);
          }}
          className="flex-1"
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search posts and people"
            className="w-full rounded-md border border-edge bg-panel px-3 py-1.5 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        </form>

        <nav className="flex items-center gap-2 text-sm">
          {loading ? null : user ? (
            <>
              <NotificationBell />
              <Link
                href={`/u/${user.username}`}
                className="hidden text-muted hover:text-white sm:block"
              >
                @{user.username}
              </Link>
              <button
                onClick={async () => {
                  await logout();
                  router.push('/login');
                }}
                className="rounded-md border border-edge px-3 py-1.5 text-muted hover:text-white"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted hover:text-white">
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-ink"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
