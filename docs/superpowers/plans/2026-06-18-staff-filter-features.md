# Staff-filter Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-employee filter, Malta/Bulgaria/Other location groups (filter + breakdown), and an exclude-terminated toggle across all four stat pages (Dashboard, Attendance, Leave, Compliance).

**Architecture:** A shared filter module — pure server-side helpers (`src/lib/filters/employeeFilter.ts`) plus reusable client UI controls (`src/components/filters/`) — wired into each page, which reads filters from URL search params (the existing pattern). A new employee-detail sync pulls `country` + `isTerminated` from Talexio into the `employees` table, run nightly by the cron and on demand via an Import-page button.

**Tech Stack:** Next.js 16.2.9 (App Router, server components), React 19, Supabase (Postgres), Talexio GraphQL, Vitest (node env), Tailwind, lucide-react.

## Global Constraints

- Next.js is pinned to **16.2.9**; do not change framework version.
- All Talexio GraphQL calls go through `graphqlUrl()` from `src/lib/talexio/url.ts` (never a bare host or hardcoded URL).
- Never commit secrets; `.env.local` is gitignored.
- Vitest runs in `environment: 'node'` with **no jsdom** — React components are NOT unit-tested; verify UI via `npm run build` + manual smoke. Pure logic IS unit-tested (TDD).
- Test files: `src/**/*.test.ts`, colocated in `__tests__/` dirs (e.g. `src/lib/filters/__tests__/employeeFilter.test.ts`). Imports use `vitest` named imports and the `@/` alias.
- Token is read from the Supabase `talexio_auth` table via `getStoredToken()` (not env).
- The existing `group_type` and `excluded` columns and the WFH/compliance rules are NOT modified. `is_terminated` is the synced termination signal; `excluded` stays the manual hide. Both hide an employee from stats.
- Location-group mapping: `country === "Malta"` → `malta`; `country === "Bulgaria"` → `bulgaria`; anything else incl. `null` → `other`.
- Commit after each task with the message shown in its final step.

---

## File Structure

**Create:**
- `supabase/migrations/20260618_employee_country_terminated.sql` — schema change
- `src/lib/filters/employeeFilter.ts` — pure filter helpers (types + 4 functions)
- `src/lib/filters/__tests__/employeeFilter.test.ts` — tests
- `src/lib/talexio/employee-details.ts` — Talexio detail fetch + pure transforms
- `src/lib/talexio/__tests__/employee-details.test.ts` — tests
- `src/app/api/employees/sync-details/route.ts` — sync route
- `src/components/import/SyncEmployeeDetails.tsx` — manual sync button
- `src/components/filters/EmployeeMultiSelect.tsx` — multi-select control
- `src/components/filters/LocationGroupFilter.tsx` — location chips + breakdown
- `src/components/filters/TerminatedToggle.tsx` — include-terminated checkbox
- `src/components/filters/StatsFilterBar.tsx` — composes the three controls

**Modify:**
- `vercel.json` — add `maxDuration` for the new route
- `src/app/api/attendance/daily-sync/route.ts` — call sync-details after pull
- `src/app/dashboard/import/page.tsx` — mount the manual button
- `src/app/dashboard/page.tsx` + `src/components/dashboard/DashboardFilters.tsx` — Dashboard wiring
- `src/app/dashboard/attendance/page.tsx` + `src/components/attendance/AttendanceFilters.tsx` — Attendance wiring
- `src/app/dashboard/leave/page.tsx` — Leave wiring
- `src/app/dashboard/compliance/page.tsx` — Compliance wiring

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260618_employee_country_terminated.sql`

**Interfaces:**
- Produces: `employees.country` (TEXT, nullable), `employees.is_terminated` (BOOLEAN NOT NULL DEFAULT false), `employees.details_synced_at` (TIMESTAMPTZ, nullable).

- [ ] **Step 1: Write the migration file**

```sql
-- Add country + termination + sync-timestamp to employees.
-- country: the employee's active-position country name from Talexio (e.g. "Malta").
-- is_terminated: synced from Talexio employee.isTerminated.
-- details_synced_at: last time the employee-detail sync ran, for visibility.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS country           TEXT,
  ADD COLUMN IF NOT EXISTS is_terminated     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS details_synced_at TIMESTAMPTZ;
```

- [ ] **Step 2: Apply the migration**

The env only has a read-only DB URL, so apply this manually: paste the SQL into the Supabase SQL editor (or run `supabase db push` if the CLI is configured). The columns are nullable/defaulted, so it is safe and instant.

- [ ] **Step 3: Verify columns exist**

In the Supabase SQL editor run:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'employees' AND column_name IN ('country','is_terminated','details_synced_at');
```
Expected: three rows returned (`country` text nullable, `is_terminated` boolean not-null default false, `details_synced_at` timestamptz nullable).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618_employee_country_terminated.sql
git commit -m "feat(db): add country, is_terminated, details_synced_at to employees"
```

---

## Task 2: Filter helper module (pure functions)

**Files:**
- Create: `src/lib/filters/employeeFilter.ts`
- Test: `src/lib/filters/__tests__/employeeFilter.test.ts`

**Interfaces:**
- Produces:
  - `type LocationGroup = 'malta' | 'bulgaria' | 'other'`
  - `interface FilterableEmployee { id: string; full_name: string; country: string | null; is_terminated: boolean; excluded: boolean }`
  - `interface ParsedFilters { employeeIds: string[]; locations: LocationGroup[]; includeTerminated: boolean }`
  - `function locationGroup(country: string | null): LocationGroup`
  - `function parseFilters(sp: { employees?: string; locations?: string; terminated?: string }): ParsedFilters`
  - `function selectEmployees<T extends FilterableEmployee>(employees: T[], f: ParsedFilters): T[]`
  - `function groupCounts(employees: FilterableEmployee[], includeTerminated: boolean): Record<LocationGroup, number>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/filters/__tests__/employeeFilter.test.ts
import { describe, it, expect } from 'vitest'
import { locationGroup, parseFilters, selectEmployees, groupCounts, type FilterableEmployee } from '../employeeFilter'

function emp(over: Partial<FilterableEmployee> & { id: string }): FilterableEmployee {
  return { full_name: over.id, country: null, is_terminated: false, excluded: false, ...over }
}

describe('locationGroup', () => {
  it('maps Malta and Bulgaria, everything else to other', () => {
    expect(locationGroup('Malta')).toBe('malta')
    expect(locationGroup('Bulgaria')).toBe('bulgaria')
    expect(locationGroup('Spain')).toBe('other')
    expect(locationGroup(null)).toBe('other')
  })
})

describe('parseFilters', () => {
  it('parses empty params to defaults', () => {
    expect(parseFilters({})).toEqual({ employeeIds: [], locations: [], includeTerminated: false })
  })
  it('parses csv employees and locations, ignores invalid locations', () => {
    expect(parseFilters({ employees: 'a,b', locations: 'malta,xyz,other', terminated: '1' }))
      .toEqual({ employeeIds: ['a', 'b'], locations: ['malta', 'other'], includeTerminated: true })
  })
  it('treats terminated other than "1" as false', () => {
    expect(parseFilters({ terminated: '0' }).includeTerminated).toBe(false)
  })
})

describe('selectEmployees', () => {
  const list = [
    emp({ id: 'mt', country: 'Malta' }),
    emp({ id: 'bg', country: 'Bulgaria' }),
    emp({ id: 'es', country: 'Spain' }),
    emp({ id: 'x', country: 'Malta', excluded: true }),
    emp({ id: 'term', country: 'Malta', is_terminated: true }),
  ]
  it('drops excluded and terminated by default', () => {
    expect(selectEmployees(list, parseFilters({})).map(e => e.id)).toEqual(['mt', 'bg', 'es'])
  })
  it('includes terminated when requested (still drops excluded)', () => {
    expect(selectEmployees(list, parseFilters({ terminated: '1' })).map(e => e.id)).toEqual(['mt', 'bg', 'es', 'term'])
  })
  it('filters by location group', () => {
    expect(selectEmployees(list, parseFilters({ locations: 'bulgaria,other' })).map(e => e.id)).toEqual(['bg', 'es'])
  })
  it('filters by employee ids, AND-combined with location', () => {
    expect(selectEmployees(list, parseFilters({ locations: 'malta', employees: 'mt,bg' })).map(e => e.id)).toEqual(['mt'])
  })
})

describe('groupCounts', () => {
  it('counts per group, excluding excluded and (by default) terminated', () => {
    const list = [
      emp({ id: '1', country: 'Malta' }),
      emp({ id: '2', country: 'Malta' }),
      emp({ id: '3', country: 'Bulgaria' }),
      emp({ id: '4', country: 'Spain' }),
      emp({ id: '5', country: 'Malta', excluded: true }),
      emp({ id: '6', country: 'Malta', is_terminated: true }),
    ]
    expect(groupCounts(list, false)).toEqual({ malta: 2, bulgaria: 1, other: 1 })
    expect(groupCounts(list, true)).toEqual({ malta: 3, bulgaria: 1, other: 1 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/filters/__tests__/employeeFilter.test.ts`
Expected: FAIL — `Cannot find module '../employeeFilter'`.

- [ ] **Step 3: Implement the helper**

```typescript
// src/lib/filters/employeeFilter.ts
export type LocationGroup = 'malta' | 'bulgaria' | 'other'

export interface FilterableEmployee {
  id: string
  full_name: string
  country: string | null
  is_terminated: boolean
  excluded: boolean
}

export interface ParsedFilters {
  employeeIds: string[]
  locations: LocationGroup[]
  includeTerminated: boolean
}

const VALID_GROUPS: LocationGroup[] = ['malta', 'bulgaria', 'other']

export function locationGroup(country: string | null): LocationGroup {
  if (country === 'Malta') return 'malta'
  if (country === 'Bulgaria') return 'bulgaria'
  return 'other'
}

function csv(value: string | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

export function parseFilters(sp: { employees?: string; locations?: string; terminated?: string }): ParsedFilters {
  const locations = csv(sp.locations).filter((g): g is LocationGroup => (VALID_GROUPS as string[]).includes(g))
  return {
    employeeIds: csv(sp.employees),
    locations,
    includeTerminated: sp.terminated === '1',
  }
}

export function selectEmployees<T extends FilterableEmployee>(employees: T[], f: ParsedFilters): T[] {
  return employees.filter(e => {
    if (e.excluded) return false
    if (e.is_terminated && !f.includeTerminated) return false
    if (f.locations.length && !f.locations.includes(locationGroup(e.country))) return false
    if (f.employeeIds.length && !f.employeeIds.includes(e.id)) return false
    return true
  })
}

export function groupCounts(employees: FilterableEmployee[], includeTerminated: boolean): Record<LocationGroup, number> {
  const counts: Record<LocationGroup, number> = { malta: 0, bulgaria: 0, other: 0 }
  for (const e of employees) {
    if (e.excluded) continue
    if (e.is_terminated && !includeTerminated) continue
    counts[locationGroup(e.country)]++
  }
  return counts
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/filters/__tests__/employeeFilter.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/filters/employeeFilter.ts src/lib/filters/__tests__/employeeFilter.test.ts
git commit -m "feat(filters): add employee filter helpers (location group, parse, select, counts)"
```

---

## Task 3: Talexio employee-detail fetch + transforms

**Files:**
- Create: `src/lib/talexio/employee-details.ts`
- Test: `src/lib/talexio/__tests__/employee-details.test.ts`

**Interfaces:**
- Consumes: `graphqlUrl()` from `src/lib/talexio/url.ts`.
- Produces:
  - `interface RawPosition { startDate: string | null; endDate: string | null; isActive: boolean; country: { name: string | null } | null }`
  - `interface RawEmployeeDetail { id: string; isTerminated: boolean; positions: RawPosition[] }`
  - `interface DetailUpdate { talexio_id: string; country: string | null; is_terminated: boolean }`
  - `function resolveCountry(positions: RawPosition[]): string | null`
  - `function buildDetailUpdates(details: RawEmployeeDetail[]): DetailUpdate[]`
  - `async function fetchEmployeeDetails(token: string): Promise<RawEmployeeDetail[]>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/talexio/__tests__/employee-details.test.ts
import { describe, it, expect } from 'vitest'
import { resolveCountry, buildDetailUpdates, type RawPosition } from '../employee-details'

function pos(over: Partial<RawPosition>): RawPosition {
  return { startDate: null, endDate: null, isActive: false, country: null, ...over }
}

describe('resolveCountry', () => {
  it('returns null for no positions', () => {
    expect(resolveCountry([])).toBe(null)
  })
  it('uses the active position (isActive) country', () => {
    expect(resolveCountry([
      pos({ startDate: '2024-01-01', endDate: '2025-01-01', isActive: false, country: { name: 'Spain' } }),
      pos({ startDate: '2025-01-02', endDate: null, isActive: true, country: { name: 'Malta' } }),
    ])).toBe('Malta')
  })
  it('treats endDate null as active when isActive flag is absent/false', () => {
    expect(resolveCountry([pos({ startDate: '2025-01-01', endDate: null, country: { name: 'Bulgaria' } })])).toBe('Bulgaria')
  })
  it('falls back to the latest position by startDate when none active', () => {
    expect(resolveCountry([
      pos({ startDate: '2023-01-01', endDate: '2023-12-31', country: { name: 'Spain' } }),
      pos({ startDate: '2024-06-01', endDate: '2024-12-31', country: { name: 'Malta' } }),
    ])).toBe('Malta')
  })
  it('returns null when the resolved position has no country', () => {
    expect(resolveCountry([pos({ startDate: '2025-01-01', endDate: null, country: null })])).toBe(null)
  })
})

describe('buildDetailUpdates', () => {
  it('maps details to upsert rows', () => {
    expect(buildDetailUpdates([
      { id: '1', isTerminated: false, positions: [pos({ endDate: null, isActive: true, country: { name: 'Malta' } })] },
      { id: '2', isTerminated: true, positions: [] },
    ])).toEqual([
      { talexio_id: '1', country: 'Malta', is_terminated: false },
      { talexio_id: '2', country: null, is_terminated: true },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/talexio/__tests__/employee-details.test.ts`
Expected: FAIL — `Cannot find module '../employee-details'`.

- [ ] **Step 3: Implement the module**

```typescript
// src/lib/talexio/employee-details.ts
import { graphqlUrl } from './url'

const DOMAIN = process.env.NEXT_PUBLIC_TALEXIOHR_CLIENT_DOMAIN ?? 'roosterpartners.talexiohr.com'

export interface RawPosition {
  startDate: string | null
  endDate: string | null
  isActive: boolean
  country: { name: string | null } | null
}
export interface RawEmployeeDetail {
  id: string
  isTerminated: boolean
  positions: RawPosition[]
}
export interface DetailUpdate {
  talexio_id: string
  country: string | null
  is_terminated: boolean
}

/** Active position (isActive, or endDate null); else latest by startDate; else null. */
export function resolveCountry(positions: RawPosition[]): string | null {
  if (!positions.length) return null
  const active = positions.find(p => p.isActive) ?? positions.find(p => p.endDate === null)
  const chosen = active ?? [...positions].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))[0]
  return chosen?.country?.name ?? null
}

export function buildDetailUpdates(details: RawEmployeeDetail[]): DetailUpdate[] {
  return details.map(d => ({
    talexio_id: d.id,
    country: resolveCountry(d.positions),
    is_terminated: d.isTerminated,
  }))
}

export async function fetchEmployeeDetails(token: string): Promise<RawEmployeeDetail[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'client-domain': DOMAIN,
    'apollographql-client-name': 'talexio-hr-frontend',
    'apollographql-client-version': '1.0',
  }
  if (token.split('.').length === 3) headers['authorization'] = `Bearer ${token}`
  else headers['talexio-api-token'] = token

  const res = await fetch(graphqlUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query: `query EmployeeDetails {
        employees {
          id
          isTerminated
          positions { ... on EmployeePosition { startDate endDate isActive country { name } } }
        }
      }`,
    }),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (json.error) throw new Error(`Talexio error: ${json.error}`)
  if (json.errors?.length) throw new Error(`Talexio GraphQL error: ${json.errors.map((e: { message: string }) => e.message).join(', ')}`)
  return (json.data?.employees ?? []) as RawEmployeeDetail[]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/talexio/__tests__/employee-details.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/talexio/employee-details.ts src/lib/talexio/__tests__/employee-details.test.ts
git commit -m "feat(talexio): fetch employee details + resolve country/termination"
```

---

## Task 4: Sync-details API route

**Files:**
- Create: `src/app/api/employees/sync-details/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `getStoredToken()` from `src/lib/talexio/token-store`; `fetchEmployeeDetails`, `buildDetailUpdates` from `src/lib/talexio/employee-details`; `createAdminClient()` from `src/lib/supabase/admin`.
- Produces: `POST /api/employees/sync-details` returning `{ ok, updated, terminated, byCountry }`.

- [ ] **Step 1: Implement the route**

```typescript
// src/app/api/employees/sync-details/route.ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStoredToken } from '@/lib/talexio/token-store'
import { fetchEmployeeDetails, buildDetailUpdates } from '@/lib/talexio/employee-details'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  const { token } = await getStoredToken()
  if (!token) {
    return NextResponse.json({ error: 'No Talexio token configured. Paste a fresh token via the Talexio Token panel.' }, { status: 401 })
  }

  const supabase = createAdminClient()

  let details
  try {
    details = await fetchEmployeeDetails(token)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fetch failed' }, { status: 500 })
  }

  const updates = buildDetailUpdates(details)
  const syncedAt = new Date().toISOString()

  // Update only employees that already exist locally (matched by talexio_id).
  let updated = 0
  const byCountry: Record<string, number> = {}
  for (const u of updates) {
    const { data, error } = await supabase
      .from('employees')
      .update({ country: u.country, is_terminated: u.is_terminated, details_synced_at: syncedAt })
      .eq('talexio_id', u.talexio_id)
      .select('id')
    if (error) continue
    if (data && data.length) {
      updated += data.length
      const key = u.country ?? '(none)'
      byCountry[key] = (byCountry[key] ?? 0) + 1
    }
  }

  const terminated = updates.filter(u => u.is_terminated).length
  return NextResponse.json({ ok: true, updated, terminated, byCountry, syncedAt })
}
```

- [ ] **Step 2: Add maxDuration config in vercel.json**

In `vercel.json`, add an entry under `"functions"` (alongside the existing ones):
```json
    "src/app/api/employees/sync-details/route.ts": {
      "maxDuration": 300
    },
```
The `"functions"` object should now contain `import/pull`, `employees/dedupe`, `attendance/daily-sync`, `cleanup`, **and** `employees/sync-details`. Keep valid JSON (commas between entries, none trailing).

- [ ] **Step 3: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds and lists `ƒ /api/employees/sync-details` in the route manifest.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/employees/sync-details/route.ts vercel.json
git commit -m "feat(api): add employee sync-details route"
```

---

## Task 5: Wire sync-details into the nightly cron

**Files:**
- Modify: `src/app/api/attendance/daily-sync/route.ts`

**Interfaces:**
- Consumes: the existing `pullUrl` base-URL derivation; calls `POST /api/employees/sync-details`.

- [ ] **Step 1: Call sync-details after the pull**

In `src/app/api/attendance/daily-sync/route.ts`, inside the `try` block, after `const data = await res.json()` and before the `sync_log` insert, add:

```typescript
    // After clockings/leave, refresh employee country + termination status.
    const detailsUrl = `${protocol}://${host}/api/employees/sync-details`
    let employeeDetails: unknown = null
    try {
      const dres = await fetch(detailsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      employeeDetails = await dres.json()
    } catch (err) {
      employeeDetails = { ok: false, error: err instanceof Error ? err.message : 'sync-details failed' }
    }
```

Then add `employeeDetails` to the success response object so it is visible:
```typescript
    return NextResponse.json({
      ok: res.ok,
      trigger: isVercelCron ? 'cron' : 'manual',
      pullUrl,
      syncedDate: dateStr,
      result: data,
      employeeDetails,
      startedAt,
      finishedAt: new Date().toISOString(),
    })
```

- [ ] **Step 2: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/attendance/daily-sync/route.ts
git commit -m "feat(cron): sync employee details after daily pull"
```

---

## Task 6: Manual "Sync employee details" button

**Files:**
- Create: `src/components/import/SyncEmployeeDetails.tsx`
- Modify: `src/app/dashboard/import/page.tsx`

**Interfaces:**
- Consumes: `POST /api/employees/sync-details`.
- Produces: `SyncEmployeeDetails` default-exported React component.

- [ ] **Step 1: Create the component** (mirrors `RunSyncNow.tsx`)

```tsx
// src/components/import/SyncEmployeeDetails.tsx
'use client'

import { useState } from 'react'
import { Loader2, CheckCircle2, AlertTriangle, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function SyncEmployeeDetails() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleRun() {
    setLoading(true); setError(''); setResult(null)
    try {
      const res = await fetch('/api/employees/sync-details', { method: 'POST' })
      const data = await res.json()
      setResult(data)
      if (!res.ok) setError(data.error ?? 'Sync failed')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">Sync Employee Details</h2>
        <p className="text-xs text-slate-600 mt-0.5">
          Pulls each employee&apos;s country (Malta / Bulgaria / Other) and termination status from Talexio.
          Runs automatically every night; use this for an immediate refresh.
        </p>
      </div>
      <div className="p-4 space-y-3">
        <button onClick={handleRun} disabled={loading}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
          Sync Employee Details
        </button>

        {result && (
          <div className={`rounded-md p-3 ${result.ok ? 'bg-indigo-50' : 'bg-red-50'}`}>
            <p className={`text-xs font-medium ${result.ok ? 'text-indigo-700' : 'text-red-700'}`}>
              {result.ok ? <CheckCircle2 size={12} className="inline mr-1" /> : <AlertTriangle size={12} className="inline mr-1" />}
              {result.ok ? 'Sync complete' : 'Sync failed'}
            </p>
            <pre className="text-[10px] text-slate-700 bg-white/50 rounded p-2 mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
        {error && !result && (
          <div className="rounded-md bg-red-50 p-3">
            <p className="text-xs text-red-600"><AlertTriangle size={12} className="inline mr-1" />{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount it on the Import page**

In `src/app/dashboard/import/page.tsx`, add the import at the top with the other import-component imports:
```tsx
import SyncEmployeeDetails from '@/components/import/SyncEmployeeDetails'
```
And render it in the Tools section, right after `<RunSyncNow />`:
```tsx
      <RunSyncNow />

      <SyncEmployeeDetails />
```

- [ ] **Step 3: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 4: Manual smoke (optional, requires valid token)**

Run `npm run dev`, open `/dashboard/import`, click **Sync Employee Details**. Expected: a green "Sync complete" box with `{ updated, terminated, byCountry }`.

- [ ] **Step 5: Commit**

```bash
git add src/components/import/SyncEmployeeDetails.tsx src/app/dashboard/import/page.tsx
git commit -m "feat(import): add manual Sync Employee Details button"
```

---

## Task 7: EmployeeMultiSelect component

**Files:**
- Create: `src/components/filters/EmployeeMultiSelect.tsx`

**Interfaces:**
- Produces: `EmployeeMultiSelect` default-exported component with props
  `{ employees: { id: string; full_name: string }[]; selected: string[] }`.
  Reads/writes the `employees` URL param (comma-separated) and clears `page`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/filters/EmployeeMultiSelect.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

interface Props {
  employees: { id: string; full_name: string }[]
  selected: string[]
}

export default function EmployeeMultiSelect({ employees, selected }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  function commit(ids: string[]) {
    const next = new URLSearchParams(params.toString())
    if (ids.length) next.set('employees', ids.join(',')); else next.delete('employees')
    next.delete('page')
    router.push(`?${next.toString()}`)
  }

  function toggle(id: string) {
    commit(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  const filtered = search ? employees.filter(e => e.full_name.toLowerCase().includes(search.toLowerCase())) : employees
  const label = selected.length === 0 ? 'All employees' : `${selected.length} selected`

  return (
    <div className="relative w-full sm:w-auto" ref={ref}>
      <div onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 cursor-pointer sm:min-w-[200px] hover:border-slate-300 focus-within:ring-1 focus-within:ring-slate-400">
        <Search size={12} className="text-slate-500 shrink-0" />
        {open
          ? <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="flex-1 outline-none text-xs bg-transparent" />
          : <span className={`flex-1 truncate ${selected.length ? 'text-slate-700' : 'text-slate-500'}`}>{label}</span>}
        {selected.length > 0 && <button onClick={e => { e.stopPropagation(); commit([]) }} className="text-slate-500 hover:text-slate-700"><X size={12} /></button>}
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md border border-slate-200 shadow-md z-50 max-h-56 overflow-y-auto sm:min-w-[220px]">
          <button onClick={() => commit([])} className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${selected.length === 0 ? 'font-medium text-slate-800' : 'text-slate-500'}`}>All employees</button>
          {filtered.map(emp => (
            <label key={emp.id} className={`flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer ${selected.includes(emp.id) ? 'text-indigo-700 bg-indigo-50/50' : 'text-gray-600'}`}>
              <input type="checkbox" checked={selected.includes(emp.id)} onChange={() => toggle(emp.id)} className="accent-indigo-600" />
              <span className="truncate">{emp.full_name}</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-500 text-center">No matches</p>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/filters/EmployeeMultiSelect.tsx
git commit -m "feat(filters): add EmployeeMultiSelect component"
```

---

## Task 8: LocationGroupFilter, TerminatedToggle, StatsFilterBar

**Files:**
- Create: `src/components/filters/LocationGroupFilter.tsx`
- Create: `src/components/filters/TerminatedToggle.tsx`
- Create: `src/components/filters/StatsFilterBar.tsx`

**Interfaces:**
- Consumes: `EmployeeMultiSelect` (Task 7); `type LocationGroup`, types from `employeeFilter` (Task 2).
- Produces:
  - `LocationGroupFilter` props `{ selected: LocationGroup[]; counts: Record<LocationGroup, number> }`
  - `TerminatedToggle` props `{ checked: boolean }`
  - `StatsFilterBar` props `{ employees: { id: string; full_name: string }[]; selectedEmployees: string[]; locations: LocationGroup[]; counts: Record<LocationGroup, number>; includeTerminated: boolean; showLocation?: boolean }`

- [ ] **Step 1: Create LocationGroupFilter**

```tsx
// src/components/filters/LocationGroupFilter.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { LocationGroup } from '@/lib/filters/employeeFilter'

const GROUPS: { value: LocationGroup; label: string }[] = [
  { value: 'malta', label: 'Malta' },
  { value: 'bulgaria', label: 'Bulgaria' },
  { value: 'other', label: 'Other' },
]

interface Props {
  selected: LocationGroup[]
  counts: Record<LocationGroup, number>
}

export default function LocationGroupFilter({ selected, counts }: Props) {
  const router = useRouter()
  const params = useSearchParams()

  function toggle(g: LocationGroup) {
    const next = new URLSearchParams(params.toString())
    const set = selected.includes(g) ? selected.filter(x => x !== g) : [...selected, g]
    if (set.length) next.set('locations', set.join(',')); else next.delete('locations')
    next.delete('page')
    router.push(`?${next.toString()}`)
  }

  return (
    <div className="flex items-center gap-1.5">
      {GROUPS.map(g => {
        const on = selected.includes(g.value)
        return (
          <button key={g.value} onClick={() => toggle(g.value)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            {g.label}
            <span className={`rounded px-1 text-[10px] ${on ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{counts[g.value]}</span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Create TerminatedToggle**

```tsx
// src/components/filters/TerminatedToggle.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Props { checked: boolean }

export default function TerminatedToggle({ checked }: Props) {
  const router = useRouter()
  const params = useSearchParams()

  function toggle() {
    const next = new URLSearchParams(params.toString())
    if (checked) next.delete('terminated'); else next.set('terminated', '1')
    next.delete('page')
    router.push(`?${next.toString()}`)
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={toggle} className="accent-indigo-600" />
      Include terminated
    </label>
  )
}
```

- [ ] **Step 3: Create StatsFilterBar**

```tsx
// src/components/filters/StatsFilterBar.tsx
'use client'

import type { LocationGroup } from '@/lib/filters/employeeFilter'
import EmployeeMultiSelect from './EmployeeMultiSelect'
import LocationGroupFilter from './LocationGroupFilter'
import TerminatedToggle from './TerminatedToggle'

interface Props {
  employees: { id: string; full_name: string }[]
  selectedEmployees: string[]
  locations: LocationGroup[]
  counts: Record<LocationGroup, number>
  includeTerminated: boolean
  showLocation?: boolean
}

export default function StatsFilterBar({ employees, selectedEmployees, locations, counts, includeTerminated, showLocation = true }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EmployeeMultiSelect employees={employees} selected={selectedEmployees} />
      {showLocation && <LocationGroupFilter selected={locations} counts={counts} />}
      <TerminatedToggle checked={includeTerminated} />
    </div>
  )
}
```

- [ ] **Step 4: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/filters/LocationGroupFilter.tsx src/components/filters/TerminatedToggle.tsx src/components/filters/StatsFilterBar.tsx
git commit -m "feat(filters): add location filter, terminated toggle, and StatsFilterBar"
```

---

## Task 9: Dashboard wiring

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/components/dashboard/DashboardFilters.tsx`

**Interfaces:**
- Consumes: `parseFilters`, `selectEmployees`, `groupCounts`, `type FilterableEmployee` (Task 2); `StatsFilterBar` (Task 8).

- [ ] **Step 1: Extend DashboardFilters to render the StatsFilterBar**

In `src/components/dashboard/DashboardFilters.tsx`:

(a) Add imports at the top, and switch the `next/navigation` import to also bring in `useSearchParams` (SSR-safe; avoids hydration mismatch from reading `window`):
```tsx
import { useRouter, useSearchParams } from 'next/navigation'
import StatsFilterBar from '@/components/filters/StatsFilterBar'
import { parseFilters, type LocationGroup } from '@/lib/filters/employeeFilter'

interface Employee { id: string; full_name: string }
```

(b) Change the component signature + props to carry the new filter inputs:
```tsx
export default function DashboardFilters({ employees, counts, defaults }: {
  employees: Employee[]
  counts: Record<LocationGroup, number>
  defaults: { from: string; to: string; period: string }
}) {
```

(c) Remove the single-employee state and dropdown. Delete: the `empId` state, `search`/`open`/`ref` state, the `changeEmp` function, the click-outside `useEffect`, `selectedName`, `filtered`, and the entire "Employee search" `<div className="relative ...">` block. Add `const params = useSearchParams()` near the top of the component body. Update `nav`, `changePeriod`, and `step` to drop the employee argument and build from `params`:
```tsx
  function nav(f: string, t: string, p: Period) {
    const cur = new URLSearchParams(params.toString())
    cur.set('from', f); cur.set('to', t); cur.set('period', p)
    router.push(`/dashboard?${cur.toString()}`)
  }
  function changePeriod(p: Period) { const [f, t] = rangeForPeriod(p, new Date()); setPeriod(p); setFrom(f); setTo(t); nav(f, t, p) }
  function step(dir: 1 | -1) {
    const anchor = stepPeriod(period, from, dir); const today = new Date(); today.setHours(0, 0, 0, 0)
    if (dir === 1 && anchor > today) return
    const [f, t] = rangeForPeriod(period, anchor); setFrom(f); setTo(t); nav(f, t, period)
  }
```
(Date inputs: change their `onChange` to `nav(e.target.value, to, period)` / `nav(from, e.target.value, period)`.)

(d) Compute current filter values from the URL (SSR-safe via `useSearchParams`) and render the StatsFilterBar where the employee `<div>` used to be. Inside the component body add:
```tsx
  const pf = parseFilters(Object.fromEntries(params))
```
Replace the removed employee `<div>` with:
```tsx
        <StatsFilterBar
          employees={employees}
          selectedEmployees={pf.employeeIds}
          locations={pf.locations}
          counts={counts}
          includeTerminated={pf.includeTerminated}
        />
```

- [ ] **Step 2: Update the Dashboard page to use the shared filter**

In `src/app/dashboard/page.tsx`:

(a) Add imports:
```tsx
import { parseFilters, selectEmployees, groupCounts, type FilterableEmployee } from '@/lib/filters/employeeFilter'
```

(b) Extend `searchParams` type to include the new params:
```tsx
  searchParams: Promise<{
    from?: string
    to?: string
    period?: string
    employees?: string
    locations?: string
    terminated?: string
  }>
```

(c) Replace the `empFilter` line and the employees query. Delete `const empFilter = sp.employee ?? ''`. Change the employees load to fetch the filter columns and NOT pre-filter on excluded (the helper handles it):
```tsx
  const { data: employeesRaw } = await supabase
    .from('employees')
    .select('id, full_name, country, is_terminated, excluded')
    .order('last_name')
  const allEmployees = (employeesRaw ?? []) as FilterableEmployee[]

  const filters = parseFilters(sp)
  const effective = selectEmployees(allEmployees, filters)
  const effectiveIds = effective.map(e => e.id)
  const counts = groupCounts(allEmployees, filters.includeTerminated)
```

(d) Replace the records query to scope by the effective ids:
```tsx
  const { data: records } = await supabase
    .from('attendance_records')
    .select('*, employees!inner(id, full_name)')
    .gte('date', from).lte('date', to)
    .in('employee_id', effectiveIds.length ? effectiveIds : ['__none__'])
    .order('date')
```
(The `__none__` sentinel returns zero rows when no employees match, instead of all rows.)

(e) Replace downstream uses of `emps` and `empFilter`:
- `const emps = employees ?? []` → `const emps = effective`
- `const empCount = empFilter ? emps.filter(e => e.id === empFilter).length : emps.length` → `const empCount = emps.length`
- `const gridEmps = empFilter ? emps.filter(e => e.id === empFilter) : emps` → `const gridEmps = emps`
- `const selectedEmpName = empFilter ? emps.find(...)?.full_name : null` → `const selectedEmpName = filters.employeeIds.length === 1 ? emps.find(e => e.id === filters.employeeIds[0])?.full_name : null`

(f) Update the `<DashboardFilters .../>` usage. The multi-select must list *selectable* people (not the already-filtered effective set), so pass all non-excluded employees, honoring the terminated toggle. Add this before the return:
```tsx
  const pickable = allEmployees
    .filter(e => !e.excluded && (filters.includeTerminated || !e.is_terminated))
    .map(e => ({ id: e.id, full_name: e.full_name }))
```
Then render:
```tsx
      <DashboardFilters employees={pickable} counts={counts} defaults={{ from, to, period }} />
```

- [ ] **Step 3: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 4: Manual smoke**

`npm run dev` → `/dashboard`. Verify: multi-select picks several employees and stats update; Malta/Bulgaria/Other chips show counts and filter; "Include terminated" toggles terminated staff in/out. URL reflects `employees`, `locations`, `terminated`.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx src/components/dashboard/DashboardFilters.tsx
git commit -m "feat(dashboard): multi-employee, location groups, terminated toggle"
```

---

## Task 10: Attendance wiring

**Files:**
- Modify: `src/app/dashboard/attendance/page.tsx`
- Modify: `src/components/attendance/AttendanceFilters.tsx`

**Interfaces:**
- Consumes: `parseFilters`, `selectEmployees`, `groupCounts`, `type FilterableEmployee` (Task 2); `StatsFilterBar` (Task 8).

- [ ] **Step 1: Update AttendanceFilters to use the shared bar**

Replace the body of `src/components/attendance/AttendanceFilters.tsx` so it keeps the date + status controls but swaps the single employee `<select>` for `StatsFilterBar`:

```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import StatsFilterBar from '@/components/filters/StatsFilterBar'
import { parseFilters, type LocationGroup } from '@/lib/filters/employeeFilter'

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'office', label: 'Office' },
  { value: 'wfh', label: 'WFH' },
  { value: 'remote', label: 'Remote' },
  { value: 'no_clocking', label: 'No Clocking' },
  { value: 'vacation', label: 'Leave' },
  { value: 'active', label: 'Active' },
  { value: 'broken', label: 'Broken' },
]

interface Props {
  employees: { id: string; full_name: string }[]
  counts: Record<LocationGroup, number>
}

export default function AttendanceFilters({ employees, counts }: Props) {
  const router = useRouter()
  const params = useSearchParams()

  const update = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value); else next.delete(key)
    next.delete('page')
    router.push(`?${next.toString()}`)
  }, [params, router])

  const inputClass = 'rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 w-full sm:w-auto'
  const pf = parseFilters(Object.fromEntries(params))

  return (
    <div className="flex flex-col sm:flex-row flex-wrap gap-2">
      <input type="date" defaultValue={params.get('from') ?? ''} onChange={e => update('from', e.target.value)} className={inputClass} />
      <input type="date" defaultValue={params.get('to') ?? ''} onChange={e => update('to', e.target.value)} className={inputClass} />
      <select defaultValue={params.get('status') ?? ''} onChange={e => update('status', e.target.value)} className={inputClass}>
        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <StatsFilterBar
        employees={employees}
        selectedEmployees={pf.employeeIds}
        locations={pf.locations}
        counts={counts}
        includeTerminated={pf.includeTerminated}
      />
    </div>
  )
}
```

- [ ] **Step 2: Update the Attendance page**

In `src/app/dashboard/attendance/page.tsx`:

(a) Add import:
```tsx
import { parseFilters, selectEmployees, groupCounts, type FilterableEmployee } from '@/lib/filters/employeeFilter'
```
(b) Extend `searchParams` type: replace `employee?: string` with `employees?: string; locations?: string; terminated?: string`.
(c) Remove `const empId = sp.employee ?? ''`. Load employees with filter columns and compute the effective set:
```tsx
  const { data: employeesRaw } = await supabase
    .from('employees')
    .select('id, full_name, country, is_terminated, excluded')
    .order('last_name')
  const allEmployees = (employeesRaw ?? []) as FilterableEmployee[]
  const filters = parseFilters(sp)
  const effective = selectEmployees(allEmployees, filters)
  const effectiveIds = effective.map(e => e.id)
  const counts = groupCounts(allEmployees, filters.includeTerminated)
  const pickable = allEmployees
    .filter(e => !e.excluded && (filters.includeTerminated || !e.is_terminated))
    .map(e => ({ id: e.id, full_name: e.full_name }))
```
(d) Scope BOTH the records query and the stats query to `effectiveIds`. In the records query, replace `if (empId) query = query.eq('employee_id', empId)` with:
```tsx
  query = query.in('employee_id', effectiveIds.length ? effectiveIds : ['__none__'])
```
For the stats query, add the same `.in(...)`:
```tsx
  const { data: statsData } = await supabase
    .from('attendance_records').select('status')
    .in('employee_id', effectiveIds.length ? effectiveIds : ['__none__'])
    .gte('date', from).lte('date', to).then(r => r)
```
(e) Set `stats.total` to the effective count: `total: effective.length`.
(f) Update the filter usage: `<AttendanceFilters employees={pickable} counts={counts} />`.
(g) Fix the pagination `baseHref` (line ~141) to carry the new params instead of `employee`:
```tsx
          const carry = new URLSearchParams()
          carry.set('from', from); carry.set('to', to)
          if (filters.employeeIds.length) carry.set('employees', filters.employeeIds.join(','))
          if (filters.locations.length) carry.set('locations', filters.locations.join(','))
          if (filters.includeTerminated) carry.set('terminated', '1')
          if (status) carry.set('status', status)
          const baseHref = `?${carry.toString()}`
```

- [ ] **Step 3: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 4: Manual smoke**

`/dashboard/attendance` — multi-select + location chips + terminated toggle filter the table and stat cards; pagination preserves filters.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/attendance/page.tsx src/components/attendance/AttendanceFilters.tsx
git commit -m "feat(attendance): multi-employee, location groups, terminated toggle"
```

---

## Task 11: Leave wiring

**Files:**
- Modify: `src/app/dashboard/leave/page.tsx`

**Interfaces:**
- Consumes: `parseFilters`, `selectEmployees`, `groupCounts`, `type FilterableEmployee` (Task 2); `StatsFilterBar` (Task 8).

- [ ] **Step 1: Add filters to the Leave page**

In `src/app/dashboard/leave/page.tsx`:

(a) Replace the imports/signature to accept `searchParams` and the helpers:
```tsx
import { createAdminClient } from '@/lib/supabase/admin'
import { format, subDays } from 'date-fns'
import StatsFilterBar from '@/components/filters/StatsFilterBar'
import { parseFilters, selectEmployees, groupCounts, type FilterableEmployee } from '@/lib/filters/employeeFilter'

export const dynamic = 'force-dynamic'

interface PageProps { searchParams: Promise<{ employees?: string; locations?: string; terminated?: string }> }

export default async function LeavePage({ searchParams }: PageProps) {
  const sp = await searchParams
  const supabase = createAdminClient()
  const to   = format(new Date(), 'yyyy-MM-dd')
  const from = format(subDays(new Date(), 29), 'yyyy-MM-dd')
```

(b) Replace the active-employee block with the effective set:
```tsx
  const { data: employeesRaw } = await supabase
    .from('employees')
    .select('id, full_name, country, is_terminated, excluded')
    .order('last_name')
  const allEmployees = (employeesRaw ?? []) as FilterableEmployee[]
  const filters = parseFilters(sp)
  const effective = selectEmployees(allEmployees, filters)
  const effectiveIds = effective.length ? effective.map(e => e.id) : ['__none__']
  const counts = groupCounts(allEmployees, filters.includeTerminated)
  const pickable = allEmployees
    .filter(e => !e.excluded && (filters.includeTerminated || !e.is_terminated))
    .map(e => ({ id: e.id, full_name: e.full_name }))
```
(c) Replace both `.in('employee_id', activeIds)` occurrences with `.in('employee_id', effectiveIds)`.
(d) Render the filter bar just below the header `<div>` (before the stat-cards grid):
```tsx
      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <StatsFilterBar
          employees={pickable}
          selectedEmployees={filters.employeeIds}
          locations={filters.locations}
          counts={counts}
          includeTerminated={filters.includeTerminated}
        />
      </div>
```

- [ ] **Step 2: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 3: Manual smoke**

`/dashboard/leave` — filter bar present; selecting employees / location groups / terminated updates the leave table and the Vacation/Sick/Total cards.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/leave/page.tsx
git commit -m "feat(leave): add employee, location, and terminated filters"
```

---

## Task 12: Compliance wiring

**Files:**
- Modify: `src/app/dashboard/compliance/page.tsx`

**Interfaces:**
- Consumes: `parseFilters`, `selectEmployees`, `groupCounts`, `type FilterableEmployee` (Task 2); `StatsFilterBar` (Task 8). Renders `StatsFilterBar` with `showLocation={false}` (Compliance is inherently Malta-office).

- [ ] **Step 1: Add multi-employee + terminated filters (no location)**

In `src/app/dashboard/compliance/page.tsx`:

(a) Add imports and extend the `Emp` type with the filter columns:
```tsx
import StatsFilterBar from '@/components/filters/StatsFilterBar'
import { parseFilters, selectEmployees, groupCounts, type FilterableEmployee } from '@/lib/filters/employeeFilter'
```
```tsx
type Emp = { id: string; full_name: string; group_type: string | null; unit: string | null; country: string | null; is_terminated: boolean; excluded: boolean }
```
(b) Extend `searchParams`: `searchParams: Promise<{ month?: string; employees?: string; terminated?: string }>`.
(c) Replace the employees query (keep the `office_malta` scope, drop the `excluded` pre-filter so the helper handles excluded + terminated) and apply the filter:
```tsx
  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name, group_type, unit, country, is_terminated, excluded')
    .eq('group_type', 'office_malta').order('last_name')
  const allMalta = (employees ?? []) as Emp[]
  const filters = parseFilters(sp)
  const emps: Emp[] = selectEmployees(allMalta, filters)
  const counts = groupCounts(allMalta, filters.includeTerminated)
  const pickable = allMalta
    .filter(e => !e.excluded && (filters.includeTerminated || !e.is_terminated))
    .map(e => ({ id: e.id, full_name: e.full_name }))
```
(Delete the old `const emps: Emp[] = employees ?? []` line.)
(d) Render the filter bar next to the existing `ComplianceFilters` (month picker). Replace the header's right-hand control block:
```tsx
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <StatsFilterBar
            employees={pickable}
            selectedEmployees={filters.employeeIds}
            locations={filters.locations}
            counts={counts}
            includeTerminated={filters.includeTerminated}
            showLocation={false}
          />
          <ComplianceFilters currentMonth={selectedMonth} />
        </div>
```
(Note: `counts` is still passed but unused by the bar because `showLocation={false}`; that is fine.)

- [ ] **Step 2: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 3: Manual smoke**

`/dashboard/compliance` — employee multi-select + "Include terminated" present (no location chips); month picker still works; terminated Malta-office staff excluded by default.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/compliance/page.tsx
git commit -m "feat(compliance): multi-employee + terminated filters (no location)"
```

---

## Task 13: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all suites pass (existing 86 + the new `employeeFilter` and `employee-details` tests).

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit && npx eslint . && npm run build`
Expected: tsc clean; eslint 0 errors; build succeeds.

- [ ] **Step 3: End-to-end manual smoke (requires applied migration + a sync)**

With the migration applied and "Sync Employee Details" run once: confirm Dashboard, Attendance, Leave, and Compliance each honor multi-employee selection, the terminated toggle, and (except Compliance) the Malta/Bulgaria/Other filter + breakdown counts.

- [ ] **Step 4: Push**

```bash
git push origin dev
```

---

## Notes for the implementer

- **Migration must be applied** (Task 1, Step 2) before the new columns exist. Until then, the pages still build and run, but every employee resolves to `country = null` (→ "Other") and `is_terminated = false`. Select columns will error only if the migration was not applied — apply it first.
- The `__none__` sentinel in `.in('employee_id', ...)` avoids Supabase returning all rows when the id list is empty.
- Client components read current filter state from `useSearchParams()`; server pages read from the awaited `searchParams`. Both feed the same `parseFilters` shape.
- Do not remove or repurpose `group_type` / `excluded`; they remain in use.
