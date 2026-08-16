'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePostRoom, useSocketEvent } from '@/lib/socket';
import { timeAgo, type Comment, type Media, type Post } from '@/lib/types';

/**
 * Renders the `feed` rendition (600px) and links to `original`. The browser
 * never downloads the full-size image just to show a timeline card.
 */
function PostMedia({ media }: { media: Media[] | null }) {
  if (!media || media.length === 0) return null;

  return (
    <div className={`mt-3 grid gap-2 ${media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {media.map((image) => (
        <a key={image.original} href={image.original} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.feed}
            alt=""
            loading="lazy"
            className="w-full rounded-lg border border-edge object-cover"
          />
        </a>
      ))}
    </div>
  );
}

export function PostCard({ post: item }: { post: Post }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [liked, setLiked] = useState(item.likedByViewer);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [commentCount, setCommentCount] = useState(item.commentCount);
  const [showComments, setShowComments] = useState(false);

  // Join this post's room while the card is mounted, then take engagement
  // counts from the server instead of guessing at them.
  usePostRoom(item.id, !!user);

  useSocketEvent<{ postId: string; likeCount: number }>('post:like_update', (payload) => {
    if (payload.postId === item.id) setLikeCount(payload.likeCount);
  });

  useSocketEvent<{ postId: string; commentCount: number }>('post:comment_update', (payload) => {
    if (payload.postId === item.id) setCommentCount(payload.commentCount);
  });

  const toggleLike = useMutation({
    mutationFn: () =>
      liked
        ? del<{ likeCount: number }>(`/api/posts/${item.id}/like`)
        : post<{ likeCount: number }>(`/api/posts/${item.id}/like`),
    // Optimistic: the counter flips immediately, the request confirms it.
    onMutate: () => {
      const previous = { liked, likeCount };
      setLiked(!liked);
      setLikeCount(likeCount + (liked ? -1 : 1));
      return previous;
    },
    onError: (_error, _vars, previous) => {
      if (previous) {
        setLiked(previous.liked);
        setLikeCount(previous.likeCount);
      }
    },
    onSuccess: (data) => setLikeCount(data.likeCount),
  });

  const remove = useMutation({
    mutationFn: () => del(`/api/posts/${item.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });

  return (
    <article className="rounded-xl border border-edge bg-panel p-4">
      <header className="flex items-baseline gap-2 text-sm">
        <Link href={`/u/${item.author.username}`} className="font-semibold hover:underline">
          {item.author.displayName}
        </Link>
        <span className="text-muted">@{item.author.username}</span>
        {item.author.isCelebrity && (
          <span
            title="Over the fan-out threshold: this post is pulled at read time, never pushed"
            className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-400"
          >
            pull path
          </span>
        )}
        <span className="ml-auto text-xs text-muted">{timeAgo(item.createdAt)}</span>
      </header>

      {item.content && (
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{item.content}</p>
      )}

      <PostMedia media={item.mediaUrls} />

      <footer className="mt-3 flex items-center gap-4 text-sm text-muted">
        <button
          onClick={() => toggleLike.mutate()}
          className={`transition-colors ${liked ? 'text-rose-400' : 'hover:text-white'}`}
        >
          {liked ? '♥' : '♡'} {likeCount}
        </button>

        <button onClick={() => setShowComments((value) => !value)} className="hover:text-white">
          ○ {commentCount}
        </button>

        {typeof item.score === 'number' && (
          <span title="Ranking score at read time" className="text-xs opacity-60">
            score {item.score.toFixed(3)}
          </span>
        )}

        {user?.id === item.author.id && (
          <button
            onClick={() => remove.mutate()}
            className="ml-auto text-xs hover:text-red-400"
            disabled={remove.isPending}
          >
            Delete
          </button>
        )}
      </footer>

      {showComments && <Comments postId={item.id} />}
    </article>
  );
}

function Comments({ postId }: { postId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['comments', postId],
    queryFn: () => api<{ comments: Comment[] }>(`/api/posts/${postId}/comments`),
  });

  const addComment = useMutation({
    mutationFn: () => post(`/api/posts/${postId}/comments`, { content: draft }),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['comments', postId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  return (
    <div className="mt-3 space-y-3 border-t border-edge pt-3">
      {isLoading && <p className="text-sm text-muted">Loading comments...</p>}

      {data?.comments.map((comment) => (
        <div key={comment.id} className="text-sm">
          <Link href={`/u/${comment.author.username}`} className="font-medium hover:underline">
            {comment.author.displayName}
          </Link>
          <span className="ml-2 text-xs text-muted">{timeAgo(comment.createdAt)}</span>
          <p className="mt-0.5 text-muted">{comment.content}</p>
        </div>
      ))}

      {user && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) addComment.mutate();
          }}
          className="flex gap-2"
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment"
            className="flex-1 rounded-md border border-edge bg-ink px-3 py-1.5 text-sm outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!draft.trim() || addComment.isPending}
            className="rounded-md border border-edge px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Reply
          </button>
        </form>
      )}
    </div>
  );
}
