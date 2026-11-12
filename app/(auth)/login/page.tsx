'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { getRoleHomePath } from '@/lib/workflow/offices';

// ─── Styles ──────────────────────────────────────────────────────────────────
const fonts = {
  serif: 'font-serif',
};

const fieldClasses =
  'h-11 w-full rounded-full border border-warm-border bg-card px-4 text-sm text-warm-text caret-current outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);
  const [canResendConfirmation, setCanResendConfirmation] = useState(false);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get('verified') === '1') {
      // Capture the one-time callback message before removing its query parameter.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVerified(true);
      params.delete('verified');
    }

    if (params.get('verification') === 'failed') {
      // Capture the one-time callback message before removing its query parameter.
      setError('Email confirmation could not be completed. Please request a new confirmation email and try again.');
      params.delete('verification');
    }

    if (params.get('verification') === 'required') {
      setError('Confirm your email address before accessing your account.');
      params.delete('verification');
    }

    if (params.get('profile') === 'unavailable') {
      setError('Your account profile could not be loaded. Sign in again or contact an administrator if the problem continues.');
      params.delete('profile');
    }

    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setCanResendConfirmation(false);
    setConfirmationMessage('');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError) {
      setError(
        signInError.code === 'email_not_confirmed'
          ? 'Confirm your email address before signing in.'
          : signInError.message
      );
      setCanResendConfirmation(signInError.code === 'email_not_confirmed');
      setLoading(false);
      return;
    }

    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError || !refreshed.user) {
      setError('Session error. Please try again.');
      setLoading(false);
      return;
    }

    const { data: role, error: profileError } = await supabase.rpc(
      'ensure_current_user_profile'
    );

    if (profileError || typeof role !== 'string') {
      await supabase.auth.signOut();
      setError(
        'We could not set up your account profile. Please try again; if the problem continues, contact an administrator to check the database migration and your account role.'
      );
      setLoading(false);
      return;
    }

    window.location.href = getRoleHomePath(role);
  };

  const handleResendConfirmation = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Enter your email address first.');
      return;
    }

    setResendingConfirmation(true);
    setConfirmationMessage('');
    setError('');
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: normalizedEmail,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (resendError) {
      setError('We could not send a confirmation email right now. Please try again later.');
    } else {
      setConfirmationMessage(
        'If this address has an unverified account, a new confirmation email will be sent.'
      );
      setCanResendConfirmation(false);
    }
    setResendingConfirmation(false);
  };

  return (
    <div className="workflow-system flex min-h-screen items-center justify-center bg-cream px-4 py-12">
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
          <p className="mt-2 text-xs text-muted-text">File workflow tracking</p>
        </div>

        {/* Sign-in card */}
        <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
          <p className="mb-4 flex items-center gap-2 text-[11px] font-medium text-muted-text">
            <span className="h-1.5 w-1.5 rounded-full bg-clay" /> Sign in to your account
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            {verified && (
              <p role="status" className="rounded-xl border border-approved-bg bg-approved-bg/50 px-4 py-3 text-xs font-medium text-approved-text">
                Your email is verified. Log in to your account.
              </p>
            )}
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClasses}
                required
              />
            </div>

            {canResendConfirmation && (
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resendingConfirmation}
                className="text-xs font-semibold text-clay underline underline-offset-2 disabled:opacity-50"
              >
                {resendingConfirmation ? 'Sending confirmation...' : 'Resend confirmation email'}
              </button>
            )}
            {confirmationMessage && (
              <p role="status" className="rounded-xl border border-approved-bg bg-approved-bg/50 px-4 py-3 text-xs font-medium text-approved-text">
                {confirmationMessage}
              </p>
            )}

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
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </section>

        {/* Register link */}
        <div className="mt-3 rounded-2xl border border-dashed border-warm-border bg-sidebar p-4 text-center text-xs text-muted-text">
          New to CONNECT&#8209;Daet?{' '}
          <Link href="/register" className="font-semibold text-clay transition-colors hover:text-warm-text">
            Create an account
          </Link>
        </div>
        <p className="mt-4 text-center text-xs text-muted-text">
          <Link href="/forgot-password" className="font-semibold text-clay transition-colors hover:text-warm-text">
            Forgot your password?
          </Link>
        </p>

        <p className="mt-6 text-center text-[10px] text-muted-text">v1.0.4</p>
      </div>
    </div>
  );
}