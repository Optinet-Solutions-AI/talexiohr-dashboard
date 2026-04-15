import { createClient } from '@/lib/supabase/server'
import { Users } from 'lucide-react'

export default async function EmployeesPage() {
  const supabase = await createClient()

  const { data: employees } = await supabase
    .from('employees')
    .select('id, first_name, last_name, full_name, talexio_id, created_at')
    .order('last_name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
        <p className="text-sm text-gray-500 mt-0.5">Malta office headcount</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm text-gray-500">{employees?.length ?? 0} employees</p>
        </div>

        {!employees || employees.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="text-gray-300 mb-3" size={40} />
            <p className="text-gray-500 font-medium">No employees yet</p>
            <p className="text-gray-400 text-sm mt-1">Import a CSV on the Attendance page to populate employees</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Talexio ID</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {employees.map(emp => (
                <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-900 font-medium">{emp.full_name}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{emp.talexio_id ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(emp.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
