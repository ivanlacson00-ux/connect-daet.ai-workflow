import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

export async function GET(request: NextRequest) {
  const callbackCode = request.nextUrl.searchParams.get('code');
  const isPasswordRecovery = request.nextUrl.searchParams.get('next') === '/reset-password';
  const redirectUrl = new URL('/login', request.url);
  const response = NextResponse.redirect(redirectUrl);

  if (!callbackCode) {
    if (isPasswordRecovery) {
      redirectUrl.pathname = '/reset-password';
      redirectUrl.searchParams.set('error', 'expired');
    } else {
      redirectUrl.searchParams.set('verification', 'failed');
    }
    response.headers.set('Location', redirectUrl.toString());
    return response;
  }

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

  const { data, error } = await supabase.auth.exchangeCodeForSession(callbackCode);
  if (isPasswordRecovery) {
    redirectUrl.pathname = '/reset-password';
    if (error || !data.user) {
      redirectUrl.searchParams.set('error', 'invalid');
    } else {
      response.cookies.set('docuflow-password-recovery', randomUUID(), {
        httpOnly: true,
        secure: request.nextUrl.protocol === 'https:',
        sameSite: 'lax',
        path: '/api/auth/password',
        maxAge: 15 * 60,
      });
    }
  } else if (error || !data.user?.email_confirmed_at) {
    redirectUrl.searchParams.set('verification', 'failed');
  } else {
    redirectUrl.searchParams.set('verified', '1');
  }
  response.headers.set('Location', redirectUrl.toString());

  return response;
}
