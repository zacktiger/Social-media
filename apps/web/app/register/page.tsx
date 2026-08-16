'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogoIcon, Spinner } from '@/components/icons';
import { PasswordInput } from '@/components/PasswordInput';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const FIELDS = [
  { key: 'displayName', label: 'Display name', placeholder: 'Nova Chen', autoComplete: 'name' },
  { key: 'username', label: 'Username', placeholder: 'nova', autoComplete: 'username' },
  { key: 'email', label: 'Email', placeholder: 'nova@example.com', autoComplete: 'email' },
] as const;

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  // The API validates with zod and returns a message per field; showing them
  // under the input beats one line at the bottom saying "some fields are invalid".
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await register(form);
      router.push('/');
    } catch (err) {
      if (err instanceof ApiError && err.fields?.length) {
        setFieldErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
      }
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm animate-rise pt-14">
      <div className="mb-6 text-center">
        <LogoIcon className="mx-auto h-8 w-8 text-accent" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted">Takes about ten seconds.</p>
      </div>

      <form onSubmit={onSubmit} className="card space-y-4 p-5" noValidate>
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={field.key} className="mb-1.5 block text-sm font-medium">
              {field.label}
            </label>
            <input
              id={field.key}
              value={form[field.key]}
              onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
              placeholder={field.placeholder}
              autoComplete={field.autoComplete}
              type={field.key === 'email' ? 'email' : 'text'}
              aria-invalid={!!fieldErrors[field.key]}
              aria-describedby={fieldErrors[field.key] ? `${field.key}-error` : undefined}
              className={`input ${fieldErrors[field.key] ? 'border-rose-500/60' : ''}`}
            />
            {fieldErrors[field.key] && (
              <p id={`${field.key}-error`} className="mt-1 text-xs text-rose-400">
                {fieldErrors[field.key]}
              </p>
            )}
          </div>
        ))}

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <PasswordInput
            id="password"
            value={form.password}
            onChange={(value) => setForm({ ...form, password: value })}
            autoComplete="new-password"
            describedBy="password-hint"
          />
          <p
            id="password-hint"
            className={`mt-1 text-xs ${fieldErrors.password ? 'text-rose-400' : 'text-faint'}`}
          >
            {fieldErrors.password ?? 'At least 8 characters.'}
          </p>
        </div>

        {error && !Object.keys(fieldErrors).length && (
          <p
            role="alert"
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
          >
            {error}
          </p>
        )}

        <button type="submit" disabled={pending} className="btn btn-primary w-full py-2.5">
          {pending && <Spinner />}
          {pending ? 'Creating account' : 'Create account'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Already have one?{' '}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
