import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    const login = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.getAll().forEach((cookie) => login.cookies.set(cookie))
    return login
  }

  if (!user.email_confirmed_at) {
    const login = NextResponse.redirect(new URL('/login?verification=required', request.url))
    response.cookies.getAll().forEach((cookie) => login.cookies.set(cookie))
    return login
  }

  const pathname = request.nextUrl.pathname
  if (
    pathname.startsWith('/workflow/mayor')
    || pathname.startsWith('/workflow/municipal-treasurer')
    || pathname.startsWith('/workflow/sangguniang-bayan')
  ) {
    const officeHome = NextResponse.redirect(new URL('/workflow/office', request.url))
    response.cookies.getAll().forEach((cookie) => officeHome.cookies.set(cookie))
    return officeHome
  }

  if (pathname.startsWith('/workflow/retrieval')) {
    const userHome = NextResponse.redirect(new URL('/workflow/user', request.url))
    response.cookies.getAll().forEach((cookie) => userHome.cookies.set(cookie))
    return userHome
  }

  if (pathname.startsWith('/workflow/admin/') && pathname !== '/workflow/admin/') {
    const adminHome = NextResponse.redirect(new URL('/workflow/admin', request.url))
    response.cookies.getAll().forEach((cookie) => adminHome.cookies.set(cookie))
    return adminHome
  }

  return response
}

export const config = {
  matcher: ['/workflow/:path*'],
}
