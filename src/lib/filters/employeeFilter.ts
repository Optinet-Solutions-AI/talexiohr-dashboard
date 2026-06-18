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
