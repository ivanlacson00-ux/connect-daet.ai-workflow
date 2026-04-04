// login
// src/app/login/page.tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  const handleSignUp = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setMessage(error.message);
    else setMessage('Check your email for confirmation!');
    setLoading(false);
  };

  const handleSignIn = async () => {
    setLoading(true);
    setMessage('');

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    // ✅ Force refresh to get latest app_metadata role
    // This ensures role changes made by admin are reflected immediately
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError || !refreshed.user) {
      setMessage('Session error. Please try again.');
      setLoading(false);
      return;
    }

    const role = refreshed.user.app_metadata?.role;

    setMessage('Logged in! Redirecting...');

    // ✅ Redirect based on role
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-gray-800">Welcome Back</h1>
        <p className="mb-6 text-sm text-gray-500">Sign in to your account</p>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-3 w-full rounded-lg border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-5 w-full rounded-lg border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <div className="flex gap-3">
          <button
            onClick={handleSignIn}
            disabled={loading}
            className="flex-1 rounded-full bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
          <button
            onClick={handleSignUp}
            disabled={loading}
            className="flex-1 rounded-full bg-gray-600 py-2 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Sign Up
          </button>
        </div>

        {message && (
          <p className={`mt-4 text-sm ${message.includes('Logged') ? 'text-green-600' : 'text-red-600'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}