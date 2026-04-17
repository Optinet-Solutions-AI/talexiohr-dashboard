import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import * as XLSX from 'xlsx'

async function fileToText(file: File): Promise<string> {
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_csv(sheet)
  }
  return await file.text()
}

const OFFICE_LAT = 35.9222072, OFFICE_LNG = 14.4878368, OFFICE_KM = 0.12
function gpsKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}
function isOfficeGps(lat: number|null, lng: number|null) { return lat && lng ? gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM : false }
function isOfficeName(n: string|null) { return n ? n.toLowerCase().includes('head office') || n.toLowerCase().includes('office') : false }
function parseTime(v: string) { return /^\d{1,2}:\d{2}$/.test(v?.trim() || '') ? v.trim() + ':00' : null }
function toMin(t: string|null) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m }

function splitCsvLine(line: string) {
  const r: string[] = []; let c = '', q = false
  for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { r.push(c); c = '' } else c += ch }
  r.push(c); return r
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const fileType = formData.get('type') as string | null
    const mode = formData.get('mode') as string | null // 'skip' or 'overwrite'

    if (!file || !fileType) return NextResponse.json({ error: 'Missing file or type' }, { status: 400 })

    const text = await fileToText(file)
    const supabase = createAdminClient()
    const overwrite = mode === 'overwrite'

    if (fileType === 'clockings') {
      const lines = text.split(/\r?\n/).slice(1)
      type Row = { code: string; firstName: string; lastName: string; date: string; timeIn: string|null; timeOut: string|null; hours: number; locationIn: string|null; latIn: number|null; lngIn: number|null; locationOut: string|null; latOut: number|null; lngOut: number|null; isBroken: boolean; isActive: boolean; unit: string }
      const rows: Row[] = []
      for (const line of lines) {
        if (!line.trim()) continue
        const c = line.split(',')
        const code = c[0]?.trim(), date = c[13]?.trim()
        if (!code || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
        rows.push({
          code, firstName: c[1]?.trim()||'', lastName: c[2]?.trim()||'', unit: c[4]?.trim()||'',
          locationIn: c[7]?.trim()||null, latIn: parseFloat(c[8])||null, lngIn: parseFloat(c[9])||null,
          locationOut: c[10]?.trim()||null, latOut: parseFloat(c[11])||null, lngOut: parseFloat(c[12])||null,
          date, timeIn: parseTime(c[15]?.trim()||''), timeOut: parseTime(c[16]?.trim()||''), hours: parseFloat(c[17])||0,
          isBroken: c[16]?.trim() === 'Broken Clocking', isActive: c[16]?.trim() === 'Active Clocking',
        })
      }

      // Upsert employees
      const empMap = new Map<string, { firstName: string; lastName: string; unit: string }>()
      for (const r of rows) { if (!empMap.has(r.code)) empMap.set(r.code, { firstName: r.firstName, lastName: r.lastName, unit: r.unit }) }

      const dbEmpMap = new Map<string, string>()
      const empGroupMap = new Map<string, string>() // code → group_type
      for (const [code, emp] of empMap) {
        const { data } = await supabase.from('employees').upsert({ talexio_id: code, first_name: emp.firstName, last_name: emp.lastName }, { onConflict: 'talexio_id' }).select('id, group_type').single()
        if (data) { dbEmpMap.set(code, data.id); empGroupMap.set(code, data.group_type ?? 'unclassified') }
      }

      // Group by employee+date
      const grouped = new Map<string, Row[]>()
      for (const r of rows) {
        const key = `${r.code}::${r.date}`
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(r)
      }

      let saved = 0, skipped = 0
      for (const [key, sessions] of grouped) {
        const [code, date] = key.split('::')
        const empId = dbEmpMap.get(code)
        if (!empId) continue

        if (!overwrite) {
          const { data: existing } = await supabase.from('attendance_records').select('id').eq('employee_id', empId).eq('date', date).maybeSingle()
          if (existing) { skipped++; continue }
        }

        // Aggregate
        const hasOffice = sessions.some(s => isOfficeName(s.locationIn) || isOfficeName(s.locationOut) || isOfficeGps(s.latIn, s.lngIn) || isOfficeGps(s.latOut, s.lngOut))
        const allBroken = sessions.every(s => s.isBroken || s.isActive)
        const hasActive = sessions.some(s => s.isActive)
        const group = empGroupMap.get(code) ?? 'unclassified'
        const isMaltaEmployee = group === 'office_malta'

        let status = isMaltaEmployee ? 'wfh' : 'remote' // Malta employees not at office = WFH, Remote employees = remote
        if (hasOffice) status = 'office'
        else if (hasActive) status = 'active'
        else if (allBroken) status = 'broken'

        const validIns = sessions.filter(s => s.timeIn).map(s => toMin(s.timeIn)).filter(Boolean) as number[]
        const validOuts = sessions.filter(s => s.timeOut).map(s => toMin(s.timeOut)).filter(Boolean) as number[]
        const earliest = validIns.length ? Math.min(...validIns) : null
        const latest = validOuts.length ? Math.max(...validOuts) : null
        const timeIn = earliest != null ? String(Math.floor(earliest/60)).padStart(2,'0') + ':' + String(earliest%60).padStart(2,'0') + ':00' : null
        const timeOut = latest != null ? String(Math.floor(latest/60)).padStart(2,'0') + ':' + String(latest%60).padStart(2,'0') + ':00' : null
        // Broken/active clockings: null out hours and times for accurate averages
        const isBrokenDay = status === 'broken' || status === 'active'
        const hoursWorked = isBrokenDay ? null : (sessions.reduce((s, r) => s + (r.hours > 0 ? r.hours : 0), 0) || null)
        const first = sessions[0]

        await supabase.from('attendance_records').upsert({
          employee_id: empId, date,
          location_in: first.locationIn, lat_in: first.latIn, lng_in: first.lngIn, time_in: isBrokenDay ? null : timeIn,
          location_out: first.locationOut, lat_out: first.latOut, lng_out: first.lngOut, time_out: isBrokenDay ? null : timeOut,
          hours_worked: hoursWorked ? Math.round(hoursWorked * 100) / 100 : null,
          status, comments: isBrokenDay ? 'Broken/active clocking — excluded from hours' : null, raw_data: sessions, updated_at: new Date().toISOString(),
        }, { onConflict: 'employee_id,date' })
        saved++
      }

      // Generate no_clocking records for Malta Office employees on working days with no record
      let noClockingGenerated = 0
      if (rows.length > 0) {
        const allDates = [...new Set(rows.map(r => r.date))].sort()
        const dateFrom = allDates[0], dateTo = allDates[allDates.length - 1]

        // Get Malta Office employees
        const { data: maltaEmps } = await supabase.from('employees').select('id').eq('group_type', 'office_malta').eq('excluded', false)

        if (maltaEmps && maltaEmps.length > 0) {
          // Generate all weekdays in range
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
      }

      return NextResponse.json({ ok: true, saved, skipped, noClockingGenerated, employees: dbEmpMap.size })
    }

    if (fileType === 'leave') {
      const lines = text.split(/\r?\n/).slice(1)
      type LeaveRow = { code: string; fullName: string; date: string; type: string; status: string }
      const rows: LeaveRow[] = []
      for (const line of lines) {
        if (!line.trim()) continue
        const c = splitCsvLine(line)
        const code = c[1]?.trim(), date = c[10]?.trim(), status = c[13]?.trim(), type = c[14]?.trim()
        if (!code || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || status !== 'Approved') continue
        rows.push({ code, fullName: c[0]?.trim()||'', date, type: type?.toLowerCase() === 'sick' ? 'sick' : 'vacation', status })
      }

      // Ensure employees exist
      const empCodes = [...new Set(rows.map(r => r.code))]
      const dbEmpMap = new Map<string, string>()
      for (const code of empCodes) {
        const { data } = await supabase.from('employees').select('id').eq('talexio_id', code).maybeSingle()
        if (data) dbEmpMap.set(code, data.id)
        else {
          const row = rows.find(r => r.code === code)
          if (row) {
            const parts = row.fullName.split(' ')
            const { data: newEmp } = await supabase.from('employees').insert({ talexio_id: code, first_name: parts.slice(1).join(' ') || parts[0], last_name: parts[0] || '' }).select('id').single()
            if (newEmp) dbEmpMap.set(code, newEmp.id)
          }
        }
      }

      let saved = 0, skipped = 0, updated = 0
      for (const r of rows) {
        const empId = dbEmpMap.get(r.code)
        if (!empId) continue

        const { data: existing } = await supabase.from('attendance_records').select('id, status').eq('employee_id', empId).eq('date', r.date).maybeSingle()

        if (existing) {
          if (!overwrite && existing.status !== 'no_clocking' && existing.status !== 'unknown') { skipped++; continue }
          await supabase.from('attendance_records').update({
            status: r.type, comments: `${r.type === 'sick' ? 'Sick leave' : 'Vacation'} (approved)`, updated_at: new Date().toISOString(),
          }).eq('id', existing.id)
          updated++
        } else {
          await supabase.from('attendance_records').insert({
            employee_id: empId, date: r.date, status: r.type,
            comments: `${r.type === 'sick' ? 'Sick leave' : 'Vacation'} (approved)`, updated_at: new Date().toISOString(),
          })
          saved++
        }
      }

      return NextResponse.json({ ok: true, saved, updated, skipped, employees: dbEmpMap.size })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (err) {
    console.error('[import/confirm]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import failed' }, { status: 500 })
  }
}
