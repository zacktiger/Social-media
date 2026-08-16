'use client';

import Link from 'next/link';
import { Composer } from '@/components/Composer';
import { FeedList } from '@/components/FeedList';
import { useAuth } from '@/lib/auth';

export default function HomePage() {
  const { user, loading } = useAuth();

  if (loading) {
    return <p className="pt-10 text-center text-sm text-muted">Loading...</p>;
  }

  if (!user) {
    return (
      <div className="pt-16 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">A feed that ranks, not just sorts</h1>
        <p className="mx-auto mt-3 max-w-md text-muted">
          Posts are fanned out to follower feeds in Redis on write, while high-follower accounts are
          merged in at read time. Sign in to see it work.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/register" className="rounded-md bg-accent px-4 py-2 font-medium text-ink">
            Create account
          </Link>
          <Link href="/login" className="rounded-md border border-edge px-4 py-2">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <Composer />
      <FeedList />
    </div>
  );
}
