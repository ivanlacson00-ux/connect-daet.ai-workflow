import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getRoleHomePath, isOfficeRole } from '@/lib/workflow/offices'

export async function proxy(req: NextRequest) {
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
          cookiesToSet.forEach(({ name, value }) =>
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

  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (!user.email_confirmed_at) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('verification', 'required')
    return NextResponse.redirect(loginUrl)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.role) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('profile', 'unavailable')
    return NextResponse.redirect(loginUrl)
  }

  const role = profile?.role ?? null
  const pathname = req.nextUrl.pathname

  if (pathname.startsWith('/workflow/user') && role !== 'submitter') {
    return NextResponse.redirect(new URL(getRoleHomePath(role), req.url))
  }

  if (pathname.startsWith('/workflow/admin') && role !== 'system_admin') {
    return NextResponse.redirect(new URL(getRoleHomePath(role), req.url))
  }

  const officeRoutes = [
    { path: '/workflow/municipal-treasurer', role: 'municipal_treasurer' },
    { path: '/workflow/mayor', role: 'mayor_office' },
    { path: '/workflow/sangguniang-bayan', role: 'sangguniang_bayan' },
  ] as const
  const requestedOffice = officeRoutes.find(({ path }) => pathname.startsWith(path))

  if (requestedOffice && role !== requestedOffice.role) {
    return NextResponse.redirect(new URL(getRoleHomePath(role), req.url))
  }

  if (pathname.startsWith('/workflow/approver')) {
    const officeReviewPage =
      pathname === '/workflow/approver/file_management'
      || pathname.startsWith('/workflow/approver/file_management/')

    if (role !== 'tourism_officer' && role !== 'system_admin') {
      if (officeReviewPage && isOfficeRole(role)) {
        return res
      }
      return NextResponse.redirect(new URL(getRoleHomePath(role), req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/workflow/:path*']
}