import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isOfficeLocation, classifyClockedStatus } from '@/lib/attendance/location'

/**
 * POST /api/import/reclassify
 * Re-classifies all attendance records using employee group_type:
 * - Malta Office employee + at office → office
 * - Malta Office employee + not at office → wfh
 * - Remote employee → remote
 * - Broken/active are reclassified by location (in or out at office)
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

    // Get all attendance records in range. PostgREST caps a single response at
    // ~1000 rows, so page through with .range() until a short page comes back —
    // otherwise records beyond the first 1000 would silently never reclassify.
    type RecRow = {
      id: string; employee_id: string; date: string; status: string
      location_in: string | null; lat_in: number | null; lng_in: number | null
      location_out: string | null; lat_out: number | null; lng_out: number | null
      time_in: string | null; time_out: string | null
    }
    const PAGE = 1000
    const records: RecRow[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('id, employee_id, date, status, location_in, lat_in, lng_in, location_out, lat_out, lng_out, time_in, time_out')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error || !data || data.length === 0) break
      records.push(...(data as RecRow[]))
      if (data.length < PAGE) break
    }

    let reclassified = 0, unchanged = 0

    for (const r of records) {
      const group = empGroup.get(r.employee_id) ?? 'unclassified'
      const isMalta = group === 'office_malta'

      // Skip leave/sick and absent days — those are correct as-is.
      if (r.status === 'vacation' || r.status === 'sick' || r.status === 'no_clocking') { unchanged++; continue }

      // Classify by location: office if clock-in OR clock-out at office.
      const inOffice = isOfficeLocation(r.location_in, r.lat_in, r.lng_in)
      const outOffice = isOfficeLocation(r.location_out, r.lat_out, r.lng_out)
      const newStatus: string = classifyClockedStatus({ inOffice, outOffice, isMalta })

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

    return NextResponse.json({ ok: true, reclassified, unchanged, noClockingGenerated, totalRecords: records.length })
  } catch (err) {
    console.error('[reclassify]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
