import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
const DOMAIN = 'roosterpartners.talexiohr.com'

function gqlFetch(token: string, query: string, variables: Record<string, unknown>) {
  return fetch('https://api.talexiohr.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'authorization': `Bearer ${token}`,
      'client-domain': DOMAIN,
      'apollographql-client-name': 'talexio-hr-frontend',
      'apollographql-client-version': '1.0',
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store' as const,
  })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)

  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 })

  try {
    // Probe 1: minimal query with just id/totalCount to test access
    const probe1 = await gqlFetch(token,
      `query Probe1($params: TimeLogsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
        pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize) {
          totalCount
          timeLogs { id }
        }
      }`,
      { params: { dateFrom: date, dateTo: date, employeeIds: [] }, pageNumber: 1, pageSize: 3 }
    )
    const p1 = await probe1.json()

    // Probe 2: common field names — errors will reveal the real ones
    const probe2 = await gqlFetch(token,
      `query Probe2($params: TimeLogsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
        pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize) {
          totalCount
          timeLogs {
            id
            date
            from
            to
            timeIn
            timeOut
            locationLatIn
            locationLongIn
            locationLatOut
            locationLongOut
            label
            employee { id fullName firstName lastName }
            workLocationIn { id name long lat }
            workLocationOut { id name long lat }
          }
        }
      }`,
      { params: { dateFrom: date, dateTo: date, employeeIds: [] }, pageNumber: 1, pageSize: 3 }
    )
    const p2 = await probe2.json()

    return NextResponse.json({
      probe1_minimal: {
        ok: !p1.errors?.length,
        errors: p1.errors ?? null,
        totalCount: p1.data?.pagedTimeLogs?.totalCount ?? null,
        sample: p1.data?.pagedTimeLogs?.timeLogs ?? [],
      },
      probe2_full_fields: {
        ok: !p2.errors?.length,
        errors: p2.errors ?? null,
        totalCount: p2.data?.pagedTimeLogs?.totalCount ?? null,
        sample: p2.data?.pagedTimeLogs?.timeLogs?.slice(0, 2) ?? [],
      },
      tokenExpiry: (() => { try { return JSON.parse(atob(token.split('.')[1])).expiryDate } catch { return null } })(),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Test failed' }, { status: 500 })
  }
}
