import Link from 'next/link';
import { LogoIcon } from '@/components/icons';

export default function NotFound() {
  return (
    <div className="animate-rise pt-24 text-center">
      <LogoIcon className="mx-auto h-8 w-8 text-edge-strong" />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
        That page, profile, or post does not exist - or it was deleted.
      </p>
      <Link href="/" className="btn btn-primary mt-6 px-5 py-2.5">
        Back to the feed
      </Link>
    </div>
  );
}
