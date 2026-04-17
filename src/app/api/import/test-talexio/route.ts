import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
const DOMAIN = 'roosterpartners.talexiohr.com'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().slice(0, 10)

  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 })

  try {
    // Test 1: pagedWorkShifts
    const shiftsRes = await fetch('https://api.talexiohr.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${token}`,
        'client-domain': DOMAIN,
        'apollographql-client-name': 'talexio-hr-frontend',
        'apollographql-client-version': '1.0',
      },
      body: JSON.stringify({
        operationName: 'TestWorkShifts',
        query: `query TestWorkShifts($params: WorkShiftsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
          pagedWorkShifts(params: $params, pageNumber: $pageNumber, pageSize: $pageSize) {
            totalCount
            workShifts { id date from to employee { id fullName } workLocation { name } timeLogs { id from to workLocationIn { name } } }
          }
        }`,
        variables: { params: { dateFrom: date, dateTo: date, employeeIds: [] }, pageNumber: 1, pageSize: 3 },
      }),
      cache: 'no-store',
    })
    const shiftsJson = await shiftsRes.json()

    // Test 2: leaveSchedule
    const leaveRes = await fetch('https://api.talexiohr.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${token}`,
        'client-domain': DOMAIN,
        'apollographql-client-name': 'talexio-hr-frontend',
        'apollographql-client-version': '1.0',
      },
      body: JSON.stringify({
        operationName: 'TestLeave',
        query: `query TestLeave {
          employees {
            id fullName
            leave {
              ... on EmployeeLeave {
                id date from to hours leaveTypeName
              }
            }
          }
        }`,
        variables: {},
      }),
      cache: 'no-store',
    })
    const leaveJson = await leaveRes.json()

    return NextResponse.json({
      workShifts: {
        ok: !shiftsJson.errors?.length,
        errors: shiftsJson.errors || null,
        totalCount: shiftsJson.data?.pagedWorkShifts?.totalCount ?? null,
        sample: shiftsJson.data?.pagedWorkShifts?.workShifts?.slice(0, 2) ?? [],
      },
      leave: {
        ok: !leaveJson.errors?.length,
        errors: leaveJson.errors || null,
        totalEmployees: leaveJson.data?.employees?.length ?? null,
        employeesWithLeave: leaveJson.data?.employees?.filter((e: { leave?: unknown[] }) => (e.leave?.length ?? 0) > 0).length ?? null,
        sample: leaveJson.data?.employees?.filter((e: { leave?: unknown[] }) => (e.leave?.length ?? 0) > 0).slice(0, 2) ?? [],
      },
      tokenExpiry: (() => { try { return JSON.parse(atob(token.split('.')[1])).expiryDate } catch { return null } })(),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Test failed' }, { status: 500 })
  }
}
