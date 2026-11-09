'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getPasswordValidationError } from '@/lib/auth/password';

const fieldClasses =
  'h-11 w-full rounded-full border border-warm-border bg-card px-4 text-sm text-warm-text caret-current outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay';

export default function ResetPasswordPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(false);
  const [linkExpired, setLinkExpired] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams(window.location.search);
    setLinkExpired(query.get('error') === 'expired' || query.get('error') === 'invalid');
    const checkRecoverySession = async () => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      const response = await fetch('/api/auth/password', { cache: 'no-store' });
      const result = await response.json() as { authorized?: boolean };
      if (!active) return;
      setAuthorized(
        !sessionError
        && Boolean(session?.user.email_confirmed_at)
        && response.ok
        && result.authorized === true
      );
    };
    void checkRecoverySession().catch(() => {
      if (active) setAuthorized(false);
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const passwordError = getPasswordValidationError(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const result = await response.json() as { error?: string; updated?: boolean };
      if (!response.ok || !result.updated) {
        setError(result.error || 'Could not update your password. Request a new reset link and try again.');
        if (response.status === 401) setAuthorized(false);
        return;
      }

      await supabase.auth.signOut();
      setUpdated(true);
    } catch {
      setError('Could not update your password. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-[32px] leading-tight text-warm-text">
            {updated ? 'Password updated' : 'Choose a new password'}
          </h1>
          <p className="mt-2 text-xs text-muted-text">
            {updated ? 'You can now sign in with your new password.' : 'Use at least 8 characters.'}
          </p>
        </div>
        <section className="rounded-2xl border border-warm-border bg-card p-5">
          {updated ? (
            <Link
              href="/login"
              className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text"
            >
              Back to login
            </Link>
          ) : linkExpired || authorized === false ? (
            <div className="space-y-4">
              <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
                This password reset link is invalid or expired. Request a new link to continue.
              </p>
              <Link
                href="/forgot-password"
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text"
              >
                Request a new reset link
              </Link>
            </div>
          ) : authorized === null ? (
            <p role="status" className="py-3 text-center text-xs text-muted-text">Checking your reset link...</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="password" className="mb-1.5 block text-[11px] font-medium text-muted-text">
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={fieldClasses}
                  required
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="mb-1.5 block text-[11px] font-medium text-muted-text">
                  Confirm new password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={fieldClasses}
                  required
                />
              </div>
              {error && (
                <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
              >
                {loading ? 'Updating password...' : 'Update password'}
              </button>
            </form>
          )}
        </section>
        {!updated && (
          <p className="mt-4 text-center text-xs text-muted-text">
            <Link href="/login" className="font-semibold text-clay hover:text-warm-text">Back to login</Link>
          </p>
        )}
      </div>
    </div>
  );
}
