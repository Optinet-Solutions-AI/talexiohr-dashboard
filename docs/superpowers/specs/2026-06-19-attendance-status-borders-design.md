# Attendance status classification + grid borders — design

**Date:** 2026-06-19
**Status:** Approved (design); pending implementation plan

## Overview

Client feedback while preparing a management report:

1. If an employee starts a workday **not** at the office but **finishes at the office**, that day should be marked as an **office** day, with a **red border** to flag the start/end location difference. (Examples given: Tina Koepf and Owen — started outside the office, ended at the office, currently shown as WFH with no note.)
2. Remove the orange **"Broken Clocking"** fill. Cells should be colored by location (office = purple, WFH = blue), and a **yellow border** should mark days where the timer wasn't turned off (no clock-out).
3. Remove the **"No Clock-out"** status — it's the same as "Broken Clocking" and should be merged into the single yellow-border concept.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Office rule | A day is **office** if the clock-in **or** clock-out is at the office (symmetric). |
| Red border | Shown whenever the clock-in and clock-out differ in office-ness (one at office, the other not) — both directions. |
| Yellow border | Shown for any **incomplete** day (missing a clock-in **or** a clock-out). Merges the old `broken` + `active` (No Clock-out). Cell colored by whichever location exists. |
| Stat cards | Replace "Broken" with "Incomplete"; keep "Loc. Mismatch" (now symmetric). |
| Approach | Derive borders at render time from already-stored fields; fix classification in the sync; no new DB columns. |
| Compliance impact | Accepted: end-at-office days (and office clock-ins with no clock-out) now count as office days in Compliance and the office stat. |

## Approach

**Approach A — render-derived anomalies + classification fix.** The day already
stores `time_in`, `time_out`, and both in/out locations, so "incomplete" and
"location mismatch" are fully derivable at render time (the existing flag pattern).
The stored `status` is fixed in the sync so it reflects the symmetric office rule
and no longer emits `active`/`broken`; existing data is corrected by running the
Reclassify tool once. No migration.

(Rejected: stored boolean anomaly columns — a migration + backfill for data that
is fully derivable; redundant.)

## Section 1 — Shared attendance-location helper (new, pure, tested)

The office-detection logic (`OFFICE_LAT/LNG/KM`, `gpsKm`, `isOfficeGps`,
`isOfficeName`) is currently duplicated in `import/pull`, `import/reclassify`, and
`dashboard/page.tsx`. Centralize into `src/lib/attendance/location.ts`:

- `isOfficeLocation(name: string | null, lat: number | null, lng: number | null): boolean`
  — name match (`"head office"`, `"office"`, `"ta office"`) OR GPS within 150 m of
  the Malta office (35.9222072, 14.4878368). One copy of the existing rule.
- `classifyClockedStatus({ inOffice, outOffice, isMalta }): 'office' | 'wfh' | 'remote'`
  — `office` if `inOffice || outOffice`; else `wfh` (Malta) / `remote`.
- `dayAnomalies({ timeIn, timeOut, inOffice, outOffice }): { incomplete: boolean; locationMismatch: boolean }`
  — `incomplete` = exactly one of `timeIn`/`timeOut` is present;
    `locationMismatch` = both present AND `inOffice !== outOffice`.

All pure → unit-tested (TDD).

## Section 2 — Classification fixes (data layer)

- **Daily sync** (`saveClockings` in `src/app/api/import/pull/route.ts`): replace the
  `hasBroken → 'active'` branch. Compute `inOffice`/`outOffice` across the day's
  sessions (in and out locations) and set status via `classifyClockedStatus`. Do
  not emit `active`/`broken`. Continue storing `time_out = null` / `hours_worked =
  null` when there is no clock-out — that is what makes the day detectably
  "incomplete" at render time.
- **Reclassify** (`src/app/api/import/reclassify/route.ts`): remove the "keep
  broken/active as-is" skip so those historical days are reclassified by location,
  and route classification through the shared helper. (It already considers
  in-or-out office; this aligns it with the helper and stops preserving the dead
  statuses.)

Net: every clocked day becomes `office` / `wfh` / `remote`; `active`/`broken`
disappear from the data after reclassify. `no_clocking` (absent), `vacation`,
`sick` are unchanged.

## Section 3 — Grid rendering

`src/components/dashboard/AttendanceGrid.tsx`:
- Remove the `active` (amber) and `broken` (orange) entries from `STATUS_CONFIG`.
- `GridDay` gains `incomplete?: boolean` and `locationMismatch?: boolean`. The
  `flags` array stays for tooltip text.
- Cell border (replacing the current "any flag → rose ring"):
  - `locationMismatch` → red ring (`ring-2 ring-red-500`)
  - `incomplete` → yellow ring (`ring-2 ring-yellow-400`)
  - mutually exclusive (incomplete = a missing timestamp, so nothing to compare).
- Legend: drop amber/orange swatches; add red-ring = "Location mismatch" and
  yellow-ring = "Incomplete (no clock-out)".
- Tooltip: show the note text ("Location mismatch", "Incomplete — no clock-out").

`src/app/dashboard/page.tsx` (grid builder): replace the inline office/flag logic
with `isOfficeLocation` + `dayAnomalies` to populate each `GridDay`'s `incomplete`,
`locationMismatch`, and `flags`.

## Section 4 — Stat cards

`src/app/dashboard/page.tsx` stat cards:
- Remove the **"Broken"** card and the `brokenAll` / `brokenNoClockOut` logic.
- Add **"Incomplete"** = count of records where `dayAnomalies.incomplete`.
- **"Loc. Mismatch"** = count where `dayAnomalies.locationMismatch` (symmetric rule
  via the helper, replacing the current office-only GPS check).
- "In Office" rises naturally (end-at-office days are now `office`).

Cleanup: remove the now-dead `active` / `broken` options from the Attendance page's
status dropdown (`src/components/attendance/AttendanceFilters.tsx`).

## Section 5 — Historical reclassify rollout

After the code is deployed, run the Reclassify tool once over all existing history
(against the live DB) so stored days reflect the new rules (end-at-office → office;
`active`/`broken` → office/wfh/remote). Idempotent. Then spot-check that
Tina/Owen's days flip to office + red border. One-time data step, not code.

## Section 6 — Testing

- Unit tests (vitest, TDD) for `src/lib/attendance/location.ts`:
  - `isOfficeLocation` — name matches, GPS inside/outside 150 m, null handling.
  - `classifyClockedStatus` — in-at-office → office, out-at-office → office (the
    core fix), neither + Malta → wfh, neither + remote → remote.
  - `dayAnomalies` — `incomplete` for in-only / out-only / both / neither;
    `locationMismatch` for in-office+out-home, in-home+out-office, both-office,
    both-home, and one-missing (→ no mismatch).
- Verification: tsc clean, eslint, full suite green, `next build` succeeds.
- Manual smoke after reclassify: Tina/Owen show office + red border; a no-clock-out
  day shows a yellow border; dashboard shows the Incomplete + Loc. Mismatch cards.

## Out of scope

- New DB columns for anomalies (derived at render instead).
- Changing the Malta office coordinates / the 150 m radius.
- Reworking the Attendance page table layout (only the dead status-filter options
  are removed).
- Changing leave/sick/no_clocking handling.
