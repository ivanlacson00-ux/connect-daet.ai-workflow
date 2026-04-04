// src/app/login/page.tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const supabase = createClient();

  const handleSignUp = async () => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) setMessage(error.message);
    else setMessage('Check your email for confirmation! (or auto-login if disabled)');
  };

  const handleSignIn = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) setMessage(error.message);
    else {
      setMessage('Logged in! Redirecting...');
      window.location.href = '/workflow';
    }
  };

  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="mb-6 text-2xl font-bold">Login / Sign Up</h1>
      
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mb-3 w-full rounded-lg border p-3"
      />
      
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mb-3 w-full rounded-lg border p-3"
      />
      
      <div className="flex gap-3">
        <button
          onClick={handleSignIn}
          className="rounded-full bg-blue-600 px-6 py-2 text-white"
        >
          Login
        </button>
        <button
          onClick={handleSignUp}
          className="rounded-full bg-gray-600 px-6 py-2 text-white"
        >
          Sign Up
        </button>
      </div>
      
      {message && <p className="mt-4 text-sm text-red-600">{message}</p>}
    </div>
  );
}