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

    const exportJson = await exportRes.json()
    const jobId = typeof exportJson === 'number' ? exportJson : exportJson?.id ?? exportJson

    // Test 2: Check the background job status
    const jobRes = await fetch('https://api.talexiohr.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${token}`,
        'client-domain': DOMAIN,
        'apollographql-client-name': 'talexio-hr-frontend',
        'apollographql-client-version': '1.0',
      },
      body: JSON.stringify({
        operationName: 'BackgroundJobQuery',
        query: `query BackgroundJobQuery($id: ID!) {
          backgroundJob(id: $id) {
            id jobStatus jobType
            file { id fileUrl }
          }
        }`,
        variables: { id: jobId },
      }),
      cache: 'no-store',
    })

    const jobJson = await jobRes.json()
    const job = jobJson.data?.backgroundJob

    return NextResponse.json({
      exportOk: exportRes.ok,
      jobId,
      jobStatus: job?.jobStatus ?? null,
      jobType: job?.jobType ?? null,
      hasFile: !!job?.file,
      fileUrl: job?.file?.fileUrl ?? null,
      exportRaw: exportJson,
      jobErrors: jobJson.errors ?? null,
      tokenExpiry: (() => {
        try { return JSON.parse(atob(token.split('.')[1])).expiryDate } catch { return null }
      })(),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Test failed' }, { status: 500 })
  }
}
