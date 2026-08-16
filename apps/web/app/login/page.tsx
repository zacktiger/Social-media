'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogoIcon, Spinner } from '@/components/icons';
import { PasswordInput } from '@/components/PasswordInput';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(name: string, secret: string) {
    setPending(true);
    setError(null);
    try {
      await login(name, secret);
      router.push('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm animate-rise pt-14">
      <div className="mb-6 text-center">
        <LogoIcon className="mx-auto h-8 w-8 text-accent" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted">Sign in to see your ranked feed.</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(identifier, password);
        }}
        className="card space-y-4 p-5"
      >
        <div>
          <label htmlFor="identifier" className="mb-1.5 block text-sm font-medium">
            Username or email
          </label>
          <input
            id="identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="nova"
            autoComplete="username"
            autoFocus
            className="input"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <PasswordInput
            id="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5">
          {pending && <Spinner />}
          {pending ? 'Signing in' : 'Sign in'}
        </button>

        {/* The seeded dataset ships with a known password; typing it out on
            every demo is friction for no reason. */}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setIdentifier('nova');
            setPassword('password123');
            submit('nova', 'password123');
          }}
          className="w-full text-center text-xs text-faint transition-colors hover:text-muted"
        >
          or sign in with the demo account
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        No account?{' '}
        <Link href="/register" className="font-medium text-accent hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
