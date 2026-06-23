// Diagnose the country/termination sync mismatch.
// Compares Talexio employee details against the local employees table and
// checks whether talexio_id (the sync's match key) actually lines up.
import fs from 'node:fs'

const env = {}
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)="?([^"]*)"?$/); if (m) env[m[1]] = m[2]
}
const GQL = 'https://api.talexiohr.com/graphql'
const DOMAIN = env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const sbh = { apikey: KEY, authorization: `Bearer ${KEY}` }

async function getToken() {
  const r = await fetch(`${SB}/rest/v1/talexio_auth?id=eq.1&select=token`, { headers: sbh })
  return (await r.json())[0]?.token
}
function resolveCountry(positions) {
  if (!positions?.length) return null
  const active = positions.find(p => p.isActive) ?? positions.find(p => p.endDate === null)
  const chosen = active ?? [...positions].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))[0]
  return chosen?.country?.name ?? null
}

const token = await getToken()
const th = { 'Content-Type': 'application/json', 'client-domain': DOMAIN,
  'apollographql-client-name': 'talexio-hr-frontend', 'apollographql-client-version': '1.0',
  authorization: `Bearer ${token}` }

// 1) Talexio employees
const tr = await fetch(GQL, { method: 'POST', headers: th, body: JSON.stringify({
  query: `query { employees { id isTerminated positions { ... on EmployeePosition { startDate endDate isActive country { name } } } } }`,
}) })
const tj = await tr.json()
const talexio = (tj.data?.employees ?? []).map(e => ({ id: String(e.id), isTerminated: e.isTerminated, country: resolveCountry(e.positions) }))
const tById = new Map(talexio.map(e => [e.id, e]))

// 2) Local employees (paginate to be safe)
const lr = await fetch(`${SB}/rest/v1/employees?select=id,full_name,talexio_id,country,is_terminated,excluded,details_synced_at&limit=1000`, { headers: sbh })
const local = await lr.json()

// 3) Summaries
const tCountry = {}; for (const e of talexio) { const k = e.country ?? '(none)'; tCountry[k] = (tCountry[k] ?? 0) + 1 }
console.log('=== TALEXIO (', talexio.length, 'employees ) ===')
console.log('country dist:', JSON.stringify(tCountry))
console.log('terminated:', talexio.filter(e => e.isTerminated).length)
console.log('sample ids:', talexio.slice(0, 5).map(e => e.id))

const withTid = local.filter(e => e.talexio_id)
const withCountry = local.filter(e => e.country)
console.log('\n=== LOCAL (', local.length, 'employees ) ===')
console.log('with talexio_id:', withTid.length, '| null talexio_id:', local.length - withTid.length)
console.log('with country set:', withCountry.length)
console.log('is_terminated true:', local.filter(e => e.is_terminated).length)
console.log('details_synced_at set:', local.filter(e => e.details_synced_at).length)
console.log('excluded:', local.filter(e => e.excluded).length)
console.log('sample talexio_id:', local.slice(0, 5).map(e => e.talexio_id))

// 4) The crux: do local talexio_id values match Talexio ids?
const matched = withTid.filter(e => tById.has(String(e.talexio_id)))
console.log('\n=== MATCH CHECK (local.talexio_id -> talexio.id) ===')
console.log('local rows whose talexio_id matches a Talexio id:', matched.length, '/', withTid.length)
const unmatched = withTid.filter(e => !tById.has(String(e.talexio_id))).slice(0, 8)
console.log('unmatched examples (local talexio_id):', unmatched.map(e => `${e.full_name}=${e.talexio_id}`))

// reverse: how many Talexio ids exist among local talexio_ids
const localTidSet = new Set(withTid.map(e => String(e.talexio_id)))
const talexioMatched = talexio.filter(e => localTidSet.has(e.id))
console.log('Talexio employees whose id is a local talexio_id:', talexioMatched.length, '/', talexio.length)
