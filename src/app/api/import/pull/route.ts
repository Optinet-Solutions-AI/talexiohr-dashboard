import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { triggerExport, pollBackgroundJob, downloadExportFile } from '@/lib/talexio/session'
import * as XLSX from 'xlsx'

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
function toMin(t: string | null) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m }

// ── Direct GraphQL fetch ─────────────────────────────────────────────────────
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

async function fetchTimeLogsDirect(token: string, dateFrom: string, dateTo: string): Promise<{ logs: TimeLog[]; error?: string }> {
  const PAGE_SIZE = 100
  let page = 1
  const all: TimeLog[] = []

  while (true) {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${token}`,
        'client-domain': DOMAIN,
        'apollographql-client-name': 'talexio-hr-frontend',
        'apollographql-client-version': '1.0',
      },
      body: JSON.stringify({
        operationName: 'PullTimeLogs',
        query: `query PullTimeLogs($params: TimeLogsFilterParams!, $pageNumber: Int!, $pageSize: Int!) {
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
        variables: {
          params: { from: dateFrom, to: dateTo, selectedUnitIds: [], selectedRoomIds: [], selectedEmployeeIds: [] },
          pageNumber: page,
          pageSize: PAGE_SIZE,
        },
      }),
      cache: 'no-store',
    })

    const json = await res.json()
    if (json.errors?.length) return { logs: [], error: json.errors.map((e: { message: string }) => e.message).join(', ') }
    if (!json.data?.pagedTimeLogs) return { logs: [], error: 'No data returned' }

    const batch = json.data.pagedTimeLogs.timeLogs ?? []
    all.push(...batch)
    const total = json.data.pagedTimeLogs.totalCount ?? 0
    if (all.length >= total || batch.length === 0) break
    page++
  }
  return { logs: all }
}

// ── Save time logs to DB ─────────────────────────────────────────────────────
async function saveTimeLogs(logs: TimeLog[], dateFrom: string) {
  const supabase = createAdminClient()

  // Group by employee+date
  type Agg = { empTalexioId: string; firstName: string; lastName: string; date: string; logs: TimeLog[] }
  const grouped = new Map<string, Agg>()
  for (const log of logs) {
    if (!log.employee) continue
    const date = log.from ? log.from.slice(0, 10) : dateFrom
    const key = `${log.employee.id}::${date}`
    if (!grouped.has(key)) {
      grouped.set(key, {
        empTalexioId: log.employee.id,
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
      .upsert({ talexio_id: agg.empTalexioId, first_name: agg.firstName, last_name: agg.lastName }, { onConflict: 'talexio_id' })
      .select('id').single()
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

    const hasOffice = sessions.some(s => {
      const ln = s.workLocationIn?.name ?? s.workCode?.name ?? null
      const la = s.locationLatIn ?? s.workLocationIn?.lat ?? null
      const lo = s.locationLongIn ?? s.workLocationIn?.long ?? null
      return isOfficeName(ln) || isOfficeGps(la, lo)
    })
    const hasWfh = sessions.some(s => (s.workLocationIn?.name ?? '').toLowerCase().includes('wfh') || (s.workLocationIn?.name ?? '').toLowerCase().includes('work from home'))
    const hasActive = sessions.some(s => (s.label ?? '').toLowerCase().includes('active'))
    const allBroken = sessions.every(s => (s.label ?? '').toLowerCase().includes('broken') || (s.label ?? '').toLowerCase().includes('active'))

    let status = 'remote'
    if (hasOffice) status = 'office'
    else if (hasWfh) status = 'wfh'
    else if (hasActive) status = 'active'
    else if (allBroken) status = 'broken'

    const ins = sessions.filter(s => s.from).map(s => new Date(s.from!).getTime())
    const outs = sessions.filter(s => s.to).map(s => new Date(s.to!).getTime())
    const timeIn = ins.length ? new Date(Math.min(...ins)).toISOString().slice(11, 19) : null
    const timeOut = outs.length ? new Date(Math.max(...outs)).toISOString().slice(11, 19) : null
    let hours: number | null = null
    if (ins.length && outs.length) hours = Math.round(((Math.max(...outs) - Math.min(...ins)) / 3_600_000) * 100) / 100

    await supabase.from('attendance_records').upsert({
      employee_id: empRow.id, date: agg.date,
      location_in: locIn, lat_in: latIn, lng_in: lngIn, time_in: timeIn,
      location_out: locOut, lat_out: latOut, lng_out: lngOut, time_out: timeOut,
      hours_worked: hours, status, comments: first.label,
      raw_data: sessions, updated_at: new Date().toISOString(),
    }, { onConflict: 'employee_id,date' })
    saved++
  }

  await supabase.from('sync_log').insert({ sync_date: dateFrom, source: 'talexio', records: saved, status: 'success' })
  return { saved, employees: empSet.size }
}

// ── Xlsx fallback parse ──────────────────────────────────────────────────────
function parseXlsxRows(buffer: ArrayBuffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
  return { jsonRows, columnNames: jsonRows.length ? Object.keys(jsonRows[0]) : [], sheetNames: wb.SheetNames }
}

export async function POST(req: NextRequest) {
  try {
    const { dateFrom, dateTo, token } = await req.json()
    if (!dateFrom || !dateTo) return NextResponse.json({ error: 'dateFrom and dateTo required' }, { status: 400 })
    if (!token) return NextResponse.json({ error: 'Bearer token is required' }, { status: 400 })

    // ── Method 1: Direct GraphQL query (fast, no file download) ──
    const direct = await fetchTimeLogsDirect(token, dateFrom, dateTo)

    if (direct.logs.length > 0) {
      const result = await saveTimeLogs(direct.logs, dateFrom)
      return NextResponse.json({
        ok: true,
        method: 'direct',
        fetched: direct.logs.length,
        saved: result.saved,
        employees: result.employees,
        dateRange: { from: dateFrom, to: dateTo },
      })
    }

    // ── Method 2: Export fallback (if direct query returns nothing) ──
    const jobId = await triggerExport(token, dateFrom, dateTo)
    const job = await pollBackgroundJob(token, jobId)

    if (!job.file?.fileUrl) {
      return NextResponse.json({
        error: direct.error
          ? `Direct query failed (${direct.error}), export completed but no file generated`
          : 'No data from either method',
        directError: direct.error,
        jobStatus: job.jobStatus,
      }, { status: 500 })
    }

    let fileBuffer: ArrayBuffer
    try {
      fileBuffer = await downloadExportFile(token, job.file.fileUrl)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Download failed', fileUrl: job.file.fileUrl }, { status: 500 })
    }

    const { jsonRows, columnNames, sheetNames } = parseXlsxRows(fileBuffer)

    if (jsonRows.length === 0) {
      return NextResponse.json({ ok: true, fetched: 0, saved: 0, employees: 0, method: 'export', message: 'Export file has no data', debug: { sheetNames, directError: direct.error } })
    }

    // Map xlsx → rows → save (same logic as CSV import)
    const rows = jsonRows.map(r => {
      const get = (keys: string[]) => { for (const k of keys) { if (r[k] != null && r[k] !== '') return String(r[k]).trim() } return null }
      const getNum = (keys: string[]) => { const v = get(keys); return v ? parseFloat(v) || null : null }
      const code = get(['Employee Code', 'EmployeeCode', 'Code', 'Employee code'])
      const date = get(['Date', 'date'])
      if (!code || !date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null
      const timeInRaw = get(['Time In', 'TimeIn', 'Time in', 'Clock In'])
      const timeOutRaw = get(['Time Out', 'TimeOut', 'Time out', 'Clock Out'])
      return {
        code, firstName: get(['First Name', 'FirstName', 'First name']) || '',
        lastName: get(['Last Name', 'LastName', 'Last name']) || '',
        unit: get(['Unit', 'Department', 'Business Unit']) || '', date: date.slice(0, 10),
        locationIn: get(['Location In', 'LocationIn', 'Work Location In']) || null,
        latIn: getNum(['Lat In', 'LatIn', 'Latitude In']), lngIn: getNum(['Lng In', 'LngIn', 'Longitude In', 'Long In']),
        locationOut: get(['Location Out', 'LocationOut', 'Work Location Out']) || null,
        latOut: getNum(['Lat Out', 'LatOut', 'Latitude Out']), lngOut: getNum(['Lng Out', 'LngOut', 'Longitude Out', 'Long Out']),
        timeIn: timeInRaw && /^\d{1,2}:\d{2}/.test(timeInRaw) ? timeInRaw.slice(0, 5) + ':00' : null,
        timeOut: timeOutRaw && /^\d{1,2}:\d{2}/.test(timeOutRaw) ? timeOutRaw.slice(0, 5) + ':00' : null,
        hours: getNum(['Hours', 'Total Hours', 'Duration']) || 0,
        isBroken: timeOutRaw === 'Broken Clocking', isActive: timeOutRaw === 'Active Clocking',
      }
    }).filter(Boolean) as { code: string; firstName: string; lastName: string; unit: string; date: string; locationIn: string | null; latIn: number | null; lngIn: number | null; locationOut: string | null; latOut: number | null; lngOut: number | null; timeIn: string | null; timeOut: string | null; hours: number; isBroken: boolean; isActive: boolean }[]

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, fetched: 0, saved: 0, employees: 0, method: 'export', message: 'No valid rows parsed', debug: { columnNames, sampleRow: jsonRows[0] } })
    }

    // Upsert employees
    const supabase = createAdminClient()
    const empMap = new Map<string, { firstName: string; lastName: string }>()
    for (const r of rows) { if (!empMap.has(r.code)) empMap.set(r.code, { firstName: r.firstName, lastName: r.lastName }) }
    const dbEmpMap = new Map<string, string>()
    for (const [code, emp] of empMap) {
      const { data } = await supabase.from('employees').upsert({ talexio_id: code, first_name: emp.firstName, last_name: emp.lastName }, { onConflict: 'talexio_id' }).select('id').single()
      if (data) dbEmpMap.set(code, data.id)
    }

    // Group + aggregate + save
    const grouped = new Map<string, typeof rows>()
    for (const r of rows) { const k = `${r.code}::${r.date}`; if (!grouped.has(k)) grouped.set(k, []); grouped.get(k)!.push(r) }

    let saved = 0
    for (const [key, sessions] of grouped) {
      const [code, date] = key.split('::')
      const empId = dbEmpMap.get(code)
      if (!empId) continue
      const hasOffice = sessions.some(s => isOfficeName(s.locationIn) || isOfficeName(s.locationOut) || isOfficeGps(s.latIn, s.lngIn))
      const allBroken = sessions.every(s => s.isBroken || s.isActive)
      let status = 'remote'
      if (hasOffice) status = 'office'; else if (allBroken) status = 'broken'

      const validIns = sessions.filter(s => s.timeIn).map(s => toMin(s.timeIn)).filter(Boolean) as number[]
      const validOuts = sessions.filter(s => s.timeOut).map(s => toMin(s.timeOut)).filter(Boolean) as number[]
      const earliest = validIns.length ? Math.min(...validIns) : null
      const latest = validOuts.length ? Math.max(...validOuts) : null
      const timeIn = earliest != null ? String(Math.floor(earliest / 60)).padStart(2, '0') + ':' + String(earliest % 60).padStart(2, '0') + ':00' : null
      const timeOut = latest != null ? String(Math.floor(latest / 60)).padStart(2, '0') + ':' + String(latest % 60).padStart(2, '0') + ':00' : null
      const hoursWorked = sessions.reduce((s, r) => s + (r.hours > 0 ? r.hours : 0), 0) || null
      const first = sessions[0]

      await supabase.from('attendance_records').upsert({
        employee_id: empId, date, location_in: first.locationIn, lat_in: first.latIn, lng_in: first.lngIn, time_in: timeIn,
        location_out: first.locationOut, lat_out: first.latOut, lng_out: first.lngOut, time_out: timeOut,
        hours_worked: hoursWorked ? Math.round(hoursWorked * 100) / 100 : null, status, raw_data: sessions, updated_at: new Date().toISOString(),
      }, { onConflict: 'employee_id,date' })
      saved++
    }

    await supabase.from('sync_log').insert({ sync_date: dateFrom, source: 'talexio', records: saved, status: 'success' })

    return NextResponse.json({
      ok: true, method: 'export', fetched: rows.length, saved, employees: dbEmpMap.size,
      dateRange: { from: dateFrom, to: dateTo }, debug: { columnNames },
    })
  } catch (err) {
    console.error('[import/pull]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Pull failed' }, { status: 500 })
  }
}
