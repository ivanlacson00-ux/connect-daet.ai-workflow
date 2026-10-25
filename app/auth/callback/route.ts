import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const response = NextResponse.redirect(new URL('/login', request.url));

  if (!code) {
    response.headers.set(
      'Location',
      new URL('/login?verification=failed', request.url).toString()
    );
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  const redirectUrl = error ? '/login?verification=failed' : '/login?verified=1';
  response.headers.set('Location', new URL(redirectUrl, request.url).toString());

  return response;
}
