import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const DOMAIN = 'roosterpartners.talexiohr.com'
const GQL_URL = 'https://api.talexiohr.com/graphql'

const OFFICE_LAT = 35.9222072, OFFICE_LNG = 14.4878368, OFFICE_KM = 0.15

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

// ── Fetch Work Shifts ────────────────────────────────────────────────────────
async function fetchWorkShifts(token: string, dateFrom: string, dateTo: string) {
  const PAGE_SIZE = 100
  let page = 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = []

  while (true) {
    const res = await gqlFetch(token,
      `query PullWorkShifts($params: WorkShiftsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
        pagedWorkShifts(params: $params, pageNumber: $pageNumber, pageSize: $pageSize, withTotal: true) {
          totalCount
          workShifts {
            id
            dateFrom
            dateTo
            totalHours
            isPublished
            employee { id fullName firstName lastName }
            workLocation { id name long lat }
            timeLogs {
              id from to
              locationLatIn locationLongIn locationLatOut locationLongOut
              workLocationIn { id name long lat }
              workLocationOut { id name }
            }
          }
        }
      }`,
      { params: { dateFrom, dateTo, employeeIds: [] }, pageNumber: page, pageSize: PAGE_SIZE }
    )
    const json = await res.json()
    if (json.errors?.length) return { shifts: [], error: json.errors.map((e: { message: string }) => e.message).join(', ') }
    if (!json.data?.pagedWorkShifts) return { shifts: [], error: 'No data' }

    const batch = json.data.pagedWorkShifts.workShifts ?? []
    all.push(...batch)
    if (all.length >= (json.data.pagedWorkShifts.totalCount ?? 0) || batch.length === 0) break
    page++
  }
  return { shifts: all }
}

// ── Fetch Leave Schedule ─────────────────────────────────────────────────────
async function fetchLeaveSchedule(token: string, dateFrom: string, dateTo: string) {
  const res = await gqlFetch(token,
    `query PullLeaveSchedule($dateFrom: Date!, $dateTo: Date!) {
      leaveSchedule(dateFrom: $dateFrom, dateTo: $dateTo) {
        id
        date
        from
        to
        hours
        leaveTypeName
        employee { id fullName firstName lastName }
      }
    }`,
    { dateFrom, dateTo }
  )
  const json = await res.json()
  if (json.errors?.length) return { entries: [], error: json.errors.map((e: { message: string }) => e.message).join(', ') }
  return { entries: json.data?.leaveSchedule ?? [] }
}

// ── Save Work Shifts (as attendance records) ─────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function saveWorkShifts(shifts: any[], dateFrom: string) {
  const supabase = createAdminClient()

  // Group by employee+date
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const grouped = new Map<string, { empId: string; firstName: string; lastName: string; fullName: string; date: string; shifts: any[] }>()

  for (const s of shifts) {
    if (!s.employee) continue
    const date = s.dateFrom ? s.dateFrom.slice(0, 10) : dateFrom
    const key = `${s.employee.id}::${date}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        empId: s.employee.id,
        firstName: s.employee.firstName || s.employee.fullName.split(' ').slice(0, -1).join(' '),
        lastName: s.employee.lastName || s.employee.fullName.split(' ').slice(-1)[0],
        fullName: s.employee.fullName,
        date, shifts: [],
      })
    }
    grouped.get(key)!.shifts.push(s)
  }

  let saved = 0
  const empSet = new Set<string>()

  for (const [, agg] of grouped) {
    const { data: empRow } = await supabase.from('employees')
      .upsert({ talexio_id: agg.empId, first_name: agg.firstName, last_name: agg.lastName }, { onConflict: 'talexio_id' })
      .select('id, group_type').single()
    if (!empRow) continue
    empSet.add(empRow.id)

    const isMalta = empRow.group_type === 'office_malta'

    // Collect all time logs across all shifts for this day
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allLogs: any[] = agg.shifts.flatMap(s => s.timeLogs ?? [])

    // Check if any log is at the office
    const atOffice = allLogs.some(log =>
      isOfficeName(log.workLocationIn?.name) ||
      isOfficeGps(log.locationLatIn, log.locationLongIn) ||
      isOfficeGps(log.workLocationIn?.lat, log.workLocationIn?.long)
    )
    // Also check the shift's work location (planned)
    const shiftAtOffice = agg.shifts.some(s => isOfficeName(s.workLocation?.name))

    // Status classification
    let status: string
    if (atOffice || shiftAtOffice) status = 'office'
    else if (allLogs.length === 0) status = isMalta ? 'no_clocking' : 'unknown'
    else status = isMalta ? 'wfh' : 'remote'

    // Aggregate time in/out
    const ins = allLogs.filter(l => l.from).map(l => new Date(l.from).getTime())
    const outs = allLogs.filter(l => l.to).map(l => new Date(l.to).getTime())
    const timeIn = ins.length ? new Date(Math.min(...ins)).toISOString().slice(11, 19) : null
    const timeOut = outs.length ? new Date(Math.max(...outs)).toISOString().slice(11, 19) : null

    // Total hours from shift data (more reliable than computing from logs)
    let totalHours: number | null = agg.shifts.reduce((sum, s) => sum + (s.totalHours || 0), 0) || null
    if (totalHours != null) totalHours = Math.round(totalHours * 100) / 100

    // Detect broken: has time_in but no time_out
    const hasBroken = ins.length > 0 && outs.length === 0
    if (hasBroken) status = 'active' // unresolved clocking

    const firstLog = allLogs[0]
    const locIn = firstLog?.workLocationIn?.name ?? agg.shifts[0]?.workLocation?.name ?? null
    const locOut = firstLog?.workLocationOut?.name ?? null

    await supabase.from('attendance_records').upsert({
      employee_id: empRow.id, date: agg.date,
      location_in: locIn,
      lat_in: firstLog?.locationLatIn ?? firstLog?.workLocationIn?.lat ?? null,
      lng_in: firstLog?.locationLongIn ?? firstLog?.workLocationIn?.long ?? null,
      time_in: hasBroken ? timeIn : timeIn, // keep time_in for active clockings
      location_out: locOut,
      lat_out: firstLog?.locationLatOut ?? null,
      lng_out: firstLog?.locationLongOut ?? null,
      time_out: hasBroken ? null : timeOut,
      hours_worked: hasBroken ? null : totalHours,
      status,
      comments: hasBroken ? 'No clock-out' : null,
      raw_data: agg.shifts,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,date' })
    saved++
  }

  return { saved, employees: empSet.size }
}

// ── Save Leave Schedule ──────────────────────────────────────────────────────
interface LeaveEntry { employee: { id: string; fullName: string; firstName?: string; lastName?: string }; date?: string; from?: string; to?: string; leaveTypeName?: string }

async function saveLeaveSchedule(entries: LeaveEntry[], dateFrom: string, dateTo: string) {
  const supabase = createAdminClient()
  let saved = 0, updated = 0

  // Expand entries that have from/to ranges into daily records
  const daily: { empId: string; empName: string; firstName: string; lastName: string; date: string; type: string }[] = []
  for (const e of entries) {
    if (!e.employee) continue
    const typeName = (e.leaveTypeName ?? '').toLowerCase()
    const type = typeName.includes('sick') ? 'sick' : 'vacation'

    const startStr = e.date ?? (e.from ? e.from.slice(0, 10) : null)
    const endStr = e.to ? e.to.slice(0, 10) : startStr
    if (!startStr) continue

    const clampedStart = startStr > dateFrom ? startStr : dateFrom
    const clampedEnd = (endStr ?? startStr) < dateTo ? (endStr ?? startStr) : dateTo

    const d = new Date(clampedStart + 'T00:00:00')
    const end = new Date(clampedEnd + 'T00:00:00')
    while (d <= end) {
      const dow = d.getDay()
      if (dow >= 1 && dow <= 5) {
        daily.push({
          empId: e.employee.id,
          empName: e.employee.fullName,
          firstName: e.employee.firstName || e.employee.fullName.split(' ').slice(0, -1).join(' '),
          lastName: e.employee.lastName || e.employee.fullName.split(' ').slice(-1)[0],
          date: d.toISOString().slice(0, 10),
          type,
        })
      }
      d.setDate(d.getDate() + 1)
    }
  }

  // Upsert employees first
  const empMap = new Map<string, { firstName: string; lastName: string }>()
  for (const entry of daily) {
    if (!empMap.has(entry.empId)) empMap.set(entry.empId, { firstName: entry.firstName, lastName: entry.lastName })
  }
  const dbEmpMap = new Map<string, string>()
  for (const [code, emp] of empMap) {
    const { data } = await supabase.from('employees').upsert({ talexio_id: code, first_name: emp.firstName, last_name: emp.lastName }, { onConflict: 'talexio_id' }).select('id').single()
    if (data) dbEmpMap.set(code, data.id)
  }

  // Save leave records (update existing or insert new)
  for (const entry of daily) {
    const empId = dbEmpMap.get(entry.empId)
    if (!empId) continue

    const { data: existing } = await supabase.from('attendance_records').select('id, status').eq('employee_id', empId).eq('date', entry.date).maybeSingle()

    if (existing) {
      const shouldOverride = ['no_clocking', 'unknown'].includes(existing.status)
      await supabase.from('attendance_records').update({
        status: shouldOverride ? entry.type : existing.status,
        comments: `${entry.type === 'sick' ? 'Sick leave' : 'Vacation'} (approved)`,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id)
      updated++
    } else {
      await supabase.from('attendance_records').insert({
        employee_id: empId, date: entry.date, status: entry.type,
        comments: `${entry.type === 'sick' ? 'Sick leave' : 'Vacation'} (approved)`,
        updated_at: new Date().toISOString(),
      })
      saved++
    }
  }
  return { saved, updated, expanded: daily.length }
}

// ── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { dateFrom, dateTo, token } = await req.json()
    if (!dateFrom || !dateTo) return NextResponse.json({ error: 'dateFrom and dateTo required' }, { status: 400 })
    if (!token) return NextResponse.json({ error: 'Bearer token is required' }, { status: 400 })

    const supabase = createAdminClient()
    const results: Record<string, unknown> = { dateRange: { from: dateFrom, to: dateTo } }

    // 1. Fetch work shifts
    const shiftsResult = await fetchWorkShifts(token, dateFrom, dateTo)
    if (shiftsResult.shifts.length > 0) {
      const saveResult = await saveWorkShifts(shiftsResult.shifts, dateFrom)
      results.workShifts = { fetched: shiftsResult.shifts.length, ...saveResult }
    } else {
      results.workShifts = { fetched: 0, saved: 0, error: shiftsResult.error || 'No work shifts in this period' }
    }

    // 2. Fetch leave schedule
    const leaveResult = await fetchLeaveSchedule(token, dateFrom, dateTo)
    if (leaveResult.entries.length > 0) {
      const saveResult = await saveLeaveSchedule(leaveResult.entries, dateFrom, dateTo)
      results.leave = { fetched: leaveResult.entries.length, ...saveResult }
    } else {
      results.leave = { fetched: 0, saved: 0, error: leaveResult.error || 'No leave in this period' }
    }

    // 3. Generate no_clocking records for Malta Office employees with no records on workdays
    const { data: maltaEmps } = await supabase.from('employees').select('id').eq('group_type', 'office_malta').eq('excluded', false)
    let noClockingGenerated = 0
    if (maltaEmps && maltaEmps.length > 0) {
      const workdays: string[] = []
      const d = new Date(dateFrom + 'T00:00:00')
      const end = new Date(dateTo + 'T00:00:00')
      while (d <= end) {
        const dow = d.getDay()
        if (dow >= 1 && dow <= 5) workdays.push(d.toISOString().slice(0, 10))
        d.setDate(d.getDate() + 1)
      }
      for (const emp of maltaEmps) {
        for (const wd of workdays) {
          const { data: existing } = await supabase.from('attendance_records').select('id').eq('employee_id', emp.id).eq('date', wd).maybeSingle()
          if (!existing) {
            await supabase.from('attendance_records').insert({
              employee_id: emp.id, date: wd, status: 'no_clocking',
              comments: 'No clocking record for this working day', updated_at: new Date().toISOString(),
            })
            noClockingGenerated++
          }
        }
      }
    }
    results.noClockingGenerated = noClockingGenerated

    // Sync log
    const totalSaved = ((results.workShifts as Record<string, unknown>)?.saved as number ?? 0) + ((results.leave as Record<string, unknown>)?.saved as number ?? 0)
    await supabase.from('sync_log').insert({ sync_date: dateFrom, source: 'talexio', records: totalSaved, status: 'success' })

    return NextResponse.json({ ok: true, ...results })
  } catch (err) {
    console.error('[import/pull]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Pull failed' }, { status: 500 })
  }
}
