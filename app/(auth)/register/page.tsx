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
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState(''); // New state
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success', message: string } | null>(null);
  
  const supabase = createClient();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation: Passwords must match
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
        }
      }
    });

    if (error) {
      setStatus({ type: 'error', message: error.message });
      setLoading(false);
    } else {
      setStatus({ 
        type: 'success', 
        message: 'User created successfully.' 
      });
      setLoading(false);
      
      // Clear form
      setEmail('');
      setFullName('');
      setPassword('');
      setConfirmPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-gray-900 flex items-center justify-center p-6 border-t-8 border-blue-600">
      <div className="max-w-[500px] w-full">
        
        {/* Header */}
        <div className="mb-10 border-b-2 border-gray-900 pb-8">
          <h1 className={`${fonts.serif} text-7xl font-light text-gray-900 leading-none`}>
            Registration.
          </h1>
          <p className={`${fonts.mono} mt-4 text-blue-600 font-bold`}>
            Create your account // User Registration
          </p>
        </div>

        <div className="bg-white border-2 border-black p-8 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden">
          
          <form onSubmit={handleSignUp} className="relative z-10 space-y-8">
            
            {/* Full Name */}
            <div className="space-y-1">
              <label className={`${fonts.mono} text-gray-400 block font-bold`}>
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-transparent border-b-2 border-gray-200 py-2 text-xl focus:outline-none focus:border-blue-600 transition-colors font-serif italic"
                placeholder="John Doe"
                required
              />
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label className={`${fonts.mono} text-gray-400 block font-bold`}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent border-b-2 border-gray-200 py-2 text-xl focus:outline-none focus:border-blue-600 transition-colors font-serif italic"
                placeholder="name@email.com"
                required
              />
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label className={`${fonts.mono} text-gray-400 block font-bold`}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border-b-2 border-gray-200 py-2 text-xl focus:outline-none focus:border-blue-600 transition-colors"
                placeholder="••••••••"
                required
              />
            </div>

            {/* Confirm Password */}
            <div className="space-y-1">
              <label className={`${fonts.mono} text-gray-400 block font-bold`}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-transparent border-b-2 border-gray-200 py-2 text-xl focus:outline-none focus:border-blue-600 transition-colors"
                placeholder="••••••••"
                required
              />
            </div>

            {/* Status Message */}
            {status && (
              <div className={`p-4 border-2 font-black ${fonts.mono} animate-in fade-in slide-in-from-top-1 ${
                status.type === 'success' 
                  ? 'border-green-600 bg-green-50 text-green-600' 
                  : 'border-red-600 bg-red-50 text-red-600'
              }`}>
                {status.message}
              </div>
            )}

            {/* Register Button */}
            <button
              type="submit"
              disabled={loading}
              className={`${fonts.mono} w-full bg-blue-600 text-white py-5 hover:bg-black transition-all shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none font-black text-sm`}
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>

            {/* Login Link */}
            <div className="text-center pt-4">
              <p className={`${fonts.mono} text-gray-400`}>
                Already have an account? <Link href="/login" className="text-blue-600 font-black underline underline-offset-4 decoration-2">Log in</Link>
              </p>
            </div>
          </form>
        </div>

        <div className="mt-6 flex justify-between items-center opacity-30">
            <div className={`${fonts.mono}`}>v1.2.0</div>
            <div className={`${fonts.mono}`}>System Online</div>
        </div>
      </div>
    </div>
  );
}