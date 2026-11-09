import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const verificationType = request.nextUrl.searchParams.get('type');
  const destination = new URL('/setup-password', request.url);

  if (!tokenHash || verificationType !== 'invite') {
    destination.searchParams.set('invite', 'failed');
    return NextResponse.redirect(destination);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error('Invite verification is unavailable: Supabase public configuration is missing.');
    destination.searchParams.set('invite', 'failed');
    return NextResponse.redirect(destination);
  }

  const response = NextResponse.redirect(destination);
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'invite',
  });

  if (error) {
    console.error('Official account invitation verification failed:', error.message);
    destination.searchParams.set('invite', 'failed');
    response.headers.set('Location', destination.toString());
  }

  return response;
}
