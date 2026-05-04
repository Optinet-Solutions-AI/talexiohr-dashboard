import { NextRequest, NextResponse } from 'next/server'
import { saveStoredToken, verifyToken, getTokenStatus } from '@/lib/talexio/token-store'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Save a new Talexio token. Validates against the live API before persisting
 * so the user gets immediate feedback if they pasted something stale or
 * malformed.
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

  // Validate before saving — better to reject a bad paste than persist garbage
  const check = await verifyToken(token)
  if (!check.ok) {
    return NextResponse.json({
      error: `Token rejected by Talexio: ${check.error ?? 'unknown error'}`,
      httpStatus: check.httpStatus,
    }, { status: 400 })
  }

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
  return NextResponse.json({ ok: true, expiresAt, status })
}
