import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const DOMAIN = 'roosterpartners.talexiohr.com'
const GQL_URL = 'https://api.talexiohr.com/graphql'

/**
 * Talexio's `from`/`to` ISO strings are REAL UTC timestamps.
 * Each employee's Talexio UI displays their LOCAL time based on their
 * configured location (Malta for office, Minsk for Polina, etc.).
 * We convert UTC to the employee's configured timezone so dashboard
 * data matches Talexio's CSV exports.
 */
function wallClock(iso: string, tz: string = 'Europe/Malta'): { date: string; time: string } {
  const utc = new Date(iso)
  const date = utc.toLocaleDateString('en-CA', { timeZone: tz })
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(utc)
  const h = parts.find(p => p.type === 'hour')?.value ?? '00'
  const m = parts.find(p => p.type === 'minute')?.value ?? '00'
  const s = parts.find(p => p.type === 'second')?.value ?? '00'
  return { date, time: `${h}:${m}:${s}` }
}


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

/** JWT tokens (3 dot-separated base64 parts) go as `Authorization: Bearer`;
 *  legacy string tokens go as `talexio-api-token`. */
function looksLikeJwt(t: string): boolean {
  return t.split('.').length === 3
}

/**
 * Talexio GraphQL call. Uses the explicit `token` arg if given, else falls
 * back to the NEXT_PUBLIC_TALEXIOHR_TOKEN env var. Auto-detects JWT vs
 * legacy token format and sets the correct auth header.
 */
function gqlFetch(token: string | null, query: string, variables: Record<string, unknown>) {
  const actualToken = token ?? process.env.NEXT_PUBLIC_TALEXIOHR_TOKEN
  if (!actualToken) throw new Error('No token provided and NEXT_PUBLIC_TALEXIOHR_TOKEN is not set')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'client-domain': DOMAIN,
    'apollographql-client-name': 'talexio-hr-frontend',
    'apollographql-client-version': '1.0',
  }
  if (looksLikeJwt(actualToken)) {
    headers['authorization'] = `Bearer ${actualToken}`
  } else {
    headers['talexio-api-token'] = actualToken
  }
  return fetch(GQL_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    cache: 'no-store' as const,
  })
}

interface TimeLog {
  id: string
  from: string | null
  to: string | null
  locationLatIn: number | null
  locationLongIn: number | null
  locationLatOut: number | null
  locationLongOut: number | null
  label: string | null
  employee: { id: string; fullName: string; firstName: string; lastName: string }
  workLocationIn: { id: string; name: string; long: number | null; lat: number | null } | null
  workLocationOut: { id: string; name: string; long: number | null; lat: number | null } | null
}

// ── Fetch Time Logs (clockings) ──────────────────────────────────────────────
async function fetchTimeLogs(token: string | null, dateFrom: string, dateTo: string): Promise<{ logs: TimeLog[]; error?: string; debug?: unknown }> {
  const PAGE_SIZE = 100
  let page = 0 // Talexio uses 0-indexed pagination (NOT 1-indexed)
  const all: TimeLog[] = []

  while (true) {
    const res = await gqlFetch(token,
      `query PullTimeLogs($params: TimeLogsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
        pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize) {
          totalCount
          timeLogs {
            id from to
            locationLatIn locationLongIn locationLatOut locationLongOut
            label
            employee { id fullName firstName lastName }
            workLocationIn { id name long lat }
            workLocationOut { id name long lat }
          }
        }
      }`,
      { params: { dateFrom, dateTo }, pageNumber: page, pageSize: PAGE_SIZE }
    )
    const json = await res.json()
    if (json.errors?.length) return { logs: [], error: json.errors.map((e: { message: string }) => e.message).join(', '), debug: { status: res.status, json } }
    if (!json.data) return { logs: [], error: `No data field in response (status ${res.status})`, debug: json }
    if (!json.data.pagedTimeLogs) return { logs: [], error: 'pagedTimeLogs is null', debug: json }

    const batch = json.data.pagedTimeLogs.timeLogs ?? []
    all.push(...batch)
    if (all.length >= (json.data.pagedTimeLogs.totalCount ?? 0) || batch.length === 0) break
    page++
  }
  return { logs: all }
}

// ── Fetch Leave ──────────────────────────────────────────────────────────────
interface LeaveEntry {
  id: string
  date?: string
  from?: string
  to?: string
  hours: number
  leaveTypeName: string
}

async function fetchLeave(token: string | null): Promise<{ employees: { id: string; fullName: string; firstName?: string; lastName?: string; leave: LeaveEntry[] }[]; error?: string; debug?: unknown }> {
  const res = await gqlFetch(token,
    `query PullLeave {
      employees {
        id fullName firstName lastName
        leave {
          ... on EmployeeLeave {
            id date from to hours leaveTypeName
          }
        }
      }
    }`,
    {}
  )
  const json = await res.json()
  if (json.errors?.length) return { employees: [], error: json.errors.map((e: { message: string }) => e.message).join(', '), debug: json }
  if (!json.data) return { employees: [], error: `No data field (status ${res.status})`, debug: json }
  return { employees: json.data?.employees ?? [] }
}

// ── Save Clockings ───────────────────────────────────────────────────────────
async function saveClockings(logs: TimeLog[]) {
  const supabase = createAdminClient()

  // Preload employees. Try WITH timezone first (new schema); fall back if
  // the migration hasn't been run yet.
  let allEmps: { id: string; first_name: string; last_name: string; full_name: string; talexio_id: string | null; group_type: string | null; timezone?: string | null }[] | null = null
  const withTz = await supabase.from('employees').select('id, first_name, last_name, full_name, talexio_id, group_type, timezone')
  if (withTz.error) {
    // Column doesn't exist yet — fall back to default Malta for everyone
    const fallback = await supabase.from('employees').select('id, first_name, last_name, full_name, talexio_id, group_type')
    allEmps = fallback.data
  } else {
    allEmps = withTz.data
  }
  const normalize = (s: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const tzByTalexioId = new Map<string, string>()
  const tzByName = new Map<string, string>()
  for (const e of allEmps ?? []) {
    const tz = e.timezone ?? 'Europe/Malta'
    if (e.talexio_id) tzByTalexioId.set(e.talexio_id, tz)
    const nkey = normalize(e.full_name ?? `${e.first_name} ${e.last_name}`)
    if (nkey) tzByName.set(nkey, tz)
  }

  function tzForLog(log: TimeLog): string {
    const byId = log.employee ? tzByTalexioId.get(log.employee.id) : null
    if (byId) return byId
    const byName = log.employee ? tzByName.get(normalize(log.employee.fullName)) : null
    return byName ?? 'Europe/Malta'
  }

  // Group by employee+date (multiple sessions per day), using each employee's timezone
  type Agg = { empId: string; firstName: string; lastName: string; date: string; tz: string; logs: TimeLog[] }
  const grouped = new Map<string, Agg>()

  for (const log of logs) {
    if (!log.employee || !log.from) continue
    const tz = tzForLog(log)
    const date = wallClock(log.from, tz).date
    const key = `${log.employee.id}::${date}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        empId: log.employee.id,
        firstName: log.employee.firstName || log.employee.fullName.split(' ').slice(0, -1).join(' '),
        lastName: log.employee.lastName || log.employee.fullName.split(' ').slice(-1)[0],
        date, tz, logs: [],
      })
    }
    grouped.get(key)!.logs.push(log)
  }

  let saved = 0
  const empSet = new Set<string>()

  // Reuse the employee list already loaded above for timezone lookup
  const byIdMap = new Map<string, { id: string; group_type: string | null; talexio_id: string | null }>()
  const byNameMap = new Map<string, { id: string; group_type: string | null; talexio_id: string | null }>()
  for (const e of allEmps ?? []) {
    if (e.talexio_id) byIdMap.set(e.talexio_id, { id: e.id, group_type: e.group_type, talexio_id: e.talexio_id })
    const key = normalize(e.full_name ?? `${e.first_name} ${e.last_name}`)
    if (key) byNameMap.set(key, { id: e.id, group_type: e.group_type, talexio_id: e.talexio_id })
  }

  for (const [, agg] of grouped) {
    let empRow: { id: string; group_type: string | null } | null = null

    // 1. Match by talexio_id
    const byId = byIdMap.get(agg.empId)
    if (byId) empRow = { id: byId.id, group_type: byId.group_type }

    // 2. Match by normalized full name
    if (!empRow) {
      const nameKey = normalize(`${agg.firstName} ${agg.lastName}`)
      const byName = byNameMap.get(nameKey)
      if (byName) {
        if (!byName.talexio_id) {
          await supabase.from('employees').update({ talexio_id: agg.empId }).eq('id', byName.id)
        }
        empRow = { id: byName.id, group_type: byName.group_type }
      }
    }

    // 3. Create new if no match
    if (!empRow) {
      const { data: newEmp } = await supabase.from('employees')
        .insert({ talexio_id: agg.empId, first_name: agg.firstName.trim(), last_name: agg.lastName.trim() })
        .select('id, group_type').single()
      empRow = newEmp
    }

    if (!empRow) continue
    empSet.add(empRow.id)

    const isMalta = empRow.group_type === 'office_malta'
    const sessions = agg.logs

    // Check if any session is at the office
    const atOffice = sessions.some(s =>
      isOfficeName(s.workLocationIn?.name ?? null) ||
      isOfficeGps(s.locationLatIn, s.locationLongIn) ||
      isOfficeGps(s.workLocationIn?.lat ?? null, s.workLocationIn?.long ?? null)
    )

    // Aggregate from/to across sessions (earliest in, latest out) — in Malta time
    const froms = sessions.filter(s => s.from).map(s => new Date(s.from!).getTime())
    const tos = sessions.filter(s => s.to).map(s => new Date(s.to!).getTime())
    const timeIn = froms.length ? wallClock(new Date(Math.min(...froms)).toISOString(), agg.tz).time : null
    const timeOut = tos.length ? wallClock(new Date(Math.max(...tos)).toISOString(), agg.tz).time : null

    // Hours = SUM of each session's duration (excludes breaks between sessions).
    // Previously: max(to) - min(from) which included lunch breaks in the total.
    let hours: number | null = null
    let hasPair = false
    let sumMs = 0
    for (const s of sessions) {
      if (s.from && s.to) {
        sumMs += new Date(s.to).getTime() - new Date(s.from).getTime()
        hasPair = true
      }
    }
    if (hasPair) hours = Math.round((sumMs / 3_600_000) * 100) / 100

    // Detect broken: has from but no to
    const hasBroken = froms.length > 0 && tos.length === 0

    // Status classification
    let status: string
    if (hasBroken) status = 'active' // no clock-out
    else if (atOffice) status = 'office'
    else if (sessions.length === 0) status = isMalta ? 'no_clocking' : 'unknown'
    else status = isMalta ? 'wfh' : 'remote'

    const first = sessions[0]
    const locIn = first.workLocationIn?.name ?? null
    const locOut = first.workLocationOut?.name ?? null
    const latIn = first.locationLatIn ?? first.workLocationIn?.lat ?? null
    const lngIn = first.locationLongIn ?? first.workLocationIn?.long ?? null
    const latOut = first.locationLatOut ?? first.workLocationOut?.lat ?? null
    const lngOut = first.locationLongOut ?? first.workLocationOut?.long ?? null

    await supabase.from('attendance_records').upsert({
      employee_id: empRow.id, date: agg.date,
      location_in: locIn, lat_in: latIn, lng_in: lngIn,
      time_in: timeIn,
      location_out: locOut, lat_out: latOut, lng_out: lngOut,
      time_out: hasBroken ? null : timeOut,
      hours_worked: hasBroken ? null : hours,
      status,
      comments: hasBroken ? 'No clock-out' : (first.label ?? null),
      raw_data: sessions,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,date' })
    saved++
  }

  return { saved, employees: empSet.size }
}

// ── Save Leave ───────────────────────────────────────────────────────────────
async function saveLeave(
  empList: { id: string; fullName: string; firstName?: string; lastName?: string; leave: LeaveEntry[] }[],
  dateFrom: string, dateTo: string,
) {
  const supabase = createAdminClient()
  let saved = 0, updated = 0

  // Build daily records from leave entries (clamp to date range)
  const daily: { empId: string; firstName: string; lastName: string; date: string; type: string }[] = []
  for (const emp of empList) {
    const firstName = emp.firstName || emp.fullName.split(' ').slice(0, -1).join(' ')
    const lastName = emp.lastName || emp.fullName.split(' ').slice(-1)[0]
    for (const leave of emp.leave ?? []) {
      const typeName = (leave.leaveTypeName ?? '').toLowerCase()
      const type = typeName.includes('sick') ? 'sick' : 'vacation'

      const startStr = leave.date ?? (leave.from ? leave.from.slice(0, 10) : null)
      const endStr = leave.to ? leave.to.slice(0, 10) : startStr
      if (!startStr) continue

      const clampedStart = startStr > dateFrom ? startStr : dateFrom
      const clampedEnd = (endStr ?? startStr) < dateTo ? (endStr ?? startStr) : dateTo

      const d = new Date(clampedStart + 'T00:00:00')
      const end = new Date(clampedEnd + 'T00:00:00')
      while (d <= end) {
        daily.push({
          empId: emp.id, firstName, lastName,
          date: d.toISOString().slice(0, 10), type,
        })
        d.setDate(d.getDate() + 1)
      }
    }
  }

  // Find/create employees — match by talexio_id first, then by normalized name
  const { data: all } = await supabase.from('employees').select('id, first_name, last_name, full_name, talexio_id')
  const normalize = (s: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const idMap = new Map<string, string>()
  const nameMap = new Map<string, { id: string; talexio_id: string | null }>()
  for (const e of all ?? []) {
    if (e.talexio_id) idMap.set(e.talexio_id, e.id)
    const key = normalize(e.full_name ?? `${e.first_name} ${e.last_name}`)
    if (key) nameMap.set(key, { id: e.id, talexio_id: e.talexio_id })
  }

  const dbEmpMap = new Map<string, string>()
  for (const entry of daily) {
    if (dbEmpMap.has(entry.empId)) continue

    const byId = idMap.get(entry.empId)
    if (byId) { dbEmpMap.set(entry.empId, byId); continue }

    const byName = nameMap.get(normalize(`${entry.firstName} ${entry.lastName}`))
    if (byName) {
      if (!byName.talexio_id) await supabase.from('employees').update({ talexio_id: entry.empId }).eq('id', byName.id)
      dbEmpMap.set(entry.empId, byName.id)
      continue
    }

    const { data: newEmp } = await supabase.from('employees').insert({ talexio_id: entry.empId, first_name: entry.firstName.trim(), last_name: entry.lastName.trim() }).select('id').single()
    if (newEmp) dbEmpMap.set(entry.empId, newEmp.id)
  }

  for (const entry of daily) {
    const empId = dbEmpMap.get(entry.empId)
    if (!empId) continue

    const { data: existing } = await supabase.from('attendance_records')
      .select('id, status').eq('employee_id', empId).eq('date', entry.date).maybeSingle()

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
    const { dateFrom, dateTo, token: rawToken } = await req.json()
    const token: string | null = rawToken?.trim() || null
    if (!dateFrom || !dateTo) return NextResponse.json({ error: 'dateFrom and dateTo required' }, { status: 400 })

    // Cap at 31 days to stay under Vercel's 300s function timeout.
    // Larger ranges should be pulled in chunks.
    const dayDiff = (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86_400_000
    if (dayDiff > 31) {
      return NextResponse.json({
        error: `Date range is ${Math.round(dayDiff)} days — max 31 days per pull. Split into monthly chunks.`,
      }, { status: 400 })
    }

    const supabase = createAdminClient()
    const results: Record<string, unknown> = { dateRange: { from: dateFrom, to: dateTo } }

    // 1. Fetch + save clockings
    const clocks = await fetchTimeLogs(token, dateFrom, dateTo)
    if (clocks.logs.length > 0) {
      const saveResult = await saveClockings(clocks.logs)
      results.clockings = { fetched: clocks.logs.length, ...saveResult }
    } else {
      results.clockings = { fetched: 0, saved: 0, error: clocks.error || 'No clockings in this period', debug: clocks.debug }
    }

    // 2. Fetch + save leave
    const leave = await fetchLeave(token)
    if (leave.employees.length > 0) {
      const saveResult = await saveLeave(leave.employees, dateFrom, dateTo)
      results.leave = { ...saveResult, totalEmployees: leave.employees.length }
    } else {
      results.leave = { saved: 0, updated: 0, error: leave.error || 'No leave data returned', debug: leave.debug }
    }

    // 3. Generate no_clocking records for Malta Office employees on workdays with no records
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

      // Fetch all existing records in range in ONE query, then diff
      const empIds = maltaEmps.map(e => e.id)
      const { data: existing } = await supabase.from('attendance_records')
        .select('employee_id, date').in('employee_id', empIds).gte('date', dateFrom).lte('date', dateTo)

      const existingSet = new Set((existing ?? []).map(r => `${r.employee_id}::${r.date}`))

      const toInsert: { employee_id: string; date: string; status: string; comments: string; updated_at: string }[] = []
      for (const emp of maltaEmps) {
        for (const wd of workdays) {
          if (!existingSet.has(`${emp.id}::${wd}`)) {
            toInsert.push({
              employee_id: emp.id, date: wd, status: 'no_clocking',
              comments: 'No clocking record for this working day', updated_at: new Date().toISOString(),
            })
          }
        }
      }

      // Batch insert in chunks of 500
      for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500)
        await supabase.from('attendance_records').insert(chunk)
        noClockingGenerated += chunk.length
      }
    }
    results.noClockingGenerated = noClockingGenerated

    const totalSaved = ((results.clockings as Record<string, unknown>)?.saved as number ?? 0) + ((results.leave as Record<string, unknown>)?.saved as number ?? 0)
    await supabase.from('sync_log').insert({ sync_date: dateFrom, source: 'talexio', records: totalSaved, status: 'success' })

    return NextResponse.json({ ok: true, ...results })
  } catch (err) {
    console.error('[import/pull]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Pull failed' }, { status: 500 })
  }
}
