import { NextRequest, NextResponse } from 'next/server'
import { loginTalexio } from '@/lib/talexio/session'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    // Step 1: Try to login
    const token = await loginTalexio()

    // Step 2: Try a simple query with the Bearer token
    const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)

    const res = await fetch('https://api.talexiohr.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${token}`,
        'client-domain': 'roosterpartners.talexiohr.com',
        'apollographql-client-name': 'talexio-hr-frontend',
        'apollographql-client-version': '1.0',
      },
      body: JSON.stringify({
        operationName: 'TestTimeLogs',
        query: `query TestTimeLogs($params: TimeLogsFilterParams, $pageNumber: Int!, $pageSize: Int!) {
          pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize, withTotal: true) {
            totalCount
            timeLogs {
              id
              from
              to
              label
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
      loginOk: true,
      tokenExpiry: (() => {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]))
          return payload.expiryDate
        } catch { return null }
      })(),
      queryOk: !json.errors?.length && !!json.data,
      hasErrors: !!json.errors?.length,
      errors: json.errors || null,
      totalCount: json.data?.pagedTimeLogs?.totalCount ?? null,
      sampleLogs: json.data?.pagedTimeLogs?.timeLogs?.slice(0, 3) ?? [],
      rawError: json.error || null,
    })
  } catch (err) {
    return NextResponse.json({
      loginOk: false,
      error: err instanceof Error ? err.message : 'Test failed',
    }, { status: 500 })
  }
}
