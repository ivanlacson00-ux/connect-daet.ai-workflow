'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: 'font-serif',
};

const fieldClasses =
  'h-11 w-full rounded-full border border-warm-border bg-card px-4 text-sm text-warm-text caret-current outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation: passwords must match
    if (password !== confirmPassword) {
      setStatus({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    setLoading(true);
    setStatus(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: 'user',
        },
      },
    });

    if (error) {
      setStatus({ type: 'error', message: error.message });
    } else {
      setStatus({ type: 'success', message: 'User created successfully.' });

      // Clear form
      setEmail('');
      setFullName('');
      setPassword('');
      setConfirmPassword('');
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-12">
      <div className="w-full max-w-[380px]">
        {/* Identity */}
        <div className="mb-8 flex flex-col items-center text-center max-md:mb-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-clay">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path
                d="M1.5 2.5h13v3h-13v-3ZM1.5 7h6v6.5h-6V7ZM9 7h5.5v6.5H9V7Z"
                stroke="white"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className={`${fonts.serif} text-[32px] leading-tight text-warm-text max-md:text-[26px]`}>
            CONNECT&#8209;Daet
          </h1>
          <p className="mt-2 text-xs text-muted-text">Create your account</p>
        </div>

        {/* Register card */}
        <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
          <p className="mb-4 flex items-center gap-2 text-[11px] font-medium text-muted-text">
            <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Register a new account
          </p>

          <form onSubmit={handleSignUp} className="space-y-4">
            <div>
              <label htmlFor="fullName" className="mb-1.5 block text-[11px] font-medium text-muted-text">
                Full name
              </label>
              <input
                id="fullName"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={fieldClasses}
                placeholder="Enter name"
                required
              />
            </div>

            <div>
              <label htmlFor="email" className="mb-1.5 block text-[11px] font-medium text-muted-text">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClasses}
                placeholder="name@email.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-[11px] font-medium text-muted-text">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClasses}
                placeholder="••••••••"
                required
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-1.5 block text-[11px] font-medium text-muted-text">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={fieldClasses}
                placeholder="••••••••"
                required
              />
            </div>

            {status && (
              <p
                role={status.type === 'error' ? 'alert' : 'status'}
                className={`rounded-xl border px-4 py-3 text-xs font-medium ${
                  status.type === 'success'
                    ? 'border-approved-bg bg-approved-bg/50 text-approved-text'
                    : 'border-rejected-bg bg-rejected-bg/50 text-rejected-text'
                }`}
              >
                {status.message}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        </section>

        {/* Login link */}
        <div className="mt-3 rounded-2xl border border-dashed border-warm-border bg-sidebar p-4 text-center text-xs text-muted-text">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-clay transition-colors hover:text-warm-text">
            Log in
          </Link>
        </div>

        <p className="mt-6 text-center text-[10px] text-muted-text">v1.2.0</p>
      </div>
    </div>
  );
}