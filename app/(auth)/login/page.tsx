'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const supabase = createClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError || !refreshed.user) {
      setError('Session error. Please try again.');
      setLoading(false);
      return;
    }

    const role = refreshed.user.app_metadata?.role;

    if (role === 'admin') {
      window.location.href = '/workflow/admin';
    } else if (role === 'approver') {
      window.location.href = '/workflow/approver';
    } else {
      window.location.href = '/workflow/user';
    }

    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{
        backgroundColor: '#0d1117',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
        color: '#e6edf3',
      }}
    >
      <div className="w-full max-w-[340px]">
        {/* Wordmark / product identity */}
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-10 h-10 rounded-md flex items-center justify-center mb-3"
            style={{ backgroundColor: '#e6edf3' }}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M1.5 2.5h13v3h-13v-3ZM1.5 7h6v6.5h-6V7ZM9 7h5.5v6.5H9V7Z"
                stroke="#0d1117"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-[15px] font-semibold" style={{ color: '#e6edf3' }}>
            CONNECT&#8209;Daet
          </span>
          <span className="text-[13px] mt-0.5" style={{ color: '#7d8590' }}>
            File workflow tracking
          </span>
        </div>

        {/* Sign-in card */}
        <div
          className="rounded-md px-5 py-6"
          style={{
            backgroundColor: '#0d1117',
            border: '1px solid #30363d',
          }}
        >
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-[13px] font-semibold mb-1"
                style={{ color: '#e6edf3' }}
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md px-3 py-[7px] text-[14px] outline-none transition-shadow"
                style={{
                  border: '1px solid #30363d',
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#1f6feb';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,111,235,0.3)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#30363d';
                  e.currentTarget.style.boxShadow = 'none';
                }}
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="password"
                  className="block text-[13px] font-semibold"
                  style={{ color: '#e6edf3' }}
                >
                  Password
                </label>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md px-3 py-[7px] text-[14px] outline-none transition-shadow"
                style={{
                  border: '1px solid #30363d',
                  backgroundColor: '#0d1117',
                  color: '#e6edf3',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#1f6feb';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(31,111,235,0.3)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#30363d';
                  e.currentTarget.style.boxShadow = 'none';
                }}
                required
              />
            </div>

            {error && (
              <div
                className="rounded-md px-3 py-2 text-[13px] flex items-start gap-2"
                style={{
                  backgroundColor: 'rgba(248,81,73,0.1)',
                  border: '1px solid rgba(248,81,73,0.4)',
                  color: '#f85149',
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="mt-[2px] flex-shrink-0"
                >
                  <path d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md py-[7px] text-[14px] font-semibold transition-colors"
              style={{
                backgroundColor: loading ? '#2b6b3a' : '#238636',
                color: '#ffffff',
                border: '1px solid rgba(240,246,252,0.1)',
                cursor: loading ? 'default' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.backgroundColor = '#2ea043';
              }}
              onMouseLeave={(e) => {
                if (!loading) e.currentTarget.style.backgroundColor = '#238636';
              }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Register link, outside card GitHub-style */}
        <div
          className="mt-4 rounded-md px-5 py-4 text-center text-[13px]"
          style={{
            backgroundColor: '#161b22',
            border: '1px solid #30363d',
            color: '#e6edf3',
          }}
        >
          New to CONNECT&#8209;Daet?{' '}
          <Link href="/register" className="font-medium" style={{ color: '#4493f8' }}>
            Create an account
          </Link>
        </div>

        <p className="text-center text-[12px] mt-6" style={{ color: '#7d8590' }}>
          v1.0.4
        </p>
      </div>
    </div>
  );
}