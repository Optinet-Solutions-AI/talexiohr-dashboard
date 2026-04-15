import type { AttendanceStatus } from '@/lib/attendance/sync'

const config: Record<string, { label: string; className: string }> = {
  office:      { label: 'Office',       className: 'bg-emerald-100 text-emerald-700' },
  wfh:         { label: 'WFH',          className: 'bg-blue-100 text-blue-700' },
  remote:      { label: 'Remote',       className: 'bg-amber-100 text-amber-700' },
  no_clocking: { label: 'No Clocking',  className: 'bg-gray-100 text-gray-500' },
  vacation:    { label: 'Vacation',     className: 'bg-purple-100 text-purple-700' },
  active:      { label: 'Active',       className: 'bg-cyan-100 text-cyan-700' },
  broken:      { label: 'Broken',       className: 'bg-red-100 text-red-600' },
  unknown:     { label: 'Unknown',      className: 'bg-gray-100 text-gray-400' },
}

export default function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? 'unknown'
  const { label, className } = config[s] ?? config.unknown
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}
