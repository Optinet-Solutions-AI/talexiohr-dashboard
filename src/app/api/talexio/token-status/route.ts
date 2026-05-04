import { NextRequest, NextResponse } from 'next/server'
import { getStoredToken, getTokenStatus, verifyToken } from '@/lib/talexio/token-store'

export const dynamic = 'force-dynamic'

/**
 * Returns the current Talexio token's status. Pass `?live=1` to additionally
 * ping the API and verify the token actually works (slower; do this on demand
 * from the UI, not on every page load).
 */
export async function GET(req: NextRequest) {
  const live = req.nextUrl.searchParams.get('live') === '1'
  const status = await getTokenStatus()

  if (live && (status.state === 'valid' || status.state === 'unverified')) {
    const stored = await getStoredToken()
    if (stored.token) {
      const check = await verifyToken(stored.token)
      status.liveCheck = check
      // Live check overrides stored expiry-based state
      if (!check.ok && status.state === 'valid') status.state = 'expired'
    }
  }

  return NextResponse.json(status)
}
