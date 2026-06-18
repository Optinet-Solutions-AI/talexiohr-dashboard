# Staff-filter features — design

**Date:** 2026-06-18
**Status:** Approved (design); pending implementation plan

## Overview

Client request (via Christian) for three additions to the dashboard:

1. **Filter by multiple employees** — select more than one employee at a time.
2. **Location groups** — group/filter statistics by employee location: **Malta**, **Bulgaria**, **Other**.
3. **Exclude terminated employees** from statistics.

All three are confirmed feasible against Talexio's GraphQL API. The required
fields exist on the `employees` query:
- Termination: `employee.isTerminated` (boolean).
- Country: `employee.positions { ... on EmployeePosition { startDate endDate isActive country { name } } }`
  — `country.name` yields "Malta" / "Bulgaria" / etc.; the current position has
  `endDate: null` / `isActive: true`.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Scope | All stat pages: Dashboard, Attendance, Compliance, Leave |
| Multi-employee filter | Single-select → multi-select |
| Location groups | Filter (multi-select) **and** per-group headcount breakdown |
| Terminated | Excluded by default, with an "Include terminated" toggle |
| Sync | New employee-master sync (country + isTerminated): nightly cron **and** a manual button |
| Architecture | Shared filter module + per-page wiring (vs duplication / client context) |
| Compliance carve-out | Compliance gets terminated-exclusion + multi-employee; **no** location filter there (it is inherently Malta-office, so location grouping is a no-op) |

## Architecture

Approach **A**: a shared filter module (server-side resolution helper + reusable
UI controls) wired into each page. This fits the existing pattern — pages are
server components that read filters from URL search params (shareable,
bookmarkable URLs) — and avoids duplicating fiddly multi-select/filter logic
across four pages.

## Data model

New migration (additive; nothing dropped or altered destructively):

```sql
ALTER TABLE employees
  ADD COLUMN country           TEXT,                       -- active-position country from Talexio, e.g. "Malta"
  ADD COLUMN is_terminated     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN details_synced_at TIMESTAMPTZ;                -- last employee-detail sync, for visibility
```

- The existing `group_type` (`office_malta` / `remote` / `unclassified`) and
  `excluded` columns are **left untouched**. They remain manual and keep driving
  WFH/compliance logic. `is_terminated` is the *synced* termination signal;
  `excluded` remains the *manual* hide. Both hide an employee from stats.
- **Location group is derived in code, not stored**, so the mapping rule can
  change without re-syncing:
  - `country === "Malta"` → `"malta"`
  - `country === "Bulgaria"` → `"bulgaria"`
  - anything else, including `null` → `"other"`

Graceful degradation: until the migration is applied and a first sync runs,
every employee resolves to `country = null` → "Other" and `is_terminated =
false`. Nothing breaks.

## Employee-detail sync

**Module** `src/lib/talexio/employee-details.ts`:
- `fetchEmployeeDetails(token)` — runs, via `graphqlUrl()`:
  ```graphql
  query { employees { id isTerminated positions { ... on EmployeePosition { startDate endDate isActive country { name } } } } }
  ```
- `resolveCountry(positions)` — picks the active position (`isActive === true`,
  or `endDate === null`); if none, the latest by `startDate`; else `null`.
  Returns `country.name ?? null`.

**Route** `POST /api/employees/sync-details`:
- Resolves the token from the store (`getStoredToken`).
- Fetches details, computes `country` + `is_terminated` per employee.
- Upserts `country`, `is_terminated`, `details_synced_at` into `employees`,
  matched by `talexio_id`.
- Returns `{ updated, terminated, byCountry }`.
- Added to `vercel.json` with `maxDuration: 300`.

**Wiring:**
- Called at the end of the nightly `daily-sync` cron (after the clockings/leave
  pull).
- Exposed as a manual **"Sync employee details"** button on the Import page.

## Filter layer (shared)

### URL params (extend existing `from` / `to` / `period`)

| Param | Meaning | Default |
|---|---|---|
| `employees` | comma-separated employee ids (multi-select) | empty = all |
| `locations` | subset of `malta,bulgaria,other` | empty = all groups |
| `terminated` | `1` = include terminated | absent = exclude |

The old single `employee` param is replaced by `employees`.

### Server helper `src/lib/filters/employeeFilter.ts` (pure functions)

- `parseFilters(searchParams)` → `{ employeeIds: string[], locations: LocationGroup[], includeTerminated: boolean }`
- `locationGroup(country: string | null)` → `'malta' | 'bulgaria' | 'other'`
- `selectEmployees(allEmployees, filters)` → applies, in order:
  1. drop `excluded`
  2. drop `is_terminated` unless `includeTerminated`
  3. keep only employees whose derived group is in `locations` (if any specified)
  4. keep only employees in `employeeIds` (if any specified)

  Returns the effective employee list + their ids.
- `groupCounts(allEmployees, includeTerminated)` → `{ malta, bulgaria, other }`
  headcounts for the breakdown (respects the terminated toggle; ignores
  excluded).

Each page: load employees (now incl. `country`, `is_terminated`) →
`selectEmployees` → query `attendance_records` scoped to the resulting ids →
compute stats/charts/grid from that set.

### UI components `src/components/filters/`

- `EmployeeMultiSelect` — searchable checkbox dropdown; shows "All employees" /
  "N selected". The option list respects the terminated toggle (terminated
  hidden unless toggled on), but is **independent of the location filter** — you
  can pick any employee regardless of which location groups are selected. When
  both an employee selection and a location selection are active, they combine
  with AND (an employee must satisfy both to be counted).
- `LocationGroupFilter` — three toggle chips (Malta / Bulgaria / Other), each
  showing its headcount from `groupCounts` (the breakdown).
- `TerminatedToggle` — "Include terminated" checkbox.
- `StatsFilterBar` — composes the three; accepts flags for which to show (e.g.
  `showLocation={false}` for Compliance).
- All push to URL params via `router`, matching the existing
  [DashboardFilters](../../../src/components/dashboard/DashboardFilters.tsx) pattern.

## Per-page wiring

- **Dashboard** ([dashboard/page.tsx](../../../src/app/dashboard/page.tsx)) —
  refactor [DashboardFilters](../../../src/components/dashboard/DashboardFilters.tsx)
  to add `StatsFilterBar` beside the existing period/date controls. Stats,
  charts, and grid use the effective set.
- **Attendance** — add `StatsFilterBar`; keep its status filter + date range.
  Multi-employee replaces the single picker.
- **Leave** — currently fixed 30-day with no filters; add `StatsFilterBar`.
  Scope leave stats to the effective employees.
- **Compliance** — add `StatsFilterBar` with `showLocation={false}`; keep month
  picker + the inherent `office_malta` scope; multi-employee + terminated toggle
  apply.

## Migration application

The environment has only a read-only DB URL, so the `ALTER TABLE` cannot be run
from the codebase tooling. The migration file is added to
`supabase/migrations/`; the **user applies it** via the Supabase SQL editor (or
`supabase db push`). The columns are nullable/defaulted, so it is a safe, instant
migration.

## Testing

Vitest, TDD (pure functions first):
- `employeeFilter.ts`: `parseFilters`, `locationGroup` (Malta / Bulgaria / null /
  other), `selectEmployees` (excluded, terminated default + toggle, location
  subset, employee subset, combinations), `groupCounts`.
- `resolveCountry` (active position / fallback to latest / empty → null).
- Sync-route transform with a mocked fetch (pure mapping → upsert payload).
- Then: full `next build` + test suite green, plus a manual smoke test of the
  Dashboard filters.

## Out of scope

- Changing the existing `group_type` semantics or the WFH/compliance rules.
- A location filter on the Compliance page (no-op there).
- Backfilling historical termination/country state (we sync current state only).
- exceljs/library swaps or other unrelated refactors.
