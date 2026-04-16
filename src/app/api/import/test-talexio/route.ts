import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const DOMAIN = 'roosterpartners.talexiohr.com'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)

  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 })

  try {
    const res = await fetch('https://api.talexiohr.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${token}`,
        'client-domain': DOMAIN,
        'apollographql-client-name': 'talexio-hr-frontend',
        'apollographql-client-version': '1.0',
      },
      body: JSON.stringify({
        operationName: 'TestTimeLogs',
        query: `query TestTimeLogs($params: TimeLogsFilterParams, $pageNumber: Int!, $pageSize: Int!) {
          pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize, withTotal: true) {
            totalCount
            timeLogs {
              id from to label
              employee { id fullName }
              workLocationIn { name }
            }
          }
        }`,
        variables: {
          params: { from: date, to: date, selectedUnitIds: [], selectedRoomIds: [], selectedEmployeeIds: [] },
          pageNumber: 1,
          pageSize: 5,
        },
      }),
      cache: 'no-store',
    })

    const json = await res.json()

    return NextResponse.json({
      queryOk: !json.errors?.length && !!json.data,
      hasErrors: !!json.errors?.length,
      errors: json.errors || null,
      totalCount: json.data?.pagedTimeLogs?.totalCount ?? null,
      sampleLogs: json.data?.pagedTimeLogs?.timeLogs?.slice(0, 3) ?? [],
      rawError: json.error || null,
      tokenExpiry: (() => {
        try { return JSON.parse(atob(token.split('.')[1])).expiryDate } catch { return null }
      })(),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Test failed' }, { status: 500 })
  }
}
