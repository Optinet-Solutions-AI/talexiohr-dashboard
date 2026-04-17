import type { AttendanceStatus } from '@/lib/attendance/sync'

const config: Record<string, { label: string; className: string }> = {
  office:      { label: 'Office',          className: 'bg-indigo-600 text-white' },
  wfh:         { label: 'WFH',            className: 'bg-sky-100 text-sky-700' },
  remote:      { label: 'Remote',          className: 'bg-teal-100 text-teal-700' },
  no_clocking: { label: 'No Clocking',     className: 'bg-slate-100 text-slate-600' },
  vacation:    { label: 'Leave',           className: 'bg-violet-100 text-violet-700' },
  sick:        { label: 'Sick',            className: 'bg-red-100 text-red-700' },
  active:      { label: 'No Clock-out',    className: 'bg-amber-100 text-amber-700' },
  broken:      { label: 'Broken Clocking', className: 'bg-orange-100 text-orange-700' },
  unknown:     { label: 'Unknown',         className: 'bg-slate-100 text-slate-500' },
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
