import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({
    request: {
      headers: req.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            req.cookies.set(name, value)
          )
          res = NextResponse.next({
            request: req,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // If not logged in, redirect to login
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // If non-admin tries to access /workflow/admin, redirect them
  if (req.nextUrl.pathname.startsWith('/workflow/admin')) {
    if (user.app_metadata?.role !== 'admin') {
      return NextResponse.redirect(new URL('/workflow/user', req.url))
    }
  }

  // If non-approver tries to access /workflow/approver, redirect them
  if (req.nextUrl.pathname.startsWith('/workflow/approver')) {
    if (user.app_metadata?.role !== 'approver' && user.app_metadata?.role !== 'admin') {
      return NextResponse.redirect(new URL('/workflow/user', req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/workflow/:path*']
}