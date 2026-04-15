// Run: node scripts/import-csv.mjs
// Reads the CSV directly and saves to Supabase using the service role key.
// Requires .env.local to have SUPABASE_SERVICE_ROLE_KEY set.

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env.local manually ──────────────────────────────────────────────────
const envPath = join(__dirname, '..', '.env.local')
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)

const SUPABASE_URL      = env['NEXT_PUBLIC_SUPABASE_URL']
const SERVICE_ROLE_KEY  = env['SUPABASE_SERVICE_ROLE_KEY']

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// ── CSV parser (same logic as import-csv route) ───────────────────────────────
const MONTHS = {
  january:1,february:2,march:3,april:4,may:5,june:6,
  july:7,august:8,september:9,october:10,november:11,december:12,
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/)
  const rows = []
  let currentDate = null
  let year = new Date().getFullYear()

  const yearMatch = lines[0]?.match(/\/(\d{4})/)
  if (yearMatch) year = parseInt(yearMatch[1])

  for (const line of lines) {
    const cols = line.split(',')
    const first = (cols[0] ?? '').trim().toLowerCase()

    const monthKey = Object.keys(MONTHS).find(m => first.startsWith(m))
    if (monthKey && cols[1]?.trim() === '') {
      const dayNum = parseInt(first.replace(monthKey, '').trim())
      if (!isNaN(dayNum)) {
        const month = MONTHS[monthKey]
        currentDate = `${year}-${String(month).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`
      }
      continue
    }

    if (!currentDate || !first || first.includes('week') || first === 'location in') continue
    if (first.includes('latitude') || first.includes('longitude')) continue

    const [firstName, lastName, locationIn, latInStr, lngInStr, timeIn,
           locationOut, latOutStr, lngOutStr, timeOut, hours, ...commentParts] = cols.map(c => c.trim())

    if (!firstName || !lastName) continue

    const validTime = v => (v && v !== 'n/a' && /^\d{1,2}:\d{2}$/.test(v)) ? v : null
    const validFloat = v => (v && v !== 'n/a') ? parseFloat(v) : null

    rows.push({
      date: currentDate, firstName, lastName,
      locationIn:  (locationIn  && locationIn  !== 'n/a') ? locationIn  : null,
      latIn:       validFloat(latInStr),
      lngIn:       validFloat(lngInStr),
      timeIn:      validTime(timeIn),
      locationOut: (locationOut && locationOut !== 'n/a') ? locationOut : null,
      latOut:      validFloat(latOutStr),
      lngOut:      validFloat(lngOutStr),
      timeOut:     validTime(timeOut),
      hours:       (hours && hours !== 'n/a') ? hours : null,
      comments:    commentParts.join(',').trim() || null,
    })
  }
  return rows
}

// ── Status classification ─────────────────────────────────────────────────────
function parseHours(s) {
  if (!s) return null
  const m = s.match(/(\d+)\s*h\s*(\d+)\s*min/i)
  if (m) return parseInt(m[1]) + parseInt(m[2]) / 60
  const h = s.match(/^(\d+(\.\d+)?)$/)
  if (h) return parseFloat(h[1])
  return null
}

const OFFICE_LAT = 35.9222072, OFFICE_LNG = 14.4878368, RADIUS = 0.1
function gpsDistance(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}
function classifyStatus(loc, lat, lng, comment) {
  const l = (loc ?? '').toLowerCase(), c = (comment ?? '').toLowerCase()
  if (l === 'no clocking' || l.includes('no clocking')) {
    if (c.includes('vacation') || c.includes('annual leave')) return 'vacation'
    return 'no_clocking'
  }
  if (l.includes('active clocking') || l === 'active') return 'active'
  if (l.includes('broken')) return 'broken'
  if (l === 'wfh' || l.includes('work from home') || l.includes('wfh')) return 'wfh'
  if (l.includes('not from the office') || l.includes('remote')) return 'remote'
  if (l.includes('office')) return 'office'
  if (lat && lng) return gpsDistance(lat, lng, OFFICE_LAT, OFFICE_LNG) <= RADIUS ? 'office' : 'remote'
  return 'unknown'
}

// ── Main ──────────────────────────────────────────────────────────────────────
const csvPath = join(__dirname, '..', '04-2026 Malta office attandance - Daily reports.csv')
const text = readFileSync(csvPath, 'utf8')
const rows = parseCsv(text)

console.log(`Parsed ${rows.length} rows from CSV`)
if (rows.length === 0) { console.error('No rows parsed — check CSV format'); process.exit(1) }

const dates = [...new Set(rows.map(r => r.date))].sort()
console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`)

let saved = 0, skipped = 0

for (const row of rows) {
  if (!row.firstName || !row.lastName || !row.date) { skipped++; continue }

  // Find or create employee
  let { data: emp } = await supabase
    .from('employees').select('id')
    .eq('first_name', row.firstName).eq('last_name', row.lastName)
    .maybeSingle()

  if (!emp) {
    const { data: newEmp, error } = await supabase
      .from('employees')
      .insert({ first_name: row.firstName, last_name: row.lastName })
      .select('id').single()
    if (error) { console.error(`Failed to insert employee ${row.firstName} ${row.lastName}:`, error.message); skipped++; continue }
    emp = newEmp
    console.log(`  + Created employee: ${row.firstName} ${row.lastName}`)
  }

  const status = classifyStatus(row.locationIn, row.latIn, row.lngIn, row.comments)

  const { error: upsertErr } = await supabase.from('attendance_records').upsert({
    employee_id:  emp.id,
    date:         row.date,
    location_in:  row.locationIn,
    lat_in:       row.latIn,
    lng_in:       row.lngIn,
    time_in:      row.timeIn  ? `${row.timeIn}:00`  : null,
    location_out: row.locationOut,
    lat_out:      row.latOut,
    lng_out:      row.lngOut,
    time_out:     row.timeOut ? `${row.timeOut}:00` : null,
    hours_worked: parseHours(row.hours),
    status,
    comments:     row.comments,
    raw_data:     row,
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'employee_id,date' })

  if (upsertErr) { console.error(`Failed to upsert record ${row.date} ${row.firstName}:`, upsertErr.message); skipped++ }
  else saved++
}

// Log sync
await supabase.from('sync_log').insert({
  sync_date: dates[0], source: 'csv', records: saved, status: 'success',
})

console.log(`\nDone. Saved: ${saved}, Skipped: ${skipped}`)
