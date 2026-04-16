'use client'

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  office:      { bg: 'bg-indigo-600', text: 'text-white',       label: 'Office' },
  wfh:         { bg: 'bg-indigo-100', text: 'text-indigo-700',  label: 'WFH'    },
  remote:      { bg: 'bg-indigo-50',  text: 'text-indigo-500',  label: 'Remote' },
  vacation:    { bg: 'bg-violet-50',  text: 'text-violet-600',   label: 'Leave'  },
  sick:        { bg: 'bg-red-50',     text: 'text-red-600',     label: 'Sick'   },
  no_clocking: { bg: 'bg-slate-100',  text: 'text-slate-500',   label: '—'      },
  unknown:     { bg: 'bg-slate-50',   text: 'text-slate-500',   label: '·'      },
  active:      { bg: 'bg-indigo-100', text: 'text-indigo-600',  label: 'Active' },
  broken:      { bg: 'bg-amber-50',   text: 'text-amber-600',   label: 'Broken' },
}

export interface GridEmployee {
  name: string
  days: { date: string; label: string; status: string }[]
}

export default function AttendanceGrid({ employees, dates }: { employees: GridEmployee[]; dates: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 text-[10px] font-medium text-slate-600 uppercase tracking-wider w-36 sticky left-0 bg-white z-10">Employee</th>
            {dates.map(d => {
              const dt = new Date(d + 'T00:00:00')
              return (
                <th key={d} className="px-1.5 py-2 text-center text-[10px] font-medium text-slate-600 uppercase tracking-wider min-w-[60px]">
                  <span className="block">{dt.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                  <span className="block text-slate-500 font-normal">{dt.getDate()}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {employees.map(emp => (
            <tr key={emp.name} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap text-xs sticky left-0 bg-white z-10">{emp.name}</td>
              {dates.map(date => {
                const day = emp.days.find(d => d.date === date)
                const s = day?.status ?? 'unknown'
                const style = STATUS_STYLE[s] ?? STATUS_STYLE.unknown
                return (
                  <td key={date} className="px-1.5 py-1.5 text-center">
                    <span className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}>
                      {style.label}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
