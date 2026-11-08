import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const recoveryRequestCookieName = 'docuflow-password-recovery-request';

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

  const response = NextResponse.json(
    { requested: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );
  const redirectTo = new URL('/auth/callback', request.nextUrl.origin);
  redirectTo.searchParams.set('next', '/reset-password');
  const { error } = await supabase.auth.resetPasswordForEmail(
    payload.email.trim().toLowerCase(),
    { redirectTo: redirectTo.toString() }
  );

  if (error) {
    console.error('Password recovery request failed:', error.message);
    return NextResponse.json(
      { error: 'We could not process your request right now. Please try again later.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  response.cookies.set(recoveryRequestCookieName, 'requested', {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/auth/callback',
    maxAge: 60 * 60,
  });
  return response;
}
