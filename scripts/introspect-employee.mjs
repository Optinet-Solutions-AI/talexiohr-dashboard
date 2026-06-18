// Probe the Talexio `employees` query for LOCATION/COUNTRY and TERMINATION fields.
// Uses the correct GraphQL endpoint (api.talexiohr.com/graphql) and the token
// from the talexio_auth table (or TALEXIO_PROBE_TOKEN env var).
import fs from 'node:fs'

const envText = fs.readFileSync('.env.local', 'utf8')
const env = {}
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)
  if (m) env[m[1]] = m[2]
}
// IMPORTANT: hit the working /graphql endpoint, NOT the bare env root URL.
const GQL_URL = 'https://api.talexiohr.com/graphql'
const DOMAIN  = env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN || 'roosterpartners.talexiohr.com'

async function getToken() {
  if (process.env.TALEXIO_PROBE_TOKEN) return process.env.TALEXIO_PROBE_TOKEN.trim()
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/talexio_auth?id=eq.1&select=token`
  const res = await fetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } })
  const rows = await res.json()
  return Array.isArray(rows) && rows[0]?.token ? rows[0].token : null
}
function hdr(token) {
  const h = { 'Content-Type': 'application/json', 'client-domain': DOMAIN,
    'apollographql-client-name': 'talexio-hr-frontend', 'apollographql-client-version': '1.0' }
  if (token.split('.').length === 3) h['authorization'] = `Bearer ${token}`
  else h['talexio-api-token'] = token
  return h
}
async function gql(token, query) {
  const res = await fetch(GQL_URL, { method: 'POST', headers: hdr(token), body: JSON.stringify({ query }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
function errOf(j) {
  if (j.error) return String(j.error)
  if (j.errors?.length) return j.errors.map(e => e.message).join(' | ')
  return null
}
async function probe(token, selection) {
  const r = await gql(token, `query { employees { id ${selection} } }`)
  const e = errOf(r.json)
  if (e) return { ok: false, msg: e }
  const rows = r.json.data?.employees || []
  const key = selection.split(/[ {(]/)[0]
  const samples = rows.map(x => x[key]).filter(v => v != null && (Array.isArray(v) ? v.length : true))
  return { ok: true, sample: samples.slice(0, 2) }
}

async function main() {
  const token = await getToken()
  if (!token) { console.log('No token'); return }

  const base = await gql(token, `query { employees { id fullName } }`)
  const baseErr = errOf(base.json)
  if (baseErr) { console.log('employees BLOCKED:', baseErr); return }
  console.log(`employees OK — ${base.json.data.employees.length} employees\n`)

  // Employee-level status / termination scalar candidates
  const statusFields = ['status','employmentStatus','employeeStatus','isActive','active',
    'isTerminated','terminated','isArchived','archived','isDeleted','terminationDate',
    'endDate','startDate','employmentEndDate','state','isCurrentEmployee','currentlyEmployed']
  // Employee-level location scalar candidates
  const locFields = ['country','countryCode','nationality','citizenship','region']
  // Nested candidates — employment records / positions / address (from the UI)
  const nested = [
    'employmentRecords { country startDate endDate }',
    'employments { country startDate endDate }',
    'positions { country startDate endDate }',
    'employmentRecords { id startDate endDate country { code name } }',
    'currentEmployment { country startDate endDate }',
    'currentPosition { country startDate endDate }',
    'address { country city }',
    'residence { country }',
  ]

  for (const [title, list, isNested] of [
    ['EMPLOYEE-LEVEL STATUS / TERMINATION (scalar)', statusFields, false],
    ['EMPLOYEE-LEVEL LOCATION (scalar)', locFields, false],
    ['NESTED: employment records / positions / address', nested, true],
  ]) {
    console.log(`=== ${title} ===`)
    for (const sel of list) {
      const r = await probe(token, sel)
      if (r.ok) console.log(`  ✅ ${sel}\n       sample=${JSON.stringify(r.sample).slice(0,300)}`)
      else console.log(`  ❌ ${sel.split(/[ {(]/)[0]}  ${r.msg.slice(0,120)}`)
    }
    console.log('')
  }
}
main()
