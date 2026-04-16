import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { triggerExport, pollBackgroundJob, downloadExportFile } from '@/lib/talexio/session'
import { format } from 'date-fns'
import * as XLSX from 'xlsx'

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
  if (!n) return false
  const l = n.toLowerCase()
  return l.includes('head office') || l === 'office' || l.includes('ta office')
}

function parseTime(v: string | undefined) {
  if (!v || v === 'Broken Clocking' || v === 'Active Clocking') return null
  return /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim() + ':00' : null
}

function toMin(t: string | null) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Parse the CSV that Talexio exports (same format as the Clockings CSV)
// Columns: Employee Code, First Name, Last Name, Job Schedule, Unit, Business Unit,
//          Work Code, Location In, Lat In, Lng In, Location Out, Lat Out, Lng Out,
//          Date, Day, Time In, Time Out, Hours
function parseExportCsv(text: string) {
  const lines = text.split(/\r?\n/).slice(1)
  type Row = {
    code: string; firstName: string; lastName: string; unit: string; date: string
    locationIn: string | null; latIn: number | null; lngIn: number | null
    locationOut: string | null; latOut: number | null; lngOut: number | null
    timeIn: string | null; timeOut: string | null; hours: number
    isBroken: boolean; isActive: boolean
  }
  const rows: Row[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const c = line.split(',')
    const code = c[0]?.trim(), date = c[13]?.trim()
    if (!code || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    rows.push({
      code, firstName: c[1]?.trim() || '', lastName: c[2]?.trim() || '', unit: c[4]?.trim() || '',
      date,
      locationIn: c[7]?.trim() || null, latIn: parseFloat(c[8]) || null, lngIn: parseFloat(c[9]) || null,
      locationOut: c[10]?.trim() || null, latOut: parseFloat(c[11]) || null, lngOut: parseFloat(c[12]) || null,
      timeIn: parseTime(c[15]?.trim()), timeOut: parseTime(c[16]?.trim()), hours: parseFloat(c[17]) || 0,
      isBroken: c[16]?.trim() === 'Broken Clocking', isActive: c[16]?.trim() === 'Active Clocking',
    })
  }
  return rows
}

export async function POST(req: NextRequest) {
  try {
    const { dateFrom, dateTo, token } = await req.json()
    if (!dateFrom || !dateTo) return NextResponse.json({ error: 'dateFrom and dateTo required' }, { status: 400 })
    if (!token) return NextResponse.json({ error: 'Bearer token is required' }, { status: 400 })

    // 2. Trigger the export
    const jobId = await triggerExport(token, dateFrom, dateTo)

    // 3. Poll until complete
    const job = await pollBackgroundJob(token, jobId)

    if (!job.file?.fileUrl) {
      return NextResponse.json({ error: 'Export completed but no file was generated', jobStatus: job.jobStatus, jobResult: job.result }, { status: 500 })
    }

    // 4. Download the file (xlsx or csv)
    let fileBuffer: ArrayBuffer
    try {
      fileBuffer = await downloadExportFile(token, job.file.fileUrl)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Download failed', fileUrl: job.file.fileUrl, jobId }, { status: 500 })
    }

    // 5. Parse xlsx → JSON rows
    const wb = XLSX.read(fileBuffer, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)

    if (jsonRows.length === 0) {
      // Return debug info: sheet names, headers
      const csvPreview = XLSX.utils.sheet_to_csv(sheet).split('\n').slice(0, 5).join('\n')
      return NextResponse.json({ ok: true, fetched: 0, saved: 0, employees: 0, message: 'File has no data rows', debug: { sheetNames: wb.SheetNames, csvPreview } })
    }

    // Return column names from first row so we can see the format
    const columnNames = Object.keys(jsonRows[0])
    const sampleRows = jsonRows.slice(0, 3)

    // Map xlsx columns to our row format
    // Columns may vary — try common names from Talexio export
    const rows = jsonRows.map(r => {
      const get = (keys: string[]) => { for (const k of keys) { if (r[k] != null && r[k] !== '') return String(r[k]).trim() } return null }
      const getNum = (keys: string[]) => { const v = get(keys); return v ? parseFloat(v) || null : null }
      const code = get(['Employee Code', 'EmployeeCode', 'Code', 'Employee code'])
      const date = get(['Date', 'date'])
      if (!code || !date) return null

      const timeInRaw = get(['Time In', 'TimeIn', 'Time in', 'Clock In'])
      const timeOutRaw = get(['Time Out', 'TimeOut', 'Time out', 'Clock Out'])

      return {
        code,
        firstName: get(['First Name', 'FirstName', 'First name']) || '',
        lastName: get(['Last Name', 'LastName', 'Last name']) || '',
        unit: get(['Unit', 'Department', 'Business Unit']) || '',
        date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        locationIn: get(['Location In', 'LocationIn', 'Location in', 'Work Location In']) || null,
        latIn: getNum(['Lat In', 'LatIn', 'Latitude In']),
        lngIn: getNum(['Lng In', 'LngIn', 'Longitude In', 'Long In']),
        locationOut: get(['Location Out', 'LocationOut', 'Location out', 'Work Location Out']) || null,
        latOut: getNum(['Lat Out', 'LatOut', 'Latitude Out']),
        lngOut: getNum(['Lng Out', 'LngOut', 'Longitude Out', 'Long Out']),
        timeIn: timeInRaw && /^\d{1,2}:\d{2}/.test(timeInRaw) ? timeInRaw.slice(0, 5) + ':00' : null,
        timeOut: timeOutRaw && /^\d{1,2}:\d{2}/.test(timeOutRaw) ? timeOutRaw.slice(0, 5) + ':00' : null,
        hours: getNum(['Hours', 'Total Hours', 'hours', 'Duration']) || 0,
        isBroken: timeOutRaw === 'Broken Clocking',
        isActive: timeOutRaw === 'Active Clocking',
      }
    }).filter(Boolean) as NonNullable<ReturnType<typeof parseExportCsv>[number]>[]
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, fetched: 0, saved: 0, employees: 0, message: 'No valid rows parsed from export', debug: { columnNames, sampleRows: sampleRows.slice(0, 2) } })
    }

    const supabase = createAdminClient()

    // 6. Upsert employees
    const empMap = new Map<string, { firstName: string; lastName: string; unit: string }>()
    for (const r of rows) { if (!empMap.has(r.code)) empMap.set(r.code, { firstName: r.firstName, lastName: r.lastName, unit: r.unit }) }

    const dbEmpMap = new Map<string, string>()
    for (const [code, emp] of empMap) {
      const { data } = await supabase.from('employees').upsert(
        { talexio_id: code, first_name: emp.firstName, last_name: emp.lastName },
        { onConflict: 'talexio_id' }
      ).select('id').single()
      if (data) dbEmpMap.set(code, data.id)
    }

    // 7. Group by employee+date and aggregate
    const grouped = new Map<string, typeof rows>()
    for (const r of rows) {
      const key = `${r.code}::${r.date}`
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(r)
    }

    let saved = 0
    for (const [key, sessions] of grouped) {
      const [code, date] = key.split('::')
      const empId = dbEmpMap.get(code)
      if (!empId) continue

      const hasOffice = sessions.some(s => isOfficeName(s.locationIn) || isOfficeName(s.locationOut) || isOfficeGps(s.latIn, s.lngIn) || isOfficeGps(s.latOut, s.lngOut))
      const allBroken = sessions.every(s => s.isBroken || s.isActive)
      const hasActive = sessions.some(s => s.isActive)
      const hasBroken = sessions.some(s => s.isBroken)

      let status = 'remote'
      if (hasOffice) status = 'office'
      else if (hasActive) status = 'active'
      else if (allBroken) status = 'broken'

      const validIns = sessions.filter(s => s.timeIn).map(s => toMin(s.timeIn)).filter(Boolean) as number[]
      const validOuts = sessions.filter(s => s.timeOut).map(s => toMin(s.timeOut)).filter(Boolean) as number[]
      const earliest = validIns.length ? Math.min(...validIns) : null
      const latest = validOuts.length ? Math.max(...validOuts) : null
      const timeIn = earliest != null ? String(Math.floor(earliest / 60)).padStart(2, '0') + ':' + String(earliest % 60).padStart(2, '0') + ':00' : null
      const timeOut = latest != null ? String(Math.floor(latest / 60)).padStart(2, '0') + ':' + String(latest % 60).padStart(2, '0') + ':00' : null
      const hoursWorked = sessions.reduce((s, r) => s + (r.hours > 0 ? r.hours : 0), 0) || null

      const first = sessions[0]
      const officeSession = sessions.find(s => isOfficeName(s.locationIn) || isOfficeName(s.locationOut)) ?? first

      const comments = [
        hasBroken && !allBroken ? 'Has broken clocking(s)' : null,
        allBroken ? 'All clockings broken' : null,
        hasActive ? 'Active clocking' : null,
      ].filter(Boolean).join('; ') || null

      await supabase.from('attendance_records').upsert({
        employee_id: empId, date,
        location_in: officeSession.locationIn, lat_in: officeSession.latIn, lng_in: officeSession.lngIn, time_in: timeIn,
        location_out: officeSession.locationOut, lat_out: officeSession.latOut, lng_out: officeSession.lngOut, time_out: timeOut,
        hours_worked: hoursWorked ? Math.round(hoursWorked * 100) / 100 : null,
        status, comments, raw_data: sessions, updated_at: new Date().toISOString(),
      }, { onConflict: 'employee_id,date' })
      saved++
    }

    // Sync log
    await supabase.from('sync_log').insert({
      sync_date: dateFrom, source: 'talexio', records: saved, status: 'success',
    })

    return NextResponse.json({
      ok: true,
      fetched: rows.length,
      saved,
      employees: dbEmpMap.size,
      dateRange: { from: dateFrom, to: dateTo },
      debug: { columnNames, sampleRow: sampleRows[0] },
    })
  } catch (err) {
    console.error('[import/pull]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Pull failed' }, { status: 500 })
  }
}
