import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getRoleHomePath, isOfficeRole, OFFICE_CONFIG } from '@/lib/workflow/offices'

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
    .select('role, is_active')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.role) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('profile', 'unavailable')
    return NextResponse.redirect(loginUrl)
  }

  if (profile.is_active === false) {
    await supabase.auth.signOut()
    const disabledResponse = NextResponse.redirect(
      new URL('/login?account=disabled', req.url)
    )
    res.cookies.getAll().forEach(({ name, value, ...options }) => {
      disabledResponse.cookies.set(name, value, options)
    })
    return disabledResponse
  }

  const role = profile?.role ?? null
  let pathname = req.nextUrl.pathname

  if (pathname === '/workflow/approver' || pathname.startsWith('/workflow/approver/')) {
    const legacySuffix = pathname.slice('/workflow/approver'.length)
    if (!isOfficeRole(role) && role !== 'system_admin') {
      return NextResponse.redirect(new URL(getRoleHomePath(role), req.url))
    }

    const officeRole = isOfficeRole(role) ? role : 'tourism_officer'
    const destination = new URL(`/workflow/reviewer${legacySuffix}`, req.url)
    destination.search = req.nextUrl.search
    if (role === 'system_admin') destination.searchParams.set('office', officeRole)
    return NextResponse.redirect(destination)
  }

  const legacyOffice = Object.entries(OFFICE_CONFIG).find(([, office]) =>
    pathname === office.legacyPath || pathname.startsWith(`${office.legacyPath}/`)
  )
  if (legacyOffice) {
    const [officeRole, office] = legacyOffice
    if (role !== officeRole && role !== 'system_admin') {
      return NextResponse.redirect(new URL(getRoleHomePath(role), req.url))
    }

    const legacySuffix = pathname.slice(office.legacyPath.length)
    const destination = new URL(`/workflow/reviewer${legacySuffix}`, req.url)
    destination.search = req.nextUrl.search
    if (role === 'system_admin') destination.searchParams.set('office', officeRole)
    return NextResponse.redirect(destination)
  }

  if (pathname.startsWith('/workflow/user') && role !== 'submitter') {
    return NextResponse.redirect(new URL(getRoleHomePath(role), req.url))
  }

  if (pathname.startsWith('/workflow/admin') && role !== 'system_admin') {
    return NextResponse.redirect(new URL(getRoleHomePath(role), req.url))
  }

  if (
    (pathname === '/workflow/reviewer' || pathname.startsWith('/workflow/reviewer/'))
    && !isOfficeRole(role)
    && role !== 'system_admin'
  ) {
    return NextResponse.redirect(new URL(getRoleHomePath(role), req.url))
  }

  if (
    (pathname === '/workflow/reviewer' || pathname.startsWith('/workflow/reviewer/'))
    && role === 'system_admin'
    && !isOfficeRole(req.nextUrl.searchParams.get('office'))
  ) {
    return NextResponse.redirect(new URL('/workflow/admin', req.url))
  }

  return res
}

export const config = {
  matcher: ['/workflow/:path*']
}