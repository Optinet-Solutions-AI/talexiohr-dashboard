import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DOMAIN = 'roosterpartners.talexiohr.com'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)

  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 })

  try {
    // Test 1: Try the exportInsightsChart REST endpoint (same as browser)
    const exportRes = await fetch('https://api.talexiohr.com/exportInsightsChart', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${token}`,
        'client-domain': DOMAIN,
      },
      body: JSON.stringify({
        dateFrom: date,
        dateTo: date,
        chartType: 'WEEKLY_SHIFT_OVERVIEW',
      }),
      cache: 'no-store',
    })

    const exportText = await exportRes.text()
    let exportJson: unknown
    try { exportJson = JSON.parse(exportText) } catch { exportJson = exportText }

    return NextResponse.json({
      exportOk: exportRes.ok,
      exportStatus: exportRes.status,
      exportResponseType: typeof exportJson,
      exportResponse: exportJson,
      exportKeys: exportJson && typeof exportJson === 'object' ? Object.keys(exportJson as Record<string, unknown>) : null,
      tokenExpiry: (() => {
        try { return JSON.parse(atob(token.split('.')[1])).expiryDate } catch { return null }
      })(),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Test failed' }, { status: 500 })
  }
}
