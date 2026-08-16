'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [key]: event.target.value }),
  });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await register(form);
      router.push('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm pt-16">
      <h1 className="text-2xl font-semibold">Create account</h1>

      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <input
          {...field('displayName')}
          placeholder="Display name"
          className="w-full rounded-md border border-edge bg-panel px-3 py-2 outline-none placeholder:text-muted"
        />
        <input
          {...field('username')}
          placeholder="Username"
          autoComplete="username"
          className="w-full rounded-md border border-edge bg-panel px-3 py-2 outline-none placeholder:text-muted"
        />
        <input
          {...field('email')}
          type="email"
          placeholder="Email"
          autoComplete="email"
          className="w-full rounded-md border border-edge bg-panel px-3 py-2 outline-none placeholder:text-muted"
        />
        <input
          {...field('password')}
          type="password"
          placeholder="Password (8+ characters)"
          autoComplete="new-password"
          className="w-full rounded-md border border-edge bg-panel px-3 py-2 outline-none placeholder:text-muted"
        />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent py-2 font-medium text-ink disabled:opacity-40"
        >
          {pending ? 'Creating...' : 'Create account'}
        </button>
      </form>

      <p className="mt-4 text-sm text-muted">
        Already have one?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
