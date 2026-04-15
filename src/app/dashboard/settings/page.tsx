import { createAdminClient } from '@/lib/supabase/admin'
import { Settings } from 'lucide-react'
import EmployeeGroupTable from '@/components/settings/EmployeeGroupTable'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = createAdminClient()

  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name, talexio_id, unit, group_type')
    .order('last_name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure employee groups and system preferences</p>
      </div>

      {/* Employee group management */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Settings size={15} className="text-gray-400" />
            Employee Group Assignment
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Malta Office employees are subject to the 4-day office attendance policy.
            Remote employees are evaluated on hours worked only.
          </p>
        </div>

        {employees && employees.length > 0 ? (
          <EmployeeGroupTable employees={employees} />
        ) : (
          <div className="px-5 py-12 text-center text-gray-400 text-sm">
            No employees found — import data first.
          </div>
        )}
      </div>

      {/* Attendance policy reference */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Attendance Policy (Malta Office)</h2>
        <ul className="space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-500 font-bold">✓</span>
            Required to attend office <strong>4 days per week</strong>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-500 font-bold">✓</span>
            Max <strong>1 WFH Monday</strong> per calendar month
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-500 font-bold">✓</span>
            Max <strong>1 WFH Friday</strong> per calendar month
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 text-emerald-500 font-bold">✓</span>
            Must book desk in advance and clock in/out when in office
          </li>
        </ul>
      </div>
    </div>
  )
}
