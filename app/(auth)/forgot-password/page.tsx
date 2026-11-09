'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

const fieldClasses =
  'h-11 w-full rounded-full border border-warm-border bg-card px-4 text-sm text-warm-text caret-current outline-none transition-colors placeholder:text-muted-text/60 focus:border-clay';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const response = await fetch('/api/auth/password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (response.status === 404) {
        setStatus({ type: 'error', message: "This email doesn't exist." });
        return;
      }
      if (!response.ok) {
        throw new Error('Password recovery request failed.');
      }
      setStatus({
        type: 'success',
        message: 'Password reset email sent. Check your inbox.',
      });
    } catch {
      setStatus({
        type: 'error',
        message: 'We could not process your request right now. Please try again later.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-[32px] leading-tight text-warm-text">Reset your password</h1>
          <p className="mt-2 text-xs text-muted-text">We will email you a secure reset link.</p>
        </div>
        <section className="rounded-2xl border border-warm-border bg-card p-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[11px] font-medium text-muted-text">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={fieldClasses}
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
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        </section>
        <p className="mt-4 text-center text-xs text-muted-text">
          <Link href="/login" className="font-semibold text-clay hover:text-warm-text">Back to login</Link>
        </p>
      </div>
    </div>
  );
}
