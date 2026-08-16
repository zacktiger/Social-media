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

export type FeedResponse = {
  items: Post[];
  nextCursor: string | null;
  mode: 'hybrid' | 'naive';
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
