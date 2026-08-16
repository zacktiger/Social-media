'use client';

import Link from 'next/link';
import { Composer } from '@/components/Composer';
import { FeedList } from '@/components/FeedList';
import { PostSkeletonList } from '@/components/Skeleton';
import { LogoIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth';

/** The three things the landing page is actually claiming, one card each. */
const HIGHLIGHTS = [
  {
    title: 'Pushed on write',
    body: 'A post lands in every follower feed as a Redis ZSET entry, on a queue, off the request path.',
  },
  {
    title: 'Pulled for the big accounts',
    body: 'Past a follower threshold nothing is fanned out. Those posts are read from Postgres and merged in.',
  },
  {
    title: 'Ranked, not just sorted',
    body: 'A decaying engagement score that a single like updates in place - no feed is ever re-sorted.',
  },
];

export default function HomePage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="space-y-3 pt-4">
        <div className="skeleton h-32 rounded-2xl" />
        <PostSkeletonList />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="animate-rise pt-12 pb-10">
        <div className="text-center">
          <span className="chip mx-auto mb-5 flex w-fit items-center gap-1.5 border-accent/30 bg-accent-soft/40 text-accent">
            <LogoIcon className="h-3.5 w-3.5" />
            Hybrid fan-out feed
          </span>

          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            A feed that ranks,
            <br />
            <span className="bg-gradient-to-r from-accent to-violet-400 bg-clip-text text-transparent">
              not just sorts
            </span>
          </h1>

          <p className="mx-auto mt-4 max-w-md text-pretty text-muted">
            Posts are fanned out to follower feeds in Redis on write, while high-follower accounts
            are merged in at read time. Sign in and switch read paths to watch the difference.
          </p>

          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/register" className="btn btn-primary px-5 py-2.5">
              Create account
            </Link>
            <Link href="/login" className="btn btn-ghost px-5 py-2.5">
              Sign in
            </Link>
          </div>

          <p className="mt-4 text-xs text-faint">
            Running the seed data? Sign in as <code className="text-muted">nova</code> with{' '}
            <code className="text-muted">password123</code>.
          </p>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-3">
          {HIGHLIGHTS.map((item) => (
            <div key={item.title} className="card p-4">
              <h2 className="text-sm font-semibold">{item.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4">
      <Composer />
      <FeedList />
    </div>
  );
}
