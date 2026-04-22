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
    // Test pagedTimeLogs
    const clocksRes = await gqlFetch(token,
      `query TestTimeLogs($params: TimeLogsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
        pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize) {
          totalCount
          timeLogs {
            id from to label
            locationLatIn locationLongIn
            employee { id fullName }
            workLocationIn { name }
          }
        }
      }`,
      { params: { dateFrom: date, dateTo: date }, pageNumber: 1, pageSize: 5 }
    )
    const clocks = await clocksRes.json()

    // Test leave
    const leaveRes = await gqlFetch(token,
      `query TestLeave {
        employees {
          id fullName
          leave {
            ... on EmployeeLeave {
              id date from to hours leaveTypeName
            }
          }
        }
      }`,
      {}
    )
    const leave = await leaveRes.json()

    return NextResponse.json({
      clockings: {
        ok: !clocks.errors?.length,
        errors: clocks.errors ?? null,
        totalCount: clocks.data?.pagedTimeLogs?.totalCount ?? null,
        uniqueEmployees: [...new Set((clocks.data?.pagedTimeLogs?.timeLogs ?? []).map((l: { employee?: { id: string } }) => l.employee?.id).filter(Boolean))].length,
        sample: clocks.data?.pagedTimeLogs?.timeLogs?.slice(0, 5).map((l: { from: string; employee?: { fullName: string }; workLocationIn?: { name: string } }) => ({
          name: l.employee?.fullName,
          location: l.workLocationIn?.name,
          from: l.from,
        })) ?? [],
      },
      leave: {
        ok: !leave.errors?.length,
        errors: leave.errors ?? null,
        totalEmployees: leave.data?.employees?.length ?? null,
        employeesWithLeave: leave.data?.employees?.filter((e: { leave?: unknown[] }) => (e.leave?.length ?? 0) > 0).length ?? null,
      },
      tokenExpiry: (() => { try { return JSON.parse(atob(token.split('.')[1])).expiryDate } catch { return null } })(),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Test failed' }, { status: 500 })
  }
}
