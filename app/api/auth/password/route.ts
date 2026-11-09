import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { MINIMUM_PASSWORD_LENGTH } from '@/lib/auth/password';

const recoveryCookieName = 'docuflow-password-recovery';

function jsonResponse(
  source: NextResponse,
  body: object,
  status = 200
) {
  const response = NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

function createSupabaseClient(request: NextRequest, response: NextResponse) {
  return createServerClient(
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
}

function clearRecoveryCookie(request: NextRequest, response: NextResponse) {
  response.cookies.set(recoveryCookieName, '', {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/auth/password',
    maxAge: 0,
  });
}

export async function GET(request: NextRequest) {
  const response = NextResponse.json(
    { authorized: false },
    { headers: { 'Cache-Control': 'no-store' } }
  );
  const supabase = createSupabaseClient(request, response);
  const { data: { user }, error } = await supabase.auth.getUser();
  const authorized =
    Boolean(request.cookies.get(recoveryCookieName)?.value)
    && !error
    && Boolean(user?.email_confirmed_at);

  if (authorized) {
    return jsonResponse(response, { authorized: true });
  }

  clearRecoveryCookie(request, response);
  return response;
}

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  if (!request.cookies.get(recoveryCookieName)?.value) {
    return NextResponse.json({ error: 'Password recovery session is missing or expired' }, { status: 401 });
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
    || !('password' in payload)
    || typeof payload.password !== 'string'
  ) {
    return NextResponse.json({ error: 'A new password is required' }, { status: 400 });
  }
  if (payload.password.length < MINIMUM_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const response = NextResponse.json(
    { updated: false },
    { headers: { 'Cache-Control': 'no-store' } }
  );
  const supabase = createSupabaseClient(request, response);
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user?.email_confirmed_at) {
    clearRecoveryCookie(request, response);
    return jsonResponse(response, { error: 'Password recovery session is invalid or expired' }, 401);
  }

  const { error } = await supabase.auth.updateUser({ password: payload.password });
  if (error) {
    console.error('Password recovery update failed:', error.message);
    return jsonResponse(
      response,
      { error: 'Could not update your password. Request a new reset link and try again.' },
      400
    );
  }

  clearRecoveryCookie(request, response);
  return jsonResponse(response, { updated: true });
}
