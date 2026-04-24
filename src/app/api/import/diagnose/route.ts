import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
const DOMAIN = 'roosterpartners.talexiohr.com'

/**
 * Diagnose data discrepancy for a single employee over a date range.
 * GET /api/import/diagnose?name=Polina&from=2026-04-01&to=2026-04-25
 */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.toLowerCase()
  const from = req.nextUrl.searchParams.get('from') || '2026-04-01'
  const to = req.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const apiToken = process.env.NEXT_PUBLIC_TALEXIOHR_TOKEN
  if (!apiToken) return NextResponse.json({ error: 'Token not set' }, { status: 500 })

  const supabase = createAdminClient()

  // 1. Find the employee in DB
  const { data: emps } = await supabase
    .from('employees')
    .select('id, full_name, talexio_id')
    .ilike('full_name', `%${name}%`)

  if (!emps || emps.length === 0) {
    return NextResponse.json({ error: `No employee in DB matching "${name}"` }, { status: 404 })
  }

  // 2. Get their DB attendance records
  const empIds = emps.map(e => e.id)
  const { data: records } = await supabase
    .from('attendance_records')
    .select('employee_id, date, status, time_in, time_out, hours_worked')
    .in('employee_id', empIds)
    .gte('date', from).lte('date', to)
    .order('date')

  // 3. Query Talexio for the same employee's clockings
  const isJwt = apiToken.split('.').length === 3
  const authHeaders: Record<string, string> = isJwt
    ? { 'authorization': `Bearer ${apiToken}` }
    : { 'talexio-api-token': apiToken }

  // Fetch all clockings for the date range, then filter by name
  const talexioRes = await fetch('https://api.talexiohr.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders, 'client-domain': DOMAIN },
    body: JSON.stringify({
      query: `query Diag($params: TimeLogsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
        pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize) {
          totalCount
          timeLogs { id from to employee { id fullName } }
        }
      }`,
      variables: { params: { dateFrom: from, dateTo: to }, pageNumber: 1, pageSize: 500 },
    }),
    cache: 'no-store',
  })
  const talexioJson = await talexioRes.json()
  const talexioLogs = (talexioJson.data?.pagedTimeLogs?.timeLogs ?? [])
    .filter((l: { employee?: { fullName: string } }) => l.employee?.fullName?.toLowerCase().includes(name))

  return NextResponse.json({
    employee: {
      query: name,
      matches: emps.map(e => ({ id: e.id, name: e.full_name, talexio_id: e.talexio_id })),
    },
    dbRecords: {
      count: records?.length ?? 0,
      records: records?.map(r => ({
        date: r.date, status: r.status, timeIn: r.time_in?.slice(0, 5),
        timeOut: r.time_out?.slice(0, 5), hours: r.hours_worked,
      })) ?? [],
    },
    talexioLogs: {
      count: talexioLogs.length,
      totalInRange: talexioJson.data?.pagedTimeLogs?.totalCount,
      logs: talexioLogs.map((l: { from: string; to: string; employee?: { fullName: string } }) => ({
        employee: l.employee?.fullName,
        from: l.from, to: l.to,
      })),
      errors: talexioJson.errors ?? null,
      authError: talexioJson.error ?? null,
    },
  })
}
