import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

/**
 * POST /api/import/reclassify
 * Re-classifies all attendance records using employee group_type:
 * - Malta Office employee + at office → office
 * - Malta Office employee + not at office → wfh
 * - Remote employee → remote
 * - Broken/active stay as-is
 * - Also generates no_clocking for Malta employees on missing workdays
 */
export async function POST(req: NextRequest) {
  try {
    const { dateFrom, dateTo } = await req.json()
    if (!dateFrom || !dateTo) return NextResponse.json({ error: 'dateFrom and dateTo required' }, { status: 400 })

    const supabase = createAdminClient()

    // Get all employees with their group
    const { data: employees } = await supabase.from('employees').select('id, group_type, excluded')
    const empGroup = new Map<string, string>()
    for (const e of employees ?? []) empGroup.set(e.id, e.group_type ?? 'unclassified')

    // Get all attendance records in range
    const { data: records } = await supabase
      .from('attendance_records')
      .select('id, employee_id, date, status, location_in, lat_in, lng_in, location_out, lat_out, lng_out, time_in, time_out')
      .gte('date', dateFrom).lte('date', dateTo)

    let reclassified = 0, unchanged = 0

    for (const r of records ?? []) {
      const group = empGroup.get(r.employee_id) ?? 'unclassified'
      const isMalta = group === 'office_malta'

      // Skip leave/sick — those are correct
      if (r.status === 'vacation' || r.status === 'sick') { unchanged++; continue }

      // Keep broken/active as-is
      if (r.status === 'broken' || r.status === 'active') { unchanged++; continue }

      // Determine correct status
      const atOffice = isOfficeName(r.location_in) || isOfficeName(r.location_out) || isOfficeGps(r.lat_in, r.lng_in) || isOfficeGps(r.lat_out, r.lng_out)

      let newStatus: string
      if (atOffice) {
        newStatus = 'office'
      } else if (isMalta) {
        newStatus = 'wfh'
      } else {
        newStatus = 'remote'
      }

      if (newStatus !== r.status) {
        await supabase.from('attendance_records').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', r.id)
        reclassified++
      } else {
        unchanged++
      }
    }

    // Generate no_clocking for Malta Office employees on missing workdays
    const maltaEmps = (employees ?? []).filter(e => e.group_type === 'office_malta' && !e.excluded)
    const workdays: string[] = []
    const d = new Date(dateFrom + 'T00:00:00')
    const end = new Date(dateTo + 'T00:00:00')
    while (d <= end) {
      const dow = d.getDay()
      if (dow >= 1 && dow <= 5) workdays.push(d.toISOString().slice(0, 10))
      d.setDate(d.getDate() + 1)
    }

    let noClockingGenerated = 0
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

    return NextResponse.json({ ok: true, reclassified, unchanged, noClockingGenerated, totalRecords: (records ?? []).length })
  } catch (err) {
    console.error('[reclassify]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
