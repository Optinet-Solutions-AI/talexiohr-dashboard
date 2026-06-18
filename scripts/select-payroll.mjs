// With a valid token, try to (1) list payrolls and (2) select one via a mutation,
// then (3) confirm the employees query unblocks. Token via TALEXIO_PROBE_TOKEN.
import fs from 'node:fs'
const envText = fs.readFileSync('.env.local', 'utf8')
const env = {}
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/); if (m) env[m[1]] = m[2] }
const GQL_URL = env.NEXT_PUBLIC_TALEXIOHR_API_URL || 'https://api.talexiohr.com/graphql'
const DOMAIN  = env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN || 'roosterpartners.talexiohr.com'
const token = process.env.TALEXIO_PROBE_TOKEN.trim()
function hdr() {
  const isJwt = token.split('.').length === 3
  const h = { 'Content-Type': 'application/json', 'client-domain': DOMAIN,
    'apollographql-client-name': 'talexio-hr-frontend', 'apollographql-client-version': '1.0' }
  if (isJwt) h['authorization'] = `Bearer ${token}`; else h['talexio-api-token'] = token
  return h
}
async function gql(query, variables) {
  const res = await fetch(GQL_URL, { method: 'POST', headers: hdr(), body: JSON.stringify({ query, variables }) })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
function show(label, r) {
  const e = r.json.error || (r.json.errors?.length ? r.json.errors.map(x => x.message).join(' | ') : null)
  console.log(`${label}: ${r.status} ${e ? 'ERR ' + e.slice(0,140) : 'OK ' + JSON.stringify(r.json.data).slice(0,300)}`)
  return r
}

const year = new Date().getUTCFullYear()
console.log('--- listing attempts ---')
const a = show('payrolls(year)', await gql(`query($y:Int!){ payrolls(year:$y){ id name status } }`, { y: year }))
const b = show('payrolls(year-1)', await gql(`query($y:Int!){ payrolls(year:$y){ id name status } }`, { y: year - 1 }))
const c = show('payrollDetails', await gql(`query { payrollDetails { id name } }`))
const d = show('currentUser/me', await gql(`query { me { id } }`))

// gather any ids found
let ids = []
for (const r of [a, b, c]) {
  const data = r.json.data || {}
  for (const k of Object.keys(data)) {
    const v = data[k]
    if (Array.isArray(v)) ids.push(...v.filter(x => x?.id).map(x => x.id))
  }
}
ids = [...new Set(ids)]
console.log('\npayroll ids found:', JSON.stringify(ids))

if (ids.length) {
  console.log('\n--- trying select mutations with first id', ids[0], '---')
  const id = ids[0]
  const muts = [
    [`mutation($id:ID!){ selectPayroll(id:$id){ id } }`, { id }],
    [`mutation($id:ID!){ selectPayrolls(ids:[$id]){ id } }`, { id }],
    [`mutation($ids:[ID!]!){ selectPayrolls(ids:$ids){ id } }`, { ids: [id] }],
    [`mutation($id:ID!){ setSelectedPayroll(id:$id){ id } }`, { id }],
    [`mutation($ids:[ID!]!){ setSelectedPayrolls(payrollIds:$ids) }`, { ids: [id] }],
  ]
  for (const [q, v] of muts) {
    const r = await gql(q, v)
    show('  ' + q.slice(9, 40), r)
  }
  console.log('\n--- re-test employees after selection attempts ---')
  show('employees', await gql(`query { employees { id fullName } }`))
}
