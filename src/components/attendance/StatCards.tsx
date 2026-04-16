interface Stats {
  total: number
  office: number
  wfh: number
  remote: number
  absent: number
  vacation: number
}

const cards: { key: keyof Stats; label: string }[] = [
  { key: 'total',    label: 'Employees'   },
  { key: 'office',   label: 'In Office'   },
  { key: 'wfh',      label: 'WFH'         },
  { key: 'remote',   label: 'Remote'      },
  { key: 'absent',   label: 'No Clocking' },
  { key: 'vacation', label: 'On Leave'    },
]

export default function StatCards({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {cards.map(({ key, label }) => (
        <div key={key} className="bg-white rounded-lg border border-slate-200 p-3">
          <p className="text-xl font-bold text-slate-800">{stats[key]}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  )
}
