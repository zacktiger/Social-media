'use client';

import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { del, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CheckIcon, UserPlusIcon } from './icons';

export function FollowButton({
  username,
  initialFollowing,
  isSelf,
}: {
  username: string;
  initialFollowing: boolean;
  isSelf: boolean;
}) {
  const { user, loading } = useAuth();
  const [following, setFollowing] = useState(initialFollowing);
  const [hovering, setHovering] = useState(false);

  const toggle = useMutation({
    mutationFn: () =>
      following ? del(`/api/users/${username}/follow`) : post(`/api/users/${username}/follow`),
    onMutate: () => setFollowing(!following),
    onError: () => setFollowing(following),
  });

  if (loading) return <div className="skeleton h-9 w-24 rounded-lg" />;

  // Profile pages are public, so a signed-out visitor gets the button too -
  // it just sends them to sign in rather than silently doing nothing.
  if (!user) {
    return (
      <Link href="/login" className="btn btn-primary">
        <UserPlusIcon className="h-4 w-4" />
        Follow
      </Link>
    );
  }

  if (isSelf || user.username === username) return null;

  return (
    <button
      onClick={() => toggle.mutate()}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      aria-pressed={following}
      className={`btn min-w-[7rem] ${
        following
          ? hovering
            ? 'border border-rose-500/40 bg-rose-500/10 text-rose-400'
            : 'btn-ghost'
          : 'btn-primary'
      }`}
    >
      {following ? (
        // The label says what the click will do once the pointer is on it.
        hovering ? (
          'Unfollow'
        ) : (
          <>
            <CheckIcon className="h-4 w-4" />
            Following
          </>
        )
      ) : (
        <>
          <UserPlusIcon className="h-4 w-4" />
          Follow
        </>
      )}
    </button>
  );
}
