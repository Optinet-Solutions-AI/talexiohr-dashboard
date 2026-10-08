import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Session refresh + access gate, run from `src/proxy.ts` on every request.
 *
 *  - No session       → pages redirect to /login, API routes get 401.
 *  - Temporary password (app_metadata.must_change_password) → everything
 *    redirects to /change-password until a new password is set.
 *  - Signed-in users hitting /login are sent to the dashboard.
 *  - /signup is gone: accounts are provisioned by an admin.
 *
 * The Vercel cron calls /api/attendance/daily-sync with its own bearer
 * secret (validated inside the route), so that request passes through.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
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
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api/')

  if (pathname === '/api/attendance/daily-sync' && request.headers.get('authorization')) {
    return response
  }
  if (pathname === '/signup') {
    return redirectWithCookies('/login')
  }

  // getUser() validates against the Auth server, so banned users and
  // metadata changes take effect immediately rather than at JWT refresh.
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    if (isApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (pathname === '/login') return response
    return redirectWithCookies('/login')
  }

  const mustChangePassword = user.app_metadata?.must_change_password === true
  if (mustChangePassword && pathname !== '/change-password') {
    if (isApi) return NextResponse.json({ error: 'Password change required' }, { status: 403 })
    return redirectWithCookies('/change-password')
  }

  if (pathname === '/login') {
    return redirectWithCookies('/dashboard')
  }

  return response

  function redirectWithCookies(to: string): NextResponse {
    const redirect = NextResponse.redirect(new URL(to, request.url))
    // Carry any refreshed auth cookies across the redirect.
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c))
    return redirect
  }
}
