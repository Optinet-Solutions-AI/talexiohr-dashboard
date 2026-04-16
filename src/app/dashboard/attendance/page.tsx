import { createAdminClient } from '@/lib/supabase/admin'
import { format } from 'date-fns'
import StatCards from '@/components/attendance/StatCards'
import AttendanceFilters from '@/components/attendance/AttendanceFilters'
import StatusBadge from '@/components/attendance/StatusBadge'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; employee?: string; status?: string; page?: string }>
}

export default async function AttendancePage({ searchParams }: PageProps) {
  const sp     = await searchParams
  const today  = format(new Date(), 'yyyy-MM-dd')
  const from   = sp.from     ?? today
  const to     = sp.to       ?? today
  const empId  = sp.employee ?? ''
  const status = sp.status   ?? ''
  const page   = parseInt(sp.page ?? '1')
  const offset = (page - 1) * PAGE_SIZE

  const supabase = createAdminClient()

  const { data: employees } = await supabase.from('employees').select('id, full_name').eq('excluded', false).order('last_name')

  let query = supabase
    .from('attendance_records')
    .select('id, date, location_in, time_in, location_out, time_out, hours_worked, status, comments, employees!inner(id, first_name, last_name, full_name)', { count: 'exact' })
    .gte('date', from).lte('date', to)
    .order('date', { ascending: false })
    .order('employees(last_name)', { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)
  if (empId)  query = query.eq('employee_id', empId)
  if (status) query = query.eq('status', status)

  const { data: records, count } = await query

  const { data: statsData } = await supabase
    .from('attendance_records').select('status').gte('date', from).lte('date', to).then(r => r)

  const stats = {
    total:    employees?.length ?? 0,
    office:   statsData?.filter(r => r.status === 'office').length ?? 0,
    wfh:      statsData?.filter(r => r.status === 'wfh').length ?? 0,
    remote:   statsData?.filter(r => r.status === 'remote').length ?? 0,
    absent:   statsData?.filter(r => r.status === 'no_clocking').length ?? 0,
    vacation: statsData?.filter(r => r.status === 'vacation').length ?? 0,
  }

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Attendance</h1>
          <p className="text-xs text-slate-600 mt-0.5">Daily attendance records</p>
        </div>
        <a href="/dashboard/import" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
          Import CSV
        </a>
      </div>

      <StatCards stats={stats} />

      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <AttendanceFilters employees={employees ?? []} />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-600">{count ?? 0} records · {from === to ? from : `${from} → ${to}`}</p>
        </div>

        {!records || records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-slate-600 text-sm">No records found</p>
            <p className="text-slate-500 text-xs mt-1">Import a CSV or adjust filters</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Date</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Employee</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">In</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Out</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Hours</th>
                    <th className="px-4 py-2.5 font-medium text-slate-600 text-[10px] uppercase tracking-wider">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {records.map(r => {
                    const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap font-medium">{r.date}</td>
                        <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">{emp?.full_name ?? '—'}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap font-mono">{r.time_in ? r.time_in.slice(0, 5) : '—'}</td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap font-mono">{r.time_out ? r.time_out.slice(0, 5) : '—'}</td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{r.hours_worked != null ? `${Math.floor(r.hours_worked)}h ${Math.round((r.hours_worked % 1) * 60)}m` : '—'}</td>
                        <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate">{r.comments || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-slate-100">
              {records.map(r => {
                const emp = Array.isArray(r.employees) ? r.employees[0] : r.employees
                return (
                  <div key={r.id} className="px-4 py-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">{emp?.full_name ?? '—'}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-600">
                      <span>{r.date}</span>
                      <span>{r.time_in ? r.time_in.slice(0, 5) : '—'} → {r.time_out ? r.time_out.slice(0, 5) : '—'}</span>
                      <span>{r.hours_worked != null ? `${Math.floor(r.hours_worked)}h ${Math.round((r.hours_worked % 1) * 60)}m` : '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {totalPages > 1 && (() => {
          const baseHref = `?from=${from}&to=${to}${empId ? `&employee=${empId}` : ''}${status ? `&status=${status}` : ''}`
          const startPage = Math.max(1, page - 2)
          const endPage = Math.min(totalPages, startPage + 4)
          const pages = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i)
          return (
            <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, count ?? 0)} of {count}</span>
              <div className="flex items-center gap-1">
                {page > 1 && <a href={`${baseHref}&page=${page - 1}`} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-[11px]">Prev</a>}
                {pages.map(p => (
                  <a key={p} href={`${baseHref}&page=${p}`}
                    className={`px-2 py-1 rounded text-[11px] font-medium ${p === page ? 'bg-indigo-600 text-white border border-indigo-600' : 'border border-slate-200 hover:bg-slate-50 text-slate-500'}`}>{p}</a>
                ))}
                {page < totalPages && <a href={`${baseHref}&page=${page + 1}`} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-[11px]">Next</a>}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
