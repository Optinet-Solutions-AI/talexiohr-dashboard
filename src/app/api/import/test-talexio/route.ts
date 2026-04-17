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
          pagedWorkShifts(params: $params, pageNumber: $pageNumber, pageSize: $pageSize, withTotal: true) {
            totalCount
            workShifts { id dateFrom dateTo totalHours employee { id fullName } workLocation { name } }
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
        operationName: 'TestLeaveSchedule',
        query: `query TestLeaveSchedule($dateFrom: Date!, $dateTo: Date!) {
          leaveSchedule(dateFrom: $dateFrom, dateTo: $dateTo) {
            id date from to hours leaveTypeName employee { id fullName }
          }
        }`,
        variables: { dateFrom: date, dateTo: date },
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
      leaveSchedule: {
        ok: !leaveJson.errors?.length,
        errors: leaveJson.errors || null,
        count: leaveJson.data?.leaveSchedule?.length ?? null,
        sample: leaveJson.data?.leaveSchedule?.slice(0, 2) ?? [],
      },
      tokenExpiry: (() => { try { return JSON.parse(atob(token.split('.')[1])).expiryDate } catch { return null } })(),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Test failed' }, { status: 500 })
  }
}
