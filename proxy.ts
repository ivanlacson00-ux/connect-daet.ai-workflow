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
  const redirectWithSessionCookies = (url: URL) => {
    const redirectResponse = NextResponse.redirect(url)
    res.cookies.getAll().forEach(({ name, value, ...options }) => {
      redirectResponse.cookies.set(name, value, options)
    })
    return redirectResponse
  }

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
          const nextResponse = NextResponse.next({
            request: {
              headers: req.headers,
            },
          })
          res.cookies.getAll().forEach(({ name, value, ...options }) => {
            nextResponse.cookies.set(name, value, options)
          })
          res = nextResponse
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (!user) {
    if (authError?.code === 'refresh_token_not_found') {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('session', 'expired')
      return redirectWithSessionCookies(loginUrl)
    }
    if (authError) {
      console.error('Could not verify workflow session:', authError.message)
    }
    return redirectWithSessionCookies(new URL('/login', req.url))
  }

  if (!user.email_confirmed_at) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('verification', 'required')
    return redirectWithSessionCookies(loginUrl)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single()
  if (profile?.is_active === false) {
    await supabase.auth.signOut()
    return redirectWithSessionCookies(
      new URL('/login?account=disabled', req.url)
    )
  }
  const role = profile?.role ?? null
  const pathname = req.nextUrl.pathname

  if (pathname.startsWith('/workflow/user') && role !== 'submitter') {
    return redirectWithSessionCookies(new URL(getRoleHomePath(role), req.url))
  }

  if (pathname.startsWith('/workflow/admin') && role !== 'system_admin') {
    return redirectWithSessionCookies(new URL(getRoleHomePath(role), req.url))
  }

  const officeRoutes = [
    { path: '/workflow/municipal-treasurer', role: 'municipal_treasurer' },
    { path: '/workflow/mayor', role: 'mayor_office' },
    { path: '/workflow/sangguniang-bayan', role: 'sangguniang_bayan' },
  ] as const
  const requestedOffice = officeRoutes.find(({ path }) => pathname.startsWith(path))

  if (requestedOffice && role !== requestedOffice.role) {
    return redirectWithSessionCookies(new URL(getRoleHomePath(role), req.url))
  }

  if (pathname.startsWith('/workflow/approver')) {
    const officeReviewPage =
      pathname.startsWith('/workflow/approver/file_management/')

    if (role !== 'tourism_officer' && role !== 'system_admin') {
      if (officeReviewPage && isOfficeRole(role)) {
        return res
      }
      return redirectWithSessionCookies(new URL(getRoleHomePath(role), req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/workflow/:path*']
}