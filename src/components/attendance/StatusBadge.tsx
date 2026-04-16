import type { AttendanceStatus } from '@/lib/attendance/sync'

const config: Record<string, { label: string; className: string }> = {
  office:      { label: 'Office',      className: 'bg-slate-700 text-white' },
  wfh:         { label: 'WFH',         className: 'bg-slate-400 text-white' },
  remote:      { label: 'Remote',      className: 'bg-slate-300 text-slate-700' },
  no_clocking: { label: 'No Clocking', className: 'bg-slate-100 text-slate-400' },
  vacation:    { label: 'Leave',       className: 'bg-slate-200 text-slate-500' },
  sick:        { label: 'Sick',        className: 'bg-slate-200 text-slate-500' },
  active:      { label: 'Active',      className: 'bg-slate-400 text-white' },
  broken:      { label: 'Broken',      className: 'bg-slate-300 text-slate-600' },
  unknown:     { label: 'Unknown',     className: 'bg-slate-100 text-slate-300' },
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
