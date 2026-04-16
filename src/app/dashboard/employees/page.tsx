import { createAdminClient } from '@/lib/supabase/admin'
import EmployeeTable from '@/components/employees/EmployeeTable'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

interface PageProps {
  searchParams: Promise<{ search?: string; group?: string; show?: string; page?: string }>
}

export default async function EmployeesPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const search = sp.search ?? ''
  const group = sp.group ?? ''
  const show = sp.show ?? 'active' // 'active' | 'excluded' | 'all'
  const page = parseInt(sp.page ?? '1')
  const offset = (page - 1) * PAGE_SIZE

  const supabase = createAdminClient()

  // Count query (all employees, no filters for stats)
  const { data: allEmps } = await supabase.from('employees').select('group_type, excluded')
  const all = allEmps ?? []
  const activeEmps = all.filter(e => !e.excluded)
  const maltaCount = activeEmps.filter(e => e.group_type === 'office_malta').length
  const remoteCount = activeEmps.filter(e => e.group_type === 'remote').length
  const unclassifiedCount = activeEmps.filter(e => !e.group_type || e.group_type === 'unclassified').length
  const excludedCount = all.filter(e => e.excluded).length

  // Filtered query
  let query = supabase
    .from('employees')
    .select('id, full_name, talexio_id, unit, group_type, job_schedule, position, excluded, created_at', { count: 'exact' })
    .order('last_name')

  if (show === 'active') query = query.eq('excluded', false)
  else if (show === 'excluded') query = query.eq('excluded', true)

  if (group) query = query.eq('group_type', group)
  if (search) query = query.ilike('full_name', `%${search}%`)

  query = query.range(offset, offset + PAGE_SIZE - 1)
  const { data: employees, count } = await query
  const emps = employees ?? []
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  function buildHref(overrides: Record<string, string>) {
    const p = new URLSearchParams()
    const vals = { search, group, show, page: '1', ...overrides }
    if (vals.search) p.set('search', vals.search)
    if (vals.group) p.set('group', vals.group)
    if (vals.show && vals.show !== 'active') p.set('show', vals.show)
    if (vals.page !== '1') p.set('page', vals.page)
    const qs = p.toString()
    return `/dashboard/employees${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Employees</h1>
        <p className="text-xs text-slate-600 mt-0.5">{activeEmps.length} active · {excludedCount} excluded</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Malta Office', value: maltaCount },
          { label: 'Remote', value: remoteCount },
          { label: 'Unclassified', value: unclassifiedCount },
          { label: 'Excluded', value: excludedCount },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-3">
            <p className="text-xl font-bold text-slate-800">{value}</p>
            <p className="text-[11px] text-slate-600 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-slate-200 p-3">
        <form className="flex flex-col sm:flex-row flex-wrap gap-2">
          <input
            name="search" defaultValue={search} placeholder="Search by name..."
            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 flex-1 sm:max-w-[220px]"
          />
          <select name="group" defaultValue={group}
            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
            <option value="">All Groups</option>
            <option value="office_malta">Malta Office</option>
            <option value="remote">Remote</option>
            <option value="unclassified">Unclassified</option>
          </select>
          <select name="show" defaultValue={show}
            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400">
            <option value="active">Active only</option>
            <option value="excluded">Excluded only</option>
            <option value="all">All</option>
          </select>
          <button type="submit" className="rounded-md bg-indigo-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-indigo-700 transition-colors">
            Filter
          </button>
          {(search || group || show !== 'active') && (
            <a href="/dashboard/employees" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors text-center">
              Clear
            </a>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-600">{count ?? 0} employees</p>
          <a href="/dashboard/settings" className="text-xs text-indigo-600 hover:underline">Manage groups</a>
        </div>

        {emps.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-slate-600 text-sm">No employees found</p>
          </div>
        ) : (
          <EmployeeTable employees={emps} />
        )}

        {/* Pagination */}
        {totalPages > 1 && (() => {
          const startPage = Math.max(1, page - 2)
          const endPage = Math.min(totalPages, startPage + 4)
          const pages = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i)
          return (
            <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, count ?? 0)} of {count}</span>
              <div className="flex items-center gap-1">
                {page > 1 && <a href={buildHref({ page: String(page - 1) })} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-[11px]">Prev</a>}
                {pages.map(p => (
                  <a key={p} href={buildHref({ page: String(p) })}
                    className={`px-2 py-1 rounded text-[11px] font-medium ${p === page ? 'bg-indigo-600 text-white border border-indigo-600' : 'border border-slate-200 hover:bg-slate-50 text-slate-500'}`}>{p}</a>
                ))}
                {page < totalPages && <a href={buildHref({ page: String(page + 1) })} className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 text-[11px]">Next</a>}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
