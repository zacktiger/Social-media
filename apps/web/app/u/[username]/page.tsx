import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/Avatar';
import { API_URL } from '@/lib/api';
import { compactCount, joinedOn, type User } from '@/lib/types';
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
  // The root layout appends " - Pulse" through the title template.
  if (!user) return { title: 'Not found' };

  return {
    title: `${user.displayName} (@${user.username})`,
    description: user.bio ?? `${user.displayName} on Pulse`,
  };
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="tabular font-semibold" title={String(value)}>
        {compactCount(value)}
      </dt>
      <dd className="text-muted">{label}</dd>
    </div>
  );
}

export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await fetchProfile(username);
  if (!user) notFound();

  return (
    <div className="animate-fade-in pt-6">
      <header className="card overflow-hidden">
        {/* A band of colour derived from nothing in particular - it exists so
            the header has a top edge and the avatar something to sit on. */}
        <div className="h-24 bg-gradient-to-r from-accent/25 via-violet-500/20 to-emerald-500/15" />

        <div className="p-5 pt-0">
          <div className="flex items-end justify-between gap-4">
            <div className="-mt-10 rounded-full border-4 border-panel">
              <Avatar user={user} size="xl" />
            </div>
            <div className="pb-1">
              <FollowSection username={user.username} />
            </div>
          </div>

          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{user.displayName}</h1>
              {user.isCelebrity && (
                <span
                  title="Past the fan-out threshold: posts are pulled at read time instead of pushed"
                  className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400"
                >
                  pull path
                </span>
              )}
            </div>
            <p className="text-muted">@{user.username}</p>
          </div>

          {user.bio && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{user.bio}</p>}

          <dl className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
            <Stat value={user.postCount} label="posts" />
            <Stat value={user.followerCount} label="followers" />
            <Stat value={user.followingCount} label="following" />
            <span className="text-xs text-faint">Joined {joinedOn(user.createdAt)}</span>
          </dl>
        </div>
      </header>

      <h2 className="px-1 pb-2 pt-6 text-sm font-medium text-muted">
        Posts <span className="text-faint">· newest first, straight from Postgres</span>
      </h2>

      <ProfileBody username={user.username} />
    </div>
  );
}
