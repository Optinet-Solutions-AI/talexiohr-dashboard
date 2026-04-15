'use client'

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  office:      { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Office' },
  wfh:         { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'WFH'    },
  remote:      { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Remote' },
  vacation:    { bg: 'bg-purple-100',  text: 'text-purple-700',  label: 'Vacation' },
  no_clocking: { bg: 'bg-gray-100',    text: 'text-gray-500',    label: '—'      },
  unknown:     { bg: 'bg-gray-50',     text: 'text-gray-300',    label: '·'      },
  active:      { bg: 'bg-cyan-100',    text: 'text-cyan-700',    label: 'Active' },
  broken:      { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Broken' },
}

export interface GridEmployee {
  name: string
  days: { date: string; label: string; status: string }[]
}

export default function AttendanceGrid({ employees, dates }: { employees: GridEmployee[]; dates: string[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider w-40">Employee</th>
            {dates.map(d => {
              const dt = new Date(d + 'T00:00:00')
              const day = dt.toLocaleDateString('en-GB', { weekday: 'short' })
              const num = dt.getDate()
              return (
                <th key={d} className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[72px]">
                  <span className="block">{day}</span>
                  <span className="block text-gray-400 font-normal">Apr {num}</span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {employees.map(emp => (
            <tr key={emp.name} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-2.5 font-medium text-gray-800 whitespace-nowrap text-xs">{emp.name}</td>
              {dates.map(date => {
                const day = emp.days.find(d => d.date === date)
                const s = day?.status ?? 'unknown'
                const style = STATUS_STYLE[s] ?? STATUS_STYLE.unknown
                return (
                  <td key={date} className="px-2 py-2 text-center">
                    <span className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
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
