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
