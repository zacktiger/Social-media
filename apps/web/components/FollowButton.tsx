'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { del, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function FollowButton({
  username,
  initialFollowing,
  isSelf,
}: {
  username: string;
  initialFollowing: boolean;
  isSelf: boolean;
}) {
  const { user } = useAuth();
  const [following, setFollowing] = useState(initialFollowing);

  const toggle = useMutation({
    mutationFn: () =>
      following ? del(`/api/users/${username}/follow`) : post(`/api/users/${username}/follow`),
    onMutate: () => setFollowing(!following),
    onError: () => setFollowing(following),
  });

  if (!user || isSelf || user.username === username) return null;

  return (
    <button
      onClick={() => toggle.mutate()}
      className={`rounded-md px-4 py-1.5 text-sm font-medium ${
        following ? 'border border-edge text-muted hover:text-white' : 'bg-accent text-ink'
      }`}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  );
}
