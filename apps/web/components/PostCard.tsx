'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, del, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePostRoom, useSocketEvent } from '@/lib/socket';
import { formatScore, fullDate, timeAgo, type Comment, type Media, type Post } from '@/lib/types';
import { Avatar, AvatarLink } from './Avatar';
import { CommentIcon, HeartIcon, Spinner, TrashIcon } from './icons';

/**
 * Renders the `feed` rendition (600px) and links to `original`. The browser
 * never downloads the full-size image just to show a timeline card.
 */
function PostMedia({ media }: { media: Media[] | null }) {
  if (!media || media.length === 0) return null;

  const single = media.length === 1;

  return (
    <div className={`mt-3 grid gap-1.5 ${single ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {media.map((image) => (
        <a
          key={image.original}
          href={image.original}
          target="_blank"
          rel="noreferrer"
          className="group/media relative overflow-hidden rounded-xl border border-edge bg-raised"
        >
          {/* Fixed aspect box: the card does not jump when the image decodes,
              and a mixed portrait/landscape grid still lines up. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.feed}
            alt=""
            loading="lazy"
            className={`w-full object-cover transition-transform duration-300 group-hover/media:scale-[1.02] ${
              single ? 'max-h-[28rem]' : 'aspect-square'
            }`}
          />
        </a>
      ))}
    </div>
  );
}

/** Shown on posts by accounts past the fan-out threshold. */
function PullPathBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Over the fan-out threshold: this post is pulled at read time, never pushed"
      className={`rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-px text-[10px] font-medium uppercase tracking-wide text-amber-400 ${className}`}
    >
      pull path
    </span>
  );
}

export function PostCard({ post: item }: { post: Post }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [liked, setLiked] = useState(item.likedByViewer);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [commentCount, setCommentCount] = useState(item.commentCount);
  const [showComments, setShowComments] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    /**
     * The intent is the mutation's argument, not something read back off
     * state. `onMutate` flips `liked` optimistically and React re-renders
     * before this async function runs, so reading `liked` here would see the
     * flipped value and send exactly the opposite request - a like arriving
     * as an unlike. The API treats a repeat as a no-op, so it fails silently.
     */
    mutationFn: (next: boolean) =>
      next
        ? post<{ likeCount: number }>(`/api/posts/${item.id}/like`)
        : del<{ likeCount: number }>(`/api/posts/${item.id}/like`),
    // Optimistic: the counter flips immediately, the request confirms it.
    onMutate: (next) => {
      const previous = { liked, likeCount };
      setLiked(next);
      setLikeCount(likeCount + (next ? 1 : -1));
      return previous;
    },
    onError: (_error, _next, previous) => {
      if (previous) {
        setLiked(previous.liked);
        setLikeCount(previous.likeCount);
      }
    },
    onSuccess: (data) => setLikeCount(data.likeCount),
  });

  const remove = useMutation({
    mutationFn: () => del(`/api/posts/${item.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      // A post deleted from a profile page has to leave that timeline too, not
      // just the feed the card usually lives in.
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
    },
  });

  const isAuthor = user?.id === item.author.id;

  return (
    <article className="card animate-fade-in p-4 transition-colors hover:border-edge-strong">
      <div className="flex gap-3">
        <AvatarLink user={item.author} />

        <div className="min-w-0 flex-1">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Link
              href={`/u/${item.author.username}`}
              className="truncate font-semibold hover:underline"
            >
              {item.author.displayName}
            </Link>
            <span className="truncate text-muted">@{item.author.username}</span>
            {item.author.isCelebrity && <PullPathBadge />}

            <Link
              href={`/p/${item.id}`}
              className="ml-auto shrink-0 text-xs text-faint transition-colors hover:text-muted"
            >
              <time dateTime={item.createdAt} title={fullDate(item.createdAt)}>
                {timeAgo(item.createdAt)}
              </time>
            </Link>
          </header>

          {item.content && (
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              {item.content}
            </p>
          )}

          <PostMedia media={item.mediaUrls} />

          <footer className="mt-3 flex items-center gap-1 text-sm text-muted">
            <button
              onClick={() => toggleLike.mutate(!liked)}
              aria-pressed={liked}
              aria-label={`${liked ? 'Unlike' : 'Like'}, ${likeCount} ${likeCount === 1 ? 'like' : 'likes'}`}
              className={`-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors ${
                liked ? 'text-like hover:bg-like/10' : 'hover:bg-like/10 hover:text-like'
              }`}
            >
              <HeartIcon className={`h-[18px] w-[18px] ${liked ? 'animate-pop' : ''}`} filled={liked} />
              <span className="tabular text-[13px]">{likeCount}</span>
            </button>

            <button
              onClick={() => setShowComments((value) => !value)}
              aria-expanded={showComments}
              aria-label={`${showComments ? 'Hide' : 'Show'} comments, ${commentCount} total`}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/10 hover:text-accent ${
                showComments ? 'text-accent' : ''
              }`}
            >
              <CommentIcon className="h-[18px] w-[18px]" />
              <span className="tabular text-[13px]">{commentCount}</span>
            </button>

            {typeof item.score === 'number' && (
              <span
                title="Ranking score this post was served at: (1 + likes + 2·comments) / (age_hours + 2)^1.8"
                className="chip ml-1 hidden text-faint sm:inline-flex"
              >
                score <span className="tabular">{formatScore(item.score)}</span>
              </span>
            )}

            {isAuthor &&
              // Two-step rather than a window.confirm(): no modal, and the
              // undo is just moving the mouse away.
              (confirmDelete ? (
                <span className="ml-auto flex items-center gap-1 text-xs">
                  <button
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                    className="flex items-center gap-1 rounded-md px-2 py-1 font-medium text-rose-400 hover:bg-rose-500/10"
                  >
                    {remove.isPending ? <Spinner className="h-3 w-3" /> : null}
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md px-2 py-1 hover:text-white"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete post"
                  className="ml-auto rounded-lg p-1.5 text-faint transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                >
                  <TrashIcon className="h-[18px] w-[18px]" />
                </button>
              ))}
          </footer>

          {showComments && <Comments postId={item.id} />}
        </div>
      </div>
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
    <div className="mt-3 space-y-3 border-t border-edge pt-3 animate-fade-in">
      {isLoading && (
        <div className="space-y-2" aria-label="Loading comments" role="status">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton h-3 w-full" />
        </div>
      )}

      {data?.comments.length === 0 && (
        <p className="text-sm text-faint">No comments yet. Say the first thing.</p>
      )}

      {data?.comments.map((comment) => (
        <div key={comment.id} className="flex gap-2.5">
          <AvatarLink user={comment.author} size="xs" />
          <div className="min-w-0 flex-1 text-sm">
            <Link
              href={`/u/${comment.author.username}`}
              className="font-medium hover:underline"
            >
              {comment.author.displayName}
            </Link>
            <time
              dateTime={comment.createdAt}
              title={fullDate(comment.createdAt)}
              className="ml-2 text-xs text-faint"
            >
              {timeAgo(comment.createdAt)}
            </time>
            <p className="mt-0.5 break-words text-muted">{comment.content}</p>
          </div>
        </div>
      ))}

      {user ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) addComment.mutate();
          }}
          className="flex items-center gap-2"
        >
          <Avatar user={user} size="xs" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add a comment"
            aria-label="Add a comment"
            className="input flex-1 py-1.5"
          />
          <button
            type="submit"
            disabled={!draft.trim() || addComment.isPending}
            className="btn btn-ghost btn-sm"
          >
            {addComment.isPending ? <Spinner className="h-3.5 w-3.5" /> : null}
            Reply
          </button>
        </form>
      ) : (
        <p className="text-sm text-faint">
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>{' '}
          to join the conversation.
        </p>
      )}

      {addComment.isError && (
        <p className="text-sm text-rose-400">{(addComment.error as Error).message}</p>
      )}
    </div>
  );
}
