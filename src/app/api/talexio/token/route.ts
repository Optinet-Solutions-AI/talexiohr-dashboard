import { NextRequest, NextResponse } from 'next/server'
import { saveStoredToken, verifyToken, getTokenStatus, decodeJwtExpiry } from '@/lib/talexio/token-store'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Save a new Talexio token. Format-checks (JWT shape, decodable expiry) are
 * hard gates; the live API ping is best-effort and reported back to the UI as
 * a warning, not a rejection — Talexio's verification queries are stricter
 * about session-level "select a payroll" than the cron's actual data queries,
 * so a token can be perfectly valid for production use even if our probe
 * returns a domain error.
 */
export async function POST(req: NextRequest) {
  let body: { token?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const token = (body.token ?? '').trim()
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 })
  if (token.length < 20) return NextResponse.json({ error: 'token looks too short — paste the full JWT from Talexio' }, { status: 400 })

  // Format check: must be a JWT with a decodable expiry. Anything else is
  // either malformed or already expired beyond what we can read.
  const isJwt = token.split('.').length === 3
  if (!isJwt) {
    return NextResponse.json({ error: 'Token does not look like a JWT (expected three dot-separated parts)' }, { status: 400 })
  }
  const expiry = decodeJwtExpiry(token)
  if (!expiry) {
    return NextResponse.json({ error: 'Could not decode an expiry from this JWT — make sure you copied the full token' }, { status: 400 })
  }
  if (expiry.getTime() < Date.now()) {
    return NextResponse.json({ error: `This token already expired at ${expiry.toISOString()} — get a fresh one` }, { status: 400 })
  }

  // Best-effort live ping. We don't block on its result — Talexio's verifier
  // queries can return "select payroll" even when the same token works fine
  // for the cron's pagedTimeLogs path.
  const liveCheck = await verifyToken(token)

  // Capture who pasted the token (for the audit trail). Auth is currently
  // disabled project-wide, so this is best-effort.
  let updatedBy: string | null = null
  try {
    const authed = await createServerClient()
    const { data: { user } } = await authed.auth.getUser()
    updatedBy = user?.email ?? null
  } catch { /* anonymous ok */ }

  const { expiresAt } = await saveStoredToken(token, updatedBy)
  const status = await getTokenStatus()
  status.liveCheck = liveCheck
  return NextResponse.json({ ok: true, expiresAt, liveCheck, status })
}
