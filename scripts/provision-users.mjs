// Provision dashboard accounts in Supabase Auth.
//
//   node scripts/provision-users.mjs --admin a@x.com,b@x.com --user c@y.com,d@y.com [--disable-others] [--dry-run]
//
// For every listed email: creates the account if missing (or updates it if it
// exists), sets a fresh random temporary password, confirms the email, lifts
// any ban, and stamps app_metadata { role, must_change_password: true }. The
// proxy forces a password change on first sign-in.
//
// --disable-others bans every other existing account that is not an admin.
// --dry-run prints the plan without touching anything (and without passwords).
//
// Temporary passwords are printed once, to stdout, and nowhere else.
// Requires Node 22.6+ (imports the TS policy module via type stripping).

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { generateTemporaryPassword, validatePassword } from '../src/lib/auth/password.ts'

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)
  if (m) env[m[1]] = m[2]
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  process.exit(1)
}

const args = process.argv.slice(2)
function listArg(flag) {
  const i = args.indexOf(flag)
  if (i === -1 || !args[i + 1]) return []
  return args[i + 1].split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
}
const admins = listArg('--admin')
const users = listArg('--user')
const disableOthers = args.includes('--disable-others')
const dryRun = args.includes('--dry-run')

const targets = new Map()
for (const email of users) targets.set(email, 'user')
for (const email of admins) targets.set(email, 'admin') // admin wins if listed twice
if (targets.size === 0) {
  console.error('Nothing to do: pass --admin and/or --user with comma-separated emails')
  process.exit(1)
}

// Effectively permanent; Supabase has no "disabled" flag, only ban_duration.
const PERMANENT_BAN = '876000h'

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function listAllUsers() {
  const all = []
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    all.push(...data.users)
    if (data.users.length < 1000) break
  }
  return all
}

const existing = await listAllUsers()
const byEmail = new Map(existing.map((u) => [u.email?.toLowerCase(), u]))

const results = []
for (const [email, role] of targets) {
  const current = byEmail.get(email)
  const password = generateTemporaryPassword()
  if (validatePassword(password).length) throw new Error('generated password failed policy')
  const appMetadata = { ...(current?.app_metadata ?? {}), role, must_change_password: true }

  if (dryRun) {
    results.push({ email, role, action: current ? 'would update' : 'would create', password: '(dry run)' })
    continue
  }

  if (current) {
    const { error } = await supabase.auth.admin.updateUserById(current.id, {
      password,
      email_confirm: true,
      ban_duration: 'none',
      app_metadata: appMetadata,
    })
    if (error) { results.push({ email, role, action: `UPDATE FAILED: ${error.message}`, password: '' }); continue }
    results.push({ email, role, action: 'updated', password })
  } else {
    const { error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMetadata,
    })
    if (error) { results.push({ email, role, action: `CREATE FAILED: ${error.message}`, password: '' }); continue }
    results.push({ email, role, action: 'created', password })
  }
}

const disabled = []
if (disableOthers) {
  for (const u of existing) {
    const email = u.email?.toLowerCase()
    if (!email || targets.has(email)) continue
    if (u.app_metadata?.role === 'admin') { disabled.push({ email, action: 'kept (admin)' }); continue }
    if (u.banned_until && new Date(u.banned_until) > new Date()) { disabled.push({ email, action: 'already disabled' }); continue }
    if (dryRun) { disabled.push({ email, action: 'would disable' }); continue }
    const { error } = await supabase.auth.admin.updateUserById(u.id, { ban_duration: PERMANENT_BAN })
    disabled.push({ email, action: error ? `DISABLE FAILED: ${error.message}` : 'disabled' })
  }
}

const pad = (s, n) => String(s).padEnd(n)
console.log(dryRun ? '\nDRY RUN — no changes made\n' : '\nAccounts\n')
console.log(`${pad('email', 40)} ${pad('role', 6)} ${pad('action', 10)} temporary password`)
console.log('-'.repeat(90))
for (const r of results) console.log(`${pad(r.email, 40)} ${pad(r.role, 6)} ${pad(r.action, 10)} ${r.password}`)

if (disableOthers) {
  console.log('\nOther existing accounts\n')
  if (disabled.length === 0) console.log('(none)')
  for (const d of disabled) console.log(`${pad(d.email, 40)} ${d.action}`)
}
console.log('')
