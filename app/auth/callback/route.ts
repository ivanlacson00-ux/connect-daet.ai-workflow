import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const callbackCode = request.nextUrl.searchParams.get('code');
  const redirectUrl = new URL('/login', request.url);
  const response = NextResponse.redirect(redirectUrl);

  if (!callbackCode) {
    redirectUrl.searchParams.set('verification', 'failed');
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

  const { error } = await supabase.auth.exchangeCodeForSession(callbackCode);
  if (error) {
    redirectUrl.searchParams.set('verification', 'failed');
  } else {
    redirectUrl.searchParams.set('verified', '1');
  }
  response.headers.set('Location', redirectUrl.toString());

  return response;
}
