import { createClient } from '@/lib/supabase/server'
import { Users, CalendarDays, ClipboardList } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [{ count: employeeCount }, { count: attendanceCount }] = await Promise.all([
    supabase.from('employees').select('*', { count: 'exact', head: true }),
    supabase.from('attendance_records').select('*', { count: 'exact', head: true }),
  ])

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Dashboard</h1>
      <p className="text-sm text-gray-500 mb-8">Malta office HR overview</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard
          title="Total Employees"
          value={String(employeeCount ?? 0)}
          description="Active headcount"
          icon={Users}
          color="text-blue-600"
          bg="bg-blue-50"
        />
        <StatCard
          title="Attendance Records"
          value={String(attendanceCount ?? 0)}
          description="All time logs"
          icon={ClipboardList}
          color="text-emerald-600"
          bg="bg-emerald-50"
        />
        <StatCard
          title="Pending Requests"
          value="—"
          description="Leave / approvals"
          icon={CalendarDays}
          color="text-amber-600"
          bg="bg-amber-50"
        />
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  color,
  bg,
}: {
  title: string
  value: string
  description: string
  icon: React.ElementType
  color: string
  bg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className={`${bg} w-10 h-10 rounded-lg flex items-center justify-center mb-4`}>
        <Icon size={20} className={color} />
      </div>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-sm font-medium text-gray-700">{title}</p>
      <p className="mt-0.5 text-xs text-gray-400">{description}</p>
    </div>
  )
}
