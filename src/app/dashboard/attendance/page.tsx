import { createClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'
import StatCards from '@/components/attendance/StatCards'
import AttendanceFilters from '@/components/attendance/AttendanceFilters'
import StatusBadge from '@/components/attendance/StatusBadge'
import CsvImport from '@/components/attendance/CsvImport'
import { CalendarDays, Clock } from 'lucide-react'

const PAGE_SIZE = 50

interface PageProps {
  searchParams: Promise<{
    from?: string
    to?: string
    employee?: string
    status?: string
    page?: string
  }>
}

export default async function AttendancePage({ searchParams }: PageProps) {
  const sp     = await searchParams
  const from   = sp.from     ?? format(subDays(new Date(), 13), 'yyyy-MM-dd')
  const to     = sp.to       ?? format(new Date(), 'yyyy-MM-dd')
  const empId  = sp.employee ?? ''
  const status = sp.status   ?? ''
  const page   = parseInt(sp.page ?? '1')
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await createClient()

  // Fetch employees for filter dropdown
  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name')
    .order('last_name')

  // Build attendance query
  let query = supabase
    .from('attendance_records')
    .select(`
      id, date, location_in, time_in, location_out, time_out,
      hours_worked, status, comments,
      employees!inner(id, first_name, last_name, full_name)
    `, { count: 'exact' })
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .order('employees(last_name)', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)

  if (empId)  query = query.eq('employee_id', empId)
  if (status) query = query.eq('status', status)

  const { data: records, count } = await query

  // Stats for the selected date range
  const { data: statsData } = await supabase
    .from('attendance_records')
    .select('status')
    .gte('date', from)
    .lte('date', to)
    .then(r => r)

  const stats = {
    total:    employees?.length ?? 0,
    office:   statsData?.filter(r => r.status === 'office').length   ?? 0,
    wfh:      statsData?.filter(r => r.status === 'wfh').length      ?? 0,
    remote:   statsData?.filter(r => r.status === 'remote').length   ?? 0,
    absent:   statsData?.filter(r => r.status === 'no_clocking').length ?? 0,
    vacation: statsData?.filter(r => r.status === 'vacation').length ?? 0,
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Attendance</h1>
          <p className="text-sm text-gray-500 mt-0.5">Malta office daily attendance tracker</p>
        </div>
        <CsvImport />
      </div>

      {/* Stats */}
      <StatCards stats={stats} />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <AttendanceFilters employees={employees ?? []} />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {count ?? 0} record{count !== 1 ? 's' : ''} · {from} → {to}
          </p>
        </div>

        {!records || records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CalendarDays className="text-gray-300 mb-3" size={40} />
            <p className="text-gray-500 font-medium">No records found</p>
            <p className="text-gray-400 text-sm mt-1">Import a CSV or adjust your filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Date</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Employee</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Location In</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Time In</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Time Out</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Hours</th>
                  <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wider">Comments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map((r) => {
                  const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
                  return (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap font-medium">
                        {r.date}
                      </td>
                      <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                        {emp?.full_name ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {r.location_in ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                        {r.time_in ? r.time_in.slice(0, 5) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                        {r.time_out ? r.time_out.slice(0, 5) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {r.hours_worked != null
                          ? `${Math.floor(r.hours_worked)}h ${Math.round((r.hours_worked % 1) * 60)}m`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">
                        {r.comments || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
            <span>Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <a
                  href={`?from=${from}&to=${to}${empId ? `&employee=${empId}` : ''}${status ? `&status=${status}` : ''}&page=${page - 1}`}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  Previous
                </a>
              )}
              {page < totalPages && (
                <a
                  href={`?from=${from}&to=${to}${empId ? `&employee=${empId}` : ''}${status ? `&status=${status}` : ''}&page=${page + 1}`}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  Next
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
