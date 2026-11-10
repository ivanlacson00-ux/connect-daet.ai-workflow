import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (
    typeof payload !== 'object'
    || payload === null
    || !('email' in payload)
    || typeof payload.email !== 'string'
    || !payload.email.trim()
  ) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 });
  }

  let applicationOrigin: URL;
  try {
    applicationOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin);
    if (!['http:', 'https:'].includes(applicationOrigin.protocol)) {
      throw new Error('The application URL must use HTTP or HTTPS.');
    }
  } catch (error) {
    console.error('Password recovery has an invalid application URL:', error);
    return NextResponse.json(
      { error: 'Password recovery is not configured correctly.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const response = NextResponse.json(
    { requested: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.error('Password recovery is missing public Supabase configuration.');
    return NextResponse.json(
      { error: 'Password recovery is not configured correctly.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const normalizedEmail = payload.email.trim().toLowerCase();
  const redirectTo = new URL('/auth/callback', applicationOrigin);
  redirectTo.searchParams.set('next', '/reset-password');
  const { error } = await supabase.auth.resetPasswordForEmail(
    normalizedEmail,
    { redirectTo: redirectTo.toString() }
  );

  if (error) {
    console.error('Password recovery request failed:', error.message);
    return NextResponse.json(
      { error: 'We could not process your request right now. Please try again later.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return response;
}
