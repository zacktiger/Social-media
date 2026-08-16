'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useDismiss } from '@/lib/use-dismiss';
import { Avatar } from './Avatar';
import { HomeIcon, LogoIcon, LogoutIcon, SearchIcon } from './icons';
import { NotificationBell } from './NotificationBell';

export function Nav() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useDismiss(menu, () => setMenuOpen(false), menuOpen);

  // Close the menu on navigation - otherwise it hangs over the page you just
  // moved to.
  useEffect(() => setMenuOpen(false), [pathname]);

  // Keep the box showing what the results on screen are actually for. Read
  // from the URL directly rather than useSearchParams(), which would need a
  // Suspense boundary around the whole layout.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    setQuery(pathname === '/search' ? (q ?? '') : '');
  }, [pathname]);

  // "/" focuses search, the way every other feed-shaped app does it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-2.5 sm:gap-3">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 rounded-lg text-accent transition-colors hover:text-accent-hover"
          aria-label="Pulse home"
        >
          <LogoIcon className="h-6 w-6" />
          <span className="hidden text-lg font-semibold tracking-tight text-white sm:block">
            Pulse
          </span>
        </Link>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) {
              router.push(`/search?q=${encodeURIComponent(query.trim())}`);
              searchInput.current?.blur();
            }
          }}
          className="relative flex-1"
          role="search"
        >
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') searchInput.current?.blur();
            }}
            placeholder="Search posts and people"
            aria-label="Search posts and people"
            className="input py-1.5 pl-9 pr-9"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-edge px-1.5 py-px text-[10px] text-faint sm:block">
            /
          </kbd>
        </form>

        <nav className="flex items-center gap-1.5">
          {loading ? (
            <div className="skeleton h-8 w-8 rounded-full" />
          ) : user ? (
            <>
              <Link
                href="/"
                aria-label="Home"
                aria-current={pathname === '/' ? 'page' : undefined}
                className={`rounded-lg p-2 transition-colors hover:bg-white/5 hover:text-white ${
                  pathname === '/' ? 'text-accent' : 'text-muted'
                }`}
              >
                <HomeIcon />
              </Link>

              <NotificationBell />

              <div className="relative" ref={menu}>
                <button
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Account menu"
                  className="flex rounded-full transition-opacity hover:opacity-80"
                >
                  <Avatar user={user} size="sm" />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className="card absolute right-0 z-40 mt-2 w-56 animate-rise overflow-hidden p-1 shadow-2xl shadow-black/50"
                  >
                    <div className="border-b border-edge px-3 py-2.5">
                      <p className="truncate text-sm font-medium">{user.displayName}</p>
                      <p className="truncate text-xs text-muted">@{user.username}</p>
                    </div>

                    <Link
                      href={`/u/${user.username}`}
                      role="menuitem"
                      className="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5 hover:text-white"
                    >
                      <Avatar user={user} size="xs" />
                      Your profile
                    </Link>

                    <button
                      role="menuitem"
                      onClick={async () => {
                        setMenuOpen(false);
                        await logout();
                        router.push('/login');
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/5 hover:text-white"
                    >
                      <LogoutIcon className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden px-2 text-sm text-muted transition-colors hover:text-white sm:block"
              >
                Sign in
              </Link>
              <Link href="/register" className="btn btn-primary btn-sm sm:px-3.5 sm:py-2">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
