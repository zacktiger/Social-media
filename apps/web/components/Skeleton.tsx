/**
 * Placeholders shaped like the thing that is loading. A card-sized block that
 * turns into a card reads as "nearly there"; the word "Loading..." reads as a
 * stall, even when it is on screen for exactly as long.
 */
export function PostSkeleton() {
  return (
    <div className="card animate-fade-in p-4" aria-hidden="true">
      <div className="flex gap-3">
        <div className="skeleton h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2.5 pt-1">
          <div className="flex gap-2">
            <div className="skeleton h-3 w-28" />
            <div className="skeleton h-3 w-20 opacity-60" />
          </div>
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-4/5" />
          <div className="flex gap-5 pt-2">
            <div className="skeleton h-3 w-10" />
            <div className="skeleton h-3 w-10" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PostSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading posts">
      {Array.from({ length: count }, (_, index) => (
        <PostSkeleton key={index} />
      ))}
    </div>
  );
}

export function UserRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading people">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="card flex items-center gap-3 p-4" aria-hidden="true">
          <div className="skeleton h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-32" />
            <div className="skeleton h-3 w-20 opacity-60" />
          </div>
        </div>
      ))}
    </div>
  );
}
