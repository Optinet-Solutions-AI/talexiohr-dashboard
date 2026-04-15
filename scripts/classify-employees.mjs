/**
 * Reads the clockings CSV, extracts employee metadata + GPS,
 * classifies Malta-based (office_malta) vs remote employees,
 * then updates the DB.
 *
 * Run: node scripts/classify-employees.mjs
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    .split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()] })
)
const sb = createClient(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'])

// Malta bounding box (includes Gozo & Comino)
const isMalta = (lat, lng) =>
  lat >= 35.75 && lat <= 36.15 && lng >= 14.10 && lng <= 14.80

const text  = readFileSync(join(__dirname, '..', 'Clockings 1-15 April(Sheet1).csv'), 'utf8')
const lines = text.split(/\r?\n/).slice(1)

// Build per-employee map: code → { unit, jobSchedule, maltaClocking, nonMaltaClocking }
const empData = new Map()
for (const line of lines) {
  if (!line.trim()) continue
  const c = line.split(',')
  const code    = c[0]?.trim()
  const unit    = c[4]?.trim() || ''
  const sched   = c[3]?.trim() || ''
  const latIn   = parseFloat(c[8])
  const lngIn   = parseFloat(c[9])
  const latOut  = parseFloat(c[11])
  const lngOut  = parseFloat(c[12])
  if (!code) continue

  if (!empData.has(code)) empData.set(code, { unit, jobSchedule: sched, maltaHits: 0, nonMaltaHits: 0 })
  const d = empData.get(code)
  if (!d.unit && unit) d.unit = unit
  if (!d.jobSchedule && sched) d.jobSchedule = sched

  if (!isNaN(latIn)  && isMalta(latIn,  lngIn))  d.maltaHits++
  if (!isNaN(latOut) && isMalta(latOut, lngOut)) d.maltaHits++
  if (!isNaN(latIn)  && !isMalta(latIn,  lngIn))  d.nonMaltaHits++
  if (!isNaN(latOut) && !isMalta(latOut, lngOut)) d.nonMaltaHits++
}

// Also parse leave CSV for position data
const leaveLines = readFileSync(join(__dirname, '..', 'April leave and sick(Sheet1).csv'), 'utf8').split(/\r?\n/).slice(1)
const posMap = new Map()
for (const line of leaveLines) {
  if (!line.trim()) continue
  const splitCsv = l => { const r=[]; let c='', q=false; for(const ch of l){ if(ch==='"') q=!q; else if(ch===','&&!q){r.push(c);c=''}else c+=ch} r.push(c); return r }
  const c    = splitCsv(line)
  const code = c[1]?.trim()
  const pos  = c[8]?.trim()
  if (code && pos) posMap.set(code, pos)
}

console.log('\nEmployee classification:')
let updated = 0
for (const [code, d] of empData) {
  const group = d.maltaHits > 0 ? 'office_malta' : 'remote'
  console.log(`  ${code.padEnd(8)} ${group.padEnd(14)} unit="${d.unit}" malta=${d.maltaHits} non=${d.nonMaltaHits}`)

  const { error } = await sb.from('employees').update({
    group_type:   group,
    unit:         d.unit   || null,
    job_schedule: d.jobSchedule || null,
    position:     posMap.get(code) || null,
  }).eq('talexio_id', code)

  if (error) console.error(`  !! ${code}:`, error.message)
  else updated++
}

// Employees only in leave CSV (no clockings) — mark as unclassified
const { data: allEmps } = await sb.from('employees').select('talexio_id, group_type')
for (const emp of allEmps ?? []) {
  if (!empData.has(emp.talexio_id) && emp.group_type === 'unclassified') {
    const pos = posMap.get(emp.talexio_id)
    if (pos) await sb.from('employees').update({ position: pos }).eq('talexio_id', emp.talexio_id)
  }
}

console.log(`\nUpdated: ${updated} / ${empData.size} employees from clockings`)
const { data: summary } = await sb.from('employees').select('group_type')
const counts = summary?.reduce((a, e) => { a[e.group_type] = (a[e.group_type]||0)+1; return a }, {})
console.log('Group counts:', counts)
