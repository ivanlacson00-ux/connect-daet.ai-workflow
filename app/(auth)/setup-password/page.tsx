'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getRoleHomePath } from '@/lib/workflow/offices';

export default function SetupPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [inviteFailed, setInviteFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const checkInvitation = async () => {
      const params = new URLSearchParams(window.location.search);
      const failedInvitation = params.get('invite') === 'failed';
      if (failedInvitation) {
        setInviteFailed(true);
        setError('This invitation link is invalid or has expired. Ask your administrator to create a new invitation.');
        params.delete('invite');
        const query = params.toString();
        window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!active) return;

      if (userError || !user) {
        if (!failedInvitation) {
          setError('Open the invitation link sent by your administrator to set up your account.');
        }
        return;
      }

      setReady(true);
    };

    void checkInvitation();
    return () => { active = false; };
  }, [supabase]);

  const setInitialPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Your password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      console.error('Could not set the invited account password:', passwordError.message);
      setError(passwordError.message);
      setSubmitting(false);
      return;
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Could not load the verified invited account:', userError?.message);
      setError('Your password was saved, but we could not load your role. Please sign in to continue.');
      setSubmitting(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      console.error('Could not load the invited account role:', profileError?.message);
      setError('Your password was saved, but we could not load your role. Please contact an administrator.');
      setSubmitting(false);
      return;
    }

    window.location.href = getRoleHomePath(profile.role);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-12">
      <div className="w-full max-w-[420px]">
        <header className="mb-8 text-center">
          <h1 className="font-serif text-[32px] leading-tight text-warm-text">Set up your account</h1>
          <p className="mt-2 text-xs text-muted-text">Verify your invitation and choose a password to access your assigned dashboard.</p>
        </header>

        <section className="rounded-2xl border border-warm-border bg-card p-5 max-md:p-3.5">
          {ready && !inviteFailed ? (
            <form onSubmit={setInitialPassword} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-[11px] font-medium text-muted-text">New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-sm text-warm-text outline-none focus:border-clay"
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-[11px] font-medium text-muted-text">Confirm password</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  className="h-11 w-full rounded-full border border-warm-border bg-card px-4 text-sm text-warm-text outline-none focus:border-clay"
                />
              </div>
              {error && (
                <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">{error}</p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-clay px-6 text-xs font-semibold text-white transition-colors hover:bg-warm-text disabled:opacity-50"
              >
                {submitting ? 'Setting password...' : 'Set password and continue'}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {error && (
                <p role="alert" className="rounded-xl border border-rejected-bg bg-rejected-bg/50 px-4 py-3 text-xs font-medium text-rejected-text">{error}</p>
              )}
              {!error && <p className="text-xs text-muted-text">Checking your invitation...</p>}
              {inviteFailed && (
                <Link href="/login" className="inline-flex h-11 w-full items-center justify-center rounded-full border border-warm-border text-xs font-semibold text-warm-text hover:bg-sidebar">
                  Return to sign in
                </Link>
              )}
            </div>
          )}
        </section>
        <p className="mt-4 text-center text-[11px] text-muted-text">
          Need help? Contact the administrator who sent your invitation.
        </p>
      </div>
    </div>
  );
}
