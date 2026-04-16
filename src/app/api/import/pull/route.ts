import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const DOMAIN = 'roosterpartners.talexiohr.com'
const GQL_URL = 'https://api.talexiohr.com/graphql'

const OFFICE_LAT = 35.9222072, OFFICE_LNG = 14.4878368, OFFICE_KM = 0.12

function gpsKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function isOfficeGps(lat: number | null, lng: number | null) {
  return lat != null && lng != null && !isNaN(lat) && !isNaN(lng) ? gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM : false
}
function isOfficeName(n: string | null) {
  if (!n) return false; const l = n.toLowerCase()
  return l.includes('head office') || l === 'office' || l.includes('ta office')
}

// ── Types ────────────────────────────────────────────────────────────────────
interface TimeLog {
  id: string; from: string | null; to: string | null
  locationLatIn: number | null; locationLongIn: number | null
  locationLatOut: number | null; locationLongOut: number | null
  label: string | null
  employee: { id: string; fullName: string; firstName: string; lastName: string }
  workLocationIn: { name: string; lat: number | null; long: number | null } | null
  workLocationOut: { name: string } | null
  workCode: { name: string } | null
}

interface LeaveEntry {
  employeeId: string; employeeName: string; date: string; type: 'vacation' | 'sick'
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function gqlFetch(token: string, query: string, variables: Record<string, unknown>) {
  return fetch(GQL_URL, {
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

// ── Fetch time logs (direct GraphQL) ─────────────────────────────────────────
async function fetchTimeLogs(token: string, dateFrom: string, dateTo: string): Promise<{ logs: TimeLog[]; error?: string }> {
  const PAGE_SIZE = 100
  let page = 1
  const all: TimeLog[] = []

  while (true) {
    const res = await gqlFetch(token,
      `query PullTimeLogs($params: TimeLogsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
        pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize, withTotal: true) {
          totalCount
          timeLogs {
            id from to
            locationLatIn locationLongIn locationLatOut locationLongOut
            label
            employee { id fullName firstName lastName }
            workLocationIn { name long lat }
            workLocationOut { name }
            workCode { name }
          }
        }
      }`,
      { params: { dateFrom, dateTo, employeeIds: [] }, pageNumber: page, pageSize: PAGE_SIZE }
    )
    const json = await res.json()
    if (json.errors?.length) return { logs: [], error: json.errors.map((e: { message: string }) => e.message).join(', ') }
    if (!json.data?.pagedTimeLogs) return { logs: [], error: 'No data returned' }

    const batch = json.data.pagedTimeLogs.timeLogs ?? []
    all.push(...batch)
    if (all.length >= (json.data.pagedTimeLogs.totalCount ?? 0) || batch.length === 0) break
    page++
  }
  return { logs: all }
}

// ── Fetch leave (try employees query with leave field) ───────────────────────
async function fetchLeave(token: string, dateFrom: string, dateTo: string): Promise<{ entries: LeaveEntry[]; error?: string }> {
  // Try querying employees with their leave in the date range
  const res = await gqlFetch(token,
    `query PullLeave($params: EmployeesParams) {
      employees(params: $params) {
        id fullName
        leave {
          ... on EmployeeLeave {
            id
            date
            from
            to
            leaveTypeName
            hours
          }
        }
      }
    }`,
    { params: {} }
  )
  const json = await res.json()

  if (json.errors?.length) {
    // Leave query might not work — not a fatal error
    return { entries: [], error: json.errors.map((e: { message: string }) => e.message).join(', ') }
  }

  const entries: LeaveEntry[] = []
  const employees = json.data?.employees ?? []
  for (const emp of employees) {
    for (const leave of emp.leave ?? []) {
      // Use 'date' field (single day) or 'from'/'to' for range
      const leaveDate = leave.date ?? (leave.from ? leave.from.slice(0, 10) : null)
      const leaveTo = leave.to ? leave.to.slice(0, 10) : leaveDate
      if (!leaveDate) continue
      // Only include leave days within our date range
      const start = leaveDate > dateFrom ? leaveDate : dateFrom
      const end = (leaveTo ?? leaveDate) < dateTo ? (leaveTo ?? leaveDate) : dateTo
      // Generate a record per day
      const d = new Date(start + 'T00:00:00')
      const endD = new Date(end + 'T00:00:00')
      while (d <= endD) {
        const day = d.getDay()
        if (day >= 1 && day <= 5) { // weekdays only
          const typeName = (leave.leaveTypeName ?? '').toLowerCase()
          entries.push({
            employeeId: emp.id,
            employeeName: emp.fullName,
            date: d.toISOString().slice(0, 10),
            type: typeName.includes('sick') ? 'sick' : 'vacation',
          })
        }
        d.setDate(d.getDate() + 1)
      }
    }
  }
  return { entries }
}

// ── Save clockings to DB ─────────────────────────────────────────────────────
async function saveClockings(logs: TimeLog[], dateFrom: string) {
  const supabase = createAdminClient()

  type Agg = { empId: string; firstName: string; lastName: string; date: string; logs: TimeLog[] }
  const grouped = new Map<string, Agg>()
  for (const log of logs) {
    if (!log.employee) continue
    const date = log.from ? log.from.slice(0, 10) : dateFrom
    const key = `${log.employee.id}::${date}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        empId: log.employee.id,
        firstName: log.employee.firstName || log.employee.fullName.split(' ').slice(0, -1).join(' '),
        lastName: log.employee.lastName || log.employee.fullName.split(' ').slice(-1)[0],
        date, logs: [],
      })
    }
    grouped.get(key)!.logs.push(log)
  }

  let saved = 0
  const empSet = new Set<string>()

  for (const [, agg] of grouped) {
    const { data: empRow } = await supabase.from('employees')
      .upsert({ talexio_id: agg.empId, first_name: agg.firstName, last_name: agg.lastName }, { onConflict: 'talexio_id' })
      .select('id, group_type').single()
    if (!empRow) continue
    empSet.add(empRow.id)

    const sessions = agg.logs
    const first = sessions[0]
    const locIn = first.workLocationIn?.name ?? first.workCode?.name ?? null
    const locOut = first.workLocationOut?.name ?? null
    const latIn = first.locationLatIn ?? first.workLocationIn?.lat ?? null
    const lngIn = first.locationLongIn ?? first.workLocationIn?.long ?? null
    const latOut = first.locationLatOut ?? null
    const lngOut = first.locationLongOut ?? null

    const hasOffice = sessions.some(s => isOfficeName(s.workLocationIn?.name ?? s.workCode?.name ?? null) || isOfficeGps(s.locationLatIn ?? s.workLocationIn?.lat ?? null, s.locationLongIn ?? s.workLocationIn?.long ?? null))
    const hasActive = sessions.some(s => (s.label ?? '').toLowerCase().includes('active'))
    const allBroken = sessions.every(s => (s.label ?? '').toLowerCase().includes('broken') || (s.label ?? '').toLowerCase().includes('active'))
    const isMaltaEmployee = empRow.group_type === 'office_malta'

    let status = isMaltaEmployee ? 'wfh' : 'remote' // Malta not at office = WFH
    if (hasOffice) status = 'office'
    else if (hasActive) status = 'active'
    else if (allBroken) status = 'broken'

    // Broken/active: null out hours and times for accurate averages
    const isBrokenDay = status === 'broken' || status === 'active'

    const ins = sessions.filter(s => s.from).map(s => new Date(s.from!).getTime())
    const outs = sessions.filter(s => s.to).map(s => new Date(s.to!).getTime())
    const timeIn = isBrokenDay ? null : (ins.length ? new Date(Math.min(...ins)).toISOString().slice(11, 19) : null)
    const timeOut = isBrokenDay ? null : (outs.length ? new Date(Math.max(...outs)).toISOString().slice(11, 19) : null)
    let hours: number | null = null
    if (!isBrokenDay && ins.length && outs.length) hours = Math.round(((Math.max(...outs) - Math.min(...ins)) / 3_600_000) * 100) / 100

    await supabase.from('attendance_records').upsert({
      employee_id: empRow.id, date: agg.date,
      location_in: locIn, lat_in: latIn, lng_in: lngIn, time_in: timeIn,
      location_out: locOut, lat_out: latOut, lng_out: lngOut, time_out: timeOut,
      hours_worked: hours, status, comments: first.label,
      raw_data: sessions, updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,date' })
    saved++
  }

  return { saved, employees: empSet.size }
}

// ── Save leave to DB ─────────────────────────────────────────────────────────
async function saveLeave(entries: LeaveEntry[]) {
  const supabase = createAdminClient()
  let saved = 0, updated = 0

  for (const entry of entries) {
    // Find employee by talexio_id
    const { data: empRow } = await supabase.from('employees').select('id').eq('talexio_id', entry.employeeId).maybeSingle()
    if (!empRow) continue

    const { data: existing } = await supabase.from('attendance_records')
      .select('id, status').eq('employee_id', empRow.id).eq('date', entry.date).maybeSingle()

    if (existing) {
      // Override if no_clocking/unknown, otherwise just add comment
      const shouldOverride = ['no_clocking', 'unknown'].includes(existing.status)
      await supabase.from('attendance_records').update({
        status: shouldOverride ? entry.type : existing.status,
        comments: `${entry.type === 'sick' ? 'Sick leave' : 'Vacation'} (approved)`,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id)
      updated++
    } else {
      await supabase.from('attendance_records').insert({
        employee_id: empRow.id, date: entry.date, status: entry.type,
        comments: `${entry.type === 'sick' ? 'Sick leave' : 'Vacation'} (approved)`,
        updated_at: new Date().toISOString(),
      })
      saved++
    }
  }
  return { saved, updated }
}

// ── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { dateFrom, dateTo, token } = await req.json()
    if (!dateFrom || !dateTo) return NextResponse.json({ error: 'dateFrom and dateTo required' }, { status: 400 })
    if (!token) return NextResponse.json({ error: 'Bearer token is required' }, { status: 400 })

    const supabase = createAdminClient()
    const results: Record<string, unknown> = { dateRange: { from: dateFrom, to: dateTo } }

    // ── 1. Fetch clockings (direct GraphQL query) ─────────────────────────
    const direct = await fetchTimeLogs(token, dateFrom, dateTo)

    if (direct.logs.length > 0) {
      const clockResult = await saveClockings(direct.logs, dateFrom)
      results.clockings = { method: 'direct', fetched: direct.logs.length, saved: clockResult.saved, employees: clockResult.employees }
    } else {
      results.clockings = {
        method: 'direct', fetched: 0, saved: 0,
        error: direct.error || 'pagedTimeLogs returned no data — the API may require payroll context. Use CSV upload instead.',
      }
    }

    // ── 2. Fetch leave ──────────────────────────────────────────────────────
    const leaveResult = await fetchLeave(token, dateFrom, dateTo)

    if (leaveResult.entries.length > 0) {
      const leaveSave = await saveLeave(leaveResult.entries)
      results.leave = { method: 'direct', fetched: leaveResult.entries.length, saved: leaveSave.saved, updated: leaveSave.updated }
    } else {
      results.leave = { method: 'direct', fetched: 0, error: leaveResult.error || 'No approved leave in this period' }
    }

    // ── Sync log ────────────────────────────────────────────────────────────
    const totalSaved = ((results.clockings as Record<string, unknown>)?.saved as number ?? 0) + ((results.leave as Record<string, unknown>)?.saved as number ?? 0)
    await supabase.from('sync_log').insert({ sync_date: dateFrom, source: 'talexio', records: totalSaved, status: 'success' })

    return NextResponse.json({ ok: true, ...results })
  } catch (err) {
    console.error('[import/pull]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Pull failed' }, { status: 500 })
  }
}
