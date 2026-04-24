import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const DOMAIN = 'roosterpartners.talexiohr.com'

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get('name')?.toLowerCase()
  const from = req.nextUrl.searchParams.get('from') || '2026-04-01'
  const to = req.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const apiToken = process.env.NEXT_PUBLIC_TALEXIOHR_TOKEN
  if (!apiToken) return NextResponse.json({ error: 'Token not set' }, { status: 500 })

  const supabase = createAdminClient()

  const { data: emps } = await supabase
    .from('employees')
    .select('id, full_name, talexio_id')
    .ilike('full_name', `%${name}%`)

  const empIds = emps?.map(e => e.id) ?? []
  const { data: records } = await supabase
    .from('attendance_records')
    .select('employee_id, date, status, time_in, time_out, hours_worked')
    .in('employee_id', empIds)
    .gte('date', from).lte('date', to)
    .order('date')

  // Paginate through ALL Talexio logs
  const isJwt = apiToken.split('.').length === 3
  const authHeaders: Record<string, string> = isJwt
    ? { 'authorization': `Bearer ${apiToken}` }
    : { 'talexio-api-token': apiToken }

  const allLogs: { from: string; to: string; employee?: { fullName: string; id: string } }[] = []
  // Try both page 0 and page 1 indexing — Talexio's convention is unclear.
  // Also log the raw response for the first page so we can see what's happening.
  let page = 1
  let firstRawResponse: unknown = null
  let total = 0
  let pagesFetched = 0
  while (true) {
    const res = await fetch('https://api.talexiohr.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders, 'client-domain': DOMAIN },
      body: JSON.stringify({
        query: `query Diag($params: TimeLogsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
          pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize) {
            totalCount
            timeLogs { id from to employee { id fullName } }
          }
        }`,
        variables: { params: { dateFrom: from, dateTo: to }, pageNumber: page, pageSize: 200 },
      }),
      cache: 'no-store',
    })
    const json = await res.json()
    if (!firstRawResponse) firstRawResponse = json
    if (json.errors?.length || json.error) {
      return NextResponse.json({ apiError: json.errors ?? json.error, partialResults: allLogs.length }, { status: 500 })
    }
    const batch = json.data?.pagedTimeLogs?.timeLogs ?? []
    total = json.data?.pagedTimeLogs?.totalCount ?? 0
    allLogs.push(...batch)
    pagesFetched++
    if (allLogs.length >= total || batch.length === 0 || pagesFetched > 20) break
    page++
  }

  // Unique employees
  const empNames = [...new Set(allLogs.map(l => l.employee?.fullName ?? 'UNKNOWN'))].sort()
  const matched = allLogs.filter(l => l.employee?.fullName?.toLowerCase().includes(name))

  return NextResponse.json({
    employee: {
      query: name,
      matches: emps?.map(e => ({ id: e.id, name: e.full_name, talexio_id: e.talexio_id })) ?? [],
    },
    dbRecords: {
      count: records?.length ?? 0,
      records: records?.map(r => ({
        date: r.date, status: r.status, timeIn: r.time_in?.slice(0, 5),
        timeOut: r.time_out?.slice(0, 5), hours: r.hours_worked,
      })) ?? [],
    },
    talexio: {
      totalInRange: total,
      logsFetched: allLogs.length,
      pagesFetched,
      uniqueEmployeeCount: empNames.length,
      employeeNames: empNames,
      matchingLogs: matched.length,
      logs: matched.map(l => ({
        employee: l.employee?.fullName,
        from: l.from, to: l.to,
      })),
      firstRawResponse,
    },
  })
}
