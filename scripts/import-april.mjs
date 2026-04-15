/**
 * Full import for April 1-15 data from two CSV sources:
 *   1. Clockings 1-15 April(Sheet1).csv   — raw time-log rows (multiple per day per employee)
 *   2. April leave and sick(Sheet1).csv    — approved leave / sick entries
 *
 * Run: node scripts/import-april.mjs
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env.local ───────────────────────────────────────────────────────────
const envPath = join(__dirname, '..', '.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'])

// ── Constants ─────────────────────────────────────────────────────────────────
const OFFICE_LAT  = 35.9222072
const OFFICE_LNG  = 14.4878368
const OFFICE_KM   = 0.12        // slightly wider tolerance for GPS drift
const DATE_FROM   = '2026-04-01'
const DATE_TO     = '2026-04-15'

function gpsKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function isOfficeGps(lat, lng) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return false
  return gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM
}

function isOfficeLocation(name) {
  if (!name) return false
  const n = name.trim().toLowerCase()
  return n === 'head office' || n.includes('head office')
}

function parseTime(val) {
  if (!val || val === 'Broken Clocking' || val === 'Active Clocking') return null
  return /^\d{1,2}:\d{2}$/.test(val.trim()) ? val.trim() + ':00' : null
}

function toMinutes(t) {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// ── Parse Clockings CSV ───────────────────────────────────────────────────────
// Columns: Employee Code, First Name, Last Name, Job Schedule, Unit, Business Unit,
//          Work Code, Location In, Lat In, Lng In, Location Out, Lat Out, Lng Out,
//          Date, Day, Time In, Time Out, Hours
function parseClockings(text) {
  const lines = text.split(/\r?\n/).slice(1) // skip header
  const rows = []
  for (const line of lines) {
    if (!line.trim()) continue
    const c = line.split(',')
    const code     = c[0]?.trim()
    const date     = c[13]?.trim()
    if (!code || !date || date < DATE_FROM || date > DATE_TO) continue

    rows.push({
      code,
      firstName:   c[1]?.trim() || '',
      lastName:    c[2]?.trim() || '',
      unit:        c[4]?.trim() || '',
      locationIn:  c[7]?.trim() || null,
      latIn:       parseFloat(c[8]) || null,
      lngIn:       parseFloat(c[9]) || null,
      locationOut: c[10]?.trim() || null,
      latOut:      parseFloat(c[11]) || null,
      lngOut:      parseFloat(c[12]) || null,
      date,
      timeIn:      parseTime(c[15]?.trim()),
      timeOutRaw:  c[16]?.trim(),
      timeOut:     parseTime(c[16]?.trim()),
      hours:       parseFloat(c[17]) || 0,
      isBroken:    c[16]?.trim() === 'Broken Clocking',
      isActive:    c[16]?.trim() === 'Active Clocking',
    })
  }
  return rows
}

// Aggregate multiple sessions for same employee+date into one attendance record
function aggregateDay(sessions) {
  const hasOffice = sessions.some(s =>
    isOfficeLocation(s.locationIn) || isOfficeLocation(s.locationOut) ||
    isOfficeGps(s.latIn, s.lngIn) || isOfficeGps(s.latOut, s.lngOut)
  )
  const hasActive  = sessions.some(s => s.isActive)
  const hasBroken  = sessions.some(s => s.isBroken)
  const allBroken  = sessions.every(s => s.isBroken || s.isActive)
  const hasValid   = sessions.some(s => !s.isBroken && !s.isActive)

  let status = 'remote'
  if (hasOffice)       status = 'office'
  else if (hasActive)  status = 'active'
  else if (allBroken)  status = 'broken'

  // If office but also broken out — annotate in comments
  const brokenAtOffice = hasOffice && hasBroken && !sessions.every(s => !s.isBroken)

  // Time in: earliest valid time_in
  const validTimes = sessions.filter(s => s.timeIn).map(s => toMinutes(s.timeIn)).filter(Boolean)
  const earliestMins = validTimes.length ? Math.min(...validTimes) : null
  const timeIn = earliestMins != null
    ? String(Math.floor(earliestMins/60)).padStart(2,'0') + ':' + String(earliestMins%60).padStart(2,'0') + ':00'
    : null

  // Time out: latest valid time_out
  const validOuts = sessions.filter(s => s.timeOut).map(s => toMinutes(s.timeOut)).filter(Boolean)
  const latestMins = validOuts.length ? Math.max(...validOuts) : null
  const timeOut = latestMins != null
    ? String(Math.floor(latestMins/60)).padStart(2,'0') + ':' + String(latestMins%60).padStart(2,'0') + ':00'
    : null

  // Total hours: sum valid sessions
  const hoursWorked = sessions.reduce((sum, s) => sum + (s.hours > 0 ? s.hours : 0), 0) || null

  // First session for location data
  const first = sessions[0]
  const officeSession = sessions.find(s => isOfficeLocation(s.locationIn) || isOfficeLocation(s.locationOut)) ?? first

  const comments = [
    hasBroken && !allBroken  ? 'Has broken clocking(s)'  : null,
    hasBroken && allBroken   ? 'All clockings broken'     : null,
    hasActive                ? 'Active clocking'          : null,
    brokenAtOffice           ? 'Did not clock out'        : null,
  ].filter(Boolean).join('; ') || null

  return {
    date:        first.date,
    location_in: officeSession.locationIn || null,
    lat_in:      officeSession.latIn,
    lng_in:      officeSession.lngIn,
    time_in:     timeIn,
    location_out: officeSession.locationOut || null,
    lat_out:     officeSession.latOut,
    lng_out:     officeSession.lngOut,
    time_out:    timeOut,
    hours_worked: hoursWorked ? Math.round(hoursWorked * 100) / 100 : null,
    status,
    comments,
    raw_data:    sessions,
  }
}

// ── Parse Leave CSV ───────────────────────────────────────────────────────────
// Columns: Full name, Employee code, ...(8 cols)..., Date, Time from, Time to, Status, Type, ...
function parseLeave(text) {
  const lines = text.split(/\r?\n/).slice(1)
  const entries = []
  for (const line of lines) {
    if (!line.trim()) continue
    // Split respecting quoted fields (address field has commas)
    const c = splitCsvLine(line)
    const code   = c[1]?.trim()
    const date   = c[10]?.trim()
    const status = c[13]?.trim()
    const type   = c[14]?.trim()
    if (!code || !date || !date.match(/^\d{4}-\d{2}-\d{2}$/) || status !== 'Approved') continue
    if (date < DATE_FROM || date > DATE_TO) continue
    entries.push({ code, date, type: type?.toLowerCase() === 'sick' ? 'sick' : 'vacation' })
  }
  return entries
}

function splitCsvLine(line) {
  const result = []
  let cur = '', inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { result.push(cur); cur = '' }
    else cur += ch
  }
  result.push(cur)
  return result
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
console.log('Reading CSV files...')
const clockingText = readFileSync(join(__dirname, '..', 'Clockings 1-15 April(Sheet1).csv'), 'utf8')
const leaveText    = readFileSync(join(__dirname, '..', 'April leave and sick(Sheet1).csv'), 'utf8')

const clockingRows = parseClockings(clockingText)
const leaveEntries = parseLeave(leaveText)

console.log(`Clocking rows (Apr 1-15): ${clockingRows.length}`)
console.log(`Leave entries (Apr 1-15): ${leaveEntries.length}`)

// 1. Clear existing data
console.log('\nClearing existing data...')
await sb.from('attendance_records').delete().gte('date', '2000-01-01')
await sb.from('sync_log').delete().gte('sync_date', '2000-01-01')
await sb.from('employees').delete().gte('created_at', '2000-01-01')
console.log('Cleared.')

// 2. Build employee map from clockings (code → {firstName, lastName, unit})
const empMap = new Map()
for (const r of clockingRows) {
  if (!empMap.has(r.code)) {
    empMap.set(r.code, { firstName: r.firstName, lastName: r.lastName, unit: r.unit })
  }
}
// Also add employees from leave CSV (employee code only, name from leave header rows)
const leaveLines = leaveText.split(/\r?\n/).slice(1)
for (const line of leaveLines) {
  if (!line.trim()) continue
  const c = splitCsvLine(line)
  const fullName = c[0]?.trim()
  const code     = c[1]?.trim()
  if (!code || !fullName || !empMap.has(code)) {
    if (code && fullName && !empMap.has(code)) {
      // Leave CSV name format: "LastName FirstName"
      const parts = fullName.split(' ')
      const lastName  = parts[0] || ''
      const firstName = parts.slice(1).join(' ') || ''
      empMap.set(code, { firstName, lastName, unit: '' })
    }
  }
}

// 3. Upsert employees
console.log(`\nUpserting ${empMap.size} employees...`)
const dbEmpMap = new Map() // code → db UUID
for (const [code, emp] of empMap) {
  const { data, error } = await sb.from('employees')
    .upsert(
      { talexio_id: code, first_name: emp.firstName.trim(), last_name: emp.lastName.trim() },
      { onConflict: 'talexio_id' }
    )
    .select('id').single()
  if (error) { console.error(`  Employee upsert failed ${code}:`, error.message); continue }
  dbEmpMap.set(code, data.id)
}
console.log(`  ${dbEmpMap.size} employees saved.`)

// 4. Group clocking rows by employee+date
const grouped = new Map()
for (const r of clockingRows) {
  const key = `${r.code}::${r.date}`
  if (!grouped.has(key)) grouped.set(key, { code: r.code, date: r.date, sessions: [] })
  grouped.get(key).sessions.push(r)
}

// 5. Insert attendance records from clockings
console.log(`\nInserting attendance records from clockings...`)
let savedClocking = 0, failedClocking = 0
for (const { code, date, sessions } of grouped.values()) {
  const empId = dbEmpMap.get(code)
  if (!empId) { failedClocking++; continue }

  const rec = aggregateDay(sessions)
  const { error } = await sb.from('attendance_records').upsert(
    { employee_id: empId, ...rec, updated_at: new Date().toISOString() },
    { onConflict: 'employee_id,date' }
  )
  if (error) { console.error(`  Clocking upsert failed ${code} ${date}:`, error.message); failedClocking++ }
  else savedClocking++
}
console.log(`  Saved: ${savedClocking}, Failed: ${failedClocking}`)

// 6. Apply leave entries — update existing records or create new vacation/sick records
console.log(`\nApplying leave entries...`)
let savedLeave = 0, failedLeave = 0
for (const { code, date, type } of leaveEntries) {
  const empId = dbEmpMap.get(code)
  if (!empId) { console.warn(`  No employee for leave: ${code}`); failedLeave++; continue }

  // Check if a clocking record already exists for this day
  const { data: existing } = await sb.from('attendance_records')
    .select('id, status')
    .eq('employee_id', empId)
    .eq('date', date)
    .maybeSingle()

  if (existing) {
    // Update comments and override status only if no_clocking or unknown
    const shouldOverride = ['no_clocking', 'unknown'].includes(existing.status)
    const { error } = await sb.from('attendance_records').update({
      status:   shouldOverride ? type : existing.status,
      comments: `${type === 'sick' ? 'Sick leave' : 'Approved vacation'} (approved)`,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id)
    if (error) { failedLeave++; continue }
  } else {
    // No clocking at all for that day — create a leave record
    const { error } = await sb.from('attendance_records').insert({
      employee_id: empId,
      date,
      status:      type,
      comments:    `${type === 'sick' ? 'Sick leave' : 'Approved vacation'} (approved)`,
      updated_at:  new Date().toISOString(),
    })
    if (error) { console.error(`  Leave insert failed ${code} ${date}:`, error.message); failedLeave++; continue }
  }
  savedLeave++
}
console.log(`  Applied: ${savedLeave}, Failed: ${failedLeave}`)

// 7. Sync log
await sb.from('sync_log').insert({
  sync_date: DATE_FROM, source: 'csv', records: savedClocking + savedLeave, status: 'success',
})

// Summary
console.log('\n══════════════════════════════════')
console.log(`Employees:   ${dbEmpMap.size}`)
console.log(`Clockings:   ${savedClocking} records (${failedClocking} failed)`)
console.log(`Leave:       ${savedLeave} applied (${failedLeave} failed)`)
console.log(`Date range:  ${DATE_FROM} → ${DATE_TO}`)
console.log('══════════════════════════════════')
