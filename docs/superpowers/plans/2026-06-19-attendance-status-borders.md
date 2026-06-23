# Attendance Status Classification + Grid Borders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify a day as "office" when the clock-in OR clock-out is at the office, show a red grid border for in/out location mismatches, and merge "Broken Clocking" + "No Clock-out" into one yellow-border "incomplete" concept colored by location.

**Architecture:** A new pure, tested helper (`src/lib/attendance/location.ts`) centralizes office detection, status classification, and anomaly derivation. The daily sync and the reclassify route use it for the symmetric office rule (no more `active`/`broken`). The dashboard grid + stat cards derive red/yellow borders at render time from already-stored fields — no DB migration.

**Tech Stack:** Next.js 16.2.9 (App Router, server components), React 19, Supabase (Postgres), Vitest (node env), Tailwind.

## Global Constraints

- Office rule: a clocked day is `office` if clock-in **or** clock-out is at the office; otherwise `wfh` (Malta group) / `remote`.
- Office detection = name match (`"head office"`, `"office"`, `"ta office"`) OR GPS within **0.15 km** of (35.9222072, 14.4878368). Keep these exact values.
- Red border = both timestamps present AND clock-in office-ness ≠ clock-out office-ness. Yellow border = exactly one of clock-in/clock-out present. The two are mutually exclusive.
- Do NOT emit `active` or `broken` statuses anymore. Keep `office`/`wfh`/`remote`/`no_clocking`/`vacation`/`sick`/`unknown`.
- No new DB columns — anomalies are derived at render.
- Vitest runs in `environment: 'node'` with no jsdom — React components are NOT unit-tested; verify UI via `npm run build`. Pure helpers ARE unit-tested (TDD).
- Tests colocated in `__tests__/`, `vitest` named imports, `@/` alias.
- Commit after each task with the message in its final step.

---

## File Structure

**Create:**
- `src/lib/attendance/location.ts` — pure helpers: `isOfficeLocation`, `classifyClockedStatus`, `dayAnomalies` (+ exported `OFFICE_LAT/LNG/KM`)
- `src/lib/attendance/__tests__/location.test.ts` — unit tests

**Modify:**
- `src/app/api/import/pull/route.ts` — `saveClockings` uses the helper; drop local office helpers + the `active` status
- `src/app/api/import/reclassify/route.ts` — use the helper; reclassify `broken`/`active` instead of skipping them
- `src/components/dashboard/AttendanceGrid.tsx` — remove amber/orange statuses; red/yellow cell borders; legend
- `src/app/dashboard/page.tsx` — grid builder + stat cards use the helper; drop local office helpers
- `src/components/attendance/AttendanceFilters.tsx` — drop dead `active`/`broken` status options

---

## Task 1: Shared attendance-location helper

**Files:**
- Create: `src/lib/attendance/location.ts`
- Test: `src/lib/attendance/__tests__/location.test.ts`

**Interfaces:**
- Produces:
  - `OFFICE_LAT: number`, `OFFICE_LNG: number`, `OFFICE_KM: number`
  - `isOfficeLocation(name: string | null, lat: number | null, lng: number | null): boolean`
  - `classifyClockedStatus(args: { inOffice: boolean; outOffice: boolean; isMalta: boolean }): 'office' | 'wfh' | 'remote'`
  - `dayAnomalies(args: { timeIn: string | null; timeOut: string | null; inOffice: boolean; outOffice: boolean }): { incomplete: boolean; locationMismatch: boolean }`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/attendance/__tests__/location.test.ts
import { describe, it, expect } from 'vitest'
import { isOfficeLocation, classifyClockedStatus, dayAnomalies, OFFICE_LAT, OFFICE_LNG } from '../location'

describe('isOfficeLocation', () => {
  it('matches office names case-insensitively', () => {
    expect(isOfficeLocation('Head Office', null, null)).toBe(true)
    expect(isOfficeLocation('office', null, null)).toBe(true)
    expect(isOfficeLocation('TA Office', null, null)).toBe(true)
    expect(isOfficeLocation('Home', null, null)).toBe(false)
  })
  it('matches GPS within 150m of the office', () => {
    expect(isOfficeLocation(null, OFFICE_LAT, OFFICE_LNG)).toBe(true)
    expect(isOfficeLocation('Not from the office', OFFICE_LAT + 0.05, OFFICE_LNG)).toBe(false)
  })
  it('returns false for null/NaN coords and null name', () => {
    expect(isOfficeLocation(null, null, null)).toBe(false)
    expect(isOfficeLocation(null, NaN, NaN)).toBe(false)
  })
})

describe('classifyClockedStatus', () => {
  it('is office when clock-in is at office', () => {
    expect(classifyClockedStatus({ inOffice: true, outOffice: false, isMalta: true })).toBe('office')
  })
  it('is office when clock-out is at office (the fix)', () => {
    expect(classifyClockedStatus({ inOffice: false, outOffice: true, isMalta: true })).toBe('office')
  })
  it('is wfh for a Malta employee neither in nor out at office', () => {
    expect(classifyClockedStatus({ inOffice: false, outOffice: false, isMalta: true })).toBe('wfh')
  })
  it('is remote for a non-Malta employee neither in nor out at office', () => {
    expect(classifyClockedStatus({ inOffice: false, outOffice: false, isMalta: false })).toBe('remote')
  })
})

describe('dayAnomalies', () => {
  it('flags incomplete when exactly one timestamp is present', () => {
    expect(dayAnomalies({ timeIn: '09:00', timeOut: null, inOffice: true, outOffice: false }).incomplete).toBe(true)
    expect(dayAnomalies({ timeIn: null, timeOut: '17:00', inOffice: false, outOffice: true }).incomplete).toBe(true)
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: true, outOffice: true }).incomplete).toBe(false)
    expect(dayAnomalies({ timeIn: null, timeOut: null, inOffice: false, outOffice: false }).incomplete).toBe(false)
  })
  it('flags locationMismatch only when both present and office-ness differs', () => {
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: false, outOffice: true }).locationMismatch).toBe(true)
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: true, outOffice: false }).locationMismatch).toBe(true)
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: true, outOffice: true }).locationMismatch).toBe(false)
    expect(dayAnomalies({ timeIn: '09:00', timeOut: '17:00', inOffice: false, outOffice: false }).locationMismatch).toBe(false)
  })
  it('never flags locationMismatch for an incomplete day', () => {
    expect(dayAnomalies({ timeIn: '09:00', timeOut: null, inOffice: false, outOffice: true }).locationMismatch).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/attendance/__tests__/location.test.ts`
Expected: FAIL — `Cannot find module '../location'`.

- [ ] **Step 3: Implement the helper**

```typescript
// src/lib/attendance/location.ts

/** Malta head office coordinates + match radius (km). */
export const OFFICE_LAT = 35.9222072
export const OFFICE_LNG = 14.4878368
export const OFFICE_KM = 0.15

function gpsKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** True if the location name reads as the office, or the GPS is within OFFICE_KM of it. */
export function isOfficeLocation(name: string | null, lat: number | null, lng: number | null): boolean {
  if (name) {
    const l = name.toLowerCase()
    if (l.includes('head office') || l === 'office' || l.includes('ta office')) return true
  }
  if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
    return gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM
  }
  return false
}

/** Office if clock-in OR clock-out at office; otherwise wfh (Malta) / remote. */
export function classifyClockedStatus(
  { inOffice, outOffice, isMalta }: { inOffice: boolean; outOffice: boolean; isMalta: boolean },
): 'office' | 'wfh' | 'remote' {
  if (inOffice || outOffice) return 'office'
  return isMalta ? 'wfh' : 'remote'
}

/** Render-time anomaly flags derived from the stored day. */
export function dayAnomalies(
  { timeIn, timeOut, inOffice, outOffice }: { timeIn: string | null; timeOut: string | null; inOffice: boolean; outOffice: boolean },
): { incomplete: boolean; locationMismatch: boolean } {
  const hasIn = Boolean(timeIn)
  const hasOut = Boolean(timeOut)
  return {
    incomplete: hasIn !== hasOut,
    locationMismatch: hasIn && hasOut && inOffice !== outOffice,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/attendance/__tests__/location.test.ts`
Expected: PASS (all three describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/attendance/location.ts src/lib/attendance/__tests__/location.test.ts
git commit -m "feat(attendance): add shared office-location + anomaly helper"
```

---

## Task 2: Daily-sync classification fix

**Files:**
- Modify: `src/app/api/import/pull/route.ts`

**Interfaces:**
- Consumes: `isOfficeLocation`, `classifyClockedStatus` from `@/lib/attendance/location`.

- [ ] **Step 1: Import the helper and remove the local office helpers**

At the top of `src/app/api/import/pull/route.ts`, add to the imports:
```typescript
import { isOfficeLocation, classifyClockedStatus } from '@/lib/attendance/location'
```
Then delete the now-redundant local block (the `OFFICE_LAT`/`OFFICE_LNG`/`OFFICE_KM` consts and the `gpsKm`, `isOfficeGps`, `isOfficeName` functions):
```typescript
const OFFICE_LAT = 35.9222072, OFFICE_LNG = 14.4878368, OFFICE_KM = 0.15

function gpsKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function isOfficeGps(lat: number | null, lng: number | null) {
  return lat != null && lng != null && !isNaN(lat) && !isNaN(lng) ? gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM : false
}
function isOfficeName(n: string | null) {
  if (!n) return false; const l = n.toLowerCase()
  return l.includes('head office') || l === 'office' || l.includes('ta office')
}
```

- [ ] **Step 2: Replace the office detection in `saveClockings`**

Find this block:
```typescript
    // Check if any session is at the office
    const atOffice = sessions.some(s =>
      isOfficeName(s.workLocationIn?.name ?? null) ||
      isOfficeGps(s.locationLatIn, s.locationLongIn) ||
      isOfficeGps(s.workLocationIn?.lat ?? null, s.workLocationIn?.long ?? null)
    )
```
Replace it with (checks both clock-in and clock-out locations):
```typescript
    // Office if any session's clock-IN or clock-OUT is at the office.
    const inOffice = sessions.some(s =>
      isOfficeLocation(s.workLocationIn?.name ?? null, s.locationLatIn ?? s.workLocationIn?.lat ?? null, s.locationLongIn ?? s.workLocationIn?.long ?? null)
    )
    const outOffice = sessions.some(s =>
      isOfficeLocation(s.workLocationOut?.name ?? null, s.locationLatOut ?? s.workLocationOut?.lat ?? null, s.locationLongOut ?? s.workLocationOut?.long ?? null)
    )
```

- [ ] **Step 3: Replace the status classification**

Find this block:
```typescript
    // Status classification
    let status: string
    if (hasBroken) status = 'active' // no clock-out
    else if (atOffice) status = 'office'
    else if (sessions.length === 0) status = isMalta ? 'no_clocking' : 'unknown'
    else status = isMalta ? 'wfh' : 'remote'
```
Replace it with (no more `active`; `hasBroken` still controls time_out/hours/comments below):
```typescript
    // Status by location (in OR out at office). "Incomplete" days are detected
    // at render time from the missing time_out — they are no longer a status.
    const status: string = sessions.length === 0
      ? (isMalta ? 'no_clocking' : 'unknown')
      : classifyClockedStatus({ inOffice, outOffice, isMalta })
```
Leave the existing `const hasBroken = froms.length > 0 && tos.length === 0` line and every later use of `hasBroken` (for `time_out`, `hours_worked`, `comments`) exactly as-is.

- [ ] **Step 4: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean (no "isOfficeName/isOfficeGps/gpsKm/atOffice is not defined" or unused errors); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/import/pull/route.ts
git commit -m "fix(sync): classify office by clock-in OR clock-out; drop active status"
```

---

## Task 3: Reclassify route uses the helper

**Files:**
- Modify: `src/app/api/import/reclassify/route.ts`

**Interfaces:**
- Consumes: `isOfficeLocation`, `classifyClockedStatus` from `@/lib/attendance/location`.

- [ ] **Step 1: Import the helper and remove local office helpers**

At the top of `src/app/api/import/reclassify/route.ts`, replace the local office helpers:
```typescript
const OFFICE_LAT = 35.9222072, OFFICE_LNG = 14.4878368, OFFICE_KM = 0.15

function gpsKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function isOfficeGps(lat: number | null, lng: number | null) {
  return lat != null && lng != null && !isNaN(lat) && !isNaN(lng) ? gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM : false
}
function isOfficeName(n: string | null) {
  if (!n) return false; const l = n.toLowerCase()
  return l.includes('head office') || l === 'office' || l.includes('ta office')
}
```
with:
```typescript
import { isOfficeLocation, classifyClockedStatus } from '@/lib/attendance/location'
```
(Place the import with the other top-of-file imports, above `export async function POST`.)

- [ ] **Step 2: Reclassify broken/active and use the helper**

Find this block:
```typescript
      // Skip leave/sick — those are correct
      if (r.status === 'vacation' || r.status === 'sick') { unchanged++; continue }

      // Keep broken/active as-is
      if (r.status === 'broken' || r.status === 'active') { unchanged++; continue }

      // Determine correct status
      const atOffice = isOfficeName(r.location_in) || isOfficeName(r.location_out) || isOfficeGps(r.lat_in, r.lng_in) || isOfficeGps(r.lat_out, r.lng_out)

      let newStatus: string
      if (atOffice) {
        newStatus = 'office'
      } else if (isMalta) {
        newStatus = 'wfh'
      } else {
        newStatus = 'remote'
      }
```
Replace it with (drop the broken/active skip; classify everything clocked by location):
```typescript
      // Skip leave/sick and absent days — those are correct as-is.
      if (r.status === 'vacation' || r.status === 'sick' || r.status === 'no_clocking') { unchanged++; continue }

      // Classify by location: office if clock-in OR clock-out at office.
      const inOffice = isOfficeLocation(r.location_in, r.lat_in, r.lng_in)
      const outOffice = isOfficeLocation(r.location_out, r.lat_out, r.lng_out)
      const newStatus: string = classifyClockedStatus({ inOffice, outOffice, isMalta })
```

- [ ] **Step 3: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/import/reclassify/route.ts
git commit -m "fix(reclassify): classify broken/active days by location via shared helper"
```

---

## Task 4: Grid rendering (borders + legend)

**Files:**
- Modify: `src/components/dashboard/AttendanceGrid.tsx`

**Interfaces:**
- Produces: `GridDay` gains `incomplete?: boolean` and `locationMismatch?: boolean` (the dashboard page populates these in Task 5).

- [ ] **Step 1: Remove the amber/orange statuses from `STATUS_CONFIG`**

Find:
```typescript
const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  office:      { color: 'bg-indigo-600',  label: 'Office' },
  wfh:         { color: 'bg-sky-400',     label: 'WFH' },
  remote:      { color: 'bg-teal-400',    label: 'Remote' },
  vacation:    { color: 'bg-violet-400',  label: 'Leave' },
  sick:        { color: 'bg-red-400',     label: 'Sick' },
  no_clocking: { color: 'bg-zinc-400',    label: 'No Clocking' },
  unknown:     { color: 'bg-zinc-400',    label: 'Unknown' },
  active:      { color: 'bg-amber-500',   label: 'No Clock-out' },
  broken:      { color: 'bg-orange-400',  label: 'Broken Clocking' },
}
```
Replace with:
```typescript
const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  office:      { color: 'bg-indigo-600',  label: 'Office' },
  wfh:         { color: 'bg-sky-400',     label: 'WFH' },
  remote:      { color: 'bg-teal-400',    label: 'Remote' },
  vacation:    { color: 'bg-violet-400',  label: 'Leave' },
  sick:        { color: 'bg-red-400',     label: 'Sick' },
  no_clocking: { color: 'bg-zinc-400',    label: 'No Clocking' },
  unknown:     { color: 'bg-zinc-400',    label: 'Unknown' },
}
```

- [ ] **Step 2: Add the new fields to `GridDay`**

Find:
```typescript
export interface GridDay {
  date: string
  label: string
  status: string
  hours?: number | null
  timeIn?: string | null
  timeOut?: string | null
  flags?: string[]
  detectedTz?: string | null
}
```
Replace with:
```typescript
export interface GridDay {
  date: string
  label: string
  status: string
  hours?: number | null
  timeIn?: string | null
  timeOut?: string | null
  flags?: string[]
  incomplete?: boolean
  locationMismatch?: boolean
  detectedTz?: string | null
}
```

- [ ] **Step 3: Replace the cell ring with red/yellow borders**

Find this block:
```typescript
                    const day = emp.days.find(d => d.date === date)
                    const s = day?.status ?? 'unknown'
                    const config = STATUS_CONFIG[s] ?? STATUS_CONFIG.unknown
                    const hasFlag = day?.flags && day.flags.length > 0
                    const isCross = isRowHover || hoverCol === date
```
Replace with:
```typescript
                    const day = emp.days.find(d => d.date === date)
                    const s = day?.status ?? 'unknown'
                    const config = STATUS_CONFIG[s] ?? STATUS_CONFIG.unknown
                    const ring = day?.locationMismatch ? 'ring-2 ring-red-500' : day?.incomplete ? 'ring-2 ring-yellow-400' : ''
                    const isCross = isRowHover || hoverCol === date
```
Then find the cell `<div>`:
```typescript
                        <div
                          className={`w-[18px] h-[18px] rounded-[4px] mx-auto cursor-default ${config.color} transition-transform hover:scale-125 ${hasFlag ? 'ring-2 ring-rose-500' : ''}`}
```
Replace its className with:
```typescript
                          className={`w-[18px] h-[18px] rounded-[4px] mx-auto cursor-default ${config.color} transition-transform hover:scale-125 ${ring}`}
```

- [ ] **Step 4: Update the legend**

Find:
```typescript
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-[3px] bg-zinc-400 ring-2 ring-rose-500" />
          <span className="text-[10px] text-red-500">Location Mismatch</span>
        </div>
```
Replace with:
```typescript
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-[3px] bg-indigo-600 ring-2 ring-red-500" />
          <span className="text-[10px] text-slate-600">Location mismatch</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-[3px] bg-indigo-600 ring-2 ring-yellow-400" />
          <span className="text-[10px] text-slate-600">Incomplete (no clock-out)</span>
        </div>
```

- [ ] **Step 5: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build succeeds. (The tooltip still reads `tooltip.day.flags`; that's fine — `flags` remains on `GridDay`.)

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/AttendanceGrid.tsx
git commit -m "feat(grid): red/yellow borders for location mismatch and incomplete days"
```

---

## Task 5: Dashboard grid builder + stat cards + filter cleanup

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/components/attendance/AttendanceFilters.tsx`

**Interfaces:**
- Consumes: `isOfficeLocation`, `dayAnomalies` from `@/lib/attendance/location`; `GridDay.incomplete`/`locationMismatch` from Task 4.

- [ ] **Step 1: Import the helper and remove the local office helpers in `page.tsx`**

At the top of `src/app/dashboard/page.tsx`, add:
```typescript
import { isOfficeLocation, dayAnomalies } from '@/lib/attendance/location'
```
Then delete the local office block:
```typescript
// Office GPS check
const OFFICE_LAT = 35.9222072, OFFICE_LNG = 14.4878368, OFFICE_KM = 0.15
function gpsKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
function isAtOffice(lat: number | null, lng: number | null) {
  return lat && lng ? gpsKm(lat, lng, OFFICE_LAT, OFFICE_LNG) <= OFFICE_KM : false
}
```

- [ ] **Step 2: Replace the broken/mismatch stat logic**

Find:
```typescript
  // Broken clocking sub-types
  const brokenNoClockOut = recs.filter(r => (r.status === 'broken' || r.status === 'active') && r.time_in && !r.time_out).length
  const brokenAll = count('broken') + count('active')

  // Location mismatch: status is "office" but GPS/location_out is not at the office
  const locationMismatch = recs.filter(r => {
    if (r.status !== 'office') return false
    // Check if clock-out location is far from office
    if (r.lat_out && r.lng_out && !isAtOffice(r.lat_out, r.lng_out)) return true
    // Or if location_out explicitly says something other than office
    const locOut = (r.location_out ?? '').toLowerCase()
    if (locOut && !locOut.includes('office') && !locOut.includes('head office')) return true
    return false
  }).length
```
Replace with:
```typescript
  // Anomaly counts derived from each record (incomplete = missing a timestamp;
  // location mismatch = clock-in office-ness differs from clock-out).
  const anomalyTotals = recs.reduce(
    (acc, r) => {
      const inOffice = isOfficeLocation(r.location_in, r.lat_in, r.lng_in)
      const outOffice = isOfficeLocation(r.location_out, r.lat_out, r.lng_out)
      const a = dayAnomalies({ timeIn: r.time_in, timeOut: r.time_out, inOffice, outOffice })
      if (a.incomplete) acc.incomplete++
      if (a.locationMismatch) acc.mismatch++
      return acc
    },
    { incomplete: 0, mismatch: 0 },
  )
```

- [ ] **Step 3: Update the stat cards array**

Find:
```typescript
    { label: 'No Clocking', value: count('no_clocking') },
    { label: 'Broken',      value: brokenAll },
    { label: 'Loc. Mismatch', value: locationMismatch },
  ]
```
Replace with:
```typescript
    { label: 'No Clocking', value: count('no_clocking') },
    { label: 'Incomplete',  value: anomalyTotals.incomplete },
    { label: 'Loc. Mismatch', value: anomalyTotals.mismatch },
  ]
```

- [ ] **Step 4: Replace the grid-builder day mapping**

Find this block:
```typescript
    const days = empRecords.map(r => {
      const flags: string[] = []
      if ((r.status === 'broken' || r.status === 'active') && r.time_in && !r.time_out) flags.push('No clock-out')
      if ((r.status === 'broken' || r.status === 'active') && (!r.time_in || r.time_out)) flags.push('Broken')
      if (r.status === 'office' && r.lat_out && r.lng_out && !isAtOffice(r.lat_out, r.lng_out)) flags.push('Clock-out location mismatch')
      if (r.status === 'office' && r.lat_in && r.lng_in && !isAtOffice(r.lat_in, r.lng_in)) flags.push('Clock-in location mismatch')
      return { date: r.date, label: r.status, status: r.status, hours: r.hours_worked, timeIn: r.time_in, timeOut: r.time_out, flags, detectedTz: r.detected_timezone ?? null }
    })
```
Replace with:
```typescript
    const days = empRecords.map(r => {
      const inOffice = isOfficeLocation(r.location_in, r.lat_in, r.lng_in)
      const outOffice = isOfficeLocation(r.location_out, r.lat_out, r.lng_out)
      const { incomplete, locationMismatch } = dayAnomalies({ timeIn: r.time_in, timeOut: r.time_out, inOffice, outOffice })
      const flags: string[] = []
      if (locationMismatch) flags.push('Location mismatch (started/ended in different places)')
      if (incomplete) flags.push(r.time_in ? 'Incomplete — no clock-out' : 'Incomplete — no clock-in')
      return { date: r.date, label: r.status, status: r.status, hours: r.hours_worked, timeIn: r.time_in, timeOut: r.time_out, flags, incomplete, locationMismatch, detectedTz: r.detected_timezone ?? null }
    })
```

- [ ] **Step 5: Remove dead status options from the Attendance filter**

In `src/components/attendance/AttendanceFilters.tsx`, find:
```typescript
  { value: 'vacation',    label: 'Leave' },
  { value: 'active',      label: 'Active' },
  { value: 'broken',      label: 'Broken' },
]
```
Replace with:
```typescript
  { value: 'vacation',    label: 'Leave' },
]
```

- [ ] **Step 6: Verify build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean (no `isAtOffice`/`brokenAll`/`locationMismatch` undefined or unused errors); build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/page.tsx src/components/attendance/AttendanceFilters.tsx
git commit -m "feat(dashboard): incomplete/loc-mismatch stats + grid flags via shared helper"
```

---

## Task 6: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: all suites pass (existing + the new `location` tests).

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit && npx eslint . && npm run build`
Expected: tsc clean; eslint 0 errors; build succeeds.

- [ ] **Step 3: Push**

```bash
git push origin dev
```

---

## Post-deploy data step (controller/human, not a code task)

After the code is merged + deployed, run the Reclassify tool once over all
existing history so stored days reflect the new rules (end-at-office → office;
old `active`/`broken` → office/wfh/remote). Either click **Import → Reclassify**
for the full date range, or POST `/api/import/reclassify` with
`{ dateFrom: '2026-01-01', dateTo: <today> }` against the deployed app (it shares
the live Supabase DB). It is idempotent. Then spot-check that Tina Koepf and
Owen's recent days show as office with a red border, and that a no-clock-out day
shows a yellow border.

## Notes for the implementer

- Do not add DB columns — `incomplete`/`locationMismatch` are derived at render.
- `hasBroken` in `saveClockings` still controls `time_out`/`hours_worked`/`comments`; only its use in the status decision is removed.
- After reclassify, `active`/`broken` no longer appear in data; the chart's
  `unknown` bucket (which still references them) simply counts zero — harmless,
  leave it.
