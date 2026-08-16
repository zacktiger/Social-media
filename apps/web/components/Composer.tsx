'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { post, uploadFile } from '@/lib/api';
import type { Media, Post } from '@/lib/types';

const MAX_CHARS = 2000;
const MAX_IMAGES = 4;

export function Composer() {
  const [content, setContent] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Images are uploaded as soon as they are picked, so posting is just JSON
  // and the user waits for the resize once instead of at submit time.
  const uploadImage = useMutation({
    mutationFn: (file: File) => uploadFile<{ media: Media }>('/api/media/upload', file),
    onSuccess: (data) => {
      setMedia((current) => [...current, data.media]);
      setUploadError(null);
    },
    onError: (error: Error) => setUploadError(error.message),
  });

  const createPost = useMutation({
    mutationFn: () => post<{ post: Post }>('/api/posts', { content, media }),
    onSuccess: () => {
      setContent('');
      setMedia([]);
      // The author's own feed is written synchronously by the API, so the new
      // post is already there by the time this refetch lands.
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const canPost = (content.trim().length > 0 || media.length > 0) && !createPost.isPending;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (canPost) createPost.mutate();
      }}
      className="rounded-xl border border-edge bg-panel p-4"
    >
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value.slice(0, MAX_CHARS))}
        placeholder="What's happening?"
        rows={3}
        className="w-full resize-none bg-transparent text-[15px] outline-none placeholder:text-muted"
      />

      {media.length > 0 && (
        <div className="mt-2 flex gap-2">
          {media.map((image, index) => (
            <div key={image.thumb} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.thumb}
                alt=""
                className="h-16 w-16 rounded-md border border-edge object-cover"
              />
              <button
                type="button"
                onClick={() => setMedia((current) => current.filter((_, i) => i !== index))}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-ink px-1.5 text-xs text-muted hover:text-white"
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) uploadImage.mutate(file);
          event.target.value = '';
        }}
      />

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={media.length >= MAX_IMAGES || uploadImage.isPending}
            className="rounded-md border border-edge px-2.5 py-1 text-xs text-muted hover:text-white disabled:opacity-40"
          >
            {uploadImage.isPending ? 'Uploading...' : 'Add image'}
          </button>
          <span className="text-xs text-muted">
            {content.length}/{MAX_CHARS}
          </span>
        </div>

        <button
          type="submit"
          disabled={!canPost}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-ink disabled:opacity-40"
        >
          {createPost.isPending ? 'Posting...' : 'Post'}
        </button>
      </div>

      {uploadError && <p className="mt-2 text-sm text-red-400">{uploadError}</p>}
      {createPost.isError && (
        <p className="mt-2 text-sm text-red-400">{(createPost.error as Error).message}</p>
      )}
    </form>
  );
}
