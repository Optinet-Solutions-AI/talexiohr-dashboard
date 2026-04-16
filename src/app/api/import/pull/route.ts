import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { format } from 'date-fns'

const OFFICE_LAT = 35.9222072, OFFICE_LNG = 14.4878368, OFFICE_KM = 0.12

function gpsKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isOfficeGps(lat: number | null, lng: number | null) {
  return lat && lng ? gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM : false
}

function isOfficeName(n: string | null) {
  if (!n) return false
  const l = n.toLowerCase()
  return l.includes('head office') || l === 'office' || l.includes('ta office')
}

function classifyStatus(locIn: string | null, latIn: number | null, lngIn: number | null, label: string | null) {
  const loc = (locIn ?? '').toLowerCase()
  if (loc.includes('no clocking')) {
    const lbl = (label ?? '').toLowerCase()
    if (lbl.includes('vacation') || lbl.includes('annual leave')) return 'vacation'
    return 'no_clocking'
  }
  if (loc.includes('active')) return 'active'
  if (loc.includes('broken')) return 'broken'
  if (loc.includes('wfh') || loc.includes('work from home')) return 'wfh'
  if (loc.includes('not from the office') || loc.includes('remote') || loc.includes('other location')) return 'remote'
  if (isOfficeName(locIn)) return 'office'
  if (isOfficeGps(latIn, lngIn)) return 'office'
  return 'unknown'
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
  workCode: { id: string; name: string; code: string } | null
}

async function fetchAllTimeLogs(dateFrom: string, dateTo: string): Promise<TimeLog[]> {
  const API_URL = process.env.NEXT_PUBLIC_TALEXIOHR_API_URL!
  const API_TOKEN = process.env.NEXT_PUBLIC_TALEXIOHR_TOKEN!
  const API_DOMAIN = process.env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN!
  const PAGE_SIZE = 100
  let page = 1
  const all: TimeLog[] = []

  while (true) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'talexio-api-token': API_TOKEN,
        'client-domain': API_DOMAIN,
      },
      body: JSON.stringify({
        query: `
          query PullTimeLogs($params: TimeLogsFilterParams, $pageNumber: Int!, $pageSize: Int!) {
            pagedTimeLogs(params: $params, pageNumber: $pageNumber, pageSize: $pageSize, withTotal: true) {
              totalCount
              timeLogs {
                id from to
                locationLatIn locationLongIn locationLatOut locationLongOut
                label
                employee { id fullName firstName lastName }
                workLocationIn { id name long lat }
                workLocationOut { id name long lat }
                workCode { id name code }
              }
            }
          }
        `,
        variables: {
          params: { from: dateFrom, to: dateTo, selectedUnitIds: [], selectedRoomIds: [], selectedEmployeeIds: [] },
          pageNumber: page,
          pageSize: PAGE_SIZE,
        },
      }),
      cache: 'no-store',
    })

    const json = await res.json()

    if (json.error) throw new Error(`Talexio API: ${json.error}`)
    if (json.errors?.length) throw new Error(`Talexio: ${json.errors.map((e: { message: string }) => e.message).join(', ')}`)

    const batch = json.data?.pagedTimeLogs?.timeLogs ?? []
    all.push(...batch)
    const total = json.data?.pagedTimeLogs?.totalCount ?? 0
    if (all.length >= total || batch.length === 0) break
    page++
  }

  return all
}

export async function POST(req: NextRequest) {
  try {
    const { dateFrom, dateTo } = await req.json()
    if (!dateFrom || !dateTo) return NextResponse.json({ error: 'dateFrom and dateTo required' }, { status: 400 })

    // 1. Fetch from Talexio
    const logs = await fetchAllTimeLogs(dateFrom, dateTo)
    if (logs.length === 0) {
      return NextResponse.json({ ok: true, fetched: 0, saved: 0, employees: 0, message: 'No time logs returned from Talexio for this date range' })
    }

    const supabase = createAdminClient()

    // 2. Group by employee+date (multiple clock sessions per day)
    type AggKey = { empId: string; empName: string; firstName: string; lastName: string; date: string; logs: TimeLog[] }
    const grouped = new Map<string, AggKey>()

    for (const log of logs) {
      if (!log.employee) continue
      const date = log.from ? format(new Date(log.from), 'yyyy-MM-dd') : dateFrom
      const key = `${log.employee.id}::${date}`
      if (!grouped.has(key)) {
        grouped.set(key, {
          empId: log.employee.id,
          empName: log.employee.fullName,
          firstName: log.employee.firstName || log.employee.fullName.split(' ').slice(0, -1).join(' '),
          lastName: log.employee.lastName || log.employee.fullName.split(' ').slice(-1)[0],
          date,
          logs: [],
        })
      }
      grouped.get(key)!.logs.push(log)
    }

    // 3. Upsert employees and attendance records
    let saved = 0
    const empSet = new Set<string>()

    for (const [, agg] of grouped) {
      // Upsert employee
      const { data: empRow } = await supabase
        .from('employees')
        .upsert({ talexio_id: agg.empId, first_name: agg.firstName, last_name: agg.lastName }, { onConflict: 'talexio_id' })
        .select('id').single()
      if (!empRow) continue
      empSet.add(empRow.id)

      // Aggregate sessions for this day
      const sessions = agg.logs
      const firstLog = sessions[0]

      // Location: prefer workLocationIn, fall back to GPS
      const locIn = firstLog.workLocationIn?.name ?? firstLog.workCode?.name ?? null
      const locOut = firstLog.workLocationOut?.name ?? null
      const latIn = firstLog.locationLatIn ?? firstLog.workLocationIn?.lat ?? null
      const lngIn = firstLog.locationLongIn ?? firstLog.workLocationIn?.long ?? null
      const latOut = firstLog.locationLatOut ?? firstLog.workLocationOut?.lat ?? null
      const lngOut = firstLog.locationLongOut ?? firstLog.workLocationOut?.long ?? null

      // Status: check all sessions
      let status = 'unknown'
      const hasOffice = sessions.some(s => {
        const ln = s.workLocationIn?.name ?? s.workCode?.name ?? null
        const la = s.locationLatIn ?? s.workLocationIn?.lat ?? null
        const lo = s.locationLongIn ?? s.workLocationIn?.long ?? null
        return isOfficeName(ln) || isOfficeGps(la, lo)
      })
      const hasWfh = sessions.some(s => {
        const n = (s.workLocationIn?.name ?? '').toLowerCase()
        return n.includes('wfh') || n.includes('work from home')
      })

      if (hasOffice) status = 'office'
      else if (hasWfh) status = 'wfh'
      else status = classifyStatus(locIn, latIn, lngIn, firstLog.label)

      // Time in/out: earliest in, latest out
      const ins = sessions.filter(s => s.from).map(s => new Date(s.from!).getTime())
      const outs = sessions.filter(s => s.to).map(s => new Date(s.to!).getTime())
      const timeIn = ins.length ? format(new Date(Math.min(...ins)), 'HH:mm:ss') : null
      const timeOut = outs.length ? format(new Date(Math.max(...outs)), 'HH:mm:ss') : null

      // Hours
      let hours: number | null = null
      if (ins.length && outs.length) {
        hours = Math.round(((Math.max(...outs) - Math.min(...ins)) / 3_600_000) * 100) / 100
      }

      await supabase.from('attendance_records').upsert({
        employee_id: empRow.id,
        date: agg.date,
        location_in: locIn,
        lat_in: latIn, lng_in: lngIn,
        time_in: timeIn,
        location_out: locOut,
        lat_out: latOut, lng_out: lngOut,
        time_out: timeOut,
        hours_worked: hours,
        status,
        comments: firstLog.label,
        raw_data: sessions,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'employee_id,date' })

      saved++
    }

    // Sync log
    await supabase.from('sync_log').insert({
      sync_date: dateFrom, source: 'talexio', records: saved, status: 'success',
    })

    return NextResponse.json({ ok: true, fetched: logs.length, saved, employees: empSet.size })
  } catch (err) {
    console.error('[import/pull]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Pull failed' }, { status: 500 })
  }
}
