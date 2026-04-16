import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import * as XLSX from 'xlsx'

// Convert uploaded file to CSV text — supports both .csv and .xlsx
async function fileToText(file: File): Promise<string> {
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_csv(sheet)
  }
  return await file.text()
}

// ── Clockings CSV Parser ─────────────────────────────────────────────────────
// Columns: Employee Code, First Name, Last Name, Job Schedule, Unit, Business Unit,
//          Work Code, Location In, Lat In, Lng In, Location Out, Lat Out, Lng Out,
//          Date, Day, Time In, Time Out, Hours
function parseClockings(text: string) {
  const lines = text.split(/\r?\n/).slice(1)
  const rows: { code: string; firstName: string; lastName: string; date: string; timeIn: string | null; timeOut: string | null; hours: number; locationIn: string | null }[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const c = line.split(',')
    const code = c[0]?.trim()
    const date = c[13]?.trim()
    if (!code || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    rows.push({
      code,
      firstName: c[1]?.trim() || '',
      lastName: c[2]?.trim() || '',
      date,
      timeIn: /^\d{1,2}:\d{2}$/.test(c[15]?.trim() || '') ? c[15].trim() : null,
      timeOut: /^\d{1,2}:\d{2}$/.test(c[16]?.trim() || '') ? c[16].trim() : null,
      hours: parseFloat(c[17]) || 0,
      locationIn: c[7]?.trim() || null,
    })
  }
  return rows
}

// ── Leave CSV Parser ─────────────────────────────────────────────────────────
function splitCsvLine(line: string) {
  const result: string[] = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { result.push(cur); cur = '' }
    else cur += ch
  }
  result.push(cur)
  return result
}

function parseLeave(text: string) {
  const lines = text.split(/\r?\n/).slice(1)
  const rows: { code: string; fullName: string; date: string; type: string; status: string }[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const c = splitCsvLine(line)
    const code = c[1]?.trim()
    const date = c[10]?.trim()
    const status = c[13]?.trim()
    const type = c[14]?.trim()
    if (!code || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    rows.push({
      code,
      fullName: c[0]?.trim() || '',
      date,
      type: type?.toLowerCase() === 'sick' ? 'sick' : 'vacation',
      status: status || '',
    })
  }
  return rows
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const fileType = formData.get('type') as string | null // 'clockings' or 'leave'

    if (!file || !fileType) {
      return NextResponse.json({ error: 'Missing file or type' }, { status: 400 })
    }

    const text = await fileToText(file)
    const supabase = createAdminClient()

    if (fileType === 'clockings') {
      const rows = parseClockings(text)
      if (rows.length === 0) return NextResponse.json({ error: 'No valid rows found in CSV' }, { status: 400 })

      // Get unique employee+date pairs
      const dateMap = new Map<string, { code: string; name: string; sessions: number; hours: number }>()
      for (const r of rows) {
        const key = `${r.code}::${r.date}`
        const existing = dateMap.get(key)
        if (existing) {
          existing.sessions++
          existing.hours += r.hours
        } else {
          dateMap.set(key, { code: r.code, name: `${r.firstName} ${r.lastName}`, sessions: 1, hours: r.hours })
        }
      }

      const dates = [...new Set(rows.map(r => r.date))].sort()
      const employees = [...new Set(rows.map(r => r.code))]

      // Check which employee+date combos already exist in DB
      const { data: existingRecords } = await supabase
        .from('attendance_records')
        .select('employee_id, date, status, employees!inner(talexio_id)')
        .gte('date', dates[0]).lte('date', dates[dates.length - 1])

      const existingSet = new Set<string>()
      for (const rec of existingRecords ?? []) {
        const emp = Array.isArray(rec.employees) ? rec.employees[0] : rec.employees
        if (emp?.talexio_id) existingSet.add(`${emp.talexio_id}::${rec.date}`)
      }

      const conflicts: { employee: string; date: string; existingStatus: string }[] = []
      const newRecords: { employee: string; date: string }[] = []

      for (const [key, val] of dateMap) {
        if (existingSet.has(key)) {
          const rec = (existingRecords ?? []).find(r => {
            const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
            return emp?.talexio_id === val.code && r.date === key.split('::')[1]
          })
          conflicts.push({ employee: val.name, date: key.split('::')[1], existingStatus: rec?.status || 'unknown' })
        } else {
          newRecords.push({ employee: val.name, date: key.split('::')[1] })
        }
      }

      return NextResponse.json({
        type: 'clockings',
        totalRows: rows.length,
        uniqueRecords: dateMap.size,
        dateRange: { from: dates[0], to: dates[dates.length - 1] },
        employeeCount: employees.length,
        newRecords: newRecords.length,
        conflicts: conflicts.length,
        conflictDetails: conflicts.slice(0, 50), // limit preview
        newDetails: newRecords.slice(0, 20),
      })
    }

    if (fileType === 'leave') {
      const rows = parseLeave(text)
      if (rows.length === 0) return NextResponse.json({ error: 'No valid rows found in CSV' }, { status: 400 })

      const approvedRows = rows.filter(r => r.status === 'Approved')
      const dates = [...new Set(approvedRows.map(r => r.date))].sort()
      const employees = [...new Set(approvedRows.map(r => r.code))]

      // Check existing
      const { data: existingRecords } = await supabase
        .from('attendance_records')
        .select('employee_id, date, status, employees!inner(talexio_id)')
        .gte('date', dates[0] || '2000-01-01').lte('date', dates[dates.length - 1] || '2099-01-01')

      const existingMap = new Map<string, string>()
      for (const rec of existingRecords ?? []) {
        const emp = Array.isArray(rec.employees) ? rec.employees[0] : rec.employees
        if (emp?.talexio_id) existingMap.set(`${emp.talexio_id}::${rec.date}`, rec.status)
      }

      const conflicts: { employee: string; date: string; leaveType: string; existingStatus: string }[] = []
      const newRecords: { employee: string; date: string; leaveType: string }[] = []

      for (const r of approvedRows) {
        const key = `${r.code}::${r.date}`
        const existingStatus = existingMap.get(key)
        if (existingStatus) {
          conflicts.push({ employee: r.fullName, date: r.date, leaveType: r.type, existingStatus })
        } else {
          newRecords.push({ employee: r.fullName, date: r.date, leaveType: r.type })
        }
      }

      return NextResponse.json({
        type: 'leave',
        totalRows: rows.length,
        approvedRows: approvedRows.length,
        skippedRows: rows.length - approvedRows.length,
        dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
        employeeCount: employees.length,
        newRecords: newRecords.length,
        conflicts: conflicts.length,
        conflictDetails: conflicts.slice(0, 50),
        newDetails: newRecords.slice(0, 20),
        vacationCount: approvedRows.filter(r => r.type === 'vacation').length,
        sickCount: approvedRows.filter(r => r.type === 'sick').length,
      })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (err) {
    console.error('[import/preview]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Preview failed' }, { status: 500 })
  }
}
