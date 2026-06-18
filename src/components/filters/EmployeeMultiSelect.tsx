'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

interface Props {
  employees: { id: string; full_name: string }[]
  selected: string[]
}

export default function EmployeeMultiSelect({ employees, selected }: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  function commit(ids: string[]) {
    const next = new URLSearchParams(params.toString())
    if (ids.length) next.set('employees', ids.join(',')); else next.delete('employees')
    next.delete('page')
    router.push(`?${next.toString()}`)
  }

  function toggle(id: string) {
    commit(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }

  const filtered = search ? employees.filter(e => e.full_name.toLowerCase().includes(search.toLowerCase())) : employees
  const label = selected.length === 0 ? 'All employees' : `${selected.length} selected`

  return (
    <div className="relative w-full sm:w-auto" ref={ref}>
      <div onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 cursor-pointer sm:min-w-[200px] hover:border-slate-300 focus-within:ring-1 focus-within:ring-slate-400">
        <Search size={12} className="text-slate-500 shrink-0" />
        {open
          ? <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="flex-1 outline-none text-xs bg-transparent" />
          : <span className={`flex-1 truncate ${selected.length ? 'text-slate-700' : 'text-slate-500'}`}>{label}</span>}
        {selected.length > 0 && <button onClick={e => { e.stopPropagation(); commit([]) }} className="text-slate-500 hover:text-slate-700"><X size={12} /></button>}
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md border border-slate-200 shadow-md z-50 max-h-56 overflow-y-auto sm:min-w-[220px]">
          <button onClick={() => commit([])} className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${selected.length === 0 ? 'font-medium text-slate-800' : 'text-slate-500'}`}>All employees</button>
          {filtered.map(emp => (
            <label key={emp.id} className={`flex items-center gap-2 px-3 py-2 text-xs hover:bg-slate-50 cursor-pointer ${selected.includes(emp.id) ? 'text-indigo-700 bg-indigo-50/50' : 'text-gray-600'}`}>
              <input type="checkbox" checked={selected.includes(emp.id)} onChange={() => toggle(emp.id)} className="accent-indigo-600" />
              <span className="truncate">{emp.full_name}</span>
            </label>
          ))}
          {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-500 text-center">No matches</p>}
        </div>
      )}
    </div>
  )
}
