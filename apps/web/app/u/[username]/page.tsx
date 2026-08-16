import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { API_URL } from '@/lib/api';
import type { User } from '@/lib/types';
import { FollowSection, ProfileBody } from './ProfileBody';

/**
 * Rendered on the server. Profile pages are public, so they need no token and
 * can be crawled - which is the reason the frontend is Next.js at all rather
 * than a client-only SPA.
 */
async function fetchProfile(username: string): Promise<User | null> {
  const res = await fetch(`${API_URL}/api/users/${username}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user as User;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const user = await fetchProfile(username);
  if (!user) return { title: 'Not found - Pulse' };

  return {
    title: `${user.displayName} (@${user.username}) - Pulse`,
    description: user.bio ?? `${user.displayName} on Pulse`,
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await fetchProfile(username);
  if (!user) notFound();

  return (
    <div className="pt-6">
      <header className="rounded-xl border border-edge bg-panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{user.displayName}</h1>
            <p className="text-muted">@{user.username}</p>
            {user.bio && <p className="mt-2 text-sm">{user.bio}</p>}
          </div>
          <FollowSection username={user.username} />
        </div>

        <dl className="mt-4 flex gap-5 text-sm">
          <div>
            <dt className="inline font-semibold">{user.postCount}</dt>{' '}
            <dd className="inline text-muted">posts</dd>
          </div>
          <div>
            <dt className="inline font-semibold">{user.followerCount}</dt>{' '}
            <dd className="inline text-muted">followers</dd>
          </div>
          <div>
            <dt className="inline font-semibold">{user.followingCount}</dt>{' '}
            <dd className="inline text-muted">following</dd>
          </div>
          {user.isCelebrity && (
            <div
              title="Past the fan-out threshold: posts are pulled at read time instead of pushed"
              className="rounded border border-amber-500/40 px-2 py-0.5 text-xs uppercase tracking-wide text-amber-400"
            >
              pull path
            </div>
          )}
        </dl>
      </header>

      <div className="mt-4">
        <ProfileBody username={user.username} />
      </div>
    </div>
  );
}
