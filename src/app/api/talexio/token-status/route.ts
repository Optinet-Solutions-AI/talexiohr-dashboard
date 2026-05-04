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
      status.liveCheck = await verifyToken(stored.token)
      // Don't downgrade state on live-check failure: Talexio's verifier
      // queries return "select payroll" even when the token works fine for
      // the cron's actual data queries. The cron's success/failure (logged
      // to sync_log) is the real signal — surfaced via SyncHealthBanner.
    }
  }

  return NextResponse.json(status)
}
