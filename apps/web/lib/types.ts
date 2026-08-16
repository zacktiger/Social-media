export type User = {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  followerCount: number;
  followingCount: number;
  postCount: number;
  isCelebrity: boolean;
  createdAt: string;
  email?: string;
};

/** The three renditions produced by the upload pipeline. */
export type Media = {
  thumb: string;
  feed: string;
  original: string;
};

export type Post = {
  id: string;
  content: string;
  mediaUrls: Media[] | null;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  author: User;
  likedByViewer: boolean;
  score?: number;
};

export type Comment = {
  id: string;
  content: string;
  createdAt: string;
  author: User;
};

/** The three ways `GET /api/feed` can build the same page. */
export type FeedMode = 'hybrid' | 'ranked-live' | 'naive';

export type FeedResponse = {
  items: Post[];
  nextCursor: string | null;
  mode: FeedMode;
  tookMs: number;
  meta?: { fromCache: number; fromCelebrities: number; rebuilt: boolean };
};

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

/** The exact timestamp, for the tooltip behind every relative one. */
export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** "Joined March 2026" on profiles. */
export function joinedOn(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** 1200 -> "1.2k". Follower counts on this dataset run into the thousands. */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
