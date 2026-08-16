import Link from 'next/link';

type AvatarUser = {
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE: Record<Size, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-2xl',
};

/**
 * Six fixed gradients rather than a computed hue: a hash into HSL space lands
 * on muddy colours often enough to look like a bug, and these are all legible
 * against white initials.
 */
const GRADIENTS = [
  'from-sky-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-fuchsia-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-blue-600',
];

/** Same username always gets the same colour, on every page and every session. */
function pickGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length]!;
}

function initials(name: string, fallback: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return (letters || fallback[0] || '?').toUpperCase();
}

/**
 * Nobody in the seed data has uploaded an avatar, and a broken image icon on
 * every card looks worse than no avatar at all - so the initials tile is the
 * normal case here, not the error case.
 */
export function Avatar({
  user,
  size = 'md',
  className = '',
}: {
  user: AvatarUser;
  size?: Size;
  className?: string;
}) {
  const shared = `${SIZE[size]} shrink-0 rounded-full object-cover ${className}`;

  if (user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={user.avatarUrl}
        alt=""
        loading="lazy"
        className={`${shared} border border-edge bg-raised`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${shared} flex items-center justify-center bg-gradient-to-br font-semibold text-white/95 ${pickGradient(
        user.username,
      )}`}
    >
      {initials(user.displayName, user.username)}
    </span>
  );
}

/** Avatar that navigates to the owner's profile. The name beside it links too. */
export function AvatarLink({
  user,
  size = 'md',
}: {
  user: AvatarUser;
  size?: Size;
}) {
  return (
    <Link
      href={`/u/${user.username}`}
      aria-label={`${user.displayName}'s profile`}
      className="rounded-full transition-opacity hover:opacity-85"
    >
      <Avatar user={user} size={size} />
    </Link>
  );
}
