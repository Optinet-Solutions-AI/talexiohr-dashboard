import { Building2, Home, MapPin, CircleSlash, PlaneTakeoff, Users } from 'lucide-react'

interface Stats {
  total: number
  office: number
  wfh: number
  remote: number
  absent: number
  vacation: number
}

const cards = [
  { key: 'total',    label: 'Total Employees', icon: Users,        color: 'text-gray-600',   bg: 'bg-gray-50'    },
  { key: 'office',   label: 'In Office',       icon: Building2,    color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { key: 'wfh',      label: 'Working from Home', icon: Home,       color: 'text-blue-600',   bg: 'bg-blue-50'    },
  { key: 'remote',   label: 'Remote',          icon: MapPin,       color: 'text-amber-600',  bg: 'bg-amber-50'   },
  { key: 'absent',   label: 'No Clocking',     icon: CircleSlash,  color: 'text-gray-400',   bg: 'bg-gray-50'    },
  { key: 'vacation', label: 'On Vacation',     icon: PlaneTakeoff, color: 'text-purple-600', bg: 'bg-purple-50'  },
]

export default function StatCards({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map(({ key, label, icon: Icon, color, bg }) => (
        <div key={key} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
          <div className={`${bg} w-9 h-9 rounded-lg flex items-center justify-center`}>
            <Icon size={18} className={color} />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats[key as keyof Stats]}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
