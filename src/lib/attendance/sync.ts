import { createClient } from '@/lib/supabase/server'
import { fetchTimeLogs } from '@/lib/talexio/attendance'
import { format, eachDayOfInterval, parseISO } from 'date-fns'

export type AttendanceStatus =
  | 'office'
  | 'wfh'
  | 'remote'
  | 'no_clocking'
  | 'vacation'
  | 'active'
  | 'broken'
  | 'unknown'

// Malta office GPS coordinates
const OFFICE_LAT = 35.9222072
const OFFICE_LNG = 14.4878368
const OFFICE_RADIUS_KM = 0.1

function gpsDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isAtOffice(lat: number | null, lng: number | null): boolean {
  if (!lat || !lng) return false
  return gpsDistance(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_RADIUS_KM
}

function classifyStatus(
  locationIn: string | null,
  latIn: number | null,
  lngIn: number | null,
  label: string | null,
): AttendanceStatus {
  const loc = (locationIn ?? '').toLowerCase()
  const lbl = (label ?? '').toLowerCase()

  // Exact / partial name matches from Talexio workLocationIn.name or workCode.name
  if (loc === 'no clocking' || loc.includes('no clocking')) {
    if (lbl.includes('vacation') || lbl.includes('annual leave')) return 'vacation'
    return 'no_clocking'
  }
  if (loc.includes('active clocking') || loc === 'active') return 'active'
  if (loc.includes('broken')) return 'broken'
  if (loc === 'wfh' || loc.includes('work from home') || loc.includes('wfh')) return 'wfh'
  if (loc.includes('not from the office') || loc.includes('remote') || loc.includes('other location')) return 'remote'
  if (loc.includes('office') || loc.includes('ta office')) return 'office'

  // Fallback: use GPS clocking coords
  if (latIn && lngIn) {
    return isAtOffice(latIn, lngIn) ? 'office' : 'remote'
  }

  return 'unknown'
}

function parseHoursString(s: string | null): number | null {
  if (!s) return null
  const m = s.match(/(\d+)\s*h\s*(\d+)\s*min/i)
  if (m) return parseInt(m[1]) + parseInt(m[2]) / 60
  const h = s.match(/^(\d+(\.\d+)?)$/)
  if (h) return parseFloat(h[1])
  return null
}

// ------------------------------------------------------------
// Sync a date range from Talexio → Supabase
// ------------------------------------------------------------
export async function syncDateRange(dateFrom: string, dateTo: string) {
  const supabase = await createClient()

  const timeLogs = await fetchTimeLogs(dateFrom, dateTo)

  if (timeLogs.length === 0) {
    return { synced: 0, message: 'No time logs returned from Talexio (check payroll ID)' }
  }

  let synced = 0

  for (const log of timeLogs) {
    const emp = log.employee
    if (!emp) continue

    // Split fullName into first/last for upsert (firstName/lastName also available from query)
    const firstName = emp.firstName || emp.fullName.split(' ').slice(0, -1).join(' ') || emp.fullName
    const lastName  = emp.lastName  || emp.fullName.split(' ').slice(-1)[0] || ''

    // Upsert employee
    const { data: empRow } = await supabase
      .from('employees')
      .upsert(
        { talexio_id: emp.id, first_name: firstName, last_name: lastName },
        { onConflict: 'talexio_id' },
      )
      .select('id')
      .single()

    if (!empRow) continue

    const date = log.from
      ? format(new Date(log.from), 'yyyy-MM-dd')
      : dateFrom

    // Location name comes from workLocationIn.name; fall back to workCode.name
    const locationIn  = log.workLocationIn?.name  ?? log.workCode?.name ?? null
    const locationOut = log.workLocationOut?.name ?? null

    // GPS from raw clocking coords; fall back to work location's fixed coords
    const latIn  = log.locationLatIn  ?? log.workLocationIn?.lat  ?? null
    const lngIn  = log.locationLongIn ?? log.workLocationIn?.long ?? null
    const latOut = log.locationLatOut ?? log.workLocationOut?.lat  ?? null
    const lngOut = log.locationLongOut ?? log.workLocationOut?.long ?? null

    const status = classifyStatus(locationIn, latIn, lngIn, log.label)

    const timeIn  = log.from ? format(new Date(log.from), 'HH:mm:ss') : null
    const timeOut = log.to   ? format(new Date(log.to),   'HH:mm:ss') : null

    // Compute hours from from/to datetimes
    let hoursWorked: number | null = null
    if (log.from && log.to) {
      hoursWorked = (new Date(log.to).getTime() - new Date(log.from).getTime()) / 3_600_000
    }

    await supabase.from('attendance_records').upsert(
      {
        employee_id:  empRow.id,
        date,
        location_in:  locationIn,
        lat_in:       latIn,
        lng_in:       lngIn,
        time_in:      timeIn,
        location_out: locationOut,
        lat_out:      latOut,
        lng_out:      lngOut,
        time_out:     timeOut,
        hours_worked: hoursWorked,
        status,
        comments:     log.label,
        raw_data:     log,
        updated_at:   new Date().toISOString(),
      },
      { onConflict: 'employee_id,date' },
    )

    synced++
  }

  // Log the sync
  await supabase.from('sync_log').insert({
    sync_date: dateFrom,
    source:    'talexio',
    records:   synced,
    status:    'success',
  })

  return { synced }
}

// ------------------------------------------------------------
// Parse CSV rows and save to Supabase
// ------------------------------------------------------------
export interface CsvRow {
  date: string            // YYYY-MM-DD
  firstName: string
  lastName: string
  locationIn: string | null
  latIn: number | null
  lngIn: number | null
  timeIn: string | null   // HH:mm
  locationOut: string | null
  latOut: number | null
  lngOut: number | null
  timeOut: string | null
  hours: string | null
  comments: string | null
}

export async function saveCsvRows(rows: CsvRow[]) {
  const supabase = await createClient()
  let saved = 0

  for (const row of rows) {
    if (!row.firstName || !row.lastName || !row.date) continue

    // Upsert employee (no talexio_id for CSV imports)
    const { data: empRow } = await supabase
      .from('employees')
      .upsert(
        { first_name: row.firstName, last_name: row.lastName },
        { onConflict: 'talexio_id', ignoreDuplicates: false },
      )
      .select('id')
      .single()

    // If upsert fails (talexio_id conflict), find by name
    const employeeId = empRow?.id ?? (await supabase
      .from('employees')
      .select('id')
      .eq('first_name', row.firstName)
      .eq('last_name', row.lastName)
      .single()
      .then(r => r.data?.id))

    if (!employeeId) continue

    const status = classifyStatus(row.locationIn, row.latIn, row.lngIn, row.comments)

    await supabase.from('attendance_records').upsert(
      {
        employee_id:  employeeId,
        date:         row.date,
        location_in:  row.locationIn,
        lat_in:       row.latIn,
        lng_in:       row.lngIn,
        time_in:      row.timeIn ? `${row.timeIn}:00` : null,
        location_out: row.locationOut,
        lat_out:      row.latOut,
        lng_out:      row.lngOut,
        time_out:     row.timeOut ? `${row.timeOut}:00` : null,
        hours_worked: parseHoursString(row.hours),
        status,
        comments:     row.comments,
        raw_data:     row,
        updated_at:   new Date().toISOString(),
      },
      { onConflict: 'employee_id,date' },
    )

    saved++
  }

  await supabase.from('sync_log').insert({
    sync_date: rows[0]?.date ?? format(new Date(), 'yyyy-MM-dd'),
    source:    'csv',
    records:   saved,
    status:    'success',
  })

  return { saved }
}
