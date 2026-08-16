'use client';

import { useState } from 'react';
import { EyeIcon } from './icons';

/**
 * Password field with a reveal toggle. Typing a password blind into a form
 * that then rejects it is the most common way people get stuck on a sign-in
 * page, and the toggle is the whole fix.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete: 'current-password' | 'new-password';
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        className="input pr-11"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-faint transition-colors hover:text-muted"
      >
        <EyeIcon className="h-4 w-4" filled={visible} />
      </button>
    </div>
  );
}
