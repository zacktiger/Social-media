'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { post, uploadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Media, Post } from '@/lib/types';
import { Avatar } from './Avatar';
import { CloseIcon, ImageIcon, Spinner } from './icons';

const MAX_CHARS = 2000;
const MAX_IMAGES = 4;

/** Ring that fills as the post approaches the character cap. */
function CharCounter({ length }: { length: number }) {
  const remaining = MAX_CHARS - length;
  const ratio = Math.min(length / MAX_CHARS, 1);
  const circumference = 2 * Math.PI * 9;
  const near = remaining <= 200;

  return (
    <span
      className="flex items-center gap-1.5"
      title={`${remaining} characters left`}
      aria-live="polite"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-edge" />
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={remaining <= 0 ? 'text-rose-400' : near ? 'text-amber-400' : 'text-accent'}
        />
      </svg>
      {near && (
        <span className={`tabular text-xs ${remaining <= 0 ? 'text-rose-400' : 'text-amber-400'}`}>
          {remaining}
        </span>
      )}
    </span>
  );
}

export function Composer() {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

  // Images are uploaded as soon as they are picked, so posting is just JSON
  // and the user waits for the resize once instead of at submit time.
  const uploadImage = useMutation({
    mutationFn: (file: File) => uploadFile<{ media: Media }>('/api/media/upload', file),
  });

  /** Shared by the file picker, drag-and-drop, and paste. */
  async function addFiles(files: FileList | File[]) {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'));
    const room = MAX_IMAGES - media.length - uploading;
    if (images.length > room) setUploadError(`Up to ${MAX_IMAGES} images per post.`);

    for (const file of images.slice(0, Math.max(room, 0))) {
      setUploading((count) => count + 1);
      try {
        const data = await uploadImage.mutateAsync(file);
        setMedia((current) => [...current, data.media]);
        setUploadError(null);
      } catch (error) {
        setUploadError((error as Error).message);
      } finally {
        setUploading((count) => count - 1);
      }
    }
  }

  const createPost = useMutation({
    mutationFn: () => post<{ post: Post }>('/api/posts', { content, media }),
    onSuccess: () => {
      setContent('');
      setMedia([]);
      if (textarea.current) textarea.current.style.height = 'auto';
      // The author's own feed is written synchronously by the API, so the new
      // post is already there by the time this refetch lands.
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const canPost =
    (content.trim().length > 0 || media.length > 0) &&
    !createPost.isPending &&
    // Posting mid-upload would drop the image that is still in flight.
    uploading === 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canPost) createPost.mutate();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
      }}
      className={`card p-4 transition-colors ${
        dragging ? 'border-accent bg-accent-soft/30' : 'focus-within:border-edge-strong'
      }`}
    >
      <div className="flex gap-3">
        {user && <Avatar user={user} />}

        <div className="min-w-0 flex-1">
          <textarea
            ref={textarea}
            value={content}
            onChange={(event) => {
              setContent(event.target.value.slice(0, MAX_CHARS));
              // Grow with the text instead of scrolling inside three fixed rows.
              const node = event.target;
              node.style.height = 'auto';
              node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canPost) {
                event.preventDefault();
                createPost.mutate();
              }
            }}
            onPaste={(event) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                addFiles(event.clipboardData.files);
              }
            }}
            placeholder="What's happening?"
            aria-label="Write a post"
            rows={2}
            className="w-full resize-none bg-transparent py-1 text-[15px] leading-relaxed outline-none placeholder:text-faint"
          />

          {(media.length > 0 || uploading > 0) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {media.map((image, index) => (
                <div key={image.thumb} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.thumb}
                    alt=""
                    className="h-20 w-20 rounded-lg border border-edge object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setMedia((current) => current.filter((_, i) => i !== index))}
                    className="absolute -right-1.5 -top-1.5 rounded-full border border-edge bg-ink p-1 text-muted transition-colors hover:text-white"
                    aria-label={`Remove image ${index + 1}`}
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {Array.from({ length: uploading }, (_, index) => (
                <div
                  key={`pending-${index}`}
                  className="flex h-20 w-20 items-center justify-center rounded-lg border border-edge bg-raised text-muted"
                >
                  <Spinner />
                </div>
              ))}
            </div>
          )}

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) addFiles(event.target.files);
              event.target.value = '';
            }}
          />

          <div className="mt-2 flex items-center gap-3 border-t border-edge pt-2.5">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={media.length + uploading >= MAX_IMAGES}
              title={`Add an image (up to ${MAX_IMAGES}), or just drop one here`}
              aria-label="Add an image"
              className="-ml-1.5 rounded-lg p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ImageIcon />
            </button>

            {content.length > 0 && <CharCounter length={content.length} />}

            <span className="ml-auto hidden text-xs text-faint sm:block">⌘↵ to post</span>

            <button type="submit" disabled={!canPost} className="btn btn-primary">
              {createPost.isPending && <Spinner className="h-3.5 w-3.5" />}
              Post
            </button>
          </div>

          {uploadError && <p className="mt-2 text-sm text-rose-400">{uploadError}</p>}
          {createPost.isError && (
            <p className="mt-2 text-sm text-rose-400">{(createPost.error as Error).message}</p>
          )}
        </div>
      </div>
    </form>
  );
}
