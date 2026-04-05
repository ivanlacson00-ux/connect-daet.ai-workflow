// app/(auth)/register/page.tsx
'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

const fonts = {
  serif: "font-serif italic",
  mono: "font-mono uppercase tracking-[0.2em] text-[10px]",
};

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success', message: string } | null>(null);
  
  const supabase = createClient();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setStatus({ type: 'error', message: error.message });
      setLoading(false);
    } else {
      setStatus({ type: 'success', message: 'Account created! You can now log in.' });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900 flex items-center justify-center p-6">
      <div className="max-w-[500px] w-full">
        
        <div className="mb-12 border-b-2 border-gray-900 pb-8">
          <h1 className={`${fonts.serif} text-6xl font-light text-gray-900 leading-tight`}>
            Register
          </h1>
          <p className={`${fonts.mono} mt-2 text-blue-600`}>
            CONNECT-Daet.ai // New Identity
          </p>
        </div>

        <div className="bg-white border border-blue-600 p-10 shadow-[12px_12px_0px_0px_rgba(37,99,235,1)] relative overflow-hidden">
          <div className="absolute top-[-20px] right-[-20px] opacity-[0.03] pointer-events-none select-none text-9xl font-black uppercase">
            JOIN
          </div>

          <form onSubmit={handleSignUp} className="relative z-10 space-y-8">
            <div className="space-y-2">
              <label className={`${fonts.mono} text-gray-400 block`}>System Identifier (Email)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent border-b-2 border-gray-200 py-3 text-xl focus:outline-none focus:border-blue-600 transition-colors font-serif italic"
                placeholder="identity@daet.ai"
                required
              />
            </div>

            <div className="space-y-2">
              <label className={`${fonts.mono} text-gray-400 block`}>Set Security Key (Password)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border-b-2 border-gray-200 py-3 text-xl focus:outline-none focus:border-blue-600 transition-colors"
                placeholder="••••••••"
                required
              />
            </div>

            {status && (
              <div className={`inline-flex items-center gap-2 border-2 px-4 py-2 rotate-[-1deg] w-full shadow-[4px_4px_0px_0px_currentColor] ${
                status.type === 'success' 
                  ? 'border-green-600 bg-green-50 text-green-600' 
                  : 'border-red-600 bg-red-50 text-red-600'
              } ${fonts.mono} font-black`}>
                <span className="text-lg">●</span>
                {status.message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`${fonts.mono} w-full bg-blue-600 text-white px-8 py-5 hover:bg-black transition-all shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none font-bold text-sm`}
            >
              {loading ? '[ Creating Account... ]' : '[ Create Account ]'}
            </button>

            <div className="text-center pt-4">
              <p className={`${fonts.mono} text-gray-400`}>
                Already registered? <Link href="/login" className="text-blue-600 hover:underline font-bold underline-offset-4 decoration-2">Log in here</Link>
              </p>
            </div>
          </form>

          <div className="mt-10 pt-6 border-t border-gray-100 flex justify-between items-center">
             <div className={`${fonts.mono} text-gray-400`}>v1.0.4 r-status</div>
             <div className="text-2xl">📁</div>
          </div>
        </div>
      </div>
    </div>
  );
}