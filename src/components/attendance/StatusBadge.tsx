import type { AttendanceStatus } from '@/lib/attendance/sync'

const config: Record<string, { label: string; className: string }> = {
  office:      { label: 'Office',      className: 'bg-indigo-600 text-white' },
  wfh:         { label: 'WFH',         className: 'bg-indigo-100 text-indigo-700' },
  remote:      { label: 'Remote',      className: 'bg-indigo-50 text-indigo-500' },
  no_clocking: { label: 'No Clocking', className: 'bg-gray-100 text-gray-500' },
  vacation:    { label: 'Leave',       className: 'bg-gray-100 text-gray-600' },
  sick:        { label: 'Sick',        className: 'bg-gray-100 text-gray-600' },
  active:      { label: 'Active',      className: 'bg-indigo-100 text-indigo-600' },
  broken:      { label: 'Broken',      className: 'bg-gray-100 text-gray-500' },
  unknown:     { label: 'Unknown',     className: 'bg-gray-50 text-gray-400' },
}

export default function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? 'unknown'
  const { label, className } = config[s] ?? config.unknown
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {label}
    </span>
  )
}
